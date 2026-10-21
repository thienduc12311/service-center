import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  MAX_GENERATED_PLANS,
  PLAN_TEMPLATE_COMPONENTS,
  generationProblemText,
  type AmbiguousTimeChoice,
  type GenerationDateEdit,
  type GenerationPlanPreview,
  type PlanGenerationPreview,
  type PlanGenerationResult,
  type PlanSeriesRequest,
  type PlanTemplateComponent,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { civilDate, dateForPicker } from '../../src/lib/civil-date';
import { nextLocalSunday } from '../../src/lib/plan-create';
import {
  DEFAULT_GENERATE_COMPONENTS,
  canCreateGenerated,
  clampPlanCount,
  conflictsFromError,
  isStaleTemplateError,
  seriesDateOf,
  seriesRequest,
  upsertGenerationEdit,
  usableTemplates,
} from '../../src/lib/template-use';
import { useTemplateNames } from '../../src/lib/useTemplateNames';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { ConflictList } from '../../src/components/ConflictList';
import { PressableScale } from '../../src/components/motion';
import { TemplateApplyReview } from '../../src/components/TemplateApplyReview';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters, useStructuredText } from '../../src/i18n';

type PickerTarget =
  | { kind: 'start' }
  | { kind: 'end' }
  | { kind: 'exclude' }
  /** Move one proposed plan (by its current local date) to another day. */
  | { kind: 'move'; plan: GenerationPlanPreview };

const INTERVALS = ['1', '2', '3', '4'] as const;
type IntervalValue = (typeof INTERVALS)[number];
const AMBIGUOUS: readonly AmbiguousTimeChoice[] = ['earlier', 'later'];
const TEMPLATE_FILTER = { kind: 'plan' as const };

/**
 * MOB-013 Pass B: the website's Create from template page on the same F10
 * contract. Local calendar dates in the organization's timezone, weekly
 * every 1–4 weeks, at most 12 plans; every proposed plan, time and left-out
 * date is reviewed (`previewPlanGeneration`, writes nothing) and the batch is
 * created in one transaction (`generatePlans`) with the preview hash and one
 * idempotency key per review — a retry returns the same plans. New plans
 * are drafts with prepared requests; nobody is notified.
 */
export default function GeneratePlansScreen() {
  const { t } = useTranslation(['templates', 'plans', 'common']);
  const format = useFormatters();
  const structured = useStructuredText();
  const { user, organizationId, can, canAnywhere, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const names = useTemplateNames();
  const timezone = user?.memberships.find((item) => item.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  const mayGenerate = canAnywhere('plans.edit');

  const templates = useQuery({
    queryKey: queryKeys.planTemplates(queryScope, TEMPLATE_FILTER),
    queryFn: () => api.planTemplates(TEMPLATE_FILTER),
    enabled: Boolean(queryScope && mayGenerate),
  });

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(() => nextLocalSunday(new Date(), timezone));
  const [countText, setCountText] = useState('4');
  const [intervalWeeks, setIntervalWeeks] = useState<IntervalValue>('1');
  const [endDate, setEndDate] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [edits, setEdits] = useState<GenerationDateEdit[]>([]);
  const [components, setComponents] = useState<PlanTemplateComponent[]>([...DEFAULT_GENERATE_COMPONENTS]);
  const [ambiguous, setAmbiguous] = useState<AmbiguousTimeChoice>('earlier');
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [preview, setPreview] = useState<PlanGenerationPreview | null>(null);
  // One key per reviewed batch: a transport retry reuses it and gets the same plans.
  const [attemptKey, setAttemptKey] = useState(newIdempotencyKey);
  const [conflictReason, setConflictReason] = useState('');
  const [created, setCreated] = useState<PlanGenerationResult | null>(null);

  const usable = usableTemplates(templates.data ?? []);
  const template = usable.find((candidate) => candidate.id === templateId);
  const count = clampPlanCount(Number(countText), MAX_GENERATED_PLANS);

  const intervalOptions = useMemo<readonly SegmentOption<IntervalValue>[]>(
    () => INTERVALS.map((value) => ({
      value,
      label: value === '1' ? t('generate.everyWeek') : t('generate.everyNWeeks', { weeks: Number(value) }),
    })),
    [t],
  );
  const ambiguousOptions = useMemo<readonly SegmentOption<AmbiguousTimeChoice>[]>(
    () => AMBIGUOUS.map((value) => ({
      value,
      label: t(value === 'earlier' ? 'generate.ambiguousEarlier' : 'generate.ambiguousLater'),
    })),
    [t],
  );

  const invalidatePreview = () => {
    setPreview(null);
    setAttemptKey(newIdempotencyKey());
    generate.reset();
  };
  const series = (nextEdits: readonly GenerationDateEdit[] = edits): PlanSeriesRequest | null =>
    template
      ? seriesRequest({
          template,
          components,
          startDate,
          intervalWeeks: Number(intervalWeeks),
          count,
          endDate,
          excludedDates: excluded,
          edits: nextEdits,
          ambiguous,
        })
      : null;

  const review = useMutation({
    mutationFn: (request: PlanSeriesRequest) => api.previewPlanGeneration(request),
    onSuccess: (result) => {
      if (!isCurrentGeneration(generation)) return;
      setPreview(result);
      setAttemptKey(newIdempotencyKey());
      // A fresh review replaces any earlier stale or conflict outcome.
      generate.reset();
    },
  });
  const runReview = (nextEdits?: readonly GenerationDateEdit[]) => {
    const request = series(nextEdits);
    if (request) review.mutate(request);
  };

  const generate = useMutation({
    mutationFn: () => {
      const request = series();
      if (!preview?.preview_hash || !request) throw new LocalizedError({ key: 'templates:errors.reviewPlansFirst' });
      return api.generatePlans({
        ...request,
        preview_hash: preview.preview_hash,
        idempotency_key: attemptKey,
        conflict_override_reason: conflictReason.trim() || null,
      });
    },
    onSuccess: async (result) => {
      if (!isCurrentGeneration(generation)) return;
      setCreated(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll(queryScope) }),
      ]);
    },
    onError: (error) => {
      if (isCurrentGeneration(generation) && isStaleTemplateError(error)) setPreview(null);
    },
  });

  // A per-date edit applies at once and re-runs the review, as on the website.
  const editDate = (edit: GenerationDateEdit) => {
    const next = upsertGenerationEdit(edits, edit);
    setEdits(next);
    runReview(next);
  };

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    const target = picker;
    if (Platform.OS === 'android' || event.type !== 'dismissed') setPicker(null);
    if (event.type === 'dismissed' || !value || !target) return;
    const picked = civilDate(value);
    if (target.kind === 'start') {
      setStartDate(picked);
      setEdits([]);
      invalidatePreview();
    } else if (target.kind === 'end') {
      setEndDate(picked);
      invalidatePreview();
    } else if (target.kind === 'exclude') {
      if (!excluded.includes(picked)) setExcluded([...excluded, picked].sort());
      invalidatePreview();
    } else if (picked !== target.plan.local_date) {
      const edit = seriesDateOf(edits, target.plan.local_date);
      editDate({ ...edit, local_date: edit?.local_date ?? target.plan.local_date, skip: false, move_to: picked });
    }
  };
  const pickerValue = (target: PickerTarget): Date => {
    switch (target.kind) {
      case 'start': return dateForPicker(startDate);
      case 'end': return dateForPicker(endDate ?? startDate);
      case 'exclude': return dateForPicker(startDate);
      case 'move': return dateForPicker(target.plan.local_date);
    }
  };

  if (!mayGenerate) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('plans:plansPage.createFromTemplate') }} />
        <EmptyState title={t('generate.noAccess')} />
      </Screen>
    );
  }

  if (created) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('plans:plansPage.createFromTemplate') }} />
        <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]}>
          <ScreenHeader
            title={created.replayed ? t('generate.replayedTitle') : t('generate.createdTitle')}
            description={t('generate.createdSubtitle')}
          />
          {created.plans.map((plan) => (
            <Card key={plan.id}>
              <PressableScale
                onPress={() => router.push({ pathname: '/plan/[id]', params: { id: plan.id } })}
                pressedOpacity={0.65}
                accessibilityRole="button"
                accessibilityLabel={plan.title}
              >
                <Text style={styles.muted}>{format.dateTime(plan.service_date)}</Text>
                <Text style={styles.heading}>{plan.title}</Text>
              </PressableScale>
            </Card>
          ))}
          <View style={styles.actions}>
            <Button
              title={t('generate.createMore')}
              variant="secondary"
              onPress={() => { setCreated(null); setEdits([]); invalidatePreview(); }}
            />
            <Button
              title={t('generate.backToPlans')}
              variant="quiet"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/plans'))}
            />
          </View>
        </ScrollView>
      </Screen>
    );
  }

  const conflicts = conflictsFromError(generate.error);
  const stale = isStaleTemplateError(generate.error);
  const unfixed = preview?.problems.filter((problem) => edits.every((edit) => edit.local_date !== problem.local_date)) ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('plans:plansPage.createFromTemplate') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <ScreenHeader title={t('generate.title')} description={t('generate.subtitle', { max: MAX_GENERATED_PLANS })} />

        {templates.isLoading ? (
          <Loading />
        ) : templates.error ? (
          <View style={styles.group}>
            <ErrorNotice error={templates.error} />
            <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void templates.refetch()} />
          </View>
        ) : usable.length === 0 ? (
          <Card><Text style={styles.muted}>{t('plans:mobileGenerate.noTemplates')}</Text></Card>
        ) : (
          <View style={styles.group}>
            <Label>{t('generate.template')}</Label>
            <View style={styles.chips}>
              {usable.map((candidate) => (
                <Chip
                  key={candidate.id}
                  label={t('generate.templateOption', {
                    name: candidate.name,
                    serviceType: candidate.service_type?.name ?? t('generate.noServiceType'),
                    revision: candidate.current_revision,
                  })}
                  active={candidate.id === templateId}
                  onPress={() => { setTemplateId(candidate.id); invalidatePreview(); }}
                />
              ))}
            </View>
            {template && template.counts.times === 0 ? <Text style={styles.warn}>{t('generate.noTimesHint')}</Text> : null}
          </View>
        )}

        <View style={styles.group}>
          <Text style={styles.hint}>{t('plans:mobileCreatePlan.timezoneHint', { timezone })}</Text>
          <Button
            title={t('plans:mobileGenerate.firstDateButton', { date: format.calendarDate(startDate, 'medium') })}
            variant="secondary"
            onPress={() => setPicker({ kind: 'start' })}
          />
          <Label>{t('generate.repeat')}</Label>
          <SegmentedControl
            options={intervalOptions}
            value={intervalWeeks}
            onChange={(value) => { setIntervalWeeks(value); setEdits([]); invalidatePreview(); }}
          />
          <Field
            label={t('generate.howMany')}
            value={countText}
            keyboardType="number-pad"
            maxLength={2}
            onChangeText={(value) => { setCountText(value); invalidatePreview(); }}
            onEndEditing={() => setCountText(String(count))}
          />
          <View style={styles.row}>
            <Button
              title={endDate
                ? t('plans:mobileGenerate.stopAfterButton', { date: format.calendarDate(endDate, 'medium') })
                : t('generate.stopAfter')}
              variant="secondary"
              onPress={() => setPicker({ kind: 'end' })}
            />
            {endDate ? (
              <Button title={t('plans:mobileGenerate.clearStopAfter')} variant="quiet" onPress={() => { setEndDate(null); invalidatePreview(); }} />
            ) : null}
          </View>
        </View>

        <View style={styles.group}>
          <Label>{t('generate.leaveOutHeading')}</Label>
          {excluded.length ? (
            <View style={styles.chips}>
              {excluded.map((date) => (
                <Chip
                  key={date}
                  label={`${format.calendarDate(date, 'medium')}  ×`}
                  active
                  onPress={() => { setExcluded(excluded.filter((value) => value !== date)); invalidatePreview(); }}
                />
              ))}
            </View>
          ) : null}
          <Button title={t('plans:mobileGenerate.leaveOutButton')} variant="secondary" onPress={() => setPicker({ kind: 'exclude' })} />
        </View>

        <View style={styles.group}>
          <Label>{t('generate.copyLegend')}</Label>
          {PLAN_TEMPLATE_COMPONENTS.filter((component) => component !== 'times').map((component) => (
            <View key={component} style={styles.switchRow}>
              <Text style={styles.body}>{t(`components.${component}`)}</Text>
              <Switch
                accessibilityLabel={t(`components.${component}`)}
                value={components.includes(component)}
                onValueChange={(on) => {
                  setComponents((current) => on ? [...current, component] : current.filter((value) => value !== component));
                  invalidatePreview();
                }}
              />
            </View>
          ))}
        </View>

        <View style={styles.group}>
          <Text style={styles.body}>{t('generate.ambiguousLabel')}</Text>
          <SegmentedControl options={ambiguousOptions} value={ambiguous} onChange={(value) => { setAmbiguous(value); invalidatePreview(); }} />
        </View>

        {picker ? (
          <DateTimePicker
            value={pickerValue(picker)}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={onPickerChange}
          />
        ) : null}

        <ErrorNotice error={review.error} />
        <Button title={t('generate.review')} loading={review.isPending} disabled={!template} onPress={() => runReview()} />

        {preview ? (
          <View style={styles.group}>
            <Text style={styles.heading}>{t('generate.previewHeading', { count: preview.plans.length })}</Text>
            <Text style={styles.muted}>{t('generate.timesIn', { timezone: preview.timezone })}</Text>
            {preview.problems.length > 0 ? (
              <View accessibilityRole="alert" style={styles.problems}>
                {preview.problems.map((problem) => (
                  <Text key={`${problem.local_date}-${problem.message}`} style={styles.problemText}>
                    {generationProblemText(problem, structured)}
                  </Text>
                ))}
                <Text style={[styles.problemText, styles.strong]}>{t('generate.fixProblems')}</Text>
              </View>
            ) : null}
            {preview.excluded.length > 0 ? (
              <Text style={styles.muted}>
                {t('generate.leftOut', {
                  dates: format.list(preview.excluded.map((date) =>
                    t(date.reason === 'excluded' ? 'generate.leftOutHoliday' : 'generate.leftOutSkipped', {
                      date: format.calendarDate(date.local_date, 'medium'),
                    }))),
                })}
              </Text>
            ) : null}
            {unfixed.map((problem) => (
              <Card key={`fix-${problem.local_date}`}>
                <View style={styles.planTop}>
                  <Text style={styles.body}>{format.calendarDate(problem.local_date, 'medium')}</Text>
                  <Button
                    title={t('generate.skipThisDate')}
                    variant="secondary"
                    disabled={review.isPending}
                    onPress={() => editDate({ local_date: problem.local_date, skip: true })}
                  />
                </View>
              </Card>
            ))}
            {preview.plans.map((plan) => (
              <ProposedPlan
                key={plan.local_date}
                plan={plan}
                edit={seriesDateOf(edits, plan.local_date)}
                busy={review.isPending || generate.isPending}
                onRename={(title, edit) => editDate({ ...edit, local_date: edit?.local_date ?? plan.local_date, skip: false, title })}
                onMove={() => setPicker({ kind: 'move', plan })}
                onSkip={(edit) => editDate({ local_date: edit?.local_date ?? plan.local_date, skip: true })}
              />
            ))}

            {conflicts.length > 0 ? (
              <View style={styles.group}>
                <ConflictList conflicts={conflicts} nameOf={names.person} />
                {can('scheduling.override_conflicts', { serviceTypeId: preview.service_type_id }) ? (
                  <Field
                    accessibilityLabel={t('generate.conflictReasonLabel')}
                    placeholder={t('generate.conflictReasonPlaceholder')}
                    maxLength={500}
                    value={conflictReason}
                    onChangeText={setConflictReason}
                  />
                ) : (
                  <Text style={styles.muted}>{t('generate.noOverride')}</Text>
                )}
              </View>
            ) : !stale ? (
              <ErrorNotice error={generate.error} />
            ) : null}
            <Button
              title={t('generate.createButton', { count: preview.plans.length })}
              loading={generate.isPending}
              disabled={!canCreateGenerated(preview) || review.isPending}
              onPress={() => generate.mutate()}
            />
          </View>
        ) : null}
        {stale ? <Text accessibilityRole="alert" style={styles.warn}>{t('generate.previewChanged')}</Text> : null}
      </ScrollView>
    </Screen>
  );
}

interface ProposedPlanProps {
  plan: GenerationPlanPreview;
  /** The edit already made to this plan's series date, if any. */
  edit: GenerationDateEdit | undefined;
  busy: boolean;
  onRename: (title: string, edit: GenerationDateEdit | undefined) => void;
  onMove: () => void;
  onSkip: (edit: GenerationDateEdit | undefined) => void;
}

/** One proposed plan: its title, date and time, same-day plans, and exactly what it will hold. */
const ProposedPlan = ({ plan, edit, busy, onRename, onMove, onSkip }: ProposedPlanProps) => {
  const { t } = useTranslation(['templates', 'plans']);
  const format = useFormatters();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [title, setTitle] = useState(plan.title);
  return (
    <Card>
      <View style={styles.group}>
        <Field
          accessibilityLabel={t('generate.titleFor', { date: format.calendarDate(plan.local_date, 'medium') })}
          value={title}
          maxLength={200}
          onChangeText={setTitle}
          onEndEditing={() => {
            const next = title.trim();
            if (next && next !== plan.title) onRename(next, edit);
            else setTitle(plan.title);
          }}
        />
        <Text style={styles.body}>{format.dateTime(plan.service_date)}</Text>
        {plan.existing_plans.length > 0 ? (
          <Tag
            label={t('generate.alreadyHas', { titles: format.list(plan.existing_plans.map((existing) => existing.title)) })}
            accent={theme.accent.yellow}
          />
        ) : null}
        <View style={styles.row}>
          <Button
            title={t('plans:mobileGenerate.moveDate')}
            variant="secondary"
            disabled={busy}
            onPress={onMove}
          />
          <Button title={t('generate.skip')} variant="quiet" disabled={busy} onPress={() => onSkip(edit)} />
        </View>
        <TemplateApplyReview preview={plan.preview} newPlan />
      </View>
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    heading: { ...theme.type.heading, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink, flexShrink: 1 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    warn: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    strong: { fontWeight: '600' },
    problems: { gap: theme.space.xs, padding: theme.space.md, borderRadius: theme.radius.md, backgroundColor: theme.accent.red.bg },
    problemText: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  });
