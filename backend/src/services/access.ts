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
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { mapEffectiveAccess, mapScopeAccess, parseExplanation, type NamedGrant } from '../model/access.model.js';

interface MembershipRow {
  role: OrgRole;
  access_mode: AccessMode;
}

/** The caller's effective access, resolved by the database (`my_effective_access`). */
export const loadMyAccess = async (
  db: Db,
  orgId: string,
  userId: string,
  membership: MembershipRow,
): Promise<EffectiveAccess> => {
  const rows = await unwrap(db.rpc('my_effective_access', { p_org: orgId }));
  return mapEffectiveAccess(
    { organizationId: orgId, userId, role: membership.role, accessMode: membership.access_mode },
    rows ?? [],
  );
};

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
    unwrap(
      raw(db)
        .from('organization_members')
        .select('user_id, role, access_mode, profile:profiles(full_name, avatar_url)')
        .eq('organization_id', orgId)
        .eq('status', 'active'),
    ) as unknown as Promise<MemberWithProfile[]>,
    unwrap(db.from('access_grants').select('*').eq('organization_id', orgId)),
  ]);
  const byUser = new Map<string, AccessGrantRow[]>();
  for (const grant of grants ?? []) byUser.set(grant.user_id, [...(byUser.get(grant.user_id) ?? []), grant]);
  return (members ?? [])
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

const withNames = async (db: Db, grants: readonly AccessGrantRow[]): Promise<NamedGrant[]> => {
  const ids = [...new Set(grants.map((grant) => grant.user_id))];
  const profiles = ids.length
    ? ((await unwrap(db.from('profiles').select('id, full_name').in('id', ids))) ?? [])
    : [];
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  return grants.map((grant) => ({ ...grant, full_name: names.get(grant.user_id) ?? null }));
};

export interface ScopeRef {
  db: Db;
  orgId: string;
  scopeType: AccessScopeType;
  scopeId: string | null;
}

export const loadScopeAccess = async ({ db, orgId, scopeType, scopeId }: ScopeRef): Promise<ScopeAccess> => {
  let query = db.from('access_grants').select('*').eq('organization_id', orgId).eq('scope_type', scopeType);
  const column = scopeColumn(scopeType);
  if (column && scopeId) query = query.eq(column, scopeId);
  const grants = (await unwrap(query.order('created_at'))) ?? [];
  return mapScopeAccess(scopeType, scopeId, await withNames(db, grants));
};

export interface ReplaceScopeAccessInput extends ScopeRef {
  input: ReplaceScopeGrantsInput;
}

/** PUT …/access: the whole set at one scope, atomically (`replace_scope_grants`). */
export const replaceScopeAccess = async ({ db, orgId, scopeType, scopeId, input }: ReplaceScopeAccessInput): Promise<ScopeAccess> => {
  const grants = await unwrap(
    db.rpc('replace_scope_grants', {
      p_org: orgId,
      p_scope_type: scopeType,
      p_scope_id: scopeId,
      p_grants: input.grants,
    }),
  );
  return mapScopeAccess(scopeType, scopeId, await withNames(db, grants ?? []));
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
