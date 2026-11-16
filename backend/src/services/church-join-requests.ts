import {
  ALREADY_CHURCH_MEMBER,
  CHURCH_NOT_FOUND,
  DEFAULT_INVITATION_ROLE,
  JOIN_REQUEST_NOT_PENDING,
  REQUESTER_ALREADY_MEMBER,
  type ApproveChurchJoinRequestRow,
  type ChurchJoinRequest,
  type ChurchJoinRequestApproval,
  type ChurchJoinRequestQueue,
  type ChurchLookup,
  type CreateChurchJoinRequestInput,
  type DeclineChurchJoinRequestInput,
  type MyChurchJoinRequest,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import {
  OWNER_JOIN_REQUEST_COLUMNS,
  mapChurchJoinRequest,
  mapChurchLookup,
  mapMyChurchJoinRequest,
  type OwnerChurchJoinRequestRow,
} from '../model/church-join-request.model.js';
import { personDisplayName } from '../model/people.js';
import { ensurePersonInvitation } from './person-invitations.js';

/**
 * Joining a church by its URL slug. Everything runs as the caller: the
 * database functions in migration 20261117000000 decide who may look up,
 * ask, see and decide (owners only, `private.is_people_owner`).
 */

/** A signed-in person, with or without a church. */
export interface JoinRequesterCaller {
  /** RLS-scoped to the caller. */
  db: Db;
  userId: string;
}

/** An owner of the active church. */
export interface ChurchOwnerCaller extends JoinRequesterCaller {
  organizationId: string;
}

/** Decided or withdrawn requests stay in the owners' "recent" list this long. */
export const RECENT_JOIN_REQUEST_DAYS = 30;
const RECENT_JOIN_REQUEST_LIMIT = 20;

const churchNotFound = (): HttpError => new HttpError(404, 'No church uses that address', CHURCH_NOT_FOUND);
const notPending = (): HttpError =>
  new HttpError(409, 'This request was already decided or withdrawn', JOIN_REQUEST_NOT_PENDING);

// ------------------------------------------------------------- requester ----

export const lookupChurch = async (caller: JoinRequesterCaller, slug: string): Promise<ChurchLookup> => {
  const rows = (await unwrap(caller.db.rpc('find_church_by_slug', { p_slug: slug }))) ?? [];
  const church = rows[0];
  if (!church) throw churchNotFound();
  return mapChurchLookup(church, slug);
};

const myRequest = async (caller: JoinRequesterCaller, requestId: string): Promise<MyChurchJoinRequest | null> => {
  const rows = (await unwrap(caller.db.rpc('my_church_join_requests', { p_id: requestId }))) ?? [];
  const row = rows[0];
  return row ? mapMyChurchJoinRequest(row) : null;
};

/** Newest first. */
export const listMyJoinRequests = async (caller: JoinRequesterCaller): Promise<MyChurchJoinRequest[]> => {
  const rows = (await unwrap(caller.db.rpc('my_church_join_requests', {}))) ?? [];
  return rows.map(mapMyChurchJoinRequest);
};

/**
 * 404 `church_not_found` (unknown or disabled), 409 `already_church_member`,
 * 409 `join_request_pending`, 429 `rate_limited`: raised by the database.
 */
export const requestToJoin = async (
  caller: JoinRequesterCaller,
  input: CreateChurchJoinRequestInput,
): Promise<MyChurchJoinRequest> => {
  const id = await unwrapOne(caller.db.rpc('request_to_join_church', { p_slug: input.slug, p_message: input.message }));
  const created = await myRequest(caller, id);
  if (!created) throw HttpError.notFound();
  return created;
};

/** Only while pending (409 `join_request_not_pending` otherwise). */
export const withdrawMyJoinRequest = async (caller: JoinRequesterCaller, requestId: string): Promise<MyChurchJoinRequest> => {
  const updated = await unwrap(
    caller.db
      .from('church_join_requests')
      .update({ status: 'withdrawn' })
      .eq('id', requestId)
      .eq('requester_id', caller.userId)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle(),
  );
  const request = await myRequest(caller, requestId);
  if (!request) throw HttpError.notFound('Join request not found');
  if (!updated) throw notPending();
  return request;
};

// ----------------------------------------------------------------- owner ----

/** One request of the active church, or 404 (RLS hides other churches' and non-owners'). */
const loadChurchRequest = async (caller: ChurchOwnerCaller, requestId: string): Promise<ChurchJoinRequest> => {
  const row = (await unwrap(
    raw(caller.db)
      .from('church_join_requests')
      .select(OWNER_JOIN_REQUEST_COLUMNS)
      .eq('id', requestId)
      .eq('organization_id', caller.organizationId)
      .maybeSingle(),
  )) as OwnerChurchJoinRequestRow | null;
  if (!row) throw HttpError.notFound('Join request not found');
  return mapChurchJoinRequest(row);
};

export const listChurchJoinRequests = async (
  caller: ChurchOwnerCaller,
  now: Date = new Date(),
): Promise<ChurchJoinRequestQueue> => {
  const since = new Date(now.getTime() - RECENT_JOIN_REQUEST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [pending, recent] = await Promise.all([
    unwrap(
      raw(caller.db)
        .from('church_join_requests')
        .select(OWNER_JOIN_REQUEST_COLUMNS)
        .eq('organization_id', caller.organizationId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true }),
    ) as Promise<OwnerChurchJoinRequestRow[] | null>,
    unwrap(
      raw(caller.db)
        .from('church_join_requests')
        .select(OWNER_JOIN_REQUEST_COLUMNS)
        .eq('organization_id', caller.organizationId)
        .neq('status', 'pending')
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(RECENT_JOIN_REQUEST_LIMIT),
    ) as Promise<OwnerChurchJoinRequestRow[] | null>,
  ]);
  return { pending: (pending ?? []).map(mapChurchJoinRequest), recent: (recent ?? []).map(mapChurchJoinRequest) };
};

const approveInDatabase = async (caller: ChurchOwnerCaller, requestId: string): Promise<ApproveChurchJoinRequestRow> => {
  try {
    return await unwrapOne(caller.db.rpc('approve_church_join_request', { p_request: requestId }).single());
  } catch (error) {
    // Said to the owner, not the requester.
    if (error instanceof HttpError && error.code === ALREADY_CHURCH_MEMBER) {
      throw new HttpError(409, 'This person is already part of the church', REQUESTER_ALREADY_MEMBER);
    }
    throw error;
  }
};

/**
 * Approves and sends the normal invitation. The database step (roster person
 * + approved) is atomic; the invitation is then sent by the same code as
 * "Send invite" and recorded on the request. Safe to retry: a request
 * approved earlier without a recorded invitation gets one now, and one with
 * an invitation is returned unchanged with nothing sent.
 */
export const approveJoinRequest = async (
  caller: ChurchOwnerCaller,
  requestId: string,
): Promise<ChurchJoinRequestApproval> => {
  // Scoped to the active church before anything changes.
  await loadChurchRequest(caller, requestId);
  const decision = await approveInDatabase(caller, requestId);

  if (decision.out_invitation_id) {
    return { request: await loadChurchRequest(caller, requestId), invitation_sent: false, invite_url: null };
  }

  const invitation = await ensurePersonInvitation(caller.db, {
    organizationId: decision.out_organization_id,
    personId: decision.out_person_id,
    email: decision.out_email,
    role: DEFAULT_INVITATION_ROLE,
    invitedBy: caller.userId,
    personName: personDisplayName({ first_name: decision.out_first_name, last_name: decision.out_last_name }),
    preferredLanguage: decision.out_preferred_language,
  });
  await unwrap(
    caller.db.rpc('record_church_join_request_invitation', {
      p_request: requestId,
      p_invitation: invitation.invitationId,
    }),
  );

  return {
    request: await loadChurchRequest(caller, requestId),
    invitation_sent: invitation.sent,
    invite_url: invitation.inviteUrl,
  };
};

/** Declining again returns the request unchanged; 409 when approved or withdrawn. */
export const declineJoinRequest = async (
  caller: ChurchOwnerCaller,
  requestId: string,
  input: DeclineChurchJoinRequestInput,
): Promise<ChurchJoinRequest> => {
  await loadChurchRequest(caller, requestId);
  await unwrap(caller.db.rpc('decline_church_join_request', { p_request: requestId, p_reason: input.reason }));
  return loadChurchRequest(caller, requestId);
};
