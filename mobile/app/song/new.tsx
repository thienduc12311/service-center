import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CAPO_POSITIONS,
  DEFAULT_ARRANGEMENT_NAME_KEY,
  EMPTY_ADD_SONG_FORM,
  LocalizedError,
  SONG_SPEEDS,
  SONG_STYLES,
  SONG_TYPES,
  createSongSchema,
  isAddSongFormDirty,
  toCreateSongInput,
  type AddSongFormValues,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { authoringDrafts, draftTargets, invalidateLibrary, libraryWriteOutcome } from '../../src/lib/song-library';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useAuth } from '../../src/providers/AuthProvider';
import { KeyPicker } from '../../src/components/KeyPicker';
import { ChoiceChips, RestoredDraftNotice, TagListField, useVocabularyLabel } from '../../src/components/song/AuthoringParts';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  ListRow,
  Screen,
  screenPadding,
} from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/**
 * MOB-028: the website's Add Song dialog — the song, its first (default)
 * arrangement and an optional pasted chart in one `createSong` request built
 * by the shared `toCreateSongInput`. Create has no idempotency key, so after
 * no answer the screen searches the library for the title before offering
 * to add it again.
 */
export default function NewSongScreen() {
  const { t } = useTranslation(['songs', 'common']);
  const { canAnywhere } = useAuth();
  if (!canAnywhere('songs.manage')) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('addSong.title') }} />
        <EmptyState title={t('mobileAuthoring.noAccess')} />
      </Screen>
    );
  }
  return <NewSongForm />;
}

const NewSongForm = () => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const vocabularyLabel = useVocabularyLabel();
  const target = draftTargets.newSong();

  const [restored] = useState(() => authoringDrafts.get<AddSongFormValues>(queryScope, target));
  const [form, setForm] = useState<AddSongFormValues>(() => restored?.draft ?? EMPTY_ADD_SONG_FORM);
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const set = <K extends keyof AddSongFormValues>(field: K, value: AddSongFormValues[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const dirty = isAddSongFormDirty(form);
  useEffect(() => {
    if (dirty) authoringDrafts.set(queryScope, target, { draft: form, baseRevision: null });
    else authoringDrafts.clear(queryScope, target);
  }, [dirty, form, queryScope, target]);

  const guard = useDiscardGuard({
    dirty,
    message: t('mobileAuthoring.discardConfirm'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  const create = useMutation({
    mutationFn: () => api.createSong(createSongSchema.parse(toCreateSongInput(form, t(DEFAULT_ARRANGEMENT_NAME_KEY)))),
    onSuccess: async (song) => {
      if (!isCurrentGeneration(generation)) return;
      authoringDrafts.clear(queryScope, target);
      await invalidateLibrary(queryClient, queryScope);
      guard.leave();
      router.push({ pathname: '/song/[id]', params: { id: song.id } });
    },
  });
  const uncertain = create.error ? libraryWriteOutcome(create.error) === 'uncertain' : false;
  const title = form.title.trim();

  // After no answer the song may exist: look for it before adding it twice.
  const matches = useQuery({
    queryKey: queryKeys.songs(queryScope, `exists:${title}`),
    queryFn: () => api.listSongs({ q: title, archive: 'all', per_page: 20 }),
    enabled: Boolean(queryScope && uncertain && title),
  });
  const sameTitle = (matches.data?.data ?? []).filter((song) => song.title.trim().toLowerCase() === title.toLowerCase());

  const submit = () => {
    if (!title) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.titleRequired' }));
      return;
    }
    const parsed = createSongSchema.safeParse(toCreateSongInput(form, t(DEFAULT_ARRANGEMENT_NAME_KEY)));
    if (!parsed.success) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.invalid' }));
      return;
    }
    setProblem(null);
    create.mutate();
  };

  const discardRestored = () => {
    authoringDrafts.clear(queryScope, target);
    setForm(EMPTY_ADD_SONG_FORM);
    setShowRestored(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('addSong.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {showRestored ? <RestoredDraftNotice onDiscard={discardRestored} /> : null}

        <Field label={t('addSong.fields.title')} value={form.title} onChangeText={(value) => set('title', value)} maxLength={200} />
        <Field
          label={t('arrangement.fields.name')}
          value={form.arrangementName}
          onChangeText={(value) => set('arrangementName', value)}
          placeholder={t(DEFAULT_ARRANGEMENT_NAME_KEY)}
          maxLength={120}
        />

        <View style={styles.group}>
          <Label>{t('arrangement.fields.key')}</Label>
          <KeyPicker
            value={form.key}
            onChange={(key) => set('key', key)}
            label={t('arrangement.fields.key')}
            placeholder={t('arrangement.noKey')}
            resetLabel={t('arrangement.noKey')}
          />
        </View>

        <ChoiceChips
          label={t('arrangement.fields.capo')}
          options={CAPO_POSITIONS.map((fret) => ({ value: String(fret), label: String(fret) }))}
          noneLabel={t('common:states.none')}
          value={form.capo === null ? null : String(form.capo)}
          onChange={(value) => set('capo', value === null ? null : Number(value))}
        />

        <ChoiceChips
          label={t('addSong.fields.type')}
          multiple
          options={SONG_TYPES.map((value) => ({ value, label: vocabularyLabel(value) }))}
          values={form.types}
          onChangeValues={(types) => set('types', types)}
        />
        <ChoiceChips
          label={t('addSong.fields.style')}
          options={SONG_STYLES.map((value) => ({ value, label: vocabularyLabel(value) }))}
          noneLabel={t('common:states.none')}
          value={form.style || null}
          onChange={(value) => set('style', value ?? '')}
        />
        <ChoiceChips
          label={t('addSong.fields.speed')}
          options={SONG_SPEEDS.map((value) => ({ value, label: vocabularyLabel(value) }))}
          noneLabel={t('common:states.none')}
          value={form.speed || null}
          onChange={(value) => set('speed', value ?? '')}
        />
        <TagListField label={t('addSong.fields.tags')} values={form.themes} onChange={(themes) => set('themes', themes)} />

        <Field
          label={t('addSong.fields.chart')}
          value={form.chordChart}
          onChangeText={(value) => set('chordChart', value)}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.chart}
        />
        <Text style={styles.muted}>{t('mobileAuthoring.chartHelp')}</Text>

        <ErrorNotice error={problem ?? (uncertain ? null : create.error)} />
        {uncertain ? (
          <Card>
            <Text accessibilityRole="alert" style={styles.body}>{t('mobileAuthoring.createUncertain')}</Text>
            {sameTitle.map((song, index) => (
              <ListRow
                key={song.id}
                divided={index > 0}
                showChevron
                onPress={() => {
                  authoringDrafts.clear(queryScope, target);
                  guard.leave();
                  router.push({ pathname: '/song/[id]', params: { id: song.id } });
                }}
              >
                <Text style={styles.body}>{t('mobileAuthoring.openExisting', { title: song.title })}</Text>
              </ListRow>
            ))}
            {matches.isSuccess && sameTitle.length === 0 ? <Text style={styles.muted}>{t('mobileAuthoring.noneFound')}</Text> : null}
            <ErrorNotice error={matches.error} />
          </Card>
        ) : null}

        <Button
          title={uncertain ? t('mobileAuthoring.addAnyway') : t('songsPage.addSong')}
          loading={create.isPending}
          disabled={uncertain && matches.isFetching}
          onPress={submit}
        />
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    chart: { ...theme.type.code, minHeight: 160, textAlignVertical: 'top' },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
