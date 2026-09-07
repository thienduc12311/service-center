import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { parseChordPro } from '@service-center/shared';
import { api } from '../../src/lib/api';
import {
  Button,
  Card,
  ErrorNotice,
  IconWell,
  KeyCap,
  Loading,
  Screen,
  screenPadding,
} from '../../src/components/ui';
import { ChordChart } from '../../src/components/ChordChart';
import { Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

export default function SongbookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const book = useQuery({
    queryKey: ['songbook', id],
    queryFn: () => api.getSongbook(id!),
    enabled: Boolean(id),
  });

  if (book.isLoading) {
    return (
      <Screen>
        <Loading label="Opening the song book" />
      </Screen>
    );
  }
  if (book.error || !book.data) {
    return (
      <Screen>
        <View style={styles.errorWrap}>
          <ErrorNotice error={book.error ?? new Error('That song book could not be found.')} />
        </View>
      </Screen>
    );
  }

  const detail = book.data;
  const documentUrl = detail.document_url;

  return (
    <Screen>
      <Stack.Screen options={{ title: detail.title }} />
      <ScrollView contentContainerStyle={screenPadding(theme)}>
        <Reveal>
          <View style={styles.hero}>
            <Text style={styles.title}>{detail.title}</Text>
            {detail.description ? (
              <Text style={styles.description}>{detail.description}</Text>
            ) : null}
          </View>
        </Reveal>

        {detail.source_type === 'document' ? (
          <Reveal index={1}>
            <Card>
              <View style={styles.documentRow}>
                <IconWell name="document" accent={theme.accent.blue} size={44} />
                <View style={styles.flex}>
                  <Text style={styles.documentName}>{detail.source_filename}</Text>
                  <Text style={styles.documentMeta}>Attached document</Text>
                </View>
              </View>
              <Button
                title="Open document"
                icon="document"
                onPress={() => {
                  if (documentUrl) void Linking.openURL(documentUrl);
                }}
                disabled={!documentUrl}
              />
            </Card>
          </Reveal>
        ) : (
          detail.items.map((item, index) => {
            const chart = item.arrangement?.chord_chart
              ? parseChordPro(item.arrangement.chord_chart)
              : null;

            return (
              <Reveal key={item.id} index={index}>
                <Card>
                  <View style={styles.songHead}>
                    <View style={styles.flex}>
                      <Text style={styles.songTitle}>{item.song.title}</Text>
                      <Text style={styles.songAuthor}>{item.song.author ?? 'Author unknown'}</Text>
                    </View>
                    {item.arrangement?.song_key ? (
                      <KeyCap>{item.arrangement.song_key}</KeyCap>
                    ) : null}
                  </View>
                  {chart ? (
                    <ChordChart chart={chart} />
                  ) : (
                    <Text style={styles.songAuthor}>No chart has been added for this song.</Text>
                  )}
                </Card>
              </Reveal>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    errorWrap: { padding: theme.space.xl },
    hero: { gap: theme.space.sm },
    title: { ...theme.type.display, color: theme.color.ink },
    description: { ...theme.type.body, color: theme.color.inkMuted },

    documentRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    documentName: { ...theme.type.heading, color: theme.color.ink },
    documentMeta: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },

    songHead: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.md },
    songTitle: { ...theme.type.title, fontSize: 22, lineHeight: 26, color: theme.color.ink },
    songAuthor: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },
  });
