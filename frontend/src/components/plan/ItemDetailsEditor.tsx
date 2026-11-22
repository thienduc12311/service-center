import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLAN_ITEM_DETAILS_MAX } from '@service-center/shared';
import { Segmented } from '../ui';
import { ItemDetailsView } from './ItemDetailsView';
import { DETAILS_FORMATS, applyDetailsFormat, type DetailsFormat, type DetailsPlaceholders } from './itemDetailsFormat';

export interface ItemDetailsEditorProps {
  value: string;
  onChange: (value: string) => void;
}

/** Write or see the rendered result. */
type DetailsTab = 'write' | 'preview';

/** What each toolbar button shows (its full name is its accessible label). */
const FORMAT_GLYPH: Record<DetailsFormat, string> = {
  bold: 'B',
  italic: 'I',
  heading: 'H',
  bulleted: '•',
  numbered: '1.',
  link: '[ ]',
};

const FORMAT_GLYPH_CLASS: Partial<Record<DetailsFormat, string>> = {
  bold: 'font-bold',
  italic: 'italic font-serif',
};

/**
 * Item details: a Markdown textarea with a small toolbar (bold, italic,
 * heading, bulleted/numbered list, link) and a Preview tab that renders
 * exactly what the order shows (the shared, HTML-free renderer).
 */
export const ItemDetailsEditor = ({ value, onChange }: ItemDetailsEditorProps) => {
  const { t } = useTranslation('plans');
  const id = useId();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<DetailsTab>('write');
  const placeholders: DetailsPlaceholders = {
    bold: t('editItem.format.boldText'),
    italic: t('editItem.format.italicText'),
    heading: t('editItem.format.headingText'),
    listItem: t('editItem.format.listItem'),
    link: t('editItem.format.linkText'),
  };

  const format = (action: DetailsFormat) => {
    const field = textarea.current;
    const edit = applyDetailsFormat(
      { value, selectionStart: field?.selectionStart ?? value.length, selectionEnd: field?.selectionEnd ?? value.length },
      action,
      placeholders,
    );
    onChange(edit.value);
    // Restore focus and select what was inserted, after React writes the value.
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  const tooLong = value.length > PLAN_ITEM_DETAILS_MAX;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
        <label className="label !mb-0" htmlFor={`${id}-details`}>{t('editItem.details')}</label>
        <Segmented<DetailsTab>
          label={t('editItem.details')}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'write', label: t('editItem.detailsWrite') },
            { value: 'preview', label: t('editItem.detailsPreview') },
          ]}
        />
      </div>
      {tab === 'write' ? (
        <div className="rounded-lg border border-app-border">
          <div role="toolbar" aria-label={t('editItem.detailsToolbar')} className="flex flex-wrap gap-0.5 border-b border-app-border px-1.5 py-1">
            {DETAILS_FORMATS.map((action) => (
              <button
                key={action}
                type="button"
                aria-label={t(`editItem.format.${action}`)}
                title={t(`editItem.format.${action}`)}
                onClick={() => format(action)}
                className={`inline-grid h-7 min-w-7 place-items-center rounded px-1.5 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ${FORMAT_GLYPH_CLASS[action] ?? ''}`}
              >
                {FORMAT_GLYPH[action]}
              </button>
            ))}
          </div>
          <textarea
            ref={textarea}
            id={`${id}-details`}
            className="block w-full resize-y rounded-b-lg bg-transparent px-3 py-2 font-mono text-sm outline-none"
            rows={6}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-describedby={`${id}-hint ${id}-count`}
            aria-invalid={tooLong || undefined}
          />
        </div>
      ) : (
        <div className="min-h-24 rounded-lg border border-app-border px-3 py-2" aria-label={t('editItem.detailsPreview')} role="region">
          <ItemDetailsView markdown={value} />
          {!value.trim() && <p className="text-sm text-slate-500 dark:text-slate-400">{t('editItem.detailsEmptyPreview')}</p>}
        </div>
      )}
      <div className="mt-1 flex justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <p id={`${id}-hint`}>{t('editItem.detailsHint')}</p>
        <p id={`${id}-count`} className={`shrink-0 tabular-nums ${tooLong ? 'font-medium text-rose-700 dark:text-rose-300' : ''}`}>
          {t('editItem.detailsCount', { count: value.length, max: PLAN_ITEM_DETAILS_MAX })}
        </p>
      </div>
    </div>
  );
};
