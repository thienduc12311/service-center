import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../lib/supabase.js';
import {
  DEVICE_REGISTRATION_LEASE_DAYS,
  activeDeviceTokens,
  generateDeviceRegistration,
  hashDeviceRevocationSecret,
} from './device-registrations.js';

describe('device registration leases', () => {
  it('creates a hashed secret and a thirty-day lease', () => {
    const now = new Date('2026-10-16T12:00:00.000Z');
    const registration = generateDeviceRegistration(now);

    expect(registration.revocationSecret).not.toBe(registration.revocationSecretHash);
    expect(hashDeviceRevocationSecret(registration.revocationSecret)).toBe(
      registration.revocationSecretHash,
    );
    expect(registration.lastSeenAt).toBe(now.toISOString());
    expect(registration.leaseExpiresAt).toBe(
      new Date(
        now.getTime() + DEVICE_REGISTRATION_LEASE_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString(),
    );
  });

  it('adds a server-side lease cutoff to the delivery lookup', async () => {
    const response = Promise.resolve({
      data: [{ user_id: 'user-1', token: 'ExponentPushToken[active]' }],
      error: null,
    });
    const gt = vi.fn(() => response);
    const inUserIds = vi.fn(() => ({ gt }));
    const select = vi.fn(() => ({ in: inUserIds }));
    const from = vi.fn(() => ({ select }));
    const db = { from } as unknown as Db;
    const now = new Date('2026-10-16T12:00:00.000Z');

    await expect(activeDeviceTokens(db, ['user-1'], now)).resolves.toEqual([
      { user_id: 'user-1', token: 'ExponentPushToken[active]' },
    ]);
    expect(from).toHaveBeenCalledWith('device_push_tokens');
    expect(inUserIds).toHaveBeenCalledWith('user_id', ['user-1']);
    expect(gt).toHaveBeenCalledWith('lease_expires_at', now.toISOString());
  });
});
