import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ORG_ROLES, isAdmin } from '@service-center/shared';
import { api } from '../lib/api';
import { usePeople, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Avatar, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';

export const PeoplePage = () => {
  const { role, user } = useAuth();
  const admin = isAdmin(role);
  const invalidate = useInvalidateOrg();
  const people = usePeople();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const invite = useMutation({
    mutationFn: () => api.inviteMember({ email, full_name: fullName || undefined, role: inviteRole }),
    onSuccess: async () => {
      await invalidate();
      setInviting(false);
      setEmail('');
      setFullName('');
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateMember(userId, { role }),
    onSuccess: invalidate,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    invite.mutate();
  };

  return (
    <div>
      <PageHeader
        title="People"
        subtitle="Everyone in your organization."
        actions={admin && <Button onClick={() => setInviting(true)}>Invite someone</Button>}
      />

      <ErrorNotice error={people.error ?? changeRole.error} />

      {people.isLoading ? (
        <Loading />
      ) : people.data?.length ? (
        <ul className="card divide-y divide-slate-100">
          {people.data.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <Avatar name={person.full_name ?? person.email} url={person.avatar_url} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{person.full_name ?? 'Invited'}</p>
                <p className="truncate text-sm text-slate-500">{person.email}</p>
              </div>
              {person.phone && <span className="text-sm text-slate-400">{person.phone}</span>}
              {admin && person.id !== user?.profile.id ? (
                <select
                  aria-label={`Role for ${person.full_name ?? person.email}`}
                  className="input w-36"
                  value={person.role}
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
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Nobody here yet" />
      )}

      <Modal open={inviting} title="Invite someone" onClose={() => setInviting(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="invite-email">Email</label>
            <input
              id="invite-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="invite-name">Full name</label>
            <input id="invite-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="invite-role">Role</label>
            <select id="invite-role" className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {ORG_ROLES.filter((r) => r !== 'owner').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Schedulers can create plans and schedule people. Members can only respond to their own invitations.
            </p>
          </div>

          <ErrorNotice error={invite.error} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Send invite
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
