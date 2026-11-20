import type {
  AccessMode,
  DisabledOrganization,
  EffectiveAccess,
  EffectiveAccessRow,
  OrganizationRow,
  OrgRole,
} from '@service-center/shared';
import { mapEffectiveAccess } from './access.model.js';
import { mapDisabledOrganization, type DisabledOrganizationRow } from './platform-admin.model.js';

export interface OrganizationContextArgs {
  p_org?: string;
  p_all?: boolean;
}

interface OrganizationContextMembershipRow {
  organization_id: string;
  role: OrgRole;
  access_mode: AccessMode;
  platform_access_expires_at: string | null;
  organization: OrganizationRow | null;
  access: EffectiveAccessRow[];
}

export interface OrganizationContextRow {
  memberships: OrganizationContextMembershipRow[];
  disabled_organizations: DisabledOrganizationRow[];
}

interface OrganizationContextMembership {
  organizationId: string;
  role: OrgRole;
  platformAccessExpiresAt: string | null;
  organization: OrganizationRow | null;
  access: EffectiveAccess;
}

export interface OrganizationContext {
  memberships: OrganizationContextMembership[];
  disabledOrganizations: DisabledOrganization[];
}

export const mapOrganizationContext = (row: OrganizationContextRow, userId: string): OrganizationContext => ({
  memberships: row.memberships.map((membership) => ({
    organizationId: membership.organization_id,
    role: membership.role,
    platformAccessExpiresAt: membership.platform_access_expires_at,
    organization: membership.organization,
    access: mapEffectiveAccess({
      organizationId: membership.organization_id,
      userId,
      role: membership.role,
      accessMode: membership.access_mode,
    }, membership.access),
  })),
  disabledOrganizations: row.disabled_organizations.map(mapDisabledOrganization),
});
