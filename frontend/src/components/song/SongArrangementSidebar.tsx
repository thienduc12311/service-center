import { useTranslation } from 'react-i18next';
import type { ArrangementRow } from '@service-center/shared';
import { Button } from '../ui';
import { Icon } from '../icons';
import type { SongPane } from './types';

export interface SongArrangementSidebarProps {
  arrangements: readonly ArrangementRow[];
  pane: SongPane;
  canManage: boolean;
  onSelect: (pane: SongPane) => void;
  onAdd: () => void;
}

/** Props of a sidebar group caption. */
interface SectionLabelProps {
  children: string;
}

const SectionLabel = ({ children }: SectionLabelProps) => (
  <p className="section-label mb-2 px-1">{children}</p>
);

/**
 * The song's arrangements, one per row. Selecting one swaps the main pane and
 * narrows the Schedule panel to the services that used it.
 */
export const SongArrangementSidebar = ({
  arrangements,
  pane,
  canManage,
  onSelect,
  onAdd,
}: SongArrangementSidebarProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const rowClass = (selected: boolean) =>
    `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
      selected
        ? 'bg-brand-50 font-medium text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25'
        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
    }`;

  return (
    <aside className="card h-fit space-y-5 p-3 lg:sticky lg:top-4">
      <section>
        <SectionLabel>{t('sidebar.song')}</SectionLabel>
        <button
          type="button"
          onClick={() => onSelect({ kind: 'all' })}
          aria-current={pane.kind === 'all' ? 'true' : undefined}
          className={rowClass(pane.kind === 'all')}
        >
          <Icon name="grid" className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{t('songDetail.allArrangements')}</span>
        </button>
      </section>

      <section>
        <SectionLabel>{t('sidebar.arrangements')}</SectionLabel>

        {arrangements.length === 0 ? (
          <p className="surface-inset px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
            {t('sidebar.empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {arrangements.map((arrangement) => {
              const selected =
                pane.kind === 'arrangement' && pane.arrangementId === arrangement.id;
              return (
                <li key={arrangement.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'arrangement', arrangementId: arrangement.id })}
                    aria-current={selected ? 'true' : undefined}
                    className={rowClass(selected)}
                  >
                    <span className="min-w-0 flex-1 truncate">{arrangement.name}</span>
                    {arrangement.archived_at && <span className="shrink-0 text-xs text-slate-400">{t('sidebar.archived')}</span>}
                    {arrangement.song_key && (
                      <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {arrangement.song_key}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <Button variant="ghost" size="sm" icon="plus" className="mt-2 w-full justify-start" onClick={onAdd}>
            {t('common:actions.add')}
          </Button>
        )}
      </section>
    </aside>
  );
};
