import { Router } from 'express';
import { param } from '../lib/params.js';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { isAdmin, type OrganizationRow } from '@service-center/shared';
import { getChurchCreationPolicy, isExpiredPlatformAccess } from '../services/organization-platform.js';
import { recordPlatformAccessRequest } from '../services/platform-admin.js';

export const organizationsRouter: Router = Router();

/** An active membership with its church, for the church switcher. */
interface MembershipWithOrganizationRow {
  role: string;
  platform_access_expires_at: string | null;
  organization: OrganizationRow | null;
}

organizationsRouter.get('/', async (req, res) => {
  const rows = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, platform_access_expires_at, organization:organizations(*)')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active'),
  )) as unknown as MembershipWithOrganizationRow[];

  res.json(
    rows
      .filter((r) => r.organization && !isExpiredPlatformAccess(r.platform_access_expires_at))
      .map((r) => ({ organization: r.organization, role: r.role })),
  );
});

/** Whether the app offers "Create a church" or "Apply for a church". */
organizationsRouter.get('/creation-policy', async (req, res) => {
  res.json(await getChurchCreationPolicy(req.db));
});

/**
 * Creating an organization and joining it as owner happens inside a single
 * SECURITY DEFINER function, otherwise RLS would hide the row from its creator.
 * Only while self-serve creation is on: otherwise 403
 * `church_application_required` (apply at /api/v1/church-applications).
 */
organizationsRouter.post('/', validateBody(createOrganizationSchema), async (req, res) => {
  const { name, slug, timezone } = req.body;
  const { data, error } = await raw(req.db).rpc('create_organization', {
    p_name: name,
    p_slug: slug,
    p_timezone: timezone,
  });

  if (error) {
    if (error.code === '23505') throw HttpError.conflict('That URL slug is already taken');
    throw fromPostgrestError(error);
  }
  res.status(201).json(data);
});

organizationsRouter.patch('/:id', validateBody(updateOrganizationSchema), async (req, res) => {
  const organizationId = param(req, 'id');
  const membership = await unwrap(
    req.db
      .from('organization_members')
      .select('role, platform_access_expires_at')
      .eq('organization_id', organizationId)
      .eq('user_id', req.auth.userId)
      .eq('status', 'active')
      .maybeSingle(),
  );
  if (!membership || !isAdmin(membership.role) || isExpiredPlatformAccess(membership.platform_access_expires_at)) {
    throw HttpError.forbidden('Only organization admins can change settings');
  }

  const updated = await unwrapOne(
    req.db.from('organizations').update(req.body).eq('id', organizationId).select('*').single(),
  );
  // A super admin inside the church as a temporary owner: keep a record.
  if (membership.platform_access_expires_at) {
    await recordPlatformAccessRequest(
      { userId: req.auth.userId },
      { organizationId, method: req.method, path: req.originalUrl.split('?')[0] ?? req.originalUrl, status: 200 },
    );
  }
  res.json(updated);
});
