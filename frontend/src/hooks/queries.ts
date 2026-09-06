import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';

/**
 * Every key is namespaced by organization so switching orgs can never surface
 * another tenant's cached data.
 */
export const keys = {
  all: (org: string | null) => ['org', org] as const,
  people: (org: string | null) => [...keys.all(org), 'people'] as const,
  person: (org: string | null, id: string) => [...keys.people(org), id] as const,
  teams: (org: string | null) => [...keys.all(org), 'teams'] as const,
  serviceTypes: (org: string | null) => [...keys.all(org), 'service-types'] as const,
  songs: (org: string | null, query: unknown) => [...keys.all(org), 'songs', query] as const,
  song: (org: string | null, id: string) => [...keys.all(org), 'song', id] as const,
  plans: (org: string | null, query: unknown) => [...keys.all(org), 'plans', query] as const,
  plan: (org: string | null, id: string) => [...keys.all(org), 'plan', id] as const,
  calendar: (org: string | null, query: unknown) => [...keys.all(org), 'calendar', query] as const,
  mySchedule: (org: string | null, query: unknown) => [...keys.all(org), 'my-schedule', query] as const,
  blockouts: (org: string | null, query: unknown) => [...keys.all(org), 'blockouts', query] as const,
  imports: (org: string | null) => [...keys.all(org), 'imports'] as const,
  songbooks: (org: string | null) => [...keys.all(org), 'songbooks'] as const,
  songbook: (org: string | null, id: string) => [...keys.songbooks(org), id] as const,
};

const useOrg = () => useAuth().organizationId;

type Options<T> = Omit<UseQueryOptions<T, Error, T>, 'queryKey' | 'queryFn'>;

export const usePeople = (options?: Options<Awaited<ReturnType<typeof api.listPeople>>>) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.people(org),
    queryFn: () => api.listPeople(),
    enabled: Boolean(org),
    ...options,
  });
};

export const usePerson = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.person(org, id ?? ''),
    queryFn: () => api.getPerson(id!),
    enabled: Boolean(org && id),
  });
};

export const useTeams = () => {
  const org = useOrg();
  return useQuery({ queryKey: keys.teams(org), queryFn: () => api.listTeams(), enabled: Boolean(org) });
};

export const useServiceTypes = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.serviceTypes(org),
    queryFn: () => api.listServiceTypes(),
    enabled: Boolean(org),
  });
};

export const useSongs = (query: { q?: string; sort?: string; page?: number; per_page?: number }) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songs(org, query),
    queryFn: () => api.listSongs(query),
    enabled: Boolean(org),
    placeholderData: (previous) => previous,
  });
};

export const useSong = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.song(org, id ?? ''),
    queryFn: () => api.getSong(id!),
    enabled: Boolean(org && id),
  });
};

export const usePlans = (query: Record<string, string | number | undefined>) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.plans(org, query),
    queryFn: () => api.listPlans(query),
    enabled: Boolean(org),
    placeholderData: (previous) => previous,
  });
};

export const usePlan = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.plan(org, id ?? ''),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(org && id),
  });
};

export const useCalendar = (query: { from: string; to: string; mine?: boolean; team_id?: string }) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.calendar(org, query),
    queryFn: () => api.calendar(query),
    enabled: Boolean(org),
    placeholderData: (previous) => previous,
  });
};

export const useMySchedule = (query: { include_past?: boolean; status?: string } = {}) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.mySchedule(org, query),
    queryFn: () => api.mySchedule(query),
    enabled: Boolean(org),
  });
};

export const useBlockouts = (query: { scope?: 'mine' | 'organization' } = {}) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.blockouts(org, query),
    queryFn: () => api.listBlockouts(query),
    enabled: Boolean(org),
  });
};

export const useImports = (options?: { refetchInterval?: number | false }) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.imports(org),
    queryFn: () => api.listImports(),
    enabled: Boolean(org),
    ...options,
  });
};

export const useSongbooks = () => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songbooks(org),
    queryFn: () => api.listSongbooks(),
    enabled: Boolean(org),
  });
};

export const useSongbook = (id: string | undefined) => {
  const org = useOrg();
  return useQuery({
    queryKey: keys.songbook(org, id ?? ''),
    queryFn: () => api.getSongbook(id!),
    enabled: Boolean(org && id),
  });
};

/** Invalidates everything under the active organization. */
export const useInvalidateOrg = () => {
  const org = useOrg();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: keys.all(org) });
};

export const useRespondToAssignment = () => {
  const invalidate = useInvalidateOrg();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'confirmed' | 'declined' }) =>
      api.respondToAssignment(id, { status }),
    onSuccess: invalidate,
  });
};
