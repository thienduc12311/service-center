import { createHash, randomBytes } from 'node:crypto';
import type { DevicePushTokenRow } from '@service-center/shared';
import { unwrap, type Db } from '../lib/supabase.js';

export const DEVICE_REGISTRATION_LEASE_DAYS = 30;

export interface GeneratedDeviceRegistration {
  revocationSecret: string;
  revocationSecretHash: string;
  lastSeenAt: string;
  leaseExpiresAt: string;
}

export type ActiveDeviceToken = Pick<DevicePushTokenRow, 'user_id' | 'token' | 'show_badge'>;

export const hashDeviceRevocationSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export const generateDeviceRegistration = (now = new Date()): GeneratedDeviceRegistration => {
  const revocationSecret = randomBytes(32).toString('base64url');
  return {
    revocationSecret,
    revocationSecretHash: hashDeviceRevocationSecret(revocationSecret),
    lastSeenAt: now.toISOString(),
    leaseExpiresAt: new Date(
      now.getTime() + DEVICE_REGISTRATION_LEASE_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  };
};

/** The only device rows eligible for private OS delivery. */
export const activeDeviceTokens = async (
  db: Db,
  userIds: string[],
  now = new Date(),
): Promise<ActiveDeviceToken[]> => {
  if (userIds.length === 0) return [];
  return (
    (await unwrap(
      db
        .from('device_push_tokens')
        .select('user_id, token, show_badge')
        .in('user_id', userIds)
        .gt('lease_expires_at', now.toISOString()),
    )) ?? []
  );
};
