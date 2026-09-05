import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { usePeople, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';

export const TeamsPage = () => {
  const { canManage } = useAuth();
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const people = usePeople();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [positions, setPositions] = useState('');
  const [color, setColor] = useState('#6366f1');

  const createTeam = useMutation({
    mutationFn: () =>
      api.createTeam({
        name,
        color,
        positions: positions
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean),
      }),
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
      setName('');
      setPositions('');
    },
  });

  const addMember = useMutation({
    mutationFn: ({ teamId, userId, positionId }: { teamId: string; userId: string; positionId: string | null }) =>
      api.addTeamMember(teamId, { user_id: userId, position_id: positionId }),
    onSuccess: async () => {
      await invalidate();
      setAddingTo(null);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createTeam.mutate();
  };

  const activeTeam = teams.data?.find((t) => t.id === addingTo);

  return (
    <div>
      <PageHeader
        title="Teams"
        subtitle="Who serves where, and in which position."
        actions={canManage && <Button onClick={() => setCreating(true)}>New team</Button>}
      />

      <ErrorNotice error={teams.error ?? addMember.error} />

      {teams.isLoading ? (
        <Loading />
      ) : teams.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.data.map((team) => (
            <div key={team.id} className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <span className="size-3 rounded-full" style={{ backgroundColor: team.color }} aria-hidden="true" />
                <h2 className="font-semibold">{team.name}</h2>
                <span className="ml-auto text-xs text-slate-400">{team.members.length} people</span>
              </div>

              {team.positions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-b border-slate-50 px-4 py-2">
                  {team.positions.map((position) => (
                    <span key={position.id} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                      {position.name}
                    </span>
                  ))}
                </div>
              )}

              <ul className="divide-y divide-slate-50">
                {team.members.map((member, index) => {
                  const position = team.positions.find((p) => p.id === member.position_id);
                  return (
                    <li key={`${member.user_id}-${member.position_id ?? index}`} className="flex items-center gap-3 px-4 py-2.5">
                      <Avatar
                        name={member.profile?.full_name ?? member.profile?.email}
                        url={member.profile?.avatar_url}
                        size="sm"
                      />
                      <span className="flex-1 text-sm">
                        {member.profile?.full_name ?? member.profile?.email ?? 'Unknown'}
                      </span>
                      {position && <span className="text-xs text-slate-500">{position.name}</span>}
                    </li>
                  );
                })}
                {team.members.length === 0 && (
                  <li className="px-4 py-3 text-sm text-slate-400">Nobody on this team yet.</li>
                )}
              </ul>

              {canManage && (
                <div className="border-t border-slate-100 px-4 py-2">
                  <Button variant="ghost" className="!px-2 text-sm" onClick={() => setAddingTo(team.id)}>
                    + Add person
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No teams yet"
          description="Teams group the positions you schedule — Worship Band, Production, Hospitality."
          action={canManage ? <Button onClick={() => setCreating(true)}>Create a team</Button> : undefined}
        />
      )}

      <Modal open={creating} title="New team" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="team-name">Name</label>
            <input id="team-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="team-positions">Positions</label>
            <input
              id="team-positions"
              className="input"
              value={positions}
              onChange={(e) => setPositions(e.target.value)}
              placeholder="Worship Leader, Acoustic Guitar, Bass, Drums"
            />
            <p className="mt-1 text-xs text-slate-400">Comma separated. You can add more later.</p>
          </div>
          <div>
            <label className="label" htmlFor="team-color">Colour</label>
            <input
              id="team-color"
              type="color"
              className="h-10 w-20 rounded border border-slate-300"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </div>

          <ErrorNotice error={createTeam.error} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createTeam.isPending}>
              Create team
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(addingTo)} title={`Add to ${activeTeam?.name ?? 'team'}`} onClose={() => setAddingTo(null)}>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {(people.data ?? []).map((person) => (
            <li key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
              <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
              <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
              <select
                aria-label={`Position for ${person.full_name ?? person.email}`}
                className="input w-40"
                defaultValue=""
                onChange={(event) => {
                  if (!addingTo) return;
                  addMember.mutate({
                    teamId: addingTo,
                    userId: person.id,
                    positionId: event.target.value || null,
                  });
                }}
              >
                <option value="" disabled>
                  Add as…
                </option>
                <option value="">No position</option>
                {(activeTeam?.positions ?? []).map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
};
