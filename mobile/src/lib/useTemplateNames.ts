import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';

/** Display names for the People, teams and positions a template refers to (as on the website). */
export interface TemplateNames {
  person: (personId: string) => string;
  team: (teamId: string) => string;
  position: (positionId: string | null) => string;
}

export const useTemplateNames = (): TemplateNames => {
  const { t } = useTranslation(['templates', 'common']);
  const { queryScope } = useAuth();
  const people = useQuery({
    queryKey: queryKeys.people(queryScope),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  return useMemo<TemplateNames>(() => {
    const personNames = new Map((people.data ?? []).flatMap((person) =>
      person.person_id ? [[person.person_id, person.full_name ?? person.email ?? t('common:fallback.someone')] as const] : []));
    const teamNames = new Map((teams.data ?? []).map((team) => [team.id, team.name] as const));
    const positionNames = new Map((teams.data ?? []).flatMap((team) =>
      team.positions.map((position) => [position.id, t('common:format.teamPosition', { team: team.name, position: position.name })] as const)));
    return {
      person: (personId) => personNames.get(personId) ?? t('names.hiddenPerson'),
      team: (teamId) => teamNames.get(teamId) ?? t('names.unknownTeam'),
      position: (positionId) => (positionId ? positionNames.get(positionId) ?? t('names.unknownPosition') : t('names.anyPosition')),
    };
  }, [people.data, teams.data, t]);
};
