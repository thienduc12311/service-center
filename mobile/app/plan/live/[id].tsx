import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ApiError,
  LIVE_IDLE_POLL_MS,
  LIVE_STATUS_ACCENTS,
  effectiveTransitionTimes,
  formatLiveDuration,
  liveRunSchedule,
  type LiveCountdownPolicy,
  type LivePlanRuns,
  type LiveRunHistory,
  type LiveRunState,
  type LiveRunWarningCode,
  type LiveServiceTimeOption,
  type LiveView,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import { liveClientId, liveControls, liveRefusalText, type LiveConnection } from '../../../src/lib/live-run';
import { useLiveRun, type LiveRunHandle } from '../../../src/lib/useLiveRun';
import { useScreenVisible } from '../../../src/lib/useScreenVisible';
import { useAuth } from '../../../src/providers/AuthProvider';
import { useErrorText, useFormatters, useLanguage } from '../../../src/i18n';
import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Meta,
  Screen,
  Tag,
  screenPadding,
} from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/** Every countdown policy, in the website's picker order. */
const LIVE_POLICIES: readonly LiveCountdownPolicy[] = ['item', 'planned_end', 'service_end'];

const WARNING_KEYS: Record<LiveRunWarningCode, 'live.warnings.planChanged' | 'live.warnings.timeMoved' | 'live.warnings.timeRemoved'> = {
  plan_changed_since_snapshot: 'live.warnings.planChanged',
  service_time_moved: 'live.warnings.timeMoved',
  service_time_removed: 'live.warnings.timeRemoved',
};

/** Route params: the plan, and the run being shown (the website's `?run=`). */
type LiveParams = {
  id: string;
  run?: string;
};

/** One create attempt; a retry after a lost response reuses the key and gets the same run back. */
interface CreateRunVariables {
  time: LiveServiceTimeOption;
  policy: LiveCountdownPolicy;
  key: string;
}

/** The confirmations that need a reason field (End uses a system alert). */
type ReasonConfirm = 'take_over' | 'discard';

/** Wall-clock time with seconds ("9:41:07 AM"), as the website shows Live timing. */
const useTimeOfDay = (): ((iso: string | null) => string) => {
  const { formatLocale } = useLanguage();
  return useCallback(
    (iso: string | null) => {
      if (!iso) return '—';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat(formatLocale, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
    },
    [formatLocale],
  );
};

const finishLine = (view: LiveView, t: TFunction<'media'>, timeOfDay: (iso: string | null) => string): string | null => {
  if (!view.planned_finish_at) return null;
  const planned = timeOfDay(view.planned_finish_at);
  if (!view.projected_finish_at || view.finish_delta_seconds === null) return t('live.finish.planned', { time: planned });
  const delta = view.finish_delta_seconds;
  const values = { planned, projected: timeOfDay(view.projected_finish_at) };
  if (delta === 0) return t('live.finish.onTime', values);
  return delta > 0
    ? t('live.finish.late', { ...values, delta: formatLiveDuration(delta) })
    : t('live.finish.early', { ...values, delta: formatLiveDuration(-delta) });
};

const connectionText = (connection: LiveConnection, secondsAgo: number | null, t: TFunction<'media'>): string => {
  const count = secondsAgo ?? 0;
  if (connection === 'offline') return t('live.connection.offline', { count });
  if (connection === 'stale') return t('live.connection.stale', { count });
  return t('live.connection.live', { count });
};

/**
 * MOB-023: F12 Live on native — the website's `/plans/:id/live`. Pick a
 * service time (each has its own run), follow its authoritative state, and —
 * with `plans.edit` and the controller lease — start, advance, pause, jump,
 * end, take over or discard it. Every command carries the run revision and a
 * fresh action id; a lost response is retried with the same id. History and
 * planned-versus-actual are read here; corrections and the stage display stay
 * on the website.
 */
export default function LiveScreen() {
  const params = useLocalSearchParams<LiveParams>();
  const planId = params.id;
  const runId = params.run ?? null;
  const { t } = useTranslation(['media', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  const timeOfDay = useTimeOfDay();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const visible = useScreenVisible();
  const live = useLiveRun(runId);
  const [policy, setPolicy] = useState<LiveCountdownPolicy>('item');
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(queryScope && planId),
  });
  const runs = useQuery({
    queryKey: queryKeys.liveRuns(queryScope, planId),
    queryFn: () => api.liveRuns(planId!),
    enabled: Boolean(queryScope && planId),
    refetchInterval: visible ? LIVE_IDLE_POLL_MS : false,
  });

  // A run's status changed (started, ended, discarded): the picker shows it too.
  const runStatus = live.state?.run.status;
  useEffect(() => {
    if (runStatus) void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(queryScope, planId) });
  }, [runStatus, queryClient, queryScope, planId]);

  const create = useMutation({
    mutationFn: ({ time, policy: countdown, key }: CreateRunVariables & { createGeneration: number }) =>
      api.createLiveRun(planId!, {
        plan_time_id: time.id,
        countdown_policy: countdown,
        idempotency_key: key,
        client_id: liveClientId(),
      }),
    onSuccess: (state: LiveRunState, { createGeneration }) => {
      if (!isCurrentGeneration(createGeneration)) return;
      setPendingKey(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(queryScope, planId) });
      router.setParams({ run: state.run.id });
    },
    onError: (error) => {
      // A refusal (e.g. another device created it first) gets a fresh key next time; no answer keeps it.
      if (error instanceof ApiError) setPendingKey(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(queryScope, planId) });
    },
  });

  const openChat = useMutation({
    mutationFn: () => api.openConversation({ kind: 'plan', target_id: planId! }),
    onSuccess: async (conversation) => {
      if (!isCurrentGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll(queryScope) });
      router.push({ pathname: '/chat/[id]', params: { id: conversation.id } });
    },
  });

  const title = plan.data?.title ? t('live.page.title', { title: plan.data.title }) : t('live.mobile.screenTitle');

  if (runs.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('live.mobile.screenTitle') }} />
        <Loading />
      </Screen>
    );
  }
  if (runs.error || !runs.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('live.mobile.screenTitle') }} />
        <View style={[screenPadding(theme), styles.content]}>
          <ErrorNotice error={runs.error} />
          <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void runs.refetch()} />
        </View>
      </Screen>
    );
  }

  const data = runs.data;
  const earlier = data.runs.filter((run) => run.status === 'discarded' || run.status === 'ended');

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={96}>
        <ScrollView contentContainerStyle={[screenPadding(theme), styles.content]} keyboardShouldPersistTaps="handled">
          <ServiceTimes
            data={data}
            runId={runId}
            policy={policy}
            onPolicy={setPolicy}
            creatingTimeId={create.isPending ? (create.variables?.time.id ?? null) : null}
            onCreate={(time) => {
              const key = pendingKey ?? newIdempotencyKey();
              setPendingKey(key);
              create.mutate({ time, policy, key, createGeneration: generation });
            }}
            onOpen={(id) => router.setParams({ run: id })}
          />
          <ErrorNotice error={create.error} />

          {!runId ? (
            <EmptyState
              title={t('live.page.chooseTime')}
              description={data.can_control ? t('live.page.chooseTimeController') : t('live.page.chooseTimeViewer')}
            />
          ) : live.connection === 'revoked' ? (
            <EmptyState title={t('live.page.unavailableTitle')} description={t('live.page.unavailableDescription')} />
          ) : live.loading ? (
            <Loading label={t('live.page.loadingRun')} />
          ) : !live.state && live.connection === 'offline' ? (
            <Card>
              <Text style={styles.body}>{t('live.mobile.offlineNoState')}</Text>
              <Button title={t('common:actions.retry')} variant="secondary" onPress={live.reload} />
            </Card>
          ) : live.state ? (
            <>
              <RunPanel live={live} />
              <Button
                title={showHistory ? t('live.page.hideHistory') : t('live.page.showHistory')}
                variant="secondary"
                onPress={() => setShowHistory((open) => !open)}
              />
              {showHistory ? <HistoryCard runId={runId} revision={live.state.run.revision} /> : null}
            </>
          ) : (
            <ErrorNotice error={live.loadError} />
          )}

          {earlier.length ? (
            <Card>
              <Label>{t('live.history.title')}</Label>
              <View style={styles.chips}>
                {earlier.map((run) => (
                  <Chip
                    key={run.id}
                    active={run.id === runId}
                    onPress={() => router.setParams({ run: run.id })}
                    label={
                      run.started_at
                        ? t('live.mobile.earlierRunStarted', {
                            name: run.time_name ?? t('live.service'),
                            status: t(`live.status.${run.status}`),
                            time: f.dateTime(run.started_at),
                          })
                        : t('live.mobile.earlierRun', { name: run.time_name ?? t('live.service'), status: t(`live.status.${run.status}`) })
                    }
                  />
                ))}
              </View>
            </Card>
          ) : null}

          {/* F09 plan chat is the run's chat (MOB-019); a dedicated run chat is not a contract yet. */}
          <Button
            title={t('live.page.planChat')}
            icon="chat"
            variant="secondary"
            loading={openChat.isPending}
            onPress={() => openChat.mutate()}
          />
          {openChat.error ? (
            <Meta>{t('live.page.planChatDenied')}</Meta>
          ) : null}
          <Meta>{t('live.mobile.stageOnWebsite')}</Meta>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

interface ServiceTimesProps {
  data: LivePlanRuns;
  runId: string | null;
  policy: LiveCountdownPolicy;
  onPolicy: (policy: LiveCountdownPolicy) => void;
  creatingTimeId: string | null;
  onCreate: (time: LiveServiceTimeOption) => void;
  onOpen: (runId: string) => void;
}

/** Each service time is its own occurrence with at most one current run. */
const ServiceTimes = ({ data, runId, policy, onPolicy, creatingTimeId, onCreate, onOpen }: ServiceTimesProps) => {
  const { t } = useTranslation('media');
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  return (
    <Card>
      <Label>{t('live.page.serviceTimes')}</Label>
      {data.service_times.length === 0 ? <Text style={styles.muted}>{t('live.page.noServiceTimes')}</Text> : null}
      {data.service_times.map((time) => (
        <View key={time.id} style={styles.timeRow}>
          <View style={styles.flex}>
            <Text style={styles.strong}>{time.name ?? t('live.service')}</Text>
            <Text style={styles.muted}>{f.dateTime(time.starts_at)}</Text>
          </View>
          {time.run_id ? (
            <Button
              title={time.run_id === runId
                ? t('live.page.showing', { status: t(`live.status.${time.run_status!}`) })
                : t('live.page.open', { status: t(`live.status.${time.run_status!}`) })}
              variant={time.run_id === runId ? 'quiet' : 'secondary'}
              onPress={() => onOpen(time.run_id!)}
            />
          ) : data.can_control ? (
            <Button
              title={t('live.page.createRun')}
              loading={creatingTimeId === time.id}
              disabled={creatingTimeId !== null}
              onPress={() => onCreate(time)}
            />
          ) : (
            <Text style={styles.muted}>{t('live.page.noRun')}</Text>
          )}
        </View>
      ))}
      {data.can_control && data.service_times.some((time) => !time.run_id) ? (
        <>
          <Label>{t('live.page.countdownForNew')}</Label>
          <View style={styles.chips}>
            {LIVE_POLICIES.map((option) => (
              <Chip key={option} label={t(`live.policies.${option}`)} active={policy === option} onPress={() => onPolicy(option)} />
            ))}
          </View>
        </>
      ) : null}
    </Card>
  );
};

interface CountdownProps {
  view: LiveView;
}

/** The countdown, honest about overruns and items without a length (never a negative countdown). */
const Countdown = ({ view }: CountdownProps) => {
  const { t } = useTranslation('media');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  if (!view.current) return null;
  if (view.remaining_seconds === null) {
    return (
      <View accessible accessibilityLabel={`${formatLiveDuration(view.elapsed_seconds)} ${t('live.countdown.elapsed')}`}>
        <Text style={styles.clock}>{formatLiveDuration(view.elapsed_seconds)}</Text>
        <Text style={styles.muted}>{t('live.countdown.elapsed')}</Text>
      </View>
    );
  }
  if (view.overrun_seconds > 0) {
    const label = t('live.countdown.over', { policy: t(`live.policies.${view.countdown_policy}`) });
    return (
      <View accessible accessibilityLabel={`+${formatLiveDuration(view.overrun_seconds)} ${label}`}>
        <Text style={[styles.clock, { color: theme.accent.red.fg }]}>+{formatLiveDuration(view.overrun_seconds)}</Text>
        <Text style={[styles.muted, { color: theme.accent.red.fg }]}>{label}</Text>
      </View>
    );
  }
  const label = t('live.countdown.remaining', { policy: t(`live.policies.${view.countdown_policy}`) });
  return (
    <View accessible accessibilityLabel={`${formatLiveDuration(view.remaining_seconds)} ${label}`}>
      <Text style={styles.clock}>{formatLiveDuration(view.remaining_seconds)}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
};

interface RunPanelProps {
  live: LiveRunHandle;
}

/** The website's `LiveRunPanel`: status, current/next, timers, control and the pinned order. */
const RunPanel = ({ live }: RunPanelProps) => {
  const { t } = useTranslation(['media', 'common']);
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const f = useFormatters();
  const timeOfDay = useTimeOfDay();
  const errorText = useErrorText();
  const [confirm, setConfirm] = useState<ReasonConfirm | null>(null);
  const [reason, setReason] = useState('');
  const { state, view, control } = live;
  if (!state || !view || !control) return null;

  const { run } = state;
  const controls = liveControls({ state, view, control, connection: live.connection, busy: live.pending !== null });
  const schedule = liveRunSchedule(run);
  const plannedStart = new Map(schedule.items.map((slot) => [slot.item_id, slot.starts_at]));
  const active = run.status === 'live' || run.status === 'paused';
  const over = run.status === 'ended' || run.status === 'discarded';
  const finish = finishLine(view, t, timeOfDay);
  const closeConfirm = () => {
    setConfirm(null);
    setReason('');
  };
  const refusal = live.commandError === null ? null : liveRefusalText(live.commandError);
  const refusalMessage =
    refusal === null ? null
    : refusal.key === null ? errorText(refusal.error)
    : refusal.key === 'live.refusal.notApplied' ? t(refusal.key, { reason: errorText(refusal.reasonFrom) })
    : t(refusal.key);

  const confirmEnd = () =>
    Alert.alert(t('live.confirm.endTitle'), t('live.confirm.endBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('live.endRun'), style: 'destructive', onPress: () => live.send({ action: 'end' }) },
    ]);

  return (
    <>
      <Card>
        <View style={styles.statusRow}>
          <Tag label={t(`live.status.${run.status}`)} accent={theme.accent[LIVE_STATUS_ACCENTS[run.status]]} />
          <Text style={[styles.muted, styles.flex]}>
            {t('live.mobile.runFor', { name: run.time_name ?? t('live.service'), date: f.dateTime(run.time_starts_at) })}
          </Text>
        </View>
        <Text
          style={[styles.muted, live.connection !== 'live' && { color: theme.accent.yellow.fg }]}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          {connectionText(live.connection, live.lastUpdatedSecondsAgo, t)}
        </Text>

        {state.warnings.map((warning) => (
          <View key={warning.code} style={[styles.notice, { backgroundColor: theme.accent.yellow.bg }]}>
            <Text style={[styles.body, { color: theme.accent.yellow.fg }]}>{t(WARNING_KEYS[warning.code])}</Text>
            {warning.code === 'plan_changed_since_snapshot' && controls.refreshSnapshot ? (
              <Button title={t('live.useCurrentOrder')} variant="secondary" onPress={() => live.send({ action: 'refresh_snapshot' })} />
            ) : null}
          </View>
        ))}
        {run.status === 'discarded' ? <Text style={styles.body}>{t('live.discardedReason', { reason: run.discarded_reason })}</Text> : null}

        <Divider />

        {run.status === 'ready' ? (
          <View>
            <Text style={styles.muted}>{t('live.notStarted')}</Text>
            <Text style={styles.current}>{view.next?.title ?? t('live.nothingToRun')}</Text>
          </View>
        ) : null}
        {active && view.current ? (
          <View style={styles.currentBlock}>
            {view.section ? <Text style={styles.section}>{view.section}</Text> : null}
            <Text style={styles.current} accessibilityRole="header">{view.current.title}</Text>
            {run.status === 'paused' ? <Text style={[styles.strong, { color: theme.accent.yellow.fg }]}>{t('live.status.paused')}</Text> : null}
            <Countdown view={view} />
            <Text style={styles.body}>{view.next ? t('live.next', { title: view.next.title }) : t('live.nextNothing')}</Text>
          </View>
        ) : null}
        {over ? (
          <Text style={styles.body}>
            {run.status === 'ended' ? t('live.endedAt', { time: timeOfDay(run.ended_at) }) : t('live.wasDiscarded')}
          </Text>
        ) : null}
        {finish ? <Text style={styles.muted}>{finish}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.body}>
          {control.held_by_you
            ? t('live.control.you', { count: control.lease_seconds_left ?? 0 })
            : control.held
              ? control.holder_name
                ? t('live.control.held', { name: control.holder_name })
                : t('live.control.heldUnknown')
              : over
                ? t('live.control.finished')
                : t('live.control.nobody')}
        </Text>
        {control.held_by_you ? <Meta>{t('live.mobile.leaseForeground')}</Meta> : null}

        {controls.takeControl ? (
          <Button
            title={t('live.takeControl')}
            loading={live.pending?.action === 'take_control'}
            onPress={() => live.send({ action: 'take_control' })}
          />
        ) : null}
        {controls.takeOver ? (
          <Button
            title={control.holder_name ? t('live.takeOverFrom', { name: control.holder_name }) : t('live.takeOverFromController')}
            variant="secondary"
            onPress={() => setConfirm('take_over')}
          />
        ) : null}

        {controls.start ? (
          <Button title={t('live.start')} loading={live.pending?.action === 'start'} onPress={() => live.send({ action: 'start' })} />
        ) : null}
        {control.held_by_you && active ? (
          <>
            <Button
              title={t('live.nextButton')}
              disabled={!controls.next}
              loading={live.pending?.action === 'advance'}
              onPress={() => live.send({ action: 'advance' })}
            />
            <View style={styles.row}>
              <Button
                title={t('live.back')}
                variant="secondary"
                disabled={!controls.back}
                style={styles.flex}
                onPress={() => controls.previousIndex !== null && live.send({ action: 'jump', target_index: controls.previousIndex })}
              />
              {run.status === 'live' ? (
                <Button
                  title={t('live.pause')}
                  variant="secondary"
                  disabled={!controls.pause}
                  loading={live.pending?.action === 'pause'}
                  style={styles.flex}
                  onPress={() => live.send({ action: 'pause' })}
                />
              ) : (
                <Button
                  title={t('live.resume')}
                  variant="secondary"
                  disabled={!controls.resume}
                  loading={live.pending?.action === 'resume'}
                  style={styles.flex}
                  onPress={() => live.send({ action: 'resume' })}
                />
              )}
            </View>
            <Button title={t('live.endRun')} variant="danger" disabled={!controls.end} onPress={confirmEnd} />
          </>
        ) : null}

        {control.held_by_you && !over ? (
          <>
            <Label>{t('live.countdownLabel')}</Label>
            <View style={styles.chips}>
              {LIVE_POLICIES.map((option) => (
                <Chip
                  key={option}
                  label={t(`live.policies.${option}`)}
                  active={run.countdown_policy === option}
                  onPress={() => {
                    if (controls.setPolicy && option !== run.countdown_policy) live.send({ action: 'set_policy', countdown_policy: option });
                  }}
                />
              ))}
            </View>
            <Button
              title={t('live.releaseControl')}
              variant="quiet"
              disabled={!controls.release}
              onPress={() => live.send({ action: 'release_control' })}
            />
          </>
        ) : null}

        {controls.discard ? (
          <Button title={t('live.discardRun')} variant="quiet" onPress={() => setConfirm('discard')} />
        ) : null}

        {confirm ? (
          <View style={styles.confirm}>
            <Text style={styles.strong}>{confirm === 'take_over' ? t('live.confirm.takeOverTitle') : t('live.confirm.discardTitle')}</Text>
            <Text style={styles.body}>
              {confirm === 'take_over'
                ? control.holder_name
                  ? t('live.confirm.takeOverBody', { name: control.holder_name })
                  : t('live.confirm.takeOverBodyUnknown')
                : t('live.confirm.discardBody')}
            </Text>
            <Field
              label={confirm === 'take_over' ? t('live.confirm.reasonOptional') : t('live.confirm.reasonRequired')}
              value={reason}
              maxLength={500}
              onChangeText={setReason}
            />
            <Meta>{confirm === 'take_over' ? t('live.mobile.takeOverHint') : t('live.mobile.discardHint')}</Meta>
            <View style={styles.row}>
              <Button title={t('common:actions.cancel')} variant="secondary" style={styles.flex} onPress={closeConfirm} />
              <Button
                title={confirm === 'take_over' ? t('live.confirm.takeOver') : t('live.confirm.discard')}
                variant={confirm === 'take_over' ? 'primary' : 'danger'}
                disabled={confirm === 'discard' && reason.trim().length === 0}
                style={styles.flex}
                onPress={() => {
                  const text = reason.trim();
                  if (confirm === 'take_over') live.send({ action: 'take_over', ...(text ? { reason: text } : {}) });
                  else live.send({ action: 'discard', reason: text });
                  closeConfirm();
                }}
              />
            </View>
          </View>
        ) : null}

        {live.pending ? (
          <Text style={styles.muted} accessibilityLiveRegion="polite">
            {t('live.sending', { action: t(`live.actions.${live.pending.action}`) })}
          </Text>
        ) : null}
        {(live.connection === 'offline' || live.connection === 'revoked') && state.can_control ? (
          <Text style={[styles.body, { color: theme.accent.yellow.fg }]}>{t('live.offlineCommands')}</Text>
        ) : null}
        {refusalMessage ? (
          <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: theme.accent.red.bg }]}>
            <Text style={[styles.body, { color: theme.accent.red.fg }]}>{refusalMessage}</Text>
            <View style={styles.row}>
              {live.retry ? <Button title={t('live.retryCommand')} variant="secondary" onPress={live.retry} /> : null}
              <Button title={t('common:a11y.dismiss')} variant="quiet" onPress={live.clearCommandError} />
            </View>
          </View>
        ) : null}
      </Card>

      <Card>
        <Label>{t('live.orderPinned')}</Label>
        {run.snapshot.map((item, index) => {
          const isCurrent = view.current_index === index;
          const isHeader = item.item_type === 'header';
          return (
            <View
              key={item.id}
              style={[styles.orderRow, isCurrent && { backgroundColor: theme.accent.green.bg }]}
              accessibilityState={{ selected: isCurrent }}
            >
              {isHeader ? (
                <Text style={[styles.section, styles.flex]}>{item.title}</Text>
              ) : (
                <>
                  <Text style={styles.orderTime}>{f.time(plannedStart.get(item.id) ?? run.time_starts_at)}</Text>
                  <Text style={[styles.body, styles.flex, isCurrent && styles.strong]} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.orderTime}>{formatLiveDuration(item.length_seconds)}</Text>
                </>
              )}
              {controls.jump && !isCurrent ? (
                <Button
                  title={isHeader ? t('live.goToSection') : t('live.goHere')}
                  variant="quiet"
                  onPress={() => live.send({ action: 'jump', target_index: index })}
                />
              ) : null}
            </View>
          );
        })}
      </Card>
    </>
  );
};

interface HistoryCardProps {
  runId: string;
  /** Re-read when the run's revision changes. */
  revision: number;
}

const variance = (seconds: number | null): string =>
  seconds === null ? '—' : seconds === 0 ? '0:00' : seconds > 0 ? `+${formatLiveDuration(seconds)}` : `-${formatLiveDuration(-seconds)}`;

/** Planned versus actual and the transitions, read-only (corrections are made on the website). */
const HistoryCard = ({ runId, revision }: HistoryCardProps) => {
  const { t } = useTranslation('media');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const timeOfDay = useTimeOfDay();
  const { queryScope } = useAuth();
  const history = useQuery<LiveRunHistory>({
    queryKey: queryKeys.liveRunHistory(queryScope, runId),
    queryFn: () => api.liveRunHistory(runId),
    enabled: Boolean(queryScope),
  });
  const heldRevision = history.data?.run.revision;
  const { refetch } = history;
  // The run moved on (another device advanced or corrected it): reload the history.
  useEffect(() => {
    if (heldRevision !== undefined && heldRevision !== revision) void refetch();
  }, [heldRevision, revision, refetch]);

  if (history.isLoading) return <Loading label={t('live.history.loading')} />;
  if (history.error || !history.data) return <ErrorNotice error={history.error} />;

  const data = history.data;
  const { actuals } = data;
  const effective = effectiveTransitionTimes(data.transitions, data.corrections);
  const correctionsFor = (transitionId: number) => data.corrections.filter((c) => c.transition_id === transitionId);

  return (
    <Card>
      <Label>{actuals.corrected ? t('live.history.plannedVsActualCorrected') : t('live.history.plannedVsActual')}</Label>
      {actuals.started_at && actuals.ended_at && actuals.elapsed_seconds !== null ? (
        <Text style={styles.muted}>
          {actuals.paused_seconds > 0
            ? t('live.history.elapsedPaused', {
                start: timeOfDay(actuals.started_at),
                end: timeOfDay(actuals.ended_at),
                elapsed: formatLiveDuration(actuals.elapsed_seconds),
                paused: formatLiveDuration(actuals.paused_seconds),
              })
            : t('live.history.elapsed', {
                start: timeOfDay(actuals.started_at),
                end: timeOfDay(actuals.ended_at),
                elapsed: formatLiveDuration(actuals.elapsed_seconds),
              })}
        </Text>
      ) : null}
      {actuals.items.map((line) =>
        line.item_type === 'header' ? (
          <Text key={line.item_id} style={styles.section}>{line.title}</Text>
        ) : (
          <View key={line.item_id} style={styles.actualRow}>
            <Text style={styles.strong}>
              {line.title}
              {line.segment !== 'service' ? ` ${line.segment === 'pre' ? t('live.history.beforeService') : t('live.history.afterService')}` : ''}
              {line.visits > 1 ? ` ×${line.visits}` : ''}
            </Text>
            <Text style={styles.muted}>
              {[
                `${t('live.history.columns.started')}: ${line.first_started_at ? timeOfDay(line.first_started_at) : t('live.history.notRun')}`,
                `${t('live.history.columns.planned')}: ${formatLiveDuration(line.planned_seconds)}`,
                `${t('live.history.columns.actual')}: ${line.visits > 0 ? formatLiveDuration(line.actual_seconds) : '—'}`,
              ].join('  ·  ')}
            </Text>
            <Text style={[styles.muted, (line.variance_seconds ?? 0) > 0 && { color: theme.accent.red.fg }]}>
              {`${t('live.history.columns.difference')}: ${variance(line.variance_seconds)}`}
            </Text>
          </View>
        ),
      )}
      <Text style={styles.strong}>
        {`${t('live.history.serviceItems')}: ${formatLiveDuration(actuals.planned_service_seconds)} → ${formatLiveDuration(actuals.actual_service_seconds)}`}
      </Text>

      <Divider />
      <Label>{t('live.history.transitions')}</Label>
      {data.transitions.map((transition) => (
        <View key={transition.id} style={styles.actualRow}>
          <Text style={styles.body}>
            {t('live.mobile.transitionAt', {
              action:
                transition.to_index !== null && data.run.snapshot[transition.to_index]
                  ? t('live.history.actionTo', {
                      action: t(`live.history.actions.${transition.action}`),
                      item: data.run.snapshot[transition.to_index]!.title,
                    })
                  : t(`live.history.actions.${transition.action}`),
              time: timeOfDay(new Date(effective.get(transition.id) ?? Date.parse(transition.occurred_at)).toISOString()),
              name: transition.actor_name ?? t('live.history.someone'),
            })}
          </Text>
          {transition.reason ? <Text style={styles.muted}>“{transition.reason}”</Text> : null}
          {correctionsFor(transition.id).map((correction) => (
            <Text key={correction.id} style={styles.muted}>
              {t('live.history.corrected', {
                from: timeOfDay(correction.previous_at),
                to: timeOfDay(correction.corrected_at),
                name: correction.actor_name ?? t('live.history.someone'),
                reason: correction.reason,
              })}
            </Text>
          ))}
        </View>
      ))}
      {data.can_control && data.run.status === 'ended' ? <Meta>{t('live.mobile.historyReadOnly')}</Meta> : null}
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    content: { gap: theme.space.lg, paddingBottom: theme.space.section },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    strong: { ...theme.type.body, fontWeight: '600', color: theme.color.ink },
    section: { ...theme.type.label, color: theme.color.inkFaint, textTransform: 'uppercase' },
    current: { ...theme.type.display, color: theme.color.ink },
    currentBlock: { gap: theme.space.sm },
    clock: { ...theme.type.numeric, fontSize: 56, lineHeight: 64, fontWeight: '600', color: theme.color.ink, fontVariant: ['tabular-nums'] },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    timeRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    notice: { borderRadius: theme.radius.md, padding: theme.space.md, gap: theme.space.sm },
    confirm: { gap: theme.space.sm, borderTopWidth: 1, borderTopColor: theme.color.border, paddingTop: theme.space.md },
    orderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minHeight: 44,
      paddingHorizontal: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    orderTime: { ...theme.type.bodySmall, color: theme.color.inkMuted, fontVariant: ['tabular-nums'] },
    actualRow: { gap: 2 },
  });
