import * as L from './lib.mjs';
const { sql, sleep, rec, ids, login, topicFor, orgKey, join, api, randomUUID } = L;
const A = ids.org.A, B = ids.org.B, U = ids.uid;
const T = 'pinned';
const kb = await login('kb'), x = await login('x'), u = await login('u');
const pA = ids.ppl['A:kb'], pB = ids.ppl['B:kb'];
const w = { tA: randomUUID(), tB: randomUUID(), plA: randomUUID() };
sql(`insert into public.teams (id, organization_id, name) values ('${w.tA}','${A}','w9p TA'),('${w.tB}','${B}','w9p TB');
 insert into public.team_memberships (team_id, person_id) values ('${w.tA}','${pA}'),('${w.tB}','${pB}');
 insert into public.plans (id, organization_id, title, service_date, status) values ('${w.plA}','${A}','w9p PA', now(),'published');
 insert into public.conversations (organization_id, kind, team_id) values ('${A}','team','${w.tA}'),('${B}','team','${w.tB}');`);
const cA = sql(`select id from public.conversations where team_id='${w.tA}'`), cB = sql(`select id from public.conversations where team_id='${w.tB}'`);
const post = (actor, org, resource, idsList) => api(actor.token, 'POST', '/api/v1/realtime/topics', org, { resource, ids: idsList });
const keyA = sql(`select key from private.org_realtime_keys where organization_id='${A}'`), keyB = sql(`select key from private.org_realtime_keys where organization_id='${B}'`);
const ckA = () => sql(`select key from private.conversation_realtime_keys where conversation_id='${cA}'`);
const ckB = () => sql(`select key from private.conversation_realtime_keys where conversation_id='${cB}'`);
let r;
r = await post(kb, A, 'conversation', [cA]);
rec(T, 'pin.1', 'kb', 'topics convA with X-Org A', 'topic w/ org A key', r.json?.topics?.[cA]?.includes(keyA) ? 'issued, org A key' : JSON.stringify(r), !!r.json?.topics?.[cA]?.includes(keyA));
r = await post(kb, B, 'conversation', [cA]);
rec(T, 'pin.2', 'kb', 'topics convA with X-Org B (other org kb belongs to)', 'omitted', `HTTP ${r.status} ${JSON.stringify(r.json)}`, r.status === 200 && Object.keys(r.json.topics).length === 0);
r = await post(kb, B, 'conversation', [cB]);
rec(T, 'pin.3', 'kb', 'topics convB with X-Org B', 'topic w/ org B key', r.json?.topics?.[cB]?.includes(keyB) && !r.json.topics[cB].includes(keyA) ? 'issued, org B key only' : JSON.stringify(r), !!r.json?.topics?.[cB]?.includes(keyB));
r = await post(kb, A, 'conversation', [cB]);
rec(T, 'pin.4', 'kb', 'topics convB with X-Org A', 'omitted', `HTTP ${r.status} ${JSON.stringify(r.json)}`, r.status === 200 && Object.keys(r.json.topics).length === 0);
r = await post(kb, A, 'conversation', [cA, cB]);
rec(T, 'pin.5', 'kb', 'mixed [convA, convB] with X-Org A', 'only convA', Object.keys(r.json?.topics ?? {}).map((k) => (k === cA ? 'convA' : 'convB')).join(',') , Object.keys(r.json?.topics ?? {}).join() === cA);
const ka = await orgKey(kb, A), kb2 = await orgKey(kb, B);
rec(T, 'pin.6', 'kb', 'GET /realtime/key per org header', 'A key for A, B key for B, different', `A ${ka.key === keyA ? 'ok' : 'MISMATCH'}, B ${kb2.key === keyB ? 'ok' : 'MISMATCH'}`, ka.key === keyA && kb2.key === keyB && keyA !== keyB);
r = await api(kb.token, 'POST', '/api/v1/realtime/topics', null, { resource: 'conversation', ids: [cA] });
rec(T, 'pin.7', 'kb', 'topics without X-Organization-Id (member of 2 orgs)', '4xx, no key', `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`, r.status >= 400 && !r.json?.topics);
r = await api(kb.token, 'GET', '/api/v1/realtime/key', null);
rec(T, 'pin.7b', 'kb', 'GET key without X-Organization-Id (2 orgs)', '4xx, no key', `HTTP ${r.status}`, r.status >= 400 && !r.json?.key);
// direct rpc
const rpc1 = await kb.client.rpc('realtime_resource_topics', { p_org: B, p_resource: 'conversation', p_ids: [cA] });
const rpc2 = await kb.client.rpc('realtime_resource_topics', { p_org: A, p_resource: 'conversation', p_ids: [cB] });
rec(T, 'pin.8', 'kb', 'RPC realtime_resource_topics(p_org mismatched)', 'empty both ways', `B/convA ${rpc1.data?.length}, A/convB ${rpc2.data?.length}`, rpc1.data?.length === 0 && rpc2.data?.length === 0);
r = await post(kb, B, 'live_plan', [w.plA]);
rec(T, 'pin.9', 'kb', 'live_plan of A plan with X-Org B', 'omitted', `${JSON.stringify(r.json)}`, Object.keys(r.json?.topics ?? {}).length === 0);
// other-org user
r = await post(x, A, 'conversation', [cA]);
rec(T, 'pin.10', 'x (B only)', 'topics convA with X-Org A (not a member)', '4xx/empty, no topic', `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`, !r.json?.topics || Object.keys(r.json.topics).length === 0);
r = await post(x, B, 'conversation', [cA]);
rec(T, 'pin.11', 'x (B only)', 'topics convA with X-Org B', 'empty', `HTTP ${r.status} ${JSON.stringify(r.json)}`, r.status === 200 && Object.keys(r.json.topics).length === 0);
r = await api(x.token, 'GET', '/api/v1/realtime/key', A);
rec(T, 'pin.12', 'x (B only)', 'GET key with X-Org A', '403/404, no key', `HTTP ${r.status}`, r.status >= 400 && !r.json?.key);
// crafted joins by kb (knows both orgs' keys + convA key + convB key)
const kcA = ckA(), kcB = ckB();
const tests = [
  ['pin.13', `conversation:${cA}:${keyB}:${kcA}`, 'convA id with org B key + convA key'],
  ['pin.14', `conversation:${cB}:${keyA}:${kcB}`, 'convB id with org A key + convB key'],
  ['pin.15', `conversation:${cA}:${keyA}:${kcB}`, 'convA id, org A key, convB conversation key'],
  ['pin.16', `live_plan:${w.plA}:${keyB}`, 'A live_plan with org B key'],
];
for (const [id, topic, label] of tests) {
  const rcv = []; const j = await join(kb.client, topic, rcv, 5000);
  rec(T, id, 'kb', `crafted join: ${label}`, 'refused', j.status, j.status !== 'SUBSCRIBED');
  try { await kb.client.removeChannel(j.ch); } catch {}
}
// x steals A's valid topic
const goodA = (await post(kb, A, 'conversation', [cA])).json.topics[cA];
const rcv = []; const j = await join(x.client, goodA, rcv, 5000);
rec(T, 'pin.17', 'x (B only)', 'join valid A conversation topic (stolen)', 'refused', j.status, j.status !== 'SUBSCRIBED');
try { await x.client.removeChannel(j.ch); } catch {}
const rcv2 = []; const j2 = await join(u.client, goodA, rcv2, 5000);
rec(T, 'pin.18', 'u (A member, not on team)', 'join valid A team topic (stolen)', 'refused', j2.status, j2.status !== 'SUBSCRIBED');
try { await u.client.removeChannel(j2.ch); } catch {}
sql(`delete from public.plans where id='${w.plA}'; delete from public.teams where id in ('${w.tA}','${w.tB}');`);
process.exit(0);
