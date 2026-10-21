import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  PLAN_TEMPLATE_COMPONENTS,
  type PlanTemplateComponent,
  type PlanTemplateSummary,
  type TemplateApplyMode,
  type TemplateApplyPreviewResult,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import {
  DEFAULT_APPLY_COMPONENTS,
  applyTemplateRequest,
  availableComponents,
  conflictsFromError,
  isStaleTemplateError,
  showsInsertPosition,
  usableTemplates,
} from '../../../src/lib/template-use';
import { useTemplateNames } from '../../../src/lib/useTemplateNames';
import { useAuth } from '../../../src/providers/AuthProvider';
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
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../../src/components/ui';
import { ConflictList } from '../../../src/components/ConflictList';
import { TemplateApplyReview } from '../../../src/components/TemplateApplyReview';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

const MODES: readonly TemplateApplyMode[] = ['append', 'replace'];

/**
 * MOB-013 Pass B: the website's Apply template dialog on the same contract.
 * Choose the parts and append/replace, review exactly what changes
 * (`previewApplyTemplate`, writes nothing), then apply in one transaction
 * with the preview hash, the plan revision it was made against and one
 * idempotency key per review. A changed plan or template sends you back to
 * review; nobody is notified and roster entries arrive as prepared requests.
 */
export default function ApplyTemplateScreen() {
  const { id: planId } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['templates', 'common']);
  const { can, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const names = useTemplateNames();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && queryScope),
  });
  const serviceTypeId = plan.data?.service_type_id ?? null;
  const canEditPlan = Boolean(plan.data) && can('plans.edit', { serviceTypeId });
  const templateFilter = serviceTypeId ? { service_type_id: serviceTypeId } : {};
  const templates = useQuery({
    queryKey: queryKeys.planTemplates(queryScope, templateFilter),
    queryFn: () => api.planTemplates(templateFilter),
    enabled: Boolean(queryScope && plan.data && canEditPlan),
  });

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [mode, setMode] = useState<TemplateApplyMode>('append');
  const [chosen, setChosen] = useState<PlanTemplateComponent[]>([...DEFAULT_APPLY_COMPONENTS]);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [preview, setPreview] = useState<TemplateApplyPreviewResult | null>(null);
  // One key per reviewed preview: a transport retry reuses it, a new review gets a new one.
  const [attemptKey, setAttemptKey] = useState(newIdempotencyKey);
  const [conflictReason, setConflictReason] = useState('');

  const usable = usableTemplates(templates.data ?? []);
  const template = usable.find((candidate) => candidate.id === templateId);
  const available = availableComponents(template);
  const isSection = template?.kind === 'section';

  // The template's name as the website's picker shows it.
  const templateLabel = (candidate: PlanTemplateSummary): string =>
    candidate.kind === 'section'
      ? t(candidate.service_type ? 'apply.sectionName' : 'apply.sectionAllTypesName', { name: candidate.name })
      : candidate.service_type ? candidate.name : t('apply.allTypesName', { name: candidate.name });

  const modeOptions = useMemo<readonly SegmentOption<TemplateApplyMode>[]>(
    () => MODES.map((value) => ({ value, label: t(value === 'append' ? 'apply.keepAndAdd' : 'apply.replaceParts') })),
    [t],
  );

  const resetReview = () => {
    setPreview(null);
    setAttemptKey(newIdempotencyKey());
    apply.reset();
  };
  const request = () => (template ? applyTemplateRequest({ template, mode, chosen, insertAt }) : null);

  const review = useMutation({
    mutationFn: () => {
      const body = request();
      if (!body) throw new LocalizedError({ key: 'templates:errors.reviewTemplateFirst' });
      return api.previewApplyTemplate(planId!, body);
    },
    onSuccess: (result) => {
      if (!isCurrentGeneration(generation)) return;
      setPreview(result);
      setAttemptKey(newIdempotencyKey());
      // A fresh review replaces any earlier stale or conflict outcome.
      apply.reset();
    },
  });

  // Back to the plan; opened from a link there may be no screen behind this one.
  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/plan/[id]', params: { id: planId! } });
  };

  const refreshPlan = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, planId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.calendarAll(queryScope) }),
  ]);

  const apply = useMutation({
    mutationFn: () => {
      const body = request();
      if (!preview || !body) throw new LocalizedError({ key: 'templates:errors.reviewTemplateFirst' });
      return api.applyTemplate(planId!, {
        ...body,
        preview_hash: preview.preview_hash,
        expected_revision: preview.destination_revision ?? plan.data?.content_revision ?? 0,
        idempotency_key: attemptKey,
        conflict_override_reason: conflictReason.trim() || null,
      });
    },
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshPlan();
      leave();
    },
    onError: async (error) => {
      if (!isCurrentGeneration(generation)) return;
      // The review no longer describes the plan: read it again and review again.
      if (isStaleTemplateError(error)) {
        await refreshPlan();
        setPreview(null);
      }
    },
  });

  if (plan.isLoading) {
    return <Screen><Loading /></Screen>;
  }
  if (plan.error || !plan.data) {
    return (
      <Screen>
        <View style={[screenPadding(theme), styles.form]}>
          <ErrorNotice error={plan.error} />
          <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void plan.refetch()} />
        </View>
      </Screen>
    );
  }
  const detail = plan.data;
  if (!canEditPlan) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('apply.title') }} />
        <EmptyState title={t('generate.noAccess')} />
      </Screen>
    );
  }

  const conflicts = conflictsFromError(apply.error);
  const stale = isStaleTemplateError(apply.error);
  const mayOverride = can('scheduling.override_conflicts', { serviceTypeId });
  const body = request();
  const busy = review.isPending || apply.isPending;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('apply.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <Text style={styles.planTitle}>{detail.title}</Text>

        {templates.isLoading ? (
          <Loading />
        ) : templates.error ? (
          <View style={styles.group}>
            <ErrorNotice error={templates.error} />
            <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void templates.refetch()} />
          </View>
        ) : usable.length === 0 ? (
          <Card><Text style={styles.muted}>{t('apply.empty')}</Text></Card>
        ) : (
          <View style={styles.group}>
            <Label>{t('apply.template')}</Label>
            <View style={styles.chips}>
              {usable.map((candidate) => (
                <Chip
                  key={candidate.id}
                  label={t('apply.optionWithRevision', { name: templateLabel(candidate), revision: candidate.current_revision })}
                  active={candidate.id === templateId}
                  onPress={() => { setTemplateId(candidate.id); setInsertAt(null); resetReview(); }}
                />
              ))}
            </View>
          </View>
        )}

        {template && !isSection ? (
          <View style={styles.group}>
            <Label>{t('apply.copy')}</Label>
            {PLAN_TEMPLATE_COMPONENTS.map((component) => {
              const present = available.includes(component);
              return (
                <View key={component} style={[styles.switchRow, present ? null : styles.dimmed]}>
                  <Text style={styles.body}>
                    {t(`components.${component}`)}
                    {present ? '' : ` ${t('apply.notInTemplate')}`}
                  </Text>
                  <Switch
                    accessibilityLabel={t(`components.${component}`)}
                    disabled={!present || busy}
                    value={present && chosen.includes(component)}
                    onValueChange={(on) => {
                      setChosen((current) => on ? [...current, component] : current.filter((value) => value !== component));
                      resetReview();
                    }}
                  />
                </View>
              );
            })}
          </View>
        ) : null}

        {template && !isSection ? (
          <View style={styles.group}>
            <Label>{t('apply.existingLegend')}</Label>
            <SegmentedControl
              options={modeOptions}
              value={mode}
              onChange={(value) => { setMode(value); if (value === 'replace') setInsertAt(null); resetReview(); }}
            />
          </View>
        ) : null}

        {template && showsInsertPosition({ template, mode, chosen }, detail.items.length) ? (
          <View style={styles.group}>
            <Label>{t('apply.putItems')}</Label>
            <View style={styles.chips}>
              <Chip label={t('apply.atEnd')} active={insertAt === null} onPress={() => { setInsertAt(null); resetReview(); }} />
              <Chip label={t('apply.atStart')} active={insertAt === 0} onPress={() => { setInsertAt(0); resetReview(); }} />
              {detail.items.slice(0, -1).map((item, index) => (
                <Chip
                  key={item.id}
                  label={t('apply.afterItem', { title: item.title })}
                  active={insertAt === index + 1}
                  onPress={() => { setInsertAt(index + 1); resetReview(); }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {preview ? <TemplateApplyReview preview={preview} /> : null}

        {stale ? <Text accessibilityRole="alert" style={styles.stale}>{t('apply.stale')}</Text> : null}
        {conflicts.length > 0 ? (
          <View style={styles.group}>
            <ConflictList conflicts={conflicts} nameOf={names.person} />
            {mayOverride ? (
              <Field
                accessibilityLabel={t('apply.conflictReasonLabel')}
                placeholder={t('apply.conflictReasonPlaceholder')}
                maxLength={500}
                value={conflictReason}
                onChangeText={setConflictReason}
              />
            ) : (
              <Text style={styles.muted}>{t('apply.noOverride')}</Text>
            )}
          </View>
        ) : !stale ? (
          <ErrorNotice error={review.error ?? apply.error} />
        ) : null}

        <View style={styles.actions}>
          <Button title={t('common:actions.cancel')} variant="secondary" disabled={apply.isPending} onPress={leave} />
          {preview ? (
            <Button
              title={t('common:actions.apply')}
              loading={apply.isPending}
              disabled={preview.blocking.length > 0}
              onPress={() => apply.mutate()}
            />
          ) : (
            <Button
              title={t('apply.reviewChanges')}
              loading={review.isPending}
              disabled={!body || body.components?.length === 0}
              onPress={() => review.mutate()}
            />
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    planTitle: { ...theme.type.heading, color: theme.color.ink },
    switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    dimmed: { opacity: 0.5 },
    body: { ...theme.type.body, color: theme.color.ink, flex: 1 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    stale: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.sm },
  });
