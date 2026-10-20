import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { ErrorNotice } from '../ui';

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
    <section className="card space-y-2 p-5 text-sm">
      <h2 className="font-semibold">{t('calendarSharing.title')}</h2>
      <p className="text-slate-500">{t('calendarSharing.description')}</p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={current.share_birthday}
          disabled={save.isPending}
          onChange={(event) => save.mutate({ share_birthday: event.target.checked, share_anniversary: current.share_anniversary })}
        />
        {t('calendarSharing.birthday')}
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
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
