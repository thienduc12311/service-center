import { describe, expect, it } from 'vitest';
import { buildPlanItemCreateBody, buildPlanItemPatch, type PlanItemPatchBase } from './plan-item.model.js';

const song: PlanItemPatchBase = { item_type: 'song', song_id: 's1', leader_person_id: null, leader_position_id: 'pos' };

describe('buildPlanItemPatch', () => {
  it('writes only the fields sent; null clears', () => {
    expect(buildPlanItemPatch({ key_override: 'D', sequence_override: null }, song)).toEqual({ key_override: 'D', sequence_override: null });
  });

  it('drops the old song’s arrangement and sequence when the song changes, unless new ones are sent', () => {
    expect(buildPlanItemPatch({ song_id: 's2' }, song)).toEqual({ song_id: 's2', arrangement_id: null, sequence_override: null });
    expect(buildPlanItemPatch({ song_id: 's2', arrangement_id: 'a2' }, song)).toEqual({ song_id: 's2', arrangement_id: 'a2', sequence_override: null });
    expect(buildPlanItemPatch({ song_id: 's1' }, song)).toEqual({ song_id: 's1' });
  });

  it('clears song-only fields when the item stops being a song', () => {
    expect(buildPlanItemPatch({ item_type: 'item', title: 'Reading' }, song)).toEqual({
      item_type: 'item', title: 'Reading', song_id: null, arrangement_id: null, key_override: null, sequence_override: null,
    });
  });

  it('keeps one kind of leader', () => {
    expect(buildPlanItemPatch({ leader_person_id: 'p1' }, song)).toEqual({ leader_person_id: 'p1', leader_position_id: null });
    expect(buildPlanItemPatch({ leader_position_id: 'pos2' }, { ...song, leader_person_id: 'p1' })).toEqual({ leader_position_id: 'pos2', leader_person_id: null });
  });
});

describe('buildPlanItemCreateBody', () => {
  it('sends the item without its key, so a replay compares the item alone', () => {
    expect(
      buildPlanItemCreateBody({ item_type: 'item', title: 'Welcome', length_seconds: 60, idempotency_key: 'retry-key-0001' }),
    ).toEqual({ item_type: 'item', title: 'Welcome', length_seconds: 60 });
  });
});
