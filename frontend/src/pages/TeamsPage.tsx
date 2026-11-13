import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { canEditTeamRoster } from '@service-center/shared';
import { api } from '../lib/api';
import { usePeople, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Button, EmptyState, ErrorNotice, IconButton, Menu, MenuItem, Modal, PageHeader, SectionHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { TeamEditor } from '../components/TeamEditor';
import { TeamPolicyModal } from '../components/TeamPolicyModal';
import { AvailabilityRequestsModal } from '../components/team/AvailabilityRequestsModal';

interface RemoveMemberVariables {
  teamId: string;
  membershipId: string;
}

export const TeamsPage = () => {
  const { t } = useTranslation(['teams', 'common']);
  const { access, can } = useAuth();
  /** A team can be managed organization-wide, per service type, or as its leader. */
  const canManageTeam = (team: { id: string; service_type_id: string | null }) =>
    can('teams.manage', { serviceTypeId: team.service_type_id, teamId: team.id });
  const canCreateTeams = can('teams.manage');
  /** Owners, admins and the team's leaders; a scheduler's role alone does not count. */
  const canEditRoster = (team: { id: string; service_type_id: string | null }) =>
    canEditTeamRoster(access, { serviceTypeId: team.service_type_id, teamId: team.id });
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

  const removeMember = useMutation({
    mutationFn: ({ teamId, membershipId }: RemoveMemberVariables) => api.removeTeamMember(teamId, membershipId),
    onSuccess: () => invalidate(),
  });

  const confirmRemove = (team: { id: string; name: string }, membershipId: string, name: string) => {
    if (!window.confirm(`${t('mobileTeams.removeTitle', { name, team: team.name })}\n\n${t('mobileTeams.removeMessage')}`)) return;
    removeMember.mutate({ teamId: team.id, membershipId });
  };

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
        actions={canCreateTeams && <Button icon="plus" onClick={() => setCreating(true)}>{t('teamsPage.newTeam')}</Button>}
      />

      <div className="mb-4 empty:hidden">
        <ErrorNotice error={teams.error ?? addMember.error ?? removeMember.error} />
      </div>

      {teams.isLoading ? (
        <SkeletonList rows={4} />
      ) : teams.data?.length ? (
        <>
          <SectionHeader title={t('teamsPage.title')} meta={teams.data.length} />
          <div className="grid gap-4 lg:grid-cols-2">
            {teams.data.map((team) => {
              const manage = canManageTeam(team);
              const schedule = canScheduleTeam(team);
              const policy = manage || access?.can_administer_access;
              const rosterEditable = canEditRoster(team);
              return (
                <section
                  key={team.id}
                  id={`team-${team.id}`}
                  aria-labelledby={`team-title-${team.id}`}
                  className={`card flex flex-col overflow-hidden ${focusedTeamId === team.id ? 'ring-2 ring-brand-500' : ''}`}
                >
                  <div className="flex items-start gap-3 px-4 pt-4 pb-3 sm:px-5">
                    <span
                      className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
                      style={{ backgroundColor: team.color }}
                      aria-hidden="true"
                    >
                      <Icon name="team" className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 id={`team-title-${team.id}`} className="truncate font-semibold text-slate-900 dark:text-white">{team.name}</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{t('common:count.people', { count: team.members.length })}</p>
                    </div>
                    {(manage || schedule || policy) && (
                      <Menu label={<span className="sr-only">{t('common:actions.more')}</span>} icon="more">
                        {(close) => (
                          <>
                            {manage && (
                              <MenuItem icon="pencil" onClick={() => { setEditingTeamId(team.id); close(); }}>
                                {t('common:actions.edit')}
                              </MenuItem>
                            )}
                            {schedule && (
                              <MenuItem icon="calendar" onClick={() => { setAvailabilityTeamId(team.id); close(); }}>
                                {t('teamsPage.availability')}
                              </MenuItem>
                            )}
                            {policy && (
                              <MenuItem icon="settings" onClick={() => { setPolicyTeamId(team.id); close(); }}>
                                {t('teamsPage.settings')}
                              </MenuItem>
                            )}
                          </>
                        )}
                      </Menu>
                    )}
                  </div>
                  {team.description && (
                    <p className="-mt-1 px-4 pb-3 text-sm text-slate-500 sm:px-5 dark:text-slate-400">{team.description}</p>
                  )}

                  {team.positions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3 sm:px-5">
                      {team.positions.map((position) => (
                        <span
                          key={position.id}
                          className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                        >
                          {position.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <ul className="row-list flex-1 border-t border-app-border">
                    {team.members.map((member) => {
                      const position = team.positions.find((p) => p.id === member.position_id);
                      const memberName = member.profile?.full_name || member.profile?.email || t('common:states.unknown');
                      return (
                        <li key={member.membership_id} className="group flex items-center gap-3 px-4 py-2.5 sm:px-5">
                          <Avatar
                            name={member.profile?.full_name ?? member.profile?.email}
                            url={member.profile?.avatar_url}
                            size="sm"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                            {member.profile?.full_name ?? member.profile?.email ?? t('common:states.unknown')}
                          </span>
                          {position && (
                            <span className="truncate text-xs text-slate-500 dark:text-slate-400">{position.name}</span>
                          )}
                          {rosterEditable && (
                            <IconButton
                              icon="close"
                              size="sm"
                              label={t('mobileTeams.removeLabel', { name: memberName, team: team.name })}
                              disabled={removeMember.isPending}
                              onClick={() => confirmRemove(team, member.membership_id, memberName)}
                              className="hover:!bg-rose-50 hover:!text-rose-600 dark:hover:!bg-rose-500/10 dark:hover:!text-rose-400"
                            />
                          )}
                        </li>
                      );
                    })}
                    {team.members.length === 0 && (
                      <li className="px-4 py-4 text-sm text-slate-400 sm:px-5">{t('teamsPage.noMembers')}</li>
                    )}
                  </ul>

                  {rosterEditable && (
                    <div className="border-t border-app-border bg-slate-50/60 px-3 py-2 dark:bg-slate-900/40">
                      <Button variant="ghost" size="sm" onClick={() => setAddingTo(team.id)}>
                        {t('teamsPage.addPerson')}
                      </Button>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <EmptyState
          icon="team"
          title={t('teamsPage.empty.title')}
          description={t('teamsPage.empty.description')}
          action={canCreateTeams ? <Button icon="plus" onClick={() => setCreating(true)}>{t('teamsPage.empty.action')}</Button> : undefined}
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
              className="h-10 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
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
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          {t('teamsPage.addMember.hint')}
        </p>
        <ul className="max-h-80 space-y-1 overflow-y-auto">
          {(people.data ?? []).filter((person) => person.person_id).map((person) => (
            <li key={person.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <Avatar name={person.full_name ?? person.email} url={person.avatar_url} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800 dark:text-slate-100">{person.full_name ?? person.email}</span>
              <select
                aria-label={t('teamsPage.addMember.positionFor', { name: person.full_name ?? person.email })}
                className="input w-36 shrink-0 sm:w-40"
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
