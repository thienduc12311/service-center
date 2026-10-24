import { useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import {
  CAPO_POSITIONS,
  SONG_SPEEDS,
  SONG_STYLES,
  SONG_TYPES,
  EMPTY_ADD_SONG_FORM,
  toCreateSongInput,
  type AddSongFormValues,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, ErrorNotice, Modal } from './ui';
import { KeySelect } from './KeySelect';
import { TagInput, TagSelect } from './TagSelect';
import { DEFAULT_ARRANGEMENT_NAME_KEY, SONG_VOCABULARY_LABEL_KEYS } from './song/types';

export interface AddSongModalProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new song once it is saved, so the caller can open it. */
  onCreated?: (song: SongWithArrangements) => void;
}

/**
 * The Add Song flow: the song, its first arrangement and an optional pasted
 * chart in one dialog, so a new song is usable the moment it is saved.
 */
export const AddSongModal = ({ open, onClose, onCreated }: AddSongModalProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const defaultArrangementName = t(DEFAULT_ARRANGEMENT_NAME_KEY);
  /** Caption for a stored vocabulary value; the value itself is what is saved. */
  const vocabularyLabel = (value: string): string => {
    const key = SONG_VOCABULARY_LABEL_KEYS[value];
    return key ? t(key) : value;
  };
  const invalidate = useInvalidateOrg();
  const [form, setForm] = useState<AddSongFormValues>(EMPTY_ADD_SONG_FORM);

  const update = <K extends keyof AddSongFormValues>(field: K, value: AddSongFormValues[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const create = useMutation({
    mutationFn: () => api.createSong(toCreateSongInput(form, defaultArrangementName)),
    onSuccess: async (song) => {
      await invalidate();
      setForm(EMPTY_ADD_SONG_FORM);
      onClose();
      onCreated?.(song);
    },
  });

  const close = () => {
    if (create.isPending) return;
    setForm(EMPTY_ADD_SONG_FORM);
    create.reset();
    onClose();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal open={open} title={t('addSong.title')} onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="song-title">{t('addSong.fields.title')}</label>
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
          <label className="label" htmlFor="song-arrangement">{t('arrangement.fields.name')}</label>
          <input
            id="song-arrangement"
            className="input"
            value={form.arrangementName}
            onChange={(event) => update('arrangementName', event.target.value)}
            placeholder={defaultArrangementName}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="song-key">{t('arrangement.fields.key')}</label>
            <KeySelect
              id="song-key"
              value={form.key}
              onChange={(key) => update('key', key)}
              resetLabel={t('arrangement.noKey')}
            />
          </div>
          <div>
            <label className="label" htmlFor="song-capo">{t('arrangement.fields.capo')}</label>
            <select
              id="song-capo"
              className="input"
              value={form.capo ?? ''}
              onChange={(event) => update('capo', event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{t('common:states.none')}</option>
              {CAPO_POSITIONS.map((fret) => (
                <option key={fret} value={fret}>{fret}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label" htmlFor="song-type">{t('addSong.fields.type')}</label>
            <TagSelect
              id="song-type"
              options={SONG_TYPES}
              optionLabel={vocabularyLabel}
              value={form.types}
              onChange={(types) => update('types', types)}
            />
          </div>
          <div>
            <label className="label" htmlFor="song-style">{t('addSong.fields.style')}</label>
            <select
              id="song-style"
              className="input"
              value={form.style}
              onChange={(event) => update('style', event.target.value)}
            >
              <option value="">{t('common:states.none')}</option>
              {SONG_STYLES.map((style) => (
                <option key={style} value={style}>{vocabularyLabel(style)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="song-speed">{t('addSong.fields.speed')}</label>
            <select
              id="song-speed"
              className="input"
              value={form.speed}
              onChange={(event) => update('speed', event.target.value)}
            >
              <option value="">{t('common:states.none')}</option>
              {SONG_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>{vocabularyLabel(speed)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="song-tags">{t('addSong.fields.tags')}</label>
          <TagInput
            id="song-tags"
            value={form.themes}
            onChange={(themes) => update('themes', themes)}
          />
        </div>

        <div className="border-t border-slate-200 pt-4">
          <label className="label" htmlFor="song-chart">{t('addSong.fields.chart')}</label>
          <p className="mb-2 text-xs text-slate-500">
            <Trans
              t={t}
              i18nKey="addSong.chartHelp"
              components={[<code key="example" className="rounded bg-slate-100 px-1" />]}
            />
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
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t('arrangement.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
