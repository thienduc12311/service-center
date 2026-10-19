/**
 * Table row types are `type` aliases (not interfaces) so they satisfy the
 * Supabase client's record constraint on schema rows.
 *
 * F17 stage D — external developer API credentials and webhooks.
 *
 * Row types mirror the readable columns only: the secret hash and the
 * webhook signing-secret ciphertext are never selectable by clients and never
 * appear in a shared type.
 */

export type ApiScope = 'plans.read' | 'songs.read';

export type WebhookEventType = 'plan.published' | 'plan.unpublished' | 'plan.deleted';

/** Every event a subscriber can receive, including the administrator's test ping. */
export type WebhookDeliveredEventType = WebhookEventType | 'webhook.test';

export type WebhookDeliveryStatus = 'queued' | 'sending' | 'succeeded' | 'failed' | 'cancelled';

export type WebhookDisabledReason = 'administrator' | 'gone' | 'failing';

export type WebhookAttemptOutcome = 'succeeded' | 'retry' | 'failed' | 'gone';

export type ApiCredentialRow = {
  id: string;
  organization_id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  rate_limit_per_minute: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
};

/** `active` is derived: unrevoked, unexpired, and the issuer is still an administrator. */
export type ApiCredentialState = 'active' | 'revoked' | 'expired' | 'issuer_inactive';

export interface ApiCredentialSummary extends ApiCredentialRow {
  state: ApiCredentialState;
  created_by_name: string | null;
}

/** Returned once, at creation. `secret` is null when the request key was replayed. */
export interface CreatedApiCredential {
  credential: ApiCredentialSummary;
  secret: string | null;
  replayed: boolean;
}

export type WebhookEndpointRow = {
  id: string;
  organization_id: string;
  url: string;
  description: string | null;
  event_types: WebhookEventType[];
  secret_hint: string;
  enabled: boolean;
  disabled_reason: WebhookDisabledReason | null;
  consecutive_failures: number;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

export interface WebhookEndpointSummary extends WebhookEndpointRow {
  pending_deliveries: number;
  failed_deliveries: number;
}

/** Returned once, at creation. `signing_secret` is null when the request key was replayed. */
export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpointSummary;
  signing_secret: string | null;
  replayed: boolean;
}

export type WebhookEventRow = {
  id: string;
  organization_id: string;
  event_type: WebhookDeliveredEventType;
  source_key: string;
  data: Record<string, unknown>;
  occurred_at: string;
};

export type WebhookDeliveryRow = {
  id: string;
  organization_id: string;
  event_id: string;
  endpoint_id: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_expires_at: string | null;
  last_status_code: number | null;
  last_error_code: string | null;
  manual_retries: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WebhookDeliveryAttemptRow = {
  id: string;
  delivery_id: string;
  organization_id: string;
  attempt: number;
  started_at: string;
  duration_ms: number | null;
  status_code: number | null;
  outcome: WebhookAttemptOutcome;
  error_code: string | null;
};

export interface WebhookDeliveryAttempt {
  attempt: number;
  started_at: string;
  duration_ms: number | null;
  status_code: number | null;
  outcome: WebhookAttemptOutcome;
  error_code: string | null;
}

export interface WebhookDeliveryListItem {
  id: string;
  event_id: string;
  event_type: WebhookDeliveredEventType;
  occurred_at: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error_code: string | null;
  completed_at: string | null;
  retryable: boolean;
  history: WebhookDeliveryAttempt[];
}

export interface IntegrationStatus {
  /** False when the server has no secret-encryption key: webhooks cannot be registered. */
  webhooks_available: boolean;
  /** A scheduled worker entry point is configured (deliveries otherwise wait). */
  worker_configured: boolean;
  api_base_url: string;
  api_version: string;
  scopes: ApiScope[];
  event_types: WebhookEventType[];
}

export interface WebhookWorkerResult {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  stale: number;
  pruned: number;
}

// ================================================ external API (v1) shapes

export interface ExternalPage<T> {
  data: T[];
  /** Pass as `cursor` to fetch the next page; null on the last page. */
  next_cursor: string | null;
}

export interface ExternalOrganization {
  id: string;
  name: string;
  timezone: string;
}

export interface ExternalServiceType {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
}

export interface ExternalPlanSummary {
  id: string;
  service_type_id: string | null;
  title: string;
  service_date: string;
  location: string | null;
  updated_at: string;
}

export interface ExternalPlanTime {
  id: string;
  kind: 'service' | 'rehearsal' | 'other';
  name: string | null;
  starts_at: string;
  ends_at: string;
}

export interface ExternalPlanItem {
  id: string;
  type: 'song' | 'header' | 'item';
  title: string;
  position: number;
  length_seconds: number;
  song_id: string | null;
}

export interface ExternalPlan extends ExternalPlanSummary {
  times: ExternalPlanTime[];
  items: ExternalPlanItem[];
}

export interface ExternalSong {
  id: string;
  title: string;
  author: string | null;
  ccli_number: string | null;
  default_key: string | null;
  themes: string[];
  updated_at: string;
}

/** The JSON body of every webhook request (signed per Standard Webhooks). */
export interface WebhookEventPayload {
  id: string;
  type: WebhookDeliveredEventType;
  api_version: string;
  created_at: string;
  organization_id: string;
  data: Record<string, unknown>;
}
