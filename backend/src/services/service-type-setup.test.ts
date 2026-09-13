import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
});

import type { ServiceTypeSetupTeamInput, TeamRow } from '@service-center/shared';
import { planTeamSetup } from './service-type-setup.js';

const requested = (name: string): ServiceTypeSetupTeamInput => ({
  name,
  color: '#6366f1',
  positions: ['Drums'],
});

const existing = (name: string): TeamRow => ({
  id: `team-${name.toLowerCase()}`,
  organization_id: 'org',
  service_type_id: null,
  name,
  description: null,
  color: '#6366f1',
  sort_order: 0,
  created_at: '2026-09-13T00:00:00.000Z',
  updated_at: '2026-09-13T00:00:00.000Z',
});

describe('planTeamSetup', () => {
  it('creates teams the organization does not have yet', () => {
    const result = planTeamSetup([requested('Band'), requested('Cafe')], []);

    expect(result.create.map((team) => team.name)).toEqual(['Band', 'Cafe']);
    expect(result.reuse).toEqual([]);
  });

  it('adopts an existing team rather than creating a second one', () => {
    const band = existing('Band');
    const result = planTeamSetup([requested('Band'), requested('Cafe')], [band]);

    expect(result.create.map((team) => team.name)).toEqual(['Cafe']);
    expect(result.reuse).toEqual([band]);
  });

  it('matches existing teams regardless of case and surrounding space', () => {
    const band = existing('Band');
    const result = planTeamSetup([requested('  band ')], [band]);

    expect(result.create).toEqual([]);
    expect(result.reuse).toEqual([band]);
  });

  it('keeps only the first of two requests for the same team', () => {
    const result = planTeamSetup([requested('Band'), requested('BAND')], []);

    expect(result.create.map((team) => team.name)).toEqual(['Band']);
  });
});
