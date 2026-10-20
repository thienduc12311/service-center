import { describe, expect, it } from 'vitest';
import type { SchedulingPreferenceRow } from '@service-center/shared';
import { draftFromRow, requestFromDraft, toggleWeek } from './preference-draft';

const TEAM_A = '11111111-1111-4111-8111-111111111111';

const row = (overrides: Partial<SchedulingPreferenceRow> = {}): SchedulingPreferenceRow => ({
  id: '22222222-2222-4222-8222-222222222222',
  organization_id: '33333333-3333-4333-8333-333333333333',
  person_id: '44444444-4444-4444-8444-444444444444',
  team_id: TEAM_A,
  frequency: 'every_other_week',
  max_per_month: 2,
  preferred_weeks: [1, 3],
  avoided_weeks: [5],
  preferred_dates: ['2027-01-03'],
  avoided_dates: ['2027-12-26'],
  preferred_times: ['09:00:00', '11:00:00'],
  revision: 4,
  updated_by: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...overrides,
});

describe('preference draft', () => {
  it('shows unset fields as explicit defaults', () => {
    expect(draftFromRow(undefined)).toEqual({
      frequency: '', maxPerMonth: '', preferredWeeks: [], avoidedWeeks: [], preferredTimes: '',
    });
  });

  it('round-trips a saved row and keeps website-only dates', () => {
    const current = row();
    const result = requestFromDraft(draftFromRow(current), TEAM_A, current);
    expect(result).toEqual({
      ok: true,
      request: {
        team_id: TEAM_A,
        frequency: 'every_other_week',
        max_per_month: 2,
        preferred_weeks: [1, 3],
        avoided_weeks: [5],
        preferred_times: ['09:00', '11:00'],
        preferred_dates: ['2027-01-03'],
        avoided_dates: ['2027-12-26'],
        expected_revision: 4,
      },
    });
  });

  it('saves a new all-teams scope without a revision', () => {
    const result = requestFromDraft(draftFromRow(undefined), '', undefined);
    expect(result.ok && result.request).toMatchObject({ team_id: null, frequency: null, max_per_month: null });
    expect(result.ok && 'expected_revision' in result.request).toBe(false);
  });

  it('never leaves a week both preferred and avoided', () => {
    const draft = toggleWeek(draftFromRow(row()), 'avoidedWeeks', 1);
    expect(draft.preferredWeeks).toEqual([3]);
    expect(draft.avoidedWeeks).toEqual([1, 5]);
    expect(toggleWeek(draft, 'avoidedWeeks', 1).avoidedWeeks).toEqual([5]);
  });

  it.each(['0', '32', '1.5', 'two'])('rejects monthly maximum %s', (value) => {
    const draft = { ...draftFromRow(undefined), maxPerMonth: value };
    expect(requestFromDraft(draft, TEAM_A, undefined)).toEqual({ ok: false, field: 'maxPerMonth' });
  });

  it('rejects an invalid start time', () => {
    const draft = { ...draftFromRow(undefined), preferredTimes: '09:00, 25:00' };
    expect(requestFromDraft(draft, TEAM_A, undefined)).toEqual({ ok: false, field: 'preferredTimes' });
  });
});
