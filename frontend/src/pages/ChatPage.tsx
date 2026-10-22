import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  chatStartableTeams,
  conversationMessageActions,
  conversationMessageState,
  conversationReadMark,
  CONVERSATION_SEARCH_MIN,
  type ConversationMessage,
  type ConversationReportReason,
  type ConversationSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useConversation, useConversations, useMentionCandidates, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { useFormatters, type Formatters } from '../i18n';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { DiscussionComposer } from '../components/collaboration/DiscussionComposer';
import { DiscussionEntry } from '../components/collaboration/DiscussionEntry';

const REPORT_REASONS: readonly ConversationReportReason[] = ['spam', 'harassment', 'inappropriate', 'safety', 'other'];

const conversationLabel = (conversation: ConversationSummary, t: TFunction<'messages'>, format: Formatters): string =>
  conversation.kind === 'plan' && conversation.service_date
    ? t('chatPage.planConversation', { title: conversation.title, date: format.date(conversation.service_date) })
    : conversation.title;

interface ReportModalProps {
  conversationId: string;
  message: ConversationMessage;
  onClose: () => void;
}

const ReportModal = ({ conversationId, message, onClose }: ReportModalProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const [reason, setReason] = useState<ConversationReportReason>('inappropriate');
  const [details, setDetails] = useState('');
  const report = useMutation({ mutationFn: () => api.reportConversationMessage(conversationId, message.id, { reason, details: details || undefined }) });
  return (
    <Modal open title={t('reportModal.title')} onClose={onClose}>
      {report.isSuccess ? (
        <>
          <p className="text-sm text-slate-600">{t('reportModal.thanks')}</p>
          <div className="mt-6 flex justify-end"><Button onClick={onClose}>{t('common:actions.done')}</Button></div>
        </>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="rounded bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-900">{message.body}</p>
          <select className="input" value={reason} onChange={(event) => setReason(event.target.value as ConversationReportReason)} aria-label={t('reportModal.reason')}>
            {REPORT_REASONS.map((value) => <option key={value} value={value}>{t(`reportModal.reasons.${value}`)}</option>)}
          </select>
          <textarea className="input" rows={3} maxLength={1000} placeholder={t('reportModal.detailsPlaceholder')} value={details} onChange={(event) => setDetails(event.target.value)} />
          <ErrorNotice error={report.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button loading={report.isPending} onClick={() => report.mutate()}>{t('reportModal.submit')}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

interface ConversationThreadProps {
  conversationId: string;
}

const ConversationThread = ({ conversationId }: ConversationThreadProps) => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { organizationId } = useAuth();
  const client = useQueryClient();
  const detail = useConversation(conversationId);
  const candidates = useMentionCandidates(detail.data ? { conversation_id: conversationId } : null);
  const [replyTo, setReplyTo] = useState<ConversationMessage | null>(null);
  const [reporting, setReporting] = useState<ConversationMessage | null>(null);
  const [search, setSearch] = useState('');
  const results = useQuery({
    queryKey: [...keys.conversation(organizationId, conversationId), 'search', search],
    queryFn: () => api.conversationMessages(conversationId, { q: search, limit: 30 }),
    enabled: search.trim().length >= CONVERSATION_SEARCH_MIN,
  });
  const refresh = () => client.invalidateQueries({ queryKey: keys.conversations(organizationId) });

  const newest = detail.data?.messages.data.at(-1)?.created_at;
  useEffect(() => {
    // Reading the thread moves the read position forward (never back), up to the newest message shown.
    const mark = conversationReadMark(detail.data?.messages.data ?? [], detail.data?.conversation.unread_count ?? 0, null);
    if (mark) void api.markConversationRead(conversationId, mark).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, newest]);

  const mute = useMutation({ mutationFn: (muted: boolean) => api.muteConversation(conversationId, muted), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (message: ConversationMessage) => api.deleteConversationMessage(conversationId, message.id), onSuccess: refresh });
  const restore = useMutation({ mutationFn: (message: ConversationMessage) => api.restoreConversationMessage(conversationId, message.id), onSuccess: refresh });
  const resolve = useMutation({
    mutationFn: (input: { reportId: string; action: 'dismiss' | 'hide' }) => api.resolveConversationReport(conversationId, input.reportId, { action: input.action }),
    onSuccess: refresh,
  });

  if (detail.isLoading) return <Loading />;
  if (detail.error || !detail.data) {
    return (
      <EmptyState
        title={t('conversation.notAvailableTitle')}
        description={t('conversation.notAvailableDescription')}
      />
    );
  }
  const { conversation, messages, reports } = detail.data;
  const byId = new Map(messages.data.map((message) => [message.id, message]));
  const shown = search.trim().length >= CONVERSATION_SEARCH_MIN ? results.data?.data ?? [] : messages.data;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{conversationLabel(conversation, t, format)}</h2>
        <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{t(`conversation.kinds.${conversation.kind}`)}</Badge>
        {conversation.plan_id && <Link className="text-xs text-brand-600 hover:underline" to={`/plans/${conversation.plan_id}`}>{t('conversation.openPlan')}</Link>}
        <div className="ml-auto flex items-center gap-2">
          <input className="input !w-44 text-sm" placeholder={t('conversation.searchPlaceholder')} value={search} onChange={(event) => setSearch(event.target.value)} aria-label={t('conversation.searchLabel')} />
          <Button variant="secondary" loading={mute.isPending} onClick={() => mute.mutate(!conversation.muted)}>
            {conversation.muted ? t('conversation.unmute') : t('conversation.mute')}
          </Button>
        </div>
      </div>

      {conversation.can_moderate && reports.length > 0 && (
        <section className="mb-3 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-600/20">
          <h3 className="mb-2 font-medium text-amber-900">{t('conversation.reportsHeading', { count: reports.length })}</h3>
          <ul className="space-y-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded bg-white p-2 dark:bg-slate-900">
                <p className="text-xs text-slate-500">
                  {report.message_author_name
                    ? t('conversation.reportLine', {
                        reporter: report.reporter_name ?? t('common:fallback.someone'),
                        author: report.message_author_name,
                        reason: t(`reportModal.reasons.${report.reason}`),
                      })
                    : t('conversation.reportLineNoAuthor', {
                        reporter: report.reporter_name ?? t('common:fallback.someone'),
                        reason: t(`reportModal.reasons.${report.reason}`),
                      })}
                </p>
                {report.details && <p className="text-xs text-slate-600">{t('conversation.reportDetails', { details: report.details })}</p>}
                <p className="my-1 text-slate-700">{report.message_body || <em className="text-slate-400">{t('conversation.alreadyRemoved')}</em>}</p>
                <div className="flex gap-2">
                  <Button variant="danger" className="!py-1 text-xs" onClick={() => resolve.mutate({ reportId: report.id, action: 'hide' })}>{t('conversation.hideMessage')}</Button>
                  <Button variant="secondary" className="!py-1 text-xs" onClick={() => resolve.mutate({ reportId: report.id, action: 'dismiss' })}>{t('conversation.dismiss')}</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorNotice error={remove.error ?? restore.error ?? resolve.error ?? mute.error} />
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">{search ? t('conversation.noMatches') : t('conversation.noMessages')}</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((message) => {
            const state = conversationMessageState(message);
            const removed = state === 'hidden' ? t('conversation.hiddenByModerator') : state === 'deleted' ? t('conversation.messageDeleted') : null;
            const allowed = conversationMessageActions(message, conversation);
            const parent = message.reply_to_id ? byId.get(message.reply_to_id) : null;
            return (
              <DiscussionEntry
                key={message.id}
                authorName={message.author_name}
                body={message.body}
                createdAt={message.created_at}
                editedAt={message.edited_at}
                removedLabel={removed}
                mentions={message.mentions}
                showMentionOutcomes={message.is_mine}
                quote={parent
                  ? parent.body
                    ? t('conversation.quote', { author: parent.author_name ?? t('common:fallback.someone'), body: parent.body })
                    : t('conversation.quoteRemoved', { author: parent.author_name ?? t('common:fallback.someone') })
                  : null}
                canEdit={allowed.edit}
                onSaveEdit={async (body) => {
                  await api.editConversationMessage(conversationId, message.id, { body });
                  await refresh();
                }}
                actions={[
                  ...(allowed.reply ? [{ label: t('conversation.reply'), onClick: () => setReplyTo(message) }] : []),
                  ...(allowed.report ? [{ label: t('conversation.report'), onClick: () => setReporting(message) }] : []),
                  ...(allowed.delete
                    ? [{ label: t('common:actions.delete'), danger: true, onClick: () => { if (window.confirm(t('conversation.deleteConfirm'))) remove.mutate(message); } }]
                    : []),
                  ...(allowed.restore ? [{ label: t('common:actions.restore'), onClick: () => restore.mutate(message) }] : []),
                ]}
              />
            );
          })}
        </ul>
      )}
      {messages.next_before && !search && <p className="mb-2 text-xs text-slate-400">{t('conversation.showingLatest', { count: messages.data.length })}</p>}

      <DiscussionComposer
        candidates={candidates.data ?? []}
        placeholder={t('conversation.composerPlaceholder', { name: conversation.title })}
        submitLabel={t('common:actions.send')}
        context={replyTo
          ? replyTo.author_name
            ? t('conversation.replyingTo', { name: replyTo.author_name })
            : t('conversation.replyingToUnknown')
          : null}
        onClearContext={() => setReplyTo(null)}
        onSubmit={async ({ id, body, mentionIds }) => {
          await api.postConversationMessage(conversationId, { id, body, reply_to_id: replyTo?.id ?? null, mention_person_ids: mentionIds });
          await refresh();
        }}
      />
      <p className="mt-2 text-xs text-slate-400">
        {t('conversation.privacyNote')}
      </p>
      {reporting && <ReportModal conversationId={conversationId} message={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
};

/** Team and plan conversations the signed-in person currently belongs to. */
export const ChatPage = () => {
  const { t } = useTranslation(['messages', 'common']);
  const format = useFormatters();
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { user, can, organizationId } = useAuth();
  const client = useQueryClient();
  const conversations = useConversations();
  const teams = useTeams();
  const myId = user?.profile.id;
  const startable = chatStartableTeams(teams.data ?? [], myId, (team) =>
    can('scheduling.manage', { teamId: team.id, serviceTypeId: team.service_type_id })
    || can('teams.manage', { teamId: team.id, serviceTypeId: team.service_type_id }));
  const open = useMutation({
    mutationFn: (teamId: string) => api.openConversation({ kind: 'team', target_id: teamId }),
    onSuccess: async (conversation) => {
      await client.invalidateQueries({ queryKey: keys.conversations(organizationId) });
      navigate(`/chat/${conversation.id}`);
    },
  });

  return (
    <div>
      <PageHeader title={t('chatPage.title')} subtitle={t('chatPage.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3">
          <select
            className="input text-sm"
            value=""
            aria-label={t('chatPage.openTeamChat')}
            onChange={(event) => event.target.value && open.mutate(event.target.value)}
          >
            <option value="">{t('chatPage.openTeamChatOption')}</option>
            {startable.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          <ErrorNotice error={open.error ?? conversations.error} />
          {conversations.isLoading ? (
            <Loading />
          ) : (conversations.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">{t('chatPage.noConversations')}</p>
          ) : (
            <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
              {(conversations.data ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    to={`/chat/${conversation.id}`}
                    aria-current={conversation.id === conversationId ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 ${conversation.id === conversationId ? 'bg-brand-50 dark:bg-slate-800' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{conversationLabel(conversation, t, format)}</span>
                    {conversation.muted && <span title={t('chatPage.muted')} aria-label={t('chatPage.muted')}>🔕</span>}
                    {conversation.open_reports > 0 && <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">{t('chatPage.reports', { count: conversation.open_reports })}</Badge>}
                    {conversation.unread_count > 0 && (
                      <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white" aria-label={t('chatPage.unread', { count: conversation.unread_count })}>
                        {conversation.unread_count}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className="card min-w-0 p-4">
          {conversationId ? <ConversationThread key={conversationId} conversationId={conversationId} /> : (
            <p className="py-16 text-center text-sm text-slate-400">{t('chatPage.choose')}</p>
          )}
        </section>
      </div>
    </div>
  );
};
