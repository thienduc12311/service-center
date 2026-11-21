export interface FetchTimeoutOptions {
  /** Upper bound for ordinary requests (PostgREST, Auth), in milliseconds. */
  requestMs: number;
  /** Upper bound for Supabase Storage requests, which move whole files. */
  storageMs: number;
}

/**
 * Our own deadline passing. It is named `AbortError` on purpose: postgrest-js
 * retries a failed GET/HEAD up to three times unless the error is an abort
 * (`AbortError`/`ABORT_ERR`), and the platform's `TimeoutError` is not one, so
 * a hung read would otherwise take four full timeouts (per page). Its message
 * says "timed out", which the error mapper turns into 504 `upstream_timeout`;
 * `isUpstreamTimeout` tells it apart from an abort the caller asked for.
 * (auth-js and storage-js do not retry failed fetches.)
 */
export class UpstreamTimeoutError extends Error {
  override readonly name = 'AbortError';
  readonly code = 'ABORT_ERR';
  constructor(readonly timeoutMs: number) {
    super(`Upstream request timed out after ${timeoutMs} ms`);
  }
}

export const isUpstreamTimeout = (error: unknown): error is UpstreamTimeoutError =>
  error instanceof UpstreamTimeoutError;

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

/**
 * A `fetch` that aborts after a fixed time, combined with any signal the
 * caller already passed. The deadline also covers reading the body. The
 * global `fetch` is resolved on every call.
 */
export const createTimeoutFetch = (options: FetchTimeoutOptions): typeof fetch => {
  return async (input, init) => {
    const ms = requestUrl(input).includes('/storage/v1/') ? options.storageMs : options.requestMs;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new UpstreamTimeoutError(ms)), ms);
    // Never keeps the process alive; after a finished request it just lapses.
    timer.unref?.();
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline.signal]) : deadline.signal;
    try {
      return await fetch(input, { ...init, signal });
    } catch (error) {
      // Whatever the fetch implementation rejected with, our deadline is the
      // reason unless the caller aborted first.
      if (deadline.signal.aborted && !init?.signal?.aborted) throw deadline.signal.reason;
      throw error;
    }
  };
};
