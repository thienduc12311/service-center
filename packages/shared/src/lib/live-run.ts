/**
 * F12: Live timing derived from server timestamps. Clients poll the run's
 * authoritative state and compute every countdown, overrun and finish
 * estimate here, using the server clock (via `estimateClockOffset`) rather
 * than their own. Nothing is persisted per tick.
 *
 * Rules (Service Center choices, documented in the F12 ledger):
 * - Headers consume no time; a run never parks on one (the server skips them).
 * - An item with no planned length shows elapsed time only: no countdown.
 * - Pausing stops the `item` countdown; `planned_end`/`service_end` are
 *   wall-clock targets and keep counting.
 * - The finish estimate is now plus what is left of the current item (never
 *   less than zero) plus the remaining service items' planned lengths.
 * - Actual durations come from the transition history: the time an item was
 *   current while the run was not paused. A corrected transition counts at
 *   its latest correction.
 */

import { computePlanSchedule, type ScheduleItem } from './plan-order.js';
import type { PlanSchedule } from '../types/plan-order.js';
import type {
  LiveControlStatus,
  LiveItemActual,
  LiveRun,
  LiveRunActuals,
  LiveRunCorrectionRow,
  LiveRunSnapshotItem,
  LiveRunTransitionRow,
  LiveTimingAction,
  LiveView,
} from '../types/live.js';

/** Controller lease length (matches the database functions). */
export const LIVE_LEASE_SECONDS = 90;
/** How often the controlling client renews its lease. */
export const LIVE_RENEW_INTERVAL_MS = 30_000;
/** Poll interval while a run is live or paused. */
export const LIVE_ACTIVE_POLL_MS = 2_000;
/** Poll interval for a ready/ended run or the run list. */
export const LIVE_IDLE_POLL_MS = 15_000;
/** A viewer whose last successful read is older than this shows itself as stale. */
export const LIVE_STALE_AFTER_MS = 10_000;

export const LIVE_TIMING_ACTIONS: readonly LiveTimingAction[] = ['start', 'advance', 'jump', 'pause', 'resume', 'end'];

export const isLiveTimingAction = (action: string): action is LiveTimingAction =>
  (LIVE_TIMING_ACTIONS as readonly string[]).includes(action);

export interface ClockOffsetInput {
  /** `server_now` from the response. */
  serverNow: string;
  /** Local `Date.now()` just before the request was sent. */
  requestStartedAt: number;
  /** Local `Date.now()` when the response arrived. */
  responseReceivedAt: number;
}

/**
 * Milliseconds to add to the local clock to get server time. Uses the
 * midpoint of the request, so network delay is split evenly.
 */
export const estimateClockOffset = ({ serverNow, requestStartedAt, responseReceivedAt }: ClockOffsetInput): number => {
  const server = Date.parse(serverNow);
  if (!Number.isFinite(server)) return 0;
  return Math.round(server - (requestStartedAt + responseReceivedAt) / 2);
};

/** First non-header index at or after `from`; null when none. */
export const nextRunnableIndex = (items: readonly LiveRunSnapshotItem[], from: number): number | null => {
  for (let i = Math.max(0, from); i < items.length; i += 1) if (items[i]!.item_type !== 'header') return i;
  return null;
};

/** Last non-header index before `before`; null when none. */
export const previousRunnableIndex = (items: readonly LiveRunSnapshotItem[], before: number): number | null => {
  for (let i = Math.min(before, items.length) - 1; i >= 0; i -= 1) if (items[i]!.item_type !== 'header') return i;
  return null;
};

const scheduleItems = (items: readonly LiveRunSnapshotItem[]): ScheduleItem[] =>
  items.map((item) => ({
    id: item.id,
    item_type: item.item_type,
    length_seconds: item.length_seconds,
    service_segment: item.service_segment,
  }));

/** The planned timing of the run's pinned order against its pinned service time. */
export const liveRunSchedule = (run: Pick<LiveRun, 'snapshot' | 'plan_time_id' | 'id' | 'time_name' | 'time_starts_at' | 'time_ends_at'>): PlanSchedule =>
  computePlanSchedule({
    items: scheduleItems(run.snapshot),
    time: {
      id: run.plan_time_id ?? run.id,
      kind: 'service',
      name: run.time_name,
      starts_at: run.time_starts_at,
      ends_at: run.time_ends_at,
    },
  });

const toSeconds = (ms: number): number => Math.round(ms / 1000);
const iso = (ms: number): string => new Date(ms).toISOString();

/** Milliseconds the current item has run, pauses excluded. */
const currentElapsedMs = (run: LiveRun, nowMs: number): number => {
  if (run.current_started_at === null || (run.status !== 'live' && run.status !== 'paused')) return 0;
  const until = run.status === 'paused' && run.paused_at ? Date.parse(run.paused_at) : nowMs;
  return Math.max(0, until - Date.parse(run.current_started_at) - run.current_paused_ms);
};

/**
 * Everything a viewer shows, from the run and the server-corrected current
 * time (`Date.now() + offset`).
 */
export const deriveLiveView = (run: LiveRun, nowMs: number): LiveView => {
  const items = run.snapshot;
  const schedule = liveRunSchedule(run);
  const plannedFinish = schedule.planned_finish_at;
  const running = run.status === 'live' || run.status === 'paused';
  const currentIndex = running ? run.current_index : null;
  const current = currentIndex === null ? null : (items[currentIndex] ?? null);
  const nextIndex =
    run.status === 'ready' ? nextRunnableIndex(items, 0)
    : currentIndex === null ? null
    : nextRunnableIndex(items, currentIndex + 1);

  let section: string | null = null;
  if (currentIndex !== null) {
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
      if (items[i]!.item_type === 'header') {
        section = items[i]!.title;
        break;
      }
    }
  }

  const elapsedMs = currentElapsedMs(run, nowMs);
  let remainingMs: number | null = null;
  if (current) {
    switch (run.countdown_policy) {
      case 'item':
        remainingMs = current.length_seconds > 0 ? current.length_seconds * 1000 - elapsedMs : null;
        break;
      case 'planned_end': {
        const planned = schedule.items.find((slot) => slot.item_id === current.id);
        remainingMs = planned && planned.duration_seconds > 0 ? Date.parse(planned.ends_at) - nowMs : null;
        break;
      }
      case 'service_end':
        remainingMs = Date.parse(run.time_ends_at) - nowMs;
        break;
    }
  }

  let projected: number | null = null;
  if (current && current.service_segment !== 'post') {
    const leftOfCurrent = current.service_segment === 'service' ? Math.max(0, current.length_seconds * 1000 - elapsedMs) : 0;
    const later = items
      .slice((currentIndex ?? 0) + 1)
      .filter((item) => item.service_segment === 'service' && item.item_type !== 'header')
      .reduce((sum, item) => sum + item.length_seconds * 1000, 0);
    // Before the service starts, it cannot finish earlier than its planned start allows.
    const serviceStart = Date.parse(run.time_starts_at);
    const base = current.service_segment === 'pre' ? Math.max(nowMs, serviceStart) : nowMs;
    projected = base + leftOfCurrent + later;
  }

  return {
    status: run.status,
    current,
    current_index: currentIndex,
    next: nextIndex === null ? null : (items[nextIndex] ?? null),
    next_index: nextIndex,
    section,
    elapsed_seconds: Math.floor(elapsedMs / 1000),
    remaining_seconds: remainingMs === null ? null : Math.ceil(remainingMs / 1000),
    overrun_seconds: remainingMs !== null && remainingMs < 0 ? Math.floor(-remainingMs / 1000) : 0,
    countdown_policy: run.countdown_policy,
    planned_finish_at: plannedFinish,
    projected_finish_at: projected === null ? null : iso(projected),
    finish_delta_seconds:
      projected === null || plannedFinish === null ? null : toSeconds(projected - Date.parse(plannedFinish)),
  };
};

/** Does this user, in this client instance, hold a valid lease at `nowMs` (server time)? */
export const liveControlStatus = (
  run: Pick<LiveRun, 'controller_user_id' | 'controller_client_id' | 'controller_name' | 'controller_lease_expires_at'>,
  userId: string | null,
  clientId: string,
  nowMs: number,
): LiveControlStatus => {
  const expires = run.controller_lease_expires_at ? Date.parse(run.controller_lease_expires_at) : null;
  const held = run.controller_user_id !== null && expires !== null && expires > nowMs;
  return {
    held,
    held_by_you: held && run.controller_user_id === userId && run.controller_client_id === clientId,
    holder_name: held ? run.controller_name : null,
    lease_seconds_left: held && expires !== null ? Math.max(0, Math.floor((expires - nowMs) / 1000)) : null,
  };
};

/** When a transition counts as having happened: its latest correction, else when it was recorded. */
export const effectiveTransitionTimes = (
  transitions: readonly LiveRunTransitionRow[],
  corrections: readonly LiveRunCorrectionRow[],
): Map<number, number> => {
  const latest = new Map<number, LiveRunCorrectionRow>();
  for (const correction of corrections) {
    const seen = latest.get(correction.transition_id);
    if (!seen || correction.id > seen.id) latest.set(correction.transition_id, correction);
  }
  return new Map(
    transitions.map((t) => [t.id, Date.parse(latest.get(t.id)?.corrected_at ?? t.occurred_at)] as const),
  );
};

/**
 * Planned versus actual for one run. For a run still in progress, pass the
 * current server time so the current item counts up to now.
 */
export const computeRunActuals = (
  run: LiveRun,
  transitions: readonly LiveRunTransitionRow[],
  corrections: readonly LiveRunCorrectionRow[],
  nowMs?: number,
): LiveRunActuals => {
  const items = run.snapshot;
  const actualMs = new Array<number>(items.length).fill(0);
  const visits = new Array<number>(items.length).fill(0);
  const firstStarted = new Array<number | null>(items.length).fill(null);
  const times = effectiveTransitionTimes(transitions, corrections);
  const timing = [...transitions].filter((t) => isLiveTimingAction(t.action)).sort((a, b) => a.id - b.id);

  let current: number | null = null;
  let since = 0;
  let paused = false;
  let pausedSince = 0;
  let pausedMs = 0;
  let startedAt: number | null = null;
  let endedAt: number | null = null;

  const credit = (at: number) => {
    if (current !== null && !paused) actualMs[current]! += Math.max(0, at - since);
  };
  const enter = (index: number | null, at: number) => {
    current = index;
    since = at;
    if (index === null || index < 0 || index >= items.length) {
      current = null;
      return;
    }
    visits[index]! += 1;
    if (firstStarted[index] === null) firstStarted[index] = at;
  };

  for (const t of timing) {
    const at = times.get(t.id) ?? Date.parse(t.occurred_at);
    switch (t.action as LiveTimingAction) {
      case 'start':
        startedAt = at;
        paused = false;
        enter(t.to_index, at);
        break;
      case 'advance':
      case 'jump':
        credit(at);
        enter(t.to_index, at);
        break;
      case 'pause':
        credit(at);
        paused = true;
        pausedSince = at;
        break;
      case 'resume':
        if (paused) pausedMs += Math.max(0, at - pausedSince);
        paused = false;
        since = at;
        break;
      case 'end':
        credit(at);
        if (paused) pausedMs += Math.max(0, at - pausedSince);
        paused = false;
        current = null;
        endedAt = at;
        break;
    }
  }
  if (nowMs !== undefined && endedAt === null && (run.status === 'live' || run.status === 'paused')) {
    credit(nowMs);
    if (paused) pausedMs += Math.max(0, nowMs - pausedSince);
  }

  const lines: LiveItemActual[] = items.map((item, index) => {
    const planned = item.item_type === 'header' ? 0 : item.length_seconds;
    const actual = toSeconds(actualMs[index]!);
    const ran = visits[index]! > 0;
    return {
      item_id: item.id,
      index,
      title: item.title,
      item_type: item.item_type,
      segment: item.service_segment,
      planned_seconds: planned,
      actual_seconds: actual,
      first_started_at: firstStarted[index] === null ? null : iso(firstStarted[index]!),
      variance_seconds: ran ? actual - planned : null,
      visits: visits[index]!,
    };
  });

  const service = lines.filter((line) => line.segment === 'service');
  return {
    started_at: startedAt === null ? null : iso(startedAt),
    ended_at: endedAt === null ? null : iso(endedAt),
    elapsed_seconds: startedAt === null || endedAt === null ? null : toSeconds(endedAt - startedAt),
    paused_seconds: toSeconds(pausedMs),
    planned_service_seconds: service.reduce((sum, line) => sum + line.planned_seconds, 0),
    actual_service_seconds: service.reduce((sum, line) => sum + line.actual_seconds, 0),
    items: lines,
    corrected: corrections.length > 0,
  };
};

/** "4:05", "-0:30", "1:02:03". */
export const formatLiveDuration = (seconds: number): string => {
  const sign = seconds < 0 ? '-' : '';
  const total = Math.abs(Math.trunc(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}` : `${sign}${m}:${ss}`;
};

export const LIVE_STATUS_LABELS: Record<LiveRun['status'], string> = {
  ready: 'Ready',
  live: 'Live',
  paused: 'Paused',
  ended: 'Ended',
  discarded: 'Discarded',
};

export const LIVE_POLICY_LABELS: Record<LiveRun['countdown_policy'], string> = {
  item: 'Item length',
  planned_end: 'Planned item end',
  service_end: 'Service end',
};
