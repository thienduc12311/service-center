import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  initialArrangementFor,
  keyedPlanItemRequest,
  newPlanItemRequest,
  type CreatePlanItemRequest,
  type PlanItemType,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useSongs, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal } from '../ui';
import { KeySelect } from '../KeySelect';

export interface AddItemModalProps {
  open: boolean;
  planId: string;
  onClose: () => void;
}

export const AddItemModal = ({ open, planId, onClose }: AddItemModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const invalidate = useInvalidateOrg();
  const [itemType, setItemType] = useState<PlanItemType>('song');
  const [songQuery, setSongQuery] = useState('');
  const [songId, setSongId] = useState('');
  const [mainKey, setMainKey] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');

  const songs = useSongs({ q: songQuery || undefined, per_page: 20 });
  const selectedSong = songs.data?.data.find((song) => song.id === songId);

  // The last unanswered add: sending the same draft again reuses its key, so
  // a retry after a lost response returns that item instead of a second one.
  const pending = useRef<CreatePlanItemRequest | null>(null);

  // The same body the native app sends (shared `newPlanItemRequest`).
  const create = useMutation({
    mutationFn: () => {
      const body = keyedPlanItemRequest(
        newPlanItemRequest({ itemType, title, song: selectedSong ?? null, keyOverride: mainKey, length, description }, t('itemKind.song')),
        pending.current,
        () => crypto.randomUUID(),
      );
      pending.current = body;
      return api.addPlanItem(planId, body);
    },
    onSuccess: async () => {
      pending.current = null;
      await invalidate();
      setTitle('');
      setLength('');
      setDescription('');
      setSongId('');
      setMainKey(null);
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <Modal open={open} title={t('addItem.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex gap-2">
          {(['song', 'item', 'header'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setItemType(value)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t(`itemKind.${value}`)}
            </button>
          ))}
        </div>

        {itemType === 'song' ? (
          <>
            <div>
              <label className="label" htmlFor="song-search">
                {t('addItem.findSong')}
              </label>
              <input
                id="song-search"
                className="input"
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder={t('addItem.searchPlaceholder')}
              />
            </div>
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {(songs.data?.data ?? []).map((song) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => {
                    const arrangement = initialArrangementFor(song.arrangements);
                    setSongId(song.id);
                    setMainKey(arrangement?.song_key ?? song.default_key ?? null);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    songId === song.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
                  }`}
                >
                  <span>
                    <span className="font-medium">{song.title}</span>
                    {song.author && <span className="ml-2 text-xs text-slate-400">{song.author}</span>}
                  </span>
                  <span className="text-xs text-slate-400">{song.default_key ?? ''}</span>
                </button>
              ))}
              {songs.data?.data.length === 0 && (
                <p className="px-3 py-2 text-sm text-slate-400">{t('addItem.noSongs')}</p>
              )}
            </div>
            {selectedSong && (
              <div>
                <label className="label" htmlFor="song-main-key">
                  {t('addItem.mainKey')}
                </label>
                <KeySelect
                  id="song-main-key"
                  value={mainKey}
                  onChange={setMainKey}
                  placeholder={t('addItem.chooseKey')}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {t('addItem.transposeHint')}
                </p>
              </div>
            )}
          </>
        ) : (
          <div>
            <label className="label" htmlFor="item-title">
              {t('addItem.fieldTitle')}
            </label>
            <input
              id="item-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={itemType === 'header' ? t('addItem.headerPlaceholder') : t('addItem.itemPlaceholder')}
              required
            />
          </div>
        )}

        {itemType !== 'header' && (
          <>
            <div>
              <label className="label" htmlFor="item-length">
                {t('addItem.length')}
              </label>
              <input
                id="item-length"
                className="input"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="4:30"
              />
            </div>
            <div>
              <label className="label" htmlFor="item-notes">
                {t('addItem.notes')}
              </label>
              <textarea
                id="item-notes"
                className="input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}

        <ErrorNotice error={create.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending} disabled={itemType === 'song' && !songId}>
            {t('common:actions.add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
