import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccessCapability, AccessMember, AccessScopeType, ServiceTypeFolderNode } from '@service-center/shared';
import { scopeKey, scopeOfGrant, type GrantScope } from '../../lib/access-grants';
import { useFolderTree, useServiceTypes, useTeams } from '../../hooks/queries';

/** A place a permission can be granted, with its display name. */
export interface ScopeChoice extends GrantScope {
  key: string;
  name: string;
}

/** The member's grants at one place. */
export interface ScopeGrantGroup extends ScopeChoice {
  capabilities: AccessCapability[];
}

/** Named choices for every folder, service type and team, plus the whole church. */
export interface ScopeCatalog {
  organization: ScopeChoice;
  folders: ScopeChoice[];
  serviceTypes: ScopeChoice[];
  teams: ScopeChoice[];
  byKey: Map<string, ScopeChoice>;
}

const flattenFolders = (nodes: readonly ServiceTypeFolderNode[], prefix = ''): ScopeChoice[] =>
  nodes.flatMap((node) => {
    const name = prefix ? `${prefix} / ${node.name}` : node.name;
    const scope: GrantScope = { scopeType: 'folder', scopeId: node.id };
    return [{ ...scope, key: scopeKey(scope), name }, ...flattenFolders(node.children, name)];
  });

export const useScopeCatalog = (): ScopeCatalog => {
  const { t } = useTranslation('settings');
  const serviceTypes = useServiceTypes();
  const teams = useTeams();
  const folders = useFolderTree();

  return useMemo(() => {
    const choice = (scopeType: AccessScopeType, scopeId: string, name: string): ScopeChoice => ({
      scopeType,
      scopeId,
      name,
      key: scopeKey({ scopeType, scopeId }),
    });
    const organizationScope: GrantScope = { scopeType: 'organization', scopeId: null };
    const catalog: ScopeCatalog = {
      organization: { ...organizationScope, key: scopeKey(organizationScope), name: t('memberAccess.wholeChurch') },
      folders: flattenFolders(folders.data?.folders ?? []),
      serviceTypes: (serviceTypes.data ?? []).map((type) => choice('service_type', type.id, type.name)),
      teams: (teams.data ?? []).map((team) => choice('team', team.id, team.name)),
      byKey: new Map(),
    };
    for (const entry of [catalog.organization, ...catalog.folders, ...catalog.serviceTypes, ...catalog.teams]) {
      catalog.byKey.set(entry.key, entry);
    }
    return catalog;
  }, [folders.data, serviceTypes.data, teams.data, t]);
};

/** Groups a member's stored grants by where they apply, whole church first. */
export const groupGrants = (member: AccessMember, catalog: ScopeCatalog, unknownName: string): ScopeGrantGroup[] => {
  const groups = new Map<string, ScopeGrantGroup>();
  for (const grant of member.grants) {
    const scope = scopeOfGrant(grant);
    const key = scopeKey(scope);
    const group = groups.get(key) ?? { ...scope, key, name: catalog.byKey.get(key)?.name ?? unknownName, capabilities: [] };
    group.capabilities.push(grant.capability);
    groups.set(key, group);
  }
  const order: AccessScopeType[] = ['organization', 'folder', 'service_type', 'team'];
  return [...groups.values()].sort(
    (a, b) => order.indexOf(a.scopeType) - order.indexOf(b.scopeType) || a.name.localeCompare(b.name),
  );
};
