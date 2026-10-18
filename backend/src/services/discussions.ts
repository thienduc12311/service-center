import type {
  ConversationDetail,
  ConversationMessage,
  ConversationMessageReportRow,
  ConversationMessageRow,
  ConversationMessagesQuery,
  ConversationReport,
  ConversationSummary,
  DiscussionPage,
  DiscussionPageQuery,
  MentionCandidate,
  OpenConversationInput,
  PlanItemComment,
  PlanItemCommentRow,
  PlanItemThread,
  PostConversationMessageInput,
  PostDiscussionResult,
  PostItemCommentInput,
  ReportConversationMessageInput,
  ResolveConversationReportInput,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import {
  displayName,
  pageOf,
  toConversationMessage,
  toItemComment,
  type CollaborationCaller,
  type DirectoryName,
  type MentionRecord,
} from '../model/collaboration.model.js';
import { deliverEffectNow } from './delivery-worker.js';

/**
 * F09 item discussion and team/plan conversations. Reads use the caller's
 * RLS-bound client (participants are derived from current team/plan state
 * on every query); writes go through the database functions, which recheck
 * access, keep client-chosen ids idempotent and enqueue notifications.
 */

interface PostResultRow {
  comment_id?: string;
  message_id?: string;
  replayed: boolean;
  effect_id: string | null;
}

const directoryNames = async (caller: CollaborationCaller, personIds: readonly string[]): Promise<Map<string, DirectoryName>> => {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return new Map();
  const rows = (await unwrap(
    raw(caller.db).from('people_directory').select('id, profile_id, first_name, last_name').in('id', ids),
  )) as DirectoryName[] | null;
  return new Map((rows ?? []).map((row) => [row.id, row]));
};

const mentionsBy = <K extends string>(rows: ReadonlyArray<Record<K, string> & MentionRecord>, key: K): Map<string, MentionRecord[]> => {
  const grouped = new Map<string, MentionRecord[]>();
  for (const row of rows) {
    grouped.set(row[key], [...(grouped.get(row[key]) ?? []), { person_id: row.person_id, resolution: row.resolution }]);
  }
  return grouped;
};

// ------------------------------------------------------------ item threads --

const loadItem = async (caller: CollaborationCaller, itemId: string): Promise<{ id: string; plan_id: string }> => {
  const item = (await unwrap(
    raw(caller.db).from('plan_items').select('id, plan_id, plan:plans!inner(organization_id)')
      .eq('id', itemId).eq('plan.organization_id', caller.orgId).maybeSingle(),
  )) as { id: string; plan_id: string } | null;
  if (!item) throw HttpError.notFound('Item not found');
  const canRead = await unwrap(raw(caller.db).rpc('can_read_item_thread', { p_plan: item.plan_id }));
  // Same answer for "no such item" and "not on this plan's team".
  if (canRead !== true) throw HttpError.notFound('This discussion is only open to people on this plan');
  return item;
};

const shapeComments = async (caller: CollaborationCaller, rows: readonly PlanItemCommentRow[]): Promise<PlanItemComment[]> => {
  if (rows.length === 0) return [];
  const mentionRows = (await unwrap(
    caller.db.from('plan_item_comment_mentions').select('comment_id, person_id, resolution').in('comment_id', rows.map((row) => row.id)),
  )) ?? [];
  const names = await directoryNames(caller, [
    ...mentionRows.map((row) => row.person_id),
    ...rows.map((row) => row.author_person_id).filter((id): id is string => Boolean(id)),
  ]);
  const mentions = mentionsBy(mentionRows, 'comment_id');
  return rows.map((row) =>
    toItemComment(row, mentions.get(row.id) ?? [], names,
      displayName(row.author_person_id ? names.get(row.author_person_id) : null), caller.userId));
};

export const listItemComments = async (
  caller: CollaborationCaller,
  itemId: string,
  query: DiscussionPageQuery,
): Promise<PlanItemThread> => {
  const item = await loadItem(caller, itemId);
  let select = caller.db.from('plan_item_comments').select('*').eq('plan_item_id', item.id);
  if (query.before) select = select.lt('created_at', query.before);
  const rows = (await unwrap(
    select.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit + 1),
  )) ?? [];
  const page = pageOf(rows, query.limit);
  const canModerate = await unwrap(raw(caller.db).rpc('can_edit_plan', { p_plan: item.plan_id }));
  return { data: await shapeComments(caller, page.data), next_before: page.next_before, can_moderate: canModerate === true };
};

const loadComment = async (caller: CollaborationCaller, itemId: string, commentId: string): Promise<PlanItemComment> => {
  const row = await unwrapOne(
    caller.db.from('plan_item_comments').select('*').eq('id', commentId).eq('plan_item_id', itemId).maybeSingle(),
  );
  const [comment] = await shapeComments(caller, [row]);
  if (!comment) throw HttpError.notFound('Comment not found');
  return comment;
};

export const postItemComment = async (
  caller: CollaborationCaller,
  itemId: string,
  input: PostItemCommentInput,
): Promise<PostDiscussionResult<PlanItemComment>> => {
  await loadItem(caller, itemId);
  const rows = (await unwrap(raw(caller.db).rpc('post_item_comment', {
    p_comment_id: input.id,
    p_plan_item: itemId,
    p_body: input.body,
    p_mentions: input.mention_person_ids,
  }))) as PostResultRow[] | null;
  const result = rows?.[0];
  if (!result) throw new HttpError(500, 'The comment was not stored');
  if (!result.replayed) await deliverEffectNow(result.effect_id);
  return { item: await loadComment(caller, itemId, input.id), replayed: result.replayed };
};

export const editItemComment = async (caller: CollaborationCaller, itemId: string, commentId: string, body: string): Promise<PlanItemComment> => {
  await loadItem(caller, itemId);
  await unwrap(raw(caller.db).rpc('edit_item_comment', { p_comment_id: commentId, p_body: body }));
  return loadComment(caller, itemId, commentId);
};

export const deleteItemComment = async (
  caller: CollaborationCaller,
  itemId: string,
  commentId: string,
  reason: string | undefined,
): Promise<PlanItemComment> => {
  await loadItem(caller, itemId);
  await unwrap(raw(caller.db).rpc('delete_item_comment', { p_comment_id: commentId, p_reason: reason ?? null }));
  return loadComment(caller, itemId, commentId);
};

export const mentionCandidates = async (
  caller: CollaborationCaller,
  target: { planId?: string; conversationId?: string },
): Promise<MentionCandidate[]> => {
  const rows = (await unwrap(raw(caller.db).rpc('discussion_mention_candidates', {
    p_plan: target.planId ?? null,
    p_conversation: target.conversationId ?? null,
  }))) as Array<{ person_id: string; first_name: string; last_name: string | null }> | null;
  return (rows ?? []).map((row) => ({ person_id: row.person_id, name: displayName(row) ?? 'Someone' }));
};

// ----------------------------------------------------------- conversations --

export const listConversations = async (caller: CollaborationCaller): Promise<ConversationSummary[]> =>
  ((await unwrap(raw(caller.db).rpc('my_conversations', { p_organization_id: caller.orgId }))) as ConversationSummary[] | null) ?? [];

const conversationSummary = async (caller: CollaborationCaller, conversationId: string): Promise<ConversationSummary> => {
  const summary = (await listConversations(caller)).find((row) => row.id === conversationId);
  if (summary) return summary;
  // Beyond the 100 most recent, or no access: decide by RLS on the row.
  const row = await unwrap(
    caller.db.from('conversations').select('*').eq('id', conversationId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Conversation not found');
  return {
    id: row.id, kind: row.kind, team_id: row.team_id, plan_id: row.plan_id, title: row.kind === 'team' ? 'Team' : 'Plan',
    service_date: null, last_message_at: null, unread_count: 0, muted: false, can_moderate: false, open_reports: 0,
  };
};

export const openConversation = async (caller: CollaborationCaller, input: OpenConversationInput): Promise<ConversationSummary> => {
  const row = (await unwrap(raw(caller.db).rpc('open_conversation', { p_kind: input.kind, p_target: input.target_id }))) as { id: string; organization_id: string } | null;
  if (!row || row.organization_id !== caller.orgId) throw HttpError.notFound('Conversation not found');
  return conversationSummary(caller, row.id);
};

const shapeMessages = async (caller: CollaborationCaller, rows: readonly ConversationMessageRow[]): Promise<ConversationMessage[]> => {
  if (rows.length === 0) return [];
  const mentionRows = (await unwrap(
    caller.db.from('conversation_message_mentions').select('message_id, person_id, resolution').in('message_id', rows.map((row) => row.id)),
  )) ?? [];
  const names = await directoryNames(caller, [
    ...mentionRows.map((row) => row.person_id),
    ...rows.map((row) => row.author_person_id).filter((id): id is string => Boolean(id)),
  ]);
  const mentions = mentionsBy(mentionRows, 'message_id');
  return rows.map((row) =>
    toConversationMessage(row, mentions.get(row.id) ?? [], names,
      displayName(row.author_person_id ? names.get(row.author_person_id) : null), caller.userId));
};

export const listConversationMessages = async (
  caller: CollaborationCaller,
  conversationId: string,
  query: ConversationMessagesQuery,
): Promise<DiscussionPage<ConversationMessage>> => {
  await conversationSummary(caller, conversationId);
  let select = caller.db.from('conversation_messages').select('*').eq('conversation_id', conversationId);
  if (query.before) select = select.lt('created_at', query.before);
  if (query.q) select = select.textSearch('search', query.q, { type: 'plain', config: 'simple' });
  const rows = (await unwrap(
    select.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit + 1),
  )) ?? [];
  const page = pageOf(rows, query.limit);
  return { data: await shapeMessages(caller, page.data), next_before: page.next_before };
};

const shapeReports = async (caller: CollaborationCaller, rows: readonly ConversationMessageReportRow[]): Promise<ConversationReport[]> => {
  if (rows.length === 0) return [];
  const messages = (await unwrap(
    caller.db.from('conversation_messages').select('*').in('id', [...new Set(rows.map((row) => row.message_id))]),
  )) ?? [];
  const reporters = (await unwrap(
    caller.db.from('profiles').select('id, full_name').in('id', [...new Set(rows.map((row) => row.reporter_id))]),
  )) ?? [];
  const names = await directoryNames(caller, messages.map((m) => m.author_person_id).filter((id): id is string => Boolean(id)));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const reporterNames = new Map(reporters.map((r) => [r.id, r.full_name]));
  return rows.map((row) => {
    const message = byId.get(row.message_id);
    return {
      ...row,
      reporter_name: reporterNames.get(row.reporter_id) ?? null,
      message_body: message?.body ?? '',
      message_author_name: displayName(message?.author_person_id ? names.get(message.author_person_id) : null),
    };
  });
};

export const getConversation = async (
  caller: CollaborationCaller,
  conversationId: string,
  query: DiscussionPageQuery,
): Promise<ConversationDetail> => {
  const conversation = await conversationSummary(caller, conversationId);
  const [messages, reports] = await Promise.all([
    listConversationMessages(caller, conversationId, query),
    conversation.can_moderate
      ? unwrap(caller.db.from('conversation_message_reports').select('*').eq('conversation_id', conversationId)
          .eq('status', 'open').order('created_at', { ascending: true }).limit(50))
      : Promise.resolve([]),
  ]);
  return { conversation, messages, reports: await shapeReports(caller, reports ?? []) };
};

const loadMessage = async (caller: CollaborationCaller, conversationId: string, messageId: string): Promise<ConversationMessage> => {
  const row = await unwrapOne(
    caller.db.from('conversation_messages').select('*').eq('id', messageId).eq('conversation_id', conversationId).maybeSingle(),
  );
  const [message] = await shapeMessages(caller, [row]);
  if (!message) throw HttpError.notFound('Message not found');
  return message;
};

export const postConversationMessage = async (
  caller: CollaborationCaller,
  conversationId: string,
  input: PostConversationMessageInput,
): Promise<PostDiscussionResult<ConversationMessage>> => {
  const rows = (await unwrap(raw(caller.db).rpc('post_conversation_message', {
    p_message_id: input.id,
    p_conversation: conversationId,
    p_body: input.body,
    p_reply_to: input.reply_to_id,
    p_mentions: input.mention_person_ids,
  }))) as PostResultRow[] | null;
  const result = rows?.[0];
  if (!result) throw new HttpError(500, 'The message was not stored');
  if (!result.replayed) await deliverEffectNow(result.effect_id);
  return { item: await loadMessage(caller, conversationId, input.id), replayed: result.replayed };
};

export const editConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string, body: string,
): Promise<ConversationMessage> => {
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('edit_conversation_message', { p_message_id: messageId, p_body: body }));
  return loadMessage(caller, conversationId, messageId);
};

export const deleteConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string,
): Promise<ConversationMessage> => {
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('delete_conversation_message', { p_message_id: messageId }));
  return loadMessage(caller, conversationId, messageId);
};

export const restoreConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string,
): Promise<ConversationMessage> => {
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('restore_conversation_message', { p_message_id: messageId }));
  return loadMessage(caller, conversationId, messageId);
};

export const markConversationRead = async (
  caller: CollaborationCaller, conversationId: string, readAt: string,
): Promise<{ last_read_at: string | null }> => {
  const row = (await unwrap(raw(caller.db).rpc('mark_conversation_read', { p_conversation: conversationId, p_read_at: readAt }))) as { last_read_at: string | null } | null;
  return { last_read_at: row?.last_read_at ?? null };
};

export const muteConversation = async (
  caller: CollaborationCaller, conversationId: string, muted: boolean,
): Promise<{ muted: boolean }> => {
  const row = (await unwrap(raw(caller.db).rpc('set_conversation_muted', { p_conversation: conversationId, p_muted: muted }))) as { muted: boolean } | null;
  return { muted: row?.muted ?? muted };
};

export const reportConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string, input: ReportConversationMessageInput,
): Promise<ConversationReport> => {
  await loadMessage(caller, conversationId, messageId);
  const row = (await unwrap(raw(caller.db).rpc('report_conversation_message', {
    p_message_id: messageId, p_reason: input.reason, p_details: input.details ?? null,
  }))) as ConversationMessageReportRow;
  const [report] = await shapeReports(caller, [row]);
  if (!report) throw HttpError.notFound('Report not found');
  return report;
};

export const resolveConversationReport = async (
  caller: CollaborationCaller, conversationId: string, reportId: string, input: ResolveConversationReportInput,
): Promise<ConversationReport> => {
  const existing = await unwrap(
    caller.db.from('conversation_message_reports').select('id').eq('id', reportId).eq('conversation_id', conversationId).maybeSingle(),
  );
  if (!existing) throw HttpError.notFound('Report not found');
  const row = (await unwrap(raw(caller.db).rpc('resolve_conversation_report', {
    p_report: reportId, p_action: input.action, p_note: input.note ?? null,
  }))) as ConversationMessageReportRow;
  const [report] = await shapeReports(caller, [row]);
  if (!report) throw HttpError.notFound('Report not found');
  return report;
};
