import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret } from './secret-box.js';
import { generateSigningSecret, signWebhook, verifyWebhook, webhookHeaders } from './webhook-signature.js';
import { DestinationError, isBlockedAddress, resolveDestination } from './destination-guard.js';

describe('secret box', () => {
  const key = randomBytes(32).toString('base64');

  it('round-trips and never stores plaintext', () => {
    const sealed = sealSecret('whsec_abc', key);
    expect(sealed).not.toContain('abc');
    expect(openSecret(sealed, key)).toBe('whsec_abc');
  });

  it('refuses a tampered value or another key', () => {
    const sealed = sealSecret('whsec_abc', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(openSecret(parts.join('.'), key)).toBeNull();
    expect(openSecret(sealed, randomBytes(32).toString('base64'))).toBeNull();
    expect(openSecret(sealed, undefined)).toBeNull();
  });
});

describe('Standard Webhooks signature', () => {
  it('matches the published reference vector', () => {
    // From the standard-webhooks reference libraries' tests.
    expect(
      signWebhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}'),
    ).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('verifies, and rejects forged, altered and replayed deliveries', () => {
    const secret = generateSigningSecret();
    const now = 1_800_000_000;
    const body = '{"id":"evt_1"}';
    const headers = webhookHeaders(secret, 'evt_1', now, body);
    expect(verifyWebhook({ secret, headers, body, nowSeconds: now })).toEqual({ ok: true });
    expect(verifyWebhook({ secret: generateSigningSecret(), headers, body, nowSeconds: now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook({ secret, headers, body: '{"id":"evt_2"}', nowSeconds: now })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyWebhook({ secret, headers, body, nowSeconds: now + 301 })).toEqual({ ok: false, reason: 'timestamp_out_of_range' });
    expect(verifyWebhook({ secret, headers: { ...headers, 'webhook-id': undefined }, body, nowSeconds: now })).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    // Rotation: any listed signature may match.
    const rotated = { ...headers, 'webhook-signature': `v1,AAAA ${headers['webhook-signature']}` };
    expect(verifyWebhook({ secret, headers: rotated, body, nowSeconds: now })).toEqual({ ok: true });
  });
});

describe('destination guard', () => {
  it('classifies reserved and public addresses', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.4.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '224.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('refuses private resolutions, http and credentials unless private is allowed', async () => {
    const resolver = async (host: string) =>
      host === 'mixed.example' ? [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
    await expect(resolveDestination('https://hooks.example/a', { resolver })).resolves.toMatchObject({ address: '93.184.216.34' });
    await expect(resolveDestination('https://mixed.example/a', { resolver })).rejects.toEqual(new DestinationError('destination_blocked'));
    await expect(resolveDestination('https://127.0.0.1/a', { resolver })).rejects.toEqual(new DestinationError('destination_blocked'));
    await expect(resolveDestination('http://hooks.example/a', { resolver })).rejects.toEqual(new DestinationError('invalid_url'));
    await expect(resolveDestination('https://u:p@hooks.example/a', { resolver })).rejects.toEqual(new DestinationError('invalid_url'));
    await expect(resolveDestination('http://127.0.0.1:9/a', { resolver, allowPrivate: true })).resolves.toMatchObject({ address: '127.0.0.1' });
    const failing = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(resolveDestination('https://nowhere.example', { resolver: failing })).rejects.toEqual(new DestinationError('dns_failed'));
  });
});
