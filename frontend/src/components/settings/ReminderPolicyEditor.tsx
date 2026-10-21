import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  REMINDER_CHANNELS,
  isPolicySetAtScope,
  reminderPolicyDraftFrom,
  reminderPolicyRequest,
  toWallClockInput,
  validateReminderPolicyDraft,
  type EffectiveReminderPolicy,
  type ReminderKind,
  type ReminderPolicyDraft,
  type ReminderPolicyRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useReminderPolicies } from '../../hooks/queries';
import { Button, ErrorNotice, Spinner } from '../ui';
import { useFormatters } from '../../i18n';

const KINDS: readonly ReminderKind[] = ['pending_response', 'confirmed_service'];

export interface ReminderPolicyEditorProps {
  serviceTypeId?: string | null;
  teamId?: string | null;
  /** Short name of the scope, e.g. "this team". */
  scopeLabel: string;
}

interface PolicyFormProps {
  kind: ReminderKind;
  effective: EffectiveReminderPolicy;
  explicit: ReminderPolicyRow | undefined;
  canEdit: boolean;
  serviceTypeId: string | null;
  teamId: string | null;
  scopeLabel: string;
}

/** 1500 → "1 day 1 hour", in the displayed language. */
const formatOffset = (t: TFunction<'common'>, minutes: number): string => {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days ? t('duration.days', { count: days }) : '',
    hours ? t('duration.hours', { count: hours }) : '',
    mins ? t('duration.minutes', { count: mins }) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : t('duration.minutes', { count: 0 });
};

const PolicyForm = ({ kind, effective, explicit, canEdit, serviceTypeId, teamId, scopeLabel }: PolicyFormProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { t: tCommon } = useTranslation('common');
  const { list } = useFormatters();
  const invalidate = useInvalidateOrg();
  // The same draft and request rules as the app (shared `reminderPolicyDraftFrom`).
  const [draft, setDraft] = useState<ReminderPolicyDraft>(() => reminderPolicyDraftFrom(effective));
  const edit = (patch: Partial<ReminderPolicyDraft>) => setDraft((current) => ({ ...current, ...patch }));

  useEffect(() => {
    setDraft(reminderPolicyDraftFrom(effective));
  }, [effective]);

  const save = useMutation({
    mutationFn: () => api.saveReminderPolicy(reminderPolicyRequest(draft, kind, { serviceTypeId, teamId }, explicit)),
    onSuccess: invalidate,
  });
  const reset = useMutation({
    mutationFn: () => api.deleteReminderPolicy(explicit!.id),
    onSuccess: invalidate,
  });

  const problems = validateReminderPolicyDraft(draft);
  const invalidOffset = problems.includes('offset');
  const invalidQuiet = problems.includes('quiet');

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <legend className="px-1 text-sm font-medium">{t(`reminders.kind.${kind}`)}</legend>
      <p className="mb-2 text-sm text-slate-500">{t(`reminders.kindDescription.${kind}`)}</p>
      <p className="mb-3 text-sm">
        {t('reminders.inEffect', {
          summary: [
            effective.enabled
              ? t('reminders.offsetBy', {
                  offset: formatOffset(tCommon, effective.offset_minutes),
                  channels: list(effective.channels.map((c) => t(`delivery.channel.${c}`))),
                })
              : t('common:states.off'),
            effective.quiet_start
              ? t('reminders.quietRange', { start: toWallClockInput(effective.quiet_start), end: toWallClockInput(effective.quiet_end) })
              : null,
            t('reminders.maxPerDay', { count: effective.max_per_day }),
          ]
            .filter(Boolean)
            .join(' · '),
        })}
        <span className="ml-2 text-slate-500">
          ({isPolicySetAtScope(effective.source, { serviceTypeId, teamId }) ? t('reminders.setHere', { scope: scopeLabel }) : t(`reminders.source.${effective.source}`)})
        </span>
      </p>

      {canEdit ? (
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.enabled} onChange={(e) => edit({ enabled: e.target.checked })} />
            {t('reminders.sendFor', { scope: scopeLabel })}
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="field">
              {t('reminders.hoursBefore')}
              <input
                className="input w-28"
                type="number"
                min={0.25}
                max={720}
                step={0.25}
                value={draft.hours}
                onChange={(e) => edit({ hours: e.target.value })}
                aria-invalid={invalidOffset}
              />
            </label>
            <label className="field">
              {t('reminders.perPersonPerDay')}
              <input
                className="input w-24"
                type="number"
                min={1}
                max={10}
                value={draft.maxPerDay}
                onChange={(e) => edit({ maxPerDay: Number(e.target.value) })}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4" role="group" aria-label={t('reminders.channels')}>
            {REMINDER_CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.channels.includes(channel)}
                  onChange={(e) => edit({
                    channels: e.target.checked ? [...draft.channels, channel] : draft.channels.filter((c) => c !== channel),
                  })}
                />
                {t(`delivery.channel.${channel}`)}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={draft.quiet} onChange={(e) => edit({ quiet: e.target.checked })} />
              {t('reminders.quietHours')}
            </label>
            {draft.quiet && (
              <>
                <label className="field">{t('reminders.quietFrom')}<input className="input" type="time" value={draft.quietStart} onChange={(e) => edit({ quietStart: e.target.value })} /></label>
                <label className="field">{t('reminders.quietUntil')}<input className="input" type="time" value={draft.quietEnd} onChange={(e) => edit({ quietEnd: e.target.value })} /></label>
              </>
            )}
          </div>
          {invalidOffset && <p className="text-red-600">{t('reminders.invalidOffset')}</p>}
          {invalidQuiet && <p className="text-red-600">{t('reminders.invalidQuiet')}</p>}
          <ErrorNotice error={save.error ?? reset.error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={save.isPending}
              disabled={problems.length > 0}
              onClick={() => save.mutate()}
            >
              {t('reminders.saveFor', { scope: scopeLabel })}
            </Button>
            {explicit && (
              <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>
                {t('reminders.useInherited')}
              </Button>
            )}
            {save.isSuccess && <span className="text-emerald-600">{t('reminders.savedRecomputed')}</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{t('reminders.readOnly')}</p>

      )}
    </fieldset>
  );
};

/**
 * F08 reminder policy for one scope: what is in effect (and where it is
 * inherited from) and, for people allowed to, an override for this scope.
 */
export const ReminderPolicyEditor = ({ serviceTypeId = null, teamId = null, scopeLabel }: ReminderPolicyEditorProps) => {
  const policies = useReminderPolicies({ serviceTypeId, teamId });
  if (policies.isLoading) return <div className="flex justify-center py-4 text-slate-400"><Spinner /></div>;
  if (!policies.data) return <ErrorNotice error={policies.error} />;
  return (
    <div className="space-y-4">
      {KINDS.map((kind) => {
        const effective = policies.data.effective.find((policy) => policy.kind === kind);
        if (!effective) return null;
        return (
          <PolicyForm
            key={`${kind}:${effective.policy_id ?? 'default'}:${effective.revision}`}
            kind={kind}
            effective={effective}
            explicit={policies.data.explicit.find((policy) => policy.kind === kind)}
            canEdit={policies.data.can_edit}
            serviceTypeId={serviceTypeId}
            teamId={teamId}
            scopeLabel={scopeLabel}
          />
        );
      })}
    </div>
  );
};
