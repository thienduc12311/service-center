import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  type AccessMoveChange,
  type ServiceTypeFolderNode,
  type ServiceTypeRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useAccessMembers, useFolderTree, useServiceTypes, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';
import { ScopeAccessEditor } from './ScopeAccessEditor';

/** Every folder with its depth, for pickers. */
const flatten = (nodes: ServiceTypeFolderNode[], depth = 0): Array<{ node: ServiceTypeFolderNode; depth: number }> =>
  nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);

interface PendingMove {
  serviceType: ServiceTypeRow;
  folderId: string | null;
  changes: AccessMoveChange[];
}

/**
 * Nested service-type folders. A folder grant reaches every service type
 * beneath it, so a move that would change anyone's access shows exactly who
 * gains or loses what and needs an explicit confirmation.
 */
export const FolderSettings = () => {
  const { t } = useTranslation(['settings', 'common']);
  const invalidate = useInvalidateOrg();
  const tree = useFolderTree();
  const serviceTypes = useServiceTypes();
  const members = useAccessMembers();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [accessFolder, setAccessFolder] = useState<ServiceTypeFolderNode | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);

  const folders = flatten(tree.data?.folders ?? []);
  const folderOf = new Map(folders.flatMap(({ node }) => node.service_type_ids.map((id) => [id, node.id] as const)));
  const memberName = (userId: string) => members.data?.find((m) => m.user_id === userId)?.full_name ?? t('common:fallback.someone');
  const typeName = (id: string) => serviceTypes.data?.find((type) => type.id === id)?.name ?? t('folders.aServiceType');

  const create = useMutation({
    mutationFn: () => api.createFolder({ name, parent_id: parentId || null }),
    onSuccess: async () => {
      setName('');
      await invalidate();
    },
  });

  const remove = useMutation({ mutationFn: (id: string) => api.deleteFolder(id), onSuccess: invalidate });

  const preview = useMutation({
    mutationFn: async ({ serviceType, folderId }: { serviceType: ServiceTypeRow; folderId: string | null }) => {
      const changes = await api.previewServiceTypeMove(serviceType.id, folderId);
      if (changes.length === 0) {
        await api.moveServiceType(serviceType.id, { folder_id: folderId });
        await invalidate();
        return null;
      }
      return { serviceType, folderId, changes };
    },
    onSuccess: (result) => setPending(result),
  });

  const confirm = useMutation({
    mutationFn: (move: PendingMove) =>
      api.moveServiceType(move.serviceType.id, { folder_id: move.folderId, acknowledge_changes: true }),
    onSuccess: async () => {
      setPending(null);
      await invalidate();
    },
  });

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t('folders.title')}</h3>
        <p className="text-xs text-slate-500">{t('folders.description')}</p>
      </div>

      {tree.isLoading ? (
        <Spinner />
      ) : folders.length === 0 ? (
        <p className="text-sm text-slate-500">{t('folders.empty')}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {folders.map(({ node, depth }) => (
            <li key={node.id} className="flex items-center justify-between gap-2 py-2" style={{ paddingLeft: `${depth * 1.25}rem` }}>
              <span>
                {node.name}
                <span className="text-xs text-slate-400"> · {t('folders.serviceTypeCount', { count: node.service_type_ids.length })}</span>
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" className="!px-2 text-xs" onClick={() => setAccessFolder(node)}>
                  {t('folders.permissions')}
                </Button>
                <Button
                  variant="ghost"
                  className="!px-2 text-xs"
                  disabled={node.children.length > 0 || node.service_type_ids.length > 0}
                  title={node.children.length > 0 || node.service_type_ids.length > 0 ? t('folders.emptyFirst') : undefined}
                  onClick={() => remove.mutate(node.id)}
                >
                  {t('common:actions.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="folder-name">{t('folders.newFolder')}</label>
          <input id="folder-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('folders.namePlaceholder')} />
        </div>
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor="folder-parent">{t('folders.inside')}</label>
          <select id="folder-parent" className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t('folders.topLevel')}</option>
            {folders.map(({ node, depth }) => (
              <option key={node.id} value={node.id}>
                {'— '.repeat(depth)}
                {node.name}
              </option>
            ))}
          </select>
        </div>
        <Button disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          {t('folders.add')}
        </Button>
      </div>

      {(serviceTypes.data ?? []).length > 0 && folders.length > 0 && (
        <div>
          <p className="label">{t('folders.serviceTypes')}</p>
          <ul className="space-y-1 text-sm">
            {(serviceTypes.data ?? []).map((type) => (
              <li key={type.id} className="flex items-center justify-between gap-2">
                <span>{type.name}</span>
                <select
                  aria-label={t('folders.folderFor', { name: type.name })}
                  className="input w-48"
                  value={folderOf.get(type.id) ?? ''}
                  disabled={preview.isPending || confirm.isPending}
                  onChange={(e) => preview.mutate({ serviceType: type, folderId: e.target.value || null })}
                >
                  <option value="">{t('folders.noFolder')}</option>
                  {folders.map(({ node, depth }) => (
                    <option key={node.id} value={node.id}>
                      {'— '.repeat(depth)}
                      {node.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorNotice error={tree.error ?? create.error ?? remove.error ?? preview.error ?? confirm.error} />

      <Modal open={Boolean(pending)} title={t('folders.moveTitle')} onClose={() => setPending(null)}>
        {pending && (
          <div className="space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {pending.changes.map((change) => (
                <li key={`${change.user_id}-${change.capability}-${change.service_type_id}-${change.change}`}>
                  {t(change.change === 'gain' ? 'folders.gains' : 'folders.loses', {
                    name: memberName(change.user_id),
                    permission: t(`capabilities.${change.capability}`),
                    serviceType: typeName(change.service_type_id),
                  })}
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPending(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button loading={confirm.isPending} onClick={() => confirm.mutate(pending)}>
                {t('folders.moveAnyway')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(accessFolder)} title={accessFolder ? t('folders.permissionsTitle', { name: accessFolder.name }) : t('folders.permissions')}
 onClose={() => setAccessFolder(null)}>
        {accessFolder && (
          <ScopeAccessEditor
            scopeType="folder"
            scopeId={accessFolder.id}
            scopeName={accessFolder.name}
            load={() => api.folderAccess(accessFolder.id)}
            save={(input) => api.replaceFolderAccess(accessFolder.id, input)}
          />
        )}
      </Modal>
    </div>
  );
};
