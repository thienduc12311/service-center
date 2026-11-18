# QA-11 live control, attendance, metrics (wave 3)

- Package: QA-11 (LIVE-01, LIVE-02 API part, LIVE-03, ATTEND-01, REPORT-01)
- Date: 2026-11-18. Commit `5bedb99` (branch `feature/qa-wave3`, equals `main`). Migrations as applied at that commit.
- Environment: API http://localhost:4000, local Supabase (REST/Auth :54321, DB via `docker exec`), no browser, no device. API and DB only.
- Namespace: orgs `qa-20261118-live-a` (c9115ee2-6d94-4603-963f-988594a3cf88), `qa-20261118-live-b` (70a67b2a-cbf4-4f61-8b5d-da2188eadd1e); users `<alias>.qa20261118.live@example.test` (owner, admin, scoped, legacy, bandlead, prodlead, confirmed, pending, candidate, candidateb, declined, member, librarian, betaowner, outsider). Passwords only in the agent scratchpad.
- Method: service role used only for setup (users, org via `private.create_church`, memberships) and for two labelled fault injections (expire a lease with SQL; reset own attendance rows between race iterations). Everything else through the real API with each actor's own token. DB/RLS evidence uses PostgREST with the caller JWT. Races use a thread barrier against the API, 10 to 20 iterations each.
- Totals: 412 case records: PASS 393, FAIL 5, BLOCKED 0, NOT_RUN 13, NOT_APPLICABLE 1.

## Fixture shape

| Key | Object | Notes |
|---|---|---|
| D04 | plan `e3a2c3bd-86b4-4fc1-9109-14a96f999179` Sunday 2026-11-22, times Rehearsal 07:30, 09:00, 11:00 (America/Chicago) | 10 needed positions, 8 assignments exactly per the D04 ledger (3 confirmed, 4 unconfirmed, 1 declined, 3 vacant: Drums/Camera/Usher). Items: header, Welcome 60, song 240, Prayer 120, header, Sermon 1800, Closing 30 (later edited: Welcome 90, +Late Addition 45). |
| D14 A | plan `33a20adc-4aa8-4409-aa1a-64229c1b475c` 2026-11-29 | owner WL, confirmed Electric, pending Acoustic (all times) + Bass (09:00 only), candidate Keys (never marked). Oracle marks via bandlead; correction pending 09:00 unknown to present via owner. Usage song twice. |
| D14 B | plan `3246747a-1157-4ca9-ac72-5103a0553a44` 2026-12-06 | usage song once (3 occurrences / 2 plans across A+B). |
| D14 RunTimes | plan `f8075e41-05e9-435e-b4b0-3c70ae07dfd9` 2026-12-13 | items 60 + 120; 09:00 run ended, start corrected so elapsed 200 s; 11:00 run left live (excluded from report). |
| D14 C | plan `6d3bc8aa-f9fd-458f-8e99-d2fcfaa20211` 2026-12-20 | clone of A, used for the pre-correction oracle (present 3, absent 2, unknown 1) then the correction (4/2/0). Also holds one prepared (unreleased) Sound request for `candidateb`. |
| Filter plans | 2027-01-10..14: published, boundary (2027-01-11T05:30Z = Jan 10 23:30 Chicago), draft, archived, Midweek | one filter song each. |
| Other | Midweek plan `440f31c2-4676-451a-aa78-04bb27bcd549` (service type Midweek), draft plan `60ef53ab-08c6-4ba8-9465-b1d23715d2a4` | scope and discard tests. |
| Access | `scoped`: scoped mode, plans.edit + scheduling.manage on Sunday type only. `bandlead`/`prodlead`: scheduling.manage on team Band/Production only. `librarian`: songs.manage org-wide. `legacy`: legacy scheduler. | |

Source vs plan notes (not defects): validation errors answer 422 (plan says "invalid"); a live run lease is renewed only by the explicit `renew` heartbeat, not by commands (clients must heartbeat within 90 s); the participation report summary has present/absent only (row level has unknown); report ranges allow 366 inclusive local days.

## Defects

### W3-LIVE-D1 (P1) Run commands succeed with no lease when the controller is vacant (and on ended runs)
- Repro: owner creates a run, starts it, sends `release_control`. Then any other plan editor (e.g. `admin`) sends `POST /runs/:id/actions` with `{action:'end'|'resume'|'pause', client_id:'x', action_id:<new>, expected_revision:<current>}` and no `take_control`. Expected 409 `run_control_lost`. Actual 200 and the transition is recorded with that actor. Same after `end`: `set_policy` by an editor returns 200 and appends a transition and bumps revision on an ENDED run (history changes after end). `renew` on a vacant or ended run returns 400 (constraint violation, see D2) instead of 409.
- Cause: `v_holds` is NULL (not false) when `controller_user_id` is NULL, so `if not v_holds then raise ...` never fires.
- Suspected source: `supabase/migrations/20261029000000_f12_live_runs.sql:446-451` (v_holds), guards at `:494` (discard), `:503` (all control commands), renew at `:451`; `set_policy` (`:514`) also lacks a status guard. Fix idea: `v_holds := coalesce(..., false)`; refuse `set_policy`/`release_control` on ended/discarded runs.
- Impact: breaks "one authoritative controller" for any run after a deliberate release; limited to users with plans.edit on the plan, no cross-tenant effect.
- Cases: LIVE-02.vacant-lease.command-without-control, LIVE-02.vacant-controller.command-by-non-holder, LIVE-01.action.set_policy.after-end, LIVE-02.renew.after-end.

### W3-LIVE-D2 (P2) Constraint-violation errors return the raw failing row
- Repro: after D1, `POST /runs/:id/actions {action:'renew', client_id:'x'}` as an editor on a vacant run. Response 400 `A value failed a database constraint` with `details: "Failing row contains (...)"` including the run's idempotency key and snapshot excerpt. Violates the rule not to expose database details.
- Suspected source: `backend/src/lib/errors.ts:135-136` (23514, and similarly 23505 at `:132`, 23503 at `:134`, pass `error.details` to the client).

### W3-LIVE-D3 (P2) Participation report summary omits the recorded-unknown total
- Repro: D14 C after the oracle marks (present 3, absent 2, unknown 1): `GET /reports/participation?from=2026-12-20&to=2026-12-20`. Summary has `present` 3, `absent` 2 but no `unknown`; the report's own definitions list "Unknown". Row level and CSV have `unknown` (pending: 1), so only per-row sums reach the oracle.
- Expected: `summary.unknown` = 1 (and a recorded-records denominator so unknown vs unmarked is visible). Actual: key missing.
- Suspected source: `packages/shared/src/types/reports.ts:223-230` (`ParticipationSummary`) and `packages/shared/src/lib/reports.ts:~404` (summary build).

### W3-LIVE-D4 (P2, cosmetic) CSV preamble prints irrelevant filter lines
- `song-usage` and `run-times` CSV preambles list "Responses", "Teams", "Archived people", "Rehearsals" although those filters do not apply to them. Source: `packages/shared/src/lib/reports.ts` (`reportToCsv` preamble). Not exercised further.

No P0 found. No cross-tenant read or write, no unauthorized persisted write, no lost write, no double-applied command, no duplicate attendance record, no hidden prepared request in any report.


## Results

### LIVE-01 Run control, viewers, RLS (85 records: PASS 82, FAIL 1, NOT_RUN 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| LIVE-01.create.member | member (no plans.edit) | API POST /plans/:id/runs | 403, no run row | 403 | PASS |
| LIVE-01.create.bandlead | bandlead (no plans.edit) | API POST /plans/:id/runs | 403, no run row | 403 | PASS |
| LIVE-01.create.prodlead | prodlead (no plans.edit) | API POST /plans/:id/runs | 403, no run row | 403 | PASS |
| LIVE-01.create.candidate | candidate (no plans.edit) | API POST /plans/:id/runs | 403, no run row | 403 | PASS |
| LIVE-01.create.outsider.orgA-header | outsider | API | 403 not a member | 403 | PASS |
| LIVE-01.create.betaowner.orgA-header | betaowner | API | 403 not a member | 403 | PASS |
| LIVE-01.create.betaowner.orgB-header | betaowner | API | 404 plan not found in org B | (404, "{'error': 'Plan not found', 'code': 'not_found'}") | PASS |
| LIVE-01.create.owner.rehearsal-time | owner | API | 404 (only service times run) | (404, "{'error': 'Service time not found', 'code': 'not_found'}") | PASS |
| LIVE-01.create.owner.unknown-time | owner | API | 404 | 404 | PASS |
| LIVE-01.create.scoped.midweek-out-of-scope | scoped (Sunday only) | API | 403/404 (no plans.edit on Midweek) | (403, "{'error': 'You do not have access to do that', 'code': 'forbidden'}") | PASS |
| LIVE-01.create.owner | owner | API | 201 run ready, owner holds lease, rev1 | (201, 'ready') | PASS |
| LIVE-01.create.owner.retry-same-key | owner | API | 200 replayed, same run | (200, True) | PASS |
| LIVE-01.create.owner.second-run-same-time | owner | API | 409 run_exists | (409, "{'error': 'This service time already has a run. Open it, or discard it to start over.', 'code': 'run") | PASS |
| LIVE-01.create.owner.key-reuse-other-time | owner | API | 409 idempotency_key_reused | (409, "{'error': 'That request id was already used for another run', 'code': 'idempotency_key_reused'}") | PASS |
| LIVE-01.create.owner.blank-client | owner | API | validation error (project convention 422), no run row | 422 | PASS |
| LIVE-01.create.owner.short-key | owner | API | validation error (project convention 422), no run row | 422 | PASS |
| LIVE-01.create.owner.bad-policy | owner | API | validation error (project convention 422), no run row | 422 | PASS |
| LIVE-01.state.member | member | API GET /runs/:id/state | 200 ready run, can_control per role | (200, False) | PASS |
| LIVE-01.state.bandlead | bandlead | API GET /runs/:id/state | 200 ready run, can_control per role | (200, False) | PASS |
| LIVE-01.state.candidate | candidate | API GET /runs/:id/state | 200 ready run, can_control per role | (200, False) | PASS |
| LIVE-01.state.owner | owner | API GET /runs/:id/state | 200 ready run, can_control per role | (200, True) | PASS |
| LIVE-01.state.scoped | scoped | API GET /runs/:id/state | 200 ready run, can_control per role | (200, True) | PASS |
| LIVE-01.state.legacy | legacy | API GET /runs/:id/state | 200 ready run, can_control per role | (200, True) | PASS |
| LIVE-01.state.admin | admin | API GET /runs/:id/state | 200 ready run, can_control per role | (200, True) | PASS |
| LIVE-01.state.no-idempotency-key-leak | member | API | state omits idempotency_key / people / notes | ['id', 'status', 'plan_id', 'ended_at', 'revision', 'snapshot', 'paused_at', 'time_name', 'created_at', 'created_by', 'started_at', 'updated_at', 'snapshot_at', | PASS |
| LIVE-01.state.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| LIVE-01.state.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| LIVE-01.state.betaowner.orgB-header-other-tenant-run | betaowner | API | 404 run not found | (404, "{'error': 'Run not found', 'code': 'not_found'}") | PASS |
| LIVE-01.state.outsider.orgB-header-other-tenant-run | outsider (org B member) | API | 404 run not found | (404, "{'error': 'Run not found', 'code': 'not_found'}") | PASS |
| LIVE-01.state.malformed-id | owner | API | 400 | 400 | PASS |
| LIVE-01.state.unknown-id | owner | API | 404 | 404 | PASS |
| LIVE-01.action.start.member | member | API POST actions | 403, revision unchanged | 403 | PASS |
| LIVE-01.action.start.bandlead | bandlead | API POST actions | 403, revision unchanged | 403 | PASS |
| LIVE-01.action.start.prodlead | prodlead | API POST actions | 403, revision unchanged | 403 | PASS |
| LIVE-01.action.start.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| LIVE-01.action.start.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| LIVE-01.action.start.betaowner.orgB-header | betaowner | API | 404 | (404, "{'error': 'Run not found', 'code': 'not_found'}") | PASS |
| LIVE-01.correction.member | member | API | 403 | 403 | PASS |
| LIVE-01.rls.select.member | member | DB REST caller JWT | member of org reads run | (200, [{'id': 'd603ea17-40b6-43eb-806f-5619e8128221', 'status': 'ready'}]) | PASS |
| LIVE-01.rls.select.outsider | outsider (org B) | DB REST caller JWT | 0 rows | (200, []) | PASS |
| LIVE-01.rls.select-transitions.betaowner | betaowner | DB REST | 0 rows | (200, []) | PASS |
| LIVE-01.rls.update.owner-direct | owner (editor) | DB REST direct table write | denied (no table grants) and unchanged | (403, "{'code': '42501', 'details': None, 'hint': 'Grant the required privileges to the") | PASS |
| LIVE-01.rls.insert-transition.owner-direct | owner | DB REST | denied | (403, "{'code': '42501', 'details': None, 'hint': 'Grant the required privileges to the") | PASS |
| LIVE-01.rls.rpc-action.member | member | DB RPC caller JWT | 42501 | (403, "{'code': '42501', 'details': None, 'hint': None, 'message': 'Only people who can edit this") | PASS |
| LIVE-01.rls.rpc-create.member | member | DB RPC | 42501 | (403, "{'code': '42501', 'details': None, 'hint': None, 'message': 'Only people who can edit this") | PASS |
| LIVE-01.rls.select.anon | anonymous (anon key only) | DB REST | denied/empty | (401, "{'code': '42501', 'details': None, 'hint': 'Grant the required privileges to the") | PASS |
| LIVE-01.rls.rpc-action.outsider | outsider | DB RPC caller JWT | denied, nothing applied (P0002 not found) | HTTP 500 with SQLSTATE P0002 'Run not found' (PostgREST maps non-P0001 custom codes to 500); revision unchanged | PASS |
| LIVE-01.action.advance-before-start | owner | API | 409 run_state | (409, "{'error': 'Start the run first', 'code': 'run_state_invalid'}") | PASS |
| LIVE-01.action.pause-before-start | owner | API | 409 | 409 | PASS |
| LIVE-01.action.end-before-start | owner | API | 409 | 409 | PASS |
| LIVE-01.action.start.owner | owner | API | 200 live; current item = first non-header (index 1); rev2; server started_at, client timestamp ignored | (200, 'live', 1, '2026-11-18T17:16:36.920045+00:00') | PASS |
| LIVE-01.timestamps.server-authoritative | owner | API+DB | transition occurred_at = DB clock, not client value | 2026-11-18 17:16:36.920045+00 | PASS |
| LIVE-01.state.viewer-sees-live | member | API | viewer sees live, server_now present, current_started_at set | ('live', '2026-11-18T17:16:37.078447+00:00') | PASS |
| LIVE-01.action.advance | owner | API | current index 2 (song), rev+1 | (200, 2) | PASS |
| LIVE-01.action.pause | owner | API | status paused, paused_at set | (200, 'paused') | PASS |
| LIVE-01.action.pause-twice | owner | API | 409 run_state | (409, "{'error': 'Only a running service can be paused', 'code': 'run_state_invalid'}") | PASS |
| LIVE-01.action.resume | owner | API | live, paused_ms accumulated >= ~2000 | (200, 2101) | PASS |
| LIVE-01.action.resume-when-live | owner | API | 409 | 409 | PASS |
| LIVE-01.action.jump-to-header | owner | API | jump to header lands on first item under it (index 5) | (200, 5) | PASS |
| LIVE-01.action.jump-to-current | owner | API | 422/400 already current | (400, "{'error': 'That item is already current', 'code': 'bad_request'}") | PASS |
| LIVE-01.action.jump-out-of-range | owner | API | 400 invalid index | (400, '{\'error\': "Choose an item in this run\'s order", \'code\': \'bad_request\'}') | PASS |
| LIVE-01.action.jump-negative | owner | API | validation error | 422 | PASS |
| LIVE-01.action.jump-back | owner | API | jump back to index1 | (200, 1) | PASS |
| LIVE-01.action.set_policy | owner | API | policy service_end | 200 | PASS |
| LIVE-01.action.set_policy-invalid | owner | API | 422 | 422 | PASS |
| LIVE-01.state.viewer-matches-controller | member vs owner | API | same revision/index/status | (12, 6) | PASS |
| LIVE-01.history.viewer | member | API GET history | 200 with transitions & actuals, can_control false | (200, 12) | PASS |
| LIVE-01.history.monotonic-revisions | member | API | transition revisions strictly 1..n contiguous | [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] | PASS |
| LIVE-01.action.end.member | member | API | 403 | 403 | PASS |
| LIVE-01.action.advance-past-last | owner | API | at last item (6) advance refused; rev unchanged | (400, "{'error': 'This is the last item. End the run instead.', 'code': 'bad_request'}") | PASS |
| LIVE-01.action.refresh-snapshot-started | owner | API | 409 run_state | (409, "{'error': 'A started run keeps the order it started with', 'code': 'run_state_in") | PASS |
| LIVE-01.action.end.owner | owner | API | ended; controller cleared; ended_at set | (200, 'ended') | PASS |
| LIVE-01.action.advance.after-end | owner | API | 409 run_state/ over | (409, "{'error': 'Start the run first', 'code': 'run_state_invalid'}") | PASS |
| LIVE-01.action.pause.after-end | owner | API | 409 run_state/ over | (409, "{'error': 'Only a running service can be paused', 'code': 'run_state_i") | PASS |
| LIVE-01.action.start.after-end | owner | API | 409 run_state/ over | (409, "{'error': 'This run has already started', 'code': 'run_state_invalid'}") | PASS |
| LIVE-01.action.take_control.after-end | owner | API | 409 run_state/ over | (409, "{'error': 'This run is over', 'code': 'run_state_invalid'}") | PASS |
| LIVE-01.action.set_policy.after-end | owner (no lease; run ended) | API | 409 run over, history not appended | 200: ended run accepted set_policy, revision+1, new transition appended after end | FAIL |
| LIVE-01.scope.scoped-state-midweek | scoped (Sunday only) | API | can read state (member), can_control false | 200 | PASS |
| LIVE-01.scope.scoped-action-midweek | scoped (Sunday only) | API | 403, nothing applied | 403 | PASS |
| LIVE-01.list.viewer-sees-both-occurrences | member | API | 09:00 and 11:00 each with ended run; can_control false | ['ended', 'ended'] | PASS |
| LIVE-01.notes.leaders-note-not-in-live-payload | member viewer | API state/history/list | Live payloads never contain a leaders-only note |  | PASS |
| LIVE-01.notes.leaders-note-hidden-from-member | member | API GET notes | sentinel absent for member | 200 | PASS |
| LIVE-01.notes.leaders-note-visible-to-owner | owner | API | sentinel present for editor (control) | 200 | PASS |
| LIVE-01.surface.web | - | Web /plans/:id/live controller/viewer/stage display | per plan | not run: browser owned by QA-09 | NOT_RUN |
| LIVE-01.surface.mobile | - | Mobile plan/live/[id] viewer/controller | per plan | not run: no mobile/simulator run in this package | NOT_RUN |

### LIVE-02 Lease, takeover, races, retries (43 records: PASS 36, NOT_RUN 4, FAIL 3)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| LIVE-02.renew.holder | owner | API | 200 lease extended ~90s | 200 | PASS |
| LIVE-02.renew.not-recorded | owner | DB | renew writes no transition/revision change | 21 | PASS |
| LIVE-02.renew.non-holder | scoped | API | 409 run_control_lost | (409, "{'error': 'You are not controlling this run. Nothing was applied.', 'code': 'run") | PASS |
| LIVE-02.renew.holder-other-client | owner other tab | API | 409 run_control_lost (lease = user+client) | (409, "{'error': 'You are not controlling this run. Nothing was applied.', 'code': 'run") | PASS |
| LIVE-02.renew.viewer | member | API | 403 | 403 | PASS |
| LIVE-02.take_control.while-held | scoped | API | 409 run_control_held, nothing applied | (409, "{'error': 'QA Live Owner is controlling this run. Take over deliberately to replace them.', 'code': ") | PASS |
| LIVE-02.take_control.same-user-other-client | owner other tab | API | 409 run_control_held (deliberate) | (409, "{'error': 'QA Live Owner is controlling this run. Take over deliberately to replace them.', 'code': ") | PASS |
| LIVE-02.take_over.viewer | member | API | 403 | 403 | PASS |
| LIVE-02.take_over.unauthorized-leader | bandlead | API | 403 | 403 | PASS |
| LIVE-02.take_over.stale-revision | scoped | API | 409 run_changed | (409, "{'error': 'The run changed since you last saw it. Nothing was applied.', 'code': 'run_revision_stale") | PASS |
| LIVE-02.take_over.scoped | scoped | API | 200; controller=scoped; rev+1 | (200, 'QA Scoped') | PASS |
| LIVE-02.take_over.records-previous | scoped | DB transition details | previous_controller = owner, previous_lease_valid true | {'previous_lease_valid': True, 'previous_controller_name': 'QA Live Owner', 'previous_controller_user_id': 'd5189256-4450-47a6-80ed-676589e7d526'} | PASS |
| LIVE-02.old-controller.command-after-takeover | owner (displaced) | API | 409 run_control_lost, nothing applied | (409, "{'error': 'You are not controlling this run. Nothing was applied.', 'code': 'run_control_l") | PASS |
| LIVE-02.state.displaced-sees-new-controller | owner | API | state shows controller scoped | QA Scoped | PASS |
| LIVE-02.retry.same-action-id | scoped | API | first applied; retry 200 replayed, no new transition/revision | (200, 200, True) | PASS |
| LIVE-02.retry.same-id-different-target | scoped | API | replay answers (same action name) without applying a different target | (200, True) | PASS |
| LIVE-02.retry.same-id-different-action | scoped | API | 409 idempotency_key_reused | (409, "{'error': 'That action id was already used for a different command', 'code': 'idempotency_") | PASS |
| LIVE-02.retry.same-id-other-user | owner | API | 409 idempotency_key_reused (id belongs to scoped) | (409, "{'error': 'That action id was already used for a different command', 'code': 'idempotency_") | PASS |
| LIVE-02.stale-revision.command | scoped | API | 409 run_changed nothing applied | (409, "{'error': 'The run changed since you last saw it. Nothing was applied.', 'code':") | PASS |
| LIVE-02.future-revision.command | scoped | API | 409 (revision must match exactly) | 409 | PASS |
| LIVE-02.revision-zero.command | scoped | API | 409 | 409 | PASS |
| LIVE-02.lease-expired.holder-command | scoped (expired holder) | API | 409 run_control_lost | (409, "{'error': 'You are not controlling this run. Nothing was applied.', 'code': 'run") | PASS |
| LIVE-02.lease-expired.renew | scoped | API | 409 (expired lease cannot be renewed) | 409 | PASS |
| LIVE-02.lease-expired.take_control-by-other | legacy | API | 200 take_control succeeds on expired lease | (200, "{'run': {'id': 'd603ea17-40b6-43eb-806f-5619e8128221', 'status': 'paused', 'plan") | PASS |
| LIVE-02.lease-expired.records-previous | legacy | DB transition details | previous_lease_valid=false, previous=scoped | {'previous_lease_valid': False, 'previous_controller_name': 'QA Scoped', 'previous_controller_user_id': 'ad0bf956-daee-488b-ba3d-39a95164f9dd'} | PASS |
| LIVE-02.release_control | legacy | API | controller cleared | 200 | PASS |
| LIVE-02.vacant.take_control | admin | API | 200 | 200 | PASS |
| LIVE-02.integrity.after-sequential | - | DB | transition revisions contiguous & unique, equals run.revision | (26, 26, 26, 26) | PASS |
| LIVE-02.race.simultaneous-commands-same-revision | owner x2 parallel (20 iterations) | API barrier race | each iteration: exactly one 200 + one 409 run_changed; +1 transition; revision +1; contiguous | 20/20 iterations clean; ["([200, 409], 'run_revision_stale')"] | PASS |
| LIVE-02.race.holder-vs-nonholders | owner(holder) vs scoped vs legacy (10 iterations) | API barrier race | holder wins; non-holders 409 (control lost / changed), exactly +1 transition | 10/10 clean | PASS |
| LIVE-02.race.simultaneous-take_over | owner/scoped/legacy/admin parallel (10 iterations) | API barrier race | exactly one new controller; others 409 run_changed; controller row = winner; one take_over transition | 10/10 clean; winners {'owner': 3, 'admin': 4, 'legacy': 3} | PASS |
| LIVE-02.race.same-action-id-parallel-retry | owner x8 same action id (10 iterations) | API barrier race | one applied, 7 replayed 200, +1 transition | 10/10 clean | PASS |
| LIVE-02.race.parallel-create-same-time | owner/scoped/legacy/admin different keys | API barrier race | exactly one 201, others 409 run_exists, one non-discarded run row | ([201, 409, 409, 409], '1') | PASS |
| LIVE-02.integrity.after-races | - | DB | transitions contiguous unique equal revision | (90, 90, 90, 90) | PASS |
| LIVE-02.reconnect.state-reload-authoritative | member viewer | API | no-store; server_now from DB clock; state equals DB row | ('no-store', 90, 90) | PASS |
| LIVE-02.reconnect.viewer-sees-other-controllers-final-state | member viewer | API | viewer state after 90-transition race == controller state | 90 | PASS |
| LIVE-02.poll-network-loss-background.web | viewer/controller | Web | poll resumes, offline banner, controller cannot claim applied | not run (browser owned by QA-09) | NOT_RUN |
| LIVE-02.poll-network-loss-background.mobile | viewer/controller | Mobile native / physical device | background/foreground/reconnect, takeover on device | not run (no physical device; sim not in scope) | NOT_RUN |
| LIVE-02.renew.after-end | admin/owner on ended or vacant run | API | 409 run_control_lost | 400 'A value failed a database constraint' with raw failing row in details (incl. idempotency_key, snapshot excerpt) | FAIL |
| LIVE-02.vacant-controller.command-by-non-holder | admin (never held lease) after owner release_control | API | 409 run_control_lost (or take_control first); nothing applied | got 200: run ended by a user holding no lease | FAIL |
| LIVE-02.vacant-lease.command-without-control | legacy (no lease) after legacy released control, run live | API | 409 run_control_lost | 200: pause applied by user holding no lease (first run; reproduced with resume/end) | FAIL |
| LIVE-02.surface.physical-devices | - | Two physical devices, takeover/background/reconnect | per plan | not run: no physical devices | NOT_RUN |
| LIVE-02.suite.supabase-tests-f12 | - | supabase/tests f12-live-runs.sql + f12-concurrent-control.sh | per plan | not run: scripts target the seed org (aaaaaaaa-...); rules forbid touching seed orgs; API-level barrier races done instead | NOT_RUN |

### LIVE-03 Second occurrence, snapshot, history, corrections (44 records: PASS 41, NOT_APPLICABLE 1, NOT_RUN 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| LIVE-03.second-occurrence.independent-state | owner | API/DB | 11:00 run ready rev1, no started_at while 09:00 run live | ('ready', 1) | PASS |
| LIVE-03.snapshot.live-run-unchanged-by-plan-edit | owner | DB | run9 (live) and run11 (ready) snapshots byte-identical after plan edits | ('20', '22') | PASS |
| LIVE-03.snapshot.version-warning-data | member | API state | plan_content_revision (live) > run.snapshot_revision (pinned) | (22, 20) | PASS |
| LIVE-03.snapshot.refresh-ready-run | owner | API | ready run takes new order incl. Late Addition & 90s Welcome; snapshot_revision=plan revision | (200, 8) | PASS |
| LIVE-03.snapshot.plan-planned-lengths-untouched-by-run | owner | DB | plan_items lengths = what editor set (Welcome 90 only), no run writes | Opening:0,Welcome:60,QA Live Song One:240,Prayer:120,Message:0,Sermon:1800,Closing:30 | PASS |
| LIVE-03.second-occurrence.actions-do-not-touch-other-run | owner | DB | run9 revision/status unchanged by run11 start/advance | (90, 90) | PASS |
| LIVE-03.history.actuals-from-transitions | member | API history | elapsed/planned/actual present; items with variance | (163, 2250, 130) | PASS |
| LIVE-03.history.planned-from-snapshot-not-current-plan | member | API history | planned total=snapshot (60+240+120+1800+30=2250) not edited 90s Welcome/Late Addition | 2250 | PASS |
| LIVE-03.correction.member | member | API | 403 | 403 | PASS |
| LIVE-03.correction.bandlead | bandlead | API | 403 | 403 | PASS |
| LIVE-03.correction.outsider | outsider | API | 403 | 403 | PASS |
| LIVE-03.correction.betaowner.orgB | betaowner | API | 404 | 404 | PASS |
| LIVE-03.correction.blank-reason | owner | API | 422 | 422 | PASS |
| LIVE-03.correction.long-reason | owner | API | 422 | 422 | PASS |
| LIVE-03.correction.non-timing-transition | owner | API | 404 | (404, "{'error': 'That is not a timing transition of this run', 'co") | PASS |
| LIVE-03.correction.unknown-transition | owner | API | 404 | 404 | PASS |
| LIVE-03.correction.stale-revision | owner | API | 409 run_changed | (409, "{'error': 'The run changed since you last saw it. Nothing was applied.") | PASS |
| LIVE-03.correction.before-previous-transition | owner | API | 422 must stay in order | (400, "{'error': 'A corrected time must stay between the times recorded before and afte") | PASS |
| LIVE-03.correction.same-time | owner | API | 400/422 already recorded | (400, "{'error': 'That is already the recorded time', 'code': 'bad_request'}") | PASS |
| LIVE-03.correction.start-after-later-transitions | owner | API | 400/422 out of order | (400, "{'error': 'A corrected time must stay between the times recorded before and afte") | PASS |
| LIVE-03.correction.invalid-date | owner | API | 422 | 422 | PASS |
| LIVE-03.correction.denied-cases-no-rows | - | DB | 0 correction rows after all denials | 0 | PASS |
| LIVE-03.correction.scoped-editor | scoped | API | 200 history with correction | (200, "{'run': {'id': 'd603ea17-40b6-43eb-806f-5619e8128221', 'status': 'ended', 'plan_") | PASS |
| LIVE-03.correction.audit-actor-reason-previous | scoped | DB | actor=scoped, reason stored, previous_at=original end, revision bumped | ['ad0bf956-daee-488b-ba3d-39a95164f9dd', 'QA Scoped', 'Stopwatch said 3s earlier', '2026-11-18 17:19:19.550666+00', '2026-11-18 17:19:16.550666+00', '93'] | PASS |
| LIVE-03.correction.viewer-sees-correction-history | member | API | viewer sees correction w/ actor; transition row unchanged (original occurred_at retained) | QA Scoped | PASS |
| LIVE-03.correction.actuals-use-correction | member | API | ended_at = corrected time | 2026-11-18T17:19:16.550Z | PASS |
| LIVE-03.correction.second-on-same-transition | owner | API | 200, appended (2 rows), latest wins, previous_at = first correction | (200,) | PASS |
| LIVE-03.correction.append-only-trigger.corrections | postgres session | DB | UPDATE refused (PT409 append-only) |  | PASS |
| LIVE-03.history.append-only-trigger.transitions | postgres session | DB | UPDATE refused |  | PASS |
| LIVE-03.history.rest-delete-transitions.owner | owner | DB REST caller JWT | denied; rows intact | 403 | PASS |
| LIVE-03.correction.rest-insert.owner | owner | DB REST | denied | 403 | PASS |
| LIVE-03.correction.rpc.member | member | DB RPC | 42501 | 403 | PASS |
| LIVE-03.correction.rls.betaowner-read | betaowner | DB REST | 0 rows | [] | PASS |
| LIVE-03.correction.live-run | owner | API | 409 run_state (only after end) | (409, "{'error': 'Correct recorded times after the run has ended', 'code': 'r") | PASS |
| LIVE-03.oracle.ended-run-planned-actual | owner | API history | planned 180, actual 200 (elapsed 200), difference +20 | (180, 200, 200) | PASS |
| LIVE-03.second-occurrence.independent-history | owner | API/DB | each run has own transitions; run11 transitions reference only run11; times distinct | ('ended', 'ended') | PASS |
| LIVE-03.discard.no-reason | owner | API | 422 | 422 | PASS |
| LIVE-03.discard.active-run-non-controller | admin | API | 409 run_control_lost (active run only by controller) | (409, "{'error': 'You are not controlling this run. Nothing was applied.', 'code': 'run") | PASS |
| LIVE-03.discard.controller-with-reason | owner | API | discarded, reason stored, controller cleared | (200, 'discarded') | PASS |
| LIVE-03.discard.new-run-after-discard | owner | API | 201 new run; discarded run kept as history | (201,) | PASS |
| LIVE-03.list.runs-newest-first-incl-discarded | member | API | 2 runs listed, service_times shows active run id | (2,) | PASS |
| LIVE-03.notifications.end-leave-stops-live-notifications | owner | API/DB/job | no Live notification exists in frozen source (no live_* delivery kind, no worker path) | source grep: no notification/push for runs in backend/src, migrations; plan item is conditional on feature | NOT_APPLICABLE |
| LIVE-03.surface.web-history | - | Web read-only history view | per plan | not run: browser owned by QA-09 | NOT_RUN |
| LIVE-03.surface.mobile-history | - | Mobile read-only history | per plan | not run: no mobile run | NOT_RUN |

### ATTEND-01 Attendance (101 records: PASS 98, NOT_RUN 3)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ATTEND-01.sheet.member | member | API GET sheet | 403 (no scheduling.manage) | 403 | PASS |
| ATTEND-01.mark.member | member | API POST | 403, no record | 403 | PASS |
| ATTEND-01.sheet.candidate | candidate | API GET sheet | 403 (no scheduling.manage) | 403 | PASS |
| ATTEND-01.mark.candidate | candidate | API POST | 403, no record | 403 | PASS |
| ATTEND-01.sheet.candidateb | candidateb | API GET sheet | 403 (no scheduling.manage) | 403 | PASS |
| ATTEND-01.mark.candidateb | candidateb | API POST | 403, no record | 403 | PASS |
| ATTEND-01.sheet.declined | declined | API GET sheet | 403 (no scheduling.manage) | 403 | PASS |
| ATTEND-01.mark.declined | declined | API POST | 403, no record | 403 | PASS |
| ATTEND-01.sheet.outsider | outsider | API GET sheet | 403 (no scheduling.manage) | 403 | PASS |
| ATTEND-01.mark.outsider | outsider | API POST | 403, no record | 403 | PASS |
| ATTEND-01.sheet.betaowner.orgB | betaowner | API | 404 plan not found | 404 | PASS |
| ATTEND-01.mark.betaowner.orgB | betaowner | API | 404 | 404 | PASS |
| ATTEND-01.sheet.prodlead.no-team-people | prodlead (Production only) | API | 200; Band people hidden: rows 0, hidden_people 4, can_mark_any false | (200, 0, 4) | PASS |
| ATTEND-01.mark.prodlead.band-person-band-team | prodlead | API | 403 cannot record, no record | (403, "{'error': 'You do not have access to do that', 'code': 'forbidden'}") | PASS |
| ATTEND-01.mark.prodlead.forged-own-team-id | prodlead | API | 403 (person is not on Production at that time) | (403, "{'error': 'You do not have access to do that', 'code': 'forbidden'}") | PASS |
| ATTEND-01.mark.owner.wrong-team-for-person | owner | API | 403 (forged team id gains nothing) | (403, "{'error': 'You do not have access to do that', 'code': 'forbidden'}") | PASS |
| ATTEND-01.mark.owner.person-not-scheduled | owner | API | 403 (not on plan) | (403,) | PASS |
| ATTEND-01.mark.owner.unknown-person | owner | API | 403 | 403 | PASS |
| ATTEND-01.mark.owner.invalid-status | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.empty-batch | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.duplicate-person-in-batch | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.short-key | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.negative-revision | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.long-reason | owner | API | 422 | 422 | PASS |
| ATTEND-01.mark.owner.time-of-other-plan | owner | API | 404 plan time not found | 404 | PASS |
| ATTEND-01.sheet.unknown-time | owner | API | 404 | 404 | PASS |
| ATTEND-01.sheet.time-of-other-plan | owner | API | 404 | 404 | PASS |
| ATTEND-01.mark.atomic-batch-one-forbidden | bandlead | API/DB | 403 and no partial writes (0 records, 0 batches rows with result) | (403, 0) | PASS |
| ATTEND-01.mark.batch-bandlead-0900 | bandlead (Band scheduler) | API batch | 200 applied 3, replayed false; revisions 1 | (200, 3) | PASS |
| ATTEND-01.mark.retry-same-key | bandlead | API | replayed true, no new records/events | (200, True) | PASS |
| ATTEND-01.mark.same-key-different-payload | bandlead | API | 409 idempotency_key_reused | (409, "{'error': 'That idempotency key was used for different marks', 'code':") | PASS |
| ATTEND-01.mark.same-key-other-actor-independent | owner | API | key is per actor: owner not blocked by bandlead key; stale (rev0 vs 1) -> 409 attendance_changed | (409, "{'error': 'Attendance changed since you loaded it', 'code': 'attendanc") | PASS |
| ATTEND-01.mark.individual-1100 | bandlead | API | 3 individual 200s | 6 | PASS |
| ATTEND-01.sheet.counts-0900 | bandlead | API | scheduled 4: present1 absent1 unknown1 unmarked1 (candidate) | {'scheduled_people': 4, 'present': 1, 'absent': 1, 'unknown': 1, 'unmarked': 1} | PASS |
| ATTEND-01.sheet.counts-1100 | bandlead | API | scheduled 4: present2 absent1 unknown0 unmarked1 | {'scheduled_people': 4, 'present': 2, 'absent': 1, 'unknown': 0, 'unmarked': 1} | PASS |
| ATTEND-01.sheet.pending-two-positions-one-row-0900 | bandlead | API | pending shows 1 row w/ 2 roles & 1 record | 2 | PASS |
| ATTEND-01.db.pending-single-record-per-occurrence | - | DB | 1 attendance row for pending at 09:00 despite 2 positions |  | PASS |
| ATTEND-01.db.confirmed-absent-stays-absent | - | DB | confirmed assignment stays confirmed; record absent | confirmed/absent | PASS |
| ATTEND-01.db.unconfirmed-present-stays-unconfirmed | - | DB | pending assignments stay unconfirmed after present at 11:00 |  | PASS |
| ATTEND-01.db.candidate-unmarked-no-record | - | DB | no record row for candidate (unmarked != unknown) |  | PASS |
| ATTEND-01.stale.second-leader-old-revision-atomic | owner (stale rev 0 on owner row) | API | 409 attendance_changed; candidate mark (valid) also NOT applied | (409, "{'error': 'Attendance changed since you loaded it', 'code': 'attendance_revision") | PASS |
| ATTEND-01.stale.future-revision | owner | API | 409 | 409 | PASS |
| ATTEND-01.stale.expected-revision-for-no-record | owner | API | 409 (record absent, expected 3) | 409 | PASS |
| ATTEND-01.mark.same-status-unchanged | owner | API | 200 unchanged 1 applied 0, revision stays 1, no new event | (200, 1) | PASS |
| ATTEND-01.correction.pending-0900-to-present | owner | API | 200 applied 1, revision 2 | (200,) | PASS |
| ATTEND-01.correction.history-audit | bandlead | API history | 2 events: unknown (bandlead) -> present (owner, reason), previous_status recorded | [('QA Bandlead', 'unknown'), ('QA Live Owner', 'present')] | PASS |
| ATTEND-01.correction.record-marked-by-latest-actor | - | DB | marked_by = owner (latest), status present | d5189256-4450-47a6-80ed-676589e7d526\|present | PASS |
| ATTEND-01.oracle.totals-after-correction | - | DB | present 4, absent 2, unknown 0; 6 records | absent=2,present=4 | PASS |
| ATTEND-01.history.member | member | API | 403 | 403 | PASS |
| ATTEND-01.history.prodlead-unauthorized-team | prodlead | API/RLS | 200 [] (RLS hides) | (200, '[]') | PASS |
| ATTEND-01.history.betaowner | betaowner | API | 404 | 404 | PASS |
| ATTEND-01.rls.select-records.owner | owner | DB REST caller JWT | 6 rows | (200, 6) | PASS |
| ATTEND-01.rls.select-records.admin | admin | DB REST caller JWT | 6 rows | (200, 6) | PASS |
| ATTEND-01.rls.select-records.legacy | legacy | DB REST caller JWT | 6 rows | (200, 6) | PASS |
| ATTEND-01.rls.select-records.scoped | scoped | DB REST caller JWT | 6 rows | (200, 6) | PASS |
| ATTEND-01.rls.select-records.bandlead | bandlead | DB REST caller JWT | 6 rows | (200, 6) | PASS |
| ATTEND-01.rls.select-records.prodlead | prodlead | DB REST caller JWT | 0 rows | (200, 0) | PASS |
| ATTEND-01.rls.select-records.member | member | DB REST caller JWT | 0 rows | (200, 0) | PASS |
| ATTEND-01.rls.select-records.candidate | candidate | DB REST caller JWT | 0 rows | (200, 0) | PASS |
| ATTEND-01.rls.select-records.outsider | outsider | DB REST caller JWT | 0 rows | (200, 0) | PASS |
| ATTEND-01.rls.select-records.betaowner | betaowner | DB REST caller JWT | 0 rows | (200, 0) | PASS |
| ATTEND-01.rls.select-records.confirmed-self | confirmed | DB REST caller JWT | own 2 records only (09:00 + 11:00) | (200, 2) | PASS |
| ATTEND-01.rls.select-records.pending-self | pending | DB REST caller JWT | own 2 records only (09:00 + 11:00) | (200, 2) | PASS |
| ATTEND-01.rls.select-records.candidateb-no-records | candidateb | DB REST | 0 | 0 | PASS |
| ATTEND-01.rls.select-events.prodlead | prodlead | DB REST | 0 events (all in Band/Plan outside scope) | (200, 0) | PASS |
| ATTEND-01.rls.select-events.pending-self | pending | DB REST | only events of own records (3: 09:00 x2, 11:00 x1) | (200, 3) | PASS |
| ATTEND-01.rls.update-direct.owner | owner | DB REST | denied; totals unchanged | 403 | PASS |
| ATTEND-01.rls.delete-direct.owner | owner | DB REST | denied | 403 | PASS |
| ATTEND-01.rls.delete-events-direct.owner | owner | DB REST | denied | 403 | PASS |
| ATTEND-01.rls.update-direct.bandlead | bandlead | DB REST | denied; totals unchanged | 403 | PASS |
| ATTEND-01.rls.delete-direct.bandlead | bandlead | DB REST | denied | 403 | PASS |
| ATTEND-01.rls.delete-events-direct.bandlead | bandlead | DB REST | denied | 403 | PASS |
| ATTEND-01.rls.insert-direct.owner | owner | DB REST | denied | 403 | PASS |
| ATTEND-01.rls.rpc-record.member | member | DB RPC caller JWT | denied (42501 or P0002); no change | (403, "{'code': '42501', 'details': None, 'hint': None, 'message': 'You canno") | PASS |
| ATTEND-01.rls.rpc-record.prodlead | prodlead | DB RPC caller JWT | denied (42501 or P0002); no change | (403, "{'code': '42501', 'details': None, 'hint': None, 'message': 'You canno") | PASS |
| ATTEND-01.rls.rpc-record.outsider | outsider | DB RPC caller JWT | denied (42501 or P0002); no change | (500, "{'code': 'P0002', 'details': None, 'hint': None, 'message': 'Plan time") | PASS |
| ATTEND-01.rls.rpc-record.bandlead-direct-allowed | bandlead | DB RPC caller JWT | allowed via RPC (authority in function) -> applied; revision 2 | (200, "{'applied': 1, 'records': [{'status': 'absent', 'revision': 2, 'person") | PASS |
| ATTEND-01.sheet.d04-0900-roster | owner | API | 6 people (owner, confirmed, member/Greeter, pending/Acoustic, candidate, candidateb); declined excluded; counts unmarked 6 | ['QA Candidate', 'QA CandidateB', 'QA Confirmed', 'QA Live Owner', 'QA Member', 'QA Pending'] | PASS |
| ATTEND-01.sheet.d04-pending-0900-only-acoustic | owner | API | pending at 09:00 has 1 role (Acoustic; Bass is 11:00 only) | ['Acoustic'] | PASS |
| ATTEND-01.sheet.d04-1100-roster | owner | API | 11:00: owner, confirmed, pending(Bass), candidate, candidateb (member Greeter 09:00-only excluded; declined excluded) | ['QA Candidate', 'QA CandidateB', 'QA Confirmed', 'QA Live Owner', 'QA Pending'] | PASS |
| ATTEND-01.sheet.d04-rehearsal-roster | owner | API | rehearsal: owner, confirmed, pending(Acoustic), candidate, candidateb = 5 | 5 | PASS |
| ATTEND-01.sheet.bandlead-d04-sees-band-only-and-hidden-count | bandlead | API | rows = Band people only (owner, confirmed, pending, candidate); hidden_people = 2 (member Greeter, candidateb Sound) | (4, 2) | PASS |
| ATTEND-01.sheet.prodlead-d04-sees-production-only | prodlead | API | rows = member (Greeter), candidateb (Sound); hidden 4 | (2, 4) | PASS |
| ATTEND-01.sheet.can_mark-flags | bandlead | API | can_mark true on Band roles; prod roles hidden | 4 | PASS |
| ATTEND-01.mark.bandlead-marks-production-person | bandlead | API | 403 | 403 | PASS |
| ATTEND-01.mark.prodlead-batch-mixed-teams | prodlead | API | 403 atomic (Greeter allowed, owner not) -> none applied | 403 | PASS |
| ATTEND-01.mark.prodlead-own-team | prodlead | API | 200 applied 2 | (200,) | PASS |
| ATTEND-01.mark.declined-person-not-markable | bandlead | API | 403 (declined requests are not scheduled) | (403, "{'error': 'You do not have access to do that', 'code': 'forb") | PASS |
| ATTEND-01.mark.person-not-on-that-time | prodlead | API | 403 (Greeter only at 09:00, not 11:00) | (403,) | PASS |
| ATTEND-01.mark.scoped-sunday-all-teams | scoped (Sunday service type) | API | 200: scheduling.manage at service type covers Band | (200, "{'applied': 2, 'records': [{'status': 'present', 'revision': 1, 'perso") | PASS |
| ATTEND-01.mark.legacy-org-wide | legacy scheduler | API | 200 | (200, "{'applied': 1, 'records': [{'status': 'present', 'revision': 1, 'perso") | PASS |
| ATTEND-01.mark.admin | admin | API | 200 | (200, "{'applied': 1, 'records': [{'status': 'absent', 'revision': 1, 'person") | PASS |
| ATTEND-01.mark.scoped-midweek-out-of-scope | scoped | API | 403 (no scheduling scope on Midweek / person not scheduled) | (403,) | PASS |
| ATTEND-01.sheet.d04-counts-after-marks | owner | API | present: owner, candidate? ... counts consistent with rows | {'scheduled_people': 6, 'present': 3, 'absent': 2, 'unknown': 1, 'unmarked': 0} | PASS |
| ATTEND-01.mark.rehearsal-time | bandlead | API | 200; time kind rehearsal recorded | (200,) | PASS |
| ATTEND-01.race.two-leaders-overlapping-batches-cross-order | bandlead vs owner parallel (20 iterations; batches [owner,confirmed] vs [confirmed,owner]) | API barrier race | exactly one batch applies whole (200), other 409 attendance_changed; 2 records, 2 events, single consistent status; no deadlock/500 | 20/20 clean [] | PASS |
| ATTEND-01.race.same-key-parallel-retry | bandlead x6 same idempotency key (10 iterations) | API barrier race | 1 applied, 5 replayed, 2 records/2 events | 10/10 clean | PASS |
| ATTEND-01.race.four-leaders-first-mark-same-person | 4 leaders parallel, same person, expected rev 0 (10 iterations) | API barrier race | exactly one wins; one record (unique index); others 409 | 10/10 clean | PASS |
| ATTEND-01.surface.web | - | Web /reports attendance sheet occurrence/team picker, batch review, stale save UI | per plan | not run: browser owned by QA-09 | NOT_RUN |
| ATTEND-01.surface.mobile | - | Mobile plan/attendance/[id]; offline not shown as saved | per plan | not run: no mobile run | NOT_RUN |
| ATTEND-01.suite.supabase-tests-f16 | - | supabase/tests f16-attendance-reports.sql + f16-concurrent-attendance.sh | per plan | not run: same: seed-org fixtures | NOT_RUN |

### REPORT-01 Reports (139 records: PASS 136, FAIL 1, NOT_RUN 2)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| REPORT-01.participation.C-before-marks | owner | API | present 0 absent 0; rows 4 people; no unknown/rec rows | {'assignments': 5, 'people': 4, 'person_plans': 4, 'present': 0, 'absent': 0, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.oracle.persisted-totals-pre-correction | - | DB | present 3, absent 2, unknown 1; 6 records | absent=2,present=3,unknown=1 | PASS |
| REPORT-01.participation.pre-correction-rows | owner | API | pending present 1 absent 0 unknown 1 (09:00 unknown, 11:00 present); owner 1/1/0; confirmed 1/1/0; candidate 0/0/0 (unmarked != unknown) |  | PASS |
| REPORT-01.participation.pre-correction-summary | owner | API | summary present 3 absent 2; assignments 5 people 4 person_plans 4 (pending 2 assignments, 1 person-plan) | {'assignments': 5, 'people': 4, 'person_plans': 4, 'present': 3, 'absent': 2, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.participation.summary-has-unknown-total | owner | API | definitions list Unknown metric; summary should carry unknown total (1) so present+absent+unknown=6 records | summary keys ['assignments', 'people', 'person_plans', 'present', 'absent', 'teams'] | FAIL |
| REPORT-01.participation.row-sums-equal-oracle | owner | API | sum rows present 3 absent 2 unknown 1 | (3, 2, 1) | PASS |
| REPORT-01.participation.post-correction | owner | API | present 4 absent 2 unknown 0; summary present 4 absent 2; 6 records | (4, 2, 0) | PASS |
| REPORT-01.participation.A-post-correction | owner | API | A: present 4 absent 2 unknown 0 | (4, 2, 0) | PASS |
| REPORT-01.validation.365-days-ok | owner | API | 200 (366-day max inclusive) | 200 | PASS |
| REPORT-01.staffing.oracle-D14 | owner | API | plans 1 needed 5 confirmed 2 pending 3 declined 0 vacancies 0; 3 follow-ups; 5 rows | {'plans': 1, 'needed': 5, 'confirmed': 2, 'pending': 3, 'declined': 0, 'vacancies': 0} | PASS |
| REPORT-01.participation.oracle-D14 | owner | API | assignments 5 people 4 person_plans 4 present 4 absent 2; Band team total 5/4/4 | {'assignments': 5, 'people': 4, 'person_plans': 4, 'present': 4, 'absent': 2, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.song_usage.oracle-D14 | owner | API | occurrences 3, plans 2, songs 1; row 3/2 | {'occurrences': 3, 'songs': 1, 'plans': 2} | PASS |
| REPORT-01.run_times.oracle-D14 | owner | API | 1 run; planned 180 actual 200 diff +20; ongoing 11:00 run excluded | {'runs': 1, 'planned_seconds': 180, 'actual_seconds': 200, 'average_difference_seconds': 20} | PASS |
| REPORT-01.run_times.ongoing-run-excluded | owner | API/DB | ongoing live run exists on same plan but not in report |  | PASS |
| REPORT-01.schedule.oracle-D14 | owner | API | plans 1 assignments 5 people 4; pending Acoustic times [09:00,11:00], Bass [09:00] | {'plans': 1, 'assignments': 5, 'people': 4} | PASS |
| REPORT-01.staffing.oracle-D04-ledger | owner | API | needed 10 confirmed 3 pending 4 declined 1 vacancies 3 (Drums, Camera, Usher); 3 follow-ups pending | {'plans': 1, 'needed': 10, 'confirmed': 3, 'pending': 4, 'declined': 1, 'vacancies': 3} | PASS |
| REPORT-01.staffing.d04-vacant-positions | owner | API | vacancies exactly Drums (declined), Camera, Usher | {'Camera', 'Drums', 'Usher'} | PASS |
| REPORT-01.staffing.d04-followups | owner | API | follow-ups = 4 unconfirmed + 1 declined (Drums) = 5; confirmed excluded | [('Keys', 'unconfirmed'), ('Sound', 'unconfirmed'), ('Drums', 'declined'), ('Bass', 'unconfirmed'), ('Acoustic', 'unconfirmed')] | PASS |
| REPORT-01.staffing.team-filter-team-specific-totals | owner | API | Band: needed 6 confirmed 2 pending 3 declined 1 vacancies 1; Production: needed 4 confirmed 1 pending 1 vacancies 2 (not whole-plan totals) | ((6, 2, 3, 1, 1), (4, 1, 1, 2)) | PASS |
| REPORT-01.participation.D04-ledger | owner | API | assignments 8, people 7 (incl. declined person), person_plans 7 | {'assignments': 8, 'people': 7, 'person_plans': 7, 'present': 3, 'absent': 2, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.participation.D04-pending-two-positions | owner | API | pending: assignments 2 person_plans 1 pending 2 | {'person_id': '43bb357d-f1be-4555-8c11-8d543ae727c9', 'person_name': 'QA Pending', 'archived': False, 'teams': ['Band'], 'assignments': 2, 'person_plans': 1, 'c | PASS |
| REPORT-01.participation.D04-declined-person-row | owner | API | declined person: declined 1, no attendance | {'person_id': '3e64dd6d-56af-4c74-85d0-c13ffb639bff', 'person_name': 'QA Declined', 'archived': False, 'teams': ['Band'], 'assignments': 1, 'person_plans': 1, ' | PASS |
| REPORT-01.filter.include_rehearsals-participation | owner | API | present excludes rehearsal by default; true adds rehearsal records | (3, 4, 3, 1) | PASS |
| REPORT-01.filter.include_rehearsals-schedule | owner | API | rehearsal time listed only with include_rehearsals=true | (['09:00', '11:00'], ['09:00', '11:00', 'Rehearsal']) | PASS |
| REPORT-01.filter.assignment_statuses.confirmed | owner | API | 3 assignments | {'plans': 1, 'assignments': 3, 'people': 3} | PASS |
| REPORT-01.filter.assignment_statuses.unconfirmed | owner | API | 4 assignments | {'plans': 1, 'assignments': 4, 'people': 3} | PASS |
| REPORT-01.filter.assignment_statuses.declined | owner | API | 1 assignments | {'plans': 1, 'assignments': 1, 'people': 1} | PASS |
| REPORT-01.filter.assignment_statuses.confirmed,declined | owner | API | 4 assignments | {'plans': 1, 'assignments': 4, 'people': 4} | PASS |
| REPORT-01.filter.plan_statuses-default-published | owner | API | published only: Pub + Boundary + Midweek = 3 occurrences, 3 plans | {'occurrences': 3, 'songs': 1, 'plans': 3} | PASS |
| REPORT-01.filter.plan_statuses-draft | owner | API | 1 | {'occurrences': 1, 'songs': 1, 'plans': 1} | PASS |
| REPORT-01.filter.plan_statuses-archived | owner | API | 1 | {'occurrences': 1, 'songs': 1, 'plans': 1} | PASS |
| REPORT-01.filter.plan_statuses-all | owner | API | 5 occurrences 5 plans | {'occurrences': 5, 'songs': 1, 'plans': 5} | PASS |
| REPORT-01.filter.service_type-sunday | owner | API | excludes Midweek: 2 | {'occurrences': 2, 'songs': 1, 'plans': 2} | PASS |
| REPORT-01.filter.service_type-midweek | owner | API | 1 |  | PASS |
| REPORT-01.filter.range-local-day-boundary-inclusive | owner | API | Boundary plan 2027-01-11T05:30Z = Jan 10 23:30 America/Chicago: from=to=2027-01-10 includes Pub(15:00Z)+Boundary = 2 | {'occurrences': 2, 'songs': 1, 'plans': 2} | PASS |
| REPORT-01.filter.range-local-day-boundary-exclusive | owner | API | from=to=2027-01-11 excludes Boundary (local 01-10): 0 | {'occurrences': 0, 'songs': 0, 'plans': 0} | PASS |
| REPORT-01.validation.to-before-from | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.367-inclusive-days | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.invalid-calendar-date | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.garbage | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.missing-from | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.bad-status | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.bad-uuid | owner | API | 422 no data | 422 | PASS |
| REPORT-01.validation.366-inclusive-days-ok | owner | API | 200 (366 inclusive days max) | 200 | PASS |
| REPORT-01.access.staffing.owner | owner | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.admin | admin | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.legacy | legacy | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.scoped | scoped | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.bandlead | bandlead | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.prodlead | prodlead | API | 200 | 200 | PASS |
| REPORT-01.access.staffing.member | member | API | 403 | 403 | PASS |
| REPORT-01.access.staffing.librarian | librarian | API | 403 | 403 | PASS |
| REPORT-01.access.staffing.candidate | candidate | API | 403 | 403 | PASS |
| REPORT-01.access.staffing.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| REPORT-01.access.staffing.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| REPORT-01.tenant.staffing.betaowner-orgB-sees-nothing-of-A | betaowner | API | 200 with 0 rows (org B has no data) | (200, 0) | PASS |
| REPORT-01.access.participation.owner | owner | API | 200 | 200 | PASS |
| REPORT-01.access.participation.admin | admin | API | 200 | 200 | PASS |
| REPORT-01.access.participation.legacy | legacy | API | 200 | 200 | PASS |
| REPORT-01.access.participation.scoped | scoped | API | 200 | 200 | PASS |
| REPORT-01.access.participation.bandlead | bandlead | API | 200 | 200 | PASS |
| REPORT-01.access.participation.prodlead | prodlead | API | 200 | 200 | PASS |
| REPORT-01.access.participation.member | member | API | 403 | 403 | PASS |
| REPORT-01.access.participation.librarian | librarian | API | 403 | 403 | PASS |
| REPORT-01.access.participation.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| REPORT-01.access.participation.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| REPORT-01.tenant.participation.betaowner-orgB-sees-nothing-of-A | betaowner | API | 200 with 0 rows (org B has no data) | (200, 0) | PASS |
| REPORT-01.access.schedule.owner | owner | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.admin | admin | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.legacy | legacy | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.scoped | scoped | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.bandlead | bandlead | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.prodlead | prodlead | API | 200 | 200 | PASS |
| REPORT-01.access.schedule.member | member | API | 403 | 403 | PASS |
| REPORT-01.access.schedule.librarian | librarian | API | 403 | 403 | PASS |
| REPORT-01.access.schedule.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| REPORT-01.access.schedule.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| REPORT-01.tenant.schedule.betaowner-orgB-sees-nothing-of-A | betaowner | API | 200 with 0 rows (org B has no data) | (200, 0) | PASS |
| REPORT-01.access.song-usage.owner | owner | API | 200 | 200 | PASS |
| REPORT-01.access.song-usage.admin | admin | API | 200 | 200 | PASS |
| REPORT-01.access.song-usage.legacy | legacy | API | 200 | 200 | PASS |
| REPORT-01.access.song-usage.scoped | scoped | API | 200 | 200 | PASS |
| REPORT-01.access.song-usage.bandlead | bandlead | API | 403 | 403 | PASS |
| REPORT-01.access.song-usage.prodlead | prodlead | API | 403 | 403 | PASS |
| REPORT-01.access.song-usage.member | member | API | 403 | 403 | PASS |
| REPORT-01.access.song-usage.librarian | librarian | API | 200 | 200 | PASS |
| REPORT-01.access.song-usage.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| REPORT-01.access.song-usage.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| REPORT-01.tenant.song-usage.betaowner-orgB-sees-nothing-of-A | betaowner | API | 200 with 0 rows (org B has no data) | (200, 0) | PASS |
| REPORT-01.access.run-times.owner | owner | API | 200 | 200 | PASS |
| REPORT-01.access.run-times.admin | admin | API | 200 | 200 | PASS |
| REPORT-01.access.run-times.legacy | legacy | API | 200 | 200 | PASS |
| REPORT-01.access.run-times.scoped | scoped | API | 200 | 200 | PASS |
| REPORT-01.access.run-times.bandlead | bandlead | API | 403 | 403 | PASS |
| REPORT-01.access.run-times.prodlead | prodlead | API | 403 | 403 | PASS |
| REPORT-01.access.run-times.member | member | API | 403 | 403 | PASS |
| REPORT-01.access.run-times.librarian | librarian | API | 403 | 403 | PASS |
| REPORT-01.access.run-times.outsider.orgA-header | outsider | API | 403 | 403 | PASS |
| REPORT-01.access.run-times.betaowner.orgA-header | betaowner | API | 403 | 403 | PASS |
| REPORT-01.tenant.run-times.betaowner-orgB-sees-nothing-of-A | betaowner | API | 200 with 0 rows (org B has no data) | (200, 0) | PASS |
| REPORT-01.access.anonymous | anonymous | API | 401 | 401 | PASS |
| REPORT-01.redaction.participation.bandlead-d04 | bandlead (Band scheduler) | API | Band people only (owner, confirmed, pending, candidate, declined?) — no Production persons (Member, CandidateB); scope_note present | (['QA Candidate', 'QA Confirmed', 'QA Declined', 'QA Live Owner', 'QA Pending'], 'Only the teams and service types you schedule are included.') | PASS |
| REPORT-01.redaction.participation.bandlead-totals | bandlead | API | assignments 6 (Band: WL, Electric, Acoustic, Bass, Keys, Drums) people 5 (owner,confirmed,pending,candidate,declined) | {'assignments': 6, 'people': 5, 'person_plans': 5, 'present': 2, 'absent': 1, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.redaction.participation.prodlead-d04 | prodlead | API | Production only: Member (Greeter), CandidateB (Sound); assignments 2 | (['QA CandidateB', 'QA Member'], 2) | PASS |
| REPORT-01.redaction.staffing.prodlead-d04 | prodlead | API | needed 4 (Greeter,Sound,Camera,Usher) confirmed 1 pending 1 declined 0 vacancies 2; follow-ups only Sound; scope note | (4, 1, 1, 2) | PASS |
| REPORT-01.redaction.staffing.bandlead-d04 | bandlead | API | needed 6 confirmed 2 pending 3 declined 1 vacancies 1; follow-ups exclude Sound (Production) | (6, 2, 3, 1, 1) | PASS |
| REPORT-01.redaction.schedule.prodlead-d04 | prodlead | API | 2 assignments (Production), no Band person names | {'plans': 1, 'assignments': 2, 'people': 2} | PASS |
| REPORT-01.redaction.participation.prodlead-no-visible | prodlead | API | 0 rows, summary zero, attendance not leaked (present 0 absent 0) | {'assignments': 0, 'people': 0, 'person_plans': 0, 'present': 0, 'absent': 0, 'teams': []} | PASS |
| REPORT-01.redaction.song_usage.scoped-sunday-only | scoped (plans.edit Sunday) | API | Midweek plan excluded: 4 occurrences (5-1); scope note present | ({'occurrences': 4, 'songs': 1, 'plans': 4}, 'Only plans of service types you edit are included.') | PASS |
| REPORT-01.redaction.song_usage.librarian-org-wide | librarian (songs.manage) | API | all 5 occurrences, no scope note | ({'occurrences': 5, 'songs': 1, 'plans': 5}, None) | PASS |
| REPORT-01.redaction.run_times.scoped | scoped | API | 1 run (Sunday plan in scope) | {'runs': 1, 'planned_seconds': 180, 'actual_seconds': 200, 'average_difference_seconds': 20} | PASS |
| REPORT-01.csv.staffing.headers | owner | API format=csv | 200 text/csv attachment filename | (200, 'text/csv; charset=utf-8', 'attachment; filename="staffing-2026-11-29-to-2026-12-13.csv"') | PASS |
| REPORT-01.csv.participation.headers | owner | API format=csv | 200 text/csv attachment filename | (200, 'text/csv; charset=utf-8', 'attachment; filename="participation-2026-11-29-to-2026-12-13.csv"') | PASS |
| REPORT-01.csv.song-usage.headers | owner | API format=csv | 200 text/csv attachment filename | (200, 'text/csv; charset=utf-8', 'attachment; filename="song-usage-2026-11-29-to-2026-12-13.csv"') | PASS |
| REPORT-01.csv.run-times.headers | owner | API format=csv | 200 text/csv attachment filename | (200, 'text/csv; charset=utf-8', 'attachment; filename="run-times-2026-11-29-to-2026-12-13.csv"') | PASS |
| REPORT-01.csv.schedule.headers | owner | API format=csv | 200 text/csv attachment filename | (200, 'text/csv; charset=utf-8', 'attachment; filename="schedule-2026-11-29-to-2026-12-13.csv"') | PASS |
| REPORT-01.csv.participation.row-count-equals-json | owner | API json vs csv | same row count | (4, 4) | PASS |
| REPORT-01.csv.staffing.row-count-equals-json | owner | API json vs csv | same row count | (5, 5) | PASS |
| REPORT-01.csv.schedule.row-count-equals-json | owner | API json vs csv | same row count | (5, 5) | PASS |
| REPORT-01.csv.song-usage.row-count-equals-json | owner | API json vs csv | same row count | (1, 1) | PASS |
| REPORT-01.csv.run-times.row-count-equals-json | owner | API json vs csv | same row count | (1, 1) | PASS |
| REPORT-01.csv.participation.totals-equal-oracle | owner | API csv | present 4 absent 2 unknown 0 assignments 5 | (4, 2, 0, 5) | PASS |
| REPORT-01.prepared-excluded.participation | owner | API | prepared request never counted (assignments 5) | 5 | PASS |
| REPORT-01.prepared-excluded.schedule | owner | API | prepared request never counted (assignments 5) | 5 | PASS |
| REPORT-01.prepared-excluded.staffing | owner | API | prepared Sound not in follow-ups/needs; pending 3 confirmed 2 | 3 | PASS |
| REPORT-01.prepared-excluded.schedule.bandlead | bandlead | API | prepared never visible, even to leaders | {'plans': 1, 'assignments': 5, 'people': 4} | PASS |
| REPORT-01.prepared-excluded.schedule.prodlead | prodlead | API | prepared never visible, even to leaders | {'plans': 0, 'assignments': 0, 'people': 0} | PASS |
| REPORT-01.prepared-excluded.schedule.scoped | scoped | API | prepared never visible, even to leaders | {'plans': 1, 'assignments': 5, 'people': 4} | PASS |
| REPORT-01.filter.include_archived_people-false | owner | API | archived Candidate excluded: 3 people / 4 assignments; default includes (4 people) | (3, 4) | PASS |
| REPORT-01.filter.include_archived_people-false.schedule | owner | API | 4 assignments | {'plans': 1, 'assignments': 4, 'people': 3} | PASS |
| REPORT-01.archived-person-history-retained | owner | API/DB | archived candidate still on sheet row flagged archived | 4 | PASS |
| REPORT-01.filter.team-prod-empty | owner | API | Production filter: no rows on C | {'assignments': 0, 'people': 0, 'person_plans': 0, 'present': 0, 'absent': 0, 'teams': []} | PASS |
| REPORT-01.filter.team-band-all | owner | API | Band filter: 5 assignments | {'assignments': 5, 'people': 4, 'person_plans': 4, 'present': 4, 'absent': 2, 'teams': [{'team_id': '62fe8462-a31b-47ac-8407-4d1d51d1812c', 'team_name': 'Band', | PASS |
| REPORT-01.filter.team-prod-D04-participation | owner | API | Production: assignments 2 (Greeter, Sound), people 2 | (2, 2) | PASS |
| REPORT-01.filter.service_type-midweek-D04-empty | owner | API | 0 plans | 0 | PASS |
| REPORT-01.filter.plan_status-draft-staffing | owner | API | 0 plans (D04 published) | 0 | PASS |
| REPORT-01.stability.same-inputs-same-rows | owner | API | stable ordering/rows |  | PASS |
| REPORT-01.surface.web | - | Web /reports screens, print, filters UI, CSV button | per plan | not run: browser owned by QA-09 | NOT_RUN |
| REPORT-01.surface.mobile-schedule-report | - | Mobile schedule report | per plan | not run: no mobile run | NOT_RUN |

## Race and concurrency evidence (section 8)

| Race | Iterations | Result |
|---|---|---|
| Two simultaneous commands, same controller, same expected revision | 20 | 20/20 exactly one 200 + one 409 `run_revision_stale`; +1 transition; revisions contiguous |
| Holder vs two non-holders, same revision | 10 | 10/10 holder wins, others 409 |
| Four simultaneous `take_over` from the same revision | 10 | 10/10 one winner (owner 3, admin 4, legacy 3), others 409, controller row equals winner |
| Same action id sent 8 times in parallel | 10 | 10/10 one applied, seven replayed, one transition |
| Four editors create the same service time with different keys | 1 | 201 + three 409 `run_exists`, one live row |
| Two leaders, overlapping attendance batches in opposite order | 20 | 20/20 one batch applied whole, other 409, 2 records, no deadlock or 500 |
| Same attendance idempotency key x6 | 10 | 10/10 one applied, five replayed |
| Four leaders first-mark the same person | 10 | 10/10 one winner, one record (unique index), three 409 |

Integrity check after races: transition count = max revision = distinct revisions = run revision (90 transitions on the 09:00 run at that point).

## Not run / blocked

- Web, mobile and physical-device surfaces of every owned case (browser owned by QA-09; no device): rows `*.surface.*` and `LIVE-02.poll-network-loss-background.*`.
- Print, tracked export, share (REPORT-02, owned elsewhere).
- `supabase/tests/f12-*`, `f16-*` suites: fixtures use the seed org; the rules forbid touching seed orgs. API-level barrier races were used instead.
- Live notification stop on end/leave: NOT_APPLICABLE, no Live notification or push path exists in the frozen source.
- Delivery worker not run. No code, migration or config changed.

## Fixtures left in place

Orgs `qa-20261118-live-a` and `-b`, the 15 users above, all plans listed under Fixture shape, 5 Live runs (D04 09:00 ended with 2 corrections, D04 11:00 ended, D14 RunTimes 09:00 ended with correction and 11:00 left LIVE, Midweek discarded + new ready run, draft-plan run ended after the D1 repro), attendance records on D04, D14 A and D14 C, one prepared request on D14 C. Person `candidate` was archived and restored during the archive filter test. Credentials: scratchpad `qa11/creds.json` (not in repo).
