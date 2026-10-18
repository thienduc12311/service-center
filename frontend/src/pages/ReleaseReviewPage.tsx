import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DELIVERY_CHANNEL_LABELS,
  RELEASE_BATCH_STATUS_LABELS,
  formatDate,
  formatDateTime,
  formatTime,
  releaseFailureLabel,
  type DeliveryChannel,
  type PreparedRequestListItem,
  type ReleaseBatchPreview,
  type ReleaseBatchSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useInvalidateOrg, usePreparedRequests, useReleaseBatches } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';

const CHANNELS: readonly DeliveryChannel[] = ['email', 'in_app', 'push'];
const SKIP_LABELS: Record<string, string> = {
  no_email_address: 'no email address',
  no_login: 'no login (in-app and push skipped)',
  recipient_not_eligible: 'not an active member',
};

/** `datetime-local` value one hour from now, in the browser's zone. */
const defaultScheduleValue = (): string => {
  const at = new Date(Date.now() + 60 * 60 * 1000);
  at.setSeconds(0, 0);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

interface ReviewState {
  preview: ReleaseBatchPreview;
  /** One key per review, so a retried click never releases twice. */
  idempotencyKey: string;
}

const ReleaseReviewModal = ({ review, onClose, onDone }: { review: ReviewState; onClose: () => void; onDone: () => void }) => {
  const [notify, setNotify] = useState(true);
  const [mode, setMode] = useState<'now' | 'scheduled'>('now');
  const [when, setWhen] = useState(defaultScheduleValue);
  const scheduledFor = mode === 'scheduled' ? new Date(when) : null;
  const invalidWhen = Boolean(scheduledFor && (Number.isNaN(scheduledFor.getTime()) || scheduledFor.getTime() <= Date.now()));

  const commit = useMutation({
    mutationFn: () => api.createReleaseBatch({
      items: review.preview.recipients.flatMap((recipient) => recipient.plans.flatMap((plan) =>
        plan.assignments.map((a) => ({ assignment_id: a.assignment_id, request_revision: a.request_revision })))),
      notify,
      scheduled_for: scheduledFor ? scheduledFor.toISOString() : null,
      idempotency_key: review.idempotencyKey,
    }),
    onSuccess: onDone,
  });

  return (
    <Modal open title="Review release" onClose={onClose} size="wide">
      <p className="mb-3 text-sm text-slate-500">
        {review.preview.assignment_count} request{review.preview.assignment_count === 1 ? '' : 's'} on {review.preview.plan_count} plan
        {review.preview.plan_count === 1 ? '' : 's'} for {review.preview.recipients.length} people. Each person gets one message; every plan
        in it has its own response action, so answering one plan never answers another.
      </p>
      <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {review.preview.recipients.map((recipient) => (
          <li key={recipient.person_id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-medium">{recipient.person_name}</p>
            <p className="text-slate-500">
              Channels: {CHANNELS.filter((c) => recipient.channels[c]).map((c) => DELIVERY_CHANNEL_LABELS[c]).join(', ') || 'none'}
              {recipient.skipped.length > 0 && ` · ${recipient.skipped.map((code) => SKIP_LABELS[code] ?? code).join(', ')}`}
            </p>
            {recipient.plans.map((plan) => (
              <div key={plan.plan_id} className="mt-2">
                <p>{plan.plan_title} · {formatDate(plan.service_date)}</p>
                <ul className="ml-3 text-slate-600 dark:text-slate-400">
                  {plan.assignments.map((assignment) => (
                    <li key={assignment.assignment_id}>
                      {assignment.team_name}{assignment.position_name ? ` — ${assignment.position_name}` : ''}
                      {assignment.untimed
                        ? ' · no times set'
                        : assignment.times.length > 0 && ` · ${assignment.times.map((t) => `${t.name ?? t.kind} ${formatTime(t.starts_at)}`).join(', ')}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <div className="mt-4 space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify people when released
        </label>
        <div className="flex flex-wrap items-center gap-4" role="radiogroup" aria-label="When">
          <label className="flex items-center gap-2">
            <input type="radio" name="when" checked={mode === 'now'} onChange={() => setMode('now')} /> Release now
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="when" checked={mode === 'scheduled'} onChange={() => setMode('scheduled')} /> Release at
          </label>
          {mode === 'scheduled' && (
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={invalidWhen} />
          )}
        </div>
        {mode === 'scheduled' && (
          <p className="text-slate-500">
            Requests stay private until then. If any of them changes before that time, nothing is released and you will
            see why here.
          </p>
        )}
        {invalidWhen && <p className="text-red-600">Choose a time in the future.</p>}
        <ErrorNotice error={commit.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={commit.isPending} disabled={invalidWhen} onClick={() => commit.mutate()}>
            {mode === 'now' ? 'Release' : 'Schedule release'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

const BatchRow = ({ batch }: { batch: ReleaseBatchSummary }) => {
  const invalidate = useInvalidateOrg();
  const cancel = useMutation({ mutationFn: () => api.cancelReleaseBatch(batch.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{batch.plan_titles.join(', ') || `${batch.plan_count} plans`}</p>
        <p className="text-slate-500">
          {batch.item_count} request{batch.item_count === 1 ? '' : 's'} ·{' '}
          {batch.status === 'scheduled' ? `releases ${formatDateTime(batch.scheduled_for)}`
            : batch.released_at ? `released ${formatDateTime(batch.released_at)}` : formatDateTime(batch.created_at)}
          {!batch.notify && ' · without notifications'}
        </p>
        {batch.failure_code && <p className="text-red-600">{releaseFailureLabel(batch.failure_code)}</p>}
        <ErrorNotice error={cancel.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{RELEASE_BATCH_STATUS_LABELS[batch.status]}</Badge>
        {batch.status === 'scheduled' && (
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel</Button>
        )}
      </div>
    </li>
  );
};

/**
 * F08: release prepared requests from several plans at once, now or at a
 * scheduled time. Volunteers see nothing until the release actually runs.
 */
export const ReleaseReviewPage = () => {
  const { canAnywhere } = useAuth();
  const allowed = canAnywhere('scheduling.manage');
  const prepared = usePreparedRequests(allowed);
  const batches = useReleaseBatches(allowed);
  const invalidate = useInvalidateOrg();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<ReviewState | null>(null);

  const byPlan = useMemo(() => {
    const plans = new Map<string, { title: string; date: string; items: PreparedRequestListItem[] }>();
    for (const item of prepared.data ?? []) {
      const entry = plans.get(item.plan_id) ?? { title: item.plan_title, date: item.service_date, items: [] };
      entry.items.push(item);
      plans.set(item.plan_id, entry);
    }
    return [...plans.entries()];
  }, [prepared.data]);

  const preview = useMutation({
    mutationFn: () => api.previewReleaseBatch({ assignment_ids: [...selected] }),
    onSuccess: (data) => setReview({ preview: data, idempotencyKey: `release-${crypto.randomUUID()}` }),
  });

  const toggle = (ids: readonly string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  if (!allowed) {
    return <EmptyState title="Release review" description="You need scheduling permission to release requests." />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Release review"
        subtitle="Prepared requests are private. Choose what to release; people get one message with a separate response for each plan."
        actions={
          <Button disabled={selected.size === 0} loading={preview.isPending} onClick={() => preview.mutate()}>
            Review {selected.size || ''} request{selected.size === 1 ? '' : 's'}
          </Button>
        }
      />
      <ErrorNotice error={preview.error} />

      <section className="card mt-4 p-5">
        <h2 className="mb-3 font-semibold">Prepared requests</h2>
        {prepared.isLoading ? (
          <Loading />
        ) : byPlan.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing is waiting to be released in the next 90 days.</p>
        ) : (
          <ul className="space-y-4">
            {byPlan.map(([planId, plan]) => {
              const ids = plan.items.map((item) => item.assignment_id);
              const all = ids.every((id) => selected.has(id));
              return (
                <li key={planId}>
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                    {plan.title} · {formatDate(plan.date)}
                  </label>
                  <ul className="ml-6 mt-1 space-y-1 text-sm">
                    {plan.items.map((item) => (
                      <li key={item.assignment_id}>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected.has(item.assignment_id)}
                            onChange={(e) => toggle([item.assignment_id], e.target.checked)}
                          />
                          {item.person_name} — {item.team_name}{item.position_name ? ` · ${item.position_name}` : ''}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
        <ErrorNotice error={prepared.error} />
      </section>

      <section className="card mt-4 p-5">
        <h2 className="mb-1 font-semibold">Releases</h2>
        <p className="mb-2 text-sm text-slate-500">Scheduled releases run when due if the delivery worker is running.</p>
        {batches.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {batches.data.map((batch) => <BatchRow key={batch.id} batch={batch} />)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No releases yet.</p>
        )}
        <ErrorNotice error={batches.error} />
      </section>

      {review && (
        <ReleaseReviewModal
          review={review}
          onClose={() => setReview(null)}
          onDone={async () => {
            setReview(null);
            setSelected(new Set());
            await invalidate();
          }}
        />
      )}
    </div>
  );
};
