import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { SongWithArrangements } from '@service-center/shared';
import { Menu, MenuItem } from '../ui';

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
  const { t } = useTranslation('songs');
  return (
  <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
    <Link to="/songs" className="text-sm text-slate-400 transition hover:text-brand-600">
      {t('header.back')}
    </Link>

    <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {song.title}
        </h1>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{paneLabel}</p>
      </div>

      {canManage && (
        <Menu label={t('header.actions')}>
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  onEditInformation();
                  close();
                }}
              >
                {t('header.editInformation')}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  onAddArrangement();
                  close();
                }}
              >
                {t('allArrangements.add')}
              </MenuItem>
              <MenuItem
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
