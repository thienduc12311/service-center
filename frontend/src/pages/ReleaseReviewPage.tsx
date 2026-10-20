import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  DeliveryChannel,
  PreparedRequestListItem,
  ReleaseBatchPreview,
  ReleaseBatchSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { useInvalidateOrg, usePreparedRequests, useReleaseBatches } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { useFormatters } from '../i18n';

const CHANNELS: readonly DeliveryChannel[] = ['email', 'in_app', 'push'];
type ReleaseT = TFunction<['staffing', 'common']>;

const SKIP_CODES = ['no_email_address', 'no_login', 'recipient_not_eligible'] as const;
type SkipCode = (typeof SKIP_CODES)[number];
const isSkipCode = (code: string): code is SkipCode => (SKIP_CODES as readonly string[]).includes(code);
const skipText = (code: string, t: ReleaseT): string => (isSkipCode(code) ? t(`staffing:releaseReview.skip.${code}`) : code);

/** Release failure codes the server records (see `lib/reminders.ts`). */
const FAILURE_CODES = ['scope_changed', 'actor_not_permitted', 'internal_error'] as const;
type FailureCode = (typeof FAILURE_CODES)[number];
const isFailureCode = (code: string): code is FailureCode => (FAILURE_CODES as readonly string[]).includes(code);
const failureText = (code: string, t: ReleaseT): string => (isFailureCode(code) ? t(`staffing:releaseReview.failure.${code}`) : code);

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

interface ReleaseReviewModalProps {
  review: ReviewState;
  onClose: () => void;
  onDone: () => void;
}

const ReleaseReviewModal = ({ review, onClose, onDone }: ReleaseReviewModalProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { date, time } = useFormatters();
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
    <Modal open title={t('releaseReview.modalTitle')} onClose={onClose} size="wide">
      <p className="mb-3 text-sm text-slate-500">
        {t('releaseReview.modalIntro', {
          requests: t('releaseReview.requestCount', { count: review.preview.assignment_count }),
          plans: t('common:count.plans', { count: review.preview.plan_count }),
          people: t('common:count.people', { count: review.preview.recipients.length }),
        })}
      </p>
      <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
        {review.preview.recipients.map((recipient) => (
          <li key={recipient.person_id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <p className="font-medium">{recipient.person_name}</p>
            <p className="text-slate-500">
              {t('releaseReview.channels', {
                list: CHANNELS.filter((c) => recipient.channels[c]).map((c) => t(`deliveryChannel.${c}`)).join(t('common:format.listSeparator'))
                  || t('common:states.none'),
              })}
              {recipient.skipped.length > 0 && ` · ${recipient.skipped.map((code) => skipText(code, t)).join(t('common:format.listSeparator'))}`}
            </p>
            {recipient.plans.map((plan) => (
              <div key={plan.plan_id} className="mt-2">
                <p>{t('releaseReview.planWithDate', { plan: plan.plan_title, date: date(plan.service_date) })}</p>
                <ul className="ml-3 text-slate-600 dark:text-slate-400">
                  {plan.assignments.map((assignment) => (
                    <li key={assignment.assignment_id}>
                      {assignment.position_name
                        ? t('releaseReview.teamPosition', { team: assignment.team_name, position: assignment.position_name })
                        : assignment.team_name}
                      {assignment.untimed
                        ? ` · ${t('releaseReview.noTimes')}`
                        : assignment.times.length > 0 && ` · ${assignment.times
                          .map((item) => t('releaseReview.timeEntry', { name: item.name ?? t(`timeKind.${item.kind}`), time: time(item.starts_at) }))
                          .join(t('common:format.listSeparator'))}`}
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
          {t('releaseReview.notify')}
        </label>
        <div className="flex flex-wrap items-center gap-4" role="radiogroup" aria-label={t('releaseReview.when')}>
          <label className="flex items-center gap-2">
            <input type="radio" name="when" checked={mode === 'now'} onChange={() => setMode('now')} /> {t('releaseReview.releaseNow')}
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="when" checked={mode === 'scheduled'} onChange={() => setMode('scheduled')} /> {t('releaseReview.releaseAt')}
          </label>
          {mode === 'scheduled' && (
            <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-invalid={invalidWhen} />
          )}
        </div>
        {mode === 'scheduled' && (
          <p className="text-slate-500">
            {t('releaseReview.scheduledHint')}
          </p>
        )}
        {invalidWhen && <p className="text-red-600">{t('releaseReview.futureTime')}</p>}
        <ErrorNotice error={commit.error} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button loading={commit.isPending} disabled={invalidWhen} onClick={() => commit.mutate()}>
            {mode === 'now' ? t('releaseReview.release') : t('releaseReview.scheduleRelease')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

interface BatchRowProps {
  batch: ReleaseBatchSummary;
}

const BatchRow = ({ batch }: BatchRowProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime } = useFormatters();
  const invalidate = useInvalidateOrg();
  const cancel = useMutation({ mutationFn: () => api.cancelReleaseBatch(batch.id), onSuccess: invalidate });
  return (
    <li className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">{batch.plan_titles.join(t('common:format.listSeparator')) || t('common:count.plans', { count: batch.plan_count })}</p>
        <p className="text-slate-500">
          {t('releaseReview.requestCount', { count: batch.item_count })}
          {' · '}
          {batch.status === 'scheduled' ? t('releaseReview.releasesAt', { time: dateTime(batch.scheduled_for) })
            : batch.released_at ? t('releaseReview.releasedAt', { time: dateTime(batch.released_at) }) : dateTime(batch.created_at)}
          {!batch.notify && ` · ${t('releaseReview.withoutNotifications')}`}
        </p>
        {batch.failure_code && <p className="text-red-600">{failureText(batch.failure_code, t)}</p>}
        <ErrorNotice error={cancel.error} />
      </div>
      <div className="flex items-center gap-2">
        <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{t(`releaseReview.batchStatus.${batch.status}`)}</Badge>
        {batch.status === 'scheduled' && (
          <Button variant="secondary" loading={cancel.isPending} onClick={() => cancel.mutate()}>{t('common:actions.cancel')}</Button>
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
  const { t } = useTranslation(['staffing', 'common']);
  const { date } = useFormatters();
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
    return <EmptyState title={t('releaseReview.title')} description={t('releaseReview.noPermission')} />;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={t('releaseReview.title')}
        subtitle={t('releaseReview.subtitle')}
        actions={
          <Button disabled={selected.size === 0} loading={preview.isPending} onClick={() => preview.mutate()}>
            {selected.size === 0 ? t('releaseReview.reviewNone') : t('releaseReview.reviewCount', { count: selected.size })}
          </Button>
        }
      />
      <ErrorNotice error={preview.error} />

      <section className="card mt-4 p-5">
        <h2 className="mb-3 font-semibold">{t('releaseReview.preparedTitle')}</h2>
        {prepared.isLoading ? (
          <Loading />
        ) : byPlan.length === 0 ? (
          <p className="text-sm text-slate-500">{t('releaseReview.preparedEmpty', { count: 90 })}</p>
        ) : (
          <ul className="space-y-4">
            {byPlan.map(([planId, plan]) => {
              const ids = plan.items.map((item) => item.assignment_id);
              const all = ids.every((id) => selected.has(id));
              return (
                <li key={planId}>
                  <label className="flex items-center gap-2 font-medium">
                    <input type="checkbox" checked={all} onChange={(e) => toggle(ids, e.target.checked)} />
                    {t('releaseReview.planWithDate', { plan: plan.title, date: date(plan.date) })}
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
                          {item.position_name
                            ? t('releaseReview.personTeamPosition', { name: item.person_name, team: item.team_name, position: item.position_name })
                            : t('releaseReview.personTeam', { name: item.person_name, team: item.team_name })}
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
        <h2 className="mb-1 font-semibold">{t('releaseReview.releasesTitle')}</h2>
        <p className="mb-2 text-sm text-slate-500">{t('releaseReview.releasesHint')}</p>
        {batches.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {batches.data.map((batch) => <BatchRow key={batch.id} batch={batch} />)}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{t('releaseReview.releasesEmpty')}</p>
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
