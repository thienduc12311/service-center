import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  SONG_TYPES,
  isSongInformationDirty,
  rebaseDraft,
  songInformationFormFrom,
  toUpdateSongInput,
  updateSongSchema,
  type SongInformationFormValues,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import {
  authoringDrafts,
  canAuthorSong,
  draftTargets,
  invalidateLibrary,
  libraryWriteOutcome,
} from '../../../src/lib/song-library';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
import { KeyPicker } from '../../../src/components/KeyPicker';
import {
  ChoiceChips,
  RestoredDraftNotice,
  TagListField,
  WriteProblem,
  useVocabularyLabel,
} from '../../../src/components/song/AuthoringParts';
import { Button, EmptyState, ErrorNotice, Field, Label, Loading, Screen, screenPadding } from '../../../src/components/ui';
import type { Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/**
 * MOB-028: the website's Song Information, Tags and Notes panels in one
 * native form, saved by `updateSong` with the revision it was opened at
 * (shared `toUpdateSongInput`). A competing save is refused as stale; the
 * draft is kept so it can be saved against the latest version.
 */
export default function EditSongScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, organizationId, canAnywhere } = useAuth();

  const song = useQuery({
    queryKey: queryKeys.song(queryScope, id),
    queryFn: () => api.getSong(id!),
    enabled: Boolean(id && queryScope),
  });

  if (song.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (song.error || !song.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('songInfo.title') }} />
        <ErrorNotice error={song.error ?? new LocalizedError({ key: 'songs:songDetail.notFound' })} />
      </Screen>
    );
  }
  if (!canAuthorSong(canAnywhere('songs.manage'), song.data)) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('songInfo.title') }} />
        <EmptyState title={t('mobileAuthoring.noAccess')} />
      </Screen>
    );
  }
  // One form per song and identity: a draft never follows an organization switch.
  return <EditSongForm key={`${organizationId}:${song.data.id}`} song={song.data} />;
}

interface EditSongFormProps {
  song: SongWithArrangements;
}

const EditSongForm = ({ song }: EditSongFormProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const vocabularyLabel = useVocabularyLabel();
  const target = draftTargets.song(song.id);

  const [restored] = useState(() => authoringDrafts.get<SongInformationFormValues>(queryScope, target));
  const [form, setForm] = useState<SongInformationFormValues>(() => restored?.draft ?? songInformationFormFrom(song));
  const [baseRevision, setBaseRevision] = useState<number>(() => restored?.baseRevision ?? song.revision);
  // The saved values the draft started from, so a reload rebases it field by field.
  const [baseForm, setBaseForm] = useState<SongInformationFormValues>(() => restored?.base ?? songInformationFormFrom(song));
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const set = <K extends keyof SongInformationFormValues>(field: K, value: SongInformationFormValues[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const dirty = isSongInformationDirty(form, song);
  useEffect(() => {
    if (dirty) authoringDrafts.set(queryScope, target, { draft: form, baseRevision, base: baseForm });
    else authoringDrafts.clear(queryScope, target);
  }, [baseForm, baseRevision, dirty, form, queryScope, target]);

  const guard = useDiscardGuard({
    dirty,
    message: t('mobileAuthoring.discardConfirm'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  const save = useMutation({
    mutationFn: () => api.updateSong(song.id, updateSongSchema.parse({ ...toUpdateSongInput(form), expected_revision: baseRevision })),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      authoringDrafts.clear(queryScope, target);
      await invalidateLibrary(queryClient, queryScope);
      guard.leave();
    },
    onError: (error) => {
      if (isCurrentGeneration(generation) && libraryWriteOutcome(error) === 'gone') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
      }
    },
  });
  const outcome = save.error ? libraryWriteOutcome(save.error) : null;
  // The song moved on since this draft started (another device, or the website).
  const changedSinceDraft = song.revision !== baseRevision && outcome !== 'stale';

  // Keep what was changed here; everything else takes the latest saved values.
  const loadLatest = async () => {
    setLoadingLatest(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
    if (!isCurrentGeneration(generation)) return;
    const latest = queryClient.getQueryData<SongWithArrangements>(queryKeys.song(queryScope, song.id)) ?? song;
    const latestForm = songInformationFormFrom(latest);
    setForm((current) => rebaseDraft(current, baseForm, latestForm));
    setBaseForm(latestForm);
    setBaseRevision(latest.revision);
    setLoadingLatest(false);
    save.reset();
  };

  const submit = () => {
    if (!form.title.trim()) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.titleRequired' }));
      return;
    }
    if (!updateSongSchema.safeParse(toUpdateSongInput(form)).success) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.invalid' }));
      return;
    }
    setProblem(null);
    if (dirty) save.mutate();
  };

  const discardRestored = () => {
    authoringDrafts.clear(queryScope, target);
    setForm(songInformationFormFrom(song));
    setBaseForm(songInformationFormFrom(song));
    setBaseRevision(song.revision);
    setShowRestored(false);
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('songInfo.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {showRestored ? <RestoredDraftNotice onDiscard={discardRestored} /> : null}
        {song.archived_at ? <Text style={styles.muted}>{t('songDetail.archivedSong')}</Text> : null}
        {changedSinceDraft ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileAuthoring.changedSinceDraft')}</Text>
        ) : null}

        <Field label={t('songInfo.fields.title')} value={form.title} onChangeText={(value) => set('title', value)} maxLength={200} />
        <Field
          label={t('songInfo.fields.ccli')}
          value={form.ccliNumber}
          onChangeText={(value) => set('ccliNumber', value)}
          keyboardType="number-pad"
          maxLength={40}
        />
        <Field label={t('songInfo.fields.authors')} value={form.authors} onChangeText={(value) => set('authors', value)} maxLength={200} />
        <View style={styles.group}>
          <Label>{t('songInfo.fields.defaultKey')}</Label>
          <KeyPicker
            value={form.defaultKey}
            onChange={(key) => set('defaultKey', key)}
            label={t('songInfo.fields.defaultKey')}
            placeholder={t('songInfo.noDefaultKey')}
            resetLabel={t('songInfo.noDefaultKey')}
          />
        </View>
        <Field label={t('songInfo.fields.copyright')} value={form.copyright} onChangeText={(value) => set('copyright', value)} maxLength={300} />
        <Field
          label={t('songInfo.fields.administration')}
          value={form.administration}
          onChangeText={(value) => set('administration', value)}
          maxLength={300}
        />
        <ChoiceChips
          label={t('addSong.fields.type')}
          multiple
          options={SONG_TYPES.map((value) => ({ value, label: vocabularyLabel(value) }))}
          values={form.songTypes}
          onChangeValues={(songTypes) => set('songTypes', songTypes)}
        />
        <TagListField label={t('songInfo.fields.themes')} values={form.themes} onChange={(themes) => set('themes', themes)} />
        <Field
          label={t('songInfo.fields.notes')}
          value={form.notes}
          onChangeText={(value) => set('notes', value)}
          multiline
          maxLength={4000}
          style={styles.notes}
        />

        <ErrorNotice error={problem} />
        <WriteProblem error={save.error} outcome={outcome} onLoadLatest={() => void loadLatest()} loadingLatest={loadingLatest} />
        <Button
          title={t('common:actions.saveChanges')}
          loading={save.isPending}
          disabled={!dirty || outcome === 'stale' || outcome === 'gone'}
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
    notes: { minHeight: 120, textAlignVertical: 'top' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
