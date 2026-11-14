import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AccessMember } from '@service-center/shared';
import { matchesSearch } from '../../lib/search';
import { useAccessMembers } from '../../hooks/queries';
import { Avatar, Badge, Button, ErrorNotice, Segmented, Spinner, type TabItem } from '../ui';
import { Icon } from '../icons';
import { MemberAccessPanel } from './MemberAccessPanel';
import { ROLE_TONES } from './access-roles';
import { groupGrants, useScopeCatalog, type ScopeCatalog } from './access-scopes';

type MemberFilter = 'all' | 'leaders' | 'granted' | 'churchWide';

/** Rows rendered before "Show more"; keeps a 100+ member church snappy. */
const PAGE_SIZE = 25;
/** Permission tags shown per row before collapsing into "+N". */
const MAX_GRANT_CHIPS = 3;

const isLeaderRole = (role: AccessMember['role']): boolean => role !== 'member';
const hasChurchWideGrant = (member: AccessMember): boolean =>
  member.grants.some((grant) => grant.scope_type === 'organization');

const FILTERS: Record<MemberFilter, (member: AccessMember) => boolean> = {
  all: () => true,
  leaders: (member) => isLeaderRole(member.role),
  granted: (member) => member.grants.length > 0,
  churchWide: hasChurchWideGrant,
};

/** One member's permissions as short tags, e.g. "Schedule people · Worship Band". */
const useGrantLabels = (member: AccessMember, catalog: ScopeCatalog): string[] => {
  const { t } = useTranslation('settings');
  return groupGrants(member, catalog, t('memberAccess.unknownPlace')).flatMap((group) =>
    group.capabilities.map((capability) =>
      group.scopeType === 'organization'
        ? t(`capabilities.${capability}`)
        : t('memberAccess.grantAt', { permission: t(`capabilities.${capability}`), place: group.name }),
    ),
  );
};

interface MemberRowProps {
  member: AccessMember;
  catalog: ScopeCatalog;
  onOpen: (userId: string) => void;
}

const MemberRow = ({ member, catalog, onOpen }: MemberRowProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const labels = useGrantLabels(member, catalog);
  const name = member.full_name ?? t('common:fallback.unnamed');
  const hidden = labels.length - MAX_GRANT_CHIPS;

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(member.user_id)}
        aria-label={t('memberAccess.open', { name })}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-slate-50 focus-visible:bg-slate-50 dark:hover:bg-slate-800/50 dark:focus-visible:bg-slate-800/50"
      >
        <Avatar name={member.full_name} url={member.avatar_url} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            <Badge tone={ROLE_TONES[member.role]}>{t(`common:roles.${member.role}`)}</Badge>
            {member.role === 'scheduler' && (
              <span className="hidden text-xs text-slate-500 sm:inline">{t(`access.mode.${member.access_mode}`)}</span>
            )}
          </div>
          {labels.length === 0 ? (
            <p className="text-xs text-slate-400">{t('access.noExtraGrants')}</p>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {labels.slice(0, MAX_GRANT_CHIPS).map((label) => (
                <span
                  key={label}
                  className="max-w-full truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {label}
                </span>
              ))}
              {hidden > 0 && (
                <span className="rounded-md px-1.5 py-0.5 text-[11px] text-slate-500">
                  {t('access.moreGrants', { count: hidden })}
                </span>
              )}
            </div>
          )}
        </div>
        <Icon name="chevronRight" className="size-4 shrink-0 text-slate-400" />
      </button>
    </li>
  );
};

/**
 * F01 administration, person first: find a member, open them, and see and
 * change everything they can do in one panel. Owners and admins always have
 * everything; schedulers keep church-wide access until switched to
 * "Only granted areas".
 */
export const AccessSettings = () => {
  const { t } = useTranslation(['settings', 'common']);
  const members = useAccessMembers();
  const catalog = useScopeCatalog();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MemberFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const all = useMemo(() => members.data ?? [], [members.data]);
  const filtered = useMemo(
    () =>
      all.filter(
        (member) =>
          FILTERS[filter](member) && matchesSearch(query, [member.full_name, t(`common:roles.${member.role}`)]),
      ),
    [all, filter, query, t],
  );
  const shown = filtered.slice(0, limit);
  const filterItems: TabItem<MemberFilter>[] = (['all', 'leaders', 'granted', 'churchWide'] as const).map((value) => ({
    value,
    label: t(`access.filter.${value}`),
    count: all.filter(FILTERS[value]).length,
  }));
  const resetPaging = () => setLimit(PAGE_SIZE);

  return (
    <section className="card space-y-4 p-5" aria-labelledby="access-settings-heading">
      <div>
        <h2 id="access-settings-heading" className="font-semibold text-slate-900 dark:text-white">{t('access.title')}</h2>
        <p className="text-sm text-slate-500">{t('access.description')}</p>
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            className="input !pl-9"
            aria-label={t('access.searchMembers')}
            placeholder={t('access.searchMembers')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPaging();
            }}
          />
        </div>
        <div className="scrollbar-none -mx-1 overflow-x-auto px-1">
          <Segmented
            label={t('access.filter.label')}
            items={filterItems}
            value={filter}
            onChange={(value) => {
              setFilter(value);
              resetPaging();
            }}
          />
        </div>
      </div>

      <ErrorNotice error={members.error} />

      {members.isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-app-border px-4 py-6 text-center text-sm text-slate-500">
          {t('access.noMatchingMembers')}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-app-border overflow-hidden rounded-xl border border-app-border">
            {shown.map((member) => (
              <MemberRow key={member.user_id} member={member} catalog={catalog} onOpen={setOpenUserId} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>{t('access.showing', { shown: shown.length, total: filtered.length })}</span>
            {filtered.length > shown.length && (
              <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {t('access.showMore')}
              </Button>
            )}
          </div>
        </>
      )}

      <MemberAccessPanel userId={openUserId} onClose={() => setOpenUserId(null)} />
    </section>
  );
};
