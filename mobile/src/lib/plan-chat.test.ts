import { describe, expect, it } from 'vitest';
import { canOpenPlanChat, type PlanChatAssignment } from '@service-center/shared';

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
});
