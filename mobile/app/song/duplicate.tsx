import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  duplicateArrangementSchema,
  uuid,
  type ArrangementRow,
  type DuplicateArrangementInput,
  type DuplicateArrangementPreview,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { queryKeys } from '../../src/lib/query-keys';
import {
  arrangementSelections,
  canAuthorSong,
  draftTargets,
  invalidateLibrary,
  libraryWriteOutcome,
} from '../../src/lib/song-library';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Screen,
  screenPadding,
} from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** Route params as they arrive: untrusted, and possibly repeated. */
interface DuplicateRouteParams {
  songId?: string | string[];
  arrangementId?: string | string[];
}

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

const toggled = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];

/**
 * MOB-028: the website's reviewed arrangement duplication —
 * `previewArrangementDuplicate` (writes nothing, returns a fingerprint), then
 * `duplicateArrangement` with that fingerprint and one request key kept for
 * every retry, so a lost answer replays rather than copying twice. A changed
 * source is refused (409 `library_changed`) and needs a fresh review. New
 * ids; the source and the song's default stay as they are; selected files
 * are references, never copies.
 */
export default function DuplicateArrangementScreen() {
  const params: DuplicateRouteParams = useLocalSearchParams();
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, organizationId, canAnywhere } = useAuth();
  const songId = uuid.safeParse(single(params.songId));
  const arrangementId = uuid.safeParse(single(params.arrangementId));

  const song = useQuery({
    queryKey: queryKeys.song(queryScope, songId.success ? songId.data : null),
    queryFn: () => api.getSong(songId.success ? songId.data : ''),
    enabled: Boolean(songId.success && queryScope),
  });

  if (!songId.success || !arrangementId.success) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('curation.duplicateSummary') }} />
        <EmptyState title={t('mobileChart.unavailable.invalidLink.title')} />
      </Screen>
    );
  }
  if (song.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  const arrangement = song.data?.arrangements.find((candidate) => candidate.id === arrangementId.data) ?? null;
  if (song.error || !song.data || !arrangement) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('curation.duplicateSummary') }} />
        <ErrorNotice error={song.error ?? new LocalizedError({ key: 'songs:mobileAuthoring.arrangementGone' })} />
      </Screen>
    );
  }
  if (!canAuthorSong(canAnywhere('songs.manage'), song.data) || song.data.archived_at || arrangement.archived_at) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('curation.duplicateSummary') }} />
        <EmptyState title={t('mobileAuthoring.noAccess')} description={t('mobileAuthoring.keysReadOnly')} />
      </Screen>
    );
  }
  return <DuplicateForm key={`${organizationId}:${arrangement.id}`} song={song.data} arrangement={arrangement} />;
}

interface DuplicateFormProps {
  song: SongWithArrangements;
  arrangement: ArrangementRow;
}

const DuplicateForm = ({ song, arrangement }: DuplicateFormProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [name, setName] = useState(() => t('curation.copyName', { name: arrangement.name }));
  const [metadata, setMetadata] = useState(true);
  const [sections, setSections] = useState(true);
  const [chart, setChart] = useState(true);
  const [keyIds, setKeyIds] = useState<string[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<DuplicateArrangementPreview | null>(null);
  // One key per reviewed request: every retry of this review replays it.
  const [requestKey, setRequestKey] = useState(newIdempotencyKey);
  const [problem, setProblem] = useState<LocalizedError | null>(null);

  const materials = useQuery({
    queryKey: queryKeys.arrangementMaterials(queryScope, arrangement.id),
    queryFn: () => api.getArrangementMaterials(arrangement.id),
    enabled: Boolean(queryScope),
  });

  const guard = useDiscardGuard({
    dirty: preview !== null,
    message: t('mobileAuthoring.discardReview'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  const selection = (): DuplicateArrangementInput => ({
    name,
    expected_revision: arrangement.revision,
    metadata,
    sections,
    chart,
    key_ids: keyIds,
    file_ids: fileIds,
  });

  const review = useMutation({
    mutationFn: () => api.previewArrangementDuplicate(arrangement.id, duplicateArrangementSchema.parse(selection())),
    onSuccess: (result) => {
      if (isCurrentGeneration(generation)) setPreview(result);
    },
  });
  const duplicate = useMutation({
    mutationFn: () =>
      api.duplicateArrangement(arrangement.id, { ...preview!.selection, fingerprint: preview!.fingerprint, idempotency_key: requestKey }),
    onSuccess: async (result) => {
      if (!isCurrentGeneration(generation)) return;
      arrangementSelections.set(queryScope, draftTargets.song(song.id), { draft: result.arrangement_id, baseRevision: null });
      await invalidateLibrary(queryClient, queryScope);
      guard.leave();
    },
  });
  const outcome = duplicate.error ? libraryWriteOutcome(duplicate.error) : null;
  const busy = review.isPending || duplicate.isPending;

  const startReview = () => {
    if (!duplicateArrangementSchema.safeParse(selection()).success) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.duplicateInvalid' }));
      return;
    }
    setProblem(null);
    review.mutate();
  };

  // A new selection (or a stale review) is a new request: fresh review, fresh key.
  const changeSelection = () => {
    setPreview(null);
    setRequestKey(newIdempotencyKey());
    duplicate.reset();
    review.reset();
    if (outcome === 'stale') void queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
  };

  const keys = materials.data?.keys ?? [];
  const files = materials.data?.files ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: t('curation.duplicateSummary') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.group}>
          <Text style={styles.title}>{song.title}</Text>
          <Text style={styles.muted}>{arrangement.name}</Text>
        </View>
        {materials.isLoading ? <Loading /> : null}
        <ErrorNotice error={materials.error} />

        {preview ? (
          <Card>
            <View accessibilityLiveRegion="polite" style={styles.group}>
              <Text style={styles.body}>
                {[
                  t('curation.previewCreate', { name: preview.selection.name }),
                  t(preview.selection.metadata ? 'curation.previewMetadataIncluded' : 'curation.previewMetadataOmitted'),
                  t(preview.selection.sections ? 'curation.previewSectionsIncluded' : 'curation.previewSectionsOmitted'),
                  t(preview.selection.chart ? 'curation.previewChartIncluded' : 'curation.previewChartOmitted'),
                  t('curation.previewKeepDefault'),
                ].join(' ')}
              </Text>
              <Text style={styles.body}>
                {[
                  t('curation.previewKeys', {
                    count: preview.keys.length,
                    keys: preview.keys.map((key) => t('curation.keyWithPitch', { label: key.label, key: key.song_key })).join(', ') || t('common:states.none'),
                  }),
                  t('curation.previewFiles', {
                    count: preview.files.length,
                    files: preview.files.map((file) => file.title).join(', ') || t('common:states.none'),
                  }),
                  t('curation.previewReuseNote'),
                ].join(' ')}
              </Text>
              {outcome === 'stale' ? (
                <Text accessibilityRole="alert" style={styles.warning}>{t('mobileAuthoring.duplicateStale')}</Text>
              ) : outcome === 'uncertain' ? (
                <Text accessibilityRole="alert" style={styles.warning}>{t('curation.retryHelp')}</Text>
              ) : (
                <ErrorNotice error={duplicate.error} />
              )}
              <Button
                title={outcome === 'uncertain' ? t('common:actions.retry') : t('curation.createDuplicate')}
                loading={duplicate.isPending}
                disabled={busy || outcome === 'stale' || outcome === 'gone'}
                onPress={() => duplicate.mutate()}
              />
              <Button title={t('curation.changeSelection')} variant="secondary" disabled={busy} onPress={changeSelection} />
            </View>
          </Card>
        ) : (
          <>
            <Field label={t('curation.newName')} value={name} onChangeText={setName} maxLength={120} />
            <View style={styles.group}>
              <Label>{t('mobileAuthoring.duplicateInclude')}</Label>
              <View style={styles.chips}>
                <Chip label={t('curation.includeMetadata')} toggle active={metadata} onPress={() => setMetadata((on) => !on)} />
                <Chip label={t('curation.includeSections')} toggle active={sections} onPress={() => setSections((on) => !on)} />
                <Chip label={t('curation.includeChart')} toggle active={chart} onPress={() => setChart((on) => !on)} />
              </View>
            </View>
            {keys.length ? (
              <View style={styles.group}>
                <Label>{t('curation.keysToDuplicate')}</Label>
                <View style={styles.chips}>
                  {keys.map((key) => (
                    <Chip
                      key={key.id}
                      label={t('curation.keyOption', { label: key.label, key: key.song_key })}
                      toggle
                      active={keyIds.includes(key.id)}
                      onPress={() => setKeyIds((ids) => toggled(ids, key.id))}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            {files.length ? (
              <View style={styles.group}>
                <Label>{t('curation.filesToReuse')}</Label>
                <View style={styles.chips}>
                  {files.map((file) => (
                    <Chip
                      key={file.id}
                      label={file.title}
                      toggle
                      active={fileIds.includes(file.id)}
                      onPress={() => setFileIds((ids) => toggled(ids, file.id))}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            <ErrorNotice error={problem ?? review.error} />
            <Button title={t('curation.previewDuplicate')} loading={review.isPending} disabled={busy} onPress={startReview} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    title: { ...theme.type.title, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
