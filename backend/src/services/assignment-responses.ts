import {
  assignmentStatusSchema,
  type AssignmentRequestSnapshotRow,
  type AssignmentRespondPreview,
  type AssignmentRespondResult,
  type AssignmentResponseCommitResult,
  type AssignmentResponseReview,
  type AssignmentRow,
  type AssignmentStatus,
  type DelegatedResponseResult,
  type PlanTimeRow,
  type RespondToAssignmentSnapshotsInput,
} from '@service-center/shared';
import { chunk } from '../lib/chunk.js';
import { raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import type {
  AssignmentNotificationRecord,
  DelegatedRespondCommand,
  DelegatedResponseRpcRow,
  LinkOutcome,
  RespondAsSelfInput,
  RespondViaLinkInput,
  ResponseCaller,
  ResponseDependencies,
  ResponseOutcome,
  SelfResponseRpcRow,
  StoredAssignmentNotification,
} from '../model/assignment-response.model.js';
import type { SnapshotAssignmentJoin } from '../model/assignment-snapshot.model.js';
import { delegationSummary, type AvailabilityContext } from './availability.js';
import { hashInviteToken } from './invitations.js';

/**
 * The Response module: every way a person's confirm or decline reaches the
 * database, and the two previews they answer from.
 *
 * Four write paths — signed-in, respond link, delegate, Request Snapshot
 * commit — each end in a database function that checks the answer, writes
 * it and records the scheduler update (F00 outbox) in one transaction. They
 * share one outcome shape, one list of answer errors and one delivery step,
 * so the same situation reads the same way to every client.
 */
export interface ResponseModule {
  /** A signed-in person answers one of their own assignments; returns the updated row. */
  respondAsSelf(input: RespondAsSelfInput): Promise<AssignmentRow>;
  /** Someone holding a respond link answers every request it covers. */
  respondViaLink(input: RespondViaLinkInput): Promise<AssignmentRespondResult>;
  /** A delegate answers one released request for the person who granted them. */
  respondAsDelegate(ctx: AvailabilityContext, command: DelegatedRespondCommand): Promise<DelegatedResponseResult>;
  /** Commits every reviewed Request Snapshot atomically, retry-safe by idempotency key. */
  commitSnapshotResponses(caller: ResponseCaller, input: RespondToAssignmentSnapshotsInput): Promise<AssignmentResponseCommitResult>;
  /** What a respond link shows before anyone answers. */
  previewLink(token: string): Promise<AssignmentRespondPreview>;
  /** Freezes the selected released requests into Request Snapshots and returns their review. */
  previewSnapshots(caller: ResponseCaller, assignmentIds: readonly string[]): Promise<AssignmentResponseReview[]>;
}

// ------------------------------------------------------- answer errors ----

const SELF_FORBIDDEN_MESSAGE = 'You declined this position. Ask a scheduler if you can serve after all.';
/** `respond_as_delegate` raises both of its refusals as PT409; this one is the forbidden transition. */
const DELEGATE_FORBIDDEN_MESSAGE = 'A declined request needs a new scheduler request';

/**
 * Every refusal an answer can meet, defined once. Codes are the API
 * contract clients translate:
 *
 * - `assignment_response_stale`: the assignment moved on since the client
 *   read it (another device, a scheduler). Re-read and review.
 * - `assignment_response_forbidden`: only a scheduler can change it now — a
 *   declined assignment is never re-accepted by its assignee.
 * - `assignment_request_stale`: the request a link or Request Snapshot was
 *   issued for changed; the person needs a fresh request.
 * - `assignment_notification_used` / `assignment_notification_expired`: the
 *   respond link can no longer answer.
 */
export const ANSWER_ERRORS = {
  assignmentNotFound: () => HttpError.notFound('Assignment not found'),
  notOwnAssignment: () => HttpError.forbidden('You can only respond to your own assignments'),
  requestNotFound: () => HttpError.notFound('Request not found'),
  responseStale: (current?: AssignmentStatus) =>
    new HttpError(
      409,
      'This assignment changed since you opened it. Refresh and review it again.',
      'assignment_response_stale',
      current ? { status: current } : undefined,
    ),
  responseForbidden: (message: string = SELF_FORBIDDEN_MESSAGE) =>
    new HttpError(409, message, 'assignment_response_forbidden'),
  linkNotFound: () => HttpError.notFound('That assignment response link is not valid'),
  linkUsed: () => new HttpError(410, 'This assignment response link has already been used', 'assignment_notification_used'),
  linkExpired: () => new HttpError(410, 'This assignment response link has expired', 'assignment_notification_expired'),
  linkNeedsReissue: () => new HttpError(409, 'This response link needs to be reissued', 'assignment_request_stale'),
  requestStale: () =>
    new HttpError(409, 'This request changed. Refresh or ask your scheduler for a new link.', 'assignment_request_stale'),
  snapshotNotFound: () => HttpError.notFound('Response snapshot not found'),
} as const;

/** The refusal for a respond link that cannot answer; null when it can. */
const linkError = (outcome: LinkOutcome): HttpError | null => {
  switch (outcome) {
    case 'ok':
      return null;
    case 'not_found':
      return ANSWER_ERRORS.linkNotFound();
    case 'used':
      return ANSWER_ERRORS.linkUsed();
    case 'expired':
      return ANSWER_ERRORS.linkExpired();
    case 'stale':
      return ANSWER_ERRORS.requestStale();
  }
};

interface DatabaseError {
  code?: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

/** `respond_as_self` puts the current status in DETAIL when it refuses as stale. */
const statusFromDetail = (details: string | null | undefined): AssignmentStatus | undefined => {
  const parsed = assignmentStatusSchema.safeParse(details);
  return parsed.success ? parsed.data : undefined;
};

const selfAnswerError = (error: DatabaseError): HttpError => {
  if (error.code === 'PT409' && error.hint === 'assignment_response_stale') {
    return ANSWER_ERRORS.responseStale(statusFromDetail(error.details));
  }
  if (error.code === 'PT409' && error.hint === 'assignment_response_forbidden') return ANSWER_ERRORS.responseForbidden();
  if (error.code === '42501' && error.hint === 'assignment_not_own') return ANSWER_ERRORS.notOwnAssignment();
  if (error.code === 'P0002') return ANSWER_ERRORS.assignmentNotFound();
  return fromPostgrestError(error);
};

const delegateAnswerError = (error: DatabaseError): HttpError => {
  if (error.code === 'PT409') {
    return error.message === DELEGATE_FORBIDDEN_MESSAGE
      ? ANSWER_ERRORS.responseForbidden(error.message)
      : ANSWER_ERRORS.responseStale();
  }
  return fromPostgrestError(error);
};

// ----------------------------------------------------- review loading -----

const REVIEW_ITEM_SELECT = `
  *,
  assignment:assignments!inner(
    id, plan_id, status, request_revision,
    team:teams(name),
    position:team_positions(name),
    plan:plans(title),
    time_responses:assignment_time_responses(*)
  )
`;

/**
 * The immutable review shape shared by signed-in and public clients. Reads
 * with the service role, so it stays private to this module: callers reach
 * the snapshot first, through RLS or a verified link token.
 */
const loadReview = async (serviceDb: Db, snapshot: AssignmentRequestSnapshotRow): Promise<AssignmentResponseReview> => {
  const items = (await unwrap(
    raw(serviceDb)
      .from('assignment_request_snapshot_items')
      .select(REVIEW_ITEM_SELECT)
      .eq('snapshot_id', snapshot.id)
      .order('assignment_id'),
  )) as unknown as SnapshotAssignmentJoin[];
  if (items.length === 0) throw ANSWER_ERRORS.snapshotNotFound();

  const timeIds = [...new Set(items.flatMap((item) => item.plan_time_ids))];
  const times: PlanTimeRow[] = timeIds.length
    ? ((await unwrap(serviceDb.from('plan_times').select('*').in('id', timeIds))) ?? [])
    : [];
  const byTime = new Map(times.map((time) => [time.id, time]));

  return {
    snapshot_id: snapshot.id,
    version: snapshot.version,
    person_id: snapshot.person_id,
    plan_id: snapshot.plan_id,
    expires_at: snapshot.expires_at,
    assignments: items.map((item) => ({
      assignment_id: item.assignment.id,
      plan_id: item.assignment.plan_id,
      plan_title: item.assignment.plan?.title ?? 'Plan',
      team_name: item.assignment.team?.name ?? 'Team',
      position_name: item.assignment.position?.name ?? null,
      status: item.assignment.status,
      request_revision: item.expected_request_revision,
      times: item.plan_time_ids
        .map((id) => byTime.get(id))
        .filter((time): time is PlanTimeRow => Boolean(time))
        .sort((a, b) => a.sort_order - b.sort_order || a.starts_at.localeCompare(b.starts_at)),
      time_responses: item.assignment.time_responses.filter((response) =>
        item.plan_time_ids.includes(response.plan_time_id),
      ),
    })),
  };
};

// ----------------------------------------------------------- the module ---

export const createResponses = ({ serviceDb, deliver }: ResponseDependencies): ResponseModule => {
  /**
   * The one delivery step. Runs after the answer committed; a delivery
   * problem never turns that answer into an error — whatever is not sent
   * now stays queued for the next worker run.
   */
  const settle = async <TResult>(outcome: ResponseOutcome<TResult>): Promise<TResult> => {
    const effectIds = outcome.effectIds.filter((id): id is string => Boolean(id));
    const results = await Promise.allSettled(effectIds.map((id) => deliver(id)));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const reason: unknown = result.reason;
        console.warn(
          `[responses] immediate delivery of ${effectIds[index]} deferred to the worker (${reason instanceof Error ? reason.name : 'error'})`,
        );
      }
    });
    return outcome.result;
  };

  /**
   * Resolves a link token. F08: the last provider-accepted token stays usable
   * (with its own exact snapshot) until its replacement is accepted, so the
   * preview reads whichever snapshot the presented token was issued for —
   * the same rule `respond_via_assignment_link` applies.
   */
  const loadNotification = async (token: string): Promise<AssignmentNotificationRecord> => {
    const hash = hashInviteToken(token);
    const found = await unwrap(
      serviceDb
        .from('assignment_notifications')
        .select(
          'id, plan_id, organization_id, person_id, user_id, snapshot_id, email, expires_at, responded_at, token_hash, previous_token_hash, previous_snapshot_id, previous_expires_at',
        )
        .or(`token_hash.eq.${hash},previous_token_hash.eq.${hash}`)
        .maybeSingle(),
    );
    if (!found) throw ANSWER_ERRORS.linkNotFound();
    const stored = found as StoredAssignmentNotification;
    const viaPrevious = stored.token_hash !== hash;
    const record: AssignmentNotificationRecord = {
      id: stored.id,
      plan_id: stored.plan_id,
      organization_id: stored.organization_id,
      person_id: stored.person_id,
      user_id: stored.user_id,
      snapshot_id: viaPrevious ? stored.previous_snapshot_id : stored.snapshot_id,
      email: stored.email,
      expires_at: (viaPrevious ? stored.previous_expires_at : stored.expires_at) ?? stored.expires_at,
      responded_at: stored.responded_at,
    };
    const outcome: LinkOutcome = record.responded_at
      ? 'used'
      : new Date(record.expires_at) <= new Date()
        ? 'expired'
        : 'ok';
    const refusal = linkError(outcome);
    if (refusal) throw refusal;
    return record;
  };

  return {
    async respondAsSelf(input) {
      const { data, error } = await input.db.rpc('respond_as_self', {
        p_organization_id: input.orgId,
        p_assignment_id: input.assignmentId,
        p_status: input.status,
        p_expected_status: input.expectedStatus ?? null,
        p_reason: input.reason,
      });
      if (error) throw selfAnswerError(error);
      const row: SelfResponseRpcRow | undefined = data?.[0];
      if (!row) throw ANSWER_ERRORS.assignmentNotFound();
      return settle({
        result: row.assignment,
        effectIds: row.transition === 'unchanged' ? [] : [row.effect_id],
      });
    },

    /**
     * Verifying the link, answering every position that may still take the
     * answer, using up the link and recording the scheduler update all
     * happen in one transaction.
     */
    async respondViaLink(input) {
      const rows = await unwrap(
        serviceDb.rpc('respond_via_assignment_link', {
          p_token_hash: hashInviteToken(input.token),
          p_status: input.status,
        }),
      );
      const answer = rows?.[0];
      if (!answer) throw ANSWER_ERRORS.linkNotFound();
      const refusal = linkError(answer.outcome);
      if (refusal) throw refusal;
      return settle({
        result: { status: input.status, assignments_updated: answer.assignments_updated },
        effectIds: [answer.effect_id],
      });
    },

    async respondAsDelegate(ctx, command) {
      const delegation = await delegationSummary(ctx, command.delegationId);
      if (delegation.direction !== 'received') throw ANSWER_ERRORS.requestNotFound();
      const { data, error } = await raw(ctx.db).rpc('respond_as_delegate', {
        p_organization_id: ctx.orgId,
        p_person_id: delegation.target_person_id,
        p_assignment_id: command.assignmentId,
        p_status: command.status,
        p_expected_status: command.expectedStatus,
        p_reason: command.status === 'declined' ? command.reason?.trim() || null : null,
      });
      if (error) throw delegateAnswerError(error);
      const row = ((data ?? []) as DelegatedResponseRpcRow[])[0];
      if (!row) throw ANSWER_ERRORS.requestNotFound();
      return settle({
        result: { assignment_id: row.assignment_id, status: row.status, transition: row.transition },
        effectIds: row.transition === 'unchanged' ? [] : [row.effect_id],
      });
    },

    async commitSnapshotResponses(caller, input) {
      const result = (await unwrap(
        caller.db.rpc('respond_to_assignment_snapshots', {
          p_organization_id: caller.orgId,
          p_responses: input.responses,
          p_idempotency_key: input.idempotency_key,
        }),
      )) as AssignmentResponseCommitResult;
      return settle({ result, effectIds: result.effect_ids });
    },

    async previewLink(token) {
      const notification = await loadNotification(token);
      if (!notification.snapshot_id) throw ANSWER_ERRORS.linkNeedsReissue();
      const [plan, person, snapshot] = await Promise.all([
        unwrapOne(serviceDb.from('plans').select('title, service_date, location').eq('id', notification.plan_id).single()),
        unwrap(serviceDb.from('people').select('first_name, preferred_language').eq('id', notification.person_id).maybeSingle()),
        unwrap(serviceDb.from('assignment_request_snapshots').select('*').eq('id', notification.snapshot_id).maybeSingle()),
      ]);
      if (!snapshot || snapshot.superseded_at || snapshot.consumed_at) throw ANSWER_ERRORS.requestStale();
      // The token was verified above, so this snapshot is the holder's to read.
      const review = await loadReview(serviceDb, snapshot);
      const serviceTime =
        review.assignments.flatMap((assignment) => assignment.times).find((time) => time.kind === 'service') ?? null;
      return {
        snapshot_id: review.snapshot_id,
        snapshot_version: review.version,
        plan_title: plan.title,
        service_date: plan.service_date,
        service_time: serviceTime ? { starts_at: serviceTime.starts_at, ends_at: serviceTime.ends_at } : null,
        location: plan.location,
        person_first_name: person?.first_name ?? '',
        // Token verified above: the recipient's own language may be used for this page.
        preferred_language: person?.preferred_language ?? null,
        assignments: review.assignments.map((assignment) => ({
          assignment_id: assignment.assignment_id,
          team_name: assignment.team_name,
          position_name: assignment.position_name,
          status: assignment.status,
          request_revision: assignment.request_revision,
          times: assignment.times,
          time_responses: assignment.time_responses,
        })),
        expires_at: notification.expires_at,
      };
    },

    async previewSnapshots(caller, assignmentIds) {
      // Created through the caller's RLS, so each snapshot is theirs to review.
      const snapshots = await unwrap(
        caller.db.rpc('preview_assignment_responses', {
          p_organization_id: caller.orgId,
          p_assignment_ids: [...assignmentIds],
        }),
      );
      return Promise.all((snapshots ?? []).map((snapshot) => loadReview(serviceDb, snapshot)));
    },
  };
};

/**
 * The reason recorded with each assignment's latest decline. Reads through
 * the caller's RLS scope, so only their own history (or, for a scheduler,
 * their organization's) is ever visible.
 */
export const latestDeclineReasons = async (
  db: Db,
  assignmentIds: readonly string[],
): Promise<Map<string, string>> => {
  const reasons = new Map<string, string>();
  if (assignmentIds.length === 0) return reasons;
  const batches = await Promise.all(
    chunk(assignmentIds).map((ids) =>
      unwrap(
        db
          .from('assignment_responses')
          .select('assignment_id, response_note, created_at')
          .in('assignment_id', ids)
          .eq('status', 'declined')
          .order('created_at', { ascending: false }),
      ),
    ),
  );
  // Each batch is newest first; assignments never span batches, so merging keeps that per assignment.
  const rows = batches.flatMap((batch) => batch ?? []);
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    // Newest first: only the latest decline counts, even when it had no reason.
    if (seen.has(row.assignment_id)) continue;
    seen.add(row.assignment_id);
    if (row.response_note) reasons.set(row.assignment_id, row.response_note);
  }
  return reasons;
};
