import type {
  ApiCredentialState,
  ApiScope,
  WebhookDeliveredEventType,
  WebhookDeliveryStatus,
  WebhookDisabledReason,
} from '../types/integrations.js';

/** Date-named version of the external API contract (`Service-Center-Api-Version`). */
export const EXTERNAL_API_VERSION = '2026-11-01';

/** Path prefix of the external API; first-party routes stay under /api/v1. */
export const EXTERNAL_API_PREFIX = '/api/external/v1';

/** Credential format: `sck_<16 hex prefix>_<43 char base64url secret>`. */
export const API_KEY_PATTERN = /^sck_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'plans.read': 'Read published plans and service types',
  'songs.read': 'Read the song library',
};

export const WEBHOOK_EVENT_LABELS: Record<WebhookDeliveredEventType, string> = {
  'plan.published': 'A plan was published',
  'plan.unpublished': 'A published plan went back to draft or was archived',
  'plan.deleted': 'A published plan was deleted',
  'webhook.test': 'Test event',
};

export const WEBHOOK_DELIVERY_STATUS_LABELS: Record<WebhookDeliveryStatus, string> = {
  queued: 'Waiting',
  sending: 'Sending',
  succeeded: 'Accepted by endpoint',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const WEBHOOK_DISABLED_REASON_LABELS: Record<WebhookDisabledReason, string> = {
  administrator: 'Paused by an administrator',
  gone: 'The endpoint answered 410 Gone',
  failing: 'Paused after repeated failures',
};

export const API_CREDENTIAL_STATE_LABELS: Record<ApiCredentialState, string> = {
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  issuer_inactive: 'Inactive — issuer is no longer an administrator',
};

const WEBHOOK_ERROR_LABELS: Record<string, string> = {
  timeout: 'The endpoint did not answer in time',
  destination_blocked: 'The address resolves to a private or reserved network',
  dns_failed: 'The host name could not be resolved',
  connection_failed: 'Could not connect to the endpoint',
  redirect_not_followed: 'The endpoint redirected; update the URL instead',
  secret_unavailable: 'The signing secret could not be read on the server',
  endpoint_disabled: 'The endpoint was paused',
  endpoint_revoked: 'The endpoint was revoked',
};

/** Human text for a stored delivery error code (`http_503` → "Endpoint answered HTTP 503"). */
export const webhookErrorLabel = (code: string): string => {
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return `Endpoint answered HTTP ${http[1]}`;
  return WEBHOOK_ERROR_LABELS[code] ?? code;
};
