import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  ApiError,
  LocalizedError,
  addLocalDays,
  type OrderOnlyReschedulePreview,
  type ReschedulePlanPreview,
  type ReschedulePreview,
  type ReschedulePreviewRequest,
  type RescheduleResult,
  type ShiftReschedulePreview,
  type TemplateApplyMode,
  type TemplatePreviewNotice,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, usePlans } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters } from '../i18n';
import { Button, EmptyState, ErrorNotice, PageHeader } from '../components/ui';
import { Icon } from '../components/icons';
import { useTemplateNames, useTemplateNoticeText } from '../components/templates/useTemplateNames';

type Mode = 'shift' | 'order_only';

/** Local `YYYY-MM-DD` of an instant in the browser's zone (only for the date picker default). */
const browserDate = (instant: string): string => {
  const date = new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Counts listed one per row (people's answers are summarised separately). */
type RescheduleCountKey = Exclude<keyof ReschedulePlanPreview['counts'], 'confirmed' | 'unconfirmed' | 'declined' | 'prepared'>;

const COUNT_KEYS: RescheduleCountKey[] = [
  'responses_reset',
  'requests_resent',
  'links_invalidated',
  'reminder_jobs_recalculated',
  'calendar_entries_moved',
  'deliveries_pending',
];

/** What an order-only move reports as untouched (server enum values). */
const UNCHANGED_PARTS = ['times', 'roster', 'answers', 'reminder_jobs', 'calendar_feeds', 'notes'] as const;
type UnchangedPart = (typeof UNCHANGED_PARTS)[number];
const isUnchangedPart = (value: string): value is UnchangedPart => (UNCHANGED_PARTS as readonly string[]).includes(value);

interface NoticesProps {
  notices: TemplatePreviewNotice[];
}

const Notices = ({ notices }: NoticesProps) => {
  const noticeText = useTemplateNoticeText();
  return notices.length === 0 ? null : (
    <ul className="space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25">
      {notices.map((notice) => <li key={`${notice.code}-${notice.message}`}>{noticeText(notice)}</li>)}
    </ul>
  );
};

interface ShiftPlanReviewProps {
  plan: ReschedulePlanPreview;
  timezone: string;
}

const ShiftPlanReview = ({ plan, timezone }: ShiftPlanReviewProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const fmt = useFormatters();
  const names = useTemplateNames();
  return (
    <li className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-slate-900 dark:text-white">{plan.title}</span>
        <span className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
          <Icon name="calendar" className="size-3.5" />
          {t('reschedule.dateMove', {
            from: fmt.calendarDate(plan.from_local_date, 'medium'),
            to: fmt.calendarDate(plan.to_local_date, 'medium'),
            timezone,
          })}
        </span>
      </div>
      <Notices notices={plan.warnings} />
      <div className="scrollbar-thin overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
          <tr>
            <th className="py-1.5 pr-3 font-semibold">{t('reschedule.timeHeader')}</th>
            <th className="pr-3 font-semibold">{t('reschedule.fromHeader')}</th>
            <th className="font-semibold">{t('reschedule.toHeader')}</th>
          </tr>
        </thead>
        <tbody>
          {plan.times.map((time) => (
            <tr key={time.id} className="border-t border-app-border">
              <td className="py-1.5 pr-3 font-medium text-slate-800 dark:text-slate-100">{time.name ?? t(`timeKinds.${time.kind}`)}</td>
              <td>{fmt.dateTime(time.from_starts_at, { timeZone: timezone })}</td>
              <td>{fmt.dateTime(time.starts_at, { timeZone: timezone })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('reschedule.peopleSummary', {
          confirmed: plan.counts.confirmed,
          unconfirmed: plan.counts.unconfirmed,
          declined: plan.counts.declined,
          prepared: plan.counts.prepared,
        })}
      </p>
      <dl className="surface-inset grid gap-x-6 gap-y-1 px-3 py-2.5 text-sm sm:grid-cols-2">
        {COUNT_KEYS.map((key) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-slate-500 dark:text-slate-400">{t(`reschedule.counts.${key}`)}</dt>
            <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{plan.counts[key]}</dd>
          </div>
        ))}
      </dl>
      {plan.people.some((person) => person.resets) && (
        <p className="text-xs text-slate-500">
          {t('reschedule.resetList', {
            people: fmt.list(plan.people.filter((person) => person.resets).map((person) =>
              t('reschedule.resetEntry', { name: names.person(person.person_id), status: t(`common:assignmentStatus.${person.status}`) }))),
          })}
        </p>
      )}
      {plan.conflicts.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('reschedule.overlaps', {
            list: fmt.list(plan.conflicts.map((conflict) =>
              t('reschedule.overlapEntry', { name: names.person(conflict.person_id), plan: conflict.plan_title }))),
          })}
        </p>
      )}
    </li>
  );
};

interface OrderReviewProps {
  preview: OrderOnlyReschedulePreview;
}

const OrderReview = ({ preview }: OrderReviewProps) => {
  const { t } = useTranslation('templates');
  const fmt = useFormatters();
  const values = { count: preview.source.items.length, source: preview.source.title, destination: preview.destination.title };
  return (
    <div className="card space-y-3 p-4 text-sm">
      <Notices notices={preview.warnings} />
      <p>
        <Trans
          t={t}
          i18nKey={preview.remove_from_source ? 'reschedule.orderMove' : 'reschedule.orderCopy'}
          count={values.count}
          values={values}
          components={[<strong key="source" />, <strong key="destination" />]}
        />{' '}
        {preview.items_mode === 'replace'
          ? t('reschedule.orderReplacing', { count: preview.destination.items_removed })
          : t('reschedule.orderAfter', { count: preview.destination.items_kept })}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{preview.source.items.join(' · ')}</p>
      <p>
        {t('reschedule.rosterKept', {
          plan: preview.destination.title,
          confirmed: preview.destination.roster_kept.confirmed,
          unconfirmed: preview.destination.roster_kept.unconfirmed,
          declined: preview.destination.roster_kept.declined,
          prepared: preview.destination.roster_kept.prepared,
        })}
      </p>
      <p className="text-slate-500 dark:text-slate-400">
        {t('reschedule.notChanged', {
          list: fmt.list(preview.unchanged.map((part) => (isUnchangedPart(part) ? t(`reschedule.unchanged.${part}`) : part.replaceAll('_', ' ')))),
        })}
      </p>
    </div>
  );
};

/**
 * F10 Pass C: move plans deliberately. Shifting whole plans moves their
 * dates and times (keeping local clock times) and keeps answers unless you
 * choose to reset them; moving the order only leaves both rosters alone.
 */
export const ReschedulePlansPage = () => {
  const { t } = useTranslation(['templates', 'common']);
  const fmt = useFormatters();
  const { canAnywhere } = useAuth();
  const invalidate = useInvalidateOrg();
  const [openedAt] = useState(() => new Date().toISOString());
  const plans = usePlans({ from: openedAt, order: 'asc', per_page: 50 });
  const [mode, setMode] = useState<Mode>('shift');
  const [dates, setDates] = useState<Record<string, string>>({});
  const [shiftDays, setShiftDays] = useState(7);
  const [resetResponses, setResetResponses] = useState(false);
  const [notify, setNotify] = useState(true);
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [itemsMode, setItemsMode] = useState<TemplateApplyMode>('append');
  const [removeFromSource, setRemoveFromSource] = useState(true);
  const [preview, setPreview] = useState<ReschedulePreview | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<RescheduleResult | null>(null);

  const clearReview = () => {
    setPreview(null);
    setAttemptKey(crypto.randomUUID());
  };
  const request = (): ReschedulePreviewRequest =>
    mode === 'shift'
      ? {
          mode: 'shift',
          moves: Object.entries(dates).map(([plan_id, new_date]) => ({ plan_id, new_date })),
          reset_responses: resetResponses,
          notify,
        }
      : {
          mode: 'order_only',
          source_plan_id: sourceId,
          destination_plan_id: destinationId,
          items_mode: itemsMode,
          remove_from_source: removeFromSource,
        };

  const review = useMutation({
    mutationFn: () => api.previewReschedule(request()),
    onSuccess: (result) => {
      setPreview(result);
      setAttemptKey(crypto.randomUUID());
    },
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!preview) throw new LocalizedError({ key: 'templates:errors.reviewChangeFirst' });
      return api.reschedulePlans({ ...request(), preview_hash: preview.preview_hash, idempotency_key: attemptKey });
    },
    onSuccess: async (result) => {
      setDone(result);
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'template_preview_changed') setPreview(null);
    },
  });

  if (!canAnywhere('plans.edit')) return <EmptyState icon="calendar" title={t('reschedule.noAccess')} />;

  if (done) {
    return (
      <div>
        <PageHeader
          title={done.replayed ? t('reschedule.replayedTitle') : t('reschedule.doneTitle')}
          subtitle={`${t('reschedule.plansChanged', { count: done.plan_ids.length })} ${t('reschedule.answersReset', { count: done.responses_reset })}`}
        />
        <ul className="space-y-1">
          {done.plan_ids.map((id) => (
            <li key={id}>
              <Link className="text-brand-700 hover:underline" to={`/plans/${id}`}>
                {plans.data?.data.find((plan) => plan.id === id)?.title ?? t('reschedule.openPlan')}
              </Link>
            </li>
          ))}
        </ul>
        <Button className="mt-4" variant="secondary" onClick={() => { setDone(null); clearReview(); setDates({}); }}>{t('reschedule.rescheduleMore')}</Button>
      </div>
    );
  }

  const upcoming = plans.data?.data ?? [];
  const selected = Object.keys(dates);
  const shiftPreview = preview?.mode === 'shift' ? (preview as ShiftReschedulePreview) : null;
  const orderPreview = preview?.mode === 'order_only' ? (preview as OrderOnlyReschedulePreview) : null;

  return (
    <div className="space-y-5">
      <PageHeader title={t('reschedule.title')} subtitle={t('reschedule.subtitle')} back={{ to: '/plans', label: t('common:nav.plans') }} />
      <fieldset className="flex flex-wrap gap-2 text-sm">
        <legend className="label">{t('reschedule.whatMoves')}</legend>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-medium text-slate-700 ring-1 ring-inset ring-app-border transition hover:bg-slate-50 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:ring-brand-200 dark:text-slate-200 dark:hover:bg-slate-800/50 dark:has-[:checked]:bg-brand-500/15 dark:has-[:checked]:text-brand-200 dark:has-[:checked]:ring-brand-500/30">
          <input type="radio" className="accent-brand-600" name="reschedule-mode" checked={mode === 'shift'} onChange={() => { setMode('shift'); clearReview(); }} />
          {t('reschedule.modeShift')}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 font-medium text-slate-700 ring-1 ring-inset ring-app-border transition hover:bg-slate-50 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:ring-brand-200 dark:text-slate-200 dark:hover:bg-slate-800/50 dark:has-[:checked]:bg-brand-500/15 dark:has-[:checked]:text-brand-200 dark:has-[:checked]:ring-brand-500/30">
          <input type="radio" className="accent-brand-600" name="reschedule-mode" checked={mode === 'order_only'} onChange={() => { setMode('order_only'); clearReview(); }} />
          {t('reschedule.modeOrder')}
        </label>
      </fieldset>

      {mode === 'shift' ? (
        <div className="card space-y-4 p-4 sm:p-5">
          <div className="surface-inset flex flex-wrap items-center gap-2 p-3 text-sm">
            <label className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
              {t('reschedule.moveByLabel')}
              <input aria-label={t('reschedule.moveByAria')} type="number" min={-365} max={365} className="input w-24" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))} />
            </label>
            <Button
              variant="secondary"
              size="sm"
              icon="check"
              disabled={selected.length === 0 || shiftDays === 0}
              onClick={() => {
                setDates(Object.fromEntries(selected.map((id) => {
                  const plan = upcoming.find((candidate) => candidate.id === id);
                  return [id, plan ? addLocalDays(browserDate(plan.service_date), shiftDays) : dates[id]!];
                })));
                clearReview();
              }}
            >
              {t('reschedule.applyToSelected')}
            </Button>
          </div>
          {upcoming.length === 0 ? <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{t('reschedule.noUpcoming')}</p> : (
            <ul className="row-list overflow-hidden rounded-xl border border-app-border">
              {upcoming.map((plan) => (
                <li key={plan.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-sm ${plan.id in dates ? 'bg-brand-50/50 dark:bg-brand-500/5' : ''}`}>
                  <label className="flex min-w-0 flex-1 basis-64 cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
                      checked={plan.id in dates}
                      disabled={!(plan.id in dates) && selected.length >= 12}
                      onChange={(event) => {
                        const next = { ...dates };
                        if (event.target.checked) next[plan.id] = addLocalDays(browserDate(plan.service_date), 7);
                        else delete next[plan.id];
                        setDates(next);
                        clearReview();
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900 dark:text-white">{plan.title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{fmt.dateTime(plan.service_date)}</span>
                    </span>
                  </label>
                  {plan.id in dates && (
                    <input
                      aria-label={t('reschedule.newDateFor', { title: plan.title })}
                      type="date"
                      className="input w-full sm:w-44"
                      value={dates[plan.id]}
                      onChange={(event) => { setDates({ ...dates, [plan.id]: event.target.value }); clearReview(); }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600" checked={notify} onChange={(event) => { setNotify(event.target.checked); clearReview(); }} />
            {t('reschedule.notify')}
          </label>
          <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600" checked={resetResponses} onChange={(event) => { setResetResponses(event.target.checked); clearReview(); }} />
            <span>
              {t('reschedule.resetAnswers')}
              <span className="block text-xs text-slate-500 dark:text-slate-400">{t('reschedule.resetHint')}</span>
            </span>
          </label>
        </div>
      ) : (
        <div className="card grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div>
            <label className="label" htmlFor="order-source">{t('reschedule.moveFrom')}</label>
            <select id="order-source" className="input" value={sourceId} onChange={(event) => { setSourceId(event.target.value); clearReview(); }}>
              <option value="">{t('reschedule.choose')}</option>
              {upcoming.map((plan) => <option key={plan.id} value={plan.id}>{t('reschedule.planWithDate', { title: plan.title, date: fmt.dateTime(plan.service_date) })}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="order-destination">{t('reschedule.into')}</label>
            <select id="order-destination" className="input" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); clearReview(); }}>
              <option value="">{t('reschedule.choose')}</option>
              {upcoming.filter((plan) => plan.id !== sourceId).map((plan) => <option key={plan.id} value={plan.id}>{t('reschedule.planWithDate', { title: plan.title, date: fmt.dateTime(plan.service_date) })}</option>)}
            </select>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-700 sm:col-span-2 dark:text-slate-200">
            <legend className="label">{t('reschedule.destinationOrder')}</legend>
            <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" name="items-mode" checked={itemsMode === 'append'} onChange={() => { setItemsMode('append'); clearReview(); }} /> {t('reschedule.keepAddAfter')}</label>
            <label className="flex items-center gap-2"><input type="radio" className="accent-brand-600" name="items-mode" checked={itemsMode === 'replace'} onChange={() => { setItemsMode('replace'); clearReview(); }} /> {t('reschedule.replaceIt')}</label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2 dark:text-slate-200">
            <input type="checkbox" className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600" checked={removeFromSource} onChange={(event) => { setRemoveFromSource(event.target.checked); clearReview(); }} />
            {t('reschedule.removeFromSource')}
          </label>
        </div>
      )}

      <ErrorNotice error={review.error} />
      <div className="flex justify-end">
        <Button
          icon="sparkle"
          loading={review.isPending}
          disabled={mode === 'shift' ? selected.length === 0 : !sourceId || !destinationId}
          onClick={() => review.mutate()}
        >
          {t('reschedule.reviewChanges')}
        </Button>
      </div>

      {shiftPreview && (
        <section className="space-y-3">
          <ul className="space-y-3">
            {shiftPreview.plans.map((plan) => <ShiftPlanReview key={plan.plan_id} plan={plan} timezone={shiftPreview.timezone} />)}
          </ul>
        </section>
      )}
      {orderPreview && <section><OrderReview preview={orderPreview} /></section>}
      {preview && (
        <div className="space-y-2">
          <ErrorNotice error={commit.error} />
          {commit.error instanceof ApiError && commit.error.code === 'template_preview_changed' && (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300"><Icon name="alert" className="mt-0.5 size-4 shrink-0" />{t('reschedule.planChanged')}</p>
          )}
          <div className="flex justify-end">
            <Button icon="check" loading={commit.isPending} onClick={() => commit.mutate()}>
              {mode === 'shift' ? t('reschedule.movePlans', { count: shiftPreview?.plans.length ?? 0 }) : t('reschedule.moveOrder')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
