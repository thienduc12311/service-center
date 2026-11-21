import type {
  AccessCapability,
  AccessGrantRow,
  AccessMember,
  AccessMode,
  AccessScopeType,
  CapabilityExplanation,
  EffectiveAccess,
  ExplainCapabilityQuery,
  OrgRole,
  ReplaceScopeGrantsInput,
  ScopeAccess,
} from '@service-center/shared';
import { fetchAllPages, inChunks } from '../lib/paging.js';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { mapEffectiveAccess, mapScopeAccess, parseExplanation, type NamedGrant } from '../model/access.model.js';

/** Another member's access (administrators; the database enforces it). */
export const loadMemberAccess = async (db: Db, orgId: string, userId: string): Promise<EffectiveAccess> => {
  const membership = await unwrap(
    db
      .from('organization_members')
      .select('role, access_mode')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
  if (!membership) throw HttpError.notFound('That person is not in this organization');
  const rows = await unwrap(db.rpc('member_effective_access', { p_org: orgId, p_user: userId }));
  return mapEffectiveAccess(
    { organizationId: orgId, userId, role: membership.role, accessMode: membership.access_mode },
    rows ?? [],
  );
};

export const explainAccess = async (
  db: Db,
  orgId: string,
  query: ExplainCapabilityQuery,
): Promise<CapabilityExplanation> =>
  parseExplanation(
    await unwrap(
      db.rpc('explain_capability', {
        p_org: orgId,
        p_user: query.user_id,
        p_cap: query.capability,
        p_service_type: query.service_type_id ?? null,
        p_team: query.team_id ?? null,
      }),
    ),
  );

interface MemberWithProfile {
  user_id: string;
  role: OrgRole;
  access_mode: AccessMode;
  profile: { full_name: string | null; avatar_url: string | null } | null;
}

export const listAccessMembers = async (db: Db, orgId: string): Promise<AccessMember[]> => {
  const [members, grants] = await Promise.all([
    fetchAllPages(
      async (from, to) =>
        (await unwrap(
          raw(db)
            .from('organization_members')
            .select('user_id, role, access_mode, profile:profiles(full_name, avatar_url)')
            .eq('organization_id', orgId)
            .eq('status', 'active')
            .order('user_id')
            .range(from, to),
        )) as unknown as MemberWithProfile[] | null,
    ),
    fetchAllPages(async (from, to) =>
      unwrap(db.from('access_grants').select('*').eq('organization_id', orgId).order('id').range(from, to)),
    ),
  ]);
  const byUser = new Map<string, AccessGrantRow[]>();
  for (const grant of grants) byUser.set(grant.user_id, [...(byUser.get(grant.user_id) ?? []), grant]);
  return members
    .map((member) => ({
      user_id: member.user_id,
      full_name: member.profile?.full_name ?? null,
      avatar_url: member.profile?.avatar_url ?? null,
      role: member.role,
      access_mode: member.access_mode,
      grants: byUser.get(member.user_id) ?? [],
    }))
    .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));
};

export interface SetAccessModeInput {
  db: Db;
  orgId: string;
  userId: string;
  accessMode: AccessMode;
}

export const setAccessMode = async ({ db, orgId, userId, accessMode }: SetAccessModeInput): Promise<AccessMember> => {
  const updated = await unwrap(
    db
      .from('organization_members')
      .update({ access_mode: accessMode })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('That person is not in this organization');
  const member = (await listAccessMembers(db, orgId)).find((row) => row.user_id === userId);
  if (!member) throw HttpError.notFound('That person is not in this organization');
  return member;
};

const scopeColumn = (scope: AccessScopeType): 'service_type_id' | 'team_id' | 'folder_id' | null =>
  scope === 'service_type' ? 'service_type_id' : scope === 'team' ? 'team_id' : scope === 'folder' ? 'folder_id' : null;

/** Grantee names, looked up in URL-safe chunks (a scope can have hundreds of grantees, W9-DATA-D2). */
const withNames = async (db: Db, grants: readonly AccessGrantRow[]): Promise<NamedGrant[]> => {
  const ids = [...new Set(grants.map((grant) => grant.user_id))];
  const profiles = await inChunks(ids, (chunk) => unwrap(db.from('profiles').select('id, full_name').in('id', chunk)));
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  return grants.map((grant) => ({ ...grant, full_name: names.get(grant.user_id) ?? null }));
};

export interface ScopeRef {
  db: Db;
  orgId: string;
  scopeType: AccessScopeType;
  scopeId: string | null;
}

/** Every grant at one scope, paged past PostgREST's row cap (W9-DATA-D2). */
export const loadScopeAccess = async ({ db, orgId, scopeType, scopeId }: ScopeRef): Promise<ScopeAccess> => {
  const column = scopeColumn(scopeType);
  const grants = await fetchAllPages(async (from, to) => {
    let query = db.from('access_grants').select('*').eq('organization_id', orgId).eq('scope_type', scopeType);
    if (column && scopeId) query = query.eq(column, scopeId);
    return unwrap(query.order('created_at').order('id').range(from, to));
  });
  return mapScopeAccess(scopeType, scopeId, await withNames(db, grants));
};

export interface ReplaceScopeAccessInput extends ScopeRef {
  input: ReplaceScopeGrantsInput;
}

/**
 * PUT …/access: the whole set at one scope, atomically (`replace_scope_grants`).
 * The function's own result is capped at PostgREST's row limit and cannot be
 * paged without running it again, so the committed set is re-read page by page.
 */
export const replaceScopeAccess = async (ref: ReplaceScopeAccessInput): Promise<ScopeAccess> => {
  const { db, orgId, scopeType, scopeId, input } = ref;
  await unwrap(
    db.rpc('replace_scope_grants', {
      p_org: orgId,
      p_scope_type: scopeType,
      p_scope_id: scopeId,
      p_grants: input.grants,
    }),
  );
  return loadScopeAccess({ db, orgId, scopeType, scopeId });
};

/** Server-side precondition check with the same rule as RLS, for clearer errors. */
export const hasCapability = async (
  db: Db,
  orgId: string,
  capability: AccessCapability,
  scope: { serviceTypeId?: string | null; teamId?: string | null } = {},
): Promise<boolean> =>
  Boolean(
    await unwrap(
      db.rpc('has_capability', {
        p_org: orgId,
        p_cap: capability,
        p_service_type: scope.serviceTypeId ?? null,
        p_team: scope.teamId ?? null,
      }),
    ),
  );
