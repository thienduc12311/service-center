import { useEffect } from 'react';
import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { conversationPostOutcome, type ConversationMessage } from '@service-center/shared';
import { useAuth } from '../providers/AuthProvider';
import { api } from './api';
import type { ConversationDraft } from './conversation-drafts';
import { newIdempotencyKey } from './idempotency';
import { queryKeys } from './query-keys';

export type SubmittedMessage = ConversationDraft & { createdAt: string };

interface ConversationSendOptions {
  conversationId: string;
  known: readonly ConversationMessage[];
  canSend: () => boolean;
  onConfirmed: (message: ConversationMessage) => Promise<void>;
  refresh: () => Promise<void>;
}

/** One message in flight or failed, as shown below the thread. */
export interface OutgoingAttempt {
  sent: SubmittedMessage;
  status: 'idle' | 'pending' | 'success' | 'error';
  error: Error | null;
}

export interface ConversationSend {
  outgoing: OutgoingAttempt[];
  /** Starts a background send; false when the draft cannot be sent now. */
  submit: (draft: ConversationDraft) => boolean;
  retry: (sent: SubmittedMessage, error: unknown) => void;
  dismiss: (id: string) => void;
}

export function useConversationSend(
  { conversationId, known, canSend, onConfirmed, refresh }: ConversationSendOptions,
): ConversationSend {
  const client = useQueryClient();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const mutationKey = queryKeys.conversationSend(queryScope, conversationId);
  const cache = client.getMutationCache();
  const active = () => Boolean(queryScope && isCurrentGeneration(generation) && canSend());
  const attemptsFor = (id: string) => cache.findAll({
    mutationKey,
    exact: true,
    predicate: ({ state }) => (state.variables as SubmittedMessage | undefined)?.id === id,
  });

  const post = useMutation({
    mutationKey,
    // Keep failed messages available after navigating away, within this session.
    gcTime: Infinity,
    networkMode: 'always',
    mutationFn: (sent: SubmittedMessage) => {
      if (!active()) throw new Error('Conversation session is no longer active');
      return api.postConversationMessage(conversationId, {
        id: sent.id,
        body: sent.body,
        reply_to_id: sent.replyToId,
        mention_person_ids: sent.mentionIds,
      });
    },
    onSuccess: async ({ item }, sent) => {
      if (active()) await onConfirmed(item);
      for (const attempt of attemptsFor(sent.id)) cache.remove(attempt);
      if (active()) void refresh();
    },
    onError: () => {
      // The server may have saved the message before losing the response.
      if (active()) void refresh();
    },
  });
  const attempts = useMutationState<OutgoingAttempt>({
    filters: { mutationKey, exact: true, predicate: ({ state }) => state.status === 'pending' || state.status === 'error' },
    select: ({ state }) => ({ sent: state.variables as SubmittedMessage, status: state.status, error: state.error }),
  });
  const confirmed = new Set(known.filter((message) => message.is_mine).map((message) => message.id));

  useEffect(() => {
    // A broadcast or background read can confirm a message with a lost response.
    for (const { sent, status } of attempts) {
      if (status === 'error' && confirmed.has(sent.id)) dismiss(sent.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, known]);

  function dismiss(id: string) {
    for (const attempt of attemptsFor(id)) {
      if (attempt.state.status === 'error') cache.remove(attempt);
    }
  }

  function enqueue(sent: SubmittedMessage) {
    if (!active() || !sent.body || attemptsFor(sent.id).some(({ state }) => state.status === 'pending')) return false;
    post.mutate(sent);
    return true;
  }

  return {
    outgoing: attempts.filter(({ sent }) => !confirmed.has(sent.id)),
    submit: (draft: ConversationDraft) => enqueue({ ...draft, body: draft.body.trim(), createdAt: new Date().toISOString() }),
    retry: (sent: SubmittedMessage, error: unknown) => {
      if (confirmed.has(sent.id) || !attemptsFor(sent.id).some(({ state }) => state.status === 'error')) return;
      const outcome = conversationPostOutcome(error);
      const retryDraft = {
        ...sent,
        id: outcome === 'newId' ? newIdempotencyKey() : sent.id,
        replyToId: outcome === 'gone' ? null : sent.replyToId,
      };
      if (enqueue(retryDraft)) dismiss(sent.id);
    },
    dismiss,
  };
}
