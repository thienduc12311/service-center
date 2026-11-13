import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { DelegatedScheduleEntry } from '@service-center/shared';
import { api } from '../lib/api';
import { useDelegatedSchedule, useDelegations, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, DateTile, EmptyState, ErrorNotice, Loading, PageHeader, SkeletonList } from '../components/ui';
import { Icon } from '../components/icons';
import { AvailabilitySettings } from '../components/settings/AvailabilitySettings';
import { AvailabilityReview } from '../components/settings/AvailabilityReview';
import { SchedulingPreferences } from '../components/settings/SchedulingPreferences';
import { useFormatters } from '../i18n';

interface DelegatedAnswer {
  entry: DelegatedScheduleEntry;
  status: 'confirmed' | 'declined';
}

/**
 * F03 Pass C: acting for someone under their explicit grant. Every action is
 * re-checked by the server against the live grant; a revoked or expired grant
 * shows nothing.
 */
export const HelpPage = () => {
  const { t } = useTranslation(['home', 'common']);
  const f = useFormatters();
  const { delegationId } = useParams();
  const { user, organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const delegations = useDelegations();
  const delegation = delegations.data?.find((d) => d.id === delegationId && d.direction === 'received' && d.active);
  const canSee = Boolean(delegation && (delegation.can_view_schedule || delegation.can_respond));
  const schedule = useDelegatedSchedule(delegationId, canSee);
  const [reason, setReason] = useState<Record<string, string>>({});
  const timezone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';

  const respond = useMutation({
    mutationFn: ({ entry, status }: DelegatedAnswer) => api.respondAsDelegate(delegationId!, entry.assignment_id, {
      status,
      expected_status: entry.status,
      reason: status === 'declined' ? reason[entry.assignment_id]?.trim() || null : null,
    }),
    onSuccess: invalidate,
  });

  if (delegations.isLoading) return <Loading />;
  if (!delegation) {
    return (
      <EmptyState
        title={t('help.notFoundTitle')}
        description={t('help.notFoundDescription')}
        icon="people"
        action={<Link className="button inline-flex h-9 items-center gap-2 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm shadow-slate-900/5 ring-1 ring-inset ring-slate-300 transition hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800" to="/settings"><Icon name="chevronLeft" className="size-4" />{t('help.backToSettings')}</Link>}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader back={{ to: '/settings', label: t('help.backToSettings') }} title={t('help.title', { name: delegation.target_name })} subtitle={t('help.subtitle')} />

      {canSee && (
        <section className="card overflow-hidden">
          <h2 className="border-b border-app-border px-5 py-4 font-semibold text-slate-900 dark:text-white">{t('help.requests')}</h2>
          {schedule.isLoading ? <div className="p-5"><SkeletonList rows={2} /></div> : schedule.data?.entries.length ? (
            <ul className="row-list">
              {schedule.data.entries.map((entry) => (
                <li key={entry.assignment_id} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <DateTile value={`${entry.service_date.slice(0, 10)}T12:00:00`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 dark:text-white">{entry.plan_title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {[f.date(entry.service_date), [entry.team_name, entry.position_name].filter(Boolean).join(' · '),
                          ...entry.times.map((time) => t('help.timeAt', { name: time.name ?? t(`help.timeKinds.${time.kind}`), time: f.time(time.starts_at) }))]
                          .filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className={`status-${entry.status} rounded-full px-2 py-0.5 text-xs font-medium`}>{entry.status === 'unconfirmed' ? t('help.awaitingAnswer') : t(`common:assignmentStatus.${entry.status}`)}</span>
                  </div>
                  {delegation.can_respond && entry.status !== 'declined' && (
                    <div className="flex flex-wrap items-center gap-2 sm:pl-[4.25rem]">
                      {entry.status === 'unconfirmed' && (
                        <Button icon="check" loading={respond.isPending && respond.variables?.entry.assignment_id === entry.assignment_id && respond.variables.status === 'confirmed'}
                          onClick={() => respond.mutate({ entry, status: 'confirmed' })}>{t('help.accept')}</Button>
                      )}
                      <input className="input min-w-40 max-w-xs flex-1" placeholder={t('help.reasonPlaceholder')} maxLength={500}
                        aria-label={t('help.reasonLabel', { plan: entry.plan_title })}
                        value={reason[entry.assignment_id] ?? ''} onChange={(e) => setReason({ ...reason, [entry.assignment_id]: e.target.value })} />
                      <Button variant="secondary" className="!text-rose-600 dark:!text-rose-400"
                        loading={respond.isPending && respond.variables?.entry.assignment_id === entry.assignment_id && respond.variables.status === 'declined'}
                        onClick={() => respond.mutate({ entry, status: 'declined' })}>
                        {entry.status === 'confirmed' ? t('help.withdraw') : t('common:actions.decline')}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <EmptyState compact icon="calendar" title={t('help.noRequests')} />}
          <div className="px-5 pb-5 empty:hidden"><ErrorNotice error={schedule.error ?? respond.error} /></div>
        </section>
      )}

      {delegation.can_manage_availability && (
        <>
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold text-slate-900 dark:text-white">{t('help.availability')}</h2>
            <AvailabilityReview personId={delegation.target_person_id} />
          </section>
          <AvailabilitySettings timezone={timezone} personId={delegation.target_person_id} personName={delegation.target_name} />
          <section className="card p-5">
            <h2 className="mb-3 font-semibold text-slate-900 dark:text-white">{t('help.schedulingPreferences')}</h2>
            <SchedulingPreferences personId={delegation.target_person_id} />
          </section>
        </>
      )}
    </div>
  );
};
