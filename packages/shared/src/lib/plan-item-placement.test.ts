import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client.js';
import { placePlanItem } from './plan-item-placement.js';

const snapshot = (ids: string[], content_revision: number) => ({
  items: ids.map((id) => ({ id })),
  content_revision,
});

describe('placePlanItem', () => {
  it('uses the versioned order from the server and preserves concurrent moves', async () => {
    const api = {
      getPlan: vi.fn().mockResolvedValueOnce(snapshot(['b', 'a', 'c', 'new'], 9)),
      reorderPlanItems: vi.fn().mockResolvedValue([]),
    };
    expect(await placePlanItem(api, 'plan', 'new', 'a')).toBe(true);
    expect(api.reorderPlanItems).toHaveBeenCalledWith('plan', ['b', 'a', 'new', 'c'], 9);
  });

  it('refreshes and recomputes after a stale revision', async () => {
    const api = {
      getPlan: vi.fn()
        .mockResolvedValueOnce(snapshot(['a', 'b', 'c', 'new'], 9))
        .mockResolvedValueOnce(snapshot(['b', 'a', 'c', 'new'], 10)),
      reorderPlanItems: vi.fn()
        .mockRejectedValueOnce(new ApiError(409, 'Order changed', 'plan_revision_stale'))
        .mockResolvedValueOnce([]),
    };
    expect(await placePlanItem(api, 'plan', 'new', 'a')).toBe(true);
    expect(api.reorderPlanItems).toHaveBeenLastCalledWith('plan', ['b', 'a', 'new', 'c'], 10);
  });

  it('keeps the add successful when placement cannot be verified', async () => {
    const api = {
      getPlan: vi.fn().mockRejectedValueOnce(new Error('Connection lost')),
      reorderPlanItems: vi.fn(),
    };
    expect(await placePlanItem(api, 'plan', 'new', 'a')).toBe(false);
    expect(api.reorderPlanItems).not.toHaveBeenCalled();
  });

  it('avoids a write if the item is already in place or the anchor disappeared', async () => {
    const api = {
      getPlan: vi.fn()
        .mockResolvedValueOnce(snapshot(['a', 'new', 'b'], 9))
        .mockResolvedValueOnce(snapshot(['b', 'new'], 10)),
      reorderPlanItems: vi.fn(),
    };
    expect(await placePlanItem(api, 'plan', 'new', 'a')).toBe(true);
    expect(await placePlanItem(api, 'plan', 'new', 'a')).toBe(false);
    expect(api.reorderPlanItems).not.toHaveBeenCalled();
  });
});
