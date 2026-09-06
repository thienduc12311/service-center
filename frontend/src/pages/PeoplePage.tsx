import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ORG_ROLES, isAdmin } from '@service-center/shared';
import { api } from '../lib/api';
import { usePeople, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

/** Result of the most recently sent invitation — surfaced so an admin can share it manually. */
interface SentInvite {
  personName: string;
  url: string;
}

export const PeoplePage = () => {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const admin = isAdmin(role);
  const invalidate = useInvalidateOrg();
  const people = usePeople();
  const [sentInvite, setSentInvite] = useState<SentInvite | null>(null);

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
        title="People"
        subtitle="Everyone in your organization."
        actions={admin && <Button onClick={() => navigate('/people/new')}>Add person</Button>}
      />

      {sentInvite && (
        <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <p className="min-w-0">
            Invite ready for <strong>{sentInvite.personName}</strong>. There&apos;s no email delivery configured yet,
            so share this link directly (by text, chat, or however works):
          </p>
          <div className="flex items-center gap-2">
            <code className="max-w-[16rem] truncate rounded bg-slate-100 px-2 py-1 text-xs">{sentInvite.url}</code>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(sentInvite.url)}>
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setSentInvite(null)}>
              Dismiss
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
            <li key={person.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-4 text-left disabled:cursor-default"
                disabled={!person.person_id}
                onClick={() => person.person_id && navigate(`/people/${person.person_id}`)}
              >
                <Avatar name={person.full_name ?? person.email} url={person.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{person.full_name || person.email || 'Unnamed'}</p>
                  <p className="truncate text-sm text-slate-500">{person.email}</p>
                </div>
              </button>

              {person.phone && <span className="hidden text-sm text-slate-400 sm:block">{person.phone}</span>}

              {!person.has_login && (
                <Badge tone="bg-slate-100 text-slate-500 ring-slate-500/20">
                  {person.invite_pending ? 'Invite sent' : 'No login yet'}
                </Badge>
              )}

              {person.has_login &&
                (admin && person.id !== user?.profile.id ? (
                  <select
                    aria-label={`Role for ${person.full_name ?? person.email}`}
                    className="input w-36"
                    value={person.role ?? 'member'}
                    onChange={(e) => changeRole.mutate({ userId: person.id, role: e.target.value })}
                  >
                    {ORG_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="w-36 text-sm capitalize text-slate-500">{person.role}</span>
                ))}

              {admin && !person.has_login && person.person_id && (
                <Button
                  variant="secondary"
                  loading={invite.isPending && invite.variables?.personId === person.person_id}
                  onClick={() =>
                    invite.mutate({ personId: person.person_id as string, personName: person.full_name ?? person.email ?? 'this person' })
                  }
                  disabled={!person.email}
                  title={person.email ? undefined : 'Add an email on their profile first'}
                >
                  {person.invite_pending ? 'Resend invite' : 'Send invite'}
                </Button>
              )}

              {admin && person.has_login && !person.person_id && (
                <Button
                  variant="secondary"
                  loading={convert.isPending && convert.variables === person.profile_id}
                  onClick={() => person.profile_id && convert.mutate(person.profile_id)}
                >
                  Add details
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody here yet" />
      )}
    </div>
  );
};
