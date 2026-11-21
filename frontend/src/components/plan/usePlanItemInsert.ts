import { useCallback } from 'react';
import { ApiError, type CreatePlanItemRequest, type PlanItemRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { orderWithInsertedItem, type OrderInsertPoint } from './insertPoint';

/** An added item, and whether it landed where it was asked to go. */
export interface InsertedPlanItem {
  item: PlanItemRow & { content_revision: number };
  /** False when it stayed at the end: the anchor was removed or the order kept changing. */
  placed: boolean;
}

export type InsertPlanItem = (body: CreatePlanItemRequest, point: OrderInsertPoint) => Promise<InsertedPlanItem>;

/** Placing tries this many times when someone else changes the order in between. */
const PLACE_ATTEMPTS = 2;

/** True when `id` directly follows `afterId` (or is first, for null). */
const sitsAt = (ids: readonly string[], id: string, afterId: string | null): boolean => {
  if (afterId === null) return ids[0] === id;
  const anchor = ids.indexOf(afterId);
  return anchor !== -1 && ids[anchor + 1] === id;
};

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
      if (point.kind === 'end') return { item, placed: true };
      for (let attempt = 1; attempt <= PLACE_ATTEMPTS; attempt += 1) {
        const latest = await api.getPlan(planId);
        const ids = latest.items.map((entry) => entry.id);
        const order = orderWithInsertedItem(ids, item.id, point.itemId);
        if (!order) {
          // Already in place, or the anchor is gone and the end is the honest place for it.
          return { item, placed: sitsAt(ids, item.id, point.itemId) };
        }
        try {
          await api.reorderPlanItems(planId, order, latest.content_revision);
          return { item, placed: true };
        } catch (error) {
          const stale = error instanceof ApiError && error.code === 'plan_revision_stale';
          if (!stale || attempt === PLACE_ATTEMPTS) return { item, placed: false };
        }
      }
      return { item, placed: false };
    },
    [planId],
  );
