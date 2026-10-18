import { useMemo } from 'react';
import { usePeople, useTeams } from '../../hooks/queries';

/** Display names for the ids a template holds. */
export interface TemplateNames {
  person: (personId: string) => string;
  team: (teamId: string) => string;
  position: (positionId: string | null) => string;
}

export const useTemplateNames = (): TemplateNames => {
  const people = usePeople();
  const teams = useTeams();
  return useMemo(() => {
    const personNames = new Map((people.data ?? []).flatMap((person) =>
      person.person_id ? [[person.person_id, person.full_name ?? person.email ?? 'Someone'] as const] : []));
    const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name] as const));
    const positionNames = new Map((teams.data ?? []).flatMap((team) =>
      team.positions.map((position) => [position.id, `${team.name} · ${position.name}`] as const)));
    return {
      person: (personId) => personNames.get(personId) ?? 'Someone you cannot see',
      team: (teamId) => teamNames.get(teamId) ?? 'Unknown team',
      position: (positionId) => (positionId ? positionNames.get(positionId) ?? 'Unknown position' : 'Any position'),
    };
  }, [people.data, teams.data]);
};
