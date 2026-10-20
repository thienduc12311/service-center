import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  DeliveryStatus,
  PlanDeliveryHistoryItem,
  PlanReminderJob,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePlanDeliveries } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';
import { useFormatters } from '../../i18n';
import { deliveryErrorText } from './DeliveryOutcomeNotice';

const TONE: Partial<Record<DeliveryStatus, string>> = {
  failed: 'bg-red-50 text-red-700 ring-red-600/20',
  ambiguous: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  provider_accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};
const NEUTRAL = 'bg-slate-100 text-slate-600 ring-slate-500/20';

/** Reminder skip/cancel reasons the server records (see `lib/reminders.ts`). */
const REMINDER_REASON_CODES = [
  'no_longer_applicable',
  'due_passed',
  'quiet_hours',
  'frequency_cap',
  'occurrence_started',
  'reminder_obsolete',
] as const;
type ReminderReasonCode = (typeof REMINDER_REASON_CODES)[number];

const isReminderReasonCode = (code: string): code is ReminderReasonCode =>
  (REMINDER_REASON_CODES as readonly string[]).includes(code);

/** Plain-language reason for a reminder status code; an unknown code is shown as-is. */
const reminderReasonText = (code: string | null, t: TFunction<['staffing', 'common']>): string | null => {
  if (!code) return null;
  return isReminderReasonCode(code) ? t(`staffing:reminderReason.${code}`) : code;
};

export interface PlanDeliveryPanelProps {
  planId: string;
}

interface DeliveryItemProps {
  item: PlanDeliveryHistoryItem;
}

const DeliveryItem = ({ item }: DeliveryItemProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime } = useFormatters();
  const invalidate = useInvalidateOrg();
  const retry = useMutation({ mutationFn: () => api.retryDelivery(item.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p>
          {t('planDelivery.templateChannel', {
            template: t(`deliveryTemplate.${item.template}`),
            channel: t(`deliveryChannel.${item.channel}`),
          })}
          <span className="text-slate-500"> · {dateTime(item.created_at)}</span>
        </p>
        {item.error_code && <p className="text-slate-500">{deliveryErrorText(item.error_code, t)}</p>}
        {item.next_attempt_at && (
          <p className="text-slate-500">{t('planDelivery.nextTry', { time: dateTime(item.next_attempt_at) })}</p>
        )}
        <ErrorNotice error={retry.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={TONE[item.status] ?? NEUTRAL}>{t(`deliveryStatus.${item.status}`)}</Badge>
        {item.can_retry && (
          <Button variant="secondary" loading={retry.isPending} onClick={() => retry.mutate()}>{t('common:actions.retry')}</Button>
        )}
      </div>
    </li>
  );
};

interface ReminderItemProps {
  job: PlanReminderJob;
}

const ReminderItem = ({ job }: ReminderItemProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime } = useFormatters();
  const due = dateTime(job.due_at);
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <p>
          {t('planDelivery.templateChannel', {
            template: t(`reminderKind.${job.kind}`),
            channel: t(`deliveryChannel.${job.channel}`),
          })}
          <span className="text-slate-500">
            {' · '}
            {job.status === 'scheduled' ? t('planDelivery.due', { time: due }) : t('planDelivery.wasDue', { time: due })}
          </span>
        </p>
        {job.status_reason && <p className="text-slate-500">{reminderReasonText(job.status_reason, t)}</p>}
      </div>
      <Badge tone={NEUTRAL}>{t(`reminderJobStatus.${job.status}`)}</Badge>
    </li>
  );
};

/**
 * F08: per-Person and per-channel history for this plan's requests and the
 * reminders scheduled for them. "Accepted by provider" never means the
 * person read it; "Outcome unknown" means the provider may or may not have
 * sent it. Retry is for administrators.
 */
export const PlanDeliveryPanel = ({ planId }: PlanDeliveryPanelProps) => {
  const { t } = useTranslation('staffing');
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
          <h2 className="font-semibold">{t('planDelivery.title')}</h2>
          <p className="text-sm text-slate-500">{t('planDelivery.description')}</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? t('planDelivery.hide') : t('planDelivery.show')}
        </Button>
      </div>
      {open && (
        <div className="mt-4">
          {history.isLoading ? (
            <div className="flex justify-center py-6 text-slate-400"><Spinner /></div>
          ) : people.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400 dark:bg-slate-900">
              {t('planDelivery.empty')}
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
