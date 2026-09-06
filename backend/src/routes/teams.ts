import { Router, type Request } from 'express';
import { param } from '../lib/params.js';
import {
  createPositionSchema,
  createTeamSchema,
  teamMembershipSchema,
  updatePositionSchema,
  updateTeamSchema,
  type TeamWithPositions,
} from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { requireManager } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';

export const teamsRouter: Router = Router();

const TEAM_SELECT = `
  *,
  positions:team_positions(*),
  memberships:team_memberships(
    id, user_id, position_id,
    profile:profiles(id, full_name, email, avatar_url, phone)
  )
`;

type RawTeam = Record<string, unknown> & {
  positions?: Array<Record<string, unknown>>;
  memberships?: Array<{ id: string; user_id: string; position_id: string | null; profile: unknown }>;
};

/** Roles live on organization_members, so they are stitched in separately. */
const shapeTeam = (team: RawTeam, roles: Map<string, string>): TeamWithPositions => {
  const positions = [...(team.positions ?? [])].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  const members = (team.memberships ?? []).map((m) => ({
    user_id: m.user_id,
    position_id: m.position_id,
    membership_id: m.id,
    profile: m.profile
      ? { ...(m.profile as object), role: roles.get(m.user_id) ?? 'member' }
      : null,
  }));
  const { memberships: _ignored, ...rest } = team;
  return { ...rest, positions, members } as unknown as TeamWithPositions;
};

/** Org roles live on organization_members, so fetch them once per request. */
const roleMap = async (req: Request): Promise<Map<string, string>> => {
  const rows = await unwrap(
    req.db.from('organization_members').select('user_id, role').eq('organization_id', req.orgId),
  );
  return new Map((rows ?? []).map((r) => [r.user_id, r.role as string]));
};

teamsRouter.get('/', async (req, res) => {
  const [teams, roles] = await Promise.all([
    unwrap(
      raw(req.db).from('teams').select(TEAM_SELECT).eq('organization_id', req.orgId).order('sort_order'),
    ) as Promise<RawTeam[]>,
    roleMap(req),
  ]);
  res.json(teams.map((t) => shapeTeam(t, roles)));
});

teamsRouter.get('/:id', async (req, res) => {
  const [team, roles] = await Promise.all([
    unwrap(
      raw(req.db)
        .from('teams')
        .select(TEAM_SELECT)
        .eq('id', param(req, 'id'))
        .eq('organization_id', req.orgId)
        .maybeSingle(),
    ) as Promise<RawTeam | null>,
    roleMap(req),
  ]);
  if (!team) throw HttpError.notFound('Team not found');
  res.json(shapeTeam(team, roles));
});

teamsRouter.post('/', requireManager, validateBody(createTeamSchema), async (req, res) => {
  const { positions, ...team } = req.body as { positions?: string[] } & Record<string, unknown>;

  const created = await unwrapOne(
    req.db
      .from('teams')
      .insert({ ...team, organization_id: req.orgId })
      .select('*')
      .single(),
  );

  if (positions?.length) {
    await unwrap(
      req.db.from('team_positions').insert(
        positions.map((name, index) => ({ team_id: created.id, name, sort_order: index })),
      ),
    );
  }

  const [team_, roles] = await Promise.all([
    unwrapOne(raw(req.db).from('teams').select(TEAM_SELECT).eq('id', created.id).single()) as Promise<RawTeam>,
    roleMap(req),
  ]);
  res.status(201).json(shapeTeam(team_, roles));
});

teamsRouter.patch('/:id', requireManager, validateBody(updateTeamSchema), async (req, res) => {
  const updated = await unwrap(
    req.db
      .from('teams')
      .update(req.body)
      .eq('id', param(req, 'id'))
      .eq('organization_id', req.orgId)
      .select('*')
      .maybeSingle(),
  );
  if (!updated) throw HttpError.notFound('Team not found');
  res.json(updated);
});

teamsRouter.delete('/:id', requireManager, async (req, res) => {
  await unwrap(req.db.from('teams').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

// ----------------------------------------------------------- positions ----
teamsRouter.post('/:id/positions', requireManager, validateBody(createPositionSchema), async (req, res) => {
  const created = await unwrapOne(
    req.db
      .from('team_positions')
      .insert({ ...req.body, team_id: param(req, 'id') })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

teamsRouter.patch(
  '/:id/positions/:positionId',
  requireManager,
  validateBody(updatePositionSchema),
  async (req, res) => {
    const updated = await unwrap(
      req.db
        .from('team_positions')
        .update(req.body)
        .eq('id', param(req, 'positionId'))
        .eq('team_id', param(req, 'id'))
        .select('*')
        .maybeSingle(),
    );
    if (!updated) throw HttpError.notFound('Position not found');
    res.json(updated);
  },
);

teamsRouter.delete('/:id/positions/:positionId', requireManager, async (req, res) => {
  await unwrap(
    req.db
      .from('team_positions')
      .delete()
      .eq('id', param(req, 'positionId'))
      .eq('team_id', param(req, 'id')),
  );
  res.status(204).end();
});

// ------------------------------------------------------------- members ----
teamsRouter.post('/:id/members', requireManager, validateBody(teamMembershipSchema), async (req, res) => {
  const { user_id, position_id } = req.body as { user_id: string; position_id?: string | null };

  // Guard against adding someone who isn't in the organization at all.
  const member = await unwrap(
    req.db
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', req.orgId)
      .eq('user_id', user_id)
      .maybeSingle(),
  );
  if (!member) throw HttpError.badRequest('That person is not in this organization');

  const created = await unwrapOne(
    req.db
      .from('team_memberships')
      .insert({ team_id: param(req, 'id'), user_id, position_id: position_id ?? null })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

teamsRouter.delete('/:id/members/:membershipId', requireManager, async (req, res) => {
  await unwrap(
    req.db
      .from('team_memberships')
      .delete()
      .eq('id', param(req, 'membershipId'))
      .eq('team_id', param(req, 'id')),
  );
  res.status(204).end();
});
