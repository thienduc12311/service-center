import { describe, expect, it } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { EffectiveAccess, ServiceTypeFolderRow } from '@service-center/shared';
import { mapEffectiveAccess, parseExplanation } from './access.model.js';
import { buildFolderTree } from './folder.model.js';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key-that-is-long-enough';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key-long-enough';

const membership = { organizationId: 'org', userId: 'riley', role: 'member', accessMode: 'legacy' } as const;

describe('mapEffectiveAccess', () => {
  it('keeps grants and drops rows with an unknown source', () => {
    const access = mapEffectiveAccess(membership, [
      { capability: 'scheduling.manage', scope_type: 'team', scope_id: 'band', source: 'grant', grant_id: 'g1' },
      { capability: 'plans.edit', scope_type: 'organization', scope_id: null, source: 'something-new', grant_id: null },
    ]);
    expect(access.entries).toEqual([
      { capability: 'scheduling.manage', scope_type: 'team', scope_id: 'band', source: 'grant', grant_id: 'g1' },
    ]);
    expect(access.can_administer_access).toBe(false);
  });

  it('lets only owners and admins administer access, whatever they hold', () => {
    expect(mapEffectiveAccess({ ...membership, role: 'admin' }, []).can_administer_access).toBe(true);
    expect(mapEffectiveAccess({ ...membership, role: 'scheduler' }, []).can_administer_access).toBe(false);
  });
});

describe('parseExplanation', () => {
  it('accepts the database shape', () => {
    const explanation = parseExplanation({
      allowed: false,
      capability: 'scheduling.manage',
      role: 'member',
      access_mode: 'legacy',
      reasons: [],
      denial: 'grant_outside_scope',
    });
    expect(explanation.denial).toBe('grant_outside_scope');
  });

  it('refuses anything it does not recognise', () => {
    expect(() => parseExplanation({ allowed: 'yes' })).toThrow();
    expect(() =>
      parseExplanation({ allowed: true, capability: 'admin.everything', role: null, access_mode: null, reasons: [], denial: null }),
    ).toThrow();
  });
});

const folder = (id: string, parent: string | null, name: string, sort = 0): ServiceTypeFolderRow => ({
  id,
  organization_id: 'org',
  parent_id: parent,
  name,
  sort_order: sort,
  revision: 0,
  archived_at: null,
  created_by: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

describe('buildFolderTree', () => {
  it('nests folders, files service types and keeps orphans reachable', () => {
    const tree = buildFolderTree(
      [folder('b', null, 'Campus B', 1), folder('a', null, 'Campus A', 0), folder('y', 'a', 'Youth'), folder('o', 'gone', 'Orphan')],
      [
        { id: 'st1', folder_id: 'y' },
        { id: 'st2', folder_id: null },
        { id: 'st3', folder_id: 'archived-folder' },
      ],
      'missing',
    );
    expect(tree.folders.map((f) => f.name)).toEqual(['Campus A', 'Orphan', 'Campus B']);
    expect(tree.folders[0]?.children[0]?.service_type_ids).toEqual(['st1']);
    expect(tree.unfiled_service_type_ids).toEqual(['st2', 'st3']);
    expect(tree.landing_folder_id).toBeNull();
  });
});

describe('requireCapability', () => {
  const access = (entries: EffectiveAccess['entries']): EffectiveAccess => ({
    organization_id: 'org',
    user_id: 'riley',
    role: 'member',
    access_mode: 'legacy',
    can_administer_access: false,
    entries,
  });

  it('passes a scoped holder through and refuses everyone else with 403', async () => {
    const { requireCapability } = await import('../middleware/organization.js');
    const guard = requireCapability('scheduling.manage');
    const calls: unknown[] = [];
    const next: NextFunction = (error?: unknown) => {
      calls.push(error);
    };

    guard(
      { access: access([{ capability: 'scheduling.manage', scope_type: 'team', scope_id: 'band', source: 'grant', grant_id: 'g' }]) } as Request,
      {} as Response,
      next,
    );
    expect(calls).toEqual([undefined]);

    guard({ access: access([]) } as Request, {} as Response, next);
    expect(calls[1]).toMatchObject({ status: 403 });
  });
});
