import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  parseImportCsv, uuid, importPreviewRequestSchema, importPreviewSchema, importContextRowSchema, importPersonSchema, importPersonUpdateSchema,
  importSongSchema, importSongUpdateSchema, importJobDetailSchema, importJobSchema,
  type ImportPreviewRequest, type ImportPreview, type ImportPreviewRow, type ImportContextRow,
  type ImportSaveRequest, type ImportJobDetail,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export interface ImportOwner { organizationId: string; userId: string }
interface MappedImportRow { row: number; data: Record<string, unknown>; target_id: string | null; errors: string[] }
const contextSchema = z.array(importContextRowSchema);
export const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

function mappedRows(source: ImportPreviewRequest): MappedImportRow[] {
  let csv;
  try { csv = parseImportCsv(source.content); } catch (error) {
    throw HttpError.unprocessable(error instanceof Error ? error.message : 'Invalid CSV');
  }
  for (const header of Object.values(source.mapping)) {
    if (!csv.headers.includes(header)) throw HttpError.unprocessable(`Mapped column is missing: ${header}`);
  }
  if (!Object.keys(source.mapping).some((key) => key !== 'id')) throw HttpError.unprocessable('Map at least one metadata field');
  const rows = csv.rows.map((cells, index): MappedImportRow => {
    const data: Record<string, unknown> = {};
    let target: string | null = null;
    const errors: string[] = [];
    for (const [field, header] of Object.entries(source.mapping)) {
      const value = cells[csv.headers.indexOf(header)]!.trim();
      if (field === 'id') {
        if (value && !uuid.safeParse(value).success) errors.push('ID must be a stable Person/song UUID');
        else target = value || null;
      } else if (field === 'themes' || field === 'song_types') {
        data[field] = [...new Set(value.split(';').map((tag) => tag.trim()).filter(Boolean))];
      } else if (field === 'default_bpm') data[field] = value === '' ? null : Number(value);
      else data[field] = value === '' && field !== 'title' && field !== 'first_name' ? null : value;
    }
    const resolution = source.resolutions.find((r) => r.row === index + 2);
    if (resolution?.action === 'update') target = resolution.target_id!;
    else if (resolution?.action === 'create' || resolution?.action === 'skip') target = null;
    return { row: index + 2, data, target_id: target, errors };
  });
  if (source.resolutions.some((r) => !rows.some((row) => row.row === r.row))) throw HttpError.unprocessable('Resolution refers to a missing row');
  return rows;
}

function duplicateKey(source: ImportPreviewRequest, row: MappedImportRow): string {
  const d = row.data;
  if (source.kind === 'people') return stableJson(d.email ? ['email', String(d.email).toLowerCase()] : ['name', String(d.first_name ?? '').toLowerCase(), String(d.last_name ?? '').toLowerCase()]);
  return stableJson(d.ccli_number ? ['ccli', d.ccli_number] : ['title', String(d.title ?? '').toLowerCase()]);
}

/** Pure preview: SQL context is read-only; neither jobs nor domain rows change. */
export async function previewStructuredImport(db: Db, owner: ImportOwner, source: ImportPreviewRequest): Promise<ImportPreview> {
  const rows = mappedRows(source);
  // Invalid IDs are errors, never UUID casts in SQL; email normalized before matching.
  for (const row of rows) if (typeof row.data.email === 'string') row.data.email = row.data.email.toLowerCase();
  const context: unknown = await unwrap(raw(db).rpc('structured_import_context', {
    p_org: owner.organizationId, p_kind: source.kind,
    p_rows: rows.map((row) => ({ row: row.row, target_id: row.target_id, data: row.data })),
  }));
  const contexts = new Map<number, ImportContextRow>(contextSchema.parse(context).map((row) => [row.row, row]));
  const result: ImportPreviewRow[] = rows.map((row) => {
    const ctx = contexts.get(row.row)!;
    const resolution = source.resolutions.find((r) => r.row === row.row);
    const base: ImportPreviewRow = { row: row.row, data: row.data, before: null, target_id: null, expected_version: null,
      action: 'create', errors: [...row.errors], candidates: ctx.candidates, candidate_count: ctx.candidate_count };
    if (resolution?.action === 'skip') return { ...base, action: 'skip', data: {}, errors: [] };
    const action = row.target_id ? 'update' : 'create';
    const schema = source.kind === 'people' ? (action === 'create' ? importPersonSchema : importPersonUpdateSchema)
      : action === 'create' ? importSongSchema : importSongUpdateSchema;
    const parsed = schema.safeParse(row.data);
    if (!parsed.success) base.errors.push(...parsed.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`));
    else base.data = parsed.data;
    if (row.target_id) {
      const target = ctx.candidates.find((c) => c.id === row.target_id);
      if (!target) base.errors.push('Target is unavailable in this organization');
      else { base.target_id = target.id; base.expected_version = target.version; base.before = target.data; }
    }
    if (base.errors.length) return { ...base, action: 'error' };
    if (!resolution && !row.target_id && (ctx.candidate_count || rows.some((other) => other.row !== row.row && duplicateKey(source, other) === duplicateKey(source, row)))) {
      return { ...base, action: 'unresolved', errors: ['Possible duplicate: choose create, an existing target, or skip'] };
    }
    return { ...base, action };
  });
  for (const row of result) {
    if (row.action === 'update' && result.some((other) => other !== row && other.action === 'update' && other.target_id === row.target_id)) {
      row.errors.push('Only one row may update a target in one import');
    }
  }
  for (const row of result) if (row.errors.length && row.action !== 'unresolved') row.action = 'error';
  const sourceHash = hash(source.content);
  return importPreviewSchema.parse({ kind: source.kind, source_hash: sourceHash,
    preview_hash: hash(stableJson({ source, rows: result, organization_id: owner.organizationId, actor_id: owner.userId })),
    rows: result, can_commit: result.every((row) => ['create', 'update', 'skip'].includes(row.action)) });
}

export async function loadStructuredImport(db: Db, owner: ImportOwner, id: string): Promise<ImportJobDetail> {
  const job: unknown = await unwrap(raw(db).from('structured_import_jobs').select('*').eq('organization_id', owner.organizationId).eq('created_by', owner.userId).eq('id', id).maybeSingle());
  if (!job) throw HttpError.notFound('Import not found');
  const rows: unknown = await unwrap(raw(db).from('structured_import_rows').select('*').eq('job_id', id).order('row_number'));
  const envelope = z.object({ source: importPreviewRequestSchema }).parse(job);
  return importJobDetailSchema.parse({ job, rows, source: envelope.source });
}

export async function saveStructuredImport(db: Db, owner: ImportOwner, request: ImportSaveRequest): Promise<ImportJobDetail> {
  // A lost response must reuse the saved review even after its own commit
  // changes duplicate candidates/target versions. SQL checks source/hash again.
  const existing: unknown = await unwrap(raw(db).from('structured_import_jobs').select('id').eq('organization_id', owner.organizationId)
    .eq('created_by', owner.userId).eq('idempotency_key', request.idempotency_key).maybeSingle());
  let rows: ImportPreviewRow[] = [];
  if (!existing) {
    const preview = await previewStructuredImport(db, owner, request.source);
    if (!preview.can_commit) throw HttpError.unprocessable('Resolve every import row before saving');
    if (preview.preview_hash !== request.preview_hash) throw new HttpError(409, 'Import changed. Preview again.', 'import_changed');
    rows = preview.rows;
  }
  const result: unknown = await unwrap(raw(db).rpc('save_structured_import', {
    p_org: owner.organizationId, p_source: request.source, p_source_hash: hash(request.source.content),
    p_preview_hash: request.preview_hash, p_rows: rows, p_key: request.idempotency_key,
  }));
  const job = importJobSchema.parse(result);
  return loadStructuredImport(db, owner, job.id);
}
