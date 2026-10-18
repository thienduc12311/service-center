import { recipientSequence } from '../model/attendance.model.js';
import {
  formatDate,
  type DeliveryEffectRow,
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
import { emailTransport, respondUrlFor, type EmailNotification } from './notifications.js';
import { pushTransport, type PushTicketResult } from './expo-push.js';
import { activeDeviceTokens } from './device-registrations.js';
import { generateAssignmentToken } from './assignment-tokens.js';

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

/** The recipient's positions this effect is still about, re-read at dispatch. */
const eligibleAssignments = async (effect: DeliveryEffect, personId: string): Promise<RecipientAssignment[]> => {
  if (effect.assignmentIds.length === 0) return [];
  const rows = (await unwrap(
    raw(adminDb)
      .from('assignments')
      .select('id, plan_id, person_id, status, visibility, response_owner_id, team:teams(name), position:team_positions(name)')
      .in('id', effect.assignmentIds)
      .eq('person_id', personId)
      .eq('plan_id', effect.planId)
      .eq('visibility', 'released'),
  )) as unknown as RecipientAssignment[];
  // A reminder is only for positions still waiting for an answer; a request
  // is never sent for a position the person has already declined. Prepared
  // positions are never sent (filtered above as well as at enqueue).
  return rows.filter((row) =>
    effect.template === 'assignment_reminder' ? row.status === 'unconfirmed' : row.status !== 'declined',
  );
};

const roleLabel = (row: RecipientAssignment): string =>
  [row.team?.name, row.position?.name].filter(Boolean).join(' · ');

const requestDrafts = (
  effect: DeliveryEffect,
  plan: DispatchPlan,
  recipientId: string,
  rows: readonly RecipientAssignment[],
): Array<NotificationDraft & { dedupeKey: string }> => {
  const type: NotificationType = effect.template === 'assignment_reminder' ? 'assignment_reminder' : 'assignment_scheduled';
  return rows.map((row) => ({
    organizationId: plan.organization_id,
    userId: recipientId,
    type,
    title: type === 'assignment_reminder' ? `Reminder: ${plan.title}` : `You're scheduled for ${plan.title}`,
    body: [roleLabel(row), formatDate(plan.service_date)].filter(Boolean).join(' — '),
    planId: plan.id,
    assignmentId: row.id,
    createdBy: effect.createdBy,
    dedupeKey: `${effect.id}:${row.id}`,
  }));
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

const sendEmail = async (notification: EmailNotification, begin: BeginProviderCall): Promise<DispatchResult | null> => {
  const transport = emailTransport();
  if (!(await begin())) return null;
  const receipt = await transport.send(notification);
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

/** The request email: a fresh respond link, the positions and the calendar file. */
const requestEmail = async (
  effect: DeliveryEffect,
  plan: DispatchPlan,
  job: DeliveryJob,
  rows: readonly RecipientAssignment[],
  begin: BeginProviderCall,
): Promise<DispatchResult | null> => {
  const { email, name } = await recipientEmail(plan.organization_id, job.recipientPersonId, job.recipientId);
  if (!email) return finished('skipped', 'no_email_address');

  // Replies go to whoever owns these answers, falling back to the sender.
  const replyTo = rows.find((row) => row.response_owner_id)?.response_owner_id ?? effect.createdBy;
  const snapshot = await unwrap(
    adminDb.from('assignment_request_snapshots').select('*')
      .eq('effect_id', effect.id).eq('person_id', job.recipientPersonId).maybeSingle(),
  );
  if (!snapshot) return finished('cancelled', 'recipient_not_eligible');
  const snapshotItems = await unwrap(
    adminDb.from('assignment_request_snapshot_items').select('plan_time_ids')
      .eq('snapshot_id', snapshot.id),
  );
  const timeIds = [...new Set((snapshotItems ?? []).flatMap((item) => item.plan_time_ids))];
  const [organization, scheduler, times, states] = await Promise.all([
    unwrap(adminDb.from('organizations').select('name').eq('id', plan.organization_id).maybeSingle()),
    replyTo
      ? unwrap(adminDb.from('profiles').select('email').eq('id', replyTo).maybeSingle())
      : Promise.resolve(null),
    timeIds.length
      ? unwrap(adminDb.from('plan_times').select('id, kind, name, starts_at, ends_at, ics_sequence').in('id', timeIds))
      : Promise.resolve([]),
    timeIds.length
      ? unwrap(adminDb.from('attendance_calendar_states').select('plan_time_id, sequence_offset')
          .eq('person_id', job.recipientPersonId).in('plan_time_id', timeIds))
      : Promise.resolve([]),
  ]);
  // F04: same UID as the feed; the SEQUENCE includes this recipient's offset.
  const offsets = new Map((states ?? []).map((state) => [state.plan_time_id, state.sequence_offset]));

  const host = new URL(config.API_URL).host;
  const events: IcsEvent[] = (times ?? []).map((time) => ({
    uid: `plan-time-${time.id}@${host}`,
    summary: time.name ? `${plan.title} · ${time.name}` : plan.title,
    startsAt: time.starts_at,
    endsAt: time.ends_at,
    sequence: recipientSequence(time.ics_sequence, offsets.get(time.id)),
    location: plan.location,
  }));

  // The raw token exists only in this email; each attempt mints a new one, so
  // a link from an earlier, uncertain attempt stops working.
  const token = generateAssignmentToken(plan.service_date);
  const live = await unwrap(
    adminDb
      .from('assignment_notifications')
      .select('id')
      .eq('plan_id', plan.id)
      .eq('person_id', job.recipientPersonId)
      .is('responded_at', null)
      .maybeSingle(),
  );
  const link = {
    token_hash: token.tokenHash,
    snapshot_id: snapshot.id,
    person_id: job.recipientPersonId,
    user_id: job.recipientId,
    email,
    expires_at: token.expiresAt.toISOString(),
    sent_at: null,
    created_by: effect.createdBy,
  };
  if (live) {
    await unwrap(adminDb.from('assignment_notifications').update(link).eq('id', live.id));
  } else {
    await unwrap(
      adminDb
        .from('assignment_notifications')
        .insert({ ...link, organization_id: plan.organization_id, plan_id: plan.id }),
    );
  }

  return sendEmail(
    {
      to: email,
      personName: name,
      planTitle: plan.title,
      serviceDate: plan.service_date,
      teamName: rows[0]?.team?.name ?? null,
      positionName: rows[0]?.position?.name ?? null,
      assignments: rows.map((row) => ({ teamName: row.team?.name ?? null, positionName: row.position?.name ?? null })),
      respondUrl: respondUrlFor(token.token),
      schedulerEmail: scheduler?.email ?? null,
      organizationName: organization?.name,
      ics: renderIcs(events, { calendarName: plan.title, productId: `-//${host}//Service Center//EN` }),
    },
    begin,
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
  const plan = await loadPlan(effect.planId);
  if (!plan) return finished('cancelled', 'plan_missing');

  const member = await isEligiblePerson(plan.organization_id, job.recipientPersonId);

  if (effect.template === 'scheduler_response') {
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

  if (job.channel === 'email') return requestEmail(effect, plan, job, rows, begin);
  if (!job.recipientId) return finished('skipped', 'no_active_device');
  const drafts = requestDrafts(effect, plan, job.recipientId, rows);
  if (job.channel === 'in_app') {
    await ensureFeedRows(drafts);
    return finished('delivered');
  }
  return sendPush(job, drafts, begin);
};
