import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, type AssignmentVisibility, type SchedulingConflict } from '@service-center/shared';
import { api } from '../../lib/api';
import { useDeliveryReadiness, useInvalidateOrg, usePeople, usePlan, useTeams } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Avatar, Button, ErrorNotice, Modal } from '../ui';
import { AddGuestForm } from './AddGuestForm';

/** Sentinel option value for "create a plan-only position". */
const NEW_POSITION = '__new__';

export interface SchedulePeopleModalProps {
  open: boolean;
  planId: string;
  /** The plan's service type: scheduling rights can be granted per service type. */
  serviceTypeId: string | null;
  /** Pre-selects the team the scheduler was already looking at. */
  initialTeamId?: string | null;
  onClose: () => void;
}

export const SchedulePeopleModal = ({
  open,
  planId,
  serviceTypeId,
  initialTeamId,
  onClose,
}: SchedulePeopleModalProps) => {
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const allTeams = useTeams();
  // Only the teams this person may schedule on this plan; the server refuses the rest.
  const teams = {
    ...allTeams,
    data: allTeams.data?.filter((t) => can('scheduling.manage', { serviceTypeId, teamId: t.id })),
  };
  const people = usePeople();
  const plan = usePlan(planId);
  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const [filter, setFilter] = useState('');
  const [addingGuest, setAddingGuest] = useState(false);
  const [newPositionName, setNewPositionName] = useState('');
  const [positionId, setPositionId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState<SchedulingConflict[]>([]);
  /** Null follows the team's default. */
  const [visibilityChoice, setVisibilityChoice] = useState<AssignmentVisibility | null>(null);

  const team = teams.data?.find((t) => t.id === teamId);
  const visibility: AssignmentVisibility = visibilityChoice ?? team?.default_visibility ?? 'released';
  /** Positions added for this plan only (F02); the team's normal list is untouched. */
  const planPositions = (plan.data?.plan_positions ?? []).filter((position) => position.team_id === teamId);

  // Who a released request cannot reach: no login and no email on file.
  const readiness = useDeliveryReadiness(selected);
  const unreachable = (readiness.data ?? []).filter((entry) => !entry.has_login && !entry.has_email);

  const addPlanPosition = useMutation({
    mutationFn: () => api.createPlanPosition(planId, { team_id: teamId, name: newPositionName, needed: 1 }),
    onSuccess: async (position) => {
      await invalidate();
      setPositionId(position.id);
      setNewPositionName('');
    },
  });

  const schedule = useMutation({
    mutationFn: (ignoreConflicts: boolean) =>
      api.createAssignments(planId, {
        assignments: selected.map((personId) => ({
          person_id: personId,
          team_id: teamId,
          position_id: positionId || null,
        })),
        ignore_conflicts: ignoreConflicts,
        notify: true,
        visibility,
      }),
    onSuccess: async () => {
      await invalidate();
      setSelected([]);
      setConflicts([]);
      setVisibilityChoice(null);
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

  const toggle = (personId: string) =>
    setSelected((current) =>
      current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId],
    );

  // Members of the chosen team come first — they're who you usually want.
  // Archived people are not in this list (the server leaves them out).
  const candidates = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const all = (people.data ?? []).filter(
      (person) => person.person_id && (!needle || (person.full_name ?? person.email ?? '').toLowerCase().includes(needle)),
    );
    if (!team) return all;
    const onTeam = new Set(team.members.map((m) => m.person_id));
    return [...all].sort(
      (a, b) => Number(onTeam.has(b.person_id!)) - Number(onTeam.has(a.person_id!)),
    );
  }, [people.data, team, filter]);

  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? 'Someone';

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

        {team && (
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
              {planPositions.length > 0 && (
                <optgroup label="This plan only">
                  {planPositions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={NEW_POSITION}>New position for this plan only…</option>
            </select>
            {positionId === NEW_POSITION && (
              <div className="mt-2 space-y-1">
                <div className="flex gap-2">
                  <input
                    aria-label="Plan-only position name"
                    className="input flex-1"
                    placeholder="e.g. Guest trumpet"
                    maxLength={80}
                    value={newPositionName}
                    onChange={(e) => setNewPositionName(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    loading={addPlanPosition.isPending}
                    disabled={!newPositionName.trim()}
                    onClick={() => addPlanPosition.mutate()}
                  >
                    Add
                  </Button>
                </div>
                <p className="text-xs text-slate-500">
                  Belongs to {team.name} on this plan only; the team’s usual positions don’t change.
                </p>
                {addPlanPosition.error && <ErrorNotice error={addPlanPosition.error} />}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between">
            <span className="label">People</span>
            {!addingGuest && (
              <button type="button" className="text-xs font-medium text-brand-600" onClick={() => setAddingGuest(true)}>
                + Someone new
              </button>
            )}
          </div>
          {addingGuest && (
            <div className="mb-2">
              <AddGuestForm
                onCreated={async (person) => {
                  setAddingGuest(false);
                  setSelected((current) => [...current, person.id]);
                  await invalidate();
                }}
                onCancel={() => setAddingGuest(false)}
              />
            </div>
          )}
          <input
            aria-label="Find a person"
            className="input mb-1"
            placeholder="Find a person"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1">
            {candidates.map((person) => {
              const personId = person.person_id!;
              const onTeam = team?.members.some((m) => m.person_id === personId);
              return (
                <label
                  key={personId}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(personId)}
                    onChange={() => toggle(personId)}
                    className="size-4 rounded border-slate-300"
                  />
                  <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
                  <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
                  {!person.has_login && <span className="text-xs text-slate-500">no login</span>}
                  {onTeam && <span className="text-xs text-brand-600">on team</span>}
                </label>
              );
            })}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            checked={visibility === 'prepared'}
            onChange={(e) => setVisibilityChoice(e.target.checked ? 'prepared' : 'released')}
          />
          <span>
            Prepare privately
            <span className="block text-xs text-slate-500">
              Only this team’s schedulers see these requests until you release them. Nobody is notified yet.
            </span>
          </span>
        </label>

        {visibility === 'released' && unreachable.length > 0 && (
          <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
            <p className="font-medium">Can’t be notified</p>
            <p className="mt-1 text-xs">
              {unreachable.map((entry) => nameOf(entry.person_id)).join(', ')}{' '}
              {unreachable.length === 1 ? 'has' : 'have'} no email or login. The request is still created — let them
              know yourself, or add an email on their profile.
            </p>
          </div>
        )}

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
            disabled={!teamId || selected.length === 0 || positionId === NEW_POSITION}
            onClick={() => schedule.mutate(conflicts.length > 0)}
          >
            {conflicts.length > 0
              ? 'Schedule anyway'
              : `${visibility === 'prepared' ? 'Prepare' : 'Schedule'} ${selected.length || ''}`.trim()}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
