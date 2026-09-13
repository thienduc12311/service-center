import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toISODate, type PlanDetail, type PlanTimeKind } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';

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

const pad = (value: number): string => String(value).padStart(2, '0');
const localTime = (iso: string): string => {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const draftsFrom = (plan: PlanDetail): TimeDraft[] =>
  plan.times.map((time) => ({
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

  const valid = drafts.every((draft) => draft.date && draft.from && draft.to && draft.to > draft.from);

  const save = useMutation({
    mutationFn: () =>
      api.updatePlan(plan.id, {
        times: drafts.map((draft) => ({
          kind: draft.kind,
          name: draft.name.trim() || null,
          starts_at: new Date(`${draft.date}T${draft.from}`).toISOString(),
          ends_at: new Date(`${draft.date}T${draft.to}`).toISOString(),
        })),
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const update = (id: string, patch: Partial<TimeDraft>) =>
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)),
    );

  return (
    <Modal open={open} title="Service & rehearsal times" onClose={onClose}>
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
          <p className="text-sm text-amber-600">Every time needs a date and must end after it starts.</p>
        )}
        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Save times
          </Button>
        </div>
      </div>
    </Modal>
  );
};
