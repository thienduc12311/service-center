# QA wave 1 — summary (2026-11-13)

Plan: `docs/plans/admin-mobile-test-plan.md`. Commit `f4f41cd` on `feature/app-store-review-demo`.
Environment: local Supabase (all 65 migrations applied), backend :4000 (started after last backend/shared/migration change), Vite web :5173, Node 20.20.1 / npm 10.8.2 (package.json engines ask for ≥26.8.1 / ≥11.19.0 — not enforced, caused no failure).

Four Sonnet agents ran in parallel on non-overlapping state: STATIC (read-only), DB (seed org, rollback SQL + serial race scripts), API (own orgs `qa-20261113-api-*`), WEB (own org `qa-20261113-web`, sole browser user).

| Track | Report | Result |
|---|---|---|
| STATIC | [static.md](static.md) | All PASS — typecheck ×4, 1096 unit tests (shared 490 / backend 236 / mobile 370), backend+frontend build, i18n:check |
| DB | [db.md](db.md) | 59 scripts: 45 PASS, 3 FAIL (stale tests), 11 BLOCKED (seed data drift) |
| API | [api.md](api.md) | 932 expanded cases: 915 PASS, 12 FAIL (→ D1–D6), 5 N/A |
| WEB | [web.md](web.md) | ~40 cases: 36 PASS, 1 FAIL, rest NOT_RUN; 7 P2 defects |

## P0 status

No P0 found. No cross-tenant disclosure (Beta sentinel never surfaced in Alpha context), no private-field leak, no unauthorized persisted mutation, prepared assignments hidden until release. Owner-only People rule held on UI, API and direct PostgREST for admin/legacy/people-grant/member.

Caveat: the capacity/replacement/release/chat race suites (OPPORT-02, REPLACE-02, RELEASE-02, CHAT-01) were **BLOCKED**, not passed — see DB blocker below.

## Defects

| ID | Sev | Source | Summary | Verified by coordinator |
|---|---|---|---|---|
| API-D1 | P1 (fixed) | API | `POST /teams/:id/members` persists a `position_id` from another team or another org; no route check, no composite FK (`backend/src/routes/teams.ts:206`) | Code confirmed |
| API-D2 | P1 (fixed) | API | `POST /plans` with another org's `service_type_id` → 201, cross-org reference persisted (RLS still hides it from Beta) | Agent DB evidence; rows since removed |
| API-D3 | P2 | API | `/arrangements/:id/chart` and `/materials` ignore `X-Organization-Id`; dual-org user reads Beta chart under Alpha context | — |
| API-D4 | P2 | API | Org timezone accepts invalid IANA zone (`z.string()`) | — |
| API-D5 | P2 | API | Malformed UUID path params → 500 with raw Postgres error text (`22P02`) | — |
| API-D6 | P2 | API | `POST /teams` with duplicate position names → 409 but team row persists (partial write) | — |
| WEB-D6 | P2 | WEB | Plan Order tab at 1024px: title column collapses, action icons overlap titles | — |
| WEB-D3 | P2 | WEB | `/plans/matrix` not route-gated for members (full UI + 403 banner); `/plans/proposals` fires 403 before gate | — |
| WEB-D1 | P2 | WEB | Accept-invite copy missing org name/account: "Choose a password for to finish." | — |
| WEB-D2 | P2 | WEB | `/welcome` slug `pattern="[a-z0-9-]{2,40}"` invalid under `v` flag → console error, client validation disabled (`frontend/src/pages/OnboardingPage.tsx:85`) | Code confirmed |
| WEB-D4 | P2 | WEB | `/p/:slug` plan page uses "set list" wording | — |
| WEB-D7 | P2 | WEB | a11y: unnamed controls (wizard checkboxes, header icon buttons); modals don't hide background | — |
| WEB-D5 | info | WEB | Order item removal uses native `window.confirm` | — |

### Fixed

API-D1 and API-D2 are fixed by migration `20261113000000_team_position_and_plan_service_type_integrity.sql`: composite foreign keys `team_memberships (position_id, team_id) → team_positions (id, team_id)` and `plans (service_type_id, organization_id) → service_types (id, organization_id)` replace the single-column keys. Covered by `supabase/tests/reference-integrity.sql` (fails against the old schema) and re-verified through the API: both repros now return 400 "Referenced record does not exist", the same answer as an unknown id. After applying it, `delivery-outbox.sql` and `i18n-preferred-language.sql` also fail locally; both fail the same way with the old keys restored, so they come from data the QA agents added (pending deliveries, people with explicit languages), not from this change.

## Stale DB tests (product decision needed)

- `f15-structured-imports` — scheduler actor lacks `people.manage` after owner-only People migration `20261109000000`. Test is stale.
- `f14-rehearsal-media` — scheduler now sees only own `people` row, so stage-layout roster check rejects Riley. Decide whether schedulers should resolve roster names for stage layouts.
- `f11-order-editing` — plan copy clears `leader_person_id` when caller can't see the leader. Possibly a real regression: a scheduler copying a plan silently loses item leaders.

## Blockers

- **Seed drift (11 DB suites):** seed profile 4444 (Riley) also has a `people` row in org "MOB-032 Hope" (created 2026-10-24) plus a `user_schedule_settings` row. Fixtures look up `people` by `profile_id` without org filter. Fix either the tests (filter by org) or the local data (`db:reset`, which also wipes the QA orgs).
- Unattributed 500 during WEB invite flow (~21:05–21:20 UTC); the :4000 backend wasn't started by this session so its log wasn't captured.

## Observations for intent review

People grants are stored but inert; People denials are 403 (CLAUDE.md says RLS-hidden rows surface as 404); legacy schedulers can edit team definitions; `POST /people/guests` open to any `scheduling.manage`; foreign-ID deletes return 204 no-op; duplicate Person emails allowed; members can view Draft plans read-only; DB race scripts leave audit/job rows (`person_roster_events`, `reminder_jobs`, …).

## Not covered in this wave

QA-03 plans/times/templates (beyond smoke), QA-04 matrix/proposals, QA-05 responses/capacity, QA-06 availability/delegation, QA-07 release/delivery, QA-08 notes/messages/chat, QA-09 song/chart/imports depth, QA-10 files/storage, QA-11 live/attendance/report metrics, QA-12 calendar/public/API keys/webhooks, all native mobile (QA-13/14), accessibility/i18n/perf (QA-15). No fixture loader (QA-00) exists yet.

## Fixtures left in place

Orgs `qa-20261113-api-alpha`, `qa-20261113-api-beta`, `qa-20261113-web` and their auth users (`*.qa20261113.{api,web}@example.test`). Credentials only in the session scratchpad, not the repo.
