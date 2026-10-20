import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { type PlanDetail, type ReplacementRequestDetail, type ServiceCenterAccentName, type TeamWithPositions } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import { Card, EmptyState, ErrorNotice, IconWell, Label, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../../src/components/ui';
import type { IconName } from '../../src/components/icons';
import { replacementSection, requestAccent, type ReplacementSection } from '../../src/lib/replacements';
import { useMyPersonId, useReplacementRequests } from '../../src/lib/useReplacements';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';
import { useFormatters } from '../../src/i18n';

const SECTIONS: readonly ReplacementSection[] = ['forYou', 'toReview', 'yours', 'past'];
/** How each section looks, so what needs the person's attention stands out. */
const SECTION_LOOK: Record<ReplacementSection, { icon: IconName; accent: ServiceCenterAccentName }> = {
  forYou: { icon: 'bell', accent: 'blue' },
  toReview: { icon: 'person', accent: 'yellow' },
  yours: { icon: 'search', accent: 'blue' },
  past: { icon: 'clock', accent: 'neutral' },
};
/** Earlier requests shown; the endpoint returns the latest 200. */
const PAST_LIMIT = 20;

/**
 * MOB-010 Pass B: every replacement request this Person may see (RLS: their
 * own, ones they were asked to fill, and ones on teams they schedule), grouped
 * by what they can do about it.
 */
export default function ReplacementsScreen() {
  const { t } = useTranslation(['staffing', 'common']);
  const { can, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const myPersonId = useMyPersonId();
  const [refreshing, setRefreshing] = useState(false);

  const requests = useReplacementRequests();
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const planIds = useMemo(() => [...new Set((requests.data ?? []).map((request) => request.plan_id))], [requests.data]);
  const plans = useQueries({
    queries: planIds.map((planId) => ({
      queryKey: queryKeys.plan(queryScope, planId),
      queryFn: () => api.getPlan(planId),
      enabled: Boolean(queryScope),
    })),
  });
  const planById = useMemo(() => {
    const map = new Map<string, PlanDetail>();
    for (const result of plans) if (result.data) map.set(result.data.id, result.data);
    return map;
  }, [plans]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await requests.refetch();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [generation, isCurrentGeneration, requests]);

  const grouped = useMemo(() => {
    const result = new Map<ReplacementSection, ReplacementRequestDetail[]>(SECTIONS.map((section) => [section, []]));
    for (const request of requests.data ?? []) {
      const mayLead = can('scheduling.manage', { teamId: request.team_id, serviceTypeId: planById.get(request.plan_id)?.service_type_id ?? null });
      result.get(replacementSection(request, myPersonId, mayLead))!.push(request);
    }
    result.set('past', result.get('past')!.slice(0, PAST_LIMIT));
    return result;
  }, [can, myPersonId, planById, requests.data]);

  const label = (request: ReplacementRequestDetail, list: readonly TeamWithPositions[]): string => {
    const team = list.find((item) => item.id === request.team_id);
    const plan = planById.get(request.plan_id);
    const position = team?.positions.find((item) => item.id === request.position_id)?.name
      ?? plan?.plan_positions.find((item) => item.id === request.position_id)?.name
      ?? '';
    return t('common:format.teamPosition', { team: team?.name ?? t('common:fallback.team'), position });
  };

  const total = requests.data?.length ?? 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('replacements.title') }} />
      <ScrollView
        contentContainerStyle={[screenPadding(theme), styles.gap]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.color.inkFaint} />}
      >
        <ScreenHeader title={t('replacements.title')} description={t('replacements.description')} />
        <ErrorNotice error={requests.error} />
        {requests.isLoading ? (
          <Loading label={t('replacements.loading')} />
        ) : requests.error ? null : total === 0 ? (
          <EmptyState title={t('replacements.empty')} />
        ) : (
          SECTIONS.filter((section) => grouped.get(section)!.length > 0).map((section) => (
            <View key={section} style={styles.section}>
              <Label>{t(`replacements.sections.${section}`)}</Label>
              <Card>
                {grouped.get(section)!.map((request, index) => {
                  const plan = planById.get(request.plan_id);
                  return (
                    <ListRow
                      key={request.id}
                      divided={index > 0}
                      showChevron
                      onPress={() => router.push({ pathname: '/replacements/[id]', params: { id: request.id } })}
                    >
                      <View style={styles.row}>
                        <IconWell name={SECTION_LOOK[section].icon} accent={theme.accent[SECTION_LOOK[section].accent]} />
                        <View style={styles.rowText}>
                          <Text style={styles.title} numberOfLines={2}>{label(request, teams.data ?? [])}</Text>
                          {plan ? (
                            <Text style={styles.muted} numberOfLines={1}>{`${plan.title} · ${format.calendarDate(plan.service_date, 'medium')}`}</Text>
                          ) : null}
                          <Tag label={t(`replacements.requestStatus.${request.status}`)} accent={theme.accent[requestAccent(request.status)]} />
                        </View>
                      </View>
                    </ListRow>
                  );
                })}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    gap: { gap: theme.space.md },
    section: { gap: theme.space.sm },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    rowText: { flex: 1, gap: theme.space.xs, alignItems: 'flex-start' },
    title: { ...theme.type.heading, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
