import {
  decodePeopleCursor,
  encodePeopleCursor,
  type ListPeoplePageQuery,
  type PublicProfileRow,
  type RosterPerson,
  type RosterPersonPage,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
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

/** Quotes a value for a PostgREST `or=` filter. */
const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** `%`/`_` are LIKE wildcards; commas, quotes and parens are or-filter syntax (handled by quote). */
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

const loadBase = async (
  caller: PeoplePageCaller,
  query: ListPeoplePageQuery,
  after: { sort_name: string; id: string } | null,
  count: number,
): Promise<PageRow[]> => {
  const columns = caller.canReadPrivate ? `${PERSON_COLUMNS}, sort_name` : '*';
  let builder = raw(caller.db)
    .from(caller.canReadPrivate ? 'people' : 'people_directory')
    .select(columns)
    .eq('organization_id', caller.orgId);
  if (!query.include_archived) builder = builder.is('archived_at', null);
  if (query.q) {
    const pattern = quote(likePattern(query.q.toLowerCase()));
    const fields = caller.canReadPrivate ? ['sort_name', 'email', 'phone', 'campus'] : ['sort_name', 'campus'];
    builder = builder.or(fields.map((field) => `${field}.ilike.${pattern}`).join(','));
  }
  if (after) {
    builder = builder.or(`sort_name.gt.${quote(after.sort_name)},and(sort_name.eq.${quote(after.sort_name)},id.gt.${after.id})`);
  }
  const rows = (await unwrap(builder.order('sort_name').order('id').limit(count))) as unknown as Array<Record<string, unknown>> | null;
  return (rows ?? []).map((row) => ({ email: null, phone: null, ...row }) as unknown as PageRow);
};

/**
 * One keyset page of the People list. The base rows are paged in SQL
 * (`sort_name, id`); members, contacts and pending invitations are loaded for
 * that page's people only, and `mergeRoster` shapes each row exactly as
 * GET /people does. A person whose login is no longer an active membership is
 * skipped (as `mergeRoster` always did), so the loop keeps reading until the
 * page is full or the list ends. Every active member has a `people` row
 * (MOB-005 trigger), so every member appears in exactly one page.
 */
export const listPeoplePage = async (caller: PeoplePageCaller, query: ListPeoplePageQuery): Promise<RosterPersonPage> => {
  let after = query.cursor ? decodePeopleCursor(query.cursor) : null;
  if (query.cursor && !after) throw HttpError.badRequest('Invalid cursor');

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
