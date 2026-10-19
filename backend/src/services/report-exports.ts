import {
  reportFilename,
  reportFiltersSchema,
  reportToCsv,
  REPORT_EXPORT_MAX_ATTEMPTS,
  REPORT_EXPORT_RETENTION_HOURS,
  REPORT_EXPORT_URL_TTL_SECONDS,
  type ReportExportDownload,
  type ReportExportRow,
  type ReportExportSummary,
  type ReportExportWorkerResult,
  type RequestReportExportInput,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { adminDb, unwrap, type Db } from '../lib/supabase.js';
import { mapEffectiveAccess } from '../model/access.model.js';
import { toReportExportSummary } from '../model/report.model.js';
import { buildReport } from './reports.js';

const BUCKET = 'report-exports';

/** The requester's RLS-bound client and organization. */
export interface ExportCaller {
  db: Db;
  orgId: string;
}

export const listReportExports = async ({ db, orgId }: ExportCaller): Promise<ReportExportSummary[]> => {
  const rows = (await unwrap(
    db.from('report_exports').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(50),
  )) as ReportExportRow[] | null;
  return (rows ?? []).map(toReportExportSummary);
};

/** Queues one export (or returns the same job for a repeated key). */
export const requestReportExport = async (
  { db, orgId }: ExportCaller,
  input: RequestReportExportInput,
): Promise<ReportExportSummary> => {
  const { data, error } = await db.rpc('request_report_export', {
    p_org: orgId,
    p_kind: input.kind,
    p_filters: { ...input.filters },
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  return toReportExportSummary(data);
};

export const retryReportExport = async ({ db, orgId }: ExportCaller, exportId: string): Promise<ReportExportSummary> => {
  const existing = await unwrap(db.from('report_exports').select('id').eq('id', exportId).eq('organization_id', orgId).maybeSingle());
  if (!existing) throw HttpError.notFound('Export not found');
  const { data, error } = await db.rpc('retry_report_export', { p_export: exportId });
  if (error) throw fromPostgrestError(error);
  return toReportExportSummary(data);
};

/**
 * A fresh short-lived URL, signed with the requester's own token: Storage RLS
 * re-checks requester, readiness, expiry and the report capability, so lost
 * access refuses every future retrieval.
 */
export const reportExportDownload = async ({ db, orgId }: ExportCaller, exportId: string): Promise<ReportExportDownload> => {
  const row = (await unwrap(
    db.from('report_exports').select('*').eq('id', exportId).eq('organization_id', orgId).maybeSingle(),
  )) as ReportExportRow | null;
  if (!row) throw HttpError.notFound('Export not found');
  if (row.status !== 'ready' || !row.storage_path || !row.expires_at || Date.parse(row.expires_at) <= Date.now()) {
    throw HttpError.conflict('This export is not ready to download', { status: row.status });
  }
  const filename = reportFilename(row.kind, { from: String(row.filters.from), to: String(row.filters.to) });
  const signed = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, REPORT_EXPORT_URL_TTL_SECONDS, { download: filename });
  if (signed.error || !signed.data) throw HttpError.notFound('Export not found');
  return {
    url: signed.data.signedUrl,
    expires_at: new Date(Date.now() + REPORT_EXPORT_URL_TTL_SECONDS * 1000).toISOString(),
    filename,
  };
};

const failOrRetry = async (job: ReportExportRow, code: string): Promise<'failed' | 'retried'> => {
  const final = job.attempts >= REPORT_EXPORT_MAX_ATTEMPTS || code === 'access_revoked' || code === 'invalid_filters';
  await unwrap(
    adminDb
      .from('report_exports')
      .update({
        status: final ? 'failed' : 'queued',
        error_code: code,
        lease_expires_at: null,
        next_attempt_at: new Date(Date.now() + 60_000 * job.attempts).toISOString(),
      })
      .eq('id', job.id)
      .eq('attempts', job.attempts),
  );
  return final ? 'failed' : 'retried';
};

/** Builds one claimed job under the requester's current access; never throws. */
const processJob = async (job: ReportExportRow): Promise<'ready' | 'failed' | 'retried'> => {
  try {
    const membership = await unwrap(
      adminDb
        .from('organization_members')
        .select('role, access_mode, status')
        .eq('organization_id', job.organization_id)
        .eq('user_id', job.requested_by)
        .maybeSingle(),
    );
    if (!membership || membership.status !== 'active') return failOrRetry(job, 'access_revoked');
    const rows = await unwrap(adminDb.rpc('report_requester_access', { p_org: job.organization_id, p_user: job.requested_by }));
    const access = mapEffectiveAccess(
      { organizationId: job.organization_id, userId: job.requested_by, role: membership.role, accessMode: membership.access_mode },
      rows ?? [],
    );
    const filters = reportFiltersSchema.safeParse(job.filters);
    if (!filters.success) return failOrRetry(job, 'invalid_filters');
    let report;
    try {
      report = await buildReport({ db: adminDb, orgId: job.organization_id, access, serviceRole: true }, job.kind, filters.data);
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) return failOrRetry(job, 'access_revoked');
      throw error;
    }
    const csv = reportToCsv(report);
    // Deterministic per attempt: a retried upload never leaves two files.
    const path = `${job.organization_id}/${job.requested_by}/${job.id}.csv`;
    const upload = await adminDb.storage.from(BUCKET).upload(path, new Blob([csv], { type: 'text/csv' }), {
      contentType: 'text/csv',
      upsert: true,
    });
    if (upload.error) return failOrRetry(job, 'storage_failed');
    const generatedAt = new Date();
    const updated = await unwrap(
      adminDb
        .from('report_exports')
        .update({
          status: 'ready',
          storage_path: path,
          row_count: report.rows.length,
          size_bytes: Buffer.byteLength(csv),
          generated_at: generatedAt.toISOString(),
          expires_at: new Date(generatedAt.getTime() + REPORT_EXPORT_RETENTION_HOURS * 3_600_000).toISOString(),
          error_code: null,
          lease_expires_at: null,
        })
        .eq('id', job.id)
        .eq('attempts', job.attempts)
        .select('id'),
    );
    // A lapsed lease was re-claimed elsewhere; that attempt owns the job now.
    return updated && updated.length ? 'ready' : 'retried';
  } catch {
    return failOrRetry(job, 'generation_failed');
  }
};

/** Deletes files of exports past their retention and marks them expired. */
const expireReportExports = async (): Promise<number> => {
  const expired = ((await unwrap(
    adminDb
      .from('report_exports')
      .select('id, storage_path')
      .eq('status', 'ready')
      .lt('expires_at', new Date().toISOString())
      .limit(100),
  )) ?? []) as Array<Pick<ReportExportRow, 'id' | 'storage_path'>>;
  if (!expired.length) return 0;
  const paths = expired.flatMap((row) => (row.storage_path ? [row.storage_path] : []));
  if (paths.length) {
    const { error } = await adminDb.storage.from(BUCKET).remove(paths);
    if (error) return 0;
  }
  await unwrap(
    adminDb
      .from('report_exports')
      .update({ status: 'expired', storage_path: null })
      .in('id', expired.map((row) => row.id)),
  );
  return expired.length;
};

/** One bounded worker pass (scheduled with the delivery worker). */
export const runReportExports = async (limit = 5): Promise<ReportExportWorkerResult> => {
  const claimed = ((await unwrap(adminDb.rpc('claim_report_exports', { p_limit: limit, p_lease_seconds: 120 }))) ?? []) as ReportExportRow[];
  const result: ReportExportWorkerResult = { claimed: claimed.length, ready: 0, failed: 0, retried: 0, expired: 0 };
  for (const job of claimed) result[await processJob(job)] += 1;
  result.expired = await expireReportExports();
  return result;
};

export const runReportExportsSafely = async (): Promise<ReportExportWorkerResult | null> => {
  try {
    return await runReportExports();
  } catch (error) {
    console.warn(`[reports] export run failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
};
