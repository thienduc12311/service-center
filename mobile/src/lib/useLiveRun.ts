import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LIVE_FALLBACK_POLL_MS,
  LIVE_RENEW_INTERVAL_MS,
  deriveLiveView,
  estimateClockOffset,
  liveControlStatus,
  latestLiveReading,
  type LiveStateReading,
  type LiveControlStatus,
  type LiveRunActionInput,
  type LiveRunState,
  type LiveView,
} from '@service-center/shared';
import { api } from './api';
import { newIdempotencyKey } from './idempotency';
import { queryKeys } from './query-keys';
import { useBroadcastRefresh } from './useBroadcastRefresh';
import { useScreenVisible } from './useScreenVisible';
import {
  buildLiveAction,
  buildLiveRenew,
  isLiveAccessLoss,
  liveClientId,
  liveCommandOutcome,
  liveConnection,
  type LiveCommand,
  type LiveConnection,
} from './live-run';
import { useAuth } from '../providers/AuthProvider';

/** How often the displayed timers are recomputed from the last state (memory only). */
const TICK_MS = 250;

export interface LiveRunHandle {
  /** The last authoritative state; null before the first read or once access is lost. */
  state: LiveRunState | null;
  view: LiveView | null;
  control: LiveControlStatus | null;
  connection: LiveConnection;
  /** Seconds since the last successful read. */
  lastUpdatedSecondsAgo: number | null;
  loading: boolean;
  loadError: unknown;
  send: (command: LiveCommand) => void;
  /** Re-sends the last unanswered command with the same action id; null when there is none. */
  retry: (() => void) | null;
  pending: LiveCommand | null;
  /** Why the last command was not applied; null when none. */
  commandError: unknown;
  clearCommandError: () => void;
  /** Read the authoritative state now (after "Try again"). */
  reload: () => void;
}

const useAppActive = (): boolean => {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => setActive(status === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
};

/**
 * MOB-023: follow (and, with the lease, control) one F12 run — the native
 * counterpart of the website's `useLiveRun`. Reads after a broadcast or
 * every minute while visible, adopts the state every command returns,
 * and renews the lease every 30 s while it holds control and the app is
 * active. Timers are derived from server timestamps with the measured clock
 * offset; nothing is stored per second.
 */
export const useLiveRun = (runId: string | null): LiveRunHandle => {
  const { queryScope, user, generation, isCurrentGeneration } = useAuth();
  const userId = user?.profile.id ?? null;
  const queryClient = useQueryClient();
  const clientId = liveClientId();
  const queryKey = useMemo(() => queryKeys.liveRun(queryScope, runId), [queryScope, runId]);
  const visible = useScreenVisible();
  const appActive = useAppActive();

  const [localNow, setLocalNow] = useState(() => Date.now());
  const [pending, setPending] = useState<LiveCommand | null>(null);
  const [commandError, setCommandError] = useState<unknown>(null);
  const [revokedRunId, setRevokedRunId] = useState<string | null>(null);
  const unanswered = useRef<{ input: LiveRunActionInput; command: LiveCommand } | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    if (!visible) return undefined;
    setLocalNow(Date.now());
    const tick = setInterval(() => setLocalNow(Date.now()), TICK_MS);
    return () => clearInterval(tick);
  }, [visible]);

  const query = useQuery({
    queryKey,
    enabled: Boolean(queryScope && runId && visible),
    staleTime: 0,
    queryFn: async (): Promise<LiveStateReading> => {
      const requestStartedAt = Date.now();
      const state = await api.liveRunState(runId!);
      const receivedAt = Date.now();
      return latestLiveReading(queryClient.getQueryData(queryKey), {
        state,
        offsetMs: estimateClockOffset({ serverNow: state.server_now, requestStartedAt, responseReceivedAt: receivedAt }),
        receivedAt,
      });
    },
    refetchInterval: (q) => visible && !isLiveAccessLoss(q.state.error) ? LIVE_FALLBACK_POLL_MS : false,
    retry: (count, error) => !isLiveAccessLoss(error) && count < 2,
  });

  const { refetch } = query;
  const revoked = isLiveAccessLoss(query.error) || (runId !== null && revokedRunId === runId);
  useBroadcastRefresh('live_run', runId && !revoked ? [runId] : [], visible, { queryKey, exact: true });
  // Losing access drops the cached run at once: nothing private stays on screen.
  useEffect(() => {
    if (revoked) queryClient.removeQueries({ queryKey, exact: true });
  }, [revoked, queryClient, queryKey]);

  const reading = revoked ? null : (query.data ?? null);
  const state = reading?.state ?? null;
  const nowMs = localNow + (reading?.offsetMs ?? 0);
  const view = state ? deriveLiveView(state.run, nowMs) : null;
  const control = state ? liveControlStatus(state.run, userId, clientId, nowMs) : null;
  const unreachable = query.isError && !isLiveAccessLoss(query.error) && query.errorUpdatedAt >= query.dataUpdatedAt;

  const accept = useCallback(
    (next: LiveRunState, requestStartedAt: number, commandGeneration: number) => {
      if (!isCurrentGeneration(commandGeneration)) return;
      if (next.run.id !== runId || next.run.organization_id !== queryScope?.organizationId ||
        isLiveAccessLoss(queryClient.getQueryState(queryKey)?.error)) return;
      const receivedAt = Date.now();
      queryClient.setQueryData<LiveStateReading>(queryKey, (previous) => latestLiveReading(previous, {
        state: next,
        offsetMs: estimateClockOffset({ serverNow: next.server_now, requestStartedAt, responseReceivedAt: receivedAt }),
        receivedAt,
      }));
    },
    [isCurrentGeneration, queryClient, queryKey, queryScope?.organizationId, runId],
  );

  const commandMutation = useMutation({
    mutationFn: async ({ input }: { input: LiveRunActionInput; command: LiveCommand; commandGeneration: number }) => {
      const requestStartedAt = Date.now();
      return { next: await api.liveRunAction(runId!, input), requestStartedAt };
    },
    gcTime: 0,
    onSuccess: ({ next, requestStartedAt }, { commandGeneration }) => {
      unanswered.current = null;
      setCanRetry(false);
      setCommandError(null);
      accept(next, requestStartedAt, commandGeneration);
    },
    onError: (error, variables) => {
      if (!isCurrentGeneration(variables.commandGeneration)) return;
      // A refusal is final (nothing applied); no answer may be re-sent with the same action id.
      const uncertain = liveCommandOutcome(error) === 'uncertain';
      unanswered.current = uncertain ? { input: variables.input, command: variables.command } : null;
      setCanRetry(uncertain);
      setCommandError(error);
      if (isLiveAccessLoss(error)) setRevokedRunId(runId);
      void queryClient.invalidateQueries({ queryKey, exact: true });
    },
    onSettled: () => setPending(null),
  });

  const send = useCallback(
    (command: LiveCommand) => {
      if (!state || commandMutation.isPending) return;
      setPending(command);
      setCommandError(null);
      const input = buildLiveAction(command, {
        clientId,
        actionId: newIdempotencyKey(),
        expectedRevision: state.run.revision,
      });
      commandMutation.mutate({ input, command, commandGeneration: generation });
    },
    [state, commandMutation, clientId, generation],
  );

  const retry = useCallback(() => {
    const last = unanswered.current;
    if (!last || commandMutation.isPending) return;
    setPending(last.command);
    commandMutation.mutate({ ...last, commandGeneration: generation });
  }, [commandMutation, generation]);

  // The controlling device keeps its lease while the app is in the foreground; losing it is shown, never hidden.
  const heldByMe = control?.held_by_you ?? false;
  useEffect(() => {
    if (!heldByMe || !runId || !appActive) return undefined;
    const renewGeneration = generation;
    const renew = async () => {
      const requestStartedAt = Date.now();
      try {
        accept(await api.liveRunAction(runId, buildLiveRenew(clientId)), requestStartedAt, renewGeneration);
      } catch (error) {
        // No answer: the next poll shows whether the lease is still held. A refusal is shown.
        if (liveCommandOutcome(error) === 'refused' && isCurrentGeneration(renewGeneration)) {
          setCommandError(error);
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }
      }
    };
    const timer = setInterval(() => void renew(), LIVE_RENEW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [heldByMe, runId, appActive, clientId, accept, generation, isCurrentGeneration, queryClient, queryKey]);

  return {
    state,
    view,
    control,
    connection: liveConnection({ revoked, unreachable, receivedAt: reading?.receivedAt ?? null, localNow }),
    lastUpdatedSecondsAgo: reading ? Math.max(0, Math.floor((localNow - reading.receivedAt) / 1000)) : null,
    loading: query.isLoading,
    loadError: revoked || unreachable ? null : query.error,
    send,
    retry: canRetry ? retry : null,
    pending,
    commandError,
    clearCommandError: () => setCommandError(null),
    reload: () => void refetch(),
  };
};
