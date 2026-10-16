import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  deliveryErrorLabel,
  formatDate,
  type DeliveryListItem,
  type DeliveryStatus,
} from '@service-center/shared';
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

const DeliveryRowView = ({ delivery }: { delivery: DeliveryListItem }) => {
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryDelivery(delivery.id), onSuccess: invalidate });
  const current = retry.data ?? delivery;

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {current.recipient_name ?? 'Unknown person'} · {DELIVERY_CHANNEL_LABELS[current.channel]}
        </p>
        <p className="text-slate-500">
          {current.plan_title ?? 'Deleted plan'} · {formatDate(current.created_at)} · {current.attempts} attempt
          {current.attempts === 1 ? '' : 's'}
        </p>
        {current.error_code && <p className="text-slate-500">{deliveryErrorLabel(current.error_code)}</p>}
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={statusTone[current.status] ?? NEUTRAL_TONE}>{DELIVERY_STATUS_LABELS[current.status]}</Badge>
        {current.retryable && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>
            Retry
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
  const [showAll, setShowAll] = useState(false);
  const status = useDeliveryStatus();
  const deliveries = useDeliveries({ needs_attention: !showAll, limit: 50 });

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Delivery</h2>
      <p className="mb-4 text-sm text-slate-500">
        What happened to schedule emails, pushes and in-app notifications. “Accepted by provider” means the
        email or push service took the message; it does not confirm the person saw it.
      </p>

      {status.data && (
        <dl className="mb-4 grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd>{status.data.email === 'resend' ? 'Sent through Resend' : 'Simulated — not sent (no provider configured)'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Push</dt>
            <dd>{status.data.push === 'expo' ? 'Sent through Expo' : 'Simulated — not sent (push disabled)'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Waiting to send</dt>
            <dd>{status.data.pending}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Need attention</dt>
            <dd>{status.data.needs_attention}</dd>
          </div>
          {!status.data.worker_configured && (
            <div className="sm:col-span-2 text-amber-700">
              No scheduled delivery worker is configured, so retries and anything interrupted wait until
              someone acts again or an operator runs the worker.
            </div>
          )}
        </dl>
      )}

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{showAll ? 'Recent deliveries' : 'Failed or uncertain'}</h3>
        <Button variant="ghost" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show only problems' : 'Show all recent'}
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
          {showAll ? 'Nothing has been sent yet.' : 'Nothing needs attention.'}
        </p>
      )}
      <ErrorNotice error={status.error ?? deliveries.error} />
    </section>
  );
};
