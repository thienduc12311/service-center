import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { invitePlatformAdminSchema, type PlatformAdmin, type PlatformAdminInvitation } from '@service-center/shared';
import {
  usePlatformAdmins,
  useInvitePlatformAdmin,
  useRevokePlatformAdmin,
  useRevokePlatformAdminInvitation,
} from '../hooks/queries';
import { useAdminAuth } from '../providers/AdminAuthProvider';
import { userDisplayName } from '../lib/users';
import { formatDate, formatDateTime, formatRelativeTime } from '../lib/format';
import { Badge, Button, Card, ErrorNotice, Loading, Modal, Notice, PageHeader, SectionHeader, TextField } from '../components/ui';

/** Who runs the platform, open invitations, and inviting someone new. */
export const AdminsPage = () => {
  const roster = usePlatformAdmins();
  const { stage } = useAdminAuth();
  const myUserId = stage.kind === 'ready' ? stage.session.user.id : null;

  return (
    <>
      <PageHeader
        title="Super admins"
        subtitle="Super admins manage every church and account. Each one signs in with two-factor authentication."
      />
      {roster.isPending ? (
        <Loading />
      ) : roster.isError ? (
        <ErrorNotice error={roster.error} onRetry={() => void roster.refetch()} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-6">
            <section aria-labelledby="admins-list">
              <SectionHeader id="admins-list" title="Super admins" meta={roster.data.admins.length} />
              <Card padding="none">
                <ul className="row-list">
                  {roster.data.admins.map((admin) => (
                    <AdminRow
                      key={admin.user_id}
                      admin={admin}
                      isMe={admin.user_id === myUserId}
                      isLast={roster.data.admins.length <= 1}
                    />
                  ))}
                </ul>
              </Card>
            </section>
            <section aria-labelledby="admins-invitations">
              <SectionHeader id="admins-invitations" title="Open invitations" meta={roster.data.invitations.length} />
              {roster.data.invitations.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">No invitations waiting.</p>
              ) : (
                <Card padding="none">
                  <ul className="row-list">
                    {roster.data.invitations.map((invitation) => (
                      <InvitationRow key={invitation.id} invitation={invitation} />
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </div>
          <div>
            <InviteCard />
          </div>
        </div>
      )}
    </>
  );
};

interface AdminRowProps {
  admin: PlatformAdmin;
  isMe: boolean;
  isLast: boolean;
}

const AdminRow = ({ admin, isMe, isLast }: AdminRowProps) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <Link to={`/users/${admin.user_id}`} className="font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200">
            {userDisplayName(admin)}
          </Link>
          {isMe && <Badge tone="slate">You</Badge>}
          {!admin.has_mfa && <Badge tone="amber">Two-factor not set up</Badge>}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {admin.email} · since {formatDate(admin.created_at)} · last sign-in{' '}
          {admin.last_sign_in_at ? formatRelativeTime(admin.last_sign_in_at) : 'never'}
        </p>
        {admin.note && <p className="text-xs text-slate-500 dark:text-slate-400">{admin.note}</p>}
      </div>
      {!isMe && !isLast && (
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Revoke…
        </Button>
      )}
      {confirming && <RevokeAdminModal admin={admin} onClose={() => setConfirming(false)} />}
    </li>
  );
};

interface RevokeAdminModalProps {
  admin: PlatformAdmin;
  onClose: () => void;
}

const RevokeAdminModal = ({ admin, onClose }: RevokeAdminModalProps) => {
  const revoke = useRevokePlatformAdmin();
  return (
    <Modal
      open
      title={`Revoke ${userDisplayName(admin)}’s super-admin access?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate(admin.user_id, { onSuccess: onClose })}>
            Revoke access
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>The admin dashboard refuses them from their next request.</li>
          <li>Any church they entered as owner loses that access now.</li>
          <li>Their account and their own church memberships stay.</li>
        </ul>
        <ErrorNotice error={revoke.error} />
      </div>
    </Modal>
  );
};

interface InvitationRowProps {
  invitation: PlatformAdminInvitation;
}

const InvitationRow = ({ invitation }: InvitationRowProps) => {
  const revoke = useRevokePlatformAdminInvitation();
  return (
    <li className="px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900 dark:text-white">{invitation.email}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Invited by {invitation.invited_by_name ?? 'a super admin'} on {formatDate(invitation.created_at)} · expires{' '}
            {formatDateTime(invitation.expires_at)}
          </p>
        </div>
        <Button variant="secondary" size="sm" loading={revoke.isPending} onClick={() => revoke.mutate(invitation.id)}>
          Cancel invitation
        </Button>
      </div>
      <ErrorNotice error={revoke.error} className="mt-2" />
    </li>
  );
};

const InviteCard = () => {
  const invite = useInvitePlatformAdmin();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string | undefined>();
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = invitePlatformAdminSchema.safeParse({ email });
    if (!parsed.success) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    setSentTo(null);
    invite.mutate(parsed.data, {
      onSuccess: (invitation) => {
        setSentTo(invitation.email);
        setEmail('');
      },
    });
  };

  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Invite a super admin</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        They get an email. They sign in here with that address, accept, and set up two-factor sign-in. The invitation lasts 7
        days.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3" noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={emailError}
        />
        <Button type="submit" size="sm" loading={invite.isPending}>
          Send invitation
        </Button>
      </form>
      {sentTo && !invite.isPending && (
        <Notice tone="success" className="mt-3">
          Invitation sent to {sentTo}.
        </Notice>
      )}
      <ErrorNotice error={invite.error} className="mt-3" />
    </Card>
  );
};
