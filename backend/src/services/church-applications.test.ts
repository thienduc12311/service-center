import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubmitChurchApplicationInput } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import type { PlatformEmail } from './platform-email.js';

/**
 * Submitting a church application as the applicant. The database is a fake;
 * the one-pending-application rule and the column grants live in migration
 * 20261116000000 (see supabase/tests/platform-admin.sql).
 */

const fixture = vi.hoisted(() => {
  process.env.NODE_ENV = 'test';
  process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
  process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';
  return {
    adminIds: ['admin-1', 'admin-2'] as string[],
    profiles: [
      { id: 'admin-1', full_name: 'Pat', email: 'pat@example.test' },
      { id: 'admin-2', full_name: 'No Email', email: null },
      { id: 'user-1', full_name: 'Ada Applicant', email: 'ada@example.test' },
    ] as Array<{ id: string; full_name: string | null; email: string | null }>,
    emails: [] as PlatformEmail[],
    failAdminLookup: false,
  };
});

vi.mock('../lib/supabase.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabase.js')>();
  return {
    ...actual,
    adminDb: {
      rpc: async () =>
        fixture.failAdminLookup
          ? { data: null, error: { code: 'XX000', message: 'boom' } }
          : { data: fixture.adminIds, error: null },
      from: () => ({
        select: () => ({
          in: async (_column: string, ids: string[]) => ({
            data: fixture.profiles.filter((profile) => ids.includes(profile.id)),
            error: null,
          }),
        }),
      }),
    },
  };
});

vi.mock('./platform-email.js', () => ({
  sendPlatformEmails: async (emails: readonly PlatformEmail[]) => {
    fixture.emails.push(...emails);
  },
}));

import { submitApplication } from './church-applications.js';

const input: SubmitChurchApplicationInput = {
  church_name: 'Grace Atlanta',
  leader_name: 'Pastor Lee',
  contact_phone: null,
  website: null,
  address_line1: null,
  address_line2: null,
  city: 'Atlanta',
  state_province: 'GA',
  postal_code: null,
  country: 'USA',
  expected_member_count: 120,
  timezone: 'America/New_York',
  note: null,
};

const storedRow = {
  id: 'app-1',
  applicant_id: 'user-1',
  status: 'pending',
  ...input,
  rejection_reason: null,
  reviewed_at: null,
  organization_id: null,
  created_at: '2026-11-16T00:00:00Z',
  updated_at: '2026-11-16T00:00:00Z',
};

const callerDb = (result: { data: unknown; error: { code: string; message: string } | null }): Db =>
  ({
    from: () => ({ insert: () => ({ select: () => ({ single: async () => result }) }) }),
  }) as unknown as Db;

beforeEach(() => {
  fixture.emails = [];
  fixture.failAdminLookup = false;
});

describe('submitApplication', () => {
  it('stores the application and emails every platform admin who has an email', async () => {
    const application = await submitApplication(
      { db: callerDb({ data: storedRow, error: null }), userId: 'user-1' },
      input,
    );
    expect(application).toMatchObject({ id: 'app-1', status: 'pending', church_name: 'Grace Atlanta' });
    expect(application).not.toHaveProperty('applicant_id');
    expect(fixture.emails.map((email) => email.to)).toEqual(['pat@example.test']);
    expect(fixture.emails[0]?.subject).toBe('New church application: Grace Atlanta');
    expect(fixture.emails[0]?.text).toContain('Ada Applicant applied to register Grace Atlanta (Atlanta, USA)');
    expect(fixture.emails[0]?.text).toContain('/applications/app-1');
  });

  it('explains a second pending application', async () => {
    await expect(
      submitApplication(
        { db: callerDb({ data: null, error: { code: '23505', message: 'duplicate key' } }), userId: 'user-1' },
        input,
      ),
    ).rejects.toMatchObject({ status: 409, code: 'application_pending' });
    expect(fixture.emails).toEqual([]);
  });

  it('keeps the application when telling the admins fails', async () => {
    fixture.failAdminLookup = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const application = await submitApplication(
      { db: callerDb({ data: storedRow, error: null }), userId: 'user-1' },
      input,
    );
    expect(application.id).toBe('app-1');
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});
