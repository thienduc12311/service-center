import { createHmac, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { hashInviteToken } from './invitations.js';

export interface GeneratedAssignmentToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/** F08: a link token for one delivery and plan, plus whether retries repeat it. */
export interface DeliveryLinkToken extends GeneratedAssignmentToken {
  /** True when every attempt of this delivery mints the same token. */
  deterministic: boolean;
}

const expiryFor = (serviceDate: string): Date => {
  const service = new Date(serviceDate);
  if (Number.isNaN(service.getTime())) throw new Error('Cannot create an assignment token for an invalid service date');
  return new Date(service.getTime() + 24 * 60 * 60 * 1000);
};

export const generateAssignmentToken = (serviceDate: string): GeneratedAssignmentToken => {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token), expiresAt: expiryFor(serviceDate) };
};

/**
 * The token emailed for one plan in one delivery. With a secret it is an
 * HMAC of (delivery, plan): unguessable without the key, identical on each
 * retry of that delivery, and different for every other delivery or plan.
 */
export const deliveryLinkToken = (
  deliveryId: string,
  planId: string,
  serviceDate: string,
  secret: string | undefined = config.DELIVERY_LINK_SECRET,
): DeliveryLinkToken => {
  if (!secret) return { ...generateAssignmentToken(serviceDate), deterministic: false };
  const token = createHmac('sha256', secret).update(`assignment-link:v1:${deliveryId}:${planId}`).digest('base64url');
  return { token, tokenHash: hashInviteToken(token), expiresAt: expiryFor(serviceDate), deterministic: true };
};
