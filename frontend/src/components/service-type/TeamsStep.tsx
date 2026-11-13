import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  COMMON_TEAM_TEMPLATES,
  TEAM_TEMPLATE_CATEGORIES,
  type TeamTemplate,
} from '@service-center/shared';

export interface TeamsStepProps {
  serviceTypeName: string;
  /** Template names, so the selection survives a trip back to an earlier step. */
  selected: string[];
  onChange: (selected: string[]) => void;
  joinTeams: boolean;
  onJoinTeamsChange: (joinTeams: boolean) => void;
  /** Only owners, admins and organization-wide team leaders may put themselves on teams. */
  canJoinTeams: boolean;
}

export const TeamsStep = ({
  serviceTypeName,
  selected,
  onChange,
  joinTeams,
  onJoinTeamsChange,
  canJoinTeams,
}: TeamsStepProps) => {
  const { t } = useTranslation('teams');
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
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-900 sm:text-3xl dark:text-white">
          {t('teamsStep.title')}
        </h1>
        <p className="mt-3 text-pretty text-slate-600 dark:text-slate-300">
          <Trans
            t={t}
            i18nKey="teamsStep.intro"
            values={{ name: serviceTypeName }}
            components={[<strong key="name" className="font-semibold" />]}
          />
        </p>
      </div>

      <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-5">
        {TEAM_TEMPLATE_CATEGORIES.map((category) => (
          <fieldset key={category}>
            <legend className="section-label mb-3">
              {t(`teamsStep.categories.${category}`)}
            </legend>
            <div className="space-y-2.5">
              {(byCategory.get(category) ?? []).map((template) => (
                <label key={template.name} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
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

      {canJoinTeams && (
        <label className="surface-inset flex items-center justify-center gap-2 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
            checked={joinTeams}
            onChange={(event) => onJoinTeamsChange(event.target.checked)}
          />
          {t('teamsStep.joinTeams')}
        </label>
      )}
    </div>
  );
};
