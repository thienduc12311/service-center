#!/usr/bin/env node
// QA wave 8 W8-INT-D5 follow-up, end to end against the real local Realtime service.
//
// Proves that losing access to ONE conversation silences that person's already-open socket on it
// within seconds and that they cannot rejoin, while a teammate who keeps access is told to rekey
// and keeps receiving, and the same person's other resources are unaffected:
//   * removed from a team          -> team conversation silent; other team's conversation unaffected
//   * assignment declined          -> plan conversation silent; the plan's live_plan topic and the
//                                     person's other plan conversation unaffected (plan reads are
//                                     organization-wide, so live_plan has no per-person access to lose)
//   * assignment deleted           -> same for a second plan
//
// Run AFTER migration 20261127000700_w8_realtime_resource_revocation.sql is applied
// (`supabase migration up` / `npm run db:reset`). It COMMITS its own fixtures (a team, a second
// team, two plans with conversations and assignments) to the seed organization and removes them at
// the end; the seed accounts are not changed.
//
//   SUPABASE_ANON_KEY=<anon key from `supabase status`> node supabase/tests/qa-wave8-realtime-resource-revocation.e2e.mjs
//
// Optional: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_DB_CONTAINER (default
// supabase_db_service-center), E2E_API_URL (e.g. http://127.0.0.1:4691: fetch topics through the
// API route instead of calling the database function directly). Exit code 0 means every check passed.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const apiUrl = process.env.E2E_API_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_service-center';
if (!anonKey) {
  console.error('Set SUPABASE_ANON_KEY (see `supabase status`).');
  process.exit(2);
}

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAM = '33333333-3333-4333-8333-333333333333';
const RILEY = '44444444-4444-4444-8444-444444444444';
const QUIET_MS = 6_000;
const DELIVERY_TIMEOUT_MS = 8_000;

const sql = (statement) =>
  execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'], {
    input: statement,
    encoding: 'utf8',
  }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
};

const ids = {
  team: randomUUID(), team2: randomUUID(), teamChat: randomUUID(), team2Chat: randomUUID(),
  planA: randomUUID(), planB: randomUUID(), planAChat: randomUUID(), planBChat: randomUUID(),
};
const person = (user) => `(select id from public.people where organization_id = '${ORG}' and profile_id = '${user}')`;

const cleanup = () =>
  sql(`
    delete from public.conversations where id in ('${ids.teamChat}', '${ids.team2Chat}', '${ids.planAChat}', '${ids.planBChat}');
    delete from public.plans where id in ('${ids.planA}', '${ids.planB}');
    delete from public.teams where id in ('${ids.team}', '${ids.team2}');
  `);

const setup = () =>
  sql(`
    insert into public.teams (id, organization_id, name) values
      ('${ids.team}', '${ORG}', 'E2E resource team'), ('${ids.team2}', '${ORG}', 'E2E other team');
    insert into public.team_memberships (team_id, person_id) values
      ('${ids.team}', ${person(SAM)}), ('${ids.team}', ${person(RILEY)}), ('${ids.team2}', ${person(SAM)});
    insert into public.plans (id, organization_id, title, service_date, status) values
      ('${ids.planA}', '${ORG}', 'E2E plan A', now(), 'published'), ('${ids.planB}', '${ORG}', 'E2E plan B', now(), 'published');
    insert into public.conversations (id, organization_id, kind, team_id, plan_id) values
      ('${ids.teamChat}', '${ORG}', 'team', '${ids.team}', null), ('${ids.team2Chat}', '${ORG}', 'team', '${ids.team2}', null),
      ('${ids.planAChat}', '${ORG}', 'plan', null, '${ids.planA}'), ('${ids.planBChat}', '${ORG}', 'plan', null, '${ids.planB}')
      on conflict do nothing;
    insert into public.assignments (plan_id, team_id, person_id) values
      ('${ids.planA}', '${ids.team}', ${person(SAM)}), ('${ids.planA}', '${ids.team}', ${person(RILEY)}),
      ('${ids.planB}', '${ids.team}', ${person(SAM)}), ('${ids.planB}', '${ids.team}', ${person(RILEY)});
  `);

// A plan conversation may already exist if a trigger creates it; use whichever row holds the plan.
const planChat = (plan) => sql(`select id from public.conversations where plan_id = '${plan}';`);

const clients = {};
const tokens = {};
const signIn = async (name, email) => {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  await client.realtime.setAuth();
  clients[name] = client;
  tokens[name] = data.session.access_token;
};

/** The topic the API would hand this user for the resource, or null when they hold no access. */
const topicFor = async (name, resource, id) => {
  if (apiUrl) {
    const res = await fetch(`${apiUrl}/api/v1/realtime/topics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens[name]}`, 'x-organization-id': ORG },
      body: JSON.stringify({ resource, ids: [id] }),
    });
    if (!res.ok) throw new Error(`topics ${res.status}`);
    return (await res.json()).topics[id] ?? null;
  }
  const { data, error } = await clients[name].rpc('realtime_resource_topics', { p_org: ORG, p_resource: resource, p_ids: [id] });
  if (error) throw error;
  return data[0]?.topic ?? null;
};

/** Join a private topic; resolves with the status and records every 'changed' payload. */
const join = (name, topic, received) =>
  new Promise((resolve) => {
    const channel = clients[name].channel(topic, { config: { private: true } });
    channel.on('broadcast', { event: 'changed' }, (message) => {
      received.push({ at: Date.now(), payload: message.payload });
    });
    const timer = setTimeout(() => resolve({ channel, status: 'TIMED_OUT' }), 6_000);
    channel.subscribe((status) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
        clearTimeout(timer);
        resolve({ channel, status });
      }
    });
  });

const waitFor = async (predicate, timeoutMs) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return Date.now() - started;
    await sleep(100);
  }
  return null;
};

const poke = (resource, id) => sql(`select private.send_resource_poke('${resource}', '${id}');`);
const isRekey = (entry) => entry.payload?.event === 'rekey';
const pokes = (received) => received.filter((entry) => !isRekey(entry)).length;
const rekeys = (received) => received.filter(isRekey).length;

const channels = [];
const open = async (name, topic, received) => {
  const entry = await join(name, topic, received);
  channels.push(entry.channel);
  return entry.status;
};

try {
  cleanup();
  setup();
  ids.planAChat = planChat(ids.planA);
  ids.planBChat = planChat(ids.planB);
  await signIn('sam', 'sam@example.com');
  await signIn('riley', 'riley@example.com');
  // Refused join attempts use their own socket so the client library's retries cannot stall Sam's main one.
  await signIn('samProbe', 'sam@example.com');

  // ---- Everyone joins what they may use. ---------------------------------------------------
  const topics = {
    samTeam: await topicFor('sam', 'conversation', ids.teamChat),
    rileyTeam: await topicFor('riley', 'conversation', ids.teamChat),
    samTeam2: await topicFor('sam', 'conversation', ids.team2Chat),
    samPlanA: await topicFor('sam', 'conversation', ids.planAChat),
    rileyPlanA: await topicFor('riley', 'conversation', ids.planAChat),
    samPlanB: await topicFor('sam', 'conversation', ids.planBChat),
    rileyPlanB: await topicFor('riley', 'conversation', ids.planBChat),
    samLivePlanA: await topicFor('sam', 'live_plan', ids.planA),
  };
  check(Object.values(topics).every((t) => typeof t === 'string'), 'every participant is issued topics for the resources they use');
  check(topics.samTeam === topics.rileyTeam && topics.samPlanA === topics.rileyPlanA, 'teammates are issued the same topic');
  check(/^conversation:[0-9a-f-]{36}:[0-9a-f]{64}:[0-9a-f]{64}$/.test(topics.samTeam), 'a conversation topic carries the organization key and the conversation key');

  const got = { samTeam: [], rileyTeam: [], samTeam2: [], samPlanA: [], rileyPlanA: [], samPlanB: [], rileyPlanB: [], samLivePlanA: [] };
  const statuses = await Promise.all([
    open('sam', topics.samTeam, got.samTeam), open('riley', topics.rileyTeam, got.rileyTeam),
    open('sam', topics.samTeam2, got.samTeam2), open('sam', topics.samPlanA, got.samPlanA),
    open('riley', topics.rileyPlanA, got.rileyPlanA), open('sam', topics.samPlanB, got.samPlanB),
    open('riley', topics.rileyPlanB, got.rileyPlanB), open('sam', topics.samLivePlanA, got.samLivePlanA),
  ]);
  check(statuses.every((s) => s === 'SUBSCRIBED'), 'all eight sockets join', statuses.join(','));

  poke('conversation', ids.teamChat);
  poke('conversation', ids.team2Chat);
  poke('conversation', ids.planAChat);
  poke('conversation', ids.planBChat);
  poke('live_plan', ids.planA);
  check((await waitFor(() => [got.samTeam, got.rileyTeam, got.samTeam2, got.samPlanA, got.rileyPlanA, got.samPlanB, got.rileyPlanB, got.samLivePlanA]
    .every((r) => pokes(r) === 1), DELIVERY_TIMEOUT_MS)) !== null, 'a poke reaches every participant before any removal');

  // ---- Sam is removed from the team. ---------------------------------------------------------
  let removedAt = Date.now();
  sql(`delete from public.team_memberships where team_id = '${ids.team}' and person_id = ${person(SAM)};`);
  const rekeyMs = await waitFor(() => rekeys(got.rileyTeam) === 1, DELIVERY_TIMEOUT_MS);
  check(rekeyMs !== null, 'the remaining teammate is told to rekey', rekeyMs === null ? '' : `${Date.now() - removedAt} ms`);
  check(Object.keys(got.rileyTeam.find(isRekey)?.payload ?? {}).filter((k) => k !== 'id').join() === 'event', 'the rekey poke carries no data');
  const rileyTeamNew = await topicFor('riley', 'conversation', ids.teamChat);
  check(rileyTeamNew && rileyTeamNew !== topics.rileyTeam, 'the teammate fetches the new topic');
  check((await topicFor('sam', 'conversation', ids.teamChat)) === null, 'the removed member is refused a topic for the team conversation');
  const rileyTeamNext = [];
  check((await open('riley', rileyTeamNew, rileyTeamNext)) === 'SUBSCRIBED', 'the teammate rejoins on the new topic');

  const samTeamBefore = got.samTeam.length;
  poke('conversation', ids.teamChat);
  check((await waitFor(() => pokes(rileyTeamNext) === 1, DELIVERY_TIMEOUT_MS)) !== null, 'the teammate keeps receiving on the new topic');
  await sleep(QUIET_MS);
  check(got.samTeam.length === samTeamBefore, `the removed member's open socket receives nothing for ${QUIET_MS / 1000} s after the removal`,
    `${Math.round((Date.now() - removedAt) / 1000)} s since removal`);
  const stolen = [];
  const stolenStatus = await open('samProbe', rileyTeamNew, stolen);
  check(stolenStatus !== 'SUBSCRIBED', 'the removed member cannot join the new topic even knowing it', stolenStatus);
  const oldStatus = await open('samProbe', topics.samTeam, []);
  check(oldStatus !== 'SUBSCRIBED', 'the removed member cannot rejoin the old topic', oldStatus);

  // The same person's other resources are untouched.
  poke('conversation', ids.team2Chat);
  poke('conversation', ids.planAChat);
  poke('conversation', ids.planBChat);
  check((await waitFor(() => pokes(got.samTeam2) === 2 && pokes(got.samPlanA) === 2 && pokes(got.samPlanB) === 2, DELIVERY_TIMEOUT_MS)) !== null,
    'the removed member still receives on another team and on both plan conversations');
  check(rekeys(got.samTeam2) === 0 && rekeys(got.samPlanA) === 0 && rekeys(got.samPlanB) === 0, 'no other conversation was rekeyed');

  // ---- Sam declines plan A. ---------------------------------------------------------------
  removedAt = Date.now();
  sql(`update public.assignments set status = 'declined' where plan_id = '${ids.planA}' and person_id = ${person(SAM)};`);
  check((await waitFor(() => rekeys(got.rileyPlanA) === 1, DELIVERY_TIMEOUT_MS)) !== null, 'the remaining assignee is told to rekey the plan conversation');
  const rileyPlanANew = await topicFor('riley', 'conversation', ids.planAChat);
  check(rileyPlanANew && rileyPlanANew !== topics.rileyPlanA, 'the remaining assignee fetches the new plan topic');
  check((await topicFor('sam', 'conversation', ids.planAChat)) === null, 'the declined assignee is refused a topic for the plan conversation');
  const rileyPlanANext = [];
  check((await open('riley', rileyPlanANew, rileyPlanANext)) === 'SUBSCRIBED', 'the remaining assignee rejoins');
  const samPlanABefore = got.samPlanA.length;
  const samLiveBefore = got.samLivePlanA.length;
  poke('conversation', ids.planAChat);
  poke('live_plan', ids.planA);
  check((await waitFor(() => pokes(rileyPlanANext) === 1 && got.samLivePlanA.length === samLiveBefore + 1, DELIVERY_TIMEOUT_MS)) !== null,
    'the assignee keeps receiving; the live_plan topic is organization-wide and unaffected');
  await sleep(QUIET_MS);
  check(got.samPlanA.length === samPlanABefore, `the declined assignee's open socket receives nothing for ${QUIET_MS / 1000} s`,
    `${Math.round((Date.now() - removedAt) / 1000)} s since the decline`);
  const planAStatus = await open('samProbe', rileyPlanANew, []);
  check(planAStatus !== 'SUBSCRIBED', 'the declined assignee cannot join the new plan topic', planAStatus);
  check((await topicFor('sam', 'live_plan', ids.planA)) === topics.samLivePlanA, 'the live_plan topic is still issued and unchanged');
  poke('conversation', ids.planBChat);
  check((await waitFor(() => pokes(got.samPlanB) === 3, DELIVERY_TIMEOUT_MS)) !== null, 'the declined assignee still receives on plan B');

  // ---- Sam's assignment on plan B is deleted. -----------------------------------------------
  removedAt = Date.now();
  sql(`delete from public.assignments where plan_id = '${ids.planB}' and person_id = ${person(SAM)};`);
  check((await waitFor(() => rekeys(got.rileyPlanB) === 1, DELIVERY_TIMEOUT_MS)) !== null, 'the other assignee is told to rekey plan B');
  const rileyPlanBNew = await topicFor('riley', 'conversation', ids.planBChat);
  check((await topicFor('sam', 'conversation', ids.planBChat)) === null, 'the unassigned member is refused a topic for plan B');
  const rileyPlanBNext = [];
  check((await open('riley', rileyPlanBNew, rileyPlanBNext)) === 'SUBSCRIBED', 'the other assignee rejoins plan B');
  const samPlanBBefore = got.samPlanB.length;
  poke('conversation', ids.planBChat);
  check((await waitFor(() => pokes(rileyPlanBNext) === 1, DELIVERY_TIMEOUT_MS)) !== null, 'the other assignee keeps receiving');
  await sleep(QUIET_MS);
  check(got.samPlanB.length === samPlanBBefore, `the unassigned member's open socket receives nothing for ${QUIET_MS / 1000} s`,
    `${Math.round((Date.now() - removedAt) / 1000)} s since the deletion`);
  const planBStatus = await open('samProbe', rileyPlanBNew, []);
  check(planBStatus !== 'SUBSCRIBED', 'the unassigned member cannot join the new plan B topic', planBStatus);
  poke('conversation', ids.team2Chat);
  check((await waitFor(() => pokes(got.samTeam2) === 3, DELIVERY_TIMEOUT_MS)) !== null, 'the other team conversation still delivers to the same person');
} finally {
  for (const channel of channels) {
    try {
      await channel.unsubscribe();
    } catch (error) {
      console.warn('unsubscribe failed:', error instanceof Error ? error.message : error);
    }
  }
  await Promise.allSettled(Object.values(clients).map((client) => client.auth.signOut()));
  try {
    cleanup();
  } catch (error) {
    console.warn('fixture cleanup failed:', error instanceof Error ? error.message : error);
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
