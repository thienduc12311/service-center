import { Router } from 'express';
import { z } from 'zod';
import {
  commitStaffingProposalSchema,
  createStaffingProposalSchema,
  createTeamRotationSchema,
  recomputeStaffingProposalSchema,
  rotationPreviewQuerySchema,
  updateTeamRotationSchema,
  uuid,
  type CommitStaffingProposalInput,
  type CreateStaffingProposalInput,
  type CreateTeamRotationInput,
  type RecomputeStaffingProposalInput,
  type RotationPreviewQuery,
  type UpdateTeamRotationInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import {
  archiveRotation,
  commitProposal,
  createProposal,
  createRotation,
  getProposal,
  getRotation,
  listProposals,
  listRotations,
  previewRotation,
  recomputeProposal,
  refreshProposal,
  updateRotation,
} from '../services/staffing-proposals.js';

/** F06 `/scheduling/proposals`: preview never creates requests, releases or deliveries. */
export const staffingProposalsRouter: Router = Router();
staffingProposalsRouter.use(requireCapability('scheduling.manage'));

staffingProposalsRouter.get('/', async (req, res) => {
  res.json(await listProposals(req));
});

staffingProposalsRouter.post('/', validateBody(createStaffingProposalSchema), async (req, res) => {
  res.status(201).json(await createProposal(req, req.body as CreateStaffingProposalInput));
});

staffingProposalsRouter.get('/:proposalId', async (req, res) => {
  res.json(await getProposal(req, param(req, 'proposalId')));
});

staffingProposalsRouter.post('/:proposalId/recompute', validateBody(recomputeStaffingProposalSchema), async (req, res) => {
  res.json(await recomputeProposal(req, param(req, 'proposalId'), req.body as RecomputeStaffingProposalInput));
});

staffingProposalsRouter.post('/:proposalId/refresh', async (req, res) => {
  res.status(201).json(await refreshProposal(req, param(req, 'proposalId')));
});

staffingProposalsRouter.post('/:proposalId/commit', validateBody(commitStaffingProposalSchema), async (req, res) => {
  res.json(await commitProposal(req, param(req, 'proposalId'), req.body as CommitStaffingProposalInput));
});

const listRotationsQuery = z.object({
  team_id: uuid.optional(),
  include_archived: z.enum(['true', 'false']).optional(),
});
type ListRotationsQuery = z.infer<typeof listRotationsQuery>;
const archiveRotationBody = z.object({ expected_revision: z.number().int().min(0) });

/** F06 `/rotations`: versioned team rotation patterns (suggestions only). */
export const rotationsRouter: Router = Router();
rotationsRouter.use(requireCapability('scheduling.manage'));

rotationsRouter.get('/', validateQuery(listRotationsQuery), async (req, res) => {
  const query = parsedQuery<ListRotationsQuery>(res);
  res.json(await listRotations(req, query.team_id ?? null, query.include_archived === 'true'));
});

rotationsRouter.post('/', validateBody(createTeamRotationSchema), async (req, res) => {
  res.status(201).json(await createRotation(req, req.body as CreateTeamRotationInput));
});

rotationsRouter.get('/:rotationId', async (req, res) => {
  res.json(await getRotation(req, param(req, 'rotationId')));
});

rotationsRouter.put('/:rotationId', validateBody(updateTeamRotationSchema), async (req, res) => {
  res.json(await updateRotation(req, param(req, 'rotationId'), req.body as UpdateTeamRotationInput));
});

rotationsRouter.post('/:rotationId/archive', validateBody(archiveRotationBody), async (req, res) => {
  await archiveRotation(req, param(req, 'rotationId'), (req.body as z.infer<typeof archiveRotationBody>).expected_revision);
  res.status(204).end();
});

rotationsRouter.get('/:rotationId/preview', validateQuery(rotationPreviewQuerySchema), async (req, res) => {
  res.json(await previewRotation(req, param(req, 'rotationId'), parsedQuery<RotationPreviewQuery>(res)));
});
