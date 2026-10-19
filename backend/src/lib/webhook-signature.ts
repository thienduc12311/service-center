import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Standard Webhooks signing (https://www.standardwebhooks.com): the secret is
 * `whsec_<base64 key>`, the signed content is `<id>.<timestamp>.<body>` and
 * `webhook-signature` is a space-separated list of `v1,<base64 HMAC-SHA256>`.
 */
export const SIGNING_SECRET_PREFIX = 'whsec_';

/** Default replay window a receiver should allow around `webhook-timestamp`. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface WebhookSignatureHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

export interface VerifyWebhookInput {
  secret: string;
  headers: Partial<Record<keyof WebhookSignatureHeaders, string | undefined>>;
  body: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export type WebhookVerification =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'timestamp_out_of_range' | 'bad_signature' };

export const generateSigningSecret = (): string => `${SIGNING_SECRET_PREFIX}${randomBytes(32).toString('base64')}`;

const keyOf = (secret: string): Buffer =>
  Buffer.from(secret.startsWith(SIGNING_SECRET_PREFIX) ? secret.slice(SIGNING_SECRET_PREFIX.length) : secret, 'base64');

export const signWebhook = (secret: string, id: string, timestampSeconds: number, body: string): string =>
  `v1,${createHmac('sha256', keyOf(secret)).update(`${id}.${timestampSeconds}.${body}`).digest('base64')}`;

export const webhookHeaders = (secret: string, id: string, timestampSeconds: number, body: string): WebhookSignatureHeaders => ({
  'webhook-id': id,
  'webhook-timestamp': String(timestampSeconds),
  'webhook-signature': signWebhook(secret, id, timestampSeconds, body),
});

/** Receiver-side check (used by tests and documented for subscribers). */
export const verifyWebhook = ({
  secret,
  headers,
  body,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
}: VerifyWebhookInput): WebhookVerification => {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'missing_headers' };
  if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) return { ok: false, reason: 'timestamp_out_of_range' };
  const expected = Buffer.from(signWebhook(secret, id, Number(timestamp), body));
  const matches = signatures.split(' ').some((candidate) => {
    const actual = Buffer.from(candidate);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  return matches ? { ok: true } : { ok: false, reason: 'bad_signature' };
};
