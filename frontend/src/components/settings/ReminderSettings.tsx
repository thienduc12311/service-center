import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type DeliveryChannel, type ReminderPreferences } from '@service-center/shared';
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
  const { t } = useTranslation('settings');
  const serviceTypes = useServiceTypes();
  const [serviceTypeId, setServiceTypeId] = useState('');
  const selected = (serviceTypes.data ?? []).find((type) => type.id === serviceTypeId);

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">{t('reminders.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('reminders.description')}</p>
      <label className="field mb-4">
        {t('reminders.scope')}
        <select className="input" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
          <option value="">{t('reminders.wholeOrganization')}</option>
          {(serviceTypes.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
      </label>
      <ReminderPolicyEditor
        key={serviceTypeId || 'organization'}
        serviceTypeId={serviceTypeId || null}
        scopeLabel={selected ? selected.name : t('reminders.theOrganization')}
      />
    </section>
  );
};

/** Everyone: which channels reminders may use for me. Requests themselves are not affected. */
export const MyReminderSettings = () => {
  const { t } = useTranslation('settings');
  const preferences = useMyReminderPreferences();
  const invalidate = useInvalidateOrg();
  const save = useMutation({
    mutationFn: (next: ReminderPreferences) => api.updateMyReminderPreferences({ email: next.email, push: next.push, in_app: next.in_app }),
    onSuccess: invalidate,
  });

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">{t('myReminders.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('myReminders.description')}</p>
      {preferences.isLoading ? (
        <Spinner />
      ) : preferences.data ? (
        <div className="flex flex-wrap gap-4 text-sm" role="group" aria-label={t('myReminders.channels')}>
          {CHANNELS.map((channel) => (
            <label key={channel} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={preferences.data[channel]}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ ...preferences.data!, [channel]: e.target.checked })}
              />
              {t(`delivery.channel.${channel}`)}
            </label>
          ))}
          {save.isSuccess && <span className="text-emerald-600">{t('settingsPage.saved')}</span>}
        </div>
      ) : null}
      <ErrorNotice error={preferences.error ?? save.error} />
      {preferences.data && !preferences.data.email && !preferences.data.push && !preferences.data.in_app && (
        <p className="mt-2 text-sm text-amber-700">{t('myReminders.none')}</p>

      )}
    </section>
  );
};
