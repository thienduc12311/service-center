import { describe, expect, it } from 'vitest';
import {
  createPlanTemplateSchema,
  duplicatePlanTemplateSchema,
  planTemplateContentSchema,
  planTemplateItemSchema,
  planTemplateNeedSchema,
  planTemplateRosterEntrySchema,
  updatePlanTemplateSchema,
} from './plan-templates.js';

const SONG = '00000000-0000-4000-8000-000000000001';
const ARRANGEMENT = '00000000-0000-4000-8000-000000000002';
const POSITION = '00000000-0000-4000-8000-000000000003';
const TEAM = '00000000-0000-4000-8000-000000000004';
const PERSON = '00000000-0000-4000-8000-000000000005';
const SERVICE_TYPE = '00000000-0000-4000-8000-000000000006';

describe('creating a template from scratch', () => {
  it('accepts an empty content object and fills every list', () => {
    const parsed = createPlanTemplateSchema.parse({ name: ' Sunday ', service_type_id: SERVICE_TYPE, content: {} });
    expect(parsed).toMatchObject({ kind: 'plan', name: 'Sunday', service_type_id: SERVICE_TYPE, description: null });
    expect(parsed.content).toEqual({ version: 1, notes: null, times: [], items: [], needs: [], roster: [] });
  });

  it('needs a name and either content or a plan, not both', () => {
    expect(createPlanTemplateSchema.safeParse({ name: '  ', content: {} }).success).toBe(false);
    expect(createPlanTemplateSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(
      createPlanTemplateSchema.safeParse({ name: 'x', content: {}, source: { plan_id: SONG, components: ['items'] } }).success,
    ).toBe(false);
  });
});

describe('template content the editor adds', () => {
  it('keeps a song with arrangement, key, length and description', () => {
    expect(
      planTemplateItemSchema.parse({
        item_type: 'song', song_id: SONG, arrangement_id: ARRANGEMENT, key_override: 'G', length_seconds: 240, description: ' Slow intro ',
      }),
    ).toEqual({
      item_type: 'song', title: null, song_id: SONG, arrangement_id: ARRANGEMENT, key_override: 'G', length_seconds: 240, description: 'Slow intro',
    });
  });

  it('refuses a song without a song and a header or item without a title', () => {
    expect(planTemplateItemSchema.safeParse({ item_type: 'song', title: 'x' }).success).toBe(false);
    expect(planTemplateItemSchema.safeParse({ item_type: 'header', title: ' ' }).success).toBe(false);
    expect(planTemplateItemSchema.safeParse({ item_type: 'item' }).success).toBe(false);
    expect(planTemplateItemSchema.parse({ item_type: 'header', title: 'Worship' })).toMatchObject({ item_type: 'header', length_seconds: 0 });
  });

  it('bounds length and needed counts', () => {
    expect(planTemplateItemSchema.safeParse({ title: 'x', length_seconds: 36_001 }).success).toBe(false);
    expect(planTemplateNeedSchema.safeParse({ position_id: POSITION, needed: 0 }).success).toBe(false);
    expect(planTemplateNeedSchema.safeParse({ position_id: POSITION, needed: 100 }).success).toBe(false);
    expect(planTemplateNeedSchema.parse({ position_id: POSITION, needed: 3 })).toEqual({ position_id: POSITION, needed: 3 });
  });

  it('accepts a roster entry for a whole team or one position', () => {
    expect(planTemplateRosterEntrySchema.parse({ person_id: PERSON, team_id: TEAM })).toEqual({ person_id: PERSON, team_id: TEAM, position_id: null });
    expect(planTemplateRosterEntrySchema.safeParse({ person_id: PERSON }).success).toBe(false);
  });

  it('saves authored content as a new revision against the revision read', () => {
    const parsed = updatePlanTemplateSchema.parse({
      expected_revision: 2,
      content: { items: [{ item_type: 'header', title: 'Worship' }], needs: [{ position_id: POSITION, needed: 1 }] },
    });
    expect(parsed.content?.items).toHaveLength(1);
    expect(updatePlanTemplateSchema.safeParse({ content: {} }).success).toBe(false);
    expect(planTemplateContentSchema.safeParse({ segments: [] }).success).toBe(false);
  });
});

describe('duplicating a template', () => {
  it('keeps the service type when it is omitted and targets every type when it is null', () => {
    expect(duplicatePlanTemplateSchema.parse({})).toEqual({ drop_unavailable: false });
    expect(duplicatePlanTemplateSchema.parse({ service_type_id: null })).toEqual({ service_type_id: null, drop_unavailable: false });
    expect(duplicatePlanTemplateSchema.parse({ name: ' Copy ', service_type_id: SERVICE_TYPE, drop_unavailable: true })).toEqual({
      name: 'Copy', service_type_id: SERVICE_TYPE, drop_unavailable: true,
    });
  });

  it('refuses a blank name, a long name and a malformed service type', () => {
    expect(duplicatePlanTemplateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(duplicatePlanTemplateSchema.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(duplicatePlanTemplateSchema.safeParse({ service_type_id: 'sunday' }).success).toBe(false);
  });
});
