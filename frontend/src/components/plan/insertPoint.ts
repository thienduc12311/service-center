/**
 * Where new order items go. `end` appends (what the server does on its own);
 * `after` places them right after an item, or before the first one when
 * `itemId` is null. Several adds at one point keep their order: each next
 * item goes after the one added before it.
 */
export type OrderInsertPoint = { kind: 'end' } | { kind: 'after'; itemId: string | null };

export const INSERT_AT_END: OrderInsertPoint = { kind: 'end' };

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

/** The point after an item was added there: right after that item, so the next add follows it. */
export const advanceInsertPoint = (point: OrderInsertPoint, addedItemId: string): OrderInsertPoint =>
  point.kind === 'end' ? point : { kind: 'after', itemId: addedItemId };
