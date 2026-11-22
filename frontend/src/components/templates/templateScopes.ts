import type { ServiceTypeRow } from '@service-center/shared';

/** A service type a template can be saved under; `id` '' is "every service type". */
export interface TemplateScopeOption {
  id: string;
  name: string | null;
}

export interface TemplateScopeInput {
  serviceTypes: readonly Pick<ServiceTypeRow, 'id' | 'name'>[];
  /** Whether the caller holds plans.edit at that service type (or organization-wide for null). */
  canEdit: (serviceTypeId: string | null) => boolean;
}

/**
 * Where the caller may create or copy a template: each service type they
 * edit plans for, then "every service type" when they edit plans
 * organization-wide. Mirrors `private.plan_template_access`; the database
 * decides every save.
 */
export const templateScopeOptions = ({ serviceTypes, canEdit }: TemplateScopeInput): TemplateScopeOption[] => [
  ...serviceTypes
    .filter((serviceType) => canEdit(serviceType.id))
    .map((serviceType) => ({ id: serviceType.id, name: serviceType.name }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  ...(canEdit(null) ? [{ id: '', name: null }] : []),
];
