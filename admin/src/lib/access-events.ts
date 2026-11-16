import { accessProblemOf, type AccessProblem } from './errors';

/**
 * Any query or mutation can learn that the session lost its standing (two-factor
 * login needed again, or the account is no longer a super admin). The query
 * cache reports it here; the auth provider listens and moves to the right step.
 */
export type AccessProblemListener = (problem: AccessProblem) => void;

const listeners = new Set<AccessProblemListener>();

export const onAccessProblem = (listener: AccessProblemListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Call with any error; only the two sign-in refusals are passed on. */
export const reportAccessProblem = (error: unknown): void => {
  const problem = accessProblemOf(error);
  if (!problem) return;
  for (const listener of listeners) listener(problem);
};
