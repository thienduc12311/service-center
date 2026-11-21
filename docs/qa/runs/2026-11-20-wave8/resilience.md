# W8-RES resilience / fault injection (RES-01, part of QA-15) - wave 8 (2026-11-20)

Package W8-RES from `docs/plans/admin-mobile-test-plan.md` (section 7 row RES-01, section 8 retry/idempotency invariants). Owned features: plan create/edit/times/items, assignments + respond (incl. idempotency keys), chat send (client message id), notes, file upload (signed upload / finalize / abandon), attendance batch, release, matrix commit, imports.

- Commit: `897e524` (main + wave 7 fixes), branch `feature/qa-wave8`. No code, migration, config or git state changed; nothing committed.
- Env: local Supabase (shared DB), Node 26.13.1. Faults were injected only in a **private** stack; the shared API on :4000 was never faulted. The shared API (:4000) and my private API (:4601) both received a SIGTERM during the run (coordinator notice); I did not send it. My API, matrix run and proxy were restarted and the affected cases re-run from scratch (results below are from the clean re-run only).
- Namespace: orgs `qa-w8-res-a` (Alpha, America/Chicago, `ea175a7d-4c64-4c99-af8d-067d68ce6c8a`) and `qa-w8-res-b` (Beta, Asia/Ho_Chi_Minh, `2c169460-6b9b-48ef-88a2-12a5ac250a2b`); users `<alias>.qaw8.res@example.test`. Passwords only in the session scratchpad (`.../scratchpad/res/creds.json`, mode 600).
- Fixture shape. Alpha: Sunday service type, team Band (Acoustic, Bass, Drums) with `sched`, `member`, `pending` on the team roster; aliases `owner` (owner), `sched` (legacy scheduler, org-wide operational access), `member` (ordinary member: denied for plan edit / scheduling / songs.manage), `pending` (member, assignee for response cases). Beta: `bowner`, `bmember`, a Sunday type and one plan. Setup (users, orgs via `private.create_church`, memberships) was service role / SQL; every feature call and every denial probe used the actor's own bearer token against the API. Each case created its own plan (`rs-<kind>-<id>`, dates from 2030-01-01 in unique 3-hour slots so Person overlap never interferes).
- Injection harness (all in scratchpad, not in the repo):
  1. A private API instance `PORT=4601 SUPABASE_URL=http://127.0.0.1:54401` (empty RESEND/EXPO keys, `NODE_ENV=development`; one extra instance on :4611 with `NODE_ENV=production` to confirm leak behaviour).
  2. `proxy.mjs` fault proxy on :54401 forwarding to real Supabase :54321 (REST, RPC, Auth, Storage all pass through). Rules (regex on `METHOD path`, skip N, apply count) can: answer a chosen status/body without forwarding (4xx, 5xx, HTML 502 from Kong), reset the TCP connection, delay the request, delay the reply, or **drop the reply after forwarding** (lost success reply: Postgres commits, API never sees the response).
  3. A second instance of the same proxy on :4612 in front of the private API :4601 with the drop-after-forward rule: the API commits and answers, the client never sees the reply (client-side lost reply). Rule scope was always one call (count 1) aimed at the committing upstream call (RPC name or table), e.g. `^POST /rest/v1/rpc/create_plan`, `^PATCH /rest/v1/plans`, `^PUT /storage/v1/object/upload/sign`.
  4. Matrix runner: for every operation x fault it prepares fresh data, injects, calls with the allowed actor, reads persisted rows by SQL (and side effects: `delivery_effects`, history, batches), removes the fault, retries the **same request/key** and re-reads. Denied actors (ordinary member, other-org member) were run once per operation with the commit call faulted. Fault set: upstream 400/401/403/404/500/502(HTML)/503/504, connection reset, lost reply at Supabase, lost reply at the client, 7 s timeout with client abort, plus operation-specific faults (post-commit read, delivery kick, Storage signing/upload).
- Assertion standard per case: (a) mapped status is a sensible one (401 for expired JWT, 403/404 for denial, 502/503/504 for infrastructure failure) and the body contains no Postgres/PostgREST/Kong/network detail, (b) persisted state is all-or-nothing (no half write on error; exactly once after a lost reply), (c) the same-key retry or a reread converges with no duplicate rows, history or effects.
- Source vs plan (recorded, not counted as defects): (1) the plan says "correct status code" for upstream failure but there is no written contract; I used 502/503/504. (2) Optimistic-concurrency retries (item edit/reorder/delete, note update/delete, import commit with `expected_revision`) legitimately answer 409 / 404 after a lost reply; treated as the documented contract ("reread resolves the ambiguous result"), the reread shows the applied change. (3) `finalize` answers 200 with `outcome: not_uploaded` / `failed` rather than an HTTP error, by design. (4) postgrest-js transparently retries failed GETs (reset and 503 on a GET were absorbed; 500/502 were not), so some read faults produced a 200.

## Result summary

| Status | Count |
|---|---|
| PASS | 114 |
| FAIL | 249 |
| BLOCKED | 0 |
| NOT_APPLICABLE | 5 |
| NOT_RUN | see "Not run / blocked" (groups, not counted here) |

Total executed expanded cases: 368. A case is PASS only when every applicable assertion holds (mapped status, no engine/infrastructure detail in the body, persisted state, same-key retry or reread). Cases carrying each defect: W8-RES-D1: 234, W8-RES-D2: 8, W8-RES-D3: 4, W8-RES-D4: 5, W8-RES-D5: 1, W8-RES-D6: 1, W8-RES-D7: 1 (a case can carry two).

Per-group counts:

| Group | PASS | FAIL | N/A | BLOCKED |
|---|---|---|---|---|
| PLAN-CREATE | 6 | 11 | 0 | 0 |
| PLAN-DUPLICATE | 4 | 9 | 0 | 0 |
| PLAN-EDIT | 4 | 9 | 0 | 0 |
| PLAN-TIMES | 4 | 9 | 0 | 0 |
| PLAN-EDIT-TIMES-FIELDS | 1 | 5 | 0 | 0 |
| ITEM-ADD | 5 | 9 | 0 | 0 |
| ITEM-EDIT | 4 | 9 | 0 | 0 |
| ITEM-REORDER | 4 | 9 | 0 | 0 |
| ITEM-DELETE | 4 | 9 | 0 | 0 |
| ASSIGN-SCHEDULE | 7 | 10 | 0 | 0 |
| RESPOND-SELF | 3 | 9 | 1 | 0 |
| RESPOND-SNAPSHOT | 3 | 9 | 1 | 0 |
| CHAT-SEND | 6 | 10 | 0 | 0 |
| NOTE-CREATE | 2 | 12 | 1 | 0 |
| NOTE-UPDATE | 4 | 9 | 0 | 0 |
| NOTE-DELETE | 4 | 9 | 0 | 0 |
| FILE | 1 | 0 | 0 | 0 |
| FILE-INTENT | 8 | 10 | 1 | 0 |
| FILE-UPLOAD | 5 | 0 | 0 | 0 |
| FILE-FINALIZE | 3 | 9 | 0 | 0 |
| FILE-ABANDON | 1 | 4 | 0 | 0 |
| ATTEND-RECORD | 4 | 9 | 0 | 0 |
| ATTEND-TIMES | 4 | 9 | 0 | 0 |
| RELEASE | 7 | 9 | 0 | 0 |
| MATRIX-COMMIT | 4 | 9 | 0 | 0 |
| IMPORT-SAVE | 4 | 9 | 0 | 0 |
| IMPORT-COMMIT | 3 | 9 | 1 | 0 |
| MIDDLEWARE | 4 | 21 | 0 | 0 |
| SLOW | 1 | 1 | 0 | 0 |
| PROD-MODE | 0 | 3 | 0 | 0 |

## Verified resilient behaviour (no defect)

- **No half-written or lost state under any injected failure for the owned write paths** (all 21 operations x 12 faults): every committing step is a single database RPC (create_plan, duplicate_plan, apply_plan_time_changes, add_plan_item, update/reorder/delete_plan_item, schedule_plan_assignments, respond_as_self, respond_to_assignment_snapshots, post_conversation_message, save_plan_note, record_attendance, set_assignment_attendance, create_release_batch, commit_staffing_matrix, save/commit_structured_import, file intent/finalize/abandon). A pre-commit failure left 0 new rows; a lost reply (Supabase side, API side, or timeout/client abort) left exactly the full committed outcome (e.g. 2 attendance records + 1 batch + 2 events, 1 release batch + 1 effect, 1 staffing commit, 2 snapshot time answers + 1 history row).
- **Same-key retries converge once**: plan create/duplicate, item add (200 replay), schedule assignments (one `delivery_effects` row for `assignments:<plan>:<key>`), snapshot respond, chat send by client message id (200 replay, one row, one effect), attendance batch, assignment-times batch, release, matrix commit, import save, file upload intent (replay re-signs a usable upload), finalize (`replayed: true`, one ready version).
- **Revision-guarded edits** answer 409 `plan_revision_stale` / `note_stale` to a stale retry after a lost reply and the reread shows the applied change (documented contract).
- **Commit then post-commit failure** (response read fails after the commit) and **in-request delivery kick failure** (`claim_deliveries` faulted): the action still answers 2xx (kick) or, for a failed post-commit read, 5xx with the row persisted and the same-key retry converging; effects stay `queued` (3 deliveries for a scheduled request, 2 for a chat message) for the worker, not lost.
- Storage faults: a failed signed-URL request is a clean 503 `storage_unavailable` (authored message), leaves one pending intent, and the same-key replay returns a usable upload target; a failed or lost object upload is reflected truthfully by finalize (`not_uploaded` / `ready`); a short object gives `failed/size_mismatch`, never `ready`.
- Cross-tenant: a Beta member under a faulted commit still got 404 (never a write, never data); a Beta owner reusing an Alpha owner's idempotency key created a Beta plan and did not touch or read Alpha's.

## Defects

### W8-RES-D1 (P1): infrastructure and unexpected upstream failures become `500` with the raw Postgres/PostgREST/Kong/network message (also in production)

- Repro: with a fault proxy in front of Supabase (or a real PostgREST outage), `PATCH /api/v1/plans/:id {"title":"x"}` while PostgREST answers one of: 500 `{"code":"XX000","message":"internal error relation \"private.secret\" ..."}`, 502 HTML from Kong, 503 `{"code":"PGRST000","message":"Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused"}`, 401 `PGRST301 JWT expired`, 404 `PGRST202 ... schema cache`, or the TCP connection resets.
- Expected: 502/503/504 (401 for an expired JWT) with a generic message and a stable code; engine/host/network text only in server logs.
- Actual: `500 {"error":"internal error relation \"private.secret\" at character 12","code":"XX000"}`, `500 {"error":"<html><body>502 Bad Gateway (kong)</body></html>"}`, `500 PGRST000 "... connection to 10.0.0.5 port 5432 ..."`, `500 "TypeError: fetch failed"`, `500 PGRST301 "JWT expired"`. Confirmed on an instance started with `NODE_ENV=production` (the HttpError path never consults the environment). Same on every route in all 21 operations, on the org-context middleware (`rpc/my_org_context`) and Storage-adjacent calls. A JWT that expires between `getUser` and the PostgREST call surfaces as a 500, not a 401, so clients do not refresh.
- Impact: infrastructure topology / schema names disclosed to any caller during an outage; wrong status prevents client retry/backoff and refresh logic.
- Suspected source: `backend/src/lib/errors.ts:179-180` (`default: return new HttpError(500, error.message, error.code)` forwards the upstream message and code verbatim), `backend/src/middleware/error-handler.ts:54` (echoes `err.message` for every HttpError regardless of `NODE_ENV`); `fetch failed` arrives as a PostgREST-shaped error with empty code and takes the same branch.
- Cases: all FAIL rows tagged D1.

### W8-RES-D2 (P1): an Auth-service outage is reported as `401 Invalid or expired session`

- Repro: `GET /api/v1/plans` with any valid token while `GET /auth/v1/user` (GoTrue) answers 500, 502, 503 or resets. Next request after the fault clears: 200.
- Expected: 502/503 so clients keep the session and retry. Actual: `401 {"error":"Invalid or expired session","code":"unauthorized"}`; web and mobile treat 401 as "sign the user out".
- Suspected source: `backend/src/middleware/auth.ts:37` (`if (error || !data.user)` treats every error, including transport/5xx, as an invalid session; `error.status` / `AuthRetryableFetchError` is not distinguished).
- Cases: MIDDLEWARE.auth.getUser.* (8 FAIL; the 401 case passes).

### W8-RES-D3 (P2): note create has no idempotency identity - a lost reply plus retry creates a duplicate note

- Repro: `POST /api/v1/plans/:id/notes {"audience":"organization","body":"n"}`; client never sees the 201 (drop-after at API, drop at Supabase, or timeout/abort); repeat the identical request. Expected: one note (or a 409/200 replay), as for chat (`id`), items and comments. Actual: two notes with the same body (`SELECT count(*) FROM plan_notes WHERE plan_id=... AND body=...` = 2) in lostSb, lostApi, timeout, and post-commit-read cases.
- Suspected source: `backend/src/routes/collaboration.ts:100-103` (create forces `expected_revision: undefined`), `packages/shared/src/schemas/collaboration.ts:10-23` (no key), `save_plan_note` (supabase/migrations/20261026000000_f09_notes_and_item_comments.sql).
- Cases: NOTE-CREATE.lostSb, lostApi, timeout, post-commit-read.up500.

### W8-RES-D4 (P2): `PATCH /plans/:id` with `times` and other fields is two independent upstream writes - a failure between them leaves a partial edit

- Repro: `PATCH /api/v1/plans/:id {"title":"T","times":[...changed name...]}`; the second write (`PATCH /rest/v1/plans`) fails (500 or reset). Expected: all-or-nothing (neither title nor times) or a documented partial result. Actual: error response, but the times change **is persisted** and the title is not. A retry without `expected_revision` completes it; a retry carrying the `expected_revision` the editor loaded (what the web editor sends) gets `409 plan_revision_stale`, so the title edit must be redone by hand after a reread. The wave 7 follow-up (service_date second write) was fixed by a trigger; this field write remains separate.
- Suspected source: `backend/src/routes/plans.ts:176-203` (`applyPlanTimes` RPC then `.update(planFields)`); fix by moving the field patch into `apply_plan_time_changes`.
- Cases: PLAN-EDIT-TIMES-FIELDS.up500 / reset (both variants).

### W8-RES-D5 (P2): `POST /plans` replays by idempotency key without checking the payload

- Repro: `POST /api/v1/plans {title:"A", ..., idempotency_key:K}` then the same key with `title:"A-other"`. Expected: 409 `idempotency_key_reused` (as `POST /plans/:id/items` answers: "That idempotency key was used for a different item"). Actual: second call `201` returning the first plan "A"; no "A-other" plan exists, so a client reusing a key believes its different plan was created.
- Suspected source: `public.create_plan` / `plan_copy_operations` lookup keyed only by `(organization_id, idempotency_key)` (supabase/migrations/20261016000200_delivery_outbox_and_atomic_copy.sql ~lines 809-830, later re-definitions in 20261020000100_f04_assigned_times.sql). Other keyed operations were not exhaustively checked for the same pattern (see Not run).

### W8-RES-D6 (P2): the API has no bound on a slow upstream

- Repro: delay `GET /rest/v1/plans` by 35 s, call `GET /api/v1/plans`. Expected: 504/502 within a bounded time (about 30 s or less). Actual: `200` after 35 031 ms; supabase-js clients are created without a fetch timeout, so a hung PostgREST holds the request (and for writes, the commit may still land after the client gave up, see the timeout cases: all persisted exactly once). A concurrent unfaulted request was served in 23 ms (event loop fine).
- Suspected source: `backend/src/lib/supabase.ts:27-40` (`createClient` without `global.fetch` timeout/AbortSignal).

### W8-RES-D7 (P2): upload-intent replay whose signed URL cannot be created answers 200 with `upload: null`

- Repro: `POST /files/upload-intents` with key K while Storage signing fails (500): first call 503 `storage_unavailable` (correct), intent left pending. Repeat with K while signing still fails: `200 {"replayed":true,"upload":null}`. Expected: 503 again (or a usable target); the object is absent, so the client has nothing to upload to and no error.
- Suspected source: `backend/src/services/files.ts:274` (`else if (!result.replayed)` only throws for a fresh intent; the replay branch is assumed to mean "bytes already stored" without checking).

### Observations (not counted as defects)

- Retry of `abandon` after a lost reply answers 404 `File not found` once the new file was removed by the first call (state is correct).
- `finalize` answers 200 with an outcome, so a client must read `outcome`; a lost finalize reply is safely repeatable (`replayed: true`).
- PLAN-TIMES retries without `expected_revision` re-apply the time list; `applyPlanTimes` generates a fresh `effectKey` per call (`plans.ts:176+`), so a repeated time change on a plan with released confirmed requests could queue a second notification effect. Not exercised (no confirmed released requests on those plans): NOT_RUN.


## Result tables

Fault key: `up4xx`/`up5xx` = PostgREST/Kong/Auth answered that status without reaching Postgres; `reset` = TCP reset; `lostSb` = Supabase committed, reply dropped before the API saw it; `lostApi` = API committed and answered, reply dropped before the client; `timeout` = upstream delayed 7 s, client aborted at 2 s, rows read after the delay elapsed; `post-commit-read` = fault on a read the route performs after the commit; `delivery-kick` = `claim_deliveries` fails during the in-request delivery kick; `denied+up500` = non-privileged actor with the commit call faulted.


### PLAN-CREATE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PLAN-CREATE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| PLAN-CREATE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (times=0); retry 201 rows 1 (times=1) | PASS |
| PLAN-CREATE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (times=0); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1 (times=1); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1 (times=1); retry 201 rows 1 (times=1) | PASS |
| PLAN-CREATE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1 (times=1); retry 201 rows 1 (times=1) | PASS |
| PLAN-CREATE.post-commit-read.up500 | owner | API+upstream | up500 on fetchPlanDetail after create_plan | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->1 (times=1); retry 201 rows 1 (times=1) | FAIL (D1) |
| PLAN-CREATE.post-commit-read.reset | owner | API+upstream | reset on fetchPlanDetail after create_plan | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 201 (GET transparently retried by the client library; request succeeded); rows 0->1 (times=1); retry 201 rows 1 (times=1) | PASS |
| PLAN-CREATE.same-key-different-body | owner | API | none (retry with different body) | 409 idempotency_key_reused, no second plan | first 201; second 201; second call silently returned the FIRST plan (only 1 plan persisted, no "-other" plan) | FAIL (D5) |
| PLAN-CREATE.cross-tenant-key-reuse | bowner | API | none (other org reuses key) | creates Beta plan, does not return or touch Alpha plan | 201 orgOfPlan=B | PASS |

### PLAN-DUPLICATE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PLAN-DUPLICATE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| PLAN-DUPLICATE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 201 rows 1 | PASS |
| PLAN-DUPLICATE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 201 rows 1 | FAIL (D1) |
| PLAN-DUPLICATE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 201 rows 1 | PASS |
| PLAN-DUPLICATE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 201 rows 1 | PASS |

### PLAN-EDIT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PLAN-EDIT.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| PLAN-EDIT.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| PLAN-EDIT.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 200 rows 1 | FAIL (D1) |
| PLAN-EDIT.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 200 rows 1 | PASS |
| PLAN-EDIT.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 200 rows 1 | PASS |

### PLAN-TIMES

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PLAN-TIMES.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| PLAN-TIMES.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| PLAN-TIMES.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 200 rows 1 | FAIL (D1) |
| PLAN-TIMES.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 200 rows 1 | PASS |
| PLAN-TIMES.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 200 rows 1 | PASS |

### PLAN-EDIT-TIMES-FIELDS

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PLAN-EDIT-TIMES-FIELDS.up500.no_expected_revision | owner | API+upstream | up500 on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 XX000 "internal error relation "private.secret" at character 12"; after fault times=1 title=0 (PARTIAL: times committed, title lost); retry 200 -> times=1 title=1 | FAIL (D1,D4) |
| PLAN-EDIT-TIMES-FIELDS.reset.no_expected_revision | owner | API+upstream | reset on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 "TypeError: fetch failed"; after fault times=1 title=0 (PARTIAL: times committed, title lost); retry 200 -> times=1 title=1 | FAIL (D1,D4) |
| PLAN-EDIT-TIMES-FIELDS.lostSb.no_expected_revision | owner | API+upstream | lostSb on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 "TypeError: fetch failed"; after fault times=1 title=1; retry 200 -> times=1 title=1 | PASS |
| PLAN-EDIT-TIMES-FIELDS.up500.with_expected_revision | owner | API+upstream | up500 on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 XX000 "internal error relation "private.secret" at character 12"; after fault times=1 title=0 (PARTIAL: times committed, title lost); retry 409 plan_revision_stale "The plan changed since you opened it" -> times=1 title=0 | FAIL (D1,D4) |
| PLAN-EDIT-TIMES-FIELDS.reset.with_expected_revision | owner | API+upstream | reset on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 "TypeError: fetch failed"; after fault times=1 title=0 (PARTIAL: times committed, title lost); retry 409 plan_revision_stale "The plan changed since you opened it" -> times=1 title=0 | FAIL (D1,D4) |
| PLAN-EDIT-TIMES-FIELDS.lostSb.with_expected_revision | owner | API+upstream | lostSb on fields write | all-or-nothing: either both times and title persisted or neither when the response is an error; same-body retry converges | resp 500 "TypeError: fetch failed"; after fault times=1 title=1; retry 409 plan_revision_stale "The plan changed since you opened it" -> times=1 title=1 | FAIL (D1,D4) |

### ITEM-ADD

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ITEM-ADD.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| ITEM-ADD.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 201 rows 1 | PASS |
| ITEM-ADD.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| ITEM-ADD.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 200 rows 1 | FAIL (D1) |
| ITEM-ADD.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 200 rows 1 | PASS |
| ITEM-ADD.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 200 rows 1 | PASS |
| ITEM-ADD.same-key-different-body | owner | API | none (retry with different body) | 409 idempotency_key_reused | first 201; second 409 idempotency_key_reused "That idempotency key was used for a different item" | PASS |

### ITEM-EDIT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ITEM-EDIT.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| ITEM-EDIT.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| ITEM-EDIT.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-EDIT.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | FAIL (D1) |
| ITEM-EDIT.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | PASS |
| ITEM-EDIT.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | PASS |

### ITEM-REORDER

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ITEM-REORDER.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| ITEM-REORDER.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| ITEM-REORDER.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ITEM-REORDER.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | FAIL (D1) |
| ITEM-REORDER.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | PASS |
| ITEM-REORDER.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 1 | PASS |

### ITEM-DELETE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ITEM-DELETE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 1->1 | PASS |
| ITEM-DELETE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (1), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (1), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (1), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 1->1; retry 204  rows 0 | PASS |
| ITEM-DELETE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (1), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (1), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (1), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| ITEM-DELETE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 1->0; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 0 | FAIL (D1) |
| ITEM-DELETE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 1->0; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 0 | PASS |
| ITEM-DELETE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 0 This operation was aborted; rows 1->0; retry 409 plan_revision_stale "This plan changed since you opened it. Review the order and try again." rows 0 | PASS |

### ASSIGN-SCHEDULE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ASSIGN-SCHEDULE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Schedule people” permission to do that" rows 0->0 | PASS |
| ASSIGN-SCHEDULE.up400 | sched | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up401 | sched | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up403 | sched | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | PASS |
| ASSIGN-SCHEDULE.up404 | sched | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up500 | sched | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up502 | sched | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up503 | sched | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.up504 | sched | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.reset | sched | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (effects=0); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.lostSb | sched | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1 (effects=1); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.lostApi | sched | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1 (effects=1); retry 201 rows 1 (effects=1) | PASS |
| ASSIGN-SCHEDULE.timeout | sched | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1 (effects=1); retry 201 rows 1 (effects=1) | PASS |
| ASSIGN-SCHEDULE.post-commit-read.up500 | sched | API+upstream | up500 on effectIdForKey after schedule_plan_assignments | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->1 (effects=1); retry 201 rows 1 (effects=1) | FAIL (D1) |
| ASSIGN-SCHEDULE.post-commit-read.reset | sched | API+upstream | reset on effectIdForKey after schedule_plan_assignments | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 201 (GET transparently retried by the client library; request succeeded); rows 0->1 (effects=1); retry 201 rows 1 (effects=1) | PASS |
| ASSIGN-SCHEDULE.delivery-kick.up500 | sched | API+upstream | up500 on claim_deliveries (in-request kick) | action succeeds (2xx), row persisted, effect left queued for the worker (no lost notification, no 5xx) | resp 201; rows ok=true; effect state: queued (3 deliveries) | PASS |
| ASSIGN-SCHEDULE.delivery-kick.reset | sched | API+upstream | reset on claim_deliveries (in-request kick) | action succeeds (2xx), row persisted, effect left queued for the worker (no lost notification, no 5xx) | resp 201; rows ok=true; effect state: queued (3 deliveries) | PASS |

### RESPOND-SELF

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| RESPOND-SELF.denied.bmember.up500 | bmember | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 500 XX000 "internal error relation "private.secret" at character 12" rows 0->0 [denial is decided inside the faulted RPC; the injected fault pre-empts it, no write happened; mapping covered by W8-RES-D1] | NOT_APPLICABLE |
| RESPOND-SELF.up400 | pending | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up401 | pending | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up403 | pending | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | PASS |
| RESPOND-SELF.up404 | pending | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up500 | pending | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up502 | pending | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up503 | pending | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.up504 | pending | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.reset | pending | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (hist=0); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.lostSb | pending | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1 (hist=1); retry 200 rows 1 (hist=1) | FAIL (D1) |
| RESPOND-SELF.lostApi | pending | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1 (hist=1); retry 200 rows 1 (hist=1) | PASS |
| RESPOND-SELF.timeout | pending | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1 (hist=1); retry 200 rows 1 (hist=1) | PASS |

### RESPOND-SNAPSHOT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| RESPOND-SNAPSHOT.denied.bmember.up500 | bmember | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 500 XX000 "internal error relation "private.secret" at character 12" rows 0->0 [denial is decided inside the faulted RPC; the injected fault pre-empts it, no write happened; mapping covered by W8-RES-D1] | NOT_APPLICABLE |
| RESPOND-SNAPSHOT.up400 | pending | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up401 | pending | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up403 | pending | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | PASS |
| RESPOND-SNAPSHOT.up404 | pending | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up500 | pending | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up502 | pending | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up503 | pending | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.up504 | pending | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.reset | pending | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (hist=0 agg=unconfirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.lostSb | pending | API+upstream | lostSb | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->2 (hist=1 agg=confirmed); retry 200 rows 2 (hist=1 agg=confirmed) | FAIL (D1) |
| RESPOND-SNAPSHOT.lostApi | pending | API+upstream | lostApi | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->2 (hist=1 agg=confirmed); retry 200 rows 2 (hist=1 agg=confirmed) | PASS |
| RESPOND-SNAPSHOT.timeout | pending | API+upstream | timeout | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 0 This operation was aborted; rows 0->2 (hist=1 agg=confirmed); retry 200 rows 2 (hist=1 agg=confirmed) | PASS |

### CHAT-SEND

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| CHAT-SEND.denied.bmember.up500 | bmember | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 404 not_found "Conversation not found" rows 0->0 | PASS |
| CHAT-SEND.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 201 rows 1 | PASS |
| CHAT-SEND.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| CHAT-SEND.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 200 rows 1 | FAIL (D1) |
| CHAT-SEND.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 200 rows 1 | PASS |
| CHAT-SEND.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 200 rows 1 | PASS |
| CHAT-SEND.post-commit-read.up500 | owner | API+upstream | up500 on loadMessage after post_conversation_message | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->1 (); retry 200 rows 1 () | FAIL (D1) |
| CHAT-SEND.post-commit-read.reset | owner | API+upstream | reset on loadMessage after post_conversation_message | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 201 (GET transparently retried by the client library; request succeeded); rows 0->1 (); retry 200 rows 1 () | PASS |
| CHAT-SEND.delivery-kick.up500 | owner | API+upstream | up500 on claim_deliveries (in-request kick) | action succeeds (2xx), row persisted, effect left queued for the worker (no lost notification, no 5xx) | resp 201; rows ok=true; effect state: queued (2 deliveries) | PASS |

### NOTE-CREATE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| NOTE-CREATE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| NOTE-CREATE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 201 rows 1 | PASS |
| NOTE-CREATE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| NOTE-CREATE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 201 rows 2 | FAIL (D3) |
| NOTE-CREATE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 201 rows 2 | FAIL (D3) |
| NOTE-CREATE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 201 rows 2 | FAIL (D3) |
| NOTE-CREATE.post-commit-read.up500 | owner | API+upstream | up500 on decorate after save_plan_note | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->1 (); retry 201 rows 2 () | FAIL (D3) |
| NOTE-CREATE.post-commit-read.reset | owner | API+upstream | reset on decorate after save_plan_note | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 201 (GET transparently retried by the client library; request succeeded); rows 0->1 (); retry 201 rows 2 () [client got 201; the deliberate repeat is not a realistic retry] | NOT_APPLICABLE |

### NOTE-UPDATE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| NOTE-UPDATE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 0->0 | PASS |
| NOTE-UPDATE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| NOTE-UPDATE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| NOTE-UPDATE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 409 note_stale "This note changed since you opened it" rows 1 | FAIL (D1) |
| NOTE-UPDATE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 409 note_stale "This note changed since you opened it" rows 1 | PASS |
| NOTE-UPDATE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 409 note_stale "This note changed since you opened it" rows 1 | PASS |

### NOTE-DELETE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| NOTE-DELETE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Edit plans” permission to do that" rows 1->1 | PASS |
| NOTE-DELETE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (1), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (1), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (1), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 1->1; retry 204  rows 0 | PASS |
| NOTE-DELETE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (1), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (1), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (1), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (1), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 1->1; retry 204  rows 0 | FAIL (D1) |
| NOTE-DELETE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 1->0; retry 404 not_found "Note not found" rows 0 | FAIL (D1) |
| NOTE-DELETE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 1->0; retry 404 not_found "Note not found" rows 0 | PASS |
| NOTE-DELETE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (0); same-key retry converges | resp 0 This operation was aborted; rows 1->0; retry 404 not_found "Note not found" rows 0 | PASS |

### FILE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| FILE.baseline.intent-upload-finalize | owner | API+Storage | none | intent 201, upload ok, finalize ready | 201 upload ok; finalize 200 outcome ready | PASS |

### FILE-INTENT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| FILE-INTENT.up400 | owner | API+upstream | up400 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up401 | owner | API+upstream | up401 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 PGRST301 "JWT expired" LEAK:JWT; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up403 | owner | API+upstream | up403 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 403 forbidden "You do not have access to do that"; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | PASS |
| FILE-INTENT.up404 | owner | API+upstream | up404 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up500 | owner | API+upstream | up500 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up502 | owner | API+upstream | up502 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up503 | owner | API+upstream | up503 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.up504 | owner | API+upstream | up504 | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.reset | owner | API+upstream | reset | mapped status, no leak, no attachment row; retry creates one; upload+finalize -> ready | resp 500 "TypeError: fetch failed" LEAK:TypeError; attachments 0 versions none; retry 201 replayed=false attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.lostSb | owner | API+upstream | lostSb | one pending intent; same-key retry replays and returns a usable signed upload; upload+finalize -> ready | resp 500 "TypeError: fetch failed" LEAK:TypeError; attachments 1 versions pending:-; retry 200 replayed=true attachments 1; upload ok; finalize ready | FAIL (D1) |
| FILE-INTENT.lostApi | owner | API+upstream | lostApi | one pending intent; same-key retry replays and returns a usable signed upload; upload+finalize -> ready | resp 0 UND_ERR_SOCKET; attachments 1 versions pending:-; retry 200 replayed=true attachments 1; upload ok; finalize ready | PASS |
| FILE-INTENT.denied.member.up500 | member | API | denied+up500 | 403/404 no write | 500 XX000 "internal error relation "private.secret" at character 12"; attachments 0 [denial is decided inside the faulted RPC; the injected fault pre-empts it, no write happened; mapping covered by W8-RES-D1] | NOT_APPLICABLE |
| FILE-INTENT.denied.bmember.up500 | bmember | API | denied+up500 | 403/404 no write | 404 not_found "That parent was not found"; attachments 0 | PASS |
| FILE-INTENT.storage-sign.up500 | owner | API+Storage | Storage up500 on signed-upload-url | 503 storage_unavailable; leftover pending intent (no ready file); same-key retry gives a usable upload target | resp 503 storage_unavailable "File storage is unavailable. Try again shortly."; attachments 1 versions pending:-; retry 200 replayed=true upload-target=yes; upload ok; finalize ready | PASS |
| FILE-INTENT.storage-sign.up404 | owner | API+Storage | Storage up404 on signed-upload-url | 503 storage_unavailable; leftover pending intent (no ready file); same-key retry gives a usable upload target | resp 503 storage_unavailable "File storage is unavailable. Try again shortly."; attachments 1 versions pending:-; retry 200 replayed=true upload-target=yes; upload ok; finalize ready | PASS |
| FILE-INTENT.storage-sign.up503 | owner | API+Storage | Storage up503 on signed-upload-url | 503 storage_unavailable; leftover pending intent (no ready file); same-key retry gives a usable upload target | resp 503 storage_unavailable "File storage is unavailable. Try again shortly."; attachments 1 versions pending:-; retry 200 replayed=true upload-target=yes; upload ok; finalize ready | PASS |
| FILE-INTENT.storage-sign.reset | owner | API+Storage | Storage reset on signed-upload-url | 503 storage_unavailable; leftover pending intent (no ready file); same-key retry gives a usable upload target | resp 503 storage_unavailable "File storage is unavailable. Try again shortly."; attachments 1 versions pending:-; retry 200 replayed=true upload-target=yes; upload ok; finalize ready | PASS |
| FILE-INTENT.storage-sign.lostSb | owner | API+Storage | Storage lostSb on signed-upload-url | 503 storage_unavailable; leftover pending intent (no ready file); same-key retry gives a usable upload target | resp 503 storage_unavailable "File storage is unavailable. Try again shortly."; attachments 1 versions pending:-; retry 200 replayed=true upload-target=yes; upload ok; finalize ready | PASS |
| FILE-INTENT.storage-sign.replay-also-fails | owner | API+Storage | Storage 500 on sign, twice (first attempt + same-key replay) | the replay reports storage_unavailable (503) too, or a usable target; never a 2xx without an upload target while the object is absent | first 503 storage_unavailable "File storage is unavailable. Try again shortly."; replay 200 upload-target=null replayed=true | FAIL (D7) |

### FILE-UPLOAD

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| FILE-UPLOAD.storage-put.up500 | owner | Storage+API | Storage up500 on object upload | client sees upload error (or lost reply); finalize reflects reality (not_uploaded when no object, ready when object landed); a retry upload + finalize ends ready exactly  | upload1 ERR internal error relation "private.secret" at character 12; object present 0; finalize1 200 not_uploaded; upload2 ok; finalize2 200 ready versions ready:- | PASS |
| FILE-UPLOAD.storage-put.up503 | owner | Storage+API | Storage up503 on object upload | client sees upload error (or lost reply); finalize reflects reality (not_uploaded when no object, ready when object landed); a retry upload + finalize ends ready exactly  | upload1 ERR Could not connect with the database. Error: connection to 10; object present 0; finalize1 200 not_uploaded; upload2 ok; finalize2 200 ready versions ready:- | PASS |
| FILE-UPLOAD.storage-put.up404 | owner | Storage+API | Storage up404 on object upload | client sees upload error (or lost reply); finalize reflects reality (not_uploaded when no object, ready when object landed); a retry upload + finalize ends ready exactly  | upload1 ERR Could not find the function public.secret_fn in the schema c; object present 0; finalize1 200 not_uploaded; upload2 ok; finalize2 200 ready versions ready:- | PASS |
| FILE-UPLOAD.storage-put.reset | owner | Storage+API | Storage reset on object upload | client sees upload error (or lost reply); finalize reflects reality (not_uploaded when no object, ready when object landed); a retry upload + finalize ends ready exactly  | upload1 ERR fetch failed; object present 0; finalize1 200 not_uploaded; upload2 ok; finalize2 200 ready versions ready:- | PASS |
| FILE-UPLOAD.storage-put.lostSb | owner | Storage+API | Storage lostSb on object upload | client sees upload error (or lost reply); finalize reflects reality (not_uploaded when no object, ready when object landed); a retry upload + finalize ends ready exactly  | upload1 ERR fetch failed; object present 1; finalize1 200 ready; upload2 ERR The resource already exists; finalize2 200 ready versions ready:- | PASS |

### FILE-FINALIZE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| FILE-FINALIZE.size-mismatch | owner | API+Storage | Storage object smaller than declared | outcome failed/size_mismatch, never ready | upload ok; finalize 200 failed/size_mismatch | PASS |
| FILE-FINALIZE.up400 | owner | API+upstream | up400 | version stays pending; retry finalizes to ready once | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up401 | owner | API+upstream | up401 | version stays pending; retry finalizes to ready once | resp 500 PGRST301 "JWT expired" LEAK:JWT; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up403 | owner | API+upstream | up403 | version stays pending; retry finalizes to ready once | resp 403 forbidden "You do not have access to do that"; version pending; retry 200 ready replayed=false; ready versions 1 | PASS |
| FILE-FINALIZE.up404 | owner | API+upstream | up404 | version stays pending; retry finalizes to ready once | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up500 | owner | API+upstream | up500 | version stays pending; retry finalizes to ready once | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up502 | owner | API+upstream | up502 | version stays pending; retry finalizes to ready once | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up503 | owner | API+upstream | up503 | version stays pending; retry finalizes to ready once | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.up504 | owner | API+upstream | up504 | version stays pending; retry finalizes to ready once | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.reset | owner | API+upstream | reset | version stays pending; retry finalizes to ready once | resp 500 "TypeError: fetch failed" LEAK:TypeError; version pending; retry 200 ready replayed=false; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.lostSb | owner | API+upstream | lostSb | version ready once; retry returns ready with replayed=true | resp 500 "TypeError: fetch failed" LEAK:TypeError; version ready; retry 200 ready replayed=true; ready versions 1 | FAIL (D1) |
| FILE-FINALIZE.lostApi | owner | API+upstream | lostApi | version ready once; retry returns ready with replayed=true | resp 0 UND_ERR_SOCKET; version ready; retry 200 ready replayed=true; ready versions 1 | PASS |

### FILE-ABANDON

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| FILE-ABANDON.up500 | owner | API+upstream | up500 | upload still pending; retry abandons | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; file removed false; retry 200 | FAIL (D1) |
| FILE-ABANDON.up503 | owner | API+upstream | up503 | upload still pending; retry abandons | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; file removed false; retry 200 | FAIL (D1) |
| FILE-ABANDON.reset | owner | API+upstream | reset | upload still pending; retry abandons | resp 500 "TypeError: fetch failed" LEAK:TypeError; file removed false; retry 200 | FAIL (D1) |
| FILE-ABANDON.lostSb | owner | API+upstream | lostSb | abandoned once; retry: 200 (idempotent) or documented 404 once the new file is gone | resp 500 "TypeError: fetch failed" LEAK:TypeError; file removed true; retry 404 not_found "File not found" | FAIL (D1) |
| FILE-ABANDON.lostApi | owner | API+upstream | lostApi | abandoned once; retry: 200 (idempotent) or documented 404 once the new file is gone | resp 0 UND_ERR_SOCKET; file removed true; retry 404 not_found "File not found" | PASS |

### ATTEND-RECORD

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ATTEND-RECORD.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Schedule people” permission to do that" rows 0->0 | PASS |
| ATTEND-RECORD.up400 | sched | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up401 | sched | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up403 | sched | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | PASS |
| ATTEND-RECORD.up404 | sched | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up500 | sched | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up502 | sched | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up503 | sched | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.up504 | sched | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.reset | sched | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (batches=0 events=0); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.lostSb | sched | API+upstream | lostSb | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->2 (batches=1 events=2); retry 200 rows 2 (batches=1 events=2) | FAIL (D1) |
| ATTEND-RECORD.lostApi | sched | API+upstream | lostApi | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->2 (batches=1 events=2); retry 200 rows 2 (batches=1 events=2) | PASS |
| ATTEND-RECORD.timeout | sched | API+upstream | timeout | client sees no/err reply; persisted exactly once (2); same-key retry converges | resp 0 This operation was aborted; rows 0->2 (batches=1 events=2); retry 200 rows 2 (batches=1 events=2) | PASS |

### ATTEND-TIMES

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| ATTEND-TIMES.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Schedule people” permission to do that" rows 0->0 | PASS |
| ATTEND-TIMES.up400 | sched | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up401 | sched | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up403 | sched | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| ATTEND-TIMES.up404 | sched | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up500 | sched | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up502 | sched | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up503 | sched | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.up504 | sched | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.reset | sched | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| ATTEND-TIMES.lostSb | sched | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 409 assignment_revision_stale "A request changed since you opened it; refresh and try again" rows 1 | FAIL (D1) |
| ATTEND-TIMES.lostApi | sched | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 409 assignment_revision_stale "A request changed since you opened it; refresh and try again" rows 1 | PASS |
| ATTEND-TIMES.timeout | sched | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 409 assignment_revision_stale "A request changed since you opened it; refresh and try again" rows 1 | PASS |

### RELEASE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| RELEASE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Schedule people” permission to do that" rows 0->0 | PASS |
| RELEASE.up400 | sched | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up401 | sched | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up403 | sched | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | PASS |
| RELEASE.up404 | sched | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up500 | sched | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up502 | sched | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up503 | sched | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.up504 | sched | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.reset | sched | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (batches=0 effects=0); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.lostSb | sched | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1 (batches=1 effects=1); retry 200 rows 1 (batches=1 effects=1) | FAIL (D1) |
| RELEASE.lostApi | sched | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1 (batches=1 effects=1); retry 200 rows 1 (batches=1 effects=1) | PASS |
| RELEASE.timeout | sched | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1 (batches=1 effects=1); retry 200 rows 1 (batches=1 effects=1) | PASS |
| RELEASE.post-commit-read.up500 | sched | API+upstream | up500 on final assignments read after create_release_batch | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 200 (GET transparently retried by the client library; request succeeded); rows 0->1 (batches=1 effects=1); retry 200 rows 1 (batches=1 effects=1) | PASS |
| RELEASE.post-commit-read.reset | sched | API+upstream | reset on final assignments read after create_release_batch | commit persisted once; error reply is 5xx w/o leak (lost-success-reply); same-key retry converges, no duplicate | resp 200 (GET transparently retried by the client library; request succeeded); rows 0->1 (batches=1 effects=1); retry 200 rows 1 (batches=1 effects=1) | PASS |
| RELEASE.delivery-kick.up500 | sched | API+upstream | up500 on claim_deliveries (in-request kick) | action succeeds (2xx), row persisted, effect left queued for the worker (no lost notification, no 5xx) | resp 200; rows ok=true; effect state: queued (3 deliveries) | PASS |

### MATRIX-COMMIT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| MATRIX-COMMIT.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You need the “Schedule people” permission to do that" rows 0->0 | PASS |
| MATRIX-COMMIT.up400 | sched | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up401 | sched | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up403 | sched | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | PASS |
| MATRIX-COMMIT.up404 | sched | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up500 | sched | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up502 | sched | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up503 | sched | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.up504 | sched | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.reset | sched | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0 (commits=0); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.lostSb | sched | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1 (commits=1); retry 200 rows 1 (commits=1) | FAIL (D1) |
| MATRIX-COMMIT.lostApi | sched | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1 (commits=1); retry 200 rows 1 (commits=1) | PASS |
| MATRIX-COMMIT.timeout | sched | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1 (commits=1); retry 200 rows 1 (commits=1) | PASS |

### IMPORT-SAVE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| IMPORT-SAVE.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 403 forbidden "You do not have access to do that" rows 0->0 | PASS |
| IMPORT-SAVE.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 201 rows 1 | PASS |
| IMPORT-SAVE.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 201 rows 1 | FAIL (D1) |
| IMPORT-SAVE.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 201 rows 1 | PASS |
| IMPORT-SAVE.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 201 rows 1 | PASS |

### IMPORT-COMMIT

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| IMPORT-COMMIT.denied.member.up500 | member | API | denied+up500 | 403/404, no write, no leak (denial decided before the faulted commit call) | 500 XX000 "internal error relation "private.secret" at character 12" rows 0->0 [denial is decided inside the faulted RPC; the injected fault pre-empts it, no write happened; mapping covered by W8-RES-D1] | NOT_APPLICABLE |
| IMPORT-COMMIT.up400 | owner | API+upstream | up400 | mapped status 400/422/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST100 ""failed to parse filter (internal-detail)"" LEAK:internal-detail; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up401 | owner | API+upstream | up401 | mapped status 401, no detail leak, no write (0), retry succeeds | resp 500 PGRST301 "JWT expired" LEAK:JWT; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up403 | owner | API+upstream | up403 | mapped status 403/404, no detail leak, no write (0), retry succeeds | resp 403 forbidden "You do not have access to do that"; rows 0->0; retry 200 rows 1 | PASS |
| IMPORT-COMMIT.up404 | owner | API+upstream | up404 | mapped status 404/500, no detail leak, no write (0), retry succeeds | resp 500 PGRST202 "Could not find the function public.secret_fn in the schema cache" LEAK:secret_; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up500 | owner | API+upstream | up500 | mapped status 500/502/503, no detail leak, no write (0), retry succeeds | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up502 | owner | API+upstream | up502 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up503 | owner | API+upstream | up503 | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.up504 | owner | API+upstream | up504 | mapped status 502/503/504/504, no detail leak, no write (0), retry succeeds | resp 500 "upstream request timeout" LEAK:raw:upstream request timeout; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.reset | owner | API+upstream | reset | mapped status 502/503/504, no detail leak, no write (0), retry succeeds | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->0; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.lostSb | owner | API+upstream | lostSb | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 500 "TypeError: fetch failed" LEAK:TypeError; rows 0->1; retry 200 rows 1 | FAIL (D1) |
| IMPORT-COMMIT.lostApi | owner | API+upstream | lostApi | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 UND_ERR_SOCKET; rows 0->1; retry 200 rows 1 | PASS |
| IMPORT-COMMIT.timeout | owner | API+upstream | timeout | client sees no/err reply; persisted exactly once (1); same-key retry converges | resp 0 This operation was aborted; rows 0->1; retry 200 rows 1 | PASS |

### MIDDLEWARE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| MIDDLEWARE.auth.getUser.GET_/plans.up401 | owner | API+upstream | up401 | 401 (session really invalid) | resp 401 unauthorized "Invalid or expired session"; next request 200 | PASS |
| MIDDLEWARE.auth.getUser.GET_/schedule/mine.up401 | pending | API+upstream | up401 | 401 (session really invalid) | resp 401 unauthorized "Invalid or expired session"; next request 200 | PASS |
| MIDDLEWARE.auth.getUser.GET_/plans.up500 | owner | API+upstream | up500 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/schedule/mine.up500 | pending | API+upstream | up500 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/plans.up502 | owner | API+upstream | up502 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/schedule/mine.up502 | pending | API+upstream | up502 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/plans.up503 | owner | API+upstream | up503 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/schedule/mine.up503 | pending | API+upstream | up503 | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/plans.reset | owner | API+upstream | reset | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.auth.getUser.GET_/schedule/mine.reset | pending | API+upstream | reset | 502/503/504 no leak | resp 401 unauthorized "Invalid or expired session"; next request 200 | FAIL (D2) |
| MIDDLEWARE.org-context_rpc.GET_/plans.up401 | owner | API+upstream | up401 | 401 no leak | resp 500 PGRST301 "JWT expired" LEAK:JWT; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/schedule/mine.up401 | pending | API+upstream | up401 | 401 no leak | resp 500 PGRST301 "JWT expired" LEAK:JWT; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/plans.up500 | owner | API+upstream | up500 | 502/503/504 no leak | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/schedule/mine.up500 | pending | API+upstream | up500 | 502/503/504 no leak | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/plans.up502 | owner | API+upstream | up502 | 502/503/504 no leak | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/schedule/mine.up502 | pending | API+upstream | up502 | 502/503/504 no leak | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/plans.up503 | owner | API+upstream | up503 | 502/503/504 no leak | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/schedule/mine.up503 | pending | API+upstream | up503 | 502/503/504 no leak | resp 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK:connection to; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/plans.reset | owner | API+upstream | reset | 502/503/504 no leak | resp 500 "TypeError: fetch failed" LEAK:TypeError; next request 200 | FAIL (D1) |
| MIDDLEWARE.org-context_rpc.GET_/schedule/mine.reset | pending | API+upstream | reset | 502/503/504 no leak | resp 500 "TypeError: fetch failed" LEAK:TypeError; next request 200 | FAIL (D1) |
| MIDDLEWARE.route_read.GET_/plans.up401 | owner | API+upstream | up401 | 401 no leak | resp 500 PGRST301 "JWT expired" LEAK:JWT; next request 200 | FAIL (D1) |
| MIDDLEWARE.route_read.GET_/plans.up500 | owner | API+upstream | up500 | 502/503/504 no leak | resp 500 XX000 "internal error relation "private.secret" at character 12" LEAK:internal error; next request 200 | FAIL (D1) |
| MIDDLEWARE.route_read.GET_/plans.up502 | owner | API+upstream | up502 | 502/503/504 no leak | resp 500 "<html><body>502 Bad Gateway (kong)</body></html>" LEAK:<html; next request 200 | FAIL (D1) |
| MIDDLEWARE.route_read.GET_/plans.up503 | owner | API+upstream | up503 | 502/503/504 no leak | resp 200; next request 200 (GET transparently retried by postgrest-js) | PASS |
| MIDDLEWARE.route_read.GET_/plans.reset | owner | API+upstream | reset | 502/503/504 no leak | resp 200; next request 200 (GET transparently retried by postgrest-js) | PASS |

### SLOW

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| SLOW.read.3s | owner | API+upstream | delay 3s | 200 after the delay, intact payload | 200 in 3022ms | PASS |
| SLOW.read.35s | owner | API+upstream | delay 35s | API bounds the upstream wait (answers 502/504 within ~30s); other requests unaffected | 200 after 35031ms (API waited the whole 35s; no server-side timeout); concurrent unfaulted request 200 in 23ms | FAIL (D6) |

### PROD-MODE

| Case ID | Actor | Surface | Injected fault | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| PROD-MODE.PLAN-EDIT.up500 | owner | API (NODE_ENV=production) | up500 | 502/503, generic message | 500 XX000 "internal error relation "private.secret" at character 12" LEAK | FAIL (D1) |
| PROD-MODE.PLAN-EDIT.up503 | owner | API (NODE_ENV=production) | up503 | 502/503, generic message | 500 PGRST000 "Could not connect with the database. Error: connection to 10.0.0.5 port 5432 refused" LEAK | FAIL (D1) |
| PROD-MODE.PLAN-EDIT.reset | owner | API (NODE_ENV=production) | reset | 502/503, generic message | 500 "TypeError: fetch failed" LEAK | FAIL (D1) |

## Not run / blocked

- NOT_RUN: web and native behaviour of drafts surviving a failure (owned by W8-WEB / W7-NATIVE style packages; browser and simulator not mine). Delivery-provider failures, worker lease/ambiguous outcomes and `/internal/deliveries/run` (owned by W8-INT; I only exercised the in-request kick failing).
- NOT_RUN: PLAN-TIMES retry on a plan with released confirmed requests (possible duplicate time-change effect, see observation); same-key-different-body check for operations other than plan create and item add (duplicate plan, release, matrix commit, import save, attendance, snapshot respond, file intent).
- NOT_RUN: concurrent retry races (two identical keyed requests in flight at once) and real PostgREST/Postgres restart (shared services must not be stopped); injection was at the HTTP layer only. Statement-level Postgres failure (deadlock, lock timeout 55P03/40P01) was not injected; `fromPostgrestError` maps them to a 409 per source.
- NOT_RUN: people-kind imports and song-import denial for a `songs.manage`-only caller; people/availability/opportunity flows outside the owned list.
- BLOCKED: none after the clean re-run. The first run was interrupted by the SIGTERM sweep and a port clash on :4602 (another process listens there); my reply-drop proxy moved to :4612/:4613 and every affected case was re-run from scratch.

## Fixtures left in place

- Orgs `qa-w8-res-a` and `qa-w8-res-b`, six users `*.qaw8.res@example.test`, Alpha service type "Sunday", team "Band", 3 team members; about 660 plans titled `rs-*`, their assignments, notes, items, chat messages, attendance records, release batches, 35 attachments (small PDFs), import jobs and songs `rs-imp-*`/`rs-impc-*`, `delivery_effects` for them (left `queued`, never delivered; the worker was not run). Beta org has one plan. Nothing outside these two orgs was touched. Credentials: scratchpad `.../scratchpad/res/creds.json`.
- All processes I started (private API :4601, production-mode API :4611, Supabase fault proxy :54401/:54402, API reply-drop proxy :4612/:4613) were stopped by PID before finishing.
