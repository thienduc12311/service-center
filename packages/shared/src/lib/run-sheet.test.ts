import { describe, expect, it } from 'vitest';
import type { NoteCategoryRow, PlanNote } from '../types/collaboration.js';
import type { AssignmentDetail, PlanDetail, PlanItemDetail } from '../types/domain.js';
import { renderRunSheetHtml, runSheetDocumentFromPlan } from './run-sheet.js';

const base = {
  plan_id: 'plan',
  song_id: null,
  arrangement_id: null,
  key_override: null,
  description: null,
  created_at: '',
  updated_at: '',
  song: null,
  arrangement: null,
  sequence_override: null,
  leader_person_id: null,
  leader_position_id: null,
  service_segment: 'service' as const,
};
const items: PlanItemDetail[] = [
  { ...base, id: 'pre', item_type: 'item', title: 'Prayer', length_seconds: 600, sort_order: 0, service_segment: 'pre' },
  { ...base, id: 'h', item_type: 'header', title: 'Worship', length_seconds: 0, sort_order: 1 },
  {
    ...base,
    id: 'song',
    item_type: 'song',
    title: 'Amazing Grace',
    length_seconds: 300,
    sort_order: 2,
    song_id: 's',
    arrangement_id: 'a',
    key_override: 'D',
    sequence_override: ['V1', 'C'],
    leader_position_id: 'wl',
    song: { id: 's', title: 'Amazing Grace', author: null, copyright: null, default_key: 'C', default_bpm: null },
    arrangement: {
      id: 'a', song_id: 's', name: 'In C', song_key: 'C', bpm: null, sequence: ['V1', 'V2', 'C'], chord_chart: '[C]x',
      chart_columns: 1, chart_font: null, chart_font_size: null, chart_chord_color: null, is_default: false, length_seconds: null,
    },
  },
  { ...base, id: 'welcome', item_type: 'item', title: 'Welcome', length_seconds: 120, sort_order: 3, leader_person_id: 'p', leader_person: { id: 'p', full_name: 'Jordan Blake' } },
];
const plan = {
  id: 'plan', title: 'Sunday', location: 'Main', service_date: '2026-11-01T15:00:00Z',
  times: [{ id: 't', plan_id: 'plan', kind: 'service', name: 'Service', starts_at: '2026-11-01T15:00:00.000Z', ends_at: '2026-11-01T16:00:00.000Z', sort_order: 0 }],
  items,
  assignments: [{ person_id: 'sam', position_id: 'wl', status: 'confirmed', visibility: 'released', person: { full_name: 'Sam Rivera' }, position: { id: 'wl', name: 'Worship Leader' } }] as unknown as AssignmentDetail[],
} as unknown as PlanDetail;
const categories = [{ id: 'music', name: 'Music' }, { id: 'tech', name: 'Tech' }] as NoteCategoryRow[];
const note = (id: string, category: string | null, item: string | null, body: string) => ({ id, category_id: category, plan_item_id: item, body }) as PlanNote;
const notes = [note('1', 'music', 'song', 'Soft intro'), note('2', 'tech', 'song', 'Lyrics slide 3'), note('3', null, null, 'Communion today')];

describe('runSheetDocumentFromPlan', () => {
  const { document, schedule } = runSheetDocumentFromPlan({
    plan, organizationName: 'Grace', timeZone: 'America/Toronto', notes, categories,
    selectedCategoryIds: ['music', null], includeLeaders: true,
  });

  it('prints local planned times that match the computed schedule', () => {
    const rows = Object.fromEntries(document.rows.map((row) => [row.itemId, row]));
    expect(rows.pre!.start).toBe('9:50 AM');
    expect(rows.song!.start).toBe('10:00 AM');
    expect(rows.welcome!.start).toBe('10:05 AM');
    expect(rows.h!.start).toBeNull();
    expect(document.plannedFinish).toBe('10:07 AM');
    expect(schedule.service_seconds).toBe(420);
  });

  it('uses the shared resolver for key and sequence, and resolves leaders', () => {
    const song = document.rows.find((row) => row.itemId === 'song')!;
    expect(song).toMatchObject({ key: 'D', sequence: ['V1', 'C'], leader: 'Worship Leader: Sam Rivera' });
    expect(document.rows.find((row) => row.itemId === 'welcome')!.leader).toBe('Jordan Blake');
  });

  it('prints only the selected categories of notes the reader could already see', () => {
    expect(document.rows.find((row) => row.itemId === 'song')!.notes).toEqual(['Music: Soft intro']);
    expect(document.planNotes).toEqual(['Note: Communion today']);
    const html = renderRunSheetHtml(document);
    expect(html).toContain('Soft intro');
    expect(html).not.toContain('Lyrics slide 3');
    expect(html).toContain('Before the service');
  });

  it('omits leaders when not chosen', () => {
    const { document: plain } = runSheetDocumentFromPlan({
      plan, organizationName: 'Grace', timeZone: 'America/Toronto', notes, categories, selectedCategoryIds: [], includeLeaders: false,
    });
    expect(plain.rows.every((row) => row.leader === null && row.notes.length === 0)).toBe(true);
    expect(plain.planNotes).toEqual([]);
  });
});
