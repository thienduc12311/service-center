import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, ErrorNotice, IconButton, Modal } from './ui';

export interface TeamEditorProps {
  team: TeamWithPositions;
  onClose: () => void;
}

interface TeamDetailsDraft {
  name: string;
  description: string;
  color: string;
}

interface RenamePositionVariables {
  positionId: string;
  name: string;
}

/**
 * Managers edit a team's identity (name, description, colour) and the roles
 * people can be scheduled into. Roles are `team_positions` rows; deleting one
 * clears it from existing assignments, so it asks first.
 */
export const TeamEditor = ({ team, onClose }: TeamEditorProps) => {
  const { t } = useTranslation(['teams', 'common']);
  const invalidate = useInvalidateOrg();

  const [details, setDetails] = useState<TeamDetailsDraft>({
    name: team.name,
    description: team.description ?? '',
    color: team.color,
  });
  const [newPosition, setNewPosition] = useState('');
  const [renaming, setRenaming] = useState<RenamePositionVariables | null>(null);

  const saveDetails = useMutation({
    mutationFn: () =>
      api.updateTeam(team.id, {
        name: details.name.trim(),
        description: details.description.trim() || null,
        color: details.color,
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const addPosition = useMutation({
    mutationFn: (name: string) =>
      api.addPosition(team.id, { name, sort_order: team.positions.length }),
    onSuccess: async () => {
      await invalidate();
      setNewPosition('');
    },
  });

  const renamePosition = useMutation({
    mutationFn: ({ positionId, name }: RenamePositionVariables) =>
      api.updatePosition(team.id, positionId, { name }),
    onSuccess: async () => {
      await invalidate();
      setRenaming(null);
    },
  });

  const removePosition = useMutation({
    mutationFn: (positionId: string) => api.deletePosition(team.id, positionId),
    onSuccess: () => invalidate(),
  });

  const submitDetails = (event: FormEvent) => {
    event.preventDefault();
    saveDetails.mutate();
  };

  const submitNewPosition = (event: FormEvent) => {
    event.preventDefault();
    const name = newPosition.trim();
    if (name) addPosition.mutate(name);
  };

  const confirmRemove = (position: TeamPositionRow) => {
    const message = t('teamEditor.removeConfirm', { position: position.name });
    if (window.confirm(message)) removePosition.mutate(position.id);
  };

  return (
    <Modal open title={t('teamEditor.title', { team: team.name })} onClose={onClose}>
      <form onSubmit={submitDetails} className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-team-name">{t('teamForm.name')}</label>
          <input
            id="edit-team-name"
            className="input"
            value={details.name}
            onChange={(e) => setDetails({ ...details, name: e.target.value })}
            required
            maxLength={120}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-team-description">{t('teamForm.description')}</label>
          <textarea
            id="edit-team-description"
            className="input"
            rows={2}
            maxLength={500}
            value={details.description}
            onChange={(e) => setDetails({ ...details, description: e.target.value })}
            placeholder={t('teamForm.descriptionPlaceholder')}
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-team-color">{t('teamForm.colour')}</label>
          <input
            id="edit-team-color"
            type="color"
            className="h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
            value={details.color}
            onChange={(e) => setDetails({ ...details, color: e.target.value })}
          />
        </div>

        <ErrorNotice error={saveDetails.error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
          <Button type="submit" loading={saveDetails.isPending}>
            {t('teamEditor.saveDetails')}
          </Button>
        </div>
      </form>

      <div className="mt-6 border-t border-app-border pt-5">
        <h3 className="section-label mb-3">{t('teamEditor.roles')}</h3>

        <ul className="surface-inset row-list overflow-hidden">
          {team.positions.map((position) => (
            <li key={position.id} className="flex items-center gap-2 px-3 py-2">
              {renaming?.positionId === position.id ? (
                <>
                  <input
                    className="input flex-1"
                    aria-label={t('teamEditor.renameLabel', { position: position.name })}
                    value={renaming.name}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setRenaming({ positionId: position.id, name: e.target.value })}
                  />
                  <Button
                    size="sm"
                    loading={renamePosition.isPending}
                    disabled={!renaming.name.trim()}
                    onClick={() =>
                      renamePosition.mutate({ positionId: position.id, name: renaming.name.trim() })
                    }
                  >
                    {t('common:actions.save')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                    {t('common:actions.cancel')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{position.name}</span>
                  <IconButton
                    icon="pencil"
                    size="sm"
                    label={t('teamEditor.rename')}
                    onClick={() => setRenaming({ positionId: position.id, name: position.name })}
                  />
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={t('common:actions.delete')}
                    className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400"
                    onClick={() => confirmRemove(position)}
                  />
                </>
              )}
            </li>
          ))}
          {team.positions.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-400">{t('teamEditor.noRoles')}</li>
          )}
        </ul>

        <form onSubmit={submitNewPosition} className="mt-3 flex items-center gap-2">
          <input
            className="input flex-1"
            aria-label={t('teamEditor.newRoleLabel')}
            placeholder={t('teamEditor.newRolePlaceholder')}
            maxLength={80}
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value)}
          />
          <Button type="submit" variant="secondary" icon="plus" loading={addPosition.isPending} disabled={!newPosition.trim()}>
            {t('teamEditor.addRole')}
          </Button>
        </form>

        <ErrorNotice error={addPosition.error ?? renamePosition.error ?? removePosition.error} />
      </div>
    </Modal>
  );
};
