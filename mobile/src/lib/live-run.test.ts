import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiError,
  LIVE_LEASE_SECONDS,
  LIVE_STALE_AFTER_MS,
  deriveLiveView,
  estimateClockOffset,
  liveControlStatus,
  liveRunActionSchema,
  type LiveRun,
  type LiveRunSnapshotItem,
  type LiveRunState,
} from '@service-center/shared';
import {
  buildLiveAction,
  buildLiveRenew,
  isLiveAccessLoss,
  liveClientId,
  liveCommandOutcome,
  liveConnection,
  liveControls,
  liveRefusalText,
  type LiveConnection,
} from './live-run';
import { queryKeys } from './query-keys';

const T0 = Date.parse('2026-10-25T13:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

const item = (id: string, overrides: Partial<LiveRunSnapshotItem> = {}): LiveRunSnapshotItem => ({
  id,
  item_type: 'item',
  title: id,
  length_seconds: 300,
  service_segment: 'service',
  song_id: null,
  key_override: null,
  description: null,
  ...overrides,
});

const SNAPSHOT = [item('Welcome', { item_type: 'header', length_seconds: 0 }), item('Song A'), item('Song B'), item('Message')];

const run = (overrides: Partial<LiveRun> = {}): LiveRun => ({
  id: 'run-9am',
  organization_id: 'org',
  plan_id: 'plan',
  plan_time_id: 'time-9am',
  time_name: '9am',
  time_starts_at: iso(T0),
  time_ends_at: iso(T0 + 3600_000),
  status: 'live',
  countdown_policy: 'item',
  snapshot: SNAPSHOT,
  snapshot_revision: 4,
  snapshot_at: iso(T0 - 600_000),
  current_index: 1,
  current_started_at: iso(T0),
  paused_at: null,
  current_paused_ms: 0,
  started_at: iso(T0),
  ended_at: null,
  revision: 7,
  controller_user_id: 'jordan',
  controller_client_id: 'phone-1',
  controller_name: 'Jordan Blake',
  controller_lease_expires_at: iso(T0 + LIVE_LEASE_SECONDS * 1000),
  discarded_reason: null,
  created_by: 'jordan',
  created_at: iso(T0 - 600_000),
  updated_at: iso(T0),
  ...overrides,
});

const state = (runOverrides: Partial<LiveRun> = {}, overrides: Partial<LiveRunState> = {}): LiveRunState => ({
  run: run(runOverrides),
  server_now: iso(T0 + 60_000),
  plan_content_revision: 4,
  warnings: [],
  can_control: true,
  ...overrides,
});

const controlsFor = (
  s: LiveRunState,
  user: string,
  client: string,
  nowMs: number,
  connection: LiveConnection = 'live',
  busy = false,
) => {
  const view = deriveLiveView(s.run, nowMs);
  const control = liveControlStatus(s.run, user, client, nowMs);
  return { view, control, controls: liveControls({ state: s, view, control, connection, busy }) };
};

describe('MOB-023 clock and timers', () => {
  it('shows the same countdown on a device whose clock is 5 minutes slow, using the measured offset', () => {
    const serverNow = T0 + 60_000; // one minute into Song A (5:00 long)
    const skew = -5 * 60_000;
    const requestStartedAt = serverNow + skew - 100;
    const responseReceivedAt = serverNow + skew + 100;
    const offset = estimateClockOffset({ serverNow: iso(serverNow), requestStartedAt, responseReceivedAt });
    expect(offset).toBe(-skew);
    const slowDeviceView = deriveLiveView(run(), responseReceivedAt + offset);
    const correctDeviceView = deriveLiveView(run(), serverNow + 100);
    expect(slowDeviceView.remaining_seconds).toBe(correctDeviceView.remaining_seconds);
    expect(slowDeviceView.remaining_seconds).toBe(240);
    // Without the offset the slow device would think the item had not begun and show the full 5:00.
    expect(deriveLiveView(run(), responseReceivedAt).remaining_seconds).toBe(300);
  });

  it('shows an overrun, never a negative countdown, and stops the item countdown while paused', () => {
    const over = deriveLiveView(run(), T0 + 330_000);
    expect(over.overrun_seconds).toBe(30);
    expect(over.remaining_seconds).toBeLessThan(0);
    const paused = deriveLiveView(run({ status: 'paused', paused_at: iso(T0 + 120_000) }), T0 + 900_000);
    expect(paused.remaining_seconds).toBe(180);
    expect(paused.overrun_seconds).toBe(0);
  });
});

describe('MOB-023 commands', () => {
  it('builds bodies the server schema accepts and refuses incomplete ones before sending', () => {
    const identity = { clientId: 'phone-1', actionId: 'a-1', expectedRevision: 7 };
    expect(buildLiveAction({ action: 'advance' }, identity)).toEqual({
      action: 'advance',
      client_id: 'phone-1',
      action_id: 'a-1',
      expected_revision: 7,
    });
    expect(liveRunActionSchema.safeParse(buildLiveAction({ action: 'jump', target_index: 2 }, identity)).success).toBe(true);
    expect(() => buildLiveAction({ action: 'discard', reason: '  ' }, identity)).toThrow();
    expect(buildLiveRenew('phone-1')).toEqual({ action: 'renew', client_id: 'phone-1' });
  });

  it('keeps one client id for this app process (the lease is user + client)', () => {
    expect(liveClientId()).toBe(liveClientId());
    expect(liveClientId()).toMatch(/[0-9a-f-]{36}/);
  });

  it('retries only an unanswered command; any server answer is final and nothing was applied', () => {
    expect(liveCommandOutcome(new TypeError('Network request failed'))).toBe('uncertain');
    expect(liveCommandOutcome(new ApiError(409, 'stale', 'run_revision_stale'))).toBe('refused');
    expect(liveCommandOutcome(new ApiError(500, 'boom'))).toBe('refused');
  });

  it('uses the website refusal wording for each API code', () => {
    expect(liveRefusalText(new ApiError(409, 'x', 'run_revision_stale'))).toEqual({ key: 'live.refusal.revisionStale' });
    expect(liveRefusalText(new ApiError(409, 'x', 'run_control_lost'))).toEqual({ key: 'live.refusal.controlLost' });
    expect(liveRefusalText(new ApiError(409, 'x', 'run_control_held')).key).toBe('live.refusal.notApplied');
    expect(liveRefusalText(new ApiError(409, 'x', 'idempotency_key_reused')).key).toBe('live.refusal.notApplied');
    expect(liveRefusalText(new TypeError('offline'))).toEqual({ key: 'live.refusal.network' });
    expect(liveRefusalText(new ApiError(400, 'x', 'validation_failed')).key).toBeNull();
    expect(isLiveAccessLoss(new ApiError(403, 'x'))).toBe(true);
    expect(isLiveAccessLoss(new ApiError(404, 'x'))).toBe(true);
    expect(isLiveAccessLoss(new ApiError(409, 'x'))).toBe(false);
  });
});

describe('MOB-023 controller lease', () => {
  const now = T0 + 60_000;

  it('offers the controlling device the run controls and nothing to take', () => {
    const { controls } = controlsFor(state(), 'jordan', 'phone-1', now);
    expect(controls).toMatchObject({ next: true, back: false, pause: true, resume: false, end: true, jump: true, takeOver: false, takeControl: false });
  });

  it('treats another device of the same user as a second controller: take over only', () => {
    const { control, controls } = controlsFor(state(), 'jordan', 'tablet-2', now);
    expect(control).toMatchObject({ held: true, held_by_you: false, holder_name: 'Jordan Blake' });
    expect(controls).toMatchObject({ takeOver: true, takeControl: false, next: false, pause: false, end: false, jump: false });
  });

  it('after the lease lapses, even the old controller must take control again', () => {
    const lapsed = T0 + (LIVE_LEASE_SECONDS + 1) * 1000;
    const old = controlsFor(state(), 'jordan', 'phone-1', lapsed);
    expect(old.control.held_by_you).toBe(false);
    expect(old.controls).toMatchObject({ takeControl: true, takeOver: false, next: false });
    expect(controlsFor(state(), 'riley', 'phone-9', lapsed).controls.takeControl).toBe(true);
  });

  it('gives a viewer without plans.edit no command at all', () => {
    const { controls } = controlsFor(state({}, { can_control: false }), 'riley', 'phone-9', now);
    expect(Object.entries(controls).filter(([key, value]) => key !== 'previousIndex' && value === true)).toEqual([]);
  });

  it('sends one command at a time (a second tap waits for the first answer)', () => {
    const { controls } = controlsFor(state(), 'jordan', 'phone-1', now, 'live', true);
    expect(controls).toMatchObject({ next: false, pause: false, end: false, jump: false });
  });

  it('never parks Back on a header and offers "use the current order" only before the start', () => {
    expect(controlsFor(state(), 'jordan', 'phone-1', now).controls.previousIndex).toBeNull();
    expect(controlsFor(state({ current_index: 2 }), 'jordan', 'phone-1', now).controls.previousIndex).toBe(1);
    const changed = { warnings: [{ code: 'plan_changed_since_snapshot' as const }] };
    const ready = state({ status: 'ready', current_index: null, current_started_at: null, started_at: null }, changed);
    expect(controlsFor(ready, 'jordan', 'phone-1', now).controls).toMatchObject({ refreshSnapshot: true, start: true });
    expect(controlsFor(state({}, changed), 'jordan', 'phone-1', now).controls.refreshSnapshot).toBe(false);
  });
});

describe('MOB-023 stale, offline and revoked', () => {
  it('reports the website connection states from the last read', () => {
    const base = { revoked: false, unreachable: false, receivedAt: 1_000, localNow: 1_000 };
    expect(liveConnection(base)).toBe('live');
    expect(liveConnection({ ...base, localNow: 1_000 + LIVE_STALE_AFTER_MS + 1 })).toBe('stale');
    expect(liveConnection({ ...base, unreachable: true })).toBe('offline');
    expect(liveConnection({ ...base, unreachable: true, revoked: true })).toBe('revoked');
  });

  it('keeps showing the last state offline but disables every command (nothing is queued)', () => {
    for (const connection of ['offline', 'revoked'] as const) {
      const { view, controls } = controlsFor(state(), 'jordan', 'phone-1', T0 + 60_000, connection);
      expect(view.current?.title).toBe('Song A');
      expect(controls.canAct).toBe(false);
      expect(controls).toMatchObject({ next: false, end: false, takeOver: false, discard: false });
    }
  });
});

describe('MOB-023 independent service times', () => {
  it('caches each run and each plan under its own key, scoped to account, organization and generation', () => {
    const scope = { userId: 'u', organizationId: 'o', generation: 1 };
    expect(queryKeys.liveRun(scope, 'run-9am')).not.toEqual(queryKeys.liveRun(scope, 'run-11am'));
    expect(queryKeys.liveRun(scope, 'run-9am')).not.toEqual(queryKeys.liveRun({ ...scope, generation: 2 }, 'run-9am'));
    expect(queryKeys.liveRuns(scope, 'plan')).not.toEqual(queryKeys.liveRuns({ ...scope, organizationId: 'o2' }, 'plan'));
  });

  it('derives each run only from its own state', () => {
    const nine = deriveLiveView(run(), T0 + 60_000);
    const eleven = deriveLiveView(run({ id: 'run-11am', status: 'ready', current_index: null, current_started_at: null, started_at: null }), T0 + 60_000);
    expect(nine.current?.title).toBe('Song A');
    expect(eleven.current).toBeNull();
    expect(eleven.next?.title).toBe('Song A');
  });
});

describe('MOB-023 source contract', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', ...parts), 'utf8');
  const hook = read('src', 'lib', 'useLiveRun.ts');
  const screen = read('app', 'plan', 'live', '[id].tsx');
  const both = hook + screen;

  it('uses only the implemented F12 methods and the shared timing helpers', () => {
    const methods = [...both.matchAll(/api\.(\w+)\(/g)].map((match) => match[1]);
    expect(new Set(methods)).toEqual(new Set(['liveRunState', 'liveRunAction', 'liveRuns', 'createLiveRun', 'liveRunHistory', 'getPlan', 'openConversation']));
    expect(hook).toContain('estimateClockOffset');
    expect(hook).toContain('deriveLiveView');
    expect(both).not.toContain('correctLiveRunTime');
  });

  it('persists nothing per tick and keeps the run out of device storage', () => {
    expect(both).not.toMatch(/AsyncStorage|SecureStore|setItem/);
    expect(hook).toMatch(/setInterval\(\(\) => setLocalNow/);
  });

  it('polls only while visible, re-reads on return, and renews the lease only in the foreground', () => {
    expect(hook).toMatch(/if \(!visible \|\| isLiveAccessLoss/);
    expect(hook).toMatch(/if \(visible && runId\) void refetch\(\)/);
    expect(hook).toMatch(/if \(!heldByMe \|\| !runId \|\| !appActive\) return/);
  });

  it('retries an unanswered command with the same body and drops late answers after an identity change', () => {
    expect(hook).toMatch(/unanswered\.current = uncertain \? \{ input: variables\.input/);
    expect(hook).toMatch(/commandMutation\.mutate\(\{ \.\.\.last/);
    expect(hook).toMatch(/if \(!isCurrentGeneration\(commandGeneration\)\) return/);
  });

  it('confirms End, Take over and Discard, and keeps corrections and the stage display on the website', () => {
    expect(screen).toContain("t('live.confirm.endTitle')");
    expect(screen).toContain("setConfirm('take_over')");
    expect(screen).toContain("setConfirm('discard')");
    expect(screen).toContain("t('live.mobile.historyReadOnly')");
    expect(screen).toContain("t('live.mobile.stageOnWebsite')");
  });
});
