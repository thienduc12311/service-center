import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  TEMPLATE_COPY_UNAVAILABLE,
  type PlanTemplateSummary,
  type PlanTemplateUnavailableCounts,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useServiceTypes } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Notice } from '../ui';
import { templateScopeOptions, type TemplateScopeOption } from './templateScopes';

export interface DuplicateTemplateModalProps {
  template: Pick<PlanTemplateSummary, 'id' | 'name' | 'kind' | 'service_type_id' | 'service_type' | 'current_revision'>;
  onClose: () => void;
  /** Called with the copy's id, to open it in the editor. */
  onDuplicated: (templateId: string) => void;
}

const isCounts = (value: unknown): value is PlanTemplateUnavailableCounts =>
  typeof value === 'object' && value !== null
  && typeof (value as Record<string, unknown>).needs === 'number'
  && typeof (value as Record<string, unknown>).roster === 'number';

/** The counts a 409 `template_copy_unavailable` carries, or null for any other outcome. */
const unavailableFrom = (error: unknown): PlanTemplateUnavailableCounts | null =>
  error instanceof ApiError && error.code === TEMPLATE_COPY_UNAVAILABLE && isCounts(error.details) ? error.details : null;

/**
 * Copies the template's current revision into a new template, optionally
 * renamed and under another service type. When some needed positions or
 * roster entries do not apply to the chosen service type, nothing is copied
 * until the person agrees to leave them out.
 */
export const DuplicateTemplateModal = ({ template, onClose, onDuplicated }: DuplicateTemplateModalProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const serviceTypes = useServiceTypes();
  const sourceScope = template.service_type_id ?? '';
  const scopes = useMemo<TemplateScopeOption[]>(
    () => templateScopeOptions({ serviceTypes: serviceTypes.data ?? [], canEdit: (id) => can('plans.edit', { serviceTypeId: id }) }),
    [serviceTypes.data, can],
  );
  const [name, setName] = useState(() => t('duplicate.defaultName', { name: template.name }).slice(0, 120));
  const [chosenScope, setScope] = useState<string | null>(null);
  // The source's own service type when the caller may save there, else the first they may.
  const scope = chosenScope ?? (scopes.some((option) => option.id === sourceScope) ? sourceScope : (scopes[0]?.id ?? sourceScope));

  const duplicate = useMutation({
    mutationFn: (dropUnavailable: boolean) =>
      api.duplicatePlanTemplate(template.id, {
        name,
        ...(scope !== sourceScope ? { service_type_id: scope || null } : {}),
        drop_unavailable: dropUnavailable,
      }),
    onSuccess: async (copy) => {
      await invalidate();
      onDuplicated(copy.id);
    },
  });
  const unavailable = unavailableFrom(duplicate.error);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    duplicate.mutate(false);
  };

  return (
    <Modal open title={t('duplicate.title', { name: template.name })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('duplicate.description', { revision: template.current_revision })}</p>
        <div>
          <label className="label" htmlFor="duplicate-template-name">{t('duplicate.name')}</label>
          <input
            id="duplicate-template-name"
            className="input"
            maxLength={120}
            value={name}
            onChange={(event) => { setName(event.target.value); duplicate.reset(); }}
          />
        </div>
        <div>
          <label className="label" htmlFor="duplicate-template-service-type">{t('duplicate.serviceType')}</label>
          <select
            id="duplicate-template-service-type"
            className="input"
            value={scope}
            disabled={serviceTypes.isLoading}
            onChange={(event) => { setScope(event.target.value); duplicate.reset(); }}
          >
            {scopes.map((option) => (
              <option key={option.id || 'all'} value={option.id}>{option.name ?? t('library.allServiceTypes')}</option>
            ))}
          </select>
          {template.kind === 'plan' && scope !== sourceScope && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('duplicate.serviceTypeHint')}</p>
          )}
        </div>

        {unavailable ? (
          <Notice tone="warning">
            <span className="block">
              {t('duplicate.unavailable', {
                needs: t('duplicate.unavailableNeeds', { count: unavailable.needs }),
                roster: t('duplicate.unavailableRoster', { count: unavailable.roster }),
              })}
            </span>
          </Notice>
        ) : (
          <ErrorNotice error={duplicate.error} />
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          {unavailable ? (
            <Button type="button" loading={duplicate.isPending} onClick={() => duplicate.mutate(true)}>{t('duplicate.leaveOut')}</Button>
          ) : (
            <Button type="submit" loading={duplicate.isPending} disabled={!name.trim()}>{t('duplicate.submit')}</Button>
          )}
        </div>
      </form>
    </Modal>
  );
};
