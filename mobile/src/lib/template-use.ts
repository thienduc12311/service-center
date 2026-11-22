import {
  ApiError,
  MAX_GENERATED_PLANS,
  PLAN_TEMPLATE_COMPONENTS,
  type AmbiguousTimeChoice,
  type AttendanceConflict,
  type GenerationDateEdit,
  type PlanGenerationPreview,
  type PlanSeriesEnd,
  type PlanSeriesRecurrence,
  type PlanSeriesRequest,
  type PlanTemplateComponent,
  type PlanTemplateSummary,
  type PreviewTemplateApplyRequest,
  type TemplateApplyMode,
} from '@service-center/shared';
import type { SearchableOption } from './option-groups';

/**
 * MOB-013 Pass B: native use of F10 templates on the website's contracts —
 * `previewApplyTemplate`/`applyTemplate` on one plan and
 * `previewPlanGeneration`/`generatePlans` for a bounded series. These helpers
 * hold the request/stale rules both screens share; the server recomputes the
 * preview and refuses a changed one.
 */

/** 409 codes after which a reviewed preview no longer describes the plan or template. */
export const STALE_TEMPLATE_CODES: ReadonlySet<string> = new Set(['plan_revision_stale', 'template_preview_changed']);

export const isStaleTemplateError = (error: unknown): boolean =>
  error instanceof ApiError && error.code !== undefined && STALE_TEMPLATE_CODES.has(error.code);

/** Conflicts the server refused the roster over (F04), or none for any other error. */
export const conflictsFromError = (error: unknown): AttendanceConflict[] =>
  error instanceof ApiError && error.code === 'scheduling_conflict' && Array.isArray(error.details)
    ? (error.details as AttendanceConflict[])
    : [];

/** Templates that have content to use (a current revision). */
export const usableTemplates = (templates: readonly PlanTemplateSummary[]): PlanTemplateSummary[] =>
  templates.filter((template) => template.current_revision_id);

/** The parts this template's current revision actually holds. */
export const availableComponents = (template: PlanTemplateSummary | undefined): PlanTemplateComponent[] =>
  template
    ? PLAN_TEMPLATE_COMPONENTS.filter((component) =>
      component === 'notes' ? template.counts.has_notes : template.counts[component] > 0)
    : [];

/** The website's starting choice for applying to a plan. */
export const DEFAULT_APPLY_COMPONENTS: readonly PlanTemplateComponent[] = ['items', 'needs', 'notes', 'roster'];
/** The website's starting choice for generating plans (times are always created). */
export const DEFAULT_GENERATE_COMPONENTS: readonly PlanTemplateComponent[] = ['items', 'needs', 'notes'];

export interface ApplyChoice {
  template: PlanTemplateSummary;
  mode: TemplateApplyMode;
  chosen: readonly PlanTemplateComponent[];
  /** Items only, append only; null puts them at the end. */
  insertAt: number | null;
}

/**
 * Same request the website's Apply template dialog sends: a section only
 * appends its items; a plan template sends the chosen parts it holds.
 */
export const applyTemplateRequest = ({ template, mode, chosen, insertAt }: ApplyChoice): PreviewTemplateApplyRequest => {
  const isSection = template.kind === 'section';
  const available = availableComponents(template);
  const components = (isSection ? ['items' as const] : chosen).filter((component) => available.includes(component));
  return {
    revision_id: template.current_revision_id ?? '',
    mode: isSection ? 'append' : mode,
    components,
    insert_at: isSection || mode === 'append' ? insertAt : null,
  };
};

/** The insert position only applies when items are appended. */
export const showsInsertPosition = (choice: Pick<ApplyChoice, 'template' | 'mode' | 'chosen'>, planItemCount: number): boolean =>
  planItemCount > 0
  && (choice.template.kind === 'section' || (choice.mode === 'append' && choice.chosen.includes('items')));

export interface SeriesForm {
  template: PlanTemplateSummary;
  components: readonly PlanTemplateComponent[];
  startDate: string;
  recurrence: PlanSeriesRecurrence;
  /** After a number of plans, or on a last date (inclusive). */
  end: PlanSeriesEnd;
  excludedDates: readonly string[];
  edits: readonly GenerationDateEdit[];
  ambiguous: AmbiguousTimeChoice;
}

/**
 * Same series request as the website's Create from template page. "Until a
 * date" asks for every date up to it (the cap applies; the server reports a
 * longer series as a problem).
 */
export const seriesRequest = (form: SeriesForm): PlanSeriesRequest => ({
  revision_id: form.template.current_revision_id ?? '',
  components: form.components.filter((component) => component !== 'times'),
  start_date: form.startDate,
  recurrence: form.recurrence,
  ...(form.recurrence.frequency === 'weekly' ? { interval_weeks: form.recurrence.interval_weeks } : {}),
  count: form.end.kind === 'count' ? form.end.count : MAX_GENERATED_PLANS,
  ...(form.end.kind === 'until' ? { end_date: form.end.until_date } : {}),
  excluded_dates: [...form.excludedDates],
  edits: [...form.edits],
  ambiguous_time: form.ambiguous,
});

/** One edit per series date; a newer edit of the same date replaces the older one. */
export const upsertGenerationEdit = (
  edits: readonly GenerationDateEdit[],
  edit: GenerationDateEdit,
): GenerationDateEdit[] => [...edits.filter((existing) => existing.local_date !== edit.local_date), edit];

/** The series date a proposed plan came from (it differs once the plan was moved). */
export const seriesDateOf = (edits: readonly GenerationDateEdit[], localDate: string): GenerationDateEdit | undefined =>
  edits.find((edit) => edit.move_to === localDate || edit.local_date === localDate);

/** Whether the reviewed batch can be created as it stands. */
export const canCreateGenerated = (preview: PlanGenerationPreview): boolean =>
  Boolean(preview.preview_hash)
  && preview.plans.length > 0
  && preview.plans.every((plan) => plan.preview.blocking.length === 0);

export const clampPlanCount = (value: number, max: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(1, Math.trunc(value))) : 1;

/** The group of templates that apply to every service type. */
export const ALL_SERVICE_TYPES_GROUP = 'all-service-types';

/** How a template is named in a picker, in the displayed language. */
export interface TemplateOptionWords {
  /** The full label (chips, and search). */
  label: (template: PlanTemplateSummary) => string;
  /** The label inside its service type's group. */
  groupedLabel: (template: PlanTemplateSummary) => string;
  /** The group title for templates with no service type. */
  allServiceTypes: string;
}

/** Templates as picker options, grouped by service type (templates for every type in their own group). */
export const templateOptions = (
  templates: readonly PlanTemplateSummary[],
  words: TemplateOptionWords,
): SearchableOption[] =>
  templates.map((template) => ({
    value: template.id,
    label: words.label(template),
    groupedLabel: words.groupedLabel(template),
    groupKey: template.service_type?.id ?? ALL_SERVICE_TYPES_GROUP,
    groupLabel: template.service_type?.name ?? words.allServiceTypes,
  }));
