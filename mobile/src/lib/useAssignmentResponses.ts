import { useCallback, useEffect, useReducer } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AssignmentStatus, SelfResponseStatus } from '@service-center/shared';
import { api } from './api';
import { queryKeys } from './query-keys';
import { useAuth } from '../providers/AuthProvider';
import {
  buildResponseRequest,
  describeResponseFailure,
  draftFor,
  reasonTooLong,
  responseDraftsReducer,
  type ResponseDraft,
  type ResponseDraftMode,
} from './assignment-response-drafts';

/** What the response controls need for one screen's worth of assignments. */
export interface AssignmentResponses {
  draft: (assignmentId: string) => ResponseDraft;
  open: (assignmentId: string, mode: Exclude<ResponseDraftMode, 'idle'>) => void;
  cancel: (assignmentId: string) => void;
  setReason: (assignmentId: string, reason: string) => void;
  /** Sends one answer. Each assignment is independent; nothing is batched. */
  respond: (assignmentId: string, current: AssignmentStatus, status: SelfResponseStatus) => void;
  /** Resends exactly the request that last failed for this assignment. */
  retry: (assignmentId: string) => void;
}

/**
 * Per-assignment answer state. Every assignment has its own pending/error
 * flag and draft reason, so a failure on one position never reads as a
 * failure — or a success — on another.
 */
export const useAssignmentResponses = (planId?: string): AssignmentResponses => {
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const [drafts, dispatch] = useReducer(responseDraftsReducer, {});

  // A different account or organization starts with no drafts at all.
  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [generation]);

  const refreshAffected = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications(queryScope) }),
      planId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, planId) })
        : queryClient.invalidateQueries({ queryKey: [...queryKeys.privateRoot(queryScope), 'plan'] }),
    ]);
  }, [planId, queryClient, queryScope]);

  const send = useCallback(
    async (assignmentId: string, request: ReturnType<typeof buildResponseRequest>) => {
      dispatch({ type: 'submit', assignmentId, request });
      try {
        await api.respondToAssignment(assignmentId, request);
        if (!isCurrentGeneration(generation)) return;
        await refreshAffected();
        if (isCurrentGeneration(generation)) dispatch({ type: 'succeeded', assignmentId });
      } catch (error) {
        if (!isCurrentGeneration(generation)) return;
        const failure = describeResponseFailure(error);
        dispatch({ type: 'failed', assignmentId, error: failure });
        // The server says the assignment moved on; show what it is now.
        if (failure.kind !== 'network') void refreshAffected();
      }
    },
    [generation, isCurrentGeneration, refreshAffected],
  );

  const respond = useCallback(
    (assignmentId: string, current: AssignmentStatus, status: SelfResponseStatus) => {
      const draft = draftFor(drafts, assignmentId);
      if (draft.pending) return;
      if (status === 'declined' && reasonTooLong(draft.reason)) return;
      void send(assignmentId, buildResponseRequest(current, status, draft.reason));
    },
    [drafts, send],
  );

  const retry = useCallback(
    (assignmentId: string) => {
      const draft = draftFor(drafts, assignmentId);
      if (draft.pending || !draft.request) return;
      void send(assignmentId, draft.request);
    },
    [drafts, send],
  );

  return {
    draft: useCallback((assignmentId: string) => draftFor(drafts, assignmentId), [drafts]),
    open: useCallback((assignmentId, mode) => dispatch({ type: 'open', assignmentId, mode }), []),
    cancel: useCallback((assignmentId) => dispatch({ type: 'cancel', assignmentId }), []),
    setReason: useCallback(
      (assignmentId, reason) => dispatch({ type: 'reason', assignmentId, reason }),
      [],
    ),
    respond,
    retry,
  };
};
