import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  isFreshnessWarning,
  preferenceWarningText,
  translateMessage,
  type AssignmentVisibility,
  type AttendanceConflict,
  type PlanTimeRow,
  type PreferenceWarning,
  type StructuredTextContext,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { useAuth } from '../../../src/providers/AuthProvider';
import { Avatar, Button, Card, Chip, ErrorNotice, Field, Label, Loading, Screen, Tag, screenPadding } from '../../../src/components/ui';
import { PressableScale } from '../../../src/components/motion';
import {
  ALL_TIMES,
  blockingConflicts,
  canCommitSchedule,
  createAssignmentsBody,
  isScopeComplete,
  scheduleCandidates,
  toggleScopeTime,
  type TimeScope,
} from '../../../src/lib/schedule-people';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';
import { useFormatters, useLanguage } from '../../../src/i18n';

/**
 * MOB-008 Pass B: "Schedule people" for one plan, mirroring the website's
 * SchedulePeopleModal on the same endpoints — team/position, times, people,
 * prepare-privately, delivery readiness, conflicts (rechecked by the server at
 * commit) and preference warnings. Creating a plan-only position or a new
 * Person stays on the website (outside initial native parity).
 */
export default function SchedulePeopleScreen() {
  const { id: planId, teamId: initialTeamId } = useLocalSearchParams<{ id: string; teamId?: string }>();
  const { t, i18n } = useTranslation(['staffing', 'reports', 'common']);
  const format = useFormatters();
  const { locale } = useLanguage();
  const { can, queryScope } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const structured = useMemo<StructuredTextContext>(
    () => ({ locale, translate: (message) => translateMessage(i18n, message) }),
    [i18n, locale],
  );

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && queryScope),
  });
  const allTeams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const people = useQuery({
    queryKey: queryKeys.people(queryScope),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope),
  });

  const serviceTypeId = plan.data?.service_type_id ?? null;
  // Only the teams this person may schedule on this plan; the server refuses the rest.
  const teams = (allTeams.data ?? []).filter((item) =>
    can('scheduling.manage', { serviceTypeId, teamId: item.id }));

  const [teamId, setTeamId] = useState(initialTeamId ?? '');
  const [positionId, setPositionId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<TimeScope>(ALL_TIMES);
  /** Conflicts the server reported at commit time (e.g. someone else got there first). */
  const [commitConflicts, setCommitConflicts] = useState<AttendanceConflict[] | null>(null);
  const [conflictReason, setConflictReason] = useState('');
  /** Null follows the team's default. */
  const [visibilityChoice, setVisibilityChoice] = useState<AssignmentVisibility | null>(null);
  const [overrideReason, setOverrideReason] = useState('');

  const team = teams.find((item) => item.id === teamId);
  const planPositions = (plan.data?.plan_positions ?? []).filter((position) => position.team_id === teamId);
  const sortedPeople = [...selected].sort();

  // F04: advisory preview; the server re-checks at commit.
  const conflictCheck = useQuery({
    queryKey: [...queryKeys.privateRoot(queryScope), 'conflict-check', planId, teamId, positionId, sortedPeople, scope.mode, [...scope.timeIds].sort()],
    queryFn: () =>
      api.checkAssignmentConflicts({
        candidates: selected.map((personId) => ({
          key: personId,
          person_id: personId,
          plan_id: planId!,
          team_id: teamId,
          position_id: positionId,
          attendance_mode: scope.mode,
          time_ids: scope.mode === 'selected' ? scope.timeIds : [],
        })),
      }),
    enabled: Boolean(teamId) && selected.length > 0 && isScopeComplete(scope),
  });
  const conflicts = commitConflicts ?? conflictCheck.data?.conflicts ?? [];
  const blocking = blockingConflicts(conflicts);
  const mayOverride =
    can('scheduling.override_conflicts', { serviceTypeId, teamId })
    && (commitConflicts !== null || conflictCheck.data?.override_permitted !== false);
  const visibility: AssignmentVisibility = visibilityChoice ?? team?.default_visibility ?? 'released';

  // Who a released request cannot reach: no login and no email on file.
  const readiness = useQuery({
    queryKey: [...queryKeys.privateRoot(queryScope), 'delivery-readiness', sortedPeople],
    queryFn: () => api.deliveryReadiness({ person_ids: selected }),
    enabled: selected.length > 0,
  });
  const unreachable = (readiness.data ?? []).filter((entry) => !entry.has_login && !entry.has_email);

  // F03: preference and freshness warnings never block; they explain.
  const warnings = useQuery({
    queryKey: [...queryKeys.privateRoot(queryScope), 'preference-warnings', planId, teamId, sortedPeople],
    queryFn: () => api.preferenceWarnings({ plan_id: planId!, team_id: teamId, person_ids: sortedPeople }),
    enabled: Boolean(teamId) && selected.length > 0,
  });
  const warningsByPerson = useMemo(() => {
    const grouped = new Map<string, PreferenceWarning[]>();
    for (const warning of warnings.data ?? []) grouped.set(warning.person_id, [...(grouped.get(warning.person_id) ?? []), warning]);
    return grouped;
  }, [warnings.data]);
  const hasPreferenceWarnings = (warnings.data ?? []).some((warning) => !isFreshnessWarning(warning.code));

  const schedule = useMutation({
    mutationFn: () =>
      api.createAssignments(planId!, createAssignmentsBody({
        teamId,
        positionId,
        personIds: selected,
        scope,
        visibility,
        preferenceOverrideReason: overrideReason,
        conflictOverrideReason: conflictReason,
        hasBlocking: blocking.length > 0,
      })),
    onSuccess: async () => {
      // Only this plan and its people/schedule views; selection is dropped only on success.
      await queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, planId) });
      await queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) });
      router.back();
    },
    onError: (error) => {
      // A 409 at commit means the picture changed since the check: show what the server found.
      if (error instanceof ApiError && error.status === 409 && error.code === 'scheduling_conflict') {
        setCommitConflicts((error.details as AttendanceConflict[] | undefined) ?? []);
      }
    },
  });

  const candidates = useMemo(() => scheduleCandidates(people.data ?? [], team, filter), [people.data, team, filter]);
  const nameOf = (personId: string): string =>
    people.data?.find((person) => person.person_id === personId)?.full_name ?? t('common:fallback.someone');

  const toggle = (personId: string) => {
    setCommitConflicts(null);
    setSelected((current) => current.includes(personId) ? current.filter((value) => value !== personId) : [...current, personId]);
  };

  const conflictWindow = (conflict: AttendanceConflict): string => {
    const values = {
      date: format.date(conflict.starts_at, 'short'),
      start: format.time(conflict.starts_at),
      end: format.time(conflict.ends_at),
    };
    return conflict.interval_source === 'untimed_fallback'
      ? t('reports:attendance.conflicts.windowApproximate', values)
      : t('reports:attendance.conflicts.window', values);
  };
  const conflictDetail = (conflict: AttendanceConflict): string =>
    conflict.redacted ? t('reports:attendance.conflicts.anotherCommitment') : conflict.detail;
  const timeLabel = (time: PlanTimeRow): string =>
    t('reports:attendance.timeLabel', {
      name: time.name || t(`reports:attendance.timeKinds.${time.kind}`),
      date: format.date(time.starts_at, 'short'),
      start: format.time(time.starts_at),
      end: format.time(time.ends_at),
    });

  if (plan.isLoading || allTeams.isLoading) {
    return <Screen><Loading /></Screen>;
  }
  if (plan.error || allTeams.error) {
    return <Screen><View style={screenPadding(theme)}><ErrorNotice error={plan.error ?? allTeams.error} /></View></Screen>;
  }

  const times = [...(plan.data?.times ?? [])].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const warningItems = conflicts.filter((conflict) => conflict.severity === 'warning');
  const commitEnabled = canCommitSchedule({
    teamId,
    selectedCount: selected.length,
    scope,
    blockingCount: blocking.length,
    mayOverride,
    conflictReason,
  });
  const commitTitle = blocking.length > 0
    ? t('schedulePeople.scheduleAnyway')
    : selected.length === 0
      ? t(visibility === 'prepared' ? 'schedulePeople.prepare' : 'schedulePeople.schedule')
      : t(visibility === 'prepared' ? 'schedulePeople.prepareCount' : 'schedulePeople.scheduleCount', { count: selected.length });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('schedulePeople.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.gap]} keyboardShouldPersistTaps="handled">
        <Card>
          <Label>{t('schedulePeople.team')}</Label>
          <View style={styles.chips}>
            {teams.map((item) => (
              <Chip
                key={item.id}
                label={item.name}
                active={item.id === teamId}
                onPress={() => {
                  setTeamId(item.id);
                  setPositionId(null);
                  setCommitConflicts(null);
                }}
              />
            ))}
          </View>
          {teams.length === 0 ? <Text style={styles.muted}>{t('schedulePeople.chooseTeam')}</Text> : null}
        </Card>

        {team ? (
          <Card>
            <Label>{t('schedulePeople.position')}</Label>
            <View style={styles.chips}>
              <Chip
                label={t('schedulePeople.noSpecificPosition')}
                active={positionId === null}
                onPress={() => { setCommitConflicts(null); setPositionId(null); }}
              />
              {team.positions.map((position) => (
                <Chip
                  key={position.id}
                  label={position.name}
                  active={positionId === position.id}
                  onPress={() => { setCommitConflicts(null); setPositionId(position.id); }}
                />
              ))}
            </View>
            {planPositions.length ? (
              <>
                <Text style={styles.muted}>{t('schedulePeople.planOnlyGroup')}</Text>
                <View style={styles.chips}>
                  {planPositions.map((position) => (
                    <Chip
                      key={position.id}
                      label={position.name}
                      active={positionId === position.id}
                      onPress={() => { setCommitConflicts(null); setPositionId(position.id); }}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </Card>
        ) : null}

        {team ? (
          <Card>
            <Label>{t('reports:attendance.scope.legend')}</Label>
            {times.length === 0 ? (
              <Text style={styles.warn}>{t('reports:attendance.scope.noTimes')}</Text>
            ) : (
              <>
                <Choice
                  label={t('reports:attendance.scope.all')}
                  hint={t('reports:attendance.scope.allHint')}
                  checked={scope.mode === 'all'}
                  onPress={() => { setCommitConflicts(null); setScope(ALL_TIMES); }}
                />
                <Choice
                  label={t('reports:attendance.scope.selected')}
                  hint={t('reports:attendance.scope.selectedHint')}
                  checked={scope.mode === 'selected'}
                  onPress={() => { setCommitConflicts(null); setScope({ mode: 'selected', timeIds: scope.timeIds }); }}
                />
                {scope.mode === 'selected' ? (
                  <View style={styles.indent}>
                    {times.map((time) => (
                      <Choice
                        key={time.id}
                        box
                        label={timeLabel(time)}
                        checked={scope.timeIds.includes(time.id)}
                        onPress={() => { setCommitConflicts(null); setScope(toggleScopeTime(scope, time.id)); }}
                      />
                    ))}
                    {scope.timeIds.length === 0 ? <Text style={styles.warn}>{t('reports:attendance.scope.chooseOne')}</Text> : null}
                  </View>
                ) : null}
              </>
            )}
          </Card>
        ) : null}

        <Card>
          <Label>{t('schedulePeople.people')}</Label>
          <Field
            accessibilityLabel={t('schedulePeople.findPerson')}
            placeholder={t('schedulePeople.findPerson')}
            value={filter}
            onChangeText={setFilter}
            autoCorrect={false}
          />
          {people.isLoading ? <Loading /> : null}
          <ErrorNotice error={people.error} />
          {candidates.map(({ person, personId, onTeam }) => {
            const name = person.full_name ?? person.email ?? t('common:states.unknown');
            const checked = selected.includes(personId);
            return (
              <PressableScale
                key={personId}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => toggle(personId)}
                pressedOpacity={0.6}
                style={styles.personRow}
              >
                <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Avatar name={name} size={32} />
                <Text style={[styles.body, styles.flex]} numberOfLines={1}>{name}</Text>
                {!person.has_login ? <Text style={styles.muted}>{t('schedulePeople.noLogin')}</Text> : null}
                {onTeam ? <Tag label={t('schedulePeople.onTeam')} accent={theme.accent.blue} /> : null}
              </PressableScale>
            );
          })}
        </Card>

        <Card>
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Text style={styles.body}>{t('schedulePeople.preparePrivately')}</Text>
              <Text style={styles.muted}>{t('schedulePeople.preparePrivatelyHint')}</Text>
            </View>
            <Switch
              accessibilityLabel={t('schedulePeople.preparePrivately')}
              value={visibility === 'prepared'}
              onValueChange={(value) => setVisibilityChoice(value ? 'prepared' : 'released')}
            />
          </View>
        </Card>

        {visibility === 'released' && unreachable.length > 0 ? (
          <Card>
            <Text style={styles.warnTitle}>{t('schedulePeople.unreachableTitle')}</Text>
            <Text style={styles.muted}>
              {t('schedulePeople.unreachableBody', {
                count: unreachable.length,
                names: format.list(unreachable.map((entry) => nameOf(entry.person_id))),
              })}
            </Text>
          </Card>
        ) : null}

        {blocking.length > 0 ? (
          <Card>
            <Text accessibilityRole="alert" style={styles.warnTitle}>{t('reports:attendance.conflicts.blockingTitle')}</Text>
            {blocking.map((conflict, index) => (
              <Text key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`} style={styles.muted}>
                {conflict.kind === 'overlapping_commitment'
                  ? t('reports:attendance.conflicts.overlapping', { name: nameOf(conflict.person_id), detail: conflictDetail(conflict), window: conflictWindow(conflict) })
                  : t('reports:attendance.conflicts.blockout', { name: nameOf(conflict.person_id), window: conflictWindow(conflict) })}
              </Text>
            ))}
            {mayOverride ? (
              <Field
                accessibilityLabel={t('schedulePeople.conflictReasonLabel')}
                placeholder={t('schedulePeople.conflictReasonPlaceholder')}
                maxLength={500}
                value={conflictReason}
                onChangeText={setConflictReason}
              />
            ) : (
              <Text style={styles.muted}>{t('schedulePeople.cannotOverride')}</Text>
            )}
          </Card>
        ) : null}

        {warningItems.length > 0 ? (
          <Card>
            <Text style={styles.body}>{t('reports:attendance.conflicts.warningTitle')}</Text>
            {warningItems.map((conflict, index) => (
              <Text key={`${conflict.candidate_key}-${conflict.starts_at}-${index}`} style={styles.muted}>
                {t('reports:attendance.conflicts.samePlan', { name: nameOf(conflict.person_id), detail: conflictDetail(conflict), window: conflictWindow(conflict) })}
              </Text>
            ))}
            <Text style={styles.muted}>{t('reports:attendance.conflicts.warningHint')}</Text>
          </Card>
        ) : null}

        {warningsByPerson.size > 0 ? (
          <Card>
            <Text style={styles.body}>{t('schedulePeople.preferencesTitle')}</Text>
            <Text style={styles.muted}>{t('schedulePeople.preferencesHint')}</Text>
            {[...warningsByPerson.entries()].map(([personId, list]) => (
              <Text key={personId} style={styles.muted}>
                <Text style={styles.strong}>{nameOf(personId)}</Text>
                {' — '}
                {list
                  .map((warning) =>
                    warning.code === 'busy_elsewhere'
                      ? t(`preferenceWarning.${warning.code}`)
                      : t('schedulePeople.warningWithDetail', { label: t(`preferenceWarning.${warning.code}`), detail: preferenceWarningText(warning, structured) }))
                  .join(t('schedulePeople.warningSeparator'))}
              </Text>
            ))}
            {hasPreferenceWarnings ? (
              <Field
                accessibilityLabel={t('schedulePeople.preferenceReasonLabel')}
                placeholder={t('schedulePeople.preferenceReasonPlaceholder')}
                maxLength={500}
                value={overrideReason}
                onChangeText={setOverrideReason}
              />
            ) : null}
          </Card>
        ) : null}

        {schedule.error && !(schedule.error instanceof ApiError && schedule.error.code === 'scheduling_conflict') ? (
          <ErrorNotice error={schedule.error} />
        ) : null}

        <View style={styles.actions}>
          <Button title={t('common:actions.cancel')} variant="secondary" onPress={() => router.back()} />
          <Button
            title={commitTitle}
            loading={schedule.isPending}
            disabled={!commitEnabled || schedule.isPending}
            onPress={() => schedule.mutate()}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

interface ChoiceProps {
  label: string;
  hint?: string;
  checked: boolean;
  /** Checkbox look instead of radio. */
  box?: boolean;
  onPress: () => void;
}

const Choice = ({ label, hint, checked, box = false, onPress }: ChoiceProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale
      accessibilityRole={box ? 'checkbox' : 'radio'}
      accessibilityState={{ checked }}
      onPress={onPress}
      pressedOpacity={0.6}
      style={styles.choice}
    >
      <View style={[box ? styles.box : styles.radio, checked && styles.boxOn]}>
        {checked ? <Text style={styles.tick}>{box ? '✓' : '•'}</Text> : null}
      </View>
      <View style={styles.flex}>
        <Text style={styles.body}>{label}</Text>
        {hint ? <Text style={styles.muted}>{hint}</Text> : null}
      </View>
    </PressableScale>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    gap: { gap: theme.space.lg },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { fontWeight: '600', color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warn: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    warnTitle: { ...theme.type.body, fontWeight: '600', color: theme.accent.yellow.fg },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.sm },
    choice: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 44, paddingVertical: theme.space.xs },
    indent: { marginLeft: theme.space.xl },
    personRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, minHeight: 48 },
    box: {
      width: 22,
      height: 22,
      borderRadius: 4,
      borderWidth: 1.5,
      borderColor: theme.color.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.color.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxOn: { backgroundColor: theme.accent.blue.fg, borderColor: theme.accent.blue.fg },
    tick: { color: theme.color.surface, fontWeight: '700', fontSize: 13 },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.sm },
  });
