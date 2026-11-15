/**
 * "Your account has been deleted" must survive the sign-out that follows a
 * deletion: the auth gate redirects to /login on its own and drops any router
 * state, so the notice rides in session storage for one read instead.
 */
const KEY = 'sc:account-deleted';

export const rememberAccountDeleted = (): void => {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked (private mode): the sign-in page simply shows no notice.
  }
};

/** Whether this tab just deleted its account. Pure, so React may call it twice (StrictMode). */
export const wasAccountDeleted = (): boolean => {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** Shown once: call after the notice has been read. */
export const clearAccountDeleted = (): void => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
};
