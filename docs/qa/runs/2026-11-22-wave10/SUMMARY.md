# QA wave 10 — summary (2026-11-22)

Plan: [admin and mobile test plan](../../../plans/admin-mobile-test-plan.md). Commit `f79aa50` (`main` = wave 9 fixes PR #124, large-list UX #125, CCLI #126, email notifications #127, invitation email #128, security hardening #129) on `feature/qa-wave10`.
Environment: local Supabase `service-center`, 123/123 migrations (latest `20261130000500`, **no reset**; waves 1–9 fixtures still present). API **:4200** and Vite web **:5180** started from this worktree (simulated email/push, `RESEND_API_KEY`/`EXPO_ACCESS_TOKEN` empty) — `:4000`/`:5173`/`:4100` belonged to deleted worktrees running pre-wave-9 code and were not used. Node 26.13.1 / npm 11.20.0. iOS: iPhone 18 Pro simulator, iOS 27.2, Expo Go, agent-owned Metro :8082, XCUITest runner rebuilt in the agent's scratchpad (uninstalled afterwards). No Android.

Six Sonnet agents ran in parallel via `/qa-wave`, each in its own namespace (`qa-w10-{web,nat,sec,mail,cd,fgh}-*`, users `*.qaw10.<pkg>@example.test`) and port range (4610–4669, 5181, 8082). Only W10-WEB drove a browser, only W10-NATIVE used the simulator, only W10-MAIL ran the delivery worker (4 runs, simulated providers; it also turned ~147 of `qa-w10-fgh-a`'s queued deliveries into `simulated` — global worker, expected).

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| W10-WEB — browser retests of the wave 9 fix round, ADR-0006 web, invitations (SEC-002/013), large-list web, PEOPLE-04 / I18N-01 / UX-01 web | [web-ux.md](web-ux.md) | 99 | 83 | 7 (4 defects) | 8 NOT_RUN, 1 N/A |
| W10-NATIVE — W9-NAT-D2/D3, never-covered MOB cases, MOB-020/031 reruns, ADR-0006 + large-list + I18N-01 mobile | [native.md](native.md) | 50 | 40 | 1 | 2 BLOCKED (MOB-033 widget, OS-denied push: need a dev build), 7 NOT_RUN |
| W10-SEC — security hardening since wave 9 + stale SEC-01/02, ACL-01/05 | [security.md](security.md) | 703 | 672 | 18 (5 defects) | 9 NOT_RUN, 1 BLOCKED, 3 N/A |
| W10-MAIL — ADR-0006/0007 email, invitation email, webhooks, NOTIFY-01/HOOK-01 reruns, PEOPLE-02, I18N-02 delivery | [delivery.md](delivery.md) | 287 | 264 | 8 (5 defects) | 14 NOT_RUN, 1 N/A |
| W10-CD — stale FAIL rerun §5B–§5D + ORGS-01, large-list API, PEOPLE-04 API | [stale-cd.md](stale-cd.md) | 316 | 295 | 14 (10 defects) | 4 NOT_RUN, 3 N/A |
| W10-FGH — stale FAIL rerun §5F–§5H + PERF-01, wave 9 NOT_RUN API, scoped report scope at volume, large-list SQL, CCLI | [stale-fgh.md](stale-fgh.md) | 339 | 300 | 19 (10 defects) | 20 NOT_RUN |

Suites at `f79aa50` (coordinator): `npm run typecheck` clean; `npm run test` 1,971 PASS / 0 FAIL (683 / 603 / 153 / 460 / 72).

## P0 status

**No P0.** No cross-tenant read or write, private/prepared exposure, unauthorized write, lost write or overfill anywhere in the wave. W9-JRN-D1 (private decline reason) re-verified fixed through the plan API and PostgREST (W10-CD); W10-WEB tenant spot checks: org B denied/404 on every org A resource.

## Retests

| Item | Result |
|---|---|
| Security hardening (SEC-002, SEC-003, SEC-010, SEC-012, SEC-013, profiles.email identity, profile column grants, chart_font XSS, CSV formula prefixes, From name quoting, ChordPro linear parsing, frontend headers via nginx config, dependency patches) | PASS — every original exploit closed, legitimate path intact, nearby variants (other role, PostgREST, Storage) closed |
| W9-WEB-D2 list error states | 503/504 PASS on 9 pages; **offline** still shows false empty states → W10-WEB-D2 |
| W9-WEB-D3 double-submit delete | PASS (positions, plans, songs, arrangements, folders, tag groups — one DELETE each) |
| W9-NAT-D2 decline sheet, W9-NAT-D3 search hints, mobile People/Teams Retry | PASS (simulator) |
| W9-API NOT_RUN: private-address webhook rejection with `INTEGRATION_SECRET_KEY`, real 60 s Storage timeout, songbook double-delete | PASS (26 destination forms; clean 503 at 60.0 s; one 204 + one 404) |
| Stale latest-FAIL case IDs (54 from the wave 9 reconciliation) | Now PASS: ACL-01, ACL-05, SEC-01, SEC-02, NOTIFY-01, HOOK-01, NOTE-01, CHAT-01, CHAT-02, MEDIA-01, STAGE-01, LIVE-01, LIVE-02, REPORT-01, PERF-01, MOB-020, MOB-031, PEOPLE-01, TEAM-01, ORGS-01, PLAN-01/02 (API), RESP-01…04, AVAIL-01…03, OPPORT-01, REPLACE-01, SWAP-01, STAFF-02, MATRIX-01, PROPOSE-02. **Still FAIL** (carried P2s below): SONG-01, SONG-02, CHART-01, FILE-01, FILE-03, REPORT-02, CAL-02, GATED-01, TIME-02/TEMPLATE-03 (product call), TIME-03, ORDER-03, ORDER-04, TEMPLATE-01, TEMPLATE-02, PROPOSE-01, STAFF-01, REPLACE-02, UX-01 (1024 px order tab) |
| Never covered → now covered | PEOPLE-02, PEOPLE-04, I18N-01 (web + mobile), I18N-02 (delivery half), MOB-001, MOB-002, MOB-024, MOB-025, MOB-027, MOB-030, compose phone-visibility row (FAIL → W10-NAT-D1) |

## Fix now — P1

| ID | Summary | Decision |
|---|---|---|
| W10-MAIL-D4 | Explicit identity **merge** (`POST /people/reconciliations/:id/resolve {"action":"merge"}`) commits — candidate Person deleted, history moved — but answers `400 Invalid identifier or value`; a retry 404s. Coordinator confirmed in source: `resolve_person_reconciliation` deletes the dropped Person, the report row cascades away, the final `update … returning * into v_row` finds nothing, and `nameReconciliations` gets an all-null row → 22P02 (`backend/src/routes/roster.ts:187-190`) | Accepted. Mark the report resolved before deleting (or return the stored row), and handle the merged result in the route; test |

## Fix now — P2

- **Delivery / identity:** W10-MAIL-D1 blank recipient names for non-owners in publish/notify "no address" lists and Settings → Delivery (`backend/src/services/deliveries.ts:36-39`, owner-only `people` embed); W10-MAIL-D2 assignment racing a publish is held instead of sent (`backend/src/routes/assignments.ts:175` decides from the pre-read status); W10-MAIL-D5 a worker run without `INTEGRATION_SECRET_KEY` fails due webhook deliveries permanently and disables endpoints; W10-NAT-D1 `GET /people` returns `phone: null` for people with a login (`backend/src/model/people.ts:73` ignores `person.phone`) so mobile compose finds no numbers; W10-SEC-D4 concurrent accepts of one invitation → losers 502.
- **API hygiene:** W10-SEC-D1 (= W9-PLN-D1) and W10-SEC-D2 unbounded `page` (`/plans` labels 1e+21, `/songs` 500); W10-SEC-D3 request-log redaction is case-sensitive and query-blind (upper-case invitation route logs the token, `?access_token=`, `Referer` in production); W10-FGH-D1 empty song PATCH → 404; W10-FGH-D2 = W10-CD-D6 deleting an in-use song/arrangement → 400 "Referenced record does not exist" (should be 409 in use); W10-FGH-D5 signed PUT still accepted after abandon (orphan object); W10-FGH-D6 link/document idempotency key reused with a different payload replays instead of 409; W10-FGH-D7 own calendar-feed `token_hash` client-writable and a revoked token revivable through PostgREST (own row only).
- **Planning:** W10-CD-D2 date-only / zone-less plan times stored as UTC; W10-CD-D3 `total_length_seconds` counts header lengths; W10-CD-D4 template preview does not warn about an archived song, apply then 400; W10-CD-D8 scoped scheduler 404 on candidates for a team with no service type; W10-CD-D9 proposal accepts lock + exclusion on the same slot; W10-FGH-D3 chart transposition (flat keys spelled sharp, invalid `to` → 200, slash bass dropped).
- **Web:** W10-WEB-D1 People "Join requests" error shown with the empty state, no retry (`JoinRequestsSection.tsx:84-100`); W10-WEB-D2 offline first load/search shows false empty states on 8 pages; W10-WEB-D3 publish dialog keeps "Notify people" unticked after Cancel (`PublishPlanModal.tsx:28`); W2-PLANS-D11 plan Order tab at 1024 px overlaps row actions on titles and clips tabs.

## Product decisions (answered 2026-11-22 — all four go into the fix round)

- W10-CD-D1: time edit / bulk reschedule that double-books a person → **block** (409) unless the caller holds the conflict-override capability (with reason, audited).
- W10-FGH-D9: CSV reports → **add a UTF-8 BOM**.
- W10-FGH-D4: deleting a song used by a songbook → **refuse** (409 in use), like plan references.
- W10-FGH-D8: personal calendar feed → **add revoke without rotate**.

## Deferred

- W10-CD-D5 series generate preview never flags roster conflicts (feature work); W10-CD-D7 fairness picks starve the rotation slot (algorithm); W10-CD-D10 concurrent same-key replacement request 201/409/409 (no duplicate row); W10-FGH-D10 two concurrent plan-position deletes both 204 (row gone, never 500).
- W10-MAIL-D3 linked login's self-service email change refused (SEC-013 holds) with a raw 500 from the Auth trigger — no screen offers this path.
- W10-SEC-D5 `npm audit --omit=dev` 13 advisories incl. `zod@3.25.76` — own dependency task.
- Observation (W10-NATIVE): "Take a photo" in scan crashes Expo Go on a device with no camera (`scan-capture.ts` has no availability check) — probably simulator-only; recheck on device (QA-14).
- Unchanged from wave 9: W8-PERF-D4/D5/D6.

## Not covered (next wave)

- **Fix round + retest** of the P1 and the P2 list above (browser for W10-WEB-D1/D2/D3 + W2-PLANS-D11, simulator for W10-NAT-D1).
- W10-WEB NOT_RUN: replacement-candidate combobox, assignment-times draft copy, Vietnamese publish dialog, unsupported browser locale, a 1024 px sweep of other pages, 1440 px dark sweep.
- W10-NATIVE: MOB-033 widgets and OS-denied push recovery (need a development build — steps in native.md), software-keyboard behaviour (simulator hides the keyboard), document-picker pick path, Android.
- W10-SEC NOT_RUN: hostile chart / accept-invite screens in a browser, Vercel headers live, webhook DNS rebinding, live test-send, super-admin 2FA; BLOCKED raw Storage upload to `attachments` (needs upload intent).
- W10-FGH: export file content / BOM (worker), browser rows.
- **QA-14** physical devices (push, widgets, universal links, background audio, offline cold launch, real SMS), REHEARSE-02, OFFLINE-01/02, SCAN-01, NATIVE-01/02, MOB-033, and Android — still blocked by hardware/dev build.
- Real email/push providers and webhooks over TLS; Postgres/PostgREST restart scenarios; Vietnamese-speaker review (I18N-02).

## Environment / process findings

- Every other worktree's servers on :4000/:5173/:4100 ran from deleted directories with old code; this wave ran its own API/web on :4200/:5180. The worktree also needed `npm install` and `.env` copies (`backend`, `frontend`, `mobile` — mobile API pointed at :4200, local only).
- Shared :4200 has no `CRON_SECRET` or `INTEGRATION_SECRET_KEY`, so delayed mention emails and webhooks needed W10-MAIL's private API (:4620). Simulated sends log only a one-line marker; W10-MAIL captured email content with a fake Resend on :4621.
- W10-NATIVE used one `pkill -P 1 -f` scoped to its own `xcodebuild` command line (nothing shared affected) — briefs keep forbidding name-based kills.

## Fixtures left in place

- Orgs `qa-w10-{web,nat,sec,mail,cd,fgh}-*`, users `*.qaw10.<pkg>@example.test`; credentials only in agent scratchpads.
- `qa-w10-mail-a`: 8 queued deliveries; webhooks revoked; invitation tokens only in the scratchpad.
- `qa-w10-fgh-*`: 3 orphan Storage objects (W10-FGH-D5), 2 report exports queued/processed, 2 Live runs, ~2,410 assignments for the report-scope volume check.
- `qa-w10-web-*`: people incl. "Nguyễn Thị Ánh", plans, songs, a linked Person with a locked email.
- `qa-w10-nat-*`: native fixture pair; simulator booted, signed out. Metro, proxies, private API instances, nginx container and browser profiles stopped/deleted.
- Wave 7 leftover still to drop before any schema diff: `public.qa_resp_seq`.

## Fix round (2026-11-22) — branch `feature/qa-wave10-fixes`

Four Opus 5.5 agents (medium effort), one worktree and branch each, merged with `--no-ff` without conflicts: `fix-identity` (`a973977`), `fix-api` (`6427a12`), `fix-planning` (`fcb3f22`), `fix-web` (`0886d78`). The api branch's migrations `…0200/0300/0400` collided with the planning range and were renumbered `20261201000110/0120/0130` before the merge. The coordinator added `20261201000203` (reschedule preview fallback text). Migrations `20261201000010`–`20261201000203` applied to the local stack with `supabase migration up` (133/133, **no reset**).

| ID | Fix | Where | Live retest ([retest.md](retest.md), API :4200 + web :5180 from this worktree) |
|---|---|---|---|
| W10-MAIL-D4 (P1) | Merge marks the report `merged` before deleting the duplicate Person; report kept as audit row (`candidate_person_id` null); route names both people before resolving | `20261201000010_reconciliation_survives_merge.sql`, `backend/src/routes/roster.ts`, `services/roster.ts`; `supabase/tests/reconciliation-merge.sql` | PASS — merge 200 with resolved report, merge committed, keep_separate 200 |
| W10-MAIL-D1 | Recipient names from `people_directory`; missing name `null`, not `""` | `backend/src/services/deliveries.ts` | PASS — non-owner admin sees names |
| W10-MAIL-D2 | Send whenever the RPC recorded a request; "held" only if nothing recorded and plan still unpublished after the write | `backend/src/routes/assignments.ts` | PASS — 20 races, no queued rows (window may not have been hit) |
| W10-MAIL-D5 | Without `INTEGRATION_SECRET_KEY` the webhook step claims nothing and logs it | `backend/src/services/webhook-dispatch.ts`, `docs/operations/delivery-worker.md` | PASS — deliveries stay due, endpoint enabled |
| W10-NAT-D1 | People list uses the Person's phone first, then the login's, like detail | `backend/src/model/people.ts` | PASS |
| W10-SEC-D4 | Losers of a concurrent accept get 410 `invitation_used` / 409 `invitation_accept_in_progress` | `20261201000020_auth_email_registered.sql`, invitation route | PASS — never 5xx |
| W10-SEC-D1/D2 | `page` capped at 100,000 → 422 | `packages/shared/src/schemas/common.ts` | PASS |
| W10-SEC-D3 | Redaction case- and percent-encoding-insensitive, query string never logged, Referer reduced to origin | backend request logging | PASS (private instance stdout) |
| W10-FGH-D1, D2 (= W10-CD-D6) | Empty PATCH returns the song/arrangement; in-use delete 409 `song_in_use` / `arrangement_in_use` | `backend/src/routes/songs.ts`, `lib/errors.ts`, en/vi | PASS |
| W10-FGH-D4 (decision) | Deleting a song a songbook lists → 409, nothing deleted (delete guard extended — a NO ACTION FK broke org deletion) | `20261201000130_songbook_song_delete_guard.sql` | PASS — org delete still works |
| W10-FGH-D5 | Trigger refuses an attachment object once its intent is abandoned/expired | `20261201000120_attachment_object_requires_live_intent.sql` | PASS against real Storage |
| W10-FGH-D6 | Request hash on link/document creates; reused key + other payload → 409 (files created before the migration still replay) | `20261201000110_file_content_request_hash.sql` | PASS |
| W10-FGH-D7, D8 (decision) | Clients can't write feed token rows; `DELETE /me/calendar-feed` 204 turns the feed off; client `revokeCalendarFeed` | `20261201000100_calendar_feed_token_writes.sql`, `backend/src/routes/me.ts`, shared client | PASS |
| W10-FGH-D9 (decision) | Report CSVs (downloads + export files) start with a UTF-8 BOM | `backend/src/services/reports*` | PASS on the 4 download endpoints; tracked export file not rechecked (needs a worker pass) |
| W10-CD-D1 (decision: block) | Time edit / reschedule that double-books → 409 `scheduling_conflict` naming people; with reason + `scheduling.override_conflicts` saved and audited in `assignment_conflict_overrides`; reason without capability 403; only moved/added times checked; reschedule checks after the whole batch | `20261201000202_w10_time_change_conflicts.sql`, `20261201000203_w10_reschedule_preview_copy.sql`, `routes/plans.ts`, `schemas/plan.ts` | PASS |
| W10-CD-D2 | Plan instants without a time and UTC offset → 422 (rejected rather than guessed — spec "reject or explicitly resolve"; apps already send offsets) | shared plan schemas | PASS |
| W10-CD-D3 | Shared `planItemsTotalSeconds` (headers 0) for detail and schedule | `packages/shared`, backend plans | PASS |
| W10-CD-D4 | Preview lists archived songs as skipped / archived arrangements fall back with a warning; apply re-runs the preview | `20261201000200_w10_template_archived_library.sql` | PASS |
| W10-CD-D8 | `team_candidates` serves a service-type scheduler for a team with no service type | `20261201000201_w10_shared_team_candidates.sql` | PASS |
| W10-CD-D9 | Proposal create shares the recompute lock/exclusion check → 422 | shared staffing-proposal schema | PASS |
| W10-FGH-D3 | Semitone shift spells for the landing key (G −2 → Bb), invalid `to` 422, slash bass transposed, unknown text kept (still linear) | `packages/shared` chordpro, chart route | PASS |
| W10-WEB-D1 | Join requests: error + Try again, no empty state | `JoinRequestsSection.tsx` | PASS (browser) |
| W10-WEB-D2 | Shared list helper shows an offline notice for a paused first load/search and resumes on reconnect | `frontend/src/components/ui.tsx` | PASS (browser; Teams first-load offline not exercised) |
| W10-WEB-D3 | "Notify people" re-ticked each time the publish dialog opens | `PublishPlanModal.tsx` | PASS (browser) |
| W2-PLANS-D11 | Order rows switch layout by card width; tab bar scrolls/fades, selected tab in view | plan Order tab | PASS (390 / 1024 / 1440, light + dark) |

Validation on the merged branch: `npm run typecheck` clean; `npm run test` 2,032 passed (696 / 642 / 162 / 460 / 72); `i18n:check` OK; `supabase/tests/run-all.sh` 76/77 — `platform-admin.sql` fails on "Platform access is counted as an account" because the shared local DB's seed church has 7 members (2 added by earlier QA waves) and the test expects 5; environment drift, not a code change (fails the same without the wave 10 migrations).

Deploy order: **migrations before the backend** — the invitation accept code calls `20261201000020`'s function, feed rotate/revoke needs `…0100`, merge needs `…0010` to return 200. `update_plan_with_times` gains a defaulted parameter, so the old API keeps working on the migrated DB.

### Follow-ups from the fix round

- **W10R-D1 (P3, new):** web time-edit and reschedule screens have no conflict-override reason field, so an override-capable user can only override through the API; the time-edit refusal reads confusingly and the reschedule alert doesn't name the person. Same gap on mobile.
- No web/mobile control yet for "turn off calendar feed" (API + client method exist).
- Share tab "When" card overflows ~6 px at 1024 px (pre-existing, seen by fix-web).
- `platform-admin.sql` should count accounts relative to its own fixtures instead of a fixed 5.

### Fixtures added by the fix round

- `qa-w10-fixweb-a` (fix-web browser check), `qa-w10r-{a,b}` (retest: one enabled webhook endpoint with 2 queued deliveries, Orca browser profile `w10r-retest`). Retest worker pass at 15:55:05 UTC completed 50 deliveries of other orgs (global worker).
