import {
  canAccess,
  canAccessAnywhere,
  type AssignmentStatus,
  type AttendanceStatus,
  type EffectiveAccess,
  type LiveRunActuals,
  type PlanStatus,
  type PlanTimeKind,
  type ReportAssignmentSource,
  type ReportAttendanceSource,
  type ReportExportRow,
  type ReportExportSummary,
  type ReportFiltersApplied,
  type ReportFiltersInput,
  type ReportKind,
  type ReportNeedSource,
  type ReportPlanSource,
  type ReportRunSource,
  type ReportSongItemSource,
} from '@service-center/shared';

/** Rows exactly as the report queries select them. */
export interface ReportPlanRow {
  id: string;
  title: string;
  service_date: string;
  status: PlanStatus;
  service_type_id: string | null;
  service_type: { name: string } | null;
}

export interface ReportAssignmentRow {
  id: string;
  plan_id: string;
  person_id: string;
  team_id: string;
  status: AssignmentStatus;
  released_at: string | null;
  team: { name: string } | null;
  position: { name: string } | null;
}

export interface ReportNeedRow {
  plan_id: string;
  needed: number;
  position: { name: string; team_id: string; team: { name: string } | null } | null;
}

export interface ReportAttendanceRow {
  plan_id: string;
  plan_time_id: string | null;
  person_id: string;
  status: AttendanceStatus;
  time_kind: PlanTimeKind;
}

export interface ReportSongItemRow {
  id: string;
  plan_id: string;
  song_id: string | null;
  key_override: string | null;
  song: { title: string; author: string | null; default_key: string | null } | null;
  arrangement: { song_key: string | null } | null;
}

export interface ReportPersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  archived_at: string | null;
}

export const applyReportFilters = (filters: ReportFiltersInput, timezone: string): ReportFiltersApplied => ({
  from: filters.from,
  to: filters.to,
  timezone,
  service_type_ids: [...filters.service_type_ids],
  team_ids: [...filters.team_ids],
  plan_statuses: [...filters.plan_statuses],
  assignment_statuses: [...filters.assignment_statuses],
  include_archived_people: filters.include_archived_people,
  include_rehearsals: filters.include_rehearsals,
});

/** Mirrors `private.can_run_report`: who may run each report at all. */
export const canRunReport = (access: EffectiveAccess, kind: ReportKind): boolean => {
  switch (kind) {
    case 'staffing':
    case 'participation':
    case 'schedule':
      return canAccessAnywhere(access, 'scheduling.manage');
    case 'song_usage':
      return canAccessAnywhere(access, 'plans.edit') || canAccessAnywhere(access, 'songs.manage');
    case 'run_times':
      return canAccessAnywhere(access, 'plans.edit');
  }
};

/** Which plans a report may read, by the plan's service type. */
export const planInScope = (access: EffectiveAccess, kind: ReportKind, serviceTypeId: string | null): boolean => {
  switch (kind) {
    case 'staffing':
    case 'participation':
    case 'schedule':
      // Team-scoped schedulers reach a plan through its teams; rows are filtered below.
      return canAccessAnywhere(access, 'scheduling.manage');
    case 'song_usage':
      return canAccess(access, 'songs.manage') || canAccess(access, 'plans.edit', { serviceTypeId });
    case 'run_times':
      return canAccess(access, 'plans.edit', { serviceTypeId });
  }
};

/** Staffing rows (requests, needs) a scheduler may report on. */
export const teamInScope = (access: EffectiveAccess, serviceTypeId: string | null, teamId: string): boolean =>
  canAccess(access, 'scheduling.manage', { serviceTypeId, teamId });

/** Whether the caller's access covers every plan/team (no scope note needed). */
export const scopeNote = (access: EffectiveAccess, kind: ReportKind): string | null => {
  const orgWide = (capability: Parameters<typeof canAccess>[1]): boolean => canAccess(access, capability);
  switch (kind) {
    case 'staffing':
    case 'participation':
    case 'schedule':
      return orgWide('scheduling.manage') ? null : 'Only the teams and service types you schedule are included.';
    case 'song_usage':
      return orgWide('songs.manage') || orgWide('plans.edit') ? null : 'Only plans of service types you edit are included.';
    case 'run_times':
      return orgWide('plans.edit') ? null : 'Only plans of service types you edit are included.';
  }
};

export const toReportPlan = (row: ReportPlanRow): ReportPlanSource => ({
  id: row.id,
  title: row.title,
  service_date: row.service_date,
  status: row.status,
  service_type_id: row.service_type_id,
  service_type_name: row.service_type?.name ?? null,
});

export const toReportAssignment = (row: ReportAssignmentRow, timeIds: string[]): ReportAssignmentSource => ({
  id: row.id,
  plan_id: row.plan_id,
  person_id: row.person_id,
  team_id: row.team_id,
  team_name: row.team?.name ?? 'Team',
  position_name: row.position?.name ?? null,
  status: row.status,
  released_at: row.released_at,
  time_ids: timeIds,
});

export const toReportNeed = (row: ReportNeedRow): ReportNeedSource | null =>
  row.position
    ? {
        plan_id: row.plan_id,
        team_id: row.position.team_id,
        team_name: row.position.team?.name ?? 'Team',
        position_name: row.position.name,
        needed: row.needed,
      }
    : null;

export const toReportAttendance = (row: ReportAttendanceRow): ReportAttendanceSource => ({ ...row });

/** Effective key: item override, then the arrangement's key, then the song default. */
export const toReportSongItem = (row: ReportSongItemRow): ReportSongItemSource | null =>
  row.song_id && row.song
    ? {
        plan_id: row.plan_id,
        item_id: row.id,
        song_id: row.song_id,
        title: row.song.title,
        author: row.song.author,
        key: row.key_override ?? row.arrangement?.song_key ?? row.song.default_key ?? null,
      }
    : null;

export interface EndedRunRow {
  id: string;
  plan_id: string;
  time_name: string | null;
  time_starts_at: string;
}

export const toReportRun = (run: EndedRunRow, actuals: LiveRunActuals): ReportRunSource => {
  const items = actuals.items.filter((item) => item.item_type !== 'header');
  return {
    run_id: run.id,
    plan_id: run.plan_id,
    time_name: run.time_name,
    time_starts_at: run.time_starts_at,
    planned_seconds: actuals.planned_service_seconds,
    actual_seconds: actuals.actual_service_seconds,
    items: items.length,
    items_over: items.filter((item) => (item.variance_seconds ?? 0) > 0).length,
    corrected: actuals.corrected,
  };
};

export const toReportExportSummary = (row: ReportExportRow): ReportExportSummary => {
  const { storage_path: _path, idempotency_key: _key, lease_expires_at: _lease, ...summary } = row;
  return summary;
};
