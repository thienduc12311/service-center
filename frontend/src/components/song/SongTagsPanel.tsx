import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { SONG_TYPES, type SongWithArrangements } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, ErrorNotice } from '../ui';
import { TagInput, TagSelect } from '../TagSelect';
import { SONG_VOCABULARY_LABEL_KEYS } from './types';

export interface SongTagsPanelProps {
  song: SongWithArrangements;
  canManage: boolean;
}

/**
 * The song's tags: its types, from the shared vocabulary, and its free-form
 * themes. Both live on the song, so every arrangement shares them.
 */
export const SongTagsPanel = ({ song, canManage }: SongTagsPanelProps) => {
  const { t } = useTranslation(['songs', 'common']);
  /** Song types come from the shared vocabulary; themes are shown as written. */
  const typeLabel = (value: string): string => {
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key) : value;
  };
  const invalidate = useInvalidateOrg();
  const [editing, setEditing] = useState(false);
  const [themes, setThemes] = useState<string[]>(song.themes);
  const [types, setTypes] = useState<string[]>(song.song_types);
  // The revision editing started from, so a newer edit is refused, not overwritten.
  const [baseRevision, setBaseRevision] = useState(song.revision);

  const save = useMutation({
    mutationFn: () => api.updateSong(song.id, { themes, song_types: types, expected_revision: baseRevision }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  const startEditing = () => {
    setThemes(song.themes);
    setTypes(song.song_types);
    setBaseRevision(song.revision);
    save.reset();
    setEditing(true);
  };

  const tags = [...song.song_types, ...song.themes];
  const tagLabels = [...song.song_types.map(typeLabel), ...song.themes];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('addSong.fields.tags')}</h2>
        {canManage && !editing && (
          <Button variant="ghost" className="ml-auto !px-2 !py-1 text-xs" onClick={startEditing}>
            {tags.length ? t('common:actions.edit') : t('common:actions.add')}
          </Button>
        )}
      </div>

      <div className="card p-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="song-tags-types">{t('addSong.fields.type')}</label>
              <TagSelect
                id="song-tags-types"
                options={SONG_TYPES}
                optionLabel={typeLabel}
                value={types}
                onChange={setTypes}
              />
            </div>
            <div>
              <label className="label" htmlFor="song-tags-themes">{t('songInfo.fields.themes')}</label>
              <TagInput id="song-tags-themes" value={themes} onChange={setThemes} />
            </div>

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
        ) : tags.length === 0 ? (
          <p className="text-xs text-slate-400">
            {canManage ? t('tags.emptyManage') : t('tags.empty')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tagLabels.map((tag, index) => (
              <Badge key={`${index}-${tag}`} tone="bg-slate-100 text-slate-600 ring-slate-500/20">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
