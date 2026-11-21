import { describe, expect, it } from 'vitest';
import { groupBy, localMonthKey } from './grouping';

describe('groupBy', () => {
  it('keeps groups in first-seen order and items in list order', () => {
    const plans = [
      { id: 'a', month: '2026-11' },
      { id: 'b', month: '2026-12' },
      { id: 'c', month: '2026-11' },
    ];
    expect(groupBy(plans, (plan) => plan.month)).toEqual([
      { key: '2026-11', items: [plans[0], plans[2]] },
      { key: '2026-12', items: [plans[1]] },
    ]);
    expect(groupBy([], () => 'x')).toEqual([]);
  });

  it('keys an instant by the viewer’s local month', () => {
    const local = new Date(2026, 10, 30, 23, 30);
    expect(localMonthKey(local.toISOString())).toBe('2026-11');
  });
});
