# QA wave 2 — summary (2026-11-17)

Plan: `docs/plans/admin-mobile-test-plan.md`. Commit `cac3f26` on `main`.
Environment: freshly reset local Supabase (all migrations + seed), backend :4000, web :5173, admin :5174, Node 26.13.1 / npm 11.20.0, Supabase CLI 2.122.1.

Four Sonnet agents ran in parallel, each in its own org namespace (`qa-20261117-{plans,staff,resp,avail}-*`). Only the PLANS agent used the browser.

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| QA-03 plans/times/templates/order | [plans.md](plans.md) | 1233 | 1198 | 27 | 4 N/A, 4 NOT_RUN |
| QA-04 staffing matrix/proposals | [staffing.md](staffing.md) | 538 | 517 | 21 | — |
| QA-05 responses/capacity | [responses.md](responses.md) | 516 (+7 DB suites, 6 race scripts) | 503 | 13 | 1 N/A |
| QA-06 availability/delegation/orgs | [availability.md](availability.md) | 359 | 342 | 16 | 1 N/A |

## P0 status

No P0. No cross-tenant disclosure, no prepared-assignment leak, no unauthorized persisted write, no lost write. ~700 real parallel API race iterations (claims, replacements, swaps, approvals) produced 0 overfills, 0 duplicates, 0 lost writes. Wave-1 BLOCKED race/DB suites (OPPORT-02, REPLACE-02, f07, mob009, mob010) now PASS on the clean DB.

## PM triage

Each P1 was checked against source by the coordinator before acceptance.

### Fix now — P1

| ID | Summary | Decision |
|---|---|---|
| W2-AVAIL-D3 | `can_manage_blockout` uses `has_capability_anywhere(scheduling.manage)`: a leader of one team reads/edits every member's blockouts incl. private reasons | Scope to admins + leaders who can schedule a team the Person belongs to. Reasons stay private to self/admin/delegate |
| W2-STAFF-D1 | Conflict engine drops prepared requests the actor can't see → scoped scheduler double-books where owner gets 409 | Keep invisible prepared requests as blocking conflicts, redacted (no plan/team/title) |
| W2-STAFF-D2 | Inactive-membership / archived Persons offered as schedulable (matrix, candidates, proposals); commit then fails generic 400 | Exclude from candidate lists; matrix preview warns |
| W2-RESP-D1 | `GET /opportunity-claims` returns `[]` for non-owners (`people!inner` embed filtered by owner-only People RLS) | Resolve claimant names without depending on People RLS |
| W2-RESP-D2 | Beneficiary can approve own signup claim / replacement offer / swap | Reject self-approval in the RPCs |
| W2-PLANS-D10 | Web Plans "Past" tab includes future plans; Plans and Reschedule lists cap at 50 with no pager | Bound Past to `to: now`; add paging |

### Fix now — P2 input/error hygiene (one cross-cutting pass)

- Malformed UUID path params → 400, not 500 + raw `22P02` (API-D5, W2-PLANS-D4, W2-STAFF-D4, W2-RESP-D5, AVAIL surfaces).
- Invalid dates / calendar-invalid dates → 400 (W2-PLANS-D1, W2-STAFF-D4 `anchor_date`).
- Timezone lib caller errors → 400, not 500 (W2-AVAIL-D1).
- `P0002` not-found → 404 on blockouts (W2-AVAIL-D2).
- `GET /plans` beyond last page → empty page (W2-PLANS-D2).
- Org timezone validated as IANA zone (API-D4).
- Arrangement chart honours active org (API-D3 chart part).
- `POST /teams` duplicate positions → no orphan team row (API-D6).

### Deferred — product decision or lower value

W2-PLANS-D3 (zone-less dates as UTC), D5 (explicit sort_order no shift), D6 (header length in total), D7/D8 (template preview warnings), D9 (in-use delete wording), D11/WEB-D6 (1024px Order tab), D12 (overlap via reschedule — source says deliberate; needs owner call); W2-STAFF-D3 (fairness vs rotation), D5 (shared-team candidates 404), D6 (lock+exclude accepted on create); W2-RESP-D3 (concurrent identical retry 409), D4 (token preview stale times); WEB-D3 route gates; other wave-1 web P2s.

## Not covered

QA-07–QA-12, native mobile (QA-13/14), accessibility/i18n/perf (QA-15). 400-candidate cap, DST/overnight conflict datasets, web/native response fallback pages.

## Fixtures left in place

Orgs `qa-20261117-{plans,staff,resp,avail}-*` and their `*.qa20261117.*@example.test` users. Credentials only in agent scratchpads.

### Fixed

Branch `feature/qa-wave2-fixes`. Migrations applied with `supabase migration up` (no reset); every item re-verified against the live API (:4000) with the QA repro on seed fixtures, then the fixtures were removed.

| ID | Fix | Where |
|---|---|---|
| W2-AVAIL-D3 | Availability management = self, owner/admin, availability delegate, or someone who can schedule (F01 scope) on a team the Person belongs to. Raw blockout/series rows (with reasons) are readable by self/admin/delegate only; leaders list through `list_blockouts` (reason redacted) and write through security-definer RPCs (`update_blockout`, new `delete_blockout`). API mirror: `resolveAvailabilityTarget` asks `can_manage_availability`, out-of-scope Person = 404. Conflict checks unchanged (still redacted). | `20261119000000_w2_blockout_scope.sql`, `backend/src/routes/blockouts.ts`, `backend/src/services/availability.ts` |
| W2-STAFF-D1 | `private.attendance_conflicts` and `scheduling_conflicts` consider every non-declined request; prepared rows the viewer cannot schedule are returned blocking and redacted ("Another commitment", no plan/assignment/time ids). Commit-time trigger uses the same resolver. | `20261119000100_w2_hidden_prepared_conflicts.sql` |
| W2-STAFF-D2 | `people_directory.schedulable` (not archived, active membership when linked) and `team_candidates` filter on it; matrix query and proposal snapshot use it; matrix preview adds a `person_unavailable` warning and blocks commit. | `20261119000200_w2_schedulable_people.sql`, `backend/src/services/staffing-matrix.ts`, `staffing-proposals.ts` |
| W2-RESP-D1 | Claim list no longer embeds owner-only `people`; names come from `people_directory`. Response shape unchanged. | `backend/src/routes/opportunities.ts` |
| W2-RESP-D2 | BEFORE UPDATE triggers refuse approval by the claimant / candidate / swap participant (`42501`, hint `self_approval` → 403 `self_approval`). Web and mobile hide Approve for the beneficiary (shared `isOwnApproval`). | `20261119000300_w2_no_self_approval.sql`, `packages/shared/src/lib/approvals.ts` |
| W2-PLANS-D10 | Past tab bounded with `to: openedAt`; Plans and Reschedule lists load further pages ("Show more", `usePlanPages`). | `frontend/src/pages/PlansPage.tsx`, `ReschedulePlansPage.tsx`, `hooks/queries.ts` |
| API-D5 / W2-PLANS-D4 / W2-STAFF-D4 / W2-RESP-D5 / AVAIL | `param()` validates `id`/`…Id` route params as UUID → 400; invalid `X-Organization-Id` → 400 (also on `/me/availability/copy`); `22P02`/`22007`/`22008` map to 400 without engine text; matrix cursor is a UUID. | `backend/src/lib/params.ts`, `lib/errors.ts`, `middleware/organization.ts` |
| W2-PLANS-D1, W2-STAFF-D4 dates | Plan dates/times and list filters must be real ISO calendar instants (`instantString`); rotation dates must exist on the calendar. Zone-less handling (D3) deliberately unchanged. | `packages/shared/src/schemas/common.ts`, `plan.ts`, `staffing-proposals.ts` |
| W2-AVAIL-D1 | Timezone lib throws `TimeInputError`; error handler answers 400. | `packages/shared/src/lib/timezone.ts`, `backend/src/middleware/error-handler.ts` |
| W2-AVAIL-D2 | Blockout RPC errors go through `fromPostgrestError` (P0002 → 404). | `backend/src/routes/blockouts.ts` |
| W2-PLANS-D2 | Page beyond the end → 200 `data: []` with the real `total`. | `backend/src/routes/plans.ts` |
| API-D4 | Organization timezone validated as IANA (create/update). Mobile `deviceTimeZone()` falls back to `UTC`. | `packages/shared/src/schemas/organization.ts` |
| API-D3 (chart) | Chart read is scoped to the active organization. | `backend/src/services/songs.ts` |
| API-D6 | Duplicate position names rejected by the schema; a failed position insert removes the new team. | `packages/shared/src/schemas/team.ts`, `backend/src/routes/teams.ts` |
| P0 follow-up (people_directory writable) | `people_directory` is an auto-updatable view owned by postgres; Supabase default privileges had granted `authenticated` INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES, so any member could edit/delete any Person via `PATCH/DELETE /rest/v1/people_directory`. Writes revoked from authenticated/anon/public/service_role (SELECT kept for authenticated/service_role). Audit of every `public` view: no other view had write grants. Live: member PATCH/DELETE/POST → 403 `42501`, row unchanged. New views must revoke writes explicitly (the project has no `alter default privileges` pattern); section E of the SQL suite enforces it. | `20261119000400_people_directory_read_only.sql` |

Tests: `supabase/tests/qa-wave2-fixes.sql` (section E fails with the old grants; sections B and C verified to fail with the previous function bodies; A and D rely on objects/policies that did not exist), `packages/shared/src/schemas/input-hygiene.test.ts`, `packages/shared/src/lib/approvals.test.ts`, `backend/src/lib/params.test.ts`, additions to `backend/src/lib/errors.test.ts`, `mobile/src/lib/replacements.test.ts`, `mobile/src/lib/church-platform.test.ts`.

Behaviour notes: a legacy org-wide `scheduler` (not admin) now sees blockout times with reasons redacted and manages only People on a team; People on no team are managed by self/admin/delegate only. Pre-existing failures not addressed: 5 shared i18n tests and `i18n:check` (179 `vi` `missing_plural_form`, Node ICU 79 now reports a `one` category for Vietnamese); SQL suites `f08-release-reminders`, `f10-plan-templates`, `f11-order-editing`, `f14-rehearsal-media`, `f15-structured-imports`, `member-avatars-and-team-rosters` fail identically with this branch's changes reverted in-transaction.
