import type { PlanDetail, PlanItemDetail } from '../types/domain.js';
import { ApiError, type ServiceCenterApi } from './api-client.js';

/**
 * The full order with `newId` moved to just after `afterId` (the start when
 * null), as the reorder endpoint wants it. Null when there is nothing to
 * send: the new item is missing, the anchor is gone (someone removed it), or
 * the item already sits there.
 */
export const orderWithInsertedItem = (ids: readonly string[], newId: string, afterId: string | null): string[] | null => {
  if (!ids.includes(newId)) return null;
  const rest = ids.filter((id) => id !== newId);
  const index = afterId === null ? 0 : rest.indexOf(afterId) + 1;
  if (afterId !== null && index === 0) return null;
  const next = [...rest.slice(0, index), newId, ...rest.slice(index)];
  return next.every((id, position) => id === ids[position]) ? null : next;
};

type PlanOrderSnapshot = Pick<PlanDetail, 'content_revision'> & {
  items: readonly Pick<PlanItemDetail, 'id'>[];
};

interface PlanOrderApi {
  getPlan: (planId: string) => Promise<PlanOrderSnapshot>;
  reorderPlanItems: ServiceCenterApi['reorderPlanItems'];
}

/** Places an already-added item using an order and revision from the same read. */
export const placePlanItem = async (
  api: PlanOrderApi,
  planId: string,
  itemId: string,
  afterId: string | null,
): Promise<boolean> => {
  for (const attempt of [1, 2]) {
    try {
      const latest = await api.getPlan(planId);
      const ids = latest.items.map((item) => item.id);
      const anchorIndex = afterId === null ? -1 : ids.indexOf(afterId);
      if (afterId !== null && anchorIndex === -1) return false;
      if (ids[anchorIndex + 1] === itemId) return true;
      const order = orderWithInsertedItem(ids, itemId, afterId);
      if (!order) return false;
      await api.reorderPlanItems(planId, order, latest.content_revision);
      return true;
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'plan_revision_stale') || attempt === 2) return false;
    }
  }
  return false;
};
