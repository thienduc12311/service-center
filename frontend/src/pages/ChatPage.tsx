import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONVERSATION_REPORT_REASON_LABELS,
  formatDate,
  type ConversationMessage,
  type ConversationReportReason,
  type ConversationSummary,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useConversation, useConversations, useMentionCandidates, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Badge, Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { DiscussionComposer } from '../components/collaboration/DiscussionComposer';
import { DiscussionEntry } from '../components/collaboration/DiscussionEntry';

const REPORT_REASONS = Object.keys(CONVERSATION_REPORT_REASON_LABELS) as ConversationReportReason[];

const conversationLabel = (conversation: ConversationSummary): string =>
  conversation.kind === 'plan' && conversation.service_date
    ? `${conversation.title} · ${formatDate(conversation.service_date)}`
    : conversation.title;

const ReportModal = ({ conversationId, message, onClose }: { conversationId: string; message: ConversationMessage; onClose: () => void }) => {
  const [reason, setReason] = useState<ConversationReportReason>('inappropriate');
  const [details, setDetails] = useState('');
  const report = useMutation({ mutationFn: () => api.reportConversationMessage(conversationId, message.id, { reason, details: details || undefined }) });
  return (
    <Modal open title="Report message" onClose={onClose}>
      {report.isSuccess ? (
        <>
          <p className="text-sm text-slate-600">Thanks. The conversation’s moderators will review it. Reporting again does not create a second report.</p>
          <div className="mt-6 flex justify-end"><Button onClick={onClose}>Done</Button></div>
        </>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="rounded bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-900">{message.body}</p>
          <select className="input" value={reason} onChange={(event) => setReason(event.target.value as ConversationReportReason)} aria-label="Reason">
            {REPORT_REASONS.map((value) => <option key={value} value={value}>{CONVERSATION_REPORT_REASON_LABELS[value]}</option>)}
          </select>
          <textarea className="input" rows={3} maxLength={1000} placeholder="Anything moderators should know (optional)" value={details} onChange={(event) => setDetails(event.target.value)} />
          <ErrorNotice error={report.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button loading={report.isPending} onClick={() => report.mutate()}>Report</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

const ConversationThread = ({ conversationId }: { conversationId: string }) => {
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
    enabled: search.trim().length >= 2,
  });
  const refresh = () => client.invalidateQueries({ queryKey: keys.conversations(organizationId) });

  const newest = detail.data?.messages.data.at(-1)?.created_at;
  useEffect(() => {
    // Reading the thread moves the read position forward (never back).
    if (newest && (detail.data?.conversation.unread_count ?? 0) > 0) {
      void api.markConversationRead(conversationId, newest).then(refresh);
    }
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
        title="Conversation not available"
        description="Conversations are open to the people on that team or plan. If you were removed, you can no longer read it."
      />
    );
  }
  const { conversation, messages, reports } = detail.data;
  const byId = new Map(messages.data.map((message) => [message.id, message]));
  const shown = search.trim().length >= 2 ? results.data?.data ?? [] : messages.data;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{conversationLabel(conversation)}</h2>
        <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{conversation.kind === 'team' ? 'Team' : 'Plan'}</Badge>
        {conversation.plan_id && <Link className="text-xs text-brand-600 hover:underline" to={`/plans/${conversation.plan_id}`}>Open plan</Link>}
        <div className="ml-auto flex items-center gap-2">
          <input className="input !w-44 text-sm" placeholder="Search…" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search this conversation" />
          <Button variant="secondary" loading={mute.isPending} onClick={() => mute.mutate(!conversation.muted)}>
            {conversation.muted ? 'Unmute' : 'Mute'}
          </Button>
        </div>
      </div>

      {conversation.can_moderate && reports.length > 0 && (
        <section className="mb-3 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-amber-600/20">
          <h3 className="mb-2 font-medium text-amber-900">Reports to review ({reports.length})</h3>
          <ul className="space-y-2">
            {reports.map((report) => (
              <li key={report.id} className="rounded bg-white p-2 dark:bg-slate-900">
                <p className="text-xs text-slate-500">
                  {report.reporter_name ?? 'Someone'} reported {report.message_author_name ?? 'a message'} · {CONVERSATION_REPORT_REASON_LABELS[report.reason]}
                </p>
                {report.details && <p className="text-xs text-slate-600">“{report.details}”</p>}
                <p className="my-1 text-slate-700">{report.message_body || <em className="text-slate-400">Already removed</em>}</p>
                <div className="flex gap-2">
                  <Button variant="danger" className="!py-1 text-xs" onClick={() => resolve.mutate({ reportId: report.id, action: 'hide' })}>Hide message</Button>
                  <Button variant="secondary" className="!py-1 text-xs" onClick={() => resolve.mutate({ reportId: report.id, action: 'dismiss' })}>Dismiss</Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ErrorNotice error={remove.error ?? restore.error ?? resolve.error ?? mute.error} />
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">{search ? 'No messages match.' : 'No messages yet. Say hello to the team.'}</p>
      ) : (
        <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
          {shown.map((message) => {
            const removed = message.hidden_at ? 'Hidden by a moderator' : message.deleted_at ? 'Message deleted' : null;
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
                quote={parent ? `${parent.author_name ?? 'Someone'}: ${parent.body || '(removed)'}` : null}
                canEdit={message.is_mine}
                onSaveEdit={async (body) => {
                  await api.editConversationMessage(conversationId, message.id, { body });
                  await refresh();
                }}
                actions={[
                  ...(!removed ? [{ label: 'Reply', onClick: () => setReplyTo(message) }] : []),
                  ...(!removed && !message.is_mine ? [{ label: 'Report', onClick: () => setReporting(message) }] : []),
                  ...(!removed && (message.is_mine || conversation.can_moderate)
                    ? [{ label: 'Delete', danger: true, onClick: () => { if (window.confirm('Delete this message?')) remove.mutate(message); } }]
                    : []),
                  ...(message.hidden_at && conversation.can_moderate ? [{ label: 'Restore', onClick: () => restore.mutate(message) }] : []),
                ]}
              />
            );
          })}
        </ul>
      )}
      {messages.next_before && !search && <p className="mb-2 text-xs text-slate-400">Showing the latest {messages.data.length} messages.</p>}

      <DiscussionComposer
        candidates={candidates.data ?? []}
        placeholder={`Message ${conversation.title}…`}
        submitLabel="Send"
        context={replyTo ? `Replying to ${replyTo.author_name ?? 'someone'}` : null}
        onClearContext={() => setReplyTo(null)}
        onSubmit={async ({ id, body, mentionIds }) => {
          await api.postConversationMessage(conversationId, { id, body, reply_to_id: replyTo?.id ?? null, mention_person_ids: mentionIds });
          await refresh();
        }}
      />
      <p className="mt-2 text-xs text-slate-400">
        Only current team or plan members can read this. Muting stops notifications. Direct messages and attachments are not available yet.
      </p>
      {reporting && <ReportModal conversationId={conversationId} message={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
};

/** Team and plan conversations the signed-in person currently belongs to. */
export const ChatPage = () => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const { user, can, organizationId } = useAuth();
  const client = useQueryClient();
  const conversations = useConversations();
  const teams = useTeams();
  const myId = user?.profile.id;
  const startable = (teams.data ?? []).filter((team) =>
    team.members.some((member) => member.user_id === myId)
    || can('scheduling.manage', { teamId: team.id, serviceTypeId: team.service_type_id })
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
      <PageHeader title="Chat" subtitle="Team and plan conversations." />
      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <aside className="space-y-3">
          <select
            className="input text-sm"
            value=""
            aria-label="Open a team chat"
            onChange={(event) => event.target.value && open.mutate(event.target.value)}
          >
            <option value="">Open a team chat…</option>
            {startable.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
          <ErrorNotice error={open.error ?? conversations.error} />
          {conversations.isLoading ? (
            <Loading />
          ) : (conversations.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">No conversations yet. Open your team’s chat, or a plan’s chat from the plan page.</p>
          ) : (
            <ul className="card divide-y divide-slate-100 dark:divide-slate-800">
              {(conversations.data ?? []).map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    to={`/chat/${conversation.id}`}
                    aria-current={conversation.id === conversationId ? 'page' : undefined}
                    className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900 ${conversation.id === conversationId ? 'bg-brand-50 dark:bg-slate-800' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{conversationLabel(conversation)}</span>
                    {conversation.muted && <span title="Muted" aria-label="Muted">🔕</span>}
                    {conversation.open_reports > 0 && <Badge tone="bg-amber-50 text-amber-800 ring-amber-600/20">{conversation.open_reports} report{conversation.open_reports === 1 ? '' : 's'}</Badge>}
                    {conversation.unread_count > 0 && (
                      <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white" aria-label={`${conversation.unread_count} unread`}>
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
            <p className="py-16 text-center text-sm text-slate-400">Choose a conversation.</p>
          )}
        </section>
      </div>
    </div>
  );
};
