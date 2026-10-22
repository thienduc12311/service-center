import {
  ApiError,
  LIVE_STALE_AFTER_MS,
  liveRunActionSchema,
  previousRunnableIndex,
  type LiveControlStatus,
  type LiveCountdownPolicy,
  type LiveRunActionInput,
  type LiveRunState,
  type LiveView,
} from '@service-center/shared';
import { newIdempotencyKey } from './idempotency';

/**
 * MOB-023: native helpers for F12 Live. Every timer comes from the shared
 * `deriveLiveView` over the polled server state; nothing here persists
 * anything per tick or invents a wire shape.
 */

/**
 * This app process's Live client id (the website's per-tab id). The lease
 * belongs to user + client, so another device — or this app after a restart —
 * is another client and must take control deliberately.
 */
export const liveClientId = (() => {
  let cached: string | null = null;
  return (): string => {
    cached ??= newIdempotencyKey();
    return cached;
  };
})();

/** A command without the fields the hook fills in (client, action id, revision): the website's `LiveCommand`. */
export type LiveCommand =
  | { action: 'start' | 'advance' | 'pause' | 'resume' | 'end' | 'take_control' | 'release_control' | 'refresh_snapshot' }
  | { action: 'jump'; target_index: number }
  | { action: 'take_over'; reason?: string }
  | { action: 'discard'; reason: string }
  | { action: 'set_policy'; countdown_policy: LiveCountdownPolicy };

/** What identifies one attempt of a command; a retry re-sends exactly this. */
export interface LiveCommandIdentity {
  clientId: string;
  /** Fresh per command; reused only when re-sending after a failure with no answer. */
  actionId: string;
  expectedRevision: number;
}

/** The wire body for a command, checked against the shared schema the server validates with. */
export const buildLiveAction = (command: LiveCommand, identity: LiveCommandIdentity): LiveRunActionInput =>
  liveRunActionSchema.parse({
    ...command,
    client_id: identity.clientId,
    action_id: identity.actionId,
    expected_revision: identity.expectedRevision,
  });

/** The lease heartbeat: no revision or action id, never recorded. */
export const buildLiveRenew = (clientId: string): LiveRunActionInput =>
  liveRunActionSchema.parse({ action: 'renew', client_id: clientId });

/** 403/404 on a read or command: the run was removed or this account lost access. */
export const isLiveAccessLoss = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 403);

/**
 * How a failed command ended. A server answer (`refused`) is final — nothing
 * was applied. No answer (`uncertain`) may be re-sent with the same action id:
 * the server applies it at most once and replays the result otherwise.
 */
export type LiveCommandOutcome = 'refused' | 'uncertain';

export const liveCommandOutcome = (error: unknown): LiveCommandOutcome =>
  error instanceof ApiError ? 'refused' : 'uncertain';

/** The website's refusal wording (`media:live.refusal.*`), keyed by the API code. */
export type LiveRefusalText =
  | { key: 'live.refusal.revisionStale' }
  | { key: 'live.refusal.controlLost' }
  | { key: 'live.refusal.notApplied'; reasonFrom: ApiError }
  | { key: 'live.refusal.network' }
  | { key: null; error: unknown };

export const liveRefusalText = (error: unknown): LiveRefusalText => {
  if (!(error instanceof ApiError)) return { key: 'live.refusal.network' };
  switch (error.code) {
    case 'run_revision_stale':
      return { key: 'live.refusal.revisionStale' };
    case 'run_control_lost':
      return { key: 'live.refusal.controlLost' };
    case 'run_control_held':
    case 'run_state_invalid':
    case 'idempotency_key_reused':
      return { key: 'live.refusal.notApplied', reasonFrom: error };
    default:
      return { key: null, error };
  }
};

/** How current this device's copy of the run is (the website's states). */
export type LiveConnection = 'live' | 'stale' | 'offline' | 'revoked';

export interface LiveConnectionInput {
  /** The last read or command was answered 403/404. */
  revoked: boolean;
  /** The last read got no answer (no network) — there is no OS online flag in this app. */
  unreachable: boolean;
  /** Local time the last successful read arrived; null before the first. */
  receivedAt: number | null;
  localNow: number;
}

export const liveConnection = ({ revoked, unreachable, receivedAt, localNow }: LiveConnectionInput): LiveConnection => {
  if (revoked) return 'revoked';
  if (unreachable) return 'offline';
  if (receivedAt !== null && localNow - receivedAt > LIVE_STALE_AFTER_MS) return 'stale';
  return 'live';
};

/** Which controls the screen offers; the server re-checks each one (`can_edit_plan`, lease, revision). */
export interface LiveControls {
  /** Commands can be sent at all (permission and a connection). */
  canAct: boolean;
  takeControl: boolean;
  takeOver: boolean;
  start: boolean;
  back: boolean;
  /** The runnable item before the current one (the website's Back = jump). */
  previousIndex: number | null;
  pause: boolean;
  resume: boolean;
  next: boolean;
  end: boolean;
  setPolicy: boolean;
  release: boolean;
  discard: boolean;
  /** "Use the current order" on a ready run whose plan changed. */
  refreshSnapshot: boolean;
  jump: boolean;
}

export interface LiveControlsInput {
  state: LiveRunState;
  view: LiveView;
  control: LiveControlStatus;
  connection: LiveConnection;
  /** A command is in flight: one at a time, like the website. */
  busy: boolean;
}

/** The website `LiveRunPanel` rules, in one place for the native screen. */
export const liveControls = ({ state, view, control, connection, busy }: LiveControlsInput): LiveControls => {
  const { run } = state;
  const active = run.status === 'live' || run.status === 'paused';
  const over = run.status === 'ended' || run.status === 'discarded';
  const offline = connection === 'offline' || connection === 'revoked';
  const canAct = state.can_control && !offline;
  const mine = control.held_by_you;
  const ready = canAct && !busy;
  const previousIndex = view.current_index === null ? null : previousRunnableIndex(run.snapshot, view.current_index);
  return {
    canAct,
    takeControl: ready && !over && !mine && !control.held,
    takeOver: ready && !over && !mine && control.held,
    start: ready && mine && run.status === 'ready',
    back: ready && mine && active && previousIndex !== null,
    previousIndex,
    pause: ready && mine && run.status === 'live',
    resume: ready && mine && run.status === 'paused',
    next: ready && mine && active && view.next !== null,
    end: ready && mine && active,
    setPolicy: ready && mine && !over,
    release: ready && mine && !over,
    discard: ready && run.status !== 'discarded' && (run.status === 'ready' || run.status === 'ended' || mine),
    refreshSnapshot:
      ready && mine && run.status === 'ready' && state.warnings.some((w) => w.code === 'plan_changed_since_snapshot'),
    jump: ready && mine && active,
  };
};
