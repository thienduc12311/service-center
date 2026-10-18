import { Router, type Request } from 'express';
import {
  applyRosterBulkSchema,
  canAccessAnywhere,
  createTagGroupSchema,
  globalSearchQuerySchema,
  previewRosterBulkSchema,
  createGuestSchema,
  deliveryReadinessSchema,
  resolveReconciliationSchema,
  type CreateGuestInput,
  type DeliveryReadinessInput,
  type PersonIdentityReconciliationRow,
  type ResolveReconciliationInput,
  rosterAuditQuerySchema,
  setTagGroupSchema,
  updateTagGroupSchema,
  type ApplyRosterBulkInput,
  type CreateTagGroupInput,
  type GlobalSearchQuery,
  type PreviewRosterBulkInput,
  type RosterAuditQuery,
  type RosterBulkApplyResult,
  type SetTagGroupInput,
  type UpdateTagGroupInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { requireAdmin, requireCapability } from '../middleware/organization.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import { guestRosterPerson, summarizeBulkPreview } from '../model/roster.model.js';
import {
  globalSearch,
  loadReconciliations,
  loadRosterAudit,
  loadTagCatalog,
  nameReconciliations,
} from '../services/roster.js';

/**
 * Roster maintenance (F02 Pass C). Mounted on /api/v1/people ahead of the
 * per-person routes so `/audit`, `/tag-catalog` and `/bulk` are never read as
 * a person id.
 */
export const rosterRouter: Router = Router();
export const searchRouter: Router = Router();

const canReadPrivate = (req: Request): boolean =>
  canAccessAnywhere(req.access, 'people.view_private') || canAccessAnywhere(req.access, 'people.manage');

// ---------------------------------------------------------------- audit ----
rosterRouter.get('/audit', validateQuery(rosterAuditQuerySchema), async (req, res) => {
  if (!canReadPrivate(req)) throw HttpError.forbidden();
  const { person_id, limit } = parsedQuery<RosterAuditQuery>(res);
  res.json(await loadRosterAudit({ db: req.db, orgId: req.orgId, personId: person_id, limit }));
});

// ----------------------------------------------------------- tag groups ----
rosterRouter.get('/tag-catalog', async (req, res) => {
  res.json(await loadTagCatalog({ db: req.db, orgId: req.orgId }));
});

rosterRouter.put('/tag-catalog', requireCapability('people.manage'), validateBody(setTagGroupSchema), async (req, res) => {
  const { tag, group_id } = req.body as SetTagGroupInput;
  await unwrap(
    req.db
      .from('person_tag_catalog')
      .upsert({ organization_id: req.orgId, tag, group_id }, { onConflict: 'organization_id,tag' }),
  );
  res.json(await loadTagCatalog({ db: req.db, orgId: req.orgId }));
});

rosterRouter.post('/tag-groups', requireCapability('people.manage'), validateBody(createTagGroupSchema), async (req, res) => {
  const body = req.body as CreateTagGroupInput;
  const created = await unwrapOne(
    req.db.from('person_tag_groups').insert({ ...body, organization_id: req.orgId }).select('*').single(),
  );
  res.status(201).json(created);
});

rosterRouter.patch('/tag-groups/:groupId', requireCapability('people.manage'), validateBody(updateTagGroupSchema), async (req, res) => {
  const body = req.body as UpdateTagGroupInput;
  const updated = await unwrap(
    req.db
      .from('person_tag_groups')
      .update(body)
      .eq('id', param(req, 'groupId'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Tag group not found');
  res.json(updated);
});

/** Its tags become ungrouped; nobody loses a tag. */
rosterRouter.delete('/tag-groups/:groupId', requireCapability('people.manage'), async (req, res) => {
  await unwrap(
    req.db.from('person_tag_groups').delete().eq('id', param(req, 'groupId')).eq('organization_id', req.orgId),
  );
  res.status(204).end();
});

// ----------------------------------------------------------------- bulk ----
/**
 * Tag changes need people.manage; team changes need teams.manage for that
 * team. The database checks both and reports per-row problems.
 */
rosterRouter.post('/bulk/preview', validateBody(previewRosterBulkSchema), async (req, res) => {
  const body = req.body as PreviewRosterBulkInput;
  const rows = await unwrap(
    req.db.rpc('preview_roster_bulk_change', {
      p_org: req.orgId,
      p_person_ids: body.person_ids,
      p_action: body.action,
      p_tag: body.tag ?? null,
      p_team: body.team_id ?? null,
      p_position: body.position_id ?? null,
    }),
  );
  res.json(summarizeBulkPreview(rows ?? []));
});

rosterRouter.post('/bulk/apply', validateBody(applyRosterBulkSchema), async (req, res) => {
  const body = req.body as ApplyRosterBulkInput;
  const { data, error } = await req.db.rpc('apply_roster_bulk_change', {
    p_org: req.orgId,
    p_person_ids: body.person_ids,
    p_action: body.action,
    p_tag: body.tag ?? null,
    p_team: body.team_id ?? null,
    p_position: body.position_id ?? null,
    p_expected_changes: body.expected_changes,
    p_idempotency_key: body.idempotency_key,
  });
  if (error) {
    // Stale preview or a reused key: the client should preview again.
    if (error.code === 'PT409') throw new HttpError(409, error.message, 'roster_bulk_stale');
    throw fromPostgrestError(error);
  }
  res.json(data as RosterBulkApplyResult);
});

// ------------------------------------------------- guests and readiness ----
/**
 * A minimal no-login Person added while staffing. Schedulers may do this
 * without people.manage; the database re-checks. No invitation is sent.
 */
rosterRouter.post('/guests', validateBody(createGuestSchema), async (req, res) => {
  if (!canAccessAnywhere(req.access, 'scheduling.manage') && !canAccessAnywhere(req.access, 'people.manage')) {
    throw HttpError.forbidden();
  }
  const body = req.body as CreateGuestInput;
  const id = await unwrap(
    req.db.rpc('create_guest_person', {
      p_org: req.orgId,
      p_first_name: body.first_name,
      p_last_name: body.last_name ?? null,
      p_email: body.email ?? null,
    }),
  );
  if (!id) throw HttpError.notFound();
  res.status(201).json(guestRosterPerson(id, body));
});

/** Login / email / active per Person — booleans only, never the address. */
rosterRouter.post('/readiness', validateBody(deliveryReadinessSchema), async (req, res) => {
  const { person_ids } = req.body as DeliveryReadinessInput;
  res.json((await unwrap(req.db.rpc('person_delivery_readiness', { p_org: req.orgId, p_person_ids: person_ids }))) ?? []);
});

// ------------------------------------------------------ reconciliation ----
rosterRouter.get('/reconciliations', requireAdmin, async (req, res) => {
  res.json(await loadReconciliations({ db: req.db, orgId: req.orgId }));
});

/** keep_separate closes the report; merge moves the no-login record's history. */
rosterRouter.post(
  '/reconciliations/:id/resolve',
  requireAdmin,
  validateBody(resolveReconciliationSchema),
  async (req, res) => {
    const { action } = req.body as ResolveReconciliationInput;
    const { data, error } = await req.db.rpc('resolve_person_reconciliation', { p_id: param(req, 'id'), p_action: action });
    if (error?.code === 'PT409') throw new HttpError(409, error.message, 'reconciliation_blocked');
    if (error) throw fromPostgrestError(error);
    const [named] = await nameReconciliations(req.db, [data as PersonIdentityReconciliationRow]);
    res.json(named);
  },
);

// --------------------------------------------------------------- search ----
/**
 * Every lookup runs through the caller's own RLS client, so a hit (and the
 * "more results" flag) only ever reflects records they could open.
 */
searchRouter.get('/', validateQuery(globalSearchQuerySchema), async (req, res) => {
  const { q, limit } = parsedQuery<GlobalSearchQuery>(res);
  res.json(await globalSearch({ db: req.db, orgId: req.orgId, query: q, limit, canReadPrivate: canReadPrivate(req) }));
});
