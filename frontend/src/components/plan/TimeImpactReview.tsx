import type {
  OrphanResolutionAction,
  PlanTimeImpact,
  PlanTimeImpactAssignment,
  PlanTimeImpactTime,
} from '@service-center/shared';
import { formatTime } from '@service-center/shared';
import { ConflictList, timeLabel } from './attendance';

export interface TimeImpactReviewProps {
  impact: PlanTimeImpact;
  resolutions: Readonly<Record<string, OrphanResolutionAction>>;
  onResolve: (assignmentId: string, action: OrphanResolutionAction) => void;
}

const CHANGE_LABELS: Record<PlanTimeImpactTime['change'], string> = {
  added: 'New',
  removed: 'Removed',
  changed: 'Moved',
  renamed: 'Renamed',
  unchanged: 'Unchanged',
};

const timeNames = (impact: PlanTimeImpact, ids: readonly string[]): string =>
  ids
    .map((id) => impact.times.find((time) => time.id === id))
    .filter((time): time is PlanTimeImpactTime => Boolean(time))
    .map((time) => `${time.name || time.kind} ${formatTime(time.starts_at)}`)
    .join(', ');

const describe = (impact: PlanTimeImpact, assignment: PlanTimeImpactAssignment): string => {
  const parts: string[] = [];
  if (assignment.gains.length) parts.push(`adds ${timeNames(impact, assignment.gains)}`);
  if (assignment.loses.length) parts.push(`drops ${timeNames(impact, assignment.loses)}`);
  if (assignment.changed.length) parts.push(`${timeNames(impact, assignment.changed)} moves`);
  return parts.join('; ');
};

/**
 * F04: what a time edit does before it is saved — changed times, every
 * request whose attendance moves, requests left without a time (which must
 * be resolved), outstanding requests that become stale and who is re-sent.
 */
export const TimeImpactReview = ({ impact, resolutions, onResolve }: TimeImpactReviewProps) => {
  const changedTimes = impact.times.filter((time) => time.change !== 'unchanged');
  const names = new Map(impact.assignments.map((assignment) => [assignment.person_id, assignment.person_name ?? 'Someone']));
  return (
    <div className="space-y-4 text-sm">
      {impact.becomes_untimed && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-600/20">
          With no times left, requests cover an approximate two-hour window from the service date.
        </p>
      )}
      {changedTimes.length > 0 && (
        <div>
          <p className="label">Times</p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {changedTimes.map((time) => (
              <li key={time.id}>
                <span className="font-medium">{CHANGE_LABELS[time.change]}</span> — {timeLabel(time)}
                {time.change === 'changed' && time.previous_starts_at && time.previous_ends_at && (
                  <span className="text-slate-400">
                    {' '}(was {formatTime(time.previous_starts_at)}–{formatTime(time.previous_ends_at)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {impact.assignments.length > 0 && (
        <div>
          <p className="label">Requests that change</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {impact.assignments.map((assignment) => (
              <li key={assignment.assignment_id} className="space-y-1 px-3 py-2">
                <p>
                  <span className="font-medium">{assignment.person_name ?? 'Someone'}</span>
                  <span className="text-xs text-slate-500">
                    {' '}· {assignment.team_name ?? 'Team'}
                    {assignment.position_name ? ` · ${assignment.position_name}` : ''}
                    {assignment.visibility === 'prepared' ? ' · prepared' : ''}
                  </span>
                </p>
                {assignment.orphaned ? (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-700">Every time this request covers is being removed.</p>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`orphan-${assignment.assignment_id}`}
                          checked={resolutions[assignment.assignment_id] === 'all'}
                          onChange={() => onResolve(assignment.assignment_id, 'all')}
                        />
                        Keep for all times
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`orphan-${assignment.assignment_id}`}
                          checked={resolutions[assignment.assignment_id] === 'remove'}
                          onChange={() => onResolve(assignment.assignment_id, 'remove')}
                        />
                        Remove the request
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">{describe(impact, assignment)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {impact.hidden_affected > 0 && (
        <p className="text-xs text-slate-500">
          {impact.hidden_affected} more {impact.hidden_affected === 1 ? 'request' : 'requests'} on teams you don’t
          schedule will change too.
        </p>
      )}
      <p className="text-xs text-slate-500">
        {impact.notify_people > 0
          ? `${impact.notify_people} ${impact.notify_people === 1 ? 'person gets' : 'people get'} an updated request. `
          : 'Nobody is notified. '}
        {impact.live_requests > 0
          ? `${impact.live_requests} unanswered ${impact.live_requests === 1 ? 'request link stops' : 'request links stop'} working and must be answered from the new one. `
          : ''}
        Answers already given are kept.
      </p>

      {impact.conflicts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-700">These times would create overlaps:</p>
          <ConflictList conflicts={impact.conflicts} nameOf={(personId) => names.get(personId) ?? 'Someone'} />
        </div>
      )}
    </div>
  );
};
