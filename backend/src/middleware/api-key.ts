import type { NextFunction, Request, Response } from 'express';
import { API_KEY_PATTERN, EXTERNAL_API_VERSION, type ApiScope } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { adminDb, unwrap } from '../lib/supabase.js';
import { hashApiSecret } from '../services/api-credentials.js';

/** The caller of an external API request: an organization credential, not a person. */
export interface ApiCredentialContext {
  credentialId: string;
  orgId: string;
  scopes: ApiScope[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireApiKey` on external API routes only. */
      apiCredential: ApiCredentialContext;
    }
  }
}

const isScope = (value: string): value is ApiScope => value === 'plans.read' || value === 'songs.read';

/**
 * Authenticates `Authorization: Bearer sck_…`. Supabase session tokens are
 * not accepted here, and API keys are not accepted by first-party routes.
 * Revocation, expiry and the issuer's administrator role are re-checked on
 * every request; the per-minute limit is counted in the database.
 */
export const requireApiKey = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.setHeader('Service-Center-Api-Version', EXTERNAL_API_VERSION);
    res.setHeader('Cache-Control', 'no-store');
    const header = req.header('authorization') ?? '';
    const [, prefix, secret] = API_KEY_PATTERN.exec(header.startsWith('Bearer ') ? header.slice(7).trim() : '') ?? [];
    if (!prefix || !secret) throw new HttpError(401, 'An API key is required', 'invalid_api_key');

    const rows = await unwrap(adminDb.rpc('api_authenticate', { p_key_prefix: prefix, p_secret_hash: hashApiSecret(secret) }));
    const auth = rows?.[0];
    if (!auth || auth.outcome === 'invalid') throw new HttpError(401, 'Invalid API key', 'invalid_api_key');
    if (auth.outcome === 'inactive') throw new HttpError(401, 'This API key is revoked, expired or no longer valid', 'api_key_inactive');

    if (auth.rate_limit !== null && auth.remaining !== null && auth.reset_at) {
      const resetSeconds = Math.max(0, Math.ceil((Date.parse(auth.reset_at) - Date.now()) / 1000));
      res.setHeader('RateLimit-Limit', auth.rate_limit);
      res.setHeader('RateLimit-Remaining', auth.remaining);
      res.setHeader('RateLimit-Reset', resetSeconds);
      if (auth.outcome === 'rate_limited') {
        res.setHeader('Retry-After', resetSeconds);
        throw new HttpError(429, 'Rate limit exceeded for this API key', 'rate_limited');
      }
    }
    if (!auth.credential_id || !auth.organization_id) throw new HttpError(401, 'Invalid API key', 'invalid_api_key');
    req.apiCredential = {
      credentialId: auth.credential_id,
      orgId: auth.organization_id,
      scopes: (auth.scopes ?? []).filter(isScope),
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** Route guard; the database functions enforce the same scope again. */
export const requireScope =
  (scope: ApiScope) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiCredential.scopes.includes(scope)) {
      next(new HttpError(403, `This API key lacks the ${scope} scope`, 'insufficient_scope'));
      return;
    }
    next();
  };
