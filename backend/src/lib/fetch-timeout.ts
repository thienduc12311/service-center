export interface FetchTimeoutOptions {
  /** Upper bound for ordinary requests (PostgREST, Auth), in milliseconds. */
  requestMs: number;
  /** Upper bound for Supabase Storage requests, which move whole files. */
  storageMs: number;
}

const requestUrl = (input: Parameters<typeof fetch>[0]): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
};

/**
 * A `fetch` that aborts after a fixed time, combined with any signal the
 * caller already passed. The global `fetch` is resolved on every call.
 */
export const createTimeoutFetch = (options: FetchTimeoutOptions): typeof fetch => {
  return (input, init) => {
    const ms = requestUrl(input).includes('/storage/v1/') ? options.storageMs : options.requestMs;
    const timeout = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  };
};
