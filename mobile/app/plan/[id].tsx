import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PLAN_STATUS_ACCENTS,
  computePlanSchedule,
  formatDuration,
  movedItemIds,
  pickPlanNeighbours,
  planNeighbourQueries,
  selectServiceTime,
  serviceTimesOf,
  type AssignmentReleasePreview,
  type PlanItemDetail,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Divider,
  ErrorNotice,
  IconButton,
  Label,
  Loading,
  Screen,
  SegmentedControl,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import { Reveal } from '../../src/components/motion';
import {
  GroupStatusTag,
  BatchResponseReview,
  ResponsibilityList,
  ScheduleTimes,
} from '../../src/components/AssignmentResponses';
import { groupStatus, mergeTimes, planResponsibilities } from '../../src/lib/schedule-groups';
import { useAssignmentResponses } from '../../src/lib/useAssignmentResponses';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';
import { PlanTeams } from '../../src/components/PlanTeams';
import { buildPlanTeams } from '../../src/lib/plan-teams';
import { PlanOrder } from '../../src/components/PlanOrder';
import { orderWriteOutcome, positionNamesFor } from '../../src/lib/plan-order-edit';

/** MOB-008: the two plan views this screen shows (website tabs `order` and `teams`). */
type PlanView = 'order' | 'teams';

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // MOB-012: previous/next swap the id in place; a fresh workspace per plan
  // means no view, draft or release preview carries over to another plan.
  return id ? <PlanWorkspace key={id} id={id} /> : null;
}

interface PlanWorkspaceProps {
  id: string;
}

function PlanWorkspace({ id }: PlanWorkspaceProps) {
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const { can, user, organizationId, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const responses = useAssignmentResponses(id);
  const [releasePreview, setReleasePreview] = useState<AssignmentReleasePreview | null>(null);

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id),
    enabled: Boolean(id && queryScope),
  });

  const detail = plan.data;

  // MOB-012: the same previous/next reads the website's ‹ › arrows use.
  const neighbourQueries = useMemo(() => (detail ? planNeighbourQueries(detail) : null), [detail]);
  const neighbours = useQuery({
    queryKey: queryKeys.planNeighbours(queryScope, id, neighbourQueries),
    queryFn: async () => {
      if (!neighbourQueries) return { previous: null, next: null };
      const [before, after] = await Promise.all([
        api.listPlans(neighbourQueries.before),
        api.listPlans(neighbourQueries.after),
      ]);
      return pickPlanNeighbours(id, before.data, after.data);
    },
    enabled: Boolean(queryScope && neighbourQueries),
  });
  const openPlan = (planId: string) => router.replace({ pathname: '/plan/[id]', params: { id: planId } });

  const queryClient = useQueryClient();
  const [view, setView] = useState<PlanView>('order');
  const [showAllTeams, setShowAllTeams] = useState(false);
  const [editingNeeds, setEditingNeeds] = useState(false);

  const orgTeams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });

  const planTeams = useMemo(
    () => detail
      ? buildPlanTeams({ plan: detail, teams: orgTeams.data ?? [], includeEveryTeam: showAllTeams })
      : [],
    [detail, orgTeams.data, showAllTeams],
  );

  // Same scope rules as the website plan page.
  const target = { serviceTypeId: detail?.service_type_id };
  const canEditPlan = can('plans.edit', target);
  const canScheduleTeam = (teamId: string): boolean => can('scheduling.manage', { ...target, teamId });

  // Website parity: each step saves that one position; positions not sent are kept.
  const setNeed = useMutation({
    mutationFn: ({ positionId, needed }: { positionId: string; needed: number }) =>
      api.setPlanPositionNeeds(id, { needs: [{ position_id: positionId, needed }] }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, id) }),
  });

  const prepared = useMemo(
    () => (detail?.assignments ?? []).filter((assignment) =>
      assignment.visibility === 'prepared'
      && can('scheduling.manage', { serviceTypeId: detail?.service_type_id, teamId: assignment.team_id }),
    ),
    [can, detail?.assignments, detail?.service_type_id],
  );

  const previewRelease = useMutation({
    mutationFn: () => api.previewAssignmentRelease(id, {
      assignment_ids: prepared.map((assignment) => assignment.id),
    }),
    onSuccess: setReleasePreview,
  });
  const release = useMutation({
    mutationFn: (preview: AssignmentReleasePreview) => api.releaseAssignments(id, {
      assignment_ids: preview.assignments.map((assignment) => assignment.assignment_id),
      expected_revisions: preview.assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id,
        request_revision: assignment.request_revision,
      })),
      notify: true,
      idempotency_key: `mobile-release-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    }),
    onSuccess: async () => {
      setReleasePreview(null);
      await plan.refetch();
    },
  });

  // MOB-014 / F11: the order is timed against one service time, on the
  // organization's clock, exactly as the website's Order tab computes it.
  const timeZone = user?.memberships.find((item) => item.organization.id === organizationId)?.organization.timezone ?? 'UTC';
  const [timeId, setTimeId] = useState<string | null>(null);
  const serviceTimes = useMemo(() => serviceTimesOf(detail?.times ?? []), [detail?.times]);
  const selectedTime = detail ? (selectServiceTime(detail.times, timeId ?? undefined) ?? selectServiceTime(detail.times)) : null;
  const schedule = useMemo(
    () => computePlanSchedule({ items: detail?.items ?? [], time: selectedTime ?? null }),
    [detail?.items, selectedTime],
  );
  const positionNames = useMemo(
    () => positionNamesFor(orgTeams.data ?? [], detail?.plan_positions ?? []),
    [orgTeams.data, detail?.plan_positions],
  );

  // Notes on an item go with it, so removing one says how many (F09 readable notes).
  const notes = useQuery({
    queryKey: queryKeys.planNotes(queryScope, id),
    queryFn: () => api.planNotes(id),
    enabled: Boolean(queryScope && canEditPlan),
  });

  const refreshOrder = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rehearsal(queryScope, id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
    ]);

  // F11: each order change carries the revision it was made against; a
  // stale one is refused whole and the latest order is shown instead.
  const reorder = useMutation({
    mutationFn: ({ itemIds, revision }: { itemIds: string[]; revision: number }) =>
      api.reorderPlanItems(id, itemIds, revision),
    onSettled: () => (isCurrentGeneration(generation) ? refreshOrder() : undefined),
  });
  const removeItem = useMutation({
    mutationFn: ({ itemId, revision }: { itemId: string; revision: number }) =>
      api.deletePlanItem(id, itemId, revision),
    onSettled: () => (isCurrentGeneration(generation) ? refreshOrder() : undefined),
  });
  const orderBusy = reorder.isPending || removeItem.isPending || plan.isFetching;
  const orderError = reorder.error ?? removeItem.error;
  const orderOutcome = orderError ? orderWriteOutcome(orderError) : null;

  const moveItem = (index: number, direction: -1 | 1) => {
    if (!detail || orderBusy) return;
    const ids = movedItemIds(detail.items.map((item) => item.id), index, direction);
    if (!ids) return;
    removeItem.reset();
    reorder.mutate({ itemIds: ids, revision: detail.content_revision });
  };

  const confirmRemove = (item: PlanItemDetail) => {
    if (!detail) return;
    const revision = detail.content_revision;
    const notesOnItem = (notes.data?.notes ?? []).filter((note) => note.plan_item_id === item.id).length;
    Alert.alert(
      notesOnItem > 0
        ? t('planDetail.removeItemWithNotesConfirm', { title: item.title, count: notesOnItem })
        : t('planDetail.removeItemConfirm', { title: item.title }),
      undefined,
      [
        { text: t('common:actions.cancel'), style: 'cancel' },
        {
          text: t('common:actions.remove'),
          style: 'destructive',
          onPress: () => {
            reorder.reset();
            removeItem.mutate({ itemId: item.id, revision });
          },
        },
      ],
    );
  };

  // Every position this person holds here — not just the first one found.
  const mine = useMemo(
    () => planResponsibilities(detail?.assignments ?? [], user?.profile.id),
    [detail?.assignments, user?.profile.id],
  );
  const myTimes = useMemo(
    () =>
      mergeTimes(mine.map((item) => {
        const assignment = detail?.assignments.find((candidate) => candidate.id === item.assignmentId);
        // F04: the server's attendance resolver decides which times apply.
        const covered = new Set(assignment?.attendance.flatMap((interval) => interval.plan_time_id ? [interval.plan_time_id] : []) ?? []);
        return {
          assignmentId: item.assignmentId,
          times: (detail?.times ?? []).filter((time) => covered.has(time.id)),
        };
      })),
    [detail?.assignments, detail?.times, mine],
  );

  if (plan.isLoading) {
    return (
      <Screen>
        <Loading label={t('mobilePlan.opening')} />
      </Screen>
    );
  }
  if (plan.error) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorNotice error={plan.error} />
          <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void plan.refetch()} />
        </View>
      </Screen>
    );
  }
  if (!detail) return null;

  const isPast = new Date(detail.service_date).getTime() < Date.now();

  return (
    <Screen>
      <Stack.Screen options={{ title: detail.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Reveal>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <Text style={styles.heroDate}>
                {format.dateTime(detail.service_date)}
              </Text>
              <IconButton
                name="chevronLeft"
                accessibilityLabel={t('header.previousPlan')}
                disabled={!neighbours.data?.previous}
                onPress={() => neighbours.data?.previous && openPlan(neighbours.data.previous)}
              />
              <IconButton
                name="chevronRight"
                accessibilityLabel={t('header.nextPlan')}
                disabled={!neighbours.data?.next}
                onPress={() => neighbours.data?.next && openPlan(neighbours.data.next)}
              />
            </View>
            <View style={styles.heroTags}>
              <Tag label={t(`common:planStatus.${detail.status}`)} accent={theme.accent[PLAN_STATUS_ACCENTS[detail.status]]} />
              {detail.service_type ? (
                <Text style={styles.heroMeta}>
                  {t(`plansPage.serviceTypeRecurrence.${detail.service_type.recurrence}`, { name: detail.service_type.name })}
                </Text>
              ) : null}
            </View>
            <Text style={styles.heroTitle}>{detail.title}</Text>
            <Text style={styles.heroMeta}>
              {[
                detail.location,
                t('mobilePlan.programmed', { duration: formatDuration(detail.total_length_seconds) }),
                t('common:count.songs', { count: detail.counts.songs }),
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>

            {detail.times.length ? (
              <View style={styles.times}>
                {detail.times.map((time) => (
                  <Tag
                    key={time.id}
                    label={t('mobilePlan.timeTag', { name: time.name ?? t(`timeKind.${time.kind}`), dateTime: format.dateTime(time.starts_at) })}
                    accent={time.kind === 'service' ? theme.accent.blue : theme.accent.yellow}
                  />
                ))}
              </View>
            ) : null}
          </View>
        </Reveal>

        {mine.length ? (
          <Reveal index={1}>
            <Card>
              <View style={styles.mineHeader}>
                <Label>{t('mobilePlan.yourPositions', { count: mine.length })}</Label>
                <GroupStatusTag status={groupStatus(mine.map((item) => item.scopeStatus))} />
              </View>
              <ScheduleTimes times={myTimes} responsibilities={mine} />
              <Divider />
              {!isPast ? <BatchResponseReview responsibilities={mine} planId={detail.id} /> : null}
              <ResponsibilityList responsibilities={mine} responses={responses} canRespond={!isPast} />
            </Card>
          </Reveal>
        ) : null}

        {prepared.length ? (
          <Reveal index={2}>
            <Card>
              <Label>{t('mobilePlan.preparedRequests')}</Label>
              {releasePreview ? (
                <View style={styles.releaseReview}>
                  <Text style={styles.muted}>{t('mobilePlan.releaseReviewHint')}</Text>
                  {releasePreview.assignments.map((assignment) => (
                    <View key={assignment.assignment_id} style={styles.releaseItem}>
                      <Text style={styles.personName}>{assignment.person_name}</Text>
                      <Text style={styles.personRole}>
                        {[assignment.team_name, assignment.position_name].filter(Boolean).join(' — ')}
                      </Text>
                      {assignment.times.map((time) => (
                        <Text key={time.id} style={styles.muted}>
                          {t('mobilePlan.timeTag', { name: time.name ?? t(`timeKind.${time.kind}`), dateTime: format.dateTime(time.starts_at) })}
                        </Text>
                      ))}
                    </View>
                  ))}
                  <View style={styles.releaseActions}>
                    <Button
                      title={t('common:actions.cancel')}
                      variant="secondary"
                      disabled={release.isPending}
                      onPress={() => setReleasePreview(null)}
                    />
                    <Button
                      title={t('mobilePlan.releaseAndNotify')}
                      loading={release.isPending}
                      onPress={() => release.mutate(releasePreview)}
                    />
                  </View>
                </View>
              ) : (
                <Button
                  title={t('mobilePlan.reviewAndRelease', { count: prepared.length })}
                  variant="secondary"
                  loading={previewRelease.isPending}
                  onPress={() => previewRelease.mutate()}
                />
              )}
              <ErrorNotice error={previewRelease.error ?? release.error} />
            </Card>
          </Reveal>
        ) : null}

        <SegmentedControl<PlanView>
          options={[
            { value: 'order', label: t('tabs.order') },
            { value: 'teams', label: t('tabs.teams') },
          ]}
          value={view}
          onChange={setView}
        />

        {view === 'order' ? (
        <Reveal index={prepared.length ? 3 : 2}>
          <Card>
            <View style={styles.mineHeader}>
              <Label>{t('mobilePlan.orderOfService')}</Label>
              {detail.items.length ? (
                <Button
                  variant="quiet"
                  icon="music"
                  title={t('mobilePlan.rehearse')}
                  onPress={() => router.push({ pathname: '/plan/rehearse/[id]', params: { id: detail.id } })}
                />
              ) : null}
            </View>
            {canEditPlan ? (
              <View style={styles.orderActions}>
                <Button
                  title={t('orderTab.addItem')}
                  icon="plus"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/plan/add-item/[id]', params: { id: detail.id } })}
                />
                <Button
                  title={t('planDetail.applyTemplate')}
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/plan/apply-template/[id]', params: { id: detail.id } })}
                />
              </View>
            ) : null}
            {orderOutcome === 'stale' ? (
              <Text accessibilityRole="alert" style={styles.warning}>{t('planDetail.orderStale')}</Text>
            ) : orderOutcome === 'uncertain' ? (
              <Text accessibilityRole="alert" style={styles.warning}>{t('mobileOrder.uncertain')}</Text>
            ) : (
              <ErrorNotice error={orderError} />
            )}
            <PlanOrder
              plan={detail}
              schedule={schedule}
              timeZone={timeZone}
              serviceTimes={serviceTimes}
              selectedTimeId={selectedTime?.id ?? null}
              onSelectTime={setTimeId}
              positionNames={positionNames}
              canEdit={canEditPlan}
              busy={orderBusy}
              onEdit={(item) => router.push({ pathname: '/plan/edit-item/[id]', params: { id: detail.id, itemId: item.id } })}
              onMove={moveItem}
              onRemove={confirmRemove}
              onOpenSong={(item) =>
                item.song &&
                router.push({ pathname: '/song/[id]', params: { id: item.song.id, planId: detail.id, itemId: item.id } })}
            />
          </Card>
        </Reveal>
        ) : null}

        {view === 'teams' ? (
          <Reveal index={3}>
            {orgTeams.error ? <ErrorNotice error={orgTeams.error} /> : null}
            {orgTeams.isLoading ? (
              <Loading />
            ) : (
              <PlanTeams
                teams={planTeams}
                canScheduleTeam={canScheduleTeam}
                canEditPlan={canEditPlan}
                editingNeeds={editingNeeds}
                onEditingNeedsChange={setEditingNeeds}
                onNeedChange={(positionId, needed) => setNeed.mutate({ positionId, needed })}
                savingPositionId={setNeed.isPending ? (setNeed.variables?.positionId ?? null) : null}
                showAllTeams={showAllTeams}
                onToggleAllTeams={() => setShowAllTeams((value) => !value)}
                onAddPeople={() => router.push({ pathname: '/plan/schedule/[id]', params: { id: detail.id } })}
                onOpenPositions={() => router.push({ pathname: '/opportunities', params: { planId: detail.id } })}
              />
            )}
            <ErrorNotice error={setNeed.error} />
          </Reveal>
        ) : null}

        {detail.notes ? (
          <Reveal index={4}>
            <Card>
              <Label>{t('mobilePlan.notes')}</Label>
              <Text style={styles.notes}>{detail.notes}</Text>
            </Card>
          </Reveal>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    errorWrap: { padding: theme.space.xl, gap: theme.space.md },

    hero: { gap: theme.space.sm },
    heroTop: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    heroDate: { ...theme.type.label, color: theme.color.inkMuted, flex: 1 },
    heroTags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    heroTitle: { ...theme.type.display, color: theme.color.ink },
    heroMeta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.md },

    mineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
    },

    orderActions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },

    personName: { ...theme.type.body, color: theme.color.ink },
    personRole: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    notes: { ...theme.type.body, color: theme.color.inkMuted },
    releaseReview: { gap: theme.space.md },
    releaseItem: { gap: theme.space.xs },
    releaseActions: { flexDirection: 'row', gap: theme.space.sm },
  });
