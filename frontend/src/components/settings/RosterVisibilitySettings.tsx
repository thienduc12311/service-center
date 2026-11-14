import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OrganizationRow } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { ErrorNotice } from '../ui';

export interface RosterVisibilitySettingsProps {
  organization: OrganizationRow;
}

/** Whether members see every team's roster or only their own teams'. */
export const RosterVisibilitySettings = ({ organization }: RosterVisibilitySettingsProps) => {
  const { t } = useTranslation('settings');
  const invalidate = useInvalidateOrg();
  const setRoster = useMutation({
    mutationFn: (restricted: boolean) =>
      api.setRosterVisibility({ assignment_visibility: restricted ? 'teams' : 'organization' }),
    onSuccess: invalidate,
  });
  const [rosterRestricted, setRosterRestricted] = useState(organization.assignment_visibility === 'teams');

  return (
    <section className="card p-5" aria-labelledby="roster-visibility-heading">
      <h2 id="roster-visibility-heading" className="mb-3 font-semibold text-slate-900 dark:text-white">
        {t('access.rosters.title')}
      </h2>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-slate-300"
          checked={rosterRestricted}
          onChange={(e) => {
            setRosterRestricted(e.target.checked);
            setRoster.mutate(e.target.checked);
          }}
        />
        <span>
          {t('access.rosters.restrict')}
          <span className="block text-xs text-slate-500">{t('access.rosters.restrictHint')}</span>
        </span>
      </label>
      <ErrorNotice error={setRoster.error} />
    </section>
  );
};
