import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { canEditTeamRoster, rosterDetailLines, rosterDisplayName, type TeamRow, type TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { useTeams, useInvalidateOrg } from '../hooks/queries';
import { useUrlSearch } from '../hooks/useUrlState';
import { matchesSearch } from '../lib/search';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Button, EmptyState, ErrorNotice, IconButton, ListErrorNotice, listFailed, Menu, MenuItem, Modal, PageHeader, SectionHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { TeamEditor } from '../components/TeamEditor';
import { TeamPolicyModal } from '../components/TeamPolicyModal';
import { AvailabilityRequestsModal } from '../components/team/AvailabilityRequestsModal';
import { AddTeamMembersModal } from '../components/team/AddTeamMembersModal';

interface RemoveMemberVariables {
  teamId: string;
  membershipId: string;
}

/** One team as the filtered list shows it. */
interface VisibleTeam {
  team: TeamWithPositions;
  /** Membership ids of members whose name matches the search (empty without a search). */
  matchingMembers: ReadonlySet<string>;
}

/**
 * The teams a search keeps: a team whose name matches, or with a member whose
 * name matches. With no search every team is kept and nothing is highlighted.
 */
const filterTeams = (teams: readonly TeamWithPositions[], query: string): VisibleTeam[] =>
  teams.flatMap((team) => {
    if (!query) return [{ team, matchingMembers: new Set<string>() }];
    const matchingMembers = new Set(
      team.members
        .filter((member) => matchesSearch(query, [rosterDisplayName(member.profile)]))
        .map((member) => member.membership_id),
    );
    return matchesSearch(query, [team.name]) || matchingMembers.size > 0 ? [{ team, matchingMembers }] : [];
  });

export const TeamsPage = () => {
  const { t, i18n } = useTranslation(['teams', 'common']);
  const { access, can } = useAuth();
  /** Mirrors the `teams_delete` RLS policy: org or service-type scope only; a team-scoped grant does not count. */
  const canDeleteTeam = (team: TeamRow): boolean =>
    can('teams.manage', { serviceTypeId: team.service_type_id });
  /** A team can be managed organization-wide, per service type, or as its leader. */
  const canManageTeam = (team: { id: string; service_type_id: string | null }) =>
    can('teams.manage', { serviceTypeId: team.service_type_id, teamId: team.id });
  const canCreateTeams = can('teams.manage');
  /** Owners, admins and the team's leaders; a scheduler's role alone does not count. */
  const canEditRoster = (team: { id: string; service_type_id: string | null }) =>
    canEditTeamRoster(access, { serviceTypeId: team.service_type_id, teamId: team.id });
  const invalidate = useInvalidateOrg();
  const teams = useTeams();
  const search = useUrlSearch('q');
  // Cards start collapsed; each opens on its own. A search opens every card it keeps.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamToDelete, setTeamToDelete] = useState<TeamWithPositions | null>(null);
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

  const deleteTeam = useMutation({
    mutationFn: (teamId: string) => api.deleteTeam(teamId),
    onSuccess: async () => {
      await invalidate();
      setTeamToDelete(null);
    },
  });

  const closeDeleteTeam = () => {
    if (deleteTeam.isPending) return;
    deleteTeam.reset();
    setTeamToDelete(null);
  };

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
    if (!focusedTeamId || !teams.data) return;
    setExpanded((current) => (current.has(focusedTeamId) ? current : new Set([...current, focusedTeamId])));
    document.getElementById(`team-${focusedTeamId}`)?.scrollIntoView({ block: 'center' });
  }, [focusedTeamId, teams.data]);

  const visibleTeams = useMemo(() => filterTeams(teams.data ?? [], search.query), [teams.data, search.query]);
  const toggleExpanded = (teamId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });

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
        <ErrorNotice error={(listFailed(teams) ? null : teams.error) ?? removeMember.error} />
      </div>

      {teams.isLoading ? (
        <SkeletonList rows={4} />
      ) : listFailed(teams) ? (
        <ListErrorNotice query={teams} />
      ) : teams.data?.length ? (
        <>
          <SectionHeader
            title={t('teamsPage.title')}
            meta={search.query ? t('teamsPage.search.shownOf', { shown: visibleTeams.length, total: teams.data.length }) : teams.data.length}
            action={expanded.size > 0 && !search.query && (
              <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>{t('teamsPage.collapseAll')}</Button>
            )}
          />
          <div className="relative mb-4 min-w-0 sm:max-w-md">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              value={search.text}
              onChange={(event) => search.setText(event.target.value)}
              placeholder={t('teamsPage.search.placeholder')}
              aria-label={t('teamsPage.search.label')}
            />
          </div>
          {visibleTeams.length === 0 ? (
            <EmptyState compact icon="team" title={t('teamsPage.search.noMatch')} />
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              {visibleTeams.map(({ team, matchingMembers }) => {
                const manage = canManageTeam(team);
                const deletable = canDeleteTeam(team);
                const schedule = canScheduleTeam(team);
                const policy = manage || access?.can_administer_access;
                const rosterEditable = canEditRoster(team);
                const open = Boolean(search.query) || expanded.has(team.id);
                const bodyId = `team-body-${team.id}`;
                return (
                  <section
                    key={team.id}
                    id={`team-${team.id}`}
                    aria-labelledby={`team-title-${team.id}`}
                    className={`card flex flex-col ${focusedTeamId === team.id ? 'ring-2 ring-brand-500' : ''}`}
                  >
                    <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <button
                        type="button"
                        className="group flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                        aria-expanded={open}
                        aria-controls={bodyId}
                        disabled={Boolean(search.query)}
                        onClick={() => toggleExpanded(team.id)}
                      >
                        <span
                          className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
                          style={{ backgroundColor: team.color }}
                          aria-hidden="true"
                        >
                          <Icon name="team" className="size-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <h2 id={`team-title-${team.id}`} className="truncate font-semibold text-slate-900 group-enabled:group-hover:text-brand-700 dark:text-white dark:group-enabled:group-hover:text-brand-200">{team.name}</h2>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {t('common:count.people', { count: team.members.length })}
                            {' · '}
                            {t('teamsPage.positionsCount', { count: team.positions.length })}
                            {search.query && matchingMembers.size > 0 && (
                              <span className="text-brand-700 dark:text-brand-200">
                                {' · '}
                                {t('teamsPage.search.matchingMembers', { count: matchingMembers.size })}
                              </span>
                            )}
                          </span>
                        </span>
                        {!search.query && (
                          <Icon name="chevronDown" className={`size-4 shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
                        )}
                      </button>
                      {(manage || schedule || policy || deletable) && (
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
                              {deletable && (
                                <MenuItem icon="trash" tone="danger" onClick={() => { setTeamToDelete(team); close(); }}>
                                  {t('teamsPage.delete.submit')}
                                </MenuItem>
                              )}
                            </>
                          )}
                        </Menu>
                      )}
                    </div>

                    {open && (
                      <div id={bodyId} className="flex flex-1 flex-col">
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
                            const memberName = rosterDisplayName(member.profile) ?? t('common:states.unknown');
                            const details = rosterDetailLines(member.profile, i18n.language);
                            const matches = matchingMembers.has(member.membership_id);
                            return (
                              <li
                                key={member.membership_id}
                                data-match={matches || undefined}
                                className={`group flex items-center gap-3 px-4 py-2.5 sm:px-5 ${matches ? 'bg-brand-50/70 dark:bg-brand-500/10' : ''}`}
                              >
                                <Avatar
                                  name={rosterDisplayName(member.profile) ?? undefined}
                                  url={member.profile?.avatar_url}
                                  size="sm"
                                />
                                <div className="min-w-0 flex-1">
                                  <span className={`block truncate text-sm text-slate-800 dark:text-slate-100 ${matches ? 'font-semibold' : 'font-medium'}`}>{memberName}</span>
                                  {details.length > 0 && (
                                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                      {details.map((line, index) => (
                                        <span key={line.kind}>
                                          {index > 0 && ' · '}
                                          {line.href ? <a href={line.href} className="hover:underline">{line.value}</a> : line.value}
                                        </span>
                                      ))}
                                    </span>
                                  )}
                                </div>
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
                          <div className="rounded-b-[inherit] border-t border-app-border bg-slate-50/60 px-3 py-2 dark:bg-slate-900/40">
                            <Button variant="ghost" size="sm" onClick={() => setAddingTo(team.id)}>
                              {t('teamsPage.addPerson')}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
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

      {teamToDelete && canDeleteTeam(teamToDelete) && (
        <Modal open title={t('teamsPage.delete.title', { team: teamToDelete.name })} onClose={closeDeleteTeam}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">{t('teamsPage.delete.description')}</p>
            <ErrorNotice error={deleteTeam.error} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" autoFocus disabled={deleteTeam.isPending} onClick={closeDeleteTeam}>
                {t('common:actions.cancel')}
              </Button>
              <Button variant="danger" loading={deleteTeam.isPending} onClick={() => deleteTeam.mutate(teamToDelete.id)}>
                {t('teamsPage.delete.submit')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

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

      {activeTeam && canEditRoster(activeTeam) && (
        <AddTeamMembersModal team={activeTeam} onClose={() => setAddingTo(null)} onAdded={invalidate} />
      )}
    </div>
  );
};
