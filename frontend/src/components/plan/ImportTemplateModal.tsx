import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type AttendanceConflict, type PlanDetail, type PlanSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { usePeople, usePlans, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { useFormatters } from '../../i18n';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';
import { ConflictList } from './attendance';

export interface ImportTemplateModalProps {
  open: boolean;
  plan: PlanDetail;
  onClose: () => void;
}

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

  const candidates = usePlans({
    ...(plan.service_type_id ? { service_type_id: plan.service_type_id } : {}),
    order: 'desc',
    per_page: 25,
  });
  const sources: PlanSummary[] = (candidates.data?.data ?? []).filter(
    (candidate) => candidate.id !== plan.id,
  );

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
        <p className="text-sm text-slate-500">
          {plan.service_type
            ? t('import.introWithType', { serviceType: plan.service_type.name })
            : t('import.intro')}
        </p>

        {candidates.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400">
            <Spinner />
          </div>
        ) : sources.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            {t('import.none')}
          </p>
        ) : (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => {
                  setSourceId(source.id);
                  setAttemptKey(crypto.randomUUID());
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                  sourceId === source.id ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
                }`}
              >
                <span className="font-medium">{source.title}</span>
                <span className="text-xs text-slate-400">
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

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300"
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
              className="size-4 rounded border-slate-300"
              checked={withTeam}
              onChange={(event) => {
                setWithTeam(event.target.checked);
                setAttemptKey(crypto.randomUUID());
              }}
            />
            {t('import.team')}
          </label>
          {withTeam && (
            <p className="ml-6 text-xs text-slate-500">
              {t('import.teamHint')}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300"
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
              <p className="text-xs text-slate-500">{t('import.noOverride')}</p>
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
