import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { usePeople, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { TeamEditor } from '../components/TeamEditor';
import { TeamPolicyModal } from '../components/TeamPolicyModal';
import { AvailabilityRequestsModal } from '../components/team/AvailabilityRequestsModal';

export const TeamsPage = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { access, can } = useAuth();
  /** A team can be managed organization-wide, per service type, or as its leader. */
  const canManageTeam = (team: { id: string; service_type_id: string | null }) =>
    can('teams.manage', { serviceTypeId: team.service_type_id, teamId: team.id });
  const canCreateTeams = can('teams.manage');
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const people = usePeople();
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [policyTeamId, setPolicyTeamId] = useState<string | null>(null);
  const [availabilityTeamId, setAvailabilityTeamId] = useState<string | null>(null);
  const canScheduleTeam = (team: { id: string; service_type_id: string | null }) =>
    can('scheduling.manage', { serviceTypeId: team.service_type_id, teamId: team.id });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [positions, setPositions] = useState('');
  const [color, setColor] = useState('#6366f1');

  const createTeam = useMutation({
    mutationFn: () =>
      api.createTeam({
        name,
        description: description.trim() || null,
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
      setDescription('');
      setPositions('');
    },
  });

  const addMember = useMutation({
    mutationFn: ({ teamId, personId, positionId }: { teamId: string; personId: string; positionId: string | null }) =>
      api.addTeamMember(teamId, { person_id: personId, position_id: positionId }),
    onSuccess: async () => {
      await invalidate();
      setAddingTo(null);
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createTeam.mutate();
  };

  // `?team=` (from search) scrolls to and highlights one team.
  const [searchParams] = useSearchParams();
  const focusedTeamId = searchParams.get('team');
  useEffect(() => {
    if (focusedTeamId && teams.data) document.getElementById(`team-${focusedTeamId}`)?.scrollIntoView({ block: 'center' });
  }, [focusedTeamId, teams.data]);

  const activeTeam = teams.data?.find((team) => team.id === addingTo);
  // Read the team back out of the query cache so the editor re-renders with the
  // roles it just changed.
  const editingTeam = teams.data?.find((team) => team.id === editingTeamId);
  const policyTeam = teams.data?.find((team) => team.id === policyTeamId);
  const availabilityTeam = teams.data?.find((team) => team.id === availabilityTeamId);

  return (
    <div>
      <PageHeader
        title={t('teamsPage.title')}
        subtitle={t('teamsPage.subtitle')}
        actions={canCreateTeams && <Button onClick={() => setCreating(true)}>{t('teamsPage.newTeam')}</Button>}
      />

      <ErrorNotice error={teams.error ?? addMember.error} />

      {teams.isLoading ? (
        <Loading />
      ) : teams.data?.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.data.map((team) => (
            <div
              key={team.id}
              id={`team-${team.id}`}
              className={`card overflow-hidden ${focusedTeamId === team.id ? 'ring-2 ring-brand-500' : ''}`}
            >
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="size-3 rounded-full" style={{ backgroundColor: team.color }} aria-hidden="true" />
                  <h2 className="font-semibold">{team.name}</h2>
                  <span className="ml-auto text-xs text-slate-400">{t('common:count.people', { count: team.members.length })}</span>
                  {canManageTeam(team) && (
                    <Button
                      variant="ghost"
                      className="!px-2 text-xs"
                      onClick={() => setEditingTeamId(team.id)}
                    >
                      {t('common:actions.edit')}
                    </Button>
                  )}
                  {canScheduleTeam(team) && (
                    <Button
                      variant="ghost"
                      className="!px-2 text-xs"
                      onClick={() => setAvailabilityTeamId(team.id)}
                    >
                      {t('teamsPage.availability')}
                    </Button>
                  )}
                  {(canManageTeam(team) || access?.can_administer_access) && (
                    <Button
                      variant="ghost"
                      className="!px-2 text-xs"
                      onClick={() => setPolicyTeamId(team.id)}
                    >
                      {t('teamsPage.settings')}
                    </Button>
                  )}
                </div>
                {team.description && (
                  <p className="mt-1 text-sm text-slate-500">{team.description}</p>
                )}
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
                        {member.profile?.full_name ?? member.profile?.email ?? t('common:states.unknown')}
                      </span>
                      {position && <span className="text-xs text-slate-500">{position.name}</span>}
                    </li>
                  );
                })}
                {team.members.length === 0 && (
                  <li className="px-4 py-3 text-sm text-slate-400">{t('teamsPage.noMembers')}</li>
                )}
              </ul>

              {canManageTeam(team) && (
                <div className="border-t border-slate-100 px-4 py-2">
                  <Button variant="ghost" className="!px-2 text-sm" onClick={() => setAddingTo(team.id)}>
                    {t('teamsPage.addPerson')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('teamsPage.empty.title')}
          description={t('teamsPage.empty.description')}
          action={canCreateTeams ? <Button onClick={() => setCreating(true)}>{t('teamsPage.empty.action')}</Button> : undefined}
        />
      )}

      {editingTeam && <TeamEditor team={editingTeam} onClose={() => setEditingTeamId(null)} />}
      {policyTeam && <TeamPolicyModal team={policyTeam} onClose={() => setPolicyTeamId(null)} />}
      {availabilityTeam && <AvailabilityRequestsModal team={availabilityTeam} onClose={() => setAvailabilityTeamId(null)} />}

      <Modal open={creating} title={t('teamsPage.create.title')} onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="team-name">{t('teamForm.name')}</label>
            <input id="team-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="team-description">{t('teamForm.description')}</label>
            <textarea
              id="team-description"
              className="input"
              rows={2}
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('teamForm.descriptionPlaceholder')}
            />
          </div>
          <div>
            <label className="label" htmlFor="team-positions">{t('teamsPage.create.positions')}</label>
            <input
              id="team-positions"
              className="input"
              value={positions}
              onChange={(e) => setPositions(e.target.value)}
              placeholder={t('teamsPage.create.positionsPlaceholder')}
            />
            <p className="mt-1 text-xs text-slate-400">{t('teamsPage.create.positionsHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="team-color">{t('teamForm.colour')}</label>
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
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={createTeam.isPending}>
              {t('teamsPage.create.submit')}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(addingTo)} title={t('teamsPage.addMember.title', { team: activeTeam?.name ?? t('common:fallback.team') })} onClose={() => setAddingTo(null)}>
        <p className="mb-2 text-xs text-slate-400">
          {t('teamsPage.addMember.hint')}
        </p>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {(people.data ?? []).filter((person) => person.person_id).map((person) => (
            <li key={person.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
              <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
              <span className="flex-1 text-sm">{person.full_name ?? person.email}</span>
              <select
                aria-label={t('teamsPage.addMember.positionFor', { name: person.full_name ?? person.email })}
                className="input w-40"
                defaultValue=""
                onChange={(event) => {
                  if (!addingTo) return;
                  addMember.mutate({
                    teamId: addingTo,
                    personId: person.person_id as string,
                    positionId: event.target.value || null,
                  });
                }}
              >
                <option value="" disabled>
                  {t('teamsPage.addMember.addAs')}
                </option>
                <option value="">{t('teamsPage.addMember.noPosition')}</option>
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
