import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  effectiveTransitionTimes,
  formatLiveDuration,
  isLiveTimingAction,
  type LiveRunHistory,
  type LiveRunTransitionRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useLiveRunHistory } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading, Modal } from '../ui';
import { timeOfDay } from './LiveRunPanel';

const ACTION_LABELS: Record<LiveRunTransitionRow['action'], string> = {
  create: 'Created',
  start: 'Started',
  advance: 'Next item',
  jump: 'Jumped',
  pause: 'Paused',
  resume: 'Resumed',
  end: 'Ended',
  take_control: 'Took control',
  take_over: 'Took over',
  release_control: 'Released control',
  set_policy: 'Changed countdown',
  refresh_snapshot: 'Pinned the current order',
  discard: 'Discarded',
};

/** `YYYY-MM-DDTHH:mm:ss` in the browser's timezone, for a datetime-local input. */
const toLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const variance = (seconds: number | null): string =>
  seconds === null ? '—' : seconds === 0 ? '0:00' : seconds > 0 ? `+${formatLiveDuration(seconds)}` : `-${formatLiveDuration(-seconds)}`;

interface CorrectionTarget {
  transition: LiveRunTransitionRow;
  effectiveMs: number;
}

export interface LiveHistoryPanelProps {
  runId: string;
  /** Refetch when the run's revision changes. */
  revision: number;
}

export const LiveHistoryPanel = ({ runId, revision }: LiveHistoryPanelProps) => {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const history = useLiveRunHistory(runId, true);
  const [target, setTarget] = useState<CorrectionTarget | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const correct = useMutation({
    mutationFn: (input: { transitionId: number; correctedAt: string; reason: string; expectedRevision: number }) =>
      api.correctLiveRunTime(runId, {
        transition_id: input.transitionId,
        corrected_at: input.correctedAt,
        reason: input.reason,
        expected_revision: input.expectedRevision,
      }),
    onSuccess: (next: LiveRunHistory) => {
      queryClient.setQueryData(keys.liveRunHistory(organizationId, runId), next);
      void queryClient.invalidateQueries({ queryKey: keys.liveRun(organizationId, runId) });
      setTarget(null);
    },
  });

  const data = history.data;
  const heldRevision = data?.run.revision;
  const { refetch } = history;
  // The run moved on (another client advanced or corrected it): reload the history.
  useEffect(() => {
    if (heldRevision !== undefined && heldRevision !== revision) void refetch();
  }, [heldRevision, revision, refetch]);
  if (history.isLoading) return <Loading label="Loading history…" />;
  if (history.error) return <ErrorNotice error={history.error} />;
  if (!data) return null;

  const { actuals } = data;
  const effective = effectiveTransitionTimes(data.transitions, data.corrections);
  const canCorrect = data.can_control && data.run.status === 'ended';

  return (
    <section className="space-y-4" aria-label="Run history">
      <div className="card overflow-x-auto">
        <h3 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
          Planned versus actual{actuals.corrected ? ' (includes corrected times)' : ''}
        </h3>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Started</th>
              <th className="px-4 py-2 text-right font-medium">Planned</th>
              <th className="px-4 py-2 text-right font-medium">Actual</th>
              <th className="px-4 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {actuals.items.map((line) =>
              line.item_type === 'header' ? (
                <tr key={line.item_id} className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <td className="px-4 py-1.5" colSpan={5}>{line.title}</td>
                </tr>
              ) : (
                <tr key={line.item_id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    {line.title}
                    {line.segment !== 'service' && <span className="ml-2 text-xs text-slate-500">({line.segment === 'pre' ? 'before' : 'after'} service)</span>}
                    {line.visits > 1 && <span className="ml-2 text-xs text-slate-500">×{line.visits}</span>}
                  </td>
                  <td className="px-4 py-2 tabular-nums text-slate-600">{line.first_started_at ? timeOfDay(line.first_started_at) : 'not run'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatLiveDuration(line.planned_seconds)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{line.visits > 0 ? formatLiveDuration(line.actual_seconds) : '—'}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${(line.variance_seconds ?? 0) > 0 ? 'text-rose-700' : 'text-slate-600'}`}>
                    {variance(line.variance_seconds)}
                  </td>
                </tr>
              ),
            )}
          </tbody>
          <tfoot className="border-t border-slate-200 text-slate-700">
            <tr>
              <td className="px-4 py-2 font-medium" colSpan={2}>Service items</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatLiveDuration(actuals.planned_service_seconds)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatLiveDuration(actuals.actual_service_seconds)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{variance(actuals.actual_service_seconds - actuals.planned_service_seconds)}</td>
            </tr>
            {actuals.elapsed_seconds !== null && (
              <tr>
                <td className="px-4 pb-3 text-xs text-slate-500" colSpan={5}>
                  {timeOfDay(actuals.started_at)} – {timeOfDay(actuals.ended_at)} · {formatLiveDuration(actuals.elapsed_seconds)} start to end
                  {actuals.paused_seconds > 0 ? `, including ${formatLiveDuration(actuals.paused_seconds)} paused` : ''}
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Transitions</h3>
        {canCorrect && <p className="px-4 pt-2 text-xs text-slate-500">Correcting a time adds a record (who, why, previous value); the original entry stays.</p>}
        <ol className="divide-y divide-slate-100 text-sm">
          {data.transitions.map((t) => {
            const fixes = data.corrections.filter((c) => c.transition_id === t.id);
            const at = effective.get(t.id) ?? Date.parse(t.occurred_at);
            const item = t.to_index !== null ? data.run.snapshot[t.to_index]?.title : null;
            return (
              <li key={t.id} className="flex flex-wrap items-start gap-3 px-4 py-2">
                <span className="w-24 shrink-0 tabular-nums text-slate-600">{timeOfDay(new Date(at).toISOString())}</span>
                <div className="min-w-0 flex-1">
                  <p>
                    {ACTION_LABELS[t.action]}
                    {item && (t.action === 'start' || t.action === 'advance' || t.action === 'jump') ? ` → ${item}` : ''}
                    <span className="text-slate-500"> · {t.actor_name ?? 'Someone'}</span>
                  </p>
                  {t.reason && <p className="text-xs text-slate-500">“{t.reason}”</p>}
                  {fixes.map((fix) => (
                    <p key={fix.id} className="text-xs text-amber-800">
                      Corrected from {timeOfDay(fix.previous_at)} to {timeOfDay(fix.corrected_at)} by {fix.actor_name ?? 'someone'}: “{fix.reason}”
                    </p>
                  ))}
                </div>
                {canCorrect && isLiveTimingAction(t.action) && (
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() => {
                      setTarget({ transition: t, effectiveMs: at });
                      setValue(toLocalInput(at));
                      setReason('');
                      correct.reset();
                    }}
                  >
                    Correct time
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Modal
        open={target !== null}
        title="Correct a recorded time"
        onClose={() => setTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
            <Button
              loading={correct.isPending}
              disabled={!value || reason.trim().length === 0 || Number.isNaN(new Date(value).getTime())}
              onClick={() =>
                target &&
                correct.mutate({
                  transitionId: target.transition.id,
                  correctedAt: new Date(value).toISOString(),
                  reason: reason.trim(),
                  expectedRevision: data.run.revision,
                })
              }
            >
              Save correction
            </Button>
          </>
        }
      >
        {target && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              {ACTION_LABELS[target.transition.action]} was recorded at {timeOfDay(new Date(target.effectiveMs).toISOString())}. The new
              time must stay between the entries before and after it. Times are in your browser’s timezone
              ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
            </p>
            <label className="field">
              Actual time
              <input type="datetime-local" step={1} className="input" value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
            <label className="field">
              Why? (required)
              <input className="input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
            <ErrorNotice error={correct.error} />
          </div>
        )}
      </Modal>
    </section>
  );
};
