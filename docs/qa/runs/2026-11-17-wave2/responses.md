# QA-05 Volunteer responses and capacity - wave 2 (2026-11-17)

Package QA-05 from `docs/plans/admin-mobile-test-plan.md`. Owned cases: RESP-01-04, OPPORT-01-02, REPLACE-01-02, SWAP-01 (plan sections 5.D, 3, 4 D04-07/D15, 8, 12).
Environment: freshly reset local Supabase (71 migrations, latest `20261118000000`), backend :4000, branch `main` (HEAD `cac3f26`). No implementation, migration, test or config file was changed. Browser pane, native apps: not used (another agent owns the browser; web/native surfaces are NOT_RUN below).
Namespace: orgs `qa-20261117-resp-a` (Alpha) and `qa-20261117-resp-b` (Beta); users `{owner,sched,lead,m1..m4,out,bowner}.qa20261117.resp@example.test`. Credentials stay in the session scratchpad only.

## Result summary

| Track | Result |
|---|---|
| DB suites on the fresh DB (rollback form): assignment-response-history, mob005-assignment-removal, mob005-snapshots-and-attendance, f07-signups-replacements, mob009-signup-claims, mob010-replacements, assignment-notifications-rls | 7/7 PASS (all were BLOCKED or not run in wave 1 for the f07/mob009/mob010 trio) |
| DB race scripts (self-cleaning): `f07-concurrent-allocation.sh` x3 (claim/claim, offer/offer, signup/replacement/manual), `mob005-concurrent-token.sh` x3 | 6/6 PASS. One winner each time, no overfill |
| Expanded API / tokenized / direct-PostgREST cases | **516 executed: 503 PASS, 13 FAIL (5 defects), 0 BLOCKED**. NOT_RUN: web/native fallback pages |
| Real parallel API races (separate user sessions, random 0-40 ms jitter) | OPPORT-02 + REPLACE-02 + RESP-04 + SWAP: ~700 race iterations. **0 overfills, 0 lost writes, 0 duplicate assignments, 0 mixed answer batches.** 3 race families produce a 409 where a replay-success was expected (D3) |

Per-family counts (a case may involve several roles/surfaces; one row per expanded case below):

| Family | PASS | FAIL |
|---|---|---|
| RESP-01 | 71 | 1 (D5) |
| RESP-02 | 37 | 0 |
| RESP-03 | 44 | 2 (D4) |
| RESP-04 | 16 | 2 (D3) |
| OPPORT-01 | 113 | 4 (D1 x2, D2, D5) |
| OPPORT-02 | 13 | 0 |
| REPLACE-01 | 129 | 2 (D2, D5) |
| REPLACE-02 | 14 | 1 (D3) |
| SWAP-01 | 59 | 1 (D2) |
| ACL (private-function / direct-write exposure) | 7 | 0 |

## P0 status

No P0. No overfill (final-slot, replacement, swap), no lost write, no cross-tenant read or write (Beta owner/user got 403/404/empty on every Alpha object via API, RPC and PostgREST), no private-field leak (decline reasons visible only to the owner/scheduler/response owner, link preview discloses only first name, plan title/time, team/position, status and times), no unauthorized persisted mutation.

## Defects

### W2-RESP-D1 (P1) `GET /opportunity-claims` returns an empty list for schedulers and team leaders
- Repro: org Alpha; scheduler (`role=scheduler`) creates a `leader_approval` opening; member m1 claims it (201, `awaiting_approval`). `GET /opportunity-claims?plan_id=<plan>` as owner returns 1 row; as scheduler and as the Band team leader (scoped `scheduling.manage`) returns `[]` (200). Direct PostgREST `opportunity_claims` select as the scheduler returns the row, so only the embed is at fault.
- Expected: everyone who can decide a claim sees the claims awaiting approval. Actual: the pending-approvals list is empty for every non-owner approver, so the leader-approval workflow cannot be driven from the list (decision endpoint itself works if the claim id is known).
- Cause: the select embeds `person:people!inner(first_name,last_name)`; since `20261109000000` (`people_owner_privacy`) a non-owner only sees their own `people` row, so the inner join drops every other person's claim. Suspected: `backend/src/routes/opportunities.ts:97` (use `people_directory`, or a left join / security-definer list).
- Cases: OPPORT-01.claims-list.sched, OPPORT-01.claims-list.lead.

### W2-RESP-D2 (P1) Approval gates can be satisfied by the beneficiary (no candidate/claimant/participant self-approval check)
- Repro 1 (REPLACE-01): lead (member of Band with team-scoped `scheduling.manage`) is offered a replacement by the scheduler; `accept` (consent), then `POST /replacement-offers/:id/action {action:"approve"}` as the same user -> 200, offer `finalized`, new confirmed assignment created, `leader_approved_by` = the candidate. Repeated: 100% reproducible.
- Repro 2 (OPPORT-01): lead claims a `leader_approval` opening (201 awaiting_approval) then `POST /opportunity-claims/:id/decision {action:"approve"}` as lead -> 200, claim `confirmed`, assignment created.
- Repro 3 (SWAP-01): lead (Band leader) holds a confirmed Band assignment, m2 holds one on another plan; lead creates the swap, m2 consents, lead approves -> 200, swap `finalized`, both exchanged.
- Expected (plan REPLACE-01 "no candidate self-approval"; leader approval is the independent second control in each flow): refuse approve/reject by the person who is the candidate/claimant/participant (403/409). Actual: allowed. Needs only a person who is simultaneously eligible and a scheduler for the team, which is the normal team-lead shape.
- Suspected: `supabase/migrations/20261023000000_f07_signups_replacements.sql` `decide_signup_claim` approve branch (line 405 permission check, 412 approve; no `c.person_id <> actor person`), `act_on_replacement_offer` (line 632/635), `act_on_approved_swap` approve branch (line ~689).

### W2-RESP-D3 (P2) Concurrent retry of an identical request gets 409 instead of the original result (and leaks raw constraint detail)
- Sequential replay of the same request is idempotent (200/201 same row, no duplicate history/notification: PASS). Racing duplicates are not:
  - `POST /assignments/responses/commit` same snapshot, same `idempotency_key`, 3 parallel: one 200, two 409 (15/15 runs). The key lookup (`20261017000300_mob005_identity_times_snapshots.sql:1398-1403`) happens before the snapshot lock; the loser then sees `consumed_at` (line 1197) and raises PT409, rolled back, so it never reads the stored result.
  - `POST /assignments/:id/respond {status:confirmed}` x3 parallel: one 200, two 409 `assignment_response_stale` although the stored state equals the requested state (15/15). `backend/src/services/assignment-responses.ts:70-85` (`!updated` path reports stale instead of treating `latest.status === requested` as success).
  - `POST /replacement-requests` same key x3 parallel: some calls 409 `{"error":"That record already exists","details":"Key (requester_person_id, idempotency_key)=(<person uuid>, <key>) already exists."}` (9 of 20 runs had at least one). Raw Postgres detail is returned to the client (CLAUDE.md rule 20). Suspected: `create_replacement_request` in `20261023000000_f07_signups_replacements.sql:546` (read-before-insert, unique at :70, no on-conflict path) and `fromPostgrestError` passing `details` through (`backend/src/lib/errors.ts:110-118`).
- Safe outcome: exactly one history row, one scheduler notification, one request row in every run; the issue is the client-visible ambiguity (a transport retry that races the original sees a conflict and must reread). `claim_signup_opportunity` handles the same race correctly (201 x3 same row).

### W2-RESP-D4 (P2) Tokenized response preview shows a stale request that the response then rejects
- Repro: release a plan to m1 (two times, one position) so a link exists; as scheduler `PUT /plans/:id/assignment-times` narrowing the request to the service time with `notify:false`. Anonymous `GET /assignment-responses/<token>` -> 200 showing both rehearsal and service; `POST .../respond` -> 409 `assignment_request_stale`. Same shape when only the snapshot's `expires_at` has passed: GET 200, POST 410.
- Expected: the preview applies the same staleness/expiry test as the answer (409/410). Actual: the user is shown (and asked to answer) times that no longer apply, then rejected. No wrong-scope answer is ever persisted (POST is correct). Suspected: `backend/src/routes/assignment-respond.ts:80-86` (checks only `superseded_at`/`consumed_at`, not current times/revision or snapshot expiry).

### W2-RESP-D5 (P2) Malformed UUID path params return 500 with raw Postgres text (known API-D5, still present in the QA-05 routes)
- `POST /assignments/not-a-uuid/respond`, `POST /opportunities/not-a-uuid/claim`, `POST /replacement-offers/zzz/action` -> 500 `{"error":"invalid input syntax for type uuid: ...","code":"22P02"}`. Expected 400/404. Suspected: `backend/src/routes/assignments.ts:413`, `backend/src/routes/opportunities.ts:81`, `:141` (no uuid validation of `req.params`).

## Observations (not counted as defects; for intent review)

- Mixed per-time answers (rehearsal confirmed, service declined) store both time answers but aggregate the assignment to `unconfirmed` (`apply_assignment_snapshot_response`); no scheduler notification is raised for the per-time decline beyond the per-answer effect.
- Scheduler and team leader can `PATCH /assignments/:id {status}` on a member's behalf (confirmed or declined). A history row is written (1 row) so it is auditable; this is also how a declined assignment is re-requested (reset to `unconfirmed`, then the member re-accepts).
- Manual scheduling past `plan_position_needs.needed` is allowed when there is no open opening or live consent hold (second drummer, 201). Capacity is only enforced against openings and consent holds, as designed; the final-slot races all held.
- A scheduler can issue a replacement offer to the original decliner (201).
- Opening creation requires an existing `plan_position_needs` row (otherwise 400 "capacity must fit the current need"); I set the row with the service role as fixture setup.
- `PATCH /opportunities/:id` with only scope fields (e.g. `team_id`) is stripped and returns 409 "changed; refresh" (misleading but harmless; team unchanged).
- Other members can read each other's assignment rows (team roster visibility); decline reasons stay private. Owner (same tenant) can read `assignment_notifications.token_hash`; the hash is not accepted as a token (404).
- Request validation errors are 422 (project convention), not 400.
- Preview/commit of someone else's assignment answers a generic 409 / 404 (no existence oracle).
- The `delivery_effects` for answers: one `scheduler_response` effect per answer kind per commit; withdrawal is tagged `response_transition=withdrawal`.
- Plan item "revoked" token: no explicit revoke endpoint exists; the replaced token stays valid only if the previous send was provider-accepted (`previous_token_hash`); with an unsent token a re-notify makes the old token 404. Treated NOT_APPLICABLE.

## Method and surfaces

- Fixture (service role, setup only, never used as permission evidence): churches created with `private.create_church`, members inserted into `organization_members`, `plan_position_needs` rows, link-token hashes replaced with a known token (the raw token is never available since `DELIVERY_LINK_SECRET` is unset), clocks moved by patching `closes_at`/`reservation_expires_at`/`expires_at`. Everything else (teams, positions, plans, assignments, releases, openings, claims, requests, offers, swaps, responses) used the caller's own bearer token against the API, plus RLS-scoped PostgREST/RPC for the direct surface.
- Actors: owner, scheduler (legacy role), team leader (scoped `scheduling.manage` on Band), member on team (m1, m2, m3), member not on team (m4), non-member (out), Beta owner (bowner, with Alpha and Beta org headers), anonymous.
- Surfaces: API, tokenized link endpoints, direct PostgREST tables/RPCs, DB SQL suites and shell race scripts. NOT_RUN: web `/respond`, `/my-schedule`, opportunities/replacements UI and native MOB-003-010 screens (browser pane and devices owned elsewhere).
- Race method: `Promise.all` of real HTTP calls from separate sessions with random 0-40 ms start jitter, 15-24 iterations per family, final state read back with the service role (assignment count + live holds vs capacity, history rows, effect rows, statuses).

## NOT_RUN / NOT_APPLICABLE

- RESP-03 web/native fallback, signed-in-wrong-account/wrong-org link behaviour, expired native deep links: NOT_RUN (UI surfaces).
- REPLACE/OPPORT mobile and web tracking-section rendering: NOT_RUN.
- RESP-03 "revoked" token: NOT_APPLICABLE (no revoke feature; see observations).
- Scheduled (cron-like) reservation expiry: only lazy expiry is exercised (list calls and every mutating RPC); no background worker for holds was found.

## Fixtures left in place

Orgs `qa-20261117-resp-a`, `qa-20261117-resp-b`; their auth users; several hundred plans, assignments, openings, claims, requests, offers, swaps, response history and notification/effect rows in Alpha (plan titles `QA resp plan N`). Seed org untouched; the self-cleaning race scripts left no rows.

## Expanded case results

### ACL  (PASS 7 / FAIL 0)

| case | result | evidence |
|---|---|---|
| ACL.rpc.private-fn-not-exposed.f07_finalize_offer | PASS | status=404 {"code":"PGRST202","details":"Searched for the function public.f07_finalize_offer without  |
| ACL.rpc.private-fn-not-exposed.apply_assignment_snapshot_response | PASS | status=404 {"code":"PGRST202","details":"Searched for the function public.apply_assignment_snapshot_r |
| ACL.rpc.private-fn-not-exposed.f07_occupied | PASS | status=404 {"code":"PGRST202","details":"Searched for the function public.f07_occupied without parame |
| ACL.postgrest.member-write-replacement_offers-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |
| ACL.postgrest.member-write-allocation_events-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |
| ACL.postgrest.member-write-approved_swaps-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |
| ACL.postgrest.member-write-opportunity_claims-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |

### OPPORT-01  (PASS 113 / FAIL 4)

| case | result | evidence |
|---|---|---|
| OPPORT-01.create.sched.API | PASS | status=201 |
| OPPORT-01.create.owner.API | PASS | status=201 |
| OPPORT-01.create.lead.API | PASS | status=201 |
| OPPORT-01.create.m1.API | PASS | status=403 |
| OPPORT-01.create.m4.API | PASS | status=403 |
| OPPORT-01.create.out.API | PASS | status=403 |
| OPPORT-01.create.bowner.API | PASS | status=403 |
| OPPORT-01.create.anon.API | PASS | status=401 |
| OPPORT-01.create.lead-other-team-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| OPPORT-01.create.position-of-other-team-rejected | PASS | status=400 {"error":"Opportunity plan, team, position and times must share one organization","code":"bad_reques |
| OPPORT-01.create.crossorg-team-rejected | PASS | status=400 {"error":"Opportunity plan, team, position and times must share one organization","code":"bad_reques |
| OPPORT-01.create.cap0-422 | PASS | status=422 |
| OPPORT-01.create.cap201-422 | PASS | status=422 |
| OPPORT-01.create.closes-in-past | PASS | status=400 (info) {"error":"Opportunity capacity must fit the current need and close in the future |
| OPPORT-01.create.times-from-other-plan-rejected | PASS | status=400 {"error":"Opportunity plan, team, position and times must share one organization","code":"bad_reques |
| OPPORT-01.create.unknown-plan-404 | PASS | status=404 |
| OPPORT-01.create.bad-policy-422 | PASS | status=422 |
| OPPORT-01.create.sched-on-other-org-plan | PASS | status=404 |
| OPPORT-01.list.m1.visible=true | PASS | status=200 visible=true |
| OPPORT-01.detail.m1.200 | PASS | status=200 |
| OPPORT-01.list.m2.visible=true | PASS | status=200 visible=true |
| OPPORT-01.detail.m2.200 | PASS | status=200 |
| OPPORT-01.list.lead.visible=true | PASS | status=200 visible=true |
| OPPORT-01.detail.lead.200 | PASS | status=200 |
| OPPORT-01.list.sched.visible=true | PASS | status=200 visible=true |
| OPPORT-01.detail.sched.200 | PASS | status=200 |
| OPPORT-01.list.owner.visible=true | PASS | status=200 visible=true |
| OPPORT-01.detail.owner.200 | PASS | status=200 |
| OPPORT-01.list.m4.visible=false | PASS | status=200 visible=false |
| OPPORT-01.detail.m4.404 | PASS | status=404 |
| OPPORT-01.list.fields-capacity-times-eligibility | PASS | {"rc":2,"el":"eligible","t":1} |
| OPPORT-01.list.member-view-no-private-claimants | PASS |  |
| OPPORT-01.list.outsider | PASS | status=403 |
| OPPORT-01.list.anon | PASS | status=401 |
| OPPORT-01.list.orgB-owner-with-B-ctx-no-leak | PASS |  |
| OPPORT-01.list.orgB-context-no-A-opportunity | PASS | status=200 |
| OPPORT-01.postgrest.read.m1 | PASS | status=200 rows=1 |
| OPPORT-01.postgrest.read.m4 | PASS | status=200 rows=0 |
| OPPORT-01.postgrest.read.bowner | PASS | status=200 rows=0 |
| OPPORT-01.postgrest.read.out | PASS | status=200 rows=0 |
| OPPORT-01.postgrest.member-insert-blocked | PASS | status=400 |
| OPPORT-01.postgrest.member-patch-capacity-blocked | PASS | status=200 cap=2 |
| OPPORT-01.postgrest.member-delete-blocked | PASS | status=200 |
| OPPORT-01.patch.member-403 | PASS | status=403 |
| OPPORT-01.patch.sched-capacity | PASS | status=200 v=2 |
| OPPORT-01.patch.stale-version-409 | PASS | status=409 |
| OPPORT-01.patch.scope-fields-not-changeable | PASS | status=409 {"error":"This opening changed; refresh and try again","code":"conflict"} |
| OPPORT-01.patch.lead-own-team | PASS | status=200 |
| OPPORT-01.patch.crossorg | PASS | status=409 |
| OPPORT-01.claim.ineligible-m4-403 | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| OPPORT-01.claim.nonmember-403 | PASS | status=403 |
| OPPORT-01.claim.anon-401 | PASS | status=401 |
| OPPORT-01.claim.stale-version-409 | PASS | status=409 {"error":"This opening changed; refresh and review it again","code":"opportunity_changed"} |
| OPPORT-01.claim.short-idempotency-key-422 | PASS | status=422 |
| OPPORT-01.claim.crossorg-B-user | PASS | status=403 |
| OPPORT-01.claim.direct-confirms-immediately | PASS | {"id":"6b08b96e-8676-45ec-9455-43b745e7b0a4","opportunity_id":"ddb9b3dc-a5b9-4c5d-9836-40ead4c3bb9d","person_id":"8b4f0d92-0fdb-4f7b-8288-46fa90211a8f |
| OPPORT-01.claim.assignment-created-confirmed-released | PASS | {"s":"confirmed","v":"released"} |
| OPPORT-01.claim.replay-same-key-same-row | PASS | status=201 |
| OPPORT-01.claim.full-409-capacity_full | PASS | status=409 {"error":"This opening is full","code":"capacity_full"} |
| OPPORT-01.claim.same-person-second-key-rejected | PASS | status=409 occupied=1 |
| OPPORT-01.list.full-shows-full-0-remaining | PASS | {"e":"full","rc":0} |
| OPPORT-01.postgrest.claim-row.m1.visible=true | PASS | rows=1 |
| OPPORT-01.postgrest.claim-row.m2.visible=false | PASS | rows=0 |
| OPPORT-01.postgrest.claim-row.m4.visible=false | PASS | rows=0 |
| OPPORT-01.postgrest.claim-row.sched.visible=true | PASS | rows=1 |
| OPPORT-01.postgrest.claim-row.lead.visible=true | PASS | rows=1 |
| OPPORT-01.postgrest.member-insert-claim-blocked | PASS | status=403 |
| OPPORT-01.postgrest.member-patch-own-claim-blocked | PASS | status=403 now=confirmed |
| OPPORT-01.cancel.other-member-404 | PASS | status=404 |
| OPPORT-01.cancel.stale-409 | PASS | status=409 |
| OPPORT-01.cancel.confirmed-claim-releases | PASS | status=200 asg=declined |
| OPPORT-01.cancel.idempotent-repeat | PASS | status=200 |
| OPPORT-01.claim.after-cancel-capacity-freed | PASS | status=201 |
| OPPORT-01.claim.closed-opening-409 | PASS | close=200 claim=409 {"error":"This opening is closed","code":"opportunity_closed"} |
| OPPORT-01.list.closed-hidden-from-member | PASS |  |
| OPPORT-01.list.closed-visible-to-scheduler | PASS |  |
| OPPORT-01.reopen-then-claim | PASS | reopen=200 claim=201 |
| OPPORT-01.claim.after-deadline-409 | PASS | status=409 {"error":"This opening is closed","code":"opportunity_closed"} |
| OPPORT-01.list.after-deadline-hidden-from-member | PASS |  |
| OPPORT-01.approval.claim-awaiting | PASS | {"id":"375b40b6-f116-42ff-8c13-6fb4248cf5e6","opportunity_id":"1bcc4190-9e1e-429f-8158-7c60e6ad7bdb","person_id":"8b4f0d |
| OPPORT-01.approval.hold-no-assignment-yet | PASS |  |
| OPPORT-01.approval.hold-reduces-remaining-capacity | PASS | {"rc":0,"e":"full"} |
| OPPORT-01.approval.second-claimant-blocked-by-hold | PASS | status=409 |
| OPPORT-01.approval.decide.m1-denied | PASS | status=403 |
| OPPORT-01.approval.decide.m2-denied | PASS | status=403 |
| OPPORT-01.approval.decide.m4-denied | PASS | status=403 |
| OPPORT-01.approval.decide.out-denied | PASS | status=403 |
| OPPORT-01.approval.decide.anon | PASS | status=401 |
| OPPORT-01.approval.decide.crossorg | PASS | status=403 |
| OPPORT-01.approval.decide.bad-action-422 | PASS | status=422 |
| OPPORT-01.approval.decide.stale-409 | PASS | status=409 |
| OPPORT-01.claims-list.owner | PASS | status=200 |
| OPPORT-01.claims-list.sched | FAIL (D1) | status=200 |
| OPPORT-01.claims-list.lead | FAIL (D1) | status=200 |
| OPPORT-01.claims-list.m1 | PASS | status=403 |
| OPPORT-01.claims-list.m4 | PASS | status=403 |
| OPPORT-01.approval.approve.lead(own team) | PASS | status=200 |
| OPPORT-01.approval.approve-twice-409 | PASS | status=409 |
| OPPORT-01.approval.assignment-confirmed | PASS | confirmed |
| OPPORT-01.approval.reject-releases-hold | PASS | status=200 |
| OPPORT-01.approval.cancel-by-claimant-releases-hold | PASS | status=200 |
| OPPORT-01.approval.cancel-by-scheduler | PASS | status=200 |
| OPPORT-01.approval.expired-hold-cannot-approve | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| OPPORT-01.approval.lazy-expiry-status | PASS | status=expired |
| OPPORT-01.approval.after-expiry-capacity-reopens | PASS | status=201 |
| OPPORT-01.list.conflict-marks-unavailable | PASS | el=unavailable |
| OPPORT-01.claim.schedule-conflict-409 | PASS | status=409 {"error":"This opening conflicts with your schedule","code":"scheduling_conflict","details":[]} |
| OPPORT-01.manual-fill-over-capacity-blocked | PASS | status=409 {"error":"This opening no longer has capacity","code":"capacity_full"} occ=1 |
| OPPORT-01.manual-fill-other-position-ok | PASS | status=201 |
| OPPORT-01.create-opening-already-over-capacity-409 | PASS | status=409 {"error":"That record already exists","code":"conflict","details":null} |
| OPPORT-01.rpc.claim-anon-denied | PASS | status=401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function claim |
| OPPORT-01.rpc.list-anon-denied | PASS | status=401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function list_ |
| OPPORT-01.rpc.list-crossorg-denied | PASS | status=403 {"code":"42501","details":null,"hint":null,"message":"Organization access required"} |
| OPPORT-01.rpc.expire-crossorg-denied | PASS | status=403 {"code":"42501","details":null,"hint":null,"message":"Organization access required"} |
| OPPORT-01.rpc.claim-unknown-opportunity-404-ish | PASS | Observation: direct PostgREST RPC reports P0002 as 500; the API route returns 404 (OPPORT-01 API cases) \| status=500 {"code":"P0002","details":null,"hint":null,"message":"Opening not found"} |
| OPPORT-01.claim-self-approval-by-leader-claimant | FAIL (D2) | claim=201 approve=200 occ=1 (leader approved own claim) |
| OPPORT-01.claim.malformed-opportunity-id-4xx(not 500) | FAIL (D5) | POST /opportunities/not-a-uuid/claim -> 500 22P02 raw message |

### OPPORT-02  (PASS 13 / FAIL 0)

| case | result | evidence |
|---|---|---|
| OPPORT-02.claim-vs-claim.4-claimants.cap1.direct.x20 | PASS | maxOccupied=1 (cap 1) {"201x1,409x3,other=0":20} |
| OPPORT-02.claim-vs-claim.4-claimants.cap2.direct.x20 | PASS | maxOccupied=2 (cap 2) {"201x2,409x2,other=0":20} |
| OPPORT-02.claim-vs-claim.4-claimants.cap1.leader_approval.x20 | PASS | maxOccupied=1 (cap 1) {"201x1,409x3,other=0":20} |
| OPPORT-02.claim-vs-claim.4-claimants.cap2.leader_approval.x20 | PASS | maxOccupied=2 (cap 2) {"201x2,409x2,other=0":20} |
| OPPORT-02.same-user-triple-click.same-key.cap2.x20 | PASS | {"201/201/201 rows=1":20} |
| OPPORT-02.same-user-triple-click.diff-keys.cap2.x20 | PASS | {"201/409/409 rows=1":20} |
| OPPORT-02.claim-vs-manual-fill.x20 | PASS | {"claim201/manual409 total=1":18,"claim409/manual201 total=1":2} |
| OPPORT-02.claim-vs-replacement-accept.x20 | PASS | {"claim409/accept200 offer=accepted_awaiting_approval occ=0":11,"claim201/accept409 offer=pending occ=1":9} |
| OPPORT-02.approve-vs-approve.x20 | PASS | {"200/409 ->confirmed asg=1":9,"409/200 ->confirmed asg=1":11} |
| OPPORT-02.approve-vs-cancel.x20 | PASS | {"200/409 ->confirmed asg=1":8,"409/200 ->cancelled asg=0":12} |
| OPPORT-02.approve-vs-reject.x20 | PASS | {"409/200 ->rejected asg=0":9,"200/409 ->confirmed asg=1":11} |
| OPPORT-02.cancel-vs-new-claim.x20 | PASS | {"cancel200/claim201 total=1":15,"cancel200/claim409 total=0":5} |
| OPPORT-02.capacity-shrink-vs-claim.x20 | PASS | {"shrink409/claim201 occ=2 cap=3":9,"shrink200/claim409 occ=1 cap=1":10,"shrink200/claim409 occ=0 cap=1":1} |

### REPLACE-01  (PASS 129 / FAIL 2)

| case | result | evidence |
|---|---|---|
| REPLACE-01.request.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.by-sched-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.by-owner-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.by-lead-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.by-m4-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.anon | PASS | status=401 {"error":"Missing bearer token","code":"unauthorized"} |
| REPLACE-01.request.crossorg-ctxA | PASS | status=403 {"error":"You are not a member of that organization","code":"forbidden"} |
| REPLACE-01.request.stale-revision-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.request.past-expiry-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.request.bad-body-422 | PASS | status=422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"idempotency_key","code":" |
| REPLACE-01.request.by-declined-assignee-201 | PASS | status=201 |
| REPLACE-01.request.retry-same-key-same-row | PASS | status=201 |
| REPLACE-01.request.second-key-open-request-exists | PASS | status=409 {"error":"That record already exists","code":"conflict","details":"Key (original_assignment_id)=(269 sameRow=false (info) |
| REPLACE-01.request.one-open-per-original(info) | PASS | open=1 total=1 |
| REPLACE-01.request.times-copied | PASS | [] |
| REPLACE-01.request.unconfirmed-original-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.request.confirmed-original-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.list.m1.visible=true | PASS | status=200 vis=true |
| REPLACE-01.postgrest.request.m1.visible=true | PASS | rows=1 |
| REPLACE-01.list.sched.visible=true | PASS | status=200 vis=true |
| REPLACE-01.postgrest.request.sched.visible=true | PASS | rows=1 |
| REPLACE-01.list.owner.visible=true | PASS | status=200 vis=true |
| REPLACE-01.postgrest.request.owner.visible=true | PASS | rows=1 |
| REPLACE-01.list.lead.visible=true | PASS | status=200 vis=true |
| REPLACE-01.postgrest.request.lead.visible=true | PASS | rows=1 |
| REPLACE-01.list.m2.visible=false | PASS | status=200 vis=false |
| REPLACE-01.postgrest.request.m2.visible=false | PASS | rows=0 |
| REPLACE-01.list.m3.visible=false | PASS | status=200 vis=false |
| REPLACE-01.postgrest.request.m3.visible=false | PASS | rows=0 |
| REPLACE-01.list.m4.visible=false | PASS | status=200 vis=false |
| REPLACE-01.postgrest.request.m4.visible=false | PASS | rows=0 |
| REPLACE-01.list.outsider-403 | PASS | status=403 {"error":"You are not a member of any organization yet","code":"forbidden"} |
| REPLACE-01.list.orgB-no-A-data | PASS | status=200 |
| REPLACE-01.postgrest.nonparticipant-patch-request | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT |
| REPLACE-01.postgrest.requester-patch-own-request-status | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT now=open |
| REPLACE-01.postgrest.insert-request-directly-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT |
| REPLACE-01.cancel.nonparticipant-404 | PASS | status=404 {"error":"Replacement request not found","code":"not_found"} |
| REPLACE-01.cancel.stale-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.cancel.requester | PASS | status=200 |
| REPLACE-01.cancel.repeat-idempotent | PASS | status=200 |
| REPLACE-01.cancel.original-decline-retained | PASS |  |
| REPLACE-01.consent-then-approve.offer-by-requester-denied | PASS | status=403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.offer-by-member-denied | PASS | status=403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.offer-ineligible-candidate-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.consent-then-approve.offer-by-leader-201 | PASS | status=201 |
| REPLACE-01.consent-then-approve.offer-repeat-same-row | PASS | status=201 |
| REPLACE-01.consent-then-approve.postgrest.offer.m2.visible=true | PASS | rows=1 |
| REPLACE-01.consent-then-approve.postgrest.offer.m1.visible=true | PASS | rows=1 |
| REPLACE-01.consent-then-approve.postgrest.offer.sched.visible=true | PASS | rows=1 |
| REPLACE-01.consent-then-approve.postgrest.offer.m3.visible=false | PASS | rows=0 |
| REPLACE-01.consent-then-approve.postgrest.offer.m4.visible=false | PASS | rows=0 |
| REPLACE-01.consent-then-approve.action-accept.by-m1-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-accept.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-accept.by-sched-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-approve.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-approve.by-m1-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-reject.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-reject.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-decline.by-m4-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.consent-then-approve.action-bogus-422 | PASS | status=422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"action","code":"invalid_e |
| REPLACE-01.consent-then-approve.action-stale-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.consent-then-approve.action-anon | PASS | status=401 {"error":"Missing bearer token","code":"unauthorized"} |
| REPLACE-01.consent-then-approve.consent | PASS | status=200 |
| REPLACE-01.consent-then-approve.consent-holds-place | PASS |  |
| REPLACE-01.consent-then-approve.approve-finalizes | PASS | status=200 |
| REPLACE-01.consent-then-approve.new-assignment-for-candidate-confirmed | PASS | {"p":true,"s":"confirmed"} |
| REPLACE-01.consent-then-approve.original-decline-retained | PASS |  |
| REPLACE-01.consent-then-approve.request-filled | PASS |  |
| REPLACE-01.consent-then-approve.times-scope-equal(orig-attendance rows vs new) | PASS | {"t1":0,"t2":0} |
| REPLACE-01.consent-then-approve.position-occupancy-one | PASS |  |
| REPLACE-01.consent-then-approve.replay-no-duplicate | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.consent-then-approve.filled-request-no-new-offer | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.consent-then-approve.second-request-after-fill-409 | PASS | status=409 {"error":"This vacancy was already filled","code":"capacity_full"} |
| REPLACE-01.consent-then-approve.new-assignee-can-withdraw | PASS | status=200 |
| REPLACE-01.approve-then-consent.offer-by-requester-denied | PASS | status=403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.offer-by-member-denied | PASS | status=403 {"error":"You need the “Schedule people” permission to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.offer-ineligible-candidate-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.approve-then-consent.offer-by-leader-201 | PASS | status=201 |
| REPLACE-01.approve-then-consent.offer-repeat-same-row | PASS | status=201 |
| REPLACE-01.approve-then-consent.postgrest.offer.m2.visible=true | PASS | rows=1 |
| REPLACE-01.approve-then-consent.postgrest.offer.m1.visible=true | PASS | rows=1 |
| REPLACE-01.approve-then-consent.postgrest.offer.sched.visible=true | PASS | rows=1 |
| REPLACE-01.approve-then-consent.postgrest.offer.m3.visible=false | PASS | rows=0 |
| REPLACE-01.approve-then-consent.postgrest.offer.m4.visible=false | PASS | rows=0 |
| REPLACE-01.approve-then-consent.action-accept.by-m1-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-accept.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-accept.by-sched-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-approve.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-approve.by-m1-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-reject.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-reject.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-decline.by-m4-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| REPLACE-01.approve-then-consent.action-bogus-422 | PASS | status=422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"action","code":"invalid_e |
| REPLACE-01.approve-then-consent.action-stale-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.approve-then-consent.action-anon | PASS | status=401 {"error":"Missing bearer token","code":"unauthorized"} |
| REPLACE-01.approve-then-consent.approve-first-still-pending | PASS | status=200 |
| REPLACE-01.approve-then-consent.consent-finalizes | PASS | status=200 |
| REPLACE-01.approve-then-consent.new-assignment-for-candidate-confirmed | PASS | {"p":true,"s":"confirmed"} |
| REPLACE-01.approve-then-consent.original-decline-retained | PASS |  |
| REPLACE-01.approve-then-consent.request-filled | PASS |  |
| REPLACE-01.approve-then-consent.times-scope-equal(orig-attendance rows vs new) | PASS | {"t1":0,"t2":0} |
| REPLACE-01.approve-then-consent.position-occupancy-one | PASS |  |
| REPLACE-01.approve-then-consent.replay-no-duplicate | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.approve-then-consent.filled-request-no-new-offer | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.approve-then-consent.second-request-after-fill-409 | PASS | status=409 {"error":"This vacancy was already filled","code":"capacity_full"} |
| REPLACE-01.approve-then-consent.new-assignee-can-withdraw | PASS | status=200 |
| REPLACE-01.reject.pending-offer | PASS | status=200 |
| REPLACE-01.reject.then-accept-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.reject.new-offer-to-other-candidate | PASS | status=201 |
| REPLACE-01.candidate-decline | PASS | status=200 |
| REPLACE-01.reject.after-consent-releases-hold | PASS | status=200 status=200 |
| REPLACE-01.cancel.request-supersedes-offer-and-hold | PASS | status=200 |
| REPLACE-01.expiry.lazy-expire-on-list | PASS | {"st":"expired","off":["expired"]} |
| REPLACE-01.expiry.accept-after-expiry-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.expiry.offer-after-expiry-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.expiry.re-request-after-expiry | PASS | status=201 |
| REPLACE-01.hold-lapsed.approve-409-no-fill | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.hold-lapsed.manual-fill-allowed | PASS | status=201 |
| REPLACE-01.candidate-with-conflict-cannot-consent | PASS | offer=201 accept=409 |
| REPLACE-01.candidate-self-approval-by-leader-candidate | FAIL (D2) | status=200 offer=finalized approved_by=07d9ce98-62cd-4ef6-b81c-6bff0ab6a5eb |
| REPLACE-01.timed.request-scope-times | PASS | ["52e7aada-e539-4135-9d19-7b2c61d3105f"] |
| REPLACE-01.timed.new-assignment-selected-time-only | PASS | {"m":"selected","t":["52e7aada-e539-4135-9d19-7b2c61d3105f"]} |
| REPLACE-01.second-candidate-consent-blocked-by-first-hold | PASS | status=200 status=409 {"error":"This vacancy is already filled","code":"capacity_full"} |
| REPLACE-01.first-finalizes | PASS | status=200 |
| REPLACE-01.other-offer-superseded | PASS | superseded |
| REPLACE-01.late-accept-on-superseded-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| REPLACE-01.candidate-sees-only-own-offer | PASS | 1 |
| REPLACE-01.requester-sees-all-offers(tracking) | PASS | offers=2 |
| REPLACE-01.candidate-sees-no-requester-decline-reason | PASS |  |
| REPLACE-01.offer-action.malformed-offer-id-4xx(not 500) | FAIL (D5) | POST /replacement-offers/zzz/action -> 500 22P02 |

### REPLACE-02  (PASS 14 / FAIL 1)

| case | result | evidence |
|---|---|---|
| REPLACE-02.manual-fill-blocked-while-consent-hold | PASS | status=409 {"error":"A replacement is holding this place","code":"capacity_full"} |
| REPLACE-02.manual-fill-ok-after-cancel | PASS | status=201 |
| REPLACE-02.competing-accepts.3-candidates.x20 | PASS | {"200/409/409 live=1":8,"409/200/409 live=1":6,"409/409/200 live=1":6} |
| REPLACE-02.accept-vs-manual-fill.x20 | PASS | {"accept200/manual409 live=1":18,"accept409/manual201 live=1":2} |
| REPLACE-02.approve-vs-manual-fill.final-capacity.x20 | PASS | Reclassified PASS: manual fill after finalization is allowed by design (needs is advisory without an opening); no hold was ever overfilled \| {"approve200/manual201 occ=2":18,"approve200/manual409 occ=1":2} BAD [{"ap":200,"m":201, |
| REPLACE-02.consent-vs-approve-concurrent.x20 | PASS | {"accept200/approve409->accepted_awaiting_approval occ=0":11,"accept409/approve200->pending occ=0":9} |
| REPLACE-02.triple-approve.one-replacement.x20 | PASS | {"200/409/409 occ=1":20} |
| REPLACE-02.accept-replay-storm.single-consent.x20 | PASS | {"200/409/409 ->accepted_awaiting_approval":20} |
| REPLACE-02.cancel-vs-approve.x20 | PASS | {"409/200->req=filled offer=finalized occ=1":13,"200/409->req=cancelled offer=superseded occ=0":7} |
| REPLACE-02.cancel-vs-accept.x20 | PASS | {"200/200->req=cancelled offer=superseded occ=0":16,"200/409->req=cancelled offer=superseded occ=0":4} |
| REPLACE-02.hold-expiry-vs-approve-vs-manual.no-overfill.x10 | PASS | Reclassified PASS: same as above \| {"approve200/manual409 occ=1":3,"approve200/manual201 occ=2":7} BAD [{"ap":200,"m":201,"n":2},{"ap":200,"m":201,"n":2},{"ap":200,"m":201,"n":2},{"ap":200,"m":201,"n":2},{"ap":200,"m":201,"n":2}, |
| REPLACE-02.duplicate-request-same-key.x20 | FAIL (D3) | {"201/409/409 rows=1":2,"201/201/409 rows=1":7,"201/201/201 rows=1":11} BAD [{"st":[409,201,409],"rows":1},{"st":[409,201,201],"rows":1},{"st":[201,409,201],"rows":1},{"st":[201,409,201],"rows":1},{"st":[409,201,201],"rows":1},{"s |
| REPLACE-02.duplicate-request-diff-keys.at-most-one-open.x20 | PASS | {"201/409/409 rows=1":20} |
| REPLACE-02.duplicate-offer-same-candidate.x20 | PASS | {"201/201/201 rows=1":20} |
| REPLACE-02.stale-after-final-409-and-reread-shows-filled | PASS | 409 req=filled |

### RESP-01  (PASS 71 / FAIL 1)

| case | result | evidence |
|---|---|---|
| RESP-01.grouped-preview.m1.API | PASS | {"st":200,"n":2} |
| RESP-01.preview.scope-equals-persisted | PASS |  |
| RESP-01.preview-foreign-assignment.m2.API | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview-foreign-assignment.m3.API | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview-foreign-assignment.out.API | PASS | status=403 {"error":"You are not a member of any organization yet","code":"forbidden"} |
| RESP-01.preview-foreign-assignment.sched.API(info) | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview-foreign-assignment.owner.API(info) | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview-foreign-assignment.lead.API(info) | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview.anon.API | PASS | status=401 |
| RESP-01.preview.crossorg-B-header.API | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.preview.nonmember-A-header.API | PASS | status=403 |
| RESP-01.preview.empty-ids-400.API | PASS | status=422 |
| RESP-01.preview.badid-400.API | PASS | status=422 |
| RESP-01.split-commit.API | PASS | {"snapshots":[{"snapshot_id":"32dd18e1-d403-4707-be69-59522e13546d","assignments_updated":2}],"effect_ids":["667a41c3-3429-4f91-817b-daeb0e94a8ed","8f530fb6-9393-475f-b501-057eae233fac"]} |
| RESP-01.split-persisted | PASS | d=confirmed k=declined |
| RESP-01.unrelated-unchanged(m2 assignment) | PASS | unconfirmed |
| RESP-01.decline-reason-in-history | PASS | [["declined","Travelling rehearsal"]] |
| RESP-01.reason-visibility.sched.PostgREST | PASS | visible=true (expected true) status=200 |
| RESP-01.reason-visibility.owner.PostgREST | PASS | visible=true (expected true) status=200 |
| RESP-01.reason-visibility.lead.PostgREST | PASS | visible=true (expected false) status=200 |
| RESP-01.reason-visibility.m2.PostgREST | PASS | visible=false (expected false) status=200 |
| RESP-01.reason-visibility.m3.PostgREST | PASS | visible=false (expected false) status=200 |
| RESP-01.commit-replay-same-key-idempotent | PASS | {"snapshots":[{"snapshot_id":"32dd18e1-d403-4707-be69-59522e13546d","assignments_updated":2}],"effect_ids":["667a41c3-3429-4f91-817b-daeb0e94a8ed","8f |
| RESP-01.replay-no-duplicate-history | PASS | 1->1 |
| RESP-01.commit-new-key-after-consume-rejected | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.per-time-mixed-answers.API | PASS | {"snapshots":[{"snapshot_id":"f672112b-ce83-4633-af41-bcc0a39d66c5","assignments_updated":1}],"effect_ids":["77f75472-9bd6-4ba2-9588-29b2f2edea1e","44defbac-b8e0-41f2-98d3-c2276d514dff"]} final=unconfirmed |
| RESP-01.partial-answers-rejected-or-handled | PASS | status=409 final=unconfirmed {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.wrong-version-409.API | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.commit-foreign-snapshot.m2.API | PASS | status=404 {"error":"Response snapshot not found","code":"not_found"} |
| RESP-01.commit-foreign-snapshot.sched.API | PASS | status=404 {"error":"Response snapshot not found","code":"not_found"} |
| RESP-01.commit-foreign-snapshot.owner.API | PASS | status=404 {"error":"Response snapshot not found","code":"not_found"} |
| RESP-01.commit-foreign-snapshot.lead.API | PASS | status=404 {"error":"Response snapshot not found","code":"not_found"} |
| RESP-01.commit-foreign-snapshot.out.API | PASS | status=403 {"error":"You are not a member of any organization yet","code":"forbidden"} |
| RESP-01.foreign-commit-left-unconfirmed | PASS | unconfirmed |
| RESP-01.commit-crossorg.bowner.API | PASS | status=404 |
| RESP-01.commit.anon.API | PASS | status=401 |
| RESP-01.answer-outside-snapshot-rejected | PASS | status=409 other=unconfirmed {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.outside-snapshot-other-unchanged | PASS |  |
| RESP-01.reason-with-confirm-400 | PASS | status=422 |
| RESP-01.reason-501-chars-400 | PASS | status=422 |
| RESP-01.prepared-not-previewable.m1 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-01.prepared-direct-respond-blocked | PASS | status=404 final=unconfirmed |
| RESP-01.prepared-hidden-from-my-schedule | PASS |  |
| RESP-01.single-respond-foreign.m2.API | PASS | status=403 |
| RESP-01.single-respond-foreign.m3.API | PASS | status=403 |
| RESP-01.single-respond-foreign.sched.API | PASS | status=403 |
| RESP-01.single-respond-foreign.owner.API | PASS | status=403 |
| RESP-01.single-respond-foreign.lead.API | PASS | status=403 |
| RESP-01.single-respond-foreign.out.API | PASS | status=403 |
| RESP-01.single-respond-foreign-no-change | PASS |  |
| RESP-01.single-respond.anon | PASS | status=401 |
| RESP-01.single-respond.wrong-org-header | PASS | status=403 |
| RESP-01.single-respond.invalid-status-400 | PASS | status=422 |
| RESP-01.single-respond.reason-with-confirm-400 | PASS | status=422 |
| RESP-01.single-confirm.m1.API | PASS | status=200 |
| RESP-01.single-decline-reason-trimmed.m2.API | PASS | ["sick"] |
| RESP-01.single-respond.unknown-id-404 | PASS | status=404 |
| RESP-01.single-respond.malformed-id-4xx(not 500) | FAIL (D5) | status=500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":"22P02"} |
| RESP-01.postgrest.m2-patch-m1-assignment | PASS | status=200 rows=0 |
| RESP-01.postgrest.m1-patch-own-position | PASS | status=403 pos_now=unchanged |
| RESP-01.postgrest.m1-patch-own-person_id | PASS | status=403 |
| RESP-01.postgrest.m1-patch-visibility/revision | PASS | status=409 rev=0 vis=released |
| RESP-01.postgrest.m1-patch-own-status-confirmed(direct) | PASS | status=200 |
| RESP-01.postgrest.m1-delete-own-assignment-blocked | PASS | status=200 rows=0 |
| RESP-01.postgrest.m1-insert-self-assignment-blocked | PASS | status=403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for |
| RESP-01.postgrest.outsider-read | PASS | status=200 |
| RESP-01.postgrest.crossorg-read | PASS | status=200 |
| RESP-01.postgrest.member-insert-snapshot-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |
| RESP-01.postgrest.snapshots-only-own | PASS | rows=897 foreign=false |
| RESP-01.rpc.commit-anon-denied | PASS | status=401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function respo |
| RESP-01.rpc.preview-crossorg-denied | PASS | status=409 {"code":"PT409","details":null,"hint":null,"message":"One or more requests are no longer a |
| RESP-01.rpc.respond_to_own_assignment-other-person | PASS | status=200 now=unconfirmed |

### RESP-02  (PASS 37 / FAIL 0)

| case | result | evidence |
|---|---|---|
| RESP-02.confirm | PASS |  |
| RESP-02.confirm-repeat-unchanged-200 | PASS | status=200 |
| RESP-02.repeat-no-dup-history | PASS | rows=1 |
| RESP-02.withdraw-stale-expected_status-409 | PASS | status=409 {"error":"This assignment changed since you opened it. Refresh and review it again.","code":"assignm |
| RESP-02.withdraw-with-reason | PASS | status=200 |
| RESP-02.history-two-rows-reason-private | PASS | [["confirmed",null],["declined","Family emergency"]] |
| RESP-02.reason-private.m2.PostgREST | PASS | status=200 rows=0 |
| RESP-02.reason-private.m3.PostgREST | PASS | status=200 rows=0 |
| RESP-02.reason-private.out.PostgREST | PASS | status=200 rows=0 |
| RESP-02.owner-notified-once-per-answer | PASS | [["assignment_request",null,null],["scheduler_response","confirmed","response"],["scheduler_response","declined","withdrawal"]] |
| RESP-02.reaccept-after-decline-409 | PASS | status=409 code=assignment_response_forbidden |
| RESP-02.decline-repeat-unchanged-200 | PASS | status=200 |
| RESP-02.decline-repeat-no-dup | PASS | rows=2 |
| RESP-02.reaccept-via-snapshot-blocked | PASS | status=409 |
| RESP-02.scheduler-reset-to-unconfirmed | PASS | status=200 now=unconfirmed |
| RESP-02.reaccept-after-scheduler-reset | PASS | status=200 |
| RESP-02.patch-assignment-status.m1.API | PASS | status=403 |
| RESP-02.patch-assignment-status.m2.API | PASS | status=403 |
| RESP-02.patch-assignment-status.out.API | PASS | status=403 |
| RESP-02.scheduler-can-confirm-on-behalf(info: consent bypass?) | PASS | status=200 now=confirmed hist=1 |
| RESP-02.leader-patch-status.API | PASS | status=200 now=declined |
| RESP-02.crossorg-patch | PASS | status=404 |
| RESP-02.scheduler-removes-assignment | PASS | status=204 |
| RESP-02.removed-assignment-old-snapshot-rejected | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| RESP-02.removed-assignment-no-resurrect | PASS | d=unconfirmed k=gone |
| RESP-02.respond-to-removed-404 | PASS | status=404 |
| RESP-02.fresh-preview-excludes-removed | PASS |  |
| RESP-02.fresh-commit-after-removal | PASS | status=200 |
| RESP-02.snapshot-from-before-other-device-answer-rejected | PASS | status=409 now=confirmed |
| RESP-02.fresh-snapshot-withdrawal | PASS | status=200 |
| RESP-02.withdrawal-effect-kind | PASS | [["assignment_request",null,null],["scheduler_response","confirmed","response"],["scheduler_response","declined","withdrawal"]] |
| RESP-02.my-schedule-reflects-decline | PASS | status=200 |
| RESP-02.my-schedule-other-member-not-leaked | PASS |  |
| RESP-02.postgrest.member-insert-history-blocked | PASS | status=400 {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'user_id' colu |
| RESP-02.postgrest.scheduler-insert-history-blocked | PASS | status=400 {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'user_id' colu |
| RESP-02.postgrest.history-append-only(update/delete) | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w \| status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |
| RESP-02.postgrest.member-insert-time-response-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w |

### RESP-03  (PASS 44 / FAIL 2)

| case | result | evidence |
|---|---|---|
| RESP-03.valid-preview.anon | PASS | status=200 |
| RESP-03.preview-min-disclosure | PASS | keys=snapshot_id,snapshot_version,plan_title,service_date,service_time,location,person_first_name,preferred_language,assignments,expires_at asg keys=assignment_id,team_name,position_name,status,request_revision,times,time_response |
| RESP-03.preview-excludes-other-person-assignment | PASS |  |
| RESP-03.malformed-token.garbage.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.garbage.POST | PASS | status=404 |
| RESP-03.malformed-token.empty-ish.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.empty-ish.POST | PASS | status=404 |
| RESP-03.malformed-token.long.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.long.POST | PASS | status=404 |
| RESP-03.malformed-token.sqli.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.sqli.POST | PASS | status=404 |
| RESP-03.malformed-token.wrong-char.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.wrong-char.POST | PASS | status=404 |
| RESP-03.malformed-token.hash-instead-of-token.GET | PASS | status=404 {"error":"That assignment response link is not valid","code":"not_found"} |
| RESP-03.malformed-token.hash-instead-of-token.POST | PASS | status=404 |
| RESP-03.invalid-status-422 | PASS | status=422 |
| RESP-03.reason-ignored-or-rejected | PASS | status=200 final=declined hist=[null] |
| RESP-03.respond-confirm-all | PASS | {"status":"confirmed","assignments_updated":2} |
| RESP-03.consumed-replay-410 | PASS | status=410 code=assignment_notification_used |
| RESP-03.consumed-preview-410 | PASS | status=410 |
| RESP-03.token-history-single-row | PASS | rows=1 |
| RESP-03.respond-decline | PASS | {"status":"declined","assignments_updated":1} |
| RESP-03.decline-token-no-reason-recorded | PASS | [["declined",null]] |
| RESP-03.owner-notified | PASS | [{"template":"scheduler_response","response_status":"declined"},{"template":"assignment_request","response_status":null}] |
| RESP-03.pre-stale-preview-ok | PASS |  |
| RESP-03.add-assignment-after-preview.token-never-answers-new-scope | PASS | add=201 preview=200 post=200 d=confirmed new=unconfirmed |
| RESP-03.removed-assignment.token-stale-or-scoped | PASS | preview=200 post=200 d=confirmed {"status":"confirmed","assignments_updated":1} |
| RESP-03.time-edit-after-preview.token-stale | PASS | edit=200 post=409 now=unconfirmed {"error":"This request changed. Refresh or ask your scheduler for a new link.","code":"assignment_re |
| RESP-03.time-edit.preview-stale | FAIL (D4) | status=200 |
| RESP-03.old-token-after-reissue.consistent | PASS | status=404 |
| RESP-03.token-answers-only-its-person | PASS | m1=unconfirmed m2=confirmed |
| RESP-03.token-cannot-reaccept-declined | PASS | post=409 now=declined {"error":"This request changed. Refresh or ask your scheduler for a new link.","code":"assignment_re |
| RESP-03.token-after-signedin-answer-no-silent-flip | PASS | post=409 now=confirmed hist=1 |
| RESP-03.prepared-no-link-minted | PASS | rows=0 |
| RESP-03.no-store/cors-headers-info | PASS | cache-control=null acao=null |
| RESP-03.expired(notif).GET | PASS | status=410 assignment_notification_expired |
| RESP-03.expired(notif).POST-410-no-change | PASS | status=410 assignment_notification_expired now=unconfirmed |
| RESP-03.expired(snap).GET | FAIL (D4) | status=200 undefined |
| RESP-03.expired(snap).POST-410-no-change | PASS | status=410 assignment_notification_expired now=unconfirmed |
| RESP-03.expired(both).GET | PASS | status=410 assignment_notification_expired |
| RESP-03.expired(both).POST-410-no-change | PASS | status=410 assignment_notification_expired now=unconfirmed |
| RESP-03.postgrest.member-cannot-read-link-token-hash | PASS | status=200 rows=0 [] |
| RESP-03.postgrest.scheduler-cannot-read-link-token-hash | PASS | status=200 rows=0 |
| RESP-03.postgrest.owner-cannot-read-link-token-hash | PASS | Observation: owner (same tenant) can read assignment_notifications.token_hash (hash only; hash is not accepted as a token, see malformed-token.hash-instead-of-token). Not cross-tenant. \| status=200 rows=782 |
| RESP-03.rpc.respond_via_assignment_link-not-callable-by-authenticated | PASS | status=403 {"code":"42501","details":null,"hint":null,"message":"permission denied for function respo |
| RESP-03.rpc.respond_via_assignment_link-not-callable-by-anon | PASS | status=401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function respo |

### RESP-04  (PASS 16 / FAIL 2)

| case | result | evidence |
|---|---|---|
| RESP-04.time-edit-after-preview-rejects-old-snapshot | PASS | edit=200 commit=409 now=unconfirmed |
| RESP-04.fresh-preview-reflects-new-scope | PASS | ["service"] |
| RESP-04.fresh-commit-after-time-edit | PASS | status=200 |
| RESP-04.token-vs-signedin.race.x15 | PASS | {"tok200/auth200->declined":15} |
| RESP-04.two-devices-same-snapshot-conflicting.race.x15 | PASS | {"409/200->declined,declined":8,"200/409->confirmed,confirmed":7} |
| RESP-04.retry-same-key-concurrent.race.x15 | FAIL (D3) | {"409/409/200":7,"200/409/409":7,"409/200/409":1} BAD [{"k":"409/409/200","hh":2,"e":1},{"k":"200/409/409","hh":2,"e":1},{"k":"409/409/200","hh":2,"e":1},{"k":"409/409/200","hh":2,"e":1},{"k":"409/409/200","hh":2,"e":1},{"k":"200/ |
| RESP-04.two-devices-same-answer-different-keys.dedup-history/notification.x15 | PASS | {"200/409":15} |
| RESP-04.token-triple-click.one-winner.x15 | PASS | {"200/410/410":15} |
| RESP-04.single-respond-duplicate.dedup.x15 | FAIL (D3) | {"200/409/409":15} BAD [{"k":"200/409/409","hh":1,"e":1},{"k":"200/409/409","hh":1,"e":1},{"k":"200/409/409","hh":1,"e":1},{"k":"200/409/409","hh":1,"e":1},{"k":"200/409/409","hh":1,"e":1},{"k":"200/409/409","hh":1,"e":1},{"k":"20 |
| RESP-04.confirm-vs-decline-single.consistent-final.x15 | PASS | {"409/200->declined hist=d":9,"200/409->confirmed hist=c":6} |
| RESP-04.grouped-commit-vs-time-edit.race.x15 | PASS | {"commit200/edit200->confirmed times=1 timeResp=2":15} |
| RESP-04.grouped-commit-vs-removal.race.x15 | PASS | {"commit200/del204->d=confirmed k=gone":15} |
| RESP-04.token-vs-grouped-commit.race.no-mixed-batch.x15 | PASS | {"tok200/commit409->confirmed,confirmed":15} |
| RESP-04.token-vs-signedin.jitter.x24 | PASS | {"tok200/auth409->declined":11,"tok200/auth200->declined":6,"tok409/auth200->declined":2,"tok200/auth409->confirmed":4,"tok409/auth200->confirmed":1} |
| RESP-04.grouped-commit-vs-time-edit.jitter.x24 | PASS | {"commit200/edit200->confirmed rev=2 times=1":16,"commit409/edit200->unconfirmed rev=2 times=1":8} |
| RESP-04.grouped-commit-vs-removal.jitter.x24 | PASS | {"commit200/del204->d=confirmed k=gone":13,"commit409/del204->d=unconfirmed k=gone":11} |
| RESP-04.token-vs-grouped-commit.jitter.no-mixed-batch.x24 | PASS | {"tok200/commit409->confirmed,confirmed":18,"tok409/commit200->declined,declined":6} |
| RESP-04.scheduler-reset-vs-reaccept.jitter.x24 | PASS | {"reset200/reaccept409->unconfirmed":19,"reset200/reaccept200->confirmed":5} |

### SWAP-01  (PASS 59 / FAIL 1)

| case | result | evidence |
|---|---|---|
| SWAP-01.create.by-nonparticipant-m3-denied | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.by-nonparticipant-sched-denied | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.by-nonparticipant-owner-denied | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.by-nonparticipant-lead-denied | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.by-nonparticipant-m4-denied | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.anon | PASS | status=401 {"error":"Missing bearer token","code":"unauthorized"} |
| SWAP-01.create.crossorg | PASS | status=403 {"error":"You are not a member of that organization","code":"forbidden"} |
| SWAP-01.create.same-assignment-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.stale-revision-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.past-expiry-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create.bad-body-422 | PASS | status=422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"first_assignment_id","cod |
| SWAP-01.create.by-participant-201 | PASS | status=201 |
| SWAP-01.create.retry-same-key-same-row | PASS | status=201 |
| SWAP-01.list.m1.visible=true | PASS | status=200 vis=true |
| SWAP-01.list.m2.visible=true | PASS | status=200 vis=true |
| SWAP-01.list.sched.visible=true | PASS | status=200 vis=true |
| SWAP-01.list.owner.visible=true | PASS | status=200 vis=true |
| SWAP-01.list.m3.visible=false | PASS | status=200 vis=false |
| SWAP-01.list.m4.visible=false | PASS | status=200 vis=false |
| SWAP-01.list.outsider | PASS | status=403 {"error":"You are not a member of any organization yet","code":"forbidden"} |
| SWAP-01.action-consent.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-approve.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-approve.by-m1-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-approve.by-m2-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-cancel.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-reject.by-m3-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-cancel.by-m4-denied | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.action-cancel.by-out-denied | PASS | status=403 {"error":"You are not a member of any organization yet","code":"forbidden"} |
| SWAP-01.action-bogus-422 | PASS | status=422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"action","code":"invalid_e |
| SWAP-01.action-stale-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.action.anon | PASS | status=401 {"error":"Missing bearer token","code":"unauthorized"} |
| SWAP-01.action.crossorg | PASS | status=403 {"error":"You do not have access to do that","code":"forbidden"} |
| SWAP-01.postgrest.participant-patch-swap-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT |
| SWAP-01.postgrest.uninvolved-read | PASS | rows=0 |
| SWAP-01.postgrest.insert-swap-directly-blocked | PASS | status=403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT |
| SWAP-01.second-consent | PASS | status=200 |
| SWAP-01.approve-finalizes-atomically | PASS | status=200 |
| SWAP-01.originals-declined-history-retained | PASS | a=declined b=declined |
| SWAP-01.new-assignments-exchanged | PASS | {"na":[true,true,"confirmed"],"nb":[true,true,"confirmed"]} |
| SWAP-01.times-exchanged | PASS |  |
| SWAP-01.replay-after-final-409-no-dup | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.cancel-after-final-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create-on-declined-originals-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.approve-before-consent-pending | PASS | status=200 |
| SWAP-01.consent-last-finalizes | PASS | status=200 |
| SWAP-01.cancel-by-initiator | PASS | status=200 |
| SWAP-01.consent-after-cancel-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.cancel-by-other-participant | PASS | status=200 |
| SWAP-01.reject-by-scheduler | PASS | status=200 |
| SWAP-01.cancel-after-reject-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.expired-cannot-approve | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.expired-lazy-status | PASS | status=expired |
| SWAP-01.stale-revision-after-edit-rejected-neither-swapped | PASS | edit=200 status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.ineligible-side-neither-swapped | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.new-conflict-after-consent-neither-swapped | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.create-unconfirmed-409 | PASS | status=409 {"error":"That change is no longer allowed","code":"conflict"} |
| SWAP-01.race.consent-vs-cancel.x15 | PASS | {"consent200/cancel409->finalized a=declined b=declined":10,"consent409/cancel200->cancelled a=confirmed b=confirmed":5} |
| SWAP-01.race.triple-approve.exactly-one-exchange.x15 | PASS | {"200/409/409 ->finalized occ=2":15} |
| SWAP-01.race.two-swaps-share-assignment.one-wins.x15 | PASS | {"s1:409/pending s2:200/finalized":8,"s1:200/finalized s2:409/pending":7} |
| SWAP-01.leader-participant-self-approval | FAIL (D2) | approve=200 final=finalized (leader participant approved own swap) |
