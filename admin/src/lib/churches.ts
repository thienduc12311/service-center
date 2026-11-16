import {
  STORAGE_QUOTA_WARNING_FRACTION,
  storageFractionUsed,
  type AdminOrganizationSummary,
  type OrganizationPlatformStatus,
} from '@service-center/shared';

export type ChurchStatusFilter = 'all' | OrganizationPlatformStatus;

export interface ChurchFilter {
  /** Matches name, slug or owner email (and owner name), ignoring case and accents. */
  query: string;
  status: ChurchStatusFilter;
}

export type ChurchSortKey = 'name' | 'status' | 'owner' | 'accounts' | 'people' | 'storage' | 'created' | 'last_activity';
export type SortDirection = 'asc' | 'desc';

export interface ChurchSort {
  key: ChurchSortKey;
  direction: SortDirection;
}

export const DEFAULT_CHURCH_SORT: ChurchSort = { key: 'name', direction: 'asc' };

/** Text columns start A→Z; numbers and dates start with the largest or newest. */
const FIRST_DIRECTION: Record<ChurchSortKey, SortDirection> = {
  name: 'asc',
  status: 'asc',
  owner: 'asc',
  accounts: 'desc',
  people: 'desc',
  storage: 'desc',
  created: 'desc',
  last_activity: 'desc',
};

const fold = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

export const filterChurches = (
  churches: readonly AdminOrganizationSummary[],
  filter: ChurchFilter,
): AdminOrganizationSummary[] => {
  const needle = fold(filter.query.trim());
  return churches.filter((church) => {
    if (filter.status !== 'all' && church.status !== filter.status) return false;
    if (!needle) return true;
    const haystack = [church.name, church.slug, church.owner?.email ?? '', church.owner?.full_name ?? ''];
    return haystack.some((value) => fold(value).includes(needle));
  });
};

const ownerLabel = (church: AdminOrganizationSummary): string =>
  church.owner?.full_name || church.owner?.email || '';

const compareText = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' });

const timestamp = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

/** Ascending order for one column; nulls are handled by the caller. */
const compareBy = (key: ChurchSortKey, a: AdminOrganizationSummary, b: AdminOrganizationSummary): number => {
  switch (key) {
    case 'name':
      return compareText(a.name, b.name);
    case 'status':
      return compareText(a.status, b.status);
    case 'owner':
      return compareText(ownerLabel(a), ownerLabel(b));
    case 'accounts':
      return a.accounts - b.accounts;
    case 'people':
      return a.people - b.people;
    case 'storage':
      return a.storage_used_bytes - b.storage_used_bytes;
    case 'created':
      return Date.parse(a.created_at) - Date.parse(b.created_at);
    case 'last_activity':
      return (timestamp(a.last_activity_at) ?? 0) - (timestamp(b.last_activity_at) ?? 0);
  }
};

/** Missing values (no owner, never active) sort last in either direction. */
const isMissing = (key: ChurchSortKey, church: AdminOrganizationSummary): boolean =>
  (key === 'owner' && !ownerLabel(church)) || (key === 'last_activity' && !church.last_activity_at);

export const sortChurches = (
  churches: readonly AdminOrganizationSummary[],
  sort: ChurchSort,
): AdminOrganizationSummary[] => {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...churches].sort((a, b) => {
    const missingA = isMissing(sort.key, a);
    const missingB = isMissing(sort.key, b);
    if (missingA !== missingB) return missingA ? 1 : -1;
    const order = missingA ? 0 : compareBy(sort.key, a, b) * sign;
    // Name breaks ties so the order is stable between renders.
    return order !== 0 ? order : compareText(a.name, b.name);
  });
};

/** Clicking a column header: the same column flips, another starts in its natural direction. */
export const nextChurchSort = (current: ChurchSort, key: ChurchSortKey): ChurchSort =>
  current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: FIRST_DIRECTION[key] };

export const churchStorageFraction = (church: AdminOrganizationSummary): number =>
  storageFractionUsed(church.storage_used_bytes, church.storage_quota_bytes);

/** Churches at or past the warning share of their quota, fullest first. */
export const churchesNearQuota = (
  churches: readonly AdminOrganizationSummary[],
  warningFraction: number = STORAGE_QUOTA_WARNING_FRACTION,
): AdminOrganizationSummary[] =>
  churches
    .filter((church) => churchStorageFraction(church) >= warningFraction)
    .sort((a, b) => churchStorageFraction(b) - churchStorageFraction(a));

/** The main app selects the church named in `?organization=` (see frontend AuthProvider). */
export const serviceCenterChurchUrl = (appUrl: string, organizationId: string): string => {
  const url = new URL('/', appUrl);
  url.searchParams.set('organization', organizationId);
  return url.toString();
};
