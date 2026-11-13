import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n';
import { useSongSchedule } from '../../hooks/queries';
import { ErrorNotice, Spinner } from '../ui';
import { Icon } from '../icons';

export interface SongSchedulePanelProps {
  songId: string;
  /** Narrows the history to one arrangement; null counts every arrangement. */
  arrangementId: string | null;
}

/** How many services back the panel looks. */
const SCHEDULE_LIMITS: readonly number[] = [3, 6, 12];

/**
 * When the song was last used: the most recent services it was scheduled in,
 * newest first, with the arrangement and key each one played.
 */
export const SongSchedulePanel = ({ songId, arrangementId }: SongSchedulePanelProps) => {
  const { t } = useTranslation('songs');
  const formatters = useFormatters();
  const [limit, setLimit] = useState<number>(SCHEDULE_LIMITS[0]!);
  const schedule = useSongSchedule(songId, {
    limit,
    ...(arrangementId ? { arrangement_id: arrangementId } : {}),
  });

  const entries = schedule.data ?? [];

  return (
    <section className="card flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-app-border px-4 py-3">
        <Icon name="calendar" className="size-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('schedule.title')}</h2>
        {schedule.isFetching && <Spinner className="size-3 text-slate-300" />}
      </div>

      <div className="space-y-2 px-4 pt-3">
      <select
        aria-label={t('schedule.limitLabel')}
        className="input"
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
      >
        {SCHEDULE_LIMITS.map((option) => (
          <option key={option} value={option}>
            {t('schedule.limitOption', { count: option })}
          </option>
        ))}
      </select>

      <ErrorNotice error={schedule.error} />
      </div>

      <div className="row-list mt-2">
        {entries.length === 0 ? (
          <p className="px-4 py-4 text-xs text-slate-400">
            {schedule.isLoading
              ? t('schedule.loading')
              : arrangementId
                ? t('schedule.emptyArrangement')
                : t('schedule.emptySong')}
          </p>
        ) : (
          entries.map((entry) => (
            <Link
              key={entry.plan_id}
              to={`/plans/${entry.plan_id}`}
              className="group flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  {formatters.calendarDate(entry.service_date, 'long')}
                </span>
                {entry.arrangement_name && (
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    {entry.arrangement_name}
                    {entry.key && ` [${entry.key}]`}
                  </span>
                )}
                <span className="block truncate text-xs text-slate-400">
                  {entry.service_type_name ?? entry.plan_title}
                </span>
              </span>
              <Icon name="chevronRight" className="size-4 shrink-0 text-slate-300 group-hover:text-brand-500 dark:text-slate-600" />
            </Link>
          ))
        )}
      </div>
    </section>
  );
};
