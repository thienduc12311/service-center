import type {
  ApiCredentialRow,
  ApiCredentialState,
  ExternalPlan,
  ExternalPlanItem,
  ExternalPlanTime,
  WebhookDeliveryAttempt,
  WebhookDeliveryAttemptRow,
  WebhookDeliveryListItem,
  WebhookDeliveryRow,
  WebhookEndpointRow,
  WebhookEndpointSummary,
  WebhookEventRow,
} from '@service-center/shared';

/** Readable credential columns (the secret hash is not granted to clients). */
export const API_CREDENTIAL_COLUMNS =
  'id, organization_id, name, key_prefix, scopes, rate_limit_per_minute, expires_at, created_by, created_at, last_used_at, revoked_at, revoked_by';

/** Readable endpoint columns (the secret ciphertext is not granted to clients). */
export const WEBHOOK_ENDPOINT_COLUMNS =
  'id, organization_id, url, description, event_types, secret_hint, enabled, disabled_reason, consecutive_failures, revision, created_by, created_at, updated_at, revoked_at, revoked_by';

export interface IssuerMembership {
  role: string;
  status: string;
}

export const apiCredentialState = (
  row: Pick<ApiCredentialRow, 'revoked_at' | 'expires_at' | 'created_by'>,
  issuer: IssuerMembership | undefined,
  now: number = Date.now(),
): ApiCredentialState => {
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && Date.parse(row.expires_at) <= now) return 'expired';
  if (!row.created_by || !issuer || issuer.status !== 'active' || (issuer.role !== 'owner' && issuer.role !== 'admin')) {
    return 'issuer_inactive';
  }
  return 'active';
};

export interface EndpointDeliveryCounts {
  pending: number;
  failed: number;
}

export const toWebhookEndpointSummary = (row: WebhookEndpointRow, counts: EndpointDeliveryCounts): WebhookEndpointSummary => ({
  ...row,
  pending_deliveries: counts.pending,
  failed_deliveries: counts.failed,
});

export const toWebhookDeliveryAttempt = (row: WebhookDeliveryAttemptRow): WebhookDeliveryAttempt => ({
  attempt: row.attempt,
  started_at: row.started_at,
  duration_ms: row.duration_ms,
  status_code: row.status_code,
  outcome: row.outcome,
  error_code: row.error_code,
});

export const toWebhookDeliveryListItem = (
  row: WebhookDeliveryRow,
  event: Pick<WebhookEventRow, 'event_type' | 'occurred_at'>,
  attempts: WebhookDeliveryAttemptRow[],
  endpointActive: boolean,
): WebhookDeliveryListItem => ({
  id: row.id,
  event_id: row.event_id,
  event_type: event.event_type,
  occurred_at: event.occurred_at,
  status: row.status,
  attempts: row.attempts,
  max_attempts: row.max_attempts,
  next_attempt_at: row.next_attempt_at,
  last_status_code: row.last_status_code,
  last_error_code: row.last_error_code,
  completed_at: row.completed_at,
  retryable: endpointActive && (row.status === 'failed' || row.status === 'cancelled'),
  history: attempts.map(toWebhookDeliveryAttempt).sort((a, b) => a.attempt - b.attempt),
});

// ------------------------------------------------------------------ cursors

/** Opaque keyset position: the last row's sort key. */
export interface ExternalCursor {
  id: string;
  date?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const encodeCursor = (cursor: ExternalCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

/** Null when the cursor is malformed (the route answers 422). */
export const decodeCursor = (raw: string, needsDate: boolean): ExternalCursor | null => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { id, date } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (needsDate) {
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) return null;
    return { id, date };
  }
  return { id };
};

// ------------------------------------------------------- external plan JSON

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const str = (value: unknown): string => (typeof value === 'string' ? value : String(value ?? ''));
const strOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

const toTime = (value: unknown): ExternalPlanTime | null => {
  if (!isRecord(value)) return null;
  const kind = value.kind === 'rehearsal' || value.kind === 'other' ? value.kind : 'service';
  return { id: str(value.id), kind, name: strOrNull(value.name), starts_at: str(value.starts_at), ends_at: str(value.ends_at) };
};

const toItem = (value: unknown): ExternalPlanItem | null => {
  if (!isRecord(value)) return null;
  const type = value.type === 'song' || value.type === 'header' ? value.type : 'item';
  return {
    id: str(value.id),
    type,
    title: str(value.title),
    position: num(value.position),
    length_seconds: num(value.length_seconds),
    song_id: strOrNull(value.song_id),
  };
};

/** Maps `api_plan` JSON (validated from `unknown`) to the public shape. */
export const toExternalPlan = (value: unknown): ExternalPlan | null => {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    service_type_id: strOrNull(value.service_type_id),
    title: str(value.title),
    service_date: str(value.service_date),
    location: strOrNull(value.location),
    updated_at: str(value.updated_at),
    times: (Array.isArray(value.times) ? value.times : []).map(toTime).filter((time): time is ExternalPlanTime => time !== null),
    items: (Array.isArray(value.items) ? value.items : []).map(toItem).filter((item): item is ExternalPlanItem => item !== null),
  };
};
