import { describe, expect, it } from 'vitest';
import { clampSwipe, isSwipeGesture, settleSwipe, SWIPE_ACTION_WIDTH } from './swipe-to-delete';

describe('swipe to delete', () => {
  it('opens past half the action width and closes before it', () => {
    expect(settleSwipe(0, -(SWIPE_ACTION_WIDTH / 2) - 1, 0)).toBe('open');
    expect(settleSwipe(0, -(SWIPE_ACTION_WIDTH / 2) + 1, 0)).toBe('closed');
  });

  it('follows a quick flick regardless of distance', () => {
    expect(settleSwipe(0, -10, -1)).toBe('open');
    expect(settleSwipe(-SWIPE_ACTION_WIDTH, 10, 1)).toBe('closed');
  });

  it('keeps an open row open unless dragged back past halfway', () => {
    expect(settleSwipe(-SWIPE_ACTION_WIDTH, 20, 0)).toBe('open');
    expect(settleSwipe(-SWIPE_ACTION_WIDTH, 60, 0)).toBe('closed');
  });

  it('never drags right of closed or far beyond the action', () => {
    expect(clampSwipe(0, 40)).toBe(0);
    expect(clampSwipe(0, -1000)).toBe(-SWIPE_ACTION_WIDTH * 1.25);
  });

  it('leaves vertical scrolls and rightward drags on a closed row alone', () => {
    expect(isSwipeGesture(-20, 2, false)).toBe(true);
    expect(isSwipeGesture(-20, 30, false)).toBe(false);
    expect(isSwipeGesture(20, 0, false)).toBe(false);
    expect(isSwipeGesture(20, 0, true)).toBe(true);
    expect(isSwipeGesture(-4, 0, false)).toBe(false);
  });
});
