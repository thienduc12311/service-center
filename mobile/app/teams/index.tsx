import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TeamWithPositions } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { teamManageTarget } from '../../src/lib/directory';
import { useAuth } from '../../src/providers/AuthProvider';
import { EmptyState, ErrorNotice, ListRow, Loading, Screen, ScreenHeader, SectionHeader, Tag, screenPadding } from '../../src/components/ui';
import { Icon } from '../../src/components/icons';
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

  const count = teams.data?.length ?? 0;
  const renderRow = ({ item, index }: { item: TeamWithPositions; index: number }) => (
    <View style={[styles.groupRow, index === 0 && styles.groupFirst, index === count - 1 && styles.groupLast]}>
      <ListRow
        divided={index > 0}
        showChevron
        onPress={() => router.push({ pathname: '/teams/[id]', params: { id: item.id } })}
        leading={
          <View style={styles.tile}>
            <Icon name="people" size={20} color={item.color} />
          </View>
        }
      >
        <Text style={styles.title}>{item.name}</Text>
        {item.description ? <Text style={styles.muted} numberOfLines={2}>{item.description}</Text> : null}
        <View style={styles.metaRow}>
          <Icon name="person" size={14} color={theme.color.inkFaint} />
          <Text style={styles.muted}>{t('common:count.people', { count: item.members.length })}</Text>
        </View>
        {canEditRoster(teamManageTarget(item)) ? (
          <View style={styles.tags}>
            <Tag label={t('mobileTeams.youManage')} accent={theme.accent.blue} />
          </View>
        ) : null}
      </ListRow>
    </View>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('teamsPage.title') }} />
      <FlatList
        data={teams.data ?? []}
        keyExtractor={(team) => team.id}
        renderItem={renderRow}
        contentContainerStyle={[screenPadding(theme), styles.list]}
        refreshControl={<RefreshControl refreshing={teams.isRefetching} onRefresh={() => void teams.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('teamsPage.title')} description={t('teamsPage.subtitle')} />
            {can('teams.manage') ? <Text style={styles.muted}>{t('mobileTeams.setupOnWebsite')}</Text> : null}
            <ErrorNotice error={teams.error} />
            {count ? <SectionHeader title={t('teamsPage.title')} count={count} /> : null}
          </View>
        }
        ListEmptyComponent={
          teams.isLoading ? <Loading /> : teams.error ? null : (
            <EmptyState icon="people" title={t('teamsPage.empty.title')} description={t('teamsPage.empty.description')} />
          )
        }
      />
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    header: { gap: theme.space.lg, marginBottom: theme.space.md },
    list: { gap: 0 },
    groupRow: {
      backgroundColor: theme.color.surface,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: theme.color.border,
      paddingHorizontal: theme.space.md,
    },
    groupFirst: {
      borderTopWidth: 1,
      borderTopLeftRadius: theme.radius.lg + 2,
      borderTopRightRadius: theme.radius.lg + 2,
    },
    groupLast: {
      borderBottomWidth: 1,
      borderBottomLeftRadius: theme.radius.lg + 2,
      borderBottomRightRadius: theme.radius.lg + 2,
    },
    tile: {
      width: 40,
      height: 40,
      borderRadius: theme.radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.surfaceInset,
      borderWidth: 1,
      borderColor: theme.color.border,
    },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    tags: { flexDirection: 'row', gap: theme.space.xs, marginTop: theme.space.xs },
    title: { ...theme.type.heading, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
