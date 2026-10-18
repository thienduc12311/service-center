import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  addLocalDays,
  formatDateTime,
  type OrderOnlyReschedulePreview,
  type ReschedulePlanPreview,
  type ReschedulePreview,
  type ReschedulePreviewRequest,
  type RescheduleResult,
  type ShiftReschedulePreview,
  type TemplateApplyMode,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, usePlans } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, PageHeader } from '../components/ui';
import { useTemplateNames } from '../components/templates/useTemplateNames';

type Mode = 'shift' | 'order_only';

/** Local `YYYY-MM-DD` of an instant in the browser's zone (only for the date picker default). */
const browserDate = (instant: string): string => {
  const date = new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const COUNT_LABELS: Array<[keyof ReschedulePlanPreview['counts'], string]> = [
  ['responses_reset', 'Answers reset to unconfirmed'],
  ['requests_resent', 'Requests re-sent with the new time'],
  ['links_invalidated', 'Open request links that stop working'],
  ['reminder_jobs_recalculated', 'Scheduled reminders recalculated'],
  ['calendar_entries_moved', 'Calendar-feed entries that move'],
  ['deliveries_pending', 'Queued messages re-checked before sending'],
];

const Notices = ({ notices }: { notices: Array<{ code: string; message: string }> }) =>
  notices.length === 0 ? null : (
    <ul className="space-y-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-200">
      {notices.map((notice) => <li key={`${notice.code}-${notice.message}`}>{notice.message}</li>)}
    </ul>
  );

const ShiftPlanReview = ({ plan, timezone }: { plan: ReschedulePlanPreview; timezone: string }) => {
  const names = useTemplateNames();
  return (
    <li className="card space-y-3 p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium">{plan.title}</span>
        <span className="text-sm text-slate-500">{plan.from_local_date} → {plan.to_local_date} ({timezone})</span>
      </div>
      <Notices notices={plan.warnings} />
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr><th className="py-1 font-medium">Time</th><th className="font-medium">From</th><th className="font-medium">To</th></tr>
        </thead>
        <tbody>
          {plan.times.map((time) => (
            <tr key={time.id} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1">{time.name ?? time.kind}</td>
              <td>{time.from_local}</td>
              <td>{time.to_local}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        People: {plan.counts.confirmed} confirmed · {plan.counts.unconfirmed} unconfirmed · {plan.counts.declined} declined ·{' '}
        {plan.counts.prepared} prepared (not yet released)
      </p>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {COUNT_LABELS.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-2">
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-medium">{plan.counts[key]}</dd>
          </div>
        ))}
      </dl>
      {plan.people.some((person) => person.resets) && (
        <p className="text-xs text-slate-500">
          Reset: {plan.people.filter((person) => person.resets).map((person) => `${names.person(person.person_id)} (was ${person.status})`).join(', ')}
        </p>
      )}
      {plan.conflicts.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Overlaps: {plan.conflicts.map((conflict) => `${names.person(conflict.person_id)} on “${conflict.plan_title}”`).join(', ')}
        </p>
      )}
    </li>
  );
};

const OrderReview = ({ preview }: { preview: OrderOnlyReschedulePreview }) => (
  <div className="card space-y-3 p-4 text-sm">
    <Notices notices={preview.warnings} />
    <p>
      {preview.source.items.length} item(s) from <strong>{preview.source.title}</strong>
      {preview.remove_from_source ? ' move' : ' are copied'} to <strong>{preview.destination.title}</strong>
      {preview.items_mode === 'replace'
        ? `, replacing its ${preview.destination.items_removed} item(s).`
        : `, after its ${preview.destination.items_kept} item(s).`}
    </p>
    <p className="text-xs text-slate-500">{preview.source.items.join(' · ')}</p>
    <p>
      {preview.destination.title} keeps its roster: {preview.destination.roster_kept.confirmed} confirmed ·{' '}
      {preview.destination.roster_kept.unconfirmed} unconfirmed · {preview.destination.roster_kept.declined} declined ·{' '}
      {preview.destination.roster_kept.prepared} prepared.
    </p>
    <p className="text-slate-500">Not changed on either plan: {preview.unchanged.join(', ').replaceAll('_', ' ')}.</p>
  </div>
);

/**
 * F10 Pass C: move plans deliberately. Shifting whole plans moves their
 * dates and times (keeping local clock times) and keeps answers unless you
 * choose to reset them; moving the order only leaves both rosters alone.
 */
export const ReschedulePlansPage = () => {
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
      if (!preview) throw new Error('Review the change first');
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

  if (!canAnywhere('plans.edit')) return <EmptyState title="Rescheduling is for plan editors" />;

  if (done) {
    return (
      <div>
        <PageHeader title={done.replayed ? 'Already rescheduled' : 'Rescheduled'} subtitle={`${done.plan_ids.length} plan(s) changed; ${done.responses_reset} answer(s) reset.`} />
        <ul className="space-y-1">
          {done.plan_ids.map((id) => (
            <li key={id}>
              <Link className="text-brand-700 hover:underline" to={`/plans/${id}`}>
                {plans.data?.data.find((plan) => plan.id === id)?.title ?? 'Open plan'}
              </Link>
            </li>
          ))}
        </ul>
        <Button className="mt-4" variant="secondary" onClick={() => { setDone(null); clearReview(); setDates({}); }}>Reschedule more</Button>
      </div>
    );
  }

  const upcoming = plans.data?.data ?? [];
  const selected = Object.keys(dates);
  const shiftPreview = preview?.mode === 'shift' ? (preview as ShiftReschedulePreview) : null;
  const orderPreview = preview?.mode === 'order_only' ? (preview as OrderOnlyReschedulePreview) : null;

  return (
    <div>
      <PageHeader title="Reschedule plans" subtitle="Review exactly who and what changes before anything moves." />
      <fieldset className="mb-4 flex flex-wrap gap-4 text-sm">
        <legend className="label">What moves</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="reschedule-mode" checked={mode === 'shift'} onChange={() => { setMode('shift'); clearReview(); }} />
          Whole plans: dates, times and their scheduled people
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="reschedule-mode" checked={mode === 'order_only'} onChange={() => { setMode('order_only'); clearReview(); }} />
          Only the order of service, into another plan (both teams stay)
        </label>
      </fieldset>

      {mode === 'shift' ? (
        <div className="card space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label className="flex items-center gap-2">
              Move selected plans by
              <input aria-label="Days to move" type="number" min={-365} max={365} className="input w-24" value={shiftDays} onChange={(event) => setShiftDays(Number(event.target.value))} />
              days
            </label>
            <Button
              variant="secondary"
              className="!py-1 text-xs"
              disabled={selected.length === 0 || shiftDays === 0}
              onClick={() => {
                setDates(Object.fromEntries(selected.map((id) => {
                  const plan = upcoming.find((candidate) => candidate.id === id);
                  return [id, plan ? addLocalDays(browserDate(plan.service_date), shiftDays) : dates[id]!];
                })));
                clearReview();
              }}
            >
              Apply to selected
            </Button>
          </div>
          {upcoming.length === 0 ? <p className="text-sm text-slate-500">No upcoming plans.</p> : (
            <ul className="space-y-1">
              {upcoming.map((plan) => (
                <li key={plan.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-w-64 flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-slate-300"
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
                    <span className="font-medium">{plan.title}</span>
                    <span className="text-slate-500">{formatDateTime(plan.service_date)}</span>
                  </label>
                  {plan.id in dates && (
                    <input
                      aria-label={`New date for ${plan.title}`}
                      type="date"
                      className="input w-44"
                      value={dates[plan.id]}
                      onChange={(event) => { setDates({ ...dates, [plan.id]: event.target.value }); clearReview(); }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-slate-300" checked={notify} onChange={(event) => { setNotify(event.target.checked); clearReview(); }} />
            Re-send requests with the new time to released people
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300" checked={resetResponses} onChange={(event) => { setResetResponses(event.target.checked); clearReview(); }} />
            <span>
              Reset answers: confirmed and declined people become unconfirmed and must answer again.
              <span className="block text-xs text-slate-500">Off by default. Without it every answer stays as it is.</span>
            </span>
          </label>
        </div>
      ) : (
        <div className="card grid gap-3 p-5 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="order-source">Move the order from</label>
            <select id="order-source" className="input" value={sourceId} onChange={(event) => { setSourceId(event.target.value); clearReview(); }}>
              <option value="">Choose…</option>
              {upcoming.map((plan) => <option key={plan.id} value={plan.id}>{plan.title} · {formatDateTime(plan.service_date)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="order-destination">Into</label>
            <select id="order-destination" className="input" value={destinationId} onChange={(event) => { setDestinationId(event.target.value); clearReview(); }}>
              <option value="">Choose…</option>
              {upcoming.filter((plan) => plan.id !== sourceId).map((plan) => <option key={plan.id} value={plan.id}>{plan.title} · {formatDateTime(plan.service_date)}</option>)}
            </select>
          </div>
          <fieldset className="flex flex-wrap gap-4 text-sm sm:col-span-2">
            <legend className="label">The destination’s current order</legend>
            <label className="flex items-center gap-2"><input type="radio" name="items-mode" checked={itemsMode === 'append'} onChange={() => { setItemsMode('append'); clearReview(); }} /> Keep it; add after</label>
            <label className="flex items-center gap-2"><input type="radio" name="items-mode" checked={itemsMode === 'replace'} onChange={() => { setItemsMode('replace'); clearReview(); }} /> Replace it</label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="size-4 rounded border-slate-300" checked={removeFromSource} onChange={(event) => { setRemoveFromSource(event.target.checked); clearReview(); }} />
            Remove the items from the original plan (a move, not a copy)
          </label>
        </div>
      )}

      <ErrorNotice error={review.error} />
      <div className="mt-4 flex justify-end">
        <Button
          loading={review.isPending}
          disabled={mode === 'shift' ? selected.length === 0 : !sourceId || !destinationId}
          onClick={() => review.mutate()}
        >
          Review changes
        </Button>
      </div>

      {shiftPreview && (
        <section className="mt-6 space-y-3">
          <ul className="space-y-3">
            {shiftPreview.plans.map((plan) => <ShiftPlanReview key={plan.plan_id} plan={plan} timezone={shiftPreview.timezone} />)}
          </ul>
        </section>
      )}
      {orderPreview && <section className="mt-6"><OrderReview preview={orderPreview} /></section>}
      {preview && (
        <div className="mt-4 space-y-2">
          <ErrorNotice error={commit.error} />
          {commit.error instanceof ApiError && commit.error.code === 'template_preview_changed' && (
            <p className="text-sm text-amber-700">A plan changed since you reviewed it. Review again.</p>
          )}
          <div className="flex justify-end">
            <Button loading={commit.isPending} onClick={() => commit.mutate()}>
              {mode === 'shift' ? `Move ${shiftPreview?.plans.length ?? 0} plan(s)` : 'Move the order'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
