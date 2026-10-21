import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  MAX_PLAN_TIMES,
  PLAN_TIME_KINDS,
  localDateAt,
  movePlanTimeDraft,
  newPlanTimeDraft,
  planTimeDraftIsRepeated,
  planTimeDraftsFrom,
  planTimeEndsNextDay,
  planTimeImpactNeedsReview,
  resolvePlanTimeDrafts,
  unresolvedOrphans,
  updatePlanTimesBody,
  type AmbiguousTimeChoice,
  type AttendanceConflict,
  type OrphanResolutionAction,
  type PlanDetail,
  type PlanTimeDraft,
  type PlanTimeDraftProblemCode,
  type PlanTimeImpact,
  type PlanTimeKind,
  type PlanTimeRequest,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';
import { TimeImpactReview } from './TimeImpactReview';
import { ConflictList } from './attendance';

export interface EditTimesModalProps {
  open: boolean;
  plan: PlanDetail;
  onClose: () => void;
}

/** A preview and the exact time list it was made from. */
interface ReviewedTimes {
  impact: PlanTimeImpact;
  times: PlanTimeRequest[];
}

const newDraftId = (): string => globalThis.crypto?.randomUUID?.() ?? `draft-${Math.random().toString(36).slice(2)}`;

/** Problems a row's own wording explains; the rest use the generic "invalid" line. */
const ROW_PROBLEMS: readonly PlanTimeDraftProblemCode[] = ['start_skipped', 'end_skipped'];

/**
 * F04 / MOB-015: the plan's full time list. Times are entered on the
 * organization's clock with the shared resolver (the same rules as the app),
 * keep their ids across reorder and edits, and every save is previewed.
 */
export const EditTimesModal = ({ open, plan, onClose }: EditTimesModalProps) => {
  const { t } = useTranslation(['plans', 'common', 'templates']);
  const invalidate = useInvalidateOrg();
  const { user, organizationId } = useAuth();
  const timeZone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  // Keyed by plan id so reopening on a different plan starts from its times.
  const [drafts, setDrafts] = useState<PlanTimeDraft[]>(() => planTimeDraftsFrom(plan.times, timeZone));
  const [loadedPlanId, setLoadedPlanId] = useState(plan.id);

  if (loadedPlanId !== plan.id) {
    setLoadedPlanId(plan.id);
    setDrafts(planTimeDraftsFrom(plan.times, timeZone));
  }

  const [reviewed, setReviewed] = useState<ReviewedTimes | null>(null);
  const impact = reviewed?.impact ?? null;
  const [resolutions, setResolutions] = useState<Record<string, OrphanResolutionAction>>({});
  const [notify, setNotify] = useState(true);

  const resolution = useMemo(() => resolvePlanTimeDrafts(drafts, timeZone), [drafts, timeZone]);
  const problemFor = (id: string): PlanTimeDraftProblemCode | null =>
    resolution.ok ? null : resolution.problems.find((problem) => problem.id === id)?.code ?? null;
  const valid = resolution.ok;

  const close = () => {
    setReviewed(null);
    setResolutions({});
    setNotify(true);
    onClose();
  };

  // F04: every save is previewed; the commit carries the preview's hash, so
  // if who it affects changes in between the server refuses instead of
  // silently changing more requests than were reviewed.
  const commit = useMutation({
    mutationFn: (review: ReviewedTimes) =>
      api.updatePlan(plan.id, updatePlanTimesBody(review.times, { impact: review.impact, resolutions, notify })),
    onSuccess: async () => {
      await invalidate();
      close();
    },
  });

  const preview = useMutation({
    mutationFn: async (times: PlanTimeRequest[]): Promise<ReviewedTimes> => ({
      impact: await api.previewPlanTimes(plan.id, { times }),
      times,
    }),
    onSuccess: (result) => {
      commit.reset();
      if (planTimeImpactNeedsReview(result.impact)) {
        setReviewed(result);
        setResolutions({});
      } else {
        commit.mutate(result);
      }
    },
  });
  const startPreview = () => {
    if (resolution.ok) preview.mutate(resolution.times);
  };

  const staleImpact = commit.error instanceof ApiError && commit.error.code === 'time_impact_stale';
  // Resolving a request to "all times" widens it, so the server re-checks it.
  const commitConflicts: AttendanceConflict[] =
    commit.error instanceof ApiError && commit.error.code === 'scheduling_conflict'
      ? ((commit.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const nameOf = (personId: string): string =>
    impact?.assignments.find((assignment) => assignment.person_id === personId)?.person_name ?? t('common:fallback.someone');
  const unresolved = impact ? unresolvedOrphans(impact, resolutions).length > 0 : false;

  if (reviewed && impact) {
    return (
      <Modal open={open} title={t('editTimes.reviewTitle')} onClose={close}>
        <div className="space-y-4">
          <TimeImpactReview
            impact={impact}
            resolutions={resolutions}
            onResolve={(assignmentId, action) => {
              commit.reset();
              setResolutions((current) => ({ ...current, [assignmentId]: action }));
            }}
          />
          {impact.notify_people > 0 && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={notify} onChange={(event) => setNotify(event.target.checked)} />
              <span>
                {t('editTimes.notify')}
                {!notify && <span className="block text-xs text-slate-500">{t('editTimes.notifyOff')}</span>}
              </span>
            </label>
          )}
          <p className="text-xs text-slate-500">{t('editTimes.remindersRecomputed')}</p>
          {staleImpact ? (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
              {t('editTimes.staleImpact')}
            </p>
          ) : commitConflicts.length > 0 ? (
            <>
              <ConflictList conflicts={commitConflicts} nameOf={nameOf} />
              <p className="text-xs text-slate-500">
                {t('editTimes.conflictHint')}
              </p>
            </>
          ) : (
            <ErrorNotice error={commit.error} />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setReviewed(null)}>
              {t('common:actions.back')}
            </Button>
            {staleImpact ? (
              <Button loading={preview.isPending} onClick={() => preview.mutate(reviewed.times)}>
                {t('editTimes.reviewAgain')}
              </Button>
            ) : (
              <Button loading={commit.isPending} disabled={unresolved} onClick={() => commit.mutate(reviewed)}>
                {t('editTimes.saveTimes')}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const update = (id: string, patch: Partial<PlanTimeDraft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );
  const move = (index: number, direction: -1 | 1) =>
    setDrafts((current) => movePlanTimeDraft(current, index, direction) ?? current);

  return (
    <Modal open={open} title={t('editTimes.title')} onClose={close}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">{t('editTimes.timezoneHint', { timezone: timeZone })}</p>
        {drafts.length === 0 && (
          <p className="text-sm text-slate-400">
            {t('editTimes.empty')}
          </p>
        )}

        {drafts.map((draft, index) => {
          const problem = problemFor(draft.id);
          return (
            <div key={draft.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <select
                  aria-label={t('editTimes.kindFor', { number: index + 1 })}
                  className="input w-36"
                  value={draft.kind}
                  onChange={(event) => update(draft.id, { kind: event.target.value as PlanTimeKind })}
                >
                  {PLAN_TIME_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`timeKind.${kind}`)}
                    </option>
                  ))}
                </select>
                <input
                  aria-label={t('editTimes.labelFor', { number: index + 1 })}
                  className="input flex-1"
                  value={draft.name}
                  placeholder={t('editTimes.labelPlaceholder')}
                  maxLength={120}
                  onChange={(event) => update(draft.id, { name: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={t('editTimes.moveUp', { number: index + 1 })}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={t('editTimes.moveDown', { number: index + 1 })}
                  disabled={index === drafts.length - 1}
                  onClick={() => move(index, 1)}
                  className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={t('editTimes.removeTime', { number: index + 1 })}
                  onClick={() => setDrafts((current) => current.filter((d) => d.id !== draft.id))}
                  className="px-1 text-lg text-slate-400 hover:text-rose-500"
                >
                  ×
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label={t('editTimes.dateFor', { number: index + 1 })}
                  className="input flex-1"
                  value={draft.localDate}
                  onChange={(event) => update(draft.id, { localDate: event.target.value })}
                />
                <input
                  type="time"
                  aria-label={t('editTimes.startFor', { number: index + 1 })}
                  className="input w-28"
                  value={draft.localStart}
                  onChange={(event) => update(draft.id, { localStart: event.target.value })}
                />
                <span className="text-sm text-slate-500">{t('editTimes.to')}</span>
                <input
                  type="time"
                  aria-label={t('editTimes.endFor', { number: index + 1 })}
                  className="input w-28"
                  value={draft.localEnd}
                  onChange={(event) => update(draft.id, { localEnd: event.target.value })}
                />
                {planTimeEndsNextDay(draft) && <span className="text-xs text-slate-500">{t('editTimes.nextDay')}</span>}
              </div>
              {planTimeDraftIsRepeated(draft, timeZone) && (
                <label className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  {t('templates:generate.ambiguousLabel')}
                  <select
                    aria-label={t('editTimes.repeatedFor', { number: index + 1 })}
                    className="input w-40"
                    value={draft.ambiguous}
                    onChange={(event) => update(draft.id, { ambiguous: event.target.value as AmbiguousTimeChoice })}
                  >
                    <option value="earlier">{t('templates:generate.ambiguousEarlier')}</option>
                    <option value="later">{t('templates:generate.ambiguousLater')}</option>
                  </select>
                </label>
              )}
              {problem && ROW_PROBLEMS.includes(problem) && (
                <p role="alert" className="text-xs text-amber-700">
                  {t(problem === 'start_skipped' ? 'editTimes.startSkipped' : 'editTimes.endSkipped', { timezone: timeZone })}
                </p>
              )}
            </div>
          );
        })}

        <Button
          type="button"
          variant="secondary"
          disabled={drafts.length >= MAX_PLAN_TIMES}
          onClick={() =>
            setDrafts((current) => [...current, newPlanTimeDraft(newDraftId(), current.at(-1), localDateAt(Date.now(), timeZone))])}
        >
          {t('editTimes.addTime')}
        </Button>
        {drafts.length >= MAX_PLAN_TIMES && <p className="text-xs text-slate-500">{t('editTimes.tooMany', { max: MAX_PLAN_TIMES })}</p>}

        {!valid && resolution.problems.some((problem) => !ROW_PROBLEMS.includes(problem.code)) && (
          <p className="text-sm text-amber-600">{t('editTimes.invalid')}</p>
        )}
        <ErrorNotice error={preview.error ?? commit.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button loading={preview.isPending || commit.isPending} disabled={!valid} onClick={startPreview}>
            {t('editTimes.saveTimes')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
