import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ApiError,
  type OpportunityClaimDetail,
  type OpportunityClaimRow,
  type SignupOpportunity,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, Card, EmptyState, ErrorNotice, Label, ListRow, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { StatusBanner, TimeSlotList } from '../../src/components/StaffingParts';
import {
  ClaimAttempts,
  canCancelClaim,
  canClaim,
  claimBody,
  claimEnded,
  classifyClaimError,
  failureNeedsRefetch,
  failureNeedsReview,
  openingAccent,
  openingStatus,
  openingStatusKey,
  pendingApprovals,
  reservationEndsAt,
  type ClaimAttempt,
  type ClaimAttemptOwner,
  type ClaimFailure,
} from '../../src/lib/signup-claims';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/** Lives as long as the app process, so leaving and reopening an opening keeps its retry key. */
const claimAttempts = new ClaimAttempts(newIdempotencyKey);

interface DecisionInput {
  claim: OpportunityClaimDetail;
  action: 'approve' | 'reject';
}

/**
 * MOB-009 Pass B: one opening — required times, explicit claim review,
 * cancellation, and leader approval/close for those who schedule its team.
 * Every action goes through the F07 methods the website uses, and every
 * outcome is read back from the server rather than assumed.
 */
export default function OpeningScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['staffing', 'reports', 'common']);
  const { can, queryScope } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const [reviewing, setReviewing] = useState(false);
  const [failure, setFailure] = useState<ClaimFailure | null>(null);

  const userId = queryScope?.userId ?? null;
  const organizationId = queryScope?.organizationId ?? null;
  const owner = useMemo<ClaimAttemptOwner | null>(
    () => (userId && organizationId ? { userId, organizationId } : null),
    [userId, organizationId],
  );

  const opening = useQuery({
    queryKey: queryKeys.opportunity(queryScope, id),
    queryFn: () => api.getSignupOpportunity(id!),
    enabled: Boolean(id && queryScope),
  });
  const data = opening.data;

  // The opening carries no service type; the plan does (F01 service-type scope).
  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, data?.plan_id),
    queryFn: () => api.getPlan(data!.plan_id),
    enabled: Boolean(data && queryScope),
  });
  const mayLead = Boolean(data)
    && can('scheduling.manage', { teamId: data?.team_id, serviceTypeId: plan.data?.service_type_id ?? null });

  const claims = useQuery({
    queryKey: queryKeys.opportunityClaims(queryScope, data?.plan_id),
    queryFn: () => api.listSignupClaims({ plan_id: data!.plan_id }),
    enabled: mayLead && Boolean(data?.approval_policy === 'leader_approval'),
  });

  // Once the server shows a claim, the retry key has done its job.
  const myClaim = data?.my_claim ?? null;
  useEffect(() => {
    if (!owner || !myClaim || !id) return;
    claimAttempts.settle(owner, id);
    setReviewing(false);
    // The claim the server holds is the outcome; drop any earlier failure (even "full", which
    // the server reports when the only remaining place is this Person's own hold).
    setFailure(null);
  }, [id, myClaim, owner]);

  const refreshAfterChange = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.opportunities(queryScope) });
    await queryClient.invalidateQueries({ queryKey: queryKeys.schedule(queryScope) });
    if (data) await queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, data.plan_id) });
  };

  const claim = useMutation({
    mutationFn: (attempt: ClaimAttempt) => api.claimSignupOpportunity(attempt.opportunityId, claimBody(attempt)),
    onSuccess: async () => {
      setFailure(null);
      await refreshAfterChange();
    },
    onError: async (error) => {
      const outcome = classifyClaimError(error);
      setFailure(outcome);
      if (failureNeedsReview(outcome)) setReviewing(false);
      if (failureNeedsRefetch(outcome)) await refreshAfterChange();
    },
  });

  const cancel = useMutation({
    mutationFn: (current: OpportunityClaimRow) => api.cancelSignupClaim(current.id, { expected_version: current.version }),
    onSettled: refreshAfterChange,
  });

  const decide = useMutation({
    mutationFn: ({ claim: current, action }: DecisionInput) =>
      api.decideSignupClaim(current.id, { expected_version: current.version, action }),
    onSettled: refreshAfterChange,
  });

  const close = useMutation({
    mutationFn: (current: SignupOpportunity) =>
      api.updateSignupOpportunity(current.id, { state: 'closed', expected_version: current.version }),
    onSettled: refreshAfterChange,
  });

  if (opening.isLoading) return <Screen><Loading /></Screen>;
  if (!data) {
    // 404: closed to this Person, removed, or they lost access — never show stale data.
    const hidden = opening.error instanceof ApiError && opening.error.status === 404;
    return (
      <Screen>
        <View style={screenPadding(theme)}>
          {hidden ? (
            <EmptyState
              title={t('openPositions.notAvailable')}
              action={<Button variant="secondary" title={t('common:actions.back')} onPress={() => router.back()} />}
            />
          ) : (
            <>
              <ErrorNotice error={opening.error} />
              <Button variant="secondary" title={t('openPositions.checkAgain')} onPress={() => void opening.refetch()} />
            </>
          )}
        </View>
      </Screen>
    );
  }

  const status = openingStatus(data);
  const title = t('common:format.teamPosition', { team: data.team_name, position: data.position_name });

  const startReview = () => {
    if (!owner) return;
    setFailure(null);
    claimAttempts.review(owner, data);
    setReviewing(true);
  };
  const submit = () => {
    if (!owner) return;
    // Reuses the reviewed attempt's key, so a retry after a lost response is the same claim.
    const attempt = claimAttempts.get(owner, data.id) ?? claimAttempts.review(owner, data);
    claim.mutate(attempt);
  };
  const confirmCancel = (current: OpportunityClaimRow) =>
    Alert.alert(t('openPositions.cancelTitle'), t('openPositions.cancelBody'), [
      { text: t('openPositions.keep'), style: 'cancel' },
      { text: t('openPositions.cancelClaim'), style: 'destructive', onPress: () => cancel.mutate(current) },
    ]);
  const confirmReject = (current: OpportunityClaimDetail) =>
    Alert.alert(t('openPositions.rejectTitle', { name: current.person_name }), t('openPositions.rejectBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('opportunities.reject'), style: 'destructive', onPress: () => decide.mutate({ claim: current, action: 'reject' }) },
    ]);
  const confirmClose = () =>
    Alert.alert(t('openPositions.closeTitle'), t('openPositions.closeBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('opportunities.closeOpening'), style: 'destructive', onPress: () => close.mutate(data) },
    ]);

  const pending = pendingApprovals(claims.data ?? [], data.id, new Date());

  return (
    <Screen>
      <Stack.Screen options={{ title: t('openPositions.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        refreshControl={<RefreshControl refreshing={opening.isRefetching} onRefresh={() => void opening.refetch()} tintColor={theme.color.inkFaint} />}
      >
        <Card>
          <View style={styles.rowTop}>
            <Text style={styles.heading} accessibilityRole="header">{title}</Text>
            <Tag label={t(openingStatusKey(status))} accent={theme.accent[openingAccent(status)]} />
          </View>
          <Text style={styles.muted}>{`${data.plan_title} · ${format.calendarDate(data.service_date, 'medium')}`}</Text>
          <Text style={styles.muted}>
            {`${t('opportunities.remaining', { count: data.remaining_capacity })} · ${t(
              data.approval_policy === 'direct' ? 'opportunities.policySummary.direct' : 'opportunities.policySummary.leader_approval',
              { time: format.dateTime(data.closes_at) },
            )}`}
          </Text>
        </Card>

        <Card>
          <Label>{t('openPositions.requiredTimes')}</Label>
          <TimeSlotList times={data.times} emptyText={t('openPositions.noTimes')} />
        </Card>

        {myClaim ? (
          <StatusBanner
            live
            accent={myClaim.status === 'confirmed' ? 'green' : myClaim.status === 'awaiting_approval' ? 'yellow' : 'neutral'}
            icon={myClaim.status === 'confirmed' ? 'check' : myClaim.status === 'awaiting_approval' ? 'clock' : 'close'}
            title={myClaim.status === 'confirmed'
              ? t('openPositions.status.confirmed')
              : myClaim.status === 'awaiting_approval' && myClaim.reservation_expires_at
                ? t('openPositions.status.awaiting_approval', { time: format.dateTime(myClaim.reservation_expires_at) })
                : t('openPositions.status.ended')}
            body={claimEnded(myClaim) ? null : t('opportunities.description')}
          >
            <ErrorNotice error={cancel.error} />
            {canCancelClaim(myClaim) ? (
              <Button
                variant="secondary"
                title={t('openPositions.cancelClaim')}
                loading={cancel.isPending}
                disabled={cancel.isPending}
                onPress={() => confirmCancel(myClaim)}
              />
            ) : null}
          </StatusBanner>
        ) : null}

        {failure ? (
          <StatusBanner live accent="yellow" icon="alert" title={t(`openPositions.failure.${failure}`)}>
            {failure === 'failed' ? <ErrorNotice error={claim.error} /> : null}
            {failureNeedsRefetch(failure) ? (
              <Button variant="secondary" title={t('openPositions.checkAgain')} loading={opening.isRefetching} onPress={() => void opening.refetch()} />
            ) : null}
          </StatusBanner>
        ) : null}

        {canClaim(data) && !reviewing ? (
          <Button title={t('openPositions.review')} onPress={startReview} />
        ) : null}

        {canClaim(data) && reviewing ? (
          <StatusBanner
            accent={data.approval_policy === 'direct' ? 'green' : 'blue'}
            icon={data.approval_policy === 'direct' ? 'check' : 'clock'}
            title={t('openPositions.reviewTitle')}
            body={data.approval_policy === 'direct'
              ? t('openPositions.reviewDirect', { position: title })
              : t('openPositions.reviewApproval', { time: format.dateTime(reservationEndsAt(data, new Date())) })}
          >
            <View style={styles.actions}>
              <Button variant="secondary" title={t('common:actions.cancel')} disabled={claim.isPending} onPress={() => setReviewing(false)} style={styles.flex} />
              <Button
                title={claim.isPending ? t('openPositions.submitting') : t('openPositions.signUp')}
                loading={claim.isPending}
                disabled={claim.isPending}
                onPress={submit}
                style={styles.flex}
              />
            </View>
          </StatusBanner>
        ) : null}

        {mayLead ? (
          <Card>
            {data.approval_policy === 'leader_approval' ? (
              <>
                <Label>{t('openPositions.leaderTitle')}</Label>
                {claims.isLoading ? <Loading /> : null}
                <ErrorNotice error={claims.error ?? decide.error} />
                {!claims.isLoading && pending.length === 0 ? <Text style={styles.muted}>{t('openPositions.leaderEmpty')}</Text> : null}
                {pending.map((item, index) => (
                  <ListRow key={item.id} divided={index > 0}>
                    <Text style={styles.body}>{item.person_name}</Text>
                    {item.reservation_expires_at
                      ? <Text style={styles.muted}>{t('openPositions.heldUntil', { time: format.dateTime(item.reservation_expires_at) })}</Text>
                      : null}
                    <View style={styles.actions}>
                      <Button variant="secondary" title={t('opportunities.reject')} disabled={decide.isPending} onPress={() => confirmReject(item)} />
                      <Button title={t('opportunities.approve')} disabled={decide.isPending} onPress={() => decide.mutate({ claim: item, action: 'approve' })} />
                    </View>
                  </ListRow>
                ))}
              </>
            ) : null}
            <ErrorNotice error={close.error} />
            {data.state === 'open' ? (
              <Button variant="quiet" title={t('opportunities.closeOpening')} loading={close.isPending} disabled={close.isPending} onPress={confirmClose} />
            ) : null}
            <Text style={styles.muted}>{t('openPositions.createOnWeb')}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    gap: { gap: theme.space.md },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space.sm },
    heading: { ...theme.type.body, fontWeight: '600', color: theme.color.ink, flex: 1 },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space.sm, marginTop: theme.space.sm },
  });
