import { Router, type Request } from 'express';
import { updateProfileSchema, type CalendarFeedTokenResponse, type CurrentUser } from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { generateCalendarFeedToken } from '../services/calendar-feed-tokens.js';
import { config } from '../config.js';

export const meRouter: Router = Router();

/** The signed-in profile plus every organization the user belongs to. */
meRouter.get('/', async (req, res) => {
  const profile = await unwrapOne(
    req.db.from('profiles').select('*').eq('id', req.auth.userId).single(),
  );

  const memberships = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, organization:organizations(*)')
      .eq('user_id', req.auth.userId)
      .eq('status', 'active'),
  )) as Array<{ role: string; organization: unknown }>;

  const payload: CurrentUser = {
    profile,
    memberships: memberships
      .filter((m) => m.organization)
      .map((m) => ({ organization: m.organization, role: m.role })) as CurrentUser['memberships'],
  };

  res.json(payload);
});

meRouter.patch('/', validateBody(updateProfileSchema), async (req, res) => {
  const updated = await unwrapOne(
    req.db.from('profiles').update(req.body).eq('id', req.auth.userId).select('*').single(),
  );
  if (!updated) throw HttpError.notFound('Profile not found');
  res.json(updated);
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
