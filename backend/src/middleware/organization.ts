import type { NextFunction, Request, Response } from 'express';
import {
  ACCESS_CAPABILITY_LABELS,
  canAccessAnywhere,
  canEditTeamRosterAnywhere,
  isAdmin,
  isLeader,
  ORGANIZATION_DISABLED,
  type AccessCapability,
  type DisabledOrganization,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { isUuid } from '../lib/params.js';
import { loadMyOrganizationContext } from '../services/organization-context.js';
import { recordPlatformAccessRequest } from '../services/platform-admin.js';

/** Requests that only read are not audited. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A super admin acting as a temporary owner: every change they make through
 * the API is written to platform_audit_log once the response is sent.
 */
const auditPlatformAccess = (req: Request, res: Response): void => {
  if (READ_METHODS.has(req.method)) return;
  const organizationId = req.orgId;
  const actor = { userId: req.auth.userId };
  res.on('finish', () => {
    recordPlatformAccessRequest(actor, {
      organizationId,
      method: req.method,
      path: req.originalUrl.split('?')[0] ?? req.originalUrl,
      status: res.statusCode,
    }).catch((error: unknown) => {
      console.error(`[platform-admin] auditing a request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    });
  });
};

/** Not a member any more because a super admin disabled the church: say so. */
const disabledChurchError = (disabled: DisabledOrganization[], requested: string | null): HttpError | null => {
  const match = requested ? disabled.find((org) => org.organization_id === requested) : disabled[0];
  if (!match) return null;
  return new HttpError(403, 'This church has been disabled', ORGANIZATION_DISABLED, {
    organization_id: match.organization_id,
    organization_name: match.organization_name,
    disabled_reason: match.disabled_reason,
  });
};

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
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const requested =
      (req.header('X-Organization-Id') ?? (req.query.organization_id as string | undefined))?.trim() ||
      null;
    if (requested && !isUuid(requested)) throw HttpError.badRequest('Invalid X-Organization-Id header');

    const { memberships, disabledOrganizations } = await loadMyOrganizationContext(
      req.db, req.auth.userId, requested ? { p_org: requested } : {},
    );
    if (memberships.length === 0) {
      throw disabledChurchError(disabledOrganizations, requested) ?? HttpError.forbidden('You are not a member of any organization yet');
    }

    const membership = requested
      ? memberships.find((m) => m.organizationId === requested)
      : memberships.length === 1
        ? memberships[0]
        : undefined;

    if (!membership) {
      const disabled = requested ? disabledChurchError(disabledOrganizations, requested) : null;
      if (disabled) throw disabled;
      throw requested
        ? HttpError.forbidden('You are not a member of that organization')
        : HttpError.badRequest(
            'Multiple organizations available — send an X-Organization-Id header',
            { organization_ids: memberships.map((m) => m.organizationId) },
          );
    }

    req.orgId = membership.organizationId;
    req.orgRole = membership.role;
    req.access = membership.access;
    // A super admin inside the church as a temporary owner.
    if (membership.platformAccessExpiresAt) auditPlatformAccess(req, res);
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

/**
 * Owners, admins and team leaders: who is on a team. A legacy scheduler's
 * role alone does not qualify; RLS (`can_edit_team_roster`) decides the team.
 */
export const requireRosterEditor = (req: Request, _res: Response, next: NextFunction): void => {
  if (!canEditTeamRosterAnywhere(req.access)) {
    next(HttpError.forbidden('Only organization admins and team leaders can change who is on a team'));
    return;
  }
  next();
};
