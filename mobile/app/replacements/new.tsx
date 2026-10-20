import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  replacementRequestExpiry,
  replacementRequiredTimes,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Label, Loading, Screen, screenPadding } from '../../src/components/ui';
import { MetaLine, StatusBanner, TimeSlotList } from '../../src/components/StaffingParts';
import {
  RequestAttempts,
  canRequestReplacement,
  classifyReplacementError,
  failureNeedsRefetch,
  requestBody,
  requestForAssignment,
  type RequestAttempt,
  type RequestAttemptOwner,
  type ReplacementFailure,
} from '../../src/lib/replacements';
import { useMyPersonId, useRefreshAfterReplacement, useReplacementRequests } from '../../src/lib/useReplacements';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/** Lives as long as the app process, so leaving and coming back keeps the retry key. */
const requestAttempts = new RequestAttempts(newIdempotencyKey);

/**
 * MOB-010 Pass B: review and send a replacement request for one declined
 * position. The decline stays as it is; the server opens one request per
 * assignment, and a retry with the same key returns that same request.
 */
export default function NewReplacementScreen() {
  const { assignment: assignmentId, plan: planId } = useLocalSearchParams<{ assignment: string; plan: string }>();
  const { t } = useTranslation(['staffing', 'reports', 'common']);
  const { queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const myPersonId = useMyPersonId();
  const refreshAfter = useRefreshAfterReplacement();
  const [failure, setFailure] = useState<ReplacementFailure | null>(null);

  const owner = useMemo<RequestAttemptOwner | null>(
    () => (queryScope ? { userId: queryScope.userId, organizationId: queryScope.organizationId } : null),
    [queryScope],
  );

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, planId),
    queryFn: () => api.getPlan(planId!),
    enabled: Boolean(planId && queryScope),
  });
  const requests = useReplacementRequests();
  const assignment = plan.data?.assignments.find((item) => item.id === assignmentId) ?? null;
  const existing = assignmentId ? requestForAssignment(requests.data ?? [], assignmentId) : null;

  // Once the server holds an open or filled request for this position, show that instead.
  useEffect(() => {
    if (!existing || !owner || !assignmentId) return;
    if (existing.status !== 'open' && existing.status !== 'filled') return;
    requestAttempts.settle(owner, assignmentId);
    router.replace({ pathname: '/replacements/[id]', params: { id: existing.id } });
  }, [assignmentId, existing, owner, router]);

  const create = useMutation({
    mutationFn: (attempt: RequestAttempt) => api.createReplacementRequest(requestBody(attempt)),
    onSuccess: async (created) => {
      if (owner && assignmentId) requestAttempts.settle(owner, assignmentId);
      await refreshAfter(planId);
      router.replace({ pathname: '/replacements/[id]', params: { id: created.id } });
    },
    onError: async (error) => {
      const outcome = classifyReplacementError(error);
      setFailure(outcome);
      if (failureNeedsRefetch(outcome)) await refreshAfter(planId);
    },
  });

  if (plan.isLoading || requests.isLoading) return <Screen><Loading /></Screen>;

  const mine = assignment && myPersonId !== null && assignment.person_id === myPersonId;
  if (!plan.data || !assignment || !mine) {
    const hidden = !plan.data && plan.error instanceof ApiError && plan.error.status === 404;
    return (
      <Screen>
        <Stack.Screen options={{ title: t('replacements.reviewTitle') }} />
        <View style={screenPadding(theme)}>
          {plan.error && !hidden ? (
            <>
              <ErrorNotice error={plan.error} />
              <Button variant="secondary" title={t('replacements.checkAgain')} onPress={() => void plan.refetch()} />
            </>
          ) : (
            <EmptyState
              title={t('replacements.notAvailable')}
              action={<Button variant="secondary" title={t('common:actions.back')} onPress={() => router.back()} />}
            />
          )}
        </View>
      </Screen>
    );
  }

  const required = replacementRequiredTimes(
    { applicable_time_ids: assignment.attendance_mode === 'all' ? [] : assignment.attendance_times.map((time) => time.plan_time_id) },
    plan.data.times,
  );
  const position = t('common:format.teamPosition', {
    team: assignment.team?.name ?? t('common:fallback.team'),
    position: assignment.position?.name ?? '',
  });
  const allowed = canRequestReplacement({ status: assignment.status, positionId: assignment.position_id }, existing);
  const expiresAt = owner && assignmentId ? requestAttempts.get(owner, assignmentId)?.expiresAt ?? replacementRequestExpiry(new Date(), required) : null;

  const submit = () => {
    if (!owner || !assignmentId || !expiresAt) return;
    setFailure(null);
    // Reuses the reviewed attempt's key, so a retry after a lost response is the same request.
    const attempt = requestAttempts.review(owner, { id: assignmentId, requestRevision: assignment.request_revision }, expiresAt);
    create.mutate(attempt);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('replacements.reviewTitle') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.gap]}>
        <Card>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">{position}</Text>
            <MetaLine icon="calendar">{`${plan.data.title} · ${format.calendarDate(plan.data.service_date, 'medium')}`}</MetaLine>
          </View>
        </Card>

        <Card>
          <Label>{t('replacements.requiredTimes')}</Label>
          <TimeSlotList times={required} emptyText={t('replacements.noTimes')} />
        </Card>

        {failure ? (
          <StatusBanner accent="yellow" icon="alert" title={t(`replacements.failure.${failure}`)} live>
            {failure === 'failed' ? <ErrorNotice error={create.error} /> : null}
          </StatusBanner>
        ) : null}

        {!allowed || assignment.status !== 'declined' ? (
          <StatusBanner accent="neutral" icon="close" title={t('replacements.notAvailable')} />
        ) : !expiresAt ? (
          <StatusBanner accent="yellow" icon="alert" title={t('replacements.tooLate')} />
        ) : (
          <StatusBanner accent="blue" icon="search" title={t('replacements.reviewTitle')} body={t('replacements.reviewBody', { position })}>
            <MetaLine icon="clock" strong>{t('replacements.openUntil', { time: format.dateTime(expiresAt) })}</MetaLine>
            <MetaLine icon="bell">{t('replacements.noNotifications')}</MetaLine>
            <View style={styles.actions}>
              <Button variant="secondary" title={t('common:actions.cancel')} disabled={create.isPending} onPress={() => router.back()} style={styles.flex} />
              <Button
                title={create.isPending ? t('replacements.submitting') : t('replacements.submit')}
                loading={create.isPending}
                disabled={create.isPending}
                onPress={submit}
                style={styles.flex}
              />
            </View>
          </StatusBanner>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    gap: { gap: theme.space.md },
    header: { gap: theme.space.sm },
    title: { ...theme.type.title, color: theme.color.ink },
    actions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
  });
