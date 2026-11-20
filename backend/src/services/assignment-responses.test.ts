import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  AssignmentRequestSnapshotItemRow,
  AssignmentRequestSnapshotRow,
  AssignmentRow,
  AssignmentStatus,
  AssignmentTimeResponseRow,
  Database,
  PlanTimeRow,
  ScheduleDelegationRow,
} from '@service-center/shared';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

type ResponsesModule = typeof import('./assignment-responses.js');
type Db = import('../lib/supabase.js').Db;
type AvailabilityContext = import('./availability.js').AvailabilityContext;

let createResponses: ResponsesModule['createResponses'];
let latestDeclineReasons: ResponsesModule['latestDeclineReasons'];
beforeAll(async () => {
  ({ createResponses, latestDeclineReasons } = await import('./assignment-responses.js'));
});

// ----------------------------------------------------- fake PostgREST -----

/** One request a client sent, decoded. */
interface DbCall {
  /** Table name, or `rpc/<function>`. */
  target: string;
  method: string;
  params: URLSearchParams;
  body: unknown;
}

/** What the fake database answers: rows (shaped to the request), or a PostgREST error. */
type DbReply =
  | { rows: unknown }
  | { error: { code: string; message: string; details?: string | null; hint?: string | null }; status: number };

type DbHandler = (call: DbCall) => DbReply;

interface FakeDatabase {
  db: Db;
  calls: DbCall[];
  targets: () => string[];
}

/**
 * A real supabase-js client whose `fetch` is answered in-process, so the
 * module's queries go through PostgREST's real request encoding.
 */
const fakeDatabase = (handler: DbHandler): FakeDatabase => {
  const calls: DbCall[] = [];
  const fetchDb = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const call: DbCall = {
      target: url.pathname.replace('/rest/v1/', ''),
      method: init?.method ?? 'GET',
      params: url.searchParams,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = handler(call);
    if ('error' in reply) return Response.json(reply.error, { status: reply.status });
    // `.single()` asks for one object; everything else reads an array.
    const accept = new Headers(init?.headers).get('Accept') ?? '';
    const wantsObject = accept.includes('vnd.pgrst.object');
    const body = wantsObject && Array.isArray(reply.rows) ? reply.rows[0] : reply.rows;
    return Response.json(body);
  });
  const db = createClient<Database>('http://db.example.test', 'test-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchDb },
  });
  return { db, calls, targets: () => calls.map((call) => call.target) };
};

const unexpected = (call: DbCall): never => {
  throw new Error(`Unexpected database call: ${call.method} ${call.target}`);
};

const pgError = (code: string, message: string, extra: { details?: string; hint?: string } = {}, status = 409): DbReply => ({
  error: { code, message, details: extra.details ?? null, hint: extra.hint ?? null },
  status,
});

/** The delivery dependency, recording every effect it was handed. */
interface DeliveryRecorder {
  delivered: string[];
  deliver: (effectId: string) => Promise<void>;
}

const deliveryRecorder = (fail = false): DeliveryRecorder => {
  const delivered: string[] = [];
  return {
    delivered,
    deliver: async (effectId) => {
      delivered.push(effectId);
      if (fail) throw new Error('provider down');
    },
  };
};

interface Harness {
  user: FakeDatabase;
  service: FakeDatabase;
  delivery: DeliveryRecorder;
  responses: ReturnType<ResponsesModule['createResponses']>;
}

const harness = (handlers: { user?: DbHandler; service?: DbHandler; failDelivery?: boolean }): Harness => {
  const user = fakeDatabase(handlers.user ?? unexpected);
  const service = fakeDatabase(handlers.service ?? unexpected);
  const delivery = deliveryRecorder(handlers.failDelivery);
  return { user, service, delivery, responses: createResponses({ serviceDb: service.db, deliver: delivery.deliver }) };
};

// ------------------------------------------------------------ fixtures ----

const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
const userId = 'cccccccc-0000-4000-8000-000000000001';
const assignmentId = 'dddddddd-0000-4000-8000-000000000001';
const planId = 'eeeeeeee-0000-4000-8000-000000000001';
const personId = 'ffffffff-0000-4000-8000-000000000001';
const snapshotId = '99999999-0000-4000-8000-000000000001';
const timeId = '88888888-0000-4000-8000-000000000001';

const assignment = (status: AssignmentStatus): AssignmentRow => ({
  id: assignmentId,
  plan_id: planId,
  person_id: personId,
  user_id: userId,
  team_id: 'team-1',
  position_id: 'position-1',
  status,
  notes: 'Bring your in-ears',
  notified_at: null,
  responded_at: null,
  created_by: 'scheduler-1',
  visibility: 'released',
  released_at: '2026-10-01T00:00:00.000Z',
  released_by: 'scheduler-1',
  response_owner_id: 'scheduler-1',
  attendance_mode: 'all',
  request_revision: 3,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
});

const snapshot: AssignmentRequestSnapshotRow = {
  id: snapshotId,
  organization_id: orgId,
  person_id: personId,
  plan_id: planId,
  effect_id: null,
  version: 2,
  expires_at: '2026-12-01T00:00:00.000Z',
  consumed_at: null,
  superseded_at: null,
  created_by: userId,
  created_at: '2026-11-01T00:00:00.000Z',
};

const serviceTime: PlanTimeRow = {
  id: timeId,
  plan_id: planId,
  kind: 'service',
  name: null,
  starts_at: '2026-11-29T16:00:00.000Z',
  ends_at: '2026-11-29T17:30:00.000Z',
  ics_sequence: 0,
  revision: 1,
  sort_order: 0,
  created_at: '2026-11-01T00:00:00.000Z',
};

const timeResponse: AssignmentTimeResponseRow = {
  assignment_id: assignmentId,
  plan_time_id: timeId,
  status: 'confirmed',
  response_note: null,
  actor_id: userId,
  responded_at: '2026-11-02T00:00:00.000Z',
};

/** A snapshot item as `assignment_request_snapshot_items` returns it with its joins. */
const snapshotItem = {
  snapshot_id: snapshotId,
  assignment_id: assignmentId,
  expected_request_revision: 3,
  expected_status: 'unconfirmed',
  plan_time_ids: [timeId],
  assignment: {
    id: assignmentId,
    plan_id: planId,
    status: 'unconfirmed',
    request_revision: 3,
    team: { name: 'Band' },
    position: { name: 'Bass' },
    plan: { title: 'Sunday Morning' },
    time_responses: [timeResponse, { ...timeResponse, plan_time_id: 'some-other-time' }],
  },
} satisfies AssignmentRequestSnapshotItemRow & Record<'assignment', unknown>;

const expectedReviewItem = {
  assignment_id: assignmentId,
  plan_id: planId,
  plan_title: 'Sunday Morning',
  team_name: 'Band',
  position_name: 'Bass',
  status: 'unconfirmed',
  request_revision: 3,
  times: [serviceTime],
  time_responses: [timeResponse],
};

/** Answers the two review reads, which always go through the service role. */
const reviewReads = (call: DbCall): DbReply | null => {
  if (call.target === 'assignment_request_snapshot_items') return { rows: [snapshotItem] };
  if (call.target === 'plan_times') return { rows: [serviceTime] };
  return null;
};

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

// --------------------------------------------------------- signed in ------

describe('respondAsSelf', () => {
  const input = (db: Db) => ({
    db,
    orgId,
    assignmentId,
    status: 'declined' as const,
    reason: 'Travelling',
    expectedStatus: 'confirmed' as const,
  });

  it('answers in one database call and delivers the effect recorded with it', async () => {
    const h = harness({
      user: (call) =>
        call.target === 'rpc/respond_as_self'
          ? { rows: [{ assignment: assignment('declined'), transition: 'withdrawal', effect_id: 'effect-1' }] }
          : unexpected(call),
    });

    const updated = await h.responses.respondAsSelf(input(h.user.db));

    expect(updated).toEqual(assignment('declined'));
    expect(h.user.calls[0]!.body).toEqual({
      p_organization_id: orgId,
      p_assignment_id: assignmentId,
      p_status: 'declined',
      p_expected_status: 'confirmed',
      p_reason: 'Travelling',
    });
    expect(h.delivery.delivered).toEqual(['effect-1']);
    expect(h.service.calls).toHaveLength(0);
  });

  it('treats a retry of an answer that already committed as a success that delivers nothing', async () => {
    const h = harness({
      user: () => ({ rows: [{ assignment: assignment('confirmed'), transition: 'unchanged', effect_id: null }] }),
    });
    const updated = await h.responses.respondAsSelf({ ...input(h.user.db), status: 'confirmed', reason: null, expectedStatus: 'unconfirmed' });
    expect(updated.status).toBe('confirmed');
    expect(h.delivery.delivered).toEqual([]);
  });

  it('sends no expected status when the client did not give one', async () => {
    const h = harness({
      user: () => ({ rows: [{ assignment: assignment('confirmed'), transition: 'answer', effect_id: 'effect-2' }] }),
    });
    await h.responses.respondAsSelf({ ...input(h.user.db), status: 'confirmed', reason: null, expectedStatus: undefined });
    expect(h.user.calls[0]!.body).toMatchObject({ p_expected_status: null, p_reason: null });
  });

  it('reports a stale answer with the current status', async () => {
    const h = harness({
      user: () => pgError('PT409', 'changed', { hint: 'assignment_response_stale', details: 'unconfirmed' }),
    });
    await expect(h.responses.respondAsSelf(input(h.user.db))).rejects.toMatchObject({
      status: 409,
      code: 'assignment_response_stale',
      details: { status: 'unconfirmed' },
    });
    expect(h.delivery.delivered).toEqual([]);
  });

  it('never re-accepts a declined assignment', async () => {
    const h = harness({ user: () => pgError('PT409', 'declined', { hint: 'assignment_response_forbidden' }) });
    await expect(h.responses.respondAsSelf({ ...input(h.user.db), status: 'confirmed', reason: null })).rejects.toMatchObject({
      status: 409,
      code: 'assignment_response_forbidden',
    });
  });

  it("refuses someone else's assignment, and one outside the organization", async () => {
    const notOwn = harness({ user: () => pgError('42501', 'not yours', { hint: 'assignment_not_own' }, 403) });
    await expect(notOwn.responses.respondAsSelf(input(notOwn.user.db))).rejects.toMatchObject({
      status: 403,
      message: 'You can only respond to your own assignments',
    });
    const missing = harness({ user: () => pgError('P0002', 'Assignment not found', {}, 400) });
    await expect(missing.responses.respondAsSelf(input(missing.user.db))).rejects.toMatchObject({ status: 404 });
  });

  it('never turns a committed answer into an error when delivery fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({
      user: () => ({ rows: [{ assignment: assignment('declined'), transition: 'withdrawal', effect_id: 'effect-3' }] }),
      failDelivery: true,
    });
    await expect(h.responses.respondAsSelf(input(h.user.db))).resolves.toEqual(assignment('declined'));
    expect(h.delivery.delivered).toEqual(['effect-3']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

// ------------------------------------------------------- respond link -----

describe('respondViaLink', () => {
  it('answers with the hashed token through the service role and delivers the scheduler update', async () => {
    const h = harness({
      service: (call) =>
        call.target === 'rpc/respond_via_assignment_link'
          ? { rows: [{ outcome: 'ok', assignments_updated: 2, effect_id: 'effect-link' }] }
          : unexpected(call),
    });

    const result = await h.responses.respondViaLink({ token: 'live-token', status: 'confirmed' });

    expect(result).toEqual({ status: 'confirmed', assignments_updated: 2 });
    expect(h.service.calls[0]!.body).toEqual({ p_token_hash: sha256('live-token'), p_status: 'confirmed' });
    expect(h.delivery.delivered).toEqual(['effect-link']);
  });

  it.each([
    ['not_found', 404, 'not_found'],
    ['used', 410, 'assignment_notification_used'],
    ['expired', 410, 'assignment_notification_expired'],
    ['stale', 409, 'assignment_request_stale'],
  ] as const)('refuses a link whose outcome is %s', async (outcome, status, code) => {
    const h = harness({ service: () => ({ rows: [{ outcome, assignments_updated: 0, effect_id: null }] }) });
    await expect(h.responses.respondViaLink({ token: 't', status: 'declined' })).rejects.toMatchObject({ status, code });
    expect(h.delivery.delivered).toEqual([]);
  });

  it('reads an empty answer as an invalid link', async () => {
    const h = harness({ service: () => ({ rows: [] }) });
    await expect(h.responses.respondViaLink({ token: 't', status: 'declined' })).rejects.toMatchObject({ status: 404 });
  });
});

// ----------------------------------------------------------- delegate -----

describe('respondAsDelegate', () => {
  const delegationId = '77777777-0000-4000-8000-000000000001';
  const delegatePersonId = '77777777-0000-4000-8000-000000000002';
  const delegation: ScheduleDelegationRow = {
    id: delegationId,
    organization_id: orgId,
    target_person_id: personId,
    delegate_person_id: delegatePersonId,
    granted_by: null,
    can_respond: true,
    can_view_schedule: true,
    can_manage_availability: false,
    can_signup: false,
    expires_at: null,
    revoked_at: null,
    revoked_by: null,
    created_at: '2026-11-01T00:00:00.000Z',
  };

  /** The delegation reads, with the caller as `me`; `rpc` answers the answer itself. */
  const delegateDb = (me: string, rpc: (call: DbCall) => DbReply): DbHandler => (call) => {
    switch (call.target) {
      case 'schedule_delegations':
        return { rows: [delegation] };
      case 'people_directory':
        return { rows: [{ id: personId, first_name: 'Sam', last_name: null }] };
      case 'people':
        return { rows: [{ id: me }] };
      case 'rpc/respond_as_delegate':
        return rpc(call);
      default:
        return unexpected(call);
    }
  };

  const ctx = (db: Db): AvailabilityContext => ({ db, orgId, userId, access: null });
  const command = {
    delegationId,
    assignmentId,
    status: 'declined' as const,
    expectedStatus: 'unconfirmed' as const,
    reason: '  Away  ',
  };

  it("answers for the person who granted the delegation and delivers the update", async () => {
    const h = harness({
      user: delegateDb(delegatePersonId, () => ({
        rows: [{ assignment_id: assignmentId, status: 'declined', transition: 'response', effect_id: 'effect-delegate' }],
      })),
    });

    const result = await h.responses.respondAsDelegate(ctx(h.user.db), command);

    expect(result).toEqual({ assignment_id: assignmentId, status: 'declined', transition: 'response' });
    expect(h.user.calls.find((call) => call.target === 'rpc/respond_as_delegate')!.body).toEqual({
      p_organization_id: orgId,
      p_person_id: personId,
      p_assignment_id: assignmentId,
      p_status: 'declined',
      p_expected_status: 'unconfirmed',
      p_reason: 'Away',
    });
    expect(h.delivery.delivered).toEqual(['effect-delegate']);
  });

  it('drops a reason that does not accompany a decline, and delivers nothing when unchanged', async () => {
    const h = harness({
      user: delegateDb(delegatePersonId, () => ({
        rows: [{ assignment_id: assignmentId, status: 'confirmed', transition: 'unchanged', effect_id: null }],
      })),
    });
    await h.responses.respondAsDelegate(ctx(h.user.db), { ...command, status: 'confirmed' });
    expect(h.user.calls.find((call) => call.target === 'rpc/respond_as_delegate')!.body).toMatchObject({ p_reason: null });
    expect(h.delivery.delivered).toEqual([]);
  });

  it('reports a changed request as a stale response', async () => {
    const h = harness({
      user: delegateDb(delegatePersonId, () => pgError('PT409', 'This request changed; refresh and try again')),
    });
    await expect(h.responses.respondAsDelegate(ctx(h.user.db), command)).rejects.toMatchObject({
      status: 409,
      code: 'assignment_response_stale',
    });
  });

  it('reports re-accepting a declined request as forbidden, not stale', async () => {
    const h = harness({
      user: delegateDb(delegatePersonId, () => pgError('PT409', 'A declined request needs a new scheduler request')),
    });
    await expect(
      h.responses.respondAsDelegate(ctx(h.user.db), { ...command, status: 'confirmed', expectedStatus: 'declined' }),
    ).rejects.toMatchObject({ status: 409, code: 'assignment_response_forbidden' });
  });

  it('refuses a delegation the caller gave rather than received', async () => {
    const h = harness({ user: delegateDb(personId, unexpected) });
    await expect(h.responses.respondAsDelegate(ctx(h.user.db), command)).rejects.toMatchObject({ status: 404 });
    expect(h.user.targets()).not.toContain('rpc/respond_as_delegate');
  });
});

// ------------------------------------------- Request Snapshot commit ------

describe('commitSnapshotResponses', () => {
  it('commits through the caller and delivers every recorded effect', async () => {
    const committed = {
      snapshots: [{ snapshot_id: snapshotId, assignments_updated: 1 }],
      effect_ids: ['effect-a', 'effect-b'],
    };
    const h = harness({
      user: (call) => (call.target === 'rpc/respond_to_assignment_snapshots' ? { rows: committed } : unexpected(call)),
    });
    const responses = [
      {
        snapshot_id: snapshotId,
        version: 2,
        answers: [{ assignment_id: assignmentId, plan_time_id: timeId, status: 'confirmed' as const, reason: null }],
      },
    ];

    const result = await h.responses.commitSnapshotResponses({ db: h.user.db, orgId }, { responses, idempotency_key: 'key-1' });

    expect(result).toEqual(committed);
    expect(h.user.calls[0]!.body).toEqual({ p_organization_id: orgId, p_responses: responses, p_idempotency_key: 'key-1' });
    expect([...h.delivery.delivered].sort()).toEqual(['effect-a', 'effect-b']);
  });
});

// ------------------------------------------------------------ previews ----

describe('previewSnapshots', () => {
  it('freezes the requests through the caller, then reads each review', async () => {
    const h = harness({
      user: (call) => (call.target === 'rpc/preview_assignment_responses' ? { rows: [snapshot] } : unexpected(call)),
      service: (call) => reviewReads(call) ?? unexpected(call),
    });

    const reviews = await h.responses.previewSnapshots({ db: h.user.db, orgId }, [assignmentId]);

    expect(reviews).toEqual([
      {
        snapshot_id: snapshotId,
        version: 2,
        person_id: personId,
        plan_id: planId,
        expires_at: snapshot.expires_at,
        assignments: [expectedReviewItem],
      },
    ]);
    expect(h.user.calls[0]!.body).toEqual({ p_organization_id: orgId, p_assignment_ids: [assignmentId] });
    expect(h.service.calls.find((call) => call.target === 'assignment_request_snapshot_items')!.params.get('snapshot_id'))
      .toBe(`eq.${snapshotId}`);
  });

  it('reads nothing with the service role when the caller reached no snapshot', async () => {
    const h = harness({ user: () => ({ rows: [] }) });
    expect(await h.responses.previewSnapshots({ db: h.user.db, orgId }, [assignmentId])).toEqual([]);
    expect(h.service.calls).toHaveLength(0);
  });
});

describe('previewLink', () => {
  const notification = {
    id: 'notification-1',
    plan_id: planId,
    organization_id: orgId,
    person_id: personId,
    user_id: userId,
    snapshot_id: snapshotId,
    email: 'sam@example.test',
    expires_at: '2099-01-01T00:00:00.000Z',
    responded_at: null as string | null,
    token_hash: sha256('live-token'),
    previous_token_hash: sha256('older-token'),
    previous_snapshot_id: '99999999-0000-4000-8000-000000000000',
    previous_expires_at: '2098-01-01T00:00:00.000Z',
  };

  const linkDb = (stored: typeof notification | null, snapshotRow: AssignmentRequestSnapshotRow | null = snapshot): DbHandler =>
    (call) => {
      switch (call.target) {
        case 'assignment_notifications':
          return { rows: stored ? [stored] : [] };
        case 'plans':
          return { rows: [{ title: 'Sunday Morning', service_date: '2026-11-29', location: 'Main hall' }] };
        case 'people':
          return { rows: [{ first_name: 'Sam', preferred_language: 'vi' }] };
        case 'assignment_request_snapshots':
          return { rows: snapshotRow ? [snapshotRow] : [] };
        default:
          return reviewReads(call) ?? unexpected(call);
      }
    };

  it('shows the requests the link was issued for', async () => {
    const h = harness({ service: linkDb(notification) });

    const preview = await h.responses.previewLink('live-token');

    expect(preview).toEqual({
      snapshot_id: snapshotId,
      snapshot_version: 2,
      plan_title: 'Sunday Morning',
      service_date: '2026-11-29',
      service_time: { starts_at: serviceTime.starts_at, ends_at: serviceTime.ends_at },
      location: 'Main hall',
      person_first_name: 'Sam',
      preferred_language: 'vi',
      assignments: [
        {
          assignment_id: assignmentId,
          team_name: 'Band',
          position_name: 'Bass',
          status: 'unconfirmed',
          request_revision: 3,
          times: [serviceTime],
          time_responses: [timeResponse],
        },
      ],
      expires_at: notification.expires_at,
    });
    expect(h.service.calls[0]!.params.get('or')).toBe(
      `(token_hash.eq.${sha256('live-token')},previous_token_hash.eq.${sha256('live-token')})`,
    );
    expect(h.user.calls).toHaveLength(0);
    expect(h.delivery.delivered).toEqual([]);
  });

  it("honours the previous token with that token's own snapshot and expiry", async () => {
    const h = harness({ service: linkDb(notification) });
    const preview = await h.responses.previewLink('older-token');
    expect(preview.expires_at).toBe(notification.previous_expires_at);
    expect(h.service.calls.find((call) => call.target === 'assignment_request_snapshots')!.params.get('id')).toBe(
      `eq.${notification.previous_snapshot_id}`,
    );
  });

  it.each([
    ['an unknown link', null, 404, 'not_found'],
    ['a used link', { ...notification, responded_at: '2026-11-03T00:00:00.000Z' }, 410, 'assignment_notification_used'],
    ['an expired link', { ...notification, expires_at: '2020-01-01T00:00:00.000Z' }, 410, 'assignment_notification_expired'],
    ['a link issued before snapshots', { ...notification, snapshot_id: null }, 409, 'assignment_request_stale'],
  ] as const)('refuses %s without reading the review', async (_label, stored, status, code) => {
    const h = harness({ service: linkDb(stored as typeof notification | null) });
    await expect(h.responses.previewLink('live-token')).rejects.toMatchObject({ status, code });
    expect(h.service.targets()).not.toContain('assignment_request_snapshot_items');
  });

  it('refuses a link whose request changed since it was sent', async () => {
    const h = harness({ service: linkDb(notification, { ...snapshot, superseded_at: '2026-11-04T00:00:00.000Z' }) });
    await expect(h.responses.previewLink('live-token')).rejects.toMatchObject({
      status: 409,
      code: 'assignment_request_stale',
    });
    expect(h.service.targets()).not.toContain('assignment_request_snapshot_items');
  });
});

// ------------------------------------------------------ decline reasons ---

describe('latestDeclineReasons', () => {
  it('uses only the most recent decline, even when it had no reason', async () => {
    const { db, calls } = fakeDatabase(() => ({
      rows: [
        { assignment_id: 'a1', response_note: null, created_at: '2026-10-10T00:00:00.000Z' },
        { assignment_id: 'a1', response_note: 'Old reason', created_at: '2026-10-01T00:00:00.000Z' },
        { assignment_id: 'a2', response_note: 'Travelling', created_at: '2026-10-05T00:00:00.000Z' },
      ],
    }));

    const reasons = await latestDeclineReasons(db, ['a1', 'a2']);
    expect([...reasons]).toEqual([['a2', 'Travelling']]);
    expect(calls[0]!.target).toBe('assignment_responses');
    expect(calls[0]!.params.get('order')).toBe('created_at.desc');
    expect(calls[0]!.params.get('status')).toBe('eq.declined');
  });

  it('does not query for an empty list', async () => {
    const { db, calls } = fakeDatabase(unexpected);
    expect((await latestDeclineReasons(db, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
