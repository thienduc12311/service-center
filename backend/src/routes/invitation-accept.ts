import { Router } from 'express';
import { acceptInvitationSchema, type InvitationAcceptResult, type InvitationPreview } from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { adminDb, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { hashInviteToken } from '../services/invitations.js';
import { findConfirmedUserIdByEmail, isEmailRegistered } from '../services/auth-users.js';
import { personDisplayName } from '../model/people.js';
import { optionalSessionUserId } from '../middleware/auth.js';
import { config } from '../config.js';

/**
 * Public — the caller usually has no session yet. The token authorises
 * joining as the invited Person, but not proof of the inbox: the inviter can
 * see the link. So an existing login must accept from its own session, and a
 * login created here keeps its email unconfirmed until the inbox owner
 * confirms it.
 */
export const invitationAcceptRouter: Router = Router();

const loadLiveInvitation = async (token: string) => {
  const invitation = await unwrap(
    adminDb.from('person_invitations').select('*').eq('token_hash', hashInviteToken(token)).maybeSingle(),
  );
  if (!invitation) throw HttpError.notFound('That invitation link is not valid');
  if (invitation.accepted_at || invitation.revoked_at) {
    throw INVITATION_USED();
  }
  if (new Date(invitation.expires_at) <= new Date()) {
    throw new HttpError(410, 'This invitation has expired', 'invitation_expired');
  }
  return invitation;
};

/** The invitation fields an account is created from. */
interface InvitationForAccount {
  id: string;
  email: string;
  person_id: string;
}

const INVITATION_USED = (): HttpError => new HttpError(410, 'This invitation has already been used', 'invitation_used');

/**
 * W10-SEC-D4: when creating the login fails, a concurrent submission of the
 * same invitation may have created it a moment earlier. Auth reports that
 * loser as a bare 500 (unique email index) or, once the winner committed, as
 * `email_exists`. Answer it cleanly instead of "try again":
 *   - the invitation has been accepted meanwhile -> 410 invitation_used;
 *   - an account now holds the address although Auth did not say so (the
 *     race itself) -> 409 invitation_accept_in_progress.
 * Null: not a race; the caller reports the original failure.
 */
const concurrentAcceptOutcome = async (
  invitation: InvitationForAccount,
  authSaidEmailExists: boolean,
): Promise<HttpError | null> => {
  const current = await unwrap(
    adminDb.from('person_invitations').select('accepted_at').eq('id', invitation.id).maybeSingle(),
  );
  if (current?.accepted_at) return INVITATION_USED();
  if (!authSaidEmailExists && (await isEmailRegistered(invitation.email))) {
    return new HttpError(
      409,
      'This invitation is being accepted right now. Wait a moment, then open it again or sign in.',
      'invitation_accept_in_progress',
    );
  }
  return null;
};

/**
 * A new login for the invited address, with its email left **unconfirmed**:
 * whoever holds the link chose the password, but only the inbox owner can
 * confirm it (Supabase sends the confirmation email). Until then the account
 * never counts as owning the address — not for linking later invitations, join
 * requests or super-admin invitations — and, with confirmations on, it cannot
 * sign in.
 */
const createUnconfirmedAccount = async (invitation: InvitationForAccount, password: string | undefined): Promise<string> => {
  if (!password) throw new HttpError(422, 'Choose a password to create your account', 'password_required');
  const person = await unwrapOne(
    adminDb.from('people').select('first_name, last_name').eq('id', invitation.person_id).single(),
  );
  const { data, error } = await adminDb.auth.admin.createUser({
    email: invitation.email,
    password,
    email_confirm: false,
    user_metadata: { full_name: personDisplayName(person) },
  });
  if (error || !data.user) {
    // Another submission of this same invitation may have won a moment ago.
    const raced = await concurrentAcceptOutcome(invitation, error?.code === 'email_exists');
    if (raced) throw raced;
  }
  if (error?.code === 'email_exists') {
    // An unconfirmed signup already holds this address, with a password chosen
    // by whoever started it. Never link it: the inbox owner takes it over with
    // a password reset (which also confirms the email), then accepts.
    throw new HttpError(
      409,
      'An account was started with this email but never confirmed. Use “Forgot password” on the sign-in page to take it over, then open this invitation again.',
      'account_unconfirmed',
    );
  }
  if (error || !data.user) {
    console.error(`[invite] creating the account failed (${error?.code ?? 'no user'})`);
    throw new HttpError(502, 'Could not create the account; try again');
  }

  const { error: mailError } = await adminDb.auth.resend({
    type: 'signup',
    email: invitation.email,
    options: { emailRedirectTo: config.APP_URL },
  });
  // The account stays usable for a reset-password confirmation, so a failed
  // send (rate limit, confirmations off) is logged, not fatal.
  if (mailError) console.error(`[invite] sending the confirmation email failed (${mailError.code ?? mailError.status ?? 'unknown'})`);
  return data.user.id;
};

invitationAcceptRouter.get('/:token', async (req, res) => {
  const invitation = await loadLiveInvitation(param(req, 'token'));

  const [organization, person] = await Promise.all([
    unwrapOne(adminDb.from('organizations').select('name').eq('id', invitation.organization_id).single()),
    unwrapOne(adminDb.from('people').select('first_name, preferred_language').eq('id', invitation.person_id).single()),
  ]);

  const preview: InvitationPreview = {
    organization_name: organization.name,
    person_first_name: person.first_name || '',
    // Token verified above: the invited Person's language may be used for this page.
    preferred_language: person.preferred_language,
    email: invitation.email,
    role: invitation.role,
    expires_at: invitation.expires_at,
  };
  res.json(preview);
});

invitationAcceptRouter.post(
  '/:token/accept',
  validateBody(acceptInvitationSchema),
  async (req, res) => {
    const token = param(req, 'token');
    const { password } = req.body as { password?: string };
    const invitation = await loadLiveInvitation(token);
    const tokenHash = hashInviteToken(token);

    // An existing login is linked only when its email is confirmed. Never
    // look this up by `profiles.email`: it is a copy, not proof of the inbox.
    // Re-checked here for a race: an account may have been created with this
    // email between the preview call and this submission.
    const existingUserId = await findConfirmedUserIdByEmail(invitation.email);

    // The inviter sees this link too (to share it by text), so holding the
    // token proves nothing about who owns the account or the inbox. An
    // existing login joins only from its own session. 403, not 401: the
    // clients sign out on 401, and a caller signed in as someone else should
    // not be signed out by opening a link.
    if (existingUserId && (await optionalSessionUserId(req)) !== existingUserId) {
      throw new HttpError(
        403,
        'Sign in with the account for this email, then open this invitation again to join.',
        'invitation_sign_in_required',
      );
    }

    const userId = existingUserId ?? (await createUnconfirmedAccount(invitation, password));

    // Links the login to the invited Person; their existing assignments,
    // answers and respond links follow (same ids). Conflicts stop here.
    const { data, error: rpcError } = await adminDb.rpc('accept_person_invitation', {
      p_token_hash: tokenHash,
      p_new_user_id: userId,
    });
    if (rpcError) {
      console.error('[invite] accept_person_invitation failed', rpcError.code);
      throw HttpError.conflict('This invitation is no longer valid — it may have just been used or expired');
    }
    const outcome = data?.[0]?.out_status ?? 'invalid';
    if (outcome === 'identity_conflict') {
      throw new HttpError(
        409,
        'This account is already on this organization’s roster as someone else. An administrator needs to confirm it is the same person.',
        'identity_conflict',
      );
    }
    if (outcome === 'person_linked') {
      throw new HttpError(409, 'This invitation belongs to a person who already has a different login.', 'person_already_linked');
    }
    if (outcome !== 'linked') {
      throw HttpError.conflict('This invitation is no longer valid — it may have just been used or expired');
    }

    const result: InvitationAcceptResult = { email: invitation.email, linked_existing_account: existingUserId !== null };
    res.json(result);
  },
);
