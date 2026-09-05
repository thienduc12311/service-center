import { describe, expect, it } from 'vitest';
import { createSongbookSchema } from './songbook.js';

const songId = '11111111-1111-4111-8111-111111111111';

describe('createSongbookSchema', () => {
  it('accepts a curated song book', () => {
    const result = createSongbookSchema.safeParse({
      title: 'Sunday Favorites',
      source_type: 'manual',
      songs: [{ song_id: songId }],
    });
    expect(result.success).toBe(true);
  });

  it('requires content for either creation mode', () => {
    expect(createSongbookSchema.safeParse({ title: 'Empty', source_type: 'manual' }).success).toBe(false);
    expect(createSongbookSchema.safeParse({ title: 'Missing', source_type: 'document' }).success).toBe(false);
  });

  it('accepts an uploaded document book', () => {
    const result = createSongbookSchema.safeParse({
      title: 'Choir Book',
      source_type: 'document',
      source_storage_path: `${songId}/choir-book.pdf`,
    });
    expect(result.success).toBe(true);
  });
});
