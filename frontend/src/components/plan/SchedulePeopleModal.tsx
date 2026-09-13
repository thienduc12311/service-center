import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, type SchedulingConflict } from '@service-center/shared';
import { api } from '../../lib/api';
import { usePeople, useTeams, useInvalidateOrg } from '../../hooks/queries';
import { Avatar, Button, ErrorNotice, Modal } from '../ui';

export interface SchedulePeopleModalProps {
  open: boolean;
  planId: string;
  /** Pre-selects the team the scheduler was already looking at. */
  initialTeamId?: string | null;
  onClose: () => void;
}

export const SchedulePeopleModal = ({
  open,
  planId,
  initialTeamId,
  onClose,
}: SchedulePeopleModalProps) => {
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const people = usePeople();
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const [positionId, setPositionId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<SchedulingConflict[]>([]);

  const team = teams.data?.find((t) => t.id === teamId);

  const schedule = useMutation({
    mutationFn: (ignoreConflicts: boolean) =>
      api.createAssignments(planId, {
        assignments: selected.map((userId) => ({
          user_id: userId,
          team_id: teamId,
          position_id: positionId || null,
        })),
        ignore_conflicts: ignoreConflicts,
        notify: true,
      }),
    onSuccess: async () => {
      await invalidate();
      setSelected([]);
      setConflicts([]);
      onClose();
    },
    onError: (error) => {
      // 409 carries the list of who is unavailable, so the scheduler can
      // decide to override rather than being stuck.
      if (error instanceof ApiError && error.status === 409) {
        setConflicts((error.details as SchedulingConflict[]) ?? []);
      }
    },
  });

  const toggle = (userId: string) =>
    setSelected((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );

  // Members of the chosen team come first — they're who you usually want.
  // Only people with a login can be scheduled (assignments reference a real
  // account), so no-login roster entries are excluded here.
  const candidates = useMemo(() => {
    const all = (people.data ?? []).filter((person) => person.has_login);
    if (!team) return all;
    const onTeam = new Set(team.members.map((m) => m.user_id));
    return [...all].sort((a, b) => Number(onTeam.has(b.id)) - Number(onTeam.has(a.id)));
  }, [people.data, team]);

  return (
    <Modal open={open} title="Schedule people" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="schedule-team">
            Team
          </label>
          <select
            id="schedule-team"
            className="input"
            value={teamId}
            onChange={(e) => {
              setTeamId(e.target.value);
              setPositionId('');
            }}
          >
            <option value="">Choose a team</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {team && team.positions.length > 0 && (
          <div>
            <label className="label" htmlFor="schedule-position">
              Position
            </label>
            <select
              id="schedule-position"
              className="input"
              value={positionId}
              onChange={(e) => setPositionId(e.target.value)}
            >
              <option value="">No specific position</option>
              {team.positions.map((position) => (
                <option key={position.id} value={position.id}>
                  {position.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <span className="label">People</span>
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {candidates.map((person) => {
              const onTeam = team?.members.some((m) => m.user_id === person.id);
              return (
                <label
                  key={person.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(person.id)}
                    onChange={() => toggle(person.id)}
                    className="size-4 rounded border-slate-300"
                  />
                  <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
                  <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
                  {onTeam && <span className="text-xs text-brand-600">on team</span>}
                </label>
              );
            })}
          </div>
        </div>

        {conflicts.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
            <p className="font-medium">Scheduling conflicts</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {conflicts.map((conflict, index) => {
                const person = people.data?.find((p) => p.id === conflict.user_id);
                return (
                  <li key={`${conflict.user_id}-${index}`}>
                    {person?.full_name ?? 'Someone'} —{' '}
                    {conflict.conflict_type === 'blockout' ? 'unavailable' : 'already scheduled'}
                    {conflict.detail ? ` (${conflict.detail})` : ''}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {schedule.error && !(schedule.error instanceof ApiError && schedule.error.status === 409) && (
          <ErrorNotice error={schedule.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={schedule.isPending}
            disabled={!teamId || selected.length === 0}
            onClick={() => schedule.mutate(conflicts.length > 0)}
          >
            {conflicts.length > 0 ? 'Schedule anyway' : `Schedule ${selected.length || ''}`.trim()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
