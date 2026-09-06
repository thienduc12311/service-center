import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

export const INVITE_TTL_DAYS = 7;

export interface GeneratedInviteToken {
  /** The raw token — only ever sent to the invitee, never stored. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const generateInviteToken = (): GeneratedInviteToken => {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  };
};

export const inviteAcceptUrl = (token: string): string =>
  `${config.APP_URL}/accept-invite?token=${token}`;
