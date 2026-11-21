import * as L from './lib.mjs';
const { sql, sleep, rec, ids, login, topicFor, orgKey, join, waitFor, isRekey, pokes, rekeys, poke, randomUUID, createClient, URL_, ANON } = L;
const A = ids.org.A, U = ids.uid;
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const QUIET = 5000, DELIV = 8000;
const pid = (u, o = 'A') => ids.ppl[`${o}:${u}`];
const actors = {};
for (const a of ['oa', 'l', 'k', 'g', 'u', 'x']) actors[a] = await login(a);
const probe = {};
for (const a of ['l', 'g', 'u', 'x']) probe[a] = await login(a);
const fallbacks = [];
import { readFileSync } from 'node:fs';
const require_clean = () => readFileSync(L.SCR + '/clean.sql', 'utf8');

function resetPeople() {
  for (const u of ['l', 'k', 'u', 'g', 's', 'kb']) {
    sql(`insert into public.people (organization_id, profile_id, first_name, last_name, email) select '${A}','${U[u]}','QW9','${u}','${L.email(u)}' where not exists (select 1 from public.people where organization_id='${A}' and profile_id='${U[u]}' );
         update public.people set archived_at=null, archived_by=null, person_type='adult' where organization_id='${A}' and profile_id='${U[u]}';
         update public.people set profile_id='${U[u]}' where organization_id='${A}' and first_name='QW9' and last_name='${u}' and profile_id is null and not exists (select 1 from public.people p2 where p2.organization_id='${A}' and p2.profile_id='${U[u]}');
         update public.organization_members set status='active', access_mode='legacy' where organization_id='${A}' and user_id='${U[u]}';`);
    ids.ppl[`A:${u}`] = sql(`select id from public.people where organization_id='${A}' and profile_id='${U[u]}';`);
  }
}

function buildWorld(o = {}) {
  const w = { T: randomUUID(), T2: randomUUID(), T3: randomUUID(), T4: randomUUID(), P: randomUUID(), P2: randomUUID(), P3: randomUUID(), ST1: randomUUID(), ST2: randomUUID(), F1: randomUUID(), F2: randomUUID() };
  const lp = pid('l'), kp = pid('k');
  sql(`insert into public.service_type_folders (id, organization_id, name) values ('${w.F1}','${A}','w9 F1'),('${w.F2}','${A}','w9 F2');
    insert into public.service_types (id, organization_id, name, folder_id) values ('${w.ST1}','${A}','w9 ST1','${w.F1}'),('${w.ST2}','${A}','w9 ST2','${w.F2}');
    insert into public.teams (id, organization_id, name, service_type_id) values
      ('${w.T}','${A}','w9 T',${o.teamST ? `'${w.ST1}'` : 'null'}),('${w.T2}','${A}','w9 T2',null),('${w.T3}','${A}','w9 T3',null),('${w.T4}','${A}','w9 T4',null);
    insert into public.team_memberships (team_id, person_id) values ('${w.T}','${lp}'),('${w.T}','${kp}'),('${w.T2}','${lp}'),('${w.T2}','${kp}'),('${w.T4}','${kp}');
    insert into public.plans (id, organization_id, title, service_date, status, service_type_id) values
      ('${w.P}','${A}','w9 P',now(),'published',${o.planST ? `'${w.ST1}'` : 'null'}),('${w.P2}','${A}','w9 P2',now(),'published',null),('${w.P3}','${A}','w9 P3',now(),'published',null);
    ${o.noPlans ? '' : `insert into public.assignments (plan_id, team_id, person_id) values ('${w.P}','${w.T}','${lp}'),('${w.P}','${w.T}','${kp}'),('${w.P2}','${w.T}','${lp}'),('${w.P2}','${w.T}','${kp}');`}
    insert into public.assignments (plan_id, team_id, person_id) values ('${w.P3}','${w.T}','${kp}');
    ${(o.grants ?? []).map((g) => `insert into public.access_grants (organization_id,user_id,capability,scope_type,${g.col ?? 'team_id'}) values ('${A}','${U.g}','${g.cap}','${g.scope}',${g.val ? `'${w[g.val]}'` : 'null'});`).join('\n')}
  `);
  sql(`insert into public.conversations (organization_id, kind, team_id) select '${A}','team',id from public.teams where id in ('${w.T}','${w.T2}','${w.T3}','${w.T4}') and not exists (select 1 from public.conversations c where c.team_id=teams.id);
       insert into public.conversations (organization_id, kind, plan_id) select '${A}','plan',id from public.plans where id in ('${w.P}','${w.P2}','${w.P3}') and not exists (select 1 from public.conversations c where c.plan_id=plans.id);`);
  const conv = {};
  for (const n of ['T', 'T2', 'T3', 'T4']) conv[n] = sql(`select id from public.conversations where team_id='${w[n]}'`);
  for (const n of ['P', 'P2', 'P3']) conv[n] = sql(`select id from public.conversations where plan_id='${w[n]}'`);
  w.conv = conv;
  return w;
}
function destroyWorld(w) {
  try {
    sql(`delete from public.access_grants where organization_id='${A}' and user_id='${U.g}';
      delete from public.assignments where plan_id in ('${w.P}','${w.P2}','${w.P3}');
      delete from public.plans where id in ('${w.P}','${w.P2}','${w.P3}');
      delete from public.teams where id in ('${w.T}','${w.T2}','${w.T3}','${w.T4}');
      delete from public.service_types where id in ('${w.ST1}','${w.ST2}');
      delete from public.service_type_folders where id in ('${w.F2}','${w.F1}');
      update public.organization_members set status='active', access_mode='legacy' where organization_id='${A}';`);
  } catch (e) { console.log('cleanup warn', e.message.slice(0, 200)); }
}

const owner = () => actors.oa.client;
// Run the mutation as the owner through PostgREST; fall back to service-role SQL (recorded) when RLS/guards refuse it.
async function mutate(label, restFn, sqlText) {
  const { error, data } = await restFn(owner());
  if (!error && !(Array.isArray(data) && data.length === 0)) return 'rest';
  const why = error ? error.message : 'zero rows (RLS filtered)';
  fallbacks.push(`${label}: ${why}`);
  sql(sqlText);
  return `sql (rest: ${why.slice(0, 80)})`;
}

async function viaApi(label, method, path, body, sqlText) {
  const r = await L.api(actors.oa.token, method, path, A, body);
  if (r.status < 300) return `api ${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')} -> ${r.status}`;
  fallbacks.push(`${label}: API ${method} ${path} -> ${r.status} ${JSON.stringify(r.json).slice(0, 100)}`);
  sql(sqlText);
  return `sql (api ${r.status})`;
}
const SPECS = [
  { id: 's01', name: 'team_memberships DELETE (removed from team)', world: {}, rekeyed: ['T'], loser: { l: ['T'] },
    act: (w) => mutate('s01', (c) => c.from('team_memberships').delete().eq('team_id', w.T).eq('person_id', pid('l')).select(), `delete from public.team_memberships where team_id='${w.T}' and person_id='${pid('l')}';`) },
  { id: 's02', name: 'team_memberships UPDATE team_id (move to another team)', world: {}, rekeyed: ['T'], loser: { l: ['T'] },
    act: (w) => mutate('s02', (c) => c.from('team_memberships').update({ team_id: w.T3 }).eq('team_id', w.T).eq('person_id', pid('l')).select(), `update public.team_memberships set team_id='${w.T3}' where team_id='${w.T}' and person_id='${pid('l')}';`) },
  { id: 's03', name: 'team_memberships UPDATE person_id (position handed to u)', world: {}, rekeyed: ['T'], loser: { l: ['T'] }, uGains: ['T'],
    act: (w) => mutate('s03', (c) => c.from('team_memberships').update({ person_id: pid('u'), user_id: U.u }).eq('team_id', w.T).eq('person_id', pid('l')).select(), `update public.team_memberships set person_id='${pid('u')}', user_id='${U.u}' where team_id='${w.T}' and person_id='${pid('l')}';`) },
  { id: 's04', name: 'assignment DELETE', world: {}, rekeyed: ['P', 'P2'].slice(0, 1), loser: { l: ['P'] },
    act: (w) => mutate('s04', (c) => c.from('assignments').delete().eq('plan_id', w.P).eq('person_id', pid('l')).select(), `delete from public.assignments where plan_id='${w.P}' and person_id='${pid('l')}';`) },
  { id: 's05', name: 'assignment status -> declined', world: {}, rekeyed: ['P'], loser: { l: ['P'] },
    act: (w) => mutate('s05', (c) => c.from('assignments').update({ status: 'declined' }).eq('plan_id', w.P).eq('person_id', pid('l')).select(), `update public.assignments set status='declined' where plan_id='${w.P}' and person_id='${pid('l')}';`) },
  { id: 's06', name: 'assignment un-released (visibility draft)', world: {}, rekeyed: ['P'], loser: { l: ['P'] },
    act: (w) => mutate('s06', (c) => c.from('assignments').update({ visibility: 'prepared', released_at: null }).eq('plan_id', w.P).eq('person_id', pid('l')).select(), `update public.assignments set visibility='prepared', released_at=null where plan_id='${w.P}' and person_id='${pid('l')}';`) },
  { id: 's07', name: 'assignment moved to another person (u)', world: {}, rekeyed: ['P'], loser: { l: ['P'] }, uGains: ['P'],
    act: (w) => mutate('s07', (c) => c.from('assignments').update({ person_id: pid('u'), user_id: U.u }).eq('plan_id', w.P).eq('person_id', pid('l')).select(), `update public.assignments set person_id='${pid('u')}', user_id='${U.u}' where plan_id='${w.P}' and person_id='${pid('l')}';`) },
  { id: 's08', name: 'assignment moved to another plan (P3)', world: {}, rekeyed: ['P'], loser: { l: ['P'] },
    act: (w) => mutate('s08', (c) => c.from('assignments').update({ plan_id: w.P3 }).eq('plan_id', w.P).eq('person_id', pid('l')).select(), `update public.assignments set plan_id='${w.P3}' where plan_id='${w.P}' and person_id='${pid('l')}';`) },
  { id: 's09', name: 'person archived', world: {}, rekeyed: ['T', 'T2', 'P', 'P2'], loser: { l: ['T', 'T2', 'P', 'P2'] },
    act: () => viaApi('s09', 'POST', `/api/v1/people/${pid('l')}/archive`, undefined, `update public.people set archived_at=now() where id='${pid('l')}';`) },
  { id: 's10', name: 'person unlinked from account', world: {}, rekeyed: ['T', 'T2', 'P', 'P2'], loser: { l: ['T', 'T2', 'P', 'P2'] },
    act: () => mutate('s10', (c) => c.from('people').update({ profile_id: null }).eq('id', pid('l')).select(), `update public.people set profile_id=null where id='${pid('l')}';`) },
  { id: 's11', name: 'person marked child', world: {}, rekeyed: ['T', 'T2', 'P', 'P2'], loser: { l: ['T', 'T2', 'P', 'P2'] },
    act: () => viaApi('s11', 'PATCH', `/api/v1/people/${pid('l')}`, { person_type: 'child' }, `update public.people set person_type='child' where id='${pid('l')}';`) },
  { id: 's12', name: 'linked person deleted (no assignments)', world: { noPlans: true }, rekeyed: ['T', 'T2'], loser: { l: ['T', 'T2'] },
    act: () => viaApi('s12', 'DELETE', `/api/v1/people/${pid('l')}`, undefined, `delete from public.people where id='${pid('l')}';`) },
  { id: 's13', name: 'plan moved to another service type (scope move)', world: { planST: true, grants: [{ cap: 'plans.edit', scope: 'service_type', col: 'service_type_id', val: 'ST1' }] }, rekeyed: ['P'], loser: { g: ['P'] },
    act: (w) => mutate('s13', (c) => c.from('plans').update({ service_type_id: w.ST2 }).eq('id', w.P).select(), `update public.plans set service_type_id='${w.ST2}' where id='${w.P}';`) },
  { id: 's14', name: 'team moved to another service type (scope move)', world: { teamST: true, grants: [{ cap: 'scheduling.manage', scope: 'service_type', col: 'service_type_id', val: 'ST1' }] }, rekeyed: ['T'], loser: { g: ['T'] },
    act: (w) => mutate('s14', (c) => c.from('teams').update({ service_type_id: w.ST2 }).eq('id', w.T).select(), `update public.teams set service_type_id='${w.ST2}' where id='${w.T}';`) },
  { id: 's15', name: 'team-scoped grant removed', world: { grants: [{ cap: 'scheduling.manage', scope: 'team', col: 'team_id', val: 'T' }] }, rekeyed: ['T'], loser: { g: ['T'] },
    act: () => mutate('s15', (c) => c.from('access_grants').delete().eq('user_id', U.g).eq('organization_id', A).select(), `delete from public.access_grants where user_id='${U.g}' and organization_id='${A}';`) },
  { id: 's16', name: 'team-scoped grant moved to another team (UPDATE team_id)', world: { grants: [{ cap: 'scheduling.manage', scope: 'team', col: 'team_id', val: 'T' }] }, rekeyed: ['T'], loser: { g: ['T'] },
    act: (w) => mutate('s16', (c) => c.from('access_grants').update({ team_id: w.T3 }).eq('user_id', U.g).eq('organization_id', A).select(), `update public.access_grants set team_id='${w.T3}' where user_id='${U.g}' and organization_id='${A}';`) },
  { id: 's17', name: 'org-wide grant removed (rotates org key)', world: { grants: [{ cap: 'scheduling.manage', scope: 'organization', col: 'team_id', val: null }] }, orgRot: true, loser: { g: ['T', 'T2', 'T4', 'P', 'P2'] },
    act: () => mutate('s17', (c) => c.from('access_grants').delete().eq('user_id', U.g).eq('organization_id', A).select(), `delete from public.access_grants where user_id='${U.g}' and organization_id='${A}';`) },
  { id: 's18', name: 'service type moved between folders (rotates org key)', world: { teamST: true }, orgRot: true, loser: {},
    act: (w) => mutate('s18', (c) => c.rpc('move_service_type', { p_service_type: w.ST1, p_folder: w.F2, p_acknowledge_changes: true }), `update public.service_types set folder_id='${w.F2}' where id='${w.ST1}';`) },
  { id: 's19', name: 'service-type folder re-parented (rotates org key)', world: {}, orgRot: true, loser: {},
    act: (w) => mutate('s19', (c) => c.rpc('move_service_type_folder', { p_folder: w.F2, p_new_parent: w.F1, p_expected_revision: Number(sql(`select revision from public.service_type_folders where id='${w.F2}'`)), p_acknowledge_changes: true }), `update public.service_type_folders set parent_id='${w.F1}' where id='${w.F2}';`) },
  { id: 's20', name: 'member access_mode legacy -> scoped (rotates org key)', world: {}, orgRot: true, loser: {},
    act: () => mutate('s20', (c) => c.from('organization_members').update({ access_mode: 'scoped' }).eq('organization_id', A).eq('user_id', U.g).select(), `update public.organization_members set access_mode='scoped' where organization_id='${A}' and user_id='${U.g}';`) },
  { id: 's21', name: 'member deactivated (org key; member l loses everything)', world: {}, orgRot: true, loser: { l: ['T', 'T2', 'P', 'P2'] }, orgLoser: ['l'],
    act: () => viaApi('s21', 'PATCH', `/api/v1/people/members/${U.l}`, { status: 'inactive' }, `update public.organization_members set status='inactive' where organization_id='${A}' and user_id='${U.l}';`) },
];

async function runSpec(spec) {
  const tag = spec.id;
  console.log(`\n=== ${tag} ${spec.name}`);
  resetPeople();
  const w = buildWorld(spec.world);
  const names = ['T', 'T2', 'T4', 'P', 'P2'];
  const holders = ['l', 'k', 'g'];
  const sock = {}; // sock[actor][conv] = {received, ch, topic}
  const chans = [];
  const open = async (a, key, topic) => { const received = []; const r = await join(actors[a].client, topic, received); chans.push(r.ch); sock[a][key] = { received, ch: r.ch, topic, status: r.status }; return r.status; };
  const topicsBefore = {};
  for (const a of holders) {
    sock[a] = {}; topicsBefore[a] = {};
    for (const n of names) {
      const t = await topicFor(actors[a], A, 'conversation', w.conv[n]);
      topicsBefore[a][n] = t.topic;
    }
  }
  const okt = (a, n) => !!topicsBefore[a][n];
  // initial access expectations
  const expectBefore = { l: spec.world.noPlans ? ['T', 'T2'] : ['T', 'T2', 'P', 'P2'], k: spec.world.noPlans ? ['T', 'T2', 'T4'] : ['T', 'T2', 'T4', 'P', 'P2'], g: Object.keys(spec.loser.g ? Object.fromEntries(spec.loser.g.map((x) => [x, 1])) : {}) };
  for (const a of holders) {
    const got = names.filter((n) => okt(a, n)).sort().join(',');
    const exp = [...expectBefore[a]].sort().join(',');
    if (a === 'g' && !spec.loser.g) { rec(tag, `${tag}.pre.${a}`, a, 'topic issue (no grant)', 'none', got || 'none', got === ''); continue; }
    rec(tag, `${tag}.pre.${a}`, a, 'topic issue before', exp, got, got === exp);
  }
  // org control + live_plan sockets
  const k0 = {};
  for (const a of holders) { k0[a] = (await orgKey(actors[a], A)).key; }
  const ctl = {}; const live = {};
  const live0 = {};
  for (const a of holders) {
    ctl[a] = []; live[a] = [];
    const j1 = await join(actors[a].client, `org:${A}:${k0[a]}`, ctl[a]); chans.push(j1.ch);
    const lt = (await topicFor(actors[a], A, 'live_plan', w.P)).topic; live0[a] = lt;
    const j2 = await join(actors[a].client, lt, live[a]); chans.push(j2.ch);
  }
  for (const a of holders) for (const n of names) if (okt(a, n)) { sock[a][n] = null; }
  const statuses = [];
  for (const a of holders) for (const n of names) if (okt(a, n)) statuses.push(await open(a, n, topicsBefore[a][n]));
  rec(tag, `${tag}.join`, 'all', 'initial joins', 'all SUBSCRIBED', `${statuses.length} sockets: ${[...new Set(statuses)].join(',')}`, statuses.every((s) => s === 'SUBSCRIBED'));
  // before: poke all
  for (const n of names) poke('conversation', w.conv[n]);
  poke('live_plan', w.P, A);
  const delivered = await waitFor(() => holders.every((a) => names.every((n) => !sock[a][n] || pokes(sock[a][n].received) === 1)) && holders.every((a) => pokes(live[a]) === 1), DELIV);
  rec(tag, `${tag}.before`, 'all', 'delivery before', 'every socket gets 1 poke', delivered === null ? 'missing' : `${delivered} ms`, delivered !== null);
  const snap = () => ({ org: sql(`select key from private.org_realtime_keys where organization_id='${A}'`), conv: Object.fromEntries(names.map((n) => [n, sql(`select key from private.conversation_realtime_keys where conversation_id='${w.conv[n]}'`)])) });
  const before = snap();
  // ---- act
  const t0 = Date.now();
  const how = await spec.act(w);
  const tAct = Date.now() - t0;
  const after0 = snap();
  rec(tag, `${tag}.act`, 'oa', 'owner mutation', 'applied', `${how} in ${tAct} ms`, true);
  // DB rotation
  if (spec.orgRot) {
    rec(tag, `${tag}.dbrot`, 'db', 'org key rotated', 'org key changed; conversation keys unchanged', `org ${after0.org !== before.org ? 'changed' : 'SAME'}; conv changed: ${names.filter((n) => after0.conv[n] !== before.conv[n]).join(',') || 'none'}`, after0.org !== before.org && names.every((n) => after0.conv[n] === before.conv[n]));
  } else {
    const changed = names.filter((n) => after0.conv[n] !== before.conv[n]).sort();
    const exp = [...spec.rekeyed].sort();
    rec(tag, `${tag}.dbrot`, 'db', 'conversation keys rotated', `rotated exactly: ${exp.join(',')}; org key unchanged`, `rotated: ${changed.join(',') || 'none'}; org ${after0.org === before.org ? 'unchanged' : 'CHANGED'}`, changed.join() === exp.join() && after0.org === before.org);
  }
  // rekey receipt by keepers
  const lat = {};
  const affectedNames = spec.orgRot ? null : spec.rekeyed;
  const dataBefore = {}; // data pokes count at moment after rekey
  if (spec.orgRot) {
    for (const a of holders) {
      const exp = !(spec.orgLoser ?? []).includes(a) || true; // loser still hears the id-free rekey on its old control topic
      const ms = await waitFor(() => rekeys(ctl[a]) >= 1, DELIV);
      lat[a] = ms;
      rec(tag, `${tag}.rekey.${a}`, a, 'org control rekey poke', 'rekey within ~2 s', ms === null ? 'none' : `${ms + 0} ms after wait start (${Date.now() - t0} ms since act)`, ms !== null && (Date.now() - t0) < 3000, `payload keys: ${Object.keys(ctl[a][0]?.payload ?? {}).join('|')}`);
    }
  } else {
    for (const n of spec.rekeyed) for (const a of ['k', 'l', 'g']) {
      if (!sock[a][n]) continue;
      const keeps = !(spec.loser[a] ?? []).includes(n);
      const ms = await waitFor(() => rekeys(sock[a][n].received) >= 1, DELIV);
      const since = ms === null ? null : (sock[a][n].received.find(isRekey).at - t0);
      if (keeps) rec(tag, `${tag}.rekey.${a}.${n}`, a, `rekey poke on ${n} (keeper)`, 'rekey within ~2 s', since === null ? 'none' : `${since} ms since act`, since !== null && since < 3000);
      else rec(tag, `${tag}.rekey.${a}.${n}`, a, `id-free rekey on old ${n} topic (loser, informational)`, 'rekey carries no data', since === null ? 'none received' : `${since} ms, payload keys ${Object.keys(sock[a][n].received.find(isRekey).payload).join('|')}`, since === null || Object.keys(sock[a][n].received.find(isRekey).payload).filter((x) => x !== 'id').join() === 'event');
    }
  }
  // unaffected conversations: no rekey anywhere
  if (!spec.orgRot) {
    const unaff = names.filter((n) => !spec.rekeyed.includes(n));
    const spurious = [];
    for (const a of holders) for (const n of unaff) if (sock[a][n] && rekeys(sock[a][n].received) > 0) spurious.push(`${a}:${n}`);
    for (const a of holders) if (rekeys(ctl[a]) > 0) spurious.push(`${a}:org-control`);
    for (const a of holders) if (rekeys(live[a]) > 0) spurious.push(`${a}:live_plan`);
    rec(tag, `${tag}.unaffected`, 'all', 'unaffected topics not rekeyed', `no rekey on ${unaff.join(',')} / org / live_plan`, spurious.join(',') || 'none', spurious.length === 0);
  }
  // snapshot data poke counts, then compute fresh topics
  const mark = {};
  for (const a of holders) { mark[a] = {}; for (const n of names) if (sock[a][n]) mark[a][n] = pokes(sock[a][n].received); }
  const newTopics = {};
  const refused = {};
  for (const a of holders) {
    newTopics[a] = {};
    for (const n of names) {
      if (!sock[a][n]) continue;
      const t = await topicFor(actors[a], A, 'conversation', w.conv[n]);
      newTopics[a][n] = t.topic;
    }
  }
  // loser topic refusal
  for (const [a, lost] of Object.entries(spec.loser)) {
    for (const n of lost) {
      const t = await topicFor(actors[a], A, 'conversation', w.conv[n]);
      rec(tag, `${tag}.refuse.${a}.${n}`, a, `POST /realtime/topics ${n}`, 'omitted (null)', t.topic === null ? `null (HTTP ${t.status})` : 'TOPIC ISSUED', t.topic === null);
    }
  }
  for (const a of spec.orgLoser ?? []) {
    const k = await orgKey(actors[a], A);
    rec(tag, `${tag}.orgkey.${a}`, a, 'GET /realtime/key', '403/404 (not active member)', `HTTP ${k.status}`, k.status === 404 || k.status === 403);
  }
  // keepers rejoin and receive; keeper-new topics
  const rej = [];
  const rejSock = {};
  const newOrgKey = {};
  if (spec.orgRot) for (const a of holders) { if ((spec.orgLoser ?? []).includes(a)) continue; newOrgKey[a] = (await orgKey(actors[a], A)).key; }
  const keeperConvs = (a) => names.filter((n) => sock[a][n] && !(spec.loser[a] ?? []).includes(n) && newTopics[a][n]);
  const stolenFor = {};
  for (const a of ['k', 'l', 'g']) {
    if (spec.orgRot && (spec.orgLoser ?? []).includes(a)) continue;
    rejSock[a] = {};
    for (const n of keeperConvs(a)) {
      const received = [];
      const topic = newTopics[a][n];
      if (!spec.orgRot && !spec.rekeyed.includes(n) && topic === sock[a][n].topic) continue; // unchanged topic: old socket stays valid
      const r = await join(actors[a].client, topic, received); chans.push(r.ch);
      rejSock[a][n] = { received, status: r.status, topic };
      rej.push(r.status);
      stolenFor[n] = stolenFor[n] ?? topic;
    }
  }
  rec(tag, `${tag}.rejoin`, 'keepers', 'rejoin with new topic', 'all SUBSCRIBED', `${rej.length} rejoins: ${[...new Set(rej)].join(',') || 'n/a'}`, rej.every((s) => s === 'SUBSCRIBED'));
  // poke everything now
  for (const n of names) poke('conversation', w.conv[n]);
  poke('live_plan', w.P, A);
  await sleep(1500);
  // keepers receive
  const missing = [];
  for (const a of ['k', 'l', 'g']) {
    for (const n of keeperConvs(a)) {
      const s = rejSock[a]?.[n];
      if (s) { if (pokes(s.received) < 1) missing.push(`${a}:${n}(new)`); }
      else if (pokes(sock[a][n].received) <= mark[a][n]) missing.push(`${a}:${n}(old)`);
    }
  }
  rec(tag, `${tag}.after.keep`, 'keepers', 'delivery after on retained access', 'each retained conversation delivers', missing.join(',') || 'all delivered', missing.length === 0);
  // live_plan behaviour
  const liveAfter = {};
  const livMiss = [];
  for (const a of ['k']) {
    if (spec.orgRot) {
      const lt = (await topicFor(actors[a], A, 'live_plan', w.P)).topic;
      const rcv = []; const r = await join(actors[a].client, lt, rcv); chans.push(r.ch);
      poke('live_plan', w.P, A); await sleep(1200);
      rec(tag, `${tag}.live.k`, a, 'live_plan after org rotation', 'topic changes with org key; rejoin delivers', `${lt === live0[a] ? 'SAME topic' : 'new topic'}, join ${r.status}, pokes ${pokes(rcv)}`, lt !== live0[a] && r.status === 'SUBSCRIBED' && pokes(rcv) >= 1);
    } else {
      const lt = (await topicFor(actors[a], A, 'live_plan', w.P)).topic;
      rec(tag, `${tag}.live.k`, a, 'live_plan topic / delivery stays on org key', 'unchanged topic; old socket still delivers', `${lt === live0[a] ? 'same topic' : 'CHANGED'}, pokes on old socket ${pokes(live[a])}`, lt === live0[a] && pokes(live[a]) >= 2);
    }
  }
  // losers silent
  await sleep(QUIET - 1500);
  for (const [a, lost] of Object.entries(spec.loser)) {
    for (const n of lost) {
      const extra = pokes(sock[a][n].received) - mark[a][n];
      rec(tag, `${tag}.silent.${a}.${n}`, a, `open socket on ${n} after loss (${Math.round((Date.now() - t0) / 1000)} s)`, 'zero data pokes after the rekey', `${extra} data pokes`, extra === 0, `total deliveries ${sock[a][n].received.length}`);
    }
  }
  if (spec.orgRot) {
    // every old socket silent after org rotation (including keepers until they rejoin)
    const leak = [];
    for (const a of holders) for (const n of names) if (sock[a][n] && pokes(sock[a][n].received) > mark[a][n]) leak.push(`${a}:${n}`);
    rec(tag, `${tag}.oldsilent`, 'all', 'old-topic sockets after org rotation', 'all silent (old org key)', leak.join(',') || 'all silent', leak.length === 0);
  } else {
    // unaffected old sockets still deliver
    const unaff = names.filter((n) => !spec.rekeyed.includes(n));
    const bad = [];
    for (const a of holders) for (const n of unaff) if (sock[a][n] && pokes(sock[a][n].received) <= mark[a][n]) bad.push(`${a}:${n}`);
    rec(tag, `${tag}.unaff.deliver`, 'all', 'unaffected conversations keep delivering on old sockets', 'delivered', bad.join(',') || 'all delivered', bad.length === 0);
  }
  // rejoin probes: losers, unrelated, other-org on stolen new topics + old topics
  const probeJobs = [];
  const lostNames = new Set(Object.values(spec.loser).flat());
  for (const n of [...lostNames].slice(0, 2)) {
    const stolen = Object.values(rejSock).map((m) => m?.[n]?.topic).find(Boolean) ?? (spec.orgRot ? null : null);
    for (const a of Object.keys(spec.loser)) {
      if (!(spec.loser[a] ?? []).includes(n)) continue;
      probeJobs.push(['loser ' + a, n, a, stolen, 'new']);
      probeJobs.push(['loser ' + a, n, a, topicsBefore[a][n], 'old']);
    }
    if (stolen) {
      if (!(spec.uGains ?? []).includes(n)) probeJobs.push(['unrelated u', n, 'u', stolen, 'new']);
      probeJobs.push(['other-org x', n, 'x', stolen, 'new']);
    }
  }
  const byActor = {};
  for (const j of probeJobs) (byActor[j[2]] = byActor[j[2]] ?? []).push(j);
  await Promise.all(Object.entries(byActor).map(async ([a, jobs]) => {
    for (const [who, n, , topic, kind] of jobs) {
      if (!topic) { rec(tag, `${tag}.probe.${a}.${n}.${kind}`, who, `rejoin ${kind} topic ${n}`, 'refused', 'no topic available', null); continue; }
      const received = [];
      const r = await join(probe[a].client, topic, received, 5000);
      try { await probe[a].client.removeChannel(r.ch); } catch {}
      rec(tag, `${tag}.probe.${a}.${n}.${kind}`, who, `join ${kind} topic of ${n}`, 'refused', r.status, r.status !== 'SUBSCRIBED');
    }
  }));
  // u gains
  for (const n of spec.uGains ?? []) {
    const t = await topicFor(actors.u, A, 'conversation', w.conv[n]);
    rec(tag, `${tag}.ugain.${n}`, 'u', `new holder gets topic ${n}`, 'issued', t.topic ? 'issued' : 'null', !!t.topic);
  }
  for (const c of chans) { try { await actors.k.client.removeChannel(c); } catch {} }
  for (const a of holders) { try { await actors[a].client.removeAllChannels(); } catch {} }
  destroyWorld(w);
  resetPeople();
}

for (const spec of SPECS) {
  if (only && !only.has(spec.id)) continue;
  try { await runSpec(spec); } catch (e) { rec(spec.id, `${spec.id}.error`, '-', 'scenario', 'completes', e.stack.split('\n').slice(0, 3).join(' / '), false); try { await Promise.all(Object.values(actors).map((a) => a.client.removeAllChannels())); } catch {} sql(require_clean()); }
}
console.log('\nFALLBACKS:\n' + fallbacks.join('\n'));
process.exit(0);
