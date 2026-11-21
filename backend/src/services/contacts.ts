import { unwrap, type Db } from '../lib/supabase.js';

/** Email and phone the caller may see for one person. */
export interface MemberContact {
  email: string | null;
  phone: string | null;
}

/**
 * Contact details are not selectable from `profiles` by API roles; the
 * database returns them only for the caller themself or a holder of
 * people.view_private. Everyone else gets no entry, which callers render as
 * "not shown".
 */
const CONTACT_CHUNK_SIZE = 500;

export const contactsFor = async (
  db: Db,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, MemberContact>> => {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  // Chunked so each rpc answer stays under PostgREST's 1000-row cap (W8-PERF-D2).
  const contacts = new Map<string, MemberContact>();
  for (let start = 0; start < ids.length; start += CONTACT_CHUNK_SIZE) {
    const rows = (await unwrap(db.rpc('member_contacts', { p_org: orgId, p_user_ids: ids.slice(start, start + CONTACT_CHUNK_SIZE) }))) ?? [];
    for (const row of rows) contacts.set(row.user_id, { email: row.email, phone: row.phone });
  }
  return contacts;
};

export const NO_CONTACT: MemberContact = { email: null, phone: null };
