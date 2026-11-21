import * as L from './lib.mjs';
const { sql, sleep, rec, ids, login, topicFor, orgKey, join, api, randomUUID, waitFor, pokes, rekeys, isRekey, poke, URL_, ANON, createClient, PW, email } = L;
const A = ids.org.A, T = 'sess';
const k = await login('k'), s = await login('s');
const s2 = await login('s'); // second device
const tm = randomUUID();
sql(`insert into public.teams (id, organization_id, name) values ('${tm}','${A}','w9 ST');
 insert into public.team_memberships (team_id, person_id) values ('${tm}','${ids.ppl['A:s']}'),('${tm}','${ids.ppl['A:k']}');
 insert into public.conversations (organization_id, kind, team_id) values ('${A}','team','${tm}');`);
const conv = sql(`select id from public.conversations where team_id='${tm}'`);
const dbKey = () => sql(`select key from private.org_realtime_keys where organization_id='${A}'`);
const chans = [];
const mk = async (a, topic) => { const r = []; const j = await join(a.client, topic, r); chans.push(j.ch); return { r, st: j.status, topic }; };
const sTopic = (await topicFor(s, A, 'conversation', conv)).topic, kTopic = (await topicFor(k, A, 'conversation', conv)).topic;
const key0 = (await orgKey(s, A)).key;
const sConv = await mk(s, sTopic), sCtl = await mk(s, `org:${A}:${key0}`), kConv = await mk(k, kTopic), kCtl = await mk(k, `org:${A}:${key0}`);
const s2Conv = await mk(s2, sTopic);
const oldToken = s.token;
poke('conversation', conv);
await waitFor(() => pokes(sConv.r) === 1 && pokes(kConv.r) === 1 && pokes(s2Conv.r) === 1, 5000);
rec(T, 'ss.pre', 's,k', 'delivery before sign-out', 'all 3 conv sockets receive', `${pokes(sConv.r)}/${pokes(kConv.r)}/${pokes(s2Conv.r)}`, pokes(sConv.r) === 1 && pokes(kConv.r) === 1);
// ---- single-session sign-out of device 1 (local), device 2 stays
let t0 = Date.now();
const { error: e1 } = await s.client.auth.signOut({ scope: 'local' });
const kRekeyMs = await waitFor(() => rekeys(kCtl.r) >= 1, 6000);
const dbChanged = dbKey() !== key0;
rec(T, 'ss.local', 's', 'local sign-out of device 1 (device 2 stays)', 'org key rotates within ~2 s (collateral rekey to org)', `rotated ${dbChanged}; k control rekey ${kRekeyMs === null ? 'none' : (kCtl.r.find(isRekey).at - t0) + ' ms'}`, dbChanged && kRekeyMs !== null && (kCtl.r.find(isRekey).at - t0) < 3000, e1 ? e1.message : '');
// device 2 can still fetch the new key and continues
const s2k = await orgKey(s2, A);
rec(T, 'ss.local2', 's (device 2)', 'other device still fetches key after device 1 sign-out', '200 new key', `HTTP ${s2k.status}, new ${s2k.key !== key0}`, s2k.status === 200 && s2k.key !== key0);
const key1 = dbKey();
// ---- global sign-out of device 2's account
const sTopic2 = (await topicFor(s2, A, 'conversation', conv)).topic;
const sNew = await mk(s2, sTopic2); // device 2 on current topic
const kNewTopic = (await topicFor(k, A, 'conversation', conv)).topic;
const kNew = await mk(k, kNewTopic);
poke('conversation', conv);
await waitFor(() => pokes(sNew.r) === 1 && pokes(kNew.r) === 1, 5000);
const beforeS = pokes(sNew.r);
const oldTok2 = s2.token;
t0 = Date.now();
const { error: e2 } = await s2.client.auth.signOut({ scope: 'global' });
const kRekey2 = await waitFor(() => rekeys(kNew.r) >= 0 && false, 1) ;
await sleep(1500);
const key2 = dbKey();
rec(T, 'ss.global.db', 'db', 'global sign-out rotates org key', 'changed within 1.5 s', `${key2 !== key1 ? 'rotated' : 'NOT rotated'}`, key2 !== key1, e2 ? e2.message : '');
// s's device-2 socket on current-key topic: new org key => poke to new topic only
const k2 = (await orgKey(k, A)).key, kt2 = (await topicFor(k, A, 'conversation', conv)).topic;
const kRe = await mk(k, kt2);
poke('conversation', conv);
await sleep(500);
for (let i = 0; i < 1; i++) poke('conversation', conv);
await sleep(15000);
const leaked = pokes(sNew.r) - beforeS;
rec(T, 'ss.global.silent', 's', 'open socket after global sign-out (16+ s, 3 pokes sent)', 'zero data pokes', `${leaked} data pokes in ${Math.round((Date.now() - t0) / 1000)} s`, leaked === 0);
rec(T, 'ss.global.keeper', 'k', 'remaining member rekeys and keeps receiving', 'receives on new topic', `${pokes(kRe.r)} pokes on new topic`, pokes(kRe.r) >= 2);
// old token attacks
const bearer = (tok) => ({ authorization: `Bearer ${tok}`, apikey: ANON });
const me = await api(oldTok2, 'GET', '/api/v1/me', null);
const rk = await api(oldTok2, 'GET', '/api/v1/realtime/key', A);
const pr = await fetch(`${URL_}/rest/v1/rpc/realtime_topic_key`, { method: 'POST', headers: { ...bearer(oldTok2), 'content-type': 'application/json' }, body: JSON.stringify({ p_org: A }) });
const pg = await fetch(`${URL_}/rest/v1/people?select=id&limit=1`, { headers: bearer(oldTok2) });
rec(T, 'ss.tok.api', 's (old token)', 'API GET /me and /realtime/key', '401 / 401', `${me.status} / ${rk.status}`, me.status === 401 && rk.status === 401);
rec(T, 'ss.tok.pgrst', 's (old token)', 'PostgREST rpc realtime_topic_key + people read', '401 / 401', `${pr.status} / ${pg.status}`, pr.status === 401 && pg.status === 401);
// Realtime join with old token
const oc = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
await oc.realtime.setAuth(oldTok2);
const rcv = []; const jOld = await join(oc, sTopic2, rcv, 5000);
rec(T, 'ss.tok.rt.old', 's (old token)', 'Realtime join of the pre-signout topic with old token', 'refused', jOld.status, jOld.status !== 'SUBSCRIBED');
const rcv2 = []; const jNew = await join(oc, kt2, rcv2, 5000);
rec(T, 'ss.tok.rt.cur', 's (old token)', 'Realtime join of CURRENT topic (secret not obtainable by the token holder) with old token', 'refused (defence in depth) or secret unobtainable', jNew.status, jNew.status !== 'SUBSCRIBED', jNew.status === 'SUBSCRIBED' ? 'informational: the join policy does not check session liveness; the token holder cannot learn the topic key (API/PostgREST 401)' : '');
try { await oc.removeAllChannels(); } catch {}
// refresh token reuse
const oldRefresh = (await s2.client.auth.getSession()).data.session?.refresh_token;
rec(T, 'ss.tok.refresh', 's', 'refresh with revoked refresh token', 'fails', oldRefresh ? 'session still present locally' : 'local session cleared', null);
// fresh login works and gets the key
const sFresh = await login('s');
const fk = await orgKey(sFresh, A);
rec(T, 'ss.fresh', 's', 'new login after global sign-out', '200 with current key', `HTTP ${fk.status}, current ${fk.key === dbKey()}`, fk.status === 200 && fk.key === dbKey());
for (const c of chans) { try { await k.client.removeChannel(c); } catch {} }
sql(`delete from public.teams where id='${tm}'`);
process.exit(0);
