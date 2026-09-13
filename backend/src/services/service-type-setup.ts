import type {
  PlanTimeKind,
  ServiceTypeRow,
  ServiceTypeSetupInput,
  ServiceTypeSetupResult,
  ServiceTypeSetupTeamInput,
  TeamRow,
} from '@service-center/shared';
import type { Db } from '../lib/supabase.js';
import { unwrap, unwrapOne } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { fetchPlanDetail } from './plans.js';

export interface ServiceTypeSetupContext {
  db: Db;
  orgId: string;
  /** The signed-in manager: authors the plan and joins the teams they picked. */
  userId: string;
  input: ServiceTypeSetupInput;
}

/**
 * Which of the requested teams have to be created and which already exist.
 * Teams are unique by name within an organization, so a wizard run that names
 * a team the organization already has should adopt it rather than fail — the
 * person running the wizard means "this service needs a Band", not "make a
 * second Band".
 */
export interface TeamSetupPlan {
  create: ServiceTypeSetupTeamInput[];
  reuse: TeamRow[];
}

const normalise = (name: string): string => name.trim().toLowerCase();

export const planTeamSetup = (
  requested: readonly ServiceTypeSetupTeamInput[],
  existing: readonly TeamRow[],
): TeamSetupPlan => {
  const existingByName = new Map(existing.map((team) => [normalise(team.name), team]));
  const create: ServiceTypeSetupTeamInput[] = [];
  const reuse: TeamRow[] = [];
  const seen = new Set<string>();

  for (const team of requested) {
    const key = normalise(team.name);
    // The template grid and a hand-typed name can collide; take the first.
    if (seen.has(key)) continue;
    seen.add(key);

    const match = existingByName.get(key);
    if (match) reuse.push(match);
    else create.push(team);
  }

  return { create, reuse };
};

/**
 * Runs the whole "Add a Service Type" wizard: the service type, its first
 * plan with the service times, and the teams that run it.
 *
 * Postgres has no multi-statement transaction over PostgREST, so the steps run
 * in dependency order and the plan — the thing without which the service type
 * is useless — is created before any team work.
 */
export const setUpServiceType = async (
  context: ServiceTypeSetupContext,
): Promise<ServiceTypeSetupResult> => {
  const { db, orgId, userId, input } = context;

  // `service_types` is unique on (organization_id, name) but case-sensitively,
  // so compare the handful of names an organization has rather than relying on
  // the constraint to produce a message anyone can act on.
  const existingNames =
    (await unwrap(db.from('service_types').select('name').eq('organization_id', orgId))) ?? [];
  if (existingNames.some((row) => normalise(row.name) === normalise(input.name))) {
    throw HttpError.conflict(`A service type called “${input.name}” already exists`);
  }

  const serviceType: ServiceTypeRow = await unwrapOne(
    db
      .from('service_types')
      .insert({
        organization_id: orgId,
        name: input.name,
        description: input.description ?? null,
        recurrence: input.recurrence,
      })
      .select('*')
      .single(),
  );

  // The wizard asks for "the first date you would like to plan", so the plan's
  // service date is the start of its earliest service time.
  const earliest = [...input.times].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  )[0]!;

  const plan = await unwrapOne(
    db
      .from('plans')
      .insert({
        organization_id: orgId,
        service_type_id: serviceType.id,
        title: input.plan_title ?? serviceType.name,
        service_date: earliest.starts_at,
        status: 'draft',
        created_by: userId,
      })
      .select('id')
      .single(),
  );

  await unwrap(
    db.from('plan_times').insert(
      input.times.map((time) => ({
        plan_id: plan.id,
        kind: (time.kind ?? 'service') as PlanTimeKind,
        name: time.name ?? null,
        starts_at: time.starts_at,
        ends_at: time.ends_at,
      })),
    ),
  );

  const teams = await createSetupTeams({ db, orgId, userId, input, serviceTypeId: serviceType.id });

  return {
    service_type: serviceType,
    plan: await fetchPlanDetail(db, orgId, plan.id),
    teams,
  };
};

interface CreateSetupTeamsInput extends ServiceTypeSetupContext {
  serviceTypeId: string;
}

const createSetupTeams = async (input: CreateSetupTeamsInput): Promise<TeamRow[]> => {
  const { db, orgId, userId, serviceTypeId } = input;
  if (input.input.teams.length === 0) return [];

  const existing =
    (await unwrap(db.from('teams').select('*').eq('organization_id', orgId))) ?? [];
  const { create, reuse } = planTeamSetup(input.input.teams, existing);

  const created: TeamRow[] =
    create.length === 0
      ? []
      : ((await unwrap(
          db
            .from('teams')
            .insert(
              create.map((team, index) => ({
                organization_id: orgId,
                service_type_id: serviceTypeId,
                name: team.name,
                color: team.color,
                sort_order: index,
              })),
            )
            .select('*'),
        )) ?? []);

  const positions = created.flatMap((team) => {
    const requested = create.find((candidate) => normalise(candidate.name) === normalise(team.name));
    return (requested?.positions ?? []).map((name, index) => ({
      team_id: team.id,
      name,
      sort_order: index,
    }));
  });
  if (positions.length) await unwrap(db.from('team_positions').insert(positions));

  const teams = [...created, ...reuse];

  // "You will be added as a team leader to any teams selected." Membership is
  // the strongest claim the schema models, and it is what puts the team in the
  // planner's "My Teams" list.
  if (input.input.join_teams && teams.length) {
    // team_memberships is guarded by *partial* unique indexes, which PostgREST
    // can't name in an `on conflict` clause, so skip the duplicates by hand.
    const already =
      (await unwrap(
        db
          .from('team_memberships')
          .select('team_id')
          .eq('user_id', userId)
          .in('team_id', teams.map((team) => team.id)),
      )) ?? [];
    const joined = new Set(already.map((row) => row.team_id));
    const missing = teams.filter((team) => !joined.has(team.id));

    if (missing.length) {
      await unwrap(
        db
          .from('team_memberships')
          .insert(missing.map((team) => ({ team_id: team.id, user_id: userId, position_id: null }))),
      );
    }
  }

  return teams;
};
