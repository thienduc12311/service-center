import { describe, expect, it } from 'vitest';
import { createPlanItemSchema, planItemTypeSchema } from '../schemas/plan.js';
import { planTemplateItemSchema } from '../schemas/plan-templates.js';
import type { PlanDetail, PlanItemDetail } from '../types/domain.js';
import {
  MAX_ITEM_LENGTH_SECONDS,
  PLAN_ITEM_TYPES,
  editablePlanItemTypes,
  newPlanItemRequest,
  planItemCarriesMedia,
  validateNewPlanItemDraft,
  type NewPlanItemDraft,
} from './plan-item-draft.js';
import { buildPublicPlanProjection } from './reports.js';
import { renderRunSheetHtml, runSheetDocumentFromPlan } from './run-sheet.js';

const MEDIA = '00000000-0000-4000-8000-0000000000aa';
const media = { id: MEDIA, title: 'Countdown video', duration_seconds: 300 };
const draft: NewPlanItemDraft = { itemType: 'media', title: '', song: null, keyOverride: null, length: '', description: '', media };

describe('media item type', () => {
  it('is a plan item type that needs its media', () => {
    expect(planItemTypeSchema.parse('media')).toBe('media');
    expect(createPlanItemSchema.safeParse({ item_type: 'media', media_id: MEDIA }).success).toBe(true);
    const missing = createPlanItemSchema.safeParse({ item_type: 'media', title: 'Video' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['media_id']);
    // Other items still need a title; a regular item may link media too.
    expect(createPlanItemSchema.safeParse({ item_type: 'item', media_id: MEDIA }).success).toBe(false);
    expect(createPlanItemSchema.safeParse({ item_type: 'item', title: 'Talk', media_id: MEDIA }).success).toBe(true);
  });

  it('builds the add body from the chosen media: its title and length fill blank fields', () => {
    const body = newPlanItemRequest(draft, 'Song');
    expect(body).toEqual({ item_type: 'media', title: 'Countdown video', media_id: MEDIA, length_seconds: 300, description: null });
    expect(createPlanItemSchema.safeParse(body).success).toBe(true);

    const typed = newPlanItemRequest({ ...draft, title: ' Pre-service loop ', length: '2:00', description: ' Muted ' }, 'Song');
    expect(typed).toMatchObject({ title: 'Pre-service loop', length_seconds: 120, description: 'Muted' });

    const long = newPlanItemRequest({ ...draft, media: { ...media, duration_seconds: 50_000 } }, 'Song');
    expect(long.length_seconds).toBe(MAX_ITEM_LENGTH_SECONDS);
    expect(newPlanItemRequest({ ...draft, media: { ...media, duration_seconds: null } }, 'Song').length_seconds).toBe(0);
  });

  it('needs media chosen before it can be added, but not a title', () => {
    expect(validateNewPlanItemDraft({ ...draft, media: null })).toBe('mediaRequired');
    expect(validateNewPlanItemDraft({ ...draft, media: undefined })).toBe('mediaRequired');
    expect(validateNewPlanItemDraft(draft)).toBeNull();
    expect(validateNewPlanItemDraft({ ...draft, length: 'soon' })).toBe('lengthFormat');
  });

  it('offers the media type only to an item that already has media', () => {
    expect(editablePlanItemTypes({ media_id: null })).toEqual(PLAN_ITEM_TYPES);
    expect(editablePlanItemTypes({})).toEqual(PLAN_ITEM_TYPES);
    expect(editablePlanItemTypes({ media_id: MEDIA })).toEqual([...PLAN_ITEM_TYPES, 'media']);
    expect(['song', 'header', 'item', 'media'].map((type) => planItemCarriesMedia(type as 'song'))).toEqual([false, false, true, true]);
  });

  it('keeps a template media item only with its media', () => {
    expect(planTemplateItemSchema.safeParse({ item_type: 'media', media_id: MEDIA }).success).toBe(true);
    expect(planTemplateItemSchema.safeParse({ item_type: 'media', title: 'Video' }).success).toBe(false);
  });
});

describe('media items in the printed order and the public plan', () => {
  const item: PlanItemDetail = {
    id: 'm', plan_id: 'plan', item_type: 'media', title: 'Welcome loop', song_id: null, arrangement_id: null, key_override: null,
    length_seconds: 120, description: null, sort_order: 0, sequence_override: null, leader_person_id: null, leader_position_id: null,
    service_segment: 'service', media_id: MEDIA, created_at: '', updated_at: '', song: null, arrangement: null,
    media: { id: MEDIA, title: 'Countdown video', creator: null, duration_seconds: 300, archived: false, thumbnail_file_id: null },
  };
  const plan = {
    id: 'plan', title: 'Sunday', location: null, service_date: '2026-11-01T15:00:00Z',
    times: [{ id: 't', plan_id: 'plan', kind: 'service', name: 'Service', starts_at: '2026-11-01T15:00:00.000Z', ends_at: '2026-11-01T16:00:00.000Z', sort_order: 0 }],
    items: [item],
    assignments: [],
  } as unknown as PlanDetail;

  it('prints a timed media row naming its media', () => {
    const { document } = runSheetDocumentFromPlan({
      plan, organizationName: 'Grace', timeZone: 'UTC', notes: [], categories: [], selectedCategoryIds: [], includeLeaders: false,
    });
    expect(document.rows[0]).toMatchObject({ kind: 'media', start: '3:00 PM', durationSeconds: 120, mediaTitle: 'Countdown video' });
    expect(renderRunSheetHtml(document)).toContain('Media: Countdown video');
  });

  it('publishes a media row with only the allowlisted fields', () => {
    const projection = buildPublicPlanProjection(
      {
        organization_name: 'Grace',
        timezone: 'UTC',
        plan: { title: 'Sunday', service_date: '2026-11-01T15:00:00Z', status: 'published', location: null, service_type_name: null },
        times: [],
        items: [{ item_type: 'media', title: 'Welcome loop', length_seconds: 120, song: null, key: null }],
      },
      ['order', 'item_lengths'],
    );
    expect(projection.items).toEqual([{ kind: 'media', title: 'Welcome loop', length_seconds: 120 }]);
  });
});
