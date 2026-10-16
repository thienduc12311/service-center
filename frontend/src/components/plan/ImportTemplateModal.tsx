import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatDate, type PlanDetail, type PlanSummary } from '@service-center/shared';
import { api } from '../../lib/api';
import { usePlans, useInvalidateOrg } from '../../hooks/queries';
import { Button, ErrorNotice, Modal, Spinner } from '../ui';

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
  const invalidate = useInvalidateOrg();
  const [sourceId, setSourceId] = useState('');
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [withOrder, setWithOrder] = useState(true);
  const [withTeam, setWithTeam] = useState(true);
  const [withNeeds, setWithNeeds] = useState(true);

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
      }),
    onSuccess: async () => {
      await invalidate();
      setSourceId('');
      setAttemptKey(crypto.randomUUID());
      onClose();
    },
    // A stale plan is refreshed so the next attempt sees the latest content.
    onError: async () => {
      await invalidate();
    },
  });
  return (
    <Modal open={open} title="Import from another plan" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Copy the order of service and the scheduled team from a previous
          {plan.service_type ? ` ${plan.service_type.name}` : ''} plan. Nothing already on this plan
          is removed.
        </p>

        {candidates.isLoading ? (
          <div className="flex justify-center py-6 text-slate-400">
            <Spinner />
          </div>
        ) : sources.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            There is no other plan to copy from yet.
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
                  {formatDate(source.service_date)} · {source.counts.items} item
                  {source.counts.items === 1 ? '' : 's'} ·{' '}
                  {source.counts.confirmed + source.counts.unconfirmed + source.counts.declined}{' '}
                  scheduled
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
            Order of service
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
            Scheduled team
          </label>
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
            Needed positions (kept where this plan already sets them)
          </label>
        </div>

        <ErrorNotice error={runImport.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={runImport.isPending}
            disabled={!sourceId || (!withOrder && !withTeam && !withNeeds)}
            onClick={() => runImport.mutate(attemptKey)}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
};
