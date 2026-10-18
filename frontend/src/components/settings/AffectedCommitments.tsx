import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatDateTime, type AffectedAssignmentPreview, type AssignmentStatus } from '@service-center/shared';
import { api } from '../../lib/api';
import { Button, ErrorNotice } from '../ui';

export interface AffectedCommitmentsProps {
  rows: readonly AffectedAssignmentPreview[];
  /** Only for your own requests; a scheduler or helper cannot decline for you here. */
  canDecline: boolean;
  onChanged: () => Promise<void> | void;
}

interface AffectedAssignmentGroup {
  assignmentId: string;
  planTitle: string;
  role: string;
  status: AssignmentStatus;
  times: AffectedAssignmentPreview[];
}

/**
 * F03 Pass A: the commitments a blockout overlaps, each with its own explicit
 * decline. Saving the blockout never changes an answer by itself.
 */
export const AffectedCommitments = ({ rows, canDecline, onChanged }: AffectedCommitmentsProps) => {
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const byAssignment = new Map<string, AffectedAssignmentGroup>();
    for (const row of rows) {
      const group = byAssignment.get(row.assignment_id) ?? {
        assignmentId: row.assignment_id,
        planTitle: row.plan_title,
        role: [row.team_name, row.position_name].filter(Boolean).join(' · '),
        status: row.assignment_status,
        times: [],
      };
      group.times.push(row);
      byAssignment.set(row.assignment_id, group);
    }
    return [...byAssignment.values()];
  }, [rows]);

  const decline = useMutation({
    mutationFn: (group: AffectedAssignmentGroup) =>
      api.respondToAssignment(group.assignmentId, { status: 'declined', expected_status: group.status }),
    onSuccess: async (_result, group) => {
      setDeclined((current) => new Set(current).add(group.assignmentId));
      await onChanged();
    },
  });

  if (groups.length === 0) return <p className="mt-2 text-slate-500">No existing commitments are affected.</p>;

  return (
    <div className="mt-3">
      <p className="text-slate-600">
        {groups.length === 1 ? 'This overlaps 1 existing commitment.' : `This overlaps ${groups.length} existing commitments.`}{' '}
        Saving won’t change {groups.length === 1 ? 'its answer' : 'their answers'}
        {canDecline ? '; decline any you can no longer do.' : '.'}
      </p>
      <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {groups.map((group) => {
          const isDeclined = declined.has(group.assignmentId) || group.status === 'declined';
          return (
            <li key={group.assignmentId} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{group.planTitle}</p>
                <p className="text-xs text-slate-500">
                  {[group.role, ...group.times.map((time) => `${time.time_name ?? 'Time'} ${formatDateTime(time.starts_at)}`)]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-xs text-slate-500">{isDeclined ? 'Declined' : group.status === 'confirmed' ? 'Confirmed' : 'Awaiting your answer'}</span>
              {canDecline && !isDeclined && (
                <Button
                  variant="secondary"
                  className="text-rose-600"
                  loading={decline.isPending && decline.variables?.assignmentId === group.assignmentId}
                  onClick={() => decline.mutate(group)}
                >
                  {group.status === 'confirmed' ? 'Withdraw' : 'Decline'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <ErrorNotice error={decline.error} />
    </div>
  );
};
