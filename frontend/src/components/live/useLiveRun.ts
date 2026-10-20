import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  LIVE_ACTIVE_POLL_MS,
  LIVE_IDLE_POLL_MS,
  LIVE_RENEW_INTERVAL_MS,
  LIVE_STALE_AFTER_MS,
  deriveLiveView,
  estimateClockOffset,
  liveControlStatus,
  type LiveControlStatus,
  type LiveRunActionInput,
  type LiveRunState,
  type LiveView,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useErrorText } from '../../i18n';

const CLIENT_KEY = 'service-center.live-client-id';

/**
 * This browser tab's Live client id. Kept for the tab's session so a reload
 * keeps control; another tab is another client and must take control.
 */
export const liveClientId = (() => {
  let cached: string | null = null;
  return (): string => {
    if (cached) return cached;
    try {
      cached = sessionStorage.getItem(CLIENT_KEY);
      if (!cached) {
        cached = crypto.randomUUID();
        sessionStorage.setItem(CLIENT_KEY, cached);
      }
    } catch {
      // Storage blocked (private mode): this page load is its own client.
      cached = crypto.randomUUID();
    }
    return cached;
  };
})();

/** A state read with the clock offset measured on that request. */
export interface LiveStateReading {
  state: LiveRunState;
  /** Add to `Date.now()` to get the database clock. */
  offsetMs: number;
  /** Local time the response arrived. */
  receivedAt: number;
}

/** A command without the fields the hook fills in (client, action id, revision). */
export type LiveCommand =
  | { action: 'start' | 'advance' | 'pause' | 'resume' | 'end' | 'take_control' | 'release_control' | 'refresh_snapshot' }
  | { action: 'jump'; target_index: number }
  | { action: 'take_over'; reason?: string }
  | { action: 'discard'; reason: string }
  | { action: 'set_policy'; countdown_policy: 'item' | 'planned_end' | 'service_end' };

/** How current the viewer's copy of the run is. */
export type LiveConnection = 'live' | 'stale' | 'offline' | 'revoked';

export interface LiveRunHandle {
  /** The last authoritative state, or null before the first read / after access is lost. */
  state: LiveRunState | null;
  view: LiveView | null;
  control: LiveControlStatus | null;
  connection: LiveConnection;
  /** Seconds since the last successful read. */
  lastUpdatedSecondsAgo: number | null;
  loading: boolean;
  loadError: unknown;
  /** The server-corrected current time. */
  nowMs: number;
  send: (command: LiveCommand) => void;
  /** Re-sends the last failed command with the same action id (safe: a repeat is never applied twice). */
  retry: (() => void) | null;
  pending: LiveCommand | null;
  /** Why the last command was not applied (the refusal or failure; null when none). Shown with `useLiveRefusalText`. */
  commandError: unknown;
  clearCommandError: () => void;
}

const isAccessLoss = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 404 || error.status === 403);

/** Text for refusals, in the displayed language: each one means nothing was applied. */
export const useLiveRefusalText = (): ((error: unknown) => string) => {
  const { t } = useTranslation('media');
  const errorText = useErrorText();
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        switch (error.code) {
          case 'run_revision_stale':
            return t('live.refusal.revisionStale');
          case 'run_control_lost':
            return t('live.refusal.controlLost');
          case 'run_control_held':
          case 'run_state_invalid':
          case 'idempotency_key_reused':
            return t('live.refusal.notApplied', { reason: errorText(error) });
          default:
            return errorText(error);
        }
      }
      return t('live.refusal.network');
    },
    [t, errorText],
  );
};

export const useLiveRun = (runId: string | null): LiveRunHandle => {
  const { organizationId, user } = useAuth();
  const userId = user?.profile.id ?? null;
  const queryClient = useQueryClient();
  const clientId = liveClientId();
  const queryKey = useMemo(() => keys.liveRun(organizationId, runId ?? ''), [organizationId, runId]);

  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [localNow, setLocalNow] = useState(() => Date.now());
  const [pending, setPending] = useState<LiveCommand | null>(null);
  const [commandError, setCommandError] = useState<unknown>(null);
  const failed = useRef<LiveRunActionInput | null>(null);
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const tick = window.setInterval(() => setLocalNow(Date.now()), 250);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.clearInterval(tick);
    };
  }, []);

  const query = useQuery({
    queryKey,
    enabled: Boolean(organizationId && runId),
    queryFn: async (): Promise<LiveStateReading> => {
      const requestStartedAt = Date.now();
      const state = await api.liveRunState(runId!);
      const receivedAt = Date.now();
      return { state, offsetMs: estimateClockOffset({ serverNow: state.server_now, requestStartedAt, responseReceivedAt: receivedAt }), receivedAt };
    },
    refetchInterval: (q) => {
      const status = q.state.data?.state.run.status;
      if (isAccessLoss(q.state.error)) return false;
      return status === 'live' || status === 'paused' ? LIVE_ACTIVE_POLL_MS : LIVE_IDLE_POLL_MS;
    },
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: (count, error) => !isAccessLoss(error) && count < 2,
  });

  // Losing access drops the cached run at once: nothing private stays on screen.
  const revoked = isAccessLoss(query.error);
  useEffect(() => {
    if (revoked) queryClient.removeQueries({ queryKey, exact: true });
  }, [revoked, queryClient, queryKey]);

  const reading = revoked ? null : (query.data ?? null);
  const state = reading?.state ?? null;
  const nowMs = localNow + (reading?.offsetMs ?? 0);
  const view = state ? deriveLiveView(state.run, nowMs) : null;
  const control = state ? liveControlStatus(state.run, userId, clientId, nowMs) : null;

  const accept = useCallback(
    (next: LiveRunState, requestStartedAt: number) => {
      const receivedAt = Date.now();
      queryClient.setQueryData<LiveStateReading>(queryKey, {
        state: next,
        offsetMs: estimateClockOffset({ serverNow: next.server_now, requestStartedAt, responseReceivedAt: receivedAt }),
        receivedAt,
      });
    },
    [queryClient, queryKey],
  );

  const command = useMutation({
    mutationFn: async (input: LiveRunActionInput) => {
      const requestStartedAt = Date.now();
      return { next: await api.liveRunAction(runId!, input), requestStartedAt };
    },
    onSuccess: ({ next, requestStartedAt }) => {
      failed.current = null;
      setCanRetry(false);
      setCommandError(null);
      accept(next, requestStartedAt);
    },
    onError: (error, input) => {
      // A refusal is final (nothing applied); a network failure may be retried with the same id.
      const networkFailure = !(error instanceof ApiError);
      failed.current = networkFailure ? input : null;
      setCanRetry(networkFailure);
      setCommandError(error);
      void queryClient.invalidateQueries({ queryKey, exact: true });
    },
    onSettled: () => setPending(null),
  });

  const send = useCallback(
    (cmd: LiveCommand) => {
      if (!state || command.isPending) return;
      setPending(cmd);
      setCommandError(null);
      command.mutate({
        ...cmd,
        client_id: clientId,
        action_id: crypto.randomUUID(),
        expected_revision: state.run.revision,
      } as LiveRunActionInput);
    },
    [state, command, clientId],
  );

  const retry = useCallback(() => {
    if (!failed.current || command.isPending) return;
    const input = failed.current;
    setPending(input.action === 'renew' ? null : (input as LiveCommand));
    command.mutate(input);
  }, [command]);

  // The controlling tab keeps its lease; losing it is shown, never hidden.
  const heldByMe = control?.held_by_you ?? false;
  useEffect(() => {
    if (!heldByMe || !runId) return undefined;
    const renew = async () => {
      const requestStartedAt = Date.now();
      try {
        accept(await api.liveRunAction(runId, { action: 'renew', client_id: clientId }), requestStartedAt);
      } catch (error) {
        if (error instanceof ApiError) {
          setCommandError(error);
          void queryClient.invalidateQueries({ queryKey, exact: true });
        }
      }
    };
    const timer = window.setInterval(() => void renew(), LIVE_RENEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [heldByMe, runId, clientId, accept, queryClient, queryKey]);

  const lastUpdatedSecondsAgo = reading ? Math.max(0, Math.floor((localNow - reading.receivedAt) / 1000)) : null;
  const connection: LiveConnection = revoked
    ? 'revoked'
    : !online
      ? 'offline'
      : reading && localNow - reading.receivedAt > LIVE_STALE_AFTER_MS
        ? 'stale'
        : 'live';

  return {
    state,
    view,
    control,
    connection,
    lastUpdatedSecondsAgo,
    loading: query.isLoading,
    loadError: revoked ? null : query.error,
    nowMs,
    send,
    retry: canRetry ? retry : null,
    pending,
    commandError,
    clearCommandError: () => setCommandError(null),
  };
};
