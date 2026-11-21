import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type AttendanceConflict, type PlanDetail, type PlanSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { usePeople, usePlanPages, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';
import { Icon } from '../icons';
import { ListFooter } from '../ListFooter';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { ConflictList } from './attendance';

export interface ImportTemplateModalProps {
  open: boolean;
  plan: PlanDetail;
  onClose: () => void;
}

/** Past plans loaded per page; "Show more" loads older ones. */
const SOURCE_PAGE_SIZE = 25;

/**
 * Copies a previous plan of the same service type into this one — the order of
 * service, the scheduled team, or both — in one server transaction: either all
 * of it lands or none of it does. Copied people are fresh, unconfirmed
 * requests and nobody is notified. If the plan changed since it was opened,
 * the import is refused and the plan reloaded.
 */
export const ImportTemplateModal = ({ open, plan, onClose }: ImportTemplateModalProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const fmt = useFormatters();
  const invalidate = useInvalidateOrg();
  const [sourceId, setSourceId] = useState('');
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [withOrder, setWithOrder] = useState(true);
  const [withTeam, setWithTeam] = useState(true);
  const [withNeeds, setWithNeeds] = useState(true);
  const [conflictReason, setConflictReason] = useState('');
  const { can } = useAuth();
  const people = usePeople();

  const [search, setSearch] = useState('');
  const query = useDebouncedValue(search.trim());
  const [sameType, setSameType] = useState(true);
  const filterByType = sameType && Boolean(plan.service_type_id);
  /** The chosen plan, kept so it stays listed while a search no longer matches it. */
  const [chosen, setChosen] = useState<PlanSummary | null>(null);

  // The server searches every past plan (accent-insensitive title words), not just the pages loaded.
  const candidates = usePlanPages(
    {
      ...(filterByType && plan.service_type_id ? { service_type_id: plan.service_type_id } : {}),
      ...(query ? { q: query } : {}),
      order: 'desc',
      per_page: SOURCE_PAGE_SIZE,
    },
    open,
  );
  const loaded: PlanSummary[] = useMemo(
    () => (candidates.data?.pages ?? []).flatMap((page) => page.data),
    [candidates.data],
  );
  const loadedSources = loaded.filter((candidate) => candidate.id !== plan.id);
  const lastPage = candidates.data?.pages.at(-1);
  const total = lastPage ? lastPage.total - (loaded.length > loadedSources.length ? 1 : 0) : null;
  // The chosen plan stays visible (first) while the search changes.
  const pinned = chosen && chosen.id === sourceId && !loadedSources.some((source) => source.id === chosen.id) ? [chosen] : [];
  const sources = [...pinned, ...loadedSources];

  // One key per import attempt: a retry after a timeout is answered with the
  // first result rather than copying the order twice.
  const runImport = useMutation({
    mutationFn: (idempotencyKey: string) =>
      api.importPlanContents(plan.id, {
        source_plan_id: sourceId,
        items: withOrder,
        position_needs: withNeeds,
        assignments: withTeam,
        expected_revision: plan.content_revision,
        idempotency_key: idempotencyKey,
        conflict_override_reason: conflictReason.trim() || null,
      }),
    onSuccess: async () => {
      await invalidate();
      setSourceId('');
      setChosen(null);
      setConflictReason('');
      setAttemptKey(crypto.randomUUID());
      onClose();
    },
    // A stale plan is refreshed so the next attempt sees the latest content.
    onError: async () => {
      await invalidate();
    },
  });
  // F04: copied people are re-checked like any new request. A conflict
  // refuses the whole import unless an authorized scheduler gives a reason.
  const conflicts: AttendanceConflict[] =
    runImport.error instanceof ApiError && runImport.error.code === 'scheduling_conflict'
      ? ((runImport.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const mayOverride = can('scheduling.override_conflicts', { serviceTypeId: plan.service_type_id });
  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');

  return (
    <Modal open={open} title={t('import.title')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {plan.service_type && filterByType
            ? t('import.introWithType', { serviceType: plan.service_type.name })
            : t('import.intro')}
        </p>

        <div className="space-y-2">
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              className="input !pl-9"
              aria-label={t('import.searchLabel')}
              placeholder={t('import.searchPlaceholder')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {plan.service_type && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 dark:border-slate-700"
                checked={sameType}
                onChange={(event) => {
                  setSameType(event.target.checked);
                  setSourceId('');
                  setChosen(null);
                  setAttemptKey(crypto.randomUUID());
                }}
              />
              {t('import.sameTypeOnly', { serviceType: plan.service_type.name })}
            </label>
          )}
        </div>

        {candidates.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400 dark:text-slate-500">
            <Spinner />
          </div>
        ) : candidates.error ? (
          <ErrorNotice error={candidates.error} />
        ) : loadedSources.length === 0 && !candidates.hasNextPage && !query ? (
          <p className="surface-inset px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('import.none')}
          </p>
        ) : (
          <div>
            {sources.length === 0 ? (
              <p className="surface-inset px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('import.noMatches')}
              </p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    aria-pressed={sourceId === source.id}
                    onClick={() => {
                      setSourceId(source.id);
                      setChosen(source);
                      setAttemptKey(crypto.randomUUID());
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                      sourceId === source.id ? 'bg-brand-50 ring-1 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{source.title}</span>
                      {!filterByType && source.service_type && (
                        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{source.service_type.name}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                      {t('import.sourceMeta', {
                        date: fmt.date(source.service_date),
                        items: t('count.items', { count: source.counts.items }),
                        scheduled: t('import.scheduled', {
                          count: source.counts.confirmed + source.counts.unconfirmed + source.counts.declined,
                        }),
                      })}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <ListFooter
              shown={loadedSources.length}
              total={total}
              onShowMore={candidates.hasNextPage ? () => void candidates.fetchNextPage() : undefined}
              loading={candidates.isFetchingNextPage}
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 dark:border-slate-700"
              checked={withOrder}
              onChange={(event) => {
                setWithOrder(event.target.checked);
                setAttemptKey(crypto.randomUUID());
              }}
            />
            {t('import.order')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 dark:border-slate-700"
              checked={withTeam}
              onChange={(event) => {
                setWithTeam(event.target.checked);
                setAttemptKey(crypto.randomUUID());
              }}
            />
            {t('import.team')}
          </label>
          {withTeam && (
            <p className="ml-6 text-xs text-slate-500 dark:text-slate-400">
              {t('import.teamHint')}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 dark:border-slate-700"
              checked={withNeeds}
              onChange={(event) => {
                setWithNeeds(event.target.checked);
                setAttemptKey(crypto.randomUUID());
              }}
            />
            {t('import.needs')}
          </label>
        </div>

        {conflicts.length > 0 ? (
          <>
            <ConflictList conflicts={conflicts} nameOf={nameOf} />
            {mayOverride ? (
              <input
                aria-label={t('import.conflictReasonLabel')}
                className="input"
                placeholder={t('import.conflictReasonPlaceholder')}
                maxLength={500}
                value={conflictReason}
                onChange={(event) => setConflictReason(event.target.value)}
              />
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('import.noOverride')}</p>
            )}
          </>
        ) : (
          <ErrorNotice error={runImport.error} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            loading={runImport.isPending}
            disabled={!sourceId || (!withOrder && !withTeam && !withNeeds)}
            onClick={() => runImport.mutate(attemptKey)}
          >
            {t('import.import')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
