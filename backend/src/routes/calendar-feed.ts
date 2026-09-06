import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { adminDb, raw, unwrap } from '../lib/supabase.js';
import { HttpError } from '../lib/errors.js';
import { hashInviteToken } from '../services/invitations.js';
import { renderIcs, type IcsEvent } from '../lib/ics.js';
import { config } from '../config.js';

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
  plan_id: string;
  status: 'unconfirmed' | 'confirmed' | 'declined';
}

calendarFeedRouter.get('/:token.ics', async (req, res) => {
  const token = await unwrap(adminDb.from('calendar_feed_tokens').select('id, organization_id, user_id, revoked_at').eq('token_hash', hashInviteToken(req.params.token)).maybeSingle());
  if (!token || (token as FeedTokenRecord).revoked_at) throw HttpError.notFound('Calendar feed not found');
  const feedToken = token as FeedTokenRecord;
  const now = new Date();
  const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const times = (await unwrap(raw(adminDb).from('plan_times').select('id, kind, name, starts_at, ends_at, ics_sequence, plan:plans!inner(id, title, location, organization_id)').eq('plan.organization_id', feedToken.organization_id).gte('starts_at', from).lte('starts_at', to))) as unknown as FeedPlanTime[];
  const planIds = [...new Set(times.map((time) => time.plan?.id).filter((id): id is string => Boolean(id)))];
  const assignments = planIds.length
    ? (await unwrap(adminDb.from('assignments').select('plan_id, status').eq('user_id', feedToken.user_id).in('plan_id', planIds))) as FeedAssignment[]
    : [];
  const statusByPlan = new Map(assignments.filter((assignment) => assignment.status !== 'declined').map((assignment) => [assignment.plan_id, assignment.status]));
  const events: IcsEvent[] = times.flatMap((time) => {
    if (!time.plan || !statusByPlan.has(time.plan.id)) return [];
    const status = statusByPlan.get(time.plan.id);
    return [{
      uid: `plan-time-${time.id}@${new URL(config.API_URL).host}`,
      summary: `${status === 'unconfirmed' ? '? ' : ''}${time.name ? `${time.plan.title} · ${time.name}` : time.plan.title}`,
      startsAt: time.starts_at,
      endsAt: time.ends_at,
      sequence: time.ics_sequence,
      location: time.plan.location,
    }];
  });
  await unwrap(adminDb.from('calendar_feed_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', feedToken.id));
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.send(renderIcs(events, { calendarName: 'Service Center schedule' }));
});
