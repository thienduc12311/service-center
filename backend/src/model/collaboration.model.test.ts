import { describe, expect, it } from 'vitest';
import { excerpt, groupMessageOutcomes, pageOf, type MessageOutcomeRow } from './collaboration.model.js';

describe('collaboration model', () => {
  it('pages newest-first rows into an oldest-first page with a cursor', () => {
    const rows = [
      { id: 'c', created_at: '2026-10-03T00:00:00Z' },
      { id: 'b', created_at: '2026-10-02T00:00:00Z' },
      { id: 'a', created_at: '2026-10-01T00:00:00Z' },
    ];
    expect(pageOf(rows, 2)).toEqual({
      data: [{ id: 'b', created_at: '2026-10-02T00:00:00Z' }, { id: 'c', created_at: '2026-10-03T00:00:00Z' }],
      next_before: '2026-10-02T00:00:00Z',
    });
    expect(pageOf(rows, 3).next_before).toBeNull();
  });

  it('cuts long text on a word boundary', () => {
    expect(excerpt('short')).toBe('short');
    expect(excerpt('one two three four five six', 15)).toBe('one two three…');
  });

  it('groups outcomes per recipient and marks only failed/uncertain as retryable', () => {
    const base = { first_name: 'Sam', last_name: 'Rivera', reasons: ['scheduled_confirmed'] as MessageOutcomeRow['reasons'], attempts: 1, completed_at: null, error_code: null };
    const rows: MessageOutcomeRow[] = [
      { ...base, person_id: 'p1', recipient_status: 'included', delivery_id: 'd1', channel: 'email', delivery_status: 'failed', error_code: 'provider_rejected' },
      { ...base, person_id: 'p1', recipient_status: 'included', delivery_id: 'd2', channel: 'in_app', delivery_status: 'delivered' },
      { ...base, person_id: 'p2', first_name: 'Gale', recipient_status: 'excluded_no_address', delivery_id: null, channel: null, delivery_status: null },
      { ...base, person_id: 'p3', recipient_status: 'included', delivery_id: 'd3', channel: 'email', delivery_status: 'skipped', error_code: 'no_email_address' },
    ];
    const grouped = groupMessageOutcomes(rows);
    expect(grouped.map((o) => [o.person_id, o.channels.length, o.retryable])).toEqual([
      ['p1', 2, true],
      ['p2', 0, false],
      ['p3', 1, false],
    ]);
    expect(grouped[1]?.status).toBe('excluded_no_address');
  });
});
