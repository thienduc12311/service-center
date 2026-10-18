import {
  describeProposalPolicy,
  proposalBaseRevisionsSchema,
  proposalEditsSchema,
  proposalRotationVersionsSchema,
  proposalSnapshotSchema,
  runStaffingProposal,
  STAFFING_PROPOSAL_RULE_VERSION,
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
} from '@service-center/shared';

/** A stored proposal after its JSON columns were validated from `unknown`. */
export interface ParsedProposalRow {
  row: StaffingProposalRow;
  snapshot: StaffingProposalSnapshot;
  edits: StaffingProposalEdits;
  baseRevisions: Array<{ plan_id: string; staffing_revision: number }>;
  rotationVersions: Array<{ rotation_id: string; revision: number }>;
}

export class ProposalIntegrityError extends Error {}

export const parseProposalRow = (row: StaffingProposalRow): ParsedProposalRow => {
  const snapshot = proposalSnapshotSchema.safeParse(row.snapshot);
  const edits = proposalEditsSchema.safeParse(row.edits);
  const revisions = proposalBaseRevisionsSchema.safeParse(row.base_revisions);
  const rotations = proposalRotationVersionsSchema.safeParse(row.rotation_versions);
  if (!snapshot.success || !edits.success || !revisions.success || !rotations.success
      || row.rule_version !== STAFFING_PROPOSAL_RULE_VERSION) {
    throw new ProposalIntegrityError('This proposal was saved by another rule version or is malformed. Create a new proposal.');
  }
  return { row, snapshot: snapshot.data, edits: edits.data, baseRevisions: revisions.data, rotationVersions: rotations.data };
};

/** Commit results are written by the database function; narrow them before returning. */
const toCommitResult = (value: unknown): StaffingProposalCommitResult | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const strings = (input: unknown): string[] => (Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : []);
  if (typeof record.proposal_id !== 'string' || typeof record.committed_at !== 'string') return null;
  return {
    proposal_id: record.proposal_id,
    committed_at: record.committed_at,
    assignment_ids: strings(record.assignment_ids),
    affected_plan_ids: strings(record.affected_plan_ids),
    visibility: 'prepared',
  };
};

/**
 * Domain view of a proposal. The result is re-derived from the validated
 * snapshot, edits and seed, so what a reviewer sees is exactly what the pure
 * engine produces for those inputs.
 */
export const mapProposal = (parsed: ParsedProposalRow, names: StaffingProposalNames, now: Date = new Date()): StaffingProposal => {
  const { row, snapshot, edits } = parsed;
  return {
    id: row.id,
    status: row.status,
    revision: row.revision,
    rule_version: STAFFING_PROPOSAL_RULE_VERSION,
    seed: row.seed,
    input_hash: row.input_hash,
    author_id: row.author_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= now.getTime(),
    committed_at: row.committed_at,
    superseded_by: row.superseded_by,
    lookback_days: row.lookback_days,
    team_ids: row.team_ids,
    plans: [...snapshot.plans]
      .sort((a, b) => a.service_date.localeCompare(b.service_date) || a.id.localeCompare(b.id))
      .map((plan) => ({ id: plan.id, title: plan.title, service_date: plan.service_date, local_date: plan.local_date, staffing_revision: plan.staffing_revision })),
    names,
    rotations: snapshot.rotations.map((rotation) => ({ id: rotation.id, name: rotation.name, revision: rotation.revision, team_id: rotation.team_id })),
    edits,
    result: runStaffingProposal({ snapshot, edits, seed: row.seed }),
    policy: describeProposalPolicy(snapshot.lookback_days),
    commit_result: toCommitResult(row.commit_result),
  };
};

/** JSON with object keys sorted recursively (jsonb does not keep insertion order). */
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** True when the stored result is exactly what the engine produces now (guards forged rows). */
export const storedResultMatches = (parsed: ParsedProposalRow): boolean =>
  canonicalJson(parsed.row.result)
    === canonicalJson(runStaffingProposal({ snapshot: parsed.snapshot, edits: parsed.edits, seed: parsed.row.seed }));

export const mapRotation = (
  row: TeamRotationRow,
  slots: readonly TeamRotationSlotRow[],
  exceptions: readonly TeamRotationExceptionRow[],
): TeamRotation => ({
  id: row.id,
  organization_id: row.organization_id,
  team_id: row.team_id,
  name: row.name,
  cycle_weeks: row.cycle_weeks,
  anchor_date: row.anchor_date,
  substitute_policy: row.substitute_policy,
  revision: Number(row.revision),
  archived_at: row.archived_at,
  created_by: row.created_by,
  created_at: row.created_at,
  updated_at: row.updated_at,
  slots: slots
    .filter((slot) => slot.rotation_id === row.id)
    .map((slot) => ({ week_index: slot.week_index, position_id: slot.position_id, person_id: slot.person_id }))
    .sort((a, b) => a.week_index - b.week_index || a.position_id.localeCompare(b.position_id) || a.person_id.localeCompare(b.person_id)),
  exceptions: exceptions
    .filter((item) => item.rotation_id === row.id)
    .map((item) => ({ local_date: item.local_date, position_id: item.position_id, person_id: item.person_id, note: item.note }))
    .sort((a, b) => a.local_date.localeCompare(b.local_date) || a.position_id.localeCompare(b.position_id)),
});
