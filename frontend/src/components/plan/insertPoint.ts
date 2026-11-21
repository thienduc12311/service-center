/**
 * Where new order items go. `end` appends (what the server does on its own);
 * `after` places them right after an item, or before the first one when
 * `itemId` is null. Several adds at one point keep their order: each next
 * item goes after the one added before it.
 */
export type OrderInsertPoint = { kind: 'end' } | { kind: 'after'; itemId: string | null };

export const INSERT_AT_END: OrderInsertPoint = { kind: 'end' };

/** The point after an item was added there: right after that item, so the next add follows it. */
export const advanceInsertPoint = (point: OrderInsertPoint, addedItemId: string): OrderInsertPoint =>
  point.kind === 'end' ? point : { kind: 'after', itemId: addedItemId };
