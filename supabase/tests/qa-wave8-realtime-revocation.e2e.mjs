#!/usr/bin/env node
// QA wave 8 W8-INT-D5, end to end against the real local Realtime service.
//
// Proves that an already-open Realtime socket of a removed member stops receiving within
// seconds, that the member cannot rejoin, and that a still-authorized member is told to rekey and
// keeps receiving. Run AFTER migration 20261127000400_w8_realtime_revocation.sql is applied
// (`supabase migration up` / `npm run db:reset`); it uses the seed accounts and restores them:
//
//   SUPABASE_ANON_KEY=<anon key from `supabase status`> node supabase/tests/qa-wave8-realtime-revocation.e2e.mjs
//
// Optional: SUPABASE_URL (default http://127.0.0.1:54321), SUPABASE_DB_CONTAINER
// (default supabase_db_service-center). Exit code 0 means every check passed.
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.SUPABASE_ANON_KEY;
const container = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_service-center';
if (!anonKey) {
  console.error('Set SUPABASE_ANON_KEY (see `supabase status`).');
  process.exit(2);
}

const ORG = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAM = '33333333-3333-4333-8333-333333333333';
const REVOKED_QUIET_MS = 10_000;
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

const planId = sql(`select id from public.plans where organization_id = '${ORG}' and status = 'published' limit 1;`);
if (!planId) throw new Error('The seed has no published plan.');

const signIn = async (email) => {
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: 'password123' });
  if (error) throw error;
  await client.realtime.setAuth();
  return client;
};

const topicKey = async (client) => {
  const { data, error } = await client.rpc('realtime_topic_key', { p_org: ORG });
  if (error) throw error;
  return data;
};

/** Join a private topic; resolves with the status and records every 'changed' payload. */
const join = (client, topic, received) =>
  new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } });
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

const poke = () => sql(`select private.send_resource_poke('live_plan', '${planId}', '${ORG}');`);
const restoreSam = () =>
  sql(`update public.organization_members set status = 'active' where organization_id = '${ORG}' and user_id = '${SAM}';`);

const owner = await signIn('it@graceaogchurch.com');
const sam = await signIn('sam@example.com');
const channels = [];
try {
  restoreSam();
  const ownerKey = await topicKey(owner);
  const samKey = await topicKey(sam);
  check(ownerKey?.length === 64 && ownerKey === samKey, 'both active members are served the same 64 hex key');

  const ownerPlan = [];
  const ownerControl = [];
  const samPlan = [];
  const samControl = [];
  const joined = await Promise.all([
    join(owner, `live_plan:${planId}:${ownerKey}`, ownerPlan),
    join(owner, `org:${ORG}:${ownerKey}`, ownerControl),
    join(sam, `live_plan:${planId}:${samKey}`, samPlan),
    join(sam, `org:${ORG}:${samKey}`, samControl),
  ]);
  channels.push(...joined.map((entry) => entry.channel));
  check(joined.every((entry) => entry.status === 'SUBSCRIBED'), 'both members join plan and control topics', joined.map((j) => j.status).join(','));

  poke();
  check((await waitFor(() => ownerPlan.length === 1 && samPlan.length === 1, DELIVERY_TIMEOUT_MS)) !== null,
    'a poke reaches both members before the removal');

  // ---- Deactivate Sam while his socket stays open. -----------------------------------------
  const removedAt = Date.now();
  sql(`update public.organization_members set status = 'inactive' where organization_id = '${ORG}' and user_id = '${SAM}';`);
  const rekeyMs = await waitFor(() => ownerControl.length === 1, DELIVERY_TIMEOUT_MS);
  check(rekeyMs !== null, 'the remaining member is told to rekey', rekeyMs === null ? '' : `${Date.now() - removedAt} ms`);
  check(JSON.stringify(Object.keys(ownerControl[0]?.payload ?? {}).filter((k) => k !== 'id')) === '["event"]'
    && ownerControl[0]?.payload.event === 'rekey', 'the rekey poke carries no data');

  const newOwnerKey = await topicKey(owner);
  check(newOwnerKey && newOwnerKey !== ownerKey, 'the remaining member fetches a new key');
  check((await topicKey(sam)) === null, 'the removed member is refused the new key');

  const ownerNewPlan = [];
  const rejoined = await join(owner, `live_plan:${planId}:${newOwnerKey}`, ownerNewPlan);
  channels.push(rejoined.channel);
  check(rejoined.status === 'SUBSCRIBED', 'the remaining member rejoins with the new key');

  const samBefore = samPlan.length;
  poke();
  check((await waitFor(() => ownerNewPlan.length === 1, DELIVERY_TIMEOUT_MS)) !== null,
    'the remaining member still receives pokes on the new topic');
  await sleep(REVOKED_QUIET_MS);
  check(samPlan.length === samBefore, `the removed member's open socket receives nothing for ${REVOKED_QUIET_MS / 1000} s after removal`,
    `${Math.round((Date.now() - removedAt) / 1000)} s since removal`);

  // A removed member cannot rejoin, even knowing a valid key (here: stolen from the other member).
  const stolen = [];
  const attempt = await join(sam, `live_plan:${planId}:${newOwnerKey}`, stolen);
  channels.push(attempt.channel);
  check(attempt.status !== 'SUBSCRIBED', 'the removed member cannot join a topic with the current key', attempt.status);
  const oldTopic = await join(sam, `live_plan:${planId}:${ownerKey}`, stolen);
  channels.push(oldTopic.channel);
  check(oldTopic.status !== 'SUBSCRIBED', 'the removed member cannot rejoin the old topic', oldTopic.status);

  // ---- A deleted auth session rotates the key as well. --------------------------------------
  restoreSam();
  const keyAfterRestore = await topicKey(sam);
  const samAgain = await signIn('sam@example.com');
  const samAgainPlan = [];
  const samAgainJoin = await join(samAgain, `live_plan:${planId}:${keyAfterRestore}`, samAgainPlan);
  channels.push(samAgainJoin.channel);
  check(samAgainJoin.status === 'SUBSCRIBED', 'a reactivated member joins with the current key');
  sql(`delete from auth.sessions where user_id = '${SAM}';`);
  await sleep(500);
  const afterSessions = sql(`select key from private.org_realtime_keys where organization_id = '${ORG}';`);
  check(afterSessions !== keyAfterRestore, 'deleting the session rotated the key');
  const before = samAgainPlan.length;
  poke();
  await sleep(REVOKED_QUIET_MS / 2);
  check(samAgainPlan.length === before, 'a signed-out session socket receives nothing after the session is deleted');
} finally {
  restoreSam();
  for (const channel of channels) {
    try {
      await channel.unsubscribe();
    } catch (error) {
      console.warn('unsubscribe failed:', error instanceof Error ? error.message : error);
    }
  }
  await Promise.allSettled([owner.auth.signOut(), sam.auth.signOut()]);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
