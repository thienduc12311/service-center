import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicPlanField } from '@service-center/shared';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
process.env.CRON_SECRET ||= 'test-worker-secret-long-enough';

/**
 * Item details are internal running notes: the public plan view (and the
 * editor's preview of it) must never carry them, whichever fields a
 * publication allows. The fake database answers every column it has, even
 * ones not selected, so a projection that copied whole rows would leak.
 */

/** What one table's fake query returns, and the select strings it was asked for. */
interface FakeTable {
  rows: Array<Record<string, unknown>>;
  selects: string[];
}

const SECRET = 'SECRET-DETAILS-should-never-be-public';

const fake = vi.hoisted(() => ({ tables: new Map<string, FakeTable>() }));

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  const query = (table: string) => {
    const entry = fake.tables.get(table) ?? { rows: [], selects: [] };
    const result = { data: entry.rows, error: null };
    const chain = {
      select: (columns: string) => {
        entry.selects.push(columns);
        return chain;
      },
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      maybeSingle: () => Promise.resolve({ data: entry.rows[0] ?? null, error: null }),
      then: <R>(resolve: (value: typeof result) => R) => Promise.resolve(result).then(resolve),
    };
    return chain;
  };
  return { ...actual, adminDb: { from: query } };
});

const ALL_FIELDS: PublicPlanField[] = [
  'title', 'date', 'times', 'location', 'service_type', 'order', 'item_lengths', 'songs', 'song_authors', 'song_keys',
];

describe('public plan view leaves item details out', () => {
  beforeEach(() => {
    fake.tables.clear();
    fake.tables.set('plan_publications', {
      selects: [],
      rows: [{
        id: 'pub-1', organization_id: 'org-1', plan_id: 'plan-1', slug: 'sunday', fields: ALL_FIELDS,
        publish_mode: 'now', published_at: '2026-01-01T00:00:00.000Z', revoked_at: null, revision: 1,
        created_by: null, updated_by: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
      }],
    });
    fake.tables.set('plans', {
      selects: [],
      rows: [{
        id: 'plan-1', title: 'Sunday', service_date: '2026-02-01T15:00:00.000Z', status: 'published', location: null,
        service_type_id: null, organization: { name: 'Riverside', timezone: 'UTC' }, service_type: null,
      }],
    });
    fake.tables.set('plan_times', { selects: [], rows: [] });
    fake.tables.set('plan_items', {
      selects: [],
      rows: [{
        item_type: 'item', title: 'Welcome', length_seconds: 120, key_override: null, service_segment: 'service',
        song: null, arrangement: null, description: 'internal description', details: SECRET,
        item_times: [{ plan_time_id: 'time-1' }],
      }],
    });
  });

  it('never selects or returns details, even with every public field allowed', async () => {
    const { resolvePublicPlan } = await import('./publication.js');
    const projection = await resolvePublicPlan('sunday', Date.parse('2026-01-15T00:00:00.000Z'));
    expect(projection?.items?.[0]).toMatchObject({ title: 'Welcome', length_seconds: 120 });
    expect(JSON.stringify(projection)).not.toContain(SECRET);
    expect(JSON.stringify(projection)).not.toContain('internal description');
    expect(fake.tables.get('plan_items')!.selects.join(' ')).not.toMatch(/details|\*/);
  });
});
