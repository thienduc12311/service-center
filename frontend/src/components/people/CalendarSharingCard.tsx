import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { ErrorNotice } from '../ui';
import { Icon } from '../icons';

export interface CalendarSharingCardProps {
  personId: string;
}

/**
 * F16: explicit opt-in for team calendars. A birthdate or anniversary on the
 * profile alone never appears anywhere; only the month and day are shown.
 */
export const CalendarSharingCard = ({ personId }: CalendarSharingCardProps) => {
  const { t } = useTranslation('people');
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = keys.personSharing(organizationId, personId);
  const sharing = useQuery({ queryKey: key, queryFn: () => api.personCalendarSharing(personId), retry: false });
  const save = useMutation({
    mutationFn: (next: { share_birthday: boolean; share_anniversary: boolean }) => api.setPersonCalendarSharing(personId, next),
    onSuccess: (row) => queryClient.setQueryData(key, row),
  });
  if (sharing.isLoading || sharing.error) return null;
  const current = sharing.data!;
  return (
    <section className="card space-y-3 p-5 text-sm">
      <div>
        <h2 className="flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
          <Icon name="calendar" className="size-4 text-slate-400" />
          {t('calendarSharing.title')}
        </h2>
        <p className="mt-1 text-slate-500 dark:text-slate-400">{t('calendarSharing.description')}</p>
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300 accent-brand-600"
          checked={current.share_birthday}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ share_birthday: event.target.checked, share_anniversary: current.share_anniversary })}
        />
        {t('calendarSharing.birthday')}
      </label>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300 accent-brand-600"
          checked={current.share_anniversary}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ share_birthday: current.share_birthday, share_anniversary: event.target.checked })}
        />
        {t('calendarSharing.anniversary')}
      </label>
      <ErrorNotice error={save.error} />
    </section>
  );
};
