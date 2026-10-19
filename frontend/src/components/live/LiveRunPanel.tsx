import { useState } from 'react';
import {
  LIVE_POLICY_LABELS,
  LIVE_STATUS_LABELS,
  formatLiveDuration,
  liveRunSchedule,
  previousRunnableIndex,
  type LiveCountdownPolicy,
  type LiveRunState,
  type LiveRunWarningCode,
  type LiveView,
} from '@service-center/shared';
import { Badge, Button, Modal } from '../ui';
import type { LiveConnection, LiveRunHandle } from './useLiveRun';

const STATUS_TONE: Record<LiveRunState['run']['status'], string> = {
  ready: 'bg-slate-50 text-slate-700 ring-slate-500/20',
  live: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  paused: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  ended: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  discarded: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

const WARNING_TEXT: Record<LiveRunWarningCode, string> = {
  plan_changed_since_snapshot: 'The plan order changed after this run pinned it. The run keeps the order it pinned.',
  service_time_moved: 'This service time was moved after the run was created. Timing still uses the time the run pinned.',
  service_time_removed: 'This service time was removed from the plan. The run and its history are kept.',
};

export const timeOfDay = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';

const ConnectionIndicator = ({ connection, secondsAgo }: { connection: LiveConnection; secondsAgo: number | null }) => {
  const text =
    connection === 'offline' ? `Offline — showing what was received ${secondsAgo ?? 0}s ago`
    : connection === 'stale' ? `Reconnecting — last updated ${secondsAgo ?? 0}s ago`
    : `Connected · updated ${secondsAgo ?? 0}s ago`;
  const dot = connection === 'live' ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500" role="status" aria-live="polite">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </p>
  );
};

/** The countdown line, honest about overruns and items without a length. */
export const Countdown = ({ view, large = false }: { view: LiveView; large?: boolean }) => {
  const size = large ? 'text-8xl' : 'text-5xl';
  if (!view.current) return null;
  if (view.remaining_seconds === null) {
    return (
      <div>
        <p className={`${size} font-semibold tabular-nums`}>{formatLiveDuration(view.elapsed_seconds)}</p>
        <p className="text-sm opacity-70">elapsed · no planned length</p>
      </div>
    );
  }
  if (view.overrun_seconds > 0) {
    return (
      <div>
        <p className={`${size} font-semibold tabular-nums text-rose-600`}>+{formatLiveDuration(view.overrun_seconds)}</p>
        <p className="text-sm text-rose-600">over · {LIVE_POLICY_LABELS[view.countdown_policy]}</p>
      </div>
    );
  }
  return (
    <div>
      <p className={`${size} font-semibold tabular-nums`}>{formatLiveDuration(view.remaining_seconds)}</p>
      <p className="text-sm opacity-70">remaining · {LIVE_POLICY_LABELS[view.countdown_policy]}</p>
    </div>
  );
};

const finishLine = (view: LiveView): string | null => {
  if (!view.planned_finish_at) return null;
  const planned = `Planned finish ${timeOfDay(view.planned_finish_at)}`;
  if (!view.projected_finish_at || view.finish_delta_seconds === null) return planned;
  const delta = view.finish_delta_seconds;
  const drift = delta === 0 ? 'on time' : delta > 0 ? `${formatLiveDuration(delta)} late` : `${formatLiveDuration(-delta)} early`;
  return `${planned} · projected ${timeOfDay(view.projected_finish_at)} (${drift})`;
};

type Confirm = 'end' | 'take_over' | 'discard' | null;

export interface LiveRunPanelProps {
  live: LiveRunHandle;
  onStage: () => void;
}

export const LiveRunPanel = ({ live, onStage }: LiveRunPanelProps) => {
  const { state, view, control } = live;
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [reason, setReason] = useState('');
  if (!state || !view || !control) return null;

  const { run } = state;
  const schedule = liveRunSchedule(run);
  const plannedStart = new Map(schedule.items.map((slot) => [slot.item_id, slot.starts_at]));
  const active = run.status === 'live' || run.status === 'paused';
  const over = run.status === 'ended' || run.status === 'discarded';
  const mine = control.held_by_you;
  const busy = live.pending !== null;
  const offline = live.connection === 'offline' || live.connection === 'revoked';
  const canAct = state.can_control && !offline;
  const previous = view.current_index === null ? null : previousRunnableIndex(run.snapshot, view.current_index);
  const close = () => {
    setConfirm(null);
    setReason('');
  };

  return (
    <section className="space-y-4" aria-label="Live run">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[run.status]}>{LIVE_STATUS_LABELS[run.status]}</Badge>
          <span className="text-sm text-slate-600">
            {run.time_name ?? 'Service'} · {new Date(run.time_starts_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        </div>
        <ConnectionIndicator connection={live.connection} secondsAgo={live.lastUpdatedSecondsAgo} />
      </div>

      {state.warnings.map((warning) => (
        <div key={warning.code} role="note" className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
          {WARNING_TEXT[warning.code]}
          {warning.code === 'plan_changed_since_snapshot' && run.status === 'ready' && mine && (
            <Button variant="secondary" className="ml-3" disabled={busy} onClick={() => live.send({ action: 'refresh_snapshot' })}>
              Use the current order
            </Button>
          )}
        </div>
      ))}

      {run.status === 'discarded' && (
        <p className="text-sm text-slate-600">Discarded: {run.discarded_reason}</p>
      )}

      <div className="card grid gap-6 p-6 md:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-2">
          {run.status === 'ready' && (
            <>
              <p className="text-sm text-slate-500">Not started. First up</p>
              <p className="text-3xl font-semibold text-slate-900">{view.next?.title ?? 'Nothing to run'}</p>
            </>
          )}
          {active && view.current && (
            <>
              {view.section && <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{view.section}</p>}
              <p className="text-3xl font-semibold text-slate-900">{view.current.title}</p>
              {run.status === 'paused' && <p className="text-sm font-medium text-amber-700">Paused</p>}
              <p className="text-sm text-slate-600">
                Next: {view.next ? view.next.title : 'nothing — the controller ends the run'}
              </p>
            </>
          )}
          {over && (
            <p className="text-lg text-slate-700">
              {run.status === 'ended' ? `Ended at ${timeOfDay(run.ended_at)}` : 'This run was discarded.'}
            </p>
          )}
          {finishLine(view) && <p className="text-sm text-slate-500">{finishLine(view)}</p>}
        </div>
        <div className="text-right text-slate-900">
          <Countdown view={view} />
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            {control.held_by_you
              ? `You are controlling this run (lease renews automatically; ${control.lease_seconds_left ?? 0}s left).`
              : control.held
                ? `${control.holder_name ?? 'Someone'} is controlling this run.`
                : over
                  ? 'Nobody controls a finished run.'
                  : 'Nobody is controlling this run.'}
          </p>
          <Button variant="secondary" onClick={onStage}>Stage display</Button>
        </div>

        {canAct && !over && !mine && (
          <div className="flex flex-wrap gap-2">
            {control.held ? (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm('take_over')}>
                Take over from {control.holder_name ?? 'the controller'}
              </Button>
            ) : (
              <Button disabled={busy} loading={live.pending?.action === 'take_control'} onClick={() => live.send({ action: 'take_control' })}>
                Take control
              </Button>
            )}
          </div>
        )}

        {canAct && mine && (
          <div className="flex flex-wrap items-center gap-2">
            {run.status === 'ready' && (
              <Button disabled={busy} loading={live.pending?.action === 'start'} onClick={() => live.send({ action: 'start' })}>
                Start
              </Button>
            )}
            {active && (
              <>
                <Button
                  variant="secondary"
                  disabled={busy || previous === null}
                  onClick={() => previous !== null && live.send({ action: 'jump', target_index: previous })}
                >
                  ← Back
                </Button>
                {run.status === 'live' ? (
                  <Button variant="secondary" disabled={busy} loading={live.pending?.action === 'pause'} onClick={() => live.send({ action: 'pause' })}>
                    Pause
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} loading={live.pending?.action === 'resume'} onClick={() => live.send({ action: 'resume' })}>
                    Resume
                  </Button>
                )}
                <Button disabled={busy || view.next === null} loading={live.pending?.action === 'advance'} onClick={() => live.send({ action: 'advance' })}>
                  Next →
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => setConfirm('end')}>End run</Button>
              </>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
              Countdown
              <select
                className="input w-auto"
                value={run.countdown_policy}
                disabled={busy}
                onChange={(event) => live.send({ action: 'set_policy', countdown_policy: event.target.value as LiveCountdownPolicy })}
              >
                {(Object.keys(LIVE_POLICY_LABELS) as LiveCountdownPolicy[]).map((policy) => (
                  <option key={policy} value={policy}>{LIVE_POLICY_LABELS[policy]}</option>
                ))}
              </select>
            </label>
            <Button variant="ghost" disabled={busy} onClick={() => live.send({ action: 'release_control' })}>Release control</Button>
          </div>
        )}

        {canAct && run.status !== 'discarded' && (run.status === 'ready' || run.status === 'ended' || mine) && (
          <Button variant="ghost" className="text-rose-700" disabled={busy} onClick={() => setConfirm('discard')}>
            Discard run…
          </Button>
        )}

        {live.pending && <p className="text-sm text-slate-500" role="status">Sending “{live.pending.action.replace('_', ' ')}”… not applied until the server confirms.</p>}
        {offline && state.can_control && <p className="text-sm text-amber-700">Commands are disabled while offline; nothing you press is queued.</p>}
        {live.commandError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-600/20">
            <span>{live.commandError}</span>
            {live.retry && <Button variant="secondary" onClick={live.retry}>Retry the same command</Button>}
            <Button variant="ghost" onClick={live.clearCommandError}>Dismiss</Button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <h3 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Order (as pinned)</h3>
        <ol>
          {run.snapshot.map((item, index) => {
            const isCurrent = view.current_index === index;
            const isHeader = item.item_type === 'header';
            const jumpable = canAct && mine && active && !isCurrent && !busy;
            return (
              <li
                key={item.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0 ${
                  isHeader ? 'bg-slate-50 font-semibold uppercase tracking-wide text-slate-500' : ''
                } ${isCurrent ? 'bg-emerald-50 font-semibold text-emerald-900' : ''}`}
              >
                <span className="w-16 shrink-0 tabular-nums text-xs text-slate-500">
                  {isHeader ? '' : new Date(plannedStart.get(item.id) ?? run.time_starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {!isHeader && <span className="tabular-nums text-xs text-slate-500">{formatLiveDuration(item.length_seconds)}</span>}
                {jumpable && (
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => live.send({ action: 'jump', target_index: index })}>
                    {isHeader ? 'Go to section' : 'Go here'}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Modal
        open={confirm !== null}
        title={confirm === 'end' ? 'End this run?' : confirm === 'take_over' ? 'Take over control?' : 'Discard this run?'}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button
              variant={confirm === 'take_over' ? 'primary' : 'danger'}
              disabled={confirm === 'discard' && reason.trim().length === 0}
              onClick={() => {
                if (confirm === 'end') live.send({ action: 'end' });
                if (confirm === 'take_over') live.send({ action: 'take_over', ...(reason.trim() ? { reason: reason.trim() } : {}) });
                if (confirm === 'discard') live.send({ action: 'discard', reason: reason.trim() });
                close();
              }}
            >
              {confirm === 'end' ? 'End run' : confirm === 'take_over' ? 'Take over' : 'Discard'}
            </Button>
          </>
        }
      >
        {confirm === 'end' && <p className="text-sm text-slate-600">Ending records the actual finish. Nobody can advance the run afterwards; recorded times can still be corrected.</p>}
        {confirm === 'take_over' && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{control.holder_name ?? 'The current controller'} will lose control immediately; their next command is refused. The takeover is recorded.</p>
            <label className="field">
              Reason (optional)
              <input className="input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        )}
        {confirm === 'discard' && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>The run and its history are kept but no longer count as this service’s run. You can then start a new run for the same service time.</p>
            <label className="field">
              Why? (required)
              <input className="input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
};
