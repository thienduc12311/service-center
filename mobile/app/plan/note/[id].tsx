import { useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  NOTE_AUDIENCES,
  noteCategoryLabel,
  noteTeamNames,
  planNoteDraftChanged,
  planNoteDraftFrom,
  planNoteLeavesSimple,
  planNoteRequest,
  toggleNoteTeam,
  validatePlanNoteDraft,
  withNoteCategory,
  type PlanDetail,
  type PlanNote,
  type PlanNoteDraft,
  type PlanNotesResponse,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { queryKeys } from '../../../src/lib/query-keys';
import { draftWithoutWithdrawnCategory, noteWriteOutcome, type NoteWriteOutcome } from '../../../src/lib/plan-notes-edit';
import { useDiscardGuard } from '../../../src/lib/useDiscardGuard';
import { useAuth } from '../../../src/providers/AuthProvider';
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
} from '../../../src/components/ui';
import type { NoteTeam } from '../../../src/components/PlanNotes';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/**
 * MOB-016: add or edit one F09 note — the website's note editor. A new note
 * is filed on the plan, or on the item it was opened from; an edit sends the
 * revision it opened, so someone else's change is never overwritten without
 * the person seeing it first. Who can read the note is decided by the server
 * (RLS); this screen only describes the audience being chosen.
 */
export default function PlanNoteScreen() {
  const { id, noteId, itemId } = useLocalSearchParams<{ id: string; noteId?: string; itemId?: string }>();
  const { t } = useTranslation(['messages', 'plans', 'templates', 'common']);
  const { can, queryScope } = useAuth();

  const plan = useQuery({
    queryKey: queryKeys.plan(queryScope, id),
    queryFn: () => api.getPlan(id!),
    enabled: Boolean(id && queryScope),
  });
  const notes = useQuery({
    queryKey: queryKeys.planNotes(queryScope, id),
    queryFn: () => api.planNotes(id!),
    enabled: Boolean(id && queryScope),
  });

  // Decided once, when the editor opens: a later re-read that no longer
  // holds the note (deleted, or no longer readable) must not throw the
  // typed text away — the form says so and offers to save it as a new note.
  const opened = useRef<OpenedNote | null>(null);
  if (!opened.current && plan.data && notes.data) {
    const note = noteId ? (notes.data.notes.find((candidate) => candidate.id === noteId) ?? null) : null;
    const planItemId = note ? note.plan_item_id : (itemId ?? null);
    opened.current = {
      note,
      planItemId,
      missing: Boolean(noteId && !note),
      itemMissing: Boolean(planItemId && !plan.data.items.some((item) => item.id === planItemId)),
      // Both the capability and the server's own answer for this plan.
      canEdit: can('plans.edit', { serviceTypeId: plan.data.service_type_id }) && notes.data.can_edit,
    };
  }

  if (!opened.current || !plan.data || !notes.data) {
    return (
      <Screen>
        {plan.error || notes.error ? <ErrorNotice error={plan.error ?? notes.error} /> : <Loading />}
      </Screen>
    );
  }
  const { note, planItemId, missing, itemMissing, canEdit } = opened.current;
  if (!canEdit) {
    return (
      <Screen>
        <EmptyState title={t('templates:generate.noAccess')} />
      </Screen>
    );
  }
  if (missing || itemMissing) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('mobileNotes.screenTitle') }} />
        <EmptyState title={missing ? t('noteEditor.gone') : t('plans:mobileOrder.itemGone')} />
      </Screen>
    );
  }
  return <NoteForm plan={plan.data} notes={notes.data} note={note} planItemId={planItemId} />;
}

/** What the editor found when it opened. */
interface OpenedNote {
  note: PlanNote | null;
  planItemId: string | null;
  missing: boolean;
  itemMissing: boolean;
  canEdit: boolean;
}

interface NoteFormProps {
  plan: PlanDetail;
  notes: PlanNotesResponse;
  /** Null creates a note. */
  note: PlanNote | null;
  planItemId: string | null;
}

function NoteForm({ plan, notes, note, planItemId }: NoteFormProps) {
  const { t } = useTranslation(['messages', 'plans', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const [draft, setDraft] = useState<PlanNoteDraft>(() => planNoteDraftFrom(note, planItemId));
  // The revision a save is checked against; moves forward only when the
  // person chooses to save over a newer copy they have seen.
  const [baseRevision, setBaseRevision] = useState<number | null>(note?.revision ?? null);
  // Set when the note was deleted (or became unreadable) while open: the text can still be saved as a new note.
  const [asNew, setAsNew] = useState(false);
  const [problem, setProblem] = useState<LocalizedError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // True while a failed save re-reads the notes, so the result shown is the server's latest.
  const [rereading, setRereading] = useState(false);

  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const teamChoices: NoteTeam[] = useMemo(
    () => (teams.data ?? []).map((team) => ({ id: team.id, name: team.name })),
    [teams.data],
  );

  const editing = note && !asNew ? note : null;
  const dirty = planNoteDraftChanged(draft, editing);
  const guard = useDiscardGuard({
    dirty,
    message: t('mobileNotes.discardConfirm'),
    keepLabel: t('plans:mobileOrder.keepEditing'),
    discardLabel: t('plans:mobileOrder.discard'),
  });

  const refreshNotes = () => queryClient.invalidateQueries({ queryKey: queryKeys.planNotes(queryScope, plan.id) });
  const latestNotes = () => queryClient.getQueryData<PlanNotesResponse>(queryKeys.planNotes(queryScope, plan.id));

  const afterFailure = async (outcome: NoteWriteOutcome) => {
    // Every failure re-reads the notes: a stale save shows the newer copy, a
    // lost answer shows whether it landed, a refusal may be a withdrawn category.
    setRereading(true);
    try {
      await refreshNotes();
    } finally {
      if (isCurrentGeneration(generation)) setRereading(false);
    }
    if (!isCurrentGeneration(generation)) return;
    const latest = latestNotes();
    if (outcome === 'refused' && latest) {
      const fixed = draftWithoutWithdrawnCategory(draft, editing, latest.categories);
      if (fixed) {
        setDraft(fixed);
        setNotice(t('mobileNotes.categoryGone'));
      }
    }
  };

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.updatePlanNote(plan.id, editing.id, planNoteRequest(draft, editing, baseRevision))
        : api.createPlanNote(plan.id, planNoteRequest(draft, null)),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshNotes();
      guard.leave();
    },
    onError: (error) => {
      if (isCurrentGeneration(generation)) void afterFailure(noteWriteOutcome(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deletePlanNote(plan.id, editing!.id, baseRevision ?? editing!.revision),
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      await refreshNotes();
      guard.leave();
    },
    onError: (error) => {
      if (isCurrentGeneration(generation)) void afterFailure(noteWriteOutcome(error));
    },
  });

  const failure = save.error ?? remove.error;
  const outcome = failure && !rereading ? noteWriteOutcome(failure) : null;
  // The copy on the server now, after a stale or lost save re-read it.
  const latest = editing ? (notes.notes.find((candidate) => candidate.id === editing.id) ?? null) : null;
  const gone = outcome === 'gone' || (outcome === 'stale' && editing !== null && latest === null);

  const submit = () => {
    const found = validatePlanNoteDraft(draft);
    setProblem(found ? new LocalizedError({ key: `messages:noteEditor.errors.${found}` }) : null);
    if (found) return;
    setNotice(null);
    remove.reset();
    save.mutate();
  };

  const saveOverLatest = () => {
    if (!latest) return;
    setBaseRevision(latest.revision);
    save.reset();
  };

  const saveAsNewNote = () => {
    setAsNew(true);
    setBaseRevision(null);
    save.reset();
    remove.reset();
  };

  const confirmDelete = () =>
    Alert.alert(t('noteEditor.deleteConfirm'), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      {
        text: t('common:actions.delete'),
        style: 'destructive',
        onPress: () => {
          save.reset();
          remove.mutate();
        },
      },
    ]);

  const item = draft.planItemId ? plan.items.find((candidate) => candidate.id === draft.planItemId) : null;
  const current = noteCategoryLabel(draft.categoryId, notes.categories);
  const chosenTeams = noteTeamNames(draft.teamIds, teamChoices);
  const audienceDetail = draft.audience === 'teams'
    ? chosenTeams.length
      ? t('noteEditor.audienceDetail.teams', { teams: chosenTeams.join(', ') })
      : t('noteEditor.audienceDetail.teamsNone')
    : t(`noteEditor.audienceDetail.${draft.audience}`);
  const title = editing ? t('noteEditor.editTitle') : draft.planItemId ? t('noteEditor.addItemTitle') : t('noteEditor.addPlanTitle');

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.form]} keyboardShouldPersistTaps="handled">
        <Text style={styles.context}>
          {item ? t('noteEditor.onItem', { item: item.title, plan: plan.title }) : t('noteEditor.onPlan', { plan: plan.title })}
        </Text>
        {editing?.is_legacy ? (
          <Text style={planNoteLeavesSimple(editing, draft) ? styles.warning : styles.hint}>{t('noteEditor.simpleNoteHint')}</Text>
        ) : null}

        <View style={styles.group}>
          <Label>{t('noteEditor.category')}</Label>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('noteEditor.category')} style={styles.chips}>
            <Chip
              label={t('noteEditor.general')}
              active={draft.categoryId === null}
              onPress={() => setDraft((value) => withNoteCategory(value, null, notes.categories, !editing))}
            />
            {current.kind === 'unavailable' ? (
              <Chip label={t('noteEditor.categoryUnavailable')} active onPress={() => undefined} />
            ) : null}
            {notes.categories.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                active={draft.categoryId === category.id}
                onPress={() => setDraft((value) => withNoteCategory(value, category.id, notes.categories, !editing))}
              />
            ))}
          </View>
        </View>

        <View style={styles.group}>
          <Label>{t('noteEditor.whoCanRead')}</Label>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('noteEditor.whoCanRead')} style={styles.chips}>
            {NOTE_AUDIENCES.map((audience) => (
              <Chip
                key={audience}
                label={t(`noteEditor.audience.${audience}`)}
                active={draft.audience === audience}
                onPress={() => setDraft((value) => ({ ...value, audience }))}
              />
            ))}
          </View>
          {draft.audience === 'teams' ? (
            <View style={styles.group}>
              <Label>{t('noteEditor.teams')}</Label>
              {teams.isLoading ? <Loading /> : null}
              <ErrorNotice error={teams.error} />
              <View style={styles.chips}>
                {teamChoices.map((team) => (
                  <Chip
                    key={team.id}
                    label={team.name}
                    active={draft.teamIds.includes(team.id)}
                    onPress={() => setDraft((value) => toggleNoteTeam(value, team.id))}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <Card compact>
            <Text accessibilityLiveRegion="polite" style={styles.body}>{audienceDetail}</Text>
            <Text style={styles.hint}>{t('noteEditor.audienceHint')}</Text>
          </Card>
        </View>

        <Field
          label={t('noteEditor.note')}
          value={draft.body}
          onChangeText={(body) => setDraft((value) => ({ ...value, body }))}
          placeholder={t('noteEditor.placeholder')}
          multiline
          maxLength={8000}
          style={styles.multiline}
        />

        <ErrorNotice error={problem} />
        {notice ? <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text> : null}
        {gone ? (
          <View accessibilityRole="alert" style={styles.staleBox}>
            <Text style={styles.body}>{t('noteEditor.gone')}</Text>
            <Button title={t('noteEditor.saveAsNew')} variant="secondary" onPress={saveAsNewNote} />
          </View>
        ) : outcome === 'stale' && latest ? (
          <View accessibilityRole="alert" style={styles.staleBox}>
            <Text style={styles.body}>{t('noteEditor.stale')}</Text>
            <Label>{t('noteEditor.latestVersion')}</Label>
            <Text style={styles.hint}>
              {t(`notesPanel.audienceShort.${latest.audience}`)}
              {latest.audience === 'teams' && latest.team_ids.length ? ` · ${noteTeamNames(latest.team_ids, teamChoices).join(', ')}` : ''}
            </Text>
            <Text selectable style={styles.body}>{latest.body}</Text>
            <Button title={t('noteEditor.keepMine')} variant="secondary" onPress={saveOverLatest} />
          </View>
        ) : outcome === 'uncertain' ? (
          <Text accessibilityRole="alert" style={styles.warning}>{t('mobileNotes.uncertain')}</Text>
        ) : outcome === 'refused' && !notice ? (
          <ErrorNotice error={failure} />
        ) : null}

        <Button
          title={t('noteEditor.save')}
          onPress={submit}
          loading={save.isPending}
          disabled={remove.isPending || rereading || (outcome === 'stale' && !gone) || gone || (editing !== null && !dirty)}
        />
        {editing && !gone ? (
          <Button title={t('common:actions.delete')} variant="quiet" loading={remove.isPending} disabled={save.isPending} onPress={confirmDelete} />
        ) : null}
        <Button title={t('common:actions.cancel')} variant="quiet" onPress={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    form: { gap: theme.space.lg },
    group: { gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    context: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    body: { ...theme.type.body, color: theme.color.ink },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    multiline: { minHeight: 140, paddingTop: theme.space.sm, textAlignVertical: 'top' },
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
