import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockoutRow, DelegatedScheduleEntry, ServiceCenterAccentName } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  Field,
  IconButton,
  Label,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import { BlockoutForm } from '../../src/components/BlockoutForm';
import { TimeSlotList } from '../../src/components/StaffingParts';
import {
  activeReceivedGrant,
  canSeeRequests,
  classifyDelegatedError,
  delegatedActions,
  delegatedRespondBody,
  type DelegatedAction,
} from '../../src/lib/delegations';
import { useDelegatedSchedule, useDelegations, useRefreshDelegations } from '../../src/lib/useDelegations';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/** One answer being sent for one request. */
interface DelegatedAnswer {
  entry: DelegatedScheduleEntry;
  action: DelegatedAction;
}

const STATUS_ACCENT: Record<DelegatedScheduleEntry['status'], ServiceCenterAccentName> = {
  unconfirmed: 'yellow',
  confirmed: 'green',
  declined: 'neutral',
};

/**
 * MOB-011: acting for one Person under their explicit grant (F03 Pass C).
 * Each section appears only for the right that allows it, and every action is
 * re-checked by the server against the live grant; a stopped or expired grant
 * shows nothing. Requests carry only title, date, role and times — there is
 * deliberately no link into the plan, its notes or files.
 */
export default function DelegatedPersonScreen() {
  const { id: delegationId } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['home', 'settings', 'common']);
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const queryClient = useQueryClient();
  const { user, organizationId, queryScope, generation, isCurrentGeneration } = useAuth();
  const delegations = useDelegations();
  const refreshDelegations = useRefreshDelegations();
  const grant = activeReceivedGrant(delegations.data, delegationId);
  const personId = grant?.target_person_id ?? null;
  const manageAvailability = Boolean(grant?.can_manage_availability);
  const timezone = user?.memberships.find((m) => m.organization.id === organizationId)?.organization.timezone ?? 'UTC';

  const schedule = useDelegatedSchedule(delegationId, Boolean(grant && canSeeRequests(grant)));
  const review = useQuery({
    queryKey: queryKeys.availabilityReview(queryScope, personId ?? ''),
    queryFn: () => api.availabilityReview({ person_id: personId! }),
    enabled: Boolean(queryScope && personId && manageAvailability),
  });
  const blockouts = useQuery({
    queryKey: queryKeys.blockoutsFor(queryScope, personId ?? ''),
    queryFn: () => api.listBlockouts({ scope: 'mine', person_id: personId! }),
    enabled: Boolean(queryScope && personId && manageAvailability),
  });

  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState<string | null>(null);
  const [editingBlockout, setEditingBlockout] = useState<BlockoutRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const respond = useMutation({
    mutationFn: ({ entry, action }: DelegatedAnswer) =>
      api.respondAsDelegate(delegationId!, entry.assignment_id, delegatedRespondBody(entry, action, reasons[entry.assignment_id] ?? '')),
    onSuccess: async (_result, { entry }) => {
      if (!isCurrentGeneration(generation)) return;
      setDeclining(null);
      setReasons((current) => ({ ...current, [entry.assignment_id]: '' }));
      await refreshDelegations();
    },
    onError: async () => {
      // Stale answers and ended grants both need the server's current state.
      if (isCurrentGeneration(generation)) await refreshDelegations();
    },
  });
  const affirm = useMutation({
    mutationFn: () => api.affirmAvailability({ person_id: personId! }),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.availabilityReview(queryScope, personId ?? '') });
    },
  });
  const removeBlockout = useMutation({
    mutationFn: (blockout: BlockoutRow) => api.deleteBlockout(blockout.id, blockout.revision),
    onSuccess: () => refreshAvailability(),
  });
  const stop = useMutation({
    mutationFn: () => api.revokeDelegation(delegationId!),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshDelegations();
      if (isCurrentGeneration(generation)) router.back();
    },
  });

  async function refreshAvailability(): Promise<void> {
    if (!isCurrentGeneration(generation) || !personId) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.blockoutsFor(queryScope, personId) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.availabilityReview(queryScope, personId) });
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    await refreshDelegations();
    await refreshAvailability();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  };

  // A grant stopped or expired after this screen loaded: re-read the grants so the screen closes.
  // The listing only knows revocation and expiry; the server also ends a grant when either Person leaves.
  const grantEnded = [schedule.error, review.error, blockouts.error].some((error) => classifyDelegatedError(error) === 'grantEnded');
  useEffect(() => {
    if (grantEnded) void refreshDelegations();
  }, [grantEnded]); // eslint-disable-line react-hooks/exhaustive-deps

  const { oneOffs, series } = useMemo(() => {
    const seen = new Set<string>();
    const rows = blockouts.data ?? [];
    return {
      oneOffs: rows.filter((row) => !row.series_id),
      series: rows.filter((row) => row.series_id && !seen.has(row.series_id) && seen.add(row.series_id)),
    };
  }, [blockouts.data]);

  const confirmStop = (): void => {
    if (!grant) return;
    Alert.alert(t('settings:help.stopConfirmTitle'), t('settings:help.stopConfirmReceived', { name: grant.target_name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('settings:help.stopHelping'), style: 'destructive', onPress: () => stop.mutate() },
    ]);
  };

  const confirmWithdraw = (entry: DelegatedScheduleEntry): void => {
    Alert.alert(t('help.withdrawTitle'), t('help.withdrawMessage', { name: grant?.target_name ?? '', plan: entry.plan_title }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('help.withdraw'), style: 'destructive', onPress: () => respond.mutate({ entry, action: 'withdraw' }) },
    ]);
  };

  if (delegations.isLoading) return <Loading />;
  if (delegations.error) {
    return (
      <Screen>
        <View style={[screenPadding(theme), styles.gap]}>
          <ErrorNotice error={delegations.error} />
          <Button title={t('common:actions.retry')} onPress={() => void delegations.refetch()} />
        </View>
      </Screen>
    );
  }
  if (!grant || grantEnded) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('settings:help.title') }} />
        <View style={screenPadding(theme)}>
          <EmptyState
            title={t('help.notFoundTitle')}
            description={t('help.notFoundDescription')}
            action={<Button title={t('settings:help.title')} variant="secondary" onPress={() => router.replace('/help')} />}
          />
        </View>
      </Screen>
    );
  }

  const failure = respond.error ? classifyDelegatedError(respond.error) : null;
  const pendingFor = (entry: DelegatedScheduleEntry, action: DelegatedAction): boolean =>
    respond.isPending && respond.variables?.entry.assignment_id === entry.assignment_id && respond.variables.action === action;

  return (
    <Screen>
      <Stack.Screen options={{ title: grant.target_name }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.color.inkFaint} />}
      >
        <ScreenHeader title={t('help.title', { name: grant.target_name })} description={t('help.subtitle')} />
        <Text style={styles.hint}>{t('help.privateBoundary', { name: grant.target_name })}</Text>

        {canSeeRequests(grant) ? (
          <View style={styles.section}>
            <Label>{t('help.requests')}</Label>
            {failure === 'stale' ? <Text style={styles.warning}>{t('help.stale')}</Text> : failure === 'other' ? <ErrorNotice error={respond.error} /> : null}
            {schedule.isLoading ? <Loading /> : schedule.error ? (
              <>
                <ErrorNotice error={schedule.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void schedule.refetch()} />
              </>
            ) : schedule.data?.entries.length ? (
              <Card>
                {schedule.data.entries.map((entry, index) => {
                  const actions = delegatedActions(grant, entry);
                  const isDeclining = declining === entry.assignment_id;
                  return (
                    <View key={entry.assignment_id} style={styles.entry}>
                      {index > 0 ? <Divider /> : null}
                      <View style={styles.entryHead}>
                        <View style={styles.flex}>
                          <Text style={styles.title}>{entry.plan_title}</Text>
                          <Text style={styles.muted}>
                            {[format.calendarDate(entry.service_date.slice(0, 10), 'medium'), [entry.team_name, entry.position_name].filter(Boolean).join(' · '), entry.location]
                              .filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Tag
                          label={entry.status === 'unconfirmed' ? t('help.awaitingAnswer') : t(`common:assignmentStatus.${entry.status}`)}
                          accent={theme.accent[STATUS_ACCENT[entry.status]]}
                        />
                      </View>
                      <TimeSlotList times={entry.times} emptyText={t('help.noTimes')} />
                      {isDeclining ? (
                        <View style={styles.declineBox}>
                          <Field
                            label={t('help.reasonLabel', { plan: entry.plan_title })}
                            placeholder={t('help.reasonPlaceholder')}
                            maxLength={500}
                            value={reasons[entry.assignment_id] ?? ''}
                            onChangeText={(value) => setReasons((current) => ({ ...current, [entry.assignment_id]: value }))}
                          />
                          <View style={styles.actions}>
                            <Button title={t('common:actions.cancel')} variant="quiet" onPress={() => setDeclining(null)} />
                            <Button
                              title={t('common:actions.decline')}
                              variant="danger"
                              loading={pendingFor(entry, 'decline')}
                              disabled={respond.isPending}
                              onPress={() => respond.mutate({ entry, action: 'decline' })}
                            />
                          </View>
                        </View>
                      ) : actions.length ? (
                        <View style={styles.actions}>
                          {actions.includes('accept') ? (
                            <Button
                              title={t('help.accept')}
                              loading={pendingFor(entry, 'accept')}
                              disabled={respond.isPending}
                              onPress={() => respond.mutate({ entry, action: 'accept' })}
                            />
                          ) : null}
                          {actions.includes('decline') ? (
                            <Button title={t('common:actions.decline')} variant="secondary" disabled={respond.isPending} onPress={() => { respond.reset(); setDeclining(entry.assignment_id); }} />
                          ) : null}
                          {actions.includes('withdraw') ? (
                            <Button
                              title={t('help.withdraw')}
                              variant="secondary"
                              loading={pendingFor(entry, 'withdraw')}
                              disabled={respond.isPending}
                              onPress={() => confirmWithdraw(entry)}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Card>
            ) : (
              <Text style={styles.muted}>{t('help.noRequests')}</Text>
            )}
            {!grant.can_respond ? <Text style={styles.hint}>{t('help.viewOnly')}</Text> : null}
          </View>
        ) : null}

        {manageAvailability ? (
          <>
            <View style={styles.section}>
              <Label>{t('help.availability')}</Label>
              <Card>
                {review.isLoading ? <Loading /> : (
                  <>
                    <Text style={styles.title}>
                      {review.data ? t(`settings:freshness.${review.data.freshness}`) : t('help.availability')}
                    </Text>
                    <Text style={styles.muted}>
                      {review.data?.reviewed_at
                        ? t(review.data.kind === 'affirmed' ? 'settings:review.lastReviewedAffirmed' : 'settings:review.lastReviewed', { when: format.dateTime(review.data.reviewed_at) })
                        : t('settings:review.neverReviewed')}
                    </Text>
                  </>
                )}
                <ErrorNotice error={review.error ?? affirm.error} />
                <Button title={t('settings:review.affirmTheirs')} variant="secondary" loading={affirm.isPending} onPress={() => affirm.mutate()} />
              </Card>
            </View>

            <View style={styles.section}>
              <Label>{t('settings:blockouts.titleFor', { name: grant.target_name })}</Label>
              <Card>
                <Text style={styles.muted}>{t('settings:blockouts.descriptionTheirs', { timezone })}</Text>
                <BlockoutForm
                  personId={grant.target_person_id}
                  editing={editingBlockout}
                  onSaved={async () => { setEditingBlockout(null); await refreshAvailability(); }}
                  onCancelEdit={() => setEditingBlockout(null)}
                />
                {blockouts.isLoading ? <Loading /> : null}
                <ErrorNotice error={blockouts.error ?? removeBlockout.error} />
                {oneOffs.map((blockout) => {
                  const day = blockout.local_start_date ? format.calendarDate(blockout.local_start_date) : format.date(blockout.starts_at);
                  return (
                    <View key={blockout.id}>
                      <Divider />
                      <View style={styles.blockout}>
                        <View style={styles.flex}>
                          <Text style={styles.body}>
                            {blockout.all_day
                              ? t('settings:blockouts.occurrenceAllDay', { date: day })
                              : t('settings:blockouts.rowTimes', { date: day, start: blockout.local_start_time?.slice(0, 5) ?? '', end: blockout.local_end_time?.slice(0, 5) ?? '' })}
                          </Text>
                          {blockout.reason ? <Text style={styles.muted}>{blockout.reason}</Text> : null}
                        </View>
                        <Button title={t('common:actions.edit')} variant="quiet" onPress={() => setEditingBlockout(blockout)} />
                        <IconButton
                          name="trash"
                          accessibilityLabel={t('settings:profile.removeBlockout', { date: day })}
                          onPress={() => removeBlockout.mutate(blockout)}
                        />
                      </View>
                    </View>
                  );
                })}
                {series.map((row) => (
                  <View key={row.series_id}>
                    <Divider />
                    <View style={styles.blockout}>
                      <View style={styles.flex}>
                        <Text style={styles.body}>{t('settings:blockouts.repeatingFrom', { date: row.local_start_date ? format.calendarDate(row.local_start_date) : '' })}</Text>
                        <Text style={styles.muted}>{t('help.seriesTheirs', { name: grant.target_name })}</Text>
                      </View>
                    </View>
                  </View>
                ))}
                {!blockouts.isLoading && !blockouts.error && oneOffs.length + series.length === 0 ? (
                  <Text style={styles.muted}>{t('help.noBlockouts')}</Text>
                ) : null}
              </Card>
            </View>

            <Card>
              <ListRow showChevron onPress={() => router.push({ pathname: '/team-preferences', params: { delegation: grant.id } })}>
                <Label>{t('help.schedulingPreferences')}</Label>
                <Text style={styles.muted}>{t('help.preferencesFor', { name: grant.target_name })}</Text>
              </ListRow>
            </Card>
          </>
        ) : null}

        <ErrorNotice error={stop.error} />
        <Button title={t('settings:help.stopHelping')} variant="quiet" loading={stop.isPending} onPress={confirmStop} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.lg },
    section: { gap: theme.space.sm },
    flex: { flex: 1 },
    title: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    warning: { ...theme.type.bodySmall, color: theme.color.danger },
    entry: { gap: theme.space.sm, paddingBottom: theme.space.sm },
    entryHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, paddingTop: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    declineBox: { gap: theme.space.sm },
    blockout: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.sm },
  });
