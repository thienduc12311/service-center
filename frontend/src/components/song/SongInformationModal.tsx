import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { SongWithArrangements } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';
import { TagInput } from '../TagSelect';
import {
  songInformationFormFrom,
  toUpdateSongInput,
  type SongInformationFormValues,
} from './types';

export interface SongInformationModalProps {
  open: boolean;
  song: SongWithArrangements;
  onClose: () => void;
}

/**
 * Edits the song itself — the title and the copyright details that belong to
 * the song rather than to any one arrangement.
 */
export const SongInformationModal = ({ open, song, onClose }: SongInformationModalProps) => {
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState<SongInformationFormValues>(() =>
    songInformationFormFrom(song),
  );

  // Re-seed each time the dialog opens, so a cancelled edit is really gone.
  useEffect(() => {
    if (open) setForm(songInformationFormFrom(song));
  }, [open, song]);

  const update = <K extends keyof SongInformationFormValues>(
    field: K,
    value: SongInformationFormValues[K],
  ) => setForm((current) => ({ ...current, [field]: value }));

  const save = useMutation({
    mutationFn: () => api.updateSong(song.id, toUpdateSongInput(form)),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const close = () => {
    if (save.isPending) return;
    save.reset();
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <Modal open={open} title="Song Information" onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        {/* Title and CCLI# identify the song, so they sit together on top. */}
        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-[2fr_1fr]">
          <div>
            <label className="label" htmlFor="song-info-title">Song Title</label>
            <input
              id="song-info-title"
              className="input"
              value={form.title}
              onChange={(event) => update('title', event.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label" htmlFor="song-info-ccli">CCLI#</label>
            <input
              id="song-info-ccli"
              className="input"
              value={form.ccliNumber}
              onChange={(event) => update('ccliNumber', event.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="song-info-authors">Authors</label>
          <input
            id="song-info-authors"
            className="input"
            value={form.authors}
            onChange={(event) => update('authors', event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="song-info-copyright">Copyright</label>
          <input
            id="song-info-copyright"
            className="input"
            value={form.copyright}
            onChange={(event) => update('copyright', event.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="song-info-administration">Administration</label>
          <input
            id="song-info-administration"
            className="input"
            value={form.administration}
            onChange={(event) => update('administration', event.target.value)}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="song-info-notes">Notes</label>
            <textarea
              id="song-info-notes"
              className="input"
              rows={4}
              value={form.notes}
              onChange={(event) => update('notes', event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="song-info-themes">Themes</label>
            <TagInput
              id="song-info-themes"
              value={form.themes}
              onChange={(themes) => update('themes', themes)}
            />
          </div>
        </div>

        <ErrorNotice error={save.error} />

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
};
