import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type SignupOpportunity } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { Card, DateBadge, EmptyState, ErrorNotice, Loading, Screen, ScreenHeader, SectionHeader, Tag, screenPadding } from '../../src/components/ui';
import { PressableScale } from '../../src/components/motion';
import { MetaLine } from '../../src/components/StaffingParts';
import { Icon } from '../../src/components/icons';
import { openingAccent, openingStatus, openingStatusKey } from '../../src/lib/signup-claims';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

/**
 * MOB-009 Pass B: Open positions discovery. Lists the F07 openings the server
 * says this Person may see (eligible ones, plus every opening on teams they
 * schedule) — organization-wide, or one plan's when opened from its Teams view.
 */
export default function OpenPositionsScreen() {
  const { planId } = useLocalSearchParams<{ planId?: string }>();
  const { t } = useTranslation(['staffing', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const [refreshing, setRefreshing] = useState(false);

  const openings = useQuery({
    queryKey: queryKeys.opportunityList(queryScope, planId ?? null),
    queryFn: () => api.listSignupOpportunities(planId ? { plan_id: planId } : undefined),
    enabled: Boolean(queryScope),
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await openings.refetch();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [generation, isCurrentGeneration, openings]);

  const renderOpening = (item: SignupOpportunity) => {
    const status = openingStatus(item);
    const title = t('common:format.teamPosition', { team: item.team_name, position: item.position_name });
    return (
      <PressableScale
        key={item.id}
        accessibilityLabel={title}
        pressedOpacity={0.65}
        onPress={() => router.push({ pathname: '/opportunities/[id]', params: { id: item.id } })}
      >
        <Card style={styles.card}>
          {/* Local noon of the civil service date, so the badge never shifts a day. */}
          <DateBadge date={`${item.service_date.slice(0, 10)}T12:00:00`} />
          <View style={styles.cardBody}>
            <View style={styles.rowTop}>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              <Tag label={t(openingStatusKey(status))} accent={theme.accent[openingAccent(status)]} />
            </View>
            <MetaLine icon="plans">{`${item.plan_title} · ${format.calendarDate(item.service_date, 'medium')}`}</MetaLine>
            <MetaLine icon="people">{t('opportunities.remaining', { count: item.remaining_capacity })}</MetaLine>
            <MetaLine icon="clock">
              {t(
                item.approval_policy === 'direct' ? 'opportunities.policySummary.direct' : 'opportunities.policySummary.leader_approval',
                { time: format.dateTime(item.closes_at) },
              )}
            </MetaLine>
          </View>
          <Icon name="chevronRight" size={16} color={theme.color.inkFaint} />
        </Card>
      </PressableScale>
    );
  };

  const data = openings.data ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('openPositions.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.color.inkFaint} />}
      >
        <ScreenHeader title={t('openPositions.title')} description={t('openPositions.description')} />
        <ErrorNotice error={openings.error} />
        {openings.isLoading ? (
          <Loading label={t('opportunities.loading')} />
        ) : openings.error ? null : data.length === 0 ? (
          <EmptyState icon="search" title={t('opportunities.empty')} />
        ) : (
          <>
            <SectionHeader title={t('openPositions.title')} count={data.length} />
            {data.map(renderOpening)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.md },
    card: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    cardBody: { flex: 1, gap: theme.space.xs },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space.sm, marginBottom: 2 },
    title: { ...theme.type.heading, color: theme.color.ink, flex: 1 },
  });
