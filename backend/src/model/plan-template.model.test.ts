import { describe, expect, it } from 'vitest';
import { planSeriesSchema, type PlanTemplateContent } from '@service-center/shared';
import { buildGenerationPlans, toTemplateContent, toTemplateSummary, type PlanTemplateListRow } from './plan-template.model.js';

const content: PlanTemplateContent = {
  version: 1,
  notes: 'Bring water',
  times: [
    { kind: 'rehearsal', name: 'Run-through', day_offset: -1, local_start: '19:00', duration_minutes: 90 },
    { kind: 'service', name: 'Service', day_offset: 0, local_start: '10:00', duration_minutes: 75 },
  ],
  items: [],
  needs: [],
  roster: [],
};

const series = (overrides: Record<string, unknown> = {}) =>
  planSeriesSchema.parse({ revision_id: '00000000-0000-4000-8000-000000000001', start_date: '2027-10-24', ...overrides });

describe('generation plans', () => {
  it('anchors each plan on its service time and keeps local 10:00 across DST', () => {
    const build = buildGenerationPlans({
      content,
      series: series({ count: 3 }),
      defaultTitle: 'Sunday',
      timeZone: 'America/Toronto',
      ambiguous: 'earlier',
    });
    expect(build.problems).toEqual([]);
    expect(build.plans.map((plan) => plan.service_date)).toEqual([
      '2027-10-24T14:00:00.000Z',
      '2027-10-31T14:00:00.000Z',
      '2027-11-07T15:00:00.000Z',
    ]);
    expect(build.plans[2]!.times[0]!.starts_at).toBe('2027-11-06T23:00:00.000Z');
    expect(build.plans.every((plan) => plan.title === 'Sunday')).toBe(true);
  });

  it('leaves out a date whose template time does not exist and says why', () => {
    const build = buildGenerationPlans({
      content: { ...content, times: [{ kind: 'service', name: null, day_offset: 0, local_start: '02:30', duration_minutes: 60 }] },
      series: series({ start_date: '2027-03-07', count: 2 }),
      defaultTitle: 'Early',
      timeZone: 'America/Toronto',
      ambiguous: 'earlier',
    });
    expect(build.plans.map((plan) => plan.local_date)).toEqual(['2027-03-07']);
    expect(build.problems.map((problem) => problem.local_date)).toEqual(['2027-03-14']);
  });
});

describe('template summaries', () => {
  it('counts the current revision only', () => {
    const row: PlanTemplateListRow = {
      id: 't', organization_id: 'o', service_type_id: null, kind: 'plan', name: 'Std', description: null,
      current_revision: 2, archived_at: null, created_by: null, updated_by: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', service_type: null,
      revisions: [
        { id: 'r1', revision: 1, source_plan_id: null, created_by: null, created_at: '', content: { ...content, notes: null } },
        { id: 'r2', revision: 2, source_plan_id: null, created_by: null, created_at: '', content },
      ],
    };
    const summary = toTemplateSummary(row);
    expect(summary.current_revision_id).toBe('r2');
    expect(summary.counts).toEqual({ times: 2, items: 0, needs: 0, roster: 0, has_notes: true });
    expect('revisions' in summary).toBe(false);
  });

  it('refuses unreadable stored content', () => {
    expect(() => toTemplateContent({ times: 'nope' })).toThrow();
  });
});
