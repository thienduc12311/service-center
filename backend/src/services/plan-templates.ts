import {
  MAX_GENERATED_PLANS,
  localDateAt,
  resolveTemplateTimes,
  shiftPlanToDate,
  type RescheduleCommitInput,
  type RescheduleMode,
  type ReschedulePreview,
  type ReschedulePreviewInput,
  type RescheduleResult,
  type ShiftedPlan,
  type ApplyTemplateInput,
  type CreatePlanTemplateInput,
  type GenerationPlanPreview,
  type GeneratePlansInput,
  type ListPlanTemplatesQuery,
  type PlanGenerationPreview,
  type PlanGenerationResult,
  type PlanSeriesInput,
  type PlanSummary,
  type PlanTemplateApplicationRow,
  type PlanTemplateContent,
  type PlanTemplateDetail,
  type PreviewTemplateApplyInput,
  type TemplateApplyPreviewResult,
  type TemplateApplyResult,
  type UpdatePlanTemplateInput,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import {
  buildGenerationPlans,
  toTemplateContent,
  toTemplateSummary,
  type GenerationPlanBuild,
  type GenerationPlanInput,
  type PlanTemplateListRow,
} from '../model/plan-template.model.js';
import { PLAN_SUMMARY_SELECT, fetchPlanDetail, shapePlanSummary } from './plans.js';
import { deliverEffectNow } from './delivery-worker.js';

export interface PlanTemplateContext {
  db: Db;
  orgId: string;
}

const TEMPLATE_SELECT = `
  *,
  service_type:service_types(id, name),
  revisions:plan_template_revisions(id, revision, source_plan_id, created_by, created_at, content)
`;

/** A database function that returns a value always returns one; null means it was not found. */
const required = <T>(value: T | null, message: string): T => {
  if (value === null) throw HttpError.notFound(message);
  return value;
};

const organizationTimeZone = async ({ db, orgId }: PlanTemplateContext): Promise<string> => {
  const org = await unwrap(db.from('organizations').select('timezone').eq('id', orgId).maybeSingle());
  if (!org) throw HttpError.notFound('Organization not found');
  return org.timezone;
};

/** Templates the caller may use (RLS: plans.edit at the template's scope). */
export const listPlanTemplates = async (
  ctx: PlanTemplateContext,
  query: ListPlanTemplatesQuery,
) => {
  let request = raw(ctx.db)
    .from('plan_templates')
    .select(TEMPLATE_SELECT)
    .eq('organization_id', ctx.orgId)
    .order('kind')
    .order('name');
  if (query.kind) request = request.eq('kind', query.kind);
  // A service type's own templates plus the organization-wide ones.
  if (query.service_type_id) request = request.or(`service_type_id.eq.${query.service_type_id},service_type_id.is.null`);
  if (!query.include_archived) request = request.is('archived_at', null);
  const rows = ((await unwrap(request)) ?? []) as unknown as PlanTemplateListRow[];
  return rows.map(toTemplateSummary);
};

export const getPlanTemplate = async (
  ctx: PlanTemplateContext,
  templateId: string,
  revision?: number,
): Promise<PlanTemplateDetail> => {
  const row = (await unwrap(
    raw(ctx.db)
      .from('plan_templates')
      .select(TEMPLATE_SELECT)
      .eq('id', templateId)
      .eq('organization_id', ctx.orgId)
      .maybeSingle(),
  )) as unknown as PlanTemplateListRow | null;
  if (!row) throw HttpError.notFound('Template not found');
  const wanted = revision ?? row.current_revision;
  const chosen = row.revisions.find((candidate) => candidate.revision === wanted);
  if (!chosen) throw HttpError.notFound('Template revision not found');
  return {
    ...toTemplateSummary(row),
    current_revision_id: chosen.id,
    content: toTemplateContent(chosen.content),
    revisions: row.revisions
      .map(({ content: _content, ...info }) => info)
      .sort((a, b) => b.revision - a.revision),
  };
};

export const createPlanTemplate = async (
  ctx: PlanTemplateContext,
  input: CreatePlanTemplateInput,
): Promise<PlanTemplateDetail> => {
  const saved = required(await unwrap(
    ctx.db.rpc('save_plan_template', {
      p_organization_id: ctx.orgId,
      p_kind: input.kind,
      p_service_type_id: input.service_type_id,
      p_name: input.name,
      p_description: input.description,
      p_content: input.content ?? null,
      p_source_plan_id: input.source?.plan_id ?? null,
      p_source_components: input.source?.components ?? null,
    }),
  ), 'Template not found');
  return getPlanTemplate(ctx, saved.template_id);
};

export const updatePlanTemplate = async (
  ctx: PlanTemplateContext,
  templateId: string,
  input: UpdatePlanTemplateInput,
): Promise<PlanTemplateDetail> => {
  await unwrap(
    ctx.db.rpc('save_plan_template', {
      p_organization_id: ctx.orgId,
      p_template_id: templateId,
      p_expected_revision: input.expected_revision,
      p_name: input.name ?? null,
      // Null keeps the description; an empty string clears it.
      p_description: input.description === undefined ? null : input.description ?? '',
      p_content: input.content ?? null,
      p_source_plan_id: input.source?.plan_id ?? null,
      p_source_components: input.source?.components ?? null,
    }),
  );
  return getPlanTemplate(ctx, templateId);
};

export const archivePlanTemplate = async (
  ctx: PlanTemplateContext,
  templateId: string,
  archived: boolean,
): Promise<PlanTemplateDetail> => {
  await unwrap(ctx.db.rpc('set_plan_template_archived', { p_template_id: templateId, p_archived: archived }));
  return getPlanTemplate(ctx, templateId);
};

interface RevisionLookup {
  templateId: string;
  templateName: string;
  content: PlanTemplateContent;
}

const loadRevision = async (ctx: PlanTemplateContext, revisionId: string): Promise<RevisionLookup> => {
  const row = await unwrap(
    raw(ctx.db)
      .from('plan_template_revisions')
      .select('template_id, content, template:plan_templates(name)')
      .eq('id', revisionId)
      .eq('organization_id', ctx.orgId)
      .maybeSingle(),
  ) as { template_id: string; content: unknown; template: { name: string } | null } | null;
  if (!row) throw HttpError.notFound('Template not found');
  return { templateId: row.template_id, templateName: row.template?.name ?? '', content: toTemplateContent(row.content) };
};

interface ApplyContext {
  planId: string;
  times: Array<{ starts_at: string; ends_at: string }>;
}

/**
 * Resolves the template's wall-clock times on the destination's local
 * service date; the database re-checks each instant against that intent.
 */
const resolveApplyTimes = async (
  ctx: PlanTemplateContext,
  planId: string,
  input: PreviewTemplateApplyInput,
): Promise<ApplyContext> => {
  const plan = await unwrap(
    ctx.db.from('plans').select('id, service_date').eq('id', planId).eq('organization_id', ctx.orgId).maybeSingle(),
  );
  if (!plan) throw HttpError.notFound('Plan not found');
  if (!input.components.includes('times')) return { planId, times: [] };
  const { content } = await loadRevision(ctx, input.revision_id);
  const timeZone = await organizationTimeZone(ctx);
  const localDate = localDateAt(plan.service_date, timeZone);
  const resolution = resolveTemplateTimes(content.times, localDate, timeZone, input.ambiguous_time);
  if (!resolution.ok) throw new HttpError(400, resolution.message, 'template_time_unresolvable');
  return { planId, times: resolution.times };
};

export const previewApplyTemplate = async (
  ctx: PlanTemplateContext,
  planId: string,
  input: PreviewTemplateApplyInput,
): Promise<TemplateApplyPreviewResult> => {
  const resolved = await resolveApplyTimes(ctx, planId, input);
  return required(await unwrap(
    ctx.db.rpc('preview_plan_template_apply', {
      p_plan_id: planId,
      p_revision_id: input.revision_id,
      p_mode: input.mode,
      p_components: input.components,
      p_times: resolved.times,
      p_insert_at: input.insert_at,
    }),
  ), 'Plan not found');
};

export const applyTemplate = async (
  ctx: PlanTemplateContext,
  planId: string,
  input: ApplyTemplateInput,
): Promise<TemplateApplyResult> => {
  const resolved = await resolveApplyTimes(ctx, planId, input);
  const commit = required(await unwrap(
    ctx.db.rpc('apply_plan_template', {
      p_plan_id: planId,
      p_revision_id: input.revision_id,
      p_mode: input.mode,
      p_components: input.components,
      p_preview_hash: input.preview_hash,
      p_times: resolved.times,
      p_insert_at: input.insert_at,
      p_expected_revision: input.expected_revision,
      p_idempotency_key: input.idempotency_key ?? null,
      p_conflict_override_reason: input.conflict_override_reason ?? null,
    }),
  ), 'Plan not found');
  return { ...commit, plan: await fetchPlanDetail(ctx.db, ctx.orgId, planId) };
};

/** Where this plan's content came from (newest first). */
export const listTemplateApplications = async (
  ctx: PlanTemplateContext,
  planId: string,
): Promise<PlanTemplateApplicationRow[]> =>
  (await unwrap(
    ctx.db
      .from('plan_template_applications')
      .select('*')
      .eq('plan_id', planId)
      .eq('organization_id', ctx.orgId)
      .order('created_at', { ascending: false }),
  )) ?? [];

// ------------------------------------------------------------ generation --

interface GenerationDraft {
  build: GenerationPlanBuild;
  components: PlanSeriesInput['components'];
}

const draftGeneration = async (ctx: PlanTemplateContext, series: PlanSeriesInput): Promise<GenerationDraft> => {
  const revision = await loadRevision(ctx, series.revision_id);
  const timeZone = await organizationTimeZone(ctx);
  return {
    build: buildGenerationPlans({
      content: revision.content,
      series,
      defaultTitle: revision.templateName,
      timeZone,
      ambiguous: series.ambiguous_time,
    }),
    components: series.components,
  };
};

const toRpcPlans = (plans: readonly GenerationPlanInput[]) =>
  plans.map((plan) => ({
    local_date: plan.local_date,
    title: plan.title,
    service_date: plan.service_date,
    times: plan.times,
  }));

interface SqlGenerationPreview {
  template_id: string;
  service_type_id: string | null;
  revision_id: string;
  timezone: string;
  plans: GenerationPlanPreview[];
  preview_hash: string;
}

/**
 * Proposed plans for review; nothing is created. With unresolved dates the
 * preview still shows the rest, but carries no hash, so it cannot be created.
 */
export const previewPlanGeneration = async (
  ctx: PlanTemplateContext,
  series: PlanSeriesInput,
): Promise<PlanGenerationPreview> => {
  const { build, components } = await draftGeneration(ctx, series);
  const base = { excluded: build.excluded, problems: build.problems, max_plans: MAX_GENERATED_PLANS };
  if (build.plans.length === 0) {
    const revision = await loadRevision(ctx, series.revision_id);
    return {
      template_id: revision.templateId,
      service_type_id: null,
      revision_id: series.revision_id,
      timezone: await organizationTimeZone(ctx),
      plans: [],
      preview_hash: null,
      ...base,
    };
  }
  const preview = (await unwrap(
    ctx.db.rpc('preview_plan_generation', {
      p_organization_id: ctx.orgId,
      p_revision_id: series.revision_id,
      p_components: components,
      p_plans: toRpcPlans(build.plans),
    }),
  )) as SqlGenerationPreview;
  return {
    ...preview,
    ...base,
    preview_hash: build.problems.length ? null : preview.preview_hash,
  };
};

/** One transaction for the whole bounded batch; a retried key returns the same plans. */
export const generatePlans = async (
  ctx: PlanTemplateContext,
  input: GeneratePlansInput,
): Promise<PlanGenerationResult> => {
  const { build, components } = await draftGeneration(ctx, input);
  if (build.problems.length) {
    throw HttpError.badRequest('Some dates need attention before plans can be created', build.problems);
  }
  const commit = required(await unwrap(
    ctx.db.rpc('generate_plans_from_template', {
      p_organization_id: ctx.orgId,
      p_revision_id: input.revision_id,
      p_components: components,
      p_plans: toRpcPlans(build.plans),
      p_preview_hash: input.preview_hash,
      p_idempotency_key: input.idempotency_key,
      p_series: {
        start_date: input.start_date,
        interval_weeks: input.interval_weeks,
        count: input.count,
        end_date: input.end_date ?? null,
        excluded_dates: input.excluded_dates,
        edits: input.edits,
        ambiguous_time: input.ambiguous_time,
      },
      p_conflict_override_reason: input.conflict_override_reason ?? null,
    }),
  ), 'Template not found');
  const rows = commit.plan_ids.length
    ? ((await unwrap(
        raw(ctx.db).from('plans').select(PLAN_SUMMARY_SELECT).in('id', commit.plan_ids).order('service_date'),
      )) ?? [])
    : [];
  const plans: PlanSummary[] = (rows as Array<Record<string, unknown>>).map((row) => shapePlanSummary(row));
  return { ...commit, plans };
};

// ------------------------------------------------- F10 Pass C: reschedule --

interface RescheduleRpcArgs {
  p_mode: RescheduleMode;
  p_moves: Array<{ plan_id: string; new_local_date: string; service_date: string; times: ShiftedPlan['times'] }> | null;
  p_order: { source_plan_id: string; destination_plan_id: string; items_mode: string; remove_from_source: boolean } | null;
  p_reset_responses: boolean;
  p_notify: boolean;
}

interface ShiftSourcePlan {
  id: string;
  service_date: string;
  times: Array<{ id: string; starts_at: string; ends_at: string }>;
}

/**
 * Resolves each move's new instants (same local clock on the new local
 * date) for the database to verify; an unresolvable DST time is a 400.
 */
const rescheduleArgs = async (ctx: PlanTemplateContext, input: ReschedulePreviewInput): Promise<RescheduleRpcArgs> => {
  if (input.mode === 'order_only') {
    return {
      p_mode: 'order_only',
      p_moves: null,
      p_order: {
        source_plan_id: input.source_plan_id,
        destination_plan_id: input.destination_plan_id,
        items_mode: input.items_mode,
        remove_from_source: input.remove_from_source,
      },
      p_reset_responses: false,
      p_notify: false,
    };
  }
  const timeZone = await organizationTimeZone(ctx);
  const rows = ((await unwrap(
    raw(ctx.db)
      .from('plans')
      .select('id, service_date, times:plan_times(id, starts_at, ends_at)')
      .eq('organization_id', ctx.orgId)
      .in('id', input.moves.map((move) => move.plan_id)),
  )) ?? []) as unknown as ShiftSourcePlan[];
  const plans = new Map(rows.map((row) => [row.id, row]));
  const moves = input.moves.map((move) => {
    const plan = plans.get(move.plan_id);
    if (!plan) throw HttpError.notFound('Plan not found');
    const shifted = shiftPlanToDate(plan, move.new_date, timeZone, input.ambiguous_time);
    if (!shifted.ok) throw new HttpError(400, shifted.message, 'reschedule_time_unresolvable');
    return { plan_id: plan.id, new_local_date: move.new_date, ...shifted.plan };
  });
  return {
    p_mode: 'shift',
    p_moves: moves,
    p_order: null,
    p_reset_responses: input.reset_responses,
    p_notify: input.notify,
  };
};

/** What the move would change, plan by plan. Writes nothing. */
export const previewReschedule = async (
  ctx: PlanTemplateContext,
  input: ReschedulePreviewInput,
): Promise<ReschedulePreview> =>
  required(
    await unwrap(ctx.db.rpc('preview_plan_reschedule', { p_organization_id: ctx.orgId, ...(await rescheduleArgs(ctx, input)) })),
    'Plan not found',
  );

/**
 * One transaction for the whole move; requests re-sent by F04's time-change
 * path are delivered right after commit, as a plan time edit does.
 */
export const reschedulePlans = async (
  ctx: PlanTemplateContext,
  input: RescheduleCommitInput,
): Promise<RescheduleResult> => {
  const result = required(
    await unwrap(
      ctx.db.rpc('reschedule_plans', {
        p_organization_id: ctx.orgId,
        ...(await rescheduleArgs(ctx, input)),
        p_preview_hash: input.preview_hash,
        p_idempotency_key: input.idempotency_key,
        p_conflict_override_reason: input.conflict_override_reason ?? null,
      }),
    ),
    'Plan not found',
  );
  if (!result.replayed) {
    for (const effectId of result.effect_ids) await deliverEffectNow(effectId);
  }
  return result;
};
