import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AdminUserSummary } from '@service-center/shared';
import { useAdminUsers } from '../hooks/queries';
import {
  churchOptions,
  filterUsers,
  membershipStatusLabel,
  roleLabel,
  userDisplayName,
  type UserFilter,
  type UserStatusFilter,
} from '../lib/users';
import { formatCount, formatDate, formatRelativeTime } from '../lib/format';
import { Icon } from '../components/icons';
import { Badge, Card, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

const STATUS_FILTERS: readonly { value: UserStatusFilter; label: string }[] = [
  { value: 'all', label: 'All accounts' },
  { value: 'active', label: 'Can sign in' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'super_admin', label: 'Super admins' },
  { value: 'no_church', label: 'No church' },
];

const isStatusFilter = (value: string): value is UserStatusFilter => STATUS_FILTERS.some((filter) => filter.value === value);

/** Every account on the platform. Filters live in the URL (`?q=&status=&church=`) so a filtered list can be shared. */
export const UsersPage = () => {
  const users = useAdminUsers();
  const [params, setParams] = useSearchParams();
  const statusParam = params.get('status') ?? 'all';
  const query = params.get('q') ?? '';
  const status: UserStatusFilter = isStatusFilter(statusParam) ? statusParam : 'all';
  const churchId = params.get('church');
  const filter = useMemo<UserFilter>(() => ({ query, status, churchId }), [query, status, churchId]);

  const update = (changes: Partial<Record<'q' | 'status' | 'church', string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value && !(key === 'status' && value === 'all')) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const churches = useMemo(() => churchOptions(users.data ?? []), [users.data]);
  const rows = useMemo(() => filterUsers(users.data ?? [], filter), [users.data, filter]);
  const blockedCount = users.data?.filter((user) => user.block !== null).length ?? 0;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={
          users.data
            ? `${formatCount(users.data.length)} accounts${blockedCount ? `, ${formatCount(blockedCount)} blocked` : ''}`
            : undefined
        }
      />

      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center">
        <div className="relative flex-1 md:max-w-sm">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="user-search" className="sr-only">
            Search users
          </label>
          <input
            id="user-search"
            type="search"
            className="input pl-9"
            placeholder="Search name, email or church"
            value={filter.query}
            onChange={(event) => update({ q: event.target.value })}
          />
        </div>
        <label htmlFor="user-status" className="sr-only">
          Status
        </label>
        <select
          id="user-status"
          className="input md:w-44"
          value={filter.status}
          onChange={(event) => update({ status: event.target.value })}
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label htmlFor="user-church" className="sr-only">
          Church
        </label>
        <select
          id="user-church"
          className="input md:w-56"
          value={filter.churchId ?? ''}
          onChange={(event) => update({ church: event.target.value })}
        >
          <option value="">Every church</option>
          {churches.map((church) => (
            <option key={church.id} value={church.id}>
              {church.name}
            </option>
          ))}
        </select>
      </div>

      {users.isPending ? (
        <Loading />
      ) : users.isError ? (
        <ErrorNotice error={users.error} onRetry={() => void users.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="search" title="No matches" description="No account matches this search and filter." />
      ) : (
        <UserTable rows={rows} />
      )}
    </>
  );
};

interface UserTableProps {
  rows: readonly AdminUserSummary[];
}

const UserTable = ({ rows }: UserTableProps) => (
  <Card padding="none" className="overflow-x-auto">
    <table className="data-table min-w-[900px]">
      <thead>
        <tr>
          <th scope="col">Account</th>
          <th scope="col">Status</th>
          <th scope="col">Churches</th>
          <th scope="col">Created</th>
          <th scope="col">Last sign-in</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((user) => (
          <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
            <td className="max-w-72">
              <Link to={`/users/${user.id}`} className="block font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200">
                <span className="block truncate">{userDisplayName(user)}</span>
              </Link>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{user.email}</span>
            </td>
            <td>
              <UserBadges user={user} />
            </td>
            <td className="max-w-80">
              {user.memberships.length === 0 ? (
                <span className="text-slate-400">No church</span>
              ) : (
                <ul className="space-y-0.5">
                  {user.memberships.map((membership) => (
                    <li key={membership.organization_id} className="truncate text-sm">
                      <Link to={`/churches/${membership.organization_id}`} className="text-slate-900 hover:text-brand-700 dark:text-slate-100 dark:hover:text-brand-200">
                        {membership.organization_name}
                      </Link>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {' '}
                        · {roleLabel(membership.role)}
                        {membership.status !== 'active' && ` · ${membershipStatusLabel(membership.status)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
            <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(user.created_at)}</td>
            <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
              {user.last_sign_in_at ? (
                <time dateTime={user.last_sign_in_at} title={formatDate(user.last_sign_in_at)}>
                  {formatRelativeTime(user.last_sign_in_at)}
                </time>
              ) : (
                <span className="text-slate-400">Never</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </Card>
);

export interface UserBadgesProps {
  user: AdminUserSummary;
}

/** Blocked or active, plus super admin and unconfirmed email. */
export const UserBadges = ({ user }: UserBadgesProps) => {
  const badges: ReactNode[] = [
    user.block ? (
      <Badge key="status" tone="red">
        Blocked
      </Badge>
    ) : (
      <Badge key="status" tone="green">
        Active
      </Badge>
    ),
  ];
  if (user.is_platform_admin) {
    badges.push(
      <Badge key="admin" tone="brand">
        Super admin
      </Badge>,
    );
  }
  if (!user.email_confirmed) {
    badges.push(
      <Badge key="email" tone="amber">
        Email not confirmed
      </Badge>,
    );
  }
  return <span className="flex flex-wrap gap-1">{badges}</span>;
};
