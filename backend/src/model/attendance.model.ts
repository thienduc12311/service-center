import type {
  AttendanceConflict,
  AttendanceInterval,
  AttendanceIntervalSource,
  ConflictCheckResult,
  ConflictKind,
  ConflictSeverity,
  PlanTimeImpact,
  PlanTimeKind,
  PlanTimeRow,
} from '@service-center/shared';

/** A plan time as the editor sends it; `id` may be missing from older clients. */
export interface PlanTimeDraft {
  id?: string;
  kind: PlanTimeKind;
  name?: string | null;
  starts_at: string;
  ends_at: string;
  sort_order?: number;
}

/** A plan time with the stable identity the database requires. */
export interface IdentifiedPlanTime {
  id: string;
  kind: PlanTimeKind;
  name: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
}

const sameInstant = (a: string, b: string): boolean => new Date(a).getTime() === new Date(b).getTime();

/**
 * Legacy adapter for editors that send times without ids. A time without an
 * id keeps the identity of an unclaimed existing time with the same kind,
 * start and end (an unchanged time); anything else is genuinely new. List
 * position is never identity, so a reorder or an edit cannot move someone's
 * selected time onto another time.
 */
export const assignLegacyTimeIds = (
  drafts: readonly PlanTimeDraft[],
  existing: readonly Pick<PlanTimeRow, 'id' | 'kind' | 'starts_at' | 'ends_at'>[],
  newId: () => string,
): IdentifiedPlanTime[] => {
  const claimed = new Set(drafts.flatMap((draft) => (draft.id ? [draft.id] : [])));
  return drafts.map((draft, index) => {
    let id = draft.id;
    if (!id) {
      const match = existing.find(
        (time) =>
          !claimed.has(time.id) &&
          time.kind === draft.kind &&
          sameInstant(time.starts_at, draft.starts_at) &&
          sameInstant(time.ends_at, draft.ends_at),
      );
      id = match?.id ?? newId();
      claimed.add(id);
    }
    return {
      id,
      kind: draft.kind,
      name: draft.name?.trim() || null,
      starts_at: draft.starts_at,
      ends_at: draft.ends_at,
      sort_order: draft.sort_order ?? index,
    };
  });
};

/** Raw conflict row from `check_assignment_conflicts` or a PT409 detail. */
export interface RawConflictRow {
  candidate_key: string;
  person_id: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  plan_time_id: string | null;
  interval_source: AttendanceIntervalSource;
  starts_at: string;
  ends_at: string;
  other_plan_id: string | null;
  other_assignment_id: string | null;
  other_plan_time_id: string | null;
  other_time_kind: PlanTimeKind | null;
  detail: string;
  redacted: boolean;
  override_permitted?: boolean;
}

export const toConflict = (row: RawConflictRow): AttendanceConflict => ({
  candidate_key: row.candidate_key,
  person_id: row.person_id,
  kind: row.kind,
  severity: row.severity,
  plan_time_id: row.plan_time_id,
  interval_source: row.interval_source,
  starts_at: row.starts_at,
  ends_at: row.ends_at,
  other_plan_id: row.other_plan_id,
  other_assignment_id: row.other_assignment_id,
  other_plan_time_id: row.other_plan_time_id,
  other_time_kind: row.other_time_kind,
  detail: row.detail,
  redacted: row.redacted,
  ...(row.override_permitted === undefined ? {} : { override_permitted: row.override_permitted }),
});

/** Which candidates are blocked, and whether the caller may override all of them. */
export const summarizeConflicts = (conflicts: readonly AttendanceConflict[]): ConflictCheckResult => {
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  return {
    conflicts: [...conflicts],
    blocked_candidates: [...new Set(blocking.map((conflict) => conflict.candidate_key))],
    override_permitted: blocking.every((conflict) => conflict.override_permitted !== false),
  };
};

const CONFLICT_KINDS: readonly ConflictKind[] = ['blockout', 'overlapping_commitment'];
const SEVERITIES: readonly ConflictSeverity[] = ['blocking', 'warning'];
const SOURCES: readonly AttendanceIntervalSource[] = ['plan_time', 'untimed_fallback'];
const TIME_KINDS: readonly PlanTimeKind[] = ['service', 'rehearsal', 'other'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;

/**
 * The commit-time trigger reports conflicts as JSON in the error detail.
 * Parsed defensively from `unknown`; anything malformed is dropped rather than
 * forwarded.
 */
export const parseConflictDetail = (detail: string | null | undefined): AttendanceConflict[] => {
  if (!detail) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch (error) {
    if (error instanceof SyntaxError) return [];
    throw error;
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry): AttendanceConflict[] => {
    if (!isRecord(entry)) return [];
    const kind = oneOf(CONFLICT_KINDS, entry.kind);
    const severity = oneOf(SEVERITIES, entry.severity);
    const source = oneOf(SOURCES, entry.interval_source);
    const personId = stringOrNull(entry.person_id);
    const startsAt = stringOrNull(entry.starts_at);
    const endsAt = stringOrNull(entry.ends_at);
    if (!kind || !severity || !source || !personId || !startsAt || !endsAt) return [];
    return [{
      candidate_key: stringOrNull(entry.candidate_key) ?? personId,
      person_id: personId,
      kind,
      severity,
      plan_time_id: stringOrNull(entry.plan_time_id),
      interval_source: source,
      starts_at: startsAt,
      ends_at: endsAt,
      other_plan_id: stringOrNull(entry.other_plan_id),
      other_assignment_id: stringOrNull(entry.other_assignment_id),
      other_plan_time_id: stringOrNull(entry.other_plan_time_id),
      other_time_kind: oneOf(TIME_KINDS, entry.other_time_kind),
      detail: stringOrNull(entry.detail) ?? 'Unavailable',
      redacted: entry.redacted === true,
    }];
  });
};

/** Groups resolver rows by assignment, in time order. */
export const groupAttendance = (rows: readonly AttendanceInterval[]): Map<string, AttendanceInterval[]> => {
  const grouped = new Map<string, AttendanceInterval[]>();
  for (const row of rows) grouped.set(row.assignment_id, [...(grouped.get(row.assignment_id) ?? []), row]);
  for (const list of grouped.values()) {
    list.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }
  return grouped;
};

/** The stored plan times an assignment covers (fallback intervals have none). */
export const timesForAttendance = (
  attendance: readonly AttendanceInterval[],
  times: readonly PlanTimeRow[],
): PlanTimeRow[] => {
  const ids = new Set(attendance.flatMap((interval) => (interval.plan_time_id ? [interval.plan_time_id] : [])));
  return times
    .filter((time) => ids.has(time.id))
    .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
};

export const isUntimed = (attendance: readonly AttendanceInterval[]): boolean =>
  attendance.length > 0 && attendance.every((interval) => interval.source === 'untimed_fallback');

/** Conflict-check candidate with explicit intervals (a proposed time list). */
export interface IntervalCandidate {
  key: string;
  person_id: string;
  plan_id: string;
  team_id: string | null;
  position_id: string | null;
  intervals: Array<{ plan_time_id: string; starts_at: string; ends_at: string }>;
}

/**
 * For a time-edit preview: each visible affected request is checked with the
 * proposed intervals of only the times it gains or that move, so an overlap
 * that already existed is not reported as new.
 */
export const impactConflictCandidates = (
  impact: Pick<PlanTimeImpact, 'plan_id' | 'assignments'>,
  proposed: readonly IdentifiedPlanTime[],
): IntervalCandidate[] => {
  const byId = new Map(proposed.map((time) => [time.id, time]));
  return impact.assignments
    .filter((assignment) => assignment.gains.length > 0 || assignment.changed.length > 0)
    .map((assignment) => ({
      key: assignment.assignment_id,
      person_id: assignment.person_id,
      plan_id: impact.plan_id,
      team_id: assignment.team_id,
      position_id: assignment.position_id,
      intervals: [...new Set([...assignment.gains, ...assignment.changed])].flatMap((timeId) => {
        const time = byId.get(timeId);
        return time ? [{ plan_time_id: time.id, starts_at: time.starts_at, ends_at: time.ends_at }] : [];
      }),
    }))
    .filter((candidate) => candidate.intervals.length > 0);
};

/** ICS SEQUENCE for one recipient: the time's own sequence plus their offset. */
export const recipientSequence = (icsSequence: number, offset: number | null | undefined): number =>
  icsSequence + (offset ?? 0);
