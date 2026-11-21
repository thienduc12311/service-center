import { describe, expect, it, vi } from 'vitest';
import type { CreateFileUploadIntentInput } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const { createUploadIntent } = await import('./files.js');

/** W8-RES-D7: an intent is never answered as a success without an upload target. */

const ORG = '11111111-1111-4111-8111-111111111111';
const FILE = '22222222-2222-4222-8222-222222222222';
const VERSION = '33333333-3333-4333-8333-333333333333';
const PATH = `${ORG}/${FILE}/${VERSION}`;

const attachment = {
  id: FILE, organization_id: ORG, current_version_id: null, plan_id: null, song_id: null, kind: 'upload', title: 'Chart',
  category: 'other', audience: 'organization', created_at: '2026-11-20T00:00:00Z',
};
const version = {
  id: VERSION, attachment_id: FILE, status: 'pending', storage_path: PATH, filename: 'a.pdf', mime_type: 'application/pdf',
  size_bytes: null, declared_size: 10, failure_reason: null, upload_expires_at: '2026-11-21T00:00:00Z',
  created_at: '2026-11-20T00:00:00Z', created_by: null, finalized_at: null, version_number: null,
};

interface FakeStorage {
  createSignedUploadUrl: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
}

const fakeDb = (replayed: boolean, storage: FakeStorage): Db => {
  const rows: Record<string, unknown> = { attachments: attachment, attachment_versions: [version], attachment_audience_targets: [], plans: { id: 'plan' } };
  const from = (table: string) => {
    const chain: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve({ data: rows[table], error: null }),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows[table], error: null }).then(resolve, reject),
    };
    for (const method of ['select', 'eq', 'in', 'order']) chain[method] = () => chain;
    return chain;
  };
  const rpc = (name: string) =>
    Promise.resolve(
      name === 'create_file_upload_intent'
        ? { data: { attachment, version, replayed }, error: null }
        : { data: [FILE], error: null },
    );
  return { from, rpc, storage: { from: () => storage } } as unknown as Db;
};

const input = {
  owner: { kind: 'plan', id: '44444444-4444-4444-8444-444444444444' },
  filename: 'a.pdf',
  mime_type: 'application/pdf',
  size_bytes: 10,
  idempotency_key: 'upload-key-0001',
} as unknown as CreateFileUploadIntentInput;

const failingStorage = (exists: boolean): FakeStorage => ({
  createSignedUploadUrl: vi.fn().mockResolvedValue({ data: null, error: { message: 'storage down' } }),
  exists: vi.fn().mockResolvedValue({ data: exists, error: null }),
});

describe('createUploadIntent when the signed upload URL cannot be created', () => {
  const caller = (replayed: boolean, storage: FakeStorage) => ({ db: fakeDb(replayed, storage), orgId: ORG });

  it('fails a first-time intent with a retryable 503', async () => {
    await expect(createUploadIntent(caller(false, failingStorage(false)), input))
      .rejects.toMatchObject({ status: 503, code: 'storage_unavailable' });
  });

  it('fails a replay whose object is absent with the same 503, not upload: null', async () => {
    await expect(createUploadIntent(caller(true, failingStorage(false)), input))
      .rejects.toMatchObject({ status: 503, code: 'storage_unavailable' });
  });

  it('still answers a replay whose bytes are already stored without a target', async () => {
    const result = await createUploadIntent(caller(true, failingStorage(true)), input);
    expect(result.upload).toBeNull();
    expect(result.replayed).toBe(true);
  });

  it('returns the upload target when signing works', async () => {
    const storage: FakeStorage = {
      createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { path: PATH, token: 't', signedUrl: 'https://s/x' }, error: null }),
      exists: vi.fn(),
    };
    const result = await createUploadIntent(caller(true, storage), input);
    expect(result.upload?.token).toBe('t');
    expect(storage.exists).not.toHaveBeenCalled();
  });
});
