import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PLAN_TEMPLATE_COMPONENTS,
  type PlanDetail,
  type PlanTemplateComponent,
  type PlanTemplateKind,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePlanTemplates } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';

export interface SaveTemplateModalProps {
  plan: PlanDetail;
  onClose: () => void;
  onSaved: (templateId: string) => void;
}

type SaveTarget = 'new' | string;

/**
 * Saves the chosen parts of this plan as a new template, or as a new revision
 * of an existing one. The template is a copy: later edits to the plan or the
 * template never reach each other. Declined requests and archived people are
 * left out of a roster pattern.
 */
export const SaveTemplateModal = ({ plan, onClose, onSaved }: SaveTemplateModalProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const existing = usePlanTemplates(plan.service_type_id ? { service_type_id: plan.service_type_id } : {});
  const [target, setTarget] = useState<SaveTarget>('new');
  const [kind, setKind] = useState<PlanTemplateKind>('plan');
  const [name, setName] = useState(plan.service_type?.name ?? plan.title);
  const [description, setDescription] = useState('');
  const [everyServiceType, setEveryServiceType] = useState(false);
  const [chosen, setChosen] = useState<PlanTemplateComponent[]>(['times', 'notes', 'items', 'needs']);

  const updating = target !== 'new' ? existing.data?.find((template) => template.id === target) : undefined;
  const effectiveKind = updating?.kind ?? kind;
  const components: PlanTemplateComponent[] = effectiveKind === 'section' ? ['items'] : chosen;
  const mayUseEveryType = can('plans.edit');

  const save = useMutation({
    mutationFn: () =>
      updating
        ? api.updatePlanTemplate(updating.id, {
            expected_revision: updating.current_revision,
            source: { plan_id: plan.id, components },
          })
        : api.createPlanTemplate({
            kind,
            name,
            description: description || null,
            service_type_id: everyServiceType ? null : plan.service_type_id,
            source: { plan_id: plan.id, components },
          }),
    onSuccess: async (template) => {
      await invalidate();
      onSaved(template.id);
    },
  });

  return (
    <Modal open title={t('save.title')} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="save-template-target">{t('save.saveTo')}</label>
          <select id="save-template-target" className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="new">{t('save.newTemplate')}</option>
            {(existing.data ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                {t('save.newRevision', { name: template.name, revision: template.current_revision })}
              </option>
            ))}
          </select>
        </div>

        {target === 'new' && (
          <>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="label">{t('save.kind')}</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-kind" checked={kind === 'plan'} onChange={() => setKind('plan')} />
                {t('save.kindPlan')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-kind" checked={kind === 'section'} onChange={() => setKind('section')} />
                {t('save.kindSection')}
              </label>
            </fieldset>
            <div>
              <label className="label" htmlFor="save-template-name">{t('save.name')}</label>
              <input id="save-template-name" className="input" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="save-template-description">{t('save.description')}</label>
              <input id="save-template-description" className="input" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            {plan.service_type && mayUseEveryType && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 rounded border-slate-300" checked={everyServiceType} onChange={(event) => setEveryServiceType(event.target.checked)} />
                {t('save.everyServiceType', { serviceType: plan.service_type.name })}
              </label>
            )}
          </>
        )}

        {effectiveKind === 'plan' ? (
          <fieldset className="space-y-2">
            <legend className="label">{t('save.include')}</legend>
            {PLAN_TEMPLATE_COMPONENTS.map((component) => (
              <label key={component} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300"
                  checked={chosen.includes(component)}
                  onChange={(event) =>
                    setChosen((current) => event.target.checked ? [...current, component] : current.filter((c) => c !== component))
                  }
                />
                {t(`components.${component}`)}
              </label>
            ))}
            {chosen.includes('roster') && (
              <p className="ml-6 text-xs text-slate-500">
                {t('save.rosterHint')}
              </p>
            )}
            {chosen.includes('times') && (
              <p className="ml-6 text-xs text-slate-500">{t('save.timesHint')}</p>
            )}
          </fieldset>
        ) : (
          <p className="text-sm text-slate-500">{t('save.sectionItems', { count: plan.items.length })}</p>
        )}

        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button loading={save.isPending} disabled={components.length === 0 || (target === 'new' && !name.trim())} onClick={() => save.mutate()}>
            {t('common:actions.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
