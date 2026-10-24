import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CAPO_POSITIONS,
  LocalizedError,
  blankLabeledKey,
  isLabeledKeyDraftDirty,
  labeledKeyDraftFrom,
  labeledKeyInputSchema,
  rebaseDraft,
  uuid,
  type ArrangementMaterials,
  type ArrangementRow,
  type LabeledKey,
  type LabeledKeyInput,
  type SongWithArrangements,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { queryKeys } from '../../src/lib/query-keys';
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
import { ChoiceChips, RestoredDraftNotice, WriteProblem } from '../../src/components/song/AuthoringParts';
import {
  Button,
  Card,
  Chip,
  Divider,
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
interface KeysRouteParams {
  songId?: string | string[];
  arrangementId?: string | string[];
}

const single = (value: string | string[] | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** Capo frets a labeled key may name: open (0) through 11, or none. */
const KEY_CAPO_FRETS: readonly number[] = [0, ...CAPO_POSITIONS];

/**
 * MOB-028: an arrangement's F15 labeled keys — the website's "Add or edit a
 * labeled key" on `getArrangementMaterials` / `saveArrangementKey`. A key's
 * id is minted once, so a retried first save replays it; edits carry the
 * key's revision and a competing save is refused (409 `library_changed`).
 * The sounding pitch of a saved key never changes (historical plan
 * selection depends on it).
 */
export default function LabeledKeysScreen() {
  const params: KeysRouteParams = useLocalSearchParams();
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
        <Stack.Screen options={{ title: t('curation.title') }} />
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
        <Stack.Screen options={{ title: t('curation.title') }} />
        <ErrorNotice error={song.error ?? new LocalizedError({ key: 'songs:mobileAuthoring.arrangementGone' })} />
      </Screen>
    );
  }
  // Writers need songs.manage, an unmerged song, and neither song nor arrangement archived (website rule).
  const canEdit = canAuthorSong(canAnywhere('songs.manage'), song.data) && !song.data.archived_at && !arrangement.archived_at;
  return (
    <LabeledKeys
      key={`${organizationId}:${arrangement.id}`}
      song={song.data}
      arrangement={arrangement}
      canEdit={canEdit}
    />
  );
}

interface LabeledKeysProps {
  song: SongWithArrangements;
  arrangement: ArrangementRow;
  canEdit: boolean;
}

const keySummary = (key: Pick<LabeledKey, 'label' | 'song_key' | 'capo' | 'vocal_label'>, capoText: (capo: number) => string): string =>
  [key.label, key.song_key, key.capo !== null ? capoText(key.capo) : null, key.vocal_label].filter(Boolean).join(' · ');

const LabeledKeys = ({ song, arrangement, canEdit }: LabeledKeysProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  // The key being edited: an existing key's id, or a fresh id for a new one.
  const [editing, setEditing] = useState<{ id: string; saved: LabeledKey | null } | null>(null);

  const materials = useQuery({
    queryKey: queryKeys.arrangementMaterials(queryScope, arrangement.id),
    queryFn: () => api.getArrangementMaterials(arrangement.id),
    enabled: Boolean(queryScope),
  });
  const keys = materials.data?.keys ?? [];
  const files = materials.data?.files ?? [];
  const capoText = (capo: number) => t('curation.capoValue', { capo });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('curation.title') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <View style={styles.group}>
          <Text style={styles.title}>{song.title}</Text>
          <Text style={styles.muted}>{arrangement.name}</Text>
        </View>
        <Text style={styles.muted}>{t('curation.intro')}</Text>
        {!canEdit ? <Text style={styles.muted}>{t('mobileAuthoring.keysReadOnly')}</Text> : null}
        {materials.isLoading ? <Loading /> : null}
        <ErrorNotice error={materials.error} />

        <Card>
          <Label>{t('mobileAuthoring.keysHeading')}</Label>
          {materials.isSuccess && keys.length === 0 ? <Text style={styles.muted}>{t('mobileAuthoring.noKeys')}</Text> : null}
          {keys.map((key, index) => {
            const keyFiles = files.filter((file) => file.key_ids.includes(key.id));
            return (
              <View key={key.id}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.keyRow}>
                  <View style={styles.flex}>
                    <Text style={styles.body}>{keySummary(key, capoText)}</Text>
                    <Text style={styles.muted}>
                      {keyFiles.length ? keyFiles.map((file) => file.title).join(', ') : t('curation.noFiles')}
                    </Text>
                  </View>
                  {canEdit ? (
                    <Button
                      title={t('common:actions.edit')}
                      variant="secondary"
                      accessibilityLabel={t('curation.editKey', { label: key.label })}
                      onPress={() => setEditing({ id: key.id, saved: key })}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}
        </Card>

        {canEdit && !editing ? (
          <Button title={t('curation.newKey')} icon="plus" variant="secondary" onPress={() => setEditing({ id: newIdempotencyKey(), saved: null })} />
        ) : null}

        {canEdit && editing && materials.data ? (
          <KeyEditor
            key={editing.id}
            arrangement={arrangement}
            keyId={editing.id}
            saved={editing.saved}
            materials={materials.data}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
};

interface KeyEditorProps {
  arrangement: ArrangementRow;
  keyId: string;
  /** Null while the key has never been saved. */
  saved: LabeledKey | null;
  materials: ArrangementMaterials;
  onDone: () => void;
}

const KeyEditor = ({ arrangement, keyId, saved: openedWith, materials, onDone }: KeyEditorProps) => {
  const { t } = useTranslation(['songs', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const queryClient = useQueryClient();
  const styles = useThemedStyles(makeStyles);
  const target = draftTargets.labeledKey(arrangement.id, keyId);

  const [restored] = useState(() => authoringDrafts.get<LabeledKeyInput>(queryScope, target));
  const [draft, setDraft] = useState<LabeledKeyInput>(
    () => restored?.draft ?? (openedWith ? labeledKeyDraftFrom(openedWith) : blankLabeledKey(keyId)),
  );
  const [showRestored, setShowRestored] = useState(Boolean(restored));
  const [saved, setSaved] = useState<LabeledKey | null>(openedWith);
  const [notice, setNotice] = useState('');
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const set = <K extends keyof LabeledKeyInput>(field: K, value: LabeledKeyInput[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const dirty = isLabeledKeyDraftDirty(draft, saved);
  useEffect(() => {
    if (dirty) authoringDrafts.set(queryScope, target, { draft, baseRevision: draft.expected_revision });
    else authoringDrafts.clear(queryScope, target);
  }, [dirty, draft, queryScope, target]);

  useDiscardGuard({
    dirty,
    message: t('mobileAuthoring.discardConfirm'),
    keepLabel: t('mobileAuthoring.keepEditing'),
    discardLabel: t('mobileAuthoring.discard'),
  });

  const save = useMutation({
    mutationFn: () => api.saveArrangementKey(arrangement.id, labeledKeyInputSchema.parse(draft)),
    onSuccess: async (key) => {
      if (!isCurrentGeneration(generation)) return;
      authoringDrafts.clear(queryScope, target);
      setSaved(key);
      setDraft(labeledKeyDraftFrom(key));
      setNotice(t('curation.keySaved'));
      // File scopes decide which files plans and rehearsals pick for this key.
      await invalidateLibrary(queryClient, queryScope);
    },
  });
  const outcome = save.error ? libraryWriteOutcome(save.error) : null;

  // Keep the draft; save it against the key as it is now (or create it if it never landed).
  const loadLatest = async () => {
    setLoadingLatest(true);
    await queryClient.invalidateQueries({ queryKey: queryKeys.arrangementMaterials(queryScope, arrangement.id) });
    if (!isCurrentGeneration(generation)) return;
    const latest = queryClient.getQueryData<ArrangementMaterials>(queryKeys.arrangementMaterials(queryScope, arrangement.id));
    const current = latest?.keys.find((key) => key.id === keyId) ?? null;
    if (current) {
      // Keep what was changed here; everything else (and the fixed pitch) takes the latest saved values.
      const latestDraft = labeledKeyDraftFrom(current);
      const base = saved ? labeledKeyDraftFrom(saved) : blankLabeledKey(keyId);
      setDraft((existing) => ({ ...rebaseDraft(existing, base, latestDraft), expected_revision: current.revision, song_key: current.song_key }));
    } else {
      setDraft((existing) => ({ ...existing, expected_revision: null }));
    }
    setSaved(current);
    setLoadingLatest(false);
    save.reset();
  };

  const submit = () => {
    if (!labeledKeyInputSchema.safeParse(draft).success) {
      setProblem(new LocalizedError({ key: 'songs:mobileAuthoring.keyInvalid' }));
      return;
    }
    setProblem(null);
    setNotice('');
    save.mutate();
  };

  const toggleFile = (fileId: string) =>
    set('file_ids', draft.file_ids.includes(fileId) ? draft.file_ids.filter((id) => id !== fileId) : [...draft.file_ids, fileId]);
  const pitchFixed = saved !== null;

  return (
    <Card>
      <View style={styles.editor}>
        <Label>{saved ? t('curation.editKey', { label: saved.label }) : t('curation.newKey')}</Label>
        {showRestored ? (
          <RestoredDraftNotice
            onDiscard={() => {
              authoringDrafts.clear(queryScope, target);
              setDraft(openedWith ? labeledKeyDraftFrom(openedWith) : blankLabeledKey(keyId));
              setShowRestored(false);
            }}
          />
        ) : null}
        <Field label={t('curation.label')} value={draft.label} onChangeText={(value) => set('label', value)} maxLength={80} />
        <View style={styles.group}>
          <Label>{t('curation.soundingKey')}</Label>
          {pitchFixed ? (
            <Text style={styles.body}>{draft.song_key}</Text>
          ) : (
            <KeyPicker
              value={draft.song_key}
              onChange={(key) => {
                if (key) set('song_key', key);
              }}
              label={t('curation.soundingKey')}
              placeholder={draft.song_key}
            />
          )}
          <Text style={styles.muted}>{t('curation.pitchHelp')}</Text>
        </View>
        <ChoiceChips
          label={t('curation.capoFret')}
          options={KEY_CAPO_FRETS.map((fret) => ({ value: String(fret), label: String(fret) }))}
          noneLabel={t('common:states.none')}
          value={draft.capo === null ? null : String(draft.capo)}
          onChange={(value) => set('capo', value === null ? null : Number(value))}
        />
        <Field
          label={t('curation.vocalLabel')}
          value={draft.vocal_label ?? ''}
          onChangeText={(value) => set('vocal_label', value || null)}
          maxLength={80}
        />
        <View style={styles.group}>
          <Label>{t('curation.filesForThisKey')}</Label>
          {materials.files.length ? (
            <View style={styles.chips}>
              {materials.files.map((file) => (
                <Chip key={file.id} label={file.title} toggle active={draft.file_ids.includes(file.id)} onPress={() => toggleFile(file.id)} />
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>{t('mobileAuthoring.noArrangementFiles')}</Text>
          )}
          <Text style={styles.muted}>{t('curation.fileScopeHelp')}</Text>
        </View>

        <ErrorNotice error={problem} />
        <WriteProblem error={save.error} outcome={outcome} onLoadLatest={() => void loadLatest()} loadingLatest={loadingLatest} />
        {notice ? <Text accessibilityRole="alert" style={styles.body}>{notice}</Text> : null}
        <View style={styles.actions}>
          <Button
            title={t('curation.saveKey')}
            loading={save.isPending}
            disabled={!dirty || outcome === 'stale' || outcome === 'gone'}
            onPress={submit}
          />
          <Button
            title={t('common:actions.close')}
            variant="quiet"
            disabled={save.isPending}
            onPress={() => {
              if (!dirty) {
                onDone();
                return;
              }
              Alert.alert(t('mobileAuthoring.discardConfirm'), undefined, [
                { text: t('mobileAuthoring.keepEditing'), style: 'cancel' },
                {
                  text: t('mobileAuthoring.discard'),
                  style: 'destructive',
                  onPress: () => {
                    authoringDrafts.clear(queryScope, target);
                    onDone();
                  },
                },
              ]);
            }}
          />
        </View>
      </View>
    </Card>
  );
};

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    editor: { gap: theme.space.lg },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    keyRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md, paddingVertical: theme.space.sm },
    title: { ...theme.type.title, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
  });
