import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  toISODate,
  type AttendanceConflict,
  type OrphanResolutionAction,
  type PlanDetail,
  type PlanTimeImpact,
  type PlanTimeKind,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';
import { TimeImpactReview } from './TimeImpactReview';
import { ConflictList } from './attendance';

export interface EditTimesModalProps {
  open: boolean;
  plan: PlanDetail;
  onClose: () => void;
}

/** One editable row: the native inputs work in local date/time strings. */
interface TimeDraft {
  id: string;
  kind: PlanTimeKind;
  name: string;
  date: string;
  from: string;
  to: string;
}

const TIME_KIND_LABELS: Record<PlanTimeKind, string> = {
  service: 'Service',
  rehearsal: 'Rehearsal',
  other: 'Other',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** An end at or before the start means the time runs past midnight. */
const endsNextDay = (draft: TimeDraft): boolean => Boolean(draft.from && draft.to) && draft.to < draft.from;

const toPayload = (drafts: readonly TimeDraft[]) =>
  drafts.map((draft, index) => {
    const startsAt = new Date(`${draft.date}T${draft.from}`);
    const sameDayEnd = new Date(`${draft.date}T${draft.to}`);
    const endsAt = endsNextDay(draft) ? new Date(sameDayEnd.getTime() + DAY_MS) : sameDayEnd;
    return {
      id: draft.id,
      kind: draft.kind,
      name: draft.name.trim() || null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      sort_order: index,
    };
  });

/** Nothing anyone is asked to attend moves: save without a review step. */
const needsReview = (impact: PlanTimeImpact): boolean =>
  impact.assignments.length > 0 || impact.hidden_affected > 0 || impact.live_requests > 0;

const pad = (value: number): string => String(value).padStart(2, '0');
const localTime = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const draftsFrom = (plan: PlanDetail): TimeDraft[] =>
  [...plan.times].sort((a, b) => a.sort_order - b.sort_order).map((time) => ({
    id: time.id,
    kind: time.kind,
    name: time.name ?? '',
    date: toISODate(time.starts_at),
    from: localTime(time.starts_at),
    to: localTime(time.ends_at),
  }));

const newDraft = (like?: TimeDraft): TimeDraft => ({
  id: globalThis.crypto?.randomUUID?.() ?? `draft-${Math.random().toString(36).slice(2)}`,
  kind: 'service',
  name: '',
  date: like?.date ?? toISODate(new Date()),
  from: like?.from ?? '10:00',
  to: like?.to ?? '12:00',
});

export const EditTimesModal = ({ open, plan, onClose }: EditTimesModalProps) => {
  const invalidate = useInvalidateOrg();
  // Keyed by plan id so reopening on a different plan starts from its times.
  const [drafts, setDrafts] = useState<TimeDraft[]>(() => draftsFrom(plan));
  const [loadedPlanId, setLoadedPlanId] = useState(plan.id);

  if (loadedPlanId !== plan.id) {
    setLoadedPlanId(plan.id);
    setDrafts(draftsFrom(plan));
  }

  const [impact, setImpact] = useState<PlanTimeImpact | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, OrphanResolutionAction>>({});

  const valid = drafts.every((draft) => draft.date && draft.from && draft.to && draft.to !== draft.from);

  const close = () => {
    setImpact(null);
    setResolutions({});
    onClose();
  };

  // F04: every save is previewed; the commit carries the preview's hash, so
  // if who it affects changes in between the server refuses instead of
  // silently changing more requests than were reviewed.
  const commit = useMutation({
    mutationFn: (reviewed: PlanTimeImpact) =>
      api.updatePlan(plan.id, {
        times: toPayload(drafts),
        expected_revision: plan.content_revision,
        time_impact_hash: reviewed.impact_hash,
        orphan_resolutions: reviewed.assignments
          .filter((assignment) => assignment.orphaned)
          .map((assignment) => ({ assignment_id: assignment.assignment_id, action: resolutions[assignment.assignment_id] })),
      }),
    onSuccess: async () => {
      await invalidate();
      close();
    },
  });

  const preview = useMutation({
    mutationFn: () => api.previewPlanTimes(plan.id, { times: toPayload(drafts) }),
    onSuccess: (result) => {
      commit.reset();
      if (needsReview(result)) {
        setImpact(result);
        setResolutions({});
      } else {
        commit.mutate(result);
      }
    },
  });

  const staleImpact = commit.error instanceof ApiError && commit.error.code === 'time_impact_stale';
  // Resolving a request to "all times" widens it, so the server re-checks it.
  const commitConflicts: AttendanceConflict[] =
    commit.error instanceof ApiError && commit.error.code === 'scheduling_conflict'
      ? ((commit.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const nameOf = (personId: string): string =>
    impact?.assignments.find((assignment) => assignment.person_id === personId)?.person_name ?? 'Someone';
  const unresolved = impact?.assignments.some((assignment) => assignment.orphaned && !resolutions[assignment.assignment_id]) ?? false;

  if (impact) {
    return (
      <Modal open={open} title="Review time changes" onClose={close}>
        <div className="space-y-4">
          <TimeImpactReview
            impact={impact}
            resolutions={resolutions}
            onResolve={(assignmentId, action) => {
              commit.reset();
              setResolutions((current) => ({ ...current, [assignmentId]: action }));
            }}
          />
          {staleImpact ? (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
              Who this change affects has changed since you reviewed it. Review it again before saving.
            </p>
          ) : commitConflicts.length > 0 ? (
            <>
              <ConflictList conflicts={commitConflicts} nameOf={nameOf} />
              <p className="text-xs text-slate-500">
                Keeping a request for all times would overlap the above. Choose “Remove the request”, or change its
                times from the Teams tab afterwards.
              </p>
            </>
          ) : (
            <ErrorNotice error={commit.error} />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setImpact(null)}>
              Back
            </Button>
            {staleImpact ? (
              <Button loading={preview.isPending} onClick={() => preview.mutate()}>
                Review again
              </Button>
            ) : (
              <Button loading={commit.isPending} disabled={unresolved} onClick={() => commit.mutate(impact)}>
                Save times
              </Button>
            )}
          </div>
        </div>
      </Modal>
    );
  }

  const update = (id: string, patch: Partial<TimeDraft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );

  return (
    <Modal open={open} title="Service & rehearsal times" onClose={close}>
      <div className="space-y-3">
        {drafts.length === 0 && (
          <p className="text-sm text-slate-400">
            This plan has no times yet — a plan without a service time never reaches the calendar.
          </p>
        )}

        {drafts.map((draft, index) => (
          <div key={draft.id} className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <select
                aria-label={`Kind for time ${index + 1}`}
                className="input w-36"
                value={draft.kind}
                onChange={(event) => update(draft.id, { kind: event.target.value as PlanTimeKind })}
              >
                {Object.entries(TIME_KIND_LABELS).map(([kind, label]) => (
                  <option key={kind} value={kind}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Label for time ${index + 1}`}
                className="input flex-1"
                value={draft.name}
                placeholder="Label (optional)"
                maxLength={120}
                onChange={(event) => update(draft.id, { name: event.target.value })}
              />
              <button
                type="button"
                aria-label={`Remove time ${index + 1}`}
                onClick={() => setDrafts((current) => current.filter((d) => d.id !== draft.id))}
                className="px-1 text-lg text-slate-400 hover:text-rose-500"
              >
                ×
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label={`Date for time ${index + 1}`}
                className="input flex-1"
                value={draft.date}
                onChange={(event) => update(draft.id, { date: event.target.value })}
              />
              <input
                type="time"
                aria-label={`Start for time ${index + 1}`}
                className="input w-28"
                value={draft.from}
                onChange={(event) => update(draft.id, { from: event.target.value })}
              />
              <span className="text-sm text-slate-500">to</span>
              <input
                type="time"
                aria-label={`End for time ${index + 1}`}
                className="input w-28"
                value={draft.to}
                onChange={(event) => update(draft.id, { to: event.target.value })}
              />
              {endsNextDay(draft) && <span className="text-xs text-slate-500">next day</span>}
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="secondary"
          onClick={() => setDrafts((current) => [...current, newDraft(current.at(-1))])}
        >
          + Add a time
        </Button>

        {!valid && (
          <p className="text-sm text-amber-600">Every time needs a date, a start and a different end.</p>
        )}
        <ErrorNotice error={preview.error ?? commit.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button loading={preview.isPending || commit.isPending} disabled={!valid} onClick={() => preview.mutate()}>
            Save times
          </Button>
        </div>
      </div>
    </Modal>
  );
};
