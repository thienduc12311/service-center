import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  canAccessAnywhere,
  conversationMessagesQuerySchema,
  createNoteCategorySchema,
  deleteDiscussionSchema,
  discussionPageQuerySchema,
  editDiscussionSchema,
  listOperationalMessagesQuerySchema,
  markConversationReadSchema,
  mentionCandidatesQuerySchema,
  muteConversationSchema,
  openConversationSchema,
  postConversationMessageSchema,
  postItemCommentSchema,
  previewOperationalMessageSchema,
  reportConversationMessageSchema,
  resolveConversationReportSchema,
  retryOperationalMessageSchema,
  saveMessageTemplateSchema,
  savePlanNoteSchema,
  sendOperationalMessageSchema,
  updateNoteCategorySchema,
  type ConversationMessagesQuery,
  type CreateNoteCategoryInput,
  type DeleteDiscussionInput,
  type DiscussionPageQuery,
  type EditDiscussionInput,
  type ListOperationalMessagesQuery,
  type MarkConversationReadInput,
  type MentionCandidatesQuery,
  type MuteConversationInput,
  type OpenConversationInput,
  type PostConversationMessageInput,
  type PostItemCommentInput,
  type PreviewOperationalMessageInput,
  type ReportConversationMessageInput,
  type ResolveConversationReportInput,
  type RetryOperationalMessageInput,
  type SaveMessageTemplateInput,
  type SavePlanNoteInput,
  type SendOperationalMessageInput,
  type UpdateNoteCategoryInput,
} from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import type { CollaborationCaller } from '../model/collaboration.model.js';
import {
  createNoteCategory,
  deletePlanNote,
  listNoteCategories,
  listPlanNotes,
  savePlanNote,
  updateNoteCategory,
} from '../services/notes.js';
import {
  deleteConversationMessage,
  deleteItemComment,
  editConversationMessage,
  editItemComment,
  getConversation,
  listConversationMessages,
  listConversations,
  listItemComments,
  markConversationRead,
  mentionCandidates,
  muteConversation,
  openConversation,
  postConversationMessage,
  postItemComment,
  reportConversationMessage,
  resolveConversationReport,
  restoreConversationMessage,
} from '../services/discussions.js';
import {
  archiveTemplate,
  createTemplate,
  getMessage,
  listMessages,
  listTemplates,
  previewMessage,
  retryMessage,
  sendMessage,
  updateTemplate,
} from '../services/messages.js';

const caller = (req: Request): CollaborationCaller => ({ db: req.db, orgId: req.orgId, userId: req.auth.userId });

// ------------------------------------------------------------ plan notes ----
/** Mounted at /plans/:planId/notes. Writes need plans.edit; RLS decides the plan. */
export const planNotesRouter: Router = Router({ mergeParams: true });

planNotesRouter.get('/', async (req, res) => {
  res.json(await listPlanNotes(caller(req), param(req, 'planId')));
});

planNotesRouter.post('/', requireCapability('plans.edit'), validateBody(savePlanNoteSchema), async (req, res) => {
  const input = req.body as SavePlanNoteInput;
  res.status(201).json(await savePlanNote(caller(req), param(req, 'planId'), null, { ...input, expected_revision: undefined }));
});

planNotesRouter.put('/:noteId', requireCapability('plans.edit'), validateBody(savePlanNoteSchema), async (req, res) => {
  const input = req.body as SavePlanNoteInput;
  if (input.expected_revision === undefined) {
    throw HttpError.unprocessable('Send the revision you edited', [{ path: 'expected_revision', message: 'Required' }]);
  }
  res.json(await savePlanNote(caller(req), param(req, 'planId'), param(req, 'noteId'), input));
});

const deleteNoteQuerySchema = z.object({ expected_revision: z.coerce.number().int().min(1) });
planNotesRouter.delete('/:noteId', requireCapability('plans.edit'), validateQuery(deleteNoteQuerySchema), async (req, res) => {
  const { expected_revision } = parsedQuery<z.infer<typeof deleteNoteQuerySchema>>(res);
  await deletePlanNote(caller(req), param(req, 'planId'), param(req, 'noteId'), expected_revision);
  res.status(204).end();
});

// -------------------------------------------------------- note categories ---
export const noteCategoriesRouter: Router = Router();
const categoriesQuerySchema = z.object({ service_type_id: z.string().uuid().optional() });

noteCategoriesRouter.get('/', validateQuery(categoriesQuerySchema), async (req, res) => {
  const { service_type_id } = parsedQuery<z.infer<typeof categoriesQuerySchema>>(res);
  res.json(await listNoteCategories(caller(req), service_type_id));
});
noteCategoriesRouter.post('/', requireCapability('plans.edit'), validateBody(createNoteCategorySchema), async (req, res) => {
  res.status(201).json(await createNoteCategory(caller(req), req.body as CreateNoteCategoryInput));
});
noteCategoriesRouter.patch('/:id', requireCapability('plans.edit'), validateBody(updateNoteCategorySchema), async (req, res) => {
  res.json(await updateNoteCategory(caller(req), param(req, 'id'), req.body as UpdateNoteCategoryInput));
});

// --------------------------------------------------------- item comments ---
/** Open to plan leaders and people scheduled on the plan (decided in the database). */
export const planItemCommentsRouter: Router = Router();

planItemCommentsRouter.get('/:itemId/comments', validateQuery(discussionPageQuerySchema), async (req, res) => {
  res.json(await listItemComments(caller(req), param(req, 'itemId'), parsedQuery<DiscussionPageQuery>(res)));
});
planItemCommentsRouter.post('/:itemId/comments', validateBody(postItemCommentSchema), async (req, res) => {
  const result = await postItemComment(caller(req), param(req, 'itemId'), req.body as PostItemCommentInput);
  res.status(result.replayed ? 200 : 201).json(result);
});
planItemCommentsRouter.patch('/:itemId/comments/:commentId', validateBody(editDiscussionSchema), async (req, res) => {
  const { body } = req.body as EditDiscussionInput;
  res.json(await editItemComment(caller(req), param(req, 'itemId'), param(req, 'commentId'), body));
});
planItemCommentsRouter.delete('/:itemId/comments/:commentId', validateBody(deleteDiscussionSchema), async (req, res) => {
  const { reason } = req.body as DeleteDiscussionInput;
  res.json(await deleteItemComment(caller(req), param(req, 'itemId'), param(req, 'commentId'), reason));
});

export const mentionCandidatesRouter: Router = Router();
mentionCandidatesRouter.get('/', validateQuery(mentionCandidatesQuerySchema), async (req, res) => {
  const query = parsedQuery<MentionCandidatesQuery>(res);
  res.json(await mentionCandidates(caller(req), { planId: query.plan_id, conversationId: query.conversation_id }));
});

// ----------------------------------------------------- targeted messages ---
/**
 * Sending needs some scheduling or team scope; the database checks the exact
 * teams/plan named in the audience. Reading a message is also open to its
 * recipients (RLS).
 */
export const messagesRouter: Router = Router();

const requireSender = (req: Request): void => {
  if (!canAccessAnywhere(req.access, 'scheduling.manage') && !canAccessAnywhere(req.access, 'teams.manage')) throw HttpError.forbidden('Only schedulers and team leaders can send messages');
};

messagesRouter.post('/preview', validateBody(previewOperationalMessageSchema), async (req, res) => {
  requireSender(req);
  const { audience } = req.body as PreviewOperationalMessageInput;
  res.json(await previewMessage(caller(req), audience));
});
messagesRouter.post('/', validateBody(sendOperationalMessageSchema), async (req, res) => {
  requireSender(req);
  const result = await sendMessage(caller(req), req.body as SendOperationalMessageInput);
  res.status(result.replayed ? 200 : 201).json(result);
});
messagesRouter.get('/', validateQuery(listOperationalMessagesQuerySchema), async (req, res) => {
  res.json(await listMessages(caller(req), parsedQuery<ListOperationalMessagesQuery>(res)));
});
messagesRouter.get('/:id', async (req, res) => {
  res.json(await getMessage(caller(req), param(req, 'id')));
});
messagesRouter.post('/:id/retry', validateBody(retryOperationalMessageSchema), async (req, res) => {
  const { person_ids } = req.body as RetryOperationalMessageInput;
  res.json(await retryMessage(caller(req), param(req, 'id'), person_ids));
});

export const messageTemplatesRouter: Router = Router();
messageTemplatesRouter.get('/', async (req, res) => {
  requireSender(req);
  res.json(await listTemplates(caller(req)));
});
messageTemplatesRouter.post('/', validateBody(saveMessageTemplateSchema), async (req, res) => {
  requireSender(req);
  res.status(201).json(await createTemplate(caller(req), req.body as SaveMessageTemplateInput));
});
messageTemplatesRouter.put('/:id', validateBody(saveMessageTemplateSchema), async (req, res) => {
  requireSender(req);
  res.json(await updateTemplate(caller(req), param(req, 'id'), req.body as SaveMessageTemplateInput));
});
messageTemplatesRouter.delete('/:id', async (req, res) => {
  requireSender(req);
  await archiveTemplate(caller(req), param(req, 'id'));
  res.status(204).end();
});

// --------------------------------------------------------- conversations ---
/** Participants are derived per request in the database; a guessed id is 404. */
export const conversationsRouter: Router = Router();

conversationsRouter.get('/', async (req, res) => {
  res.json(await listConversations(caller(req)));
});
conversationsRouter.post('/open', validateBody(openConversationSchema), async (req, res) => {
  res.json(await openConversation(caller(req), req.body as OpenConversationInput));
});
conversationsRouter.get('/:id', validateQuery(discussionPageQuerySchema), async (req, res) => {
  res.json(await getConversation(caller(req), param(req, 'id'), parsedQuery<DiscussionPageQuery>(res)));
});
conversationsRouter.get('/:id/messages', validateQuery(conversationMessagesQuerySchema), async (req, res) => {
  res.json(await listConversationMessages(caller(req), param(req, 'id'), parsedQuery<ConversationMessagesQuery>(res)));
});
conversationsRouter.post('/:id/messages', validateBody(postConversationMessageSchema), async (req, res) => {
  const result = await postConversationMessage(caller(req), param(req, 'id'), req.body as PostConversationMessageInput);
  res.status(result.replayed ? 200 : 201).json(result);
});
conversationsRouter.patch('/:id/messages/:messageId', validateBody(editDiscussionSchema), async (req, res) => {
  const { body } = req.body as EditDiscussionInput;
  res.json(await editConversationMessage(caller(req), param(req, 'id'), param(req, 'messageId'), body));
});
conversationsRouter.delete('/:id/messages/:messageId', async (req, res) => {
  res.json(await deleteConversationMessage(caller(req), param(req, 'id'), param(req, 'messageId')));
});
conversationsRouter.post('/:id/messages/:messageId/restore', async (req, res) => {
  res.json(await restoreConversationMessage(caller(req), param(req, 'id'), param(req, 'messageId')));
});
conversationsRouter.post('/:id/messages/:messageId/report', validateBody(reportConversationMessageSchema), async (req, res) => {
  res.status(201).json(await reportConversationMessage(caller(req), param(req, 'id'), param(req, 'messageId'),
    req.body as ReportConversationMessageInput));
});
conversationsRouter.post('/:id/reports/:reportId/resolve', validateBody(resolveConversationReportSchema), async (req, res) => {
  res.json(await resolveConversationReport(caller(req), param(req, 'id'), param(req, 'reportId'),
    req.body as ResolveConversationReportInput));
});
conversationsRouter.post('/:id/read', validateBody(markConversationReadSchema), async (req, res) => {
  const { read_at } = req.body as MarkConversationReadInput;
  res.json(await markConversationRead(caller(req), param(req, 'id'), read_at));
});
conversationsRouter.put('/:id/mute', validateBody(muteConversationSchema), async (req, res) => {
  const { muted } = req.body as MuteConversationInput;
  res.json(await muteConversation(caller(req), param(req, 'id'), muted));
});
