import type { PersonRosterAction, PersonRosterEvent } from '@service-center/shared';
import { useRosterAudit, useTeams } from '../../hooks/queries';
import { ErrorNotice, Loading } from '../ui';

export interface RosterHistoryPanelProps {
  personId: string;
}

const VERBS: Record<PersonRosterAction, string> = {
  created: 'added to the roster',
  archived: 'archived',
  restored: 'restored',
  linked: 'linked to a login',
  unlinked: 'unlinked from their login',
  tag_added: 'tagged',
  tag_removed: 'untagged',
  team_added: 'added to',
  team_removed: 'removed from',
};

const describe = (event: PersonRosterEvent, teamName: (id: string) => string): string => {
  const verb = VERBS[event.action];
  if (event.detail.tag) return `${verb} “${event.detail.tag}”`;
  if (event.detail.team_id) return `${verb} ${teamName(event.detail.team_id)}`;
  return verb;
};

/** Recent roster changes for one Person (people.view_private / people.manage). */
export const RosterHistoryPanel = ({ personId }: RosterHistoryPanelProps) => {
  const audit = useRosterAudit(personId);
  const teams = useTeams();
  const teamName = (id: string) => teams.data?.find((team) => team.id === id)?.name ?? 'a team';

  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold">Roster history</h2>
      <ErrorNotice error={audit.error} />
      {audit.isLoading ? (
        <Loading />
      ) : (audit.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-500">No changes recorded yet.</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {audit.data?.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {describe(event, teamName)}
                {event.actor_name && <span className="text-slate-500"> by {event.actor_name}</span>}
              </span>
              <time className="text-xs text-slate-500" dateTime={event.created_at}>
                {new Date(event.created_at).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
