import {
  expandPlanSeries,
  planTemplateContentSchema,
  resolveTemplateTimes,
  templateCounts,
  type AmbiguousTimeChoice,
  type GenerationDateProblem,
  type GenerationExcludedDate,
  type PlanSeriesInput,
  type PlanTemplateContent,
  type PlanTemplateRevisionInfo,
  type PlanTemplateRow,
  type PlanTemplateSummary,
  type ResolvedTemplateTime,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';

/** A template row as listed, with its service type and revision ids embedded. */
export interface PlanTemplateListRow extends PlanTemplateRow {
  service_type: { id: string; name: string } | null;
  revisions: Array<PlanTemplateRevisionInfo & { content: unknown }>;
}

/**
 * Revision content comes from the database, which normalized it when saved;
 * it is still parsed here so a malformed row fails loudly at the boundary.
 */
export const toTemplateContent = (raw: unknown): PlanTemplateContent => {
  const parsed = planTemplateContentSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(500, 'A saved template could not be read', 'template_unreadable');
  const content = parsed.data;
  return {
    version: 1,
    notes: content.notes,
    times: content.times.map((time) => ({ ...time, name: time.name })),
    items: content.items.map((item) => ({ ...item, title: item.title ?? '' })),
    needs: content.needs,
    roster: content.roster,
  };
};

export const toTemplateSummary = (row: PlanTemplateListRow): PlanTemplateSummary => {
  const current = row.revisions.find((revision) => revision.revision === row.current_revision) ?? null;
  const { revisions: _revisions, ...template } = row;
  return {
    ...template,
    current_revision_id: current?.id ?? null,
    counts: templateCounts(current ? toTemplateContent(current.content) : null),
  };
};

/** One proposed plan, exactly as the database will verify and create it. */
export interface GenerationPlanInput {
  local_date: string;
  title: string;
  service_date: string;
  times: ResolvedTemplateTime[];
}

export interface GenerationPlanBuild {
  plans: GenerationPlanInput[];
  excluded: GenerationExcludedDate[];
  problems: GenerationDateProblem[];
}

export interface BuildGenerationPlansInput {
  content: PlanTemplateContent;
  series: PlanSeriesInput;
  defaultTitle: string;
  timeZone: string;
  ambiguous: AmbiguousTimeChoice;
}

/**
 * Expands the local-date series and resolves the template's wall-clock times
 * on each date. Dates with a problem (a skipped DST time, two plans on one
 * day) are reported and left out of `plans`, so nothing is created until the
 * scheduler edits or skips them.
 */
export const buildGenerationPlans = ({
  content,
  series,
  defaultTitle,
  timeZone,
  ambiguous,
}: BuildGenerationPlansInput): GenerationPlanBuild => {
  const expansion = expandPlanSeries({
    start_date: series.start_date,
    interval_weeks: series.interval_weeks,
    count: series.count,
    end_date: series.end_date,
    excluded_dates: series.excluded_dates,
    edits: series.edits,
    default_title: series.title ?? defaultTitle,
  });
  const problems = [...expansion.problems];
  const conflicted = new Set(problems.map((problem) => problem.local_date));
  const plans: GenerationPlanInput[] = [];
  for (const date of expansion.dates) {
    if (conflicted.has(date.local_date)) continue;
    const resolution = resolveTemplateTimes(content.times, date.local_date, timeZone, ambiguous);
    if (!resolution.ok) {
      problems.push({ local_date: date.local_date, message: resolution.message, problem: resolution.problem });
      continue;
    }
    plans.push({
      local_date: date.local_date,
      title: date.title,
      service_date: resolution.service_date,
      times: resolution.times,
    });
  }
  return { plans, excluded: expansion.excluded, problems };
};
