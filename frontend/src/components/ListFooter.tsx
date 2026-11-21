import { useTranslation } from 'react-i18next';
import { Button } from './ui';

export interface ListFooterProps {
  /** Rows currently on screen. */
  shown: number;
  /** All matching rows, when the server reports it. Unknown totals show no count. */
  total?: number | null;
  /** Present when more rows can be loaded; omitted when the list is complete or capped. */
  onShowMore?: () => void;
  loading?: boolean;
  /** The list is capped with no way to page: ask the user to narrow the search instead. */
  capped?: boolean;
}

/**
 * The honest end of a long list: says how much is on screen out of how much
 * matched, and offers the way to the rest ("Show more" or "refine your search").
 */
export const ListFooter = ({ shown, total, onShowMore, loading = false, capped = false }: ListFooterProps) => {
  const { t } = useTranslation('common');
  const hasTotal = typeof total === 'number' && total > shown;
  if (!hasTotal && !onShowMore && !capped) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 py-2 text-xs text-slate-500 dark:text-slate-400">
      {capped ? (
        <span>{hasTotal ? t('list.showingOfNarrow', { shown, total }) : t('list.refineSearch', { shown })}</span>
      ) : (
        hasTotal && <span>{t('list.showingOf', { shown, total })}</span>
      )}
      {onShowMore && (
        <Button variant="secondary" size="sm" loading={loading} onClick={onShowMore}>
          {t('actions.showMore')}
        </Button>
      )}
    </div>
  );
};
