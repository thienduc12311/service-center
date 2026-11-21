import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const KEY = 'a'.repeat(64);

interface RpcResult {
  data: string | null;
  error: { code: string; message: string } | null;
}

describe('GET /api/v1/realtime/key', () => {
  let app: Express;
  let result: RpcResult;
  const rpc = vi.fn((_fn: string, _args: { p_org: string }): Promise<RpcResult> => Promise.resolve(result));

  beforeAll(async () => {
    const { realtimeRouter } = await import('./realtime.js');
    const { errorHandler } = await import('../middleware/error-handler.js');
    app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.db = { rpc } as unknown as Db;
      req.orgId = ORG_ID;
      next();
    });
    app.use('/api/v1/realtime', realtimeRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    rpc.mockClear();
    result = { data: KEY, error: null };
  });

  it('serves the active organization key and forbids caching', async () => {
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ key: KEY });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rpc.mock.calls).toEqual([['realtime_topic_key', { p_org: ORG_ID }]]);
  });

  it('answers 404 when the database withholds the key from a removed member', async () => {
    result = { data: null, error: null };
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
  });

  it('surfaces a database failure as an error', async () => {
    result = { data: null, error: { code: 'XX000', message: 'boom' } };
    const res = await request(app).get('/api/v1/realtime/key');
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
