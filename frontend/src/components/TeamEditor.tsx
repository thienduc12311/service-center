import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { TeamPositionRow, TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg } from '../hooks/queries';
import { Button, ErrorNotice, Modal } from './ui';

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
    const message = `Delete the “${position.name}” role? People scheduled in it keep their assignment but lose the role.`;
    if (window.confirm(message)) removePosition.mutate(position.id);
  };

  return (
    <Modal open title={`Edit ${team.name}`} onClose={onClose}>
      <form onSubmit={submitDetails} className="space-y-4">
        <div>
          <label className="label" htmlFor="edit-team-name">Name</label>
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
          <label className="label" htmlFor="edit-team-description">Description</label>
          <textarea
            id="edit-team-description"
            className="input"
            rows={2}
            maxLength={500}
            value={details.description}
            onChange={(e) => setDetails({ ...details, description: e.target.value })}
            placeholder="What this team does, and anything people should know before serving."
          />
        </div>

        <div>
          <label className="label" htmlFor="edit-team-color">Colour</label>
          <input
            id="edit-team-color"
            type="color"
            className="h-10 w-20 rounded border border-slate-300"
            value={details.color}
            onChange={(e) => setDetails({ ...details, color: e.target.value })}
          />
        </div>

        <ErrorNotice error={saveDetails.error} />

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" loading={saveDetails.isPending}>
            Save details
          </Button>
        </div>
      </form>

      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Roles</h3>

        <ul className="space-y-1">
          {team.positions.map((position) => (
            <li key={position.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              {renaming?.positionId === position.id ? (
                <>
                  <input
                    className="input flex-1"
                    aria-label={`Rename ${position.name}`}
                    value={renaming.name}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setRenaming({ positionId: position.id, name: e.target.value })}
                  />
                  <Button
                    className="!px-2 text-sm"
                    loading={renamePosition.isPending}
                    disabled={!renaming.name.trim()}
                    onClick={() =>
                      renamePosition.mutate({ positionId: position.id, name: renaming.name.trim() })
                    }
                  >
                    Save
                  </Button>
                  <Button variant="ghost" className="!px-2 text-sm" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{position.name}</span>
                  <Button
                    variant="ghost"
                    className="!px-2 text-sm"
                    onClick={() => setRenaming({ positionId: position.id, name: position.name })}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    className="!px-2 text-sm text-rose-600 hover:bg-rose-50"
                    onClick={() => confirmRemove(position)}
                  >
                    Delete
                  </Button>
                </>
              )}
            </li>
          ))}
          {team.positions.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-slate-400">No roles on this team yet.</li>
          )}
        </ul>

        <form onSubmit={submitNewPosition} className="mt-3 flex items-center gap-2">
          <input
            className="input flex-1"
            aria-label="New role name"
            placeholder="Add a role — Bass, Sound, Greeter…"
            maxLength={80}
            value={newPosition}
            onChange={(e) => setNewPosition(e.target.value)}
          />
          <Button type="submit" variant="secondary" loading={addPosition.isPending} disabled={!newPosition.trim()}>
            Add role
          </Button>
        </form>

        <ErrorNotice error={addPosition.error ?? renamePosition.error ?? removePosition.error} />
      </div>
    </Modal>
  );
};
