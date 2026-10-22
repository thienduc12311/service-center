import { describe, expect, it } from 'vitest';
import { savePlanNoteSchema } from '../schemas/collaboration.js';
import type { NoteCategoryRow, PlanNote } from '../types/collaboration.js';
import {
  itemNoteCounts,
  noteCategoryLabel,
  noteTeamNames,
  planNoteDraftChanged,
  planNoteDraftFrom,
  planNoteLeavesSimple,
  planNoteRequest,
  planNotesFor,
  toggleNoteTeam,
  validatePlanNoteDraft,
  withNoteCategory,
} from './plan-notes.js';

const ITEM = '00000000-0000-4000-8000-000000000011';
const CATEGORY = '00000000-0000-4000-8000-000000000021';
const TEAM_A = '00000000-0000-4000-8000-000000000031';
const TEAM_B = '00000000-0000-4000-8000-000000000032';

const category = (overrides: Partial<NoteCategoryRow> = {}): NoteCategoryRow => ({
  id: CATEGORY,
  organization_id: 'org',
  service_type_id: null,
  name: 'Production',
  default_audience: 'teams',
  sort_order: 0,
  archived_at: null,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const note = (overrides: Partial<PlanNote> = {}): PlanNote => ({
  id: 'note-1',
  organization_id: 'org',
  plan_id: 'plan-1',
  plan_item_id: null,
  category_id: null,
  audience: 'organization',
  body: 'Doors at 9:30',
  is_legacy: true,
  revision: 3,
  created_by: null,
  updated_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  team_ids: [],
  author_name: null,
  ...overrides,
});

describe('plan note drafts', () => {
  it('starts a new note General and readable by everyone, on the item it was opened from', () => {
    expect(planNoteDraftFrom(null, ITEM)).toEqual({
      planItemId: ITEM, categoryId: null, audience: 'organization', teamIds: [], body: '',
    });
  });

  it('a category suggests its audience for a new note but never changes an existing one', () => {
    const fresh = withNoteCategory(planNoteDraftFrom(null, null), CATEGORY, [category()], true);
    expect(fresh.audience).toBe('teams');
    const existing = withNoteCategory(planNoteDraftFrom(note(), null), CATEGORY, [category()], false);
    expect(existing).toMatchObject({ categoryId: CATEGORY, audience: 'organization' });
    // Back to General keeps whatever audience was chosen.
    expect(withNoteCategory(fresh, null, [category()], true).audience).toBe('teams');
  });

  it('refuses an empty note and a team note without teams', () => {
    expect(validatePlanNoteDraft(planNoteDraftFrom(null, null))).toBe('body_required');
    const teams = { ...planNoteDraftFrom(null, null), body: 'x', audience: 'teams' as const };
    expect(validatePlanNoteDraft(teams)).toBe('teams_required');
    expect(validatePlanNoteDraft(toggleNoteTeam(teams, TEAM_A))).toBeNull();
    expect(toggleNoteTeam(toggleNoteTeam(teams, TEAM_A), TEAM_A).teamIds).toEqual([]);
  });

  it('creates without a revision and edits with the one the editor opened', () => {
    const created = planNoteRequest({ ...planNoteDraftFrom(null, ITEM), body: '  Cue lights  ' }, null);
    expect(created).toEqual({
      plan_item_id: ITEM, category_id: null, audience: 'organization', team_ids: [], body: 'Cue lights',
    });
    expect(savePlanNoteSchema.parse(created)).toEqual(created);

    const edited = planNoteRequest({ ...planNoteDraftFrom(note(), null), body: 'Doors at 9:15' }, note());
    expect(edited.expected_revision).toBe(3);
    expect(savePlanNoteSchema.parse(edited)).toEqual(edited);
    // Re-based onto a newer copy after a stale save: the newer revision goes.
    expect(planNoteRequest(planNoteDraftFrom(note(), null), note(), 5).expected_revision).toBe(5);
  });

  it('sends teams only for a team note, each once', () => {
    const draft = { ...planNoteDraftFrom(null, null), body: 'x', audience: 'teams' as const, teamIds: [TEAM_A, TEAM_B, TEAM_A] };
    expect(planNoteRequest(draft, null).team_ids).toEqual([TEAM_A, TEAM_B]);
    expect(planNoteRequest({ ...draft, audience: 'leaders' }, null).team_ids).toEqual([]);
    expect(() => savePlanNoteSchema.parse(planNoteRequest({ ...draft, teamIds: [] }, null))).toThrow();
  });

  it('knows when leaving would lose something', () => {
    expect(planNoteDraftChanged(planNoteDraftFrom(null, null), null)).toBe(false);
    expect(planNoteDraftChanged({ ...planNoteDraftFrom(null, null), body: 'x' }, null)).toBe(true);
    const saved = note({ audience: 'teams', team_ids: [TEAM_A, TEAM_B], is_legacy: false });
    const draft = planNoteDraftFrom(saved, null);
    expect(planNoteDraftChanged(draft, saved)).toBe(false);
    expect(planNoteDraftChanged({ ...draft, teamIds: [TEAM_B, TEAM_A] }, saved)).toBe(false);
    expect(planNoteDraftChanged(toggleNoteTeam(draft, TEAM_B), saved)).toBe(true);
    expect(planNoteDraftChanged({ ...draft, body: `${saved.body}  ` }, saved)).toBe(false);
  });

  it('warns that only a General, everyone, plan note stays the simple note', () => {
    const simple = note();
    const draft = planNoteDraftFrom(simple, null);
    expect(planNoteLeavesSimple(simple, { ...draft, body: 'new text' })).toBe(false);
    expect(planNoteLeavesSimple(simple, { ...draft, audience: 'leaders' })).toBe(true);
    expect(planNoteLeavesSimple(simple, { ...draft, categoryId: CATEGORY })).toBe(true);
    expect(planNoteLeavesSimple(note({ is_legacy: false }), { ...draft, audience: 'leaders' })).toBe(false);
    expect(planNoteLeavesSimple(null, { ...draft, audience: 'leaders' })).toBe(false);
  });
});

describe('plan note display', () => {
  it('names General, live and archived categories honestly', () => {
    expect(noteCategoryLabel(null, [category()])).toEqual({ kind: 'general' });
    expect(noteCategoryLabel(CATEGORY, [category()])).toMatchObject({ kind: 'category', category: { name: 'Production' } });
    // Not offered any more (archived): not mislabelled as General.
    expect(noteCategoryLabel(CATEGORY, [])).toEqual({ kind: 'unavailable' });
  });

  it('lists team names and drops unknown teams', () => {
    expect(noteTeamNames([TEAM_B, 'gone', TEAM_A], [{ id: TEAM_A, name: 'Band' }, { id: TEAM_B, name: 'Production' }]))
      .toEqual(['Production', 'Band']);
  });

  it('splits plan and item notes and counts per item', () => {
    const notes = [note(), note({ id: 'n2', plan_item_id: ITEM }), note({ id: 'n3', plan_item_id: ITEM }), note({ id: 'n4', plan_item_id: 'other' })];
    expect(planNotesFor(notes, null).map((n) => n.id)).toEqual(['note-1']);
    expect(planNotesFor(notes, ITEM).map((n) => n.id)).toEqual(['n2', 'n3']);
    expect([...itemNoteCounts(notes)]).toEqual([[ITEM, 2], ['other', 1]]);
  });
});
