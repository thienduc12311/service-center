import { describe, expect, it } from 'vitest';
import {
  fileAudiencesFor,
  fileUploadOutcomeMessage,
  formatFileSize,
  parseFileDocument,
  parseFileDocumentInline,
  resolveFileMimeType,
} from './files.js';
import {
  createFileLinkSchema,
  createFileUploadIntentSchema,
  externalFileUrlSchema,
  updateFileSchema,
} from '../schemas/files.js';

const owner = { kind: 'plan' as const, id: '11111111-1111-4111-8111-111111111111' };

describe('resolveFileMimeType', () => {
  it('keeps an allowed reported type and falls back to the extension', () => {
    expect(resolveFileMimeType('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveFileMimeType('Song.CHO', '')).toBe('text/plain');
    expect(resolveFileMimeType('track.m4a', 'application/octet-stream')).toBe('audio/mp4');
  });

  it('refuses unsupported files', () => {
    expect(resolveFileMimeType('setup.exe', 'application/x-msdownload')).toBeNull();
    expect(resolveFileMimeType('page.html', 'text/html')).toBeNull();
  });
});

describe('document format', () => {
  it('parses headings, lists, paragraphs and inline emphasis', () => {
    const blocks = parseFileDocument('# Title\n\nIntro **bold** and *it*\nnext line\n\n- one\n- two\n1. first\n2) second');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      lines: [
        [
          { text: 'Intro ', bold: false, italic: false },
          { text: 'bold', bold: true, italic: false },
          { text: ' and ', bold: false, italic: false },
          { text: 'it', bold: false, italic: true },
        ],
        [{ text: 'next line', bold: false, italic: false }],
      ],
    });
    expect(blocks[3]).toMatchObject({ type: 'list', ordered: true });
  });

  it('keeps markup text literal (rendering never interprets HTML)', () => {
    expect(parseFileDocumentInline('<script>alert(1)</script> [x](javascript:y)')).toEqual([
      { text: '<script>alert(1)</script> [x](javascript:y)', bold: false, italic: false },
    ]);
    expect(parseFileDocumentInline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6', bold: false, italic: false }]);
  });
});

describe('file schemas', () => {
  it('requires targets for team/position audiences', () => {
    const base = { owner, filename: 'a.pdf', mime_type: 'application/pdf', size_bytes: 10, idempotency_key: 'k-12345678' };
    expect(createFileUploadIntentSchema.safeParse({ ...base, audience: 'teams' }).success).toBe(false);
    expect(
      createFileUploadIntentSchema.safeParse({ ...base, audience: 'teams', team_ids: [owner.id] }).success,
    ).toBe(true);
    expect(
      updateFileSchema.safeParse({ title: 'x', expected_revision: 1, audience: 'positions', position_ids: [] }).success,
    ).toBe(false);
  });

  it('refuses oversize and unsupported uploads and a replacement without a revision', () => {
    const base = { owner, filename: 'a.pdf', mime_type: 'application/pdf', idempotency_key: 'k-12345678' };
    expect(createFileUploadIntentSchema.safeParse({ ...base, size_bytes: 26_214_401 }).success).toBe(false);
    expect(createFileUploadIntentSchema.safeParse({ ...base, size_bytes: 5, mime_type: 'text/html' }).success).toBe(false);
    expect(
      createFileUploadIntentSchema.safeParse({ ...base, owner: undefined, file_id: owner.id, size_bytes: 5 }).success,
    ).toBe(false);
  });

  it('accepts only http(s) links without credentials', () => {
    expect(externalFileUrlSchema.safeParse('https://example.com/song').success).toBe(true);
    expect(externalFileUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(externalFileUrlSchema.safeParse('https://user:pw@example.com').success).toBe(false);
    expect(externalFileUrlSchema.safeParse('ftp://example.com/a').success).toBe(false);
    expect(
      createFileLinkSchema.safeParse({ owner, title: 'Ref', url: 'https://youtu.be/x', idempotency_key: 'k-12345678' }).success,
    ).toBe(true);
  });
});

describe('helpers', () => {
  it('offers the scheduled audience only on plan files', () => {
    expect(fileAudiencesFor('plan_item')).toContain('scheduled');
    expect(fileAudiencesFor('song')).not.toContain('scheduled');
  });

  it('explains every non-ready outcome', () => {
    expect(fileUploadOutcomeMessage('ready', null)).toBeNull();
    expect(fileUploadOutcomeMessage('failed', 'superseded')).toMatch(/replaced/);
    expect(fileUploadOutcomeMessage('expired', 'expired')).toMatch(/expired/);
  });

  it('formats sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
