import type { NextFunction, Request, Response } from 'express';
import { canManage, isAdmin, type OrgRole } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';

/**
 * Resolves the active organization from the X-Organization-Id header (or an
 * `organization_id` query param) and confirms the caller is an active member.
 * When the caller belongs to exactly one org, that one is used implicitly.
 */
export const withOrganization = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const requested =
      (req.header('X-Organization-Id') ?? (req.query.organization_id as string | undefined))?.trim() ||
      null;

    const { data, error } = await req.db
      .from('organization_members')
      .select('organization_id, role')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active');

    if (error) throw new HttpError(500, error.message);

    const memberships = data ?? [];
    if (memberships.length === 0) {
      throw HttpError.forbidden('You are not a member of any organization yet');
    }

    const membership = requested
      ? memberships.find((m) => m.organization_id === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (!membership) {
      throw requested
        ? HttpError.forbidden('You are not a member of that organization')
        : HttpError.badRequest(
            'Multiple organizations available — send an X-Organization-Id header',
            { organization_ids: memberships.map((m) => m.organization_id) },
          );
    }

    req.orgId = membership.organization_id;
    req.orgRole = membership.role as OrgRole;
    next();
  } catch (err) {
    next(err);
  }
};

/** Owners, admins and schedulers: may edit plans, songs, teams, schedules. */
export const requireManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!canManage(req.orgRole)) {
    next(HttpError.forbidden('Only schedulers and admins can do that'));
    return;
  }
  next();
};

/** Owners and admins only: membership and organization settings. */
export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!isAdmin(req.orgRole)) {
    next(HttpError.forbidden('Only organization admins can do that'));
    return;
  }
  next();
};
