import { randomBytes } from 'node:crypto';
import { hashInviteToken } from './invitations.js';

export interface GeneratedCalendarFeedToken {
  token: string;
  tokenHash: string;
}

export const generateCalendarFeedToken = (): GeneratedCalendarFeedToken => {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
};
