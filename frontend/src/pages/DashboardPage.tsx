import { Link } from 'react-router-dom';
import {
  ASSIGNMENT_STATUS_LABELS,
  formatDate,
  formatDateTime,
} from '@service-center/shared';
import { useMySchedule, usePlans, useRespondToAssignment } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, PageHeader } from '../components/ui';
import { assignmentTone, planTone } from '../lib/format';

export const DashboardPage = () => {
  const { user, canManage } = useAuth();
  const upcoming = usePlans({ from: new Date().toISOString(), per_page: 5, order: 'asc' });
  const mine = useMySchedule();
  const respond = useRespondToAssignment();

  const awaitingReply = (mine.data ?? []).filter((entry) => entry.assignment.status === 'unconfirmed');
  const firstName = user?.profile.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hi ${firstName}`}
        subtitle="Here’s what’s coming up."
        actions={
          canManage && (
            <Link to="/plans">
              <Button>New plan</Button>
            </Link>
          )
        }
      />

      {awaitingReply.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Waiting on you
          </h2>
          <ul className="space-y-3">
            {awaitingReply.map((entry) => (
              <li key={entry.assignment.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <Link to={`/plans/${entry.plan.id}`} className="font-medium hover:underline">
                    {entry.plan.title}
                  </Link>
                  <p className="text-sm text-slate-500">
                    {formatDateTime(entry.plan.service_date)}
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
                    Decline
                  </Button>
                  <Button
                    loading={respond.isPending}
                    onClick={() =>
                      respond.mutate({ id: entry.assignment.id, status: 'confirmed' })
                    }
                  >
                    Accept
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
            Upcoming services
          </h2>
          <Link to="/plans" className="text-sm font-medium text-brand-600 hover:underline">
            All plans
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
                        <Badge tone={planTone[plan.status]}>{plan.status}</Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        {formatDateTime(plan.service_date)}
                        {plan.location ? ` · ${plan.location}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <span>{plan.counts.songs} songs</span>
                      <span aria-hidden="true">·</span>
                      <span>{plan.counts.confirmed} confirmed</span>
                      {outstanding > 0 && (
                        <Badge tone={assignmentTone.unconfirmed}>{outstanding} pending</Badge>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="No upcoming services"
            description="Create a plan to start building an order of service and scheduling your team."
            action={
              canManage ? (
                <Link to="/plans">
                  <Button>Create a plan</Button>
                </Link>
              ) : undefined
            }
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Your next commitments
        </h2>
        {mine.isLoading ? (
          <Loading />
        ) : mine.data?.length ? (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {mine.data.slice(0, 6).map((entry) => {
              const rehearsal = entry.times.find((t) => t.kind === 'rehearsal');
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
                      {formatDate(entry.plan.service_date)}
                      {entry.position ? ` · ${entry.position.name}` : ''}
                      {rehearsal
                        ? ` · rehearsal ${formatDateTime(rehearsal.starts_at)}`
                        : ''}
                    </p>
                  </div>
                  <Badge tone={assignmentTone[entry.assignment.status]}>
                    {ASSIGNMENT_STATUS_LABELS[entry.assignment.status]}
                  </Badge>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nothing scheduled yet" />
        )}
      </section>
    </div>
  );
};
