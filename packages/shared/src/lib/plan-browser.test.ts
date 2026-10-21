import { describe, expect, it } from 'vitest';
import { listPlansQuerySchema } from '../schemas/plan.js';
import {
  PLAN_BROWSER_PAGE_SIZE,
  mergePlanPages,
  nextPlanPage,
  pickPlanNeighbours,
  planBrowserQuery,
  planNeighbourQueries,
} from './plan-browser.js';

const openedAt = '2026-10-20T09:00:00.000Z';
const typeId = '11111111-1111-4111-8111-111111111111';

describe('planBrowserQuery', () => {
  it('reads upcoming plans forwards from the opening instant', () => {
    const query = planBrowserQuery({ window: 'upcoming', serviceTypeId: null, status: null, openedAt }, 1);
    expect(query).toEqual({ page: 1, per_page: PLAN_BROWSER_PAGE_SIZE, from: openedAt, order: 'asc' });
  });

  it('reads history backwards from just before it, so the windows never share a plan', () => {
    const query = planBrowserQuery({ window: 'history', serviceTypeId: typeId, status: 'published', openedAt }, 3);
    expect(query).toEqual({
      page: 3,
      per_page: PLAN_BROWSER_PAGE_SIZE,
      service_type_id: typeId,
      status: 'published',
      to: '2026-10-20T08:59:59.999Z',
      order: 'desc',
    });
  });

  it('is accepted unchanged by the server schema', () => {
    const query = planBrowserQuery({ window: 'history', serviceTypeId: typeId, status: 'draft', openedAt }, 2);
    expect(listPlansQuerySchema.parse(query)).toEqual(query);
  });
});

describe('nextPlanPage', () => {
  it('stops at the last page', () => {
    expect(nextPlanPage({ data: [], page: 1, per_page: 25, total: 26 })).toBe(2);
    expect(nextPlanPage({ data: [], page: 2, per_page: 25, total: 50 })).toBeNull();
    expect(nextPlanPage({ data: [], page: 1, per_page: 25, total: 0 })).toBeNull();
  });
});

describe('planNeighbourQueries', () => {
  it('brackets the plan within its service type', () => {
    const date = '2026-10-25T10:00:00+00:00';
    const { before, after } = planNeighbourQueries({ service_date: date, service_type_id: typeId });
    expect(before).toMatchObject({ service_type_id: typeId, to: date, order: 'desc' });
    expect(after).toMatchObject({ service_type_id: typeId, from: date, order: 'asc' });
    expect(listPlansQuerySchema.safeParse(before).success).toBe(true);
  });

  it('uses every plan when the plan has no service type, as the website does', () => {
    const { before, after } = planNeighbourQueries({ service_date: openedAt, service_type_id: null });
    expect(before).not.toHaveProperty('service_type_id');
    expect(after).not.toHaveProperty('service_type_id');
  });
});

describe('pickPlanNeighbours', () => {
  const ids = (...list: string[]) => list.map((id) => ({ id }));

  it('takes the plan after the current one in each direction', () => {
    expect(pickPlanNeighbours('c', ids('c', 'b', 'a'), ids('c', 'd'))).toEqual({ previous: 'b', next: 'd' });
  });

  it('steps through plans at the same instant in id order', () => {
    // Server order for equal dates: ascending ids forwards, descending backwards.
    expect(pickPlanNeighbours('b', ids('c', 'b', 'a'), ids('a', 'b', 'c'))).toEqual({ previous: 'a', next: 'c' });
  });

  it('is null at either end, and when the plan is missing from a read', () => {
    expect(pickPlanNeighbours('a', ids('a'), ids('a', 'b'))).toEqual({ previous: null, next: 'b' });
    expect(pickPlanNeighbours('z', ids('a'), ids('b'))).toEqual({ previous: null, next: null });
  });
});

describe('mergePlanPages', () => {
  it('keeps a plan that shifted onto the next page once', () => {
    const page = (n: number, ...list: string[]) => ({ data: list.map((id) => ({ id })), page: n, per_page: 2, total: 5 });
    expect(mergePlanPages([page(1, 'a', 'b'), page(2, 'b', 'c')]).map((plan) => plan.id)).toEqual(['a', 'b', 'c']);
  });
});
