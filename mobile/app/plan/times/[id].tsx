import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  MAX_PLAN_TIMES,
  PLAN_TIME_KINDS,
  localDateAt,
  movePlanTimeDraft,
  newPlanTimeDraft,
  planTimeDraftIsRepeated,
  planTimeDraftsFrom,
  planTimeEndsNextDay,
  planTimeImpactNeedsReview,
  planTimesFingerprint,
  resolvePlanTimeDrafts,
  unresolvedOrphans,
  updatePlanTimesBody,
  type AmbiguousTimeChoice,
  type OrphanResolutionAction,
  type PlanDetail,
  type PlanTimeDraft,
  type PlanTimeKind,
  type PlanTimeRequest,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import { civilDate, civilTime, dateForPicker } from '../../../src/lib/civil-date';
import {
  conflictsFrom,
  reviewStillApplies,
  timesReview,
  timesWriteOutcome,
  type TimesReview,
} from '../../../src/lib/plan-times-edit';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
import { ConflictList } from '../../../src/components/ConflictList';
import { TimeImpactReview } from '../../../src/components/TimeImpactReview';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
} from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';
import { useFormatters } from '../../../src/i18n';

/** Which picker is open, for which row. */
interface PickerTarget {
  id: string;
  field: 'localDate' | 'localStart' | 'localEnd';
}

/**
 * MOB-015: the plan's full time list on the website's F04 contracts —
 * `previewPlanTimes`, then `updatePlan` with the preview's revision, impact
 * hash, orphan choices and re-send choice. Rows keep their ids across
 * reorder and edits (new rows carry a client id the preview and the commit
 * share). Dates and times are on the organization's clock, resolved by the
 * shared resolver, with an explicit choice for a repeated fall-back time.
 */
export default function EditPlanTimesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const { can, queryScope } = useAuth();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });

  if (plan.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (plan.error || !plan.data) {
    return (
      <Screen>
        <ErrorNotice error={plan.error} />
      </Screen>
    );
  }
  if (!can('plans.edit', { serviceTypeId: plan.data.service_type_id })) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('mobileTimes.screenTitle') }} />
        <EmptyState title={t('mobileTimes.noAccess')} />
      </Screen>
    );
  }
  // One form per plan: its draft starts from the times as they were opened.
  return <TimesForm key={plan.data.id} plan={plan.data} />;
}

interface TimesFormProps {
  plan: PlanDetail;
}

function TimesForm({ plan }: TimesFormProps) {
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const format = useFormatters();
  const { user, organizationId, queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const timeZone = user?.memberships.find((item) => item.organization.id === organizationId)?.organization.timezone ?? 'UTC';

  const [initial] = useState(() => planTimeDraftsFrom(plan.times, timeZone));
  const [drafts, setDrafts] = useState<PlanTimeDraft[]>(initial);
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [review, setReview] = useState<TimesReview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, OrphanResolutionAction>>({});
  const [notify, setNotify] = useState(true);

  const resolution = useMemo(() => resolvePlanTimeDrafts(drafts, timeZone), [drafts, timeZone]);
  const currentTimes: PlanTimeRequest[] | null = resolution.ok ? resolution.times : null;
  const initialFingerprint = useMemo(() => {
    const result = resolvePlanTimeDrafts(initial, timeZone);
    return result.ok ? planTimesFingerprint(result.times) : '';
  }, [initial, timeZone]);
  const dirty = currentTimes ? planTimesFingerprint(currentTimes) !== initialFingerprint : true;

  const guard = useDiscardGuard({
    dirty,
    message: t('editItem.discardConfirm'),
    keepLabel: t('mobileOrder.keepEditing'),
    discardLabel: t('mobileOrder.discard'),
  });

  const refreshPlan = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll(queryScope) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.planDeliveries(queryScope, plan.id) }),
    ]);

  const commit = useMutation({
    mutationFn: (reviewed: TimesReview) =>
      api.updatePlan(plan.id, updatePlanTimesBody(reviewed.times, { impact: reviewed.impact, resolutions, notify })),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshPlan();
      guard.leave();
    },
    onError: (error) => {
      // Stale or no answer: re-read so the next preview is against the plan as it is now.
      const outcome = timesWriteOutcome(error);
      if (!isCurrentGeneration(generation)) return;
      if (outcome === 'plan_stale' || outcome === 'uncertain' || outcome === 'gone') {
        setReview(null);
        void refreshPlan();
      }
    },
  });

  const preview = useMutation({
    mutationFn: async (times: PlanTimeRequest[]) => timesReview(await api.previewPlanTimes(plan.id, { times }), times),
    onSuccess: (result) => {
      if (!isCurrentGeneration(generation)) return;
      commit.reset();
      if (planTimeImpactNeedsReview(result.impact)) {
        setReview(result);
        setResolutions({});
      } else {
        // Nobody is affected: save without a review step, as the website does.
        commit.mutate(result);
      }
    },
  });

  const startPreview = () => {
    if (currentTimes) preview.mutate(currentTimes);
  };

  const update = (rowId: string, patch: Partial<PlanTimeDraft>) =>
    setDrafts((current) => current.map((draft) => (draft.id === rowId ? { ...draft, ...patch } : draft)));
  const move = (index: number, direction: -1 | 1) =>
    setDrafts((current) => movePlanTimeDraft(current, index, direction) ?? current);
  const remove = (rowId: string) => setDrafts((current) => current.filter((draft) => draft.id !== rowId));
  const add = () =>
    setDrafts((current) => [...current, newPlanTimeDraft(newIdempotencyKey(), current.at(-1), localDateAt(Date.now(), timeZone))]);

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !value || !picker) return;
    update(picker.id, { [picker.field]: picker.field === 'localDate' ? civilDate(value) : civilTime(value) });
  };

  const commitOutcome = commit.error ? timesWriteOutcome(commit.error) : null;
  const planChanged = plan.content_revision !== (review?.impact.content_revision ?? plan.content_revision);

  // ------------------------------------------------------------- review --
  if (review) {
    const applies = reviewStillApplies(review, currentTimes, plan.content_revision);
    const conflicts = conflictsFrom(commit.error);
    const nameOf = (personId: string) =>
      review.impact.assignments.find((assignment) => assignment.person_id === personId)?.person_name ?? t('common:fallback.someone');
    const unresolved = unresolvedOrphans(review.impact, resolutions).length > 0;
    const mustReviewAgain = !applies || commitOutcome === 'impact_stale';
    return (
      <Screen>
        <Stack.Screen options={{ title: t('editTimes.reviewTitle') }} />
        <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]}>
          <Card>
            <TimeImpactReview
              impact={review.impact}
              resolutions={resolutions}
              onResolve={(assignmentId, action) => {
                commit.reset();
                setResolutions((current) => ({ ...current, [assignmentId]: action }));
              }}
              notify={notify}
              onNotifyChange={setNotify}
              timeZone={timeZone}
            />
          </Card>
          {mustReviewAgain ? (
            <Text accessibilityRole="alert" style={styles.warning}>
              {planChanged ? t('mobileTimes.planChanged') : t('editTimes.staleImpact')}
            </Text>
          ) : conflicts.length ? (
            <>
              <ConflictList conflicts={conflicts} nameOf={nameOf} />
              <Text style={styles.hint}>{t('editTimes.conflictHint')}</Text>
            </>
          ) : (
            <ErrorNotice error={commit.error} />
          )}
          <View style={styles.actions}>
            <Button
              title={t('common:actions.back')}
              variant="secondary"
              disabled={commit.isPending}
              onPress={() => {
                commit.reset();
                setReview(null);
              }}
            />
            {mustReviewAgain ? (
              <Button title={t('editTimes.reviewAgain')} loading={preview.isPending} disabled={!currentTimes} onPress={startPreview} />
            ) : (
              <Button title={t('editTimes.saveTimes')} loading={commit.isPending} disabled={unresolved} onPress={() => commit.mutate(review)} />
            )}
          </View>
          <ErrorNotice error={preview.error} />
        </ScrollView>
      </Screen>
    );
  }

  // ------------------------------------------------------------- editor --
  const problemFor = (rowId: string) => (resolution.ok ? null : resolution.problems.find((problem) => problem.id === rowId)?.code ?? null);
  const problemText = (code: NonNullable<ReturnType<typeof problemFor>>): string =>
    code === 'start_skipped'
      ? t('editTimes.startSkipped', { timezone: timeZone })
      : code === 'end_skipped'
        ? t('editTimes.endSkipped', { timezone: timeZone })
        : t('editTimes.invalid');

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobileTimes.screenTitle') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>{t('editTimes.timezoneHint', { timezone: timeZone })}</Text>
        {commitOutcome === 'uncertain' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileTimes.uncertain')}</Text>
        ) : commitOutcome === 'plan_stale' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileTimes.planChanged')}</Text>
        ) : null}
        {drafts.length === 0 ? <Text style={styles.hint}>{t('editTimes.empty')}</Text> : null}

        {drafts.map((draft, index) => {
          const number = index + 1;
          const problem = problemFor(draft.id);
          const open = (field: PickerTarget['field']) =>
            setPicker(picker?.id === draft.id && picker.field === field ? null : { id: draft.id, field });
          return (
            <Card key={draft.id}>
              <View style={styles.rowHeader}>
                <View style={styles.flex}>
                  <SegmentedControl<PlanTimeKind>
                    options={PLAN_TIME_KINDS.map((kind) => ({ value: kind, label: t(`timeKind.${kind}`) }))}
                    value={draft.kind}
                    onChange={(kind) => update(draft.id, { kind })}
                  />
                </View>
              </View>
              <Field
                label={t('editTimes.labelFor', { number })}
                value={draft.name}
                placeholder={t('editTimes.labelPlaceholder')}
                maxLength={120}
                onChangeText={(name) => update(draft.id, { name })}
              />
              <View style={styles.row}>
                <Button
                  title={t('mobileTimes.dateButton', { date: draft.localDate ? format.calendarDate(draft.localDate, 'medium') : '—' })}
                  variant="secondary"
                  onPress={() => open('localDate')}
                />
                <Button title={t('mobileTimes.startButton', { time: draft.localStart })} variant="secondary" onPress={() => open('localStart')} />
                <Button title={t('mobileTimes.endButton', { time: draft.localEnd })} variant="secondary" onPress={() => open('localEnd')} />
              </View>
              {planTimeEndsNextDay(draft) ? <Text style={styles.hint}>{t('editTimes.nextDay')}</Text> : null}
              {picker?.id === draft.id ? (
                <DateTimePicker
                  value={dateForPicker(draft.localDate, picker.field === 'localEnd' ? draft.localEnd : draft.localStart)}
                  mode={picker.field === 'localDate' ? 'date' : 'time'}
                  display={Platform.OS === 'ios' ? (picker.field === 'localDate' ? 'inline' : 'spinner') : 'default'}
                  onChange={onPickerChange}
                />
              ) : null}
              {planTimeDraftIsRepeated(draft, timeZone) ? (
                <View style={styles.group}>
                  <Text style={styles.hint}>{t('templates:generate.ambiguousLabel')}</Text>
                  <SegmentedControl<AmbiguousTimeChoice>
                    options={[
                      { value: 'earlier', label: t('templates:generate.ambiguousEarlier') },
                      { value: 'later', label: t('templates:generate.ambiguousLater') },
                    ]}
                    value={draft.ambiguous}
                    onChange={(ambiguous) => update(draft.id, { ambiguous })}
                  />
                </View>
              ) : null}
              {problem ? <Text accessibilityRole="alert" style={styles.problem}>{problemText(problem)}</Text> : null}
              <View style={styles.rowActions}>
                <IconButton
                  name="chevronUp"
                  accessibilityLabel={t('editTimes.moveUp', { number })}
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                />
                <IconButton
                  name="chevronDown"
                  accessibilityLabel={t('editTimes.moveDown', { number })}
                  disabled={index === drafts.length - 1}
                  onPress={() => move(index, 1)}
                />
                <IconButton name="trash" accessibilityLabel={t('editTimes.removeTime', { number })} onPress={() => remove(draft.id)} />
              </View>
            </Card>
          );
        })}

        <Button title={t('editTimes.addTime')} icon="plus" variant="secondary" disabled={drafts.length >= MAX_PLAN_TIMES} onPress={add} />
        {drafts.length >= MAX_PLAN_TIMES ? <Text style={styles.hint}>{t('editTimes.tooMany', { max: MAX_PLAN_TIMES })}</Text> : null}

        {commitOutcome !== 'uncertain' && commitOutcome !== 'plan_stale' ? <ErrorNotice error={preview.error ?? commit.error} /> : null}
        <Button
          title={t('mobileTimes.review')}
          loading={preview.isPending || commit.isPending}
          disabled={!currentTimes || !dirty}
          onPress={startPreview}
        />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    flex: { flex: 1 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    rowHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    rowActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    problem: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
