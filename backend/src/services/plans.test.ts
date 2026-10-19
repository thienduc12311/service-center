import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import { dedupePositionNeeds, shapePositionNeeds } from './plans.js';

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
