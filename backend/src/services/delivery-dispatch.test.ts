import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import { DeliveryError } from '../model/delivery.model.js';
import { emailOutcome, pushOutcome, resultFromError, retryDelaySeconds } from './delivery-dispatch.js';
import { classifyResendError } from './email/resend-transport.js';
import { classifyExpoHttpStatus } from './expo-push.js';

describe('email outcomes', () => {
  it('reports a console send as simulated, never as accepted', () => {
    expect(emailOutcome('simulated', null)).toEqual({ status: 'simulated' });
    expect(emailOutcome('resend', 'msg-1')).toEqual({ status: 'provider_accepted', providerMessageId: 'msg-1' });
  });

  it('retries what can pass, fails what cannot, and never retries an unanswered call', () => {
    expect(classifyResendError({ name: 'rate_limit_exceeded', statusCode: 429 })).toMatchObject({
      code: 'provider_rate_limited',
      disposition: 'retry',
    });
    expect(classifyResendError({ name: 'internal_server_error', statusCode: 500 }).disposition).toBe('retry');
    expect(classifyResendError({ name: 'validation_error', statusCode: 422 })).toMatchObject({
      code: 'provider_rejected',
      disposition: 'fail',
    });
    expect(classifyResendError({ name: 'invalid_api_key', statusCode: 403 }).code).toBe('provider_misconfigured');
    // The SDK reports a network failure without a status: it may have been sent.
    expect(classifyResendError({ name: 'application_error', statusCode: null })).toMatchObject({
      code: 'provider_timeout',
      disposition: 'ambiguous',
    });
  });
});

describe('push outcomes', () => {
  const ticket = (token: string, accepted: boolean, error: string | null = null) => ({
    token,
    accepted,
    ticketId: accepted ? `ticket-${token}` : null,
    error,
  });

  it('counts the recipient as accepted when any device was accepted, and cleans up dead tokens', () => {
    const { result, invalidTokens } = pushOutcome(
      'expo',
      [ticket('a', false, 'DeviceNotRegistered'), ticket('b', true)],
      1,
    );
    expect(result).toEqual({ status: 'provider_accepted', providerMessageId: 'ticket-b' });
    expect(invalidTokens).toEqual(['a']);
  });

  it('skips a recipient whose every device is gone', () => {
    expect(pushOutcome('expo', [ticket('a', false, 'DeviceNotRegistered')], 1).result).toEqual({
      status: 'skipped',
      errorCode: 'no_active_device',
    });
  });

  it('retries a rate-limited push and fails one Expo refused', () => {
    expect(pushOutcome('expo', [ticket('a', false, 'MessageRateExceeded')], 1).result).toMatchObject({
      status: 'queued',
      errorCode: 'provider_rate_limited',
    });
    expect(pushOutcome('expo', [ticket('a', false, 'InvalidCredentials')], 1).result).toEqual({
      status: 'failed',
      errorCode: 'provider_rejected',
    });
  });

  it('labels a simulated push as simulated', () => {
    expect(pushOutcome('simulated', [ticket('a', true)], 1).result).toEqual({ status: 'simulated' });
  });

  it('maps Expo HTTP failures to retry or fail', () => {
    expect(classifyExpoHttpStatus(429).disposition).toBe('retry');
    expect(classifyExpoHttpStatus(503).disposition).toBe('retry');
    expect(classifyExpoHttpStatus(401).code).toBe('provider_misconfigured');
    expect(classifyExpoHttpStatus(400).disposition).toBe('fail');
  });
});

describe('resultFromError', () => {
  it('turns provider dispositions into recorded outcomes', () => {
    expect(resultFromError(new DeliveryError('provider_timeout', 'ambiguous'), 1, true)).toEqual({
      status: 'ambiguous',
      errorCode: 'provider_timeout',
    });
    expect(resultFromError(new DeliveryError('provider_rejected', 'fail'), 1, true)).toEqual({
      status: 'failed',
      errorCode: 'provider_rejected',
    });
    expect(resultFromError(new DeliveryError('provider_rate_limited', 'retry', 600), 1, true)).toEqual({
      status: 'queued',
      errorCode: 'provider_rate_limited',
      retryAfterSeconds: 600,
    });
  });

  it('retries an unexpected error before the provider call, but not after it', () => {
    expect(resultFromError(new Error('db down'), 2, false)).toEqual({
      status: 'queued',
      errorCode: 'internal_error',
      retryAfterSeconds: 60,
    });
    expect(resultFromError(new Error('crashed mid-send'), 2, true)).toEqual({
      status: 'ambiguous',
      errorCode: 'internal_error',
    });
  });

  it('backs off exponentially, honours a longer provider hint, and caps at an hour', () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(3)).toBe(120);
    expect(retryDelaySeconds(1, 300)).toBe(300);
    expect(retryDelaySeconds(20)).toBe(3600);
  });
});
