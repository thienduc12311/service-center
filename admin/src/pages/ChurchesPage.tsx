import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AdminOrganizationSummary } from '@service-center/shared';
import { useAdminOrganizations } from '../hooks/queries';
import {
  DEFAULT_CHURCH_SORT,
  filterChurches,
  nextChurchSort,
  sortChurches,
  type ChurchSort,
  type ChurchSortKey,
  type ChurchStatusFilter,
} from '../lib/churches';
import { formatCount, formatDate, formatRelativeTime } from '../lib/format';
import { ChurchStatusBadge, StorageBar } from '../components/status';
import { CreateChurchModal } from '../components/CreateChurchModal';
import { Icon } from '../components/icons';
import { Button, Card, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';

const STATUS_FILTERS: readonly { value: ChurchStatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];

const isStatusFilter = (value: string): value is ChurchStatusFilter => STATUS_FILTERS.some((filter) => filter.value === value);

export const ChurchesPage = () => {
  const churches = useAdminOrganizations();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ChurchStatusFilter>('all');
  const [sort, setSort] = useState<ChurchSort>(DEFAULT_CHURCH_SORT);
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () => (churches.data ? sortChurches(filterChurches(churches.data, { query, status }), sort) : []),
    [churches.data, query, status, sort],
  );

  return (
    <>
      <PageHeader
        title="Churches"
        subtitle={churches.data ? `${formatCount(churches.data.length)} on Service Center` : undefined}
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            New church
          </Button>
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <label htmlFor="church-search" className="sr-only">
            Search churches
          </label>
          <input
            id="church-search"
            type="search"
            className="input pl-9"
            placeholder="Search name, slug or owner email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <label htmlFor="church-status" className="sr-only">
          Status
        </label>
        <select
          id="church-status"
          className="input sm:w-44"
          value={status}
          onChange={(event) => {
            if (isStatusFilter(event.target.value)) setStatus(event.target.value);
          }}
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>
              {filter.label}
            </option>
          ))}
        </select>
      </div>

      {churches.isPending ? (
        <Loading />
      ) : churches.isError ? (
        <ErrorNotice error={churches.error} onRetry={() => void churches.refetch()} />
      ) : churches.data.length === 0 ? (
        <EmptyState
          icon="grid"
          title="No churches yet"
          description="Approve an application or create a church directly."
          action={<Button onClick={() => setCreating(true)}>New church</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon="search" title="No matches" description="No church matches this search and filter." />
      ) : (
        <ChurchTable rows={rows} sort={sort} onSort={(key) => setSort((current) => nextChurchSort(current, key))} />
      )}

      <CreateChurchModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(church) => navigate(`/churches/${church.id}`)}
      />
    </>
  );
};

interface ChurchTableProps {
  rows: readonly AdminOrganizationSummary[];
  sort: ChurchSort;
  onSort: (key: ChurchSortKey) => void;
}

const ChurchTable = ({ rows, sort, onSort }: ChurchTableProps) => (
  <Card padding="none" className="overflow-x-auto">
    <table className="data-table min-w-[960px]">
      <thead>
        <tr>
          <SortHeader label="Church" column="name" sort={sort} onSort={onSort} />
          <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
          <SortHeader label="Owner" column="owner" sort={sort} onSort={onSort} />
          <SortHeader label="Accounts" column="accounts" sort={sort} onSort={onSort} align="right" />
          <SortHeader label="People" column="people" sort={sort} onSort={onSort} align="right" />
          <SortHeader label="Storage" column="storage" sort={sort} onSort={onSort} />
          <SortHeader label="Created" column="created" sort={sort} onSort={onSort} />
          <SortHeader label="Last activity" column="last_activity" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map((church) => (
          <tr key={church.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
            <td className="max-w-64">
              <Link to={`/churches/${church.id}`} className="block font-medium text-slate-900 hover:text-brand-700 dark:text-white dark:hover:text-brand-200">
                <span className="block truncate">{church.name}</span>
              </Link>
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">/{church.slug}</span>
            </td>
            <td>
              <ChurchStatusBadge status={church.status} />
            </td>
            <td className="max-w-56">
              {church.owner ? (
                <>
                  <span className="block truncate text-slate-900 dark:text-slate-100">{church.owner.full_name ?? '—'}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{church.owner.email ?? ''}</span>
                </>
              ) : (
                <span className="text-slate-400">No owner</span>
              )}
            </td>
            <td className="text-right tabular-nums">
              {formatCount(church.accounts)}
              {church.invited > 0 && (
                <span className="block text-xs text-slate-500 dark:text-slate-400">+{formatCount(church.invited)} invited</span>
              )}
            </td>
            <td className="text-right tabular-nums">{formatCount(church.people)}</td>
            <td>
              <StorageBar usedBytes={church.storage_used_bytes} quotaBytes={church.storage_quota_bytes} custom={church.quota_is_custom} />
            </td>
            <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(church.created_at)}</td>
            <td className="whitespace-nowrap text-slate-600 dark:text-slate-300">
              {church.last_activity_at ? (
                <time dateTime={church.last_activity_at} title={formatDate(church.last_activity_at)}>
                  {formatRelativeTime(church.last_activity_at)}
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

interface SortHeaderProps {
  label: string;
  column: ChurchSortKey;
  sort: ChurchSort;
  onSort: (key: ChurchSortKey) => void;
  align?: 'left' | 'right';
}

const SortHeader = ({ label, column, sort, onSort, align = 'left' }: SortHeaderProps) => {
  const active = sort.key === column;
  return (
    <th scope="col" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'} className={align === 'right' ? 'text-right' : ''}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-900 dark:hover:text-white ${
          active ? 'text-slate-900 dark:text-white' : ''
        }`}
      >
        {label}
        <Icon
          name="chevronDown"
          className={`size-3 transition ${active ? 'opacity-100' : 'opacity-0'} ${active && sort.direction === 'asc' ? 'rotate-180' : ''}`}
        />
      </button>
    </th>
  );
};
