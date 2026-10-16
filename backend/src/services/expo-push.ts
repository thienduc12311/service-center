import type { PushTransportMode } from '@service-center/shared';
import { config } from '../config.js';
import type { PushMessage } from '../model/notification.model.js';
import { DeliveryError } from '../model/delivery.model.js';

/** Expo's verdict on one message: accepted for delivery, or why not. */
export interface PushTicketResult {
  token: string;
  accepted: boolean;
  /** Expo's ticket id, when accepted. */
  ticketId: string | null;
  /** Expo's error name when refused, e.g. `DeviceNotRegistered`. */
  error: string | null;
}

/**
 * Delivery to Expo's push service. Pluggable for the same reason the email
 * transport is: tests and local development must not reach the network.
 * A ticket only means Expo accepted the message; whether the device showed
 * it is a later receipt this server does not poll.
 */
export interface PushTransport {
  readonly mode: PushTransportMode;
  /** Throws a `DeliveryError` when Expo could not be asked at all. */
  send(messages: PushMessage[]): Promise<PushTicketResult[]>;
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10_000;

/** The subset of Expo's response we act on. */
interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoResponse {
  data?: ExpoTicket[];
  errors?: Array<{ message: string }>;
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

/** An HTTP failure from Expo, mapped to what the worker should do. */
export const classifyExpoHttpStatus = (status: number): DeliveryError => {
  if (status === 429) return new DeliveryError('provider_rate_limited', 'retry', 60);
  if (status >= 500) return new DeliveryError('provider_unavailable', 'retry', 120);
  if (status === 401 || status === 403) return new DeliveryError('provider_misconfigured', 'fail');
  return new DeliveryError('provider_rejected', 'fail');
};

const isExpoResponse = (value: unknown): value is ExpoResponse =>
  typeof value === 'object' && value !== null && (!('data' in value) || Array.isArray(value.data));

export const expoPushTransport: PushTransport = {
  mode: 'expo',
  async send(messages) {
    const results: PushTicketResult[] = [];

    for (const batch of chunk(messages, CHUNK_SIZE)) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (config.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${config.EXPO_ACCESS_TOKEN}`;
      }

      let response: Response;
      try {
        response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        // No answer: Expo may or may not have queued these.
        throw new DeliveryError('provider_timeout', 'ambiguous');
      }
      if (!response.ok) throw classifyExpoHttpStatus(response.status);

      const payload: unknown = await response.json();
      const tickets = isExpoResponse(payload) ? payload.data ?? [] : [];
      batch.forEach((message, index) => {
        const ticket = tickets[index];
        results.push({
          token: message.to,
          accepted: ticket?.status === 'ok',
          ticketId: ticket?.status === 'ok' ? ticket.id ?? null : null,
          error: ticket?.status === 'ok' ? null : ticket?.details?.error ?? 'MissingTicket',
        });
      });
    }

    return results;
  },
};

/** Logs instead of sending. The default outside production. */
const consolePushTransport: PushTransport = {
  mode: 'simulated',
  async send(messages) {
    if (!config.isTest) console.info(`[push] ${messages.length} simulated push notification(s)`);
    return messages.map((message) => ({ token: message.to, accepted: true, ticketId: null, error: null }));
  },
};

let transport: PushTransport = config.PUSH_ENABLED ? expoPushTransport : consolePushTransport;

export const setPushTransport = (next: PushTransport): void => {
  transport = next;
};

export const pushTransport = (): PushTransport => transport;
