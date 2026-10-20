import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  type AssignmentDetail,
  type AttendanceConflict,
  type PlanDetail,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal } from '../ui';
import { ConflictList, isScopeComplete, TimeScopePicker, type TimeScope } from './attendance';

export interface AssignmentTimesModalProps {
  plan: PlanDetail;
  /** The request being edited; null closes the dialog. */
  assignment: AssignmentDetail | null;
  onClose: () => void;
}

const scopeOf = (assignment: AssignmentDetail): TimeScope =>
  assignment.attendance_mode === 'selected'
    ? { mode: 'selected', timeIds: assignment.attendance_times.map((time) => time.plan_time_id) }
    : { mode: 'all', timeIds: [] };

const sameScope = (a: TimeScope, b: TimeScope): boolean =>
  a.mode === b.mode && [...a.timeIds].sort().join() === [...b.timeIds].sort().join();

/**
 * F04: which times one request covers. Saving uses the request revision this
 * dialog opened with, so a change made elsewhere meanwhile is refused instead
 * of overwritten; a released request whose times change is sent again.
 */
export const AssignmentTimesModal = ({ plan, assignment, onClose }: AssignmentTimesModalProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const invalidate = useInvalidateOrg();
  const { can, organizationId } = useAuth();
  const [editing, setEditing] = useState<string | null>(null);
  const [scope, setScope] = useState<TimeScope>({ mode: 'all', timeIds: [] });
  const [reason, setReason] = useState('');
  const [commitConflicts, setCommitConflicts] = useState<AttendanceConflict[] | null>(null);

  // Reset whenever a different request (or a newer revision of it) is opened.
  const openKey = assignment ? `${assignment.id}:${assignment.request_revision}` : null;
  if (openKey !== editing) {
    setEditing(openKey);
    if (assignment) setScope(scopeOf(assignment));
    setReason('');
    setCommitConflicts(null);
  }

  const name = assignment?.person?.full_name ?? t('assignmentTimes.thisPerson');
  const changed = assignment ? !sameScope(scope, scopeOf(assignment)) : false;

  const check = useQuery({
    queryKey: keys.conflictCheck(organizationId, {
      assignment: assignment?.id,
      mode: scope.mode,
      time_ids: [...scope.timeIds].sort(),
    }),
    queryFn: () =>
      api.checkAssignmentConflicts({
        candidates: [{
          key: assignment!.id,
          person_id: assignment!.person_id,
          plan_id: plan.id,
          team_id: assignment!.team_id,
          position_id: assignment!.position_id,
          attendance_mode: scope.mode,
          time_ids: scope.mode === 'selected' ? scope.timeIds : [],
        }],
        exclude_assignment_ids: [assignment!.id],
      }),
    enabled: Boolean(assignment) && changed && isScopeComplete(scope) && assignment?.status !== 'declined',
  });
  const conflicts = commitConflicts ?? (changed ? check.data?.conflicts ?? [] : []);
  const blocking = conflicts.filter((conflict) => conflict.severity === 'blocking');
  const mayOverride =
    Boolean(assignment) &&
    can('scheduling.override_conflicts', { serviceTypeId: plan.service_type_id, teamId: assignment?.team_id }) &&
    (commitConflicts !== null || check.data?.override_permitted !== false);

  const save = useMutation({
    mutationFn: () =>
      api.setAssignmentAttendance(plan.id, {
        changes: [{
          assignment_id: assignment!.id,
          expected_request_revision: assignment!.request_revision,
          attendance_mode: scope.mode,
          time_ids: scope.mode === 'selected' ? scope.timeIds : [],
        }],
        conflict_override_reason: blocking.length > 0 ? reason.trim() || null : null,
        notify: true,
      }),
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'scheduling_conflict') {
        setCommitConflicts((error.details as AttendanceConflict[] | undefined) ?? []);
      }
    },
  });

  const stale = save.error instanceof ApiError && save.error.code === 'assignment_revision_stale';

  return (
    <Modal open={Boolean(assignment)} title={t('assignmentTimes.title', { name })} onClose={onClose}>
      {assignment && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {assignment.position
              ? t('common:format.teamPosition', { team: assignment.team?.name ?? t('common:fallback.team'), position: assignment.position.name })
              : assignment.team?.name ?? t('common:fallback.team')}
          </p>
          {assignment.visibility === 'released' && assignment.status !== 'declined' && (
            <p className="text-sm text-slate-500">{t('assignmentTimes.resendHint')}</p>
          )}
          <TimeScopePicker
            idPrefix={`assignment-${assignment.id}`}
            times={plan.times}
            value={scope}
            onChange={(next) => {
              setCommitConflicts(null);
              setScope(next);
            }}
          />
          {conflicts.length > 0 && <ConflictList conflicts={conflicts} nameOf={() => name} />}
          {blocking.length > 0 && (mayOverride ? (
            <input
              aria-label={t('assignmentTimes.reasonLabel')}
              className="input"
              placeholder={t('assignmentTimes.reasonPlaceholder')}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : (
            <p className="text-xs text-slate-500">{t('assignmentTimes.cannotOverride')}</p>
          ))}
          {stale ? (
            <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-600/20">
              {t('assignmentTimes.stale')}
            </p>
          ) : (
            save.error && !(save.error instanceof ApiError && save.error.code === 'scheduling_conflict') && (
              <ErrorNotice error={save.error} />
            )
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={
                !changed || stale || !isScopeComplete(scope) || (blocking.length > 0 && (!mayOverride || !reason.trim()))
              }
              onClick={() => save.mutate()}
            >
              {blocking.length > 0 ? t('assignmentTimes.saveAnyway') : t('assignmentTimes.save')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};
