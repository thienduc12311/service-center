import { useEffect, useMemo, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  replacementRequiredTimes,
  type ReplacementOfferRow,
  type ReplacementRequestDetail,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { useAuth } from '../../src/providers/AuthProvider';
import { Avatar, Button, Card, EmptyState, ErrorNotice, Label, ListRow, Loading, Screen, Tag, screenPadding } from '../../src/components/ui';
import { MetaLine, StatusBanner, StepPills, TimeSlotList, type StatusBannerProps } from '../../src/components/StaffingParts';
import {
  canAnswerOffer,
  candidateConflictRequest,
  canApproveOffer,
  canCancelRequest,
  canRejectOffer,
  classifyReplacementError,
  failureNeedsRefetch,
  myOffer,
  offerActionBody,
  offerActionLanded,
  offerIsLive,
  offerStage,
  offerStageAccent,
  replacementCandidates,
  requestAccent,
  unavailableCandidates,
  type OfferAction,
  type ReplacementCandidate,
  type ReplacementFailure,
} from '../../src/lib/replacements';
import { useMyPersonId, usePeople, useRefreshAfterReplacement, useReplacementRequests } from '../../src/lib/useReplacements';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

interface OfferActionInput {
  offer: ReplacementOfferRow;
  action: OfferAction;
}

/** The last offer action sent, so a refused replay can be checked against what the server now shows. */
interface SentAction extends OfferActionInput {
  failure: ReplacementFailure;
}

/**
 * MOB-010 Pass B: one replacement request. The requester tracks and may
 * cancel it; an asked candidate reviews the exact times and agrees or
 * declines; a scheduler of the team offers it, then approves or rejects.
 * Every action goes through the F07 methods the website uses, and every
 * outcome is read back from the server rather than assumed.
 */
export default function ReplacementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['staffing', 'reports', 'common']);
  const { can, queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const myPersonId = useMyPersonId();
  const people = usePeople();
  const refreshAfter = useRefreshAfterReplacement();
  const [reviewingAccept, setReviewingAccept] = useState(false);
  const [candidate, setCandidate] = useState<ReplacementCandidate | null>(null);
  const [sent, setSent] = useState<SentAction | null>(null);
  const [requestFailure, setRequestFailure] = useState<ReplacementFailure | null>(null);

  const requests = useReplacementRequests();
  const request: ReplacementRequestDetail | null = requests.data?.find((item) => item.id === id) ?? null;

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, request?.plan_id),
    queryFn: () => api.getPlan(request!.plan_id),
    enabled: Boolean(request && queryScope),
  });
  const mayLead = Boolean(request)
    && can('scheduling.manage', { teamId: request?.team_id, serviceTypeId: plan.data?.service_type_id ?? null });

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope && request),
  });

  const offerable = mayLead && request?.status === 'open' ? replacementCandidates(request, teams.data ?? []) : [];
  // Also check people already asked whose offer is still live, so a leader never approves someone who can't agree.
  const checked: ReplacementCandidate[] = mayLead && request?.status === 'open'
    ? [...offerable, ...request.offers.filter(offerIsLive).map((offer) => ({ personId: offer.candidate_person_id, name: null }))]
    : [];
  const conflictCheck = useQuery({
    queryKey: [...queryKeys.replacements(queryScope), 'candidate-conflicts', request?.id ?? null, request?.version ?? null, checked.map((item) => item.personId).join(',')],
    queryFn: () => api.checkAssignmentConflicts(candidateConflictRequest(request!, checked)),
    enabled: Boolean(request) && checked.length > 0,
  });

  // A refused replay whose effect the server now shows was not a failure.
  const sentOffer = sent ? request?.offers.find((offer) => offer.id === sent.offer.id) ?? null : null;
  useEffect(() => {
    if (sent && sentOffer && offerActionLanded(sent.action, sentOffer)) setSent(null);
  }, [sent, sentOffer]);

  const act = useMutation({
    mutationFn: ({ offer, action }: OfferActionInput) => api.actOnReplacementOffer(offer.id, offerActionBody(offer, action)),
    onSuccess: async () => {
      setSent(null);
      setReviewingAccept(false);
      await refreshAfter(request?.plan_id);
    },
    onError: async (error, input) => {
      const failure = classifyReplacementError(error);
      setSent({ ...input, failure });
      setReviewingAccept(false);
      if (failureNeedsRefetch(failure)) await refreshAfter(request?.plan_id);
    },
  });

  const issue = useMutation({
    mutationFn: (chosen: ReplacementCandidate) =>
      api.issueReplacementOffer(request!.id, {
        candidate_person_id: chosen.personId,
        expected_version: request!.version,
        // F07 returns the existing offer for the same candidate whatever the key.
        idempotency_key: newIdempotencyKey(),
      }),
    onSuccess: async () => {
      setCandidate(null);
      setRequestFailure(null);
      await refreshAfter(request?.plan_id);
    },
    onError: async (error) => {
      const failure = classifyReplacementError(error);
      setRequestFailure(failure);
      if (failureNeedsRefetch(failure)) await refreshAfter(request?.plan_id);
    },
  });

  const cancel = useMutation({
    mutationFn: (current: ReplacementRequestDetail) => api.cancelReplacementRequest(current.id, { expected_version: current.version }),
    onSuccess: async () => {
      setRequestFailure(null);
      await refreshAfter(request?.plan_id);
    },
    onError: async (error) => {
      const failure = classifyReplacementError(error);
      setRequestFailure(failure);
      if (failureNeedsRefetch(failure)) await refreshAfter(request?.plan_id);
    },
  });

  const nameOf = useMemo(() => {
    const names = new Map((people.data ?? []).filter((person) => person.person_id).map((person) => [person.person_id!, person.full_name]));
    return (personId: string): string => names.get(personId) || t('replacements.unnamed');
  }, [people.data, t]);

  if (requests.isLoading) return <Screen><Loading label={t('replacements.loading')} /></Screen>;
  if (!request) {
    // Not in the caller's RLS-scoped list: never theirs, removed, or access lost.
    return (
      <Screen>
        <Stack.Screen options={{ title: t('replacements.title') }} />
        <View style={screenPadding(theme)}>
          {requests.error ? (
            <>
              <ErrorNotice error={requests.error} />
              <Button variant="secondary" title={t('replacements.checkAgain')} onPress={() => void requests.refetch()} />
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

  const team = teams.data?.find((item) => item.id === request.team_id) ?? null;
  const positionName = team?.positions.find((item) => item.id === request.position_id)?.name
    ?? plan.data?.plan_positions.find((item) => item.id === request.position_id)?.name
    ?? '';
  const position = t('common:format.teamPosition', { team: team?.name ?? t('common:fallback.team'), position: positionName });
  const required = replacementRequiredTimes(request, plan.data?.times ?? []);
  const mine = myOffer(request, myPersonId);
  const isRequester = myPersonId !== null && request.requester_person_id === myPersonId;
  const candidates = offerable;
  // Leaders see who would be refused at consent (blockout or another commitment) before offering.
  const reasons = unavailableCandidates(conflictCheck.data?.conflicts ?? []);
  // The candidate sees only their own offer (RLS); requester and leaders see every offer.
  const shownOffers = isRequester || mayLead ? request.offers : [];

  const confirmDecline = (offer: ReplacementOfferRow) =>
    Alert.alert(t('replacements.declineTitle'), t('replacements.declineBody'), [
      { text: t('replacements.keep'), style: 'cancel' },
      { text: t('replacements.decline'), style: 'destructive', onPress: () => act.mutate({ offer, action: 'decline' }) },
    ]);
  const confirmReject = (offer: ReplacementOfferRow) =>
    Alert.alert(t('replacements.leader.rejectTitle', { name: nameOf(offer.candidate_person_id) }), t('replacements.leader.rejectBody'), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('replacements.leader.reject'), style: 'destructive', onPress: () => act.mutate({ offer, action: 'reject' }) },
    ]);
  const confirmCancel = () =>
    Alert.alert(t('replacements.cancelTitle'), t('replacements.cancelBody'), [
      { text: t('replacements.keepRequest'), style: 'cancel' },
      { text: t('replacements.cancelRequest'), style: 'destructive', onPress: () => cancel.mutate(request) },
    ]);

  const youText = (offer: ReplacementOfferRow): string => {
    const stage = offerStage(offer);
    if (stage === 'awaiting_both') return t('replacements.you.needsLeader');
    if (stage === 'awaiting_candidate') return t('replacements.you.approvedFirst');
    if (stage === 'awaiting_leader' && offer.reservation_expires_at) {
      return t('replacements.you.awaiting', { time: format.dateTime(offer.reservation_expires_at) });
    }
    if (stage === 'confirmed') return t('replacements.you.confirmed');
    return t('replacements.you.ended');
  };
  /** The candidate's own banner: what they are asked, or where their answer stands. */
  const youBanner = (offer: ReplacementOfferRow): StatusBannerProps => {
    const stage = offerStage(offer);
    if (canAnswerOffer(offer, myPersonId) && request.status === 'open') {
      return { accent: 'blue', icon: 'bell', title: t('replacements.you.asked', { position }), body: youText(offer) };
    }
    if (stage === 'awaiting_leader') return { accent: 'yellow', icon: 'clock', title: t('replacements.stage.awaiting_leader'), body: youText(offer) };
    if (stage === 'confirmed') return { accent: 'green', icon: 'check', title: t('replacements.you.confirmed') };
    return { accent: 'neutral', icon: 'close', title: t('replacements.you.ended') };
  };
  /** The requester's banner: whether anyone has been found. */
  const requesterBanner: StatusBannerProps = request.status === 'open'
    ? { accent: 'blue', icon: 'search', title: t('replacements.requestStatus.open'), body: t('replacements.askedCount', { count: request.offers.length }) }
    : request.status === 'filled'
      ? { accent: 'green', icon: 'check', title: t('replacements.requestStatus.filled') }
      : { accent: 'neutral', icon: 'close', title: t(`replacements.requestStatus.${request.status}`) };
  const steps = (offer: ReplacementOfferRow) => [
    { label: t('replacements.progress.agreed'), done: offer.consented_at !== null },
    { label: t('replacements.progress.approved'), done: offer.leader_approved_at !== null },
  ];
  const showSentFailure = sent && !(sentOffer && offerActionLanded(sent.action, sentOffer));

  return (
    <Screen>
      <Stack.Screen options={{ title: t('replacements.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        refreshControl={<RefreshControl refreshing={requests.isRefetching} onRefresh={() => void requests.refetch()} tintColor={theme.color.inkFaint} />}
      >
        <Card>
          <View style={styles.header}>
            <Tag label={t(`replacements.requestStatus.${request.status}`)} accent={theme.accent[requestAccent(request.status)]} />
            <Text style={styles.title} accessibilityRole="header">{position}</Text>
            {plan.data ? <MetaLine icon="calendar">{`${plan.data.title} · ${format.calendarDate(plan.data.service_date, 'medium')}`}</MetaLine> : null}
            {!isRequester ? <MetaLine icon="person">{t('replacements.requestedBy', { name: nameOf(request.requester_person_id) })}</MetaLine> : null}
            {request.status === 'open' ? <MetaLine icon="clock" strong>{t('replacements.expiresAt', { time: format.dateTime(request.expires_at) })}</MetaLine> : null}
          </View>
        </Card>

        {mine ? (
          <StatusBanner {...youBanner(mine)} live>
            {canAnswerOffer(mine, myPersonId) && request.status === 'open' ? (
              <>
                <StepPills steps={steps(mine)} />
                {reviewingAccept ? (
                  <View style={styles.review}>
                    <Text style={styles.reviewTitle}>{t('replacements.acceptTitle')}</Text>
                    <Text style={styles.body}>{t('replacements.acceptBody', { position })}</Text>
                  </View>
                ) : null}
                <View style={styles.actions}>
                  {reviewingAccept ? (
                    <>
                      <Button variant="secondary" title={t('common:actions.cancel')} disabled={act.isPending} onPress={() => setReviewingAccept(false)} style={styles.flex} />
                      <Button
                        title={act.isPending ? t('replacements.accepting') : t('replacements.accept')}
                        icon="check"
                        loading={act.isPending}
                        disabled={act.isPending}
                        onPress={() => act.mutate({ offer: mine, action: 'accept' })}
                        style={styles.flex}
                      />
                    </>
                  ) : (
                    <>
                      <Button variant="secondary" title={t('replacements.decline')} disabled={act.isPending} onPress={() => confirmDecline(mine)} style={styles.flex} />
                      <Button title={t('replacements.acceptReview')} disabled={act.isPending} onPress={() => setReviewingAccept(true)} style={styles.flex} />
                    </>
                  )}
                </View>
              </>
            ) : offerIsLive(mine) ? <StepPills steps={steps(mine)} /> : null}
          </StatusBanner>
        ) : isRequester ? (
          <StatusBanner {...requesterBanner} live />
        ) : null}

        {showSentFailure && sent ? (
          <StatusBanner accent="yellow" icon="alert" title={t(`replacements.failure.${sent.failure}`)} live>
            {sent.failure === 'failed' ? <ErrorNotice error={act.error} /> : null}
            {sent.failure === 'uncertain' ? (
              <Button variant="secondary" title={t('replacements.checkAgain')} loading={requests.isRefetching} onPress={() => void requests.refetch()} />
            ) : null}
          </StatusBanner>
        ) : null}

        <Card>
          <Label>{t('replacements.requiredTimes')}</Label>
          {plan.isLoading ? <Loading /> : null}
          <ErrorNotice error={plan.error} />
          {plan.data ? <TimeSlotList times={required} emptyText={t('replacements.noTimes')} /> : null}
        </Card>

        {shownOffers.length > 0 || isRequester || mayLead ? (
          <Card>
            <Label>{t('replacements.offers')}</Label>
            {shownOffers.length === 0 ? <Text style={styles.muted}>{t('replacements.noOffers')}</Text> : null}
            {shownOffers.map((offer, index) => {
              const stage = offerStage(offer);
              const name = nameOf(offer.candidate_person_id);
              return (
                <ListRow key={offer.id} divided={index > 0}>
                  <View style={styles.offer}>
                    <Avatar name={name} />
                    <View style={styles.offerText}>
                      <Text style={styles.name}>{name}</Text>
                      <Tag label={t(`replacements.stage.${stage}`)} accent={theme.accent[offerStageAccent(stage)]} />
                      {mayLead && offerIsLive(offer) && reasons.get(offer.candidate_person_id) ? (
                        <Tag label={t(`replacements.leader.unavailable.${reasons.get(offer.candidate_person_id)!}`)} accent={theme.accent.red} />
                      ) : null}
                    </View>
                  </View>
                  {offerIsLive(offer) ? <StepPills steps={steps(offer)} /> : null}
                  {stage === 'awaiting_leader' && offer.reservation_expires_at ? (
                    <MetaLine icon="clock" strong>{t('replacements.heldUntil', { time: format.dateTime(offer.reservation_expires_at) })}</MetaLine>
                  ) : null}
                  {canApproveOffer(offer, request, mayLead) || canRejectOffer(offer, request, mayLead) ? (
                    <View style={styles.actions}>
                      {canRejectOffer(offer, request, mayLead) ? (
                        <Button variant="secondary" title={t('replacements.leader.reject')} disabled={act.isPending} onPress={() => confirmReject(offer)} style={styles.flex} />
                      ) : null}
                      {canApproveOffer(offer, request, mayLead) ? (
                        <Button title={t('replacements.leader.approve')} icon="check" disabled={act.isPending} onPress={() => act.mutate({ offer, action: 'approve' })} style={styles.flex} />
                      ) : null}
                    </View>
                  ) : null}
                </ListRow>
              );
            })}
          </Card>
        ) : null}

        {requestFailure ? (
          <StatusBanner accent="yellow" icon="alert" title={t(`replacements.failure.${requestFailure}`)} live>
            {requestFailure === 'failed' ? <ErrorNotice error={issue.error ?? cancel.error} /> : null}
          </StatusBanner>
        ) : null}

        {mayLead && request.status === 'open' ? (
          <Card>
            <Label>{t('replacements.leader.title')}</Label>
            <Text style={styles.muted}>{t('replacements.leader.hint')}</Text>
            {teams.isLoading ? <Loading /> : null}
            <ErrorNotice error={teams.error} />
            {!teams.isLoading && candidates.length === 0 && !candidate ? <Text style={styles.muted}>{t('replacements.leader.none')}</Text> : null}
            {candidate ? (
              <StatusBanner
                accent="blue"
                icon="person"
                title={t('replacements.leader.review', { position, name: candidate.name ?? t('replacements.unnamed') })}
              >
                <MetaLine icon="bell">{t('replacements.noNotifications')}</MetaLine>
                <View style={styles.actions}>
                  <Button variant="secondary" title={t('common:actions.cancel')} disabled={issue.isPending} onPress={() => setCandidate(null)} style={styles.flex} />
                  <Button
                    title={issue.isPending ? t('replacements.leader.sending') : t('replacements.leader.send')}
                    loading={issue.isPending}
                    disabled={issue.isPending}
                    onPress={() => issue.mutate(candidate)}
                    style={styles.flex}
                  />
                </View>
              </StatusBanner>
            ) : (
              candidates.map((item, index) => {
                const reason = reasons.get(item.personId);
                return (
                  <ListRow
                    key={item.personId}
                    divided={index > 0}
                    showChevron={!reason}
                    onPress={reason ? undefined : () => setCandidate(item)}
                  >
                    <View style={styles.offer}>
                      <Avatar name={item.name ?? t('replacements.unnamed')} />
                      <View style={styles.offerText}>
                        <Text style={[styles.name, reason && styles.dim]}>{item.name ?? t('replacements.unnamed')}</Text>
                        {reason ? (
                          <Tag label={t(`replacements.leader.unavailable.${reason}`)} accent={theme.accent.red} />
                        ) : conflictCheck.isSuccess ? (
                          <Tag label={t('replacements.leader.available')} accent={theme.accent.green} />
                        ) : null}
                      </View>
                    </View>
                  </ListRow>
                );
              })
            )}
          </Card>
        ) : null}

        {canCancelRequest(request, myPersonId, mayLead) ? (
          <Button variant="quiet" title={t('replacements.cancelRequest')} loading={cancel.isPending} disabled={cancel.isPending} onPress={confirmCancel} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    gap: { gap: theme.space.md },
    header: { gap: theme.space.sm, alignItems: 'flex-start' },
    title: { ...theme.type.title, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    review: { gap: theme.space.xs },
    reviewTitle: { ...theme.type.heading, color: theme.color.ink },
    offer: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    offerText: { flex: 1, gap: theme.space.xs, alignItems: 'flex-start' },
    name: { ...theme.type.heading, color: theme.color.ink, flexShrink: 1 },
    dim: { color: theme.color.inkFaint },
    actions: { flexDirection: 'row', gap: theme.space.sm, marginTop: theme.space.sm },
  });
