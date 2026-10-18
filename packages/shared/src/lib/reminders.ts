import type { DeliveryChannel } from '../types/database.js';
import type { EffectiveAccess } from '../types/domain.js';
import { canAccess } from './access.js';
import type {
  ReleaseBatchStatus,
  ReminderJobStatus,
  ReminderKind,
  ReminderPolicySource,
} from '../types/reminders.js';

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
