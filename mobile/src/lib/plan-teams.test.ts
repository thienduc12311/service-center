import { describe, expect, it } from 'vitest';
import type { AssignmentDetail, PlanDetail, TeamWithPositions } from '@service-center/shared';
import { buildPlanTeams, visiblePositions } from './plan-teams';

const SERVICE = 'st-1';

const team = (id: string, positions: string[], serviceTypeId: string | null = SERVICE): TeamWithPositions =>
  ({
    id,
    name: id,
    color: '#000',
    service_type_id: serviceTypeId,
    positions: positions.map((positionId) => ({ id: positionId, team_id: id, name: positionId, plan_id: null })),
  }) as unknown as TeamWithPositions;

const assignment = (overrides: Partial<AssignmentDetail>): AssignmentDetail =>
  ({
    id: Math.random().toString(36),
    team_id: 'band',
    position_id: 'bass',
    status: 'unconfirmed',
    visibility: 'released',
    attendance: [],
    time_responses: [],
    ...overrides,
  }) as AssignmentDetail;

const plan = (overrides: Partial<PlanDetail>): PlanDetail =>
  ({
    service_type_id: SERVICE,
    assignments: [],
    position_needs: [],
    plan_positions: [],
    ...overrides,
  }) as unknown as PlanDetail;

const teams = [team('band', ['bass', 'keys']), team('prod', ['camera']), team('other', ['x'], 'st-2')];

describe('buildPlanTeams (website parity)', () => {
  it('shows the service teams, plus teams already working on the plan', () => {
    const views = buildPlanTeams({
      plan: plan({ assignments: [assignment({ team_id: 'other', position_id: 'x' })] }),
      teams,
      includeEveryTeam: false,
    });
    expect(views.map((view) => view.team.id)).toEqual(['band', 'prod', 'other']);
    expect(buildPlanTeams({ plan: plan({}), teams, includeEveryTeam: false }).map((view) => view.team.id))
      .toEqual(['band', 'prod']);
  });

  it('counts confirmed, declined, released-pending and prepared like the website', () => {
    const [band] = buildPlanTeams({
      plan: plan({
        position_needs: [{ position_id: 'bass', team_id: 'band', needed: 3 }],
        assignments: [
          assignment({ status: 'confirmed' }),
          assignment({ status: 'declined' }),
          assignment({ status: 'unconfirmed' }),
          assignment({ status: 'unconfirmed', visibility: 'prepared' }),
          assignment({ position_id: null }),
        ],
      }),
      teams,
      includeEveryTeam: false,
    });
    expect(band!.confirmed).toBe(1);
    expect(band!.declined).toBe(1);
    expect(band!.pending).toBe(2); // includes the unpositioned released request
    expect(band!.prepared).toHaveLength(1);
    expect(band!.unpositioned).toHaveLength(1);
    expect(band!.positions.find((p) => p.position.id === 'bass')).toMatchObject({ needed: 3 });
    expect(band!.positions.find((p) => p.position.id === 'bass')!.scheduled).toHaveLength(4);
  });

  it('keeps unneeded, unstaffed positions out of view unless editing', () => {
    const [band] = buildPlanTeams({
      plan: plan({ position_needs: [{ position_id: 'keys', team_id: 'band', needed: 1 }] }),
      teams,
      includeEveryTeam: false,
    });
    expect(visiblePositions(band!, false).map((p) => p.position.id)).toEqual(['keys']);
    expect(visiblePositions(band!, true).map((p) => p.position.id)).toEqual(['bass', 'keys']);
  });

  it('adds plan-only positions to their team', () => {
    const [band] = buildPlanTeams({
      plan: plan({
        plan_positions: [{ id: 'sub', team_id: 'band', name: 'Sub', plan_id: 'p' }] as PlanDetail['plan_positions'],
      }),
      teams,
      includeEveryTeam: false,
    });
    expect(band!.positions.find((p) => p.position.id === 'sub')).toMatchObject({ planOnly: true });
  });
});
