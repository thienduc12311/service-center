import { describe, expect, it } from 'vitest';
import { ApiError, delegatedRespondSchema, grantDelegationSchema, type DelegatedScheduleEntry, type DelegationSummary, type RosterPerson } from '@service-center/shared';
import {
  activeReceivedGrant,
  canSeeRequests,
  classifyDelegatedError,
  delegatedActions,
  delegatedRespondBody,
  delegationRights,
  emptyGrantDraft,
  givenGrants,
  grantDraftReady,
  grantRequest,
  helperCandidates,
  householdPeople,
  replacesActiveGrant,
} from './delegations';

const ME = '00000000-0000-4000-8000-0000000000a1';
const SAM = '00000000-0000-4000-8000-0000000000a2';
const RILEY = '00000000-0000-4000-8000-0000000000a3';
const ALEX = '00000000-0000-4000-8000-0000000000a4';

const delegation = (over: Partial<DelegationSummary> = {}): DelegationSummary => ({
  id: 'd-1',
  direction: 'received',
  target_person_id: SAM,
  target_name: 'Sam',
  delegate_person_id: ME,
  delegate_name: 'Me',
  can_respond: false,
  can_view_schedule: false,
  can_manage_availability: false,
  can_signup: false,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-10-01T00:00:00Z',
  active: true,
  ...over,
});

const entry = (over: Partial<DelegatedScheduleEntry> = {}): DelegatedScheduleEntry => ({
  assignment_id: '00000000-0000-4000-8000-0000000000d1',
  status: 'unconfirmed',
  plan_id: 'plan-1',
  plan_title: 'Sunday',
  service_date: '2026-11-01',
  location: null,
  team_name: 'Band',
  position_name: 'Keys',
  times: [],
  ...over,
});

const person = (over: Partial<RosterPerson> = {}): RosterPerson => ({
  id: 'p', person_id: RILEY, profile_id: 'profile-r', has_login: true, full_name: 'Riley', email: null,
  phone: null, avatar_url: null, role: 'member', status: 'active', campus: null, invite_pending: false,
  archived: false, ...over,
});

describe('rights', () => {
  it('words each right separately and treats answering as seeing', () => {
    expect(delegationRights(delegation({ can_respond: true }))).toEqual(['respond', 'view']);
    expect(delegationRights(delegation({ can_view_schedule: true }))).toEqual(['view']);
    expect(delegationRights(delegation({ can_manage_availability: true }))).toEqual(['availability']);
    expect(canSeeRequests(delegation({ can_manage_availability: true }))).toBe(false);
    expect(canSeeRequests(delegation({ can_respond: true }))).toBe(true);
  });

  it('does not word an unused signup right as anything', () => {
    expect(delegationRights(delegation({ can_signup: true }))).toEqual([]);
  });
});

describe('household picker', () => {
  it('lists only active grants made to me, by name', () => {
    const list = householdPeople([
      delegation({ id: 'z', target_person_id: SAM, target_name: 'Sam', can_respond: true }),
      delegation({ id: 'a', target_person_id: ALEX, target_name: 'Alex', can_manage_availability: true }),
      delegation({ id: 'gone', target_person_id: RILEY, target_name: 'Riley', active: false, can_respond: true }),
      delegation({ id: 'mine', direction: 'given', target_person_id: ME, delegate_person_id: SAM, can_respond: true }),
    ]);
    expect(list.map((item) => item.delegationId)).toEqual(['a', 'z']);
    expect(list[0]).toEqual({ delegationId: 'a', personId: ALEX, name: 'Alex', rights: ['availability'] });
  });

  it('finds the grant for a delegated screen only while it is active and received', () => {
    const rows = [delegation({ id: 'live' }), delegation({ id: 'expired', active: false }), delegation({ id: 'given', direction: 'given' })];
    expect(activeReceivedGrant(rows, 'live')?.id).toBe('live');
    expect(activeReceivedGrant(rows, 'expired')).toBeNull();
    expect(activeReceivedGrant(rows, 'given')).toBeNull();
    expect(activeReceivedGrant(undefined, 'live')).toBeNull();
  });

  it('shows the grants I gave with active ones first', () => {
    const rows = givenGrants([
      delegation({ id: 'old', direction: 'given', delegate_name: 'Alex', active: false }),
      delegation({ id: 'new', direction: 'given', delegate_name: 'Riley' }),
      delegation({ id: 'received' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['new', 'old']);
  });
});

describe('helpers who can be asked', () => {
  it('requires an active, unarchived member with a login other than me', () => {
    const people = [
      person(),
      person({ person_id: ME }),
      person({ person_id: SAM, has_login: false, status: 'no_account' }),
      person({ person_id: ALEX, archived: true }),
      person({ person_id: '00000000-0000-4000-8000-0000000000a5', status: 'inactive' }),
      person({ person_id: null }),
    ];
    expect(helperCandidates(people, ME).map((item) => item.person_id)).toEqual([RILEY]);
  });

  it('notes when a new grant replaces an active one', () => {
    const rows = [delegation({ direction: 'given', delegate_person_id: RILEY })];
    expect(replacesActiveGrant(rows, RILEY)).toBe(true);
    expect(replacesActiveGrant(rows, ALEX)).toBe(false);
    expect(replacesActiveGrant([delegation({ direction: 'given', delegate_person_id: RILEY, active: false })], RILEY)).toBe(false);
  });
});

describe('delegated answers', () => {
  it('offers answers only under a respond grant, as the website does', () => {
    const view = delegation({ can_view_schedule: true });
    const respond = delegation({ can_respond: true });
    expect(delegatedActions(view, entry())).toEqual([]);
    expect(delegatedActions(respond, entry())).toEqual(['accept', 'decline']);
    expect(delegatedActions(respond, entry({ status: 'confirmed' }))).toEqual(['withdraw']);
    expect(delegatedActions(respond, entry({ status: 'declined' }))).toEqual([]);
  });

  it('sends the shown status as expected and a reason only when declining', () => {
    const accept = delegatedRespondBody(entry(), 'accept', 'ignored');
    expect(accept).toEqual({ status: 'confirmed', expected_status: 'unconfirmed', reason: null });
    const withdraw = delegatedRespondBody(entry({ status: 'confirmed' }), 'withdraw', '  sick  ');
    expect(withdraw).toEqual({ status: 'declined', expected_status: 'confirmed', reason: 'sick' });
    expect(delegatedRespondBody(entry(), 'decline', '   ').reason).toBeNull();
    expect(delegatedRespondSchema.safeParse(withdraw).success).toBe(true);
  });

  it('tells a stale answer from an ended grant', () => {
    expect(classifyDelegatedError(new ApiError(409, 'stale'))).toBe('stale');
    expect(classifyDelegatedError(new ApiError(404, 'Schedule not found'))).toBe('grantEnded');
    expect(classifyDelegatedError(new ApiError(403, 'no'))).toBe('grantEnded');
    expect(classifyDelegatedError(new ApiError(500, 'boom'))).toBe('other');
    expect(classifyDelegatedError(new Error('offline'))).toBe('other');
  });
});

describe('grant request', () => {
  it('needs a helper and at least one right', () => {
    expect(grantDraftReady(emptyGrantDraft())).toBe(false);
    expect(grantDraftReady({ ...emptyGrantDraft(), delegatePersonId: RILEY })).toBe(true);
    expect(grantDraftReady({ ...emptyGrantDraft(), delegatePersonId: RILEY, canRespond: false, canAvailability: false })).toBe(false);
  });

  it('matches the shared schema, never grants signup, and ends on the chosen day', () => {
    const request = grantRequest({ ...emptyGrantDraft(), delegatePersonId: RILEY, until: '2026-12-31' });
    expect(request.can_signup).toBeUndefined();
    expect(request.can_view_schedule).toBe(true);
    const local = new Date(request.expires_at!);
    expect([local.getFullYear(), local.getMonth() + 1, local.getDate(), local.getHours()]).toEqual([2026, 12, 31, 23]);
    const parsed = grantDelegationSchema.parse(request);
    expect(parsed.can_signup).toBe(false);
    expect(grantRequest({ ...emptyGrantDraft(), delegatePersonId: RILEY }).expires_at).toBeNull();
  });
});
