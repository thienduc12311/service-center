import type { DeliveryChannel, DeliveryStatus } from './database.js';

/**
 * F09 — audience-scoped notes, item discussion, targeted operational
 * messages and team/plan conversations.
 */

/** Who may read a note. Plan leaders always read every audience. */
export type NoteAudience = 'organization' | 'scheduled' | 'teams' | 'leaders';

export type NoteCategoryRow = {
  id: string;
  organization_id: string;
  /** Null: offered on every service type. */
  service_type_id: string | null;
  name: string;
  default_audience: NoteAudience;
  sort_order: number;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PlanNoteRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  /** Set for a note on one item; null for a plan note. */
  plan_item_id: string | null;
  category_id: string | null;
  audience: NoteAudience;
  body: string;
  /** The note `plans.notes` mirrors (organization audience, no category). */
  is_legacy: boolean;
  revision: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export type PlanNoteTeamRow = {
  note_id: string;
  organization_id: string;
  team_id: string;
}

/** A note as the API returns it: only notes the caller may read. */
export interface PlanNote extends PlanNoteRow {
  team_ids: string[];
  author_name: string | null;
}

export interface PlanNotesResponse {
  notes: PlanNote[];
  /** Live categories offered on this plan's service type. */
  categories: NoteCategoryRow[];
  /** plans.edit on this plan. */
  can_edit: boolean;
}

export type PlanItemCommentRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  plan_item_id: string;
  author_id: string;
  author_person_id: string | null;
  /** Empty once deleted. */
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
}

/** How a mention was resolved when the comment/message was posted. */
export type MentionResolution = 'notified' | 'no_access' | 'no_login' | 'muted';

export type PlanItemCommentMentionRow = {
  comment_id: string;
  organization_id: string;
  person_id: string;
  resolution: Exclude<MentionResolution, 'muted'>;
}

export interface DiscussionMention {
  person_id: string;
  name: string;
  resolution: MentionResolution;
}

/** Someone the caller can usefully mention (a current participant). */
export interface MentionCandidate {
  person_id: string;
  name: string;
}

export interface PlanItemComment extends PlanItemCommentRow {
  author_name: string | null;
  mentions: DiscussionMention[];
  /** The caller wrote it (may edit/delete). */
  is_mine: boolean;
}

/** Keyset page, newest first. Pass `next_before` as `before` for older rows. */
export interface DiscussionPage<T> {
  data: T[];
  next_before: string | null;
}

export interface PlanItemThread extends DiscussionPage<PlanItemComment> {
  /** plans.edit on the plan: may delete anyone's comment. */
  can_moderate: boolean;
}

export interface PostDiscussionResult<T> {
  item: T;
  /** True when this id was already posted (a retried send). */
  replayed: boolean;
}

export type DiscussionAuditAction = 'edited' | 'deleted' | 'hidden' | 'restored' | 'report_dismissed';

export type DiscussionAuditEventRow = {
  id: string;
  organization_id: string;
  subject_type: 'item_comment' | 'conversation_message';
  subject_id: string;
  action: DiscussionAuditAction;
  actor_id: string | null;
  previous_body: string | null;
  reason: string | null;
  created_at: string;
}

// ----------------------------------------------------- targeted messages ---

/** Why someone is in a message audience. */
export type MessageAudienceReason = 'team_member' | 'scheduled_confirmed' | 'scheduled_pending' | 'signup';
/** What the sender selects. */
export type MessageAudienceInclude = 'team_members' | 'scheduled_confirmed' | 'scheduled_pending' | 'signups';

export interface MessageAudience {
  plan_id?: string | null;
  team_ids?: string[];
  include: MessageAudienceInclude[];
}

export interface MessageAudienceRecipient {
  person_id: string;
  first_name: string;
  last_name: string | null;
  reasons: MessageAudienceReason[];
  has_login: boolean;
  has_email: boolean;
  /** Has at least one channel (sign-in or email). */
  reachable: boolean;
}

export interface MessageAudiencePreview {
  /** Pass back on send; a material audience change since then is refused. */
  audience_hash: string;
  recipients: MessageAudienceRecipient[];
}

export type MessageTemplateRow = {
  id: string;
  organization_id: string;
  /** Null: shared with every sender. */
  owner_id: string | null;
  name: string;
  subject: string;
  body: string;
  revision: number;
  archived_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageTemplateList {
  templates: MessageTemplateRow[];
  /** May create/edit shared templates. */
  can_manage_shared: boolean;
}

export type OperationalMessageRow = {
  id: string;
  organization_id: string;
  plan_id: string | null;
  audience: MessageAudience;
  audience_hash: string;
  request_hash: string;
  subject: string;
  body: string;
  variables: MessageVariableSnapshot;
  template_id: string | null;
  template_revision: number | null;
  recipient_count: number;
  excluded_count: number;
  idempotency_key: string;
  created_by: string;
  created_at: string;
}

/** Variable values captured at send time (recipient names live on each recipient row). */
export interface MessageVariableSnapshot {
  organization_name?: string | null;
  organization_timezone?: string | null;
  plan_title?: string | null;
  plan_date?: string | null;
  sender_name?: string | null;
}

export type OperationalRecipientStatus = 'included' | 'excluded_no_address' | 'excluded_by_sender';

export type OperationalMessageRecipientRow = {
  message_id: string;
  organization_id: string;
  person_id: string;
  profile_id: string | null;
  first_name: string;
  last_name: string | null;
  reasons: MessageAudienceReason[];
  has_login: boolean;
  has_email: boolean;
  status: OperationalRecipientStatus;
}

export interface SendOperationalMessageResult {
  message: OperationalMessageRow;
  replayed: boolean;
}

/** One delivery channel's outcome for one recipient. */
export interface MessageChannelOutcome {
  delivery_id: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  error_code: string | null;
  attempts: number;
  completed_at: string | null;
}

export interface MessageRecipientOutcome {
  person_id: string;
  first_name: string;
  last_name: string | null;
  reasons: MessageAudienceReason[];
  status: OperationalRecipientStatus;
  channels: MessageChannelOutcome[];
  /** Has a failed or uncertain channel the sender may retry. */
  retryable: boolean;
}

export interface OperationalMessageDetail {
  message: OperationalMessageRow;
  sender_name: string | null;
  /** Sender/administrator view only; absent for a recipient. */
  outcomes?: MessageRecipientOutcome[];
  can_retry: boolean;
  /** For a recipient: the text exactly as it was rendered for them. */
  rendered_for_me?: { subject: string; body: string } | null;
}

export interface OperationalMessageSummary extends OperationalMessageRow {
  sender_name: string | null;
  /** The caller sent it (not merely received it). */
  sent_by_me: boolean;
}

// --------------------------------------------------------- conversations ---

export type ConversationKind = 'team' | 'plan';

export type ConversationRow = {
  id: string;
  organization_id: string;
  kind: ConversationKind;
  team_id: string | null;
  plan_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  team_id: string | null;
  plan_id: string | null;
  title: string;
  service_date: string | null;
  last_message_at: string | null;
  unread_count: number;
  muted: boolean;
  can_moderate: boolean;
  open_reports: number;
}

export type ConversationMessageRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  author_id: string;
  author_person_id: string | null;
  reply_to_id: string | null;
  /** Empty when deleted or hidden. */
  body: string;
  edited_at: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  created_at: string;
}

export type ConversationMessageMentionRow = {
  message_id: string;
  organization_id: string;
  person_id: string;
  resolution: MentionResolution;
}

export interface ConversationMessage extends ConversationMessageRow {
  author_name: string | null;
  mentions: DiscussionMention[];
  is_mine: boolean;
}

export type ConversationMemberStateRow = {
  conversation_id: string;
  user_id: string;
  organization_id: string;
  last_read_at: string | null;
  muted: boolean;
  updated_at: string;
}

export type ConversationReportReason = 'spam' | 'harassment' | 'inappropriate' | 'safety' | 'other';
export type ConversationReportStatus = 'open' | 'dismissed' | 'actioned';

export type ConversationMessageReportRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  message_id: string;
  reporter_id: string;
  reason: ConversationReportReason;
  details: string | null;
  status: ConversationReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
}

export interface ConversationReport extends ConversationMessageReportRow {
  reporter_name: string | null;
  /** Current text (empty when already hidden/deleted). */
  message_body: string;
  message_author_name: string | null;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: DiscussionPage<ConversationMessage>;
  /** Moderators only. */
  reports: ConversationReport[];
}
