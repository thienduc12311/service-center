import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '@service-center/shared';
import { useSongSchedule } from '../../hooks/queries';
import { ErrorNotice, Spinner } from '../ui';

export interface SongSchedulePanelProps {
  songId: string;
  /** Narrows the history to one arrangement; null counts every arrangement. */
  arrangementId: string | null;
}

/** How many services back the panel looks. */
const SCHEDULE_LIMITS: readonly number[] = [3, 6, 12];

const SERVICE_DAY = { month: 'long', day: 'numeric', year: 'numeric' } as const;

/**
 * When the song was last used: the most recent services it was scheduled in,
 * newest first, with the arrangement and key each one played.
 */
export const SongSchedulePanel = ({ songId, arrangementId }: SongSchedulePanelProps) => {
  const [limit, setLimit] = useState<number>(SCHEDULE_LIMITS[0]!);
  const schedule = useSongSchedule(songId, {
    limit,
    ...(arrangementId ? { arrangement_id: arrangementId } : {}),
  });

  const entries = schedule.data ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Schedule</h2>
        {schedule.isFetching && <Spinner className="size-3 text-slate-300" />}
      </div>

      <select
        aria-label="How far back the schedule looks"
        className="input mb-2"
        value={limit}
        onChange={(event) => setLimit(Number(event.target.value))}
      >
        {SCHEDULE_LIMITS.map((option) => (
          <option key={option} value={option}>
            Since {option} Most Recent
          </option>
        ))}
      </select>

      <ErrorNotice error={schedule.error} />

      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-400">
            {schedule.isLoading
              ? 'Looking up recent services…'
              : arrangementId
                ? 'This arrangement has not been scheduled yet.'
                : 'This song has not been scheduled yet.'}
          </p>
        ) : (
          entries.map((entry) => (
            <Link
              key={entry.plan_id}
              to={`/plans/${entry.plan_id}`}
              className="block px-4 py-3 transition hover:bg-slate-50"
            >
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                {formatDate(entry.service_date, SERVICE_DAY)}
              </p>
              {entry.arrangement_name && (
                <p className="text-xs text-slate-500">
                  {entry.arrangement_name}
                  {entry.key && ` [${entry.key}]`}
                </p>
              )}
              <p className="text-xs text-slate-400">
                {entry.service_type_name ?? entry.plan_title}
              </p>
            </Link>
          ))
        )}
      </div>
    </section>
  );
};
