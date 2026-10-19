import { Router } from 'express';
import { z } from 'zod';
import { canAccessAnywhere, importPreviewRequestSchema, importSaveRequestSchema, importCommitRequestSchema, importJobSchema, uuid,
  type ImportPreviewRequest, type ImportSaveRequest, type ImportCommitRequest } from '@service-center/shared';
import { HttpError } from '../lib/errors.js';
import { parseOrThrow, validateBody } from '../lib/validate.js';
import { param } from '../lib/params.js';
import { raw, unwrap } from '../lib/supabase.js';
import { loadStructuredImport, previewStructuredImport, saveStructuredImport } from '../services/structured-imports.js';
export const importsRouter: Router = Router();
importsRouter.get('/', async (req, res) => {
  const result: unknown = await unwrap(raw(req.db).from('structured_import_jobs').select('*').eq('organization_id', req.orgId)
    .eq('created_by', req.auth.userId).order('created_at', { ascending: false }).order('id').limit(50));
  res.json(z.array(importJobSchema).parse(result));
});
importsRouter.post('/preview', validateBody(importPreviewRequestSchema), async (req, res) => {
  const source = req.body as ImportPreviewRequest;
  if (!canAccessAnywhere(req.access, source.kind === 'people' ? 'people.manage' : 'songs.manage')) throw HttpError.forbidden();
  res.json(await previewStructuredImport(req.db, { organizationId: req.orgId, userId: req.auth.userId }, source));
});
importsRouter.post('/', validateBody(importSaveRequestSchema), async (req, res) => {
  const input = req.body as ImportSaveRequest;
  if (!canAccessAnywhere(req.access, input.source.kind === 'people' ? 'people.manage' : 'songs.manage')) throw HttpError.forbidden();
  const result = await saveStructuredImport(req.db, { organizationId: req.orgId, userId: req.auth.userId }, input);
  res.status(201).json(result);
});
importsRouter.get('/:id', async (req, res) => {
  res.json(await loadStructuredImport(req.db, { organizationId: req.orgId, userId: req.auth.userId }, parseOrThrow(uuid, param(req, 'id'))));
});
importsRouter.post('/:id/commit', validateBody(importCommitRequestSchema), async (req, res) => {
  const input = req.body as ImportCommitRequest;
  const result: unknown = await unwrap(raw(req.db).rpc('commit_structured_import', {
    p_org: req.orgId, p_job: parseOrThrow(uuid, param(req, 'id')), p_revision: input.expected_revision,
  }));
  const job = importJobSchema.parse(result);
  res.json(await loadStructuredImport(req.db, { organizationId: req.orgId, userId: req.auth.userId }, job.id));
});
