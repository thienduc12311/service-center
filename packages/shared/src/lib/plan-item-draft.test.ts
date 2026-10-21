import { describe, expect, it } from 'vitest';
import { createPlanItemSchema, updatePlanItemSchema } from '../schemas/plan.js';
import type { PlanItemArrangement, PlanItemDetail } from '../types/domain.js';
import { renderChartContext, resolvePlanItemChartContext } from './chart-context.js';
import {
  appendSequenceStep,
  editableArrangements,
  initialArrangementFor,
  movedItemIds,
  newPlanItemRequest,
  planItemChangesFrom,
  planItemDraftFrom,
  validateNewPlanItemDraft,
  validatePlanItemDraft,
  withInheritSequence,
  withSong,
  type PlanItemDraft,
} from './plan-item-draft.js';

const SONG = '00000000-0000-4000-8000-000000000001';
const OTHER_SONG = '00000000-0000-4000-8000-000000000002';
const ARR_C = '00000000-0000-4000-8000-0000000000a1';
const ARR_G = '00000000-0000-4000-8000-0000000000a2';
const PERSON = '00000000-0000-4000-8000-0000000000b1';
const POSITION = '00000000-0000-4000-8000-0000000000b2';

const arrangement = (overrides: Partial<PlanItemArrangement>): PlanItemArrangement => ({
  id: ARR_C,
  song_id: SONG,
  name: 'Default',
  song_key: 'C',
  bpm: null,
  sequence: ['V1', 'C'],
  chord_chart: '{c: V1}\n[C]Amazing [G]grace\n{c: C}\n[F]How [C]sweet',
  chart_columns: 1,
  chart_font: null,
  chart_font_size: null,
  chart_chord_color: null,
  is_default: true,
  length_seconds: 240,
  ...overrides,
});

const songItem = (overrides: Partial<PlanItemDetail> = {}): PlanItemDetail => ({
  id: 'item-1',
  plan_id: 'plan-1',
  item_type: 'song',
  title: 'Amazing Grace',
  song_id: SONG,
  arrangement_id: null,
  key_override: null,
  length_seconds: 240,
  description: null,
  sort_order: 0,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  song: { id: SONG, title: 'Amazing Grace', author: null, copyright: null, default_key: 'C', default_bpm: null },
  arrangement: null,
  default_arrangement: arrangement({}),
  ...overrides,
});

/**
 * What the server stores for a patch (`buildPlanItemPatch` + `update_plan_item`),
 * reduced to the fields these tests read: absent keeps, null clears.
 */
const saved = (item: PlanItemDetail, draft: PlanItemDraft, chosen: PlanItemArrangement | null): PlanItemDetail => {
  const changes = planItemChangesFrom(draft, item);
  const next: PlanItemDetail = { ...item };
  if (changes.arrangement_id !== undefined) next.arrangement_id = changes.arrangement_id;
  if (changes.key_override !== undefined) next.key_override = changes.key_override;
  if (changes.sequence_override !== undefined) next.sequence_override = changes.sequence_override;
  next.arrangement = next.arrangement_id ? chosen : null;
  next.default_arrangement = next.arrangement_id ? null : item.default_arrangement;
  return next;
};

describe('planItemDraftFrom / planItemChangesFrom', () => {
  it('sends nothing for an untouched draft', () => {
    const item = songItem({ key_override: 'D', sequence_override: [], leader_position_id: POSITION, service_segment: 'pre', description: 'Slow' });
    expect(planItemChangesFrom(planItemDraftFrom(item), item)).toEqual({});
  });

  it('keeps inherited, empty and explicit sequences distinct', () => {
    const item = songItem();
    const draft = planItemDraftFrom(item);
    expect(draft.inheritSequence).toBe(true);

    // Unticked with nothing typed is "no sequence for this plan", not inherit.
    const none = { ...draft, inheritSequence: false };
    expect(planItemChangesFrom(none, item)).toEqual({ sequence_override: [] });

    const explicit = { ...draft, inheritSequence: false, sequence: 'Intro, V1 , ,C' };
    expect(planItemChangesFrom(explicit, item)).toEqual({ sequence_override: ['Intro', 'V1', 'C'] });

    const back = planItemDraftFrom(songItem({ sequence_override: ['V1'] }));
    expect(planItemChangesFrom({ ...back, inheritSequence: true }, songItem({ sequence_override: ['V1'] }))).toEqual({ sequence_override: null });

    for (const changes of [planItemChangesFrom(none, item), planItemChangesFrom(explicit, item)]) {
      expect(updatePlanItemSchema.safeParse({ ...changes, expected_revision: 3 }).success).toBe(true);
    }
  });

  it('starts an unticked sequence from the arrangement and adds section chips', () => {
    const draft = withInheritSequence(planItemDraftFrom(songItem()), false, ['V1', 'C']);
    expect(draft.sequence).toBe('V1, C');
    expect(appendSequenceStep(draft.sequence, 'Bridge')).toBe('V1, C, Bridge');
    expect(appendSequenceStep('', 'V1')).toBe('V1');
  });

  it('turns a song into a header with no song fields and no length', () => {
    const item = songItem({ key_override: 'D', sequence_override: ['V1'] });
    const changes = planItemChangesFrom({ ...planItemDraftFrom(item), itemType: 'header', title: 'Worship' }, item);
    expect(changes).toEqual({ item_type: 'header', title: 'Worship', length_seconds: 0 });
    expect(updatePlanItemSchema.safeParse(changes).success).toBe(true);
  });

  it('resets arrangement, key and sequence when the song changes', () => {
    const item = songItem({ arrangement_id: ARR_G, key_override: 'A', sequence_override: ['C'] });
    const draft = withSong(planItemDraftFrom(item), { id: OTHER_SONG, title: 'How Great' });
    expect(planItemChangesFrom(draft, item)).toEqual({
      title: 'How Great',
      song_id: OTHER_SONG,
      arrangement_id: null,
      key_override: null,
      sequence_override: null,
    });
  });

  it('switches leader kinds without ever sending both', () => {
    const item = songItem({ leader_person_id: PERSON });
    const changes = planItemChangesFrom({ ...planItemDraftFrom(item), leaderMode: 'position', leaderPositionId: POSITION }, item);
    expect(changes).toEqual({ leader_person_id: null, leader_position_id: POSITION });
    expect(updatePlanItemSchema.safeParse(changes).success).toBe(true);
    expect(planItemChangesFrom({ ...planItemDraftFrom(item), leaderMode: 'none' }, item)).toEqual({ leader_person_id: null });
  });

  it('reports the first problem a draft has', () => {
    const draft = planItemDraftFrom(songItem());
    expect(validatePlanItemDraft(draft)).toBeNull();
    expect(validatePlanItemDraft({ ...draft, songId: null })).toBe('songRequired');
    expect(validatePlanItemDraft({ ...draft, itemType: 'item', title: ' ' })).toBe('titleRequired');
    expect(validatePlanItemDraft({ ...draft, length: '4:x' })).toBe('lengthFormat');
    expect(validatePlanItemDraft({ ...draft, length: '10:00:01' })).toBe('lengthRange');
    expect(validatePlanItemDraft({ ...draft, inheritSequence: false, sequence: Array(61).fill('V').join(',') })).toBe('sequenceTooLong');
    expect(validatePlanItemDraft({ ...draft, inheritSequence: false, sequence: 'x'.repeat(21) })).toBe('sequenceStepTooLong');
    expect(validatePlanItemDraft({ ...draft, leaderMode: 'person' })).toBe('leaderPersonRequired');
    expect(validatePlanItemDraft({ ...draft, leaderMode: 'position' })).toBe('leaderPositionRequired');
  });
});

describe('plan-only key and sequence read back identically', () => {
  it('a G arrangement chosen for this plan in A with its own sequence', () => {
    const g = arrangement({ id: ARR_G, name: 'Acoustic', song_key: 'G', is_default: false, sequence: ['V1'], chord_chart: '{c: V1}\n[G]Amazing [D]grace' });
    const item = songItem();
    const draft = { ...planItemDraftFrom(item), arrangementId: ARR_G, keyOverride: 'A', inheritSequence: false, sequence: 'V1, V1' };
    const context = resolvePlanItemChartContext(saved(item, draft, g));
    expect(context.status).toBe('ready');
    if (context.status !== 'ready') return;
    expect([context.arrangement?.name, context.sourceKey, context.displayKey, context.keyFromPlan]).toEqual(['Acoustic', 'G', 'A', true]);
    expect([context.sequence, context.sequenceFromPlan]).toEqual([['V1', 'V1'], true]);
    const chart = renderChartContext(context);
    expect(chart.status === 'ready' && chart.chordpro).toContain('[A]Amazing [E]grace');
  });

  it('inherits the default arrangement, its key and its sequence when nothing is chosen', () => {
    const item = songItem({ arrangement_id: ARR_G, arrangement: arrangement({ id: ARR_G, is_default: false, song_key: 'G' }), default_arrangement: null, key_override: 'A', sequence_override: ['C'] });
    const back = { ...planItemDraftFrom(item), arrangementId: null, keyOverride: null, inheritSequence: true };
    const restored = saved({ ...item, default_arrangement: arrangement({}) }, back, null);
    const context = resolvePlanItemChartContext(restored);
    expect(context.status === 'ready' && [context.displayKey, context.sequence, context.sequenceFromPlan]).toEqual(['C', ['V1', 'C'], false]);
  });

  it('shows another song\'s arrangement as unavailable rather than charting it', () => {
    const foreign = arrangement({ id: ARR_G, song_id: OTHER_SONG, is_default: false });
    const context = resolvePlanItemChartContext(songItem({ arrangement_id: ARR_G, arrangement: foreign, default_arrangement: null }));
    expect(context).toEqual({ status: 'unavailable', reason: 'arrangement_missing' });
  });
});

describe('arrangement choices (F15 archive)', () => {
  const active = { id: 'a', archived_at: null, is_default: true, length_seconds: 200 };
  const archived = { id: 'b', archived_at: '2026-10-01T00:00:00Z', is_default: false, length_seconds: 180 };

  it('hides archived arrangements except the one the item already uses', () => {
    expect(editableArrangements([active, archived], null).map((row) => row.id)).toEqual(['a']);
    expect(editableArrangements([active, archived], 'b').map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('never starts a new item on an archived arrangement', () => {
    expect(initialArrangementFor([{ ...archived }, { ...active, is_default: false }])?.id).toBe('a');
    expect(initialArrangementFor([archived])).toBeNull();
  });
});

describe('newPlanItemRequest', () => {
  const song = { id: SONG, title: 'Amazing Grace', arrangements: [{ id: ARR_C, archived_at: null, is_default: true, length_seconds: 240 }] };

  it('builds the website add body for a song, keeping the plan key and the arrangement length', () => {
    const body = newPlanItemRequest({ itemType: 'song', title: '', song, keyOverride: 'D', length: '', description: ' ' }, 'Song');
    expect(body).toEqual({ item_type: 'song', title: 'Amazing Grace', song_id: SONG, arrangement_id: ARR_C, key_override: 'D', length_seconds: 240, description: null });
    expect(createPlanItemSchema.safeParse(body).success).toBe(true);
  });

  it('builds headers and items without song fields', () => {
    const header = newPlanItemRequest({ itemType: 'header', title: ' Worship ', song, keyOverride: 'D', length: '5:00', description: 'x' }, 'Song');
    expect(header).toEqual({ item_type: 'header', title: 'Worship', song_id: null, arrangement_id: null, key_override: null, length_seconds: 0, description: null });
    const item = newPlanItemRequest({ itemType: 'item', title: 'Welcome', song: null, keyOverride: null, length: '2:30', description: 'Hi' }, 'Song');
    expect(item.length_seconds).toBe(150);
    for (const body of [header, item]) expect(createPlanItemSchema.safeParse(body).success).toBe(true);
  });

  it('validates what the add form can check', () => {
    const base = { itemType: 'song' as const, title: '', song: null, keyOverride: null, length: '', description: '' };
    expect(validateNewPlanItemDraft(base)).toBe('songRequired');
    expect(validateNewPlanItemDraft({ ...base, itemType: 'item' })).toBe('titleRequired');
    expect(validateNewPlanItemDraft({ ...base, song, length: 'abc' })).toBe('lengthFormat');
    expect(validateNewPlanItemDraft({ ...base, itemType: 'header', title: 'H', length: 'abc' })).toBeNull();
  });
});

describe('movedItemIds', () => {
  it('swaps one step and refuses moves past either end', () => {
    expect(movedItemIds(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(movedItemIds(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(movedItemIds(['a', 'b'], 0, -1)).toBeNull();
    expect(movedItemIds(['a', 'b'], 1, 1)).toBeNull();
    expect(movedItemIds(['a'], 3, -1)).toBeNull();
  });
});
