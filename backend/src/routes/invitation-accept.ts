import { Router } from 'express';
import { acceptInvitationSchema, type InvitationPreview } from '@service-center/shared';
import { param } from '../lib/params.js';
import { validateBody } from '../lib/validate.js';
import { adminDb, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { hashInviteToken } from '../services/invitations.js';
import { personDisplayName } from '../model/people.js';

/**
 * Fully public — the caller has no session yet. Token possession is the
 * only authorisation check, mirroring how the service-role client is used
 * elsewhere for auth-admin work a signed-in user genuinely can't do itself.
 */
export const invitationAcceptRouter: Router = Router();

const loadLiveInvitation = async (token: string) => {
  const invitation = await unwrap(
    adminDb.from('person_invitations').select('*').eq('token_hash', hashInviteToken(token)).maybeSingle(),
  );
  if (!invitation) throw HttpError.notFound('That invitation link is not valid');
  if (invitation.accepted_at || invitation.revoked_at) {
    throw new HttpError(410, 'This invitation has already been used', 'invitation_used');
  }
  if (new Date(invitation.expires_at) <= new Date()) {
    throw new HttpError(410, 'This invitation has expired', 'invitation_expired');
  }
  return invitation;
};

invitationAcceptRouter.get('/:token', async (req, res) => {
  const invitation = await loadLiveInvitation(param(req, 'token'));

  const [organization, person] = await Promise.all([
    unwrapOne(adminDb.from('organizations').select('name').eq('id', invitation.organization_id).single()),
    unwrapOne(adminDb.from('people').select('first_name').eq('id', invitation.person_id).single()),
  ]);

  const preview: InvitationPreview = {
    organization_name: organization.name,
    person_first_name: person.first_name || 'there',
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
    const { password } = req.body as { password: string };
    const invitation = await loadLiveInvitation(token);
    const tokenHash = hashInviteToken(token);

    // Re-check for a race: someone may have created an account with this
    // email between the preview call and this submission.
    const existingProfile = await unwrap(
      adminDb.from('profiles').select('id').eq('email', invitation.email).maybeSingle(),
    );

    const userId = existingProfile
      ? existingProfile.id
      : await (async () => {
          const person = await unwrapOne(
            adminDb.from('people').select('first_name, last_name').eq('id', invitation.person_id).single(),
          );
          const { data, error } = await adminDb.auth.admin.createUser({
            email: invitation.email,
            password,
            email_confirm: true,
            user_metadata: { full_name: personDisplayName(person) },
          });
          if (error || !data.user) {
            throw new HttpError(502, `Could not create the account: ${error?.message ?? 'unknown error'}`);
          }
          return data.user.id;
        })();

    const { error: rpcError } = await adminDb.rpc('accept_person_invitation', {
      p_token_hash: tokenHash,
      p_new_user_id: userId,
    });
    if (rpcError) {
      console.error('[invite] accept_person_invitation failed', rpcError);
      throw HttpError.conflict('This invitation is no longer valid — it may have just been used or expired');
    }

    res.json({ email: invitation.email, linked_existing_account: Boolean(existingProfile) });
  },
);
