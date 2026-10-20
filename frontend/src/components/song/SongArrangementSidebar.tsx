import { useTranslation } from 'react-i18next';
import type { ArrangementRow } from '@service-center/shared';
import { Button } from '../ui';
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
  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</p>
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
    `block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition ${
      selected
        ? 'bg-brand-50 font-medium text-brand-700'
        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300'
    }`;

  return (
    <aside className="space-y-6">
      <section>
        <SectionLabel>{t('sidebar.song')}</SectionLabel>
        <button
          type="button"
          onClick={() => onSelect({ kind: 'all' })}
          aria-current={pane.kind === 'all' ? 'true' : undefined}
          className={rowClass(pane.kind === 'all')}
        >
          {t('songDetail.allArrangements')}
        </button>
      </section>

      <section>
        <SectionLabel>{t('sidebar.arrangements')}</SectionLabel>

        {arrangements.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-400">
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
                    {arrangement.name}
                    {arrangement.archived_at && <span className="ml-1 text-xs text-slate-400">{t('sidebar.archived')}</span>}
                    {arrangement.song_key && (
                      <span className="ml-1 text-xs text-slate-400">[{arrangement.song_key}]</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {canManage && (
          <Button variant="secondary" className="mt-2 !py-1 text-xs" onClick={onAdd}>
            {t('common:actions.add')}
          </Button>
        )}
      </section>
    </aside>
  );
};
