import type { AssignmentStatus } from '../types/database.js';

/** An answer a scheduled person can give to their own assignment. */
export type SelfResponseStatus = Extract<AssignmentStatus, 'confirmed' | 'declined'>;

/**
 * What answering would do to an assignment currently in some status.
 *
 * - `answer`: the first reply to an unconfirmed request.
 * - `withdrawal`: declining a position already confirmed; clients must make
 *   the person review this deliberately.
 * - `unchanged`: the assignment already holds that answer (e.g. a retry after
 *   a timeout whose first attempt committed). Nothing is written.
 * - `forbidden`: only a scheduler can change it — a declined assignment is
 *   re-requested or reassigned, never silently re-accepted.
 *
 * The database trigger `guard_assignment_self_response` enforces the same
 * rule for direct table access; keep the two in step.
 */
export type SelfResponseTransition = 'answer' | 'withdrawal' | 'unchanged' | 'forbidden';

export const selfResponseTransition = (
  current: AssignmentStatus,
  requested: SelfResponseStatus,
): SelfResponseTransition => {
  if (current === requested) return 'unchanged';
  if (current === 'unconfirmed') return 'answer';
  if (current === 'confirmed' && requested === 'declined') return 'withdrawal';
  return 'forbidden';
};

/** The answers a person may give from an assignment's current status. */
export const allowedSelfResponses = (current: AssignmentStatus): readonly SelfResponseStatus[] => {
  if (current === 'unconfirmed') return ['confirmed', 'declined'];
  if (current === 'confirmed') return ['declined'];
  return [];
};
