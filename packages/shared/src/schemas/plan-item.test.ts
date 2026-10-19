import { describe, expect, it } from 'vitest';
import { createPlanItemSchema, deletePlanItemQuerySchema, reorderPlanItemsSchema, updatePlanItemSchema } from './plan.js';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

describe('F11 plan item schemas', () => {
  it('accepts a full edit and keeps absent fields absent', () => {
    const parsed = updatePlanItemSchema.parse({ key_override: 'D', sequence_override: ['V1', 'C'], expected_revision: 4 });
    expect(parsed).toEqual({ key_override: 'D', sequence_override: ['V1', 'C'], expected_revision: 4 });
    expect(updatePlanItemSchema.parse({ sequence_override: null })).toEqual({ sequence_override: null });
  });

  it('rejects negative durations, blank sequence steps, two leaders and an arrangement on a non-song', () => {
    expect(updatePlanItemSchema.safeParse({ length_seconds: -1 }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ sequence_override: ['V1', ' '] }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ leader_person_id: id, leader_position_id: other }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ item_type: 'item', arrangement_id: id }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ service_segment: 'later' }).success).toBe(false);
    expect(createPlanItemSchema.safeParse({ item_type: 'item', title: 'x', leader_person_id: id, leader_position_id: other }).success).toBe(false);
  });

  it('carries optional expected revisions for reorder and delete', () => {
    expect(reorderPlanItemsSchema.parse({ item_ids: [id], expected_revision: 2 }).expected_revision).toBe(2);
    expect(reorderPlanItemsSchema.parse({ item_ids: [id] }).expected_revision).toBeUndefined();
    expect(deletePlanItemQuerySchema.parse({ expected_revision: '7' }).expected_revision).toBe(7);
  });
});
