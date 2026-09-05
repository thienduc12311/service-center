import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import { HttpError } from '../lib/errors.js';
import { validatePlanItemOrder } from './plans.js';

describe('validatePlanItemOrder', () => {
  const knownIds = new Set(['first', 'second', 'third']);

  it('accepts every known item exactly once in any order', () => {
    expect(() => validatePlanItemOrder(knownIds, ['third', 'first', 'second'])).not.toThrow();
  });

  it('rejects ids from another plan', () => {
    expect(() => validatePlanItemOrder(knownIds, ['first', 'second', 'other'])).toThrowError(HttpError);
    expect(() => validatePlanItemOrder(knownIds, ['first', 'second', 'other'])).toThrowError(
      'Some items do not belong to this plan',
    );
  });

  it('rejects missing or duplicate ids', () => {
    expect(() => validatePlanItemOrder(knownIds, ['first', 'second'])).toThrowError(HttpError);
    expect(() => validatePlanItemOrder(knownIds, ['first', 'second', 'second'])).toThrowError(HttpError);
  });
});
