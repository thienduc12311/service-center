import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';

export interface CarryNotesOptionProps {
  planId: string;
  songId: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * "Bring notes from last time (<date>)" for a song about to be added: shown
 * only when the song's last use in this service type has item notes the
 * person can read. Checked by default (the caller's default); the copy itself
 * happens on the server in the same request as the add.
 */
export const CarryNotesOption = ({ planId, songId, checked, onChange }: CarryNotesOptionProps) => {
  const { t } = useTranslation('plans');
  const { organizationId } = useAuth();
  const format = useFormatters();
  const lastUse = useQuery({
    queryKey: [...keys.plan(organizationId, planId), 'song-last-use', songId],
    queryFn: () => api.songLastUse(planId, songId),
    staleTime: 60_000,
  });
  const use = lastUse.data;
  if (!use || use.note_count === 0) return null;
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1 text-xs hover:bg-white/70 dark:hover:bg-slate-900/60">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {t('songBrowser.carryNotes', { date: format.date(use.service_date, 'medium') })}
        </span>
        <span className="block truncate text-slate-500 dark:text-slate-400">
          {t('songBrowser.carryNotesHint', { count: use.note_count, title: use.plan_title })}
        </span>
      </span>
    </label>
  );
};
