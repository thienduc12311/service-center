import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimeoutFetch, isUpstreamTimeout } from './fetch-timeout.js';
import { fromPostgrestError } from './errors.js';

/** A fetch that only ever settles by being aborted. */
const hangingFetch = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  }));

describe('createTimeoutFetch (W8-RES-D6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    hangingFetch.mockClear();
  });

  it('aborts a request that outlives the bound with a non-retried abort', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const timeoutFetch = createTimeoutFetch({ requestMs: 20, storageMs: 5000 });
    const failure = await timeoutFetch('http://supabase.test/rest/v1/x').catch((error: unknown) => error);
    expect(isUpstreamTimeout(failure)).toBe(true);
    expect(failure).toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
  });

  it('keeps a caller abort distinguishable from our timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch);
    const timeoutFetch = createTimeoutFetch({ requestMs: 5000, storageMs: 5000 });
    const caller = new AbortController();
    const pending = timeoutFetch('http://supabase.test/rest/v1/x', { signal: caller.signal }).catch((error: unknown) => error);
    caller.abort();
    const failure = await pending;
    expect(isUpstreamTimeout(failure)).toBe(false);
    expect(failure).toMatchObject({ name: 'AbortError' });
  });

  it('gives storage calls the longer bound and keeps a caller signal', async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return Promise.resolve(new Response('ok'));
    });
    const timeoutFetch = createTimeoutFetch({ requestMs: 10, storageMs: 5000 });
    const caller = new AbortController();
    await timeoutFetch('http://supabase.test/storage/v1/object/x', { signal: caller.signal });
    await new Promise((r) => setTimeout(r, 30));
    expect(seen?.aborted).toBe(false);
    caller.abort();
    expect(seen?.aborted).toBe(true);
  });

  it('makes one attempt at a hung PostgREST read (no client retries) and maps it to 504', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('fetch', hangingFetch);
    const db = createClient('http://supabase.test', 'test-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: createTimeoutFetch({ requestMs: 15_000, storageMs: 60_000 }) },
    });

    // The builder is lazy: `then` starts the request.
    const pending = db.from('plans').select('id').then((result) => result);
    // Far beyond one timeout plus postgrest-js's retry back-off.
    await vi.advanceTimersByTimeAsync(120_000);
    const { error } = await pending;

    expect(hangingFetch).toHaveBeenCalledTimes(1);
    expect(error).not.toBeNull();
    expect(fromPostgrestError(error ?? { message: '' })).toMatchObject({ status: 504, code: 'upstream_timeout' });
  });
});
