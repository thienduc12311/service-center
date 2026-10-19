import {
  stageLayoutIssues,
  type CreatePlanStageLayoutInput,
  type CreateStageTemplateInput,
  type PlanStageLayoutRow,
  type PlanStageLayouts,
  type PlanStageLayoutView,
  type StageLayoutTemplateList,
  type StageLayoutTemplateRow,
  type StageRosterPerson,
  type UpdatePlanStageLayoutInput,
  type UpdateStageTemplateInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { unwrap } from '../lib/supabase.js';
import { stageRosterFromPlan } from '../model/stage-layout.model.js';
import type { FileCaller } from './files.js';
import { fetchPlanDetail } from './plans.js';

/**
 * F14 Pass B: stage layout templates (organization) and plan snapshots.
 * RLS decides who reads (templates: members; plan layouts: the plan's
 * editors and leaders) and writes; revisions are compared in the UPDATE.
 */

const stale = (): HttpError =>
  new HttpError(409, 'This layout changed since you opened it. Reload and try again.', 'layout_revision_stale');

export const listStageTemplates = async (caller: FileCaller, canManage: boolean): Promise<StageLayoutTemplateList> => {
  const rows = await unwrap(
    caller.db.from('stage_layout_templates').select('*').eq('organization_id', caller.orgId).order('name'),
  );
  return { templates: (rows ?? []) as StageLayoutTemplateRow[], can_manage: canManage };
};

const readTemplate = async ({ db, orgId }: FileCaller, templateId: string): Promise<StageLayoutTemplateRow> => {
  const row = await unwrap(
    db.from('stage_layout_templates').select('*').eq('id', templateId).eq('organization_id', orgId).maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Template not found');
  return row as StageLayoutTemplateRow;
};

export const createStageTemplate = async (caller: FileCaller, input: CreateStageTemplateInput): Promise<StageLayoutTemplateRow> =>
  (await unwrap(
    caller.db
      .from('stage_layout_templates')
      .insert({ organization_id: caller.orgId, name: input.name, background: input.background, objects: input.objects })
      .select('*')
      .single(),
  )) as StageLayoutTemplateRow;

export const updateStageTemplate = async (
  caller: FileCaller,
  templateId: string,
  input: UpdateStageTemplateInput,
): Promise<StageLayoutTemplateRow> => {
  await readTemplate(caller, templateId);
  const patch: Partial<StageLayoutTemplateRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.background !== undefined) patch.background = input.background;
  if (input.objects !== undefined) patch.objects = input.objects;
  if (input.archived !== undefined) patch.archived_at = input.archived ? new Date().toISOString() : null;
  const rows = await unwrap(
    caller.db
      .from('stage_layout_templates')
      .update(patch)
      .eq('id', templateId)
      .eq('revision', input.expected_revision)
      .select('*'),
  );
  if (!rows?.length) throw stale();
  return rows[0] as StageLayoutTemplateRow;
};

/** Plan layouts keep their own copy, so deleting a template changes no plan. */
export const deleteStageTemplate = async (caller: FileCaller, templateId: string, expectedRevision: number): Promise<void> => {
  await readTemplate(caller, templateId);
  const rows = await unwrap(
    caller.db.from('stage_layout_templates').delete().eq('id', templateId).eq('revision', expectedRevision).select('id'),
  );
  if (!rows?.length) throw stale();
};

// ------------------------------------------------------------ plan layouts --

interface PlanContext {
  roster: StageRosterPerson[];
  archived: Set<string>;
  canEdit: boolean;
}

/** The plan's current staffing (as this caller may see it) and archived placed people. */
const planContext = async (caller: FileCaller, planId: string, layouts: readonly PlanStageLayoutRow[]): Promise<PlanContext> => {
  const [plan, canEdit] = await Promise.all([
    fetchPlanDetail(caller.db, caller.orgId, planId),
    caller.db.rpc('can_edit_plan', { p_plan: planId }),
  ]);
  if (canEdit.error) throw fromPostgrestError(canEdit.error);
  const roster = stageRosterFromPlan(plan.assignments);
  const placedIds = [
    ...new Set(layouts.flatMap((layout) => layout.objects.flatMap((object) => (object.person_id ? [object.person_id] : [])))),
  ];
  const placed = placedIds.length
    ? ((await unwrap(caller.db.from('people_directory').select('id, archived_at').in('id', placedIds))) ?? [])
    : [];
  const archived = new Set(placed.filter((person) => person.archived_at).map((person) => person.id));
  return {
    roster: roster.map((person) => ({ ...person, archived: person.archived || archived.has(person.person_id) })),
    archived,
    canEdit: canEdit.data === true,
  };
};

const view = (layout: PlanStageLayoutRow, context: PlanContext): PlanStageLayoutView => ({
  layout,
  roster: context.roster,
  issues: stageLayoutIssues(layout.objects, context.roster, context.archived),
});

const readLayout = async ({ db, orgId }: FileCaller, planId: string, layoutId: string): Promise<PlanStageLayoutRow> => {
  const row = await unwrap(
    db
      .from('plan_stage_layouts')
      .select('*')
      .eq('id', layoutId)
      .eq('plan_id', planId)
      .eq('organization_id', orgId)
      .maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Layout not found');
  return row as PlanStageLayoutRow;
};

export const listPlanStageLayouts = async (caller: FileCaller, planId: string): Promise<PlanStageLayouts> => {
  const plan = await unwrap(caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');
  const layouts = ((await unwrap(
    caller.db.from('plan_stage_layouts').select('*').eq('plan_id', planId).order('created_at'),
  )) ?? []) as PlanStageLayoutRow[];
  const context = await planContext(caller, planId, layouts);
  // Someone who can neither edit nor read layouts gets nothing from here.
  const roster = context.canEdit || layouts.length ? context.roster : [];
  return {
    plan_id: planId,
    layouts: layouts.map((layout) => view(layout, { ...context, roster })),
    roster,
    can_edit: context.canEdit,
  };
};

export const createPlanStageLayout = async (
  caller: FileCaller,
  planId: string,
  input: CreatePlanStageLayoutInput,
): Promise<PlanStageLayoutView> => {
  const plan = await unwrap(caller.db.from('plans').select('id').eq('id', planId).eq('organization_id', caller.orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');
  await assertCanEditPlan(caller, planId);
  const template = input.template_id ? await readTemplate(caller, input.template_id) : null;
  const row = (await unwrap(
    caller.db
      .from('plan_stage_layouts')
      .insert({
        organization_id: caller.orgId,
        plan_id: planId,
        template_id: template?.id ?? null,
        name: input.name,
        background: input.background ?? template?.background ?? 'stage',
        objects: input.objects ?? template?.objects ?? [],
      })
      .select('*')
      .single(),
  )) as PlanStageLayoutRow;
  return view(row, await planContext(caller, planId, [row]));
};

/** Leaders read layouts; only the plan's editors change them. */
const assertCanEditPlan = async ({ db }: FileCaller, planId: string): Promise<void> => {
  const { data, error } = await db.rpc('can_edit_plan', { p_plan: planId });
  if (error) throw fromPostgrestError(error);
  if (data !== true) throw HttpError.forbidden('Only people who edit this plan can change its stage layouts');
};

export const updatePlanStageLayout = async (
  caller: FileCaller,
  planId: string,
  layoutId: string,
  input: UpdatePlanStageLayoutInput,
): Promise<PlanStageLayoutView> => {
  await readLayout(caller, planId, layoutId);
  await assertCanEditPlan(caller, planId);
  const patch: Partial<PlanStageLayoutRow> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.background !== undefined) patch.background = input.background;
  if (input.objects !== undefined) patch.objects = input.objects;
  if (input.refreshed) patch.refreshed_at = new Date().toISOString();
  const rows = await unwrap(
    caller.db
      .from('plan_stage_layouts')
      .update(patch)
      .eq('id', layoutId)
      .eq('plan_id', planId)
      .eq('revision', input.expected_revision)
      .select('*'),
  );
  if (!rows?.length) throw stale();
  const row = rows[0] as PlanStageLayoutRow;
  return view(row, await planContext(caller, planId, [row]));
};

export const deletePlanStageLayout = async (
  caller: FileCaller,
  planId: string,
  layoutId: string,
  expectedRevision: number,
): Promise<void> => {
  await readLayout(caller, planId, layoutId);
  await assertCanEditPlan(caller, planId);
  const rows = await unwrap(
    caller.db
      .from('plan_stage_layouts')
      .delete()
      .eq('id', layoutId)
      .eq('plan_id', planId)
      .eq('revision', expectedRevision)
      .select('id'),
  );
  if (!rows?.length) throw stale();
};
