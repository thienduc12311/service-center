import type { NextFunction, Request, Response } from 'express';
import { ACCOUNT_BLOCKED, type EffectiveAccess } from '@service-center/shared';
import { adminDb, userDb, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Supabase client bound to the caller — RLS applies. */
      db: Db;
      auth: { userId: string; email: string | null; accessToken: string };
      /** Set by `withOrganization`. */
      orgId: string;
      orgRole: 'owner' | 'admin' | 'scheduler' | 'member';
      /** Set by `withOrganization`: the caller's F01 effective access. */
      access: EffectiveAccess;
    }
  }
}

const bearer = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
};

/** Auth answered, but too slowly (408) or too often asked (429): not a verdict on the token. */
const AUTH_BUSY_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/** The parts of an Auth error that tell an outage from a verdict. */
interface AuthFailure {
  name?: string;
  status?: number;
}

/**
 * True when Auth failed to answer (network, timeout, 408/429, 5xx) rather
 * than judging the token. Any other 4xx from Auth (expired, revoked,
 * malformed, banned) is a verdict and ends the session.
 */
const isAuthOutage =(error: AuthFailure): boolean =>
  error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500 || AUTH_BUSY_STATUSES.has(error.status);

/** The signed-in user behind a verified access token. */
interface VerifiedSession {
  userId: string;
  email: string | null;
}

/**
 * Checks an access token with the Auth server (live user and session checks on
 * every request, PERF-005). Throws 401 for a rejected or blocked session and
 * 503 when Auth could not answer.
 */
const verifyAccessToken = async (token: string): Promise<VerifiedSession> => {
  const { data, error } = await adminDb.auth.getUser(token);
  if (error) {
    // A rejected token ends the session; an Auth outage must not sign people out.
    if (isAuthOutage(error)) throw new HttpError(503, 'Authentication is temporarily unavailable', 'auth_unavailable');
    throw HttpError.unauthorized('Invalid or expired session');
  }
  if (!data.user) throw HttpError.unauthorized('Invalid or expired session');
  // A super admin blocked the account; its sessions were ended too, this covers the rest.
  const bannedUntil = data.user.banned_until ? Date.parse(data.user.banned_until) : Number.NaN;
  if (bannedUntil > Date.now()) throw new HttpError(401, 'This account is blocked', ACCOUNT_BLOCKED);
  return { userId: data.user.id, email: data.user.email ?? null };
};

/**
 * For public routes that behave differently for a signed-in caller: the
 * verified user id, or null when no bearer token was sent. A token that is
 * sent but rejected still fails (401), so a stale session is never mistaken
 * for "signed out".
 */
export const optionalSessionUserId = async (req: Request): Promise<string | null> => {
  const token = bearer(req);
  if (!token) return null;
  return (await verifyAccessToken(token)).userId;
};

/** Verifies the Supabase JWT and attaches a user-scoped database client. */
export const requireAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = bearer(req);
    if (!token) throw HttpError.unauthorized('Missing bearer token');

    const session = await verifyAccessToken(token);
    req.auth = { userId: session.userId, email: session.email, accessToken: token };
    req.db = userDb(token);
    next();
  } catch (err) {
    next(err);
  }
};
