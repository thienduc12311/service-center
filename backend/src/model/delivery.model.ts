import type {
  DeliveryChannel,
  DeliveryRow,
  DeliveryStatus,
  DeliveryTemplate,
  ResponseTransition,
  AssignmentStatus,
} from '@service-center/shared';

/**
 * What the worker should do after a failed provider call.
 *  - `retry`: the provider said no for a reason that can pass (rate limit,
 *    outage); try again after a backoff.
 *  - `fail`: retrying will not help (bad address, misconfiguration).
 *  - `ambiguous`: we cannot tell whether the message went out (timeout, lost
 *    connection). Never retried automatically.
 */
export type DeliveryDisposition = 'retry' | 'fail' | 'ambiguous';

/** Short machine codes stored with a delivery. Never provider text. */
export type DeliveryErrorCode =
  | 'no_email_address'
  | 'no_active_device'
  | 'recipient_not_eligible'
  | 'scheduler_not_active'
  | 'plan_missing'
  | 'request_missing'
  | 'already_reviewed'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'provider_misconfigured'
  | 'provider_timeout'
  /** F08: the provider already holds an earlier attempt under this idempotency key. */
  | 'provider_duplicate_key'
  /** F08: a materialized reminder no longer matched current state at dispatch. */
  | 'reminder_obsolete'
  /** F09: the comment/message was deleted or hidden before it was announced. */
  | 'content_removed'
  /** F09: the recipient muted the conversation after the message was posted. */
  | 'conversation_muted'
  /** F09: a channel this kind of announcement never uses. */
  | 'channel_not_used'
  | 'internal_error';

export class DeliveryError extends Error {
  constructor(
    readonly code: DeliveryErrorCode,
    readonly disposition: DeliveryDisposition,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = 'DeliveryError';
  }
}

/** A finished attempt, as the worker records it. */
export interface DispatchResult {
  status: Exclude<DeliveryStatus, 'queued' | 'sending'> | 'queued';
  errorCode?: DeliveryErrorCode;
  providerMessageId?: string | null;
  retryAfterSeconds?: number;
}

/** A leased delivery, in domain terms. */
export interface DeliveryJob {
  id: string;
  organizationId: string;
  effectId: string;
  /** Linked Profile, when the Person can receive in-app/push. */
  recipientId: string | null;
  recipientPersonId: string;
  channel: DeliveryChannel;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
}

export const mapDeliveryRowToJob = (row: DeliveryRow): DeliveryJob => ({
  id: row.id,
  organizationId: row.organization_id,
  effectId: row.effect_id,
  recipientId: row.recipient_id,
  recipientPersonId: row.recipient_person_id,
  channel: row.channel,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  leaseOwner: row.lease_owner ?? '',
});

/** The action a delivery belongs to, in domain terms. */
export interface DeliveryEffect {
  id: string;
  organizationId: string;
  template: DeliveryTemplate;
  planId: string | null;
  assignmentIds: string[];
  responderId: string | null;
  responderPersonId: string | null;
  responseStatus: AssignmentStatus | null;
  responseTransition: ResponseTransition | null;
  /** F03 availability request this effect announces. */
  availabilityRequestId: string | null;
  /** F08: the consolidated release batch this request belongs to. */
  releaseBatchId: string | null;
  /** F08: the reminder job this effect materialized. */
  reminderJobId: string | null;
  /** F09: the item comment, targeted message or conversation message announced. */
  commentId: string | null;
  operationalMessageId: string | null;
  conversationMessageId: string | null;
  createdBy: string | null;
}

export interface WorkerRunOptions {
  /** Most deliveries to claim in this run (bounded at 100 by the database). */
  limit: number;
  /** Only this effect's deliveries — used to deliver right after an action. */
  effectId?: string;
  /** Stop claiming more once this much time has passed. */
  timeBudgetMs?: number;
  workerId?: string;
}

export interface WorkerRunResult {
  claimed: number;
  completed: number;
  /** Re-queued for a later retry. */
  retried: number;
  /** Lost the lease before finishing (another run recovers them). */
  abandoned: number;
  /** F08: scheduled releases this run executed (released or failed). */
  releases: number;
  /** F08: reminder jobs this run turned into outbox deliveries. */
  remindersEnqueued: number;
  /** F09: conversation messages removed by retention this run. */
  conversationMessagesPurged: number;
}
