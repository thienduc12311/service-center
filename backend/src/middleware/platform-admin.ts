import type { NextFunction, Request, Response } from 'express';
import { MFA_REQUIRED } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { sessionAssurance, type SessionAssurance } from '../model/platform-admin.model.js';
import { isPlatformAdmin, purgeExpiredPlatformAccess } from '../services/platform-admin.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requirePlatformAdmin`. */
      platformAdmin?: { aal: SessionAssurance };
    }
  }
}

export interface PlatformAdminGuardOptions {
  /**
   * Let a session that has not completed two-factor login through. Only for
   * `GET /admin/session`, which tells the admin app to ask for it.
   */
  allowWithoutMfa?: boolean;
}

/**
 * Super admins only (private.platform_admins), with a two-factor session
 * (`aal2`). Runs after `requireAuth`. Also clears expired "enter as owner"
 * windows, so they never outlive the next admin request.
 */
export const requirePlatformAdmin =
  (options: PlatformAdminGuardOptions = {}) =>
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!(await isPlatformAdmin(req.auth.userId))) {
        throw new HttpError(403, 'Only platform admins can do that', 'not_platform_admin');
      }
      const aal = sessionAssurance(req.auth.accessToken);
      if (!options.allowWithoutMfa && aal !== 'aal2') {
        throw new HttpError(403, 'Finish two-factor sign-in first', MFA_REQUIRED);
      }
      req.platformAdmin = { aal };
      await purgeExpiredPlatformAccess();
      next();
    } catch (err) {
      next(err);
    }
  };
