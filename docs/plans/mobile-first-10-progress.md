# Mobile first-ten progress ledger

Tracks [the MOB-001–MOB-010 prompt pack](../prompts/mobile-first-10/README.md). One row per task/pass; details below the table. A task is `complete` only when its full acceptance gate passes.

| Task / pass | Status | Branch | Next action |
|---|---|---|---|
| MOB-001 shared UI and device review | implemented; QA pending | `codex/mob-001-ui-review` (committed `7270b56`) | Signed-in native device matrix (below), then mark complete |
| MOB-002 Pass A — chart context + arrangement picker | implemented; QA pending | `codex/mob-002-plan-chart-context` (uncommitted, branched from `7270b56`) | Signed-in device check of plan → chart and picker (below) |
| MOB-002 Pass B — persisted per-item sequence | implemented; QA pending (shared) | delivered by F11 Pass A on `feature/f11-order-editing-charts` | See the Services ledger F11 entry; native device check of plan sequence remains |
| MOB-003 Pass A — query and session lifecycle | implemented; QA pending | `codex/mob-003-session-lifecycle` | Signed-in device transition matrix (below) |
| MOB-003 Pass B — device registration lifecycle | implemented; QA pending | `codex/mob-003-session-lifecycle` | Physical push/sign-out matrix and EAS delivery gate (below) |
| MOB-003 Pass C — validated navigation + public responses | implemented; QA pending | `codex/mob-003-session-lifecycle` (`20ca764`, merged) | Production association deployment/signing and installed-device link matrix (below) |
| MOB-004 — individual responses, grouped schedule | implemented; QA pending | `codex/mob-004-personal-schedule` (`463943a`, merged) | Signed-in device check (below); reuse completed MOB-005 atomic answers |
| MOB-005 Pass A — Person identity + scoped access | complete | `feature/mob-005-prepared-response-foundations` | Person-first migration/API/RLS verified |
| MOB-005 Pass B — stable times + attendance | complete | `feature/mob-005-prepared-response-foundations` | Stable IDs, revisions, exact conflicts verified |
| MOB-005 Pass C — snapshots + atomic answers | complete | `feature/mob-005-prepared-response-foundations` | Stale rollback and real two-session replay race verified |
| MOB-005 Pass D — preparation + release | complete | `feature/mob-005-prepared-response-foundations` | Private preparation, versioned release, durable effects verified |
| MOB-005 Pass E — native review + split batch | implemented; QA pending | `feature/mob-005-prepared-response-foundations` | Signed-in iOS/Android interaction matrix below; implementation/export complete |
| MOB-006 Pass A — one-off availability + timezone contract | implemented; QA pending | `feature/mob-006-availability` | Signed-in timezone/DST matrix below |
| MOB-006 Pass B — bounded recurrence + web maintenance | implemented; QA pending | `feature/mob-006-availability` | Signed-in web maintenance matrix below |
| MOB-006 Pass C — native editor + conflict review | implemented; QA pending | `feature/mob-006-availability` | Signed-in iOS/Android interaction matrix below |
| MOB-007 — team scheduling preferences (native) | implemented; QA pending | `feature/mob-007-team-preferences` | Signed-in iOS/Android device check (below); next task: MOB-008 |
| MOB-008 Pass A — native Teams view + needs editing | implemented; QA pending | `feature/mob-008-plan-staffing` | Signed-in device check (below); then Pass B |
| MOB-008 Pass B — candidate picker + scheduling commit | implemented; QA pending | `feature/mob-008-plan-staffing` | Signed-in device check (below); next task: MOB-009 Pass B |
| MOB-009 Pass A — shared opportunity allocator/API | implemented; QA pending | delivered by F07 on `feature/f07-signups-replacements` | Reuse for native Pass B; F08 transition delivery remains a gate |
| MOB-009 Pass B — native opportunities/review | not started | — | Build on F07 contracts; iOS/Android device QA |
| MOB-010 Pass A — shared replacement allocator/API | implemented; QA pending | delivered by F07 on `feature/f07-signups-replacements` | Reuse for native Pass B; F08 transition delivery remains a gate |
| MOB-010 Pass B — native replacement tracking | not started | — | Build on F07 contracts; iOS/Android device QA |

## MOB-008 Pass A — 2026-10-19

**Website is the reference.** Per the user, the website staffing work is finished, so native mirrors it on existing contracts: no new migration, schema or endpoint. `mobile/src/lib/plan-teams.ts` mirrors the website's `buildPlanTeams` (`frontend/src/components/plan/types.ts`) and keep the two in step. The website's `staffing` strings and `plans:tabs.*` labels are reused.

**Count semantics (website):** per team, confirmed and declined by status; pending means released and unconfirmed; prepared is listed separately and visible only to the team's schedulers (RLS). Per position, `scheduled/needed` counts every request on that position, the same as the website.

**Needs editing:** the "Needed positions" toggle matches the website. Each stepper tap PUTs that one position (`setPlanPositionNeeds`), so positions that weren't sent are kept. Values are bounded 0–99, and the stepper waits while its save is in flight. Who can edit is the same as on the website: `plans.edit`, or `scheduling.manage` scoped to that team. The server keeps the existing `requireManager` and per-team RLS. There is no stale-value check beyond what the website has.

**Native:** the plan screen has an Order/Teams switch (`SegmentedControl`). Teams replaces the old "Who is serving" card and offers show-all-teams, per-team counts, positions, plan-only suffix, unpositioned, prepared tags and 44pt steppers. Release review stays where it was.

**Checks:** mobile `tsc` is clean; mobile tests pass 55/55, including `plan-teams.test.ts` (4: team filter, counts, visibility, plan-only); iOS and Android Expo export pass. **Not verified:** signed-in device interaction, light/dark mode, a team-scoped leader on device.

## MOB-008 Pass B — 2026-10-19

**Mirrors the website's `SchedulePeopleModal`** on its existing endpoints: `listTeams`, `listPeople`, `checkAssignmentConflicts`, `deliveryReadiness`, `preferenceWarnings` and `createAssignments`. No backend or schema change. The route is `mobile/app/plan/schedule/[id].tsx`, opened from Teams → "Add people". Pure rules live in `mobile/src/lib/schedule-people.ts`: candidate order and filter, time scope, the exact commit body, and when commit is enabled.

**Behavior (website parity):** teams are limited to those the user has `scheduling.manage` for. Positions include the plan-only ones. Times are all or selected (at least one). The people list puts team members first with an "on team" label and marks no-login people. Prepare privately follows the team's default visibility. A warning appears when a released request can't reach someone. Blocking conflicts need `scheduling.override_conflicts` plus a reason; same-plan warnings don't block. Preference warnings never block and take an optional reason. A 409 `scheduling_conflict` at commit replaces the preview with the server's conflicts and keeps the selection. On success the plan and schedule queries are invalidated and the screen closes.

**Left on the website (outside initial native parity, per the prompt):** creating a plan-only position, creating a new Person ("Someone new"), removing an assignment, and editing per-assignment times. Delivery outcomes after commit are not shown, because the website doesn't show them either.

**Checks:** mobile `tsc` is clean; tests pass 60/60, including `schedule-people.test.ts` (5); iOS and Android Expo export pass. **Not verified:** signed-in device interaction, a forced 409 on device, an override user, dark mode, Android.

## F08 shared release/reminder foundation — 2026-10-18

Services F08 delivered consolidated and scheduled release batches, scoped-link continuity on resends, reminder policies (team → service type → organization → default), per-Person reminder channel preferences, durable revalidated reminder jobs and per-Person/channel delivery history on `feature/f08-release-reminders`; see the F08 section in [services-capabilities-progress.md](services-capabilities-progress.md) for contracts and exact SQL/concurrency/live evidence. Native consumers (MOB-005 release scheduling, MOB-015/020 reminder settings and history) are not implemented; reuse the shared `createReleaseBatch`, `reminderPolicies`, `myReminderPreferences` and `planDeliveryHistory` client methods rather than adding mobile APIs.

## MOB-007 — 2026-10-19

**Reused, not rebuilt.** F03 already ships everything in steps 1–4: `scheduling_preferences` (unique Person + team-or-all scope, same-org FKs, `revision`, RLS), `GET/PUT/DELETE /api/v1/availability/preferences` (self via linked Person; schedulers via `scheduling.manage`; delegates only via an explicit F03 grant — no household inference), and `scheduling_preference_warnings`, which returns typed warnings (`frequency`, `monthly_max`, `avoided_week`, `outside_preferred_weeks`, …) separately from blockouts and counts distinct plans per organization-local month. The prompt's `/people/:id/scheduling-preferences` path was not added; the existing F03 route is the canonical contract.

**Semantics (from the F03 schema, unchanged):** frequency is one of `every_week | every_other_week | every_third_week | once_a_month`, null = no preference. Monthly max is an integer 1–31, null = no limit; 0 is rejected. Week of month is 1–5, where days 1–7 are week 1 and week 5 is days 29–31 (there is no separate "last week"). A week cannot be both preferred and avoided (schema-enforced; the native toggle clears the other side). Preferred times are local `HH:MM` start times, so split services are matched by start time. A team scope overrides the all-teams scope for that team.

**Native.** `mobile/app/team-preferences.tsx`, linked from Profile above Blockouts. It lists "All my teams" plus teams where the signed-in user is a member, and edits frequency, monthly max, preferred/avoided weeks and preferred times. Specific dates set on the web are carried through untouched (`requestFromDraft`). States: loading, unlinked Person (404), no teams, field validation, stale save (409 → keeps edits and offers "Load latest"), pending, retry. A refetch doesn't reset the form; only a scope or revision change does. Switching organization remounts the screen through the session-generation Stack key. Logic lives in `mobile/src/lib/preference-draft.ts`.

**Tests.** `mobile/src/lib/preference-draft.test.ts` (9): unset defaults, round-trip with preserved dates and revision, new scope without revision, week exclusivity, max 0/32/1.5/text rejected, invalid time rejected. Mobile `tsc` is clean and 51/51 tests pass; shared tests 335/335; web typecheck is clean. Backend permission/RLS and cross-organization coverage are the existing F03 suites; no backend code changed.

**Step 6:** there is no native candidate review yet; MOB-008 should consume `POST /api/v1/availability/warnings` (requires `scheduling.manage`) and render warnings apart from blockouts.

**iOS simulator (iPhone 17, light, signed in as owner), 2026-10-19:** the Profile entry opens the screen; it lists "All my teams" plus Worship Band and shows the inherits hint for an unsaved team. Choosing a week on one side clears it on the other. Max `0` shows the inline error and sends nothing. Saving persisted `every_other_week`, max 2, preferred week 3 at revision 1 (checked in Postgres). The first build put five native `Switch`es in a row, which overlapped; they are now 44pt toggle chips. **Not verified:** stale-save (409) on device, reopening after a save, switching organization mid-edit, dark mode, Android.

## MOB-009/010 shared foundation — 2026-10-18

Services F07 delivered the shared Person-first opportunity, claim, replacement-offer and optional approved-swap contracts on `feature/f07-signups-replacements`; see the F07 section in [services-capabilities-progress.md](services-capabilities-progress.md) for the state machine, files and exact SQL/concurrency evidence. It reuses MOB-005 identity/attendance/history and F00/F01/F04 scheduling boundaries rather than creating mobile-only tables or APIs. Real races prove one winner for claim/claim, offer/offer and signup/replacement/manual final-slot contention; the original decline remains intact and stale swaps roll back both sides. MOB-009/010 native screens were not selected and remain not started. F08 still owns truthful committed transition notifications/durable scheduled expiry, so neither mobile task is marked complete.

## MOB-006 Passes A–C — 2026-10-17

**Implementation note / baseline:** MOB-005 Person identity, stable plan-time identity, exact attendance and prepared visibility were present. Blockouts were timestamp-only Profile rows with create/delete; web used browser-local dates and native used raw date text. The Supabase skill's RLS, indexed-FK, constraint and short-transaction guidance shaped the additive Person-first migration and atomic revision/idempotency functions.

**Delivered:** shared organization-timezone resolution preserves civil intent independently of device timezone, uses exclusive all-day end dates, produces real 23/25-hour DST intervals, rejects nonexistent spring-forward times and carries an explicit earlier/later fall-back policy. One-off create/update/delete is Person-scoped and revision checked. Weekly/monthly series are finite (maximum 120), skip missing monthly dates explicitly, preview and commit from the same resolver, create idempotently, and persist bounded occurrence rows used by existing conflicts. Unique exception/audit rows and one transaction support one, future and whole-series update/delete with stale/replay safety. Affected commitments use actual selected/all attendance times (including rehearsals), rely on assignment RLS to hide prepared requests from recipients, redact blockout reasons from generic scheduler conflicts, and never alter assignment answers.

Web settings supports all-day/timed one-off and series creation, preview and affected commitments. `/settings/blockouts/:seriesId` loads the exact authorized series and maintains one occurrence, this-and-future or the whole series. Native uses the Expo-compatible platform date/time picker, organization-zone label, all-day/repeat/end/DST controls, occurrence/commitment review, draft retention and duplicate-save prevention. One-off edit/delete stays native; series rows open the exact web route.

**Primary files:** `supabase/migrations/20261019000100_mob006_availability.sql`, `supabase/tests/mob006-availability.sql`; shared timezone resolver/tests, blockout schemas/types/client; backend blockout routes; web availability settings/series route; native blockout form/profile; date-time-picker dependency.

**Checks:** rollback-only migration application and `mob006-availability.sql` pass against local Supabase (Person ownership, finite/idempotent series, exception retry, stale edits, 23-hour stored interval, local/absolute mismatch rejection, prepared privacy, private-reason redaction). `npm run typecheck`, `npm test` (shared 120, backend 88, mobile 42), `npm run build`, and `git diff --check` pass. iOS and Android Expo export passes at `/private/tmp/service-center-mobile-check-mob006-final`. The first sandboxed `npm test` run failed only because Supertest could not bind a listener; the permitted rerun passed unchanged. `db:reset` was not run because approval rejected destructive replacement of the developer database; migration and SQL behavior were instead executed in one transaction ending in `ROLLBACK`.

**Remaining gate:** signed-in interaction QA was unavailable. Verify web and iOS/Android in light/dark and large text: one-off create/edit/delete; Sunday across device timezone changes; spring/fall picker behavior; series preview/create; exact web handoff and one/future/all maintenance; rehearsal/split-time affected list; prepared privacy; offline/lost-response retry and duplicate taps. No production migration or deployment was performed. **Next task: MOB-007.**

## MOB-005 Passes A–E — 2026-10-17

**Implementation note / baseline:** F00's durable outbox and F01's capability/prepared-visibility foundations were present. Scheduling still keyed several records to Profile, plan times were replaced by list position, responses inferred all current assignments for a Person/plan, and native could answer only whole assignments. The Supabase Postgres skill's schema, RLS, index and locking guidance shaped the additive migration and transaction boundaries.

**Identity compatibility map**

| Contract | Legacy identity | Canonical identity | Compatible behavior |
|---|---|---|---|
| `assignments` | nullable `user_id` / Profile | required `person_id` | Existing IDs/history retained; linked writes synchronize both; no-login rows keep `user_id = null` |
| `team_memberships` | nullable `user_id` / Profile | required `person_id` | Existing membership IDs retained; legacy Profile payload resolves only through the already-linked Person |
| response history/effects | `assignee_id` / `responder_id` | `assignee_person_id` / `responder_person_id` | Old actor columns remain nullable compatibility references; history is append-only |
| response links | plan + Profile, scope inferred later | required Person + immutable snapshot | Outstanding unambiguous links receive recorded scope; empty/ambiguous legacy links are consumed for safe reissue |
| deliveries | nullable Profile recipient | required Person recipient | Linked recipients retain in-app/push/email; no-login recipients are email-only without an auth stub |

**Delivered**

- Pass A: idempotent one-Person-per-membership backfill and onboarding trigger; Person-first assignments/memberships/history/links/deliveries with dual-write guards; no email identity matching; no-login scheduling; invitation linking preserves the same Person and history; direct SQL and API remain capability/team scoped.
- Pass B: stable `plan_times.id`, order and revision; assignment `all` versus selected attendance; per-time current answers plus append-only history; versioned full-list time replacement refuses referenced deletion; exact half-open interval conflicts cover rehearsal/other times, touching boundaries, gaps and distinct same-plan obligations. Truly untimed legacy plans retain the documented two-hour service-date fallback in the API.
- Pass C: immutable Person/plan request snapshots with exact assignment IDs, time IDs, expected statuses/revisions, expiry and consumption; typed preview plus atomic, idempotent batch commit; deterministic stale/expired/used handling; public single-use links use the same transaction/service path; declined requests cannot be silently confirmed without a scheduler re-request; confirmed declines record withdrawal effects.
- Pass D: versioned release preview/commit; prepared rows remain absent under recipient RLS and all calendar/feed/delivery paths; release creates snapshots and durable outbox effects in the same transaction, grouped by Person/plan; provider dispatch remains after commit and idempotent. Web staffing uses Person/time payloads and exact revisions.
- Pass E: native grouped review freezes a server snapshot before showing controls, lists every selected position/time, permits split answers and an optional decline reason, commits atomically, displays mixed per-time state, handles stale refresh, disables duplicates and invalidates scoped schedule/plan/calendar/notification caches. Authorized leaders get prepared release review/commit; volunteers rely on RLS and never receive prepared rows.

**Primary files:** `supabase/migrations/20261017000300_mob005_identity_times_snapshots.sql`; `supabase/tests/mob005-{snapshots-and-attendance.sql,concurrent-token.sh}`; shared database/domain types, assignment/plan/access/team schemas and API client; backend assignment/respond/plan/team routes, snapshot model/service and Person-aware delivery services; web plan time/staffing/release controls; native schedule grouping, response review, plan, schedule and public-response screens.

**Checks (all pass)**

- `npm run db:reset` from an empty local database, including seed and every migration.
- `mob005-snapshots-and-attendance.sql`: deterministic Person backfill, linked/no-login scheduling, stable selected attendance, referenced-time refusal, recipient RLS, stale release rollback, exact release snapshot/outbox, later-assignment exclusion, public replay, split times/history/withdrawal, stale all-or-nothing batch, declined non-resurrection, rehearsal overlap, touching boundaries, service gaps and same-plan collision.
- `mob005-concurrent-token.sh`: two actual PostgreSQL sessions forced to overlap; exactly one `ok`, one `used`, one assignment-history row.
- SQL regressions: `assignment-response-history.sql`, `assignment-notifications-rls.sql`, `delivery-outbox.sql`, `f01-scoped-access.sql`, `atomic-plan-copy.sql`, `device-push-token-leases.sql`.
- `npm run typecheck`; `npm test` (shared 114, backend 82, mobile 42); `npm run build` (existing Vite chunk advisory only).
- `EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob005-final-2`.
- `git diff --check`.

**Fix — removing a sent request (2026-10-17):** Pass C's `assignment_request_snapshot_items.assignment_id … on delete restrict` made any assignment that had been sent undeletable (`DELETE /api/v1/assignments/:id` failed with 23503), breaking F01's "to withdraw a released request a scheduler removes it". Additive migration `20261019000000_mob005_assignment_removal_snapshots.sql` (the historical migration is unchanged) switches the item FK to `on delete cascade` and adds a `before delete` trigger on `assignments`:

- a *live* snapshot (not consumed/superseded) that included the removed assignment drops that item and bumps `version`, keeping its id — the effect's deliveries and an outstanding emailed link still answer the remaining requests, while a signed-in review taken earlier is refused with PT409 and must be refreshed;
- a live snapshot left with no items is superseded, so its link answers `stale`;
- a *consumed* or already-superseded snapshot keeps its header (Person, plan, `consumed_at`/`superseded_at`, version) as the audit record; its item for the removed assignment goes, like the assignment's response history and per-time answers, which already cascade.

The route now reports anything that still blocks a removal as 409 "still in use" instead of the generic 400 for 23503. `supabase/tests/mob005-assignment-removal.sql` covers: recipient cannot remove, scheduler removes sent requests, re-versioned vs. superseded snapshots, stale review and answers to the removed request refused, preview of the removed request refused, pre-removal link answers only the remaining request, emptied link is `stale`, an answered request can be removed with its consumed audit header intact, and whole-plan removal. It fails with the 23503 when run without the fix. All `supabase/tests/*.sql`, `mob005-concurrent-token.sh`, `npm run typecheck` and `npm test` pass.

**Remaining gate:** no signed-in native device/simulator interaction surface was available. Run iOS and Android in light/dark and large text through prepare → absent for recipient → release review → exact batch/split response → scheduler update, plus no-login link, stale refresh, offline retry and duplicate-tap checks. Code, database, web build and both native bundles are complete; MOB-005 remains `implemented; QA pending` until that interaction evidence is recorded. No production migration, provider notification, push or deployment was performed.

## MOB-004 — 2026-10-16

**Implementation note / baseline:** Native schedule rendered one card per assignment and the plan screen used `.find()` for the first personal assignment. `POST /assignments/:id/respond` overwrote the scheduler-authored `notes` with the response, had no transition rules (a declined position could be re-accepted, from the app or directly through PostgREST under `assignments_update`), no history and no org check on the read. The respond link updated every assignment for the plan/person, including declined ones. The Supabase skill (RLS basics/performance, privileges, constraints) guided the schema: append-only history with indexed FKs, `(select auth.uid())` policies, no client write grants, security-invoker guard so RLS still applies.

**Response transitions supported** (shared `selfResponseTransition`, mirrored by DB trigger `guard_assignment_self_response`): unconfirmed→confirmed, unconfirmed→declined, confirmed→declined (*withdrawal*, deliberate review in the app). Repeating the current answer is a no-op success (retry after a lost response). declined→anything and anything→unconfirmed are scheduler-only (re-request/reassign); the assignee also cannot change plan/person/team/position/notes/bookkeeping columns. Applies to API roles (`authenticated`, `anon`, `service_role`); migrations/maintenance roles are exempt.

**Grouped actions:** not available. Each position is answered individually; nothing is presented as "respond to all". Grouped atomic answers depend on MOB-005's versioned snapshot endpoint.

**Delivered**

- Migration `20261016000100_assignment_response_history.sql`: `assignment_responses` history (trigger-written for every status change by anyone, actor recorded, readable only by the assignee and org schedulers); guard trigger; `respond_to_own_assignment()` RPC = compare-and-set on the status the client saw + reason recorded in the same transaction. Decline reasons live only in history because every org member can read `assignments`. PostgREST returns 409 (`PT409`) for a refused direct transition.
- Shared: `respondToAssignmentSchema` now `{ status, reason?, expected_status? }` (reason ≤ 500, decline-only, blank → none); respond-link schema is status-only; `selfResponseTransition`/`allowedSelfResponses`; `AssignmentResponseRow`; `MyScheduleEntry.response_note` (own latest decline reason).
- Backend: `services/assignment-responses.ts` (org-scoped read, stale → 409 `assignment_response_stale`, forbidden → 409 `assignment_response_forbidden`, scheduler notified after commit only if `created_by` is still an active owner/admin/scheduler; notification failure is logged, not reported as a failed answer; "withdrew from" wording; no reason text in push/feed). Respond link no longer clobbers `notes` or resurrects declined positions.
- Native: `schedule-groups.ts` (one card per org/person/plan, every position kept, times deduped by ID with `requiredBy`, ordered by actual service time, history newest first, filters match when *any* position matches, `Mixed replies` status); Upcoming/History (past 365 days via `include_past/from/to`) and All/Pending/Confirmed/Declined controls; `AssignmentResponses.tsx` per-position controls (Accept, Decline with optional reason, `Withdraw…` review, declined guidance); `useAssignmentResponses` tracks pending/error/draft/request per assignment ID, ignores duplicate taps, keeps reason + exact request on failure, "Try again" resends the same request, refreshes schedule/plan/calendar/notifications in the active scope, resets on generation change. Plan screen shows all of the person's positions and times.

**Changed files:** `supabase/migrations/20261016000100_assignment_response_history.sql`, `supabase/tests/assignment-response-history.sql`, `packages/shared/src/{index.ts,lib/api-client.ts,lib/assignment-responses.ts,lib/assignment-responses.test.ts,schemas/assignment.ts,types/database.ts,types/domain.ts}`, `backend/src/{lib/errors.ts,model/assignment-response.model.ts,routes/assignment-respond.ts,routes/assignments.ts,services/assignment-responses.ts,services/assignment-responses.test.ts}`, `mobile/app/(tabs)/index.tsx`, `mobile/app/plan/[id].tsx`, `mobile/src/components/AssignmentResponses.tsx`, `mobile/src/lib/{assignment-response-drafts.ts,assignment-response-drafts.test.ts,query-keys.ts,schedule-groups.ts,schedule-groups.test.ts,useAssignmentResponses.ts}`.

**Checks (Node v20.20.1 locally — manifests ask for ≥26.8.1; all passed regardless)**

- `npm run build:shared`, `npm run typecheck`, `npm run build` — pass.
- `npm test` — shared 105, backend 64 (incl. 9 response-service tests), mobile 41 (incl. 11 grouping/filter + 9 draft/retry tests) — pass.
- `npx supabase migration up --local` — applied. Final migration text also re-applied from scratch inside a rolled-back transaction — pass.
- `docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/assignment-response-history.sql` — pass and rollback: stale CAS no-op, confirm, withdrawal with reason + actor, re-accept refused (RPC and direct), reset refused, team/notes edits refused, 501-char reason refused, forged history refused, other member cannot read history or answer, scheduler reads + re-requests (recorded), service-role re-accept refused.
- Live API against local Supabase as seeded Sam (temporary `created_by` = Jordan, restored afterwards): stale 409, accept 200, retry 200, reason-on-accept 422, withdrawal 200, own schedule shows reason, Riley sees `[]` history and no reason column, re-accept 409, direct PostgREST PATCH 409 `PT409`, history rows correct, Jordan's feed got "confirmed" then "withdrew from".
- `EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-mob004-final-…` — both bundles exported.

**Remaining gates**

- Signed-in device check (iOS + Android, light/dark, largest accessible text, keyboard over the reason field): two-position plan card, filters, History, decline with reason, withdrawal review, airplane-mode failure keeps the reason and Try again resends, stale answer after changing it on web.
- Respond-link reason entry and per-time answers are not offered (link is status-only).
- Website still offers an unreviewed Decline on a confirmed assignment (`frontend/src/pages/MySchedulePage.tsx`) and sends no `expected_status`; it now gets the server rules and history but not the review UI — web parity task.
- Shared response service for app + link paths, versioned grouped answers and prepared/released visibility: MOB-005.

## MOB-003 Pass C — 2026-10-17

**Implementation note / baseline:** Native notification responses routed directly from an untrusted payload to a plan, link handling was split across screens, cold-start and foreground behavior had no common validation/duplicate-consumption boundary, and there was no signed-out native assignment-response screen. Website association files covered invitations only and still contained signing placeholders. No database change was required for this pass.

**Delivered**

- Shared navigation contracts parse external values from `unknown` and accept only the configured exact HTTPS host or custom scheme, the supported `/accept-invite`, `/respond` and inert `/open/plan/:uuid` routes, valid 43-character public tokens, valid UUIDs and the existing strict push fields (`notification_id`, `type`, `organization_id`, nullable `plan_id`). Unknown hosts/routes, credentials, ports, malformed IDs and invented payload fields cannot become app routes.
- A single native navigation-intent provider handles cold-start and foreground Linking/notification responses. It retains at most one validated private intent through login, ignores duplicate push taps after one successful consumption, and permits a retry after a network failure. Public invitation and response intents remain signed-out routes; unknown app routes fall back safely.
- Private intents verify active membership before an awaited organization switch, then verify the exact organization-scoped notification row and plan before routing. Deleted, foreign, mismatched and unavailable targets land on a non-sensitive explanation screen instead of exposing or guessing a route.
- `/respond` uses the public token API without login or full-plan access and represents loading, ready, submitting, success, invalid, expired, used, stale and retryable-network states. Tokens stay in route/local component memory and are not persisted or logged. The screen now displays MOB-005's immutable request snapshot (only its exact positions/times); the earlier Person/plan grouping limitation has therefore been superseded by MOB-005's atomic/versioned contract.
- Expo config applies the same configured host to iOS associated domains, Android verified filters for `/accept-invite` and `/respond`, and runtime validation. AASA permits exactly those two public paths; Vercel serves both association files with JSON content types. Invitation behavior remains intact.

**Files changed:** `packages/shared/src/schemas/navigation.ts` + test/index export and `lib/api-client.ts`; `backend/src/routes/notifications.ts` and `src/__tests__/app.test.ts`; `mobile/src/lib/{navigation-intents,assignment-response-state,env}.ts` + tests, `mobile/src/providers/{NavigationIntentProvider,AuthProvider,NotificationsProvider}.tsx`, `mobile/app/{_layout,+not-found,accept-invite,respond,link-result}.tsx`, `mobile/app/open/plan/[id].tsx`, `mobile/app.config.js`, `mobile/.env.example`; `frontend/public/.well-known/{apple-app-site-association,README.md}` and `frontend/vercel.json`; this ledger.

**Checks (Node 26.9.0 / npm 11.19.1)**

- `npm run typecheck` — pass for shared, backend, frontend and mobile.
- `npm test` — pass: shared 114, backend 88, mobile 42. Navigation coverage includes allowed/unknown hosts and schemes, malformed IDs/payloads, authorized/foreign organization resolution, absent and mismatched targets, one-time post-login consumption, duplicate taps and network retry; backend coverage proves the public response route is not auth-gated.
- `npm run build` — pass; existing Vite >500 kB chunk advisory only.
- `EXPO_OFFLINE=1 CI=1 npx expo export --platform ios ...` and `--platform android ...` — both native bundles exported. An attempted `--platform all` stopped before bundling because this repository intentionally lacks `react-native-web`; the common instructions explicitly exclude Expo web export.
- Local public-API fixture check without auth — active preview `200` with the minimal snapshot, expired `410`, used `410`, submit `200`, replay `410`; the temporary notifications were deleted and the touched assignment was restored.
- Synthetic `EXPO_PUBLIC_WEB_APP_DOMAIN=app.example.test` config check produced one iOS associated domain and exact Android `/accept-invite` + `/respond` filters; AASA, asset links and `vercel.json` parse as JSON.

**Remaining gates:** no production hostname is configured (`EXPO_PUBLIC_WEB_APP_DOMAIN` is unset and backend `APP_URL` is localhost); AASA still needs the Apple Team ID and asset links still need the production Android SHA-256 certificate fingerprint. Deploy both files byte-for-byte over HTTPS with the required content type and no redirect, make signed EAS builds, and verify installed iOS/Android cold, warm and background invitation/response links. On physical signed-in devices also exercise malformed/unknown-host links, unauthorized organization, deleted notification/plan, sign-out then one-time login resume and duplicate notification taps. Pass A's signed-in transition matrix and Pass B's real push/revocation/lease matrix remain open, so MOB-003 stays `implemented; QA pending`.

**Exact next task/pass:** MOB-006 Pass A — one-off availability contract and organization-timezone conversion. MOB-004 is already implemented and MOB-005's response-version/atomic upgrades are complete, so they are prerequisites to reuse rather than the next work item.

## MOB-003 Pass B — 2026-10-16

**Implementation note / baseline:** Expo registration was owned by `NotificationsProvider`, but the provider tried to delete the token only after the session disappeared, making the request unauthorised; the failure was swallowed. Registrations were account-wide in persistence but re-registered on organization changes, never expired, and all rows were eligible for push forever. Lock-screen messages contained plan and assignee detail. Supabase auth was inspected before choosing the boundary: online sign-out can use the still-current access token, but a disconnected server cannot learn an offline local event instantly. The Supabase Postgres skill therefore guided an additive `timestamptz` lease, constrained capability hash, recipient/lease index, atomic token upsert and unchanged owner RLS rather than a claim of instant offline revocation.

**Delivered**

- Registration now returns a one-time per-registration revocation secret while storing only its SHA-256 hash. A public, globally rate-limited endpoint can delete only the exact token/hash pair and always returns `204`; it cannot enumerate registrations. The normal authenticated owner delete remains first choice.
- Each successful registration creates/renews a server-computed 30-day lease. Notification delivery selects only rows whose lease is still active. Existing rows are backfilled from `last_seen_at`, so stale registrations gain no new grace period. Database constraints enforce a forward lease and lowercase 64-hex hash; `(user_id, lease_expires_at)` supports the delivery lookup without widening RLS.
- Native registration is now account-wide rather than organization-bound. A testable lifecycle serializes ownership generations, avoids duplicate registration during org switches, renews daily while open, bounds sign-out cleanup, resets the badge, and publicly revokes failed/timed-out or late registrations after auth disappears. Successive credentials for a reused Expo token remain independently cleanable. Tokens and revocation secrets stay in memory only and are not logged or persisted.
- Explicit sign-out waits up to two seconds per cleanup operation before removing the local Supabase session. Authenticated delete is attempted while authority still exists; failed cleanup is reported and falls back to the narrow capability. If Supabase sign-out itself fails, registration recovery is attempted and the profile screen surfaces the error instead of pretending sign-out succeeded. Expired/external sessions use capability cleanup.
- Push alert title/body are generic (`Service Center` / `Open the app to view a schedule update.`); opaque IDs remain in data for Pass C validation. Client navigation is not treated as a privacy boundary.

**Files changed:** `packages/shared/src/{lib/api-client.ts,schemas/notification.ts,types/database.ts,types/domain.ts}`; `backend/src/app.ts`, `backend/src/model/notification.model.ts` + test, `backend/src/routes/notifications.ts`, `backend/src/services/notification-center.ts`, `backend/src/services/device-registrations.ts` + test; `mobile/src/lib/push.ts`, `mobile/src/lib/device-registration-lifecycle.ts` + test, `mobile/src/providers/{AuthProvider,NotificationsProvider}.tsx`, `mobile/app/(tabs)/profile.tsx`; `supabase/migrations/20261016000000_device_push_token_leases.sql`; `supabase/tests/device-push-token-leases.sql`; this ledger.

**Checks (Node 26.9.0 / npm 11.19.1)**

- Applied `20261016000000_device_push_token_leases.sql` to the running local Supabase database and recorded it in local migration history; pass. No database reset and no production database change.
- `psql -v ON_ERROR_STOP=1 -f /tmp/device-push-token-leases.sql` in `supabase_db_service-center` — pass and rollback: active lease eligible, expired lease excluded, authenticated owner delete removed the active registration under RLS.
- `npm run typecheck` — pass for shared, backend, frontend and mobile.
- `npm test` — pass: shared 92, backend 54, mobile 14. New controlled tests cover the 30-day server cutoff, hashed capability, authenticated pre-sign-out cleanup, unregister failure fallback, late registration, bounded never-settling work, no duplicate registration on an organization switch, and renewal suppression/recovery across a sign-out attempt.
- `npm run build` — pass; existing Vite >500 kB chunk advisory only.
- `EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob003b-node26-final-2` — pass for final source. Bundling only.
- `git diff --check` — pass.

**Remaining gates / limitations:** run physical signed-in iOS and Android checks with a linked EAS project for permission allowed/denied, real receipt, org switch, online sign-out, offline sign-out, expired session, delayed registration, failed unregister, repeated sign-out and account A→B on one device. Confirm the old user receives no new push after proven online revocation and that delivery stops after forced lease expiry. A fully offline sign-out cannot notify the server: failed transient capability cleanup is kept only for the process lifetime, and the hard server cutoff is the last successful registration plus 30 days. Force-quitting can lose that retry; already delivered OS notifications cannot be recalled. Expo provider acceptance/delivery and lock-screen rendering were not exercised here. MOB-003 remains partial. **Exact next task: MOB-003 Pass C — validated navigation and public responses**, including unknown payload validation, safe cross-organization intent handling, signed-out `/respond`, one-time post-login intent consumption and production association-file configuration. MOB-004 follows only after Pass C.

## MOB-003 Pass A — 2026-10-16

**Implementation note / baseline:** native had one global persisted organization id; `ServiceCenterApi` awaited the token and then read the mutable organization separately; keys were organization-only and songbook detail was just `['songbook', id]`; protected queries enabled as soon as an organization string existed; session/org switches neither hid the old navigator nor cancelled/cleared QueryClient; mutation callbacks could invalidate or navigate after a switch. There are no downloaded manifests/offline packs in current native source. Account-wide operations are `/me`, profile changes, organization creation and device registration. Schedule, calendar, plans, songs, songbooks, blockouts and notification data/actions are organization-scoped. Invitation preview/accept is public and remains outside private caching. Push registration/unregistration is inventoried but intentionally remains Pass B; link handling remains Pass C. No database work was required, so the Postgres skill was not loaded.

**Delivered**

- Added a testable native session-generation lifecycle. Every account/organization transition synchronously gates protected rendering, advances generation, installs a token-with-no-tenant request context, cancels queries, clears query and mutation caches, loads `/me` plus that account's stored preference, validates membership, persists the authorized choice and only then enables protected queries. Old async completions fail generation checks. Invalid stored organizations fall back to the first current membership.
- Organization preference is stored at `service-center.organization-id.<profile id>`; the unsafe legacy global value is removed and never adopted by a new account.
- Extended the shared API client with an optional atomic `ApiRequestContext`, preserving the website's legacy access-token/organization getters. Native requests snapshot token, organization, user and generation once. A `401` carries that snapshot to the callback, so a response from an old organization or refreshed token cannot sign out the current session.
- Added typed keys for every native private query: schedule, calendar, plans, songs, songbook list/detail/composer songs, blockouts and notification unread/feed. Keys include authenticated profile, organization and generation; all queries require a validated `queryScope`.
- Guarded asynchronous protected writers/callbacks: assignment responses, notification read/refresh, profile save, blockout create/delete, organization create/switch, organization-logo upload/update and songbook document upload/create. The protected stack is keyed by generation, clearing screen/form state on transitions and sign-out. Current load failures show a retry gate instead of exposing an empty protected navigator.
- Added a native Vitest harness with controlled completions for account A→B, storage hydration vs `/me`, invalid stored org, organization switching/gating, token refresh during and after hydration, stale unauthorized contexts, sign-out→new account, distinct detail keys and a late tenant query after cache clear. Added shared client tests for atomic header capture and unauthorized context forwarding.

**Files changed:** `packages/shared/src/lib/api-client.ts` + test; `mobile/src/lib/{api,organization-storage,query-keys,session-lifecycle,notification-keys}.ts` + lifecycle test; `mobile/src/providers/{AuthProvider,NotificationsProvider}.tsx`; `mobile/app/_layout.tsx`, protected query screens under `mobile/app`; `mobile/src/components/BlockoutForm.tsx`; `mobile/package.json`; `package-lock.json`; this ledger.

**Checks (Node 26.9.0 / npm 11.19.1)**

- `npm run typecheck` — pass for shared, backend, frontend and mobile.
- `npm test` — pass after allowing the existing Supertest suite to open a local listener: shared 92, backend 52, mobile lifecycle 8. The first sandboxed run failed only because Supertest could not `listen` (`EPERM`); rerun passed unchanged.
- `npm run build` — pass; existing Vite >500 kB chunk advisory only.
- `EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob003a-final` — pass for the final source. Bundling only.

**Remaining gates / next:** run a signed-in iOS + Android device matrix with delayed A→B queries/mutations, sign-out→different account, invalid stored org, hydration race, token refresh and stale `401`; assert the old protected stack never flashes and forms reset. Automated state/cache tests cover those transitions, but no native renderer/device interaction harness or signed-in device session was available. MOB-003 remains partial. **Exact next task: MOB-003 Pass B — device registration lifecycle**, including authenticated unregister-before-sign-out, bounded failure handling, late registration guards, badge reset and server revocation/lease-expiry proof. Pass C still owns link validation, `/respond` and association files.

## MOB-002 Pass A — 2026-10-15

**Baseline confirmed:** plan rows pushed `/song/<songId>` only; the song screen always took the default (or first) arrangement and ignored `key_override`. No per-item sequence column exists (`plan_items` has `arrangement_id`, `key_override` only) — that is Pass B. `plan_items.arrangement_id` is `on delete set null` and has no DB check that the arrangement belongs to the item's song, so the client resolver verifies the relationship. MOB-003 cache conventions not yet present; queries stay keyed `[kind, organizationId, id]`.

**Delivered**

- `packages/shared/src/lib/chart-context.ts` (exported): `resolveChartContext` → `ready` {source `plan|library`, arrangement, planArrangement, isTemporaryView, sourceKey, displayKey, keyFromPlan, sequence} or `unavailable` {`not_a_song | song_mismatch | arrangement_missing`}. Precedence: item's arrangement (looked up among the song's own arrangements — an unknown/deleted/other-song id is unavailable, never the default); song default (`is_default` → first, same as web `resolveArrangement`) only when the item chose none or in the library. Display key = item override → arrangement key → song default key. `renderChartContext` computes the target key once (display key + reader shift) and passes it to `renderChordProChart`, so chords and label are one result; missing/unreadable key → `key_unknown` instead of mislabelled chords; empty chart → `no_chart`. Numbers/numerals read off the written key; lyrics need no key.
- `mobile/app/plan/[id].tsx`: song rows push `/song/[id]?planId&itemId`. Ordinals now skip headers; length column `minWidth` (MOB-001 observations).
- `mobile/app/song/[id].tsx`: params validated as UUIDs (partial/forged plan context → "link isn't valid", not silent library fallback); re-fetches plan (RLS) and song; item resolved by id; loading until both settle; explicit item-missing / mismatch / arrangement-missing / no-chart / key-unavailable / no-arrangements states. View state lives in a child keyed by org:song:plan:item, so transpose, notation and picked arrangement reset on any context change. Plan context labels "Service key", shows plan title; viewing another arrangement shows a "nothing is saved" notice with a return button. Arrangement change resets shift.
- `mobile/src/components/ArrangementPicker.tsx`: wrapping radio chips, 44pt targets, marks "In this plan"/"Default", shown when the song has >1 arrangement.

**Checks (Node 26.9.0 / npm 11.19.1)**

- `vitest run src/lib/chart-context.test.ts` — 13 pass: non-default arrangement + override (B in A over default A in C), C→D chords+label, shift applied once (+2 → E, −1 → Db), numbers, missing/deleted arrangement, song mismatch, non-song item, two plans + library independent, temporary view, missing chart, unknown key.
- `npm run typecheck` — pass (shared, backend, frontend, mobile).
- `npm test` — pass: shared 90, backend 52.
- `npm run build` — pass (existing Vite chunk-size advisory).
- `expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob002` — pass (bundling only).

**Remaining gates (Pass A)**

- Signed-in device check not run (same blocker as MOB-001: no tap automation to sign in). Verify on iOS + Android, light/dark: plan → song opens the item's arrangement and service key; picker scrolling/large text; temporary-view notice; chart horizontal scroll; switching organization while on a chart shows loading, not prior org content.
- No native test harness exists; resolver/render behaviour is covered in shared tests only.
- Website `RehearseTab` / web song links do not yet pass item context — outside the native scope of this pass; revisit if web parity is required.

**Pass B (2026-10-18):** delivered as shared work by F11 Pass A — `plan_items.sequence_override` (null inherits), validation, revisioned item update, `resolveChartContext` applying it, and `serviceSongBookDocumentFromPlan` on the resolver. Evidence and gates: [Services ledger, F11](services-capabilities-progress.md). The native song screen needs no code change (it resolves the plan row it already fetches); only the device check remains.

**Original Pass B plan:** read `.agents/skills/supabase-postgres-best-practices/SKILL.md`; add nullable `plan_items.sequence_override text[]` (null inherits) via new migration; validate against arrangement section rules in `schemas/plan.ts`; include in `PlanItemRow`, plan detail select and item update; wire `resolveChartContext` (`sequence` = override ?? arrangement); test two items on one song with different sequences/keys and null inheritance; also make `serviceSongBookDocumentFromPlan` use it.

## MOB-001 — 2026-10-15

**Type:** verification plus targeted defect fixes (not verification-only). The theme from commit `3ba8374` was preserved; no redesign, no navigation or feature removal, no DB change.

### Token trace (step 1)

| Role | Shared source (`packages/shared/src/lib/design-tokens.ts`) | Web consumer | Native consumer |
|---|---|---|---|
| Primary / pressed | `color.brand`, `brandPressed`, `brand[50–700]` | `applyDesignTokens()` → `--app-brand-*` → Tailwind `brand-*` (`index.css` `@theme`) | `theme.color.brand` in `Button`, tab/header tint `brandText` |
| Canvas / surface / borders | `canvas`, `surface`, `field`, `border`, `borderStrong` | `--app-{light,dark}-*` → `:root` / `.dark` → `.card`, `.input`, `bg-app-*` | `Screen`, `Card`, `Field`, tab bar, stack header |
| Text | `ink`, `inkMuted`, `inkFaint`, `brandText` | `--app-ink*`, plus legacy `.dark .text-slate-*` remaps | all `theme.type` styles |
| Assignment status | `accent.{green,red,yellow}` + **new `ASSIGNMENT_STATUS_ACCENTS`** | `--app-status-<status>-{bg,fg}` → `.status-*` → `assignmentTone` | `statusAccent()` → `Tag` |
| Radii | `radius.{small,control,input,card}` | `--app-radius-*` on `.button`, `.input`, `.card` | `theme.radius.{xs,sm,md,lg}` |
| Build-time colors | n/a (JS config can't import TS tokens) | n/a | `app.config.js`: `#f8fafc`/`#020617` splash, `#4f46e5` notification — values match tokens; keep in sync manually |

Hardcoded remaining (web, not conflicts with tokens): `frontend/src/components/ui.tsx` `ErrorNotice`/`MenuItem` rose and secondary/ghost slate utilities, `frontend/src/lib/format.ts` badge ring colours and `assignmentDot`. They use the same Tailwind slate/rose/emerald/amber family; candidates for later token adoption. No hardcoded hex/rgba in `mobile/app` or `mobile/src` except `theme.ts`.

Typography/decoration/motion (step 2): system sans (`System`/`sans-serif`) and mono only for charts/keys; no serif or `@expo-google-fonts` import (`expo-font` is only an Expo transitive dependency, never imported); `Reveal` renders immediately; no ruled backgrounds.

### Defects fixed

1. **Native buttons/rows rendered unstyled on device (release-blocking).** NativeWind's `Pressable` interop drops function-form `style={({ pressed }) => …}`, so every `Button`, `IconButton`, notification bell and list row lost its fill/layout (simulator screenshot: primary *Sign in* was plain left-aligned text). `PressableScale` (`mobile/src/components/motion.tsx`) now tracks pressed state itself; all seven function-style callsites (plan order rows, notifications rows, calendar events, schedule cards, songbook pick rows and drop zone, `ListRow`) use it. Verified fixed on simulator.
2. **Status roles defined twice.** Added shared `ASSIGNMENT_STATUS_ACCENTS`; web `.status-*` and native `statusAccent()` both read it. Native no longer redefines `AssignmentStatus` locally. Web computed colours checked in light/dark — all six bg/fg pairs equal the shared tokens.
3. **Calendar status wording** showed raw `unconfirmed` (web and native). Both now use `ASSIGNMENT_STATUS_LABELS` (“Awaiting reply”). Native event time/location now separated with ` · `.
4. **Large text:** segmented-control labels broke mid-word (“accou/nt”) → capped at 1.5× and centred; login “SC” logo glyph clipped in its 48pt box → fixed size, hidden from screen readers (heading names the app); unread badge fixed 16pt height → `minHeight` with 1.4× cap.
5. **Keyboard:** Settings (profile/blockout/new organization) and Song books create form scroll views now use `automaticallyAdjustKeyboardInsets` (iOS) so lower fields aren't covered.
6. **Touch target / a11y:** login mode-switch link has a 44pt target; notification rows announce “Unread:”; plan song rows' bold link style (previously a no-op `fontFamily`) restored.
7. **Tablet:** login column capped at 520pt instead of stretching edge to edge on iPad.

### Observations not fixed (reproducible, out of MOB-001 scope or need a decision)

- Seeded demo credentials text shows on both web (`LoginPage.tsx:128`) and native login in all builds — gate on dev builds before release (MOB-003 or release checklist).
- Web public respond page says **Confirm** (`RespondAssignmentPage.tsx:35`) while My Schedule says **Accept** — MOB-003/MOB-005 response work.
- Schedule/plan rehearsal accents use the amber that also marks “Awaiting reply”; web calendar does the same, and status always carries a text label, so left for parity.
- Schedule response buttons share one `isPending` across all cards (all spin together) — MOB-004.
- Plan order ordinals count headers; fixed 46pt length column may wrap at large text — MOB-002.
- At accessibility-XXXL the `Field` placeholder sits low in the input (fixed body `lineHeight` on `TextInput`) — legible, revisit with device QA.
- Native appearance is light/dark only (no system-follow) — MOB-021.

### Visual matrix

Tested (iOS Simulator, Expo Go 57.0.9, Metro dev bundle; screenshots in `/private/tmp/mob001-shots/`, not committed):

| Device | Theme | Text size | Screen | Result |
|---|---|---|---|---|
| iPhone 17e | light | default | Sign in | Rendered; Expo dev-menu sheet obscured lower half |
| iPhone 17e | dark | default | Sign in | **Defect 1 found**, then verified fixed |
| iPhone 17e | dark | accessibility XXXL | Sign in | **Defect 4 found**, segment fix verified |
| iPhone 17e | light | accessibility XXXL | Sign in | Logo, segments verified fixed |
| iPad mini (A17 Pro) | dark | default | Sign in | **Defect 7 found**, column cap verified (dev-menu sheet over lower half) |
| Web 1280×800 (preview) | light + dark | default | Dashboard; computed `.status-*` | Token values match |

Untested — **remaining gates**: any signed-in native screen (schedule, calendar, songs, song chart, song books, plan, notifications, settings, invitation) — no tap automation was available in this environment (agent device access off; no idb/AppleScript), so sign-in could not be completed; keyboard-visible forms; Android (no emulator/adb installed); physical iOS/Android devices; screen-reader pass; long names and error/empty states on device; web screens other than dashboard after this change.

### Checks run (Node 26.9.0 / npm 11.19.1 via nvm; default shell Node 20.20.1 is below the declared engine)

- `npm run typecheck` — pass (shared, backend, frontend, mobile).
- `npm test` — pass: shared 77, backend 52.
- `npm run build` — pass (existing Vite >500 kB chunk advisory).
- `expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob001-final` — pass. Bundling only, not device verification.

### Files changed

`packages/shared/src/lib/design-tokens.ts`, `frontend/src/lib/design-tokens.ts`, `frontend/src/index.css`, `frontend/src/pages/CalendarPage.tsx`, `mobile/src/components/{motion,ui,NotificationBell}.tsx`, `mobile/src/lib/theme.ts`, `mobile/app/(auth)/login.tsx`, `mobile/app/(tabs)/{index,calendar,profile,songbooks}.tsx`, `mobile/app/notifications.tsx`, `mobile/app/plan/[id].tsx`, this ledger.

### To close MOB-001

Run the signed-in matrix on a small phone, large phone/tablet, light/dark, accessibility text, keyboard-visible forms, on iOS **and** Android, ideally a dev build (no Expo dev-menu overlay). Confirm Button/ListRow pressed feedback and fills on every screen. Save approved screenshots without private roster data.
