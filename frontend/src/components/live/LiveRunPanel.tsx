import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  formatLiveDuration,
  liveRunSchedule,
  previousRunnableIndex,
  type LiveCountdownPolicy,
  type LiveRunState,
  type LiveRunWarningCode,
  type LiveView,
} from '@service-center/shared';
import { Badge, Button, Modal } from '../ui';
import { Icon } from '../icons';
import { useLiveRefusalText, type LiveConnection, type LiveRunHandle } from './useLiveRun';
import { useFormatters, useLanguage } from '../../i18n';

/** Every countdown policy, in the order the picker shows them. */
export const LIVE_POLICIES: readonly LiveCountdownPolicy[] = ['item', 'planned_end', 'service_end'];

const STATUS_TONE: Record<LiveRunState['run']['status'], string> = {
  ready: 'bg-slate-50 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200',
  live: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300',
  paused: 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300',
  ended: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  discarded: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300',
};

const WARNING_KEYS: Record<LiveRunWarningCode, 'live.warnings.planChanged' | 'live.warnings.timeMoved' | 'live.warnings.timeRemoved'> = {
  plan_changed_since_snapshot: 'live.warnings.planChanged',
  service_time_moved: 'live.warnings.timeMoved',
  service_time_removed: 'live.warnings.timeRemoved',
};

/**
 * Wall-clock time with seconds ("9:41:07 AM"), in the displayed language and
 * the viewer's timezone — Live timing is second-precise, which the shared
 * formatter presets do not cover.
 */
export const useTimeOfDay = (): ((iso: string | null) => string) => {
  const { formatLocale } = useLanguage();
  return useCallback(
    (iso: string | null) => {
      if (!iso) return '—';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat(formatLocale, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
    },
    [formatLocale],
  );
};

interface ConnectionIndicatorProps {
  connection: LiveConnection;
  secondsAgo: number | null;
}

const ConnectionIndicator = ({ connection, secondsAgo }: ConnectionIndicatorProps) => {
  const { t } = useTranslation('media');
  const count = secondsAgo ?? 0;
  const text =
    connection === 'offline' ? t('live.connection.offline', { count })
    : connection === 'stale' ? t('live.connection.stale', { count })
    : t('live.connection.live', { count });
  const dot = connection === 'live' ? 'bg-emerald-500' : 'bg-amber-500';
  return (
    <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400" role="status" aria-live="polite">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden="true" />
      {text}
    </p>
  );
};

/** The countdown line, honest about overruns and items without a length. */
export interface CountdownProps {
  view: LiveView;
  large?: boolean;
}

export const Countdown = ({ view, large = false }: CountdownProps) => {
  const { t } = useTranslation('media');
  const size = large ? 'text-8xl' : 'text-5xl';
  if (!view.current) return null;
  if (view.remaining_seconds === null) {
    return (
      <div>
        <p className={`${size} font-semibold tabular-nums`}>{formatLiveDuration(view.elapsed_seconds)}</p>
        <p className="text-sm opacity-70">{t('live.countdown.elapsed')}</p>
      </div>
    );
  }
  if (view.overrun_seconds > 0) {
    return (
      <div>
        <p className={`${size} font-semibold tabular-nums text-rose-600 dark:text-rose-400`}>+{formatLiveDuration(view.overrun_seconds)}</p>
        <p className="text-sm text-rose-600 dark:text-rose-400">{t('live.countdown.over', { policy: t(`live.policies.${view.countdown_policy}`) })}</p>
      </div>
    );
  }
  return (
    <div>
      <p className={`${size} font-semibold tabular-nums`}>{formatLiveDuration(view.remaining_seconds)}</p>
      <p className="text-sm opacity-70">{t('live.countdown.remaining', { policy: t(`live.policies.${view.countdown_policy}`) })}</p>
    </div>
  );
};

const finishLine = (view: LiveView, t: TFunction<'media'>, timeOfDay: (iso: string | null) => string): string | null => {
  if (!view.planned_finish_at) return null;
  const planned = timeOfDay(view.planned_finish_at);
  if (!view.projected_finish_at || view.finish_delta_seconds === null) return t('live.finish.planned', { time: planned });
  const delta = view.finish_delta_seconds;
  const values = { planned, projected: timeOfDay(view.projected_finish_at) };
  if (delta === 0) return t('live.finish.onTime', values);
  return delta > 0
    ? t('live.finish.late', { ...values, delta: formatLiveDuration(delta) })
    : t('live.finish.early', { ...values, delta: formatLiveDuration(-delta) });
};

type Confirm = 'end' | 'take_over' | 'discard' | null;

export interface LiveRunPanelProps {
  live: LiveRunHandle;
  onStage: () => void;
}

export const LiveRunPanel = ({ live, onStage }: LiveRunPanelProps) => {
  const { t } = useTranslation(['media', 'common']);
  const formatters = useFormatters();
  const timeOfDay = useTimeOfDay();
  const refusalText = useLiveRefusalText();
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
    <section className="space-y-4" aria-label={t('live.panelLabel')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[run.status]}>{t(`live.status.${run.status}`)}</Badge>
          <span className="text-sm text-slate-600 dark:text-slate-300">
            {run.time_name ?? t('live.service')} · {formatters.dateTime(run.time_starts_at, { dateStyle: 'medium' })}
          </span>
        </div>
        <ConnectionIndicator connection={live.connection} secondsAgo={live.lastUpdatedSecondsAgo} />
      </div>

      {state.warnings.map((warning) => (
        <div
          key={warning.code}
          role="note"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25"
        >
          <Icon name="alert" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{t(WARNING_KEYS[warning.code])}</span>
          {warning.code === 'plan_changed_since_snapshot' && run.status === 'ready' && mine && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => live.send({ action: 'refresh_snapshot' })}>
              {t('live.useCurrentOrder')}
            </Button>
          )}
        </div>
      ))}

      {run.status === 'discarded' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('live.discardedReason', { reason: run.discarded_reason })}</p>
      )}

      <div className="card grid gap-6 border-t-4 border-t-brand-500 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-2">
          {run.status === 'ready' && (
            <>
              <p className="section-label">{t('live.notStarted')}</p>
              <p className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">{view.next?.title ?? t('live.nothingToRun')}</p>
            </>
          )}
          {active && view.current && (
            <>
              {view.section && <p className="section-label text-brand-600 dark:text-brand-200">{view.section}</p>}
              <p className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">{view.current.title}</p>
              {run.status === 'paused' && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{t('live.status.paused')}</p>}
              <p className="inline-flex items-center gap-1 text-sm text-slate-600 dark:text-slate-300">
                <Icon name="chevronRight" className="size-4 shrink-0 text-slate-400" />
                {view.next ? t('live.next', { title: view.next.title }) : t('live.nextNothing')}
              </p>
            </>
          )}
          {over && (
            <p className="text-lg text-slate-700 dark:text-slate-200">
              {run.status === 'ended' ? t('live.endedAt', { time: timeOfDay(run.ended_at) }) : t('live.wasDiscarded')}
            </p>
          )}
          {finishLine(view, t, timeOfDay) && <p className="text-sm text-slate-500 dark:text-slate-400">{finishLine(view, t, timeOfDay)}</p>}
        </div>
        <div className="surface-inset px-5 py-4 text-left text-slate-900 md:text-right dark:text-white">
          <Countdown view={view} />
        </div>
      </div>

      <div className="card space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <Icon name="person" className="size-4 shrink-0 text-slate-400" />
            {control.held_by_you
              ? t('live.control.you', { count: control.lease_seconds_left ?? 0 })
              : control.held
                ? control.holder_name
                  ? t('live.control.held', { name: control.holder_name })
                  : t('live.control.heldUnknown')
                : over
                  ? t('live.control.finished')
                  : t('live.control.nobody')}
          </p>
          <Button variant="secondary" size="sm" icon="grid" onClick={onStage}>{t('live.stageDisplay')}</Button>
        </div>

        {canAct && !over && !mine && (
          <div className="flex flex-wrap gap-2">
            {control.held ? (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirm('take_over')}>
                {control.holder_name ? t('live.takeOverFrom', { name: control.holder_name }) : t('live.takeOverFromController')}
              </Button>
            ) : (
              <Button disabled={busy} loading={live.pending?.action === 'take_control'} onClick={() => live.send({ action: 'take_control' })}>
                {t('live.takeControl')}
              </Button>
            )}
          </div>
        )}

        {canAct && mine && (
          <div className="flex flex-wrap items-center gap-2">
            {run.status === 'ready' && (
              <Button icon="play" disabled={busy} loading={live.pending?.action === 'start'} onClick={() => live.send({ action: 'start' })}>
                {t('live.start')}
              </Button>
            )}
            {active && (
              <>
                <Button
                  variant="secondary"
                  icon="chevronLeft"
                  disabled={busy || previous === null}
                  onClick={() => previous !== null && live.send({ action: 'jump', target_index: previous })}
                >
                  {t('live.back')}
                </Button>
                {run.status === 'live' ? (
                  <Button variant="secondary" disabled={busy} loading={live.pending?.action === 'pause'} onClick={() => live.send({ action: 'pause' })}>
                    {t('live.pause')}
                  </Button>
                ) : (
                  <Button variant="secondary" disabled={busy} loading={live.pending?.action === 'resume'} onClick={() => live.send({ action: 'resume' })}>
                    {t('live.resume')}
                  </Button>
                )}
                <Button icon="chevronRight" disabled={busy || view.next === null} loading={live.pending?.action === 'advance'} onClick={() => live.send({ action: 'advance' })}>
                  {t('live.nextButton')}
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => setConfirm('end')}>{t('live.endRun')}</Button>
              </>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-600 sm:ml-auto dark:text-slate-300">
              {t('live.countdownLabel')}
              <select
                className="input w-auto"
                value={run.countdown_policy}
                disabled={busy}
                onChange={(event) => live.send({ action: 'set_policy', countdown_policy: event.target.value as LiveCountdownPolicy })}
              >
                {LIVE_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>{t(`live.policies.${policy}`)}</option>
                ))}
              </select>
            </label>
            <Button variant="ghost" disabled={busy} onClick={() => live.send({ action: 'release_control' })}>{t('live.releaseControl')}</Button>
          </div>
        )}

        {canAct && run.status !== 'discarded' && (run.status === 'ready' || run.status === 'ended' || mine) && (
          <Button variant="ghost" size="sm" icon="trash" className="!text-rose-700 dark:!text-rose-400" disabled={busy} onClick={() => setConfirm('discard')}>
            {t('live.discardRun')}
          </Button>
        )}

        {live.pending && (
          <p className="text-sm text-slate-500 dark:text-slate-400" role="status">
            {t('live.sending', { action: t(`live.actions.${live.pending.action}`) })}
          </p>
        )}
        {offline && state.can_control && <p className="text-sm text-amber-700 dark:text-amber-300">{t('live.offlineCommands')}</p>}
        {live.commandError !== null && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/30">
            <Icon name="alert" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{refusalText(live.commandError)}</span>
            {live.retry && <Button variant="secondary" size="sm" onClick={live.retry}>{t('live.retryCommand')}</Button>}
            <Button variant="ghost" size="sm" onClick={live.clearCommandError}>{t('common:a11y.dismiss')}</Button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <h3 className="section-label border-b border-app-border bg-slate-50/70 px-4 py-2.5 dark:bg-slate-900/40">{t('live.orderPinned')}</h3>
        <ol className="row-list">
          {run.snapshot.map((item, index) => {
            const isCurrent = view.current_index === index;
            const isHeader = item.item_type === 'header';
            const jumpable = canAct && mine && active && !isCurrent && !busy;
            return (
              <li
                key={item.id}
                aria-current={isCurrent ? 'step' : undefined}
                className={`flex items-center gap-3 px-4 py-2 text-sm ${
                  isCurrent
                    ? 'bg-emerald-50 font-semibold text-emerald-900 shadow-[inset_3px_0_0] shadow-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-200'
                    : isHeader
                      ? 'bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400'
                      : 'text-slate-800 dark:text-slate-200'
                }`}
              >
                <span className="w-16 shrink-0 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                  {isHeader ? '' : formatters.time(plannedStart.get(item.id) ?? run.time_starts_at)}
                </span>
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {!isHeader && <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">{formatLiveDuration(item.length_seconds)}</span>}
                {jumpable && (
                  <Button variant="ghost" size="sm" onClick={() => live.send({ action: 'jump', target_index: index })}>
                    {isHeader ? t('live.goToSection') : t('live.goHere')}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <Modal
        open={confirm !== null}
        title={confirm === 'end' ? t('live.confirm.endTitle') : confirm === 'take_over' ? t('live.confirm.takeOverTitle') : t('live.confirm.discardTitle')}
        onClose={close}
        footer={
          <>
            <Button variant="secondary" onClick={close}>{t('common:actions.cancel')}</Button>
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
              {confirm === 'end' ? t('live.endRun') : confirm === 'take_over' ? t('live.confirm.takeOver') : t('live.confirm.discard')}
            </Button>
          </>
        }
      >
        {confirm === 'end' && <p className="text-sm text-slate-600 dark:text-slate-300">{t('live.confirm.endBody')}</p>}
        {confirm === 'take_over' && (
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>
              {control.holder_name
                ? t('live.confirm.takeOverBody', { name: control.holder_name })
                : t('live.confirm.takeOverBodyUnknown')}
            </p>
            <label className="field">
              {t('live.confirm.reasonOptional')}
              <input className="input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        )}
        {confirm === 'discard' && (
          <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>{t('live.confirm.discardBody')}</p>
            <label className="field">
              {t('live.confirm.reasonRequired')}
              <input className="input" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
        )}
      </Modal>
    </section>
  );
};
