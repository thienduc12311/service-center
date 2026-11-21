# QA wave 7 — summary (2026-11-20)

Plan: [admin and mobile test plan](../../../plans/admin-mobile-test-plan.md). Commit `473fb69` (= `main`, includes everything merged since wave 6: Response module / `respond_as_self`, assignment-access sets, org-context RPC, private Realtime broadcasts, non-blocking chat send, @ mentions, notification clean-up/retention, owner team deletion, free-form items, wave 6 fixes) on `feature/qa-wave7`.
Environment: local Supabase `service-center` (84/84 migrations — `20261123000000_respond_as_self` and `20261124000000_notification_retention` applied with `supabase migration up`, **no reset**; wave 1–3 fixtures still present), API :4000 with simulated email/push (empty `RESEND_API_KEY`/`EXPO_ACCESS_TOKEN`, no `CRON_SECRET`, no `INTEGRATION_SECRET_KEY`), Vite web :5173, Node 26.13.1 / npm 11.20.0, Supabase CLI 3.2.0. iOS: iPhone 18 Pro simulator, iOS 27.2, Expo Go 57.0.9, agent-owned Metro :8082.

Six Sonnet agents ran in parallel via `/qa-wave`, each in its own namespace (`qa-20261120-{resp,msg,acc,jrn,web,nat,sync}-*`). Only W7-WEB drove a browser (Orca embedded browser, isolated profile); only W7-NATIVE used the simulator; only QA-16 ran the delivery worker.

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| W7-R1 responses / `respond_as_self` / assignment access (QA-05/06 subset) | [responses.md](responses.md) | 447 | 432 | 14 | 1 N/A; web/native/worker/seed-dependent SQL NOT_RUN (8 groups). ~256 real concurrent race iterations |
| W7-R2 chat, mentions, notifications, private Realtime (QA-08 subset) | [messaging.md](messaging.md) | 464 | 419 | 27 | 2 BLOCKED, 14 NOT_RUN, 2 N/A |
| W7-R3 org context, tenant isolation, team deletion, free-form items, SEC-01/02 (QA-01/02/15 subset) | [access-security.md](access-security.md) | 1101 | 1077 | 22 | 2 N/A; 9 NOT_RUN groups |
| QA-16 acceptance journeys 01–07 (API) | [journeys.md](journeys.md) | 304 steps | 285 | 4 | 14 NOT_RUN, 1 N/A. 01/02/03/07 PASS (API), 04/05/06 partial |
| W7-WEB browser UI, retests, SYNC-01 web half + reload | [web-ux.md](web-ux.md) | 70 | 64 | 6 | — |
| QA-13 native iOS (continuation) + SYNC-01 native half | [native.md](native.md) | 34 | 28 | 1 | 4 NOT_RUN, 1 N/A |

Cross-client handoff: [sync-handoff.md](sync-handoff.md).

## P0

**W7-ACC-D1 — OPEN, confirmed by coordinator.** An organization admin can insert any authenticated user into `organization_members` with any role, including `owner`, through PostgREST using the admin's own JWT (also a user from another tenant, without consent/invite). The new owner immediately holds full access including private People data. Coordinator repro (rolled-back transaction, `role authenticated`, admin `sub` of `qa-20261120-acc-a`): `insert … role='owner'` → `owner|active`. Cause: `members_insert` (`supabase/migrations/20260101000100_rls.sql:110`) checks only `is_org_admin()`; the owner-only restrictive policies added in `20261109000000_owner_people_permissions.sql:107-111` cover UPDATE and DELETE but not INSERT. Must be fixed before release.

No other P0: no cross-tenant read, no prepared-assignment exposure, no lost write and no overfill across ~2,400 cases and all race runs. The new `my_org_context` RPC returned the same capabilities as `my_effective_access` for 8/8 roles. Revocation (deactivate, grant revoke, demotion, delete, ban, sign-out, API key revoke) was denied on the very next API request. Private Realtime topics rejected other-org, inactive, child and anon subscribers, and pokes carry only id + event.

## Fix now — P1

| ID | Summary | Decision |
|---|---|---|
| W7-ACC-D1 (P0) | Admin → owner escalation via `organization_members` INSERT | Accepted, confirmed. Add a restrictive INSERT policy: only owners may insert `owner`/`admin` rows (or only owners may insert at all, matching update/delete), with a DB test |
| W7-ACC-D3 = W7-WEB-D2 | Team deletion is owner-only in the UI, but `DELETE /teams/:id` + `teams_delete` RLS allow anyone with `teams.manage` (admin, legacy scheduler, grantees). Cascades to every assignment of the team incl. released/confirmed, no audit row | Accepted, confirmed against `teams_delete` policy and `TeamsPage.tsx:23`. **Decided (2026-11-20):** keep API/RLS (`teams.manage`); open the web UI to `teams.manage` holders |
| W7-MSG-D1 (was W3-MSG-D3) | Notification `next_cursor` carries `+00:00`; `before` uses `z.string().datetime()` without `offset: true`, so page 2 of the feed is always 422 | Accepted, confirmed (`packages/shared/src/schemas/notification.ts:21`; schema rejects `…+00:00`, accepts `…Z`) |

## Fix now — P2

- **500s on hostile input:** W7-ACC-D5 / W7-MSG-D11 (NUL byte / lone surrogate → 500 with raw Postgres code), W7-ACC-D6 / W7-RESP-D3 (malformed or primitive JSON → 500 with parser message, incl. public respond link), W7-ACC-D9 (disallowed CORS origin → 500). One error-mapping fix covers most.
- **Silent 204 deletes:** W7-RESP-D1 (`DELETE /assignments/:id`), W7-ACC-D4 (`DELETE /teams/:id`, positions) return 204 for cross-org, missing and RLS-denied ids.
- **Responses:** W7-RESP-D2 (member's direct PostgREST status PATCH writes history but queues no scheduler effect), W7-RESP-D4 (identical concurrent retry → 409, carries W2-RESP-D3), W7-RESP-D5 (`/schedule/mine` 500 "URI too long" at ~200 assignments), ~~W7-RESP-D6~~ (confirmed answer survives a time change — **decided: confirmation stands, not a defect**), W2-RESP-D4 still open (preview shows times the respond call rejects as stale).
- **Messaging (wave 3 carry-overs, all still open):** W7-MSG-D2 conversation writes ignore `X-Organization-Id`; D3 keyset ties drop rows; **D4 notification snippets outlive access loss / delete / moderation (escalation candidate)**; D5 own notification title/body/type writable via PostgREST; D6 recipients read sender audit columns; D7 unauthorized template edit → 409; D8 archived template usable; D9 `/messages` has no cursor; D10 wrong-item comment edit mutates then 404s.
- **Access/security:** W7-ACC-D2 admin `PATCH /access/members` → misleading 404 (route `requireAdmin` vs owner-only RLS); D7 Storage signed URLs live 300 s after revoke/delete; D8 org-logo SVG with script served without CSP/nosniff; D10 upper-case `X-Organization-Id` → 403.
- **Journeys:** W7-JRN-D1 participation report missing `unknown` total (= W3-LIVE-D3); D2 combined schedule omits released assignment on a plan with no times; D3 globally signed-out JWT still reads PostgREST until `jwt_expiry` (3600 s) — API rejects it; D4 transposed ChordPro keeps old `{key:}` directive.
- **Web:** W7-WEB-D1 shared `Menu` (`ui.tsx:755`, Teams “More”, plan Actions) lacks the APG keyboard pattern fixed for language/account menus; D3 `a.__init__` renders as italic `init` (`message-format.ts:105`); D4 item length `99:99` accepted (`dates.ts:92`).
- **Native:** W7-NAT-D1 notifications screen says “All caught up” above unread rows until the 60 s poll (`mobile/app/notifications.tsx:128`); W7-NAT-D2 = W7-WEB-D5 moving the service time leaves the plan header (native) and Plans list/Dashboard (web) on the old time (`backend/src/routes/plans.ts`, `service_date` not updated when `times` change).

## Retests

| Defect | Result |
|---|---|
| W6-NATIVE-D1 iOS login input names | PASS (AX labels “Email”/“Password”) |
| W6-UX-D1 / W6-UX-D2 language / account menu keyboard | PASS |
| W4-I18N-D1 Vietnamese plurals | PASS in the browser (0/1/many on Songs, Plans, bell) |
| W5-UX-D1 / D2 | PASS |
| Wave 1 API-D1…D6 | PASS |
| Wave 2 W2-RESP-D1/D2/D5, people_directory write fix, W2-AVAIL-D3 | PASS |
| Wave 2 W2-RESP-D3, W2-RESP-D4 | Still FAIL (→ W7-RESP-D4; D4 unchanged) |
| Wave 3 messaging W3-MSG-D1…D10 | Still FAIL (→ W7-MSG-D1…D10) |
| Wave 3 W3-LIVE-D3 | Still FAIL (→ W7-JRN-D1) |

## SYNC-01

Web-created (scheduler, web UI) → native read → native edits (time, header rename, note, member accept) → persisted with exactly one row each and monotonic revisions (content 3→4→5, note rev 2, staffing 3→4). A concurrent API edit between native load and save was refused on native (“Someone else changed this plan…”), no silent overwrite. Web reload verification (fresh profile, scheduler): time, header, note, confirmed assignment and the refused concurrent edit all render as persisted — 5 PASS. 1 FAIL: the Plans list and Dashboard still show the old time because `plans.service_date` is not updated (W7-WEB-D5, same root cause as W7-NAT-D2).

## Deferred

- W7-RESP-D6 closed by decision (a confirmation stands after a time change). W7-ACC-D3 decided: UI opens to `teams.manage`.
- Source vs plan: a respond-only delegation also lets the delegate view the person's schedule (plan oracle says permissions are independent); `can_signup` delegation has no consumer (N/A). Record or change the oracle.
- Replacement offer/consent/approval sends no notifications (documented F08 gap).

## Not covered (next wave)

- **RES-01** fault injection (4xx/5xx/timeouts/provider failure/lost reply) incl. chat failed-send retry on native and delivery-failure injection; **PERF-01** p50/p95 with D17 volumes.
- **QA-14** physical devices (push, widgets, universal links, background audio, offline cold launch) — still blocked on signed builds and devices.
- QA-13 remainder: denied-actor variants for MOB-004/005, MOB-019 non-participant, scheduler plan paging, the rest of §6 matrix, Android.
- Webhooks in JOURNEY-07 (needs `INTEGRATION_SECRET_KEY` on :4000); real-provider delivery (no keys); `signups` message audience; Realtime token-expiry re-evaluation; global rate-limit exhaustion (limiter shared at 10,000/min); folder-scoped inheritance; seed-dependent SQL suites (`assignment-response-history.sql` mutates riverside rows).
- Web UI steps of R1/R2/R3/journeys outside W7-WEB's list.

## Fixtures left in place

- Orgs `qa-20261120-{resp,msg,acc,jrn,web,nat}-{a,b}` and `qa-20261120-sync-a`, users `*.qa20261120.<pkg>@example.test`. Credentials only in agent scratchpads (session-local).
- Sequence **`public.qa_resp_seq`** created by W7-R1 for its scripts — drop it (`drop sequence public.qa_resp_seq;`) before any schema diff.
- 15 future reminder jobs `scheduled` in `qa-20261120-jrn-a`. Delivery worker run 1 by QA-16 also processed 34 pending deliveries from other namespaces (incl. riverside) — simulated, none sent.
- All QA-16 publications, set-list links, scoped feeds, API key and push token revoked; personal feed tokens revoked by SQL.
- Simulator left booted, signed out, appearance/text size restored, Metro :8082 stopped. Web QA browser profile deleted.

### Fixed

Branch `feature/qa-wave7-fixes` (merges of `feature/qa-wave7-fixes-{ui,api,db}` + `422b5bb`). Migrations `20261125000000`–`20261125000004` applied with `supabase migration up` (no reset). Typecheck clean; workspace tests 599 + 393 + 49 + 395 + 72 PASS; `i18n:check` OK; new SQL suite `supabase/tests/qa-wave7-fixes.sql` and `qa-wave7-concurrent-respond.sh` PASS (7 older SQL suites — f08, f10, f11, f14, f15, i18n-preferred-language, member-avatars — fail identically without these changes: seed drift, not regressions). P0/P1 and the API-surface fixes were re-verified against the live API :4000 with each caller's own token (15/15 PASS); the remaining items are verified by their unit/SQL tests.

| ID | Fix | Where |
|---|---|---|
| **W7-ACC-D1 (P0)** | Restrictive INSERT policy: only an owner may insert `organization_members` rows directly; invitations, church creation, join approval and platform access go through security-definer functions. Live: admin insert of owner/admin/member → 403 42501; owner insert → 201 | `20261125000000_w7_member_insert_owner_only.sql` |
| W7-ACC-D3 / W7-WEB-D2 (P1) | Decision: API/RLS stay on `teams.manage`; web Delete shown to `teams.manage` holders for the team's service-type/org scope | `frontend/src/pages/TeamsPage.tsx` |
| W7-MSG-D1 (P1) | Keyset cursor accepts offsets; compound `<created_at>~<id>` cursor (plain timestamp still accepted). Live: page 2 → 200 | `packages/shared/src/lib/keyset.ts`, `schemas/notification.ts` |
| W7-MSG-D3 | Notifications, chat and item comments page on (created_at, id), no tie loss | `backend/src/services/*`, `keyset.ts` |
| W7-ACC-D2 | Access-mode PATCH is owner-only (403); web shows the mode read-only for admins | `backend/src/routes/access.ts`, `MemberAccessPanel.tsx` |
| W7-ACC-D5/D6/D9/D10, W7-RESP-D3, W7-MSG-D11 | Malformed JSON → 400, oversize → 413, NUL/lone surrogate → 422 (+ 22P05/22021/PGRST102 mapping), disallowed CORS origin → no CORS headers instead of 500, upper-case org header normalised | `backend/src/app.ts`, `lib/` error mapping |
| W7-RESP-D1, W7-ACC-D4 | DELETE returns 404 when nothing was deleted (`unwrapDeleted`) across assignments, teams, positions, plans, service types, songs, arrangements, folders, people, tag groups, matrix views | `backend/src/routes/*` |
| W7-RESP-D2 | Direct status updates by non-schedulers refused (hint `assignment_response_path`); respond_as_self / link / delegate / snapshot paths unchanged | `20261125000002_w7_assignment_response_paths.sql` |
| W7-RESP-D4 (= W2-RESP-D3) | Identical concurrent answer succeeds with one history row | `20261125000002_w7_assignment_response_paths.sql` |
| W7-RESP-D5 | `/schedule/mine` chunks id lists (100) | `backend/src/routes/assignments.ts` |
| W7-MSG-D2 | Conversation writes check the thread belongs to the active org | `backend/src/services/discussions.ts` |
| W7-MSG-D5 | Users may update only `read_at` on own notifications. Live: title PATCH → 403, read_at → 200 | `20261125000001_w7_notification_read_state_only.sql` |
| W7-MSG-D7 / D8 | Unauthorized template edit → 404; archived template rejected on send (422) | `backend/src/services/messages.ts` |
| W7-MSG-D9 | `GET /messages` accepts a keyset `before` | shared schema + route |
| W7-MSG-D10 | Item-comment edit/delete checks the comment belongs to the item first | `backend/src/routes/*comments*` |
| W7-ACC-D8 | Logo bucket raster-only (png/jpeg/webp/gif); web picker no longer offers SVG | `20261125000004_w7_logo_raster_only.sql`, `SettingsPage.tsx` |
| W7-JRN-D1 (= W3-LIVE-D3) | Participation summary includes `unknown` | `packages/shared/src/lib/reports.ts` |
| W7-JRN-D2 | Combined schedule includes released assignments on plans without times | `20261125000003_w7_combined_schedule_untimed.sql` |
| W7-JRN-D4 | Transposed ChordPro rewrites `{key:}` / `{k:}` | `packages/shared/src/lib/chordpro.ts` |
| W7-NAT-D2 / W7-WEB-D5 | PATCH with `times` sets `service_date` to the earliest time (**follow-up:** second write, not in the times RPC transaction) | `backend/src/routes/plans.ts` |
| W7-WEB-D1 | Shared `Menu` uses `usePopupMenu` (APG keyboard pattern) | `frontend/src/components/ui.tsx` |
| W7-WEB-D3 | Underscore emphasis never intraword or on `__` runs | `packages/shared/src/lib/message-format.ts` |
| W7-WEB-D4 | `parseDuration` rejects `99:99`, `1:75`, `1:2:3:4`, `1:`, `1::2` | `packages/shared/src/lib/dates.ts` |
| W7-NAT-D1 | Notifications header follows the listed rows; bell count refetched on feed change | `mobile/app/notifications.tsx`, `mobile/src/lib/notification-unread.ts` |

### Still open after fixes

- W7-MSG-D6 (recipients read sender audit columns): needs a recipient view/function plus `messages.ts` changes — RLS cannot hide columns.
- W7-MSG-D4 (notification snippets outlive access/delete/moderation) — escalation candidate, not attempted.
- W7-ACC-D7 (signed URLs live 300 s after revoke), W7-JRN-D3 (signed-out JWT valid at PostgREST until expiry) — token-lifetime design, not attempted.
- W2-RESP-D4 (respond-link preview shows times the respond call rejects as stale).
- Atomic `service_date` update (see W7-NAT-D2 row).
- Fixture side effect of retest: owner insert/delete of `newcomer` in `qa-20261120-acc-a` may have left an auto-created Person row.

### Follow-ups (branch `feature/qa-wave7-followups`)

Five parallel fix agents in separate worktrees, merged and re-verified together. Migrations `20261126000000`–`20261126000300` (plus coordinator perf fix `20261126000002`) applied to local Supabase without reset. `npm run typecheck` clean; workspace tests 599 + 401 + 49 + 395 + 72 PASS; `bash supabase/tests/run-all.sh` **52 passed, 0 failed**; live API re-check 24/24 PASS (wave 7 set + follow-ups) with callers' own tokens.

| ID | Fix | Where |
|---|---|---|
| W7-MSG-D6 | Recipients lose SELECT on `operational_messages`; they read through `my_received_messages(org)` (recipient-safe columns only). Live: base-table read `[]`, received list has no audit keys | `20261126000000_w7f_message_recipient_read_path.sql`, `backend/src/services/messages.ts` |
| W7-MSG-D4 | Notification `body` nulled when the message is deleted/hidden; conversation notifications hidden from users who can no longer open the conversation | `20261126000001_w7f_notification_snippet_access.sql` |
| (perf) | The D4 policy ran the conversation check per row (~0.2 ms/row). Now once per statement via a materialized initplan: unread count 22 → 2.8 ms, feed page 21 → 1.2 ms | `20261126000002_w7f_notification_access_once_per_statement.sql` |
| W7-NAT-D2 (atomic) | `plans.service_date` follows the earliest service time via statement-level triggers on `plan_times`, in the same transaction for every write path; second API write removed | `20261126000100_w7f_plan_date_follows_times.sql`, `backend/src/routes/plans.ts` |
| W2-RESP-D4 | Respond-link preview applies the same currency test as respond (`assignment_snapshot_state`): stale 409, expired 410 | `20261126000101_w7f_snapshot_currency.sql`, respond route |
| W7-ACC-D7 | Signed download URLs 300 → 60 s (files, offline packs, report exports), song book 3600 → 120 s; clients already renew | `backend/src/services/files.ts`, `report-exports.ts`, `routes/songbooks.ts`, `docs/operations/session-and-url-lifetimes.md` |
| W7-JRN-D3 | PostgREST pre-request hook + restrictive `storage.objects` policy reject a JWT whose `session_id` no longer exists (~8 µs/request); `jwt_expiry` 3600 → 900. Live: old token after global sign-out → 401 on table and RPC; new session, anon, service role unaffected. Residual: open Realtime socket until expiry | `20261126000200_w7f_session_liveness.sql`, `supabase/config.toml`, `docs/adr/0005-session-liveness-and-token-lifetime.md` |
| New — template/duplicate data loss | Since `people_owner_privacy`, a non-owner scheduler's "save template from plan" lost the roster and "duplicate plan" dropped item leaders (functions read `people` under caller RLS). New `private.plan_active_people(plan)` returns only referenced Person IDs to callers who can edit/schedule the plan | `20261126000300_w7f_copy_without_people_visibility.sql` |
| SQL suites | f08, f10, f11, f14, f15, i18n-preferred-language, member-avatars repaired to be self-contained; `supabase/tests/run-all.sh` runs every suite in begin/rollback | `supabase/tests/` |

Ops notes: `jwt_expiry = 900` needs a local stack restart and the same value on the hosted project. The pre-request hook is set on the `authenticator` role by the migration.
