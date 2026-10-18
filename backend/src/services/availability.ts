import { createHash } from 'node:crypto';
import {
  canAccessAnywhere,
  type AvailabilityAudienceMember,
  type AvailabilityRequestDetail,
  type AvailabilityRequestRow,
  type AvailabilityRequestSummary,
  type CombinedSchedule,
  type CombinedScheduleOrganization,
  type CopyAvailabilityInput,
  type CopyAvailabilityResult,
  type CopyAvailabilityTargetResult,
  type CreateAvailabilityRequestInput,
  type CreateAvailabilityRequestResult,
  type DelegatedResponseResult,
  type DelegatedSchedule,
  type DelegationSummary,
  type EffectiveAccess,
  type MyAvailabilityRequest,
  type PreferenceWarning,
  type PreferenceWarningsInput,
  type SaveSchedulingPreferenceInput,
  type SchedulingPreferenceRow,
  type ScheduleDelegationRow,
} from '@service-center/shared';
import { raw, unwrap, type Db } from '../lib/supabase.js';
import { HttpError, fromPostgrestError } from '../lib/errors.js';
import {
  busyElsewhereWarnings,
  copyIdempotencyUuid,
  toAudienceMember,
  toCombinedItem,
  toDelegatedEntry,
  toDelegationSummary,
  toPreferenceWarnings,
  toRequestRecipient,
  toRequestSummary,
  type AudienceRpcRow,
  type BusyRpcRow,
  type DelegatedScheduleRpcRow,
  type DelegationWithPeople,
  type OrganizationScheduleRpcRow,
  type RecipientWithPerson,
  type WarningRpcRow,
} from '../model/availability.model.js';

/** What every availability call knows about the caller. */
export interface AvailabilityContext {
  db: Db;
  orgId: string;
  userId: string;
  access: EffectiveAccess | null;
}

export type AvailabilityAction = 'availability' | 'view';

export interface AvailabilityTarget {
  personId: string;
  profileId: string | null;
  /** How the caller is allowed: their own record, as a scheduler, or as a delegate. */
  via: 'self' | 'scheduler' | 'delegate';
}

/**
 * Names for delegation rows. A delegate cannot read the other person's full
 * `people` row (contact fields are private), so names come from the
 * member-visible `people_directory`.
 */
const withPeopleNames = async (ctx: AvailabilityContext, rows: readonly ScheduleDelegationRow[]): Promise<DelegationWithPeople[]> => {
  const ids = [...new Set(rows.flatMap((row) => [row.target_person_id, row.delegate_person_id]))];
  const names = ids.length
    ? (await unwrap(ctx.db.from('people_directory').select('id, first_name, last_name').in('id', ids))) ?? []
    : [];
  const byId = new Map(names.map((name) => [name.id, name]));
  return rows.map((row) => ({ ...row, target: byId.get(row.target_person_id) ?? null, delegate: byId.get(row.delegate_person_id) ?? null }));
};

export const myPersonId = async (ctx: AvailabilityContext): Promise<string | null> => {
  const me = await unwrap(
    ctx.db.from('people').select('id').eq('organization_id', ctx.orgId).eq('profile_id', ctx.userId).maybeSingle(),
  );
  return me?.id ?? null;
};

/** A live availability grant from `personId` to the caller (UX check; RLS decides). */
const hasAvailabilityGrant = async (ctx: AvailabilityContext, personId: string): Promise<boolean> => {
  const mine = await myPersonId(ctx);
  if (!mine) return false;
  const grant = await unwrap(
    ctx.db.from('schedule_delegations').select('id, expires_at')
      .eq('target_person_id', personId).eq('delegate_person_id', mine)
      .eq('can_manage_availability', true).is('revoked_at', null).maybeSingle(),
  );
  return Boolean(grant && (!grant.expires_at || new Date(grant.expires_at) > new Date()));
};

/**
 * Whose availability a request is about. Defaults to the caller's own
 * Person; another Person needs scheduling access or an explicit availability
 * grant from them. The database re-checks both on every statement.
 */
export const resolveAvailabilityTarget = async (
  ctx: AvailabilityContext,
  personId?: string,
  legacyUserId?: string,
): Promise<AvailabilityTarget> => {
  // The directory (names only) is visible to every member, so a delegate can
  // resolve the person they help; access is decided below and by RLS.
  let query = ctx.db.from('people_directory').select('id, profile_id').eq('organization_id', ctx.orgId);
  query = personId ? query.eq('id', personId) : query.eq('profile_id', legacyUserId ?? ctx.userId);
  const person = await unwrap(query.maybeSingle());
  if (!person) throw HttpError.notFound('Person not found');
  if (person.profile_id === ctx.userId) return { personId: person.id, profileId: person.profile_id, via: 'self' };
  if (canAccessAnywhere(ctx.access, 'scheduling.manage')) {
    return { personId: person.id, profileId: person.profile_id, via: 'scheduler' };
  }
  if (await hasAvailabilityGrant(ctx, person.id)) {
    return { personId: person.id, profileId: person.profile_id, via: 'delegate' };
  }
  throw HttpError.forbidden('Only schedulers or someone they asked to help can change another person’s availability');
};

// ----------------------------------------------------------- preferences --

export const savePreference = async (
  ctx: AvailabilityContext,
  personId: string,
  input: SaveSchedulingPreferenceInput,
): Promise<SchedulingPreferenceRow> => {
  const fields = {
    frequency: input.frequency,
    max_per_month: input.max_per_month,
    preferred_weeks: input.preferred_weeks,
    avoided_weeks: input.avoided_weeks,
    preferred_dates: input.preferred_dates,
    avoided_dates: input.avoided_dates,
    preferred_times: input.preferred_times,
  };
  let existingQuery = ctx.db.from('scheduling_preferences').select('id, revision')
    .eq('organization_id', ctx.orgId).eq('person_id', personId);
  existingQuery = input.team_id ? existingQuery.eq('team_id', input.team_id) : existingQuery.is('team_id', null);
  const existing = await unwrap(existingQuery.maybeSingle());

  if (!existing) {
    if (input.expected_revision != null) throw HttpError.conflict('These preferences were removed; reload and try again');
    const { data, error } = await ctx.db.from('scheduling_preferences')
      .insert({ ...fields, organization_id: ctx.orgId, person_id: personId, team_id: input.team_id })
      .select('*').single();
    if (error?.code === '23505') throw HttpError.conflict('Someone else just saved these preferences; reload and try again');
    if (error) throw fromPostgrestError(error);
    return data;
  }
  if (input.expected_revision == null || input.expected_revision !== existing.revision) {
    throw HttpError.conflict('These preferences changed; reload and try again');
  }
  const updated = await unwrap(
    ctx.db.from('scheduling_preferences').update(fields)
      .eq('id', existing.id).eq('revision', existing.revision).select('*').maybeSingle(),
  );
  if (!updated) throw HttpError.conflict('These preferences changed; reload and try again');
  return updated;
};

// -------------------------------------------------------------- warnings --

/** Preference/freshness warnings plus opted-in cross-organization busy time. */
export const preferenceWarnings = async (
  ctx: AvailabilityContext,
  input: PreferenceWarningsInput,
): Promise<PreferenceWarning[]> => {
  const { data, error } = await raw(ctx.db).rpc('scheduling_preference_warnings', {
    p_organization_id: ctx.orgId,
    p_plan_id: input.plan_id,
    p_team_id: input.team_id,
    p_person_ids: input.person_ids,
    p_plan_time_ids: input.plan_time_ids ?? null,
  });
  if (error) throw fromPostgrestError(error);
  const warnings = toPreferenceWarnings((data ?? []) as WarningRpcRow[]);

  let timesQuery = ctx.db.from('plan_times').select('starts_at, ends_at').eq('plan_id', input.plan_id);
  if (input.plan_time_ids?.length) timesQuery = timesQuery.in('id', input.plan_time_ids);
  const times = (await unwrap(timesQuery)) ?? [];
  if (times.length === 0) return warnings;
  const from = new Date(Math.min(...times.map((t) => new Date(t.starts_at).getTime())));
  const to = new Date(Math.max(...times.map((t) => new Date(t.ends_at).getTime())));
  if (to.getTime() - from.getTime() > 92 * 24 * 60 * 60 * 1000) return warnings;
  const busy = await raw(ctx.db).rpc('cross_organization_busy', {
    p_organization_id: ctx.orgId, p_person_ids: input.person_ids,
    p_from: from.toISOString(), p_to: to.toISOString(),
  });
  if (busy.error) throw fromPostgrestError(busy.error);
  return [...warnings, ...busyElsewhereWarnings((busy.data ?? []) as BusyRpcRow[], times)];
};

// ------------------------------------------------- availability requests --

export const previewAudience = async (ctx: AvailabilityContext, teamId: string): Promise<AvailabilityAudienceMember[]> => {
  const { data, error } = await raw(ctx.db).rpc('preview_availability_request', {
    p_organization_id: ctx.orgId, p_team_id: teamId,
  });
  if (error) throw fromPostgrestError(error);
  return ((data ?? []) as AudienceRpcRow[])
    .map((row) => toAudienceMember(row))
    .sort((a, b) => `${a.first_name} ${a.last_name ?? ''}`.localeCompare(`${b.first_name} ${b.last_name ?? ''}`));
};

export const createAvailabilityRequest = async (
  ctx: AvailabilityContext,
  input: CreateAvailabilityRequestInput,
): Promise<CreateAvailabilityRequestResult> => {
  const { data, error } = await raw(ctx.db).rpc('create_availability_request', {
    p_organization_id: ctx.orgId,
    p_team_id: input.team_id,
    p_person_ids: input.person_ids,
    p_message: input.message ?? null,
    p_window_start: input.window_start,
    p_window_end: input.window_end,
    p_respond_by: input.respond_by ?? null,
    p_idempotency_key: input.idempotency_key,
  });
  if (error?.code === 'PT409') {
    throw HttpError.conflict('The team changed since the preview; review the recipients again', { code: 'audience_changed' });
  }
  if (error) throw fromPostgrestError(error);
  const row = ((data ?? []) as CreateAvailabilityRequestResult[])[0];
  if (!row) throw new HttpError(500, 'The request was not created');
  return row;
};

const summarize = async (ctx: AvailabilityContext, rows: readonly AvailabilityRequestRow[]): Promise<AvailabilityRequestSummary[]> => {
  if (rows.length === 0) return [];
  const teamIds = [...new Set(rows.flatMap((row) => row.team_id ? [row.team_id] : []))];
  const [teams, recipients] = await Promise.all([
    teamIds.length ? unwrap(ctx.db.from('teams').select('id, name').in('id', teamIds)) : Promise.resolve([]),
    unwrap(ctx.db.from('availability_request_recipients').select('request_id, responded_at').in('request_id', rows.map((r) => r.id))),
  ]);
  const teamName = new Map((teams ?? []).map((team) => [team.id, team.name]));
  const responded = new Map<string, number>();
  for (const recipient of recipients ?? []) {
    if (recipient.responded_at) responded.set(recipient.request_id, (responded.get(recipient.request_id) ?? 0) + 1);
  }
  return rows.map((row) => toRequestSummary(row, row.team_id ? teamName.get(row.team_id) ?? null : null, responded.get(row.id) ?? 0));
};

/** Requests the caller sent or may manage (RLS), newest first. */
export const listAvailabilityRequests = async (ctx: AvailabilityContext, teamId?: string): Promise<AvailabilityRequestSummary[]> => {
  const myPerson = await myPersonId(ctx);
  let query = ctx.db.from('availability_requests').select('*').eq('organization_id', ctx.orgId)
    .order('created_at', { ascending: false }).limit(50);
  if (teamId) query = query.eq('team_id', teamId);
  const rows = (await unwrap(query)) ?? [];
  // A recipient can read their own request too; this list is the leaders' view.
  const mine = myPerson
    ? new Set(((await unwrap(ctx.db.from('availability_request_recipients').select('request_id').eq('person_id', myPerson))) ?? []).map((r) => r.request_id))
    : new Set<string>();
  return summarize(ctx, rows.filter((row) => row.created_by === ctx.userId || !mine.has(row.id)
    || canAccessAnywhere(ctx.access, 'scheduling.manage')));
};

export const availabilityRequestDetail = async (ctx: AvailabilityContext, id: string): Promise<AvailabilityRequestDetail> => {
  const request = await unwrap(ctx.db.from('availability_requests').select('*').eq('id', id).eq('organization_id', ctx.orgId).maybeSingle());
  if (!request) throw HttpError.notFound('Request not found');
  const recipients = (await unwrap(
    raw(ctx.db).from('availability_request_recipients')
      .select('person_id, responded_at, response_kind, person:people(first_name, last_name)')
      .eq('request_id', id),
  )) as unknown as RecipientWithPerson[];
  if (recipients.length < request.recipient_count && request.created_by !== ctx.userId
      && !canAccessAnywhere(ctx.access, 'scheduling.manage')) {
    // A recipient reading someone else's request detail sees only themselves; the leader view needs access.
    throw HttpError.notFound('Request not found');
  }
  const reviews = (await unwrap(
    ctx.db.from('person_availability_reviews').select('person_id, reviewed_at').in('person_id', recipients.map((r) => r.person_id)),
  )) ?? [];
  const reviewByPerson = new Map(reviews.map((review) => [review.person_id, review]));
  const [summary] = await summarize(ctx, [request]);
  return {
    request: summary!,
    recipients: recipients
      .map((recipient) => toRequestRecipient(recipient, reviewByPerson.get(recipient.person_id) ?? null, request.created_at))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};

export const myOpenAvailabilityRequests = async (ctx: AvailabilityContext): Promise<MyAvailabilityRequest[]> => {
  const me = await myPersonId(ctx);
  if (!me) return [];
  const open = (await unwrap(
    ctx.db.from('availability_request_recipients').select('request_id').eq('person_id', me).is('responded_at', null),
  )) ?? [];
  if (open.length === 0) return [];
  const requests = (await unwrap(
    ctx.db.from('availability_requests').select('id, message, window_start, window_end, respond_by, created_at')
      .in('id', open.map((row) => row.request_id)).order('created_at', { ascending: false }),
  )) ?? [];
  return requests.map((row) => ({
    request_id: row.id, message: row.message, window_start: row.window_start,
    window_end: row.window_end, respond_by: row.respond_by, created_at: row.created_at,
  }));
};

// ------------------------------------------------------------ delegation --

export const listDelegations = async (ctx: AvailabilityContext): Promise<DelegationSummary[]> => {
  const me = await myPersonId(ctx);
  if (!me) return [];
  const rows = (await unwrap(
    ctx.db.from('schedule_delegations').select('*')
      .eq('organization_id', ctx.orgId)
      .or(`target_person_id.eq.${me},delegate_person_id.eq.${me}`)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  )) ?? [];
  return (await withPeopleNames(ctx, rows)).map((row) => toDelegationSummary(row, me));
};

export const delegationSummary = async (ctx: AvailabilityContext, id: string): Promise<DelegationSummary> => {
  const row = await unwrap(
    ctx.db.from('schedule_delegations').select('*').eq('id', id).eq('organization_id', ctx.orgId).maybeSingle(),
  );
  if (!row) throw HttpError.notFound('Delegation not found');
  const [named] = await withPeopleNames(ctx, [row]);
  return toDelegationSummary(named!, await myPersonId(ctx));
};

export const delegatedSchedule = async (ctx: AvailabilityContext, id: string): Promise<DelegatedSchedule> => {
  const delegation = await delegationSummary(ctx, id);
  if (delegation.direction !== 'received' || !delegation.active) throw HttpError.notFound('Schedule not found');
  const { data, error } = await raw(ctx.db).rpc('delegated_schedule', {
    p_organization_id: ctx.orgId, p_person_id: delegation.target_person_id,
  });
  if (error) throw fromPostgrestError(error);
  return { delegation, entries: ((data ?? []) as DelegatedScheduleRpcRow[]).map(toDelegatedEntry) };
};

export interface DelegatedRespondCommand {
  delegationId: string;
  assignmentId: string;
  status: 'confirmed' | 'declined';
  expectedStatus: 'unconfirmed' | 'confirmed' | 'declined';
  reason: string | null;
}

export interface DelegatedRespondOutcome {
  result: DelegatedResponseResult;
  effectId: string | null;
}

export const respondAsDelegate = async (
  ctx: AvailabilityContext,
  command: DelegatedRespondCommand,
): Promise<DelegatedRespondOutcome> => {
  const delegation = await delegationSummary(ctx, command.delegationId);
  if (delegation.direction !== 'received') throw HttpError.notFound('Request not found');
  const { data, error } = await raw(ctx.db).rpc('respond_as_delegate', {
    p_organization_id: ctx.orgId,
    p_person_id: delegation.target_person_id,
    p_assignment_id: command.assignmentId,
    p_status: command.status,
    p_expected_status: command.expectedStatus,
    p_reason: command.reason,
  });
  if (error?.code === 'PT409') throw HttpError.conflict(error.message, { code: 'assignment_response_stale' });
  if (error) throw fromPostgrestError(error);
  const row = ((data ?? []) as Array<DelegatedResponseResult & { effect_id: string | null }>)[0];
  if (!row) throw HttpError.notFound('Request not found');
  return {
    result: { assignment_id: row.assignment_id, status: row.status, transition: row.transition },
    effectId: row.effect_id,
  };
};

// ------------------------------------------------- across organizations --

export interface UserContext {
  db: Db;
  userId: string;
}

interface MembershipRow {
  organization_id: string;
  organization: { name: string } | null;
}

/**
 * Each organization is read on its own through that organization's RLS; one
 * failing never hides the others, and the membership list is fixed at the
 * start of the request.
 */
export const combinedSchedule = async (ctx: UserContext, from: string, to: string): Promise<CombinedSchedule> => {
  const memberships = (await unwrap(
    raw(ctx.db).from('organization_members').select('organization_id, organization:organizations(name)')
      .eq('user_id', ctx.userId).eq('status', 'active'),
  )) as unknown as MembershipRow[];
  const organizations = await Promise.all(memberships.map(async (membership): Promise<CombinedScheduleOrganization> => {
    const base = { organization_id: membership.organization_id, organization_name: membership.organization?.name ?? 'Organization' };
    const { data, error } = await raw(ctx.db).rpc('my_organization_schedule', {
      p_organization_id: membership.organization_id, p_from: from, p_to: to,
    });
    if (error) return { ...base, status: 'error', error: fromPostgrestError(error).message, items: [] };
    return { ...base, status: 'ok', error: null, items: ((data ?? []) as OrganizationScheduleRpcRow[]).map(toCombinedItem) };
  }));
  return { from, to, organizations: organizations.sort((a, b) => a.organization_name.localeCompare(b.organization_name)) };
};

interface SourceBlockout {
  id: string;
  person_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  timezone: string | null;
  all_day: boolean;
  local_start_date: string | null;
  local_start_time: string | null;
  local_end_date: string | null;
  local_end_time: string | null;
}

/**
 * Copies the caller's own blockouts into other organizations they belong to.
 * Membership is re-checked per target and each write goes through MOB-006's
 * create_blockout under that organization's rules; reasons are copied only
 * when asked. Retrying with the same key never duplicates rows.
 */
export const copyAvailability = async (
  ctx: UserContext,
  sourceOrgId: string,
  input: CopyAvailabilityInput,
): Promise<CopyAvailabilityResult> => {
  const me = await unwrap(
    ctx.db.from('people').select('id').eq('organization_id', sourceOrgId).eq('profile_id', ctx.userId).maybeSingle(),
  );
  if (!me) throw HttpError.notFound('Person not found');
  const sources = ((await unwrap(
    ctx.db.from('blockouts')
      .select('id, person_id, starts_at, ends_at, reason, timezone, all_day, local_start_date, local_start_time, local_end_date, local_end_time')
      .eq('organization_id', sourceOrgId).eq('person_id', me.id).in('id', input.blockout_ids),
  )) ?? []) as SourceBlockout[];
  if (sources.length !== new Set(input.blockout_ids).size) throw HttpError.notFound('Choose your own blockouts to copy');

  const results: CopyAvailabilityTargetResult[] = [];
  for (const orgId of [...new Set(input.target_organization_ids)].filter((id) => id !== sourceOrgId)) {
    const target = await unwrap(
      ctx.db.from('people').select('id').eq('organization_id', orgId).eq('profile_id', ctx.userId).maybeSingle(),
    );
    const membership = await unwrap(
      ctx.db.from('organization_members').select('user_id').eq('organization_id', orgId)
        .eq('user_id', ctx.userId).eq('status', 'active').maybeSingle(),
    );
    if (!target || !membership) {
      results.push({ organization_id: orgId, outcome: 'not_member', copied: 0, error: null });
      continue;
    }
    let copied = 0;
    let replayed = 0;
    let failure: string | null = null;
    for (const source of sources) {
      const key = copyIdempotencyUuid(createHash('sha256').update(`${input.idempotency_key}:${orgId}:${source.id}`).digest('hex'));
      const existing = await unwrap(
        ctx.db.from('blockouts').select('id').eq('organization_id', orgId)
          .eq('created_by', ctx.userId).eq('idempotency_key', key).maybeSingle(),
      );
      if (existing) { replayed += 1; continue; }
      const { error } = await raw(ctx.db).rpc('create_blockout', {
        p_organization_id: orgId,
        p_person_id: target.id,
        p_payload: {
          starts_at: source.starts_at, ends_at: source.ends_at,
          reason: input.include_reason ? source.reason : null,
          timezone: source.timezone, all_day: source.all_day,
          local_start_date: source.local_start_date, local_start_time: source.local_start_time,
          local_end_date: source.local_end_date, local_end_time: source.local_end_time,
        },
        p_idempotency_key: key,
      });
      if (error) { failure = fromPostgrestError(error).message; break; }
      copied += 1;
    }
    results.push({
      organization_id: orgId,
      outcome: failure ? 'failed' : copied === 0 && replayed > 0 ? 'already_copied' : 'copied',
      copied,
      error: failure,
    });
  }
  return { results };
};
