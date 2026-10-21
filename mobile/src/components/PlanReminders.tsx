import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  REMINDER_CHANNELS,
  isDeliveryErrorCode,
  isReminderReasonCode,
  isPolicySetAtScope,
  planDeliveryByPerson,
  reminderPolicyDraftFrom,
  reminderPolicyRequest,
  toWallClockInput,
  validateReminderPolicyDraft,
  type DeliveryStatus,
  type EffectiveReminderPolicy,
  type PlanDeliveryHistoryItem,
  type PlanReminderJob,
  type ReminderKind,
  type ReminderPolicyDraft,
  type ReminderPolicyRow,
} from '@service-center/shared';
import { api } from '../lib/api';
import { queryKeys } from '../lib/query-keys';
import { policyWriteOutcome } from '../lib/plan-times-edit';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters } from '../i18n';
import { type Theme } from '../lib/theme';
import { useTheme, useThemedStyles } from '../lib/useTheme';
import { Button, Card, Chip, Divider, ErrorNotice, Field, Label, Loading, Tag } from './ui';

const KINDS: readonly ReminderKind[] = ['pending_response', 'confirmed_service'];

/** 1500 → "1 day 1 hour", worded like the website's reminder settings. */
const offsetText = (t: TFunction<'common'>, minutes: number): string => {
  const parts = [
    Math.floor(minutes / 1440) ? t('duration.days', { count: Math.floor(minutes / 1440) }) : '',
    Math.floor((minutes % 1440) / 60) ? t('duration.hours', { count: Math.floor((minutes % 1440) / 60) }) : '',
    minutes % 60 ? t('duration.minutes', { count: minutes % 60 }) : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : t('duration.minutes', { count: 0 });
};

export interface PlanReminderPolicyCardProps {
  /** The plan's service type; `null` reads the organization scope. */
  serviceTypeId: string | null;
}

/**
 * MOB-015 / F08: the reminder policy in effect for this plan's service type
 * (or the church when it has none) — where it is inherited from, and, when
 * the server says `can_edit`, an override for that scope or "Use inherited
 * setting". Saves through `saveReminderPolicy` with the loaded revision; jobs
 * are recomputed by the server. Nothing is scheduled on this phone.
 */
export const PlanReminderPolicyCard = ({ serviceTypeId }: PlanReminderPolicyCardProps) => {
  const { t } = useTranslation(['plans', 'settings']);
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const policies = useQuery({
    queryKey: queryKeys.reminderPolicies(queryScope, serviceTypeId, null),
    queryFn: () => api.reminderPolicies(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
    enabled: Boolean(queryScope),
  });
  const scopeLabel = serviceTypeId ? t('mobileTimes.remindersScope') : t('mobileTimes.remindersOrgScope');

  return (
    <Card>
      <Label>{t('mobileTimes.reminders')}</Label>
      <Text style={styles.hint}>{t('mobileTimes.remindersHint')}</Text>
      {policies.isLoading ? <Loading /> : null}
      <ErrorNotice error={policies.error} />
      {policies.data
        ? KINDS.map((kind) => {
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
                scopeLabel={scopeLabel}
              />
            );
          })
        : null}
      {serviceTypeId ? <Text style={styles.hint}>{t('mobileTimes.remindersTeamHint')}</Text> : null}
    </Card>
  );
};

interface PolicyFormProps {
  kind: ReminderKind;
  effective: EffectiveReminderPolicy;
  explicit: ReminderPolicyRow | undefined;
  canEdit: boolean;
  serviceTypeId: string | null;
  scopeLabel: string;
}

const PolicyForm = ({ kind, effective, explicit, canEdit, serviceTypeId, scopeLabel }: PolicyFormProps) => {
  const { t } = useTranslation(['settings', 'plans', 'common']);
  const { t: tCommon } = useTranslation('common');
  const format = useFormatters();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  // Keyed by the effective policy's revision: a save or reset elsewhere starts a fresh draft.
  const [draft, setDraft] = useState<ReminderPolicyDraft>(() => reminderPolicyDraftFrom(effective));
  const [editing, setEditing] = useState(false);
  const edit = (patch: Partial<ReminderPolicyDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const problems = validateReminderPolicyDraft(draft);

  const refresh = () =>
    isCurrentGeneration(generation)
      ? Promise.all([
          queryClient.invalidateQueries({ queryKey: [...queryKeys.privateRoot(queryScope), 'reminder-policies'] }),
          queryClient.invalidateQueries({ queryKey: [...queryKeys.privateRoot(queryScope), 'plan-deliveries'] }),
        ])
      : undefined;
  const save = useMutation({
    mutationFn: () => api.saveReminderPolicy(reminderPolicyRequest(draft, kind, { serviceTypeId }, explicit)),
    onSettled: refresh,
  });
  const reset = useMutation({
    mutationFn: () => api.deleteReminderPolicy(explicit!.id),
    onSettled: refresh,
  });
  const error = save.error ?? reset.error;
  const outcome = error ? policyWriteOutcome(error) : null;

  const channelNames = format.list(effective.channels.map((channel) => t(`delivery.channel.${channel}`)));
  const summary = [
    effective.enabled
      ? t('reminders.offsetBy', { offset: offsetText(tCommon, effective.offset_minutes), channels: channelNames })
      : t('common:states.off'),
    effective.quiet_start
      ? t('reminders.quietRange', { start: toWallClockInput(effective.quiet_start), end: toWallClockInput(effective.quiet_end) })
      : null,
    t('reminders.maxPerDay', { count: effective.max_per_day }),
  ].filter(Boolean).join(' · ');
  const source = isPolicySetAtScope(effective.source, { serviceTypeId })
    ? t('reminders.setHere', { scope: scopeLabel })
    : t(`reminders.source.${effective.source}`);

  return (
    <View style={styles.policy}>
      <Divider />
      <Text style={styles.strong}>{t(`reminders.kind.${kind}`)}</Text>
      <Text style={styles.muted}>{t(`reminders.kindDescription.${kind}`)}</Text>
      <Text style={styles.body}>{t('reminders.inEffect', { summary })}</Text>
      <Text style={styles.muted}>{source}</Text>
      {outcome === 'stale' ? (
        <Text accessibilityRole="alert" style={styles.warning}>{t('plans:mobileTimes.policyStale')}</Text>
      ) : (
        <ErrorNotice error={error} />
      )}
      {save.isSuccess ? <Text style={styles.muted}>{t('reminders.savedRecomputed')}</Text> : null}

      {!canEdit ? (
        <Text style={styles.muted}>{t('reminders.readOnly')}</Text>
      ) : editing ? (
        <View style={styles.form}>
          <View style={styles.switchRow}>
            <Text style={[styles.body, styles.flex]}>{t('reminders.sendFor', { scope: scopeLabel })}</Text>
            <Switch value={draft.enabled} onValueChange={(enabled) => edit({ enabled })} accessibilityLabel={t('reminders.sendFor', { scope: scopeLabel })} />
          </View>
          <Field
            label={t('reminders.hoursBefore')}
            value={draft.hours}
            keyboardType="decimal-pad"
            onChangeText={(hours) => edit({ hours })}
          />
          {problems.includes('offset') ? <Text style={styles.problem}>{t('reminders.invalidOffset')}</Text> : null}
          <Field
            label={t('reminders.perPersonPerDay')}
            value={String(draft.maxPerDay)}
            keyboardType="number-pad"
            onChangeText={(value) => edit({ maxPerDay: Number(value) })}
          />
          <Text style={styles.muted}>{t('reminders.channels')}</Text>
          <View style={styles.chips}>
            {REMINDER_CHANNELS.map((channel) => (
              <Chip
                key={channel}
                label={t(`delivery.channel.${channel}`)}
                active={draft.channels.includes(channel)}
                onPress={() => edit({
                  channels: draft.channels.includes(channel)
                    ? draft.channels.filter((value) => value !== channel)
                    : [...draft.channels, channel],
                })}
              />
            ))}
          </View>
          <View style={styles.switchRow}>
            <Text style={[styles.body, styles.flex]}>{t('reminders.quietHours')}</Text>
            <Switch value={draft.quiet} onValueChange={(quiet) => edit({ quiet })} accessibilityLabel={t('reminders.quietHours')} />
          </View>
          {draft.quiet ? (
            <View style={styles.chips}>
              <View style={styles.flex}>
                <Field label={t('reminders.quietFrom')} value={draft.quietStart} placeholder="21:00" maxLength={5} onChangeText={(quietStart) => edit({ quietStart })} />
              </View>
              <View style={styles.flex}>
                <Field label={t('reminders.quietUntil')} value={draft.quietEnd} placeholder="08:00" maxLength={5} onChangeText={(quietEnd) => edit({ quietEnd })} />
              </View>
            </View>
          ) : null}
          {problems.includes('quiet') ? <Text style={styles.problem}>{t('reminders.invalidQuiet')}</Text> : null}
          <View style={styles.chips}>
            <Button
              title={t('reminders.saveFor', { scope: scopeLabel })}
              loading={save.isPending}
              disabled={problems.length > 0 || reset.isPending}
              onPress={() => {
                reset.reset();
                save.mutate();
              }}
            />
            <Button title={t('common:actions.cancel')} variant="quiet" onPress={() => { setDraft(reminderPolicyDraftFrom(effective)); setEditing(false); }} />
          </View>
        </View>
      ) : (
        <View style={styles.chips}>
          <Button title={t('common:actions.edit')} variant="secondary" icon="pencil" onPress={() => setEditing(true)} />
          {explicit ? (
            <Button
              title={t('reminders.useInherited')}
              variant="quiet"
              loading={reset.isPending}
              onPress={() => {
                save.reset();
                reset.mutate();
              }}
            />
          ) : null}
        </View>
      )}
    </View>
  );
};

export interface PlanDeliveryCardProps {
  planId: string;
}

/**
 * MOB-015 / F08: the website's "Reminders and delivery" panel — per Person,
 * the reminders the server has scheduled (or skipped, with the reason) and
 * what happened to each request on each channel. "Accepted by provider"
 * never means read. Retry is administrator-only, as on the website.
 */
export const PlanDeliveryCard = ({ planId }: PlanDeliveryCardProps) => {
  const { t } = useTranslation(['staffing', 'plans', 'common']);
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: queryKeys.planDeliveries(queryScope, planId),
    queryFn: () => api.planDeliveryHistory(planId),
    enabled: Boolean(queryScope && open),
  });
  const people = planDeliveryByPerson(history.data);

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Label>{t('planDelivery.title')}</Label>
          <Text style={styles.muted}>{t('planDelivery.description')}</Text>
        </View>
        <Button
          title={open ? t('planDelivery.hide') : t('planDelivery.show')}
          variant="secondary"
          onPress={() => setOpen((value) => !value)}
        />
      </View>
      {open ? (
        history.isLoading ? (
          <Loading />
        ) : people.length === 0 && !history.error ? (
          <Text style={styles.muted}>{t('planDelivery.empty')}</Text>
        ) : (
          people.map((person) => (
            <View key={person.personId} style={styles.person}>
              <Divider />
              <Text style={styles.strong}>{person.name}</Text>
              {person.reminders.map((job) => <ReminderLine key={job.id} job={job} />)}
              {person.deliveries.map((item) => <DeliveryLine key={item.id} item={item} planId={planId} />)}
            </View>
          ))
        )
      ) : null}
      <ErrorNotice error={history.error} />
    </Card>
  );
};

interface ReminderLineProps {
  job: PlanReminderJob;
}

const ReminderLine = ({ job }: ReminderLineProps) => {
  const { t } = useTranslation(['staffing']);
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const due = format.dateTime(job.due_at);
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text style={styles.body}>
          {t('planDelivery.templateChannel', { template: t(`reminderKind.${job.kind}`), channel: t(`deliveryChannel.${job.channel}`) })}
        </Text>
        <Text style={styles.muted}>
          {job.status === 'scheduled' ? t('planDelivery.due', { time: due }) : t('planDelivery.wasDue', { time: due })}
        </Text>
        {job.status_reason ? (
          <Text style={styles.muted}>
            {isReminderReasonCode(job.status_reason) ? t(`reminderReason.${job.status_reason}`) : job.status_reason}
          </Text>
        ) : null}
      </View>
      <Text style={styles.status}>{t(`reminderJobStatus.${job.status}`)}</Text>
    </View>
  );
};

/** Delivery statuses shown with a success or attention accent; the rest are neutral. */
const GOOD: ReadonlySet<DeliveryStatus> = new Set(['provider_accepted', 'delivered']);
const ATTENTION: ReadonlySet<DeliveryStatus> = new Set(['failed', 'ambiguous']);

interface DeliveryLineProps {
  item: PlanDeliveryHistoryItem;
  planId: string;
}

const DeliveryLine = ({ item, planId }: DeliveryLineProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const format = useFormatters();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const theme = useTheme();
  const retry = useMutation({
    mutationFn: () => api.retryDelivery(item.id),
    onSettled: () =>
      isCurrentGeneration(generation)
        ? queryClient.invalidateQueries({ queryKey: queryKeys.planDeliveries(queryScope, planId) })
        : undefined,
  });
  const accent = GOOD.has(item.status) ? theme.accent.green : ATTENTION.has(item.status) ? theme.accent.yellow : theme.accent.blue;
  return (
    <View style={styles.line}>
      <View style={styles.flex}>
        <Text style={styles.body}>
          {t('planDelivery.templateChannel', { template: t(`deliveryTemplate.${item.template}`), channel: t(`deliveryChannel.${item.channel}`) })}
        </Text>
        <Text style={styles.muted}>{format.dateTime(item.created_at)}</Text>
        {item.error_code ? <Text style={styles.muted}>{isDeliveryErrorCode(item.error_code) ? t(`deliveryError.${item.error_code}`) : item.error_code}</Text> : null}
        {item.next_attempt_at ? <Text style={styles.muted}>{t('planDelivery.nextTry', { time: format.dateTime(item.next_attempt_at) })}</Text> : null}
        <ErrorNotice error={retry.error} />
      </View>
      <View style={styles.trailing}>
        <Tag label={t(`deliveryStatus.${item.status}`)} accent={accent} />
        {item.can_retry ? (
          <Button title={t('common:actions.retry')} variant="secondary" loading={retry.isPending} onPress={() => retry.mutate()} />
        ) : null}
      </View>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    policy: { gap: theme.space.xs },
    form: { gap: theme.space.sm, marginTop: theme.space.sm },
    person: { gap: theme.space.xs },
    line: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, paddingVertical: theme.space.xs },
    trailing: { alignItems: 'flex-end', gap: theme.space.xs },
    chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 44 },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    status: { ...theme.type.label, color: theme.color.inkMuted },
    problem: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
