import type { DeviceRegistration } from '@service-center/shared';

export type TimedResult<T> =
  | { status: 'completed'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'timed_out' };

export interface DeviceRegistrationState {
  pushEnabled: boolean;
  registering: boolean;
  error: unknown;
}

export interface DeviceSignOutReport {
  unregister: 'not_registered' | 'completed' | 'failed' | 'timed_out';
  badge: 'completed' | 'failed' | 'timed_out';
  fallbackQueued: boolean;
}

export interface DeviceRegistrationDependencies {
  register: () => Promise<DeviceRegistration | null>;
  unregisterAuthenticated: (token: string) => Promise<void>;
  revoke: (registration: DeviceRegistration) => Promise<void>;
  resetBadge: () => Promise<void>;
  timeoutMs: number;
}

type DeviceRegistrationListener = (state: DeviceRegistrationState) => void;

export const settleWithin = async <T>(promise: Promise<T>, timeoutMs: number): Promise<TimedResult<T>> =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ status: 'timed_out' });
    }, timeoutMs);

    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'completed', value });
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: 'failed', error });
      },
    );
  });

/**
 * Owns account-wide device registration independently of organization state.
 * Late registrations are revoked with their narrow secret after auth is gone.
 */
export class DeviceRegistrationLifecycle {
  private state: DeviceRegistrationState = {
    pushEnabled: false,
    registering: false,
    error: null,
  };

  private listeners = new Set<DeviceRegistrationListener>();
  private activeUserId: string | null = null;
  private signOutInProgress = false;
  private generation = 0;
  private current: DeviceRegistration | null = null;
  private registrationPromise: Promise<DeviceRegistration | null> | null = null;
  private pendingRevocations = new Map<string, DeviceRegistration>();
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: DeviceRegistrationDependencies) {}

  getState = (): DeviceRegistrationState => this.state;

  subscribe = (listener: DeviceRegistrationListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(next: DeviceRegistrationState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  activate = async (userId: string, renew = false): Promise<void> => {
    if (this.signOutInProgress) return;
    if (!renew && this.activeUserId === userId && (this.current || this.registrationPromise)) {
      return;
    }

    this.activeUserId = userId;
    const generation = ++this.generation;
    this.publish({
      pushEnabled: this.current !== null,
      registering: true,
      error: null,
    });
    void this.flushPendingRevocations();

    const promise = this.dependencies.register();
    this.registrationPromise = promise;
    try {
      const registration = await promise;
      if (this.registrationPromise === promise) this.registrationPromise = null;
      if (!registration) {
        if (generation === this.generation && this.activeUserId === userId) {
          this.current = null;
          this.publish({ pushEnabled: false, registering: false, error: null });
        }
        return;
      }

      if (generation !== this.generation || this.activeUserId !== userId) {
        this.queueRevocation(registration);
        void this.flushPendingRevocations();
        return;
      }

      this.current = registration;
      this.publish({ pushEnabled: true, registering: false, error: null });
    } catch (error) {
      if (this.registrationPromise === promise) this.registrationPromise = null;
      if (generation === this.generation && this.activeUserId === userId) {
        this.current = null;
        this.publish({ pushEnabled: false, registering: false, error });
      }
    }
  };

  prepareForSignOut = async (): Promise<DeviceSignOutReport> => {
    const current = this.current;
    const inFlight = this.registrationPromise;
    this.signOutInProgress = true;
    this.activeUserId = null;
    this.generation += 1;
    this.current = null;
    this.publish({ pushEnabled: false, registering: false, error: null });

    const badgePromise = settleWithin(
      this.dependencies.resetBadge(),
      this.dependencies.timeoutMs,
    );

    let registration = current;
    let registrationWait: TimedResult<DeviceRegistration | null> | null = null;
    if (!registration && inFlight) {
      registrationWait = await settleWithin(inFlight, this.dependencies.timeoutMs);
      if (registrationWait.status === 'completed') registration = registrationWait.value;
    }

    let unregister: DeviceSignOutReport['unregister'] = registration
      ? 'failed'
      : registrationWait?.status === 'timed_out'
        ? 'timed_out'
        : registrationWait?.status === 'failed'
          ? 'failed'
          : 'not_registered';
    let fallbackQueued = false;

    if (registration) {
      const result = await settleWithin(
        this.dependencies.unregisterAuthenticated(registration.token),
        this.dependencies.timeoutMs,
      );
      unregister = result.status;
      if (result.status !== 'completed') {
        fallbackQueued = true;
        this.queueRevocation(registration);
        void this.flushPendingRevocations();
      }
    }

    const badgeResult = await badgePromise;
    return { unregister, badge: badgeResult.status, fallbackQueued };
  };

  /** Handles session expiry or external sign-out where auth is already gone. */
  deactivateWithoutSession = (): void => {
    const registration = this.current;
    this.signOutInProgress = false;
    this.activeUserId = null;
    this.generation += 1;
    this.current = null;
    this.publish({ pushEnabled: false, registering: false, error: null });
    if (registration) this.queueRevocation(registration);
    void this.flushPendingRevocations();
    void this.dependencies.resetBadge().catch((error: unknown) => {
      this.publish({ ...this.state, error });
    });
  };

  /** Reopens registration only when the attempted Supabase sign-out failed. */
  recoverAfterFailedSignOut = async (userId: string): Promise<void> => {
    this.signOutInProgress = false;
    await this.activate(userId, true);
  };

  private queueRevocation(registration: DeviceRegistration): void {
    // A renewal can reuse the Expo token while rotating its capability. Keep
    // both credentials: deleting an older no-op attempt must not discard the
    // newer capability before it has had its own cleanup attempt.
    const key = `${registration.token}\u0000${registration.revocation_secret}`;
    this.pendingRevocations.set(key, registration);
  }

  private flushPendingRevocations(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = (async () => {
      for (const [key, registration] of this.pendingRevocations) {
        const result = await settleWithin(
          this.dependencies.revoke(registration),
          this.dependencies.timeoutMs,
        );
        if (result.status === 'completed') this.pendingRevocations.delete(key);
        else {
          const error =
            result.status === 'failed'
              ? result.error
              : new Error('Device registration cleanup timed out.');
          this.publish({ ...this.state, error });
        }
      }
    })().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }
}

type DeviceSignOutHandler = () => Promise<DeviceSignOutReport>;
type DeviceSignOutRecoveryHandler = () => Promise<void>;

let signOutHandler: DeviceSignOutHandler | null = null;
let signOutRecoveryHandler: DeviceSignOutRecoveryHandler | null = null;

export const setDeviceSignOutHandler = (handler: DeviceSignOutHandler | null): void => {
  signOutHandler = handler;
};

export const setDeviceSignOutRecoveryHandler = (
  handler: DeviceSignOutRecoveryHandler | null,
): void => {
  signOutRecoveryHandler = handler;
};

export const runDeviceSignOutHandler = async (): Promise<DeviceSignOutReport> => {
  if (!signOutHandler) {
    return { unregister: 'not_registered', badge: 'completed', fallbackQueued: false };
  }
  return signOutHandler();
};

export const runDeviceSignOutRecoveryHandler = async (): Promise<void> => {
  await signOutRecoveryHandler?.();
};
