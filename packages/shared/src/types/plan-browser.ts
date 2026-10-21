/**
 * MOB-012: browsing plans by service type, and stepping to the previous/next
 * plan. Built on `GET /api/v1/plans` (`listPlansQuerySchema`); nothing here is
 * a new wire shape.
 */

import type { PlanStatus } from './database.js';

/** Upcoming plans run forwards from a fixed instant; history runs backwards. */
export type PlanBrowserWindow = 'upcoming' | 'history';

/** The filters a plans browser offers, all optional except the window. */
export interface PlanBrowserFilters {
  window: PlanBrowserWindow;
  /** null = every service type the caller can see. */
  serviceTypeId: string | null;
  /** null = every status the caller can see. */
  status: PlanStatus | null;
  /**
   * ISO instant the browser was opened. Fixed for the browser's lifetime so
   * pages don't shift between loads as the clock moves.
   */
  openedAt: string;
}

/**
 * The `GET /api/v1/plans` query a client sends (`listPlansQuerySchema` input).
 * A type alias, not an interface, so it stays assignable to the client's query map.
 */
export type ListPlansRequest = {
  page?: number;
  per_page?: number;
  status?: PlanStatus;
  service_type_id?: string;
  from?: string;
  to?: string;
  order?: 'asc' | 'desc';
};

/** The two reads that find a plan's neighbours in its service type. */
export interface PlanNeighbourQueries {
  /** The plan and those at or before it, newest first. */
  before: ListPlansRequest;
  /** The plan and those at or after it, oldest first. */
  after: ListPlansRequest;
}

/** Ids of the plans either side of one plan; null at either end. */
export interface PlanNeighbours {
  previous: string | null;
  next: string | null;
}
