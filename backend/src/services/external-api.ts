import type {
  ExternalOrganization,
  ExternalPage,
  ExternalPageQuery,
  ExternalPlan,
  ExternalPlanSummary,
  ExternalPlansQuery,
  ExternalServiceType,
  ExternalSong,
  ExternalSongsQuery,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { adminDb } from '../lib/supabase.js';
import { decodeCursor, encodeCursor, toExternalPlan, type ExternalCursor } from '../model/integration.model.js';
import type { ApiCredentialContext } from '../middleware/api-key.js';

/**
 * Read-only external API. Every call goes through a service-role database
 * function that takes the credential id and re-derives its organization and
 * scope (published plans only; no people, notes, descriptions or files).
 */

interface RpcError {
  code?: string;
  message: string;
}

const fail = (error: RpcError): never => {
  if (error.code === '28000') throw new HttpError(401, 'This API key is revoked, expired or no longer valid', 'api_key_inactive');
  if (error.code === '42501') throw new HttpError(403, 'This API key lacks the required scope', 'insufficient_scope');
  throw new HttpError(500, 'The request could not be completed', 'internal_error');
};

const cursorOf = (raw: string | undefined, needsDate: boolean): ExternalCursor | null => {
  if (!raw) return null;
  const cursor = decodeCursor(raw, needsDate);
  if (!cursor) throw new HttpError(422, 'Invalid cursor', 'invalid_cursor');
  return cursor;
};

/** Fetches one row more than the page to know whether another page exists. */
const page = <T extends { id: string }>(rows: T[], limit: number, keyOf: (row: T) => ExternalCursor): ExternalPage<T> => {
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, next_cursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
};

export const externalOrganization = async ({ credentialId }: ApiCredentialContext): Promise<ExternalOrganization> => {
  const { data, error } = await adminDb.rpc('api_organization', { p_credential: credentialId });
  if (error) return fail(error);
  const row = data?.[0];
  if (!row) throw HttpError.notFound();
  return { id: row.id, name: row.name, timezone: row.timezone };
};

export const externalServiceTypes = async (
  { credentialId }: ApiCredentialContext,
  query: ExternalPageQuery,
): Promise<ExternalPage<ExternalServiceType>> => {
  const after = cursorOf(query.cursor, false);
  const { data, error } = await adminDb.rpc('api_service_types', { p_credential: credentialId, p_after: after?.id ?? null, p_limit: query.limit + 1 });
  if (error) return fail(error);
  const rows: ExternalServiceType[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    updated_at: row.updated_at,
  }));
  return page(rows, query.limit, (row) => ({ id: row.id }));
};

export const externalPlans = async (
  { credentialId }: ApiCredentialContext,
  query: ExternalPlansQuery,
): Promise<ExternalPage<ExternalPlanSummary>> => {
  const after = cursorOf(query.cursor, true);
  const { data, error } = await adminDb.rpc('api_plans', {
    p_credential: credentialId,
    p_from: query.from,
    p_to: query.to,
    p_service_type: query.service_type_id ?? null,
    p_after_date: after?.date ?? null,
    p_after_id: after?.id ?? null,
    p_limit: query.limit + 1,
  });
  if (error) return fail(error);
  const rows: ExternalPlanSummary[] = (data ?? []).map((row) => ({
    id: row.id,
    service_type_id: row.service_type_id,
    title: row.title,
    service_date: new Date(row.service_date).toISOString(),
    location: row.location,
    updated_at: row.updated_at,
  }));
  return page(rows, query.limit, (row) => ({ id: row.id, date: row.service_date }));
};

export const externalPlan = async ({ credentialId }: ApiCredentialContext, planId: string): Promise<ExternalPlan> => {
  const { data, error } = await adminDb.rpc('api_plan', { p_credential: credentialId, p_plan: planId });
  if (error) return fail(error);
  const plan = toExternalPlan(data);
  if (!plan) throw HttpError.notFound('Plan not found');
  return plan;
};

export const externalSongs = async (
  { credentialId }: ApiCredentialContext,
  query: ExternalSongsQuery,
): Promise<ExternalPage<ExternalSong>> => {
  const after = cursorOf(query.cursor, false);
  const { data, error } = await adminDb.rpc('api_songs', {
    p_credential: credentialId,
    p_query: query.q ?? null,
    p_after: after?.id ?? null,
    p_limit: query.limit + 1,
  });
  if (error) return fail(error);
  const rows: ExternalSong[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    author: row.author,
    ccli_number: row.ccli_number,
    default_key: row.default_key,
    themes: row.themes,
    updated_at: row.updated_at,
  }));
  return page(rows, query.limit, (row) => ({ id: row.id }));
};
