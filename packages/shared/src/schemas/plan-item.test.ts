import { describe, expect, it } from 'vitest';
import { createPlanItemSchema, deletePlanItemQuerySchema, reorderPlanItemsSchema, updatePlanItemSchema } from './plan.js';

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';

describe('F11 plan item schemas', () => {
  it('takes an optional idempotency key on add', () => {
    expect(createPlanItemSchema.safeParse({ item_type: 'item', title: 'x' }).success).toBe(true);
    expect(createPlanItemSchema.parse({ item_type: 'item', title: 'x', idempotency_key: id }).idempotency_key).toBe(id);
    expect(createPlanItemSchema.safeParse({ item_type: 'item', title: 'x', idempotency_key: 'short' }).success).toBe(false);
  });

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

  it('accepts details up to 20,000 characters and null to clear them', () => {
    expect(updatePlanItemSchema.parse({ details: '## Notes\n- **soft**' }).details).toBe('## Notes\n- **soft**');
    expect(updatePlanItemSchema.parse({ details: null })).toEqual({ details: null });
    expect(updatePlanItemSchema.safeParse({ details: 'x'.repeat(20_000) }).success).toBe(true);
    expect(updatePlanItemSchema.safeParse({ details: 'x'.repeat(20_001) }).success).toBe(false);
    expect(createPlanItemSchema.safeParse({ item_type: 'item', title: 'x', details: 'x'.repeat(20_001) }).success).toBe(false);
  });

  it('takes the full list of service times; empty is every time', () => {
    expect(updatePlanItemSchema.parse({ time_ids: [id, other] }).time_ids).toEqual([id, other]);
    expect(updatePlanItemSchema.parse({ time_ids: [] }).time_ids).toEqual([]);
    expect(updatePlanItemSchema.safeParse({ time_ids: ['nine'] }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ time_ids: null }).success).toBe(false);
    expect(updatePlanItemSchema.safeParse({ time_ids: Array.from({ length: 51 }, () => id) }).success).toBe(false);
  });

  it('takes the carry-notes flag on add only as a boolean', () => {
    const body = { item_type: 'song', song_id: id, carry_notes_from_last_use: true };
    expect(createPlanItemSchema.parse(body).carry_notes_from_last_use).toBe(true);
    expect(createPlanItemSchema.parse({ item_type: 'song', song_id: id }).carry_notes_from_last_use).toBeUndefined();
    expect(createPlanItemSchema.safeParse({ ...body, carry_notes_from_last_use: 'yes' }).success).toBe(false);
  });

  it('carries optional expected revisions for reorder and delete', () => {
    expect(reorderPlanItemsSchema.parse({ item_ids: [id], expected_revision: 2 }).expected_revision).toBe(2);
    expect(reorderPlanItemsSchema.parse({ item_ids: [id] }).expected_revision).toBeUndefined();
    expect(deletePlanItemQuerySchema.parse({ expected_revision: '7' }).expected_revision).toBe(7);
  });
});
