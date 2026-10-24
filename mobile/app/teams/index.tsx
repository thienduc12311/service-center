import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TeamWithPositions } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { teamManageTarget } from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import { EmptyState, ErrorNotice, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/**
 * MOB-031: the website's Teams page on `listTeams`. Team leaders and
 * `teams.manage` holders (organization, service type or that team) change a
 * roster from the team's screen; creating and configuring teams stays on the
 * website.
 */
export default function TeamsScreen() {
  const { t } = useTranslation(['teams', 'common']);
  const { queryScope, can, canEditRoster } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });

  const renderRow = ({ item, index }: { item: TeamWithPositions; index: number }) => (
    <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/teams/[id]', params: { id: item.id } })}>
      <View style={styles.row}>
        <View style={[styles.swatch, { backgroundColor: item.color }]} />
        <View style={styles.flex}>
          <Text style={styles.title}>{item.name}</Text>
          {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
          <Text style={styles.muted}>{t('common:count.people', { count: item.members.length })}</Text>
          {canEditRoster(teamManageTarget(item)) ? (
            <View style={styles.tags}>
              <Tag label={t('mobileTeams.youManage')} accent={theme.accent.blue} />
            </View>
          ) : null}
        </View>
      </View>
    </ListRow>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('teamsPage.title') }} />
      <FlatList
        data={teams.data ?? []}
        keyExtractor={(team) => team.id}
        renderItem={renderRow}
        contentContainerStyle={screenPadding(theme)}
        refreshControl={<RefreshControl refreshing={teams.isRefetching} onRefresh={() => void teams.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('teamsPage.title')} description={t('teamsPage.subtitle')} />
            {can('teams.manage') ? <Text style={styles.muted}>{t('mobileTeams.setupOnWebsite')}</Text> : null}
            <ErrorNotice error={teams.error} />
          </View>
        }
        ListEmptyComponent={
          teams.isLoading ? <Loading /> : teams.error ? null : (
            <EmptyState title={t('teamsPage.empty.title')} description={t('teamsPage.empty.description')} />
          )
        }
      />
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    header: { gap: theme.space.md, marginBottom: theme.space.md },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    swatch: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
    tags: { flexDirection: 'row', gap: theme.space.xs, marginTop: theme.space.xs },
    title: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
