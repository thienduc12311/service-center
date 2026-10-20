import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { type DeliveryListItem, type DeliveryStatus } from '@service-center/shared';
import { useFormatters } from '../../i18n';
import { api } from '../../lib/api';
import { useDeliveries, useDeliveryStatus, useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';

const statusTone: Partial<Record<DeliveryStatus, string>> = {
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  ambiguous: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  provider_accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  simulated: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

const NEUTRAL_TONE = 'bg-slate-100 text-slate-600 ring-slate-500/20';

/** Machine codes the server records on a delivery that have a translated reason. */
const KNOWN_DELIVERY_ERRORS = [
  'no_email_address',
  'no_active_device',
  'recipient_not_eligible',
  'scheduler_not_active',
  'plan_missing',
  'request_missing',
  'already_reviewed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_rejected',
  'provider_misconfigured',
  'provider_timeout',
  'outcome_unknown',
  'worker_lease_expired',
  'internal_error',
  'reminder_obsolete',
  'provider_duplicate_key',
  'content_removed',
  'conversation_muted',
  'channel_not_used',
] as const;
type KnownDeliveryError = (typeof KNOWN_DELIVERY_ERRORS)[number];

const isKnownDeliveryError = (code: string): code is KnownDeliveryError =>
  (KNOWN_DELIVERY_ERRORS as readonly string[]).includes(code);

/** Plain-language reason for a stored error code; unknown (newer) codes are shown as-is. */
const deliveryErrorText = (t: TFunction<'settings'>, code: string): string =>
  isKnownDeliveryError(code) ? t(`delivery.error.${code}`) : code;

const DeliveryRowView = ({ delivery }: { delivery: DeliveryListItem }) => {
  const { t } = useTranslation('settings');
  const { date } = useFormatters();
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryDelivery(delivery.id), onSuccess: invalidate });
  const current = retry.data ?? delivery;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {t('delivery.recipientChannel', {
            name: current.recipient_name ?? t('delivery.unknownPerson'),
            channel: t(`delivery.channel.${current.channel}`),
          })}
        </p>
        <p className="text-slate-500">
          {t('delivery.details', {
            plan: current.plan_title ?? t('delivery.deletedPlan'),
            date: date(current.created_at),
            count: current.attempts,
          })}
        </p>
        {current.error_code && <p className="text-slate-500">{deliveryErrorText(t, current.error_code)}</p>}
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={statusTone[current.status] ?? NEUTRAL_TONE}>{t(`delivery.status.${current.status}`)}</Badge>
        {current.retryable && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
            {t('delivery.retry')}
          </Button>
        )}
      </div>
    </li>
  );
};

/**
 * Administrator view: how email and push are configured, and which
 * deliveries failed or may not have gone out, with a retry for each.
 */
export const DeliverySettings = () => {
  const { t } = useTranslation('settings');
  const [showAll, setShowAll] = useState(false);
  const status = useDeliveryStatus();
  const deliveries = useDeliveries({ needs_attention: !showAll, limit: 50 });

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">{t('delivery.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('delivery.description')}</p>

      {status.data && (
        <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">{t('delivery.channel.email')}</dt>
            <dd>{status.data.email === 'resend' ? t('delivery.emailResend') : t('delivery.emailSimulated')}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('delivery.channel.push')}</dt>
            <dd>{status.data.push === 'expo' ? t('delivery.pushExpo') : t('delivery.pushSimulated')}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('delivery.pending')}</dt>
            <dd>{status.data.pending}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('delivery.needsAttention')}</dt>
            <dd>{status.data.needs_attention}</dd>
          </div>
          {!status.data.worker_configured && (
            <div className="sm:col-span-2 text-amber-700">{t('delivery.noWorker')}</div>
          )}
        </dl>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{showAll ? t('delivery.recent') : t('delivery.problems')}</h3>
        <Button variant="ghost" onClick={() => setShowAll((value) => !value)}>
          {showAll ? t('delivery.showProblems') : t('delivery.showAll')}
        </Button>
      </div>

      {deliveries.isLoading ? (
        <div className="flex justify-center py-6 text-slate-400">
          <Spinner />
        </div>
      ) : deliveries.data?.data.length ? (
        <ul className="divide-y divide-slate-100">
          {deliveries.data.data.map((delivery) => (
            <DeliveryRowView key={delivery.id} delivery={delivery} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
          {showAll ? t('delivery.emptyAll') : t('delivery.emptyProblems')}

        </p>
      )}
      <ErrorNotice error={status.error ?? deliveries.error} />
    </section>
  );
};
