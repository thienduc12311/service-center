import { Router, type Request } from 'express';
import {
  PERSON_LINK_REQUIRED,
  updateLanguagePreferenceSchema,
  updateProfileSchema,
  type UpdateLanguagePreferenceInput,
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
import { mapLanguagePreferenceRow } from '../model/language.model.js';

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

// The rotate response carries a bearer URL; neither response may be cached on the way.
meRouter.get('/calendar-feed', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const organizationId = await activeOrganizationForMe(req);
  const token = await unwrap(req.db.from('calendar_feed_tokens').select('id').eq('organization_id', organizationId).eq('user_id', req.auth.userId).is('revoked_at', null).maybeSingle());
  const response: CalendarFeedTokenResponse = { url: null, webcal_url: null, active: Boolean(token) };
  res.json(response);
});

meRouter.post('/calendar-feed', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const organizationId = await activeOrganizationForMe(req);
  await unwrap(req.db.from('calendar_feed_tokens').update({ revoked_at: new Date().toISOString() }).eq('organization_id', organizationId).eq('user_id', req.auth.userId).is('revoked_at', null));
  const generated = generateCalendarFeedToken();
  await unwrap(req.db.from('calendar_feed_tokens').insert({ organization_id: organizationId, user_id: req.auth.userId, token_hash: generated.tokenHash }));
  const url = `${config.API_URL}/api/v1/calendar-feed/${generated.token}.ics`;
  const response: CalendarFeedTokenResponse = { url, webcal_url: url.replace(/^https?:\/\//, 'webcal://'), token: generated.token, active: true };
  res.status(201).json(response);
});

/**
 * The church a self-service language call is about: the X-Organization-Id
 * header, or the caller's only church. Membership itself is enforced by the
 * database functions (an inactive or foreign church reads as not found).
 */
const organizationForLanguage = async (req: Request): Promise<string> => {
  const requested = req.header('X-Organization-Id');
  if (requested) return requested;
  const memberships = (await unwrap(
    req.db.from('organization_members').select('organization_id').eq('user_id', req.auth.userId).eq('status', 'active'),
  )) ?? [];
  const only = memberships.length === 1 ? memberships[0]?.organization_id : undefined;
  if (!only) throw new HttpError(400, 'Choose a church before managing your language', 'organization_required');
  return only;
};

/** The caller's own saved language in the active church; null = Automatic. */
meRouter.get('/language-preference', async (req, res) => {
  const organizationId = await organizationForLanguage(req);
  const rows = await unwrap(req.db.rpc('my_language_preference', { p_organization_id: organizationId }));
  res.json(mapLanguagePreferenceRow(rows?.[0]));
});

/**
 * Saves only the caller's own language in the active church. The database
 * function updates that one column on the Person linked to this login; it
 * never accepts a Person id and never creates a Person.
 */
meRouter.patch('/language-preference', validateBody(updateLanguagePreferenceSchema), async (req, res) => {
  const organizationId = await organizationForLanguage(req);
  const { preferred_language } = req.body as UpdateLanguagePreferenceInput;
  const rows = await unwrap(
    req.db.rpc('set_my_language_preference', { p_organization_id: organizationId, p_preferred_language: preferred_language }),
  );
  const result = mapLanguagePreferenceRow(rows?.[0]);
  if (!result.person_linked) {
    throw new HttpError(409, 'Your login is not linked to a person in this church yet', PERSON_LINK_REQUIRED);
  }
  res.json(result);
});
