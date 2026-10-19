import { describe, expect, it } from 'vitest';
import { parseImportCsv } from './import-csv.js';
import { importPreviewRequestSchema, IMPORT_MAX_BYTES, importUtf8Length } from '../schemas/imports.js';
const request = { kind: 'songs', filename: 'songs.csv', content_type: 'text/csv', content: 'Title\nHope', mapping: { title: 'Title' }, resolutions: [] };
describe('bounded CSV import', () => {
  it('reads UTF-8 BOM, CRLF, quoted commas, multiline cells and escaped quotes', () => {
    expect(parseImportCsv('\uFEFFTitle,Notes\r\n"Hope, again","line one\n""two"""\r\n')).toEqual({ headers: ['Title', 'Notes'], rows: [['Hope, again', 'line one\n"two"']] });
  });
  it('counts UTF-8 bytes including astral characters without browser-only encoders', () => {
    expect(importUtf8Length('Aé界😀')).toBe(10);
  });
  it('rejects malformed quoting, uneven rows and duplicate/blank headers', () => {
    for (const value of ['Title\n"unfinished', 'Title\nx"oops', 'Title\n"x"junk', 'Title,Title\nx,y', 'Title,\nx,y', 'A,B\nx', 'Title\n']) {
      expect(() => parseImportCsv(value)).toThrow();
    }
  });
  it('bounds bytes, data records, columns and cell lengths', () => {
    for (const value of ['Title\n' + 'é'.repeat(IMPORT_MAX_BYTES / 2), 'Title\n' + Array(101).fill('x').join('\n'), Array.from({ length: 33 }, (_, i) => `C${i}`).join(',') + '\n' + Array(33).fill('x').join(','), 'Title\n' + 'x'.repeat(10_001)]) {
      expect(() => parseImportCsv(value)).toThrow();
    }
    expect(parseImportCsv('Title\n' + Array(100).fill('x').join('\n')).rows).toHaveLength(100);
  });
  it('rejects unsupported files, protected fields, duplicate mappings and resolutions', () => {
    for (const patch of [{ filename: 'songs.pdf' }, { content_type: 'application/pdf' }, { mapping: { profile_id: 'Title' } }, { mapping: { title: 'Title', author: 'Title' } }, { resolutions: [{ row: 2, action: 'update' }] }, { resolutions: [{ row: 2, action: 'skip' }, { row: 2, action: 'skip' }] }]) {
      expect(importPreviewRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
    }
  });
  it('rejects invalid Unicode and NUL; creates no document parser', () => {
    for (const content of ['Title\nx\0', 'Title\n\ud800', 'Title\n\udc00']) expect(importPreviewRequestSchema.safeParse({ ...request, content }).success).toBe(false);
    expect(importPreviewRequestSchema.safeParse(request).success).toBe(true);
  });
});
