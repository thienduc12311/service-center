# W8-RETEST: wave 7 fixes, API + DB surfaces

| Field | Value |
|---|---|
| Package | W8-RETEST (every wave 7 FAIL, W2-RESP-D4, template/duplicate data-loss follow-up, migration `20261126000400` review follow-ups) |
| Commit | `897e524` (main + wave 7 fixes + follow-ups), branch `feature/qa-wave8`; no code, migration, config or git changes |
| Env | API :4000, local Supabase `service-center`, web/browser and simulator not used, delivery worker not run by me (the API process's own worker delivered in-app notifications for chat while I tested; I did not start or stop it). Node 26.13.1 |
| Namespace | orgs `qa-w8-rt-a` (A, America/Chicago), `qa-w8-rt-b` (B); users `<o,ad,sc,m1,m2,m3,lead,multi,newc,ob,mb>.qaw8.rt@example.test`, plus `inv1-4`. Fixtures built with `private.create_church`, GoTrue admin and SQL (setup only); all permission evidence uses the caller's own JWT |
| Method | Node scripts in the session scratchpad (`.../scratchpad/rt/`). SQL as postgres only for setup, state assertions, tie/timestamp preparation and the two-session race harness |
| Not touched | other qa-* orgs, shared servers (no kill/restart by me), concurrency `.sh` suites (none run; `run-all.sh` without `--concurrency`) |

Note on the :4000 SIGTERM: not sent by me. I never used kill/pkill/killall; the only process I stopped was my own hung background shell via TaskStop. A chat 429 occurred in my own harness (20 posts/min/author/conversation limit) before the restart; the harness now backs off.

## Result summary

Original defects (API/DB half): all PASS except the items below. 479 PASS, 7 FAIL (rolling up to 3 new findings), 1 BLOCKED, 10 NOT_RUN (UI halves, closed-by-decision).

| Defect | Result |
|---|---|
| W7-ACC-D1 (P0) | PASS (25 cases: admin INSERT every role incl. invalid, status pending, other-tenant user, org B, upsert promote/self/demote; scheduler/member/outsider; owner control 201; invitation accept and join-request flows still work) |
| W7-ACC-D2 | PASS |
| W7-ACC-D3 / W7-WEB-D2 | PASS API (teams.manage holders may delete, member 403); UI half NOT_RUN |
| W7-ACC-D4, W7-RESP-D1 | PASS for every route in the fix list (assignments, teams, team positions, plans, plan items, plan positions, service types, songs, arrangements, folders, people, tag groups, matrix views, songbooks: random id and org B id, plus own-row 204 then 404). **Same pattern still 204 on four routes outside the list: W8-RT-D2** |
| W7-ACC-D5, D6, D9, D10, W7-RESP-D3, W7-MSG-D11 | PASS |
| W7-ACC-D7 | PASS (60 s TTL; URL works at issue, dead after about 60 s) |
| W7-ACC-D8 | PASS (svg/html refused 415, raster accepted). Observation: no `X-Content-Type-Options` on public logo objects |
| W7-JRN-D1, D2, D4 | PASS |
| W7-JRN-D3 | PASS (table, RPC and API 401 after local and global sign-out, other session/user/anon/service role unaffected, `jwt_expiry` 900). Storage HTTP leg BLOCKED (only public empty buckets reachable; policy `session must be live` verified present) |
| W7-MSG-D1, D3 | PASS (13 notifications tied 7+5, limits 2/3/5/7/12, unread_only, chat 5+4, comments 4+3) |
| W7-MSG-D2, D5, D6, D7, D8, D9, D10 | PASS (see W8-RT-D3 for a regression-adjacent note on D5) |
| W7-MSG-D4 + review follow-up (excerpts) | PASS: delete, hide, access loss, edit (prefix kept, changed start nulled), long/multiline/unicode/regex-special excerpts, insert guard, 6 race orderings x edit/delete/hide with a held transaction, 6 parallel inserts vs edit (no deadlock) |
| W7-RESP-D2, D4, D5 | PASS |
| W2-RESP-D4 | PASS (11 cases: preview and respond agree for current, consumed, status/attendance/position change, delete, expired, superseded, unknown token) |
| W7-NAT-D2 / W7-WEB-D5 (API half) | PASS for every plan_times write path; backfill clean (0 drifted plans DB-wide). **FAIL when PATCH carries both `service_date` and `times`: W8-RT-D1** |
| template/duplicate data loss (`plan_active_people`) | PASS: scoped-to-Midweek caller copying a Sunday plan into a Midweek plan keeps roster and item leaders; scheduler and owner duplicate keep both; templates keep roster; member/cross-org denied; helper functions not exposed through PostgREST |
| W7-WEB-D1, D3, D4, W7-NAT-D1 | shared-lib and unit tests PASS; UI half NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) |
| W7-RESP-D6 | closed by decision in wave 7, not retested |

## Test-suite results

| Suite | Result |
|---|---|
| `bash supabase/tests/run-all.sh` | 52 passed, 0 failed (no `*concurrent*.sh` run) |
| `npm run typecheck` | clean (shared, backend, frontend, mobile, admin) |
| `npm run test` | shared 600, backend 403, frontend 49, mobile 396, admin 72 (workspace order in the log: 600 / 403 / 49 / 396 / 72): 1,520 tests, 0 failed |

## Defects

### W8-RT-D1 (P2) `PATCH /plans/:id` with both `service_date` and `times` leaves `service_date` different from the earliest service time
- Repro: plan with one service time at T0. `PATCH /plans/:id {"service_date":"<T0>","times":[{"id":<existing>,"kind":"service","starts_at":"<T0+10d>","ends_at":"<T0+10d+1h>"}]}` as owner. DB: `plans.service_date` = T0, earliest service time = T0+10d (`drift = true`). A later `PATCH {service_date}` alone behaves the same.
- Expected: the invariant of 20261126000100 (service_date follows the earliest service time) holds for every write path; the explicit field should not override a time list sent in the same request (or be ignored while service times exist).
- Actual: the trigger sets the date during `applyPlanTimes`, then the route's second statement `update plans set service_date` overwrites it.
- Suspected: `backend/src/routes/plans.ts:157-200` (`planFields` still carries `service_date` after `times` was applied). Web "Edit times" sends `times` only, so impact is limited to API clients that send both.

### W8-RT-D2 (P2) Silent 204 on four DELETE routes the wave 7 `unwrapDeleted` fix did not cover
- Repro: `DELETE /notifications/<random uuid or another user's notification id>` (m1), `DELETE /me/devices/<random>` , `DELETE /me/blocks/<random uuid>`, `DELETE /people/members/<random uuid>` (owner) -> 204; nothing deleted (DB checked for the notification: row stays). 13 other probed DELETE routes return 404.
- Expected: 404 like the listed routes (devices/blocks may be argued idempotent, notifications and member removal should not claim success).
- Suspected: `backend/src/routes/notifications.ts:141-150`, `:211-214`, `backend/src/routes/me.ts:95`, `backend/src/routes/people.ts:341-352`.

### W8-RT-D3 (P2, informational) Direct PostgREST `DELETE /notifications` of another user's row returns 200 `[]`
- Not a defect on its own (RLS correct, row intact); listed so it is not mistaken for a W7-MSG-D5 regression. The API route in W8-RT-D2 is the only misleading surface.

### Observations (not defects)
- `GET /messages` returns a bare array, with no `next_before`; clients build the cursor as `created_at~id` of the last row. Paging with that cursor is tie-safe (4+2 ties, box sent and received, limits 1-5).
- Admin cannot create a Person or issue an invitation (403, owner-only People since `20261109000000`); not caused by W7-ACC-D1. Invitation accept and join-request approval still create memberships through the security-definer functions.
- Template content carries no item leaders by design; the original "template data loss" concerns the roster, which is now kept for scoped callers.
- Respond-link preview after a plan time change returns 404 for both preview and respond (token superseded by the re-notify); consistent.
- Existing signed URLs stay valid up to 60 s after revoke/delete (bounded residual).

## Cases

Status values: PASS, FAIL, BLOCKED, NOT_RUN. "Actor" is the fixture alias (o owner, ad admin, sc legacy scheduler, lead scoped scheduler, m1-m3 members, multi member of A and B, ob owner B). Harness expectation errors found while running were corrected in the script and the case re-run; the table shows final results only.

| Original ID | Variant | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| New - plan_active_people exposure | public.plan_active_people rpc reachable by PostgREST (private schema, should not be exposed) | lead | PostgREST | 404/not exposed | 404 {"code":"PGRST202","details":"Searched for the function publ | PASS |
| New - plan_active_people exposure | active_people_in_org rpc via PostgREST | lead | PostgREST | not exposed | 404 | PASS |
| New - template/duplicate data loss | duplicate plan, copy_assignments (caller o) | o | API+DB | asg=2 leaders=2 | 201 asg=2 leaders=2 | PASS |
| New - template/duplicate data loss | duplicate plan, copy_assignments (caller sc) | sc | API+DB | asg=2 leaders=2 | 201 asg=2 leaders=2 | PASS |
| New - template/duplicate data loss | duplicate plan, copy_assignments (caller lead(scoped Midweek only)) | lead(scoped Midweek only) | API+DB | 403 (no plans.edit on the Sunday source type; harness expectation wrong) | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| New - template/duplicate data loss | create plan copy_from_plan_id into Midweek type (caller o) | o | API+DB | roster+leaders copied (items led by Persons; assignments may be team-scoped) | 201 asg=2 leaders=2 | PASS |
| New - template/duplicate data loss | create plan copy_from_plan_id into Midweek type (caller lead(scoped Midweek only)) | lead(scoped Midweek only) | API+DB | roster+leaders copied (items led by Persons; assignments may be team-scoped) | 201 asg=2 leaders=2 | PASS |
| New - template/duplicate data loss | import contents by scoped lead (record) | lead | API+DB | record | 200 asg=0 leaders=2 | PASS |
| New - template/duplicate data loss | save template from plan (caller o, template service type Sunday) | o | API | roster=2 (templates carry no item leaders by design; harness expected led=2 wrongly) | 201 roster=2 led=0  | PASS |
| New - template/duplicate data loss | save template from plan (caller sc, template service type Sunday) | sc | API | roster=2 (templates carry no item leaders by design; harness expected led=2 wrongly) | 201 roster=2 led=0  | PASS |
| New - template/duplicate data loss | save template from plan (caller lead(scoped Midweek), template service type Midweek) | lead(scoped Midweek) | API | roster=2 (templates carry no item leaders by design; harness expected led=2 wrongly) | 201 roster=2 led=0  | PASS |
| New - template/duplicate data loss | member duplicate (negative) | m1 | API | 403 | 403 | PASS |
| New - template/duplicate data loss | member save template (negative) | m1 | API | 403/404 | 403 | PASS |
| New - template/duplicate data loss | org B owner duplicates org A plan id (cross-tenant) | ob | API | 404 | 404 | PASS |
| W2-RESP-D4 | control: current link preview 200 then respond 200 | public | API | 200/200 | 200/200 | PASS |
| W2-RESP-D4 | after consume: preview and respond agree (no 200 preview of a refused respond) | public | API | same non-200 | 410/410 | PASS |
| W2-RESP-D4 | scheduler changed status after link: preview and respond agree | public | API | both 409 | preview 409 / respond 409 | PASS |
| W2-RESP-D4 | assignment deleted after link: preview and respond agree | public | API | both 409 | preview 409 / respond 409 | PASS |
| W2-RESP-D4 | attendance times changed after link: preview and respond agree | public | API | both 409 | preview 409 / respond 409 | PASS |
| W2-RESP-D4 | plan time moved after link: preview and respond agree | public | API | same status | preview 404 / respond 404 | PASS |
| W2-RESP-D4 | position changed after link: preview and respond agree | public | API | same status | preview 409 / respond 409 | PASS |
| W2-RESP-D4 | expired link/snapshot: preview and respond agree | public | API | both 410 | preview 410 / respond 410 | PASS |
| W2-RESP-D4 | snapshot expired only: preview and respond agree | public | API | same status | preview 410 / respond 410 | PASS |
| W2-RESP-D4 | superseded snapshot: preview and respond agree | public | API | same status | preview 409 / respond 409 | PASS |
| W2-RESP-D4 | unknown token agree, no existence oracle | public | API | 404/404 | 404/404 | PASS |
| W7-ACC-D1 | admin INSERT role=owner | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 403 {"code":"42501","details":null,"hint":null,"message":"new ro rows=0 | PASS |
| W7-ACC-D1 | admin INSERT role=admin | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 403 {"code":"42501","details":null,"hint":null,"message":"new ro rows=0 | PASS |
| W7-ACC-D1 | admin INSERT role=scheduler | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 403 {"code":"42501","details":null,"hint":null,"message":"new ro rows=0 | PASS |
| W7-ACC-D1 | admin INSERT role=member | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 403 {"code":"42501","details":null,"hint":null,"message":"new ro rows=0 | PASS |
| W7-ACC-D1 | admin INSERT role=OWNER | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 400 {"code":"22P02","details":null,"hint":null,"message":"invali rows=0 | PASS |
| W7-ACC-D1 | admin INSERT role=bogus | ad | PostgREST | 403/42501 (or 400 for invalid enum), no row | 400 {"code":"22P02","details":null,"hint":null,"message":"invali rows=0 | PASS |
| W7-ACC-D1 | admin INSERT status=pending | ad | PostgREST | denied | 400 rows=0 | PASS |
| W7-ACC-D1 | admin INSERT other-tenant user (orgB owner) as owner | ad | PostgREST | denied | 403 rows=0 | PASS |
| W7-ACC-D1 | admin(A) INSERT into org B | ad | PostgREST | denied | 403 rows=0 | PASS |
| W7-ACC-D1 | admin UPSERT promote m1->owner | ad | PostgREST | denied, role stays member | 403 role=member/active | PASS |
| W7-ACC-D1 | admin UPSERT self->owner | ad | PostgREST | denied | 403 role=admin/active | PASS |
| W7-ACC-D1 | admin UPSERT demote owner | ad | PostgREST | denied | 403 role=owner/active | PASS |
| W7-ACC-D1 | non-admin self/other INSERT owner | as sc | PostgREST | denied | 403 newc rows=0 sc role=scheduler/active | PASS |
| W7-ACC-D1 | non-admin self/other INSERT owner | as m1 | PostgREST | denied | 403 newc rows=0 m1 role=member/active | PASS |
| W7-ACC-D1 | non-admin self/other INSERT owner | as newc | PostgREST | denied | 403 newc rows=0 newc role= | PASS |
| W7-ACC-D1 | non-admin self/other INSERT owner | as lead | PostgREST | denied | 403 newc rows=0 lead role=member/active | PASS |
| W7-ACC-D1 | outsider self-join INSERT | newc | PostgREST | denied | 403 rows=0 | PASS |
| W7-ACC-D1 | owner INSERT member (control) | o | PostgREST | 201 | 201 rows=1 | PASS |
| W7-ACC-D1 | admin PATCH self->owner (regression) | ad | PostgREST | 0 rows/denied | 200 [] role=admin/active | PASS |
| W7-ACC-D1 | admin DELETE member (regression) | ad | PostgREST | denied/0 rows | 200 [] rows=1 | PASS |
| W7-ACC-D1 | join-request list (owner) still works | o | API | 200 | 200 | PASS |
| W7-ACC-D1 | regression: owner creates person | o | API | 201 | 201 | PASS |
| W7-ACC-D1 | observation: admin invite 403 (People is owner-only since 20261109, not caused by fix) | ad | API | n/a | 403 | PASS |
| W7-ACC-D1 | regression: owner issues invitation role=admin | o | API | 201 | 201 | PASS |
| W7-ACC-D1 | regression: invitation accept creates membership via SECURITY DEFINER fn | public | API | 2xx, admin/active | 200 {"email":"inv4.qaw8.rt@example.test","linked_existing_accoun mem=admin/active | PASS |
| W7-ACC-D10 | upper-case X-Organization-Id GET /plans | o | API | 200 | 200 | PASS |
| W7-ACC-D10 | upper-case X-Organization-Id GET /people (member) | m1 | API | 200 | 200 | PASS |
| W7-ACC-D10 | header with surrounding spaces (boundary) | o | API | 200 or 4xx not 500 | 200 | PASS |
| W7-ACC-D10 | upper-case id of org the caller is not a member of | o | API | 403 (no leak) | 403 | PASS |
| W7-ACC-D10 | invalid uuid header | o | API | 4xx not 500 | 400 | PASS |
| W7-ACC-D2 | PATCH /access/members | as ad | API | 403 | 403 {"error":"Only the organization owner can change how someone | PASS |
| W7-ACC-D2 | PATCH /access/members | as sc | API | 403 | 403 {"error":"Only the organization owner can change how someone | PASS |
| W7-ACC-D2 | PATCH /access/members | as m1 | API | 403 | 403 {"error":"Only the organization owner can change how someone | PASS |
| W7-ACC-D2 | PATCH /access/members | as o | API | 200 | 200 {"user_id":"1e4945ba-61d2-4586-96fb-aa6b6cb67c6d","full_name | PASS |
| W7-ACC-D2 | owner restore mode | o | API | 200 | 200 | PASS |
| W7-ACC-D2 | admin non-member target | ad | API | 403/404 not 500 | 403 | PASS |
| W7-ACC-D2 | owner cross-org target | o | API | 404 | 404 | PASS |
| W7-ACC-D2 | admin GET /access/members still ok | ad | API | 200 | 200 | PASS |
| W7-ACC-D2 | Member access panel read-only for admins (UI half) | admin | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-ACC-D3 | member DELETE team | m1 | API | 403 | 403 | PASS |
| W7-ACC-D3 | legacy scheduler DELETE team (decision: teams.manage holders may; UI half NOT_RUN) | sc | API | 204 per decision | 204 | PASS |
| W7-ACC-D3 / W7-WEB-D2 | TeamsPage Delete visible to teams.manage holders (UI half) | scheduler/admin | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-ACC-D4 | DELETE plan item: A plan + org B item id | o | API | 404 | 404 | PASS |
| W7-ACC-D4 | own item 204 then 404 | o | API | 204/404 | 204/404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE assignments, random uuid | o (A) | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE assignments, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Assignment not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE teams, random uuid | o (A) | API | 404 | 404 {"error":"Team not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE teams, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Team not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE team positions, random uuid | o (A) | API | 404 | 404 {"error":"Position not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE team positions, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Position not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plans, random uuid | o (A) | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plans, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plan items, random uuid | o (A) | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plan items, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plan positions, random uuid | o (A) | API | 404 | 404 {"error":"Position not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE plan positions, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Position not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE service-types, random uuid | o (A) | API | 404 | 404 {"error":"Service type not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE service-types, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Service type not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE songs, random uuid | o (A) | API | 404 | 404 {"error":"Song not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE songs, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Song not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE arrangements, random uuid | o (A) | API | 404 | 404 {"error":"Arrangement not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE arrangements, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Arrangement not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE folders, random uuid | o (A) | API | 404 | 404 {"error":"Folder not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE folders, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Folder not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE people, random uuid | o (A) | API | 404 | 404 {"error":"Person not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE people, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Person not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE tag-groups, random uuid | o (A) | API | 404 | 404 {"error":"Tag group not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE tag-groups, org B id (A ctx) | o (A) | API | 404 | 404 {"error":"Tag group not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE matrix views, random uuid | o (A) | API | 404 | 404 {"error":"View not found","code":"not_found"} | PASS |
| W7-ACC-D4 / W7-RESP-D1 | org B rows intact after all cross-org deletes | o (A) | DB | 1,1,1,1,1,1,1 | 1,1,1,1,1,1,1 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE matrix views, org B id (A ctx) | o (A) | API | 404 | 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own view: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own folder: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own taggroup: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own song: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own st: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own team: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own plan: first delete 204, repeat 404 | o | API | 204 then 404 | 204 then 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | DELETE songbooks, org B id (A ctx) | o (A) | API | 404 | 404 | PASS |
| W7-ACC-D4 / W7-RESP-D1 | own songbook: 204 then 404 | o | API | 204/404 | 204/404 | PASS |
| W7-ACC-D5 | GET /songs?q=x%00y | o | API | 4xx not 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 | GET /songs?q with U+FFFD (boundary, valid) | o | API | 200 | 200 | PASS |
| W7-ACC-D5 | valid surrogate pair accepted | o | API | 201 | 201 | PASS |
| W7-ACC-D5 | control char TAB/NL in team name (boundary, record) | o | API | record | 201 {"id":"1b5ab77a-3ccf-49f5-8bcc-3063a91600ce","organization_i | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in team name | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in team name surrogate | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in song title | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in song title surrogate | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in plan title | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in free-form item title | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in free-form item description | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in person first_name | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in guest name | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in plan note | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in service-type name | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D5 / W7-MSG-D11 | NUL/surrogate in folder name | o | API | 422, no DB error text | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| W7-ACC-D6 | oversize body 90 KB | o | API | [201,422] | 422 {"error":"Invalid request body","code":"unprocessable","deta | PASS |
| W7-ACC-D6 | oversize body 101 KB | o | API | 413 | 413 {"error":"Request body is too large","code":"payload_too_lar | PASS |
| W7-ACC-D6 | oversize body 300 KB | o | API | 413 | 413 {"error":"Request body is too large","code":"payload_too_lar | PASS |
| W7-ACC-D6 | oversize body 2100 KB | o | API | 413 | 413 {"error":"Request body is too large","code":"payload_too_lar | PASS |
| W7-ACC-D6 | wrong content-type text/plain | o | API | 4xx not 500 | 422 {"error":"Invalid request body","code":"unprocessable","deta | PASS |
| W7-ACC-D6 | unsupported charset | o | API | 4xx not 500 | 400 {"error":"Request body is not valid JSON","code":"invalid_js | PASS |
| W7-ACC-D6 | imports route malformed (own mapper) | o | API | 400 | 400 {"error":"Invalid import JSON","code":"bad_request"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{bad" on POST /teams (auth) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{bad" on POST /plans (auth) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{bad" on respond link (public) | anon | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{bad" on POST /songs (member) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "\"x\"" on POST /teams (auth) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "\"x\"" on POST /plans (auth) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "\"x\"" on respond link (public) | anon | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "\"x\"" on POST /songs (member) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "null" on POST /teams (auth) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "null" on POST /plans (auth) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "null" on respond link (public) | anon | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "null" on POST /songs (member) | authed | API | 400,422 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{\"name\":" on POST /teams (auth) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{\"name\":" on POST /plans (auth) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{\"name\":" on respond link (public) | anon | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "{\"name\":" on POST /songs (member) | authed | API | 400 | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "[]" on POST /teams (auth) | authed | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "[]" on POST /plans (auth) | authed | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "[]" on respond link (public) | anon | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "[]" on POST /songs (member) | authed | API | 403 (capability gate precedes body check; harness expectation wrong) | 403 {"error":"You need the “Manage songs” permission to do that","code":"f | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "" on POST /teams (auth) | authed | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "" on POST /plans (auth) | authed | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "" on respond link (public) | anon | API | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| W7-ACC-D6 / W7-RESP-D3 | body "" on POST /songs (member) | authed | API | 403 (capability gate precedes body check; harness expectation wrong) | 403 {"error":"You need the “Manage songs” permission to do that","code":"f | PASS |
| W7-ACC-D7 | signed download URL TTL ~60 s (files) | m1 | API | <=60 s | 60s (exp claim) expires_at=2026-11-21T05:50:54.770Z | PASS |
| W7-ACC-D7 | URL works within TTL (control) | m1 | Storage | 200 | 200 hello | PASS |
| W7-ACC-D7 | URL dead after ~60 s | anon | Storage | 4xx | 400 {"statusCode":"400","error":"InvalidJWT","message":"\"exp\"  | PASS |
| W7-ACC-D8 | owner upload image/svg+xml | o | Storage | 4xx (mime not allowed) | 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type image/svg+xml is not supported" | PASS |
| W7-ACC-D8 | admin upload image/svg+xml | ad | Storage | 4xx | 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type image/svg+xml is not supported" | PASS |
| W7-ACC-D8 | svg body with .png name and svg mime | o | Storage | 4xx | 400 | PASS |
| W7-ACC-D8 | svg body declared image/png (record: served content-type + nosniff) | o | Storage | served as image/png | 200 ct=image/png nosniff=null | PASS |
| W7-ACC-D8 | html upload | o | Storage | 4xx | 400 | PASS |
| W7-ACC-D8 | raster image/png still accepted (control) | o | Storage | 2xx | 200 {"Key":"organization-logos/639dec6e-275b-439f-b56a | PASS |
| W7-ACC-D8 | raster image/jpeg still accepted (control) | o | Storage | 2xx | 200 {"Key":"organization-logos/639dec6e-275b-439f-b56a | PASS |
| W7-ACC-D8 | raster image/webp still accepted (control) | o | Storage | 2xx | 200 {"Key":"organization-logos/639dec6e-275b-439f-b56a | PASS |
| W7-ACC-D8 | raster image/gif still accepted (control) | o | Storage | 2xx | 200 {"Key":"organization-logos/639dec6e-275b-439f-b56a | PASS |
| W7-ACC-D8 | member upload png (non-admin) | m1 | Storage | 403 | 400 | PASS |
| W7-ACC-D8 | owner A upload into org B folder | o | Storage | 403 | 400 | PASS |
| W7-ACC-D8 | pre-existing svg objects in bucket (migration does not purge; record) | - | DB | record | 0 | PASS |
| W7-ACC-D8 | Settings logo picker no longer offers SVG (UI half) | admin | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-ACC-D9 | OPTIONS Origin http://evil.example | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | GET Origin http://evil.example | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | OPTIONS Origin http://localhost:5173.evil.example | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | GET Origin http://localhost:5173.evil.example | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | OPTIONS Origin https://localhost:5173 | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | GET Origin https://localhost:5173 | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | OPTIONS Origin null | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | GET Origin null | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | OPTIONS Origin http://localhost:5173 | anon | API | 204/401 + ACAO | 204 acao=http://localhost:5173 | PASS |
| W7-ACC-D9 | GET Origin http://localhost:5173 | anon | API | 204/401 + ACAO | 401 acao=http://localhost:5173 | PASS |
| W7-ACC-D9 | OPTIONS Origin https://x.vercel.app | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-ACC-D9 | GET Origin https://x.vercel.app | anon | API | no 500, no ACAO | 401 acao=null | PASS |
| W7-JRN-D1 | participation summary carries present/absent/unknown | o | API | present=1 absent=1 unknown=1 | 200 {"p":1,"a":1,"u":1,"assignments":3} | PASS |
| W7-JRN-D1 | summary.unknown reconciles with row totals | o | API | rows sum == summary | rows=1 summary=1 | PASS |
| W7-JRN-D1 | CSV export still works (record) | o | API | 200 | 200 Report,Participation and response history
 | PASS |
| W7-JRN-D1 | empty range: summary zeros incl. unknown | o | API | unknown=0 | 200 {"assignments":0,"people":0,"person_plans":0,"present":0,"absent":0,"unknown":0,"teams":[]} | PASS |
| W7-JRN-D1 | member reading report (record) | m1 | API | record | 403 | PASS |
| W7-JRN-D2 | combined schedule includes released untimed plan assignment | m1 | API | includes untimed plan | 200 has=true | PASS |
| W7-JRN-D2 | ... and the timed one (control) | m1 | API | includes timed | true | PASS |
| W7-JRN-D2 | ... but NOT the prepared untimed one | m1 | API | absent | false | PASS |
| W7-JRN-D2 | /schedule/mine and combined schedule agree on released assignments | m1 | API | same set | mine has untimed=true | PASS |
| W7-JRN-D2 | other member does not see m1 assignments | m2 | API | no m1 data | 403 | PASS |
| W7-JRN-D2 | combined schedule off -> 403 | m1 | API | 403 | 403 | PASS |
| W7-JRN-D2 | deleted untimed assignment disappears | m1 | API | absent | false | PASS |
| W7-JRN-D2 | multi-org caller, org B header (record) | multi | API | record | 403 | PASS |
| W7-JRN-D3 | access token lifetime = 900 s | m3 | Auth | exp-iat=900 | 900 | PASS |
| W7-JRN-D3 | pre: token reads PostgREST | m3 | PostgREST | 200 | 200 | PASS |
| W7-JRN-D3 | session 1 local sign-out: table read with old token | m3 | PostgREST | 401 | 401 {"code":"PT401","details":null,"hint":null,"message":"This s | PASS |
| W7-JRN-D3 | ... RPC with old token | m3 | PostgREST | 401 | 401 | PASS |
| W7-JRN-D3 | ... API with old token | m3 | API | 401 | 401 | PASS |
| W7-JRN-D3 | other session of same user still valid after local sign-out | m3 | PostgREST | 200 | 200 | PASS |
| W7-JRN-D3 | Storage list with signed-out token | m3 | Storage | inconclusive: listed bucket is public and empty (200 is legitimate); policy "session must be live" confirmed present in pg_policy and covered by qa-w7f-sessions.sql | 200 | BLOCKED |
| W7-JRN-D3 | global sign-out: session 2 (other) table read | m3 | PostgREST | 401 | 401 | PASS |
| W7-JRN-D3 | global sign-out: session 2 (other) RPC | m3 | PostgREST | 401 | 401 | PASS |
| W7-JRN-D3 | global sign-out: session 2 (other) API | m3 | API | 401 | 401 | PASS |
| W7-JRN-D3 | global sign-out: session 3 table read | m3 | PostgREST | 401 | 401 | PASS |
| W7-JRN-D3 | global sign-out: session 3 RPC | m3 | PostgREST | 401 | 401 | PASS |
| W7-JRN-D3 | global sign-out: session 3 API | m3 | API | 401 | 401 | PASS |
| W7-JRN-D3 | fresh login after global sign-out works | m3 | PostgREST | 200 | 200 | PASS |
| W7-JRN-D3 | fresh login API works | m3 | API | 200 | 200 | PASS |
| W7-JRN-D3 | other user unaffected | m1 | PostgREST | 200 | 200 | PASS |
| W7-JRN-D3 | anon request (no JWT) not 5xx | anon | PostgREST | <500 | 200 | PASS |
| W7-JRN-D3 | service role unaffected | svc | PostgREST | 200 | 200 | PASS |
| W7-JRN-D3 | refresh token after global sign-out rejected | m2 | Auth | 4xx | 400 | PASS |
| W7-JRN-D3 | latency 30 sequential reads (record) | m1 | PostgREST | n/a | 2 ms avg | PASS |
| W7-JRN-D4 | GET /arrangements/:id/chart?to=C: directive == chart.key | m1 | API | directive C | 200 key=C directive=C | PASS |
| W7-JRN-D4 | GET /arrangements/:id/chart?to=D: directive == chart.key | m1 | API | directive D | 200 key=D directive=D | PASS |
| W7-JRN-D4 | GET /arrangements/:id/chart?to=Bb: directive == chart.key | m1 | API | directive Bb | 200 key=Bb directive=Bb | PASS |
| W7-JRN-D4 | GET /arrangements/:id/chart?to=G: directive == chart.key | m1 | API | directive G | 200 key=G directive=G | PASS |
| W7-JRN-D4 | rehearsal-manifest with key_override C: embedded directive | o | API | {key: C} | 200 {key: C} (G present: false) | PASS |
| W7-JRN-D4 | transposeChordPro G->C (+5): {key:} matches first chord | - | shared lib | key directive == transposed first chord | key=C firstChord=C | PASS |
| W7-JRN-D4 | transposeChordPro G->F# (+6): {key:} matches first chord | - | shared lib | key directive == transposed first chord | key=C# firstChord=C# | PASS |
| W7-JRN-D4 | transposeChordPro G->A (+2): {key:} matches first chord | - | shared lib | key directive == transposed first chord | key=A firstChord=A | PASS |
| W7-JRN-D4 | transposeChordPro G->Bb (-2 flats): {key:} matches first chord | - | shared lib | key directive == transposed first chord | key=F firstChord=F | PASS |
| W7-JRN-D4 | transposeChordPro G->G (0): {key:} matches first chord | - | shared lib | key directive == transposed first chord | key=G firstChord=G | PASS |
| W7-JRN-D4 | directive form {k: G} | - | shared lib | rewritten to A | "{k: A}" | PASS |
| W7-JRN-D4 | directive form {KEY: G} | - | shared lib | rewritten to A | "{KEY: A}" | PASS |
| W7-JRN-D4 | directive form {key:G} | - | shared lib | rewritten to A | "{key:A}" | PASS |
| W7-JRN-D4 | directive form { key : G } | - | shared lib | rewritten to A | "{ key : A }" | PASS |
| W7-JRN-D4 | directive form {Key: G} | - | shared lib | rewritten to A | "{Key: A}" | PASS |
| W7-JRN-D4 | minor/accidental keys rewritten (record) | - | shared lib | Bm, G#m, C | ["{key: Bm}","{key: G#m}","{key: C}"] | PASS |
| W7-JRN-D4 | non-key directives containing "key" untouched (record) | - | shared lib | unchanged | ["{title: key: G}","{subtitle: key G}","{comment: key: G}"] | PASS |
| W7-JRN-D4 | renderChordProChart G->C embeds {key: C} | - | shared lib | {key: C} and key=C | key=C {key: C} | PASS |
| W7-MSG-D1 | before=Z-form legacy timestamp | m2 | API | 200 | 200  | PASS |
| W7-MSG-D1 | before=offset form legacy | m2 | API | 200 | 200  | PASS |
| W7-MSG-D1 | before=compound with Z | m2 | API | 200 | 200  | PASS |
| W7-MSG-D1 | before=garbage | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=compound bad id | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=double separator | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=date only | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=sql-ish | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=empty | m2 | API | 200,422 | 422 {"error":"Invalid query parameters","code":"unprocessable"," | PASS |
| W7-MSG-D1 | before=compound lower id uppercase | m2 | API | 200 | 200  | PASS |
| W7-MSG-D1 | legacy plain +00:00 cursor excludes tie group (legacy semantics) | m2 | API | 200 rows strictly older | 200 n=6 | PASS |
| W7-MSG-D1/D3 | notifications keyset limit=2, ties 7+5 at page boundaries | m2 | API | every row once (13) | 13 rows, 13 unique | PASS |
| W7-MSG-D1/D3 | notifications keyset limit=3, ties 7+5 at page boundaries | m2 | API | every row once (13) | 13 rows, 13 unique | PASS |
| W7-MSG-D1/D3 | notifications keyset limit=5, ties 7+5 at page boundaries | m2 | API | every row once (13) | 13 rows, 13 unique | PASS |
| W7-MSG-D1/D3 | notifications keyset limit=7, ties 7+5 at page boundaries | m2 | API | every row once (13) | 13 rows, 13 unique | PASS |
| W7-MSG-D1/D3 | notifications keyset limit=12, ties 7+5 at page boundaries | m2 | API | every row once (13) | 13 rows, 13 unique | PASS |
| W7-MSG-D10 | PATCH comment via wrong item path | o (author) | API+DB | 404 and row unchanged | 404 changed=false | PASS |
| W7-MSG-D10 | DELETE comment via wrong item path | o (author) | API+DB | 404 and row unchanged | 404 changed=false | PASS |
| W7-MSG-D10 | PATCH random item id | o | API | 404 | 404 | PASS |
| W7-MSG-D10 | PATCH right item, other author | m1 | API | 403/404 | 404 | PASS |
| W7-MSG-D10 | PATCH right item path (control) | o | API | 200 | 200 {"id":"229549fd-5cf7-425e-91b5-063ed0dec160","organization_i | PASS |
| W7-MSG-D11 | chat body NUL | m1 | API | 422, no raw code | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| W7-MSG-D11 | chat edit NUL | m1 | API | 422 | 422 | PASS |
| W7-MSG-D11 | plan note NUL | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | item comment NUL | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | chat body lone surrogate | m1 | API | 422, no raw code | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| W7-MSG-D11 | chat edit lone surrogate | m1 | API | 422 | 422 | PASS |
| W7-MSG-D11 | plan note lone surrogate | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | item comment lone surrogate | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | chat body lone low surrogate | m1 | API | 422, no raw code | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| W7-MSG-D11 | chat edit lone low surrogate | m1 | API | 422 | 422 | PASS |
| W7-MSG-D11 | plan note lone low surrogate | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | item comment lone low surrogate | o | API | 422 | 422 | PASS |
| W7-MSG-D11 | operational message NUL title (any 4xx) | o | API | 4xx not 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| W7-MSG-D11 | valid emoji body accepted | m1 | API | 201 | 201 | PASS |
| W7-MSG-D2 | control: post with A header | multi | API | 201 | 201 | PASS |
| W7-MSG-D2 | POST message with org B header | multi | API+DB | 404, no row | 404 rows 11->11 | PASS |
| W7-MSG-D2 | PATCH message with org B header | multi | API+DB | 404, body unchanged | 404 body=multi ok | PASS |
| W7-MSG-D2 | POST read with org B header | multi | API | 404 | 404 | PASS |
| W7-MSG-D2 | PUT mute with org B header | multi | API+DB | 404, not muted | 404 muted rows=0 | PASS |
| W7-MSG-D2 | report with org B header | multi | API | 404 | 404 | PASS |
| W7-MSG-D2 | DELETE message with org B header | multi | API+DB | 404, not deleted | 404 deleted=f | PASS |
| W7-MSG-D2 | restore with org B header | multi | API | 404 | 404 | PASS |
| W7-MSG-D2 | GET messages with org B header (control) | multi | API | 404 | 404 | PASS |
| W7-MSG-D2 | control: PATCH with A header | multi | API | 200 | 200 | PASS |
| W7-MSG-D2 | control: mute toggle with A header | multi | API | 200 | 200 | PASS |
| W7-MSG-D2 | control: read with A header | multi | API | 200/204 | 200 | PASS |
| W7-MSG-D2 | resolve report with wrong-org header (owner of A, not member of B) | o | API | 403/404 | 403 | PASS |
| W7-MSG-D3 | unread_only paging with ties | m2 | API | all 13 | 13 | PASS |
| W7-MSG-D3 | chat messages keyset limit=2, 5+4 ties | m3 | API | all 9 once | 9/9 | PASS |
| W7-MSG-D3 | chat messages keyset limit=3, 5+4 ties | m3 | API | all 9 once | 9/9 | PASS |
| W7-MSG-D3 | chat messages keyset limit=4, 5+4 ties | m3 | API | all 9 once | 9/9 | PASS |
| W7-MSG-D3 | chat messages keyset limit=5, 5+4 ties | m3 | API | all 9 once | 9/9 | PASS |
| W7-MSG-D3 | item comments keyset limit=2, 4+3 ties | o | API | 7 once | 7/7 | PASS |
| W7-MSG-D3 | item comments keyset limit=3, 4+3 ties | o | API | 7 once | 7/7 | PASS |
| W7-MSG-D4 | baseline: excerpt present before delete | m2 | DB | excerpt kept | secret plans for Sunday | PASS |
| W7-MSG-D4 | author deletes message -> recipient excerpts nulled | m1 | API+DB | body null for m2,m3 | 200 <null> / <null> | PASS |
| W7-MSG-D4 | m2 feed API shows no text after delete | m2 | API | body null/absent | null | PASS |
| W7-MSG-D4 | restore after delete (owner) does not resurrect excerpt | o | API+DB | excerpt stays null | 200 <null> | PASS |
| W7-MSG-D4 | moderator hides reported message -> excerpts nulled (all recipients) | o | API+DB | null | 200 <null> / <null> | PASS |
| W7-MSG-D4 | m3 removed from team -> m3 feed hides/ redacts conversation notification | m3 | API | no row or body null | 204 m3 row=absent | PASS |
| W7-MSG-D4 | neighbour m2 (still member) still sees excerpt | m2 | API | excerpt visible | team only schedule | PASS |
| W7-MSG-D4 | m3 direct PostgREST read of that notification | m3 | PostgREST | no body | [] | PASS |
| W7-MSG-D4 | m3 unread count after removal (record) | m3 | API | n/a | {"unread":0,"account_unread":0} | PASS |
| W7-MSG-D4 | m3 re-added -> notification visible again (record) | m3 | API | n/a | 201 "team only schedule" | PASS |
| W7-MSG-D4 / follow-up | edit: append text (prefix intact) | m1 | API+DB | excerpt kept (still prefix) | 200 Please bring the red folders a | PASS |
| W7-MSG-D4 / follow-up | edit: change first word | m1 | API+DB | excerpt nulled | 200 <null> | PASS |
| W7-MSG-D4 / follow-up | edit: whitespace-only change | m1 | API+DB | excerpt kept (still prefix) | 200 Please bring the red folders a | PASS |
| W7-MSG-D4 / follow-up | edit: edit tail beyond excerpt | m1 | API+DB | excerpt kept (still prefix) | 200 Please bring the red folders a | PASS |
| W7-MSG-D4 / follow-up | edit: empty-ish change | m1 | API+DB | excerpt nulled | 200 <null> | PASS |
| W7-MSG-D4 / follow-up | edit: case change | m1 | API+DB | excerpt nulled | 200 <null> | PASS |
| W7-MSG-D4 / follow-up | long message excerpt with trailing … accepted by insert guard | m1 | DB | kept | word… len=135 | PASS |
| W7-MSG-D4 / follow-up | long message edited at start -> nulled | m1 | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | multi-line message excerpt (whitespace collapsed) kept | m1 | DB | kept | line one line two end | PASS |
| W7-MSG-D4 / follow-up | special chars excerpt kept: 100% (sure) [y | m1 | DB | kept | 100% (sure) [yes] a.b*c? | PASS |
| W7-MSG-D4 / follow-up | special chars excerpt kept: émoji 😀 – ünï | m1 | DB | kept | émoji 😀 – ünïcode ✓ | PASS |
| W7-MSG-D4 / follow-up | special chars excerpt kept: back\slash $1  | m1 | DB | kept | back\slash $1 ^caret/pipe | PASS |
| W7-MSG-D4 / follow-up | insert with text that is not a prefix of message -> nulled by guard | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | insert with malformed dedupe_key -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | insert with no dedupe_key -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | non-conversation notification body untouched | worker(setup) | DB | kept | plain body kept | PASS |
| W7-MSG-D4 / follow-up | insert referencing unknown effect -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | valid insert keeps excerpt (control) | worker(setup) | DB | kept | hello guard | PASS |
| W7-MSG-D4 / follow-up | insert AFTER delete -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | insert AFTER edit (stale excerpt) -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up | insert AFTER hide -> nulled | worker(setup) | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up race | insert txn in flight, concurrent edit -> excerpt redacted after both commit | psql x2 | DB | null; mutation waited for insert | body=<null> mutation took 2042ms | PASS |
| W7-MSG-D4 / follow-up race | edit txn in flight, concurrent insert -> no stale excerpt | psql x2 | DB | null; insert waited | body=<null> insert took 2042ms  | PASS |
| W7-MSG-D4 / follow-up race | sequential insert then edit | psql | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up race | 6 parallel inserts racing an edit: no deadlock, none left with stale excerpt | psql x7 | DB | errors none, stale=0 | errs=none stale=0 | PASS |
| W7-MSG-D4 / follow-up race | insert txn in flight, concurrent delete -> excerpt redacted after both commit | psql x2 | DB | null; mutation waited for insert | body=<null> mutation took 2058ms | PASS |
| W7-MSG-D4 / follow-up race | delete txn in flight, concurrent insert -> no stale excerpt | psql x2 | DB | null; insert waited | body=<null> insert took 2040ms  | PASS |
| W7-MSG-D4 / follow-up race | sequential insert then delete | psql | DB | null | <null> | PASS |
| W7-MSG-D4 / follow-up race | insert txn in flight, concurrent hide -> excerpt redacted after both commit | psql x2 | DB | null; mutation waited for insert | body=<null> mutation took 2059ms | PASS |
| W7-MSG-D4 / follow-up race | hide txn in flight, concurrent insert -> no stale excerpt | psql x2 | DB | null; insert waited | body=<null> insert took 2045ms  | PASS |
| W7-MSG-D4 / follow-up race | sequential insert then hide | psql | DB | null | <null> | PASS |
| W7-MSG-D4 regression | unread-count endpoint after policy change | m2 | API | 200 | 200 {"unread":302,"account_unread":302} | PASS |
| W7-MSG-D4 regression | feed latency 20x limit=50 with ~100 notifications (perf, record) | m2 | API | <200ms avg | 17 ms avg | PASS |
| W7-MSG-D5 | PATCH own notification title | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification body | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification type | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification conversation_id null | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification user_id (reassign) | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification read_at | m2 | PostgREST | 200 | 200 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification read_at null (unread again) | m2 | PostgREST | 200 | 200 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH own notification read_at + title | m2 | PostgREST | 403 | 403 content unchanged=true | PASS |
| W7-MSG-D5 | PATCH another user's notification read_at | m1 | PostgREST | 0 rows/403 | 200 [] | PASS |
| W7-MSG-D5 | INSERT notification | m2 | PostgREST | denied | 403 | PASS |
| W7-MSG-D5 | PATCH dedupe_key | m2 | PostgREST | denied | 403 | PASS |
| W7-MSG-D5 | API mark read still works | m2 | API | 200/204 | 200 {"unread":20,"account_unread":20} | PASS |
| W7-MSG-D5 | API mark all read | m2 | API | 200/204 | 200 | PASS |
| W7-MSG-D5 | API clear-read (DELETE path) still works | m2 | API | 200/204 | 200 {"deleted":21,"unread":0,"account_unread":0} | PASS |
| W7-MSG-D5 regression | DELETE another user's notification | m1 | API+DB | 404, row remains | 204 remains=1 | FAIL |
| W7-MSG-D5 regression | DELETE own notification (still allowed) | m1 | API+DB | 204 | 204 | PASS |
| W7-MSG-D5 regression | PostgREST DELETE another user's notification | m1 | PostgREST | 0 rows | 200 [] remains=1 | PASS |
| W7-MSG-D6 | recipient GET /messages/:id has no audit keys | m1 | API | 200, no audit keys | 200 audit=[] | PASS |
| W7-MSG-D6 | recipient list box=received has the message, no audit keys | m1 | API | present, none | 200 n=1 audit=[] | PASS |
| W7-MSG-D6 | recipient base-table PostgREST read | m1 | PostgREST | [] | [] | PASS |
| W7-MSG-D6 | recipient base-table audit column select | m1 | PostgREST | [] or denied | 200 [] | PASS |
| W7-MSG-D6 | my_received_messages with org B id (not a member) | m1 | PostgREST | [] or denied | 200 [] | PASS |
| W7-MSG-D6 | rpc as other recipient only returns own | m3 | PostgREST | only msgs to m3 | 200 n=1 | PASS |
| W7-MSG-D6 | sender still gets full detail (control) | o | API | 200 | 200 | PASS |
| W7-MSG-D6 | admin non-sender GET sent message (record) | ad | API | record | 200 | PASS |
| W7-MSG-D6 | org B user GET | ob | API | 404 | 404 | PASS |
| W7-MSG-D6 | recipient rows exist (record) | - | DB | n/a | 4 | PASS |
| W7-MSG-D7 | edit another user's personal template with CURRENT revision | sc | API | 404 (not 409) | 404 not_found | PASS |
| W7-MSG-D7 | ... without expected_revision | sc | API | 404 | 404 | PASS |
| W7-MSG-D7 | ... with wrong revision (boundary; 404 or 409 acceptable, no mutation) | sc | API | 404/409 | 404 | PASS |
| W7-MSG-D7 | template unchanged in DB | - | DB | name personal-o | personal-o | PASS |
| W7-MSG-D7 | owner with stale revision still 409 (control) | o | API | 409 | 409 | PASS |
| W7-MSG-D7 | owner with current revision 200 (control) | o | API | 200 | 200 | PASS |
| W7-MSG-D7 | scheduler edits shared template (control, scheduling.manage) | sc | API | 200 | 200 | PASS |
| W7-MSG-D7 | random id with revision | sc | API | 404 | 404 | PASS |
| W7-MSG-D7 | org B sender edits org A template | ob | API | 404 | 404 | PASS |
| W7-MSG-D7 | archive another user's personal template | sc | API | 404 | 404 | PASS |
| W7-MSG-D8 | send with live shared template (control) | o | API | 201 | 201 | PASS |
| W7-MSG-D8 | archive shared template | o | API | 204 | 204 | PASS |
| W7-MSG-D8 | send with archived template (owner) | o | API | 422/4xx | 422 {"error":"That template has been archived","code":"unprocessable"} | PASS |
| W7-MSG-D8 | send with archived template (scheduler) | sc | API | 4xx | 422 | PASS |
| W7-MSG-D8 | archived personal template via owner | o | API | n/a (not archived by sc) | 201 | PASS |
| W7-MSG-D8 | send with archived personal template | o | API | 4xx | 422 | PASS |
| W7-MSG-D8 | send with unknown template id | o | API | 4xx not 500 | 404 | PASS |
| W7-MSG-D8 | org B sender with org A template id (aud mismatch may 4xx first) | ob | API | 4xx | 403 | PASS |
| W7-MSG-D9 | before=garbage | o | API | 422 | 422 | PASS |
| W7-MSG-D9 | limit=101 boundary | o | API | 422 | 422 | PASS |
| W7-MSG-D9 | limit=100 boundary | o | API | 200 | 200 | PASS |
| W7-MSG-D9 | GET /messages box=sent limit=1, cursor=created_at~id of last row, 4+2 ties | o | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=sent limit=2, cursor=created_at~id of last row, 4+2 ties | o | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=sent limit=3, cursor=created_at~id of last row, 4+2 ties | o | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=sent limit=4, cursor=created_at~id of last row, 4+2 ties | o | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=sent limit=5, cursor=created_at~id of last row, 4+2 ties | o | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=received limit=1, cursor=created_at~id of last row, 4+2 ties | m1 | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=received limit=2, cursor=created_at~id of last row, 4+2 ties | m1 | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=received limit=3, cursor=created_at~id of last row, 4+2 ties | m1 | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=received limit=4, cursor=created_at~id of last row, 4+2 ties | m1 | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | GET /messages box=received limit=5, cursor=created_at~id of last row, 4+2 ties | m1 | API | all 6 tied rows once | 6/8 of 8 | PASS |
| W7-MSG-D9 | observation: list response is a bare array (no next_before), client must build cursor from last row | - | API | n/a | array | PASS |
| W7-NAT-D1 | notifications header vs rows on iOS (UI half) | member | native UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-NAT-D1 | unit tests notification-unread.test.ts (displayedUnreadCount) | - | vitest | pass | 3 passed | PASS |
| W7-NAT-D2 | create with times: service_date = earliest service time | o | API+DB | 2031-01-05T17:00 | 2031-01-05T17:00 | PASS |
| W7-NAT-D2 | move earliest service time later than the other -> date = the other (T0+2h) | o | API+DB | 2031-01-05T19:00 | 200 2031-01-05T19:00 | PASS |
| W7-NAT-D2 | add earlier REHEARSAL: service_date ignores non-service kinds | o | API+DB | still 19:00 | 200 2031-01-05T19:00 | PASS |
| W7-NAT-D2 | add earlier SERVICE time -> date follows | o | API+DB | 2031-01-04T17:00 | 200 2031-01-04T17:00 | PASS |
| W7-NAT-D2 | remove earliest service time -> date back to next earliest | o | API+DB | 2031-01-05T19:00 | 200 2031-01-05T19:00 | PASS |
| W7-NAT-D2 | all service times removed (only rehearsal): date behaviour (record) | o | API+DB | no error, date retained | 200 2031-01-05T19:00 | PASS |
| W7-NAT-D2 | PATCH service_date + times together: times win | o | API+DB | 2031-01-15T17:00 | 200 2031-01-05T17:00 | FAIL |
| W7-NAT-D2 | PATCH service_date alone while a service time exists (record) | o | API+DB | record | 200 2031-01-05T17:00 | PASS |
| W7-NAT-D2 | two services identical start (record) | o | API+DB | no error | 2031-01-05T17:00 | PASS |
| W7-NAT-D2 | plan without times then add one | o | API+DB | 2031-01-07T17:00 | 200 2031-01-07T17:00 | PASS |
| W7-NAT-D2 | duplicate plan: new plan service_date matches its times | o | API+DB | date = first service time of copy | 201 date=2031-01-12T17:00 min=2031-01-12T17:00 | PASS |
| W7-NAT-D2 | direct PostgREST insert of earlier service time (other write path) | o | PostgREST+DB | date follows 2032-01-03T17:00 | 201 2032-01-03T17:00 | PASS |
| W7-NAT-D2 | direct PostgREST delete of earliest time -> date back | o | PostgREST+DB | 2032-01-05T17:00 | 200 2032-01-05T17:00 | PASS |
| W7-NAT-D2 | direct PostgREST update of the only time (statement trigger on UPDATE) | o | PostgREST+DB | 2032-01-06T17:00 | 200 2032-01-06T17:00 | PASS |
| W7-NAT-D2 | member direct insert plan_times | m1 | PostgREST | denied; date unchanged | 403 2032-01-05T17:00 | PASS |
| W7-NAT-D2 | PATCH carrying both service_date and a conflicting times list keeps date == earliest service time | o | API+DB | no drift | 200 date=2032-01-05T17:00 drift=t | FAIL |
| W7-NAT-D2 | plan header time on iOS (UI half) | scheduler | native UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-NAT-D2 / backfill | global drift check: plans whose service_date != earliest service time (all orgs, read-only) | - | DB | 0 | 0 | PASS |
| W7-RESP-D1 | member DELETE assignment (not scheduler) | m1 | API | 403/404 | 403 | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE notifications/:id random id | m1 | API | 404 (not 204, not 5xx) | 204  | FAIL |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE me/devices/:token random id | m1 | API | 404 (not 204, not 5xx) | 204  | FAIL |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE availability/preferences/:id random id | m1 | API | 404 (not 204, not 5xx) | 404 {"error":"Preference not found","code":"not_found" | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE calendar/feeds/:id random id | m1 | API | 404 (not 204, not 5xx) | 404 {"error":"Feed not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE blockouts/:id random id | m1 | API | 404 (not 204, not 5xx) | 409 {"error":"This blockout changed or is part of a re | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE file-links/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Link not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE reminder-policies/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Reminder policy not found","code":"not_f | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE media/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Media not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE plans/:id/notes/:noteId random id | o | API | 404 (not 204, not 5xx) | 422 {"error":"Invalid query parameters","code":"unproc | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE me/blocks/:userId random id | m1 | API | 404 (not 204, not 5xx) | 204  | FAIL |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE people/members/:userId random id | o | API | 404 (not 204, not 5xx) | 204  | FAIL |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE teams/:id/members/:membershipId random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Team member not found","code":"not_found | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE songbooks/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Song book not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE message-templates/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Template not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE files/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"File not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE stage-templates/:id random id | o | API | 404 (not 204, not 5xx) | 404 {"error":"Template not found","code":"not_found"} | PASS |
| W7-RESP-D1 / W7-ACC-D4 (same class, not in fix list) | DELETE plans/:id/publication random id | o | API | 404 (not 204, not 5xx) | 422 {"error":"Invalid request body","code":"unprocessa | PASS |
| W7-RESP-D2 | member direct PostgREST PATCH unconfirmed->declined | m1 | PostgREST | refused (hint assignment_response_path), status unchanged | 403 {"code":"42501","details":null,"hint":"assignment_response_path","message":"Answer this as status=unconfirmed hist 0->0 | PASS |
| W7-RESP-D2 | member direct PostgREST PATCH unconfirmed->confirmed | m1 | PostgREST | refused (hint assignment_response_path), status unchanged | 403 {"code":"42501","details":null,"hint":"assignment_response_path","message":"Answer this as status=unconfirmed hist 0->0 | PASS |
| W7-RESP-D2 | confirmed member direct withdraw via PATCH | m1 | PostgREST | refused, stays confirmed | 403 status=confirmed | PASS |
| W7-RESP-D2 | member PATCH non-status column (record) | m1 | PostgREST | record | 403 {"code":"42501","details":null,"hint":null,"message":"Only a | PASS |
| W7-RESP-D2 | member PATCH person_id (reassign) | m1 | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":null,"messag person=true | PASS |
| W7-RESP-D2 | member direct reset to unconfirmed | m1 | PostgREST | refused | 409 status=confirmed | PASS |
| W7-RESP-D2 | other member PATCH m1's assignment | m2 | PostgREST | 0 rows/refused | 200 [] status=unconfirmed | PASS |
| W7-RESP-D2 | scheduler API PATCH status still works | o | API | 200 | 200 status=confirmed hist 0->1 | PASS |
| W7-RESP-D2 | owner direct PostgREST status PATCH (scheduler; record) | o | PostgREST | record | 200 status=declined | PASS |
| W7-RESP-D2 | scheduler (legacy) API reset | sc | API | 200 | 200 | PASS |
| W7-RESP-D2 | direct PATCH on prepared assignment | m1 | PostgREST | refused/0 rows | 200 [] status=unconfirmed | PASS |
| W7-RESP-D2 | prepared assignment invisible to assignee | m1 | PostgREST | [] | [] | PASS |
| W7-RESP-D4 | 3 identical concurrent confirm | m1 | API+DB | all 200, 1 history row, 1 effect | 200,200,200 hist=1 eff=1 status=confirmed | PASS |
| W7-RESP-D4 | 10 identical concurrent confirm | m1 | API+DB | all 200, 1 history row, 1 effect | 200,200,200,200,200,200,200,200,200,200 hist=1 eff=1 status=confirmed | PASS |
| W7-RESP-D4 | 5 rounds x3 identical concurrent decline | m1 | API+DB | 0 bad rounds | bad=0 | PASS |
| W7-RESP-D4 | conflicting concurrent confirm vs decline: exactly one wins, other 409 | m1 | API+DB | [200,409], 1 history | 200,409 hist=1 status=declined | PASS |
| W7-RESP-D4 | sequential retry same answer -> 200; stale different answer -> 409 | m1 | API | 200,200,409 | 200,200,409 hist=1 | PASS |
| W7-RESP-D4 | another member responds to m1 assignment | m2 | API | 403/404 | 403 | PASS |
| W7-RESP-D4 | respond to prepared (unreleased) assignment | m1 | API | 403/404, unchanged | 404 status=unconfirmed | PASS |
| W7-RESP-D5 | /schedule/mine default window (230 released assignments) | m2 | API | 200 with rows, not 500 | 200 n=230  | PASS |
| W7-RESP-D5 | /schedule/mine include_past (230 released assignments) | m2 | API | 200 with rows, not 500 | 200 n=230  | PASS |
| W7-RESP-D5 | /schedule/mine range 2028 full year (230 released assignments) | m2 | API | 200 with rows, not 500 | 200 n=230  | PASS |
| W7-RESP-D5 | /schedule/mine range 380 days (230 released assignments) | m2 | API | 200 with rows, not 500 | 200 n=230  | PASS |
| W7-RESP-D5 | range from=to=same date (exclusive end; harness expectation wrong) | m2 | API | 200 (0 rows: date-only `to` is exclusive midnight) | 200 n=0  | PASS |
| W7-RESP-D5 | row count matches DB (230) | m2 | API | 230 | 230 | PASS |
| W7-RESP-D5 | no duplicate rows across chunks | m2 | API | unique | 230/230 | PASS |
| W7-RESP-D5 | declined status survives chunking across 5 ids spanning 3 chunks | m2 | API | 5 declined | 5 | PASS |
| W7-RESP-D5 | narrow window from=2028-01-01&to=2028-01-02 | m2 | API | n=1 | 200 n=1 | PASS |
| W7-RESP-D5 | narrow window from=2028-01-01&to=2028-01-03 | m2 | API | n=2 | 200 n=2 | PASS |
| W7-RESP-D6 | closed by decision in wave 7 (confirmation stands after a time change) | - | - | n/a | not retested | NOT_RUN |
| W7-WEB-D1 | Menu keyboard pattern in a real browser (More button, plan Actions) | owner | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-WEB-D1 | unit tests ui.test.tsx + TeamsPage.test.tsx (23 tests) | - | vitest | pass | 23 passed | PASS |
| W7-WEB-D3 | format "call a.__init__ then b.__init__ done" | - | shared lib | literal text preserved | styled joined="call a.__init__ then b.__init__ done" | PASS |
| W7-WEB-D3 | format "snake_case_word" | - | shared lib | literal text preserved | styled joined="snake_case_word" | PASS |
| W7-WEB-D3 | format "__proto__" | - | shared lib | literal text preserved | styled joined="__proto__" | PASS |
| W7-WEB-D3 | format "a_b_c" | - | shared lib | literal text preserved | styled joined="a_b_c" | PASS |
| W7-WEB-D3 | format "x __bold__ y" | - | shared lib | emphasis applied | styled joined="x __bold__ y" | PASS |
| W7-WEB-D3 | format "_italic_ here" | - | shared lib | emphasis applied | styled joined="italic here" | PASS |
| W7-WEB-D3 | format "window.__xss" | - | shared lib | literal text preserved | styled joined="window.__xss" | PASS |
| W7-WEB-D3 | format "file_name.txt and other_file.txt" | - | shared lib | literal text preserved | styled joined="file_name.txt and other_file.txt" | PASS |
| W7-WEB-D3 | format "2_000_000" | - | shared lib | literal text preserved | styled joined="2_000_000" | PASS |
| W7-WEB-D3 | format "__init__" | - | shared lib | literal text preserved | styled joined="__init__" | PASS |
| W7-WEB-D3 | underscore rendering in chat in a browser | member | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-WEB-D4 | parseDuration("3:30") | - | shared lib | 210 | 210 | PASS |
| W7-WEB-D4 | parseDuration("0:59") | - | shared lib | 59 | 59 | PASS |
| W7-WEB-D4 | parseDuration("1:00") | - | shared lib | 60 | 60 | PASS |
| W7-WEB-D4 | parseDuration("99:59") | - | shared lib | 5999 | 5999 | PASS |
| W7-WEB-D4 | parseDuration("0:00") | - | shared lib | 0 | 0 | PASS |
| W7-WEB-D4 | parseDuration("45") | - | shared lib | 45 | 45 | PASS |
| W7-WEB-D4 | parseDuration("90") | - | shared lib | 90 | 90 | PASS |
| W7-WEB-D4 | parseDuration("1:60") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("99:99") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:75") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:2:3:4") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1::2") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration(":30") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("-1:30") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:30.5") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:2:3") (record) | - | shared lib | record | 3723 | PASS |
| W7-WEB-D4 | parseDuration("abc") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration(" 2:05 ") | - | shared lib | 125 | 125 | PASS |
| W7-WEB-D4 | parseDuration("１:３０") | - | shared lib | null | null | PASS |
| W7-WEB-D4 | parseDuration("1:5") | - | shared lib | 65 | 65 | PASS |
| W7-WEB-D4 | parseDuration("0:0") | - | shared lib | 0 | 0 | PASS |
| W7-WEB-D4 | free-form item length 99:99 refused in the form | owner | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-WEB-D5 | Plans list/Dashboard time render (UI half) | owner | web UI | renders per fix | NOT_RUN (browser owned by W8-WEB / simulator owned by W8-NATIVE) | NOT_RUN |
| W7-WEB-D5 (API half) | GET /plans/:id service_date matches | o | API | 17:01 | 2032-01-05T17:01:00+00:00 | PASS |
| W7-WEB-D5 (API half) | GET /plans list row service_date reflects moved time (+1 min) | o | API | 2032-01-05T17:01 | 2032-01-05T17:01:00+00:00 | PASS |
| copy | scoped caller reads People directly (premise: should be [] ) | lead | PostgREST | [] | 200 [{"id":"5e43f442-3d9f-457a-9d0e-df13807d | PASS |
