import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  formatDateTime,
  type AttendanceSheet,
  type AttendanceSheetRow,
  type AttendanceStatus,
  type PlanDetail,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, ErrorNotice, Loading, Modal } from '../ui';
import { assignmentTone } from '../../lib/format';

export interface AttendanceTabProps {
  plan: PlanDetail;
}

const STATUS_LABELS: Record<AttendanceStatus, string> = { present: 'Present', absent: 'Absent', unknown: 'Unknown' };
const STATUS_TONES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  absent: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
const RESPONSE_LABELS = { confirmed: 'Confirmed', unconfirmed: 'Pending', declined: 'Declined' } as const;

/** Unsaved choices, by Person. */
type Draft = Record<string, AttendanceStatus>;

const newKey = (): string => crypto.randomUUID();

/**
 * F16: actual attendance at one plan time. One row per Person (several
 * positions show as several roles), separate from their answer. Changes are
 * reviewed and saved as one batch: all apply or none do.
 */
export const AttendanceTab = ({ plan }: AttendanceTabProps) => {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [timeId, setTimeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [historyFor, setHistoryFor] = useState<AttendanceSheetRow | null>(null);
  // One key per reviewed batch, so a retried save is answered with the first result.
  const [batchKey, setBatchKey] = useState(newKey);

  const sheet = useQuery({
    queryKey: keys.attendance(organizationId, plan.id, timeId),
    queryFn: () => api.attendanceSheet(plan.id, timeId ?? undefined),
  });
  const data = sheet.data;
  useEffect(() => {
    setDraft({});
    setBatchKey(newKey());
  }, [data?.time.id]);

  const changes = useMemo(
    () =>
      (data?.rows ?? []).flatMap((row) => {
        const next = draft[row.person_id];
        if (!next || !row.mark_team_id || row.record?.status === next) return [];
        return [{ row, status: next }];
      }),
    [data, draft],
  );

  const save = useMutation({
    mutationFn: () =>
      api.recordAttendance(plan.id, {
        plan_time_id: data!.time.id,
        marks: changes.map(({ row, status }) => ({
          person_id: row.person_id,
          team_id: row.mark_team_id!,
          status,
          expected_revision: row.record?.revision ?? 0,
        })),
        reason: reason.trim() || null,
        idempotency_key: batchKey,
      }),
    onSuccess: async () => {
      setReviewing(false);
      setDraft({});
      setReason('');
      setBatchKey(newKey());
      await queryClient.invalidateQueries({ queryKey: keys.attendance(organizationId, plan.id, timeId) });
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'attendance_revision_stale';

  if (sheet.isLoading) return <Loading label="Loading attendance…" />;
  if (sheet.error) {
    return (
      <div className="space-y-3">
        <ErrorNotice error={sheet.error} />
        <Button variant="secondary" onClick={() => sheet.refetch()}>Try again</Button>
      </div>
    );
  }
  if (!data) return null;

  const setAll = (status: AttendanceStatus) =>
    setDraft(Object.fromEntries(data.rows.filter((row) => row.mark_team_id).map((row) => [row.person_id, status])));

  return (
    <section aria-labelledby="attendance-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="attendance-heading" className="text-base font-semibold text-slate-900 dark:text-white">Attendance</h2>
          <p className="text-sm text-slate-500">
            What actually happened. A confirmed answer is not attendance, and marking someone absent never changes their answer.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          Time
          <select
            className="input w-auto"
            value={data.time.id}
            onChange={(event) => setTimeId(event.target.value)}
            aria-label="Plan time"
          >
            {data.times.map((time) => (
              <option key={time.id} value={time.id}>
                {(time.name ?? (time.kind === 'service' ? 'Service' : 'Rehearsal')) + ' · ' + formatDateTime(time.starts_at)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <AttendanceCountsBar sheet={data} />

      {data.rows.length === 0 ? (
        <p className="card px-4 py-6 text-sm text-slate-500">
          Nobody with a released request is scheduled at this time{data.hidden_people ? ' on the teams you schedule' : ''}.
        </p>
      ) : (
        <>
          {data.can_mark_any && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="self-center text-slate-500">Mark everyone I can:</span>
              {(['present', 'absent', 'unknown'] as const).map((status) => (
                <Button key={status} variant="secondary" onClick={() => setAll(status)}>
                  {STATUS_LABELS[status]}
                </Button>
              ))}
              {changes.length > 0 && (
                <Button variant="ghost" onClick={() => setDraft({})}>Discard changes</Button>
              )}
            </div>
          )}
          <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
            {data.rows.map((row) => (
              <AttendanceRowView
                key={row.person_id}
                row={row}
                draft={draft[row.person_id]}
                onChange={(status) => setDraft((current) => ({ ...current, [row.person_id]: status }))}
                onHistory={() => setHistoryFor(row)}
              />
            ))}
          </ul>
        </>
      )}

      {data.hidden_people > 0 && (
        <p className="text-xs text-slate-500">
          {data.hidden_people} more {data.hidden_people === 1 ? 'person is' : 'people are'} scheduled on teams you do not schedule.
        </p>
      )}
      {data.orphaned_records.length > 0 && (
        <div className="text-xs text-slate-500">
          Kept from earlier (no longer scheduled at this time):{' '}
          {data.orphaned_records.map((record) => `${record.person_name} — ${STATUS_LABELS[record.status]}`).join(', ')}
        </div>
      )}

      {changes.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>{changes.length} unsaved {changes.length === 1 ? 'change' : 'changes'}</span>
          <Button onClick={() => setReviewing(true)}>Review and save</Button>
        </div>
      )}

      <Modal
        open={reviewing}
        title="Save attendance"
        onClose={() => setReviewing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)}>Back</Button>
            {stale ? (
              <Button
                onClick={async () => {
                  save.reset();
                  setReviewing(false);
                  setDraft({});
                  await sheet.refetch();
                }}
              >
                Reload attendance
              </Button>
            ) : (
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                Save {changes.length} {changes.length === 1 ? 'change' : 'changes'}
              </Button>
            )}
          </>
        }
      >
        <ul className="mb-3 space-y-1 text-sm">
          {changes.map(({ row, status }) => (
            <li key={row.person_id}>
              {row.person_name}: {row.record ? `${STATUS_LABELS[row.record.status]} → ` : ''}
              <strong>{STATUS_LABELS[status]}</strong>
            </li>
          ))}
        </ul>
        <label className="field">
          Reason (optional; kept in the history)
          <input className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className="mt-2 text-xs text-slate-500">All changes save together, or none do.</p>
        {stale ? (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Someone else changed attendance for this time. Nothing was saved — reload to see their changes.
          </p>
        ) : (
          <div className="mt-3"><ErrorNotice error={save.error} /></div>
        )}
      </Modal>

      {historyFor && <AttendanceHistoryModal planId={plan.id} timeId={data.time.id} row={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  );
};

const AttendanceCountsBar = ({ sheet }: { sheet: AttendanceSheet }) => (
  <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
    {(
      [
        ['Scheduled people', sheet.counts.scheduled_people],
        ['Present', sheet.counts.present],
        ['Absent', sheet.counts.absent],
        ['Unknown', sheet.counts.unknown],
        ['Not marked', sheet.counts.unmarked],
      ] as const
    ).map(([label, value]) => (
      <div key={label} className="card px-3 py-2">
        <dt className="text-xs text-slate-500">{label}</dt>
        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      </div>
    ))}
  </dl>
);

interface AttendanceRowViewProps {
  row: AttendanceSheetRow;
  draft: AttendanceStatus | undefined;
  onChange: (status: AttendanceStatus) => void;
  onHistory: () => void;
}

const AttendanceRowView = ({ row, draft, onChange, onHistory }: AttendanceRowViewProps) => {
  const current = draft ?? row.record?.status ?? null;
  const changed = draft !== undefined && draft !== row.record?.status;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-white">
          {row.person_name}
          {row.archived && <span className="ml-2 text-xs text-slate-400">(archived)</span>}
        </p>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
          {row.roles.map((role) => (
            <li key={role.assignment_id} className="flex items-center gap-1">
              {role.team_name}
              {role.position_name ? ` · ${role.position_name}` : ''}
              <Badge tone={assignmentTone[role.response]}>{RESPONSE_LABELS[role.response]}</Badge>
            </li>
          ))}
        </ul>
        {row.record && (
          <p className="mt-1 text-xs text-slate-400">
            Recorded {STATUS_LABELS[row.record.status].toLowerCase()} by {row.record.marked_by_name ?? 'someone'} ·{' '}
            {formatDateTime(row.record.marked_at)} ·{' '}
            <button type="button" className="underline" onClick={onHistory}>History</button>
          </p>
        )}
      </div>
      {row.mark_team_id ? (
        <div role="radiogroup" aria-label={`Attendance for ${row.person_name}`} className="flex gap-1">
          {(['present', 'absent', 'unknown'] as const).map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={current === status}
              onClick={() => onChange(status)}
              className={`min-h-9 rounded-lg px-3 text-sm ring-1 ring-inset transition ${
                current === status ? STATUS_TONES[status] + ' font-semibold' : 'text-slate-600 ring-slate-300 hover:bg-slate-50'
              }`}
            >
              {STATUS_LABELS[status]}
            </button>
          ))}
          {changed && <span className="sr-only">Unsaved</span>}
        </div>
      ) : row.record ? (
        <Badge tone={STATUS_TONES[row.record.status]}>{STATUS_LABELS[row.record.status]}</Badge>
      ) : (
        <span className="text-xs text-slate-400">Not marked</span>
      )}
    </li>
  );
};

interface AttendanceHistoryModalProps {
  planId: string;
  timeId: string;
  row: AttendanceSheetRow;
  onClose: () => void;
}

const AttendanceHistoryModal = ({ planId, timeId, row, onClose }: AttendanceHistoryModalProps) => {
  const { organizationId } = useAuth();
  const history = useQuery({
    queryKey: keys.attendanceHistory(organizationId, planId, timeId, row.person_id),
    queryFn: () => api.attendanceHistory(planId, timeId, row.person_id),
  });
  return (
    <Modal open title={`Attendance history — ${row.person_name}`} onClose={onClose}>
      {history.isLoading ? (
        <Loading />
      ) : history.error ? (
        <ErrorNotice error={history.error} />
      ) : (
        <ol className="space-y-2 text-sm">
          {(history.data ?? []).map((event) => (
            <li key={event.id}>
              <strong>{event.previous_status ? `${STATUS_LABELS[event.previous_status]} → ` : ''}{STATUS_LABELS[event.status]}</strong>{' '}
              by {event.actor_name ?? 'someone'}{event.team_name ? ` (${event.team_name})` : ''} · {formatDateTime(event.occurred_at)}
              {event.reason && <p className="text-xs text-slate-500">“{event.reason}”</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
};
