import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DELIVERY_CHANNEL_LABELS,
  DELIVERY_STATUS_LABELS,
  REMINDER_JOB_STATUS_LABELS,
  REMINDER_KIND_LABELS,
  deliveryErrorLabel,
  formatDateTime,
  reminderReasonLabel,
  type DeliveryStatus,
  type DeliveryTemplate,
  type PlanDeliveryHistoryItem,
  type PlanReminderJob,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePlanDeliveries } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';

const TONE: Partial<Record<DeliveryStatus, string>> = {
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  ambiguous: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  provider_accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};
const NEUTRAL = 'bg-slate-100 text-slate-600 ring-slate-500/20';

const TEMPLATE_LABELS: Record<DeliveryTemplate, string> = {
  assignment_request: 'Request',
  assignment_reminder: 'Reminder',
  service_reminder: 'Coming-up reminder',
  scheduler_response: 'Response update',
  availability_request: 'Availability request',
  item_comment: 'Discussion',
  operational_message: 'Message',
  conversation_message: 'Chat',
};

export interface PlanDeliveryPanelProps {
  planId: string;
}

const DeliveryItem = ({ item }: { item: PlanDeliveryHistoryItem }) => {
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryDelivery(item.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p>
          {TEMPLATE_LABELS[item.template]} · {DELIVERY_CHANNEL_LABELS[item.channel]}
          <span className="text-slate-500"> · {formatDateTime(item.created_at)}</span>
        </p>
        {item.error_code && <p className="text-slate-500">{deliveryErrorLabel(item.error_code)}</p>}
        {item.next_attempt_at && <p className="text-slate-500">Next try {formatDateTime(item.next_attempt_at)}</p>}
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={TONE[item.status] ?? NEUTRAL}>{DELIVERY_STATUS_LABELS[item.status]}</Badge>
        {item.can_retry && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>Retry</Button>
        )}
      </div>
    </li>
  );
};

const ReminderItem = ({ job }: { job: PlanReminderJob }) => (
  <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
    <div className="min-w-0">
      <p>
        {REMINDER_KIND_LABELS[job.kind]} · {DELIVERY_CHANNEL_LABELS[job.channel]}
        <span className="text-slate-500"> · {job.status === 'scheduled' ? 'due' : 'was due'} {formatDateTime(job.due_at)}</span>
      </p>
      {job.status_reason && <p className="text-slate-500">{reminderReasonLabel(job.status_reason)}</p>}
    </div>
    <Badge tone={NEUTRAL}>{REMINDER_JOB_STATUS_LABELS[job.status]}</Badge>
  </li>
);

/**
 * F08: per-Person and per-channel history for this plan's requests and the
 * reminders scheduled for them. "Accepted by provider" never means the
 * person read it; "Outcome unknown" means the provider may or may not have
 * sent it. Retry is for administrators.
 */
export const PlanDeliveryPanel = ({ planId }: PlanDeliveryPanelProps) => {
  const [open, setOpen] = useState(false);
  const history = usePlanDeliveries(planId, open);

  const people = useMemo(() => {
    const byPerson = new Map<string, { name: string; deliveries: PlanDeliveryHistoryItem[]; reminders: PlanReminderJob[] }>();
    for (const item of history.data?.deliveries ?? []) {
      const entry = byPerson.get(item.person_id) ?? { name: item.person_name, deliveries: [], reminders: [] };
      entry.deliveries.push(item);
      byPerson.set(item.person_id, entry);
    }
    for (const job of history.data?.reminders ?? []) {
      if (job.status === 'cancelled') continue;
      const entry = byPerson.get(job.person_id) ?? { name: job.person_name, deliveries: [], reminders: [] };
      entry.reminders.push(job);
      byPerson.set(job.person_id, entry);
    }
    return [...byPerson.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [history.data]);

  return (
    <section className="card mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Reminders and delivery</h2>
          <p className="text-sm text-slate-500">Scheduled reminders and what happened to each request, by person and channel.</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>
      {open && (
        <div className="mt-4">
          {history.isLoading ? (
            <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>
          ) : people.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:bg-slate-900">
              Nothing has been sent or scheduled for the requests you manage on this plan.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {people.map(([personId, entry]) => (
                <li key={personId} className="py-3">
                  <p className="font-medium">{entry.name}</p>
                  {entry.reminders.length > 0 && (
                    <ul className="ml-3 divide-y divide-slate-50 dark:divide-slate-900">
                      {entry.reminders.map((job) => <ReminderItem key={job.id} job={job} />)}
                    </ul>
                  )}
                  {entry.deliveries.length > 0 && (
                    <ul className="ml-3 divide-y divide-slate-50 dark:divide-slate-900">
                      {entry.deliveries.map((item) => <DeliveryItem key={item.id} item={item} />)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ErrorNotice error={history.error} />
        </div>
      )}
    </section>
  );
};
