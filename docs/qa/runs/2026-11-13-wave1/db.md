# Wave 1 - Track DB: database suites (2026-11-13)

Branch feature/app-store-review-demo. Local Supabase, container `supabase_db_service-center`. No source, migration, test or git changes were made.
Scripts ran through `docker exec -i ... psql -U postgres -v ON_ERROR_STOP=1 < file` (same as the headers). `assignment-notifications-rls.sql` names `npx supabase db query --local`; I ran it with psql instead. Durations are whole seconds (all under 6s).

## Pre-flight
- Profiles 1111, 2222, 3333, 4444 and 5555 all exist. Org aaaaaaaa-...0001 is "Riverside Community Church". Teams cccccccc-...0001/2/3 are Worship Band, Production and Hospitality. The org has 5 active members (owner 1111, scheduler 2222, members 3333, 4444, 5555).
- Migrations: 65 files and 65 rows in `supabase_migrations.schema_migrations`, versions identical, latest 20261110000000. No mismatch.
- **Environment drift, which matters for the results.**
  - Orgs present: riverside, app-review-demo and mob032-hope-mvlpxlxo. The qa-20261113-* orgs did not exist yet when I looked.
  - The MOB-032 org holds a `people` row for profile 4444 (Riley), created 2026-10-24. Riley therefore has 2 people rows, 1 in riverside and 1 in MOB-032.
  - `user_schedule_settings` already holds a row for Riley (combined_schedule=false, updated 2026-10-24).
  - Both are leftovers of earlier work, not of this wave.

## Results (SQL: 38 scripts, 26 PASS, 3 FAIL-stale, 9 BLOCKED-env)

Plan case IDs are my mapping from each script's subject (the plan has no per-script mapping). `FAIL-stale` = test out of date against the current schema. `BLOCKED-env` = the script died during fixture setup because of drift in the shared DB, so it did not test its subject.

| script | kind | plan IDs | status | s | notes |
|---|---|---|---|---|---|
| assignment-notifications-rls | sql | NOTIF, ACL | PASS | 0 | |
| assignment-response-history | sql | RESP-01..04 | PASS | 0 | |
| atomic-plan-copy | sql | TEMPLATE, PLAN copy atomicity | PASS | 0 | |
| delivery-outbox | sql | DELIVERY-01..02 | PASS | 0 | |
| device-push-token-leases | sql | device tokens | PASS | 0 | |
| f01-scoped-access | sql | ACL-01..05, tenant isolation | PASS | 1 | |
| f02-person-identity | sql | PEOPLE | PASS | 0 | |
| f02-roster-extensions | sql | PEOPLE | PASS | 0 | |
| f03-preferences-delegation | sql | AVAIL, DELEG | BLOCKED-env | 0 | `user_schedule_settings_pkey` duplicate on insert for Riley (line 383). A row from 2026-10-24 already exists. |
| f04-assigned-times | sql | TIME | PASS | 0 | |
| f05-staffing-matrix | sql | MATRIX-01 | PASS | 1 | |
| f06-rotations-proposals | sql | PROPOSE-01..02 | PASS | 0 | |
| f07-signups-replacements | sql | OPPORT-01..02, REPLACE | BLOCKED-env | 0 | "more than one row returned by a subquery" (Riley people lookup). |
| f08-matrix-release-batch | sql | RELEASE-01..02 | BLOCKED-env | 0 | same subquery error |
| f08-release-reminders | sql | RELEASE, DELIVERY | BLOCKED-env | 0 | same subquery error |
| f09-notes-messages-chat | sql | CHAT-01 | BLOCKED-env | 0 | same subquery error |
| f10-plan-reschedule | sql | TEMPLATE-03 | BLOCKED-env | 0 | same subquery error |
| f10-plan-templates | sql | TEMPLATE-01..02 | BLOCKED-env | 0 | same subquery error |
| f11-idempotent-item-create | sql | ORDER-02 | PASS | 0 | |
| f11-order-editing | sql | ORDER-01 | FAIL-stale | 0 | "FAIL: copy dropped leader/segment". See Failures. |
| f12-live-runs | sql | LIVE-01 | PASS | 0 | |
| f13-files | sql | FILE | PASS | 0 | |
| f14-rehearsal-media | sql | media / stage layouts | FAIL-stale | 0 | "Someone on this layout is not on the roster". See Failures. |
| f15-arrangement-curation | sql | SONG | PASS | 1 | |
| f15-song-curation | sql | SONG-02..03 | PASS | 0 | |
| f15-structured-imports | sql | IMPORT-01 | FAIL-stale | 0 | `insufficient_privilege` in `structured_import_context`. See Failures. |
| f16-attendance-reports | sql | ATTEND | PASS | 0 | |
| f17-developer-api | sql | HOOK | PASS | 0 | |
| i18n-preferred-language | sql | i18n | PASS | 0 | |
| i18n-structured-notices | sql | i18n | PASS | 0 | |
| member-avatars-and-team-rosters | sql | PEOPLE/teams | PASS | 0 | |
| mob005-assignment-removal | sql | RESP | PASS | 1 | |
| mob005-snapshots-and-attendance | sql | RESP/ATTEND | PASS | 0 | |
| mob006-availability | sql | AVAIL | PASS | 0 | |
| mob009-signup-claims | sql | OPPORT | BLOCKED-env | 0 | same subquery error |
| mob010-replacements | sql | REPLACE-02 | BLOCKED-env | 0 | same subquery error |
| mob011-delegation | sql | DELEG | PASS | 0 | |
| owner-people-permissions | sql | ACL, people privacy | PASS | 1 | |

## Results (shell: 21 scripts, 19 PASS, 2 FAIL)

For the shell suites, "PASS" means exit code 0 and the script's own PASS line.

| script | kind | plan IDs | status | s | notes |
|---|---|---|---|---|---|
| f02-concurrent-link | sh | PEOPLE identity link | PASS | 3 | |
| f03-concurrent-request | sh | AVAIL/DELEG request | PASS | 2 | one logical request |
| f04-concurrent-commit | sh | TIME commit | PASS | 2 | |
| f05-concurrent-matrix | sh | MATRIX-01 | PASS | 2 | |
| f06-concurrent-commit | sh | PROPOSE-02 | PASS | 1 | |
| f07-concurrent-allocation | sh | OPPORT-02, REPLACE-02 | BLOCKED-env | 1 | exit 3, uuid parse error. The script's `sam`/`riley` shell vars capture 2 ids (Riley duplicate). Capacity race not exercised. |
| f08-concurrent-matrix-release | sh | RELEASE-02 | PASS | 1 | |
| f08-concurrent-worker | sh | DELIVERY-02 | PASS | 2 | |
| f09-concurrent-messages | sh | CHAT-01 | BLOCKED-env | 1 | exit 1. Same 2-uuid error, then "FAIL: stale audience version was accepted". Checks 1, 2a, 2b and 3 passed. The final FAIL probably follows from the failed fixture insert, not shown to be a real defect. |
| f10-concurrent-apply | sh | TEMPLATE | PASS | 3 | |
| f10-concurrent-reschedule | sh | TEMPLATE-03 | PASS | 0 | |
| f11-concurrent-item-create | sh | ORDER-02 | PASS | 2 | |
| f11-concurrent-order | sh | ORDER-02 | PASS | 1 | |
| f12-concurrent-control | sh | LIVE-02 | PASS | 3 | |
| f13-concurrent-finalize | sh | FILE-03 | PASS | 5 | |
| f15-concurrent-arrangements | sh | SONG-02 | PASS | 2 | |
| f15-concurrent-bulk | sh | SONG-03 | PASS | 2 | |
| f15-concurrent-import | sh | IMPORT-01 | PASS | 2 | |
| f16-concurrent-attendance | sh | ATTEND-01 | PASS | 2 | |
| f17-concurrent-webhooks | sh | HOOK-01 | PASS | 0 | |
| mob005-concurrent-token | sh | RESP-03..04 | PASS | 1 | |

Totals: 59 scripts. SQL 26 PASS / 3 FAIL-stale / 9 BLOCKED-env. Shell 19 PASS / 2 BLOCKED-env. Overall 45 PASS, 3 FAIL-stale, 11 BLOCKED-env.
No real RLS, atomicity or race defect was observed in any script that ran to completion.

## Failures

### Environment (BLOCKED-env): Riley has 2 `people` rows
- Affected: f07, f08-matrix-release-batch, f08-release-reminders, f09-notes-messages-chat, f10-plan-reschedule, f10-plan-templates, mob009, mob010 (SQL), plus f07-concurrent-allocation and f09-concurrent-messages (sh).
- Cause: the fixtures look up people with `(select id from public.people where profile_id='4444...')` and no org filter. The MOB-032 org (owned by another agent) contains a person row for Riley's profile, so the scalar subquery returns 2 rows.
- Not fixed: I may not touch MOB-032, and the test files are not mine to edit.
- Impact: the OPPORT-02 (final-slot capacity race), REPLACE-02 and RELEASE/CHAT tests did not run. OPPORT-02 and REPLACE-02 therefore have no passing evidence in this run. Re-run them once the stray Riley person row is gone or the tests filter by organization.
- f03-preferences-delegation (different cause): Riley already has a `user_schedule_settings` row from 2026-10-24, so the insert at line 383 hits the primary key. The table has no org column. It is a stale fixture left in the shared DB.

### FAIL-stale: tests out of date against migration 20261109000000_owner_people_permissions
That migration added the restrictive policy `people_owner_privacy`. A non-owner now sees only their own `people` row, and `people.manage` and `people.view_private` are owner-only. I confirmed it: as Jordan (scheduler) in the seed org, `select from people` returns only Jordan.
- f14-rehearsal-media: Jordan (scheduler) inserts a stage layout that references Riley's person_id. The roster trigger runs `select ... from public.people` under RLS, so Riley is invisible and it raises "not on the roster". Invariant intended: layouts only reference org roster people. Likely product issue to review: non-owner leaders cannot place other people on a stage layout.
- f15-structured-imports: actor 2222 (scheduler) calls `structured_import_context` for kind `people`. `private.can_import` requires `people.manage`, which schedulers no longer have. Maps to IMPORT-01. The people-import path now needs an owner actor.
- f11-order-editing: after Jordan copies plan A to plan B, `leader_person_id` is dropped. The copy keeps a leader only if `exists (select 1 from people ...)` is visible to the caller (migration 20261028000000, line 304). For a non-owner scheduler, RLS hides Sam, so the leader is cleared silently. Maps to ORDER-01/TEMPLATE.
- These three are probably test drift. The f11 case may also be a functional regression: a scheduler copying a plan silently loses leaders. Worth a product decision (make the copy function `security definer` for that check, or accept it).

## Leftover-fixture check
Method: row counts per public table with an `organization_id` column for the seed org (103 tables), compared before the first .sh and after each .sh.
- Fixture rows: no core fixture rows remain (plans, people, teams, items, etc. all back to baseline).
- Rows that stayed in 6 tables after the shell suites ran:
  - `person_roster_events`: 46 -> 64 (18 rows, 2026-11-13 21:03:05..21:03:17). Audit log, not deleted by cleanup.
  - `staffing_matrix_commits`: 0 -> 1, from f05/f08 matrix runs.
  - `delivery_effects`: 0 -> 1.
  - `reminder_jobs`: 0 -> 57, all `skipped`, all pointing at existing seed plans. These came from f08-concurrent-worker running due jobs.
  - `song_curation_events`: 4 -> 5, from f15-concurrent-bulk (its cleanup deletes only the test song's events).
  - `reminder_recompute_queue`: 5 -> 0. The worker script drained 5 pre-existing queue rows.
- None of these tables is cleaned by the scripts' cleanup blocks, and they look like script side effects (audit and effect logs, drained queue). Attribution is a judgment: I cannot rule out that another agent's API writes to the seed org contributed to `person_roster_events`. Nothing was cleaned up by me.
- f07-concurrent-allocation and f09-concurrent-messages failed mid-run, but the row-count diff showed no additional leftovers from them.

Scratch outputs per script are in the session scratchpad (the `sql/` and `sh/` folders), not secrets.
