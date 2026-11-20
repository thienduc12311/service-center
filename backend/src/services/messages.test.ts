import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, SaveMessageTemplateInput, SendOperationalMessageInput } from '@service-center/shared';
import type { CollaborationCaller } from '../model/collaboration.model.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
const userId = 'cccccccc-0000-4000-8000-000000000001';
const templateId = 'bbbbbbbb-0000-4000-8000-000000000001';

type MessagesService = typeof import('./messages.js');
let service: MessagesService;
beforeAll(async () => {
  service = await import('./messages.js');
});

const callerWith = (fetchDb: typeof fetch): CollaborationCaller => ({
  db: createClient<Database>('http://db.example.test', 'test-key', {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: fetchDb },
  }),
  orgId,
  userId,
}) as CollaborationCaller;

describe('message templates', () => {
  const edit: SaveMessageTemplateInput = { name: 'Reminder', subject: 'Hi', body: 'Body', shared: true, expected_revision: 3 };

  it('answers 404, not template_stale, when the caller cannot edit a template at the current revision (W7-MSG-D7)', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PATCH') return Response.json([]);
      if (url.pathname === '/rest/v1/message_templates') return Response.json({ id: templateId, revision: 3 });
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    await expect(service.updateTemplate(callerWith(fetchDb), templateId, edit)).rejects.toMatchObject({ status: 404 });
  });

  it('still reports template_stale when the revision really moved', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PATCH') return Response.json([]);
      if (url.pathname === '/rest/v1/message_templates') return Response.json({ id: templateId, revision: 4 });
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    await expect(service.updateTemplate(callerWith(fetchDb), templateId, edit)).rejects.toMatchObject({ status: 409, code: 'template_stale' });
  });

  it('rejects sending with an archived template before calling the database function (W7-MSG-D8)', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/message_templates') return Response.json({ archived_at: '2026-11-19T00:00:00Z' });
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    const input = {
      audience: { plan_id: null, team_ids: [], include: [] },
      subject: 'Hi', body: 'Body', template_id: templateId, excluded_person_ids: [],
      audience_hash: 'hash', idempotency_key: 'key-12345678',
    } as unknown as SendOperationalMessageInput;
    await expect(service.sendMessage(callerWith(fetchDb), input)).rejects.toMatchObject({ status: 422 });
    expect(fetchDb).toHaveBeenCalledTimes(1);
  });
});

describe('message history paging (W7-MSG-D9)', () => {
  it('applies the before cursor as a keyset filter with an id tiebreak', async () => {
    const urls: URL[] = [];
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname === '/rest/v1/rpc/is_org_admin') return Response.json(true);
      if (url.pathname === '/rest/v1/operational_messages') return Response.json([]);
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    const cursor = `2026-11-20T10:00:00+00:00~${templateId}`;
    await service.listMessages(callerWith(fetchDb), { box: 'sent', limit: 5, before: cursor });
    const list = urls.find((url) => url.pathname === '/rest/v1/operational_messages');
    expect(list?.searchParams.get('or')).toBe(
      `(created_at.lt."2026-11-20T10:00:00+00:00",and(created_at.eq."2026-11-20T10:00:00+00:00",id.lt.${templateId}))`,
    );
    expect(list?.searchParams.get('order')).toBe('created_at.desc,id.desc');
  });
});

describe('recipient-safe read path (W7-MSG-D6)', () => {
  const safeRow = {
    id: templateId, organization_id: orgId, plan_id: null, subject: 'Hi', body: 'Body',
    variables: {}, created_by: 'dddddddd-0000-4000-8000-000000000001', created_at: '2026-11-20T10:00:00+00:00',
  };

  it('lists the received box through my_received_messages, never the base table', async () => {
    const paths: string[] = [];
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      if (url.pathname === '/rest/v1/rpc/my_received_messages') return Response.json([safeRow]);
      if (url.pathname === '/rest/v1/profiles') return Response.json([{ id: safeRow.created_by, full_name: 'Sender' }]);
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    const rows = await service.listMessages(callerWith(fetchDb), { box: 'received', limit: 5 });
    expect(paths).not.toContain('/rest/v1/operational_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender_name: 'Sender', sent_by_me: false });
    expect(rows[0]).not.toHaveProperty('audience');
    expect(rows[0]).not.toHaveProperty('idempotency_key');
  });

  it('serves a recipient the safe view when the base row is hidden by RLS', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/operational_messages') return Response.json(null);
      if (url.pathname === '/rest/v1/rpc/my_received_messages') return Response.json(safeRow);
      if (url.pathname === '/rest/v1/profiles') return Response.json([]);
      if (url.pathname === '/rest/v1/operational_message_recipients') return Response.json(null);
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    const detail = await service.getMessage(callerWith(fetchDb), templateId);
    expect(detail.can_retry).toBe(false);
    expect(detail.outcomes).toBeUndefined();
    expect(detail.message).not.toHaveProperty('audience_hash');
  });

  it('answers 404 when the caller neither sent nor received the message', async () => {
    const fetchDb = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/rest/v1/operational_messages') return Response.json(null);
      if (url.pathname === '/rest/v1/rpc/my_received_messages') return Response.json(null);
      throw new Error(`Unexpected call ${url.pathname}`);
    });
    await expect(service.getMessage(callerWith(fetchDb), templateId)).rejects.toMatchObject({ status: 404 });
  });
});
