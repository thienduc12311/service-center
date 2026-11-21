import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  keyedPlanItemRequest,
  newPlanItemRequest,
  validateNewPlanItemDraft,
  type CreatePlanItemRequest,
  type NewPlanItemDraft,
  type PlanItemType,
} from '@service-center/shared';
import { useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal, Notice } from '../ui';
import { INSERT_AT_END, type OrderInsertPoint } from './insertPoint';
import { usePlanItemInsert } from './usePlanItemInsert';

/** What this form adds; songs are added from the song browser panel. */
type OtherItemType = Exclude<PlanItemType, 'song'>;
const OTHER_ITEM_TYPES: readonly OtherItemType[] = ['item', 'header'];

export interface AddItemModalProps {
  open: boolean;
  planId: string;
  /** Where the item goes; the end of the order unless the planner chose a spot. */
  insertPoint?: OrderInsertPoint;
  /** Called with the new item's id once it is in the order. */
  onAdded?: (itemId: string) => void;
  onClose: () => void;
}

/** Headers and free-form items: a title (and for items a length and notes), at the insert point. */
export const AddItemModal = ({ open, planId, insertPoint = INSERT_AT_END, onAdded, onClose }: AddItemModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const invalidate = useInvalidateOrg();
  const insert = usePlanItemInsert(planId);
  const [itemType, setItemType] = useState<OtherItemType>('item');
  const [title, setTitle] = useState('');
  const [length, setLength] = useState('');
  const [description, setDescription] = useState('');
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
    const draft: NewPlanItemDraft = { itemType, title, song: null, keyOverride: null, length, description };
    const problem = validateNewPlanItemDraft(draft);
    setFormError(problem ? new LocalizedError({ key: `plans:editItem.errors.${problem}` }) : null);
    if (!problem) create.mutate(draft);
  };

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
            maxLength={200}
            required
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

        {placementWarning && <Notice tone="warning">{t('songBrowser.notPlaced', { title: placementWarning })}</Notice>}
        <ErrorNotice error={formError ?? create.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t('common:actions.add')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
