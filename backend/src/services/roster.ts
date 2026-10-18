import type {
  IdentityReconciliation,
  PersonIdentityReconciliationRow,
  GlobalSearchHit,
  GlobalSearchResults,
  PersonRosterEvent,
  PersonRosterEventRow,
  RosterTagCatalog,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import {
  buildTagCatalog,
  searchPattern,
  toSearchGroup,
  withActorNames,
  withReconciliationNames,
} from '../model/roster.model.js';

export interface RosterScope {
  db: Db;
  orgId: string;
}

export interface GlobalSearchInput extends RosterScope {
  query: string;
  limit: number;
  /** people.view_private / people.manage: may match and see contact fields. */
  canReadPrivate: boolean;
}

interface SearchPersonRow {
  id: string;
  first_name: string;
  last_name: string | null;
  campus: string | null;
  email?: string | null;
  archived_at: string | null;
}

interface SearchPositionRow {
  id: string;
  name: string;
  team: { id: string; name: string } | null;
}

interface SearchPlanRow {
  id: string;
  title: string;
  service_date: string;
}

interface SearchSongRow {
  id: string;
  title: string;
  author: string | null;
}

interface SearchMediaRow {
  id: string;
  filename: string;
  song_id: string | null;
  plan_id: string | null;
}

const words = (query: string): string[] => query.split(/\s+/).filter(Boolean).slice(0, 4);

/**
 * People by every word of the name; contact fields are matched only for
 * callers who could read them on the person's page anyway.
 */
const searchPeople = async (input: GlobalSearchInput, fetchCount: number): Promise<GlobalSearchHit[]> => {
  const source = input.canReadPrivate ? 'people' : 'people_directory';
  const columns: string = input.canReadPrivate
    ? 'id, first_name, last_name, campus, email, archived_at'
    : 'id, first_name, last_name, campus, archived_at';
  let query = raw(input.db).from(source).select(columns).eq('organization_id', input.orgId);
  for (const word of words(input.query)) {
    const pattern = searchPattern(word);
    const fields = input.canReadPrivate ? ['first_name', 'last_name', 'email'] : ['first_name', 'last_name'];
    query = query.or(fields.map((field) => `${field}.ilike.${pattern}`).join(','));
  }
  const rows = ((await unwrap(query.order('first_name').limit(fetchCount))) ?? []) as unknown as SearchPersonRow[];
  return rows.map((row) => ({
    kind: 'person',
    id: row.id,
    title: [row.first_name, row.last_name].filter(Boolean).join(' '),
    subtitle: (input.canReadPrivate ? row.email : null) ?? row.campus ?? null,
    href: `/people/${row.id}`,
    archived: row.archived_at !== null,
  }));
};

export const globalSearch = async (input: GlobalSearchInput): Promise<GlobalSearchResults> => {
  const fetchCount = input.limit + 1;
  const pattern = searchPattern(input.query);
  const db = raw(input.db);

  const [people, teams, positions, plans, songs, media] = await Promise.all([
    searchPeople(input, fetchCount),
    unwrap(
      db.from('teams').select('id, name').eq('organization_id', input.orgId).ilike('name', pattern).order('name').limit(fetchCount),
    ) as Promise<Array<{ id: string; name: string }> | null>,
    unwrap(
      db
        .from('team_positions')
        .select('id, name, team:teams!inner(id, name, organization_id)')
        .eq('team.organization_id', input.orgId)
        .is('plan_id', null)
        .ilike('name', pattern)
        .order('name')
        .limit(fetchCount),
    ) as Promise<SearchPositionRow[] | null>,
    unwrap(
      db
        .from('plans')
        .select('id, title, service_date')
        .eq('organization_id', input.orgId)
        .ilike('title', pattern)
        .order('service_date', { ascending: false })
        .limit(fetchCount),
    ) as Promise<SearchPlanRow[] | null>,
    unwrap(
      db
        .from('songs')
        .select('id, title, author')
        .eq('organization_id', input.orgId)
        .or(`title.ilike.${pattern},author.ilike.${pattern}`)
        .order('title')
        .limit(fetchCount),
    ) as Promise<SearchSongRow[] | null>,
    unwrap(
      db
        .from('attachments')
        .select('id, filename, song_id, plan_id')
        .eq('organization_id', input.orgId)
        .ilike('filename', pattern)
        .order('filename')
        .limit(fetchCount),
    ) as Promise<SearchMediaRow[] | null>,
  ]);

  return {
    query: input.query,
    groups: [
      toSearchGroup('person', people, input.limit),
      toSearchGroup(
        'team',
        (teams ?? []).map((row) => ({ kind: 'team', id: row.id, title: row.name, subtitle: null, href: `/teams?team=${row.id}` })),
        input.limit,
      ),
      toSearchGroup(
        'position',
        (positions ?? []).map((row) => ({
          kind: 'position',
          id: row.id,
          title: row.name,
          subtitle: row.team?.name ?? null,
          href: `/teams?team=${row.team?.id ?? ''}`,
        })),
        input.limit,
      ),
      toSearchGroup(
        'plan',
        (plans ?? []).map((row) => ({ kind: 'plan', id: row.id, title: row.title, subtitle: row.service_date, href: `/plans/${row.id}` })),
        input.limit,
      ),
      toSearchGroup(
        'song',
        (songs ?? []).map((row) => ({ kind: 'song', id: row.id, title: row.title, subtitle: row.author, href: `/songs/${row.id}` })),
        input.limit,
      ),
      toSearchGroup(
        'media',
        (media ?? []).map((row) => ({
          kind: 'media',
          id: row.id,
          title: row.filename,
          subtitle: row.song_id ? 'Song file' : row.plan_id ? 'Plan file' : null,
          href: row.song_id ? `/songs/${row.song_id}` : row.plan_id ? `/plans/${row.plan_id}` : '/songs',
        })),
        input.limit,
      ),
    ].filter((group) => group.hits.length > 0),
  };
};

/** Groups, catalogue and the tags people actually carry (RLS-scoped). */
export const loadTagCatalog = async ({ db, orgId }: RosterScope): Promise<RosterTagCatalog> => {
  const [groups, catalog, used] = await Promise.all([
    unwrap(db.from('person_tag_groups').select('*').eq('organization_id', orgId)),
    unwrap(db.from('person_tag_catalog').select('tag, group_id').eq('organization_id', orgId)),
    unwrap(db.from('person_tags').select('tag').eq('organization_id', orgId)),
  ]);
  return buildTagCatalog(groups ?? [], catalog ?? [], (used ?? []).map((row) => row.tag));
};

export interface RosterAuditInput extends RosterScope {
  personId?: string;
  limit: number;
}

export const loadRosterAudit = async (input: RosterAuditInput): Promise<PersonRosterEvent[]> => {
  let query = input.db
    .from('person_roster_events')
    .select('*')
    .eq('organization_id', input.orgId)
    .order('created_at', { ascending: false })
    .limit(input.limit);
  if (input.personId) query = query.eq('person_id', input.personId);
  const rows = ((await unwrap(query)) ?? []) as PersonRosterEventRow[];

  const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length
    ? ((await unwrap(input.db.from('profiles').select('id, full_name').in('id', actorIds))) ?? [])
    : [];
  return withActorNames(rows, new Map(actors.map((actor) => [actor.id, actor.full_name])));
};

/** Names both Persons of each report from the member-visible directory. */
export const nameReconciliations = async (
  db: Db,
  rows: readonly PersonIdentityReconciliationRow[],
): Promise<IdentityReconciliation[]> => {
  const ids = [...new Set(rows.flatMap((row) => [row.person_id, row.candidate_person_id]))];
  const people = ids.length ? ((await unwrap(db.from('people_directory').select('id, first_name, last_name').in('id', ids))) ?? []) : [];
  return withReconciliationNames(
    rows,
    new Map(people.map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')])),
  );
};

/** Open reports first, then the most recently decided. Administrators only (RLS). */
export const loadReconciliations = async ({ db, orgId }: RosterScope): Promise<IdentityReconciliation[]> => {
  const rows = ((await unwrap(
    db
      .from('person_identity_reconciliations')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200),
  )) ?? []) as PersonIdentityReconciliationRow[];
  const openFirst = [...rows].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));
  return nameReconciliations(db, openFirst);
};
