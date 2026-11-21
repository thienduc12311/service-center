import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import type { Db } from '../lib/supabase.js';
import { dedupePositionNeeds, fetchViewerIsAdultPerson, shapePositionNeeds } from './plans.js';

describe('shapePositionNeeds', () => {
  it('reads the team off the joined position', () => {
    expect(
      shapePositionNeeds([{ needed: 2, position: { id: 'guitar', team_id: 'band' } }]),
    ).toEqual([{ position_id: 'guitar', team_id: 'band', needed: 2 }]);
  });

  it('drops a need whose position has been deleted', () => {
    expect(shapePositionNeeds([{ needed: 2, position: null }])).toEqual([]);
  });

  it('treats a missing embed as no needs at all', () => {
    expect(shapePositionNeeds()).toEqual([]);
  });
});

describe('dedupePositionNeeds', () => {
  it('keeps the last value sent for a position', () => {
    expect(
      dedupePositionNeeds([
        { position_id: 'drums', needed: 1 },
        { position_id: 'keys', needed: 2 },
        { position_id: 'drums', needed: 3 },
      ]),
    ).toEqual([
      { position_id: 'drums', needed: 3 },
      { position_id: 'keys', needed: 2 },
    ]);
  });
});

describe('fetchViewerIsAdultPerson', () => {
  const dbReturning = (rows: Array<{ person_type: 'adult' | 'child' }>): Db => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.is = () => Promise.resolve({ data: rows, error: null });
    return { from: () => chain } as unknown as Db;
  };

  it('is true for an adult roster person', async () => {
    expect(await fetchViewerIsAdultPerson(dbReturning([{ person_type: 'adult' }]), 'org', 'me')).toBe(true);
  });

  it('is false for a child', async () => {
    expect(await fetchViewerIsAdultPerson(dbReturning([{ person_type: 'child' }]), 'org', 'me')).toBe(false);
  });

  it('is false with no active roster person, like the database function', async () => {
    expect(await fetchViewerIsAdultPerson(dbReturning([]), 'org', 'me')).toBe(false);
  });
});
