import type {
  AssignmentDetail,
  CreatePlanInput,
  DuplicatePlanInput,
  ImportPlanContentsInput,
  PlanDetail,
  PlanItemDetail,
  PlanItemRow,
  PlanPositionNeed,
  PlanSummary,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';

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
    song:songs(id, title, author, copyright, default_key, default_bpm),
    arrangement:arrangements(
      id, name, song_key, bpm, sequence, chord_chart,
      chart_columns, chart_font, chart_font_size, chart_chord_color
    )
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

/** The plan id a create/copy function returned. */
const requireId = async (query: PromiseLike<{ data: string | null; error: { code?: string; message: string; details?: string | null } | null }>): Promise<string> => {
  const id = await unwrap(query);
  if (!id) throw HttpError.notFound('Plan not found');
  return id;
};

export interface CreatePlanAtomicallyInput {
  db: Db;
  orgId: string;
  input: CreatePlanInput;
}

/** Plan, times and optional copy in one transaction (`create_plan`). */
export const createPlanAtomically = async ({ db, orgId, input }: CreatePlanAtomicallyInput): Promise<string> => {
  const { times, copy_from_plan_id, copy_assignments, idempotency_key, ...plan } = input;
  return requireId(
    db.rpc('create_plan', {
      p_organization_id: orgId,
      p_plan: plan,
      p_times: times.map((time) => ({ kind: time.kind, name: time.name ?? null, starts_at: time.starts_at, ends_at: time.ends_at })),
      p_copy_from: copy_from_plan_id ?? null,
      p_copy_assignments: copy_assignments,
      p_idempotency_key: idempotency_key ?? null,
    }),
  );
};

export interface DuplicatePlanAtomicallyInput {
  db: Db;
  sourcePlanId: string;
  input: DuplicatePlanInput;
}

/** New draft plan from an existing one in one transaction (`duplicate_plan`). */
export const duplicatePlanAtomically = async ({ db, sourcePlanId, input }: DuplicatePlanAtomicallyInput): Promise<string> =>
  requireId(
    db.rpc('duplicate_plan', {
      p_source_plan_id: sourcePlanId,
      p_service_date: input.service_date,
      p_title: input.title ?? null,
      p_copy_assignments: input.copy_assignments,
      p_idempotency_key: input.idempotency_key ?? null,
    }),
  );

export const STALE_PLAN_CODE = 'plan_revision_stale';

export interface ImportPlanContentsServiceInput {
  db: Db;
  orgId: string;
  targetPlanId: string;
  input: ImportPlanContentsInput;
}

/**
 * Another plan's order/needs/team into this plan in one transaction
 * (`import_plan_contents`). Returns the plan's new content revision; a stale
 * `expected_revision` is a 409 the client resolves by re-reading the plan.
 */
export const importPlanContents = async ({
  db,
  orgId,
  targetPlanId,
  input,
}: ImportPlanContentsServiceInput): Promise<number> => {
  const target = await unwrap(
    db.from('plans').select('id').eq('id', targetPlanId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!target) throw HttpError.notFound('Plan not found');

  const { data, error } = await db.rpc('import_plan_contents', {
    p_target_plan_id: targetPlanId,
    p_source_plan_id: input.source_plan_id,
    p_items: input.items,
    p_needs: input.position_needs,
    p_assignments: input.assignments,
    p_expected_revision: input.expected_revision ?? null,
    p_idempotency_key: input.idempotency_key ?? null,
  });
  if (error?.code === 'PT409') {
    throw new HttpError(409, 'This plan changed since you opened it. Review it and import again.', STALE_PLAN_CODE);
  }
  if (error) throw fromPostgrestError(error);
  return data;
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
