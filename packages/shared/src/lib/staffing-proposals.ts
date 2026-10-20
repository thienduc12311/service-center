import {
  STAFFING_PROPOSAL_RULE_VERSION,
  type ProposalCandidateExplanation,
  type ProposalChoice,
  type ProposalExclusionCode,
  type ProposalFairnessMetrics,
  type ProposalReasonDetail,
  type ProposalTextParams,
  type ProposalTieBreak,
  type ProposalSnapshotAssignment,
  type ProposalSnapshotPlan,
  type ProposalSnapshotRotation,
  type ProposalVacancy,
  type ProposalVacancyCode,
  type ProposalWarning,
  type StaffingProposalEdits,
  type StaffingProposalResult,
  type StaffingProposalSnapshot,
} from '../types/staffing-proposals.js';
import { addLocalDays, localDaysBetween } from './timezone.js';

/**
 * F06 deterministic staffing engine (rule version `f06.fairness.v1`).
 *
 * Pure: reads only the snapshot, the reviewer edits and the recorded seed.
 * Order of work is fixed — plans by (service date, id), needs by (team id,
 * position id), slots by ordinal — so earlier choices feed later fairness
 * counts identically on every run.
 *
 * Per slot:
 *  1. Existing non-declined requests on that plan/team/position are kept.
 *  2. Reviewer locks fill next; an invalid lock leaves the slot open (never replaced silently).
 *  3. A team rotation's person for that civil week (or an exception) is used if eligible;
 *     otherwise the rotation's substitute policy decides: leave open, or fall through to 4.
 *  4. Fairness: eligible members without preference warnings first, then fewer plans
 *     served in the lookback window, then least recently served, then the seeded tie-break.
 *
 * Hard exclusions (never overridden): not a member of that position, blockout,
 * overlapping commitment on another plan, already has a request on the plan,
 * already chosen for this plan by this proposal, excluded by the reviewer.
 */

const MAX_ALTERNATIVES = 5;

/**
 * F03 freshness codes describe how old someone's availability data is, not a
 * preference. They are shown on a choice but never change ranking or warnings.
 */
export const PROPOSAL_FRESHNESS_CODES: ReadonlySet<string> = new Set(['availability_unknown', 'availability_stale']);
const rankingCodes = (codes: readonly string[]): string[] => codes.filter((code) => !PROPOSAL_FRESHNESS_CODES.has(code));

const EXCLUSION_LABELS: Record<ProposalExclusionCode, string> = {
  not_position_member: 'not on this position',
  blockout: 'unavailable (blockout)',
  overlapping_commitment: 'another commitment at that time',
  already_on_plan: 'already has a request on this plan',
  already_chosen_on_plan: 'already proposed for this plan',
  excluded_by_reviewer: 'excluded by you',
};

export const proposalExclusionLabel = (code: ProposalExclusionCode): string => EXCLUSION_LABELS[code];

/** English wording of each tie-break in the legacy `reasons` text. */
const TIE_BREAK_TEXT: Record<ProposalTieBreak, string> = {
  preference_warnings: 'preference warnings',
  fewer_plans_served: 'fewer plans served',
  served_less_recently: 'served less recently',
  seeded_tie_break: 'the seeded tie-break',
};

/** The actual ordering policy, shown verbatim to reviewers. */
export const describeProposalPolicy = (lookbackDays: number): string[] => [
  'Existing requests that are not declined are always kept; a proposal never removes or changes them.',
  'Your locked choices are kept on every recompute. A lock that is no longer valid leaves the position open.',
  'Only members of the exact team position are considered. Blockouts and overlapping commitments on other plans exclude a person; nobody is proposed twice on one plan.',
  'A team rotation suggests its person for that local week. If that person is not eligible, the rotation either leaves the position open or falls back to fairness, as configured.',
  'Availability freshness (never reviewed, or reviewed long ago) is shown but does not change the order.',
  `Fairness order: people without preference warnings first, then fewer plans served in the last ${lookbackDays} days (including earlier weeks of this proposal), then least recently served, then a fixed tie-break from the recorded seed.`,
  'Fairness describes this ordering policy; it does not guarantee equal outcomes.',
];

/** FNV-1a 32-bit as 8 hex chars: stable across Node, browsers and Hermes. */
export const proposalTieBreak = (seed: string, planId: string, positionId: string, personId: string): string => {
  let hash = 0x811c9dc5;
  const input = `${seed}|${planId}|${positionId}|${personId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/** Week of the rotation cycle for a civil date; dates before the anchor wrap backwards. */
export const rotationWeekIndex = (anchorDate: string, localDate: string, cycleWeeks: number): number => {
  const weeks = Math.floor(localDaysBetween(anchorDate, localDate) / 7);
  return ((weeks % cycleWeeks) + cycleWeeks) % cycleWeeks;
};

export interface RotationPick {
  person_ids: string[];
  source: 'pattern' | 'exception' | 'skipped';
  week_index: number;
}

/** Who a rotation names for one position on one civil date. */
export const rotationPick = (rotation: ProposalSnapshotRotation, localDate: string, positionId: string): RotationPick => {
  const weekIndex = rotationWeekIndex(rotation.anchor_date, localDate, rotation.cycle_weeks);
  const exceptions = rotation.exceptions.filter((item) => item.local_date === localDate && item.position_id === positionId);
  if (exceptions.length) {
    const people = exceptions.flatMap((item) => (item.person_id ? [item.person_id] : [])).sort();
    return { person_ids: people, source: people.length ? 'exception' : 'skipped', week_index: weekIndex };
  }
  const people = rotation.slots
    .filter((slot) => slot.week_index === weekIndex && slot.position_id === positionId)
    .map((slot) => slot.person_id)
    .sort();
  return { person_ids: people, source: 'pattern', week_index: weekIndex };
};

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface FairnessCandidate {
  person_id: string;
  metrics: ProposalFairnessMetrics;
}

const compareFairness = (a: FairnessCandidate, b: FairnessCandidate): number =>
  Number(a.metrics.has_preference_warning) - Number(b.metrics.has_preference_warning)
  || a.metrics.assigned_count - b.metrics.assigned_count
  || byString(a.metrics.last_served_on ?? '', b.metrics.last_served_on ?? '')
  || byString(a.metrics.tie_break, b.metrics.tie_break)
  || byString(a.person_id, b.person_id);

const keepsSlot = (assignment: ProposalSnapshotAssignment): boolean => assignment.status !== 'declined';

const statusRank = (assignment: ProposalSnapshotAssignment): number =>
  assignment.status === 'confirmed' ? 0 : assignment.visibility === 'released' ? 1 : 2;

export interface ProposalRunInput {
  snapshot: StaffingProposalSnapshot;
  edits: StaffingProposalEdits;
  seed: string;
}

export const runStaffingProposal = ({ snapshot, edits, seed }: ProposalRunInput): StaffingProposalResult => {
  const names = new Map(snapshot.people.map((person) => [person.id, person.full_name]));
  const nameOf = (personId: string): string => names.get(personId) ?? 'Unavailable person';
  const teamIds = new Set(snapshot.team_ids);
  const plans = [...snapshot.plans].sort((a, b) => byString(a.service_date, b.service_date) || byString(a.id, b.id));

  const members = new Map<string, string[]>();
  for (const membership of snapshot.memberships) {
    if (!names.has(membership.person_id)) continue;
    const key = `${membership.team_id}:${membership.position_id}`;
    const list = members.get(key) ?? [];
    if (!list.includes(membership.person_id)) list.push(membership.person_id);
    members.set(key, list);
  }
  for (const list of members.values()) list.sort();

  const onPlan = new Map<string, Set<string>>();
  for (const assignment of snapshot.assignments) {
    const set = onPlan.get(assignment.plan_id) ?? new Set<string>();
    set.add(assignment.person_id);
    onPlan.set(assignment.plan_id, set);
  }
  const unavailable = new Map<string, 'blockout' | 'overlapping_commitment'>();
  for (const row of [...snapshot.unavailable].sort((a, b) => byString(a.code, b.code))) {
    const key = `${row.person_id}:${row.plan_id}`;
    if (!unavailable.has(key)) unavailable.set(key, row.code);
  }
  const preferenceCodes = new Map<string, string[]>();
  for (const row of snapshot.preferences) {
    const key = `${row.person_id}:${row.plan_id}:${row.team_id}`;
    preferenceCodes.set(key, [...new Set([...(preferenceCodes.get(key) ?? []), ...row.codes])].sort());
  }
  const servedDates = new Map<string, Array<{ plan_id: string; date: string }>>();
  for (const row of snapshot.serving) {
    const list = servedDates.get(row.person_id) ?? [];
    if (!list.some((item) => item.plan_id === row.plan_id)) list.push({ plan_id: row.plan_id, date: row.service_date.slice(0, 10) });
    servedDates.set(row.person_id, list);
  }
  const reviewerExcluded = new Set(edits.exclusions.map((item) => `${item.plan_id}:${item.position_id}:${item.person_id}`));
  const rotationsByTeam = new Map<string, ProposalSnapshotRotation[]>();
  for (const rotation of [...snapshot.rotations].sort((a, b) => byString(a.name, b.name) || byString(a.id, b.id))) {
    rotationsByTeam.set(rotation.team_id, [...(rotationsByTeam.get(rotation.team_id) ?? []), rotation]);
  }

  const choices: ProposalChoice[] = [];
  const vacancies: ProposalVacancy[] = [];
  const warnings: ProposalWarning[] = [];
  /** person → plans newly chosen by this proposal (feeds later fairness). */
  const proposedServing = new Map<string, Array<{ plan_id: string; date: string }>>();
  let slotCount = 0;

  const metricsFor = (plan: ProposalSnapshotPlan, teamId: string, positionId: string, personId: string): ProposalFairnessMetrics => {
    const planDate = plan.service_date.slice(0, 10);
    const windowStart = addLocalDays(planDate, -snapshot.lookback_days);
    const history = [...(servedDates.get(personId) ?? []), ...(proposedServing.get(personId) ?? [])]
      .filter((item) => item.plan_id !== plan.id && item.date >= windowStart && item.date < planDate);
    const plansServed = new Set(history.map((item) => item.plan_id));
    const last = history.map((item) => item.date).sort().at(-1) ?? null;
    return {
      assigned_count: plansServed.size,
      last_served_on: last,
      tie_break: proposalTieBreak(seed, plan.id, positionId, personId),
      has_preference_warning: rankingCodes(preferenceCodes.get(`${personId}:${plan.id}:${teamId}`) ?? []).length > 0,
    };
  };

  for (const plan of plans) {
    const chosenOnPlan = new Set<string>();
    const needs = plan.needs
      .filter((need) => teamIds.has(need.team_id))
      .sort((a, b) => byString(a.team_id, b.team_id) || byString(a.position_id, b.position_id));

    const exclusionFor = (teamId: string, positionId: string, personId: string, ignoreReviewer = false): ProposalExclusionCode | null => {
      if (!(members.get(`${teamId}:${positionId}`) ?? []).includes(personId)) return 'not_position_member';
      const hard = unavailable.get(`${personId}:${plan.id}`);
      if (hard) return hard;
      if (onPlan.get(plan.id)?.has(personId)) return 'already_on_plan';
      if (chosenOnPlan.has(personId)) return 'already_chosen_on_plan';
      if (!ignoreReviewer && reviewerExcluded.has(`${plan.id}:${positionId}:${personId}`)) return 'excluded_by_reviewer';
      return null;
    };

    const explainAll = (teamId: string, positionId: string): ProposalCandidateExplanation[] =>
      (members.get(`${teamId}:${positionId}`) ?? []).map((personId) => {
        const excluded = exclusionFor(teamId, positionId, personId);
        return { person_id: personId, person_name: nameOf(personId), excluded,
          metrics: excluded ? null : metricsFor(plan, teamId, positionId, personId) };
      });

    const rankedEligible = (teamId: string, positionId: string): FairnessCandidate[] =>
      explainAll(teamId, positionId)
        .filter((item): item is ProposalCandidateExplanation & { metrics: ProposalFairnessMetrics } => !item.excluded && item.metrics !== null)
        .map((item) => ({ person_id: item.person_id, metrics: item.metrics }))
        .sort(compareFairness);

    const choose = (choice: Omit<ProposalChoice, 'person_name' | 'preference_codes'>): void => {
      chosenOnPlan.add(choice.person_id);
      const codes = preferenceCodes.get(`${choice.person_id}:${plan.id}:${choice.team_id}`) ?? [];
      if (choice.source !== 'existing') {
        proposedServing.set(choice.person_id, [...(proposedServing.get(choice.person_id) ?? []), { plan_id: plan.id, date: plan.service_date.slice(0, 10) }]);
        if (rankingCodes(codes).length) warnings.push({ code: 'preference', plan_id: plan.id, position_id: choice.position_id, person_id: choice.person_id,
          message: `${nameOf(choice.person_id)} has preference warnings for ${plan.title}: ${rankingCodes(codes).join(', ')}.`,
          params: { person_id: choice.person_id, person_name: nameOf(choice.person_id), plan_title: plan.title, preference_codes: rankingCodes(codes) } });
      }
      choices.push({ ...choice, person_name: nameOf(choice.person_id), preference_codes: codes });
    };

    const vacate = (teamId: string, positionId: string, slotKey: string, code: ProposalVacancyCode, reason: string, params?: ProposalTextParams): void => {
      const counts: Partial<Record<ProposalExclusionCode, number>> = {};
      for (const item of explainAll(teamId, positionId)) if (item.excluded) counts[item.excluded] = (counts[item.excluded] ?? 0) + 1;
      vacancies.push({ slot_key: slotKey, plan_id: plan.id, team_id: teamId, position_id: positionId, code, reason, ...(params ? { params } : {}), exclusion_counts: counts });
    };

    for (const need of needs) {
      const { team_id: teamId, position_id: positionId } = need;
      const existing = snapshot.assignments
        .filter((row) => row.plan_id === plan.id && row.team_id === teamId && row.position_id === positionId && keepsSlot(row))
        .sort((a, b) => statusRank(a) - statusRank(b) || byString(a.id, b.id));
      const slots = Math.max(need.needed, existing.length);
      slotCount += slots;
      let ordinal = 0;
      const nextKey = (): string => `${plan.id}:${positionId}:${ordinal++}`;

      for (const row of existing) {
        chosenOnPlan.add(row.person_id);
        choose({ slot_key: nextKey(), plan_id: plan.id, team_id: teamId, position_id: positionId, person_id: row.person_id,
          source: 'existing', assignment_id: row.id, assignment_status: row.status, assignment_visibility: row.visibility,
          metrics: null, alternatives: [],
          reasons: [`Kept: existing ${row.visibility === 'prepared' ? 'prepared' : row.status} request.`],
          reason_details: [{ code: 'kept_existing', state: row.visibility === 'prepared' ? 'prepared' : row.status }] });
      }

      const locks = edits.locks
        .filter((lock) => lock.plan_id === plan.id && lock.position_id === positionId)
        .map((lock) => lock.person_id)
        .filter((personId, index, list) => list.indexOf(personId) === index && !existing.some((row) => row.person_id === personId))
        .sort();
      for (const personId of locks) {
        if (ordinal >= slots) break;
        const key = nextKey();
        const excluded = exclusionFor(teamId, positionId, personId, true);
        if (excluded) {
          const params: ProposalTextParams = { person_id: personId, person_name: nameOf(personId), plan_title: plan.title, exclusion: excluded };
          warnings.push({ code: 'locked_choice_invalid', plan_id: plan.id, position_id: positionId, person_id: personId,
            message: `Your locked choice ${nameOf(personId)} is no longer eligible for ${plan.title}: ${EXCLUSION_LABELS[excluded]}.`, params });
          vacate(teamId, positionId, key, 'locked_choice_invalid',
            `Left open: your locked choice ${nameOf(personId)} is ${EXCLUSION_LABELS[excluded]}. Unlock to let the engine choose.`, params);
          continue;
        }
        choose({ slot_key: key, plan_id: plan.id, team_id: teamId, position_id: positionId, person_id: personId,
          source: 'locked', assignment_id: null, assignment_status: null, assignment_visibility: null,
          metrics: metricsFor(plan, teamId, positionId, personId), alternatives: [], reasons: ['Locked by you; kept on every recompute.'],
          reason_details: [{ code: 'locked' }] });
      }

      const rotation = (rotationsByTeam.get(teamId) ?? []).find((item) =>
        item.slots.some((slot) => slot.position_id === positionId) || item.exceptions.some((ex) => ex.position_id === positionId));
      if (rotation && ordinal < slots) {
        const pick = rotationPick(rotation, plan.local_date, positionId);
        if (pick.source === 'exception' || pick.source === 'skipped') {
          warnings.push({ code: 'rotation_exception', plan_id: plan.id, position_id: positionId, person_id: null,
            message: pick.source === 'skipped'
              ? `Rotation “${rotation.name}” is skipped on ${plan.local_date}; fairness decides.`
              : `Rotation “${rotation.name}” uses an exception on ${plan.local_date}.`,
            params: { rotation_name: rotation.name, date: plan.local_date, skipped: pick.source === 'skipped' } });
        }
        for (const personId of pick.person_ids) {
          if (ordinal >= slots) break;
          if (chosenOnPlan.has(personId) && (existing.some((row) => row.person_id === personId) || locks.includes(personId))) continue;
          const excluded = exclusionFor(teamId, positionId, personId);
          if (!excluded) {
            choose({ slot_key: nextKey(), plan_id: plan.id, team_id: teamId, position_id: positionId, person_id: personId,
              source: 'rotation', assignment_id: null, assignment_status: null, assignment_visibility: null,
              metrics: metricsFor(plan, teamId, positionId, personId), alternatives: rankedEligible(teamId, positionId).slice(0, MAX_ALTERNATIVES)
                .map((item) => ({ person_id: item.person_id, person_name: nameOf(item.person_id), excluded: null, metrics: item.metrics })),
              reasons: [`Rotation “${rotation.name}”, ${pick.source === 'exception' ? `exception for ${plan.local_date}` : `week ${pick.week_index + 1} of ${rotation.cycle_weeks}`}.`],
              reason_details: [pick.source === 'exception'
                ? { code: 'rotation_exception', rotation_name: rotation.name, date: plan.local_date }
                : { code: 'rotation_week', rotation_name: rotation.name, week: pick.week_index + 1, cycle_weeks: rotation.cycle_weeks }] });
            continue;
          }
          // A reviewer's exclusion is an adjustment, not an availability problem: fairness decides.
          if (excluded === 'excluded_by_reviewer') continue;
          const missing = excluded === 'not_position_member';
          const code = missing ? 'rotation_member_missing' : 'rotation_member_unavailable';
          const params: ProposalTextParams = { person_id: personId, person_name: nameOf(personId), rotation_name: rotation.name, date: plan.local_date, exclusion: excluded };
          warnings.push({ code, plan_id: plan.id, position_id: positionId, person_id: personId,
            message: `Rotation “${rotation.name}” names ${nameOf(personId)} for ${plan.local_date}, but they are ${EXCLUSION_LABELS[excluded]}.`, params });
          if (rotation.substitute_policy === 'vacancy') {
            vacate(teamId, positionId, nextKey(), code,
              `Left open: rotation “${rotation.name}” names ${nameOf(personId)}, who is ${EXCLUSION_LABELS[excluded]}. This rotation leaves such weeks open.`, params);
          }
        }
      }

      while (ordinal < slots) {
        const key = nextKey();
        const ranked = rankedEligible(teamId, positionId);
        const best = ranked[0];
        if (!best) {
          const pool = members.get(`${teamId}:${positionId}`) ?? [];
          if (!pool.length) vacate(teamId, positionId, key, 'no_position_members', 'Left open: nobody on this team holds this position.');
          else vacate(teamId, positionId, key, 'all_candidates_excluded', 'Left open: every member of this position is excluded (see counts).');
          continue;
        }
        const runnerUp = ranked[1];
        const reasons = [
          best.metrics.has_preference_warning ? 'Every eligible member has a preference warning; chosen by fairness among them.' : 'No preference warnings.',
          `${best.metrics.assigned_count} plan${best.metrics.assigned_count === 1 ? '' : 's'} served in the last ${snapshot.lookback_days} days${best.metrics.last_served_on ? `, last on ${best.metrics.last_served_on}` : ', none recently'}.`,
        ];
        const reasonDetails: ProposalReasonDetail[] = [
          { code: best.metrics.has_preference_warning ? 'all_have_preference_warnings' : 'no_preference_warnings' },
          { code: 'served_count', count: best.metrics.assigned_count, lookback_days: snapshot.lookback_days, last_served_on: best.metrics.last_served_on },
        ];
        if (runnerUp) {
          const decidedBy: ProposalTieBreak = runnerUp.metrics.has_preference_warning !== best.metrics.has_preference_warning ? 'preference_warnings'
            : runnerUp.metrics.assigned_count !== best.metrics.assigned_count ? 'fewer_plans_served'
              : (runnerUp.metrics.last_served_on ?? '') !== (best.metrics.last_served_on ?? '') ? 'served_less_recently'
                : 'seeded_tie_break';
          reasons.push(`Chosen over ${nameOf(runnerUp.person_id)} by ${TIE_BREAK_TEXT[decidedBy]}.`);
          reasonDetails.push({ code: 'chosen_over', person_id: runnerUp.person_id, person_name: nameOf(runnerUp.person_id), decided_by: decidedBy });
        }
        choose({ slot_key: key, plan_id: plan.id, team_id: teamId, position_id: positionId, person_id: best.person_id,
          source: 'fairness', assignment_id: null, assignment_status: null, assignment_visibility: null, metrics: best.metrics,
          alternatives: ranked.slice(1, 1 + MAX_ALTERNATIVES).map((item) => ({ person_id: item.person_id, person_name: nameOf(item.person_id), excluded: null, metrics: item.metrics })),
          reasons, reason_details: reasonDetails });
      }
    }
  }

  const existingCount = choices.filter((choice) => choice.source === 'existing').length;
  return {
    rule_version: STAFFING_PROPOSAL_RULE_VERSION,
    seed,
    choices,
    vacancies,
    warnings,
    summary: { slots: slotCount, existing: existingCount, proposed: choices.length - existingCount, vacant: vacancies.length },
  };
};

/** Choices the commit must create (everything except kept existing requests). */
export const proposalChoicesToCreate = (result: StaffingProposalResult): ProposalChoice[] =>
  result.choices.filter((choice) => choice.source !== 'existing');
