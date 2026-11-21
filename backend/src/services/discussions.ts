import type {
  ConversationDetail,
  ConversationListPage,
  ConversationListRow,
  ConversationMessage,
  ConversationMessageReportRow,
  ConversationMessageRow,
  ConversationMessagesQuery,
  ConversationReport,
  ConversationSummary,
  DiscussionPage,
  DiscussionPageQuery,
  ListConversationsQuery,
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
import { CONVERSATIONS_PAGE_MAX, decodeConversationCursor, toConversationListPage } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { beforeFilter } from '../lib/keyset.js';
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
import { deliverEffectInBackground, deliverEffectNow } from './delivery-worker.js';

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
  const rows = await unwrap(
    caller.db.from('people_directory').select('id, profile_id, first_name, last_name').in('id', ids),
  );
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
  if (query.before) select = select.or(beforeFilter(query.before));
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
  await loadComment(caller, itemId, commentId); // 404 before mutating when the comment is on another item
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
  await loadComment(caller, itemId, commentId); // 404 before mutating when the comment is on another item
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

/**
 * One keyset page of the caller's conversations (W8-PERF-D3). Asks the
 * database for `limit + 1` rows so `has_more` is exact, then hands the cursor
 * of the last returned row to the client. An unreadable cursor is a 400.
 */
export const listConversations = async (caller: CollaborationCaller, query: ListConversationsQuery): Promise<ConversationListPage> => {
  const after = query.cursor ? decodeConversationCursor(query.cursor) : null;
  if (query.cursor && !after) throw HttpError.badRequest('Invalid cursor');
  const rows = (await unwrap(raw(caller.db).rpc('my_conversations_page', {
    p_organization_id: caller.orgId,
    p_limit: query.limit + 1,
    p_after_last: after ? (after.last ?? '-infinity') : null,
    p_after_created: after?.created ?? null,
    p_after_id: after?.id ?? null,
  }))) as ConversationListRow[] | null;
  return toConversationListPage(rows ?? [], query.limit);
};

/**
 * Every conversation as one plain array: the `GET /conversations` answer for
 * app builds from before paging (they send neither `cursor` nor `limit`).
 * Walks the keyset pages, so it is not capped like the old list was.
 */
export const listAllConversations = async (caller: CollaborationCaller): Promise<ConversationSummary[]> => {
  const all: ConversationSummary[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await listConversations(caller, { cursor, limit: CONVERSATIONS_PAGE_MAX });
    all.push(...page.items);
    if (!page.has_more || !page.next_cursor) return all;
    cursor = page.next_cursor;
  }
};

const conversationSummary = async (caller: CollaborationCaller, conversationId: string): Promise<ConversationSummary> => {
  const rows = await unwrap(caller.db.rpc('my_conversation', {
    p_organization_id: caller.orgId,
    p_conversation_id: conversationId,
  }));
  const summary = rows?.[0];
  if (!summary) throw HttpError.notFound('Conversation not found');
  return summary;
};

/**
 * 404 unless the caller can see the conversation in the active organization
 * (W7-MSG-D2). A plain RLS-scoped row lookup: unlike `conversationSummary` it
 * computes no unread count, so it stays cheap on every write and mark-read.
 */
const assertConversationInOrg = async (caller: CollaborationCaller, conversationId: string): Promise<void> => {
  const row = await unwrap(
    caller.db.from('conversations').select('id').eq('id', conversationId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Conversation not found');
};

export const openConversation = async (caller: CollaborationCaller, input: OpenConversationInput): Promise<ConversationSummary> => {
  const row = (await unwrap(raw(caller.db).rpc('open_conversation', { p_kind: input.kind, p_target: input.target_id }))) as { id: string; organization_id: string } | null;
  if (!row || row.organization_id !== caller.orgId) throw HttpError.notFound('Conversation not found');
  return conversationSummary(caller, row.id);
};

const shapeMessages = async (caller: CollaborationCaller, rows: readonly ConversationMessageRow[]): Promise<ConversationMessage[]> => {
  if (rows.length === 0) return [];
  const authorIds = new Set(rows.flatMap((row) => row.author_person_id ? [row.author_person_id] : []));
  const [mentionRows, names] = await Promise.all([
    unwrap(caller.db.from('conversation_message_mentions').select('message_id, person_id, resolution')
      .in('message_id', rows.map((row) => row.id))),
    directoryNames(caller, [...authorIds]),
  ]);
  const mentionNames = await directoryNames(caller, (mentionRows ?? [])
    .map((row) => row.person_id).filter((id) => !authorIds.has(id)));
  for (const [id, name] of mentionNames) names.set(id, name);
  const mentions = mentionsBy(mentionRows ?? [], 'message_id');
  return rows.map((row) =>
    toConversationMessage(row, mentions.get(row.id) ?? [], names,
      displayName(row.author_person_id ? names.get(row.author_person_id) : null), caller.userId));
};

const loadConversationMessages = async (
  caller: CollaborationCaller,
  conversationId: string,
  query: ConversationMessagesQuery,
): Promise<DiscussionPage<ConversationMessage>> => {
  let select = caller.db.from('conversation_messages').select('*').eq('conversation_id', conversationId);
  if (query.before) select = select.or(beforeFilter(query.before));
  if (query.q) select = select.textSearch('search', query.q, { type: 'plain', config: 'simple' });
  const rows = (await unwrap(
    select.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit + 1),
  )) ?? [];
  const page = pageOf(rows, query.limit);
  return { data: await shapeMessages(caller, page.data), next_before: page.next_before };
};

export const listConversationMessages = async (
  caller: CollaborationCaller,
  conversationId: string,
  query: ConversationMessagesQuery,
): Promise<DiscussionPage<ConversationMessage>> => {
  const conversation = await conversationSummary(caller, conversationId);
  return loadConversationMessages(caller, conversation.id, query);
};

const shapeReports = async (caller: CollaborationCaller, rows: readonly ConversationMessageReportRow[]): Promise<ConversationReport[]> => {
  if (rows.length === 0) return [];
  const [messageRows, reporters] = await Promise.all([
    unwrap(caller.db.from('conversation_messages').select('*').in('id', [...new Set(rows.map((row) => row.message_id))])),
    unwrap(caller.db.from('profiles').select('id, full_name').in('id', [...new Set(rows.map((row) => row.reporter_id))])),
  ]);
  const messages = messageRows ?? [];
  const names = await directoryNames(caller, messages.map((m) => m.author_person_id).filter((id): id is string => Boolean(id)));
  const byId = new Map(messages.map((message) => [message.id, message]));
  const reporterNames = new Map((reporters ?? []).map((r) => [r.id, r.full_name]));
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

const loadOpenReports = async (caller: CollaborationCaller, conversationId: string): Promise<ConversationReport[]> => {
  const rows = await unwrap(caller.db.from('conversation_message_reports').select('*').eq('conversation_id', conversationId)
    .eq('status', 'open').order('created_at', { ascending: true }).limit(50));
  return shapeReports(caller, rows ?? []);
};

export const getConversation = async (
  caller: CollaborationCaller,
  conversationId: string,
  query: DiscussionPageQuery,
): Promise<ConversationDetail> => {
  const conversation = await conversationSummary(caller, conversationId);
  const [messages, reports] = await Promise.all([
    loadConversationMessages(caller, conversation.id, query),
    conversation.can_moderate ? loadOpenReports(caller, conversation.id) : [],
  ]);
  return { conversation, messages, reports };
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
  await assertConversationInOrg(caller, conversationId);
  const rows = (await unwrap(raw(caller.db).rpc('post_conversation_message', {
    p_message_id: input.id,
    p_conversation: conversationId,
    p_body: input.body,
    p_reply_to: input.reply_to_id,
    p_mentions: input.mention_person_ids,
  }))) as PostResultRow[] | null;
  const result = rows?.[0];
  if (!result) throw new HttpError(500, 'The message was not stored');
  // Notifications go out after the response so the sender never waits on them.
  if (!result.replayed) deliverEffectInBackground(result.effect_id);
  return { item: await loadMessage(caller, conversationId, input.id), replayed: result.replayed };
};

export const editConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string, body: string,
): Promise<ConversationMessage> => {
  await assertConversationInOrg(caller, conversationId);
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('edit_conversation_message', { p_message_id: messageId, p_body: body }));
  return loadMessage(caller, conversationId, messageId);
};

export const deleteConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string,
): Promise<ConversationMessage> => {
  await assertConversationInOrg(caller, conversationId);
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('delete_conversation_message', { p_message_id: messageId }));
  return loadMessage(caller, conversationId, messageId);
};

export const restoreConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string,
): Promise<ConversationMessage> => {
  await assertConversationInOrg(caller, conversationId);
  await loadMessage(caller, conversationId, messageId);
  await unwrap(raw(caller.db).rpc('restore_conversation_message', { p_message_id: messageId }));
  return loadMessage(caller, conversationId, messageId);
};

export const markConversationRead = async (
  caller: CollaborationCaller, conversationId: string, readAt: string,
): Promise<{ last_read_at: string | null }> => {
  await assertConversationInOrg(caller, conversationId);
  const row = (await unwrap(raw(caller.db).rpc('mark_conversation_read', { p_conversation: conversationId, p_read_at: readAt }))) as { last_read_at: string | null } | null;
  return { last_read_at: row?.last_read_at ?? null };
};

export const muteConversation = async (
  caller: CollaborationCaller, conversationId: string, muted: boolean,
): Promise<{ muted: boolean }> => {
  await assertConversationInOrg(caller, conversationId);
  const row = (await unwrap(raw(caller.db).rpc('set_conversation_muted', { p_conversation: conversationId, p_muted: muted }))) as { muted: boolean } | null;
  return { muted: row?.muted ?? muted };
};

export const reportConversationMessage = async (
  caller: CollaborationCaller, conversationId: string, messageId: string, input: ReportConversationMessageInput,
): Promise<ConversationReport> => {
  await assertConversationInOrg(caller, conversationId);
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
  // Moderators need not be participants (`can_moderate_conversation`), so the
  // report row itself -- RLS: reporter or moderator -- carries the org check (W7-MSG-D2).
  const existing = await unwrap(
    caller.db.from('conversation_message_reports').select('id')
      .eq('id', reportId).eq('conversation_id', conversationId).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (!existing) throw HttpError.notFound('Report not found');
  const row = (await unwrap(raw(caller.db).rpc('resolve_conversation_report', {
    p_report: reportId, p_action: input.action, p_note: input.note ?? null,
  }))) as ConversationMessageReportRow;
  const [report] = await shapeReports(caller, [row]);
  if (!report) throw HttpError.notFound('Report not found');
  return report;
};
