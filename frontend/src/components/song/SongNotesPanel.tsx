import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { SongWithArrangements } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice } from '../ui';

export interface SongNotesPanelProps {
  song: SongWithArrangements;
  canManage: boolean;
}

/** Free notes on the song — how it is introduced, which verses are cut, and so on. */
export const SongNotesPanel = ({ song, canManage }: SongNotesPanelProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const invalidate = useInvalidateOrg();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(song.notes ?? '');
  // The revision editing started from, so a newer edit is refused, not overwritten.
  const [baseRevision, setBaseRevision] = useState(song.revision);

  const save = useMutation({
    mutationFn: () => api.updateSong(song.id, { notes: draft.trim() || null, expected_revision: baseRevision }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  const startEditing = () => {
    setDraft(song.notes ?? '');
    setBaseRevision(song.revision);
    save.reset();
    setEditing(true);
  };

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('songInfo.fields.notes')}</h2>
        {canManage && !editing && (
          <Button variant="ghost" className="ml-auto !px-2 !py-1 text-xs" onClick={startEditing}>
            {song.notes ? t('common:actions.edit') : t('common:actions.add')}
          </Button>
        )}
      </div>

      <div className="card p-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              className="input"
              rows={5}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={t('notes.label')}
              autoFocus
            />

            <ErrorNotice error={save.error} />

            <div className="flex justify-end gap-2">
              <Button variant="secondary" className="!py-1 text-xs" onClick={() => setEditing(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button className="!py-1 text-xs" loading={save.isPending} onClick={() => save.mutate()}>
                {t('common:actions.save')}
              </Button>
            </div>
          </div>
        ) : song.notes ? (
          <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
            {song.notes}
          </p>
        ) : (
          <p className="text-xs text-slate-400">{t('notes.empty')}</p>
        )}
      </div>
    </section>
  );
};
