import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CONVERSATION_PAGE_SIZE,
  CONVERSATION_SEARCH_MIN,
  CONVERSATION_THREAD_POLL_MS,
  LocalizedError,
  conversationAccess,
  conversationMessageActions,
  conversationMessageState,
  conversationPostOutcome,
  conversationReadMark,
  mergeConversationPages,
  type ConversationMessage,
  type ConversationReport,
  type ConversationReportReason,
  type ConversationSummary,
  type DiscussionMention,
  type MentionCandidate,
  type MentionResolution,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { queryKeys } from '../../src/lib/query-keys';
import { conversationDrafts, type ConversationDraft } from '../../src/lib/conversation-drafts';
import { conversationTitle } from '../../src/lib/conversation-labels';
import { useScreenVisible } from '../../src/lib/useScreenVisible';
import { useAuth } from '../../src/providers/AuthProvider';
import {
  Avatar,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorNotice,
  Field,
  Label,
  Loading,
  Screen,
  Tag,
} from '../../src/components/ui';
import { useErrorText, useFormatters } from '../../src/i18n';
import { type Theme } from '../../src/lib/theme';
import { useTheme, useThemedStyles } from '../../src/lib/useTheme';

const REPORT_REASONS: readonly ConversationReportReason[] = ['spam', 'harassment', 'inappropriate', 'safety', 'other'];

/** Distance from the bottom (pt) still counted as "reading the newest messages". */
const BOTTOM_SLOP = 48;

/** A mention its author should know did not notify anyone. */
interface UnnotifiedMention extends DiscussionMention {
  resolution: Exclude<MentionResolution, 'notified'>;
}

/** What the composer tells the person after a send attempt. */
type SendNotice = 'uncertain' | 'rateLimited' | 'gone' | 'replyGone' | 'alreadySent';

const emptyDraft = (): ConversationDraft => ({ id: newIdempotencyKey(), body: '', mentionIds: [], replyToId: null });

/**
 * MOB-019: one team or plan conversation — the website's chat thread.
 * Everything is read through the authenticated API (polled while visible,
 * like the website); a 404/403 at any time means this person is no longer a
 * participant, and the thread is dropped from the screen.
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { queryScope } = useAuth();
  // A new account, organization or session generation starts from nothing.
  const identity = queryScope ? `${queryScope.userId}:${queryScope.organizationId}:${queryScope.generation}` : 'signed-out';
  if (!id || !queryScope) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  return <ConversationThread key={`${identity}:${id}`} conversationId={id} />;
}

interface ConversationThreadProps {
  conversationId: string;
}

function ConversationThread({ conversationId }: ConversationThreadProps) {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const router = useRouter();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { queryScope, generation, isCurrentGeneration } = useAuth();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const visible = useScreenVisible();
  const scrollRef = useRef<ScrollView>(null);

  const detail = useQuery({
    queryKey: queryKeys.conversation(queryScope, conversationId),
    queryFn: () => api.getConversation(conversationId),
    enabled: Boolean(queryScope),
    retry: false,
    refetchInterval: visible ? CONVERSATION_THREAD_POLL_MS : false,
  });
  // The latest answer decides: an earlier copy is not shown once access is gone.
  const access = conversationAccess(detail.error);
  const conversation = access === 'unavailable' ? null : detail.data?.conversation ?? null;

  const candidates = useQuery({
    queryKey: queryKeys.conversationMentionCandidates(queryScope, conversationId),
    queryFn: () => api.mentionCandidates({ conversation_id: conversationId }),
    enabled: Boolean(queryScope && conversation),
    retry: false,
  });

  // Every message shown so far (oldest first); each re-read of the newest page is merged in.
  const [known, setKnown] = useState<ConversationMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (detail.data && !detail.error) setKnown((current) => mergeConversationPages(current, detail.data.messages.data));
  }, [detail.data, detail.error]);
  useEffect(() => {
    if (access !== 'unavailable') return;
    setKnown([]);
    // The list drops it too, without waiting for its next poll.
    if (isCurrentGeneration(generation)) void queryClient.invalidateQueries({ queryKey: queryKeys.conversationList(queryScope) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access]);
  const cursor = olderCursor === undefined ? (detail.data?.messages.next_before ?? null) : olderCursor;
  const byId = useMemo(() => new Map(known.map((message) => [message.id, message])), [known]);
  const mergeOne = (message: ConversationMessage) => setKnown((current) => mergeConversationPages(current, [message]));

  const refresh = () =>
    isCurrentGeneration(generation)
      ? queryClient.invalidateQueries({ queryKey: queryKeys.conversationsAll(queryScope) })
      : Promise.resolve();

  // ---------------------------------------------------------------- search --
  const [search, setSearch] = useState('');
  const term = search.trim();
  const searching = term.length >= CONVERSATION_SEARCH_MIN;
  const results = useQuery({
    queryKey: queryKeys.conversationSearch(queryScope, conversationId, term),
    queryFn: () => api.conversationMessages(conversationId, { q: term, limit: CONVERSATION_PAGE_SIZE }),
    enabled: Boolean(queryScope && conversation && searching),
    retry: false,
  });

  // ------------------------------------------------- scrolling + read state --
  // The read position moves only to the newest message actually on screen:
  // decided from layout/scroll measurements of what was rendered (never from
  // a render that has not been laid out yet), and not while searching, on
  // another screen or with the app in the background.
  const lastMarked = useRef<string | null>(null);
  const markRead = useMutation({
    mutationFn: (readAt: string) => api.markConversationRead(conversationId, readAt),
    onSuccess: () => void refresh(),
    onError: () => {
      lastMarked.current = null;
    },
  });
  const rendered = useRef<readonly ConversationMessage[]>([]);
  rendered.current = known;
  /** The messages included in the last measured content size. */
  const laidOut = useRef<readonly ConversationMessage[]>([]);
  const reading = useRef({ visible, searching, unread: 0, open: false });
  reading.current = { visible, searching, unread: conversation?.unread_count ?? 0, open: Boolean(conversation) };
  const metrics = useRef({ offset: 0, viewport: 0, content: 0 });
  /** What the last measurement saw: whether the end was on screen, and which messages were laid out. */
  const measured = useRef<{ atBottom: boolean; shown: readonly ConversationMessage[] }>({ atBottom: false, shown: [] });
  const tryMarkRead = () => {
    const state = reading.current;
    if (!state.visible || state.searching || !state.open || !measured.current.atBottom) return;
    const mark = conversationReadMark(measured.current.shown, state.unread, lastMarked.current);
    if (!mark) return;
    lastMarked.current = mark;
    markRead.mutate(mark);
  };
  const measure = () => {
    const { offset, viewport, content } = metrics.current;
    measured.current = {
      atBottom: viewport > 0 && content > 0 && offset + viewport >= content - BOTTOM_SLOP,
      shown: laidOut.current,
    };
    tryMarkRead();
  };
  useEffect(tryMarkRead, [visible, searching, conversation?.unread_count]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Keep the newest message in view as content arrives, until the person drags up into history. */
  const follow = useRef(true);
  const scrollToNewest = () =>
    setTimeout(() => {
      const { viewport, content } = metrics.current;
      if (viewport > 0 && content > viewport) scrollRef.current?.scrollTo({ y: content - viewport, animated: false });
    }, 0);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metrics.current = { offset: contentOffset.y, viewport: layoutMeasurement.height, content: contentSize.height };
    measure();
  };
  const onDragEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    follow.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - BOTTOM_SLOP;
  };

  // ------------------------------------------------------------ moderation --
  const loadOlder = useMutation({
    mutationFn: () => api.conversationMessages(conversationId, { before: cursor ?? undefined, limit: CONVERSATION_PAGE_SIZE }),
    onSuccess: (page) => {
      if (!isCurrentGeneration(generation)) return;
      setKnown((current) => mergeConversationPages(current, page.data));
      setOlderCursor(page.next_before);
    },
  });
  const mute = useMutation({
    mutationFn: (muted: boolean) => api.muteConversation(conversationId, muted),
    onSettled: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (message: ConversationMessage) => api.deleteConversationMessage(conversationId, message.id),
    onSuccess: (message) => (isCurrentGeneration(generation) ? mergeOne(message) : undefined),
    onSettled: () => void refresh(),
  });
  const restore = useMutation({
    mutationFn: (message: ConversationMessage) => api.restoreConversationMessage(conversationId, message.id),
    onSuccess: (message) => (isCurrentGeneration(generation) ? mergeOne(message) : undefined),
    onSettled: () => void refresh(),
  });
  const resolve = useMutation({
    mutationFn: (input: { report: ConversationReport; action: 'dismiss' | 'hide' }) =>
      api.resolveConversationReport(conversationId, input.report.id, { action: input.action }),
    onSuccess: (report, input) => {
      if (!isCurrentGeneration(generation) || input.action !== 'hide') return;
      // The message may be on an older page that is not re-read; show what the server did.
      const shown = byId.get(report.message_id);
      if (shown && !shown.hidden_at) mergeOne({ ...shown, body: '', hidden_at: report.resolved_at ?? new Date().toISOString() });
    },
    onSettled: () => void refresh(),
  });
  const [reportingId, setReportingId] = useState<string | null>(null);
  // Only a pull shows the spinner; background polls refresh silently.
  const [pulling, setPulling] = useState(false);

  const confirmDelete = (message: ConversationMessage) =>
    Alert.alert(t('conversation.deleteConfirm'), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => remove.mutate(message) },
    ]);

  // ----------------------------------------------------------------- draft --
  const [draft, setDraft] = useState<ConversationDraft>(() => conversationDrafts.get(queryScope, conversationId) ?? emptyDraft());
  useEffect(() => conversationDrafts.set(queryScope, conversationId, draft), [conversationId, draft, queryScope]);
  const replyTo = draft.replyToId ? byId.get(draft.replyToId) ?? null : null;

  if (detail.isLoading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!conversation) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('chatPage.title') }} />
        {access === 'unavailable' ? (
          <EmptyState
            title={t('conversation.notAvailableTitle')}
            description={t('conversation.notAvailableDescription')}
            action={<Button title={t('mobileChat.notAvailableAction')} variant="secondary" onPress={() => router.replace('/chat')} />}
          />
        ) : (
          <EmptyState
            title={t('mobileChat.refreshFailed')}
            action={<Button title={t('common:actions.retry')} variant="secondary" onPress={() => void detail.refetch()} />}
          />
        )}
      </Screen>
    );
  }

  const reports = detail.data?.reports ?? [];
  const shown = searching ? results.data?.data ?? [] : known;
  const title = conversationTitle(conversation, t, format);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
      >
        {/* No className here; opting out of NativeWind's wrapper keeps the ref (scrollTo) working. */}
        <ScrollView
          cssInterop={false}
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          onScrollEndDrag={onDragEnd}
          onMomentumScrollEnd={onDragEnd}
          scrollEventThrottle={100}
          onLayout={(event) => {
            metrics.current.viewport = event.nativeEvent.layout.height;
            if (follow.current && !searching) scrollToNewest();
            measure();
          }}
          onContentSizeChange={(_width, height) => {
            metrics.current.content = height;
            laidOut.current = rendered.current;
            if (follow.current && !searching) scrollToNewest();
            measure();
          }}
          refreshControl={
            <RefreshControl
              refreshing={pulling}
              onRefresh={async () => {
                setPulling(true);
                await detail.refetch();
                if (isCurrentGeneration(generation)) setPulling(false);
              }}
            />
          }
        >
          <View style={styles.toolbar}>
            <Tag label={t(`conversation.kinds.${conversation.kind}`)} accent={theme.accent.neutral} />
            {conversation.plan_id ? (
              <Button title={t('conversation.openPlan')} variant="quiet" onPress={() => router.push(`/plan/${conversation.plan_id}`)} />
            ) : null}
            <View style={styles.flex} />
            <Button
              title={conversation.muted ? t('conversation.unmute') : t('conversation.mute')}
              variant="secondary"
              loading={mute.isPending}
              onPress={() => mute.mutate(!conversation.muted)}
            />
          </View>
          <Text style={styles.hint}>
            {conversation.muted ? t('mobileChat.mutedNote') : t('mobileChat.everyoneNotified')}
          </Text>
          <Text style={styles.hint}>{t('conversation.privacyNote')}</Text>
          {detail.error ? <ErrorNotice error={new LocalizedError({ key: 'messages:mobileChat.refreshFailed' })} /> : null}

          <View style={styles.searchRow}>
            <Field
              accessibilityLabel={t('conversation.searchLabel')}
              placeholder={t('conversation.searchPlaceholder')}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              containerStyle={styles.flex}
            />
            {search ? <Button title={t('mobileChat.clearSearch')} variant="quiet" onPress={() => setSearch('')} /> : null}
          </View>

          {conversation.can_moderate && reports.length > 0 ? (
            <Card>
              <Label>{t('conversation.reportsHeading', { count: reports.length })}</Label>
              {reports.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  busy={resolve.isPending && resolve.variables?.report.id === report.id}
                  onResolve={(action) => resolve.mutate({ report, action })}
                />
              ))}
            </Card>
          ) : null}

          <ErrorNotice error={remove.error ?? restore.error ?? resolve.error ?? mute.error ?? loadOlder.error ?? results.error} />

          {searching ? (
            results.isLoading ? (
              <Loading />
            ) : (
              <Text style={styles.hint}>
                {shown.length ? t('mobileChat.searchResults', { count: shown.length }) : t('conversation.noMatches')}
              </Text>
            )
          ) : cursor ? (
            <Button
              title={t('mobileChat.showOlder')}
              variant="quiet"
              loading={loadOlder.isPending}
              onPress={() => {
                follow.current = false;
                loadOlder.mutate();
              }}
            />
          ) : known.length ? (
            <Text style={styles.hint}>{t('mobileChat.allLoaded')}</Text>
          ) : null}

          {!searching && known.length === 0 ? <Text style={styles.empty}>{t('conversation.noMessages')}</Text> : null}

          {shown.map((message) => (
            <MessageEntry
              key={message.id}
              conversationId={conversationId}
              conversation={conversation}
              message={message}
              parent={message.reply_to_id ? byId.get(message.reply_to_id) ?? null : null}
              reporting={reportingId === message.id}
              onReply={() => setDraft((current) => ({ ...current, replyToId: message.id }))}
              onReport={() => setReportingId((current) => (current === message.id ? null : message.id))}
              onDelete={() => confirmDelete(message)}
              onRestore={() => restore.mutate(message)}
              onEdited={mergeOne}
              onReportClosed={() => setReportingId(null)}
            />
          ))}
        </ScrollView>

        <Composer
          conversationId={conversationId}
          conversation={conversation}
          candidates={candidates.data ?? []}
          known={known}
          draft={draft}
          setDraft={setDraft}
          replyTo={replyTo}
          onPosted={(message) => {
            mergeOne(message);
            follow.current = true;
            setSearch('');
            void refresh();
          }}
          onFailed={() => void refresh()}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

interface ReportRowProps {
  report: ConversationReport;
  busy: boolean;
  onResolve: (action: 'dismiss' | 'hide') => void;
}

/** One open report for moderators: who reported whom and why, then hide or dismiss. */
function ReportRow({ report, busy, onResolve }: ReportRowProps) {
  const { t } = useTranslation(['messages', 'common']);
  const styles = useThemedStyles(makeStyles);
  const reporter = report.reporter_name ?? t('common:fallback.someone');
  const reason = t(`reportModal.reasons.${report.reason}`);
  return (
    <View style={styles.report}>
      <Text style={styles.hint}>
        {report.message_author_name
          ? t('conversation.reportLine', { reporter, author: report.message_author_name, reason })
          : t('conversation.reportLineNoAuthor', { reporter, reason })}
      </Text>
      {report.details ? <Text style={styles.hint}>{t('conversation.reportDetails', { details: report.details })}</Text> : null}
      {report.message_body ? (
        <Text selectable style={styles.body}>{report.message_body}</Text>
      ) : (
        <Text style={styles.removed}>{t('conversation.alreadyRemoved')}</Text>
      )}
      <View style={styles.row}>
        <Button title={t('conversation.hideMessage')} variant="danger" disabled={busy} onPress={() => onResolve('hide')} />
        <Button title={t('conversation.dismiss')} variant="secondary" disabled={busy} onPress={() => onResolve('dismiss')} />
      </View>
    </View>
  );
}

interface MessageEntryProps {
  conversationId: string;
  conversation: ConversationSummary;
  message: ConversationMessage;
  parent: ConversationMessage | null;
  reporting: boolean;
  onReply: () => void;
  onReport: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onEdited: (message: ConversationMessage) => void;
  onReportClosed: () => void;
}

/** One message: author, time, quote, text (or why it is gone), mention outcomes for its author, actions. */
function MessageEntry({
  conversationId,
  conversation,
  message,
  parent,
  reporting,
  onReply,
  onReport,
  onDelete,
  onRestore,
  onEdited,
  onReportClosed,
}: MessageEntryProps) {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { generation, isCurrentGeneration } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.body);

  const edit = useMutation({
    mutationFn: () => api.editConversationMessage(conversationId, message.id, { body: text.trim() }),
    onSuccess: (updated) => {
      if (!isCurrentGeneration(generation)) return;
      onEdited(updated);
      setEditing(false);
    },
  });

  const state = conversationMessageState(message);
  const allowed = conversationMessageActions(message, conversation);
  const author = message.author_name ?? t('common:fallback.someone');
  const when = message.edited_at && state === 'visible'
    ? t('entry.edited', { time: format.dateTime(message.created_at) })
    : format.dateTime(message.created_at);
  const unnotified = message.is_mine && state === 'visible'
    ? message.mentions.filter((mention): mention is UnnotifiedMention => mention.resolution !== 'notified')
    : [];
  const quote = parent
    ? parent.body
      ? t('conversation.quote', { author: parent.author_name ?? t('common:fallback.someone'), body: parent.body })
      : t('conversation.quoteRemoved', { author: parent.author_name ?? t('common:fallback.someone') })
    : null;

  return (
    <View style={styles.entry}>
      <Avatar name={author} size={32} />
      <View style={styles.entryBody}>
        <Text style={styles.entryTop}>
          <Text style={styles.author}>{author}</Text>
          <Text style={styles.hint}>{`  ${when}`}</Text>
        </Text>
        {quote && state === 'visible' ? <Text style={styles.quote} numberOfLines={2}>{quote}</Text> : null}
        {state === 'hidden' ? (
          <Text style={styles.removed}>{t('conversation.hiddenByModerator')}</Text>
        ) : state === 'deleted' ? (
          <Text style={styles.removed}>{t('conversation.messageDeleted')}</Text>
        ) : editing ? (
          <View style={styles.group}>
            <Field
              accessibilityLabel={t('common:actions.edit')}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={4000}
              style={styles.multiline}
            />
            <ErrorNotice error={edit.error} />
            <View style={styles.row}>
              <Button title={t('common:actions.save')} variant="secondary" loading={edit.isPending} disabled={!text.trim()} onPress={() => edit.mutate()} />
              <Button
                title={t('common:actions.cancel')}
                variant="quiet"
                onPress={() => {
                  setEditing(false);
                  setText(message.body);
                  edit.reset();
                }}
              />
            </View>
          </View>
        ) : (
          <Text selectable style={styles.body}>{message.body}</Text>
        )}
        {unnotified.length ? (
          <Text style={styles.hint}>
            {unnotified
              .map((mention) => t('entry.mentionOutcome', { name: mention.name, outcome: t(`entry.resolution.${mention.resolution}`) }))
              .join(' · ')}
          </Text>
        ) : null}
        {!editing && (allowed.reply || allowed.edit || allowed.report || allowed.delete || allowed.restore) ? (
          <View style={styles.row}>
            {allowed.reply ? <Button title={t('conversation.reply')} variant="quiet" onPress={onReply} /> : null}
            {allowed.edit ? (
              <Button
                title={t('common:actions.edit')}
                variant="quiet"
                onPress={() => {
                  setText(message.body);
                  setEditing(true);
                }}
              />
            ) : null}
            {allowed.report ? <Button title={t('conversation.report')} variant="quiet" onPress={onReport} /> : null}
            {allowed.delete ? <Button title={t('common:actions.delete')} variant="quiet" onPress={onDelete} /> : null}
            {allowed.restore ? <Button title={t('common:actions.restore')} variant="quiet" onPress={onRestore} /> : null}
          </View>
        ) : null}
        {reporting ? <ReportPanel conversationId={conversationId} message={message} onClose={onReportClosed} /> : null}
      </View>
    </View>
  );
}

interface ReportPanelProps {
  conversationId: string;
  message: ConversationMessage;
  onClose: () => void;
}

/** The website's report dialog, inline: reason, optional details, then the moderators review it. */
function ReportPanel({ conversationId, message, onClose }: ReportPanelProps) {
  const { t } = useTranslation(['messages', 'common']);
  const styles = useThemedStyles(makeStyles);
  const [reason, setReason] = useState<ConversationReportReason>('inappropriate');
  const [details, setDetails] = useState('');
  const report = useMutation({
    mutationFn: () => api.reportConversationMessage(conversationId, message.id, { reason, details: details.trim() || undefined }),
  });

  if (report.isSuccess) {
    return (
      <Card>
        <Label>{t('mobileChat.reportDone')}</Label>
        <Text style={styles.body}>{t('reportModal.thanks')}</Text>
        <Button title={t('common:actions.done')} variant="secondary" onPress={onClose} />
      </Card>
    );
  }
  return (
    <Card>
      <Label>{t('mobileChat.reportTitle')}</Label>
      <Text style={styles.hint}>{t('reportModal.reason')}</Text>
      <View accessibilityRole="radiogroup" style={styles.chips}>
        {REPORT_REASONS.map((value) => (
          <Chip key={value} label={t(`reportModal.reasons.${value}`)} active={reason === value} onPress={() => setReason(value)} />
        ))}
      </View>
      <Field
        accessibilityLabel={t('reportModal.detailsPlaceholder')}
        placeholder={t('reportModal.detailsPlaceholder')}
        value={details}
        onChangeText={setDetails}
        multiline
        maxLength={1000}
        style={styles.multiline}
      />
      <ErrorNotice error={report.error} />
      <View style={styles.row}>
        <Button title={t('reportModal.submit')} loading={report.isPending} onPress={() => report.mutate()} />
        <Button title={t('common:actions.cancel')} variant="quiet" onPress={onClose} />
      </View>
    </Card>
  );
}

interface ComposerProps {
  conversationId: string;
  conversation: ConversationSummary;
  candidates: readonly MentionCandidate[];
  known: readonly ConversationMessage[];
  draft: ConversationDraft;
  setDraft: (update: (current: ConversationDraft) => ConversationDraft) => void;
  replyTo: ConversationMessage | null;
  onPosted: (message: ConversationMessage) => void;
  onFailed: () => void;
}

/**
 * Text box with explicit mentions and an optional reply, like the website
 * composer. The draft keeps one client message id until the server confirms
 * it — across failures and leaving the screen — so sending again after no
 * answer replays the same message instead of posting it twice.
 */
function Composer({
  conversationId,
  conversation,
  candidates,
  known,
  draft,
  setDraft,
  replyTo,
  onPosted,
  onFailed,
}: ComposerProps) {
  const { t } = useTranslation(['messages', 'common']);
  const { generation, isCurrentGeneration } = useAuth();
  const errorText = useErrorText();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState<SendNotice | null>(null);

  /** The server has (or replayed) this draft's id: keep only text that differs from what arrived. */
  const settleArrived = (sent: ConversationDraft, arrived: ConversationMessage) => {
    setDraft((current) =>
      current.id !== sent.id ? current : current.body.trim() === arrived.body ? emptyDraft() : { ...current, id: newIdempotencyKey() });
  };

  const post = useMutation({
    mutationFn: (sent: ConversationDraft) =>
      api.postConversationMessage(conversationId, {
        id: sent.id,
        body: sent.body.trim(),
        reply_to_id: sent.replyToId,
        mention_person_ids: sent.mentionIds,
      }),
    onSuccess: (result, sent) => {
      if (!isCurrentGeneration(generation)) return;
      settleArrived(sent, result.item);
      setChoosing(false);
      setNotice(result.replayed ? 'alreadySent' : null);
      onPosted(result.item);
    },
    onError: (error, sent) => {
      if (!isCurrentGeneration(generation)) return;
      const outcome = conversationPostOutcome(error);
      if (outcome === 'newId') setDraft((current) => (current.id === sent.id ? { ...current, id: newIdempotencyKey() } : current));
      if (outcome === 'gone' && sent.replyToId) {
        setDraft((current) => ({ ...current, replyToId: null }));
        setNotice('replyGone');
      } else {
        setNotice(outcome === 'uncertain' || outcome === 'rateLimited' || outcome === 'gone' ? outcome : null);
      }
      // Re-read: a lost acknowledgement shows up as this person's message; a removal as "not available".
      onFailed();
    },
  });

  // After no answer, the re-read thread may already hold the message.
  const arrived = notice === 'uncertain' ? known.find((message) => message.id === draft.id && message.is_mine) ?? null : null;
  useEffect(() => {
    if (!arrived) return;
    settleArrived(draft, arrived);
    setNotice('alreadySent');
    post.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived]);

  const toggleMention = (candidate: MentionCandidate) => {
    setDraft((current) =>
      current.mentionIds.includes(candidate.person_id)
        ? { ...current, mentionIds: current.mentionIds.filter((id) => id !== candidate.person_id) }
        : {
            ...current,
            mentionIds: [...current.mentionIds, candidate.person_id],
            body: `${current.body}${current.body && !current.body.endsWith(' ') ? ' ' : ''}@${candidate.name} `,
          });
  };

  const failure = post.error && notice === null
    ? new LocalizedError({ key: 'messages:composer.notSent', values: { reason: errorText(post.error) } })
    : notice && notice !== 'alreadySent'
      ? new LocalizedError({ key: `messages:mobileChat.${notice}` })
      : null;

  return (
    <View style={[styles.composerBar, { paddingBottom: Math.max(insets.bottom, theme.space.md) }]}>
      {draft.replyToId ? (
        <View style={styles.row}>
          <Text style={[styles.hint, styles.flex]} numberOfLines={1}>
            {replyTo?.author_name ? t('conversation.replyingTo', { name: replyTo.author_name }) : t('conversation.replyingToUnknown')}
          </Text>
          <Button title={t('common:actions.cancel')} variant="quiet" onPress={() => setDraft((current) => ({ ...current, replyToId: null }))} />
        </View>
      ) : null}
      <TextInput
        accessibilityLabel={t('conversation.composerPlaceholder', { name: conversation.title })}
        value={draft.body}
        onChangeText={(body) => setDraft((current) => ({ ...current, body }))}
        placeholder={t('conversation.composerPlaceholder', { name: conversation.title })}
        placeholderTextColor={theme.color.inkFaint}
        multiline
        maxLength={4000}
        style={styles.composer}
      />
      {draft.mentionIds.length ? (
        <Text style={styles.hint}>
          {`${t('composer.mentionsLabel')}: ${draft.mentionIds
            .map((id) => `@${candidates.find((candidate) => candidate.person_id === id)?.name ?? t('common:fallback.someone')}`)
            .join(', ')}`}
        </Text>
      ) : null}
      {choosing ? (
        <View accessibilityLabel={t('composer.mentionLabel')} style={styles.chips}>
          {candidates.map((candidate) => (
            <Chip
              key={candidate.person_id}
              label={candidate.name}
              active={draft.mentionIds.includes(candidate.person_id)}
              onPress={() => toggleMention(candidate)}
            />
          ))}
        </View>
      ) : null}
      {failure ? <ErrorNotice error={failure} /> : null}
      {notice === 'alreadySent' ? <Text style={styles.hint}>{t('mobileChat.alreadySent')}</Text> : null}
      <View style={styles.row}>
        <Button
          title={candidates.length ? t('composer.mentionPrompt') : t('composer.noOneToMention')}
          variant="quiet"
          disabled={candidates.length === 0}
          onPress={() => setChoosing((open) => !open)}
        />
        <View style={styles.flex} />
        <Button
          title={post.error ? t('common:actions.retry') : t('common:actions.send')}
          loading={post.isPending}
          disabled={!draft.body.trim()}
          onPress={() => {
            setNotice(null);
            post.mutate(draft);
          }}
        />
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    thread: { padding: theme.space.lg, gap: theme.space.md },
    group: { gap: theme.space.sm },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    empty: { ...theme.type.bodySmall, color: theme.color.inkMuted, textAlign: 'center', paddingVertical: theme.space.xl },
    removed: { ...theme.type.body, color: theme.color.inkFaint, fontStyle: 'italic' },
    quote: {
      ...theme.type.bodySmall,
      color: theme.color.inkMuted,
      borderLeftWidth: 2,
      borderLeftColor: theme.color.borderStrong,
      paddingLeft: theme.space.sm,
    },
    author: { ...theme.type.bodySmall, color: theme.color.ink, fontWeight: '600' },
    entry: { flexDirection: 'row', gap: theme.space.md, paddingVertical: theme.space.sm },
    entryBody: { flex: 1, gap: theme.space.xs },
    entryTop: { flexWrap: 'wrap' },
    report: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    multiline: { minHeight: 72, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    composerBar: {
      gap: theme.space.sm,
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    composer: {
      ...theme.type.body,
      color: theme.color.ink,
      minHeight: 44,
      maxHeight: 140,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.color.borderStrong,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.field,
      padding: theme.space.md,
    },
  });
