import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  applyTemplateSchema,
  archivePlanTemplateSchema,
  createPlanTemplateSchema,
  generatePlansSchema,
  listPlanTemplatesQuerySchema,
  planSeriesSchema,
  previewTemplateApplySchema,
  rescheduleCommitSchema,
  reschedulePreviewSchema,
  updatePlanTemplateSchema,
  type ApplyTemplateInput,
  type ArchivePlanTemplateInput,
  type CreatePlanTemplateInput,
  type GeneratePlansInput,
  type ListPlanTemplatesQuery,
  type PlanSeriesInput,
  type PreviewTemplateApplyInput,
  type RescheduleCommitInput,
  type ReschedulePreviewInput,
  type UpdatePlanTemplateInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parseOrThrow, parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import {
  applyTemplate,
  archivePlanTemplate,
  createPlanTemplate,
  generatePlans,
  getPlanTemplate,
  listPlanTemplates,
  listTemplateApplications,
  previewApplyTemplate,
  previewPlanGeneration,
  previewReschedule,
  reschedulePlans,
  updatePlanTemplate,
  type PlanTemplateContext,
} from '../services/plan-templates.js';

const context = (req: Request): PlanTemplateContext => ({ db: req.db, orgId: req.orgId });
const revisionQuerySchema = z.object({ revision: z.coerce.number().int().min(1).optional() });

/**
 * F10 template library. Every route needs plans.edit somewhere; RLS narrows
 * each template to callers with plans.edit at its service type (or anywhere
 * for an organization-wide one).
 */
export const planTemplatesRouter: Router = Router();
planTemplatesRouter.use(requireCapability('plans.edit'));

planTemplatesRouter.get('/', validateQuery(listPlanTemplatesQuerySchema), async (req, res) => {
  res.json(await listPlanTemplates(context(req), parsedQuery<ListPlanTemplatesQuery>(res)));
});

planTemplatesRouter.get('/:id', async (req, res) => {
  const { revision } = parseOrThrow(revisionQuerySchema, req.query);
  res.json(await getPlanTemplate(context(req), param(req, 'id'), revision));
});

planTemplatesRouter.post('/', validateBody(createPlanTemplateSchema), async (req, res) => {
  res.status(201).json(await createPlanTemplate(context(req), req.body as CreatePlanTemplateInput));
});

/** A content or plan change saves a new revision; existing plans never change. */
planTemplatesRouter.patch('/:id', validateBody(updatePlanTemplateSchema), async (req, res) => {
  res.json(await updatePlanTemplate(context(req), param(req, 'id'), req.body as UpdatePlanTemplateInput));
});

planTemplatesRouter.post('/:id/archive', validateBody(archivePlanTemplateSchema), async (req, res) => {
  const { archived } = req.body as ArchivePlanTemplateInput;
  res.json(await archivePlanTemplate(context(req), param(req, 'id'), archived));
});

/**
 * Template use on plans, mounted under /plans before the plan router so
 * `generate` is never read as a plan id.
 */
export const planTemplateUseRouter: Router = Router();

/** A bounded series of new plans from one revision. Writes nothing. */
planTemplateUseRouter.post('/generate/preview', requireCapability('plans.edit'), validateBody(planSeriesSchema), async (req, res) => {
  res.json(await previewPlanGeneration(context(req), req.body as PlanSeriesInput));
});

/** All plans in one transaction, or none; a retried key returns the same plans. */
planTemplateUseRouter.post('/generate', requireCapability('plans.edit'), validateBody(generatePlansSchema), async (req, res) => {
  res.status(201).json(await generatePlans(context(req), req.body as GeneratePlansInput));
});

/**
 * F10 Pass C: shift whole plans to new local dates, or move only the order
 * between two plans. The review lists every person, time, reminder, feed and
 * link that changes; answers reset only when explicitly chosen.
 */
planTemplateUseRouter.post('/reschedule/preview', requireCapability('plans.edit'), validateBody(reschedulePreviewSchema), async (req, res) => {
  res.json(await previewReschedule(context(req), req.body as ReschedulePreviewInput));
});

planTemplateUseRouter.post('/reschedule', requireCapability('plans.edit'), validateBody(rescheduleCommitSchema), async (req, res) => {
  res.json(await reschedulePlans(context(req), req.body as RescheduleCommitInput));
});

planTemplateUseRouter.post('/:id/apply-template/preview', requireCapability('plans.edit'), validateBody(previewTemplateApplySchema), async (req, res) => {
  res.json(await previewApplyTemplate(context(req), param(req, 'id'), req.body as PreviewTemplateApplyInput));
});

/** Locks the plan, re-checks the preview and applies it in one transaction. Nobody is notified. */
planTemplateUseRouter.post('/:id/apply-template', requireCapability('plans.edit'), validateBody(applyTemplateSchema), async (req, res) => {
  res.json(await applyTemplate(context(req), param(req, 'id'), req.body as ApplyTemplateInput));
});

planTemplateUseRouter.get('/:id/template-applications', requireCapability('plans.edit'), async (req, res) => {
  res.json(await listTemplateApplications(context(req), param(req, 'id')));
});
