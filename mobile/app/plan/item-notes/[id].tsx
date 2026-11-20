import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  LocalizedError,
  planNotesFor,
  type MentionCandidate,
  type PlanItemComment,
  type PlanItemDetail,
} from '@service-center/shared';
import { api } from '../../../src/lib/api';
import { newIdempotencyKey } from '../../../src/lib/idempotency';
import { queryKeys } from '../../../src/lib/query-keys';
import { commentNeedsNewId, mergeCommentPages, threadAccess } from '../../../src/lib/plan-notes-edit';
import { useAuth } from '../../../src/providers/AuthProvider';
import { NoteList } from '../../../src/components/PlanNotes';
import { MessageBody, MentionPicker, mentionsMe, useMentionInput } from '../../../src/components/mentions';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  IconWell,
  Loading,
  Screen,
  SectionHeader,
  screenPadding,
} from '../../../src/components/ui';
import { useErrorText, useFormatters } from '../../../src/i18n';
import { type Theme } from '../../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../../src/lib/useTheme';

/**
 * MOB-016: one item's notes and discussion — the website's item discussion
 * dialog. Notes come from `planNotes` (already limited to what this person
 * may read); the thread from `itemComments`, open to plan leaders and people
 * scheduled on the plan. Anyone else sees that it is not available to them,
 * never the comments.
 */
export default function ItemNotesScreen() {
  const { id, itemId } = useLocalSearchParams<{ id: string; itemId: string }>();
  const { t } = useTranslation(['messages', 'plans', 'common']);
  const { queryScope } = useAuth();

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
  if (!plan.data) {
    return (
      <Screen>
        <ErrorNotice error={plan.error} />
      </Screen>
    );
  }
  if (!item) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('mobileNotes.discussionTitle') }} />
        <EmptyState icon="alert" title={t('plans:mobileOrder.itemGone')} />
      </Screen>
    );
  }
  return <ItemNotes key={item.id} planId={plan.data.id} item={item} />;
}

interface ItemNotesProps {
  planId: string;
  item: PlanItemDetail;
}

function ItemNotes({ planId, item }: ItemNotesProps) {
  const { t } = useTranslation(['messages', 'common']);
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const notes = useQuery({
    queryKey: queryKeys.planNotes(queryScope, planId),
    queryFn: () => api.planNotes(planId),
    enabled: Boolean(queryScope),
  });
  const teams = useQuery({
    queryKey: queryKeys.teams(queryScope),
    queryFn: () => api.listTeams(),
    enabled: Boolean(queryScope),
  });
  const thread = useQuery({
    queryKey: queryKeys.itemComments(queryScope, item.id),
    queryFn: () => api.itemComments(item.id, { limit: 50 }),
    enabled: Boolean(queryScope),
    retry: false,
  });
  const access = thread.data ? 'open' : threadAccess(thread.error);
  const candidates = useQuery({
    queryKey: queryKeys.mentionCandidates(queryScope, planId),
    queryFn: () => api.mentionCandidates({ plan_id: planId }),
    enabled: Boolean(queryScope && thread.data),
    retry: false,
  });

  // Every comment shown so far; each re-read of the newest page is merged in.
  const [known, setKnown] = useState<PlanItemComment[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (thread.data) setKnown((current) => mergeCommentPages(current, thread.data.data));
  }, [thread.data]);
  const cursor = olderCursor === undefined ? (thread.data?.next_before ?? null) : olderCursor;

  const refreshThread = () => queryClient.invalidateQueries({ queryKey: queryKeys.itemComments(queryScope, item.id) });

  const loadOlder = useMutation({
    mutationFn: () => api.itemComments(item.id, { before: cursor ?? undefined, limit: 50 }),
    onSuccess: (page) => {
      if (!isCurrentGeneration(generation)) return;
      setKnown((current) => mergeCommentPages(current, page.data));
      setOlderCursor(page.next_before);
    },
  });
  const remove = useMutation({
    mutationFn: (comment: PlanItemComment) => api.deleteItemComment(item.id, comment.id),
    onSettled: () => (isCurrentGeneration(generation) ? refreshThread() : undefined),
  });

  const itemNotes = useMemo(() => planNotesFor(notes.data?.notes ?? [], item.id), [item.id, notes.data?.notes]);
  const teamChoices = useMemo(() => (teams.data ?? []).map((team) => ({ id: team.id, name: team.name })), [teams.data]);
  const canEditNotes = notes.data?.can_edit ?? false;

  const confirmDelete = (comment: PlanItemComment) =>
    Alert.alert(t('itemDiscussion.deleteConfirm'), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => remove.mutate(comment) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: t('mobileNotes.discussionTitle') }} />
      <ScrollView contentContainerStyle={[screenPadding(theme), styles.page]} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <IconWell name="chat" accent={theme.accent.blue} size={44} />
          <Text accessibilityRole="header" style={[styles.title, styles.flex]}>{t('itemDiscussion.title', { item: item.title })}</Text>
        </View>

        <View style={styles.section}>
          <SectionHeader
            title={t('itemDiscussion.itemNotes')}
            count={notes.isLoading || (notes.error && !notes.data) ? undefined : itemNotes.length}
            actionLabel={canEditNotes ? t('itemDiscussion.addNote') : undefined}
            onAction={canEditNotes
              ? () => router.push({ pathname: '/plan/note/[id]', params: { id: planId, itemId: item.id } })
              : undefined}
          />
          <Card>
            {notes.isLoading ? (
              <Loading />
            ) : notes.error && !notes.data ? (
              <View style={styles.group}>
                <ErrorNotice error={notes.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void notes.refetch()} />
              </View>
            ) : itemNotes.length === 0 ? (
              <Text style={styles.muted}>{t('itemDiscussion.noItemNotes')}</Text>
            ) : (
              <NoteList
                notes={itemNotes}
                categories={notes.data?.categories ?? []}
                teams={teamChoices}
                canEdit={canEditNotes}
                onEdit={(note) => router.push({ pathname: '/plan/note/[id]', params: { id: planId, noteId: note.id } })}
              />
            )}
          </Card>
        </View>

        <View style={styles.section}>
          <SectionHeader title={t('itemDiscussion.discussion')} count={access === 'open' ? known.length : undefined} />
          <Card>
            {thread.isLoading ? (
              <Loading />
            ) : access === 'unavailable' ? (
              <Text style={styles.muted}>{t('itemDiscussion.unavailable')}</Text>
            ) : access === 'error' ? (
              <View style={styles.group}>
                <ErrorNotice error={thread.error} />
                <Button title={t('common:actions.retry')} variant="secondary" onPress={() => void thread.refetch()} />
              </View>
            ) : (
              <View style={styles.group}>
                {cursor ? (
                  <Button
                    title={t('itemDiscussion.showOlder')}
                    variant="quiet"
                    loading={loadOlder.isPending}
                    onPress={() => loadOlder.mutate()}
                  />
                ) : null}
                {known.length === 0 ? (
                  <Text style={styles.muted}>{t('itemDiscussion.noComments')}</Text>
                ) : (
                  known.map((comment) => (
                    <CommentEntry
                      key={comment.id}
                      itemId={item.id}
                      comment={comment}
                      canDelete={!comment.deleted_at && (comment.is_mine || Boolean(thread.data?.can_moderate))}
                      onDelete={() => confirmDelete(comment)}
                      onEdited={refreshThread}
                    />
                  ))
                )}
                <ErrorNotice error={remove.error ?? loadOlder.error} />
                <CommentComposer itemId={item.id} candidates={candidates.data ?? []} onPosted={refreshThread} />
                <Text style={styles.hint}>{t('itemDiscussion.mentionNote')}</Text>
              </View>
            )}
          </Card>
        </View>
      </ScrollView>
    </Screen>
  );
}

interface CommentEntryProps {
  itemId: string;
  comment: PlanItemComment;
  canDelete: boolean;
  onDelete: () => void;
  onEdited: () => Promise<unknown>;
}

/** One comment: author, time, text (or "deleted"), mention outcomes for its author, edit/delete. */
function CommentEntry({ itemId, comment, canDelete, onDelete, onEdited }: CommentEntryProps) {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const edit = useMutation({
    mutationFn: () => api.editItemComment(itemId, comment.id, { body: draft.trim() }),
    onSuccess: async () => {
      await onEdited();
      setEditing(false);
    },
  });

  const removed = Boolean(comment.deleted_at);
  const unnotified = comment.is_mine ? comment.mentions.flatMap((mention) =>
    mention.resolution === 'notified' ? [] : [{ name: mention.name, resolution: mention.resolution }]) : [];
  const when = comment.edited_at && !removed
    ? t('entry.edited', { time: format.dateTime(comment.created_at) })
    : format.dateTime(comment.created_at);

  return (
    <View style={[styles.entry, !removed && mentionsMe(comment.mentions) && styles.entryForMe]}>
      <Avatar name={comment.author_name ?? t('common:fallback.someone')} size={32} />
      <View style={styles.entryBody}>
        <Text style={styles.entryTop}>
          <Text style={styles.author}>{comment.author_name ?? t('common:fallback.someone')}</Text>
          <Text style={styles.hint}>{`  ${when}`}</Text>
        </Text>
        {removed ? (
          <Text style={styles.removed}>{t('itemDiscussion.commentDeleted')}</Text>
        ) : editing ? (
          <View style={styles.group}>
            <Field
              accessibilityLabel={t('common:actions.edit')}
              value={draft}
              onChangeText={setDraft}
              multiline
              maxLength={4000}
              style={styles.multiline}
            />
            <ErrorNotice error={edit.error} />
            <View style={styles.row}>
              <Button title={t('common:actions.save')} variant="secondary" loading={edit.isPending} disabled={!draft.trim()} onPress={() => edit.mutate()} />
              <Button
                title={t('common:actions.cancel')}
                variant="quiet"
                onPress={() => {
                  setEditing(false);
                  setDraft(comment.body);
                  edit.reset();
                }}
              />
            </View>
          </View>
        ) : (
          <MessageBody text={comment.body} mentions={comment.mentions} style={styles.body} />
        )}
        {!removed && unnotified.length ? (
          <Text style={styles.hint}>
            {unnotified
              .map((mention) => t('entry.mentionOutcome', { name: mention.name, outcome: t(`entry.resolution.${mention.resolution}`) }))
              .join(' · ')}
          </Text>
        ) : null}
        {!removed && !editing && (comment.is_mine || canDelete) ? (
          <View style={styles.row}>
            {comment.is_mine ? <Button title={t('common:actions.edit')} variant="quiet" onPress={() => setEditing(true)} /> : null}
            {canDelete ? <Button title={t('common:actions.delete')} variant="quiet" onPress={onDelete} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface CommentComposerProps {
  itemId: string;
  candidates: readonly MentionCandidate[];
  onPosted: () => Promise<unknown>;
}

/**
 * Text box with `@` mentions, like the website composer: typing `@` (or the
 * `@` button) opens a picker, and Return sends (or picks the top match). The
 * draft keeps one client id until the server confirms it, so sending again
 * after no answer cannot post a second copy; the text survives a failed send.
 */
function CommentComposer({ itemId, candidates, onPosted }: CommentComposerProps) {
  const { t } = useTranslation(['messages', 'common']);
  const { generation, isCurrentGeneration } = useAuth();
  const errorText = useErrorText();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const draftId = useRef(newIdempotencyKey());
  const [body, setBody] = useState('');
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  const mention = useMentionInput({
    text: body,
    onChangeText: setBody,
    candidates,
    pickedIds,
    onPicked: (personId) => setPickedIds((current) => [...current, personId]),
  });

  const post = useMutation({
    mutationFn: () => {
      const text = body.trim();
      return api.postItemComment(itemId, { id: draftId.current, body: text, mention_person_ids: mention.mentionIds(text) });
    },
    onSuccess: async () => {
      if (!isCurrentGeneration(generation)) return;
      draftId.current = newIdempotencyKey();
      setBody('');
      setPickedIds([]);
      await onPosted();
    },
    onError: (error) => {
      if (commentNeedsNewId(error)) draftId.current = newIdempotencyKey();
    },
  });
  const send = () => {
    if (body.trim() && !post.isPending) post.mutate();
  };

  return (
    <View style={styles.group}>
      <MentionPicker picker={mention.picker} />
      <TextInput
        {...mention.inputProps}
        ref={mention.inputRef}
        // NativeWind's interop drops this TextInput's ref; it is styled with StyleSheet anyway.
        cssInterop={false}
        accessibilityLabel={t('itemDiscussion.placeholder')}
        placeholder={t('itemDiscussion.placeholder')}
        placeholderTextColor={theme.color.inkFaint}
        multiline
        submitBehavior="submit"
        returnKeyType="send"
        onSubmitEditing={() => {
          if (!mention.pickTopMatch()) send();
        }}
        maxLength={4000}
        style={styles.composer}
      />
      {post.error ? (
        <ErrorNotice error={new LocalizedError({ key: 'messages:composer.notSent', values: { reason: errorText(post.error) } })} />
      ) : null}
      <View style={styles.row}>
        <Button title="@" accessibilityLabel={t('composer.mentionLabel')} variant="quiet" onPress={mention.startMention} />
        <View style={styles.flex} />
        <Button
          title={post.error ? t('common:actions.retry') : t('itemDiscussion.submit')}
          loading={post.isPending}
          disabled={!body.trim()}
          onPress={send}
        />
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    page: { gap: theme.space.xl },
    section: { gap: theme.space.md },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
    group: { gap: theme.space.sm },
    flex: { flex: 1 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space.md },
    title: { ...theme.type.title, color: theme.color.ink },
    body: { ...theme.type.body, color: theme.color.ink },
    muted: { ...theme.type.bodySmall, color: theme.color.inkMuted },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    removed: { ...theme.type.body, color: theme.color.inkFaint, fontStyle: 'italic' },
    author: { ...theme.type.bodySmall, color: theme.color.ink, fontWeight: '600' },
    entry: { flexDirection: 'row', gap: theme.space.md, paddingVertical: theme.space.sm },
    entryForMe: { borderLeftWidth: 4, borderLeftColor: theme.accent.yellow.fg, paddingLeft: theme.space.sm },
    entryBody: { flex: 1, gap: theme.space.xs },
    entryTop: { flexWrap: 'wrap' },
    multiline: { minHeight: 88, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    composer: {
      ...theme.type.body,
      color: theme.color.ink,
      minHeight: 88,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.field,
      padding: theme.space.md,
    },
  });
