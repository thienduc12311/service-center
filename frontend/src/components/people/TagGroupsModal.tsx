import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { RosterTagCatalog } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useTagCatalog } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading, Modal } from '../ui';

export interface TagGroupsModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Organizes skill tags into groups ("Instruments", "Languages"). Tags stay
 * on people; deleting a group only ungroups its tags.
 */
export const TagGroupsModal = ({ open, onClose }: TagGroupsModalProps) => {
  const { t } = useTranslation(['people', 'common']);
  const { organizationId } = useAuth();
  const client = useQueryClient();
  const catalog = useTagCatalog(open);
  const [name, setName] = useState('');

  const refresh = (next?: RosterTagCatalog) =>
    next
      ? client.setQueryData(keys.tagCatalog(organizationId), next)
      : client.invalidateQueries({ queryKey: keys.tagCatalog(organizationId) });

  const createGroup = useMutation({
    mutationFn: () => api.createTagGroup({ name }),
    onSuccess: async () => {
      setName('');
      await refresh();
    },
  });
  const deleteGroup = useMutation({
    mutationFn: (groupId: string) => api.deleteTagGroup(groupId),
    onSuccess: () => refresh(),
  });
  const setGroup = useMutation({
    mutationFn: ({ tag, groupId }: { tag: string; groupId: string | null }) => api.setTagGroup({ tag, group_id: groupId }),
    onSuccess: (next) => refresh(next),
  });

  const groups = catalog.data?.groups ?? [];

  return (
    <Modal open={open} title={t('tagGroups.title')} onClose={onClose}>
      <div className="space-y-4">
        <ErrorNotice error={catalog.error ?? createGroup.error ?? deleteGroup.error ?? setGroup.error} />
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            createGroup.mutate();
          }}
        >
          <input
            aria-label={t('tagGroups.newGroupLabel')}
            className="input flex-1"
            placeholder={t('tagGroups.newGroupPlaceholder')}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={!name.trim()} loading={createGroup.isPending}>
            {t('tagGroups.addGroup')}
          </Button>
        </form>

        {groups.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <li key={group.id} className="flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-3 pr-1 text-sm dark:bg-slate-800">
                {group.name}
                <button
                  type="button"
                  aria-label={t('tagGroups.deleteGroup', { name: group.name })}
                  className="rounded-full px-1.5 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700"
                  onClick={() => deleteGroup.mutate(group.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {catalog.isLoading ? (
          <Loading />
        ) : (catalog.data?.tags.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">{t('tagGroups.empty')}</p>
        ) : (
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
            {catalog.data?.tags.map((entry) => (
              <li key={entry.tag} className="flex items-center gap-3 py-1.5">
                <span className="flex-1">
                  {entry.tag}
                  <span className="ml-2 text-xs text-slate-500">
                    {t('common:count.people', { count: entry.people })}
                  </span>
                </span>
                <select
                  aria-label={t('tagGroups.groupFor', { tag: entry.tag })}
                  className="input w-40"
                  value={entry.group_id ?? ''}
                  onChange={(e) => setGroup.mutate({ tag: entry.tag, groupId: e.target.value || null })}
                >
                  <option value="">{t('tagGroups.noGroup')}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};
