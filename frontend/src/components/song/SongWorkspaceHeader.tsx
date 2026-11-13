import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SongWithArrangements } from '@service-center/shared';
import { Menu, MenuItem } from '../ui';
import { Icon } from '../icons';

export interface SongWorkspaceHeaderProps {
  song: SongWithArrangements;
  /** What the main pane is showing — the arrangement name, or the overview. */
  paneLabel: string;
  canManage: boolean;
  onEditInformation: () => void;
  onAddArrangement: () => void;
  onDelete: () => void;
}

/**
 * The bar above the workspace: the song's own title (not the arrangement's),
 * so the page always says which song is open however the sidebar is set.
 */
export const SongWorkspaceHeader = ({
  song,
  paneLabel,
  canManage,
  onEditInformation,
  onAddArrangement,
  onDelete,
}: SongWorkspaceHeaderProps) => {
  const { t } = useTranslation(['songs', 'common']);
  return (
    <header>
      <Link
        to="/songs"
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 transition hover:text-brand-700 dark:text-slate-400 dark:hover:text-brand-200"
      >
        <Icon name="chevronLeft" className="size-4" />
        {t('common:nav.songs')}
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-700 text-white shadow-sm shadow-brand-600/30">
            <Icon name="music" className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] sm:leading-9 dark:text-white">
              {song.title}
            </h1>
            <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
              {song.author ? `${song.author} · ${paneLabel}` : paneLabel}
            </p>
          </div>
        </div>

        {canManage && (
          <Menu label={t('header.actions')} icon="more">
            {(close) => (
              <>
                <MenuItem
                  icon="pencil"
                  onClick={() => {
                    onEditInformation();
                    close();
                  }}
                >
                  {t('header.editInformation')}
                </MenuItem>
                <MenuItem
                  icon="plus"
                  onClick={() => {
                    onAddArrangement();
                    close();
                  }}
                >
                  {t('allArrangements.add')}
                </MenuItem>
                <div className="my-1 border-t border-app-border" />
                <MenuItem
                  icon="trash"
                  tone="danger"
                  onClick={() => {
                    onDelete();
                    close();
                  }}
                >
                  {t('header.deleteSong')}
                </MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>
    </header>
  );
};
