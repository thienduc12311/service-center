import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading } from '../../src/components/ui';
import { theme } from '../../src/lib/theme';

export default function SongsScreen() {
  const { organizationId, isAdmin } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const songs = useQuery({
    queryKey: ['songs', organizationId, query],
    queryFn: () => api.listSongs({ q: query || undefined, per_page: 100 }),
    enabled: Boolean(organizationId),
  });

  return (
    <View style={styles.flex}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search songs…"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          placeholderTextColor={theme.colors.textFaint}
        />
        {isAdmin && (
          <Button title="Import" variant="secondary" onPress={() => router.push('/scan')} />
        )}
      </View>

      <ErrorNotice error={songs.error} />

      {songs.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={songs.data?.data ?? []}
          keyExtractor={(song) => song.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState title="No songs found" />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/song/${item.id}`)}>
              <View style={styles.flex}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.subtitle}>
                  {item.author ?? 'Unknown author'}
                  {item.default_bpm ? ` · ${item.default_bpm} bpm` : ''}
                </Text>
              </View>
              {item.default_key && <Text style={styles.key}>{item.default_key}</Text>}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: theme.colors.text,
  },
  list: { padding: 16, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    marginBottom: 8,
  },
  title: { fontSize: 15, fontWeight: '600', color: theme.colors.text },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  key: { fontSize: 15, fontWeight: '700', color: theme.colors.brand },
});
