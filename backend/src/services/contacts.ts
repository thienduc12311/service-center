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
export const contactsFor = async (
  db: Db,
  orgId: string,
  userIds: readonly string[],
): Promise<Map<string, MemberContact>> => {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const rows = (await unwrap(db.rpc('member_contacts', { p_org: orgId, p_user_ids: ids }))) ?? [];
  return new Map(rows.map((row) => [row.user_id, { email: row.email, phone: row.phone }]));
};

export const NO_CONTACT: MemberContact = { email: null, phone: null };
