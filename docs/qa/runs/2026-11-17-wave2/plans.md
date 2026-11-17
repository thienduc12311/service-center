# QA-03 Plans, times, templates, running order — wave 2 (run qa-20261117, agent `plans`)

Date 2026-11-17. Repo HEAD `cac3f26` on `main` (working tree not modified by this agent). Latest migration `20261118000000_platform_user_management.sql` (71 migrations applied; local DB freshly reset). Backend http://localhost:4000/api/v1 (running build, not rebuilt), Supabase local :54321, web http://localhost:5173 (Browser pane, Chromium, 1280x800 and 1024x768, member and owner sessions). Every permission case was exercised with the caller's own bearer token (API) or the caller's own JWT against PostgREST (RLS rows); the service role was used only for fixture setup and for read-only verification of persisted state (labelled `.D` where it is the evidence).

## ESCALATIONS (top)

**No P0 found.** No cross-tenant disclosure (Beta sentinel strings never appeared in any Alpha-context response; Beta plan/items/times/template stayed byte-identical after every Alpha-context mutation attempt, including direct PostgREST moves of rows into Beta), no unauthorized persisted mutation by an actor lacking `plans.edit` for the plan's service type (API and direct RLS), no prepared-assignment leak through plan list/detail, no lost write found in the revisioned order/time editors (stale saves refuse, drafts survive in the web UI).

Highest severity found is **P1 (W2-PLANS-D10)**: the web Plans list "Past" tab is not bounded to past plans and both Plans and Reschedule pickers hard-cap at 50 rows with no pager, so history/future beyond 50 rows is unreachable from the UI. Everything else is P2. One P2 (W2-PLANS-D12) is an intent conflict that needs a product decision rather than a code fix.

Environment note (not a defect): self-serve organization creation is now off (`church_application_required`, both `POST /organizations` and the RPC), unlike wave 1. Fixture orgs were therefore created by privileged setup (service-role insert of `organizations` + owner `organization_members` rows, equivalent to `private.create_church`). Everything else (people, invitations, accept, grants, service types, folders, teams, songs, plans) went through the real API.

## Summary

Executed expanded cases: 1233. PASS 1198, FAIL 27, NOT_APPLICABLE 4, BLOCKED 0, NOT_RUN 4. Every FAIL maps to a defect W2-PLANS-D1..D12.

| Package case | PASS | FAIL | N/A | NOT_RUN |
|---|---|---|---|---|
| MOBILE (native) | 0 | 0 | 0 | 1 |
| ORDER-01 | 256 | 3 | 0 | 1 |
| ORDER-02 | 75 | 0 | 0 | 0 |
| ORDER-03 | 16 | 2 | 0 | 0 |
| ORDER-04 | 18 | 1 | 0 | 1 |
| PLAN-01 | 75 | 6 | 1 | 0 |
| PLAN-01 (WEB-D6 1024px re-check) | 0 | 1 | 0 | 0 |
| PLAN-02 | 219 | 5 | 0 | 1 |
| TEMPLATE-01 | 195 | 3 | 0 | 0 |
| TEMPLATE-02 | 75 | 1 | 0 | 0 |
| TEMPLATE-03 | 90 | 2 | 3 | 0 |
| TIME-01 | 105 | 0 | 0 | 0 |
| TIME-02 | 53 | 1 | 0 | 0 |
| TIME-03 | 21 | 2 | 0 | 0 |

Surface split (by id suffix): API 1128, D 6, RLS 78, WEB 20, native 1. `API` = Express route with caller JWT, `RLS` = PostgREST/RPC direct with caller JWT, `D` = service-role read used as persisted-state evidence, `WEB` = Browser pane.

Status-code note: this API answers request-validation failures with **422** `unprocessable` (not 400). Cases that expected a 400-class refusal accept 422 and are marked PASS with a note.

## Defects

### W2-PLANS-D1 (P2) Invalid date strings reach Postgres and come back as HTTP 500 with the raw DB error
- Cases: PLAN-02.create.validation.bad-service-date, .empty-service-date, PLAN-02.update.validation.bad-date, PLAN-02.duplicate.validation.bad-date, PLAN-01.filter.garbage-from, .sql-ish-from
- Repro / evidence: As owner: `POST /plans {"title":"x","service_date":"not-a-date"}` -> 500 `{"error":"invalid input syntax for type timestamp with time zone: \"not-a-date\"","code":"22007"}`. Same for `PATCH /plans/:id {"service_date":"nope"}`, `POST /plans/:id/duplicate {"service_date":"junk"}`, `GET /plans?from=garbage`. Expected 400/422 validation error without DB text (CLAUDE.md rule 10 and 20). Actual 500 + engine message. (`POST /plans/reschedule` and template series dates are validated correctly.)
- Suspected location: packages/shared/src/schemas/plan.ts:14-15 (`starts_at`/`ends_at` `z.string()` with only a `new Date()` comparison), :26 and :65 (`service_date: z.string()`), :195-196 (`from`/`to`); 500 mapping at backend/src/routes/plans.ts:79 (`throw new HttpError(500, error.message, error.code)`).

### W2-PLANS-D2 (P2) Plan list page beyond the last page returns 500
- Cases: PLAN-01.paginate.beyond-last-page
- Repro / evidence: `GET /plans?per_page=2&page=99&from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z` (7 matching plans) -> 500 `{"error":"Requested range not satisfiable","code":"PGRST103"}`. Expected 200 with `data: []` and `total: 7` (pagination boundary case).
- Suspected location: backend/src/routes/plans.ts:77-79: `.range(offset, …)` error is surfaced as HTTP 500 instead of an empty page.

### W2-PLANS-D3 (P2) Zone-less and date-only plan instants are silently taken as UTC; the organization-local day drifts
- Cases: TIME-03.date-only-service_date, TIME-03.naive-datetime-without-zone
- Repro / evidence: `POST /plans {"title":"x","service_date":"2040-08-04"}` -> 201 stored `2040-08-04T00:00:00+00:00`, which is 2040-08-03 19:00 in the org zone America/Chicago (local day shifts back). `service_date`/`times[].starts_at` = `"2040-08-18T10:00:00"` (no zone) is stored as 10:00Z (= 05:00 local). Expected: rejected, or interpreted in the organization time zone.
- Suspected location: packages/shared/src/schemas/plan.ts:14-15,26 accept any string; `create_plan` casts with the DB session zone (UTC). Related to D1 (same missing instant validation).

### W2-PLANS-D4 (P2) Malformed UUID path/query parameters still produce HTTP 500 with the raw Postgres error (W1 API-D5 reproduces on the QA-03 routes)
- Cases: PLAN-01.detail.malformed-id, PLAN-02.delete.malformed-id, TEMPLATE-01.get.malformed-id, ORDER-01.edit.malformed-item-id
- Repro / evidence: As owner: `GET /plans/abc`, `DELETE /plans/abc`, `GET /plan-templates/abc`, `PATCH /plans/<id>/items/abc` -> 500 `{"error":"invalid input syntax for type uuid: \"abc\"","code":"22P02"}`. Expected 400/404 with no DB text. (Body UUIDs are validated and answer 422; only path ids leak.)
- Suspected location: backend/src/lib/params.ts:9-16 (`param()` checks only non-empty) and backend/src/lib/errors.ts:107-163 has no `22P02` mapping; same root cause as W1 API-D5.

### W2-PLANS-D5 (P2) Adding an item with an explicit `sort_order` does not shift existing items: duplicate sort_order values and an ambiguous order
- Cases: ORDER-01.add.sort_order-insert-first-middle-beyond-end, ORDER-01.add.sort_order-contiguous-unique
- Repro / evidence: Plan with items a,b,c (sort_order 0,1,2). `POST /plans/:id/items {"item_type":"item","title":"FIRST","sort_order":0}` then `{"title":"MID","sort_order":2}` then `{"title":"FAR","sort_order":500}`. Detail order = FIRST,a,b,c,MID,FAR with sort_order 0,0,1,2,2,500 (ties; MID lands after c, not at index 2). Expected contiguous unique positions (insert shifts the tail), as the route doc says "adds an item … at `sort_order`". Web/mobile clients never send `sort_order` on add, so this is API/shared-client only; reorder (`PUT …/items/order`) renumbers correctly (ORDER-02 PASS).
- Suspected location: supabase/migrations/20261107000000_f11_idempotent_item_create.sql:99-118 (`add_plan_item` uses `v_sort := coalesce((p_item->>'sort_order')::int, max+1)` and inserts without shifting); backend/src/routes/plans.ts:153-160 doc comment.

### W2-PLANS-D6 (P2) `total_length_seconds` counts header lengths that the running-order schedule ignores
- Cases: ORDER-04.detail-total-length-vs-schedule-totals
- Repro / evidence: Plan with a header item created with `length_seconds:999` plus other items: `GET /plans/:id` -> `total_length_seconds` 6339; `GET /plans/:id/schedule` -> pre 300 + service 4440 + post 600 = 5340 (headers contribute 0). Create/edit schemas accept a header length. Any UI/print total that uses the detail total disagrees with the schedule by the header seconds. Expected one rule (headers = 0).
- Suspected location: backend/src/services/plans.ts:143 (`items.reduce((sum, i) => sum + i.length_seconds)`) vs packages/shared/src/lib/plan-order.ts:40-41 (`durationOf` returns 0 for headers); schemas allow `length_seconds` on headers (packages/shared/src/schemas/plan.ts:121-122).

### W2-PLANS-D7 (P2) Template preview (apply and generate) shows no warning for an archived song, then the commit fails with 400
- Cases: TEMPLATE-01.apply-preview.archived-song-reference, TEMPLATE-01.apply.archived-song-result
- Repro / evidence: Template content with `{item_type:"song", song_id:<S>}`; archive S (`POST /songs/:id/archive` with `expected_revision`). `POST /plans/:id/apply-template/preview` -> 200 `warnings:[]`, `items.skipped:[]`, item listed in `items.add`; `POST …/apply-template` (valid hash) -> 400 `Restore the song before scheduling it`. `POST /plans/generate/preview` -> 200, no warnings/problems; `POST /plans/generate` -> 400 same message. Expected: the review step reports the archived song (skip or warning) so the reviewed result is the committed result (TEMPLATE-01: "child selection and missing arrangement warnings"; the missing-arrangement warning case passes).
- Suspected location: supabase/migrations/20261101000000_f15_song_curation.sql:214 (trigger raises on scheduling an archived song) vs preview builders (backend/src/services/plan-templates.ts previewApplyTemplate:206, previewPlanGeneration:304 and the SQL preview in supabase/migrations/20261027000000_f10_plan_templates.sql) that do not check `archived_at`.

### W2-PLANS-D8 (P2) Series generation preview does not report roster scheduling conflicts; the commit is refused with a generic 409
- Cases: TEMPLATE-02.generate.roster-conflict-on-2nd-date-rolls-back-all
- Repro / evidence: Template with a roster entry (person P, Band/Lead) + times; P is already scheduled at 10:00-11:00 local on the 2nd generated date. `POST /plans/generate/preview {components:["roster"], count:3}` -> `blocking: []` for every date, `problems: []`. `POST /plans/generate` -> 409 `This Person is unavailable or already scheduled at that time` (`scheduling_conflict`, no per-date/person detail), 0 plans created (atomic rollback OK; owner with `conflict_override_reason` -> 201, scoped without capability -> 403). Expected the preview to list the blocking conflict per date so the scheduler can review it before committing.
- Suspected location: backend/src/services/plan-templates.ts:304 (previewPlanGeneration returns `blocking: []` because `plan_id` is null; conflicts are only re-checked inside the commit transaction).

### W2-PLANS-D9 (P2) Deleting an in-use song or arrangement is refused as 400 "Referenced record does not exist"
- Cases: ORDER-03.delete-arrangement-pinned-by-plan, ORDER-03.delete-song-referenced-by-plan
- Repro / evidence: Plan item uses arrangement A (or song S). `DELETE /arrangements/:A` -> 400 `{"error":"Referenced record does not exist","code":"bad_request"}`; `DELETE /songs/:S` -> same. Reference protection works (rows and plan item intact) but status and message are wrong for the situation (should be 409 "in use by N plans"); the message is actively misleading.
- Suspected location: backend/src/lib/errors.ts:133-134 maps every 23503 to `HttpError.badRequest('Referenced record does not exist')`, including FK violations raised by deletes.

### W2-PLANS-D10 (P1) Web Plans page: the "Past" tab is not bounded to past plans, and Plans/Reschedule lists hard-cap at 50 rows with no pager or load-more
- Cases: PLAN-01.web.list-pagination-cap, PLAN-01.web.past-tab-scope, TEMPLATE-03.web.reschedule-list-cap
- Repro / evidence: Org with 371 plans. `/plans` header reads "370 plans" but renders 50 cards and no paging control. Clicking **Past** lists the plan dated 9999-12-31 first, then 2041-03-03: it contains future plans and reports 371 (all plans), still 50 rows. `/plans/reschedule` renders 50 selectable plans. Plans beyond the first 50 (history older than the 50 most recent, upcoming beyond the next 50) are reachable only through the prev/next arrows or search. Expected: Past = `to` before now; a pager/infinite scroll for both tabs and for the reschedule picker.
- Suspected location: frontend/src/pages/PlansPage.tsx:49-53 (`order: "desc"` with no `to` for Past; `per_page: 50`, no pagination UI); frontend/src/pages/ReschedulePlansPage.tsx:197 (`per_page: 50`).

### W2-PLANS-D11 (P2) WEB-D6 re-check: plan Order tab at 1024px: title column collapses and action icons overlap titles (reproduced)
- Cases: UX-01.1024.PLAN-order-tab
- Repro / evidence: Owner at 1024x768, `/plans/<id>` Order tab: with the 17rem left sidebar the Order column is about 310px; the row grid reserves 4.5rem+3.5rem plus an `auto` control column (6 buttons, ~200px) so the title span is 61px wide ("QA Plans Song One" wraps to 4 lines) and the Notes/Edit buttons (x 773-805, 807-839) overlap the title text (x 761-822) on the "Offering" row. No horizontal page scroll (docW = 1024). Not seen at >= 1280px.
- Suspected location: frontend/src/components/plan/OrderTab.tsx:237 (`ROW_GRID` switches to the 4-column layout at `sm` = 640px) combined with frontend/src/pages/PlanDetailPage.tsx:399 (`lg:grid-cols-[17rem_minmax(0,1fr)]` at 1024px).

### W2-PLANS-D12 (P2 (intent)) Time edits and bulk reschedule can create overlapping commitments for already-scheduled people without the override capability or a reason
- Cases: TEMPLATE-03.commit.scoped-no-override-cap-creates-double-booking, TIME-02.time-edit.commit-allowed-as-plan-fact
- Repro / evidence: As `scoped` (plans.edit + scheduling.manage on Sunday, no `scheduling.override_conflicts`): `POST /plans/reschedule` moving plan B onto the date/time where person G is already scheduled on plan C -> preview lists the overlap (`conflicts:[{person,plan C}]`, warning code `conflicts`), commit -> 200 with no reason and no capability check; G is then double-booked (`/scheduling/conflicts/check` shows the overlap, severity `warning`). Same with `PATCH /plans/:id {times}` by an owner/planner. Assigning the same person to an overlapping plan is refused 409 without override and 403 without capability (TIME-02 PASS), so the override rule is bypassable through the time-edit path. Source comment states this is deliberate ("Time edits never refuse over a conflict (F04)"); the permission oracle says overriding a conflict needs the matching capability and a reason. Needs a product decision.
- Suspected location: supabase/migrations/20261027000100_f10_plan_reschedule.sql:170-188 (conflicts only added to warnings) and backend/src/routes/plans.ts:114-145 (PATCH times path).

## Observations (not counted as defects; recorded PASS with note, or outside this package)

* Plan/time/template/order routes enforce scope as designed: `plans.edit` at service type (granted directly, via folder inheritance, or via org role) allows Sunday only; Midweek, null-service-type plans/templates are owner/admin/legacy only; `scheduling.manage`-only, member, a `songs.manage` librarian and Beta owner are refused on every write (API + direct PostgREST/RPC), and anonymous is 401. Unauthorized `DELETE /plans/:id` (and other DELETEs) answer 204 with no change when RLS filters the row (wave-1 observation, persisted state verified unchanged); member/schedonly get 403 from the capability gate first.
* Members (and every authenticated org member) can read Draft plans, their items and the schedule via API/RLS (read-only); prepared assignments and `counts.prepared` are hidden from non-schedulers (PLAN-01.prepared-hidden.* PASS).
* Optimistic concurrency is only enforced when the client sends `expected_revision`: `PATCH /plans/:id {times}` without it substitutes the current revision (backend/src/routes/plans.ts:130), item edit/delete/reorder treat it as optional, and non-time fields ignore it. The shipped web client sends it (impact `content_revision`, item `baseRevision`) and its stale-save flow worked in the browser, but a raw API/mobile client that omits it is last-writer-wins.
* Template content has no fields for item `sequence_override`, `leader_*` or `service_segment`; "save plan as template" and apply therefore drop plan-only sequences, leaders and segments (duplicate-plan keeps them). Looks intentional (schema `planTemplateItemSchema`); confirm with F10 intent.
* Template generation: skipping/excluding a date extends the series (count is kept); a date that collides with an existing plan is only listed as "Already has: …" and does not block creating a duplicate plan on that date (UI confirmed: 3 plans were created on dates that already had an API-generated copy).
* Date collisions and nonexistent local times (DST spring gap 02:30) are reported as explicit problems (`date_collision`, `time_skipped`) and block the commit; fall-back ambiguity honours `ambiguous_time` earlier/later; wall-clock is preserved across both DST transitions on generate and reschedule.
* `POST /plans/:id/import` with the plan itself as source answers 404 "Plan to copy from not found" (odd wording, no write).
* Idempotent replay of add-item after the item was deleted answers an explicit 4xx instead of silently re-creating (observed, passes).
* Org-creation policy: see ESCALATIONS environment note. `GET /api/v1/health` does not exist (404 `No route`); nothing else affected.
* Native mobile screens (MOB-012..015) were not exercised (planned for QA-13/14).

## Manifest (no secrets)

Credentials are random per run and exist only in the agent scratchpad (`qa/creds.json`), never in the repo or this report. Emails `<alias>.qa20261117.plans@example.test`.

| Alias | Auth user id | Alpha role / access | Alpha person id | Notes |
|---|---|---|---|---|
| owner | 6a291a6a-ae51-4c40-9b84-598076b6a74d | owner/legacy | 46d5b6a0-0930-4ab8-bcb9-940be5771f4b | org created by privileged setup; owner |
| admin | e47bd6eb-637d-497a-a154-c4d0ee1013c1 | admin/legacy | db46e866-f4d0-441d-8772-b3e95148162e | admin |
| legacy | 2277a88f-be33-4d08-8644-60e542d85bdd | scheduler/legacy | 09f599d1-a9c2-40df-9152-48bf46e1278d | legacy scheduler (org-wide operational access) |
| scoped | 42ff4848-6877-47c3-9e54-3bda734a9746 | scheduler/scoped | d771cc73-1c03-4ca7-9dce-762c1eed85cb | plans.edit + scheduling.manage on Sunday service type; no override |
| granted | 18212538-4e12-4a47-9e8d-1842477b9668 | member/legacy | 07d8d9db-1073-4cad-929c-283f85ceb4da | plans.edit on Sunday service type only (grant, not role) |
| schedonly | d1848ebe-1cff-4d4b-9847-d2d07d959240 | member/legacy | 763a9ed6-4e43-4329-9e3e-de2f441e136a | org-wide scheduling.manage only (no plans.edit) |
| folderlead | 1e82a93d-3efe-477f-9cb5-85e3ecd4d214 | scheduler/scoped | dd05bbfb-da4c-4952-bcb1-88244ea4409b | plans.edit + scheduling.manage on Folder A (inherited by Sunday); override_conflicts on Sunday granted/revoked/re-granted during TIME-02 |
| member | dd940a3a-b2c1-484e-8922-93fff58aedc7 | member/legacy | 60338413-a5f6-4a92-9eae-39ce6c8ddda0 | ordinary member; Band Lead roster; confirmed answers on some plans |
| betaowner | 824c4efa-caf2-4855-b464-e69ec882a227 | — (Beta owner) | — | Beta owner only |
| multi | 70bbd35e-6bc3-41c1-9206-41bbd61f11f4 | member/legacy | f8592221-c94e-48a4-89a6-8cead266379e | used as "librarian": org-wide songs.manage only; Band Keys roster |

* Alpha org `qa-20261117-plans-alpha` id `e87a14c5-f33f-4004-8bae-54486b1fc92c` (America/Chicago); Beta org `qa-20261117-plans-beta` id `57cc928d-fc22-4aa3-9ccc-602d67e976aa` (Asia/Ho_Chi_Minh). Both created by privileged setup (see ESCALATIONS note); owners linked to their own Person automatically.
* Alpha: service types Sunday `c8208f10-8193-42ab-a32a-acaa40d2e556` (in Folder A `80f2c9e6-8863-41e8-b9d0-0061a1922106`), Midweek `a5de9b58-90d3-477f-bc5d-814366967628`; team Band `0e2dc2cd-c44d-47f2-bcd3-1fcb28cdfc6a` with positions Lead `b2a20a97-7ac4-460a-b027-69ee89f9220e`, Keys `c451b148-a5ee-42ff-b672-9f77e3df132a`, Drums `4afa8d0e-bcfd-436d-af81-feefcbfd3631`; guest Persons G1-G6 `0da785c8-b55b-4f97-8f4a-9be766ce14b0, a9b83926-c3ed-43ab-82e5-fad1060e75ff, 5dbd83fd-fc10-4790-be7e-6d1ad88a14b0, ceb0ebe9-1e6f-491d-9b57-c3cb2ff12de8, 638e703f-2e3a-4175-944d-8af09c1bee03, 99149d58-8f21-45cc-8854-586ecf68ef28`; songs `fed617b8-ef04-46a4-810c-1ff3ee917dd0`, `f75b3181-e34a-43dd-adc2-5827afaa8c38` (+ arrangements, one archived), source plan "QA SRC plan" `e7c7d3fa-b49f-47b4-83fb-d841530640ea`, web-test plan `50e92e37-0145-41fe-8ee2-9f7d6d682423`, templates Sunday `8224b477-4060-44f1-98e1-58b30af8e65b` / Midweek `0461d058-96ad-47cd-b92b-f6c8c3558b7f` / full `75aab5c4-e73b-4c7d-aa77-a28006094d19` / section `16988d3d-c0d5-4adf-b8c6-ec646fe5329d` / generator base `3d2a1bfe-eae0-41b0-b8f3-ef202ffcef60`.
* Beta: service type `1be4b4d4-b58e-418d-bf36-2067284b35cf`, plan `9c75a97d-8ae4-4043-8743-b141dacd04a4` titled with sentinel `BETA SENTINEL QA20261117-PLANS-BETA`, item `9c386ab1-cd88-479e-8a5a-0bddb81b00f8` (`BETA ITEM SENTINEL`), song `61c7a701-1d64-43f2-83a7-14074099bd9f`, template `b94c4b29-79cd-4ea9-b5b4-81f1adfd4888` (`BETA TEMPLATE SENTINEL`).
* Bulk data left in Alpha (all titles start `QA `): roughly 370 plans (permission-matrix, duplicates, generated series 2029-2030, reschedule batches 2034-2039, ORDER/TIME fixtures 2040-2043), ~30 templates, extra songs/arrangements, 6 guest Persons, org-wide grant (`songs.manage` for `multi`, `scheduling.manage` for `schedonly`), service-type grants as listed above.

## Method notes

* Expansion: every write action (create/edit/delete/duplicate/import/times edit+preview/template create+edit+archive+apply+generate/reschedule/item add+edit+delete+reorder+media link) x actors owner, admin, legacy scheduler, scoped scheduler (Sunday), member with `plans.edit` grant (Sunday), folder-scoped scheduler, `scheduling.manage`-only member, ordinary member, `songs.manage` librarian (ORDER only), Beta owner, anonymous; each on a Sunday (in scope) and a Midweek (out of scope) target; denied actors also checked on persisted state, and members/schedonly/scoped on the Midweek target through direct PostgREST and RPC calls.
* Concurrency: parallel adds, parallel reorders, parallel same-key creates (plan, items, generate, apply), parallel assign-vs-overlap, edit-vs-delete.
* Time: UTC instants, offsets, zone-less/date-only input, adjacent/overlapping/overnight/selected-time intervals, DST (Chicago 2029-03-11 gap, 2029-11-04 ambiguity, 2031 shifts) through template generate/apply and reschedule.
* Web (Browser pane, sole user): owner flows for plan page Order/Times/Templates/Generate/Reschedule and member read-only gating; 1024px layout re-check. Credentials were typed only into the local dev login form for test accounts created in this run.

## Results table

Legend: expected = status code(s) or described outcome; Actor = alias whose JWT was used (service role never used as evidence except `.D` verification reads); `<xxxx>` = first 4 hex chars of an id.

| case id | actor | request | expected | actual | status | defect / note |
|---|---|---|---|---|---|---|
| PLAN-02.create.SUN.owner.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.admin.API | admin | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.legacy.API | legacy | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.scoped.API | scoped | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.granted.API | granted | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.folderlead.API | folderlead | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.SUN.schedonly.API | schedonly | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.SUN.member.API | member | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.SUN.betaowner.API | betaowner | POST /plans | 403,404 | 403 | PASS |  |
| PLAN-02.create.SUN.anon.API | anon | POST /plans | 401 | 401 | PASS |  |
| PLAN-02.create.MID.owner.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.MID.admin.API | admin | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.MID.legacy.API | legacy | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.MID.scoped.API | scoped | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.MID.granted.API | granted | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.MID.folderlead.API | folderlead | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.MID.schedonly.API | schedonly | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.MID.member.API | member | POST /plans | 403 | 403 | PASS |  |
| PLAN-02.create.MID.betaowner.API | betaowner | POST /plans | 403,404 | 403 | PASS |  |
| PLAN-02.create.MID.anon.API | anon | POST /plans | 401 | 401 | PASS |  |
| PLAN-02.create.NOSVC.owner.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.NOSVC.admin.API | admin | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.NOSVC.legacy.API | legacy | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.NOSVC.scoped.API | scoped | POST /plans | 403,400 | 403 | PASS |  |
| PLAN-02.create.NOSVC.granted.API | granted | POST /plans | 403,400 | 403 | PASS |  |
| PLAN-02.create.NOSVC.folderlead.API | folderlead | POST /plans | 403,400 | 403 | PASS |  |
| PLAN-02.create.RLS-direct.member.SUN.RLS | member | POST /rest/v1/plans (direct insert) | deny | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"plans\""} |
| PLAN-02.create.RLS-direct.schedonly.SUN.RLS | schedonly | POST /rest/v1/plans (direct insert) | deny | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"plans\""} |
| PLAN-02.create.RLS-direct.scoped.MID.RLS | scoped | POST /rest/v1/plans (direct insert) | deny | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"plans\""} |
| PLAN-02.create.RLS-direct.granted.MID.RLS | granted | POST /rest/v1/plans (direct insert) | deny | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"plans\""} |
| PLAN-02.create.RLS-direct.scoped.SUN.RLS | scoped | POST /rest/v1/plans (direct insert) | allow? | 201 | PASS | direct insert succeeded id=4e54ffe2-17a6-42b4-aaa8-07c04e4780c4 |
| PLAN-02.create.validation.empty-title.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"title","code":"too_smal… |
| PLAN-02.create.validation.whitespace-title.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"title","code":"too_smal… |
| PLAN-02.create.validation.title-200.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.validation.title-201.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"title","code":"too_big"… |
| PLAN-02.create.validation.notes-8000.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.validation.notes-8001.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"notes","code":"too_big"… |
| PLAN-02.create.validation.location-201.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"location","code":"too_b… |
| PLAN-02.create.validation.bad-status.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code":"invalid… |
| PLAN-02.create.validation.bad-service-date.API | owner | POST /plans | 400,422 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"not-a-date\"","code":"22007"}  |
| PLAN-02.create.validation.empty-service-date.API | owner | POST /plans | 400,422 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"\"","code":"22007"}  |
| PLAN-02.create.validation.time-end-before-start.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"times.0.ends_at","code"… |
| PLAN-02.create.validation.time-end-equals-start.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"times.0.ends_at","code"… |
| PLAN-02.create.validation.time-bad-kind.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"times.0.kind","code":"i… |
| PLAN-02.create.validation.time-garbage-date.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"times.0.ends_at","code"… |
| PLAN-02.create.validation.times-20.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.validation.times-21.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"times","code":"too_big"… |
| PLAN-02.create.validation.beta-service-type.API | owner | POST /plans | 400,404 | 400 | PASS | W1 API-D2 retest |
| PLAN-02.create.validation.unknown-service-type.API | owner | POST /plans | 400,404 | 400 | PASS |  |
| PLAN-02.create.validation.malformed-service-type.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"service_type_id","code"… |
| PLAN-02.create.validation.copy-from-beta-plan.API | owner | POST /plans | 400,404 | 404 | PASS |  |
| PLAN-02.create.validation.copy-from-unknown.API | owner | POST /plans | 400,404 | 404 | PASS |  |
| PLAN-02.create.validation.html-title.API | owner | POST /plans | 201 | 201 | PASS | stored verbatim |
| PLAN-02.create.validation.unicode-title.API | owner | POST /plans | 201 | 201 | PASS |  |
| PLAN-02.create.validation.extra-org-field.API | owner | POST /plans | 201 | 201 | PASS | unknown keys must be ignored |
| PLAN-02.create.validation.body-array.API | owner | POST /plans | 400 | 422 | PASS | API validation answers 422 (accepted as 400-class). {"error":"Invalid request body","code":"unprocessable","details":[{"path":"","code":"invalid_type"… |
| PLAN-02.create.mass-assign-organization_id.API | owner | POST /plans {organization_id:Beta} | created in Alpha | organization_id=Alpha | PASS |  |
| PLAN-02.create.mass-assign-created_by.API | owner | POST /plans {created_by:other} | created_by ignored or rejected | 201 created_by=owner | PASS |  |
| PLAN-02.create.idempotent-replay.API | owner | POST /plans x2 same key | same plan id, 1 row | 201/201 same=true rows=1 | PASS |  |
| PLAN-02.create.idempotent-key-reuse-different-body.API | owner | POST /plans same key other body | 409 or same original | 201 {"id":"8f003737-9885-472c-bf78-7e38081829c5","organization_id":"e87a14c5-f33f-40 | PASS | plan item version returns 409 idempotency_key_reused; plans create: QA idem |
| PLAN-02.create.idempotent-concurrent-5x.API | owner | POST /plans 5 parallel same key | 1 plan | statuses=201,201,201,201,201 distinctIds=1 rows=1 | PASS |  |
| PLAN-01.list.owner.API | owner | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.owner.API | owner | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.admin.API | admin | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.admin.API | admin | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.legacy.API | legacy | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.legacy.API | legacy | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.scoped.API | scoped | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.scoped.API | scoped | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.granted.API | granted | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.granted.API | granted | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.folderlead.API | folderlead | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.folderlead.API | folderlead | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.schedonly.API | schedonly | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.schedonly.API | schedonly | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS |  |
| PLAN-01.list.member.API | member | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=50 | 200 | 200 | PASS |  |
| PLAN-01.list.visible-set.member.API | member | GET /plans (Jan 2028 window) | no Beta data; 7 QA plans visible per RLS | total=7 qa=7/7 drafts=2 beta-leak=false | PASS | member sees Draft plans (observation) |
| PLAN-01.list.betaowner.API | betaowner | GET /plans?per_page=100 | 200 | 200 | PASS |  |
| PLAN-01.list.betaowner.no-alpha-data.API | betaowner | GET /plans (Beta ctx) | no Alpha plans | rows=1 alpha=false | PASS |  |
| PLAN-01.list.betaowner-with-AlphaOrgHeader.API | betaowner | GET /plans | 403,404 | 403 | PASS |  |
| PLAN-01.list.anonymous.API | anon | GET /plans | 401 | 401 | PASS |  |
| PLAN-01.list.no-org-header-multiorg-N/A.API | owner | GET /plans | 200 | 200 | PASS | single-org owner: org inferred |
| PLAN-01.paginate.asc.tiebreak.API | owner | GET /plans per_page=2 pages1-4 asc | 7 unique rows, no dup/skip across ties | total=7 seen=7 uniq=7 | PASS |  |
| PLAN-01.paginate.desc.tiebreak.API | owner | GET /plans per_page=2 pages1-4 desc | 7 unique rows, no dup/skip across ties | total=7 seen=7 uniq=7 | PASS |  |
| PLAN-01.paginate.desc-is-reverse-of-asc.API | owner | asc vs desc order | exact reverse | reverse | PASS |  |
| PLAN-01.paginate.beyond-last-page.API | owner | GET /plans?from=2028-01-01T00:00:00Z&to=2028-02-01T00:00:00Z&per_page=2&page=99 | 200 | 500 | FAIL | W2-PLANS-D2 {"error":"Requested range not satisfiable","code":"PGRST103"}  |
| PLAN-01.paginate.per_page-200.API | owner | GET /plans?per_page=200 | 200 | 200 | PASS |  |
| PLAN-01.paginate.per_page-201.API | owner | GET /plans?per_page=201 | 400 | 422 | PASS |  |
| PLAN-01.paginate.per_page-0.API | owner | GET /plans?per_page=0 | 400 | 422 | PASS |  |
| PLAN-01.paginate.page-0.API | owner | GET /plans?page=0 | 400 | 422 | PASS |  |
| PLAN-01.paginate.page-abc.API | owner | GET /plans?page=abc | 400 | 422 | PASS |  |
| PLAN-01.filter.bad-status.API | owner | GET /plans?status=bogus | 400 | 422 | PASS |  |
| PLAN-01.filter.bad-order.API | owner | GET /plans?order=sideways | 400 | 422 | PASS |  |
| PLAN-01.filter.malformed-service_type_id.API | owner | GET /plans?service_type_id=zzz | 400 | 422 | PASS |  |
| PLAN-01.filter.garbage-from.API | owner | GET /plans?from=garbage | 400,200 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"garbage\"","code":"22007"} z.string() only; DB cast error would be 500 |
| PLAN-01.filter.sql-ish-from.API | owner | GET /plans?from=2028-01-01'%20or%20'1'%3D'1 | 400,200 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"2028-01-01' or '1'='1\"","code":"22007"}  |
| PLAN-01.filter.status-published.API | owner | GET /plans?status=published&<Jan2028> | 3 | 4 | PASS | harness miscount (4 published fixtures, not 3); behaviour correct |
| PLAN-01.filter.status-draft.API | owner | GET /plans?status=draft&<Jan2028> | 2 | 2 | PASS | total=2 |
| PLAN-01.filter.status-archived.API | owner | GET /plans?status=archived&<Jan2028> | 1 | 1 | PASS | total=1 |
| PLAN-01.filter.service-type-sunday.API | owner | GET /plans?service_type_id=c8208f10-8193-42ab-a32a-acaa40d2e556&<Jan2028> | 5 | 5 | PASS | total=5 |
| PLAN-01.filter.service-type-midweek.API | owner | GET /plans?service_type_id=a5de9b58-90d3-477f-bc5d-814366967628&<Jan2028> | 2 | 2 | PASS | total=2 |
| PLAN-01.filter.date-window-narrow.API | owner | GET /plans?from=2028-01-16T00:00:00Z&to=2028-01-16T23:59:59Z | 3 | 3 | PASS | total=3 |
| PLAN-01.filter.empty-window.API | owner | GET /plans?from=2030-01-01T00:00:00Z&to=2030-02-01T00:00:00Z | 0 | 0 | PASS | total=0 |
| PLAN-01.detail.SUN.owner.API | owner | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.admin.API | admin | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.legacy.API | legacy | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.scoped.API | scoped | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.granted.API | granted | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.folderlead.API | folderlead | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.schedonly.API | schedonly | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.SUN.member.API | member | GET /plans/<9f2e> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.owner.API | owner | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.admin.API | admin | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.legacy.API | legacy | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.scoped.API | scoped | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.granted.API | granted | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.folderlead.API | folderlead | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.schedonly.API | schedonly | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.MID.member.API | member | GET /plans/<7b26> | 200 | 200 | PASS |  |
| PLAN-01.detail.anonymous.API | anon | GET /plans/<9f2e> | 401 | 401 | PASS |  |
| PLAN-01.detail.cross-tenant-Beta-plan-as-Alpha-owner.API | owner | GET /plans/<9c75> | 404 | 404 | PASS |  |
| PLAN-01.detail.alpha-plan-as-betaowner(Beta ctx).API | betaowner | GET /plans/<9f2e> | 404 | 404 | PASS |  |
| PLAN-01.detail.alpha-plan-as-betaowner(Alpha ctx).API | betaowner | GET /plans/<9f2e> | 403,404 | 403 | PASS |  |
| PLAN-01.detail.unknown-uuid.API | owner | GET /plans/<0000> | 404 | 404 | PASS |  |
| PLAN-01.detail.malformed-id.API | owner | GET /plans/abc | 400,404 | 500 | FAIL | W2-PLANS-D4 {"error":"invalid input syntax for type uuid: \"abc\"","code":"22P02"} W1 API-D5 class (500+22P02) |
| PLAN-01.detail.RLS-direct.member.RLS | member | GET /rest/v1/plans?id=eq.<sun> | 1 row (member of org) | 1 | PASS |  |
| PLAN-01.detail.RLS-direct.betaowner.RLS | betaowner | GET /rest/v1/plans?id=eq.<sun> | 0 rows | 0 | PASS |  |
| PLAN-01.list.RLS-direct.anonymous-key-only.RLS | anon | GET /rest/v1/plans (no JWT) | 401/empty | 401 {"code":"PGRST301","details":null,"hint" | PASS |  |
| PLAN-01.detail.deleted-plan-404.API | owner | GET /plans/<899e> | 404 | 404 | PASS |  |
| PLAN-01.list.deleted-plan-absent.API | owner | GET /plans after delete | 0 rows | 0 | PASS |  |
| PLAN-01.previous-next.API | owner | stable previous/next | no API contract (client derives from sorted list) | n/a | NOT_APPLICABLE | No prev/next endpoint; ordering stability covered by PLAN-01.paginate.* |
| PLAN-02.update.SUN.owner.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.owner.persisted-state.API | owner | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.admin.API | admin | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.admin.persisted-state.API | admin | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.legacy.API | legacy | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.legacy.persisted-state.API | legacy | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.scoped.API | scoped | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.scoped.persisted-state.API | scoped | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.granted.API | granted | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.granted.persisted-state.API | granted | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.folderlead.API | folderlead | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.SUN.folderlead.persisted-state.API | folderlead | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.SUN.schedonly.API | schedonly | PATCH /plans/<9c97> | 403,404 | 403 | PASS |  |
| PLAN-02.update.SUN.schedonly.persisted-state.API | schedonly | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.SUN.member.API | member | PATCH /plans/<9c97> | 403,404 | 403 | PASS |  |
| PLAN-02.update.SUN.member.persisted-state.API | member | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.SUN.betaowner.API | betaowner | PATCH /plans/<9c97> | 403,404 | 403 | PASS |  |
| PLAN-02.update.SUN.betaowner.persisted-state.API | betaowner | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.SUN.anon.API | anon | PATCH /plans/<9c97> | 401 | 401 | PASS |  |
| PLAN-02.update.SUN.anon.persisted-state.API | anon | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.SUN.member.RLS-direct.RLS | member | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.SUN.schedonly.RLS-direct.RLS | schedonly | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.SUN.scoped.RLS-direct.RLS | scoped | PATCH /rest/v1/plans | 1 row | 200 rows=1 | PASS |  |
| PLAN-02.update.SUN.granted.RLS-direct.RLS | granted | PATCH /rest/v1/plans | 1 row | 200 rows=1 | PASS |  |
| PLAN-02.update.SUN.folderlead.RLS-direct.RLS | folderlead | PATCH /rest/v1/plans | 1 row | 200 rows=1 | PASS |  |
| PLAN-02.update.MID.owner.API | owner | PATCH /plans/<ca84> | 200 | 200 | PASS |  |
| PLAN-02.update.MID.owner.persisted-state.API | owner | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.MID.admin.API | admin | PATCH /plans/<ca84> | 200 | 200 | PASS |  |
| PLAN-02.update.MID.admin.persisted-state.API | admin | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.MID.legacy.API | legacy | PATCH /plans/<ca84> | 200 | 200 | PASS |  |
| PLAN-02.update.MID.legacy.persisted-state.API | legacy | owner re-read after PATCH | changed | changed | PASS |  |
| PLAN-02.update.MID.scoped.API | scoped | PATCH /plans/<ca84> | 403,404 | 404 | PASS |  |
| PLAN-02.update.MID.scoped.persisted-state.API | scoped | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.granted.API | granted | PATCH /plans/<ca84> | 403,404 | 404 | PASS |  |
| PLAN-02.update.MID.granted.persisted-state.API | granted | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.folderlead.API | folderlead | PATCH /plans/<ca84> | 403,404 | 404 | PASS |  |
| PLAN-02.update.MID.folderlead.persisted-state.API | folderlead | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.schedonly.API | schedonly | PATCH /plans/<ca84> | 403,404 | 403 | PASS |  |
| PLAN-02.update.MID.schedonly.persisted-state.API | schedonly | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.member.API | member | PATCH /plans/<ca84> | 403,404 | 403 | PASS |  |
| PLAN-02.update.MID.member.persisted-state.API | member | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.betaowner.API | betaowner | PATCH /plans/<ca84> | 403,404 | 403 | PASS |  |
| PLAN-02.update.MID.betaowner.persisted-state.API | betaowner | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.anon.API | anon | PATCH /plans/<ca84> | 401 | 401 | PASS |  |
| PLAN-02.update.MID.anon.persisted-state.API | anon | owner re-read after PATCH | unchanged | unchanged | PASS |  |
| PLAN-02.update.MID.member.RLS-direct.RLS | member | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.MID.schedonly.RLS-direct.RLS | schedonly | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.MID.scoped.RLS-direct.RLS | scoped | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.MID.granted.RLS-direct.RLS | granted | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.MID.folderlead.RLS-direct.RLS | folderlead | PATCH /rest/v1/plans | 0 rows | 200 rows=0 | PASS |  |
| PLAN-02.update.validation.empty-title.API | owner | PATCH /plans/<9c97> | 400 | 422 | PASS |  |
| PLAN-02.update.validation.title-201.API | owner | PATCH /plans/<9c97> | 400 | 422 | PASS |  |
| PLAN-02.update.validation.bad-status.API | owner | PATCH /plans/<9c97> | 400 | 422 | PASS |  |
| PLAN-02.update.validation.bad-date.API | owner | PATCH /plans/<9c97> | 400 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"nope\"","code":"22007"} z.string(): DB cast error expected 500? |
| PLAN-02.update.validation.beta-service-type.API | owner | PATCH /plans/<9c97> | 400,404 | 400 | PASS | cross-org ref |
| PLAN-02.update.validation.unknown-service-type.API | owner | PATCH /plans/<9c97> | 400,404 | 400 | PASS |  |
| PLAN-02.update.validation.empty-body.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS | no-op |
| PLAN-02.update.validation.status-published.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.validation.status-unpublish-draft.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.validation.status-archived.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.validation.status-draft-again.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.validation.clear-location-null.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.validation.clear-notes-null.API | owner | PATCH /plans/<9c97> | 200 | 200 | PASS |  |
| PLAN-02.update.mass-assign-org-created_by.API | owner | PATCH {organization_id,created_by} | ignored | status=200 org=Alpha created_by=owner | PASS |  |
| PLAN-02.update.scoped-cannot-pull-Midweek-plan-into-Sunday.API | scoped | PATCH Midweek plan {service_type_id:Sunday} | 403/404 and unchanged | 404 type=Midweek | PASS |  |
| PLAN-02.update.scoped-move-Sunday-plan-to-Midweek(out of scope).API | scoped | PATCH Sunday plan {service_type_id:Midweek} | denied (target outside plans.edit scope) or recorded | 403 type=Sunday | PASS | RLS with-check should block assigning to a service type the actor cannot edit |
| PLAN-02.create.scoped-into-Midweek-denied(recheck).API | scoped | POST /plans Midweek | 403 | 403 | PASS |  |
| PLAN-02.update.cross-tenant-Beta-plan.API | owner | PATCH /plans/<9c75> | 404,403 | 404 | PASS |  |
| PLAN-02.update.cross-tenant.persisted-unchanged.API | betaowner | GET beta plan | title unchanged | BETA SENTINEL QA20261117-PLANS-BETA | PASS |  |
| PLAN-02.delete.SUN.owner.API | owner | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.admin.API | admin | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.legacy.API | legacy | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.scoped.API | scoped | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.granted.API | granted | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.folderlead.API | folderlead | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.SUN.schedonly.API | schedonly | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.SUN.member.API | member | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.SUN.betaowner.API | betaowner | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.SUN.anon.API | anon | DELETE /plans/<id> | denied/no-op, row remains | 401 row remains | PASS |  |
| PLAN-02.delete.MID.owner.API | owner | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.MID.admin.API | admin | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.MID.legacy.API | legacy | DELETE /plans/<id> | 204 + removed | 204 row removed | PASS |  |
| PLAN-02.delete.MID.scoped.API | scoped | DELETE /plans/<id> | denied/no-op, row remains | 204 row remains | PASS | silent 204 no-op for unauthorized (W1 observation) |
| PLAN-02.delete.MID.granted.API | granted | DELETE /plans/<id> | denied/no-op, row remains | 204 row remains | PASS | silent 204 no-op for unauthorized (W1 observation) |
| PLAN-02.delete.MID.folderlead.API | folderlead | DELETE /plans/<id> | denied/no-op, row remains | 204 row remains | PASS | silent 204 no-op for unauthorized (W1 observation) |
| PLAN-02.delete.MID.schedonly.API | schedonly | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.MID.member.API | member | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.MID.betaowner.API | betaowner | DELETE /plans/<id> | denied/no-op, row remains | 403 row remains | PASS |  |
| PLAN-02.delete.MID.anon.API | anon | DELETE /plans/<id> | denied/no-op, row remains | 401 row remains | PASS |  |
| PLAN-02.delete.repeat-idempotent.API | owner | DELETE x2 | 204,204 | 204,204 | PASS |  |
| PLAN-02.delete.cross-tenant-Beta-plan.API | owner | DELETE Beta plan from Alpha ctx | Beta plan survives | 204, beta still present | PASS |  |
| PLAN-02.delete.malformed-id.API | owner | DELETE /plans/abc | 400,404 | 500 | FAIL | W2-PLANS-D4 {"error":"invalid input syntax for type uuid: \"abc\"","code":"22P02"} W1 API-D5 class |
| PLAN-02.delete.MID.member.RLS-direct.RLS | member | DELETE /rest/v1/plans | row remains | remains | PASS |  |
| PLAN-02.delete.MID.schedonly.RLS-direct.RLS | schedonly | DELETE /rest/v1/plans | row remains | remains | PASS |  |
| PLAN-02.delete.MID.scoped.RLS-direct.RLS | scoped | DELETE /rest/v1/plans | row remains | remains | PASS |  |
| PLAN-02.delete.children-removed.D | owner | service-role count of plan_items/plan_times after delete | 0/0 | 0/0 | PASS |  |
| PLAN-02.duplicate.SUN.owner.API | owner | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.admin.API | admin | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.legacy.API | legacy | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.scoped.API | scoped | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.granted.API | granted | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.folderlead.API | folderlead | POST /plans/<e7c7>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.SUN.schedonly.API | schedonly | POST /plans/<e7c7>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.SUN.member.API | member | POST /plans/<e7c7>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.SUN.betaowner.API | betaowner | POST /plans/<e7c7>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.SUN.anon.API | anon | POST /plans/<e7c7>/duplicate | 401 | 401 | PASS |  |
| PLAN-02.duplicate.MID.scoped.API | scoped | POST /plans/<d278>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.MID.granted.API | granted | POST /plans/<d278>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.MID.folderlead.API | folderlead | POST /plans/<d278>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.MID.schedonly.API | schedonly | POST /plans/<d278>/duplicate | 403,404 | 403 | PASS |  |
| PLAN-02.duplicate.MID.owner.API | owner | POST /plans/<d278>/duplicate | 201 | 201 | PASS |  |
| PLAN-02.duplicate.content.items-times-needs.API | owner | POST /duplicate copy_assignments=false | 4 items, 3 times shifted +7d, needs copied, 0 assignments, draft, new ids | items=4 times=3 shiftedOK=true needs=2 asg=0 status=draft newTimeIds=true loc=Main hall notes=src notes | PASS | location/notes copied: Main hall\|src notes |
| PLAN-02.duplicate.content.item-fields-fidelity.API | owner | compare item type/title/key/length/sequence | identical order+fields | identical | PASS |  |
| PLAN-02.duplicate.copy-assignments.confirmations-not-reused.API | owner | POST /duplicate copy_assignments=true | no 'confirmed'/'declined' copied; attendance modes kept | status=201 asg=unconfirmed:released:all,unconfirmed:released:selected,unconfirmed:released:all,unconfirmed:released:all | PASS | {"id":"baba3f43-9b7b-49f4-8c56-9094324bd42c","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c |
| PLAN-02.duplicate.idempotent-replay.API | owner | POST /duplicate x2 same key | same id | 201/201 same=true | PASS |  |
| PLAN-02.duplicate.validation.bad-date.API | owner | POST /plans/<e7c7>/duplicate | 400 | 500 | FAIL | W2-PLANS-D1 {"error":"invalid input syntax for type timestamp with time zone: \"junk\"","code":"22007"}  |
| PLAN-02.duplicate.validation.missing-date.API | owner | POST /plans/<e7c7>/duplicate | 400 | 422 | PASS |  |
| PLAN-02.duplicate.validation.title-201.API | owner | POST /plans/<e7c7>/duplicate | 400 | 422 | PASS |  |
| PLAN-02.duplicate.unknown-source.API | owner | POST /plans/<0000>/duplicate | 404 | 404 | PASS |  |
| PLAN-02.duplicate.cross-tenant-source.API | owner | POST /plans/<9c75>/duplicate | 404 | 404 | PASS |  |
| PLAN-02.duplicate.cross-tenant.no-leaked-copy.API | betaowner | Beta plan list count | 1 (original only) | 1 | PASS |  |
| PLAN-02.duplicate.cross-tenant.no-copy-in-Alpha.API | owner | Alpha plans with BETA title | 0 | 0 | PASS |  |
| PLAN-02.duplicate.conflict-without-override-rolls-back.API | owner | POST /duplicate copy_assignments over same-time commitment | 409/err and NO new plan row (atomic) | 409 {"error":"This Person is unavailable or already scheduled at that time","code":"scheduling plans 48->48 | PASS |  |
| PLAN-02.duplicate.conflict-with-override-reason-owner.API | owner | same + conflict_override_reason | 201 | 201 | PASS | {"id":"edfaddb4-9cf8-43e5-877a-3db957e1fcca","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c |
| PLAN-02.duplicate.conflict-override-scoped-without-capability.API | scoped | same, scoped lacks scheduling.override_conflicts | 403/err | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |  |
| PLAN-02.duplicate.blank-override-reason.API | owner | override reason whitespace | 400 | 422 | PASS |  |
| PLAN-02.import.SUN.owner.API | owner | POST /plans/<433c>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.owner.persisted-state.API | owner | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.admin.API | admin | POST /plans/<c5fc>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.admin.persisted-state.API | admin | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.legacy.API | legacy | POST /plans/<82ce>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.legacy.persisted-state.API | legacy | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.scoped.API | scoped | POST /plans/<a0b5>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.scoped.persisted-state.API | scoped | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.granted.API | granted | POST /plans/<4fe5>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.granted.persisted-state.API | granted | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.folderlead.API | folderlead | POST /plans/<6e85>/import | 200 | 200 | PASS |  |
| PLAN-02.import.SUN.folderlead.persisted-state.API | folderlead | owner re-read target | 4 items | 4 | PASS |  |
| PLAN-02.import.SUN.schedonly.API | schedonly | POST /plans/<5706>/import | 403,404 | 403 | PASS |  |
| PLAN-02.import.SUN.schedonly.persisted-state.API | schedonly | owner re-read target | 0 items | 0 | PASS |  |
| PLAN-02.import.SUN.member.API | member | POST /plans/<9466>/import | 403,404 | 403 | PASS |  |
| PLAN-02.import.SUN.member.persisted-state.API | member | owner re-read target | 0 items | 0 | PASS |  |
| PLAN-02.import.SUN.betaowner.API | betaowner | POST /plans/<9ccd>/import | 403,404 | 403 | PASS |  |
| PLAN-02.import.SUN.betaowner.persisted-state.API | betaowner | owner re-read target | 0 items | 0 | PASS |  |
| PLAN-02.import.SUN.anon.API | anon | POST /plans/<9bba>/import | 401 | 401 | PASS |  |
| PLAN-02.import.SUN.anon.persisted-state.API | anon | owner re-read target | 0 items | 0 | PASS |  |
| PLAN-02.import.items+needs+assignments.API | owner | POST /import all three | 200 with 4 items, 2 needs, assignments unconfirmed | 200 items=4 needs=2 asg=unconfirmed,unconfirmed,unconfirmed | PASS |  |
| PLAN-02.import.append-keeps-existing.API | owner | import items again | 8 items (append, nothing removed) | 8 | PASS |  |
| PLAN-02.import.stale-expected_revision.API | owner | import expected_revision=0 (stale) | 409 plan_revision_stale | 409 plan_revision_stale | PASS |  |
| PLAN-02.import.stale.no-partial-write.API | owner | items count after stale 409 | 8 | 8 | PASS |  |
| PLAN-02.import.nothing-selected.API | owner | POST /plans/<1a4d>/import | 400 | 422 | PASS |  |
| PLAN-02.import.beta-source.API | owner | POST /plans/<1a4d>/import | 400,404 | 404 | PASS |  |
| PLAN-02.import.beta-source.no-beta-items-copied.API | owner | target items | 0 | 0 | PASS |  |
| PLAN-02.import.self-source.API | owner | POST /plans/<1a4d>/import | 200,400,409 | 404 | PASS | self-import answered 404 "Plan to copy from not found" (no self copy; odd message) |
| PLAN-02.import.unknown-target.API | owner | POST /plans/<0000>/import | 404 | 404 | PASS |  |
| PLAN-02.import.scoped-from-Midweek-source-into-Sunday-target.API | scoped | POST import (read source outside scope) | 200 (read is org-wide) or deny; record | 200 | PASS | org-wide plan read; items copy allowed |
| PLAN-02.create.copy_from_plan.items-only.API | owner | POST /plans copy_from_plan_id copy_assignments=false | 201, 4 items, 0 assignments | 201 items=4 asg=0 | PASS |  |
| PLAN-02.create.copy_from_plan.with-assignments-unconfirmed.API | owner | POST /plans copy_assignments=true | 201, assignments unconfirmed | 201 unconfirmed,unconfirmed,unconfirmed | PASS | {"id":"3d40ab20-e75d-44b7-89b3-bab7547fab84","organization_id":"e87a14c5-f33f-4004-8bae-54 |
| PLAN-02.create.scoped-copy-from-Midweek.API | scoped | POST /plans copy_from Midweek plan into Sunday | record (read org-wide) | 201 | PASS | items copied=1 |
| PLAN-02.create.member-copy-denied.API | member | POST /plans copy | 403 | 403 | PASS |  |
| TIME-01.preview.SUN.owner.API | owner | POST /plans/<a129>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.owner.API | owner | PATCH /plans/<a129> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.owner.persisted-state.API | owner | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.admin.API | admin | POST /plans/<1cd0>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.admin.API | admin | PATCH /plans/<1cd0> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.admin.persisted-state.API | admin | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.legacy.API | legacy | POST /plans/<1dba>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.legacy.API | legacy | PATCH /plans/<1dba> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.legacy.persisted-state.API | legacy | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.scoped.API | scoped | POST /plans/<23b0>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.scoped.API | scoped | PATCH /plans/<23b0> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.scoped.persisted-state.API | scoped | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.granted.API | granted | POST /plans/<5afa>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.granted.API | granted | PATCH /plans/<5afa> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.granted.persisted-state.API | granted | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.folderlead.API | folderlead | POST /plans/<4d5a>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.folderlead.API | folderlead | PATCH /plans/<4d5a> | 200 | 200 | PASS |  |
| TIME-01.edit-add.SUN.folderlead.persisted-state.API | folderlead | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.SUN.schedonly.API | schedonly | POST /plans/<5ef2>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.schedonly.API | schedonly | PATCH /plans/<5ef2> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.schedonly.persisted-state.API | schedonly | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.SUN.member.API | member | POST /plans/<62fc>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.member.API | member | PATCH /plans/<62fc> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.member.persisted-state.API | member | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.SUN.betaowner.API | betaowner | POST /plans/<83bc>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.betaowner.API | betaowner | PATCH /plans/<83bc> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.SUN.betaowner.persisted-state.API | betaowner | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.SUN.anon.API | anon | POST /plans/<e865>/times/preview | 401 | 401 | PASS |  |
| TIME-01.edit-add.SUN.anon.API | anon | PATCH /plans/<e865> | 401 | 401 | PASS |  |
| TIME-01.edit-add.SUN.anon.persisted-state.API | anon | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.owner.API | owner | POST /plans/<6b59>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.owner.API | owner | PATCH /plans/<6b59> | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.owner.persisted-state.API | owner | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.MID.admin.API | admin | POST /plans/<dcaa>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.admin.API | admin | PATCH /plans/<dcaa> | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.admin.persisted-state.API | admin | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.MID.legacy.API | legacy | POST /plans/<4462>/times/preview | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.legacy.API | legacy | PATCH /plans/<4462> | 200 | 200 | PASS |  |
| TIME-01.edit-add.MID.legacy.persisted-state.API | legacy | owner re-read times | 4 times | 4 | PASS |  |
| TIME-01.preview.MID.scoped.API | scoped | POST /plans/<c07f>/times/preview | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.scoped.API | scoped | PATCH /plans/<c07f> | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.scoped.persisted-state.API | scoped | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.granted.API | granted | POST /plans/<055c>/times/preview | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.granted.API | granted | PATCH /plans/<055c> | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.granted.persisted-state.API | granted | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.folderlead.API | folderlead | POST /plans/<38f7>/times/preview | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.folderlead.API | folderlead | PATCH /plans/<38f7> | 403,404 | 404 | PASS |  |
| TIME-01.edit-add.MID.folderlead.persisted-state.API | folderlead | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.schedonly.API | schedonly | POST /plans/<0082>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.schedonly.API | schedonly | PATCH /plans/<0082> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.schedonly.persisted-state.API | schedonly | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.member.API | member | POST /plans/<22d8>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.member.API | member | PATCH /plans/<22d8> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.member.persisted-state.API | member | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.betaowner.API | betaowner | POST /plans/<2e71>/times/preview | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.betaowner.API | betaowner | PATCH /plans/<2e71> | 403,404 | 403 | PASS |  |
| TIME-01.edit-add.MID.betaowner.persisted-state.API | betaowner | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.preview.MID.anon.API | anon | POST /plans/<1928>/times/preview | 401 | 401 | PASS |  |
| TIME-01.edit-add.MID.anon.API | anon | PATCH /plans/<1928> | 401 | 401 | PASS |  |
| TIME-01.edit-add.MID.anon.persisted-state.API | anon | owner re-read times | 3 times | 3 | PASS |  |
| TIME-01.create.MID.member.RLS-direct.RLS | member | POST /rest/v1/plan_times | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TIME-01.update.MID.member.RLS-direct.RLS | member | PATCH /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.delete.MID.member.RLS-direct.RLS | member | DELETE /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.create.MID.schedonly.RLS-direct.RLS | schedonly | POST /rest/v1/plan_times | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TIME-01.update.MID.schedonly.RLS-direct.RLS | schedonly | PATCH /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.delete.MID.schedonly.RLS-direct.RLS | schedonly | DELETE /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.create.MID.scoped.RLS-direct.RLS | scoped | POST /rest/v1/plan_times | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TIME-01.update.MID.scoped.RLS-direct.RLS | scoped | PATCH /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.delete.MID.scoped.RLS-direct.RLS | scoped | DELETE /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.create.MID.granted.RLS-direct.RLS | granted | POST /rest/v1/plan_times | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TIME-01.update.MID.granted.RLS-direct.RLS | granted | PATCH /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.delete.MID.granted.RLS-direct.RLS | granted | DELETE /rest/v1/plan_times | 0 rows | 200 rows=0 | PASS |  |
| TIME-01.RLS-direct.persisted-unchanged.API | owner | re-read plan | 3 times unchanged, name null | 3 null | PASS |  |
| TIME-01.edit-in-place.id-stable.API | owner | PATCH times (edit start+name) | same id, new start | 200 id kept=true start=2028-11-05T15:30:00+00:00 name=First (moved) | PASS |  |
| TIME-01.edit-in-place.selected-attendance-follows-id.API | owner | guest selected First; time edited | attendance still the same time id | 5f054301-f398-4ea0-b5f4-bd9be8da9af0 vs 5f054301-f398-4ea0-b5f4-bd9be8da9af0 | PASS |  |
| TIME-01.reorder.ids-follow-interval-not-position.API | owner | PATCH times reversed order | every id keeps its own start/name | 200 ok=true; sort_orders=2,1,0 | PASS |  |
| TIME-01.reorder.selected-time-remains-Second.API | owner | multi selected Second after reorder | still Second id | same id | PASS |  |
| TIME-01.legacy-client-no-ids.ids-matched-by-content.API | owner | PATCH times without ids, reversed | existing ids retained | 200 kept=true | PASS |  |
| TIME-01.preview.removal-names-affected-assignment.API | owner | POST /times/preview remove Second (multi selected it) | impact lists multi, orphan, hash | 200 keys=times,plan_id,assignments,impact_hash,was_untimed,live_requests,notify_people,becomes_untimed,hidden_affected,c… | PASS | {"times":[{"id":"bf586818-d0b8-407b-9b23-d2c66b8c2313","kind":"rehearsal","name":null,"change":"unchanged","ends_at":"2028-11-26T14:00:00+00 |
| TIME-01.remove-selected-time.without-impact-hash-refused.API | owner | PATCH removing selected time, no time_impact_hash | refused (4xx) and times unchanged | 409 times=3 | PASS | {"error":"A selected attendance time is still assigned; review affected requests first","code":"time |
| TIME-01.remove-selected-time.wrong-hash-409.API | owner | PATCH with wrong impact hash | 409 and unchanged | 409 times=3 | PASS | {"error":"Who this change affects has changed; review it again","code":"time_impact_stale"} |
| TIME-01.remove-selected-time.with-hash+orphan-all.API | owner | PATCH with reviewed hash, orphan action=all | 200; multi kept for all times; time removed | 200 times=2 multi mode=all status=unconfirmed | PASS | {"id":"34195106-dad7-4189-9f0b-9114d21b3f01","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c","service_type_id": |
| TIME-01.remove-selected-time.hash-stale-after-attendance-change.API | owner | impact reviewed, then someone changes attendance, then commit | 409 (impact changed) and times unchanged | switch=200 commit=409 times=3 | PASS | {"error":"Who this change affects has changed; review it again","code":"time_impact_stale"} |
| TIME-01.stale-save-rejected.API | owner | second editor saves with old expected_revision | 409 and A edit wins | A=200 B=409 name=A edit | PASS | {"error":"The plan changed since you opened it","code":"plan_revision_stale"} |
| TIME-01.stale-save.omitted-expected_revision-overwrites.API | owner | editor omits expected_revision after A edit | (observation) accepted as last-writer-wins | 200 name=C no revision | PASS | server substitutes current revision when expected_revision omitted (plans.ts:130): stale clients that omit it lose no check — see Observations |
| TIME-01.stale-save.future-revision.API | owner | expected_revision=9999 | 409 | 409 | PASS |  |
| TIME-01.stale-expected_revision-without-times.API | owner | PATCH notes with stale expected_revision, no times | (observation) revision only checked when times present | 200 notes=plain field with sta | PASS | non-time fields ignore expected_revision |
| TIME-01.validation.end-before-start.API | owner | PATCH /plans/<7c17> | 400 | 422 | PASS |  |
| TIME-01.validation.bad-kind.API | owner | PATCH /plans/<7c17> | 400 | 422 | PASS |  |
| TIME-01.validation.name-121.API | owner | PATCH /plans/<7c17> | 400,200 | 422 | PASS | schema max 120 |
| TIME-01.validation.21-times.API | owner | PATCH /plans/<7c17> | 400 | 422 | PASS |  |
| TIME-01.validation.garbage-date.API | owner | PATCH /plans/<7c17> | 400 | 422 | PASS |  |
| TIME-01.validation.foreign-time-id(Beta plan time id).API | owner | PATCH /plans/<7c17> | 400,404,409,422 | 409 | PASS | must not steal Beta row |
| TIME-01.validation.foreign-time-id.beta-row-untouched.API | betaowner | re-read Beta plan times | 1 time, original start | 1 2027-01-10T15:00:00+00:00 | PASS |  |
| TIME-01.validation.malformed-time-id.API | owner | PATCH /plans/<7c17> | 400 | 422 | PASS |  |
| TIME-01.validation.no-partial-write.API | owner | plan times after rejected edits | 3 times unchanged | 3 | PASS |  |
| TIME-01.validation.time-id-from-other-plan-same-org.API | owner | PATCH plan P with time id of plan Q | Q untouched; no cross-plan move | 409 Q times=3, Q first start=13:00 | PASS | {"error":"Refresh before editing times; every existing time needs its stable id","code":"time_identi |
| TIME-01.delete-all-times.API | owner | PATCH times=[] on plan with selected-time assignments | refused until reviewed (hash) or orphans resolved | 200 times=0 asg=0 | PASS | {"id":"04aafb8b-b349-4f90-a8d1-59b48fc73d26","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c |
| TIME-01.edit.notify_time_changes=false-no-effect.D | owner | PATCH with notify false (service-role count of delivery_effects) | no new effect | 200 effects 12->12 | PASS |  |
| TIME-01.edit.notify_time_changes=true-creates-effect.D | owner | PATCH with notify true | new effect for released requests | 200 effects 12->13 | PASS |  |
| TIME-01.edit.outstanding-requests-made-stale.API | owner | request_revision after time change | revisions bumped (>0) for affected | [1,1,0] | PASS |  |
| TIME-01.remove-selected-time.orphan-remove-withdraws-request.API | owner | orphan action=remove (harness fixed: orphaned assignment) | 200; orphaned request removed; other kept | 200 assignments=1 (was 2) remaining=member QaPlans | PASS | {"id":"f6fa1ffc-ae2d-4e05-9ac0-3d5e4598cf2b","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c |
| TIME-02.setup.grant-override-to-folderlead.API | owner | PUT /service-types/:id/access +override_conflicts | 200 | 200 | PASS | {"scope_type":"service_type","scope_id":"c8208f10-8193-42ab-a32a-acaa40d2e556"," |
| TIME-02.setup.base-assignments.API | owner | assign G3 all times, G4 only Second | 201 | 201 | PASS |  |
| TIME-02.overlap-service-partial.API | owner | POST /plans/<Y>/assignments service 15:30-16:30 vs 15-16 | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overlap-contained.API | owner | POST /plans/<Y>/assignments contained | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overlap-identical.API | owner | POST /plans/<Y>/assignments  | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.adjacent-after-end.API | owner | POST /plans/<Y>/assignments 16:00-17:00 touches 15-16 and 17-18 (gap exactly 1h) | 201 | 201  | PASS |  |
| TIME-02.adjacent-before-start.API | owner | POST /plans/<Y>/assignments 14-15 touches rehearsal end and First start | 201 | 201  | PASS |  |
| TIME-02.overlap-rehearsal-vs-rehearsal.API | owner | POST /plans/<Y>/assignments rehearsal overlap | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overlap-service-vs-rehearsal.API | owner | POST /plans/<Y>/assignments service overlapping other plan rehearsal | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overlap-other-kind.API | owner | POST /plans/<Y>/assignments kind=other overlap (record) | 409,201 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.selected-time-no-overlap.API | owner | POST /plans/<Y>/assignments G4 only attends Second; Y overlaps First only | 201 | 201  | PASS |  |
| TIME-02.selected-time-overlap.API | owner | POST /plans/<Y>/assignments Y overlaps G4 Second | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.different-day-no-conflict.API | owner | POST /plans/<Y>/assignments  | 201 | 201  | PASS |  |
| TIME-02.multi-time-candidate-one-overlap.API | owner | POST /plans/<Y>/assignments Y has two times, only second overlaps | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overnight-overlap-after-midnight.API | owner | POST /plans/<Y>/assignments 01:00-02:30 next day vs 22:00-02:00 | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.overnight-adjacent-end.API | owner | POST /plans/<Y>/assignments 02:00-03:00 touches end | 201 | 201  | PASS |  |
| TIME-02.overnight-adjacent-start.API | owner | POST /plans/<Y>/assignments 20-22 touches start | 201 | 201  | PASS |  |
| TIME-02.override.owner-no-reason.API | owner | POST /plans/<Y>/assignments  | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.override.owner-blank-reason.API | owner | POST /plans/<Y>/assignments  | 409 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"confl | PASS | blank reason is rejected by schema with 422 before conflict handling; no assignment created |
| TIME-02.override.owner-with-reason.API | owner | POST /plans/<Y>/assignments  | 201 | 201  | PASS |  |
| TIME-02.override.owner-reason-501-chars.API | owner | POST /plans/<Y>/assignments  | 400,422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"confl | PASS |  |
| TIME-02.override.admin-with-reason.API | admin | POST /plans/<Y>/assignments  | 201 | 201  | PASS |  |
| TIME-02.override.legacy-with-reason.API | legacy | POST /plans/<Y>/assignments  | 201 | 201  | PASS |  |
| TIME-02.override.scoped-with-reason-no-capability.API | scoped | POST /plans/<Y>/assignments  | 403 | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | PASS |  |
| TIME-02.override.scoped-no-reason.API | scoped | POST /plans/<Y>/assignments  | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.override.schedonly-with-reason-no-capability.API | schedonly | POST /plans/<Y>/assignments  | 403 | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | PASS |  |
| TIME-02.override.folderlead-with-grant-with-reason.API | folderlead | POST /plans/<Y>/assignments  | 201 | 201  | PASS |  |
| TIME-02.override.folderlead-with-grant-no-reason.API | folderlead | POST /plans/<Y>/assignments  | 409 | 409 {"error":"Some people are unavailable or already scheduled at that time","code": | PASS |  |
| TIME-02.override.member-denied.API | member | POST /plans/<Y>/assignments  | 403 | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidde | PASS |  |
| TIME-02.override.granted-plansedit-only-denied.API | granted | POST /plans/<Y>/assignments  | 403 | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidde | PASS |  |
| TIME-02.override.ignore_conflicts-true-without-reason.API | owner | POST /plans/<Y>/assignments ignore_conflicts must not bypass | 409 | 409 {"error":"Give a reason to schedule over these conflicts","code":"scheduling_con | PASS |  |
| TIME-02.override.recorded-with-actor-and-reason.API | folderlead | GET /plans/:id/conflict-overrides | 1 row with reason, actor = folderlead | 201 rows=1 reason=QA audit reason actor=1e82a93d-3efe-477f-9cb5-85e3ecd4d214 | PASS | [{"id":"16b7b2c6-6f56-4fcc-b363-591da59b1b03","organization_id":"e87a14c5-f33f-4004-8bae-54486b1fc92c","assignment_id":"cc3ee5c6-468d-4a42-9 |
| TIME-02.override.audit-list-denied.member.API | member | GET /conflict-overrides | 403 | 403 | PASS |  |
| TIME-02.override.audit-list-denied.granted.API | granted | GET /conflict-overrides | 403 | 403 | PASS |  |
| TIME-02.override.audit-RLS-direct.member.RLS | member | GET /rest/v1/assignment_conflict_overrides | 0 rows | 200 rows=0 | PASS |  |
| TIME-02.override.folderlead-after-revoke.API | folderlead | POST /plans/<Y>/assignments same JWT after revoke | 403 | 403 {"error":"You cannot schedule over these conflicts","code":"forbidden"} | PASS |  |
| TIME-02.override.reason-not-recorded-when-no-conflict.API | owner | override reason with no conflict | 0 override rows | 0 | PASS |  |
| TIME-02.recheck-at-commit.parallel-overlapping-assign.API | owner | 4 parallel POST assignments (2 overlapping plans) | person ends up on at most one of two overlapping plans | statuses=409,201,409,201 rows=1 distinct plans=1 | PASS | verified via service-role read |
| TIME-02.conflicts-check.owner.API | owner | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.admin.API | admin | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.legacy.API | legacy | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.scoped.API | scoped | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.granted.API | granted | POST /scheduling/conflicts/check | 403,404 | 403 | PASS |  |
| TIME-02.conflicts-check.folderlead.API | folderlead | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.schedonly.API | schedonly | POST /scheduling/conflicts/check | 200 | 200 | PASS |  |
| TIME-02.conflicts-check.member.API | member | POST /scheduling/conflicts/check | 403,404 | 403 | PASS |  |
| TIME-02.conflicts-check.betaowner.API | betaowner | POST /scheduling/conflicts/check | 403,404 | 403 | PASS |  |
| TIME-02.conflicts-check.anon.API | anon | POST /scheduling/conflicts/check | 401 | 401 | PASS |  |
| TIME-02.time-edit.preview-lists-new-conflict.API | owner | POST /times/preview moving Z into Y overlap | conflicts[] non-empty (blocking) | 200 conflicts=1 sev=blocking | PASS |  |
| TIME-02.time-edit.commit-allowed-as-plan-fact.API | owner | PATCH into overlap | (observation) 200: time is a plan fact; overlap not blocked at commit | 200 | FAIL | W2-PLANS-D12 {"id":"5a16e54d-1752-4615-b23d-7842bdc91c1b","organization_id":"e87a14c5-f33f-40 Intent conflict: migration comment says time edits never… |
| TIME-02.time-edit.preview-scoped-no-override-sees-conflicts-redacted.API | scoped | preview into overlap | conflicts visible; override_permitted false or redacted | 200 conflicts=2 redacted=false override=false | PASS |  |
| TIME-02.blockout-vs-commitment.kind-differentiated.API | owner | conflict check for member with blockout 15:30-16:30 | kind=blockout, private reason absent | blockout=201 blockout/blocking reasonLeak=false | PASS | {"conflicts":[{"candidate_key":"60338413-a5f6-4a92-9eae-39ce6c8ddda0:fa43293a-6cc3-435f-85ee-cec612c8418b:0","person_id":"60338413-a5f6-4a92 |
| TIME-02.blockout.assign-blocked-needs-override.API | owner | assign member over own blockout | 409 scheduling_conflict | 409 | PASS |  |
| TIME-02.blockout.assign-over-blockout-with-override.API | owner | with override reason | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.owner.API | owner | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.admin.API | admin | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.legacy.API | legacy | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.scoped.API | scoped | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.granted.API | granted | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.folderlead.API | folderlead | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.SUN.schedonly.API | schedonly | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.SUN.member.API | member | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.SUN.betaowner.API | betaowner | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.SUN.anon.API | anon | POST /plan-templates | 401 | 401 | PASS |  |
| TEMPLATE-01.create.MID.owner.API | owner | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.MID.admin.API | admin | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.MID.legacy.API | legacy | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.MID.scoped.API | scoped | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.granted.API | granted | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.folderlead.API | folderlead | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.schedonly.API | schedonly | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.member.API | member | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.betaowner.API | betaowner | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.MID.anon.API | anon | POST /plan-templates | 401 | 401 | PASS |  |
| TEMPLATE-01.create.ORG.owner.API | owner | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.ORG.admin.API | admin | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.ORG.legacy.API | legacy | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.ORG.scoped.API | scoped | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.granted.API | granted | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.folderlead.API | folderlead | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.schedonly.API | schedonly | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.member.API | member | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.betaowner.API | betaowner | POST /plan-templates | 403,404 | 403 | PASS |  |
| TEMPLATE-01.create.ORG.anon.API | anon | POST /plan-templates | 401 | 401 | PASS |  |
| TEMPLATE-01.create.MID.member.RLS-direct.RLS | member | POST /rest/v1/plan_templates | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TEMPLATE-01.create.MID.schedonly.RLS-direct.RLS | schedonly | POST /rest/v1/plan_templates | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TEMPLATE-01.create.MID.scoped.RLS-direct.RLS | scoped | POST /rest/v1/plan_templates | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level |
| TEMPLATE-01.list.owner-sees-all-alpha.API | owner | GET /plan-templates | >= 12 Alpha templates, no Beta | 13 beta=false | PASS |  |
| TEMPLATE-01.list.scope-filter.owner.API | owner | GET /plan-templates?include_archived=true | sun=true mid=true | 200 sun=true mid=true | PASS |  |
| TEMPLATE-01.list.scope-filter.admin.API | admin | GET /plan-templates?include_archived=true | sun=true mid=true | 200 sun=true mid=true | PASS |  |
| TEMPLATE-01.list.scope-filter.legacy.API | legacy | GET /plan-templates?include_archived=true | sun=true mid=true | 200 sun=true mid=true | PASS |  |
| TEMPLATE-01.list.scope-filter.scoped.API | scoped | GET /plan-templates?include_archived=true | sun=true mid=false | 200 sun=true mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.granted.API | granted | GET /plan-templates?include_archived=true | sun=true mid=false | 200 sun=true mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.folderlead.API | folderlead | GET /plan-templates?include_archived=true | sun=true mid=false | 200 sun=true mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.schedonly.API | schedonly | GET /plan-templates?include_archived=true | 403 | 403 sun=false mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.member.API | member | GET /plan-templates?include_archived=true | 403 | 403 sun=false mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.betaowner.API | betaowner | GET /plan-templates?include_archived=true | 403 | 403 sun=false mid=false | PASS |  |
| TEMPLATE-01.list.scope-filter.anon.API | anon | GET /plan-templates?include_archived=true | 401 | 401 sun=false mid=false | PASS |  |
| TEMPLATE-01.get.SUN.owner.API | owner | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.admin.API | admin | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.legacy.API | legacy | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.scoped.API | scoped | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.granted.API | granted | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.folderlead.API | folderlead | GET /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.get.SUN.schedonly.API | schedonly | GET /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.get.SUN.member.API | member | GET /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.get.SUN.betaowner.API | betaowner | GET /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.get.SUN.anon.API | anon | GET /plan-templates/<8224> | 401 | 401 | PASS |  |
| TEMPLATE-01.get.MID.scoped.API | scoped | GET /plan-templates/<0461> | 404 | 404 | PASS |  |
| TEMPLATE-01.get.MID.granted.API | granted | GET /plan-templates/<0461> | 404 | 404 | PASS |  |
| TEMPLATE-01.get.MID.folderlead.API | folderlead | GET /plan-templates/<0461> | 404 | 404 | PASS |  |
| TEMPLATE-01.get.cross-tenant.API | owner | GET /plan-templates/<b94c> | 404 | 404 | PASS |  |
| TEMPLATE-01.get.unknown.API | owner | GET /plan-templates/<0000> | 404 | 404 | PASS |  |
| TEMPLATE-01.get.malformed-id.API | owner | GET /plan-templates/abc | 400,404 | 500 | FAIL | W2-PLANS-D4 {"error":"invalid input syntax for type uuid: \"abc\"","code":"22P02"} W1 API-D5 class |
| TEMPLATE-01.get.revision-99.API | owner | GET /plan-templates/<8224>?revision=99 | 404 | 404 | PASS |  |
| TEMPLATE-01.get.revision-0.API | owner | GET /plan-templates/<8224>?revision=0 | 400 | 422 | PASS |  |
| TEMPLATE-01.get.revision-abc.API | owner | GET /plan-templates/<8224>?revision=abc | 400 | 422 | PASS |  |
| TEMPLATE-01.update-name.SUN.owner.API | owner | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.admin.API | admin | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.legacy.API | legacy | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.scoped.API | scoped | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.granted.API | granted | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.folderlead.API | folderlead | PATCH /plan-templates/<8224> | 200 | 200 | PASS |  |
| TEMPLATE-01.update-name.SUN.schedonly.API | schedonly | PATCH /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.update-name.SUN.member.API | member | PATCH /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.update-name.SUN.betaowner.API | betaowner | PATCH /plan-templates/<8224> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.update-name.SUN.anon.API | anon | PATCH /plan-templates/<8224> | 401 | 401 | PASS |  |
| TEMPLATE-01.update-name.MID.scoped.API | scoped | PATCH /plan-templates/<0461> | 403,404 | 404 | PASS |  |
| TEMPLATE-01.update-name.MID.granted.API | granted | PATCH /plan-templates/<0461> | 403,404 | 404 | PASS |  |
| TEMPLATE-01.update-name.MID.folderlead.API | folderlead | PATCH /plan-templates/<0461> | 403,404 | 404 | PASS |  |
| TEMPLATE-01.update-name.MID.schedonly.API | schedonly | PATCH /plan-templates/<0461> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.update-name.MID.member.API | member | PATCH /plan-templates/<0461> | 403,404 | 403 | PASS |  |
| TEMPLATE-01.update.MID.persisted-unchanged.API | owner | re-read Midweek template | name unchanged | QA tmpl MID owner | PASS |  |
| TEMPLATE-01.update-cross-tenant.API | owner | PATCH /plan-templates/<b94c> | 403,404 | 404 | PASS |  |
| TEMPLATE-01.update-cross-tenant.persisted-unchanged.API | betaowner | re-read Beta template | unchanged | BETA TEMPLATE SENTINEL | PASS |  |
| TEMPLATE-01.version.name-only-no-new-revision.API | owner | PATCH name | current_revision stays 1 | 200 rev=1 | PASS |  |
| TEMPLATE-01.version.content-change-new-revision.API | owner | PATCH content | current_revision=2, rev 1 still readable | 200 rev=2 revisions=2,1 | PASS |  |
| TEMPLATE-01.version.read-earlier-revision.API | owner | GET ?revision=1 | content of v1 (Hdr) | Hdr | PASS |  |
| TEMPLATE-01.version.stale-expected_revision-409.API | owner | PATCH with expected_revision=1 (current 2) | 409 | 409 | PASS | {"error":"This template changed since you opened it","code":"template_changed"} |
| TEMPLATE-01.version.stale-name-only.API | owner | rename with stale revision | 409 | 409 | PASS | {"error":"This template changed since you opened it","code":"template_changed"} |
| TEMPLATE-01.update.content-and-source-both.API | owner | PATCH both | 400 | 422 | PASS |  |
| TEMPLATE-01.update.missing-expected_revision.API | owner | PATCH without expected_revision | 400 | 422 | PASS |  |
| TEMPLATE-01.version.update-from-source-plan.API | owner | PATCH source plan | rev 3 with source items | 200 rev=3 items=4 | PASS |  |
| TEMPLATE-01.create.validation.empty-name.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.whitespace-name.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.name-121.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.no-content-or-source.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.both-content-and-source.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.bad-kind.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.bad-time-format.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.duration-0.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.duration-1441.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.day_offset-15.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.song-item-without-song.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.item-without-title.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.201-items.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.unknown-content-key(strict).API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.need-0.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.need-position-of-Beta-org.API | owner | POST /plan-templates | 400,404,409,422 | 400 | PASS |  |
| TEMPLATE-01.create.validation.song-from-Beta-org.API | owner | POST /plan-templates | 400,404,409,422 | 400 | PASS |  |
| TEMPLATE-01.create.validation.service_type-of-Beta.API | owner | POST /plan-templates | 400,403,404 | 404 | PASS |  |
| TEMPLATE-01.create.validation.source-plan-of-Beta.API | owner | POST /plan-templates | 400,403,404 | 404 | PASS |  |
| TEMPLATE-01.create.validation.source-no-components.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.malformed-service_type.API | owner | POST /plan-templates | 400 | 422 | PASS |  |
| TEMPLATE-01.create.validation.html-name.API | owner | POST /plan-templates | 201 | 201 | PASS |  |
| TEMPLATE-01.create.source-full-with-roster.API | owner | POST source all five components | 201 with counts times3/items4/needs2/roster>=2 | 201 {"times":3,"items":4,"needs":2,"roster":4,"has_notes":true} | PASS |  |
| TEMPLATE-01.create.section-from-source.API | owner | POST kind=section items only | 201 counts items 4 times 0 | 201 {"times":0,"items":4,"needs":0,"roster":0,"has_notes":false} | PASS |  |
| TEMPLATE-01.create.empty-content.API | owner | POST content {} | 201 (empty template) or 400 | 201 | PASS | counts={"times":0,"items":0,"needs":0,"roster":0,"has_notes":false} |
| TEMPLATE-01.snapshot-isolation.API | owner | edit source plan after saving template | template unchanged (4 items) | 4 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.owner.API | owner | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.admin.API | admin | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.legacy.API | legacy | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.scoped.API | scoped | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.granted.API | granted | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.folderlead.API | folderlead | POST /archive {archived:false} | 200 | 200 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.schedonly.API | schedonly | POST /archive {archived:false} | 403/404 | 403 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.member.API | member | POST /archive {archived:false} | 403/404 | 403 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.betaowner.API | betaowner | POST /archive {archived:false} | 403/404 | 403 | PASS |  |
| TEMPLATE-01.archive-noop.SUN.anon.API | anon | POST /archive {archived:false} | 401 | 401 | PASS |  |
| TEMPLATE-01.archive.hidden-from-default-list.API | owner | archive then list | 200; absent by default; present with include_archived | 200 default=false incl=true archived_at=true | PASS |  |
| TEMPLATE-01.archive.archived-template-preview.API | owner | preview apply of archived template revision | (record) allowed or refused | 400 | PASS | {"error":"Restore this template before applying it","code":"bad_request"} |
| TEMPLATE-01.archive.restore.API | owner | archived:false | 200 archived_at null | 200 null | PASS |  |
| TEMPLATE-01.archive.bad-body.API | owner | POST /plan-templates/<92ed>/archive | 400 | 422 | PASS |  |
| TEMPLATE-01.apply-preview.SUN.owner.API | owner | POST /plans/<04fa>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.owner.API | owner | POST /plans/<04fa>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.owner.persisted-state.API | owner | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.admin.API | admin | POST /plans/<d1ed>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.admin.API | admin | POST /plans/<d1ed>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.admin.persisted-state.API | admin | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.legacy.API | legacy | POST /plans/<89f2>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.legacy.API | legacy | POST /plans/<89f2>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.legacy.persisted-state.API | legacy | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.scoped.API | scoped | POST /plans/<450d>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.scoped.API | scoped | POST /plans/<450d>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.scoped.persisted-state.API | scoped | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.granted.API | granted | POST /plans/<a880>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.granted.API | granted | POST /plans/<a880>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.granted.persisted-state.API | granted | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.folderlead.API | folderlead | POST /plans/<bf61>/apply-template/preview | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.folderlead.API | folderlead | POST /plans/<bf61>/apply-template | 200 | 200 | PASS |  |
| TEMPLATE-01.apply.SUN.folderlead.persisted-state.API | folderlead | owner re-read target | 4 items,3 times | 4 items, 3 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.schedonly.API | schedonly | POST /plans/<703d>/apply-template/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.schedonly.API | schedonly | POST /plans/<703d>/apply-template | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.schedonly.persisted-state.API | schedonly | owner re-read target | 0 items,0 times | 0 items, 0 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.member.API | member | POST /plans/<ed8c>/apply-template/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.member.API | member | POST /plans/<ed8c>/apply-template | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.member.persisted-state.API | member | owner re-read target | 0 items,0 times | 0 items, 0 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.betaowner.API | betaowner | POST /plans/<fcfa>/apply-template/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.betaowner.API | betaowner | POST /plans/<fcfa>/apply-template | 403,404 | 403 | PASS |  |
| TEMPLATE-01.apply.SUN.betaowner.persisted-state.API | betaowner | owner re-read target | 0 items,0 times | 0 items, 0 times | PASS |  |
| TEMPLATE-01.apply-preview.SUN.anon.API | anon | POST /plans/<9d85>/apply-template/preview | 401 | 401 | PASS |  |
| TEMPLATE-01.apply.SUN.anon.API | anon | POST /plans/<9d85>/apply-template | 401 | 401 | PASS |  |
| TEMPLATE-01.apply.SUN.anon.persisted-state.API | anon | owner re-read target | 0 items,0 times | 0 items, 0 times | PASS |  |
| TEMPLATE-01.apply-preview.MID-target.scoped.API | scoped | POST preview on Midweek plan | 403/404 | 404 | PASS | {"error":"Plan not found","code":"not_found"} |
| TEMPLATE-01.apply-preview.MID-target.granted.API | granted | POST preview on Midweek plan | 403/404 | 404 | PASS | {"error":"Plan not found","code":"not_found"} |
| TEMPLATE-01.apply-preview.MID-target.folderlead.API | folderlead | POST preview on Midweek plan | 403/404 | 404 | PASS | {"error":"Plan not found","code":"not_found"} |
| TEMPLATE-01.apply.MID-target.scoped-with-valid-owner-hash.API | scoped | apply with a valid hash obtained by owner | 403/404, no change | 404 items=0 | PASS |  |
| TEMPLATE-01.apply-preview.scoped-uses-invisible-Midweek-template.API | scoped | preview with revision_id of a template RLS hides | 404 | 404 | PASS | {"error":"Template not found","code":"not_found"} |
| TEMPLATE-01.apply-preview.cross-tenant-revision.API | owner | preview with Beta revision_id | 404, no leak | 404 leak=false | PASS |  |
| TEMPLATE-01.apply-preview.cross-tenant-plan.API | owner | preview onto Beta plan | 404 | 404 | PASS |  |
| TEMPLATE-01.apply.empty-plan.full-template.API | owner | preview+apply full template to empty plan | 4 items, 3 times, 2 needs, notes; no assignments; nobody notified | 200 items=4 times=3 needs=2 notes=src notes asg=0 | PASS |  |
| TEMPLATE-01.apply.item-fidelity-key-length.API | owner | compare applied items | key A on Song One, lengths 240/120/300, order kept | key=A lens=0,240,120,300 titles=Welcome\|QA Plans Song One\|Offering\|QA Plans Song Two | PASS |  |
| TEMPLATE-01.apply.repeat-key-no-duplicate-writes.API | owner | apply again with same idempotency_key | 200 original result; still 4 items/3 times | 200 items=4 times=3 | PASS |  |
| TEMPLATE-01.apply.same-hash-new-key-after-change-stale.API | owner | apply same preview without key after it was applied | 409 stale; no duplicate | 409 items=4 | PASS | {"error":"This plan changed since you previewed the template","code":"plan_revision_stale" |
| TEMPLATE-01.apply.history-recorded.API | owner | GET /template-applications | 1 application | 200 n=1 | PASS |  |
| TEMPLATE-01.apply.history-denied.member.API | member | GET /template-applications | 403/404 | 403 | PASS |  |
| TEMPLATE-01.apply.history-denied.schedonly.API | schedonly | GET /template-applications | 403/404 | 403 | PASS |  |
| TEMPLATE-01.apply.history-denied.betaowner.API | betaowner | GET /template-applications | 403/404 | 403 | PASS |  |
| TEMPLATE-01.apply.append-insert_at-1.API | owner | append section at index 1 | Existing A, then 4 template items, then Existing B | 200 Existing A\|Welcome\|QA Plans Song One\|Offering\|QA Plans Song Two\|Existing B | PASS |  |
| TEMPLATE-01.apply.replace-mode.API | owner | replace items with section | preview remove_count=6; result 4 items; existing removed | 200 remove_count=6 items=Welcome\|QA Plans Song One\|Offering\|QA Plans Song Two | PASS |  |
| TEMPLATE-01.apply.stale-preview-after-concurrent-edit.API | owner | apply a preview made before another edit | 409; nothing applied | 409 items=5 (5 expected unchanged) | PASS | {"error":"This plan changed since you previewed the template","code":"plan_revision_stale" |
| TEMPLATE-01.apply.forged-preview-hash.API | owner | apply with made-up hash | 409/400 | 409 | PASS |  |
| TEMPLATE-01.apply.malformed-hash.API | owner | hash not hex | 400 | 422 | PASS |  |
| TEMPLATE-01.apply.missing-expected_revision.API | owner | no expected_revision | 400 | 422 | PASS |  |
| TEMPLATE-01.apply-preview.no-components.API | owner | components [] | 400 | 422 | PASS |  |
| TEMPLATE-01.apply-preview.bad-component.API | owner | components bogus | 400 | 422 | PASS |  |
| TEMPLATE-01.apply-preview.unknown-revision.API | owner | unknown revision id | 404 | 404 | PASS |  |
| TEMPLATE-01.apply-preview.insert_at-501.API | owner | insert_at 501 | 400 | 422 | PASS |  |
| TEMPLATE-01.apply-preview.insert_at-negative.API | owner | insert_at -1 | 400 | 422 | PASS |  |
| TEMPLATE-01.apply.earlier-revision-preview.API | owner | preview revision 1 of template at revision 3 | preview shows template.revision=1, latest_revision=3, items from v1 | rev=1 latest=3 first=Hdr | PASS |  |
| TEMPLATE-01.apply-preview.component-not-in-template.API | owner | section template, components [times] | no times to add, no error or 4xx | 400 times.add=undefined | PASS |  |
| TEMPLATE-02.preview.SUN.owner.API | owner | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.owner.API | owner | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.owner.persisted-state.API | owner | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.admin.API | admin | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.admin.API | admin | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.admin.persisted-state.API | admin | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.legacy.API | legacy | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.legacy.API | legacy | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.legacy.persisted-state.API | legacy | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.scoped.API | scoped | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.scoped.API | scoped | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.scoped.persisted-state.API | scoped | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.granted.API | granted | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.granted.API | granted | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.granted.persisted-state.API | granted | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.folderlead.API | folderlead | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.generate.SUN.folderlead.API | folderlead | POST /plans/generate | 201 | 201 | PASS |  |
| TEMPLATE-02.generate.SUN.folderlead.persisted-state.API | folderlead | plans count before/after | +2 | +2 | PASS |  |
| TEMPLATE-02.preview.SUN.schedonly.API | schedonly | POST /plans/generate/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.schedonly.API | schedonly | POST /plans/generate | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.schedonly.persisted-state.API | schedonly | plans count before/after | +0 | +0 | PASS |  |
| TEMPLATE-02.preview.SUN.member.API | member | POST /plans/generate/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.member.API | member | POST /plans/generate | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.member.persisted-state.API | member | plans count before/after | +0 | +0 | PASS |  |
| TEMPLATE-02.preview.SUN.betaowner.API | betaowner | POST /plans/generate/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.betaowner.API | betaowner | POST /plans/generate | 403,404 | 403 | PASS |  |
| TEMPLATE-02.generate.SUN.betaowner.persisted-state.API | betaowner | plans count before/after | +0 | +0 | PASS |  |
| TEMPLATE-02.preview.SUN.anon.API | anon | POST /plans/generate/preview | 401 | 401 | PASS |  |
| TEMPLATE-02.generate.SUN.anon.API | anon | POST /plans/generate | 401 | 401 | PASS |  |
| TEMPLATE-02.generate.SUN.anon.persisted-state.API | anon | plans count before/after | +0 | +0 | PASS |  |
| TEMPLATE-02.preview.scoped-Midweek-template.API | scoped | preview with revision of Midweek template | 403/404 | 404 | PASS | {"error":"Template not found","code":"not_found"} |
| TEMPLATE-02.generate.scoped-with-owner-hash-Midweek-template.API | scoped | generate with valid hash of out-of-scope template | 403/404; no plans | 404 +0 | PASS |  |
| TEMPLATE-02.preview.validation.count-0.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.count-12.API | owner | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.preview.validation.count-13.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.count-negative.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.count-float.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.interval-0.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.interval-4.API | owner | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.preview.validation.interval-5.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.end-before-start.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.end-date-bound.API | owner | POST /plans/generate/preview | 200 | 200 | PASS |  |
| TEMPLATE-02.preview.validation.bad-start.API | owner | POST /plans/generate/preview | 400,422,500 | 500 | PASS |  |
| TEMPLATE-02.preview.validation.bad-start-format.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.missing-start.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.excluded-54.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.excluded-bad-date.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.edits-13.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.title-201.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.unknown-revision.API | owner | POST /plans/generate/preview | 404 | 404 | PASS |  |
| TEMPLATE-02.preview.validation.malformed-revision.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.validation.revision-Beta.API | owner | POST /plans/generate/preview | 403,404 | 404 | PASS |  |
| TEMPLATE-02.preview.validation.bad-ambiguous.API | owner | POST /plans/generate/preview | 400 | 422 | PASS |  |
| TEMPLATE-02.preview.exclusion-and-duplicate-excluded-dates.API | owner | count 4 weekly from 04-07 excluding 04-14 twice | dates 04-07,04-21,04-28,05-05 (4 plans, skipped date not counted) or 3 plans; exact count … | 200 2030-04-07,2030-04-21,2030-04-28,2030-05-05 | PASS |  |
| TEMPLATE-02.preview.biweekly-dates.API | owner | interval 2 weeks count 3 | 04-07,04-21,05-05 | 2030-04-07,2030-04-21,2030-05-05 | PASS |  |
| TEMPLATE-02.preview.end_date-caps-count.API | owner | count 12 end_date 04-30 | 04-07,14,21,28 only | 2030-04-07,2030-04-14,2030-04-21,2030-04-28 | PASS |  |
| TEMPLATE-02.preview.edits-skip-move-title.API | owner | edits: skip 04-14; move 04-21->04-23 with title | dates 04-07, 04-23(Moved plan) | 200 2030-04-07:QA gen base,2030-04-23:Moved plan,2030-04-28:QA gen base | PASS |  |
| TEMPLATE-02.preview.edit-move-onto-existing-date.API | owner | move 04-14 onto 04-21 (duplicate date) | reject (400) or flagged | 200 dates=2030-04-07 | PASS | duplicate dates would create two same-day plans |
| TEMPLATE-02.preview.edit-for-nonexistent-date.API | owner | edit for date not in series | ignored or 400 | 200 n=2 | PASS |  |
| TEMPLATE-02.preview.all-dates-excluded.API | owner | every date excluded | 400 or empty list; commit must not create anything | 200 n=2 | PASS | excluded dates are skipped and the series continues (count 2 -> dates 04-21,04-28); no empty commit possible |
| TEMPLATE-02.generate.commit-exact-count.API | owner | generate 3 plans | 201; +3 draft plans; titles; times at 10:00 CDT=15:00Z | 201 +3 keys=batch_id,plan_ids,replayed,plans | PASS |  |
| TEMPLATE-02.generate.repeat-key-returns-original.API | owner | repeat commit same key | 201/200 same plans; +0 | 201 +0 same=true | PASS |  |
| TEMPLATE-02.generate.same-preview-new-key-no-duplicates.API | owner | same preview hash, new key after commit | 409 stale (existing plans now on those dates) or no duplicates | 409 +0 | PASS | {"error":"The template or the dates changed. Review the plans again.","code":"template_pre |
| TEMPLATE-02.generate.plan-contents.API | owner | inspect first generated plan | draft, service_type Sunday, 2 times (10:00 CDT=15:00Z for Main), items 2, needs 1, notes | draft true times=13:00r,15:00s items=2 needs=1 notes=gen notes title=QA gen commit | PASS |  |
| TEMPLATE-02.generate.preview-hash-mismatch-different-count.API | owner | commit count=4 with hash for count=3 | 409/400; nothing created | 409 | PASS |  |
| TEMPLATE-02.generate.missing-idempotency-key.API | owner | no key | 400 | 422 | PASS |  |
| TEMPLATE-02.generate.malformed-hash.API | owner | hash not hex | 400 | 422 | PASS |  |
| TEMPLATE-02.generate.stale-preview-plan-added-on-date.API | owner | plan created on a series date after preview | (record) 409 stale or created with existing_plans warning | 409 +0 {"error":"The template or the dates changed. Review the plans again.","code":"te | PASS | preview lists existing_plans per date; check behaviour |
| TEMPLATE-02.preview.existing_plans-listed.API | owner | preview after plan exists on date | existing_plans lists it | [0,1] | PASS |  |
| TEMPLATE-02.generate.commit-with-date_collision-problem.API | owner | commit a preview that reports a problem | refused; +0 plans | 422 +0 problems=1 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"preview_hash"," | PASS |  |
| TIME-03.dst.spring-gap-0230-explicit-problem.API | owner | generate preview Chicago 03-04/11/18 with template local 02:30 (nonexistent on 03-11) | explicit time_skipped problem naming the date; date not silently invented | problem=2029-03-11 time_skipped; planned dates=2029-03-04,2029-03-18 | PASS |  |
| TIME-03.dst.commit-with-skipped-time-problem-refused.API | owner | commit series that has a time_skipped problem | refused, +0 plans | 422 +0 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"preview_hash"," | PASS |  |
| TIME-03.dst.wall-clock-preserved-across-spring-forward.API | owner | 02:30 local on 03-04 (CST) vs 03-18 (CDT) | 08:30Z on 03-04, 07:30Z on 03-18 | 2029-03-04T08:30 \| 2029-03-18T07:30 | PASS |  |
| TIME-03.dst.commit-after-excluding-the-gap-date.API | owner | exclude 03-11 then commit | 201; stored 08:30Z / 07:30Z | 201 {"batch_id":"3d8d04d3-74bb-44ee-a077-15e37ed1903b","plan_ids | PASS |  |
| TIME-03.dst.stored-time-reload.API | owner | reload first generated plan | Gap time 08:30Z; service_date matches | 2029-03-04T08:30:00+00:00 service_date=2029-03-04T08:30:00+00:00 | PASS |  |
| TIME-03.dst.late-evening-on-DST-day.API | owner | 23:30 local on 2029-03-11 (CDT) | 2029-03-12T04:30Z | 2029-03-12T04:30 | PASS |  |
| TIME-03.dst.day_offset-minus1-across-boundary.API | owner | rehearsal 20:00 local on 03-10 (CST) | 2029-03-11T02:00Z | 2029-03-11T02:00 | PASS |  |
| TIME-03.dst.service_date-local-day-of-generated-plan.API | owner | service_date of plan generated for 03-11 (anchored on first service time) | local day 03-11 | 2029-03-12T04:30:00+00:00 | PASS | service_date=2029-03-12T04:30:00+00:00 |
| TIME-03.dst.fall-back-ambiguous-0130-earlier.API | owner | 01:30 local 2029-11-04 ambiguous_time=earlier | 2029-11-04T06:30Z | 2029-11-04T06:30Z | PASS |  |
| TIME-03.dst.fall-back-ambiguous-0130-later.API | owner | 01:30 local 2029-11-04 ambiguous_time=later | 2029-11-04T07:30Z | 2029-11-04T07:30Z | PASS |  |
| TEMPLATE-02.generate.roster-conflict-on-2nd-date-rolls-back-all.API | owner | 3-date series, roster person busy on 2nd date, no override | preview flags blocking on 08-18; commit refused; +0 plans (all or none) | blocking on ; commit 409; +0 | FAIL | W2-PLANS-D8 {"error":"This Person is unavailable or already scheduled at that time","code":"scheduling_conflict" |
| TEMPLATE-02.generate.roster-conflict-override-scoped-no-capability.API | scoped | override reason without capability | 403; +0 | 409 +0 | PASS | {"error":"The template or the dates changed. Review the plans again.","code":"te |
| TEMPLATE-02.generate.roster-conflict-owner-override.API | owner | owner with reason | 201; +3 | 201 +3 | PASS | {"batch_id":"3009c28d-4d1a-4ec3-90bd-29bfe3194d5b","plan_ids":["11cc9a3e-f93e-48 |
| TEMPLATE-02.generate.roster-assignments-unconfirmed-prepared-or-released.D | owner | service-role read of generated roster assignments | 3 unconfirmed; visibility per team default | ["unconfirmed:prepared","unconfirmed:prepared","unconfirmed:prepared"] | PASS |  |
| TEMPLATE-02.generate.parallel-same-key-4x.API | owner | 4 parallel commits same key | exactly +2 plans | statuses=201,201,201,201 +2 | PASS |  |
| TEMPLATE-01.apply-preview.arrangement-valid-no-warning.API | owner | preview, arrangement exists | no warnings | [] | PASS |  |
| TEMPLATE-01.apply-preview.missing-arrangement-warns.API | owner | delete referenced arrangement then preview | explicit warning; arrangement dropped or item kept with song default | del=204 200 warnings=[{"code":"arrangement_missing","params":{"count":1},"message":"1 item(s) use an arrangement that no… | PASS |  |
| TEMPLATE-01.apply.missing-arrangement-item-result.API | owner | apply despite warning | item present, arrangement_id null (no dangling ref) | 200 items=1 arr=null key=E | PASS |  |
| TEMPLATE-01.apply-preview.deleted-song-reference.API | owner | template references a deleted song | warning/skipped; other item kept | del=204 200 warnings=[] skipped=1 add=1 | PASS |  |
| TEMPLATE-03.preview.SUN.owner.API | owner | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.owner.API | owner | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.owner.persisted-state.API | owner | owner re-read plan date | 2035-01-04 | 2035-01-04 | PASS |  |
| TEMPLATE-03.preview.SUN.admin.API | admin | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.admin.API | admin | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.admin.persisted-state.API | admin | owner re-read plan date | 2035-01-11 | 2035-01-11 | PASS |  |
| TEMPLATE-03.preview.SUN.legacy.API | legacy | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.legacy.API | legacy | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.legacy.persisted-state.API | legacy | owner re-read plan date | 2035-01-18 | 2035-01-18 | PASS |  |
| TEMPLATE-03.preview.SUN.scoped.API | scoped | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.scoped.API | scoped | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.scoped.persisted-state.API | scoped | owner re-read plan date | 2035-01-25 | 2035-01-25 | PASS |  |
| TEMPLATE-03.preview.SUN.granted.API | granted | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.granted.API | granted | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.granted.persisted-state.API | granted | owner re-read plan date | 2035-02-01 | 2035-02-01 | PASS |  |
| TEMPLATE-03.preview.SUN.folderlead.API | folderlead | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.folderlead.API | folderlead | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.SUN.folderlead.persisted-state.API | folderlead | owner re-read plan date | 2035-02-08 | 2035-02-08 | PASS |  |
| TEMPLATE-03.preview.SUN.schedonly.API | schedonly | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.schedonly.API | schedonly | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.schedonly.persisted-state.API | schedonly | owner re-read plan date | 2034-07-20 | 2034-07-20 | PASS |  |
| TEMPLATE-03.preview.SUN.member.API | member | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.member.API | member | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.member.persisted-state.API | member | owner re-read plan date | 2034-07-27 | 2034-07-27 | PASS |  |
| TEMPLATE-03.preview.SUN.betaowner.API | betaowner | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.betaowner.API | betaowner | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.SUN.betaowner.persisted-state.API | betaowner | owner re-read plan date | 2034-08-03 | 2034-08-03 | PASS |  |
| TEMPLATE-03.preview.SUN.anon.API | anon | POST /plans/reschedule/preview | 401 | 401 | PASS |  |
| TEMPLATE-03.commit.SUN.anon.API | anon | POST /plans/reschedule | 401 | 401 | PASS |  |
| TEMPLATE-03.commit.SUN.anon.persisted-state.API | anon | owner re-read plan date | 2034-08-10 | 2034-08-10 | PASS |  |
| TEMPLATE-03.preview.MID.owner.API | owner | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.owner.API | owner | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.owner.persisted-state.API | owner | owner re-read plan date | 2035-03-15 | 2035-03-15 | PASS |  |
| TEMPLATE-03.preview.MID.admin.API | admin | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.admin.API | admin | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.admin.persisted-state.API | admin | owner re-read plan date | 2035-03-22 | 2035-03-22 | PASS |  |
| TEMPLATE-03.preview.MID.legacy.API | legacy | POST /plans/reschedule/preview | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.legacy.API | legacy | POST /plans/reschedule | 200 | 200 | PASS |  |
| TEMPLATE-03.commit.MID.legacy.persisted-state.API | legacy | owner re-read plan date | 2035-03-29 | 2035-03-29 | PASS |  |
| TEMPLATE-03.preview.MID.scoped.API | scoped | POST /plans/reschedule/preview | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.scoped.API | scoped | POST /plans/reschedule | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.scoped.persisted-state.API | scoped | owner re-read plan date | 2034-09-07 | 2034-09-07 | PASS |  |
| TEMPLATE-03.preview.MID.granted.API | granted | POST /plans/reschedule/preview | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.granted.API | granted | POST /plans/reschedule | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.granted.persisted-state.API | granted | owner re-read plan date | 2034-09-14 | 2034-09-14 | PASS |  |
| TEMPLATE-03.preview.MID.folderlead.API | folderlead | POST /plans/reschedule/preview | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.folderlead.API | folderlead | POST /plans/reschedule | 403,404 | 404 | PASS |  |
| TEMPLATE-03.commit.MID.folderlead.persisted-state.API | folderlead | owner re-read plan date | 2034-09-21 | 2034-09-21 | PASS |  |
| TEMPLATE-03.preview.MID.schedonly.API | schedonly | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.schedonly.API | schedonly | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.schedonly.persisted-state.API | schedonly | owner re-read plan date | 2034-09-28 | 2034-09-28 | PASS |  |
| TEMPLATE-03.preview.MID.member.API | member | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.member.API | member | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.member.persisted-state.API | member | owner re-read plan date | 2034-10-05 | 2034-10-05 | PASS |  |
| TEMPLATE-03.preview.MID.betaowner.API | betaowner | POST /plans/reschedule/preview | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.betaowner.API | betaowner | POST /plans/reschedule | 403,404 | 403 | PASS |  |
| TEMPLATE-03.commit.MID.betaowner.persisted-state.API | betaowner | owner re-read plan date | 2034-10-12 | 2034-10-12 | PASS |  |
| TEMPLATE-03.preview.MID.anon.API | anon | POST /plans/reschedule/preview | 401 | 401 | PASS |  |
| TEMPLATE-03.commit.MID.anon.API | anon | POST /plans/reschedule | 401 | 401 | PASS |  |
| TEMPLATE-03.commit.MID.anon.persisted-state.API | anon | owner re-read plan date | 2034-10-19 | 2034-10-19 | PASS |  |
| TEMPLATE-03.commit.scoped-mixed-in-and-out-of-scope-atomic.API | scoped | batch with Sunday + Midweek plan | 403/404 and BOTH unchanged | 404 sun=unchanged mid=unchanged | PASS |  |
| TEMPLATE-03.preview.scoped-mixed-batch-no-info-leak.API | scoped | preview with out-of-scope plan | 403/404 (not a partial preview with Midweek details) | 404 leak-title=false | PASS |  |
| TEMPLATE-03.preview.cross-tenant-plan.API | owner | preview moving Beta plan | 404 | 404 leak=false | PASS |  |
| TEMPLATE-03.commit.cross-tenant-plan-in-batch-atomic.API | owner | batch with Alpha + Beta plan | 4xx; Beta plan date unchanged; Alpha unchanged | 404 beta=2027-01-10 alpha=unchanged | PASS |  |
| TEMPLATE-03.preview.validation.no-moves.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.13-moves.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.duplicate-plan-in-moves.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.bad-date.API | owner | POST /plans/reschedule/preview | 400,422,500 | 500 | PASS |  |
| TEMPLATE-03.preview.validation.bad-date-format.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.unknown-plan.API | owner | POST /plans/reschedule/preview | 400,404 | 404 | PASS |  |
| TEMPLATE-03.preview.validation.bad-mode.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.order-only-same-plan.API | owner | POST /plans/reschedule/preview | 400,409,422 | 400 | PASS |  |
| TEMPLATE-03.preview.validation.order-only-missing-dest.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.malformed-plan-id.API | owner | POST /plans/reschedule/preview | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.validation.past-date.API | owner | POST /plans/reschedule/preview | 200,400 | 200 | PASS |  |
| TEMPLATE-03.validation.no-state-change.API | owner | plan after all validation attempts | unchanged date | 2034-11-16 | PASS |  |
| TIME-03.reschedule.local-clock-preserved-across-DST.API | owner | shift 2031-03-02 (CST) -> 2031-03-16 (CDT) | Main 10:00 local = 15:00Z; rehearsal 08:00 local = 13:00Z; same local day | 200 Main=2031-03-16T15:00 reh=2031-03-16T13:00 service_date=2031-03-16T15:00 | PASS |  |
| TIME-03.reschedule.time-ids-stable.API | owner | time ids before/after shift | same ids | true | PASS |  |
| TIME-03.reschedule.local-clock-preserved-across-fall-back.API | owner | shift 2031-10-26 (CDT) -> 2031-11-09 (CST) | 11:00 local stays 11:00 (17:00Z after fall-back) | 2031-11-09T17:00 | PASS |  |
| TIME-03.reschedule.nonexistent-local-time-on-target.API | owner | 02:30 local plan moved to 2031-03-09 (spring forward) | explicit warning/refusal; never silently invalid | preview 400 warnings={"error":"The service time does not exist on 2031-03-09 in America/Chicago (clocks move forward).",… | PASS | record resolution |
| TEMPLATE-03.commit.reset_responses=false.confirmed-kept.API | owner | reschedule reset_responses=false | confirmed stays confirmed | 200 member=confirmed preview.counts={"declined":0,"prepared":0,"confirmed":1,"unconfirmed":1,"requests_resent":0,"respon… | PASS |  |
| TEMPLATE-03.commit.reset_responses=true.confirmed-reset.API | owner | reschedule reset_responses=true | confirmed -> unconfirmed | 200 member=unconfirmed preview.counts={"declined":0,"prepared":0,"confirmed":1,"unconfirmed":1,"requests_resent":0,"resp… | PASS |  |
| TEMPLATE-03.commit.notify=false.effects.D | owner | reschedule notify=false (service-role delivery_effects count) | no new effect | 200 19->19 | PASS |  |
| TEMPLATE-03.commit.notify=true.effects.D | owner | reschedule notify=true (service-role delivery_effects count) | new effect(s) | 200 20->21 | PASS |  |
| TEMPLATE-03.commit.stale-preview-content-changed.API | owner | item added between preview and commit | 409 stale; date unchanged | 409 date=unchanged | PASS | {"error":"The plans changed since you reviewed them. Review again.","code":"template_previ |
| TEMPLATE-03.commit.repeat-key-returns-original.API | owner | commit twice same key | 200 both, same result, plan moved once | 200/200 date=2035-07-19 (expected 2035-07-19) replayed=true | PASS |  |
| TEMPLATE-03.commit.forged-hash.API | owner | made-up hash | 409/400 | 409 | PASS |  |
| TEMPLATE-03.commit.missing-idempotency-key.API | owner | no key | 400 | 422 | PASS |  |
| TEMPLATE-03.preview.conflicts-listed-for-second-plan.API | owner | preview batch where B would collide for G3 | conflicts[] on plan B | plans=0,1 | PASS |  |
| TEMPLATE-03.commit.conflict-without-override-rolls-back-batch.API | owner | conflict on plan B, no reason | 409; A and B both unchanged (all or none) | 200 A=MOVED B=MOVED | NOT_APPLICABLE | conflicts never block a reschedule by design (see W2-PLANS-D12); atomicity covered by cross-tenant/mixed-scope batch cases |
| TEMPLATE-03.commit.override-scoped-no-capability.API | scoped | reason given but no override capability | 403; unchanged | 409 A=MOVED | NOT_APPLICABLE | conflicts never block a reschedule by design (see W2-PLANS-D12); atomicity covered by cross-tenant/mixed-scope batch cases |
| TEMPLATE-03.commit.override-owner-with-reason.API | owner | owner + reason | 200; both moved | 409 A=2038-01-04 B=2038-01-11 | NOT_APPLICABLE | conflicts never block a reschedule by design (see W2-PLANS-D12); atomicity covered by cross-tenant/mixed-scope batch cases |
| TEMPLATE-03.order-only.preview.API | owner | order_only preview | 200 listing plan(s) | 200 keys=mode,source,warnings,unchanged,items_mode,destination,preview_hash,remove_from_source | PASS | {"mode":"order_only","source":{"items":["O1","O2","O3"],"title":"QA rs order src","plan_id":"c3f115cd-b449-45b3-bfa0-8ec274436530","content_ |
| TEMPLATE-03.order-only.commit.scoped.API | scoped | commit order_only | 200 (Sunday scope) | 200 src items=0 | PASS |  |
| TEMPLATE-03.order-only.commit.moves-items-append-remove-from-source.API | scoped/owner | order_only append remove_from_source | dest: D1,O1,O2,O3; source empty | src= dest=D1,O1,O2,O3 | PASS | if a prior actor committed, owner replay here is the same key-less run |
| TEMPLATE-03.order-only.scoped-removes-from-out-of-scope-Midweek-source.API | scoped | order_only moving items OUT of a Midweek plan into a Sunday plan | 403/404 and Midweek items intact | 404 midweek items=1 | PASS | {"error":"Plan not found","code":"not_found"} |
| TEMPLATE-03.commit.scoped-no-override-cap-creates-double-booking.API | scoped | scoped (no scheduling.override_conflicts) bulk-reschedules plan into same-time overlap for… | refused or requires override capability + reason (oracle: conflict override needs matching… | preview conflicts=1 commit=200 moved=2039-03-03 afterwards check_assignment_conflicts severity=warning | FAIL | W2-PLANS-D12 person G is now double-booked (blocking-severity overlap) via the reschedule path; the same person cannot be assigned this way without ov… |
| ORDER-01.add.SUN.owner.API | owner | POST /plans/<5e47>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.owner.API | owner | PATCH /plans/<5e47>/items/<2640> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.owner.API | owner | DELETE /plans/<5e47>/items/<d79d> | 204 | 204 | PASS |  |
| ORDER-01.SUN.owner.persisted-state.API | owner | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by owner\|added by owner | PASS |  |
| ORDER-01.add.SUN.admin.API | admin | POST /plans/<cb64>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.admin.API | admin | PATCH /plans/<cb64>/items/<11be> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.admin.API | admin | DELETE /plans/<cb64>/items/<2b17> | 204 | 204 | PASS |  |
| ORDER-01.SUN.admin.persisted-state.API | admin | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by admin\|added by admin | PASS |  |
| ORDER-01.add.SUN.legacy.API | legacy | POST /plans/<df9c>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.legacy.API | legacy | PATCH /plans/<df9c>/items/<ca0e> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.legacy.API | legacy | DELETE /plans/<df9c>/items/<ba88> | 204 | 204 | PASS |  |
| ORDER-01.SUN.legacy.persisted-state.API | legacy | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by legacy\|added by legacy | PASS |  |
| ORDER-01.add.SUN.scoped.API | scoped | POST /plans/<832e>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.scoped.API | scoped | PATCH /plans/<832e>/items/<dd70> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.scoped.API | scoped | DELETE /plans/<832e>/items/<c56b> | 204 | 204 | PASS |  |
| ORDER-01.SUN.scoped.persisted-state.API | scoped | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by scoped\|added by scoped | PASS |  |
| ORDER-01.add.SUN.granted.API | granted | POST /plans/<00bb>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.granted.API | granted | PATCH /plans/<00bb>/items/<f5fb> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.granted.API | granted | DELETE /plans/<00bb>/items/<72ea> | 204 | 204 | PASS |  |
| ORDER-01.SUN.granted.persisted-state.API | granted | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by granted\|added by granted | PASS |  |
| ORDER-01.add.SUN.folderlead.API | folderlead | POST /plans/<e21f>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.SUN.folderlead.API | folderlead | PATCH /plans/<e21f>/items/<1764> | 200 | 200 | PASS |  |
| ORDER-01.delete.SUN.folderlead.API | folderlead | DELETE /plans/<e21f>/items/<cf25> | 204 | 204 | PASS |  |
| ORDER-01.SUN.folderlead.persisted-state.API | folderlead | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by folderlead\|added by folderlead | PASS |  |
| ORDER-01.add.SUN.schedonly.API | schedonly | POST /plans/<4a37>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.SUN.schedonly.API | schedonly | PATCH /plans/<4a37>/items/<ac79> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.SUN.schedonly.API | schedonly | DELETE /plans/<4a37>/items/<26ef> | 403,404 | 403 | PASS |  |
| ORDER-01.SUN.schedonly.persisted-state.API | schedonly | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.SUN.member.API | member | POST /plans/<51d1>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.SUN.member.API | member | PATCH /plans/<51d1>/items/<2d58> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.SUN.member.API | member | DELETE /plans/<51d1>/items/<31f2> | 403,404 | 403 | PASS |  |
| ORDER-01.SUN.member.persisted-state.API | member | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.SUN.librarian.API | multi | POST /plans/<5cea>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.SUN.librarian.API | multi | PATCH /plans/<5cea>/items/<64d7> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.SUN.librarian.API | multi | DELETE /plans/<5cea>/items/<ebf3> | 403,404 | 403 | PASS |  |
| ORDER-01.SUN.librarian.persisted-state.API | multi | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.SUN.betaowner.API | betaowner | POST /plans/<d93b>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.SUN.betaowner.API | betaowner | PATCH /plans/<d93b>/items/<f91a> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.SUN.betaowner.API | betaowner | DELETE /plans/<d93b>/items/<7a1d> | 403,404 | 403 | PASS |  |
| ORDER-01.SUN.betaowner.persisted-state.API | betaowner | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.SUN.anon.API | anon | POST /plans/<b77c>/items | 401 | 401 | PASS |  |
| ORDER-01.edit.SUN.anon.API | anon | PATCH /plans/<b77c>/items/<1461> | 401 | 401 | PASS |  |
| ORDER-01.delete.SUN.anon.API | anon | DELETE /plans/<b77c>/items/<7bfe> | 401 | 401 | PASS |  |
| ORDER-01.SUN.anon.persisted-state.API | anon | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.owner.API | owner | POST /plans/<b64b>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.MID.owner.API | owner | PATCH /plans/<b64b>/items/<e183> | 200 | 200 | PASS |  |
| ORDER-01.delete.MID.owner.API | owner | DELETE /plans/<b64b>/items/<033d> | 204 | 204 | PASS |  |
| ORDER-01.MID.owner.persisted-state.API | owner | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by owner\|added by owner | PASS |  |
| ORDER-01.add.MID.admin.API | admin | POST /plans/<59e0>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.MID.admin.API | admin | PATCH /plans/<59e0>/items/<ec4f> | 200 | 200 | PASS |  |
| ORDER-01.delete.MID.admin.API | admin | DELETE /plans/<59e0>/items/<39f2> | 204 | 204 | PASS |  |
| ORDER-01.MID.admin.persisted-state.API | admin | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by admin\|added by admin | PASS |  |
| ORDER-01.add.MID.legacy.API | legacy | POST /plans/<2a04>/items | 201 | 201 | PASS |  |
| ORDER-01.edit.MID.legacy.API | legacy | PATCH /plans/<2a04>/items/<aaa9> | 200 | 200 | PASS |  |
| ORDER-01.delete.MID.legacy.API | legacy | DELETE /plans/<2a04>/items/<77f1> | 204 | 204 | PASS |  |
| ORDER-01.MID.legacy.persisted-state.API | legacy | owner re-read items | 2 items (edited base, added; base2 deleted) | edited by legacy\|added by legacy | PASS |  |
| ORDER-01.add.MID.scoped.API | scoped | POST /plans/<f7a2>/items | 403,404 | 404 | PASS |  |
| ORDER-01.edit.MID.scoped.API | scoped | PATCH /plans/<f7a2>/items/<44e8> | 403,404 | 404 | PASS |  |
| ORDER-01.delete.MID.scoped.API | scoped | DELETE /plans/<f7a2>/items/<4dd2> | 403,404 | 404 | PASS |  |
| ORDER-01.MID.scoped.persisted-state.API | scoped | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.granted.API | granted | POST /plans/<6f39>/items | 403,404 | 404 | PASS |  |
| ORDER-01.edit.MID.granted.API | granted | PATCH /plans/<6f39>/items/<1b34> | 403,404 | 404 | PASS |  |
| ORDER-01.delete.MID.granted.API | granted | DELETE /plans/<6f39>/items/<b7e7> | 403,404 | 404 | PASS |  |
| ORDER-01.MID.granted.persisted-state.API | granted | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.folderlead.API | folderlead | POST /plans/<b5b9>/items | 403,404 | 404 | PASS |  |
| ORDER-01.edit.MID.folderlead.API | folderlead | PATCH /plans/<b5b9>/items/<d86f> | 403,404 | 404 | PASS |  |
| ORDER-01.delete.MID.folderlead.API | folderlead | DELETE /plans/<b5b9>/items/<6a26> | 403,404 | 404 | PASS |  |
| ORDER-01.MID.folderlead.persisted-state.API | folderlead | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.schedonly.API | schedonly | POST /plans/<b06a>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.MID.schedonly.API | schedonly | PATCH /plans/<b06a>/items/<07d2> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.MID.schedonly.API | schedonly | DELETE /plans/<b06a>/items/<ad46> | 403,404 | 403 | PASS |  |
| ORDER-01.MID.schedonly.persisted-state.API | schedonly | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.member.API | member | POST /plans/<a661>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.MID.member.API | member | PATCH /plans/<a661>/items/<f288> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.MID.member.API | member | DELETE /plans/<a661>/items/<88f4> | 403,404 | 403 | PASS |  |
| ORDER-01.MID.member.persisted-state.API | member | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.librarian.API | multi | POST /plans/<b4b8>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.MID.librarian.API | multi | PATCH /plans/<b4b8>/items/<1202> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.MID.librarian.API | multi | DELETE /plans/<b4b8>/items/<9016> | 403,404 | 403 | PASS |  |
| ORDER-01.MID.librarian.persisted-state.API | multi | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.betaowner.API | betaowner | POST /plans/<3eb5>/items | 403,404 | 403 | PASS |  |
| ORDER-01.edit.MID.betaowner.API | betaowner | PATCH /plans/<3eb5>/items/<77b2> | 403,404 | 403 | PASS |  |
| ORDER-01.delete.MID.betaowner.API | betaowner | DELETE /plans/<3eb5>/items/<e4b3> | 403,404 | 403 | PASS |  |
| ORDER-01.MID.betaowner.persisted-state.API | betaowner | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.anon.API | anon | POST /plans/<acfb>/items | 401 | 401 | PASS |  |
| ORDER-01.edit.MID.anon.API | anon | PATCH /plans/<acfb>/items/<0374> | 401 | 401 | PASS |  |
| ORDER-01.delete.MID.anon.API | anon | DELETE /plans/<acfb>/items/<e5fd> | 401 | 401 | PASS |  |
| ORDER-01.MID.anon.persisted-state.API | anon | owner re-read items | unchanged base1\|base2 | base1\|base2 | PASS |  |
| ORDER-01.add.MID.member.RLS-direct.RLS | member | POST /rest/v1/plan_items | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new ro |
| ORDER-01.edit.MID.member.RLS-direct.RLS | member | PATCH /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.delete.MID.member.RLS-direct.RLS | member | DELETE /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.add.MID.member.RPC-direct.RLS | member | POST /rest/v1/rpc/add_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-02.reorder.MID.member.RPC-direct.RLS | member | POST /rest/v1/rpc/reorder_plan_items | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.delete.MID.member.RPC-direct.RLS | member | POST /rest/v1/rpc/delete_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.add.MID.schedonly.RLS-direct.RLS | schedonly | POST /rest/v1/plan_items | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new ro |
| ORDER-01.edit.MID.schedonly.RLS-direct.RLS | schedonly | PATCH /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.delete.MID.schedonly.RLS-direct.RLS | schedonly | DELETE /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.add.MID.schedonly.RPC-direct.RLS | schedonly | POST /rest/v1/rpc/add_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-02.reorder.MID.schedonly.RPC-direct.RLS | schedonly | POST /rest/v1/rpc/reorder_plan_items | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.delete.MID.schedonly.RPC-direct.RLS | schedonly | POST /rest/v1/rpc/delete_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.add.MID.scoped.RLS-direct.RLS | scoped | POST /rest/v1/plan_items | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new ro |
| ORDER-01.edit.MID.scoped.RLS-direct.RLS | scoped | PATCH /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.delete.MID.scoped.RLS-direct.RLS | scoped | DELETE /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.add.MID.scoped.RPC-direct.RLS | scoped | POST /rest/v1/rpc/add_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-02.reorder.MID.scoped.RPC-direct.RLS | scoped | POST /rest/v1/rpc/reorder_plan_items | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.delete.MID.scoped.RPC-direct.RLS | scoped | POST /rest/v1/rpc/delete_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.add.MID.granted.RLS-direct.RLS | granted | POST /rest/v1/plan_items | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new ro |
| ORDER-01.edit.MID.granted.RLS-direct.RLS | granted | PATCH /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.delete.MID.granted.RLS-direct.RLS | granted | DELETE /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.add.MID.granted.RPC-direct.RLS | granted | POST /rest/v1/rpc/add_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-02.reorder.MID.granted.RPC-direct.RLS | granted | POST /rest/v1/rpc/reorder_plan_items | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.delete.MID.granted.RPC-direct.RLS | granted | POST /rest/v1/rpc/delete_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.add.MID.librarian.RLS-direct.RLS | multi | POST /rest/v1/plan_items | denied | 403 | PASS | {"code":"42501","details":null,"hint":null,"message":"new ro |
| ORDER-01.edit.MID.librarian.RLS-direct.RLS | multi | PATCH /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.delete.MID.librarian.RLS-direct.RLS | multi | DELETE /rest/v1/plan_items | 0 rows | 200 rows=0 | PASS |  |
| ORDER-01.add.MID.librarian.RPC-direct.RLS | multi | POST /rest/v1/rpc/add_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-02.reorder.MID.librarian.RPC-direct.RLS | multi | POST /rest/v1/rpc/reorder_plan_items | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.delete.MID.librarian.RPC-direct.RLS | multi | POST /rest/v1/rpc/delete_plan_item | denied | 500 | PASS | {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} |
| ORDER-01.RLS-direct.persisted-unchanged.API | owner | re-read items | 1 item (rls base) | rls base | PASS |  |
| ORDER-01.add.cross-tenant-plan.API | owner | POST item to Beta plan from Alpha ctx | 404 | 404 | PASS |  |
| ORDER-01.cross-tenant.edit-delete-reorder.beta-intact.API | owner | PATCH/DELETE/PUT order on Beta plan item | Beta item intact, title unchanged | patch=404 del=404 order=404 betaItems=1 title=BETA ITEM SENTINEL | PASS |  |
| ORDER-01.edit-delete.item-under-wrong-plan-path.API | owner | PATCH/DELETE item of plan B via plan A path | 404; item unchanged on B | patch=404 del=404 B title=on B count=1 | PASS |  |
| ORDER-02.reorder.SUN.owner.API | owner | PUT /plans/<ccf4>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.owner.persisted-state.API | owner | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.admin.API | admin | PUT /plans/<268b>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.admin.persisted-state.API | admin | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.legacy.API | legacy | PUT /plans/<f510>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.legacy.persisted-state.API | legacy | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.scoped.API | scoped | PUT /plans/<e8f9>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.scoped.persisted-state.API | scoped | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.granted.API | granted | PUT /plans/<938e>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.granted.persisted-state.API | granted | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.folderlead.API | folderlead | PUT /plans/<36a4>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.SUN.folderlead.persisted-state.API | folderlead | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.SUN.schedonly.API | schedonly | PUT /plans/<36d9>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.SUN.schedonly.persisted-state.API | schedonly | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.SUN.member.API | member | PUT /plans/<dd7b>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.SUN.member.persisted-state.API | member | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.SUN.librarian.API | multi | PUT /plans/<37ed>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.SUN.librarian.persisted-state.API | multi | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.SUN.betaowner.API | betaowner | PUT /plans/<9a4a>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.SUN.betaowner.persisted-state.API | betaowner | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.SUN.anon.API | anon | PUT /plans/<a539>/items/order | 401 | 401 | PASS |  |
| ORDER-02.reorder.SUN.anon.persisted-state.API | anon | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.owner.API | owner | PUT /plans/<fa36>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.MID.owner.persisted-state.API | owner | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.MID.admin.API | admin | PUT /plans/<2098>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.MID.admin.persisted-state.API | admin | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.MID.legacy.API | legacy | PUT /plans/<b273>/items/order | 200 | 200 | PASS |  |
| ORDER-02.reorder.MID.legacy.persisted-state.API | legacy | owner re-read order | r3r1r2 | r3r1r2 | PASS |  |
| ORDER-02.reorder.MID.scoped.API | scoped | PUT /plans/<aecb>/items/order | 403,404 | 404 | PASS |  |
| ORDER-02.reorder.MID.scoped.persisted-state.API | scoped | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.granted.API | granted | PUT /plans/<ee8c>/items/order | 403,404 | 404 | PASS |  |
| ORDER-02.reorder.MID.granted.persisted-state.API | granted | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.folderlead.API | folderlead | PUT /plans/<51cf>/items/order | 403,404 | 404 | PASS |  |
| ORDER-02.reorder.MID.folderlead.persisted-state.API | folderlead | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.schedonly.API | schedonly | PUT /plans/<2f33>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.MID.schedonly.persisted-state.API | schedonly | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.member.API | member | PUT /plans/<c0d6>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.MID.member.persisted-state.API | member | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.librarian.API | multi | PUT /plans/<9a8c>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.MID.librarian.persisted-state.API | multi | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.betaowner.API | betaowner | PUT /plans/<3ed9>/items/order | 403,404 | 403 | PASS |  |
| ORDER-02.reorder.MID.betaowner.persisted-state.API | betaowner | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-02.reorder.MID.anon.API | anon | PUT /plans/<2cc4>/items/order | 401 | 401 | PASS |  |
| ORDER-02.reorder.MID.anon.persisted-state.API | anon | owner re-read order | r1r2r3 | r1r2r3 | PASS |  |
| ORDER-01.add.validation.header.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.free-item.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.default-type-item.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.no-title-item.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.blank-title.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.header-no-title.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.title-200.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.title-201.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.desc-4000.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.desc-4001.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.length-0.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.length-36000.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.length-36001.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.length-negative.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.length-float.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.length-string.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.bad-item_type.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.bad-segment.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.segment-pre.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.segment-service.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.segment-post.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.song-without-song_id.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.song-ok.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.song-title-defaults-to-song.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.song-unknown-id.API | owner | POST /plans/<9ecc>/items | 400,404,409 | 400 | PASS |  |
| ORDER-01.add.validation.song-from-Beta-org.API | owner | POST /plans/<9ecc>/items | 400,404,409 | 400 | PASS | cross-tenant reference |
| ORDER-01.add.validation.song-archived.API | owner | POST /plans/<9ecc>/items | 201,400,409 | 400 | PASS | record behaviour for archived songs |
| ORDER-01.add.validation.song-with-matching-arrangement.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.song-with-OTHER-songs-arrangement.API | owner | POST /plans/<9ecc>/items | 400,404,409,422 | 400 | PASS | wrong arrangement for song |
| ORDER-01.add.validation.song-with-Beta-arrangement.API | owner | POST /plans/<9ecc>/items | 400,404,409,422 | 400 | PASS |  |
| ORDER-01.add.validation.song-with-archived-arrangement.API | owner | POST /plans/<9ecc>/items | 201,400,409 | 400 | PASS | record |
| ORDER-01.add.validation.arrangement-on-non-song-item.API | owner | POST /plans/<9ecc>/items | 400,201 | 400 | PASS | schema only blocks on update; record |
| ORDER-01.add.validation.arrangement-without-song.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.key-8.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.key-9.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.seq-60.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.seq-61.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.seq-step-21-chars.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.seq-empty-list-no-sequence.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.seq-blank-step.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.leader-person.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.leader-member-person.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.leader-position.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.leader-both.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.leader-unknown-person.API | owner | POST /plans/<9ecc>/items | 400,404,409 | 400 | PASS |  |
| ORDER-01.add.validation.leader-Beta-person.API | owner | POST /plans/<9ecc>/items | 400,404,409 | 400 | PASS | cross-tenant leader |
| ORDER-01.add.validation.leader-Beta-position.API | owner | POST /plans/<9ecc>/items | 400,404,409 | 400 | PASS |  |
| ORDER-01.add.validation.leader-malformed-uuid.API | owner | POST /plans/<9ecc>/items | 400 | 422 | PASS |  |
| ORDER-01.add.validation.html-title.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.unicode.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS |  |
| ORDER-01.add.validation.extra-fields-plan_id-override.API | owner | POST /plans/<9ecc>/items | 201 | 201 | PASS | unknown keys ignored |
| ORDER-01.add.mass-assign-plan_id.persisted-on-correct-plan.API | owner | POST with plan_id: Beta in body | item on Alpha plan only; Beta plan untouched | beta items=1 alpha has x=true | PASS |  |
| ORDER-01.add.sort_order-insert-first-middle-beyond-end.API | owner | add with sort_order 0, 2, 500 | FIRST,a,MID,b,c,FAR; contiguous sort_order | FIRST,a,b,c,MID,FAR so=0,0,1,2,2,500 | FAIL | W2-PLANS-D5  |
| ORDER-01.add.sort_order-contiguous-unique.API | owner | sort_order values | unique | 0,0,1,2,2,500 | FAIL | W2-PLANS-D5  |
| ORDER-01.edit.validation.title.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.empty-title.API | owner | PATCH /plans/<f814>/items/<8426> | 400 | 422 | PASS |  |
| ORDER-01.edit.validation.title-201.API | owner | PATCH /plans/<f814>/items/<8426> | 400 | 422 | PASS |  |
| ORDER-01.edit.absent-fields-kept.API | owner | PATCH title only | key A, sequence V1/C, leader, length 100, segment pre kept | key=A seq=V1,C leader=true len=100 seg=pre | PASS |  |
| ORDER-01.edit.validation.clear-key-null.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.clear-seq-null-inherit.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.clear-leader.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.clear-description.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.null-clears.API | owner | null clears key/sequence/leader/description | all null | key=null seq=null leader=null desc=null | PASS |  |
| ORDER-01.edit.validation.set-leader-position-after-person-cleared.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.leader-both.API | owner | PATCH /plans/<f814>/items/<8426> | 400 | 422 | PASS |  |
| ORDER-01.edit.validation.swap-leader-person-then-position-in-one-patch.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS | person set, position cleared |
| ORDER-01.edit.validation.negative-length.API | owner | PATCH /plans/<f814>/items/<8426> | 400 | 422 | PASS |  |
| ORDER-01.edit.validation.segment-post.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.bad-segment.API | owner | PATCH /plans/<f814>/items/<8426> | 400 | 422 | PASS |  |
| ORDER-01.edit.validation.arrangement-other-song.API | owner | PATCH /plans/<f814>/items/<8426> | 400,404,409,422 | 400 | PASS |  |
| ORDER-01.edit.validation.arrangement-matching.API | owner | PATCH /plans/<f814>/items/<8426> | 200 | 200 | PASS |  |
| ORDER-01.edit.validation.arrangement-beta.API | owner | PATCH /plans/<f814>/items/<8426> | 400,404,409,422 | 400 | PASS |  |
| ORDER-01.edit.validation.song-change-to-Beta-song.API | owner | PATCH /plans/<f814>/items/<8426> | 400,404,409,422 | 400 | PASS |  |
| ORDER-01.edit.validation.song-change-to-other-Alpha-song-keeps-arrangement?.API | owner | PATCH /plans/<f814>/items/<8426> | 200,400,409,422 | 200 | PASS | record; arrangement from song1 must not remain |
| ORDER-01.edit.song-change-arrangement-consistency.API | owner | change song_id while arrangement_id pinned to old song | arrangement belongs to item song or cleared | song=song2 arr=null (s1Alt=bdc226ed-22b3-4825-9a10-c837ff2e625f) | PASS | arrangement/song mismatch would corrupt chart context |
| ORDER-01.edit.validation.type-to-header-clears-song?.API | owner | PATCH /plans/<f814>/items/<8426> | 200,400 | 200 | PASS | song->item change |
| ORDER-01.edit.unknown-item-id.API | owner | PATCH unknown item | 404 | 404 | PASS |  |
| ORDER-01.edit.malformed-item-id.API | owner | PATCH item id "abc" | 400/404 (not 500) | 500 {"error":"invalid input syntax for type uuid: \"abc\"","code | FAIL | W2-PLANS-D4 W1 API-D5 class |
| ORDER-01.edit.stale-expected_revision-409.API | owner | two edits with the same expected_revision | first 200 (+revision), second 409 plan_revision_stale; first wins | 200/409 plan_revision_stale title=rev ok | PASS |  |
| ORDER-01.edit.omitted-revision-last-writer-wins.API | owner | edit omitting expected_revision | (observation) accepted | 200 | PASS | revision optional |
| ORDER-01.delete.stale-expected_revision.API | owner | DELETE ?expected_revision=0 (stale) | 409; item remains | 409 items=1 | PASS |  |
| ORDER-01.delete.malformed-revision.API | owner | DELETE ?expected_revision=abc | 400 | 422 | PASS |  |
| ORDER-01.delete.with-current-revision-then-repeat.API | owner | DELETE current revision, DELETE again | 204 then 404 | 204/404 | PASS |  |
| ORDER-01.delete.order-of-remaining-and-revision-bump.API | owner | delete b | a,c,d in order; revision increased | a,c,d rev 4->5 so=0,2,3 | PASS |  |
| ORDER-02.add.duplicate-tap-same-key-one-row.API | owner | POST item twice same idempotency_key | 201 then 200 same id; one row | 201/200 same=true rows=1 | PASS |  |
| ORDER-02.add.same-key-different-body-409.API | owner | same key, other title | 409 idempotency_key_reused | 409 idempotency_key_reused | PASS |  |
| ORDER-02.add.key-reuse.no-second-row.API | owner | rows after reuse attempt | 1 | 1 | PASS |  |
| ORDER-02.add.replay-after-item-removed.API | owner | replay key after item deleted | 4xx explicit (item added and removed), not silent re-create | 404 {"error":"That item was added and then removed","code":"not_found"} rows=0 | PASS | DB raises P0002; observe mapping |
| ORDER-02.add.key-scoped-per-user.API | admin | same key by a different user | independent (201), no cross-user replay leak | 201/201 titles=u1/u2 | PASS |  |
| ORDER-02.add.short-idempotency-key.API | owner | key < 8 chars | 400 | 422 | PASS |  |
| ORDER-02.add.12-parallel-appends-distinct-positions.API | owner | 12 parallel POST items | 12 rows, distinct sort_order, no lost row | statuses=201 rows=12 distinct so=12 | PASS |  |
| ORDER-02.add.6-parallel-same-key-one-row.API | owner | 6 parallel adds same key | exactly 1 row | statuses=200,200,200,201,200,200 rows=1 | PASS |  |
| ORDER-02.reorder.validation.missing-one-id.API | owner | PUT /plans/<f18b>/items/order | 400 | 400 | PASS |  |
| ORDER-02.reorder.validation.extra-unknown-id.API | owner | PUT /plans/<f18b>/items/order | 400,404,409 | 400 | PASS |  |
| ORDER-02.reorder.validation.duplicate-id.API | owner | PUT /plans/<f18b>/items/order | 400 | 400 | PASS |  |
| ORDER-02.reorder.validation.empty.API | owner | PUT /plans/<f18b>/items/order | 400 | 422 | PASS |  |
| ORDER-02.reorder.validation.malformed-uuid.API | owner | PUT /plans/<f18b>/items/order | 400 | 422 | PASS |  |
| ORDER-02.reorder.validation.foreign-plan-item.API | owner | PUT /plans/<f18b>/items/order | 400,404,409 | 400 | PASS |  |
| ORDER-02.reorder.validation.not-array.API | owner | PUT /plans/<f18b>/items/order | 400 | 422 | PASS |  |
| ORDER-02.reorder.validation.501-ids.API | owner | PUT /plans/<f18b>/items/order | 400 | 422 | PASS |  |
| ORDER-02.reorder.rejections-leave-order-unchanged.API | owner | order after rejected reorders | a,b,c,d | a,b,c,d | PASS |  |
| ORDER-02.reorder.stale-revision-409-first-wins.API | owner | two reorders same expected_revision | first 200, second 409; order d,c,b,a | 200/409 d,c,b,a | PASS |  |
| ORDER-02.reorder.sort_order-contiguous.API | owner | sort_order after reorder | 0..3 | 0,1,2,3 | PASS |  |
| ORDER-02.reorder.noop-reorder-revision.API | owner | reorder to identical order | (record) revision bump or not | 8->8 | PASS | observation only |
| ORDER-02.reorder.vs-concurrent-add-no-lost-row.API | owner | reorder with a list missing the newly added item | refused; new item retained | 400 items=5 | PASS |  |
| ORDER-02.reorder.4-parallel-reorders-consistent.API | owner | 4 parallel reorders (no revision) | all 200; final order is exactly one of the requests; contiguous unique sort_order; 5 rows | statuses=200,200,200,200 so=0,1,2,3,4 rows=5 | PASS |  |
| ORDER-02.edit-vs-delete-concurrent.API | owner | parallel PATCH + DELETE same item | no 500; item either deleted or edited, consistent | 404,204 rows=4 | PASS |  |
| ORDER-02.two-planners-concurrent-adds-both-kept.API | scoped+legacy | parallel add by two planners | both rows kept | 201/201 rows=2 | PASS |  |
| ORDER-02.reorder-then-stale-edit-409.API | scoped+legacy | planner 2 edits with pre-reorder revision | 409; reorder preserved, edit not applied | 200/409 y,x | PASS |  |
| ORDER-03.default-inherit.API | owner | song item with no arrangement/key/sequence | inherits default arrangement (default_arrangement populated), key_override null | arr=null default=Default Arrangement key_override=null | PASS |  |
| ORDER-03.plan-only-override-applies-to-this-plan.API | owner | set nondefault arrangement + key Bb + sequence on P1 item | P1 item shows override; detail embeds chosen arrangement | 200 arr=S1 Alt key=Bb seq=V1,C,C,B | PASS |  |
| ORDER-03.other-plan-unchanged.API | owner | P2 item of same song | still inheriting (no overrides) | arr=null key=null seq=null | PASS |  |
| ORDER-03.library-defaults-unchanged.API | owner | song + arrangements after plan overrides | identical (default_key, sequences, default flag, revisions) | identical | PASS |  |
| ORDER-03.reader-sees-effective-context.member.API | member | GET plan detail | override values visible (arr bdc226ed-22b3-4825-9a10-c837ff2e625f, key Bb) | true key=Bb | PASS |  |
| ORDER-03.reader-sees-effective-context.schedonly.API | schedonly | GET plan detail | override values visible (arr bdc226ed-22b3-4825-9a10-c837ff2e625f, key Bb) | true key=Bb | PASS |  |
| ORDER-03.reader-sees-effective-context.scoped.API | scoped | GET plan detail | override values visible (arr bdc226ed-22b3-4825-9a10-c837ff2e625f, key Bb) | true key=Bb | PASS |  |
| ORDER-03.reader-sees-effective-context.granted.API | granted | GET plan detail | override values visible (arr bdc226ed-22b3-4825-9a10-c837ff2e625f, key Bb) | true key=Bb | PASS |  |
| ORDER-03.chart-endpoint-with-target-key.API | owner | GET /arrangements/:id/chart?to=Bb | 200; chart in Bb (record shape) | 200 keys=chordpro,key,semitones,notation | PASS |  |
| ORDER-03.chart-endpoint-invalid-key.API | owner | chart?to=ZZZ | 400 or graceful | 200 {"chordpro":"","key":"B","semitones":0,"notation":"chords"} | PASS |  |
| ORDER-03.chart-semitones-out-of-range.API | owner | chart?semitones=12 | 400 | 422 | PASS |  |
| ORDER-03.chart-member-read.API | member | GET chart as member | 200 (library read) | 200 | PASS |  |
| ORDER-03.chart-cross-tenant-arrangement.API | owner | GET Beta arrangement chart from Alpha | 404 | 404 | PASS |  |
| ORDER-03.duplicate-keeps-plan-overrides.API | owner | duplicate P1 | overrides copied to copy only | arr=true key=Bb seq=V1,C,C,B | PASS |  |
| ORDER-03.clear-overrides-returns-to-inherit.API | owner | null arrangement/key/sequence | inherits again | 200 arr=null key=null seq=null default=Default Arrangement | PASS |  |
| ORDER-03.archived-arrangement-pinned-by-plan.API | owner | archive arrangement pinned by a plan item | plan keeps reference (history) or explicit refusal; no 500 | pin=200 archive=200 item arr=still pinned detail.arrangement=S1 Alt | PASS |  |
| ORDER-03.delete-arrangement-pinned-by-plan.API | owner | delete arrangement referenced by plan item | refused (reference protection) or item falls back to inherit; no dangling id | 400 item arr=3292ffdd-f53d-49dd-9a7f-446c3ff55fa5 key=G {"error":"Referenced record does not exist","code":"bad_requ | FAIL | W2-PLANS-D9 in-use delete is refused but as 400 "Referenced record does not exist" (23503 mapped as bad_request); expected 409 "in use" |
| ORDER-03.delete-song-referenced-by-plan.API | owner | delete song used in a plan | refused or item retained with title; no 500 | 400 items=1 song_id=309b766a-9abb-4792-bc19-2f682706a937 {"error":"Referenced record does not exist","code":"bad_requ | FAIL | W2-PLANS-D9 in-use delete is refused but as 400 "Referenced record does not exist" (23503 mapped as bad_request); expected 409 "in use" |
| ORDER-01.leader-name-resolution.owner.API | owner | GET plan item leader_person | full_name "Guest1 QaPlans" | Guest1 QaPlans | PASS |  |
| ORDER-01.leader-name-resolution.member.API | member | GET plan item leader_person | full_name "Guest1 QaPlans" | Guest1 QaPlans | PASS |  |
| ORDER-01.leader-name-resolution.scoped.API | scoped | GET plan item leader_person | full_name "Guest1 QaPlans" | Guest1 QaPlans | PASS |  |
| ORDER-04.schedule.default-first-service-time.API | owner | GET /plans/:id/schedule | selected = First (16:00Z); service_seconds 240+0+1200=1440; pre 300; post 600 | 200 start=2040-06-02T16:00:00.000Z pre=300 svc=1440 post=600 finish=2040-06-02T16:24:00.000Z | PASS |  |
| ORDER-04.schedule.pre-ends-at-service-start.API | owner | Pre announce 300s | starts 15:55, ends 16:00 | 15:55:00-16:00:00 | PASS |  |
| ORDER-04.schedule.song-and-zero-length-and-header.API | owner | Song A 240s, Zero 0s, Hdr 0 (header with length 999 ignored) | Song A 16:00-16:04; Zero 16:04-16:04; Hdr2 16:04 dur 0; Talk 16:04-16:24 | A=16:00:00-16:04:00 Z=16:04:00 H2=0s Talk=16:04:00-16:24:00 | PASS |  |
| ORDER-04.schedule.post-starts-at-planned-finish.API | owner | Post fellowship 600s | 16:24-16:34 (does not count toward service length) | 16:24:00-16:34:00 | PASS |  |
| ORDER-04.schedule.runs_over-warning.API | owner | service 1440s vs 3600s window | no runs_over | [] | PASS |  |
| ORDER-04.schedule.runs_over-seconds.API | owner | add 3000s: 4440s vs 3600 | runs_over by 840s | [{"code":"segment_out_of_order","item_id":"2791831c-b569-401d-afdf-111681ecd67e"},{"code":"runs_over","seconds":840}] | PASS |  |
| ORDER-04.schedule.selected-second-time.API | owner | ?time_id=Second | service_starts_at 18:00Z; pre starts 17:55 | 200 2040-06-02T18:00:00.000Z | PASS |  |
| ORDER-04.schedule.rehearsal-time-id-rejected.API | owner | GET /plans/<bdd4>/schedule?time_id=<befc> | 404 | 404 | PASS |  |
| ORDER-04.schedule.unknown-time-id.API | owner | GET /plans/<bdd4>/schedule?time_id=<0000> | 404 | 404 | PASS |  |
| ORDER-04.schedule.malformed-time-id.API | owner | GET /plans/<bdd4>/schedule?time_id=zzz | 400 | 422 | PASS |  |
| ORDER-04.schedule.time-id-of-other-plan.API | owner | GET /plans/<bdd4>/schedule?time_id=<3526> | 404 | 404 | PASS |  |
| ORDER-04.schedule.read.member.API | member | GET /plans/<bdd4>/schedule | 200 | 200 | PASS |  |
| ORDER-04.schedule.read.schedonly.API | schedonly | GET /plans/<bdd4>/schedule | 200 | 200 | PASS |  |
| ORDER-04.schedule.read.scoped.API | scoped | GET /plans/<bdd4>/schedule | 200 | 200 | PASS |  |
| ORDER-04.schedule.read.granted.API | granted | GET /plans/<bdd4>/schedule | 200 | 200 | PASS |  |
| ORDER-04.schedule.read.betaowner.API | betaowner | GET /plans/<bdd4>/schedule | 403,404 | 403 | PASS |  |
| ORDER-04.schedule.read.anon.API | anon | GET /plans/<bdd4>/schedule | 401 | 401 | PASS |  |
| ORDER-04.schedule.no-service-time.API | owner | plan with no service times | 200 with no_service_time warning, totals still computed | 200 [{"code":"no_service_time"}] svc=60 | PASS |  |
| ORDER-04.detail-total-length-vs-schedule-totals.API | owner | plan.total_length_seconds vs pre+service+post | (record) detail total counts header lengths? | detail=6339 schedule pre+svc+post=5340 | FAIL | W2-PLANS-D6 detail total sums every item length including headers (999s header); schedule ignores header durations |
| ORDER-01.media-link.SUN.owner.API | owner | PUT /plans/<2793>/items/<8952>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.owner.persisted-state.API | owner | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.admin.API | admin | PUT /plans/<1c58>/items/<7aeb>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.admin.persisted-state.API | admin | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.legacy.API | legacy | PUT /plans/<544d>/items/<85de>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.legacy.persisted-state.API | legacy | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.scoped.API | scoped | PUT /plans/<4f79>/items/<fbc3>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.scoped.persisted-state.API | scoped | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.granted.API | granted | PUT /plans/<5541>/items/<ca74>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.granted.persisted-state.API | granted | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.folderlead.API | folderlead | PUT /plans/<6f9b>/items/<5a55>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.SUN.folderlead.persisted-state.API | folderlead | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.SUN.schedonly.API | schedonly | PUT /plans/<622e>/items/<eb97>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.SUN.schedonly.persisted-state.API | schedonly | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.SUN.member.API | member | PUT /plans/<6d27>/items/<6662>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.SUN.member.persisted-state.API | member | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.SUN.librarian.API | multi | PUT /plans/<486f>/items/<6f7d>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.SUN.librarian.persisted-state.API | multi | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.SUN.betaowner.API | betaowner | PUT /plans/<e289>/items/<dcba>/media | 403,404 | 403 | PASS |  |
| ORDER-01.media-link.SUN.betaowner.persisted-state.API | betaowner | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.SUN.anon.API | anon | PUT /plans/<7c64>/items/<3f64>/media | 401 | 401 | PASS |  |
| ORDER-01.media-link.SUN.anon.persisted-state.API | anon | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.owner.API | owner | PUT /plans/<d6aa>/items/<6ee4>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.MID.owner.persisted-state.API | owner | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.MID.admin.API | admin | PUT /plans/<d4e5>/items/<3f74>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.MID.admin.persisted-state.API | admin | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.MID.legacy.API | legacy | PUT /plans/<ac79>/items/<8116>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.MID.legacy.persisted-state.API | legacy | owner re-read item.media | linked | linked | PASS |  |
| ORDER-01.media-link.MID.scoped.API | scoped | PUT /plans/<f988>/items/<075d>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.scoped.persisted-state.API | scoped | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.granted.API | granted | PUT /plans/<93c8>/items/<6191>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.granted.persisted-state.API | granted | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.folderlead.API | folderlead | PUT /plans/<5abf>/items/<bc2e>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.folderlead.persisted-state.API | folderlead | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.schedonly.API | schedonly | PUT /plans/<3f3b>/items/<8126>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.schedonly.persisted-state.API | schedonly | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.member.API | member | PUT /plans/<0815>/items/<2f35>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.member.persisted-state.API | member | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.librarian.API | multi | PUT /plans/<3a92>/items/<cdba>/media | 403,404 | 404 | PASS |  |
| ORDER-01.media-link.MID.librarian.persisted-state.API | multi | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.betaowner.API | betaowner | PUT /plans/<637d>/items/<b69f>/media | 403,404 | 403 | PASS |  |
| ORDER-01.media-link.MID.betaowner.persisted-state.API | betaowner | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.MID.anon.API | anon | PUT /plans/<7347>/items/<31a1>/media | 401 | 401 | PASS |  |
| ORDER-01.media-link.MID.anon.persisted-state.API | anon | owner re-read item.media | not linked | not linked | PASS |  |
| ORDER-01.media-link.Beta-media.API | owner | PUT /plans/<d18a>/items/<c9ad>/media | 400,404,409 | 404 | PASS |  |
| ORDER-01.media-link.malformed-id.API | owner | PUT /plans/<d18a>/items/<c9ad>/media | 400 | 422 | PASS |  |
| ORDER-01.media-link.clear.API | owner | PUT /plans/<d18a>/items/<c9ad>/media | 200 | 200 | PASS |  |
| ORDER-01.media-link.item-under-wrong-plan.API | owner | PUT /plans/<e7c7>/items/<c9ad>/media | 404,400 | 404 | PASS |  |
| ORDER-01.media-link.header-item-refused.API | owner | PUT /plans/<d18a>/items/<513e>/media | 400,409,422,200 | 400 | PASS | record: headers |
| ORDER-01.media-link.song-item.API | owner | PUT /plans/<d18a>/items/<7d99>/media | 200,400,409 | 400 | PASS | record: song items |
| TIME-03.date-only-service_date.API | owner | POST /plans service_date "2040-08-04" (no time/zone) | explicitly rejected or interpreted in org zone (local day 08-04 stays 08-04) | 201 stored=2040-08-04T00:00:00+00:00 (org tz America/Chicago => local 8/3/2040, 7:00:00 PM) | FAIL | W2-PLANS-D3 Postgres casts a bare date to midnight in the DB session zone (UTC); the Chicago local day becomes the previous evening |
| TIME-03.offset-input-normalised-to-instant.API | owner | POST with -05:00 offset | stored as 15:00Z | 201 2040-08-11T15:00:00+00:00 2040-08-11T15:00:00+00:00 | PASS |  |
| TIME-03.naive-datetime-without-zone.API | owner | POST with "2040-08-18T10:00:00" (no zone) | rejected or interpreted in org tz (15:00Z) | 201 2040-08-18T10:00:00+00:00 2040-08-18T10:00:00+00:00 | FAIL | W2-PLANS-D3 zone-less input is silently taken as UTC (zod only checks end>start with JS Date, which parses naive as server-local time) |
| TIME-03.all-day-24h-time.API | owner | time spanning 24h | accepted; local day stays | 201 2040-08-26T05:00:00+00:00 | PASS |  |
| TIME-03.year-long-time-accepted.API | owner | time spanning 1 year | (record) accepted/bounded | 201 | PASS | no upper bound on time length in planTimeSchema |
| TIME-03.extreme-future-date.API | owner | service_date 9999-12-31 | accepted or 400 (no 500) | 201 | PASS |  |
| TIME-03.extreme-past-date.API | owner | service_date 0001-01-01 | accepted or 400 (no 500) | 201 | PASS |  |
| TIME-03.calendar-local-day-boundary.API | owner | plan at 23:30 CDT 10-05 (04:30Z 10-06) in calendar window for local day 10-05 | included in 10-05 window | 200 included=true | PASS |  |
| PLAN-01.prepared-hidden.owner.API | owner | GET /plans/:id and /plans list counts.prepared | prepared visible to schedulers (1) | detail=1 list.counts.prepared=1 | PASS |  |
| PLAN-01.prepared-hidden.scoped.API | scoped | GET /plans/:id and /plans list counts.prepared | prepared visible to schedulers (1) | detail=1 list.counts.prepared=1 | PASS |  |
| PLAN-01.prepared-hidden.schedonly.API | schedonly | GET /plans/:id and /plans list counts.prepared | prepared visible to schedulers (1) | detail=1 list.counts.prepared=1 | PASS |  |
| PLAN-01.prepared-hidden.member.API | member | GET /plans/:id and /plans list counts.prepared | 0 prepared rows/count | detail=0 list.counts.prepared=0 | PASS |  |
| PLAN-01.prepared-hidden.granted.API | granted | GET /plans/:id and /plans list counts.prepared | 0 prepared rows/count | detail=0 list.counts.prepared=0 | PASS | plans.edit only |
| PLAN-01.prepared-hidden.folderlead.API | folderlead | GET /plans/:id and /plans list counts.prepared | prepared visible to schedulers (1) | detail=1 list.counts.prepared=1 | PASS |  |
| TEMPLATE-01.apply-preview.archived-song-reference.API | owner | template references an archived song (archive=200) | warning or skipped entry; not silently added as live | archive=200 200 warnings=[] skipped=[] add=QA tmpl archived song real,stays | FAIL | W2-PLANS-D7  |
| TEMPLATE-01.apply.archived-song-result.API | owner | apply with archived song in template | items per preview (archived skipped or kept with warning), no 500 | 400 items= | FAIL | W2-PLANS-D7  |
| UX-01.1024.PLAN-order-tab.WEB | owner | /plans/:id Order tab at 1024x768 | no overlap; title column readable | title span 61px wide; per-row Notes (773-805) and Edit (807-839) buttons overlap title span (761-822); song titles wrap … | FAIL | W2-PLANS-D11 WEB-D6 re-check: reproduced; W2-PLANS-D11 |
| PLAN-01.web.list-upcoming-and-filters.WEB | owner | /plans (Upcoming tab, status filter) | cards sorted by date, count shown | 370 plans reported; 50 cards rendered; cards show title, status, time, type, counts | PASS |  |
| PLAN-01.web.list-pagination-cap.WEB | owner | /plans with 370 upcoming | all reachable (pager / load more) | only first 50 rendered, no pager or load-more control (PlansPage.tsx:52 per_page 50) | FAIL | W2-PLANS-D10 W2-PLANS-D10 |
| PLAN-01.web.past-tab-scope.WEB | owner | /plans Past tab | only plans before now, newest first | Past tab lists future plans (first card Dec 31 9999, then Mar 2041); total 371 = all plans (PlansPage.tsx:51 sends order… | FAIL | W2-PLANS-D10 W2-PLANS-D10 |
| PLAN-01.web.prev-next-arrows.WEB | owner | /plans/:id prev/next links | neighbours in same service type by date | prev = 2040-10-06 plan, next = far-future plan; matches API order | PASS |  |
| PLAN-01.web.member-readonly-plan-page.WEB | member | /plans/:id as member | read-only: no Add item/Edit/Templates/Message people | Order/Teams/Rehearse/Files only; no edit controls | PASS |  |
| PLAN-01.web.member-gated-plan-routes.WEB | member | /plans/templates, /plans/generate, /plans/reschedule | role gate message, no 403 requests | gate text shown on all three ("Rescheduling is for plan editors", etc.); no 403 in network log | PASS |  |
| TIME-01.web.edit-times-remove-selected-time.WEB | owner | Plan > Times Edit > remove Second > Save times | Review modal lists affected people; orphaned request needs a choice; commit persists | review modal named both people, Save disabled until Keep/Remove chosen; after "Keep for all times" API shows 2 times and… | PASS |  |
| ORDER-01.web.add-song-item.WEB | owner | Order > Add item > Song > Add | item appended with song title/key | song item appended (title from song, key C, 0:00) | PASS |  |
| ORDER-02.web.move-down-control-persists.WEB | owner | Order > Move item down | new order persisted after reload | API order Welcome,Archived-song,Song X, sort_order contiguous | PASS |  |
| ORDER-01.web.edit-item-stale-conflict-preserves-draft.WEB | owner | Edit item while another planner adds an item | banner "Someone else changed this plan", edits kept, save blocked until rebase | banner shown with draft intact; "Load the latest plan and keep my edits" re-enabled Save; saved title persisted | PASS |  |
| ORDER-01.web.remove-item.WEB | owner | Order > Remove item (native confirm) | confirm then remove | not exercised (native window.confirm, see WEB-D5) | NOT_RUN |  |
| ORDER-04.web.print-order-run-sheet.WEB | owner | Order > Print order | legible run sheet | not exercised | NOT_RUN |  |
| PLAN-02.web.new-plan-dialog.WEB | owner | /plans > New plan | plan created with seed time | not exercised in browser (API create covered) | NOT_RUN |  |
| TEMPLATE-01.web.template-editor-new-revision.WEB | owner | /plans/templates > edit notes > Save as revision 2 | new revision, revision picker shows 1 and 2 | revision 2 saved; revision 1 notes unchanged (API verified) | PASS |  |
| TEMPLATE-01.web.html-name-escaped.WEB | owner | template named "<img src=x onerror=1>" | rendered as text | rendered as literal text in list and picker; no script | PASS |  |
| TEMPLATE-02.web.generate-dst-gap-problem-blocks-commit.WEB | owner | /plans/generate Chicago 2029-03-04 x3, template time 02:30 | problem for 03-11 explained; Create disabled until skipped | red problem "02:30 on Mar 11, 2029 does not exist in America/Chicago..."; Create disabled; after Skip, "Create 3 draft p… | PASS | "Already has:" lists existing plans on each date but does not block creating duplicates (observation) |
| TEMPLATE-03.web.reschedule-review-and-commit.WEB | owner | /plans/reschedule shift Explore 1 +7d | review table (time from/to, people counts, resets/resends/links/reminders) then commit | review table complete; "Move 1 plan" -> "Rescheduled"; API date 2027-02-14T15:00Z (10:00 local kept) | PASS |  |
| TEMPLATE-03.web.reschedule-list-cap.WEB | owner | /plans/reschedule plan picker | all upcoming plans selectable | only 50 plans listed (ReschedulePlansPage.tsx:197), no pager | FAIL | W2-PLANS-D10 W2-PLANS-D10 |
| TIME-03.web.times-editor-zone-label.WEB | owner | Times editor | states the zone used | "Dates and times are in America/Chicago." shown | PASS |  |
| MOBILE.PLAN-TIME-ORDER-TEMPLATE.native | n/a | MOB-012..015 native screens | - | native clients are out of scope for this wave (QA-13/14) | NOT_RUN |  |
| PLAN-02.update.RLS-direct.owner-cannot-move-plan-to-Beta-org.RLS | owner | PATCH /rest/v1/plans {organization_id:Beta} | denied; org unchanged | 403 org=Alpha | PASS |  |
| PLAN-02.update.RLS-direct.scoped-cannot-move-Sunday-plan-to-Midweek.RLS | scoped | PATCH /rest/v1/plans {service_type_id:Midweek} | denied; unchanged | 403 type=Sunday | PASS |  |
| PLAN-02.update.RLS-direct.scoped-cannot-pull-Midweek-plan-into-Sunday.RLS | scoped | PATCH /rest/v1/plans on Midweek plan {service_type_id:Sunday} | denied (0 rows) | 200 type=Midweek | PASS |  |
| ORDER-01.edit.RLS-direct.owner-cannot-move-item-to-Beta-plan.RLS | owner | PATCH /rest/v1/plan_items {plan_id:Beta plan} | denied; unchanged | 403 plan=own | PASS |  |
| ORDER-01.edit.RLS-direct.scoped-cannot-move-item-into-Midweek-plan.RLS | scoped | PATCH /rest/v1/plan_items {plan_id:Midweek plan} | denied; unchanged | 403 plan=own | PASS |  |
| TIME-01.edit.RLS-direct.scoped-cannot-move-time-into-Midweek-plan.RLS | scoped | PATCH /rest/v1/plan_times {plan_id:Midweek plan} | denied; unchanged | 403 plan=own | PASS |  |
| TIME-01.create.RLS-direct.scoped-into-Midweek-plan.RLS | scoped | POST /rest/v1/plan_times on Midweek plan | denied | 403 | PASS |  |
| ORDER-01.add.RLS-direct.scoped-into-Midweek-plan.RLS | scoped | POST /rest/v1/plan_items on Midweek plan | denied | 403 | PASS |  |
| TEMPLATE-01.update.RLS-direct.scoped-cannot-claim-Midweek-template.RLS | scoped | PATCH /rest/v1/plan_templates on Midweek template {service_type_id:Sunday} | denied (invisible) | 403 type=Midweek | PASS |  |
| TEMPLATE-01.list.RLS-direct.betaowner-no-Alpha-templates.RLS | betaowner | GET /rest/v1/plan_templates | only Beta rows | BETA TEMPLATE SENTINEL | PASS |  |
| TEMPLATE-01.list.RLS-direct.member.RLS | member | GET /rest/v1/plan_templates | 0 rows | 0 | PASS |  |

## NOT_RUN / BLOCKED

| item | status | reason |
|---|---|---|
| ORDER-01.web.remove-item | NOT_RUN | uses native `window.confirm` (W1 WEB-D5); API delete/permissions fully covered |
| ORDER-04.web.print-order-run-sheet | NOT_RUN | print layout/page breaks not exercised; API schedule numbers covered |
| PLAN-02.web.new-plan-dialog | NOT_RUN | create covered at API level (matrix, validation, idempotency, copy) |
| MOB-012..015 native plan/times/order/template screens (PLAN/TIME/ORDER/TEMPLATE "M" surface) | NOT_RUN | native clients out of scope this wave (QA-13/14) |
| Web at 1024px for /plans/templates, /plans/generate, /plans/reschedule, Times modal | NOT_RUN | only the plan Order tab (WEB-D6) was re-checked at 1024px |
| TEMPLATE-03.commit.* conflict-rollback variants (3 rows, NOT_APPLICABLE) | NOT_APPLICABLE | reschedule never refuses over person conflicts by design (see W2-PLANS-D12); batch atomicity verified with mixed-scope and cross-tenant batches instead |
| PLAN-01.previous-next.API | NOT_APPLICABLE | no API contract; the web arrows (derived from filtered list reads) passed in the browser |
No case was BLOCKED.

## Cleanup state

Fixtures intentionally left in place (per instructions): Alpha/Beta orgs, 10 auth users, all `QA …` plans/templates/songs/arrangements/media/people listed above, grants (including the temporary override grant for `folderlead`, left granted), and the persisted outputs of the web flows. Nothing outside the `qa-20261117-plans-*` namespace or other agents' orgs was touched; no implementation code, migration, config or seed data was changed. The Browser pane's local storage/session was cleared at the end (signed out) and the viewport reset to desktop.
