import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { PressableScale, Reveal } from '../../src/components/motion';
import {
  GroupStatusTag,
  BatchResponseReview,
  ResponsibilityList,
  ScheduleTimes,
} from '../../src/components/AssignmentResponses';
import {
  filterScheduleGroups,
  groupSchedule,
  scheduleWindowQuery,
  type ScheduleFilter,
  type SchedulePlanGroup,
  type ScheduleWindow,
} from '../../src/lib/schedule-groups';
import {
  useAssignmentResponses,
  type AssignmentResponses,
} from '../../src/lib/useAssignmentResponses';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

const WINDOWS: readonly ScheduleWindow[] = ['upcoming', 'history'];
const FILTERS: readonly Exclude<ScheduleFilter, 'all'>[] = ['pending', 'confirmed', 'declined'];

export default function MyScheduleScreen() {
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const responses = useAssignmentResponses();
  const [refreshing, setRefreshing] = useState(false);
  const [scheduleWindow, setScheduleWindow] = useState<ScheduleWindow>('upcoming');
  const [filter, setFilter] = useState<ScheduleFilter>('all');
  const { t } = useTranslation(['scheduling', 'common']);

  const windowOptions = useMemo<readonly SegmentOption<ScheduleWindow>[]>(
    () => WINDOWS.map((value) => ({ value, label: t(`mySchedule.window.${value}`) })),
    [t],
  );
  const filterOptions = useMemo<readonly SegmentOption<ScheduleFilter>[]>(
    () => [
      { value: 'all', label: t('common:states.all') },
      ...FILTERS.map((value) => ({ value, label: t(`mySchedule.filter.${value}`) })),
    ],
    [t],
  );

  const schedule = useQuery({
    queryKey: queryKeys.scheduleWindow(queryScope, scheduleWindow),
    // Every status is fetched so a card always shows all of its positions;
    // the status filter is applied per plan below.
    queryFn: () => api.mySchedule(scheduleWindowQuery(scheduleWindow, new Date())),
    enabled: Boolean(queryScope),
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await schedule.refetch();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [generation, isCurrentGeneration, schedule]);

  const groups = useMemo(
    () => groupSchedule(schedule.data ?? [], queryScope?.organizationId ?? '', scheduleWindow),
    [queryScope?.organizationId, schedule.data, scheduleWindow],
  );
  const visible = useMemo(() => filterScheduleGroups(groups, filter), [filter, groups]);
  const awaiting = groups.reduce((total, group) => total + group.pendingCount, 0);

  const summary =
    scheduleWindow === 'upcoming' && groups.length
      ? awaiting
        ? t('mySchedule.summaryAwaiting', { count: groups.length, awaiting })
        : t('mySchedule.summary', { count: groups.length })
      : undefined;

  return (
    <Screen safeTop>
      <NotificationBell />
      <FlatList
        data={visible}
        keyExtractor={(group) => group.key}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={theme.color.inkFaint}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              eyebrow={summary}
              title={t('mySchedule.title')}
              description={t('mySchedule.mobileDescription')}
            />
            <SegmentedControl options={windowOptions} value={scheduleWindow} onChange={setScheduleWindow} />
            <SegmentedControl options={filterOptions} value={filter} onChange={setFilter} />
            <ErrorNotice error={schedule.error} />
          </View>
        }
        ListEmptyComponent={
          schedule.isLoading ? (
            <Loading label={t('mySchedule.loading')} />
          ) : schedule.error ? null : groups.length && filter !== 'all' ? (
            <EmptyState
              title={t('mySchedule.noMatchingTitle')}
              description={t(`mySchedule.emptyFilter.${filter}`)}
            />
          ) : scheduleWindow === 'history' ? (
            <EmptyState
              title={t('mySchedule.noPastTitle')}
              description={t('mySchedule.noPastDescription')}
            />
          ) : (
            <EmptyState
              title={t('mySchedule.nothingScheduledTitle')}
              description={t('mySchedule.nothingScheduledDescription')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <PlanGroupCard
              group={item}
              responses={responses}
              canRespond={scheduleWindow === 'upcoming'}
              onOpen={() => router.push(`/plan/${item.plan.id}`)}
            />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface PlanGroupCardProps {
  group: SchedulePlanGroup;
  responses: AssignmentResponses;
  canRespond: boolean;
  onOpen: () => void;
}

const PlanGroupCard = ({ group, responses, canRespond, onOpen }: PlanGroupCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const count = group.responsibilities.length;
  const { t } = useTranslation('scheduling');
  const f = useFormatters();

  return (
    <Card>
      <PressableScale
        onPress={onOpen}
        pressedOpacity={0.65}
        accessibilityRole="button"
        accessibilityLabel={t('mySchedule.openPlan', { title: group.plan.title })}
      >
        <View style={styles.topRow}>
          <Text style={styles.date}>{f.dateTime(group.startsAt)}</Text>
          <GroupStatusTag status={group.status} />
        </View>
        <Text style={styles.title}>{group.plan.title}</Text>
        <Text style={styles.meta}>
          {[group.plan.location, count > 1 ? t('mySchedule.positions', { count }) : null].filter(Boolean).join(' · ')}
        </Text>
        <View style={styles.times}>
          <ScheduleTimes times={group.times} responsibilities={group.responsibilities} />
        </View>
      </PressableScale>

      <Divider bleed={theme.space.lg} />
      {canRespond ? (
        <BatchResponseReview responsibilities={group.responsibilities} planId={group.plan.id} />
      ) : null}
      <ResponsibilityList
        responsibilities={group.responsibilities}
        responses={responses}
        canRespond={canRespond}
      />
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.md, marginBottom: theme.space.md },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.space.md,
      marginBottom: theme.space.md,
    },
    date: { ...theme.type.label, color: theme.color.inkMuted, flex: 1 },
    title: { ...theme.type.title, color: theme.color.ink },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: theme.space.xs },
    times: { marginTop: theme.space.md },
  });
