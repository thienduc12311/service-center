import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { formatDate, formatTime, type DelegatedScheduleEntry } from '@service-center/shared';
import { api } from '../lib/api';
import { useDelegatedSchedule, useDelegations, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { AvailabilitySettings } from '../components/settings/AvailabilitySettings';
import { AvailabilityReview } from '../components/settings/AvailabilityReview';
import { SchedulingPreferences } from '../components/settings/SchedulingPreferences';

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
        title="Nothing to help with here"
        description="This permission was stopped, expired, or was never yours."
        action={<Link className="button button-secondary" to="/settings">Back to settings</Link>}
      />
    );
  }

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title={`Helping ${delegation.target_name}`} subtitle="You can only do what they allowed. Changes are recorded as made by you." />

      {canSee && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Requests</h2>
          {schedule.isLoading ? <Loading /> : schedule.data?.entries.length ? (
            <ul className="divide-y divide-slate-100">
              {schedule.data.entries.map((entry) => (
                <li key={entry.assignment_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{entry.plan_title}</p>
                      <p className="text-xs text-slate-500">
                        {[formatDate(entry.service_date), [entry.team_name, entry.position_name].filter(Boolean).join(' · '),
                          ...entry.times.map((time) => `${time.name ?? time.kind} ${formatTime(time.starts_at)}`)]
                          .filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    <span className="text-xs capitalize text-slate-500">{entry.status === 'unconfirmed' ? 'Awaiting answer' : entry.status}</span>
                  </div>
                  {delegation.can_respond && entry.status !== 'declined' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {entry.status === 'unconfirmed' && (
                        <Button loading={respond.isPending && respond.variables?.entry.assignment_id === entry.assignment_id && respond.variables.status === 'confirmed'}
                          onClick={() => respond.mutate({ entry, status: 'confirmed' })}>Accept</Button>
                      )}
                      <input className="input max-w-xs flex-1" placeholder="Reason (optional)" maxLength={500}
                        aria-label={`Decline reason for ${entry.plan_title}`}
                        value={reason[entry.assignment_id] ?? ''} onChange={(e) => setReason({ ...reason, [entry.assignment_id]: e.target.value })} />
                      <Button variant="secondary" className="text-rose-600"
                        loading={respond.isPending && respond.variables?.entry.assignment_id === entry.assignment_id && respond.variables.status === 'declined'}
                        onClick={() => respond.mutate({ entry, status: 'declined' })}>
                        {entry.status === 'confirmed' ? 'Withdraw' : 'Decline'}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">No upcoming requests.</p>}
          <ErrorNotice error={schedule.error ?? respond.error} />
        </section>
      )}

      {delegation.can_manage_availability && (
        <>
          <section className="card space-y-4 p-5">
            <h2 className="font-semibold">Availability</h2>
            <AvailabilityReview personId={delegation.target_person_id} />
          </section>
          <AvailabilitySettings timezone={timezone} personId={delegation.target_person_id} personName={delegation.target_name} />
          <section className="card p-5">
            <h2 className="mb-3 font-semibold">Scheduling preferences</h2>
            <SchedulingPreferences personId={delegation.target_person_id} />
          </section>
        </>
      )}
    </div>
  );
};
