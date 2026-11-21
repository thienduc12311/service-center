import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { ORG_ROLES, type RosterPerson } from '@service-center/shared';
import { api } from '../lib/api';
import { usePeoplePage, useInvalidateOrg, useTeams } from '../hooks/queries';
import { useUrlBoolean, useUrlSearch, useUrlString } from '../hooks/useUrlState';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Badge, Button, EmptyState, ErrorNotice, IconButton, ListErrorNotice, Menu, MenuItem, Notice, PageHeader, SectionHeader, SkeletonList, listFailed } from '../components/ui';
import { Icon } from '../components/icons';
import { BulkRosterPanel } from '../components/people/BulkRosterPanel';
import { TagGroupsModal } from '../components/people/TagGroupsModal';
import { JoinRequestsSection } from '../components/people/JoinRequestsSection';
import { SearchableSelect } from '../components/SearchableSelect';

/** A selected Person, kept with enough to show them after a new search hides their row. */
interface SelectedPerson {
  personId: string;
  name: string;
  avatarUrl: string | null;
}

/** Result of the most recently sent invitation — surfaced so an owner can share it manually. */
interface SentInvite {
  personName: string;
  url: string;
}

export const PeoplePage = () => {
  const { t } = useTranslation(['people', 'common']);
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const owner = role === 'owner';
  const invalidate = useInvalidateOrg();
  const [showArchived, setShowArchived] = useUrlBoolean('archived');
  const search = useUrlSearch('q');
  const [teamFilter, setTeamFilter] = useUrlString('team', '', { replace: false });
  const teams = useTeams();
  const teamOptions = (teams.data ?? []).map((team) => ({ id: team.id, label: team.name }));
  const people = usePeoplePage({ q: search.query, includeArchived: showArchived, teamId: teamFilter });
  const [sentInvite, setSentInvite] = useState<SentInvite | null>(null);
  // Selections survive a new search or filter; the tray keeps every one of them in view.
  const [selected, setSelected] = useState<readonly SelectedPerson[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const canManagePeople = owner;
  // People bulk actions are reserved to the owner.
  const canBulk = owner;
  const displayName = (person: RosterPerson): string => person.full_name ?? person.email ?? t('list.personFallback');
  const selectedIds = new Set(selected.map((entry) => entry.personId));
  const toSelected = (person: RosterPerson & { person_id: string }): SelectedPerson => ({
    personId: person.person_id,
    name: displayName(person),
    avatarUrl: person.avatar_url,
  });
  const toggleSelected = (person: RosterPerson & { person_id: string }) =>
    setSelected((current) =>
      current.some((entry) => entry.personId === person.person_id)
        ? current.filter((entry) => entry.personId !== person.person_id)
        : [...current, toSelected(person)],
    );
  const selectable = (people.data ?? []).filter((person): person is RosterPerson & { person_id: string } => Boolean(person.person_id));
  const loadedSelected = selectable.filter((person) => selectedIds.has(person.person_id)).length;
  const allLoadedSelected = selectable.length > 0 && loadedSelected === selectable.length;
  const toggleAllLoaded = () =>
    setSelected((current) => {
      if (allLoadedSelected) {
        const loadedIds = new Set(selectable.map((person) => person.person_id));
        return current.filter((entry) => !loadedIds.has(entry.personId));
      }
      const have = new Set(current.map((entry) => entry.personId));
      return [...current, ...selectable.filter((person) => !have.has(person.person_id)).map(toSelected)];
    });
  const hiddenSelected = selected.length - loadedSelected;

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateMember(userId, { role }),
    onSuccess: invalidate,
  });

  const convert = useMutation({
    mutationFn: (userId: string) => api.convertMember(userId),
    onSuccess: (created) => navigate(`/people/${created.id}`),
  });

  const invite = useMutation({
    mutationFn: ({ personId }: { personId: string; personName: string }) =>
      api.invitePerson(personId, {}),
    onSuccess: async (result, { personName }) => {
      await invalidate();
      if (result.invited) setSentInvite({ personName, url: result.invite_url });
    },
  });

  const roleBadgeTone = 'bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-200 dark:ring-brand-500/25';

  return (
    <div>
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={
          <>
            {canManagePeople && (
              <Menu label={t('common:actions.more')} icon="more">
                {(close) => (
                  <>
                    <MenuItem icon="upload" onClick={() => { close(); navigate('/imports?kind=people'); }}>
                      {t('list.importCsv')}
                    </MenuItem>
                    <MenuItem icon="sparkle" onClick={() => { close(); setTagsOpen(true); }}>
                      {t('list.tags')}
                    </MenuItem>
                  </>
                )}
              </Menu>
            )}
            {owner && <Button icon="plus" onClick={() => navigate('/people/new')}>{t('list.addPerson')}</Button>}
          </>
        }
      />

      <TagGroupsModal open={tagsOpen} onClose={() => setTagsOpen(false)} />

      <div className="space-y-4">
        {selected.length > 0 && (
          <section className="surface-inset space-y-2 px-4 py-3" aria-label={t('list.selection.label')}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-medium">{t('common:count.selected', { count: selected.length })}</span>
                {hiddenSelected > 0 && (
                  <span className="ml-2 text-slate-500 dark:text-slate-400">{t('list.selection.hidden', { count: hiddenSelected })}</span>
                )}
              </p>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>{t('list.selection.clear')}</Button>
            </div>
            <ul className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
              {selected.map((entry) => (
                <li key={entry.personId} className="inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pr-1 pl-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                  <Avatar name={entry.name} url={entry.avatarUrl} size="sm" />
                  <span className="max-w-40 truncate">{entry.name}</span>
                  <IconButton
                    icon="close"
                    size="sm"
                    label={t('list.selection.remove', { name: entry.name })}
                    onClick={() => setSelected((current) => current.filter((other) => other.personId !== entry.personId))}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {selected.length > 0 && <BulkRosterPanel personIds={selected.map((entry) => entry.personId)} onDone={() => setSelected([])} />}

        {sentInvite && (
          <Notice tone="success">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0">
                <Trans t={t} i18nKey="list.inviteReady" values={{ name: sentInvite.personName }} components={[<strong key="name" />]} />{' '}
                {t('list.inviteShareHint')}
              </p>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 max-w-[16rem] truncate rounded-lg bg-white/70 px-2 py-1 text-xs ring-1 ring-inset ring-emerald-600/20 dark:bg-slate-950/40">{sentInvite.url}</code>
                <Button size="sm" variant="secondary" icon="document" onClick={() => navigator.clipboard.writeText(sentInvite.url)}>
                  {t('common:actions.copy')}
                </Button>
                <IconButton icon="close" size="sm" label={t('common:a11y.dismiss')} onClick={() => setSentInvite(null)} />
              </div>
            </div>
          </Notice>
        )}

        {/* Who asked to join by the church ID: owners are the ones who invite. */}
        {owner && <JoinRequestsSection onInvited={(personName, url) => setSentInvite({ personName, url })} />}

        <ErrorNotice error={(listFailed(people) ? null : people.error) ?? changeRole.error ?? convert.error ?? invite.error} />

        <SectionHeader
          title={t('list.title')}
          className="!mb-0"
          action={
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 accent-brand-600"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t('list.showArchived')}
            </label>
          }
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input pl-9"
              value={search.text}
              onChange={(event) => search.setText(event.target.value)}
              placeholder={t(owner ? 'list.searchPlaceholder' : 'list.searchPlaceholderMember')}
              aria-label={t('list.searchLabel')}
            />
          </div>
          {(teamOptions.length > 0 || teamFilter) && (
            <div className="min-w-0 sm:w-60">
              <SearchableSelect
                label={t('list.teamFilter')}
                hideLabel
                value={teamFilter}
                onChange={(id) => setTeamFilter(id)}
                options={teamOptions}
                placeholder={t('list.allTeams')}
                noMatchesText={t('list.noTeamMatches')}
              />
            </div>
          )}
          {people.total !== null && (
            <span className="text-sm text-slate-500 tabular-nums sm:ml-auto dark:text-slate-400">
              {t('common:count.people', { count: people.total })}
            </span>
          )}
          {canBulk && selectable.length > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              <input
                ref={(input) => { if (input) input.indeterminate = loadedSelected > 0 && !allLoadedSelected; }}
                type="checkbox"
                className="size-4 rounded border-slate-300 accent-brand-600"
                checked={allLoadedSelected}
                onChange={toggleAllLoaded}
              />
              {t('list.selection.selectLoaded', { count: selectable.length })}
            </label>
          )}
        </div>

        {people.isLoading ? (
          <SkeletonList rows={6} />
        ) : listFailed(people) ? (
          <ListErrorNotice query={people} />
        ) : people.data?.length ? (
          <ul className="card row-list overflow-hidden">
            {people.data.map((person) => {
              const isSelected = person.person_id ? selectedIds.has(person.person_id) : false;
              return (
                <li
                  key={person.id}
                  className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 transition sm:flex-nowrap ${
                    isSelected ? 'bg-brand-50/60 dark:bg-brand-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  } ${person.archived ? 'opacity-70' : ''}`}
                >
                  {canBulk && person.person_id && (
                    <input
                      type="checkbox"
                      aria-label={t('list.selectPerson', { name: person.full_name ?? person.email ?? t('list.personFallback') })}
                      className="size-4 shrink-0 rounded border-slate-300 accent-brand-600"
                      checked={isSelected}
                      onChange={() => person.person_id && toggleSelected({ ...person, person_id: person.person_id })}
                    />
                  )}
                  <button
                    type="button"
                    className="group flex min-w-0 flex-1 basis-48 items-center gap-3 text-left disabled:cursor-default"
                    disabled={!owner || !person.person_id}
                    onClick={() => person.person_id && navigate(`/people/${person.person_id}`)}
                  >
                    <Avatar name={person.full_name ?? person.email} url={person.avatar_url} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900 group-enabled:group-hover:text-brand-700 dark:text-white dark:group-enabled:group-hover:text-brand-200">
                        {person.full_name || person.email || t('common:fallback.unnamed')}
                      </p>
                      <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                        {person.email}
                        {person.phone && <span className="hidden md:inline"> · {person.phone}</span>}
                      </p>
                    </div>
                  </button>

                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                    {person.archived && <Badge tone="bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25">{t('list.archived')}</Badge>}

                    {!person.has_login && (
                      <Badge tone="bg-slate-100 text-slate-500 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-600/40">
                        {person.invite_pending ? t('list.inviteSent') : t('list.noLogin')}
                      </Badge>
                    )}

                    {person.has_login &&
                      (owner && person.id !== user?.profile.id ? (
                        <select
                          aria-label={t('list.roleFor', { name: person.full_name ?? person.email ?? t('list.personFallback') })}
                          className="input h-8 w-36 py-1"
                          value={person.role ?? 'member'}
                          onChange={(e) => changeRole.mutate({ userId: person.id, role: e.target.value })}
                        >
                          {ORG_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {t(`common:roles.${r}`)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        person.role && <Badge tone={roleBadgeTone}>{t(`common:roles.${person.role}`)}</Badge>
                      ))}

                    {owner && !person.has_login && person.person_id && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="mail"
                        loading={invite.isPending && invite.variables?.personId === person.person_id}
                        onClick={() =>
                          invite.mutate({ personId: person.person_id as string, personName: person.full_name ?? person.email ?? t('list.thisPerson') })
                        }
                        disabled={!person.email}
                        title={person.email ? undefined : t('list.addEmailFirst')}
                      >
                        {person.invite_pending ? t('list.resendInvite') : t('list.sendInvite')}
                      </Button>
                    )}

                    {owner && person.has_login && !person.person_id && (
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="plus"
                        loading={convert.isPending && convert.variables === person.profile_id}
                        onClick={() => person.profile_id && convert.mutate(person.profile_id)}
                      >
                        {t('list.addDetails')}
                      </Button>
                    )}
                    {owner && person.person_id && (
                      <Icon name="chevronRight" className="hidden size-4 text-slate-300 sm:block dark:text-slate-600" />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon="people" title={search.query || teamFilter ? t('list.noMatch') : t('list.empty')} />
        )}

        {people.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="secondary" loading={people.isFetchingNextPage} onClick={() => void people.fetchNextPage()}>
              {t('list.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
