import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { EXTERNAL_API_VERSION, type WebhookAttemptOutcome, type WebhookClaimRpcRow, type WebhookEventPayload, type WebhookWorkerResult } from '@service-center/shared';
import { config } from '../config.js';
import { DestinationError, resolveDestination, type ResolvedDestination } from '../lib/destination-guard.js';
import { openSecret } from '../lib/secret-box.js';
import { adminDb, unwrap } from '../lib/supabase.js';
import { webhookHeaders } from '../lib/webhook-signature.js';

/** Standard Webhooks recommends 15–30 s; stay at the low end inside a 60 s function. */
const REQUEST_TIMEOUT_MS = 15_000;
const CONCURRENCY = 5;

export interface AttemptResult {
  outcome: WebhookAttemptOutcome;
  statusCode: number | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
}

/** The body a subscriber receives: identifiers only, never plan content. */
export const webhookPayload = (row: WebhookClaimRpcRow): WebhookEventPayload => ({
  id: `evt_${row.event_id.replace(/-/g, '')}`,
  type: row.event_type,
  api_version: EXTERNAL_API_VERSION,
  created_at: row.occurred_at,
  organization_id: row.organization_id,
  data: row.data,
});

const parseRetryAfter = (header: string | string[] | undefined): number | null => {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
};

/** Maps an HTTP answer to an attempt outcome (redirects are never followed). */
export const classifyResponse = (statusCode: number, retryAfter: string | string[] | undefined): AttemptResult => {
  if (statusCode >= 200 && statusCode < 300) return { outcome: 'succeeded', statusCode, errorCode: null, retryAfterSeconds: null };
  if (statusCode === 410) return { outcome: 'gone', statusCode, errorCode: 'http_410', retryAfterSeconds: null };
  if (statusCode >= 300 && statusCode < 400) {
    return { outcome: 'failed', statusCode, errorCode: 'redirect_not_followed', retryAfterSeconds: null };
  }
  return { outcome: 'retry', statusCode, errorCode: `http_${statusCode}`, retryAfterSeconds: parseRetryAfter(retryAfter) };
};

/** POSTs to the already-checked address (no second DNS lookup, no redirects). */
export const postToDestination = (
  destination: ResolvedDestination,
  headers: Record<string, string>,
  body: string,
): Promise<AttemptResult> =>
  new Promise((resolve) => {
    const { url, address, family } = destination;
    const pinned: LookupFunction = (_hostname, options, callback) => {
      if (options.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    const finish = (result: AttemptResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        lookup: pinned,
        agent: false,
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() },
      },
      (response) => {
        // The body is never read or stored; drain it so the socket closes.
        response.resume();
        finish(classifyResponse(response.statusCode ?? 0, response.headers['retry-after']));
      },
    );
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      finish({ outcome: 'retry', statusCode: null, errorCode: 'timeout', retryAfterSeconds: null });
    });
    request.on('error', () => finish({ outcome: 'retry', statusCode: null, errorCode: 'connection_failed', retryAfterSeconds: null }));
    request.end(body);
  });

const attempt = async (row: WebhookClaimRpcRow): Promise<AttemptResult> => {
  const secret = openSecret(row.secret_ciphertext);
  if (!secret) return { outcome: 'failed', statusCode: null, errorCode: 'secret_unavailable', retryAfterSeconds: null };
  let destination: ResolvedDestination;
  try {
    destination = await resolveDestination(row.url, { allowPrivate: config.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS });
  } catch (error) {
    const code = error instanceof DestinationError ? error.code : 'dns_failed';
    return { outcome: code === 'dns_failed' ? 'retry' : 'failed', statusCode: null, errorCode: code, retryAfterSeconds: null };
  }
  const payload = webhookPayload(row);
  const body = JSON.stringify(payload);
  const signed = webhookHeaders(secret, payload.id, Math.floor(Date.now() / 1000), body);
  return postToDestination(destination, { ...signed, 'user-agent': 'ServiceCenter-Webhooks/1' }, body);
};

const deliver = async (row: WebhookClaimRpcRow): Promise<string> => {
  const startedAt = new Date();
  const result = await attempt(row);
  const final = await unwrap(
    adminDb.rpc('complete_webhook_delivery', {
      p_delivery: row.delivery_id,
      p_attempt: row.attempt,
      p_outcome: result.outcome,
      p_status_code: result.statusCode,
      p_error_code: result.errorCode,
      p_started_at: startedAt.toISOString(),
      p_duration_ms: Date.now() - startedAt.getTime(),
      p_retry_after_seconds: result.retryAfterSeconds,
    }),
  );
  return final ?? 'stale';
};

/** One bounded pass, scheduled with the F00 delivery worker. */
export const runWebhookDeliveries = async (
  { limit = 20, timeBudgetMs = 40_000 }: { limit?: number; timeBudgetMs?: number } = {},
): Promise<WebhookWorkerResult> => {
  const started = Date.now();
  // Leases outlive the request timeout so a slow attempt is never re-claimed mid-flight.
  const claimed = ((await unwrap(adminDb.rpc('claim_webhook_deliveries', { p_limit: limit, p_lease_seconds: 60 }))) ??
    []) as WebhookClaimRpcRow[];
  const result: WebhookWorkerResult = { claimed: claimed.length, succeeded: 0, retried: 0, failed: 0, stale: 0, pruned: 0 };
  const queue = [...claimed];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      // Out of budget: leave the rest leased; the lease lapses and a later run sends them.
      if (Date.now() - started > timeBudgetMs) break;
      const final = await deliver(row);
      if (final === 'succeeded') result.succeeded += 1;
      else if (final === 'queued') result.retried += 1;
      else if (final === 'failed') result.failed += 1;
      else result.stale += 1;
    }
  });
  await Promise.all(workers);
  result.pruned = (await unwrap(adminDb.rpc('prune_webhook_history', { p_limit: 500 }))) ?? 0;
  return result;
};

export const runWebhookDeliveriesSafely = async (): Promise<WebhookWorkerResult | null> => {
  try {
    return await runWebhookDeliveries();
  } catch (error) {
    console.warn(`[webhooks] run failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
};
