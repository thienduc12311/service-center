import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  formatDuration,
  keyedPlanItemRequest,
  newPlanItemRequest,
  validateNewPlanItemDraft,
  type CreatePlanItemRequest,
  type NewPlanItemDraft,
  type NewPlanItemMedia,
  type PlanItemType,
} from '@service-center/shared';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal, Notice } from '../ui';
import { MediaPickerList } from '../media/MediaPickerList';
import { MediaThumbnail } from '../media/MediaThumbnail';
import { INSERT_AT_END, type OrderInsertPoint } from './insertPoint';
import { usePlanItemInsert } from './usePlanItemInsert';

/** What this form adds; songs are added from the song browser panel. */
type OtherItemType = Exclude<PlanItemType, 'song'>;
const OTHER_ITEM_TYPES: readonly OtherItemType[] = ['item', 'header', 'media'];

/** The bundle a media item is made from, with its thumbnail for the chosen card. */
interface ChosenMedia extends NewPlanItemMedia {
  thumbnail_file_id: string | null;
}

export interface AddItemModalProps {
  open: boolean;
  planId: string;
  /** Where the item goes; the end of the order unless the planner chose a spot. */
  insertPoint?: OrderInsertPoint;
  /** Called with the new item's id once it is in the order. */
  onAdded?: (itemId: string) => void;
  onClose: () => void;
}

/**
 * Headers, free-form items and media items: a title (and for items a length
 * and notes), at the insert point. A media item starts from a bundle picked
 * from the media library, whose title and length fill the form.
 */
export const AddItemModal = ({ open, planId, insertPoint = INSERT_AT_END, onAdded, onClose }: AddItemModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const invalidate = useInvalidateOrg();
  const insert = usePlanItemInsert(planId);
  const [itemType, setItemType] = useState<OtherItemType>('item');
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');
  const [media, setMedia] = useState<ChosenMedia | null>(null);
  const [placementWarning, setPlacementWarning] = useState<string | null>(null);
  const [formError, setFormError] = useState<LocalizedError | null>(null);

  const close = () => {
    setPlacementWarning(null);
    onClose();
  };

  // The last unanswered add: sending the same draft again reuses its key, so
  // a retry after a lost response returns that item instead of a second one.
  const pending = useRef<CreatePlanItemRequest | null>(null);

  // The same body the native app sends (shared `newPlanItemRequest`).
  const create = useMutation({
    mutationFn: (draft: NewPlanItemDraft) => {
      const body = keyedPlanItemRequest(
        newPlanItemRequest(draft, t('itemKind.song')),
        pending.current,
        () => crypto.randomUUID(),
      );
      pending.current = body;
      return insert(body, insertPoint);
    },
    onSuccess: async ({ item, placed }) => {
      pending.current = null;
      await invalidate();
      setTitle('');
      setLength('');
      setDescription('');
      setMedia(null);
      if (placed) {
        onAdded?.(item.id);
        close();
      } else {
        setPlacementWarning(item.title);
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (create.isPending) return;
    setPlacementWarning(null);
    const draft: NewPlanItemDraft = {
      itemType,
      title,
      song: null,
      keyOverride: null,
      length,
      description,
      media: itemType === 'media' && media ? { id: media.id, title: media.title, duration_seconds: media.duration_seconds } : null,
    };
    const problem = validateNewPlanItemDraft(draft);
    setFormError(problem ? new LocalizedError({ key: `plans:editItem.errors.${problem}` }) : null);
    if (!problem) create.mutate(draft);
  };

  const chooseMedia = (chosen: ChosenMedia) => {
    setMedia(chosen);
    setTitle(chosen.title);
    setLength(chosen.duration_seconds ? formatDuration(chosen.duration_seconds) : '');
    setFormError(null);
  };
  const choosingMedia = itemType === 'media' && !media;

  return (
    <Modal open={open} title={t('addItem.title')} onClose={close}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('editItem.type')}>
          {OTHER_ITEM_TYPES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={itemType === value}
              onClick={() => {
                setItemType(value);
                setFormError(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                itemType === value ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t(`itemKind.${value}`)}
            </button>
          ))}
        </div>

        {itemType === 'media' && (
          media ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800">
              <span className="flex min-w-0 items-center gap-3">
                <MediaThumbnail fileId={media.thumbnail_file_id} alt={t('addItem.mediaThumbnail', { title: media.title })} />
                <span className="min-w-0">
                  <span className="block text-xs text-slate-500">{t('addItem.chosenMedia')}</span>
                  <span className="block truncate font-medium">{media.title}</span>
                </span>
              </span>
              <Button type="button" variant="secondary" onClick={() => setMedia(null)}>
                {t('addItem.changeMedia')}
              </Button>
            </div>
          ) : (
            <MediaPickerList
              selectedId={null}
              chooseLabel={t('addItem.chooseMedia')}
              chosenLabel={t('addItem.chooseMedia')}
              onChoose={(row) => chooseMedia(row)}
            />
          )
        )}

        {!choosingMedia && (<>
        <div>
          <label className="label" htmlFor="item-title">
            {t('addItem.fieldTitle')}
          </label>
          <input
            id="item-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={
              itemType === 'header' ? t('addItem.headerPlaceholder') : itemType === 'media' ? (media?.title ?? '') : t('addItem.itemPlaceholder')
            }
            maxLength={200}
            required={itemType !== 'media'}
          />
        </div>

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
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </>
        )}
        </>)}

        {placementWarning && <Notice tone="warning">{t('songBrowser.notPlaced', { title: placementWarning })}</Notice>}
        <ErrorNotice error={formError ?? create.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending} disabled={choosingMedia}>
            {t('common:actions.add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
