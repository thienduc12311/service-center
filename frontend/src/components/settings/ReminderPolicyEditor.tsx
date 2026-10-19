import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  DELIVERY_CHANNEL_LABELS,
  REMINDER_KIND_DESCRIPTIONS,
  REMINDER_KIND_LABELS,
  REMINDER_POLICY_SOURCE_LABELS,
  formatReminderOffset,
  isPolicySetAtScope,
  toWallClockInput,
  type DeliveryChannel,
  type EffectiveReminderPolicy,
  type ReminderKind,
  type ReminderPolicyRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useInvalidateOrg, useReminderPolicies } from '../../hooks/queries';
import { Button, ErrorNotice, Spinner } from '../ui';

const CHANNELS: readonly DeliveryChannel[] = ['in_app', 'push', 'email'];
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

/** Offsets are edited in hours; stored in minutes. */
const hoursOf = (minutes: number): string => String(Math.round((minutes / 60) * 100) / 100);

const PolicyForm = ({ kind, effective, explicit, canEdit, serviceTypeId, teamId, scopeLabel }: PolicyFormProps) => {
  const invalidate = useInvalidateOrg();
  const [enabled, setEnabled] = useState(effective.enabled);
  const [hours, setHours] = useState(hoursOf(effective.offset_minutes));
  const [channels, setChannels] = useState<DeliveryChannel[]>(effective.channels);
  const [quiet, setQuiet] = useState(Boolean(effective.quiet_start));
  const [quietStart, setQuietStart] = useState(toWallClockInput(effective.quiet_start) || '21:00');
  const [quietEnd, setQuietEnd] = useState(toWallClockInput(effective.quiet_end) || '08:00');
  const [maxPerDay, setMaxPerDay] = useState(effective.max_per_day);

  useEffect(() => {
    setEnabled(effective.enabled);
    setHours(hoursOf(effective.offset_minutes));
    setChannels(effective.channels);
    setQuiet(Boolean(effective.quiet_start));
    setQuietStart(toWallClockInput(effective.quiet_start) || '21:00');
    setQuietEnd(toWallClockInput(effective.quiet_end) || '08:00');
    setMaxPerDay(effective.max_per_day);
  }, [effective]);

  const save = useMutation({
    mutationFn: () => api.saveReminderPolicy({
      service_type_id: serviceTypeId,
      team_id: teamId,
      kind,
      enabled,
      offset_minutes: Math.round(Number(hours) * 60),
      channels,
      quiet_start: quiet ? quietStart : null,
      quiet_end: quiet ? quietEnd : null,
      max_per_day: maxPerDay,
      ...(explicit ? { expected_revision: explicit.revision } : {}),
    }),
    onSuccess: invalidate,
  });
  const reset = useMutation({
    mutationFn: () => api.deleteReminderPolicy(explicit!.id),
    onSuccess: invalidate,
  });

  const offsetMinutes = Math.round(Number(hours) * 60);
  const invalidOffset = !Number.isFinite(offsetMinutes) || offsetMinutes < 15 || offsetMinutes > 43200;
  const invalidQuiet = quiet && quietStart === quietEnd;

  return (
    <fieldset className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
      <legend className="px-1 text-sm font-medium">{REMINDER_KIND_LABELS[kind]}</legend>
      <p className="mb-2 text-sm text-slate-500">{REMINDER_KIND_DESCRIPTIONS[kind]}</p>
      <p className="mb-3 text-sm">
        In effect: {effective.enabled
          ? `${formatReminderOffset(effective.offset_minutes)} before, by ${effective.channels.map((c) => DELIVERY_CHANNEL_LABELS[c]).join(', ')}`
          : 'Off'}
        {effective.quiet_start && ` · quiet ${toWallClockInput(effective.quiet_start)}–${toWallClockInput(effective.quiet_end)}`}
        {` · at most ${effective.max_per_day} a day per channel`}
        <span className="ml-2 text-slate-500">
          ({isPolicySetAtScope(effective.source, { serviceTypeId, teamId }) ? `Set here for ${scopeLabel}` : REMINDER_POLICY_SOURCE_LABELS[effective.source]})
        </span>
      </p>

      {canEdit ? (
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Send this reminder for {scopeLabel}
          </label>
          <div className="flex flex-wrap items-end gap-4">
            <label className="field">
              Hours before
              <input
                className="input w-28"
                type="number"
                min={0.25}
                max={720}
                step={0.25}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={invalidOffset}
              />
            </label>
            <label className="field">
              Per person per day
              <input
                className="input w-24"
                type="number"
                min={1}
                max={10}
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4" role="group" aria-label="Channels">
            {CHANNELS.map((channel) => (
              <label key={channel} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={channels.includes(channel)}
                  onChange={(e) => setChannels((current) =>
                    e.target.checked ? [...current, channel] : current.filter((c) => c !== channel))}
                />
                {DELIVERY_CHANNEL_LABELS[channel]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2">
              <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
              Quiet hours (organization time zone)
            </label>
            {quiet && (
              <>
                <label className="field">From<input className="input" type="time" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></label>
                <label className="field">Until<input className="input" type="time" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></label>
              </>
            )}
          </div>
          {invalidOffset && <p className="text-red-600">Choose between 15 minutes and 30 days.</p>}
          {invalidQuiet && <p className="text-red-600">Quiet hours must start and end at different times.</p>}
          <ErrorNotice error={save.error ?? reset.error} />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              loading={save.isPending}
              disabled={invalidOffset || invalidQuiet || channels.length === 0}
              onClick={() => save.mutate()}
            >
              Save for {scopeLabel}
            </Button>
            {explicit && (
              <Button variant="ghost" loading={reset.isPending} onClick={() => reset.mutate()}>
                Use inherited setting
              </Button>
            )}
            {save.isSuccess && <span className="text-emerald-600">Saved. Upcoming reminders will be recomputed.</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500">You can see this setting but not change it.</p>
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
