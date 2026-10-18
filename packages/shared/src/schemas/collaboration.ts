import { z } from 'zod';
import { idempotencyKey, isoDateTime, uuid } from './common.js';
import { unknownMessageVariables } from '../lib/message-templates.js';

export const noteAudienceSchema = z.enum(['organization', 'scheduled', 'teams', 'leaders']);

const noteBody = z.string().trim().min(1, 'Write the note').max(8000);

/** Create (no `expected_revision`) or replace a note's content and audience. */
export const savePlanNoteSchema = z
  .object({
    plan_item_id: uuid.nullable().default(null),
    category_id: uuid.nullable().default(null),
    audience: noteAudienceSchema,
    team_ids: z.array(uuid).max(50).default([]),
    body: noteBody,
    /** The revision the editor loaded; required when editing. */
    expected_revision: z.number().int().min(1).optional(),
  })
  .refine((v) => v.audience !== 'teams' || v.team_ids.length > 0, {
    message: 'Choose at least one team',
    path: ['team_ids'],
  });

export const createNoteCategorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  service_type_id: uuid.nullable().default(null),
  default_audience: noteAudienceSchema.default('organization'),
  sort_order: z.number().int().min(0).max(1000).default(0),
});

export const updateNoteCategorySchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  default_audience: noteAudienceSchema.optional(),
  sort_order: z.number().int().min(0).max(1000).optional(),
  archived: z.boolean().optional(),
});

const discussionBody = z.string().trim().min(1, 'Write something first').max(4000);

export const discussionPageQuerySchema = z.object({
  /** Keyset cursor: `created_at` of the oldest row already shown. */
  before: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** `id` is chosen by the client so a retried post is one logical comment. */
export const postItemCommentSchema = z.object({
  id: uuid,
  body: discussionBody,
  mention_person_ids: z.array(uuid).max(20).default([]),
});

export const editDiscussionSchema = z.object({ body: discussionBody });

export const deleteDiscussionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const mentionCandidatesQuerySchema = z
  .object({ plan_id: uuid.optional(), conversation_id: uuid.optional() })
  .refine((v) => Boolean(v.plan_id) !== Boolean(v.conversation_id), { message: 'Choose a plan or a conversation' });

// ----------------------------------------------------- targeted messages ---

export const messageAudienceIncludeSchema = z.enum(['team_members', 'scheduled_confirmed', 'scheduled_pending', 'signups']);

export const messageAudienceSchema = z
  .object({
    plan_id: uuid.nullable().optional(),
    team_ids: z.array(uuid).max(50).default([]),
    include: z.array(messageAudienceIncludeSchema).min(1, 'Choose who should receive it').max(4)
      .refine((v) => new Set(v).size === v.length, { message: 'List each group once' }),
  })
  .refine((v) => !v.include.includes('team_members') || v.team_ids.length > 0, {
    message: 'Choose at least one team',
    path: ['team_ids'],
  })
  .refine((v) => v.plan_id || v.include.every((i) => i === 'team_members'), {
    message: 'Choose a plan for scheduled or signed-up people',
    path: ['plan_id'],
  });

const allowlisted = (field: string) => (value: string, ctx: z.RefinementCtx) => {
  const unknown = unknownMessageVariables(value);
  if (unknown.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown variable in ${field}: ${unknown.join(', ')}` });
  }
};

export const messageSubjectSchema = z.string().trim().min(1, 'Add a subject').max(200).superRefine(allowlisted('subject'));
export const messageBodySchema = z.string().trim().min(1, 'Write the message').max(8000).superRefine(allowlisted('message'));

export const previewOperationalMessageSchema = z.object({ audience: messageAudienceSchema });

export const sendOperationalMessageSchema = z.object({
  audience: messageAudienceSchema,
  subject: messageSubjectSchema,
  body: messageBodySchema,
  template_id: uuid.nullable().default(null),
  /** People the sender removed after reviewing the preview. */
  excluded_person_ids: z.array(uuid).max(500).default([]),
  /** From the preview the sender reviewed. */
  audience_hash: z.string().length(32),
  idempotency_key: idempotencyKey,
});

export const listOperationalMessagesQuerySchema = z.object({
  plan_id: uuid.optional(),
  /** `sent`: messages I sent (admins: everyone's). `received`: sent to me. */
  box: z.enum(['sent', 'received']).default('sent'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const retryOperationalMessageSchema = z.object({
  person_ids: z.array(uuid).min(1).max(500).optional(),
});

export const saveMessageTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  subject: messageSubjectSchema,
  body: messageBodySchema,
  /** Shared with every sender (organization schedulers only) or personal. */
  shared: z.boolean().default(false),
  expected_revision: z.number().int().min(1).optional(),
});

// --------------------------------------------------------- conversations ---

export const conversationKindSchema = z.enum(['team', 'plan']);

export const openConversationSchema = z.object({
  kind: conversationKindSchema,
  target_id: uuid,
});

export const conversationMessagesQuerySchema = discussionPageQuerySchema.extend({
  q: z.string().trim().min(2).max(100).optional(),
});

export const postConversationMessageSchema = z.object({
  id: uuid,
  body: discussionBody,
  reply_to_id: uuid.nullable().default(null),
  mention_person_ids: z.array(uuid).max(20).default([]),
});

export const markConversationReadSchema = z.object({ read_at: isoDateTime });
export const muteConversationSchema = z.object({ muted: z.boolean() });

export const conversationReportReasonSchema = z.enum(['spam', 'harassment', 'inappropriate', 'safety', 'other']);

export const reportConversationMessageSchema = z.object({
  reason: conversationReportReasonSchema,
  details: z.string().trim().max(1000).optional(),
});

export const resolveConversationReportSchema = z.object({
  action: z.enum(['dismiss', 'hide']),
  note: z.string().trim().max(500).optional(),
});

export const searchConversationMessagesQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type SavePlanNoteInput = z.infer<typeof savePlanNoteSchema>;
export type CreateNoteCategoryInput = z.infer<typeof createNoteCategorySchema>;
export type UpdateNoteCategoryInput = z.infer<typeof updateNoteCategorySchema>;
export type MentionCandidatesQuery = z.infer<typeof mentionCandidatesQuerySchema>;
export type DiscussionPageQuery = z.infer<typeof discussionPageQuerySchema>;
export type PostItemCommentInput = z.infer<typeof postItemCommentSchema>;
export type EditDiscussionInput = z.infer<typeof editDiscussionSchema>;
export type DeleteDiscussionInput = z.infer<typeof deleteDiscussionSchema>;
export type MessageAudienceInput = z.infer<typeof messageAudienceSchema>;
export type PreviewOperationalMessageInput = z.infer<typeof previewOperationalMessageSchema>;
export type SendOperationalMessageInput = z.infer<typeof sendOperationalMessageSchema>;
export type ListOperationalMessagesQuery = z.infer<typeof listOperationalMessagesQuerySchema>;
export type RetryOperationalMessageInput = z.infer<typeof retryOperationalMessageSchema>;
export type SaveMessageTemplateInput = z.infer<typeof saveMessageTemplateSchema>;
export type OpenConversationInput = z.infer<typeof openConversationSchema>;
export type ConversationMessagesQuery = z.infer<typeof conversationMessagesQuerySchema>;
export type PostConversationMessageInput = z.infer<typeof postConversationMessageSchema>;
export type MarkConversationReadInput = z.infer<typeof markConversationReadSchema>;
export type MuteConversationInput = z.infer<typeof muteConversationSchema>;
export type ReportConversationMessageInput = z.infer<typeof reportConversationMessageSchema>;
export type ResolveConversationReportInput = z.infer<typeof resolveConversationReportSchema>;
export type SearchConversationMessagesQuery = z.infer<typeof searchConversationMessagesQuerySchema>;
