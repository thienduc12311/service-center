import { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LocalizedError, createPlanSchema, type AmbiguousTimeChoice } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { civilDate, civilTime, dateForPicker } from '../../src/lib/civil-date';
import {
  NEW_PLAN_SERVICE_MINUTES,
  createPlanBody,
  nextLocalSunday,
  resolvePlanStart,
  type NewPlanDraft,
} from '../../src/lib/plan-create';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Screen,
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

type PickerTarget = 'date' | 'time';
const AMBIGUOUS: readonly AmbiguousTimeChoice[] = ['earlier', 'later'];

/**
 * MOB-013 Pass A: the website's New plan form on the same `POST /plans` —
 * a draft plan with one service time, nothing copied from another plan.
 * Native reads the date and time on the organization's clock (the website
 * uses the browser's) and sends an idempotency key, so a retry after a lost
 * response returns the same plan instead of a second one.
 */
export default function NewPlanScreen() {
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const format = useFormatters();
  const { user, organizationId, can, canAnywhere, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const timezone = user?.memberships.find((item) => item.organization.id === organizationId)?.organization.timezone ?? 'UTC';

  const [draft, setDraft] = useState<NewPlanDraft>(() => ({
    title: '',
    localDate: nextLocalSunday(new Date(), timezone),
    localTime: '10:00',
    serviceTypeId: null,
    location: '',
  }));
  const [ambiguous, setAmbiguous] = useState<AmbiguousTimeChoice>('earlier');
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [validationError, setValidationError] = useState<Error | null>(null);
  // One key per draft: any change makes it a different plan to create.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const serviceTypes = useQuery({
    queryKey: queryKeys.serviceTypes(queryScope),
    queryFn: () => api.listServiceTypes(),
    enabled: Boolean(queryScope),
  });
  // UI hint matching the insert policy (plans.edit at the plan's service type); RLS decides.
  const allowedTypes = (serviceTypes.data ?? []).filter((type) => can('plans.edit', { serviceTypeId: type.id }));
  const mayCreateUntyped = can('plans.edit');

  const update = (patch: Partial<NewPlanDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setIdempotencyKey(newIdempotencyKey());
    setValidationError(null);
  };

  const start = useMemo(
    () => resolvePlanStart(draft.localDate, draft.localTime, timezone, ambiguous),
    [ambiguous, draft.localDate, draft.localTime, timezone],
  );
  const ambiguousOptions = useMemo<readonly SegmentOption<AmbiguousTimeChoice>[]>(
    () => AMBIGUOUS.map((value) => ({
      value,
      label: t(value === 'earlier' ? 'templates:generate.ambiguousEarlier' : 'templates:generate.ambiguousLater'),
    })),
    [t],
  );

  const create = useMutation({
    mutationFn: () => {
      if (start.kind !== 'resolved') throw new LocalizedError({ key: 'plans:mobileCreatePlan.invalidTime' });
      return api.createPlan(createPlanBody(draft, start.startsAt, t('timeKind.service'), idempotencyKey));
    },
    onSuccess: async (plan) => {
      if (!isCurrentGeneration(generation)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll(queryScope) }),
      ]);
      router.replace({ pathname: '/plan/[id]', params: { id: plan.id } });
    },
  });

  const submit = () => {
    if (start.kind !== 'resolved') return;
    const parsed = createPlanSchema.safeParse(createPlanBody(draft, start.startsAt, t('timeKind.service'), idempotencyKey));
    if (!parsed.success) {
      setValidationError(new LocalizedError({ key: 'errors:generic.invalid' }));
      return;
    }
    create.mutate();
  };

  const onPickerChange = (event: DateTimePickerEvent, value?: Date) => {
    if (Platform.OS === 'android') setPicker(null);
    if (event.type === 'dismissed' || !value || !picker) return;
    update(picker === 'date' ? { localDate: civilDate(value) } : { localTime: civilTime(value) });
  };

  if (!canAnywhere('plans.edit')) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('plansPage.createTitle') }} />
        <EmptyState title={t('templates:generate.noAccess')} />
      </Screen>
    );
  }

  const startProblem =
    start.kind === 'skipped'
      ? t('mobileCreatePlan.skippedTime', { time: draft.localTime, date: format.calendarDate(draft.localDate, 'medium'), timezone })
      : start.kind === 'invalid'
        ? t('mobileCreatePlan.invalidTime')
        : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('plansPage.createTitle') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <Field
          label={t('plansPage.fieldTitle')}
          value={draft.title}
          onChangeText={(title) => update({ title })}
          placeholder={t('plansPage.titlePlaceholder')}
          maxLength={200}
          autoFocus
        />

        <View style={styles.group}>
          <Label>{t('plansPage.fieldServiceDate')}</Label>
          <Text style={styles.hint}>{t('mobileCreatePlan.timezoneHint', { timezone })}</Text>
          <View style={styles.row}>
            <Button
              title={t('mobileCreatePlan.dateButton', { date: format.calendarDate(draft.localDate, 'medium') })}
              variant="secondary"
              onPress={() => setPicker(picker === 'date' ? null : 'date')}
            />
            <Button
              title={t('mobileCreatePlan.timeButton', { time: draft.localTime })}
              variant="secondary"
              onPress={() => setPicker(picker === 'time' ? null : 'time')}
            />
          </View>
          {picker ? (
            <DateTimePicker
              value={dateForPicker(draft.localDate, draft.localTime)}
              mode={picker}
              display={Platform.OS === 'ios' ? (picker === 'date' ? 'inline' : 'spinner') : 'default'}
              onChange={onPickerChange}
            />
          ) : null}
          {start.kind === 'resolved' && start.repeated ? (
            <>
              <Text style={styles.hint}>{t('templates:generate.ambiguousLabel')}</Text>
              <SegmentedControl options={ambiguousOptions} value={ambiguous} onChange={(value) => { setAmbiguous(value); setIdempotencyKey(newIdempotencyKey()); }} />
            </>
          ) : null}
          {startProblem ? <Text accessibilityRole="alert" style={styles.problem}>{startProblem}</Text> : null}
          <Text style={styles.hint}>{t('mobileCreatePlan.serviceTimeHint', { minutes: NEW_PLAN_SERVICE_MINUTES })}</Text>
        </View>

        <View style={styles.group}>
          <Label>{t('plansPage.fieldServiceType')}</Label>
          <View style={styles.chips}>
            {mayCreateUntyped ? (
              <Chip label={t('common:states.none')} active={!draft.serviceTypeId} onPress={() => update({ serviceTypeId: null })} />
            ) : null}
            {allowedTypes.map((type) => (
              <Chip
                key={type.id}
                label={type.name}
                active={draft.serviceTypeId === type.id}
                onPress={() => update({ serviceTypeId: type.id })}
              />
            ))}
          </View>
          {!mayCreateUntyped ? <Text style={styles.hint}>{t('mobileCreatePlan.noServiceTypeHint')}</Text> : null}
          <ErrorNotice error={serviceTypes.error} />
        </View>

        <Field
          label={t('plansPage.fieldLocation')}
          value={draft.location}
          onChangeText={(location) => update({ location })}
          placeholder={t('plansPage.locationPlaceholder')}
          maxLength={200}
        />

        <ErrorNotice error={validationError ?? create.error} />
        <Button
          title={t('plansPage.createPlan')}
          onPress={submit}
          loading={create.isPending}
          disabled={!draft.title.trim() || start.kind !== 'resolved' || (!mayCreateUntyped && !draft.serviceTypeId)}
        />
        <Button
          title={t('plansPage.createFromTemplate')}
          variant="quiet"
          icon="calendar"
          onPress={() => router.replace('/plan/generate')}
        />
        <Text style={styles.hint}>{t('mobileCreatePlan.createFromTemplateHint')}</Text>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    problem: { ...theme.type.bodySmall, color: theme.accent.red.fg },
  });
