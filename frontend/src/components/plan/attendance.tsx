import {
  formatDate,
  formatTime,
  type AssignmentAttendanceMode,
  type AttendanceConflict,
  type AttendanceInterval,
  type PlanTimeKind,
  type PlanTimeRow,
} from '@service-center/shared';

export const TIME_KIND_LABELS: Record<PlanTimeKind, string> = {
  service: 'Service',
  rehearsal: 'Rehearsal',
  other: 'Other',
};

/** "Rehearsal · Fri, Jan 1 · 7:00 PM–9:00 PM", the label used for one time everywhere. */
export const timeLabel = (time: Pick<PlanTimeRow, 'kind' | 'name' | 'starts_at' | 'ends_at'>): string =>
  `${time.name || TIME_KIND_LABELS[time.kind]} · ${formatDate(time.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} · ${formatTime(time.starts_at)}–${formatTime(time.ends_at)}`;

/** Short form for a staffing row: "Rehearsal 7:00 PM, 9:00 AM". */
export const attendanceSummary = (attendance: readonly AttendanceInterval[]): string => {
  if (attendance.length === 0) return 'No times';
  if (attendance.every((interval) => interval.source === 'untimed_fallback')) return 'Time not set';
  return attendance
    .map((interval) => `${interval.name || TIME_KIND_LABELS[interval.kind]} ${formatTime(interval.starts_at)}`)
    .join(', ');
};

/** The attendance scope a scheduler is choosing. */
export interface TimeScope {
  mode: AssignmentAttendanceMode;
  timeIds: string[];
}

export const ALL_TIMES: TimeScope = { mode: 'all', timeIds: [] };

export const isScopeComplete = (scope: TimeScope): boolean => scope.mode === 'all' || scope.timeIds.length > 0;

export interface TimeScopePickerProps {
  times: readonly PlanTimeRow[];
  value: TimeScope;
  onChange: (scope: TimeScope) => void;
  /** Distinguishes several pickers' radio groups on one page. */
  idPrefix: string;
}

/**
 * All times (including any added later) versus only the chosen ones. A plan
 * without times says so instead of implying a precise commitment.
 */
export const TimeScopePicker = ({ times, value, onChange, idPrefix }: TimeScopePickerProps) => {
  if (times.length === 0) {
    return (
      <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-600/20">
        This plan has no times yet. Requests cover an approximate two-hour window from the service date until times
        are added — conflicts and calendars are only as precise as that.
      </p>
    );
  }
  const sorted = [...times].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  return (
    <fieldset className="space-y-2">
      <legend className="label">Times</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-mode`}
          className="mt-0.5"
          checked={value.mode === 'all'}
          onChange={() => onChange(ALL_TIMES)}
        />
        <span>
          All times
          <span className="block text-xs text-slate-500">Includes any time added to this plan later.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-mode`}
          className="mt-0.5"
          checked={value.mode === 'selected'}
          onChange={() => onChange({ mode: 'selected', timeIds: value.timeIds })}
        />
        <span>
          Only these times
          <span className="block text-xs text-slate-500">A time added later is not included automatically.</span>
        </span>
      </label>
      {value.mode === 'selected' && (
        <div className="ml-6 space-y-1">
          {sorted.map((time) => (
            <label key={time.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300"
                checked={value.timeIds.includes(time.id)}
                onChange={(event) =>
                  onChange({
                    mode: 'selected',
                    timeIds: event.target.checked
                      ? [...value.timeIds, time.id]
                      : value.timeIds.filter((id) => id !== time.id),
                  })
                }
              />
              <span>{timeLabel(time)}</span>
            </label>
          ))}
          {value.timeIds.length === 0 && <p className="text-xs text-amber-600">Choose at least one time.</p>}
        </div>
      )}
    </fieldset>
  );
};

const KIND_LABELS: Record<AttendanceConflict['kind'], string> = {
  blockout: 'blocked out',
  overlapping_commitment: 'already scheduled',
};

const conflictWindow = (conflict: AttendanceConflict): string =>
  `${formatDate(conflict.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })} ${formatTime(conflict.starts_at)}–${formatTime(conflict.ends_at)}${conflict.interval_source === 'untimed_fallback' ? ' (approximate — plan has no times)' : ''}`;

export interface ConflictListProps {
  conflicts: readonly AttendanceConflict[];
  nameOf: (personId: string) => string;
}

/**
 * Blocking conflicts (a blockout, or a commitment on another plan) apart from
 * same-plan double roles, which are shown but never block. Details the viewer
 * may not see are already redacted by the server.
 */
export const ConflictList = ({ conflicts, nameOf }: ConflictListProps) => {
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warning');
  return (
    <>
      {blocking.length > 0 && (
        <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
          <p className="font-medium">Scheduling conflicts</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {blocking.map((conflict, index) => (
              <li key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`}>
                {nameOf(conflict.person_id)} — {KIND_LABELS[conflict.kind]}
                {conflict.kind === 'overlapping_commitment' ? ` (${conflict.detail})` : ''} · {conflictWindow(conflict)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-300/60">
          <p className="font-medium">Also on this plan at the same time</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {warnings.map((conflict, index) => (
              <li key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`}>
                {nameOf(conflict.person_id)} — {conflict.detail} · {conflictWindow(conflict)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">A second role on the same plan is allowed; make sure it’s intended.</p>
        </div>
      )}
    </>
  );
};
