import type {
  AssignmentRow,
  AssignmentStatus,
  DelegatedResponseResult,
  SelfResponseStatus,
} from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

/**
 * Hands one recorded outbox effect to delivery once the answer has committed.
 * Production passes `deliverEffectNow`; tests pass a recorder.
 */
export type DeliverEffect = (effectId: string) => Promise<void>;

/** What the Response module needs from outside. */
export interface ResponseDependencies {
  /**
   * Service-role client. Used only for the respond-link path (no signed-in
   * user) and to read a Request Snapshot's review after the caller reached
   * that snapshot through RLS or a verified link token.
   */
  serviceDb: Db;
  deliver: DeliverEffect;
}

/** A signed-in caller acting in their active organization. */
export interface ResponseCaller {
  db: Db;
  orgId: string;
}

/** A signed-in person answering one of their own assignments. */
export interface RespondAsSelfInput extends ResponseCaller {
  assignmentId: string;
  status: SelfResponseStatus;
  reason: string | null;
  /** The status the client last saw; a mismatch is refused as stale. */
  expectedStatus?: AssignmentStatus;
}

/** Someone answering from the emailed respond link. */
export interface RespondViaLinkInput {
  token: string;
  status: SelfResponseStatus;
}

/** A delegate answering one released request for the person they help. */
export interface DelegatedRespondCommand {
  delegationId: string;
  assignmentId: string;
  status: SelfResponseStatus;
  expectedStatus: AssignmentStatus;
  reason: string | null;
}

/**
 * What every write path produces before the shared delivery step: the HTTP
 * result, and the outbox effects recorded in the same transaction.
 */
export interface ResponseOutcome<TResult> {
  result: TResult;
  effectIds: ReadonlyArray<string | null>;
}

/** `respond_as_self` output: the row, what kind of change it was, its effect. */
export interface SelfResponseRpcRow {
  assignment: AssignmentRow;
  transition: 'answer' | 'withdrawal' | 'unchanged';
  effect_id: string | null;
}

/** `respond_as_delegate` output. */
export interface DelegatedResponseRpcRow extends DelegatedResponseResult {
  effect_id: string | null;
}

/**
 * Every way a respond link can turn out; `respond_via_assignment_link`
 * reports the same set.
 */
export type LinkOutcome = 'ok' | 'not_found' | 'used' | 'expired' | 'stale';

/** A link token resolved to the notification it was issued with. */
export interface AssignmentNotificationRecord {
  id: string;
  plan_id: string;
  organization_id: string;
  person_id: string;
  user_id: string | null;
  snapshot_id: string | null;
  email: string;
  expires_at: string;
  responded_at: string | null;
}

/** The stored row: the current token, plus the previous one still honoured (F08). */
export interface StoredAssignmentNotification extends AssignmentNotificationRecord {
  token_hash: string;
  previous_token_hash: string | null;
  previous_snapshot_id: string | null;
  previous_expires_at: string | null;
}
