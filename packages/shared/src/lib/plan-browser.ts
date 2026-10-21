/**
 * MOB-012: the plan list queries both clients send, and previous/next
 * resolution. The list endpoint orders by (service_date, id), so equal dates
 * still have one stable order in both directions and across pages.
 */

import type { PlanRow } from '../types/database.js';
import type { Paginated } from '../types/domain.js';
import type {
  ListPlansRequest,
  PlanBrowserFilters,
  PlanNeighbourQueries,
  PlanNeighbours,
} from '../types/plan-browser.js';

/** Plans per page in a browser; small enough for a phone's first screen and a quick next page. */
export const PLAN_BROWSER_PAGE_SIZE = 25;

/**
 * How many plans each neighbour read fetches. Only plans sharing the exact
 * same date and time as the current one push it further down the page.
 */
export const PLAN_NEIGHBOUR_WINDOW = 20;

/**
 * One page of a plans browser. Upcoming starts at `openedAt` (ascending);
 * history ends just before it (descending), so the two never overlap.
 */
export const planBrowserQuery = (filters: PlanBrowserFilters, page: number): ListPlansRequest => {
  const history = filters.window === 'history';
  return {
    page,
    per_page: PLAN_BROWSER_PAGE_SIZE,
    ...(filters.serviceTypeId ? { service_type_id: filters.serviceTypeId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(history
      ? { to: new Date(new Date(filters.openedAt).getTime() - 1).toISOString(), order: 'desc' as const }
      : { from: filters.openedAt, order: 'asc' as const }),
  };
};

/** The page after `page`, or null when it was the last one. */
export const nextPlanPage = <T>(page: Paginated<T>): number | null =>
  page.page * page.per_page < page.total ? page.page + 1 : null;

/**
 * Reads that bracket one plan within its service type (every plan when it has
 * none, as the website has always done). Both include the plan itself.
 */
export const planNeighbourQueries = (
  plan: Pick<PlanRow, 'service_date' | 'service_type_id'>,
): PlanNeighbourQueries => {
  const scope = plan.service_type_id ? { service_type_id: plan.service_type_id } : {};
  return {
    before: { ...scope, to: plan.service_date, order: 'desc', per_page: PLAN_NEIGHBOUR_WINDOW },
    after: { ...scope, from: plan.service_date, order: 'asc', per_page: PLAN_NEIGHBOUR_WINDOW },
  };
};

/**
 * The plans immediately before and after `planId`, from the two reads above.
 * A side is null at the end of the list, or when the plan isn't in that read
 * (more than a window's worth of plans at the very same instant).
 */
export const pickPlanNeighbours = (
  planId: string,
  before: readonly Pick<PlanRow, 'id'>[],
  after: readonly Pick<PlanRow, 'id'>[],
): PlanNeighbours => {
  const following = (list: readonly Pick<PlanRow, 'id'>[]): string | null => {
    const index = list.findIndex((plan) => plan.id === planId);
    return index === -1 ? null : (list[index + 1]?.id ?? null);
  };
  return { previous: following(before), next: following(after) };
};

/**
 * Every loaded page as one list. A plan added or moved between page loads can
 * shift offsets; it is kept once, where it was first seen.
 */
export const mergePlanPages = <T extends Pick<PlanRow, 'id'>>(pages: readonly Paginated<T>[]): T[] => {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const page of pages) {
    for (const plan of page.data) {
      if (seen.has(plan.id)) continue;
      seen.add(plan.id);
      merged.push(plan);
    }
  }
  return merged;
};
