import { describe, expect, it } from 'vitest';
import { parseKeysetCursor } from '@service-center/shared';
import { MESSAGE_PAGE_SIZE, flattenMessagePages, nextMessagesCursor } from './message-paging';

const row = (index: number) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  created_at: new Date(Date.UTC(2026, 10, 21) - index * 60_000).toISOString(),
});

describe('message paging', () => {
  it('pages on the oldest row shown while pages are full', () => {
    const page = Array.from({ length: MESSAGE_PAGE_SIZE }, (_, index) => row(index));
    const cursor = nextMessagesCursor(page);
    const oldest = page[page.length - 1];
    expect(parseKeysetCursor(cursor ?? '')).toEqual({ created_at: oldest?.created_at, id: oldest?.id });
  });

  it('stops after a short or empty page', () => {
    expect(nextMessagesCursor([row(1), row(2)])).toBeUndefined();
    expect(nextMessagesCursor([])).toBeUndefined();
    expect(nextMessagesCursor([row(1), row(2)], 2)).toBeDefined();
  });

  it('flattens pages in order without duplicates', () => {
    expect(flattenMessagePages([[row(1), row(2)], [row(2), row(3)]]).map((message) => message.id))
      .toEqual([row(1).id, row(2).id, row(3).id]);
  });
});
