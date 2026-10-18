import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ApiError,
  MAX_GENERATED_PLANS,
  PLAN_TEMPLATE_COMPONENTS,
  TEMPLATE_COMPONENT_LABELS,
  formatDateTime,
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
import { Badge, Button, EmptyState, ErrorNotice, PageHeader } from '../components/ui';
import { ConflictList } from '../components/plan/attendance';
import { TemplateApplyReview } from '../components/templates/TemplateApplyReview';

const WARN_TONE = 'bg-amber-50 text-amber-700 ring-amber-600/20';

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
  };

  const review = useMutation({
    mutationFn: (request: PlanSeriesRequest) => api.previewPlanGeneration(request),
    onSuccess: (result) => {
      setPreview(result);
      setAttemptKey(crypto.randomUUID());
    },
  });
  const generate = useMutation({
    mutationFn: () => {
      if (!preview?.preview_hash) throw new Error('Review the plans first');
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
    people.data?.find((person) => person.person_id === personId)?.full_name ?? 'Someone';

  if (!canAnywhere('plans.edit')) {
    return <EmptyState title="Creating plans is for plan editors" />;
  }

  if (created) {
    return (
      <div>
        <PageHeader title={created.replayed ? 'Plans already created' : 'Plans created'} subtitle="Draft plans with prepared requests; nobody has been notified." />
        <ul className="space-y-2">
          {created.plans.map((plan) => (
            <li key={plan.id} className="card p-3">
              <Link to={`/plans/${plan.id}`} className="font-medium text-brand-700 hover:underline">{plan.title}</Link>
              <span className="ml-2 text-sm text-slate-500">{formatDateTime(plan.service_date)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => { setCreated(null); invalidatePreview(); setEdits([]); }}>Create more</Button>
          <Link to="/plans" className="button inline-flex items-center px-3.5 py-2 text-sm font-medium text-slate-600">Back to plans</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Create plans from a template"
        subtitle={`Prepare up to ${MAX_GENERATED_PLANS} upcoming services at once. Dates and times follow your organization’s local clock.`}
      />

      <div className="card space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="gen-template">Template</label>
            <select id="gen-template" className="input" value={templateId} onChange={(event) => { setTemplateId(event.target.value); invalidatePreview(); }}>
              <option value="">Choose…</option>
              {(templates.data ?? []).filter((candidate) => candidate.current_revision_id).map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.service_type?.name ?? 'No service type'} · rev {candidate.current_revision}
                </option>
              ))}
            </select>
            {template && template.counts.times === 0 && (
              <p className="mt-1 text-xs text-amber-700">This template has no times; each plan is dated at local noon.</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="gen-start">First date</label>
            <input id="gen-start" type="date" className="input" value={startDate} onChange={(event) => { setStartDate(event.target.value); setEdits([]); invalidatePreview(); }} />
          </div>
          <div>
            <label className="label" htmlFor="gen-interval">Repeat</label>
            <select id="gen-interval" className="input" value={intervalWeeks} onChange={(event) => { setIntervalWeeks(Number(event.target.value)); setEdits([]); invalidatePreview(); }}>
              <option value={1}>Every week</option>
              <option value={2}>Every 2 weeks</option>
              <option value={3}>Every 3 weeks</option>
              <option value={4}>Every 4 weeks</option>
            </select>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="label" htmlFor="gen-count">How many plans</label>
              <input id="gen-count" type="number" min={1} max={MAX_GENERATED_PLANS} className="input" value={count} onChange={(event) => { setCount(Math.min(MAX_GENERATED_PLANS, Math.max(1, Number(event.target.value)))); invalidatePreview(); }} />
            </div>
            <div className="flex-1">
              <label className="label" htmlFor="gen-end">Stop after (optional)</label>
              <input id="gen-end" type="date" className="input" value={endDate} onChange={(event) => { setEndDate(event.target.value); invalidatePreview(); }} />
            </div>
          </div>
        </div>

        <div>
          <span className="label">Holidays and dates to leave out</span>
          <div className="flex flex-wrap items-center gap-2">
            {excluded.map((date) => (
              <span key={date} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">
                {date}
                <button type="button" aria-label={`Include ${date} again`} onClick={() => { setExcluded(excluded.filter((d) => d !== date)); invalidatePreview(); }}>×</button>
              </span>
            ))}
            <input aria-label="Date to leave out" type="date" className="input w-44" value={excludeInput} onChange={(event) => setExcludeInput(event.target.value)} />
            <Button variant="secondary" className="!py-1 text-xs" disabled={!excludeInput || excluded.includes(excludeInput)} onClick={() => { setExcluded([...excluded, excludeInput].sort()); setExcludeInput(''); invalidatePreview(); }}>
              Leave out
            </Button>
          </div>
        </div>

        <fieldset className="flex flex-wrap gap-4">
          <legend className="label">Copy into each plan (times are always created)</legend>
          {PLAN_TEMPLATE_COMPONENTS.filter((component) => component !== 'times').map((component) => (
            <label key={component} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-slate-300"
                checked={components.includes(component)}
                onChange={(event) => {
                  setComponents((current) => event.target.checked ? [...current, component] : current.filter((c) => c !== component));
                  invalidatePreview();
                }}
              />
              {TEMPLATE_COMPONENT_LABELS[component]}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          If a time happens twice when clocks go back, use the
          <select aria-label="Repeated time choice" className="input w-auto" value={ambiguous} onChange={(event) => { setAmbiguous(event.target.value as AmbiguousTimeChoice); invalidatePreview(); }}>
            <option value="earlier">first</option>
            <option value="later">second</option>
          </select>
          one.
        </label>

        <ErrorNotice error={review.error} />
        <div className="flex justify-end">
          <Button loading={review.isPending} disabled={!template} onClick={() => review.mutate(series())}>Review plans</Button>
        </div>
      </div>

      {preview && (
        <section className="mt-6 space-y-3">
          <h2 className="text-base font-semibold">
            {preview.plans.length} plan{preview.plans.length === 1 ? '' : 's'} to create
            <span className="ml-2 text-sm font-normal text-slate-500">times in {preview.timezone}</span>
          </h2>
          {preview.problems.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-600/20">
              {preview.problems.map((problem) => <li key={`${problem.local_date}-${problem.message}`}>{problem.message}</li>)}
              <li className="font-medium">Skip or move these dates to continue.</li>
            </ul>
          )}
          {preview.excluded.length > 0 && (
            <p className="text-sm text-slate-500">
              Left out: {preview.excluded.map((date) => `${date.local_date} (${date.reason === 'excluded' ? 'holiday' : 'skipped'})`).join(', ')}
            </p>
          )}
          {preview.problems.filter((problem) => edits.every((edit) => edit.local_date !== problem.local_date)).map((problem) => (
            <div key={`fix-${problem.local_date}`} className="card flex items-center justify-between p-3 text-sm">
              <span>{problem.local_date}</span>
              <Button variant="secondary" className="!py-1 text-xs" onClick={() => editDate({ local_date: problem.local_date, skip: true })}>Skip this date</Button>
            </div>
          ))}
          <ul className="space-y-3">
            {preview.plans.map((plan) => {
              const edit = edits.find((candidate) => candidate.move_to === plan.local_date || candidate.local_date === plan.local_date);
              const seriesDate = edit?.local_date ?? plan.local_date;
              return (
                <li key={plan.local_date} className="card space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      aria-label={`Title for ${plan.local_date}`}
                      className="input w-64"
                      defaultValue={plan.title}
                      onBlur={(event) => {
                        const title = event.target.value.trim();
                        if (title && title !== plan.title) editDate({ ...edit, local_date: seriesDate, skip: false, title });
                      }}
                    />
                    <input
                      aria-label={`Date for ${plan.local_date}`}
                      type="date"
                      className="input w-44"
                      defaultValue={plan.local_date}
                      onBlur={(event) => {
                        const moveTo = event.target.value;
                        if (moveTo && moveTo !== plan.local_date) editDate({ ...edit, local_date: seriesDate, skip: false, move_to: moveTo });
                      }}
                    />
                    <span className="text-sm text-slate-500">{formatDateTime(plan.service_date)}</span>
                    {plan.existing_plans.length > 0 && (
                      <Badge tone={WARN_TONE}>Already has: {plan.existing_plans.map((existing) => existing.title).join(', ')}</Badge>
                    )}
                    <Button variant="ghost" className="ml-auto !py-1 text-xs" onClick={() => editDate({ local_date: seriesDate, skip: true })}>
                      Skip
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
                  aria-label="Reason for creating the roster over the conflicts"
                  className="input"
                  placeholder="Reason for creating anyway (kept with each request)"
                  maxLength={500}
                  value={conflictReason}
                  onChange={(event) => setConflictReason(event.target.value)}
                />
              ) : (
                <p className="text-xs text-slate-500">Leave out the roster pattern, or ask someone who may schedule over conflicts.</p>
              )}
            </>
          )}
          {conflicts.length === 0 && <ErrorNotice error={generate.error} />}
          {generate.error instanceof ApiError && generate.error.code === 'template_preview_changed' && (
            <p className="text-sm text-amber-700">The template or plans changed. Review again.</p>
          )}
          <div className="flex justify-end">
            <Button
              loading={generate.isPending}
              disabled={!preview.preview_hash || preview.plans.length === 0 || preview.plans.some((plan) => plan.preview.blocking.length > 0)}
              onClick={() => generate.mutate()}
            >
              Create {preview.plans.length} draft plan{preview.plans.length === 1 ? '' : 's'}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};
