import { Link } from 'react-router-dom';
import type { PlatformAuditEntry } from '@service-center/shared';
import { auditActionLabel, auditTargetLabel, summarizeAuditDetails } from '../lib/activity';
import { formatDateTime, formatRelativeTime } from '../lib/format';

export interface ActivityListProps {
  entries: readonly PlatformAuditEntry[];
  /** Hide the church column on a church's own page. */
  showChurch?: boolean;
}

/** One line per audit entry: time, who, what, where, and a short summary. */
export const ActivityList = ({ entries, showChurch = true }: ActivityListProps) => (
  <ol className="row-list">
    {entries.map((entry) => (
      <ActivityLine key={entry.id} entry={entry} showChurch={showChurch} />
    ))}
  </ol>
);

interface ActivityLineProps {
  entry: PlatformAuditEntry;
  showChurch: boolean;
}

const ActivityLine = ({ entry, showChurch }: ActivityLineProps) => {
  const summary = summarizeAuditDetails(entry);
  const target = auditTargetLabel(entry);
  return (
    <li className="flex flex-col gap-0.5 px-4 py-2.5 text-sm sm:flex-row sm:items-baseline sm:gap-4">
      <time
        dateTime={entry.created_at}
        title={formatRelativeTime(entry.created_at)}
        className="shrink-0 text-xs whitespace-nowrap text-slate-500 tabular-nums sm:w-40 dark:text-slate-400"
      >
        {formatDateTime(entry.created_at)}
      </time>
      <div className="min-w-0 flex-1">
        <p className="text-slate-900 dark:text-slate-100">
          <span className="font-medium">{auditActionLabel(entry.action)}</span>
          {showChurch && entry.organization_id && (
            <>
              <span className="text-slate-400"> · </span>
              <Link to={`/churches/${entry.organization_id}`} className="text-brand-700 hover:underline dark:text-brand-200">
                {entry.organization_name ?? 'Deleted church'}
              </Link>
            </>
          )}
          {target && (
            <>
              <span className="text-slate-400"> · </span>
              {entry.target_user_id && (entry.target_name !== null || entry.target_email !== null) ? (
                <Link to={`/users/${entry.target_user_id}`} className="text-brand-700 hover:underline dark:text-brand-200">
                  {target}
                </Link>
              ) : (
                <span className="text-slate-600 dark:text-slate-300">{target}</span>
              )}
            </>
          )}
          {entry.application_id && (
            <>
              <span className="text-slate-400"> · </span>
              <Link to={`/applications/${entry.application_id}`} className="text-brand-700 hover:underline dark:text-brand-200">
                Application
              </Link>
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" title={summary || undefined}>
          by {entry.actor_id ? (entry.actor_name ?? 'Unknown user') : 'System'}
          {summary && <> · {summary}</>}
        </p>
      </div>
    </li>
  );
};
