import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import { ORG_ROLES } from '@service-center/shared';
import { api } from '../lib/api';
import { usePeople, usePeopleWithArchived, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { BulkRosterPanel } from '../components/people/BulkRosterPanel';
import { TagGroupsModal } from '../components/people/TagGroupsModal';

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
  const [showArchived, setShowArchived] = useState(false);
  const active = usePeople();
  const withArchived = usePeopleWithArchived(showArchived);
  const people = showArchived ? withArchived : active;
  const [sentInvite, setSentInvite] = useState<SentInvite | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const canManagePeople = owner;
  // People bulk actions are reserved to the owner.
  const canBulk = owner;
  const toggleSelected = (personId: string) =>
    setSelected((current) => (current.includes(personId) ? current.filter((id) => id !== personId) : [...current, personId]));

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

  return (
    <div>
      <PageHeader
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManagePeople && <Link className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300" to="/imports?kind=people">{t('list.importCsv')}</Link>}
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              {t('list.showArchived')}
            </label>
            {canManagePeople && (
              <Button variant="secondary" onClick={() => setTagsOpen(true)}>
                {t('list.tags')}
              </Button>
            )}
            {owner && <Button onClick={() => navigate('/people/new')}>{t('list.addPerson')}</Button>}
          </div>
        }
      />

      <TagGroupsModal open={tagsOpen} onClose={() => setTagsOpen(false)} />

      {selected.length > 0 && <BulkRosterPanel personIds={selected} onDone={() => setSelected([])} />}

      {sentInvite && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <p className="min-w-0">
            <Trans t={t} i18nKey="list.inviteReady" values={{ name: sentInvite.personName }} components={[<strong key="name" />]} />{' '}
            {t('list.inviteShareHint')}
          </p>
          <div className="flex items-center gap-2">
            <code className="max-w-[16rem] truncate rounded bg-slate-100 px-2 py-1 text-xs">{sentInvite.url}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(sentInvite.url)}>
              {t('common:actions.copy')}
            </Button>
            <Button variant="ghost" onClick={() => setSentInvite(null)}>
              {t('common:a11y.dismiss')}
            </Button>
          </div>
        </div>
      )}

      <ErrorNotice error={people.error ?? changeRole.error ?? convert.error ?? invite.error} />

      {people.isLoading ? (
        <Loading />
      ) : people.data?.length ? (
        <ul className="card divide-y divide-slate-100">
          {people.data.map((person) => (
            <li key={person.id} className={`flex flex-wrap items-center gap-4 px-4 py-3 ${person.archived ? 'opacity-70' : ''}`}>
              {canBulk && person.person_id && (
                <input
                  type="checkbox"
                  aria-label={t('list.selectPerson', { name: person.full_name ?? person.email ?? t('list.personFallback') })}
                  className="size-4 rounded border-slate-300"
                  checked={selected.includes(person.person_id)}
                  onChange={() => toggleSelected(person.person_id as string)}
                />
              )}
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default"
                disabled={!owner || !person.person_id}
                onClick={() => person.person_id && navigate(`/people/${person.person_id}`)}
              >
                <Avatar name={person.full_name ?? person.email} url={person.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{person.full_name || person.email || t('common:fallback.unnamed')}</p>
                  <p className="truncate text-sm text-slate-500">{person.email}</p>
                </div>
              </button>

              {person.phone && <span className="hidden text-sm text-slate-400 sm:block">{person.phone}</span>}

              {person.archived && <Badge tone="bg-amber-50 text-amber-700 ring-amber-600/20">{t('list.archived')}</Badge>}

              {!person.has_login && (
                <Badge tone="bg-slate-100 text-slate-500 ring-slate-500/20">
                  {person.invite_pending ? t('list.inviteSent') : t('list.noLogin')}
                </Badge>
              )}

              {person.has_login &&
                (owner && person.id !== user?.profile.id ? (
                  <select
                    aria-label={t('list.roleFor', { name: person.full_name ?? person.email ?? t('list.personFallback') })}
                    className="input w-36"
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
                  <span className="w-36 text-sm text-slate-500">{person.role ? t(`common:roles.${person.role}`) : null}</span>
                ))}

              {owner && !person.has_login && person.person_id && (
                <Button
                  variant="secondary"
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
                  loading={convert.isPending && convert.variables === person.profile_id}
                  onClick={() => person.profile_id && convert.mutate(person.profile_id)}
                >
                  {t('list.addDetails')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={t('list.empty')} />
      )}
    </div>
  );
};
