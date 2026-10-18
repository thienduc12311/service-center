import type { DeliveryChannel, DeliveryStatus } from '../types/database.js';
import type { DeliveryOutcome, DeliveryOutcomeSummary } from '../types/domain.js';

/** Outcomes an administrator may retry. */
export const RETRYABLE_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['failed', 'ambiguous'];
/** Outcomes still waiting for (or held by) a worker. */
export const PENDING_DELIVERY_STATUSES: readonly DeliveryStatus[] = ['queued', 'sending'];

export const isRetryableDelivery = (status: DeliveryStatus): boolean =>
  RETRYABLE_DELIVERY_STATUSES.includes(status);

export const isPendingDelivery = (status: DeliveryStatus): boolean =>
  PENDING_DELIVERY_STATUSES.includes(status);

/**
 * Wording shared by every client. Nothing here claims a person read or
 * received a message: providers only tell us they accepted it.
 */
export const DELIVERY_STATUS_LABELS: Readonly<Record<DeliveryStatus, string>> = {
  queued: 'Queued',
  sending: 'Sending',
  simulated: 'Simulated — not sent',
  provider_accepted: 'Accepted by provider',
  delivered: 'Delivered',
  failed: 'Failed',
  ambiguous: 'Outcome unknown',
  skipped: 'Not sent',
  cancelled: 'Cancelled',
};

export const DELIVERY_CHANNEL_LABELS: Readonly<Record<DeliveryChannel, string>> = {
  in_app: 'In-app',
  push: 'Push',
  email: 'Email',
};

/** Plain-language reasons for the machine codes the server records. */
const DELIVERY_ERROR_LABELS: Readonly<Record<string, string>> = {
  no_email_address: 'No email address on file',
  no_active_device: 'No registered device',
  recipient_not_eligible: 'No longer scheduled or no longer a member',
  scheduler_not_active: 'Scheduler is no longer active in this organization',
  plan_missing: 'The plan no longer exists',
  request_missing: 'The availability request no longer exists',
  already_reviewed: 'Already updated their availability',
  provider_rate_limited: 'Provider rate limit — will retry',
  provider_unavailable: 'Provider unavailable — will retry',
  provider_rejected: 'Provider rejected the message',
  provider_misconfigured: 'Email provider is misconfigured',
  provider_timeout: 'Provider did not answer in time',
  outcome_unknown: 'Interrupted while sending; it may have been sent',
  worker_lease_expired: 'Worker stopped before sending; will retry',
  internal_error: 'Unexpected error',
};

export const deliveryErrorLabel = (code: string | null): string | null =>
  code ? DELIVERY_ERROR_LABELS[code] ?? code : null;

export const summarizeDeliveryOutcomes = (
  outcomes: readonly Pick<DeliveryOutcome, 'channel' | 'status'>[],
): DeliveryOutcomeSummary => {
  const summary: DeliveryOutcomeSummary = { in_app: {}, push: {}, email: {} };
  for (const outcome of outcomes) {
    const counts = summary[outcome.channel];
    counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
  }
  return summary;
};
