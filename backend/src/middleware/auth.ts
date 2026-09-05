import type { NextFunction, Request, Response } from 'express';
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
    }
  }
}

const bearer = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
};

/** Verifies the Supabase JWT and attaches a user-scoped database client. */
export const requireAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = bearer(req);
    if (!token) throw HttpError.unauthorized('Missing bearer token');

    // getUser() validates the signature and expiry against the auth server.
    const { data, error } = await adminDb.auth.getUser(token);
    if (error || !data.user) throw HttpError.unauthorized('Invalid or expired session');

    req.auth = { userId: data.user.id, email: data.user.email ?? null, accessToken: token };
    req.db = userDb(token);
    next();
  } catch (err) {
    next(err);
  }
};
