import { describe, expect, it } from 'vitest';
import {
  deliveryErrorLabel,
  isPendingDelivery,
  isRetryableDelivery,
  summarizeDeliveryOutcomes,
} from './delivery.js';

describe('delivery outcomes', () => {
  it('only lets failed and ambiguous deliveries be retried', () => {
    expect(isRetryableDelivery('failed')).toBe(true);
    expect(isRetryableDelivery('ambiguous')).toBe(true);
    expect(isRetryableDelivery('simulated')).toBe(false);
    expect(isRetryableDelivery('provider_accepted')).toBe(false);
    expect(isRetryableDelivery('queued')).toBe(false);
    expect(isPendingDelivery('sending')).toBe(true);
  });

  it('counts each channel separately so a simulated email is not a sent one', () => {
    const summary = summarizeDeliveryOutcomes([
      { channel: 'email', status: 'simulated' },
      { channel: 'email', status: 'provider_accepted' },
      { channel: 'email', status: 'failed' },
      { channel: 'push', status: 'skipped' },
      { channel: 'in_app', status: 'delivered' },
      { channel: 'in_app', status: 'delivered' },
    ]);
    expect(summary).toEqual({
      in_app: { delivered: 2 },
      push: { skipped: 1 },
      email: { simulated: 1, provider_accepted: 1, failed: 1 },
    });
  });

  it('explains known error codes and passes unknown ones through', () => {
    expect(deliveryErrorLabel('no_email_address')).toBe('No email address on file');
    expect(deliveryErrorLabel('something_new')).toBe('something_new');
    expect(deliveryErrorLabel(null)).toBeNull();
  });
});
