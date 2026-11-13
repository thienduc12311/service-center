import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Card,
  Chip,
  DateBadge,
  Divider,
  EmptyState,
  ErrorNotice,
  IconWell,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  StatTile,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { Icon, type IconName } from '../../src/components/icons';
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
import type { Accent, Theme } from '../../src/lib/theme';
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
  const { t } = useTranslation(['scheduling', 'staffing', 'common']);

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

  const pendingPlans = useMemo(() => filterScheduleGroups(groups, 'pending').length, [groups]);
  const confirmedPlans = useMemo(() => filterScheduleGroups(groups, 'confirmed').length, [groups]);
  const showStats = scheduleWindow === 'upcoming' && groups.length > 0;

  const summary =
    scheduleWindow === 'upcoming' && groups.length
      ? awaiting
        ? t('mySchedule.summaryAwaiting', { count: groups.length, awaiting })
        : t('mySchedule.summary', { count: groups.length })
      : undefined;

  return (
    <Screen safeTop>
      <FlatList
        data={visible}
        keyExtractor={(group) => group.key}
        contentContainerStyle={[screenPadding(theme), styles.list]}
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
              trailing={<NotificationBell bar={false} />}
            />

            {showStats ? (
              <View style={styles.stats}>
                <StatTile
                  label={t('mySchedule.window.upcoming')}
                  value={groups.length}
                  icon="calendar"
                  accent={theme.accent.blue}
                  onPress={() => setFilter('all')}
                />
                <StatTile
                  label={t('mySchedule.filter.pending')}
                  value={pendingPlans}
                  icon="clock"
                  accent={theme.accent.yellow}
                  onPress={() => setFilter('pending')}
                />
                <StatTile
                  label={t('mySchedule.filter.confirmed')}
                  value={confirmedPlans}
                  icon="check"
                  accent={theme.accent.green}
                  onPress={() => setFilter('confirmed')}
                />
              </View>
            ) : null}

            <View style={styles.filters}>
              <SegmentedControl options={windowOptions} value={scheduleWindow} onChange={setScheduleWindow} />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chips}
                style={styles.chipScroller}
              >
                {filterOptions.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    active={filter === option.value}
                    onPress={() => setFilter(option.value)}
                  />
                ))}
              </ScrollView>
            </View>

            <Card compact style={styles.entries}>
              <EntryRow
                icon="search"
                accent={theme.accent.blue}
                title={t('staffing:openPositions.entry')}
                hint={t('staffing:openPositions.entryHint')}
                onPress={() => router.push('/opportunities')}
              />
              <EntryRow
                divided
                icon="people"
                accent={theme.accent.yellow}
                title={t('staffing:replacements.entry')}
                hint={t('staffing:replacements.entryHint')}
                onPress={() => router.push('/replacements')}
              />
            </Card>

            <ErrorNotice error={schedule.error} />

            {visible.length ? (
              <SectionHeader title={t(`mySchedule.window.${scheduleWindow}`)} count={visible.length} />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          schedule.isLoading ? (
            <Loading label={t('mySchedule.loading')} />
          ) : schedule.error ? null : groups.length && filter !== 'all' ? (
            <EmptyState
              icon="search"
              title={t('mySchedule.noMatchingTitle')}
              description={t(`mySchedule.emptyFilter.${filter}`)}
            />
          ) : scheduleWindow === 'history' ? (
            <EmptyState
              icon="clock"
              title={t('mySchedule.noPastTitle')}
              description={t('mySchedule.noPastDescription')}
            />
          ) : (
            <EmptyState
              icon="schedule"
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

interface EntryRowProps {
  icon: IconName;
  accent: Accent;
  title: string;
  hint: string;
  onPress: () => void;
  divided?: boolean;
}

/** A navigational row into a related staffing screen. */
const EntryRow = ({ icon, accent, title, hint, onPress, divided = false }: EntryRowProps) => {
  const styles = useThemedStyles(makeStyles);
  return (
    <ListRow
      divided={divided}
      showChevron
      onPress={onPress}
      leading={<IconWell name={icon} accent={accent} size={36} />}
    >
      <Text style={styles.entryTitle}>{title}</Text>
      <Text style={styles.entryHint}>{hint}</Text>
    </ListRow>
  );
};

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
        <View style={styles.cardTop}>
          <DateBadge date={group.startsAt} muted={!canRespond} />
          <View style={styles.cardBody}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2}>{group.plan.title}</Text>
              <GroupStatusTag status={group.status} />
            </View>
            <MetaItem icon="clock" label={f.dateTime(group.startsAt)} />
            {group.plan.location ? <MetaItem icon="mapPin" label={group.plan.location} /> : null}
            {count > 1 ? <MetaItem icon="people" label={t('mySchedule.positions', { count })} /> : null}
          </View>
        </View>
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

interface MetaItemProps {
  icon: IconName;
  label: string;
}

/** One line of supporting detail with a small leading glyph. */
const MetaItem = ({ icon, label }: MetaItemProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.metaRow}>
      <Icon name={icon} size={14} color={theme.color.inkFaint} />
      <Text style={styles.meta} numberOfLines={1}>{label}</Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.space.md },
    header: { gap: theme.space.lg },
    stats: { flexDirection: 'row', gap: theme.space.sm },
    filters: { gap: theme.space.md },
    chipScroller: { marginHorizontal: -theme.space.lg, flexGrow: 0 },
    chips: { gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    entries: { paddingVertical: theme.space.xs },
    entryTitle: { ...theme.type.heading, color: theme.color.ink },
    entryHint: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    cardBody: { flex: 1, gap: theme.space.xs },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: theme.space.sm,
      marginBottom: 2,
    },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    meta: { ...theme.type.bodySmall, color: theme.color.inkMuted, flexShrink: 1 },
    times: { marginTop: theme.space.md },
  });
