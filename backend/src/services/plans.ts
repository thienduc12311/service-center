import type {
  AssignmentDetail,
  AssignmentRow,
  PlanDetail,
  PlanItemDetail,
  PlanItemRow,
  PlanPositionNeed,
  PlanSummary,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

/**
 * `person:profiles!assignments_user_id_fkey` is spelled out because
 * `assignments` has two foreign keys into `profiles` (user_id and created_by),
 * which PostgREST cannot disambiguate on its own.
 */
export const PLAN_DETAIL_SELECT = `
  *,
  service_type:service_types(id, name, recurrence),
  times:plan_times(*),
  items:plan_items(
    *,
    song:songs(id, title, author, default_key),
    arrangement:arrangements(id, name, song_key, bpm, chord_chart)
  ),
  assignments:assignments(
    *,
    team:teams(id, name, color),
    position:team_positions(id, name),
    person:profiles!assignments_user_id_fkey(id, full_name, email, avatar_url, phone)
  ),
  position_needs:plan_position_needs(
    needed,
    position:team_positions(id, team_id)
  )
`;

export const PLAN_SUMMARY_SELECT = `
  *,
  service_type:service_types(id, name, recurrence),
  times:plan_times(*),
  items:plan_items(id, item_type),
  assignments:assignments(id, status)
`;

type RawPositionNeed = {
  needed: number;
  position: { id: string; team_id: string } | null;
};

type RawPlan = Record<string, unknown> & {
  items?: Array<{ item_type?: string }>;
  assignments?: Array<{ status?: string }>;
  times?: Array<Record<string, unknown>>;
  position_needs?: RawPositionNeed[];
};

/**
 * The team is read back off the joined position rather than stored on the need
 * row, so a need can never claim a team the position doesn't belong to. A need
 * whose position has been deleted is dropped.
 */
export const shapePositionNeeds = (rows: readonly RawPositionNeed[] = []): PlanPositionNeed[] =>
  rows
    .filter((row): row is RawPositionNeed & { position: { id: string; team_id: string } } =>
      Boolean(row.position),
    )
    .map((row) => ({
      position_id: row.position.id,
      team_id: row.position.team_id,
      needed: row.needed,
    }));

const byKind = (times: RawPlan['times'] = []) =>
  [...times].sort(
    (a, b) => new Date(String(a.starts_at)).getTime() - new Date(String(b.starts_at)).getTime(),
  );

export const shapePlanSummary = (row: RawPlan): PlanSummary => {
  const items = row.items ?? [];
  const assignments = row.assignments ?? [];
  return {
    ...(row as object),
    times: byKind(row.times),
    counts: {
      items: items.length,
      songs: items.filter((i) => i.item_type === 'song').length,
      confirmed: assignments.filter((a) => a.status === 'confirmed').length,
      unconfirmed: assignments.filter((a) => a.status === 'unconfirmed').length,
      declined: assignments.filter((a) => a.status === 'declined').length,
    },
  } as unknown as PlanSummary;
};

export const shapePlanDetail = (row: RawPlan): PlanDetail => {
  const items = ([...((row.items as PlanItemDetail[] | undefined) ?? [])] as PlanItemDetail[]).sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const assignments = ([...((row.assignments as AssignmentDetail[] | undefined) ?? [])] as AssignmentDetail[]).sort(
    (a, b) =>
      (a.team?.name ?? '').localeCompare(b.team?.name ?? '') ||
      (a.position?.name ?? '').localeCompare(b.position?.name ?? '') ||
      (a.person?.full_name ?? '').localeCompare(b.person?.full_name ?? ''),
  );

  const summary = shapePlanSummary(row);
  return {
    ...summary,
    items,
    assignments,
    position_needs: shapePositionNeeds(row.position_needs),
    total_length_seconds: items.reduce((sum, item) => sum + (item.length_seconds ?? 0), 0),
  };
};

export const fetchPlanDetail = async (db: Db, orgId: string, planId: string): Promise<PlanDetail> => {
  const row = (await unwrap(
    raw(db)
      .from('plans')
      .select(PLAN_DETAIL_SELECT)
      .eq('id', planId)
      .eq('organization_id', orgId)
      .maybeSingle(),
  )) as RawPlan | null;

  if (!row) throw HttpError.notFound('Plan not found');
  return shapePlanDetail(row);
};

export interface CopyPlanContentsInput {
  db: Db;
  sourcePlanId: string;
  targetPlanId: string;
  createdBy: string;
  withAssignments: boolean;
}

export const copyPlanContents = async (input: CopyPlanContentsInput): Promise<void> => {
  const items = await unwrap(
    input.db.from('plan_items').select('*').eq('plan_id', input.sourcePlanId).order('sort_order'),
  );

  if (items?.length) {
    await unwrap(
      input.db.from('plan_items').insert(
        items.map(({ id: _id, plan_id: _planId, created_at: _createdAt, updated_at: _updatedAt, ...item }) => ({
          ...item,
          plan_id: input.targetPlanId,
        })),
      ),
    );
  }

  if (!input.withAssignments) return;

  const assignments = await unwrap(
    input.db.from('assignments').select('*').eq('plan_id', input.sourcePlanId),
  );

  if (assignments?.length) {
    await unwrap(
      input.db.from('assignments').insert(
        assignments.map((assignment: AssignmentRow) => ({
          plan_id: input.targetPlanId,
          user_id: assignment.user_id,
          team_id: assignment.team_id,
          position_id: assignment.position_id,
          status: 'unconfirmed' as const,
          created_by: input.createdBy,
        })),
      ),
    );
  }
};

export interface ReorderPlanItemsInput {
  db: Db;
  planId: string;
  itemIds: string[];
}

export const validatePlanItemOrder = (knownIds: ReadonlySet<string>, itemIds: string[]): void => {
  const unknownIds = itemIds.filter((id) => !knownIds.has(id));

  if (unknownIds.length) {
    throw HttpError.badRequest('Some items do not belong to this plan', { unknown: unknownIds });
  }
  if (itemIds.length !== knownIds.size || new Set(itemIds).size !== itemIds.length) {
    throw HttpError.badRequest('Send every item id in the plan exactly once, in the new order');
  }
};

export const reorderPlanItems = async (input: ReorderPlanItemsInput): Promise<PlanItemRow[]> => {
  const existing = await unwrap(
    input.db.from('plan_items').select('id').eq('plan_id', input.planId),
  );
  const knownIds = new Set((existing ?? []).map((item) => item.id));
  validatePlanItemOrder(knownIds, input.itemIds);

  await Promise.all(
    input.itemIds.map((id, sortOrder) =>
      unwrap(input.db.from('plan_items').update({ sort_order: sortOrder }).eq('id', id).eq('plan_id', input.planId)),
    ),
  );

  return (await unwrap(
    input.db.from('plan_items').select('*').eq('plan_id', input.planId).order('sort_order'),
  )) ?? [];
};

export interface ApplyPositionNeedsInput {
  db: Db;
  orgId: string;
  planId: string;
  needs: ReadonlyArray<{ position_id: string; needed: number }>;
}

/** Last value wins when the editor sends the same position twice. */
export const dedupePositionNeeds = (
  needs: ReadonlyArray<{ position_id: string; needed: number }>,
): Array<{ position_id: string; needed: number }> => [
  ...new Map(needs.map((need) => [need.position_id, need])).values(),
];

/**
 * Applies the "needed positions" editor. A need of 0 is the absence of a need,
 * so those rows are deleted rather than stored — the table then only ever
 * holds positions somebody actually asked for.
 */
export const setPlanPositionNeeds = async (
  input: ApplyPositionNeedsInput,
): Promise<PlanPositionNeed[]> => {
  const plan = await unwrap(
    input.db
      .from('plans')
      .select('id')
      .eq('id', input.planId)
      .eq('organization_id', input.orgId)
      .maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');

  const needs = dedupePositionNeeds(input.needs);

  if (needs.length) {
    // RLS on plan_position_needs only checks the plan's organization, so the
    // positions have to be checked against this org explicitly.
    const known = await unwrap(
      raw(input.db)
        .from('team_positions')
        .select('id, teams!inner(organization_id)')
        .in('id', needs.map((need) => need.position_id))
        .eq('teams.organization_id', input.orgId),
    );
    const knownIds = new Set(((known ?? []) as Array<{ id: string }>).map((row) => row.id));
    const unknown = needs.filter((need) => !knownIds.has(need.position_id));
    if (unknown.length) {
      throw HttpError.badRequest('Some positions do not belong to this organization', {
        unknown: unknown.map((need) => need.position_id),
      });
    }
  }

  const cleared = needs.filter((need) => need.needed === 0).map((need) => need.position_id);
  if (cleared.length) {
    await unwrap(
      input.db
        .from('plan_position_needs')
        .delete()
        .eq('plan_id', input.planId)
        .in('position_id', cleared),
    );
  }

  const wanted = needs.filter((need) => need.needed > 0);
  if (wanted.length) {
    await unwrap(
      input.db.from('plan_position_needs').upsert(
        wanted.map((need) => ({
          plan_id: input.planId,
          position_id: need.position_id,
          needed: need.needed,
        })),
        { onConflict: 'plan_id,position_id' },
      ),
    );
  }

  const rows = await unwrap(
    raw(input.db)
      .from('plan_position_needs')
      .select('needed, position:team_positions(id, team_id)')
      .eq('plan_id', input.planId),
  );
  // `raw()` is untyped, so PostgREST's to-one embed is inferred as an array.
  return shapePositionNeeds((rows ?? []) as unknown as RawPositionNeed[]);
};
