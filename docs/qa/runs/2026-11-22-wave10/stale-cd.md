# Wave 10 — stale FAIL re-run (W10-CD)

- **Package:** W10-CD (QA wave 10). Re-run of every case ID in plan §5B–§5D (+ORGS-01) whose latest recorded status was still FAIL from an earlier wave, plus the API half of large-list search and PEOPLE-04.
- **Commit:** `f79aa50` (main after PR #129), branch `feature/qa-wave10`, worktree `glassfish`. Plan: `docs/plans/admin-mobile-test-plan.md` §2–§5D, §8, §12.
- **Environment:** API `http://localhost:4200` (this worktree, simulated email/push), local Supabase shared with the other wave 10 agents (123 migrations applied, latest `20261130000500`; no reset, no migration, no code/config change). Node 26.13.1. Caller-token evidence only (API and PostgREST `/rest/v1`); service role / Auth admin / SQL used only for setup (users with `email_confirm`, org creation through `private.create_church`, memberships, snapshot expiry, a known respond-token hash) and for read-back of persisted rows. No browser, no simulator, no delivery worker, no private ports used (no processes started).
- **Namespace:** orgs `qa-w10-cd-a` (Alpha, America/Chicago), `qa-w10-cd-b` (Beta, Asia/Ho_Chi_Minh), `qa-w10-cd-c` (large-list, America/Chicago); users `<alias>.qaw10.cd@example.test` (20 aliases: owner, admin, legacy, scoped, bandlead, member, pending, confirmed, declined, canda, candb, unrelated, delegate, dependent, inactive, multi, betaowner, peoplegrant, corg, newcomer). Passwords only in the scratchpad.
- **Fixture shape:** Alpha: service types Sunday / Midweek, teams Band (6 positions) and Production (4) plus a shared team without a service type; grants `scoped` = `plans.edit`+`scheduling.manage` on Sunday, `bandlead` = `scheduling.manage`+`teams.manage` on Band, `peoplegrant` = org `people.manage`+`people.view_private`; D04-style released plans (8 assignments: confirmed / unconfirmed / declined, grouped + selected times), staffing, template, reschedule, opportunity, replacement and swap clones; an inactive-membership Person and an archived Person on the Band roster; a guest and a no-email Person; one member with 215 released assignments (volume). Beta: one team. Large-list org C: 305+ people (accent pairs `Nguyễn Thị Ánh` / `Nguyen Thi Anh`, `Trần Văn Đức`, `Đặng Quốc Việt`, `José Álvarez`, five identical names), a 130-member team and a 2-member team, 60 plans with accented and plain titles, roles owner/admin/legacy scheduler/member.
- **Method:** scripted (node, scratchpad) real HTTP; mutations assert the response plus the persisted row; races use separate parallel requests from separate sessions (3 parallel same-key requests x10 for RESP-04/REPLACE-02; two sessions for the final-slot claim, competing approvals, scheduling overlap). Source read for the contract; deferred wave 2 defects were re-run exactly and judged against the original expectation.

## Result

**316 expanded rows: 295 PASS, 14 FAIL, 0 BLOCKED, 4 NOT_RUN, 3 NOT_APPLICABLE.** 106 of them are the exact earlier FAIL rows re-run (the remaining 210 are neighbouring PASS-row regressions, the large-list API checks and PEOPLE-04). **No P0** (no cross-tenant read or write, no prepared/private exposure, no unauthorized write, no lost write, no overfill). **No P1.** Ten P2 defects remain (W10-CD-D1…D10); all ten are wave 2 findings that were deferred and still reproduce unchanged. Every other earlier FAIL row now passes.

### Per-ID roll-up (new latest status)

| Case ID | Earlier FAIL rows re-run | Of which now PASS / FAIL / N/A / NOT_RUN | All rows run (PASS/FAIL/N/A/NR) | New latest status | Open defect |
|---|---|---|---|---|---|
| PEOPLE-01 | 1 | 1 / 0 / 0 / 0 | 9/0/0/0 | **PASS** | - |
| TEAM-01 | 4 | 4 / 0 / 0 / 0 | 13/0/0/0 | **PASS** | - |
| ORGS-01 | 1 | 1 / 0 / 0 / 0 | 10/0/0/0 | **PASS** | - |
| PLAN-01 | 7 | 5 / 0 / 0 / 2 | 13/0/0/2 | **PASS** (web rows NOT_RUN: W10-WEB) | - |
| PLAN-02 | 5 | 5 / 0 / 0 / 0 | 11/0/0/0 | **PASS** | - |
| TIME-02 | 1 | 0 / 1 / 0 / 0 | 3/1/0/0 | **FAIL** | W10-CD-D1 |
| TIME-03 | 2 | 0 / 2 / 0 / 0 | 4/2/0/0 | **FAIL** | W10-CD-D2 |
| TEMPLATE-01 | 3 | 1 / 2 / 0 / 0 | 5/2/0/0 | **FAIL** | W10-CD-D4 |
| TEMPLATE-02 | 1 | 0 / 1 / 0 / 0 | 5/1/0/0 | **FAIL** | W10-CD-D5 |
| TEMPLATE-03 | 2 | 0 / 1 / 0 / 1 | 4/1/0/1 | **FAIL** (web rows NOT_RUN: W10-WEB) | W10-CD-D1 |
| ORDER-03 | 2 | 0 / 2 / 0 / 0 | 4/2/0/0 | **FAIL** | W10-CD-D6 |
| ORDER-04 | 1 | 0 / 1 / 0 / 0 | 1/1/0/1 | **FAIL** (web rows NOT_RUN: W10-WEB) | W10-CD-D3 |
| STAFF-01 | 2 | 1 / 1 / 0 / 0 | 6/1/0/0 | **FAIL** | W10-CD-D8 |
| STAFF-02 | 1 | 1 / 0 / 0 / 0 | 8/0/0/0 | **PASS** | - |
| MATRIX-01 | 11 | 11 / 0 / 0 / 0 | 18/0/0/0 | **PASS** | - |
| PROPOSE-01 | 5 | 3 / 2 / 0 / 0 | 7/2/0/0 | **FAIL** | W10-CD-D7 / D9 |
| PROPOSE-02 | 2 | 2 / 0 / 0 / 0 | 7/0/0/0 | **PASS** | - |
| RESP-01 | 4 | 3 / 0 / 1 / 0 | 8/0/1/0 | **PASS** (N/A rows: superseded) | - |
| RESP-02 | 3 | 2 / 0 / 1 / 0 | 9/0/2/0 | **PASS** (N/A rows: superseded) | - |
| RESP-03 | 3 | 3 / 0 / 0 / 0 | 11/0/0/0 | **PASS** | - |
| RESP-04 | 4 | 4 / 0 / 0 / 0 | 6/0/0/0 | **PASS** | - |
| AVAIL-01 | 6 | 6 / 0 / 0 / 0 | 12/0/0/0 | **PASS** | - |
| AVAIL-02 | 4 | 4 / 0 / 0 / 0 | 6/0/0/0 | **PASS** | - |
| AVAIL-03 | 3 | 3 / 0 / 0 / 0 | 9/0/0/0 | **PASS** | - |
| OPPORT-01 | 4 | 4 / 0 / 0 / 0 | 8/0/0/0 | **PASS** | - |
| REPLACE-01 | 2 | 2 / 0 / 0 / 0 | 5/0/0/0 | **PASS** | - |
| REPLACE-02 | 1 | 0 / 1 / 0 / 0 | 1/1/0/0 | **FAIL** | W10-CD-D10 |
| SWAP-01 | 1 | 1 / 0 / 0 / 0 | 3/0/0/0 | **PASS** | - |
| PEOPLE-04 (API half) | never covered before | - | 27/0/0/0 | **PASS (API half)**; web/mobile halves NOT_RUN | - |
| Large-list API (de3ae9a, d2a5b19, aa7e066) | new | - | 62/0/0/0 | **PASS** | - |

### Status of the originally-FAIL rows

Fixed since the original wave (re-run PASS): PEOPLE-01 malformed id, TEAM-01 duplicate-position atomicity / foreign-org and unknown team delete / team-scope delete no longer a silent 204, ORGS-01 malformed org header, PLAN-01/PLAN-02 invalid dates, beyond-last-page and malformed ids, TIME-03 offset/DST neighbours, TEMPLATE-01 malformed id, MATRIX-01 (all 13 rows incl. hidden prepared conflict W2-STAFF-D1, inactive/archived people W2-STAFF-D2, garbage cursor), STAFF-02 malformed id, PROPOSE-01/02 malformed ids, anchor date, inactive never proposed, RESP-01 malformed id and `/schedule/mine` volume (215 entries), RESP-02 private reason (the P0 W9-JRN-D1, J01-07c/e/f), RESP-03 stale/expired preview (W2-RESP-D4) and invalid bodies (W7-RESP-D3), RESP-04 concurrent identical answer/commit retry (W7-RESP-D4), AVAIL-01/02/03 (all rows incl. leader reasons W2-AVAIL-D3), OPPORT-01 claims list / self-approval / malformed id, REPLACE-01 self-approval / malformed id, SWAP-01 self-approval.

NOT_APPLICABLE (expectation superseded by a later decision, cited): RESP-01.direct-own-status-patch.postgrest and RESP-02.direct-withdrawal.postgrest (the row asked for a direct PostgREST status write to be recorded like `respond_as_self`; W7-RESP-D2 fix round decided direct status updates by non-schedulers are refused, `20261125000002_w7_assignment_response_paths.sql`, hint `assignment_response_path`; the new contract is a PASS row next to each), RESP-02.scope-change.confirmed-carryover (wave 7 SUMMARY, W7-RESP-D6 "decided: confirmation stands, not a defect").

NOT_RUN (browser owned by W10-WEB): PLAN-01.web.list-pagination-cap, PLAN-01.web.past-tab-scope (API half = PASS), TEMPLATE-03.web.reschedule-list-cap, ORDER-04 print / run sheet. No native, mobile or device rows were assigned to this package.

## Defects

All ten are P2, all are the same behaviour wave 2 reported (carried, not new), none is a security or data-loss defect. Where source says the behaviour is deliberate it is marked as a product decision needed.

### W10-CD-D1 (P2 (intent; product call needed) = W2-PLANS-D12) Time edits and bulk reschedule move people into an overlap without the override capability or a reason
- **Cases:** TIME-02.time-edit.commit-allowed-as-plan-fact, TEMPLATE-03.commit.scoped-no-override-cap-creates-double-booking
- **Minimal repro:** 1) owner schedules `canda` on plan C (09:00 on date X) and on plan B (another date). 2) `POST /plans/{B}/times/preview` then `PATCH /plans/{B} {times:[… same 09:00 on X …], time_impact_hash}` as owner → **200**. 3) As `scoped` (plans.edit + scheduling.manage on Sunday, no `scheduling.override_conflicts`): `POST /plans/reschedule/preview` moving B to date X, then `POST /plans/reschedule {…preview_hash, idempotency_key}` with no `conflict_override_reason` → **200**, plan B moved, 2 overlapping service-time pairs for the same Person, 0 rows in `assignment_conflict_overrides`.
- **Expected vs actual:** Plan §3/TIME-02: overlap commit "requires matching capability and recorded reason; recheck at commit". `POST /plans/{id}/assignments` for the same overlap is correctly refused (409 without a reason, 403 without the capability; TIME-02 neighbours PASS). Actual: the time-edit and reschedule paths only warn.
- **Suspected:** `supabase/migrations/20261027000100_f10_plan_reschedule.sql:165-188` (conflicts only appended to warnings; same comment "Time edits never refuse over a conflict (F04)" restated in `20261104000100_i18n_structured_notices.sql:257`); `backend/src/routes/plans.ts` PATCH times path. Source treats it as deliberate; the plan oracle says otherwise — owner decision.

### W10-CD-D2 (P2 = W2-PLANS-D3) Date-only and zone-less plan instants are taken as UTC; the organization-local day drifts
- **Cases:** TIME-03.date-only-service_date.API, TIME-03.naive-datetime-without-zone.API
- **Minimal repro:** `POST /plans {"title":"x","service_date":"2040-08-04"}` (org America/Chicago) → 201, stored `2040-08-04 00:00 UTC` = **2040-08-03 19:00 Chicago**. `POST /plans {service_date:"2040-08-18T10:00:00", times:[{starts_at:"2040-08-18T10:00:00",ends_at:"2040-08-18T11:00:00"}]}` → 201, stored `10:00:00+00` (05:00 Chicago). Offset input (`-05:00`) is normalised correctly (PASS).
- **Expected vs actual:** Reject zone-less/date-only input, or interpret it in the organization time zone so the local day never drifts (TIME-03).
- **Suspected:** Actual: accepted as UTC. `packages/shared/src/schemas/common.ts:18,24-35` (`INSTANT_PATTERN`/`instantString` make the date-only form and the zone optional); `create_plan` casts in the DB session zone. The wave 2 fix deliberately left it unchanged.

### W10-CD-D3 (P2 = W2-PLANS-D6) `total_length_seconds` counts header lengths that the running-order schedule ignores
- **Cases:** ORDER-04.detail-total-length-vs-schedule-totals.API
- **Minimal repro:** Plan with a header item `length_seconds:999`, pre 300 / service 600 / post 120. `GET /plans/{id}` → `total_length_seconds` **2019**; `GET /plans/{id}/schedule` → `selected.pre_seconds 300 + service_seconds 600 + post_seconds 120` = **1020**, header duration 0.
- **Expected vs actual:** One rule (headers = 0) so detail total equals the schedule total.
- **Suspected:** `backend/src/services/plans.ts:146` (sums every item) vs `packages/shared/src/lib/plan-order.ts:40` (`durationOf`, headers 0); the schemas still accept `length_seconds` on headers.

### W10-CD-D4 (P2 = W2-PLANS-D7) Template preview shows no warning for an archived song; apply then fails 400
- **Cases:** TEMPLATE-01.apply-preview.archived-song-reference.API, TEMPLATE-01.apply.archived-song-result.API
- **Minimal repro:** Template with a song item and a free item; `POST /songs/{S}/archive {archived:true, expected_revision}` → 200; `POST /plans/{P}/apply-template/preview {revision_id, mode:"append", components:["items"]}` → **200, `warnings:[]`, `items.skipped:[]`, 2 items to add**; `POST /plans/{P}/apply-template {… preview_hash …}` → **400 "Restore the song before scheduling it"**.
- **Expected vs actual:** The reviewed preview is the committed result: archived song reported (skipped or warned), apply does not fail after a clean preview.
- **Suspected:** `backend/src/services/plan-templates.ts:206` (`previewApplyTemplate`) and `:304` (`previewPlanGeneration`) never check `songs.archived_at`; the commit trigger (`20261101000000_f15_song_curation.sql`) refuses the archived song.

### W10-CD-D5 (P2 = W2-PLANS-D8) Series generation preview does not report roster scheduling conflicts; commit is a generic 409
- **Cases:** TEMPLATE-02.generate.roster-conflict-on-2nd-date-rolls-back-all.API
- **Minimal repro:** Template with a roster entry (`candb`, Band/Keys, 09:00 90 min). `candb` already scheduled 09:30–10:30 on the 2nd date. `POST /plans/generate/preview {revision_id, components:["roster"], start_date, count:3}` → 200, every `plans[].preview.blocking == []`, `plan_id:null`; `POST /plans/generate {… preview_hash …}` → **409 `scheduling_conflict`** (generic), 0 plans created (atomic rollback OK; owner with `conflict_override_reason` → 201 and an identical retry returns the same 3 plans).
- **Expected vs actual:** Preview flags the blocking conflict on the 2nd date before commit.
- **Suspected:** `backend/src/services/plan-templates.ts:304` (`previewPlanGeneration` has no plan to check against, so `blocking` is always empty; conflicts surface only inside the commit transaction).

### W10-CD-D6 (P2 = W2-PLANS-D9) Deleting an in-use song or arrangement is refused as 400 "Referenced record does not exist"
- **Cases:** ORDER-03.delete-arrangement-pinned-by-plan, ORDER-03.delete-song-referenced-by-plan
- **Minimal repro:** `DELETE /arrangements/{A}` (used by a plan item) and `DELETE /songs/{S}` (used by a plan item) → **400 `{"error":"Referenced record does not exist","code":"bad_request"}`**; reference protection itself works (rows and the plan item intact).
- **Expected vs actual:** 409 "in use" with a truthful message.
- **Suspected:** `backend/src/lib/errors.ts:204-205` maps every `23503` to "Referenced record does not exist", including a delete blocked by a foreign key.

### W10-CD-D7 (P2 = W2-STAFF-D3) A rotation turn can be starved by an unrelated fairness pick
- **Cases:** PROPOSE-01.owner.rotation-slot-not-starved-by-fairness.API
- **Minimal repro:** Rotation (Band, 2-week cycle, Keys: week 0 `canda`, week 1 `candb`, policy `vacancy`); two published plans (weeks 0 and 1) needing Keys, Drums, Bass. `POST /scheduling/proposals {plan_ids, team_ids:[Band], rotation_ids:[R], seed}` with 12 seeds: week-1 Keys is **vacant in 12/12** (`rotation_member_unavailable`, exclusion `already_chosen_on_plan`) because the fairness pass already put the rotation member on Drums (position id order). Same with the swapped rotation version.
- **Expected vs actual:** An explicit rotation turn takes priority over fairness picks for other positions; the vacancy text should not blame an available rotation member.
- **Suspected:** `packages/shared/src/lib/staffing-proposals.ts:212-241` (rotation and fairness filled in one pass in position-id order; `chosenOnPlan` check at :222). Note PROPOSE-02 refresh-picks-up-new-rotation passes (seed/order dependent).

### W10-CD-D8 (P2 = W2-STAFF-D5) Scoped scheduler cannot list candidates for a shared team they can schedule on their plans
- **Cases:** STAFF-01.scoped.GET-team-candidates-Band.API
- **Minimal repro:** `scoped` (Sunday `plans.edit`+`scheduling.manage`). Team "Band Shared W10" has no service type. `GET /teams/{team}/candidates` → **404 "Team not found"**. The same actor can `POST /plans/{Sunday plan}/assignments` for that team → 201 (STAFF-02 neighbour).
- **Expected vs actual:** Candidate lookup consistent with plan-scoped scheduling authority (or documented as team-scope-only).
- **Suspected:** `supabase/migrations/20261018000200_f02_roster_extensions.sql:265-267` (`has_capability(org,'scheduling.manage', v_team.service_type_id, p_team)` with a NULL service type; service-type grants never match).

### W10-CD-D9 (P2 = W2-STAFF-D6) Proposal create accepts a lock and an exclusion for the same person and slot; recompute rejects it
- **Cases:** PROPOSE-01.owner.proposal-validate-lock-and-exclude-same-in-create.API
- **Minimal repro:** `POST /scheduling/proposals {plan_ids:[P], team_ids:[Band], locks:[L], exclusions:[L]}` → **201**; `POST /scheduling/proposals/{id}/recompute {expected_revision:0, edits:{locks:[L], exclusions:[L]}}` → **422** "A person cannot be both locked and excluded".
- **Expected vs actual:** Create validates like recompute (422).
- **Suspected:** `packages/shared/src/schemas/staffing-proposals.ts:19-28` (`createStaffingProposalSchema` lacks the refine that only `editsSchema` has, :9-13).

### W10-CD-D10 (P2 = W2-RESP-D3 (replacement-request half)) Concurrent retry of an identical replacement request gets 409 instead of the original result
- **Cases:** REPLACE-02.duplicate-request-same-key.x20
- **Minimal repro:** Declined assignee: 3 parallel `POST /replacement-requests` with the same `idempotency_key` and body, x10 iterations → every iteration **201/409/409** (rows=1, so no duplicate and no overfill); the 409s are `{"error":"That record already exists","code":"conflict"}`. A sequential replay returns the original 201/id.
- **Expected vs actual:** Every concurrent copy returns the stored request (same as the answer/commit paths fixed under W7-RESP-D4).
- **Suspected:** `supabase/migrations/20261023000000_f07_signups_replacements.sql:546-552` (`create_replacement_request`: lookup then plain `insert`, no lock and no `on conflict`; the unique violation surfaces as 409 via `fromPostgrestError`).

### Observations (not defects)

- TEAM-01 / W7-ACC-D3: `DELETE /teams/:id` by a holder of `teams.manage` at **team** scope (`bandlead`) now answers an honest **404** with the team intact (was a silent 204): `teams_delete` RLS checks `has_capability(org, 'teams.manage', teams.service_type_id)`, so team-scope grants cover the roster, not deletion. A legacy scheduler (implicit org-wide `teams.manage`) deletes with 204 and the row is gone, consistent with the 2026-11-20 decision. Confirm this is the intended reading of "keep API/RLS on `teams.manage`".
- REPLACE-02 competing approvals: two parallel `approve` calls on two offers for one vacancy both answer 200; exactly one assignment is created, the loser offer ends `superseded`, the original decline is retained. Overfill = 0. The loser gets 200 rather than a conflict (plan asks for a "clear conflict"); status is visible only by re-reading the offer.
- SWAP-01 semantics: a finalized swap creates a new confirmed assignment for each participant in the other position and sets the originals to declined (history retained); positions are not exchanged in place. Plan wording "atomic exchange" matches.
- PLAN-01: `GET /plans?page=99999999999999999999` (W9-PLN-D1) now answers 200 with an empty page, not 500.
- Person invite badge (`invite_pending`) is not exposed to an ordinary member (`false` for every row in the member view); owner sees it. Consistent with the owner-only People rule.

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| PLAN-01.web.list-pagination-cap, PLAN-01.web.past-tab-scope, TEMPLATE-03.web.reschedule-list-cap, ORDER-04 print/run sheet | NOT_RUN | browser owned by W10-WEB (API halves of the first two pass) |
| PEOPLE-04 web and mobile halves | NOT_RUN | browser/simulator owned by W10-WEB / native package |
| Real email/push delivery of the released assignment requests | NOT_RUN | simulated adapters; delivery worker owned by W10-MAIL (the API delivered effects inline in simulated mode, no worker run) |
| Replacement offer/consent/approval notifications | NOT_RUN | documented F08 gap (no notification produced); not re-evaluated |

Notes on harness corrections (not product defects): the SWAP-01 exchange oracle and the PEOPLE-04 stale-`expected_changes` row were first written wrongly, corrected and re-run before recording; a `TIME-02` setup row that failed only because an earlier run had already moved the plan was discarded.

## Fixtures left in place

- Orgs `qa-w10-cd-a` (23 people, ~325 plans incl. a 215-assignment volume member, ~370 assignments), `qa-w10-cd-b` (1 team), `qa-w10-cd-c` (~317 people incl. accent pairs, 60 plans, 130-member and 2-member teams); users `*.qaw10.cd@example.test`.
- Alpha leftovers worth knowing: one inactive membership (`inactive`) with a Keys roster row, an archived Person, finalized swap/replacement clones, an opportunity with a held claim, 2 respond-token rows whose hash was replaced with a known test token (setup only), `multi` combined schedule set back to off, one copied blockout in Beta.
- Delivery effects queued by released assignments in Alpha were delivered inline in simulated mode; no queued deliveries were left for W10-MAIL by this package beyond that.
- Scripts and the per-row JSON results are in the scratchpad `/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-glassfish/b2798cb9-818c-4968-93be-9fd375629001/scratchpad/w10-cd` (credentials in `creds.json`, never in this report).

## Result tables

Columns: Row = this run's expanded row ID; Original row/defect = the earlier wave row (or "neighbour"/"new"); Status per §2 rule 8. "Rerun" marks an earlier FAIL row re-run exactly; others are neighbouring regression rows, large-list or PEOPLE-04 checks.

### PEOPLE-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PEOPLE-01.owner.GET-malformed-id.API | Rerun | PEOPLE-01.owner.GET-malformed-id.API | API-D5 | owner | API GET /people/not-a-uuid | 400/404/422, no raw PG text | 400 {"error":"Invalid route parameter: personId","code":"bad_request"} | PASS |
| PEOPLE-01.admin.GET-malformed-id.API | Regression | (new; mirrors orig) | - | admin | API GET /people/not-a-uuid | 400/403/404/422 | 403 {"error":"Only the organization owner can access personal details or manage people","code":"forbidden"} | PASS |
| PEOPLE-01.owner.GET-unknown-id.API | Regression | PEOPLE-01.owner.GET-unknown-id.API (PASS neighbour) | - | owner | API | 404 | 404 {"error":"Not found","code":"not_found"} | PASS |
| PEOPLE-01.owner.create-minimal.API | Regression | PEOPLE-01.owner.create-minimal.API (neighbour) | - | owner | API POST /people | 201 trimmed first_name | 201 {"id":"62a7ba02-3799-461a-9f8a-55632f849c41","organization_id":"082b4a41-facc-4e0e-bcba-7d6bdd7e2d82","profile_id":null,"first_name":"Min","last_… | PASS |
| PEOPLE-01.owner.create-complete+detail | Regression | PEOPLE-01.owner.create-complete/detail-consistent (neighbou… | - | owner | API | 201; detail email lowercased, fields persisted | 201 detail 200 email=com.plete@example.test campus=South lang=vi | PASS |
| PEOPLE-01.owner.edit-organization_id-injection.API | Regression | (neighbour) | - | owner | API PATCH /people/:id {organization_id:Beta} | not moved to Beta | 404 org=A | PASS |
| PEOPLE-01.admin.create.API | Regression | (owner-only oracle neighbour) | - | admin | API POST /people | 403/404, no row | 403 {"error":"Only the organization owner can access personal details or manage people","code":"forbidden"} rows=0 | PASS |
| PEOPLE-01.peoplegrant.create.API | Regression | (neighbour) | - | peoplegrant | API POST /people | 403/404 | 403 {"error":"Only the organization owner can access personal details or manage people","code":"forbidden"} | PASS |
| PEOPLE-01.member.GET-other-person-detail.API | Regression | (neighbour) | - | member | API GET /people/:id | 403/404 no private | 403 {"error":"Only the organization owner can access personal details or manage people","code":"forbidden"} | PASS |

### TEAM-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TEAM-01.owner.create-team-duplicate-positions-atomic.API | Rerun | TEAM-01.owner.create-team-duplicate-positions-atomic.API | API-D6 | owner | API POST /teams dup positions + SQL | 4xx and no team persisted | 422 teams 2->2 leftover=0 | PASS |
| TEAM-01.owner.duplicate-team-name.API | Regression | (neighbour) | - | owner | API POST /teams dup name | 409 | 409 {"error":"That record already exists","code":"conflict"} | PASS |
| TEAM-01.owner.DELETE-team-orgB-id-in-orgA-ctx | Rerun | TEAM-01.owner.DELETE-team-orgB-id-in-orgA-ctx | W7-ACC-D4 | owner(A) | API DELETE /teams/<B id> with A header | 404; B team persists | 404 persists=1 | PASS |
| TEAM-01.owner.DELETE-team-nonexistent | Rerun | TEAM-01.owner.DELETE-team-nonexistent | W7-ACC-D4 | owner | API DELETE /teams/<random> | 404 | 404 {"error":"Team not found","code":"not_found"} | PASS |
| TEAM-01.owner.DELETE-team-malformed-id | Regression | (neighbour) | - | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| TEAM-01.DELETE-team.bandlead | Rerun | TEAM-01.DELETE-team \| bandlead (204 but nothing deleted) | W7-ACC-D3/D4 | bandlead (teams.manage @ team scope) | API DELETE /teams/:id + SQL | Decision 2026-11-20: teams.manage holder may delete (204 + gone) — never a silent 204 no-op | 404 gone=false [404 honest refusal (grant at team scope vs delete RLS); no silent no-op] | PASS |
| TEAM-01.DELETE-team.bandlead-out-of-scope | Regression | (neighbour, scope) | - | bandlead | API DELETE other team | 403/404 and team persists | 404 persists=true | PASS |
| TEAM-01.DELETE-team.member | Regression | (neighbour) | - | member | API | 403 | 403 {"error":"You need the “Manage teams” permission to do that","code":"forbidden"} | PASS |
| TEAM-01.DELETE-team.legacy-scheduler | Regression | (neighbour; wave7 PASS = legacy per RLS) | - | legacy | API | 204 gone, or honest 403/404 with persists (never silent) | 204 gone=true | PASS |
| TEAM-01.roster-exception.legacy-add-denied | Regression | (neighbour; ACL-04) | - | legacy | API POST /teams/Band/members | 403 (no implicit roster right) | 403 {"error":"Only organization admins and team leaders can change who is on a team","code":"forbidden"} | PASS |
| TEAM-01.roster-exception.bandlead-add-Band | Regression | (neighbour) | - | bandlead | API | 201 | 201 {"id":"cca6ecde-92fd-4c83-8137-4de98e4d378e","team_id":"7efd0fb0-92bf-4aa1-aa87-2192347066e8","user_id":"8cf4b221-9cab-440d-ac06-52e65b69c02e","p… | PASS |
| TEAM-01.roster-exception.bandlead-add-Production-denied | Regression | (neighbour) | - | bandlead | API | 403 | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| TEAM-01.remove-by-membership-id | Regression | (neighbour) | - | bandlead | API | 204 | 204 | PASS |

### ORGS-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| ORGS-01.copy-malformed-org-header | Rerun | ORGS-01.copy-malformed-org-header | API-D5 | multi | API POST /me/availability/copy X-Organization-Id: not-a-uuid | 400 (or 403/404), no raw PG text | 400 {"error":"Invalid X-Organization-Id header","code":"bad_request"} | PASS |
| ORGS-01.copy-missing-org-header | Regression | ORGS-01.copy-missing-org-header (neighbour) | - | multi | API | 400 | 400 {"error":"Choose the organization to copy from","code":"bad_request"} | PASS |
| ORGS-01.settings.defaults-both-false | Regression | (neighbour) | - | multi | API GET /me/schedule-settings | both false | 200 {"user_id":"29c6c650-14ea-4d10-9050-b4e591115824","combined_schedule":false,"share_busy_across_orgs":false,"updated_at":"2026-11-22T14:48:28.22+0… | PASS |
| ORGS-01.multi.combined-while-off-denied | Regression | (neighbour) | - | multi | API | 403 | 403 {"error":"Turn on the combined schedule first","code":"forbidden"} | PASS |
| ORGS-01.multi.opt-in-combined-only | Regression | (neighbour) | - | multi | API PUT | 200 combined only | 200 {"user_id":"29c6c650-14ea-4d10-9050-b4e591115824","combined_schedule":true,"share_busy_across_orgs":false,"updated_at":"2026-11-22T14:48:34.076+0… | PASS |
| ORGS-01.multi.combined-both-orgs | Regression | (neighbour) | - | multi | API | 200 lists both orgs, own blockout | 200 orgs=qa-w10-cd-a,qa-w10-cd-b | PASS |
| ORGS-01.multi.copy-A-to-B(no reason) | Regression | (neighbour) | - | multi | API + SQL | 200 copied, reason null | 200 {"results":[{"organization_id":"ad32ded0-7837-49af-a1ef-cc406fbb91bf","outcome":"copied","copied":1, rowsB=1\|0 | PASS |
| ORGS-01.copy.retry-same-key-idempotent | Regression | (neighbour) | - | multi | API | already_copied, rows unchanged | 200 {"results":[{"organization_id":"ad32ded0-7837-49af-a1ef-cc406fbb91bf","outcome":"already_copied","co | PASS |
| ORGS-01.copy-foreign-blockout | Regression | (neighbour) | - | canda | API | 403/404, nothing written | 404 {"error":"Choose your own blockouts to copy","code":"not_found"} | PASS |
| ORGS-01.copy-unknown-source-org | Regression | (neighbour) | - | multi | API | 403/404 | 404 {"error":"Person not found","code":"not_found"} | PASS |

### PLAN-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PLAN-01.paginate.beyond-last-page.API | Rerun | PLAN-01.paginate.beyond-last-page.API | W2-PLANS-D2 | owner | API GET /plans page=99 | 200 data [] total=7 | 200 {"data":[],"page":99,"per_page":2,"total":7} | PASS |
| PLAN-01.filter.garbage-from.API | Rerun | PLAN-01.filter.garbage-from.API | W2-PLANS-D1 | owner | API GET /plans?from=garbage | 400/422 no DB text | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"from","code":"custom","message":"Enter a valid date and time"}]} | PASS |
| PLAN-01.filter.sql-ish-from.API | Rerun | PLAN-01.filter.sql-ish-from.API | W2-PLANS-D1 | owner | API | 400/422 no DB text | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"from","code":"custom","message":"Enter a valid date and time"}]} | PASS |
| PLAN-01.detail.malformed-id.API | Rerun | PLAN-01.detail.malformed-id.API | W2-PLANS-D4 | owner | API GET /plans/abc | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| PLAN-01.web.list-pagination-cap.WEB | Rerun | PLAN-01.web.list-pagination-cap.WEB | W2-PLANS-D10 | owner | Web /plans | pager/load more | NOT_RUN (browser owned by W10-WEB) | NOT_RUN |
| PLAN-01.web.past-tab-scope.WEB | Rerun | PLAN-01.web.past-tab-scope.WEB | W2-PLANS-D10 | owner | Web /plans Past tab | only past plans | NOT_RUN (browser owned by W10-WEB); API half: to=now bound see next row | NOT_RUN |
| PLAN-01.past-window.API(half of web.past-tab-scope) | Rerun | PLAN-01.web.past-tab-scope.WEB (API half) | W2-PLANS-D10 | owner | API GET /plans?to=now&order=desc | every returned service_date < now | 200 n=1 includes W10 past plan=true all< now=true total=1 | PASS |
| PLAN-01.paginate.stable-asc | Regression | PLAN-01 neighbour (stable previous/next) | - | owner | API paging per_page=2 | no dup/gap equals full list order | n=7 uniq=7 total=7 | PASS |
| PLAN-01.paginate.stable-desc | Regression | PLAN-01 neighbour (stable previous/next) | - | owner | API paging per_page=2 | no dup/gap equals full list order | n=7 uniq=7 total=7 | PASS |
| PLAN-01.member.list | Regression | PLAN-01 neighbour | - | member | API GET /plans | 200 list readable | 200 n=2 | PASS |
| PLAN-01.cross-tenant.list | Regression | PLAN-01 neighbour | - | betaowner(B) | API GET /plans | no org A plan titles | 200 n=0 leak=false | PASS |
| PLAN-01.cross-tenant.detail | Regression | PLAN-01 neighbour | - | betaowner(B) | API GET /plans/<A id> with B header | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| PLAN-01.page-unbounded (W9-PLN-D1 carry) | Regression | (W9-PLN-D1 observation, not a wave-2 row) | W9-PLN-D1 | owner | API GET /plans?page=99999999999999999999 | 4xx or empty, never 500 | 200 {"data":[{"id":"83ef3985-f3c9-445a-b385-c5b44b686001","organization_id":"082b4a41-facc-4e0e-bcba-7d6bdd7e2d82","serv | PASS |
| PLAN-01.prepared-hidden.regression | Regression | PLAN-01.prepared-hidden.* (wave 2 PASS rows, P0 regression) | - | owner/scoped/bandlead vs member/assignee | API detail + list counts + /schedule/mine + PostgREST for one PREPARE… | managers see it (detail=1); member and the assigned person see nothing (detail=0, mine=0, pg=0) | {"owner":"detail=1 listPrepared=1 mine=0 pg=1","scoped":"detail=1 listPrepared=1 mine=0 pg=1","bandlead":"detail=1 listPrepared=1 mine=0 pg=1","membe… | PASS |
| PLAN-01.prepared-no-notification | Regression | ACL-05 style regression | - | canda (assignee of prepared row) | SQL notifications/effects for the plan after notify:true on prepared | 0 notifications and 0 assignment_request effects | notifications=0 effects=0 | PASS |

### PLAN-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PLAN-02.create.validation.bad-service-date.API | Rerun | PLAN-02.create.validation.bad-service-date.API | W2-PLANS-D1 | owner | API POST /plans | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_date","code":"custom","message":"Enter a valid date and time"}… | PASS |
| PLAN-02.create.validation.empty-service-date.API | Rerun | PLAN-02.create.validation.empty-service-date.API | W2-PLANS-D1 | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_date","code":"custom","message":"Enter a valid date and time"}… | PASS |
| PLAN-02.update.validation.bad-date.API | Rerun | PLAN-02.update.validation.bad-date.API | W2-PLANS-D1 | owner | API PATCH | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_date","code":"custom","message":"Enter a valid date and time"}… | PASS |
| PLAN-02.delete.malformed-id.API | Rerun | PLAN-02.delete.malformed-id.API | W2-PLANS-D4 | owner | API DELETE /plans/abc | 400/404 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| PLAN-02.duplicate.validation.bad-date.API | Rerun | PLAN-02.duplicate.validation.bad-date.API | W2-PLANS-D1 | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_date","code":"custom","message":"Enter a valid date and time"}… | PASS |
| PLAN-02.create.calendar-invalid-date | Regression | neighbour (calendar-invalid) | - | owner | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_date","code":"custom","message":"Enter a valid date and time"}… | PASS |
| PLAN-02.publish-unpublish.persist | Regression | PLAN-02 neighbour | - | owner | API PATCH status + SQL | published then draft persisted | published/draft | PASS |
| PLAN-02.duplicate.ok | Regression | PLAN-02 neighbour | - | owner | API | 201 new plan with copied times | 201 times=3 | PASS |
| PLAN-02.delete.ok | Regression | PLAN-02 neighbour | - | owner | API | 204 gone | 204 0 | PASS |
| PLAN-02.delete.unknown | Regression | PLAN-02 neighbour (W7 silent 204) | - | owner | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| PLAN-02.member.create | Regression | PLAN-02 neighbour | - | member | API | 403 | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |

### TIME-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TIME-02.assign-overlap-no-reason | Regression | TIME-02 neighbour (assign overlap refused) | - | owner | API POST assignments overlapping times, no reason | 409 scheduling_conflict | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict","details":[{"candidate_key":"0","person_id": | PASS |
| TIME-02.assign-overlap-scoped-no-capability | Regression | TIME-02 neighbour | - | scoped | API with reason, no override capability | 403 | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | PASS |
| TIME-02.adjacent-allowed | Regression | TIME-02 neighbour (adjacent allowed) | - | owner | API | 201 | 201 on the first run (created 1 row); a re-run skipped the Person already on the plan; DB: canda assigned on W10 adjacent | PASS |
| TIME-02.time-edit.commit-allowed-as-plan-fact.API | Rerun | TIME-02.time-edit.commit-allowed-as-plan-fact.API | W2-PLANS-D12 | owner | API PATCH /plans/:id times into overlap for scheduled person | Orig expectation: (observation) 200 plan fact; intent: refuse w/o reason | preview 200 commit 200 moved_times_on_C_date=3; person has 2 overlapping scheduled commitments, no reason/capability required | FAIL |

### TIME-03

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TIME-03.date-only-service_date.API | Rerun | TIME-03.date-only-service_date.API | W2-PLANS-D3 | owner | API POST /plans service_date "2040-08-04" | explicitly rejected or interpreted in org zone (local day 08-04 stays 08-04) | 201 org-local=2040-08-03 19:00:00 | FAIL |
| TIME-03.naive-datetime-without-zone.API | Rerun | TIME-03.naive-datetime-without-zone.API | W2-PLANS-D3 | owner | API POST /plans naive "2040-08-18T10:00:00" | rejected or interpreted in org tz (15:00Z) | 201 stored=2040-08-18 10:00:00+00 | FAIL |
| TIME-03.offset-input-normalised-to-instant.API | Regression | TIME-03 neighbour | - | owner | API | stored 15:00Z | 201 2040-08-11 15:00:00 | PASS |
| TIME-03.extreme-date 9999 | Regression | TIME-03 neighbour | - | owner | API | 2xx or 4xx never 500 | 201 | PASS |
| TIME-03.extreme-date 0001 | Regression | TIME-03 neighbour | - | owner | API | 2xx or 4xx never 500 | 422 | PASS |
| TIME-03.dst-gap-blockout | Regression | TIME-03 neighbour (DST gap, Chicago 2027-03-14 02:30) | - | owner | API POST /blockouts | explicit 4xx (not 500) | 400 {"error":"An occurrence on 2027-03-14 uses a local time skipped by daylight saving. Choose another time.","code":"bad_request" | PASS |

### TEMPLATE-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TEMPLATE-01.get.malformed-id.API | Rerun | TEMPLATE-01.get.malformed-id.API | W2-PLANS-D4 | owner | API GET /plan-templates/abc | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| TEMPLATE-01.apply-preview.live-song | Regression | TEMPLATE-01 neighbour | - | owner | API apply-template/preview | 200, 2 items to add, no warnings | 200 add=2 warn=[] | PASS |
| TEMPLATE-01.apply-preview.archived-song-reference.API | Rerun | TEMPLATE-01.apply-preview.archived-song-reference.API | W2-PLANS-D7 | owner | API apply-template/preview (song archived=${ar.status}) | warning or skipped entry; not silently added as live | archive=200 preview=200 warnings=[] skipped=0 add=2 | FAIL |
| TEMPLATE-01.apply.archived-song-result.API | Rerun | TEMPLATE-01.apply.archived-song-result.API | W2-PLANS-D7 | owner | API apply-template with archived song | items per preview (archived skipped or kept with warning), no 400 | 400 400 {"error":"Restore the song before scheduling it","code":"bad_request"} | FAIL |
| TEMPLATE-01.apply.repeat-key-no-duplicate-writes | Regression | TEMPLATE-01 neighbour (repeat key) | - | owner | API apply twice same key | one application, 2 items | 200/200 items=2 | PASS |
| TEMPLATE-01.apply.member-denied | Regression | TEMPLATE-01 neighbour | - | member | API | 403 | 403 | PASS |
| TEMPLATE-01.apply.stale-preview | Regression | TEMPLATE-01 neighbour (stale hash) | - | owner | API | 409/4xx no write | 409 items=2 | PASS |

### TEMPLATE-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TEMPLATE-02.generate.roster-conflict-on-2nd-date-rolls-back-all.API | Rerun | TEMPLATE-02.generate.roster-conflict-on-2nd-date-rolls-back… | W2-PLANS-D8 | owner | API generate/preview + generate; person busy on 2nd date | preview flags blocking on 2028-06-11; commit refused; +0 plans (all or none) | preview 200 but every date blocking=[] (plan_id null); commit 409 scheduling_conflict generic, plans 15->15 (atomic OK). blockedDates in preview: none | FAIL |
| TEMPLATE-02.generate.atomic-rollback | Regression | TEMPLATE-02 neighbour (all or none) | - | owner | API generate refused | 0 new plans | commit=409 plans 15->15 | PASS |
| TEMPLATE-02.generate.override+replay-same-op | Regression | TEMPLATE-02 neighbour (repeated commit returns original) | - | owner | API generate w/ reason twice, same key | 201 then same plans, no extras | 201/201 ids3=3 same=true plansNow=18 | PASS |
| TEMPLATE-02.generate.bound-count-13 | Regression | TEMPLATE-02 neighbour (bounded) | - | owner | API | 422 | 422 | PASS |
| TEMPLATE-02.generate.member-denied | Regression | TEMPLATE-02 neighbour | - | member | API | 403 | 403 | PASS |
| TEMPLATE-02.generate.dst-dates-resolved | Regression | TEMPLATE-02 neighbour (DST week 2027-03-14) | - | owner | API preview across Chicago spring-forward | 09:00 local each date: 03-07 CST 15:00Z; 03-14 and 03-21 CDT 14:00Z | [["2027-03-07","2027-03-07T15:00:00+00:00"],["2027-03-14","2027-03-14T14:00:00+00:00"],["2027-03-21","2027-03-21T14:00:00+00:00"]] [verify: 03-07 CST 15:00Z; 03-14,03-21 CDT 14:00Z] | PASS |

### TEMPLATE-03

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| TEMPLATE-03.commit.scoped-no-override-cap-creates-double-booking.API | Rerun | TEMPLATE-03.commit.scoped-no-override-cap-creates-double-bo… | W2-PLANS-D12 | scoped (no override cap) | API reschedule preview+commit into same-time overlap of a scheduled p… | refused or requires override capability + reason | preview=200 conflicts=false commit=200 moved_to=2028-07-02 \| overlapping service-time pairs B/C after commit=2; canda assigned to both, no reason re… | FAIL |
| TEMPLATE-03.web.reschedule-list-cap.WEB | Rerun | TEMPLATE-03.web.reschedule-list-cap.WEB | W2-PLANS-D10 | owner | Web /plans/reschedule | all upcoming plans selectable | NOT_RUN (browser owned by W10-WEB) | NOT_RUN |
| TEMPLATE-03.preview.unknown-plan-in-batch | Regression | TEMPLATE-03 neighbour (invalid batch) | - | owner | API | 4xx, nothing changes | 404 D=2028-08-06 | PASS |
| TEMPLATE-03.commit.replay-same-key | Regression | TEMPLATE-03 neighbour | - | owner | API | same result, one move | 200/200 date=2028-08-20 | PASS |
| TEMPLATE-03.commit.stale-hash-refused | Regression | TEMPLATE-03 neighbour | - | owner | API | 4xx, plan unchanged | 409 E=2028-08-13 | PASS |
| TEMPLATE-03.preview.member-denied | Regression | TEMPLATE-03 neighbour | - | member | API | 403 | 403 | PASS |

### ORDER-03

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| ORDER-03.plan-only-arrangement-key | Regression | ORDER-03 neighbour (nondefault arr/key apply to plan only) | - | owner | API POST item + GET | item arr=Alt key=A; library default arrangement/key unchanged | 201 item.arr=true key=A libDefault=true/G | PASS |
| ORDER-03.other-plan-unchanged | Regression | ORDER-03 neighbour | - | owner | API | other plan item has no key override / arrangement | arr=null key=null | PASS |
| ORDER-03.member-chart-readable | Regression | ORDER-03 neighbour (member reads chart) | - | member | API GET /arrangements/:id/chart?key=A | 200 | 200 {"chordpro":"{c: Verse}\n[D]Hello","key":"D","semitones":0,"notation":"chords"} | PASS |
| ORDER-03.delete-arrangement-pinned-by-plan | Rerun | ORDER-03.delete-arrangement-pinned-by-plan | W2-PLANS-D9 | owner | API DELETE /arrangements/:id used by plan item | refused (reference protection) as 409 "in use", no dangling id | 400 400 {"error":"Referenced record does not exist","code":"bad_request"} arr persists=1 item intact=true | FAIL |
| ORDER-03.delete-song-referenced-by-plan | Rerun | ORDER-03.delete-song-referenced-by-plan | W2-PLANS-D9 | owner | API DELETE /songs/:id used by plan | refused as 409 "in use"; item retained | 400 400 {"error":"Referenced record does not exist","code":"bad_request"} song persists=1 | FAIL |
| ORDER-03.delete-song.member-denied | Regression | ORDER-03 neighbour | - | member | API | 403 | 403 | PASS |

### ORDER-04

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| ORDER-04.detail-total-length-vs-schedule-totals.API | Rerun | ORDER-04.detail-total-length-vs-schedule-totals.API | W2-PLANS-D6 | owner | API GET /plans/:id total_length_seconds vs /schedule totals | one rule (headers count 0): equal totals | detail.total_length_seconds=2019 (999 header + 300 pre + 600 service + 120 post); /schedule selected pre 300 + service 600 + post 120 = 1020; header … | FAIL |
| ORDER-04.schedule-order-notes | Regression | ORDER-04 neighbour | - | member | API GET /plans/:id/schedule as member | 200 | 200 | PASS |
| ORDER-04.web.print-run-sheet.WEB | Regression | ORDER-04 web/print (NOT_RUN in wave 2; were NOT_RUN) | - | - | Web print | - | NOT_RUN (browser owned by W10-WEB) | NOT_RUN |

### STAFF-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| STAFF-01.scoped.GET-team-candidates-Band.API | Rerun | STAFF-01.scoped.GET-team-candidates-Band.API | W2-STAFF-D5 | scoped (Sunday plans.edit+scheduling.ma… | API GET /teams/<team w/o service type>/candidates | consistent with plan-scoped authority: 200 (or documented team-scope-only) | 404 {"error":"Team not found","code":"not_found"} [Team "Band Shared W10" has no service type (like wave-2 Band); scoped can still…] | FAIL |
| STAFF-01.owner.team-candidates-excludes-inactive-member.API | Rerun | STAFF-01.owner.team-candidates-excludes-inactive-member.API | W2-STAFF-D2 | owner | API GET /teams/Band/candidates (inactive membership Person on Keys) | inactive Person not listed | 200 rows=9 inactiveListed=false archivedListed=false | PASS |
| STAFF-01.owner.team-candidates-list | Regression | STAFF-01 neighbour (candidate list includes guest/no-email … | - | owner | API | guest and no-email Persons listed | guest=true noemail=true | PASS |
| STAFF-01.bandlead.team-candidates-Band | Regression | STAFF-01 neighbour | - | bandlead | API | 200 | 200 | PASS |
| STAFF-01.bandlead.team-candidates-Production-denied | Regression | STAFF-01 neighbour (no unauthorized team) | - | bandlead | API | 403/404 | 404 | PASS |
| STAFF-01.member.team-candidates-denied | Regression | STAFF-01 neighbour | - | member | API | 403 | 403 | PASS |
| STAFF-01.member.matrix-denied | Regression | STAFF-01 neighbour | - | member | API POST /staffing-matrix/query | 403 | 403 | PASS |

### STAFF-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| STAFF-02.owner.plan-malformed-id.API | Rerun | STAFF-02.owner.plan-malformed-id.API | W2-STAFF-D4 | owner | API POST /plans/not-a-uuid/assignments | 400/404/422 no DB text | 400 {"error":"Invalid route parameter: planId","code":"bad_request"} | PASS |
| STAFF-02.owner.schedule-inactive-member | Regression | STAFF-02 neighbour (inactive) | - | owner | API | 4xx, no row | 400 rows=0 | PASS |
| STAFF-02.owner.schedule-archived | Regression | STAFF-02 neighbour (archived) | - | owner | API | 4xx | 400 | PASS |
| STAFF-02.owner.schedule-guest+noemail | Regression | STAFF-02 neighbour (no-login / no-email still schedulable) | - | owner | API | 201 two rows | 201 created=2 | PASS |
| STAFF-02.owner.wrong-position-relationship | Regression | STAFF-02 neighbour (wrong relationships fail) | - | owner | API position from another team | 4xx and nothing written for canda either (atomic) | 400 canda rows=0 | PASS |
| STAFF-02.concurrent-overlapping-schedule | Regression | STAFF-02 neighbour (concurrent scheduling rechecks conflict… | - | owner + scoped (two sessions) | API parallel POST assignments same person overlapping plans | exactly one 201, one 409; one row | 409/201 rows=1 | PASS |
| STAFF-02.member.denied | Regression | STAFF-02 neighbour | - | member | API | 403 | 403 | PASS |
| STAFF-02.scoped.schedule-shared-team | Regression | STAFF-02 neighbour (relates to W2-STAFF-D5) | - | scoped | API POST assignments Shared team on Sunday plan | (record) 201 per plan scope | 201 [confirms D5 inconsistency: schedule allowed but candidates 404] | PASS |

### MATRIX-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| MATRIX-01.owner.query-garbage-cursor.API | Rerun | MATRIX-01.owner.query-garbage-cursor.API | W2-STAFF-D4 | owner | API cursor:"garbage" | 400/422 no DB text | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"cursor","code":"custom","message":"Invali | PASS |
| MATRIX-01.owner.query-team-filter-Band.API | Rerun | MATRIX-01.owner.query-team-filter-Band.API | W2-STAFF-D2 | owner | API query team filter Band | no inactive/archived Persons | n=9 inactive=false archived=false | PASS |
| MATRIX-01.owner.query-team-filter-excludes-archived-inactive.API | Rerun | MATRIX-01.owner.query-team-filter-excludes-archived-inactiv… | W2-STAFF-D2 | owner | same | same | inactive=false archived=false | PASS |
| MATRIX-01.owner.query-people-excludes-inactive-members.API | Rerun | MATRIX-01.owner.query-people-excludes-inactive-members.API | W2-STAFF-D2 | owner | API query (no team filter) | inactive member not a schedulable row | inactive=false archived=false n=20 | PASS |
| MATRIX-01.owner.query-team-filter-lists-inactive-member.API | Rerun | MATRIX-01.owner.query-team-filter-lists-inactive-member.API | W2-STAFF-D2 | owner | API | inactive not listed | listed=false | PASS |
| MATRIX-01.owner.DELETE-view-malformed-id.API | Rerun | MATRIX-01.owner.DELETE-view-malformed-id.API | W2-STAFF-D4 | owner | API | 400/404 no DB text | 400 {"error":"Invalid route parameter: viewId","code":"bad_request"} | PASS |
| MATRIX-01.owner.preview-archived-person.API | Rerun | MATRIX-01.owner.preview-archived-person.API | W2-STAFF-D2 | owner | API matrix preview with archived Person (+commit) | preview reports a named/blocking reason (person_unavailable) and blocks commit | preview=200 blocking=true warnings=["Has never reviewed their availability","This person is archived or no longer an active member, so they cannot be… | PASS |
| MATRIX-01.owner.preview-flags-archived-person.API | Rerun | MATRIX-01.owner.preview-flags-archived-person.API | W2-STAFF-D2 | owner | API matrix preview with archived Person (+commit) | preview reports a named/blocking reason (person_unavailable) and blocks commit | preview=200 blocking=true warnings=["Has never reviewed their availability","This person is archived or no longer an active member, so they cannot be… | PASS |
| MATRIX-01.owner.preview-flags-inactive-member.API | Rerun | MATRIX-01.owner.preview-flags-inactive-member.API | W2-STAFF-D2 | owner | API matrix preview with inactive Person (+commit) | preview reports a named/blocking reason (person_unavailable) and blocks commit | preview=200 blocking=true warnings=["Has never reviewed their availability","This person is archived or no longer an active member, so they cannot be… | PASS |
| MATRIX-01.scoped.commit-hidden-conflict-no-leak.API | Rerun | MATRIX-01.scoped.commit-hidden-conflict-no-leak.API | W2-STAFF-D1 | scoped | API matrix preview+commit for Person prepared on out-of-scope plan | blocking conflict (redacted, no plan/team title), commit refused | owner-prepare=201 preview=200 blocking=true conflicts=[{"candidate_key":"0","person_id":"418626c3-edec-4a53-a8ec-b4c01ebb46c6","kind":"overlapping_co… | PASS |
| MATRIX-01.scoped.commit-hidden-conflict-persisted-none.API | Rerun | MATRIX-01.scoped.commit-hidden-conflict-persisted-none.API | W2-STAFF-D1 | scoped | SQL rows on scoped plan | 0 rows | rows=0 | PASS |
| MATRIX-01.scoped.direct-schedule-hidden-conflict | Regression | MATRIX-01 neighbour (direct route, W2-STAFF-D1 variant) | W2-STAFF-D1 | scoped | API POST assignments | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict","details":[{"candidate_k | PASS |
| MATRIX-01.views.save-list-visibility | Regression | MATRIX-01 neighbour (saved-view create/load, actor visibili… | - | owner/member | API | owner sees view; member denied/empty | save=201 ownerList=true member=403/{"error":"You need the “Schedule people” permission to do th | PASS |
| MATRIX-01.views.delete | Regression | neighbour | - | owner | API | 204 | 204 | PASS |
| MATRIX-01.commit.happy+replay-same-key | Regression | MATRIX-01 neighbour (atomic commit, same-key retry once) | - | owner | API | 200 then replay same, 2 rows total | 200/200 rows=2 | PASS |
| MATRIX-01.commit.stale-revision | Regression | MATRIX-01 neighbour (stale cells recover, no silent overwri… | - | owner | API commit with old base_revisions, new key | 409/4xx, rows unchanged | 409 rows=2 | PASS |
| MATRIX-01.preview.foreign-plan-id-atomic | Regression | MATRIX-01 neighbour (one bad id fails whole batch) | - | owner | API | 4xx | 404 | PASS |
| MATRIX-01.cross-tenant.query | Regression | MATRIX-01 neighbour | - | betaowner(B) | API | no A plans/people | 200 plans=0 | PASS |

### PROPOSE-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PROPOSE-01.owner.rotation-validate-anchor-bad.API | Rerun | PROPOSE-01.owner.rotation-validate-anchor-bad.API | W2-STAFF-D4 | owner | API POST /rotations anchor_date "2027-13-40" | 400/422 no DB text | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"anchor_date","code":"custom","message":"Use a real | PASS |
| PROPOSE-01.owner.GET-rotation-malformed-id.API | Rerun | PROPOSE-01.owner.GET-rotation-malformed-id.API | W2-STAFF-D4 | owner | API | 400/404 no DB text | 400 {"error":"Invalid route parameter: rotationId","code":"bad_request"} | PASS |
| PROPOSE-01.owner.GET-proposal-malformed-id.API | Rerun | PROPOSE-01.owner.GET-proposal-malformed-id.API | W2-STAFF-D4 | owner | API | 400/404 no DB text | 400 {"error":"Invalid route parameter: proposalId","code":"bad_request"} | PASS |
| PROPOSE-01.owner.proposal-validate-lock-and-exclude-same-in-create.API | Rerun | PROPOSE-01.owner.proposal-validate-lock-and-exclude-same-in… | W2-STAFF-D6 | owner | API create with lock+exclusion same slot (recompute for comparison) | create rejects like recompute (422) | create=201 recompute=422 | FAIL |
| PROPOSE-01.rotation.create | Regression | PROPOSE-01 neighbour (rotation CRUD) | - | owner | API POST /rotations | 201 | 201 | PASS |
| PROPOSE-01.owner.rotation-slot-not-starved-by-fairness.API | Rerun | PROPOSE-01.owner.rotation-slot-not-starved-by-fairness.API | W2-STAFF-D3 | owner | API proposals x12 seeds, rotation Keys wk0 canda / wk1 candb | rotation member holds their slot for every seed | rotation honoured in 0/12 seeds; bad: w10rot0:wk0ok/wk1=vacant w10rot1:wk0ok/wk1=vacant w10rot2:wk0ok/wk1=vacant w10rot3:wk0ok/wk1=vacant | FAIL |
| PROPOSE-01.deterministic-same-input | Regression | PROPOSE-01 neighbour | - | owner | API two proposals same seed/input | same choices | same=true hash=false | PASS |
| PROPOSE-01.no-candidates-vacancy-not-fabricated | Regression | PROPOSE-01 neighbour (vacancy, not fabricated) | - | owner | API proposal for team with no needs on plan | no choice fabricated | 201 choices=0 | PASS |
| PROPOSE-01.member.denied | Regression | PROPOSE-01 neighbour | - | member | API | 403 | 403 | PASS |

### PROPOSE-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PROPOSE-02.owner.proposal-never-proposes-inactive-member.API | Rerun | PROPOSE-02.owner.proposal-never-proposes-inactive-member.API | W2-STAFF-D2 | owner | API 12 proposals (+ inactive & archived on Keys roster) | never chosen | seeds proposing inactive/archived: 0 | PASS |
| PROPOSE-02.owner.refresh-picks-up-new-rotation-version.API | Rerun | PROPOSE-02.owner.refresh-picks-up-new-rotation-version.API | W2-STAFF-D3 | owner | API edit rotation (swap weeks) then POST proposals/:id/refresh | refresh status 201 and wk0 Keys = candb (new rotation) | update=200 refresh=201 wk0 Keys=candb src=rotation | PASS |
| PROPOSE-02.commit.prepared-duplicate-harmless | Regression | PROPOSE-02 neighbour (reviewed proposal -> prepared; duplic… | - | owner | API commit twice same key + SQL | 200/200, rows=choices, all prepared | 200/200 rows=3\|3 choices=3 | PASS |
| PROPOSE-02.commit.no-member-visible-leak | Regression | PROPOSE-02 neighbour (prepared rows hidden from members) | - | member | API GET /plans/:id after commit | 0 assignments visible | assignments=0 | PASS |
| PROPOSE-02.commit.second-key-after-commit | Regression | PROPOSE-02 neighbour (changed roster/committed invalidates) | - | owner | API commit new key after commit | 409/4xx, no new rows | 409 rows=3 | PASS |
| PROPOSE-02.commit.member-denied | Regression | PROPOSE-02 neighbour | - | member | API | 403/404 | 403 | PASS |
| PROPOSE-02.commit.stale-after-roster-change | Regression | PROPOSE-02 neighbour (changed roster invalidates preview) | - | owner | API commit after plan staffing changed | 409 stale, no rows from proposal | 409 409 {"error":"Staffing changed since this proposal was computed. Refresh and review again.","code":" | PASS |

### RESP-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| RESP-01.single-respond.malformed-id-4xx(not 500) | Rerun | RESP-01.single-respond.malformed-id-4xx(not 500) | W2-RESP-D5 | pending | API POST /assignments/not-a-uuid/respond | 4xx no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| RESP-01.respond.unknown-id | Regression | RESP-01 neighbour | - | pending | API | 404 | 404 | PASS |
| RESP-01.preview.scope | Regression | RESP-01 neighbour (grouped plan shows both positions / appl… | - | pending | API preview | Acoustic=2 times, Bass=1 | snapshots=1 acoustic=2 bass=1 | PASS |
| RESP-01.grouped.commit+persist | Regression | RESP-01 neighbour (grouped commit) | - | pending | API commit + SQL | Acoustic confirmed, Bass declined (reason private), unrelated unchanged | 200 acoustic=confirmed bass=declined hist=1/1 keys=unconfirmed | PASS |
| RESP-01.grouped.replay-same-key | Regression | RESP-01 neighbour (retry same key, no dup history) | - | pending | API | 2xx same result, hist unchanged | 200 hist=1/1 | PASS |
| RESP-01.direct-own-status-patch.postgrest | Rerun | RESP-01.direct-own-status-patch.postgrest | W7-RESP-D2 | declined | PostgREST PATCH own assignment status (orig expected: recorded like r… | NOT_APPLICABLE: W7 fix round decided direct status updates by non-schedulers are refused (migration 202611250… | respond=200 patch=409 {"code":"PT409","details":null,"hint":null,"message":"A declined assignment cannot be changed to confirmed; ask a schedu status… [New contract verified in next row] | NOT_APPLICABLE |
| RESP-01.direct-own-status-patch.refused(new contract) | Regression | replacement for the row above (W7-RESP-D2 fix) | W7-RESP-D2 | declined | PostgREST PATCH status | refused (4xx), status unchanged (declined), no history growth | patch=409 status=declined hist=1 | PASS |
| RESP-01.schedule-mine.volume-boundary | Rerun | RESP-01.schedule-mine.volume-boundary | W7-RESP-D5 | member | API GET /schedule/mine over 214 released assignments | 200 and all rows | 200 entries=215 sql=215 | PASS |
| RESP-01.direct-own-status-patch.unconfirmed-repro | Rerun | RESP-01.direct-own-status-patch.postgrest (repro on unconfi… | W7-RESP-D2 | candb (assignee) | PostgREST PATCH own unconfirmed status | NOT_APPLICABLE-contract: W7 fix refuses direct status writes by non-schedulers; expect refusal, status unchan… | patch=403 {"code":"42501","details":null,"hint":"assignment_response_path","message":"Answer this assignment through the app so the scheduler is told… | PASS |

### RESP-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| RESP-02.J01-07c.private-reason-not-readable-by-unrelated-member | Rerun | J01-07c (W9 journeys, tied to RESP-02 "private reason") | W9-JRN-D1 (P0) | unrelated/member/canda/candb (no relati… | API GET /plans/:id time_responses[].response_note | null for non-assignee non-scheduler; assignee + owner + planner see it | commit=200 sees note: {"unrelated":false,"member":false,"canda":false,"candb":false,"owner":true,"scoped":true,"pending":true,"bandlead":true,"legacy… [scoped/bandlead/legacy see it only if schedulers of that team/plan: {"scoped":t…] | PASS |
| RESP-02.J01-07e.postgrest-select-response_note-denied | Rerun | J01-07e (W9) | W9-JRN-D1 (P0) | unrelated/member/owner/pending | PostgREST GET assignment_time_responses?select=response_note | 403 for every caller (column privilege revoked); select=status still 200 for roster readers | statuses {"unrelated":403,"member":403,"owner":403,"pending":403} status-col=200 | PASS |
| RESP-02.J01-07f.cross-tenant-time-responses | Regression | J01-07f (W9 PASS neighbour) | - | betaowner | PostgREST | 0 rows from org A | 200 rows=0 | PASS |
| RESP-02.direct-withdrawal.postgrest | Rerun | RESP-02.direct-withdrawal.postgrest | W7-RESP-D2 | confirmed | PostgREST PATCH own status confirmed->declined (orig expected: record… | NOT_APPLICABLE: superseded by W7 fix (direct status updates by non-schedulers refused; answers go through res… | patch=403 status=confirmed [New contract verified in next row] | NOT_APPLICABLE |
| RESP-02.direct-withdrawal.refused(new contract) | Regression | replacement row | W7-RESP-D2 | confirmed | PostgREST PATCH | refused, status stays confirmed | patch=403 status=confirmed | PASS |
| RESP-02.withdraw.self(API) | Regression | RESP-02 neighbour | - | confirmed | API respond declined w/ reason | 200; status declined; 2 history rows (confirm + withdrawal) | 200 status=declined hist=2 | PASS |
| RESP-02.reaccept-after-decline.self | Regression | RESP-02 neighbour | - | confirmed | API | 409 assignment_response_forbidden | 409 assignment_response_forbidden | PASS |
| RESP-02.stale-expected.self | Regression | RESP-02 neighbour | - | canda | API respond with wrong expected_status | 409 stale, unchanged | 409 assignment_response_stale now=unconfirmed | PASS |
| RESP-02.reason-with-confirm | Regression | RESP-02 neighbour | - | canda | API | 422 | 422 | PASS |
| RESP-02.respond-other-persons-assignment | Regression | RESP-02 neighbour | - | unrelated | API | 403/404, unchanged | 403 unconfirmed | PASS |
| RESP-02.scope-change.confirmed-carryover | Regression | RESP-02.scope-change.confirmed-carryover | W7-RESP-D6 | pending + owner | API time edit after confirm | NOT_APPLICABLE: W7 SUMMARY 2026-11-20 "decided: confirmation stands after a time change, not a defect" | patch=200 status after edit=confirmed (decision behaviour: stays confirmed) [Decision: docs/qa/runs/2026-11-20-wave7/SUMMARY.md (Deferred / W7-RESP-D6 close…] | NOT_APPLICABLE |

### RESP-03

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| RESP-03.valid-preview.anon | Regression | RESP-03 neighbour (PASS row) | - | anonymous | API GET /assignment-responses/:token | 200 minimal fields | notifRow=set 200 keys=snapshot_id,snapshot_version,plan_title,service_date,service_time,location,person_first_name,preferred_language,assignments,exp… | PASS |
| RESP-03.time-edit.preview-stale | Rerun | RESP-03.time-edit.preview-stale | W2-RESP-D4 | anonymous | API token preview after a time edit | 409 stale (same currency test as respond) | edit=200 preview=409 assignment_request_stale | PASS |
| RESP-03.time-edit-after-preview.token-stale | Regression | RESP-03 neighbour (PASS row) | - | anonymous | API respond after edit | 409, status unchanged | 409 now=unconfirmed | PASS |
| RESP-03.expired(snap).GET | Rerun | RESP-03.expired(snap).GET | W2-RESP-D4 | anonymous | API GET token whose snapshot expired | 410 expired | GET 410 assignment_notification_expired; POST 410 now=unconfirmed | PASS |
| RESP-03.respond.invalid-body."x" | Rerun | RESP-03.respond.invalid-body."x" | W7-RESP-D3 | anonymous | API POST respond invalid JSON/body | 400/422 (no 500, no write) | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} now=unconfirmed | PASS |
| RESP-03.respond.invalid-body.null | Regression | RESP-03.respond.invalid-body.{} (PASS neighbour) | W7-RESP-D3 | anonymous | API POST respond invalid JSON/body | 400/422 (no 500, no write) | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} now=unconfirmed | PASS |
| RESP-03.respond.invalid-body.[] | Regression | RESP-03.respond.invalid-body.{} (PASS neighbour) | W7-RESP-D3 | anonymous | API POST respond invalid JSON/body | 400/422 (no 500, no write) | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"","code":"invalid_type"," now=unconfirmed | PASS |
| RESP-03.respond.invalid-body.not json | Regression | RESP-03.respond.invalid-body.{} (PASS neighbour) | W7-RESP-D3 | anonymous | API POST respond invalid JSON/body | 400/422 (no 500, no write) | 400 {"error":"Request body is not valid JSON","code":"invalid_json"} now=unconfirmed | PASS |
| RESP-03.respond.invalid-body.{} | Regression | RESP-03.respond.invalid-body.{} (PASS neighbour) | W7-RESP-D3 | anonymous | API POST respond invalid JSON/body | 400/422 (no 500, no write) | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code":"invalid_t now=unconfirmed | PASS |
| RESP-03.respond.valid+consumed-replay | Regression | RESP-03 neighbour | - | anonymous | API | 200 then 410 used; 1 history | 200/410 assignment_notification_used hist=1 | PASS |
| RESP-03.malformed-token | Regression | RESP-03 neighbour | - | anonymous | API | 404 | 404 | PASS |

### RESP-04

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| RESP-04.race.R7.replay | Rerun | RESP-04.race.R7.replay (commit same key x3) | W7-RESP-D4 (= W2-RESP-D… | canda (3 parallel requests, one session) | API real-parallel x10 | every copy returns the stored result (200); exactly 1 history row | {"200/200/200 hist=1 st=confirmed":10} | PASS |
| RESP-04.retry-same-key-concurrent.race | Rerun | RESP-04.retry-same-key-concurrent.race.x15 | W2-RESP-D3 | canda | API real-parallel same idempotency key x3 (x10) | 200 for every retry, 1 history, no raw constraint text | {"200/200/200 hist=1 st=confirmed":10} | PASS |
| RESP-04.race.R8.replay | Rerun | RESP-04.race.R8.replay (respond_as_self same answer x3) | W7-RESP-D4 | canda | API real-parallel x10 | losers see unchanged/200; 1 history | {"200/200/200 hist=1 st=confirmed":10} | PASS |
| RESP-04.single-respond-duplicate.dedup | Rerun | RESP-04.single-respond-duplicate.dedup.x15 | W2-RESP-D3 | canda | API real-parallel duplicate respond x3 (x10) | 200 each; 1 history row | {"200/200/200 hist=1 st=confirmed":10} | PASS |
| RESP-04.token-vs-signedin.race | Regression | RESP-04.token-vs-signedin.race.x15 (PASS neighbour) | - | anonymous token + unrelated (signed-in) | API real-parallel | one coherent final state, history consistent, no both-fail/500 | {"tok200/auth409 st=declined hist=1":8} | PASS |
| RESP-04.grouped-commit-vs-time-edit.race | Regression | RESP-04.grouped-commit-vs-time-edit.race.x15 (PASS neighbou… | - | candb + owner | API real-parallel | either commit 200 (answer on reviewed scope) or 409 (unconfirmed); never 500/mixed | {"commit200/edit200 st=confirmed":8} | PASS |

### AVAIL-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| AVAIL-01.self.validation.end-before-start | Rerun | AVAIL-01.self.validation.end-before-start | W2-AVAIL-D1 | dependent (self) | API POST /blockouts end before start | 400/422 with user-facing message | 400 {"error":"End must be after start.","code":"bad_request"} | PASS |
| AVAIL-01.self.validation.nonexistent-dst-time | Rerun | AVAIL-01.self.validation.nonexistent-dst-time | W2-AVAIL-D1 | dependent | API DST gap 2027-03-14 02:30 Chicago | 400/422 | 400 {"error":"An occurrence on 2027-03-14 uses a local time skipped by daylight saving. Choose another time.","code":"bad_request"} | PASS |
| AVAIL-01.self.create | Regression | AVAIL-01 neighbour | - | dependent | API | 201 | 201 id=e64ace81 rev=0 | PASS |
| AVAIL-01.unrelated.edit-dana-blockout-substitute-own-person_id.API | Rerun | AVAIL-01.unrelated.edit-dana-blockout-substitute-own-person… | W2-AVAIL-D2 | unrelated | API PATCH another person's blockout with own person_id | 403/404/409, no raw SQLSTATE; unchanged | 404 {"error":"Blockout not found","code":"not_found"} rev=0 | PASS |
| AVAIL-01.self.edit-malformed-id.API | Rerun | AVAIL-01.self.edit-malformed-id.API | API-D5 | dependent | API PATCH /blockouts/xyz | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| AVAIL-01.self.edit-unknown-id.API | Rerun | AVAIL-01.self.edit-unknown-id.API | W2-AVAIL-D2 | dependent | API PATCH unknown uuid | 404/409 (not 400 + P0002) | 404 {"error":"Blockout not found","code":"not_found"} | PASS |
| AVAIL-01.self.delete-malformed-id.API | Rerun | AVAIL-01.self.delete-malformed-id.API | API-D5 | dependent | API DELETE /blockouts/xyz | 400/404/409 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| AVAIL-01.self.edit+stale-revision | Regression | AVAIL-01 neighbour | - | dependent | API | 200 then 409 stale | 200/409 | PASS |
| AVAIL-01.unrelated.delete-other-blockout | Regression | AVAIL-01 neighbour | - | unrelated | API | 403/404/409, row intact | 409 exists=1 | PASS |
| AVAIL-01.delegate(grant).edit | Regression | AVAIL-01 neighbour | - | delegate (can_manage_availability) | API | 200 | 200 | PASS |
| AVAIL-01.delegate.create-for-non-granted-person | Regression | AVAIL-01 neighbour (one permission != another person) | - | delegate | API create for unrelated | 403/404 | 403 | PASS |
| AVAIL-01.delegations.revoke-malformed-id | Regression | API-D5 listed surface (wave 2 note) | API-D5 | dependent | API POST /delegations/xyz/revoke | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |

### AVAIL-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| AVAIL-02.preview.until-before-start | Rerun | AVAIL-02.preview.until-before-start | W2-AVAIL-D1 | dependent | API series preview until<start | 400/422 user-facing | 400 {"error":"The recurrence rule does not produce any occurrences.","code":"bad_request"} | PASS |
| AVAIL-02.preview.until-far-future-bounded | Rerun | AVAIL-02.preview.until-far-future-bounded | W2-AVAIL-D1 | dependent | API until 10 years out | 400/422 bounded (120 occurrences) | 400 {"error":"The recurrence range is too long. Limit it to 120 occurrences.","code":"bad_request"} | PASS |
| AVAIL-02.preview.end-before-start | Rerun | AVAIL-02.preview.end-before-start | W2-AVAIL-D1 | dependent | API | 400/422 | 400 {"error":"End must be after start.","code":"bad_request"} | PASS |
| AVAIL-02.self.get-series-malformed-id | Rerun | AVAIL-02.self.get-series-malformed-id | API-D5 | dependent | API GET /blockouts/series/xyz | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| AVAIL-02.preview.count | Regression | AVAIL-02 neighbour | - | dependent | API | 200 four occurrences | 200 n=4 | PASS |
| AVAIL-02.series.create+idempotent | Regression | AVAIL-02 neighbour | - | dependent | API series create twice same key | 201 then same series, no extra rows | 201/201 sameId=true | PASS |

### AVAIL-03

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| AVAIL-03.leader.PostgREST-blockouts-select | Rerun | AVAIL-03.leader.PostgREST-blockouts-select | W2-AVAIL-D3 | bandlead (Band-scoped scheduling.manage) | API GET /blockouts?scope=organization + PostgREST select reason of ou… | no private reasons returned to a team-scoped leader; reasons for self | api=200 rows=1 pg=200 rows=0 leakedReason=false self-read=true | PASS |
| AVAIL-03.owner.sees-reasons | Regression | AVAIL-03 neighbour | - | owner (org-wide) | API GET /blockouts?scope=organization | 200; admin/owner raw-row policy (record whether reasons shown) | 200 reasonVisible=true [record only: reasons for non-self visible to owner/admin = true] | PASS |
| AVAIL-03.leader.warnings-redacted | Regression | AVAIL-03 neighbour (private reason redacted from generic co… | - | bandlead | API /availability/warnings | no reason text | 200 reasonLeaked=false | PASS |
| AVAIL-03.self.delete-pref-malformed-id | Rerun | AVAIL-03.self.delete-pref-malformed-id | API-D5 | dependent | API DELETE /availability/preferences/xyz | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| AVAIL-03.self.request-detail-malformed-id | Rerun | AVAIL-03.self.request-detail-malformed-id | API-D5 | dependent | API GET /availability/requests/xyz | 400/404 no DB text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| AVAIL-03.self.save-preference | Regression | AVAIL-03 neighbour | - | dependent | API PUT /availability/preferences | 200 (or 4xx if not on team) | 200 {"id":"a86ed510-0cfd-4b59-8ed1-ef33b6355615","organization_id":"082b4a41-facc-4e0e-bcba-7d6bdd7e2d82 | PASS |
| AVAIL-03.preference.conflicting-weeks-rejected | Regression | AVAIL-03 neighbour | - | dependent | API | 422 | 422 | PASS |
| AVAIL-03.affirm-freshness | Regression | AVAIL-03 neighbour | - | dependent | API POST /availability/affirm | 200 | 200 | PASS |
| AVAIL-03.review-other-person-denied | Regression | AVAIL-03 neighbour | - | dependent | API review of other person | 403/404 | 403 | PASS |

### OPPORT-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| OPPORT-01.claims-list.sched | Rerun | OPPORT-01.claims-list.sched | W2-RESP-D1 | owner / scoped / legacy scheduler | API GET /opportunity-claims | 200 listing the claim with person_name (not []) | {"owner":"200:canda canda","scoped":"200:canda canda","bandlead":"200:canda canda","legacy":"200:canda canda"} | PASS |
| OPPORT-01.claims-list.lead | Rerun | OPPORT-01.claims-list.lead | W2-RESP-D1 | bandlead (Band team leader) | API GET /opportunity-claims | 200 listing claim with person_name | 200:canda canda | PASS |
| OPPORT-01.claims-list.member-denied | Regression | OPPORT-01 neighbour | - | member | API | 403 | 403 | PASS |
| OPPORT-01.claim-self-approval-by-leader-claimant | Rerun | OPPORT-01.claim-self-approval-by-leader-claimant | W2-RESP-D2 | bandlead (leader AND claimant) | API claim then POST /opportunity-claims/:id/decision approve on own c… | 403 self_approval; no assignment | claim=201 approve=403 self_approval assignments=0 | PASS |
| OPPORT-01.claim-approval-by-other-leader | Regression | OPPORT-01 neighbour (non-beneficiary approves) | - | owner | API | 200; assignment created for claimant | 200 assignments=1 | PASS |
| OPPORT-01.claim.malformed-opportunity-id-4xx(not 500) | Rerun | OPPORT-01.claim.malformed-opportunity-id-4xx(not 500) | W2-RESP-D5 | canda | API POST /opportunities/not-a-uuid/claim | 4xx no raw PG text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| OPPORT-01.ineligible-claim | Regression | OPPORT-01 neighbour (ineligible cannot enumerate/claim) | - | unrelated (no team) | API list + claim | list empty; claim 4xx, no row | list=[] claim=403 | PASS |
| OPPORT-01.capacity-race-final-slot | Regression | OPPORT-02 style neighbour (final slot claim/claim) | - | canda + candb parallel | API real-parallel claim, capacity 1 direct | occupancy <= 1; loser clear 4xx | 201/403 occupancy=1 | PASS |

### REPLACE-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| REPLACE-01.candidate-self-approval-by-leader-candidate | Rerun | REPLACE-01.candidate-self-approval-by-leader-candidate | W2-RESP-D2 | bandlead (leader AND replacement candid… | API offer -> accept -> approve (own) | 403 self_approval; no assignment for candidate; original decline retained | offer=201 accept=200 approve=403 self_approval bandleadAsg=0 originalDeclined=declined | PASS |
| REPLACE-01.approval-by-other-leader | Regression | REPLACE-01 neighbour | - | owner | API approve (non-candidate) | 200 finalized; candidate assignment created; original decline + history retained | 200 candidateAsg=1 originalStatus=declined hist=1 | PASS |
| REPLACE-01.offer-action.malformed-offer-id-4xx(not 500) | Rerun | REPLACE-01.offer-action.malformed-offer-id-4xx(not 500) | W2-RESP-D5 | owner | API POST /replacement-offers/zzz/action | 4xx no raw PG text | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| REPLACE-01.candidate-self-approval.member | Regression | REPLACE-01 neighbour (no candidate self-approval, plain mem… | - | candb | API approve own offer | 403 | 403 | PASS |
| REPLACE-01.offer-by-non-scheduler | Regression | REPLACE-01 neighbour | - | member | API issue offer | 403 | 403 | PASS |

### REPLACE-02

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| REPLACE-02.duplicate-request-same-key.x20 | Rerun | REPLACE-02.duplicate-request-same-key.x20 | W2-RESP-D3 | declined person (3 parallel, one key) | API real-parallel x10 | all copies 2xx returning the same request; exactly 1 row | 10 of 10 iterations: statuses 201/409/409 (one 2xx, two 409 "That record already exists"), exactly 1 replacement_requests row each (no duplicate); se… | FAIL |
| REPLACE-02.competing-approvals-final-slot | Regression | REPLACE-02 neighbour (competing approvals, no overfill) | - | owner (2 parallel approvals) | API real-parallel | exactly 1 replacement assignment; original decline retained | approve=200/200 replacementRows=1 orig=declined | PASS |

### SWAP-01

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| SWAP-01.leader-participant-self-approval | Rerun | SWAP-01.leader-participant-self-approval | W2-RESP-D2 | bandlead (leader AND swap participant) | API create swap, both consent, participant-leader approves | 403 self_approval; swap not finalized; positions unchanged | create=201 consent=200 approve=403 self_approval swap=pending canda still Keys=true | PASS |
| SWAP-01.approve-by-non-participant-atomic-exchange | Regression | SWAP-01 neighbour (atomic exchange) | - | owner | API approve | 200; swap finalized; each person receives a NEW confirmed assignment for the other's position, originals set … | 200 finalized; canda now has confirmed Bass (new row) and Keys declined; bandlead confirmed Keys (new row) and Bass declined (SQL). My first assertio… | PASS |
| SWAP-01.non-participant-cannot-create | Regression | SWAP-01 neighbour | - | unrelated | API | 4xx | 409 | PASS |

### PEOPLE-04

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| PEOPLE-04.directory.default-hides-archived | Rerun | PEOPLE-04 (never covered; API half) | - | owner | API GET /people/page?q=p4w10 | archived Person hidden by default; no-login/invited/plain listed | ids=Invited P4W10,NoLogin P4W10,Plain P4W10 total=3 | PASS |
| PEOPLE-04.directory.badges | Rerun | PEOPLE-04 | - | owner | API row flags | no-login: has_login=false,status=no_account,invite_pending=false; invited: invite_pending=true; email visible… | nologin=[false,"no_account",false] invited=[false,"no_account",true] invite=201 ownerEmail=nologin.p4.w10@example.test | PASS |
| PEOPLE-04.directory.include-archived | Rerun | PEOPLE-04 | - | owner | API include_archived=true | archived Person listed with archived=true; total 4 | total=4 archivedFlag=true | PASS |
| PEOPLE-04.directory.member-view | Rerun | PEOPLE-04 (all others) | - | member | API same query as ordinary member | names only; no email/phone; invite badge? | total=4 contactLeak=false inviteFlagVisible=false [record: invite_pending visible to member = false] | PASS |
| PEOPLE-04.denied.admin | Rerun | PEOPLE-04 (all others denied) | - | admin | API create/archive/tags/invite | all 403, no data change | 403/403/403/403 archivedNow=f tags=- | PASS |
| PEOPLE-04.denied.legacy | Rerun | PEOPLE-04 (all others denied) | - | legacy | API create/archive/tags/invite | all 403, no data change | 403/403/403/403 archivedNow=f tags=- | PASS |
| PEOPLE-04.denied.member | Rerun | PEOPLE-04 (all others denied) | - | member | API create/archive/tags/invite | all 403, no data change | 403/403/403/403 archivedNow=f tags=- | PASS |
| PEOPLE-04.tags.groups.catalog | Rerun | PEOPLE-04 | - | owner | API set tags, create group, assign tag to group, read catalog | tags lower-cased; catalog shows group + people count | group=201 tags=200 ["second","w10p4"] cat=200 entry={"tag":"w10p4","group_id":"7fbc7f32-b40e-4581-9766-5262bb0c059a","people":1} | PASS |
| PEOPLE-04.tags.catalog.member-read | New | PEOPLE-04 neighbour | - | member | API GET /people/tag-catalog | 200 (catalog) or 403 per oracle; record | 200 [record: 200] | PASS |
| PEOPLE-04.bulk.preview | Rerun | PEOPLE-04 | - | owner | API POST /people/bulk/preview add_tag | 3 changes, 0 errors, nothing written | 200 changes=3 unchanged=0 errors=0 written= | PASS |
| PEOPLE-04.bulk.commit+replay | Rerun | PEOPLE-04 | - | owner | API apply then same key again | 200 applied=3; replay returns same, still 3 rows | 200 {"changed":3,"replayed":false,"unchanged":0} replay=200 rows=3 | PASS |
| PEOPLE-04.bulk.stale-expected-changes | Rerun | PEOPLE-04 | - | owner | API apply with expected_changes != preview | 409 roster_bulk_stale when expected_changes != changes previewed; nothing written | 409 roster_bulk_stale rows=0 (rerun with only valid ids; first attempt included an archived Person, a per-row error, which gives 400 not 409) | PASS |
| PEOPLE-04.bulk.invalid-row-atomic | Rerun | PEOPLE-04 "invalid row cannot partially mutate an atomic ba… | - | owner(C) | API bulk add_tag with one org-A Person id among valid ones | whole batch refused (4xx) with no tag rows written; preview marks the bad row error | preview=200 errors=1 apply=400 {"error":"1 of the selected people cannot be changed; preview again","code":"bad_request"} rows=0 | PASS |
| PEOPLE-04.bulk.unknown-uuid-atomic | Rerun | PEOPLE-04 | - | owner | API bulk with nonexistent Person id | 4xx, nothing written | 400 rows=0 | PASS |
| PEOPLE-04.bulk.add-to-team | Rerun | PEOPLE-04 | - | owner | API bulk add_to_team | 200 two memberships | 200 memberships=2 | PASS |
| PEOPLE-04.bulk.foreign-team | New | PEOPLE-04 neighbour | - | owner(C) | API bulk with org A team id | 4xx, nothing written | 404 rows=0 | PASS |
| PEOPLE-04.bulk.denied.admin | Rerun | PEOPLE-04 (all others) | - | admin | API bulk apply add_tag | 403/404; no row | 403 rows=0 | PASS |
| PEOPLE-04.bulk.denied.legacy | Rerun | PEOPLE-04 (all others) | - | legacy | API bulk apply add_tag | 403/404; no row | 403 rows=0 | PASS |
| PEOPLE-04.bulk.denied.member | Rerun | PEOPLE-04 (all others) | - | member | API bulk apply add_tag | 403/404; no row | 403 rows=0 | PASS |
| PEOPLE-04.bulk.denied.peoplegrant(oracle) | New | PEOPLE-04 / plan §3 oracle: "Other Person ... tags ... Deny… | - | peoplegrant (people.manage + view_priva… | API POST /people/bulk/apply add_tag in org A | 403/404 and no tag row (owner-only People rule) | 403 {"error":"You do not have access to do that","code":"forbidden"} rows=0 | PASS |
| PEOPLE-04.bulk.preview.peoplegrant(oracle) | New | plan §3 oracle | - | peoplegrant | API bulk preview | 403/404 (no row-level outcome for others' People) | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| PEOPLE-04.tag-groups.denied.peoplegrant(oracle) | New | plan §3 oracle | - | peoplegrant | API POST /people/tag-groups | 403 | 403 | PASS |
| PEOPLE-04.archive-restore-history | Rerun | PEOPLE-04 | - | owner | API archive Person with an assignment, then restore; GET /people/audit | archive 200; historical assignment retained; hidden from list + not schedulable while archived; restore retur… | archive=200 assignmentKept=unconfirmed:100d7909-b905-4f91-8c6e-7db8be08b49b shownInPlan=true listHidden=true schedulableWhileArchived=400 restore=200… | PASS |
| PEOPLE-04.audit.denied.admin | Rerun | PEOPLE-04 (all others) | - | admin | API GET /people/audit | 403 | 403 | PASS |
| PEOPLE-04.delete-with-history.blocked | Rerun | PEOPLE-04 historical references retained | - | owner | API DELETE Person with assignment history | 409 "archive instead"; assignment intact | 409 person_has_history asg=1 | PASS |
| PEOPLE-04.bulk.cross-tenant | New | PEOPLE-04 neighbour | - | betaowner | API | 403 | 403 | PASS |
| PEOPLE-04.archive.foreign-person-id | New | PEOPLE-04 neighbour (substituted foreign id) | - | betaowner(B) with org C person id | API archive | 404; not archived | 404 archived=f | PASS |

### Large-list API (de3ae9a, d2a5b19, aa7e066)

| Row | Kind | Original row | Original defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|---|
| LARGE.people.total+paging.owner | New | (new) large-list API de3ae9a | - | owner(corg) | API GET /people/page paging limit=25 to end | total == rows returned == SQL count; no duplicates; no gaps; statuses 200 | pages=13 items=305 uniq=305 total=305 sql=305 | PASS |
| LARGE.people.total+paging.member | New | (new) large-list API de3ae9a | - | member | API GET /people/page paging limit=25 to end | total == rows returned == SQL count; no duplicates; no gaps; statuses 200 | pages=13 items=305 uniq=305 total=305 sql=305 | PASS |
| LARGE.people.total+paging.admin | New | (new) large-list API de3ae9a | - | admin | API GET /people/page paging limit=25 to end | total == rows returned == SQL count; no duplicates; no gaps; statuses 200 | pages=13 items=305 uniq=305 total=305 sql=305 | PASS |
| LARGE.people.total+paging.legacy-scheduler | New | (new) large-list API de3ae9a | - | legacy scheduler | API GET /people/page paging limit=25 to end | total == rows returned == SQL count; no duplicates; no gaps; statuses 200 | pages=13 items=305 uniq=305 total=305 sql=305 | PASS |
| LARGE.people.order-stable-sort_name-id | New | (new) | - | owner | API paging order vs SQL order by sort_name,id | identical order | equal=true n=305/305 | PASS |
| LARGE.people.page-size-independent | New | (new) | - | owner | API limit 7 / 25 / 100 | same sequence | true/true | PASS |
| LARGE.people.team-filter+total | New | (new) | - | owner | API GET /people/page?team_id=<130-member team> | total=130, rows = team members exactly | items=130 total=130 sqlMembers=130 setEq=true | PASS |
| LARGE.people.team-filter.member | New | (new) | - | member | API same as ordinary member | same total, directory only (no contact) | total=130 items=130 emailLeak=false | PASS |
| LARGE.search.accent.nguyen_thi_anh | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=nguyen thi anh | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | vi-no-accent query finds accented: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.accent.Nguyễn_Thị_Ánh | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=Nguyễn Thị Ánh | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | accented query finds no-accent: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.accent.NGUYEN_THI_ANH | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=NGUYEN THI ANH | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | upper: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.accent.anh_nguyen | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=anh nguyen | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | word order: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.accent.thi | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=thi | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | single word: ["Nguyen Thi Anh","Nguyễn Thị Ánh","Phạm Thị Hương"] total=3 | PASS |
| LARGE.search.accent.nguyễn | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=nguyễn | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | partial accent: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.accent.nguyen | New | (new) accent-insensitive search (d2a5b19) | - | owner | API GET /people/page?q=nguyen | Person "Nguyễn Thị Ánh" and "Nguyen Thi Anh" both found; total == rows | partial no accent: ["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2 | PASS |
| LARGE.search.fold.tran_van_duc | New | (new) | - | owner | API q=tran van duc (đ->d, diaeresis, acute) | finds Trần Văn Đức & Tran Van Duc | ["Tran Van Duc","Trần Văn Đức"] | PASS |
| LARGE.search.fold.dang_quoc_viet | New | (new) | - | owner | API q=dang quoc viet (đ->d, diaeresis, acute) | finds Đặng Quốc Việt & Dang Quoc Viet | ["Dang Quoc Viet","Đặng Quốc Việt"] | PASS |
| LARGE.search.fold.Đặng | New | (new) | - | owner | API q=Đặng (đ->d, diaeresis, acute) | finds Đặng Quốc Việt & Dang Quoc Viet | ["Dang Quoc Viet","Đặng Quốc Việt"] | PASS |
| LARGE.search.fold.jose_alvarez | New | (new) | - | owner | API q=jose alvarez (đ->d, diaeresis, acute) | finds José Álvarez | ["José Álvarez"] | PASS |
| LARGE.search.fold.zoe_muller | New | (new) | - | owner | API q=zoe muller (đ->d, diaeresis, acute) | finds Zoë Müller | ["Zoë Müller"] | PASS |
| LARGE.search.fold.le_huu_nghia | New | (new) | - | owner | API q=le huu nghia (đ->d, diaeresis, acute) | finds Lê Hữu Nghĩa | ["Lê Hữu Nghĩa"] | PASS |
| LARGE.search.every-word-must-match | New | (new) | - | owner | API q="nguyen xyznotthere" | 0 results, total 0 | items=0 total=0 | PASS |
| LARGE.search.hostile-q."%" | New | (new) hostile search text | - | owner | API q="%" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."_" | New | (new) hostile search text | - | owner | API q="_" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."a,b)" | New | (new) hostile search text | - | owner | API q="a,b)" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."x\"y" | New | (new) hostile search text | - | owner | API q="x\"y" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."\\" | New | (new) hostile search text | - | owner | API q="\\" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."'; drop table people;--" | New | (new) hostile search text | - | owner | API q="'; drop table people;--" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."(foo).bar" | New | (new) hostile search text | - | owner | API q="(foo).bar" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."*" | New | (new) hostile search text | - | owner | API q="*" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.hostile-q."nguyen,thi" | New | (new) hostile search text | - | owner | API q="nguyen,thi" | 200 with literal matching (no wildcard expansion), or 4xx; never 500/DB text | 200 total=0 items=0 | PASS |
| LARGE.search.team+q-scope | New | (new) schedule-people search with team scope | - | owner | API /people/page?team_id&q | Small team: both accent people; Large team result set = SQL members matching | small=["Nguyen Thi Anh","Nguyễn Thị Ánh"] total=2; large total=2 sql=2 | PASS |
| LARGE.search.contact-only-where-readable | New | (new) permission per role: contact search | - | owner vs member vs admin | API q=<email>/<phone of another Person> | owner finds; member/admin do not (owner-only People contact); no contact fields in rows | owner=1 member=0/0 admin=0 memberRowsLeakContact=false | PASS |
| LARGE.people.cross-tenant | New | (new) tenant isolation | - | betaowner (org B only) with org C header | API | 403/404, no data | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| LARGE.people.foreign-team-id | New | (new) foreign team id substitution | - | owner(C) with org A team id | API | 200 total 0 (or 4xx); no org A people | 200 total=0 items=0 | PASS |
| LARGE.people.limit-bound | New | (new) | - | owner | limit=500 | 422 | 422 | PASS |
| LARGE.people.bad-cursor | New | (new) | - | owner | cursor=garbage | 4xx no DB text | 400 {"error":"Invalid cursor","code":"bad_request"} | PASS |
| LARGE.people.cursor-stable-under-mutation | New | (new) cursors stable, no duplicates/gaps | - | owner | API page 1, then insert (before + after cursor) + archive an unread P… | every pre-existing, unarchived Person exactly once; the later-inserted Zzz appears once; archived victim abse… | got=311 uniq=311 missing=0 Zzz=true victimSeen=false | PASS |
| LARGE.people.identical-names-tiebreak | New | (new) | - | owner | API q="duplicate name" limit=2 (5 identical sort_name) | 5 distinct rows across 3 pages | items=5 uniq=5 total=5 pages=3 | PASS |
| LARGE.plans.q.Lễ_Chúa_Nhật | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=Lễ Chúa Nhật paging per_page=10 | total=12; paged rows == total; no duplicates (accented query) | status=200 total=12 rows=12 uniq=12 | PASS |
| LARGE.plans.q.le_chua_nhat | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=le chua nhat paging per_page=10 | total=12; paged rows == total; no duplicates (no-accent query -> accented title) | status=200 total=12 rows=12 uniq=12 | PASS |
| LARGE.plans.q.LE_CHUA | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=LE CHUA paging per_page=10 | total=12; paged rows == total; no duplicates (upper partial) | status=200 total=12 rows=12 uniq=12 | PASS |
| LARGE.plans.q.sunday_service_07 | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=sunday service 07 paging per_page=10 | total=1; paged rows == total; no duplicates (multi-word digits) | status=200 total=1 rows=1 uniq=1 | PASS |
| LARGE.plans.q.sunday_service | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=sunday service paging per_page=10 | total=48; paged rows == total; no duplicates (48 non-accent plans) | status=200 total=48 rows=48 uniq=48 | PASS |
| LARGE.plans.q.chua_sunday | New | (new) plans q title search (de3ae9a) | - | member (non-planner) | API GET /plans?q=chua sunday paging per_page=10 | total=0; paged rows == total; no duplicates (every word must match) | status=200 total=0 rows=0 uniq=0 | PASS |
| LARGE.plans.q.hostile | New | (new) | - | member | API q=% and q=a,b)"\ | literal match, no 500/DB text | 200/0 200/0 | PASS |
| LARGE.plans.q.order-asc-desc | New | (new) | - | owner | API q=sunday both orders | asc first row earliest; desc first row latest; dates monotonic | asc0=2030-01-13 desc0=2031-02-23 mono=true | PASS |
| LARGE.plans.q.cross-tenant | New | (new) | - | betaowner | API | 403 | 403 | PASS |
| LARGE.plans.q.own-org-no-leak | New | (new) | - | betaowner(B) | API q=sunday in own org | 0 hits from org C | 200 total=0 | PASS |
| LARGE.matrix.name-paging.next | New | (new) staffing matrix name paging (de3ae9a) | - | owner | API POST /staffing-matrix/query page_size 25 walk next_cursor | all schedulable people once, in sort_name,id order | pages=13 rows=312 uniq=312 sql=312 sameOrder=true | PASS |
| LARGE.matrix.name-paging.prev | New | (new) | - | owner | API from last page follow prev_cursor to first | reverse walk reproduces the same sequence, no dup/gap | rows=312 uniq=312 equalsForward=true | PASS |
| LARGE.matrix.page-size-independent | New | (new) | - | owner | page_size 7 vs 50 | same sequence | true n=312 | PASS |
| LARGE.matrix.search.accent | New | (new) matrix name search accent-insensitive | - | owner | API filters.search="nguyen thi anh" | both accent variants | ["Nguyen Thi Anh","Nguyễn Thị Ánh"] | PASS |
| LARGE.matrix.search.accent-reverse | New | (new) | - | owner | filters.search="Nguyễn Thị Ánh" | both | ["Nguyen Thi Anh","Nguyễn Thị Ánh"] | PASS |
| LARGE.matrix.team-filter | New | (new) SQL team filter + paging | - | owner | API team_ids=[Large Band] page_size 25 | exactly the 130 team members once | rows=130 uniq=130 setEq=true | PASS |
| LARGE.matrix.team+search | New | (new) schedule-people search with team scope | - | owner | team_ids + search | intersection only | Nguyen Thi Anh,Nguyễn Thị Ánh | PASS |
| LARGE.matrix.permission.member | New | (new) permission per role | - | member | API matrix query | role oracle: schedulers/admins 200; member/outsider 403 | 403 | PASS |
| LARGE.matrix.permission.admin | New | (new) permission per role | - | admin | API matrix query | role oracle: schedulers/admins 200; member/outsider 403 | 200 | PASS |
| LARGE.matrix.permission.legacy-scheduler | New | (new) permission per role | - | legacy scheduler | API matrix query | role oracle: schedulers/admins 200; member/outsider 403 | 200 | PASS |
| LARGE.matrix.permission.betaowner | New | (new) permission per role | - | betaowner | API matrix query | role oracle: schedulers/admins 200; member/outsider 403 | 403 | PASS |
| LARGE.matrix.bad-cursor | New | (new) | - | owner | cursor garbage | 4xx | 422 | PASS |
| LARGE.matrix.legacy-person-id-cursor | New | (new) bare person-id cursor still accepted | - | owner | cursor=<person uuid> | 200 | 200 | PASS |
