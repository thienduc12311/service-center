import type {
  AssignmentStatus,
  CalendarLayerEvent,
  CalendarLayersQuery,
  CalendarScopedFeedCreated,
  CalendarScopedFeedRow,
  CalendarScopedFeedSummary,
  CreateScopedFeedInput,
  PersonCalendarSharingInput,
  PersonCalendarSharingRow,
} from '@service-center/shared';
import { localDateAt } from '@service-center/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { renderIcs, type IcsEvent } from '../lib/ics.js';
import { adminDb, raw, unwrap, type Db } from '../lib/supabase.js';
import {
  layerIcsEvent,
  scopedFeedUrls,
  scopedPlanTimeUid,
  toCalendarLayerEvent,
  toScopedFeedSummary,
} from '../model/calendar-feed.model.js';
import { personName, type PersonNameRow } from '../model/availability.model.js';
import { attendanceFor } from './attendance.js';
import { generateCalendarFeedToken } from './calendar-feed-tokens.js';
import { hashInviteToken } from './invitations.js';

/** The signed-in caller (RLS-bound client) in the active organization. */
export interface FeedCaller {
  db: Db;
  orgId: string;
  userId: string;
}

const MAX_LIVE_FEEDS = 20;

const scopeNames = async (db: Db, rows: readonly CalendarScopedFeedRow[]): Promise<Map<string, string>> => {
  const stIds = rows.flatMap((row) => (row.service_type_id ? [row.service_type_id] : []));
  const teamIds = rows.flatMap((row) => (row.team_id ? [row.team_id] : []));
  const [serviceTypes, teams] = await Promise.all([
    stIds.length ? unwrap(db.from('service_types').select('id, name').in('id', stIds)) : Promise.resolve([]),
    teamIds.length ? unwrap(db.from('teams').select('id, name').in('id', teamIds)) : Promise.resolve([]),
  ]);
  return new Map([...(serviceTypes ?? []), ...(teams ?? [])].map((row) => [row.id, row.name]));
};

const summarize = async (db: Db, rows: CalendarScopedFeedRow[]): Promise<CalendarScopedFeedSummary[]> => {
  const names = await scopeNames(db, rows);
  return rows.map((row) => toScopedFeedSummary(row, names.get(row.service_type_id ?? row.team_id ?? '') ?? null));
};

export const listScopedFeeds = async ({ db, orgId, userId }: FeedCaller): Promise<CalendarScopedFeedSummary[]> => {
  const rows = ((await unwrap(
    db
      .from('calendar_scoped_feeds')
      .select('*')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .order('created_at'),
  )) ?? []) as CalendarScopedFeedRow[];
  return summarize(db, rows);
};

type FeedScopeFields = Pick<CalendarScopedFeedRow, 'scope_type' | 'service_type_id' | 'team_id' | 'include_rehearsals' | 'layers' | 'label'>;

/** RLS refuses a scope the caller cannot currently read (insert policy). */
const insertFeed = async ({ db, orgId, userId }: FeedCaller, scope: FeedScopeFields): Promise<CalendarScopedFeedCreated> => {
  const generated = generateCalendarFeedToken();
  const { data, error } = await db
    .from('calendar_scoped_feeds')
    .insert({ organization_id: orgId, user_id: userId, token_hash: generated.tokenHash, ...scope })
    .select('*')
    .single();
  if (error) {
    if (error.code === '42501') throw HttpError.forbidden('You cannot subscribe to that calendar');
    throw HttpError.badRequest('Could not create that feed');
  }
  const [feed] = await summarize(db, [data as CalendarScopedFeedRow]);
  return { feed: feed!, ...scopedFeedUrls(config.API_URL, generated.token) };
};

export const createScopedFeed = async (caller: FeedCaller, input: CreateScopedFeedInput): Promise<CalendarScopedFeedCreated> => {
  const live = await listScopedFeeds(caller);
  if (live.length >= MAX_LIVE_FEEDS) throw HttpError.conflict(`Keep at most ${MAX_LIVE_FEEDS} calendar feeds`);
  return insertFeed(caller, {
    scope_type: input.scope_type,
    service_type_id: input.scope_type === 'service_type' ? input.service_type_id ?? null : null,
    team_id: input.scope_type === 'team' ? input.team_id ?? null : null,
    include_rehearsals: input.include_rehearsals,
    layers: [...new Set(input.layers)],
    label: input.label ?? null,
  });
};

const ownLiveFeed = async ({ db, orgId, userId }: FeedCaller, feedId: string): Promise<CalendarScopedFeedRow> => {
  const row = (await unwrap(
    db
      .from('calendar_scoped_feeds')
      .select('*')
      .eq('id', feedId)
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .maybeSingle(),
  )) as CalendarScopedFeedRow | null;
  if (!row) throw HttpError.notFound('Feed not found');
  return row;
};

export const revokeScopedFeed = async (caller: FeedCaller, feedId: string): Promise<void> => {
  await ownLiveFeed(caller, feedId);
  await unwrap(caller.db.from('calendar_scoped_feeds').update({ revoked_at: new Date().toISOString() }).eq('id', feedId));
};

/** New token, same scope; the old URL stops working at once. */
export const rotateScopedFeed = async (caller: FeedCaller, feedId: string): Promise<CalendarScopedFeedCreated> => {
  const row = await ownLiveFeed(caller, feedId);
  await revokeScopedFeed(caller, feedId);
  return insertFeed(caller, {
    scope_type: row.scope_type,
    service_type_id: row.service_type_id,
    team_id: row.team_id,
    include_rehearsals: row.include_rehearsals,
    layers: row.layers,
    label: row.label,
  });
};

/** The signed-in calendar's layers for one team (the database checks current access). */
export const calendarLayers = async ({ db, orgId }: FeedCaller, query: CalendarLayersQuery): Promise<CalendarLayerEvent[]> => {
  const team = await unwrap(db.from('teams').select('id').eq('id', query.team_id).eq('organization_id', orgId).maybeSingle());
  if (!team) throw HttpError.notFound('Team not found');
  const rows = await unwrap(
    db.rpc('team_calendar_layers', { p_team: query.team_id, p_from: query.from, p_to: query.to, p_layers: [...query.layers] }),
  );
  return (rows ?? []).map(toCalendarLayerEvent).filter((event): event is CalendarLayerEvent => event !== null);
};

// ---------------------------------------------------------- personal dates

const sharingDefault = (personId: string, orgId: string): PersonCalendarSharingRow => ({
  person_id: personId,
  organization_id: orgId,
  share_birthday: false,
  share_anniversary: false,
  updated_by: null,
  updated_at: new Date(0).toISOString(),
});

const sharablePerson = async (db: Db, orgId: string, personId: string): Promise<void> => {
  const allowed = await unwrap(db.rpc('can_set_person_calendar_sharing', { p_person: personId }));
  const person = await unwrap(db.from('people_directory').select('id').eq('id', personId).eq('organization_id', orgId).maybeSingle());
  if (!person || allowed !== true) throw HttpError.notFound('Person not found');
};

export const getPersonCalendarSharing = async ({ db, orgId }: FeedCaller, personId: string): Promise<PersonCalendarSharingRow> => {
  await sharablePerson(db, orgId, personId);
  const row = (await unwrap(
    db.from('person_calendar_sharing').select('*').eq('person_id', personId).maybeSingle(),
  )) as PersonCalendarSharingRow | null;
  return row ?? sharingDefault(personId, orgId);
};

export const setPersonCalendarSharing = async (
  { db, orgId, userId }: FeedCaller,
  personId: string,
  input: PersonCalendarSharingInput,
): Promise<PersonCalendarSharingRow> => {
  await sharablePerson(db, orgId, personId);
  const row = await unwrap(
    db
      .from('person_calendar_sharing')
      .upsert(
        {
          person_id: personId,
          organization_id: orgId,
          share_birthday: input.share_birthday,
          share_anniversary: input.share_anniversary,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'person_id' },
      )
      .select('*')
      .single(),
  );
  return row as PersonCalendarSharingRow;
};

// ------------------------------------------------------ the .ics endpoint

interface FeedTimeRow {
  id: string;
  kind: 'service' | 'rehearsal' | 'other';
  name: string | null;
  starts_at: string;
  ends_at: string;
  ics_sequence: number;
  plan: { id: string; title: string; location: string | null; organization_id: string; status: string; service_type_id: string | null } | null;
}

interface FeedAssignmentRow {
  id: string;
  person_id: string;
  status: AssignmentStatus;
  position: { name: string } | null;
}

const FEED_PAST_DAYS = 90;
const FEED_FUTURE_DAYS = 365;
const FEED_TIME_SELECT =
  'id, kind, name, starts_at, ends_at, ics_sequence, plan:plans!inner(id, title, location, organization_id, status, service_type_id)';

const title = (time: FeedTimeRow): string => (time.name ? `${time.plan!.title} · ${time.name}` : time.plan!.title);

/**
 * Renders a scoped feed with the service role, after re-checking the owner's
 * *current* access. Unknown, revoked or no-longer-permitted → null (404).
 */
export const renderScopedFeed = async (token: string, now: Date = new Date()): Promise<string | null> => {
  const feed = (await unwrap(
    adminDb.from('calendar_scoped_feeds').select('*').eq('token_hash', hashInviteToken(token)).maybeSingle(),
  )) as CalendarScopedFeedRow | null;
  if (!feed || feed.revoked_at) return null;
  const access = await unwrap(
    adminDb.rpc('scoped_feed_access_for', {
      p_user: feed.user_id,
      p_org: feed.organization_id,
      p_scope: feed.scope_type,
      p_service_type: feed.service_type_id,
      p_team: feed.team_id,
    }),
  );
  if (!access) return null;

  const from = new Date(now.getTime() - FEED_PAST_DAYS * 86_400_000).toISOString();
  const to = new Date(now.getTime() + FEED_FUTURE_DAYS * 86_400_000).toISOString();
  const kinds = feed.include_rehearsals ? ['service', 'rehearsal'] : ['service'];
  const host = new URL(config.API_URL).host;
  const events: IcsEvent[] = [];

  if (feed.scope_type === 'service_type') {
    const times = ((await unwrap(
      raw(adminDb)
        .from('plan_times')
        .select(FEED_TIME_SELECT)
        .eq('plan.organization_id', feed.organization_id)
        .eq('plan.service_type_id', feed.service_type_id)
        .eq('plan.status', 'published')
        .in('kind', kinds)
        .gte('starts_at', from)
        .lte('starts_at', to)
        .order('starts_at')
        .limit(2000),
    )) ?? []) as unknown as FeedTimeRow[];
    for (const time of times) {
      if (!time.plan) continue;
      events.push({
        uid: scopedPlanTimeUid(feed, time.id, host),
        summary: title(time),
        startsAt: time.starts_at,
        endsAt: time.ends_at,
        sequence: time.ics_sequence,
        location: time.plan.location,
      });
    }
  } else {
    // Released, not-declined requests of this team; the F04 resolver says which times.
    const assignments = ((await unwrap(
      raw(adminDb)
        .from('assignments')
        .select('id, person_id, status, position:team_positions(name), plan:plans!inner(organization_id, service_date, status)')
        .eq('team_id', feed.team_id)
        .eq('visibility', 'released')
        .neq('status', 'declined')
        .eq('plan.organization_id', feed.organization_id)
        .eq('plan.status', 'published')
        .gte('plan.service_date', new Date(Date.parse(from) - 7 * 86_400_000).toISOString())
        .lte('plan.service_date', to)
        .limit(5000),
    )) ?? []) as unknown as FeedAssignmentRow[];
    const intervals = await attendanceFor(adminDb, assignments.map((assignment) => assignment.id));
    const byTime = new Map<string, FeedAssignmentRow[]>();
    for (const assignment of assignments) {
      for (const interval of intervals.get(assignment.id) ?? []) {
        if (!interval.plan_time_id) continue;
        byTime.set(interval.plan_time_id, [...(byTime.get(interval.plan_time_id) ?? []), assignment]);
      }
    }
    const timeIds = [...byTime.keys()];
    const times: FeedTimeRow[] = [];
    for (let start = 0; start < timeIds.length; start += 100) {
      times.push(
        ...(((await unwrap(
          raw(adminDb)
            .from('plan_times')
            .select(FEED_TIME_SELECT)
            .in('id', timeIds.slice(start, start + 100))
            .in('kind', kinds)
            .gte('starts_at', from)
            .lte('starts_at', to),
        )) ?? []) as unknown as FeedTimeRow[]),
      );
    }
    const names = new Map<string, string>();
    if (access.names) {
      const personIds = [...new Set(assignments.map((assignment) => assignment.person_id))];
      for (let start = 0; start < personIds.length; start += 100) {
        const rows = ((await unwrap(
          adminDb.from('people').select('id, first_name, last_name').in('id', personIds.slice(start, start + 100)),
        )) ?? []) as PersonNameRow[];
        for (const row of rows) names.set(row.id, personName(row));
      }
    }
    for (const time of times) {
      if (!time.plan) continue;
      const scheduled = byTime.get(time.id) ?? [];
      const description = access.names
        ? scheduled
            .map((assignment) => `${names.get(assignment.person_id) ?? 'Someone'}${assignment.position ? ` (${assignment.position.name})` : ''}${assignment.status === 'unconfirmed' ? ' ?' : ''}`)
            .sort()
            .join('\n')
        : `${scheduled.length} scheduled`;
      events.push({
        uid: scopedPlanTimeUid(feed, time.id, host),
        summary: title(time),
        startsAt: time.starts_at,
        endsAt: time.ends_at,
        sequence: time.ics_sequence,
        location: time.plan.location,
        description,
      });
    }

    if (feed.layers.length && feed.team_id) {
      const org = await unwrap(adminDb.from('organizations').select('timezone').eq('id', feed.organization_id).maybeSingle());
      const tz = org?.timezone ?? 'UTC';
      const layerRows = await unwrap(
        adminDb.rpc('team_calendar_layers_for', {
          p_user: feed.user_id,
          p_team: feed.team_id,
          p_from: localDateAt(now.getTime() - 30 * 86_400_000, tz),
          p_to: localDateAt(now.getTime() + 365 * 86_400_000, tz),
          p_layers: feed.layers,
        }),
      );
      for (const row of layerRows ?? []) {
        const event = toCalendarLayerEvent(row);
        if (event) events.push(layerIcsEvent(event, host));
      }
    }
  }

  events.sort((a, b) => (a.allDayDate ?? String(a.startsAt)).localeCompare(b.allDayDate ?? String(b.startsAt)));
  await unwrap(adminDb.from('calendar_scoped_feeds').update({ last_used_at: now.toISOString() }).eq('id', feed.id));
  return renderIcs(events, { calendarName: feed.label ?? 'Service Center team calendar' });
};
