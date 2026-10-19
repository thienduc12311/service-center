import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LIVE_POLICY_LABELS,
  LIVE_STATUS_LABELS,
  type LiveCountdownPolicy,
  type LiveRunState,
  type LiveServiceTimeOption,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useLivePlanRuns, usePlan } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { LiveRunPanel } from '../components/live/LiveRunPanel';
import { LiveHistoryPanel } from '../components/live/LiveHistoryPanel';
import { LiveStageDisplay } from '../components/live/LiveStageDisplay';
import { liveClientId, useLiveRun } from '../components/live/useLiveRun';

const when = (iso: string): string => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

interface CreateRunVariables {
  time: LiveServiceTimeOption;
  policy: LiveCountdownPolicy;
  key: string;
}

/**
 * F12 Live: pick a service time, then follow (or control) its run. State is
 * polled from the API (the authority); every timer is derived from server
 * timestamps, so viewers converge after any reconnect.
 */
export const LivePage = () => {
  const { planId } = useParams<{ planId: string }>();
  const [params, setParams] = useSearchParams();
  const runId = params.get('run');
  const navigate = useNavigate();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const plan = usePlan(planId);
  const runs = useLivePlanRuns(planId);
  const live = useLiveRun(runId);
  const [policy, setPolicy] = useState<LiveCountdownPolicy>('item');
  const [stage, setStage] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // One key per create attempt; a retry after a lost response returns the same run.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: ({ time, policy: countdown, key }: CreateRunVariables) =>
      api.createLiveRun(planId!, {
        plan_time_id: time.id,
        countdown_policy: countdown,
        idempotency_key: key,
        client_id: liveClientId(),
      }),
    onSuccess: (state: LiveRunState) => {
      setPendingKey(null);
      void queryClient.invalidateQueries({ queryKey: keys.liveRuns(organizationId, planId!) });
      setParams({ run: state.run.id });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.liveRuns(organizationId, planId!) }),
  });

  const openChat = useMutation({
    mutationFn: () => api.openConversation({ kind: 'plan', target_id: planId! }),
    onSuccess: (conversation) => navigate(`/chat/${conversation.id}`),
  });

  const closeStage = useCallback(() => setStage(false), []);

  if (runs.isLoading) return <Loading />;
  if (runs.error || !runs.data) return <ErrorNotice error={runs.error ?? new Error('Plan not found')} />;

  const data = runs.data;
  const selected = runId ? data.runs.find((run) => run.id === runId) : undefined;
  const earlier = data.runs.filter((run) => run.status === 'discarded' || run.status === 'ended');

  return (
    <div>
      <PageHeader
        title={`Live — ${plan.data?.title ?? 'Plan'}`}
        subtitle={<Link to={`/plans/${planId}`} className="text-brand-700 hover:underline">← Back to the plan</Link>}
        actions={
          <Button variant="secondary" loading={openChat.isPending} onClick={() => openChat.mutate()}>
            Plan chat
          </Button>
        }
      />
      <ErrorNotice error={openChat.error ? new Error('Plan chat is open to plan leaders and the people scheduled on this plan.') : null} />

      <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
        <aside className="space-y-4" aria-label="Service times">
          <h2 className="text-sm font-semibold text-slate-700">Service times</h2>
          {data.service_times.length === 0 && (
            <p className="text-sm text-slate-500">This plan has no service time. Add one on the plan before running Live.</p>
          )}
          <ul className="space-y-2">
            {data.service_times.map((time) => (
              <li key={time.id} className={`card p-3 ${time.run_id && time.run_id === runId ? 'ring-2 ring-brand-500' : ''}`}>
                <p className="text-sm font-medium text-slate-800">{time.name ?? 'Service'}</p>
                <p className="text-xs text-slate-500">{when(time.starts_at)}</p>
                {time.run_id ? (
                  <Button variant="secondary" className="mt-2 w-full" onClick={() => setParams({ run: time.run_id! })}>
                    {time.run_id === runId ? 'Showing' : 'Open'} · {LIVE_STATUS_LABELS[time.run_status!]}
                  </Button>
                ) : data.can_control ? (
                  <Button
                    className="mt-2 w-full"
                    loading={create.isPending && create.variables?.time.id === time.id}
                    disabled={create.isPending}
                    onClick={() => {
                      const key = pendingKey ?? crypto.randomUUID();
                      setPendingKey(key);
                      create.mutate({ time, policy, key });
                    }}
                  >
                    Create run
                  </Button>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">No run yet.</p>
                )}
              </li>
            ))}
          </ul>
          {data.can_control && (
            <label className="field">
              Countdown for new runs
              <select className="input" value={policy} onChange={(event) => setPolicy(event.target.value as LiveCountdownPolicy)}>
                {(Object.keys(LIVE_POLICY_LABELS) as LiveCountdownPolicy[]).map((option) => (
                  <option key={option} value={option}>{LIVE_POLICY_LABELS[option]}</option>
                ))}
              </select>
            </label>
          )}
          <ErrorNotice error={create.error} />
          {earlier.length > 0 && (
            <div>
              <h2 className="mt-4 text-sm font-semibold text-slate-700">Run history</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {earlier.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className={`text-left hover:underline ${run.id === runId ? 'font-semibold text-brand-700' : 'text-slate-600'}`}
                      onClick={() => setParams({ run: run.id })}
                    >
                      {run.time_name ?? 'Service'} · {LIVE_STATUS_LABELS[run.status]}
                      {run.started_at ? ` · ${when(run.started_at)}` : ''}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <main className="min-w-0 space-y-6">
          {!runId && (
            <EmptyState
              title="Choose a service time"
              description={
                data.can_control
                  ? 'Each service time has its own run. Create one to pin the current order and control it here.'
                  : 'Open a service time’s run to follow it. Only people who can edit this plan control Live.'
              }
            />
          )}
          {runId && live.connection === 'revoked' && (
            <EmptyState title="This run is not available" description="It was removed or you no longer have access to it." />
          )}
          {runId && live.loading && <Loading label="Loading the run…" />}
          <ErrorNotice error={live.loadError} />
          {runId && live.state && (
            <>
              <LiveRunPanel live={live} onStage={() => setStage(true)} />
              <div>
                <Button variant="secondary" onClick={() => setShowHistory((open) => !open)}>
                  {showHistory ? 'Hide history and actual times' : 'History and actual times'}
                </Button>
              </div>
              {showHistory && <LiveHistoryPanel runId={runId} revision={live.state.run.revision} />}
            </>
          )}
          {runId && !selected && !live.state && !live.loading && live.connection !== 'revoked' && (
            <p className="text-sm text-slate-500">That run is not part of this plan.</p>
          )}
        </main>
      </div>

      {stage && <LiveStageDisplay live={live} onClose={closeStage} />}
    </div>
  );
};
