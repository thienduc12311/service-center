import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PLAN_STATUS_LABELS, type PlanStatus } from '@service-center/shared';
import { api } from '../lib/api';
import { usePlans, useServiceTypes, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { assignmentTone, planTone } from '../lib/format';
import { useFormatters } from '../i18n';

const PLAN_STATUSES = Object.keys(PLAN_STATUS_LABELS) as PlanStatus[];

/** Datetime-local inputs are local-time strings; the API wants ISO instants. */
const toIso = (localValue: string): string => new Date(localValue).toISOString();

const defaultServiceDate = () => {
  const next = new Date();
  next.setDate(next.getDate() + ((7 - next.getDay()) % 7 || 7));
  next.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`;
};

export const PlansPage = () => {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const { canAnywhere } = useAuth();
  const canManage = canAnywhere('plans.edit');
  const canSchedule = canAnywhere('scheduling.manage');
  const navigate = useNavigate();
  const invalidate = useInvalidateOrg();
  const serviceTypes = useServiceTypes();
  const [status, setStatus] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [creating, setCreating] = useState(false);
  const [openedAt] = useState(() => new Date().toISOString());

  const plans = usePlans({
    ...(status ? { status } : {}),
    ...(showPast ? { order: 'desc' } : { from: openedAt, order: 'asc' }),
    per_page: 50,
  });

  const [title, setTitle] = useState('');
  const [serviceDate, setServiceDate] = useState(defaultServiceDate);
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [location, setLocation] = useState('');

  const createPlan = useMutation({
    mutationFn: () => {
      const start = toIso(serviceDate);
      const end = new Date(new Date(start).getTime() + 90 * 60_000).toISOString();
      return api.createPlan({
        title,
        service_date: start,
        service_type_id: serviceTypeId || null,
        location: location || null,
        status: 'draft',
        // A plan with no times never appears on the calendar, so seed one.
        times: [{ kind: 'service', name: t('timeKind.service'), starts_at: start, ends_at: end }],
      });
    },
    onSuccess: async () => {
      await invalidate();
      setCreating(false);
      setTitle('');
      setLocation('');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    createPlan.mutate();
  };

  return (
    <div>
      <PageHeader
        title={t('plansPage.title')}
        subtitle={t('plansPage.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={t('plansPage.filterStatus')}
              className="input w-36"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">{t('plansPage.allStatuses')}</option>
              {PLAN_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`common:planStatus.${value}`)}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={showPast}
                onChange={(e) => setShowPast(e.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {t('plansPage.past')}
            </label>
            {canManage && (
              <>
                <Button variant="secondary" onClick={() => navigate('/service-types/new')}>
                  {t('plansPage.newServiceType')}
                </Button>
                <Button onClick={() => setCreating(true)}>{t('plansPage.newPlan')}</Button>
                <Button variant="secondary" onClick={() => navigate('/plans/templates')}>{t('plansPage.templates')}</Button>
                <Button variant="secondary" onClick={() => navigate('/plans/generate')}>{t('plansPage.createFromTemplate')}</Button>
                <Button variant="secondary" onClick={() => navigate('/plans/reschedule')}>{t('plansPage.reschedule')}</Button>
              </>
            )}
            {canSchedule && <Button variant="secondary" onClick={() => navigate('/plans/matrix')}>{t('plansPage.staffingMatrix')}</Button>}
            {canSchedule && <Button variant="secondary" onClick={() => navigate('/plans/proposals')}>{t('plansPage.proposeStaffing')}</Button>}
            {canSchedule && <Button variant="secondary" onClick={() => navigate('/plans/releases')}>{t('plansPage.releaseReview')}</Button>}
          </div>
        }
      />

      <ErrorNotice error={plans.error} />

      {plans.isLoading ? (
        <Loading />
      ) : plans.data?.data.length ? (
        <ul className="space-y-3">
          {plans.data.data.map((plan) => (
            <li key={plan.id} className="card transition hover:border-brand-200">
              <Link to={`/plans/${plan.id}`} className="flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{plan.title}</span>
                    <Badge tone={planTone[plan.status]}>{t(`common:planStatus.${plan.status}`)}</Badge>
                    {plan.service_type && (
                      <span className="text-xs text-slate-400">
                        {t(`plansPage.serviceTypeRecurrence.${plan.service_type.recurrence}`, { name: plan.service_type.name })}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {plan.location
                      ? t('plansPage.dateLocation', { date: format.dateTime(plan.service_date), location: plan.location })
                      : format.dateTime(plan.service_date)}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span>{t('common:count.songs', { count: plan.counts.songs })}</span>
                  <span>{t('plansPage.confirmedCount', { number: plan.counts.confirmed })}</span>
                  {plan.counts.unconfirmed > 0 && (
                    <Badge tone={assignmentTone.unconfirmed}>{t('plansPage.pendingCount', { number: plan.counts.unconfirmed })}</Badge>
                  )}
                  {plan.counts.declined > 0 && (
                    <Badge tone={assignmentTone.declined}>{t('plansPage.declinedCount', { number: plan.counts.declined })}</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={t('plansPage.emptyTitle')}
          description={t('plansPage.emptyDescription')}
          action={
            canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => navigate('/service-types/new')}>{t('plansPage.addServiceType')}</Button>
                <Button variant="secondary" onClick={() => setCreating(true)}>
                  {t('plansPage.createSinglePlan')}
                </Button>
              </div>
            ) : undefined
          }
        />
      )}

      <Modal open={creating} title={t('plansPage.createTitle')} onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="plan-title">{t('plansPage.fieldTitle')}</label>
            <input
              id="plan-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('plansPage.titlePlaceholder')}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="plan-date">{t('plansPage.fieldServiceDate')}</label>
            <input
              id="plan-date"
              type="datetime-local"
              className="input"
              value={serviceDate}
              onChange={(e) => setServiceDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="plan-type">{t('plansPage.fieldServiceType')}</label>
            <select
              id="plan-type"
              className="input"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
            >
              <option value="">{t('common:states.none')}</option>
              {(serviceTypes.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="plan-location">{t('plansPage.fieldLocation')}</label>
            <input
              id="plan-location"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('plansPage.locationPlaceholder')}
            />
          </div>

          <ErrorNotice error={createPlan.error} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={createPlan.isPending}>
              {t('plansPage.createPlan')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
