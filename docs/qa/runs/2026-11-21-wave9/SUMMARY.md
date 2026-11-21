# QA wave 9 — summary (2026-11-21)

Plan: [admin and mobile test plan](../../../plans/admin-mobile-test-plan.md). Commit `9aaeada` (`main` = wave 8 fixes, follow-ups and review round, PR #123) on `feature/qa-wave9`.
Environment: local Supabase `service-center`, 111/111 migrations (latest `20261127000900`, **no reset**; waves 1–8 fixtures still present). API :4000 with simulated email/push, served from the sibling `wave8-review` worktree at `a7dcb74` — no code difference from `9aaeada` (`git diff a7dcb74 9aaeada` empty). Vite web :5173 from this worktree. Node 26.13.1 / npm 11.20.0. iOS: simulator iOS 27.2, Expo Go, agent-owned Metro :8082, driven through an agent-built XCUITest runner (no `Simulator.app` window on this machine). No Android emulator.

Six Sonnet agents ran in parallel via `/qa-wave`, each in its own namespace (`qa-w9-{api,data,rt,web,nat,jrn}-*`, users `*.qaw9.<pkg>@example.test`) and its own port range (4610–4669, 5180, 8082). Only W9-WEB drove a browser (Orca embedded browser, isolated profile), only W9-NATIVE used the simulator, only W9-JRN ran the delivery worker (twice, simulated providers). `:4000` stayed up all wave; no name-based kill of shared processes.

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| W9-RETEST-API — wave 8 resilience/idempotency/webhook/rate-limit defects + review round (QA-16, RES-01) | [retest-api.md](retest-api.md) | 86 rows (each bundles several injected cases) | 82 | 1 | 3 NOT_RUN |
| W9-RETEST-DATA — truncation/paging at >1,000 rows, roster decision API half (QA-16, PERF-01) | [retest-data.md](retest-data.md) | 303 | 275 | 20 (4 defects) | 7 INFO (measure-only), 1 N/A |
| W9-RT — Realtime revocation, per-resource keys, Storage leg of session liveness | [realtime.md](realtime.md) | 535 + 79 baseline script checks | 533 + 79 | 1 | 1 N/A (ADR 0005 signed-URL residual) |
| W9-WEB — browser retests, People paging, plan chat, error states, menu Tab-close | [web-ux.md](web-ux.md) | 51 | 45 | 5 (3 defects) | 1 N/A |
| W9-NATIVE — iOS retests, People paging, wave 8 NOT_RUN MOB rows | [native.md](native.md) | 32 | 25 | 3 | 1 BLOCKED (real SMS send), 3 NOT_RUN (Android, MOB-026 document picker/scan/cancel, compose phone-visibility) |
| QA-16 — JOURNEY-01…07 + coverage reconciliation | [journeys.md](journeys.md) | 337 | 312 | 5 (1 defect) | 19 NOT_RUN (browser/simulator/device halves; API halves PASS), 1 N/A |

Suites at `9aaeada` (coordinator): `bash supabase/tests/run-all.sh` 60/60 PASS; `npm run typecheck` clean; `npm run test` 1,689 PASS / 0 FAIL (651 / 505 / 55 / 406 / 72).

## P0 status

**One P0 — W9-JRN-D1, confirmed by the coordinator.** Same tenant only; no cross-tenant read or write, no unauthorized write, lost write or overfill anywhere in the wave.

| ID | Summary | Verification |
|---|---|---|
| W9-JRN-D1 | A member's private per-time decline reason (`assignment_time_responses.response_note`, written by the snapshot answer flow the mobile app uses) is readable by **every active member of the organization**, including one with no team and no assignment — via `GET /plans/:id` (`assignments[].time_responses[]`) and PostgREST. The plan (§1 priority table: "private/prepared data" = P0; RESP-02 "private reason") keeps it to the assignee, response owner and schedulers, as `assignment_time_response_history` and `assignment_responses` already do | Reproduced with the caller's JWT claims under RLS: viewer (active member, no team/assignment) reads 1 note from `assignment_time_responses`, 0 rows from `assignment_time_response_history`. Policy `assignment_time_responses_select` = "any assignment you can read" (`supabase/migrations/20261017000300_mob005_identity_times_snapshots.sql:1467-1470`, restated `20261122000200_perf_assignment_access.sql:95-97`); API forwards `*` (`backend/src/services/plans.ts:51`, also `routes/assignments.ts:425,483`, `services/assignment-responses.ts:157`) |

Fix direction: keep the per-time status visible to roster readers but move `response_note` behind the history policy (assignee / response owner / `can_schedule_assignment`) — e.g. a private column split or a security-barrier view — and select explicit columns in the API instead of `*`. SQL test with a no-team member.

## Retests (wave 8)

| Defect | Result |
|---|---|
| W8-RES-D1…D7, W8-RT-D1/D2, W8-INT-D1…D4, W8-PERF-D1, review-round error/ACL items | PASS (API, dev and `NODE_ENV=production`; 72 Retry-After × attempt combinations within ±10%; 121 song inputs Zod = DB CHECK) |
| W8-PERF-D2, W8-PERF-D3, People paging/search/cursors, lists past 1,000 (teams, service types, folders, songbooks, access members) | PASS — except team members inside a team and scope access (W9-DATA-D1/D2) |
| W8-INT-D5, per-resource Realtime revocation (21 triggers), key pinned to church, org delete | PASS (rekey 200–300 ms; global sign-out: 0 pokes over 17 s, was 839 s) |
| W7-JRN-D3 Storage HTTP leg (BLOCKED in wave 8) | PASS — old token can no longer read/list/upload/sign a private object after global sign-out |
| W8-WEB-D1, People page web, plan chat web, conversations UI paging, 401/503/504 handling, menu Tab-close (NOT_RUN in wave 8) | PASS |
| W8-NAT-D1 | Adults/children PASS; archived member still "Unknown" → W9-NAT-D1 / W9-WEB-D1 |
| W8-NAT-D2 | Replacement + attendance buttons PASS; Decline sheet under the tab bar still FAIL → W9-NAT-D2 |
| W8-NAT-D3 | PASS |
| Wave 8 native NOT_RUN: MOB-006/007, MOB-013, MOB-015, MOB-018 (handoff), MOB-026 (photo), MOB-032 | PASS |

## Fix now — P1

Every P1 was reproduced by the coordinator against the live API.

| ID | Summary | Decision |
|---|---|---|
| W9-DATA-D1 | A team with >1,000 memberships returns 1,000 members silently from `GET /teams` and `GET /teams/:id` (PostgREST caps the embedded `memberships` too). Live: Team 0001 has 1,108 rows in DB, API returns 1,000. `backend/src/routes/teams.ts:30-34` | Accepted. Load memberships with `fetchAllPages` instead of the embed (as `team_roster_people` already does). Realistic sizes are far below 1,000, so P1 only for consistency with W8-PERF-D2 |
| W9-DATA-D2 | Scope access endpoints (`/teams/:id/access`, `/service-types/:id/access`, `/access/organization`) return 502 above ~210 grantees; `PUT` commits the grants and still answers 502. Live: `/access/organization` with 1,101 grants → 502 `upstream_error`. Unchunked `.in('id', ids)` profile lookup, `backend/src/services/access.ts:119-124` | Accepted. Use `inChunks` for the profile lookup; audit the other unchunked `.in()` calls listed in retest-data.md |

## Fix now — P2

- **Lists:** W9-DATA-D3 `GET /calendar` 502 above ~205 plans in the window (same unchunked `.in()`, `backend/src/routes/calendar.ts:56`); W9-DATA-D4 `GET /schedule/mine` silently 1,000 of 1,020 entries (`backend/src/routes/assignments.ts:456`) — page or report truncation (overlaps deferred W8-PERF-D5).
- **Roster:** W9-WEB-D1 = W9-NAT-D1 — an archived person on a team still shows as an "Unknown" row and is counted in the header: `shapeTeam` keeps every membership and sets `profile: null` when `team_roster_people` hides the person (`backend/src/routes/teams.ts:53-61`). Drop members with no roster row (or return a flag) — one backend fix covers web and mobile.
- **Idempotency:** W9-API-D1 `POST /plans/:id/duplicate` same key + different `service_date` → 201 replaying the first copy instead of 409; `request_hash` stored NULL for duplicates (`20261127000004_w8_plan_create_idempotency_hash.sql`, `claim_plan_copy_key`).
- **Realtime hardening:** W9-RT-D1 `private.can_receive_resource_poke` does not call `private.session_live()` — a signed-out token can still join a topic if it already holds valid keys (needs a separately leaked key; `20261127000700_w8_realtime_resource_revocation.sql:373-420`).
- **Web error states:** W9-WEB-D2 a failed list request (503/504/offline) on `/people` and `/plans` shows the empty state ("Nobody here yet" / "No plans yet") beside the error, with no Retry (`PeoplePage.tsx:148-251`, `PlansPage.tsx:182-204`).
- **Double-submit delete:** W9-WEB-D3 position delete twice shows "Position not found"; plan and song deletes send two requests (second hidden by navigation). Known follow-up from the wave 8 review round — disable while pending.
- **Native:** W9-NAT-D2 (= W8-NAT-D2b) Decline sheet Cancel/Decline on the lower assignment card sit under the tab bar until scrolled (`mobile/src/components/AssignmentResponses.tsx` ~363); W9-NAT-D3 mobile People search shows "Search by name" to owner and member — the role-specific strings exist but only web uses them (`mobile/app/people/index.tsx:122`).

## Fix round (2026-11-21) — branch `feature/qa-wave9-fixes`

Four Opus agents (medium effort), one worktree and branch each, merged with `--no-ff`: `fix-db` (`4c807c4`), `fix-privacy` (`9002f35`), `fix-lists` (`77529bb`), `fix-ui` (`b8a8889`). One conflict in `backend/src/services/plans.ts` (plan-detail people lookup: chunked `.in()` from `fix-lists` + shared `assignmentIds` for the notes RPC from `fix-privacy`) resolved by keeping both. Migrations `20261128000000`–`20261128000200` applied to the local stack with `supabase migration up` (114/114, **no reset**).

| ID | Fix | Where | Live re-verification (API from this worktree on :4100) |
|---|---|---|---|
| W9-JRN-D1 (P0) | `response_note` column privilege revoked from `anon`/`authenticated` (other columns still readable, `select *` refused); notes served only by SECURITY DEFINER RPC `assignment_time_response_notes(uuid[])` to the assignee, response owner or a scheduler who is an active member; API selects named columns and fills the note from the RPC (`null` otherwise). Snapshot commit still writes it; token/preview review reads it via service role (recipient only) | `20261128000000_w9_time_response_note_privacy.sql`; `backend/src/services/time-response-notes.ts`, `model/time-response.model.ts`, `services/plans.ts`, `routes/assignments.ts`, `services/assignment-responses.ts`; `supabase/tests/qa-wave9-time-response-privacy.sql` | `GET /plans/:id` note: viewer / mem2 / candA → `null`; assignee, owner, planner → the reason; other-org owner 403. PostgREST `select=response_note` → 403 for every caller; `select=status` still 200 for roster readers; RPC returns `[]` to the outsiders |
| W9-DATA-D1 (P1) | Team memberships loaded with `fetchAllPages` (per team on `/teams/:id`, org-wide grouped on `/teams`) instead of the capped embed | `backend/src/routes/teams.ts` | Team 0001: 1,107 members (= non-archived memberships in DB) on both routes, for owner and member |
| W9-DATA-D2 (P1) | `withNames` profile lookup chunked; grants paged; PUT re-reads saved grants paged | `backend/src/services/access.ts` | `GET /access/organization` 200 with 1,101 named grants (was 502) |
| W9-DATA-D3 | Plan times paged, request lookup chunked | `backend/src/routes/calendar.ts` | 1,410 events, 200 |
| W9-DATA-D4 | `/schedule/mine` paged on assignment id, same shape and order | `backend/src/routes/assignments.ts` | 1,020 / 1,020 |
| W9-WEB-D1 = W9-NAT-D1 | `shapeTeam` drops memberships the roster RPC hides (archived) for every caller | `backend/src/routes/teams.ts` | 0 "Unknown" rows (owner and member) |
| W9-API-D1 | `duplicate_plan` and `import_plan_contents` hash their request and pass it to `claim_plan_copy_key` (grants unchanged); import key reuse now 409 `idempotency_key_reused` (was `plan_revision_stale`). Copies made before the migration have no hash and still replay | `20261128000200_w9_plan_copy_key_hash.sql`, `backend/src/services/plans.ts`, `plans-copy-idempotency.test.ts` | Duplicate: first 201, same body 201 same id, different body 409 `idempotency_key_reused` (test plans deleted) |
| W9-RT-D1 | `private.can_receive_resource_poke` (the only function behind the `realtime.messages` policy) checks `private.session_live()` first | `20261128000100_w9_realtime_session_live.sql`, `supabase/tests/qa-wave9-db-fixes.sql` | W9-RT `sess.mjs` rerun: signed-out token joining the current topic → `TIMED_OUT` (was `SUBSCRIBED`); both wave 8 Realtime e2e scripts pass |
| W9-WEB-D2 | Shared `ListErrorNotice` / `listFailed`: a failed first load shows the error + "Try again", no empty state; loaded rows stay on a later failure. People, Plans, Teams, Songs, My schedule, Chat, Songbooks, Templates (+ Retry on Messages, Media); mobile People/Teams get Retry | `frontend/src/components/ui.tsx` + pages; `mobile/app/people`, `teams` | Unit tests only — **browser check pending** |
| W9-WEB-D3 | Delete control disabled while pending, second confirm ignored: positions, plans, songs, arrangements, folders, tag groups (matrix views / service types have no web delete; mobile has no deletes for these) | frontend pages | Unit tests only — **browser check pending** |
| W9-NAT-D2 | Decline/withdraw review is a full-screen bottom sheet above the tab bar, safe-area and keyboard aware, not dismissible while sending | `mobile/src/components/AssignmentResponses.tsx` | **Simulator check pending** (incl. VoiceOver, keyboard) |
| W9-NAT-D3 | Mobile People uses the web's owner / member search hints | `mobile/src/lib/directory.ts`, `mobile/app/people/index.tsx` | Unit test only — **simulator check pending** |

Also chunked/paged by the `.in()` audit: release preview and release, delivery `eligibleAssignments`, plan-detail people, `describeImpact`, reminder history, opportunity claimants, availability reviews, staffing-matrix memberships/assignments/people, staffing-proposal memberships/assignments, availability recipients. Left as is: lists bounded by schema or query limits (≤50 requests, ≤12 plans, ≤20 teams), single-user lookups, team/position embeds.

Validation on the merged branch: `npm run typecheck` clean; `npm run test` 1,711 passed (651 / 522 / 59 / 407 / 72); `i18n:check` OK; `supabase/tests/run-all.sh` 62/62 with the migrations applied.

Deploy order: **migration `20261128000000` and the backend go together** — old backend code on the migrated DB fails `GET /plans/:id` (`select *` on the table is refused → 403; observed on the old-code API at :4000 after `migration up`), and the new backend on an unmigrated DB fails on the missing RPC. Clients need no release for the P0.

### Plans read-path regression (W9-PLANS-GET, after the fix round)

Sonnet agent against the fixed API (:4100) and a private Vite pointed at it — [plans-get.md](plans-get.md): 385 rows, **379 PASS**, 1 FAIL, 5 N/A. `GET /plans` (every role, anonymous, missing/foreign/malformed org header, paging both orders), `GET /plans/:id` (shape vs DB, 404 on unknown/other-org ids, prepared requests hidden from members), `/plans/:id/schedule`, `/schedule/mine`, PostgREST and the notes RPC: decline reason only for assignee / response owner / schedulers, `null` for viewer, teammate, candidate, child-linked person and the other team's leader; `select=response_note` and `select=*` 403 for every actor; 170-assignee plan returns all 170 people and notes only to schedulers. Web list/detail render for owner and member; forced 503 on the list shows the error + "Try again" (no "No plans yet") and recovers — W9-WEB-D2 verified in the browser for Plans.

- **W9-PLN-D1 (P2, pre-existing, open):** `GET /plans?page=99999999999999999999` → 500; `page=1e21` returns page 1 labelled 1e+21. `paginationSchema.page` has no upper bound (`packages/shared/src/schemas/common.ts:44`, used at `backend/src/routes/plans.ts:88`). Fix: cap `page` (e.g. `.max(100_000)`) or reject unsafe integers.
- Observation: draft and archived plans are visible to every active member (`plans_select` = any org member) — product to confirm.
- Not covered: web fault injection for the member role and the detail page; mid-session grant revocation.

Open: `PUT …/access` still rejects more than 500 grants (`replaceScopeGrantsSchema`), so an org-scope set of 1,101 grants cannot be saved back as one set — product limit, left unchanged.

## Product decisions needed

- W9-JRN-O1: a deactivated member keeps direct PostgREST read of their **own** linked-Person rows (assignments, request snapshots, their membership row) until unlinked — documented design (`20261122000200_perf_assignment_access.sql:6-8`); every API route and other members' data are closed. Confirm acceptable.
- W9-JRN-O2: file/note audience "leaders" means plan leaders/editors; a team-scoped scheduler is not included (404). Consistent with the oracle; UX copy may need to say so.
- W9-JRN-O3: Live control needs plan-level capability; a team-scoped scheduler gets 403.
- Other observations (O4 replacement events emit no notification — documented gap; O5 one notification row per assignment by design; O6 signed URLs live until short expiry) — no action.

## Deferred

- W8-PERF-D4 per-command RLS policy split (songs list latency re-measured in retest-data.md, INFO), W8-PERF-D5 `/schedule/mine` size (now also W9-DATA-D4) and `/calendar` window, W8-PERF-D6 sequential matrix conflict chunks — unchanged, own perf task.
- Informational from W9-API: faulted reads take ~7 s to answer 503 because postgrest-js retries idempotent reads (writes are single-attempt).

## Not covered (next wave)

- **Fix round + retest** of W9-JRN-D1 (P0), W9-DATA-D1/D2 (P1) and the P2 list above.
- **Never covered** (QA-16 reconciliation, journeys.md): PEOPLE-02, PEOPLE-04, I18N-01, I18N-02, MOB-001, MOB-002, MOB-024, MOB-025, MOB-027, MOB-030, MOB-033 (runnable locally — next wave), and REHEARSE-02, OFFLINE-01, OFFLINE-02, SCAN-01, NATIVE-01, NATIVE-02 (QA-14 physical devices).
- The reconciliation lists 54 case IDs whose latest recorded status is still FAIL from waves 2/3/7 although the defects were fixed later — its disposition column is a heuristic, not retest evidence. Next wave: re-run those case IDs (or confirm via the fix-round retests) so the latest status is evidence-based.
- **QA-14** physical devices (push, widgets, universal links, background audio, offline cold launch, real SMS) and **Android** — still blocked by hardware.
- Native NOT_RUN: MOB-026 document picker / scan / cancel paths, compose phone-visibility row.
- W9-API NOT_RUN: private-address webhook rejection with a configured `INTEGRATION_SECRET_KEY`, the real 60 s Storage timeout, plan-position and songbook double-delete.
- Scoped (team / service-type) schedulers' report scope at volume.
- Real email/push providers and webhooks over TLS; Postgres/PostgREST restart scenarios.

## Environment / process findings

- The shared :4000 came from another worktree's session; reusing it was safe only because its code equalled the frozen commit. Next wave: start the API from the wave's own worktree when :4000 is free.
- No `Simulator.app` window is available to `orca computer` on this machine; W9-NATIVE built an XCUITest runner in its scratchpad (uninstalled afterwards). Worth keeping as a reusable harness.
- W9-NATIVE used `pkill -f` once on its own dead `xcodebuild` command line (nothing shared affected) — briefs should keep forbidding name-based kills.
- W9-JRN replaced a guest's respond-token hash with the hash of a known token (setup only) because `DELIVERY_LINK_SECRET` raw tokens are not recoverable.

## Fixtures left in place

- Orgs `qa-w9-{api,data,rt,web,nat,jrn}-*` and users `*.qaw9.<pkg>@example.test`; credentials only in agent scratchpads (session-local).
- `qa-w9-data-a`: 2,283 people, Team 0001 with 1,108 memberships, ~4,400 access grants (1,101 org / 2,200 team / 1,100 service-type), 1,020+ assignments for one member, >110 conversations.
- `qa-w9-web-*`: 83 people incl. a long Thai name, 121 conversations, an archived team member.
- `qa-w9-rt-{a,b,c}`: users and orgs; per-scenario fixtures deleted; one Storage object may remain as an orphan.
- `qa-w9-jrn-*`: 49 simulated deliveries completed, 2 report exports ready; guest respond token (setup hash) and journey plans/assignments/answers; Live occurrences.
- `qa-w9-nat-*`: native fixture pair; simulator booted, signed out, Light, text size Large. Metro, proxies, private API instances and the web QA browser profile stopped/deleted.
- Wave 7 leftover still to drop before any schema diff: `public.qa_resp_seq`.
