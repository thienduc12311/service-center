import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMySchedule, useRespondToAssignment } from '../hooks/queries';
import { Badge, Button, DateTile, EmptyState, ErrorNotice, PageHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { assignmentTone } from '../lib/format';
import { useFormatters } from '../i18n';

export const MySchedulePage = () => {
  const [includePast, setIncludePast] = useState(false);
  const schedule = useMySchedule({ include_past: includePast });
  const respond = useRespondToAssignment();
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('mySchedule.title')}
        subtitle={t('mySchedule.subtitle')}
        actions={
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-white px-3 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.target.checked)}
              className="size-4 rounded border-slate-300 accent-brand-600 dark:border-slate-600"
            />
            {t('mySchedule.includePast')}
          </label>
        }
      />

      <ErrorNotice error={respond.error ?? schedule.error} />

      {schedule.isLoading ? (
        <SkeletonList rows={4} />
      ) : schedule.data?.length ? (
        <ul className="space-y-3">
          {schedule.data.map((entry) => {
            const past = new Date(entry.plan.service_date) < new Date();
            const awaiting = !past && entry.assignment.status === 'unconfirmed';
            return (
              <li
                key={entry.assignment.id}
                className={`card p-3 sm:p-4 ${past ? 'opacity-70' : ''} ${
                  awaiting ? 'border-amber-200 dark:border-amber-500/30' : ''
                }`}
              >
                <div className="flex flex-wrap items-start gap-4">
                  <DateTile value={entry.plan.service_date} muted={past} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/plans/${entry.plan.id}`}
                        className="font-semibold text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-200"
                      >
                        {entry.plan.title}
                      </Link>
                      <Badge tone={assignmentTone[entry.assignment.status]}>
                        {t(`common:assignmentStatus.${entry.assignment.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <Icon name="clock" className="size-3.5" />
                        {f.dateTime(entry.plan.service_date)}
                      </span>
                      {entry.plan.location && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Icon name="mapPin" className="size-3.5" />
                          {entry.plan.location}
                        </span>
                      )}
                    </p>
                    {(entry.team || entry.position) && (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: entry.team?.color ?? '#94a3b8' }}
                          aria-hidden="true"
                        />
                        {entry.team?.name}
                        {entry.position ? ` — ${entry.position.name}` : ''}
                      </p>
                    )}

                    {entry.times.length > 0 && (
                      <ul className="mt-2.5 flex flex-wrap gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        {entry.times.map((time) => (
                          <li key={time.id} className="surface-inset px-2 py-1">
                            {t('mySchedule.timeLine', {
                              label: time.name ?? t(`timeKind.${time.kind}`),
                              date: f.date(time.starts_at),
                              time: f.time(time.starts_at),
                            })}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {!past && entry.assignment.status !== 'declined' && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      {entry.assignment.status !== 'confirmed' && (
                        <Button
                          icon="check"
                          className="flex-1 sm:flex-none"
                          loading={respond.isPending}
                          onClick={() => respond.mutate({ id: entry.assignment.id, status: 'confirmed' })}
                        >
                          {t('mySchedule.accept')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        className="flex-1 sm:flex-none"
                        loading={respond.isPending}
                        onClick={() => respond.mutate({ id: entry.assignment.id, status: 'declined' })}
                      >
                        {t('common:actions.decline')}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon="schedule"
          title={t('mySchedule.emptyTitle')}
          description={t('mySchedule.emptyDescription')}
        />
      )}
    </div>
  );
};
