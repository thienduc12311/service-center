# W9-RT: Realtime revocation and per-resource keys retest (QA-16 retest of QA-08/QA-12; W7-JRN-D3 Storage leg)

- Package: W9-RT. Tester: QA agent. Date: 2026-11-21.
- Commit under test: 9aaeada (main, frozen), run from branch feature/qa-wave9. API http://localhost:4000 (sibling worktree, same code), local Supabase 54321 incl. Realtime v2.167.0 per ADR 0005 (live sockets, not mocked). Migrations 20261127000600 / 0700 / 0800 applied.
- Method: scripts/API/DB only (no browser, delivery worker not run, no code/config changes). Sockets and the API calls use each actor's own JWT; the owner (oa) performs the mutations through the real API or PostgREST. Service-role SQL was used only for fixtures, `send_resource_poke` and where no user path exists (see "Fallbacks").
- Namespace: orgs `qa-w9-rt-a|b|c`; users `<alias>.qaw9.rt@example.test` (aliases oa, l, k, u, g, s, kb, ob, x, oc, c1). Passwords are in the scratchpad `rt/pw`, not in this report.
- Fixture shape per scenario (org A, rebuilt each time): teams T and T2 (losing user `l` and remaining user `k` both members), T4 (only `k`), T3 (empty move target); plans P and P2 (`l` and `k` assigned, released), P3 (move target, `k` assigned); optional service types/folders and an access grant for `g`. Sockets per scenario: 9 conversation sockets (l, k, g where they hold access), org control topic for l/k/g, live_plan topic for l/k/g. `u` = unrelated member of org A (no team, no plan); `x` = member of org B only; `kb` = member of A and B.
- Per trigger and actor the harness asserts: delivery before, DB key rotation (exactly the expected conversations; org key unchanged unless expected), rekey poke latency to the remaining user, topic refusal for the loser through `POST /api/v1/realtime/topics`, remaining user refetches and rejoins and keeps receiving, loser's open socket gets zero data pokes for 5 s or more, loser/unrelated/other-org user cannot join the new (stolen) topic nor the old one, unaffected conversations/org control/live_plan are not rekeyed and keep delivering.
- Scripts and raw results: `docs/qa/runs/2026-11-21-wave9/evidence/w9-rt/` (scen.mjs, pinned.mjs, orgdel.mjs, sess.mjs, refresh.mjs, storage.mjs, lib.mjs, setup.mjs, results.json). The scripts read the password from the scratchpad file.

## Summary


Harness checks: PASS 533, FAIL 1, NOT_APPLICABLE 1, BLOCKED 0, NOT_RUN 0 (plus the 79 baseline checks below, all PASS).


Headline: server-enforced revocation holds in every trigger tested. No cross-tenant leak and no revoked user receiving private content was observed (P0: none). One P2 hardening gap (W9-RT-D1). Rekey poke latency to the remaining user: about 200-300 ms per-resource and 245-300 ms for org-wide rotations (baseline scripts: 143-150 ms), measured from just before the mutation request.

## 1. Baseline (repo e2e scripts, run first)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-INT-D5 base | owner, sam | `supabase/tests/qa-wave8-realtime-revocation.e2e.mjs` (seed org) | all checks pass | 15/15 PASS: rekey 143 ms; removed member silent 10 s; refused new key; cannot rejoin; session delete rotates key | PASS |
| RES-REV base (RPC) | sam, riley | `qa-wave8-realtime-resource-revocation.e2e.mjs` | all pass | 32/32 PASS (rekey 150 ms) | PASS |
| RES-REV base (API) | sam, riley | same script with `E2E_API_URL=http://localhost:4000` | all pass | 32/32 PASS | PASS |


## 2. Per-resource revocation matrix (conversation topic keys, org key, live topics)

Each row aggregates the individual checks of that kind for the scenario (actor column lists who was checked). Full per-check rows: results.json.

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| s01.pre team_memberships DELETE (removed from team) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s01.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s01.before  | all | delivery before | every socket gets 1 poke | 50 ms | PASS |
| s01.act  | oa | mutation | applied | rest in 13 ms | PASS |
| s01.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s01.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 216 ms since act; l.T: 216 ms, payload keys id\|event | PASS |
| s01.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s01.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200) | PASS |
| s01.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s01.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s01.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s01.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes | PASS |
| s01.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s01.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT | PASS |
| s02.pre team_memberships UPDATE team_id (move to another team) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s02.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s02.before  | all | delivery before | every socket gets 1 poke | 52 ms | PASS |
| s02.act  | oa | mutation | applied | rest in 5 ms | PASS |
| s02.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s02.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 199 ms since act; l.T: 199 ms, payload keys id\|event | PASS |
| s02.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s02.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200) | PASS |
| s02.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s02.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s02.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s02.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes | PASS |
| s02.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s02.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT | PASS |
| s04.pre assignment DELETE | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s04.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s04.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s04.act  | oa | mutation | applied | rest in 6 ms | PASS |
| s04.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s04.rekey  | k, l | rekey poke | rekey within ~2 s | k.P: 203 ms since act; l.P: 203 ms, payload keys id\|event | PASS |
| s04.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s04.refuse  | l | loser refused topic | omitted (null) | l.P: null (HTTP 200) | PASS |
| s04.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s04.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s04.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s04.silent  | l | loser open socket | zero data pokes after the rekey | l.P: 0 data pokes | PASS |
| s04.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s04.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.P.new: TIMED_OUT; u.P.new: TIMED_OUT; x.P.new: TIMED_OUT; l.P.old: TIMED_OUT | PASS |
| s05.pre assignment status -> declined | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s05.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s05.before  | all | delivery before | every socket gets 1 poke | 52 ms | PASS |
| s05.act  | oa | mutation | applied | rest in 8 ms | PASS |
| s05.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s05.rekey  | k, l | rekey poke | rekey within ~2 s | k.P: 222 ms since act; l.P: 222 ms, payload keys id\|event | PASS |
| s05.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s05.refuse  | l | loser refused topic | omitted (null) | l.P: null (HTTP 200) | PASS |
| s05.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s05.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s05.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s05.silent  | l | loser open socket | zero data pokes after the rekey | l.P: 0 data pokes | PASS |
| s05.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s05.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.P.new: TIMED_OUT; u.P.new: TIMED_OUT; x.P.new: TIMED_OUT; l.P.old: TIMED_OUT | PASS |
| s08.pre assignment moved to another plan (P3) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s08.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s08.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s08.act  | oa | mutation | applied | rest in 6 ms | PASS |
| s08.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s08.rekey  | k, l | rekey poke | rekey within ~2 s | k.P: 201 ms since act; l.P: 201 ms, payload keys id\|event | PASS |
| s08.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s08.refuse  | l | loser refused topic | omitted (null) | l.P: null (HTTP 200) | PASS |
| s08.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s08.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s08.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s08.silent  | l | loser open socket | zero data pokes after the rekey | l.P: 0 data pokes | PASS |
| s08.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s08.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.P.new: TIMED_OUT; u.P.new: TIMED_OUT; x.P.new: TIMED_OUT; l.P.old: TIMED_OUT | PASS |
| s10.pre person unlinked from account | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s10.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s10.before  | all | delivery before | every socket gets 1 poke | 49 ms | PASS |
| s10.act  | oa | mutation | applied | sql (rest: permission denied for table people) in 43 ms | PASS |
| s10.dbrot  | db | DB key rotation | rotated exactly: P,P2,T,T2; org key unchanged | rotated: P,P2,T,T2; org unchanged | PASS |
| s10.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 250 ms since act; l.T: 250 ms, payload keys id\|event; k.T2: 250 ms since act; l.T2: 250 ms, payload keys id\|event; k.P: 250 ms since act; l.P: 250 ms, payload keys id\|event; (+2 more) | PASS |
| s10.unaffected  | all | unaffected not rekeyed | no rekey on T4 / org / live_plan | none | PASS |
| s10.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200); l.T2: null (HTTP 200); l.P: null (HTTP 200); l.P2: null (HTTP 200) | PASS |
| s10.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 4 rejoins: SUBSCRIBED | PASS |
| s10.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s10.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s10.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes; l.T2: 0 data pokes; l.P: 0 data pokes; l.P2: 0 data pokes | PASS |
| s10.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s10.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |
| s13.pre plan moved to another service type (scope move) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; P | PASS |
| s13.join  | all | initial joins | all SUBSCRIBED | 10 sockets: SUBSCRIBED | PASS |
| s13.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s13.act  | oa | mutation | applied | rest in 4 ms | PASS |
| s13.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s13.rekey  | g, k, l | rekey poke | rekey within ~2 s | k.P: 202 ms since act; l.P: 202 ms since act; g.P: 202 ms, payload keys id\|event | PASS |
| s13.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s13.refuse  | g | loser refused topic | omitted (null) | g.P: null (HTTP 200) | PASS |
| s13.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 2 rejoins: SUBSCRIBED | PASS |
| s13.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s13.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s13.silent  | g | loser open socket | zero data pokes after the rekey | g.P: 0 data pokes | PASS |
| s13.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s13.probe  | loser g, other-org x, unrelated u | rejoin probes | refused | g.P.new: TIMED_OUT; u.P.new: TIMED_OUT; x.P.new: TIMED_OUT; g.P.old: TIMED_OUT | PASS |
| s14.pre team moved to another service type (scope move) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; T | PASS |
| s14.join  | all | initial joins | all SUBSCRIBED | 10 sockets: SUBSCRIBED | PASS |
| s14.before  | all | delivery before | every socket gets 1 poke | 50 ms | PASS |
| s14.act  | oa | mutation | applied | rest in 5 ms | PASS |
| s14.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s14.rekey  | g, k, l | rekey poke | rekey within ~2 s | k.T: 238 ms since act; l.T: 238 ms since act; g.T: 238 ms, payload keys id\|event | PASS |
| s14.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s14.refuse  | g | loser refused topic | omitted (null) | g.T: null (HTTP 200) | PASS |
| s14.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 2 rejoins: SUBSCRIBED | PASS |
| s14.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s14.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s14.silent  | g | loser open socket | zero data pokes after the rekey | g.T: 0 data pokes | PASS |
| s14.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s14.probe  | loser g, other-org x, unrelated u | rejoin probes | refused | g.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; g.T.old: TIMED_OUT | PASS |
| s15.pre team-scoped grant removed | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; T | PASS |
| s15.join  | all | initial joins | all SUBSCRIBED | 10 sockets: SUBSCRIBED | PASS |
| s15.before  | all | delivery before | every socket gets 1 poke | 52 ms | PASS |
| s15.act  | oa | mutation | applied | rest in 4 ms | PASS |
| s15.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s15.rekey  | g, k, l | rekey poke | rekey within ~2 s | k.T: 229 ms since act; l.T: 229 ms since act; g.T: 229 ms, payload keys id\|event | PASS |
| s15.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s15.refuse  | g | loser refused topic | omitted (null) | g.T: null (HTTP 200) | PASS |
| s15.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 2 rejoins: SUBSCRIBED | PASS |
| s15.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s15.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s15.silent  | g | loser open socket | zero data pokes after the rekey | g.T: 0 data pokes | PASS |
| s15.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s15.probe  | loser g, other-org x, unrelated u | rejoin probes | refused | g.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; g.T.old: TIMED_OUT | PASS |
| s16.pre team-scoped grant moved to another team (UPDATE team_id) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; T | PASS |
| s16.join  | all | initial joins | all SUBSCRIBED | 10 sockets: SUBSCRIBED | PASS |
| s16.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s16.act  | oa | mutation | applied | sql (rest: permission denied for table access_grants) in 47 ms | PASS |
| s16.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s16.rekey  | g, k, l | rekey poke | rekey within ~2 s | k.T: 299 ms since act; l.T: 299 ms since act; g.T: 299 ms, payload keys id\|event | PASS |
| s16.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s16.refuse  | g | loser refused topic | omitted (null) | g.T: null (HTTP 200) | PASS |
| s16.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 2 rejoins: SUBSCRIBED | PASS |
| s16.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s16.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s16.silent  | g | loser open socket | zero data pokes after the rekey | g.T: 0 data pokes | PASS |
| s16.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s16.probe  | loser g, other-org x, unrelated u | rejoin probes | refused | g.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; g.T.old: TIMED_OUT | PASS |
| s17.pre org-wide grant removed (rotates org key) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; P,P2,T,T2,T4 | PASS |
| s17.join  | all | initial joins | all SUBSCRIBED | 14 sockets: SUBSCRIBED | PASS |
| s17.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s17.act  | oa | mutation | applied | rest in 5 ms | PASS |
| s17.dbrot  | db | DB key rotation | org key changed; conversation keys unchanged | org changed; conv changed: none | PASS |
| s17.rekey  | g, k, l | rekey poke | rekey within ~2 s | l: 50 ms after wait start (264 ms since act); k: 0 ms after wait start (264 ms since act); g: 0 ms after wait start (264 ms since act) | PASS |
| s17.refuse  | g | loser refused topic | omitted (null) | g.T: null (HTTP 200); g.T2: null (HTTP 200); g.T4: null (HTTP 200); g.P: null (HTTP 200); g.P2: null (HTTP 200) | PASS |
| s17.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 9 rejoins: SUBSCRIBED | PASS |
| s17.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s17.live  | k | live_plan | topic changes with org key; rejoin delivers | new topic, join SUBSCRIBED, pokes 1 | PASS |
| s17.silent  | g | loser open socket | zero data pokes after the rekey | g.T: 0 data pokes; g.T2: 0 data pokes; g.T4: 0 data pokes; g.P: 0 data pokes; g.P2: 0 data pokes | PASS |
| s17.oldsilent  | all | old sockets after org rotation | all silent (old org key) | all silent | PASS |
| s17.probe  | loser g, other-org x, unrelated u | rejoin probes | refused | g.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; g.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |
| s20.pre member access_mode legacy -> scoped (rotates org key) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s20.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s20.before  | all | delivery before | every socket gets 1 poke | 52 ms | PASS |
| s20.act  | oa | mutation | applied | rest in 4 ms | PASS |
| s20.dbrot  | db | DB key rotation | org key changed; conversation keys unchanged | org changed; conv changed: none | PASS |
| s20.rekey  | g, k, l | rekey poke | rekey within ~2 s | l: 49 ms after wait start (245 ms since act); k: 0 ms after wait start (245 ms since act); g: 0 ms after wait start (245 ms since act) | PASS |
| s20.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 9 rejoins: SUBSCRIBED | PASS |
| s20.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s20.live  | k | live_plan | topic changes with org key; rejoin delivers | new topic, join SUBSCRIBED, pokes 1 | PASS |
| s20.oldsilent  | all | old sockets after org rotation | all silent (old org key) | all silent | PASS |
| s03.pre team_memberships UPDATE person_id (position handed to u) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s03.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s03.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s03.act  | oa | mutation | applied | rest in 14 ms | PASS |
| s03.dbrot  | db | DB key rotation | rotated exactly: T; org key unchanged | rotated: T; org unchanged | PASS |
| s03.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 223 ms since act; l.T: 223 ms, payload keys id\|event | PASS |
| s03.unaffected  | all | unaffected not rekeyed | no rekey on T2,T4,P,P2 / org / live_plan | none | PASS |
| s03.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200) | PASS |
| s03.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s03.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s03.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s03.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes | PASS |
| s03.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s03.probe  | loser l, other-org x | rejoin probes | refused | l.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT | PASS |
| s03.ugain  | u | new holder gets topic | issued | issued | PASS |
| s06.pre assignment un-released (visibility draft) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s06.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s06.before  | all | delivery before | every socket gets 1 poke | 49 ms | PASS |
| s06.act  | oa | mutation | applied | sql (rest: A released request cannot be made private again; remove it instead) in 41 ms | PASS |
| s06.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s06.rekey  | k, l | rekey poke | rekey within ~2 s | k.P: 235 ms since act; l.P: 235 ms, payload keys id\|event | PASS |
| s06.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s06.refuse  | l | loser refused topic | omitted (null) | l.P: null (HTTP 200) | PASS |
| s06.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s06.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s06.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s06.silent  | l | loser open socket | zero data pokes after the rekey | l.P: 0 data pokes | PASS |
| s06.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s06.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.P.new: TIMED_OUT; u.P.new: TIMED_OUT; x.P.new: TIMED_OUT; l.P.old: TIMED_OUT | PASS |
| s07.pre assignment moved to another person (u) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s07.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s07.before  | all | delivery before | every socket gets 1 poke | 52 ms | PASS |
| s07.act  | oa | mutation | applied | rest in 6 ms | PASS |
| s07.dbrot  | db | DB key rotation | rotated exactly: P; org key unchanged | rotated: P; org unchanged | PASS |
| s07.rekey  | k, l | rekey poke | rekey within ~2 s | k.P: 208 ms since act; l.P: 208 ms, payload keys id\|event | PASS |
| s07.unaffected  | all | unaffected not rekeyed | no rekey on T,T2,T4,P2 / org / live_plan | none | PASS |
| s07.refuse  | l | loser refused topic | omitted (null) | l.P: null (HTTP 200) | PASS |
| s07.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 1 rejoins: SUBSCRIBED | PASS |
| s07.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s07.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s07.silent  | l | loser open socket | zero data pokes after the rekey | l.P: 0 data pokes | PASS |
| s07.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s07.probe  | loser l, other-org x | rejoin probes | refused | l.P.new: TIMED_OUT; x.P.new: TIMED_OUT; l.P.old: TIMED_OUT | PASS |
| s07.ugain  | u | new holder gets topic | issued | issued | PASS |
| s09.pre person archived | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s09.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s09.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s09.act  | oa | mutation | applied | api POST /api/v1/people/:id/archive -> 200 in 24 ms | PASS |
| s09.dbrot  | db | DB key rotation | rotated exactly: P,P2,T,T2; org key unchanged | rotated: P,P2,T,T2; org unchanged | PASS |
| s09.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 12 ms since act; l.T: 12 ms, payload keys id\|event; k.T2: 12 ms since act; l.T2: 12 ms, payload keys id\|event; k.P: 12 ms since act; l.P: 12 ms, payload keys id\|event; (+2 more) | PASS |
| s09.unaffected  | all | unaffected not rekeyed | no rekey on T4 / org / live_plan | none | PASS |
| s09.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200); l.T2: null (HTTP 200); l.P: null (HTTP 200); l.P2: null (HTTP 200) | PASS |
| s09.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 4 rejoins: SUBSCRIBED | PASS |
| s09.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s09.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s09.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes; l.T2: 0 data pokes; l.P: 0 data pokes; l.P2: 0 data pokes | PASS |
| s09.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s09.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |
| s11.pre person marked child | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s11.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s11.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s11.act  | oa | mutation | applied | api PATCH /api/v1/people/:id -> 200 in 18 ms | PASS |
| s11.dbrot  | db | DB key rotation | rotated exactly: P,P2,T,T2; org key unchanged | rotated: P,P2,T,T2; org unchanged | PASS |
| s11.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 11 ms since act; l.T: 11 ms, payload keys id\|event; k.T2: 11 ms since act; l.T2: 11 ms, payload keys id\|event; k.P: 11 ms since act; l.P: 11 ms, payload keys id\|event; (+2 more) | PASS |
| s11.unaffected  | all | unaffected not rekeyed | no rekey on T4 / org / live_plan | none | PASS |
| s11.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200); l.T2: null (HTTP 200); l.P: null (HTTP 200); l.P2: null (HTTP 200) | PASS |
| s11.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 4 rejoins: SUBSCRIBED | PASS |
| s11.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s11.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s11.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes; l.T2: 0 data pokes; l.P: 0 data pokes; l.P2: 0 data pokes | PASS |
| s11.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s11.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |
| s12.pre linked person deleted (no assignments) | g, k, l | topic issue before | T,T2 | T,T2; T,T2,T4; none | PASS |
| s12.join  | all | initial joins | all SUBSCRIBED | 5 sockets: SUBSCRIBED | PASS |
| s12.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s12.act  | oa | mutation | applied | api DELETE /api/v1/people/:id -> 204 in 16 ms | PASS |
| s12.dbrot  | db | DB key rotation | rotated exactly: T,T2; org key unchanged | rotated: T,T2; org unchanged | PASS |
| s12.rekey  | k, l | rekey poke | rekey within ~2 s | k.T: 15 ms since act; l.T: 15 ms, payload keys id\|event; k.T2: 15 ms since act; l.T2: 15 ms, payload keys id\|event | PASS |
| s12.unaffected  | all | unaffected not rekeyed | no rekey on T4,P,P2 / org / live_plan | none | PASS |
| s12.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 200); l.T2: null (HTTP 200) | PASS |
| s12.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 2 rejoins: SUBSCRIBED | PASS |
| s12.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s12.live  | k | live_plan | unchanged topic; old socket still delivers | same topic, pokes on old socket 2 | PASS |
| s12.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes; l.T2: 0 data pokes | PASS |
| s12.unaff  | all | unaffected still deliver | delivered | all delivered | PASS |
| s12.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |
| s18.pre service type moved between folders (rotates org key) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s18.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s18.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s18.act  | oa | mutation | applied | rest in 5 ms | PASS |
| s18.dbrot  | db | DB key rotation | org key changed; conversation keys unchanged | org changed; conv changed: none | PASS |
| s18.rekey  | g, k, l | rekey poke | rekey within ~2 s | l: 51 ms after wait start (267 ms since act); k: 0 ms after wait start (268 ms since act); g: 0 ms after wait start (268 ms since act) | PASS |
| s18.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 9 rejoins: SUBSCRIBED | PASS |
| s18.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s18.live  | k | live_plan | topic changes with org key; rejoin delivers | new topic, join SUBSCRIBED, pokes 1 | PASS |
| s18.oldsilent  | all | old sockets after org rotation | all silent (old org key) | all silent | PASS |
| s19.pre service-type folder re-parented (rotates org key) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s19.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s19.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s19.act  | oa | mutation | applied | rest in 38 ms | PASS |
| s19.dbrot  | db | DB key rotation | org key changed; conversation keys unchanged | org changed; conv changed: none | PASS |
| s19.rekey  | g, k, l | rekey poke | rekey within ~2 s | l: 52 ms after wait start (283 ms since act); k: 0 ms after wait start (283 ms since act); g: 0 ms after wait start (283 ms since act) | PASS |
| s19.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 9 rejoins: SUBSCRIBED | PASS |
| s19.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s19.live  | k | live_plan | topic changes with org key; rejoin delivers | new topic, join SUBSCRIBED, pokes 1 | PASS |
| s19.oldsilent  | all | old sockets after org rotation | all silent (old org key) | all silent | PASS |
| s21.pre member deactivated (org key; member l loses everything) | g, k, l | topic issue before | P,P2,T,T2 | P,P2,T,T2; P,P2,T,T2,T4; none | PASS |
| s21.join  | all | initial joins | all SUBSCRIBED | 9 sockets: SUBSCRIBED | PASS |
| s21.before  | all | delivery before | every socket gets 1 poke | 51 ms | PASS |
| s21.act  | oa | mutation | applied | api PATCH /api/v1/people/members/:id -> 200 in 8 ms | PASS |
| s21.dbrot  | db | DB key rotation | org key changed; conversation keys unchanged | org changed; conv changed: none | PASS |
| s21.rekey  | g, k, l | rekey poke | rekey within ~2 s | l: 0 ms after wait start (200 ms since act); k: 0 ms after wait start (200 ms since act); g: 0 ms after wait start (200 ms since act) | PASS |
| s21.refuse  | l | loser refused topic | omitted (null) | l.T: null (HTTP 403); l.T2: null (HTTP 403); l.P: null (HTTP 403); l.P2: null (HTTP 403) | PASS |
| s21.orgkey  | l | loser refused org key | 403/404 (not active member) | HTTP 403 | PASS |
| s21.rejoin  | keepers | keepers rejoin | all SUBSCRIBED | 5 rejoins: SUBSCRIBED | PASS |
| s21.after  | keepers | delivery after (retained access) | each retained conversation delivers | all delivered | PASS |
| s21.live  | k | live_plan | topic changes with org key; rejoin delivers | new topic, join SUBSCRIBED, pokes 1 | PASS |
| s21.silent  | l | loser open socket | zero data pokes after the rekey | l.T: 0 data pokes; l.T2: 0 data pokes; l.P: 0 data pokes; l.P2: 0 data pokes | PASS |
| s21.oldsilent  | all | old sockets after org rotation | all silent (old org key) | all silent | PASS |
| s21.probe  | loser l, other-org x, unrelated u | rejoin probes | refused | l.T.new: TIMED_OUT; u.T.new: TIMED_OUT; x.T.new: TIMED_OUT; l.T.old: TIMED_OUT; u.T2.new: TIMED_OUT; x.T2.new: TIMED_OUT; (+2 more) | PASS |

Scenario key: s01 team_memberships DELETE; s02 team_memberships UPDATE team_id (move); s03 team_memberships UPDATE person_id (position handed to `u`, `u` gains); s04 assignment DELETE; s05 declined; s06 un-released (prepared); s07 assignment moved to another person; s08 assignment moved to another plan; s09 person archived; s10 person unlinked; s11 person marked child; s12 linked person deleted; s13 plan moved to another service type (plans.edit grant at service-type scope, loser `g`); s14 team moved to another service type; s15 team-scoped grant deleted; s16 team-scoped grant moved to another team; s17 org-wide grant deleted (org key rotates); s18 service type moved between folders (org key); s19 folder re-parented (org key); s20 member access_mode legacy to scoped (org key); s21 member deactivated (org key, loser `l` loses everything).

Observations from the matrix (not defects):
- The id-free `rekey` poke is also delivered to the losing user's already-open socket (it is sent to the old topic before rotation). It carries no data (payload keys `event` plus Realtime's own `id`); after it the loser got zero data pokes in every scenario.
- Collateral rekeys by design: s18, s19, s20 and the session deletions rotate the org key although nobody loses access, so every open socket in the org must refetch the key and rejoin (all keepers did, all delivered afterwards).
- Un-releasing a released assignment is refused by a guard when done as the owner via PostgREST ("A released request cannot be made private again"), so s06 exercised the DB trigger through service-role SQL only. Person unlink (s10) has no API path (`PATCH /people/:id` does not take `profile_id`); also SQL. Archive (s09), child (s11), delete (s12) and member deactivation (s21) went through the real API as the owner; s01, s02, s04, s05, s08, s13-s15, s17-s20 through owner PostgREST (s18, s19 through the move RPCs); s16 (UPDATE of access_grants.team_id) and s06, s10 fell back to SQL.
- Failed joins surface as `TIMED_OUT` or `CHANNEL_ERROR` depending on the topic; both count as refused here.

## 3. Key request pinned to its church (pinned.mjs)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| pin.1 | kb | topics convA with X-Org A | topic w/ org A key | issued, org A key | PASS |
| pin.2 | kb | topics convA with X-Org B (other org kb belongs to) | omitted | HTTP 200 {"topics":{}} | PASS |
| pin.3 | kb | topics convB with X-Org B | topic w/ org B key | issued, org B key only | PASS |
| pin.4 | kb | topics convB with X-Org A | omitted | HTTP 200 {"topics":{}} | PASS |
| pin.5 | kb | mixed [convA, convB] with X-Org A | only convA | convA | PASS |
| pin.6 | kb | GET /realtime/key per org header | A key for A, B key for B, different | A ok, B ok | PASS |
| pin.7 | kb | topics without X-Organization-Id (member of 2 orgs) | 4xx, no key | HTTP 400 {"error":"Multiple organizations available — send an X-Organization-Id header"," | PASS |
| pin.7b | kb | GET key without X-Organization-Id (2 orgs) | 4xx, no key | HTTP 400 | PASS |
| pin.8 | kb | RPC realtime_resource_topics(p_org mismatched) | empty both ways | B/convA 0, A/convB 0 | PASS |
| pin.9 | kb | live_plan of A plan with X-Org B | omitted | {"topics":{}} | PASS |
| pin.10 | x (B only) | topics convA with X-Org A (not a member) | 4xx/empty, no topic | HTTP 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| pin.11 | x (B only) | topics convA with X-Org B | empty | HTTP 200 {"topics":{}} | PASS |
| pin.12 | x (B only) | GET key with X-Org A | 403/404, no key | HTTP 403 | PASS |
| pin.13 | kb | crafted join: convA id with org B key + convA key | refused | TIMED_OUT | PASS |
| pin.14 | kb | crafted join: convB id with org A key + convB key | refused | TIMED_OUT | PASS |
| pin.15 | kb | crafted join: convA id, org A key, convB conversation key | refused | TIMED_OUT | PASS |
| pin.16 | kb | crafted join: A live_plan with org B key | refused | TIMED_OUT | PASS |
| pin.17 | x (B only) | join valid A conversation topic (stolen) | refused | TIMED_OUT | PASS |
| pin.18 | u (A member, not on team) | join valid A team topic (stolen) | refused | TIMED_OUT | PASS |

## 4. Organization delete regression of 20261127000600 (orgdel.mjs)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| od.pre | c1 | org with members, keys, keyed conversation, 2 sockets | org key 1, conv key 1, members 2, convs 1; sockets SUBSCRIBED | 1\|1\|2\|1; SUBSCRIBED/SUBSCRIBED; delivered 1 | PASS |
| od.delete | service role PostgREST (owner: zero rows) | DELETE organization (members + keys) | succeeds, org gone | ok; org rows 0 | PASS |
| od.cascade | db | keys and members cascade | 0\|0\|0\|0 | 0\|0\|0\|0 | PASS |
| od.noorphan | db | no orphan keys | 0 | 0 | PASS |
| od.recreate | service role | recreate org C as fixture | new org gets org key | key row 1, 2 members, people rows auto-created | PASS |

No API route deletes an organization (`organizationsRouter` has GET/POST/PATCH only) and the owner's PostgREST delete returned zero rows (RLS), so the delete ran with the service role. Org C was recreated afterwards as the fixture.

## 5. Session liveness: sign-out and Realtime (W8-INT-D5 second half; sess.mjs, refresh.mjs)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ss.pre | s,k | delivery before sign-out | all 3 conv sockets receive | 1/1/1 | PASS |
| ss.local | s | local sign-out of device 1 (device 2 stays) | org key rotates within ~2 s (collateral rekey to org) | rotated true; k control rekey 4 ms | PASS |
| ss.local2 | s (device 2) | other device still fetches key after device 1 sign-out | 200 new key | HTTP 200, new true | PASS |
| ss.global.db | db | global sign-out rotates org key | changed within 1.5 s | rotated | PASS |
| ss.global.silent | s | open socket after global sign-out (16+ s, 3 pokes sent) | zero data pokes | 0 data pokes in 17 s | PASS |
| ss.global.keeper | k | remaining member rekeys and keeps receiving | receives on new topic | 2 pokes on new topic | PASS |
| ss.tok.api | s (old token) | API GET /me and /realtime/key | 401 / 401 | 401 / 401 | PASS |
| ss.tok.pgrst | s (old token) | PostgREST rpc realtime_topic_key + people read | 401 / 401 | 401 / 401 | PASS |
| ss.tok.rt.old | s (old token) | Realtime join of the pre-signout topic with old token | refused | TIMED_OUT | PASS |
| ss.tok.rt.cur | s (old token) | Realtime join of CURRENT topic (secret not obtainable by the token holder) with old token | refused (defence in depth) or secret unobtainable | SUBSCRIBED | FAIL |
| ss.fresh | s | new login after global sign-out | 200 with current key | HTTP 200, current true | PASS |
| ss.tok.refresh | s | refresh with refresh token revoked by global sign-out | 4xx, no new token | HTTP 400 | PASS |
| ss.global.rot2 | db | global sign-out (single session) rotates org key | changed | rotated | PASS |

The 839 s window is gone: after a global sign-out the open socket received 0 data pokes over 17 s and 3 pokes (the org key rotated within 1.5 s). Deactivation (s21 above) behaves the same.

## 6. Storage HTTP leg of session liveness (W7-JRN-D3; storage.mjs)

Fixture created through the app's own flow: `POST /api/v1/files/upload-intents` (plan attachment, owner `oa`), signed upload to the private `attachments` bucket, `finalize`. Control: the object exists and a live token reads it (200, 70 bytes); the bucket is private (public URL 400).

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| st.intent | oa | POST /files/upload-intents (plan attachment) | 200 + signed upload target | HTTP 201 {"file":{"id":"2e8d977c-8361-432a-93ad-81d4995fdf0f","owner":{"kind":"plan","id":"6ca0dd30-ef1c-46e3-a39c-1167c70bb425"},"plan_id":"6ca0dd30-ef1c-46e3-a39c-1167c70bb425","song_id":null,"kind":"upload" | PASS |
| st.upload | oa | uploadToSignedUrl | ok | ok | PASS |
| st.final | oa | finalize | ready | HTTP 200 ready | PASS |
| st.private | anon | bucket private; public URL refused | bucket public=f; public URL 4xx | public=f; HTTP 400 | PASS |
| st.read.before | oa | GET authenticated object with live token | 200 + bytes | HTTP 200, 70 bytes | PASS |
| st.read.after | oa (old token) | GET authenticated object after global sign-out | 401/400/404, no bytes | HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"} | PASS |
| st.sign.after | oa (old token) | issue a NEW signed URL after sign-out | refused | HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoS | PASS |
| st.list.after | oa (old token) | LIST bucket prefix after sign-out | empty/refused | HTTP 200 0 entries | PASS |
| st.api.after | oa (old token) | POST /files/:id/download after sign-out | 401 | HTTP 401 | PASS |
| st.signed.pre | bearer of pre-issued signed URL | signed URL issued before sign-out (documented residual: works until expiry, 3600 s requested) | HTTP 200 | not measured (documented residual per ADR 0005) | NOT_APPLICABLE |
| st.upload.after | oa (old token) | direct upload with old token | refused | HTTP 400 | PASS |
| st.read.fresh | oa (new login) | GET with fresh token | 200 | HTTP 200 | PASS |
| st.exists | db | object row exists (not a false negative) | 1 | 1 | PASS |

Storage answers 400 with a not-found body (the restrictive `session must be live` policy hides the object) 310 ms after sign-out, for read, new signed-URL issuance, list (0 entries) and upload. A signed URL issued before sign-out was not exercised: ADR 0005 documents it as a residual until expiry.

## Defects

### W9-RT-D1 (P2, hardening) Realtime join policy does not check session liveness
- Repro: log in as `s`, global sign-out (token T is now dead for the API, PostgREST and Storage). Using T as the Realtime access token, join a private topic with the *current* valid keys (taken from another member's API response).
- Expected: refused, like every other surface (ADR 0005 "the session check").
- Actual: `SUBSCRIBED` (sess.mjs `ss.tok.rt.cur`). The token holder cannot learn current topic keys (API `GET /realtime/key` and `POST /realtime/topics` return 401, PostgREST 401), and the pre-sign-out topic is refused, so this needs an independently leaked secret; P2 defence in depth only.
- Source: `supabase/migrations/20261127000700_w8_realtime_resource_revocation.sql:373-420` (`private.can_receive_resource_poke` returns without calling `private.session_live()`; the final `return` at line ~416-418).

No P0 or P1 defects. No leak of private content to a revoked user, no cross-tenant topic or key was issued in any test.

## Not run / blocked

- Signed URL issued before sign-out: not exercised (documented residual, ADR 0005). NOT_APPLICABLE.
- Triggers untested because no such mutation exists as a user path or was outside the listed set: grant UPDATE of `capability` only (trigger is covered by the `team_id` move in s16), `service_type_folders` delete cascade, org role change.
- Realtime reconnect behaviour of a real browser client (token refresh while an old topic is held) was not run: browser is not mine.
- Tests ran with one worker; no load or concurrency of many conversations per transaction (bulk rotation cost) was measured.

## Fixtures left in place

- Orgs `qa-w9-rt-a`, `qa-w9-rt-b`, `qa-w9-rt-c` (C was deleted and recreated by the regression test) with users oa, l, k, u, g, s, kb (A), ob, x, kb (B), oc, c1 (C), all active, legacy access mode, People rows linked and adult.
- Scenario worlds (teams, plans, service types, folders, grants, conversations) were deleted after each scenario; team/plan fixtures from pinned, orgdel, sess and storage runs were deleted too. Leftover rows: `private.conversation_realtime_keys` are cascade-deleted with their conversations; the Storage object under `attachments/` for the deleted plan may remain as an orphan (Storage cleanup is the file-maintenance job's).
- Seed org (aaaaaaaa-...-0001): baseline scripts restored sam and removed their fixtures; sam and riley are active.
