import { randomUUID } from 'node:crypto';
import {
  RETRYABLE_DELIVERY_STATUSES,
  PENDING_DELIVERY_STATUSES,
  isRetryableDelivery,
  summarizeDeliveryOutcomes,
  type AssignmentNotificationSendResult,
  type DeliveryList,
  type DeliveryListItem,
  type DeliveryOutcome,
  type DeliveryRow,
  type DeliveryStatus,
  type DeliveryTemplate,
  type DeliveryTransportStatus,
  type ListDeliveriesQuery,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';
import { emailTransport } from './notifications.js';
import { pushTransport } from './expo-push.js';
import { deliverEffectNow } from './delivery-worker.js';

/** A delivery row with the joins the outcome views need. */
type DeliveryWithJoins = DeliveryRow & {
  recipient: { full_name: string | null } | null;
  recipient_person: { first_name: string; last_name: string | null } | null;
  effect: { template: DeliveryTemplate; plan_id: string | null; plan: { title: string } | null } | null;
};

const DELIVERY_SELECT = `
  *,
  recipient:profiles!deliveries_recipient_id_fkey(full_name),
  recipient_person:people!deliveries_recipient_person_id_fkey(first_name, last_name),
  effect:delivery_effects!inner(template, plan_id, plan:plans(title))
`;

export const toDeliveryOutcome = (row: DeliveryWithJoins): DeliveryOutcome => ({
  id: row.id,
  recipient_id: row.recipient_id,
  recipient_person_id: row.recipient_person_id,
  recipient_name: row.recipient?.full_name
    ?? [row.recipient_person?.first_name, row.recipient_person?.last_name].filter(Boolean).join(' ')
    ?? null,
  channel: row.channel,
  status: row.status,
  attempts: row.attempts,
  error_code: row.last_error_code,
  accepted_at: row.accepted_at,
  delivered_at: row.delivered_at,
  completed_at: row.completed_at,
  next_attempt_at: row.status === 'queued' ? row.next_attempt_at : null,
  retryable: isRetryableDelivery(row.status),
});

const toDeliveryListItem = (row: DeliveryWithJoins): DeliveryListItem => ({
  ...toDeliveryOutcome(row),
  template: row.effect?.template ?? 'assignment_request',
  plan_id: row.effect?.plan_id ?? null,
  plan_title: row.effect?.plan?.title ?? null,
  created_at: row.created_at,
});

/** Outcomes of one action, read through the caller's RLS scope (managers). */
export const effectOutcomes = async (db: Db, effectId: string): Promise<DeliveryOutcome[]> => {
  const rows = (await unwrap(
    raw(db)
      .from('deliveries')
      .select(DELIVERY_SELECT)
      .eq('effect_id', effectId)
      .order('recipient_id')
      .order('channel'),
  )) as unknown as DeliveryWithJoins[];
  return rows.map(toDeliveryOutcome);
};

/** The notify-style response: per-recipient outcomes plus the old aggregate. */
export const notificationSendResult = async (
  db: Db,
  effectId: string | null,
): Promise<AssignmentNotificationSendResult> => {
  const outcomes = effectId ? await effectOutcomes(db, effectId) : [];
  const email = outcomes.filter((outcome) => outcome.channel === 'email');
  return {
    notified: email.filter((outcome) => outcome.status === 'provider_accepted').length,
    skipped: email
      .filter((outcome) => outcome.error_code === 'no_email_address')
      .map((outcome) => outcome.recipient_name ?? 'Unknown person'),
    effect_id: effectId,
    email_mode: emailTransport().mode,
    outcomes,
    summary: summarizeDeliveryOutcomes(outcomes),
  };
};

export interface EnqueuePlanNotificationsInput {
  db: Db;
  orgId: string;
  planId: string;
  template: Extract<DeliveryTemplate, 'assignment_request' | 'assignment_reminder'>;
  assignmentIds: string[];
  /** Stable for a retried request; a fresh one otherwise. */
  idempotencyKey?: string;
  /** Distinguishes what caused the action in the effect key. */
  reason: 'notify' | 'plan-changed';
}

/**
 * Records a request/reminder effect, delivers it right away, and returns the
 * per-recipient outcomes. The same idempotency key returns the outcomes of
 * the first request instead of sending again.
 */
export const notifyPlanAssignments = async (
  input: EnqueuePlanNotificationsInput,
): Promise<AssignmentNotificationSendResult> => {
  const effectKey = `${input.reason}:${input.planId}:${input.idempotencyKey ?? randomUUID()}`;
  const effectId = await unwrap(
    input.db.rpc('enqueue_plan_notifications', {
      p_plan_id: input.planId,
      p_template: input.template,
      p_assignment_ids: input.assignmentIds,
      p_effect_key: effectKey,
    }),
  );
  await deliverEffectNow(effectId);
  return notificationSendResult(input.db, effectId);
};

/** The effect an action recorded under a known key, if any. */
export const effectIdForKey = async (db: Db, orgId: string, effectKey: string): Promise<string | null> => {
  const row = await unwrap(
    db.from('delivery_effects').select('id').eq('organization_id', orgId).eq('effect_key', effectKey).maybeSingle(),
  );
  return row?.id ?? null;
};

/**
 * The scheduler update the database recorded with an answer. Read with the
 * service role: the person answering cannot (and need not) see the outbox.
 */
export const latestResponseEffectId = async (adminClient: Db, assignmentId: string): Promise<string | null> => {
  const row = await unwrap(
    adminClient
      .from('delivery_effects')
      .select('id')
      .eq('template', 'scheduler_response')
      .contains('assignment_ids', [assignmentId])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return row?.id ?? null;
};

/** Administrator list, newest first, bounded and cursor-paginated. */
export const listDeliveries = async (db: Db, orgId: string, query: ListDeliveriesQuery): Promise<DeliveryList> => {
  let request = raw(db)
    .from('deliveries')
    .select(DELIVERY_SELECT)
    .eq('organization_id', orgId);
  if (query.status) request = request.eq('status', query.status);
  else if (query.needs_attention) request = request.in('status', [...RETRYABLE_DELIVERY_STATUSES]);
  if (query.channel) request = request.eq('channel', query.channel);
  if (query.plan_id) request = request.eq('effect.plan_id', query.plan_id);
  if (query.before) request = request.lt('created_at', query.before);

  const rows = (await unwrap(
    request.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit + 1),
  )) as unknown as DeliveryWithJoins[];
  const page = rows.slice(0, query.limit);
  return {
    data: page.map(toDeliveryListItem),
    next_before: rows.length > query.limit ? page[page.length - 1]?.created_at ?? null : null,
  };
};

const countDeliveries = async (db: Db, orgId: string, statuses: readonly DeliveryStatus[]): Promise<number> => {
  const { count, error } = await db
    .from('deliveries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .in('status', [...statuses]);
  if (error) throw new HttpError(500, 'Could not count deliveries');
  return count ?? 0;
};

export const deliveryTransportStatus = async (db: Db, orgId: string): Promise<DeliveryTransportStatus> => {
  const [pending, needsAttention] = await Promise.all([
    countDeliveries(db, orgId, PENDING_DELIVERY_STATUSES),
    countDeliveries(db, orgId, RETRYABLE_DELIVERY_STATUSES),
  ]);
  return {
    email: emailTransport().mode,
    push: pushTransport().mode,
    worker_configured: Boolean(config.CRON_SECRET),
    pending,
    needs_attention: needsAttention,
  };
};

/**
 * Re-queues a failed or uncertain delivery for one more attempt and tries it
 * straight away. The database checks the caller is an administrator of the
 * delivery's organization; retrying a queued one changes nothing.
 */
export const retryDelivery = async (db: Db, orgId: string, deliveryId: string): Promise<DeliveryListItem> => {
  const existing = await unwrap(
    db.from('deliveries').select('id, effect_id').eq('id', deliveryId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!existing) throw HttpError.notFound('Delivery not found');

  await unwrap(db.rpc('retry_delivery', { p_delivery_id: deliveryId }));
  await deliverEffectNow(existing.effect_id);

  const row = (await unwrap(
    raw(db).from('deliveries').select(DELIVERY_SELECT).eq('id', deliveryId).maybeSingle(),
  )) as unknown as DeliveryWithJoins | null;
  if (!row) throw HttpError.notFound('Delivery not found');
  return toDeliveryListItem(row);
};
