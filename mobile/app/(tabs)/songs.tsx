import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { SongWithArrangements } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  KeyCap,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  screenPadding,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Icon } from '../../src/components/icons';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

export default function SongsScreen() {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');

  const songs = useQuery({
    queryKey: queryKeys.songs(queryScope, query),
    queryFn: () => api.listSongs({ q: query || undefined, per_page: 100 }),
    enabled: Boolean(queryScope),
  });

  const results = songs.data?.data ?? [];

  return (
    <Screen safeTop>
      <NotificationBell />
      <FlatList
        data={results.length ? [results] : []}
        keyExtractor={() => 'catalogue'}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.head}>
            <ScreenHeader
              eyebrow={results.length ? t('mobileSongs.inLibrary', { count: results.length }) : undefined}
              title={t('common:nav.songs')}
              description={t('mobileSongs.description')}
            />

            <View style={styles.search}>
              <Icon name="search" size={18} color={theme.color.inkFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('mobileSongs.searchPlaceholder')}
                placeholderTextColor={theme.color.inkFaint}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
            </View>

            <ErrorNotice error={songs.error} />
          </View>
        }
        ListEmptyComponent={
          songs.isLoading ? (
            <Loading />
          ) : (
            <EmptyState
              title={query ? t('mobileSongs.noMatch') : t('mobileSongs.emptyLibrary')}
              description={
                query
                  ? t('mobileSongs.noMatchDescription', { query })
                  : t('mobileSongs.emptyLibraryDescription')
              }
            />
          )
        }
        renderItem={({ item }) => (
          <Reveal>
            <Card compact>
              {item.map((song, index) => (
                <View key={song.id}>
                  {index > 0 ? <Divider /> : null}
                  <SongRow song={song} onPress={() => router.push(`/song/${song.id}`)} />
                </View>
              ))}
            </Card>
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface SongRowProps {
  song: SongWithArrangements;
  onPress: () => void;
}

const SongRow = ({ song, onPress }: SongRowProps) => {
  const { t } = useTranslation('songs');
  const styles = useThemedStyles(makeStyles);
  const detail = [song.author, song.default_bpm ? t('arrangement.bpmValue', { bpm: song.default_bpm }) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow onPress={onPress} showChevron>
      <View style={styles.songRow}>
        <View style={styles.flex}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.songDetail}>{detail || t('mobileSongs.authorUnknown')}</Text>
        </View>
        {song.default_key ? <KeyCap>{song.default_key}</KeyCap> : null}
      </View>
    </ListRow>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    head: { gap: theme.space.xl, marginBottom: theme.space.sm },
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
  });
