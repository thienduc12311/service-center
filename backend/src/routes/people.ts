import type { Request } from 'express';
import { Router } from 'express';
import {
  canAccessAnywhere,
  createPersonSchema,
  eligibilityRecordSchema,
  invitePersonSchema,
  isAdmin,
  listPeopleQuerySchema,
  type ListPeopleQuery,
  personTagsSchema,
  resolveRecipientLocale,
  updateMemberSchema,
  updatePersonSchema,
  type EligibilityRecordInput,
  type InvitePersonInput,
  type PersonInvitationResult,
  type OrganizationMemberRow,
  type PersonDetail,
  type PersonRow,
  type PersonSelectableRow,
  type PersonTagsInput,
  type ProfileRow,
  type PublicProfileRow,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireAdmin, requireCapability } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { generateInviteToken, inviteAcceptUrl } from '../services/invitations.js';
import { sendPersonInvitation } from '../services/notifications.js';
import {
  PERSON_COLUMNS,
  PUBLIC_PROFILE_COLUMNS,
  mergeRoster,
  personDisplayName,
  splitFullName,
  toPersonDetail,
  type ActiveMemberRow,
  type RosterPersonRecord,
} from '../model/people.js';
import { NO_CONTACT, contactsFor } from '../services/contacts.js';

export const peopleRouter: Router = Router();

/** Full private records: people.view_private or people.manage (RLS enforces it too). */
const canReadPrivate = (req: Request): boolean =>
  canAccessAnywhere(req.access, 'people.view_private') || canAccessAnywhere(req.access, 'people.manage');

/** A profile with whatever contact details the caller may see. */
const profileWithContact = async (req: Request, profileId: string): Promise<ProfileRow | null> => {
  const profile = (await unwrap(
    raw(req.db).from('profiles').select(PUBLIC_PROFILE_COLUMNS).eq('id', profileId).maybeSingle(),
  )) as PublicProfileRow | null;
  if (!profile) return null;
  const contacts = await contactsFor(req.db, req.orgId, [profileId]);
  return { ...profile, ...(contacts.get(profileId) ?? NO_CONTACT) };
};

/** Loads the profile + membership (when linked) and any pending invitation for one person. */
const loadPersonDetail = async (req: Request, selected: PersonSelectableRow): Promise<PersonDetail> => {
  let profile: ProfileRow | null = null;
  let membership: Pick<OrganizationMemberRow, 'role' | 'status'> | null = null;
  // Not selectable by API roles; the database returns it to owners/admins only.
  const medicalNote = await unwrap(req.db.rpc('person_medical_note', { p_person: selected.id }));
  const person: PersonRow = { ...selected, medical_note: medicalNote ?? null };

  if (person.profile_id) {
    profile = await profileWithContact(req, person.profile_id);
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

interface MemberWithPublicProfile extends Omit<ActiveMemberRow, 'profile'> {
  profile: PublicProfileRow;
}

/**
 * Everyone in the active organization: has-login members plus no-login roster
 * entries. Without people.view_private the caller sees names, pictures and
 * campus only (the `people_directory` projection), plus their own contact.
 */
peopleRouter.get('/', validateQuery(listPeopleQuerySchema), async (req, res) => {
  const { include_archived } = parsedQuery<ListPeopleQuery>(res);
  const rawMembers = (await unwrap(
    raw(req.db)
      .from('organization_members')
      .select(`role, status, profile:profiles(${PUBLIC_PROFILE_COLUMNS})`)
      .eq('organization_id', req.orgId)
      .neq('status', 'inactive'),
  )) as unknown as MemberWithPublicProfile[];
  const contacts = await contactsFor(req.db, req.orgId, rawMembers.map((member) => member.profile?.id).filter(Boolean));
  const members: ActiveMemberRow[] = rawMembers
    .filter((member) => member.profile)
    .map((member) => ({
      ...member,
      profile: { ...member.profile, ...(contacts.get(member.profile.id) ?? NO_CONTACT) },
    }));

  const people: RosterPersonRecord[] = canReadPrivate(req)
    ? ((await unwrap(raw(req.db).from('people').select(PERSON_COLUMNS).eq('organization_id', req.orgId))) as unknown as RosterPersonRecord[])
    : ((await unwrap(req.db.from('people_directory').select('*').eq('organization_id', req.orgId))) ?? []).map((row) => ({
        ...row,
        email: null,
        phone: null,
      }));

  const pendingInvitations = await unwrap(
    req.db
      .from('person_invitations')
      .select('person_id')
      .eq('organization_id', req.orgId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
  );

  res.json(mergeRoster(members, people ?? [], pendingInvitations ?? [], include_archived));
});

/** Adds a full roster entry that doesn't require a login yet. */
peopleRouter.post('/', requireCapability('people.manage'), validateBody(createPersonSchema), async (req, res) => {
  const created = (await unwrapOne(
    raw(req.db)
      .from('people')
      .insert({ ...req.body, organization_id: req.orgId, created_by: req.auth.userId })
      .select(PERSON_COLUMNS)
      .single(),
  )) as unknown as PersonSelectableRow;
  res.status(201).json(await loadPersonDetail(req, created));
});

/** Gives an existing has-login member a full roster record. */
peopleRouter.post('/from-member/:userId', requireCapability('people.manage'), async (req, res) => {
  const userId = param(req, 'userId');

  const member = await unwrap(
    req.db
      .from('organization_members')
      .select('role, status')
      .eq('organization_id', req.orgId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  );
  const profile = member ? await profileWithContact(req, userId) : null;
  if (!member || !profile) throw HttpError.notFound('That person is not an active member of this organization');

  // Every member already has a Person (MOB-005/F02); return it rather than a second one.
  const existing = (await unwrap(
    raw(req.db).from('people').select(PERSON_COLUMNS).eq('organization_id', req.orgId).eq('profile_id', userId).maybeSingle(),
  )) as unknown as PersonSelectableRow | null;
  if (existing) {
    res.json(await loadPersonDetail(req, existing));
    return;
  }

  const { first_name, last_name } = splitFullName(profile.full_name);
  const created = (await unwrapOne(
    raw(req.db)
      .from('people')
      .insert({
        organization_id: req.orgId,
        profile_id: userId,
        first_name,
        last_name,
        email: profile.email,
        phone: profile.phone,
        avatar_url: profile.avatar_url,
        created_by: req.auth.userId,
      })
      .select(PERSON_COLUMNS)
      .single(),
  )) as unknown as PersonSelectableRow;

  res.status(201).json(await loadPersonDetail(req, created));
});

/** A private record: people.view_private / people.manage, or the person themself (RLS). */
peopleRouter.get('/:personId', async (req, res) => {
  const person = (await unwrap(
    raw(req.db)
      .from('people')
      .select(PERSON_COLUMNS)
      .eq('id', param(req, 'personId'))
      .eq('organization_id', req.orgId)
      .maybeSingle(),
  )) as unknown as PersonSelectableRow | null;
  if (!person) throw HttpError.notFound();
  res.json(await loadPersonDetail(req, person));
});

peopleRouter.patch('/:personId', requireCapability('people.manage'), validateBody(updatePersonSchema), async (req, res) => {
  const updated = (await unwrap(
    raw(req.db)
      .from('people')
      .update(req.body)
      .eq('id', param(req, 'personId'))
      .eq('organization_id', req.orgId)
      .select(PERSON_COLUMNS)
      .maybeSingle(),
  )) as unknown as PersonSelectableRow | null;
  if (!updated) throw HttpError.notFound();
  res.json(await loadPersonDetail(req, updated));
});

/**
 * Removes only the roster record — has no effect on an existing login or
 * membership. A Person with staffing history cannot be deleted; archive them.
 */
peopleRouter.delete('/:personId', requireAdmin, async (req, res) => {
  const { error } = await req.db.from('people').delete().eq('id', param(req, 'personId')).eq('organization_id', req.orgId);
  if (error?.code === '23503') {
    throw new HttpError(409, 'This person has service history. Archive them instead.', 'person_has_history');
  }
  if (error) throw fromPostgrestError(error);
  res.status(204).end();
});

/**
 * Reversible archive: hidden from pickers and new staffing, history kept.
 * Repeating either call is a no-op.
 */
const setArchived = async (req: Request, archived: boolean): Promise<PersonDetail> => {
  const personId = param(req, 'personId');
  let update = raw(req.db)
    .from('people')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq('id', personId)
    .eq('organization_id', req.orgId);
  update = archived ? update.is('archived_at', null) : update.not('archived_at', 'is', null);
  await unwrap(update);
  const person = (await unwrap(
    raw(req.db).from('people').select(PERSON_COLUMNS).eq('id', personId).eq('organization_id', req.orgId).maybeSingle(),
  )) as unknown as PersonSelectableRow | null;
  if (!person) throw HttpError.notFound();
  return loadPersonDetail(req, person);
};

peopleRouter.post('/:personId/archive', requireCapability('people.manage'), async (req, res) => {
  res.json(await setArchived(req, true));
});

peopleRouter.post('/:personId/restore', requireCapability('people.manage'), async (req, res) => {
  res.json(await setArchived(req, false));
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

    const person = (await unwrap(
      raw(req.db).from('people').select(PERSON_COLUMNS).eq('id', personId).eq('organization_id', req.orgId).maybeSingle(),
    )) as unknown as PersonSelectableRow | null;
    if (!person) throw HttpError.notFound();
    if (person.profile_id) throw HttpError.conflict('This person already has a login');

    const email = overrideEmail ?? person.email;
    if (!email) throw HttpError.badRequest('An email address is required to send an invitation');

    if (person.archived_at) throw HttpError.conflict('Restore this person before inviting them');

    // A login with the same email is never linked here: identity is linked
    // only when the invitation is accepted by whoever controls that address.
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
        // A manager may have set this before the Person has a login.
        locale: resolveRecipientLocale(person.preferred_language),
        personName: personDisplayName(person),
        organizationName: organization.name,
        acceptUrl: inviteUrl,
      });
    } catch (error) {
      // `invite_url` below still lets the admin share it manually — a
      // delivery failure shouldn't block the response, but must be logged.
      console.error('[invite] failed to send person invitation email', error);
    }

    const result: PersonInvitationResult = { linked: false, invited: true, invite_url: inviteUrl };
    res.status(201).json(result);
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

// --------------------------------------------------------------- tags ----
/** Tags drive tag-derived team candidates (F01). People managers edit them. */
peopleRouter.get('/:personId/tags', async (req, res) => {
  const rows = await unwrap(
    req.db.from('person_tags').select('tag').eq('person_id', param(req, 'personId')).eq('organization_id', req.orgId).order('tag'),
  );
  res.json((rows ?? []).map((row) => row.tag));
});

peopleRouter.put('/:personId/tags', requireCapability('people.manage'), validateBody(personTagsSchema), async (req, res) => {
  const personId = param(req, 'personId');
  const tags = [...new Set((req.body as PersonTagsInput).tags.map((tag) => tag.toLowerCase()))];
  const person = await unwrap(
    req.db.from('people_directory').select('id').eq('id', personId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!person) throw HttpError.notFound();
  await unwrap(req.db.from('person_tags').delete().eq('person_id', personId));
  if (tags.length) {
    await unwrap(
      req.db
        .from('person_tags')
        .insert(tags.map((tag) => ({ person_id: personId, organization_id: req.orgId, tag, created_by: req.auth.userId }))),
    );
  }
  res.json(tags.sort());
});

// -------------------------------------------------------- eligibility ----
/**
 * Explicit eligibility evidence for secure teams: the provider and its
 * reference, never a report body. Append-only; the latest record decides.
 */
peopleRouter.get('/members/:userId/eligibility', async (req, res) => {
  const rows = await unwrap(
    req.db
      .from('person_eligibility_records')
      .select('*')
      .eq('organization_id', req.orgId)
      .eq('user_id', param(req, 'userId'))
      .order('verified_at', { ascending: false }),
  );
  res.json(rows ?? []);
});

peopleRouter.post('/eligibility', requireCapability('people.manage'), validateBody(eligibilityRecordSchema), async (req, res) => {
  const input = req.body as EligibilityRecordInput;
  const created = await unwrapOne(
    req.db
      .from('person_eligibility_records')
      .insert({ ...input, provider_reference: input.provider_reference ?? null, organization_id: req.orgId, recorded_by: req.auth.userId })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});
