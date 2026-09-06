/**
 * Daily AI allowance for chord sheet imports.
 *
 * Every import — and every retry — spends one call to an external vision
 * model, so each admin gets `AI_IMPORT_DAILY_LIMIT` runs per day. The counter
 * lives in `public.ai_import_usage` and is charged through a SECURITY DEFINER
 * function, so the increment is atomic and a client cannot reset its own quota
 * by writing the row directly.
 */

import type { ImportQuota, ImportQuotaRow } from '@service-center/shared';
import { config } from '../config.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import type { Db } from '../lib/supabase.js';

/** What the caller has left, plus whether this request may proceed. */
export interface QuotaDecision extends ImportQuota {
  allowed: boolean;
}

export const mapQuotaRowToDecision = (row: ImportQuotaRow): QuotaDecision => ({
  allowed: row.allowed,
  limit: row.quota_limit,
  used: row.used,
  remaining: row.remaining,
  resets_at: new Date(row.resets_at).toISOString(),
});

/** Strips the decision flag — what the quota endpoint returns. */
export const toImportQuota = ({ allowed: _allowed, ...quota }: QuotaDecision): ImportQuota => quota;

type QuotaFunction = 'ai_import_quota_status' | 'consume_ai_import_quota';

const callQuotaFunction = async (
  db: Db,
  fn: QuotaFunction,
  organizationId: string,
): Promise<QuotaDecision> => {
  const { data, error } = await db.rpc(fn, {
    p_organization_id: organizationId,
    p_limit: config.AI_IMPORT_DAILY_LIMIT,
  });

  if (error) throw fromPostgrestError(error);

  const row = (data ?? [])[0];
  if (!row) throw new HttpError(500, 'The import quota could not be resolved');
  return mapQuotaRowToDecision(row);
};

/** Reads today's counters without charging anything. */
export const readImportQuota = (db: Db, organizationId: string): Promise<QuotaDecision> =>
  callQuotaFunction(db, 'ai_import_quota_status', organizationId);

/**
 * Charges one import against today's allowance, or throws 429 when it is
 * spent. The counters travel in the error details so the client can say when
 * the allowance comes back.
 */
export const consumeImportQuota = async (db: Db, organizationId: string): Promise<QuotaDecision> => {
  const decision = await callQuotaFunction(db, 'consume_ai_import_quota', organizationId);

  if (!decision.allowed) {
    throw new HttpError(
      429,
      config.AI_IMPORT_DAILY_LIMIT === 0
        ? 'Chord sheet importing is turned off'
        : `You have used all ${decision.limit} chord sheet imports for today`,
      'quota_exceeded',
      toImportQuota(decision),
    );
  }

  return decision;
};
