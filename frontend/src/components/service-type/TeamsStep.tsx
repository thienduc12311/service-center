import { useMemo } from 'react';
import {
  COMMON_TEAM_TEMPLATES,
  TEAM_TEMPLATE_CATEGORIES,
  TEAM_TEMPLATE_CATEGORY_LABELS,
  type TeamTemplate,
} from '@service-center/shared';

export interface TeamsStepProps {
  serviceTypeName: string;
  /** Template names, so the selection survives a trip back to an earlier step. */
  selected: string[];
  onChange: (selected: string[]) => void;
  joinTeams: boolean;
  onJoinTeamsChange: (joinTeams: boolean) => void;
}

export const TeamsStep = ({
  serviceTypeName,
  selected,
  onChange,
  joinTeams,
  onJoinTeamsChange,
}: TeamsStepProps) => {
  const byCategory = useMemo(() => {
    const groups = new Map<string, TeamTemplate[]>();
    for (const template of COMMON_TEAM_TEMPLATES) {
      groups.set(template.category, [...(groups.get(template.category) ?? []), template]);
    }
    return groups;
  }, []);

  const toggle = (name: string) =>
    onChange(
      selected.includes(name) ? selected.filter((value) => value !== name) : [...selected, name],
    );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Lastly, add teams you lead
        </h1>
        <p className="mt-3 text-slate-600">
          Chances are, <strong className="font-semibold">{serviceTypeName}</strong> needs some teams
          to make it happen. Create new teams by choosing any of these common teams. You can edit
          them, create your own, or copy teams from another Service Type later.
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
        {TEAM_TEMPLATE_CATEGORIES.map((category) => (
          <fieldset key={category}>
            <legend className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
              {TEAM_TEMPLATE_CATEGORY_LABELS[category]}
            </legend>
            <div className="space-y-2.5">
              {(byCategory.get(category) ?? []).map((template) => (
                <label key={template.name} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300"
                    checked={selected.includes(template.name)}
                    onChange={() => toggle(template.name)}
                  />
                  <span>{template.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <label className="flex items-center justify-center gap-2 text-sm text-slate-500">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300"
          checked={joinTeams}
          onChange={(event) => onJoinTeamsChange(event.target.checked)}
        />
        Add me to any teams selected.
      </label>
    </div>
  );
};
