import { adminDb, unwrap } from '../lib/supabase.js';

/**
 * The login whose **confirmed** email is `email` (case-insensitive), or null.
 *
 * This is the only way service-role code may find an existing account by
 * address. `profiles.email` is a display/delivery copy, not an identity: an
 * unconfirmed signup proves nothing about who reads the inbox, so it is never
 * returned (see `confirmed_user_id_by_email`, 20261130000000).
 */
export const findConfirmedUserIdByEmail = async (email: string): Promise<string | null> =>
  unwrap(adminDb.rpc('confirmed_user_id_by_email', { p_email: email }));

/**
 * Whether any login (confirmed or not) holds `email`. Only for choosing which
 * error to answer (W10-SEC-D4: a concurrent accept created it a moment ago);
 * never for linking or authorising — use `findConfirmedUserIdByEmail`.
 */
export const isEmailRegistered = async (email: string): Promise<boolean> =>
  Boolean(await unwrap(adminDb.rpc('auth_email_registered', { p_email: email })));
