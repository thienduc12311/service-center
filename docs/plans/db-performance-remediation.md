# Database Performance Remediation Plan

As of 2026-11-19. Living copy: [Database Performance Remediation Plan](https://claude.ai/artifact/GmktrZDpmubdGNs76uZ34F). Chat and My Schedule latency work, with tickets PERF-001–008: [request-latency-plan.md](request-latency-plan.md).

## Summary

Production data shows the database is fast: app queries average 0.4–42 ms, cache hit is 99.9%, and the largest table has 224 rows. The slowness most likely comes from latency between the API (Vercel, no region set, default Washington D.C.) and the database (Oregon), multiplied by 4–8 sequential round trips per request. PostgREST schema reloads, about half of all DB time, add stalls on a small instance.

The RLS design issues found in the code are real, and measurable: about 2.2 ms per assignment row plus about 32 ms of planning per query (see the EXPLAIN below). They become a problem as data grows, so Phase 1 follows straight after the latency fixes. The new first steps are: put the API next to the database, cut per-request round trips, and find what triggers the schema reloads.

## Findings

Six issues found in the code, ranked by expected impact. Production confirmation is in [Production inspection results](#production-inspection-results).

| # | Issue | Where | Impact |
| --- | --- | --- | --- |
| 1 | RLS helpers take a column argument, so `(select fn(col))` cannot be cached and runs per row. Each call is `security definer` and can't be inlined, and the calls nest 3–6 levels deep | `assignments_select` (`20261017000300_mob005_identity_times_snapshots.sql`), `people_select`, `people_directory` view, `plan_items`, `plan_times`, `songs`, `arrangements`, `teams` | Critical: roughly 10–15 subqueries per assignment row |
| 2 | Nested RLS: a child-table policy queries a parent RLS table, re-running its policy per child row | `assignment_time_responses_select` checks `exists (select 1 from public.assignments …)` | High: multiplies #1 on the plan page |
| 3 | 25 `FOR ALL` write policies also apply to SELECT and are OR-ed with the read policy | `songs`, `arrangements`, `plan_items`, `plan_times`, `people`, `team_memberships`, `team_positions`, and 18 more | High: extra capability check on every read row |
| 4 | Plan detail loads about 12 tables in one embedded select, each with RLS | `PLAN_DETAIL_SELECT` in `backend/src/services/plans.ts` | High: the most-used page pays for #1–#3 at once |
| 5 | Fixed per-request cost: `auth.getUser()` (Auth server round trip), memberships query, `my_effective_access` RPC | `backend/src/middleware/auth.ts`, `backend/src/middleware/organization.ts` | Medium: 3 round trips before any route work |
| 6 | Polling: live view every 2 s per viewer; chat every 10–30 s; `my_conversations` calls `has_blocked()` per message and ranks all org conversations before `limit 100` | `LIVE_ACTIVE_POLL_MS`, `CONVERSATION_*_POLL_MS`, `20261115000000_account_deletion_and_user_blocks.sql` | Medium: Sunday-morning load spikes |

Minor: `stillSchedulesAny` makes one RPC per item in a loop (`backend/src/services/delivery-dispatch.ts`), `/me` loads access once per organization, and there are about 157 `select('*')` calls. Indexes on the columns RLS checks are mostly in place.

## Plan

Phases run in order. Phase 0 set the baseline that every later phase is measured against. Each database phase is a new migration on a `feature/db-performance-*` branch; no old migration is edited.

**Revised after the production check:** Phase 0 is done (see [Production inspection results](#production-inspection-results)). A new Phase 0.5 now comes first, then Phases 1–3 follow, since EXPLAIN measured about 2.2 ms of RLS per assignment row.

### Phase 0.5: Latency and schema reloads (urgent)

- Set the backend function region to match the database: `"regions": ["pdx1"]` in `backend/vercel.json` (or the Vercel project setting).
- Move Phase 4's `getClaims()` change and the single memberships-plus-access RPC here, cutting 2 of the 3 fixed round trips per request.
- Find what triggers PostgREST schema reloads (74 so far) and stop the avoidable ones.
- Acceptance: API p95 for the plan page under 300 ms, measured from the browser.

### Phase 0: Measure (done)

- Capture top 20 queries by total time from `pg_stat_statements`, the cache hit rate, and the CPU graph for a normal week and a Sunday.
- Run `EXPLAIN (ANALYZE, BUFFERS)` as the `authenticated` role (with `request.jwt.claims` set) for the plan detail, assignments list, people directory and conversation list.
- Acceptance: a baseline table of p50/p95 time and calls for those four queries.

### Phase 1: Resolve access once per query (fixes #1)

- Add `private` set-returning helpers with no row arguments, for example `my_active_org_ids()`, `my_plan_ids_with(cap)` and `my_team_ids_visible()`. Each is `stable security definer`, keyed on `(select auth.uid())`.
- Rewrite hot SELECT policies to `organization_id in (select private.my_active_org_ids())` / `plan_id in (select …)`, so Postgres runs the helper once as an InitPlan and hash-joins it.
- Order: `assignments`, `people` + `people_directory`, `plan_items`, `plan_times`, `songs`, `arrangements`, `teams`.
- Acceptance: EXPLAIN shows a hashed SubPlan/InitPlan instead of per-row function calls; plan detail p95 down by at least 5×.

### Phase 2: Split FOR ALL policies (fixes #3)

- Replace each of the 25 `FOR ALL` policies with separate `insert`, `update`, `delete` policies carrying the same expressions, so reads see only the SELECT policy.
- Acceptance: no `FOR ALL` policy left on a table with its own SELECT policy; all RLS tests pass.

### Phase 3: Remove nested RLS (fixes #2)

- Rewrite child policies such as `assignment_time_responses_select` to call the same set helper as the parent (`assignment_id in (select private.my_visible_assignment_ids())`) instead of querying `assignments` under RLS.
- Acceptance: plan detail EXPLAIN has no repeated assignments policy subplans.

### Phase 4: Backend request overhead (fixes #4, #5)

- Verify JWTs locally with `supabase.auth.getClaims()` (asymmetric signing keys) instead of `getUser()`.
- Load memberships and effective access in one RPC; cache per request.
- Consider splitting `PLAN_DETAIL_SELECT` so rarely shown pieces (time responses, attendance) load on demand.
- Batch `stillSchedulesAny` into one RPC that takes an id array.
- Acceptance: one fewer Auth round trip per request; middleware time under 30 ms p95.

### Phase 5: Polling and conversations (fixes #6)

- Move the live view to Supabase Realtime broadcast, or raise active polling from 2 s to 5 s and add a `since` version check that returns 304 when nothing changed.
- Rewrite `my_conversations` to load the caller's blocked user ids once, filter accessible conversations with a set helper, then aggregate only those.
- Acceptance: request rate during a live service drops by at least 50%; `my_conversations` p95 under 100 ms.

After Phase 2, compare against the Phase 0 baseline before deciding on a compute upgrade.

## Production inspection results

Production says the database is not where the time goes: app queries run in 0.4–42 ms on average, and total database time in the stats window is only about 124 seconds. The slowness users feel most likely comes from network round trips between the API and the database, plus PostgREST schema reloads on a small instance.

Source: `pg_stat_statements` from the Supabase SQL editor. The stats window was not recorded.

| Query | Calls | Mean | Max | Share of DB time |
| --- | --- | --- | --- | --- |
| `pg_timezone_names` (PostgREST schema cache load) | 74 | 452 ms | 4,050 ms | 26.9% |
| PostgREST schema introspection (`base_types`, keys, functions) | 74 / 48 / 26 | 104–192 ms | 804 ms | about 20% |
| `assignment_attendance_for` RPC | 116 | 38.6 ms | 113 ms | 3.6% |
| `list_curated_songs` RPC | 74 | 41.4 ms | 180 ms | 2.5% |
| Teams with positions + memberships | 150 | 20.7 ms | 92 ms | 2.5% |
| Plan detail (`PLAN_DETAIL_SELECT`) | 101 | 10.9 ms | 86 ms | 0.9% |
| `my_effective_access` RPC (every request) | 2,542 | 1.8 ms | 43 ms | 3.6% |
| `organization_members` lookup (every request) | 1,983 | 0.4 ms | 21 ms | 0.7% |

What this shows:

- **Roughly half of all DB time is PostgREST and tooling introspection, not your app.** The schema cache reloaded 74 times. Each reload walks 583 functions and 308 policies; `pg_timezone_names` alone took up to 4 s. Requests arriving during a reload wait for it.
- **The RLS issues are real and measurable, though not yet the largest cost.** The plan page averages 10.9 ms. That cost grows with data, and the EXPLAIN below shows how fast it grows per row.
- **Auth cost per request is cheap in the DB but costly in round trips.** About 3,500 `getUser()` calls each ran 5 auth queries (sessions, MFA, identities, users) at under 0.2 ms each. The time is in the extra HTTP hop to the Auth server.
- **Latency is the likely culprit.** The database is in AWS `us-west-2` (Oregon). The backend is a Vercel function whose `vercel.json` sets no region, and Vercel defaults to `iad1` (Washington, D.C.), about 60–70 ms away. A typical request makes 4–8 sequential trips (Auth, memberships, access, then the route's queries), which adds 300–600 ms before any query cost, plus cold starts.

Memory, data size and connections rule out the database too. Cache hit is 99.94% for tables and 99.57% for indexes. The largest tables hold 224 rows (`attendance_calendar_states`), 86 (`assignments`) and 21 (`plans`), all under 300 kB. About 17 connections were open with 1 active, so there is no pool pressure. Sequential scans on `organization_members` (27,807) are expected at 12 rows: Postgres reads a one-page table faster than an index.

**EXPLAIN as a real user (assignments for one plan, 8 rows):**

| Part | Time | Buffers | Note |
| --- | --- | --- | --- |
| Planning | 31.7 ms | 693 | RLS expands into about 85 subplans the planner must build |
| `can_see_released_assignment` (SubPlan 86) | 2.24 ms × 7 rows = 15.7 ms | 600 | Runs once per row, about 86 page reads each |
| `has_capability(people.view_private)` (SubPlan 81) | 4.75 ms, once | 742 | Inside the `people` policy, reached via the assignments policy |
| Execution total | 33.2 ms | 1,364 | For 8 rows: about 170 page reads per row returned |

This confirms the RLS finding with a number: about 2.2 ms per assignment row plus about 32 ms of planning per statement. At 8 rows it costs about 65 ms; at 100 rows (a busy month or the schedule matrix) it would be about 250 ms for this one table, before the other tables the plan page loads. A per-row check should cost microseconds, not milliseconds.

Verdict: not primarily a CPU limit and not primarily query design. Fix the API's distance to the database first, then the schema reloads; revisit compute only if reloads stay slow.

To confirm:

- [ ] Check the backend's function region in Vercel (Project → Settings → Functions). If it is not `pdx1` / us-west, that is the top fix.
- [ ] Find what triggers 74 schema reloads (deploys, `db push`, PostgREST restarts from memory pressure) in Logs → PostgREST.
- [ ] Record the compute size and the CPU and memory graph for a slow period.

## Rollout, testing and risks

The main risk is an RLS rewrite that silently widens or narrows access, so every policy change ships with access tests before it ships for speed.

- **Access regression tests:** for each rewritten table, test that an owner, admin, scoped scheduler, team member, released assignee, other-org member and anonymous user see exactly the rows they saw before. Run against `npm run db:reset` locally.
- **Same semantics:** each set helper must encode the same rules as the per-row helper it replaces (folder hierarchy, team-related visibility, `assignment_visibility = 'organization'`, owner-only `people.*`). Keep the old helpers until all callers move.
- **Migration safety:** policy swaps run `drop policy` + `create policy` in one transaction, so there is no window without a policy. No table or column is dropped.
- **Verify:** after each phase, re-run the Phase 0 queries and compare p95 and total time to the baseline.
- **Rollback:** each phase is one migration; reverting means a new migration that restores the previous policy text.
- **Open question:** which Supabase compute size is production on? It decides whether a temporary upgrade is worth it while Phases 1–3 land.
