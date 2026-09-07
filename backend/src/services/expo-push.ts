import { config } from '../config.js';
import type { PushMessage } from '../model/notification.model.js';

/**
 * Delivery to Expo's push service. Pluggable for the same reason the email
 * transport is: tests and local development must not reach the network.
 */
export interface PushTransport {
  send(messages: PushMessage[]): Promise<PushDeliveryResult>;
}

export interface PushDeliveryResult {
  sent: number;
  /** Tokens Expo reported as no longer registered — safe to delete. */
  invalidTokens: string[];
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const CHUNK_SIZE = 100;

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

export const expoPushTransport: PushTransport = {
  async send(messages) {
    const result: PushDeliveryResult = { sent: 0, invalidTokens: [] };

    for (const batch of chunk(messages, CHUNK_SIZE)) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (config.EXPO_ACCESS_TOKEN) {
        headers.Authorization = `Bearer ${config.EXPO_ACCESS_TOKEN}`;
      }

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        // A push that doesn't arrive must never fail the request that caused
        // it — the in-app notification is already stored either way.
        console.warn(`[push] Expo rejected a batch of ${batch.length} (HTTP ${response.status})`);
        continue;
      }

      const payload = (await response.json()) as ExpoResponse;
      for (const [index, ticket] of (payload.data ?? []).entries()) {
        if (ticket.status === 'ok') {
          result.sent += 1;
          continue;
        }
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const token = batch[index]?.to;
          if (token) result.invalidTokens.push(token);
        } else {
          console.warn(`[push] Expo ticket error: ${ticket.details?.error ?? ticket.message ?? 'unknown'}`);
        }
      }
    }

    return result;
  },
};

/** Logs instead of sending. The default outside production. */
const consolePushTransport: PushTransport = {
  async send(messages) {
    if (!config.isTest) console.info(`[push] ${messages.length} push notification(s) prepared`);
    return { sent: messages.length, invalidTokens: [] };
  },
};

let transport: PushTransport = config.PUSH_ENABLED ? expoPushTransport : consolePushTransport;

export const setPushTransport = (next: PushTransport): void => {
  transport = next;
};

export const sendPushMessages = (messages: PushMessage[]): Promise<PushDeliveryResult> =>
  messages.length ? transport.send(messages) : Promise.resolve({ sent: 0, invalidTokens: [] });
