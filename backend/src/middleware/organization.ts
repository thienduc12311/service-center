import type { NextFunction, Request, Response } from 'express';
import {
  ACCESS_CAPABILITY_LABELS,
  canAccessAnywhere,
  isAdmin,
  isLeader,
  type AccessCapability,
  type AccessMode,
  type OrgRole,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { loadMyAccess } from '../services/access.js';

/**
 * Resolves the active organization from the X-Organization-Id header (or an
 * `organization_id` query param) and confirms the caller is an active member.
 * When the caller belongs to exactly one org, that one is used implicitly.
 * Also attaches the caller's effective access (F01), resolved by the same
 * database function RLS uses, so a revoked grant stops working on the next
 * request.
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
      .select('organization_id, role, access_mode')
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
    req.access = await loadMyAccess(req.db, req.orgId, req.auth.userId, {
      role: membership.role as OrgRole,
      access_mode: membership.access_mode as AccessMode,
    });
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Holds `capability` at some scope. The exact service type/team is decided
 * by RLS on the rows the route then touches (a denied row reads as 404).
 */
export const requireCapability =
  (capability: AccessCapability) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!canAccessAnywhere(req.access, capability)) {
      next(HttpError.forbidden(`You need the “${ACCESS_CAPABILITY_LABELS[capability]}” permission to do that`));
      return;
    }
    next();
  };

/** Some planning, scheduling or team capability (the database's `can_manage_org`). */
export const requireManager = (req: Request, _res: Response, next: NextFunction): void => {
  if (!isLeader(req.access)) {
    next(HttpError.forbidden('Only schedulers and leaders can do that'));
    return;
  }
  next();
};

/** Owners and admins only: membership, access and organization settings. */
export const requireAdmin = (req: Request, _res: Response, next: NextFunction): void => {
  if (!isAdmin(req.orgRole)) {
    next(HttpError.forbidden('Only organization admins can do that'));
    return;
  }
  next();
};
