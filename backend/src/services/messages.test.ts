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
