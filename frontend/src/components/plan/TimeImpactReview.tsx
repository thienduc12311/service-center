import type {
  OrphanResolutionAction,
  PlanTimeImpact,
  PlanTimeImpactAssignment,
  PlanTimeImpactTime,
} from '@service-center/shared';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '../../i18n';
import { ConflictList, timeLabel } from './attendance';

export interface TimeImpactReviewProps {
  impact: PlanTimeImpact;
  resolutions: Readonly<Record<string, OrphanResolutionAction>>;
  onResolve: (assignmentId: string, action: OrphanResolutionAction) => void;
}

/** What `describe` needs to put times into words. */
interface DescribeContext {
  t: TFunction<['plans', 'common']>;
  clock: (instant: string) => string;
}

const timeNames = ({ t, clock }: DescribeContext, impact: PlanTimeImpact, ids: readonly string[]): string =>
  ids
    .map((id) => impact.times.find((time) => time.id === id))
    .filter((time): time is PlanTimeImpactTime => Boolean(time))
    .map((time) => t('timeImpact.timeName', { name: time.name || t(`timeKind.${time.kind}`), time: clock(time.starts_at) }))
    .join(', ');

const describe = (context: DescribeContext, impact: PlanTimeImpact, assignment: PlanTimeImpactAssignment): string => {
  const { t } = context;
  const parts: string[] = [];
  if (assignment.gains.length) parts.push(t('timeImpact.adds', { times: timeNames(context, impact, assignment.gains) }));
  if (assignment.loses.length) parts.push(t('timeImpact.drops', { times: timeNames(context, impact, assignment.loses) }));
  if (assignment.changed.length) parts.push(t('timeImpact.moves', { times: timeNames(context, impact, assignment.changed) }));
  return parts.join('; ');
};

/**
 * F04: what a time edit does before it is saved — changed times, every
 * request whose attendance moves, requests left without a time (which must
 * be resolved), outstanding requests that become stale and who is re-sent.
 */
export const TimeImpactReview = ({ impact, resolutions, onResolve }: TimeImpactReviewProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const context: DescribeContext = { t, clock: (instant) => format.time(instant) };
  const someone = t('common:fallback.someone');
  const changedTimes = impact.times.filter((time) => time.change !== 'unchanged');
  const names = new Map(impact.assignments.map((assignment) => [assignment.person_id, assignment.person_name ?? someone]));
  return (
    <div className="space-y-4 text-sm">
      {impact.becomes_untimed && (
        <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-600/20">
          {t('timeImpact.untimed')}
        </p>
      )}
      {changedTimes.length > 0 && (
        <div>
          <p className="label">{t('timeImpact.times')}</p>
          <ul className="space-y-0.5 text-xs text-slate-600">
            {changedTimes.map((time) => (
              <li key={time.id}>
                <span className="font-medium">{t(`timeImpact.change.${time.change}`)}</span> — {timeLabel(time)}
                {time.change === 'changed' && time.previous_starts_at && time.previous_ends_at && (
                  <span className="text-slate-400">
                    {' '}{t('timeImpact.was', { start: format.time(time.previous_starts_at), end: format.time(time.previous_ends_at) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {impact.assignments.length > 0 && (
        <div>
          <p className="label">{t('timeImpact.requestsThatChange')}</p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {impact.assignments.map((assignment) => (
              <li key={assignment.assignment_id} className="space-y-1 px-3 py-2">
                <p>
                  <span className="font-medium">{assignment.person_name ?? someone}</span>
                  <span className="text-xs text-slate-500">
                    {' '}· {[
                      assignment.team_name ?? t('common:fallback.team'),
                      ...(assignment.position_name ? [assignment.position_name] : []),
                      ...(assignment.visibility === 'prepared' ? [t('timeImpact.prepared')] : []),
                    ].join(' · ')}
                  </span>
                </p>
                {assignment.orphaned ? (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-700">{t('timeImpact.orphaned')}</p>
                    <div className="flex flex-wrap gap-3 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`orphan-${assignment.assignment_id}`}
                          checked={resolutions[assignment.assignment_id] === 'all'}
                          onChange={() => onResolve(assignment.assignment_id, 'all')}
                        />
                        {t('timeImpact.keepAll')}
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="radio"
                          name={`orphan-${assignment.assignment_id}`}
                          checked={resolutions[assignment.assignment_id] === 'remove'}
                          onChange={() => onResolve(assignment.assignment_id, 'remove')}
                        />
                        {t('timeImpact.removeRequest')}
                      </label>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">{describe(context, impact, assignment)}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {impact.hidden_affected > 0 && (
        <p className="text-xs text-slate-500">
          {t('timeImpact.hiddenAffected', { count: impact.hidden_affected })}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {[
          impact.notify_people > 0 ? t('timeImpact.notifyPeople', { count: impact.notify_people }) : t('timeImpact.notifyNobody'),
          ...(impact.live_requests > 0 ? [t('timeImpact.liveRequests', { count: impact.live_requests })] : []),
          t('timeImpact.answersKept'),
        ].join(' ')}
      </p>

      {impact.conflicts.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-700">{t('timeImpact.conflicts')}</p>
          <ConflictList conflicts={impact.conflicts} nameOf={(personId) => names.get(personId) ?? someone} />
        </div>
      )}
    </div>
  );
};
