import {
  computePlanSchedule,
  selectServiceTime,
  serviceTimesOf,
  type CreatePlanItemInput,
  type PlanDetail,
  type PlanItemArrangement,
  type PlanItemCreateResult,
  type PlanItemRow,
  type PlanItemSaveResult,
  type PlanOrderSaveResult,
  type PlanScheduleResponse,
  type UpdatePlanItemInput,
} from '@service-center/shared';
import { unwrap, type Db } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { buildPlanItemCreateBody, buildPlanItemPatch } from '../model/plan-item.model.js';

/** Same columns as the plan detail's item arrangement join. */
export const PLAN_ITEM_ARRANGEMENT_COLUMNS =
  'id, song_id, name, song_key, bpm, sequence, chord_chart, chart_columns, chart_font, chart_font_size, chart_chord_color, is_default, length_seconds';

export interface AddPlanItemServiceInput {
  db: Db;
  orgId: string;
  planId: string;
  input: CreatePlanItemInput;
}

/**
 * F11: appends (or places) one item under the plan lock, so concurrent adds
 * get distinct positions. With a key, a retry returns the first item.
 */
export const addPlanItem = async ({ db, orgId, planId, input }: AddPlanItemServiceInput): Promise<PlanItemCreateResult> => {
  const plan = await unwrap(db.from('plans').select('id').eq('id', planId).eq('organization_id', orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');

  const { data, error } = await db.rpc('add_plan_item', {
    p_plan_id: plan.id,
    p_item: buildPlanItemCreateBody(input),
    p_idempotency_key: input.idempotency_key ?? null,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Plan not found');
  return data;
};

export interface UpdatePlanItemServiceInput {
  db: Db;
  planId: string;
  itemId: string;
  input: UpdatePlanItemInput;
}

/** F11: one revisioned edit of an existing item; same id and position. */
export const updatePlanItem = async ({ db, planId, itemId, input }: UpdatePlanItemServiceInput): Promise<PlanItemSaveResult> => {
  const current = await unwrap(
    db
      .from('plan_items')
      .select('item_type, song_id, leader_person_id, leader_position_id')
      .eq('id', itemId)
      .eq('plan_id', planId)
      .maybeSingle(),
  );
  if (!current) throw HttpError.notFound('Item not found');

  const { data, error } = await db.rpc('update_plan_item', {
    p_plan_id: planId,
    p_item_id: itemId,
    p_patch: buildPlanItemPatch(input, current),
    p_expected_revision: input.expected_revision ?? null,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Item not found');
  return data;
};

export interface ReorderPlanItemsServiceInput {
  db: Db;
  planId: string;
  itemIds: string[];
  expectedRevision?: number;
}

/** The whole order in one transaction (was one request per row). */
export const reorderPlanItems = async (input: ReorderPlanItemsServiceInput): Promise<PlanItemRow[]> => {
  if (new Set(input.itemIds).size !== input.itemIds.length) {
    throw HttpError.badRequest('Send every item id in the plan exactly once, in the new order');
  }
  const { error } = await input.db.rpc('reorder_plan_items', {
    p_plan_id: input.planId,
    p_item_ids: input.itemIds,
    p_expected_revision: input.expectedRevision ?? null,
  });
  if (error) throw fromPostgrestError(error);
  return (await unwrap(input.db.from('plan_items').select('*').eq('plan_id', input.planId).order('sort_order'))) ?? [];
};

export const deletePlanItem = async (
  db: Db,
  planId: string,
  itemId: string,
  expectedRevision?: number,
): Promise<PlanOrderSaveResult> => {
  const { data, error } = await db.rpc('delete_plan_item', {
    p_plan_id: planId,
    p_item_id: itemId,
    p_expected_revision: expectedRevision ?? null,
  });
  if (error) throw fromPostgrestError(error);
  if (!data) throw HttpError.notFound('Item not found');
  return data;
};

/**
 * The song's default arrangement for each song id, so an item that chose
 * none charts what it inherits. Read with the caller's client (RLS).
 */
export const defaultArrangementsFor = async (
  db: Db,
  songIds: readonly string[],
): Promise<Map<string, PlanItemArrangement>> => {
  if (!songIds.length) return new Map();
  const rows = ((await unwrap(
    db
      .from('arrangements')
      .select(PLAN_ITEM_ARRANGEMENT_COLUMNS)
      .in('song_id', [...new Set(songIds)])
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true }),
  )) ?? []) as PlanItemArrangement[];
  const defaults = new Map<string, PlanItemArrangement>();
  // Default first, else the oldest — the same choice the library makes.
  for (const row of rows) if (!defaults.has(row.song_id)) defaults.set(row.song_id, row);
  return defaults;
};

/** `GET /plans/:id/schedule`: derived from the plan the caller can read. */
export const planScheduleFor = (plan: PlanDetail, timeId?: string): PlanScheduleResponse => {
  const time = selectServiceTime(plan.times, timeId);
  if (time === undefined) throw HttpError.notFound('Service time not found');
  return {
    content_revision: plan.content_revision,
    selected: computePlanSchedule({ items: plan.items, time }),
    service_times: serviceTimesOf(plan.times).map(({ id, name, starts_at, ends_at }) => ({ id, name, starts_at, ends_at })),
  };
};
