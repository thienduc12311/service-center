import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanTemplateSummary } from '@service-center/shared';
import { SearchableSelect } from '../SearchableSelect';
import type { SearchComboboxOption } from '../SearchCombobox';

/** Templates under one service type heading. */
export interface TemplateGroup {
  key: string;
  label: string;
  templates: PlanTemplateSummary[];
}

/**
 * Groups templates by service type: `firstServiceTypeId` first (the plan's
 * own type), then the other types A–Z, then templates for every type.
 */
export const groupTemplatesByServiceType = (
  templates: readonly PlanTemplateSummary[],
  firstServiceTypeId: string | null | undefined,
  allTypesLabel: string,
): TemplateGroup[] => {
  const groups = new Map<string, TemplateGroup>();
  for (const template of templates) {
    const key = template.service_type?.id ?? '';
    const group = groups.get(key) ?? { key, label: template.service_type?.name ?? allTypesLabel, templates: [] };
    group.templates.push(template);
    groups.set(key, group);
  }
  const rank = (group: TemplateGroup) => (group.key === firstServiceTypeId ? 0 : group.key === '' ? 2 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
};

/** Past this many templates a native select gets hard to scan; switch to type-to-filter. */
export const TEMPLATE_SEARCH_THRESHOLD = 12;

export interface TemplateSelectProps {
  id: string;
  label: string;
  templates: readonly PlanTemplateSummary[];
  value: string;
  onChange: (id: string) => void;
  optionLabel: (template: PlanTemplateSummary) => string;
  /** Listed first: the plan's own service type. */
  firstServiceTypeId?: string | null;
  /** The empty choice of the native select. */
  placeholder: string;
}

/**
 * Template picker grouped by service type: a native select with option
 * groups for a handful, a searchable select once the list grows.
 */
export const TemplateSelect = ({ id, label, templates, value, onChange, optionLabel, firstServiceTypeId, placeholder }: TemplateSelectProps) => {
  const { t } = useTranslation('templates');
  const allTypes = t('picker.allServiceTypes');
  const groups = useMemo(
    () => groupTemplatesByServiceType(templates, firstServiceTypeId, allTypes),
    [templates, firstServiceTypeId, allTypes],
  );
  const options = useMemo<SearchComboboxOption[]>(
    () => groups.flatMap((group) => group.templates.map((template) => ({ id: template.id, label: optionLabel(template), group: group.label }))),
    [groups, optionLabel],
  );

  if (templates.length > TEMPLATE_SEARCH_THRESHOLD) {
    return <SearchableSelect id={id} label={label} value={value} onChange={onChange} options={options} />;
  }

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {groups.map((group) => (
          <optgroup key={group.key} label={group.label}>
            {group.templates.map((template) => (
              <option key={template.id} value={template.id}>{optionLabel(template)}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
};
