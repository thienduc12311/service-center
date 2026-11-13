import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMySchedule, usePlans, useRespondToAssignment } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import {
  Badge,
  Button,
  DateTile,
  EmptyState,
  ErrorNotice,
  PageHeader,
  SectionHeader,
  SkeletonList,
  StatCard,
} from '../components/ui';
import { Icon } from '../components/icons';
import { PlanListCard } from '../components/plan/PlanListCard';
import { assignmentTone } from '../lib/format';
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
  const confirmedCount = (mine.data ?? []).filter((entry) => entry.assignment.status === 'confirmed').length;
  const firstName = user?.profile.full_name?.trim().split(' ')[0];
  const statPlaceholder = '–';

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={f.date(openedAt, 'long')}
        title={firstName ? t('dashboard.greeting', { name: firstName }) : t('dashboard.greetingNoName')}
        subtitle={t('dashboard.subtitle')}
        actions={
          canManage && (
            <Link to="/plans">
              <Button icon="plus" tabIndex={-1}>
                {t('dashboard.newPlan')}
              </Button>
            </Link>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label={t('dashboard.upcoming')}
          value={upcoming.data ? upcoming.data.total : statPlaceholder}
          icon="calendar"
          tone="brand"
          to="/plans"
        />
        <StatCard
          label={t('dashboard.waitingOnYou')}
          value={mine.data ? awaitingReply.length : statPlaceholder}
          icon="bell"
          tone={awaitingReply.length > 0 ? 'amber' : 'slate'}
          to="/my-schedule"
        />
        <StatCard
          label={t('common:assignmentStatus.confirmed')}
          value={mine.data ? confirmedCount : statPlaceholder}
          icon="check"
          tone="green"
          to="/my-schedule"
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {awaitingReply.length > 0 && (
            <section aria-labelledby="dashboard-waiting">
              <SectionHeader id="dashboard-waiting" title={t('dashboard.waitingOnYou')} meta={awaitingReply.length} />
              <ul className="space-y-3">
                {awaitingReply.map((entry) => (
                  <li
                    key={entry.assignment.id}
                    className="card flex flex-wrap items-center gap-4 border-amber-200 p-3 sm:p-4 dark:border-amber-500/30"
                  >
                    <DateTile value={entry.plan.service_date} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/plans/${entry.plan.id}`}
                        className="font-semibold text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-200"
                      >
                        {entry.plan.title}
                      </Link>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Icon name="clock" className="size-3.5" />
                          {f.time(entry.plan.service_date)}
                        </span>
                        {(entry.team || entry.position) && (
                          <span className="inline-flex items-center gap-1">
                            <Icon name="team" className="size-3.5" />
                            {[entry.position?.name, entry.team?.name].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button
                        variant="secondary"
                        className="flex-1 sm:flex-none"
                        loading={respond.isPending}
                        onClick={() => respond.mutate({ id: entry.assignment.id, status: 'declined' })}
                      >
                        {t('common:actions.decline')}
                      </Button>
                      <Button
                        icon="check"
                        className="flex-1 sm:flex-none"
                        loading={respond.isPending}
                        onClick={() => respond.mutate({ id: entry.assignment.id, status: 'confirmed' })}
                      >
                        {t('dashboard.accept')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <ErrorNotice error={respond.error} />
              </div>
            </section>
          )}

          <section aria-labelledby="dashboard-upcoming">
            <SectionHeader
              id="dashboard-upcoming"
              title={t('dashboard.upcoming')}
              action={
                <Link
                  to="/plans"
                  className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
                >
                  {t('dashboard.allPlans')}
                  <Icon name="chevronRight" className="size-4" />
                </Link>
              }
            />

            {upcoming.isLoading ? (
              <SkeletonList rows={3} />
            ) : upcoming.data?.data.length ? (
              <ul className="space-y-3">
                {upcoming.data.data.map((plan) => (
                  <li key={plan.id}>
                    <PlanListCard plan={plan} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="calendar"
                title={t('dashboard.noUpcomingTitle')}
                description={t('dashboard.noUpcomingDescription')}
                action={
                  canManage ? (
                    <Link to="/plans">
                      <Button icon="plus" tabIndex={-1}>
                        {t('dashboard.createPlan')}
                      </Button>
                    </Link>
                  ) : undefined
                }
              />
            )}
          </section>
        </div>

        <aside aria-labelledby="dashboard-commitments" className="min-w-0">
          <SectionHeader
            id="dashboard-commitments"
            title={t('dashboard.commitments')}
            action={
              <Link
                to="/my-schedule"
                className="inline-flex items-center gap-0.5 text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
                aria-label={t('common:nav.mySchedule')}
              >
                <Icon name="chevronRight" className="size-4" />
              </Link>
            }
          />
          {mine.isLoading ? (
            <SkeletonList rows={3} />
          ) : mine.data?.length ? (
            <ul className="card row-list overflow-hidden">
              {mine.data.slice(0, 6).map((entry) => {
                const rehearsal = entry.times.find((time) => time.kind === 'rehearsal');
                return (
                  <li key={entry.assignment.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className="mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-white dark:ring-slate-900"
                      style={{ backgroundColor: entry.team?.color ?? '#94a3b8' }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/plans/${entry.plan.id}`}
                        className="block truncate text-sm font-medium text-slate-900 hover:underline dark:text-white"
                      >
                        {entry.plan.title}
                      </Link>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {f.date(entry.plan.service_date)}
                        {entry.position ? ` · ${entry.position.name}` : ''}
                      </p>
                      {rehearsal && (
                        <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                          <Icon name="music" className="size-3" />
                          {t('dashboard.rehearsalAt', { time: f.dateTime(rehearsal.starts_at) })}
                        </p>
                      )}
                    </div>
                    <Badge tone={assignmentTone[entry.assignment.status]}>
                      {t(`common:assignmentStatus.${entry.assignment.status}`)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon="schedule" title={t('dashboard.nothingScheduled')} />
          )}
        </aside>
      </div>
    </div>
  );
};
