import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { DELIVERY_CHANNEL_LABELS, type DeliveryChannel, type ReminderPreferences } from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useMyReminderPreferences, useServiceTypes } from '../../hooks/queries';
import { ErrorNotice, Spinner } from '../ui';
import { ReminderPolicyEditor } from './ReminderPolicyEditor';

const CHANNELS: readonly DeliveryChannel[] = ['in_app', 'push', 'email'];

/**
 * Leaders: organization and service-type reminder policies. Team overrides
 * live in each team's settings. The worker recomputes upcoming reminders
 * after any change.
 */
export const ReminderPolicySettings = () => {
  const serviceTypes = useServiceTypes();
  const [serviceTypeId, setServiceTypeId] = useState('');
  const selected = (serviceTypes.data ?? []).find((type) => type.id === serviceTypeId);

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Reminders</h2>
      <p className="mb-4 text-sm text-slate-500">
        Automatic reminders for unanswered requests and upcoming confirmed services. A team setting overrides its
        service type, which overrides the organization; without any, Service Center sends one reminder 3 days
        before an unanswered request and one 1 day before a confirmed person is needed. Reminders stop on their
        own when someone answers, is removed, or the time changes.
      </p>
      <label className="mb-4 block text-sm">
        Scope
        <select className="input mt-1" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
          <option value="">Whole organization</option>
          {(serviceTypes.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
      </label>
      <ReminderPolicyEditor
        key={serviceTypeId || 'organization'}
        serviceTypeId={serviceTypeId || null}
        scopeLabel={selected ? selected.name : 'the organization'}
      />
    </section>
  );
};

/** Everyone: which channels reminders may use for me. Requests themselves are not affected. */
export const MyReminderSettings = () => {
  const preferences = useMyReminderPreferences();
  const invalidate = useInvalidateOrg();
  const save = useMutation({
    mutationFn: (next: ReminderPreferences) => api.updateMyReminderPreferences({ email: next.email, push: next.push, in_app: next.in_app }),
    onSuccess: invalidate,
  });

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">My reminders</h2>
      <p className="mb-4 text-sm text-slate-500">
        Choose how automatic reminders reach you. New requests and changes are still sent.
      </p>
      {preferences.isLoading ? (
        <Spinner />
      ) : preferences.data ? (
        <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label="Reminder channels">
          {CHANNELS.map((channel) => (
            <label key={channel} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences.data[channel]}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ ...preferences.data!, [channel]: e.target.checked })}
              />
              {DELIVERY_CHANNEL_LABELS[channel]}
            </label>
          ))}
          {save.isSuccess && <span className="text-emerald-600">Saved.</span>}
        </div>
      ) : null}
      <ErrorNotice error={preferences.error ?? save.error} />
      {preferences.data && !preferences.data.email && !preferences.data.push && !preferences.data.in_app && (
        <p className="mt-2 text-sm text-amber-700">You will not receive automatic reminders.</p>
      )}
    </section>
  );
};
