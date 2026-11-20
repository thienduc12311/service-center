# W7-R1 Responses / respond_as_self / assignment-access regression - wave 7 (2026-11-20)

Package W7-R1 (QA-05 / QA-06 subset) from `docs/plans/admin-mobile-test-plan.md`. Owned: RESP-01-04, ACL-05, DELEGATE-01 (response / availability / signup actions), STAFF-01 access boundary, prepared-assignment visibility, retest of every responses/delegation item listed Fixed in `docs/qa/runs/2026-11-17-wave2/SUMMARY.md`.

- Commit: `473fb69` (= main), branch `feature/qa-wave7`, worktree `/Users/nguyen/orca/workspaces/service-center/seal`. No code, migration or config changed.
- Env: local Supabase (migrations through `20261123000000_respond_as_self.sql`), API :4000 (simulated email/push, `DELIVERY_LINK_SECRET` unset), Node 26.13.1. Delivery worker / `/internal/deliveries/run` not run (owned by W7-JOURNEY); immediate in-request delivery (`deliverEffectNow`) was left as the app does it. Browser and native apps not used (browser owned by W7-WEB).
- Namespace: orgs `qa-20261120-resp-a` (Alpha, America/Chicago, id `5972923d-ffda-4ec1-8fc6-f99c5b9378e2`) and `qa-20261120-resp-b` (Beta, id `5d8ed88a-0fc1-4a56-9aec-4730ca588e09`); users `<alias>.qa20261120.resp@example.test`. Passwords stay in the session scratchpad.
- Fixture shape (Alpha): service types Sunday and Midweek; teams Band (Acoustic, Bass, Drums, Electric, Keys) and Production (Sound, Camera) both attached to both service types; people/aliases `owner`, `scoped` (role scheduler, access_mode scoped, `plans.edit` + `scheduling.manage` at service-type scope Sunday), `bandlead` (member; `scheduling.manage` + `teams.manage` at team scope Band), `prodlead` (member; `scheduling.manage` at team scope Production), `pending`, `confirmed`, `declined` (Band members), `delegate`, `dependent` (grantor), `unrelated` (no team), `guest` (Person with no login, Band). Beta: `bowner`, `bmember`, a Sunday type, Band team, one plan with two assignments. Each test created its own plan (`QA resp plan N`, 2027+ dates) with times Rehearsal/09:00/11:00 and its own assignments through the owner's token.
- Method: setup only through service role / SQL (users, orgs, memberships, access grants, known respond-link token hashes because the raw token is never retrievable, one expiry edit). Every feature action and every permission probe used the actor's own bearer token against the API or PostgREST/RPC (`apikey`=anon + caller JWT). Mutations were asserted against response + persisted row + history (`assignment_responses`) + outbox (`delivery_effects`). Races: all requests released from a shared barrier promise from one process over separate HTTP connections and separate user sessions.
- Source vs plan (recorded, not counted as defects): (a) `respond_as_delegate` / `GET /delegations/:id/schedule`: source says view_schedule is implied by can_respond (`docs/plans/mobile-remaining-progress.md:991`); plan oracle says one permission does not imply another. A respond-only grant can read the target's released schedule. (b) `can_signup` has no consumer anywhere in backend routes or RPCs (`claim_signup_opportunity` takes no person), so delegate signup is not an action that exists: NOT_APPLICABLE. (c) The plan expects 404 for out-of-scope writes; the API returns 404 for PATCH/GET/RPC but 403 from `requireCapability` when the caller holds the capability nowhere (e.g. plain member), and 204 for DELETE (D1).

## Result summary

| Status | Count |
|---|---|
| PASS | 432 (430 expanded cases + 2 suite runs) |
| FAIL | 14 (D1 x6, D2 x2, D3, D4 x2 races, D5, D6, carried W2-RESP-D4) |
| BLOCKED | 0 |
| NOT_RUN | 8 groups (see Not run / blocked and Other results) |
| NOT_APPLICABLE | 1 case (+ revoked link, listed below) |

## P0 summary

No P0. No cross-tenant read or write (Beta owner / Beta member got 403 with an Alpha header, 404 or empty with a Beta header on every Alpha object, via API, RPC and PostgREST; the reverse direction likewise). No prepared-assignment exposure (member, delegate, other members, out-of-scope scheduler, other org: 0 rows via API, direct `assignments` / `assignment_time_responses` / `assignment_attendance_times` / `assignment_responses` / `assignment_request_snapshots` reads, RPCs, plan counts, notifications, combined schedule; prepared rows queue no effect or link even with `notify:true`). No unauthorized write (scoped / band-lead / production-lead matrix: 144 action cells, every out-of-scope write denied and every in-scope write landed; forged foreign IDs on every route rejected). No lost write, no overfill, no mixed batch across ~380 real parallel race iterations.

## Other results

| Check | Result |
|---|---|
| `supabase/tests/perf-assignment-access.sql` (begin/rollback, self-contained users, run against the local DB with ON_ERROR_STOP) | exit status 0, PASS |
| `npm exec -w @service-center/backend vitest run src/services/assignment-responses.test.ts` | 30/30 PASS |
| `supabase/tests/assignment-response-history.sql` | NOT_RUN: it selects a riverside seed assignment (Sam, `33333333-...`) and updates it; even rolled back it touches the seed org, which this package may not touch |
| `mob005-snapshots-and-attendance.sql`, `mob005-assignment-removal.sql`, `assignment-notifications-rls.sql` | NOT_RUN: reference seed rows |
| `mob005-concurrent-token.sh` | NOT_RUN: not required; token-vs-signed-in races were run through the real API instead (RESP-04 table) |

Race totals (real separate sessions, barrier release): 20 iterations each of R1a, R1b, R1c, R1d, R2, R3, R4, R5, R6, R7 (3 concurrent copies), R8 (3 concurrent copies) = 220 iterations, plus 36 staggered R3b/R4b iterations that exercised both orders (edit first / respond first) = 256 iterations. Invariants (one valid reviewed scope, no replay or new-scope answer, no mixed batch, history chain consistent with final status, one scheduler effect per transition, no orphan history after removal) held in all of them. The only failures are the retry-status ones in D4.

Respond-path equivalence (RESP-01.equiv.*): `respond_as_self`, a respond link and `respond_as_delegate` produce identical status, `responded_at`, request revision, history rows (previous/new status, trimmed reason) and `scheduler_response` effect (`response_transition` = `response` / `withdrawal`). Attribution differs by design: signed-in = answering login; delegate = delegate login as `actor_id` and `responder_person_id` = the target Person; link = `actor_id` null, `assignee_person_id` = the Person, no reason accepted.

ACL-05 authorized-scope matrix (all PASS; every cell expects allow where the actor's grant covers it, 404 or other 4xx plus unchanged row elsewhere): `scoped` (Sunday): Sunday/Band and Sunday/Production allowed, Midweek/Band and Midweek/Production denied. `bandlead` (Band): Sunday/Band and Midweek/Band allowed, Production cells denied. `prodlead` (Production): Production cells allowed, Band cells denied. Actions per cell: read prepared rows, PATCH released and prepared row, schedule new person, attendance-times edit, release prepared, response-owner change, direct PostgREST PATCH / INSERT / DELETE, direct `schedule_plan_assignments` RPC, DELETE. Only the DELETE status code differs from the plan (D1).

## Result tables

### RESP-01 Grouped / split / signed-in response, path equivalence  (PASS 23, FAIL 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RESP-01.preview.pending.API | pending | API | 200 1 snapshot, 2 assignments | 200  [{"snapshot_id":"cef86679-f2de-4581-94d0-c727b6251c83","version":1,"person_id":"67a35fda-c | PASS |
| RESP-01.preview.scope | pending | API | Acoustic=2 times (rehearsal+09), Bass=1 (11:00) | 200 | PASS |
| RESP-01.preview.unrelated.foreign-id | unrelated | API | 4xx not a snapshot | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-01.preview.otherorg.foreign-id | bowner(B) | API | 404/409 no snapshot | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-01.preview.otherorg.A-header | bowner(B) | API | 403 not member | 403  {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| RESP-01.grouped.commit | pending | API | 200 | 200  {"snapshots":[{"snapshot_id":"cef86679-f2de-4581-94d0-c727b6251c83","assignments_updated": | PASS |
| RESP-01.grouped.persist.Acoustic | pending | DB | confirmed, 1 hist, 1 eff | confirmed [{"tpl":"scheduler_response","st":"confirmed","tr":"response","resp":"9e441d9d-1e42-4970-957e-6a9b90cde20f","rp":"67a35fda-cb17-4b | PASS |
| RESP-01.grouped.persist.Bass | pending | DB | declined, reason private note, 1 hist, 1 eff | declined [{"prev":"unconfirmed","st":"declined","note":"Out of town","actor":"9e441d9d-1e42-4970-957e-6a9b90cde20f","assignee":"67a35fda-cb1 | PASS |
| RESP-01.grouped.unrelated-unchanged | pending | DB | other plan assignment unchanged | unconfirmed | PASS |
| RESP-01.grouped.no-dup-after-replay | pending | DB | hist still 1 | 1 | PASS |
| RESP-01.split.commit | pending | API | 200 | 200  {"snapshots":[{"snapshot_id":"c5a0268d-6707-4738-a401-a56b2f55f99d","assignments_updated": | PASS |
| RESP-01.split.persist | pending | DB | 2 time rows (confirmed+declined), aggregate unconfirmed (documented) | unconfirmed [{"t":"4e48f052-ef43-4b3c-a6cb-aa8cd92bd9cf","st":"confirmed","note":null},{"t":"ce6c4244-97ec-4fa4-87d2-5026a62a8065","st":"dec | PASS |
| RESP-01.partial-scope.missing-time | pending | API | either reject (4xx) or leave other time unanswered; no whole-assignment confirm | 409 {"error":"That change is no longer allowed","code":"conflict"} agg=unconfirmed tr=0 | PASS |
| RESP-01.scope.foreign-time-id | pending | API | 4xx no write | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-01.equiv.confirm.self-vs-token | pending/token | DB | identical status/hist/effect shape | 200 {"st":"confirmed","resp":true,"rev":0,"h":[["unconfirmed","confirmed",null]],"e":[["scheduler_response","confirmed","response"]]} // {"s | PASS |
| RESP-01.equiv.confirm.self-vs-delegate | pending/delegate | DB | identical status/hist/effect shape | 200 {"st":"confirmed","resp":true,"rev":0,"h":[["unconfirmed","confirmed",null]],"e":[["scheduler_response","confirmed","response"]]} // {"s | PASS |
| RESP-01.equiv.confirm.actor-attribution | all | DB | history actor = answering login (self/delegate) ; token actor recorded | 200 self=9e44 tok=null deleg=4879 eff.resp self=9e44 tok=undefined dlg=7164 rp: 67a3/7056/9416 | PASS |
| RESP-01.equiv.decline.self-vs-delegate | pending/delegate | DB | same, reason trimmed "Sick" | 200/200 {"st":"declined","resp":true,"rev":0,"h":[["unconfirmed","declined","Sick"]],"e":[["scheduler_response","declined","response"]]} //  | PASS |
| RESP-01.equiv.decline.token-no-reason | token | DB | declined, note null, same shape otherwise | 200 {"st":"declined","resp":true,"rev":0,"h":[["unconfirmed","declined",null]],"e":[["scheduler_response","declined","response"]]} | PASS |
| RESP-01.respond.unknown-id | pending | API | 404 | 404  {"error":"Assignment not found","code":"not_found"} | PASS |
| RESP-01.direct-own-status-patch.postgrest | declined | RLS-PostgREST | answer recorded same as respond_as_self (history + scheduler effect) | 200 [status=confirmed hist=1 eff=0 rev=0] | FAIL |
| RESP-01.direct-own-notes-position-patch.postgrest | declined | RLS-PostgREST | member cannot change position/notes | 403 [{"code":"42501","details":null,"hint":null,"message":"Only a scheduler can change this assignment"}] | PASS |
| RESP-01.direct-own-reassign-person.postgrest | declined | RLS-PostgREST | member cannot reassign | 403 [{"code":"42501","details":null,"hint":null,"message":"Only a scheduler can change this assignment"}] | PASS |
| RESP-01.direct-own-visibility.postgrest | declined | RLS-PostgREST | member cannot change visibility | 409 [{"code":"PT409","details":null,"hint":null,"message":"A released request cannot be made private again; remove it instead"}] | PASS |
| RESP-01.schedule-mine.volume-boundary | pending | API | GET /schedule/mine returns 200 for a window with >200 assignments | 500 URI too long at ~200 rows (197 rows 200, 380-day window 500) [W7-RESP-D5] | FAIL |

### RESP-02 Withdrawal, reasons, re-accept, response owner, removal  (PASS 22, FAIL 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RESP-02.withdraw.self-vs-delegate | pending/delegate | DB | same: 2 hist rows, 2nd transition=withdrawal, private note | 200/200 {"st":"declined","resp":true,"rev":0,"h":[["unconfirmed","confirmed",null],["confirmed","declined","Cannot make it"]],"e":[["schedul | PASS |
| RESP-02.reaccept-after-decline.self | pending | API | 409 assignment_response_forbidden | 409  {"error":"You declined this position. Ask a scheduler if you can serve after all.","code": | PASS |
| RESP-02.reaccept-after-decline.delegate | delegate | API | 409 forbidden | 409  {"error":"A declined request needs a new scheduler request","code":"assignment_response_fo | PASS |
| RESP-02.reaccept.no-write | pending | DB | history count unchanged (2) | 2 | PASS |
| RESP-02.repeat-same-answer.unchanged | pending | API | 200 unchanged; no hist/eff growth | 200 | PASS |
| RESP-02.stale-expected.self | pending | API | 409 assignment_response_stale w/ status | 409  {"error":"This assignment changed since you opened it. Refresh and review it again.","code | PASS |
| RESP-02.stale-expected.delegate | delegate | API | 409 stale | 409  {"error":"This assignment changed since you opened it. Refresh and review it again.","code | PASS |
| RESP-02.reason-with-confirm | pending | API | 422 | 422  {"error":"Invalid request body","code":"unprocessable","details":[{"path":"reason","code": | PASS |
| RESP-02.reason-501 | pending | API | 422 | 422  {"error":"Invalid request body","code":"unprocessable","details":[{"path":"reason","code": | PASS |
| RESP-02.status-unconfirmed | pending | API | 422 | 422  {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code": | PASS |
| RESP-02.blank-reason-stored-as-null | pending | DB | declined, note null | 200 [{"prev":"unconfirmed","st":"declined","note":null,"actor":"9e441d9d-1e42-4970-957e-6a9b90cde20f","assignee":"67a35fda-cb17-4b1a-82a3-86 | PASS |
| RESP-02.direct-reaccept-after-decline.postgrest | declined | RLS-PostgREST | denied (declined never re-accepted by assignee) | 409 status=declined hist=1 eff=0 | PASS |
| RESP-02.direct-withdrawal.postgrest | confirmed | RLS-PostgREST | withdrawal records scheduler update (effect) like respond_as_self | 200 status=declined hist=2 eff before=1 after=1 | FAIL |
| RESP-02.removal-invalidates-old-link.respond | anon | API | 4xx (not 200 updating 0 rows as success) | 409 {"error":"This request changed. Refresh or ask your scheduler for a new link.","code":"ass | PASS |
| RESP-02.removal-invalidates-old-link.preview | anon | API | 4xx | 409 {"error":"This request changed. Refresh or ask your scheduler for a new link.","code":"ass | PASS |
| RESP-02.removal-invalidates-review.commit | pending | API | 4xx | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-02.response-owner.set.owner->bandlead | owner | API | 200; bandlead schedules Band | 200 | PASS |
| RESP-02.response-owner.history | owner | API | 1 audit row | 200 | PASS |
| RESP-02.response-owner.set.non-scheduler | owner | API | 4xx unchanged | 400 {"error":"The new owner does not schedule those requests","c | PASS |
| RESP-02.response-owner.set.wrong-team-scheduler | owner | API | 4xx unchanged | 400 {"error":"The new owner does not schedule those requests","c | PASS |
| RESP-02.response-owner.set.member-self | pending | API | 403 | 403 | PASS |
| RESP-02.response-owner.set.other-org-user | owner | API | 4xx unchanged | 400 {"error":"The new owner does not schedule those requests","c | PASS |
| RESP-02.response-owner.history.member-denied | pending | API | 403 | 403 | PASS |
| RESP-02.scope-change.confirmed-carryover | pending + owner | API+DB | time edit does not leave an answer counting for an unreviewed scope | status stays confirmed, rev+1, time_responses only for removed times (sequential and respond-first race) [W7-RESP-D6, needs product decision] | FAIL |

### RESP-03 Respond link (anonymous), stale snapshot, new-scope  (PASS 19, FAIL 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RESP-03.stale.consumed-snapshot-new-key | pending | API | 409 stale | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-03.stale.wrong-version | pending | API | 409 | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-03.scope.answer-for-assignment-not-in-snapshot | pending | API | 4xx, other unchanged | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| RESP-03.preview.valid.guest.anon | anon | API | 200 minimal fields only | 200 assignments,expires_at,location,person_first_name,plan_title,preferred_language,service_date,service_time,snapshot_id,snapshot_version | PASS |
| RESP-03.preview.min-disclosure | anon | API | no email/last name/person_id/org id/notes/other people/token hash | 200 {"snapshot_id":"1f754a7f-d9ae-4b9a-a327-3fe932439fdb","snapshot_version":1,"plan_title":"QA resp plan 405","service_date":"2028-02-10T15 | PASS |
| RESP-03.preview.malformed-token | anon | API | 404 | 404 {"error":"That assignment response link is not valid","code":"not_found"} | PASS |
| RESP-03.preview.huge-token | anon | API | 404 | 404 {"error":"That assignment response link is not valid","code":"not_found"} | PASS |
| RESP-03.respond.extra-reason-field | anon | API | reason ignored or 422 (link carries only answer) | 200 [{"status":"confirmed","assignments_updated":1}] | PASS |
| RESP-03.respond.valid.guest | anon | DB | status confirmed, 1 hist, actor null, assignee=guest person, 1 eff, link consumed | 200 {"prev":"unconfirmed","st":"confirmed","note":null,"actor":null,"assignee":"5e2b8ac7-516f-492b-8fda-b51c1d1ef812"} | PASS |
| RESP-03.respond.consumed-replay | anon | API | 410 used, unchanged | 410 {"error":"This assignment response link has already been used","code":"assignment_notifica | PASS |
| RESP-03.preview.consumed | anon | API | 410 | 410 {"error":"This assignment response link has already been used","code":"assignment_notifica | PASS |
| RESP-03.preview.expired | anon | API | 410 expired | 410 {"error":"This assignment response link has expired","code":"assignment_notification_expir | PASS |
| RESP-03.respond.expired | anon | API | 410 expired no write | 410 {"error":"This assignment response link has expired","code":"assignment_notification_expir | PASS |
| RESP-03.respond.invalid-body.{} | anon | API | 422 no write | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code": | PASS |
| RESP-03.respond.invalid-body.{"status":"unconfirmed"} | anon | API | 422 no write | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code": | PASS |
| RESP-03.respond.invalid-body.{"status":"maybe"} | anon | API | 422 no write | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code": | PASS |
| RESP-03.respond.invalid-body."x" | anon | API | 422 no write | 500 {"error":"Unexpected token '\"', \"\"x\"\" is not valid JSON","code":"internal_error"} | FAIL |
| RESP-03.new-assignment-after-link.never-answered | anon | API+DB | new (unreviewed) assignment stays unconfirmed; old one either answered or stale | 200 resp=200 old=confirmed new=unconfirmed body={"status":"confirmed","assignments_updated":1} | PASS |
| RESP-03.stale-after-time-edit.respond | anon | API | 409 assignment_request_stale, unchanged | 409 {"error":"This request changed. Refresh or ask your scheduler for a ne | PASS |
| W2-RESP-D4.retest.preview-stale-vs-respond | anon | API | preview should be stale (409) like respond | 200 preview=200 times shown=["cf0a","3659","1894"] | FAIL |
| RESP-03.stale-after-position-change.commit | pending | API | observe: reviewed position Acoustic, now Bass; commit result | 409 [patch=200 commit=409 status=unconfirmed rev=1] | PASS |

### RESP-04 Races (real concurrent sessions)  (PASS 12, FAIL 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RESP-04.race.R1a | pending + anon token | API real parallel x20 | token confirm vs self decline (no expected_status): history chain consistent, 1 effect per transition, >=1 winner | 200/200->declined x19; 200/409->confirmed x1 | PASS |
| RESP-04.race.R1b | pending + anon token | API real parallel x20 | token confirm vs self decline expected=unconfirmed: self never lands on a changed state | 200/409->confirmed x20 | PASS |
| RESP-04.race.R1c | pending + anon token | API real parallel x20 | token confirm vs self confirm: final confirmed, exactly 1 history row, 1 effect | 200/200->confirmed x20 | PASS |
| RESP-04.race.R1d | anon x2 | API real parallel x20 | same link double submit: one 200, one 410; 1 history, 1 effect | 410/200 x12; 200/410 x8 | PASS |
| RESP-04.race.R2 | dependent self + delegate | API real parallel x20 | self confirm vs delegate decline (both expected=unconfirmed): one winner, 1 history, 1 effect | 200/409->confirmed x20 | PASS |
| RESP-04.race.R3 | pending + owner | API real parallel x20 | reviewed-snapshot commit vs scheduler time edit: never an answer on the new time; answer rows == reviewed scope | commit 200 edit 200 -> status=confirmed trOld=2 trNew=0 mode=selected x20 | PASS |
| RESP-04.race.R3b/R4b | pending/anon + owner | API real parallel x36, staggered 0-125 ms so both orders occur | respond-first: answer on reviewed scope, edit lands after; edit-first: 409, no history | commit: act 200 edit 200 -> status=confirmed hist=1 trOld=2 trNew=0 x12; token: act 200 edit 200 -> status=confirmed hist=1 trOld=2 trNew=0  | PASS |
| RESP-04.race.R4 | anon token + owner | API real parallel x20 | token confirm vs time edit: 200 => 1 history; 409 => 0 history | token 200 edit 200 -> status=confirmed rev=5 x20 | PASS |
| RESP-04.race.R5 | pending + owner | API real parallel x20 | respond vs scheduler removal: row gone, no orphan history, no 500 | 409/204 exists=0 hist=0 x20 | PASS |
| RESP-04.race.R6 | pending (2 devices) | API real parallel x20 | same snapshot, device A confirm vs B decline: exactly one commit, no mixed answers, 1 effect | 200/409->confirmed x7; 409/200->declined x13 | PASS |
| RESP-04.race.R7.safe | pending | API real parallel x20 (3 requests each) | commit same key x3: exactly 1 history row, 1 effect | 200/409/409 x20 | PASS |
| RESP-04.race.R7.replay | pending | API real parallel x20 | commit same key x3: every copy returns the stored result (200) | 200/409/409 x20 (200/409/409) | FAIL |
| RESP-04.race.R8.safe | pending | API real parallel x20 (3 requests each) | respond_as_self same answer x3: exactly 1 history row, 1 effect | 200/409/409 x20 | PASS |
| RESP-04.race.R8.replay | pending | API real parallel x20 | respond_as_self same answer x3: losers see unchanged/200 (migration header contract) | 200/409/409 x20 (200/409/409) | FAIL |

### ACL-05 Scoped scheduler / band-lead / production-lead boundary (STAFF-01 access boundary), forged and other-org IDs  (PASS 175, FAIL 6)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-05.commit.foreign-snapshot.unrelated | unrelated | API | 404/409 not 200 | 404  {"error":"Response snapshot not found","code":"not_found"} | PASS |
| ACL-05.commit.foreign-snapshot.owner(scheduler) | owner | API | 404/409 owner cannot answer for member | 404  {"error":"Response snapshot not found","code":"not_found"} | PASS |
| ACL-05.respond.unrelated-on-others | unrelated | API | 403/404 no write | 403  {"error":"You can only respond to your own assignments","code":"forbidden"} | PASS |
| ACL-05.respond.owner-on-members | owner | API | 403/404 no write | 403  {"error":"You can only respond to your own assignments","code":"forbidden"} | PASS |
| ACL-05.respond.otherorg-user-own-org | bowner(B) | API | 404 | 404  {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.respond.otherorg-user-A-header | bowner(B) | API | 403 | 403  {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| ACL-05.respond.anon | anon | API | 401 | 401  {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| ACL-05.read-prepared.scoped.SB | scoped | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.scoped.SB | scoped | API | 200 | 200 {"id":"e5ce24ea-82a4-4ca4-88a0-58ae2c8cda03","plan_id":"1f65 | PASS |
| ACL-05.patch-prepared.scoped.SB | scoped | API | 200 | 200 {"id":"93775d6e-ac84-4669-98cf-46119c801d59","plan_id":"1f65 | PASS |
| ACL-05.schedule.scoped.SB | scoped | API | 201 +1 row | 201 {"created":[{"id":"a94ed1d5-49b6-40da-bc72-43a3a1efbc4b","plan_id":"1f | PASS |
| ACL-05.assignment-times.scoped.SB | scoped | API | 200 | 200 {"updated":[{"id":"93775d6e-ac84-4669-98cf-46119c801d59","plan_id":"1f | PASS |
| ACL-05.release.scoped.SB | scoped | API | 200 released | 200 {"released":[{"id":"389ca100-454c-46bd-af31-b20258f05d08","plan_id":"1 | PASS |
| ACL-05.response-owner.scoped.SB | scoped | API | 200 | 200 owner now 5f9f [{"id":"ace0199b-2db2-4ca4-afe4-d26b980f41f0","pla | PASS |
| ACL-05.direct-patch.scoped.SB | scoped | RLS-PostgREST | row updated | 200 [{"id":"ace0199b-2db2-4ca4-afe4-d26b980f41f0","plan_id":"1f6 | PASS |
| ACL-05.direct-insert.scoped.SB | scoped | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"89a03e0f-a4d0-4af0-9266-0c2a24a0c6a0","plan_id":"1f6 | PASS |
| ACL-05.direct-delete.scoped.SB | scoped | RLS-PostgREST | row deleted | 200 [{"id":"389ca100-454c-46bd-af31-b20258f05d08","plan_id":"1f6 | PASS |
| ACL-05.rpc-schedule.scoped.SB | scoped | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.scoped.SB | scoped | API | 204 gone | 204 "" | PASS |
| ACL-05.read-prepared.scoped.SP | scoped | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.scoped.SP | scoped | API | 200 | 200 {"id":"ac203896-371b-433c-af10-2a35a4ab9acb","plan_id":"175a | PASS |
| ACL-05.patch-prepared.scoped.SP | scoped | API | 200 | 200 {"id":"97bf0424-506c-4d6a-8afc-a7b6d5351adf","plan_id":"175a | PASS |
| ACL-05.schedule.scoped.SP | scoped | API | 201 +1 row | 201 {"created":[{"id":"185aaeeb-5782-4da3-a295-e57c7507f9b0","plan_id":"17 | PASS |
| ACL-05.assignment-times.scoped.SP | scoped | API | 200 | 200 {"updated":[{"id":"97bf0424-506c-4d6a-8afc-a7b6d5351adf","plan_id":"17 | PASS |
| ACL-05.release.scoped.SP | scoped | API | 200 released | 200 {"released":[{"id":"29157d9a-90c0-42ee-ae1a-040a5a88562e","plan_id":"1 | PASS |
| ACL-05.response-owner.scoped.SP | scoped | API | 200 | 200 owner now 5f9f [{"id":"7cc993b3-8220-4c4d-b3d8-4577b6fe10aa","pla | PASS |
| ACL-05.direct-patch.scoped.SP | scoped | RLS-PostgREST | row updated | 200 [{"id":"7cc993b3-8220-4c4d-b3d8-4577b6fe10aa","plan_id":"175 | PASS |
| ACL-05.direct-insert.scoped.SP | scoped | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"db70103f-381d-4620-8474-2877c2430278","plan_id":"175 | PASS |
| ACL-05.direct-delete.scoped.SP | scoped | RLS-PostgREST | row deleted | 200 [{"id":"29157d9a-90c0-42ee-ae1a-040a5a88562e","plan_id":"175 | PASS |
| ACL-05.rpc-schedule.scoped.SP | scoped | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.scoped.SP | scoped | API | 204 gone | 204 "" | PASS |
| ACL-05.read-prepared.scoped.MB | scoped | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.scoped.MB | scoped | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.scoped.MB | scoped | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.scoped.MB | scoped | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.scoped.MB | scoped | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.scoped.MB | scoped | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.scoped.MB | scoped | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.scoped.MB | scoped | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.scoped.MB | scoped | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.scoped.MB | scoped | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.scoped.MB | scoped | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.scoped.MB | scoped | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.scoped.MP | scoped | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.scoped.MP | scoped | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.scoped.MP | scoped | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.scoped.MP | scoped | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.scoped.MP | scoped | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.scoped.MP | scoped | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.scoped.MP | scoped | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.scoped.MP | scoped | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.scoped.MP | scoped | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.scoped.MP | scoped | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.scoped.MP | scoped | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.scoped.MP | scoped | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.bandlead.SB | bandlead | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.bandlead.SB | bandlead | API | 200 | 200 {"id":"f424cdb3-171a-4dad-8308-33fee1cfe03d","plan_id":"d277 | PASS |
| ACL-05.patch-prepared.bandlead.SB | bandlead | API | 200 | 200 {"id":"386eecb2-5917-493f-b493-c5d0a24ef120","plan_id":"d277 | PASS |
| ACL-05.schedule.bandlead.SB | bandlead | API | 201 +1 row | 201 {"created":[{"id":"524a5a68-2a73-4ccc-9bc3-f1ee0d489e39","plan_id":"d2 | PASS |
| ACL-05.assignment-times.bandlead.SB | bandlead | API | 200 | 200 {"updated":[{"id":"386eecb2-5917-493f-b493-c5d0a24ef120","plan_id":"d2 | PASS |
| ACL-05.release.bandlead.SB | bandlead | API | 200 released | 200 {"released":[{"id":"6e18046a-571e-45f4-a11e-baf6705ace35","plan_id":"d | PASS |
| ACL-05.response-owner.bandlead.SB | bandlead | API | 200 | 200 owner now 5f9f [{"id":"6efd9dd4-4b6e-40c8-acd2-d09994eec25f","pla | PASS |
| ACL-05.direct-patch.bandlead.SB | bandlead | RLS-PostgREST | row updated | 200 [{"id":"6efd9dd4-4b6e-40c8-acd2-d09994eec25f","plan_id":"d27 | PASS |
| ACL-05.direct-insert.bandlead.SB | bandlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"f38ddc37-6f4c-4cf9-9c1c-3a5c50b6c401","plan_id":"d27 | PASS |
| ACL-05.direct-delete.bandlead.SB | bandlead | RLS-PostgREST | row deleted | 200 [{"id":"6e18046a-571e-45f4-a11e-baf6705ace35","plan_id":"d27 | PASS |
| ACL-05.rpc-schedule.bandlead.SB | bandlead | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.bandlead.SB | bandlead | API | 204 gone | 204 "" | PASS |
| ACL-05.read-prepared.bandlead.SP | bandlead | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.bandlead.SP | bandlead | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.bandlead.SP | bandlead | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.bandlead.SP | bandlead | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.bandlead.SP | bandlead | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.bandlead.SP | bandlead | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.bandlead.SP | bandlead | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.bandlead.SP | bandlead | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.bandlead.SP | bandlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.bandlead.SP | bandlead | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.bandlead.SP | bandlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.bandlead.SP | bandlead | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.bandlead.MB | bandlead | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.bandlead.MB | bandlead | API | 200 | 200 {"id":"abd72fa2-ed74-465f-8dc4-5687b5b1c0a1","plan_id":"747b | PASS |
| ACL-05.patch-prepared.bandlead.MB | bandlead | API | 200 | 200 {"id":"cce43598-f858-494d-ba63-3a51cb8cdd0f","plan_id":"747b | PASS |
| ACL-05.schedule.bandlead.MB | bandlead | API | 201 +1 row | 201 {"created":[{"id":"703ab3b9-511a-4251-8bd9-5628b3aaa851","plan_id":"74 | PASS |
| ACL-05.assignment-times.bandlead.MB | bandlead | API | 200 | 200 {"updated":[{"id":"cce43598-f858-494d-ba63-3a51cb8cdd0f","plan_id":"74 | PASS |
| ACL-05.release.bandlead.MB | bandlead | API | 200 released | 200 {"released":[{"id":"5792857e-ff35-4afb-879d-59b447e6b033","plan_id":"7 | PASS |
| ACL-05.response-owner.bandlead.MB | bandlead | API | 200 | 200 owner now 5f9f [{"id":"9c4afeb4-f6be-475f-ab4b-d9298ad5f2e9","pla | PASS |
| ACL-05.direct-patch.bandlead.MB | bandlead | RLS-PostgREST | row updated | 200 [{"id":"9c4afeb4-f6be-475f-ab4b-d9298ad5f2e9","plan_id":"747 | PASS |
| ACL-05.direct-insert.bandlead.MB | bandlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"cb86c5c6-cb47-424b-b8bd-989b99188e43","plan_id":"747 | PASS |
| ACL-05.direct-delete.bandlead.MB | bandlead | RLS-PostgREST | row deleted | 200 [{"id":"5792857e-ff35-4afb-879d-59b447e6b033","plan_id":"747 | PASS |
| ACL-05.rpc-schedule.bandlead.MB | bandlead | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.bandlead.MB | bandlead | API | 204 gone | 204 "" | PASS |
| ACL-05.read-prepared.bandlead.MP | bandlead | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.bandlead.MP | bandlead | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.bandlead.MP | bandlead | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.bandlead.MP | bandlead | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.bandlead.MP | bandlead | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.bandlead.MP | bandlead | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.bandlead.MP | bandlead | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.bandlead.MP | bandlead | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.bandlead.MP | bandlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.bandlead.MP | bandlead | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.bandlead.MP | bandlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.bandlead.MP | bandlead | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.prodlead.SB | prodlead | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.prodlead.SB | prodlead | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.prodlead.SB | prodlead | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.prodlead.SB | prodlead | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.prodlead.SB | prodlead | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.prodlead.SB | prodlead | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.prodlead.SB | prodlead | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.prodlead.SB | prodlead | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.prodlead.SB | prodlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.prodlead.SB | prodlead | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.prodlead.SB | prodlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.prodlead.SB | prodlead | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.prodlead.SP | prodlead | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.prodlead.SP | prodlead | API | 200 | 200 {"id":"fbe69e2b-f9c6-44ba-a6ed-2b6c8d7ffc1d","plan_id":"6ecb | PASS |
| ACL-05.patch-prepared.prodlead.SP | prodlead | API | 200 | 200 {"id":"18ea04c2-50c8-4249-b6b8-44b7ac3fe3c8","plan_id":"6ecb | PASS |
| ACL-05.schedule.prodlead.SP | prodlead | API | 201 +1 row | 201 {"created":[{"id":"1b9be88d-66bc-4fef-af4d-8566483b4a64","plan_id":"6e | PASS |
| ACL-05.assignment-times.prodlead.SP | prodlead | API | 200 | 200 {"updated":[{"id":"18ea04c2-50c8-4249-b6b8-44b7ac3fe3c8","plan_id":"6e | PASS |
| ACL-05.release.prodlead.SP | prodlead | API | 200 released | 200 {"released":[{"id":"12033e49-fe6b-4c20-8678-0c43a75e7861","plan_id":"6 | PASS |
| ACL-05.response-owner.prodlead.SP | prodlead | API | 200 | 200 owner now 5f9f [{"id":"456e0db7-1980-4c9e-8b8d-482a626c3436","pla | PASS |
| ACL-05.direct-patch.prodlead.SP | prodlead | RLS-PostgREST | row updated | 200 [{"id":"456e0db7-1980-4c9e-8b8d-482a626c3436","plan_id":"6ec | PASS |
| ACL-05.direct-insert.prodlead.SP | prodlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"a0ec7fe3-e8de-491e-b70d-2d1c57dcbb2d","plan_id":"6ec | PASS |
| ACL-05.direct-delete.prodlead.SP | prodlead | RLS-PostgREST | row deleted | 200 [{"id":"12033e49-fe6b-4c20-8678-0c43a75e7861","plan_id":"6ec | PASS |
| ACL-05.rpc-schedule.prodlead.SP | prodlead | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.prodlead.SP | prodlead | API | 204 gone | 204 "" | PASS |
| ACL-05.read-prepared.prodlead.MB | prodlead | RLS-PostgREST | 0 rows (prepared hidden outside scope) | 200 rows=0 | PASS |
| ACL-05.patch-assignment.prodlead.MB | prodlead | API | 404 (RLS) no change | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.patch-prepared.prodlead.MB | prodlead | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| ACL-05.schedule.prodlead.MB | prodlead | API | 4xx no new row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| ACL-05.assignment-times.prodlead.MB | prodlead | API | 4xx, mode unchanged | 400 {"error":"Some requests or times are not on this plan","code":"bad_req | PASS |
| ACL-05.release.prodlead.MB | prodlead | API | 4xx still prepared | 409 {"error":"Prepared requests changed since the release review","code":" | PASS |
| ACL-05.response-owner.prodlead.MB | prodlead | API | 4xx no change | 404 owner now 5f9f {"error":"Assignment not found","code":"not_found" | PASS |
| ACL-05.direct-patch.prodlead.MB | prodlead | RLS-PostgREST | 0 rows/denied no change | 200 [] | PASS |
| ACL-05.direct-insert.prodlead.MB | prodlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-05.direct-delete.prodlead.MB | prodlead | RLS-PostgREST | no row deleted | 200 [] | PASS |
| ACL-05.rpc-schedule.prodlead.MB | prodlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS |
| ACL-05.delete-assignment.prodlead.MB | prodlead | API | 404 still exists | 204 "" | FAIL |
| ACL-05.read-prepared.prodlead.MP | prodlead | RLS-PostgREST | 2 prepared rows visible | 200 rows=2 | PASS |
| ACL-05.patch-assignment.prodlead.MP | prodlead | API | 200 | 200 {"id":"13677f21-3dbb-4f19-8697-9f08f99fd290","plan_id":"99eb | PASS |
| ACL-05.patch-prepared.prodlead.MP | prodlead | API | 200 | 200 {"id":"35cb6460-5241-4632-b7bb-c158d597f53f","plan_id":"99eb | PASS |
| ACL-05.schedule.prodlead.MP | prodlead | API | 201 +1 row | 201 {"created":[{"id":"2b93ffda-b3cd-40d8-ad7f-df51ebfb4097","plan_id":"99 | PASS |
| ACL-05.assignment-times.prodlead.MP | prodlead | API | 200 | 200 {"updated":[{"id":"35cb6460-5241-4632-b7bb-c158d597f53f","plan_id":"99 | PASS |
| ACL-05.release.prodlead.MP | prodlead | API | 200 released | 200 {"released":[{"id":"0b0c28e9-fb47-4551-87d4-a5765003f241","plan_id":"9 | PASS |
| ACL-05.response-owner.prodlead.MP | prodlead | API | 200 | 200 owner now 5f9f [{"id":"032016a5-6ec4-4880-a908-bf9e33c678a6","pla | PASS |
| ACL-05.direct-patch.prodlead.MP | prodlead | RLS-PostgREST | row updated | 200 [{"id":"032016a5-6ec4-4880-a908-bf9e33c678a6","plan_id":"99e | PASS |
| ACL-05.direct-insert.prodlead.MP | prodlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 [{"id":"f193c1df-34fb-4c21-b648-1c2dd99ee30b","plan_id":"99e | PASS |
| ACL-05.direct-delete.prodlead.MP | prodlead | RLS-PostgREST | row deleted | 200 [{"id":"0b0c28e9-fb47-4551-87d4-a5765003f241","plan_id":"99e | PASS |
| ACL-05.rpc-schedule.prodlead.MP | prodlead | RPC | ok | 200 rows=1 [] | PASS |
| ACL-05.delete-assignment.prodlead.MP | prodlead | API | 204 gone | 204 "" | PASS |
| ACL-05.delete-assignment.scoped.MB.persisted | scoped | API+DB | row still exists after denied delete | 204 status 204 exists=1 | PASS |
| ACL-05.forged-other-org.patch.scoped(A hdr) | scoped | API | 404 | 404 | PASS |
| ACL-05.forged-other-org.patch.scoped(B hdr, non-member) | scoped | API | 403 not a member | 403 | PASS |
| ACL-05.forged-other-org-plan.schedule.scoped | scoped | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| ACL-05.forged-other-org-team+person.schedule.scoped | scoped | API | 4xx no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-05.forged-other-org-person.schedule.owner | owner | API | 4xx no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-05.forged-other-org-team.schedule.owner | owner | API | 4xx no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-05.forged-other-org-position.schedule.owner | owner | API | 4xx | 400 {"error":"Some People, teams, positions or times do not belo | PASS |
| ACL-05.position-of-other-team.schedule.owner | owner | API | 4xx | 400 {"error":"Some People, teams, positions or times do not belo | PASS |
| ACL-05.forged-other-org.release.scoped | scoped | API | 409/404 no release | 409 | PASS |
| ACL-05.forged-A-assignment.release.beta-owner | bowner | API | 409/404 no release | 409 | PASS |
| ACL-05.forged-other-org.times.scoped | scoped | API | 4xx | 400 | PASS |
| ACL-05.forged-A-assignment.response-owner.beta-owner | bowner | API | 4xx unchanged | 404 | PASS |
| ACL-05.rpc.respond_as_self.otherorg | bowner | RPC | error no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Assign | PASS |
| ACL-05.forged-midweek-id-on-sunday-url.times.scoped | scoped | API | 4xx unchanged | 400 {"error":"Some requests or times are not on this plan","code | PASS |
| ACL-05.mixed-batch-release.scoped(Sunday+Midweek ids on Sunday url) | scoped | API | 4xx atomic: neither released | 409 {"error":"Prepared requests changed since the release review | PASS |
| ACL-05.release.midweek-url.scoped | scoped | API | 4xx still prepared | 409 | PASS |
| ACL-05.release-preview.midweek.scoped | scoped | API | 409/404 no details (prepared hidden) | 409 {"error":"Prepared requests changed. Refresh the release rev | PASS |
| ACL-05.release-preview.sunday.scoped | scoped | API | 200 | 200 | PASS |
| ACL-05.release-preview.midweek-id-on-sunday-url.scoped | scoped | API | 409/404 | 409 {"error":"Prepared requests changed. Refresh the release rev | PASS |
| ACL-05.conflict-check.midweek-plan.scoped | scoped | API | info only | 200 [{"conflicts":[{"candidate_key":"67a35fda-cb17-4b1a-82a3-8612807197b7:52efe556-4d9f-4697-adf1-264a8df] | PASS |
| ACL-05.bandlead.schedule-production-team | bandlead | API | 4xx no row | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| ACL-05.plans-edit.midweek.scoped | scoped | API | 404/403, unchanged | 404 | PASS |
| ACL-05.plans-edit.sunday.scoped | scoped | API | 200 | 200 | PASS |
| ACL-05.revoked-mid-session.patch.scoped | scoped | API | denied immediately, unchanged | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| ACL-05.revoked-mid-session.read-prepared.scoped | scoped | RLS-PostgREST | 0 rows | 200 | PASS |
| ACL-05.regrant.patch.scoped | scoped | API | 200 | 200 | PASS |
| ACL-05.member.schedule | pending | API | 403 | 403 | PASS |
| ACL-05.member.patch-others | pending | API | 403 | 403 | PASS |
| ACL-05.anon.patch | anon | API | 401 | 401 | PASS |

### DELEGATE-01 Delegation: respond / availability / signup (view)  (PASS 31, NOT_APPLICABLE 1)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELEGATE-01.grant.dependent.respond-only | dependent | API | 201 | 201  {"id":"06590fdf-7407-48ec-ac54-74842497a25f","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.other-person-assignment | delegate | API | 4xx, assignment unchanged | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.respond.unrelated-uses-others-delegation-id | unrelated | API | 404 | 404  {"error":"Delegation not found","code":"not_found"} | PASS |
| DELEGATE-01.respond.grantor-uses-own-grant(sent direction) | dependent | API | 404 (not received) | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.respond.otherorg | bowner(B) | API | 404 | 404  {"error":"Delegation not found","code":"not_found"} | PASS |
| DELEGATE-01.schedule.respond-only | delegate | API | 403/404 (no view grant) | 200  {"delegation":{"id":"06590fdf-7407-48ec-ac54-74842497a25f","direction":"received","target_ [documented contract: respond implies view_schedule (docs/plans/mobile-remaining-progress.md:991); plan oracle says "one permission does not imply another" - see Source vs plan] | PASS |
| DELEGATE-01.revoke | dependent | API | 200 | 200  {"id":"06590fdf-7407-48ec-ac54-74842497a25f","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.after-revoke.fresh | delegate | API | 4xx and unchanged | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.grant.respond-only | dependent | API | 201 | 201  {"id":"714c71ab-3e2a-463c-9d7d-dd2ddb51425c","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.respond-only | delegate | API | 200 | 200  {"assignment_id":"ad871b6b-d45a-4986-9752-75f71119ea8e","status":"confirmed","transition": | PASS |
| DELEGATE-01.availability-create.respond-only | delegate | API | 4xx no row | 403  rows=0 {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.schedule-view.respond-only | delegate | API | view or respond grants allow | 200 [status 200 (source: respond implies view)] | PASS |
| DELEGATE-01.availability-create.unrelated.respond | unrelated | API | 403/404 | 403  {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.grant.availability-only | dependent | API | 201 | 201  {"id":"22b917d4-750c-48e1-95a0-c155fe3c29d3","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.availability-only | delegate | API | 4xx no write | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.availability-create.availability-only | delegate | API | 201 | 201  rows=1 {"blockout":{"id":"65fc908f-776c-445c-9e92-0a9d5165d147","organization_id":"5972923d-ffda- | PASS |
| DELEGATE-01.schedule-view.availability-only | delegate | API | view or respond grants allow | 404 [status 404 (source: respond implies view)] | PASS |
| DELEGATE-01.availability-create.unrelated.availability | unrelated | API | 403/404 | 403  {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.grant.view-only | dependent | API | 201 | 201  {"id":"53c01c58-7ec4-46c9-8368-935e338a0bf4","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.view-only | delegate | API | 4xx no write | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.availability-create.view-only | delegate | API | 4xx no row | 403  rows=1 {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.schedule-view.view-only | delegate | API | view or respond grants allow | 200 [status 200 (source: respond implies view)] | PASS |
| DELEGATE-01.availability-create.unrelated.view | unrelated | API | 403/404 | 403  {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.grant.signup-only | dependent | API | 201 | 201  {"id":"6313a3f8-5bda-43a2-b352-ec9345ef528f","direction":"given","target_person_id":"94168 | PASS |
| DELEGATE-01.respond.signup-only | delegate | API | 4xx no write | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.availability-create.signup-only | delegate | API | 4xx no row | 403  rows=1 {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.schedule-view.signup-only | delegate | API | view or respond grants allow | 404 [status 404 (source: respond implies view)] | PASS |
| DELEGATE-01.availability-create.unrelated.signup | unrelated | API | 403/404 | 403  {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.availability-create.forged-other-person | delegate | API | 403/404 | 403  {"error":"Only schedulers or someone they asked to help can change another person’s availa | PASS |
| DELEGATE-01.availability-create.forged-other-org-person | delegate | API | 403/404 | 404  {"error":"Person not found","code":"not_found"} | PASS |
| DELEGATE-01.respond.expired-grant | delegate | API | 4xx no write | 404  {"error":"Request not found","code":"not_found"} | PASS |
| DELEGATE-01.signup-by-delegate | delegate | API | delegate signup action | source: can_signup has no consumer (claim_signup_opportunity takes no person) [grep: no backend route/RPC uses can_signup beyond grant/list] | NOT_APPLICABLE |

### PREP Prepared (unreleased) assignment visibility  (PASS 66)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PREP.setup | owner | API | 3 prepared rows, no notification effect/link | 201 effects=0 links=0 | PASS |
| PREP.notify-true-on-prepared.no-effect | owner | DB | notify:true must not queue anything for prepared | 0 | PASS |
| PREP.schedule-mine.pending | pending | API | 200 without prepared | 200  [{"assignment":{"id":"4d9e0c9c-7770-4342-befd-6dcefc47146a","plan_id":"1704fc98-e0ea-4ea1- | PASS |
| PREP.schedule-mine.dependent | dependent | API | without prepared | 200  [{"assignment":{"id":"da5b2e7a-3638-4f37-b591-f5f20f80e305","plan_id":"f0a4d566-4211-401c- | PASS |
| PREP.delegated-schedule.delegate | delegate | API | no prepared | 200  {"delegation":{"id":"f8c0a2de-ecfc-4137-8ab7-87f68f3cf5ef","direction":"received","target_ | PASS |
| PREP.delegate-respond.prepared | delegate | API | 404/409 no write | 404  {"error":"Request not found","code":"not_found"} | PASS |
| PREP.respond-self.prepared | pending | API | 404 no write (hidden) | 404  {"error":"Assignment not found","code":"not_found"} | PASS |
| PREP.snapshot-preview.prepared | pending | API | no snapshot (4xx/empty) | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| PREP.plan-schedule.pending | pending | API | no prepared rows / counts | 200  len=603 {"content_revision":5,"selected":{"time_id":"7317a749-af87-439f-a47e-8cb20ab0b2ae","servic | PASS |
| PREP.plan-detail.pending | pending | API | no prepared leak | 200  {"id":"27f98a6e-7910-4438-8f8c-96e48ad50bcc","organization_id":"5972923d-ffda-4ec1-8fc6-f9 | PASS |
| PREP.plan-schedule.unrelated | unrelated | API | no prepared rows / counts | 200  len=603 {"content_revision":5,"selected":{"time_id":"7317a749-af87-439f-a47e-8cb20ab0b2ae","servic | PASS |
| PREP.plan-detail.unrelated | unrelated | API | no prepared leak | 200  {"id":"27f98a6e-7910-4438-8f8c-96e48ad50bcc","organization_id":"5972923d-ffda-4ec1-8fc6-f9 | PASS |
| PREP.plan-schedule.confirmed | confirmed | API | no prepared rows / counts | 200  len=603 {"content_revision":5,"selected":{"time_id":"7317a749-af87-439f-a47e-8cb20ab0b2ae","servic | PASS |
| PREP.plan-detail.confirmed | confirmed | API | no prepared leak | 200  {"id":"27f98a6e-7910-4438-8f8c-96e48ad50bcc","organization_id":"5972923d-ffda-4ec1-8fc6-f9 | PASS |
| PREP.postgrest.assignments.pending | pending | RLS-PostgREST | [] rows | 200  [] | PASS |
| PREP.postgrest.count.pending | pending | RLS-PostgREST | count 0 | status 200 | PASS |
| PREP.postgrest.time_responses.pending | pending | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.attendance_times.pending | pending | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.history.pending | pending | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.snapshots.pending | pending | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.assignments.unrelated | unrelated | RLS-PostgREST | [] rows | 200  [] | PASS |
| PREP.postgrest.count.unrelated | unrelated | RLS-PostgREST | count 0 | status 200 | PASS |
| PREP.postgrest.time_responses.unrelated | unrelated | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.attendance_times.unrelated | unrelated | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.history.unrelated | unrelated | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.snapshots.unrelated | unrelated | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.assignments.dependent | dependent | RLS-PostgREST | [] rows | 200  [] | PASS |
| PREP.postgrest.count.dependent | dependent | RLS-PostgREST | count 0 | status 200 | PASS |
| PREP.postgrest.time_responses.dependent | dependent | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.attendance_times.dependent | dependent | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.history.dependent | dependent | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.snapshots.dependent | dependent | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.assignments.delegate | delegate | RLS-PostgREST | [] rows | 200  [] | PASS |
| PREP.postgrest.count.delegate | delegate | RLS-PostgREST | count 0 | status 200 | PASS |
| PREP.postgrest.time_responses.delegate | delegate | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.attendance_times.delegate | delegate | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.history.delegate | delegate | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.postgrest.snapshots.delegate | delegate | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.rpc.respond_as_self.pending | pending | RPC | P0002 not found, no write | 500  {"code":"P0002","details":null,"hint":null,"message":"Assignment not found"} | PASS |
| PREP.rpc.preview.pending | pending | RPC | error/empty | 409  {"code":"PT409","details":null,"hint":null,"message":"One or more requests are no longer a | PASS |
| PREP.rpc.attendance_for.pending | pending | RPC | empty/err | 200  [] | PASS |
| PREP.postgrest.patch-prepared-own.pending | pending | RLS-PostgREST | 0 rows updated | 200  [] | PASS |
| PREP.rpc.respond_as_delegate.prepared | delegate | RPC | error no write | 500  {"code":"P0002","details":null,"hint":null,"message":"Request not found"} | PASS |
| PREP.rpc.my_org_schedule.pending | pending | RPC | no prepared | 403  {"code":"42501","details":null,"hint":null,"message":"Turn on the combined schedule first" [denied 42501 "Turn on the combined schedule first" (opt-in gate); with opt-in on see PREP.rpc.my_org_schedule.dependent(combined on)] | PASS |
| PREP.notifications.pending | pending | API | no entry about this plan | 200  {"items":[{"id":"67571756-b6e4-4af8-a38d-c38e9041d2bc","organization_id":"5972923d-ffda-4e | PASS |
| PREP.unread-count.pending | pending | API | 200 | 200 [{"unread":16,"account_unread":16}] | PASS |
| PREP.postgrest.assignments.owner | owner | RLS-PostgREST | sees 3 prepared | 200  [{"id":"1c7dd2dc-a5c3-4f36-89a2-cebf8607e6bc","visibility":"prepared"},{"id":"a073f667-764 | PASS |
| PREP.release.stale-revision | owner | API | 409 | 409  {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| PREP.release.member-denied | pending | API | 403 | 403  {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} | PASS |
| PREP.release.exact | owner | API | 200 released | 200  {"released":[{"id":"a073f667-7649-4169-9e59-a2c97217f5b1","plan_id":"27f98a6e-7910-4438-8f | PASS |
| PREP.release.only-selected | owner | DB | others still prepared | 0 | PASS |
| PREP.release.replay-same-key | owner | API | 200/no dup effect | 200  effects=1 links=1 {"released":[{"id":"a073f667-7649-4169-9e59-a2c97217f5b1","plan_id":"27f98a6e-7910-4438-8f | PASS |
| PREP.after-release.pending-sees | pending | API | sees released pa | 200  [{"assignment":{"id":"4d9e0c9c-7770-4342-befd-6dcefc47146a","plan_id":"1704fc98-e0ea-4ea1- | PASS |
| PREP.after-release.dependent-still-hidden | dependent | API | still hidden | 200  [{"assignment":{"id":"da5b2e7a-3638-4f37-b591-f5f20f80e305","plan_id":"f0a4d566-4211-401c- | PASS |
| PREP.after-release.respond | pending | API | 200 | 200  {"id":"a073f667-7649-4169-9e59-a2c97217f5b1","plan_id":"27f98a6e-7910-4438-8f8c-96e48ad50b | PASS |
| PREP.postgrest.otherorg | bowner | RLS-PostgREST | [] | 200  [] | PASS |
| PREP.rpc.my_org_schedule.dependent(combined on) | dependent | RPC | 200, prepared dp absent | 200 [{"kind":"assignment","item_id":"60224972-d57d-45eb-9d1e-e3ae3db3624b","title":"QA resp plan 121","s | PASS |
| PREP.api.combined-schedule.dependent | dependent | API | 200, prepared absent | 200 {"from":"2027-05-02T14:00:00.000Z","to":"2027-06-04T14:00:00.000Z","organizations":[{"organization_i | PASS |
| PREP.plan-detail-counts.owner | owner | API | counts.prepared=2 and 2 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":2} rows=3 preparedRows=2 | PASS |
| PREP.plan-detail-counts.scoped | scoped | API | counts.prepared=2 and 2 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":2} rows=3 preparedRows=2 | PASS |
| PREP.plan-detail-counts.bandlead | bandlead | API | counts.prepared=2 and 2 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":2} rows=3 preparedRows=2 | PASS |
| PREP.plan-detail-counts.prodlead | prodlead | API | counts.prepared=0 and 0 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":0} rows=1 preparedRows=0 | PASS |
| PREP.plan-detail-counts.pending | pending | API | counts.prepared=0 and 0 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":0} rows=1 preparedRows=0 | PASS |
| PREP.plan-detail-counts.unrelated | unrelated | API | counts.prepared=0 and 0 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":0} rows=1 preparedRows=0 | PASS |
| PREP.plan-detail-counts.confirmed | confirmed | API | counts.prepared=0 and 0 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":0} rows=1 preparedRows=0 | PASS |
| PREP.plan-detail-counts.dependent | dependent | API | counts.prepared=0 and 0 prepared rows in assignments[] | 200 counts={"items":0,"songs":0,"confirmed":0,"unconfirmed":1,"declined":0,"prepared":0} rows=1 preparedRows=0 | PASS |

### PRIV Decline / withdrawal reason privacy  (PASS 50)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PRIV.decline-with-reason | pending | API | 200 | 200 | PASS |
| PRIV.delegate-decline-with-reason | delegate | API | 200 | 200 | PASS |
| PRIV.history-read.pending | pending | RLS-PostgREST | reasons visible=1 | 200 seen=1 rows=1 | PASS |
| PRIV.time-responses-read.pending | pending | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.pending | pending | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.pending | pending | API | only own reasons | 200 seen 1 | PASS |
| PRIV.notifications.pending | pending | API | notification feed carries no reason text | 200 len=23609 | PASS |
| PRIV.history-read.owner | owner | RLS-PostgREST | reasons visible=3 | 200 seen=3 rows=4 | PASS |
| PRIV.time-responses-read.owner | owner | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.owner | owner | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.owner | owner | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.owner | owner | API | notification feed carries no reason text | 200 len=22717 | PASS |
| PRIV.history-read.bandlead | bandlead | RLS-PostgREST | reasons visible=3 | 200 seen=3 rows=4 | PASS |
| PRIV.time-responses-read.bandlead | bandlead | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.bandlead | bandlead | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.bandlead | bandlead | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.bandlead | bandlead | API | notification feed carries no reason text | 200 len=42 | PASS |
| PRIV.history-read.scoped | scoped | RLS-PostgREST | reasons visible=3 | 200 seen=3 rows=4 | PASS |
| PRIV.time-responses-read.scoped | scoped | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.scoped | scoped | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.scoped | scoped | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.scoped | scoped | API | notification feed carries no reason text | 200 len=42 | PASS |
| PRIV.history-read.unrelated | unrelated | RLS-PostgREST | reasons visible=0 | 200 seen=0 rows=0 | PASS |
| PRIV.time-responses-read.unrelated | unrelated | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.unrelated | unrelated | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.unrelated | unrelated | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.unrelated | unrelated | API | notification feed carries no reason text | 200 len=42 | PASS |
| PRIV.history-read.confirmed | confirmed | RLS-PostgREST | reasons visible=1 | 200 seen=1 rows=2 | PASS |
| PRIV.time-responses-read.confirmed | confirmed | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.confirmed | confirmed | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.confirmed | confirmed | API | only own reasons | 200 seen 1 | PASS |
| PRIV.notifications.confirmed | confirmed | API | notification feed carries no reason text | 200 len=4740 | PASS |
| PRIV.history-read.prodlead | prodlead | RLS-PostgREST | reasons visible=0 | 200 seen=0 rows=0 | PASS |
| PRIV.time-responses-read.prodlead | prodlead | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.prodlead | prodlead | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.prodlead | prodlead | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.prodlead | prodlead | API | notification feed carries no reason text | 200 len=42 | PASS |
| PRIV.history-read.delegate | delegate | RLS-PostgREST | reasons visible=0 | 200 seen=0 rows=0 | PASS |
| PRIV.time-responses-read.delegate | delegate | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.delegate | delegate | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.delegate | delegate | API | only own reasons | 200 seen 0 | PASS |
| PRIV.notifications.delegate | delegate | API | notification feed carries no reason text | 200 len=42 | PASS |
| PRIV.history-read.dependent | dependent | RLS-PostgREST | reasons visible=1 | 200 seen=1 rows=1 | PASS |
| PRIV.time-responses-read.dependent | dependent | RLS-PostgREST | no reasons for non-managers | 200 [] | PASS |
| PRIV.assignment-row-read.dependent | dependent | RLS-PostgREST | assignments row has no reason text | 200 | PASS |
| PRIV.my-schedule.dependent | dependent | API | only own reasons | 200 seen 1 | PASS |
| PRIV.notifications.dependent | dependent | API | notification feed carries no reason text | 200 len=23630 | PASS |
| PRIV.outbox-effect-no-note-column | system | DB | effects carry no note (reason read through RLS history only) | 200 | PASS |
| PRIV.outbox-schema-no-note | system | DB | 0 note columns | 200 | PASS |
| PRIV.history-read.otherorg | bowner | RLS-PostgREST | [] | 200 | PASS |

### W2 Retests of wave-2 items listed Fixed  (PASS 32)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W2-RESP-D5.retest.malformed-uuid | pending | API | 400 | 400  {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D1.setup.opening | owner | API | 201 | 201 {"id":"2c55f067-e5bc-43f1-a5ed-ee0a7318dd2e","organization_id":"5972923d-ffda-4e | PASS |
| W2-RESP-D1.setup.claim | pending | API | 201 awaiting_approval | 201 {"id":"fdf9c731-8fe4-4654-a135-93d3445cb75c","opportunity_id":"2c55f067-e5bc-43f | PASS |
| W2-RESP-D1.retest.claims-list.owner | owner | API | list includes claim with person_name | 200 [{"id":"fdf9c731-8fe4-4654-a135-93d3445cb75c","opportunity_id":"2c55f067-e5bc-43f1-a5ed-ee | PASS |
| W2-RESP-D1.retest.claims-list.bandlead | bandlead | API | list includes claim with person_name | 200 [{"id":"fdf9c731-8fe4-4654-a135-93d3445cb75c","opportunity_id":"2c55f067-e5bc-43f1-a5ed-ee | PASS |
| W2-RESP-D1.retest.claims-list.scoped | scoped | API | list includes claim with person_name | 200 [{"id":"fdf9c731-8fe4-4654-a135-93d3445cb75c","opportunity_id":"2c55f067-e5bc-43f1-a5ed-ee | PASS |
| W2-RESP-D1.retest.claims-list.prodlead | prodlead | API | [] or 403 (no Band scope) | 200 [] | PASS |
| W2-RESP-D2.setup.lead-claims | bandlead | API | 201 | 201 {"id":"edcdf9d0-db5c-43ef-9bd6-fa557523dd4e","opportunity_id":"c99e77f6-fd04-4d6 | PASS |
| W2-RESP-D2.retest.self-approve-claim | bandlead | API | 403 self_approval, claim unchanged | 403 {"error":"You cannot approve your own claim","code":"self_approval"} state=awaiting_approval | PASS |
| W2-RESP-D2.retest.owner-approves-lead-claim | owner | API | 200 | 200 {"id":"edcdf9d0-db5c-43ef-9bd6-fa557523dd4e","opportunity_id":"c99e77f6-fd04-4d6 | PASS |
| W2-RESP-D5.retest.POST/opportunities/not-a-uuid/claim | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.POST/replacement-offers/zzz/action | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.POST/delegations/xyz/revoke | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.POST/delegations/xyz/assignments/abc/respond | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.GET/delegations/xyz/schedule | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.PATCH/assignments/not-a-uuid | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.DELETE/assignments/not-a-uuid | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| W2-RESP-D5.retest.POST/assignment-responses/short/respond | owner | API | 404 (opaque token) | 404 {"error":"That assignment response link is not valid","code":"not_foun | PASS |
| W2-RESP-D5.retest.bad-org-header | owner | API | 400 | 400 | PASS |
| W2-P0.retest.people_directory.PATCH.member | unrelated | RLS-PostgREST | 403 42501, row unchanged | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| W2-P0.retest.people_directory.DELETE.member | unrelated | RLS-PostgREST | 403 42501, row unchanged | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| W2-P0.retest.people_directory.POST.member | unrelated | RLS-PostgREST | 403 42501, row unchanged | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| W2-P0.retest.people_directory.PATCH.owner | owner | RLS-PostgREST | 403 (view read-only) | 403 | PASS |
| W2-AVAIL-D3.setup.pending-blockout | pending | API | 201 | 201 {"blockout":{"id":"59709105-cc70-4e40-aed9-27be5e6f80dd","organization_id":"5972 | PASS |
| W2-AVAIL-D3.retest.raw-reason-hidden.bandlead | bandlead | RLS-PostgREST+API | reason never exposed | 200 raw=[] api=200 | PASS |
| W2-AVAIL-D3.retest.raw-reason-hidden.scoped | scoped | RLS-PostgREST+API | reason never exposed | 200 raw=[] api=404 | PASS |
| W2-AVAIL-D3.retest.out-of-team-blockout-list.scoped | scoped | API | 404/403 (Person not on a team they schedule) | 404 {"error":"Person not found","code":"not_found"} | PASS |
| W2-AVAIL-D3.retest.raw-reason-hidden.prodlead | prodlead | RLS-PostgREST+API | reason never exposed | 200 raw=[] api=404 | PASS |
| W2-AVAIL-D3.retest.out-of-team-blockout-list.prodlead | prodlead | API | 404/403 (Person not on a team they schedule) | 404 {"error":"Person not found","code":"not_found"} | PASS |
| W2-AVAIL-D3.retest.raw-reason-hidden.unrelated | unrelated | RLS-PostgREST+API | reason never exposed | 200 raw=[] api=403 | PASS |
| W2-AVAIL-D3.retest.out-of-team-blockout-list.unrelated | unrelated | API | 404/403 (Person not on a team they schedule) | 403 {"error":"Only schedulers or someone they asked to help can change ano | PASS |
| W2-AVAIL-D3.retest.raw-reason-hidden.owner | owner | RLS-PostgREST+API | owner is not self/admin delegate: no raw reason | 200 raw=[{"id":"59709105-cc70-4e40-aed9-27be5e6f80dd","rea api=200 [owner is admin-equivalent: raw reason readable by design (self/admin/delegate); test expectation corrected] | PASS |

## Observations (not counted)

- `ACL-05.member-direct-patch-own-status`: a member's own released assignment can be PATCHed directly through PostgREST (`status`), recorded in history by trigger but with no scheduler effect (see D2). Changing own `plan_id`/position/notes/person/visibility is refused (403 "Only a scheduler can change this assignment" / 409). Re-accepting a declined row directly is refused (409 PT409).
- `PRIV.plans-list-count-fields`: plan detail carries `counts` and `assignments`; both exclude prepared rows for everyone without scope (checked for 8 actors, `PREP.plan-detail-counts.*`).
- A delegate's reason on the dependent's decline is visible to the dependent (their own history) and not to the delegate, other members or other scopes.
- Removing an assignment deletes its response history (before 1 row, after 0). The plan asks for history retention on removal; no audit copy is kept. Needs an owner decision.
- `RESP-02.response-owner.receives-update`: the scheduler effect is addressed to the current response owner; delivery itself belongs to W7-JOURNEY.
- Time edits do not reset a confirmed answer (D6). After a respond-first/edit-second race the final state is the same as the sequential one.

## Defects

### W7-RESP-D1 (P2) `DELETE /assignments/:id` reports 204 success when nothing was deleted
- Repro: `DELETE /api/v1/assignments/<midweek assignment id>` with `Authorization: Bearer <scoped scheduler (Sunday only)>` and `X-Organization-Id: <Alpha>`; also `DELETE /assignments/<random uuid>` as owner or scoped; also a Beta-owner call with Beta header and an Alpha assignment id.
- Expected: 404 (out of scope / not found), consistent with PATCH `/assignments/:id` (404 in the same situations) and the CLAUDE.md note that RLS-denied rows surface as 404.
- Actual: 204 in every case; the row is untouched (checked in DB). Six matrix cells (`ACL-05.delete-assignment.{scoped.MB,scoped.MP,bandlead.SP,bandlead.MP,prodlead.SB,prodlead.MB}`) record the status mismatch; no data changed.
- Suspected: `backend/src/routes/assignments.ts:380-387` (`delete().eq('id')` with no `.select()`/row-count check).

### W7-RESP-D2 (P2) A signed-in member can answer their own released assignment through PostgREST without recording the scheduler update
- Repro: as `confirmed` or `declined` member, `PATCH {SUPABASE_URL}/rest/v1/assignments?id=eq.<own released assignment>` body `{"status":"declined"}` (or `confirmed` from unconfirmed) with anon apikey + the member's JWT.
- Expected: same Response semantics as `respond_as_self` (history row and `scheduler_response` effect in the same change; CONTEXT.md "Response ... each records the scheduler's update in the same change").
- Actual: 200, status changes, history row is written by trigger, but `delivery_effects` gains no row (`RESP-01.direct-own-status-patch.postgrest`, `RESP-02.direct-withdrawal.postgrest`). A confirmed member can withdraw with no scheduler notification and no reason handling.
- Suspected: `assignments_update` policy member branch (`person is own and visibility = 'released'`, `20261122000200_perf_assignment_access.sql` leaves it as-is; originates in the F01 visibility migration) lets the column through; a `before update` guard could route status writes through `respond_as_self` only.

### W7-RESP-D3 (P2) Malformed or primitive JSON body returns 500 `internal_error` with the parser message, on every endpoint
- Repro: `curl -X POST http://localhost:4000/api/v1/assignment-responses/abc/respond -H 'Content-Type: application/json' -d '{bad'` (also `-d '"x"'`, `-d 'null'`); same on `POST /api/v1/plans` with any bearer.
- Expected: 400 (or 422 like the array case) with a generic message.
- Actual: 500 `{"error":"Expected property name or '}' in JSON at position 1 (line 1 column 2)","code":"internal_error"}`. Parsing happens before auth, so unauthenticated callers can trigger it; engine text is exposed (CLAUDE.md rule 20). `[]` correctly gives 422.
- Suspected: `backend/src/app.ts:119` (`express.json()` errors reach `backend/src/middleware/error-handler.ts:37` without mapping `SyntaxError` / `type: 'entity.parse.failed'` to 400).

### W7-RESP-D4 (P2) Concurrent retry of an already-committed identical answer is refused as stale (respond_as_self, snapshot commit); contradicts the `respond_as_self` header contract (carries over W2-RESP-D3)
- Repro: three parallel `POST /api/v1/assignments/<id>/respond {"status":"confirmed","expected_status":"unconfirmed"}` as the assignee (20/20 runs: exactly one 200, two 409 `assignment_response_stale`); three parallel `POST /api/v1/assignments/responses/commit` with the same snapshot and the same `idempotency_key` (20/20: one 200, two 409).
- Expected: the losers see the committed answer as `unchanged` / the stored result and return 200 (the migration says a retry of an answer that committed is a success; current status equals the requested one).
- Actual: 409. State is correct (1 history row, 1 effect, 0 duplicates in all 40 runs); only the client-visible result is ambiguous, so a transport retry that races the original must reread.
- Suspected: `supabase/migrations/20261123000000_respond_as_self.sql:89` (`if v_updated.id is null` raises stale without re-checking `v_current = p_status`); snapshot commit: `supabase/migrations/20261017000300_mob005_identity_times_snapshots.sql` key lookup before the snapshot lock (~line 1398).

### W7-RESP-D5 (P2) `GET /schedule/mine` returns 500 `URI too long` once the window holds about 200 assignments
- Repro: org with a member holding more than ~200 released assignments in the window (`pending` has 300): `GET /api/v1/schedule/mine?include_past=true` -> 500 `{"error":"URI too long\n"}`; windows with 197 rows return 200, 380 days (>~200 rows) return 500 (`/schedule/mine?from=2027-01-01&to=...`).
- Expected: 200 with the schedule (chunked or RPC), or a bounded/paged result.
- Actual: 500; a long-serving member's schedule (default window is "from now", unbounded) cannot load without narrowing dates.
- Suspected: `backend/src/routes/assignments.ts:450` (`.in('assignment_id', assignmentIds)` on `assignment_time_responses` builds a GET URL with every id); `latestDeclineReasons` in `backend/src/services/assignment-responses.ts:404` has the same shape.

### W7-RESP-D6 (P2, needs product decision) A confirmed answer silently carries over to a changed scope
- Repro: member confirms (self, link or snapshot commit) an assignment with times Rehearsal+09:00; scheduler `PUT /plans/:id/assignment-times` moves it to the 11:00 time only (`notify` true or false). Deterministic sequentially and in the respond-first race outcome.
- Expected (plan RESP-04 "no mixed answers"; F04 note says affected people are re-asked): the answer to the removed times does not count for the new time, or the request returns to unconfirmed.
- Actual: assignment stays `confirmed`, `request_revision` goes up, `GET /schedule/mine` shows the new time with `time_responses` for the two removed times and none for the new one. (Reviews and links are correctly made stale, and an answer is never written onto an unreviewed time; invariants in RESP-04 hold.)
- Suspected: `set_assignment_attendance` does not reset status or per-time answers (`supabase/migrations/20261020000100_f04_assigned_times.sql`).

### Carried over, still open (not new)
- W2-RESP-D4 (P2): `GET /assignment-responses/:token` shows times that the matching `respond` rejects as stale (`W2-RESP-D4.retest.preview-stale-vs-respond`, preview 200 vs respond 409). Source `backend/src/routes/assignment-respond.ts` -> `previewLink` (`backend/src/services/assignment-responses.ts` checks superseded/consumed only).
- W2-RESP-D3 same-key replay (see D4 here).

## Not run / blocked

- Web UI (`/respond`, My schedule, plan staffing, help/delegation pages), native screens, calendar feeds, web/native respond fallback pages and wrong-account deep links: NOT_RUN (browser owned by W7-WEB; no devices).
- Delivery outcomes (email/push provider results, retries, dedupe at the worker): NOT_RUN (W7-JOURNEY owns the worker). Only the outbox rows were asserted.
- RESP-03 "revoked" link: NOT_APPLICABLE (no revoke feature; wave 2 observation unchanged).
- Delegate signup (DELEGATE-01 signup): NOT_APPLICABLE (`can_signup` has no consumer).
- "Revoke during open review blocks commit" (DELEGATE-01): the delegate has no snapshot-commit path (delegate responds one assignment at a time with `expected_status`); the equivalent (grant revoked/expired/unrelated delegation id -> 404, no write) PASSes.
- DB suites that use seed rows (see Other results): NOT_RUN.
- Test-harness notes: `DELEGATE-01.respond.after-revoke` (script bug: the assignment was already confirmed) was dropped; its fresh replacement `.after-revoke.fresh` PASSes. `W2-AVAIL-D3.retest.raw-reason-hidden.owner` and `DELEGATE-01.schedule.respond-only` were corrected as described in the table notes.

## Fixtures left in place

Orgs `qa-20261120-resp-a` and `qa-20261120-resp-b`; 12 auth users `{owner,scoped,bandlead,prodlead,pending,confirmed,declined,delegate,dependent,unrelated,bowner,bmember}.qa20261120.resp@example.test`; about 390 plans (`QA resp plan N`), 410 assignments, 340+ response-history rows, snapshots, notifications, delivery effects (never delivered by me), delegations (`dependent` -> `delegate`), blockouts for `dependent`/`pending`, signup openings and claims, access grants for `scoped`/`bandlead`/`prodlead`, DB sequence `public.qa_resp_seq` (created in the local DB for unique plan dates; drop with the fixtures). Scripts and the (redacted) result JSON are in the session scratchpad `.../scratchpad/resp/`. The riverside seed org and other `qa-*` orgs were not touched.
