# W8-PERF - PERF-01 at D17 volume (QA-15 subset) - wave 8 (2026-11-20)

- Package: W8-PERF (PERF-01, part of QA-15), `docs/plans/admin-mobile-test-plan.md` 2/3/4 (D17)/7/12.
- Commit: `897e524` (main + wave 7 fixes), branch `feature/qa-wave8`. No code, migration, config, index or git state changed.
- Env: local Supabase `service-center` (Postgres in Docker, PostgREST `max_rows = 1000` from `supabase/config.toml:8`), **private API instance on :4603** (`RESEND_API_KEY=` `EXPO_ACCESS_TOKEN=`, `tsx src/index.ts`, stopped at the end by PID), Node 26.13.1, macOS arm64 (18 cores, 64 GB), client = Node `fetch` on the same host (no network latency). Shared DB with five other agents: numbers may include their load (variation visible as occasional p95 spikes, e.g. chat thread p95 68 ms vs p50 17 ms).
- Method: setup only through service role/SQL; every measurement used the actor's own JWT (password grant, refreshed < 10 min) against :4603. Per endpoint: 1 first request ("cold" = first call to that route after harness start; API process and DB were already warm, so it is not a process cold start), then 35 sequential warm requests (concurrency 1) -> p50/p95 (nearest rank). A second run at concurrency 4 (40 requests) for 6 endpoints (table below). Payload = uncompressed bytes (`accept-encoding: identity`). Rate limiter untouched (own instance).
- Namespace: orgs `qa-w8-perf-a` (id `98eee20f-4e2c-4e35-838a-fd274360e8e8`, America/Chicago) and `qa-w8-perf-b` (`3ae2064a-d853-4ccd-8c0c-bfea7aae3c60`); users `<alias>.qaw8.perf@example.test` for owner, sched (scheduler), mem, mem2, ownerb, u01..u25. Passwords/tokens only in the session scratchpad.
- Dataset actually seeded (org A): **250 Persons** (29 with logins, 221 no-login; every 10th has hostile first name: script tag, Unicode/emoji, formula-like, quotes, whitespace; every 7th a 100-char last name; 120 tags), **125 songs** (250 arrangements; hostile titles incl. HTML and 190-char), **60 plans** (30 past, 30 upcoming weekly; 54 published/6 draft; 3 times each = 180; 15 items each = 900), service types 2, teams 3 x 10 positions, **1,799 assignments** (25/plan, ~1/11 prepared; `mem` 59 released, `u01` 304 released), **260 notifications each** for owner/mem/sched/u01 (+30 same-timestamp rows for mem), **130 operational messages** (41 recipients each, 5,330 recipient rows), **63 conversations / 615 chat messages** (one thread of 320 messages with 10 sharing each timestamp), **130 link files** on one plan. Org B: 110 plans + 110 conversations (to test the 100-row conversation cap); 1,100 temporary people used for D2 were deleted afterwards.
- Not exact D17: plans are 60 (not more than a page of history); "files > 1 page" was seeded but `/files` is not an owned endpoint, so it was not measured.

## Results

Status key: PASS = within paging/truncation/dup assertions; `PASS*` = row count reconciles with DB at this volume but the endpoint is unpaged/unbounded (see defects D2/D4/D5); the latency itself is not graded (budgets are proposed below). "Rows / count check" compares API row counts to `count(*)` in the DB and checks unique ids across pages.

| Case ID | Actor | Endpoint | Rows / count check | p50 ms | p95 ms | cold ms | payload | HTTP | Status |
|---|---|---|---|---|---|---|---|---|---|
| PERF-01.people.list.owner | owner | GET /people | no paging; all 250 returned (1000 cap, D2) | 40.8 | 67.5 | 60.1 | 84.5 KB | 200 | PASS* |
| PERF-01.people.list.archived.owner | owner | GET /people?include_archived=true | same | 39.8 | 43 | 40.8 | 84.5 KB | 200 | PASS* |
| PERF-01.people.list.scheduler(directory) | scheduler | GET /people | same | 19.4 | 21.3 | 28.2 | 76.8 KB | 200 | PASS* |
| PERF-01.people.search.global | owner | GET /search?q=Perf&limit=20 | limit<=20 per group; bounded | 32.8 | 33.8 | 32.3 | 15.0 KB | 200 | PASS |
| PERF-01.songs.p1 | owner | GET /songs?per_page=50&page=1 | walk 125/125 unique, total=125 (after fixture fix; D1 before) | 122.7 | 133 | 141.1 | 88.1 KB | 200 | PASS (D1) |
| PERF-01.songs.p3(past100) | owner | GET /songs?per_page=50&page=3 | page 3 of 50 = 25 rows | 114.1 | 129.3 | 118.3 | 42.2 KB | 200 | PASS |
| PERF-01.songs.per200 | owner | GET /songs?per_page=200&page=1 | 125 rows | 119.8 | 130.4 | 118.1 | 214.6 KB | 200 | PASS |
| PERF-01.songs.search | owner | GET /songs?q=Song&per_page=50 | 50 rows | 114.2 | 128.7 | 122.5 | 85.2 KB | 200 | PASS |
| PERF-01.songs.search.author | owner | GET /songs?author=Author%203&per_page=50 | 8 rows | 25.1 | 26.9 | 26.9 | 13.5 KB | 200 | PASS |
| PERF-01.songs.member | member | GET /songs?per_page=50&page=3 | 25 | 128.8 | 141.5 | 133.8 | 42.2 KB | 200 | PASS |
| PERF-01.plans.upcoming | owner | GET /plans?per_page=50&order=asc&from=2026-11-21T05%3A34%3A46.713Z | walk 60/60 unique asc+desc, total=60 | 72.5 | 79.7 | 95 | 156.6 KB | 200 | PASS |
| PERF-01.plans.history | owner | GET /plans?per_page=50&order=desc&to=2026-11-21T05%3A34%3A46.713Z | same | 78 | 97 | 77.3 | 156.6 KB | 200 | PASS |
| PERF-01.plans.page25 | owner | GET /plans?per_page=25&page=2&order=asc | same | 135.4 | 152.1 | 145.9 | 130.5 KB | 200 | PASS |
| PERF-01.plans.upcoming.member | member | GET /plans?per_page=50&order=asc&from=2026-11-21T05%3A34%3A46.713Z | 30 | 78.1 | 111.9 | 84.7 | 150.6 KB | 200 | PASS |
| PERF-01.plan.detail+order | owner | GET /plans/<id> | 15 items, 30 asg, 3 times | 40.3 | 44.1 | 49.9 | 71.7 KB | 200 | PASS |
| PERF-01.plan.schedule | owner | GET /plans/<id>/schedule | 2 service times | 38.8 | 48.8 | 84.3 | 3.4 KB | 200 | PASS |
| PERF-01.plan.detail.member | member | GET /plans/<id> | 15 items, 27 asg | 45.1 | 49.2 | 42.4 | 65.9 KB | 200 | PASS |
| PERF-01.matrix.1plan.p25 | owner | POST /staffing-matrix/query | people walk 250/250 unique (5 pages @50); assignments 360=DB (12 plans) | 30.9 | 45.6 | 40.7 | 23.8 KB | 200 | PASS |
| PERF-01.matrix.6plans.p25 | owner | POST /staffing-matrix/query | as above | 85.8 | 101.5 | 86 | 144.1 KB | 200 | PASS |
| PERF-01.matrix.12plans.p25 | owner | POST /staffing-matrix/query | as above | 124.5 | 150.9 | 124.7 | 254.3 KB | 200 | PASS |
| PERF-01.matrix.12plans.p50 | owner | POST /staffing-matrix/query | as above | 225.2 | 246.5 | 225.8 | 366.9 KB | 200 | PASS |
| PERF-01.matrix.12plans.p50.scheduler | scheduler | POST /staffing-matrix/query | as above | 231.6 | 250.9 | 221.5 | 366.9 KB | 200 | PASS |
| PERF-01.schedule.mine.mem(59) | member | GET /schedule/mine?include_past=true | 59/59 = DB released; unique | 61.2 | 66.3 | 68.8 | 122.8 KB | 200 | PASS* |
| PERF-01.schedule.mine.mem.upcoming | member | GET /schedule/mine | 29 = DB future | 37.2 | 40.8 | 40.1 | 60.3 KB | 200 | PASS* |
| PERF-01.schedule.mine.u01(304) | member u01 | GET /schedule/mine?include_past=true | 304/304 = DB released; unpaged, 648 KB | 241.4 | 308 | 250.4 | 633.3 KB | 200 | PASS* |
| PERF-01.notifications.feed.p1 | owner | GET /notifications?limit=30 | walk 260/260 unique (9 pages) | 11.6 | 13.4 | 11.5 | 13.8 KB | 200 | PASS |
| PERF-01.notifications.feed.limit100 | owner | GET /notifications?limit=100 | 100 | 11.1 | 12.7 | 12.3 | 46.3 KB | 200 | PASS |
| PERF-01.notifications.unread-count | owner | GET /notifications/unread-count | 174 = DB | 8.8 | 10 | 8.2 | 0.0 KB | 200 | PASS |
| PERF-01.notifications.unread-only | member | GET /notifications?limit=30&unread_only=true | walk mem 290/290 unique incl. 30 same-timestamp rows | 10.8 | 14 | 10.1 | 13.9 KB | 200 | PASS |
| PERF-01.notifications.unread-count.mem | member | GET /notifications/unread-count | 204 = DB | 8.4 | 9.3 | 7.5 | 0.0 KB | 200 | PASS |
| PERF-01.chat.list(63) | owner | GET /conversations | 63/63; hard LIMIT 100, no cursor | 20.6 | 23.2 | 19.7 | 19.2 KB | 200 | PASS |
| PERF-01.chat.thread.p1 | owner | GET /conversations/<id> | summary only | 17.2 | 68.5 | 17.9 | 14.9 KB | 200 | PASS |
| PERF-01.chat.thread.messages.p1 | owner | GET /conversations/<id>/messages?limit=30 | walk 320/320 unique, 11 pages, ties every 10 | 58.6 | 64.9 | 61.2 | 14.6 KB | 200 | PASS |
| PERF-01.chat.thread.messages.limit100 | owner | GET /conversations/<id>/messages?limit=100 | 100 | 64.8 | 91.1 | 63.9 | 48.4 KB | 200 | PASS |
| PERF-01.chat.thread.search | owner | GET /conversations/<id>/messages?q=hello&limit=30 | 30 | 59.2 | 66 | 64.8 | 14.6 KB | 200 | PASS |
| PERF-01.chat.list.member | member | GET /conversations | 38 visible | 38.1 | 41.1 | 38 | 11.8 KB | 200 | PASS |
| PERF-01.chat.list(110).orgB | ownerb (org B) | GET /conversations | 100 of 110 returned, no flag/cursor | 28.7 | 32.3 | 35.4 | 31.1 KB | 200 | FAIL (D3) |
| PERF-01.messages.sent | owner | GET /messages?box=sent&limit=30 | walk 130/130 unique (5 pages) | 7.2 | 8.4 | 7.7 | 17.2 KB | 200 | PASS |
| PERF-01.messages.sent.limit100 | owner | GET /messages?box=sent&limit=100 | 100 | 8.1 | 9 | 8 | 57.5 KB | 200 | PASS |
| PERF-01.messages.received.mem | member | GET /messages?box=received&limit=30 | walk 130/130 unique | 7.7 | 9.4 | 12.3 | 9.8 KB | 200 | PASS |
| PERF-01.report.participation.json | owner | GET /reports/participation?from=2026-05-05&to=2027-02-09 | 250 people/ 999 assignments = DB (window under 1000) | 65.1 | 72.6 | 61.9 | 79.0 KB | 200 | PASS* |
| PERF-01.report.participation.csv | owner | GET /reports/participation?format=csv&from=2026-05-05&to=2027-02-09 | CSV | 64.6 | 90.7 | 61.5 | 23.8 KB | 200 | PASS* |
| PERF-01.report.schedule.json | owner | GET /reports/schedule?from=2026-05-05&to=2027-02-09 | 999 = DB 999; wider window 1000 of 1138 truncated=false (D2b) | 65.6 | 73.7 | 73.5 | 339.8 KB | 200 | FAIL (D2b) |
| PERF-01.report.schedule.csv | owner | GET /reports/schedule?format=csv&from=2026-05-05&to=2027-02-09 | CSV same cap | 66.9 | 70.8 | 67.8 | 108.4 KB | 200 | FAIL (D2b) |
| PERF-01.report.schedule.scheduler | scheduler | GET /reports/schedule?from=2026-05-05&to=2027-02-09 | 999 | 64.5 | 69.6 | 64.8 | 339.8 KB | 200 | PASS* |
| PERF-01.calendar.org.400d | owner | GET /calendar?from=2026-05-05T05%3A34%3A46.713Z&to=2027-06-09T05%3A34%3A46.713Z | 171 = DB plan_times; no window cap (300y -> 200) | 174.9 | 195.2 | 173.3 | 51.1 KB | 200 | PASS* (D5) |
| PERF-01.calendar.mine | member | GET /calendar?mine=true&from=2026-05-05T05%3A34%3A46.713Z&to=2027-06-09T05%3A34%3A46.713Z | 159 | 196.2 | 215.2 | 188.6 | 52.6 KB | 200 | PASS* |
| PERF-01.combined-schedule.92d.mem | member | GET /me/combined-schedule?from=2026-11-21T05%3A34%3A46.713Z&to=2027-02-19T05%3A34%3A46.713Z | items reconciled | 24.8 | 27.2 | 26.9 | 6.0 KB | 200 | PASS |
| PERF-01.combined-schedule.92d.u01 | member u01 | GET /me/combined-schedule?from=2026-11-21T05%3A37%3A44.943Z&to=2027-02-19T05%3A37%3A44.944Z | 201 = DB (non-declined, 90d) | 129.1 | 138.7 | 145.7 | 48.7 KB | 200 | PASS |
| PERF-01.context.me(my_org_context) | owner | GET /me | 1 org | 3.6 | 4.7 | 4.7 | 1.9 KB | 200 | PASS |
| PERF-01.context.access-me(req.access) | owner | GET /access/me | 8 entries | 3.8 | 5.5 | 3 | 1.1 KB | 200 | PASS |
| PERF-01.context.me.mem | member | GET /me | 1 org | 3.4 | 4.3 | 4.3 | 1.0 KB | 200 | PASS |
| PERF-01.baseline.health-authed(orgs) | owner | GET /organizations | floor: auth+memberships | 3.1 | 4.7 | 3.4 | 0.5 KB | 200 | PASS |

Summary: 55 cases measured; FAIL 3 (chat list 110, schedule report JSON, schedule report CSV; root causes D2b and D3), PASS 52 (14 of them PASS* = unpaged). BLOCKED 0. Songs p1/per200 first returned 500 (D1, caused by the over-length fixture titles I seeded); after shortening those 5 titles the rows were re-measured and PASS.

### Round trips (client HTTP and DB trips, from reading the route code - not traced)

Client round trips = 1 per request except full list walks (songs 4 pages of 40, plans 3 of 25, notifications 9-10 of 30, chat thread 11 of 30, messages 5 of 30, matrix people 5 of 50). Server-side DB trips before route work: Auth `getUser` HTTP + memberships + `my_effective_access` (floor measured by `/organizations` at 3.1 ms p50, `/me` 3.6 ms). Route trips (sequential stages): songs 1 RPC; plans list 1 (count inline); plan detail 1 + 5 parallel; matrix 5 + ceil(people x plans / 200) **sequential** `check_assignment_conflicts` calls (3 for 12 plans x 50 people); `/schedule/mine` 2 + 2 parallel x ceil(ids/100) chunks (4 chunks for 304); `/calendar` 1 + 3 sequential (people, assignments, attendance); reports 3-5 with plan-id chunks; notifications/messages 1.

### Concurrency 4 (40 requests each, own instance)

| Endpoint | p50 ms | p95 ms | max |
|---|---|---|---|
| GET /songs?per_page=50&page=3 | 122.4 | 128.2 | 134.6 |
| GET /plans (upcoming, 50) | 83.5 | 92.7 | 93.2 |
| POST /staffing-matrix/query (12 plans, p25) | 140.8 | 166.9 | 171.7 |
| GET /schedule/mine (u01, 304) | 239.6 | 249.5 | 250.1 |
| GET /notifications?limit=30 | 11.8 | 12.8 | 13.1 |
| GET /conversations/:id/messages?limit=30 | 63.7 | 65.2 | 66.2 |

No degradation at 4 in flight (p95 within ~10% of sequential), so the cost is per-request CPU in Postgres, not queueing. Not tested above 4 by rule.

### Worst p95s (warm, ms)

schedule/mine u01 (304 rows) 308 (second run 242) - matrix 12 plans x 50 people 246-251 - calendar mine 215 / org 195 - plans page 2 x 25 152 - matrix 12 plans x 25 151 - songs (member) 141, songs owner 130-135 - plans history 97-112 - chat messages limit 100 91 (max 182).

## Paging, duplicate and truncation checks

| Check | Result |
|---|---|
| Songs walk 40/page | 125 rows, 125 unique, `total` 125 = DB; page past 100 (page 3 of 50) returns 25 |
| Plans walk 25/page asc and desc | 60/60 unique both directions, total 60 = DB; page 99 -> empty page with total (no error) |
| Notifications keyset walk 30/page (owner 260, mem 290 incl. 30 identical timestamps) | 260/260 and 290/290 unique, no skip; unread-count 174 and 204 = DB |
| Chat thread walk (320 msgs, 10 per timestamp) | 320/320 unique, 11 pages |
| Operational messages sent / received walk | 130/130 unique each (cursor built client-side from last row, `created_at~id`) |
| Matrix people cursor walk (12 plans, 50/page) | 250/250 unique, 5 pages; assignments 360 = DB for those 12 plans; 13+ plans -> 400 "Narrow the filters" (bounded by contract, not truncation) |
| `/schedule/mine` | u01 304 = DB released; mem 59 = DB; default (future) 153 and 29 = DB future; no chunk-boundary loss (the wave 7 chunking at 100 ids holds with 304) |
| `/calendar` | 171 = DB plan_times in window |
| Combined schedule (u01, 90 d) | 201 = DB assignments x attendance times, non-declined |
| Participation / schedule report, window <= 999 assignments | 250 people / 999 rows = DB |
| **Schedule/participation report, window with 1,138 assignments** | **1,000 rows, `truncated:false` - 138 rows silently dropped (D2b)** |
| **`GET /people` with 1,101 people (org B)** | **1,000 returned, no flag (D2)** |
| **`GET /conversations` with 110 conversations (org B)** | **100 returned, no flag/cursor (D3)** |

## EXPLAIN (ANALYZE, BUFFERS) - run as `role authenticated`, `request.jwt.claims` = caller

Slowest endpoints: (1) matrix, (2) `/schedule/mine` (heavy user), (3) calendar, (4) plans list page 2, (5) songs list. PostgREST plan output (`vnd.pgrst.plan`) is not enabled, so PostgREST's embedded queries were rebuilt as equivalent SQL; times from those are the DB part only.

| # | Endpoint | DB time (as authenticated) | Cost driver |
|---|---|---|---|
| 1 | Matrix `check_assignment_conflicts` (200 candidates = 74 ms; 600 cells = 3 sequential calls ~225 ms API) | 74 ms per 200 candidates | Function is SECURITY DEFINER (no RLS) but its inner `private.attendance_conflicts` runs a lateral visibility test `private.can_schedule_on_plan(...) or private.can_edit_plan(...)` **per conflict row** (117 rows ~ 160 ms under auto_explain instrumentation). The joins themselves are index/hash and take ~3 ms. Plus the route issues the RPC in 200-candidate chunks sequentially (`services/staffing-matrix.ts:177-180`) |
| 2 | `/schedule/mine` main query, u01 304 assignments | 156.6 ms (API p50 ~240 ms incl. 4 attendance chunks 27 ms each, response 648 KB) | RLS on embedded `plan_times` (912 rows x 0.115 ms = ~105 ms: `(SubPlan 4)` = `plan_times_write` FOR ALL policy `can_edit_plan(plan_id)` evaluated per row **before** the select policy `is_org_member(org_of_plan(plan_id))`), `team_positions` (304 x 0.118 ms = 36 ms, same pattern with `can_manage_team`). `assignments` itself is an index scan on `assignments_person_status_idx` (0.19 ms) |
| 3 | `/calendar` (171 events) | ~55 ms main query (rebuilt SQL); API 175 ms; PostgREST-direct 185 ms | `plan_times` FOR ALL policy `can_edit_plan` per row (171 x 0.196 ms = 33 ms) + per-plan-time embed of every assignment of the plan (171 x 30 rows, 485 KB from PostgREST, but only 77 KB without assignments with the same 182 ms, so the rest is PostgREST embed/RLS overhead). The route then runs 3 more sequential trips (`myStatusForTimes`) even when `mine=false` |
| 4 | `/plans?page=2&per_page=25` | 104 ms | `PLAN_SUMMARY_SELECT` embeds `plan_items` (750 rows x 0.108 ms = 81 ms of 104: `plan_items_write` FOR ALL -> `can_edit_plan` per row) and `plan_times`; the exact count is 0.3 ms. Items are embedded only to count song/non-song items (`id, item_type`) |
| 5 | `/songs` (`list_curated_songs`) | 125 ms with RLS vs **2.1 ms as postgres** for the same query (60x) | Per-song subqueries over `plan_items` (540 rows x 0.141 ms = 76 ms, FOR ALL `can_edit_plan` per row) and `arrangements` (250 rows x 0.114 ms) run for **every** song in the filter, then `row_number()` slices the page: cost is O(library), identical for page 1 of 10 or 200 rows (115-135 ms at all page sizes). `songs_organization_id_idx` is used; no missing index |

Common cause for 2-5: every table with a `*_write ... FOR ALL` policy (`plan_items`, `plan_times`, `team_positions`, `arrangements`, `songs`, ...) also applies that policy to SELECT, OR-ed with the select policy. The planner evaluates `(select can_edit_plan(row.plan_id))` once per row (it depends on the row, so it is not an InitPlan) at ~0.11-0.20 ms per call. This is RLS-function-per-row, not a missing index or seq scan. Raw EXPLAIN text: scratchpad `explain.out`, `explain3.out` (not part of the report).

## Proposed budgets (warm, local, server time incl. auth; D17 volume; ~2x current best, to be tightened in production)

| Endpoint class | Budget p95 | Current worst p95 | Notes |
|---|---|---|---|
| context (`/me`, `/access/me`, `/organizations`) | 20 ms | 5.5 | |
| notifications feed / unread count, messages list | 40 ms | 14 | |
| people search, plan detail, plan schedule, combined schedule (member) | 75 ms | 49 | |
| people directory (250) | 100 ms and **must page** at > 200 | 67 (owner) | |
| plans list (50), chat list, chat thread page, reports (JSON/CSV) | 150 ms | 152 (page 25) | |
| songs list (any page) | 100 ms (and not O(library)) | 141 | |
| matrix query (12 plans x 25 people) | 150 ms; 12 x 50 <= 200 ms | 151 / 251 | |
| `/schedule/mine` | 150 ms for 100 rows, **paged or windowed** above 100 | 308 (304 rows) | |
| calendar (<= 400 d) | 120 ms, window capped at 366 d | 215 | |
| any list | hard row cap documented and surfaced (`truncated`/cursor); no silent cap | 3 silent caps | |

Request-count budget: fixed pre-route cost <= 2 DB trips (now 3); matrix <= 2 sequential RPCs (run the conflict chunks in parallel or raise the chunk size); calendar <= 2 trips.

Suggested fixes (proposals only, nothing applied): split every `FOR ALL` write policy into INSERT/UPDATE/DELETE policies so SELECT evaluates only the select policy (or wrap `can_edit_plan` in a per-statement hashed set the way `assignments_select` does with `private.my_*_ids()`); make `list_curated_songs` compute `last_scheduled_at`/`arrangements` only for the page rows (select the page first, then enrich); drop item embedding from the plan list (return counts from a view/RPC); add keyset or `limit/page` to `/people`, `/conversations`, `/schedule/mine`; make report loaders page past `max_rows` or set `truncated` when a response hits it. No new index is indicated by the plans (all hot paths use an index scan).

## Defects

### W8-PERF-D1 (P2) - one over-length song title makes the library list 500 and leaks Zod internals
- Repro: as an org owner (or any `songs.manage` member) `POST /rest/v1/songs` with `title` of 250 characters via PostgREST with the user's own JWT -> 201 (API `POST /songs` correctly 422). Then `GET /songs?per_page=50&page=<page containing it>` -> 500 and the body is the raw Zod issue list (`"too_big"`, `"path":["data",10,"title"]`). Reproduced earlier with 5 seeded 223-char titles: pages 1 and 2 of any size, including `per_page=200`, were all 500.
- Expected: the DB rejects what the API schema rejects (or the list tolerates it); the error body carries no validation internals. Actual: the whole library page (up to every page) becomes unreadable, and rows on it are unreachable (no per-row isolation).
- Suspected source: `supabase/migrations` songs table has only `songs_title_check` (non-empty) with no length bound vs `packages/shared/src/schemas/song.ts:53` (`max(200)`); `backend/src/routes/songs.ts:42` parses the whole RPC payload with `curatedSongPageSchema` and the error handler returns the message. Fixture created by me was removed/shortened afterwards.

### W8-PERF-D2 (P1) - silent truncation at PostgREST `max_rows = 1000` in unpaged reads
- D2a: `GET /people` (owner and scheduler directory) has no paging (`backend/src/routes/people.ts:101-140`). Org B with 1,101 people: 200 OK with exactly 1,000 people, no flag, 318 KB. Expected: all rows or a cursor/flag. (At the specified 250-person D17 volume it is not triggered, 250/250.)
- D2b: schedule and participation reports. Window `-250..+100` days on org A (DB: 1,138 released assignments on published plans): `rows` = 1,000, `summary.assignments` 1000, `truncated:false`; participation `people` 237 instead of the true count. Expected `truncated:true` (the report contract has `truncated` and `REPORT_ROW_LIMIT = 2000`). Cause: the report's assignment query returns at most 1000 rows through PostgREST, so the 2000-row cap and the flag never trigger (`backend/src/services/reports.ts:124-143`, `packages/shared/src/lib/reports.ts:56`); CSV export is built from the same data and has no "Truncated" line. Window <= 999 assignments (the earlier -200..+80 window = exactly 999 = DB) was correct. This also affects the same pattern in `loadNeeds`/`loadRuns` and likely `/calendar`, `/schedule/mine`, combined-schedule RPC at > 1000 rows (not reproduced: needs > 1000 plan times / assignments for one user).
- Priority P1 per the package rule (silent truncation).

### W8-PERF-D3 (P1) - `GET /conversations` silently capped at 100
- Repro: org B owner with 110 plan conversations: `GET /conversations` -> 100 rows, no cursor or flag (`my_conversations` in `supabase/migrations/20261115000000_account_deletion_and_user_blocks.sql:~259` ends `limit 100`; the API wrapper `backend/src/services/discussions.ts:171`). Ten chats cannot be reached from the list. Org A (63) is complete. Expected: paging or a truncation signal.

### W8-PERF-D4 (P2) - RLS `FOR ALL` write policies evaluated on every SELECT (cost driver for songs, plans, calendar, schedule/mine, matrix)
- Evidence above (EXPLAIN 2-5): songs 125 ms vs 2 ms without RLS; `/schedule/mine` 156 ms DB for 304 assignments; plans page 104 ms. Latency scales linearly with rows and with plan items. Not a correctness bug; exceeds the proposed budgets for songs (141 p95), schedule/mine with > 150 assignments, plans page 2.
- Suspected source: `plan_items_write`, `plan_times_write`, `team_positions_write`, `arrangements_write`, `songs_write` (`supabase/migrations/20261017000000_f01_scoped_capabilities.sql:654-660` and earlier files) are `FOR ALL`.

### W8-PERF-D5 (P2) - unbounded or loosely bounded reads
- `/schedule/mine` has no paging: 304 rows = 648 KB, 241 ms (`backend/src/routes/assignments.ts:430-`); `include_past=true` returns everything ever.
- `/calendar` `from`/`to` are unvalidated strings (`packages/shared/src/schemas/plan.ts:200`): a 300-year window returned 200 OK, 180 events, 660 ms (garbage dates -> 400, fine). Combined schedule is correctly capped at 92 days; reports at 366 days; matrix at 12 plans.
- `/people` unpaged (see D2a), `/conversations` unpaged (D3).

### W8-PERF-D6 (P2) - matrix cost is sequential, not bounded by page cost
- Matrix p50 225 ms for 12 plans x 50 people because 600 cells are checked in 3 sequential `check_assignment_conflicts` calls (`backend/src/services/staffing-matrix.ts:177-180`). The documented page size maximum (50) is therefore the slowest allowed request, and the conflict check recomputes all cells on every people page.

No P0. No cross-tenant observation (org B counts never appeared in org A responses and vice versa).

## Not run

| Item | Reason |
|---|---|
| Native long charts, cold start, downloads on device | NOT_RUN: simulator owned by W8-NATIVE |
| Web render timing (Matrix, plans, songs, chat scroll, main-thread freeze) | NOT_RUN: browser owned by W8-WEB |
| True cold start of the API / Vercel function | NOT_RUN: only first-request-after-harness-start captured |
| Network latency/CDN effects | NOT_RUN: loopback only |
| Files list (>1 page) | not an owned endpoint; 130 files seeded and left |
| Production `pg_stat_statements` comparison | NOT_RUN: not available locally |
| Exact DB trip counts per request | estimated from source only (no query tracing) |
| Truncation at > 1000 rows for calendar, `/schedule/mine`, combined-schedule RPC | not reproduced; same mechanism as D2 (would need > 1000 plan times/assignments for one user) |
| Report export (queued) at > 2000 rows | not run (delivery worker owned by W8-INT) |
| Concurrency > 4 | per package rule |

## Coordinator notice and cleanup

- The shared API :4000 got a SIGTERM during this run. **I did not send it**: I only used `kill` once, at the end, on the PIDs recorded from `lsof -iTCP:4603` (my own tsx instance), and never used `pkill`/`killall`. :4000 answered 200 after the restart; :4603 is stopped (no listener).
- I ran a database-wide `ANALYZE` (setup step after seeding) on the shared DB; it refreshes planner statistics for all orgs and changes no data.

## Fixtures left in place

Orgs `qa-w8-perf-a` and `qa-w8-perf-b` with everything listed in the header (org A: 250 people, 125 songs/250 arrangements, 60 plans/180 times/900 items, ~1,800 assignments, 1,040+ notifications, 130 messages + 5,330 recipients, 63 conversations/615 chat messages, 130 link attachments, combined-schedule setting enabled for owner/mem/u01; org B: 110 plans/conversations); 30 auth users `*.qaw8.perf@example.test`. Five song titles were shortened from 223 to 190 characters to keep the library list readable (the original over-length titles are the D1 repro). The temporary 1,100 people in org B and the one 253-char song created for D1 were deleted. No tokens or passwords are stored in the repo. Cleanup (when the wave ends): delete both orgs (cascades) and the 30 auth users.
