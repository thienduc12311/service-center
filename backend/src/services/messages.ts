import {
  messageVariableValues,
  renderMessageTemplate,
  type ListOperationalMessagesQuery,
  type MessageAudienceInput,
  type MessageAudiencePreview,
  type MessageTemplateList,
  type MessageTemplateRow,
  type OperationalMessageDetail,
  type OperationalMessageRow,
  type OperationalMessageSummary,
  type OperationalMessageView,
  type SaveMessageTemplateInput,
  type SendOperationalMessageInput,
  type SendOperationalMessageResult,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { beforeFilter } from '../lib/keyset.js';
import { raw, unwrap } from '../lib/supabase.js';
import { groupMessageOutcomes, type CollaborationCaller, type MessageOutcomeRow } from '../model/collaboration.model.js';
import { deliverEffectNow } from './delivery-worker.js';

/**
 * F09 targeted operational messages. Audience resolution, the versioned
 * recipient snapshot and the outbox effect all live in the database
 * functions; this layer validates, delivers the new effect right away and
 * shapes reads. Nothing here sees an email address.
 */

interface SendResultRow {
  message_id: string;
  effect_id: string | null;
  replayed: boolean;
}

/** Audience exactly as stored and hashed: stable key order, no undefined. */
const audiencePayload = (audience: MessageAudienceInput): Record<string, unknown> => ({
  plan_id: audience.plan_id ?? null,
  team_ids: [...audience.team_ids].sort(),
  include: [...audience.include].sort(),
});

export const previewMessage = async (caller: CollaborationCaller, audience: MessageAudienceInput): Promise<MessageAudiencePreview> =>
  (await unwrap(raw(caller.db).rpc('preview_operational_message', {
    p_organization_id: caller.orgId,
    p_audience: audiencePayload(audience),
  }))) as MessageAudiencePreview;

/** The sender/administrator row carries the audit columns; the recipient view does not. */
const isFullRow = (message: OperationalMessageView | OperationalMessageRow): message is OperationalMessageRow =>
  'audience' in message;

/**
 * Senders and administrators read the stored row (RLS admits only them).
 * Anyone else who received the message gets the recipient-safe columns from
 * `my_received_messages` (W7-MSG-D6) -- RLS cannot hide audit columns.
 */
const loadMessage = async (caller: CollaborationCaller, id: string): Promise<OperationalMessageView | OperationalMessageRow> => {
  const row = await unwrap(
    caller.db.from('operational_messages').select('*').eq('id', id).eq('organization_id', caller.orgId).maybeSingle(),
  );
  if (row) return row;
  const received = await unwrap(
    raw(caller.db).rpc('my_received_messages', { p_organization_id: caller.orgId }).eq('id', id).maybeSingle(),
  ) as OperationalMessageView | null;
  if (!received) throw HttpError.notFound('Message not found');
  return received;
};

/** The full row for a message just sent, which only its sender can have. */
const loadSentMessage = async (caller: CollaborationCaller, id: string): Promise<OperationalMessageRow> => {
  const message = await loadMessage(caller, id);
  if (!isFullRow(message)) throw HttpError.notFound('Message not found');
  return message;
};

export const sendMessage = async (caller: CollaborationCaller, input: SendOperationalMessageInput): Promise<SendOperationalMessageResult> => {
  if (input.template_id) {
    // An archived template can no longer be chosen (W7-MSG-D8); an unreadable one is left to the database's 404.
    const template = await unwrap(
      caller.db.from('message_templates').select('archived_at').eq('id', input.template_id).eq('organization_id', caller.orgId).maybeSingle(),
    );
    if (template?.archived_at) throw HttpError.unprocessable('That template has been archived');
  }
  const rows = (await unwrap(raw(caller.db).rpc('send_operational_message', {
    p_organization_id: caller.orgId,
    p_audience: audiencePayload(input.audience),
    p_subject: input.subject,
    p_body: input.body,
    p_template_id: input.template_id,
    p_excluded_person_ids: input.excluded_person_ids,
    p_expected_audience_hash: input.audience_hash,
    p_idempotency_key: input.idempotency_key,
  }))) as SendResultRow[] | null;
  const result = rows?.[0];
  if (!result) throw new HttpError(500, 'The message was not stored');
  if (!result.replayed) await deliverEffectNow(result.effect_id);
  return { message: await loadSentMessage(caller, result.message_id), replayed: result.replayed };
};

const senderNames = async (caller: CollaborationCaller, ids: readonly string[]): Promise<Map<string, string | null>> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = (await unwrap(caller.db.from('profiles').select('id, full_name').in('id', unique))) ?? [];
  return new Map(rows.map((row) => [row.id, row.full_name]));
};

const isAdmin = async (caller: CollaborationCaller): Promise<boolean> =>
  (await unwrap(raw(caller.db).rpc('is_org_admin', { org: caller.orgId }))) === true;

export const listMessages = async (
  caller: CollaborationCaller,
  query: ListOperationalMessagesQuery,
): Promise<OperationalMessageSummary[]> => {
  const rows: Array<OperationalMessageView | OperationalMessageRow> = query.box === 'received'
    ? await listReceived(caller, query)
    : await listSent(caller, query);
  const names = await senderNames(caller, rows.map((row) => row.created_by));
  return rows.map((row) => ({ ...row, sender_name: names.get(row.created_by) ?? null, sent_by_me: row.created_by === caller.userId }));
};

const listReceived = async (caller: CollaborationCaller, query: ListOperationalMessagesQuery): Promise<OperationalMessageView[]> => {
  let select = raw(caller.db).rpc('my_received_messages', { p_organization_id: caller.orgId });
  if (query.plan_id) select = select.eq('plan_id', query.plan_id);
  if (query.before) select = select.or(beforeFilter(query.before));
  return ((await unwrap(select.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit))) ?? []) as OperationalMessageView[];
};

const listSent = async (caller: CollaborationCaller, query: ListOperationalMessagesQuery): Promise<OperationalMessageRow[]> => {
  let select = caller.db.from('operational_messages').select('*').eq('organization_id', caller.orgId);
  if (query.plan_id) select = select.eq('plan_id', query.plan_id);
  if (!(await isAdmin(caller))) select = select.eq('created_by', caller.userId);
  if (query.before) select = select.or(beforeFilter(query.before));
  return (await unwrap(select.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(query.limit))) ?? [];
};

export const getMessage = async (caller: CollaborationCaller, id: string): Promise<OperationalMessageDetail> => {
  const message = await loadMessage(caller, id);
  const [names, mine] = await Promise.all([
    senderNames(caller, [message.created_by]),
    unwrap(caller.db.from('operational_message_recipients').select('first_name, last_name')
      .eq('message_id', id).eq('profile_id', caller.userId).eq('status', 'included').maybeSingle()),
  ]);
  const values = mine ? messageVariableValues(mine, message.variables) : null;
  const renderedForMe = values
    ? { subject: renderMessageTemplate(message.subject, values), body: renderMessageTemplate(message.body, values) }
    : null;
  if (!isFullRow(message)) {
    return { message, sender_name: names.get(message.created_by) ?? null, can_retry: false, rendered_for_me: renderedForMe };
  }
  const rows = (await unwrap(raw(caller.db).rpc('operational_message_outcomes', { p_message: id }))) as MessageOutcomeRow[] | null;
  const outcomes = groupMessageOutcomes(rows ?? []);
  return {
    message,
    sender_name: names.get(message.created_by) ?? null,
    outcomes,
    can_retry: outcomes.some((outcome) => outcome.retryable),
    rendered_for_me: renderedForMe,
  };
};

export const retryMessage = async (
  caller: CollaborationCaller,
  id: string,
  personIds: readonly string[] | undefined,
): Promise<{ requeued: number }> => {
  await loadMessage(caller, id);
  const requeued = (await unwrap(raw(caller.db).rpc('retry_operational_message', {
    p_message: id,
    p_person_ids: personIds && personIds.length > 0 ? personIds : null,
  }))) as number;
  if (requeued > 0) {
    const effect = await unwrap(
      caller.db.from('delivery_effects').select('id').eq('operational_message_id', id).maybeSingle(),
    );
    await deliverEffectNow(effect?.id ?? null);
  }
  return { requeued };
};

// ---------------------------------------------------------------- templates --

export const listTemplates = async (caller: CollaborationCaller): Promise<MessageTemplateList> => {
  const [templates, canManageShared] = await Promise.all([
    unwrap(caller.db.from('message_templates').select('*').eq('organization_id', caller.orgId)
      .is('archived_at', null).order('name')),
    unwrap(raw(caller.db).rpc('has_capability', { p_org: caller.orgId, p_cap: 'scheduling.manage' })),
  ]);
  return { templates: templates ?? [], can_manage_shared: canManageShared === true };
};

export const createTemplate = async (caller: CollaborationCaller, input: SaveMessageTemplateInput): Promise<MessageTemplateRow> => {
  const row = await unwrap(
    caller.db.from('message_templates').insert({
      organization_id: caller.orgId,
      owner_id: input.shared ? null : caller.userId,
      name: input.name,
      subject: input.subject,
      body: input.body,
      created_by: caller.userId,
      updated_by: caller.userId,
    }).select('*').maybeSingle(),
  );
  if (!row) throw HttpError.forbidden('You cannot create that template');
  return row;
};

export const updateTemplate = async (
  caller: CollaborationCaller,
  id: string,
  input: SaveMessageTemplateInput,
): Promise<MessageTemplateRow> => {
  let update = caller.db.from('message_templates')
    .update({ name: input.name, subject: input.subject, body: input.body, updated_by: caller.userId })
    .eq('id', id).eq('organization_id', caller.orgId).is('archived_at', null);
  if (input.expected_revision !== undefined) update = update.eq('revision', input.expected_revision);
  const row = await unwrap(update.select('*').maybeSingle());
  if (row) return row;
  const current = await unwrap(
    caller.db.from('message_templates').select('id, revision').eq('id', id).eq('organization_id', caller.orgId).is('archived_at', null).maybeSingle(),
  );
  // Stale only when the revision really moved; a visible template the caller may not
  // edit is a 404, like any other row RLS hides from writes (W7-MSG-D7).
  if (current && input.expected_revision !== undefined && current.revision !== input.expected_revision) {
    throw new HttpError(409, 'This template changed since you opened it', 'template_stale');
  }
  throw HttpError.notFound('Template not found');
};

export const archiveTemplate = async (caller: CollaborationCaller, id: string): Promise<void> => {
  const row = await unwrap(
    caller.db.from('message_templates').update({ archived_at: new Date().toISOString(), updated_by: caller.userId })
      .eq('id', id).eq('organization_id', caller.orgId).select('id').maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Template not found');
};
