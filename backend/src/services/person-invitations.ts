import { resolveRecipientLocale, type InvitationRole, type PersonInvitationRow } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { generateInviteToken, inviteAcceptUrl } from './invitations.js';
import { sendPersonInvitation } from './notifications.js';

/**
 * Sends a person the invitation to create (or link) their login: the one code
 * path behind "Send invite" on the People pages and join-request approvals.
 * Runs as the caller; RLS (`invitations_owner_only`) decides who may invite.
 * The raw token goes only into the email and the returned link, never the
 * database.
 */

export interface PersonInvitationRequest {
  organizationId: string;
  personId: string;
  email: string;
  role: InvitationRole;
  invitedBy: string;
  /** For the email greeting. */
  personName: string;
  /** The Person's language for the email; null follows the default. */
  preferredLanguage: string | null;
}

/** A new invitation was created and emailed. */
export interface SentPersonInvitation {
  invitationId: string;
  /** The accept link, for the owner to share when email isn't configured. */
  inviteUrl: string;
}

/** `ensurePersonInvitation`: sent now, or an existing one kept (its token isn't stored, so no link). */
export type EnsuredPersonInvitation =
  | ({ sent: true } & SentPersonInvitation)
  | { sent: false; invitationId: string; inviteUrl: null };

type PendingInvitation = Pick<PersonInvitationRow, 'id' | 'email' | 'expires_at'>;

const pendingInvitation = async (db: Db, personId: string): Promise<PendingInvitation | null> =>
  unwrap(
    db
      .from('person_invitations')
      .select('id, email, expires_at')
      .eq('person_id', personId)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .maybeSingle(),
  );

/** An unexpired invitation to the same address can stand in for a new one. */
export const isReusableInvitation = (invitation: PendingInvitation, email: string, now: Date = new Date()): boolean =>
  invitation.email.trim().toLowerCase() === email.trim().toLowerCase() && new Date(invitation.expires_at) > now;

const kept = (invitation: PendingInvitation): EnsuredPersonInvitation => ({
  sent: false,
  invitationId: invitation.id,
  inviteUrl: null,
});

/**
 * "Send invite" / "Resend invite": revokes the person's pending invitation, if
 * any (there is at most one: `person_invitations_one_pending`), creates a new
 * one and emails it. A failed email is logged; the link is still returned.
 */
export const issuePersonInvitation = async (db: Db, request: PersonInvitationRequest): Promise<SentPersonInvitation> => {
  // A login with the same email is never linked here: identity is linked
  // only when the invitation is accepted by whoever controls that address.
  await unwrap(
    db
      .from('person_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('person_id', request.personId)
      .is('accepted_at', null)
      .is('revoked_at', null),
  );

  const { token, tokenHash, expiresAt } = generateInviteToken();
  const created = await unwrapOne(
    db
      .from('person_invitations')
      .insert({
        organization_id: request.organizationId,
        person_id: request.personId,
        email: request.email,
        role: request.role,
        channel: 'email',
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
        created_by: request.invitedBy,
      })
      .select('id')
      .single(),
  );

  const inviteUrl = inviteAcceptUrl(token);
  const organization = await unwrapOne(
    db.from('organizations').select('name').eq('id', request.organizationId).single(),
  );

  try {
    await sendPersonInvitation({
      to: request.email,
      locale: resolveRecipientLocale(request.preferredLanguage),
      personName: request.personName,
      organizationName: organization.name,
      acceptUrl: inviteUrl,
    });
  } catch (sendError) {
    // `inviteUrl` still lets the owner share it manually — a delivery failure
    // shouldn't block the response, but must be logged.
    console.error('[invite] failed to send person invitation email', sendError);
  }

  return { invitationId: created.id, inviteUrl };
};

/**
 * Same, but keeps an unexpired pending invitation to the same address instead
 * of replacing it, so a retried or doubled call sends one email, not two.
 */
export const ensurePersonInvitation = async (
  db: Db,
  request: PersonInvitationRequest,
): Promise<EnsuredPersonInvitation> => {
  const pending = await pendingInvitation(db, request.personId);
  if (pending && isReusableInvitation(pending, request.email)) return kept(pending);
  try {
    return { sent: true, ...(await issuePersonInvitation(db, request)) };
  } catch (error) {
    // Another call invited the same person between the revoke and the insert.
    if (error instanceof HttpError && error.status === 409) {
      const winner = await pendingInvitation(db, request.personId);
      if (winner && isReusableInvitation(winner, request.email)) return kept(winner);
    }
    throw error;
  }
};
