import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { SONG_TYPES, type SongWithArrangements } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, ErrorNotice } from '../ui';
import { TagInput, TagSelect } from '../TagSelect';

export interface SongTagsPanelProps {
  song: SongWithArrangements;
  canManage: boolean;
}

/**
 * The song's tags: its types, from the shared vocabulary, and its free-form
 * themes. Both live on the song, so every arrangement shares them.
 */
export const SongTagsPanel = ({ song, canManage }: SongTagsPanelProps) => {
  const invalidate = useInvalidateOrg();
  const [editing, setEditing] = useState(false);
  const [themes, setThemes] = useState<string[]>(song.themes);
  const [types, setTypes] = useState<string[]>(song.song_types);

  const save = useMutation({
    mutationFn: () => api.updateSong(song.id, { themes, song_types: types }),
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });

  const startEditing = () => {
    setThemes(song.themes);
    setTypes(song.song_types);
    save.reset();
    setEditing(true);
  };

  const tags = [...song.song_types, ...song.themes];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Tags</h2>
        {canManage && !editing && (
          <Button variant="ghost" className="ml-auto !px-2 !py-1 text-xs" onClick={startEditing}>
            {tags.length ? 'Edit' : 'Add'}
          </Button>
        )}
      </div>

      <div className="card p-4">
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="song-tags-types">Type</label>
              <TagSelect
                id="song-tags-types"
                options={SONG_TYPES}
                value={types}
                onChange={setTypes}
              />
            </div>
            <div>
              <label className="label" htmlFor="song-tags-themes">Themes</label>
              <TagInput id="song-tags-themes" value={themes} onChange={setThemes} />
            </div>

            <ErrorNotice error={save.error} />

            <div className="flex justify-end gap-2">
              <Button variant="secondary" className="!py-1 text-xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button className="!py-1 text-xs" loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </div>
          </div>
        ) : tags.length === 0 ? (
          <p className="text-xs text-slate-400">
            There are no tags on this song{canManage ? '. Click Add to assign some.' : '.'}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge key={tag} tone="bg-slate-100 text-slate-600 ring-slate-500/20">
                {tag}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
