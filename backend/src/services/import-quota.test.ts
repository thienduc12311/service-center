import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  process.env.AI_IMPORT_DAILY_LIMIT = '3';
});

import type { ImportQuotaRow } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';
import { consumeImportQuota, readImportQuota, toImportQuota } from './import-quota.js';

const ORG = '11111111-1111-1111-1111-111111111111';

const row = (overrides: Partial<ImportQuotaRow> = {}): ImportQuotaRow => ({
  allowed: true,
  used: 1,
  remaining: 2,
  quota_limit: 3,
  usage_date: '2026-09-06',
  resets_at: '2026-09-07T04:00:00.000Z',
  ...overrides,
});

/** A Db stand-in that only answers `rpc`, recording what it was called with. */
const fakeDb = (result: { data: ImportQuotaRow[] | null; error?: { code?: string; message: string } }) => {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return Promise.resolve({ data: result.data, error: result.error ?? null });
    },
  } as unknown as Db;
  return { db, calls };
};

describe('readImportQuota', () => {
  it('asks the status function for the configured limit and maps the row', async () => {
    const { db, calls } = fakeDb({ data: [row()] });

    const quota = await readImportQuota(db, ORG);

    expect(calls).toEqual([
      { fn: 'ai_import_quota_status', args: { p_organization_id: ORG, p_limit: 3 } },
    ]);
    expect(quota).toEqual({
      allowed: true,
      limit: 3,
      used: 1,
      remaining: 2,
      resets_at: '2026-09-07T04:00:00.000Z',
    });
  });

  it('fails loudly when the function returns nothing', async () => {
    const { db } = fakeDb({ data: [] });
    await expect(readImportQuota(db, ORG)).rejects.toThrowError(HttpError);
  });
});

describe('consumeImportQuota', () => {
  it('charges the day and returns what is left', async () => {
    const { db, calls } = fakeDb({ data: [row({ used: 2, remaining: 1 })] });

    const quota = await consumeImportQuota(db, ORG);

    expect(calls[0]?.fn).toBe('consume_ai_import_quota');
    expect(quota.used).toBe(2);
    expect(quota.remaining).toBe(1);
  });

  it('answers 429 with the counters once the allowance is spent', async () => {
    const { db } = fakeDb({ data: [row({ allowed: false, used: 3, remaining: 0 })] });

    await expect(consumeImportQuota(db, ORG)).rejects.toMatchObject({
      status: 429,
      code: 'quota_exceeded',
      message: 'You have used all 3 chord sheet imports for today',
      details: { limit: 3, used: 3, remaining: 0, resets_at: '2026-09-07T04:00:00.000Z' },
    });
  });

  it('surfaces an RLS denial from the function as a 403', async () => {
    const { db } = fakeDb({ data: null, error: { code: '42501', message: 'admins only' } });
    await expect(consumeImportQuota(db, ORG)).rejects.toMatchObject({ status: 403 });
  });
});

describe('toImportQuota', () => {
  it('drops the internal decision flag before it reaches a client', () => {
    expect(toImportQuota({ allowed: false, limit: 3, used: 3, remaining: 0, resets_at: 'x' })).toEqual({
      limit: 3,
      used: 3,
      remaining: 0,
      resets_at: 'x',
    });
  });
});
