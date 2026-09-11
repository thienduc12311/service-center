import { describe, expect, it, beforeAll, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CORS_ORIGINS ||= 'http://localhost:5173';

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

describe('CORS', () => {
  /** config.ts reads the environment once at import, so each variant needs a fresh module graph. */
  const buildApp = async (allowPreviews: 'true' | 'false'): Promise<Express> => {
    vi.resetModules();
    process.env.CORS_ALLOW_VERCEL_PREVIEWS = allowPreviews;
    const { createApp } = await import('../app.js');
    return createApp();
  };

  it('allows an origin listed in CORS_ORIGINS', async () => {
    const app = await buildApp('false');
    const res = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects an unlisted origin', async () => {
    const app = await buildApp('false');
    const res = await request(app).get('/health').set('Origin', 'https://attacker.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.status).toBe(500);
  });

  it('rejects a vercel preview origin unless previews are enabled', async () => {
    const app = await buildApp('false');
    const res = await request(app)
      .get('/health')
      .set('Origin', 'https://service-center-git-feature-x-team.vercel.app');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a vercel preview origin when previews are enabled', async () => {
    const app = await buildApp('true');
    const origin = 'https://service-center-git-feature-x-team.vercel.app';
    const res = await request(app).get('/health').set('Origin', origin);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('does not allow a lookalike of a vercel preview origin', async () => {
    const app = await buildApp('true');
    const res = await request(app).get('/health').set('Origin', 'https://evil.vercel.app.attacker.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
