import {
  EXTERNAL_API_PREFIX,
  EXTERNAL_API_VERSION,
  type CreateWebhookEndpointInput,
  type CreatedWebhookEndpoint,
  type IntegrationStatus,
  type SetWebhookEnabledInput,
  type WebhookDeliveriesQuery,
  type WebhookDeliveryAttemptRow,
  type WebhookDeliveryListItem,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
  type WebhookEndpointSummary,
  type WebhookEventRow,
} from '@service-center/shared';
import { config } from '../config.js';
import { DestinationError, resolveDestination } from '../lib/destination-guard.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { sealSecret, secretBoxAvailable } from '../lib/secret-box.js';
import { unwrap, type Db } from '../lib/supabase.js';
import { generateSigningSecret } from '../lib/webhook-signature.js';
import {
  WEBHOOK_ENDPOINT_COLUMNS,
  toWebhookDeliveryListItem,
  toWebhookEndpointSummary,
  type EndpointDeliveryCounts,
} from '../model/integration.model.js';
import type { IntegrationCaller } from './api-credentials.js';

export const integrationStatus = (): IntegrationStatus => ({
  webhooks_available: secretBoxAvailable(),
  worker_configured: Boolean(config.CRON_SECRET),
  api_base_url: `${config.API_URL.replace(/\/$/, '')}${EXTERNAL_API_PREFIX}`,
  api_version: EXTERNAL_API_VERSION,
  scopes: ['plans.read', 'songs.read'],
  event_types: ['plan.published', 'plan.unpublished', 'plan.deleted'],
});

const DESTINATION_MESSAGES: Record<DestinationError['code'], string> = {
  invalid_url: 'Use a public https:// URL without credentials',
  dns_failed: 'The host name could not be resolved',
  destination_blocked: 'The URL resolves to a private or reserved network address',
};

/** Registration-time check; every send checks again (DNS can change). */
const assertDestination = async (url: string): Promise<void> => {
  try {
    await resolveDestination(url, { allowPrivate: config.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS });
  } catch (error) {
    if (error instanceof DestinationError) {
      throw new HttpError(422, DESTINATION_MESSAGES[error.code], `webhook_${error.code}`);
    }
    throw error;
  }
};

const deliveryCounts = async (db: Db, endpointIds: string[]): Promise<Map<string, EndpointDeliveryCounts>> => {
  const counts = new Map<string, EndpointDeliveryCounts>();
  if (!endpointIds.length) return counts;
  const rows = (await unwrap(
    db.from('webhook_deliveries').select('endpoint_id, status').in('endpoint_id', endpointIds).in('status', ['queued', 'sending', 'failed']),
  )) as Array<Pick<WebhookDeliveryRow, 'endpoint_id' | 'status'>> | null;
  for (const row of rows ?? []) {
    const entry = counts.get(row.endpoint_id) ?? { pending: 0, failed: 0 };
    if (row.status === 'failed') entry.failed += 1;
    else entry.pending += 1;
    counts.set(row.endpoint_id, entry);
  }
  return counts;
};

const loadEndpoints = async (db: Db, orgId: string, id?: string): Promise<WebhookEndpointSummary[]> => {
  let query = db.from('webhook_endpoints').select(WEBHOOK_ENDPOINT_COLUMNS).eq('organization_id', orgId);
  if (id) query = query.eq('id', id);
  const rows = ((await unwrap(query.order('created_at', { ascending: false }).limit(50))) ?? []) as WebhookEndpointRow[];
  const counts = await deliveryCounts(db, rows.map((row) => row.id));
  return rows.map((row) => toWebhookEndpointSummary(row, counts.get(row.id) ?? { pending: 0, failed: 0 }));
};

const loadEndpoint = async (db: Db, orgId: string, id: string): Promise<WebhookEndpointSummary> => {
  const [row] = await loadEndpoints(db, orgId, id);
  if (!row) throw HttpError.notFound('Webhook endpoint not found');
  return row;
};

export const listWebhookEndpoints = ({ db, orgId }: IntegrationCaller): Promise<WebhookEndpointSummary[]> => loadEndpoints(db, orgId);

/**
 * Registers an endpoint. The signing secret is generated here, sealed with
 * the server key before it reaches the database, and returned once.
 */
export const createWebhookEndpoint = async (
  { db, orgId }: IntegrationCaller,
  input: CreateWebhookEndpointInput,
): Promise<CreatedWebhookEndpoint> => {
  if (!secretBoxAvailable()) {
    throw new HttpError(503, 'Webhooks are not configured on this server', 'webhooks_unavailable');
  }
  await assertDestination(input.url);
  const secret = generateSigningSecret();
  const { data, error } = await db.rpc('create_webhook_endpoint', {
    p_org: orgId,
    p_url: input.url,
    p_description: input.description ?? null,
    p_event_types: input.event_types,
    p_secret_ciphertext: sealSecret(secret),
    p_secret_hint: secret.slice(-4),
    p_idempotency_key: input.idempotency_key,
  });
  if (error) throw fromPostgrestError(error);
  const result = data?.[0];
  if (!result) throw new HttpError(500, 'Endpoint was not created');
  return {
    endpoint: await loadEndpoint(db, orgId, result.endpoint_id),
    signing_secret: result.replayed ? null : secret,
    replayed: result.replayed,
  };
};

export const setWebhookEndpointEnabled = async (
  { db, orgId }: IntegrationCaller,
  id: string,
  input: SetWebhookEnabledInput,
): Promise<WebhookEndpointSummary> => {
  const endpoint = await loadEndpoint(db, orgId, id);
  if (input.enabled) await assertDestination(endpoint.url);
  const { error } = await db.rpc('set_webhook_endpoint_enabled', {
    p_endpoint: id,
    p_enabled: input.enabled,
    p_expected_revision: input.expected_revision,
  });
  if (error) throw fromPostgrestError(error);
  return loadEndpoint(db, orgId, id);
};

export const revokeWebhookEndpoint = async ({ db, orgId }: IntegrationCaller, id: string): Promise<WebhookEndpointSummary> => {
  await loadEndpoint(db, orgId, id);
  const { error } = await db.rpc('revoke_webhook_endpoint', { p_endpoint: id });
  if (error) throw fromPostgrestError(error);
  return loadEndpoint(db, orgId, id);
};

const deliveryItems = async (db: Db, endpoint: WebhookEndpointSummary, deliveries: WebhookDeliveryRow[]): Promise<WebhookDeliveryListItem[]> => {
  if (!deliveries.length) return [];
  const events = ((await unwrap(
    db.from('webhook_events').select('id, event_type, occurred_at').in('id', [...new Set(deliveries.map((row) => row.event_id))]),
  )) ?? []) as Array<Pick<WebhookEventRow, 'id' | 'event_type' | 'occurred_at'>>;
  const attempts = ((await unwrap(
    db.from('webhook_delivery_attempts').select('*').in('delivery_id', deliveries.map((row) => row.id)),
  )) ?? []) as WebhookDeliveryAttemptRow[];
  const eventById = new Map(events.map((event) => [event.id, event]));
  const active = endpoint.enabled && !endpoint.revoked_at;
  return deliveries.flatMap((row) => {
    const event = eventById.get(row.event_id);
    if (!event) return [];
    return [toWebhookDeliveryListItem(row, event, attempts.filter((attempt) => attempt.delivery_id === row.id), active)];
  });
};

export const listWebhookDeliveries = async (
  { db, orgId }: IntegrationCaller,
  endpointId: string,
  query: WebhookDeliveriesQuery,
): Promise<WebhookDeliveryListItem[]> => {
  const endpoint = await loadEndpoint(db, orgId, endpointId);
  const rows = ((await unwrap(
    db.from('webhook_deliveries').select('*').eq('endpoint_id', endpointId).order('created_at', { ascending: false }).limit(query.limit),
  )) ?? []) as WebhookDeliveryRow[];
  return deliveryItems(db, endpoint, rows);
};

const loadDelivery = async (db: Db, orgId: string, deliveryId: string): Promise<WebhookDeliveryListItem> => {
  const row = (await unwrap(
    db.from('webhook_deliveries').select('*').eq('id', deliveryId).eq('organization_id', orgId).maybeSingle(),
  )) as WebhookDeliveryRow | null;
  if (!row) throw HttpError.notFound('Delivery not found');
  const endpoint = await loadEndpoint(db, orgId, row.endpoint_id);
  const [item] = await deliveryItems(db, endpoint, [row]);
  if (!item) throw HttpError.notFound('Delivery not found');
  return item;
};

export const sendWebhookTest = async ({ db, orgId }: IntegrationCaller, endpointId: string): Promise<WebhookDeliveryListItem> => {
  await loadEndpoint(db, orgId, endpointId);
  const { data, error } = await db.rpc('send_webhook_test', { p_endpoint: endpointId });
  if (error) throw fromPostgrestError(error);
  return loadDelivery(db, orgId, data);
};

export const retryWebhookDelivery = async ({ db, orgId }: IntegrationCaller, deliveryId: string): Promise<WebhookDeliveryListItem> => {
  await loadDelivery(db, orgId, deliveryId);
  const { error } = await db.rpc('retry_webhook_delivery', { p_delivery: deliveryId });
  if (error) throw fromPostgrestError(error);
  return loadDelivery(db, orgId, deliveryId);
};
