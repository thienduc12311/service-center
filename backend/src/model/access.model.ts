import { z } from 'zod';
import {
  accessCapabilitySchema,
  accessScopeTypeSchema,
  type AccessGrantRow,
  type AccessMode,
  type CapabilityExplanation,
  type EffectiveAccess,
  type EffectiveAccessEntry,
  type EffectiveAccessRow,
  type OrgRole,
  type ScopeAccess,
} from '@service-center/shared';

/** The membership facts effective access is reported alongside. */
export interface AccessMembership {
  organizationId: string;
  userId: string;
  role: OrgRole;
  accessMode: AccessMode;
}

const ENTRY_SOURCES: readonly EffectiveAccessEntry['source'][] = [
  'role:owner',
  'role:admin',
  'role:scheduler_legacy',
  'grant',
  'grant:folder',
];

const isEntrySource = (source: string): source is EffectiveAccessEntry['source'] =>
  (ENTRY_SOURCES as readonly string[]).includes(source);

export const mapEffectiveAccess = (
  membership: AccessMembership,
  rows: readonly EffectiveAccessRow[],
): EffectiveAccess => ({
  organization_id: membership.organizationId,
  user_id: membership.userId,
  role: membership.role,
  access_mode: membership.accessMode,
  can_administer_access: membership.role === 'owner' || membership.role === 'admin',
  entries: rows
    .filter((row) => isEntrySource(row.source))
    .map((row) => ({
      capability: row.capability,
      scope_type: row.scope_type,
      scope_id: row.scope_id,
      source: row.source as EffectiveAccessEntry['source'],
      grant_id: row.grant_id,
    })),
});

/** `explain_capability` returns jsonb, so it is validated at this boundary. */
const explanationSchema = z.object({
  allowed: z.boolean(),
  capability: accessCapabilitySchema,
  role: z.enum(['owner', 'admin', 'scheduler', 'member']).nullable(),
  access_mode: z.enum(['legacy', 'scoped']).nullable(),
  reasons: z.array(
    z.object({
      source: z.enum(['role:owner', 'role:admin', 'role:scheduler_legacy', 'grant', 'grant:folder']),
      scope_type: accessScopeTypeSchema,
      scope_id: z.string().uuid().nullable(),
      grant_id: z.string().uuid().nullable(),
    }),
  ),
  denial: z
    .enum(['not_a_member', 'membership_inactive', 'scoped_scheduler_without_grant', 'grant_outside_scope', 'no_matching_grant'])
    .nullable(),
});

export const parseExplanation = (value: unknown): CapabilityExplanation => explanationSchema.parse(value);

export interface NamedGrant extends AccessGrantRow {
  full_name: string | null;
}

export const mapScopeAccess = (
  scopeType: ScopeAccess['scope_type'],
  scopeId: string | null,
  grants: readonly NamedGrant[],
): ScopeAccess => ({
  scope_type: scopeType,
  scope_id: scopeId,
  grants: grants.map((grant) => ({
    id: grant.id,
    user_id: grant.user_id,
    capability: grant.capability,
    created_at: grant.created_at,
    full_name: grant.full_name,
  })),
});
