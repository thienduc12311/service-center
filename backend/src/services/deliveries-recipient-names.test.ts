import { describe, expect, it } from 'vitest';
import type { Db } from '../lib/supabase.js';
import type { DeliveryWithJoins } from './deliveries.js';

/**
 * W10-MAIL-D1: delivery outcomes name a recipient Person through the
 * member-visible people_directory, so an administrator who is not the owner
 * (and cannot read `people`) still sees who was skipped.
 */

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const { notificationSendResult, toDeliveryOutcome } = await import('./deliveries.js');

const GUEST = '00000000-0000-4000-8000-000000000001';
const MEMBER = '00000000-0000-4000-8000-000000000002';
const EFFECT = '00000000-0000-4000-8000-000000000100';

interface DirectoryRow {
  id: string;
  first_name: string;
  last_name: string | null;
}

const delivery = (overrides: Partial<DeliveryWithJoins>): DeliveryWithJoins => ({
  id: '00000000-0000-4000-8000-000000000200',
  organization_id: '00000000-0000-4000-8000-000000000300',
  effect_id: EFFECT,
  recipient_id: null,
  recipient_person_id: GUEST,
  channel: 'email',
  status: 'skipped',
  attempts: 0,
  max_attempts: 5,
  next_attempt_at: '2026-11-22T10:00:00Z',
  lease_owner: null,
  lease_expires_at: null,
  provider_call_started_at: null,
  provider_message_id: null,
  accepted_at: null,
  delivered_at: null,
  completed_at: '2026-11-22T10:00:00Z',
  last_error_code: 'no_email_address',
  manual_retries: 0,
  locale: null,
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
  recipient: null,
  effect: { template: 'assignment_request', plan_id: null, plan: null },
  ...overrides,
});

/** Answers `deliveries` with the given rows and `people_directory` with what the caller may read. */
const fakeDb = (rows: DeliveryWithJoins[], directory: DirectoryRow[], tables: string[]): Db => {
  const query = (table: string) => {
    tables.push(table);
    let ids: string[] = [];
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      in: (_column: string, values: string[]) => {
        ids = values;
        return chain;
      },
      then: <R1, R2 = never>(
        ok?: ((value: { data: unknown; error: null }) => R1 | PromiseLike<R1>) | null,
        fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
      ): PromiseLike<R1 | R2> => {
        const data = table === 'people_directory' ? directory.filter((row) => ids.includes(row.id)) : rows;
        return Promise.resolve({ data, error: null as null }).then(ok, fail);
      },
    };
    return chain;
  };
  return { from: query } as unknown as Db;
};

describe('delivery recipient names', () => {
  it('lists a no-address Person by their directory name', async () => {
    const tables: string[] = [];
    const db = fakeDb(
      [delivery({})],
      [{ id: GUEST, first_name: 'Noemail', last_name: 'Guest' }],
      tables,
    );
    const result = await notificationSendResult(db, EFFECT);
    expect(result.skipped).toEqual(['Noemail Guest']);
    expect(result.outcomes[0]?.recipient_name).toBe('Noemail Guest');
    expect(tables).toEqual(['deliveries', 'people_directory']);
  });

  it('prefers the login name and never answers an empty string', () => {
    const names = new Map([[MEMBER, 'Directory Name']]);
    expect(
      toDeliveryOutcome(delivery({ recipient_person_id: MEMBER, recipient: { full_name: 'Login Name' } }), names)
        .recipient_name,
    ).toBe('Login Name');
    expect(
      toDeliveryOutcome(delivery({ recipient_person_id: MEMBER, recipient: { full_name: '' } }), names).recipient_name,
    ).toBe('Directory Name');
    expect(toDeliveryOutcome(delivery({ recipient_person_id: GUEST }), new Map()).recipient_name).toBeNull();
  });

  it('falls back to "Unknown person" in the skipped list only when no name is visible', async () => {
    const db = fakeDb([delivery({})], [], []);
    expect((await notificationSendResult(db, EFFECT)).skipped).toEqual(['Unknown person']);
  });
});
