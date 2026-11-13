import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PLAN_STATUS_LABELS, type PlanStatus } from '@service-center/shared';
import { api } from '../lib/api';
import { usePlans, useServiceTypes, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import {
  Button,
  EmptyState,
  ErrorNotice,
  Menu,
  MenuItem,
  MenuSection,
  Modal,
  PageHeader,
  Segmented,
  SkeletonList,
} from '../components/ui';
import { PlanListCard } from '../components/plan/PlanListCard';

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

  const planningTools = canManage || canSchedule;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('plansPage.title')}
        subtitle={t('plansPage.subtitle')}
        actions={
          <>
            {planningTools && (
              <Menu label={t('common:actions.more')} icon="grid">
                {(close) => (
                  <>
                    {canManage && (
                      <>
                        <MenuSection label={t('common:nav.groups.planning')} />
                        <MenuItem icon="plus" onClick={() => { close(); navigate('/service-types/new'); }}>
                          {t('plansPage.newServiceType')}
                        </MenuItem>
                        <MenuItem icon="document" onClick={() => { close(); navigate('/plans/templates'); }}>
                          {t('plansPage.templates')}
                        </MenuItem>
                        <MenuItem icon="sparkle" onClick={() => { close(); navigate('/plans/generate'); }}>
                          {t('plansPage.createFromTemplate')}
                        </MenuItem>
                        <MenuItem icon="calendar" onClick={() => { close(); navigate('/plans/reschedule'); }}>
                          {t('plansPage.reschedule')}
                        </MenuItem>
                      </>
                    )}
                    {canSchedule && (
                      <>
                        <MenuSection label={t('common:nav.groups.people')} />
                        <MenuItem icon="grid" onClick={() => { close(); navigate('/plans/matrix'); }}>
                          {t('plansPage.staffingMatrix')}
                        </MenuItem>
                        <MenuItem icon="people" onClick={() => { close(); navigate('/plans/proposals'); }}>
                          {t('plansPage.proposeStaffing')}
                        </MenuItem>
                        <MenuItem icon="check" onClick={() => { close(); navigate('/plans/releases'); }}>
                          {t('plansPage.releaseReview')}
                        </MenuItem>
                      </>
                    )}
                  </>
                )}
              </Menu>
            )}
            {canManage && (
              <Button icon="plus" onClick={() => setCreating(true)}>
                {t('plansPage.newPlan')}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label={t('plansPage.past')}
          value={showPast ? 'past' : 'upcoming'}
          onChange={(value) => setShowPast(value === 'past')}
          items={[
            { value: 'upcoming', label: t('mobilePlans.window.upcoming') },
            { value: 'past', label: t('plansPage.past') },
          ]}
        />
        <div className="flex items-center gap-3">
          {plans.data && (
            <span className="text-sm text-slate-500 tabular-nums dark:text-slate-400">
              {t('common:count.plans', { count: plans.data.total })}
            </span>
          )}
          <select
            aria-label={t('plansPage.filterStatus')}
            className="input w-40"
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
        </div>
      </div>

      <ErrorNotice error={plans.error} />

      {plans.isLoading ? (
        <SkeletonList rows={4} />
      ) : plans.data?.data.length ? (
        <ul className="space-y-3">
          {plans.data.data.map((plan) => (
            <li key={plan.id}>
              <PlanListCard plan={plan} showServiceType showDeclined />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon="plans"
          title={t('plansPage.emptyTitle')}
          description={t('plansPage.emptyDescription')}
          action={
            canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button icon="plus" onClick={() => navigate('/service-types/new')}>{t('plansPage.addServiceType')}</Button>
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
          <div className="grid gap-4 sm:grid-cols-2">
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
