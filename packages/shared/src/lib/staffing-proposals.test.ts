import { describe, expect, it } from 'vitest';
import {
  STAFFING_PROPOSAL_RULE_VERSION,
  type ProposalSnapshotRotation,
  type StaffingProposalEdits,
  type StaffingProposalSnapshot,
} from '../types/staffing-proposals.js';
import { proposalChoicesToCreate, rotationPick, rotationWeekIndex, runStaffingProposal } from './staffing-proposals.js';

const TEAM = 'team-band';
const DRUMS = 'pos-drums';
const KEYS = 'pos-keys';
const [ANA, BEN, CAL, DEE] = ['p-ana', 'p-ben', 'p-cal', 'p-dee'];
const noEdits: StaffingProposalEdits = { locks: [], exclusions: [] };

const plan = (id: string, date: string, needs = [{ team_id: TEAM, position_id: DRUMS, needed: 1 }]) => ({
  id, title: `Service ${date}`, service_date: `${date}T14:00:00.000Z`, local_date: date,
  service_type_id: 'st', staffing_revision: 1, needs,
});

const baseSnapshot = (overrides: Partial<StaffingProposalSnapshot> = {}): StaffingProposalSnapshot => ({
  rule_version: STAFFING_PROPOSAL_RULE_VERSION,
  organization_id: 'org',
  time_zone: 'America/Toronto',
  captured_at: '2026-10-18T00:00:00.000Z',
  lookback_days: 90,
  team_ids: [TEAM],
  plans: [plan('plan-1', '2026-11-01'), plan('plan-2', '2026-11-08'), plan('plan-3', '2026-11-15')],
  people: [ANA, BEN, CAL, DEE].map((id) => ({ id, full_name: id.slice(2).toUpperCase() })),
  memberships: [ANA, BEN, CAL].map((person_id) => ({ person_id, team_id: TEAM, position_id: DRUMS })),
  assignments: [],
  unavailable: [],
  preferences: [],
  serving: [],
  rotations: [],
  ...overrides,
});

const picks = (result: ReturnType<typeof runStaffingProposal>) =>
  result.choices.map((choice) => `${choice.plan_id}:${choice.person_id}:${choice.source}`);

describe('runStaffingProposal fairness', () => {
  it('is reproducible for identical snapshot, edits and seed', () => {
    const snapshot = baseSnapshot();
    const a = runStaffingProposal({ snapshot, edits: noEdits, seed: 'seed-1' });
    const b = runStaffingProposal({ snapshot: structuredClone(snapshot), edits: noEdits, seed: 'seed-1' });
    expect(b).toEqual(a);
    expect(a.rule_version).toBe(STAFFING_PROPOSAL_RULE_VERSION);
  });

  it('rotates a three-person position across three weeks by assigned count', () => {
    const result = runStaffingProposal({ snapshot: baseSnapshot(), edits: noEdits, seed: 'seed-1' });
    expect(new Set(result.choices.map((choice) => choice.person_id)).size).toBe(3);
    expect(result.vacancies).toEqual([]);
    expect(result.summary).toEqual({ slots: 3, existing: 0, proposed: 3, vacant: 0 });
  });

  it('prefers fewer plans served, then least recently served, then the seeded tie-break', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01')],
      serving: [
        { person_id: ANA, plan_id: 'old-1', service_date: '2026-10-04T14:00:00Z' },
        { person_id: ANA, plan_id: 'old-2', service_date: '2026-10-11T14:00:00Z' },
        { person_id: BEN, plan_id: 'old-3', service_date: '2026-10-25T14:00:00Z' },
        { person_id: CAL, plan_id: 'old-4', service_date: '2026-10-18T14:00:00Z' },
      ],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 'seed-1' });
    // Ben and Cal each served once; Cal served less recently.
    expect(result.choices[0]!.person_id).toBe(CAL);
    expect(result.choices[0]!.reasons.join(' ')).toContain('served less recently');
    expect(result.choices[0]!.alternatives.map((item) => item.person_id)).toEqual([BEN, ANA]);
  });

  it('ignores serving outside the lookback window', () => {
    const snapshot = baseSnapshot({
      lookback_days: 28,
      plans: [plan('plan-1', '2026-11-01')],
      memberships: [ANA, BEN].map((person_id) => ({ person_id, team_id: TEAM, position_id: DRUMS })),
      serving: [{ person_id: ANA, plan_id: 'old', service_date: '2026-09-01T14:00:00Z' }],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 'x' });
    expect(result.choices[0]!.metrics?.assigned_count).toBe(0);
  });

  it('breaks a full tie with the seed and records it', () => {
    const snapshot = baseSnapshot({ plans: [plan('plan-1', '2026-11-01')] });
    const seeds = ['a1b2', 'c3d4', 'e5f6', 'g7h8', 'i9j0', 'k1l2'];
    const chosen = new Set(seeds.map((seed) => runStaffingProposal({ snapshot, edits: noEdits, seed }).choices[0]!.person_id));
    expect(chosen.size).toBeGreaterThan(1);
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 'a1b2' });
    expect(result.seed).toBe('a1b2');
    expect(result.choices[0]!.reasons.join(' ')).toContain('seeded tie-break');
  });
});

describe('runStaffingProposal hard constraints and vacancies', () => {
  it('leaves a position open when nobody holds it (insufficient skills)', () => {
    const snapshot = baseSnapshot({ plans: [plan('plan-1', '2026-11-01', [{ team_id: TEAM, position_id: KEYS, needed: 1 }])] });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices).toEqual([]);
    expect(result.vacancies).toMatchObject([{ code: 'no_position_members', position_id: KEYS }]);
  });

  it('excludes blockouts and other-plan commitments and explains the binding reason', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01')],
      unavailable: [
        { person_id: ANA, plan_id: 'plan-1', code: 'blockout' },
        { person_id: BEN, plan_id: 'plan-1', code: 'overlapping_commitment' },
        { person_id: CAL, plan_id: 'plan-1', code: 'blockout' },
      ],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices).toEqual([]);
    expect(result.vacancies[0]).toMatchObject({ code: 'all_candidates_excluded', exclusion_counts: { blockout: 2, overlapping_commitment: 1 } });
  });

  it('ranks contradictory preferences after clean candidates but never excludes on them', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01')],
      memberships: [ANA, BEN].map((person_id) => ({ person_id, team_id: TEAM, position_id: DRUMS })),
      serving: [{ person_id: BEN, plan_id: 'old', service_date: '2026-10-25T14:00:00Z' }],
      preferences: [{ person_id: ANA, plan_id: 'plan-1', team_id: TEAM, codes: ['avoided_date', 'outside_preferred_dates'] }],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices[0]!.person_id).toBe(BEN);
    expect(result.choices[0]!.reasons.join(' ')).toContain('preference warnings');

    const onlyWarned = runStaffingProposal({ snapshot: { ...snapshot, memberships: [{ person_id: ANA, team_id: TEAM, position_id: DRUMS }] }, edits: noEdits, seed: 's' });
    expect(onlyWarned.choices[0]).toMatchObject({ person_id: ANA, preference_codes: ['avoided_date', 'outside_preferred_dates'] });
    expect(onlyWarned.warnings).toMatchObject([{ code: 'preference', person_id: ANA }]);
  });

  it('shows availability freshness without letting it change the order or warn', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01')],
      memberships: [ANA, BEN].map((person_id) => ({ person_id, team_id: TEAM, position_id: DRUMS })),
      serving: [{ person_id: BEN, plan_id: 'old', service_date: '2026-10-25T14:00:00Z' }],
      preferences: [{ person_id: ANA, plan_id: 'plan-1', team_id: TEAM, codes: ['availability_unknown'] }],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices[0]).toMatchObject({ person_id: ANA, preference_codes: ['availability_unknown'] });
    expect(result.choices[0]!.metrics?.has_preference_warning).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('never proposes the same person twice on one plan', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01', [
        { team_id: TEAM, position_id: DRUMS, needed: 1 },
        { team_id: TEAM, position_id: KEYS, needed: 1 },
      ])],
      memberships: [{ person_id: ANA, team_id: TEAM, position_id: DRUMS }, { person_id: ANA, team_id: TEAM, position_id: KEYS }],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices).toHaveLength(1);
    expect(result.vacancies[0]).toMatchObject({ code: 'all_candidates_excluded', exclusion_counts: { already_chosen_on_plan: 1 } });
  });
});

describe('runStaffingProposal preserved work and reviewer edits', () => {
  it('keeps confirmed and prepared requests and fills only the remaining need', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01', [{ team_id: TEAM, position_id: DRUMS, needed: 2 }])],
      assignments: [
        { id: 'a-1', plan_id: 'plan-1', person_id: ANA, team_id: TEAM, position_id: DRUMS, status: 'confirmed', visibility: 'released' },
        { id: 'a-2', plan_id: 'plan-1', person_id: BEN, team_id: TEAM, position_id: DRUMS, status: 'declined', visibility: 'released' },
      ],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(picks(result)).toEqual(['plan-1:p-ana:existing', 'plan-1:p-cal:fairness']);
    expect(proposalChoicesToCreate(result).map((choice) => choice.person_id)).toEqual([CAL]);
  });

  it('keeps every existing request even when it exceeds the need', () => {
    const snapshot = baseSnapshot({
      plans: [plan('plan-1', '2026-11-01')],
      assignments: [ANA, BEN].map((person_id, index) => ({ id: `a-${index}`, plan_id: 'plan-1', person_id, team_id: TEAM, position_id: DRUMS, status: 'unconfirmed' as const, visibility: 'released' as const })),
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.summary).toEqual({ slots: 2, existing: 2, proposed: 0, vacant: 0 });
  });

  it('keeps a lock across recomputation and treats an invalid lock as an explained vacancy', () => {
    const snapshot = baseSnapshot();
    const edits: StaffingProposalEdits = { locks: [{ plan_id: 'plan-1', position_id: DRUMS, person_id: BEN }], exclusions: [] };
    const first = runStaffingProposal({ snapshot, edits, seed: 's' });
    expect(first.choices.find((choice) => choice.plan_id === 'plan-1')).toMatchObject({ person_id: BEN, source: 'locked' });

    const blocked = runStaffingProposal({ snapshot: { ...snapshot, unavailable: [{ person_id: BEN, plan_id: 'plan-1', code: 'blockout' }] }, edits, seed: 's' });
    expect(blocked.choices.some((choice) => choice.plan_id === 'plan-1')).toBe(false);
    expect(blocked.vacancies).toMatchObject([{ plan_id: 'plan-1', code: 'locked_choice_invalid' }]);
  });

  it('honours reviewer exclusions and lets fairness pick someone else', () => {
    const snapshot = baseSnapshot({ plans: [plan('plan-1', '2026-11-01')] });
    const first = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' }).choices[0]!.person_id;
    const second = runStaffingProposal({ snapshot, edits: { locks: [], exclusions: [{ plan_id: 'plan-1', position_id: DRUMS, person_id: first }] }, seed: 's' });
    expect(second.choices[0]!.person_id).not.toBe(first);
  });
});

describe('rotations', () => {
  const rotation = (overrides: Partial<ProposalSnapshotRotation> = {}): ProposalSnapshotRotation => ({
    id: 'rot', team_id: TEAM, name: 'Drums A/B', revision: 1, cycle_weeks: 2, anchor_date: '2026-11-01',
    substitute_policy: 'vacancy',
    slots: [{ week_index: 0, position_id: DRUMS, person_id: ANA }, { week_index: 1, position_id: DRUMS, person_id: BEN }],
    exceptions: [], ...overrides,
  });

  it('maps civil weeks across a DST change and before the anchor', () => {
    // America/Toronto falls back on 2026-11-01; civil-date arithmetic is unaffected.
    expect(rotationWeekIndex('2026-11-01', '2026-11-01', 2)).toBe(0);
    expect(rotationWeekIndex('2026-11-01', '2026-11-07', 2)).toBe(0);
    expect(rotationWeekIndex('2026-11-01', '2026-11-08', 2)).toBe(1);
    expect(rotationWeekIndex('2026-11-01', '2026-11-15', 2)).toBe(0);
    expect(rotationWeekIndex('2026-11-01', '2026-10-25', 2)).toBe(1);
    expect(rotationWeekIndex('2026-03-01', '2026-03-08', 3)).toBe(1);
  });

  it('follows the repeating pattern with an exception week', () => {
    const snapshot = baseSnapshot({ rotations: [rotation({ exceptions: [{ local_date: '2026-11-15', position_id: DRUMS, person_id: CAL }] })] });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(picks(result)).toEqual(['plan-1:p-ana:rotation', 'plan-2:p-ben:rotation', 'plan-3:p-cal:rotation']);
    expect(result.warnings.some((warning) => warning.code === 'rotation_exception')).toBe(true);
  });

  it('skip exception lets fairness decide that week', () => {
    const r = rotation({ exceptions: [{ local_date: '2026-11-08', position_id: DRUMS, person_id: null }] });
    expect(rotationPick(r, '2026-11-08', DRUMS)).toEqual({ person_ids: [], source: 'skipped', week_index: 1 });
    const result = runStaffingProposal({ snapshot: baseSnapshot({ rotations: [r] }), edits: noEdits, seed: 's' });
    expect(result.choices.find((choice) => choice.plan_id === 'plan-2')!.source).toBe('fairness');
  });

  it('a blocked rotation member leaves an explained vacancy under the vacancy policy', () => {
    const snapshot = baseSnapshot({ rotations: [rotation()], unavailable: [{ person_id: BEN, plan_id: 'plan-2', code: 'blockout' }] });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices.some((choice) => choice.plan_id === 'plan-2')).toBe(false);
    expect(result.vacancies).toMatchObject([{ plan_id: 'plan-2', code: 'rotation_member_unavailable' }]);
  });

  it('a blocked rotation member gets a fair substitute under the fairness policy', () => {
    const snapshot = baseSnapshot({ rotations: [rotation({ substitute_policy: 'fairness' })], unavailable: [{ person_id: BEN, plan_id: 'plan-2', code: 'blockout' }] });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    const choice = result.choices.find((item) => item.plan_id === 'plan-2')!;
    expect(choice.source).toBe('fairness');
    expect(choice.person_id).toBe(CAL);
    expect(result.warnings).toMatchObject([{ code: 'rotation_member_unavailable', person_id: BEN }]);
  });

  it('a rotation member who left the position is reported missing, never assigned', () => {
    const snapshot = baseSnapshot({ rotations: [rotation({ slots: [{ week_index: 0, position_id: DRUMS, person_id: DEE }, { week_index: 1, position_id: DRUMS, person_id: BEN }] })] });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices.some((choice) => choice.person_id === DEE)).toBe(false);
    expect(result.vacancies.filter((vacancy) => vacancy.code === 'rotation_member_missing')).toHaveLength(2);
  });

  it('a locked confirmed request is preserved even when the rotation names someone else', () => {
    const snapshot = baseSnapshot({
      rotations: [rotation()],
      assignments: [{ id: 'a-1', plan_id: 'plan-1', person_id: CAL, team_id: TEAM, position_id: DRUMS, status: 'confirmed', visibility: 'released' }],
    });
    const result = runStaffingProposal({ snapshot, edits: noEdits, seed: 's' });
    expect(result.choices.filter((choice) => choice.plan_id === 'plan-1')).toMatchObject([{ person_id: CAL, source: 'existing' }]);
  });
});
