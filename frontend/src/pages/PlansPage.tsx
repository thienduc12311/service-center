import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { formatDateTime, PLAN_STATUS_LABELS } from '@service-center/shared';
import { api } from '../lib/api';
import { usePlans, useServiceTypes, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { assignmentTone, planTone } from '../lib/format';

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
  const { canManage } = useAuth();
  const invalidate = useInvalidateOrg();
  const serviceTypes = useServiceTypes();
  const [status, setStatus] = useState('');
  const [showPast, setShowPast] = useState(false);
  const [creating, setCreating] = useState(false);

  const plans = usePlans({
    ...(status ? { status } : {}),
    ...(showPast ? { order: 'desc' } : { from: new Date().toISOString(), order: 'asc' }),
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
        times: [{ kind: 'service', name: 'Service', starts_at: start, ends_at: end }],
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
        title="Plans"
        subtitle="Every service, its order and its team."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by status"
              className="input w-36"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {Object.entries(PLAN_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
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
              Past
            </label>
            {canManage && <Button onClick={() => setCreating(true)}>New plan</Button>}
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
                    <Badge tone={planTone[plan.status]}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
                    {plan.service_type && (
                      <span className="text-xs text-slate-400">{plan.service_type.name}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {formatDateTime(plan.service_date)}
                    {plan.location ? ` · ${plan.location}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-500">
                  <span>{plan.counts.songs} songs</span>
                  <span>{plan.counts.confirmed} confirmed</span>
                  {plan.counts.unconfirmed > 0 && (
                    <Badge tone={assignmentTone.unconfirmed}>{plan.counts.unconfirmed} pending</Badge>
                  )}
                  {plan.counts.declined > 0 && (
                    <Badge tone={assignmentTone.declined}>{plan.counts.declined} declined</Badge>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No plans yet"
          description="A plan holds one service: its running order, its songs and the people serving."
          action={canManage ? <Button onClick={() => setCreating(true)}>Create the first plan</Button> : undefined}
        />
      )}

      <Modal open={creating} title="New plan" onClose={() => setCreating(false)}>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="plan-title">Title</label>
            <input
              id="plan-title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunday Morning"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="plan-date">Service date &amp; time</label>
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
            <label className="label" htmlFor="plan-type">Service type</label>
            <select
              id="plan-type"
              className="input"
              value={serviceTypeId}
              onChange={(e) => setServiceTypeId(e.target.value)}
            >
              <option value="">None</option>
              {(serviceTypes.data ?? []).map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="plan-location">Location</label>
            <input
              id="plan-location"
              className="input"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Main Auditorium"
            />
          </div>

          <ErrorNotice error={createPlan.error} />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createPlan.isPending}>
              Create plan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
