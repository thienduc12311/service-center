import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { useInvalidateOrg, useServiceTypes } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Notice } from '../ui';
import { templateScopeOptions } from './templateScopes';

export interface NewTemplateModalProps {
  onClose: () => void;
  /** Called with the new template's id once it is saved, to open it in the editor. */
  onCreated: (templateId: string) => void;
}

/**
 * Starts a plan template from nothing: a name, a service type and an
 * optional description. It is saved at once as revision 1 with an empty
 * order, needs and roster; the editor adds the content.
 */
export const NewTemplateModal = ({ onClose, onCreated }: NewTemplateModalProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const serviceTypes = useServiceTypes();
  const scopes = useMemo(
    () => templateScopeOptions({ serviceTypes: serviceTypes.data ?? [], canEdit: (id) => can('plans.edit', { serviceTypeId: id }) }),
    [serviceTypes.data, can],
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const chosenScope = scope ?? scopes[0]?.id ?? '';

  const create = useMutation({
    mutationFn: () =>
      api.createPlanTemplate({
        kind: 'plan',
        name,
        description: description || null,
        service_type_id: chosenScope || null,
        content: {},
      }),
    onSuccess: async (template) => {
      await invalidate();
      onCreated(template.id);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || scopes.length === 0) return;
    create.mutate();
  };

  return (
    <Modal open title={t('create.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div>
          <label className="label" htmlFor="new-template-name">{t('create.name')}</label>
          <input id="new-template-name" className="input" autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="new-template-service-type">{t('create.serviceType')}</label>
          <select
            id="new-template-service-type"
            className="input"
            value={chosenScope}
            disabled={serviceTypes.isLoading}
            onChange={(event) => setScope(event.target.value)}
          >
            {scopes.map((option) => (
              <option key={option.id || 'all'} value={option.id}>{option.name ?? t('library.allServiceTypes')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="new-template-description">{t('create.description')}</label>
          <textarea id="new-template-description" className="input" rows={2} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        {!serviceTypes.isLoading && scopes.length === 0 && <Notice tone="warning">{t('create.noScope')}</Notice>}
        <p className="text-xs text-slate-500 dark:text-slate-400">{t('create.hint')}</p>
        <ErrorNotice error={create.error ?? serviceTypes.error} />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={create.isPending} disabled={!name.trim() || scopes.length === 0}>{t('create.submit')}</Button>
        </div>
      </form>
    </Modal>
  );
};
