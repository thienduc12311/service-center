import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  SONG_USAGE_WINDOW_WEEKS,
  mergeSongLibraryPages,
  nextSongLibraryPage,
  type PlanDetail,
  type SongListItem,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/query-keys';
import {
  HIDE_USED_WEEKS,
  NO_SONG_FILTERS,
  SONG_BROWSER_PAGE_SIZE,
  SONG_BROWSER_TABS,
  activeSongFilterCount,
  isRecentlyUsed,
  songBrowserQuery,
  type SongBrowserContext,
  type SongBrowserFilters,
  type SongBrowserTab,
} from '../../lib/song-browser';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useAuth } from '../../providers/AuthProvider';
import type { Theme } from '../../lib/theme';
import { useTheme, useThemedStyles } from '../../lib/useTheme';
import { SearchField } from '../SearchField';
import { Button, Chip, EmptyState, ErrorNotice, Loading } from '../ui';
import { SongBrowserRow, type SongRowPlanState } from './SongBrowserRow';
import { SongFilterSheet, useSpeedLabel, type SongFilterKind } from './SongFilterSheet';

export interface SongBrowserProps {
  plan: Pick<PlanDetail, 'id' | 'service_type_id' | 'service_date'>;
  /** Songs added during this visit (their rows flip to "Added"). */
  addedSongIds: ReadonlySet<string>;
  /** The song whose add is being sent. */
  pendingSongId: string | null;
  /** An add is being sent: other [+] wait. */
  busy: boolean;
  /** `inPlan`: already in the plan, so the caller may confirm a second copy. */
  onAdd: (song: SongListItem, inPlan: boolean) => void;
  /** Insert point, warnings and errors, shown above the list. */
  notices?: ReactNode;
}

/**
 * The plan's song browser (large-list review §3.1, mobile): search and a
 * sticky row of view tabs and filter chips above an infinitely scrolling
 * list. Search is debounced and the last results stay up while the next load.
 */
export const SongBrowser = ({ plan, addedSongIds, pendingSongId, busy, onAdd, notices }: SongBrowserProps) => {
  const { t } = useTranslation(['plans', 'songs', 'common']);
  const { queryScope } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const speedLabel = useSpeedLabel();

  const [openedAt] = useState(() => new Date().toISOString());
  const [tab, setTab] = useState<SongBrowserTab>('suggested');
  const [filters, setFilters] = useState<SongBrowserFilters>(NO_SONG_FILTERS);
  const [editing, setEditing] = useState<SongFilterKind | null>(null);
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());

  const context = useMemo<SongBrowserContext>(
    () => ({ planId: plan.id, serviceTypeId: plan.service_type_id, openedAt }),
    [openedAt, plan.id, plan.service_type_id],
  );
  const query = useMemo(() => songBrowserQuery({ tab, filters, search: settled, context }), [context, filters, settled, tab]);

  const songs = useInfiniteQuery({
    queryKey: queryKeys.songLibrary(queryScope, query),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.listSongs({ ...query, page: pageParam, per_page: SONG_BROWSER_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => nextSongLibraryPage(lastPage),
    enabled: Boolean(queryScope),
    // Calm search: the previous results stay until the new ones arrive.
    placeholderData: keepPreviousData,
  });
  const rows = useMemo(() => mergeSongLibraryPages(songs.data?.pages ?? []), [songs.data]);
  const total = songs.data?.pages[songs.data.pages.length - 1]?.total ?? null;
  const refreshing = songs.isPlaceholderData && songs.isFetching;
  const narrowed = Boolean(settled) || activeSongFilterCount(filters) > 0;
  const firstPageFailed = Boolean(songs.error && !songs.data);

  const setFilter = <K extends keyof SongBrowserFilters>(name: K, value: SongBrowserFilters[K]) =>
    setFilters((current) => ({ ...current, [name]: value }));
  const editingValue = editing === 'key' ? filters.key : editing === 'tempo' ? filters.speed : editing === 'theme' ? filters.theme : null;
  const applyEditing = (value: string | null) => {
    if (editing === 'key') setFilter('key', value);
    if (editing === 'tempo') setFilter('speed', value);
    if (editing === 'theme') setFilter('theme', value);
  };

  const planState = (song: SongListItem): SongRowPlanState =>
    addedSongIds.has(song.id) ? 'added' : song.in_plan ? 'inPlan' : 'none';

  const empty = songs.isLoading ? (
    <Loading />
  ) : firstPageFailed ? null : narrowed ? (
    <EmptyState icon="search" title={t('songBrowser.emptyFilteredTitle')} description={t('songBrowser.emptyFilteredBody')} />
  ) : tab === 'suggested' ? (
    <EmptyState
      icon="music"
      title={t('songBrowser.emptySuggestedTitle')}
      description={plan.service_type_id
        ? t('songBrowser.emptySuggestedBody', { weeks: SONG_USAGE_WINDOW_WEEKS })
        : t('songBrowser.emptyChurchSuggestedBody', { weeks: SONG_USAGE_WINDOW_WEEKS })}
      action={<Button title={t('songBrowser.tabs.title')} variant="secondary" onPress={() => setTab('title')} />}
    />
  ) : (
    <EmptyState icon="music" title={t('songBrowser.emptyLibraryTitle')} description={t('songBrowser.emptyLibraryBody')} />
  );

  return (
    <View style={styles.flex}>
      {/* Outside the list, so search, views and filters stay put while it scrolls. */}
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('songBrowser.searchPlaceholder')}
            style={styles.flex}
          />
          {refreshing ? <ActivityIndicator size="small" color={theme.color.inkFaint} /> : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.chipScroller}
          contentContainerStyle={styles.chips}
        >
          <View accessibilityRole="radiogroup" accessibilityLabel={t('songBrowser.viewsLabel')} style={styles.chipGroup}>
            {SONG_BROWSER_TABS.map((value) => (
              <Chip key={value} label={t(`songBrowser.tabs.${value}`)} active={tab === value} onPress={() => setTab(value)} />
            ))}
          </View>
          <View style={styles.chipDivider} />
          <View accessibilityLabel={t('songBrowser.filtersLabel')} style={styles.chipGroup}>
            <Chip
              toggle
              label={filters.key ? t('songBrowser.filters.keyValue', { key: filters.key }) : t('songBrowser.filters.key')}
              active={Boolean(filters.key)}
              onPress={() => setEditing('key')}
            />
            <Chip
              toggle
              label={filters.speed ? t('songBrowser.filters.tempoValue', { speed: speedLabel(filters.speed) }) : t('songBrowser.filters.tempo')}
              active={Boolean(filters.speed)}
              onPress={() => setEditing('tempo')}
            />
            <Chip
              toggle
              label={filters.theme ? t('songBrowser.filters.themeValue', { theme: filters.theme }) : t('songBrowser.filters.theme')}
              active={Boolean(filters.theme)}
              onPress={() => setEditing('theme')}
            />
            <Chip
              toggle
              label={t('songBrowser.filters.hideUsed', { count: HIDE_USED_WEEKS })}
              active={filters.hideRecentlyUsed}
              onPress={() => setFilter('hideRecentlyUsed', !filters.hideRecentlyUsed)}
            />
            {activeSongFilterCount(filters) > 0 ? (
              <Button title={t('songBrowser.filters.clear')} variant="quiet" onPress={() => setFilters(NO_SONG_FILTERS)} />
            ) : null}
          </View>
        </ScrollView>
        {notices}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(song) => song.id}
        style={styles.flex}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (songs.hasNextPage && !songs.isFetchingNextPage && !songs.isFetchNextPageError) void songs.fetchNextPage();
        }}
        ListHeaderComponent={firstPageFailed ? (
          <View style={styles.retry}>
            <ErrorNotice error={songs.error} />
            <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void songs.refetch()} />
          </View>
        ) : null}
        ListEmptyComponent={empty}
        ListFooterComponent={
          songs.isFetchingNextPage ? (
            <Loading label={t('songs:mobileLibrary.loadingMore')} />
          ) : songs.isFetchNextPageError ? (
            <View style={styles.retry}>
              <Text style={styles.muted}>{t('songs:mobileLibrary.loadMoreFailed')}</Text>
              <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void songs.fetchNextPage()} />
            </View>
          ) : rows.length && total !== null ? (
            <Text style={styles.footer}>
              {songs.hasNextPage
                ? t('common:list.showingOf', { shown: rows.length, total })
                : t('songs:mobileLibrary.allShown', { count: total })}
            </Text>
          ) : null
        }
        renderItem={({ item }) => {
          const state = planState(item);
          return (
            <SongBrowserRow
              song={item}
              planState={state}
              recentlyUsed={state === 'none' && isRecentlyUsed(item.last_scheduled_at, plan.service_date)}
              now={openedAt}
              adding={pendingSongId === item.id}
              disabled={busy}
              onAdd={() => onAdd(item, state !== 'none')}
            />
          );
        }}
      />

      <SongFilterSheet
        kind={editing}
        value={editingValue}
        songs={rows}
        onChange={applyEditing}
        onClose={() => setEditing(null)}
      />
    </View>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    controls: {
      gap: theme.space.sm,
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border,
    },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    chipScroller: { marginHorizontal: -theme.space.lg, flexGrow: 0 },
    chips: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm, paddingHorizontal: theme.space.lg },
    chipGroup: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    chipDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: theme.space.xs, backgroundColor: theme.color.borderStrong },
    list: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.hero },
    retry: { gap: theme.space.md, paddingVertical: theme.space.md },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    footer: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center', paddingVertical: theme.space.lg },
  });
