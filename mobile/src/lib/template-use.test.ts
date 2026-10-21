import { describe, expect, it } from 'vitest';
import {
  ApiError,
  planSeriesSchema,
  previewTemplateApplySchema,
  type GenerationPlanPreview,
  type PlanGenerationPreview,
  type PlanTemplateSummary,
  type TemplateApplyPreview,
} from '@service-center/shared';
import {
  applyTemplateRequest,
  availableComponents,
  canCreateGenerated,
  clampPlanCount,
  conflictsFromError,
  isStaleTemplateError,
  seriesDateOf,
  seriesRequest,
  showsInsertPosition,
  upsertGenerationEdit,
  usableTemplates,
} from './template-use';

const REVISION = '11111111-1111-4111-8111-111111111111';

const template = (overrides: Partial<PlanTemplateSummary> = {}): PlanTemplateSummary => ({
  id: '22222222-2222-4222-8222-222222222222',
  organization_id: '33333333-3333-4333-8333-333333333333',
  service_type_id: null,
  kind: 'plan',
  name: 'Sunday',
  description: null,
  current_revision: 2,
  archived_at: null,
  created_by: null,
  updated_by: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  service_type: null,
  current_revision_id: REVISION,
  counts: { times: 1, items: 4, needs: 0, roster: 2, has_notes: false },
  ...overrides,
});

describe('template choices', () => {
  it('lists only templates with a revision and offers only the parts they hold', () => {
    expect(usableTemplates([template(), template({ id: 'x', current_revision_id: null })])).toHaveLength(1);
    expect(availableComponents(template())).toEqual(['times', 'items', 'roster']);
    expect(availableComponents(undefined)).toEqual([]);
  });

  it('sends the chosen parts the template holds, valid for the shared schema', () => {
    const request = applyTemplateRequest({ template: template(), mode: 'append', chosen: ['items', 'needs', 'notes', 'roster'], insertAt: 2 });
    expect(request).toEqual({ revision_id: REVISION, mode: 'append', components: ['items', 'roster'], insert_at: 2 });
    expect(previewTemplateApplySchema.safeParse(request).success).toBe(true);
  });

  it('never sends an insert position when replacing', () => {
    expect(applyTemplateRequest({ template: template(), mode: 'replace', chosen: ['items'], insertAt: 2 }).insert_at).toBeNull();
  });

  it('applies a section as appended items only', () => {
    const section = template({ kind: 'section', counts: { times: 0, items: 3, needs: 0, roster: 0, has_notes: false } });
    expect(applyTemplateRequest({ template: section, mode: 'replace', chosen: ['roster'], insertAt: 0 }))
      .toEqual({ revision_id: REVISION, mode: 'append', components: ['items'], insert_at: 0 });
    expect(showsInsertPosition({ template: section, mode: 'replace', chosen: [] }, 3)).toBe(true);
  });

  it('asks where items go only when appending items to a plan that has some', () => {
    expect(showsInsertPosition({ template: template(), mode: 'append', chosen: ['items'] }, 3)).toBe(true);
    expect(showsInsertPosition({ template: template(), mode: 'append', chosen: ['items'] }, 0)).toBe(false);
    expect(showsInsertPosition({ template: template(), mode: 'append', chosen: ['roster'] }, 3)).toBe(false);
    expect(showsInsertPosition({ template: template(), mode: 'replace', chosen: ['items'] }, 3)).toBe(false);
  });
});

describe('errors', () => {
  it('treats a changed plan or template as stale and nothing else', () => {
    expect(isStaleTemplateError(new ApiError(409, 'x', 'plan_revision_stale'))).toBe(true);
    expect(isStaleTemplateError(new ApiError(409, 'x', 'template_preview_changed'))).toBe(true);
    expect(isStaleTemplateError(new ApiError(409, 'x', 'scheduling_conflict'))).toBe(false);
    expect(isStaleTemplateError(new Error('offline'))).toBe(false);
  });

  it('reads conflicts only from a scheduling conflict', () => {
    const details = [{ person_id: 'p', severity: 'blocking' }];
    expect(conflictsFromError(new ApiError(409, 'x', 'scheduling_conflict', details))).toEqual(details);
    expect(conflictsFromError(new ApiError(409, 'x', 'plan_revision_stale', details))).toEqual([]);
    expect(conflictsFromError(new ApiError(409, 'x', 'scheduling_conflict', 'not a list'))).toEqual([]);
  });
});

describe('generation', () => {
  it('builds the website series request; times are always created by the server', () => {
    const request = seriesRequest({
      template: template(),
      components: ['times', 'items', 'needs'],
      startDate: '2026-10-25',
      intervalWeeks: 1,
      count: 3,
      endDate: null,
      excludedDates: ['2026-11-01'],
      edits: [],
      ambiguous: 'earlier',
    });
    expect(request).toEqual({
      revision_id: REVISION,
      components: ['items', 'needs'],
      start_date: '2026-10-25',
      interval_weeks: 1,
      count: 3,
      excluded_dates: ['2026-11-01'],
      edits: [],
      ambiguous_time: 'earlier',
    });
    expect(planSeriesSchema.parse(request).components).toEqual(['items', 'needs', 'times']);
  });

  it('keeps one edit per series date and finds a moved plan by its new date', () => {
    const moved = upsertGenerationEdit([], { local_date: '2026-11-01', skip: false, move_to: '2026-11-02' });
    const renamed = upsertGenerationEdit(moved, { local_date: '2026-11-01', skip: false, move_to: '2026-11-02', title: 'Communion' });
    expect(renamed).toEqual([{ local_date: '2026-11-01', skip: false, move_to: '2026-11-02', title: 'Communion' }]);
    expect(seriesDateOf(renamed, '2026-11-02')?.local_date).toBe('2026-11-01');
    expect(seriesDateOf(renamed, '2026-11-08')).toBeUndefined();
  });

  it('creates only a problem-free, unblocked, non-empty review', () => {
    const planPreview = (blocking: TemplateApplyPreview['blocking']): GenerationPlanPreview => ({
      local_date: '2026-10-25',
      title: 'Sunday',
      service_date: '2026-10-25T14:00:00Z',
      existing_plans: [],
      preview: { blocking, warnings: [] } as unknown as TemplateApplyPreview,
    });
    const preview = (overrides: Partial<PlanGenerationPreview>): PlanGenerationPreview => ({
      template_id: 't', service_type_id: null, revision_id: REVISION, timezone: 'America/Toronto',
      plans: [planPreview([])], excluded: [], problems: [], preview_hash: 'a'.repeat(32), max_plans: 12,
      ...overrides,
    });
    expect(canCreateGenerated(preview({}))).toBe(true);
    expect(canCreateGenerated(preview({ preview_hash: null }))).toBe(false);
    expect(canCreateGenerated(preview({ plans: [] }))).toBe(false);
    expect(canCreateGenerated(preview({ plans: [planPreview([{ code: 'times_in_use', message: 'x' }])] }))).toBe(false);
  });

  it('keeps the count within the server bound', () => {
    expect(clampPlanCount(40, 12)).toBe(12);
    expect(clampPlanCount(0, 12)).toBe(1);
    expect(clampPlanCount(Number.NaN, 12)).toBe(1);
    expect(clampPlanCount(3.7, 12)).toBe(3);
  });
});
