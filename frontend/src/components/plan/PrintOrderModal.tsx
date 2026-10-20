import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderRunSheetHtml, runSheetDocumentFromPlan, type PlanDetail } from '@service-center/shared';
import { usePlanNotes } from '../../hooks/queries';
import { printDocument } from '../../lib/print-document';
import { Button, ErrorNotice, Loading, Modal } from '../ui';
import { useFormatters, useLanguage } from '../../i18n';

export interface PrintOrderModalProps {
  plan: PlanDetail;
  organizationName: string;
  timeZone: string;
  serviceTimes: ReadonlyArray<{ id: string; name: string | null; starts_at: string }>;
  initialTimeId: string | null;
  positionNames: ReadonlyMap<string, string>;
  onClose: () => void;
}

/** Category id, or this for notes without a category. */
const UNCATEGORIZED = '__none__';

/**
 * F11: print the running order for one service time. Notes come from the
 * notes API, which returns only what this reader may see; the printer then
 * chooses which of those categories go on paper. Nothing is selected by
 * default, so a printout never carries notes nobody chose to share.
 */
export const PrintOrderModal = ({ plan, organizationName, timeZone, serviceTimes, initialTimeId, positionNames, onClose }: PrintOrderModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const { locale } = useLanguage();
  const format = useFormatters();
  const notes = usePlanNotes(plan.id);
  const [timeId, setTimeId] = useState<string | null>(initialTimeId);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [includeLeaders, setIncludeLeaders] = useState(true);
  const clock = (instant: string): string => format.time(instant, { timeZone });

  const categories = notes.data?.categories ?? [];
  const hasUncategorized = (notes.data?.notes ?? []).some((note) => !note.category_id);
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const print = () => {
    const { document } = runSheetDocumentFromPlan({
      plan,
      organizationName,
      timeZone,
      timeId,
      notes: notes.data?.notes ?? [],
      categories,
      selectedCategoryIds: [...selected].map((id) => (id === UNCATEGORIZED ? null : id)),
      includeLeaders,
      positionNames,
      locale,
    });
    printDocument(renderRunSheetHtml(document), t('printOrder.frameTitle'));
    onClose();
  };

  return (
    <Modal open title={t('printOrder.title')} onClose={onClose}>
      <div className="space-y-4">
        {serviceTimes.length > 0 ? (
          <div>
            <label className="label" htmlFor="print-time">{t('printOrder.serviceTime')}</label>
            <select id="print-time" className="input" value={timeId ?? ''} onChange={(event) => setTimeId(event.target.value)}>
              {serviceTimes.map((time) => (
                <option key={time.id} value={time.id}>{t('printOrder.serviceTimeOption', { name: time.name ?? t('timeKind.service'), time: clock(time.starts_at) })}</option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t('printOrder.noServiceTime')}</p>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeLeaders} onChange={(event) => setIncludeLeaders(event.target.checked)} />
          {t('printOrder.includeLeaders')}
        </label>

        <fieldset>
          <legend className="label">{t('printOrder.notesToInclude')}</legend>
          {notes.isLoading ? (
            <Loading label={t('printOrder.loadingNotes')} />
          ) : notes.error ? (
            <ErrorNotice error={notes.error} />
          ) : categories.length === 0 && !hasUncategorized ? (
            <p className="text-sm text-slate-500">{t('printOrder.noNotes')}</p>
          ) : (
            <div className="space-y-1">
              {categories.map((category) => (
                <label key={category.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.has(category.id)} onChange={() => toggle(category.id)} />
                  {category.name}
                </label>
              ))}
              {hasUncategorized && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={selected.has(UNCATEGORIZED)} onChange={() => toggle(UNCATEGORIZED)} />
                  {t('printOrder.generalNotes')}
                </label>
              )}
              <p className="pt-1 text-xs text-slate-500">{t('printOrder.notesHint')}</p>
            </div>
          )}
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="button" onClick={print} disabled={notes.isLoading}>{t('common:actions.print')}</Button>
        </div>
      </div>
    </Modal>
  );
};
