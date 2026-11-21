/**
 * "Add songs after this": the add endpoint always appends (a `sort_order` in
 * the body would collide with the item already there), so an add at a chosen
 * point is the add followed by one `reorderPlanItems` with the whole order,
 * checked against the revision the add returned. Several adds in one visit
 * keep their order: each new item becomes the next insert point.
 */

/** Where the next added item goes, and the order as this screen last saw it. */
export interface InsertCursor {
  /** Insert after this item; null appends at the end (no reorder). */
  afterItemId: string | null;
  /** Item ids in plan order, as of the last add or reorder this screen made. */
  order: readonly string[];
}

/**
 * The whole order with `newItemId` placed right after `afterItemId`, for one
 * reorder request. Null when no request is needed (it already sits there,
 * i.e. the anchor is the last item) or cannot be made (the anchor is gone).
 */
export const orderWithInserted = (order: readonly string[], afterItemId: string, newItemId: string): string[] | null => {
  const others = order.filter((id) => id !== newItemId);
  const at = others.indexOf(afterItemId);
  if (at === -1 || at === others.length - 1) return null;
  return [...others.slice(0, at + 1), newItemId, ...others.slice(at + 1)];
};

/** What happened to an added item's position. */
export type InsertPlacement =
  /** Appended, as asked. */
  | 'end'
  /** Moved to the chosen point. */
  | 'placed'
  /** The order changed meanwhile (or the anchor is gone): it stayed at the end. */
  | 'failed';

/** The next step for an item the server just appended. */
export type InsertStep =
  | { kind: 'none'; placement: InsertPlacement; cursor: InsertCursor }
  | { kind: 'reorder'; itemIds: string[] };

/**
 * After an add: either nothing more to send (appended, or the anchor was the
 * last item already) with the cursor for the next add, or the reorder to send.
 */
export const insertStep = (cursor: InsertCursor, newItemId: string): InsertStep => {
  const appended = [...cursor.order.filter((id) => id !== newItemId), newItemId];
  if (cursor.afterItemId === null) {
    return { kind: 'none', placement: 'end', cursor: { afterItemId: null, order: appended } };
  }
  if (!cursor.order.includes(cursor.afterItemId)) {
    return { kind: 'none', placement: 'failed', cursor: { afterItemId: null, order: appended } };
  }
  const itemIds = orderWithInserted(cursor.order, cursor.afterItemId, newItemId);
  if (!itemIds) {
    // The anchor was last: appending put it in the right place; the next one follows it.
    return { kind: 'none', placement: 'placed', cursor: { afterItemId: newItemId, order: appended } };
  }
  return { kind: 'reorder', itemIds };
};

/** The cursor after the reorder was saved (`savedOrder` is the server's order). */
export const cursorAfterPlaced = (newItemId: string, savedOrder: readonly string[]): InsertCursor => ({
  afterItemId: newItemId,
  order: savedOrder,
});

/** The cursor after the reorder was refused: later adds append. */
export const cursorAfterFailed = (cursor: InsertCursor, newItemId: string): InsertCursor => ({
  afterItemId: null,
  order: [...cursor.order.filter((id) => id !== newItemId), newItemId],
});
