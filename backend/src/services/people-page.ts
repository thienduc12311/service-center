import {
  decodePeopleCursor,
  encodePeopleCursor,
  type ListPeoplePageQuery,
  type PeopleCursor,
  type PublicProfileRow,
  type RosterPerson,
  type RosterPersonPage,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { peopleKeysetFilter } from '../lib/keyset.js';
import { rawSelect, whereSearchMatches, type RawQuery } from '../lib/search.js';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import {
  PERSON_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  mergeRoster,
  type ActiveMemberRow,
  type RosterPersonRecord,
} from '../model/people.js';
import { NO_CONTACT, contactsFor } from './contacts.js';

export interface MemberWithPublicProfile extends Omit<ActiveMemberRow, 'profile'> {
  profile: PublicProfileRow;
}

export interface PeoplePageCaller {
  db: Db;
  orgId: string;
  userId: string;
  /** Owner: reads `people` (contact included); everyone else reads `people_directory`. */
  canReadPrivate: boolean;
}

/** A `people`/`people_directory` row plus the keyset column. */
type PageRow = RosterPersonRecord & { sort_name: string };

/** Attaches the contact details the caller may see, as GET /people does. */
export const toActiveMembers = async (
  caller: Pick<PeoplePageCaller, 'db' | 'orgId' | 'userId' | 'canReadPrivate'>,
  rawMembers: readonly MemberWithPublicProfile[],
): Promise<ActiveMemberRow[]> => {
  const contacts = await contactsFor(caller.db, caller.orgId, rawMembers.map((member) => member.profile?.id).filter(Boolean));
  return rawMembers
    .filter((member) => member.profile)
    .map((member) => ({
      ...member,
      profile: {
        ...member.profile,
        ...(caller.canReadPrivate || member.profile.id === caller.userId ? contacts.get(member.profile.id) ?? NO_CONTACT : NO_CONTACT),
      },
    }));
};

/**
 * Where a page comes from. Owner: `people` for the plain list;
 * `people_owner_search` when searching, so email/phone match the contact the
 * list displays (the login profile's, else the People row's). Everyone else:
 * the `people_directory` projection (name and campus only). Both views carry
 * `search_text` (folded searchable text) and `listed` (the row belongs on the
 * People list); `people` has `search_text` (name and campus) only.
 */
interface PeopleSource {
  from: 'people' | 'people_owner_search' | 'people_directory';
  columns: string;
  /** Whether the source has the `listed` column, so unlisted logins are skipped in SQL. */
  hasListed: boolean;
}

const ROSTER_RECORD_COLUMNS = 'id, profile_id, first_name, last_name, avatar_url, email, phone, campus, archived_at, sort_name';
const DIRECTORY_COLUMNS = 'id, profile_id, first_name, last_name, avatar_url, campus, archived_at, sort_name';

const sourceFor = (caller: PeoplePageCaller, searching: boolean): PeopleSource => {
  if (!caller.canReadPrivate) return { from: 'people_directory', columns: DIRECTORY_COLUMNS, hasListed: true };
  if (searching) return { from: 'people_owner_search', columns: ROSTER_RECORD_COLUMNS, hasListed: true };
  return { from: 'people', columns: `${PERSON_COLUMNS}, sort_name`, hasListed: false };
};

/** Embeds the caller's team filter: `!inner` keeps only people with a membership in that team. */
const TEAM_EMBED = 'team_memberships!inner()';

/** The filters every page and the total share: organization, archive, search, team. */
interface PeopleFilters {
  orgId: string;
  query: Pick<ListPeoplePageQuery, 'q' | 'team_id' | 'include_archived'>;
}

const applyFilters = (builder: RawQuery, { orgId, query }: PeopleFilters, hasListed: boolean): RawQuery => {
  let narrowed = builder.eq('organization_id', orgId);
  if (hasListed) narrowed = narrowed.eq('listed', true);
  if (!query.include_archived) narrowed = narrowed.is('archived_at', null);
  if (query.team_id) narrowed = narrowed.eq('team_memberships.team_id', query.team_id);
  return whereSearchMatches(narrowed, query.q);
};

const loadBase = async (
  caller: PeoplePageCaller,
  query: ListPeoplePageQuery,
  after: PeopleCursor | null,
  count: number,
): Promise<PageRow[]> => {
  const source = sourceFor(caller, Boolean(query.q));
  const columns = query.team_id ? `${source.columns}, ${TEAM_EMBED}` : source.columns;
  let builder = applyFilters(rawSelect(caller.db, source.from, columns), { orgId: caller.orgId, query }, source.hasListed);
  if (after) {
    builder = builder.or(peopleKeysetFilter(after, 'after'));
  }
  const rows = (await unwrap(builder.order('sort_name').order('id').limit(count))) as unknown as Array<Record<string, unknown>> | null;
  return (rows ?? []).map((row) => ({ email: null, phone: null, ...row }) as unknown as PageRow);
};

/**
 * How many people the list shows for these filters, across every page. Counted
 * on a view with `listed` (the owner's covers contact search too), so a login
 * whose membership is inactive — skipped by the page loop — is not counted.
 */
const countPeople = async (caller: PeoplePageCaller, query: ListPeoplePageQuery): Promise<number> => {
  const from = caller.canReadPrivate ? 'people_owner_search' : 'people_directory';
  const columns = query.team_id ? `id, ${TEAM_EMBED}` : 'id';
  const builder = applyFilters(
    rawSelect(caller.db, from, columns, { count: 'exact', head: true }),
    { orgId: caller.orgId, query },
    true,
  );
  const { count, error } = await builder;
  if (error) throw fromPostgrestError(error);
  return count ?? 0;
};

/** A page's rows and where the next page starts. */
type PeoplePageRows = Omit<RosterPersonPage, 'total'>;

/**
 * One keyset page of the People list. The base rows are paged in SQL
 * (`sort_name, id`); members, contacts and pending invitations are loaded for
 * that page's people only, and `mergeRoster` shapes each row exactly as
 * GET /people does. A person whose login is no longer an active membership is
 * skipped (as `mergeRoster` always did), so the loop keeps reading until the
 * page is full or the list ends. Every active member has a `people` row
 * (MOB-005 trigger), so every member appears in exactly one page.
 */
const loadPeoplePage = async (
  caller: PeoplePageCaller,
  query: ListPeoplePageQuery,
  cursor: PeopleCursor | null,
): Promise<PeoplePageRows> => {
  let after = cursor;

  const kept: PageRow[] = [];
  const members: ActiveMemberRow[] = [];
  let exhausted = false;
  while (kept.length < query.limit && !exhausted) {
    const need = query.limit - kept.length;
    const fetched = await loadBase(caller, query, after, need + 1);
    const slice = fetched.slice(0, need);
    exhausted = fetched.length <= need;
    const last = slice.at(-1);
    if (last) after = { sort_name: last.sort_name, id: last.id };

    const profileIds = slice.map((row) => row.profile_id).filter((id): id is string => id !== null);
    const slicedMembers = profileIds.length
      ? await toActiveMembers(
          caller,
          (await unwrap(
            raw(caller.db)
              .from('organization_members')
              .select(`role, status, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`)
              .eq('organization_id', caller.orgId)
              .neq('status', 'inactive')
              .in('user_id', profileIds),
          )) as unknown as MemberWithPublicProfile[],
        )
      : [];
    const memberIds = new Set(slicedMembers.map((member) => member.profile.id));
    members.push(...slicedMembers);
    kept.push(...slice.filter((row) => row.profile_id === null || memberIds.has(row.profile_id)));
  }

  const standaloneIds = kept.filter((row) => row.profile_id === null).map((row) => row.id);
  const pending = standaloneIds.length
    ? (await unwrap(
        caller.db
          .from('person_invitations')
          .select('person_id')
          .eq('organization_id', caller.orgId)
          .in('person_id', standaloneIds)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .gt('expires_at', new Date().toISOString()),
      )) ?? []
    : [];

  const order = new Map(kept.map((row, index) => [row.id, index]));
  const items: RosterPerson[] = mergeRoster(members, kept, pending, true).sort(
    (a, b) => (order.get(a.person_id ?? '') ?? 0) - (order.get(b.person_id ?? '') ?? 0),
  );
  return { items, next_cursor: exhausted || !after ? null : encodePeopleCursor(after) };
};

/** One page of the People list plus the total for its filters (search, team, archived). */
export const listPeoplePage = async (caller: PeoplePageCaller, query: ListPeoplePageQuery): Promise<RosterPersonPage> => {
  const cursor = query.cursor ? decodePeopleCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw HttpError.badRequest('Invalid cursor');
  const [page, total] = await Promise.all([loadPeoplePage(caller, query, cursor), countPeople(caller, query)]);
  return { ...page, total };
};
