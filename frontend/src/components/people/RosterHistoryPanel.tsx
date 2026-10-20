import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { PersonRosterEvent } from '@service-center/shared';
import { useRosterAudit, useTeams } from '../../hooks/queries';
import { ErrorNotice, Loading } from '../ui';
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
      <h2 className="mb-3 text-sm font-semibold">{t('history.title')}</h2>
      <ErrorNotice error={audit.error} />
      {audit.isLoading ? (
        <Loading />
      ) : (audit.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-500">{t('history.empty')}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {audit.data?.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {describe(event, teamName, t)}
                {event.actor_name && <span className="text-slate-500"> {t('history.byActor', { name: event.actor_name })}</span>}
              </span>
              <time className="text-xs text-slate-500" dateTime={event.created_at}>
                {f.dateTime(event.created_at, { dateStyle: 'medium' })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
