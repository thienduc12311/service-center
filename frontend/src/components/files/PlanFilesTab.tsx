import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import type { FileOwnerRef, PlanDetail, PlanFileEntry, SetFileLinkPinInput } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateFiles, useParentFiles, usePlanFiles } from '../../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Menu, MenuItem, Modal } from '../ui';
import { AddFileModal, type AddFileMode } from './AddFileModal';
import { FileRow } from './FileRow';
import { fileErrorMessage } from './fileActions';

export interface PlanFilesTabProps {
  plan: PlanDetail;
}

interface EntryBadgesProps {
  entry: PlanFileEntry;
}

const EntryBadges = ({ entry }: EntryBadgesProps) => {
  const { t } = useTranslation('media');
  return (
    <>
      {entry.source === 'song' && <Badge tone="bg-sky-50 text-sky-800 ring-sky-600/20">{t('planFiles.fromSong')}</Badge>}
      {entry.source === 'arrangement' && <Badge tone="bg-sky-50 text-sky-800 ring-sky-600/20">{t('planFiles.fromArrangement')}</Badge>}
      {entry.link?.source === 'service_type_default' && <Badge tone="bg-violet-50 text-violet-800 ring-violet-600/20">{t('planFiles.serviceTypeDefault')}</Badge>}
      {entry.link && entry.link.source === 'manual' && <Badge tone="bg-violet-50 text-violet-800 ring-violet-600/20">{t('planFiles.linked')}</Badge>}
      {entry.link?.pinned_version_id && entry.version?.version_number && (
        <Badge tone="bg-slate-50 text-slate-700 ring-slate-500/20">{t('planFiles.pinnedTo', { number: entry.version.version_number })}</Badge>
      )}
      {entry.newer_version_available && <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">{t('planFiles.newerAvailable')}</Badge>}
    </>
  );
};

/**
 * Everything this plan uses, grouped by plan and item. Song/arrangement files
 * follow the song; linked defaults keep the version they were pinned to until
 * a plan editor deliberately moves them on.
 */
export const PlanFilesTab = ({ plan }: PlanFilesTabProps) => {
  const { t } = useTranslation(['media', 'common']);
  const files = usePlanFiles(plan.id);
  const invalidate = useInvalidateFiles();
  const [adding, setAdding] = useState<{ owner: FileOwnerRef; mode: AddFileMode } | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pin = useMutation({
    mutationFn: ({ linkId, body }: { linkId: string; body: SetFileLinkPinInput }) => api.setFileLinkPin(linkId, body),
    onSettled: invalidate,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });
  const unlink = useMutation({
    mutationFn: (linkId: string) => api.unlinkFile(linkId),
    onSettled: invalidate,
    onError: (cause) => setError(fileErrorMessage(cause)),
  });

  if (files.isLoading) return <Loading label={t('filesPanel.loading')} />;
  if (files.error) return <ErrorNotice error={files.error} />;
  const data = files.data;
  if (!data) return null;

  const entries = data.entries;
  const canEdit = data.can_edit;
  const addMenu = (owner: FileOwnerRef) =>
    canEdit && (
      <Menu label={t('common:actions.add')}>
        {(close) => (
          <>
            <MenuItem onClick={() => { close(); setAdding({ owner, mode: 'upload' }); }}>{t('addFile.menu.upload')}</MenuItem>
            <MenuItem onClick={() => { close(); setAdding({ owner, mode: 'link' }); }}>{t('addFile.menu.link')}</MenuItem>
            <MenuItem onClick={() => { close(); setAdding({ owner, mode: 'document' }); }}>{t('addFile.menu.document')}</MenuItem>
          </>
        )}
      </Menu>
    );

  const linkActions = (entry: PlanFileEntry) => {
    const link = entry.link;
    if (!link || !canEdit) return undefined;
    return (close: () => void) => (
      <>
        {entry.newer_version_available && (
          <MenuItem onClick={() => { close(); pin.mutate({ linkId: link.id, body: { mode: 'current' } }); }}>
            {t('planFiles.useNewest')}
          </MenuItem>
        )}
        {link.pinned_version_id ? (
          <MenuItem onClick={() => { close(); pin.mutate({ linkId: link.id, body: { mode: 'follow' } }); }}>
            {t('planFiles.followNewest')}
          </MenuItem>
        ) : (
          <MenuItem onClick={() => { close(); pin.mutate({ linkId: link.id, body: { mode: 'current' } }); }}>
            {t('planFiles.pinCurrent')}
          </MenuItem>
        )}
        <MenuItem onClick={() => { close(); unlink.mutate(link.id); }}>{t('planFiles.removeFromPlan')}</MenuItem>
      </>
    );
  };

  const renderEntries = (list: PlanFileEntry[]) => (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {list.map((entry) => (
        <FileRow
          key={`${entry.file.id}:${entry.plan_item_id ?? ''}:${entry.link?.id ?? ''}`}
          file={entry.file}
          version={entry.version}
          planId={plan.id}
          badges={<EntryBadges entry={entry} />}
          extraActions={linkActions(entry)}
          onChanged={invalidate}
        />
      ))}
    </ul>
  );

  const planLevel = entries.filter((entry) => entry.plan_item_id === null && !(entry.file.archived_at && !entry.link));
  const items = plan.items.filter((item) => item.item_type !== 'header');
  const anyItemFiles = items.some((item) => entries.some((entry) => entry.plan_item_id === item.id));

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500">{t('planFiles.intro')}</p>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-600/20">
          {error}
        </p>
      )}

      <section className="card p-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('planFiles.thisPlan')}</h2>
          <div className="flex gap-2">
            {canEdit && plan.service_type_id && (
              <Button variant="secondary" onClick={() => setLinking(true)}>
                {t('planFiles.addDefault')}
              </Button>
            )}
            {addMenu({ kind: 'plan', id: plan.id })}
          </div>
        </div>
        {planLevel.length ? renderEntries(planLevel) : <p className="py-3 text-sm text-slate-500">{t('planFiles.noPlanFiles')}</p>}
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-semibold">{t('planFiles.items')}</h2>
        {!items.length && <p className="text-sm text-slate-500">{t('planFiles.noItems')}</p>}
        {items.length > 0 && !anyItemFiles && !canEdit && (
          <EmptyState title={t('planFiles.noItemFilesTitle')} description={t('planFiles.noItemFilesDescription')} />
        )}
        <ul className="space-y-5">
          {items.map((item) => {
            const list = entries.filter((entry) => entry.plan_item_id === item.id);
            if (!list.length && !canEdit) return null;
            return (
              <li key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</h3>
                  {addMenu({ kind: 'plan_item', id: item.id })}
                </div>
                {list.length ? renderEntries(list) : <p className="py-2 text-xs text-slate-500">{t('planFiles.noFiles')}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      {adding && (
        <AddFileModal
          owner={adding.owner}
          planId={plan.id}
          mode={adding.mode}
          onClose={() => setAdding(null)}
          onAdded={() => void invalidate()}
        />
      )}
      {linking && plan.service_type_id && (
        <LinkDefaultModal
          planId={plan.id}
          serviceTypeId={plan.service_type_id}
          linkedIds={new Set(entries.flatMap((entry) => (entry.link ? [entry.file.id] : [])))}
          onClose={() => setLinking(false)}
          onLinked={() => void invalidate()}
        />
      )}
    </div>
  );
};

interface LinkDefaultModalProps {
  planId: string;
  serviceTypeId: string;
  linkedIds: ReadonlySet<string>;
  onClose: () => void;
  onLinked: () => void;
}

/** Puts one of the service type's default files on this plan, pinned to its current version. */
const LinkDefaultModal = ({ planId, serviceTypeId, linkedIds, onClose, onLinked }: LinkDefaultModalProps) => {
  const { t } = useTranslation(['media', 'common']);
  const defaults = useParentFiles('service_type', serviceTypeId);
  const link = useMutation({
    mutationFn: (fileId: string) => api.linkFileToPlan(planId, { file_id: fileId, pin: true }),
    onSuccess: () => {
      onLinked();
      onClose();
    },
  });
  const options = (defaults.data?.files ?? []).filter((file) => !file.archived_at && !linkedIds.has(file.id) && (file.current_version || file.kind === 'link'));

  return (
    <Modal open title={t('planFiles.addDefault')} onClose={onClose}>
      {defaults.isLoading && <Loading />}
      <ErrorNotice error={defaults.error} />
      {defaults.data && !options.length && <p className="text-sm text-slate-500">{t('planFiles.allDefaultsLinked')}</p>}
      <ul className="divide-y divide-slate-100">
        {options.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{file.title}</span>
            <Button variant="secondary" loading={link.isPending && link.variables === file.id} onClick={() => link.mutate(file.id)}>
              {t('common:actions.add')}
            </Button>
          </li>
        ))}
      </ul>
      {link.error && <p role="alert" className="mt-3 text-sm text-rose-700">{fileErrorMessage(link.error)}</p>}
      <p className="mt-4 text-xs text-slate-500">{t('planFiles.defaultPinHint')}</p>
    </Modal>
  );
};
