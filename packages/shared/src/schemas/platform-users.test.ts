import { describe, expect, it } from 'vitest';
import { blockUserSchema, deleteUserSchema, invitePlatformAdminSchema } from './platform-users.js';

describe('blockUserSchema', () => {
  it('trims the reason and refuses an empty or long one', () => {
    expect(blockUserSchema.parse({ reason: '  Spam  ' })).toEqual({ reason: 'Spam' });
    expect(blockUserSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(blockUserSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('deleteUserSchema', () => {
  it('normalizes the typed email for comparison', () => {
    expect(deleteUserSchema.parse({ confirm_email: ' Uma@Example.COM ' })).toEqual({ confirm_email: 'uma@example.com' });
    expect(deleteUserSchema.safeParse({ confirm_email: '' }).success).toBe(false);
  });
});

describe('invitePlatformAdminSchema', () => {
  it('lower-cases the email and defaults to 7 days', () => {
    expect(invitePlatformAdminSchema.parse({ email: ' New@Example.com ' })).toEqual({ email: 'new@example.com', days: 7 });
    expect(invitePlatformAdminSchema.safeParse({ email: 'nope' }).success).toBe(false);
    expect(invitePlatformAdminSchema.safeParse({ email: 'a@b.co', days: 31 }).success).toBe(false);
  });
});
