import { describe, expect, it } from 'vitest';
import { encodeKeysetCursor, isBeforeKeysetCursor, keysetBeforeFilter, parseKeysetCursor } from './keyset.js';
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

  it('orders rows against a cursor on (created_at, id), as the before filter does', () => {
    const at = '2026-11-20T22:07:16.512152+00:00';
    const cursor = encodeKeysetCursor({ created_at: at, id: ID });
    expect(isBeforeKeysetCursor({ created_at: at, id: ID }, cursor)).toBe(false);
    expect(isBeforeKeysetCursor({ created_at: at, id: '11111111-1111-4111-8111-111111111111' }, cursor)).toBe(true);
    expect(isBeforeKeysetCursor({ created_at: at, id: '33333333-3333-4333-8333-333333333333' }, cursor)).toBe(false);
    expect(isBeforeKeysetCursor({ created_at: '2026-11-20T22:07:16.000000+00:00', id: ID }, cursor)).toBe(true);
    // A legacy timestamp-only cursor excludes the whole timestamp.
    expect(isBeforeKeysetCursor({ created_at: at, id: '11111111-1111-4111-8111-111111111111' }, at)).toBe(false);
  });
});
