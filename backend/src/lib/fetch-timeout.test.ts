import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTimeoutFetch } from './fetch-timeout.js';

describe('createTimeoutFetch (W8-RES-D6)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('aborts a request that outlives the bound', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }));
    const timeoutFetch = createTimeoutFetch({ requestMs: 20, storageMs: 5000 });
    await expect(timeoutFetch('http://supabase.test/rest/v1/x')).rejects.toMatchObject({ name: 'TimeoutError' });
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
});
