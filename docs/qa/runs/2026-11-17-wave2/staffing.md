# QA-04 Staffing matrix and proposals — wave 2 (run qa-20261117, agent `staff`)

Date 2026-11-17. Repo HEAD `cac3f26` (branch `main`), latest migration `20261118000000_platform_user_management.sql`. Backend http://localhost:4000/api/v1 (running build, not restarted), local Supabase (freshly reset today). Node 26.13.1. No source, migration, config or DB-reset changes were made.

Method: every permission check used the caller's own bearer token against the API and, where relevant, directly against PostgREST (table selects/inserts/updates/deletes and RPCs) with the same token. Privileged (service-role / auth-admin) calls were used only for fixture setup (organizations, memberships, eligibility records, backdated proposal row clone, cleanup of rows the tests created) and for reading persisted state, never as permission evidence. Credentials live only in the agent scratchpad.

## ESCALATIONS

**No P0.** No cross-tenant disclosure (Beta sentinel string and Beta ids never appeared in any Alpha-context response; Beta owner could not read, write or commit anything in Alpha through API, PostgREST or RPC), no prepared-request leak to members/people (prepared rows hidden from own schedule, plan detail and PostgREST), no lost write (stale commits rejected with 409, parallel commits serialize), no overfill from the commit paths.

**One P1** (W2-STAFF-D1): a scoped/team-scoped scheduler can double-book a Person against an overlapping *prepared* request that lies outside that scheduler's scope. The conflict engine ignores such rows entirely, so both preview and commit succeed. The owner repeating the identical request is refused with 409. A second P1 (W2-STAFF-D2): inactive-membership Persons are listed as schedulable in the matrix, candidate list and the proposal engine; a proposal that selects one cannot be committed (the whole commit fails with a generic 400).

## Summary

Expanded cases executed: **538**. PASS 517, FAIL 21, BLOCKED 0, NOT_RUN 0, NOT_APPLICABLE 0. Each FAIL maps to a defect W2-STAFF-D1..D6 (several FAILs are different surfaces of one defect).

| Family | PASS | FAIL | BLOCKED | NOT_RUN | N/A |
|---|---|---|---|---|---|
| STAFF-01 | 59 | 2 | 0 | 0 | 0 |
| STAFF-02 | 77 | 1 | 0 | 0 | 0 |
| MATRIX-01 | 165 | 11 | 0 | 0 | 0 |
| PROPOSE-01 | 135 | 5 | 0 | 0 | 0 |
| PROPOSE-02 | 63 | 2 | 0 | 0 | 0 |
| WEB-D3-retest | 18 | 0 | 0 | 0 | 0 |

Surfaces: API (HTTP routes), RLS/PostgREST (direct table and RPC calls with caller JWT). Rows marked `PASS` with a note beginning "observation" meet the plan's oracle but record behavior worth a product look (see Observations).

Not covered / scoped out: web and mobile UI (another agent owns the browser; MOB-008 not in this package), delivery-provider behavior beyond the simulated provider, MAX_CANDIDATES=400 snapshot cap (needs 400 team members; NOT_RUN, listed below), 12-plan matrix cap on *authorized* plans was covered (13 plans → 400, 12 → 200), mid-session token revocation beyond grant revoke (covered), DST/overnight plans (D06 `P-DST`/`P-OVERNIGHT` not built; time-conflict semantics covered with adjacent, overlap, selected-time and rehearsal-only cases).

## Defects

### W2-STAFF-D1 (P1) Conflict engine ignores prepared requests the actor cannot see: double-booking by scoped / team-scoped schedulers
- Cases: `MATRIX-01.scoped.commit-hidden-conflict-no-leak.API`, `MATRIX-01.scoped.commit-hidden-conflict-persisted-none.API`; also reproduced on the direct schedule route and for the Band leader (see below).
- Role/scope: `scoped` scheduler (Sunday service-type `scheduling.manage`, no override) and `bandlead` (Band-team `scheduling.manage` + `teams.manage`).
- Repro: (1) owner prepares Person X on Midweek plan P5 (2027-02-14 16:00–17:00Z, visibility prepared) via `POST /plans/<P5>/assignments`. (2) `scoped` runs `POST /plans/<P2>/assignments` for X on Sunday plan P2 (same date and time) with `visibility: prepared`. Same through `POST /staffing-matrix/preview` then `/commit`. Variant: owner prepares X on Production (Sound) of P1; `bandlead` assigns X to a Band cell on overlapping Midweek plan P8 -> 201.
- Expected: blocking conflict. The owner doing the identical second request gets 409 `scheduling_conflict`, and a *released* hidden request also yields 409 for `scoped`. The code even has a redacted "Another commitment" branch for invisible rows.
- Actual: 201/200, both rows persist, preview shows `has_blocking_conflicts=false`; the owner's matrix then shows blocking conflict cells for X on both plans.
- Suspected: `supabase/migrations/20261020000100_f04_assigned_times.sql:409-410` (`existing` CTE in `private.attendance_conflicts` keeps only `visibility = 'released'` or rows the *viewer* can schedule), so prepared requests outside the actor's scope never enter the overlap join and the redaction at lines ~426-431 is unreachable for them; same predicate at line 555-556 (`conflicts-for-scope` function). The commit-time trigger `private.enforce_assignment_conflicts` passes the same viewer, so the DB re-check has the same blind spot. Fix direction: evaluate conflicts against all committed rows and only redact title/ids for rows the viewer cannot see.
- Impact: person double-booked across scopes; affects every client using schedule/matrix/proposal commit; no data leak (the conflict is *missed*, not disclosed).
- Evidence: probe run, statuses `owner prepared P5 201 / scoped POST P2 201 / rows P2 1, P5 1 / bandlead POST P8 201 / owner control 409 / scoped vs released hidden 409`.

### W2-STAFF-D2 (P1) Inactive-membership Persons are treated as schedulable by the matrix, team candidates and proposal engine; commit then fails wholesale
- Cases: `MATRIX-01.owner.query-people-excludes-inactive-members.API`, `MATRIX-01.owner.query-team-filter-lists-inactive-member.API` (+ `query-team-filter-Band`, `query-team-filter-excludes-archived-inactive`), `MATRIX-01.owner.preview-flags-inactive-member.API`, `MATRIX-01.owner.preview-flags-archived-person.API`, `MATRIX-01.owner.preview-archived-person.API`, `STAFF-01.owner.team-candidates-excludes-inactive-member.API`, `PROPOSE-02.owner.proposal-never-proposes-inactive-member.API`.
- Role/scope: owner (any scheduler).
- Repro: Person with `organization_members.status='inactive'` and a Keys membership on Band. `POST /staffing-matrix/query` (also with `team_ids:[Band]`) lists the Person; `GET /teams/<Band>/candidates` lists them; `POST /scheduling/proposals` with seed `qa-inact-1` (plans P1, P2, team Band) *chooses* the inactive Person for Keys; `POST /scheduling/proposals/<id>/commit` -> 400 "Some People, teams, positions or times do not belong to this plan", zero rows written (atomic, but the reviewed proposal cannot be committed and the message does not say why). `POST /staffing-matrix/preview` with an inactive or archived Person returns 200 with only an availability warning; commit then 400 with the same generic message.
- Expected: inactive/archived people excluded from candidate lists and proposal snapshots, or preview reports a blocking, named reason. Direct scheduling (`POST /plans/:id/assignments`) already refuses them (400), and team_candidates excludes archived.
- Suspected: `backend/src/services/staffing-matrix.ts:127` (`people_directory` filtered only by `archived_at`), `:220` (preview person lookup, no archived/inactive check); `backend/src/services/staffing-proposals.ts:148-149` (snapshot people, same filter) and `:456`; `supabase/migrations/20261018000200_f02_roster_extensions.sql:254-290` (`team_candidates` joins `people` with only `archived_at is null`). `schedule_plan_assignments` uses `private.resolve_scheduling_person` which also requires an active membership (f02 migration lines ~244-246), hence the mismatch.
- Clients: web matrix/proposals, mobile team picker if it uses `/candidates`.

### W2-STAFF-D3 (P2) Rotation-named Person can be consumed by an unrelated fairness pick, leaving the rotation slot vacant (seed-dependent)
- Cases: `PROPOSE-01.owner.rotation-slot-not-starved-by-fairness.API`, `PROPOSE-02.owner.refresh-picks-up-new-rotation-version.API`.
- Repro: Band rotation (2-week cycle, Keys: week 0 canda, week 1 candb, policy `vacancy`). `POST /scheduling/proposals` plans P1+P2, team Band, seed `qa-c-rot`. Result: Camera (earlier position id) is filled by fairness with candb; the later Keys slot for 2027-02-14 is left open with `rotation_member_unavailable` / `already_chosen_on_plan`. With seed `qa-rotvac` the same rotation yields candb on Keys (PASS case `rotation-week-pattern-applied`). After editing the rotation (swap weeks) and `refresh`, week-0 Keys is again vacant for the same reason.
- Expected: an explicit rotation turn takes priority over fairness choices for other positions, so an available rotation member is not lost.
- Actual: depends on position-id ordering and tie-break seed; the vacancy text blames the rotation member ("already proposed for this plan") although they were free.
- Suspected: `packages/shared/src/lib/staffing-proposals.ts:214-215` (needs processed in team/position-id order, rotation and fairness filled in one pass) with `:222` (`chosenOnPlan` check).

### W2-STAFF-D4 (P2) Malformed UUID / calendar-invalid date inputs reach Postgres and return HTTP 500 with raw DB text (wave-1 API-D5 class, new routes)
- Cases: `STAFF-02.owner.plan-malformed-id.API` (`POST /plans/not-a-uuid/assignments`), `MATRIX-01.owner.query-garbage-cursor.API` (`cursor:"garbage"`), `MATRIX-01.owner.DELETE-view-malformed-id.API`, `PROPOSE-01.owner.GET-rotation-malformed-id.API`, `PROPOSE-01.owner.GET-proposal-malformed-id.API`, `PROPOSE-01.owner.rotation-validate-anchor-bad.API` (`anchor_date:"2027-13-40"` matches the regex, fails in Postgres: 500 `22008 date/time field value out of range`).
- Expected: 400/404/422 without database error text (CLAUDE.md rule 20).
- Suspected: unvalidated path/cursor ids: `backend/src/routes/staffing-proposals.ts` (`param(req,'proposalId'|'rotationId')`), `backend/src/routes/staffing-matrix.ts:73-74`, `backend/src/services/staffing-matrix.ts:129` (`gt('id', cursor)`); date: `packages/shared/src/schemas/staffing-proposals.ts:4` (`localDate` regex only; same for exception `local_date`).

### W2-STAFF-D5 (P2) Scoped scheduler cannot list candidates for a shared team they can schedule on their plans
- Case: `STAFF-01.scoped.GET-team-candidates-Band.API` (also `/teams/:id/eligibility`).
- Repro: `scoped` holds Sunday service-type `plans.edit`+`scheduling.manage`. Band has no service type (shared across Sunday and Midweek). `GET /teams/<Band>/candidates` -> 404 "Team not found" (raw RPC: P0002). Associating Band with Sunday via `PUT /service-types/<Sunday>/teams` does not help. Meanwhile the same actor can `POST /plans/<Sunday plan>/assignments` for Band, query the matrix, and create/commit Band proposals.
- Expected: candidate lookup consistent with plan-scoped scheduling authority (or documented as team-scope-only).
- Suspected: `supabase/migrations/20261018000200_f02_roster_extensions.sql:265-269` (`has_capability(org,'scheduling.manage', v_team.service_type_id, p_team)` with a NULL service type; service-type grants never match). Also `private.can_schedule_team` used by rotations: scoped cannot create Band rotations (403) though they can propose Band staffing.

### W2-STAFF-D6 (P2) Proposal create accepts a lock and an exclusion for the same person and slot; recompute rejects the same input
- Case: `PROPOSE-01.owner.proposal-validate-lock-and-exclude-same-in-create.API`.
- Repro: `POST /scheduling/proposals` with `locks` and `exclusions` naming the same (plan, position, person) -> 201, stored edits contain both, engine returns the person as `locked`. `POST …/recompute` with the same combination -> 422 "A person cannot be both locked and excluded".
- Suspected: `packages/shared/src/schemas/staffing-proposals.ts:18-27` (the refine lives only on `editsSchema`, used by recompute).

### Repeat of wave-1 defects
- Wave-1 API-D5 (malformed UUID -> 500) reproduces on the new staffing routes (D4 above). Wave-1 API-D3/D4/D6 not exercised in this package.

## WEB-D3 retest (API level)

All 18 member calls against the matrix, proposal and rotation endpoints (query, preview, commit, views list/create/delete, proposals list/create/get/commit/recompute/refresh, rotations list/create/get/put/preview/archive) return **403 "You need the 'Schedule people' permission"** before any data lookup; non-members get 403 and anonymous 401. The server-side behavior is unchanged and correct: WEB-D3 is a web routing/UI issue only. Source note (static, not browser-verified): `frontend/src/router.tsx:95-96` still mounts `/plans/matrix` and `/plans/proposals` without a route-level capability gate; `StaffingProposalsPage.tsx:102` has an in-page `canAnywhere('scheduling.manage')` guard, and `StaffingMatrixPage.tsx` has no capability check in source. Whether the proposals page still fires a 403 request before its gate was not re-tested (no browser use).

## Observations (not counted as defects)

1. Scheduling does not require team membership: a Person who does not hold the team/position can be staffed through `POST /plans/:id/assignments` and matrix commit (201). Candidate lists and proposals use membership; the rotation slot likewise accepts non-members and archived Persons (preview flags `not_position_member`). Confirm intent for "wrong relationships fail".
2. Scheduling more people than a position's `needed` (needed=1, two Persons) is allowed (no overfill guard at the scheduler path; capacity is enforced only by the opportunity/claim flows, covered in QA-05).
3. `scoped` holds all teams on Sunday plans (service-type scope), including Production. Band leader with team-scope grant can schedule Band on any service type.
4. Prepared secure-team (eligibility-required) requests may be drafted for an ineligible Person; release re-checks and refuses (403). Released scheduling for missing/not-clear/expired/no-login Persons is refused.
5. Preview does not authorize the plan: `scoped` gets a 200 preview for a Midweek plan (commit is 403). Only plan title/staffing revision and names from the member-visible directory appear.
6. Direct PostgREST: a member (no `scheduling.manage`) can insert/delete rows in `staffing_matrix_views` for themselves; authors can overwrite the `result` column of their own proposals (API commit rejects the mismatch with 409, direct RPC commit validates membership/scope/conflict and refused the forged duplicate). Both are author-scoped, no cross-user effect.
7. `staffing_matrix_operation_id` RPC is callable by any authenticated user (pure hash).
8. Direct RPC errors for not-found rows surface as HTTP 500 (`P0002`) from PostgREST; the API layer maps them to 404.
9. Proposal `input_hash` covers `captured_at`, so two proposals with the same seed have identical choices but different hashes.
10. Matrix conflict redaction cell for a plan outside the actor scope shows no conflict at all (see D1).
11. Duplicate `DELETE` of an unauthorized assignment returns 204 no-op (wave-1 observation, reconfirmed).
12. Delivery truthfulness for staffing: released+notify for a no-email Person produces delivery status `skipped` / `no_email_address`; the guest with an email reaches `simulated`.

## Fixtures left in place

Orgs `qa-20261117-staff-alpha` (timezone America/Chicago) and `qa-20261117-staff-beta` (sentinel plan `BETA-SENTINEL-staff plan`, sentinel saved view `BETA-SENTINEL view`). Auth users `<alias>.qa20261117.staff@example.test` for owner, admin, legacy (scheduler/legacy), scoped (scheduler/scoped, Sunday `plans.edit`+`scheduling.manage`), bandlead (member, Band `scheduling.manage`+`teams.manage`), member, canda, candb, inactive (membership inactive), betaowner. No-login people: Gus Guest (with email), Nora NoEmail, Ari Archived. Teams Band (Keys, Drums, Camera), Production (Sound, Usher), Secure Kids (requires eligibility `background_check`; canda clear, bandlead not_clear, scoped expired). Plans (published, needs 5 positions each unless noted): P1 Sunday 2027-02-07 (rehearsal, 9:00, 11:00), P2 Sunday 02-14, P3 Midweek 02-10, P4 Sunday 02-21, P5 Midweek 02-14 (overlaps P2), P6 Midweek 02-21 17:00 (adjacent to P4), P7 Midweek 02-21 16:30 (overlaps P4), P8 Midweek 02-07 16:30 (overlaps P1 9:00), 13 bulk plans 2027-06-01..13, prior plans 2026-11-08 and 2027-01-17 (each with one released Keys request for canda). All test assignments created by cases on P1–P8 were removed; the two prior plans keep canda's released request for fairness history. Rotations created by the run are archived; ~30 draft/superseded/committed proposals remain; audit rows (`staffing_matrix_commits`, release batches, delivery effects, conflict overrides) remain.

## Manifest (no secrets)

| Alias | Role / access | Notes |
|---|---|---|
| owner | Alpha owner | org owner |
| admin | admin | |
| legacy | scheduler, access_mode legacy | org-wide operational access |
| scoped | scheduler, access_mode scoped | Sunday service type: plans.edit, scheduling.manage; no override |
| bandlead | member | Band team: scheduling.manage, teams.manage |
| member | member | no staffing grants; Usher/Sound |
| canda, candb | member | Band Keys/Drums (candb also Camera) |
| inactive | membership inactive | Band Keys |
| betaowner | Beta owner only | non-member of Alpha |

## Expanded case log

Format per case (condensed from the plan section 12 template; every case shares: commit `cac3f26`, local Supabase, Node 26.13.1, fixtures above, API `localhost:4000`, reset = cleanup of created assignments by service role). `Evidence` is a redacted assertion/response line (ids truncated). A defect id in the last column marks a FAIL.

| Case ID | Status | Evidence | Defect / note |
|---|---|---|---|
| STAFF-01.owner.PUT-position-needs-Keys-2.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.admin.PUT-position-needs-Keys-2.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.legacy.PUT-position-needs-Keys-2.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.scoped.PUT-position-needs-Keys-2.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.bandlead.PUT-position-needs-Keys-2.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.member.PUT-position-needs-Keys-2.API | PASS | 403 {"error":"Only schedulers and leaders can do that","code":"forbidden"} |  |
| STAFF-01.scoped.PUT-position-needs-Midweek-outofscope.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-01.bandlead.PUT-position-needs-ProductionSound-outofscope.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} ; Sound need now [1] |  |
| STAFF-01.owner.needed-0.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.owner.needed-99.API | PASS | 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 |  |
| STAFF-01.owner.needed-100.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"needs.0.needed","code":"t |  |
| STAFF-01.owner.needed--1.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"needs.0.needed","code":"t |  |
| STAFF-01.owner.needed-1.5.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"needs.0.needed","code":"i |  |
| STAFF-01.owner.needs-BetaPosition.API | PASS | 400 {"error":"Some positions do not belong to this organization","code":"bad_request","details":{"unknow |  |
| STAFF-01.owner.needs-BetaPlan@AlphaCtx.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-01.owner.needs-duplicate-position.API | PASS | observed 200 [{"position_id":"0cab0ca6…","team_id":"2abe70d0-2aa7-4294-91d1-6693d81f63 | observation |
| STAFF-01.owner.needs-malformed-id.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"needs.0.position_id","cod |  |
| STAFF-01.owner.POST-plan-position-Band.API | PASS | 201 {"id":"bbdf9c4b…","team_id":"2abe70d0…","name" |  |
| STAFF-01.admin.POST-plan-position-Band.API | PASS | 201 {"id":"9d6426af…","team_id":"2abe70d0…","name" |  |
| STAFF-01.legacy.POST-plan-position-Band.API | PASS | 201 {"id":"22b8a2d7…","team_id":"2abe70d0…","name" |  |
| STAFF-01.scoped.POST-plan-position-Band.API | PASS | 201 {"id":"c7c0049b…","team_id":"2abe70d0…","name" |  |
| STAFF-01.bandlead.POST-plan-position-Band.API | PASS | 201 {"id":"1992e841…","team_id":"2abe70d0…","name" |  |
| STAFF-01.member.POST-plan-position-Band.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| STAFF-01.bandlead.POST-plan-position-Production-outofscope.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-01.scoped.POST-plan-position-Midweek-outofscope.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-01.owner.POST-plan-position-BetaTeam.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-01.owner.POST-plan-position-duplicate-name.API | PASS | 409 {"error":"This plan already has a position with that name on that team","code":"plan_position_exists |  |
| STAFF-01.owner.POST-plan-position-needed-51.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"needed","code":"too_big", |  |
| STAFF-01.owner.DELETE-plan-position-occupied.API | PASS | assign 201; delete 409 {"error":"Remove the people scheduled in this position first","code":"plan_position_in_use"} |  |
| STAFF-01.owner.DELETE-plan-position-empty.API | PASS | 204 null |  |
| STAFF-01.owner.GET-team-candidates-Band.API | PASS | 200 [{"person_id":"4b9b637d…","profile_id":"f2439e23-00ad-4ebb-ac36-bd8c43e6c |  |
| STAFF-01.admin.GET-team-candidates-Band.API | PASS | 200 [{"person_id":"4b9b637d…","profile_id":"f2439e23-00ad-4ebb-ac36-bd8c43e6c |  |
| STAFF-01.legacy.GET-team-candidates-Band.API | PASS | 200 [{"person_id":"4b9b637d…","profile_id":"f2439e23-00ad-4ebb-ac36-bd8c43e6c |  |
| STAFF-01.scoped.GET-team-candidates-Band.API | FAIL | 404 {"error":"Team not found","code":"not_found"} | W2-STAFF-D5 |
| STAFF-01.bandlead.GET-team-candidates-Band.API | PASS | 200 [{"person_id":"4b9b637d…","profile_id":"f2439e23-00ad-4ebb-ac36-bd8c43e6c |  |
| STAFF-01.member.GET-team-candidates-Band.API | PASS | 403 {"error":"Only schedulers and leaders can do that","code":"forbidden"} |  |
| STAFF-01.owner.candidates-excludes-archived.API | PASS | rows=5 |  |
| STAFF-01.owner.candidates-includes-guest-noemail.API | PASS | guest/noemail present=true,true |  |
| STAFF-01.owner.candidates-no-private-fields.API | PASS | fields=person_id,profile_id,display_name,source,eligible |  |
| STAFF-01.bandlead.GET-team-candidates-Production-outofscope.API | PASS | 404 {"error":"Team not found","code":"not_found"} |  |
| STAFF-01.owner.GET-team-candidates-BetaTeam.API | PASS | 404 {"error":"Team not found","code":"not_found"} |  |
| STAFF-01.owner.GET-team-eligibility.API | PASS | 200 [{"user_id":"b0a18c6f…","eligible":true,"status":null,"expires_at":null}, |  |
| STAFF-01.bandlead.GET-team-eligibility.API | PASS | 200 [{"user_id":"b0a18c6f…","eligible":true,"status":null,"expires_at":null}, |  |
| STAFF-01.member.GET-team-eligibility.API | PASS | 403 {"error":"Only schedulers and leaders can do that","code":"forbidden"} |  |
| STAFF-01.owner.baseline-totals-matrix.API | PASS | db rows=4, matrix rows=4, prepared=2 |  |
| STAFF-01.owner.baseline-selected-times.API | PASS | {"mode":"selected","n":1} |  |
| STAFF-01.owner.baseline-all-times.API | PASS | {"mode":"all","n":0} |  |
| STAFF-01.owner.baseline-needs-5-filled-4.API | PASS | needs=5 distinctFilled=4 |  |
| STAFF-01.owner.recent-serving-future-plan-excluded.API | PASS | {"id":"4bd795da…","full_name":"canda Qa","avatar_url":null,"campus":null,"recent_serving_count":0,"last_served_at":null} |  |
| STAFF-01.member.plan-detail-hides-prepared.API | PASS | status 200; prepared ids visible=0 |  |
| STAFF-01.owner.team-candidates-excludes-inactive-member.API | FAIL | listed=true rows=6 | W2-STAFF-D2 |
| STAFF-01.owner.secure-team-eligibility-statuses.API | PASS | [] |  |
| STAFF-01.owner.secure-team-candidates-eligible-flag.API | PASS | [] |  |
| STAFF-01.owner.recent-serving-count-last-90-days.API | PASS | {"n":1,"last":"2026-11-08T16:00:00+00:00"} |  |
| STAFF-01.owner.recent-serving-zero-for-unserved.API | PASS | {"n":0} |  |
| STAFF-01.owner.recent-serving-ignores-prepared.API | PASS | after prepared past assignment: 0 |  |
| STAFF-01.owner.notify-true-on-prepared-sends-nothing.API | PASS | effects 6->6 |  |
| STAFF-01.owner.release-prepared-silent.API | PASS | 200 {"released":[{"id":"11338580…","plan_id":"89d080c |  |
| STAFF-01.legacy.no-unauthorized-team-roster-edit.API | PASS | 403 {"error":"Only organization admins and team leaders can change who is on a t |  |
| STAFF-01.scoped.no-unauthorized-team-roster-edit.API | PASS | 403 {"error":"Only organization admins and team leaders can change who is on a t |  |
| STAFF-01.bandlead.no-roster-edit-on-Production.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.ledger-setup.API | PASS | 201,201,201,201 |  |
| STAFF-02.owner.POST-assignments-Band-Sunday-P1.API | PASS | 201 {"created":[{"id":"d1b2d902…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.owner.POST-assignments-Band-Midweek-P3.API | PASS | 201 {"created":[{"id":"aa0d67ad…","plan_id":"8b5ac56d-55f4-45f2-807b-f3b0b0d6 |  |
| STAFF-02.owner.POST-assignments-Production-P1.API | PASS | 201 {"created":[{"id":"76afd30e…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.admin.POST-assignments-Band-Sunday-P1.API | PASS | 201 {"created":[{"id":"fee1c016…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.admin.POST-assignments-Band-Midweek-P3.API | PASS | 201 {"created":[{"id":"96cc9355…","plan_id":"8b5ac56d-55f4-45f2-807b-f3b0b0d6 |  |
| STAFF-02.admin.POST-assignments-Production-P1.API | PASS | 201 {"created":[{"id":"22b93504…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.legacy.POST-assignments-Band-Sunday-P1.API | PASS | 201 {"created":[{"id":"055290b5…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.legacy.POST-assignments-Band-Midweek-P3.API | PASS | 201 {"created":[{"id":"07c6062b…","plan_id":"8b5ac56d-55f4-45f2-807b-f3b0b0d6 |  |
| STAFF-02.legacy.POST-assignments-Production-P1.API | PASS | 201 {"created":[{"id":"54885226…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.scoped.POST-assignments-Band-Sunday-P1.API | PASS | 201 {"created":[{"id":"f55be99e…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.scoped.POST-assignments-Band-Midweek-P3.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.scoped.POST-assignments-Production-P1.API | PASS | 201 {"created":[{"id":"ccf3f989…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.bandlead.POST-assignments-Band-Sunday-P1.API | PASS | 201 {"created":[{"id":"3df26262…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.bandlead.POST-assignments-Band-Midweek-P3.API | PASS | 201 {"created":[{"id":"54272fbd…","plan_id":"8b5ac56d-55f4-45f2-807b-f3b0b0d6 |  |
| STAFF-02.bandlead.POST-assignments-Production-P1.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.member.POST-assignments-Band-Sunday-P1.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| STAFF-02.member.POST-assignments-Band-Midweek-P3.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| STAFF-02.member.POST-assignments-Production-P1.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| STAFF-02.owner.schedule-without-position.API | PASS | 201 {"created":[{"id":"46f68f6c…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.owner.schedule-with-position.API | PASS | 201 {"created":[{"id":"b84948cc…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.owner.position-of-other-team.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} |  |
| STAFF-02.owner.position-BetaOrg.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} |  |
| STAFF-02.owner.team-BetaOrg.API | PASS | 400 {"error":"Conflict scope must name People, plans and times of this organization","code":"bad_request |  |
| STAFF-02.owner.person-BetaOrg.API | PASS | 400 {"error":"Conflict scope must name People, plans and times of this organization","code":"bad_request |  |
| STAFF-02.owner.person-BetaOrg.persisted-none.API | PASS | rows=0 |  |
| STAFF-02.owner.plan-BetaOrg@AlphaCtx.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-02.owner.plan-unknown.API | PASS | 404 {"error":"Plan not found","code":"not_found"} |  |
| STAFF-02.owner.plan-malformed-id.API | FAIL | 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":"22P02"} | W2-STAFF-D4 wave1 D5 class (500 on malformed UUID) |
| STAFF-02.owner.empty-list.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"assignments","code":"too_ |  |
| STAFF-02.owner.no-person.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"assignments.0.person_id", |  |
| STAFF-02.owner.201-assignments-cap.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"assignments","code":"too_ |  |
| STAFF-02.owner.time-of-other-plan.API | PASS | 400 {"error":"Conflict scope must name People, plans and times of this organization","code":"bad_request |  |
| STAFF-02.owner.selected-no-times.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"assignments.0.time_ids"," |  |
| STAFF-02.owner.selected-two-times.API | PASS | 201 {"created":[{"id":"89ae7b0f…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 persisted times=2 |  |
| STAFF-02.owner.archived-person.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} |  |
| STAFF-02.owner.inactive-member.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} |  |
| STAFF-02.owner.no-login-guest.API | PASS | 201 {"created":[{"id":"d167d372…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.owner.no-email-person-released-notify.API | PASS | 201 {"created":[{"id":"fd6a165b…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 ; latest effect {"code":"42703","details":null,"hint":null,"message":"co |  |
| STAFF-02.owner.person-not-on-team.API | PASS | 201 {"created":[{"id":"a0c546a4…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 | observation: scheduling a Person who is not a member of the team is ALLOWED |
| STAFF-02.owner.secure-team-no-record-released.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.secure-team-clear-record-released.API | PASS | 201 {"created":[{"id":"14ed32be…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 |  |
| STAFF-02.owner.secure-team-not_clear-released.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.secure-team-expired-released.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.secure-team-nologin-guest-released.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.secure-team-no-record-prepared.API | PASS | 201 {"created":[{"id":"ba0e124e…","plan_id":"89d080ce-7741-4d9d-911f-bcaf6bd6 | observation: prepared draft for ineligible person is allowed (release re-checks) |
| STAFF-02.owner.secure-team-release-recheck.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| STAFF-02.owner.duplicate-sequential.API | PASS | 201/201 rows=1 created2=0 |  |
| STAFF-02.owner.duplicate-concurrent-8.API | PASS | statuses=201,201,201,201,201,201,201,201 rows=1 createdCounts=1,0,0,0,0,0,0,0 |  |
| STAFF-02.multi-actor.duplicate-concurrent.API | PASS | statuses=201,201,201,201 rows=1 |  |
| STAFF-02.owner.concurrent-overlapping-plans-one-wins.API | PASS | statuses=201,409 rows=1 |  |
| STAFF-02.owner.conflict-no-override.API | PASS | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict |  |
| STAFF-02.owner.conflict-ignore-without-reason.API | PASS | 409 {"error":"Give a reason to schedule over these conflicts","code":"scheduling_conflict","details":[{" |  |
| STAFF-02.owner.conflict-override-with-reason.API | PASS | 201 {"created":[{"id":"ecd3f43c…","plan_id":"3395588c-814a-4711-8025-09f37dde | observed 201 |
| STAFF-02.admin.conflict-override-with-reason.API | PASS | 201 {"created":[{"id":"f64a2001…","plan_id":"3395588c-814a-4711-8025-09f37dde | observed 201 |
| STAFF-02.legacy.conflict-override-with-reason.API | PASS | 201 {"created":[{"id":"224c5cd9…","plan_id":"3395588c-814a-4711-8025-09f37dde | observed 201 |
| STAFF-02.scoped.conflict-override-with-reason.API | PASS | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | observed 403 |
| STAFF-02.bandlead.conflict-override-with-reason.API | PASS | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | observed 403 |
| STAFF-02.member.conflict-override-with-reason.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} | observed 403 |
| STAFF-02.owner.conflicts-check-endpoint.API | PASS | 200 {"conflicts":[{"candidate_key":"4bd795da…:3395588c-814a-4711-8025-09f37dd |  |
| STAFF-02.scoped.conflicts-check-endpoint.API | PASS | 200 {"conflicts":[{"candidate_key":"4bd795da…:3395588c-814a-4711-8025-09f37dd | observed |
| STAFF-02.bandlead.conflicts-check-endpoint.API | PASS | 200 {"conflicts":[{"candidate_key":"4bd795da…:3395588c-814a-4711-8025-09f37dd | observed |
| STAFF-02.member.conflicts-check-endpoint.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} | observed |
| STAFF-02.betaowner.conflicts-check-endpoint.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} | observed |
| STAFF-02.owner.adjacent-intervals-no-conflict.API | PASS | 201 {"created":[{"id":"3fcadef6…","plan_id":"78dbf7fb-70e9-4c4e-aba0-5bc84962 |  |
| STAFF-02.owner.overlapping-intervals-conflict.API | PASS | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict |  |
| STAFF-02.owner.selected-time-avoids-conflict.API | PASS | 201 {"created":[{"id":"133e0ef4…","plan_id":"204bd6cc-c071-44f6-9766-3292a0d5 |  |
| STAFF-02.owner.all-times-conflicts-with-9am.API | PASS | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict |  |
| STAFF-02.owner.rehearsal-only-no-conflict-with-9am-plan.API | PASS | 201 {"created":[{"id":"bc861d3d…","plan_id":"204bd6cc-c071-44f6-9766-3292a0d5 |  |
| STAFF-02.owner.over-need-count.API | PASS | 201/201 | observation: scheduler may stage more people than needed in a position (needed=1, two assigned): allowed |
| STAFF-02.nonmember-betaowner.POST-assignments.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| STAFF-02.anonymous.POST-assignments.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| STAFF-02.member.DELETE-assignment-Band.API | PASS | 403 removed=false |  |
| STAFF-02.bandlead.DELETE-assignment-ProductionOutOfScope.API | PASS | 204 removed=false |  |
| STAFF-02.scoped.DELETE-assignment-Band.API | PASS | 204 removed=true |  |
| STAFF-02.member.PATCH-assignment.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| STAFF-02.owner.no-email-person-honest-undeliverable.API | PASS | noemail delivery=skipped/no_email_address; guest(with email)=simulated/null |  |
| STAFF-02.owner.guest-with-email-delivery-attempted.API | PASS | guest delivery=simulated |  |
| MATRIX-01.owner.POST-query-Feb.API | PASS | status 200, plans=8 (want 8), people=11 |  |
| MATRIX-01.admin.POST-query-Feb.API | PASS | status 200, plans=8 (want 8), people=11 |  |
| MATRIX-01.legacy.POST-query-Feb.API | PASS | status 200, plans=8 (want 8), people=11 |  |
| MATRIX-01.scoped.POST-query-Feb.API | PASS | status 200, plans=3 (want 3), people=11 |  |
| MATRIX-01.bandlead.POST-query-Feb.API | PASS | status 200, plans=8 (want 8), people=11 |  |
| MATRIX-01.member.POST-query.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| MATRIX-01.nonmember.POST-query.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| MATRIX-01.anonymous.POST-query.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| MATRIX-01.owner.query-no-org-header.API | PASS | 200 {"plans":[{"id":"204bd6cc…","title":"QA Midweek overlaps 9:00 of P1", | observation: owner of two? has single org so inferred |
| MATRIX-01.owner.query-BetaOrgHeader.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| MATRIX-01.owner.query-BetaPlanId-in-filter.API | PASS | status 200 plans=0 |  |
| MATRIX-01.owner.no-beta-sentinel-in-alpha.API | PASS | sentinel absent |  |
| MATRIX-01.scoped.query-outofscope-plan-id.API | PASS | status 200 plans=0 |  |
| MATRIX-01.scoped.query-outofscope-servicetype.API | PASS | status 200 plans=0 |  |
| MATRIX-01.bandlead.query-ProductionTeam-filter.API | PASS | status 200 plans=0 people=0 | observed |
| MATRIX-01.owner.query-13-plans-bounded.API | PASS | 400 {"error":"Narrow the filters to 12 plans or fewer","code":"bad_request"} |  |
| MATRIX-01.owner.query-12-plans-allowed.API | PASS | status 200 plans=12 |  |
| MATRIX-01.owner.query-plan_ids-13.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.plan_ids","code": |  |
| MATRIX-01.owner.query-to-equals-from.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.to","code":"custo |  |
| MATRIX-01.owner.query-bad-date.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.from","code":"inv |  |
| MATRIX-01.owner.query-no-filters.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters","code":"invalid_ |  |
| MATRIX-01.owner.query-malformed-team-id.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.team_ids.0","code |  |
| MATRIX-01.owner.query-BetaTeam-id.API | PASS | status 200 plans=8 people=11 | beta team id ignored as unknown |
| MATRIX-01.owner.query-page_size-0.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"page_size","code":"too_sm |  |
| MATRIX-01.owner.query-page_size-51.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"page_size","code":"too_bi |  |
| MATRIX-01.owner.query-page_size--1.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"page_size","code":"too_sm |  |
| MATRIX-01.owner.query-page_size-1.5.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"page_size","code":"invali |  |
| MATRIX-01.owner.query-cursor-paging-complete-no-dups.API | PASS | pages=4 ids=11 unique=11 full=11 |  |
| MATRIX-01.owner.query-garbage-cursor.API | FAIL | 500 {"error":"invalid input syntax for type uuid: \"garbage\"","code":"22P02"} | W2-STAFF-D4 |
| MATRIX-01.owner.query-search.API | PASS | people=canda Qa |  |
| MATRIX-01.owner.query-search-filter-injection.API | PASS | status 200 people=0 |  |
| MATRIX-01.owner.query-search-percent-wildcard.API | PASS | status 200 people=11 | observation: % stripped, search becomes match-all |
| MATRIX-01.owner.query-search-101-chars.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.search","code":"t |  |
| MATRIX-01.owner.query-team-filter-Band.API | FAIL | Gus Guest/Nora NoEmail/bandlead Qa/canda Qa/candb Qa/inactive Qa | W2-STAFF-D2 |
| MATRIX-01.owner.query-team-filter-excludes-archived-inactive.API | FAIL | Gus Guest/Nora NoEmail/bandlead Qa/canda Qa/candb Qa/inactive Qa | W2-STAFF-D2 |
| MATRIX-01.owner.query-team-filter-needs-only-Band.API | PASS | needs teams=Band |  |
| MATRIX-01.owner.query-servicetype-filter.API | PASS | plans=5 |  |
| MATRIX-01.owner.query-plan_ids-filter.API | PASS | plans=2 |  |
| MATRIX-01.owner.people-no-private-fields.API | PASS | fields=id,full_name,avatar_url,campus,recent_serving_count,last_served_at |  |
| MATRIX-01.owner.assignments-prepared-visible.API | PASS | rows=2 |  |
| MATRIX-01.bandlead.assignments-only-managed-team.API | PASS | rows=1 teams=Band | prepared Production row must not be visible to Band-only leader |
| MATRIX-01.scoped.assignments-Sunday-all-teams.API | PASS | rows=2 |  |
| MATRIX-01.owner.conflict-cell-detected.API | PASS | {"key":"4bd795da…:db9e8c01…","person_id":"4bd795da…","plan_id":"db9e8c01…","conflicts":[{"candidate_key":"4bd795da…:db9e8c01…","person_id" |  |
| MATRIX-01.scoped.conflict-cell-redaction.API | PASS | undefined | observation: fields shown for conflict with plan outside the actor scope |
| MATRIX-01.scoped.revoked-grant-mid-session.API | PASS | before 200, after 403 |  |
| MATRIX-01.scoped.regranted.API | PASS | status 200 |  |
| MATRIX-01.owner.view-create.API | PASS | 201 {"id":"9f9cab4a…","organization_id":"46165088… |  |
| MATRIX-01.owner.view-list-contains.API | PASS | n=1 |  |
| MATRIX-01.admin.view-not-visible-to-others.API | PASS | n=0 |  |
| MATRIX-01.owner.view-update-by-name-upsert.API | PASS | count=1 planid=db9e8c01… |  |
| MATRIX-01.admin.same-name-view-separate-from-owner.API | PASS | admin views=1 |  |
| MATRIX-01.admin.DELETE-owners-view-noop.API | PASS | status 204, owner view still present=true |  |
| MATRIX-01.admin.PostgREST-select-owners-view.RLS | PASS | 200 rows=0 |  |
| MATRIX-01.member.PostgREST-select-views.RLS | PASS | 200 rows=0 |  |
| MATRIX-01.admin.PostgREST-insert-view-as-other-owner.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |  |
| MATRIX-01.admin.PostgREST-update-owners-view.RLS | PASS | 200 rows=0 |  |
| MATRIX-01.admin.PostgREST-delete-owners-view.RLS | PASS | 200 rows=0 |  |
| MATRIX-01.member.PostgREST-insert-own-view.RLS | PASS | 201 [{"id":"13180238…","organization_id":"46165088-3886-455a-b7ed-4e6cc32e608 | observation: member (no scheduling.manage) can store a view row directly; harmless data, own-owner only |
| MATRIX-01.owner.view-delete.API | PASS | status 204 |  |
| MATRIX-01.member.POST-view.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| MATRIX-01.member.GET-views.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| MATRIX-01.owner.view-name-81.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_big","m |  |
| MATRIX-01.owner.view-name-blank.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_small", |  |
| MATRIX-01.owner.view-bad-filters.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"filters.from","code":"inv |  |
| MATRIX-01.owner.DELETE-view-malformed-id.API | FAIL | 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":"22P02"} | W2-STAFF-D4 wave1 D5 class |
| MATRIX-01.scoped.view-save-sanitizes-outofscope-ids.API | PASS | status 201 stored plan_ids=1 st=1 teams=1 |  |
| MATRIX-01.scoped.view-load.API | PASS | n=1 |  |
| MATRIX-01.scoped.view-load-sanitizes-stale-scope.API | PASS | ["89d080ce…"] |  |
| MATRIX-01.owner.view-corrupt-filters-skipped.API | PASS | status 200 n=0 |  |
| MATRIX-01.owner.view-cross-tenant-invisible.API | PASS | alpha n=0; beta sees own=true |  |
| MATRIX-01.owner.preview-assign-2cells.API | PASS | status 200 items=2 |  |
| MATRIX-01.owner.preview-delivery-intent.API | PASS | none,assignment_request |  |
| MATRIX-01.owner.preview-has-no-side-effects.API | PASS | effects 2->2, rows 0->0, rev 199->199 |  |
| MATRIX-01.owner.preview-deterministic-operation-id.API | PASS | 666e0aff4fa2 vs 666e0aff4fa2 |  |
| MATRIX-01.owner.preview-base-revisions-sorted-match-db.API | PASS | [199,12] |  |
| MATRIX-01.owner.preview-Sunday-Band.API | PASS | 200 {"operation_id":"6b1bae57…","base_revisio |  |
| MATRIX-01.admin.preview-Sunday-Band.API | PASS | 200 {"operation_id":"6b1bae57…","base_revisio |  |
| MATRIX-01.legacy.preview-Sunday-Band.API | PASS | 200 {"operation_id":"6b1bae57…","base_revisio |  |
| MATRIX-01.scoped.preview-Sunday-Band.API | PASS | 200 {"operation_id":"6b1bae57…","base_revisio |  |
| MATRIX-01.bandlead.preview-Sunday-Band.API | PASS | 200 {"operation_id":"6b1bae57…","base_revisio |  |
| MATRIX-01.member.preview-Sunday-Band.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| MATRIX-01.scoped.preview-Midweek-outofscope.API | PASS | 200 {"operation_id":"4e34169f…","base_revisions": | observed: preview of an out-of-scope plan returns 200; commit authorization checked separately |
| MATRIX-01.bandlead.preview-Production-cell.API | PASS | 200 {"operation_id":"0f14e210…","base_revisions": | observed 200 |
| MATRIX-01.owner.preview-inactive-person.API | PASS | 200 {"operation_id":"a3bd8aaa…","base_revisions": | observed 200: preview of an inactive member |
| MATRIX-01.owner.preview-archived-person.API | FAIL | 200 {"operation_id":"95c445ad…","base_revisions": | W2-STAFF-D2 |
| MATRIX-01.owner.preview-BetaPerson.API | PASS | 400 {"error":"One of those people is no longer available","code":"bad_request"} |  |
| MATRIX-01.owner.preview-BetaPlan.API | PASS | 404 {"error":"One of those plans is unavailable","code":"not_found"} |  |
| MATRIX-01.owner.preview-BetaTeam-position.API | PASS | 400 {"error":"Conflict scope must name People, plans and times of this organization","code":"bad_request | observed 400: preview accepts foreign team id; see commit case |
| MATRIX-01.owner.preview-201-actions.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"actions","code":"too_big" |  |
| MATRIX-01.owner.preview-0-actions.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"actions","code":"too_smal |  |
| MATRIX-01.owner.preview-unknown-kind.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"actions.0","code":"invali |  |
| MATRIX-01.owner.preview-selected-without-times.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"actions.0.time_ids","code |  |
| MATRIX-01.owner.preview-13-plans.API | PASS | 400 {"error":"A staffing matrix contains at most 12 plans","code":"bad_request"} |  |
| MATRIX-01.owner.preview-remove-unknown-assignment.API | PASS | 409 {"error":"A selected request is no longer available","code":"matrix_changed"} |  |
| MATRIX-01.owner.preview-remove-malformed-id.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"actions.0.assignment_id", |  |
| MATRIX-01.owner.preview-blocking-conflict.API | PASS | blocking=true conflicts=1 |  |
| MATRIX-01.owner.commit-over-blocking-conflict-rejected.API | PASS | 409 {"error":"This Person is unavailable or already scheduled at that time","code":"scheduling_conflict" |  |
| MATRIX-01.owner.commit-over-conflict-persisted-none.API | PASS | rows p2=0 |  |
| MATRIX-01.scoped.preview-hidden-prepared-conflict.API | PASS | blocking=false conflicts=0 | observation: preview cannot see prepared requests outside actor scope |
| MATRIX-01.scoped.commit-hidden-conflict-no-leak.API | FAIL | 200 {"operation_id":"b2dc1c86e847eea8e02fbcb93e3f256d7 | W2-STAFF-D1 |
| MATRIX-01.scoped.commit-hidden-conflict-persisted-none.API | FAIL | rows=1 | W2-STAFF-D1 |
| MATRIX-01.owner.commit-assign-2cells.API | PASS | 200 {"operation_id":"b373f9be7249b7ea49a0b05600a5e552e |  |
| MATRIX-01.owner.commit-persisted-prepared.API | PASS | rows=2 vis=prepared,prepared |  |
| MATRIX-01.owner.commit-bumps-plan-revision.API | PASS | 199->202 |  |
| MATRIX-01.owner.commit-prepared-no-delivery-effect.API | PASS | effects 2->2 |  |
| MATRIX-01.owner.commit-selected-time-persisted.API | PASS | times=1 |  |
| MATRIX-01.owner.commit-idempotent-replay-same-result.API | PASS | replay 200 rows=2 |  |
| MATRIX-01.owner.commit-key-reuse-different-op.API | PASS | 409 {"error":"That idempotency key belongs to another staffing operation","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-key-reuse-persisted-none.API | PASS | p2 rows=0 |  |
| MATRIX-01.admin.commit-same-key-other-actor-independent.API | PASS | status 200 rows=1 |  |
| MATRIX-01.owner.commit-replay-after-change.API | PASS | status 200 |  |
| MATRIX-01.owner.commit-already-staffed-cell.API | PASS | 409 {"error":"A selected cell is already staffed","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-already-staffed-no-dup.API | PASS | rows=2 |  |
| MATRIX-01.owner.commit-stale-base-revision.API | PASS | 409 {"error":"Staffing changed since the preview. Refresh and review again.","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-stale-no-silent-overwrite.API | PASS | guest not written; admin write retained |  |
| MATRIX-01.owner.commit-recover-after-refresh.API | PASS | 200 {"operation_id":"90a21f775a207553636f4510a1486 |  |
| MATRIX-01.owner.commit-tampered-actions.API | PASS | 409 {"error":"The staffing preview does not match this commit","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-tampered-revisions.API | PASS | 409 {"error":"The staffing preview does not match this commit","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-empty-base-revisions.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"base_revisions","code":"t |  |
| MATRIX-01.owner.commit-short-idempotency-key.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"idempotency_key","code":" |  |
| MATRIX-01.owner.commit-bad-operation-id.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"operation_id","code":"inv |  |
| MATRIX-01.owner.commit-tamper-persisted-none.API | PASS | p2 rows=0 |  |
| MATRIX-01.owner.commit-atomic-rollback-invalid-person.API | PASS | commit 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"}; rows 0->0 |  |
| MATRIX-01.owner.commit-atomic-rollback-stale-second-plan.API | PASS | 409 p2 rows=0 |  |
| MATRIX-01.owner.commit-BetaTeam-cell.API | PASS | preview 400 |  |
| MATRIX-01.owner.commit-position-of-other-team.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} rows=0 |  |
| MATRIX-01.owner.commit-time-from-other-plan.API | PASS | preview 400 |  |
| MATRIX-01.owner.commit-inactive-member-cell.API | PASS | 400 {"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_request"} rows=0 |  |
| MATRIX-01.owner.commit-secure-team-ineligible-released.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} rows=0 |  |
| MATRIX-01.owner.commit-Sunday-Band-cell.API | PASS | 200 {"operation_id":"1cce00a5e08c474bfc6bd14d024536611 |  |
| MATRIX-01.admin.commit-Sunday-Band-cell.API | PASS | 200 {"operation_id":"ca3000b4f583336bdcc428c638d6da082 |  |
| MATRIX-01.legacy.commit-Sunday-Band-cell.API | PASS | 200 {"operation_id":"f7045827bd4b44225dc69037e5c30e0136 |  |
| MATRIX-01.scoped.commit-Sunday-Band-cell.API | PASS | 200 {"operation_id":"edd8b4bd1690ee5ad5e76928b3deb8357 |  |
| MATRIX-01.bandlead.commit-Sunday-Band-cell.API | PASS | 200 {"operation_id":"c4a10d7eac0d56bb0da1df3d28db2f92f8 |  |
| MATRIX-01.member.commit-Sunday-Band-cell.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| MATRIX-01.scoped.commit-Midweek-outofscope.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} rows=0 |  |
| MATRIX-01.bandlead.commit-Production-cell.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} rows=0 |  |
| MATRIX-01.bandlead.commit-mixed-cells-all-or-nothing.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} rows=0 |  |
| MATRIX-01.nonmember.commit.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| MATRIX-01.anonymous.commit.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| MATRIX-01.member.RPC-commit_staffing_matrix.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"You cannot schedule one of those cells"} rows=0 |  |
| MATRIX-01.betaowner.RPC-commit_staffing_matrix-AlphaOrg.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"You cannot schedule one of those cells"} rows=0 |  |
| MATRIX-01.betaowner.RPC-commit-AlphaPlans-with-BetaOrgId.RLS | PASS | 409 {"code":"PT409","details":null,"hint":"matrix_changed","message":"Staffing changed since the preview rows=0 |  |
| MATRIX-01.owner.RPC-commit-AlphaPlans-with-BetaOrgId.RLS | PASS | 409 {"code":"PT409","details":null,"hint":"matrix_changed","message":"Staffing changed since the preview rows=0 |  |
| MATRIX-01.anonymous.RPC-commit_staffing_matrix.RLS | PASS | status 401 |  |
| MATRIX-01.member.RPC-operation-id-helper.RLS | PASS | 200 | observation: pure hash helper callable by any authenticated user; no data read |
| MATRIX-01.owner.commit-remove-stale-revision.API | PASS | 409 {"error":"A selected request changed since the preview","code":"matrix_changed"} still present |  |
| MATRIX-01.owner.commit-remove.API | PASS | 200 {"operation_id":"8732c4f0bf3bac02c68e0bc9334b3 |  |
| MATRIX-01.owner.commit-remove-wrong-plan-id.API | PASS | 409 {"error":"A selected request changed since the preview","code":"matrix_changed"} |  |
| MATRIX-01.bandlead.preview-remove-Production-prepared-cell.API | PASS | 409 {"error":"A selected request is no longer available","code":"matrix_changed"} | observed: Band-only leader cannot see prepared Production row |
| MATRIX-01.bandlead.commit-remove-Production-cell.API | PASS | 409 {"error":"A selected request is no longer available","code":"matrix_changed"} |  |
| MATRIX-01.canda.prepared-hidden-from-own-schedule.API | PASS | status 200 body has id=false |  |
| MATRIX-01.owner.commit-release-silent.API | PASS | 200 {"operation_id":"e1abd8b698a8b072492da969fb38b4a496 |  |
| MATRIX-01.canda.released-visible-in-own-schedule.API | PASS | visible=true |  |
| MATRIX-01.candb.still-prepared-hidden.API | PASS | hidden |  |
| MATRIX-01.owner.commit-release-notify.API | PASS | 200 {"operation_id":"22148f8915b06449bfcf9be0a665ae636; effects 2->3 |  |
| MATRIX-01.owner.commit-release-already-released.API | PASS | 409 {"error":"A selected request changed since the preview","code":"matrix_changed"} |  |
| MATRIX-01.bandlead.commit-release-Production-cell.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| MATRIX-01.scoped.commit-release-Sunday-cell.API | PASS | 200 {"operation_id":"4b69104dfa25763bc7443d94584cf |  |
| MATRIX-01.owner.preview-copy-warns-resets-answers.API | PASS | 200 {"operation_id":"c3c10dae…","base_revisio warnings=["Has never reviewed their availability","Answers and delivery timestamps will be reset on the  |  |
| MATRIX-01.owner.commit-copy-resets-answer.API | PASS | status 200 dest=[["unconfirmed","prepared","all"]]; source status=confirmed |  |
| MATRIX-01.owner.commit-copy-source-unchanged.API | PASS | source status=confirmed |  |
| MATRIX-01.owner.commit-copy-duplicate-destination.API | PASS | 409 {"error":"A copied cell is already staffed","code":"matrix_changed"} |  |
| MATRIX-01.owner.commit-copy-stale-source-revision.API | PASS | 409 {"error":"The source request changed since the preview","code":"matrix_changed"} |  |
| MATRIX-01.scoped.commit-copy-to-Midweek-outofscope.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| MATRIX-01.owner.preview-copy-to-BetaPlan.API | PASS | 404 {"error":"One of those plans is unavailable","code":"not_found"} |  |
| MATRIX-01.owner.commit-copy-released-notify-one-effect.API | PASS | 200 {"operation_id":"507341899e3f8a2e3947786a09852f241 |  |
| MATRIX-01.owner.query-people-excludes-inactive-members.API | FAIL | inactive member listed as schedulable row: true | W2-STAFF-D2 |
| MATRIX-01.owner.query-team-filter-lists-inactive-member.API | FAIL | listed=true | W2-STAFF-D2 |
| MATRIX-01.owner.preview-flags-archived-person.API | FAIL | preview 200; warnings=["Has never reviewed their availability"]; commit then: 400 | W2-STAFF-D2 |
| MATRIX-01.owner.preview-flags-inactive-member.API | FAIL | preview 200; warnings=["Has never reviewed their availability"] | W2-STAFF-D2 |
| MATRIX-01.two-actors.parallel-commits-same-plan-same-base-revision.API | PASS | statuses=409,200 rows=1 (no lost write, loser told to refresh) |  |
| MATRIX-01.owner.parallel-commits-same-key.API | PASS | statuses=200,200,200,200,200,200 rows=1 distinct results=1 |  |
| MATRIX-01.owner.parallel-commits-different-keys-same-cell.API | PASS | statuses=200,409,409,409,409,409 rows=1 |  |
| MATRIX-01.two-actors.parallel-commits-overlapping-plans-one-person.API | PASS | statuses=200,409 rows=1 (overlap must not double-book) |  |
| MATRIX-01.owner-vs-direct-schedule.race-no-duplicate.API | PASS | matrix 200, direct 201, rows=1 |  |
| PROPOSE-01.owner.POST-rotation-Band.API | PASS | 201 {"id":"476c969f…","organization_id":"46165088… |  |
| PROPOSE-01.admin.POST-rotation-Band.API | PASS | 201 {"id":"cbf05c29…","organization_id":"46165088… |  |
| PROPOSE-01.legacy.POST-rotation-Band.API | PASS | 201 {"id":"41aa0cda…","organization_id":"46165088… |  |
| PROPOSE-01.scoped.POST-rotation-Band(shared-team).API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} | observed 403 (scoped has Sunday service-type scope; Band has no service type) |
| PROPOSE-01.bandlead.POST-rotation-Band.API | PASS | 201 {"id":"53155085…","organization_id":"46165088… |  |
| PROPOSE-01.member.POST-rotation-Band.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.bandlead.POST-rotation-Production-outofscope.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| PROPOSE-01.nonmember.POST-rotation.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| PROPOSE-01.anonymous.POST-rotation.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| PROPOSE-01.owner.rotation-validate-cycle_weeks-0.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"cycle_weeks","code":" |  |
| PROPOSE-01.owner.rotation-validate-cycle_weeks-13.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"cycle_weeks","code":" |  |
| PROPOSE-01.owner.rotation-validate-slot-week-outside-cycle.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"slots","code":"custom |  |
| PROPOSE-01.owner.rotation-validate-slot-duplicate.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"slots","code":"custom |  |
| PROPOSE-01.owner.rotation-validate-name-blank.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_sma |  |
| PROPOSE-01.owner.rotation-validate-name-81.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_big |  |
| PROPOSE-01.owner.rotation-validate-anchor-bad.API | FAIL | 500 {"error":"date/time field value out of range: \"2027-13-40\"","code":"22008"} | W2-STAFF-D4 valid-looking YYYY-MM-DD that is not a calendar date reaches Postgres |
| PROPOSE-01.owner.rotation-validate-anchor-format.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"anchor_date","code":" |  |
| PROPOSE-01.owner.rotation-validate-substitute-bad.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"substitute_policy","c |  |
| PROPOSE-01.owner.rotation-validate-slots-241.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"slots","code":"too_bi |  |
| PROPOSE-01.owner.rotation-validate-exception-duplicate.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"exceptions","code":"c |  |
| PROPOSE-01.owner.rotation-validate-exception-note-201.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"exceptions.0.note","c |  |
| PROPOSE-01.owner.rotation-validate-team-malformed.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"team_id","code":"inva |  |
| PROPOSE-01.owner.rotation-slot-person-not-position-member.API | PASS | 201 {"id":"a7efc6b0…","organization_id":"46165088… | observation: slot may name a Person who does not hold the position (preview flags not_position_member); status 201 |
| PROPOSE-01.owner.rotation-slot-position-of-other-team.API | PASS | 400 {"error":"Every slot and exception must use this team's positions and people in this organization"," |  |
| PROPOSE-01.owner.rotation-slot-BetaPerson-BetaPosition.API | PASS | 400 {"error":"Every slot and exception must use this team's positions and people in this organization"," |  |
| PROPOSE-01.owner.rotation-BetaTeam.API | PASS | 403 {"error":"You do not have access to do that","code":"forbidden"} |  |
| PROPOSE-01.owner.rotation-slot-archived-person.API | PASS | 201 {"id":"e7d7af24…","organization_id":"46165088… | observation: archived Person accepted into a rotation slot; status 201 |
| PROPOSE-01.owner.rotation-slot-inactive-member.API | PASS | 201 {"id":"0224efab…","organization_id":"46165088… | observed 201 (inactive Keys member) |
| PROPOSE-01.owner.rotation-duplicate-active-name.API | PASS | 201/409 |  |
| PROPOSE-01.owner.rotation-name-reusable-after-archive.API | PASS | 201 |  |
| PROPOSE-01.owner.GET-rotation.API | PASS | 200 {"id":"476c969f…","organization_id":"46165088-3886-455a-b7e |  |
| PROPOSE-01.admin.GET-rotation.API | PASS | 200 {"id":"476c969f…","organization_id":"46165088-3886-455a-b7e |  |
| PROPOSE-01.legacy.GET-rotation.API | PASS | 200 {"id":"476c969f…","organization_id":"46165088-3886-455a-b7e |  |
| PROPOSE-01.scoped.GET-rotation.API | PASS | 404 {"error":"Rotation not found","code":"not_found"} | denied expected (member/non-member/out-of-scope) |
| PROPOSE-01.bandlead.GET-rotation.API | PASS | 200 {"id":"476c969f…","organization_id":"46165088-3886-455a-b7e |  |
| PROPOSE-01.member.GET-rotation.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} | denied expected (member/non-member/out-of-scope) |
| PROPOSE-01.betaowner.GET-rotation.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} | denied expected (member/non-member/out-of-scope) |
| PROPOSE-01.betaowner.GET-AlphaRotation-with-BetaOrgHeader.API | PASS | 404 {"error":"Rotation not found","code":"not_found"} |  |
| PROPOSE-01.owner.GET-rotations-list.API | PASS | n=5 |  |
| PROPOSE-01.owner.GET-rotations-team-filter.API | PASS | n=0 |  |
| PROPOSE-01.bandlead.GET-rotations-only-Band.API | PASS | n=5 |  |
| PROPOSE-01.member.GET-rotations.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.owner.GET-rotation-malformed-id.API | FAIL | 500 {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} | W2-STAFF-D4 wave1 D5 class |
| PROPOSE-01.owner.PUT-rotation.API | PASS | rev 1->2 |  |
| PROPOSE-01.owner.PUT-rotation-stale-revision.API | PASS | 409 {"error":"The rotation changed since you opened it","code":"rotation_changed"} |  |
| PROPOSE-01.owner.PUT-rotation-stale-no-change.API | PASS | name unchanged |  |
| PROPOSE-01.owner.rotation-version-history-recorded.API | PASS | versions=1,2 |  |
| PROPOSE-01.member.PUT-rotation.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.bandlead.PUT-rotation-Band.API | PASS | 200 {"id":"41aa0cda…","organization_id":"46165088-388 |  |
| PROPOSE-01.owner.rotation-exception-skip.API | PASS | 200 {"id":"41aa0cda…","organization_id":"46165088-3886-455a-b7ed-4e6cc32e |  |
| PROPOSE-01.owner.rotation-preview-exception-vacancy.API | PASS | {"src":"skipped","person":null} |  |
| PROPOSE-01.owner.rotation-preview-cycle-week-index.API | PASS | wk0 person ok=true n=2 |  |
| PROPOSE-01.owner.rotation-preview-over-184-days.API | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"to","code":"custo |  |
| PROPOSE-01.owner.rotation-preview-to-before-from.API | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"to","code":"custo |  |
| PROPOSE-01.member.rotation-preview.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.owner.rotation-preview-flags-removed-member.API | PASS | {"issue":"not_position_member"} |  |
| PROPOSE-01.owner.archive-rotation-stale-revision.API | PASS | 409 {"error":"The rotation changed since you opened it","code":"rotation_changed"} |  |
| PROPOSE-01.member.archive-rotation.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.owner.archive-rotation.API | PASS | 204 null |  |
| PROPOSE-01.owner.archived-hidden-unless-included.API | PASS | default n=4 incl n=21 |  |
| PROPOSE-01.owner.PUT-archived-rotation.API | PASS | 409 {"error":"This rotation is archived","code":"rotation_changed"} |  |
| PROPOSE-01.owner.archive-twice.API | PASS | 204 null | observed 204 |
| PROPOSE-01.member.PostgREST-select-team_rotations.RLS | PASS | 200 rows=0 |  |
| PROPOSE-01.member.PostgREST-select-rotation-slots.RLS | PASS | 200 rows=0 |  |
| PROPOSE-01.admin.PostgREST-select-team_rotations.RLS | PASS | rows=21 |  |
| PROPOSE-01.bandlead.PostgREST-select-only-Band.RLS | PASS | rows=21 |  |
| PROPOSE-01.betaowner.PostgREST-select-AlphaRotations.RLS | PASS | rows=0 |  |
| PROPOSE-01.owner.PostgREST-insert-team_rotations-denied.RLS | PASS | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |  |
| PROPOSE-01.owner.PostgREST-update-team_rotations-denied.RLS | PASS | 403 |  |
| PROPOSE-01.owner.PostgREST-delete-team_rotations-denied.RLS | PASS | 403 |  |
| PROPOSE-01.member.RPC-save_team_rotation.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"You cannot manage rotations for this |  |
| PROPOSE-01.betaowner.RPC-save_team_rotation-AlphaTeam.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"You cannot manage rotations for this |  |
| PROPOSE-01.member.RPC-archive_team_rotation.RLS | PASS | 500 {"code":"P0002","details":null,"hint":null,"message":"Rotation not found"} |  |
| PROPOSE-01.betaowner.RPC-archive-AlphaRotation.RLS | PASS | 500 {"code":"P0002","details":null,"hint":null,"message":"Rotation not found"} |  |
| PROPOSE-01.owner.rotation-intact-after-denied-writes.API | PASS | archived=null |  |
| PROPOSE-01.owner.POST-proposal-Sunday-Band.API | PASS | 201 {"id":"7e6fdd37…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.admin.POST-proposal-Sunday-Band.API | PASS | 201 {"id":"d560f3e7…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.legacy.POST-proposal-Sunday-Band.API | PASS | 201 {"id":"e8e58ae4…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.scoped.POST-proposal-Sunday-Band.API | PASS | 201 {"id":"d80741bf…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.bandlead.POST-proposal-Sunday-Band.API | PASS | 201 {"id":"4d768b3b…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.member.POST-proposal-Sunday-Band.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.scoped.POST-proposal-Sunday-Production.API | PASS | 201 {"id":"a5df7344…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.bandlead.POST-proposal-Production-outofscope.API | PASS | 403 {"error":"You cannot schedule Production on QA Sunday 2027-02-07","code":"forbidden"} |  |
| PROPOSE-01.bandlead.POST-proposal-Band-Midweek.API | PASS | 201 {"id":"ce6d1609…","status":"draft","revision":0,"rule_version":"f06.f |  |
| PROPOSE-01.scoped.POST-proposal-Midweek-outofscope.API | PASS | 403 {"error":"You cannot schedule Production on QA Midweek 2027-02-10","code":"forbidden"} |  |
| PROPOSE-01.nonmember.POST-proposal.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| PROPOSE-01.anonymous.POST-proposal.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| PROPOSE-01.owner.proposal-validate-plans-empty.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"plan_ids","code":"too |  |
| PROPOSE-01.owner.proposal-validate-teams-empty.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"team_ids","code":"too |  |
| PROPOSE-01.owner.proposal-validate-plans-13.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"plan_ids","code":"too |  |
| PROPOSE-01.owner.proposal-validate-lookback-6.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"lookback_days","code" |  |
| PROPOSE-01.owner.proposal-validate-lookback-366.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"lookback_days","code" |  |
| PROPOSE-01.owner.proposal-validate-seed-bad.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"seed","code":"invalid |  |
| PROPOSE-01.owner.proposal-validate-seed-short.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"seed","code":"invalid |  |
| PROPOSE-01.owner.proposal-validate-malformed-plan.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"plan_ids.0","code":"i |  |
| PROPOSE-01.owner.proposal-validate-lock-and-exclude-same-in-create.API | FAIL | 201 {"id":"570e34d1…","status":"draft","revision":0,"rule_version":"f06.f | W2-STAFF-D6 recompute rejects this same combination with 422; create does not |
| PROPOSE-01.owner.proposal-BetaPlan.API | PASS | 404 {"error":"One of those plans is unavailable","code":"not_found"} |  |
| PROPOSE-01.owner.proposal-BetaTeam.API | PASS | 404 {"error":"One of those teams is unavailable","code":"not_found"} |  |
| PROPOSE-01.owner.proposal-unknown-rotation-id-ignored.API | PASS | 201 {"id":"a6b82c48…","status":"draft","revision":0," | observed 201 |
| PROPOSE-01.owner.same-seed-same-result.API | PASS | choices equal=true; input_hash equal=false (hash covers captured_at) |  |
| PROPOSE-01.owner.different-seed-recorded.API | PASS | seeds qa-determ-1,qa-determ-2; choices differ=true |  |
| PROPOSE-01.owner.proposal-choices-have-reasons.API | PASS | choices=6 reasoned=6 |  |
| PROPOSE-01.owner.proposal-choice-person-is-position-member.API | PASS | [["Drums","bandlead Qa","fairness"],["Camera","candb Qa","fairness"],["Keys","inactive Qa","fairness"],["Drums","canda Qa","fairness"],["Camera","Nora |  |
| PROPOSE-01.owner.proposal-excludes-archived.API | PASS | archived absent |  |
| PROPOSE-01.owner.proposal-inactive-member-eligible.API | PASS | inactive person choices=1 alternatives=1 | inspect: inactive-membership person is considered |
| PROPOSE-01.owner.proposal-no-assignments-created.API | PASS | no rows after create |  |
| PROPOSE-01.owner.proposal-two-positions-same-person-one-plan.API | PASS | no person proposed twice per plan |  |
| PROPOSE-01.owner.fairness-prefers-less-recently-served.API | PASS | Keys P1 choice=candb Qa (assigned 0); canda alternative assigned_count=1 |  |
| PROPOSE-01.owner.lookback-window-respected.API | PASS | lookback 7: chosen assigned_count=0 |  |
| PROPOSE-01.owner.recompute-lock-use-instead.API | PASS | status 200 chosen=canda Qa src=locked rev 0->1 |  |
| PROPOSE-01.owner.recompute-stale-revision.API | PASS | 409 {"error":"The proposal changed since you reviewed it","code":"proposal_changed"} |  |
| PROPOSE-01.owner.recompute-exclude.API | PASS | status 200 chosen=inactive Qa (was Gus Guest) |  |
| PROPOSE-01.owner.recompute-lock-and-exclude-same.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"edits.exclusions","co |  |
| PROPOSE-01.owner.recompute-edit-outside-proposal.API | PASS | 400 {"error":"A lock or exclusion is outside this proposal","code":"bad_request"} |  |
| PROPOSE-01.owner.recompute-lock-archived-person.API | PASS | 200; Keys choice=(none); vacancy=locked_choice_invalid | locked archived Person must not be proposed |
| PROPOSE-01.owner.recompute-lock-non-position-member.API | PASS | 200; Keys choice=(none); vacancy=locked_choice_invalid | locked person who does not hold the position must not be proposed |
| PROPOSE-01.admin.recompute-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.owner.no-candidates-returns-vacancy.API | PASS | Camera choice=none; vacancy=all_candidates_excluded; summary={"slots":3,"existing":0,"proposed":2,"vacant":1} (before Nora NoEmail) |  |
| PROPOSE-01.owner.GET-own-proposal.API | PASS | 200 {"id":"9a943381…","status":"d |  |
| PROPOSE-01.admin.GET-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.legacy.GET-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.bandlead.GET-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.scoped.GET-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.member.GET-owners-proposal.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forb |  |
| PROPOSE-01.betaowner.GET-owners-proposal.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| PROPOSE-01.admin.list-excludes-others-proposals.API | PASS | n=9 |  |
| PROPOSE-01.owner.list-max-10-drafts.API | PASS | n=10 |  |
| PROPOSE-01.member.list-proposals.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |  |
| PROPOSE-01.admin.PostgREST-select-owners-proposal.RLS | PASS | rows=0 |  |
| PROPOSE-01.member.PostgREST-select-proposals.RLS | PASS | rows=0 |  |
| PROPOSE-01.betaowner.PostgREST-select-proposals.RLS | PASS | rows=0 |  |
| PROPOSE-01.owner.PostgREST-select-own-proposal.RLS | PASS | rows=1 |  |
| PROPOSE-01.owner.GET-proposal-malformed-id.API | FAIL | 500 {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} | W2-STAFF-D4 wave1 D5 class |
| PROPOSE-01.owner.refresh-new-proposal-same-seed.API | PASS | 201 {"id":"19670efc…","status":"draft","revision":0," |  |
| PROPOSE-01.owner.refresh-supersedes-old.API | PASS | old status superseded |  |
| PROPOSE-01.owner.refresh-superseded-again.API | PASS | 409 {"error":"Only a draft proposal can be refreshed","code":"proposal_changed"} |  |
| PROPOSE-01.admin.refresh-owners-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-01.owner.rotation-slot-not-starved-by-fairness.API | FAIL | seed qa-c-rot: wk1 Keys=(vacant); vacancies=[["rotation_member_unavailable","already_chosen_on_plan","candb Qa"]] | W2-STAFF-D3 |
| PROPOSE-01.owner.proposal-uses-rotation-source.API | PASS | rotations=1 rotation choices=2 |  |
| PROPOSE-01.owner.rotation-week-pattern-applied.API | PASS | wk0 Keys=canda Qa/rotation, wk1 Keys=candb Qa/rotation; vacancies=[] |  |
| PROPOSE-02.owner.commit-with-vacancy-no-fabricated-assignment.API | PASS | commit 200; Camera rows=0; total rows=2 |  |
| PROPOSE-02.owner.commit-superseded-proposal.API | PASS | 409 {"error":"This proposal was replaced by a refreshed one","code":"proposal_stale"} |  |
| PROPOSE-02.owner.commit-superseded-persisted-none.API | PASS | none |  |
| PROPOSE-02.owner.commit-proposal.API | PASS | status 200 ids=6 proposed=6 |  |
| PROPOSE-02.owner.commit-persisted-prepared-unconfirmed.API | PASS | rows=6 vis=prepared |  |
| PROPOSE-02.owner.commit-matches-reviewed-choices.API | PASS | every reviewed choice persisted |  |
| PROPOSE-02.owner.commit-no-delivery-effects.API | PASS | effects 5->5 |  |
| PROPOSE-02.owner.commit-bumps-plan-revisions.API | PASS | 346,93->349,96 |  |
| PROPOSE-02.owner.proposal-status-committed.API | PASS | status committed |  |
| PROPOSE-02.canda.prepared-hidden-from-own-schedule.API | PASS | status 200; prepared ids visible=0 |  |
| PROPOSE-02.candb.prepared-hidden-from-own-schedule.API | PASS | status 200; prepared ids visible=0 |  |
| PROPOSE-02.member.plan-detail-no-prepared.API | PASS | prepared ids absent |  |
| PROPOSE-02.member.PostgREST-assignments-prepared-hidden.RLS | PASS | rows=0 |  |
| PROPOSE-02.canda.PostgREST-assignments-prepared-hidden.RLS | PASS | rows=0 |  |
| PROPOSE-02.bandlead.GET-committed-proposal-of-owner.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-02.owner.commit-replay-same-key-idempotent.API | PASS | status 200 rows=6 |  |
| PROPOSE-02.owner.commit-again-different-key.API | PASS | 409 {"error":"This proposal was already committed","code":"proposal_changed"} rows=6 |  |
| PROPOSE-02.owner.recompute-after-commit.API | PASS | 409 {"error":"This proposal is no longer a draft","code":"proposal_changed"} |  |
| PROPOSE-02.owner.refresh-after-commit.API | PASS | 409 {"error":"Only a draft proposal can be refreshed","code":"proposal_changed"} |  |
| PROPOSE-02.owner.committed-not-in-draft-list.API | PASS | excluded |  |
| PROPOSE-02.owner.commit-parallel-same-key.API | PASS | statuses=200,200,200,200,200,200 rows=6/6 distinctResults=1 |  |
| PROPOSE-02.owner.commit-parallel-different-keys-one-wins.API | PASS | statuses=200,409,409,409,409,409 rows=6/6 |  |
| PROPOSE-02.two-schedulers.parallel-commits-no-overfill.API | PASS | statuses=200,409 rows=6 (one proposal=6) dupPerson=false |  |
| PROPOSE-02.two-schedulers.second-commit-stale-after-first.API | PASS | 200/409 rows=6; second: 409 {"error":"Staffing changed since this proposal was computed. Refresh and review again. |  |
| PROPOSE-02.owner.commit-stale-revision.API | PASS | 409 {"error":"The proposal changed since you reviewed it","code":"proposal_changed"} rows=0 |  |
| PROPOSE-02.owner.commit-after-recompute-current-revision.API | PASS | 200 {"proposal_id":"b81159a0…","committed_at":"2026-1 |  |
| PROPOSE-02.owner.commit-honors-reviewer-exclusion.API | PASS | excluded person not scheduled for excluded slot |  |
| PROPOSE-02.owner.commit-after-membership-removed.API | PASS | 409 {"error":"Team membership changed since this proposal was computed. Refresh and review again.","code rows=0 |  |
| PROPOSE-02.owner.commit-after-person-archived.API | PASS | 409 {"error":"Team membership changed since this proposal was computed. Refresh and review again.","code rows=0 |  |
| PROPOSE-02.owner.commit-after-plan-staffing-changed.API | PASS | 409 {"error":"Staffing changed since this proposal was computed. Refresh and review again.","code":"prop rows=1 |  |
| PROPOSE-02.owner.commit-after-needs-changed.API | PASS | 409 {"error":"Staffing changed since this proposal was computed. Refresh and review again.","code":"prop rows=0 |  |
| PROPOSE-02.owner.commit-after-rotation-changed.API | PASS | 409 {"error":"A rotation changed since this proposal was computed. Refresh and review again.","code":"pr rows=0 |  |
| PROPOSE-02.owner.refresh-picks-up-new-rotation-version.API | FAIL | status 201 wk0 Keys=undefined | W2-STAFF-D3 |
| PROPOSE-02.owner.commit-after-rotation-archived.API | PASS | 409 {"error":"A rotation changed since this proposal was computed. Refresh and review again.","code" rows=0 |  |
| PROPOSE-02.owner.commit-new-conflict-rolls-back-everything.API | PASS | 409 {"error":"This Person is unavailable or already scheduled at that time","code":"scheduling_conflict" rows=0 |  |
| PROPOSE-02.owner.proposal-remains-draft-after-failed-commit.API | PASS | status draft |  |
| PROPOSE-02.scoped.setup-note.API | PASS | scoped proposal for Production on Sunday plan created ok |  |
| PROPOSE-02.owner.commit-expired-proposal.API | PASS | get.expired=true; commit 409 {"error":"This proposal expired. Refresh it to recompute from current staffing.","code; recompute 409 |  |
| PROPOSE-02.owner.refresh-expired-proposal-recomputes.API | PASS | 201 {"id":"50b56bad…","status":"draft","revision":0," |  |
| PROPOSE-02.scoped.commit-after-grant-revoked.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} rows=0 |  |
| PROPOSE-02.scoped.commit-after-regrant.API | PASS | 200 {"proposal_id":"fa7ab322…","committed_at":"2026-1 |  |
| PROPOSE-02.bandlead.commit-Band-proposal.API | PASS | 200 {"proposal_id":"72102fe5…","committed_at":"2026-1 |  |
| PROPOSE-02.legacy.commit-admins-proposal.API | PASS | 404 {"error":"Proposal not found","code":"not_found"} |  |
| PROPOSE-02.member.commit-proposal.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forb |  |
| PROPOSE-02.nonmember.commit-proposal.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} |  |
| PROPOSE-02.anonymous.commit-proposal.API | PASS | 401 {"error":"Invalid or expired session","code":"unauthorized"} |  |
| PROPOSE-02.admin.commit-short-idempotency-key.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"idempotency_key","cod |  |
| PROPOSE-02.legacy.RPC-commit-others-proposal.RLS | PASS | 500 {"code":"P0002","details":null,"hint":null,"message":"Proposal not found"} |  |
| PROPOSE-02.betaowner.RPC-commit-AlphaProposal.RLS | PASS | 500 {"code":"P0002","details":null,"hint":null,"message":"Proposal not found"} |  |
| PROPOSE-02.anonymous.RPC-commit.RLS | PASS | status 401 |  |
| PROPOSE-02.owner.proposal-never-proposes-inactive-member.API | FAIL | seed qa-inact-1 proposes inactive-membership Person; commit -> 400 {"error":"Some People, teams, positions or times do not belong to this plan","code" | W2-STAFF-D2 |
| PROPOSE-02.owner.PostgREST-patch-own-proposal-result.RLS | PASS | 200 rows=1 | observation: author may rewrite result column directly (granted); API re-verifies |
| PROPOSE-02.owner.API-commit-of-tampered-result-rejected.API | PASS | 409 {"error":"The stored proposal does not match its inputs. Recompute before committing.","code":"propo rows=0 |  |
| PROPOSE-02.owner.RPC-commit-of-tampered-result.RLS | PASS | 400 {"code":"22023","details":null,"hint":null,"message":"A person is proposed twice on one pl; forged choice persisted=0 | observation: direct RPC trusts stored result; limited to the author's own scheduling scope and membership/conflict reche |
| PROPOSE-02.owner.PostgREST-set-status-committed.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"Commit a proposal through commit_sta |  |
| PROPOSE-02.owner.PostgREST-extend-expiry.RLS | PASS | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |  |
| PROPOSE-02.admin.PostgREST-patch-owners-proposal.RLS | PASS | 200 rows=0 |  |
| PROPOSE-02.owner.PostgREST-delete-proposal-denied.RLS | PASS | 403 |  |
| PROPOSE-02.scoped.forged-proposal-Midweek-outofscope-RPC-commit.RLS | PASS | insert 201; commit 403 {"code":"42501","details":null,"hint":null,"message":"You can no longer schedule one of th; rows=0 |  |
| PROPOSE-02.member.PostgREST-insert-proposal.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security  |  |
| PROPOSE-02.betaowner.PostgREST-insert-proposal-AlphaOrg.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security  |  |
| PROPOSE-02.owner.PostgREST-insert-proposal-as-other-author.RLS | PASS | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security  |  |
| PROPOSE-02.scoped.forged-choice-outside-proposal-plan-RPC-commit.RLS | PASS | 400 {"code":"22023","details":null,"hint":null,"message":"A proposed choice is outside the rev; p3 rows=0 |  |
| PROPOSE-02.owner.forged-choice-BetaPerson-RPC-commit.RLS | PASS | 409 {"code":"PT409","details":null,"hint":"proposal_stale","message":"Team membership changed ; rows=0 |  |
| PROPOSE-02.proposal-vs-matrix-commit.race-consistent.API | PASS | proposal 409, matrix 200, rows=1 |  |
| WEB-D3-retest.member.POST-/staffing-matrix/query.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/staffing-matrix/preview.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/staffing-matrix/commit.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/staffing-matrix/views.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/staffing-matrix/views.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.DELETE-/staffing-matrix/views/:id.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/scheduling/proposals.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/scheduling/proposals.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/scheduling/proposals/:id.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/scheduling/proposals/:id/commit.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/scheduling/proposals/:id/recompute.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/scheduling/proposals/:id/refresh.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/rotations.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/rotations.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/rotations/:id.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.PUT-/rotations/:id.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.GET-/rotations/:id/preview.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |
| WEB-D3-retest.member.POST-/rotations/:id/archive.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code" |  |

## NOT_RUN / BLOCKED

| Case | Status | Reason |
|---|---|---|
| STAFF-01/PROPOSE-01 MAX_CANDIDATES=400 snapshot cap | NOT_RUN | Needs 400 position members; fixture generator not built (D17 volume dataset). |
| P-DST / P-OVERNIGHT time conflict cases (D06) | NOT_RUN | Datasets not built in this run. |
| Web/mobile UI (MOB-008, web matrix/proposals pages) | NOT_RUN | API/DB-only package; browser owned by another agent. |
| Secure-team eligibility status list for a populated roster | NOT_RUN | Secure Kids team has no members (membership insert requires current eligibility; fixture adds only the eligibility records). Fail-closed assignment behavior was tested through scheduling instead. |
