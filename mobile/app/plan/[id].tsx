import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  formatDuration,
  resolvePlanItemChartContext,
  type AssignmentDetail,
  type AssignmentReleasePreview,
  type PlanItemDetail,
} from '@service-center/shared';

/** F11: the same service key the chart, web order and song book show. */
const planItemKey = (item: PlanItemDetail): string => {
  const context = resolvePlanItemChartContext(item);
  return context.status === 'ready' ? (context.displayKey ?? '—') : '—';
};
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Divider,
  ErrorNotice,
  KeyCap,
  Label,
  Loading,
  Screen,
  Tag,
  screenPadding,
} from '../../src/components/ui';
import { PressableScale, Reveal } from '../../src/components/motion';
import {
  GroupStatusTag,
  BatchResponseReview,
  ResponsibilityList,
  ScheduleTimes,
} from '../../src/components/AssignmentResponses';
import { groupStatus, mergeTimes, planResponsibilities } from '../../src/lib/schedule-groups';
import { useAssignmentResponses } from '../../src/lib/useAssignmentResponses';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/** One team, and everyone on it for this plan. */
interface TeamGroup {
  name: string;
  assignments: AssignmentDetail[];
}

export default function PlanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();
  const { can, user, queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const responses = useAssignmentResponses(id);
  const [releasePreview, setReleasePreview] = useState<AssignmentReleasePreview | null>(null);

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });

  const detail = plan.data;

  const teams = useMemo<TeamGroup[]>(() => {
    const groups = new Map<string, AssignmentDetail[]>();
    for (const assignment of detail?.assignments ?? []) {
      const key = assignment.team?.name ?? t('mobilePlan.unassigned');
      groups.set(key, [...(groups.get(key) ?? []), assignment]);
    }
    return [...groups.entries()].map(([name, assignments]) => ({ name, assignments }));
  }, [detail?.assignments, t]);

  const prepared = useMemo(
    () => (detail?.assignments ?? []).filter((assignment) =>
      assignment.visibility === 'prepared'
      && can('scheduling.manage', { serviceTypeId: detail?.service_type_id, teamId: assignment.team_id }),
    ),
    [can, detail?.assignments, detail?.service_type_id],
  );

  const previewRelease = useMutation({
    mutationFn: () => api.previewAssignmentRelease(id!, {
      assignment_ids: prepared.map((assignment) => assignment.id),
    }),
    onSuccess: setReleasePreview,
  });
  const release = useMutation({
    mutationFn: (preview: AssignmentReleasePreview) => api.releaseAssignments(id!, {
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

  // Headers divide the order but aren't items in it, so they take no number.
  const ordinals = useMemo(() => {
    const numbers = new Map<string, number>();
    for (const item of detail?.items ?? []) {
      if (item.item_type !== 'header') numbers.set(item.id, numbers.size + 1);
    }
    return numbers;
  }, [detail?.items]);

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
            <Text style={styles.heroDate}>
              {format.dateTime(detail.service_date)}
            </Text>
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
            {detail.items.length ? (
              <View>
                {detail.items.map((item, index) =>
                  item.item_type === 'header' ? (
                    <Text key={item.id} style={styles.orderHeader}>
                      {item.title.toUpperCase()}
                    </Text>
                  ) : (
                    <View key={item.id}>
                      {index > 0 ? <Divider /> : null}
                      <PressableScale
                        disabled={!item.song}
                        onPress={() =>
                          item.song &&
                          router.push({
                            pathname: '/song/[id]',
                            params: { id: item.song.id, planId: detail.id, itemId: item.id },
                          })
                        }
                        pressedOpacity={0.6}
                        style={styles.orderItem}
                      >
                        <Text style={styles.ordinal}>
                          {String(ordinals.get(item.id) ?? index + 1).padStart(2, '0')}
                        </Text>
                        <View style={styles.flex}>
                          <Text style={[styles.itemTitle, item.song ? styles.itemLink : null]}>
                            {item.title}
                          </Text>
                          {item.description ? (
                            <Text style={styles.itemNote}>{item.description}</Text>
                          ) : null}
                        </View>
                        {item.item_type === 'song' ? (
                          <KeyCap>{planItemKey(item)}</KeyCap>
                        ) : null}
                        <Text style={styles.itemLength}>{formatDuration(item.length_seconds)}</Text>
                      </PressableScale>
                    </View>
                  ),
                )}
              </View>
            ) : (
              <Text style={styles.muted}>{t('mobilePlan.emptyOrder')}</Text>
            )}
          </Card>
        </Reveal>

        <Reveal index={3}>
          <Card>
            <Label>{t('mobilePlan.whoIsServing')}</Label>
            {teams.length ? (
              teams.map((group) => (
                <View key={group.name} style={styles.teamGroup}>
                  <Text style={styles.teamName}>{group.name}</Text>
                  {group.assignments.map((assignment) => (
                    <View key={assignment.id} style={styles.person}>
                      <Avatar
                        name={assignment.person?.full_name ?? assignment.person?.email}
                        size={32}
                      />
                      <View style={styles.flex}>
                        <Text style={styles.personName}>
                          {assignment.person?.full_name ?? assignment.person?.email ?? t('common:states.unknown')}
                        </Text>
                        {assignment.position ? (
                          <Text style={styles.personRole}>{assignment.position.name}</Text>
                        ) : null}
                      </View>
                      <Tag
                        label={t(`common:assignmentStatus.${assignment.status}`)}
                        accent={statusAccent(theme, assignment.status)}
                      />
                    </View>
                  ))}
                </View>
              ))
            ) : (
              <Text style={styles.muted}>{t('mobilePlan.nobodyScheduled')}</Text>
            )}
          </Card>
        </Reveal>

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
    errorWrap: { padding: theme.space.xl },

    hero: { gap: theme.space.sm },
    heroDate: { ...theme.type.label, color: theme.color.inkMuted },
    heroTitle: { ...theme.type.display, color: theme.color.ink },
    heroMeta: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    times: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm, marginTop: theme.space.md },

    mineHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
    },

    orderHeader: {
      ...theme.type.label,
      color: theme.color.inkFaint,
      marginTop: theme.space.xl,
      marginBottom: theme.space.sm,
    },
    orderItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    ordinal: { ...theme.type.numeric, color: theme.color.inkFaint },
    itemTitle: { ...theme.type.body, color: theme.color.ink },
    itemLink: { fontWeight: '600' },
    itemNote: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    itemLength: { ...theme.type.numeric, color: theme.color.inkFaint, minWidth: 46, textAlign: 'right' },

    teamGroup: { gap: theme.space.md },
    teamName: { ...theme.type.heading, color: theme.color.ink },
    person: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    personName: { ...theme.type.body, color: theme.color.ink },
    personRole: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    notes: { ...theme.type.body, color: theme.color.inkMuted },
    releaseReview: { gap: theme.space.md },
    releaseItem: { gap: theme.space.xs },
    releaseActions: { flexDirection: 'row', gap: theme.space.sm },
  });
