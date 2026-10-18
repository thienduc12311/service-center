import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import {
  canAccess,
  localDateAt,
  rotationPick,
  runStaffingProposal,
  STAFFING_PROPOSAL_RULE_VERSION,
  type AssignmentStatus,
  type AssignmentVisibility,
  type CommitStaffingProposalInput,
  type CreateStaffingProposalInput,
  type CreateTeamRotationInput,
  type ProposalSnapshotRotation,
  type RecomputeStaffingProposalInput,
  type RotationPreviewEntry,
  type RotationPreviewQuery,
  type StaffingProposal,
  type StaffingProposalCommitResult,
  type StaffingProposalEdits,
  type StaffingProposalNames,
  type StaffingProposalRow,
  type StaffingProposalSnapshot,
  type TeamRotation,
  type TeamRotationExceptionRow,
  type TeamRotationRow,
  type TeamRotationSlotRow,
  type UpdateTeamRotationInput,
} from '@service-center/shared';
import { fromPostgrestError, HttpError } from '../lib/errors.js';
import { raw, unwrap } from '../lib/supabase.js';
import {
  mapProposal,
  mapRotation,
  parseProposalRow,
  ProposalIntegrityError,
  storedResultMatches,
  type ParsedProposalRow,
} from '../model/staffing-proposal.model.js';
import { checkConflicts } from './attendance.js';
import { preferenceWarnings } from './availability.js';

/** Upper bound on distinct candidates in one snapshot; keeps preview bounded. */
const MAX_CANDIDATES = 400;
const CONFLICT_CHUNK = 200;

interface SnapshotPlanRow {
  id: string;
  title: string;
  service_date: string;
  service_type_id: string | null;
  staffing_revision: number;
  position_needs: Array<{ needed: number; position: { id: string; team_id: string } | null }>;
}
interface SnapshotTeamRow { id: string; name: string; service_type_id: string | null }
interface SnapshotPositionRow { id: string; name: string; team_id: string }
interface SnapshotMembershipRow { person_id: string; team_id: string; position_id: string | null }
interface SnapshotPersonRow { id: string; first_name: string; last_name: string | null }
interface SnapshotAssignmentRow {
  id: string; plan_id: string; person_id: string; team_id: string; position_id: string | null;
  status: AssignmentStatus; visibility: AssignmentVisibility;
}
interface ServingRow { person_id: string; plan_id: string; plan: { service_date: string } | null }

interface SnapshotScope {
  plan_ids: readonly string[];
  team_ids: readonly string[];
  lookback_days: number;
  /** `undefined` = every active rotation of the selected teams. */
  rotation_ids?: readonly string[];
}

const fullName = (row: SnapshotPersonRow): string => [row.first_name, row.last_name].filter(Boolean).join(' ');

const organizationTimeZone = async (req: Request): Promise<string> => {
  const org = await unwrap(req.db.from('organizations').select('timezone').eq('id', req.orgId).maybeSingle());
  return org?.timezone ?? 'UTC';
};

const loadRotations = async (req: Request, teamIds: readonly string[], rotationIds?: readonly string[]): Promise<TeamRotation[]> => {
  if (!teamIds.length) return [];
  let query = req.db.from('team_rotations').select('*').eq('organization_id', req.orgId)
    .in('team_id', [...teamIds]).is('archived_at', null).order('name').order('id');
  if (rotationIds) {
    if (!rotationIds.length) return [];
    query = query.in('id', [...rotationIds]);
  }
  const rows = ((await unwrap(query)) ?? []) as TeamRotationRow[];
  return withRotationChildren(req, rows);
};

const withRotationChildren = async (req: Request, rows: readonly TeamRotationRow[]): Promise<TeamRotation[]> => {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const slots = ((await unwrap(req.db.from('team_rotation_slots').select('*').in('rotation_id', ids))) ?? []) as TeamRotationSlotRow[];
  const exceptions = ((await unwrap(req.db.from('team_rotation_exceptions').select('*').in('rotation_id', ids))) ?? []) as TeamRotationExceptionRow[];
  return rows.map((row) => mapRotation(row, slots, exceptions));
};

const toSnapshotRotation = (rotation: TeamRotation): ProposalSnapshotRotation => ({
  id: rotation.id, team_id: rotation.team_id, name: rotation.name, revision: rotation.revision,
  cycle_weeks: rotation.cycle_weeks, anchor_date: rotation.anchor_date, substitute_policy: rotation.substitute_policy,
  slots: rotation.slots,
  exceptions: rotation.exceptions.map((item) => ({ local_date: item.local_date, position_id: item.position_id, person_id: item.person_id })),
});

/**
 * F06 Pass A: capture every proposal input once, through the caller's RLS and
 * effective capabilities. Hidden people/assignments never enter the snapshot;
 * conflicts are stored as redacted codes only.
 */
export const captureSnapshot = async (req: Request, scope: SnapshotScope): Promise<StaffingProposalSnapshot> => {
  const timeZone = await organizationTimeZone(req);
  const plans = ((await unwrap(raw(req.db).from('plans')
    .select('id, title, service_date, service_type_id, staffing_revision, position_needs:plan_position_needs(needed, position:team_positions(id, team_id))')
    .eq('organization_id', req.orgId).in('id', [...scope.plan_ids]))) ?? []) as unknown as SnapshotPlanRow[];
  if (plans.length !== new Set(scope.plan_ids).size) throw HttpError.notFound('One of those plans is unavailable');
  const teams = ((await unwrap(req.db.from('teams').select('id, name, service_type_id')
    .eq('organization_id', req.orgId).in('id', [...scope.team_ids]))) ?? []) as SnapshotTeamRow[];
  if (teams.length !== new Set(scope.team_ids).size) throw HttpError.notFound('One of those teams is unavailable');
  for (const plan of plans) {
    for (const team of teams) {
      if (!canAccess(req.access, 'scheduling.manage', { serviceTypeId: plan.service_type_id, teamId: team.id })) {
        throw HttpError.forbidden(`You cannot schedule ${team.name} on ${plan.title}`);
      }
    }
  }
  const teamIds = teams.map((team) => team.id).sort();

  const memberships = (((await unwrap(req.db.from('team_memberships').select('person_id, team_id, position_id')
    .in('team_id', teamIds).not('position_id', 'is', null))) ?? []) as SnapshotMembershipRow[])
    .filter((row): row is SnapshotMembershipRow & { position_id: string } => row.position_id !== null);
  const assignments = ((await unwrap(req.db.from('assignments')
    .select('id, plan_id, person_id, team_id, position_id, status, visibility')
    .in('plan_id', plans.map((plan) => plan.id)))) ?? []) as SnapshotAssignmentRow[];
  const rotations = await loadRotations(req, teamIds, scope.rotation_ids);

  const candidateIds = [...new Set(memberships.map((row) => row.person_id))].sort();
  if (candidateIds.length > MAX_CANDIDATES) {
    throw HttpError.badRequest(`These teams have more than ${MAX_CANDIDATES} position members; choose fewer teams.`);
  }
  const nameIds = [...new Set([...candidateIds, ...assignments.map((row) => row.person_id),
    ...rotations.flatMap((rotation) => [...rotation.slots.map((slot) => slot.person_id),
      ...rotation.exceptions.flatMap((item) => (item.person_id ? [item.person_id] : []))])])];
  const people: SnapshotPersonRow[] = [];
  for (let start = 0; start < nameIds.length; start += 500) {
    const chunk = nameIds.slice(start, start + 500);
    people.push(...(((await unwrap(req.db.from('people_directory').select('id, first_name, last_name')
      .eq('organization_id', req.orgId).is('archived_at', null).in('id', chunk))) ?? []) as SnapshotPersonRow[]));
  }
  const activeIds = new Set(people.map((person) => person.id));
  const eligibleIds = candidateIds.filter((personId) => activeIds.has(personId));

  // Hard conflicts per (person, plan), all times — the same attendance a proposal commits.
  const candidates = eligibleIds.flatMap((personId) => plans.map((plan) => ({
    key: `${personId}:${plan.id}`, person_id: personId, plan_id: plan.id, attendance_mode: 'all' as const, time_ids: [],
  })));
  const unavailable: StaffingProposalSnapshot['unavailable'] = [];
  for (let start = 0; start < candidates.length; start += CONFLICT_CHUNK) {
    const checked = await checkConflicts({ db: req.db, orgId: req.orgId }, candidates.slice(start, start + CONFLICT_CHUNK));
    for (const conflict of checked.conflicts) {
      if (conflict.severity !== 'blocking') continue;
      const [personId, planId] = conflict.candidate_key.split(':');
      unavailable.push({ person_id: personId!, plan_id: planId!, code: conflict.kind === 'blockout' ? 'blockout' : 'overlapping_commitment' });
    }
  }

  // Soft F03 preferences, only for (plan, team) pairs that have needs.
  const preferences: StaffingProposalSnapshot['preferences'] = [];
  for (const plan of plans) {
    const neededTeams = [...new Set(plan.position_needs.flatMap((need) => (need.position && need.needed > 0 ? [need.position.team_id] : [])))]
      .filter((teamId) => teamIds.includes(teamId)).sort();
    for (const teamId of neededTeams) {
      const personIds = [...new Set(memberships.filter((row) => row.team_id === teamId).map((row) => row.person_id))]
        .filter((personId) => activeIds.has(personId));
      if (!personIds.length) continue;
      const warnings = await preferenceWarnings(
        { db: req.db, orgId: req.orgId, userId: req.auth.userId, access: req.access },
        { plan_id: plan.id, team_id: teamId, person_ids: personIds },
      );
      const byPerson = new Map<string, string[]>();
      for (const warning of warnings) byPerson.set(warning.person_id, [...(byPerson.get(warning.person_id) ?? []), warning.code]);
      for (const [personId, codes] of byPerson) preferences.push({ person_id: personId, plan_id: plan.id, team_id: teamId, codes: [...new Set(codes)].sort() });
    }
  }

  // Caller-visible, non-declined serving in the lookback window before the latest plan.
  const dates = plans.map((plan) => plan.service_date).sort();
  const windowStart = new Date(new Date(dates[0]!).getTime() - scope.lookback_days * 86_400_000).toISOString();
  const serving: StaffingProposalSnapshot['serving'] = [];
  for (let start = 0; start < eligibleIds.length; start += 200) {
    const rows = ((await unwrap(raw(req.db).from('assignments')
      .select('person_id, plan_id, plan:plans!inner(service_date, organization_id)')
      .in('person_id', eligibleIds.slice(start, start + 200)).neq('status', 'declined')
      .eq('plan.organization_id', req.orgId)
      .gte('plan.service_date', windowStart).lt('plan.service_date', dates.at(-1)!))) ?? []) as unknown as ServingRow[];
    for (const row of rows) if (row.plan) serving.push({ person_id: row.person_id, plan_id: row.plan_id, service_date: row.plan.service_date });
  }

  const sortBy = <T>(list: T[], key: (item: T) => string): T[] => list.sort((a, b) => key(a).localeCompare(key(b)));
  return {
    rule_version: STAFFING_PROPOSAL_RULE_VERSION,
    organization_id: req.orgId,
    time_zone: timeZone,
    captured_at: new Date().toISOString(),
    lookback_days: scope.lookback_days,
    team_ids: teamIds,
    plans: sortBy(plans.map((plan) => ({
      id: plan.id, title: plan.title, service_date: plan.service_date, local_date: localDateAt(plan.service_date, timeZone),
      service_type_id: plan.service_type_id, staffing_revision: plan.staffing_revision,
      needs: plan.position_needs
        .flatMap((need) => (need.position && need.needed > 0 && teamIds.includes(need.position.team_id)
          ? [{ team_id: need.position.team_id, position_id: need.position.id, needed: need.needed }] : []))
        .sort((a, b) => a.team_id.localeCompare(b.team_id) || a.position_id.localeCompare(b.position_id)),
    })), (plan) => `${plan.service_date}|${plan.id}`),
    people: sortBy(people.map((person) => ({ id: person.id, full_name: fullName(person) })), (person) => person.id),
    memberships: sortBy(memberships.map((row) => ({ person_id: row.person_id, team_id: row.team_id, position_id: row.position_id })),
      (row) => `${row.team_id}|${row.position_id}|${row.person_id}`),
    assignments: sortBy(assignments.map((row) => ({ id: row.id, plan_id: row.plan_id, person_id: row.person_id, team_id: row.team_id,
      position_id: row.position_id, status: row.status, visibility: row.visibility })), (row) => row.id),
    unavailable: sortBy(unavailable, (row) => `${row.person_id}|${row.plan_id}|${row.code}`),
    preferences: sortBy(preferences, (row) => `${row.person_id}|${row.plan_id}|${row.team_id}`),
    serving: sortBy(serving, (row) => `${row.person_id}|${row.plan_id}`),
    rotations: rotations.map(toSnapshotRotation),
  };
};

const loadNames = async (req: Request, teamIds: readonly string[]): Promise<StaffingProposalNames> => {
  if (!teamIds.length) return { teams: {}, positions: {} };
  const teams = ((await unwrap(req.db.from('teams').select('id, name').in('id', [...teamIds]))) ?? []) as Array<{ id: string; name: string }>;
  const positions = ((await unwrap(req.db.from('team_positions').select('id, name, team_id').in('team_id', [...teamIds]))) ?? []) as SnapshotPositionRow[];
  return {
    teams: Object.fromEntries(teams.map((team) => [team.id, team.name])),
    positions: Object.fromEntries(positions.map((position) => [position.id, position.name])),
  };
};

const loadParsed = async (req: Request, proposalId: string): Promise<ParsedProposalRow> => {
  const row = (await unwrap(req.db.from('staffing_proposals').select('*').eq('id', proposalId)
    .eq('organization_id', req.orgId).eq('author_id', req.auth.userId).maybeSingle())) as StaffingProposalRow | null;
  if (!row) throw HttpError.notFound('Proposal not found');
  try {
    return parseProposalRow(row);
  } catch (error) {
    if (error instanceof ProposalIntegrityError) throw HttpError.conflict(error.message);
    throw error;
  }
};

const present = async (req: Request, parsed: ParsedProposalRow): Promise<StaffingProposal> =>
  mapProposal(parsed, await loadNames(req, parsed.snapshot.team_ids));

const newSeed = (): string => randomBytes(9).toString('base64url');

const insertProposal = async (
  req: Request,
  snapshot: StaffingProposalSnapshot,
  seed: string,
  edits: StaffingProposalEdits,
): Promise<ParsedProposalRow> => {
  const result = runStaffingProposal({ snapshot, edits, seed });
  const row = (await unwrap(raw(req.db).from('staffing_proposals').insert({
    organization_id: req.orgId,
    author_id: req.auth.userId,
    rule_version: STAFFING_PROPOSAL_RULE_VERSION,
    seed,
    lookback_days: snapshot.lookback_days,
    plan_ids: snapshot.plans.map((plan) => plan.id),
    team_ids: snapshot.team_ids,
    base_revisions: snapshot.plans.map((plan) => ({ plan_id: plan.id, staffing_revision: plan.staffing_revision }))
      .sort((a, b) => a.plan_id.localeCompare(b.plan_id)),
    rotation_versions: snapshot.rotations.map((rotation) => ({ rotation_id: rotation.id, revision: rotation.revision })),
    snapshot,
    edits,
    result,
  }).select('*').single())) as StaffingProposalRow;
  return parseProposalRow(row);
};

export const createProposal = async (req: Request, input: CreateStaffingProposalInput): Promise<StaffingProposal> => {
  const snapshot = await captureSnapshot(req, input);
  const parsed = await insertProposal(req, snapshot, input.seed ?? newSeed(), { locks: input.locks, exclusions: input.exclusions });
  return present(req, parsed);
};

export const getProposal = async (req: Request, proposalId: string): Promise<StaffingProposal> =>
  present(req, await loadParsed(req, proposalId));

export const listProposals = async (req: Request): Promise<StaffingProposal[]> => {
  const rows = ((await unwrap(req.db.from('staffing_proposals').select('*').eq('organization_id', req.orgId)
    .eq('author_id', req.auth.userId).eq('status', 'draft').order('created_at', { ascending: false }).limit(10))) ?? []) as StaffingProposalRow[];
  const parsed = rows.flatMap((row) => {
    try { return [parseProposalRow(row)]; } catch (error) {
      if (error instanceof ProposalIntegrityError) return [];
      throw error;
    }
  });
  const names = await loadNames(req, [...new Set(parsed.flatMap((item) => item.snapshot.team_ids))]);
  return parsed.map((item) => mapProposal(item, names));
};

const assertDraft = (parsed: ParsedProposalRow, expectedRevision: number): void => {
  if (parsed.row.status !== 'draft') throw new HttpError(409, 'This proposal is no longer a draft', 'proposal_changed');
  if (Number(parsed.row.revision) !== expectedRevision) throw new HttpError(409, 'The proposal changed since you reviewed it', 'proposal_changed');
  if (new Date(parsed.row.expires_at).getTime() <= Date.now()) {
    throw new HttpError(409, 'This proposal expired. Refresh it to recompute from current staffing.', 'proposal_expired');
  }
};

/** Pass B: rerun the engine on the same immutable snapshot with the reviewer's locks/exclusions. */
export const recomputeProposal = async (req: Request, proposalId: string, input: RecomputeStaffingProposalInput): Promise<StaffingProposal> => {
  const parsed = await loadParsed(req, proposalId);
  assertDraft(parsed, input.expected_revision);
  const planIds = new Set(parsed.snapshot.plans.map((plan) => plan.id));
  if ([...input.edits.locks, ...input.edits.exclusions].some((edit) => !planIds.has(edit.plan_id))) {
    throw HttpError.badRequest('A lock or exclusion is outside this proposal');
  }
  const result = runStaffingProposal({ snapshot: parsed.snapshot, edits: input.edits, seed: parsed.row.seed });
  const updated = (await unwrap(raw(req.db).from('staffing_proposals')
    .update({ edits: input.edits, result, revision: input.expected_revision + 1 })
    .eq('id', proposalId).eq('revision', input.expected_revision).eq('status', 'draft').select('*').maybeSingle())) as StaffingProposalRow | null;
  if (!updated) throw new HttpError(409, 'The proposal changed since you reviewed it', 'proposal_changed');
  return present(req, parseProposalRow(updated));
};

/** Capture a fresh snapshot (same scope, seed and edits) and supersede the old draft. */
export const refreshProposal = async (req: Request, proposalId: string): Promise<StaffingProposal> => {
  const parsed = await loadParsed(req, proposalId);
  if (parsed.row.status !== 'draft') throw new HttpError(409, 'Only a draft proposal can be refreshed', 'proposal_changed');
  const snapshot = await captureSnapshot(req, {
    plan_ids: parsed.row.plan_ids, team_ids: parsed.row.team_ids, lookback_days: parsed.row.lookback_days,
    rotation_ids: parsed.rotationVersions.map((item) => item.rotation_id),
  });
  const planIds = new Set(snapshot.plans.map((plan) => plan.id));
  const edits: StaffingProposalEdits = {
    locks: parsed.edits.locks.filter((lock) => planIds.has(lock.plan_id)),
    exclusions: parsed.edits.exclusions.filter((item) => planIds.has(item.plan_id)),
  };
  const fresh = await insertProposal(req, snapshot, parsed.row.seed, edits);
  const superseded = await unwrap(raw(req.db).from('staffing_proposals')
    .update({ status: 'superseded', superseded_by: fresh.row.id })
    .eq('id', proposalId).eq('status', 'draft').select('id').maybeSingle());
  if (!superseded) throw new HttpError(409, 'The proposal changed while refreshing', 'proposal_changed');
  return present(req, fresh);
};

/** Pass C: atomic, idempotent prepared commit (all rechecks happen in the database). */
export const commitProposal = async (
  req: Request,
  proposalId: string,
  input: CommitStaffingProposalInput,
): Promise<StaffingProposalCommitResult> => {
  const parsed = await loadParsed(req, proposalId);
  if (parsed.row.status === 'draft' && !storedResultMatches(parsed)) {
    throw new HttpError(409, 'The stored proposal does not match its inputs. Recompute before committing.', 'proposal_changed');
  }
  const { data, error } = await raw(req.db).rpc('commit_staffing_proposal', {
    p_proposal_id: proposalId,
    p_expected_revision: input.expected_revision,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  const value = data as Partial<StaffingProposalCommitResult> | null;
  if (!value?.proposal_id || !value.committed_at) throw new HttpError(500, 'The commit returned no result');
  return {
    proposal_id: value.proposal_id,
    committed_at: value.committed_at,
    assignment_ids: value.assignment_ids ?? [],
    affected_plan_ids: value.affected_plan_ids ?? [],
    visibility: 'prepared',
  };
};

// ------------------------------------------------------------ rotations --

export const listRotations = async (req: Request, teamId: string | null, includeArchived: boolean): Promise<TeamRotation[]> => {
  let query = req.db.from('team_rotations').select('*').eq('organization_id', req.orgId).order('name').order('id');
  if (teamId) query = query.eq('team_id', teamId);
  if (!includeArchived) query = query.is('archived_at', null);
  return withRotationChildren(req, ((await unwrap(query)) ?? []) as TeamRotationRow[]);
};

export const getRotation = async (req: Request, rotationId: string): Promise<TeamRotation> => {
  const row = (await unwrap(req.db.from('team_rotations').select('*').eq('id', rotationId)
    .eq('organization_id', req.orgId).maybeSingle())) as TeamRotationRow | null;
  if (!row) throw HttpError.notFound('Rotation not found');
  const [rotation] = await withRotationChildren(req, [row]);
  return rotation!;
};

const saveRotation = async (
  req: Request,
  rotationId: string | null,
  teamId: string | null,
  expectedRevision: number,
  input: CreateTeamRotationInput | UpdateTeamRotationInput,
): Promise<TeamRotation> => {
  const { data, error } = await raw(req.db).rpc('save_team_rotation', {
    p_rotation_id: rotationId,
    p_team_id: teamId,
    p_expected_revision: expectedRevision,
    p_name: input.name,
    p_cycle_weeks: input.cycle_weeks,
    p_anchor_date: input.anchor_date,
    p_substitute_policy: input.substitute_policy,
    p_slots: input.slots,
    p_exceptions: input.exceptions,
  });
  if (error) {
    if (error.code === '23505') throw HttpError.conflict('Another active rotation on this team has that name');
    throw fromPostgrestError(error);
  }
  return getRotation(req, (data as TeamRotationRow).id);
};

export const createRotation = (req: Request, input: CreateTeamRotationInput): Promise<TeamRotation> =>
  saveRotation(req, null, input.team_id, 0, input);

export const updateRotation = (req: Request, rotationId: string, input: UpdateTeamRotationInput): Promise<TeamRotation> =>
  saveRotation(req, rotationId, null, input.expected_revision, input);

export const archiveRotation = async (req: Request, rotationId: string, expectedRevision: number): Promise<void> => {
  const { error } = await raw(req.db).rpc('archive_team_rotation', { p_rotation_id: rotationId, p_expected_revision: expectedRevision });
  if (error) throw fromPostgrestError(error);
};

interface PreviewPlanRow {
  id: string; title: string; service_date: string; service_type_id: string | null;
  position_needs: Array<{ needed: number; position_id: string }>;
}

/** Map a rotation onto actual plan dates (local weeks), flagging people it could not use. */
export const previewRotation = async (req: Request, rotationId: string, query: RotationPreviewQuery): Promise<RotationPreviewEntry[]> => {
  const rotation = await getRotation(req, rotationId);
  const timeZone = await organizationTimeZone(req);
  const positionIds = [...new Set([...rotation.slots.map((slot) => slot.position_id), ...rotation.exceptions.map((item) => item.position_id)])];
  if (!positionIds.length) return [];
  const plans = ((await unwrap(raw(req.db).from('plans')
    .select('id, title, service_date, service_type_id, position_needs:plan_position_needs!inner(needed, position_id)')
    .eq('organization_id', req.orgId).gte('service_date', query.from).lte('service_date', query.to)
    .in('plan_position_needs.position_id', positionIds).order('service_date').order('id').limit(60))) ?? []) as unknown as PreviewPlanRow[];
  const memberships = ((await unwrap(req.db.from('team_memberships').select('person_id, position_id')
    .eq('team_id', rotation.team_id).in('position_id', positionIds))) ?? []) as Array<{ person_id: string; position_id: string }>;
  const members = new Set(memberships.map((row) => `${row.person_id}:${row.position_id}`));
  const snapshotRotation = toSnapshotRotation(rotation);
  const planned = plans.flatMap((plan) => {
    const localDate = localDateAt(plan.service_date, timeZone);
    return plan.position_needs.filter((need) => need.needed > 0 && positionIds.includes(need.position_id)).flatMap((need) => {
      const pick = rotationPick(snapshotRotation, localDate, need.position_id);
      const people = pick.person_ids.length ? pick.person_ids : [null];
      return people.map((personId) => ({ plan, localDate, positionId: need.position_id, personId, pick }));
    });
  });
  const personIds = [...new Set(planned.flatMap((item) => (item.personId ? [item.personId] : [])))];
  const people = personIds.length
    ? ((await unwrap(req.db.from('people_directory').select('id, first_name, last_name').in('id', personIds))) ?? []) as SnapshotPersonRow[]
    : [];
  const names = new Map(people.map((person) => [person.id, fullName(person)]));
  const conflictCandidates = planned.flatMap((item) => (item.personId
    ? [{ key: `${item.personId}:${item.plan.id}`, person_id: item.personId, plan_id: item.plan.id, attendance_mode: 'all' as const, time_ids: [] }]
    : []));
  const blocking = new Map<string, 'blockout' | 'overlapping_commitment'>();
  for (let start = 0; start < conflictCandidates.length; start += CONFLICT_CHUNK) {
    const checked = await checkConflicts({ db: req.db, orgId: req.orgId }, conflictCandidates.slice(start, start + CONFLICT_CHUNK));
    for (const conflict of checked.conflicts) {
      if (conflict.severity === 'blocking' && !blocking.has(conflict.candidate_key)) {
        blocking.set(conflict.candidate_key, conflict.kind === 'blockout' ? 'blockout' : 'overlapping_commitment');
      }
    }
  }
  return planned.map((item) => ({
    plan_id: item.plan.id,
    plan_title: item.plan.title,
    service_date: item.plan.service_date,
    local_date: item.localDate,
    week_index: item.pick.week_index,
    position_id: item.positionId,
    person_id: item.personId,
    person_name: item.personId ? names.get(item.personId) ?? null : null,
    source: item.pick.source,
    issue: !item.personId ? null
      : !members.has(`${item.personId}:${item.positionId}`) ? 'not_position_member'
        : blocking.get(`${item.personId}:${item.plan.id}`) ?? null,
  }));
};
