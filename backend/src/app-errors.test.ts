import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { fromPostgrestError } from './lib/errors.js';
import { containsUnsupportedText } from './middleware/sanitize-input.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

/** QA wave 7: request-level failures map to client errors, never a leaky 500. */
describe('request error mapping', () => {
  let app: Express;

  beforeAll(async () => {
    const { createApp } = await import('./app.js');
    app = createApp();
  });

  const post = (path: string) => request(app).post(path).set('Content-Type', 'application/json');

  it.each(['{bad', '{"name":', '"x"', 'null'])('answers malformed or primitive JSON %s with 400 invalid_json', async (body) => {
    for (const path of ['/api/v1/teams', '/api/v1/assignment-responses/abc/respond']) {
      const res = await post(path).send(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('invalid_json');
      expect(JSON.stringify(res.body)).not.toMatch(/position|Unexpected|token/i);
    }
  });

  it('answers an oversize body with 413', async () => {
    const res = await post('/api/v1/teams').send(JSON.stringify({ name: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('payload_too_large');
  });

  it('answers an unsupported body charset with 415, not invalid JSON', async () => {
    const res = await request(app).post('/api/v1/teams').set('Content-Type', 'application/json; charset=latin1').send('{"name":"x"}');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('unsupported_media_type');
  });

  it('rejects NUL bytes and lone surrogates before they reach Postgres', async () => {
    for (const body of ['{"name":"a\\u0000b"}', '{"body":"x\\ud800y"}', '{"nested":[{"k":"\\u0000"}]}']) {
      const res = await post('/api/v1/teams').send(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('unprocessable');
    }
    const query = await request(app).get('/api/v1/songs?q=x%00y');
    expect(query.status).toBe(422);
  });

  it('does not fail a request from a disallowed CORS origin with a 500', async () => {
    const res = await request(app).options('/api/v1/plans').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(res.status).toBeLessThan(500);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('maps leftover database text errors to 422', () => {
    for (const code of ['22P05', '22021']) {
      const error = fromPostgrestError({ code, message: 'unsupported Unicode escape sequence' });
      expect(error.status).toBe(422);
      expect(error.message).not.toMatch(/Unicode/);
    }
  });
});

describe('containsUnsupportedText', () => {
  it('accepts ordinary text including emoji and rejects the rest', () => {
    expect(containsUnsupportedText({ a: 'hello 🎵 ñ', b: ['x', { c: 1 }] })).toBe(false);
    expect(containsUnsupportedText('a\u0000b')).toBe(true);
    expect(containsUnsupportedText('\uD800')).toBe(true);
    expect(containsUnsupportedText('\uDC00x')).toBe(true);
    expect(containsUnsupportedText({ 'k\u0000': 'v' })).toBe(true);
  });
});
