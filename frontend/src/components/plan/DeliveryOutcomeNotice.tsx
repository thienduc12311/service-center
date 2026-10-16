import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  deliveryErrorLabel,
  type AssignmentNotificationSendResult,
  type DeliveryChannel,
  type DeliveryStatus,
  type DeliveryStatusCounts,
} from '@service-center/shared';

export interface DeliveryOutcomeNoticeProps {
  result: AssignmentNotificationSendResult;
  /** Administrators can retry failures from Settings. */
  canRetry: boolean;
}

const CHANNELS: readonly DeliveryChannel[] = ['email', 'push', 'in_app'];
const PROBLEM_STATUSES: readonly DeliveryStatus[] = ['failed', 'ambiguous'];

const describeCounts = (counts: DeliveryStatusCounts): string =>
  (Object.entries(counts) as Array<[DeliveryStatus, number]>)
    .map(([status, count]) => `${count} ${DELIVERY_STATUS_LABELS[status].toLowerCase()}`)
    .join(', ');

/**
 * What actually happened when a plan was notified, per channel. A simulated
 * email is reported as simulated, never as sent.
 */
export const DeliveryOutcomeNotice = ({ result, canRetry }: DeliveryOutcomeNoticeProps) => {
  if (result.outcomes.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
        Nobody is waiting for a reply, so nothing was sent.
      </p>
    );
  }

  const problems = result.outcomes.filter((outcome) => PROBLEM_STATUSES.includes(outcome.status));
  const tone = problems.length > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700';

  return (
    <div className={`space-y-1 rounded-lg px-4 py-2 text-sm ${tone}`} role="status">
      {CHANNELS.filter((channel) => Object.keys(result.summary[channel]).length > 0).map((channel) => (
        <p key={channel}>
          <span className="font-medium">{DELIVERY_CHANNEL_LABELS[channel]}:</span>{' '}
          {describeCounts(result.summary[channel])}
        </p>
      ))}
      {result.email_mode === 'simulated' && (
        <p>Email isn’t configured on this server, so no email was actually sent.</p>
      )}
      {result.skipped.length > 0 && <p>No email address for {result.skipped.join(', ')}.</p>}
      {problems.length > 0 && (
        <ul className="list-disc pl-5">
          {problems.map((outcome) => (
            <li key={outcome.id}>
              {outcome.recipient_name ?? 'Someone'} · {DELIVERY_CHANNEL_LABELS[outcome.channel]} —{' '}
              {DELIVERY_STATUS_LABELS[outcome.status]}
              {outcome.error_code ? ` (${deliveryErrorLabel(outcome.error_code)})` : ''}
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <p>{canRetry ? 'Retry these from Settings → Delivery.' : 'An organization admin can retry these.'}</p>
      )}
    </div>
  );
};
