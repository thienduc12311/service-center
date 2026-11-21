import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
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
  type ConversationDetail,
  type ConversationMessage,
  type ConversationReport,
  type ConversationReportReason,
  type ConversationSummary,
  type DiscussionMention,
  type DiscussionPage,
  type MentionCandidate,
  type MentionResolution,
} from '@service-center/shared';
import { api } from '../../src/lib/api';
import { newIdempotencyKey } from '../../src/lib/idempotency';
import { queryKeys } from '../../src/lib/query-keys';
import { conversationDrafts, type ConversationDraft } from '../../src/lib/conversation-drafts';
import { conversationWindow, readConversationHistory, type ConversationHistory } from '../../src/lib/conversation-thread';
import { conversationTitle } from '../../src/lib/conversation-labels';
import { useBroadcastRefresh } from '../../src/lib/useBroadcastRefresh';
import { useConversationSend, type SubmittedMessage } from '../../src/lib/useConversationSend';
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
import { Icon } from '../../src/components/icons';
import { MessageBody, MentionPicker, mentionsMe, useMentionInput } from '../../src/components/mentions';
import { recentAuthorIds } from '../../src/lib/mention-suggestions';
import { PressableScale } from '../../src/components/motion';
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

const emptyDraft = (): ConversationDraft => ({ id: newIdempotencyKey(), body: '', mentionIds: [], replyToId: null });

/**
 * MOB-019: one team or plan conversation — the website's chat thread.
 * Broadcasts and a fallback poll refresh the authenticated API while visible.
 * A 404/403 at any time means this person is no longer a
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

  const queryKey = queryKeys.conversation(queryScope, conversationId);
  const historyKey = queryKeys.conversationHistory(queryScope, conversationId);
  const listKey = queryKeys.conversationList(queryScope);
  const [denied, setDenied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => queryClient.getQueryData(historyKey) !== undefined);
  const deniedRead = useRef(false);
  const read = async <T,>(request: Promise<T>): Promise<T> => {
    try {
      return await request;
    } catch (error) {
      if (conversationAccess(error) === 'unavailable' && isCurrentGeneration(generation)) {
        deniedRead.current = true;
        setDenied(true);
      }
      throw error;
    }
  };

  // Keep the newest response independent of history and search, including in
  // the broadcast hook's in-flight request filter.
  const detail = useQuery({
    queryKey,
    queryFn: () => read(api.getConversation(conversationId)),
    enabled: Boolean(queryScope && visible && !denied),
    staleTime: 0,
    retry: false,
    refetchInterval: visible ? CONVERSATION_THREAD_POLL_MS : false,
  });
  const first = detail.data;
  const access = denied ? 'unavailable' : conversationAccess(detail.error);
  const conversation = access === 'unavailable' ? null : first?.conversation ?? null;
  useBroadcastRefresh('conversation', access === 'unavailable' ? [] : [conversationId], visible, { queryKey, exact: true });

  const expandHistory = useRef(false);
  const history = useQuery({
    queryKey: historyKey,
    queryFn: ({ signal }) => {
      const expand = expandHistory.current;
      expandHistory.current = false;
      return read(readConversationHistory({
        before: queryClient.getQueryData<ConversationDetail>(queryKey)?.messages.next_before ?? null,
        previous: queryClient.getQueryData<ConversationHistory>(historyKey),
        expand,
        loadPage: (before) => {
          if (signal.aborted) return Promise.reject(new Error('Conversation history read canceled'));
          return api.conversationMessages(conversationId, { before, limit: CONVERSATION_PAGE_SIZE });
        },
      }));
    },
    enabled: false,
    retry: false,
  });
  const { refetch: refetchHistory, isFetching: historyFetching } = history;
  const lastHistoryRefresh = useRef(0);
  useEffect(() => {
    if (!historyOpen || !visible || !conversation || historyFetching || lastHistoryRefresh.current === detail.dataUpdatedAt) return;
    lastHistoryRefresh.current = detail.dataUpdatedAt;
    void refetchHistory({ cancelRefetch: false });
  }, [conversation, detail.dataUpdatedAt, historyFetching, historyOpen, refetchHistory, visible]);

  // Retain the part of the previous window pushed out of the newest page,
  // until the background read has reconciled that range with the server.
  const [threadWindow, setThreadWindow] = useState(() => ({
    newest: first?.messages,
    history: history.data,
    messages: first ? conversationWindow(first.messages, history.data, []) : [],
  }));
  if (threadWindow.newest !== first?.messages || threadWindow.history !== history.data) {
    setThreadWindow({
      newest: first?.messages,
      history: history.data,
      messages: first ? conversationWindow(first.messages, history.data, historyOpen ? threadWindow.messages : []) : [],
    });
  }
  const known = conversation ? threadWindow.messages : [];
  const byId = useMemo(() => new Map(known.map((message) => [message.id, message])), [known]);

  useEffect(() => {
    if (access !== 'unavailable' || !isCurrentGeneration(generation)) return;
    deniedRead.current = true;
    setDenied(true);
    // A denied history or search read also invalidates the cached newest page.
    queryClient.removeQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access]);

  const patchMessages = (
    update: (messages: ConversationMessage[]) => ConversationMessage[],
    addToNewest?: ConversationMessage,
  ) => {
    if (!isCurrentGeneration(generation) || deniedRead.current) return;
    queryClient.setQueryData<ConversationDetail>(queryKey, (current) => current && ({
      ...current,
      messages: {
        ...current.messages,
        data: addToNewest ? mergeConversationPages(update(current.messages.data), [addToNewest]) : update(current.messages.data),
      },
    }));
    queryClient.setQueryData<ConversationHistory>(historyKey, (current) => current && ({ ...current, data: update(current.data) }));
    setThreadWindow((current) => ({ ...current, messages: update(current.messages) }));
  };
  const mergeOne = (message: ConversationMessage, append = false) =>
    patchMessages((messages) => messages.map((row) => row.id === message.id ? message : row), append ? message : undefined);

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
    queryFn: () => read(api.conversationMessages(conversationId, { q: term, limit: CONVERSATION_PAGE_SIZE })),
    enabled: Boolean(queryScope && conversation && searching && visible),
    refetchInterval: visible ? CONVERSATION_THREAD_POLL_MS : false,
    retry: false,
  });
  const { refetch: refetchSearch, isFetching: searchingInFlight } = results;
  const lastSearchRefresh = useRef(detail.dataUpdatedAt);
  useEffect(() => {
    if (searchingInFlight || lastSearchRefresh.current === detail.dataUpdatedAt) return;
    lastSearchRefresh.current = detail.dataUpdatedAt;
    if (visible && conversation && searching) void refetchSearch({ cancelRefetch: false });
  }, [conversation, detail.dataUpdatedAt, refetchSearch, searching, searchingInFlight, visible]);

  const candidates = useQuery({
    queryKey: queryKeys.conversationMentionCandidates(queryScope, conversationId),
    queryFn: () => read(api.mentionCandidates({ conversation_id: conversationId })),
    enabled: Boolean(queryScope && conversation && visible),
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
    onSuccess: () => {
      if (isCurrentGeneration(generation)) void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
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
      // Show the server-confirmed hide immediately.
      const shown = byId.get(report.message_id);
      if (shown && !shown.hidden_at) mergeOne({ ...shown, body: '', hidden_at: report.resolved_at ?? new Date().toISOString() });
    },
    onSettled: () => void refresh(),
  });
  const block = useMutation({
    mutationFn: (message: ConversationMessage) => api.blockUser(message.author_id),
    onSuccess: async ({ blocked_id }, message) => {
      if (!isCurrentGeneration(generation)) return;
      // Discard reads started before the server recorded the block.
      await queryClient.cancelQueries({ queryKey });
      if (!isCurrentGeneration(generation)) return;
      const withoutBlocked = (messages: ConversationMessage[]): ConversationMessage[] =>
        messages.filter((entry) => entry.author_id !== blocked_id);
      patchMessages(withoutBlocked);
      queryClient.setQueriesData<DiscussionPage<ConversationMessage>>(
        { queryKey: queryKeys.conversationSearches(queryScope, conversationId) },
        (page) => page && ({ ...page, data: withoutBlocked(page.data) }),
      );
      setDraft((current) => current.replyToId && (
        current.replyToId === message.id || byId.get(current.replyToId)?.author_id === blocked_id
      ) ? { ...current, replyToId: null } : current);
      setReportingId(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(queryScope?.userId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.privateRoot(queryScope) });
    },
  });
  const [reportingId, setReportingId] = useState<string | null>(null);
  // Only a pull shows the spinner; background polls refresh silently.
  const [pulling, setPulling] = useState(false);

  const confirmDelete = (message: ConversationMessage) =>
    Alert.alert(t('conversation.deleteConfirm'), undefined, [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('common:actions.delete'), style: 'destructive', onPress: () => remove.mutate(message) },
    ]);

  const confirmBlock = (message: ConversationMessage) => {
    const name = message.author_name ?? t('common:fallback.someone');
    Alert.alert(t('mobileChat.blockTitle', { name }), t('mobileChat.blockMessage', { name }), [
      { text: t('common:actions.cancel'), style: 'cancel' },
      { text: t('mobileChat.blockConfirm'), style: 'destructive', onPress: () => block.mutate(message) },
    ]);
  };

  // ----------------------------------------------------------------- draft --
  const [draft, setDraft] = useState<ConversationDraft>(() => conversationDrafts.get(queryScope, conversationId) ?? emptyDraft());
  useEffect(() => conversationDrafts.set(queryScope, conversationId, draft), [conversationId, draft, queryScope]);
  const replyTo = draft.replyToId ? byId.get(draft.replyToId) ?? null : null;
  const send = useConversationSend({
    conversationId,
    known,
    canSend: () => !deniedRead.current,
    onConfirmed: async (message) => {
      // A read that started before the post may still return the old thread.
      await queryClient.cancelQueries({ queryKey, exact: true });
      const newest = queryClient.getQueryData<ConversationDetail>(queryKey)?.messages.data;
      const older = queryClient.getQueryData<ConversationHistory>(historyKey)?.data;
      if (!newest?.some(({ id }) => id === message.id) && !older?.some(({ id }) => id === message.id)) {
        mergeOne(message, true);
      }
    },
    refresh: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey, exact: true }),
        queryClient.invalidateQueries({ queryKey: listKey, exact: true }),
      ]);
    },
  });
  const submitDraft = (mentionIds: string[]) => {
    if (!send.submit({ ...draft, mentionIds })) return false;
    follow.current = true;
    setSearch('');
    conversationDrafts.clear(queryScope, conversationId);
    setDraft(emptyDraft());
    return true;
  };

  if (detail.isLoading && access !== 'unavailable') {
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
            icon="chat"
            title={t('conversation.notAvailableTitle')}
            description={t('conversation.notAvailableDescription')}
            action={<Button title={t('mobileChat.notAvailableAction')} variant="secondary" onPress={() => router.replace('/chat')} />}
          />
        ) : (
          <EmptyState
            icon="alert"
            title={t('mobileChat.refreshFailed')}
            action={<Button title={t('common:actions.retry')} variant="secondary" onPress={() => void detail.refetch()} />}
          />
        )}
      </Screen>
    );
  }

  const reports = first?.reports ?? [];
  const hasOlder = history.data?.before === first?.messages.next_before
    ? Boolean(history.data?.next_before)
    : Boolean(first?.messages.next_before);
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
          <Card compact style={styles.infoCard}>
            <View style={styles.toolbar}>
              <Tag label={t(`conversation.kinds.${conversation.kind}`)} accent={theme.accent.neutral} />
              {conversation.muted ? (
                <Icon name="bell" size={14} color={theme.color.inkFaint} />
              ) : null}
              <View style={styles.flex} />
              {conversation.plan_id ? (
                <TextAction label={t('conversation.openPlan')} onPress={() => router.push(`/plan/${conversation.plan_id}`)} />
              ) : null}
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
          </Card>
          {detail.error ? <ErrorNotice error={new LocalizedError({ key: 'messages:mobileChat.refreshFailed' })} /> : null}

          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Icon name="search" size={17} color={theme.color.inkFaint} />
              <TextInput
                accessibilityLabel={t('conversation.searchLabel')}
                placeholder={t('conversation.searchPlaceholder')}
                placeholderTextColor={theme.color.inkFaint}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
                style={styles.searchInput}
              />
            </View>
            {search ? <TextAction label={t('mobileChat.clearSearch')} onPress={() => setSearch('')} /> : null}
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

          <ErrorNotice error={remove.error ?? restore.error ?? resolve.error ?? mute.error ?? block.error ?? results.error ?? history.error} />

          {searching ? (
            results.isLoading ? (
              <Loading />
            ) : (
              <Text style={styles.hint}>
                {shown.length ? t('mobileChat.searchResults', { count: shown.length }) : t('conversation.noMatches')}
              </Text>
            )
          ) : hasOlder ? (
            <Button
              title={t('mobileChat.showOlder')}
              variant="quiet"
              loading={historyFetching}
              onPress={() => {
                follow.current = false;
                if (historyFetching) return;
                if (!historyOpen) {
                  setHistoryOpen(true);
                } else {
                  expandHistory.current = true;
                  void refetchHistory({ cancelRefetch: false });
                }
              }}
            />
          ) : known.length ? (
            <Text style={[styles.hint, styles.centerHint]}>{t('mobileChat.allLoaded')}</Text>
          ) : null}

          {!searching && known.length === 0 && send.outgoing.length === 0 ? (
            <EmptyState icon="chat" title={t('conversation.noMessages')} />
          ) : null}

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
              onBlock={() => confirmBlock(message)}
              onDelete={() => confirmDelete(message)}
              onRestore={() => restore.mutate(message)}
              onEdited={mergeOne}
              onReportClosed={() => setReportingId(null)}
              onBlockAfterReport={() => confirmBlock(message)}
            />
          ))}
          {!searching && send.outgoing.map(({ sent, status, error }) => (
            <OutgoingMessageEntry
              key={sent.id}
              sent={sent}
              pending={status === 'pending'}
              error={error}
              parent={sent.replyToId ? byId.get(sent.replyToId) ?? null : null}
              onRetry={() => send.retry(sent, error)}
              onDismiss={() => send.dismiss(sent.id)}
            />
          ))}
        </ScrollView>

        <Composer
          conversation={conversation}
          candidates={candidates.data ?? []}
          recentAuthorIds={recentAuthorIds(known)}
          draft={draft}
          setDraft={setDraft}
          replyTo={replyTo}
          onSend={submitDraft}
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
  /** Asks first, then hides everything this author writes from the caller. */
  onBlock: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onEdited: (message: ConversationMessage) => void;
  onReportClosed: () => void;
  /** Offered once a report is sent. */
  onBlockAfterReport: () => void;
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
  onBlock,
  onDelete,
  onRestore,
  onEdited,
  onReportClosed,
  onBlockAfterReport,
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

  const mine = message.is_mine;

  /**
   * Report and block live behind the author's picture, not in the row under
   * every message, so a stray tap can't block someone. Blocking still asks
   * again before it happens.
   */
  const openAuthorMenu = (): void => {
    const options: { label: string; run: () => void; destructive?: boolean }[] = [
      ...(allowed.report ? [{ label: t('authorMenu.report'), run: onReport }] : []),
      ...(allowed.block ? [{ label: t('authorMenu.block', { name: author }), run: onBlock, destructive: true }] : []),
    ];
    const cancel = t('common:actions.cancel');
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: author,
          message: t('authorMenu.hint', { name: author }),
          options: [...options.map((option) => option.label), cancel],
          cancelButtonIndex: options.length,
          destructiveButtonIndex: options.findIndex((option) => option.destructive),
        },
        (index) => options[index]?.run(),
      );
      return;
    }
    Alert.alert(author, t('authorMenu.hint', { name: author }), [
      ...options.map((option) => ({ text: option.label, style: option.destructive ? ('destructive' as const) : ('default' as const), onPress: option.run })),
      { text: cancel, style: 'cancel' as const },
    ]);
  };
  const editingMessage = editing && allowed.edit;
  const hasActions = !editingMessage && (allowed.reply || allowed.edit || allowed.delete || allowed.restore);

  return (
    <View style={[styles.entry, mine && styles.entryMine]}>
      {mine ? null : allowed.report || allowed.block ? (
        <PressableScale
          onPress={openAuthorMenu}
          accessibilityLabel={t('authorMenu.open', { name: author })}
          pressedOpacity={0.6}
          hitSlop={6}
          style={styles.authorButton}
        >
          <Avatar name={author} size={32} />
        </PressableScale>
      ) : (
        <Avatar name={author} size={32} />
      )}
      <View style={[styles.entryBody, mine && styles.entryBodyMine]}>
        {mine ? null : <Text style={styles.author}>{author}</Text>}
        {editingMessage ? (
          <View style={[styles.group, styles.editing]}>
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
          <View
            style={[
              styles.bubble,
              mine ? styles.bubbleMine : styles.bubbleOther,
              state !== 'visible' && styles.bubbleRemoved,
              state === 'visible' && !mine && mentionsMe(message.mentions) && styles.bubbleForMe,
            ]}
          >
            {quote && state === 'visible' ? (
              <Text style={[styles.quote, mine && styles.quoteMine]} numberOfLines={2}>{quote}</Text>
            ) : null}
            {state === 'hidden' ? (
              <Text style={styles.removed}>{t('conversation.hiddenByModerator')}</Text>
            ) : state === 'deleted' ? (
              <Text style={styles.removed}>{t('conversation.messageDeleted')}</Text>
            ) : (
              <MessageBody
                text={message.body}
                mentions={message.mentions}
                tone={mine ? 'inverse' : 'default'}
                style={[styles.body, mine && styles.bodyMine]}
              />
            )}
          </View>
        )}
        <Text style={[styles.time, mine && styles.timeMine]}>{when}</Text>
        {unnotified.length ? (
          <Text style={[styles.hint, mine && styles.timeMine]}>
            {unnotified
              .map((mention) => t('entry.mentionOutcome', { name: mention.name, outcome: t(`entry.resolution.${mention.resolution}`) }))
              .join(' · ')}
          </Text>
        ) : null}
        {hasActions ? (
          <View style={[styles.actions, mine && styles.actionsMine]}>
            {allowed.reply ? <TextAction label={t('conversation.reply')} onPress={onReply} /> : null}
            {allowed.edit ? (
              <TextAction
                label={t('common:actions.edit')}
                onPress={() => {
                  setText(message.body);
                  setEditing(true);
                }}
              />
            ) : null}
            {allowed.delete ? <TextAction label={t('common:actions.delete')} danger onPress={onDelete} /> : null}
            {allowed.restore ? <TextAction label={t('common:actions.restore')} onPress={onRestore} /> : null}
          </View>
        ) : null}
        {reporting ? (
          <View style={styles.reportWrap}>
            <ReportPanel conversationId={conversationId} message={message} onClose={onReportClosed} onBlock={onBlockAfterReport} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface TextActionProps {
  label: string;
  onPress: () => void;
  /** Destructive wording, e.g. Delete. */
  danger?: boolean;
}

/** A compact text-only action with a full 44pt touch target. */
function TextAction({ label, onPress, danger = false }: TextActionProps) {
  const styles = useThemedStyles(makeStyles);
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} pressedOpacity={0.5} style={styles.textAction}>
      <Text style={[styles.textActionLabel, danger && styles.textActionDanger]}>{label}</Text>
    </PressableScale>
  );
}

interface ReportPanelProps {
  conversationId: string;
  message: ConversationMessage;
  onClose: () => void;
  /** Block the author too, once the report is in. */
  onBlock: () => void;
}

/** The website's report dialog, inline: reason, optional details, then the moderators review it. */
function ReportPanel({ conversationId, message, onClose, onBlock }: ReportPanelProps) {
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
        <Text style={styles.hint}>
          {t('mobileChat.blockAfterReport', { name: message.author_name ?? t('common:fallback.someone') })}
        </Text>
        <View style={styles.row}>
          <Button title={t('common:actions.done')} variant="secondary" onPress={onClose} />
          <Button title={t('mobileChat.block')} variant="danger" onPress={onBlock} />
        </View>
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

interface OutgoingMessageEntryProps {
  sent: SubmittedMessage;
  pending: boolean;
  error: unknown;
  parent: ConversationMessage | null;
  onRetry: () => void;
  onDismiss: () => void;
}

function OutgoingMessageEntry({ sent, pending, error, parent, onRetry, onDismiss }: OutgoingMessageEntryProps) {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const errorText = useErrorText();
  const styles = useThemedStyles(makeStyles);
  const outcome = pending ? null : conversationPostOutcome(error);
  const quote = parent && (parent.body
    ? t('conversation.quote', { author: parent.author_name ?? t('common:fallback.someone'), body: parent.body })
    : t('conversation.quoteRemoved', { author: parent.author_name ?? t('common:fallback.someone') }));
  const failure = !outcome ? null : outcome === 'gone' || outcome === 'rateLimited' || outcome === 'uncertain'
    ? new LocalizedError({ key: `messages:mobileChat.${outcome === 'gone' && sent.replyToId ? 'replyGone' : outcome}` })
    : new LocalizedError({ key: 'messages:composer.notSent', values: { reason: errorText(error) } });

  return (
    <View style={[styles.entry, styles.entryMine]}>
      <View style={[styles.entryBody, styles.entryBodyMine]}>
        <View style={[styles.bubble, styles.bubbleMine]}>
          {quote ? <Text style={[styles.quote, styles.quoteMine]} numberOfLines={2}>{quote}</Text> : null}
          <MessageBody text={sent.body} mentions={[]} tone="inverse" style={[styles.body, styles.bodyMine]} />
        </View>
        <Text style={[styles.time, styles.timeMine]}>{format.dateTime(sent.createdAt)}</Text>
        {pending ? (
          <Text accessibilityLiveRegion="polite" style={styles.hint}>{t('delivery.status.sending')}</Text>
        ) : (
          <>
            <ErrorNotice error={failure} />
            <View style={[styles.actions, styles.actionsMine]}>
              {outcome === 'gone' && !sent.replyToId ? null : <TextAction label={t('common:actions.retry')} onPress={onRetry} />}
              <TextAction label={t('common:actions.remove')} onPress={onDismiss} />
            </View>
          </>
        )}
      </View>
    </View>
  );
}

interface ComposerProps {
  conversation: ConversationSummary;
  candidates: readonly MentionCandidate[];
  /** Who spoke most recently, offered first for an empty `@`. */
  recentAuthorIds: readonly string[];
  draft: ConversationDraft;
  setDraft: (update: (current: ConversationDraft) => ConversationDraft) => void;
  replyTo: ConversationMessage | null;
  /** Sends the draft with the mentions still intact in its text. */
  onSend: (mentionIds: string[]) => boolean;
}

/**
 * Text box with `@` mentions and an optional reply. Typing `@` (or the `@`
 * button) opens a picker; Return sends, or picks the top match while the
 * picker is open.
 */
function Composer({ conversation, candidates, recentAuthorIds: recentIds, draft, setDraft, replyTo, onSend }: ComposerProps) {
  const { t } = useTranslation(['messages', 'common']);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const mention = useMentionInput({
    text: draft.body,
    onChangeText: (body) => setDraft((current) => ({ ...current, body })),
    candidates,
    // The person being replied to first, then whoever spoke last.
    priorityIds: replyTo?.author_person_id ? [replyTo.author_person_id, ...recentIds] : recentIds,
    pickedIds: draft.mentionIds,
    onPicked: (personId) => setDraft((current) => ({ ...current, mentionIds: [...current.mentionIds, personId] })),
  });
  const send = () => {
    if (draft.body.trim()) onSend(mention.mentionIds(draft.body));
  };

  return (
    <View style={[styles.composerBar, { paddingBottom: Math.max(insets.bottom, theme.space.md) }]}>
      {draft.replyToId ? (
        <View style={styles.replyBar}>
          <Text style={[styles.hint, styles.flex]} numberOfLines={1}>
            {replyTo?.author_name ? t('conversation.replyingTo', { name: replyTo.author_name }) : t('conversation.replyingToUnknown')}
          </Text>
          <TextAction label={t('common:actions.cancel')} onPress={() => setDraft((current) => ({ ...current, replyToId: null }))} />
        </View>
      ) : null}
      <MentionPicker picker={mention.picker} />
      <View style={styles.composerRow}>
        <Button
          title="@"
          accessibilityLabel={t('composer.mentionLabel')}
          variant="quiet"
          style={styles.mention}
          onPress={mention.startMention}
        />
        <TextInput
          {...mention.inputProps}
          ref={mention.inputRef}
          // NativeWind's interop drops this TextInput's ref; it is styled with StyleSheet anyway.
          cssInterop={false}
          accessibilityLabel={t('conversation.composerPlaceholder', { name: conversation.title })}
          placeholder={t('conversation.composerPlaceholder', { name: conversation.title })}
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
        <Button
          title={t('common:actions.send')}
          disabled={!draft.body.trim()}
          style={styles.send}
          onPress={send}
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
    infoCard: { gap: theme.space.sm, paddingVertical: theme.space.sm },
    toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space.sm },
    searchRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
    search: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minHeight: 44,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.md,
      backgroundColor: theme.color.surfaceInset,
      paddingHorizontal: theme.space.md,
    },
    searchInput: { ...theme.type.body, flex: 1, color: theme.color.ink, paddingVertical: theme.space.sm },
    body: { ...theme.type.body, color: theme.color.ink },
    bodyMine: { color: theme.color.onBrand },
    hint: { ...theme.type.bodySmall, color: theme.color.inkFaint },
    centerHint: { textAlign: 'center' },
    removed: { ...theme.type.body, color: theme.color.inkFaint, fontStyle: 'italic' },
    quote: {
      ...theme.type.bodySmall,
      color: theme.color.inkMuted,
      borderLeftWidth: 2,
      borderLeftColor: theme.color.borderStrong,
      paddingLeft: theme.space.sm,
      marginBottom: theme.space.xs,
    },
    quoteMine: { color: theme.color.onBrand, opacity: 0.85, borderLeftColor: theme.color.onBrand },
    author: { ...theme.type.label, color: theme.color.inkMuted, fontWeight: '600', marginLeft: theme.space.xs },
    entry: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space.sm, paddingVertical: theme.space.xs },
    entryMine: { justifyContent: 'flex-end' },
    entryBody: { flexShrink: 1, maxWidth: '84%', gap: theme.space.xs, alignItems: 'flex-start' },
    entryBodyMine: { alignItems: 'flex-end' },
    editing: { alignSelf: 'stretch', minWidth: 240 },
    bubble: {
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm + 2,
      borderRadius: theme.radius.lg + 4,
    },
    bubbleOther: {
      backgroundColor: theme.color.surface,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderTopLeftRadius: theme.radius.xs,
    },
    bubbleMine: {
      backgroundColor: theme.color.brand,
      borderTopRightRadius: theme.radius.xs,
    },
    bubbleForMe: { borderLeftWidth: 4, borderLeftColor: theme.accent.yellow.fg },
    bubbleRemoved: {
      backgroundColor: theme.color.surfaceInset,
      borderWidth: 1,
      borderColor: theme.color.border,
      borderStyle: 'dashed',
    },
    time: { ...theme.type.numeric, fontSize: 12, lineHeight: 16, color: theme.color.inkFaint, marginHorizontal: theme.space.xs },
    timeMine: { textAlign: 'right' },
    actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space.md, marginTop: -theme.space.sm },
    actionsMine: { justifyContent: 'flex-end' },
    authorButton: { alignSelf: 'flex-start', borderRadius: 999 },
    textAction: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: theme.space.xs },
    textActionLabel: { ...theme.type.label, fontWeight: '600', color: theme.color.brandText },
    textActionDanger: { color: theme.accent.red.fg },
    reportWrap: { alignSelf: 'stretch' },
    report: { gap: theme.space.xs, paddingVertical: theme.space.sm },
    multiline: { minHeight: 72, paddingTop: theme.space.sm, textAlignVertical: 'top' },
    composerBar: {
      gap: theme.space.xs,
      paddingHorizontal: theme.space.lg,
      paddingTop: theme.space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.color.border,
      backgroundColor: theme.color.surface,
    },
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      paddingLeft: theme.space.sm,
      borderLeftWidth: 2,
      borderLeftColor: theme.color.brand,
    },
    composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: theme.space.sm },
    composer: {
      ...theme.type.body,
      flex: 1,
      color: theme.color.ink,
      minHeight: 48,
      maxHeight: 140,
      textAlignVertical: 'top',
      borderWidth: 1,
      borderColor: theme.color.border,
      borderRadius: theme.radius.lg + 4,
      backgroundColor: theme.color.surfaceInset,
      paddingHorizontal: theme.space.md + 2,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md,
    },
    send: { borderRadius: theme.radius.lg + 4, paddingHorizontal: theme.space.lg },
    mention: { minHeight: 48, minWidth: 40, paddingHorizontal: theme.space.xs },
  });
