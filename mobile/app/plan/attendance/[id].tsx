import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ASSIGNMENT_STATUS_ACCENTS,
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_ACCENTS,
  attendanceBatchFingerprint,
  attendanceChanges,
  markEveryoneAttendance,
  rebaseAttendanceDraft,
  recordAttendanceBody,
  setAttendanceMark,
  type AssignmentStatus,
  type AttendanceBatchResult,
  type AttendanceDraft,
  type AttendanceSheet,
  type AttendanceSheetRow,
  type AttendanceStatus,
  type AttendanceTimeOption,
  type RecordAttendanceRequest,
  type SupersededAttendanceMark,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { attendanceWriteOutcome, type AttendanceWriteOutcome } from '../../../src/lib/attendance-edit';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
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
  Screen,
  Tag,
  screenPadding,
} from '../../../src/components/ui';
import { PressableScale } from '../../../src/components/motion';
import { useFormatters } from '../../../src/i18n';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/** The website's response labels on the attendance sheet (`reports:responses.*`). */
const RESPONSE_KEYS: Record<AssignmentStatus, 'responses.confirmed' | 'responses.pending' | 'responses.declined'> = {
  confirmed: 'responses.confirmed',
  unconfirmed: 'responses.pending',
  declined: 'responses.declined',
};

/** The idempotency key of the batch being saved, and the content it was minted for. */
interface BatchKey {
  fingerprint: string;
  key: string;
}

/**
 * MOB-017: actual attendance at one plan time — the website's Attendance tab.
 * One row per Person (several positions show as several roles), separate from
 * their answer. Choices are reviewed and saved as one F16 batch: all apply or
 * none do. The server decides who may be marked through which team.
 */
export default function AttendanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['reports', 'common']);
  const { can, queryScope, generation } = useAuth();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });

  if (!id) return null;
  if (!plan.data || !teams.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('attendance.title') }} />
        {plan.error || teams.error ? <ErrorNotice error={plan.error ?? teams.error} /> : <Loading />}
      </Screen>
    );
  }
  // Website parity: schedulers of the plan's service type, or of any of its teams.
  const target = { serviceTypeId: plan.data.service_type_id };
  const canSchedule = can('scheduling.manage', target)
    || teams.data.some((team) => can('scheduling.manage', { ...target, teamId: team.id }));
  if (!canSchedule) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('attendance.title') }} />
        <EmptyState title={t('mobileAttendance.noAccess')} />
      </Screen>
    );
  }
  // A new identity (sign-out, organization switch) starts a fresh sheet: no draft carries over.
  return <AttendanceSheetView key={generation} planId={id} planTitle={plan.data.title} />;
}

interface AttendanceSheetViewProps {
  planId: string;
  planTitle: string;
}

function AttendanceSheetView({ planId, planTitle }: AttendanceSheetViewProps) {
  const { t } = useTranslation(['reports', 'plans', 'common']);
  const format = useFormatters();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  // Null = the server's default time (the one happening now, or the next).
  const [timeId, setTimeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AttendanceDraft>({});
  const [reason, setReason] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState<AttendanceWriteOutcome | null>(null);
  const [superseded, setSuperseded] = useState<SupersededAttendanceMark[] | null>(null);
  const [saved, setSaved] = useState<AttendanceBatchResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState<ReadonlySet<string>>(new Set());
  // One key per batch content: a retry after no answer replays the first
  // result, and a different batch never reuses a key.
  const batchKey = useRef<BatchKey | null>(null);

  const sheet = useQuery({
    queryKey: queryKeys.attendance(queryScope, planId, timeId),
    queryFn: () => api.attendanceSheet(planId, timeId ?? undefined),
    enabled: Boolean(queryScope),
  });
  const data = sheet.data;

  useEffect(() => {
    setDraft({});
    setReviewing(false);
    setOutcome(null);
    setSuperseded(null);
    setSaved(null);
    setHistoryOpen(new Set());
  }, [data?.time.id]);

  const changes = useMemo(() => (data ? attendanceChanges(data, draft) : []), [data, draft]);
  const dirty = changes.length > 0;
  useDiscardGuard({
    dirty,
    message: t('mobileAttendance.discardConfirm'),
    keepLabel: t('plans:mobileOrder.keepEditing'),
    discardLabel: t('plans:mobileOrder.discard'),
  });

  const refreshAttendance = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.attendanceAll(queryScope, planId) });

  const save = useMutation({
    mutationFn: (body: RecordAttendanceRequest) => api.recordAttendance(planId, body),
    onSuccess: async (result) => {
      if (!isCurrentGeneration(generation)) return;
      setDraft({});
      setReason('');
      setReviewing(false);
      setOutcome(null);
      setSuperseded(null);
      setSaved(result);
      batchKey.current = null;
      await refreshAttendance();
    },
    onError: async (error) => {
      if (!isCurrentGeneration(generation)) return;
      const next = attendanceWriteOutcome(error);
      setOutcome(next);
      if (next === 'keyReused') batchKey.current = null;
      if (next === 'stale') {
        // Keep the choices whose records did not change; show the ones that did.
        const latest = await sheet.refetch();
        if (!isCurrentGeneration(generation) || !latest.data) return;
        const rebased = rebaseAttendanceDraft(latest.data, draft);
        setDraft(rebased.draft);
        setSuperseded(rebased.superseded);
        setReviewing(false);
      } else if (next === 'refused') {
        // Authority or the time itself may have changed: the re-read decides what is still markable.
        await refreshAttendance();
      }
    },
  });

  const submit = () => {
    if (!data || changes.length === 0) return;
    const fingerprint = attendanceBatchFingerprint(data.time.id, changes, reason);
    if (batchKey.current?.fingerprint !== fingerprint) batchKey.current = { fingerprint, key: newIdempotencyKey() };
    setSaved(null);
    save.mutate(recordAttendanceBody(data.time.id, changes, reason, batchKey.current.key));
  };

  const choose = (row: AttendanceSheetRow, status: AttendanceStatus) => {
    setSaved(null);
    if (outcome !== 'uncertain') setOutcome(null);
    setDraft((current) => setAttendanceMark(current, row, status));
  };

  const switchTime = (time: AttendanceTimeOption) => {
    if (time.id === data?.time.id) return;
    if (!dirty) {
      setTimeId(time.id);
      return;
    }
    Alert.alert(t('mobileAttendance.switchTimeConfirm'), undefined, [
      { text: t('plans:mobileOrder.keepEditing'), style: 'cancel' },
      { text: t('mobileAttendance.switchTime'), style: 'destructive', onPress: () => setTimeId(time.id) },
    ]);
  };

  const toggleHistory = (personId: string) =>
    setHistoryOpen((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });

  if (sheet.isLoading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('attendance.title') }} />
        <Loading label={t('attendance.loading')} />
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('attendance.title') }} />
        <View style={styles.errorWrap}>
          <ErrorNotice error={sheet.error} />
          <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void sheet.refetch()} />
        </View>
      </Screen>
    );
  }

  const timeName = (time: AttendanceTimeOption) => time.name ?? t(`attendance.timeKinds.${time.kind}`);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('attendance.title') }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={headerHeight}
      >
        <ScrollView contentContainerStyle={screenPadding(theme)} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.planTitle}>{planTitle}</Text>
            <Text style={styles.muted}>{t('attendance.intro')}</Text>
          </View>
  
          {data.times.length > 1 ? (
            <View style={styles.section}>
              <Label>{t('attendance.planTime')}</Label>
              <View accessibilityRole="radiogroup" style={styles.wrap}>
                {data.times.map((time) => (
                  <Chip
                    key={time.id}
                    label={t('attendance.timeOption', { name: timeName(time), time: format.dateTime(time.starts_at) })}
                    active={time.id === data.time.id}
                    onPress={() => switchTime(time)}
                  />
                ))}
              </View>
            </View>
          ) : (
            <Text style={styles.muted}>
              {t('attendance.timeOption', { name: timeName(data.time), time: format.dateTime(data.time.starts_at) })}
            </Text>
          )}
          {sheet.isFetching ? <Loading /> : null}
          {sheet.error ? <ErrorNotice error={sheet.error} /> : null}
  
          <AttendanceCounts sheet={data} />
  
          {saved ? (
            <Text accessibilityRole="alert" style={styles.success}>
              {saved.replayed ? t('attendance.savedReplayed') : t('attendance.saved', { count: saved.applied })}
            </Text>
          ) : null}
          {superseded ? (
            <View accessibilityRole="alert" style={styles.warning}>
              <Text style={styles.warningText}>{t('attendance.staleKept')}</Text>
              {superseded.map((mark) => (
                <Text key={mark.personId} style={styles.warningText}>• {supersededText(t, mark)}</Text>
              ))}
            </View>
          ) : null}
  
          {data.rows.length === 0 ? (
            <Card>
              <Text style={styles.muted}>
                {data.hidden_people ? t('attendance.nobodyOnYourTeams') : t('attendance.nobody')}
              </Text>
            </Card>
          ) : (
            <>
              {data.can_mark_any ? (
                <View style={styles.section}>
                  <Label>{t('attendance.markEveryone')}</Label>
                  <View style={styles.wrap}>
                    {ATTENDANCE_STATUSES.map((status) => (
                      <Button
                        key={status}
                        title={t(`attendance.status.${status}`)}
                        variant="secondary"
                        onPress={() => {
                          setSaved(null);
                          setDraft((current) => markEveryoneAttendance(data, current, status));
                        }}
                      />
                    ))}
                    {dirty ? (
                      <Button title={t('attendance.discardChanges')} variant="quiet" onPress={() => setDraft({})} />
                    ) : null}
                  </View>
                </View>
              ) : null}
              <Card>
                {data.rows.map((row, index) => (
                  <View key={row.person_id}>
                    {index > 0 ? <Divider /> : null}
                    <AttendanceRowView
                      row={row}
                      choice={draft[row.person_id]?.status}
                      onChoose={(status) => choose(row, status)}
                      historyOpen={historyOpen.has(row.person_id)}
                      onToggleHistory={() => toggleHistory(row.person_id)}
                    />
                    {historyOpen.has(row.person_id) ? (
                      <AttendanceHistoryList planId={planId} timeId={data.time.id} personId={row.person_id} />
                    ) : null}
                  </View>
                ))}
              </Card>
            </>
          )}
  
          {data.hidden_people > 0 ? (
            <Text style={styles.muted}>{t('attendance.hiddenPeople', { count: data.hidden_people })}</Text>
          ) : null}
          {data.orphaned_records.length > 0 ? (
            <Card>
              <Label>{t('mobileAttendance.orphanedTitle')}</Label>
              {data.orphaned_records.map((record, index) => (
                <View key={record.id}>
                  {index > 0 ? <Divider /> : null}
                  <View style={styles.orphan}>
                    <Text style={styles.personName}>{record.person_name}</Text>
                    <Tag label={t(`attendance.status.${record.status}`)} accent={theme.accent[ATTENDANCE_STATUS_ACCENTS[record.status]]} />
                    <View style={styles.flex} />
                    <Button
                      title={historyOpen.has(record.person_id) ? t('mobileAttendance.hideHistory') : t('attendance.history')}
                      variant="quiet"
                      onPress={() => toggleHistory(record.person_id)}
                    />
                  </View>
                  {historyOpen.has(record.person_id) ? (
                    <AttendanceHistoryList planId={planId} timeId={data.time.id} personId={record.person_id} />
                  ) : null}
                </View>
              ))}
            </Card>
          ) : null}
  
        </ScrollView>
  
        {/* Docked under the sheet (the website's review dialog), so it stays in view above the keyboard. */}
        {dirty ? (
          <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, theme.space.md) }]}>
            {reviewing ? (
              <View style={styles.review}>
                <Label>{t('attendance.saveTitle')}</Label>
                <ScrollView style={styles.reviewList}>
                  {changes.map(({ row, status }) => (
                    <Text key={row.person_id} style={styles.body}>
                      {row.record
                        ? t('attendance.changeFrom', { name: row.person_name, from: t(`attendance.status.${row.record.status}`) })
                        : t('attendance.changeNew', { name: row.person_name })}{' '}
                      <Text style={styles.strong}>{t(`attendance.status.${status}`)}</Text>
                    </Text>
                  ))}
                </ScrollView>
                <Field
                  label={t('attendance.reason')}
                  value={reason}
                  maxLength={500}
                  onChangeText={(value) => {
                    setReason(value);
                    if (outcome !== 'uncertain') setOutcome(null);
                  }}
                />
                <Text style={styles.muted}>{t('attendance.allOrNothing')}</Text>
                {outcome === 'uncertain' ? (
                  <Text accessibilityRole="alert" style={[styles.warning, styles.warningText]}>{t('attendance.uncertain')}</Text>
                ) : outcome === 'refused' || outcome === 'keyReused' ? (
                  <ErrorNotice error={save.error} />
                ) : null}
                <View style={styles.wrap}>
                  <Button
                    title={t('common:actions.back')}
                    variant="secondary"
                    disabled={save.isPending}
                    onPress={() => setReviewing(false)}
                  />
                  <Button
                    title={outcome === 'uncertain' ? t('attendance.tryAgain') : t('attendance.saveChanges', { count: changes.length })}
                    loading={save.isPending}
                    onPress={submit}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.barRow}>
                <Text style={styles.barText}>{t('attendance.unsavedChanges', { count: changes.length })}</Text>
                <Button title={t('attendance.reviewAndSave')} onPress={() => setReviewing(true)} />
              </View>
            )}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** "Sam: you chose Present; now Absent (by Jordan)" — one choice dropped after a stale refusal. */
const supersededText = (t: TFunction<['reports', 'plans', 'common']>, mark: SupersededAttendanceMark): string => {
  const mine = t(`attendance.status.${mark.mine}`);
  if (mark.removed) return t('attendance.supersededRemoved', { name: mark.personName, mine });
  if (!mark.saved) return t('attendance.supersededNew', { name: mark.personName, mine });
  return t('attendance.superseded', {
    name: mark.personName,
    mine,
    saved: t(`attendance.status.${mark.saved}`),
    by: mark.savedBy ?? t('attendance.someone'),
  });
};

interface AttendanceCountsProps {
  sheet: AttendanceSheet;
}

const AttendanceCounts = ({ sheet }: AttendanceCountsProps) => {
  const { t } = useTranslation('reports');
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const counts = [
    ['scheduledPeople', sheet.counts.scheduled_people],
    ['present', sheet.counts.present],
    ['absent', sheet.counts.absent],
    ['unknown', sheet.counts.unknown],
    ['notMarked', sheet.counts.unmarked],
  ] as const;
  return (
    <View style={styles.counts}>
      {counts.map(([key, value]) => (
        <View key={key} style={styles.count} accessible accessibilityLabel={`${t(`attendance.counts.${key}`)}: ${format.number(value)}`}>
          <Text style={styles.countLabel}>{t(`attendance.counts.${key}`)}</Text>
          <Text style={styles.countValue}>{format.number(value)}</Text>
        </View>
      ))}
    </View>
  );
};

interface AttendanceRowViewProps {
  row: AttendanceSheetRow;
  /** The unsaved choice, if any. */
  choice: AttendanceStatus | undefined;
  onChoose: (status: AttendanceStatus) => void;
  historyOpen: boolean;
  onToggleHistory: () => void;
}

const AttendanceRowView = ({ row, choice, onChoose, historyOpen, onToggleHistory }: AttendanceRowViewProps) => {
  const { t } = useTranslation('reports');
  const format = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const current = choice ?? row.record?.status ?? null;
  const changed = choice !== undefined && choice !== row.record?.status;
  return (
    <View style={styles.row}>
      <Text style={styles.personName}>
        {row.person_name}
        {row.archived ? <Text style={styles.muted}>{`  ${t('attendance.archived')}`}</Text> : null}
        {changed ? <Text style={styles.unsaved}>{`  · ${t('attendance.unsaved')}`}</Text> : null}
      </Text>
      {row.roles.map((role) => (
        <View key={role.assignment_id} style={styles.role}>
          <Text style={styles.muted}>
            {role.position_name ? t('mobileAttendance.role', { team: role.team_name, position: role.position_name }) : role.team_name}
          </Text>
          <Tag label={t(RESPONSE_KEYS[role.response])} accent={theme.accent[ASSIGNMENT_STATUS_ACCENTS[role.response]]} />
        </View>
      ))}
      {row.record ? (
        <View style={styles.recorded}>
          <Text style={[styles.meta, styles.flex]}>
            {t(`attendance.recorded.${row.record.status}`, {
              name: row.record.marked_by_name ?? t('attendance.someone'),
              time: format.dateTime(row.record.marked_at),
            })}
          </Text>
          <Button
            title={historyOpen ? t('mobileAttendance.hideHistory') : t('attendance.history')}
            variant="quiet"
            onPress={onToggleHistory}
          />
        </View>
      ) : null}
      {row.mark_team_id ? (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('attendance.rowLabel', { name: row.person_name })} style={styles.choices}>
          {ATTENDANCE_STATUSES.map((status) => {
            const active = current === status;
            const accent = theme.accent[ATTENDANCE_STATUS_ACCENTS[status]];
            return (
              // PressableScale, not a function-form Pressable style: NativeWind drops that (MOB-001).
              <PressableScale
                key={status}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                accessibilityLabel={t('mobileAttendance.markLabel', { name: row.person_name, status: t(`attendance.status.${status}`) })}
                onPress={() => onChoose(status)}
                pressedOpacity={0.6}
                style={[styles.choice, active && { backgroundColor: accent.bg, borderColor: accent.fg }]}
              >
                <Text style={[styles.choiceLabel, active && { color: accent.fg, fontWeight: '600' }]}>
                  {t(`attendance.status.${status}`)}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      ) : (
        <View style={styles.role}>
          {row.record ? (
            <Tag label={t(`attendance.status.${row.record.status}`)} accent={theme.accent[ATTENDANCE_STATUS_ACCENTS[row.record.status]]} />
          ) : (
            <Text style={styles.meta}>{t('attendance.counts.notMarked')}</Text>
          )}
        </View>
      )}
    </View>
  );
};

interface AttendanceHistoryListProps {
  planId: string;
  timeId: string;
  personId: string;
}

/** Every mark and correction of one Person at this time, oldest first (audited on the server). */
const AttendanceHistoryList = ({ planId, timeId, personId }: AttendanceHistoryListProps) => {
  const { t } = useTranslation(['reports', 'common']);
  const format = useFormatters();
  const { queryScope } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const history = useQuery({
    queryKey: queryKeys.attendanceHistory(queryScope, planId, timeId, personId),
    queryFn: () => api.attendanceHistory(planId, timeId, personId),
    enabled: Boolean(queryScope),
  });
  if (history.isLoading) return <Loading />;
  if (history.error) {
    return (
      <View style={styles.history}>
        <ErrorNotice error={history.error} />
        <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void history.refetch()} />
      </View>
    );
  }
  const events = history.data ?? [];
  return (
    <View style={styles.history}>
      {events.length === 0 ? <Text style={styles.meta}>{t('attendance.historyEmpty')}</Text> : null}
      {events.map((event) => (
        <View key={event.id} style={styles.historyEntry}>
          <Text style={styles.body}>
            <Text style={styles.strong}>
              {event.previous_status
                ? t('attendance.transition', {
                    from: t(`attendance.status.${event.previous_status}`),
                    to: t(`attendance.status.${event.status}`),
                  })
                : t(`attendance.status.${event.status}`)}
            </Text>{' '}
            {event.team_name
              ? t('attendance.byWithTeam', {
                  name: event.actor_name ?? t('attendance.someone'),
                  team: event.team_name,
                  time: format.dateTime(event.occurred_at),
                })
              : t('attendance.by', { name: event.actor_name ?? t('attendance.someone'), time: format.dateTime(event.occurred_at) })}
          </Text>
          {event.reason ? <Text style={styles.meta}>“{event.reason}”</Text> : null}
        </View>
      ))}
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    errorWrap: { padding: theme.space.xl, gap: theme.space.md },
    header: { gap: theme.space.xs },
    planTitle: { ...theme.type.title, color: theme.color.ink },
    section: { gap: theme.space.sm },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    success: {
      ...theme.type.bodySmall,
      color: theme.accent.green.fg,
      backgroundColor: theme.accent.green.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    warning: {
      gap: theme.space.xs,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    warningText: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },

    counts: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    count: {
      flexGrow: 1,
      minWidth: 96,
      paddingVertical: theme.space.sm,
      paddingHorizontal: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.border,
    },
    countLabel: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    countValue: { ...theme.type.title, color: theme.color.ink, fontVariant: ['tabular-nums'] },

    row: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    personName: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    unsaved: { ...theme.type.bodySmall, color: theme.accent.yellow.fg, fontWeight: '400' },
    role: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    recorded: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    choices: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.xs },
    choice: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.space.sm,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.color.borderStrong,
    },
    choiceLabel: { ...theme.type.bodySmall, color: theme.color.ink },

    orphan: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm, paddingVertical: theme.space.xs },
    history: { gap: theme.space.sm, paddingBottom: theme.space.sm, paddingLeft: theme.space.md },
    historyEntry: { gap: 2 },

    bar: {
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.md,
      backgroundColor: theme.color.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
    barRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    barText: { ...theme.type.bodySmall, color: theme.color.ink, flex: 1 },
    review: { gap: theme.space.sm },
    reviewList: { maxHeight: 140 },
  });
