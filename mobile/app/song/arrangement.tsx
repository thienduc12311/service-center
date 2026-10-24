import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CAPO_POSITIONS,
  LocalizedError,
  NEW_ARRANGEMENT_NAME_KEY,
  arrangementFormFrom,
  createArrangementSchema,
  isArrangementFormDirty,
  isNewArrangementFormDirty,
  newArrangementForm,
  rebaseDraft,
  toArrangementEdit,
  toCreateArrangementInput,
  updateArrangementSchema,
  uuid,
  type ArrangementFormValues,
  type ArrangementRow,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import {
  arrangementSelections,
  authoringDrafts,
  canAuthorSong,
  draftTargets,
  invalidateLibrary,
  libraryWriteOutcome,
} from '../../src/lib/song-library';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useAuth } from '../../src/providers/AuthProvider';
import { KeyPicker } from '../../src/components/KeyPicker';
import { ChoiceChips, RestoredDraftNotice, WriteProblem } from '../../src/components/song/AuthoringParts';
import { Button, Card, EmptyState, ErrorNotice, Field, Label, Loading, Screen, screenPadding } from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** Route params as they arrive: untrusted, and possibly repeated. */
interface ArrangementRouteParams {
  songId?: string | string[];
  arrangementId?: string | string[];
}

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * MOB-028: the website's Arrangement dialog — add one (`createArrangement`)
 * or edit one (`updateArrangement` with the revision it was opened at).
 * The chart itself is not edited here (MOB-029). The default can only be
 * promoted; the server moves it away from the previous default in the same
 * write, and refuses an archived arrangement as default.
 */
export default function ArrangementScreen() {
  const params: ArrangementRouteParams = useLocalSearchParams();
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, organizationId, canAnywhere } = useAuth();
  const songId = uuid.safeParse(single(params.songId));
  const rawArrangementId = single(params.arrangementId);
  const arrangementId = rawArrangementId === undefined ? null : uuid.safeParse(rawArrangementId);

  const song = useQuery({
    queryKey: queryKeys.song(queryScope, songId.success ? songId.data : null),
    queryFn: () => api.getSong(songId.success ? songId.data : ''),
    enabled: Boolean(songId.success && queryScope),
  });
  const title = arrangementId ? t('arrangement.editTitle') : t('arrangement.addTitle');

  if (!songId.success || (arrangementId && !arrangementId.success)) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
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
  if (song.error || !song.data) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <ErrorNotice error={song.error ?? new LocalizedError({ key: 'songs:songDetail.notFound' })} />
      </Screen>
    );
  }
  if (!canAuthorSong(canAnywhere('songs.manage'), song.data)) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('mobileAuthoring.noAccess')} />
      </Screen>
    );
  }
  const arrangement = arrangementId?.success
    ? (song.data.arrangements.find((candidate) => candidate.id === arrangementId.data) ?? null)
    : null;
  if (arrangementId && !arrangement) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('mobileAuthoring.arrangementGone')} />
      </Screen>
    );
  }
  return (
    <ArrangementForm
      key={`${organizationId}:${song.data.id}:${arrangement?.id ?? 'new'}`}
      song={song.data}
      arrangement={arrangement}
      title={title}
    />
  );
}

interface ArrangementFormProps {
  song: SongWithArrangements;
  /** Null adds a new arrangement to the song. */
  arrangement: ArrangementRow | null;
  title: string;
}

const ArrangementForm = ({ song, arrangement, title }: ArrangementFormProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const defaultName = arrangement?.name ?? t(NEW_ARRANGEMENT_NAME_KEY);
  const target = arrangement ? draftTargets.arrangement(arrangement.id) : draftTargets.newArrangement(song.id);

  const [restored] = useState(() => authoringDrafts.get<ArrangementFormValues>(queryScope, target));
  const [form, setForm] = useState<ArrangementFormValues>(
    () => restored?.draft ?? (arrangement ? arrangementFormFrom(arrangement) : newArrangementForm(song)),
  );
  const [baseRevision, setBaseRevision] = useState<number | null>(() => restored?.baseRevision ?? arrangement?.revision ?? null);
  // The saved values an edit started from, so a reload rebases it field by field.
  const [baseForm, setBaseForm] = useState<ArrangementFormValues | null>(
    () => restored?.base ?? (arrangement ? arrangementFormFrom(arrangement) : null),
  );
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const set = <K extends keyof ArrangementFormValues>(field: K, value: ArrangementFormValues[K]) =>
    setForm((current) => ({ ...current, [field]: value }));

  const dirty = arrangement ? isArrangementFormDirty(form, arrangement) : isNewArrangementFormDirty(form, song);
  useEffect(() => {
    if (dirty) authoringDrafts.set(queryScope, target, { draft: form, baseRevision, base: baseForm ?? undefined });
    else authoringDrafts.clear(queryScope, target);
  }, [baseForm, baseRevision, dirty, form, queryScope, target]);

  const guard = useDiscardGuard({
    dirty,
    message: t('mobileAuthoring.discardConfirm'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  const editBody = (row: ArrangementRow) =>
    updateArrangementSchema.parse(
      toArrangementEdit(form, { is_default: row.is_default, revision: baseRevision ?? row.revision }, defaultName),
    );
  const createBody = () => createArrangementSchema.parse(toCreateArrangementInput(form, defaultName));
  const requestBody = () => (arrangement ? editBody(arrangement) : createBody());

  const save = useMutation({
    mutationFn: (): Promise<ArrangementRow> =>
      arrangement ? api.updateArrangement(arrangement.id, editBody(arrangement)) : api.createArrangement(song.id, createBody()),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      authoringDrafts.clear(queryScope, target);
      // The song page opens on what was just saved.
      arrangementSelections.set(queryScope, draftTargets.song(song.id), { draft: saved.id, baseRevision: null });
      await invalidateLibrary(queryClient, queryScope);
      guard.leave();
    },
  });
  const outcome = save.error ? libraryWriteOutcome(save.error) : null;
  const changedSinceDraft = Boolean(arrangement && baseRevision !== null && arrangement.revision !== baseRevision && outcome !== 'stale');

  const loadLatest = async () => {
    setLoadingLatest(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
    if (!isCurrentGeneration(generation)) return;
    const latest = queryClient.getQueryData<SongWithArrangements>(queryKeys.song(queryScope, song.id));
    const latestArrangement = latest?.arrangements.find((candidate) => candidate.id === arrangement?.id);
    if (latestArrangement) {
      // Keep what was changed here; everything else takes the latest saved values.
      const latestForm = arrangementFormFrom(latestArrangement);
      if (baseForm) setForm((current) => rebaseDraft(current, baseForm, latestForm));
      setBaseForm(latestForm);
    }
    setBaseRevision(latestArrangement?.revision ?? arrangement?.revision ?? null);
    setLoadingLatest(false);
    save.reset();
  };

  const submit = () => {
    try {
      requestBody();
    } catch {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.invalid' }));
      return;
    }
    setProblem(null);
    if (dirty || !arrangement) save.mutate();
  };

  const discardRestored = () => {
    authoringDrafts.clear(queryScope, target);
    setForm(arrangement ? arrangementFormFrom(arrangement) : newArrangementForm(song));
    setBaseForm(arrangement ? arrangementFormFrom(arrangement) : null);
    setBaseRevision(arrangement?.revision ?? null);
    setShowRestored(false);
  };

  // The first arrangement has to be the default; a default stays one until another is promoted.
  const defaultLocked = arrangement ? arrangement.is_default : song.arrangements.length === 0;
  const archived = Boolean(arrangement?.archived_at);
  const keyChanged = Boolean(arrangement && form.songKey !== arrangement.song_key);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {showRestored ? <RestoredDraftNotice onDiscard={discardRestored} /> : null}
        {archived ? <Text style={styles.muted}>{t('songDetail.archivedArrangement')}</Text> : null}
        {changedSinceDraft ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileAuthoring.changedSinceDraft')}</Text>
        ) : null}

        <Field
          label={t('arrangement.fields.name')}
          value={form.name}
          onChangeText={(value) => set('name', value)}
          placeholder={t('arrangement.defaultName')}
          maxLength={120}
        />
        <View style={styles.group}>
          <Label>{t('arrangement.fields.key')}</Label>
          <KeyPicker
            value={form.songKey}
            onChange={(key) => set('songKey', key)}
            label={t('arrangement.fields.key')}
            placeholder={t('arrangement.noKey')}
            resetLabel={t('arrangement.noKey')}
          />
          {keyChanged ? <Text style={styles.muted}>{t('mobileAuthoring.inheritedKeyNote')}</Text> : null}
        </View>
        <ChoiceChips
          label={t('arrangement.fields.capo')}
          options={CAPO_POSITIONS.map((fret) => ({ value: String(fret), label: String(fret) }))}
          noneLabel={t('common:states.none')}
          value={form.capo === null ? null : String(form.capo)}
          onChange={(value) => set('capo', value === null ? null : Number(value))}
        />
        <View style={styles.row}>
          <Field
            label={t('arrangement.fields.length')}
            value={form.length}
            onChangeText={(value) => set('length', value)}
            placeholder="6:35"
            keyboardType="numbers-and-punctuation"
            containerStyle={styles.flex}
          />
          <Field
            label={t('arrangement.fields.bpm')}
            value={form.bpm}
            onChangeText={(value) => set('bpm', value)}
            placeholder="58"
            keyboardType="number-pad"
            containerStyle={styles.flex}
          />
          <Field
            label={t('arrangement.fields.meter')}
            value={form.meter}
            onChangeText={(value) => set('meter', value)}
            placeholder="4/4"
            keyboardType="numbers-and-punctuation"
            maxLength={20}
            containerStyle={styles.flex}
          />
        </View>
        <Field
          label={t('arrangement.fields.sequence')}
          value={form.sequence}
          onChangeText={(value) => set('sequence', value)}
          placeholder="Intro, V1, C1, V2, C1, B, C2, E"
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <Text style={styles.muted}>{t('arrangement.sequenceHelp')}</Text>

        <Card>
          <View style={styles.switchRow}>
            <Text style={[styles.body, styles.flex]}>{t('arrangement.useAsDefault')}</Text>
            <Switch
              accessibilityLabel={t('arrangement.useAsDefault')}
              value={form.isDefault}
              disabled={defaultLocked || archived}
              onValueChange={(value) => set('isDefault', value)}
            />
          </View>
          <Text style={styles.muted}>
            {archived
              ? t('mobileAuthoring.archivedDefaultBlocked')
              : defaultLocked
                ? t('mobileAuthoring.defaultLocked')
                : t('mobileAuthoring.defaultNote')}
          </Text>
        </Card>

        <ErrorNotice error={problem} />
        {!arrangement && outcome === 'uncertain' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileAuthoring.createArrangementUncertain')}</Text>
        ) : (
          <WriteProblem error={save.error} outcome={outcome} onLoadLatest={() => void loadLatest()} loadingLatest={loadingLatest} />
        )}
        <Button
          title={arrangement ? t('common:actions.saveChanges') : t('allArrangements.add')}
          loading={save.isPending}
          disabled={(arrangement !== null && !dirty) || outcome === 'stale' || outcome === 'gone'}
          onPress={submit}
        />
      </ScrollView>
    </Screen>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    row: { flexDirection: 'row', gap: theme.space.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, marginBottom: theme.space.sm },
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
