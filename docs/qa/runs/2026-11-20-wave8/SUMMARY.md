# QA wave 8 — summary (2026-11-20/21)

Plan: [admin and mobile test plan](../../../plans/admin-mobile-test-plan.md). Commit `897e524` (`feature/qa-wave7-fixes` = `main` + wave 7 fixes and follow-ups, PR #119) on `feature/qa-wave8`.
Environment: local Supabase `service-center`, 97/97 migrations (`20261126000400_w7f_review_followups` applied with `supabase migration up`, **no reset**; waves 1–7 fixtures still present). Stack restarted once (data kept) so GoTrue picks up `jwt_expiry = 900`. API :4000 with simulated email/push (empty `RESEND_API_KEY`/`EXPO_ACCESS_TOKEN`, no `CRON_SECRET`/`INTEGRATION_SECRET_KEY`), Vite web :5173, Node 26.13.1 / npm 11.20.0, Supabase CLI 3.2.0. iOS: iPhone 18 Pro simulator, iOS 27.2, Expo Go, agent-owned Metro :8082. No Android emulator on this machine.

Six Sonnet agents ran in parallel via `/qa-wave`, each in its own namespace (`qa-w8-{res,perf,int,rt,web,nat}-{a,b}`, users `*.qaw8.<pkg>@example.test`). Only W8-WEB drove a browser (Orca embedded browser, isolated profile), only W8-NATIVE used the simulator, only W8-INT ran the delivery worker (on private API instances). W8-RES, W8-PERF, W8-INT and W8-NATIVE used private API instances for fault injection, load and worker runs.

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| W8-RES RES-01 fault injection (QA-15) | [resilience.md](resilience.md) | 368 | 114 | 249 | 5 N/A; NOT_RUN groups listed. 249 FAIL rows map to 7 defects (mostly D1 across 21 operations × faults) |
| W8-PERF PERF-01 at D17 volume (QA-15) | [performance.md](performance.md) | 55 | 52 | 3 | native/web timing NOT_RUN |
| W8-INT webhooks, delivery faults, `signups`, Realtime, rate limit, folder inheritance (QA-07/08/12/16 rest) | [integrations.md](integrations.md) | 681 | 666 | 13 | 2 N/A |
| W8-RETEST every wave 7 defect + variants, suites | [retest.md](retest.md) | 497 | 479 | 7 | 1 BLOCKED, 10 NOT_RUN (UI halves → WEB/NATIVE) |
| W8-WEB browser UI, wave 7 web retests, denied actors | [web-ux.md](web-ux.md) | 96 | 91 | 1 | 2 NOT_RUN, 2 N/A |
| W8-NATIVE QA-13 iOS remainder + retests + SYNC-01 song | [native.md](native.md) | ~48 | 36 | 2 | 8 NOT_RUN, 2 N/A; Android NOT_RUN |

Suites at `897e524`: `bash supabase/tests/run-all.sh` 52/52 PASS; `npm run typecheck` clean; `npm run test` 1,520 PASS / 0 FAIL.

## P0 status

**None.** No cross-tenant read or write, prepared/private exposure, unauthorized write, lost write or overfill. Highlights: W7-ACC-D1 (P0) fix holds across 25 variants (every role value, upsert, other org, invite/join paths). Under 12 injected faults × 21 write operations no half-written or lost row; lost replies + same-key retry converge once (except D3/D4 below). All 9 webhook RPCs refuse outsiders; payloads carry ids only; DNS rebinding blocked at send time. Three concurrent delivery workers made exactly one provider call per delivery; ambiguous outcomes never auto-resent; captured locale stable on retry. Folder-scoped inheritance 239/239. Org switch leaves no other-org data in the web cache.

## Retests (wave 7)

| Defect | Result |
|---|---|
| W7-ACC-D1…D10, W7-MSG-D1…D11, W7-RESP-D1…D5, W7-JRN-D1/D2/D4, W2-RESP-D4, template/duplicate data loss | PASS (API/DB; excerpt redaction races held in both lock orders) |
| W7-JRN-D3 session liveness | PASS for PostgREST/RPC; Storage HTTP leg BLOCKED (no reachable private bucket) |
| W7-WEB-D1…D5, W7-ACC-D2/D3/D8, W7-MSG-D1 (UI halves) | PASS in the browser (menu Tab-close NOT_RUN: automation window has no focus) |
| W7-NAT-D1, W7-NAT-D2 | PASS on iOS (one first-bundle D1 failure did not reproduce after a clean Metro rebuild — stale transform) |
| W7-ACC-D4 / W7-RESP-D1 (silent 204) | PASS on all 14 listed routes; 4 routes outside the list still 204 → W8-RT-D2 |
| W3-INT-D8, W3-INT-D7, W3-INT-D6 (never fixed) | Still FAIL → W8-INT-D1, D2, D3 |

## Fix now — P1

Every P1 was checked against source by the coordinator.

| ID | Summary | Decision |
|---|---|---|
| W8-PERF-D2 | Silent truncation at PostgREST `max_rows = 1000`: `GET /people` returns 1,000 of 1,101 (single unpaged select, `backend/src/routes/people.ts:124-125`); schedule/participation report 1,000 of 1,138 rows with `truncated:false` (per-chunk loaders in `backend/src/services/reports.ts` never page inside a chunk; CSV built from the same data). W3-INT-D2 fix incomplete | Accepted, confirmed. Page every loader with `.range()` until short page (shared helper), or page the API; report `truncated` honestly; regression test with >1000 rows |
| W8-PERF-D3 | `GET /conversations` hard-capped at 100, no cursor/flag (`my_conversations` … `limit 100`, `20261115000000_account_deletion_and_user_blocks.sql`) | Accepted, confirmed. Keyset cursor (`last_activity`, id) or honest `has_more` |
| W8-RES-D1 | Unmapped upstream errors → 500 carrying the raw PostgREST/Kong/network message (also `NODE_ENV=production`); expired JWT at PostgREST → 500 not 401 (`backend/src/lib/errors.ts:179` default branch, `error-handler.ts`) | Accepted, confirmed by source. Map PGRST301/JWT codes → 401, 5xx/network → 502/503 with a generic body; log detail server-side only |
| W8-RES-D2 | Auth service outage reported as `401 Invalid or expired session` (`backend/src/middleware/auth.ts:37` treats every `getUser` error as invalid) — clients sign the user out | Accepted, confirmed. Distinguish AuthApiError 401/403 from network/5xx → 503 |
| W8-INT-D1 (= W3-INT-D8) | Webhook retry without `Retry-After` waits ~24 h: `greatest(coalesce(least(p_retry_after_seconds, 86400), 0), backoff)` — `least(NULL, 86400)` is 86400 in Postgres (verified live) | Accepted, confirmed. `case when p_retry_after_seconds is null then 0 else least(…) end` in a new migration + SQL test |

## Fix now — P2

- **Plans PATCH:** W8-RES-D4 times + fields are two writes (times persist, title lost, retry 409) and W8-RT-D1 `service_date` + `times` in one PATCH leaves the date off the earliest time (`backend/src/routes/plans.ts:157-203`) — one fix: single RPC or reject the combination.
- **Idempotency:** W8-RES-D3 note create has no idempotency key (lost reply + retry → duplicate note); W8-RES-D5 `POST /plans` replays a key without comparing the body (cf. W3-FILE-D2); W8-RES-D7 upload-intent replay with Storage signing failure → 200 `upload: null` (`backend/src/services/files.ts:274`).
- **Resilience:** W8-RES-D6 no upstream timeout (35 s upstream delay → 200 after 35 s).
- **Silent 204 deletes (rest):** W8-RT-D2 `DELETE /notifications/:id`, `/me/devices/:token`, `/me/blocks/:userId`, `/people/members/:userId`.
- **Webhooks:** W8-INT-D2 plan created as `published` emits no `plan.published` (trigger on update only); W8-INT-D3 webhook URL `"not a url"` → 500 (`new URL()` throws inside zod `superRefine`).
- **Rate limit:** W8-INT-D4 `trust proxy 1` lets a direct client reset its counter with any `X-Forwarded-For` — set trust proxy to the real hop/allowlist.
- **Data/API contract:** W8-PERF-D1 one song title >200 chars (owner via PostgREST) makes the library list 500 with Zod internals — add DB check constraints matching the shared schemas.
- **UI:** W8-WEB-D1 forced SVG logo upload shows only "Something went wrong" (`frontend/src/pages/SettingsPage.tsx:511`); W8-NAT-D2 "Ask for a replacement" and attendance "Save" missing from the AX tree, Decline sheet button under the tab bar; W8-NAT-D3 "Plan chat" offered to a non-participant → "Conversation not available".

## Product decisions (decided 2026-11-21)

- W8-NAT-D1: native team roster shows "Unknown" for every teammate to a non-owner (`profile: null` from the API, owner-only People privacy). **Decided:** a non-owner viewing a team roster sees each teammate's name and basic information — email, phone and date of birth. Other private People fields stay owner-only. Implemented in `20261127000300_w8_team_roster_basic_info` (`team_roster_people(p_org)`: any active member, all teams in the org; other People fields unchanged).
- W8-INT-D5: a deactivated member's open Realtime socket stays live until token expiry (≤ 900 s); ADR 0005 says that case has no window. **Decided:** close the connection on deactivation (server-enforced, not client-cooperative) and keep ADR 0005's statement true. Same family: after global sign-out an open socket kept receiving 839 s (documented residual of W7-JRN-D3) — covered too if the same mechanism applies.

## Fix round (2026-11-21) — branch `feature/qa-wave8-fixes`

Seven fix branches merged without conflicts: `fix-api`, `fix-db`, `fix-idem`, `fix-ui`, `fix-roster`, `fix-realtime`, `fix-paging`. Migrations `20261127000000`–`20261127000600` applied to the local stack with `supabase migration up` (no reset).

Coordinator follow-ups on the merged branch:
- `20261127000500_w8_people_sort_name` was renamed from `…000200`, which the note idempotency migration already used.
- `20261127000600_w8_realtime_org_delete`: the member-delete key rotation tried to insert a key for an organization being deleted, so **every organization delete failed** (caught by `f02-roster-extensions.sql` and `platform-user-management.sql`). A key is now created only for an existing organization; regression check added to `qa-wave8-realtime-revocation.sql`.
- The `auth.sessions` trigger is created inside a guarded block, so the migration still applies where the migration role lacks TRIGGER on auth tables (sign-out rotation is then unavailable and a warning is raised).
- `qa-wave8-db.sql` Retry-After cap check widened to the ±10% jitter band (failed ~40% of runs).

Product change requested during the round: the People list screens (web `PeoplePage`, mobile `people/index`) page from the server, 25 per page (`GET /people/page`, max 100, keyset on `sort_name, id`, name search server-side, total count removed). `GET /people` still returns the full list for pickers.

Validation on the merged branch:
- `npm run typecheck` clean in every package; `npm run test` 1,621 passed (629 / 466 / 52 / 402 / 72); `i18n:check` OK.
- `supabase/tests/run-all.sh`: 57 passed, 0 failed; `qa-wave8-db.sql` 5/5 runs.
- `qa-wave8-realtime-revocation.e2e.mjs` against live Realtime: all 15 checks pass (removed member's open socket silent and unable to rejoin; remaining member rekeyed in 149 ms; deleted session's socket silent).
- Live API on :4000 (org B with 1,100 temporary people, removed afterwards): `GET /people` 1,101/1,101; `GET /people/page` 45 pages of 25, no loss or duplicates, search past page 1; `GET /conversations` 110/110 over 3 pages; schedule report 1,138/1,138 rows; expired and malformed JWT → 401 `unauthorized`.
- Not verified live: Auth outage → 503 and upstream 5xx/timeout mapping (unit tests only; stopping shared Auth/PostgREST was out of bounds); iOS accessibility and plan-chat visibility (unit tests only, no simulator run).

Open follow-ups (all addressed on `feature/qa-wave8-followups`, 2026-11-21):
- Team roster visibility: **decided — keep as implemented**: any active member sees teammates' name, email, phone and date of birth for every team in the org.
- Plan chat for child participants: `canOpenPlanChat` now mirrors `private.is_adult_person` (`20261026000200_f09_conversations.sql:61-82`) via a new `viewer_is_adult_person` on `GET /plans/:id`; applied on the plan page and the live page, web and mobile.
- Unpaged lists: team members, teams, service-type folders, service types, songbooks (list and `.in()` checks, chunked), access members/grants now page past 1,000 (`lists-paging.test.ts`, 1,101 rows each). The `folders.ts:36` item was a `maybeSingle`, not a list.
- Realtime per-resource revocation (`20261127000700_w8_realtime_resource_revocation`): conversation topics carry a per-conversation key rotated on team removal, assignment deleted/declined/un-released/moved, person archived/unlinked/child, scope moves and team-scoped grant removal; org-wide grant and scope changes rotate the org key. `live_plan`/`live_run` stay on the org key because every active member can read plans (RLS `is_org_member`). Deploy the API before clients: older clients get no conversation pokes and fall back to 60 s refresh.

Follow-up validation: typecheck clean; `npm run test` 1,655 passed; `run-all.sh` 58/58; both Realtime e2e scripts pass against live Realtime and the API on :4000.

Known local test flake (environment, not code): supertest binds an ephemeral port on `::`; when another local app already listens on `127.0.0.1` with the same port (here OpenCode on :52139 answers 407), the request reaches that app and a random backend test fails with 401/404/407. Binding test servers to 127.0.0.1 would remove it.

## Review round (2026-11-21) — branch `feature/qa-wave8-review-fixes`

PR #122 was merged into `feature/qa-wave8-fixes` after #121 had already merged, so the follow-ups never reached `main`; this branch carries them. Three fresh reviewers (database, backend/shared, web/mobile) reviewed #121 + #122; every finding was re-verified against the code before fixing.

Fixed (migrations `20261127000800_w8_review_fixes`, `20261127000900_w8_people_contact_search`):
- P1 Realtime: archiving, unlinking, marking a child or deleting a linked person left chats reached as plan leader / scheduler / manager on the old key — now every conversation the person loses is rekeyed; team membership moves (UPDATE) rekey the old team's chat.
- P1 team rosters: `team_roster_people` read unpaged (cut at 1,000 memberships → "Unknown" again); now paged and per-team for single-team reads.
- Roster privacy: archived people hidden; children show name and avatar only (**coordinator default, product may revisit**).
- Reports: attendance times paged (were cut at 1,000 result rows).
- Supabase timeout no longer retried by postgrest-js (~67 s → 15 s); Auth 408/429 → 503 instead of sign-out; error logs and 23505/23503/23514 responses carry no Postgres `details` (row values); 57014 → 504.
- `GET /conversations` without `cursor`/`limit` returns the legacy array again (installed app builds); new clients call `conversationsPage`.
- People list: compact base64url cursor (long non-Latin names broke "Load more"); owner search matches the login email/phone shown on each row; search symbols match literally; invitations paged.
- Song CHECKs count length like JavaScript (emoji) and cover themes, song types and default key; `claim_plan_copy_key` ACL restored; `update_plan_with_times` writes only sent columns.
- Clients: a failed Realtime join refetches topics with backoff; rekey refetch jittered 0–2 s; key request pinned to its church; role-appropriate search placeholder; misleading chat count removed; Plan chat not offered before the plan loads.

Validation: typecheck clean; `npm run test` all green; `run-all.sh` 60/60; both Realtime e2e scripts pass; live API: People 1,101/1,101 over 45 pages (161-char Thai name included), literal `*` search, legacy and paged conversations 110/110, owner search by login email, schedule report 1,138 rows all with times.

Follow-ups not done: other client delete methods (teams, positions, plans, service types, songs, arrangements, folders, tag groups, matrix views) still surface a 404 on double-submit (behaviour since wave 7).

## Deferred

- W8-PERF-D4 RLS `FOR ALL` write policies evaluated on every SELECT (songs 125 ms vs 2 ms without RLS) — split into per-command policies; needs a careful RLS migration, schedule as its own perf task.
- W8-PERF-D5 `/schedule/mine` unpaged (308 ms p95 / 648 KB at 304 assignments), `/calendar` accepts a 300-year window; W8-PERF-D6 matrix conflict chunks sequential. Proposed budgets in performance.md.
- W8-RT-D3 (informational): PostgREST delete of another user's notification returns 200 `[]` (RLS intact) — PostgREST behaviour, no action.

## Not covered (next wave)

- **QA-14** physical devices (push, widgets, universal links, background audio, offline cold launch) and **Android** (no emulator here) — still blocked.
- Native NOT_RUN: MOB-006/007 date pickers, MOB-013 generate / apply template, MOB-015 reminder edit, MOB-026 files, MOB-018 device-composer send, MOB-032 single-church denied.
- Real email/push providers and webhooks over TLS; Storage HTTP leg of session liveness (needs a private bucket fixture); Postgres/PostgREST restart scenarios; web 5xx/timeout injection in the browser (only offline emulation available); web menu Tab-close; same-key-different-body beyond plan create and item add; native/web render and cold-start timings.

## Environment / process findings

- The shared API :4000 was SIGTERMed once mid-wave by W8-INT's `pkill -f "tsx.*src/index.ts"` (also killed W8-RES's :4601). Restarted by the coordinator within ~1 min; agents were told to retry and to kill only by their own PID. Private-port collisions also occurred (INT on 4603/4604 vs PERF/NATIVE). **Skill change:** give each agent an explicit port range and forbid name-based kills in the brief.
- W8-PERF ran a database-wide `ANALYZE` after seeding.

## Fixtures left in place

- Orgs `qa-w8-{res,perf,int,rt,web,nat}-{a,b}` and users `*.qaw8.<pkg>@example.test`; credentials only in agent scratchpads (session-local).
- `qa-w8-res-a`: ~660 `rs-*` plans with assignments/notes/items/chat/attendance/release batches, 35 small PDF attachments, queued `delivery_effects` (never delivered).
- `qa-w8-perf-a`: 250 people, 125 songs/250 arrangements, 60 plans/900 items, ~1,800 assignments, 1,040+ notifications, 5,330 message recipients, 63 conversations/615 chat messages; `-b`: 110 plans/conversations. Five song titles shortened to 190 chars.
- `qa-w8-int-*`: queued/ambiguous/failed deliveries in provider-failure states (inert — a later simulated worker run delivers them as `simulated`); all 24 webhook endpoints revoked. W8-INT's first global worker run (fake Resend) moved one `qa-w8-res-a` email delivery to `provider_accepted`.
- `qa-w8-web-a`: respond tokens `w8-token-*` set directly in `assignment_notifications` (3-day expiry), delegation member1→member2.
- `qa-w8-nat-*`: delegation grant mem→mem3 active, cross-org combined schedule on, open replacement request.
- Simulator booted, signed out, Light, text size Large (unchanged from start). Metro and all private API instances/proxies/fakes stopped. Web QA browser profile deleted.
- Wave 7 leftover still to drop before any schema diff: `public.qa_resp_seq`.
