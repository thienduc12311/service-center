import { describe, expect, it } from 'vitest';
import { canOfferPlanChat, canOpenPlanChat, type PlanChatAssignment } from '@service-center/shared';

const assignment = (overrides: Partial<PlanChatAssignment>): PlanChatAssignment => ({
  user_id: 'me',
  visibility: 'released',
  status: 'unconfirmed',
  ...overrides,
});

describe('canOpenPlanChat', () => {
  it('hides the entry from a non-participant', () => {
    expect(canOpenPlanChat(false, [assignment({ user_id: 'someone-else' })], 'me')).toBe(false);
    expect(canOpenPlanChat(false, [], 'me')).toBe(false);
    expect(canOpenPlanChat(false, [assignment({})], null)).toBe(false);
  });

  it('shows it to plan leaders', () => {
    expect(canOpenPlanChat(true, [], 'me')).toBe(true);
  });

  it('shows it to people with a released, not-declined request', () => {
    expect(canOpenPlanChat(false, [assignment({ status: 'confirmed' })], 'me')).toBe(true);
    expect(canOpenPlanChat(false, [assignment({ status: 'unconfirmed' })], 'me')).toBe(true);
  });

  it('hides it for declined or unreleased requests', () => {
    expect(canOpenPlanChat(false, [assignment({ status: 'declined' })], 'me')).toBe(false);
    expect(canOpenPlanChat(false, [assignment({ visibility: 'prepared' })], 'me')).toBe(false);
  });

  it('hides it from a child, even a leader or released assignee (DB is_adult_person)', () => {
    expect(canOpenPlanChat(true, [], 'me', false)).toBe(false);
    expect(canOpenPlanChat(false, [assignment({})], 'me', false)).toBe(false);
  });

  it('keeps it for adults and when the plan does not report the person type', () => {
    expect(canOpenPlanChat(true, [], 'me', true)).toBe(true);
    expect(canOpenPlanChat(false, [assignment({})], 'me', true)).toBe(true);
    expect(canOpenPlanChat(false, [assignment({})], 'me', undefined)).toBe(true);
    expect(canOpenPlanChat(false, [], 'me', true)).toBe(false);
  });

  it('hides it on the live pages until the plan has loaded (no assignments, no leader grant)', () => {
    expect(canOpenPlanChat(false, [], undefined, undefined)).toBe(false);
    expect(canOpenPlanChat(false, [], 'me', false)).toBe(false);
  });

  it('does not offer it to a leader before the plan has loaded, then follows viewer_is_adult_person', () => {
    expect(canOfferPlanChat(undefined, true, 'me')).toBe(false);
    expect(canOfferPlanChat({ assignments: [], viewer_is_adult_person: true }, true, 'me')).toBe(true);
    expect(canOfferPlanChat({ assignments: [], viewer_is_adult_person: false }, true, 'me')).toBe(false);
  });
});
