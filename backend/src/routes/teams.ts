import { Router, type Request } from 'express';
import { param } from '../lib/params.js';
import {
  createPositionSchema,
  createTeamSchema,
  relatedTeamsSchema,
  replaceScopeGrantsSchema,
  teamMembershipSchema,
  teamTagRulesSchema,
  updatePositionSchema,
  updateTeamSchema,
  type RelatedTeamsInput,
  type ReplaceScopeGrantsInput,
  type TeamPolicySettings,
  type TeamTagRulesInput,
  type TeamWithPositions,
} from '@service-center/shared';
import { validateBody } from '../lib/validate.js';
import { requireAdmin, requireCapability, requireManager, requireRosterEditor } from '../middleware/organization.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { loadScopeAccess, replaceScopeAccess } from '../services/access.js';
import { NO_CONTACT, contactsFor, type MemberContact } from '../services/contacts.js';

export const teamsRouter: Router = Router();

// Contact details come from `member_contacts`, never from the join.
const TEAM_SELECT = `
  *,
  positions:team_positions(*),
  memberships:team_memberships(
    id, person_id, user_id, position_id,
    person:people(id, profile_id, first_name, last_name, avatar_url)
  )
`;

interface RawTeamPerson {
  id: string;
  profile_id: string | null;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
}

type RawTeam = Record<string, unknown> & {
  positions?: Array<Record<string, unknown>>;
  memberships?: Array<{
    id: string;
    person_id: string;
    user_id: string | null;
    position_id: string | null;
    person: RawTeamPerson | null;
  }>;
};

/** Roles live on organization_members, so they are stitched in separately. */
const shapeTeam = (
  team: RawTeam,
  roles: Map<string, string>,
  contacts: Map<string, MemberContact>,
): TeamWithPositions => {
  // A team's normal list only; plan-only positions (F02) live on their plan.
  const positions = (team.positions ?? [])
    .filter((position) => position.plan_id === null || position.plan_id === undefined)
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const members = (team.memberships ?? []).map((m) => ({
    person_id: m.person_id,
    user_id: m.user_id,
    position_id: m.position_id,
    membership_id: m.id,
    profile: m.person
      ? {
          id: m.person.id,
          full_name: [m.person.first_name, m.person.last_name].filter(Boolean).join(' '),
          avatar_url: m.person.avatar_url,
          ...(m.user_id ? contacts.get(m.user_id) ?? NO_CONTACT : NO_CONTACT),
          role: m.user_id ? roles.get(m.user_id) ?? 'member' : 'member',
        }
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

const shapeTeams = async (req: Request, teams: RawTeam[]): Promise<TeamWithPositions[]> => {
  const userIds = teams.flatMap((team) =>
    (team.memberships ?? []).flatMap((membership) => membership.user_id ? [membership.user_id] : []),
  );
  const [roles, contacts] = await Promise.all([roleMap(req), contactsFor(req.db, req.orgId, userIds)]);
  return teams.map((team) => shapeTeam(team, roles, contacts));
};

const loadTeam = async (req: Request, id: string): Promise<TeamWithPositions> => {
  const team = (await unwrap(
    raw(req.db).from('teams').select(TEAM_SELECT).eq('id', id).eq('organization_id', req.orgId).maybeSingle(),
  )) as RawTeam | null;
  if (!team) throw HttpError.notFound('Team not found');
  const [shaped] = await shapeTeams(req, [team]);
  if (!shaped) throw HttpError.notFound('Team not found');
  return shaped;
};

teamsRouter.get('/', async (req, res) => {
  const teams = (await unwrap(
    raw(req.db).from('teams').select(TEAM_SELECT).eq('organization_id', req.orgId).order('sort_order'),
  )) as RawTeam[];
  res.json(await shapeTeams(req, teams));
});

teamsRouter.get('/:id', async (req, res) => {
  res.json(await loadTeam(req, param(req, 'id')));
});

teamsRouter.post('/', requireCapability('teams.manage'), validateBody(createTeamSchema), async (req, res) => {
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

  res.status(201).json(await loadTeam(req, created.id));
});

teamsRouter.patch('/:id', requireCapability('teams.manage'), validateBody(updateTeamSchema), async (req, res) => {
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

teamsRouter.delete('/:id', requireCapability('teams.manage'), async (req, res) => {
  await unwrap(req.db.from('teams').delete().eq('id', param(req, 'id')).eq('organization_id', req.orgId));
  res.status(204).end();
});

// ----------------------------------------------------------- positions ----
teamsRouter.post('/:id/positions', requireCapability('teams.manage'), validateBody(createPositionSchema), async (req, res) => {
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
  requireCapability('teams.manage'),
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

teamsRouter.delete('/:id/positions/:positionId', requireCapability('teams.manage'), async (req, res) => {
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
teamsRouter.post('/:id/members', requireRosterEditor, validateBody(teamMembershipSchema), async (req, res) => {
  const { person_id, user_id, position_id } = req.body as {
    person_id?: string;
    user_id?: string;
    position_id?: string | null;
  };

  // Resolve only an explicit Person or its linked Profile. Email is never an
  // identity key, and a no-login Person is a valid team member.
  // The member-visible directory: a team leader need not hold people.view_private.
  const person = await unwrap(
    req.db
      .from('people_directory')
      .select('id, profile_id, archived_at')
      .eq('organization_id', req.orgId)
      .match(person_id ? { id: person_id } : { profile_id: user_id })
      .maybeSingle(),
  );
  if (!person) throw HttpError.badRequest('That Person is not in this organization');
  if (person.archived_at) throw HttpError.conflict('That person is archived; restore them first');

  const created = await unwrapOne(
    req.db
      .from('team_memberships')
      .insert({
        team_id: param(req, 'id'),
        person_id: person.id,
        user_id: person.profile_id,
        position_id: position_id ?? null,
      })
      .select('*')
      .single(),
  );
  res.status(201).json(created);
});

// Owners, admins and that team's leaders; anyone else's delete matches no row.
teamsRouter.delete('/:id/members/:membershipId', requireRosterEditor, async (req, res) => {
  const removed = await unwrap(
    req.db
      .from('team_memberships')
      .delete()
      .eq('id', param(req, 'membershipId'))
      .eq('team_id', param(req, 'id'))
      .select('id'),
  );
  if (!removed?.length) throw HttpError.notFound('Team member not found');
  res.status(204).end();
});

// -------------------------------------------------------------- access ----
/** Who leads this team (team-scoped grants). Administrators only. */
teamsRouter.get('/:id/access', requireAdmin, async (req, res) => {
  res.json(await loadScopeAccess({ db: req.db, orgId: req.orgId, scopeType: 'team', scopeId: param(req, 'id') }));
});

teamsRouter.put('/:id/access', requireAdmin, validateBody(replaceScopeGrantsSchema), async (req, res) => {
  res.json(
    await replaceScopeAccess({
      db: req.db,
      orgId: req.orgId,
      scopeType: 'team',
      scopeId: param(req, 'id'),
      input: req.body as ReplaceScopeGrantsInput,
    }),
  );
});

// ------------------------------------------------------------- policies ----
const loadPolicies = async (req: Request, teamId: string): Promise<TeamPolicySettings> => {
  const team = await unwrap(
    req.db.from('teams').select('id').eq('id', teamId).eq('organization_id', req.orgId).maybeSingle(),
  );
  if (!team) throw HttpError.notFound('Team not found');
  const [rules, related, serviceTypes] = await Promise.all([
    unwrap(req.db.from('team_tag_rules').select('tag').eq('team_id', teamId).order('tag')),
    unwrap(req.db.from('team_related_visibility').select('team_id').eq('related_team_id', teamId)),
    unwrap(req.db.from('service_type_teams').select('service_type_id').eq('team_id', teamId)),
  ]);
  return {
    team_id: teamId,
    tag_rules: (rules ?? []).map((row) => row.tag),
    related_team_ids: (related ?? []).map((row) => row.team_id),
    service_type_ids: (serviceTypes ?? []).map((row) => row.service_type_id),
  };
};

teamsRouter.get('/:id/policies', async (req, res) => {
  res.json(await loadPolicies(req, param(req, 'id')));
});

/** People carrying any of these tags become candidates; computed on read. */
teamsRouter.put('/:id/tag-rules', requireCapability('teams.manage'), validateBody(teamTagRulesSchema), async (req, res) => {
  const teamId = param(req, 'id');
  const tags = [...new Set((req.body as TeamTagRulesInput).tags.map((tag) => tag.toLowerCase()))];
  await loadPolicies(req, teamId);
  await unwrap(req.db.from('team_tag_rules').delete().eq('team_id', teamId));
  if (tags.length) {
    await unwrap(
      req.db.from('team_tag_rules').insert(tags.map((tag) => ({ team_id: teamId, organization_id: req.orgId, tag }))),
    );
  }
  res.json(await loadPolicies(req, teamId));
});

/**
 * The teams whose members may see this team's roster when the organization
 * restricts rosters to teams. Stored as (viewer team → this team), and only
 * this team's managers may open it up.
 */
teamsRouter.put('/:id/related-teams', requireCapability('teams.manage'), validateBody(relatedTeamsSchema), async (req, res) => {
  const teamId = param(req, 'id');
  const viewers = [...new Set((req.body as RelatedTeamsInput).team_ids)].filter((id) => id !== teamId);
  await loadPolicies(req, teamId);
  await unwrap(req.db.from('team_related_visibility').delete().eq('related_team_id', teamId));
  if (viewers.length) {
    await unwrap(
      req.db
        .from('team_related_visibility')
        .insert(viewers.map((viewer) => ({ team_id: viewer, related_team_id: teamId, organization_id: req.orgId }))),
    );
  }
  res.json(await loadPolicies(req, teamId));
});

teamsRouter.get('/:id/candidates', requireManager, async (req, res) => {
  res.json((await unwrap(req.db.rpc('team_candidates', { p_team: param(req, 'id') }))) ?? []);
});

teamsRouter.get('/:id/eligibility', requireManager, async (req, res) => {
  res.json((await unwrap(req.db.rpc('team_eligibility_status', { p_team: param(req, 'id') }))) ?? []);
});
