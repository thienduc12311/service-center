import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  ATTENDANCE_STATUSES,
  attendanceBatchFingerprint,
  attendanceChanges,
  markEveryoneAttendance,
  rebaseAttendanceDraft,
  recordAttendanceBody,
  setAttendanceMark,
  type AttendanceBatchResult,
  type AttendanceDraft,
  type AttendanceSheet,
  type AttendanceSheetRow,
  type AttendanceStatus,
  type PlanDetail,
  type SupersededAttendanceMark,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { keys } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Badge, Button, ErrorNotice, Loading, Modal } from '../ui';
import { assignmentTone } from '../../lib/format';
import { useFormatters } from '../../i18n';
import { timeKindLabel } from './attendance';

export interface AttendanceTabProps {
  plan: PlanDetail;
}

const STATUS_TONES: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  absent: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};
const RESPONSE_KEYS = {
  confirmed: 'responses.confirmed',
  unconfirmed: 'responses.pending',
  declined: 'responses.declined',
} as const;

/** The idempotency key of the batch being saved, and the content it was minted for. */
interface BatchKey {
  fingerprint: string;
  key: string;
}

/**
 * F16: actual attendance at one plan time. One row per Person (several
 * positions show as several roles), separate from their answer. Changes are
 * reviewed and saved as one batch: all apply or none do.
 */
export const AttendanceTab = ({ plan }: AttendanceTabProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const formatters = useFormatters();
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [timeId, setTimeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [historyFor, setHistoryFor] = useState<AttendanceSheetRow | null>(null);
  // One key per batch content, so a retried save is answered with the first result
  // and a different batch never reuses a key (shared `attendanceBatchFingerprint`).
  const batchKey = useRef<BatchKey | null>(null);
  // Choices dropped after a stale refusal because someone else changed those records.
  const [superseded, setSuperseded] = useState<SupersededAttendanceMark[] | null>(null);
  const [saved, setSaved] = useState<AttendanceBatchResult | null>(null);

  const sheet = useQuery({
    queryKey: keys.attendance(organizationId, plan.id, timeId),
    queryFn: () => api.attendanceSheet(plan.id, timeId ?? undefined),
  });
  const data = sheet.data;
  useEffect(() => {
    setDraft({});
    setSuperseded(null);
    setSaved(null);
  }, [data?.time.id]);

  const changes = useMemo(() => (data ? attendanceChanges(data, draft) : []), [data, draft]);

  const save = useMutation({
    mutationFn: () => {
      const fingerprint = attendanceBatchFingerprint(data!.time.id, changes, reason);
      if (batchKey.current?.fingerprint !== fingerprint) batchKey.current = { fingerprint, key: crypto.randomUUID() };
      return api.recordAttendance(plan.id, recordAttendanceBody(data!.time.id, changes, reason, batchKey.current.key));
    },
    onSuccess: async (result) => {
      setReviewing(false);
      setDraft({});
      setReason('');
      setSuperseded(null);
      setSaved(result);
      batchKey.current = null;
      await queryClient.invalidateQueries({ queryKey: keys.attendance(organizationId, plan.id, timeId) });
    },
  });
  const stale = save.error instanceof ApiError && save.error.code === 'attendance_revision_stale';
  // No answer: the batch may have landed. Saving again replays the same key.
  const uncertain = save.isError && !(save.error instanceof ApiError && save.error.status < 500);

  const reloadAfterStale = async () => {
    save.reset();
    setReviewing(false);
    const latest = await sheet.refetch();
    if (!latest.data) return;
    const rebased = rebaseAttendanceDraft(latest.data, draft);
    setDraft(rebased.draft);
    setSuperseded(rebased.superseded);
  };

  if (sheet.isLoading) return <Loading label={t('attendance.loading')} />;
  if (sheet.error) {
    return (
      <div className="space-y-3">
        <ErrorNotice error={sheet.error} />
        <Button variant="secondary" onClick={() => sheet.refetch()}>{t('common:actions.retry')}</Button>
      </div>
    );
  }
  if (!data) return null;

  const setAll = (status: AttendanceStatus) => setDraft((current) => markEveryoneAttendance(data, current, status));

  return (
    <section aria-labelledby="attendance-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="attendance-heading" className="text-base font-semibold text-slate-900 dark:text-white">{t('attendance.title')}</h2>
          <p className="text-sm text-slate-500">{t('attendance.intro')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('attendance.time')}
          <select
            className="input w-auto"
            value={data.time.id}
            onChange={(event) => setTimeId(event.target.value)}
            aria-label={t('attendance.planTime')}
          >
            {data.times.map((time) => (
              <option key={time.id} value={time.id}>
                {t('attendance.timeOption', { name: time.name ?? timeKindLabel(time.kind), time: formatters.dateTime(time.starts_at) })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <AttendanceCountsBar sheet={data} />

      {data.rows.length === 0 ? (
        <p className="card px-4 py-6 text-sm text-slate-500">
          {data.hidden_people ? t('attendance.nobodyOnYourTeams') : t('attendance.nobody')}
        </p>
      ) : (
        <>
          {data.can_mark_any && (
            <div className="flex flex-wrap gap-2 text-sm">
              <span className="self-center text-slate-500">{t('attendance.markEveryone')}</span>
              {ATTENDANCE_STATUSES.map((status) => (
                <Button key={status} variant="secondary" onClick={() => setAll(status)}>
                  {t(`attendance.status.${status}`)}
                </Button>
              ))}
              {changes.length > 0 && (
                <Button variant="ghost" onClick={() => setDraft({})}>{t('attendance.discardChanges')}</Button>
              )}
            </div>
          )}
          <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
            {data.rows.map((row) => (
              <AttendanceRowView
                key={row.person_id}
                row={row}
                draft={draft[row.person_id]?.status}
                onChange={(status) => {
                  setSaved(null);
                  setDraft((current) => setAttendanceMark(current, row, status));
                }}
                onHistory={() => setHistoryFor(row)}
              />
            ))}
          </ul>
        </>
      )}

      {data.hidden_people > 0 && (
        <p className="text-xs text-slate-500">{t('attendance.hiddenPeople', { count: data.hidden_people })}</p>
      )}
      {data.orphaned_records.length > 0 && (
        <div className="text-xs text-slate-500">
          {t('attendance.orphaned', {
            list: formatters.list(
              data.orphaned_records.map((record) =>
                t('attendance.personStatus', { name: record.person_name, status: t(`attendance.status.${record.status}`) }),
              ),
            ),
          })}
        </div>
      )}

      {superseded && (
        <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p>{t('attendance.staleKept')}</p>
          {superseded.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {superseded.map((mark) => (
                <li key={mark.personId}>{supersededText(t, mark)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700">
          {saved.replayed ? t('attendance.savedReplayed') : t('attendance.saved', { count: saved.applied })}
        </p>
      )}

      {changes.length > 0 && (
        <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>{t('attendance.unsavedChanges', { count: changes.length })}</span>
          <Button onClick={() => setReviewing(true)}>{t('attendance.reviewAndSave')}</Button>
        </div>
      )}

      <Modal
        open={reviewing}
        title={t('attendance.saveTitle')}
        onClose={() => setReviewing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReviewing(false)}>{t('common:actions.back')}</Button>
            {stale ? (
              <Button onClick={() => void reloadAfterStale()}>{t('attendance.reload')}</Button>
            ) : (
              <Button loading={save.isPending} onClick={() => save.mutate()}>
                {uncertain ? t('attendance.tryAgain') : t('attendance.saveChanges', { count: changes.length })}
              </Button>
            )}
          </>
        }
      >
        <ul className="mb-3 space-y-1 text-sm">
          {changes.map(({ row, status }) => (
            <li key={row.person_id}>
              {row.record
                ? t('attendance.changeFrom', { name: row.person_name, from: t(`attendance.status.${row.record.status}`) })
                : t('attendance.changeNew', { name: row.person_name })}{' '}
              <strong>{t(`attendance.status.${status}`)}</strong>
            </li>
          ))}
        </ul>
        <label className="field">
          {t('attendance.reason')}
          <input className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <p className="mt-2 text-xs text-slate-500">{t('attendance.allOrNothing')}</p>
        {stale ? (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('attendance.stale')}
          </p>
        ) : uncertain ? (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('attendance.uncertain')}
          </p>
        ) : (
          <div className="mt-3"><ErrorNotice error={save.error} /></div>
        )}
      </Modal>

      {historyFor && <AttendanceHistoryModal planId={plan.id} timeId={data.time.id} row={historyFor} onClose={() => setHistoryFor(null)} />}
    </section>
  );
};

/** "Sam: you chose Present; now Absent (by Jordan)" — one choice dropped after a stale refusal. */
const supersededText = (t: TFunction<['reports', 'common']>, mark: SupersededAttendanceMark): string => {
  const mine = t(`attendance.status.${mark.mine}`);
  if (mark.removed) return t('attendance.supersededRemoved', { name: mark.personName, mine });
  if (!mark.saved) return t('attendance.supersededNew', { name: mark.personName, mine });
  return t('attendance.superseded', {
    name: mark.personName,
    mine,
    saved: t(`attendance.status.${mark.saved}`),
    by: mark.savedBy ?? t('attendance.someone'),
  });
};

interface AttendanceCountsBarProps {
  sheet: AttendanceSheet;
}

const AttendanceCountsBar = ({ sheet }: AttendanceCountsBarProps) => {
  const { t } = useTranslation('reports');
  const formatters = useFormatters();
  return (
    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
      {(
        [
          ['scheduledPeople', sheet.counts.scheduled_people],
          ['present', sheet.counts.present],
          ['absent', sheet.counts.absent],
          ['unknown', sheet.counts.unknown],
          ['notMarked', sheet.counts.unmarked],
        ] as const
      ).map(([key, value]) => (
        <div key={key} className="card px-3 py-2">
          <dt className="text-xs text-slate-500">{t(`attendance.counts.${key}`)}</dt>
          <dd className="text-lg font-semibold tabular-nums">{formatters.number(value)}</dd>
        </div>
      ))}
    </dl>
  );
};

interface AttendanceRowViewProps {
  row: AttendanceSheetRow;
  draft: AttendanceStatus | undefined;
  onChange: (status: AttendanceStatus) => void;
  onHistory: () => void;
}

const AttendanceRowView = ({ row, draft, onChange, onHistory }: AttendanceRowViewProps) => {
  const { t } = useTranslation('reports');
  const formatters = useFormatters();
  const current = draft ?? row.record?.status ?? null;
  const changed = draft !== undefined && draft !== row.record?.status;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-white">
          {row.person_name}
          {row.archived && <span className="ml-2 text-xs text-slate-400">{t('attendance.archived')}</span>}
        </p>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
          {row.roles.map((role) => (
            <li key={role.assignment_id} className="flex items-center gap-1">
              {role.team_name}
              {role.position_name ? ` · ${role.position_name}` : ''}
              <Badge tone={assignmentTone[role.response]}>{t(RESPONSE_KEYS[role.response])}</Badge>
            </li>
          ))}
        </ul>
        {row.record && (
          <p className="mt-1 text-xs text-slate-400">
            {t(`attendance.recorded.${row.record.status}`, {
              name: row.record.marked_by_name ?? t('attendance.someone'),
              time: formatters.dateTime(row.record.marked_at),
            })}{' '}
            ·{' '}
            <button type="button" className="underline" onClick={onHistory}>{t('attendance.history')}</button>
          </p>
        )}
      </div>
      {row.mark_team_id ? (
        <div role="radiogroup" aria-label={t('attendance.rowLabel', { name: row.person_name })} className="flex gap-1">
          {ATTENDANCE_STATUSES.map((status) => (
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
              {t(`attendance.status.${status}`)}
            </button>
          ))}
          {changed && <span className="sr-only">{t('attendance.unsaved')}</span>}
        </div>
      ) : row.record ? (
        <Badge tone={STATUS_TONES[row.record.status]}>{t(`attendance.status.${row.record.status}`)}</Badge>
      ) : (
        <span className="text-xs text-slate-400">{t('attendance.counts.notMarked')}</span>
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
  const { t } = useTranslation('reports');
  const formatters = useFormatters();
  const { organizationId } = useAuth();
  const history = useQuery({
    queryKey: keys.attendanceHistory(organizationId, planId, timeId, row.person_id),
    queryFn: () => api.attendanceHistory(planId, timeId, row.person_id),
  });
  return (
    <Modal open title={t('attendance.historyTitle', { name: row.person_name })} onClose={onClose}>
      {history.isLoading ? (
        <Loading />
      ) : history.error ? (
        <ErrorNotice error={history.error} />
      ) : (
        <ol className="space-y-2 text-sm">
          {(history.data ?? []).map((event) => (
            <li key={event.id}>
              <strong>
                {event.previous_status
                  ? t('attendance.transition', {
                      from: t(`attendance.status.${event.previous_status}`),
                      to: t(`attendance.status.${event.status}`),
                    })
                  : t(`attendance.status.${event.status}`)}
              </strong>{' '}
              {event.team_name
                ? t('attendance.byWithTeam', {
                    name: event.actor_name ?? t('attendance.someone'),
                    team: event.team_name,
                    time: formatters.dateTime(event.occurred_at),
                  })
                : t('attendance.by', { name: event.actor_name ?? t('attendance.someone'), time: formatters.dateTime(event.occurred_at) })}
              {event.reason && <p className="text-xs text-slate-500">“{event.reason}”</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
};
