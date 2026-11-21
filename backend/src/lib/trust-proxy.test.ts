import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { parseTrustProxy, type TrustProxySetting } from './trust-proxy.js';

const clientIp = async (setting: TrustProxySetting, forwardedFor: string): Promise<string> => {
  const app = express();
  app.set('trust proxy', setting);
  app.get('/', (req, res) => {
    res.json({ ip: req.ip });
  });
  const res = await request(app).get('/').set('X-Forwarded-For', forwardedFor);
  return (res.body as { ip: string }).ip;
};

describe('parseTrustProxy (W8-INT-D4)', () => {
  it('defaults to trusting no proxy', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
  });
  it('accepts a hop count and address lists', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback,10.0.0.0/8');
  });
  it('refuses trust-everything and junk', () => {
    expect(() => parseTrustProxy('true')).toThrow();
    expect(() => parseTrustProxy('yes please')).toThrow();
  });
  it('ignores a spoofed X-Forwarded-For when no proxy is trusted', async () => {
    expect(await clientIp(parseTrustProxy('false'), '203.0.113.7')).not.toBe('203.0.113.7');
  });
  it('uses the address a single trusted proxy appended', async () => {
    expect(await clientIp(parseTrustProxy('1'), '198.51.100.9, 203.0.113.7')).toBe('203.0.113.7');
  });
});
