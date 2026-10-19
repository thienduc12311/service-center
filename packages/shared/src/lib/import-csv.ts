import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, importUtf8Length } from '../schemas/imports.js';
export interface ParsedImportCsv { headers: string[]; rows: string[][] }
/** Strict comma-separated UTF-8 text, including quoted newlines and escaped quotes. */
export function parseImportCsv(content: string): ParsedImportCsv {
  if (importUtf8Length(content) > IMPORT_MAX_BYTES || content.includes('\0')) throw new Error('CSV exceeds 256 KiB or contains invalid text');
  const input = content.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let record: string[] = [], cell = '', quoted = false, closed = false;
  const finishCell = () => { record.push(cell); cell = ''; closed = false; };
  const finishRow = () => {
    finishCell();
    if (record.some((value) => value !== '')) records.push(record);
    record = [];
    if (records.length > IMPORT_MAX_ROWS + 1) throw new Error('CSV has more than 100 data rows');
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell || closed) throw new Error('Unexpected quote in CSV');
      quoted = true;
    } else if (ch === ',') { finishCell(); }
    else if (ch === '\r' || ch === '\n') { if (ch === '\r' && input[i + 1] === '\n') i++; finishRow(); }
    else { if (closed) throw new Error('Unexpected text after closing quote'); cell += ch; }
    if (record.length > 32 || cell.length > 10_000) throw new Error('CSV exceeds column or cell limits');
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || record.length || closed) finishRow();
  const headers = records.shift()?.map((value) => value.trim()) ?? [];
  if (!headers.length || headers.length > 32 || headers.some((h) => !h || h.length > 200) || new Set(headers).size !== headers.length) throw new Error('CSV needs 1–32 distinct, nonempty headers');
  if (!records.length || records.some((row) => row.length !== headers.length)) throw new Error('CSV needs data rows with the same number of columns as the header');
  return { headers, rows: records };
}
