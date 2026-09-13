import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CAPO_POSITIONS,
  SONG_SPEEDS,
  SONG_STYLES,
  SONG_TYPES,
  detectKey,
  toChordPro,
  type CreateSongInput,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, ErrorNotice, Modal } from './ui';
import { KeySelect } from './KeySelect';
import { TagInput, TagSelect } from './TagSelect';

export interface AddSongModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new song once it is saved, so the caller can open it. */
  onCreated?: (song: SongWithArrangements) => void;
}

/** Everything the form holds before it is turned into a request body. */
interface AddSongForm {
  title: string;
  arrangementName: string;
  key: string | null;
  capo: number | null;
  types: string[];
  style: string;
  speed: string;
  themes: string[];
  chordChart: string;
}

const EMPTY: AddSongForm = {
  title: '',
  arrangementName: '',
  key: null,
  capo: null,
  types: [],
  style: '',
  speed: '',
  themes: [],
  chordChart: '',
};

/** Trims the form into the API's shape, dropping everything left blank. */
const toCreateInput = (form: AddSongForm): CreateSongInput => {
  // A chart pasted as chords-above-lyrics is folded into inline ChordPro, so
  // either shape can be dropped into the box.
  const chart = toChordPro(form.chordChart);
  // A pasted chart usually opens on the tonic, so it can fill a blank key in.
  const key = form.key ?? (chart ? detectKey(chart) : null);

  return {
    title: form.title.trim(),
    default_key: key,
    themes: form.themes,
    song_types: form.types,
    style: form.style || null,
    speed: form.speed || null,
    arrangement: {
      name: form.arrangementName.trim() || 'Default Arrangement',
      song_key: key,
      capo: form.capo,
      chord_chart: chart || null,
    },
  };
};

/**
 * The Add Song flow: the song, its first arrangement and an optional pasted
 * chart in one dialog, so a new song is usable the moment it is saved.
 */
export const AddSongModal = ({ open, onClose, onCreated }: AddSongModalProps) => {
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState<AddSongForm>(EMPTY);

  const update = <K extends keyof AddSongForm>(field: K, value: AddSongForm[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const create = useMutation({
    mutationFn: () => api.createSong(toCreateInput(form)),
    onSuccess: async (song) => {
      await invalidate();
      setForm(EMPTY);
      onClose();
      onCreated?.(song);
    },
  });

  const close = () => {
    if (create.isPending) return;
    setForm(EMPTY);
    create.reset();
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal open={open} title="Add Song" onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="song-title">Title</label>
          <input
            id="song-title"
            className="input"
            value={form.title}
            onChange={(event) => update('title', event.target.value)}
            required
            autoFocus
          />
        </div>

        <div>
          <label className="label" htmlFor="song-arrangement">Arrangement Name</label>
          <input
            id="song-arrangement"
            className="input"
            value={form.arrangementName}
            onChange={(event) => update('arrangementName', event.target.value)}
            placeholder="Default Arrangement"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="song-key">Key</label>
            <KeySelect
              id="song-key"
              value={form.key}
              onChange={(key) => update('key', key)}
              resetLabel="No key"
            />
          </div>
          <div>
            <label className="label" htmlFor="song-capo">Capo</label>
            <select
              id="song-capo"
              className="input"
              value={form.capo ?? ''}
              onChange={(event) => update('capo', event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">None</option>
              {CAPO_POSITIONS.map((fret) => (
                <option key={fret} value={fret}>{fret}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="song-type">Type</label>
            <TagSelect
              id="song-type"
              options={SONG_TYPES}
              value={form.types}
              onChange={(types) => update('types', types)}
            />
          </div>
          <div>
            <label className="label" htmlFor="song-style">Style</label>
            <select
              id="song-style"
              className="input"
              value={form.style}
              onChange={(event) => update('style', event.target.value)}
            >
              <option value="">None</option>
              {SONG_STYLES.map((style) => (
                <option key={style} value={style}>{style}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="song-speed">Speed</label>
            <select
              id="song-speed"
              className="input"
              value={form.speed}
              onChange={(event) => update('speed', event.target.value)}
            >
              <option value="">None</option>
              {SONG_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>{speed}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="song-tags">Tags</label>
          <TagInput
            id="song-tags"
            value={form.themes}
            onChange={(themes) => update('themes', themes)}
          />
        </div>

        <div className="border-t border-slate-200 pt-4">
          <label className="label" htmlFor="song-chart">Lyrics &amp; Chords</label>
          <p className="mb-2 text-xs text-slate-500">
            Paste a chart with the chords on their own line above the lyrics, or write ChordPro
            with the chords in square brackets —{' '}
            <code className="rounded bg-slate-100 px-1">A[G]mazing grace</code>. Leave it blank to
            add the chart later.
          </p>
          <textarea
            id="song-chart"
            className="input font-mono"
            rows={8}
            value={form.chordChart}
            onChange={(event) => update('chordChart', event.target.value)}
          />
        </div>

        <ErrorNotice error={create.error} />

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Submit
          </Button>
        </div>
      </form>
    </Modal>
  );
};
