import { describe, expect, it } from 'vitest';
import { encodeKeysetCursor, keysetBeforeFilter, parseKeysetCursor } from './keyset.js';
import { listNotificationsQuerySchema } from '../schemas/notification.js';
import { discussionPageQuerySchema } from '../schemas/collaboration.js';

const ID = '22222222-2222-4222-8222-222222222222';

describe('keyset cursor', () => {
  it('round-trips a PostgREST timestamp with a +00:00 offset', () => {
    const cursor = encodeKeysetCursor({ created_at: '2026-11-20T22:07:16.512152+00:00', id: ID });
    expect(parseKeysetCursor(cursor)).toEqual({ created_at: '2026-11-20T22:07:16.512152+00:00', id: ID });
    expect(listNotificationsQuerySchema.safeParse({ before: cursor }).success).toBe(true);
    expect(discussionPageQuerySchema.safeParse({ before: cursor }).success).toBe(true);
  });

  it('accepts legacy timestamp-only cursors and rejects junk', () => {
    expect(parseKeysetCursor('2026-11-20T22:07:16Z')).toEqual({ created_at: '2026-11-20T22:07:16Z', id: null });
    for (const bad of ['yesterday', '2026-11-20', `2026-11-20T22:07:16Z~nope`, `2026-13-40T99:00:00Z`, `a~b~c`]) {
      expect(parseKeysetCursor(bad)).toBeNull();
      expect(listNotificationsQuerySchema.safeParse({ before: bad }).success).toBe(false);
    }
  });

  it('builds a compound filter only when the cursor has an id', () => {
    expect(keysetBeforeFilter({ created_at: '2026-11-20T22:07:16Z', id: null })).toBe('created_at.lt."2026-11-20T22:07:16Z"');
    expect(keysetBeforeFilter({ created_at: '2026-11-20T22:07:16Z', id: ID })).toContain(`id.lt.${ID}`);
  });
});
