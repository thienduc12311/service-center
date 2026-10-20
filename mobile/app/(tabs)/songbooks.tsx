import { useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { LocalizedError, STORAGE_BUCKETS, type SongWithArrangements } from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorNotice,
  Field,
  IconWell,
  Label,
  ListRow,
  Loading,
  Screen,
  ScreenHeader,
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import { NotificationBell } from '../../src/components/NotificationBell';
import { Icon } from '../../src/components/icons';
import { PressableScale, Reveal } from '../../src/components/motion';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

type SongbookSource = 'manual' | 'document';


const DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

export default function SongbooksScreen() {
  const { t } = useTranslation(['songs', 'common']);
  const { canManage, queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState(false);

  const books = useQuery({
    queryKey: queryKeys.songbooks(queryScope),
    queryFn: () => api.listSongbooks(),
    enabled: Boolean(queryScope),
  });

  if (composing) {
    return (
      <ComposeSongbook
        onCancel={() => setComposing(false)}
        onCreated={async (bookId) => {
          if (!isCurrentGeneration(generation)) return;
          await queryClient.invalidateQueries({ queryKey: queryKeys.songbooks(queryScope) });
          if (!isCurrentGeneration(generation)) return;
          setComposing(false);
          router.push(`/songbooks/${bookId}`);
        }}
      />
    );
  }

  return (
    <Screen safeTop>
      <NotificationBell />
      <FlatList
        data={books.data ?? []}
        keyExtractor={(book) => book.id}
        contentContainerStyle={screenPadding(theme)}
        ListHeaderComponent={
          <View>
            <ScreenHeader
              title={t('common:nav.songbooks')}
              description={t('mobileSongbooks.description')}
              action={
                canManage ? (
                  <Button title={t('mobileSongbooks.new')} icon="plus" onPress={() => setComposing(true)} />
                ) : undefined
              }
            />
            <ErrorNotice error={books.error} />
          </View>
        }
        ListEmptyComponent={
          books.isLoading ? (
            <Loading />
          ) : (
            <EmptyState
              title={t('songbooksPage.empty')}
              description={t('mobileSongbooks.emptyDescription')}
            />
          )
        }
        renderItem={({ item, index }) => (
          <Reveal index={index}>
            <Card compact>
              <ListRow onPress={() => router.push(`/songbooks/${item.id}`)} showChevron>
                <SongbookSummary title={item.title} sourceType={item.source_type} />
              </ListRow>
            </Card>
          </Reveal>
        )}
      />
    </Screen>
  );
}

interface SongbookSummaryProps {
  title: string;
  sourceType: SongbookSource;
}

const SongbookSummary = ({ title, sourceType }: SongbookSummaryProps) => {
  const { t } = useTranslation('songs');
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.bookRow}>
      <IconWell
        name={sourceType === 'document' ? 'document' : 'music'}
        accent={sourceType === 'document' ? theme.accent.blue : theme.accent.green}
      />
      <View style={styles.flex}>
        <Text style={styles.bookTitle}>{title}</Text>
        <Text style={styles.bookMeta}>
          {sourceType === 'document' ? t('mobileSongbooks.attachedDocument') : t('mobileSongbooks.collectedCharts')}
        </Text>
      </View>
    </View>
  );
};

interface ComposeSongbookProps {
  onCancel: () => void;
  onCreated: (bookId: string) => Promise<void>;
}

const ComposeSongbook = ({ onCancel, onCreated }: ComposeSongbookProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const sources: readonly SegmentOption<SongbookSource>[] = [
    { value: 'manual', label: t('mobileSongbooks.pickSongs') },
    { value: 'document', label: t('mobileSongbooks.attachFile') },
  ];
  const { organizationId, queryScope, generation, isCurrentGeneration } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState<SongbookSource>('manual');
  const [selected, setSelected] = useState<string[]>([]);
  const [document, setDocument] = useState<DocumentPicker.DocumentPickerAsset | null>(null);

  const songs = useQuery({
    queryKey: queryKeys.songbookSongs(queryScope),
    queryFn: () => api.listSongs({ per_page: 200 }),
    enabled: Boolean(queryScope),
  });

  const defaultArrangementId = (song: SongWithArrangements): string | null =>
    song.arrangements.find((arrangement) => arrangement.is_default)?.id ?? null;

  const create = useMutation({
    mutationFn: async () => {
      let storagePath: string | null = null;

      if (source === 'document') {
        if (!document || !organizationId) throw new LocalizedError({ key: 'songs:errors.chooseDocumentFirst' });
        if (!isCurrentGeneration(generation)) throw new LocalizedError({ key: 'songs:errors.accountChanged' });
        const safeName = document.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        storagePath = `${organizationId}/${Date.now()}-${safeName}`;
        const bytes = new Uint8Array(await (await fetch(document.uri)).arrayBuffer());
        const { error } = await supabase.storage
          .from(STORAGE_BUCKETS.songbooks)
          .upload(storagePath, bytes, { contentType: document.mimeType ?? 'application/pdf' });
        if (error) throw error;
        if (!isCurrentGeneration(generation)) throw new LocalizedError({ key: 'songs:errors.accountChanged' });
      }

      if (!isCurrentGeneration(generation)) throw new LocalizedError({ key: 'songs:errors.accountChanged' });
      return api.createSongbook({
        title,
        source_type: source,
        source_storage_path: storagePath,
        source_filename: source === 'document' ? (document?.name ?? null) : null,
        songs: selected.map((songId) => {
          const song = songs.data?.data.find((candidate) => candidate.id === songId);
          return {
            song_id: songId,
            arrangement_id: song ? defaultArrangementId(song) : null,
          };
        }),
      });
    },
    onSuccess: (book) => {
      if (!isCurrentGeneration(generation)) return;
      return onCreated(book.id);
    },
  });

  const chooseDocument = async (): Promise<void> => {
    const result = await DocumentPicker.getDocumentAsync({
      type: DOCUMENT_TYPES,
      copyToCacheDirectory: true,
    });
    if (!result.canceled) setDocument(result.assets[0] ?? null);
  };

  const incomplete = !title.trim() || (source === 'manual' ? selected.length === 0 : !document);

  return (
    <Screen safeTop>
      <ScrollView
        contentContainerStyle={screenPadding(theme)}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <ScreenHeader
          title={t('mobileSongbooks.composeTitle')}
          description={t('mobileSongbooks.composeDescription')}
        />

        <Reveal>
          <Card>
            <Field
              label={t('mobileSongbooks.name')}
              value={title}
              onChangeText={setTitle}
              placeholder={t('mobileSongbooks.namePlaceholder')}
            />
            <SegmentedControl options={sources} value={source} onChange={setSource} />

            {source === 'manual' ? (
              <View>
                <Label>{t('mobileSongbooks.songsChosen', { count: selected.length })}</Label>
                {songs.isLoading ? <Loading /> : null}
                {(songs.data?.data ?? []).map((song, index) => {
                  const active = selected.includes(song.id);
                  return (
                    <View key={song.id}>
                      {index > 0 ? <Divider /> : null}
                      <PressableScale
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: active }}
                        onPress={() =>
                          setSelected((current) =>
                            active
                              ? current.filter((id) => id !== song.id)
                              : [...current, song.id],
                          )
                        }
                        pressedOpacity={0.6}
                        style={styles.pickRow}
                      >
                        <View style={[styles.checkbox, active && styles.checkboxActive]}>
                          {active ? (
                            <Icon name="check" size={12} color={theme.color.onBrand} strokeWidth={2.4} />
                          ) : null}
                        </View>
                        <Text style={styles.pickTitle}>{song.title}</Text>
                        <Text style={styles.pickKey}>{song.default_key ?? ''}</Text>
                      </PressableScale>
                    </View>
                  );
                })}
              </View>
            ) : (
              <PressableScale
                onPress={() => void chooseDocument()}
                pressedOpacity={0.6}
                style={styles.dropZone}
              >
                <Icon name="upload" size={26} color={theme.color.inkMuted} />
                <Text style={styles.dropTitle}>{document?.name ?? t('songbooksPage.chooseDocument')}</Text>
                <Text style={styles.dropHint}>{t('mobileSongbooks.documentHint')}</Text>
              </PressableScale>
            )}

            <ErrorNotice error={create.error} />
            <View style={styles.formActions}>
              <Button title={t('common:actions.cancel')} variant="secondary" onPress={onCancel} style={styles.flex} />
              <Button
                title={t('common:actions.create')}
                onPress={() => create.mutate()}
                loading={create.isPending}
                disabled={incomplete}
                style={styles.flex}
              />
            </View>
          </Card>
        </Reveal>
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },

    bookRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    bookTitle: { ...theme.type.heading, color: theme.color.ink },
    bookMeta: { ...theme.type.bodySmall, color: theme.color.inkMuted, marginTop: 2 },

    pickRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingVertical: theme.space.md,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: theme.radius.xs,
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxActive: { backgroundColor: theme.color.brand, borderColor: theme.color.brand },
    pickTitle: { ...theme.type.body, flex: 1, color: theme.color.ink },
    pickKey: { ...theme.type.numeric, color: theme.color.inkFaint },

    dropZone: {
      alignItems: 'center',
      gap: theme.space.sm,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
      paddingVertical: theme.space.section,
      paddingHorizontal: theme.space.xl,
    },
    dropTitle: { ...theme.type.heading, color: theme.color.ink, textAlign: 'center' },
    dropHint: { ...theme.type.bodySmall, color: theme.color.inkMuted },

    formActions: { flexDirection: 'row', gap: theme.space.md },
  });
