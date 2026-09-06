import type { Request } from 'express';
import { Router } from 'express';
import {
  createPersonSchema,
  invitePersonSchema,
  isAdmin,
  updateMemberSchema,
  updatePersonSchema,
  type InvitePersonInput,
  type OrganizationMemberRow,
  type PersonDetail,
  type PersonRow,
  type ProfileRow,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { requireAdmin, requireManager } from '../middleware/organization.js';
import { adminDb, raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { generateInviteToken, inviteAcceptUrl } from '../services/invitations.js';
import { sendPersonInvitation } from '../services/notifications.js';
import {
  mergeRoster,
  personDisplayName,
  splitFullName,
  toPersonDetail,
  type ActiveMemberRow,
} from '../model/people.js';

export const peopleRouter: Router = Router();

/** Loads the profile + membership (when linked) and any pending invitation for one person. */
const loadPersonDetail = async (req: Request, person: PersonRow): Promise<PersonDetail> => {
  let profile: ProfileRow | null = null;
  let membership: Pick<OrganizationMemberRow, 'role' | 'status'> | null = null;

  if (person.profile_id) {
    profile = await unwrap(
      req.db.from('profiles').select('*').eq('id', person.profile_id).maybeSingle(),
    );
    membership = await unwrap(
      req.db
        .from('organization_members')
        .select('role, status')
        .eq('organization_id', req.orgId)
        .eq('user_id', person.profile_id)
        .maybeSingle(),
    );
  }

  const pendingInvitation = await unwrap(
    req.db
      .from('person_invitations')
      .select('id, email, role, expires_at')
      .eq('person_id', person.id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
  );

  return toPersonDetail(person, profile, membership, pendingInvitation, !isAdmin(req.orgRole));
};

/** Everyone in the active organization: has-login members plus no-login roster entries. */
peopleRouter.get('/', async (req, res) => {
  const members = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, status, profile:profiles(*)')
      .eq('organization_id', req.orgId)
      .neq('status', 'inactive'),
  )) as unknown as ActiveMemberRow[];

  const people = await unwrap(req.db.from('people').select('*').eq('organization_id', req.orgId));

  const pendingInvitations = await unwrap(
    req.db
      .from('person_invitations')
      .select('person_id')
      .eq('organization_id', req.orgId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
  );

  res.json(mergeRoster(members, people ?? [], pendingInvitations ?? []));
});

/** Adds a full roster entry that doesn't require a login yet. */
peopleRouter.post('/', requireManager, validateBody(createPersonSchema), async (req, res) => {
  const created = await unwrapOne(
    req.db
      .from('people')
      .insert({ ...req.body, organization_id: req.orgId, created_by: req.auth.userId })
      .select('*')
      .single(),
  );
  res.status(201).json(await loadPersonDetail(req, created));
});

/** Gives an existing has-login member a full roster record. */
peopleRouter.post('/from-member/:userId', requireManager, async (req, res) => {
  const userId = param(req, 'userId');

  const member = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select('role, status, profile:profiles(*)')
      .eq('organization_id', req.orgId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  )) as unknown as ActiveMemberRow | null;
  if (!member) throw HttpError.notFound('That person is not an active member of this organization');

  const { first_name, last_name } = splitFullName(member.profile.full_name);
  const created = await unwrapOne(
    req.db
      .from('people')
      .insert({
        organization_id: req.orgId,
        profile_id: userId,
        first_name,
        last_name,
        email: member.profile.email,
        phone: member.profile.phone,
        avatar_url: member.profile.avatar_url,
        created_by: req.auth.userId,
      })
      .select('*')
      .single(),
  );

  res.status(201).json(await loadPersonDetail(req, created));
});

peopleRouter.get('/:personId', requireManager, async (req, res) => {
  const person = await unwrap(
    req.db
      .from('people')
      .select('*')
      .eq('id', param(req, 'personId'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  );
  if (!person) throw HttpError.notFound();
  res.json(await loadPersonDetail(req, person));
});

peopleRouter.patch('/:personId', requireManager, validateBody(updatePersonSchema), async (req, res) => {
  const updated = await unwrap(
    req.db
      .from('people')
      .update(req.body)
      .eq('id', param(req, 'personId'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound();
  res.json(await loadPersonDetail(req, updated));
});

/** Removes only the roster record — has no effect on an existing login or membership. */
peopleRouter.delete('/:personId', requireAdmin, async (req, res) => {
  await unwrap(
    req.db.from('people').delete().eq('id', param(req, 'personId')).eq('organization_id', req.orgId),
  );
  res.status(204).end();
});

/**
 * Sends (or resends) an invitation for a person to create their own login.
 * Creating an auth user requires the service role, so the existing-profile
 * lookup below is one of the few places we step outside RLS — requireAdmin
 * is what authorises it.
 */
peopleRouter.post(
  '/:personId/invitations',
  requireAdmin,
  validateBody(invitePersonSchema),
  async (req, res) => {
    const personId = param(req, 'personId');
    const { email: overrideEmail, role } = req.body as InvitePersonInput;

    const person = await unwrap(
      req.db.from('people').select('*').eq('id', personId).eq('organization_id', req.orgId).maybeSingle(),
    );
    if (!person) throw HttpError.notFound();
    if (person.profile_id) throw HttpError.conflict('This person already has a login');

    const email = overrideEmail ?? person.email;
    if (!email) throw HttpError.badRequest('An email address is required to send an invitation');

    const existingProfile = await unwrap(
      adminDb.from('profiles').select('id').eq('email', email).maybeSingle(),
    );

    if (existingProfile) {
      await unwrap(req.db.from('people').update({ profile_id: existingProfile.id }).eq('id', personId));

      // Don't clobber an already-active membership's role/status — this
      // branch only exists to attach the roster record to an existing
      // login, not to re-invite someone who's already in the organization.
      const existingMembership = await unwrap(
        req.db
          .from('organization_members')
          .select('role, status')
          .eq('organization_id', req.orgId)
          .eq('user_id', existingProfile.id)
          .maybeSingle(),
      );
      if (!existingMembership || existingMembership.status !== 'active') {
        await unwrap(
          req.db.from('organization_members').upsert(
            { organization_id: req.orgId, user_id: existingProfile.id, role: role as never, status: 'active' },
            { onConflict: 'organization_id,user_id' },
          ),
        );
      }

      res.status(201).json({ linked: true, invited: false });
      return;
    }

    // At most one live invitation per person — revoke any still-pending one first.
    await unwrap(
      req.db
        .from('person_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('person_id', personId)
        .is('accepted_at', null)
        .is('revoked_at', null),
    );

    const { token, tokenHash, expiresAt } = generateInviteToken();
    await unwrap(
      req.db.from('person_invitations').insert({
        organization_id: req.orgId,
        person_id: personId,
        email,
        role: role as never,
        channel: 'email',
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: req.auth.userId,
      }),
    );

    const inviteUrl = inviteAcceptUrl(token);
    const organization = await unwrapOne(
      req.db.from('organizations').select('name').eq('id', req.orgId).single(),
    );

    try {
      await sendPersonInvitation({
        to: email,
        personName: personDisplayName(person),
        organizationName: organization.name,
        acceptUrl: inviteUrl,
      });
    } catch (error) {
      // `invite_url` below still lets the admin share it manually — a
      // delivery failure shouldn't block the response, but must be logged.
      console.error('[invite] failed to send person invitation email', error);
    }

    res.status(201).json({ linked: false, invited: true, invite_url: inviteUrl });
  },
);

peopleRouter.patch('/members/:userId', requireAdmin, validateBody(updateMemberSchema), async (req, res) => {
  if (param(req, 'userId') === req.auth.userId && req.body.role && req.body.role !== req.orgRole) {
    throw HttpError.badRequest('You cannot change your own role');
  }

  const updated = await unwrap(
    req.db
      .from('organization_members')
      .update(req.body)
      .eq('organization_id', req.orgId)
      .eq('user_id', param(req, 'userId'))
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('That person is not in this organization');
  res.json(updated);
});

peopleRouter.delete('/members/:userId', requireAdmin, async (req, res) => {
  if (param(req, 'userId') === req.auth.userId) {
    throw HttpError.badRequest('You cannot remove yourself from the organization');
  }
  await unwrap(
    req.db
      .from('organization_members')
      .delete()
      .eq('organization_id', req.orgId)
      .eq('user_id', param(req, 'userId')),
  );
  res.status(204).end();
});
