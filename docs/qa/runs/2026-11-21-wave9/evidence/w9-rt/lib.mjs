import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
const REPO = '/Users/nguyen/orca/workspaces/service-center/test-tube';
export const SCR = '/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-test-tube/81f65e74-bdd6-4594-9f0a-588d83eb9278/scratchpad/rt';
const { createClient } = await import(`${REPO}/node_modules/@supabase/supabase-js/dist/index.mjs`);
export { createClient, randomUUID };
const env = Object.fromEntries(readFileSync(`${REPO}/backend/.env`, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
export const URL_ = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
export const API = 'http://localhost:4000';
const pwFile = `${SCR}/pw`;
if (!existsSync(pwFile)) writeFileSync(pwFile, randomBytes(18).toString('base64url') + 'Aa1!');
export const PW = readFileSync(pwFile, 'utf8').trim();
export const email = (a) => `${a}.qaw9.rt@example.test`;
export const sql = (s) => execFileSync('docker', ['exec', '-i', 'supabase_db_service-center', 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'], { input: s, encoding: 'utf8' }).trim();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
export const results = [];
export const LOG = `${SCR}/results.jsonl`;
export function rec(group, id, actor, surface, expected, actual, ok, extra = '') {
  const row = { group, id, actor, surface, expected, actual: String(actual), status: ok === null ? 'NOT_RUN' : ok ? 'PASS' : 'FAIL', extra };
  results.push(row);
  appendFileSync(LOG, JSON.stringify(row) + '\n');
  console.log(`${row.status}  [${id}] ${actor} | ${surface} | ${actual}${extra ? ' ' + extra : ''}`);
  return ok;
}
export const ids = JSON.parse(existsSync(`${SCR}/fx.json`) ? readFileSync(`${SCR}/fx.json`, 'utf8') : '{}');
export const sessions = {};
export async function login(alias) {
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: email(alias), password: PW });
  if (error) throw new Error(`login ${alias}: ${error.message}`);
  await c.realtime.setAuth();
  return { client: c, token: data.session.access_token, alias };
}
export async function api(token, method, path, org, body) {
  const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(org ? { 'x-organization-id': org } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
/** Topic for a resource through the API (null when refused / omitted). */
export async function topicFor(actor, org, resource, id) {
  const r = await api(actor.token, 'POST', '/api/v1/realtime/topics', org, { resource, ids: [id] });
  if (r.status !== 200) return { status: r.status, topic: null };
  return { status: 200, topic: r.json.topics?.[id] ?? null };
}
export async function orgKey(actor, org) {
  const r = await api(actor.token, 'GET', '/api/v1/realtime/key', org);
  return { status: r.status, key: r.json?.key ?? null };
}
export function join(client, topic, received, timeout = 6000) {
  return new Promise((resolve) => {
    const ch = client.channel(topic, { config: { private: true } });
    ch.on('broadcast', { event: 'changed' }, (m) => received.push({ at: Date.now(), payload: m.payload }));
    const t = setTimeout(() => resolve({ ch, status: 'TIMED_OUT' }), timeout);
    ch.subscribe((s) => { if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) { clearTimeout(t); resolve({ ch, status: s }); } });
  });
}
export const waitFor = async (pred, ms) => { const s = Date.now(); while (Date.now() - s < ms) { if (pred()) return Date.now() - s; await sleep(50); } return null; };
export const isRekey = (e) => e.payload?.event === 'rekey';
export const pokes = (r) => r.filter((e) => !isRekey(e)).length;
export const rekeys = (r) => r.filter(isRekey).length;
export const poke = (res, id, org) => sql(`select private.send_resource_poke('${res}','${id}'${org ? `,'${org}'` : ''});`);
