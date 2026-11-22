# Scalability review: Service Center architecture, growth tiers and hosting

- **Date:** 2026-11-22
- **Code baseline:** `f79aa50` (HEAD of `thienduc12311/feature-planning-center-feature`, equal to `main` after PR #129). File and line references are at this commit.
- **Scope:** database (schema, RLS, indexes, retention, connections), API and hosting, background delivery, Realtime and client caching, multi-tenancy, codebase structure, observability. Also a hosting and cost comparison (Vercel vs AWS options), added at the user's request. Hosting is treated as an open question throughout.
- **Builds on:** [db-performance-remediation.md](../plans/db-performance-remediation.md) (production evidence, 2026-11-19), [request-latency-plan.md](../plans/request-latency-plan.md) (PERF-001–008), [large-list-ux-review.md](../plans/large-list-ux-review.md) (2026-11-21 sizing), [delivery-worker.md](../operations/delivery-worker.md), ADR-0004/0006/0007, and the feature plan in [planning-center-service-planners-comparison.md](planning-center-service-planners-comparison.md#suggested-plan).
- **Caveats:**
  - No production access in this run. Production numbers are labelled "from db-performance-remediation.md". Every other number is an **estimate** with its assumptions stated.
  - The app was not run and no database was started. Policy and function shapes come from a static parse of the 123 migrations, which takes the last `create`/`alter`/`drop` of each policy in file order. Policies created through dynamic SQL in `DO` blocks (for example `plans_select`, `songs_select`) were read by hand. Counts from the parser are approximate (±10%).
  - Prices were read from official pricing pages on 2026-11-22 and **change often**. Several AWS pages only show US East (N. Virginia) example rates. They are used here for US West (Oregon), the region the Supabase project is in, and are marked where that is an assumption. Confirm them in the AWS Pricing Calculator before you commit to anything.
  - Source IDs `[S#]` point to the [source register](#8-source-register). Section 5 (hosting and cost) was added at the user's request, so the principles, roadmap and source register are sections 6–8.

---

## 2. Summary

**What scales well already**

- **Tenant isolation.** RLS enforces it, and routes add explicit `organization_id` filters: there are 231 `.eq('organization_id', …)` calls across routes and services. Supabase's own guidance is "Do not rely on RLS for filtering but only for security" [S2]. Client caches are namespaced per org (`frontend/src/hooks/queries.ts:40-41`).
- **The API never holds Postgres connections.** Every query goes through PostgREST over HTTPS (`backend/src/lib/supabase.ts:34-49`). Serverless fan-out therefore can't exhaust connections. The limit is PostgREST's own pool and the compute size [S3][S5].
- **The outbox design is sound.** It uses `FOR UPDATE SKIP LOCKED`, partial due/lease indexes (`20261016000200_delivery_outbox_and_atomic_copy.sql:116-117, 532-589`), and idempotent effects. Since PERF-008, chat and LIVE refresh on Realtime pokes instead of 2–10 s polling.

**What breaks first, and at which tier**

1. **Background delivery. It is broken at tier 1 today and the bottleneck from tier 50.**
   - No worker schedule runs in production (`docs/plans/email-notifications.md:28,53-55`), so reminders, scheduled releases and retries never fire.
   - Publish, release, matrix commit, template apply and operational messages all send their whole fan-out *inside the HTTP request* (`backend/src/routes/plans.ts:227`, `staffing-matrix.ts:46`, `services/messages.ts:97`, `releases.ts:139`, `plan-templates.ts:466`).
   - One worker run claims at most 50–100 deliveries and works them 4 at a time (`delivery-worker.ts:15-17`, `schemas/delivery.ts:38`). Each delivery costs about 8–10 sequential DB calls plus a provider call.
   - Every church shares Resend's team-wide limit of 10 requests per second [S18].
   - Expected effects: multi-second publishes at tier 50, 429 storms when churches publish at the same time, and reminders hours late at tier 500.
2. **Per-row RLS on list and detail reads. Noticeable at tier 50 for large churches, a CPU problem at tier 500.**
   - Of the database plan, only the assignments path has moved to set-based helpers so far (`20261122000200_perf_assignment_access.sql`).
   - About 160 policy calls still pass a row column into a helper such as `has_capability` or `is_org_member`, which then runs once per row.
   - 19 `FOR ALL` write policies are still OR-ed into reads.
   - `plans_select`, `songs_select`, `teams_select` and `plan_items_select` still call `is_org_member(…)` per row without a wrapper (`20260101000100_rls.sql:122-131,158-159`).
   - Production measured about 2.2 ms per assignment row plus about 32 ms of planning (from db-performance-remediation.md).
3. **Tables that grow forever. Disk, vacuum and index bloat at tier 500, and partitioning or archiving needed before tier 5,000.**
   - `deliveries`, `delivery_attempts`, `delivery_effects`, `reminder_jobs`, history and audit tables, and the `*_operations` idempotency tables have no retention.
   - Only notifications, opted-in chat retention, webhook history and expired uploads are pruned.
   - At 500 churches with 3 years of history, the outbox alone is an estimated 100M+ rows.

**Other limits to know about**

- **Supabase Realtime.**
  - Pro with the spend cap on is limited to **500 concurrent connections and 500 channel joins per second** [S6].
  - Opening the chat list subscribes up to 90 topics per client (`packages/shared/src/lib/realtime-pokes.ts:8`), so a handful of people opening chat at the same moment can hit the join limit.
  - This bites from tier 50–500. The fix is "Pro, no spend cap" and fewer topics per client.
- **Rate limiting is in-memory and per IP** (`backend/src/app.ts:129-136`).
  - On Vercel or Lambda each instance counts separately, so the limit is not enforced globally.
  - Keying by IP also penalises a whole church on one Sunday-morning NAT address, at 300 requests per minute per instance.
  - This is a hosting-specific finding (see §4.3).
- **Silent caps.**
  - PostgREST `max_rows = 1000` (`supabase/config.toml:8`) truncates any unpaged query without saying so.
  - The `authenticated` statement timeout is 8 s [S7], and only one RPC sets its own (`20261101000300_f15_song_merge.sql:162`).
  - Heavy single-transaction RPCs (template apply, copy with quantity, staffing matrix commit, `materialize_due_reminders`) will hit the 8 s timeout as churches grow.
- **Observability is the gap to close before tier 50.**
  - Logs are `morgan` plus `console.*`. There are no request IDs, no `Server-Timing`, no error tracking on backend, web or mobile, and no queue-depth metrics.
  - The PERF-001 baseline measurements still haven't been taken.

**Hosting.** Vercel Pro is the cheapest and simplest option through tier 50, about $120 a month for the full stack.

- Around tier 500, move the API and worker to **ECS Fargate (Arm) + ALB in us-west-2, using public subnets and no NAT gateway**, and move email to **Amazon SES**.
- At tier 500 that stack costs about $575 a month against about $905 on Vercel + Resend. At tier 5,000 it costs about $5,000 against about $8,200.
- Lambda is a poor fit for this I/O-bound Express app: you pay for wall-clock time while it waits on Supabase, `waitUntil` doesn't exist there, API Gateway caps requests at 30 s, and the rate limiter would be per environment.
- See [§5](#5-hosting-options-and-cost).

---

## 3. Growth model

### 3.1 Tiers and per-church assumptions

Per-church size comes from the large-list review: 100–300 songs, 200–500 people, 20–40 teams, 2–4 services a week. Midpoints are used here.

| Per church, per year (estimate) | Rows | Basis |
|---|---|---|
| plans | 150 | 3 services/week |
| plan_times | 400 | ~2.7 times per plan (service + rehearsal) |
| plan_items | 2,500 | ~17 items per plan |
| assignments | 3,750 | ~25 filled positions per plan |
| assignment_time_responses + attendance_calendar_states | 10,000 | Production ratio of 224 states to 86 assignments ≈ 2.6× (from db-performance-remediation.md) |
| assignment_responses / history | 5,500 | ~1.5 answers per assignment |
| reminder_jobs | 15,000 | ~2 reminders × 2 channels per assignment |
| delivery_effects | 11,000 | requests, reminders, responses, mentions, messages |
| deliveries | 30,000 | ~2.7 channels per effect (in-app, push, email) |
| delivery_attempts | 25,000 | most deliveries take one attempt |
| notifications (kept 90 days read / 180 unread) | ~7,000 retained | `notification_retention.sql:16-35` |
| conversation_messages | 20,000 | 30 team/plan chats, ~13 messages per week |
| live_run_transitions | 7,500 | ~50 per service |
| attendance_events | 4,000 | ~1 per assignment |
| Static: people 500, org members 300, songs 300, arrangements 600, team memberships 1,000 | — | Large-list sizing |

Active users: about 150 of 500 people use the app in a month (30%). About 8 planners or admins use it heavily.

### 3.2 Rows at each tier after 3 years of history (estimate)

| Table | Tier 1 (today's shape) | Tier 50 | Tier 500 | Tier 5,000 |
|---|---|---|---|---|
| deliveries | 90 k | 4.5 M | 45 M | **450 M** |
| delivery_attempts | 75 k | 3.8 M | 38 M | **375 M** |
| reminder_jobs | 45 k | 2.3 M | 23 M | **225 M** |
| delivery_effects | 33 k | 1.7 M | 17 M | 165 M |
| conversation_messages (no org retention set) | 60 k | 3 M | 30 M | **300 M** |
| time responses + calendar states | 30 k | 1.5 M | 15 M | 150 M |
| assignments | 11 k | 560 k | 5.6 M | 56 M |
| assignment_responses / history | 17 k | 830 k | 8.3 M | 83 M |
| plan_items | 7.5 k | 375 k | 3.8 M | 38 M |
| live_run_transitions | 22 k | 1.1 M | 11 M | 110 M |
| notifications (retention on) | 7 k | 350 k | 3.5 M | 35 M |
| people | 500 | 25 k | 250 k | 2.5 M |
| **Database size (estimate, 0.5–1 KB/row incl. indexes)** | < 0.5 GB | 10–20 GB | 100–200 GB (50–80 GB with outbox retention) | 1–2 TB (250–500 GB with retention) |

What this means:

- Per-request cost depends on **rows returned per request**, not on table size, as long as every query filters by org through an index. That holds for most of the code (§4.2).
- Table size drives **disk, vacuum, backup/PITR, index RAM and compute tier**.
- PostgreSQL's rule of thumb is that partitioning pays off once a table is larger than the server's memory [S12]. The outbox and messages reach that size between tier 500 and tier 5,000.

### 3.3 Request volume (used for hosting costs)

Per church per month, estimated at about **100 k API requests**:

- Volunteers: 150 × ~40 requests/week ≈ 26 k.
- Planners: 8 × ~2,000/week ≈ 69 k. This includes the 60 s unread-count poll while a tab is open (`queries.ts:990-1000`, `mobile/src/providers/NotificationsProvider.tsx:62`).
- Calendar feeds: ~60 subscribers × 6 polls/day ≈ 11 k.
- Worker: 1 run per minute, about 43 k per month for the whole platform.

| Tier | Requests/month | Average req/s | Sunday-morning peak (5–10× average) |
|---|---|---|---|
| 1 | 0.1 M | < 0.1 | ~1 |
| 50 | 5 M | 2 | 10–20 |
| 500 | 50 M | 19 | 100–200 |
| 5,000 | 500 M | 190 | 1,000–2,000 |

---

## 4. Findings by area

Each finding gives evidence, the tier where it bites, the impact and the fix. **[Host]** marks a finding that depends on hosting, with how it changes on AWS.

### 4.1 What has shipped since 2026-11-19 (from `git log`)

| Item | Status at f79aa50 | Evidence |
|---|---|---|
| PERF-002 region pin | Shipped. `"regions": ["pdx1"]` | `backend/vercel.json:6` |
| PERF-003/004 one conversation summary, parallel lookups | Shipped | `20261122000000_perf_chat_conversation_summary.sql` |
| PERF-006 one org-context call | Shipped. Middleware makes one RPC | `middleware/organization.ts:72-74`, `20261122000100_perf_org_context.sql` |
| PERF-007 set-based assignment access | Shipped, **assignments only** | `20261122000200_perf_assignment_access.sql:5-77` |
| PERF-008 Realtime pokes, 60 s fallback poll | Shipped | `20261122000300_perf_realtime_pokes.sql`, `packages/shared/src/lib/realtime-pokes.ts:5` |
| Notification access once per statement, conversation keyset paging, large-list server search | Shipped | `20261126000002_…`, `20261127000100_w8_conversations_keyset.sql`, `20261129000000_large_list_search.sql` |
| PERF-005 local JWT verification | **Deferred on purpose**. `getUser` still runs on every request | `middleware/auth.ts:57-69` |
| PERF-001 baseline (cold-start share, p50/p95) | **Not recorded** | `request-latency-plan.md:69-75` |
| DB plan Phase 1 (other tables), Phase 2 (FOR ALL split), Phase 3 (nested RLS) | **Not started** beyond assignments | Static parse, §4.2 |
| Production worker schedule (N1) | **Not configured** | `email-notifications.md:28,53-55` |

Fixed cost per request today: one Auth HTTP round trip plus one `my_org_context` RPC, then the route's own queries.

### 4.2 Database

**D1. Per-row RLS helpers on the hot tables.** *Bites at: tier 50 for large churches, tier 500 for CPU.*

- **Evidence.** The final policies call row-argument helpers about 160 times:

  | Helper | Policies | Tables |
  |---|---|---|
  | `has_capability(organization_id, …)` | 43 | 15 |
  | `is_org_admin` | 38 | 24 |
  | `is_org_member` | 32 | 25 |
  | `can_schedule_on_plan` | 14 | 7 |
  | `can_edit_plan` | 9 | 5 |

  About 108 of these calls are wrapped in `(select …)`. Because the argument is a row column, the wrapper doesn't create an InitPlan; it becomes a correlated SubPlan that runs once per row. Supabase's docs say the wrapper only helps "if the results of the query or function do not change based on the row data" [S1][S2].
- **The unwrapped originals are on the busiest reads:**
  - `plans`, `songs`, `teams`, `service_types` and `attachments` use `is_org_member(organization_id)` (`20260101000100_rls.sql:122-131`).
  - `plan_items_select` uses `is_org_member(org_of_plan(plan_id))`, two nested security-definer calls per row (`rls.sql:158`).
  - `members_select` (`rls.sql:108`) has a bare `auth.uid()` and no `to authenticated`.
- **What each call costs.** `has_capability` → `private.capability_for` runs up to three `EXISTS` subqueries, including a folder-path walk (`20261109000000_owner_people_permissions.sql:3-47`). All helpers are correctly `stable security definer` with `search_path = ''` (`f01_scoped_capabilities.sql:235-248`). The cost is the per-row evaluation itself.
- **Impact.** About 2.2 ms per row on assignments was measured before PERF-007 (from db-performance-remediation.md). Lists of 300 songs or 500 people, the plan page's roughly 12 embedded tables (`services/plans.ts:34-60`), reports (up to 2,000 rows, `packages/shared/src/lib/reports.ts:56-58`) and the staffing matrix all multiply it.
- **Fix.** DB plan Phase 1: `private.my_org_ids()`, `my_plan_ids_with(cap)`, `my_team_ids_visible()` and so on, used as `organization_id in (select private.my_org_ids())`. Add `to authenticated` to every policy [S2]. Follow the pattern PERF-007 already proved.

**D2. `FOR ALL` write policies are evaluated on SELECT.** *Bites at: tier 500.*

- **Evidence.** The parser finds 19 tables with both a `FOR ALL` policy and a SELECT policy. Among them: `people`, `plan_items`, `plan_times`, `arrangements`, `songbooks`, `team_positions`, `person_tags` and `storage.objects` (for example `f01_scoped_capabilities.sql:654,660,803,828`). Postgres ORs every permissive policy for a command, so reads also pay `has_capability(…, 'people.manage')` and `can_edit_plan(plan_id)` per row.
- **Fix.** DB plan Phase 2: split each into insert, update and delete policies. Do this **before N3** (order editor speed pack), which writes `plan_items` and `plan_times` heavily.

**D3. Nested RLS inside policies.** *Bites at: tier 500.*

- **Evidence.** 40 policies contain `exists (select … from public.<RLS table>)`, mostly against `people` (12) and `assignments` (7). For example, `deliveries_select_scheduler` joins `delivery_effects` to `assignments` with `can_schedule_on_plan(...)` per row (`20261024000000_f08_release_and_reminders.sql:1385`).
- **Fix.** DB plan Phase 3: use set helpers instead of policy subqueries.

**D4. Missing indexes.** *Bites at: tier 500, through cascades and the admin and history views.*

- **Evidence.** A static scan found about 25 real foreign-key columns with no leading index (about 33 flagged, minus false positives). Examples:
  - `assignment_time_response_history.organization_id` and `.plan_time_id`
  - `assignment_request_snapshots.organization_id` and `.plan_id`
  - `notifications.organization_id` (the inbox index leads with `user_id`)
  - `reminder_policies.organization_id`
  - `team_rotation_exceptions.rotation_id`
  - `scheduling_preferences.person_id`
  - several `created_by` / `actor_id` columns pointing at `auth.users`, which are scanned when an account is deleted
- **Fix.** Run the skill's `pg_constraint` query (`.agents/skills/supabase-postgres-best-practices/references/schema-foreign-key-indexes.md`) against a local reset. Index the columns that RLS, filters or cascades use. Skip write-only audit columns.

**D5. Unbounded reads and silent caps.** *Bites at: tier 50.*

- **Evidence.**
  - PostgREST `max_rows = 1000` (`supabase/config.toml:8`; the production setting is unverified) silently truncates any unpaged list.
  - Most browse lists are paged since the large-list work.
  - Remaining open-ended reads include the song-usage query over all of an org's plans (`services/songs.ts:159-164`) and a person's calendar feed, which has no upper date bound (`routes/calendar-feed.ts:73`).
  - Old W9 fixes chunk `.in()` lists that keep growing (`lib/chunk.ts`).
- **Fix.** Every list endpoint takes `limit` plus a keyset cursor (`lib/keyset.ts`, `lib/paging.ts` exist), returns `has_more`, and is bounded by date where history grows.

**D6. Tables that grow forever.** *Bites at: tier 500 (disk, vacuum, PITR cost), tier 5,000 (needs partitioning).*

- **Has retention:**
  - `prune_notifications`, run by the worker, up to 1,000 rows per run (`20261124000000_notification_retention.sql:16-35`)
  - `purge_expired_conversation_messages`, only for orgs that set a limit (`f09_conversations.sql:564`)
  - `prune_webhook_history` (`f17_developer_api.sql:912`)
  - `expire_file_uploads`
  - platform access expiry
- **No delete path anywhere:** `deliveries`, `delivery_attempts`, `delivery_effects`, `reminder_jobs`, `live_run_transitions`, `attendance_events`, `allocation_events`, `platform_audit_log`, `person_roster_events`, `discussion_audit_events`, `assignment_response_operations`, `plan_copy_operations`, `library_operations` and the other `*_operations` idempotency tables.
- **Impact.** About 70% of estimated rows are outbox and history. Queue tables with heavy update churn need frequent vacuuming [S13]. Bulk `DELETE` creates vacuum work, while dropping a partition avoids it [S12].
- **Fix.**
  - Now: retention for the outbox, for example 90 days after `completed_at`, keeping per-plan aggregates the Delivery screens need. Idempotency rows can expire after 7–30 days.
  - Next: decide audit retention, and set autovacuum per table on `deliveries` and `reminder_jobs` [S13].
  - Later, at tier 5,000: partition `deliveries`, `delivery_attempts` and `conversation_messages` by month [S12].

**D7. Connections.** *Bites at: tier 500–5,000, through the PostgREST pool rather than the API.*

- **Evidence.** The API uses `supabase-js` over HTTPS only (`lib/supabase.ts:34-49`), so Vercel instances never open Postgres connections. The Data API connects as the `authenticator` role [S5]. Compute sets the connection limits, for example 160 on Large, 240 on XL and 480 on 4XL [S3]. Supabase advises caution about raising the pool past 40% of max connections when the Data API is used heavily [S5].
- **Impact.** At 1–2 k req/s peaks, with 2–4 PostgREST calls per request, pool wait becomes the limit before CPU does. This is an estimate: the PostgREST pool size wasn't checked.
- **Fix.** Cut calls per request (round-trip budget, §6). Watch the PostgREST connection graph [S5]. If a dedicated worker container ever talks SQL directly, use the transaction pooler on port 6543 with prepared statements off [S4].

**D8. Heavy work in one transaction.** *Bites at: tier 50 for large churches.*

- **Evidence.**
  - `authenticated` calls have an 8 s `statement_timeout`. The service role falls back to the authenticator's 8 s [S7].
  - Only `merge_songs` sets its own timeout (`f15_song_merge.sql:162`).
  - Heavy RPCs:
    - `materialize_due_reminders` recomputes up to 50 queued plans and then up to 200 jobs in one call (`f08_release_and_reminders.sql:1064-1080`).
    - `run_due_release_batches` handles 20 batches per call (`:428`).
    - Staffing matrix commit, template apply and plan generation (up to 12 plans) are each one transaction.
  - Changing one person queues every upcoming plan they're on (`queue_person_reminders`, same file).
- **Fix.** Cap batch sizes per call and loop in the worker. Set an explicit timeout on each heavy function. Run "N plans" operations (copy with quantity in N4, generation) as jobs (§4.4).

**D9. PostgREST schema-cache reloads.** *Bites at: every deploy, at every tier.*

- **Evidence.** 74 reloads, each walking about 583 functions and 308 policies, cost about half of all DB time (from db-performance-remediation.md). The parse counts about 291 functions in `public` (exposed) and about 281 in `private`. The migration count, 123 files and 35,882 lines, keeps growing.
- **Fix.** Ship migrations outside Sunday peaks. Keep internal-only helpers in `private` (the existing convention). Record the reload cause (`request-latency-plan.md:76-80`).

### 4.3 API and hosting

**A1. [Host] The 60 s `maxDuration` vs long work.** *Bites at: tier 50.*

- **Evidence.**
  - `backend/vercel.json:9` sets 60 s, below Vercel's Fluid default of 300 s and maximum of 800 s on Pro [S14].
  - The worker route runs deliveries with a 45 s budget, then file maintenance, report exports, webhooks and notification retention one after another (`routes/deliveries.ts:57-68`). A busy run can therefore exceed 60 s and be killed part-way. Leases recover, but the maintenance steps starve.
  - In-request delivery kicks have a 20 s budget each, and the staffing matrix runs them one after another (`staffing-matrix.ts:46`).
- **On AWS.**
  - Lambda allows up to 1,800 s [S23], but **API Gateway HTTP APIs cap integrations at 30 s** [S25].
  - A Lambda Function URL avoids that cap.
  - Containers (Fargate, App Runner, Lightsail) have no platform limit, only load-balancer idle timeouts.
- **Fix.** Give maintenance its own scheduled call. Move fan-out out of the request (B2). Raise `maxDuration` only for the worker route.

**A2. [Host] Cold starts.** *Bites at: tier 1–50 (rare traffic gets cold instances).*

- **Evidence.** The production cold-start share is still unmeasured (PERF-001). Fluid compute reduces cold starts with bytecode caching and pre-warming on production deployments [S15].
- **On AWS.** Lambda has cold starts unless you pay for provisioned concurrency. Fargate, App Runner (its idle "provisioned instance" stays warm [S27]) and Lightsail have none.

**A3. Per-request round trips.** *Bites at: tier 1 for latency, tier 5,000 for Auth load.*

- **Evidence.** Every request makes an Auth HTTP call (`auth.ts:58`) plus `my_org_context` (`organization.ts:72`), then the route's work.
- **Fix.** Keep a **round-trip budget** of at most 4 sequential trips per screen (§6). PERF-005, once its criteria are met (`request-latency-plan.md:136-146`), is the Auth-load fix for tier 5,000. Auth rate limits at that volume were not verified.

**A4. [Host] The rate limiter is in-memory and keyed by IP.** *Bites at: tier 50.*

- **Evidence.** `express-rate-limit` uses its default store: 300 requests per minute globally, plus per-router limits of 30, 60 and 120 (`app.ts:129-136`, `assignment-respond.ts:15`, `calendar-feed.ts:15`, `publication.ts:83`).
- **Impact.**
  - With N instances, the effective limit is N × 300.
  - It is keyed by IP, so a church's shared Sunday NAT address is throttled as one client.
  - The limiter protects little against abuse and can block a whole congregation.
- **By hosting option:**
  - Vercel: per instance.
  - Lambda: per execution environment, which serves one request at a time, so the limiter is effectively useless.
  - A single Lightsail or EC2 box: correct.
  - Fargate or App Runner with more than one task: per task.
- **Fix.**
  - Key authenticated routes by user ID after `requireAuth`, and anonymous token routes by token hash.
  - When running more than one instance, use a shared store:
    - ElastiCache Serverless for Valkey: about $6 a month minimum (100 MB at $0.084 per GB-hour) [S37]. It needs a VPC.
    - DynamoDB on demand: $0.625 per million writes, so about $31 a month at tier 500 and about $312 at tier 5,000 [S38]. No VPC needed.
  - Or use edge or WAF rate rules (not priced here).

**A5. File upload and download paths.** *Scales fine.*

- **Evidence.**
  - Uploads use signed upload URLs straight to Storage (`services/files.ts:265`, `mobile/src/lib/file-transfer.ts:40`). Avatars, logos and songbooks upload from the client with Storage RLS (`frontend/src/pages/SettingsPage.tsx:517`).
  - Downloads are signed URLs (`files.ts:516`, `report-exports.ts:72`).
  - Imports cap JSON at 2 MB (`app.ts:121`), under Vercel's 4.5 MB request body limit [S14].
- **Watch.** Storage egress counts toward Supabase egress, at $0.09 per GB over 250 GB on Pro [S9].

**A6. [Host] `waitUntil` is Vercel-specific.**

- **Evidence.** `deliverEffectInBackground` uses `@vercel/functions` `waitUntil` (`delivery-worker.ts:2,148-151`; used for item-comment notifications, `discussions.ts:357`).
- **On AWS.**
  - On a long-lived container the promise just runs on (`index.ts` handles SIGTERM with a 10 s grace).
  - On Lambda, work left after the response is frozen until the next invocation, so it only lands at the next worker run.
- **Fix.** Hide it behind a small `backgroundTask()` interface in `lib/`.

### 4.4 Background work

**B1. No production schedule.** *Bites at: tier 1, today.*

- **Evidence.**
  - `CRON_SECRET` is unset in production and `vercel.json` has no `crons` (`email-notifications.md:28,53-55`).
  - Reminders, scheduled releases, retries, notification retention, report exports, file maintenance and webhook retries don't run on schedule.
  - Mention emails skip their delay (ADR-0007).
- **Fix (N1).** Use Supabase Cron (`pg_cron`) with an HTTP call to the route every minute. Supabase Cron supports per-second to yearly schedules and recommends at most 8 concurrent jobs, each under 10 minutes [S8]. This is **host-agnostic**: it keeps working after a move to AWS.
- **Alternatives.** Vercel Cron (Pro: per minute, 100 jobs; Vercel now calls Cron Jobs "legacy", to be migrated to "Schedules" [S16]). On AWS, EventBridge Scheduler: 14 M invocations a month free, then about $1 per million [S33].

**B2. Fan-out happens inside the user's request.** *Bites at: tier 50.*

- **Evidence.** These call sites wait for delivery before responding:

  | Call site | What it sends |
  |---|---|
  | `routes/plans.ts:214,227` | time changes, publish |
  | `services/releases.ts:139` | release |
  | `routes/staffing-matrix.ts:46` | one loop per effect |
  | `services/plan-templates.ts:466` | one loop per effect |
  | `services/messages.ts:97` | operational messages |
  | `services/discussions.ts:152` | chat |
  | `routes/assignments.ts:199,584` | scheduling and responses |
  | `routes/availability.ts:114` | availability requests |

  Each call claims up to 100 deliveries for that effect and works them 4 at a time (`delivery-worker.ts:133-140,123`). ADR-0004 chose this on purpose so people "see outcomes in the response".
- **Impact.**
  - Publishing a plan with 60 people means about 160 deliveries, which take 10–20 s in the request. The rest wait for the next worker run, which doesn't exist yet (B1).
  - With several churches publishing at once, Resend's 10 requests per second per team [S18] returns 429s, which back off for 60 s (`resend-transport.ts:46-48`).
- **Fix.** Return right after commit. Kick delivery in the background (`waitUntil`, a container's async task, or a queue). Let the client show progress from the existing delivery status (`notificationSendResult`). Keep the synchronous path only for single-recipient effects.

**B3. Throughput per run.** *Bites at: tier 500.*

- **Evidence.**
  - Per delivery: `loadEffect`, then a plan-status check, a reminder-current check, an eligibility check, eligible assignments, `loadPlans`, `begin_delivery_provider_call` and `complete_delivery`. That is about 8–10 sequential calls (`delivery-dispatch.ts:863-921`, `delivery-worker.ts:19-66`), plus the provider call.
  - Lease 60 s, concurrency 4, one claim per run with a default limit of 50 and a maximum of 100 (`delivery-worker.ts:15-17,97-104`, `schemas/delivery.ts:37-39`).
  - Cron capacity is therefore about 50–100 deliveries per minute, or 72–144 k per day.
- **Impact (estimate).** At tier 500, about 144 k reminder jobs a week turn into about 300 k deliveries, bunched on a few days. Reminders would arrive hours late.
- **Fix.**
  - Drain until the time budget runs out, with repeated claims.
  - Load the effect and its plans once per effect, not once per delivery.
  - Batch email with Resend's batch endpoint (up to 100 per call, no attachments [S19]) or move to SES.
  - Batch push across recipients: Expo takes up to 100 messages per request and 600 notifications per second per project [S21]. Today it chunks only within one recipient's devices (`expo-push.ts:29-30`).
  - Put a **shared send-rate budget** in the claim, so concurrent workers stay under the provider limit.
  - Add per-org fairness. `claim_deliveries` orders only by `next_attempt_at, id` (`20261016000200_…sql:580-584`), so one church's 10 k-message burst can starve everyone else.

**B4. Providers.**

- **Resend:**
  - The rate limit is 10 requests per second **per team, on every plan** [S18][S20].
  - Free is 3,000 emails a month with a 100-a-day cap.
  - Pro is $20 for 50 k emails a month; Scale is $350 for 500 k and $1,150 for 2.5 M [S20].
- **SES:** $0.10 per 1,000 emails, a dedicated IP at $24.95 a month, and Virtual Deliverability Manager at $0.07 per 1,000 [S34]. SES sending quotas and per-second rate weren't checked: new accounts start limited.
- **Expo:** free. Limits are 600 notifications per second per project and 100 per request. Receipts should be checked about 15 minutes after sending and are cleared after 24 h [S21]. Receipts are not polled today (`delivery-worker.md`).
- **Invitations** are still sent directly, not through the outbox (`services/notifications.ts:236`). The follow-up branch is `feature/invitation-outbox`.

### 4.5 Realtime and caching

**R1. Realtime usage.**

- **Evidence.**
  - Private broadcast pokes only, never content.
  - Subscriptions open while a chat thread, the chat list or LIVE is visible (`frontend/src/hooks/useBroadcastRefresh.ts`, `mobile/src/lib/useBroadcastRefresh.ts`).
  - The chat list subscribes to up to 90 topics (`realtime-pokes.ts:8`).
  - The fallback poll is 60 s.
- **Limits [S6]:**

  | Plan | Concurrent connections | Channel joins/s | Messages/s |
  |---|---|---|---|
  | Pro (spend cap on) | 500 | 500 | 500 |
  | Pro (no spend cap) or Team | 10,000 | 2,500 | 2,500 |
  | Any plan | 100 channels per connection | | |

  Pro includes 500 peak connections, then $10 per 1,000, and 5 M messages, then $2.50 per million [S9].
- **Bites at.** Tier 50 for joins: six people opening the chat list within a second use 540 joins. Tier 500 for connections, which needs "no spend cap".
- **Fix.** One per-user "inbox" topic for the chat list, carrying conversation IDs in the poke, instead of 90 per-conversation topics. Keep per-thread topics. Turn off the spend cap before tier 500.

**R2. Polling that remains.**

- **Evidence.**
  - Unread count every 60 s on web and mobile, plus refetch on focus (`queries.ts:990-1000`, `NotificationsProvider.tsx:62,95`).
  - The rehearsal manifest every 600 s.
  - Delivery and webhook status every 10 s while pending (`queries.ts:392,403`).
  - Report exports every 5 s while running.
  - The default `staleTime` is 30 s on both clients (`frontend/src/main.tsx:18`, `mobile/app/_layout.tsx:29`).
- **Impact (estimate).** The unread poll is about 60 requests an hour per open planner tab, each paying Auth plus org context. It's the largest single item in §3.3's request model.
- **Fix.** Send an unread-count poke on the user's inbox topic (as in R1) and drop the poll to a 5-minute fallback.

**R3. Calendar feeds.** *Bites at: tier 500.*

- **Evidence.** The feed is anonymous with a token and a rate limit of 60 per minute. It runs 3–4 `adminDb` queries per fetch (`routes/calendar-feed.ts:15,73-88`) and sets no `Cache-Control`. Express's default weak ETag saves bytes, not DB work.
- **Fix.** Return 304 from a per-person "feed version" when nothing changed, and allow short CDN caching keyed by token.

**R4. Cache invalidation cost.** About 105 `invalidateQueries`/`useQueryClient` uses on web. They are scoped by key and namespaced per org. No global `invalidateQueries()` was found. *Scales fine.*

### 4.6 Multi-tenancy and security at scale

- **Org isolation.** RLS on every table, with membership resolved by `stable security definer` helpers. An RLS-denied row reads as 404 (`lib/supabase.ts:70-79`).
- **Query keys.** Namespaced per org, `['org', org]` (`queries.ts:41`). The active org comes from localStorage on every call (`frontend/src/lib/api.ts:8-12`).
- **`adminDb` call sites.** 25 files. Spot-checked on the request path:
  - `notification-center.ts:45-55` scopes to the caller's active memberships.
  - Device registration is keyed to `req.auth.userId` (`routes/notifications.ts:166-207`).
  - The external API resolves the org from the credential inside each RPC (`services/external-api.ts:49-99`).
  - The calendar feed filters by the token's `organization_id` (`calendar-feed.ts:73,88`).
  - Worker files (`delivery-dispatch.ts` has 52 calls) cross all tenants by design.
  - The remaining files were not audited one by one.
- **Scale risks.**
  - Tenant fairness in the worker (B3).
  - The worker runs as service role across all orgs, so a bug there is a cross-tenant bug. Keep `organization_id` on every outbox row (it is there) and assert it in dispatch.
  - Old policies without `to authenticated` (for example `members_select`, `plan_items_select`) are also evaluated for `anon` [S2].
  - The error handler logs whole error objects (`middleware/error-handler.ts:78`), which can include PostgREST details. That conflicts with CLAUDE.md rule 21 at volume.

### 4.7 Codebase scalability for future features

- **Layering vs CLAUDE.md rules 5–7.**
  - `backend/src/model/` has about 40 model and mapper files, and `services/` exists.
  - There is no repository layer, and routes query the DB directly. Examples: `routes/songs.ts:106-172`, `routes/plans.ts:153-246`, `routes/notifications.ts:38-129`.
  - The `Database` type is hand-written and leaves `Relationships` empty (`lib/supabase.ts:51-56`; `packages/shared/src/types/database.ts`, 2,334 lines). Embedded selects are therefore cast at the call site, and rule 17 ("regenerate types") can't be enforced.
  - **Recommendation:** new features go route → service → repository, with the repository owning PostgREST calls and mapping. Generate DB types (`supabase gen types`) into a separate file and keep the hand-written domain types on top.
- **Modules getting too big:**

  | File | Lines | Split along |
  |---|---|---|
  | `backend/src/services/delivery-dispatch.ts` | 921 | per-template dispatchers |
  | `packages/shared/src/lib/api-client.ts` | 1,672 | per-domain client modules |
  | `frontend/src/hooks/queries.ts` | 1,051 | per-domain hook files |
  | `mobile/app/chat/[id].tsx` | 1,173 | screen components |
  | `mobile/app/plan/live/[id].tsx` | 914 | screen components |
  | `mobile/app/messages/compose.tsx` | 902 | screen components |
  | `backend/src/services/files.ts` | 602 | |
  | `backend/src/routes/assignments.ts` | 588 | |

- **Shared package.** One export surface (`packages/shared/src/index.ts`, 87 exports) with Zod schemas, types, the API client, i18n (en/vi, about 700 KB of JSON) and pure logic. The boundary is healthy: every new input shape goes there first.
- **Migrations.** 123 files, 35,882 lines. The largest are around 1,400–1,700 lines (`f04_assigned_times`, `mob005`, `f13_files`). A policy's final state can only be found by reading every migration in order, which is how this review got it. Consider a periodic schema snapshot (`supabase db dump --schema-only` committed as documentation) so reviewers can see current policies.
- **Tests.**
  - `supabase/tests` has 96 files: SQL suites plus `*.sh` concurrency scripts, a strong point.
  - There are about 240 TypeScript test files (about 92 in backend).
  - **No volume or performance tests.** Every suite uses tiny fixtures.
  - **No CI workflow in the repo** (there's no `.github/`).
  - A seed generator at tier-500 shape, with EXPLAIN assertions for the hot queries, would catch regressions in D1–D3.
- **Mobile parity cost.** The web has 45 pages and mobile has 65 screens over the same API client. Every feature is built twice in the UI, and screens over 700 lines are common on mobile. Keep logic in `packages/shared/src/lib` (already the pattern, for example `realtime-pokes`, `conversations`, `reports`) and keep screens thin.

### 4.8 Observability

| Capability | Today | Needed by |
|---|---|---|
| Access logs | `morgan` `combined` with token paths redacted (`app.ts:123-127`) | — |
| App logs | `console.*` across about 15 files, unstructured | Tier 50: structured JSON with request ID, org ID (not PII), route, duration, DB trip count |
| Error tracking | None on backend, web, mobile or admin (no Sentry or similar dependency) | Tier 1 |
| Request tracing | No request ID and no `Server-Timing` | Tier 1, which would also close PERF-001 |
| DB visibility | `pg_stat_statements` read by hand once (from db-performance-remediation.md). Supabase has a Grafana dashboard with 200+ metrics [S5] and `index_advisor` [S11] | Tier 50: weekly top-20 snapshot and EXPLAIN as a role for new hot queries |
| Worker and queue metrics | The JSON tally is returned by the route (`routes/deliveries.ts:62-68`); Settings → Delivery shows counts | Tier 1: oldest-queued age, queued count and 429 rate, with an alert when the oldest due item is over 10 minutes old |
| Realtime | None | Tier 500: peak connections and joins/s against the quotas [S6] |

---

## 5. Hosting options and cost

### 5.1 Constraints that apply to every option

- **The database stays on Supabase.** RLS through PostgREST is the access model.
  - **Run the API in the Supabase project's AWS region**, US West (Oregon) `us-west-2`, recorded in `db-performance-remediation.md:100`. Vercel `pdx1` already is that region.
  - Region distance multiplied by 4–8 trips was the number-one latency finding.
  - On AWS, use `us-west-2`.
- **Realtime stays on Supabase.** The API never opens sockets (`lib/supabase.ts:9-21`), so whether a host supports WebSockets doesn't matter. (API Gateway WebSocket APIs cost $1 per million messages and $0.25 per million connection-minutes [S24], but aren't needed.)
- **Scheduling stays in Postgres** (`pg_cron` calling the worker route). That works on every host and keeps N1 independent of the hosting decision.
- **A container path already exists.** There is a `backend/Dockerfile`, a `compose.yaml` with a health check, and `backend/src/index.ts`, which listens and handles SIGTERM. The Vercel entry is a 3-line wrapper (`backend/api/index.js:12-18`).
- **Pricing region.**
  - The App Runner rates are stated for Oregon [S26].
  - Fargate, ALB, NAT, Lambda, ElastiCache and DynamoDB pages show US East (N. Virginia or Ohio) example rates. These figures **assume Oregon is the same**; verify in the AWS Pricing Calculator.
  - All prices are as of 2026-11-22.

### 5.2 Cost assumptions

- Requests per month as in §3.3: 0.1 M, 5 M, 50 M and 500 M.
- Average wall time per request: 150 ms, mostly waiting on Supabase.
- Active CPU per request: 15 ms.
- Response size: 5 KB, so API egress is 0.5, 25, 250 and 2,500 GB a month.
- Worker: one run per minute, about 43 k a month, 5–45 s each.
- Emails: about 1,000 per church per month (requests, reminders, mentions, invites), so 1 k, 50 k, 500 k and 5 M.
- Frontend: about 11.6 k CDN requests per church per month (150 users × 3 sessions/week × about 6 uncached requests), so 0.01 M, 0.6 M, 5.8 M and 58 M.

**Unit prices used (as of 2026-11-22):**

| Provider | Price | Source |
|---|---|---|
| Vercel Pro | $20 per developer seat with $20 usage credit. $0.60 per M invocations. Active CPU from $0.128 per hour. Provisioned memory from $0.0106 per GB-hour. 1 TB Fast Data Transfer, then from $0.15 per GB. 10 M CDN ("edge") requests, then from $2 per M. **Assumption:** every API request counts as an edge request; verify in the Vercel usage dashboard | [S17] |
| Lambda | $0.20 per M requests and $0.0000166667 per GB-s (x86), with 1 M requests and 400 k GB-s free. Billed on **wall time**, waiting included | [S22] |
| API Gateway HTTP API | $1.00 per M (first 300 M), then $0.90 | [S24] |
| Fargate Arm | about $0.03238 per vCPU-hour and $0.00356 per GB-hour | [S28] |
| ALB | $0.0225 per hour plus $0.008 per LCU-hour | [S29] |
| Public IPv4 | $0.005 per hour (about $3.65 a month) each | [S30] |
| NAT gateway | $0.045 per hour per AZ plus $0.045 per GB | [S30] |
| App Runner | active $0.064 per vCPU-hour plus $0.007 per GB-hour; provisioned idle $0.007 per GB-hour (Oregon) | [S26] |
| Lightsail | $12 for 2 GB / 2 vCPU / 3 TB transfer, $24 for 4 GB / 4 TB, $84 for 16 GB / 4 vCPU (IPv4 included). Load balancer $18 a month | [S31] |
| AWS egress | $0.09 per GB [S24], with 100 GB a month free across AWS [S32] | |
| Supabase Pro | $25 with $10 compute credit. Compute: Micro $10, Small $15, Medium $60, Large $110, XL $210, 2XL $410, 4XL $960. Disk 8 GB, then $0.125 per GB. Egress 250 GB, then $0.09 per GB. MAU 100 k, then $0.00325. PITR $100 per 7 days. Realtime 500 peak connections, then $10 per 1,000 | [S9] |

### 5.3 API + worker: monthly cost by tier (estimate)

| Option | Tier 1 | Tier 50 | Tier 500 | Tier 5,000 | Sizing notes |
|---|---|---|---|---|---|
| **Vercel Pro (current, `pdx1`)** | $20 (usage ~$3, inside the credit) | $20 (usage ~$15, inside the credit) | **~$185** (CPU $27, memory $34, invocations $30, edge requests $92) | **~$2,200** (CPU $267, memory $171, invocations $300, edge requests $1,096, transfer $384) | Fluid memory: ~2 / 3 / 14 instances × 2 GB on average |
| **Lambda + API Gateway HTTP API** | ~$0 (free tier) | ~$15 | ~$200 | ~$2,080 | 1 GB functions; includes egress |
| **Lambda + Function URL** | ~$0 | ~$10 | ~$150 | ~$1,600 | No API Gateway fee and no 30 s cap |
| **App Runner** (1 vCPU / 2 GB) | ~$14 | ~$30–45 | ~$97 | ~$575 | Active 2 → 18 h/day; 1 → 8 instances; plus egress |
| **ECS Fargate Arm + ALB, public subnets, no NAT** | ~$43 | ~$61 | **~$140** | **~$560** | Tasks 1 × (0.5/1) → 8 × (1/2); ALB with 1–5 LCU; 3–10 IPv4; worker task; egress |
| Same, **with private subnets + NAT** in 2 AZs | +$66 | +$67 | +$80 | +$270 | NAT hours plus $0.045 per GB on Supabase/Resend traffic |
| **Lightsail** (EC2 similar) | **$12** | $24 (1 box) – $42 (2 boxes + load balancer) | ~$66 (2 × $24 + load balancer) | ~$354 (4 × $84 + load balancer) | Fixed boxes, no autoscaling; transfer allowance included |

A shared rate-limit store, needed with more than one instance (A4), adds:

- **Valkey Serverless:** about $6–10 a month at every tier. It needs a VPC: fine for Fargate, but it forces Lambda into a VPC, which then needs NAT for internet access.
- **DynamoDB:** about $3, $31 and $312 a month at tiers 50, 500 and 5,000.

EC2 on-demand rates could not be read from the pricing page [S32], so EC2 isn't priced separately. Expect it to cost about the same as Lightsail, with EBS, IPv4 and transfer billed separately.

### 5.4 Side-by-side on what matters to this app

| | Vercel Pro | Lambda (API GW or URL) | App Runner | ECS Fargate + ALB | Lightsail or EC2 |
|---|---|---|---|---|---|
| **Long jobs** | 60 s configured; 300 s default and 800 s maximum on Pro [S14] | Function up to 1,800 s [S23]; **API GW 30 s cap** [S25]; URL none | Request timeout not stated on the FAQ [S27] (unverified) | No platform cap (ALB idle timeout) | None |
| **Cold starts** | Reduced by Fluid [S15] | Yes, unless provisioned concurrency | None (warm idle instance) [S27] | None | None |
| **Worker scheduling** | Vercel Cron, per minute on Pro [S16], or `pg_cron` | EventBridge Scheduler, 14 M free [S33], or `pg_cron` | `pg_cron` or Scheduler → Lambda that calls the route | Long-running worker task with a drain loop, or `pg_cron` | systemd timer or cron on the box, or `pg_cron` |
| **`waitUntil` / background after the response** | Yes [S15] | No: the environment freezes | Runs on, with CPU throttled when idle | Runs on | Runs on |
| **In-memory rate limiter** | Per instance | Per environment (useless) | Per instance | Per task | Correct with one box |
| **WebSocket fit** | Not needed (Supabase Realtime) | Not needed | HTTP/HTTPS only [S27] | Supported by ALB, not needed | Not needed |
| **Ops burden** | Lowest: previews, TLS and logs included | Low–medium: IAM, adapter, logs | Low: TLS and deploys managed | Medium: VPC, ALB, ACM, task definitions, ECR, autoscaling, CloudWatch | High: OS patching, deploys, no autoscaling or HA without more work |
| **Migration from `backend/api/index.js` + `vercel.json`** | — | **M**: Express adapter, `waitUntil` replacement, Function URL or API GW, IAM, secrets | **S–M**: build from `backend/Dockerfile`, env, domain, CORS (`app.ts:100-113` allows `*.vercel.app` previews) | **M**: image to ECR, task definition, ALB, TLS, DNS, secrets, `TRUST_PROXY` (`app.ts:97`), worker task | **S** for one box (Docker Compose exists), M for HA |
| **Lost on leaving Vercel** | — | Preview deployments per PR, unless rebuilt (all AWS options) | | | |

### 5.5 Things that change the bill

- **NAT gateway (the usual AWS surprise).**
  - Tasks in private subnets need NAT to reach Supabase, Resend and Expo: $0.045 per hour per AZ plus $0.045 per GB [S30].
  - At tier 5,000, about 4.5 TB of Supabase responses would add about $200 a month in processing alone.
  - **Avoid it:** run tasks in public subnets with public IPs, with security groups that only accept traffic from the ALB. That's $3.65 per IP a month [S30], against about $66 a month for NAT in 2 AZs.
  - IPv6 egress-only gateways would avoid both costs, but IPv6 support on the Supabase API endpoint wasn't verified.
- **ALB:** about $16 a month fixed plus LCUs [S29]. **Public IPv4:** $3.65 per address a month, including the ALB's addresses in each AZ [S30].
- **Egress:** AWS $0.09 per GB after 100 GB free [S24][S32]. Vercel 1 TB included, then from $0.15 per GB [S17]. **Supabase egress counts traffic to the API server too**: 250 GB included, then $0.09 per GB [S9], about $18 a month at tier 500 and about $390 at tier 5,000.

**Supabase compute per tier (estimate).** Sizes are chosen so the working set fits in RAM [S3].

| Tier | Compute | Monthly |
|---|---|---|
| 1 | Micro (in Pro's credit) | $25 |
| 50 | Medium, 4 GB | ~$77 |
| 500 | XL, 4 dedicated vCPU / 16 GB, plus PITR, outbox retention assumed | ~$370 |
| 5,000 | 4XL, 16 vCPU / 64 GB, plus PITR | ~$1,625 |

- At tier 5,000, also budget **MAU overage**: about 750 k MAU means about $2,110 a month [S9]. This assumes MAU counts each monthly active signed-in user; it is the largest single line at that tier.
- Before tier 500, turn off the spend cap to get 10 k Realtime connections [S6].

**Email by tier (as of 2026-11-22)** [S20][S34]:

| Tier | Emails/month | Resend | SES |
|---|---|---|---|
| 1 | 1 k | Free ($0, but 100/day can block a busy publish day) → Pro $20 | ~$0.10 |
| 50 | 50 k | Pro $20 | $5 |
| 500 | 500 k | Scale $350 | $50 (+$25 dedicated IP if wanted) |
| 5,000 | 5 M | ~$2,300 (2.5 M tier $1,150 + 2.5 M × $0.46) | $500 (+ VDM ~$350, optional) |

- The email transport is an interface (`NotificationTransport` in `services/email/resend-transport.ts:73`), so swapping providers is S–M. SES needs bounce and complaint handling, which Resend handles today. SES sending quotas start low and need a production-access request (quota numbers weren't verified).
- **Push stays on Expo:** free; 600 notifications per second per project, 100 per request, receipts for 24 h [S21].

**Frontend (Vite SPA, plus the `admin/` and `website/` apps):**

| Host | Pricing | Tier 1 / 50 / 500 / 5,000 |
|---|---|---|
| Vercel | Included in Pro: 1 TB transfer, 10 M CDN requests shared with the API [S17] | $0 / $0 / (in API edge-request cost) / (in API edge-request cost) |
| S3 + CloudFront flat rate | Free: $0 for 1 M requests and 100 GB. Pro: $15 for 10 M and 50 TB. Business: $200 for 125 M [S35] | $0 / $0 / $15 / $200 |
| Amplify Hosting | $0.15 per GB served, builds $0.01 per minute; the page also lists a $15 per app per month firewall charge [S36] | ~$0 / ~$5 / ~$30 / ~$300 |

### 5.6 Recommendation and totals per tier

Totals are API + worker + database + email + frontend, per month, estimated as of 2026-11-22.

| Tier | Recommended stack | Total/month | Main alternative | Total/month |
|---|---|---|---|---|
| **1 (now)** | **Stay on Vercel Pro** (API, cron or `pg_cron`, web) + Supabase Pro Micro + Resend Free→Pro | **~$45–65** | Lightsail $12 + CloudFront Free + SES | ~$37, plus your ops time |
| **50** | **Stay on Vercel Pro.** Supabase Medium, Resend Pro. Add a user-keyed limiter | **~$117** | Lightsail 2 boxes + load balancer + SES | ~$125 |
| **500** | **Move to ECS Fargate Arm + ALB in us-west-2**, public subnets, no NAT, Valkey limiter. **SES.** CloudFront Pro. Supabase XL + PITR, no spend cap | **~$575** | Stay on Vercel + Resend Scale | ~$905. App Runner + SES: ~$530 (cheapest, but its future and limits weren't verified, so Fargate is the safer long-term target) |
| **5,000** | Fargate (autoscaled) + SES + CloudFront Business + Supabase 4XL (+ MAU) | **~$5,000** | Vercel + Resend | ~$8,200. Lambda (URL) + SES: ~$6,300 |

**Why this path:**

- Through tier 50, Vercel's usage stays inside the $20 credit, and its previews and zero-ops setup are worth more than any saving.
- Between tier 50 and 500, Vercel's per-request charges (invocations and edge requests) and Resend's per-email price grow linearly. Fargate's cost grows with *concurrency*, which is low for an I/O-bound API.
- **Trigger the move** when any of these happens:
  - more than about 20 M API requests a month;
  - the worker needs runs longer than the function budget;
  - the shared limiter becomes necessary.
- Do the host-agnostic work first, so the move stays a deployment change rather than a code change:
  - `pg_cron` scheduling;
  - fan-out out of the request;
  - a `backgroundTask()` seam;
  - the user-keyed limiter.
- **Not recommended:** Lambda for this Express app (wall-time billing while waiting on Supabase, no `waitUntil`, the 30 s API GW cap, a per-environment limiter); NAT-based private networking; Lightsail beyond tier 50 (no autoscaling or HA without more work).

---

## 6. Architecture principles for future features

Every new feature must pass this checklist. Each rule comes from a finding above.

1. **Page every list on the server.** Use `limit` plus a keyset cursor, return `has_more` and a total when it's cheap, and bound by date wherever history grows. Never rely on `max_rows` (D5; `config.toml:8`).
2. **Shape RLS as sets.**
   - New SELECT policies use `col in (select private.my_…())` with no row arguments, or `(select auth.uid())` compared to an indexed column.
   - Write policies are per command (insert, update, delete), never `FOR ALL` on a table that has a SELECT policy.
   - Never query another RLS table inside a policy.
   - Always add `to authenticated` (D1–D3; [S2]).
   - Ship an access-matrix SQL test (owner, admin, scoped scheduler, member, assignee, other org, anon), as in `supabase/tests`.
3. **Index what RLS, filters and cascades touch.** The `organization_id` column leads composite indexes used by list queries, and every FK used in a join or cascade has an index (D4; skill `schema-foreign-key-indexes`).
4. **Decide retention when you create the table.** Every append-only or queue table says how long rows live and what prunes them (a worker step with a bounded batch), or why they're kept forever (D6).
5. **Fan-out goes to the worker, never the request.** Anything that reaches more than one person writes `delivery_effects` in the transaction and returns. The request may kick a background delivery but never waits on providers (B2). New channels respect a shared provider rate budget (B3).
6. **Work over N things is a job.** Anything proportional to org size or a user-chosen quantity, such as copies, generation, imports, exports or bulk edits, runs as a leased job with progress. Report exports already work this way (`report-exports.ts:183`). Heavy RPCs set their own `statement_timeout` and batch size (D8; [S7]).
7. **Round-trip budget.** At most 4 sequential trips per screen after middleware. Embed related reads in one PostgREST select or one RPC, run independent reads in parallel, and never call an RPC in a loop (A3; `stillSchedulesAny` was the precedent).
8. **Shared schema first.** Write the Zod input, the domain type and the API client method in `packages/shared` before writing the route, web screen or mobile screen. Pure logic goes in `packages/shared/src/lib` so mobile gets it for free (§4.7).
9. **Mobile parity in the plan.** Each feature lists its web and mobile screens and states what is deferred on mobile. Screens over about 500 lines get split.
10. **Realtime as pokes only.** No content on a topic. Prefer one per-user topic over many per-resource topics, and keep a fallback poll at 60 s or more (R1).
11. **Observable from day one.** New routes log a structured line with route, duration and trip count. New worker steps report counts and oldest-item age (§4.8).
12. **Host-agnostic.** No new imports from `@vercel/*`. Background work and scheduling go through `lib/` seams and `pg_cron` (A6, B1).

---

## 7. Scalability roadmap

Sizes: S is about 1–3 days, M about 1–2 weeks, L 3 weeks or more, including tests. "Unlocks" is the tier the item makes safe.

### Now (before N2/N5, and alongside N1)

| # | Item | Size | Unlocks | Depends on | Areas |
|---|---|---|---|---|---|
| **S1** | **Worker schedule, host-agnostic (= N1).**<br>- `pg_cron` every minute calls `/internal/deliveries/run`.<br>- `CRON_SECRET` set.<br>- Maintenance (files, exports, webhooks, retention) gets its own scheduled call so the delivery run keeps its 45 s inside 60 s.<br>- The run drains with repeated claims until its deadline. | S | 1 → 50 | — | DB migration, backend route, ops |
| **S2** | **Fan-out out of the request.**<br>- Publish, release, matrix, template and message routes return after commit.<br>- A background kick runs through a `backgroundTask()` seam (`waitUntil` on Vercel, async on containers).<br>- Clients show send progress from the existing delivery status.<br>- Update ADR-0004. | S–M | 50 | S1 | backend, web and mobile toasts, ADR |
| **S3** | **Observability baseline.**<br>- Request ID and `Server-Timing` (trips, DB ms).<br>- Structured JSON logs.<br>- Error tracking on backend, web and mobile.<br>- Worker metrics and an alert on oldest-due age.<br>- Record the PERF-001 baseline. | S–M | all | — | backend, web, mobile, ops |
| **S4** | **Rate limiter keyed by user and token**, plus a shared-store interface (memory now, Valkey or DynamoDB later). | S | 50 | — | backend |
| **S5** | **Outbox and idempotency retention.**<br>- Prune `deliveries`, `delivery_attempts`, `delivery_effects` and `reminder_jobs` after 90 days, keeping per-plan aggregates.<br>- Expire `*_operations` rows after 30 days.<br>- Per-table autovacuum on queue tables. | M | 500 | S1 | DB, backend Settings → Delivery |

### Next

| # | Item | Size | Unlocks | Depends on | Areas |
|---|---|---|---|---|---|
| **S6** | **Delivery throughput.**<br>- Load each effect once per batch.<br>- Expo batching across recipients.<br>- Resend batch or SES.<br>- A shared send-rate budget in `claim_deliveries`.<br>- Per-org fairness. | M | 500 | S1, S2 | DB, backend dispatch |
| **S7** | **DB plan Phase 2:** split the 19 `FOR ALL` policies, starting with `plan_items` and `plan_times`. | M | 500 | — | DB, SQL tests |
| **S8** | **DB plan Phase 1 for the rest:** set helpers for plans, plan_items, plan_times, songs, arrangements, teams and people/people_directory, plus `to authenticated`. | L | 500 | S7 is easier first | DB, SQL tests |
| **S9** | **Jobs framework** for N-item operations (generalise `report_exports`): copy with quantity, generation, imports. Per-function `statement_timeout`. | M | 500 | S1 | DB, backend, web, mobile progress UI |
| **S10** | **Realtime budget:** a per-user inbox topic for the chat list and unread count, replacing up to 90 topics and the 60 s unread poll. Supabase spend cap off. | M | 500 | — | DB trigger, shared, web, mobile |
| **S11** | **Volume test harness:** a seed generator at tier-500 shape, EXPLAIN-as-role assertions for the top 10 queries, and a CI workflow. | M | 500 | — | supabase/tests, CI |
| **S12** | **Move API + worker to ECS Fargate (us-west-2, public subnets, no NAT)**, with the frontend on S3 + CloudFront. **SES** for email. | M | 500 | S1, S2, S4, `backgroundTask` seam | ops, backend config, email transport |

### Later

| # | Item | Size | Unlocks | Depends on | Areas |
|---|---|---|---|---|---|
| S13 | DB plan Phase 3 (nested RLS), plus unindexed FK clean-up (D4) | M | 5,000 | S8 | DB |
| S14 | Partition `deliveries`, `delivery_attempts` and `conversation_messages` by month, or archive them to Storage | L | 5,000 | S5 | DB, worker |
| S15 | Calendar feed 304s and CDN caching | S–M | 5,000 | — | backend |
| S16 | PERF-005 local JWT verification with a revocation guard | M | 5,000 | adoption criteria | backend |
| S17 | Repository layer and generated DB types for new modules; split `delivery-dispatch.ts`, `api-client.ts` and `queries.ts` | M (incremental) | dev velocity | — | backend, shared, web |

### How it interleaves with the feature plan

| Feature | Do first | Why |
|---|---|---|
| **N1** Production worker schedule | **is S1** | Build it the `pg_cron` way so it survives a hosting move. Split maintenance off and add drain in the same change. |
| **N2** Better scheduling email (custom message, led items, times, Accept/Decline) | **S2 and S3 before; S6 soon after** | N2 makes every request and publish email richer, which means more DB reads per delivery (led items, times) on the release and publish paths that block the request today. Move fan-out off the request first, and measure per-delivery trips so N2 doesn't double them. |
| **N3** Order editor speed pack (drag-drop, quick-add, clear order) | **S7 for `plan_items`/`plan_times` before or alongside** | Drag-and-drop multiplies writes and refetches of `plan_items`, whose reads still pay the `FOR ALL` `can_edit_plan` check per row. One reorder RPC per drop (round-trip budget). "Clear order" is one atomic RPC. |
| **N4** Template authoring and copy-plan UI (with quantity) | **S9 before the "quantity" part** | Copy × N and generation are org-sized single transactions under an 8 s timeout. The template editor itself can ship first. |
| **N5** Plan notes that reach people (notes in reminders, "send note as email") | **S1, S2 and S6** | It adds email fan-out to whole teams and a notes query per reminder. It needs the worker, batching and the rate budget. Load notes once per effect, not once per delivery. |
| X1 Times linked to teams | S8 helper shape for the new link table | A new RLS table: design it set-based from day one (principle 2). |
| X3 Lyric search | Index work (D4/D5): trigram or full-text with accent folding (the `large_list_search` pattern) | Search over chart text across 300 songs × arrangements needs an index, not `ilike`. |
| X5 Audiences and attachments | S6 | Resend batch doesn't support attachments [S19]; attachment emails go one by one, so they need the rate budget. |
| L1 LIVE chat panel, L3 multi-team chats and archive | S10, S5 | Realtime topic budget; chat retention. |

**Recommended order:** S1 (N1) → S3 → S2 → S4 → N2 → S7 → N3 → S5 → S6 → N5 → N4 (editor) → S9 → N4 (quantity copy) → S8 / S10 / S11 → S12 (hosting move, timed to the request-volume trigger) → Later items.

**Why this order:**

- S1 and S3 are cheap and turn already-built features on, and make everything after them measurable.
- S2 has to land before N2 and N5 add more email to the paths that block the request.
- S7 is a mechanical policy split that de-risks N3's heavy `plan_items` traffic.
- Retention (S5) goes in before the outbox gets large, because pruning 45 M rows later is a project in itself.
- The hosting move comes last: by then the seams (S1, S2, S4) make it a deployment change. Its trigger is request volume (§5.6), not a date.

---

## 8. Source register

All accessed **2026-11-22**. Prices are as of that date.

| ID | Source |
|---|---|
| S1 | Supabase, [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) |
| S2 | Supabase, [RLS performance and best practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv) |
| S3 | Supabase, [Compute and disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| S4 | Supabase, [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) |
| S5 | Supabase, [Connection management](https://supabase.com/docs/guides/database/connection-management) |
| S6 | Supabase, [Realtime limits](https://supabase.com/docs/guides/realtime/limits) |
| S7 | Supabase, [Timeouts](https://supabase.com/docs/guides/database/postgres/timeouts) |
| S8 | Supabase, [Cron](https://supabase.com/docs/guides/cron) |
| S9 | Supabase, [Pricing](https://supabase.com/pricing) |
| S10 | Supabase, [Performance tuning](https://supabase.com/docs/guides/platform/performance) |
| S11 | Supabase, [Query optimization](https://supabase.com/docs/guides/database/query-optimization) |
| S12 | PostgreSQL, [Table partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html) |
| S13 | PostgreSQL, [Routine vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html) |
| S14 | Vercel, [Functions limits](https://vercel.com/docs/functions/limitations) |
| S15 | Vercel, [Fluid compute](https://vercel.com/docs/fluid-compute) |
| S16 | Vercel, [Cron Jobs usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) |
| S17 | Vercel, [Pricing](https://vercel.com/pricing) |
| S18 | Resend, [Rate limit](https://resend.com/docs/api-reference/rate-limit) |
| S19 | Resend, [Send batch emails](https://resend.com/docs/api-reference/emails/send-batch-emails) |
| S20 | Resend, [Pricing](https://resend.com/pricing) |
| S21 | Expo, [Sending notifications](https://docs.expo.dev/push-notifications/sending-notifications/) |
| S22 | AWS, [Lambda pricing](https://aws.amazon.com/lambda/pricing/) (US East example rates) |
| S23 | AWS, [Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html) |
| S24 | AWS, [API Gateway pricing](https://aws.amazon.com/api-gateway/pricing/) |
| S25 | AWS, [HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html) |
| S26 | AWS, [App Runner pricing](https://aws.amazon.com/apprunner/pricing/) (rates listed for US West (Oregon)) |
| S27 | AWS, [App Runner FAQs](https://aws.amazon.com/apprunner/faqs/) |
| S28 | AWS, [Fargate pricing](https://aws.amazon.com/fargate/pricing/) (US East example rates) |
| S29 | AWS, [Elastic Load Balancing pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) (US East example rates) |
| S30 | AWS, [VPC pricing](https://aws.amazon.com/vpc/pricing/) (NAT: US East (Ohio) example; public IPv4 in all commercial regions) |
| S31 | AWS, [Lightsail pricing](https://aws.amazon.com/lightsail/pricing/) |
| S32 | AWS, [EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/) (100 GB/month free transfer out; the instance table wasn't readable) |
| S33 | AWS, [EventBridge pricing](https://aws.amazon.com/eventbridge/pricing/) |
| S34 | AWS, [SES pricing](https://aws.amazon.com/ses/pricing/) |
| S35 | AWS, [CloudFront pricing](https://aws.amazon.com/cloudfront/pricing/) (flat-rate plans) |
| S36 | AWS, [Amplify pricing](https://aws.amazon.com/amplify/pricing/) |
| S37 | AWS, [ElastiCache pricing](https://aws.amazon.com/elasticache/pricing/) (US East example rates) |
| S38 | AWS, [DynamoDB on-demand pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/) (US East example rates) |

**Could not verify in this run:**

- Production: function placement and Fluid status, cold-start share, compute size, the PostgREST pool size, and the `max_rows` setting.
- Oregon-specific rates for Lambda, Fargate, ALB, NAT, ElastiCache and DynamoDB.
- EC2 instance prices.
- Whether every Vercel function request counts as an edge request.
- SES default sending quotas.
- App Runner's request timeout and its availability to new customers.
- Supabase Auth rate limits for `getUser` at tier-5,000 volume.
- IPv6 reachability of the Supabase API.
