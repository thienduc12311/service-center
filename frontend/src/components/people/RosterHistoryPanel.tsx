import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PersonRosterEvent } from '@service-center/shared';
import { useRosterAudit, useTeams } from '../../hooks/queries';
import { ErrorNotice, Loading } from '../ui';
import { Icon } from '../icons';
import { useFormatters } from '../../i18n';

export interface RosterHistoryPanelProps {
  personId: string;
}

/** One whole sentence per event kind, with the tag or team as a placeholder. */
const describe = (event: PersonRosterEvent, teamName: (id: string) => string, t: TFunction<'people'>): string => {
  const { action, detail } = event;
  if (detail.tag && (action === 'tag_added' || action === 'tag_removed')) {
    return t(`history.eventsWithTag.${action}`, { tag: detail.tag });
  }
  if (detail.team_id && (action === 'team_added' || action === 'team_removed')) {
    return t(`history.eventsWithTeam.${action}`, { team: teamName(detail.team_id) });
  }
  return t(`history.events.${action}`);
};

/** Recent roster changes for one Person (people.view_private / people.manage). */
export const RosterHistoryPanel = ({ personId }: RosterHistoryPanelProps) => {
  const { t } = useTranslation('people');
  const f = useFormatters();
  const audit = useRosterAudit(personId);
  const teams = useTeams();
  const teamName = (id: string) => teams.data?.find((team) => team.id === id)?.name ?? t('history.aTeam');

  return (
    <section className="card p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <Icon name="clock" className="size-4 text-slate-400" />
        {t('history.title')}
      </h2>
      <ErrorNotice error={audit.error} />
      {audit.isLoading ? (
        <Loading />
      ) : (audit.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('history.empty')}</p>
      ) : (
        <ol className="relative space-y-3 border-l border-app-border pl-5 text-sm">
          {audit.data?.map((event) => (
            <li key={event.id} className="relative flex flex-wrap justify-between gap-x-3 gap-y-0.5">
              <span aria-hidden="true" className="absolute top-1.5 -left-[1.6rem] size-2.5 rounded-full bg-brand-500 ring-4 ring-[var(--app-surface)]" />
              <span className="min-w-0 text-slate-700 dark:text-slate-200">
                {describe(event, teamName, t)}
                {event.actor_name && <span className="text-slate-500 dark:text-slate-400"> {t('history.byActor', { name: event.actor_name })}</span>}
              </span>
              <time className="text-xs text-slate-500 tabular-nums dark:text-slate-400" dateTime={event.created_at}>
                {f.dateTime(event.created_at, { dateStyle: 'medium' })}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};
