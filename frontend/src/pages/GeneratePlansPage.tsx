import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  generationProblemText,
  ApiError,
  LocalizedError,
  MAX_GENERATED_PLANS,
  PLAN_TEMPLATE_COMPONENTS,
  type AmbiguousTimeChoice,
  type AttendanceConflict,
  type GenerationDateEdit,
  type PlanGenerationPreview,
  type PlanGenerationResult,
  type PlanSeriesRequest,
  type PlanTemplateComponent,
} from '@service-center/shared';
import { api } from '../lib/api';
import { useInvalidateOrg, usePeople, usePlanTemplates } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters, useStructuredText } from '../i18n';
import { Badge, Button, DateTile, EmptyState, ErrorNotice, PageHeader, SectionHeader } from '../components/ui';
import { Icon } from '../components/icons';
import { ConflictList } from '../components/plan/attendance';
import { TemplateApplyReview } from '../components/templates/TemplateApplyReview';

const WARN_TONE = 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300';

/** Next Sunday as a local `YYYY-MM-DD` (the form's starting suggestion). */
const nextSunday = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7 || 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * F10: prepare several upcoming services from one template revision. The
 * dates are local calendar dates in the organization's timezone; every
 * proposed plan, time and skipped date is reviewed before anything is
 * created, and the whole batch is created in one transaction.
 */
export const GeneratePlansPage = () => {
  const { t } = useTranslation(['templates', 'common']);
  const fmt = useFormatters();
  const structured = useStructuredText();
  const { canAnywhere, can } = useAuth();
  const invalidate = useInvalidateOrg();
  const people = usePeople();
  const templates = usePlanTemplates({ kind: 'plan' }, canAnywhere('plans.edit'));
  const [templateId, setTemplateId] = useState('');
  const [startDate, setStartDate] = useState(nextSunday);
  const [count, setCount] = useState(4);
  const [intervalWeeks, setIntervalWeeks] = useState(1);
  const [endDate, setEndDate] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [excludeInput, setExcludeInput] = useState('');
  const [edits, setEdits] = useState<GenerationDateEdit[]>([]);
  const [components, setComponents] = useState<PlanTemplateComponent[]>(['items', 'needs', 'notes']);
  const [ambiguous, setAmbiguous] = useState<AmbiguousTimeChoice>('earlier');
  const [preview, setPreview] = useState<PlanGenerationPreview | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID());
  const [conflictReason, setConflictReason] = useState('');
  const [created, setCreated] = useState<PlanGenerationResult | null>(null);

  const template = templates.data?.find((candidate) => candidate.id === templateId);
  const series = (): PlanSeriesRequest => ({
    revision_id: template?.current_revision_id ?? '',
    components: components.filter((component) => component !== 'times'),
    start_date: startDate,
    interval_weeks: intervalWeeks,
    count,
    ...(endDate ? { end_date: endDate } : {}),
    excluded_dates: excluded,
    edits,
    ambiguous_time: ambiguous,
  });
  const invalidatePreview = () => {
    setPreview(null);
    setAttemptKey(crypto.randomUUID());
    // A new choice replaces any earlier stale or conflict outcome.
    generate.reset();
  };

  const review = useMutation({
    mutationFn: (request: PlanSeriesRequest) => api.previewPlanGeneration(request),
    onSuccess: (result) => {
      setPreview(result);
      setAttemptKey(crypto.randomUUID());
      generate.reset();
    },
  });
  const generate = useMutation({
    mutationFn: () => {
      if (!preview?.preview_hash) throw new LocalizedError({ key: 'templates:errors.reviewPlansFirst' });
      return api.generatePlans({
        ...series(),
        preview_hash: preview.preview_hash,
        idempotency_key: attemptKey,
        conflict_override_reason: conflictReason.trim() || null,
      });
    },
    onSuccess: async (result) => {
      setCreated(result);
      await invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'template_preview_changed') setPreview(null);
    },
  });

  // A per-date edit applies immediately and re-runs the review.
  const editDate = (edit: GenerationDateEdit) => {
    const next = [...edits.filter((existing) => existing.local_date !== edit.local_date), edit];
    setEdits(next);
    review.mutate({ ...series(), edits: next });
  };

  const conflicts: AttendanceConflict[] =
    generate.error instanceof ApiError && generate.error.code === 'scheduling_conflict'
      ? ((generate.error.details as AttendanceConflict[] | undefined) ?? [])
      : [];
  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');

  if (!canAnywhere('plans.edit')) {
    return <EmptyState icon="sparkle" title={t('generate.noAccess')} />;
  }

  if (created) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={created.replayed ? t('generate.replayedTitle') : t('generate.createdTitle')}
          subtitle={t('generate.createdSubtitle')}
          back={{ to: '/plans', label: t('common:nav.plans') }}
        />
        <ul className="space-y-3">
          {created.plans.map((plan) => (
            <li key={plan.id}>
              <Link to={`/plans/${plan.id}`} className="card card-interactive flex items-center gap-4 p-3 sm:p-4">
                <DateTile value={plan.service_date} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900 dark:text-white">{plan.title}</span>
                  <span className="mt-0.5 inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                    <Icon name="clock" className="size-3.5" />
                    {fmt.dateTime(plan.service_date)}
                  </span>
                </span>
                <Icon name="chevronRight" className="size-4 shrink-0 text-slate-300 dark:text-slate-600" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="plus" onClick={() => { setCreated(null); invalidatePreview(); setEdits([]); }}>{t('generate.createMore')}</Button>
          <Link to="/plans" className="button inline-flex h-9 items-center gap-1 rounded-xl px-3.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white">{t('generate.backToPlans')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('generate.title')}
        subtitle={t('generate.subtitle', { max: MAX_GENERATED_PLANS })}
        back={{ to: '/plans', label: t('common:nav.plans') }}
      />

      <div className="card space-y-5 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="gen-template">{t('generate.template')}</label>
            <select id="gen-template" className="input" value={templateId} onChange={(event) => { setTemplateId(event.target.value); invalidatePreview(); }}>
              <option value="">{t('generate.choose')}</option>
              {(templates.data ?? []).filter((candidate) => candidate.current_revision_id).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {t('generate.templateOption', {
                    name: candidate.name,
                    serviceType: candidate.service_type?.name ?? t('generate.noServiceType'),
                    revision: candidate.current_revision,
                  })}
                </option>
              ))}
            </select>
            {template && template.counts.times === 0 && (
              <p className="mt-1.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300"><Icon name="alert" className="mt-px size-3.5 shrink-0" />{t('generate.noTimesHint')}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="gen-start">{t('generate.firstDate')}</label>
            <input id="gen-start" type="date" className="input" value={startDate} onChange={(event) => { setStartDate(event.target.value); setEdits([]); invalidatePreview(); }} />
          </div>
          <div>
            <label className="label" htmlFor="gen-interval">{t('generate.repeat')}</label>
            <select id="gen-interval" className="input" value={intervalWeeks} onChange={(event) => { setIntervalWeeks(Number(event.target.value)); setEdits([]); invalidatePreview(); }}>
              <option value={1}>{t('generate.everyWeek')}</option>
              <option value={2}>{t('generate.everyNWeeks', { weeks: 2 })}</option>
              <option value={3}>{t('generate.everyNWeeks', { weeks: 3 })}</option>
              <option value={4}>{t('generate.everyNWeeks', { weeks: 4 })}</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="label" htmlFor="gen-count">{t('generate.howMany')}</label>
              <input id="gen-count" type="number" min={1} max={MAX_GENERATED_PLANS} className="input" value={count} onChange={(event) => { setCount(Math.min(MAX_GENERATED_PLANS, Math.max(1, Number(event.target.value)))); invalidatePreview(); }} />
            </div>
            <div className="min-w-0">
              <label className="label" htmlFor="gen-end">{t('generate.stopAfter')}</label>
              <input id="gen-end" type="date" className="input" value={endDate} onChange={(event) => { setEndDate(event.target.value); invalidatePreview(); }} />
            </div>
          </div>
        </div>

        <div className="border-t border-app-border pt-5">
          <span className="label">{t('generate.leaveOutHeading')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {excluded.map((date) => (
              <span key={date} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {fmt.calendarDate(date, 'medium')}
                <button type="button" className="grid size-5 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white" aria-label={t('generate.includeAgain', { date: fmt.calendarDate(date, 'medium') })} onClick={() => { setExcluded(excluded.filter((d) => d !== date)); invalidatePreview(); }}><Icon name="close" className="size-3" /></button>
              </span>
            ))}
            <input aria-label={t('generate.dateToLeaveOut')} type="date" className="input w-full sm:w-44" value={excludeInput} onChange={(event) => setExcludeInput(event.target.value)} />
            <Button variant="secondary" size="sm" icon="plus" disabled={!excludeInput || excluded.includes(excludeInput)} onClick={() => { setExcluded([...excluded, excludeInput].sort()); setExcludeInput(''); invalidatePreview(); }}>
              {t('generate.leaveOut')}
            </Button>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-x-4 gap-y-2 border-t border-app-border pt-5">
          <legend className="label">{t('generate.copyLegend')}</legend>
          {PLAN_TEMPLATE_COMPONENTS.filter((component) => component !== 'times').map((component) => (
            <label key={component} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
                checked={components.includes(component)}
                onChange={(event) => {
                  setComponents((current) => event.target.checked ? [...current, component] : current.filter((c) => c !== component));
                  invalidatePreview();
                }}
              />
              {t(`components.${component}`)}
            </label>
          ))}
        </fieldset>

        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          {t('generate.ambiguousLabel')}
          <select aria-label={t('generate.ambiguousAria')} className="input w-auto" value={ambiguous} onChange={(event) => { setAmbiguous(event.target.value as AmbiguousTimeChoice); invalidatePreview(); }}>
            <option value="earlier">{t('generate.ambiguousEarlier')}</option>
            <option value="later">{t('generate.ambiguousLater')}</option>
          </select>
        </label>

        <ErrorNotice error={review.error} />
        <div className="flex justify-end border-t border-app-border pt-4">
          <Button icon="sparkle" loading={review.isPending} disabled={!template} onClick={() => review.mutate(series())}>{t('generate.review')}</Button>
        </div>
      </div>

      {preview && (
        <section className="space-y-3">
          <SectionHeader
            title={t('generate.previewHeading', { count: preview.plans.length })}
            action={<span className="text-xs text-slate-500 dark:text-slate-400">{t('generate.timesIn', { timezone: preview.timezone })}</span>}
          />
          {preview.problems.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800 ring-1 ring-inset ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-500/30">
              {preview.problems.map((problem) => <li key={`${problem.local_date}-${problem.message}`}>{generationProblemText(problem, structured)}</li>)}
              <li className="font-medium">{t('generate.fixProblems')}</li>
            </ul>
          )}
          {preview.excluded.length > 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t('generate.leftOut', {
                dates: fmt.list(preview.excluded.map((date) =>
                  t(date.reason === 'excluded' ? 'generate.leftOutHoliday' : 'generate.leftOutSkipped', {
                    date: fmt.calendarDate(date.local_date, 'medium'),
                  }))),
              })}
            </p>
          )}
          {preview.problems.filter((problem) => edits.every((edit) => edit.local_date !== problem.local_date)).map((problem) => (
            <div key={`fix-${problem.local_date}`} className="card flex items-center justify-between gap-2 p-3 text-sm">
              <span className="font-medium text-slate-800 dark:text-slate-100">{fmt.calendarDate(problem.local_date, 'medium')}</span>
              <Button variant="secondary" size="sm" onClick={() => editDate({ local_date: problem.local_date, skip: true })}>{t('generate.skipThisDate')}</Button>
            </div>
          ))}
          <ul className="space-y-3">
            {preview.plans.map((plan) => {
              const edit = edits.find((candidate) => candidate.move_to === plan.local_date || candidate.local_date === plan.local_date);
              const seriesDate = edit?.local_date ?? plan.local_date;
              return (
                <li key={plan.local_date} className="card space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <input
                      aria-label={t('generate.titleFor', { date: fmt.calendarDate(plan.local_date, 'medium') })}
                      className="input w-full sm:w-64"
                      defaultValue={plan.title}
                      onBlur={(event) => {
                        const title = event.target.value.trim();
                        if (title && title !== plan.title) editDate({ ...edit, local_date: seriesDate, skip: false, title });
                      }}
                    />
                    <input
                      aria-label={t('generate.dateFor', { date: fmt.calendarDate(plan.local_date, 'medium') })}
                      type="date"
                      className="input w-full sm:w-44"
                      defaultValue={plan.local_date}
                      onBlur={(event) => {
                        const moveTo = event.target.value;
                        if (moveTo && moveTo !== plan.local_date) editDate({ ...edit, local_date: seriesDate, skip: false, move_to: moveTo });
                      }}
                    />
                    <span className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400"><Icon name="clock" className="size-3.5" />{fmt.dateTime(plan.service_date)}</span>
                    {plan.existing_plans.length > 0 && (
                      <Badge tone={WARN_TONE}>{t('generate.alreadyHas', { titles: fmt.list(plan.existing_plans.map((existing) => existing.title)) })}</Badge>
                    )}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => editDate({ local_date: seriesDate, skip: true })}>
                      {t('generate.skip')}
                    </Button>
                  </div>
                  <TemplateApplyReview preview={plan.preview} newPlan />
                </li>
              );
            })}
          </ul>

          {conflicts.length > 0 && (
            <>
              <ConflictList conflicts={conflicts} nameOf={nameOf} />
              {can('scheduling.override_conflicts', { serviceTypeId: preview.service_type_id }) ? (
                <input
                  aria-label={t('generate.conflictReasonLabel')}
                  className="input"
                  placeholder={t('generate.conflictReasonPlaceholder')}
                  maxLength={500}
                  value={conflictReason}
                  onChange={(event) => setConflictReason(event.target.value)}
                />
              ) : (
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('generate.noOverride')}</p>
              )}
            </>
          )}
          {conflicts.length === 0 && <ErrorNotice error={generate.error} />}
          {generate.error instanceof ApiError && generate.error.code === 'template_preview_changed' && (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300"><Icon name="alert" className="mt-0.5 size-4 shrink-0" />{t('generate.previewChanged')}</p>
          )}
          <div className="flex justify-end pt-2">
            <Button
              icon="check"
              loading={generate.isPending}
              disabled={!preview.preview_hash || preview.plans.length === 0 || preview.plans.some((plan) => plan.preview.blocking.length > 0)}
              onClick={() => generate.mutate()}
            >
              {t('generate.createButton', { count: preview.plans.length })}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};
