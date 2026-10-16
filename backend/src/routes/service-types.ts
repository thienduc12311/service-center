import { Router } from 'express';
import { z } from 'zod';
import { param } from '../lib/params.js';
import {
  archiveServiceTypeSchema,
  copyServiceTypeSchema,
  moveServiceTypeSchema,
  replaceScopeGrantsSchema,
  serviceTypeMovePreviewQuerySchema,
  serviceTypeSchema,
  serviceTypeSetupSchema,
  serviceTypeTeamsSchema,
  type ArchiveServiceTypeInput,
  type CopyServiceTypeInput,
  type MoveServiceTypeInput,
  type ReplaceScopeGrantsInput,
  type ServiceTypeSetupInput,
  type ServiceTypeTeamsInput,
} from '@service-center/shared';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireAdmin, requireCapability } from '../middleware/organization.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { setUpServiceType } from '../services/service-type-setup.js';
import { loadScopeAccess, replaceScopeAccess } from '../services/access.js';

export const serviceTypesRouter: Router = Router();

const listQuerySchema = z.object({
  include_archived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

serviceTypesRouter.get('/', validateQuery(listQuerySchema), async (req, res) => {
  const { include_archived } = parsedQuery<z.infer<typeof listQuerySchema>>(res);
  let query = req.db.from('service_types').select('*').eq('organization_id', req.orgId);
  if (!include_archived) query = query.is('archived_at', null);
  const rows = await unwrap(query.order('sort_order').order('name'));
  res.json(rows ?? []);
});

serviceTypesRouter.post('/', requireCapability('plans.edit'), validateBody(serviceTypeSchema), async (req, res) => {
  const created = await unwrapOne(
    req.db
      .from('service_types')
      .insert({ ...req.body, organization_id: req.orgId })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

/**
 * The "Add a Service Type" wizard. Creates the service type, its first plan
 * with the service times, and the teams that run it in one call, so a half-
 * finished wizard can't leave an organization with a service type that has
 * nothing to plan against.
 */
serviceTypesRouter.post(
  '/setup',
  requireCapability('plans.edit'),
  validateBody(serviceTypeSetupSchema),
  async (req, res) => {
    const result = await setUpServiceType({
      db: req.db,
      orgId: req.orgId,
      userId: req.auth.userId,
      input: req.body as ServiceTypeSetupInput,
    });
    res.status(201).json(result);
  },
);

serviceTypesRouter.patch('/:id', requireCapability('plans.edit'), validateBody(serviceTypeSchema.partial()), async (req, res) => {
  const updated = await unwrapOne(
    req.db
      .from('service_types')
      .update(req.body)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .single(),
  );
  res.json(updated);
});

serviceTypesRouter.delete('/:id', requireCapability('plans.edit'), async (req, res) => {
  await unwrap(
    req.db.from('service_types').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId),
  );
  res.status(204).end();
});

// ------------------------------------------------------------- access ----
serviceTypesRouter.get('/:id/access', requireAdmin, async (req, res) => {
  res.json(await loadScopeAccess({ db: req.db, orgId: req.orgId, scopeType: 'service_type', scopeId: param(req, 'id') }));
});

serviceTypesRouter.put('/:id/access', requireAdmin, validateBody(replaceScopeGrantsSchema), async (req, res) => {
  res.json(
    await replaceScopeAccess({
      db: req.db,
      orgId: req.orgId,
      scopeType: 'service_type',
      scopeId: param(req, 'id'),
      input: req.body as ReplaceScopeGrantsInput,
    }),
  );
});

// ------------------------------------------------- folders / lifecycle ----
serviceTypesRouter.get('/:id/move-preview', requireAdmin, validateQuery(serviceTypeMovePreviewQuerySchema), async (req, res) => {
  const { folder_id } = parsedQuery<{ folder_id?: string }>(res);
  res.json(
    (await unwrap(
      req.db.rpc('preview_service_type_move', { p_service_type: param(req, 'id'), p_folder: folder_id ?? null }),
    )) ?? [],
  );
});

serviceTypesRouter.post('/:id/move', requireAdmin, validateBody(moveServiceTypeSchema), async (req, res) => {
  const input = req.body as MoveServiceTypeInput;
  const { data, error } = await req.db.rpc('move_service_type', {
    p_service_type: param(req, 'id'),
    p_folder: input.folder_id,
    p_acknowledge_changes: input.acknowledge_changes,
  });
  if (error?.code === 'PT409') throw new HttpError(409, error.message, 'service_type_move_needs_review');
  if (error) throw fromPostgrestError(error);
  res.json(data);
});

/** Archived service types leave pickers; their plans keep their audience. */
serviceTypesRouter.post('/:id/archive', requireCapability('plans.edit'), validateBody(archiveServiceTypeSchema), async (req, res) => {
  const { archived } = req.body as ArchiveServiceTypeInput;
  const updated = await unwrap(
    req.db
      .from('service_types')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Service type not found');
  res.json(updated);
});

/** Copies settings and (optionally) which teams serve it — never people or grants. */
serviceTypesRouter.post('/:id/copy', requireCapability('plans.edit'), validateBody(copyServiceTypeSchema), async (req, res) => {
  const { name, include_teams } = req.body as CopyServiceTypeInput;
  const source = await unwrap(
    req.db.from('service_types').select('id').eq('id', param(req, 'id')).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!source) throw HttpError.notFound('Service type not found');
  const id = await unwrap(
    req.db.rpc('copy_service_type', { p_service_type: source.id, p_name: name, p_include_teams: include_teams }),
  );
  if (!id) throw HttpError.notFound('Service type not found');
  res.status(201).json(await unwrapOne(req.db.from('service_types').select('*').eq('id', id).single()));
});

// --------------------------------------------------------- shared teams ----
const teamIdsFor = async (req: import('express').Request, serviceTypeId: string): Promise<string[]> =>
  ((await unwrap(
    req.db.from('service_type_teams').select('team_id').eq('service_type_id', serviceTypeId).eq('organization_id', req.orgId),
  )) ?? []).map((row) => row.team_id);

serviceTypesRouter.get('/:id/teams', async (req, res) => {
  res.json(await teamIdsFor(req, param(req, 'id')));
});

/**
 * The teams that serve this service type. A team may serve several; its
 * roster is shared, while plans keep their own assignments.
 */
serviceTypesRouter.put('/:id/teams', requireCapability('plans.edit'), validateBody(serviceTypeTeamsSchema), async (req, res) => {
  const serviceTypeId = param(req, 'id');
  const { team_ids } = req.body as ServiceTypeTeamsInput;
  const wanted = new Set(team_ids);
  const current = new Set(await teamIdsFor(req, serviceTypeId));
  const removed = [...current].filter((id) => !wanted.has(id));
  const added = [...wanted].filter((id) => !current.has(id));
  if (removed.length) {
    await unwrap(req.db.from('service_type_teams').delete().eq('service_type_id', serviceTypeId).in('team_id', removed));
  }
  if (added.length) {
    await unwrap(
      req.db
        .from('service_type_teams')
        .insert(added.map((team_id) => ({ service_type_id: serviceTypeId, team_id, organization_id: req.orgId }))),
    );
  }
  res.json(await teamIdsFor(req, serviceTypeId));
});
