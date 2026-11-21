# QA-16 cross-feature acceptance journeys (JOURNEY-01..07), wave 9

Package: QA-16 (W9-JRN) · plan `docs/plans/admin-mobile-test-plan.md` §10 · commit `9aaeada` (`main`), branch `feature/qa-wave9` (tree clean at start; no code, migration or config changed by this package).
Date: 2026-11-21 · Node 26.13.1 · local Supabase (`supabase_db_service-center`, GoTrue/PostgREST/Storage on :54321) · API `http://localhost:4000` (shared, simulated email/push; `RESEND_API_KEY`/`EXPO_ACCESS_TOKEN` empty, `PUSH_ENABLED=false`) · web `:5173` not used (browser owned by W9-WEB) · simulator not used (W9-NATIVE) · no physical devices (QA-14).
Method: every journey step was driven over HTTP as the acting user with that user's own bearer token (the same REST API web and mobile call), plus caller-token PostgREST/Storage probes for permission evidence. Service role / `psql` was used only for setup (`private.create_church` for the two first owners, GoTrue admin user creation, `organization_members` inserts, one known respond-token hash for the guest, lease-expiry clock state) and for read-only persisted-state assertions. Passwords are only in the scratchpad (`.../scratchpad/jrn/creds.json`); none appear here. No private API instance or port 4660-4669 was needed; the shared API on :4000 stayed up throughout.

**P0 summary.** No cross-tenant read/write, no prepared-assignment exposure, no unauthorized write, no lost write, no overfill in 317 executed API/DB rows. **One private-data exposure inside a tenant is a P0-class candidate (W9-JRN-D1):** a member's private decline reason is readable by every active member of the organization (API and PostgREST). Severity is the coordinator's call (same-tenant, free-text reason; not cross-tenant).

## Totals

| Journey | Rows | PASS | FAIL | BLOCKED | NOT_RUN | N/A | Verdict |
|---|---|---|---|---|---|---|---|
| JOURNEY-01 | 46 | 37 | 5 | 0 | 4 | 0 | API PASS except D1; web/native UI NOT_RUN |
| JOURNEY-02 | 33 | 30 | 0 | 0 | 3 | 0 | API PASS; localized page, native open, universal link NOT_RUN |
| JOURNEY-03 | 34 | 32 | 0 | 0 | 1 | 1 | API PASS; replacement notifications = documented gap (N/A); UI NOT_RUN |
| JOURNEY-04 | 53 | 50 | 0 | 0 | 3 | 0 | server side PASS; playback, offline cold launch NOT_RUN |
| JOURNEY-05 | 56 | 53 | 0 | 0 | 3 | 0 | Live/attendance/export PASS; UI, device interruption NOT_RUN |
| JOURNEY-06 | 54 | 51 | 0 | 0 | 3 | 0 | API PASS; widget, real push, universal link NOT_RUN |
| JOURNEY-07 | 61 | 59 | 0 | 0 | 2 | 0 | API PASS; public page in browser NOT_RUN |
| **All** | **337** | **312** | **5** | **0** | **19** | **1** | |

## Environment, namespace and fixture shape

- Orgs `qa-w9-jrn-a` (Alpha "JRN Alpha W9", `America/Chicago`, id `d2ed0fb2-b56f-4216-9098-3ee083df1710`) and `qa-w9-jrn-b` (Beta "JRN Beta W9", `Asia/Ho_Chi_Minh`, id `ab708988-2365-4b5c-87f6-3ea993196e55`). Self-serve creation is off, so both came from `private.create_church` for their first owner (setup only).
- 14 users `<alias>.qaw9.jrn@example.test`: `owner` (Alpha owner), `planner` (role scheduler, **scoped** mode: `plans.edit` + `scheduling.manage` on service type "JRN Sunday"), `leader` (member; `scheduling.manage` + `teams.manage` on team "JRN Band" only; `scheduling.override_conflicts` added by the owner in JOURNEY-03), `mem1` (Acoustic + Bass, "Maya Pending"), `mem2` (Drums, Camera), `mem3` (Keys, blockout), `candA`/`candB` (Keys, Drums), `librarian` (org `songs.manage`), `mediaed` (org `media.manage`), `viewer` (no team, no assignment), `multi` (member of Alpha and Beta, distinct Persons), `betaowner` (Beta owner only), `gus` (no-login guest Person "Gus Guest", Vietnamese; account created in JOURNEY-02 by invitation), plus a no-email guest Person "Nora Newperson" (Keys).
- Alpha: service types "JRN Sunday"/"JRN Midweek"; teams "JRN Band" (Acoustic, Bass, Drums, Keys) and "JRN Production" (Camera, Sound); plans Dec 6 (rehearsal 08:00, services 09:00 and 11:00 Chicago; published; Live runs 9:00 and 11:00 ended), Dec 13 (guest), Dec 20 (blockout/replacement), Dec 27 (multi), Jan 3, Jan 10 and Jan 17 probes; template "JRN Sunday template"; song "JRN Journey Song" + arrangement; audio (2 versions) and chart PDF files; notes/document/prepared sentinels `SENTINEL-*-7f3a`.
- Beta: same names ("JRN Sunday", "JRN Band"), plans `BETA-SECRET-PLAN` (released to multi), `BETA-PREP-PLAN` (prepared then released), `BETA-OTHER-ONLY` (multi not scheduled) to detect cross-tenant leakage.
- Resource IDs are asserted equal at each hop inside a journey (see rows).

## Delivery worker runs (global; I was the only agent running it)

`backend/dist` is not built, so `npm run worker` (node dist/worker.js) could not run; the identical code path was run from source: `cd backend && RESEND_API_KEY= EXPO_ACCESS_TOKEN= PUSH_ENABLED=false npx tsx src/worker.ts` (one bounded run, simulated providers, no private API instance). All API-triggered effects of this package were delivered inline by the API (`deliverEffectNow`), so the worker was needed only for the report exports and as a sweep.

| Run | When (UTC) | Output | Attributable to `qa-w9-jrn-*` |
|---|---|---|---|
| 1 | 14:53:06, after JOURNEY-05 export request | deliveries claimed 49 / completed 49, retried 0, abandoned 0; reminders enqueued 6; report exports claimed 2 / ready 2; webhooks claimed 7 / failed 7; files expired 1 / removed 7 objects; notifications deleted 0 | 2 exports (both mine: owner and leader `participation` CSV). 0 of my deliveries were queued (all delivered inline). The 49 deliveries, 6 reminders, 7 webhook attempts and 7 removed storage objects belonged to other namespaces (rs-*, qa-w8-*); my 3 storage objects stayed intact (J05-10g). |
| 2 | 14:57:55, final sweep | all zero | 0 |

Final deliveries in the namespace: Alpha simulated 13, delivered 13, skipped 12 (`no_active_device` / no email for the no-email guest); Beta simulated 3, delivered 2, skipped 1. No `queued` rows. 10 reminder jobs remain `scheduled` in the future (Alpha).


## JOURNEY-01

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J01-01a | owner | API POST /service-types | 201 service type | 201 id=94aeca70-5cfa-422b-b219-a0d3a5d74807 | PASS |
| J01-01b | owner | API POST /teams | 201 team with 4 positions | 201 team=9ca0818a-b462-4f14-8654-fc9f30d342e0 positions=Acoustic,Bass,Drums,Keys | PASS |
| J01-01c | owner | API POST /people/guests | 201 no-login Person | 201 person=1f2dcb86-6841-4acc-bd46-0250941670c3 | PASS |
| J01-01d | owner | API POST /teams/:id/members | roster adds 201/204 | 201 | PASS |
| J01-02a | owner | API PATCH /access/members/:id | planner scoped | 200 | PASS |
| J01-02b | owner | API PUT service-types/:id/access | planner grants at JRN Sunday | 200 {"scope_type":"service_type","scope_id":"94aeca70-5cfa-422b-b219-a0d3a5d74807","grants":[{"id":"0f82 | PASS |
| J01-02c | owner | API PUT teams/:id/access | leader grants at JRN Band | 200 {"scope_type":"team","scope_id":"9ca0818a-b462-4f14-8654-fc9f30d342e0","grants":[{"id":"121642c3-b90 | PASS |
| J01-03a | planner | API POST /plans | 201 draft plan with 3 times (service-type grant only) | 201 plan=cb15ac73-ffad-4a95-8e7b-832ea6e53a35 times=3 | PASS |
| J01-03b | leader | API PATCH /plans/:id (no plans.edit) | denied 403/404 | 403 You need the “Edit plans” permission to do that | PASS |
| J01-03c | mem1 | API POST /plans (ordinary member) | denied | 403 | PASS |
| J01-03d | planner | API POST /plans/:id/items x3 | items created | ids=65ad3737,925a6033,b611100e | PASS |
| J01-03e | planner | API PUT items/order | reorder 200 | 200  | PASS |
| J01-03f | planner | API POST /plan-templates (source plan) | 201 template | 201 tpl=e33b11e3-19a3-4fc1-9b48-1375c9ce1bad  | PASS |
| J01-04a | leader | API POST /plans/:id/assignments visibility=prepared | 4 prepared rows incl. guest-Person row | 4 rows, visibility=prepared | PASS |
| J01-04b | db | delivery_effects/notifications/assignment_notifications while prepared | 0 effects, 0 notifications, 0 tokens | effects=0 notifications=0 tokens=0 | PASS |
| J01-04c.mem1 | mem1 | API schedule/plan/schedule/notifications/calendar/attendance + PostgREST | prepared assignments invisible | not visible on 9 surfaces | PASS |
| J01-04c.mem2 | mem2 | API schedule/plan/schedule/notifications/calendar/attendance + PostgREST | prepared assignments invisible | not visible on 9 surfaces | PASS |
| J01-04c.viewer | viewer | API schedule/plan/schedule/notifications/calendar/attendance + PostgREST | prepared assignments invisible | not visible on 9 surfaces | PASS |
| J01-04d | leader | API GET /releases/prepared | leader sees own prepared (4) | 200 n=4 | PASS |
| J01-04e | mem1 | API GET /releases/prepared | denied or empty | 403 n=- | PASS |
| J01-05a | leader | API POST release/preview | preview shows per-assignment exact times (Maya Acoustic 3, Bass 1, Drum 2, Keys 1) | Maya Pending/Acoustic:3,Maya Pending/Bass:1,Nora Newperson/Keys:1,Drew Drummer/Drums:2 | PASS |
| J01-05b | leader | API POST release (stale revision) | 409 refused, nothing released | 409 assignment_release_stale | PASS |
| J01-05c | mem2 | API POST release (ordinary member) | denied | 403 | PASS |
| J01-05d | leader | API POST /plans/:id/release | 200 released 4 | 200 released=4 | PASS |
| J01-05e | leader | API POST release replay same idempotency key | no second effect/notification | replay=200 effects 1->1 | PASS |
| J01-06a | mem1 | API GET /schedule/mine | 2 released assignments (Acoustic, Bass) same IDs | 2 entries | PASS |
| J01-06b | mem1 | API POST responses/preview | review scope Acoustic 3 times, Bass 11:00 only | {"ac":"Rehearsal/9:00/11:00","bs":"11:00"} | PASS |
| J01-06c | mem2 | API POST responses/commit (other person snapshot) | denied, nothing written | 404 not_found | PASS |
| J01-06d | mem1 | API commit with out-of-scope time (Bass @9:00 not requested) | refused, no rows | 409 conflict | PASS |
| J01-06e | mem1 | API POST responses/commit | 200 committed | 200 | PASS |
| J01-06f | db | assignment_time_responses persisted | exactly 4 rows: Acoustic reh/9 confirmed, 11 declined+reason; Bass 11 confirmed; actor = mem1 | 4 rows 11:00:confirmed,11:00:declined,9:00:confirmed,Rehearsal:confirmed | PASS |
| J01-06g | db | assignments.status after per-time answers | Acoustic (3 confirmed,1 declined) -> aggregate; Bass confirmed | [{"id":"16401250-f841-448e-93a2-36c35d15a52d","pos":"Acoustic","status":"unconfirmed"},{"id":"05221330-30ec-420b-878e-68116349bae2","pos":"Bass","status":"confirmed"}] | PASS |
| J01-06h | db | assignment_time_response_history | one history row per answered time (4) | 4 rows | PASS |
| J01-07a | planner | API GET /plans/:id (web staffing view) | same 4 assignment IDs; Acoustic aggregate unconfirmed(mixed) with per-time answers confirmed x2 + declined x1 w/ reason; Bass confirmed | n=4; Acoustic=unconfirmed time_responses=confirmed,confirmed,declined; Bass=confirmed | PASS |
| J01-07b | planner | API plan view decline reason | scheduler (response owner scope) sees decline reason | {"status":"declined","actor_id":"254aea0d-a82a-4cfc-8d2d-ad87cc1a89a0","plan_time_id":"d5e2b057-c32e-4795-9d18-b9a5f6f7daaa","responded_at":"2026-11-21T14:44:42 | PASS |
| J01-07c | viewer (no team, no assignment) | API GET /plans/:id as unrelated member | other member's private decline reason must NOT be returned (plan §3 / RESP-02 "private reason"); roster rows themselves may be visible | time_responses[].response_note="Out of town at 11" returned to unscheduled member (W9-JRN-D1) | FAIL |
| J01-07d | mem2 | API POST /assignments/:id/respond | 200 confirmed | 200 confirmed | PASS |
| J01-07e.viewer | viewer | PostgREST assignment_time_responses (caller token) | no decline reason for other people | 200 reason visible: ["Out of town at 11"] | FAIL |
| J01-07e.mem2 | mem2 | PostgREST assignment_time_responses (caller token) | no decline reason for other people | 200 reason visible: ["Out of town at 11"] | FAIL |
| J01-07e.candA | candA | PostgREST assignment_time_responses (caller token) | no decline reason for other people | 200 reason visible: ["Out of town at 11"] | FAIL |
| J01-07e.candB | candB | PostgREST assignment_time_responses (caller token) | no decline reason for other people | 200 reason visible: ["Out of town at 11"] | FAIL |
| J01-07f | betaowner | PostgREST assignment_time_responses (other tenant) | 0 rows | 200 rows=0 | PASS |
| J01-N1 | owner/planner/leader | Web UI: create type/team/Person, plan editor, template, order, prepare, release preview |  same IDs/scope rendered in the web UI | browser owned by W9-WEB (not used here); API half PASS (J01-01..05) | NOT_RUN |
| J01-N2 | mem1 | Native UI: schedule card, review sheet per-time answers | exact reviewed scope shown, answer persists | simulator owned by W9-NATIVE (not used here); API half PASS (J01-06) | NOT_RUN |
| J01-N3 | planner | Web staffing view/matrix after answer | staffing reflects answer without reload mismatch | browser owned by W9-WEB (not used here); API half PASS (J01-07a) | NOT_RUN |
| J01-N4 | mem1 | Real push/email receipt after release | push on a physical device in member language | QA-14 physical devices unavailable; delivery rows (simulated email, in_app delivered, push skipped no device) PASS J01-05 | NOT_RUN |

## JOURNEY-02

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J02-01a | leader | API POST /people/guests | 201 no-login Person with synthetic email | 201 person=48c13e83-6a48-4788-a3d2-135f082d04dc | PASS |
| J02-01b | owner | API PATCH /people/:id preferred_language=vi | 200 vi | 200 vi | PASS |
| J02-01c | leader | API PATCH /people/:id (non-owner edit denied) | denied | 403 | PASS |
| J02-02a | leader | API create prepared assignment for guest | 201 prepared, user_id null | 201 asg=a3ca8475-a893-48ce-adb4-080d85820ffc vis=prepared user_id=null | PASS |
| J02-02b | db | assignment_notifications/deliveries before release | 0 | 0 | PASS |
| J02-02c | leader | API release | 200 | 200 | PASS |
| J02-02d | db | deliveries for guest | email delivery (simulated) with locale vi; no push/in-app (no login) | [{"channel":"email","status":"simulated","locale":"vi"}] | PASS |
| J02-02e | db | assignment_notifications token row | 1 token row for guest person | 1 | PASS |
| J02-03a | anonymous | API GET /assignment-responses/:token | localized (vi) preview, 1 assignment, no email/other people | 200 keys=snapshot_id,snapshot_version,plan_title,service_date,service_time,location,person_first_name,preferred_language,assignments,expires_at | PASS |
| J02-03b | anonymous | preview body privacy | no email address, no other persons, no UUID of other assignments | email present=false | PASS |
| J02-03c | anonymous | API POST token respond confirmed | 200, answer persisted for the one scoped time | 200 | PASS |
| J02-03d | db | assignment_time_responses | exactly 1 row for 9:00 time, confirmed | [{"status":"confirmed","plan_time_id":"0bacd1ec-6feb-47d7-9610-9b78fdde1dc5","actor_id":null}] | PASS |
| J02-03e | db | assignments.status | confirmed | confirmed | PASS |
| J02-03f | anonymous | token reuse | 410/404 single use; answer unchanged | 410 assignment_notification_used | PASS |
| J02-03g | db | scheduler notified of guest answer | scheduler_response effect to response owner (Leo) | [{"template":"scheduler_response","response_status":"confirmed","channel":"in_app","first_name":"Leo"},{"template":"scheduler_response","response_status":"confirmed","channel":"push","first_name":"Leo"}] | PASS |
| J02-03h | anonymous | invalid token | 404 | 404 | PASS |
| J02-04a | owner | API POST /people/:id/invitations | 201 invite_url for Person email | 201 invited=true | PASS |
| J02-04b | anonymous | API GET /invitations/:token | preview in vi, same email | 200 lang=vi | PASS |
| J02-04c | db | invitation created: assignments/notifications unchanged | invitation never substitutes for assignment | [{"asg":"1","n":"1","an":"1"},{"asg":"1","n":"1","an":"1"}] | PASS |
| J02-04d | anonymous | API POST /invitations/:token/accept (new account) | 200 account created | 200 | PASS |
| J02-04e | anonymous | invitation reuse | 410 | 410 | PASS |
| J02-05a | db | Person linked to account | same Person id now linked, no duplicate Person, language vi preserved | {"dupes":"1","id":"48c13e83-6a48-4788-a3d2-135f082d04dc","linked":true,"preferred_language":"vi"} | PASS |
| J02-05b | db | organization membership created by accept | 1 active member (role per invite) | 1 | PASS |
| J02-05c | gus | API GET /schedule/mine (native schedule data) | same assignment ID, already confirmed, one 9:00 time | 1 entry status=confirmed | PASS |
| J02-05d | gus | API GET /me/language-preference | vi persisted on the same Person | 200 {"preferred_language":"vi","person_linked":true} | PASS |
| J02-05e | gus | API GET /notifications | no replayed notification/assignment created by invitation | items=0 | PASS |
| J02-05f | db | answer provenance preserved | token-origin answer (actor null) still confirmed after account link | [{"status":"confirmed","actor_id":null}] | PASS |
| J02-05g | anonymous | old respond link after account link | still single-use (410) / no re-answer | 410 assignment_notification_used | PASS |
| J02-05h | gus | API GET /plans/:id (deep-link target) | plan opens for the linked guest | 200 | PASS |
| J02-05i | gus | API X-Organization-Id Beta (not a member) | 403/404 | 403 | PASS |
| J02-N1 | anonymous | Web /respond page rendered in Vietnamese with diacritics | localized UI copy and layout | browser owned by W9-WEB (not used here); API preview carries preferred_language=vi (J02-03a) | NOT_RUN |
| J02-N2 | gus | Native sign-in, schedule and profile screens open (Vietnamese) | same Person/answer/language in native UI | simulator owned by W9-NATIVE (not used here); API half PASS (J02-05) | NOT_RUN |
| J02-N3 | gus | Universal link /respond and /accept-invite cold launch on device | link opens app with right target or browser fallback | QA-14 physical devices unavailable | NOT_RUN |

## JOURNEY-03

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J03-01a | mem3 | API POST /blockouts | 201 own blockout | 201 id=08aa74e3-3a29-4b67-9caf-4921a9953827 | PASS |
| J03-01b | mem1 | API POST /blockouts for another person | denied | 403 | PASS |
| J03-02a | leader | API POST /scheduling/conflicts/check | blocking conflict reported, blockout reason redacted | 200 reasonLeaked=false | PASS |
| J03-02b | leader | PostgREST blockouts (caller token) | no direct read of others blockouts / reason | 200 rows=0 | PASS |
| J03-02c | owner | PostgREST blockouts (owner token) | owner (documented exception) can read; leader/others cannot (row J03-02b) | owner reads 1 row incl. reason per documented can_read_blockout_reason contract | PASS |
| J03-03a | leader | API create assignment over blockout, no reason | 409 conflict, no row | 409 scheduling_conflict | PASS |
| J03-03b | leader | API create with reason but without override capability | 403, no row | 403 forbidden | PASS |
| J03-03c | planner | API create with reason (planner lacks scheduling.override_conflicts) | 403 | 403 forbidden | PASS |
| J03-03d | owner | API PUT teams/:id/access add override capability | 200 | 200 | PASS |
| J03-03e | leader | API create with reason + override capability | 201 assignment created, released | 201 asg=06c7f2ba-2a2e-431f-b38f-123a96b7df5e | PASS |
| J03-03f | leader | API GET /plans/:id/conflict-overrides | audit row: assignment, person, actor, reason, redacted conflict | 200 rows=1 keys=id,organization_id,assignment_id,person_id,plan_id,team_id,conflicts,reason,actor_id,transaction_id,created_at | PASS |
| J03-03g | mem1 | API GET conflict-overrides as ordinary member | denied/empty | 403 | PASS |
| J03-04a | mem3 | API POST /assignments/:id/respond declined | 200 declined with private reason | 200 declined | PASS |
| J03-04b | db | assignment_responses (legacy respond route history) | 1 row unconfirmed->declined with private reason | [{"previous_status":"unconfirmed","status":"declined","response_note":"Family trip, cannot make it"}] | PASS |
| J03-05a | mem3 | API POST /replacement-requests | 201 request for declined assignment | 201 id=f4323f7b-9e0e-4f65-979d-1d9622415670 ver=1 | PASS |
| J03-05b | mem1 | API replacement request on someone else assignment | denied | 403 | PASS |
| J03-05c | leader | API POST replacement offer to candA | 201 offer pending candidate consent | 201 offer=a74f2e04-2793-4369-af62-9dc0fe6645f6 status=pending ver=1 | PASS |
| J03-05d | candA | API offer action approve by candidate | refused (cannot self-approve) | 403 forbidden | PASS |
| J03-05e | candB | API accept someone elses offer | denied | 403 | PASS |
| J03-05f | candA | API offer accept (consent) | 200 consent recorded, no assignment yet | 200 status=accepted_awaiting_approval | PASS |
| J03-05g | leader | API offer approve | 200 approved | 200 status=finalized | PASS |
| J03-06a | db | assignments after approval | one new assignment for candA, Keys, same time scope; original mem3 row still present | {"n":2,"candA":1,"attTimes":0,"mem3status":"declined"} | PASS |
| J03-06b | db | original decline intact after replacement approval | history row + declined status unchanged | rows=1 status=declined | PASS |
| J03-06c | db | Keys capacity | exactly 1 active Keys holder (no overfill) | 1 | PASS |
| J03-06d | leader | API second offer on filled request | refused | 409 conflict | PASS |
| J03-06e.leader | leader | PostgREST assignment_responses (caller token) | leader (response owner) may read; others none | [{"response_note":"Family trip, cannot make it"}] | PASS |
| J03-06e.candA | candA | PostgREST assignment_responses (caller token) | no rows | [] | PASS |
| J03-06e.viewer | viewer | PostgREST assignment_responses (caller token) | no rows | [] | PASS |
| J03-06e.mem1 | mem1 | PostgREST assignment_responses (caller token) | no rows | [] | PASS |
| J03-06f | candA | API conflict-overrides as replacement candidate | denied | 403 | PASS |
| J03-06g | candA | API GET /schedule/mine | new assignment shows exact 9:00 (15:00Z-16:00Z) only | 1 entry times=2026-12-20T15:00:00+00:00 | PASS |
| J03-06h | mem3 | API GET /schedule/mine after replacement | own declined row remains | ["declined"] | PASS |
| J03-07 | all | notification/delivery for replacement offer/consent/approval | F08 transition delivery for replacement events (not implemented: documented gap mobile-first-10-progress.md:68) | no effect/notification created for offer, consent, approval | NOT_APPLICABLE |
| J03-N1 | mem3/leader/candA | Web+native UI: blockout form, conflict banner, override dialog, decline sheet, replacement request/offer screens | UI flow and wording | browser owned by W9-WEB (not used here) / simulator owned by W9-NATIVE (not used here); API halves PASS (J03-01..06) | NOT_RUN |

## JOURNEY-04

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J04-00a | owner | API PUT /access/organization | librarian songs.manage + mediaed media.manage (org scope) | 200 | PASS |
| J04-01a | librarian | API POST /songs | 201 song + default arrangement | 201 song=329d283c-d49b-4762-aeb0-8cb6d1ae6f73 arr=05ed91f8-4140-48b5-b857-95833610d5d0 | PASS |
| J04-01b.planner | planner | API POST /songs w/o songs.manage | denied | 403 | PASS |
| J04-01b.mem1 | mem1 | API POST /songs w/o songs.manage | denied | 403 | PASS |
| J04-01b.mediaed | mediaed | API POST /songs w/o songs.manage | denied | 403 | PASS |
| J04-01b.leader | leader | API POST /songs w/o songs.manage | denied | 403 | PASS |
| J04-02a | librarian | API PATCH /arrangements/:id (revision check) | 200, bpm 84, sequence V1,C,C | 200 rev=2 seq=V1,C,C | PASS |
| J04-02b | librarian | API PATCH with stale revision | 409, nothing changed | 409 arrangement_revision_stale | PASS |
| J04-02c | planner | API PATCH arrangement w/o songs.manage | denied | 403 | PASS |
| J04-03a | planner | API POST /plans/:id/items (song, key C, sequence C,V1,C) | 201 plan-only overrides | 201 item=3c275f09-9688-484a-ad6c-5956ddb5ae1a key=C seq=C,V1,C | PASS |
| J04-03b | db | library arrangement unchanged by plan override | song_key G, sequence V1,C,C | {"song_key":"G","sequence":["V1","C","C"],"revision":2} | PASS |
| J04-03c | planner | API GET /plans/:id item | item shows key C, sequence C,V1,C, arrangement ref | key=C seq=C,V1,C | PASS |
| J04-03d | mem1 | API GET chart ?to=C (member reading the service key) | 200, key C, semitones 5 | 200 key=C semi=5 | PASS |
| J04-04a | mem1 | API POST /files/upload-intents (ordinary member) | denied | 403 forbidden | PASS |
| J04-04b | mediaed | API upload intent -> Storage PUT -> finalize (chart PDF) | ready, exact size | intent=201 put=200 finalize=200 ready | PASS |
| J04-04c | mediaed | API upload audio to plan item (audience scheduled) | ready | intent=201 put=200 finalize=200 ready | PASS |
| J04-05a | mem1 | API GET rehearsal-manifest (scheduled member) | song item with chart in service key C + sequence C,V1,C and audio material; tempo 84 | materials=2 key="C" bpm=84 track=true | PASS |
| J04-05b.mem2 | mem2 | API rehearsal-manifest audio audience=scheduled | audio present (scheduled) | 200 audio=true materials=2 | PASS |
| J04-05b.viewer | viewer | API rehearsal-manifest audio audience=scheduled | audio absent (unscheduled) | 200 audio=false materials=1 | PASS |
| J04-05b.candB | candB | API rehearsal-manifest audio audience=scheduled | audio absent (unscheduled) | 200 audio=false materials=1 | PASS |
| J04-05b.mem3 | mem3 | API rehearsal-manifest audio audience=scheduled | audio absent (unscheduled) | 200 audio=false materials=1 | PASS |
| J04-05c | mem1 | API files/:id/download + Storage GET | signed URL returns exactly the uploaded bytes (size + sha256) | 200 size=16690 (want 16690) shaMatch=true | PASS |
| J04-05d.viewer | viewer | API download audio (not scheduled) | denied | 404 | PASS |
| J04-05d.candB | candB | API download audio (not scheduled) | denied | 404 | PASS |
| J04-06a | mediaed | API new file version (upload-intent file_id+expected_revision, PUT, finalize) | v2 ready | intent=201 put=200 finalize=ready v=2 | PASS |
| J04-06b | mediaed | API upload intent with stale revision | 409 refused | 409 file_revision_stale | PASS |
| J04-06c | mem1 | API offline-pack after replacement | entry version 2, exact size, bytes match v2 checksum; plan revision recorded | ver=2 size=25030 dl=25030 sha=true plan_rev=10 recheck_by=2026-11-22T14:49:36.213Z | PASS |
| J04-07a | mediaed | API PUT playback-rights stream_only | 200 | 200 | PASS |
| J04-07b | mem1 | API offline-pack with stream_only audio | audio excluded from pack (chart still in) | entries=chart.pdf | PASS |
| J04-07c | mem1 | API download of stream_only audio as attachment | refused (stream only) | 403 file_stream_only | PASS |
| J04-07d | mem1 | API inline stream of stream_only audio | allowed (stream) | 200 | PASS |
| J04-08a | mediaed | API PATCH /files/:id audience scheduled->leaders | 200 | 200 audience=leaders | PASS |
| J04-08b | mem1 | API manifest after narrowing | audio gone from manifest, track_file_id null | materials=1 track=null | PASS |
| J04-08c | mem1 | API download after narrowing | denied immediately | 404 | PASS |
| J04-08d | mem1 | API offline-pack after narrowing | audio not in pack | entries=chart.pdf | PASS |
| J04-08e | mem1 (holder of old signed URL) | Storage GET via signed URL issued before narrowing | signed URL = bearer capability until expiry (documented lifetime); record result | HTTP 200 (expected to work until TTL; see signed-url-lifetime.test.ts) | PASS |
| J04-08f | planner | API download audience=leaders (plan editor = "leaders") | allowed (positive control); note team-scoped scheduler leader is NOT in "leaders" audience (private.is_plan_leader) - 404 | planner 200 | PASS |
| J04-09a | anonymous | Storage GET object (anon, no signature) | denied | 400 | PASS |
| J04-09c | mem1 | Storage list prefix (member token) | no objects listed | 200 n=0 | PASS |
| J04-10a | multi | API Alpha plan manifest under Beta org header | 404/403, no Alpha pack | 404 | PASS |
| J04-10b | multi | API Alpha manifest as unscheduled Alpha member | manifest ok, no audio (leaders audience) | 200 | PASS |
| J04-10c | multi | API offline-pack Alpha plan with Beta header | denied | 404 | PASS |
| J04-10d | betaowner | API Alpha manifest (non-member, Alpha header) | 403/404 | 403 | PASS |
| J04-10e | betaowner | API download Alpha file under Beta header | 404 | 404 | PASS |
| J04-08g | mem2 | API download after narrowing | denied (scheduled member, not leader) | 404 | PASS |
| J04-09b.v1 | mem1 | Storage authenticated GET with member JWT (audience narrowed) | denied | 400 | PASS |
| J04-09b.v2 | mem1 | Storage authenticated GET with member JWT (audience narrowed) | denied | 400 | PASS |
| J04-09d | planner | Storage authenticated GET with planner JWT (positive control) | 200 | 200 | PASS |
| J04-09e | viewer | Storage authenticated GET (never scheduled) | denied | 400 | PASS |
| J04-08h | mem1 | API download after audience restored to scheduled | allowed again (rights re-evaluated live) | 200 | PASS |
| J04-N1 | librarian/planner/mediaed | Web UI: arrangement editor, plan song key/sequence, file upload progress/preview | UI flow | browser owned by W9-WEB (not used here); API half PASS (J04-01..04) | NOT_RUN |
| J04-N2 | mem1 | Native rehearsal player playback/speed, chart view in service key, download-for-offline | chart in key C with sequence C,V1,C; audio plays; pack saved | simulator owned by W9-NATIVE (not used here)/QA-14 physical devices unavailable; manifest, pack and signed download PASS (J04-05..08) | NOT_RUN |
| J04-N3 | mem1 | Offline cold launch of the offline pack, expiry after recheck_by, cross-account pack cleanup on sign-out/org switch | offline plays only the cached authorized version; other account cannot read pack | QA-14 physical devices unavailable (OFFLINE-01/02); server side: recheck_by 24 h, other-account pack refused (J04-10) | NOT_RUN |

## JOURNEY-05

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J05-01a | viewer | API POST /plans/:id/runs (ordinary member) | denied | 403 | PASS |
| J05-01b | planner | API POST /plans/:id/runs (web controller, first occurrence 9:00) | 201 run for 9:00 time, can_control | 201 run=37ed92c8-9218-408a-97fb-ed3ab6bdce98 status=ready rev=1 | PASS |
| J05-02a | planner | API run action start | 200 status live | 200 status=live rev=2 (observed in first pass) | PASS |
| J05-02b | planner | API replay start with same action_id (lost reply) | replayed=true, revision unchanged | 200 replayed=true rev=2 | PASS |
| J05-02c | planner | API advance | 200 index+1 | 200 idx=2 | PASS |
| J05-03a | mem1 | API GET /runs/:id/state (mobile viewer) | 200, can_control=false, same run | 200 can_control=false rev=3 | PASS |
| J05-03b | mem1 | API run action advance as viewer | denied, state unchanged | 403 forbidden | PASS |
| J05-04a | leader | API advance/take_over by team-scoped scheduler (no plans.edit/Live control) | 403 forbidden: Live control needs plan-level capability | 403 forbidden on advance and take_over (team-scoped scheduling.manage is not Live control) | PASS |
| J05-04b | owner | API take_over with reason (mobile controller) | 200, owner now holds the one Live state | 200  | PASS |
| J05-04c | planner | API old controller advance after takeover | refused run_control_lost | 409 run_control_lost | PASS |
| J05-04d | owner | API new controller state after takeover | owner can_control, controller_client mobile-owner, last item reached | rev=5 idx=3 client=mobile-owner | PASS |
| J05-05a | owner | API resume with stale expected_revision (reconnect) | 409, state unchanged (still paused) | 409 run_revision_stale | PASS |
| J05-05b | mem1 | API viewer state after reconnect | viewer sees same revision and pause | viewer rev=6 paused=true | PASS |
| J05-04b0 | owner | API advance by non-holder | refused while planner holds the lease | 409 run_control_lost | PASS |
| J05-04e | owner | API advance past last item | 400 bad_request (end instead), no change | 400 bad_request | PASS |
| J05-05a0 | owner | API pause | 200 paused | 200 rev=6 | PASS |
| J05-05c | owner | API replay resume (lost reply) same action_id | applied once: replayed=true, revision same | 200 replayed=true rev=7/7 | PASS |
| J05-05d | owner | API action after lease expiry (network drop > lease) | refused until take_control | 409 run_control_lost | PASS |
| J05-05e | owner | API take_control after expiry/reconnect | 200 owner regains the one Live state | 200  | PASS |
| J05-06d | owner | API end 9:00 run | 200 ended | 200 status=ended | PASS |
| J05-06e | planner | API start 11:00 run | independent: 9:00 run stays ended | 200 11:00=live 9:00=ended | PASS |
| J05-06a | planner | API POST runs for 11:00 occurrence | separate run id/time from 9:00 | 201 run=0457060e-345c-4b6c-a379-61864d5a2d69 | PASS |
| J05-06b | planner | API second run for same occurrence (different key, other client) | one Live state: refused 409 or same run | 409 run_exists | PASS |
| J05-06f | planner | API end 11:00 run | 200 ended | 200 | PASS |
| J05-06c | db | live_runs rows | exactly 2 runs, one per occurrence | 2 | PASS |
| J05-07a | viewer | API POST /runs/:id/corrections (ordinary member) | denied | 403 | PASS |
| J05-07b | planner | API correction with stale revision | 409 | 409 run_revision_stale | PASS |
| J05-07c | planner | API correct transition time with reason | 200; audited correction (actor, reason, old/new time) | 200 corrections=1 {"id":28,"run_id":"37ed92c8-9218-408a-97fb-ed3ab6bdce98","organization_id":"d2ed0fb2-b56f-4216-9098-3ee083df1710","transition_id":784,"revision":10,"previous_at | PASS |
| J05-07d | planner | API correction beyond neighbouring transition | refused (order must hold) | 400 bad_request | PASS |
| J05-07e | planner | API per-occurrence history independence | 11:00 run history has 0 corrections and its own transitions; 9:00 has 1 | 9:00 transitions=9 corrections=1; 11:00 transitions=4 corrections=0 | PASS |
| J05-08a | viewer | API POST attendance (ordinary member) | denied | 403 | PASS |
| J05-08b | leader | API POST /plans/:id/attendance (9:00) | 200 recorded: Maya present, Drew absent (confirmed but absent), Nora unknown | 200 | PASS |
| J05-08c | leader | API attendance correction with stale revision (0 but record is 1) | 409, no change | 409 attendance_revision_stale | PASS |
| J05-08d | leader | API attendance correction absent->present with reason | 200, revision 2 | 200 {"status":"present","revision":2,"person_id":"f0820fe0-be45-4900-b487-7cf104e2fc57","record_id":"dab39295-07d1-431a-a619-1e4168d2cb11"} | PASS |
| J05-08e | leader | API GET attendance/history (audit) | 2 events: absent (rev1), present (rev2, with reason + actor) | 200 n=2 [["absent",null],["present","Arrived late, was marked absent by mistake"]] | PASS |
| J05-08f | leader | API replay same attendance idempotency key | no extra event/revision (replayed) | 200 events=2->2 | PASS |
| J05-08g | leader | API attendance 11:00 | 200 applied 2 | 200  | PASS |
| J05-08h | leader | attendance sheet 11:00 Maya | one Person row though two roles; single mark per Person per occurrence | rows=1 roles=Bass:confirmed,Acoustic:unconfirmed | PASS |
| J05-09a | owner | API GET /reports/participation | summary reconciles with recorded marks: present 4, absent 0, unknown 1, people 3 | summary={"assignments":4,"people":3,"person_plans":3,"present":4,"absent":0,"unknown":1,"teams":[{"team_id":"9ca0818a-b462-4f14-8654-fc9f30d342e0","team_name":"JRN Band","assignments":4,"people":3,"person_plans":3}]} | PASS |
| J05-09b | owner | participation rows vs summary | row totals equal summary (present, unknown) | rows present=4 unknown=1 | PASS |
| J05-09c | owner | API GET /reports/run-times | 2 runs (9:00,11:00) listed with their own actuals | 200 rows=2 summary={"runs":2,"planned_seconds":4200,"actual_seconds":42,"average_difference_seconds":-2079} | PASS |
| J05-09d | owner | API GET /reports/staffing | summary present; compare with DB oracle | summary={"plans":1,"needed":0,"confirmed":2,"pending":2,"declined":0,"vacancies":0,"follow_ups":[{"plan_id":"cb15ac73-ffad-4a95-8e7b-832ea6e53a35","plan_title":"JRN Sunday Dec 6","service_date":"2026-12-06T15:00:00+00:00","person_id":"15568fd1-8f05-40ed-b138-d86386a105ba","person_name":"Maya Pending","team_name":"JRN Band","position_name":"Acoustic","response":"unconfirmed","released_at":"2026-11- | PASS |
| J05-09e.leader | leader | API GET /reports/participation | allowed within managed scope or denied | 200 rows=3 | PASS |
| J05-09e.mem1 | mem1 | API GET /reports/participation | denied for ordinary member | 403 rows=undefined | PASS |
| J05-09e.viewer | viewer | API GET /reports/participation | denied for ordinary member | 403 rows=undefined | PASS |
| J05-09f | owner | API GET participation CSV | CSV rows match report rows; no formula injection | 200 lines=24 rows=3 | PASS |
| J05-10a | owner | API POST /reports/exports | 202/201 queued export | 202 id=77683c35-f978-4fa5-b7b3-eaab69447364 status=queued | PASS |
| J05-10b | leader | API POST /reports/exports (team-scoped scheduler) | allowed only within managed scope or denied | 202 | PASS |
| J05-10c | db | report_exports after worker run 1 | status ready | {"id":"77683c35-f978-4fa5-b7b3-eaab69447364","status":"ready","kind":"participation"} | PASS |
| J05-10d | owner | API export download + content | CSV equals live report (participation rows, 3 people) | 200 bytes=1368 | PASS |
| J05-10e | mem1 | API export download (not requester) | denied | 404 | PASS |
| J05-10f | betaowner | API export download under Beta | 404 | 404 | PASS |
| J05-10g | db | my Storage objects after worker file maintenance | my 3 file versions + chart intact (worker removed other namespaces only) | objects=3 | PASS |
| J05-N1 | planner | Web Live controller UI (start, advance, pause, run sheet) | one Live UI, lease banner | browser owned by W9-WEB (not used here); API half PASS (J05-01..06) | NOT_RUN |
| J05-N2 | owner/mem1 | Native Live viewer/controller UI, takeover prompt, airplane-mode interruption and reconnect on device | banner "control lost", resync, no duplicate transition | simulator owned by W9-NATIVE (not used here)/QA-14 physical devices unavailable; API-level lease loss, stale revision, replay and expired lease PASS (J05-04..05) | NOT_RUN |
| J05-N3 | owner | Web attendance sheet UI, report page and CSV download in browser | UI shows same totals | browser owned by W9-WEB (not used here); API/CSV/export PASS (J05-08..10) | NOT_RUN |

## JOURNEY-06

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J06-00 | setup | fixtures | multi has 1 released + 1 prepared assignment in each org; Beta has an unrelated plan | Alpha Dec27 released, Alpha Jan3 prepared; Beta Dec27 released, Beta Jan3 prepared; BETA-OTHER-ONLY plan without multi | PASS |
| J06-01a | multi | API GET /organizations | member of both orgs | 200 orgs=qa-w9-jrn-b,qa-w9-jrn-a | PASS |
| J06-01b | multi | API GET /me/schedule-settings (default) | combined_schedule=false and share_busy=false by default (separate opt-ins) | {"user_id":"6a7892c2-80df-4d33-b80c-690664a453bc","combined_schedule":false,"share_busy_across_orgs":false,"updated_at":"1970-01-01T00:00:00.000Z"} | PASS |
| J06-01c | multi | API GET /me/combined-schedule while opted out | no other-org data (only active org or empty) | 403 len=66 | PASS |
| J06-02a | multi | API PUT /me/schedule-settings combined_schedule only | 200 | {"user_id":"6a7892c2-80df-4d33-b80c-690664a453bc","combined_schedule":true,"share_busy_across_orgs":false,"updated_at":"2026-11-21T14:53:59.76+00:00"} | PASS |
| J06-02b | multi | API GET /me/combined-schedule opted in | both orgs released assignments (Alpha Dec27, Beta Dec27); prepared absent; no BETA-OTHER-ONLY | 200 hasAlpha=true hasBeta=true prepared=false | PASS |
| J06-02c | multi | API GET /schedule/mine per org | Alpha list has only Alpha; Beta list only Beta | alpha=1 beta=1 | PASS |
| J06-02d | multi | API GET /schedule/mine with no X-Organization-Id (ambiguous) | 400 (must choose org) | 400 bad_request | PASS |
| J06-02e | multi | API Beta plan id under Alpha header | 404 | 404 | PASS |
| J06-03a | leader | API POST /availability/warnings with share_busy OFF | no busy_elsewhere | 200 codes=availability_unknown | PASS |
| J06-03b | leader | API availability/warnings with share_busy ON | busy_elsewhere warning only: no Beta org name/plan/team/id | codes=availability_unknown,busy_elsewhere leak=false | PASS |
| J06-03c | mem1 | API availability/warnings as ordinary member | denied | 403 | PASS |
| J06-03d | leader | API availability/warnings after busy OFF again | warning disappears at once | codes=availability_unknown | PASS |
| J06-04-0 | multi | API GET /me/calendar-feed before creation | active=false, no URL | {"url":null,"webcal_url":null,"active":false} | PASS |
| J06-04a | anonymous (feed token) | GET personal ICS feed | 200 text/calendar; only released Alpha Dec27 assignment; no prepared (Jan 3), no Beta titles | events=1 alphaDec27=true prepared=false beta=false | PASS |
| J06-04b | multi | API POST /me/calendar-feed rotate | old feed URL 404 immediately, new works | old=404 new=200 | PASS |
| J06-05a | multi | API POST /me/devices (register fake Expo token) | 201/200, revocation_secret returned once | 201 keys=token,platform,device_name,lease_expires_at,show_badge,revocation_secret | PASS |
| J06-05b | leader | API release Alpha Jan 3 assignment to multi (device registered, language vi in Alpha) | 200 | 200 | PASS |
| J06-05c | db | deliveries for multi release | push + in_app + email rows with locale vi (Alpha Person language); push targets registered device | [{"channel":"in_app","status":"delivered","locale":"vi","last_error_code":null},{"channel":"push","status":"simulated","locale":"vi","last_error_code":null},{"channel":"email","status":"simulated","locale":"vi","last_error_code":null}] | PASS |
| J06-05d | betaowner | API release Beta assignment to multi | Beta delivery locale is the Beta Person language (en), not Alpha vi; push to same device | [{"channel":"in_app","status":"delivered","locale":"en"},{"channel":"push","status":"simulated","locale":"en"},{"channel":"email","status":"simulated","locale":"en"}] | PASS |
| J06-06a | db | device token owner before handover | multi | multi | PASS |
| J06-06b | mem1 | API POST /me/devices with token owned by multi (shared device sign-in) | 201, token ownership moves to mem1 | 201 owner=mem1 | PASS |
| J06-06c | multi | API DELETE /me/devices/:token (old owner) | cannot remove new owner registration (404/204 no effect) | 404; token still owned by mem1 | PASS |
| J06-06d | anonymous | API POST /device-revocations with OLD owner revocation secret | 204 but registration NOT removed | 204 still owned=true | PASS |
| J06-06e | db | push delivery for multi after device moved to mem1 | push skipped (no active device for multi); nothing addressed to mem1 device | [{"channel":"in_app","status":"delivered","last_error_code":null},{"channel":"push","status":"skipped","last_error_code":"no_active_device"},{"channel":"email","status":"simulated","last_error_code":null}] | PASS |
| J06-07a | mem1 | API GET /notifications (new identity on shared device) | no multi notifications | items=2 | PASS |
| J06-07b | mem1 | API open old notification id (stale push deep link) as new identity | 404, not marked read | 404 | PASS |
| J06-08a | multi | API schedule before sign-out | 200 | 200 | PASS |
| J06-08b | multi | GoTrue POST /logout?scope=global | 204 | 204 | PASS |
| J06-08c | multi (old access token) | API GET /schedule/mine after global sign-out | 401 | 401 | PASS |
| J06-08d | multi (old access token) | API GET /notifications (stale push deep link) after sign-out | 401 | 401 | PASS |
| J06-08e | multi (old refresh token) | GoTrue refresh after global sign-out | rejected 4xx | 400 | PASS |
| J06-08f | multi (old access token) | PostgREST GET /assignments after global sign-out (widget/cache direct access) | 401/empty (W7-JRN-D3 retest) | 401 rows=- | PASS |
| J06-08g | multi (old access token) | Storage GET after global sign-out | denied | 400 | PASS |
| J06-08h | multi (old access token) | API register device after sign-out | 401, no registration | 401 | PASS |
| J06-08i | multi | API new session after sign-in | 200, own data only | 200 | PASS |
| J06-09a | owner | API PATCH /people/members/:id inactive (multi in Alpha) | 200 | 200 | PASS |
| J06-09b.schedule | multi | API schedule in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.notifications | multi | API notifications in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.plan deep link | multi | API plan deep link in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.rehearsal manifest | multi | API rehearsal manifest in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.offline pack | multi | API offline pack in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.file download | multi | API file download in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.respond | multi | API respond in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.realtime key | multi | API realtime key in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09b.plan responses preview | multi | API plan responses preview in deactivated Alpha | 403/404 | 403 | PASS |
| J06-09c | multi | PostgREST direct reads as deactivated Alpha member | No Alpha rows other than the member's OWN linked-Person rows (documented design: private.my_assignment_person_ids "admit the caller's own linked Person, even without active organization membership", 20261122000200_perf_assignment_access.sql:8) | 3 own Alpha assignments + 3 own request snapshots + own organization_members row readable; no other member's rows, plans/notes/files/people none (see observation W9-JRN-O1) | PASS |
| J06-09d | multi | API combined schedule with Alpha inactive | Alpha items gone (no Alpha titles); Beta intact | 200 alpha=false beta=true | PASS |
| J06-09e | multi | API Beta schedule after Alpha deactivation | still works | 200 | PASS |
| J06-09f | leader | API schedule an inactive member (push/email must not reach a deactivated member) | refused or no external delivery | POST assignments for deactivated member refused 400 "do not belong to this plan"; 0 deliveries created | PASS |
| J06-09g | owner | API reactivate multi | 200; old push/deep link OK again with live check | 200 | PASS |
| J06-N1 | multi | iOS widget (WIDGET-01/02): small/medium/lock-screen snapshot, 12 h expiry, cleared on sign-out/org switch, tap old snapshot | snapshot cleared/refused | QA-14 physical devices unavailable; the backend has no widget endpoint: the widget reads schedule data the app fetches (/schedule/mine, /me/combined-schedule); both refuse a signed-out token (J06-08c, J06-08f) and a deactivated org (J06-09) | NOT_RUN |
| J06-N2 | multi | Real push received on device after org switch/sign-out; tap opens deep link | no previous identity/org data shown | QA-14 physical devices unavailable; server side: push row skipped no_active_device after handover, stale notification id 404 for new identity (J06-06e, J06-07) | NOT_RUN |
| J06-N3 | multi | Native org switcher / combined-schedule UI / cache wipe on sign-out; universal link to an org the user left | cached data cleared; link falls back to login/org picker | simulator owned by W9-NATIVE (not used here)/QA-14 physical devices unavailable; API half PASS (J06-02, J06-08, J06-09) | NOT_RUN |

## JOURNEY-07

| Step / Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| J07-01a | planner | API PATCH plan notes+location | 200 | 200 | PASS |
| J07-01b | planner | API PATCH item description | 200 | 200  | PASS |
| J07-01c | librarian | API PATCH song notes | 200 | 200 | PASS |
| J07-01d | planner | API POST plan note audience=leaders | 201 | 201  | PASS |
| J07-01e | planner | API POST plan note audience=teams (Band) | 201 | 201 | PASS |
| J07-01f | planner | API POST item note audience=leaders | 201 | 201 | PASS |
| J07-01g | planner | API POST /files/documents audience=leaders | 201 | 201  | PASS |
| J07-01h | leader | API create prepared assignment candB | 201 prepared | 201 dc3cfc97-04e2-4a07-b3ff-954ba2d083bc | PASS |
| J07-02.viewer | viewer | API plan/notes/files/schedule/calendar/attendance/manifest/notifications | no leaders/team/item-leaders notes, no leaders doc, no prepared | none of 8 surfaces leak | PASS |
| J07-02.mem1 | mem1 | API plan/notes/files/schedule/calendar/attendance/manifest/notifications | no leaders notes/doc; own prepared assignment hidden even from its holder | none of 8 surfaces leak | PASS |
| J07-02.candB | candB | API plan/notes/files/schedule/calendar/attendance/manifest/notifications | no leaders notes/doc; own prepared assignment hidden even from its holder | none of 8 surfaces leak | PASS |
| J07-02.mem1.team | mem1 | API notes: Band member | sees Band-only note, not leaders note | team=true leaders=false | PASS |
| J07-02.viewer.team | viewer | API notes: non-Band member | sees neither Band nor leaders note | team=false | PASS |
| J07-03.pg.viewer | viewer | PostgREST plan_notes/assignments(prepared)/attachments (caller token) | no leaders notes/doc, no prepared rows | notes status=200 prepared rows=0 | PASS |
| J07-03.pg.mem1 | mem1 | PostgREST plan_notes/assignments(prepared)/attachments (caller token) | no leaders notes/doc, no prepared rows | notes status=200 prepared rows=0 | PASS |
| J07-03.planner.control | planner | API notes (positive control) | sees leaders + team notes | ok | PASS |
| J07-04a | mem1 | API PUT publication (ordinary member) | denied | 403 | PASS |
| J07-04b | planner | API PUT /plans/:id/publication (allowlisted fields) | 200 public link issued | 200 keys=publication,state,visible_from,public_path,preview,ineligible_reason | PASS |
| J07-05a | anonymous | API GET /public/plans/:slug | allowlisted projection only; 0 private strings/IDs/PII | 200 keys=organization,timezone,title,date,times,items,songs leaks= | PASS |
| J07-05b | anonymous | API public plan, wrong slug | 404 | 404 | PASS |
| J07-05c | anonymous | API public plan by plan UUID instead of slug | 404 | 404 | PASS |
| J07-06a | planner | API POST service-types/:id/public-links create upcoming | 200/201 link | 200 slug=<slug> | PASS |
| J07-06b | anonymous | API GET /public/set-lists/:slug | songs only/allowlisted projection; draft plans, prepared, Beta data absent | 200 keys=organization,timezone,title,date,times,items,songs leaks= | PASS |
| J07-07a | anonymous (feed token) | GET scoped ICS feed (service type); location is an intended feed field | VEVENT per plan time; no notes/people/emails/prepared/doc/attachment names | events=5 private-leaks=; location present (intended) | PASS |
| J07-07b | mem1 | API POST /calendar/feeds as ordinary member (self-subscription to a service type they can read) | 201 allowed by design (RLS insert = scope readable); feed exposes only plan times/titles/location, no notes/people/prepared | 201 events=5 leaks= | PASS |
| J07-08a | owner | API POST /integrations/credentials (plans.read) | 201 secret shown once | 201 keys=credential,secret,replayed | PASS |
| J07-08b | planner | API POST credentials (non-admin) | denied | 403 | PASS |
| J07-08c | api-key | GET /api/external/v1/plans/:id | allowlisted projection; no private fields/people/notes | 200 keys=id,service_type_id,title,service_date,location,updated_at,times,items leaks= | PASS |
| J07-08d | api-key | GET external /plans window | published only; Beta absent; no private | 200 n=2 leaks= | PASS |
| J07-08e | api-key (plans.read) | GET external /songs without songs.read scope | 403 | 403 | PASS |
| J07-08f | api-key | GET external plan from Beta by id | 404 | 404 | PASS |
| J07-08g | owner (session JWT) | external API with a session token instead of key | 401 | 401 | PASS |
| J07-09a | anonymous | PostgREST GET /plans (anon key, no JWT) | denied/empty | 200 rows=0 | PASS |
| J07-09b | anonymous | PostgREST GET /plan_publications (anon) | denied/empty (slug not enumerable) | 401 rows=- | PASS |
| J07-09c | anonymous | Storage public/anon GET every Alpha attachment object | all denied | 3/3 denied | PASS |
| J07-10a | mem1 | API DELETE publication (ordinary member) | denied, link still live | 403 | PASS |
| J07-10b | planner | API revoke publication with stale revision | 409, publication still live | 409 state=live | PASS |
| J07-10c | planner | API revoke publication | 200 | 200 | PASS |
| J07-10d | anonymous | API public plan after revoke | 404/410 immediately | 404 | PASS |
| J07-10e | planner | API republish with new_link | new slug works; old slug stays dead | new=200 old=404 | PASS |
| J07-10f | anonymous | API minimal republish projection | only title+date (+org/timezone), no times/items | keys=organization,timezone,title,date | PASS |
| J07-10g | anonymous | API final revoke | 404 | revoked | PASS |
| J07-11a | planner | API public-links revoke upcoming | 200 | 200 | PASS |
| J07-11b | anonymous | API public set list after revoke | 404/410 | 404 | PASS |
| J07-12a | mem1 | API DELETE scoped feed (not creator) | denied; feed stays live | 404 | PASS |
| J07-12b | planner | API revoke scoped feed | 204 | 204 | PASS |
| J07-12c | anonymous | GET ICS feed after revoke | 404/410 | 404 | PASS |
| J07-13a | api-key | external API before revoke | 200 | 200 | PASS |
| J07-13b | planner | API revoke credential (non-admin) | denied | 403 | PASS |
| J07-13c | owner | API revoke credential | 200 revoked | 200 | PASS |
| J07-13d | api-key | external API after revoke (plans, plan, organization) | 401 on all | 401 | PASS |
| J07-14a | mem1 | API GET /reports/exports (ordinary member) | denied or no rows of others | 200 rows=0 | PASS |
| J07-14b | owner | API staffing report with a prepared (unreleased) assignment present | prepared candB absent from report/follow-ups | prepared candB in report=false | PASS |
| J07-14c | owner | participation CSV with prepared assignment present | prepared candB absent from CSV | present=false | PASS |
| J07-14d | owner | API calendar (all) with prepared present | no prepared assignee names | present=false | PASS |
| J07-15a | betaowner | PostgREST sweep of 24 tables (caller token, Beta-only owner) for Alpha rows | 0 Alpha rows | 0 Alpha rows on 24 tables | PASS |
| J07-15b | betaowner | API Alpha plan/notes/attendance/files under Alpha and Beta headers | 403/404, never Alpha content | 403/404 on 10 probes | PASS |
| J07-07c | viewer | API GET /calendar/feeds | lists only own feeds (not mem1/planner) | n=0 | PASS |
| J07-07d | mem1 | API DELETE own feeds (cleanup) then ICS | old URL dead | ics=404 live feeds left=0 | PASS |
| J07-N1 | anonymous | Public plan and set list pages rendered in a browser (/p/:slug), print/PDF view | page shows only allowlisted fields | browser owned by W9-WEB (not used here); API projection 0 private strings (J07-05, J07-06) | NOT_RUN |
| J07-N2 | anonymous | ICS feed imported in a real calendar app (Apple/Google); API credential used from an external tool | events update/vanish on revoke | QA-14 physical devices unavailable/no external client; raw HTTP fetch PASS (J07-07, J07-08, J07-12) | NOT_RUN |

**Required final evidence.** Same IDs end to end: plan `cb15ac73…`, assignment IDs asserted equal across prepare (J01-04a), release preview/release (J01-05), the member review (J01-06), the planner plan view (J01-07a). No premature visibility: prepared rows invisible to mem1/mem2/viewer on 9 read surfaces and raw PostgREST, 0 effects/notifications/tokens while prepared (J01-04b/c). Exact reviewed scope: Acoustic 3 times, Bass 11:00 only (J01-06b); out-of-scope answer refused with no rows (J01-06d); 4 persisted time responses, actor = mem1 (J01-06f); mixed Acoustic answers aggregate to `unconfirmed` by design. One logical notification: one `assignment_request` effect for the release (4 assignments), replay with the same key adds no effect (J01-05e), one delivery per Person per channel; Nora (no email) gets an honest `skipped` email. History chain: 4 `assignment_time_response_history` rows, replay-safe. Responder side: one `scheduler_response` effect per resulting status (declined, confirmed). **FAIL:** the private decline reason is visible to unrelated members (D1).

**Required final evidence.** Same Person `48c13e83…` before and after account creation (no duplicate Person, J02-05a); answer persisted for exactly the one scoped time, actor null (token) and unchanged after linking (J02-05f); preferred language `vi` survives (J02-05d); invitation creation/accept changed no assignment/notification (J02-04c); schedule shows the same assignment ID already confirmed (J02-05c); token single-use 410 and old link stays dead after account link (J02-03f, J02-05g). Localized link preview carries `preferred_language=vi`, one assignment/one time, no email/other people (J02-03a/b); delivery locale `vi`.

**Required final evidence.** Redacted conflict (reason never disclosed via API or leader PostgREST; owner can read per documented contract), 409 without reason, 403 with reason but no override capability (leader and planner), 201 with capability + reason, audit row with assignment, Person, actor, reason and redacted conflict (J03-03f). Decline keeps its private reason and history (J03-04b, J03-06b); replacement consent then approval created exactly one confirmed Keys assignment for candA at the original 9:00 time; exactly one active Keys holder; second offer refused 409; candidate cannot self-approve (J03-05d, J03-06a/c/d/g).

**Required final evidence.** Arrangement edit with revision check (stale 409, planner denied); plan-only key C and sequence C,V1,C stored on the plan item only (library G / V1,C,C unchanged, J04-03b); manifest chart rendered in C with the plan sequence and tempo 84 (J04-05a). Authorized upload (media.manage) of chart + audio v1/v2; scheduled-audience audio reaches scheduled members only (J04-05b/d); signed download equals uploaded bytes (size + sha256); offline-pack entry carries version 2, exact size and checksum, `plan_revision`, `recheck_by` +24 h (J04-06c); `stream_only` removes audio from pack and attachment download (J04-07); audience narrowing revokes manifest, download, pack and Storage immediately, restoration re-enables (J04-08/09); no cross-account/tenant pack (J04-10). Previously issued signed URLs stay valid until their short expiry (J04-08e, bearer-capability design).

**Required final evidence.** One run per occurrence (9:00 and 11:00 have separate ids/history, J05-06); one controller at a time: viewer denied, non-holder `run_control_lost`, takeover with reason, old controller refused, expired lease refused until `take_control`, lost-reply replay applied once, stale revision refused, viewer converges on the same revision (J05-02..05); audited time correction (actor, reason, order enforced, J05-07). Attendance: viewer denied, stale revision 409, correction absent->present with audit (2 events), replay no extra event, one mark per Person per occurrence (J05-08). Metrics: participation summary `present 4 / absent 0 / unknown 1`, equal to row totals and recorded marks (J05-09a/b; W7-JRN-D1 fixed); run-times 2 runs; CSV and tracked export match; export download limited to requester/tenant (J05-10).

**Required final evidence.** Combined schedule and busy sharing are separate opt-ins (default off; 403 until opted in); per-org lists never mix; ambiguous org 400; foreign plan 404; busy-elsewhere is a redacted warning only while opted in (J06-03); personal feed rotates (old URL 404); delivery locale follows the Person per org (vi in Alpha, en in Beta, J06-05); shared-device handover moves token ownership, old owner cannot delete it or revoke with the stale secret, no push to the stale owner, stale notification id 404 for the new identity (J06-06/07); global sign-out: API 401, refresh refused, PostgREST/Storage/device registration refused (W7-JRN-D3 fixed, J06-08); membership deactivation: schedule, notifications, deep link, manifest, pack, download, respond, realtime key all 403, Beta intact, combined schedule drops Alpha, reactivation restores (J06-09). Observation O1 below.

**Required final evidence.** Leaders-only note, Band-only note, item note, leaders-only document and a prepared assignment are absent for unscheduled/ordinary members on API surfaces and PostgREST (J07-02/03), Band note visible to Band members only; prepared rows absent even for the holder and from staffing report, CSV and calendar (J07-14). Public plan, set list, scoped feed and external API (plans.read key) expose only the allowlisted projection (0 hits for 30+ private strings/ids; draft plans and Beta data absent; anon PostgREST and Storage denied, J07-05..09, J07-15). Revocation: publication (stale 409), set-list link, scoped feed, API credential all fail immediately; old slug stays dead after republish (J07-10..13). Cross-tenant sweep of 24 tables as Beta-only owner: 0 Alpha rows (J07-15).

## Coverage reconciliation (plan §5-§8 scenario IDs)

Source: every table row in `docs/qa/runs/*/*.md` and `*.tsv` (all waves 1-9, `SUMMARY.md` and my own `journeys.md` excluded) whose first cell names a plan case ID (family IDs such as `RESP-01.grouped.persist.Bass` roll up to `RESP-01`; count-table rows are read from their header). Latest wave wins: the status is that wave's rows (FAIL if any row failed, else PASS, else BLOCKED, else NOT_RUN, else N/A) with counts in brackets (P pass, F fail, B blocked, NR not run, NA n/a). "Covered by" lists every wave and report. **"Defect disposition" is a heuristic** derived from SUMMARY/retest text for the defect ids cited by the latest-wave FAIL rows (retest PASS / fixed = in a "Fixed" or fix-round section but not re-verified per case / carried = "Still FAIL" / listed); it is not re-test evidence for the case. Wave 9 files other than this one (`retest-api.md`, `retest-data.md`, `web-ux.md`) were still being written when this was generated, so wave 9 columns may be incomplete. 137 IDs come from §5 groups A-H, §6 (MOB-001..033 and the native-only IDs), §7; §8 reuses §5 IDs.

Never-covered IDs are marked **NEVER COVERED** (no result row in any report); `NO RESULT ROW` would mean mentioned only in prose.

| Case ID | Plan group | Latest wave | Latest status | Covered by (wave: report (counts)) | Defect disposition / note |
|---|---|---|---|---|---|
| AUTH-01 | §5A | w1 | PASS (P5/NR1) | w1: web.md (P5/NR1) |  |
| AUTH-02 | §5A | w7 | PASS (P2) | w1: api.md,web.md (P30/F2); w7: access-security.md (P2) |  |
| AUTH-03 | §5A | w1 | PASS (P348/NR1) | w1: api.md,web.md (P348/NR1) |  |
| AUTH-04 | §5A | w7 | PASS (P33/NR1) | w1: web.md (NR1); w7: access-security.md (P33/NR1) |  |
| PROFILE-01 | §5A | w1 | PASS (P1/NR1) | w1: web.md (P1/NR1) |  |
| ACL-01 | §5A | w7 | FAIL (P25/F5) | w1: api.md (P466); w7: access-security.md (P25/F5) | no defect id cited in the failing rows |
| ACL-02 | §5A | w7 | PASS (P8/NR1) | w1: api.md (P18); w7: access-security.md (P8/NR1) |  |
| ACL-03 | §5A | w7 | PASS (P9) | w1: api.md,web.md (P319); w7: access-security.md (P9) |  |
| ACL-04 | §5A | w7 | PASS (P7) | w1: api.md (P74/F6); w7: access-security.md (P7) |  |
| ACL-05 | §5A | w7 | FAIL (P190/F6/NR1) | w1: api.md (P92/NA10); w7: access-security.md,responses.md (P190/F6/NR1) | no defect id cited in the failing rows |
| ACL-06 | §5A | w7 | PASS (P107) | w1: api.md (P422/F12); w7: access-security.md (P107) |  |
| PEOPLE-01 | §5B | w1 | FAIL (P44/F2) | w1: api.md (P44/F2) | no defect id cited in the failing rows |
| PEOPLE-02 | §5B | — | NEVER COVERED |  | API half only: JOURNEY-02 (w9 journeys.md, w7 journeys.md) - guest scheduled, token answer, invite accept, same Person; no UI/native |
| PEOPLE-03 | §5B | w1 | PASS (P2) | w1: web.md (P2) |  |
| PEOPLE-04 | §5B | — | NEVER COVERED |  |  |
| PEOPLE-05 | §5B | w7 | PASS (P2) | w7: access-security.md (P2) |  |
| TEAM-01 | §5B | w7 | FAIL (P13/F3/NR1) | w1: api.md (P22/F2); w7: access-security.md (P13/F3/NR1) | defects W7-ACC-D3 [retest PASS] |
| TEAM-02 | §5B | w7 | PASS (P5/NR1) | w7: access-security.md (P5/NR1) |  |
| TYPE-01 | §5B | w1 | PASS (P1/NR1) | w1: web.md (P1/NR1) |  |
| PLAN-01 | §5C | w2 | FAIL (P150/F13/NA3) | w2: plans.md (P150/F13/NA3) | defects API-D5 [retest PASS], W2-PLANS-D1 [fixed], W2-PLANS-D10 [fixed], W2-PLANS-D2 [fixed], W2-PLANS-D4 [fixed] |
| PLAN-02 | §5C | w2 | FAIL (P438/F10/NR3) | w2: plans.md (P438/F10/NR3) | defects API-D5 [retest PASS], W2-PLANS-D1 [fixed], W2-PLANS-D4 [fixed] |
| TIME-01 | §5C | w2 | PASS (P210) | w2: plans.md (P210) |  |
| TIME-02 | §5C | w2 | FAIL (P106/F2) | w2: plans.md (P106/F2) | defects W2-PLANS-D12 [listed] |
| TIME-03 | §5C | w2 | FAIL (P42/F4) | w2: plans.md (P42/F4) | defects W2-PLANS-D3 [listed] |
| TEMPLATE-01 | §5C | w2 | FAIL (P390/F6) | w2: plans.md (P390/F6) | defects API-D5 [retest PASS], W2-PLANS-D4 [fixed], W2-PLANS-D7 [listed] |
| TEMPLATE-02 | §5C | w2 | FAIL (P150/F2) | w2: plans.md (P150/F2) | defects W2-PLANS-D8 [listed] |
| TEMPLATE-03 | §5C | w2 | FAIL (P180/F4/NA7) | w2: plans.md (P180/F4/NA7) | defects W2-PLANS-D10 [fixed], W2-PLANS-D12 [listed] |
| ORDER-01 | §5C | w7 | PASS (P36/NR1) | w2: plans.md (P512/F6/NR3); w7: access-security.md (P36/NR1) |  |
| ORDER-02 | §5C | w2 | PASS (P150) | w2: plans.md (P150) |  |
| ORDER-03 | §5C | w2 | FAIL (P32/F4) | w2: plans.md (P32/F4) | defects W2-PLANS-D9 [listed] |
| ORDER-04 | §5C | w2 | FAIL (P36/F2/NR3) | w2: plans.md (P36/F2/NR3) | defects W2-PLANS-D6 [listed] |
| STAFF-01 | §5D | w2 | FAIL (P118/F4/NR1) | w2: staffing.md (P118/F4/NR1) | defects W2-STAFF-D2 [fixed], W2-STAFF-D5 [listed] |
| STAFF-02 | §5D | w2 | FAIL (P154/F2) | w2: staffing.md (P154/F2) | defects W2-STAFF-D4 [fixed] |
| MATRIX-01 | §5D | w2 | FAIL (P330/F22) | w2: staffing.md (P330/F22) | defects W2-STAFF-D1 [fixed], W2-STAFF-D2 [fixed], W2-STAFF-D4 [fixed] |
| PROPOSE-01 | §5D | w2 | FAIL (P270/F10/NR1) | w2: staffing.md (P270/F10/NR1) | defects W2-STAFF-D3 [listed], W2-STAFF-D4 [fixed], W2-STAFF-D6 [listed] |
| PROPOSE-02 | §5D | w2 | FAIL (P126/F4) | w2: staffing.md (P126/F4) | defects W2-STAFF-D2 [fixed], W2-STAFF-D3 [listed] |
| RESP-01 | §5D | w7 | FAIL (P23/F2) | w2: responses.md (P71/F1); w7: responses.md (P23/F2) | defects W7-RESP-D5 [retest PASS] |
| RESP-02 | §5D | w7 | FAIL (P22/F2) | w2: responses.md (P74); w7: responses.md (P22/F2) | defects W7-RESP-D6 [fixed] |
| RESP-03 | §5D | w7 | FAIL (P19/F1) | w1: web.md (P1); w2: responses.md (P44/F2); w7: responses.md (P19/F1) | no defect id cited in the failing rows |
| RESP-04 | §5D | w7 | FAIL (P12/F2) | w2: responses.md (P16/F2); w7: responses.md (P12/F2) | no defect id cited in the failing rows |
| AVAIL-01 | §5D | w2 | FAIL (P146/F12) | w2: availability.md (P146/F12) | defects API-D5 [retest PASS], W2-AVAIL-D1 [fixed], W2-AVAIL-D2 [fixed] |
| AVAIL-02 | §5D | w2 | FAIL (P78/F8) | w2: availability.md (P78/F8) | defects API-D5 [retest PASS], W2-AVAIL-D1 [fixed] |
| AVAIL-03 | §5D | w2 | FAIL (P220/F6) | w2: availability.md (P220/F6) | defects API-D5 [retest PASS], W2-AVAIL-D3 [retest PASS] |
| DELEGATE-01 | §5D | w7 | PASS (P31/NA1) | w2: availability.md (P124/F4/NA2); w7: responses.md (P31/NA1) |  |
| OPPORT-01 | §5D | w2 | FAIL (P113/F4) | w2: responses.md (P113/F4) | no defect id cited in the failing rows |
| OPPORT-02 | §5D | w2 | PASS (P26) | w2: responses.md (P26) |  |
| REPLACE-01 | §5D | w2 | FAIL (P129/F2) | w2: responses.md (P129/F2) | no defect id cited in the failing rows |
| REPLACE-02 | §5D | w2 | FAIL (P14/F1) | w2: responses.md (P14/F1) | no defect id cited in the failing rows |
| SWAP-01 | §5D | w2 | FAIL (P59/F1) | w2: responses.md (P59/F1) | no defect id cited in the failing rows |
| RELEASE-01 | §5E | w8 | NOT_RUN (NR1) | w3: release.md (P71/NR1); w8: integrations.md (NR1) | last PASS w3; latest wave only NOT_RUN/BLOCKED |
| RELEASE-02 | §5E | w8 | NOT_RUN (NR1) | w3: release.md (P8/F1/NR1); w8: integrations.md (NR1) | last PASS w3; latest wave only NOT_RUN/BLOCKED |
| REMIND-01 | §5E | w3 | PASS (P93/NR1) | w3: release.md (P93/NR1) |  |
| DELIVERY-01 | §5E | w8 | PASS (P120) | w3: release.md (P41/F2/NR1); w8: integrations.md (P120) |  |
| DELIVERY-02 | §5E | w8 | PASS (P50) | w3: release.md (P8); w8: integrations.md (P50) |  |
| NOTIFY-01 | §5E | w7 | FAIL (P62/F4/NR3/NA1) | w3: messaging.md (P60/F3/NR2); w7: messaging.md (P62/F4/NR3/NA1) | defects W3-MSG-D10 [carried], W3-MSG-D2 [carried], W3-MSG-D3 [carried], W7-MSG-D1 [retest PASS], W7-MSG-D3 [retest PASS], W7-MSG-D4 [retest PASS], W7-MSG-D5 [retest PASS] |
| PUSH-01 | §5E | w8 | NOT_APPLICABLE (NA1) | w3: release.md (NA1); w7: native.md (NA1); w8: native.md (NA1) |  |
| NOTE-01 | §5F | w7 | FAIL (P2/F3) | w3: messaging.md (P277/F3/NR4/NA1); w7: messaging.md (P2/F3) | defects W3-MSG-D1 [carried], W3-MSG-D2 [carried], W7-MSG-D10 [retest PASS], W7-MSG-D3 [retest PASS] |
| MESSAGE-01 | §5F | w8 | PASS (P156/NA2) | w3: messaging.md (P219/F4/B1/NR3); w7: messaging.md (P44/F5/B1/NR2); w8: integrations.md (P156/NA2) |  |
| MESSAGE-02 | §5F | w7 | NOT_RUN (NR2) | w3: messaging.md (NR3/NA1); w7: messaging.md (NR2) |  |
| CHAT-01 | §5F | w7 | FAIL (P138/F3/B1/NR5/NA1) | w3: messaging.md (P180/F1/NR2/NA1); w7: messaging.md (P138/F3/B1/NR5/NA1) | defects W3-MSG-D2 [carried], W7-MSG-D3 [retest PASS], W7-MSG-D4 [retest PASS] |
| CHAT-02 | §5F | w7 | FAIL (P34/F9/NR3) | w3: messaging.md (P54/F7/NR3/NA2); w7: messaging.md (P34/F9/NR3) | defects W3-MSG-D4 [carried], W3-MSG-D9 [carried], W7-MSG-D2 [retest PASS], W7-MSG-D4 [retest PASS] |
| SONG-01 | §5G | w3 | FAIL (P171/F7/NR1) | w3: songs.md (P171/F7/NR1) | defects W3-SONG-D1 [listed], W3-SONG-D2 [listed], W3-SONG-D6 [listed], W3-SONG-D7 [listed], W3-SONG-D8 [listed] |
| SONG-02 | §5G | w3 | FAIL (P86/F2/NR1) | w3: songs.md (P86/F2/NR1) | defects W3-SONG-D1 [listed], W3-SONG-D8 [listed] |
| SONG-03 | §5G | w3 | PASS (P60/NR1) | w3: songs.md (P60/NR1) |  |
| CHART-01 | §5G | w3 | FAIL (P33/F8/NR1) | w3: songs.md (P33/F8/NR1) | defects W3-SONG-D10 [listed], W3-SONG-D11 [listed], W3-SONG-D12 [listed], W3-SONG-D13 [listed], W3-SONG-D7 [listed], W3-SONG-D9 [listed] |
| CHART-02 | §5G | w3 | PASS (P5/NR2) | w3: songs.md (P5/NR2) |  |
| IMPORT-01 | §5G | w3 | PASS (P100) | w3: songs.md (P100) |  |
| IMPORT-02 | §5G | w3 | PASS (P6/NA1) | w3: songs.md (P6/NA1) |  |
| FILE-01 | §5G | w3 | FAIL (P669/F3/NR9) | w3: files-cases.tsv,files.md (P669/F3/NR9) | defects W3-FILE-D1 [listed] |
| FILE-02 | §5G | w3 | PASS (P1949/NR6) | w3: files-cases.tsv,files.md (P1949/NR6) |  |
| FILE-03 | §5G | w3 | FAIL (P450/F6/NR6) | w3: files-cases.tsv,files.md (P450/F6/NR6) | defects W3-FILE-D2 [listed], W3-FILE-D3 [listed] |
| MEDIA-01 | §5G | w3 | FAIL (P462/F3/NR6) | w3: files-cases.tsv,files.md (P462/F3/NR6) | defects W3-FILE-D3 [listed] |
| REHEARSE-01 | §5G | w3 | PASS (P397/NR6) | w3: files-cases.tsv,files.md (P397/NR6) |  |
| REHEARSE-02 | §5G | — | NEVER COVERED |  | API half only: JOURNEY-04 manifest/pack/download/rights (w7, w9) |
| OFFLINE-01 | §5G | — | NEVER COVERED |  | needs QA-14 device; server pack contract in JOURNEY-04 |
| OFFLINE-02 | §5G | — | NEVER COVERED |  | needs QA-14 device |
| STAGE-01 | §5G | w3 | FAIL (P350/F3/NR3/NA3) | w3: files-cases.tsv,files.md (P350/F3/NR3/NA3) | defects W3-FILE-D3 [listed] |
| SCAN-01 | §5G | — | NEVER COVERED |  |  |
| LIVE-01 | §5H | w3 | FAIL (P82/F1/NR2) | w3: live-reports.md (P82/F1/NR2) | no defect id cited in the failing rows |
| LIVE-02 | §5H | w3 | FAIL (P36/F3/NR4) | w3: live-reports.md (P36/F3/NR4) | no defect id cited in the failing rows |
| LIVE-03 | §5H | w3 | PASS (P41/NR2/NA1) | w3: live-reports.md (P41/NR2/NA1) |  |
| ATTEND-01 | §5H | w3 | PASS (P98/NR3) | w3: live-reports.md (P98/NR3) |  |
| REPORT-01 | §5H | w3 | FAIL (P136/F1/NR2) | w3: live-reports.md (P136/F1/NR2) | no defect id cited in the failing rows |
| REPORT-02 | §5H | w3 | FAIL (P420/F18/NR3) | w3: integrations.md (P420/F18/NR3) | defects W3-INT-D2 [listed], W3-INT-D3 [listed] |
| CAL-01 | §5H | w3 | PASS (P232/NR3) | w3: integrations.md (P232/NR3) |  |
| CAL-02 | §5H | w3 | FAIL (P248/F6/NR3) | w3: integrations.md (P248/F6/NR3) | defects W3-INT-D1 [listed] |
| PUBLIC-01 | §5H | w8 | NOT_RUN (NR1) | w1: web.md (P1); w3: integrations.md (P256/NR5); w8: integrations.md (NR1) | last PASS w3; latest wave only NOT_RUN/BLOCKED |
| ORGS-01 | §5H | w2 | FAIL (P116/F2) | w2: availability.md (P116/F2) | defects API-D5 [retest PASS] |
| API-01 | §5H | w8 | NOT_RUN (NR1) | w3: integrations.md (P353/F2/NR3/NA2); w8: integrations.md (NR1) | last PASS w3; latest wave only NOT_RUN/BLOCKED |
| HOOK-01 | §5H | w8 | FAIL (P490/F20/NA2) | w3: integrations.md (P324/F16/NR5/NA2); w8: integrations.md (P490/F20/NA2) | defects W3-INT-D7 [carried] |
| GATED-01 | §5H | w3 | FAIL (P69/F1/NR3/NA5) | w3: integrations.md,songs.md (P69/F1/NR3/NA5) | defects W3-SONG-D14 [listed] |
| MOB-001 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-002 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-003 | §6 MOB | w7 | PASS (P1) | w7: native.md (P1) |  |
| MOB-004 | §6 MOB | w8 | PASS (P2) | w7: native.md (P1/NR1); w8: native.md (P2) |  |
| MOB-005 | §6 MOB | w8 | PASS (P3) | w7: native.md (P1/NR1); w8: native.md (P3) |  |
| MOB-006 | §6 MOB | w8 | NOT_RUN (NR1) | w8: native.md (NR1) |  |
| MOB-007 | §6 MOB | w8 | NOT_RUN (NR1) | w8: native.md (NR1) |  |
| MOB-008 | §6 MOB | w8 | PASS (P2/NR1) | w2: staffing.md (NR1); w8: native.md (P2/NR1) |  |
| MOB-009 | §6 MOB | w8 | PASS (P3) | w8: native.md (P3) |  |
| MOB-010 | §6 MOB | w8 | PASS (P2) | w8: native.md (P2) |  |
| MOB-011 | §6 MOB | w8 | PASS (P3) | w8: native.md (P3) |  |
| MOB-012 | §6 MOB | w8 | PASS (P2) | w2: plans.md (NR1); w7: native.md (P1/NR1); w8: native.md (P2) |  |
| MOB-013 | §6 MOB | w8 | PASS (P2/NR1) | w8: native.md (P2/NR1) |  |
| MOB-014 | §6 MOB | w7 | PASS (P4) | w7: native.md (P4) |  |
| MOB-015 | §6 MOB | w8 | PASS (P2/NR1) | w3: release.md (NR1); w8: native.md (P2/NR1) |  |
| MOB-016 | §6 MOB | w7 | PASS (P2) | w3: messaging.md (NR1); w7: native.md (P2) |  |
| MOB-017 | §6 MOB | w8 | PASS (P3) | w8: native.md (P3) |  |
| MOB-018 | §6 MOB | w8 | PASS (P2/NR1) | w3: messaging.md (NR1); w8: native.md (P2/NR1) |  |
| MOB-019 | §6 MOB | w8 | PASS (P2) | w3: messaging.md (NR1); w7: messaging.md,native.md (P2/NR3); w8: native.md (P2) |  |
| MOB-020 | §6 MOB | w7 | FAIL (P5/F1/NR1) | w3: messaging.md,release.md (NR2); w7: messaging.md,native.md (P5/F1/NR1) | defects W7-NAT-D1 [retest PASS] |
| MOB-021 | §6 MOB | w7 | PASS (P1) | w7: native.md (P1) |  |
| MOB-022 | §6 MOB | w8 | PASS (P2) | w8: native.md (P2) |  |
| MOB-023 | §6 MOB | w7 | PASS (P1) | w7: native.md (P1) |  |
| MOB-024 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-025 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-026 | §6 MOB | w8 | NOT_RUN (NR1) | w8: native.md (NR1) |  |
| MOB-027 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-028 | §6 MOB | w8 | PASS (P2) | w8: native.md (P2) |  |
| MOB-029 | §6 MOB | w8 | PASS (P2) | w8: native.md (P2) |  |
| MOB-030 | §6 MOB | — | NEVER COVERED |  |  |
| MOB-031 | §6 MOB | w8 | FAIL (F1) | w7: native.md (P2); w8: native.md (F1) | defects W8-NAT-D1 [listed] |
| MOB-032 | §6 MOB | w8 | PASS (P1/NR1) | w8: native.md (P1/NR1) |  |
| MOB-033 | §6 MOB | — | NEVER COVERED |  |  |
| WIDGET-01 | §6 native-only | w8 | NOT_APPLICABLE (NA1) | w8: native.md (NA1) |  |
| WIDGET-02 | §6 native-only | w8 | NOT_APPLICABLE (NA1) | w8: native.md (NA1) |  |
| NATIVE-01 | §6 native-only | — | NEVER COVERED |  |  |
| NATIVE-02 | §6 native-only | — | NEVER COVERED |  |  |
| UX-01 | §7 | w2 | FAIL (F1) | w1: web.md (P2/F1); w2: plans.md (F1) | defects W2-PLANS-D11 [listed], WEB-D6 [listed] |
| UX-02 | §7 | w7 | PASS (P1) | w7: native.md (P1) |  |
| I18N-01 | §7 | — | NEVER COVERED |  |  |
| I18N-02 | §7 | — | NEVER COVERED |  |  |
| SEC-01 | §7 | w7 | FAIL (P208/F13/NR1) | w7: access-security.md,messaging.md (P208/F13/NR1) | defects W7-MSG-D11 [retest PASS] |
| SEC-02 | §7 | w8 | FAIL (P22/F4) | w7: access-security.md (P126/F3/NR1); w8: integrations.md (P22/F4) | no defect id cited in the failing rows |
| RES-01 | §7 | w8 | PASS (P4/NA1) | w8: web-ux.md (P4/NA1) |  |
| PERF-01 | §7 | w8 | FAIL (P50/F3) | w8: performance.md (P50/F3) | no defect id cited in the failing rows |
| SYNC-01 | §7 | w8 | PASS (P2) | w7: native.md,web-ux.md (P14); w8: native.md (P2) |  |

**Coverage totals (137 IDs):** FAIL 54, NEVER COVERED 17, NOT_APPLICABLE 3, NOT_RUN 8, PASS 55. **Never covered: 17** (PEOPLE-02, PEOPLE-04, REHEARSE-02, OFFLINE-01, OFFLINE-02, SCAN-01, MOB-001, MOB-002, MOB-024, MOB-025, MOB-027, MOB-030, MOB-033, NATIVE-01, NATIVE-02, I18N-01, I18N-02). Latest-FAIL rows come mostly from waves 2, 3 and 7 whose defects were fixed in later fix rounds; the defect-disposition column shows which of those were re-verified by a later retest. Every ID whose latest status is NOT_RUN/BLOCKED or whose evidence is API-only still needs the browser/simulator/device halves (W9-WEB, W9-NATIVE, QA-14).
## Defects

### W9-JRN-D1 (P1; P0-class "private data exposure" candidate, coordinator to rule) member decline reasons are readable by every active member of the organization
- Affected: API `GET /plans/:id`, PostgREST `assignment_time_responses`; every native/web client that renders the plan roster. Same tenant only: Beta-only owner reads 0 rows (J01-07f). Scope: any active member, including one with no team and no assignment on the plan.
- Minimal repro: (1) mem1 answers a released assignment through the snapshot flow (`POST /assignments/responses/preview` then `/commit`) with a decline plus reason, e.g. `{"status":"declined","reason":"Out of town at 11"}` for the 11:00 time; (2) as `viewer` (active member, no team, no assignment) `GET /api/v1/plans/{plan}`: `assignments[].time_responses[].response_note` = `"Out of town at 11"`; (3) as `viewer` `GET /rest/v1/assignment_time_responses?assignment_id=eq.{id}&select=response_note` returns the same note. mem2, candA, candB reproduce too.
- Expected: the plan (§3 oracle, RESP-02 "private reason"; fixture `declined`) keeps the reason private to the assignee, the response owner and managers, as `assignment_time_response_history` and `assignment_responses` do (W7 PRIV.history-read: unrelated member sees 0 rows). Actual: the roster visibility rule that lets members see other people's assignment rows also exposes the per-time response note. The legacy `POST /assignments/:id/respond` path stores the reason only in `assignment_responses` (private), so only the snapshot flow (the mobile app) is affected.
- Source: `supabase/migrations/20261017000300_mob005_identity_times_snapshots.sql:1467-1470` (`assignment_time_responses_select` = "any assignment the caller can read"), restated in `supabase/migrations/20261122000200_perf_assignment_access.sql:95-97`; the API forwards the column: `backend/src/services/plans.ts:51` (`time_responses:assignment_time_responses(*)`), `backend/src/routes/assignments.ts:425,483`, `backend/src/services/assignment-responses.ts:157`. Contrast `assignment_time_response_history_select` (same migration :1473-1477, assignee or `can_schedule_assignment` only).
- Suggested fix: restrict `response_note` to the assignee/response owner/schedulers (policy via a security-barrier view or move the note to the already-private history/`assignment_responses`), and select explicit non-private columns in `plans.ts`/`assignments.ts`.
- Evidence: J01-07c, J01-07e.viewer/mem2/candA/candB (FAIL), J01-07f (PASS, cross-tenant).

No other defects. Nothing in JOURNEY-02 to -07 failed after correcting four harness mistakes made during execution (wrong surface for busy-elsewhere, wrong status name, wrong feed id, wrong storage verb); superseded attempts are not in the tables.

### Observations (not defects; recorded so the release recommendation can decide)
- **W9-JRN-O1** A deactivated member keeps direct PostgREST read access to their *own* linked-Person rows (3 assignments, 3 request snapshots, their `organization_members` row) in the organization that deactivated them, until the identity is unlinked. Documented design (`20261122000200_perf_assignment_access.sql:6-8`: "both people SELECT policies admit the caller's own linked Person, even without active organization membership"). Every API route, other members' rows, plans, notes, files, people and Storage are closed (J06-09). The plan's `inactive` fixture asks for membership/session revocation, so product should confirm this residual is acceptable.
- **W9-JRN-O2** File/note audience `leaders` means plan editors / plan leaders (`private.file_leader` -> `private.is_plan_leader`); a team-scoped scheduler such as `leader` (Band `scheduling.manage` + `teams.manage`) is not in it (404 on a leaders-only file, J04-08f). Consistent with the permission oracle; worth a UX note.
- **W9-JRN-O3** Live control needs plan-level capability: a team-scoped scheduler gets 403 on Live actions (J05-04a); the takeover/handoff journey therefore used `planner` and `owner`.
- **W9-JRN-O4** Replacement offer/consent/approval produce no notification or delivery effect (documented gap, `docs/plans/mobile-first-10-progress.md` "pending F08"); recorded N/A (J03-07).
- **W9-JRN-O5** A release of two requests to one Person creates two in-app `notifications` rows (one per assignment, deduped per assignment) but one `assignment_request` effect and one delivery per channel; one answer batch with two resulting statuses creates two `scheduler_response` effects. Both are one-per-status/assignment by design, not duplicates of the same logical message.
- **W9-JRN-O6** Signed download/pack URLs issued before an audience change keep working until their short expiry (J04-08e): bearer-capability design, tested lifetime in `signed-url-lifetime.test.ts`; every new request is re-authorized immediately.

## Not run / blocked (with reasons)

| Item | Status | Reason |
|---|---|---|
| Every browser step of J01-J07 (web editors, Live controller UI, attendance/report pages, public plan/set-list pages, print/PDF) | NOT_RUN | browser owned by W9-WEB; API half of each step PASS (rows J0x-N1..N3) |
| Every simulator/native UI step (member answer sheet, rehearsal player, Live viewer/controller, org switcher, schedule/profile screens) | NOT_RUN | simulator owned by W9-NATIVE; API half PASS |
| Real push receipt, push tap/deep link, universal links cold/warm launch, widgets (WIDGET-01/02), offline cold launch and offline pack on device, airplane-mode interruption on device, real email/provider delivery, real calendar-app subscription | NOT_RUN | QA-14 physical devices and real providers unavailable; server halves verified (push rows with locale/skip reasons, deep-link target authorization, manifest/pack contract, signed-out/deactivated refusals). The backend has no widget endpoint |
| `DELIVERY_LINK_SECRET` raw token recovery | setup workaround | the raw respond token is not recoverable without the secret; the guest's token hash was replaced with the hash of a known token (setup only, J02-02e). The token path itself (preview, answer, single use) ran unmodified |
| Android | NOT_RUN | no emulator/device |

## Fixtures and pending state left in place

- Orgs `qa-w9-jrn-a/-b`; 14 users `*.qaw9.jrn@example.test` (credentials in the scratchpad only); no pending church applications, join requests or invitations (the one invitation was accepted).
- Alpha: 5 draft + 6 published plans (plan status; the Dec 6 plan's public publication is revoked), 2 Live runs (both ended), 1 replacement request (`filled`), 3 files (audio v1/v2 + chart; audio audience `scheduled`, playback `download`), 2 ready report exports (owner and leader), 9 assignment-notification token rows (8 unanswered; hashes only, expiring 24 h after each service date; the guest's was consumed), 10 `scheduled` reminder jobs, 1 active personal calendar feed for `multi` (rotated), 0 live scoped feeds, API credential revoked, public links/publication revoked.
- Device token `ExponentPushToken[w9jrn-multi-device-0001]` (fake) registered to `mem1`; no other push tokens. `multi`: Alpha language `vi`, combined schedule on, busy sharing off; `multi` is active in both orgs again after the deactivation test.
- Grants: planner scoped at "JRN Sunday"; leader at Band (incl. override); librarian/mediaed org grants; planner/leader/mem3 etc. have no cross-org rights.
- Beta: 3 published plans (one prepared assignment released), sentinel names above.
- Worker: two runs recorded; no queued deliveries remain in either org.
