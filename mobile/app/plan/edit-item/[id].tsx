import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  PLAN_ITEM_SEGMENTS,
  PLAN_ITEM_TYPES,
  appendSequenceStep,
  editableArrangements,
  parseChordPro,
  planItemChangesFrom,
  planItemDraftFrom,
  validatePlanItemDraft,
  withInheritSequence,
  withSong,
  type PlanDetail,
  type PlanItemDetail,
  type PlanItemDraft,
  type PlanItemLeaderMode,
  type PlanItemType,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import {
  labeledKeyText,
  leaderPersonChoices,
  leaderPositionChoices,
  orderWriteOutcome,
} from '../../../src/lib/plan-order-edit';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
import { ArrangementPicker } from '../../../src/components/ArrangementPicker';
import { KeyPicker } from '../../../src/components/KeyPicker';
import { PressableScale } from '../../../src/components/motion';
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
  SegmentedControl,
  screenPadding,
} from '../../../src/components/ui';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

const LEADER_MODES: readonly PlanItemLeaderMode[] = ['none', 'person', 'position'];

/**
 * MOB-014: edit one order item in place — same id and position — on the
 * website's `updatePlanItem` with the plan revision the editor opened with.
 * The draft and the patch come from the shared `plan-item-draft` rules, so
 * the website and the app send the same change; keys and sequences chosen
 * here belong to this plan only and the library arrangement is never touched.
 */
export default function EditPlanItemScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const { t } = useTranslation(['plans', 'templates', 'common']);
  const { can, queryScope } = useAuth();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });
  const item = plan.data?.items.find((candidate) => candidate.id === itemId) ?? null;

  if (plan.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (plan.error || !plan.data) {
    return (
      <Screen>
        <ErrorNotice error={plan.error} />
      </Screen>
    );
  }
  if (!can('plans.edit', { serviceTypeId: plan.data.service_type_id })) {
    return (
      <Screen>
        <EmptyState title={t('templates:generate.noAccess')} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('mobileOrder.editScreenTitle') }} />
        <EmptyState title={t('mobileOrder.itemGone')} />
      </Screen>
    );
  }
  // One form per item: its draft starts from the item as it was opened.
  return <EditItemForm key={item.id} plan={plan.data} item={item} />;
}

interface EditItemFormProps {
  plan: PlanDetail;
  item: PlanItemDetail;
}

function EditItemForm({ plan, item }: EditItemFormProps) {
  const { t } = useTranslation(['plans', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [draft, setDraft] = useState<PlanItemDraft>(() => planItemDraftFrom(item));
  const [baseRevision, setBaseRevision] = useState(plan.content_revision);
  const [changingSong, setChangingSong] = useState(false);
  const [songQuery, setSongQuery] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const set = <K extends keyof PlanItemDraft>(key: K, value: PlanItemDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const isSong = draft.itemType === 'song';
  const song = useQuery({
    queryKey: queryKeys.song(queryScope, draft.songId),
    queryFn: () => api.getSong(draft.songId!),
    enabled: Boolean(queryScope && isSong && draft.songId),
  });
  const songs = useQuery({
    queryKey: queryKeys.songs(queryScope, songQuery),
    queryFn: () => api.listSongs({ q: songQuery || undefined, per_page: 100 }),
    enabled: Boolean(queryScope && changingSong),
  });
  const people = useQuery({
    queryKey: queryKeys.people(queryScope),
    queryFn: () => api.listPeople(),
    enabled: Boolean(queryScope && draft.leaderMode === 'person'),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });

  // F15: archived arrangements stay listed only when this item already uses one.
  const arrangements = editableArrangements(song.data?.arrangements ?? [], item.arrangement_id);
  const defaultArrangement = arrangements.find((row) => row.is_default) ?? arrangements[0] ?? null;
  const chosenArrangement = draft.arrangementId
    ? (arrangements.find((row) => row.id === draft.arrangementId) ?? null)
    : defaultArrangement;
  const arrangementGone = Boolean(draft.arrangementId && song.data && !arrangements.some((row) => row.id === draft.arrangementId));
  const effectiveArrangementId = draft.arrangementId ?? defaultArrangement?.id ?? null;
  const labeledKeys = useQuery({
    queryKey: queryKeys.arrangementMaterials(queryScope, effectiveArrangementId),
    queryFn: () => api.getArrangementMaterials(effectiveArrangementId!),
    enabled: Boolean(queryScope && isSong && effectiveArrangementId),
  });
  const sectionLabels = useMemo(() => {
    const chart = chosenArrangement?.chord_chart;
    if (!chart) return [];
    const labels = parseChordPro(chart).sections.flatMap((section) => (section.label ? [section.label] : []));
    return [...new Set(labels)].filter((label) => label.length <= 20);
  }, [chosenArrangement]);

  const positions = useMemo(
    () => leaderPositionChoices(teams.data ?? [], plan.plan_positions, {
      teamPosition: (team, position) => t('common:format.teamPosition', { team, position }),
      planPosition: (team, position) => t('editItem.positionThisPlan', { team, position }),
      unknownTeam: t('common:fallback.team'),
    }),
    [plan.plan_positions, t, teams.data],
  );
  const personChoices = leaderPersonChoices(people.data ?? [], personQuery, draft.leaderPersonId, t('common:fallback.unnamed'));
  const leaderOffRoster = Boolean(
    draft.leaderPersonId && people.data && !personChoices.some((choice) => choice.id === draft.leaderPersonId),
  );

  const changes = useMemo(() => planItemChangesFrom(draft, item), [draft, item]);
  const dirty = Object.keys(changes).length > 0;
  const guard = useDiscardGuard({
    dirty,
    message: t('editItem.discardConfirm'),
    keepLabel: t('mobileOrder.keepEditing'),
    discardLabel: t('mobileOrder.discard'),
  });

  const save = useMutation({
    mutationFn: () => api.updatePlanItem(plan.id, item.id, { ...changes, expected_revision: baseRevision }),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rehearsal(queryScope, plan.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.plans(queryScope) }),
      ]);
      guard.leave();
    },
    onError: (error) => {
      // Gone: re-read so the screen says so. No answer: re-read so the
      // "changed" notice shows if the save did land.
      const outcome = orderWriteOutcome(error);
      if (isCurrentGeneration(generation) && (outcome === 'gone' || outcome === 'uncertain')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) });
      }
    },
  });
  const outcome = save.error ? orderWriteOutcome(save.error) : null;
  const stale = outcome === 'stale';
  const planChanged = plan.content_revision !== baseRevision;

  // Keep the draft; save against the plan as it is now.
  const loadLatest = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.plan(queryScope, plan.id) });
    if (!isCurrentGeneration(generation)) return;
    const latest = queryClient.getQueryData<PlanDetail>(queryKeys.plan(queryScope, plan.id));
    setBaseRevision(latest?.content_revision ?? plan.content_revision);
    save.reset();
  };

  const submit = () => {
    const found = validatePlanItemDraft(draft);
    setProblem(found ? new LocalizedError({ key: `plans:editItem.errors.${found}` }) : null);
    if (found || !dirty) return;
    save.mutate();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobileOrder.editScreenTitle') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        {planChanged && !stale ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('editItem.planChanged')}</Text>
        ) : null}

        <View style={styles.group}>
          <Label>{t('editItem.type')}</Label>
          <SegmentedControl<PlanItemType>
            options={PLAN_ITEM_TYPES.map((value) => ({ value, label: t(`itemKind.${value}`) }))}
            value={draft.itemType}
            onChange={(value) => set('itemType', value)}
          />
          {item.item_type === 'song' && !isSong ? <Text style={styles.caution}>{t('editItem.songWillBeRemoved')}</Text> : null}
        </View>

        <Field label={t('editItem.fieldTitle')} value={draft.title} onChangeText={(value) => set('title', value)} maxLength={200} />

        {isSong ? (
          <Card>
            <View style={styles.songLine}>
              <Text style={styles.flex}>
                <Text style={styles.muted}>{t('editItem.songLabel')} </Text>
                <Text style={styles.strong}>{song.data?.title ?? item.song?.title ?? t('editItem.noneChosen')}</Text>
              </Text>
              <Button
                title={changingSong ? t('editItem.keepSong') : t('editItem.changeSong')}
                variant="secondary"
                onPress={() => setChangingSong((open) => !open)}
              />
            </View>
            {changingSong ? (
              <View style={styles.group}>
                <Field
                  label={t('editItem.findSong')}
                  value={songQuery}
                  onChangeText={setSongQuery}
                  placeholder={t('editItem.searchPlaceholder')}
                  autoCorrect={false}
                />
                <ErrorNotice error={songs.error} />
                {(songs.data?.data ?? []).slice(0, 20).map((candidate) => (
                  <PressableScale
                    key={candidate.id}
                    accessibilityLabel={candidate.title}
                    onPress={() => {
                      setDraft((current) => withSong(current, candidate));
                      setChangingSong(false);
                    }}
                    pressedOpacity={0.6}
                    style={styles.pickRow}
                  >
                    <Text style={styles.body}>{candidate.title}</Text>
                  </PressableScale>
                ))}
              </View>
            ) : null}

            <View style={styles.group}>
              <Label>{t('editItem.arrangement')}</Label>
              {song.isLoading ? <Loading /> : null}
              <ErrorNotice error={song.error} />
              <View style={styles.chips}>
                <Chip
                  label={defaultArrangement ? t('editItem.songDefaultNamed', { name: defaultArrangement.name }) : t('editItem.songDefault')}
                  active={draft.arrangementId === null}
                  onPress={() => set('arrangementId', null)}
                />
              </View>
              <ArrangementPicker
                arrangements={arrangements}
                selectedId={draft.arrangementId}
                planArrangementId={item.arrangement_id}
                onSelect={(arrangementId) => set('arrangementId', arrangementId)}
              />
              {arrangementGone ? (
                <Text accessibilityRole="alert" style={styles.danger}>
                  {t('editItem.unavailableArrangement')} — {t('editItem.arrangementGone')}
                </Text>
              ) : null}
            </View>

            <View style={styles.group}>
              <Label>{t('editItem.serviceKey')}</Label>
              <KeyPicker
                value={draft.keyOverride}
                onChange={(value) => set('keyOverride', value)}
                label={t('editItem.serviceKey')}
                placeholder={chosenArrangement?.song_key ? t('editItem.arrangementKeyNamed', { key: chosenArrangement.song_key }) : t('editItem.arrangementKey')}
                resetLabel={t('editItem.useArrangementKey')}
              />
              {labeledKeys.data?.keys.length ? (
                <View style={styles.group}>
                  <Label>{t('editItem.labeledKey')}</Label>
                  <View style={styles.chips}>
                    {labeledKeys.data.keys.map((key) => (
                      <Chip
                        key={key.id}
                        label={labeledKeyText(key, (capo) => t('editItem.capo', { capo }))}
                        active={draft.keyOverride === key.song_key}
                        onPress={() => set('keyOverride', key.song_key)}
                      />
                    ))}
                  </View>
                </View>
              ) : null}
              <ErrorNotice error={labeledKeys.error} />
              <Text style={styles.hint}>
                {chosenArrangement?.song_key
                  ? t('editItem.planOnlyKeyHint', { key: chosenArrangement.song_key })
                  : t('editItem.planOnlyKeyHintOwnKey')}
              </Text>
            </View>

            <View style={styles.group}>
              <Label>{t('editItem.sequence')}</Label>
              <View style={styles.switchRow}>
                <Text style={[styles.body, styles.flex]}>
                  {chosenArrangement?.sequence.length
                    ? t('editItem.useArrangementSequence', { sequence: chosenArrangement.sequence.join(', ') })
                    : t('editItem.useArrangementSequenceNone')}
                </Text>
                <Switch
                  accessibilityLabel={t('editItem.sequence')}
                  value={draft.inheritSequence}
                  onValueChange={(inherit) => setDraft((current) => withInheritSequence(current, inherit, chosenArrangement?.sequence ?? []))}
                />
              </View>
              {!draft.inheritSequence ? (
                <>
                  <Field
                    accessibilityLabel={t('editItem.sequenceLabel')}
                    value={draft.sequence}
                    onChangeText={(value) => set('sequence', value)}
                    placeholder="Intro, V1, C, V2, C"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.hint}>{t('editItem.sequenceHelp')}</Text>
                  {sectionLabels.length ? (
                    <View style={styles.chips}>
                      {sectionLabels.map((label) => (
                        <Button key={label} title={`+ ${label}`} variant="secondary" onPress={() => set('sequence', appendSequenceStep(draft.sequence, label))} />
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          </Card>
        ) : null}

        {draft.itemType !== 'header' ? (
          <>
            <Field
              label={t('editItem.length')}
              value={draft.length}
              onChangeText={(value) => set('length', value)}
              placeholder="4:30"
              keyboardType="numbers-and-punctuation"
            />
            <View style={styles.group}>
              <Label>{t('editItem.when')}</Label>
              <View style={styles.chips}>
                {PLAN_ITEM_SEGMENTS.map((segment) => (
                  <Chip key={segment} label={t(`segment.${segment}`)} active={draft.segment === segment} onPress={() => set('segment', segment)} />
                ))}
              </View>
            </View>
            <Field
              label={t('editItem.description')}
              value={draft.description}
              onChangeText={(value) => set('description', value)}
              multiline
              maxLength={4000}
              style={styles.multiline}
            />

            <View style={styles.group}>
              <Label>{t('editItem.leader')}</Label>
              <View style={styles.chips}>
                {LEADER_MODES.map((mode) => (
                  <Chip key={mode} label={t(`editItem.leaderMode.${mode}`)} active={draft.leaderMode === mode} onPress={() => set('leaderMode', mode)} />
                ))}
              </View>
              {draft.leaderMode === 'person' ? (
                <View style={styles.group}>
                  <Field
                    accessibilityLabel={t('editItem.personWhoLeads')}
                    value={personQuery}
                    onChangeText={setPersonQuery}
                    placeholder={t('mobileOrder.searchPeople')}
                    autoCorrect={false}
                  />
                  {people.isLoading ? <Loading /> : null}
                  <ErrorNotice error={people.error} />
                  <View accessibilityRole="radiogroup" accessibilityLabel={t('editItem.personWhoLeads')} style={styles.chips}>
                    {leaderOffRoster ? (
                      <Chip label={item.leader_person?.full_name ?? t('editItem.currentLeader')} active onPress={() => undefined} />
                    ) : null}
                    {personChoices.map((choice) => (
                      <Chip key={choice.id} label={choice.label} active={draft.leaderPersonId === choice.id} onPress={() => set('leaderPersonId', choice.id)} />
                    ))}
                  </View>
                </View>
              ) : null}
              {draft.leaderMode === 'position' ? (
                <View style={styles.group}>
                  <ErrorNotice error={teams.error} />
                  <View accessibilityRole="radiogroup" accessibilityLabel={t('editItem.positionWhoLeads')} style={styles.chips}>
                    {positions.map((position) => (
                      <Chip key={position.id} label={position.label} active={draft.leaderPositionId === position.id} onPress={() => set('leaderPositionId', position.id)} />
                    ))}
                  </View>
                  <Text style={styles.hint}>{t('editItem.positionFollowsHint')}</Text>
                </View>
              ) : null}
            </View>
          </>
        ) : null}

        <Text style={styles.hint}>{t('mobileOrder.webOnlyHint')}</Text>

        <ErrorNotice error={problem} />
        {stale ? (
          <View accessibilityRole="alert" style={styles.staleBox}>
            <Text style={styles.body}>{t('editItem.stale')}</Text>
            <Button title={t('editItem.loadLatest')} variant="secondary" onPress={() => void loadLatest()} />
          </View>
        ) : outcome === 'uncertain' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileOrder.uncertain')}</Text>
        ) : (
          <ErrorNotice error={save.error} />
        )}

        {!dirty ? <Text style={styles.hint}>{t('editItem.noChanges')}</Text> : null}
        <Button title={t('common:actions.saveChanges')} onPress={submit} loading={save.isPending} disabled={!dirty || stale} />
        <Button title={t('common:actions.cancel')} variant="quiet" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    flex: { flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    strong: { ...theme.type.body, color: theme.color.ink, fontWeight: '600' },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    caution: { ...theme.type.bodySmall, color: theme.accent.yellow.fg },
    danger: { ...theme.type.bodySmall, color: theme.accent.red.fg },
    multiline: { minHeight: 88, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    songLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm, marginBottom: theme.space.md },
    pickRow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space.sm },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    warning: {
      ...theme.type.bodySmall,
      color: theme.accent.yellow.fg,
      backgroundColor: theme.accent.yellow.bg,
      padding: theme.space.sm,
      borderRadius: theme.radius.sm,
    },
    staleBox: {
      gap: theme.space.sm,
      padding: theme.space.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.accent.yellow.bg,
    },
  });
