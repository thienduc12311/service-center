import { useTranslation } from 'react-i18next';
import {
  formatInstantDate,
  formatInstantTime,
  type AssignmentAttendanceMode,
  type AttendanceConflict,
  type AttendanceInterval,
  type PlanTimeKind,
  type PlanTimeRow,
} from '@service-center/shared';
import { i18n, useFormatters } from '../../i18n';

/*
 * `timeLabel` and `attendanceSummary` are plain functions shared with other
 * screens, so they read the displayed language from the app's i18next
 * instance; components that render them re-render on a language change.
 */
const reportsT = () => i18n.getFixedT(null, 'reports');

/** The kind of a plan time, translated ("Service", "Rehearsal", "Other"). */
export const timeKindLabel = (kind: PlanTimeKind): string => reportsT()(`attendance.timeKinds.${kind}`);

/** "Rehearsal · Fri, Jan 1 · 7:00 PM–9:00 PM", the label used for one time everywhere. */
export const timeLabel = (time: Pick<PlanTimeRow, 'kind' | 'name' | 'starts_at' | 'ends_at'>): string =>
  reportsT()('attendance.timeLabel', {
    name: time.name || timeKindLabel(time.kind),
    date: formatInstantDate(time.starts_at, i18n.language, 'short'),
    start: formatInstantTime(time.starts_at, i18n.language),
    end: formatInstantTime(time.ends_at, i18n.language),
  });

/** Short form for a staffing row: "Rehearsal 7:00 PM, 9:00 AM". */
export const attendanceSummary = (attendance: readonly AttendanceInterval[]): string => {
  const t = reportsT();
  if (attendance.length === 0) return t('attendance.noTimes');
  if (attendance.every((interval) => interval.source === 'untimed_fallback')) return t('attendance.timeNotSet');
  return attendance
    .map((interval) =>
      t('attendance.intervalShort', { name: interval.name || timeKindLabel(interval.kind), time: formatInstantTime(interval.starts_at, i18n.language) }),
    )
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
  const { t } = useTranslation('reports');
  if (times.length === 0) {
    return (
      <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-600/20">
        {t('attendance.scope.noTimes')}
      </p>
    );
  }
  const sorted = [...times].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  return (
    <fieldset className="space-y-2">
      <legend className="label">{t('attendance.scope.legend')}</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="radio"
          name={`${idPrefix}-mode`}
          className="mt-0.5"
          checked={value.mode === 'all'}
          onChange={() => onChange(ALL_TIMES)}
        />
        <span>
          {t('attendance.scope.all')}
          <span className="block text-xs text-slate-500">{t('attendance.scope.allHint')}</span>
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
          {t('attendance.scope.selected')}
          <span className="block text-xs text-slate-500">{t('attendance.scope.selectedHint')}</span>
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
          {value.timeIds.length === 0 && <p className="text-xs text-amber-600">{t('attendance.scope.chooseOne')}</p>}
        </div>
      )}
    </fieldset>
  );
};

/** Conflict window text, e.g. "Sun, Oct 25 9:00 AM–11:00 AM". */
const useConflictWindow = (): ((conflict: AttendanceConflict) => string) => {
  const { t } = useTranslation('reports');
  const formatters = useFormatters();
  return (conflict) => {
    const values = {
      date: formatters.date(conflict.starts_at, 'short'),
      start: formatters.time(conflict.starts_at),
      end: formatters.time(conflict.ends_at),
    };
    return conflict.interval_source === 'untimed_fallback'
      ? t('attendance.conflicts.windowApproximate', values)
      : t('attendance.conflicts.window', values);
  };
};

/** The other commitment's plan and time (user content), or a translated placeholder when redacted. */
const useConflictDetail = (): ((conflict: AttendanceConflict) => string) => {
  const { t } = useTranslation('reports');
  return (conflict) => (conflict.redacted ? t('attendance.conflicts.anotherCommitment') : conflict.detail);
};

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
  const { t } = useTranslation('reports');
  const conflictWindow = useConflictWindow();
  const conflictDetail = useConflictDetail();
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  const warnings = conflicts.filter((conflict) => conflict.severity === 'warning');
  return (
    <>
      {blocking.length > 0 && (
        <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
          <p className="font-medium">{t('attendance.conflicts.blockingTitle')}</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {blocking.map((conflict, index) => (
              <li key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`}>
                {conflict.kind === 'overlapping_commitment'
                  ? t('attendance.conflicts.overlapping', { name: nameOf(conflict.person_id), detail: conflictDetail(conflict), window: conflictWindow(conflict) })
                  : t('attendance.conflicts.blockout', { name: nameOf(conflict.person_id), window: conflictWindow(conflict) })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 ring-1 ring-slate-300/60">
          <p className="font-medium">{t('attendance.conflicts.warningTitle')}</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {warnings.map((conflict, index) => (
              <li key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`}>
                {t('attendance.conflicts.samePlan', { name: nameOf(conflict.person_id), detail: conflictDetail(conflict), window: conflictWindow(conflict) })}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">{t('attendance.conflicts.warningHint')}</p>
        </div>
      )}
    </>
  );
};
