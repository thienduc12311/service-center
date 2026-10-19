import { createHash, randomBytes } from 'node:crypto';
import type {
  ApiCredentialRow,
  ApiCredentialSummary,
  CreateApiCredentialInput,
  CreatedApiCredential,
} from '@service-center/shared';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { unwrap, type Db } from '../lib/supabase.js';
import { API_CREDENTIAL_COLUMNS, apiCredentialState, type IssuerMembership } from '../model/integration.model.js';

/** The administrator's RLS-bound client and organization. */
export interface IntegrationCaller {
  db: Db;
  orgId: string;
}

/** Hash stored for a credential secret (the secret itself is never stored). */
export const hashApiSecret = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex');

/** A new `sck_<prefix>_<secret>` key and its stored parts. */
export const generateApiKey = (): { key: string; prefix: string; secretHash: string } => {
  const prefix = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return { key: `sck_${prefix}_${secret}`, prefix, secretHash: hashApiSecret(secret) };
};

const summarize = async (db: Db, orgId: string, rows: ApiCredentialRow[]): Promise<ApiCredentialSummary[]> => {
  const issuerIds = [...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : [])))];
  const memberships = new Map<string, IssuerMembership>();
  const names = new Map<string, string | null>();
  if (issuerIds.length) {
    const members = (await unwrap(
      db.from('organization_members').select('user_id, role, status').eq('organization_id', orgId).in('user_id', issuerIds),
    )) as Array<{ user_id: string; role: string; status: string }> | null;
    for (const member of members ?? []) memberships.set(member.user_id, { role: member.role, status: member.status });
    const profiles = (await unwrap(db.from('profiles').select('id, full_name').in('id', issuerIds))) as Array<{
      id: string;
      full_name: string | null;
    }> | null;
    for (const profile of profiles ?? []) names.set(profile.id, profile.full_name);
  }
  return rows.map((row) => ({
    ...row,
    state: apiCredentialState(row, row.created_by ? memberships.get(row.created_by) : undefined),
    created_by_name: row.created_by ? names.get(row.created_by) ?? null : null,
  }));
};

const loadCredentials = async (db: Db, orgId: string, id?: string): Promise<ApiCredentialRow[]> => {
  let query = db.from('api_credentials').select(API_CREDENTIAL_COLUMNS).eq('organization_id', orgId);
  if (id) query = query.eq('id', id);
  const rows = (await unwrap(query.order('created_at', { ascending: false }).limit(100))) as ApiCredentialRow[] | null;
  return rows ?? [];
};

export const listApiCredentials = async ({ db, orgId }: IntegrationCaller): Promise<ApiCredentialSummary[]> =>
  summarize(db, orgId, await loadCredentials(db, orgId));

const loadOne = async (db: Db, orgId: string, id: string): Promise<ApiCredentialSummary> => {
  const [row] = await summarize(db, orgId, await loadCredentials(db, orgId, id));
  if (!row) throw HttpError.notFound('Credential not found');
  return row;
};

/**
 * Issues a credential. The key is generated here and returned once; the
 * database receives only its public prefix and the secret's hash. A replayed
 * request key returns the existing credential without a secret.
 */
export const createApiCredential = async (
  { db, orgId }: IntegrationCaller,
  input: CreateApiCredentialInput,
): Promise<CreatedApiCredential> => {
  const generated = generateApiKey();
  const { data, error } = await db.rpc('create_api_credential', {
    p_org: orgId,
    p_name: input.name,
    p_scopes: input.scopes,
    p_key_prefix: generated.prefix,
    p_secret_hash: generated.secretHash,
    p_expires_at: input.expires_at ?? null,
    p_rate_limit_per_minute: input.rate_limit_per_minute,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  const result = data?.[0];
  if (!result) throw new HttpError(500, 'Credential was not created');
  return {
    credential: await loadOne(db, orgId, result.credential_id),
    secret: result.replayed ? null : generated.key,
    replayed: result.replayed,
  };
};

export const revokeApiCredential = async ({ db, orgId }: IntegrationCaller, id: string): Promise<ApiCredentialSummary> => {
  await loadOne(db, orgId, id);
  const { error } = await db.rpc('revoke_api_credential', { p_credential: id });
  if (error) throw fromPostgrestError(error);
  return loadOne(db, orgId, id);
};
