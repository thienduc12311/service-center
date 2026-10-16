import { describe, expect, it, vi } from 'vitest';
import type { DeviceRegistration } from '@service-center/shared';
import {
  DeviceRegistrationLifecycle,
  settleWithin,
  type DeviceRegistrationDependencies,
} from './device-registration-lifecycle';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const registration: DeviceRegistration = {
  token: 'ExponentPushToken[test-device]',
  platform: 'ios',
  device_name: 'Test phone',
  lease_expires_at: '2026-11-15T12:00:00.000Z',
  revocation_secret: 'test-revocation-secret-that-is-long-enough',
};

const lifecycle = (
  overrides: Partial<DeviceRegistrationDependencies> = {},
): {
  value: DeviceRegistrationLifecycle;
  unregisterAuthenticated: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  resetBadge: ReturnType<typeof vi.fn>;
  register: ReturnType<typeof vi.fn>;
} => {
  const register = vi.fn(async () => registration);
  const unregisterAuthenticated = vi.fn(async () => undefined);
  const revoke = vi.fn(async () => undefined);
  const resetBadge = vi.fn(async () => undefined);
  const dependencies: DeviceRegistrationDependencies = {
    register,
    unregisterAuthenticated,
    revoke,
    resetBadge,
    timeoutMs: 10,
    ...overrides,
  };
  return {
    value: new DeviceRegistrationLifecycle(dependencies),
    register,
    unregisterAuthenticated,
    revoke,
    resetBadge,
  };
};

describe('DeviceRegistrationLifecycle', () => {
  it('unregisters with authenticated authority before sign-out and resets the badge', async () => {
    const harness = lifecycle();
    await harness.value.activate('user-a');

    const report = await harness.value.prepareForSignOut();

    expect(harness.unregisterAuthenticated).toHaveBeenCalledWith(registration.token);
    expect(harness.resetBadge).toHaveBeenCalledTimes(1);
    expect(report).toEqual({
      unregister: 'completed',
      badge: 'completed',
      fallbackQueued: false,
    });
    expect(harness.value.getState().pushEnabled).toBe(false);
  });

  it('revokes a registration that finishes after bounded sign-out waiting', async () => {
    const pending = deferred<DeviceRegistration | null>();
    const harness = lifecycle({ register: () => pending.promise, timeoutMs: 2 });
    const activation = harness.value.activate('user-a');

    const report = await harness.value.prepareForSignOut();
    expect(report.unregister).toBe('timed_out');

    pending.resolve(registration);
    await activation;
    await vi.waitFor(() => expect(harness.revoke).toHaveBeenCalledWith(registration));
    expect(harness.value.getState().pushEnabled).toBe(false);
  });

  it('uses the narrow public fallback when authenticated unregister fails', async () => {
    const harness = lifecycle({
      unregisterAuthenticated: async () => {
        throw new Error('offline');
      },
    });
    await harness.value.activate('user-a');

    const report = await harness.value.prepareForSignOut();
    await vi.waitFor(() => expect(harness.revoke).toHaveBeenCalledWith(registration));

    expect(report.unregister).toBe('failed');
    expect(report.fallbackQueued).toBe(true);
  });

  it('keeps one account-wide registration across organization switches', async () => {
    const harness = lifecycle();
    await harness.value.activate('user-a');
    await harness.value.activate('user-a');
    expect(harness.register).toHaveBeenCalledTimes(1);
  });

  it('blocks renewal during sign-out and resumes only after explicit recovery', async () => {
    const unregister = deferred<void>();
    const harness = lifecycle({
      unregisterAuthenticated: () => unregister.promise,
    });
    await harness.value.activate('user-a');

    const signOutCleanup = harness.value.prepareForSignOut();
    await harness.value.activate('user-a', true);
    expect(harness.register).toHaveBeenCalledTimes(1);

    unregister.resolve();
    await signOutCleanup;
    await harness.value.recoverAfterFailedSignOut('user-a');
    expect(harness.register).toHaveBeenCalledTimes(2);
  });
});

describe('settleWithin', () => {
  it('bounds a promise that never settles', async () => {
    const result = await settleWithin(new Promise<void>(() => undefined), 2);
    expect(result.status).toBe('timed_out');
  });
});
