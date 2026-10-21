import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  isDeliveryErrorCode,
  type AssignmentNotificationSendResult,
  type DeliveryChannel,
  type DeliveryStatus,
  type DeliveryStatusCounts,
} from '@service-center/shared';

/** Plain-language reason for a delivery error code; an unknown code is shown as-is. */
export const deliveryErrorText = (code: string | null, t: TFunction<['staffing', 'common']>): string | null => {
  if (!code) return null;
  return isDeliveryErrorCode(code) ? t(`staffing:deliveryError.${code}`) : code;
};

export interface DeliveryOutcomeNoticeProps {
  result: AssignmentNotificationSendResult;
  /** Administrators can retry failures from Settings. */
  canRetry: boolean;
}

const CHANNELS: readonly DeliveryChannel[] = ['email', 'push', 'in_app'];
const PROBLEM_STATUSES: readonly DeliveryStatus[] = ['failed', 'ambiguous'];

const describeCounts = (counts: DeliveryStatusCounts, t: TFunction<['staffing', 'common']>): string =>
  (Object.entries(counts) as Array<[DeliveryStatus, number]>)
    .map(([status, count]) => t(`staffing:deliveryStatusCount.${status}`, { count }))
    .join(t('common:format.listSeparator'));

/**
 * What actually happened when a plan was notified, per channel. A simulated
 * email is reported as simulated, never as sent.
 */
export const DeliveryOutcomeNotice = ({ result, canRetry }: DeliveryOutcomeNoticeProps) => {
  const { t } = useTranslation(['staffing', 'common']);

  if (result.outcomes.length === 0) {
    return (
      <p className="rounded-lg bg-slate-50 px-4 py-2 text-sm text-slate-600">
        {t('deliveryOutcome.nothingSent')}
      </p>
    );
  }

  const problems = result.outcomes.filter((outcome) => PROBLEM_STATUSES.includes(outcome.status));
  const tone = problems.length > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700';

  return (
    <div className={`space-y-1 rounded-lg px-4 py-2 text-sm ${tone}`} role="status">
      {CHANNELS.filter((channel) => Object.keys(result.summary[channel]).length > 0).map((channel) => (
        <p key={channel}>
          <span className="font-medium">{t('deliveryOutcome.channelLabel', { channel: t(`deliveryChannel.${channel}`) })}</span>{' '}
          {describeCounts(result.summary[channel], t)}
        </p>
      ))}
      {result.email_mode === 'simulated' && <p>{t('deliveryOutcome.emailSimulated')}</p>}
      {result.skipped.length > 0 && (
        <p>{t('deliveryOutcome.noEmailFor', { names: result.skipped.join(t('common:format.listSeparator')) })}</p>
      )}
      {problems.length > 0 && (
        <ul className="list-disc pl-5">
          {problems.map((outcome) => {
            const reason = deliveryErrorText(outcome.error_code, t);
            const values = {
              name: outcome.recipient_name ?? t('common:fallback.someone'),
              channel: t(`deliveryChannel.${outcome.channel}`),
              status: t(`deliveryStatus.${outcome.status}`),
            };
            return (
              <li key={outcome.id}>
                {reason
                  ? t('deliveryOutcome.problemWithReason', { ...values, reason })
                  : t('deliveryOutcome.problem', values)}
              </li>
            );
          })}
        </ul>
      )}
      {problems.length > 0 && (
        <p>{canRetry ? t('deliveryOutcome.retryFromSettings') : t('deliveryOutcome.adminCanRetry')}</p>
      )}
    </div>
  );
};
