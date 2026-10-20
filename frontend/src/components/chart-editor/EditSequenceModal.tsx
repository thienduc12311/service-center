import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { SEQUENCE_LABEL_GROUPS } from '@service-center/shared';
import { Button, Modal } from '../ui';

export interface EditSequenceModalProps {
  open: boolean;
  sequence: readonly string[];
  onClose: () => void;
  onSave: (sequence: string[]) => void;
}

/** Longest label the arrangement schema will accept. */
const MAX_LABEL_LENGTH = 20;
const MAX_SECTIONS = 60;

const CHIP =
  'inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700 ' +
  'transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

/**
 * Builds the order the sections are played in.
 *
 * Sections repeat — a chorus is normally sung three times — so the palette adds
 * rather than toggles, and the running order on the left is what is saved.
 */
export const EditSequenceModal = ({ open, sequence, onClose, onSave }: EditSequenceModalProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const [draft, setDraft] = useState<string[]>([...sequence]);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    if (open) {
      setDraft([...sequence]);
      setCustom('');
    }
  }, [open, sequence]);

  const add = (label: string) => {
    const trimmed = label.trim().slice(0, MAX_LABEL_LENGTH);
    if (!trimmed || draft.length >= MAX_SECTIONS) return;
    setDraft((current) => [...current, trimmed]);
  };

  const removeAt = (index: number) =>
    setDraft((current) => current.filter((_, position) => position !== index));

  /** Swaps a section with its neighbour, which is how the order is changed. */
  const moveBy = (index: number, offset: number) =>
    setDraft((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    add(custom);
    setCustom('');
  };

  return (
    <Modal open={open} title={t('sequence.title')} onClose={onClose} size="wide">
      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h3 className="label">{t('arrangement.fields.sequence')}</h3>
          <div className="min-h-56 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            {draft.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-400">
                {t('sequence.empty')}
              </p>
            ) : (
              <ol className="space-y-1">
                {draft.map((label, index) => (
                  <li
                    key={`${label}-${index}`}
                    className="flex items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 dark:bg-slate-800"
                  >
                    <span className="w-5 text-xs text-slate-400">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                      {label}
                    </span>
                    <button
                      type="button"
                      className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      onClick={() => moveBy(index, -1)}
                      disabled={index === 0}
                      aria-label={t('sequence.moveEarlier', { label })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="px-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
                      onClick={() => moveBy(index, 1)}
                      disabled={index === draft.length - 1}
                      aria-label={t('sequence.moveLater', { label })}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="px-1 text-slate-400 hover:text-rose-600"
                      onClick={() => removeAt(index)}
                      aria-label={t('sequence.remove', { label })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        <section>
          <h3 className="label">{t('sequence.sectionLabels')}</h3>
          <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            {SEQUENCE_LABEL_GROUPS.map((group, index) => (
              <div
                key={group.join()}
                className={`flex flex-wrap gap-1.5 py-2 ${
                  index > 0 ? 'border-t border-slate-100 dark:border-slate-800' : ''
                }`}
              >
                {group.map((label) => (
                  <button key={label} type="button" className={CHIP} onClick={() => add(label)}>
                    <span aria-hidden="true" className="text-xs text-slate-400">
                      +
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            ))}

            <form onSubmit={addCustom} className="flex items-center gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
              <input
                className="input !py-1.5 text-sm"
                value={custom}
                maxLength={MAX_LABEL_LENGTH}
                placeholder={t('sequence.newLabelPlaceholder')}
                aria-label={t('sequence.newLabelAria')}
                onChange={(event) => setCustom(event.target.value)}
              />
              <Button type="submit" variant="secondary" className="!py-1.5" disabled={!custom.trim()}>
                {t('common:actions.add')}
              </Button>
            </form>
          </div>
        </section>
      </div>

      <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
        <Button variant="secondary" onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          onClick={() => {
            onSave(draft);
            onClose();
          }}
        >
          {t('common:actions.save')}
        </Button>
      </div>
    </Modal>
  );
};
