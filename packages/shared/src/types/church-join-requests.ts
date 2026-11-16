/**
 * Joining a church by its URL slug: a signed-in person asks, the church's
 * owners approve (the normal invitation is sent) or decline.
 * See supabase/migrations/20261117000000_church_join_requests.sql.
 */

export type ChurchJoinRequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

/** `church_join_requests` (`decided_by` is not readable through the API roles). */
export type ChurchJoinRequestRow = {
  id: string;
  organization_id: string;
  requester_id: string;
  status: ChurchJoinRequestStatus;
  message: string | null;
  requester_name: string | null;
  requester_email: string;
  decline_reason: string | null;
  person_id: string | null;
  invitation_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A row of `find_church_by_slug()`: an active church, nothing more. */
export type ChurchSlugLookupRow = {
  id: string;
  name: string;
};

/** A row of `my_church_join_requests()`. */
export type MyChurchJoinRequestRow = {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  status: ChurchJoinRequestStatus;
  message: string | null;
  decline_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

/** A row of `approve_church_join_request()`. */
export type ApproveChurchJoinRequestRow = {
  out_request_id: string;
  out_organization_id: string;
  out_person_id: string;
  /** Null until the API recorded the invitation it sent. */
  out_invitation_id: string | null;
  out_email: string;
  out_first_name: string;
  out_last_name: string | null;
  out_preferred_language: string | null;
  /** False when the request was already approved (a retry). */
  out_newly_approved: boolean;
};

/** `GET /api/v1/church-join-requests/lookup?slug=`: the church to confirm. */
export interface ChurchLookup {
  id: string;
  name: string;
  /** The normalized slug that was looked up. */
  slug: string;
}

/** A join request as the person who sent it sees it. */
export interface MyChurchJoinRequest {
  id: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  status: ChurchJoinRequestStatus;
  message: string | null;
  /** Set when declined, if the owner gave one. */
  decline_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A join request in the church owners' queue. */
export interface ChurchJoinRequest {
  id: string;
  requester_id: string;
  requester_name: string | null;
  requester_email: string;
  status: ChurchJoinRequestStatus;
  message: string | null;
  decline_reason: string | null;
  /** The roster person invited, once approved. */
  person_id: string | null;
  /** The invitation sent, once approved. */
  invitation_id: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `GET /api/v1/people/join-requests`. */
export interface ChurchJoinRequestQueue {
  /** Oldest first: the order they were asked. */
  pending: ChurchJoinRequest[];
  /** Decided or withdrawn in the last 30 days, newest first. */
  recent: ChurchJoinRequest[];
}

/** `POST /api/v1/people/join-requests/:id/approve`. */
export interface ChurchJoinRequestApproval {
  request: ChurchJoinRequest;
  /** False on a retry of an approval whose invitation was already sent. */
  invitation_sent: boolean;
  /**
   * The accept link, so the owner can share it when email isn't configured
   * (same as `PersonInvitationResult`). Null when nothing was sent now.
   */
  invite_url: string | null;
}
