import express, { type Express } from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATION_DISABLED, type OrganizationRow } from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import type { OrganizationContextArgs, OrganizationContextRow } from '../model/organization-context.model.js';

process.env.NODE_ENV ||= 'test';
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const { recordPlatformAccessRequest } = vi.hoisted(() => ({
  recordPlatformAccessRequest: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/platform-admin.js', () => ({ recordPlatformAccessRequest }));

const orgId = 'aaaaaaaa-0000-4000-8000-000000000001';
const otherOrgId = 'aaaaaaaa-0000-4000-8000-000000000002';
const disabledOrgId = 'aaaaaaaa-0000-4000-8000-000000000003';
const foreignOrgId = 'aaaaaaaa-0000-4000-8000-000000000004';
const userId = '11111111-1111-4111-8111-111111111111';
const expiry = '2100-01-01T00:00:00+00:00';
const profile = { id: userId, full_name: 'Sam', email: 'sam@example.test', phone: null, avatar_url: null };
const church: OrganizationRow = {
  id: orgId, name: 'Riverside', slug: 'riverside', timezone: 'America/Toronto', assignment_visibility: 'organization',
  logo_url: null, address_line1: null, address_line2: null, city: null, state_province: null, postal_code: null,
  country: null, denomination: null, member_count: null, default_folder_id: null,
  created_at: '2026-10-01T00:00:00+00:00', updated_at: '2026-10-01T00:00:00+00:00',
};
const grant = {
  capability: 'plans.edit', scope_type: 'service_type', scope_id: 'bbbbbbbb-0000-4000-8000-000000000001',
  source: 'grant', grant_id: 'cccccccc-0000-4000-8000-000000000001',
} as const;
const member: OrganizationContextRow['memberships'][number] = {
  organization_id: orgId, role: 'scheduler', access_mode: 'scoped', platform_access_expires_at: null,
  organization: null, access: [grant],
};
const tempOwner: OrganizationContextRow['memberships'][number] = {
  organization_id: otherOrgId, role: 'owner', access_mode: 'legacy', platform_access_expires_at: expiry,
  organization: null, access: [{ capability: 'people.manage', scope_type: 'organization', scope_id: null, source: 'role:owner', grant_id: null }],
};
const disabled: OrganizationContextRow['disabled_organizations'][number] = {
  organization_id: disabledOrgId, organization_name: 'Closed Church', role: 'member', disabled_reason: null,
  disabled_at: '2026-11-19T00:00:00+00:00',
};

let app: Express;
let context: OrganizationContextRow;
const rpc = vi.fn((fn: string, _args?: OrganizationContextArgs) => {
  if (fn === 'my_profile') return Promise.resolve({ data: profile, error: null });
  if (fn === 'my_org_context') return Promise.resolve({ data: context, error: null });
  throw new Error(`Unexpected RPC ${fn}`);
});
const from = vi.fn(() => { throw new Error('Unexpected database table lookup'); });
const db = { rpc, from } as unknown as Db;

beforeAll(async () => {
  const { withOrganization, requireCapability } = await import('../middleware/organization.js');
  const { errorHandler } = await import('../middleware/error-handler.js');
  const { meRouter } = await import('./me.js');
  app = express();
  app.use((req, _res, next) => {
    req.auth = { userId, email: profile.email, accessToken: 'token' };
    req.db = db;
    next();
  });
  app.use('/me', meRouter);
  app.all('/scoped', withOrganization, (req, res) => {
    res.json({ id: req.orgId, role: req.orgRole, access: req.access });
  });
  app.get('/can-edit', withOrganization, requireCapability('plans.edit'), (_req, res) => { res.sendStatus(204); });
  app.use(errorHandler);
});

beforeEach(() => {
  vi.clearAllMocks();
  context = { memberships: [], disabled_organizations: [] };
});

describe('withOrganization', () => {
  it('rejects a malformed organization selection before querying', async () => {
    const response = await request(app).get('/scoped').set('X-Organization-Id', 'invalid');
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Invalid X-Organization-Id header');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a caller without any membership in one call', async () => {
    const response = await request(app).get('/scoped');
    expect(response.status).toBe(403);
    expect(response.body.error).toBe('You are not a member of any organization yet');
    expect(rpc.mock.calls).toEqual([['my_org_context', {}]]);
    expect(from).not.toHaveBeenCalled();
  });

  it('infers a sole membership and attaches role and effective access in one call', async () => {
    context.memberships = [member];
    const response = await request(app).get('/scoped');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: orgId, role: 'scheduler',
      access: { organization_id: orgId, user_id: userId, role: 'scheduler', access_mode: 'scoped',
        can_administer_access: false, entries: [grant] },
    });
    expect(rpc.mock.calls).toEqual([['my_org_context', {}]]);
    expect(from).not.toHaveBeenCalled();
  });

  it('requires selection with multiple memberships and honors the header before the query', async () => {
    context.memberships = [member, tempOwner];
    const ambiguous = await request(app).get('/scoped');
    expect(ambiguous.status).toBe(400);
    expect(ambiguous.body.details).toEqual({ organization_ids: [orgId, otherOrgId] });
    const query = await request(app).get('/scoped').query({ organization_id: orgId });
    expect(query.body.id).toBe(orgId);
    const selected = await request(app).get('/scoped').query({ organization_id: orgId }).set('X-Organization-Id', otherOrgId);
    expect(selected.body).toMatchObject({ id: otherOrgId, role: 'owner' });
    expect(rpc.mock.calls).toEqual([
      ['my_org_context', {}],
      ['my_org_context', { p_org: orgId }],
      ['my_org_context', { p_org: otherOrgId }],
    ]);
  });

  it('uses the disabled-church error for an applicable selection and keeps foreign ids generic', async () => {
    context.disabled_organizations = [disabled];
    const fallback = await request(app).get('/scoped');
    expect(fallback.status).toBe(403);
    expect(fallback.body).toEqual({
      code: ORGANIZATION_DISABLED, error: 'This church has been disabled',
      details: { organization_id: disabledOrgId, organization_name: 'Closed Church', disabled_reason: null },
    });
    context.memberships = [member];
    const selected = await request(app).get('/scoped').set('X-Organization-Id', disabledOrgId);
    expect(selected.status).toBe(403);
    expect(selected.body).toEqual(fallback.body);
    const foreign = await request(app).get('/scoped').set('X-Organization-Id', foreignOrgId);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error).toBe('You are not a member of that organization');
    expect(rpc.mock.calls).toEqual([
      ['my_org_context', {}],
      ['my_org_context', { p_org: disabledOrgId }],
      ['my_org_context', { p_org: foreignOrgId }],
    ]);
  });

  it('uses current grants on each request', async () => {
    context.memberships = [member];
    expect((await request(app).get('/can-edit')).status).toBe(204);
    context.memberships = [{ ...member, access: [] }];
    expect((await request(app).get('/can-edit')).status).toBe(403);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('audits temporary-owner writes after the response and skips reads and ordinary members', async () => {
    context.memberships = [tempOwner];
    expect((await request(app).get('/scoped')).status).toBe(200);
    expect(recordPlatformAccessRequest).not.toHaveBeenCalled();
    expect((await request(app).post('/scoped?secret=value')).status).toBe(200);
    expect(recordPlatformAccessRequest).toHaveBeenCalledExactlyOnceWith({ userId }, {
      organizationId: otherOrgId, method: 'POST', path: '/scoped', status: 200,
    });
    context.memberships = [member];
    expect((await request(app).post('/scoped')).status).toBe(200);
    expect(recordPlatformAccessRequest).toHaveBeenCalledTimes(1);
  });
});

describe('GET /me', () => {
  it('returns the profile, per-church access and disabled churches in two calls', async () => {
    const otherChurch = { ...church, id: otherOrgId, name: 'Second Church', slug: 'second' };
    context.memberships = [{ ...member, organization: church }, { ...tempOwner, organization: otherChurch }];
    context.disabled_organizations = [disabled];
    const response = await request(app).get('/me').set('X-Organization-Id', orgId);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      profile,
      memberships: [
        { organization: church, role: 'scheduler', platform_access_expires_at: null,
          access: { organization_id: orgId, user_id: userId, role: 'scheduler', access_mode: 'scoped',
            can_administer_access: false, entries: [grant] } },
        { organization: otherChurch, role: 'owner', platform_access_expires_at: expiry,
          access: { organization_id: otherOrgId, user_id: userId, role: 'owner', access_mode: 'legacy',
            can_administer_access: true, entries: tempOwner.access } },
      ],
      disabled_organizations: [disabled],
    });
    expect(rpc.mock.calls).toEqual([['my_profile'], ['my_org_context', { p_all: true }]]);
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps empty membership and disabled-church arrays for a caller with no churches', async () => {
    const response = await request(app).get('/me');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ profile, memberships: [], disabled_organizations: [] });
  });
});
