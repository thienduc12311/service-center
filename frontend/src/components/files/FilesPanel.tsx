import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileOwnerRef } from '@service-center/shared';
import { useInvalidateFiles, useParentFiles } from '../../hooks/queries';
import { ErrorNotice, Loading, Menu, MenuItem } from '../ui';
import { AddFileModal, type AddFileMode } from './AddFileModal';
import { FileRow } from './FileRow';

export interface FilesPanelProps {
  owner: FileOwnerRef;
  title?: string;
  description?: string;
  planId?: string | null;
  /** What to say when there is nothing to show. */
  emptyText?: string;
}

/** The files one parent owns, with add/replace/archive for people who may change them. */
export const FilesPanel = ({ owner, title, description, planId = null, emptyText }: FilesPanelProps) => {
  const { t } = useTranslation(['media', 'common']);
  const files = useParentFiles(owner.kind, owner.id);
  const invalidate = useInvalidateFiles();
  const [adding, setAdding] = useState<AddFileMode | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const all = files.data?.files ?? [];
  const archivedCount = all.filter((file) => file.archived_at).length;
  const visible = showArchived ? all : all.filter((file) => !file.archived_at);

  return (
    <section className="card p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-white">{title ?? t('filesPanel.title')}</h2>
          {description && <p className="text-sm text-slate-500">{description}</p>}
        </div>
        {files.data?.can_add && (
          <Menu label={t('common:actions.add')}>
            {(close) => (
              <>
                <MenuItem onClick={() => { close(); setAdding('upload'); }}>{t('addFile.menu.upload')}</MenuItem>
                <MenuItem onClick={() => { close(); setAdding('link'); }}>{t('addFile.menu.link')}</MenuItem>
                <MenuItem onClick={() => { close(); setAdding('document'); }}>{t('addFile.menu.document')}</MenuItem>
              </>
            )}
          </Menu>
        )}
      </div>

      {files.isLoading && <Loading label={t('filesPanel.loading')} />}
      <ErrorNotice error={files.error} />
      {files.data && visible.length === 0 && (
        <p className="py-4 text-sm text-slate-500">
          {emptyText ?? (files.data.can_add ? t('filesPanel.empty') : t('filesPanel.emptyReader'))}
        </p>
      )}
      {visible.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {visible.map((file) => (
            <FileRow key={file.id} file={file} planId={planId} onChanged={invalidate} />
          ))}
        </ul>
      )}
      {archivedCount > 0 && (
        <button type="button" className="mt-2 text-xs text-slate-500 underline" onClick={() => setShowArchived((value) => !value)}>
          {showArchived ? t('filesPanel.hideArchived') : t('filesPanel.showArchived', { count: archivedCount })}
        </button>
      )}

      {adding && (
        <AddFileModal
          owner={owner}
          planId={planId}
          mode={adding}
          onClose={() => setAdding(null)}
          onAdded={() => void invalidate()}
        />
      )}
    </section>
  );
};
