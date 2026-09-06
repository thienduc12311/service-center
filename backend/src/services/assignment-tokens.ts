import { randomBytes } from 'node:crypto';
import { hashInviteToken } from './invitations.js';

export interface GeneratedAssignmentToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export const generateAssignmentToken = (serviceDate: string): GeneratedAssignmentToken => {
  const token = randomBytes(32).toString('base64url');
  const service = new Date(serviceDate);
  if (Number.isNaN(service.getTime())) throw new Error('Cannot create an assignment token for an invalid service date');
  const expiresAt = new Date(service.getTime() + 24 * 60 * 60 * 1000);
  return { token, tokenHash: hashInviteToken(token), expiresAt };
};
