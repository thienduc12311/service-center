/** Width of the Delete action revealed behind a swiped row. */
export const SWIPE_ACTION_WIDTH = 88;

/** Where a swiped row comes to rest once the finger lifts. */
export type SwipeRest = 'open' | 'closed';

/**
 * Decides whether a released row stays open (Delete visible) or closes.
 * `offset` is where the row was when the gesture started; `dx`/`vx` describe
 * the gesture (negative = leftwards).
 */
export const settleSwipe = (offset: number, dx: number, vx: number, width = SWIPE_ACTION_WIDTH): SwipeRest => {
  if (vx < -0.5) return 'open';
  if (vx > 0.5) return 'closed';
  return offset + dx < -width / 2 ? 'open' : 'closed';
};

/** Keeps a dragged row between fully closed and a little past the action width. */
export const clampSwipe = (offset: number, dx: number, width = SWIPE_ACTION_WIDTH): number =>
  Math.min(0, Math.max(-width * 1.25, offset + dx));

/** Only clearly horizontal, leftwards-or-closing drags become swipes, so vertical scrolling keeps working. */
export const isSwipeGesture = (dx: number, dy: number, isOpen: boolean): boolean =>
  Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5 && (dx < 0 || isOpen);
