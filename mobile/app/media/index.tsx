import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { MediaSummary } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { mediaListRequest, mediaSummaryLine } from '../../src/lib/media-library';
import { useAuth } from '../../src/providers/AuthProvider';
import { useFormatters } from '../../src/i18n/useFormatters';
import { EmptyState, ErrorNotice, Field, ListRow, Loading, Screen, ScreenHeader, Tag, screenPadding } from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** How long typing has to pause before the search is sent. */
const SEARCH_DELAY_MS = 300;

/**
 * MOB-030: the website's media library (`MediaLibraryPage`) to browse — search
 * by title, include archived bundles, open one. Bundles are added and edited on
 * the website; the server's own list (RLS, up to 200 by title) is shown as is.
 */
export default function MediaLibraryScreen() {
  const { t } = useTranslation(['media', 'common']);
  const { queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const formatters = useFormatters();
  const [query, setQuery] = useState('');
  const [settled, setSettled] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(query.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const list = useQuery({
    queryKey: queryKeys.mediaList(queryScope, settled, includeArchived),
    queryFn: () => api.mediaList(mediaListRequest(settled, includeArchived)),
    enabled: Boolean(queryScope),
  });
  const rows = list.data?.media ?? [];

  const renderRow = ({ item, index }: { item: MediaSummary; index: number }) => (
    <ListRow divided={index > 0} showChevron onPress={() => router.push({ pathname: '/media/[id]', params: { id: item.id } })}>
      <View style={styles.row}>
        <Text style={styles.title}>{item.title}</Text>
        {mediaSummaryLine(item) ? <Text style={styles.muted}>{mediaSummaryLine(item)}</Text> : null}
        <Text style={styles.muted}>
          {t('library.columns.lastUsed')}: {item.last_used_on ? formatters.calendarDate(item.last_used_on, 'medium') : t('library.never')}
          {item.usage_count > 0 ? ` · ${t('library.usageCount', { count: item.usage_count })}` : ''}
        </Text>
        {item.is_archived ? <Tag label={t('files.archived')} accent={theme.accent.yellow} /> : null}
      </View>
    </ListRow>
  );

  return (
    <Screen>
      <Stack.Screen options={{ title: t('library.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        renderItem={renderRow}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader title={t('library.title')} description={t('library.subtitle')} />
            <Field
              accessibilityLabel={t('library.searchLabel')}
              value={query}
              onChangeText={setQuery}
              placeholder={t('library.searchPlaceholder')}
              autoCorrect={false}
              returnKeyType="search"
            />
            <View style={styles.switchRow}>
              <Text style={[styles.body, styles.flex]}>{t('library.includeArchived')}</Text>
              <Switch accessibilityLabel={t('library.includeArchived')} value={includeArchived} onValueChange={setIncludeArchived} />
            </View>
            {list.data?.can_create ? <Text style={styles.muted}>{t('mobileMedia.authoringOnWeb')}</Text> : null}
            <ErrorNotice error={list.error} />
          </View>
        }
        ListEmptyComponent={
          list.isLoading ? (
            <Loading />
          ) : list.error ? null : (
            <EmptyState
              title={settled ? t('mobileMedia.noMatch') : t('library.emptyTitle')}
              description={settled ? undefined : t('mobileMedia.emptyDescription')}
            />
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
    row: { gap: theme.space.xs, alignItems: 'flex-start' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    title: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
