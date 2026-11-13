import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  PLAN_STATUS_ACCENTS,
  PLAN_STATUS_LABELS,
  mergePlanPages,
  nextPlanPage,
  planBrowserQuery,
  type PlanBrowserFilters,
  type PlanBrowserWindow,
  type PlanStatus,
  type PlanSummary,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Chip,
  DateBadge,
  EmptyState,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
  SectionHeader,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Icon, type IconName } from '../../src/components/icons';
import { PressableScale, Reveal } from '../../src/components/motion';
import { statusAccent, type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

const WINDOWS: readonly PlanBrowserWindow[] = ['upcoming', 'history'];
const PLAN_STATUSES = Object.keys(PLAN_STATUS_LABELS) as PlanStatus[];

/**
 * MOB-012: every plan the caller may see (RLS decides), by service type and
 * status, upcoming or past, a page at a time. Same list and labels as the
 * website's Plans page. MOB-013: plan editors get New plan and Create from
 * template; templates, rescheduling and matrix tools stay on the website.
 */
export default function PlansScreen() {
  const { t } = useTranslation(['plans', 'common']);
  const { queryScope, generation, isCurrentGeneration, canAnywhere } = useAuth();
  const canCreatePlans = canAnywhere('plans.edit');
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [planWindow, setPlanWindow] = useState<PlanBrowserWindow>('upcoming');
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(null);
  const [status, setStatus] = useState<PlanStatus | null>(null);
  // Fixed until a pull to refresh, so pages don't shift as the clock moves.
  const [openedAt, setOpenedAt] = useState(() => new Date().toISOString());
  const [refreshing, setRefreshing] = useState(false);

  const filters = useMemo<PlanBrowserFilters>(
    () => ({ window: planWindow, serviceTypeId, status, openedAt }),
    [openedAt, planWindow, serviceTypeId, status],
  );

  const serviceTypes = useQuery({
    queryKey: queryKeys.serviceTypes(queryScope),
    queryFn: () => api.listServiceTypes(),
    enabled: Boolean(queryScope),
  });

  const plans = useInfiniteQuery({
    queryKey: queryKeys.planList(queryScope, filters),
    queryFn: ({ pageParam }: { pageParam: number }) => api.listPlans(planBrowserQuery(filters, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => nextPlanPage(lastPage),
    enabled: Boolean(queryScope),
  });

  // Answers, releases and edits made from a plan change its counts; read the
  // loaded pages again when coming back to the tab rather than show stale ones.
  const focusedOnce = useRef(false);
  const { refetch } = plans;
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) void refetch();
      focusedOnce.current = true;
    }, [refetch]),
  );

  const items = useMemo(() => mergePlanPages(plans.data?.pages ?? []), [plans.data]);
  const filtered = Boolean(serviceTypeId || status);

  const windowOptions = useMemo<readonly SegmentOption<PlanBrowserWindow>[]>(
    () => WINDOWS.map((value) => ({ value, label: t(`mobilePlans.window.${value}`) })),
    [t],
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setOpenedAt(new Date().toISOString());
    await serviceTypes.refetch();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [generation, isCurrentGeneration, serviceTypes]);

  // A failed first page shows the error with a retry; a failed later page keeps what loaded.
  const firstPageFailed = Boolean(plans.error && !plans.data);

  return (
    <Screen safeTop>
      <FlatList
        data={items}
        keyExtractor={(plan) => plan.id}
        contentContainerStyle={[screenPadding(theme), styles.list]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.inkFaint} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (plans.hasNextPage && !plans.isFetchingNextPage && !plans.isFetchNextPageError) {
            void plans.fetchNextPage();
          }
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              title={t('plansPage.title')}
              description={t('plansPage.subtitle')}
              trailing={<NotificationBell bar={false} />}
            />
            {canCreatePlans ? (
              <View style={styles.actions}>
                <Button
                  title={t('plansPage.newPlan')}
                  icon="plus"
                  style={styles.action}
                  onPress={() => router.push('/plan/new')}
                />
                <Button
                  title={t('plansPage.createFromTemplate')}
                  icon="document"
                  variant="secondary"
                  style={styles.action}
                  onPress={() => router.push('/plan/generate')}
                />
              </View>
            ) : null}
            <View style={styles.filters}>
              <SegmentedControl options={windowOptions} value={planWindow} onChange={setPlanWindow} />
              {serviceTypes.data?.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  accessibilityLabel={t('mobilePlans.filterServiceType')}
                  style={styles.chipScroller}
                  contentContainerStyle={styles.chips}
                >
                  <Chip label={t('mobilePlans.allServiceTypes')} active={!serviceTypeId} onPress={() => setServiceTypeId(null)} />
                  {serviceTypes.data.map((type) => (
                    <Chip
                      key={type.id}
                      label={type.name}
                      active={serviceTypeId === type.id}
                      onPress={() => setServiceTypeId(type.id)}
                    />
                  ))}
                </ScrollView>
              ) : null}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityLabel={t('plansPage.filterStatus')}
                style={styles.chipScroller}
                contentContainerStyle={styles.chips}
              >
                <Chip label={t('plansPage.allStatuses')} active={!status} onPress={() => setStatus(null)} />
                {PLAN_STATUSES.map((value) => (
                  <Chip
                    key={value}
                    label={t(`common:planStatus.${value}`)}
                    active={status === value}
                    onPress={() => setStatus(value)}
                  />
                ))}
              </ScrollView>
            </View>
            <ErrorNotice error={serviceTypes.error} />
            {firstPageFailed ? (
              <View style={styles.retry}>
                <ErrorNotice error={plans.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void plans.refetch()} />
              </View>
            ) : null}
            {items.length ? <SectionHeader title={t(`mobilePlans.window.${planWindow}`)} /> : null}
          </View>
        }
        ListEmptyComponent={
          plans.isLoading ? (
            <Loading label={t('mobilePlans.loading')} />
          ) : firstPageFailed ? null : (
            <EmptyState
              icon={filtered ? 'search' : 'plans'}
              title={t(planWindow === 'history' ? 'mobilePlans.emptyHistoryTitle' : 'mobilePlans.emptyUpcomingTitle')}
              description={t(filtered ? 'mobilePlans.emptyFilteredDescription' : 'mobilePlans.emptyDescription')}
            />
          )
        }
        ListFooterComponent={
          plans.isFetchingNextPage ? (
            <Loading />
          ) : plans.isFetchNextPageError ? (
            <View style={styles.retry}>
              <Text style={styles.muted}>{t('mobilePlans.loadMoreFailed')}</Text>
              <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void plans.fetchNextPage()} />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Reveal index={Math.min(index, 8)}>
            <PlanSummaryCard plan={item} past={planWindow === 'history'} onOpen={() => router.push({ pathname: '/plan/[id]', params: { id: item.id } })} />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface PlanSummaryCardProps {
  plan: PlanSummary;
  /** Past plans draw a muted date. */
  past: boolean;
  onOpen: () => void;
}

/** One plan as the website's Plans list shows it: status, service type, when/where and answers. */
const PlanSummaryCard = ({ plan, past, onOpen }: PlanSummaryCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();

  return (
    <PressableScale
      onPress={onOpen}
      pressedOpacity={0.65}
      accessibilityRole="button"
      accessibilityLabel={plan.title}
    >
      <Card>
        <View style={styles.cardTop}>
          <DateBadge date={plan.service_date} muted={past} />
          <View style={styles.cardBody}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2}>{plan.title}</Text>
              <Tag label={t(`common:planStatus.${plan.status}`)} accent={theme.accent[PLAN_STATUS_ACCENTS[plan.status]]} />
            </View>
            <MetaItem icon="clock" label={format.dateTime(plan.service_date)} />
            {plan.location ? <MetaItem icon="mapPin" label={plan.location} /> : null}
            {plan.service_type ? (
              <MetaItem
                icon="plans"
                label={t(`plansPage.serviceTypeRecurrence.${plan.service_type.recurrence}`, { name: plan.service_type.name })}
              />
            ) : null}
          </View>
        </View>
        <View style={styles.counts}>
          <View style={styles.count}>
            <Icon name="music" size={14} color={theme.color.inkFaint} />
            <Text style={styles.countLabel}>{t('common:count.songs', { count: plan.counts.songs })}</Text>
          </View>
          <View style={styles.count}>
            <Icon name="check" size={14} color={theme.accent.green.fg} />
            <Text style={styles.countLabel}>{t('plansPage.confirmedCount', { number: plan.counts.confirmed })}</Text>
          </View>
          {plan.counts.unconfirmed > 0 ? (
            <Tag
              label={t('plansPage.pendingCount', { number: plan.counts.unconfirmed })}
              accent={statusAccent(theme, 'unconfirmed')}
            />
          ) : null}
          {plan.counts.declined > 0 ? (
            <Tag
              label={t('plansPage.declinedCount', { number: plan.counts.declined })}
              accent={statusAccent(theme, 'declined')}
            />
          ) : null}
        </View>
      </Card>
    </PressableScale>
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
      <Text style={styles.metaText} numberOfLines={1}>{label}</Text>
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: theme.space.md },
    header: { gap: theme.space.lg },
    filters: { gap: theme.space.md },
    chipScroller: { marginHorizontal: -theme.space.lg, flexGrow: 0 },
    chips: { flexDirection: 'row', gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    action: { flexGrow: 1 },
    retry: { gap: theme.space.md, paddingVertical: theme.space.md },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    cardBody: { flex: 1, gap: theme.space.xs },
    titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, marginBottom: 2 },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    metaText: { ...theme.type.bodySmall, color: theme.color.inkMuted, flexShrink: 1 },
    counts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: theme.space.md,
      paddingTop: theme.space.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
    },
    count: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    countLabel: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
