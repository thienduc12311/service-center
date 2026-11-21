import { createClient, type RealtimeClientOptions, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@service-center/shared';
import { config } from '../config.js';
import { HttpError, fromPostgrestError } from './errors.js';
import { createTimeoutFetch } from './fetch-timeout.js';

export type Db = SupabaseClient<Database>;

/**
 * supabase-js resolves a WebSocket constructor when it builds its realtime
 * client, and Node 20 has no global `WebSocket`. The API server never opens a
 * realtime channel — clients subscribe directly — so hand it a transport that
 * fails loudly if anything ever tries, rather than pulling in `ws`.
 */
const realtime: RealtimeClientOptions = {
  transport: class {
    constructor() {
      throw new Error('Realtime is not enabled on the API server; subscribe from the client instead.');
    }
  } as unknown as RealtimeClientOptions['transport'],
};

/** Bounds every upstream call; a slow Supabase surfaces as 504 instead of hanging. */
const timeoutFetch = createTimeoutFetch({
  requestMs: config.SUPABASE_REQUEST_TIMEOUT_MS ?? 15_000,
  storageMs: config.SUPABASE_STORAGE_TIMEOUT_MS ?? 60_000,
});

/**
 * Service-role client. Bypasses RLS entirely — only use it for work the user
 * genuinely cannot do themselves (inviting people, sending notifications,
 * notifications). Every such call must check org membership first.
 */
export const adminDb: Db = createClient<Database, 'public'>(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: timeoutFetch }, realtime },
);

/**
 * Client bound to the caller's JWT, so Postgres RLS decides what they can see.
 * This is the default path for request handlers.
 */
export const userDb = (accessToken: string): Db =>
  createClient<Database, 'public'>(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` }, fetch: timeoutFetch },
    realtime,
  });

/**
 * Untyped view of a client. Our hand-written `Database` type deliberately
 * leaves `Relationships` empty, so deeply embedded PostgREST selects are typed
 * at the call site with an explicit cast instead.
 */
export const raw = (db: Db): SupabaseClient => db as unknown as SupabaseClient;

interface PostgrestLike<T> {
  data: T;
  error: { code?: string; message: string; details?: string | null; hint?: string | null } | null;
}

/** Unwraps a PostgREST response, throwing a mapped HttpError on failure. */
export const unwrap = async <T>(query: PromiseLike<PostgrestLike<T>>): Promise<T> => {
  const { data, error } = await query;
  if (error) throw fromPostgrestError(error);
  return data;
};

/**
 * For queries ending in `.single()`. PostgREST answers with an error (PGRST116)
 * rather than an empty body when no row matches, so a null here means the row
 * was hidden by RLS — which should read as "not found", not as a crash.
 */
export const unwrapOne = async <T>(query: PromiseLike<PostgrestLike<T>>): Promise<NonNullable<T>> => {
  const data = await unwrap(query);
  if (data === null || data === undefined) throw HttpError.notFound();
  return data as NonNullable<T>;
};

/**
 * For `.delete()...select('id')`. A delete that matches nothing (wrong id,
 * another organization, or hidden by RLS) is a 404, never a silent 204.
 */
export const unwrapDeleted = async (
  query: PromiseLike<PostgrestLike<readonly unknown[] | null>>,
  notFoundMessage = 'Not found',
): Promise<void> => {
  const deleted = await unwrap(query);
  if (!deleted || deleted.length === 0) throw HttpError.notFound(notFoundMessage);
};
