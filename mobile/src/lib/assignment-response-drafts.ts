import {
  ApiError,
  ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH,
  selfResponseTransition,
  type AssignmentStatus,
  type RespondToAssignmentRequest,
  type SelfResponseStatus,
} from '@service-center/shared';

/**
 * Which review step an assignment's controls are showing. Declining and
 * withdrawing both ask for an optional reason before anything is sent.
 */
export type ResponseDraftMode = 'idle' | 'declining' | 'withdrawing';

/** The in-progress answer for one assignment, keyed by assignment ID. */
export interface ResponseDraft {
  mode: ResponseDraftMode;
  reason: string;
  /** The exact request in flight or last attempted, so a retry resends it unchanged. */
  request: RespondToAssignmentRequest | null;
  pending: boolean;
  error: ResponseFailure | null;
}

export type ResponseFailureKind = 'stale' | 'forbidden' | 'invalid' | 'network';

/** Catalog entries (`scheduling:responses.failure.*`) for failures the app words itself. */
export type ResponseFailureMessageKey = 'stale' | 'unavailable' | 'network';

export interface ResponseFailure {
  kind: ResponseFailureKind;
  /** English fallback text, or the server's own sentence when `messageKey` is absent. */
  message: string;
  /** Set when the app owns the wording; the screen translates it. */
  messageKey?: ResponseFailureMessageKey;
}

export type ResponseDrafts = Readonly<Record<string, ResponseDraft>>;

export type ResponseDraftAction =
  | { type: 'open'; assignmentId: string; mode: Exclude<ResponseDraftMode, 'idle'> }
  | { type: 'cancel'; assignmentId: string }
  | { type: 'reason'; assignmentId: string; reason: string }
  | { type: 'submit'; assignmentId: string; request: RespondToAssignmentRequest }
  | { type: 'succeeded'; assignmentId: string }
  | { type: 'failed'; assignmentId: string; error: ResponseFailure }
  | { type: 'reset' };

export const emptyDraft: ResponseDraft = {
  mode: 'idle',
  reason: '',
  request: null,
  pending: false,
  error: null,
};

export const draftFor = (drafts: ResponseDrafts, assignmentId: string): ResponseDraft =>
  drafts[assignmentId] ?? emptyDraft;

const withDraft = (
  drafts: ResponseDrafts,
  assignmentId: string,
  update: (draft: ResponseDraft) => ResponseDraft,
): ResponseDrafts => ({ ...drafts, [assignmentId]: update(draftFor(drafts, assignmentId)) });

const withoutDraft = (drafts: ResponseDrafts, assignmentId: string): ResponseDrafts => {
  const { [assignmentId]: _removed, ...rest } = drafts;
  return rest;
};

export const responseDraftsReducer = (
  drafts: ResponseDrafts,
  action: ResponseDraftAction,
): ResponseDrafts => {
  switch (action.type) {
    case 'open':
      return withDraft(drafts, action.assignmentId, (draft) =>
        draft.pending ? draft : { ...draft, mode: action.mode, error: null },
      );
    case 'cancel':
      return draftFor(drafts, action.assignmentId).pending
        ? drafts
        : withoutDraft(drafts, action.assignmentId);
    case 'reason':
      return withDraft(drafts, action.assignmentId, (draft) =>
        draft.pending ? draft : { ...draft, reason: action.reason },
      );
    case 'submit':
      // A second tap while the first is in flight is ignored, not queued.
      if (draftFor(drafts, action.assignmentId).pending) return drafts;
      return withDraft(drafts, action.assignmentId, (draft) => ({
        ...draft,
        request: action.request,
        pending: true,
        error: null,
      }));
    case 'succeeded':
      return withoutDraft(drafts, action.assignmentId);
    case 'failed':
      // The reason and review step stay exactly as typed, ready to retry.
      return withDraft(drafts, action.assignmentId, (draft) => ({
        ...draft,
        pending: false,
        error: action.error,
      }));
    case 'reset':
      return {};
  }
};

/**
 * The request for an answer. Always carries the status the person was looking
 * at, so the server refuses it if the assignment changed in the meantime.
 */
export const buildResponseRequest = (
  current: AssignmentStatus,
  status: SelfResponseStatus,
  reason: string,
): RespondToAssignmentRequest => {
  const trimmed = reason.trim();
  return {
    status,
    expected_status: current,
    ...(status === 'declined' && trimmed ? { reason: trimmed } : {}),
  };
};

/** Client-side check matching the shared schema, so the draft is never lost to a 422. */
export const reasonTooLong = (reason: string): boolean =>
  reason.trim().length > ASSIGNMENT_RESPONSE_REASON_MAX_LENGTH;

/** Whether this answer needs the deliberate withdrawal review first. */
export const isWithdrawal = (current: AssignmentStatus, status: SelfResponseStatus): boolean =>
  selfResponseTransition(current, status) === 'withdrawal';

export const describeResponseFailure = (error: unknown): ResponseFailure => {
  if (error instanceof ApiError) {
    if (error.code === 'assignment_response_stale') {
      return {
        kind: 'stale',
        message: 'This position changed since you opened it. It has been refreshed — review it and answer again.',
        messageKey: 'stale',
      };
    }
    if (error.code === 'assignment_response_forbidden' || error.status === 409) {
      return { kind: 'forbidden', message: error.message };
    }
    if (error.status === 422 || error.status === 400) {
      return { kind: 'invalid', message: error.message };
    }
    if (error.status === 404 || error.status === 403) {
      return { kind: 'forbidden', message: 'This position is no longer available to you.', messageKey: 'unavailable' };
    }
  }
  return {
    kind: 'network',
    message: 'Your answer may not have been saved. Check your connection and try again.',
    messageKey: 'network',
  };
};
