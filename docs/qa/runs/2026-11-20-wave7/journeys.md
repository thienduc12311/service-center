# QA-16 cross-feature acceptance journeys (JOURNEY-01..07), wave 7

Package: QA-16 · plan `docs/plans/admin-mobile-test-plan.md` §10 · commit `473fb69` (`main`, branch `feature/qa-wave7`, worktree `/Users/nguyen/orca/workspaces/service-center/seal`, tree clean; no code, migration or config changed).
Date: 2026-11-20 · Node 26.13.1 · local Supabase (`supabase_db_service-center`), API `http://localhost:4000` (email `simulated`, push disabled/no provider keys, so every delivery says `simulated`/`skipped`, never `sent`), web `:5173` not used (browser belongs to W7-WEB).
Method: every journey step was driven over HTTP with the acting user's own bearer token (the same REST API web and mobile call), plus caller-token PostgREST/Storage probes for permission evidence. Service role / `psql` was used only for setup (first owners via `private.create_church`, org memberships, one known respond-token hash, lease/expiry clock states, post-hoc cleanup) and for read-only persisted-state assertions. Passwords are only in the scratchpad (`.../scratchpad/journey/creds.json`); none appear here.

**No P0.** No cross-tenant leak, no prepared-assignment exposure, no unauthorized write, no lost write, no overfill was observed in 300 executed step rows. Four P2 defects (below).

## Totals

| Journey | Rows | PASS | FAIL | NOT_RUN | N/A | Verdict |
|---|---|---|---|---|---|---|
| JOURNEY-01 | 47 | 45 | 0 | 2 | 0 | PASS (API); web/native UI NOT_RUN |
| JOURNEY-02 | 25 | 23 | 0 | 2 | 0 | PASS (API); localized page + native open NOT_RUN |
| JOURNEY-03 | 38 | 36 | 0 | 1 | 1 | PASS (API); UI NOT_RUN; replacement notifications are a documented gap (N/A row) |
| JOURNEY-04 | 43 | 39 | 1 | 3 | 0 | PARTIAL: server side PASS, 1 P2 defect, rehearsal playback/offline pack on device NOT_RUN |
| JOURNEY-05 | 47 | 44 | 1 | 2 | 0 | PARTIAL: Live/attendance/export PASS, 1 P2 report defect, UI NOT_RUN |
| JOURNEY-06 | 44 | 39 | 2 | 3 | 0 | PARTIAL: 2 P2 defects, widget/push/native NOT_RUN |
| JOURNEY-07 | 60 | 59 | 0 | 1 | 0 | PASS (API); public page HTML in browser NOT_RUN |
| **All** | **304** | **285** | **4** | **14** | **1** | |

## Environment, namespace and fixture shape

- Orgs `qa-20261120-jrn-a` (Alpha, `America/Chicago`) and `qa-20261120-jrn-b` (Beta, `Asia/Ho_Chi_Minh`). Self-serve church creation is off (`church_application_required`), so both were created with `private.create_church` for their first owner (setup only).
- Users `<alias>.qa20261120.jrn@example.test`: owner, planner (role scheduler, scoped: `plans.edit` + `scheduling.manage` on service type "JRN Sunday"), leader (member with `scheduling.manage` + `teams.manage` on team "JRN Band" only; `scheduling.override_conflicts` granted by the owner during JOURNEY-03), mem1 (Acoustic + Bass, "Maya Pending"), mem2 (Drums), mem3 (blockout), candA / candB (Keys, Drums), librarian (`songs.manage`), mediaed (`media.manage`), viewer (no team), multi (Alpha + Beta members, distinct Persons), betaowner (Beta owner), gus (no-login guest, later invited; `gus.guest.qa20261120.jrn@example.test`). `guestlogin`/`outsider` were created but unused.
- Alpha: service types "JRN Sunday"/"JRN Midweek", teams "JRN Band" (Acoustic, Bass, Drums, Keys) and "JRN Production" (Camera, Sound), plan "JRN Sunday Nov 29" (rehearsal 08:00, services 09:00 and 11:00 Chicago, 3 order items + song item), template "JRN Sunday template", plans for Dec 6 (draft, template target), Dec 13 (blockout/replacement) and Dec 20 (multi-org), song "JRN Journey Song" + arrangement, audio/PDF files, notes, a plan publication, set-list link, scoped feeds and API key (all revoked, see cleanup).
- Beta: same names ("JRN Sunday", "JRN Band"), plans with sentinel titles `SECRET-B` and `PREP-B` (prepared) to detect cross-tenant leakage.
- IDs are the same across steps inside each journey (assignment/plan/run IDs were asserted equal at each hop; see rows).

## Delivery worker runs (global, processes every org)

`CRON_SECRET` is unset (HTTP route 404) and `backend/dist` is not built, so the one-shot worker was run from source with `cd backend && npx tsx src/worker.ts` (same code path as `npm run worker`; no file written). All API-triggered effects in this package were delivered inline by the API (`deliverEffectNow`), so the worker was only needed for the report export and as a sweep.

| Run | When (UTC) | Output | Attributable to `qa-20261120-jrn-*` |
|---|---|---|---|
| 1 | 22:07, after JOURNEY-01 | releases 2, reminders enqueued 23, claimed 34 / completed 34, retried 0, abandoned 0; exports expired 13; files expired 1 / removed 1; notifications deleted 0 | 0 deliveries (jrn-a showed 3 simulated, 4 delivered, 4 skipped before and after; its one `queued` row had already been drained by another agent's worker run just before). The 34 claims, 2 scheduled releases and 13 expired exports belonged to other namespaces (msg-a, resp-a, sync-a, nat-a, `qa-20261118-*`, and `riverside`: 6 deliveries). |
| 2 | 22:14, after JOURNEY-05 export request | deliveries 0; report exports claimed 1 / ready 1; files removed 3 | 1 export (mine, `participation` CSV, downloaded in row J05-10c). The 3 removed storage objects are not mine (my files are intact). |
| 3 | 22:21, final sweep | all zero | 0 |

Final deliveries in the namespace: jrn-a simulated 10, delivered 11, skipped 11 (`no_active_device`), cancelled 3 (deliveries to the deactivated member); jrn-b simulated 1, delivered 1, skipped 1. 15 reminder jobs remain `scheduled` in the future (jrn-a).

## Results per journey

Evidence required by §10 is mapped to rows in the journey notes; every table row is one step.

**JOURNEY-01 evidence.** Same IDs end to end (rows 1c to 7). Prepared rows invisible to mem1/mem2/viewer on schedule, plan read, REST, attendance-times, notifications, calendar and snapshot preview (row 4.x), 0 delivery effects while prepared. Release preview, release, mem1's review and the persisted per-time responses carry the exact scope (Acoustic: 3 times; Bass: 11:00 only; answers 3x confirmed/1x declined with private reason; 4 persisted rows, no extras). One `assignment_request` effect covers 3 requests (replay with same key: 1 to 1), deliveries are one per Person per channel, the response owner gets exactly two `assignment_response` notifications (one per distinct transition), 4 history rows with actor mem1, replay of the commit changes nothing, a second commit on the used snapshot is refused.

**JOURNEY-02 evidence.** Guest scheduled (released, email `simulated`, locale `vi`), anonymous link preview is Vietnamese with 1 assignment / 1 time and no email or other people; answer persisted for exactly the 9:00 scope, token single-use (410), invitation never created or touched an assignment/notification, invite accepted into a new account on the same Person row (no duplicate), schedule shows the same assignment ID already confirmed, `preferred_language` stays `vi`. (The raw respond token is not recoverable with `DELIVERY_LINK_SECRET` unset; its hash was replaced with a known one in setup, as in wave 2.)

**JOURNEY-03 evidence.** Redacted conflict (reason never disclosed, also via PostgREST), 409 without reason, 403 with reason but no override capability, 409 with capability but no reason, 201 with both, audit row (assignment, Person, actor, reason, redacted conflict). Decline keeps its private reason, replacement requires the declined assignee, consent then approval created exactly one confirmed assignment with the original 9:00 scope; Drums holders = 1 after fill; second offer/new request refused (`capacity_full`); candidate cannot self-approve; original decline row/history intact.

**JOURNEY-04 evidence.** Arrangement edited with revision check (stale edit 409, no lost write). Plan-only key C and sequence [C,V1,C] applied only to that plan item (library G / other plan unchanged). Authorized (media.manage) audio v1/v2 and chart PDF upload with exact Storage sizes; scheduled-audience audio reaches scheduled members only; signed download checksum equals the upload; offline-pack entries carry exact version/size and v2 checksum after replacement; audience narrowing revokes manifest, download, pack and raw Storage immediately; inactive membership refuses manifest/pack/schedule; other tenant gets 404 for download and pack. The previously issued signed URL (300 s TTL) kept working after replacement and after revocation until it expires (documented TTL design).

**JOURNEY-05 evidence.** One run per occurrence (9:00 and 11:00 independent histories), viewer cannot control, controller held / takeover-with-reason / old controller refused (`run_control_lost`), lost-response retry replayed (applied once), stale revision refused, expired lease refused until `take_control`, viewer converges on the same revision; audited correction (between neighbours, with actor, reason); attendance with correction audit and stale refusal, one Person per occurrence for two positions, confirmed-but-absent and pending-but-present kept; participation/staffing/run-times totals equal the oracle (assignments 4, people 3, person-plans 3, present 3, absent 1; needed 3/confirmed 2/pending 2; planned 840 s, actual 20 s, corrected), CSV direct and tracked export (worker) identical, other users/tenants denied.

**JOURNEY-06 evidence.** Combined schedule and busy sharing are separate opt-ins; per-org lists never mix; org switching, ambiguous org (400), foreign plan IDs (404); busy-elsewhere is a redacted warning only while the opt-in is on; shared-device handover moves token ownership and the old owner can neither delete it nor use its revocation secret; no push to the stale owner; old notification IDs 404 for the new identity and under the wrong org; global sign-out makes the API refuse the old access/refresh tokens (401/400); membership deactivation closes schedule, notifications, deep-link target, combined schedule, feed and deliveries (cancelled).

**JOURNEY-07 evidence.** Leaders-only note, Band-only note, item note, leaders-only document and a prepared request were absent for unscheduled members (all read surfaces + raw PostgREST), Band note visible to Band members only, prepared absent even for its holder and from exports/feeds. Public plan, set list, scoped feed, external API (plans.read key) expose only the allowlisted projection (keys organization/timezone/title/date/times/items/songs; zero hits for 29 private strings/IDs); draft plans and Beta data never appear; Storage anonymous GET/list denied. Revocation of publication, set-list link, scoped feeds and API key took effect on the next request (404/401).

## Defects

No P0 or P1.

### W7-JRN-D1 (P2) participation report summary lacks the recorded `unknown` total
- Recurrence of W3-LIVE-D3, still present at `473fb69`.
- Repro: as leader `POST /api/v1/plans/{plan}/attendance` marking one Person `unknown` for a time (and others present/absent), then as owner `GET /api/v1/reports/participation?from=2026-11-29&to=2026-11-29`.
- Expected: `summary` carries present, absent and unknown (recorded unknown is distinct from unmarked). Actual: `summary` = `{assignments,people,person_plans,present,absent,teams}`; only rows carry `unknown` (Maya row `unknown:1`), so the summary cannot be reconciled with rows.
- Suspected: `packages/shared/src/lib/reports.ts` participation summary builder (~lines 323-420, `ParticipationSummary`).
- Evidence: J05 rows 9a (totals correct), 9c (FAIL).

### W7-JRN-D2 (P2) combined schedule omits released assignments on plans without times
- Repro: plan created without `times`; release an assignment on it to a member who opted into the combined schedule. `GET /api/v1/schedule/mine` lists it (`include untimed`), `GET /api/v1/me/combined-schedule?from=...&to=...` returns `items: []` for that organization (SQL: `select * from my_organization_schedule(...)`).
- Expected: the same released request appears (consistent with `/schedule/mine` and the F04 untimed contract). Actual: omitted.
- Suspected: `supabase/migrations/20261020000100_f04_assigned_times.sql:1683` (`join private.assignment_attendance pt ... and pt.plan_time_id is not null`).
- Evidence: J06 row 2d.

### W7-JRN-D3 (P2) global sign-out does not revoke the old access JWT at PostgREST/Storage
- Repro: capture a user's access token, `POST {SUPABASE_URL}/auth/v1/logout?scope=global` with it (204). `GET /api/v1/schedule/mine` with the old token is 401 and the refresh token is rejected, but `GET {SUPABASE_URL}/rest/v1/assignments?select=id` with the old token still returns 200 and 9 rows until `exp`.
- Expected: no data after sign-out (or an accepted, documented residual window). Actual: RLS-scoped reads of the signed-out user's own organizations remain possible for up to `jwt_expiry` (3600 s in `supabase/config.toml:31`). Impact is limited to that user's own RLS scope (a stolen token, not a cross-user leak); native widgets/caches that hold the JWT keep working directly against PostgREST/Storage.
- Suspected: platform behaviour (stateless JWT); consider a shorter `jwt_expiry` or documenting the residual window. The Express layer is correct (`backend/src/middleware/auth.ts:36` checks the session).
- Evidence: J06 rows 8c (API 401, PASS) and 8f (FAIL).

### W7-JRN-D4 (P2) transposed ChordPro keeps the old `{key: ...}` directive
- Repro: arrangement in G with `{key: G}`; plan item with `key_override: C`; as mem1 `GET /api/v1/plans/{plan}/rehearsal-manifest` (also `GET /api/v1/arrangements/{id}/chart?to=C`).
- Expected: directive says C (or is dropped) to match `chart.key: "C"` and the transposed chords. Actual: `chordpro` = `{key: G}` followed by `[C]Amazing [F]grace how [C]sweet`, `chart.key = C`, `source_key = G`. Any client that renders the embedded directive would show the wrong key.
- Suspected: `packages/shared/src/lib/chordpro.ts:99-110` (`transposeChordPro` rewrites only `[chord]` tokens) and `:514-519`.
- Evidence: J04 row 4b2.

## Observations (not counted as defects; source and plan wording)

- Replacement offer, consent and approval produce no notification or delivery effect (candidate, leader and requester hear nothing). This is the documented gap `docs/plans/mobile-first-10-progress.md:68` ("pending F08"); recorded as N/A in J03, but REPLACE-01 "tracking" relies on polling until F08 lands.
- §10 JOURNEY-01 says "one logical notification". Implemented as one outbox effect, one email and one in-app delivery per Person per release, but the in-app centre holds one row per request (mem1 has two with distinct bodies). The plan wording is ambiguous; treated as PASS.
- `leaders` file audience means file writer or plan leader (`private.file_leader`); a team-scoped scheduler (Band leader) cannot read leaders-only plan files, while planner/owner/media-editor can. No plan oracle row covers it.
- Respond-snapshot preview for a prepared id and a random UUID both return the same generic 409, so there is no existence oracle (good), though 404 would be clearer.
- Any ordinary member can issue a scoped service-type calendar feed (201). The feed only carries plan times the member can already read, and published-only (a draft plan with a time was not served by the feed or the external API); wave 3 already notes that members read draft plans through the authenticated API.
- Public `/public/plans/:slug` sends `Cache-Control: public, max-age=60`, so a CDN or browser may serve a revoked page for up to 60 s; the origin returned 404 on the next request.
- Personal calendar feed still cannot be revoked without issuing a replacement (W3-INT-D9 unchanged); the tokens created here were revoked by setup SQL during cleanup.
- Webhook endpoints were not exercised: `INTEGRATION_SECRET_KEY` is unset on `:4000` (webhooks 503), and they are outside §10's journey text.
- Dashboard counts (AUTH-04) were not part of the prepared-visibility sweep in JOURNEY-01/07; schedule/notifications/unread-count/manifest/calendar/export/feed were.

## Not run / blocked

| Item | Status | Why | What unblocks it |
|---|---|---|---|
| J01-9a, J02-9b, J03-9a, J04-12a..c, J05-12a, J06-10a..c | NOT_RUN (native) | Native UI, audio playback, offline pack on device storage, offline cold launch, 24 h recheck on device, widget snapshots, push arrival and universal-link launch need simulators/physical devices and signed builds | W7-NATIVE (simulator) and QA-14 (physical iOS/Android with signed builds, app-link association files, APNs/FCM/Expo credentials, airplane-mode and clock control). The API equivalents each client would call were executed and are separate rows |
| J04 offline / J06 widget+push portions | NOT_RUN / BLOCKED for real delivery | Push is disabled and no provider keys exist (`push:skipped:no_active_device`, `email:simulated`); real iOS widget extension needs a signed build with App Group | Provider keys or a controlled push sink, plus an iOS build with widgets |
| J01-9b, J02-9a, J05-12b, J07-9a | NOT_RUN (browser) | Browser belongs to W7-WEB | W7-WEB; the same endpoints were driven here |
| Real provider delivery faults / real email | BLOCKED | `RESEND_API_KEY` empty | Test mail sink or sandbox key |

## Fixtures and pending state left in place

- Orgs `qa-20261120-jrn-a/-b` with all users above, plans, assignments, notes, files (Storage objects for audio v1/v2 and chart PDF, a leaders-only document), song/arrangement, template, runs (both ended), attendance, export, reports, deliveries, history.
- Pending: 15 reminder jobs `scheduled` for future dates in jrn-a; Gus's account password and other credentials only in the scratchpad.
- Everything public or tokenized was revoked: plan publication (revoked), set-list link (revoked), scoped feeds (2, revoked via API), API credential (revoked), personal feed tokens for multi/candB (revoked by setup SQL; no API to revoke without replacement), the fake push token (deleted). Final SQL check: 0 active publications, set-list links, API credentials, scoped feeds, feed tokens or QA device tokens in Alpha; 0 webhook endpoints.
- Fixture state to know when re-using: mem1/mem2/mem3 and candA hold assignments on Nov 29 / Dec 13; mem3's assignment is declined; multi is an active member of both orgs with `combined_schedule=true`, busy sharing off; leader holds the override capability on Band; audio file audience is `leaders`.

## Reproduction notes

All steps ran from `/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-seal/17f4fc19-756e-4866-a81d-6d5edb450050/scratchpad/journey/` (`lib.mjs` helper, `j01*.mjs` .. `j07*.mjs`, `rows-*.json` result rows). Some early rows were transcribed from console output after a script aborted before flushing (J01 5a-6f, J06 8a-9d, J05 7e, J07 1a-1e) and a few of my own expectation values were corrected where the observed behaviour matched source (J05 index values, J03-4b same-state no-op); rows state the corrected expectation.

## Result tables
### JOURNEY-01 Staffing round trip (type/team/Person, plan/template/order, prepare, release, member answers, web staffing)

Counts: PASS 45, NOT_RUN 2 (total 47)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a owner created service type+Band team+4 positions (setup3, owner token) | owner | A | persisted 1/1/4 | 1/1/4 | PASS |
| 2 | 1b owner creates no-login Person (Gus) | owner | A | 201 person w/o profile | 201 profile=null | PASS |
| 3 | 1c owner adds Gus to Band/Keys | owner | A | 201 | 201 | PASS |
| 4 | 1d planner (scoped) denied People create | planner | A | 403 | 403 | PASS |
| 5 | 2a planner creates published plan with 3 times | planner | A | 201, 3 times | 201 times=3 | PASS |
| 6 | 2b planner builds running order (header + 2 items) | planner | A | 201x3, 3 rows | 201,201,201 rows=3 | PASS |
| 7 | 2c planner sets needed positions | planner | A | 200 | 200 [{"position_id":"8c0f9d2d-fdd8-463e-abda-e53105f9e3de","team_id":"e44422da-32b3-4b42-9980-04aa23568feb","needed":1},{"position_id":"dd9f9c83-b99b-47e9-81e1-3e7adb235819","team_id":"e44422da-32b3-4b42-9980-04aa23568feb","needed":1},{"position_id":"58d8b026-fce2-40b9-b1ef-c2e29ba749eb","team_id":"e444 | PASS |
| 8 | 2d planner saves plan template from plan | planner | A | 201 template w/ revision | 201 {"id":"f6439d5d-1313-4008-9e07-fef7dc8846c9","organization_id":"d7004674-5674-4428-ab8e-a596f859e393","service_type_id":"380616a3-4197-483f-8943-8478bda981ac"," | PASS |
| 9 | 2e planner creates empty draft plan2 | planner | A | 201 | 201 | PASS |
| 10 | 2f planner previews+applies template to plan2 | planner | A | 200; plan2 gets 3 items + 3 needs | 200/200 items=3 needs=3 | PASS |
| 11 | 3a leader (Band-scoped) prepares 3 requests (mem1 Acoustic[all], mem1 Bass[11:00 only], mem2 Drums) | leader | A | 201, 3 rows visibility=prepared, no notify | 201 n=3 vis=prepared | PASS |
| 12 | 3b prepared create produced no delivery effect/notification | leader | D | 0/0 | 0/0 | PASS |
| 13 | 3c leader denied scheduling outside Band scope | leader | A | 403/4xx, no row | 403 rows=0 | PASS |
| 14 | 4.mem1 prepared requests absent from own schedule/plan/REST/att-times | mem1 | A+D | 0 rows on each surface | {"mine":0,"plan_assignments":0,"sched":0,"calendar":"has-plan","notif":0,"unread":"{\"unread\":0,\"account_unread\":0}","rest_assign":0,"rest_att":0,"respond_preview":"409:{\"error\":\"That change is no longer allowed\",\"code\":\"conflict\"}"} | PASS |
| 15 | 4.mem2 prepared requests absent from own schedule/plan/REST/att-times | mem2 | A+D | 0 rows on each surface | {"mine":0,"plan_assignments":0,"sched":0,"calendar":"has-plan","notif":0,"unread":"{\"unread\":0,\"account_unread\":0}","rest_assign":0,"rest_att":0,"respond_preview":"409:{\"error\":\"That change is no longer allowed\",\"code\":\"conflict\"}"} | PASS |
| 16 | 4.viewer prepared requests absent from own schedule/plan/REST/att-times | viewer | A+D | 0 rows on each surface | {"mine":0,"plan_assignments":0,"sched":0,"calendar":"has-plan","notif":0,"unread":"{\"unread\":0,\"account_unread\":0}","rest_assign":0,"rest_att":0,"respond_preview":"409:{\"error\":\"That change is no longer allowed\",\"code\":\"conflict\"}"} | PASS |
| 17 | 4.leader (manager) positive control sees 3 prepared rows | leader | A | 3 assignments visible | 3 | PASS |
| 18 | 4.planner (service-type scoped scheduling.manage) positive control: sees the 3 prepared Band rows | planner | A | 3 prepared rows visible (managed scope) | 3 | PASS |
| 19 | 4.no effect/delivery rows while prepared | n/a | D | 0/0 | 0/0 | PASS |
| 20 | 5a member cannot release prepared requests | mem1 | A | 403 | 403 | PASS |
| 21 | 5b release preview shows exact time scope per request (Acoustic 3 times; Bass only 11:00) | leader | A | Acoustic=3 times, Bass=[11:00] | 200 acoustic=3 bass=11:00 (same IDs as created) | PASS |
| 22 | 5c leader releases exactly the 3 reviewed requests (expected_revisions + idempotency key, notify on) | leader | A | 200 released=3 visibility=released | 200 n=3 released | PASS |
| 23 | 5d replay release with same idempotency key: no second effect | leader | A+D | effects unchanged (1 assignment_request effect covering 3 requests) | replay 200; effects 1->1 (assignment_request:3) | PASS |
| 24 | 5e deliveries are per Person per channel: mem1 (2 requests) and mem2 each get in_app delivered, push skipped no_active_device, email simulated (never sent) | n/a | D | one row per person per channel | 6 rows: in_app delivered x2, push skipped(no_active_device) x2, email simulated x2 | PASS |
| 25 | 5f in-app notification rows reference exact plan_id/assignment_id; one request effect; mem1 has one row per request (2) with distinct bodies, mem2 one row | n/a | D | dedupe_key = effect:assignment, no duplicates after replay | mem1=2 (Acoustic, Bass), mem2=1; unread-count mem1=2; replay added none | PASS |
| 26 | 6a mobile member (mem1) sees exactly their 2 released requests with the same assignment IDs | mem1 | A (mobile API equiv) | 2 entries, ids = acoustic,bass | 200 n=2 | PASS |
| 27 | 6b mem2 sees only own Drums request (no mem1 rows) | mem2 | A | 1 entry | 1 | PASS |
| 28 | 6c unrelated member sees nothing | viewer | A | 0 | 0 | PASS |
| 29 | 6d unrelated member cannot freeze a snapshot of mem1 requests | viewer | A | 4xx | 409 {"code":"conflict"} | PASS |
| 30 | 6e mem1 review: 1 snapshot for the plan, Acoustic=3 times, Bass=1 time (11:00) | mem1 | A | scope equals release preview | 200 snaps=1 ac=3 ba=11:00 | PASS |
| 31 | 6f mem1 commits reviewed answers (Acoustic: Rehearsal+9:00 confirmed, 11:00 declined with reason; Bass 11:00 confirmed) | mem1 | A | 200 snapshots updated=2, effect_ids | 200 {snapshots:[{assignments_updated:2}],effect_ids:[2]} | PASS |
| 32 | 6g persisted per-time responses exactly equal reviewed scope (4 rows, no extra/missing) | n/a | D | 4 rows matching | t/11:00/declined/Away for second service ; t/9:00/confirmed/ ; t/Rehearsal/confirmed/ ; f/11:00/confirmed/ | PASS |
| 33 | 6h unrelated mem2 Drums request unchanged (unconfirmed) | n/a | D | unconfirmed | unconfirmed | PASS |
| 34 | 6i replay commit with same key: idempotent, no duplicate history/effects | mem1 | A+D | 200 replay, same history count, scheduler_response effect count stable | 200 hist=4 effects=scheduler_response:declined,scheduler_response:confirmed | PASS |
| 35 | 6j second commit with new key on used snapshot refused (no mixed/duplicate answer) | mem1 | A | 409/4xx | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| 36 | 7.planner web plan view shows same assignment IDs with answers (Acoustic=unconfirmed[mixed], Bass=confirmed, Drums=unconfirmed) | planner | A | ids match; statuses as persisted | 200 acoustic=unconfirmed bass=confirmed drums=unconfirmed | PASS |
| 37 | 7.leader web plan view shows same assignment IDs with answers (Acoustic=unconfirmed[mixed], Bass=confirmed, Drums=unconfirmed) | leader | A | ids match; statuses as persisted | 200 acoustic=unconfirmed bass=confirmed drums=unconfirmed | PASS |
| 38 | 7.owner web plan view shows same assignment IDs with answers (Acoustic=unconfirmed[mixed], Bass=confirmed, Drums=unconfirmed) | owner | A | ids match; statuses as persisted | 200 acoustic=unconfirmed bass=confirmed drums=unconfirmed | PASS |
| 39 | 7b response-owner notified once per distinct answer transition (confirmed + declined), not per time row | leader | D | 2 assignment_response notifications for response owner | leader.qa20261120.jrn@example.test/2 | PASS |
| 40 | 7c history chain: 4 per-time history rows | n/a | D | 4 history rows, first transition (previous=null) per time: confirmed x3, declined x1 | null>confirmed 11:00 ; null>declined 11:00 ; null>confirmed 9:00 ; null>confirmed Rehearsal | PASS |
| 41 | 7d history actor is the answering member | n/a | D | 4/4 actor=mem1 | 4 | PASS |
| 42 | 8a cross-tenant: Beta owner with Alpha org header cannot read plan | betaowner | A | 403/404 | 403 | PASS |
| 43 | 8b cross-tenant: Beta owner (Beta header) cannot read Alpha plan id | betaowner | A | 404 | 404 | PASS |
| 44 | 8c Beta owner cannot snapshot Alpha assignments | betaowner | A | 4xx | 409 | PASS |
| 45 | 8d Beta owner direct PostgREST assignments read of Alpha id empty | betaowner | D | [] | [] | PASS |
| 46 | 9a mobile member answers in the native app UI (grouped/split review screen, Expo build) | mem1 | native | n/a | NOT_RUN: native UI owned by W7-NATIVE / QA-14 devices. API equivalent (preview + commit) executed in 6e-6j | NOT_RUN |
| 47 | 9b web staffing screen shows the same IDs/answers visually (Plans > Teams tab) | planner | browser | n/a | NOT_RUN: browser owned by W7-WEB. API equivalent: rows 7.* | NOT_RUN |

### JOURNEY-02 No-login guest to account (response link, invitation, schedule/profile)

Counts: PASS 23, NOT_RUN 2 (total 25)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a leader checks delivery readiness for guest (no login, has email) | leader | A | 200: reachable by email only | 200 [{"person_id":"01a4cb99-2b70-4317-9fb6-27a047dc4c04","has_login":false,"has_email":true,"active":true}] | PASS |
| 2 | 1b leader schedules guest Gus on Keys (9:00 only), released + notify | leader | A | 201 row person_id=Gus, user_id null, visibility released | 201 person=true user_id=null vis=released | PASS |
| 3 | 1c guest deliveries: email simulated (locale vi), in-app/push not applicable to no-login person | n/a | D | email row locale=vi, status simulated (never sent) | email:simulated:vi: | PASS |
| 4 | 1d one respond-link record issued for guest | n/a | D | 1 | 1 | PASS |
| 5 | 2a anonymous respond-link preview: localized (vi), exact scope (Keys, 9:00 only), minimal disclosure | anonymous | A (public) | 200; preferred_language=vi; 1 assignment, 1 time; no email/other people | 200 lang=vi n=1 times=9:00 leaks= | PASS |
| 6 | 2b guest confirms via link (anonymous POST) | anonymous | A (public) | 200 {status:confirmed, assignments_updated:1}; row confirmed | 200 {"status":"confirmed","assignments_updated":1} row=confirmed/t/t | PASS |
| 7 | 2c time response persisted only for the guest's 9:00 scope | n/a | D | 1 row, confirmed, plan_time=9:00 | 1/confirmed/t | PASS |
| 8 | 2d one scheduler_response effect for guest answer | n/a | D | 1 | 1 | PASS |
| 9 | 2e token replay with opposite answer refused (single-use); answer unchanged | anonymous | A (public) | 410 assignment_notification_used; row stays confirmed | 410 assignment_notification_used row=confirmed | PASS |
| 10 | 2f used-token preview discloses no plan detail | anonymous | A (public) | 410, no scope fields | 410 {"error":"This assignment response link has already been used","code":"assignment_notification_used"} | PASS |
| 11 | 3a planner/leader cannot invite (owner-only People) | planner | A | 403 | 403 | PASS |
| 12 | 3b owner invites Gus (member role) -> invite_url | owner | A | 200/201 invited=true | 201 invited=true linked=false | PASS |
| 13 | 3c invitation did not create/alter an assignment or request notification | n/a | D | assignments same; no new assignment_request effect | asg 1->1; effects 5->5 | PASS |
| 14 | 3d anonymous invitation preview: org, first name, language vi, role member | anonymous | A (public) | 200 vi/member; no plan data | 200 {"organization_name":"QA JRN A","person_first_name":"Gus","preferred_language":"vi","email":"gus.guest.qa20261120.jrn@example.test","role":"member","expires_at":"2026-11-27T22:08:26.826+00:00"} | PASS |
| 15 | 3e malformed invitation token | anonymous | A (public) | 404 | 404 | PASS |
| 16 | 4a Gus accepts invitation, creates account (new login) | anonymous | A (public) | 200 {email, linked_existing_account:false} | 200 {"email":"gus.guest.qa20261120.jrn@example.test","linked_existing_account":false} | PASS |
| 17 | 4b invitation token single-use | anonymous | A (public) | 410 | 410 | PASS |
| 18 | 4c same Person row now linked to new Profile; membership role member/active; language vi retained | n/a | D | linked=t, vi, role member/active | t/vi/t / member/active | PASS |
| 19 | 4d no duplicate Person created for same email | n/a | D | 1 | 1 | PASS |
| 20 | 5a Gus signed-in schedule shows SAME assignment id, status confirmed, only the 9:00 scope | gus | A (mobile API equivalent) | 1 entry id=guest assignment, confirmed | 200 n=1 same=true status=confirmed times=["9:00"] | PASS |
| 21 | 5b Gus profile/language preference: Vietnamese carried over from Person | gus | A | effective language vi | 200 {"preferred_language":"vi","person_linked":true} | PASS |
| 22 | 5c assignment row now carries login user id; answer + history intact | n/a | D | confirmed, user_id=new profile; history 1 row | confirmed/13be2f03-c6c7-4f57-9b72-f7f259ec6188 hist=1 | PASS |
| 23 | 5d no assignment notification replayed to the new login just from invitation/join | gus | A | unread 0 (guest was emailed before login; no in-app backfill) | {"unread":0,"account_unread":0} | PASS |
| 24 | 9a localized (Vietnamese) respond page rendered in browser/native fallback page | guest | browser/native | n/a | NOT_RUN: browser (W7-WEB) / native fallback (W7-NATIVE). API payload carries preferred_language=vi (row 2a); delivery locale vi (1c) | NOT_RUN |
| 25 | 9b native app opens schedule/profile after join (universal link, cold launch) | gus | native | n/a | NOT_RUN: needs signed build/device/association files (QA-14). API equivalent: rows 5a-5c | NOT_RUN |

### JOURNEY-03 Blockout, audited override, decline, replacement

Counts: PASS 36, NOT_APPLICABLE 1, NOT_RUN 1 (total 38)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 0 planner creates Dec 13 plan (rehearsal + 9:00) with Drums need=1 | planner | A | 201 | 201 | PASS |
| 2 | 1 mem3 creates timed blockout 08:30-10:30 CST on Dec 13 with private reason | mem3 | A | 200/201 row stored with reason | 201 id=98038f8e-da83-4b9a-8fc7-c607d3966c86 | PASS |
| 3 | 1b persisted blockout UTC interval 14:30Z-16:30Z | n/a | D | 2026-12-13 14:30Z..16:30Z | 2026-12-13 14:30:00+00 2026-12-13 16:30:00+00 PRIVATE-REASON-SENTINEL-ad5c54 | PASS |
| 4 | 2a leader conflict check: blockout conflict reported, reason NOT disclosed | leader | A | blocking blockout conflict; no sentinel/reason text; override_permitted=false | 200 {"conflicts":[{"candidate_key":"k","person_id":"e43e9da3-6752-402e-a946-8eaa7e380f14","kind":"blockout","severity":"blocking","plan_time_id":"991f045d-bcfc-4551-a106-0975410471f0","interval_source":"plan_time","starts_at":"2026-12-13T15:00:00+00:00","ends_at":"2026-12-13T16:00:00+00:00","other_plan_id":null,"other_assignment_id":null,"other_plan_time_id":null,"other_time_kind":null,"detail":"Unavailable","redacte | PASS |
| 5 | 2b leader org blockout list: reason redacted | leader | A | row present w/o reason, or none | 200 leak=false | PASS |
| 6 | 2c leader direct PostgREST blockouts raw read: no reason | leader | D | [] or no reason | [] | PASS |
| 7 | 2d unrelated member cannot read other member blockout/reason | viewer | A | no sentinel | 403 leak=false | PASS |
| 8 | 3a leader schedules over blockout without reason -> 409 scheduling_conflict, no row | leader | A+D | 409; 0 rows | 409 scheduling_conflict rows=0 | PASS |
| 9 | 3b leader WITHOUT override capability + reason -> 403, no row | leader | A+D | 403; 0 rows | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} rows=0 | PASS |
| 10 | 3c ordinary member cannot override/schedule | mem1 | A | 403 | 403 | PASS |
| 11 | 3d owner grants leader scheduling.override_conflicts at Band scope | owner | A | 200 | 200 {"scope_type":"team","scope_id":"e44422da-32b3-4b42-9980-04aa23568feb","grants":[{"id":"d7ca87d8-d7f7-434b-8380-15239e4f | PASS |
| 12 | 3e with capability but no reason -> still 409 | leader | A | 409 | 409 | PASS |
| 13 | 3f leader schedules over blockout WITH capability + reason (released, notify) | leader | A | 201 one row | 201 n=1 vis=released | PASS |
| 14 | 3g override audited: row with assignment, actor, reason; readable by scheduler | leader | A+D | 1 audit row | 200 n=1 {"id":"7dd43199-1b0a-4d8f-918a-51226b949f33","organization_id":"d7004674-5674-4428-ab8e-a596f859e393","assignment_id":"66d4aa29-a056-4d9d-8f57-f1f2a3c63e12","person_id":"e43e9da3-6752-402e-a946-8eaa7e380f14","plan_id":"62d0994a-7c86-481b-8d6c-20329fccb442","team_id":"e44422da-32b3-4b42-9980-04aa23568feb","conflicts":[{"kind":"blockout","detail":"Unavailable","ends_at":"2026-12-13T16:00:00+00:00","redacted":fa | PASS |
| 15 | 3h member cannot read override audit | mem3 | A | 403 | 403 | PASS |
| 16 | 3i release notified mem3 once per channel; email simulated | n/a | D | in_app delivered, email simulated, push skipped | email:simulated ; in_app:delivered ; push:skipped | PASS |
| 17 | 4a mem3 declines with private reason (respond_as_self) | mem3 | A | 200 status declined | 200 declined row=declined/1 | PASS |
| 18 | 4b same-state decline replay (stale expected_status) is a no-op: 200 unchanged, no new history, reason not overwritten | mem3 | A | 200 unchanged (source: v_row.status = p_status returns before stale check); history count stays 1 | 200; history=1; note kept Medical appointment (private) | PASS |
| 19 | 4c self re-accept after decline refused (needs scheduler) | mem3 | A | 409 assignment_response_forbidden | 409 assignment_response_forbidden | PASS |
| 20 | 4d decline reason private from other members; leader sees status | viewer | A | viewer no sentinel | hist=unconfirmed>declined Medical appointment (private) | PASS |
| 21 | 4e other member plan read does not contain decline reason | viewer | A | no "Medical" | clean | PASS |
| 22 | 4f other member direct PostgREST assignment_responses (reason) empty | viewer | D | [] | [] | PASS |
| 23 | 5a mem3 (declined assignee) opens replacement request | mem3 | A | 201 open, applicable_time_ids=[9:00 only] | 201 status=open times=["991f045d-bcfc-4551-a106-0975410471f0"] | PASS |
| 24 | 5b non-assignee cannot open replacement request | candA | A | 403 | 403 | PASS |
| 25 | 5c leader (Band scope) issues offer to candidate A | leader | A | 201 offer pending | 201 status=pending | PASS |
| 26 | 5d candidate cannot self-approve | candA | A | 403 (no approval by beneficiary) | 403 forbidden | PASS |
| 27 | 5e other candidate cannot accept A's offer | candB | A | 403/404 | 403 | PASS |
| 28 | 5f candidate A consents (accept) | candA | A | 200; consent recorded; not yet an assignment | 200 status=accepted_awaiting_approval newAsg=0 | PASS |
| 29 | 5g leader approves -> replacement assignment created | leader | A | 200 approved/filled | 200 {"id":"321905d9-85e6-4da4-844a-1771b2e76b1e","request_id":"bde778e1-ab06-40b9-99bf-52b9b67a61ae","candidate_person_id":"575eff95-11e4-4ba6-8eb1-18dc2158982d","s | PASS |
| 30 | 6a exactly one new assignment for candidate A: same team/position, exact time scope [9:00]; candidate consent recorded so status=confirmed, released | n/a | D | 1 row; Drums; times=[9:00]; confirmed (consent counts as the answer) | 99d7a826-a506-4644-b56f-84f62f8f87b7/confirmed/released/58d8b026-fce2-40b9-b1ef-c2e29ba749eb/991f045d-bcfc-4551-a106-0975410471f0 | PASS |
| 31 | 6b no overfill: Drums need=1 -> exactly 1 non-declined holder | n/a | D | 1 | 1 | PASS |
| 32 | 6c original decline intact (row + response history + private reason) | n/a | D | declined, history>=1 | declined hist=1 | PASS |
| 33 | 6d request filled, offer approved | n/a | D | filled/approved | filled/finalized | PASS |
| 34 | 6e second offer to candB after fill refused; still 1 holder | leader | A+D | 409/4xx; 1 holder | 409 conflict holders=1 | PASS |
| 35 | 6f new replacement request on already-filled vacancy refused (capacity_full) | mem3 | A+D | 409 | 409 capacity_full holders=1 | PASS |
| 36 | 6g candidate A schedule shows new assignment with exact times [9:00] | candA | A (mobile equiv) | 1 entry; 9:00 only | 200 found=true times=["9:00"] | PASS |
| 37 | 6h no notification/effect for replacement offer, consent or approval (documented gap: mobile-first-10-progress.md:68 notifications pending F08) | n/a | D | n/a (documented gap) | effects=assignment_request: ; scheduler_response:declined notif=mem3.qa20261120.jrn@example.test:assignment_scheduled ; leader.qa20261120.jrn@example.test:assignment_response | NOT_APPLICABLE |
| 38 | 9a web/mobile blockout, conflict review and replacement screens | mem3/leader/candA | browser/native | n/a | NOT_RUN: UI owned by W7-WEB/W7-NATIVE. All steps executed through the same REST endpoints | NOT_RUN |

### JOURNEY-04 Library change, plan-only key/sequence, files, rehearsal pack

Counts: PASS 39, FAIL 1, NOT_RUN 3 (total 43)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a librarian creates song + default arrangement (key G, seq V1,C,V2,C) | librarian | A | 201; arrangement stored | 201 arr=6592d51f-6606-421d-8dc5-2389fb70654e key=G seq=V1,C,V2,C | PASS |
| 2 | 1b planner (no songs.manage) denied library create | planner | A | 403 | 403 | PASS |
| 3 | 1c media-editor denied library create | mediaed | A | 403 | 403 | PASS |
| 4 | 2a librarian edits arrangement (bpm 74, seq adds extra chorus) with expected_revision | librarian | A | 200; revision+1 | 200 rev 1->2 bpm=74 seq=V1,C,V2,C,C | PASS |
| 5 | 2b stale revision edit refused (no lost write) | librarian | A | 409 arrangement_revision_stale; bpm stays 74 | 409 arrangement_revision_stale bpm=74 | PASS |
| 6 | 3a planner adds song item with plan-only key C and sequence [C,V1,C] | planner | A | 201; item overrides stored | 201 key=C seq=["C","V1","C"] | PASS |
| 7 | 3b library arrangement unchanged by plan-only overrides | n/a | D | G/74/{V1,C,V2,C,C} | G/74/{V1,C,V2,C,C} | PASS |
| 8 | 4a mem1 rehearsal manifest: item order matches plan, song item chart in plan key C with plan sequence | mem1 | A (mobile equiv) | chart ready key=C source_key=G key_from_plan seq=[C,V1,C] sequence_from_plan | 200 {"status":"ready","key":"C","source":"G","kfp":true,"seq":["C","V1","C"],"sfp":true,"bpm":74} | PASS |
| 9 | 4b manifest chordpro transposed G->C (Amazing line) | mem1 | A | [C]Amazing [F]grace how [C]sweet | [C]Amazing [F]grace how [C]sweet | PASS |
| 10 | 4b2 transposed chordpro metadata: the {key: G} directive still says G while chords and chart.key are C | mem1 | A (mobile equiv) | embedded {key:} directive matches the delivered key C (or is removed) | manifest chordpro: "{key: G}" + [C]Amazing [F]grace; GET /arrangements/:id/chart?to=C same | FAIL |
| 11 | 4c other plan (plan2) uses library default key/sequence (unaffected by plan-only change) | mem1 | A | key=G, sequence from library, not from plan | {"key":"G","seq":["V1","C","V2","C","C"],"kfp":false} | PASS |
| 12 | 4d library chart endpoint still in G with library sequence | librarian | A | 200 key G | 200 {"chordpro":"{title: JRN Song}\n{key: G}\n{start_of_verse: V1}\n[G]Amazing [C]grace how [G]sweet\n{end_of_verse}\n{start_of_chorus: C}\n[D]Sing it [G]out\n{end_ | PASS |
| 13 | 4e manifest preserves plan running order (positions 0..n) | mem1 | A | Welcome > Announcements > Offering > JRN Journey Song | Welcome > Announcements > Offering > JRN Journey Song | PASS |
| 14 | 5a ordinary member cannot create an upload intent for plan item | mem1 | A | 403/4xx, no attachment row | 403 forbidden | PASS |
| 15 | 5b media-editor uploads rehearsal audio v1 to the song plan item (intent -> PUT -> finalize), audience=scheduled | mediaed | A+S | 201 intent; PUT 200; finalize ready |  put=200 fin=200 outcome=ready | PASS |
| 16 | 5c Storage object exists with exact byte size | n/a | S (DB) | size=16044 | d7004674-5674-4428-ab8e-a596f859e393/c3366dd6-c1a9-4545-ab91-cb2ff6fb71c8/b75758ca-0f61-407d-8dfc-d01b50e11236/jrn-rehearsal-v1.wav/16044 | PASS |
| 17 | 5d media-editor uploads chart PDF to the arrangement (organization audience) | mediaed | A+S | finalize ready | put=200 fin=200 | PASS |
| 18 | 5e media-editor sets playback rights download (offline-eligible) | mediaed | A | 200 | 200 rights=download | PASS |
| 19 | 6a scheduled member (mem1) manifest has audio as the track for the song item, exact version 1 | mem1 | A (mobile equiv) | track_file_id=audio; version_number 1; offline right | 200 track=true mats=[["jrn-rehearsal-v1.wav",1,true],["jrn-chart.pdf",1,true]] | PASS |
| 20 | 6b mem2 (scheduled on Drums, other position) manifest | mem2 | A | audience scheduled => also present (scheduled on plan) | 200 track=true | PASS |
| 21 | 6c unscheduled member (viewer) manifest excludes scheduled-only audio | viewer | A | no audio track; plan order still readable | 200 track=null mats=["jrn-chart.pdf"] | PASS |
| 22 | 7a mem1 downloads audio v1 via signed URL; bytes checksum equals uploaded | mem1 | A+S | 200; sha256 match | 200 sha=true expires=2026-11-20T22:16:03.787Z | PASS |
| 23 | 7b unscheduled member download of scheduled audio denied (404/403) | viewer | A | 403/404, no url | 404 url=false | PASS |
| 24 | 7c other tenant (Beta owner) download denied | betaowner | A | 404 | 404 | PASS |
| 25 | 7d other tenant offline-pack of Alpha plan denied | betaowner | A | 404 | 404 | PASS |
| 26 | 7e raw Storage object GET with caller tokens (RLS): scheduled mem1 allowed; unscheduled viewer and other-tenant Beta owner denied | viewer,betaowner,mem1 | S | mem1 200; viewer/beta 4xx | viewer=400 beta=400 mem1=200 | PASS |
| 27 | 8a mem1 offline pack (mobile download API equivalent): includes only authorized audio v1 with exact size | mem1 | A+S | 1 entry file=audio version=V1 size=w1 | 200 entries=2 [["jrn-rehearsal-v1.wav",1,16044],["jrn-chart.pdf",1,193]] excluded=[] | PASS |
| 28 | 8b unscheduled member offline pack contains no scheduled-only audio | viewer | A | no audio entry | 200 entries=1 | PASS |
| 29 | 9a media-editor replaces audio with v2 (expected_revision), finalize ready | mediaed | A+S | 201/200; v2 ready | 201 put=200 fin=200 ready v=2 | PASS |
| 30 | 9b mem1 manifest after replace: audio now v2 (item-owned file follows current), size exact | mem1 | A | version_number 2 size=w2 | v=2 size=32044 newer=false pinned=false | PASS |
| 31 | 9c new offline pack entry = v2 and bytes match v2 checksum (no stale cached v1) | mem1 | A+S | v2 sha match | v=2 sha=true | PASS |
| 32 | 9d previously issued v1 signed URL after replacement (TTL-bounded, 300s): observe | mem1 | S | URL valid only until its expiry; client must recheck manifest (24h recheck_by) | status=200 (url issued 2026-11-20T22:11:03.927Z; ttl 300s) | PASS |
| 33 | 10a media-editor narrows audience to leaders (revokes scheduled members) | mediaed | A | 200 audience=leaders | 200 leaders | PASS |
| 34 | 10b mem1 manifest after revoke has no audio track | mem1 | A | track null | null mats=["jrn-chart.pdf"] | PASS |
| 35 | 10c mem1 download after revoke denied | mem1 | A | 403/404 | 404 | PASS |
| 36 | 10d mem1 fresh offline pack after revoke excludes audio (24h recheck would purge cached copy) | mem1 | A | no audio entry | excluded | PASS |
| 37 | 10e raw Storage read by mem1 after revoke denied | mem1 | S | 4xx | 400 | PASS |
| 38 | 10f leaders-audience positive controls: owner/planner/media-editor 200; Band-scoped leader and librarian 404 (leaders = file writer or plan leader per private.file_leader) | leader | A | owner/planner/mediaed 200; team-scoped scheduler not a plan leader | owner 200, planner 200, mediaed 200, leader 404, librarian 404 | PASS |
| 39 | 11a membership revoked (mem2 inactive): manifest, offline pack and schedule fail | mem2 | A | 403/404 for all three | patch=200 manifest=403 pack=403 schedule=403 | PASS |
| 40 | 11b mem2 reactivated (fixture reset) | owner | A | 200 | 200 | PASS |
| 41 | 12a mobile rehearsal player: play/seek/speed/mini-player on device | mem1 | native | n/a | NOT_RUN: native audio playback needs physical device/Expo build (W7-NATIVE / QA-14). API equivalent = manifest+download rows above | NOT_RUN |
| 42 | 12b mobile offline pack download (resume/size/integrity/cap) to device storage | mem1 | native | n/a | NOT_RUN: device storage + background download; API equivalent = rows 8a/9c (signed URLs, size, sha256) | NOT_RUN |
| 43 | 12c offline cold launch, 24h recheck expiry behavior, account-switch purge | mem1 | native | n/a | NOT_RUN: needs signed device build, airplane mode, clock control on device (QA-14). Server side: pack recheck_by=created+24h verified (see row 8a) | NOT_RUN |

### JOURNEY-05 Live control, takeover, interruption, attendance, report/export

Counts: PASS 44, FAIL 1, NOT_RUN 2 (total 47)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a web controller (planner) creates Live run for 9:00 occurrence | planner | A (web) | 201 run status ready/created; planner holds lease | 201 run=40cdf265-522d-4833-86d7-857da7276645 status=ready ctrl=Paula Planner can_control=true | PASS |
| 2 | 1b web controller starts run | planner | A (web) | 200 status live; start lands on first non-header item idx 1 | 200 live idx=1 rev=2 | PASS |
| 3 | 2a mobile viewer (mem1) reads run state: can_control=false, sees same run/revision | mem1 | A (mobile equiv) | 200 can_control false, run.id same, revision same | 200 can=false id=true rev=2 snapshot_leak=false | PASS |
| 4 | 2b viewer cannot control (advance) -> 403, state unchanged | mem1 | A | 403; revision unchanged | 403 rev_db=2 | PASS |
| 5 | 2c unscheduled member (viewer) run state read | viewer | A | 200 allowed (published plan readable) with can_control=false — observation | 200 can=false | PASS |
| 6 | 2d other tenant cannot read run | betaowner | A | 404 | 404 | PASS |
| 7 | 3a web controller advances to item 1 | planner | A (web) | 200 idx 2 (one item advanced) | 200 idx=2 rev=3 | PASS |
| 8 | 3b mobile controller (owner) take_control while web holds a live lease -> refused run_control_held | owner | A (mobile equiv) | 409 run_control_held, controller unchanged | 409 run_control_held ctrl=Paula Planner | PASS |
| 9 | 3c mobile controller takes over with reason; becomes sole controller | owner | A (mobile equiv) | 200; controller=owner client ios-owner-1 | 200 ctrl_client=ios-owner-1 ctrl=Olive Owner | PASS |
| 10 | 3d old web controller advance after takeover refused (one Live state), index unchanged | planner | A (web) | 409 run_control_lost; index unchanged (2) | 409 run_control_lost idx_db=2 | PASS |
| 11 | 4a lost-response retry of same command id: replayed, applied once | owner | A | first advance idx 3; retry replayed=true idx 3 same revision (applied once) | first idx=3 rev=5; retry 200 replayed=true idx=3 rev=5 | PASS |
| 12 | 4b stale expected_revision refused; no double advance | owner | A | 409 run_revision_stale; idx stays 3 | 409 run_revision_stale idx_db=3 | PASS |
| 13 | 4c network interruption: controller lease expired (clock fixture: lease_expires_at moved to past via SQL setup) | n/a | D | lease expired | t | PASS |
| 14 | 4d expired lease: old controller command refused until control reacquired | owner | A | 409 run_control_lost; idx stays 3 | 409 run_control_lost idx_db=3 | PASS |
| 15 | 4e reconnect: take_control on vacated/expired lease succeeds, state converges (idx 3) | owner | A | 200 controller owner, idx 3 (converged, no lost/double advance) | 200 idx=3 ctrl=ios-owner-1 | PASS |
| 16 | 4f viewer converges to same Live state after reconnect | mem1 | A | viewer rev/idx equal controller (rev 6, idx 3) | viewer rev=6 idx=3; controller rev=6 | PASS |
| 17 | 5a mobile controller ends the 9:00 run | owner | A (mobile equiv) | 200 status ended, ended_at set | 200 ended ended_at=true | PASS |
| 18 | 5b 11:00 occurrence gets its own independent run (different id, own state) while 9:00 is ended | planner | A (web) | 201 new run; run1 remains ended; run2 ready | 201 run2=49187735-4828-4a14-b2de-2841f42e3724 status=ready; run1=ended | PASS |
| 19 | 5c run histories independent: transitions of run1 not mixed into run2 | n/a | D | run2 has only its own transitions (<=2) | run1=7 run2=2 | PASS |
| 20 | 6b viewer cannot correct | mem1 | A | 403 | 403 | PASS |
| 21 | 6a planner corrects an actual transition time with reason (between neighbours); audited with actor + reason | planner | A | 200; 1 correction row actor=planner; actual_seconds changes | 200 1 actor=7b92c3b0-61ac-4d1d-b2dc-fc45901bf56d | PASS |
| 22 | 6c stale correction revision refused (expected_revision reused) / corrections not duplicated | planner | A | 409 | 409 run_revision_stale corrections=1 | PASS |
| 23 | 6d history exposes planned vs actual with correction | owner | A | corrections array length 1; actuals present | corr=1 actuals=true elapsed=20 | PASS |
| 24 | 7a ordinary member cannot record attendance | mem1 | A | 403, no record | 403; records unchanged (rows=2 are 11:00 records from earlier 7e batch) | PASS |
| 25 | 7b librarian (no scheduling) cannot record attendance | librarian | A | 403 | 403 | PASS |
| 26 | 7c Band leader records 9:00: Gus(confirmed)=absent, Marco(pending)=present, Maya=unknown | leader | A | 200; 3 records | 200 rows=3 | PASS |
| 27 | 7d replay same idempotency key: no duplicate event/record | leader | A+D | 200 replay; event count unchanged (3 from 9:00 batch + 2 from 11:00 = 5) | 200 replayed; events=5 (no duplicates) | PASS |
| 28 | 8a correction with stale expected_revision (0) refused; record unchanged | leader | A+D | 409; Gus still absent | 409 attendance_revision_stale gus=absent | PASS |
| 29 | 8b authorized correction absent->present with reason; audited actor/reason | leader | A+D | 200; event previous absent status present actor=leader reason stored | 200 applied=1 revision 2; audit: 1 ->absent actor_leader=true reason= ; 2 absent>present actor_leader=true reason=Gus arrived late; marked absent by mistake | PASS |
| 30 | 8c history for Gus 9:00 shows both entries | leader | A | >=2 entries | 200 n=2 | PASS |
| 31 | 9a participation report totals equal oracle: assignments 4, people 3, person_plans 3, present 3 (Gus corrected, Marco, Maya@11:00), absent 1 (Marco@11:00) | owner | A (web report) | 4/3/3/3/1 | 4/3/3/3/1 unknown_total=undefined | PASS |
| 32 | 9b per-person rows: Maya (2 positions) = 1 person-plan, present 1/unknown 1; Marco (pending) present 1 absent 1; Gus (confirmed) present 1 after correction | owner | A | as stated | Maya 2/1/p1/u1; Marco c0/p1 pr1/ab1; Gus pr1/ab0 | PASS |
| 33 | 9c participation summary exposes the recorded "unknown" total (Maya@9:00 recorded unknown) | owner | A | summary.unknown = 1 (recorded unknown distinct from unmarked) | summary keys=assignments,people,person_plans,present,absent,teams; row-level unknown present, summary has no unknown | FAIL |
| 34 | 9d staffing report: plans 1, needed 3, confirmed 2, pending 2, declined 0, vacancies 0, 2 follow-ups | owner | A | as oracle | 1/3/2/2/0/0 fu=2 | PASS |
| 35 | 9e run_times report: 1 ended run (second occurrence not ended -> excluded), planned 840s, actual 20s, corrected=true | owner | A | as oracle | {"runs":1,"planned_seconds":840,"actual_seconds":20,"average_difference_seconds":-820} corrected=true | PASS |
| 36 | 9f ordinary member report access (role-redacted) | mem1 | A | 403 or redacted (no other people attendance) | 403  | PASS |
| 37 | 9g Band leader report scoped to their team | leader | A | 200 rows only Band | 200 rows=3 | PASS |
| 38 | 9h other tenant report excludes Alpha people | betaowner | A | 0 rows, no Alpha names | 200 rows=0 leak=false | PASS |
| 39 | 10a CSV report export (direct): includes the 3 people and matches JSON counts | owner | A | 200 text/csv | 200 text/csv; charset=utf-8 lines=24 has_gus=true | PASS |
| 40 | 10b tracked export requested; idempotent replay returns same export id | owner | A | 202 accepted/queued; replay returns same id | 202 status=queued; replay 202 same=true | PASS |
| 41 | 10c tracked export ready (worker); owner downloads CSV via signed URL; contains the same 3 people with attendance columns | owner | A+S | 200 signed url; CSV content matches report | 200 bytes=1370 ok=true | PASS |
| 42 | 10d other member cannot download owner export | mem1 | A | 403/404 | 404 | PASS |
| 43 | 10e other tenant cannot download export | betaowner | A | 404 | 404 | PASS |
| 44 | 11a second occurrence run: end refused while lease expired (409 run_control_lost), then take_control + end succeeds; first run history unaffected | planner | A | 409 then 200 ended; run1 ended with 7 transitions | first end 409 (90 s lease had lapsed, state unchanged); take_control 200; end 200 status ended; run1=ended:7 | PASS |
| 45 | 12a mobile viewer/controller UI, background/reconnect on device; Live notifications stopping on end | n/a | native | n/a | NOT_RUN: native UI/background network interruption needs simulator/device (W7-NATIVE/QA-14). API equivalents (lease expiry, replay, takeover) executed above (rows 3b-4f) | NOT_RUN |
| 46 | 12b web Live UI + print/export download in browser | n/a | browser | n/a | NOT_RUN: browser owned by W7-WEB; API/report/export equivalents executed | NOT_RUN |
| 47 | 7e 11:00 attendance batch: Maya (2 positions)=present, Marco=absent (separate occurrence); applied in the same earlier run | leader | A | 200 | 200 (verified via participation report rows) | PASS |

### JOURNEY-06 Multi-organization user, switch, sign-out, stale links

Counts: PASS 39, FAIL 2, NOT_RUN 3 (total 44)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a combined schedule before opt-in refused | multi | A | 403 | 403 | PASS |
| 2 | 1b default settings both off | multi | A | combined false, share_busy false | {"user_id":"80df20f4-bc62-481b-bc03-46296d6c90fa","combined_schedule":false,"share_busy_across_orgs":false,"updated_at":"1970-01-01T00:00:00.000Z"} | PASS |
| 3 | 1c multi opts into combined schedule (busy sharing stays off) | multi | A | 200 persisted | 200 {"user_id":"80df20f4-bc62-481b-bc03-46296d6c90fa","combined_schedule":true,"share_busy_across_orgs":false,"updated_at":"2026-11-20T22:15:07.139+00:00"} | PASS |
| 4 | 2c a different user (mem1, combined off) cannot obtain it; sees none of multi's Beta data | mem1 | A | 403 | 403 | PASS |
| 5 | 3a org switch: Beta context schedule/mine shows only Beta assignment (no Alpha) | multi | A | 1 entry id=Beta; no Alpha ids | 200 n=1 ids=beta alphaLeak=false | PASS |
| 6 | 3b Alpha context shows only Alpha assignment (no Beta) | multi | A | 1 entry Alpha; no Beta | n=1 betaLeak=false | PASS |
| 7 | 3c Beta plan id via Alpha header -> 404 (no cross-org substitution) | multi | A | 404 | 404 | PASS |
| 8 | 3d Alpha plan id via Beta header -> 404 | multi | A | 404 | 404 | PASS |
| 9 | 3e ambiguous org (two memberships, no header) refused | multi | A | 4xx org required | 400 bad_request | PASS |
| 10 | 3f notifications are org-scoped (Alpha feed has no Beta titles and vice versa) | multi | A | disjoint | alpha=1 beta=1 cross=false | PASS |
| 11 | 2d untimed plan (no plan_times): released assignment appears in /schedule/mine but not in combined schedule | multi | A | observation: combined schedule omits released assignment on plan without times | schedule/mine=true combined=false | FAIL |
| 12 | 2a combined schedule (timed plans) shows released assignments from both orgs under their own org, prepared Beta row absent | multi | A (mobile equiv) | Alpha: asgA4; Beta: asgB; neither prepared | alphaHas=true betaHas=true prepared=false betaInAlpha=false | PASS |
| 13 | 2b combined schedule: items carry UTC instants; per-org timezone not included in payload (client must use org tz) | multi | A | observation | organization entries have keys organization_id,organization_name,status,error,items | PASS |
| 14 | 4a (corrected surface: POST /availability/warnings) busy sharing OFF: no busy-elsewhere warning | betaowner | A | no busy-elsewhere | 200 availability_unknown | PASS |
| 15 | 4b busy sharing ON: Beta scheduler gets busy_elsewhere warning only (no Alpha org/plan/team/title/ids) | betaowner | A | >=1 busy warning w/o identifiers | 200 codes=availability_unknown,busy_elsewhere leak=false msg={"person_id":"3ce16bbc-e0c1-4984-baec-05365b35f3c0","code":"busy_elsewhere","detail":"Busy at this time in another organization","params":{},"preference_team_id":null} | PASS |
| 16 | 4b2 busy-elsewhere is a warning, not a blocking conflict, in conflicts/check (observation: hard conflict check ignores cross-org) | betaowner | A | 0 blocking conflicts | 0 | PASS |
| 17 | 4c a member (not scheduler) cannot probe other people busy-elsewhere | multi | A | 403 | 403 | PASS |
| 18 | 4d busy sharing OFF again: warning disappears at once | betaowner | A | none | availability_unknown | PASS |
| 19 | 5a personal calendar feed token issued; anonymous GET of ICS returns multi's released commitments | multi | A+P | 200 text/calendar; includes released items, excludes prepared | 200 alpha=true beta=false prepared=false events=1 | PASS |
| 20 | 5b feed rotation: old token fails, new token works | multi | P | old 404/410; new 200 | old=404 new=200 | PASS |
| 21 | 6a multi registers a (fake) push token; revocation secret returned once | multi | A | 201 | 201 secret=true | PASS |
| 22 | 6b shared-device handover: same token registered by candA moves ownership (multi no longer owns it) | candA | A+D | row owner = candA only; one row | own_before(multi)=t owner_after(candA)=t rows=1 | PASS |
| 23 | 6c previous owner cannot delete/steal the new owner's registration (RLS) | multi | A+D | 204 but row remains | 204 still=1 | PASS |
| 24 | 6d stale revocation secret of old identity cannot remove new owner's registration | anonymous | A | 204 (no disclosure) and row remains | 204 still=1 | PASS |
| 25 | 7a notification for multi after device handover: push to the shared token NOT attempted for multi (no_active_device / skipped); in-app + email(simulated) only | n/a | D | multi push skipped:no_active_device | in_app:delivered: ; push:skipped:no_active_device ; email:simulated: ; email:simulated: ; in_app:delivered: ; push:skipped:no_active_device | PASS |
| 26 | 7b old push deep link: new identity (candA) opening multi's notification id -> 404 | candA | A | 404 | 404 | PASS |
| 27 | 7c old Alpha notification opened under Beta org context -> 404 (reauthorized per org) | multi | A | 404 | 404 | PASS |
| 28 | 7d deep link target (Alpha plan) with correct org context still opens for multi | multi | A | 200 | 200 | PASS |
| 29 | 8a sign-out step 1: device registration removed with the user own token | multi | A+D | 204; row gone | 204; rows=0 | PASS |
| 30 | 8b sign-out step 2: Supabase global logout | multi | auth | 204 | 204 | PASS |
| 31 | 8c old access token used against the API after sign-out (stale widget refresh / replayed deep link) | multi (old token) | A | 401; no schedule data | 401 {"error":"Invalid or expired session"} | PASS |
| 32 | 8d old refresh token after sign-out rejected | multi (old) | auth | 400/401 | 400 | PASS |
| 33 | 8e anonymous request for the old deep-link target (no token) | anonymous | A | 401 | 401 | PASS |
| 34 | 8f old access JWT used directly against PostgREST after global logout | multi (old token) | D | 401 or 0 rows (session revoked) | 200 with 9 assignment rows: JWT stays valid at PostgREST/Storage until exp (API layer does reject it, row 8c) | FAIL |
| 35 | 9a fresh sign-in works; schedule restored | multi | A | 200 | 200 | PASS |
| 36 | 9b Alpha membership deactivated: schedule/notifications/deep-link target refused with Alpha context | multi | A | 403/404 x3 | patch=200 schedule=403 notifications=403 plan=403 | PASS |
| 37 | 9c Beta context unaffected after Alpha revoked, no Alpha leakage | multi | A | 200 Beta only | 200 alphaLeak=false | PASS |
| 38 | 9d combined schedule after Alpha revoked: Alpha excluded | multi | A | only Beta listed | 200 QA JRN B:ok:1 only | PASS |
| 39 | 9e personal feed token after membership deactivated: no Alpha events served (before: served 1 event) | multi | P | 404/410 or empty calendar | before=200 events=1; after=404 events=0 alpha=false | PASS |
| 40 | 9f scheduler re-notify while multi inactive: no live delivery to inactive member | leader | A+D | deliveries cancelled (not sent) for an inactive member | 200; email/in_app/push rows all status=cancelled | PASS |
| 41 | 9g reactivated (fixture reset): access restored on a fresh request | owner | A | 200 | 200 schedule=200 | PASS |
| 42 | 10a iOS widget snapshot shows previous account/org data after org switch/sign-out; cleared on sign-out | multi | native/widget | n/a | NOT_RUN: widget extension needs signed iOS build on device/simulator with App Group (QA-14 / W7-NATIVE). Server side: old token refused (8c) so a stale widget refresh cannot fetch; cached snapshot clearing is client-only | NOT_RUN |
| 43 | 10b push arrival on device after sign-out / account switch; tap routes with reauthorization | multi | native/push | n/a | NOT_RUN: needs physical device + real APNs/FCM/Expo credentials (push disabled, no provider keys). Server side verified: token ownership moves on handover (6b), no push to stale owner (7a), stale deep-link ids 404 (7b,7c) | NOT_RUN |
| 44 | 10c native org switcher / combined "Across my churches" screen / universal-link cold launch | multi | native | n/a | NOT_RUN: native UI (W7-NATIVE). API equivalents rows 2a,3a-3f | NOT_RUN |

### JOURNEY-07 Private data, public projections, scoped credentials, revocation

Counts: PASS 59, NOT_RUN 1 (total 60)

| # | Step | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| 1 | 1a planner adds leaders-only plan note (sentinel) | planner | A | 201 | 201 | PASS |
| 2 | 1b planner adds Band-team-only note | planner | A | 201 | 201 | PASS |
| 3 | 1c planner adds leaders-only item note on the song item | planner | A | 201 | 201 | PASS |
| 4 | 1d media-editor adds leaders-only text document to the plan | mediaed | A+S | 201 | 201 | PASS |
| 5 | 1e leader prepares an assignment for candB (prepared) | leader | A | 201 prepared | 201 visibility=prepared | PASS |
| 6 | 2a unscheduled member: leaders/team notes, item note, leaders doc, prepared candB all absent from notes/plan/files/schedule/notifications/manifest | viewer | A | no sentinels; prepared assignment id absent | notesStatus=200 leaks= | PASS |
| 7 | 2b scheduled Band member (mem1): leaders notes/doc absent; Band-team note visible (team audience), prepared candB absent | mem1 | A | team note visible; others absent | teamNoteVisible=true leaks= | PASS |
| 8 | 2c candB (holder of the PREPARED request): sees none of own prepared assignment, schedule, notification; no leaders notes | candB | A | absent | leaks= mine=0 | PASS |
| 9 | 2d direct PostgREST plan_notes as unscheduled member: no leaders/team notes | viewer | D | none of the sentinels | [] | PASS |
| 10 | 3a ordinary member cannot publish a plan | mem1 | A | 403 | 403 | PASS |
| 11 | 3b Band-scoped leader (no plans.edit) cannot publish | leader | A | 403 | 403 | PASS |
| 12 | 4a planner (plans.edit scope) publishes plan with allowlist title/date/times/order/songs/song_keys, now | planner | A | 200 state live; preview; public_path slug | 200 state=live path=/p/k8ydrMhyHhYfqLYXBSe3lA | PASS |
| 13 | 4b anonymous public plan: only allowlisted keys (organization,timezone,title,date,times,items,songs) — no location/service_type/notes/people | anonymous | P | 200; keys subset of {organization,timezone,title,date,times,items,songs} | 200 keys=organization,timezone,title,date,times,items,songs | PASS |
| 14 | 4c public projection leaks nothing private (people names/emails/ids, notes, files, prepared candB, decline reason) | anonymous | P | 0 matches | leaks= | PASS |
| 15 | 4d unselected fields absent (item_lengths, authors, service_type, location) | anonymous | P | absent | lengthSeconds=false author=false loc=false st=false | PASS |
| 16 | 4e public songs/order reflect plan context: key C (plan-only), title only | anonymous | P | song JRN Journey Song key C | [{"title":"JRN Journey Song","key":"C"}] {"kind":"song","title":"JRN Journey Song","song":{"title":"JRN Journey Song","key":"C"}} | PASS |
| 17 | 4f planner "exactly what visitors see" preview equals anonymous payload | planner | A+P | equal JSON | equal=true | PASS |
| 18 | 4g public response headers (cache/leak) | anonymous | P | observation | cache-control=public, max-age=60 x-powered-by=null | PASS |
| 19 | 4h plan UUID is not a valid public slug | anonymous | P | 404 | 404 | PASS |
| 20 | 4i altered slug | anonymous | P | 404 | 404 | PASS |
| 21 | 5a Storage objects of the published plan (audio chart) not reachable anonymously (public path / anon key) | anonymous | S | 4xx | public=400 anonkey=400 | PASS |
| 22 | 5b anonymous Storage list of attachments bucket under org prefix returns nothing | anonymous | S | [] or 4xx | 200 [] | PASS |
| 23 | 6a member cannot create set-list public link | mem1 | A | 403 | 403 | PASS |
| 24 | 6b planner creates upcoming set-list link | planner | A | 201/200 slug | 200 slug=vRKgtEaJNiWbVvRgtFo0gA | PASS |
| 25 | 6c anonymous set list: minimal (organization, title/date, songs) and no private data; picks a published upcoming plan only | anonymous | P | 200; no private strings; keys minimal | 200 keys=organization,timezone,title,date,times,items,songs leaks= title=JRN Sunday Nov 29 | PASS |
| 26 | 6d set list shows only published plan (draft plan titles absent) | anonymous | P | no "template target" / draft titles | false | PASS |
| 27 | 7a ordinary member can issue a scoped service-type feed (permitted: feed carries only plan times the member can already read) | mem1 | A | 201 (observation; see 7d for draft plans) | 201 | PASS |
| 28 | 7b planner issues scoped service-type feed (token shown once) | planner | A | 200/201 url | 201 true | PASS |
| 29 | 7c scoped feed ICS: plan times only; no prepared assignment, people names, notes, emails | anonymous | P | 200 text/calendar; leaks none | 200 events=6 leaks= ctype=text/calendar; charset=utf-8 | PASS |
| 30 | 8a planner (not admin) cannot create API credential | planner | A | 403 | 403 | PASS |
| 31 | 8b owner creates plans.read credential; secret shown once | owner | A | 201 with secret | 201 secret=sck_22… | PASS |
| 32 | 8d external plan detail: no notes/assignments/files/people | api key | A (external) | 200; no private strings | 200 leaks= | PASS |
| 33 | 8e songs endpoint with plans.read-only key refused (scope) | api key | A (external) | 403 | 403 | PASS |
| 34 | 8f key cannot reach Beta plan id | api key | A (external) | 404 | 404 | PASS |
| 35 | 8g external API is read-only: POST refused | api key | A (external) | 404/405 | 404 | PASS |
| 36 | 8h API key is not a user session: internal API rejects it | api key | A | 401 | 401 | PASS |
| 37 | 8c external API plans list (from/to) with plans.read key: only Alpha plans, no private fields | api key | A (external) | 200; no private strings; no Beta | 200 n=3 leaks= beta=false fields=id,service_type_id,title,service_date,location,updated_at | PASS |
| 38 | 8c2 external API list: draft plans listed? (observation) | api key | A (external) | observation | draft plan "template target" in list=false | PASS |
| 39 | 7d scoped feed and external API with a DRAFT plan: draft plan times appear? (observation; plan oracle says draft is not public) | anonymous / api key | P+A | draft should not be served on public surfaces | feed has draft=false api has draft=false | PASS |
| 40 | 9a before revocation: public plan, set list, scoped feed, API key all 200 | n/a | P | 200 x4 | 200,200,200,200 | PASS |
| 41 | 9b member cannot unpublish | mem1 | A | 403 | 403 | PASS |
| 42 | 9c member cannot revoke API credential | mem1 | A | 403 | 403 | PASS |
| 43 | 10a planner unpublishes plan (expected_revision) | planner | A | 200 state revoked/unpublished | 200 state=revoked | PASS |
| 44 | 10b revoked public plan slug fails | anonymous | P | 404/410 | 404 | PASS |
| 45 | 10c revoked set-list link fails | anonymous | P | 404/410 | 200->404 | PASS |
| 46 | 10d revoked scoped feed fails | anonymous | P | 404/410 | 204->404 | PASS |
| 47 | 10e revoked API credential fails | api key | A (external) | 401 | 200->401 | PASS |
| 48 | 10f revoked API credential: plan detail also 401 | api key | A (external) | 401 | 401 | PASS |
| 49 | 10g after unpublish: authoring view shows unpublished and no preview (no stale cached projection from server) | planner | A | preview null | state=revoked preview=true | PASS |
| 50 | 10h public responses carry Cache-Control public,max-age=60: a CDN/browser cache may serve a revoked page up to 60 s (observation) | anonymous | P | observation | Cache-Control: public, max-age=60 on /public/plans/:slug (row 4g); origin refused immediately in 10b | PASS |
| 51 | 11a cleanup: draft probe plan deleted | planner | A | 204 | 204 | PASS |
| 52 | 11b no active API credentials left in namespace | owner | A | 0 active | active=0 | PASS |
| 53 | 11c scoped feeds left active by planner | planner | A | 0 | active=0 | PASS |
| 54 | 12a schedule CSV export as Band leader: prepared candB excluded from exports even for the managing leader | leader | A (export) | 200; prepared rows never exported (ACL-05: absent from report) | 200; Carl (prepared) absent, no private data | PASS |
| 55 | 12b schedule CSV export as unscheduled member | viewer | A (export) | 403/no private rows | 403 leaks= | PASS |
| 56 | 12c schedule CSV export as candB (holder of prepared request) | candB | A (export) | 403 / own prepared row absent | 403 carl=false | PASS |
| 57 | 12d candB personal calendar feed excludes the prepared request | candB | P | no plan event for candB | events=0 plan=false | PASS |
| 58 | 12e after release the same request appears for candB (schedule + personal feed); revoke feed after | candB | A+P | schedule 1 entry; feed has plan | release=200 schedule=1 feed=true | PASS |
| 59 | 12f personal feed cannot be revoked without issuing a replacement (known W3-INT-D9): rotated; old url dead | candB | P | old 404 | 404 | PASS |
| 60 | 9a public /p/:slug and /s/:slug pages rendered in a browser (HTML, OG tags, print) | anonymous | browser | n/a | NOT_RUN: browser owned by W7-WEB. API projection (what the page renders from) verified in 4b-4f, 6c | NOT_RUN |

