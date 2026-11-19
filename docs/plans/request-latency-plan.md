# Request latency plan: chat and My Schedule

Date: **2026-11-19** · Companion to [Database performance remediation plan](db-performance-remediation.md), which holds the production evidence (`pg_stat_statements`, cache hit, EXPLAIN).

Tickets here are a repository backlog (`PERF-xxx`), in the same style as the MOB tasks in [mobile-feature-tasks.md](mobile-feature-tasks.md). They are not published issue-tracker tickets.

## Problem

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

The backend is a Vercel function and [`backend/vercel.json`](../../backend/vercel.json) sets no region; Vercel's default is `iad1` (Washington, D.C.). The database is in AWS `us-west-2` (Oregon), about 60–70 ms away per trip. If the deployed region is the default:

| Screen | Sequential trips | Latency before query time |
| --- | --- | --- |
| Chat thread | 8 | about 500–600 ms |
| My Schedule | 7 | about 450–500 ms, plus about 50–80 ms of RLS work |

Cold starts add roughly 1–3 s on top when the function has been idle, which is likely at today's traffic. Neither the region nor the cold-start rate has been confirmed yet (PERF-001).

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

Each ticket ships on its own `feature/perf-*` branch with tests. Measure server time before and after each phase with the same request.

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

**Verify login tokens locally with `getClaims()`**

- Replace `adminDb.auth.getUser(token)` in [`middleware/auth.ts`](../../backend/src/middleware/auth.ts) with `getClaims(token)` (supported by the installed `@supabase/supabase-js` 2.109).
- `getClaims` verifies locally only when the project uses asymmetric JWT signing keys; with the legacy shared secret it still calls the Auth server. Move the project to asymmetric signing keys first if needed.
- Keep what `getUser` protected against: a signed-out or deleted user. Decide and document the accepted window (until token expiry, default 1 hour) or keep a server-side revocation check for sensitive routes.

Acceptance: no Auth server call on a normal request (visible as about 3,500 fewer `auth.users` / `sessions` lookups per window in `pg_stat_statements`); auth tests cover expired, malformed and wrong-issuer tokens.

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
