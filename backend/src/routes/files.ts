import { Router, type Request } from 'express';
import {
  abandonFileUploadSchema,
  archiveFileSchema,
  createFileDocumentSchema,
  createFileLinkSchema,
  createFileUploadIntentSchema,
  deleteFileSchema,
  fileDownloadSchema,
  finalizeFileSchema,
  linkFileToPlanSchema,
  listFilesQuerySchema,
  saveFileDocumentVersionSchema,
  setFileLinkPinSchema,
  setFilePlaybackRightsSchema,
  updateFileLinkUrlSchema,
  updateFileSchema,
  type AbandonFileUploadInput,
  type ArchiveFileInput,
  type CreateFileDocumentInput,
  type CreateFileLinkInput,
  type CreateFileUploadIntentInput,
  type DeleteFileInput,
  type FileDownloadInput,
  type FinalizeFileInput,
  type LinkFileToPlanInput,
  type ListFilesQuery,
  type SaveFileDocumentVersionInput,
  type SetFileLinkPinInput,
  type SetFilePlaybackRightsInput,
  type UpdateFileInput,
  type UpdateFileLinkUrlInput,
} from '@service-center/shared';
import { z } from 'zod';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import {
  abandonUpload,
  createDocumentFile,
  createDownload,
  createLinkFile,
  createUploadIntent,
  finalizeUpload,
  getDocument,
  getFileDetail,
  linkToPlan,
  listParentFiles,
  listPlanFiles,
  removeFile,
  saveDocumentVersion,
  setArchived,
  setLinkPin,
  setPlaybackRights,
  unlink,
  updateFileMetadata,
  updateLinkUrl,
  type FileCaller,
} from '../services/files.js';

/**
 * F13 files. Every read and write is decided by the database (RLS, Storage
 * policies and the file functions), per parent and audience; no route-level
 * capability gate, because plan editors, library managers and media managers
 * all add files to different parents.
 */
const caller = (req: Request): FileCaller => ({ db: req.db, orgId: req.orgId });

const documentQuerySchema = z.object({ version_id: z.string().uuid().optional() });
type DocumentQuery = z.infer<typeof documentQuerySchema>;

export const filesRouter: Router = Router();

filesRouter.get('/', validateQuery(listFilesQuerySchema), async (req, res) => {
  res.json(await listParentFiles(caller(req), parsedQuery<ListFilesQuery>(res)));
});

filesRouter.post('/upload-intents', validateBody(createFileUploadIntentSchema), async (req, res) => {
  const intent = await createUploadIntent(caller(req), req.body as CreateFileUploadIntentInput);
  res.status(intent.replayed ? 200 : 201).json(intent);
});

filesRouter.post('/links', validateBody(createFileLinkSchema), async (req, res) => {
  res.status(201).json(await createLinkFile(caller(req), req.body as CreateFileLinkInput));
});

filesRouter.post('/documents', validateBody(createFileDocumentSchema), async (req, res) => {
  res.status(201).json(await createDocumentFile(caller(req), req.body as CreateFileDocumentInput));
});

filesRouter.get('/:id', async (req, res) => {
  res.json(await getFileDetail(caller(req), param(req, 'id')));
});

filesRouter.patch('/:id', validateBody(updateFileSchema), async (req, res) => {
  res.json(await updateFileMetadata(caller(req), param(req, 'id'), req.body as UpdateFileInput));
});

filesRouter.delete('/:id', validateBody(deleteFileSchema), async (req, res) => {
  await removeFile(caller(req), param(req, 'id'), (req.body as DeleteFileInput).expected_revision);
  res.status(204).end();
});

filesRouter.post('/:id/finalize', validateBody(finalizeFileSchema), async (req, res) => {
  res.json(await finalizeUpload(caller(req), param(req, 'id'), (req.body as FinalizeFileInput).version_id));
});

filesRouter.post('/:id/abandon', validateBody(abandonFileUploadSchema), async (req, res) => {
  res.json(await abandonUpload(caller(req), param(req, 'id'), (req.body as AbandonFileUploadInput).version_id));
});

filesRouter.put('/:id/link', validateBody(updateFileLinkUrlSchema), async (req, res) => {
  res.json(await updateLinkUrl(caller(req), param(req, 'id'), req.body as UpdateFileLinkUrlInput));
});

filesRouter.get('/:id/document', validateQuery(documentQuerySchema), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await getDocument(caller(req), param(req, 'id'), parsedQuery<DocumentQuery>(res).version_id));
});

filesRouter.put('/:id/document', validateBody(saveFileDocumentVersionSchema), async (req, res) => {
  res.json(await saveDocumentVersion(caller(req), param(req, 'id'), req.body as SaveFileDocumentVersionInput));
});

filesRouter.post('/:id/archive', validateBody(archiveFileSchema), async (req, res) => {
  res.json(await setArchived(caller(req), param(req, 'id'), req.body as ArchiveFileInput));
});

filesRouter.put('/:id/playback-rights', validateBody(setFilePlaybackRightsSchema), async (req, res) => {
  res.json(await setPlaybackRights(caller(req), param(req, 'id'), req.body as SetFilePlaybackRightsInput));
});

filesRouter.post('/:id/download', validateBody(fileDownloadSchema), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await createDownload(caller(req), param(req, 'id'), req.body as FileDownloadInput));
});

export const planFilesRouter: Router = Router({ mergeParams: true });

planFilesRouter.get('/files', async (req, res) => {
  res.json(await listPlanFiles(caller(req), param(req, 'planId')));
});

planFilesRouter.post('/file-links', validateBody(linkFileToPlanSchema), async (req, res) => {
  res.status(201).json(await linkToPlan(caller(req), param(req, 'planId'), req.body as LinkFileToPlanInput));
});

export const fileLinksRouter: Router = Router();

fileLinksRouter.patch('/:id', validateBody(setFileLinkPinSchema), async (req, res) => {
  res.json(await setLinkPin(caller(req), param(req, 'id'), req.body as SetFileLinkPinInput));
});

fileLinksRouter.delete('/:id', async (req, res) => {
  await unlink(caller(req), param(req, 'id'));
  res.status(204).end();
});
