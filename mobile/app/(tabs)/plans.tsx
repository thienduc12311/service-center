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
  EmptyState,
  ErrorNotice,
  Loading,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
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
      <NotificationBell />
      <FlatList
        data={items}
        keyExtractor={(plan) => plan.id}
        contentContainerStyle={screenPadding(theme)}
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
            <ScreenHeader title={t('plansPage.title')} description={t('plansPage.subtitle')} />
            {canCreatePlans ? (
              <View style={styles.actions}>
                <Button title={t('plansPage.newPlan')} icon="plus" onPress={() => router.push('/plan/new')} />
                <Button
                  title={t('plansPage.createFromTemplate')}
                  variant="secondary"
                  onPress={() => router.push('/plan/generate')}
                />
              </View>
            ) : null}
            <SegmentedControl options={windowOptions} value={planWindow} onChange={setPlanWindow} />
            {serviceTypes.data?.length ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                accessibilityLabel={t('mobilePlans.filterServiceType')}
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
            <ErrorNotice error={serviceTypes.error} />
            {firstPageFailed ? (
              <View style={styles.retry}>
                <ErrorNotice error={plans.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void plans.refetch()} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          plans.isLoading ? (
            <Loading label={t('mobilePlans.loading')} />
          ) : firstPageFailed ? null : (
            <EmptyState
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
            <PlanSummaryCard plan={item} onOpen={() => router.push({ pathname: '/plan/[id]', params: { id: item.id } })} />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface PlanSummaryCardProps {
  plan: PlanSummary;
  onOpen: () => void;
}

/** One plan as the website's Plans list shows it: status, service type, when/where and answers. */
const PlanSummaryCard = ({ plan, onOpen }: PlanSummaryCardProps) => {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useTranslation(['plans', 'common']);
  const format = useFormatters();

  return (
    <Card>
      <PressableScale onPress={onOpen} pressedOpacity={0.65} accessibilityRole="button" accessibilityLabel={plan.title}>
        <View style={styles.topRow}>
          <Text style={styles.date}>
            {plan.location
              ? t('plansPage.dateLocation', { date: format.dateTime(plan.service_date), location: plan.location })
              : format.dateTime(plan.service_date)}
          </Text>
          <Tag label={t(`common:planStatus.${plan.status}`)} accent={theme.accent[PLAN_STATUS_ACCENTS[plan.status]]} />
        </View>
        <Text style={styles.title}>{plan.title}</Text>
        {plan.service_type ? (
          <Text style={styles.muted}>
            {t(`plansPage.serviceTypeRecurrence.${plan.service_type.recurrence}`, { name: plan.service_type.name })}
          </Text>
        ) : null}
        <View style={styles.counts}>
          <Text style={styles.muted}>{t('common:count.songs', { count: plan.counts.songs })}</Text>
          <Text style={styles.muted}>{t('plansPage.confirmedCount', { number: plan.counts.confirmed })}</Text>
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
      </PressableScale>
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.lg, marginBottom: theme.space.lg },
    chips: { flexDirection: 'row', gap: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    retry: { gap: theme.space.md, paddingVertical: theme.space.md },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    date: { ...theme.type.label, color: theme.color.inkMuted, flex: 1 },
    title: { ...theme.type.heading, color: theme.color.ink, marginTop: theme.space.xs },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    counts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.md, marginTop: theme.space.sm },
  });
