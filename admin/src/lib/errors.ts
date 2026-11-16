import { ACCOUNT_BLOCKED, ApiError, MFA_REQUIRED, NOT_PLATFORM_ADMIN } from '@service-center/shared';

export { APPLICATION_NOT_PENDING, NOT_PLATFORM_ADMIN, SLUG_TAKEN } from '@service-center/shared';

/** A refusal that sends the admin back to an earlier sign-in step. */
export type AccessProblem = typeof MFA_REQUIRED | typeof NOT_PLATFORM_ADMIN;

export const DEFAULT_ERROR_MESSAGE = 'Something went wrong. Please try again.';
export const NETWORK_ERROR_MESSAGE = 'Could not reach Service Center. Check your connection and try again.';

export const isApiErrorCode = (error: unknown, code: string): boolean =>
  error instanceof ApiError && error.code === code;

/** Which sign-in step an API error calls for, if any. */
export const accessProblemOf = (error: unknown): AccessProblem | null => {
  if (!(error instanceof ApiError) || error.status !== 403) return null;
  if (error.code === MFA_REQUIRED) return MFA_REQUIRED;
  if (error.code === NOT_PLATFORM_ADMIN) return NOT_PLATFORM_ADMIN;
  return null;
};

export const BLOCKED_ACCOUNT_MESSAGE = 'This account is blocked. Contact a Service Center super admin if you think this is a mistake.';

/** Supabase Auth refusing a banned login (`user_banned`), or the API refusing a blocked account. */
export const isBlockedAccountError = (error: unknown): boolean => {
  if (error instanceof ApiError) return error.code === ACCOUNT_BLOCKED;
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'user_banned';
};

/**
 * Text to show for a failed call. The API writes its messages for people;
 * a failed fetch (offline, CORS, API down) gets a plain explanation instead.
 */
export const errorMessage = (error: unknown, fallback: string = DEFAULT_ERROR_MESSAGE): string => {
  if (isBlockedAccountError(error)) return BLOCKED_ACCOUNT_MESSAGE;
  if (error instanceof ApiError) return error.message.trim() || fallback;
  if (error instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
};
