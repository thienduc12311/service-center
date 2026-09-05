import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

describe('app', () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import('../app.js');
    app = createApp();
  });

  it('serves health without authentication', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects API calls with no bearer token', async () => {
    const res = await request(app).get('/api/v1/plans');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('unauthorized');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });
});
