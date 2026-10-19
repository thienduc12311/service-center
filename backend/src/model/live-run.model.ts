import type {
  LiveRun,
  LiveRunActionInput,
  LiveRunRow,
  LiveRunState,
  LiveRunStateRecord,
  LiveRunStatus,
  LiveRunSummary,
  LiveRunWarning,
  LiveServiceTimeOption,
} from '@service-center/shared';

/** Columns a run list needs (no snapshot). */
export const LIVE_RUN_SUMMARY_COLUMNS =
  'id, plan_time_id, time_name, time_starts_at, time_ends_at, status, started_at, ended_at, revision, snapshot_revision, controller_name, controller_lease_expires_at, discarded_reason, created_at';

/** A run row from a summary select. */
export type LiveRunSummaryRow = Pick<LiveRunRow, keyof LiveRunSummary>;

/** The service-time columns the run list reads. */
export interface LiveServiceTimeRow {
  id: string;
  name: string | null;
  starts_at: string;
  ends_at: string;
}

/** Arguments of `public.live_run_action`. */
export type LiveRunActionRpcArgs = {
  p_run_id: string;
  p_action: string;
  p_expected_revision: number | null;
  p_client_id: string;
  p_action_id: string | null;
  p_target_index: number | null;
  p_reason: string | null;
  p_countdown_policy: string | null;
};

const ACTIVE: readonly LiveRunStatus[] = ['ready', 'live', 'paused'];

/** The run without its creation idempotency key. */
export const toLiveRun = (row: LiveRunRow | LiveRun): LiveRun => {
  const { idempotency_key: _key, ...run } = row as LiveRunRow;
  return run;
};

/**
 * Why a viewer should look twice: the order changed after the snapshot was
 * pinned, or the service time moved or disappeared. Never a refusal.
 */
export const liveRunWarnings = (record: Pick<LiveRunStateRecord, 'run' | 'plan_content_revision' | 'time'>): LiveRunWarning[] => {
  const { run, time } = record;
  const warnings: LiveRunWarning[] = [];
  if (ACTIVE.includes(run.status) && record.plan_content_revision !== run.snapshot_revision) {
    warnings.push({ code: 'plan_changed_since_snapshot' });
  }
  if (run.status !== 'discarded') {
    if (!time) warnings.push({ code: 'service_time_removed' });
    else if (
      Date.parse(time.starts_at) !== Date.parse(run.time_starts_at) ||
      Date.parse(time.ends_at) !== Date.parse(run.time_ends_at)
    ) {
      warnings.push({ code: 'service_time_moved' });
    }
  }
  return warnings;
};

export const toLiveRunState = (record: LiveRunStateRecord, replayed?: boolean): LiveRunState => ({
  run: toLiveRun(record.run),
  server_now: record.server_now,
  plan_content_revision: record.plan_content_revision,
  warnings: liveRunWarnings(record),
  can_control: record.can_control,
  ...(replayed === undefined ? {} : { replayed }),
});

/** Each service time with its non-discarded run (at most one, by the database's unique index). */
export const liveServiceTimeOptions = (
  times: readonly LiveServiceTimeRow[],
  runs: readonly LiveRunSummaryRow[],
): LiveServiceTimeOption[] =>
  times.map((time) => {
    const run = runs.find((r) => r.plan_time_id === time.id && r.status !== 'discarded');
    return {
      id: time.id,
      name: time.name,
      starts_at: time.starts_at,
      ends_at: time.ends_at,
      run_id: run?.id ?? null,
      run_status: run?.status ?? null,
    };
  });

/** Maps a validated command onto the database function's arguments. */
export const liveRunActionRpcArgs = (runId: string, input: LiveRunActionInput): LiveRunActionRpcArgs => ({
  p_run_id: runId,
  p_action: input.action,
  p_client_id: input.client_id,
  p_expected_revision: input.action === 'renew' ? null : input.expected_revision,
  p_action_id: input.action === 'renew' ? null : input.action_id,
  p_target_index: input.action === 'jump' ? input.target_index : null,
  p_reason: input.action === 'discard' || input.action === 'take_over' ? (input.reason ?? null) : null,
  p_countdown_policy: input.action === 'set_policy' ? input.countdown_policy : null,
});
