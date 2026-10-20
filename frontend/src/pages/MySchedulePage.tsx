import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMySchedule, useRespondToAssignment } from '../hooks/queries';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { assignmentTone } from '../lib/format';
import { useFormatters } from '../i18n';

export const MySchedulePage = () => {
  const [includePast, setIncludePast] = useState(false);
  const schedule = useMySchedule({ include_past: includePast });
  const respond = useRespondToAssignment();
  const { t } = useTranslation(['scheduling', 'common']);
  const f = useFormatters();

  return (
    <div>
      <PageHeader
        title={t('mySchedule.title')}
        subtitle={t('mySchedule.subtitle')}
        actions={
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={includePast}
              onChange={(e) => setIncludePast(e.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            {t('mySchedule.includePast')}
          </label>
        }
      />

      <ErrorNotice error={respond.error ?? schedule.error} />

      {schedule.isLoading ? (
        <Loading />
      ) : schedule.data?.length ? (
        <ul className="space-y-3">
          {schedule.data.map((entry) => {
            const past = new Date(entry.plan.service_date) < new Date();
            return (
              <li key={entry.assignment.id} className={`card p-4 ${past ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/plans/${entry.plan.id}`} className="font-medium hover:underline">
                        {entry.plan.title}
                      </Link>
                      <Badge tone={assignmentTone[entry.assignment.status]}>
                        {t(`common:assignmentStatus.${entry.assignment.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {f.dateTime(entry.plan.service_date)}
                      {entry.plan.location ? ` · ${entry.plan.location}` : ''}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {entry.team?.name}
                      {entry.position ? ` — ${entry.position.name}` : ''}
                    </p>

                    {entry.times.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                        {entry.times.map((time) => (
                          <li key={time.id} className="rounded bg-slate-100 px-2 py-0.5">
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
                    <div className="flex gap-2">
                      {entry.assignment.status !== 'confirmed' && (
                        <Button
                          loading={respond.isPending}
                          onClick={() => respond.mutate({ id: entry.assignment.id, status: 'confirmed' })}
                        >
                          {t('mySchedule.accept')}
                        </Button>
                      )}
                      <Button
                        variant="secondary"
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
          title={t('mySchedule.emptyTitle')}
          description={t('mySchedule.emptyDescription')}
        />
      )}
    </div>
  );
};
