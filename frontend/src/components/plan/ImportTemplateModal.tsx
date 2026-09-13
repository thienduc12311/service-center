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
 * service, the scheduled team, or both. It reuses the ordinary item and
 * assignment endpoints rather than a bespoke one, so everything it creates is
 * exactly what a scheduler would have created by hand.
 */
export const ImportTemplateModal = ({ open, plan, onClose }: ImportTemplateModalProps) => {
  const invalidate = useInvalidateOrg();
  const [sourceId, setSourceId] = useState('');
  const [withOrder, setWithOrder] = useState(true);
  const [withTeam, setWithTeam] = useState(true);

  const candidates = usePlans({
    ...(plan.service_type_id ? { service_type_id: plan.service_type_id } : {}),
    order: 'desc',
    per_page: 25,
  });
  const sources: PlanSummary[] = (candidates.data?.data ?? []).filter(
    (candidate) => candidate.id !== plan.id,
  );

  const runImport = useMutation({
    mutationFn: async () => {
      const source = await api.getPlan(sourceId);

      if (withOrder) {
        // Sequential: the API appends each item to the end of the order, so
        // parallel calls would land in an arbitrary order.
        for (const item of source.items) {
          await api.addPlanItem(plan.id, {
            item_type: item.item_type,
            title: item.title,
            song_id: item.song_id,
            arrangement_id: item.arrangement_id,
            key_override: item.key_override,
            length_seconds: item.length_seconds,
            description: item.description,
          });
        }
      }

      if (withTeam && source.assignments.length) {
        await api.createAssignments(plan.id, {
          assignments: source.assignments.map((assignment) => ({
            user_id: assignment.user_id,
            team_id: assignment.team_id,
            position_id: assignment.position_id,
          })),
          // A template import is a starting point, not a commitment — schedule
          // everyone and let the scheduler resolve clashes before notifying.
          ignore_conflicts: true,
          notify: false,
        });
      }
    },
    onSuccess: async () => {
      await invalidate();
      setSourceId('');
      onClose();
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
                onClick={() => setSourceId(source.id)}
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
              onChange={(event) => setWithOrder(event.target.checked)}
            />
            Order of service
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300"
              checked={withTeam}
              onChange={(event) => setWithTeam(event.target.checked)}
            />
            Scheduled team
          </label>
        </div>

        <ErrorNotice error={runImport.error} />

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={runImport.isPending}
            disabled={!sourceId || (!withOrder && !withTeam)}
            onClick={() => runImport.mutate()}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
};
