import {
  computeRunActuals,
  serviceTimesOf,
  type CorrectLiveRunTimeInput,
  type CreateLiveRunInput,
  type LivePlanRuns,
  type LiveRunActionInput,
  type LiveRunCorrectionRow,
  type LiveRunHistory,
  type LiveRunState,
  type LiveRunStateRecord,
  type LiveRunTransitionRow,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { unwrap, type Db } from '../lib/supabase.js';
import {
  LIVE_RUN_SUMMARY_COLUMNS,
  liveRunActionRpcArgs,
  liveServiceTimeOptions,
  toLiveRun,
  toLiveRunState,
  type LiveRunSummaryRow,
  type LiveServiceTimeRow,
} from '../model/live-run.model.js';

/** The caller's RLS-bound client and active organization. */
export interface LiveCaller {
  db: Db;
  orgId: string;
}

/** The run as the caller may read it, in the active organization only. */
const readRunRecord = async ({ db, orgId }: LiveCaller, runId: string): Promise<LiveRunStateRecord> => {
  const { data, error } = await db.rpc('live_run_state', { p_run_id: runId });
  if (error) throw fromPostgrestError(error);
  if (!data || data.run.organization_id !== orgId) throw HttpError.notFound('Run not found');
  return data;
};

export const getLiveRunState = async (caller: LiveCaller, runId: string, replayed?: boolean): Promise<LiveRunState> =>
  toLiveRunState(await readRunRecord(caller, runId), replayed);

/** `GET /plans/:id/runs`: each service time with its run, and every run newest first. */
export const listPlanLiveRuns = async ({ db, orgId }: LiveCaller, planId: string): Promise<LivePlanRuns> => {
  const plan = await unwrap(
    db.from('plans').select('id, content_revision').eq('id', planId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const [times, runs, canControl, serverNow] = await Promise.all([
    unwrap(db.from('plan_times').select('id, kind, name, starts_at, ends_at').eq('plan_id', planId)),
    unwrap(
      db
        .from('live_runs')
        .select(LIVE_RUN_SUMMARY_COLUMNS)
        .eq('plan_id', planId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true }),
    ),
    db.rpc('can_edit_plan', { p_plan: planId }),
    db.rpc('live_server_now', {}),
  ]);
  if (canControl.error) throw fromPostgrestError(canControl.error);
  if (serverNow.error) throw fromPostgrestError(serverNow.error);

  const summaries = (runs ?? []) as LiveRunSummaryRow[];
  const services: LiveServiceTimeRow[] = serviceTimesOf(times ?? []).map(({ id, name, starts_at, ends_at }) => ({
    id,
    name,
    starts_at,
    ends_at,
  }));
  return {
    service_times: liveServiceTimeOptions(services, summaries),
    runs: summaries,
    plan_content_revision: plan.content_revision,
    can_control: canControl.data === true,
    server_now: serverNow.data,
  };
};

/** Creates the run of one service time (or returns it for a repeated key). The creator holds control. */
export const createLiveRun = async (
  caller: LiveCaller,
  planId: string,
  input: CreateLiveRunInput,
): Promise<LiveRunState> => {
  const plan = await unwrap(
    caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  const { data, error } = await caller.db.rpc('create_live_run', {
    p_plan_id: planId,
    p_plan_time_id: input.plan_time_id,
    p_countdown_policy: input.countdown_policy,
    p_idempotency_key: input.idempotency_key,
    p_client_id: input.client_id,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Plan not found');
  return getLiveRunState(caller, data.run.id, data.replayed);
};

/**
 * One serialized command. Every refusal (stale revision, lost lease, wrong
 * status) is an error with nothing applied; the response is always the
 * authoritative state read after the command.
 */
export const actOnLiveRun = async (caller: LiveCaller, runId: string, input: LiveRunActionInput): Promise<LiveRunState> => {
  await readRunRecord(caller, runId);
  const { data, error } = await caller.db.rpc('live_run_action', liveRunActionRpcArgs(runId, input));
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Run not found');
  return getLiveRunState(caller, runId, data.replayed);
};

/** History, corrections and planned-versus-actual for one run. */
export const getLiveRunHistory = async (caller: LiveCaller, runId: string): Promise<LiveRunHistory> => {
  const record = await readRunRecord(caller, runId);
  const [transitions, corrections] = await Promise.all([
    unwrap(caller.db.from('live_run_transitions').select('*').eq('run_id', runId).order('id', { ascending: true })),
    unwrap(caller.db.from('live_run_corrections').select('*').eq('run_id', runId).order('id', { ascending: true })),
  ]);
  const run = toLiveRun(record.run);
  const history = (transitions ?? []) as LiveRunTransitionRow[];
  const fixes = (corrections ?? []) as LiveRunCorrectionRow[];
  const inProgress = run.status === 'live' || run.status === 'paused';
  return {
    run,
    transitions: history,
    corrections: fixes,
    actuals: computeRunActuals(run, history, fixes, inProgress ? Date.parse(record.server_now) : undefined),
    server_now: record.server_now,
    can_control: record.can_control,
  };
};

/** Appends an audited correction to one recorded time of an ended run. */
export const correctLiveRunTime = async (
  caller: LiveCaller,
  runId: string,
  input: CorrectLiveRunTimeInput,
): Promise<LiveRunHistory> => {
  await readRunRecord(caller, runId);
  const { error } = await caller.db.rpc('correct_live_run_time', {
    p_run_id: runId,
    p_transition_id: input.transition_id,
    p_corrected_at: input.corrected_at,
    p_reason: input.reason,
    p_expected_revision: input.expected_revision,
  });
  if (error) throw fromPostgrestError(error);
  return getLiveRunHistory(caller, runId);
};
