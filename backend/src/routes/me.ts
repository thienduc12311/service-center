import { Router, type Request } from 'express';
import {
  PERSON_LINK_REQUIRED,
  deleteAccountSchema,
  userBlockParamsSchema,
  updateLanguagePreferenceSchema,
  updateProfileSchema,
  type UpdateLanguagePreferenceInput,
  calendarFeedTokenSchema,
  type CalendarFeedTokenResponse,
  type CurrentUser,
} from '@service-center/shared';
import { parseOrThrow, validateBody } from '../lib/validate.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { loadMyOrganizationContext } from '../services/organization-context.js';
import { config } from '../config.js';
import { mapLanguagePreferenceRow } from '../model/language.model.js';
import {
  blockUser,
  deleteAccount,
  getAccountDeletionPlan,
  listBlockedUsers,
  unblockUser,
  type AccountCaller,
} from '../services/account.js';

export const meRouter: Router = Router();

/**
 * The signed-in profile plus every organization the user belongs to, each
 * with the caller's effective access there (F01), so clients can show the
 * actions that are actually allowed.
 */
meRouter.get('/', async (req, res) => {
  // Contact columns are not selectable from `profiles`; my_profile() returns your own.
  const [profile, context] = await Promise.all([
    unwrapOne(req.db.rpc('my_profile')),
    loadMyOrganizationContext(req.db, req.auth.userId, { p_all: true }),
  ]);

  const payload: CurrentUser = {
    profile,
    memberships: context.memberships.flatMap((membership) =>
      membership.organization ? [{
        organization: membership.organization,
        role: membership.role,
        access: membership.access,
        platform_access_expires_at: membership.platformAccessExpiresAt,
      }] : [],
    ),
    disabled_organizations: context.disabledOrganizations,
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

const accountCaller = (req: Request): AccountCaller => ({ db: req.db, userId: req.auth.userId });

// ----------------------------------------------------- account deletion --

/** What deleting the account would do, for the confirmation screen. */
meRouter.get('/account-deletion', async (req, res) => {
  res.json(await getAccountDeletionPlan(accountCaller(req)));
});

/**
 * Permanently deletes the caller's account (App Store Review Guideline
 * 5.1.1(v)). 409 `account_deletion_blocked` lists the organizations that
 * need another owner first.
 */
meRouter.delete('/', validateBody(deleteAccountSchema), async (req, res) => {
  res.json(await deleteAccount(accountCaller(req)));
});

// ---------------------------------------------------------------- blocks --

meRouter.get('/blocks', async (req, res) => {
  res.json(await listBlockedUsers(accountCaller(req)));
});

meRouter.put('/blocks/:userId', async (req, res) => {
  const { userId } = parseOrThrow(userBlockParamsSchema, req.params);
  res.json(await blockUser(accountCaller(req), userId));
});

meRouter.delete('/blocks/:userId', async (req, res) => {
  const { userId } = parseOrThrow(userBlockParamsSchema, req.params);
  await unblockUser(accountCaller(req), userId);
  res.status(204).end();
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
  // The database revokes the live token and issues the new one (W10-FGH-D7):
  // clients hold no write privilege on calendar_feed_tokens.
  const token = calendarFeedTokenSchema.parse(await unwrap(req.db.rpc('rotate_calendar_feed_token', { p_org: organizationId })));
  const url = `${config.API_URL}/api/v1/calendar-feed/${token}.ics`;
  const response: CalendarFeedTokenResponse = { url, webcal_url: url.replace(/^https?:\/\//, 'webcal://'), token, active: true };
  res.status(201).json(response);
});

/** Turns the personal feed off without issuing a replacement (W10-FGH-D8). Idempotent. */
meRouter.delete('/calendar-feed', async (req, res) => {
  const organizationId = await activeOrganizationForMe(req);
  await unwrap(req.db.rpc('revoke_calendar_feed_token', { p_org: organizationId }));
  res.status(204).end();
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
