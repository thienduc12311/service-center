import { describe, expect, it } from 'vitest';
import type { EffectiveAccess, EffectiveAccessEntry } from '../types/domain.js';
import {
  CAPABILITY_SCOPES,
  canAccess,
  canAccessAnywhere,
  canEditTeamRoster,
  canEditTeamRosterAnywhere,
  capabilitiesForScope,
  isLeader,
  scopedIds,
} from './access.js';

const BAND = 'team-band';
const HOSTS = 'team-hosts';
const SUNDAY = 'st-sunday';
const YOUTH = 'st-youth';

const access = (entries: EffectiveAccessEntry[]): EffectiveAccess => ({
  organization_id: 'org',
  user_id: 'user',
  role: 'member',
  access_mode: 'legacy',
  can_administer_access: false,
  entries,
});

const grant = (
  capability: EffectiveAccessEntry['capability'],
  scope_type: EffectiveAccessEntry['scope_type'],
  scope_id: string | null,
  source: EffectiveAccessEntry['source'] = 'grant',
): EffectiveAccessEntry => ({ capability, scope_type, scope_id, source, grant_id: 'g' });

describe('canAccess', () => {
  const bandLeader = access([grant('scheduling.manage', 'team', BAND), grant('teams.manage', 'team', BAND)]);

  it('allows the granted team and nothing else', () => {
    expect(canAccess(bandLeader, 'scheduling.manage', { serviceTypeId: SUNDAY, teamId: BAND })).toBe(true);
    expect(canAccess(bandLeader, 'scheduling.manage', { serviceTypeId: SUNDAY, teamId: HOSTS })).toBe(false);
    expect(canAccess(bandLeader, 'plans.edit', { serviceTypeId: SUNDAY })).toBe(false);
    expect(canAccess(bandLeader, 'songs.manage')).toBe(false);
  });

  it('treats service-type grants (including expanded folder grants) as covering every team on its plans', () => {
    const sundayScheduler = access([grant('scheduling.manage', 'service_type', SUNDAY, 'grant:folder')]);
    expect(canAccess(sundayScheduler, 'scheduling.manage', { serviceTypeId: SUNDAY, teamId: HOSTS })).toBe(true);
    expect(canAccess(sundayScheduler, 'scheduling.manage', { serviceTypeId: YOUTH, teamId: HOSTS })).toBe(false);
  });

  it('never matches a scoped rule without a target', () => {
    expect(canAccess(bandLeader, 'scheduling.manage')).toBe(false);
    expect(canAccessAnywhere(bandLeader, 'scheduling.manage')).toBe(true);
  });

  it('gives organization rows everywhere and nothing to an absent access', () => {
    const admin = access([grant('plans.edit', 'organization', null, 'role:admin')]);
    expect(canAccess(admin, 'plans.edit', { serviceTypeId: YOUTH })).toBe(true);
    expect(canAccess(null, 'plans.edit')).toBe(false);
  });

  it('identifies leaders and lists scoped ids', () => {
    expect(isLeader(bandLeader)).toBe(true);
    expect(isLeader(access([grant('songs.manage', 'organization', null)]))).toBe(false);
    expect(scopedIds(bandLeader, 'scheduling.manage', 'team')).toEqual([BAND]);
  });
});

describe('capability scopes', () => {
  it('keeps library and directory capabilities organization-wide', () => {
    expect(capabilitiesForScope('team')).toEqual([
      'scheduling.manage',
      'scheduling.override_conflicts',
      'teams.manage',
    ]);
    expect(CAPABILITY_SCOPES['songs.manage']).toEqual(['organization']);
    expect(capabilitiesForScope('organization')).toHaveLength(8);
  });
});

describe('canEditTeamRoster', () => {
  const band = { serviceTypeId: SUNDAY, teamId: BAND };

  it('lets owners, admins and team leaders change who is on the team', () => {
    expect(canEditTeamRoster(access([grant('teams.manage', 'organization', null, 'role:owner')]), band)).toBe(true);
    expect(canEditTeamRoster(access([grant('teams.manage', 'organization', null, 'role:admin')]), band)).toBe(true);
    const bandLeader = access([grant('teams.manage', 'team', BAND)]);
    expect(canEditTeamRoster(bandLeader, band)).toBe(true);
    expect(canEditTeamRoster(bandLeader, { serviceTypeId: SUNDAY, teamId: HOSTS })).toBe(false);
  });

  it('does not count a legacy scheduler role as leading a team', () => {
    const scheduler = access([
      grant('teams.manage', 'organization', null, 'role:scheduler_legacy'),
      grant('scheduling.manage', 'organization', null, 'role:scheduler_legacy'),
    ]);
    expect(canEditTeamRoster(scheduler, band)).toBe(false);
    expect(canEditTeamRosterAnywhere(scheduler)).toBe(false);
    // …but an explicit leader grant on top of it does.
    expect(canEditTeamRoster(access([...scheduler.entries, grant('teams.manage', 'team', BAND)]), band)).toBe(true);
  });

  it('does not treat scheduling a team as leading it', () => {
    expect(canEditTeamRoster(access([grant('scheduling.manage', 'team', BAND)]), band)).toBe(false);
    expect(canEditTeamRosterAnywhere(null)).toBe(false);
  });
});
