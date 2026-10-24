import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  CHART_CHORD_COLORS,
  CHART_FONT_OPTIONS,
  CHART_FONT_SIZES,
  DEFAULT_ARRANGEMENT_NAME_KEY,
  DEFAULT_CHART_CHORD_COLOR,
  DEFAULT_CHART_FONT,
  DEFAULT_CHART_FONT_SIZE,
  LocalizedError,
  ORIGINAL_CHART_VIEW,
  chartDocumentFrom,
  chartEditorFormFrom,
  chartEditorIsDirty,
  chartEditorProblem,
  parseChordPro,
  rebaseDraft,
  uuid,
  type ArrangementRow,
  type ChartEditorFormValues,
  type ChartNotation,
  type ChartViewSelection,
  type SongWithArrangements,
  type TranslationKey,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { queryKeys } from '../../src/lib/query-keys';
import { chartArrangementSaveBody, formatChartSequence, parseChartSequence } from '../../src/lib/chart-editing';
import {
  authoringDrafts,
  canAuthorSong,
  draftTargets,
  invalidateLibrary,
  libraryWriteOutcome,
} from '../../src/lib/song-library';
import { useDiscardGuard } from '../../src/lib/useDiscardGuard';
import { useAuth } from '../../src/providers/AuthProvider';
import { KeyPicker } from '../../src/components/KeyPicker';
import { ChordChart } from '../../src/components/ChordChart';
import { ChartPdfActions } from '../../src/components/ChartPdfActions';
import { ChoiceChips, RestoredDraftNotice, WriteProblem } from '../../src/components/song/AuthoringParts';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  KeyCap,
  Label,
  Loading,
  Screen,
  SegmentedControl,
  screenPadding,
  type SegmentOption,
} from '../../src/components/ui';
import type { Theme } from '../../src/lib/theme';
import { useLanguage } from '../../src/i18n';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

/** Route params as they arrive: untrusted, and possibly repeated. */
interface ChartEditorRouteParams {
  songId?: string | string[];
  arrangementId?: string | string[];
}

/** The editor's two faces: the chart as typed, and the chart as it will print. */
type ChartEditorMode = 'edit' | 'preview';

const NOTATIONS: readonly ChartNotation[] = ['chords', 'numbers', 'numerals', 'lyrics'];

const NOTATION_LABEL_KEYS: Readonly<Record<ChartNotation, TranslationKey<'songs'>>> = {
  chords: 'notation.chords',
  numbers: 'notation.numbers',
  numerals: 'notation.numerals',
  lyrics: 'notation.lyrics',
};

/** Catalog keys for the CHART_CHORD_COLORS names, by stored hex value (as the website's dialog). */
const CHORD_COLOR_LABEL_KEYS: Readonly<Record<string, TranslationKey<'songs'>>> = {
  '#000000': 'formatting.colors.black',
  '#1d4ed8': 'formatting.colors.blue',
  '#b91c1c': 'formatting.colors.red',
  '#15803d': 'formatting.colors.green',
  '#525252': 'formatting.colors.grey',
};

const colorLabelKey = (value: string): TranslationKey<'songs'> | undefined => CHORD_COLOR_LABEL_KEYS[value];

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * MOB-029: the website's Lyrics & Chords editor (`ChartEditorPage`) on a
 * phone, for library managers. It edits the library arrangement's chart, key,
 * name, sequence and layout in one revisioned `updateArrangement`; a plan's
 * own key and sequence stay on its items. The preview and the PDF are made
 * from one shared `ChartDocument`, so what is read is what is exported.
 */
export default function ChartEditorScreen() {
  const params: ChartEditorRouteParams = useLocalSearchParams();
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, organizationId, canAnywhere } = useAuth();
  const songId = uuid.safeParse(single(params.songId));
  const arrangementId = uuid.safeParse(single(params.arrangementId));
  const title = t('chartEditor.lyricsAndChords');

  const song = useQuery({
    queryKey: queryKeys.song(queryScope, songId.success ? songId.data : null),
    queryFn: () => api.getSong(songId.success ? songId.data : ''),
    enabled: Boolean(songId.success && queryScope),
  });

  if (!songId.success || !arrangementId.success) {
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
  const arrangement = song.data.arrangements.find((candidate) => candidate.id === arrangementId.data) ?? null;
  if (!arrangement) {
    return (
      <Screen>
        <Stack.Screen options={{ title }} />
        <EmptyState title={t('chartEditor.arrangementNotFound')} description={t('chartEditor.arrangementNotFoundDescription')} />
      </Screen>
    );
  }
  return (
    <ChartEditor key={`${organizationId}:${song.data.id}:${arrangement.id}`} song={song.data} arrangement={arrangement} title={title} />
  );
}

interface ChartEditorProps {
  song: SongWithArrangements;
  /** The arrangement as last read from the server. */
  arrangement: ArrangementRow;
  title: string;
}

const ChartEditor = ({ song, arrangement, title }: ChartEditorProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { locale } = useLanguage();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const target = draftTargets.chart(arrangement.id);
  const defaultName = t(DEFAULT_ARRANGEMENT_NAME_KEY);

  const [restored] = useState(() => authoringDrafts.get<ChartEditorFormValues>(queryScope, target));
  const [form, setForm] = useState<ChartEditorFormValues>(() => restored?.draft ?? chartEditorFormFrom(song, arrangement));
  // The saved values (and their revision) the draft started from, so a stale
  // save can be rebased field by field onto the latest version.
  const [baseForm, setBaseForm] = useState<ChartEditorFormValues>(() => restored?.base ?? chartEditorFormFrom(song, arrangement));
  const [baseRevision, setBaseRevision] = useState<number>(() => restored?.baseRevision ?? arrangement.revision);
  const [sequenceText, setSequenceText] = useState(() => formatChartSequence(form.sequence));
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [mode, setMode] = useState<ChartEditorMode>('edit');
  const [view, setView] = useState<ChartViewSelection>(ORIGINAL_CHART_VIEW);
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const set = <K extends keyof ChartEditorFormValues>(field: K, value: ChartEditorFormValues[K]) => {
    setSavedAt(null);
    setForm((current) => ({ ...current, [field]: value }));
  };
  const setFormatting = <K extends keyof ChartEditorFormValues['formatting']>(
    field: K,
    value: ChartEditorFormValues['formatting'][K],
  ) => set('formatting', { ...form.formatting, [field]: value });

  const dirty = chartEditorIsDirty(form, baseForm);
  useEffect(() => {
    if (dirty) authoringDrafts.set(queryScope, target, { draft: form, baseRevision, base: baseForm });
    else authoringDrafts.clear(queryScope, target);
  }, [baseForm, baseRevision, dirty, form, queryScope, target]);

  useDiscardGuard({
    dirty,
    message: t('songs:chartEditor.leaveConfirm'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  // One document for both the preview and the PDF: the draft, in the key and
  // notation it is being read in, transposed once by the shared renderer.
  const doc = useMemo(
    () => chartDocumentFrom({ values: { ...form, title: song.title }, song, view, untitledTitle: t('chartEditor.untitledSong'), locale }),
    [form, song, view, t, locale],
  );
  const preview = useMemo(() => parseChordPro(doc.chordpro), [doc]);
  const hasChart = form.source.trim() !== '';

  const save = useMutation({
    mutationFn: (): Promise<ArrangementRow> =>
      api.updateArrangement(arrangement.id, chartArrangementSaveBody(form, baseRevision, defaultName)),
    onSuccess: async (saved) => {
      if (!isCurrentGeneration(generation)) return;
      authoringDrafts.clear(queryScope, target);
      // What the server stored is the new base: the editor stays open on it.
      const stored = chartEditorFormFrom(song, saved);
      setBaseForm(stored);
      setForm(stored);
      setSequenceText(formatChartSequence(stored.sequence));
      setBaseRevision(saved.revision);
      setSavedAt(Date.now());
      await invalidateLibrary(queryClient, queryScope);
    },
  });
  const outcome = save.error ? libraryWriteOutcome(save.error) : null;
  const changedSinceDraft = arrangement.revision !== baseRevision && outcome !== 'stale' && !save.isPending;

  const loadLatest = async () => {
    setLoadingLatest(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.song(queryScope, song.id) });
    if (!isCurrentGeneration(generation)) return;
    const latestSong = queryClient.getQueryData<SongWithArrangements>(queryKeys.song(queryScope, song.id));
    const latest = latestSong?.arrangements.find((candidate) => candidate.id === arrangement.id);
    if (latest && latestSong) {
      // Keep what was changed here; everything else takes the latest saved values.
      const latestForm = chartEditorFormFrom(latestSong, latest);
      const next = rebaseDraft(form, baseForm, latestForm);
      setForm(next);
      setSequenceText(formatChartSequence(next.sequence));
      setBaseForm(latestForm);
      setBaseRevision(latest.revision);
    }
    setLoadingLatest(false);
    save.reset();
  };

  const submit = () => {
    const found = chartEditorProblem({ ...form, title: song.title }, defaultName);
    if (found) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.invalid' }));
      return;
    }
    setProblem(null);
    if (dirty) save.mutate();
  };

  const discardRestored = () => {
    authoringDrafts.clear(queryScope, target);
    const opened = chartEditorFormFrom(song, arrangement);
    setForm(opened);
    setBaseForm(opened);
    setSequenceText(formatChartSequence(opened.sequence));
    setBaseRevision(arrangement.revision);
    setShowRestored(false);
  };

  const modes: readonly SegmentOption<ChartEditorMode>[] = [
    { value: 'edit', label: t('mobileChartEditor.edit') },
    { value: 'preview', label: t('mobileChartEditor.preview') },
  ];
  const notations: readonly SegmentOption<ChartNotation>[] = NOTATIONS.map((value) => ({ value, label: t(NOTATION_LABEL_KEYS[value]) }));
  const keyed = view.notation === 'chords';
  const columnOptions: readonly SegmentOption<'1' | '2'>[] = [
    { value: '1', label: t('chartEditor.oneColumn') },
    { value: '2', label: t('chartEditor.twoColumns') },
  ];
  // "Default: …" names what the template prints when nothing is chosen, as the website's dialog does.
  const defaultFont = CHART_FONT_OPTIONS.find((font) => font.value === DEFAULT_CHART_FONT)?.label ?? DEFAULT_CHART_FONT;
  const defaultColorKey = colorLabelKey(DEFAULT_CHART_CHORD_COLOR);
  const defaultColor = defaultColorKey ? t(defaultColorKey) : DEFAULT_CHART_CHORD_COLOR;

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.heading}>
          <Text style={styles.songTitle}>{song.title}</Text>
          <Text style={styles.muted}>{form.arrangementName.trim() || defaultName}</Text>
        </View>
        {showRestored ? <RestoredDraftNotice onDiscard={discardRestored} /> : null}
        {arrangement.archived_at ? <Text style={styles.muted}>{t('songDetail.archivedArrangement')}</Text> : null}
        {changedSinceDraft ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileAuthoring.changedSinceDraft')}</Text>
        ) : null}

        <SegmentedControl options={modes} value={mode} onChange={setMode} />

        {mode === 'edit' ? (
          <>
            <Field
              label={t('arrangement.fields.name')}
              value={form.arrangementName}
              onChangeText={(value) => set('arrangementName', value)}
              placeholder={defaultName}
              maxLength={120}
            />
            <View style={styles.group}>
              <Label>{t('chartEditor.currentKey')}</Label>
              <KeyPicker
                value={form.songKey}
                onChange={(key) => set('songKey', key)}
                label={t('chartEditor.currentKey')}
                placeholder={t('arrangement.noKey')}
                resetLabel={t('arrangement.noKey')}
              />
              <Text style={styles.muted}>{t('mobileChartEditor.keyNote')}</Text>
            </View>
            <Field
              label={t('arrangement.fields.sequence')}
              value={sequenceText}
              onChangeText={(value) => {
                setSequenceText(value);
                set('sequence', parseChartSequence(value));
              }}
              placeholder="Intro, V1, C1, V2, C1, B, C2, E"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <Text style={styles.muted}>{t('arrangement.sequenceHelp')}</Text>

            <View style={styles.group}>
              <Label>{t('chartEditor.lyricsAndChords')}</Label>
              <TextInput
                accessibilityLabel={t('chartEditor.lyricsAndChords')}
                value={form.source}
                onChangeText={(value) => set('source', value)}
                placeholder={t('chartEditor.sourcePlaceholder')}
                placeholderTextColor={theme.color.inkFaint}
                multiline
                scrollEnabled={false}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                textAlignVertical="top"
                style={styles.source}
              />
              <Text style={styles.muted}>
                <Trans t={t} i18nKey="songs:chartEditor.sourceHelp" components={[<Text key="example" style={styles.code} />]} />
              </Text>
            </View>

            <Card>
              <Label>{t('chartEditor.formatting')}</Label>
              <View style={styles.layout}>
                <View style={styles.group}>
                  <Label>{t('formatting.columnsLabel')}</Label>
                  <SegmentedControl
                    options={columnOptions}
                    value={form.formatting.columns === 2 ? '2' : '1'}
                    onChange={(value) => setFormatting('columns', value === '2' ? 2 : 1)}
                  />
                </View>
                <ChoiceChips
                  label={t('formatting.fontLabel')}
                  options={CHART_FONT_OPTIONS.map((font) => ({ value: font.value, label: font.label }))}
                  noneLabel={t('formatting.default', { value: defaultFont })}
                  value={form.formatting.fontFamily}
                  onChange={(value) => setFormatting('fontFamily', value)}
                />
                <ChoiceChips
                  label={t('formatting.sizeLabel')}
                  options={CHART_FONT_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                  noneLabel={t('formatting.default', { value: DEFAULT_CHART_FONT_SIZE })}
                  value={form.formatting.fontSize === null ? null : String(form.formatting.fontSize)}
                  onChange={(value) => setFormatting('fontSize', value === null ? null : Number(value))}
                />
                <ChoiceChips
                  label={t('formatting.chordColorLabel')}
                  options={CHART_CHORD_COLORS.map((color) => {
                    const key = colorLabelKey(color.value);
                    return { value: color.value, label: key ? t(key) : color.label };
                  })}
                  noneLabel={t('formatting.default', { value: defaultColor })}
                  value={form.formatting.chordColor}
                  onChange={(value) => setFormatting('chordColor', value)}
                />
              </View>
              <Text style={styles.muted}>{t('mobileChartEditor.layoutNote')}</Text>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <Label>{t('mobileChart.notation')}</Label>
              <SegmentedControl
                options={notations}
                value={view.notation}
                onChange={(notation) => setView((current) => ({ ...current, notation }))}
              />
              {keyed ? (
                <View style={[styles.group, styles.previewKey]}>
                  <Label>{t('mobileChartEditor.previewKey')}</Label>
                  <KeyPicker
                    value={view.targetKey}
                    onChange={(targetKey) => setView((current) => ({ ...current, targetKey }))}
                    label={t('mobileChartEditor.previewKey')}
                    placeholder={t('notation.originalKey')}
                    resetLabel={t('notation.originalKey')}
                  />
                </View>
              ) : null}
              <Text style={styles.muted}>
                {keyed
                  ? doc.key
                    ? t('mobileChartEditor.previewIn', { key: doc.key })
                    : t('mobileChart.keyNotSet')
                  : t('mobileChart.keyIndependent')}
              </Text>
            </Card>
            {form.sequence.length ? (
              <View style={styles.sequence}>
                {form.sequence.map((part, index) => (
                  <KeyCap key={`${part}-${index}`}>{part}</KeyCap>
                ))}
              </View>
            ) : null}
            {hasChart ? (
              <ChordChart chart={preview} />
            ) : (
              <Card>
                <EmptyState title={t('mobileChart.render.noChart.title')} description={t('mobileChartEditor.emptyChart')} />
              </Card>
            )}
            <Text style={styles.muted}>{t('mobileChartEditor.previewNote')}</Text>
          </>
        )}

        <Card>
          <Label>{t('mobileChartPdf.title')}</Label>
          <ChartPdfActions doc={hasChart ? doc : null} unsaved={dirty} />
        </Card>

        <ErrorNotice error={problem} />
        <WriteProblem error={save.error} outcome={outcome} onLoadLatest={() => void loadLatest()} loadingLatest={loadingLatest} />
        {savedAt && !dirty ? (
          <Text accessibilityLiveRegion="polite" style={styles.muted}>{t('mobileChartEditor.savedNote')}</Text>
        ) : null}
        <Button
          title={dirty ? t('common:actions.save') : t('chartEditor.saved')}
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
    layout: { gap: theme.space.md, marginBottom: theme.space.sm },
    heading: { gap: theme.space.xs },
    songTitle: { ...theme.type.title, color: theme.color.ink },
    previewKey: { marginTop: theme.space.md, marginBottom: theme.space.sm },
    sequence: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    source: {
      ...theme.type.code,
      color: theme.color.ink,
      backgroundColor: theme.color.surface,
      borderColor: theme.color.borderStrong,
      borderWidth: 1,
      borderRadius: theme.radius.md,
      padding: theme.space.md,
      minHeight: 240,
    },
    code: { ...theme.type.code, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
  });
