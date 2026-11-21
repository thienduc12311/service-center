import { describe, expect, it, vi } from 'vitest';
import { FILE_DOWNLOAD_TTL_SECONDS, REPORT_EXPORT_URL_TTL_SECONDS, SONGBOOK_DOCUMENT_URL_TTL_SECONDS } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';
import { reportExportDownload } from './report-exports.js';

/** Clients renew 20 s before expiry, so a link must outlive that margin by a useful span. */
const CLIENT_RENEW_MARGIN_SECONDS = 20;

describe('signed URL lifetimes (W7-ACC-D7)', () => {
  it('keeps every download link short', () => {
    expect(FILE_DOWNLOAD_TTL_SECONDS).toBeLessThanOrEqual(60);
    expect(REPORT_EXPORT_URL_TTL_SECONDS).toBeLessThanOrEqual(60);
    expect(SONGBOOK_DOCUMENT_URL_TTL_SECONDS).toBeLessThanOrEqual(120);
  });

  it('leaves the clients time to use a link after their renewal margin', () => {
    expect(FILE_DOWNLOAD_TTL_SECONDS).toBeGreaterThan(CLIENT_RENEW_MARGIN_SECONDS * 2);
    expect(REPORT_EXPORT_URL_TTL_SECONDS).toBeGreaterThan(CLIENT_RENEW_MARGIN_SECONDS);
  });
});

interface FakeExportDb {
  db: Db;
  createSignedUrl: ReturnType<typeof vi.fn>;
}

const fakeExportDb = (row: Record<string, unknown> | null): FakeExportDb => {
  const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://storage.test/x' }, error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  const db = { from: () => chain, storage: { from: () => ({ createSignedUrl }) } } as unknown as Db;
  return { db, createSignedUrl };
};

const readyRow = {
  status: 'ready',
  kind: 'participation',
  storage_path: 'org/export.csv',
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  filters: { from: '2026-01-01', to: '2026-01-31' },
};

describe('report export download issuance', () => {
  it('signs with the caller client and the short TTL', async () => {
    const { db, createSignedUrl } = fakeExportDb(readyRow);
    const result = await reportExportDownload({ db, orgId: 'org' }, 'exp');
    expect(createSignedUrl).toHaveBeenCalledWith('org/export.csv', REPORT_EXPORT_URL_TTL_SECONDS, expect.any(Object));
    const lifetimeMs = Date.parse(result.expires_at) - Date.now();
    expect(lifetimeMs).toBeLessThanOrEqual(REPORT_EXPORT_URL_TTL_SECONDS * 1000);
  });

  it('issues nothing when the caller cannot read the export row', async () => {
    const { db, createSignedUrl } = fakeExportDb(null);
    await expect(reportExportDownload({ db, orgId: 'org' }, 'exp')).rejects.toBeInstanceOf(HttpError);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('issues nothing when Storage refuses the caller', async () => {
    const { db, createSignedUrl } = fakeExportDb(readyRow);
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(reportExportDownload({ db, orgId: 'org' }, 'exp')).rejects.toMatchObject({ status: 404 });
  });
});
