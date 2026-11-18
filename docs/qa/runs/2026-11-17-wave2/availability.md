# QA-06 Availability, delegation, combined orgs -- wave 2 (run qa-20261117, agent `avail`)

Date 2026-11-17. Repo HEAD `cac3f26` (main), working tree unchanged by this run. Backend http://localhost:4000/api/v1, local Supabase. Every case used the caller's own bearer token on the API (surface **API**) or the caller's own JWT against PostgREST/RPC (surface **DIRECT**). Service role was used only for fixture creation (orgs, members, scheduler/leader grants, org B content, clock back-dating of one availability review) and persisted-state assertions; it is never permission evidence. No source, migration or config change; no db reset.

## ESCALATIONS (top)

**No P0.** No cross-tenant disclosure: B sentinels (`BSECRET-*`) never appeared in any A-context response and vice versa (combined schedule, busy warnings, conflict checks, request lists, copy, direct RPC). Reasons never appear in conflict checks, 409 scheduling conflicts, warnings, affected-assignment previews or busy-elsewhere output. No unauthorized persisted mutation (every denied write re-checked in the DB).

* **W2-AVAIL-D3 (P1, confirm intent)** A team-scoped `scheduling.manage` holder (leader of one team) can read every org member's blockouts **including private reasons**, and create/edit/delete blockouts and preferences for anyone, because the gate is "scheduling.manage at *any* scope". This bypasses the "private blockout reason redacted from generic conflicts" intent (AVAIL-03).
* **W2-AVAIL-D1 (P2)** Blockout/series input errors that are the caller's fault return HTTP 500 `internal_error`.
* **W2-AVAIL-D2 (P2)** Not-found from blockout RPCs surfaces as 400 with raw SQLSTATE `P0002`.
* Wave-1 retests: API-D3 **STILL_OPEN** (chart; materials now fixed), API-D4 **STILL_OPEN**, API-D5 **STILL_OPEN** (+7 new surfaces), API-D6 **STILL_OPEN**.

## Summary

Executed expanded cases: 359. PASS 342, FAIL 16, NOT_APPLICABLE 1, BLOCKED 0, NOT_RUN: see below (web/mobile surfaces are other packages). Each FAIL maps to W2-AVAIL-D1..D3 or the wave-1 defect API-D5.

| Family | PASS | FAIL | N/A |
|---|---|---|---|
| AVAIL-01 | 73 | 6 | 0 |
| AVAIL-02 | 39 | 4 | 0 |
| AVAIL-03 | 110 | 3 | 0 |
| DELEGATE-01 | 62 | 2 | 1 |
| ORGS-01 | 58 | 1 | 0 |
| **Total** | 342 | 16 | 1 |

Actors: `dana` (target/self), `delegate` (grant matrix), `unrelated` (member), `sched` (legacy scheduler), `leader` (member, access_mode=scoped, scheduling.manage on team "QA Avail Band" only), `owner`, `multi` (A and B member), `ownerb`/`bmember` (B only = outsiders for A), all in orgs `qa-20261117-avail-a` (A), `-b` (B), `-c` (empty, target for not-a-member copy).

## Defects

### W2-AVAIL-D1 (P2) Caller input errors in blockout recurrence/time resolution return 500
- Cases: AVAIL-01.self.validation.end-before-start, AVAIL-01.self.validation.nonexistent-dst-time, AVAIL-02.preview.end-before-start, AVAIL-02.preview.until-before-start, AVAIL-02.preview.until-far-future-bounded (all as dana, API).
- Repro: `POST /blockouts` body timed 09:00-13:00 with `local_end_time:"08:00"` (same date) -> **500** `{"error":"End must be after start.","code":"internal_error"}`. Same for 02:30 on 2027-03-14 America/Toronto (spring-forward gap: "uses a local time skipped by daylight saving"), `POST /blockouts/series/preview` with until before start ("does not produce any occurrences") and an until date 10 years out ("too long. Limit it to 120 occurrences").
- Expected: 400/422 with the same message (the messages are user-facing, so the clients likely want to show them). Actual: 500 internal_error; server error logs/alerts will fire on user typos. No data written.
- Suspected: `packages/shared/src/lib/timezone.ts:222,228,264,268` throw plain `Error`; `backend/src/routes/blockouts.ts:30-48` (`resolveIntent`/`resolveSeries`) call them without mapping to `HttpError.badRequest`; `backend/src/middleware/error-handler.ts:25-30` turns them into 500.

### W2-AVAIL-D2 (P2) Blockout not-found surfaces as 400 + raw SQLSTATE
- Cases: AVAIL-01.unrelated.edit-dana-blockout-substitute-own-person_id, AVAIL-01.self.edit-unknown-id (PATCH), also seen on `POST /blockouts/series/:id/change` ("Repeating blockout not found", "Occurrence not found") and PATCH of a series occurrence.
- Repro: `PATCH /blockouts/00000000-0000-0000-0000-000000000000` as dana -> 400 `{"error":"Blockout not found","code":"P0002"}`; unrelated member PATCH on dana's blockout with own `person_id` substituted -> same 400 (denied, rev unchanged, so safe).
- Expected: 404 (CLAUDE.md: RLS/absent rows are 404, no Postgres detail). Actual: 400 with SQLSTATE code. Not a leak (same answer for foreign and absent ids) but wrong status and engine detail.
- Suspected: `backend/src/routes/blockouts.ts:160,182,195` (`new HttpError(…400, error.message, error.code)` instead of `fromPostgrestError`, which already maps P0002 at `backend/src/lib/errors.ts:145`).

### W2-AVAIL-D3 (P1, intent to confirm) Team-scoped scheduling capability exposes every person's private blockout reasons and edit rights
- Cases: AVAIL-03.leader.PostgREST-blockouts-select (FAIL); related PASS-with-note rows AVAIL-01.leader.create-for-dana, AVAIL-01.leader.list-org-scope, AVAIL-03.leader.PostgREST-prefs-of-dana.
- Repro: `leader` = ordinary member, `access_mode=scoped`, one grant `scheduling.manage` on team Band only. `multi` and `dana` create blockouts with reason sentinel `SENTINEL-REASON-QA7*`. As leader: `GET /blockouts?scope=organization` -> 200 with 11 rows incl. both sentinel reasons; direct PostgREST `select id,person_id,reason from blockouts` returns the same; `POST /blockouts` for dana -> 201; `PUT /availability/preferences` for dana -> 200. At that time `multi` was on no team at all (team memberships were added later in the run), so the leader had no relation to the person whose reason was read.
- Expected: per the plan (AVAIL-03, JOURNEY-03: "leader sees redacted conflict") a leader sees blockout *conflicts* with reason redacted ("Unavailable"); raw reasons only for self/delegate/org-wide schedulers. Actual: conflicts are redacted (PASS: `/scheduling/conflicts`, 409 `scheduling_conflict`, `/availability/warnings`) but the same reason is one query away.
- Suspected: `supabase/migrations/20261019000300_f03_delegation.sql:118-126` (`private.can_manage_blockout` uses `has_capability_anywhere(p_org,'scheduling.manage')`, used by all blockout/series/preference policies); `backend/src/services/availability.ts` `resolveAvailabilityTarget` (`canAccessAnywhere`) and `backend/src/routes/blockouts.ts:67-69` (`scope=organization`). Fix direction: scope to people on/eligible for the leader's team, or return reason-less rows for non-org-wide capability.

### API-D5 (wave 1, STILL_OPEN) new surfaces counted as FAIL here
Malformed UUID -> 500 `{"code":"22P02"}` on: `PATCH/DELETE /blockouts/:id`, `GET /blockouts/series/:id`, `DELETE /availability/preferences/:id`, `GET /availability/requests/:id`, `POST /delegations/:id/revoke`, `POST /delegations/:id/assignments/:aid/respond`, and `POST /me/availability/copy` with a non-UUID `X-Organization-Id` (route is not behind `withOrganization`).

## Wave-1 open defect retests

| Defect | Verdict | Evidence |
|---|---|---|
| API-D3 arrangement chart/materials ignore X-Organization-Id | **STILL_OPEN (chart)**, materials **FIXED** | `multi` (A+B member): `GET /arrangements/<B arrangement>/chart` with `X-Organization-Id: A` -> 200 with B chord chart (sentinel `BSECRET` present); single-org A user -> 404. `GET …/materials` with header A -> 404 "Arrangement unavailable", header B -> 200 (materials RPC takes `p_org`: `backend/src/routes/songs.ts:69-72`). Chart: `backend/src/routes/songs.ts:224-227` -> `backend/src/services/songs.ts:176-188` selects arrangement by id only, no `req.orgId`. |
| API-D4 invalid IANA timezone accepted | **STILL_OPEN** | `PATCH /organizations/<A>` `{"timezone":"Not/AZone"}` -> 200 and persisted (restored afterward). `packages/shared/src/schemas/organization.ts:11` still `timezone: z.string().default('America/Toronto')`; the blockout schema already has `isValidTimeZone` (`packages/shared/src/schemas/blockout.ts:7`) to reuse. |
| API-D5 malformed UUID -> 500 raw Postgres | **STILL_OPEN** | `GET /people/x`, `/teams/x`, `/plans/x`, `/songs/x` all 500 `22P02`; plus 7 new surfaces above. `backend/src/lib/params.ts:9-15` (`param()`) only checks non-empty; no uuid validation. |
| API-D6 POST /teams duplicate positions partial write | **STILL_OPEN** | `POST /teams` `{"name":"QA Avail Partial …","positions":["Dup","Dup"]}` -> 409 "That record already exists" and the team row exists afterward (1 orphan, removed by the test). Route `backend/src/routes/teams.ts:122` onward still inserts team then positions non-atomically. |

## Observations (not defects)

* `can_signup` on a delegation is stored but nothing consumes `delegation_for(...,'signup')` (only the delegation migration, `delegations.ts`, `availability.model.ts`): the "signup" independent capability cannot be tested end-to-end (NOT_APPLICABLE).
* `can_respond` implies view (`private.delegation_for`: `view_schedule` is true for `d.can_view_schedule or d.can_respond`); an availability-only grant can neither respond nor view (404). Independent otherwise.
* Re-granting the same pair revokes the old grant and creates a new id (audited); revoke is idempotent and also allowed to the delegate.
* Revoke and expiry take effect on the very next call (create, series change, schedule view, respond, affirm) -- covers "revoke during open review blocks commit" at API level; no stale-grant window found.
* Delegate with availability grant can affirm (confirm freshness) for the target; scheduler/owner/leader cannot via the API (403). Direct RPC `affirm_availability` as a scheduler also denied (P0002).
* `DELETE /blockouts/:id` for a foreign/absent id returns 409 "changed or part of a repeating series" (not 404); no leak, wrong wording.
* Copy-availability: same idempotency key is a no-op (`already_copied`); a **new** key re-copies the same blockouts (duplicates in target). `include_reason:false` default writes `reason=null`.
* Combined-schedule response carries no per-org timezone; per-org `status:'error'` state could not be provoked without breaking a role grant (NOT_RUN).
* Released assignments are visible to all org members by RLS, so `blockout_affected_assignments` for another person returns that person's released rows to a team-peer member (prepared rows never) -- consistent with assignments RLS.
* Leader (scoped) is also able to create availability requests for its own team only (other team -> 404) and warnings for any team (200, empty).

## NOT_RUN

Web (`/settings`, `/help/:delegationId`, `/settings/blockouts/:seriesId`) and native mobile surfaces (MOB-006/007/011/032) and the `W M` columns of the plan rows are not exercised here (browser pane owned by another agent; native is QA-13/14). Per-org error/stale state in combined schedule not provoked. Offline/draft-retention behaviors not applicable at the API.

## Fixtures left in place

Orgs `qa-20261117-avail-a`, `-b`, `-c` and auth users `{owner,sched,leader,dana,delegate,unrelated,multi,ownerb,bmember}.qa20261117.avail@example.test` (password only in the session scratchpad, not here). Leftover rows in A: service type, teams "QA Avail Band"/"Tech", plans 1-4, ~25 blockouts, a few series, preferences, one availability request (+ delivery effect), delegations (grants revoked/expired plus one live availability grant dana->delegate), team memberships; in B: service type/team/plan(published + prepared), song "BSECRET Song", copied blockouts, B-team and B-plan inserted via service role. Multi's settings: combined off, busy-share on.

## Cases

Format: id | verdict | evidence (ids shortened, reasons/secrets redacted).

| Case | Verdict | Evidence |
|---|---|---|
| AVAIL-01.self.create-for-dana.API | PASS | 201 {"blockout":{"id":"b8d05a58…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.self.create.affected-assignments-lists-plan1 | PASS | [{"assignment_id":"2c554c81…","plan_id":"6876a058…","plan_title":"QA Avail Plan 1","assignment_status":"confirmed","visibility":"released","team_name":"QA Avail Band","po |
| AVAIL-01.self.create.existing-confirmed-unchanged | PASS | asg1=confirmed |
| AVAIL-01.delegate(availability grant).create-for-dana.API | PASS | 201 {"blockout":{"id":"560b274c…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.scheduler(legacy).create-for-dana.API | PASS | 201 {"blockout":{"id":"c930a8a3…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.leader(team-scoped scheduling.manage).create-for-dana.API | PASS | 201 {"blockout":{"id":"7a2f8627…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201,403) |
| AVAIL-01.owner.create-for-dana.API | PASS | 201 {"blockout":{"id":"bab48599…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.unrelated member.create-for-dana.API | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.outsider(B owner) in A ctx.create-for-dana.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| AVAIL-01.multi(A member no cap).create-for-dana.API | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.self-in-wrong-org-ctx(B nonmember).create-for-dana.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| AVAIL-01.multi.B-ctx.create-with-A-person-id.API | PASS | 404 {"error":"Person not found","code":"not_found"} (want 403,404) |
| AVAIL-01.self.create-idempotent-replay | PASS | 201/201 ids 7c79a2d8 7c79a2d8 |
| AVAIL-01.self.validation.invalid-tz | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"timezone","code":"custom","message":"Choose a valid IANA timezone"}]} (want 400,422) |
| AVAIL-01.self.validation.end-before-start | FAIL | client-input error returned as 500 internal_error -> W2-AVAIL-D1 [500 {"error":"End must be after start.","code":"internal_error"} (want 400,422)] |
| AVAIL-01.self.validation.timed-missing-times | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"local_start_time","code":"custom","message":"Timed blockouts need start and end times"}]} ( |
| AVAIL-01.self.validation.reason>200 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"reason","code":"too_big","message":"String must contain at most 200 character(s)"}]} (want  |
| AVAIL-01.self.validation.bad-date | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"local_start_date","code":"custom","message":"Choose a valid date"}]} (want 400,422) |
| AVAIL-01.self.validation.bad-time | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"local_start_time","code":"custom","message":"Choose a valid time"}]} (want 400,422) |
| AVAIL-01.self.validation.all-day-same-end-date | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"local_end_date","code":"custom","message":"All-day end date is the exclusive following date |
| AVAIL-01.self.validation.nonexistent-dst-time | FAIL | client-input error returned as 500 internal_error -> W2-AVAIL-D1 [500 {"error":"An occurrence on 2027-03-14 uses a local time skipped by daylight saving. Choose another t |
| AVAIL-01.self.all-day-multi-day.API | PASS | 201 {"blockout":{"id":"ab0d0353…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.self.dst-ambiguous-later.API | PASS | 201 {"blockout":{"id":"37aee076…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) {"id":"37aee076…","organization_id":"44638c99…","user_i |
| AVAIL-01.self.legacy-timestamp-create.API | PASS | 201 {"id":"e246023a…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027-04-01T10:00 (want 201) |
| AVAIL-01.self.legacy-end-before-start.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"ends_at","code":"custom","message":"End must be after start"}]} (want 400,422) |
| AVAIL-01.unrelated.legacy-create-for-dana-user_id.API | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.delegate.legacy-create-for-dana-user_id.API | PASS | 201 {"id":"c5be58ff…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027-04-02T10:00 (want 201) |
| AVAIL-01.unrelated.edit-dana-blockout.API | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.unrelated.edit-dana-blockout-substitute-own-person_id.API | FAIL | not-found from RPC mapped to 400 with SQLSTATE P0002 (no mutation occurred) -> W2-AVAIL-D2 [400 {"error":"Blockout not found","code":"P0002"} (want 403,404,409)] |
| AVAIL-01.unrelated.edit-substitution.persisted-unchanged | PASS | rev 0 |
| AVAIL-01.self.edit-stale-revision.API | PASS | 409 {"error":"This blockout changed; refresh and try again","code":"PT409"} (want 409) |
| AVAIL-01.self.edit-invalid-tz.API | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"timezone","code":"custom","message":"Choose a valid IANA timezone"}]} (want 400,422) |
| AVAIL-01.self.edit.API | PASS | 200 {"blockout":{"id":"b8d05a58…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 200) rev 1 |
| AVAIL-01.delegate(grant).edit.API | PASS | 200 {"blockout":{"id":"b8d05a58…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 200) |
| AVAIL-01.self.edit-with-old-revision-after-delegate-edit.API | PASS | 409 {"error":"This blockout changed; refresh and try again","code":"PT409"} (want 409) |
| AVAIL-01.self.edit-malformed-id.API | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [400 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404)] |
| AVAIL-01.self.edit-unknown-id.API | FAIL | not-found from RPC mapped to 400 with SQLSTATE P0002 (no mutation occurred) -> W2-AVAIL-D2 [400 {"error":"Blockout not found","code":"P0002"} (want 404,409)] |
| AVAIL-01.unrelated.delete-dana-blockout.API | PASS | 409 {"error":"This blockout changed or is part of a repeating series","code":"conflict"} (want 403,404,409) |
| AVAIL-01.unrelated.delete.persisted-intact | PASS | exists |
| AVAIL-01.outsider.delete-in-B-ctx.API | PASS | 409 {"error":"This blockout changed or is part of a repeating series","code":"conflict"} (want 403,404,409) |
| AVAIL-01.outsider.delete-B-ctx.persisted-intact | PASS | exists |
| AVAIL-01.self.delete-stale-revision.API | PASS | 409 {"error":"This blockout changed or is part of a repeating series","code":"conflict"} (want 409) |
| AVAIL-01.self.delete.API | PASS | 204 "" (want 204) |
| AVAIL-01.self.delete.persisted-gone | PASS |  |
| AVAIL-01.self.delete-malformed-id.API | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404,409)] |
| AVAIL-01.self.delete-already-gone.API | PASS | 409 {"error":"This blockout changed or is part of a repeating series","code":"conflict"} (want 404,409) |
| AVAIL-01.self.list-mine.API | PASS | 200 [{"id":"560b274c…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027-03-07T14:0 (want 200) n=9 |
| AVAIL-01.unrelated.list-mine-no-dana-rows | PASS | 200 n=0 |
| AVAIL-01.unrelated.list-org-scope.API | PASS | 403 {"error":"Only schedulers can see everyone’s blockouts","code":"forbidden"} (want 403) |
| AVAIL-01.unrelated.list-person-dana.API | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.scheduler.list-org-scope.API | PASS | 200 [{"id":"560b274c…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027-03-07T14:0 (want 200) n=9 |
| AVAIL-01.leader.list-org-scope(team-scoped).API | PASS | 200; leader reads all org blockouts including reasons (see W2-AVAIL-D3) [200 [{"id":"560b274c…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027-03-0 |
| AVAIL-01.outsider.list-org-scope-A-ctx.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| AVAIL-01.multi.B-ctx.list-org-scope(not sched).API | PASS | 403 {"error":"Only schedulers can see everyone’s blockouts","code":"forbidden"} (want 403) |
| AVAIL-01.self.list-bad-person-id.API | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"person_id","code":"invalid_string","message":"Invalid uuid"}]} (want 400,422) |
| AVAIL-01.self.list-bad-from.API | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"from","code":"invalid_string","message":"Invalid datetime"}]} (want 400,422) |
| AVAIL-01.self.affected-preview | PASS | 200 [{"assignment_id":"2c554c81…","plan_id":"6876a058…","plan_title":"QA Avail Plan 1","assignment_status":"confirmed","visibility (want 200) n=1 |
| AVAIL-01.unrelated.affected-preview-for-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-01.unrelated.affected-preview-own(no leak of dana) | PASS | 200 [] (want 200) n=0 |
| AVAIL-01.unrelated.affected-own-excludes-dana | PASS |  |
| AVAIL-01.unrelated.RPC-affected-for-dana.DIRECT | PASS | returns only released assignment dana already has visible via assignments RLS to org members (team-peer visible); prepared and foreign-org rows hidden [rows=1] |
| AVAIL-01.unrelated.PostgREST-update-dana-blockout | PASS | [] |
| AVAIL-01.unrelated.PostgREST-delete-dana-blockout | PASS | [] |
| AVAIL-01.unrelated.PostgREST-insert-for-dana | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"blockouts\" |
| AVAIL-01.outsider.PostgREST-insert-into-A | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"blockouts\" |
| AVAIL-01.multi.PostgREST-insert-B-org-with-A-person | PASS | {"code":"22023","details":null,"hint":null,"message":"Person does not belong to this organization"} |
| AVAIL-01.unrelated.RPC-blockout_affected_assignments(dana).DIRECT | PASS | returns only released assignment dana already has visible via assignments RLS to org members (team-peer visible); prepared and foreign-org rows hidden [rows=1 released] |
| AVAIL-01.bmember.RPC-blockout_affected_assignments(dana).DIRECT | PASS | rows=0  |
| AVAIL-01.ownerb.RPC-blockout_affected_assignments(dana).DIRECT | PASS | rows=0  |
| AVAIL-01.bmember.RPC-blockout_affected_assignments(unrelated).DIRECT | PASS | rows=0  |
| AVAIL-01.multi.RPC-blockout_affected_assignments(unrelated).DIRECT | PASS | rows=0  |
| AVAIL-01.dana.RPC-blockout_affected_assignments(unrelated).DIRECT | PASS | rows=0  |
| AVAIL-01.leader.RPC-blockout_affected_assignments(unrelated).DIRECT | PASS | rows=0  |
| AVAIL-01.self.create-over-pending-assignment | PASS | 201 {"blockout":{"id":"ce6a6bbc…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-01.create.affected-lists-pending-asg2 | PASS | ["unconfirmed"] |
| AVAIL-01.create.pending-answer-unchanged | PASS |  |
| AVAIL-01.unrelated.RPC-create_blockout-for-dana-denied | PASS | P0002 |
| AVAIL-01.outsider.RPC-create_blockout-A-denied | PASS | P0002 |
| AVAIL-01.edit.parallel-same-revision.exactly-one-wins | PASS | 200,409,409 |
| AVAIL-02.self.preview-weekly-4 | PASS | 200 {"occurrences":[{"occurrence_key":"2027-06-07T09:00","local_start_date":"2027-06-07","local_start_time":"09:00","local_end_date":"2027-06-07","local_end_time":"13:00" |
| AVAIL-02.preview.occurrence-count-4 | PASS | 2027-06-07,2027-06-14,2027-06-21,2027-06-28 |
| AVAIL-02.preview.weekly-7-day-steps | PASS | 2027-06-07,2027-06-14,2027-06-21,2027-06-28 |
| AVAIL-02.preview.until-date | PASS | 200 {"occurrences":[{"occurrence_key":"2027-06-07T09:00","local_start_date":"2027-06-07","local_start_time":"09:00","local_end_date":"2027-06-07","local_end_time":"13:00" |
| AVAIL-02.preview.count>120 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"recurrence.end.count","code":"too_big","message":"Number must be less than or equal to 120" |
| AVAIL-02.preview.count=0 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"recurrence.end.count","code":"too_small","message":"Number must be greater than or equal to |
| AVAIL-02.preview.interval>12 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"recurrence.interval","code":"too_big","message":"Number must be less than or equal to 12"}] |
| AVAIL-02.preview.frequency-daily-invalid | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"recurrence.frequency","code":"invalid_enum_value","message":"Invalid enum value. Expected ' |
| AVAIL-02.preview.until-before-start | FAIL | client-input error returned as 500 internal_error -> W2-AVAIL-D1 [500 {"error":"The recurrence rule does not produce any occurrences.","code":"internal_error"} (want 400, |
| AVAIL-02.preview.until-far-future-bounded | FAIL | client-input error returned as 500 internal_error -> W2-AVAIL-D1 [500 {"error":"The recurrence range is too long. Limit it to 120 occurrences.","code":"internal_error"} ( |
| AVAIL-02.preview.monthly-31st-skips-missing | PASS | 200 {"occurrences":[{"occurrence_key":"2027-01-31T09:00","local_start_date":"2027-01-31","local_start_time":"09:00","local_end_date":"2027-01-31","local_end_time":"13:00" |
| AVAIL-02.preview.invalid-tz | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"timezone","code":"custom","message":"Choose a valid IANA timezone"}]} (want 400,422) |
| AVAIL-02.preview.end-before-start | FAIL | client-input error returned as 500 internal_error -> W2-AVAIL-D1 [500 {"error":"End must be after start.","code":"internal_error"} (want 400,422)] |
| AVAIL-02.unrelated.preview-for-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-02.delegate(grant).preview-for-dana | PASS | 200 {"occurrences":[{"occurrence_key":"2027-06-07T09:00","local_start_date":"2027-06-07","local_start_time":"09:00","local_end_date":"2027-06-07","local_end_time":"13:00" |
| AVAIL-02.self.create-series | PASS | 201 {"series":{"id":"f6bff9c0…","organization_id":"44638c99…","person_id":"e544b48d…","timezone":"Ameri (want 201) series f6bff9c0 |
| AVAIL-02.self.create-series-idempotent-replay | PASS | 201 f6bff9c0 {"series":{"id":"f6bff9c0…","organization_id":"44638c99-db17-4153-9fcd-4f |
| AVAIL-02.series.persisted-4-rows-no-dup | PASS | rows=4 |
| AVAIL-02.self.create-series-missing-idempotency-key | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"idempotency_key","code":"invalid_type","message":"Required"}]} (want 400,422) |
| AVAIL-02.unrelated.create-series-for-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-02.delegate(grant).create-series-for-dana | PASS | 201 {"series":{"id":"6ecc777a…","organization_id":"44638c99…","person_id":"e544b48d…","timezone":"Ameri (want 201) |
| AVAIL-02.self.get-series | PASS | 200 {"series":{"id":"f6bff9c0…","organization_id":"44638c99…","person_id":"e544b48d…","timezone":"Ameri (want 200) occ=4 rev=0 |
| AVAIL-02.unrelated.get-series | PASS | 404 {"error":"Repeating blockout not found","code":"not_found"} (want 403,404) |
| AVAIL-02.outsider.get-series-B-ctx | PASS | 404 {"error":"Repeating blockout not found","code":"not_found"} (want 403,404) |
| AVAIL-02.multi.get-A-series-in-B-ctx | PASS | 404 {"error":"Repeating blockout not found","code":"not_found"} (want 403,404) |
| AVAIL-02.scheduler.get-series | PASS | 200 {"series":{"id":"f6bff9c0…","organization_id":"44638c99…","person_id":"e544b48d…","timezone":"Ameri (want 200) |
| AVAIL-02.self.get-series-malformed-id | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404)] |
| AVAIL-02.self.legacy-delete-of-series-occurrence-blocked | PASS | 409 {"error":"This blockout changed or is part of a repeating series","code":"conflict"} (want 409) |
| AVAIL-02.unrelated.change-occurrence | PASS | 400 {"error":"Repeating blockout not found","code":"P0002"} (want 400,403,404) |
| AVAIL-02.unrelated.change.persisted-unchanged | PASS |  |
| AVAIL-02.self.change-stale-series-revision | PASS | 409 {"error":"This series changed; refresh and try again","code":"PT409"} (want 409) |
| AVAIL-02.self.change-update-without-replacement | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"replacement","code":"custom","message":"Provide the updated blockout details"}]} (want 400, |
| AVAIL-02.self.change-unknown-occurrence | PASS | 400 {"error":"Occurrence not found","code":"P0002"} (want 400,404,409) |
| AVAIL-02.self.change-occurrence-update | PASS | 200 {"deleted":false,"revision":1,"series_id":"f6bff9c0…"} (want 200) |
| AVAIL-02.self.change-idempotent-replay | PASS | 200 {"deleted":false,"revision":1,"series_id":"f6bff9c0…"} (want 200) |
| AVAIL-02.change.persisted-occurrence-updated | PASS |  |
| AVAIL-02.self.change-occurrence-delete | PASS | 200 {"deleted":false,"revision":2,"series_id":"f6bff9c0…"} (want 200) |
| AVAIL-02.change-delete-occurrence.persisted | PASS | rows=3 |
| AVAIL-02.delegate(grant).change-future-delete | PASS | 200 {"deleted":false,"revision":3,"series_id":"f6bff9c0…"} (want 200) |
| AVAIL-02.delegate.future-delete.persisted | PASS | rows=2 |
| AVAIL-02.self.change-series-delete | PASS | 200 {"deleted":true,"series_id":"f6bff9c0…"} (want 200) |
| AVAIL-02.series-delete.persisted-gone | PASS |  |
| AVAIL-02.series-create.parallel-same-key.single-series | PASS | statuses=201,201,201,201 distinctSeries=1 rows=3 |
| AVAIL-03.setup.dana-blockout-with-sentinel | PASS | 201 {"blockout":{"id":"2c821cd4…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| AVAIL-03.setup.multi-blockout-with-sentinel | PASS | 201 {"blockout":{"id":"b5f89a89…","organization_id":"44638c99…","user_id":"239ed0b6…","starts_at":"2027 (want 201) |
| AVAIL-03.sched.scheduling-conflicts.API | PASS | 200 [{"user_id":"ae396933…","conflict_type":"blockout","detail":"Unavailable","starts_at":"2027-05-02T13:00:00+00:00","ends_at":"2027-05-02T17:00:00+00:00"," (want 200) |
| AVAIL-03.sched.scheduling-conflicts.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.leader.scheduling-conflicts.API | PASS | 200 [{"user_id":"ae396933…","conflict_type":"blockout","detail":"Unavailable","starts_at":"2027-05-02T13:00:00+00:00","ends_at":"2027-05-02T17:00:00+00:00"," (want 200) |
| AVAIL-03.leader.scheduling-conflicts.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.owner.scheduling-conflicts.API | PASS | 200 [{"user_id":"ae396933…","conflict_type":"blockout","detail":"Unavailable","starts_at":"2027-05-02T13:00:00+00:00","ends_at":"2027-05-02T17:00:00+00:00"," (want 200) |
| AVAIL-03.owner.scheduling-conflicts.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.unrelated.scheduling-conflicts-denied.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.unrelated.scheduling-conflicts-denied.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.dana.scheduling-conflicts-denied.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.dana.scheduling-conflicts-denied.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.delegate.scheduling-conflicts-denied.API | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.delegate.scheduling-conflicts-denied.API.no-reason-leak | PASS | leak=false |
| AVAIL-03.outsider.scheduling-conflicts-A-ctx | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| AVAIL-03.leader.schedule-over-blockout.409 | PASS | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict","details":[{"candidate_key":"0","person_id":"e544b48d-0a34-455f- |
| AVAIL-03.leader.schedule-over-blockout.409.no-reason-leak | PASS | leak=false |
| AVAIL-03.sched.schedule-over-blockout.409 | PASS | 409 {"error":"Some people are unavailable or already scheduled at that time","code":"scheduling_conflict","details":[{"candidate_key":"0","person_id":"e544b48d-0a34-455f- |
| AVAIL-03.sched.schedule-over-blockout.409.no-reason-leak | PASS | leak=false |
| AVAIL-03.dana.PostgREST-blockouts-select | PASS | dana: rows=10 dana=10 sentinelReasons=1 |
| AVAIL-03.unrelated.PostgREST-blockouts-select | PASS | unrelated: rows=0 dana=0 sentinelReasons=0 |
| AVAIL-03.multi.PostgREST-blockouts-select | PASS | multi: rows=1 dana=0 sentinelReasons=1 |
| AVAIL-03.delegate.PostgREST-blockouts-select | PASS | delegate: rows=10 dana=10 sentinelReasons=1 |
| AVAIL-03.sched.PostgREST-blockouts-select | PASS | sched: rows=11 dana=10 sentinelReasons=2 |
| AVAIL-03.leader.PostgREST-blockouts-select | FAIL | team-scoped scheduling.manage holder reads blockout rows + private reasons of a person outside their scope -> W2-AVAIL-D3 [leader: rows=11 dana=10 sentinelReasons=2 LEADE |
| AVAIL-03.owner.PostgREST-blockouts-select | PASS | owner: rows=11 dana=10 sentinelReasons=2 |
| AVAIL-03.ownerb.PostgREST-blockouts-select | PASS | ownerb: rows=0 dana=0 sentinelReasons=0 |
| AVAIL-03.bmember.PostgREST-blockouts-select | PASS | bmember: rows=0 dana=0 sentinelReasons=0 |
| AVAIL-03.self.save-pref-all-teams | PASS | 200 {"id":"44408c32…","organization_id":"44638c99…","person_id":"e544b48d…","team_id":null,"frequency": (want 200) |
| AVAIL-03.self.save-existing-without-revision | PASS | 409 {"error":"These preferences changed; reload and try again","code":"conflict"} (want 409) |
| AVAIL-03.self.update-with-revision | PASS | 200 {"id":"44408c32…","organization_id":"44638c99…","person_id":"e544b48d…","team_id":null,"frequency": (want 200) rev 2 |
| AVAIL-03.self.update-stale-revision | PASS | 409 {"error":"These preferences changed; reload and try again","code":"conflict"} (want 409) |
| AVAIL-03.self.save-team-pref | PASS | 200 {"id":"7161cae8…","organization_id":"44638c99…","person_id":"e544b48d…","team_id":"ab3e4d61-2754-47 (want 200) |
| AVAIL-03.self.team-pref-stale | PASS | 409 {"error":"These preferences changed; reload and try again","code":"conflict"} (want 409) |
| AVAIL-03.self.pref-week-both-preferred-and-avoided | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"avoided_weeks","code":"custom","message":"A week cannot be both preferred and avoided"}]} ( |
| AVAIL-03.self.pref-max=0 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"max_per_month","code":"too_small","message":"Number must be greater than or equal to 1"}]}  |
| AVAIL-03.self.pref-max=32 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"max_per_month","code":"too_big","message":"Number must be less than or equal to 31"}]} (wan |
| AVAIL-03.self.pref-week=6 | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"preferred_weeks.0","code":"too_big","message":"Number must be less than or equal to 5"}]} ( |
| AVAIL-03.self.pref-bad-date | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"preferred_dates.0","code":"custom","message":"Choose a valid date"}]} (want 400,422) |
| AVAIL-03.self.pref-bad-frequency | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"frequency","code":"invalid_enum_value","message":"Invalid enum value. Expected 'every_week' |
| AVAIL-03.self.pref-unknown-team | PASS | 400 {"error":"Team does not belong to this organization","code":"bad_request"} (want 400,404,409,422) |
| AVAIL-03.self.pref-foreign-org-team | PASS | 400 {"error":"Team does not belong to this organization","code":"bad_request"} (want 400,404,409,422) |
| AVAIL-03.self.pref-foreign-team.persisted-none | PASS |  |
| AVAIL-03.unrelated.save-pref-for-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-03.delegate(no grant).save-pref-for-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-03.outsider.save-pref-A-ctx | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| AVAIL-03.unrelated.get-dana-prefs | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-03.self.get-prefs | PASS | 200 [{"id":"44408c32…","organization_id":"44638c99…","person_id":"e544b48d…","team_id":null,"frequency" (want 200) n=2 |
| AVAIL-03.scheduler.get-dana-prefs | PASS | 200 [{"id":"44408c32…","organization_id":"44638c99…","person_id":"e544b48d…","team_id":null,"frequency" (want 200) n=2 |
| AVAIL-03.unrelated.PostgREST-prefs-of-dana | PASS | rows=0 |
| AVAIL-03.leader.PostgREST-prefs-of-dana(info) | PASS | rows=2 |
| AVAIL-03.unrelated.delete-dana-pref | PASS | 404 {"error":"Preference not found","code":"not_found"} (want 403,404) |
| AVAIL-03.unrelated.delete-pref.persisted-intact | PASS |  |
| AVAIL-03.self.delete-pref-malformed-id | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404)] |
| AVAIL-03.self.delete-team-pref | PASS | 204 "" (want 204) |
| AVAIL-03.self.review | PASS | 200 {"person_id":"e544b48d…","reviewed_at":"2026-11-17T22:50:24.607707+00:00","kind":"changed","freshness":"current"} (want 200) {"person_id":"e544b48d…","reviewed_at":"2 |
| AVAIL-03.unrelated.review-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-03.scheduler.review-dana | PASS | 200 {"person_id":"e544b48d…","reviewed_at":"2026-11-17T22:50:24.607707+00:00","kind":"changed","freshness":"current"} (want 200) |
| AVAIL-03.scheduler.affirm-for-dana-denied | PASS | 403 {"error":"Only the person, or someone they asked to help, can confirm their availability","code":"forbidden"} (want 403) |
| AVAIL-03.leader.affirm-for-dana-denied | PASS | 403 {"error":"Only the person, or someone they asked to help, can confirm their availability","code":"forbidden"} (want 403) |
| AVAIL-03.owner.affirm-for-dana-denied | PASS | 403 {"error":"Only the person, or someone they asked to help, can confirm their availability","code":"forbidden"} (want 403) |
| AVAIL-03.unrelated.affirm-for-dana-denied | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| AVAIL-03.self.affirm | PASS | 200 {"person_id":"e544b48d…","reviewed_at":"2026-11-17T22:51:12.063563+00:00","kind":"affirmed","freshness":"current"} (want 200) {"person_id":"e544b48d…","reviewed_at":" |
| AVAIL-03.self.review-after-affirm-fresh | PASS | {"person_id":"e544b48d…","reviewed_at":"2026-11-17T22:51:12.063563+00:00","kind":"affirmed","freshness":"current"} |
| AVAIL-03.self.affirm-bad-id | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"person_id","code":"invalid_string","message":"Invalid uuid"}]} (want 400,422) |
| AVAIL-03.sched.warnings | PASS | 200 [] (want 200) codes= |
| AVAIL-03.sched.warnings.no-reason-leak | PASS |  |
| AVAIL-03.leader.warnings | PASS | 200 [] (want 200) codes= |
| AVAIL-03.leader.warnings.no-reason-leak | PASS |  |
| AVAIL-03.owner.warnings | PASS | 200 [] (want 200) codes= |
| AVAIL-03.owner.warnings.no-reason-leak | PASS |  |
| AVAIL-03.unrelated.warnings-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.dana.warnings-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.delegate.warnings-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.scheduler.warnings-foreign-person | PASS | 400 {"error":"Warning scope crosses organizations","code":"bad_request"} (want 400,404,422) |
| AVAIL-03.scheduler.warnings-foreign-plan | PASS | 404 {"error":"Plan not found","code":"not_found"} (want 400,404) |
| AVAIL-03.scheduler.warnings-foreign-team | PASS | 404 {"error":"Team not found","code":"not_found"} (want 400,404) |
| AVAIL-03.leader(scope Band).warnings-for-other-team(info) | PASS | 200 [] (want 200,403) |
| AVAIL-03.scheduler.request-preview | PASS | 200 [{"person_id":"e544b48d…","first_name":"Avail","last_name":"dana","has_login":true,"has_email":true,"reviewed_at":"2026-11-17T22:51:12.150213+00:00","rev (want 200) n |
| AVAIL-03.unrelated.request-preview-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.dana.request-preview-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.delegate.request-preview-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.scheduler.request-preview-foreign-team | PASS | 404 {"error":"Team not found","code":"not_found"} (want 400,404) |
| AVAIL-03.leader(Band-scope).create-request | PASS | 201 {"request_id":"163ec7cd…","effect_id":"5fdfa7ca…","replayed":false} (want 201,403) {"request_id":"163ec7cd…","effect_id":"5fdfa7ca…","replayed":false} |
| AVAIL-03.leader.create-request-replay-idempotent | PASS | 200 replayed=true |
| AVAIL-03.leader(Band-scope).create-request-other-team | PASS | 404 {"error":"Team not found","code":"not_found"} (want 403,404,409) |
| AVAIL-03.unrelated.create-request-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| AVAIL-03.scheduler.create-window-reversed | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"window_end","code":"custom","message":"The period must end on or after it starts"}]} (want  |
| AVAIL-03.scheduler.create-audience-changed(person not in team) | PASS | 409 {"error":"The team changed since the preview; review the recipients again","code":"conflict","details":{"code":"audience_changed"}} (want 409,400) |
| AVAIL-03.scheduler.create-foreign-person | PASS | 409 {"error":"The team changed since the preview; review the recipients again","code":"conflict","details":{"code":"audience_changed"}} (want 400,404,409) |
| AVAIL-03.scheduler.create-foreign-team | PASS | 404 {"error":"Team not found","code":"not_found"} (want 400,404,409) |
| AVAIL-03.recipient.requests-mine | PASS | 200 [{"request_id":"163ec7cd…","message":"Please refresh","window_start":"2027-06-01","window_end":"2027-06-30","respond_by":"2027-05-25","created_at":"2026- (want 200) n |
| AVAIL-03.nonrecipient.requests-mine-empty | PASS | 0 |
| AVAIL-03.leader(creator).request-detail | PASS | 200 {"request":{"id":"163ec7cd…","organization_id":"44638c99…","team_id":"ab3e4d61…","message":"Please  (want 200) recips=3 |
| AVAIL-03.scheduler.request-detail | PASS | 200 {"request":{"id":"163ec7cd…","organization_id":"44638c99…","team_id":"ab3e4d61…","message":"Please  (want 200) |
| AVAIL-03.recipient.request-detail(self-only or denied) | PASS | 404 {"error":"Request not found","code":"not_found"} (want 200,404) recips=undefined |
| AVAIL-03.recipient.request-detail.no-other-recipients | PASS |  |
| AVAIL-03.recipient2.request-detail | PASS | 404 {"error":"Request not found","code":"not_found"} (want 200,404) recips=undefined |
| AVAIL-03.nonrecipient-member.request-detail | PASS | 404 {"error":"Request not found","code":"not_found"} (want 404) |
| AVAIL-03.outsider.request-detail-B-ctx | PASS | 404 {"error":"Request not found","code":"not_found"} (want 403,404) |
| AVAIL-03.multi.B-ctx.request-detail | PASS | 404 {"error":"Request not found","code":"not_found"} (want 403,404) |
| AVAIL-03.self.request-detail-malformed-id | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404)] |
| AVAIL-03.scheduler.list-requests | PASS | 200 [{"id":"163ec7cd…","organization_id":"44638c99…","team_id":"ab3e4d61…","message":"Please refresh"," (want 200) n=1 |
| AVAIL-03.member.list-requests-no-foreign | PASS | 200 n=0 |
| AVAIL-03.multi.list-requests-B-ctx-none | PASS | 200 [] (want 200) n=0 |
| AVAIL-03.multi.list-requests-B-ctx-no-A-data | PASS |  |
| AVAIL-03.scheduler.warnings-content(plan2 week2) | PASS | 200 [{"person_id":"e544b48d…","code":"frequency","detail":"Prefers serving every other week","params":{"frequency":"every_other_week"},"preference_team_id":n (want 200) e |
| AVAIL-03.warnings.avoided_week-for-dana | PASS | e544:frequency,e544:avoided_week,e544:outside_preferred_weeks,dfad:availability_unknown |
| AVAIL-03.warnings.availability_unknown-for-never-reviewed(owner) | PASS | e544:frequency,e544:avoided_week,e544:outside_preferred_weeks,dfad:availability_unknown |
| AVAIL-03.warnings.availability_stale-after-120d | PASS | frequency,avoided_week,outside_preferred_weeks,availability_stale,availability_unknown |
| AVAIL-03.self.review-stale-freshness | PASS | {"person_id":"e544b48d…","reviewed_at":"2026-07-20T22:51:59.57+00:00","kind":"affirmed","freshness":"stale"} |
| AVAIL-03.unrelated.RPC-affirm_availability-for-dana-denied | PASS | P0002 |
| AVAIL-03.scheduler.RPC-affirm_availability-for-dana(info: API forbids; DB?) | PASS | P0002 |
| DELEGATE-01.delegate.list.API | PASS | 200 [{"id":"7ca5c4be…","direction":"received","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"2393 (want 200) n=1 |
| DELEGATE-01.dana.list.API | PASS | 200 [{"id":"7ca5c4be…","direction":"given","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934f9 (want 200) n=1 |
| DELEGATE-01.unrelated.list-sees-none.API | PASS | 200 n=0 |
| DELEGATE-01.multi.list-in-B-none.API | PASS | 200 n=0 |
| DELEGATE-01.outsider(B owner).list-in-A-ctx.API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| DELEGATE-01.delegate.view-schedule(can_view).API | PASS | 200 {"delegation":{"id":"7ca5c4be…","direction":"received","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_per (want 200) entries=2 |
| DELEGATE-01.unrelated.view-schedule-via-foreign-grant.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.dana(target).view-own-grant-schedule-endpoint.API | PASS | 404 {"error":"Schedule not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.owner.view-schedule-via-foreign-grant.API | PASS | 404 {"error":"Schedule not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.outsider.B-ctx.view-schedule.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.multi.B-ctx(other org).view-schedule-A-grant.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.unrelated.respond-via-foreign-grant.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate.respond-other-person-assignment(asg of unrelated).API | PASS | 404 {"error":"Request not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate.respond-substitution.persisted-unchanged | PASS | asg3=unconfirmed |
| DELEGATE-01.delegate.respond-stale-expected.API | PASS | 409 {"error":"This request changed; refresh and try again","code":"conflict","details":{"code":"assignment_response_stale"}} (want 409) |
| DELEGATE-01.delegate.reason-on-confirm.API | PASS | reason silently dropped on confirm (delegations.ts:64 only keeps reason for declined); first confirm persisted [200 {"assignment_id":"2c554c81…","status":"confirmed","tra |
| DELEGATE-01.delegate.status-unconfirmed-invalid.API | PASS | 422 is the project validation convention (oracle expected 400) [422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"status","code":"invalid_enu |
| DELEGATE-01.delegate.respond-confirm(can_respond).API | PASS | 200 {"assignment_id":"2c554c81…","status":"confirmed","transition":"unchanged"} (want 200) |
| DELEGATE-01.delegate.respond.persisted | PASS | confirmed |
| DELEGATE-01.delegate.respond-idempotent-same.API | PASS | 200 {"assignment_id":"2c554c81…","status":"confirmed","transition":"unchanged"} (want 200) unchanged |
| DELEGATE-01.delegate.respond-malformed-assignment-id.API | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":"22P02"} (want 400,404)] |
| DELEGATE-01.delegate.respond-wrong-org-ctx(B nonmember).API | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| DELEGATE-01.grant.no-capabilities.API | PASS | 422 is the project validation convention (oracle expected 400) [422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"can_respond","code":"custom |
| DELEGATE-01.grant.self.API | PASS | 400 {"error":"Choose someone else","code":"bad_request"} (want 400,422) |
| DELEGATE-01.grant.cross-org-person.API | PASS | 400 {"error":"The helper must be an active member with a login","code":"bad_request"} (want 400,404,422) |
| DELEGATE-01.grant.past-expiry.API | PASS | 400 {"error":"Expiry must be within the next two years","code":"bad_request"} (want 400,422) |
| DELEGATE-01.grant.expiry>2y.API | PASS | 400 {"error":"Expiry must be within the next two years","code":"bad_request"} (want 400,422) |
| DELEGATE-01.grant.malformed-delegate-id.API | PASS | 422 is the project validation convention (oracle expected 400) [422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"delegate_person_id","code": |
| DELEGATE-01.grant.owner-grants-own-only.API | PASS | 201 {"id":"90d314ba…","direction":"given","target_person_id":"dfad19c8…","target_name":"Avail owner","delegate_person_id":"6b2acca (want 201) target=Avail owner |
| DELEGATE-01.grant.no-way-to-name-other-target | PASS | target is owner person |
| DELEGATE-01.unrelated.revoke-foreign-grant.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate.revoke-own-received-grant.API | PASS | 200 {"id":"7ca5c4be…","direction":"received","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934 (want 200) |
| DELEGATE-01.delegate.respond-after-revoke.API | PASS | 404 {"error":"Request not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate.view-after-revoke.API | PASS | 404 {"error":"Schedule not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate.revoke-idempotent.API | PASS | 200 {"id":"7ca5c4be…","direction":"received","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934 (want 200) |
| DELEGATE-01.owner(grantor).revoke.API | PASS | 200 {"id":"90d314ba…","direction":"given","target_person_id":"dfad19c8…","target_name":"Avail owner","delegate_person_id":"6b2acca (want 200) |
| DELEGATE-01.dana(target).revoke-already-revoked.API | PASS | 200 {"id":"7ca5c4be…","direction":"given","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934f9a (want 200) |
| DELEGATE-01.dana.revoke-unknown.API | PASS | 404 {"error":"Delegation not found","code":"not_found"} (want 404) |
| DELEGATE-01.dana.revoke-malformed-id.API | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"xyz\"","code":"22P02"} (want 400,404)] |
| DELEGATE-01.grant.availability-only | PASS | 201 {"id":"6161ba12…","direction":"given","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934f9a (want 201) |
| DELEGATE-01.dana.revoke-availability-grant | PASS | 200 {"id":"6161ba12…","direction":"given","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934f9a (want 200) |
| DELEGATE-01.delegate.change-series-after-revoke | PASS | 400 {"error":"Repeating blockout not found","code":"P0002"} (want 400,403,404) |
| DELEGATE-01.revoked-delegate.series-change.persisted-intact | PASS |  |
| DELEGATE-01.revoked-delegate.create-blockout | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| DELEGATE-01.revoked-delegate.list-dana | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| DELEGATE-01.revoked-delegate.PostgREST-blockouts-dana | PASS | rows=0 |
| DELEGATE-01.delegate(respond-only).affirm-for-dana-denied | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| DELEGATE-01.delegate(availability).affirm-for-dana | PASS | 200 {"person_id":"e544b48d…","reviewed_at":"2026-11-17T22:51:12.150213+00:00","kind":"affirmed","freshness":"current"} (want 200) |
| DELEGATE-01.delegate(availability-only).respond-denied(independent caps) | PASS | 404 {"error":"Request not found","code":"not_found"} (want 403,404) |
| DELEGATE-01.delegate(availability-only).view-schedule-denied-or-allowed | PASS | 404 {"error":"Schedule not found","code":"not_found"} (want 200,403,404) info: view requires can_view_schedule//can_respond |
| DELEGATE-01.delegate(availability-only).asg2.persisted-unchanged | PASS |  |
| DELEGATE-01.can_signup.consumers | NOT_APPLICABLE | can_signup is stored by grant_schedule_delegation but no API/RLS path consumes delegation_for(...,'signup') (grep: only f03_delegation migration, delegations.ts, availabi |
| DELEGATE-01.grant.short-expiry | PASS | 201 {"id":"6af1bbd4…","direction":"given","target_person_id":"e544b48d…","target_name":"Avail dana","delegate_person_id":"23934f9a (want 201) |
| DELEGATE-01.delegate.create-before-expiry | PASS | 201 {"blockout":{"id":"76bdf687…","organization_id":"44638c99…","user_id":"ae396933…","starts_at":"2027 (want 201) |
| DELEGATE-01.delegate.create-after-expiry | PASS | 403 {"error":"Only schedulers or someone they asked to help can change another person’s availability","code":"forbidden"} (want 403,404) |
| DELEGATE-01.expired-grant.listed-as-inactive-or-hidden | PASS | [{"active":false,"exp":true}] |
| DELEGATE-01.unrelated.PostgREST-list-delegations-none | PASS | the single row is unrelated own received (revoked) grant from owner; no foreign grants [rows=1] |
| DELEGATE-01.dana.PostgREST-direct-insert-grant-denied | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"schedule_de |
| DELEGATE-01.delegate.PostgREST-escalate-own-grant-denied | PASS | [] |
| DELEGATE-01.dana.PostgREST-direct-update-grant-denied | PASS | [] |
| DELEGATE-01.unrelated.RPC-grant-grants-own-schedule-only | PASS | self-delegation rejected ("Choose someone else"); re-run with another delegate returned target=self [{"code":"22023","details":null,"hint":null,"message":"Choose someone  |
| DELEGATE-01.unrelated.RPC-grant-in-foreign-org-denied | PASS | 42501 |
| DELEGATE-01.unrelated.RPC-respond_as_delegate-for-dana-denied | PASS | P0002 Request not found |
| DELEGATE-01.unrelated.RPC-delegated_schedule-dana-denied | PASS | P0002 |
| DELEGATE-01.delegate(expired-grant).RPC-delegated_schedule | PASS | P0002 |
| ORGS-01.multi.settings-default-off | PASS | 200 {"user_id":"239ed0b6…","combined_schedule":false,"share_busy_across_orgs":false,"updated_at":"1970-01-01T00:00:00.000Z"} (want 200) {"user_id":"239ed0b6…","combined_s |
| ORGS-01.settings.defaults-both-false | PASS |  |
| ORGS-01.multi.combined-while-off-denied | PASS | 403 {"error":"Turn on the combined schedule first","code":"forbidden"} (want 403) |
| ORGS-01.multi.opt-in-combined-only | PASS | 200 {"user_id":"239ed0b6…","combined_schedule":true,"share_busy_across_orgs":false,"updated_at":"2026-11-17T22:51:59.901+00:00"} (want 200) {"user_id":"239ed0b6…","combin |
| ORGS-01.opt-ins-independent(combined on, busy off) | PASS |  |
| ORGS-01.multi.combined-both-orgs | PASS | 200 {"from":"2027-03-01T00:00:00Z","to":"2027-05-31T00:00:00Z","organizations":[{"organization_id":"44638c99…","organization_name":"QA Avail A","status":"ok" (want 200) o |
| ORGS-01.combined.A-items-only-A-data | PASS | ["ASECRET-BLOCK-REASON:blockout","QA Avail Plan 2:assignment","SENTINEL-REASON-QA7-MULTI:blockout"] |
| ORGS-01.combined.B-items-only-B-data | PASS | ["BSECRET-PLAN-TITLE:assignment","BSECRET-BLOCK-REASON:blockout"] |
| ORGS-01.combined.prepared-assignment-excluded | PASS |  |
| ORGS-01.combined.own-blockout-reasons-visible-to-self(own data) | PASS | own reasons |
| ORGS-01.multi.combined-with-X-Org-header-A-same-result | PASS | 200 {"from":"2027-03-01T00:00:00Z","to":"2027-05-31T00:00:00Z","organizations":[{"organization_id":"44638c99…","organization_name":"QA Avail A","status":"ok" (want 200) o |
| ORGS-01.combined.window>92d | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"to","code":"custom","message":"Choose a window of at most 92 days"}]} (want 400,422) |
| ORGS-01.combined.window-reversed | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"to","code":"custom","message":"Choose a window of at most 92 days"}]} (want 400,422) |
| ORGS-01.combined.window-missing | PASS | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"from","code":"invalid_type","message":"Required"},{"path":"to","code":"invalid_type","m |
| ORGS-01.settings.invalid-body | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"combined_schedule","code":"invalid_type","message":"Expected boolean, received string"},{"p |
| ORGS-01.single-org dana.combined-only-own-org-no-bleed | PASS | QA Avail A |
| ORGS-01.single-org unrelated.combined-only-own-org-no-bleed | PASS | QA Avail A |
| ORGS-01.bmember.combined-no-A-data | PASS | QA Avail B:0 |
| ORGS-01.dana.PostgREST-read-multi-settings | PASS | rows=0 |
| ORGS-01.dana.PostgREST-write-multi-settings | PASS | {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for table \"user_schedu |
| ORGS-01.combined.inactive-B-membership-omitted | PASS | QA Avail A |
| ORGS-01.inactive-B.api-denied | PASS | 403 {"error":"You are not a member of that organization","code":"forbidden"} (want 403,404) |
| ORGS-01.busy.off-no-busy_elsewhere | PASS |  |
| ORGS-01.multi.opt-in-busy-only | PASS | 200 {"user_id":"239ed0b6…","combined_schedule":false,"share_busy_across_orgs":true,"updated_at":"2026-11-17T22:52:00.239+00:00"} (want 200) |
| ORGS-01.opt-ins-independent(busy on, combined off) | PASS |  |
| ORGS-01.combined-off-while-busy-on-denied | PASS | 403 {"error":"Turn on the combined schedule first","code":"forbidden"} (want 403) |
| ORGS-01.busy.on-shows-busy_elsewhere-to-scheduler | PASS | busy_elsewhere |
| ORGS-01.busy.warning-redacted(no org/title/reason) | PASS | [{"person_id":"2b35b8b5…","code":"busy_elsewhere","detail":"Busy at this time in another organization","params":{},"preference_team_id":null}] |
| ORGS-01.busy.leader-sees-busy-only | PASS | busy_elsewhere |
| ORGS-01.busy.B-blockout-yields-busy_elsewhere | PASS | busy_elsewhere true |
| ORGS-01.busy.B-blockout-reason-not-leaked | PASS |  |
| ORGS-01.busy.non-scheduler-denied | PASS | 403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} (want 403) |
| ORGS-01.scheduling-conflicts.no-B-data | PASS | 200 [] |
| ORGS-01.B-scheduler.RPC-cross_organization_busy.shape-busy-only | PASS | rows=2 keys=person_id,starts_at,ends_at |
| ORGS-01.B-member(non-scheduler).RPC-cross_organization_busy-denied | PASS | 42501 |
| ORGS-01.B-owner.RPC-cross_organization_busy-with-A-org-id-denied | PASS | 42501 |
| ORGS-01.B-member.RPC-my_organization_schedule-for-A-denied | PASS | 42501 |
| ORGS-01.multi.copy-A-to-B(no reason) | PASS | 200 {"results":[{"organization_id":"21e82a83…","outcome":"copied","copied":2,"error":null}]} (want 200) {"results":[{"organization_id":"21e82a83…","outcome":"copied","cop |
| ORGS-01.copy.persisted-2-rows-in-B-reason-null | PASS | [null,null] |
| ORGS-01.copy.retry-same-key-idempotent | PASS | {"results":[{"organization_id":"21e82a83…","outcome":"already_copied","copied":0,"error":null}]} rows=2 |
| ORGS-01.copy.new-key-same-blockouts(info: duplicates?) | PASS | info: a NEW idempotency key re-copies (duplicates); only same-key retry is idempotent -- by contract [rows after new key=4 {"results":[{"organization_id":"21e82a83…","out |
| ORGS-01.multi.copy-other-persons-blockout | PASS | 404 {"error":"Choose your own blockouts to copy","code":"not_found"} (want 403,404) |
| ORGS-01.copy-foreign-blockout.persisted-none | PASS |  |
| ORGS-01.multi.copy-mixed-own+foreign-atomic | PASS | 404 {"error":"Choose your own blockouts to copy","code":"not_found"} (want 403,404) |
| ORGS-01.multi.copy-unknown-target-org | PASS | 200 {"results":[{"organization_id":"d0b1d6ab…","outcome":"not_member","copied":0,"error":null}]} (want 200) {"results":[{"organization_id":"d0b1d6ab…","outcome":"not_memb |
| ORGS-01.copy-unknown-target.outcome-not_member | PASS | [{"organization_id":"d0b1d6ab…","outcome":"not_member","copied":0,"error":null}] |
| ORGS-01.copy-to-non-member-org.not_member-no-write | PASS | [{"organization_id":"a14ff80c…","outcome":"not_member","copied":0,"error":null}] |
| ORGS-01.copy-to-source-org-ignored | PASS | {"results":[]} |
| ORGS-01.multi.copy-with-reason | PASS | 200 {"results":[{"organization_id":"21e82a83…","outcome":"copied","copied":1,"error":null}]} (want 200) {"results":[{"organization_id":"21e82a83…","outcome":"copied","cop |
| ORGS-01.copy-missing-org-header | PASS | 400 {"error":"Choose the organization to copy from","code":"bad_request"} (want 400) |
| ORGS-01.copy-malformed-org-header | FAIL | 500 with raw Postgres text (22P02) -- API-D5 surface -> API-D5 [500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":"22P02"} (want 400,403,404)] |
| ORGS-01.dana(non-B-member).copy-with-B-source | PASS | 404 {"error":"Person not found","code":"not_found"} (want 403,404) |
| ORGS-01.ownerb.copy-A-blockouts-from-B-source | PASS | 404 {"error":"Choose your own blockouts to copy","code":"not_found"} (want 403,404) |
| ORGS-01.copy-empty-ids | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"blockout_ids","code":"too_small","message":"Array must contain at least 1 element(s)"}]} (w |
| ORGS-01.copy-bad-key | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"idempotency_key","code":"too_small","message":"String must contain at least 8 character(s)" |
| ORGS-01.copy-malformed-blockout-id | PASS | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"blockout_ids.0","code":"invalid_string","message":"Invalid uuid"}]} (want 400,422) |
| ORGS-01.B-other-member.cannot-see-copied-blockouts | PASS | rows=0 |
| ORGS-01.B-owner.sees-copies | PASS | rows=6 reasons=["BSECRET-BLOCK-REASON","COPYSECRET-1",null,null,null,null] |
| ORGS-01.copy-after-B-membership-revoked.not_member | PASS | {"results":[{"organization_id":"21e82a83…","outcome":"not_member","copied":0,"error":null}]} |
