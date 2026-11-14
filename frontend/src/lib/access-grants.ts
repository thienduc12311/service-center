import type {
  AccessCapability,
  AccessGrantRow,
  AccessScopeType,
  ReplaceScopeGrantsInput,
  ScopeAccess,
} from '@service-center/shared';
import { api } from './api';

/** Where a grant applies: the whole church, or one folder, service type or team. */
export interface GrantScope {
  scopeType: AccessScopeType;
  /** Null only for the organization scope. */
  scopeId: string | null;
}

/** One permission for one member at one scope. */
export interface MemberGrantChange extends GrantScope {
  userId: string;
  capability: AccessCapability;
}

export type GrantChangeKind = 'add' | 'remove';

interface ScopeAccessEndpoints {
  load: () => Promise<ScopeAccess>;
  save: (input: ReplaceScopeGrantsInput) => Promise<ScopeAccess>;
}

const endpointsFor = ({ scopeType, scopeId }: GrantScope): ScopeAccessEndpoints => {
  if (scopeType === 'organization') {
    return { load: () => api.organizationAccess(), save: (input) => api.replaceOrganizationAccess(input) };
  }
  if (!scopeId) throw new Error(`A ${scopeType} grant needs a scope id`);
  switch (scopeType) {
    case 'folder':
      return { load: () => api.folderAccess(scopeId), save: (input) => api.replaceFolderAccess(scopeId, input) };
    case 'service_type':
      return {
        load: () => api.serviceTypeAccess(scopeId),
        save: (input) => api.replaceServiceTypeAccess(scopeId, input),
      };
    case 'team':
      return { load: () => api.teamAccess(scopeId), save: (input) => api.replaceTeamAccess(scopeId, input) };
  }
};

/**
 * Adds or removes one member's permission at one scope. The scope API stores
 * a whole set at once, so this re-reads the current set first: a change made
 * by another administrator a moment ago is kept, not overwritten.
 */
export const changeMemberGrant = async (kind: GrantChangeKind, change: MemberGrantChange): Promise<ScopeAccess> => {
  const { load, save } = endpointsFor(change);
  const current = (await load()).grants.map((grant) => ({ user_id: grant.user_id, capability: grant.capability }));
  const isTarget = (grant: ReplaceScopeGrantsInput['grants'][number]) =>
    grant.user_id === change.userId && grant.capability === change.capability;
  const grants =
    kind === 'add'
      ? current.some(isTarget)
        ? current
        : [...current, { user_id: change.userId, capability: change.capability }]
      : current.filter((grant) => !isTarget(grant));
  return save({ grants });
};

/** The scope a stored grant row applies at. */
export const scopeOfGrant = (grant: AccessGrantRow): GrantScope => ({
  scopeType: grant.scope_type,
  scopeId: grant.folder_id ?? grant.service_type_id ?? grant.team_id ?? null,
});

/** Stable key for grouping grants by scope. */
export const scopeKey = ({ scopeType, scopeId }: GrantScope): string => `${scopeType}:${scopeId ?? ''}`;
