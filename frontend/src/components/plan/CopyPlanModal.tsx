import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError, type AttendanceConflict, type PlanDetail } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, usePeople } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Notice } from '../ui';
import { ConflictList } from './attendance';
import { classifyCopyPlanError, defaultCopyDate, fromDateTimeLocal, toDateTimeLocal } from './copyPlan';

export interface CopyPlanModalProps {
  plan: PlanDetail;
  onClose: () => void;
}

/** The form's fields, kept together so any change starts a new copy attempt. */
interface CopyPlanForm {
  date: string;
  title: string;
  copyPeople: boolean;
  conflictReason: string;
}

/**
 * "Copy plan": a new draft plan from this one in one server transaction —
 * the order of service, times (moved to the new date), needed positions and,
 * if asked, the scheduled people as fresh unconfirmed requests. Nobody is
 * notified until the copy is published (ADR-0006). One idempotency key per
 * attempt, so a retry after a dropped connection opens the same copy instead
 * of making a second one.
 */
export const CopyPlanModal = ({ plan, onClose }: CopyPlanModalProps) => {
  const { t } = useTranslation(['plans', 'common']);
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const { can } = useAuth();
  const [form, setForm] = useState<CopyPlanForm>(() => ({
    date: toDateTimeLocal(defaultCopyDate(plan.service_date, plan.service_type?.recurrence ?? 'weekly')),
    title: plan.title,
    copyPeople: false,
    conflictReason: '',
  }));
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const serviceDate = fromDateTimeLocal(form.date);
  const title = form.title.trim();

  const copy = useMutation({
    mutationFn: ({ key, date }: { key: string; date: string }) =>
      api.duplicatePlan(plan.id, {
        service_date: date,
        title,
        copy_assignments: form.copyPeople,
        idempotency_key: key,
        conflict_override_reason: form.conflictReason.trim() || null,
      }),
    onSuccess: async (created) => {
      await invalidate();
      onClose();
      navigate(`/plans/${created.id}`);
    },
  });

  const update = (changes: Partial<CopyPlanForm>) => {
    setForm((current) => ({ ...current, ...changes }));
    // Another request needs another key: the server refuses a key reused for different details.
    setAttemptKey(crypto.randomUUID());
    copy.reset();
  };

  const failure = copy.error ? classifyCopyPlanError(copy.error) : null;
  const conflicts: AttendanceConflict[] =
    failure === 'conflict' && copy.error instanceof ApiError
      ? ((copy.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const mayOverride = can('scheduling.override_conflicts', { serviceTypeId: plan.service_type_id });
  const people = usePeople({ enabled: conflicts.length > 0 });
  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');

  const invalid = !serviceDate || !title;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (invalid || copy.isPending) return;
    // The server refuses a key reused for other details; start a fresh attempt.
    const key = failure === 'reused' ? crypto.randomUUID() : attemptKey;
    if (key !== attemptKey) setAttemptKey(key);
    copy.mutate({ key, date: serviceDate });
  };

  const scheduled = plan.assignments.length;
  const copied = [
    t('copyPlan.copiesOrder', { count: plan.items.length }),
    t('copyPlan.copiesTimes', { count: plan.times.length }),
    t('copyPlan.copiesNeeds'),
    ...(plan.location ? [t('copyPlan.copiesLocation')] : []),
    ...(form.copyPeople ? [t('copyPlan.copiesPeople', { count: scheduled })] : []),
  ];

  return (
    <Modal open title={t('copyPlan.title')} onClose={onClose}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="copy-plan-date">{t('copyPlan.date')}</label>
            <input
              id="copy-plan-date"
              type="datetime-local"
              className="input"
              value={form.date}
              onChange={(event) => update({ date: event.target.value })}
              required
            />
            {!serviceDate && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t('copyPlan.dateRequired')}</p>}
          </div>
          <div>
            <label className="label" htmlFor="copy-plan-title">{t('copyPlan.planTitle')}</label>
            <input
              id="copy-plan-title"
              className="input"
              maxLength={200}
              value={form.title}
              onChange={(event) => update({ title: event.target.value })}
              required
            />
            {!title && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t('copyPlan.titleRequired')}</p>}
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-slate-300 dark:border-slate-700"
              checked={form.copyPeople}
              onChange={(event) => update({ copyPeople: event.target.checked })}
            />
            {t('copyPlan.copyPeople')}
          </label>
          <p className="mt-1 ml-6 text-xs text-slate-500 dark:text-slate-400">{t('copyPlan.copyPeopleHint')}</p>
        </div>

        <div className="surface-inset space-y-2 px-4 py-3 text-sm">
          <p className="font-medium text-slate-800 dark:text-slate-100">{t('copyPlan.willCopy')}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-slate-600 dark:text-slate-300">
            {copied.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('copyPlan.notCopied')}</p>
        </div>

        <Notice tone="info">{t('copyPlan.draftNote')}</Notice>

        {failure === 'conflict' ? (
          <>
            <ConflictList conflicts={conflicts} nameOf={nameOf} />
            {mayOverride ? (
              <input
                aria-label={t('copyPlan.conflictReasonLabel')}
                className="input"
                placeholder={t('copyPlan.conflictReasonPlaceholder')}
                maxLength={500}
                value={form.conflictReason}
                onChange={(event) => setForm((current) => ({ ...current, conflictReason: event.target.value }))}
              />
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('copyPlan.noOverride')}</p>
            )}
          </>
        ) : failure === 'permission' ? (
          <Notice tone="warning">{t('copyPlan.errors.permission')}</Notice>
        ) : failure === 'reused' ? (
          <Notice tone="warning">{t('copyPlan.errors.reused')}</Notice>
        ) : (
          copy.error && (
            <div className="space-y-1">
              <ErrorNotice error={copy.error} />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('copyPlan.errors.retrySafe')}</p>
            </div>
          )
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" loading={copy.isPending} disabled={invalid}>
            {t('copyPlan.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
