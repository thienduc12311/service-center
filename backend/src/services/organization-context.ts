import { raw, unwrapOne, type Db } from '../lib/supabase.js';
import {
  mapOrganizationContext,
  type OrganizationContext,
  type OrganizationContextArgs,
  type OrganizationContextRow,
} from '../model/organization-context.model.js';

export const loadMyOrganizationContext = async (
  db: Db,
  userId: string,
  args: OrganizationContextArgs,
): Promise<OrganizationContext> => {
  // The RPC returns JSONB and its caller-scoped payload is declared in the model.
  const context = (await unwrapOne(raw(db).rpc('my_org_context', args))) as OrganizationContextRow;
  return mapOrganizationContext(context, userId);
};
