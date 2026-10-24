import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError, listMediaQuerySchema, type MediaSummary } from '@service-center/shared';
import { queryKeys } from './query-keys';
import { orderWriteOutcome } from './plan-order-edit';
import { canLinkMedia, linkableMedia, mediaLinkBody, mediaListRequest, mediaSummaryLine } from './media-library';
import {
  SCAN_MAX_PAGES,
  canAddScanPage,
  moveScanPage,
  removeScanPage,
  scanFileName,
  scanPageResize,
  scanPdfHtml,
  scanPdfPrintOptions,
} from './scan-pdf';

const mobileRoot = join(__dirname, '..', '..');
const source = (path: string): string => readFileSync(join(mobileRoot, path), 'utf8');

const media = (overrides: Partial<MediaSummary> = {}): MediaSummary => ({
  id: 'm1',
  title: 'Welcome loop',
  creator: 'Media team',
  duration_seconds: 95,
  themes: ['Advent'],
  tags: [],
  notes: null,
  thumbnail_file_id: null,
  archive_on: null,
  archived_at: null,
  is_archived: false,
  revision: 2,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  usage_count: 0,
  last_used_on: null,
  ...overrides,
});

describe('media browsing and linking', () => {
  it('asks for the list exactly as the website does, valid for the server’s query schema', () => {
    expect(mediaListRequest('  ', false)).toEqual({});
    expect(mediaListRequest(' loop ', true)).toEqual({ q: 'loop', include_archived: true });
    // What the client sends as query text parses on the server.
    expect(listMediaQuerySchema.parse({ q: 'loop', include_archived: 'true' })).toEqual({ q: 'loop', include_archived: true });
  });

  it('words a row like the website picker', () => {
    expect(mediaSummaryLine(media())).toBe('Media team · 1:35 · Advent');
    expect(mediaSummaryLine(media({ creator: null, duration_seconds: null, themes: [] }))).toBe('');
  });

  it('links only regular items, for plan editors, against the plan revision shown', () => {
    expect(canLinkMedia({ item_type: 'item' }, true)).toBe(true);
    expect(canLinkMedia({ item_type: 'song' }, true)).toBe(false);
    expect(canLinkMedia({ item_type: 'header' }, true)).toBe(false);
    expect(canLinkMedia({ item_type: 'item' }, false)).toBe(false);
    expect(mediaLinkBody('6f1c1b3e-2a4d-4e5f-8a9b-0c1d2e3f4a5b', { content_revision: 7 })).toEqual({
      media_id: '6f1c1b3e-2a4d-4e5f-8a9b-0c1d2e3f4a5b',
      expected_revision: 7,
    });
    expect(mediaLinkBody(null, { content_revision: 7 })).toEqual({ media_id: null, expected_revision: 7 });
    expect(() => mediaLinkBody('not-an-id', { content_revision: 7 })).toThrow();
  });

  it('offers only active bundles in the picker', () => {
    expect(linkableMedia([media(), media({ id: 'm2', is_archived: true })]).map((row) => row.id)).toEqual(['m1']);
  });

  it('reads a refused link the way the order editor does', () => {
    expect(orderWriteOutcome(new ApiError(409, 'changed', 'plan_revision_stale'))).toBe('stale');
    expect(orderWriteOutcome(new ApiError(404, 'Item not found'))).toBe('gone');
    expect(orderWriteOutcome(new ApiError(400, 'Only a regular item can link media', 'bad_request'))).toBe('refused');
    expect(orderWriteOutcome(new TypeError('Network request failed'))).toBe('uncertain');
  });

  it('keeps media reads under the account/organization/generation root', () => {
    const scope = { generation: 3, userId: 'u', organizationId: 'o' };
    expect(queryKeys.mediaList(scope, 'loop', false).slice(0, 4)).toEqual(queryKeys.privateRoot(scope));
    expect(queryKeys.media(scope, 'm1').slice(0, 5)).toEqual(queryKeys.mediaAll(scope));
    expect(queryKeys.mediaAll({ ...scope, organizationId: 'o2' })).not.toEqual(queryKeys.mediaAll(scope));
  });
});

describe('scan pages to PDF', () => {
  it('downsizes only large photos, by the longest edge', () => {
    expect(scanPageResize(1200, 1600)).toBeNull();
    expect(scanPageResize(3024, 4032)).toEqual({ height: 2000 });
    expect(scanPageResize(4032, 3024)).toEqual({ width: 2000 });
  });

  it('reorders, removes and caps pages', () => {
    expect(moveScanPage(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveScanPage(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(removeScanPage(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    expect(canAddScanPage(Array.from({ length: SCAN_MAX_PAGES - 1 }))).toBe(true);
    expect(canAddScanPage(Array.from({ length: SCAN_MAX_PAGES }))).toBe(false);
  });

  it('puts one fitted image per US Letter page, in order, with no script and only its own image data', () => {
    const html = scanPdfHtml(['data:image/jpeg;base64,AAAA', 'https://evil.example/x.jpg', 'data:image/jpeg;base64,BBBB'], 'Scan <1>');
    expect(html.match(/<section class="page">/g)?.length).toBe(2);
    expect(html.indexOf('AAAA')).toBeLessThan(html.indexOf('BBBB'));
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('<script');
    expect(html).toContain('<title>Scan &#60;1&#62;</title>');
    expect(html).toContain('object-fit: contain');
    expect(scanPdfPrintOptions([], 'x')).toMatchObject({ width: 612, height: 792, margins: { top: 0, right: 0, bottom: 0, left: 0 } });
  });

  it('names the PDF by local date and time', () => {
    expect(scanFileName(new Date(2026, 9, 23, 7, 5))).toBe('Scan 2026-10-23 07.05.pdf');
  });
});

describe('screens use the shared contracts only', () => {
  it('uploads a scan through the MOB-026 file lifecycle, iOS only', () => {
    const add = source('app/files/add.tsx');
    expect(add).toContain("const SCAN_SUPPORTED = Platform.OS === 'ios';");
    expect(add).toContain("'media'];");
    expect(add).toContain('<ScanPages');
    // The scan becomes the picked file; the existing upload (intent → PUT → finalize) sends it.
    expect(add).toContain('setPicked(file);');
    const scan = source('src/lib/scan-capture.ts');
    expect(scan).toContain("mimeType: 'application/pdf'");
    expect(scan).not.toMatch(/api\.|fetch\(|console\.|AsyncStorage/);
  });

  it('links with setPlanItemMedia and the shown plan revision, and re-reads on refusal', () => {
    const link = source('app/plan/media/[id].tsx');
    expect(link).toContain('api.setPlanItemMedia(plan.id, item.id, mediaLinkBody(mediaId, plan))');
    expect(link).toContain('isCurrentGeneration(generation)');
    expect(link).toContain('queryKeys.plan(queryScope, plan.id)');
    const detail = source('app/media/[id].tsx');
    expect(detail).toContain("params: { ownerKind: 'media', ownerId: media.id");
    expect(detail).not.toMatch(/updateMedia|createMedia|archiveMedia|deleteMedia/);
    expect(source('app/media/index.tsx')).not.toMatch(/createMedia|updateMedia/);
  });

  it('refreshes a bundle when its files change', () => {
    expect(source('src/lib/useFileUpload.ts')).toContain('queryKeys.mediaAll(queryScope)');
  });
});
