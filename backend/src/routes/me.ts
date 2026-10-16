import { Router, type Request } from 'express';
import {
  updateProfileSchema,
  type AccessMode,
  type CalendarFeedTokenResponse,
  type CurrentUser,
  type OrgRole,
  type OrganizationRow,
} from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { generateCalendarFeedToken } from '../services/calendar-feed-tokens.js';
import { loadMyAccess } from '../services/access.js';
import { config } from '../config.js';

export const meRouter: Router = Router();

interface MembershipWithOrganization {
  role: OrgRole;
  access_mode: AccessMode;
  organization: OrganizationRow | null;
}

/**
 * The signed-in profile plus every organization the user belongs to, each
 * with the caller's effective access there (F01), so clients can show the
 * actions that are actually allowed.
 */
meRouter.get('/', async (req, res) => {
  // Contact columns are not selectable from `profiles`; my_profile() returns your own.
  const profile = await unwrapOne(req.db.rpc('my_profile'));

  const memberships = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, access_mode, organization:organizations(*)')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active'),
  )) as unknown as MembershipWithOrganization[];

  const payload: CurrentUser = {
    profile,
    memberships: await Promise.all(
      memberships
        .filter((m): m is MembershipWithOrganization & { organization: OrganizationRow } => Boolean(m.organization))
        .map(async (m) => ({
          organization: m.organization,
          role: m.role,
          access: await loadMyAccess(req.db, m.organization.id, req.auth.userId, m),
        })),
    ),
  };

  res.json(payload);
});

meRouter.patch('/', validateBody(updateProfileSchema), async (req, res) => {
  const updated = await unwrap(
    req.db.from('profiles').update(req.body).eq('id', req.auth.userId).select('id').maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Profile not found');
  res.json(await unwrapOne(req.db.rpc('my_profile')));
});

const activeOrganizationForMe = async (req: Request): Promise<string> => {
  const memberships = (await unwrap(req.db.from('organization_members').select('organization_id').eq('user_id', req.auth.userId).eq('status', 'active'))) ?? [];
  const requested = req.header('X-Organization-Id');
  const organizationId = requested ?? (memberships.length === 1 ? memberships[0]?.organization_id : undefined);
  if (!organizationId || !memberships.some((membership) => membership.organization_id === organizationId)) {
    throw HttpError.badRequest('Choose an organization before managing your schedule feed');
  }
  return organizationId;
};

meRouter.get('/calendar-feed', async (req, res) => {
  const organizationId = await activeOrganizationForMe(req);
  const token = await unwrap(req.db.from('calendar_feed_tokens').select('id').eq('organization_id', organizationId).eq('user_id', req.auth.userId).is('revoked_at', null).maybeSingle());
  const response: CalendarFeedTokenResponse = { url: null, webcal_url: null, active: Boolean(token) };
  res.json(response);
});

meRouter.post('/calendar-feed', async (req, res) => {
  const organizationId = await activeOrganizationForMe(req);
  await unwrap(req.db.from('calendar_feed_tokens').update({ revoked_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('user_id', req.auth.userId).is('revoked_at', null));
  const generated = generateCalendarFeedToken();
  await unwrap(req.db.from('calendar_feed_tokens').insert({ organization_id: organizationId, user_id: req.auth.userId, token_hash: generated.tokenHash }));
  const url = `${config.API_URL}/api/v1/calendar-feed/${generated.token}.ics`;
  const response: CalendarFeedTokenResponse = { url, webcal_url: url.replace(/^https?:\/\//, 'webcal://'), token: generated.token, active: true };
  res.status(201).json(response);
});
