import { useCallback } from 'react';
import { placePlanItem, type CreatePlanItemRequest, type PlanItemRow } from '@service-center/shared';
import { api } from '../../lib/api';
import type { OrderInsertPoint } from './insertPoint';

/** An added item, and whether it landed where it was asked to go. */
export interface InsertedPlanItem {
  item: PlanItemRow & { content_revision: number };
  /** Whether the requested placement was confirmed. */
  placed: boolean;
}

export type InsertPlanItem = (body: CreatePlanItemRequest, point: OrderInsertPoint) => Promise<InsertedPlanItem>;

/**
 * Adds one item at an insert point. The add endpoint only appends, so an
 * item asked to go elsewhere is then moved with one reorder of the full
 * order, sent with the revision it was computed from. If another editor
 * changes the order in between, that reorder is refused as stale and is
 * computed again from the latest order; the item itself is never added twice
 * (the add carries its idempotency key).
 */
export const usePlanItemInsert = (planId: string): InsertPlanItem =>
  useCallback<InsertPlanItem>(
    async (body, point) => {
      const item = await api.addPlanItem(planId, body);
      const placed = point.kind === 'end' || await placePlanItem(api, planId, item.id, point.itemId);
      return { item, placed };
    },
    [planId],
  );
