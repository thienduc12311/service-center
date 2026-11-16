import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ACCOUNT_DELETION_BLOCKED,
  ApiError,
  blockUserSchema,
  type AdminUserDeletionChurch,
  type AdminUserDetail,
  type AdminUserSummary,
} from '@service-center/shared';
import { useAdminActivity, useAdminUser, useAdminUsers, useBlockUser, useDeleteUser, useUnblockUser } from '../hooks/queries';
import { useAdminAuth } from '../providers/AdminAuthProvider';
import { confirmationMatches, membershipStatusLabel, roleLabel, soleOwnedChurches, userDisplayName } from '../lib/users';
import { formatDateTime, formatRelativeTime, pluralize } from '../lib/format';
import { ActivityList } from '../components/ActivityList';
import {
  Button,
  Card,
  DetailList,
  EmptyState,
  ErrorNotice,
  Loading,
  Modal,
  Notice,
  PageHeader,
  SectionHeader,
  TextAreaField,
  TextField,
} from '../components/ui';
import { UserBadges } from './UsersPage';

type UserRouteParams = { id: string };

const RECENT_ACTIVITY_LIMIT = 10;

/** The signed-in super admin's own user id. */
const useMyUserId = (): string | null => {
  const { stage } = useAdminAuth();
  return stage.kind === 'ready' ? stage.session.user.id : null;
};

export const UserDetailPage = () => {
  const { id = '' } = useParams<UserRouteParams>();
  const detail = useAdminUser(id);

  if (detail.isPending) return <Loading />;
  if (detail.isError) {
    return (
      <>
        <PageHeader title="User" back={{ to: '/users', label: 'Users' }} />
        <ErrorNotice error={detail.error} fallback="Could not load this account." onRetry={() => void detail.refetch()} />
      </>
    );
  }
  return <UserDetailView detail={detail.data} />;
};

interface UserDetailViewProps {
  detail: AdminUserDetail;
}

const UserDetailView = ({ detail }: UserDetailViewProps) => {
  const { user } = detail;
  const myUserId = useMyUserId();
  const isMe = user.id === myUserId;
  return (
    <>
      <PageHeader
        title={userDisplayName(user)}
        back={{ to: '/users', label: 'Users' }}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <UserBadges user={user} />
            {user.email && <span>{user.email}</span>}
          </span>
        }
      />

      {user.block && (
        <Notice tone="warning" className="mb-5">
          <p className="font-medium">
            Blocked{user.block.blocked_at ? ` on ${formatDateTime(user.block.blocked_at)}` : ''}
            {user.block.blocked_by_name ? ` by ${user.block.blocked_by_name}` : ''}. This account can't sign in anywhere.
          </p>
          <p className="mt-0.5">{user.block.reason ? `Reason: ${user.block.reason}` : 'Banned outside the dashboard (no reason recorded).'}</p>
        </Notice>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <DetailList
              items={[
                { label: 'Email', value: user.email },
                { label: 'Email confirmed', value: user.email_confirmed ? 'Yes' : 'No' },
                { label: 'Created', value: formatDateTime(user.created_at) },
                {
                  label: 'Last sign-in',
                  value: user.last_sign_in_at ? (
                    <time dateTime={user.last_sign_in_at} title={formatDateTime(user.last_sign_in_at)}>
                      {formatRelativeTime(user.last_sign_in_at)}
                    </time>
                  ) : (
                    'Never'
                  ),
                },
                { label: 'Super admin', value: user.is_platform_admin ? 'Yes' : 'No' },
              ]}
            />
          </Card>
          <ChurchesSection user={user} />
          <RecentActivity userId={user.id} />
        </div>
        <div className="space-y-6">
          {isMe ? (
            <Card>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Your account</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                You can't block or delete your own account here.
              </p>
            </Card>
          ) : user.is_platform_admin ? (
            <Card>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Super admin</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Super admins can't be blocked or deleted. Revoke their access on the{' '}
                <Link to="/admins" className="font-medium text-brand-700 hover:underline dark:text-brand-200">
                  Super admins
                </Link>{' '}
                page first.
              </p>
            </Card>
          ) : (
            <>
              <BlockCard user={user} />
              <DeleteCard detail={detail} />
            </>
          )}
        </div>
      </div>
    </>
  );
};

/* -------------------------------------------------------------------------
 * Churches and activity
 * ---------------------------------------------------------------------- */

interface ChurchesSectionProps {
  user: AdminUserSummary;
}

const ChurchesSection = ({ user }: ChurchesSectionProps) => (
  <section aria-labelledby="user-churches">
    <SectionHeader id="user-churches" title="Churches" meta={user.memberships.length} />
    {user.memberships.length === 0 ? (
      <Card>
        <EmptyState compact icon="grid" title="No church" description="This account hasn't joined or been invited to a church." />
      </Card>
    ) : (
      <Card padding="none">
        <ul className="row-list">
          {user.memberships.map((membership) => (
            <li key={membership.organization_id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 text-sm">
              <Link
                to={`/churches/${membership.organization_id}`}
                className="font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200"
              >
                {membership.organization_name}
              </Link>
              <span className="text-slate-500 dark:text-slate-400">
                {roleLabel(membership.role)} · {membershipStatusLabel(membership.status)} · joined {formatDateTime(membership.joined_at)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    )}
  </section>
);

interface RecentActivityProps {
  userId: string;
}

const RecentActivity = ({ userId }: RecentActivityProps) => {
  const activity = useAdminActivity({ targetUserId: userId }, RECENT_ACTIVITY_LIMIT);
  const entries = activity.data?.pages[0]?.entries ?? [];
  return (
    <section aria-labelledby="user-activity">
      <SectionHeader
        id="user-activity"
        title="Admin activity about this account"
        action={
          <Link to={`/activity?user=${userId}`} className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-200">
            View all
          </Link>
        }
      />
      {activity.isPending ? (
        <Loading />
      ) : activity.isError ? (
        <ErrorNotice error={activity.error} onRetry={() => void activity.refetch()} />
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState compact icon="clock" title="Nothing yet" description="Blocks, deletions and super-admin changes show up here." />
        </Card>
      ) : (
        <Card padding="none">
          <ActivityList entries={entries} />
        </Card>
      )}
    </section>
  );
};

/* -------------------------------------------------------------------------
 * Block / unblock
 * ---------------------------------------------------------------------- */

interface BlockCardProps {
  user: AdminUserSummary;
}

const BlockCard = ({ user }: BlockCardProps) => {
  // Which dialog is open; fixed when opened, so it doesn't swap when the block lands.
  const [confirming, setConfirming] = useState<'block' | 'unblock' | null>(null);
  const blocked = user.block !== null;
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{blocked ? 'Unblock account' : 'Block account'}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {blocked
          ? 'They can sign in again on the web, mobile and admin apps. Their churches are as they were.'
          : 'They are signed out everywhere and can’t sign in until you unblock them. No data is deleted.'}
      </p>
      <Button
        variant={blocked ? 'primary' : 'danger'}
        size="sm"
        className="mt-3"
        onClick={() => setConfirming(blocked ? 'unblock' : 'block')}
      >
        {blocked ? 'Unblock…' : 'Block…'}
      </Button>
      {confirming === 'unblock' && <UnblockModal user={user} onClose={() => setConfirming(null)} />}
      {confirming === 'block' && <BlockModal user={user} onClose={() => setConfirming(null)} />}
    </Card>
  );
};

interface UserModalProps {
  user: AdminUserSummary;
  onClose: () => void;
}

const BlockModal = ({ user, onClose }: UserModalProps) => {
  const block = useBlockUser();
  const users = useAdminUsers();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const soleOwned = soleOwnedChurches(user, users.data ?? []);

  const confirm = () => {
    const parsed = blockUserSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError('Give a reason (up to 500 characters).');
      return;
    }
    setReasonError(undefined);
    block.mutate({ userId: user.id, reason: parsed.data.reason }, { onSuccess: onClose });
  };

  return (
    <Modal
      open
      title={`Block ${userDisplayName(user)}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={block.isPending} onClick={confirm}>
            Block account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>They are signed out of the web, mobile and admin apps right away and can’t sign in.</li>
          <li>Their church memberships stay; they still appear on rosters and schedules.</li>
          <li>No data is deleted. Unblocking restores their access.</li>
        </ul>
        {soleOwned.length > 0 && (
          <Notice tone="warning">
            They are the only owner of {soleOwned.map((church) => church.organization_name).join(', ')}. Nobody will be able to
            manage {soleOwned.length === 1 ? 'that church' : 'those churches'} while they are blocked.
          </Notice>
        )}
        <TextAreaField
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
          hint="Kept with the block and in the activity log. Not shown to them."
          maxLength={500}
        />
        <ErrorNotice error={block.error} />
      </div>
    </Modal>
  );
};

const UnblockModal = ({ user, onClose }: UserModalProps) => {
  const unblock = useUnblockUser();
  return (
    <Modal
      open
      title={`Unblock ${userDisplayName(user)}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={unblock.isPending} onClick={() => unblock.mutate(user.id, { onSuccess: onClose })}>
            Unblock account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">They can sign in again with their existing password.</p>
        <ErrorNotice error={unblock.error} />
      </div>
    </Modal>
  );
};

/* -------------------------------------------------------------------------
 * Delete
 * ---------------------------------------------------------------------- */

interface DeleteCardProps {
  detail: AdminUserDetail;
}

const DeleteCard = ({ detail }: DeleteCardProps) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card>
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Delete account</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Permanently deletes the login and personal data, under the same rules as deleting your own account.
      </p>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirming(true)}>
        Delete…
      </Button>
      {confirming && <DeleteModal detail={detail} onClose={() => setConfirming(false)} />}
    </Card>
  );
};

interface DeleteModalProps {
  detail: AdminUserDetail;
  onClose: () => void;
}

/** Churches from a 409 `account_deletion_blocked` (the plan changed after the page loaded). */
const refusedChurches = (error: Error | null): AdminUserDeletionChurch[] | null => {
  if (!(error instanceof ApiError) || error.code !== ACCOUNT_DELETION_BLOCKED || !Array.isArray(error.details)) return null;
  return error.details.filter(
    (church: unknown): church is AdminUserDeletionChurch =>
      typeof church === 'object' && church !== null && 'organization_id' in church && 'organization_name' in church,
  );
};

const DeleteModal = ({ detail, onClose }: DeleteModalProps) => {
  const { user, deletion } = detail;
  const remove = useDeleteUser();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');

  const refused = refusedChurches(remove.error);
  const blocking = refused ?? deletion.churches.filter((church) => church.outcome === 'blocked');
  const deleting = deletion.churches.filter((church) => church.outcome === 'deleted');
  const canDelete = deletion.can_delete && refused === null;
  const matches = confirmationMatches(user.email, typed);

  const confirm = () => {
    if (!matches) return;
    remove.mutate({ userId: user.id, confirmEmail: typed }, { onSuccess: () => navigate('/users', { replace: true }) });
  };

  return (
    <Modal
      open
      title={canDelete ? `Delete ${userDisplayName(user)}?` : 'This account can’t be deleted yet'}
      onClose={onClose}
      footer={
        canDelete ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" disabled={!matches} loading={remove.isPending} onClick={confirm}>
              Delete account
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {canDelete ? (
        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
            <li>The login, profile and profile picture are deleted. This can’t be undone.</li>
            <li>They leave every church; records they made in a church stay with the church.</li>
            {deleting.length > 0 && (
              <li>
                {pluralize(deleting.length, 'church', 'churches')} nobody else is in will be deleted too:{' '}
                <strong className="font-semibold">{deleting.map((church) => church.organization_name).join(', ')}</strong>.
              </li>
            )}
          </ul>
          <TextField
            label={`Type ${user.email ?? 'their email'} to confirm`}
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') confirm();
            }}
          />
          <ErrorNotice error={remove.error} />
        </div>
      ) : (
        <div className="space-y-4">
          <Notice tone="warning">
            Deleting this account would leave other members without an owner in{' '}
            {blocking.length === 1 ? 'this church' : `these ${blocking.length} churches`}. Make someone else an owner first (enter
            the church as owner to do it), then try again.
          </Notice>
          <ul className="space-y-1 text-sm">
            {blocking.map((church) => (
              <li key={church.organization_id}>
                <Link
                  to={`/churches/${church.organization_id}`}
                  className="font-medium text-brand-700 hover:underline dark:text-brand-200"
                >
                  {church.organization_name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
};
