import { describe, expect, it } from 'vitest';
import type { LiveRun, LiveRunStateRecord } from '@service-center/shared';
import { liveRunActionRpcArgs, liveRunWarnings, liveServiceTimeOptions, toLiveRunState, type LiveRunSummaryRow } from './live-run.model.js';

const run: LiveRun = {
  id: 'run-1', organization_id: 'org', plan_id: 'plan', plan_time_id: 'time-9', time_name: '9am',
  time_starts_at: '2027-05-02T13:00:00.000Z', time_ends_at: '2027-05-02T14:00:00.000Z', status: 'live',
  countdown_policy: 'item', snapshot: [], snapshot_revision: 4, snapshot_at: '2027-05-01T00:00:00Z', current_index: 0,
  current_started_at: '2027-05-02T13:00:00Z', paused_at: null, current_paused_ms: 0, started_at: '2027-05-02T13:00:00Z',
  ended_at: null, revision: 3, controller_user_id: 'u1', controller_client_id: 'tab', controller_name: 'Jordan',
  controller_lease_expires_at: '2027-05-02T13:01:30Z', discarded_reason: null, created_by: 'u1',
  created_at: '2027-05-01T00:00:00Z', updated_at: '2027-05-02T13:00:00Z',
};
const record = (overrides: Partial<LiveRunStateRecord> = {}): LiveRunStateRecord => ({
  run,
  server_now: '2027-05-02T13:00:10Z',
  plan_content_revision: 4,
  // Same instants written differently: not a move.
  time: { id: 'time-9', starts_at: '2027-05-02T13:00:00+00:00', ends_at: '2027-05-02T14:00:00+00:00' },
  can_control: true,
  ...overrides,
});

describe('liveRunWarnings', () => {
  it('is quiet when the order and the time match the snapshot', () => {
    expect(liveRunWarnings(record())).toEqual([]);
  });
  it('warns that the plan changed after the snapshot while a run is active', () => {
    expect(liveRunWarnings(record({ plan_content_revision: 5 }))).toEqual([{ code: 'plan_changed_since_snapshot' }]);
    // An ended run's history is pinned; later edits are not its concern.
    expect(liveRunWarnings(record({ plan_content_revision: 5, run: { ...run, status: 'ended' } }))).toEqual([]);
  });
  it('warns when the service time moved or was removed', () => {
    expect(liveRunWarnings(record({ time: { id: 'time-9', starts_at: '2027-05-02T13:30:00Z', ends_at: '2027-05-02T14:00:00Z' } })))
      .toEqual([{ code: 'service_time_moved' }]);
    expect(liveRunWarnings(record({ time: null }))).toEqual([{ code: 'service_time_removed' }]);
  });
});

describe('toLiveRunState', () => {
  it('carries replay only when there was a command', () => {
    expect(toLiveRunState(record())).not.toHaveProperty('replayed');
    expect(toLiveRunState(record(), true).replayed).toBe(true);
  });
});

describe('liveServiceTimeOptions', () => {
  it('pairs each service time with its non-discarded run', () => {
    const runs = [
      { id: 'old', plan_time_id: 'time-9', status: 'discarded' },
      { id: 'new', plan_time_id: 'time-9', status: 'ready' },
    ] as LiveRunSummaryRow[];
    const options = liveServiceTimeOptions(
      [
        { id: 'time-9', name: '9am', starts_at: 'a', ends_at: 'b' },
        { id: 'time-11', name: '11am', starts_at: 'c', ends_at: 'd' },
      ],
      runs,
    );
    expect(options.map((o) => [o.id, o.run_id, o.run_status])).toEqual([
      ['time-9', 'new', 'ready'],
      ['time-11', null, null],
    ]);
  });
});

describe('liveRunActionRpcArgs', () => {
  it('passes only the fields each command uses', () => {
    expect(liveRunActionRpcArgs('r', { action: 'jump', client_id: 'tab', action_id: 'a1', expected_revision: 3, target_index: 4 }))
      .toMatchObject({ p_action: 'jump', p_target_index: 4, p_reason: null, p_countdown_policy: null, p_expected_revision: 3 });
    expect(liveRunActionRpcArgs('r', { action: 'renew', client_id: 'tab' }))
      .toMatchObject({ p_action: 'renew', p_expected_revision: null, p_action_id: null });
    expect(liveRunActionRpcArgs('r', { action: 'discard', client_id: 'tab', action_id: 'a2', expected_revision: 1, reason: 'test' }).p_reason)
      .toBe('test');
  });
});
