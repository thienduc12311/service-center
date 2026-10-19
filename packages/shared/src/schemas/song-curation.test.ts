import { describe, expect, it } from 'vitest';
import { listSongsQuerySchema, songBulkPreviewSchema, songArchiveSchema } from './song.js';
const id = '00000000-0000-4000-8000-000000000001';
const row = { id, expected_revision: 1 };
describe('song curation boundary', () => {
  it('preserves absent metadata rather than clearing other fields', () => {
    const input = songBulkPreviewSchema.parse({ rows: [row], patch: { themes: [] } });
    expect(input.patch).toEqual({ themes: [] });
  });
  it('refuses an empty, duplicate or oversized selection', () => {
    for (const rows of [[], [row, row], Array.from({ length: 101 }, () => row)]) {
      expect(songBulkPreviewSchema.safeParse({ rows, patch: { notes: 'new' } }).success).toBe(false);
    }
  });
  it('refuses identity, ownership and archive changes through metadata', () => {
    for (const key of ['id', 'organization_id', 'title', 'archived_at', 'revision']) {
      expect(songBulkPreviewSchema.safeParse({ rows: [row], patch: { [key]: id } }).success).toBe(false);
    }
  });
  it('refuses an empty patch and invalid musical metadata', () => {
    for (const patch of [{}, { default_bpm: 0 }, { themes: ['x'.repeat(41)] }]) {
      expect(songBulkPreviewSchema.safeParse({ rows: [row], patch }).success).toBe(false);
    }
  });
  it('refuses inverted date/BPM bounds and unbounded pages', () => {
    for (const query of [{ bpm_min: 120, bpm_max: 80 }, { scheduled_from: '2027-02-01T00:00:00Z', scheduled_to: '2027-01-01T00:00:00Z' }, { per_page: 201 }]) {
      expect(listSongsQuerySchema.safeParse(query).success).toBe(false);
    }
  });
  it('requires a revision for archive and retains legacy list defaults', () => {
    expect(songArchiveSchema.safeParse({ archived: true }).success).toBe(false);
    expect(listSongsQuerySchema.parse({})).toMatchObject({ archive: 'active', page: 1, per_page: 50 });
  });
});
