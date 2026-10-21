import type { DeliveryChannel } from '../types/database.js';
import type { EffectiveAccess } from '../types/domain.js';
import { canAccess } from './access.js';
import type {
  EffectiveReminderPolicy,
  PlanDeliveryHistory,
  PlanDeliveryHistoryItem,
  PlanReminderJob,
  ReleaseBatchStatus,
  ReminderJobStatus,
  ReminderKind,
  ReminderPolicyRow,
  ReminderPolicySource,
} from '../types/reminders.js';
import type { UpsertReminderPolicyRequest } from '../schemas/reminders.js';

/**
 * Service Center's proposed defaults (not asserted reference-product
 * behavior): one pending-response reminder 72 hours before the first
 * applicable service time and one confirmed-service reminder 24 hours before
 * the first applicable attendance time. Mirrors
 * `private.effective_reminder_policy` in the database.
 */
export const DEFAULT_REMINDER_OFFSET_MINUTES: Readonly<Record<ReminderKind, number>> = {
  pending_response: 72 * 60,
  confirmed_service: 24 * 60,
};
export const DEFAULT_REMINDER_CHANNELS: readonly DeliveryChannel[] = ['in_app', 'push', 'email'];
export const DEFAULT_REMINDER_MAX_PER_DAY = 2;

export const REMINDER_KIND_LABELS: Readonly<Record<ReminderKind, string>> = {
  pending_response: 'Unanswered request',
  confirmed_service: 'Upcoming confirmed service',
};

export const REMINDER_KIND_DESCRIPTIONS: Readonly<Record<ReminderKind, string>> = {
  pending_response: 'Sent before the first applicable service time to people who have not answered.',
  confirmed_service: 'Sent before the first time a confirmed person needs to be there (rehearsals included).',
};

export const REMINDER_POLICY_SOURCE_LABELS: Readonly<Record<ReminderPolicySource, string>> = {
  team: 'From the team setting',
  service_type: 'From the service type setting',
  organization: 'From the organization setting',
  default: 'Service Center default',
};

/** Whether an effective policy was set at exactly the scope being viewed (vs inherited). */
export const isPolicySetAtScope = (source: ReminderPolicySource, scope: { serviceTypeId?: string | null; teamId?: string | null }): boolean =>
  scope.teamId ? source === 'team' : scope.serviceTypeId ? source === 'service_type' : source === 'organization';

export const REMINDER_JOB_STATUS_LABELS: Readonly<Record<ReminderJobStatus, string>> = {
  scheduled: 'Scheduled',
  enqueued: 'Handed to delivery',
  cancelled: 'Cancelled',
  skipped: 'Not sent',
};

const REMINDER_REASON_LABELS: Readonly<Record<string, string>> = {
  no_longer_applicable: 'No longer applies (answered, removed, changed or policy updated)',
  due_passed: 'Was already due when the request was sent',
  quiet_hours: 'Would fall in quiet hours until the service started',
  frequency_cap: 'Daily reminder limit reached before the service',
  occurrence_started: 'The service had already started',
  reminder_obsolete: 'No longer applied when it was about to be sent',
};

/** Reminder skip/cancel reasons the server records; each has a translation in `staffing:reminderReason`. */
export const REMINDER_REASON_CODES = [
  'no_longer_applicable',
  'due_passed',
  'quiet_hours',
  'frequency_cap',
  'occurrence_started',
  'reminder_obsolete',
] as const;
export type ReminderReasonCode = (typeof REMINDER_REASON_CODES)[number];

export const isReminderReasonCode = (code: string): code is ReminderReasonCode =>
  (REMINDER_REASON_CODES as readonly string[]).includes(code);

export const reminderReasonLabel = (code: string | null): string | null =>
  code ? REMINDER_REASON_LABELS[code] ?? code : null;

export const RELEASE_BATCH_STATUS_LABELS: Readonly<Record<ReleaseBatchStatus, string>> = {
  scheduled: 'Scheduled',
  released: 'Released',
  cancelled: 'Cancelled',
  failed: 'Not released',
};

const RELEASE_FAILURE_LABELS: Readonly<Record<string, string>> = {
  scope_changed: 'The requests changed after review, so nothing was released. Review them again.',
  actor_not_permitted: 'The person who scheduled it can no longer release these requests.',
  internal_error: 'Unexpected error; nothing was released.',
};

export const releaseFailureLabel = (code: string | null): string | null =>
  code ? RELEASE_FAILURE_LABELS[code] ?? code : null;

/** "3 days", "1 day 2 hours", "45 minutes" — for offsets before a time. */
export const formatReminderOffset = (minutes: number): string => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const parts = [days ? part(days, 'day') : '', hours ? part(hours, 'hour') : '', mins ? part(mins, 'minute') : '']
    .filter(Boolean);
  return parts.length ? parts.join(' ') : '0 minutes';
};

/** `HH:MM:SS` or `HH:MM` → `HH:MM`, for time inputs. */
export const toWallClockInput = (value: string | null): string => (value ? value.slice(0, 5) : '');

/** A reminder policy scope: organization (neither id), a service type or a team. */
export interface ReminderPolicyScope {
  serviceTypeId?: string | null;
  teamId?: string | null;
}

/**
 * Mirrors `private.can_edit_reminder_policy`, for showing controls only:
 * team policies need team scheduling/management, service-type policies need
 * scheduling or plan editing there, the organization policy needs an admin.
 */
export const canEditReminderScope = (
  access: EffectiveAccess | null | undefined,
  isAdministrator: boolean,
  scope: ReminderPolicyScope,
): boolean => {
  if (scope.teamId) {
    return canAccess(access, 'scheduling.manage', { teamId: scope.teamId })
      || canAccess(access, 'teams.manage', { teamId: scope.teamId });
  }
  if (scope.serviceTypeId) {
    return canAccess(access, 'scheduling.manage', { serviceTypeId: scope.serviceTypeId })
      || canAccess(access, 'plans.edit', { serviceTypeId: scope.serviceTypeId });
  }
  return isAdministrator;
};

/**
 * MOB-015: one reminder kind's policy as an editor holds it, shared by the
 * website and the app so the same choices save the same policy. The offset
 * is edited in hours and stored in minutes.
 */
export interface ReminderPolicyDraft {
  enabled: boolean;
  hours: string;
  channels: DeliveryChannel[];
  quiet: boolean;
  quietStart: string;
  quietEnd: string;
  maxPerDay: number;
}

export type ReminderPolicyDraftProblem = 'offset' | 'quiet' | 'channels' | 'max_per_day';

export const REMINDER_CHANNELS: readonly DeliveryChannel[] = ['in_app', 'push', 'email'];

const hoursOf = (minutes: number): string => String(Math.round((minutes / 60) * 100) / 100);

/** The editor's starting point: the policy in effect at this scope (inherited or set here). */
export const reminderPolicyDraftFrom = (effective: EffectiveReminderPolicy): ReminderPolicyDraft => ({
  enabled: effective.enabled,
  hours: hoursOf(effective.offset_minutes),
  channels: [...effective.channels],
  quiet: Boolean(effective.quiet_start),
  quietStart: toWallClockInput(effective.quiet_start) || '21:00',
  quietEnd: toWallClockInput(effective.quiet_end) || '08:00',
  maxPerDay: effective.max_per_day,
});

export const reminderDraftOffsetMinutes = (draft: Pick<ReminderPolicyDraft, 'hours'>): number =>
  Math.round(Number(draft.hours) * 60);

/** Mirrors `upsertReminderPolicySchema`: 15 min–30 days, distinct quiet ends, a channel, 1–10 a day. */
export const validateReminderPolicyDraft = (draft: ReminderPolicyDraft): ReminderPolicyDraftProblem[] => {
  const problems: ReminderPolicyDraftProblem[] = [];
  const minutes = reminderDraftOffsetMinutes(draft);
  if (draft.hours.trim() === '' || !Number.isFinite(minutes) || minutes < 15 || minutes > 43200) problems.push('offset');
  if (draft.quiet && draft.quietStart === draft.quietEnd) problems.push('quiet');
  if (draft.channels.length === 0) problems.push('channels');
  if (!Number.isInteger(draft.maxPerDay) || draft.maxPerDay < 1 || draft.maxPerDay > 10) problems.push('max_per_day');
  return problems;
};

/**
 * The `PUT /reminder-policies` body for this scope. Overriding an existing
 * row sends the revision the editor loaded, so a competing save is a 409.
 */
export const reminderPolicyRequest = (
  draft: ReminderPolicyDraft,
  kind: ReminderKind,
  scope: ReminderPolicyScope,
  explicit: Pick<ReminderPolicyRow, 'revision'> | undefined,
): UpsertReminderPolicyRequest => ({
  service_type_id: scope.serviceTypeId ?? null,
  team_id: scope.teamId ?? null,
  kind,
  enabled: draft.enabled,
  offset_minutes: reminderDraftOffsetMinutes(draft),
  channels: REMINDER_CHANNELS.filter((channel) => draft.channels.includes(channel)),
  quiet_start: draft.quiet ? draft.quietStart : null,
  quiet_end: draft.quiet ? draft.quietEnd : null,
  max_per_day: draft.maxPerDay,
  ...(explicit ? { expected_revision: explicit.revision } : {}),
});

/** One Person's scheduled reminders and delivery history on a plan. */
export interface PlanDeliveryPerson {
  personId: string;
  name: string;
  reminders: PlanReminderJob[];
  deliveries: PlanDeliveryHistoryItem[];
}

/**
 * The plan's reminders and deliveries grouped by Person, by name. Cancelled
 * reminder intents (recomputed after a change) are left out, as on the
 * website; skipped ones stay with their reason.
 */
export const planDeliveryByPerson = (history: PlanDeliveryHistory | null | undefined): PlanDeliveryPerson[] => {
  const byPerson = new Map<string, PlanDeliveryPerson>();
  const entry = (personId: string, name: string): PlanDeliveryPerson => {
    const existing = byPerson.get(personId);
    if (existing) return existing;
    const created: PlanDeliveryPerson = { personId, name, reminders: [], deliveries: [] };
    byPerson.set(personId, created);
    return created;
  };
  for (const item of history?.deliveries ?? []) entry(item.person_id, item.person_name).deliveries.push(item);
  for (const job of history?.reminders ?? []) {
    if (job.status !== 'cancelled') entry(job.person_id, job.person_name).reminders.push(job);
  }
  return [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name));
};
