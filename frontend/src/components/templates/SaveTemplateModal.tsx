import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  PLAN_TEMPLATE_COMPONENTS,
  TEMPLATE_COMPONENT_LABELS,
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
    <Modal open title="Save as template" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="save-template-target">Save to</label>
          <select id="save-template-target" className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="new">A new template</option>
            {(existing.data ?? []).map((template) => (
              <option key={template.id} value={template.id}>
                New revision of “{template.name}” (now rev {template.current_revision})
              </option>
            ))}
          </select>
        </div>

        {target === 'new' && (
          <>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="label">Kind</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-kind" checked={kind === 'plan'} onChange={() => setKind('plan')} />
                Plan template
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="template-kind" checked={kind === 'section'} onChange={() => setKind('section')} />
                Reusable section (order items only)
              </label>
            </fieldset>
            <div>
              <label className="label" htmlFor="save-template-name">Name</label>
              <input id="save-template-name" className="input" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="save-template-description">Description</label>
              <input id="save-template-description" className="input" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            {plan.service_type && mayUseEveryType && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 rounded border-slate-300" checked={everyServiceType} onChange={(event) => setEveryServiceType(event.target.checked)} />
                Offer it to every service type, not only {plan.service_type.name}
              </label>
            )}
          </>
        )}

        {effectiveKind === 'plan' ? (
          <fieldset className="space-y-2">
            <legend className="label">Include</legend>
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
                {TEMPLATE_COMPONENT_LABELS[component]}
              </label>
            ))}
            {chosen.includes('roster') && (
              <p className="ml-6 text-xs text-slate-500">
                The people scheduled here (not those who declined) become a pattern. Applying it creates new prepared,
                unconfirmed requests; nobody is notified until you release them.
              </p>
            )}
            {chosen.includes('times') && (
              <p className="ml-6 text-xs text-slate-500">Times are saved as local clock times relative to the service date.</p>
            )}
          </fieldset>
        ) : (
          <p className="text-sm text-slate-500">This plan’s {plan.items.length} order item(s) become the section.</p>
        )}

        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={components.length === 0 || (target === 'new' && !name.trim())} onClick={() => save.mutate()}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
};
