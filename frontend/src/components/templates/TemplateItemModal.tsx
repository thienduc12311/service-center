import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanItemType, PlanTemplateItem } from '@service-center/shared';
import { useSong, useSongPages } from '../../hooks/queries';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { Button, Modal, Notice } from '../ui';
import { KeySelect } from '../KeySelect';
import { SongSearchList, songListSource } from '../plan/SongSearchList';
import {
  emptyTemplateItemDraft,
  templateItemDraftFrom,
  templateItemFromDraft,
  type TemplateItemDraft,
  type TemplateItemProblem,
} from './templateItemDraft';

/** Rows per page in the song search. */
const SONG_PAGE_SIZE = 10;

const ITEM_TYPES: readonly PlanItemType[] = ['song', 'item', 'header'];

export interface TemplateItemModalProps {
  /** The item being edited; absent to add a new one of `initialType`. */
  item?: PlanTemplateItem;
  initialType?: PlanItemType;
  /** Narrows the song search's "used here" ranking to the template's service type. */
  serviceTypeId: string | null;
  onSave: (item: PlanTemplateItem) => void;
  onClose: () => void;
}

/**
 * Adds or edits one item of a template's order: a header, a free-form item
 * or a song (searched like Edit item's "Change song", with an arrangement and
 * a key). Nothing is saved here: the item goes into the editor's draft, and
 * the editor saves the next revision.
 */
export const TemplateItemModal = ({ item, initialType = 'item', serviceTypeId, onSave, onClose }: TemplateItemModalProps) => {
  const { t } = useTranslation(['templates', 'plans', 'common']);
  const [draft, setDraft] = useState<TemplateItemDraft>(() => (item ? templateItemDraftFrom(item) : emptyTemplateItemDraft(initialType)));
  const [problem, setProblem] = useState<TemplateItemProblem | null>(null);
  const [songQuery, setSongQuery] = useState('');
  const [searching, setSearching] = useState(() => !item && initialType === 'song');
  const settledSongQuery = useDebouncedValue(songQuery.trim());
  const [now] = useState(() => new Date());
  const songs = useSongPages(
    {
      sort: 'title',
      per_page: SONG_PAGE_SIZE,
      ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
      ...(settledSongQuery ? { q: settledSongQuery } : {}),
    },
    draft.itemType === 'song' && searching,
  );
  const song = useSong(draft.itemType === 'song' ? (draft.songId ?? undefined) : undefined);
  const arrangements = (song.data?.arrangements ?? []).filter(
    (arrangement) => !arrangement.archived_at || arrangement.id === draft.arrangementId,
  );
  const chosenArrangement =
    arrangements.find((arrangement) => arrangement.id === draft.arrangementId) ??
    (draft.arrangementId ? null : (arrangements.find((arrangement) => arrangement.is_default) ?? null));

  const set = <K extends keyof TemplateItemDraft>(key: K, value: TemplateItemDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = templateItemFromDraft(draft);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    onSave(result.item);
  };

  return (
    <Modal open title={item ? t('itemForm.editTitle', { title: item.title }) : t('itemForm.addTitle')} onClose={onClose} size="wide">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <fieldset>
          <legend className="label">{t('itemForm.type')}</legend>
          <div className="flex flex-wrap gap-2">
            {ITEM_TYPES.map((value) => (
              <label key={value} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${draft.itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                <input type="radio" name="template-item-type" value={value} checked={draft.itemType === value} onChange={() => set('itemType', value)} className="sr-only" />
                {t(`plans:itemKind.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>

        {draft.itemType === 'song' && (
          <div className="space-y-3 rounded-xl border border-app-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                <span className="text-slate-500 dark:text-slate-400">{t('itemForm.song')} </span>
                <span className="font-medium">{draft.songTitle ?? t('itemForm.noSong')}</span>
              </p>
              <Button type="button" variant="secondary" onClick={() => setSearching((open) => !open)} aria-expanded={searching}>
                {searching ? t('itemForm.closeSearch') : draft.songId ? t('itemForm.changeSong') : t('itemForm.findSong')}
              </Button>
            </div>
            {searching && (
              <SongSearchList
                searchLabel={t('itemForm.searchSongs')}
                placeholder={t('plans:editItem.searchPlaceholder')}
                text={songQuery}
                onTextChange={setSongQuery}
                settledText={settledSongQuery}
                songs={songListSource(songs)}
                onPick={(picked) => {
                  setDraft((current) => ({
                    ...current,
                    songId: picked.id,
                    songTitle: picked.title,
                    title: current.title && current.title !== current.songTitle ? current.title : picked.title,
                    arrangementId: null,
                    keyOverride: null,
                  }));
                  setSearching(false);
                  setProblem(null);
                }}
                pickLabel={(candidate) => t('plans:editItem.useSong', { title: candidate.title })}
                compact
                autoFocus
                emptyText={t('plans:addItem.noSongs')}
                now={now}
              />
            )}
            {draft.songId && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="template-item-arrangement">{t('plans:editItem.arrangement')}</label>
                  <select
                    id="template-item-arrangement"
                    className="input"
                    value={draft.arrangementId ?? ''}
                    disabled={song.isLoading}
                    onChange={(event) => set('arrangementId', event.target.value || null)}
                  >
                    <option value="">{t('plans:editItem.songDefault')}</option>
                    {arrangements.map((arrangement) => (
                      <option key={arrangement.id} value={arrangement.id}>
                        {arrangement.song_key
                          ? t('plans:editItem.arrangementWithKey', { name: arrangement.name, key: arrangement.song_key })
                          : arrangement.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="template-item-key">{t('plans:editItem.serviceKey')}</label>
                  <KeySelect
                    id="template-item-key"
                    value={draft.keyOverride}
                    onChange={(value) => set('keyOverride', value)}
                    placeholder={chosenArrangement?.song_key ? t('plans:editItem.arrangementKeyNamed', { key: chosenArrangement.song_key }) : t('plans:editItem.arrangementKey')}
                    resetLabel={t('plans:editItem.useArrangementKey')}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <label className="label" htmlFor="template-item-title">{t('itemForm.title')}</label>
          <input
            id="template-item-title"
            className="input"
            maxLength={200}
            value={draft.title}
            placeholder={draft.itemType === 'song' ? (draft.songTitle ?? '') : ''}
            onChange={(event) => set('title', event.target.value)}
          />
        </div>

        {draft.itemType !== 'header' && (
          <>
            <div className="sm:w-1/2">
              <label className="label" htmlFor="template-item-length">{t('itemForm.length')}</label>
              <input id="template-item-length" className="input" inputMode="numeric" placeholder="4:30" value={draft.length} onChange={(event) => set('length', event.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="template-item-description">{t('itemForm.description')}</label>
              <textarea id="template-item-description" className="input" rows={2} maxLength={4000} value={draft.description} onChange={(event) => set('description', event.target.value)} />
            </div>
          </>
        )}

        {problem && <Notice tone="warning">{t(`itemForm.errors.${problem}`)}</Notice>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit">{item ? t('itemForm.update') : t('itemForm.add')}</Button>
        </div>
      </form>
    </Modal>
  );
};
