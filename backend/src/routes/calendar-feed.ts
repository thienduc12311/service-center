import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { hashInviteToken } from '../services/invitations.js';
import { renderIcs, type IcsEvent } from '../lib/ics.js';
import { config } from '../config.js';
import type { AssignmentStatus } from '@service-center/shared';
import { attendanceFor } from '../services/attendance.js';
import { recipientSequence } from '../model/attendance.model.js';
import { renderScopedFeed } from '../services/calendar-scoped-feeds.js';
import { recipientLanguage } from '../lib/i18n.js';

export const calendarFeedRouter: Router = Router();
calendarFeedRouter.use(rateLimit({ windowMs: 60_000, limit: config.isProduction ? 60 : 10_000, standardHeaders: 'draft-7', legacyHeaders: false }));

interface FeedTokenRecord {
  id: string;
  organization_id: string;
  user_id: string;
  revoked_at: string | null;
}

interface FeedPlanTime {
  id: string;
  kind: 'service' | 'rehearsal' | 'other';
  name: string | null;
  starts_at: string;
  ends_at: string;
  ics_sequence: number;
  plan: { id: string; title: string; location: string | null; organization_id: string } | null;
}

interface FeedAssignment {
  id: string;
  status: AssignmentStatus;
}

interface FeedCalendarState {
  plan_time_id: string;
  applicable: boolean;
  sequence_offset: number;
}

const FEED_TIME_SELECT = 'id, kind, name, starts_at, ends_at, ics_sequence, plan:plans!inner(id, title, location, organization_id)';

// F16: a service-type or team feed. Current access is re-checked on every fetch.
calendarFeedRouter.get('/scoped/:token.ics', async (req, res) => {
  const calendar = await renderScopedFeed(req.params.token);
  if (!calendar) throw HttpError.notFound('Calendar feed not found');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(calendar);
});

calendarFeedRouter.get('/:token.ics', async (req, res) => {
  const token = await unwrap(adminDb.from('calendar_feed_tokens').select('id, organization_id, user_id, revoked_at').eq('token_hash', hashInviteToken(req.params.token)).maybeSingle());
  if (!token || (token as FeedTokenRecord).revoked_at) throw HttpError.notFound('Calendar feed not found');
  const feedToken = token as FeedTokenRecord;
  // Service-role read: re-check the subscriber is still an active member.
  const membership = await unwrap(adminDb.from('organization_members').select('status').eq('organization_id', feedToken.organization_id).eq('user_id', feedToken.user_id).maybeSingle());
  if (membership?.status !== 'active') throw HttpError.notFound('Calendar feed not found');
  const now = new Date();
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const person = await unwrap(adminDb.from('people').select('id, preferred_language').eq('organization_id', feedToken.organization_id).eq('profile_id', feedToken.user_id).maybeSingle());

  // F04: only the times this Person's released requests cover (the shared
  // resolver), each with a recipient-specific SEQUENCE; a time they no longer
  // attend stays in the feed as CANCELLED so subscribed calendars update.
  const events: IcsEvent[] = [];
  if (person) {
    const assignments = ((await unwrap(raw(adminDb).from('assignments').select('id, status, plan:plans!inner(organization_id, service_date)').eq('person_id', person.id).eq('visibility', 'released').eq('plan.organization_id', feedToken.organization_id).gte('plan.service_date', new Date(new Date(from).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()))) ?? []) as unknown as FeedAssignment[];
    const attendance = await attendanceFor(adminDb, assignments.map((assignment) => assignment.id));
    const statusByTime = new Map<string, AssignmentStatus>();
    for (const assignment of assignments) {
      if (assignment.status === 'declined') continue;
      for (const interval of attendance.get(assignment.id) ?? []) {
        if (!interval.plan_time_id) continue;
        if (statusByTime.get(interval.plan_time_id) !== 'confirmed') statusByTime.set(interval.plan_time_id, assignment.status);
      }
    }
    const states = ((await unwrap(raw(adminDb).from('attendance_calendar_states').select('plan_time_id, applicable, sequence_offset, plan_time:plan_times!inner(starts_at)').eq('person_id', person.id).gte('plan_time.starts_at', from).lte('plan_time.starts_at', to))) ?? []) as unknown as FeedCalendarState[];
    const stateByTime = new Map(states.map((state) => [state.plan_time_id, state]));
    const cancelled = states.filter((state) => !state.applicable && !statusByTime.has(state.plan_time_id)).map((state) => state.plan_time_id);
    const timeIds = [...statusByTime.keys(), ...cancelled];
    const times = timeIds.length
      ? ((await unwrap(raw(adminDb).from('plan_times').select(FEED_TIME_SELECT).in('id', timeIds).eq('plan.organization_id', feedToken.organization_id).gte('starts_at', from).lte('starts_at', to))) ?? []) as unknown as FeedPlanTime[]
      : [];
    const host = new URL(config.API_URL).host;
    for (const time of times) {
      if (!time.plan) continue;
      const status = statusByTime.get(time.id);
      events.push({
        uid: `plan-time-${time.id}@${host}`,
        summary: `${status === 'unconfirmed' ? '? ' : ''}${time.name ? `${time.plan.title} · ${time.name}` : time.plan.title}`,
        startsAt: time.starts_at,
        endsAt: time.ends_at,
        sequence: recipientSequence(time.ics_sequence, stateByTime.get(time.id)?.sequence_offset),
        location: time.plan.location,
        ...(status ? {} : { status: 'CANCELLED' as const }),
      });
    }
    events.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }
  await unwrap(adminDb.from('calendar_feed_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', feedToken.id));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // The token is authorized above, so the subscriber's own language names the calendar.
  res.send(renderIcs(events, { calendarName: recipientLanguage(person?.preferred_language).t('calendar.feedName') }));
});
