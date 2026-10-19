import { describe, expect, it } from 'vitest';
import {
  createApiCredentialSchema,
  createWebhookEndpointSchema,
  externalPlansQuerySchema,
  isPrivateWebhookHost,
} from './integrations.js';
import { API_KEY_PATTERN, webhookErrorLabel } from '../lib/integrations.js';

describe('F17 integration schemas', () => {
  it('accepts a scoped credential and rejects unknown scopes', () => {
    expect(createApiCredentialSchema.parse({ name: ' Display ', scopes: ['plans.read'], idempotency_key: 'abcdefgh1' })).toMatchObject({
      name: 'Display',
      rate_limit_per_minute: 60,
    });
    expect(createApiCredentialSchema.safeParse({ name: 'x', scopes: ['people.write'], idempotency_key: 'abcdefgh1' }).success).toBe(false);
    expect(createApiCredentialSchema.safeParse({ name: 'x', scopes: [], idempotency_key: 'abcdefgh1' }).success).toBe(false);
  });

  it('rejects webhook URLs with credentials, fragments or other schemes', () => {
    const base = { event_types: ['plan.published'], idempotency_key: 'abcdefgh1' };
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'https://hooks.example.com/sc' }).success).toBe(true);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'https://user:pw@hooks.example.com' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'https://hooks.example.com/#x' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'ftp://hooks.example.com' }).success).toBe(false);
    expect(createWebhookEndpointSchema.safeParse({ ...base, url: 'https://hooks.example.com', event_types: ['people.updated'] }).success).toBe(false);
  });

  it('flags obviously private hosts', () => {
    for (const host of ['localhost', 'api.localhost', '127.0.0.1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '169.254.169.254', 'db.internal']) {
      expect(isPrivateWebhookHost(host)).toBe(true);
    }
    for (const host of ['hooks.example.com', '172.32.0.1', '8.8.8.8']) expect(isPrivateWebhookHost(host)).toBe(false);
  });

  it('bounds the external plan range', () => {
    expect(externalPlansQuerySchema.safeParse({ from: '2027-01-01T00:00:00Z', to: '2027-02-01T00:00:00Z' }).success).toBe(true);
    expect(externalPlansQuerySchema.safeParse({ from: '2027-02-01T00:00:00Z', to: '2027-01-01T00:00:00Z' }).success).toBe(false);
    expect(externalPlansQuerySchema.safeParse({ from: '2027-01-01T00:00:00Z', to: '2028-06-01T00:00:00Z' }).success).toBe(false);
  });

  it('recognises the credential format and labels errors', () => {
    expect(API_KEY_PATTERN.test(`sck_0123456789abcdef_${'A'.repeat(43)}`)).toBe(true);
    expect(API_KEY_PATTERN.test(`sck_0123456789ABCDEF_${'A'.repeat(43)}`)).toBe(false);
    expect(webhookErrorLabel('http_503')).toBe('Endpoint answered HTTP 503');
    expect(webhookErrorLabel('timeout')).toMatch(/did not answer/);
  });
});
