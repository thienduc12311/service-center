import {
  canEditReminderScope,
  isAdmin,
  isRetryableDelivery,
  type DeliveryRow,
  type DeliveryTemplate,
  type EffectiveAccess,
  type EffectiveReminderPolicy,
  type OrgRole,
  type PlanDeliveryHistory,
  type PlanDeliveryHistoryItem,
  type ReminderJobRow,
  type ReminderPolicyRow,
  type ReminderPolicyScopeQuery,
  type ReminderPolicyScopeView,
  type ReminderPreferences,
  type UpdateReminderPreferencesInput,
  type UpsertReminderPolicyInput,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, unwrapOne, type Db } from '../lib/supabase.js';
import { personDisplayName, toPlanReminderJob } from '../model/reminder.model.js';

/** The caller's identity and access, as the routes know it. */
export interface ReminderCaller {
  db: Db;
  orgId: string;
  userId: string;
  orgRole: OrgRole;
  access: EffectiveAccess;
}

const scopeFilter = <Q extends { is: (column: string, value: null) => Q; eq: (column: string, value: string) => Q }>(
  query: Q,
  serviceTypeId: string | null,
  teamId: string | null,
): Q => {
  const withServiceType = serviceTypeId ? query.eq('service_type_id', serviceTypeId) : query.is('service_type_id', null);
  return teamId ? withServiceType.eq('team_id', teamId) : withServiceType.is('team_id', null);
};

/** Effective policies (with their source) plus what is set at exactly this scope. */
export const reminderPolicyScopeView = async (
  caller: ReminderCaller,
  scope: ReminderPolicyScopeQuery,
): Promise<ReminderPolicyScopeView> => {
  const serviceTypeId = scope.service_type_id ?? null;
  const teamId = scope.team_id ?? null;
  const [effective, explicit] = await Promise.all([
    unwrap(caller.db.rpc('effective_reminder_policies', {
      p_org: caller.orgId, p_service_type: serviceTypeId, p_team: teamId,
    })),
    unwrap(scopeFilter(caller.db.from('reminder_policies').select('*').eq('organization_id', caller.orgId), serviceTypeId, teamId)),
  ]);
  return {
    service_type_id: serviceTypeId,
    team_id: teamId,
    effective: (effective ?? []) as EffectiveReminderPolicy[],
    explicit: (explicit ?? []) as ReminderPolicyRow[],
    can_edit: canEditReminderScope(caller.access, isAdmin(caller.orgRole), { serviceTypeId, teamId }),
  };
};

/**
 * Creates or updates the policy for one kind at one scope. RLS decides who
 * may write which scope; `expected_revision` refuses a lost update.
 */
export const saveReminderPolicy = async (
  caller: ReminderCaller,
  input: UpsertReminderPolicyInput,
): Promise<ReminderPolicyRow> => {
  const serviceTypeId = input.service_type_id ?? null;
  const teamId = input.team_id ?? null;
  const values = {
    enabled: input.enabled,
    offset_minutes: input.offset_minutes,
    channels: input.channels,
    quiet_start: input.quiet_start,
    quiet_end: input.quiet_end,
    max_per_day: input.max_per_day,
  };
  const existing = await unwrap(
    scopeFilter(
      caller.db.from('reminder_policies').select('id, revision').eq('organization_id', caller.orgId).eq('kind', input.kind),
      serviceTypeId,
      teamId,
    ).maybeSingle(),
  );
  if (existing) {
    if (input.expected_revision !== undefined && input.expected_revision !== existing.revision) {
      throw new HttpError(409, 'This reminder policy changed. Reload it and try again.', 'reminder_policy_stale');
    }
    const updated = await unwrap(
      caller.db.from('reminder_policies').update(values).eq('id', existing.id).eq('revision', existing.revision)
        .select('*').maybeSingle(),
    );
    if (!updated) throw new HttpError(409, 'This reminder policy changed. Reload it and try again.', 'reminder_policy_stale');
    return updated;
  }
  return unwrapOne(
    caller.db.from('reminder_policies').insert({
      ...values,
      organization_id: caller.orgId,
      service_type_id: serviceTypeId,
      team_id: teamId,
      kind: input.kind,
    }).select('*').single(),
  );
};

/** Removes an override; the scope inherits again. */
export const deleteReminderPolicy = async (caller: ReminderCaller, policyId: string): Promise<void> => {
  const deleted = await unwrap(
    caller.db.from('reminder_policies').delete().eq('id', policyId).eq('organization_id', caller.orgId).select('id'),
  );
  if (!deleted?.length) throw HttpError.notFound('Reminder policy not found');
};

const ownPersonId = async (caller: ReminderCaller): Promise<string> => {
  const person = await unwrap(
    caller.db.from('people_directory').select('id').eq('organization_id', caller.orgId)
      .eq('profile_id', caller.userId).maybeSingle(),
  );
  if (!person) throw HttpError.notFound('You are not on this organization’s roster');
  return person.id;
};

export const myReminderPreferences = async (caller: ReminderCaller): Promise<ReminderPreferences> => {
  const personId = await ownPersonId(caller);
  const row = await unwrap(
    caller.db.from('person_reminder_preferences').select('*').eq('person_id', personId).maybeSingle(),
  );
  return { person_id: personId, email: row?.email ?? true, push: row?.push ?? true, in_app: row?.in_app ?? true };
};

export const updateMyReminderPreferences = async (
  caller: ReminderCaller,
  input: UpdateReminderPreferencesInput,
): Promise<ReminderPreferences> => {
  const personId = await ownPersonId(caller);
  const row = await unwrapOne(
    caller.db.from('person_reminder_preferences')
      .upsert({ person_id: personId, organization_id: caller.orgId, ...input }, { onConflict: 'person_id' })
      .select('*').single(),
  );
  return { person_id: personId, email: row.email, push: row.push, in_app: row.in_app };
};

type HistoryRow = DeliveryRow & {
  effect: { template: DeliveryTemplate; assignment_ids: string[] } | null;
};

/**
 * One plan's reminders (recomputed on read) and per-Person/channel delivery
 * history. Only requests the caller schedules are included (RLS); a
 * consolidated multi-plan release appears on each of its plans.
 */
export const planDeliveryHistory = async (caller: ReminderCaller, planId: string): Promise<PlanDeliveryHistory> => {
  const plan = await unwrap(
    caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const [jobs, assignments] = await Promise.all([
    unwrap(caller.db.rpc('plan_reminder_jobs', { p_plan: planId })),
    unwrap(caller.db.from('assignments').select('id, person_id').eq('plan_id', planId)),
  ]);
  const assignmentIds = (assignments ?? []).map((row) => row.id);
  const people = new Set((assignments ?? []).map((row) => row.person_id));
  const deliveries = assignmentIds.length
    ? ((await unwrap(
        raw(caller.db).from('deliveries')
          .select('*, effect:delivery_effects!inner(template, assignment_ids)')
          .overlaps('effect.assignment_ids', assignmentIds)
          .order('created_at', { ascending: false })
          .limit(200),
      )) as unknown as HistoryRow[])
    : [];
  // Response updates go to leaders; history here is about the people asked.
  const forPeople = deliveries.filter((row) => people.has(row.recipient_person_id) && row.effect?.template !== 'scheduler_response');
  const reminderRows = (jobs ?? []) as ReminderJobRow[];

  const personIds = [...new Set([...forPeople.map((row) => row.recipient_person_id), ...reminderRows.map((row) => row.person_id)])];
  const directory = personIds.length
    ? await unwrap(caller.db.from('people_directory').select('id, first_name, last_name').in('id', personIds))
    : [];
  const names = new Map((directory ?? []).map((person) => [person.id, personDisplayName(person)]));
  const canRetry = isAdmin(caller.orgRole);

  const history: PlanDeliveryHistoryItem[] = forPeople.map((row) => ({
    id: row.id,
    person_id: row.recipient_person_id,
    person_name: names.get(row.recipient_person_id) ?? 'Person',
    channel: row.channel,
    status: row.status,
    template: row.effect?.template ?? 'assignment_request',
    error_code: row.last_error_code,
    attempts: row.attempts,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    completed_at: row.completed_at,
    next_attempt_at: row.status === 'queued' ? row.next_attempt_at : null,
    retryable: isRetryableDelivery(row.status),
    can_retry: canRetry && isRetryableDelivery(row.status),
  }));
  return { reminders: reminderRows.map((row) => toPlanReminderJob(row, names)), deliveries: history };
};
