import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { SongWithArrangements } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
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
import { Icon } from '../../src/components/icons';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

export default function SongsScreen() {
  const { organizationId, isAdmin } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [query, setQuery] = useState('');

  const songs = useQuery({
    queryKey: ['songs', organizationId, query],
    queryFn: () => api.listSongs({ q: query || undefined, per_page: 100 }),
    enabled: Boolean(organizationId),
  });

  const results = songs.data?.data ?? [];

  return (
    <Screen safeTop>
      <FlatList
        data={results.length ? [results] : []}
        keyExtractor={() => 'catalogue'}
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.head}>
            <ScreenHeader
              eyebrow={results.length ? `${results.length} in the library` : undefined}
              title="Song library"
              description="Search the catalogue, then open a chart to transpose it on stage."
              action={
                isAdmin ? (
                  <Button
                    title="Import a chart"
                    icon="camera"
                    variant="secondary"
                    onPress={() => router.push('/scan')}
                  />
                ) : undefined
              }
            />

            <View style={styles.search}>
              <Icon name="search" size={18} color={theme.color.inkFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder="Title or author"
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
              title={query ? 'No match' : 'An empty library'}
              description={
                query
                  ? `Nothing in the catalogue matches "${query}".`
                  : 'Add songs from the web app, or photograph a chart to import one.'
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
  const styles = useThemedStyles(makeStyles);
  const detail = [song.author, song.default_bpm ? `${song.default_bpm} bpm` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow onPress={onPress} showChevron>
      <View style={styles.songRow}>
        <View style={styles.flex}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.songDetail}>{detail || 'Author unknown'}</Text>
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
