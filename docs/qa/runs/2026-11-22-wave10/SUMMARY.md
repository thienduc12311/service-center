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

## Product decisions needed

- W10-CD-D1: time edit / bulk reschedule double-books a person without the override capability (TIME-02, TEMPLATE-03) — warn-only or block?
- W10-FGH-D9: CSV reports have no UTF-8 BOM; plan §5H REPORT-02 doesn't require one (only §5G IMPORT-01 does).
- W10-FGH-D4: deleting a song silently removes it from songbooks (dormant API) — refuse like plan references?
- W10-FGH-D8: no way to revoke the personal calendar feed without rotating it.

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
