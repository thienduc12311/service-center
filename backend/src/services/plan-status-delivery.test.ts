import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryJob } from '../model/delivery.model.js';
import type { NotificationDraft } from '../model/notification.model.js';

/** One fake table: rows a query may filter by equality or membership. */
type FakeRow = Record<string, unknown>;

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-that-is-long-enough';
  return {
    tables: {} as Record<string, FakeRow[]>,
    reminderCurrent: true,
    feed: vi.fn(async (drafts: NotificationDraft[]) => drafts),
  };
});

vi.mock('../lib/supabase.js', () => {
  const query = (table: string) => {
    let rows = [...(fixture.tables[table] ?? [])];
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => { rows = rows.filter((row) => row[column] === undefined || row[column] === value); return builder; },
      in: (column: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[column])); return builder; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (value: { data: FakeRow[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  };
  return {
    adminDb: { from: query, rpc: async () => ({ data: fixture.reminderCurrent, error: null }) },
    raw: (value: unknown) => value,
    unwrap: async (response: PromiseLike<{ data: unknown }>) => (await response).data,
  };
});
vi.mock('./organization-platform.js', () => ({ isOrganizationDisabled: async () => false }));
vi.mock('./notification-center.js', () => ({ ensureFeedRows: fixture.feed, unreadCount: async () => 0 }));

import { dispatchDelivery } from './delivery-dispatch.js';

const job: DeliveryJob = {
  id: 'job', organizationId: 'org', effectId: 'effect', recipientId: 'recipient',
  recipientPersonId: 'person', channel: 'in_app', attempts: 1, maxAttempts: 5,
  leaseOwner: 'worker', locale: 'en',
};

const plan = (id: string, status: string): FakeRow => ({
  id, organization_id: 'org', title: `Plan ${id}`, service_date: '2099-01-04T15:00:00Z', location: null, status,
});

const assignment = (id: string, planId: string, status = 'unconfirmed'): FakeRow => ({
  id, plan_id: planId, person_id: 'person', status, visibility: 'released', response_owner_id: null,
  team: { name: 'Band' }, position: null,
});

const effect = (template: string, planId: string | null, assignmentIds: string[], extra: FakeRow = {}): FakeRow => ({
  id: 'effect', organization_id: 'org', template, plan_id: planId, assignment_ids: assignmentIds,
  created_by: 'scheduler', ...extra,
});

beforeEach(() => {
  fixture.feed.mockClear();
  fixture.reminderCurrent = true;
  fixture.tables = {
    people: [{ id: 'person', organization_id: 'org', profile_id: 'recipient', archived_at: null }],
    organization_members: [{ organization_id: 'org', user_id: 'recipient', status: 'active' }],
    plans: [plan('p1', 'published')],
    assignments: [assignment('a1', 'p1')],
    delivery_effects: [effect('assignment_request', 'p1', ['a1'])],
  };
});

describe('ADR-0006: assignment messages re-check the plan status at send time', () => {
  it('sends a request for a published plan', async () => {
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'delivered' });
    expect(fixture.feed).toHaveBeenCalledOnce();
  });

  it.each(['draft', 'archived'])('cancels a request on a %s plan on every channel', async (status) => {
    fixture.tables.plans = [plan('p1', status)];
    for (const channel of ['email', 'in_app', 'push'] as const) {
      expect(await dispatchDelivery({ ...job, channel }, vi.fn())).toEqual({
        status: 'cancelled', errorCode: 'plan_not_published',
      });
    }
    expect(fixture.feed).not.toHaveBeenCalled();
  });

  it('cancels a time-change re-notify once the plan is back to draft', async () => {
    fixture.tables.plans = [plan('p1', 'draft')];
    fixture.tables.assignments = [assignment('a1', 'p1', 'confirmed')];
    expect(await dispatchDelivery({ ...job, channel: 'email' }, vi.fn())).toEqual({
      status: 'cancelled', errorCode: 'plan_not_published',
    });
  });

  it.each([
    ['assignment_reminder', 'unconfirmed'],
    ['service_reminder', 'confirmed'],
  ])('cancels a %s for a draft plan as not published, not as obsolete', async (template, status) => {
    fixture.tables.plans = [plan('p1', 'draft')];
    fixture.tables.assignments = [assignment('a1', 'p1', status)];
    fixture.tables.delivery_effects = [effect(template, 'p1', ['a1'], { reminder_job_id: 'job-1' })];
    fixture.reminderCurrent = false;
    expect(await dispatchDelivery({ ...job, channel: 'email' }, vi.fn())).toEqual({
      status: 'cancelled', errorCode: 'plan_not_published',
    });
  });

  it('keeps only the published plans of a multi-plan release', async () => {
    fixture.tables.plans = [plan('p1', 'published'), plan('p2', 'draft')];
    fixture.tables.assignments = [assignment('a1', 'p1'), assignment('a2', 'p2')];
    fixture.tables.delivery_effects = [effect('assignment_request', null, ['a1', 'a2'], { release_batch_id: 'batch' })];
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'delivered' });
    const drafts = fixture.feed.mock.calls[0]?.[0] ?? [];
    expect(drafts.map((draft) => draft.planId)).toEqual(['p1']);
  });

  it('cancels a multi-plan release when none of its plans is published', async () => {
    fixture.tables.plans = [plan('p1', 'draft'), plan('p2', 'archived')];
    fixture.tables.assignments = [assignment('a1', 'p1'), assignment('a2', 'p2')];
    fixture.tables.delivery_effects = [effect('assignment_request', null, ['a1', 'a2'], { release_batch_id: 'batch' })];
    expect(await dispatchDelivery(job, vi.fn())).toEqual({ status: 'cancelled', errorCode: 'plan_not_published' });
  });
});
