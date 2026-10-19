import { describe, expect, it } from 'vitest';
import { duplicateArrangementSchema, labeledKeyInputSchema, songMergeCommitSchema } from './arrangement-curation.js';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const key = { id, expected_revision: null, label: 'High vocal', song_key: 'E', capo: 2, vocal_label: 'Soprano', file_ids: [other] };
describe('arrangement curation boundary', () => {
  it('accepts labeled sounding keys with explicit scope and revision', () => {
    expect(labeledKeyInputSchema.parse(key)).toEqual(key);
    expect(labeledKeyInputSchema.parse({ ...key, song_key: 'F#m', expected_revision: 3 }).song_key).toBe('F#m');
  });
  it('rejects invalid pitches, capo ranges, duplicate/oversized file scopes and injected parents', () => {
    for (const patch of [{ song_key: '' }, { song_key: 'H' }, { capo: 12 }, { file_ids: [other, other] }, { file_ids: Array(101).fill(other) }, { arrangement_id: other }]) {
      expect(labeledKeyInputSchema.safeParse({ ...key, ...patch }).success).toBe(false);
    }
  });
  it('requires explicit bounded duplicate options and does not accept default/archive overrides', () => {
    const selection = { name: 'Copy', expected_revision: 1, metadata: false, sections: true, chart: false, key_ids: [id], file_ids: [] };
    expect(duplicateArrangementSchema.parse(selection)).toEqual(selection);
    for (const patch of [{ expected_revision: 0 }, { key_ids: [id, id] }, { is_default: true }, { archived_at: null }, { name: '' }]) {
      expect(duplicateArrangementSchema.safeParse({ ...selection, ...patch }).success).toBe(false);
    }
  });
  it('binds merge to two explicit identities, reviewed fingerprint and retry identity', () => {
    const input = { winner_id: id, loser_id: other, fingerprint: 'a'.repeat(64), idempotency_key: id };
    expect(songMergeCommitSchema.parse(input)).toEqual(input);
    expect(songMergeCommitSchema.safeParse({ ...input, loser_id: id }).success).toBe(false);
    expect(songMergeCommitSchema.safeParse({ ...input, fingerprint: 'stale' }).success).toBe(false);
  });
});
