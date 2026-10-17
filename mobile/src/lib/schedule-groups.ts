import type {
  AssignmentDetail,
  AssignmentStatus,
  MyScheduleEntry,
  PlanTimeRow,
  TeamPositionRow,
  TeamRow,
} from '@service-center/shared';

/** One position a person holds on a plan, with their own answer to it. */
export interface ScheduleResponsibility {
  assignmentId: string;
  status: AssignmentStatus;
  /** Exact per-time answers may differ even though the legacy aggregate is pending. */
  scopeStatus: ScheduleGroupStatus;
  /** The person's own reason for a decline; only on My Schedule, which may read it. */
  responseNote: string | null;
  /** The scheduler's note to the person. */
  notes: string | null;
  requestRevision: number;
  timeResponses: MyScheduleEntry['time_responses'];
  team: Pick<TeamRow, 'id' | 'name' | 'color'> | null;
  position: Pick<TeamPositionRow, 'id' | 'name'> | null;
}

/** A plan time, listed once however many positions need the person there. */
export interface ScheduleTime {
  id: string;
  kind: PlanTimeRow['kind'];
  name: string | null;
  startsAt: string;
  endsAt: string;
  /** Assignment IDs of the positions that need this time. */
  requiredBy: string[];
}

/** Several positions answered differently, so no single status is truthful. */
export type ScheduleGroupStatus = AssignmentStatus | 'mixed';

/** Everything one person is doing at one plan, as a single card. */
export interface SchedulePlanGroup {
  /** Stable across refetches: organization, person and plan. */
  key: string;
  organizationId: string;
  personId: string;
  plan: MyScheduleEntry['plan'];
  /** When the service actually starts; falls back to the plan's date. */
  startsAt: string;
  responsibilities: ScheduleResponsibility[];
  times: ScheduleTime[];
  status: ScheduleGroupStatus;
  pendingCount: number;
}

export type ScheduleFilter = 'all' | 'pending' | 'confirmed' | 'declined';
export type ScheduleWindow = 'upcoming' | 'history';

/** Query parameters `GET /schedule/mine` supports for each window. */
export type ScheduleWindowQuery = {
  include_past?: 'true';
  from?: string;
  to?: string;
};

const FILTER_STATUS: Record<Exclude<ScheduleFilter, 'all'>, AssignmentStatus> = {
  pending: 'unconfirmed',
  confirmed: 'confirmed',
  declined: 'declined',
};

/** How far back History looks; the endpoint has no paging yet. */
export const SCHEDULE_HISTORY_DAYS = 365;

export const scheduleWindowQuery = (window: ScheduleWindow, now: Date): ScheduleWindowQuery => {
  if (window === 'upcoming') return {};
  const from = new Date(now.getTime() - SCHEDULE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  return { include_past: 'true', from: from.toISOString(), to: now.toISOString() };
};

export const groupStatus = (statuses: readonly ScheduleGroupStatus[]): ScheduleGroupStatus => {
  const distinct = new Set(statuses);
  if (distinct.size === 1) return statuses[0]!;
  return 'mixed';
};

const byTeamThenPosition = (a: ScheduleResponsibility, b: ScheduleResponsibility): number =>
  (a.team?.name ?? '').localeCompare(b.team?.name ?? '') ||
  (a.position?.name ?? '').localeCompare(b.position?.name ?? '') ||
  a.assignmentId.localeCompare(b.assignmentId);

const byStart = (a: { startsAt: string }, b: { startsAt: string }): number =>
  new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();

/** Service start if there is one, else the earliest time, else the plan date. */
const serviceStart = (times: readonly ScheduleTime[], serviceDate: string): string =>
  times.find((time) => time.kind === 'service')?.startsAt ?? times[0]?.startsAt ?? serviceDate;

interface TimeSource {
  assignmentId: string;
  times: readonly PlanTimeRow[];
}

/** Deduplicates times by ID while remembering every position that needs each. */
export const mergeTimes = (sources: readonly TimeSource[]): ScheduleTime[] => {
  const merged = new Map<string, ScheduleTime>();
  for (const source of sources) {
    for (const time of source.times) {
      const existing = merged.get(time.id);
      if (existing) {
        if (!existing.requiredBy.includes(source.assignmentId)) {
          existing.requiredBy.push(source.assignmentId);
        }
        continue;
      }
      merged.set(time.id, {
        id: time.id,
        kind: time.kind,
        name: time.name,
        startsAt: time.starts_at,
        endsAt: time.ends_at,
        requiredBy: [source.assignmentId],
      });
    }
  }
  return [...merged.values()].sort(byStart);
};

const toResponsibility = (
  assignment: MyScheduleEntry['assignment'],
  team: ScheduleResponsibility['team'],
  position: ScheduleResponsibility['position'],
  responseNote: string | null,
  timeResponses: MyScheduleEntry['time_responses'] = [],
): ScheduleResponsibility => {
  const exactStatuses = timeResponses.map((response) => response.status);
  return {
    assignmentId: assignment.id,
    status: assignment.status,
    scopeStatus: exactStatuses.length ? groupStatus(exactStatuses) : assignment.status,
    responseNote,
    notes: assignment.notes,
    requestRevision: assignment.request_revision,
    timeResponses,
    team,
    position,
  };
};

const summarize = (
  responsibilities: ScheduleResponsibility[],
): Pick<SchedulePlanGroup, 'status' | 'pendingCount'> => ({
  status: groupStatus(responsibilities.map((item) => item.scopeStatus)),
  pendingCount: responsibilities.filter((item) => item.status === 'unconfirmed').length,
});

/**
 * Turns per-assignment schedule rows into one card per person per plan, so a
 * person on two teams or two positions sees every responsibility together.
 */
export const groupSchedule = (
  entries: readonly MyScheduleEntry[],
  organizationId: string,
  window: ScheduleWindow = 'upcoming',
): SchedulePlanGroup[] => {
  const buckets = new Map<string, MyScheduleEntry[]>();
  for (const entry of entries) {
    const key = `${organizationId}:${entry.assignment.person_id}:${entry.plan.id}`;
    const bucket = buckets.get(key);
    if (bucket) {
      if (!bucket.some((existing) => existing.assignment.id === entry.assignment.id)) bucket.push(entry);
    } else {
      buckets.set(key, [entry]);
    }
  }

  const groups = [...buckets.entries()].map(([key, bucket]): SchedulePlanGroup => {
    const first = bucket[0]!;
    const responsibilities = bucket
      .map((entry) => toResponsibility(
        entry.assignment,
        entry.team,
        entry.position,
        entry.response_note,
        entry.time_responses,
      ))
      .sort(byTeamThenPosition);
    const times = mergeTimes(bucket.map((entry) => ({ assignmentId: entry.assignment.id, times: entry.times })));
    return {
      key,
      organizationId,
      personId: first.assignment.person_id,
      plan: first.plan,
      startsAt: serviceStart(times, first.plan.service_date),
      responsibilities,
      times,
      ...summarize(responsibilities),
    };
  });

  groups.sort(byStart);
  // History reads most recent first.
  if (window === 'history') groups.reverse();
  return groups;
};

/**
 * A card matches when at least one of its positions does. The card still
 * shows every position, so filtering never hides another responsibility.
 */
export const filterScheduleGroups = (
  groups: readonly SchedulePlanGroup[],
  filter: ScheduleFilter,
): SchedulePlanGroup[] => {
  if (filter === 'all') return [...groups];
  const status = FILTER_STATUS[filter];
  return groups.filter((group) => group.responsibilities.some((item) => item.status === status));
};

/** The signed-in person's positions on a plan's detail screen. */
export const planResponsibilities = (
  assignments: readonly AssignmentDetail[],
  userId: string | null | undefined,
): ScheduleResponsibility[] =>
  userId
    ? assignments
        .filter((assignment) => assignment.user_id === userId)
        .map((assignment) => toResponsibility(
          assignment,
          assignment.team,
          assignment.position,
          null,
          assignment.time_responses,
        ))
        .sort(byTeamThenPosition)
    : [];
