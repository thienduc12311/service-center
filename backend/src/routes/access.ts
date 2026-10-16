import { Router } from 'express';
import {
  explainCapabilityQuerySchema,
  replaceScopeGrantsSchema,
  rosterVisibilitySchema,
  updateMemberAccessSchema,
  type ExplainCapabilityQuery,
  type ReplaceScopeGrantsInput,
  type RosterVisibilityInput,
  type UpdateMemberAccessInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { parsedQuery, validateBody, validateQuery } from '../lib/validate.js';
import { unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { requireAdmin } from '../middleware/organization.js';
import {
  explainAccess,
  listAccessMembers,
  loadMemberAccess,
  loadScopeAccess,
  replaceScopeAccess,
  setAccessMode,
} from '../services/access.js';

/**
 * F01 access review and administration. Reading your own access is open to
 * every member; everything else is owner/admin only, and the database
 * functions enforce the same rule independently.
 */
export const accessRouter: Router = Router();

accessRouter.get('/me', (req, res) => {
  res.json(req.access);
});

accessRouter.get('/members', requireAdmin, async (req, res) => {
  res.json(await listAccessMembers(req.db, req.orgId));
});

accessRouter.get('/members/:userId', requireAdmin, async (req, res) => {
  res.json(await loadMemberAccess(req.db, req.orgId, param(req, 'userId')));
});

/** Opt a scheduler into scoped access (or back to legacy organization-wide). */
accessRouter.patch('/members/:userId', requireAdmin, validateBody(updateMemberAccessSchema), async (req, res) => {
  const { access_mode } = req.body as UpdateMemberAccessInput;
  res.json(await setAccessMode({ db: req.db, orgId: req.orgId, userId: param(req, 'userId'), accessMode: access_mode }));
});

/** Why someone is allowed or denied one thing. Members may ask about themselves. */
accessRouter.get('/explain', validateQuery(explainCapabilityQuerySchema), async (req, res) => {
  const query = parsedQuery<ExplainCapabilityQuery>(res);
  if (query.user_id !== req.auth.userId && !req.access.can_administer_access) {
    throw HttpError.forbidden('Only an administrator can review someone else’s access');
  }
  res.json(await explainAccess(req.db, req.orgId, query));
});

accessRouter.get('/organization', requireAdmin, async (req, res) => {
  res.json(await loadScopeAccess({ db: req.db, orgId: req.orgId, scopeType: 'organization', scopeId: null }));
});

accessRouter.put('/organization', requireAdmin, validateBody(replaceScopeGrantsSchema), async (req, res) => {
  res.json(
    await replaceScopeAccess({
      db: req.db,
      orgId: req.orgId,
      scopeType: 'organization',
      scopeId: null,
      input: req.body as ReplaceScopeGrantsInput,
    }),
  );
});

/** Team-restricted rosters (the related-team visibility policy). */
accessRouter.put('/roster-visibility', requireAdmin, validateBody(rosterVisibilitySchema), async (req, res) => {
  const { assignment_visibility } = req.body as RosterVisibilityInput;
  const updated = await unwrapOne(
    req.db
      .from('organizations')
      .update({ assignment_visibility })
      .eq('id', req.orgId)
      .select('assignment_visibility')
      .single(),
  );
  const body: RosterVisibilityInput = { assignment_visibility: updated.assignment_visibility };
  res.json(body);
});
