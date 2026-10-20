import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMySchedule, usePlans, useRespondToAssignment } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { assignmentTone, planTone } from '../lib/format';
import { useFormatters } from '../i18n';

export const DashboardPage = () => {
  const { t } = useTranslation(['home', 'common']);
  const f = useFormatters();
  const { user, canAnywhere } = useAuth();
  const canManage = canAnywhere('plans.edit');
  const [openedAt] = useState(() => new Date().toISOString());
  const upcoming = usePlans({ from: openedAt, per_page: 5, order: 'asc' });
  const mine = useMySchedule();
  const respond = useRespondToAssignment();

  const awaitingReply = (mine.data ?? []).filter((entry) => entry.assignment.status === 'unconfirmed');
  const firstName = user?.profile.full_name?.trim().split(' ')[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title={firstName ? t('dashboard.greeting', { name: firstName }) : t('dashboard.greetingNoName')}
        subtitle={t('dashboard.subtitle')}
        actions={
          canManage && (
            <Link to="/plans">
              <Button>{t('dashboard.newPlan')}</Button>
            </Link>
          )
        }
      />

      {awaitingReply.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('dashboard.waitingOnYou')}
          </h2>
          <ul className="space-y-3">
            {awaitingReply.map((entry) => (
              <li key={entry.assignment.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/plans/${entry.plan.id}`} className="font-medium hover:underline">
                    {entry.plan.title}
                  </Link>
                  <p className="text-sm text-slate-500">
                    {f.dateTime(entry.plan.service_date)}
                    {entry.position ? ` · ${entry.position.name}` : ''}
                    {entry.team ? ` · ${entry.team.name}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    loading={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: entry.assignment.id, status: 'declined' })
                    }
                  >
                    {t('common:actions.decline')}
                  </Button>
                  <Button
                    loading={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: entry.assignment.id, status: 'confirmed' })
                    }
                  >
                    {t('dashboard.accept')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <ErrorNotice error={respond.error} />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t('dashboard.upcoming')}
          </h2>
          <Link to="/plans" className="text-sm font-medium text-brand-600 hover:underline">
            {t('dashboard.allPlans')}
          </Link>
        </div>

        {upcoming.isLoading ? (
          <Loading />
        ) : upcoming.data?.data.length ? (
          <ul className="space-y-3">
            {upcoming.data.data.map((plan) => {
              const outstanding = plan.counts.unconfirmed;
              return (
                <li key={plan.id} className="card p-4">
                  <Link to={`/plans/${plan.id}`} className="flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{plan.title}</span>
                        <Badge tone={planTone[plan.status]}>{t(`common:planStatus.${plan.status}`)}</Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {f.dateTime(plan.service_date)}
                        {plan.location ? ` · ${plan.location}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span>{t('common:count.songs', { count: plan.counts.songs })}</span>
                      <span aria-hidden="true">·</span>
                      <span>{t('dashboard.confirmedCount', { total: plan.counts.confirmed })}</span>
                      {outstanding > 0 && (
                        <Badge tone={assignmentTone.unconfirmed}>{t('dashboard.pendingCount', { total: outstanding })}</Badge>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title={t('dashboard.noUpcomingTitle')}
            description={t('dashboard.noUpcomingDescription')}
            action={
              canManage ? (
                <Link to="/plans">
                  <Button>{t('dashboard.createPlan')}</Button>
                </Link>
              ) : undefined
            }
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t('dashboard.commitments')}
        </h2>
        {mine.isLoading ? (
          <Loading />
        ) : mine.data?.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {mine.data.slice(0, 6).map((entry) => {
              const rehearsal = entry.times.find((time) => time.kind === 'rehearsal');
              return (
                <li key={entry.assignment.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: entry.team?.color ?? '#94a3b8' }}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <Link to={`/plans/${entry.plan.id}`} className="text-sm font-medium hover:underline">
                      {entry.plan.title}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {f.date(entry.plan.service_date)}
                      {entry.position ? ` · ${entry.position.name}` : ''}
                      {rehearsal
                        ? ` · ${t('dashboard.rehearsalAt', { time: f.dateTime(rehearsal.starts_at) })}`
                        : ''}
                    </p>
                  </div>
                  <Badge tone={assignmentTone[entry.assignment.status]}>
                    {t(`common:assignmentStatus.${entry.assignment.status}`)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title={t('dashboard.nothingScheduled')} />
        )}
      </section>
    </div>
  );
};
