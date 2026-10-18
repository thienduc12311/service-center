/**
 * F02 roster extensions: archive/audit rows, tag groups, previewed bulk
 * changes and permission-filtered global search.
 */

export type PersonRosterAction =
  | 'created'
  | 'archived'
  | 'restored'
  | 'linked'
  | 'unlinked'
  | 'tag_added'
  | 'tag_removed'
  | 'team_added'
  | 'team_removed';

/** Small, non-private detail: a tag, or the team/position a place was on. */
export interface PersonRosterEventDetail {
  tag?: string;
  team_id?: string;
  position_id?: string | null;
}

export type PersonRosterEventRow = {
  id: string;
  organization_id: string;
  person_id: string | null;
  person_label: string;
  action: PersonRosterAction;
  detail: PersonRosterEventDetail;
  actor_id: string | null;
  created_at: string;
};

export type PersonTagGroupRow = {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type PersonTagCatalogRow = {
  organization_id: string;
  tag: string;
  group_id: string | null;
  created_at: string;
};

export type RosterBulkAction = 'add_tag' | 'remove_tag' | 'add_to_team' | 'remove_from_team';
export type RosterBulkOutcome = 'change' | 'unchanged' | 'error';
export type RosterBulkProblem = 'not_found' | 'archived' | 'not_eligible';

/** One requested person in a bulk preview. `display_name` is null when not found. */
export type RosterBulkPreviewRow = {
  person_id: string;
  display_name: string | null;
  outcome: RosterBulkOutcome;
  problem: RosterBulkProblem | null;
};

export interface RosterBulkPreview {
  rows: RosterBulkPreviewRow[];
  /** Send back as `expected_changes` when applying. */
  changes: number;
  unchanged: number;
  errors: number;
}

export interface RosterBulkApplyResult {
  changed: number;
  unchanged: number;
  /** True when this idempotency key had already been applied. */
  replayed: boolean;
}

/** A roster audit entry with the actor's display name. */
export interface PersonRosterEvent extends PersonRosterEventRow {
  actor_name: string | null;
}

/** Every tag in use (or catalogued), with its group and how many people carry it. */
export interface RosterTag {
  tag: string;
  group_id: string | null;
  people: number;
}

export interface RosterTagCatalog {
  groups: PersonTagGroupRow[];
  tags: RosterTag[];
}

export type GlobalSearchKind = 'person' | 'team' | 'position' | 'plan' | 'song' | 'media';

/**
 * One search hit. Built only from fields the caller may already read through
 * the record's own endpoint; `subtitle` never carries contact details unless
 * the caller holds people.view_private.
 */
export interface GlobalSearchHit {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** In-app path that opens the record. */
  href: string;
  archived?: boolean;
}

export interface GlobalSearchGroup {
  kind: GlobalSearchKind;
  hits: GlobalSearchHit[];
  /** More visible matches exist than were returned (never a count of hidden ones). */
  has_more: boolean;
}

export interface GlobalSearchResults {
  query: string;
  groups: GlobalSearchGroup[];
}

// ---------------------------------------------- identity and guests (A/B)

/** Whether a request can reach a Person, without revealing the address. */
export type PersonDeliveryReadiness = {
  person_id: string;
  has_login: boolean;
  has_email: boolean;
  /** False for a linked Person whose membership is inactive or removed. */
  active: boolean;
};

export type IdentityReconciliationReason = 'email_match' | 'invitation_conflict';
export type IdentityReconciliationStatus = 'open' | 'kept_separate' | 'merged';

export type PersonIdentityReconciliationRow = {
  id: string;
  organization_id: string;
  profile_id: string | null;
  person_id: string;
  candidate_person_id: string;
  reason: IdentityReconciliationReason;
  status: IdentityReconciliationStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};

/** A reconciliation report with both Persons named, for administrators. */
export interface IdentityReconciliation extends PersonIdentityReconciliationRow {
  person_name: string;
  candidate_name: string;
}

/** `accept_person_invitation` outcome. */
export type InvitationLinkStatus = 'linked' | 'invalid' | 'person_linked' | 'identity_conflict';

export type AcceptPersonInvitationRow = {
  out_status: InvitationLinkStatus;
  out_organization_id: string | null;
  out_person_id: string | null;
  out_role: 'owner' | 'admin' | 'scheduler' | 'member' | null;
};

/** `POST /people/:id/invitations`. A login is never linked here by email. */
export interface PersonInvitationResult {
  linked: false;
  invited: true;
  invite_url: string;
}

/** `POST /invitations/:token/accept`. */
export interface InvitationAcceptResult {
  email: string;
  linked_existing_account: boolean;
}
