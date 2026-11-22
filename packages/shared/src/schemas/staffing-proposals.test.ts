import { describe, expect, it } from 'vitest';
import { createStaffingProposalSchema, recomputeStaffingProposalSchema } from './staffing-proposals.js';

const id = (value: number): string => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const slot = { plan_id: id(1), position_id: id(2), person_id: id(3) };
const otherPerson = { ...slot, person_id: id(4) };

describe('staffing proposal schemas (W10-CD-D9)', () => {
  it('refuses a lock and an exclusion on the same slot at create, like recompute', () => {
    const created = createStaffingProposalSchema.safeParse({
      plan_ids: [id(1)], team_ids: [id(5)], locks: [slot], exclusions: [slot],
    });
    expect(created.success).toBe(false);
    expect(created.error?.issues[0]?.path).toEqual(['exclusions']);
    expect(recomputeStaffingProposalSchema.safeParse({
      expected_revision: 0, edits: { locks: [slot], exclusions: [slot] },
    }).success).toBe(false);
  });

  it('accepts a lock and an exclusion for different people on the same slot', () => {
    const created = createStaffingProposalSchema.parse({
      plan_ids: [id(1)], team_ids: [id(5)], locks: [slot], exclusions: [otherPerson],
    });
    expect(created.locks).toEqual([slot]);
    expect(created.exclusions).toEqual([otherPerson]);
    expect(createStaffingProposalSchema.parse({ plan_ids: [id(1)], team_ids: [id(5)] }).locks).toEqual([]);
  });
});
