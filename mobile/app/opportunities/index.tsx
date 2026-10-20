import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type SignupOpportunity } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { Card, EmptyState, ErrorNotice, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../../src/components/ui';
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

  const renderOpening = (item: SignupOpportunity, index: number) => {
    const status = openingStatus(item);
    return (
      <ListRow
        divided={index > 0}
        showChevron
        onPress={() => router.push({ pathname: '/opportunities/[id]', params: { id: item.id } })}
      >
        <View style={styles.rowTop}>
          <Text style={styles.title} numberOfLines={2}>
            {t('common:format.teamPosition', { team: item.team_name, position: item.position_name })}
          </Text>
          <Tag label={t(openingStatusKey(status))} accent={theme.accent[openingAccent(status)]} />
        </View>
        <Text style={styles.muted} numberOfLines={1}>
          {`${item.plan_title} · ${format.calendarDate(item.service_date, 'medium')}`}
        </Text>
        <Text style={styles.muted}>
          {`${t('opportunities.remaining', { count: item.remaining_capacity })} · ${t(
            item.approval_policy === 'direct' ? 'opportunities.policySummary.direct' : 'opportunities.policySummary.leader_approval',
            { time: format.dateTime(item.closes_at) },
          )}`}
        </Text>
      </ListRow>
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
          <EmptyState title={t('opportunities.empty')} />
        ) : (
          <Card>{data.map((opening, index) => <View key={opening.id}>{renderOpening(opening, index)}</View>)}</Card>
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.md },
    rowTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.space.sm },
    title: { ...theme.type.body, fontWeight: '600', color: theme.color.ink, flex: 1 },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
