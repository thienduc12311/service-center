# Request latency plan: chat and My Schedule

Date: **2026-11-19** · Companion to [Database performance remediation plan](db-performance-remediation.md), which holds the production evidence (`pg_stat_statements`, cache hit, EXPLAIN).

Tickets here are a repository backlog (`PERF-xxx`), in the same style as the MOB tasks in [mobile-feature-tasks.md](mobile-feature-tasks.md). They are not published issue-tracker tickets.

## Problem

The request paths and trip estimates below describe the pre-change baseline.

Chat and My Schedule feel slow because each screen waits on a long chain of round trips that run one after another. The database work itself is small: app queries average 0.4–42 ms in production. Each trip also pays the distance between the API and the database. Opening a chat thread additionally runs the whole organization's conversation list twice.

### Chat thread: `GET /conversations/:id`

Path: [`getConversation`](../../backend/src/services/discussions.ts). Each step waits for the previous one.

| # | Step | Where | Notes |
| --- | --- | --- | --- |
| 1 | `auth.getUser()` | `middleware/auth.ts` | HTTP call to the Auth server, which makes 5 DB lookups |
| 2 | Memberships query | `middleware/organization.ts` | |
| 3 | `my_effective_access` | `services/access.ts` | |
| 4 | `my_conversations` | `conversationSummary` | The whole org's chat list (up to 100, with per-message unread counts and `has_blocked()`), used to find one row |
| 5 | `my_conversations` **again** | `listConversationMessages` → `conversationSummary` | Same query, same result |
| 6 | Messages | `listConversationMessages` | Newest 30 |
| 7 | Mentions | `shapeMessages` | |
| 8 | Author and mention names | `directoryNames` → `people_directory` | |

The chat screen also loads the list (`GET /conversations`), so opening chat runs `my_conversations` three times. The thread then repeats all 8 steps every 10 s (`CONVERSATION_THREAD_POLL_MS`).

### My Schedule: `GET /schedule/mine`

Path: [`routes/assignments.ts`](../../backend/src/routes/assignments.ts) (`scheduleRouter.get('/mine')`).

| # | Step | Notes |
| --- | --- | --- |
| 1–3 | Auth, memberships, access | Same fixed cost as above |
| 4 | Caller's `people` row | Only to get `person_id` |
| 5 | Assignments with team, position, plan and plan times embedded | RLS per row: `assignments_select` measured at about 2.2 ms per row, plus RLS on each embedded table |
| 6 | `assignment_attendance_for` + `assignment_time_responses` (parallel) | `assignment_attendance_for` is the slowest app RPC in production: 38.6 ms mean, 113 ms max. `assignment_time_responses` has a nested policy that re-runs the assignments check |
| 7 | Latest decline reasons | Only when some are declined |

### What it adds up to

The previous backend config left function placement to the Vercel project setting, which defaults to `iad1` (Washington, D.C.) for new projects. The database remediation plan reports the production database in AWS `us-west-2` (Oregon). If the pre-change deployment runs in `iad1`, the estimated 60–70 ms per trip adds up as follows. [Vercel function region settings](https://vercel.com/docs/functions/configuring-functions/region)

| Screen | Sequential trips | Latency before query time |
| --- | --- | --- |
| Chat thread | 8 | about 500–600 ms |
| My Schedule | 7 | about 450–500 ms, plus about 50–80 ms of RLS work |

Cold starts can add latency. The deployed function region and cold-start contribution still need production measurements (PERF-001).

## Goal and acceptance

- Chat thread and My Schedule return in **under 150 ms p95** server time with a warm function, measured in Vercel function logs.
- Chat thread makes **at most 4 sequential trips**; `my_conversations` is not called when opening one conversation.
- Every request makes **at most 1 fixed trip** before route work (down from 3).
- No change to who can see what: every read still goes through RLS, and a removed member still gets 404 on the next request.

## Phases

1. **Phase A: Measure and fix placement** — PERF-001, PERF-002. No code risk, largest gain per trip.
2. **Phase B: Cut round trips** — PERF-003, PERF-004, PERF-005, PERF-006. Backend-only; no API contract change for clients.
3. **Phase C: Reduce per-row RLS on these paths** — PERF-007. Depends on Phase 1 of the [database remediation plan](db-performance-remediation.md#plan).
4. **Phase D: Stop repeating the work** — PERF-008. Polling replaced by Realtime Broadcast pokes.

Initial rollout combines the backend region pin with PERF-003, PERF-004, and PERF-006. Apply the two additive Supabase migrations before deploying the API that calls the new functions. The rollout is expected to bring fixed org-scoped requests from three calls to two (Auth plus organization context) and chat threads to at most four sequential route stages. The one-call middleware target is still open because PERF-005 retains the live Auth check. Measure server time before and after rollout with the same requests.

PERF-007, PERF-008, and the broader database phases follow separately. Their acceptance depends on measuring the new baseline and verifying access and live-update behavior.

## Baseline

**2026-11-19.** The repository now configures `pdx1` (Portland, AWS `us-west-2`) for the API project and keeps the 60 s limit. The [deployment guide](../../README.md#3-api-project) identifies `backend` as the Vercel root, and the top-level `regions` setting overrides the project default for deployments built from this config. Production placement, Fluid compute, cold-start share and initialization duration, and route p50/p95 remain unverified. Authenticated aggregate production telemetry was unavailable in this worktree. [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json#regions) · [Vercel region map](https://vercel.com/docs/regions)

- Before rollout, record the production deployment ID and check the configured region and Fluid compute status in **Settings → Functions**. Verify actual placement using the function's execution region. For the last full seven-day UTC window before rollout, capture invocation count, cold-start count and share, and cold-start initialization p50/p95 from existing aggregate telemetry where available. [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime) · [Vercel execution region fields](https://vercel.com/docs/drains/reference/logs)
- In **Observability → Functions** or an existing metrics backend, group successful invocations by incoming `GET` path for `/api/v1/conversations/:id` (one segment after `conversations`), `/api/v1/conversations`, and `/api/v1/schedule/mine`. All three reach `api/index.js`. Record each route's sample count and function-duration p50/p95, plus warm p95 where cold-start classification is available. Keep only aggregate results and mark gaps in retention or metric coverage. Repeat over a comparable seven-day window after rollout, verify `pdx1` execution, and compare each route's p50 against its own baseline. Record any Fluid compute change when interpreting the result. [Vercel Observability](https://vercel.com/docs/observability)

### PostgREST schema cache (DB Phase 0.5)

The DB inspection recorded 74 `pg_timezone_names` calls (452 ms mean, 4,050 ms max) without a stats window. This is a cache-load proxy that can include startup loads. The tracked migrations and app code have no explicit `NOTIFY pgrst`, `pg_notify` reload, or custom DDL event trigger. The documented `db:push` applies DDL that can trigger the Supabase-managed `pgrst_ddl_watch` and `pgrst_drop_watch`. Postgres coalesces identical notifications in a transaction, and PostgREST debounces bursts across transactions. [DB inspection](db-performance-remediation.md#production-inspection-results) · [Supabase Postgres trigger definitions](https://github.com/supabase/postgres/blob/17.6.1.166/migrations/schema-17.sql) · [PostgREST schema cache](https://docs.postgrest.org/en/v14/references/schema_cache.html)

For the same UTC window, check which `pgrst_*` event triggers are enabled in `pg_event_trigger` and aggregate count and duration of schema cache loads in Supabase PostgREST logs. Correlate load timestamps with migration and dashboard DDL, API deploys, and PostgREST startup or reconnect events. Record counts by cause and leave unmatched loads unattributed. Remove repeat manual reloads only if the timeline shows them, and keep refreshes for API schema changes. [Supabase log sources](https://supabase.com/docs/guides/observability/log-field-reference)

## Tickets

| ID | Title | Phase | Area | Depends on | Size |
| --- | --- | --- | --- | --- | --- |
| [PERF-001](#perf-001) | Confirm function region, cold starts and baseline timings | A | Ops | — | S |
| [PERF-002](#perf-002) | Run the backend in the database's region | A | Ops / config | PERF-001 | S |
| [PERF-003](#perf-003) | Load the conversation summary once, by id | B | Backend | — | M |
| [PERF-004](#perf-004) | Run independent chat lookups in parallel | B | Backend | PERF-003 | S |
| [PERF-005](#perf-005) | Verify login tokens locally with `getClaims()` | B | Backend | — | M |
| [PERF-006](#perf-006) | One call for membership and effective access | B | Backend / DB | — | M |
| [PERF-007](#perf-007) | Set-based access for My Schedule and attendance | C | DB | DB plan Phase 1 | L |
| [PERF-008](#perf-008) | Realtime Broadcast pokes for chat and live runs | D | DB / web / mobile | PERF-003 | L |

### PERF-001

**Confirm function region, cold starts and baseline timings**

- Read the backend project's function region in Vercel (Project → Settings → Functions).
- From Vercel function logs for one week, record: share of invocations that were cold starts, their init duration, and p50/p95 duration for `GET /conversations/:id`, `GET /conversations` and `GET /schedule/mine`.
- Check whether Fluid compute is on.
- Record the numbers in this file under a new "Baseline" heading.

Acceptance: region, cold-start share, and p50/p95 for the three routes are written down.

### PERF-002

**Run the backend in the database's region**

- Add `"regions": ["pdx1"]` to [`backend/vercel.json`](../../backend/vercel.json) (Oregon, matching `us-west-2`), unless PERF-001 shows it is already there.
- Turn on Fluid compute if it is off, to cut cold starts.
- Leave `maxDuration: 60` unchanged.

Acceptance: Vercel logs show the function in `pdx1`; p50 for the three routes drops by at least half against the PERF-001 baseline.

### PERF-003

**Load the conversation summary once, by id**

- Add a `my_conversation(p_conversation_id uuid)` RPC (or a `p_conversation_id` filter on `my_conversations`) that returns the same `ConversationSummary` shape for one conversation, with the same access check (`private.can_access_conversation`) and the same unread, mute and moderation fields.
- `conversationSummary` calls it instead of loading the whole list and searching it.
- `getConversation` passes the summary it already loaded into the message listing, so `listConversationMessages` does not load it a second time. `GET /conversations/:id/messages` still checks access once on its own.
- Keep the 404 for no access or a guessed id.

Acceptance: opening a thread calls the summary query once; `my_conversations` is not called by `GET /conversations/:id`; existing conversation tests pass; new tests cover a removed member (404) and a conversation beyond the newest 100.

### PERF-004

**Run independent chat lookups in parallel**

- In `shapeMessages`, start the mentions lookup and the author-names lookup together, since author ids are known from the messages. Look up names only for mentioned people not already loaded, or return mention names from one RPC.
- In `getConversation`, start messages and open reports together after the summary (already partly done).

Acceptance: thread load is at most 4 sequential trips after middleware (summary → messages → mentions and names together).

### PERF-005

**Local JWT verification deferred to preserve session revocation.** [`requireAuth`](../../backend/src/middleware/auth.ts) keeps `getUser(token)` on every protected route, including `/me`, admin, chat and My Schedule. The Auth round trip remains in the request budget.

- The installed `@supabase/supabase-js` and `@supabase/auth-js` **2.109.0** call `GET /auth/v1/user` for `getUser(token)`. `getClaims(token)` parses the token, checks that `exp` is present and later than the current Unix second, and verifies an RS256 or ES256 signature with WebCrypto when it can find the project JWKS key. The local path has no expected `iss` or `aud` check and no strict runtime type check for `exp`. The SDK falls back to `getUser` for HS tokens, missing algorithm or key ID, unavailable WebCrypto, or a successful JWKS lookup without a matching key. That fallback still costs an Auth request and returns JWT claims. A failed JWKS fetch or signature check fails verification. [SDK implementation](https://github.com/supabase/supabase-js/blob/v2.109.0/packages/core/auth-js/src/GoTrueClient.ts#L6273) · [JWT helpers](https://github.com/supabase/supabase-js/blob/v2.109.0/packages/core/auth-js/src/lib/helpers.ts#L342) · [Supabase `getClaims` reference](https://supabase.com/docs/reference/javascript/auth-getclaims)
- Auth looks up the current user and the session referenced by a session JWT. A removed user or session yields an Auth error, which the middleware returns as `401 unauthorized`. A successful Auth response with a future `banned_until` yields `401 account_blocked`. Auth versions that reject a ban themselves reach the generic `401` path. The platform block operation sets the ban and deletes sessions while the user's ordinary organization memberships remain active. Revoking an organization membership is a separate authorization decision checked by organization middleware and RLS. The admin session endpoint also uses the current email from Auth. [Supabase Auth user and session checks](https://github.com/supabase/auth/blob/v2.198.0/internal/api/auth.go) · [Platform account block](../../supabase/migrations/20261118000000_platform_user_management.sql) · [Middleware regression tests](../../backend/src/middleware/auth.test.ts)
- Successful sign-out removes the sessions in scope. Web and admin use the JS default global scope, and mobile uses local scope. A locally verified JWT can still pass until its `exp` after sign-out, platform block, account deletion, or other session removal. The repository's local TTL is 3,600 seconds. Hosted signing keys, issuer, audience, and TTL were outside this review. [Supabase session revocation](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out) · [Server-side Auth guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide) · [Sign-out scopes](https://supabase.com/docs/guides/auth/signout)

To revisit the optimization, verify the deployed issuer and user-token audience for each supported Auth URL. Require those values on verified claims, validate a finite numeric `exp` and the expected user/session claim types, and preserve fail-closed verification and the legacy Auth fallback where needed. The upstream Auth parser verifies with the configured signing keys and leaves the `iss` string unpinned. The `/user` audience comparison uses the request audience, which can come from the token. Any local verifier needs explicit application expectations for both claims. [Auth JWT parser](https://github.com/supabase/auth/blob/v2.198.0/internal/api/auth.go#L109) · [Auth `/user` handler](https://github.com/supabase/auth/blob/v2.198.0/internal/api/user.go#L63) · [Auth audience resolution](https://github.com/supabase/auth/blob/v2.198.0/internal/api/helpers.go#L25) · [Supabase JWT claims](https://supabase.com/docs/guides/auth/jwts)

Keep an uncached server-backed check on each migrated route unless an explicit policy approves a wider window for that route. A future implementation could combine the check with a required data request if it verifies current user and session ownership, ban state, and any needed current user fields before route work. Prove parity on org-scoped, no-org and privileged paths. In a disposable environment, test malformed and expired tokens, a correctly signed wrong-issuer or wrong-audience token, legacy fallback, key rotation/revocation, and replay after local/global sign-out, block, and deletion. Preserve the next-request membership-denial behavior. Measure warm request latency and confirm the Auth call is gone on any migrated route. [Supabase signing and JWKS cache behavior](https://supabase.com/docs/guides/auth/signing-keys#public-key-discovery-and-caching)

### PERF-006

**One call for membership and effective access**

- Add a `my_org_context(p_org uuid)` RPC that returns the caller's active memberships (for org inference) and the effective access rows for the chosen org in one call.
- `withOrganization` uses it instead of the memberships query plus `my_effective_access`.
- `/me` loads access for all organizations in the same single call instead of once per organization.

Acceptance: middleware makes one DB call; behaviour for zero, one and several memberships, disabled churches and expiring platform access is unchanged and covered by tests.

### PERF-007

**Set-based access for My Schedule and attendance**

- Uses the set helpers from the [database remediation plan](db-performance-remediation.md#plan) Phase 1 (for example `private.my_visible_assignment_ids()`).
- Rewrite `assignments_select`, `assignment_time_responses_select` and the access path under `private.assignment_attendance` so the caller's access is resolved once per query instead of once per row.
- Same visibility rules: released vs prepared, assignee, team visibility, scheduling scope.

Acceptance: EXPLAIN for My Schedule shows no per-row SubPlan for `can_see_released_assignment`; `assignment_attendance_for` mean drops below 10 ms; RLS regression tests cover owner, admin, scoped scheduler, team member, released assignee, other-org member and anonymous.

### PERF-008

**Realtime Broadcast pokes for chat and live runs**

- A trigger on `conversation_messages` (insert, edit, hide, delete) calls `realtime.send` to a private channel `conversation:<id>` with only the conversation id and an event name; never the message body.
- A policy on `realtime.messages` lets a user join `conversation:<id>` only when `private.can_access_conversation` allows it.
- Web and mobile subscribe while a thread or the list is open and refetch through the existing API on each poke. Keep a 60 s fallback poll.
- Same pattern for `live_run:<id>`, replacing the 2 s poll.
- A removed member keeps receiving pokes only until the channel re-checks access; a poke carries no content and every fetch is still checked.

Acceptance: a new message appears in an open thread in under 1 s; chat and live-run request volume drops by at least 80% during a service; revocation still ends access on the next fetch.

## Out of scope

- The wider RLS rewrite across all tables (database remediation plan Phases 1–3) beyond what PERF-007 needs.
- Compute size changes; decide after Phase B with fresh measurements.
