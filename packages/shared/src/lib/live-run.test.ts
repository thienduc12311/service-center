import { describe, expect, it } from 'vitest';
import {
  computeRunActuals,
  deriveLiveView,
  estimateClockOffset,
  formatLiveDuration,
  liveControlStatus,
  nextRunnableIndex,
  previousRunnableIndex,
} from './live-run.js';
import { liveRunActionSchema, correctLiveRunTimeSchema } from '../schemas/live.js';
import type { LiveRun, LiveRunCorrectionRow, LiveRunSnapshotItem, LiveRunTransitionRow, LiveTransitionAction } from '../types/live.js';

const T0 = Date.parse('2027-05-02T13:00:00Z');
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString();

const item = (id: string, item_type: LiveRunSnapshotItem['item_type'], length_seconds: number, service_segment: LiveRunSnapshotItem['service_segment'] = 'service'): LiveRunSnapshotItem => ({
  id, item_type, title: id, length_seconds, service_segment, song_id: null, key_override: null, description: null,
});

// pre: Countdown 300 | service: [Worship] Welcome 120, Song 300, [Word] Sermon 1800 | post: Exit 60
const snapshot: LiveRunSnapshotItem[] = [
  item('countdown', 'item', 300, 'pre'),
  item('Worship', 'header', 0),
  item('welcome', 'item', 120),
  item('song', 'song', 300),
  item('Word', 'header', 0),
  item('sermon', 'item', 1800),
  item('notice', 'item', 0),
  item('exit', 'item', 60, 'post'),
];

const baseRun = (overrides: Partial<LiveRun> = {}): LiveRun => ({
  id: 'run', organization_id: 'org', plan_id: 'plan', plan_time_id: 'time', time_name: '9am',
  time_starts_at: at(0), time_ends_at: at(3600), status: 'ready', countdown_policy: 'item', snapshot,
  snapshot_revision: 4, snapshot_at: at(-3600), current_index: null, current_started_at: null, paused_at: null,
  current_paused_ms: 0, started_at: null, ended_at: null, revision: 1, controller_user_id: 'u1',
  controller_client_id: 'tab-a', controller_name: 'Jordan', controller_lease_expires_at: at(90),
  discarded_reason: null, created_by: 'u1', created_at: at(-3600), updated_at: at(-3600),
  ...overrides,
});

const live = (index: number, startedSeconds: number, overrides: Partial<LiveRun> = {}): LiveRun =>
  baseRun({ status: 'live', current_index: index, current_started_at: at(startedSeconds), started_at: at(-300), ...overrides });

describe('runnable navigation', () => {
  it('skips headers both ways', () => {
    expect(nextRunnableIndex(snapshot, 1)).toBe(2);
    expect(nextRunnableIndex(snapshot, 4)).toBe(5);
    expect(nextRunnableIndex(snapshot, 8)).toBeNull();
    expect(previousRunnableIndex(snapshot, 5)).toBe(3);
    expect(previousRunnableIndex(snapshot, 0)).toBeNull();
  });
});

describe('deriveLiveView', () => {
  it('ready: nothing is current and the first runnable item is next', () => {
    const view = deriveLiveView(baseRun(), T0);
    expect(view.current).toBeNull();
    expect(view.next?.id).toBe('countdown');
    expect(view.remaining_seconds).toBeNull();
    expect(view.planned_finish_at).toBe(at(2220));
    expect(view.projected_finish_at).toBeNull();
  });

  it('counts the item down from server timestamps, with the section and next item', () => {
    const view = deriveLiveView(live(3, 100), T0 + 220_000);
    expect(view.current?.id).toBe('song');
    expect(view.section).toBe('Worship');
    expect(view.next?.id).toBe('sermon'); // the "Word" header is skipped
    expect(view.elapsed_seconds).toBe(120);
    expect(view.remaining_seconds).toBe(180);
    expect(view.overrun_seconds).toBe(0);
    // now (220) + 180 left + sermon 1800 + notice 0 = 2200 → 20 s early against 2220.
    expect(view.projected_finish_at).toBe(at(2200));
    expect(view.finish_delta_seconds).toBe(-20);
  });

  it('shows an overrun instead of a negative countdown, and projects the delay', () => {
    const view = deriveLiveView(live(2, 0), T0 + 150_000);
    expect(view.remaining_seconds).toBe(-30);
    expect(view.overrun_seconds).toBe(30);
    // 150 + 0 left + 300 + 1800 = 2250 → 30 s late.
    expect(view.finish_delta_seconds).toBe(30);
  });

  it('a paused run stops the item clock; resumed pause time is excluded', () => {
    const paused = live(2, 0, { status: 'paused', paused_at: at(40), current_paused_ms: 10_000 });
    const later = deriveLiveView(paused, T0 + 500_000);
    expect(later.elapsed_seconds).toBe(30);
    expect(later.remaining_seconds).toBe(90);
    // Wall-clock policies keep counting while paused.
    expect(deriveLiveView({ ...paused, countdown_policy: 'service_end' }, T0 + 500_000).remaining_seconds).toBe(3100);
  });

  it('an item with no length counts up with no countdown', () => {
    const view = deriveLiveView(live(6, 2000), T0 + 2030_000);
    expect(view.current?.id).toBe('notice');
    expect(view.elapsed_seconds).toBe(30);
    expect(view.remaining_seconds).toBeNull();
    expect(view.overrun_seconds).toBe(0);
  });

  it('planned_end counts to the item planned end', () => {
    const view = deriveLiveView(live(3, 100, { countdown_policy: 'planned_end' }), T0 + 400_000);
    // Song is planned 120 → 420.
    expect(view.remaining_seconds).toBe(20);
  });

  it('a before-service item cannot pull the projected finish earlier than the planned start', () => {
    const view = deriveLiveView(live(0, -600), T0 - 500_000);
    expect(view.projected_finish_at).toBe(at(2220));
  });

  it('after-service items have no service finish to project', () => {
    expect(deriveLiveView(live(7, 2300), T0 + 2310_000).projected_finish_at).toBeNull();
  });

  it('a skewed client converges once its offset is applied', () => {
    const run = live(3, 100);
    const serverNow = T0 + 220_000;
    const clientClock = serverNow - 47_000; // client clock 47 s slow
    const offset = estimateClockOffset({ serverNow: new Date(serverNow).toISOString(), requestStartedAt: clientClock - 100, responseReceivedAt: clientClock + 100 });
    expect(offset).toBe(47_000);
    expect(deriveLiveView(run, clientClock + offset)).toEqual(deriveLiveView(run, serverNow));
    expect(deriveLiveView(run, clientClock).remaining_seconds).not.toBe(deriveLiveView(run, serverNow).remaining_seconds);
  });

  it('ended runs show nothing current', () => {
    const view = deriveLiveView(baseRun({ status: 'ended', started_at: at(0), ended_at: at(2300), controller_user_id: null }), T0 + 9_999_000);
    expect(view.current).toBeNull();
    expect(view.next).toBeNull();
    expect(view.remaining_seconds).toBeNull();
  });
});

describe('liveControlStatus', () => {
  it('distinguishes this client, another client and an expired lease', () => {
    const run = baseRun();
    expect(liveControlStatus(run, 'u1', 'tab-a', T0).held_by_you).toBe(true);
    expect(liveControlStatus(run, 'u1', 'tab-b', T0)).toMatchObject({ held: true, held_by_you: false, holder_name: 'Jordan' });
    expect(liveControlStatus(run, 'u1', 'tab-a', T0 + 91_000)).toMatchObject({ held: false, held_by_you: false, holder_name: null });
    expect(liveControlStatus(run, 'u1', 'tab-a', T0 + 30_000).lease_seconds_left).toBe(60);
  });
});

let nextId = 1;
const transition = (action: LiveTransitionAction, seconds: number, to_index: number | null = null): LiveRunTransitionRow => ({
  id: nextId++, run_id: 'run', organization_id: 'org', revision: nextId, action, from_index: null, to_index,
  item_id: null, status_after: 'live', occurred_at: at(seconds), actor_user_id: 'u1', actor_name: 'Jordan',
  client_action_id: `a${nextId}`, reason: null, details: {},
});

describe('computeRunActuals', () => {
  const history = (): LiveRunTransitionRow[] => {
    nextId = 1;
    return [
      transition('create', -3600),
      transition('start', -290, 0), // countdown
      transition('advance', 5, 2), // welcome
      transition('take_over', 50), // control change: not timing
      transition('advance', 140, 3), // song
      transition('pause', 200),
      transition('resume', 260),
      transition('jump', 500, 5), // sermon (Word header skipped)
      transition('jump', 2400, 2), // back to welcome
      transition('jump', 2410, 7), // exit
      transition('end', 2480),
    ];
  };
  const ended = baseRun({ status: 'ended', started_at: at(-290), ended_at: at(2480), controller_user_id: null, controller_client_id: null, controller_lease_expires_at: null });

  it('derives per-item actuals, pauses, visits and variance from transitions', () => {
    const actuals = computeRunActuals(ended, history(), []);
    const by = (id: string) => actuals.items.find((line) => line.item_id === id)!;
    expect(by('countdown')).toMatchObject({ actual_seconds: 295, planned_seconds: 300, variance_seconds: -5, visits: 1 });
    expect(by('welcome')).toMatchObject({ actual_seconds: 145, visits: 2, first_started_at: at(5) });
    expect(by('song')).toMatchObject({ actual_seconds: 300, variance_seconds: 0 }); // 140→200 + 260→500
    expect(by('sermon')).toMatchObject({ actual_seconds: 1900, variance_seconds: 100 });
    expect(by('Worship')).toMatchObject({ actual_seconds: 0, visits: 0, variance_seconds: null });
    expect(by('notice')).toMatchObject({ visits: 0, variance_seconds: null });
    expect(by('exit')).toMatchObject({ actual_seconds: 70, segment: 'post' });
    expect(actuals.paused_seconds).toBe(60);
    expect(actuals.elapsed_seconds).toBe(2770);
    expect(actuals.planned_service_seconds).toBe(2220);
    expect(actuals.actual_service_seconds).toBe(145 + 300 + 1900);
    expect(actuals.corrected).toBe(false);
  });

  it('applies the latest correction without touching the recorded transition', () => {
    const rows = history();
    const start = rows.find((t) => t.action === 'start')!;
    const corrections: LiveRunCorrectionRow[] = [
      { id: 1, run_id: 'run', organization_id: 'org', transition_id: start.id, revision: 20, previous_at: at(-290), corrected_at: at(-320), reason: 'late press', actor_user_id: 'u1', actor_name: 'Jordan', created_at: at(3000) },
      { id: 2, run_id: 'run', organization_id: 'org', transition_id: start.id, revision: 21, previous_at: at(-320), corrected_at: at(-300), reason: 'checked video', actor_user_id: 'u1', actor_name: 'Jordan', created_at: at(3100) },
    ];
    const actuals = computeRunActuals(ended, rows, corrections);
    expect(actuals.items[0]!.actual_seconds).toBe(305);
    expect(actuals.started_at).toBe(at(-300));
    expect(actuals.corrected).toBe(true);
    expect(start.occurred_at).toBe(at(-290));
  });

  it('a run in progress counts the current item up to now', () => {
    nextId = 1;
    const rows = [transition('start', 0, 2), transition('advance', 100, 3)];
    const actuals = computeRunActuals(live(3, 100), rows, [], T0 + 160_000);
    expect(actuals.items[3]!.actual_seconds).toBe(60);
    expect(actuals.ended_at).toBeNull();
  });
});

describe('formatLiveDuration', () => {
  it('formats minutes, hours and negatives', () => {
    expect(formatLiveDuration(245)).toBe('4:05');
    expect(formatLiveDuration(-30)).toBe('-0:30');
    expect(formatLiveDuration(3723)).toBe('1:02:03');
  });
});

describe('Live schemas', () => {
  it('requires an action id and revision for commands, but not for a lease renewal', () => {
    expect(liveRunActionSchema.safeParse({ action: 'advance', client_id: 'tab', expected_revision: 3 }).success).toBe(false);
    expect(liveRunActionSchema.safeParse({ action: 'advance', client_id: 'tab', action_id: 'a1', expected_revision: 3 }).success).toBe(true);
    expect(liveRunActionSchema.safeParse({ action: 'renew', client_id: 'tab' }).success).toBe(true);
  });
  it('requires a target for jump and a reason for discard', () => {
    expect(liveRunActionSchema.safeParse({ action: 'jump', client_id: 'tab', action_id: 'a', expected_revision: 1 }).success).toBe(false);
    expect(liveRunActionSchema.safeParse({ action: 'discard', client_id: 'tab', action_id: 'a', expected_revision: 1 }).success).toBe(false);
    expect(liveRunActionSchema.safeParse({ action: 'discard', client_id: 'tab', action_id: 'a', expected_revision: 1, reason: 'test' }).success).toBe(true);
  });
  it('requires a reason and a real time for a correction', () => {
    expect(correctLiveRunTimeSchema.safeParse({ transition_id: 1, corrected_at: 'yesterday', reason: 'x', expected_revision: 1 }).success).toBe(false);
    expect(correctLiveRunTimeSchema.safeParse({ transition_id: 1, corrected_at: at(0), reason: '  ', expected_revision: 1 }).success).toBe(false);
    expect(correctLiveRunTimeSchema.safeParse({ transition_id: 1, corrected_at: at(0), reason: 'late press', expected_revision: 1 }).success).toBe(true);
  });
});
