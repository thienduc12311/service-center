import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  SONG_LIBRARY_PAGE_SIZE,
  mergeSongLibraryPages,
  nextSongLibraryPage,
  parseSongLibraryFilters,
  songLibraryBpm,
  songLibraryFilterCount,
  songLibraryKeys,
  type ListSongsQuery,
  type SongLibraryFilterName,
  type SongLibraryFilterValues,
  type SongListItem,
  type TranslationKey,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  KeyCap,
  Label,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  SegmentedControl,
  Tag,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { KeyPicker } from '../../src/components/KeyPicker';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Icon } from '../../src/components/icons';
import { Reveal } from '../../src/components/motion';
import { useFormatters } from '../../src/i18n';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

type LibrarySort = ListSongsQuery['sort'];
type LibraryScope = ListSongsQuery['archive'];

const SEARCH_DELAY_MS = 300;

/** A free-text filter field: the query parameter it sets and its caption (the website's). */
interface TextFilterField {
  name: Exclude<SongLibraryFilterName, 'archive' | 'key'>;
  label: TranslationKey<'songs'>;
  numeric?: boolean;
  date?: boolean;
}

const TEXT_FILTERS: readonly TextFilterField[] = [
  { name: 'theme', label: 'songsPage.filters.theme' },
  { name: 'song_type', label: 'songsPage.filters.songType' },
  { name: 'style', label: 'songsPage.filters.style' },
  { name: 'speed', label: 'songsPage.filters.speed' },
  { name: 'author', label: 'songsPage.filters.author' },
  { name: 'bpm_min', label: 'songsPage.filters.bpmMin', numeric: true },
  { name: 'bpm_max', label: 'songsPage.filters.bpmMax', numeric: true },
  { name: 'scheduled_from', label: 'songsPage.filters.scheduledFrom', date: true },
  { name: 'scheduled_to', label: 'songsPage.filters.scheduledTo', date: true },
];

/** The search box's text once typing pauses, so each keystroke is not a request. */
const useSettledText = (value: string): string => {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
};

/**
 * MOB-028: the whole song library a page at a time — the website's Songs page
 * on the same `listSongs` query (search, sort, active/archived scope and the
 * F15 metadata filters, 50 rows a page). Library managers can add a song.
 */
export default function SongsScreen() {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration, canAnywhere } = useAuth();
  // The song library is organization-wide; leading a team never implies it.
  const canManage = canAnywhere('songs.manage');
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [search, setSearch] = useState('');
  const q = useSettledText(search);
  const [sort, setSort] = useState<LibrarySort>('title');
  const [scope, setScope] = useState<LibraryScope>('active');
  const [showFilters, setShowFilters] = useState(false);
  const [form, setForm] = useState<SongLibraryFilterValues>({});
  const [filters, setFilters] = useState<Partial<ListSongsQuery>>({});
  const [filterError, setFilterError] = useState<LocalizedError | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = useMemo<Partial<ListSongsQuery>>(
    () => ({ ...filters, q: q || undefined, sort, archive: scope }),
    [filters, q, scope, sort],
  );
  const activeFilterCount = songLibraryFilterCount(filters);

  const library = useInfiniteQuery({
    queryKey: queryKeys.songLibrary(queryScope, query),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.listSongs({ ...query, page: pageParam, per_page: SONG_LIBRARY_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => nextSongLibraryPage(lastPage),
    enabled: Boolean(queryScope),
  });

  // Songs edited, archived or added elsewhere change the list; re-read on return.
  const focusedOnce = useRef(false);
  const { refetch } = library;
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) void refetch();
      focusedOnce.current = true;
    }, [refetch]),
  );

  const rows = useMemo(() => mergeSongLibraryPages(library.data?.pages ?? []), [library.data]);
  const total = library.data?.pages[library.data.pages.length - 1]?.total ?? null;

  const sortOptions = useMemo<readonly SegmentOption<LibrarySort>[]>(
    () => [
      { value: 'title', label: t('songsPage.sortTitle') },
      { value: 'recent', label: t('songsPage.sortRecent') },
    ],
    [t],
  );
  const scopeOptions = useMemo<readonly SegmentOption<LibraryScope>[]>(
    () => [
      { value: 'active', label: t('mobileLibrary.scope.active') },
      { value: 'archived', label: t('mobileLibrary.scope.archived') },
      { value: 'all', label: t('mobileLibrary.scope.all') },
    ],
    [t],
  );

  const setField = (name: SongLibraryFilterName, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const applyFilters = () => {
    const parsed = parseSongLibraryFilters(form);
    if (!parsed.ok) {
      setFilterError(new LocalizedError({ key: 'songs:mobileLibrary.filters.invalid' }));
      return;
    }
    // Only the filters: search, sort and scope have their own controls.
    const { page: _page, per_page: _perPage, sort: _sort, archive: _archive, q: _q, ...only } = parsed.query;
    setFilterError(null);
    setFilters(only);
  };
  const clearFilters = () => {
    setForm({});
    setFilters({});
    setFilterError(null);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    if (isCurrentGeneration(generation)) setRefreshing(false);
  }, [generation, isCurrentGeneration, refetch]);

  const firstPageFailed = Boolean(library.error && !library.data);
  const narrowed = Boolean(q || activeFilterCount || scope !== 'active');
  const filterToggleLabel = activeFilterCount
    ? t(showFilters ? 'songsPage.hideFiltersCount' : 'songsPage.filtersCount', { count: activeFilterCount })
    : t(showFilters ? 'songsPage.hideFilters' : 'songsPage.filters.toggle');

  return (
    <Screen safeTop>
      <NotificationBell />
      <FlatList
        data={rows}
        keyExtractor={(song) => song.id}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.color.inkFaint} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (library.hasNextPage && !library.isFetchingNextPage && !library.isFetchNextPageError) {
            void library.fetchNextPage();
          }
        }}
        ListHeaderComponent={
          <View style={styles.head}>
            <ScreenHeader
              eyebrow={total !== null ? t('common:count.songs', { count: total }) : undefined}
              title={t('common:nav.songs')}
              description={t('mobileLibrary.description')}
            />
            {canManage ? (
              <View style={styles.actions}>
                <Button title={t('songsPage.addSong')} icon="plus" onPress={() => router.push('/song/new')} />
              </View>
            ) : null}

            <View style={styles.search}>
              <Icon name="search" size={18} color={theme.color.inkFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('mobileSongs.searchPlaceholder')}
                placeholderTextColor={theme.color.inkFaint}
                accessibilityLabel={t('songsPage.searchLabel')}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            <View style={styles.group}>
              <Label>{t('songsPage.sortLabel')}</Label>
              <SegmentedControl options={sortOptions} value={sort} onChange={setSort} />
            </View>
            <View style={styles.group}>
              <Label>{t('songsPage.filters.library')}</Label>
              <SegmentedControl options={scopeOptions} value={scope} onChange={setScope} />
            </View>

            <Button
              title={filterToggleLabel}
              variant="secondary"
              icon={showFilters ? 'chevronUp' : 'chevronDown'}
              onPress={() => setShowFilters((open) => !open)}
            />
            {showFilters ? (
              <Card>
                <View style={styles.filters}>
                  <View style={styles.group}>
                    <Label>{t('songsPage.filters.key')}</Label>
                    <KeyPicker
                      value={form.key?.trim() ? form.key : null}
                      onChange={(key) => setField('key', key ?? '')}
                      label={t('songsPage.filters.key')}
                      placeholder={t('mobileLibrary.filters.anyKey')}
                      resetLabel={t('mobileLibrary.filters.anyKey')}
                    />
                  </View>
                  {TEXT_FILTERS.map((field) => (
                    <Field
                      key={field.name}
                      label={t(field.label)}
                      value={form[field.name] ?? ''}
                      onChangeText={(value) => setField(field.name, value)}
                      keyboardType={field.numeric ? 'number-pad' : 'default'}
                      placeholder={field.date ? t('mobileLibrary.filters.datePlaceholder') : undefined}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  ))}
                  <Text style={styles.muted}>{t('mobileLibrary.filters.utcNote')}</Text>
                  <ErrorNotice error={filterError} />
                  <View style={styles.actions}>
                    <Button title={t('songsPage.applyFilters')} onPress={applyFilters} />
                    <Button title={t('common:actions.clear')} variant="quiet" onPress={clearFilters} />
                  </View>
                </View>
              </Card>
            ) : null}

            {firstPageFailed ? (
              <View style={styles.retry}>
                <ErrorNotice error={library.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void library.refetch()} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          library.isLoading ? (
            <Loading />
          ) : firstPageFailed ? null : (
            <EmptyState
              title={narrowed ? t('mobileLibrary.emptyFiltered') : t('mobileSongs.emptyLibrary')}
              description={
                narrowed
                  ? t('mobileLibrary.emptyFilteredDescription')
                  : canManage
                    ? t('songsPage.emptyDescription')
                    : t('mobileLibrary.emptyMemberDescription')
              }
            />
          )
        }
        ListFooterComponent={
          library.isFetchingNextPage ? (
            <Loading label={t('mobileLibrary.loadingMore')} />
          ) : library.isFetchNextPageError ? (
            <View style={styles.retry}>
              <Text style={styles.muted}>{t('mobileLibrary.loadMoreFailed')}</Text>
              <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void library.fetchNextPage()} />
            </View>
          ) : library.hasNextPage ? (
            <Button
              title={t('mobileLibrary.loadMore')}
              variant="secondary"
              onPress={() => void library.fetchNextPage()}
              style={styles.footer}
            />
          ) : rows.length && total !== null ? (
            <Text style={[styles.muted, styles.footer]}>{t('mobileLibrary.allShown', { count: total })}</Text>
          ) : null
        }
        renderItem={({ item, index }) => (
          <Reveal index={Math.min(index, 8)}>
            <SongRow song={item} first={index === 0} onPress={() => router.push({ pathname: '/song/[id]', params: { id: item.id } })} />
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface SongRowProps {
  song: SongListItem;
  first: boolean;
  onPress: () => void;
}

/** One library row: title, archive state, author and tempo, the keys it is played in, last use. */
const SongRow = ({ song, first, onPress }: SongRowProps) => {
  const { t } = useTranslation('songs');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const format = useFormatters();
  const bpm = songLibraryBpm(song);
  const keys = songLibraryKeys(song);
  const detail = [song.author, bpm ? t('arrangement.bpmValue', { bpm }) : null].filter(Boolean).join(' · ');

  return (
    <ListRow onPress={onPress} showChevron divided={!first}>
      <View style={styles.songRow}>
        <View style={styles.flex}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.songDetail}>{detail || t('mobileSongs.authorUnknown')}</Text>
          {song.last_scheduled_at ? (
            <Text style={styles.songDetail}>{t('mobileLibrary.lastScheduled', { date: format.date(song.last_scheduled_at, 'medium') })}</Text>
          ) : null}
          {song.archived_at ? (
            <View style={styles.badges}>
              <Tag label={t('songsPage.archivedBadge')} accent={theme.accent.neutral} />
            </View>
          ) : null}
        </View>
        {keys ? <KeyCap>{keys}</KeyCap> : null}
      </View>
    </ListRow>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    head: { gap: theme.space.lg, marginBottom: theme.space.sm },
    group: { gap: theme.space.sm },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    filters: { gap: theme.space.md },
    retry: { gap: theme.space.md, paddingVertical: theme.space.md },
    footer: { marginTop: theme.space.lg },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.surface,
      paddingHorizontal: theme.space.md,
    },
    searchInput: { ...theme.type.body, flex: 1, color: theme.color.ink, paddingVertical: theme.space.md },
    songRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    songTitle: { ...theme.type.heading, color: theme.color.ink },
    songDetail: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
    badges: { flexDirection: 'row', marginTop: theme.space.xs },
  });
