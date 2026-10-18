import { recipientSequence } from '../model/attendance.model.js';
import {
  formatDate,
  messageVariableValues,
  renderMessageTemplate,
  type DeliveryEffectRow,
  type MessageVariableSnapshot,
  type EmailTransportMode,
  type NotificationType,
  type PushTransportMode,
} from '@service-center/shared';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { renderIcs, type IcsEvent } from '../lib/ics.js';
import { config } from '../config.js';
import {
  DeliveryError,
  type DeliveryEffect,
  type DeliveryErrorCode,
  type DeliveryJob,
  type DispatchResult,
} from '../model/delivery.model.js';
import type { NotificationDraft, PushMessage } from '../model/notification.model.js';
import { toPushMessage } from '../model/notification.model.js';
import { ensureFeedRows, unreadCount } from './notification-center.js';
import {
  emailTransport,
  respondUrlFor,
  type EmailNotification,
  type EmailSendOptions,
  type ScheduleNotificationPlan,
} from './notifications.js';
import { pushTransport, type PushTicketResult } from './expo-push.js';
import { activeDeviceTokens } from './device-registrations.js';
import { deliveryLinkToken } from './assignment-tokens.js';
import { excerpt } from '../model/collaboration.model.js';

/**
 * Called by the dispatcher immediately before contacting a provider. Returns
 * false when the worker lost its lease, in which case nothing is sent.
 */
export type BeginProviderCall = () => Promise<boolean>;

interface DispatchPlan {
  id: string;
  organization_id: string;
  title: string;
  service_date: string;
  location: string | null;
}

interface RecipientAssignment {
  id: string;
  plan_id: string;
  person_id: string;
  status: 'unconfirmed' | 'confirmed' | 'declined';
  visibility: 'prepared' | 'released';
  response_owner_id: string | null;
  team: { name: string } | null;
  position: { name: string } | null;
}

const mapEffect = (row: DeliveryEffectRow): DeliveryEffect => ({
  id: row.id,
  organizationId: row.organization_id,
  template: row.template,
  planId: row.plan_id,
  assignmentIds: row.assignment_ids,
  responderId: row.responder_id,
  responderPersonId: row.responder_person_id,
  responseStatus: row.response_status,
  responseTransition: row.response_transition,
  availabilityRequestId: row.availability_request_id ?? null,
  releaseBatchId: row.release_batch_id ?? null,
  reminderJobId: row.reminder_job_id ?? null,
  commentId: row.comment_id ?? null,
  operationalMessageId: row.operational_message_id ?? null,
  conversationMessageId: row.conversation_message_id ?? null,
  createdBy: row.created_by,
});

const finished = (status: DispatchResult['status'], errorCode?: DeliveryErrorCode): DispatchResult => ({
  status,
  ...(errorCode ? { errorCode } : {}),
});

/** Exponential backoff, at least what the provider asked for, at most an hour. */
export const retryDelaySeconds = (attempts: number, providerHint?: number): number =>
  Math.max(providerHint ?? 0, Math.min(30 * 2 ** Math.max(attempts - 1, 0), 60 * 60));

/** Turns a provider failure into the outcome the worker records. */
export const resultFromError = (error: unknown, attempts: number, providerCalled: boolean): DispatchResult => {
  if (error instanceof DeliveryError) {
    if (error.disposition === 'ambiguous') return finished('ambiguous', error.code);
    if (error.disposition === 'fail') return finished('failed', error.code);
    return { status: 'queued', errorCode: error.code, retryAfterSeconds: retryDelaySeconds(attempts, error.retryAfterSeconds) };
  }
  // Unexpected: before the provider call it is safe to try again; after it,
  // we cannot know whether the message went out.
  return providerCalled
    ? finished('ambiguous', 'internal_error')
    : { status: 'queued', errorCode: 'internal_error', retryAfterSeconds: retryDelaySeconds(attempts) };
};

/**
 * One recipient's push outcome across all their devices. Any accepted ticket
 * counts as accepted; devices Expo no longer knows are reported for cleanup.
 */
export const pushOutcome = (
  mode: PushTransportMode,
  tickets: readonly PushTicketResult[],
  attempts: number,
): { result: DispatchResult; invalidTokens: string[] } => {
  const invalidTokens = tickets.filter((t) => t.error === 'DeviceNotRegistered').map((t) => t.token);
  if (mode === 'simulated') return { result: finished('simulated'), invalidTokens };
  const accepted = tickets.find((t) => t.accepted);
  if (accepted) {
    return { result: { status: 'provider_accepted', providerMessageId: accepted.ticketId }, invalidTokens };
  }
  if (tickets.length > 0 && invalidTokens.length === tickets.length) {
    return { result: finished('skipped', 'no_active_device'), invalidTokens };
  }
  if (tickets.some((t) => t.error === 'MessageRateExceeded')) {
    return {
      result: { status: 'queued', errorCode: 'provider_rate_limited', retryAfterSeconds: retryDelaySeconds(attempts, 60) },
      invalidTokens,
    };
  }
  return { result: finished('failed', 'provider_rejected'), invalidTokens };
};

export const emailOutcome = (mode: EmailTransportMode, providerMessageId: string | null): DispatchResult =>
  mode === 'simulated'
    ? finished('simulated')
    : { status: 'provider_accepted', providerMessageId };

const loadEffect = async (effectId: string): Promise<DeliveryEffect | null> => {
  const row = await unwrap(adminDb.from('delivery_effects').select('*').eq('id', effectId).maybeSingle());
  return row ? mapEffect(row) : null;
};

const loadPlan = async (planId: string | null): Promise<DispatchPlan | null> => {
  if (!planId) return null;
  return unwrap(
    adminDb.from('plans').select('id, organization_id, title, service_date, location').eq('id', planId).maybeSingle(),
  );
};

const loadPlans = async (planIds: readonly string[]): Promise<Map<string, DispatchPlan>> => {
  if (planIds.length === 0) return new Map();
  const rows = await unwrap(
    adminDb.from('plans').select('id, organization_id, title, service_date, location').in('id', [...planIds]),
  );
  return new Map((rows ?? []).map((row) => [row.id, row]));
};

/** F08: a materialized reminder still matches current state (answers, times, policy, membership). */
const reminderStillCurrent = async (jobId: string): Promise<boolean> =>
  (await unwrap(adminDb.rpc('reminder_job_is_current', { p_job: jobId }))) === true;

const isEligiblePerson = async (orgId: string, personId: string): Promise<boolean> => {
  const person = await unwrap(
    adminDb.from('people').select('profile_id, archived_at').eq('id', personId).eq('organization_id', orgId).maybeSingle(),
  );
  // An archived Person (F02) receives no new requests or reminders.
  if (!person || person.archived_at) return false;
  if (!person.profile_id) return true;
  const membership = await unwrap(
    adminDb.from('organization_members').select('user_id').eq('organization_id', orgId)
      .eq('user_id', person.profile_id).eq('status', 'active').maybeSingle(),
  );
  return Boolean(membership);
};

/**
 * A response update goes only to someone who still schedules at least one of
 * the answered positions (F01 scope, not just a role), so a revoked leader or
 * a reassigned owner no longer receives it.
 */
const stillSchedulesAny = async (userId: string, assignmentIds: readonly string[]): Promise<boolean> => {
  for (const assignmentId of assignmentIds) {
    if (await unwrap(adminDb.rpc('user_can_schedule_assignment', { p_user: userId, p_assignment: assignmentId }))) {
      return true;
    }
  }
  return false;
};

/**
 * The recipient's positions this effect is still about, re-read at dispatch.
 * A consolidated release (F08) spans several plans, so the plan filter only
 * applies to single-plan effects.
 */
const eligibleAssignments = async (effect: DeliveryEffect, personId: string): Promise<RecipientAssignment[]> => {
  if (effect.assignmentIds.length === 0) return [];
  let query = raw(adminDb)
    .from('assignments')
    .select('id, plan_id, person_id, status, visibility, response_owner_id, team:teams(name), position:team_positions(name)')
    .in('id', effect.assignmentIds)
    .eq('person_id', personId)
    .eq('visibility', 'released');
  if (effect.planId) query = query.eq('plan_id', effect.planId);
  const rows = (await unwrap(query)) as unknown as RecipientAssignment[];
  // A pending reminder is only for positions still waiting for an answer; a
  // service reminder only for confirmed ones; a request is never sent for a
  // position the person has already declined. Prepared positions are never
  // sent (filtered above as well as at enqueue).
  return rows.filter((row) => {
    if (effect.template === 'assignment_reminder') return row.status === 'unconfirmed';
    if (effect.template === 'service_reminder') return row.status === 'confirmed';
    return row.status !== 'declined';
  });
};

const roleLabel = (row: RecipientAssignment): string =>
  [row.team?.name, row.position?.name].filter(Boolean).join(' · ');

const requestDrafts = (
  effect: DeliveryEffect,
  plans: ReadonlyMap<string, DispatchPlan>,
  recipientId: string,
  rows: readonly RecipientAssignment[],
): Array<NotificationDraft & { dedupeKey: string }> => {
  const type: NotificationType = effect.template === 'assignment_request' ? 'assignment_scheduled' : 'assignment_reminder';
  return rows.flatMap((row) => {
    const plan = plans.get(row.plan_id);
    if (!plan) return [];
    const title = effect.template === 'service_reminder'
      ? `Coming up: ${plan.title}`
      : type === 'assignment_reminder' ? `Reminder: ${plan.title}` : `You're scheduled for ${plan.title}`;
    return [{
      organizationId: plan.organization_id,
      userId: recipientId,
      type,
      title,
      body: [roleLabel(row), formatDate(plan.service_date)].filter(Boolean).join(' — '),
      planId: plan.id,
      assignmentId: row.id,
      createdBy: effect.createdBy,
      dedupeKey: `${effect.id}:${row.id}`,
    }];
  });
};

const responseVerb = (effect: DeliveryEffect): string =>
  effect.responseTransition === 'withdrawal'
    ? 'withdrew from'
    : effect.responseStatus === 'confirmed'
      ? 'confirmed'
      : 'declined';

const responseDrafts = async (
  effect: DeliveryEffect,
  plan: DispatchPlan,
  recipientId: string,
): Promise<Array<NotificationDraft & { dedupeKey: string }>> => {
  const [profile, person] = await Promise.all([
    effect.responderId
      ? unwrap(adminDb.from('profiles').select('full_name').eq('id', effect.responderId).maybeSingle())
      : Promise.resolve(null),
    effect.responderPersonId
      ? unwrap(adminDb.from('people').select('first_name, last_name').eq('id', effect.responderPersonId).maybeSingle())
      : Promise.resolve(null),
  ]);
  const responderName = profile?.full_name
    ?? [person?.first_name, person?.last_name].filter(Boolean).join(' ')
    ?? 'Someone';
  return [
    {
      organizationId: plan.organization_id,
      userId: recipientId,
      type: 'assignment_response',
      // No decline reason here: the feed and push never carry it.
      title: `${responderName || 'Someone'} ${responseVerb(effect)} ${plan.title}`,
      body: formatDate(plan.service_date),
      planId: plan.id,
      assignmentId: effect.assignmentIds[0] ?? null,
      createdBy: effect.responderId,
      dedupeKey: `${effect.id}:${recipientId}`,
    },
  ];
};

const sendPush = async (
  job: DeliveryJob,
  drafts: ReadonlyArray<NotificationDraft & { dedupeKey: string }>,
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  const rows = await ensureFeedRows(drafts);
  const newest = rows[0];
  if (!newest) return finished('skipped', 'recipient_not_eligible');

  const devices = await activeDeviceTokens(adminDb, [job.recipientId]);
  if (devices.length === 0) return finished('skipped', 'no_active_device');

  const badge = await unreadCount(job.recipientId);
  // One push per recipient per action, however many positions it covers.
  const messages: PushMessage[] = devices.map((device) => toPushMessage(newest, device.token, badge));
  const transport = pushTransport();
  if (!(await begin())) return null;
  const tickets = await transport.send(messages);
  const { result, invalidTokens } = pushOutcome(transport.mode, tickets, job.attempts);
  if (invalidTokens.length) {
    // The app was uninstalled or the token was rotated; keep the table clean.
    await unwrap(adminDb.from('device_push_tokens').delete().in('token', invalidTokens));
  }
  return result;
};

const sendEmail = async (
  notification: EmailNotification,
  begin: BeginProviderCall,
  options: EmailSendOptions = {},
): Promise<DispatchResult | null> => {
  const transport = emailTransport();
  if (!(await begin())) return null;
  const receipt = await transport.send(notification, options);
  return emailOutcome(transport.mode, receipt.providerMessageId);
};

const recipientEmail = async (
  orgId: string,
  personId: string,
  profileId: string | null,
): Promise<{ email: string | null; name: string | null }> => {
  const [profile, person] = await Promise.all([
    profileId
      ? unwrap(adminDb.from('profiles').select('full_name, email').eq('id', profileId).maybeSingle())
      : Promise.resolve(null),
    unwrap(adminDb.from('people').select('first_name, last_name, email').eq('id', personId)
      .eq('organization_id', orgId).maybeSingle()),
  ]);
  return {
    email: profile?.email ?? person?.email ?? null,
    name: profile?.full_name
      ?? ([person?.first_name, person?.last_name].filter(Boolean).join(' ') || null),
  };
};

const byServiceDate = (plans: ReadonlyMap<string, DispatchPlan>) => (a: string, b: string): number =>
  (plans.get(a)?.service_date ?? '').localeCompare(plans.get(b)?.service_date ?? '') || a.localeCompare(b);

/**
 * The request (or pending-reminder) email: one message per Person per
 * effect, with one respond link per plan. Each link is issued for that
 * plan's exact snapshot (F08), so answering one plan never answers another.
 * Issuing keeps the last provider-accepted link usable until this email is
 * itself accepted. The calendar file covers every plan's applicable times.
 */
const requestEmail = async (
  effect: DeliveryEffect,
  plans: ReadonlyMap<string, DispatchPlan>,
  job: DeliveryJob,
  rows: readonly RecipientAssignment[],
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  const { email, name } = await recipientEmail(effect.organizationId, job.recipientPersonId, job.recipientId);
  if (!email) return finished('skipped', 'no_email_address');

  const planIds = [...new Set(rows.map((row) => row.plan_id))].filter((id) => plans.has(id)).sort(byServiceDate(plans));
  const snapshots = await unwrap(
    adminDb.from('assignment_request_snapshots').select('*')
      .eq('effect_id', effect.id).eq('person_id', job.recipientPersonId).in('plan_id', planIds),
  );
  const snapshotByPlan = new Map((snapshots ?? []).map((snapshot) => [snapshot.plan_id, snapshot]));
  const linkedPlanIds = planIds.filter((id) => snapshotByPlan.has(id));
  if (linkedPlanIds.length === 0) return finished('cancelled', 'recipient_not_eligible');

  const snapshotItems = await unwrap(
    adminDb.from('assignment_request_snapshot_items').select('plan_time_ids')
      .in('snapshot_id', linkedPlanIds.map((id) => snapshotByPlan.get(id)?.id ?? '')),
  );
  const timeIds = [...new Set((snapshotItems ?? []).flatMap((item) => item.plan_time_ids))];
  // Replies go to whoever owns these answers, falling back to the sender.
  const replyTo = rows.find((row) => row.response_owner_id)?.response_owner_id ?? effect.createdBy;
  const [organization, scheduler, times, states] = await Promise.all([
    unwrap(adminDb.from('organizations').select('name').eq('id', effect.organizationId).maybeSingle()),
    replyTo
      ? unwrap(adminDb.from('profiles').select('email').eq('id', replyTo).maybeSingle())
      : Promise.resolve(null),
    timeIds.length
      ? unwrap(adminDb.from('plan_times').select('id, plan_id, kind, name, starts_at, ends_at, ics_sequence').in('id', timeIds))
      : Promise.resolve([]),
    timeIds.length
      ? unwrap(adminDb.from('attendance_calendar_states').select('plan_time_id, sequence_offset')
          .eq('person_id', job.recipientPersonId).in('plan_time_id', timeIds))
      : Promise.resolve([]),
  ]);
  // F04: same UID as the feed; the SEQUENCE includes this recipient's offset.
  const offsets = new Map((states ?? []).map((state) => [state.plan_time_id, state.sequence_offset]));
  const host = new URL(config.API_URL).host;
  const events: IcsEvent[] = (times ?? []).map((time) => {
    const title = plans.get(time.plan_id)?.title ?? '';
    return {
      uid: `plan-time-${time.id}@${host}`,
      summary: time.name ? `${title} · ${time.name}` : title,
      startsAt: time.starts_at,
      endsAt: time.ends_at,
      sequence: recipientSequence(time.ics_sequence, offsets.get(time.id)),
      location: plans.get(time.plan_id)?.location ?? null,
    };
  });

  // The raw token exists only in this email. With DELIVERY_LINK_SECRET it is
  // the same on every attempt of this delivery, so the provider can dedupe.
  let deterministic = true;
  const sections: ScheduleNotificationPlan[] = [];
  for (const planId of linkedPlanIds) {
    const plan = plans.get(planId);
    const snapshot = snapshotByPlan.get(planId);
    if (!plan || !snapshot) continue;
    const token = deliveryLinkToken(job.id, plan.id, plan.service_date);
    deterministic &&= token.deterministic;
    await unwrap(adminDb.rpc('issue_assignment_link', {
      p_delivery: job.id,
      p_snapshot: snapshot.id,
      p_token_hash: token.tokenHash,
      p_expires_at: token.expiresAt.toISOString(),
      p_email: email,
    }));
    sections.push({
      planTitle: plan.title,
      serviceDate: plan.service_date,
      assignments: rows.filter((row) => row.plan_id === planId)
        .map((row) => ({ teamName: row.team?.name ?? null, positionName: row.position?.name ?? null })),
      respondUrl: respondUrlFor(token.token),
    });
  }
  const first = sections[0];
  if (!first) return finished('cancelled', 'recipient_not_eligible');

  return sendEmail(
    {
      to: email,
      personName: name,
      planTitle: first.planTitle,
      serviceDate: first.serviceDate,
      teamName: first.assignments[0]?.teamName ?? null,
      positionName: first.assignments[0]?.positionName ?? null,
      assignments: first.assignments,
      respondUrl: first.respondUrl,
      ...(sections.length > 1 ? { plans: sections } : {}),
      reminder: effect.template === 'assignment_reminder',
      schedulerEmail: scheduler?.email ?? null,
      organizationName: organization?.name,
      ics: renderIcs(events, { calendarName: sections.length > 1 ? 'Service requests' : first.planTitle, productId: `-//${host}//Service Center//EN` }),
    },
    begin,
    deterministic ? { idempotencyKey: `delivery-${job.id}` } : {},
  );
};

/** "Sun, Oct 25, 9:00 AM" in the organization's zone. */
const formatInZone = (instant: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
  }).format(new Date(instant));

/** F08: confirmed-service reminder email. No respond link: nothing to answer. */
const serviceReminderEmail = async (
  effect: DeliveryEffect,
  plans: ReadonlyMap<string, DispatchPlan>,
  job: DeliveryJob,
  rows: readonly RecipientAssignment[],
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  const plan = effect.planId ? plans.get(effect.planId) : undefined;
  if (!plan) return finished('cancelled', 'plan_missing');
  const { email, name } = await recipientEmail(effect.organizationId, job.recipientPersonId, job.recipientId);
  if (!email) return finished('skipped', 'no_email_address');
  const [organization, reminder] = await Promise.all([
    unwrap(adminDb.from('organizations').select('name, timezone').eq('id', effect.organizationId).maybeSingle()),
    effect.reminderJobId
      ? unwrap(adminDb.from('reminder_jobs').select('occurrence_starts_at, timezone').eq('id', effect.reminderJobId).maybeSingle())
      : Promise.resolve(null),
  ]);
  return sendEmail(
    {
      to: email,
      personName: name,
      organizationName: organization?.name ?? 'Service Center',
      planTitle: plan.title,
      serviceDate: plan.service_date,
      firstTimeAt: reminder?.occurrence_starts_at ?? null,
      firstTimeLabel: reminder ? formatInZone(reminder.occurrence_starts_at, reminder.timezone) : null,
      location: plan.location,
      assignments: rows.map((row) => ({ teamName: row.team?.name ?? null, positionName: row.position?.name ?? null })),
      planUrl: `${config.APP_URL}/plans/${plan.id}`,
    },
    begin,
    { idempotencyKey: `delivery-${job.id}` },
  );
};

const responseEmail = async (
  effect: DeliveryEffect,
  plan: DispatchPlan,
  job: DeliveryJob,
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  if (!job.recipientId) return finished('cancelled', 'scheduler_not_active');
  const scheduler = await unwrap(adminDb.from('profiles').select('email').eq('id', job.recipientId).maybeSingle());
  if (!scheduler?.email) return finished('skipped', 'no_email_address');
  return sendEmail(
    {
      to: scheduler.email,
      personName: null,
      planTitle: `${plan.title} — ${effect.responseTransition === 'withdrawal' ? 'confirmation withdrawn' : 'assignment declined'}`,
      serviceDate: plan.service_date,
      teamName: null,
      positionName: null,
      respondUrl: `${config.APP_URL}/plans/${plan.id}`,
    },
    begin,
  );
};

/**
 * F03 availability request. Re-checked at send time: the request still
 * exists, the recipient is still an eligible member and still on the team,
 * and has not already reviewed their availability since it was sent.
 */
const dispatchAvailabilityRequest = async (
  effect: DeliveryEffect,
  job: DeliveryJob,
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  if (!effect.availabilityRequestId) return finished('cancelled', 'request_missing');
  const request = await unwrap(
    adminDb.from('availability_requests').select('*').eq('id', effect.availabilityRequestId).maybeSingle(),
  );
  if (!request) return finished('cancelled', 'request_missing');
  if (!(await isEligiblePerson(request.organization_id, job.recipientPersonId))) {
    return finished('cancelled', 'recipient_not_eligible');
  }
  if (request.team_id) {
    const onTeam = await unwrap(
      adminDb.from('team_memberships').select('id').eq('team_id', request.team_id)
        .eq('person_id', job.recipientPersonId).limit(1),
    );
    if (!onTeam?.length) return finished('cancelled', 'recipient_not_eligible');
  }
  const recipient = await unwrap(
    adminDb.from('availability_request_recipients').select('responded_at')
      .eq('request_id', request.id).eq('person_id', job.recipientPersonId).maybeSingle(),
  );
  if (!recipient) return finished('cancelled', 'recipient_not_eligible');
  if (recipient.responded_at) return finished('cancelled', 'already_reviewed');

  const organization = await unwrap(
    adminDb.from('organizations').select('name').eq('id', request.organization_id).maybeSingle(),
  );
  const organizationName = organization?.name ?? 'Your organization';
  const availabilityUrl = `${config.APP_URL}/settings#availability`;

  if (job.channel === 'email') {
    const { email, name } = await recipientEmail(request.organization_id, job.recipientPersonId, job.recipientId);
    if (!email) return finished('skipped', 'no_email_address');
    const sender = request.created_by
      ? await unwrap(adminDb.from('profiles').select('email').eq('id', request.created_by).maybeSingle())
      : null;
    return sendEmail({
      to: email,
      personName: name,
      organizationName,
      message: request.message,
      windowStart: request.window_start,
      windowEnd: request.window_end,
      respondBy: request.respond_by,
      availabilityUrl,
      replyTo: sender?.email ?? null,
    }, begin);
  }
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  const drafts: Array<NotificationDraft & { dedupeKey: string }> = [{
    organizationId: request.organization_id,
    userId: job.recipientId,
    type: 'availability_request',
    title: 'Please update your availability',
    body: `${request.window_start} to ${request.window_end}${request.respond_by ? ` · respond by ${request.respond_by}` : ''}`,
    planId: null,
    assignmentId: null,
    createdBy: effect.createdBy,
    dedupeKey: `${effect.id}:${job.recipientPersonId}`,
  }];
  if (job.channel === 'in_app') {
    await ensureFeedRows(drafts);
    return finished('delivered');
  }
  return sendPush(job, drafts, begin);
};

type FeedDraft = NotificationDraft & { dedupeKey: string };

/** Feed row for in-app; feed row + generic push for push; nothing else. */
const deliverFeedOrPush = async (job: DeliveryJob, drafts: readonly FeedDraft[], begin: BeginProviderCall): Promise<DispatchResult | null> => {
  if (job.channel === 'email') return finished('skipped', 'channel_not_used');
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  if (job.channel === 'in_app') {
    await ensureFeedRows(drafts);
    return finished('delivered');
  }
  return sendPush(job, drafts, begin);
};

const authorName = async (orgId: string, personId: string | null, profileId: string | null): Promise<string> => {
  const [person, profile] = await Promise.all([
    personId
      ? unwrap(adminDb.from('people').select('first_name, last_name').eq('id', personId).eq('organization_id', orgId).maybeSingle())
      : Promise.resolve(null),
    !personId && profileId
      ? unwrap(adminDb.from('profiles').select('full_name').eq('id', profileId).maybeSingle())
      : Promise.resolve(null),
  ]);
  return [person?.first_name, person?.last_name].filter(Boolean).join(' ') || profile?.full_name || 'Someone';
};

/**
 * F09 item discussion. Rechecked at send time: the comment still exists and
 * is not deleted, and the recipient can still read the plan's thread (a
 * mention never granted access). The feed row carries a short excerpt; the
 * push stays generic like every other push.
 */
const dispatchItemComment = async (effect: DeliveryEffect, job: DeliveryJob, begin: BeginProviderCall): Promise<DispatchResult | null> => {
  if (!effect.commentId) return finished('cancelled', 'content_removed');
  const comment = await unwrap(adminDb.from('plan_item_comments').select('*').eq('id', effect.commentId).maybeSingle());
  if (!comment || comment.deleted_at) return finished('cancelled', 'content_removed');
  if (!job.recipientId || !(await isEligiblePerson(comment.organization_id, job.recipientPersonId))
      || !(await unwrap(adminDb.rpc('user_can_read_item_thread', { p_user: job.recipientId, p_plan: comment.plan_id })))) {
    return finished('cancelled', 'recipient_not_eligible');
  }
  const [item, mention, author] = await Promise.all([
    unwrap(adminDb.from('plan_items').select('title').eq('id', comment.plan_item_id).maybeSingle()),
    unwrap(adminDb.from('plan_item_comment_mentions').select('person_id').eq('comment_id', comment.id)
      .eq('person_id', job.recipientPersonId).maybeSingle()),
    authorName(comment.organization_id, comment.author_person_id, comment.author_id),
  ]);
  const itemTitle = item?.title ?? 'an item';
  return deliverFeedOrPush(job, [{
    organizationId: comment.organization_id,
    userId: job.recipientId,
    type: mention ? 'comment_mention' : 'comment_reply',
    title: mention ? `${author} mentioned you on “${itemTitle}”` : `${author} commented on “${itemTitle}”`,
    body: excerpt(comment.body),
    planId: comment.plan_id,
    planItemId: comment.plan_item_id,
    createdBy: comment.author_id,
    dedupeKey: `${effect.id}:${job.recipientPersonId}`,
  }], begin);
};

/**
 * F09 targeted message. The recipient must still be an active member and
 * still in the audience for a recorded reason; the text is rendered from
 * the values captured at send time, so every retry sends the same content.
 */
const dispatchOperationalMessage = async (effect: DeliveryEffect, job: DeliveryJob, begin: BeginProviderCall): Promise<DispatchResult | null> => {
  if (!effect.operationalMessageId) return finished('cancelled', 'request_missing');
  const [message, recipient] = await Promise.all([
    unwrap(adminDb.from('operational_messages').select('*').eq('id', effect.operationalMessageId).maybeSingle()),
    unwrap(adminDb.from('operational_message_recipients').select('*').eq('message_id', effect.operationalMessageId)
      .eq('person_id', job.recipientPersonId).maybeSingle()),
  ]);
  if (!message || !recipient) return finished('cancelled', 'request_missing');
  if (!(await unwrap(adminDb.rpc('operational_message_recipient_current', { p_message: message.id, p_person: job.recipientPersonId })))) {
    return finished('cancelled', 'recipient_not_eligible');
  }
  const snapshot = message.variables as MessageVariableSnapshot;
  const values = messageVariableValues(recipient, snapshot);
  const subject = renderMessageTemplate(message.subject, values);
  const body = renderMessageTemplate(message.body, values);
  const messageUrl = `${config.APP_URL}/messages/${message.id}`;

  if (job.channel === 'email') {
    const { email, name } = await recipientEmail(message.organization_id, job.recipientPersonId, job.recipientId);
    if (!email) return finished('skipped', 'no_email_address');
    const sender = await unwrap(adminDb.from('profiles').select('email').eq('id', message.created_by).maybeSingle());
    return sendEmail({
      to: email,
      personName: name,
      organizationName: snapshot.organization_name ?? 'Service Center',
      subject,
      body,
      senderName: snapshot.sender_name ?? null,
      messageUrl,
      replyTo: sender?.email ?? null,
    }, begin, { idempotencyKey: `delivery-${job.id}` });
  }
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  return deliverFeedOrPush(job, [{
    organizationId: message.organization_id,
    userId: job.recipientId,
    type: 'operational_message',
    title: excerpt(subject, 200),
    body: excerpt(body, 280),
    planId: message.plan_id,
    operationalMessageId: message.id,
    createdBy: message.created_by,
    dedupeKey: `${effect.id}:${job.recipientPersonId}`,
  }], begin);
};

/**
 * F09 conversation mention/reply. Rechecked at send time: the message is
 * still visible, the recipient is still a participant (team/plan state,
 * youth gate) and has not muted the conversation since.
 */
const dispatchConversationMessage = async (effect: DeliveryEffect, job: DeliveryJob, begin: BeginProviderCall): Promise<DispatchResult | null> => {
  if (!effect.conversationMessageId) return finished('cancelled', 'content_removed');
  const message = await unwrap(adminDb.from('conversation_messages').select('*').eq('id', effect.conversationMessageId).maybeSingle());
  if (!message || message.deleted_at || message.hidden_at) return finished('cancelled', 'content_removed');
  if (!job.recipientId || !(await isEligiblePerson(message.organization_id, job.recipientPersonId))
      || !(await unwrap(adminDb.rpc('user_can_access_conversation', { p_user: job.recipientId, p_conversation: message.conversation_id })))) {
    return finished('cancelled', 'recipient_not_eligible');
  }
  const [state, conversation, mention, author] = await Promise.all([
    unwrap(adminDb.from('conversation_member_states').select('muted').eq('conversation_id', message.conversation_id)
      .eq('user_id', job.recipientId).maybeSingle()),
    unwrap(adminDb.from('conversations').select('kind, team_id, plan_id').eq('id', message.conversation_id).maybeSingle()),
    unwrap(adminDb.from('conversation_message_mentions').select('person_id').eq('message_id', message.id)
      .eq('person_id', job.recipientPersonId).maybeSingle()),
    authorName(message.organization_id, message.author_person_id, message.author_id),
  ]);
  if (state?.muted) return finished('cancelled', 'conversation_muted');
  const place = conversation?.team_id
    ? (await unwrap(adminDb.from('teams').select('name').eq('id', conversation.team_id).maybeSingle()))?.name
    : conversation?.plan_id
      ? (await unwrap(adminDb.from('plans').select('title').eq('id', conversation.plan_id).maybeSingle()))?.title
      : null;
  const where = place ? `${place} chat` : 'a conversation';
  return deliverFeedOrPush(job, [{
    organizationId: message.organization_id,
    userId: job.recipientId,
    type: mention ? 'conversation_mention' : 'conversation_reply',
    title: mention ? `${author} mentioned you in ${where}` : `${author} replied to you in ${where}`,
    body: excerpt(message.body),
    planId: conversation?.plan_id ?? null,
    conversationId: message.conversation_id,
    createdBy: message.author_id,
    dedupeKey: `${effect.id}:${job.recipientPersonId}`,
  }], begin);
};

/**
 * Performs one leased delivery. Everything is re-read here rather than
 * trusted from enqueue time: the plan may be gone, the person removed from
 * it or from the organization, or the response owner may no longer schedule
 * those positions.
 * Returns null when the lease was lost before the provider call.
 */
export const dispatchDelivery = async (job: DeliveryJob, begin: BeginProviderCall): Promise<DispatchResult | null> => {
  const effect = await loadEffect(job.effectId);
  if (!effect) return finished('cancelled', 'plan_missing');
  if (effect.template === 'availability_request') return dispatchAvailabilityRequest(effect, job, begin);
  if (effect.template === 'item_comment') return dispatchItemComment(effect, job, begin);
  if (effect.template === 'operational_message') return dispatchOperationalMessage(effect, job, begin);
  if (effect.template === 'conversation_message') return dispatchConversationMessage(effect, job, begin);
  // F08: a reminder whose intent changed after it was enqueued (answer,
  // removal, archive, time/policy change, membership) is not sent.
  if (effect.reminderJobId && !(await reminderStillCurrent(effect.reminderJobId))) {
    return finished('cancelled', 'reminder_obsolete');
  }

  const member = await isEligiblePerson(effect.organizationId, job.recipientPersonId);

  if (effect.template === 'scheduler_response') {
    const plan = await loadPlan(effect.planId);
    if (!plan) return finished('cancelled', 'plan_missing');
    if (!job.recipientId || !member || !(await stillSchedulesAny(job.recipientId, effect.assignmentIds))) {
      return finished('cancelled', 'scheduler_not_active');
    }
    if (job.channel === 'email') return responseEmail(effect, plan, job, begin);
    const drafts = await responseDrafts(effect, plan, job.recipientId);
    if (job.channel === 'in_app') {
      await ensureFeedRows(drafts);
      return finished('delivered');
    }
    return sendPush(job, drafts, begin);
  }

  if (!member) return finished('cancelled', 'recipient_not_eligible');
  const rows = await eligibleAssignments(effect, job.recipientPersonId);
  if (rows.length === 0) return finished('cancelled', 'recipient_not_eligible');
  const plans = await loadPlans([...new Set(rows.map((row) => row.plan_id))]);
  if (plans.size === 0) return finished('cancelled', 'plan_missing');

  if (job.channel === 'email') {
    return effect.template === 'service_reminder'
      ? serviceReminderEmail(effect, plans, job, rows, begin)
      : requestEmail(effect, plans, job, rows, begin);
  }
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  const drafts = requestDrafts(effect, plans, job.recipientId, rows);
  if (job.channel === 'in_app') {
    await ensureFeedRows(drafts);
    return finished('delivered');
  }
  return sendPush(job, drafts, begin);
};
