import { z } from 'zod';
import { uuid } from './common.js';
import { notificationTypeSchema } from './notification.js';

/** 32 random bytes encoded as base64url, as issued by both public token services. */
export const externalLinkTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);

export const pushNavigationPayloadSchema = z
  .object({
    notification_id: uuid,
    type: notificationTypeSchema,
    organization_id: uuid,
    plan_id: uuid.nullable(),
  })
  .strict();

export type PushNavigationPayload = z.infer<typeof pushNavigationPayloadSchema>;

export type PublicNavigationIntent =
  | { kind: 'accept-invite'; token: string }
  | { kind: 'assignment-response'; token: string };

export type PrivateNavigationIntent =
  | {
      kind: 'plan';
      intentId: string;
      organizationId: string;
      planId: string;
      notificationId: string | null;
      notificationType: PushNavigationPayload['type'] | null;
    }
  | {
      kind: 'notifications';
      intentId: string;
      organizationId: string;
      notificationId: string;
      notificationType: PushNavigationPayload['type'];
    };

export type NavigationIntent = PublicNavigationIntent | PrivateNavigationIntent;

export const navigationFailureReasonSchema = z.enum([
  'invalid',
  'no-access',
  'unavailable',
  'network',
]);
export type NavigationFailureReason = z.infer<typeof navigationFailureReasonSchema>;

export type ExternalNavigationParseResult =
  | { status: 'accepted'; intent: NavigationIntent }
  | { status: 'ignored' }
  | { status: 'rejected' };

export interface ExternalNavigationPolicy {
  /** Custom app schemes without the trailing colon. */
  schemes: readonly string[];
  /** Exact HTTPS hostnames allowed to open the app. */
  hosts: readonly string[];
}

const pathFor = (url: URL, customScheme: boolean): string => {
  if (!customScheme || !url.hostname) return url.pathname;
  return `/${url.hostname}${url.pathname}`;
};

/** Parses only the deliberately supported external URL surface. */
export const parseExternalNavigationUrl = (
  value: unknown,
  policy: ExternalNavigationPolicy,
): ExternalNavigationParseResult => {
  if (typeof value !== 'string') return { status: 'rejected' };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { status: 'rejected' };
  }

  const scheme = url.protocol.replace(/:$/, '').toLowerCase();
  const customScheme = policy.schemes.map((entry) => entry.toLowerCase()).includes(scheme);
  const isHttps = scheme === 'https';
  if (!customScheme && !isHttps) return { status: 'ignored' };

  if (
    isHttps &&
    (url.username !== '' ||
      url.password !== '' ||
      url.port !== '' ||
      !policy.hosts.map((entry) => entry.toLowerCase()).includes(url.hostname.toLowerCase()))
  ) {
    return { status: 'rejected' };
  }

  const path = pathFor(url, customScheme).replace(/\/+$/, '') || '/';
  if (path === '/accept-invite' || path === '/respond') {
    const token = externalLinkTokenSchema.safeParse(url.searchParams.get('token'));
    if (!token.success) return { status: 'rejected' };
    return {
      status: 'accepted',
      intent:
        path === '/accept-invite'
          ? { kind: 'accept-invite', token: token.data }
          : { kind: 'assignment-response', token: token.data },
    };
  }

  // Private URLs land on an inert ingress route first; only the validated
  // intent handler may translate them to the real authenticated screen.
  const planMatch = path.match(/^\/open\/plan\/([^/]+)$/);
  if (planMatch) {
    const planId = uuid.safeParse(planMatch[1]);
    const organizationId = uuid.safeParse(url.searchParams.get('organization_id'));
    if (!planId.success || !organizationId.success) return { status: 'rejected' };
    return {
      status: 'accepted',
      intent: {
        kind: 'plan',
        intentId: `link:plan:${organizationId.data}:${planId.data}`,
        organizationId: organizationId.data,
        planId: planId.data,
        notificationId: null,
        notificationType: null,
      },
    };
  }

  return { status: 'rejected' };
};

/** Converts an untrusted Expo notification data object into one supported target. */
export const parsePushNavigationIntent = (value: unknown): ExternalNavigationParseResult => {
  const payload = pushNavigationPayloadSchema.safeParse(value);
  if (!payload.success) return { status: 'rejected' };

  if (payload.data.plan_id) {
    return {
      status: 'accepted',
      intent: {
        kind: 'plan',
        intentId: `push:${payload.data.notification_id}`,
        organizationId: payload.data.organization_id,
        planId: payload.data.plan_id,
        notificationId: payload.data.notification_id,
        notificationType: payload.data.type,
      },
    };
  }

  return {
    status: 'accepted',
    intent: {
      kind: 'notifications',
      intentId: `push:${payload.data.notification_id}`,
      organizationId: payload.data.organization_id,
      notificationId: payload.data.notification_id,
      notificationType: payload.data.type,
    },
  };
};
