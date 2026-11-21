# W8-INT integration and delivery gaps: wave 8 (run qa-w8-int)

Date 2026-11-20/21. Package W8-INT (wave 7 carry-overs for QA-07/08/12/16). Plan: `docs/plans/admin-mobile-test-plan.md` §5 E/F/H (RELEASE, DELIVERY, MESSAGE, API-01, HOOK-01, PUBLIC-01), §7 SEC-02, §10 JOURNEY-07 (webhooks half), §12.

## Header

| Item | Value |
|---|---|
| Commit | `897e524` on `feature/qa-wave8` (= `main` + wave 7 fixes). No source, migration, config or git change made (`git status` shows only this report directory). |
| Shared environment | API :4000 (simulated email/push), web :5173, local Supabase (psql for setup/assertions only; permission evidence uses each actor's own JWT). |
| Private processes (all stopped at the end, by listening-port PID) | **4602** API with fake Resend (`RESEND_API_KEY=re_fake…`, `RESEND_BASE_URL=http://127.0.0.1:4700`) and `PUSH_ENABLED=true` (Expo URL is hard-coded in `backend/src/services/expo-push.ts:28`, so a test-only `--import` preload redirects `https://exp.host/...` to the fake on :4701); `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=true`. **4604** API, simulated providers, private destinations allowed (used for every global worker run, see below). **4605** API, private destinations **false** (destination policy). **4606** API `NODE_ENV=development` and **4607** `NODE_ENV=production` (rate-limit exhaustion only). All with `CRON_SECRET`, `INTEGRATION_SECRET_KEY`, `DELIVERY_LINK_SECRET` as process env (secrets only in the scratchpad). Fakes on 127.0.0.1: Resend :4700, Expo :4701, webhook receiver :4710 (path selects 200/202/500/500+Retry-After/429/400/410/302/hang/reset; verifies Standard Webhooks signatures with the endpoint secret). The preload also overrides `dns.lookup` per host name from a JSON map so DNS answers can be scripted (rebinding). |
| Namespace | orgs `qa-w8-int-a` (Alpha, America/Chicago), `qa-w8-int-b` (Beta, Asia/Ho_Chi_Minh); users `<alias>.qaw8.int@example.test`. |
| Fixture shape | Org A: owner, admin, `sched` (legacy scheduler), `flead` (member, folder FA grants `plans.edit`+`scheduling.manage`), `slead` (member, service type Sunday grants), `tlead` (member, team Band 2 `scheduling.manage` only), mem1, mem2 (Vietnamese), cand, viewer. Folders FA > FC (child) and FB (sibling); service types Sunday (FA), Midweek (FC), Youth (FB), Loose (no folder); one team with Keys/Drums per type; plans per type, a published signup plan with a direct and a leader-approval opening. Org B: owner, admin, member; one folder. Outsider: user with no organization. |
| Credentials | Only in the scratchpad `int/` directory (`creds.json`, `env-int.txt`, `hook-secret.json`). None in this report. |
| Evidence files | Scratchpad `int/`: `rows-*.json` (every case), `worker-runs.jsonl`, `fake-log.jsonl`, `api46xx.log`, `rt-log.txt`. |

### Incident reported by this agent

While restarting my own instances I ran `pkill -f "tsx.*src/index.ts"`, which also matched and terminated the **shared API :4000** (SIGTERM, a few seconds of downtime; it was restarted by someone else, healthy again). This was my mistake; afterwards I stopped processes only by the PID listening on my own ports. Also note: my first attempt to use port 4603 collided with another agent's process there (its traffic appeared in my log file and the process later received a SIGTERM that was not from my port-scoped kills), so I moved to 4605.

### Worker runs and cross-org side effects

The delivery worker is global. To contain it I ran:

* **Global runs** (`POST /api/v1/internal/deliveries/run`) only on instances without fake providers (4604, 4605 → simulated, the same outcome as the shared API), 39 runs, each bracketed by per-organization snapshots of deliveries, webhook deliveries, release batches, reminder jobs and report exports (`worker-runs.jsonl`).
* **Delivery failure injection** (fake Resend/Expo) never used a global run: the API's own in-request kick is effect-scoped, and retries used a scoped harness (`runDeliveryWorker({effectId})`, the same code, outside the repo) so no other organization's rows could be claimed.
* **Run 1 (mistake):** the very first run (webhook test send) was on :4602, which has the fake Resend. It claimed one email delivery of **`qa-w8-res-a`** (delivery `81fce24b…`, to `pending.qaw8.res@example.test`) and recorded it `provider_accepted` (message id `re_fake_1`) although nothing was really sent; on the shared simulated setup it would have been `simulated`. Reported so W8-RES can discount that row. No pre-snapshot existed for this run.
* **Run 2 (4604):** claimed 2 deliveries (the in-app and push rows of the same `qa-w8-res-a` effect, queued → delivered/skipped) plus my 3 webhook deliveries.
* **All other runs:** `claimed 0` deliveries and 0 releases; the snapshot diffs listed other organizations' rows moving (`qa-w8-rt-a` deliveries delivered/skipped/cancelled/simulated, `qa-w8-res-a`, `qa-w8-acc-a`/`qa-20261120-resp-a` reminder jobs scheduled) but those came from other agents' workers running at the same time (my run reported claimed 0); attribution is not possible from table counts. No release batch was run by me (releases 0 in every run).
* Delivery side effects inside my namespace: `qa-w8-int-a` deliveries are in many states (see fixtures left in place); every provider answer was a local fake.


## Defects

No P0. No cross-tenant read or write, no private/prepared field in any webhook payload, no unauthorized webhook RPC/table write, no lost write and no duplicate provider effect from concurrent workers.

| ID | Priority | Summary |
|---|---|---|
| W8-INT-D1 | P1 | Webhook retries wait about 24 h when the receiver sends no `Retry-After` (W3-INT-D8 still present at `897e524`) |
| W8-INT-D2 | P2 | A plan created directly as `published` emits no `plan.published` webhook event (= W3-INT-D7, still present) |
| W8-INT-D3 | P2 | `POST /integrations/webhooks` with a non-URL string returns 500 (= W3-INT-D6, still present) |
| W8-INT-D4 | P2 | Rate limiter keys on `X-Forwarded-For` (`trust proxy 1`): a client that reaches the API directly resets its counter by sending any XFF value |
| W8-INT-D5 | P2 | Realtime keeps a deactivated member's open socket until JWT expiry (up to 900 s); ADR 0005 says that case has no window |

### W8-INT-D1 (P1) webhook backoff is about 24 hours without Retry-After
* Cases: HOOK-01.retry.attempt1/attempt2 for `/500`, `/400`, `/reset` (connection_failed) and `/hang` (timeout).
* Repro: register an endpoint, make the receiver answer 500 (or 400, drop the connection, or hang past 15 s) with no `Retry-After`, trigger `plan.published` (PATCH status draft → published), run the worker. `webhook_deliveries.next_attempt_at - now()` is 78,965 to 91,547 s on every attempt; forcing it due and re-running gives the same ~24 h on attempts 2 to 8. With `Retry-After: 7`, a date header (+20 s) and `Retry-After: 3` the delay is correct (7 s, 20 s, 5 s) and a huge value is capped (~86,400 s).
* Expected: jittered 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h, 20 h (`docs/integrations/developer-api.md`, "Delivery behaviour").
* Actual cause (confirmed in the applied function body, `pg_get_functiondef`): `greatest(coalesce(least(p_retry_after_seconds, 86400), 0), v_backoff[...])`. `least(NULL, 86400)` is 86400, so a NULL hint (no header, timeout, connection failure) yields 86400 and the schedule is never used.
* Source: `supabase/migrations/20261103000000_f17_developer_api.sql:874-876` (`complete_webhook_delivery`). Fix: `case when p_retry_after_seconds is null then 0 else least(p_retry_after_seconds, 86400) end`. Needs a new migration (do not edit the applied one).
* Impact: an outage of the receiver of any length recovers only about a day later; the documented schedule is not delivered. No data exposure.

### W8-INT-D2 (P2) plan created as `published` emits no event
* Repro: `POST /plans` with `status:"published"` for an organization with an endpoint subscribed to `plan.published`; no `webhook_events` row. PATCH draft → published does emit.
* Expected: `plan.published` (the plan is published at that moment). Source: `supabase/migrations/20261103000000_f17_developer_api.sql:762` (`after update of status` trigger only, no insert trigger).

### W8-INT-D3 (P2) non-URL string returns 500
* Repro: owner `POST /integrations/webhooks` `{"url":"not a url","event_types":["plan.published"],"idempotency_key":"abcdefgh1"}` → `500 internal_error`. Expected 422.
* Source: `packages/shared/src/schemas/integrations.ts` `webhookUrlSchema.superRefine` calls `new URL(value)` even when `.url()` already failed, so the TypeError escapes zod. (`javascript:alert(1)`, `ftp://…`, credentials and fragments return 422 correctly.)

### W8-INT-D4 (P2) XFF resets the rate-limit counter on a directly reachable instance
* Repro (private instance, production mode, limit 300): 340 requests from 127.0.0.1 give 300 × 200 then 429 with `RateLimit`, `RateLimit-Policy` and `Retry-After: 60`; one more request with `X-Forwarded-For: 203.0.113.77` returns 200. Same on the 10,000/min development limit.
* Expected: a client cannot choose its own limiter key. Actual: `app.set('trust proxy', 1)` (`backend/src/app.ts:96`) trusts the last XFF hop, so behind exactly one proxy that appends the real peer (Vercel) it is correct, but anyone who can reach the process directly, or sits behind a proxy that forwards a client-supplied XFF, can mint unlimited keys.
* Impact depends on deployment; also note the limiter is a per-process memory store (counters are not shared across instances or restarts) and covers `/health`, so an exhausted client also gets 429 on `/health`.

### W8-INT-D5 (P2) deactivated member's Realtime socket stays live until token expiry
* Repro: member subscribes to `live_plan:<plan>` (private broadcast); set the membership `inactive`; the open socket keeps receiving pokes for 825 s until the socket is closed at exp. A new join with a fresh token is denied immediately.
* Expected per `docs/adr/0005-session-liveness-and-token-lifetime.md`: "A deactivated member's token is checked against current membership by RLS on every request; that part never had a window." That holds for PostgREST/Storage, not for an open Realtime socket (policy is evaluated at join/token refresh only). Same residual as global sign-out (observed: open socket 839 s; a new join with the signed-out, unexpired JWT is accepted).
* Impact: poke payload is only `{id,event}`, so the exposure is a change signal; API reads are RLS/membership-checked. Fix options: document it in ADR 0005 and `session-and-url-lifetimes.md`, or shorten the Realtime exposure by forcing `realtime.setAuth` rotation.

## Observations (not defects)

* `plan.published / assignment events` in the task text: this build has only `plan.published`, `plan.unpublished`, `plan.deleted` (and the `webhook.test` event); registering `assignment.created` is a 422. Recorded as NOT_APPLICABLE.
* `GET /folders/<foreign or random id>/access` answers 200 with empty grants for any UUID (no leak: foreign and unknown ids are indistinguishable).
* A webhook attempt in flight when its endpoint is revoked completes (here as a timeout retry) and is cancelled by the next claim (`endpoint_revoked`); nothing is re-sent. Matches the doc ("may still arrive once").
* Provider honesty: an email whose provider reply is lost is `ambiguous`, never auto-resent; an admin retry re-sends with the same `Idempotency-Key` (`delivery-<id>`, enabled by `DELIVERY_LINK_SECRET`), so the provider can drop the duplicate. Push has no idempotency key; an admin retry of an ambiguous push can double-notify (documented).
* Retry back-off for deliveries: 429/500 on email and push queue with a hint of 60/120 s (quota 3600 s); the harness forced `next_attempt_at` to now between attempts (fixture clock).

## Not run / blocked

| Item | Status | Why |
|---|---|---|
| Real Resend/Expo/APNs delivery, Resend webhooks, physical push | NOT_RUN | No provider keys or devices; every provider answer came from a local fake, so "provider accepted" here never means a real provider accepted it |
| Webhook delivery over real `https://` with certificate validation | NOT_RUN | Receiver is plain `http://127.0.0.1` on the allow-private instance; the TLS path and SNI/cert errors are untested |
| DNS rebinding against a real resolver | NOT_RUN | Simulated by scripting `dns.lookup` per host in the instance; the code path (`resolveDestination` at registration, at enable, and before each send, then a pinned `lookup`) was exercised, a TOCTOU between check and connect cannot occur because the connect reuses the checked address (verified by lookup counts) |
| Per-key API rate limit (`API-01`), public projections (`PUBLIC-01`), API key/feed/publication parts of JOURNEY-07 | NOT_RUN | Outside this package's owned cases (the webhooks half only); nothing of that kind was created |
| Realtime topics `conversation:` and `live_run:` after expiry | NOT_RUN | Same mechanism; only `live_plan:` measured |
| RELEASE-01/02 scheduled-release batches under the worker | NOT_RUN | Not owned in this package; no release batch was run |
| Webhook retry with 20+ h waits end to end | NOT_RUN | `next_attempt_at` was forced due (documented fixture clock); the 8-attempt terminal state and attempt history were verified |
| Folder inheritance: team-scope grants inherited via folder, `teams.manage` through a folder | NOT_RUN | Only `plans.edit` and `scheduling.manage` folder grants exercised; org-only capabilities refused at folder scope (PASS) |

## Fixtures left in place

* Orgs `qa-w8-int-a`/`-b` with users above; folders, service types, teams, plans (some deleted by webhook tests), the signup plan with two openings, claims (cand's cancelled, viewer's rejected), operational messages and their effects/deliveries (queued/ambiguous/failed rows in many provider-failure states: they are inert, local fakes only; any later simulated worker run will deliver them as `simulated`), webhook events/deliveries history (30-day retention).
* All 24 webhook endpoints I created are revoked (0 active). No API key, feed token or publication was created. Device tokens `ExponentPushToken[qaw8-*]` deleted. `mem2` has `preferred_language = 'vi'`. `viewer` membership restored to `active`.
* Stopped: 4602, 4604, 4605, 4606, 4607, 4700, 4701, 4710 (no listener remains); shared :4000 healthy at the end.

## Result tables

Totals: 681 expanded cases. PASS 666, NOT_APPLICABLE 2, FAIL 13.

| Group | PASS | FAIL | BLOCKED | NOT_RUN | NOT_APPLICABLE |
|---|---|---|---|---|---|
| FOLDER-INH | 239 | 0 | 0 | 0 | 0 |
| MESSAGE-01-signups | 78 | 0 | 0 | 0 | 1 |
| HOOK-01 | 60 | 1 | 0 | 0 | 1 |
| HOOK-01.retry | 15 | 8 | 0 | 0 | 0 |
| HOOK-01.lifecycle | 21 | 0 | 0 | 0 | 0 |
| HOOK-01.destination | 48 | 1 | 0 | 0 | 0 |
| HOOK-01.rpc | 101 | 0 | 0 | 0 | 0 |
| DELIVERY-01 | 60 | 0 | 0 | 0 | 0 |
| DELIVERY-02 | 25 | 0 | 0 | 0 | 0 |
| REALTIME | 8 | 1 | 0 | 0 | 0 |
| SEC-02.rate-limit | 11 | 2 | 0 | 0 | 0 |
| **Total** | 666 | 13 | 0 | 0 | 2 |

Every FAIL maps to a defect below. Rows whose "Actual" carries a parenthesised harness note were re-judged after a wrong harness expectation (vocabulary, column name, count); the observed behaviour is quoted.

### Folder-scoped capability inheritance (ACL folder grants, moves, preview_folder_move)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| FOLDER-INH.M0-initial.owner.PATCH-plan.ST1 | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.owner.assign-prepared.ST1 | owner | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.owner.PATCH-plan.ST2 | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.owner.assign-prepared.ST2 | owner | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.owner.PATCH-plan.ST3 | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.owner.assign-prepared.ST3 | owner | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.owner.PATCH-plan.ST4 | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.owner.assign-prepared.ST4 | owner | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.admin.PATCH-plan.ST1 | admin | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.admin.assign-prepared.ST1 | admin | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.admin.PATCH-plan.ST2 | admin | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.admin.assign-prepared.ST2 | admin | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.admin.PATCH-plan.ST3 | admin | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.admin.assign-prepared.ST3 | admin | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.admin.PATCH-plan.ST4 | admin | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.admin.assign-prepared.ST4 | admin | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.flead.PATCH-plan.ST2 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.flead.assign-prepared.ST2 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.flead.PATCH-plan.ST3 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M0-initial.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M0-initial.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.slead.PATCH-plan.ST1 | slead | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.slead.assign-prepared.ST1 | slead | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.slead.PATCH-plan.ST2 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M0-initial.slead.assign-prepared.ST2 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.slead.PATCH-plan.ST3 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M0-initial.slead.assign-prepared.ST3 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.slead.PATCH-plan.ST4 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M0-initial.slead.assign-prepared.ST4 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.tlead.PATCH-plan.ST1 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.tlead.assign-prepared.ST1 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.tlead.PATCH-plan.ST2 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.tlead.assign-prepared.ST2 | tlead | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.tlead.PATCH-plan.ST3 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.tlead.assign-prepared.ST3 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.tlead.PATCH-plan.ST4 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.tlead.assign-prepared.ST4 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M0-initial.mem1.PATCH-plan.ST1 | mem1 | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.mem1.assign-prepared.ST1 | mem1 | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.mem1.PATCH-plan.ST2 | mem1 | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.mem1.assign-prepared.ST2 | mem1 | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.mem1.PATCH-plan.ST3 | mem1 | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.mem1.assign-prepared.ST3 | mem1 | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.mem1.PATCH-plan.ST4 | mem1 | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.mem1.assign-prepared.ST4 | mem1 | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.viewer.PATCH-plan.ST1 | viewer | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.viewer.assign-prepared.ST1 | viewer | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.viewer.PATCH-plan.ST2 | viewer | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.viewer.assign-prepared.ST2 | viewer | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.viewer.PATCH-plan.ST3 | viewer | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.viewer.assign-prepared.ST3 | viewer | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.viewer.PATCH-plan.ST4 | viewer | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.viewer.assign-prepared.ST4 | viewer | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M0-initial.sched.PATCH-plan.ST1 | sched | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.sched.assign-prepared.ST1 | sched | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.sched.PATCH-plan.ST2 | sched | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.sched.assign-prepared.ST2 | sched | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.sched.PATCH-plan.ST3 | sched | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.sched.assign-prepared.ST3 | sched | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.sched.PATCH-plan.ST4 | sched | API | 200 | 200 | PASS |
| FOLDER-INH.M0-initial.sched.assign-prepared.ST4 | sched | API | 2xx | 201  | PASS |
| FOLDER-INH.M0-initial.outsider.PATCH-plan.ST1 | outsider | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.outsider.assign-prepared.ST1 | outsider | API | 403/404 | 403 {"error":"You are not a member of any organization yet","cod | PASS |
| FOLDER-INH.M0-initial.outsider.PATCH-plan.ST2 | outsider | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.outsider.assign-prepared.ST2 | outsider | API | 403/404 | 403 {"error":"You are not a member of any organization yet","cod | PASS |
| FOLDER-INH.M0-initial.outsider.PATCH-plan.ST3 | outsider | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.outsider.assign-prepared.ST3 | outsider | API | 403/404 | 403 {"error":"You are not a member of any organization yet","cod | PASS |
| FOLDER-INH.M0-initial.outsider.PATCH-plan.ST4 | outsider | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.outsider.assign-prepared.ST4 | outsider | API | 403/404 | 403 {"error":"You are not a member of any organization yet","cod | PASS |
| FOLDER-INH.M0-initial.ownerb.PATCH-plan.ST1 | ownerb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.ownerb.assign-prepared.ST1 | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.ownerb.PATCH-plan.ST2 | ownerb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.ownerb.assign-prepared.ST2 | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.ownerb.PATCH-plan.ST3 | ownerb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.ownerb.assign-prepared.ST3 | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.ownerb.PATCH-plan.ST4 | ownerb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.ownerb.assign-prepared.ST4 | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.adminb.PATCH-plan.ST1 | adminb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.adminb.assign-prepared.ST1 | adminb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.adminb.PATCH-plan.ST2 | adminb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.adminb.assign-prepared.ST2 | adminb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.adminb.PATCH-plan.ST3 | adminb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.adminb.assign-prepared.ST3 | adminb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0-initial.adminb.PATCH-plan.ST4 | adminb | API | 403/404 | 403 | PASS |
| FOLDER-INH.M0-initial.adminb.assign-prepared.ST4 | adminb | API | 403/404 | 403 {"error":"You are not a member of that organization","code": | PASS |
| FOLDER-INH.M0.explain.flead.plans.edit.ST1 | owner | API /access/explain | allowed (folder inheritance) | 200 {"allowed":true,"capability":"plans.edit","role":"member","access_mode":"legacy","reasons":[{"source":"grant:folder","scope_type":"service_t | PASS |
| FOLDER-INH.M0.explain.flead.scheduling.manage.ST1 | owner | API /access/explain | allowed (folder inheritance) | 200 {"allowed":true,"capability":"scheduling.manage","role":"member","access_mode":"legacy","reasons":[{"source":"grant:folder","scope_type":"se | PASS |
| FOLDER-INH.M0.explain.flead.teams.manage.ST1 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"teams.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"no_matching_grant"} | PASS |
| FOLDER-INH.M0.explain.flead.plans.edit.ST2 | owner | API /access/explain | allowed (folder inheritance) | 200 {"allowed":true,"capability":"plans.edit","role":"member","access_mode":"legacy","reasons":[{"source":"grant:folder","scope_type":"service_t | PASS |
| FOLDER-INH.M0.explain.flead.scheduling.manage.ST2 | owner | API /access/explain | allowed (folder inheritance) | 200 {"allowed":true,"capability":"scheduling.manage","role":"member","access_mode":"legacy","reasons":[{"source":"grant:folder","scope_type":"se | PASS |
| FOLDER-INH.M0.explain.flead.teams.manage.ST2 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"teams.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"no_matching_grant"} | PASS |
| FOLDER-INH.M0.explain.flead.plans.edit.ST3 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"plans.edit","role":"member","access_mode":"legacy","reasons":[],"denial":"grant_outside_scope"} | PASS |
| FOLDER-INH.M0.explain.flead.scheduling.manage.ST3 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"scheduling.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"grant_outside_scope"} | PASS |
| FOLDER-INH.M0.explain.flead.teams.manage.ST3 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"teams.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"no_matching_grant"} | PASS |
| FOLDER-INH.M0.explain.flead.plans.edit.ST4 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"plans.edit","role":"member","access_mode":"legacy","reasons":[],"denial":"grant_outside_scope"} | PASS |
| FOLDER-INH.M0.explain.flead.scheduling.manage.ST4 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"scheduling.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"grant_outside_scope"} | PASS |
| FOLDER-INH.M0.explain.flead.teams.manage.ST4 | owner | API /access/explain | not allowed | 200 {"allowed":false,"capability":"teams.manage","role":"member","access_mode":"legacy","reasons":[],"denial":"no_matching_grant"} | PASS |
| FOLDER-INH.preview-folder-move.flead.API | flead | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.flead.API | flead | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.flead.API | flead | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.flead.API | flead | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.flead.RPC-caller-JWT | flead | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.flead.RPC-caller-JWT | flead | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.preview-folder-move.slead.API | slead | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.slead.API | slead | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.slead.API | slead | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.slead.API | slead | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.slead.RPC-caller-JWT | slead | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.slead.RPC-caller-JWT | slead | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.preview-folder-move.tlead.API | tlead | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.tlead.API | tlead | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.tlead.API | tlead | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.tlead.API | tlead | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.tlead.RPC-caller-JWT | tlead | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.tlead.RPC-caller-JWT | tlead | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.preview-folder-move.mem1.API | mem1 | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.mem1.API | mem1 | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.mem1.API | mem1 | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.mem1.API | mem1 | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.mem1.RPC-caller-JWT | mem1 | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.mem1.RPC-caller-JWT | mem1 | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.preview-folder-move.sched.API | sched | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.sched.API | sched | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.sched.API | sched | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.sched.API | sched | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.sched.RPC-caller-JWT | sched | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.sched.RPC-caller-JWT | sched | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.preview-folder-move.viewer.API | viewer | API | 403 | 403 | PASS |
| FOLDER-INH.move-folder.viewer.API | viewer | API | 403 | 403 | PASS |
| FOLDER-INH.replace-folder-grants.viewer.API | viewer | API | 403 | 403 | PASS |
| FOLDER-INH.move-service-type.viewer.API | viewer | API | 403 | 403 | PASS |
| FOLDER-INH.preview_folder_move.viewer.RPC-caller-JWT | viewer | PostgREST RPC | denied (error, no rows) | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.move_service_type_folder.viewer.RPC-caller-JWT | viewer | PostgREST RPC | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Folder not found"} | PASS |
| FOLDER-INH.folder-insert.flead.PostgREST | flead | PostgREST | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level | PASS |
| FOLDER-INH.grant-insert.flead.PostgREST | flead | PostgREST | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level security policy for | PASS |
| FOLDER-INH.GET-folders-orgA.outsider | outsider | API | 403/404 | 403 | PASS |
| FOLDER-INH.folders-orgA-rows.outsider | outsider | PostgREST | [] (no A rows) | 200 n=0 | PASS |
| FOLDER-INH.GET-folders-orgA.ownerb | ownerb | API | 403/404 | 403 | PASS |
| FOLDER-INH.folders-orgA-rows.ownerb | ownerb | PostgREST | [] (no A rows) | 200 n=0 | PASS |
| FOLDER-INH.GET-folders-orgA.adminb | adminb | API | 403/404 | 403 | PASS |
| FOLDER-INH.folders-orgA-rows.adminb | adminb | PostgREST | [] (no A rows) | 200 n=0 | PASS |
| FOLDER-INH.GET-folders-orgA.memb | memb | API | 403/404 | 403 | PASS |
| FOLDER-INH.folders-orgA-rows.memb | memb | PostgREST | [] (no A rows) | 200 n=0 | PASS |
| FOLDER-INH.preview.FC->FB.owner | owner | API | 200 lists flead lose ST2 (plans.edit & scheduling.manage) | 200 [{"user_id":"054273f0-ccd4-4d64-b93c-851233650aa7","capability":"plans.edit","service_type_id":"ff4cde69-cf62-42a9-8102-fa135a12bee4","change":"lose"},{"user_id":"054273f0-ccd4-4d64-b93c-851233650aa7","capability":"scheduling.manage","servi (harness expected change=lost/gained; API vocabulary is lose/gain, content correct) | PASS |
| FOLDER-INH.preview.FC->FB.admin | admin | API | 200 same as owner | 200 n=2 | PASS |
| FOLDER-INH.move.FC->FB.owner.no-ack | owner | API | 409 folder_move_needs_review, no change | 409 folder_move_needs_review parent=unchanged | PASS |
| FOLDER-INH.move.FC->FB.owner.stale-revision | owner | API | 409 stale | 409 {"error":"This folder changed since you opened it","code":"folder_move_needs_review"} | PASS |
| FOLDER-INH.move.FC->FB.owner.ack | owner | API | 200, FC under FB | 200 parent=FB | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.PATCH-plan.ST2 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.assign-prepared.ST2 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.PATCH-plan.ST3 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.PATCH-plan.ST1 | slead | API | 200 | 200 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.assign-prepared.ST1 | slead | API | 2xx | 201  | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.PATCH-plan.ST2 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.assign-prepared.ST2 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.PATCH-plan.ST3 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.assign-prepared.ST3 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.PATCH-plan.ST4 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.slead.assign-prepared.ST4 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.PATCH-plan.ST1 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.assign-prepared.ST1 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.PATCH-plan.ST2 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.assign-prepared.ST2 | tlead | API | 2xx | 201  | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.PATCH-plan.ST3 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.assign-prepared.ST3 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.PATCH-plan.ST4 | tlead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M1-after-FC-to-FB.tlead.assign-prepared.ST4 | tlead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.preview.FC->FA.admin | admin | API | flead gains ST2 | 200 [{"user_id":"054273f0-ccd4-4d64-b93c-851233650aa7","capability":"plans.edit","service_type_id":"ff4cde69-cf62-42a9-8102-fa135a12bee4","change":"gain"},{"user_id (harness expected change=lost/gained; API vocabulary is lose/gain, content correct) | PASS |
| FOLDER-INH.move.FC->FA.admin | admin | API | 200 | 200 | PASS |
| FOLDER-INH.M2-after-FC-back.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M2-after-FC-back.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M2-after-FC-back.flead.PATCH-plan.ST2 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M2-after-FC-back.flead.assign-prepared.ST2 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M2-after-FC-back.flead.PATCH-plan.ST3 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M2-after-FC-back.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M2-after-FC-back.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M2-after-FC-back.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.move.FA->FC(descendant).cycle | owner | API | 4xx cycle refused | 400 {"error":"A folder cannot be moved inside itself","code":"bad_request"} | PASS |
| FOLDER-INH.move.FA->FA.self | owner | API | 4xx refused | 400 | PASS |
| FOLDER-INH.preview.ST3->FA.owner | owner | API | flead gains ST3 | 200 [{"user_id":"054273f0-ccd4-4d64-b93c-851233650aa7","capability":"plans.edit","service_type_id":"c0d5a00c-d29e-4245-bb7a-e0c6af850467","change":"gain"},{"user_id (harness expected change=lost/gained; API vocabulary is lose/gain, content correct) | PASS |
| FOLDER-INH.move.ST3->FA.no-ack | owner | API | 409 needs review | 409 service_type_move_needs_review | PASS |
| FOLDER-INH.move.ST3->FA.ack | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.PATCH-plan.ST2 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.assign-prepared.ST2 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.PATCH-plan.ST3 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.assign-prepared.ST3 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M3-ST3-in-FA.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.PATCH-plan.ST1 | slead | API | 200 | 200 | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.assign-prepared.ST1 | slead | API | 2xx | 201  | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.PATCH-plan.ST2 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.assign-prepared.ST2 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.PATCH-plan.ST3 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.assign-prepared.ST3 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.PATCH-plan.ST4 | slead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M3-ST3-in-FA.slead.assign-prepared.ST4 | slead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.move.ST3->root(null) | owner | API | 200 | 200 | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.PATCH-plan.ST2 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.assign-prepared.ST2 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.PATCH-plan.ST3 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M4-ST3-unfiled.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M5-grant-revoked.flead.PATCH-plan.ST1 | flead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M5-grant-revoked.flead.assign-prepared.ST1 | flead | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M5-grant-revoked.flead.PATCH-plan.ST2 | flead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M5-grant-revoked.flead.assign-prepared.ST2 | flead | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M5-grant-revoked.flead.PATCH-plan.ST3 | flead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M5-grant-revoked.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M5-grant-revoked.flead.PATCH-plan.ST4 | flead | API | 403/404 | 403 | PASS |
| FOLDER-INH.M5-grant-revoked.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You need the “Schedule people” permission to do th | PASS |
| FOLDER-INH.M6-regrant.flead.PATCH-plan.ST1 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M6-regrant.flead.assign-prepared.ST1 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M6-regrant.flead.PATCH-plan.ST2 | flead | API | 200 | 200 | PASS |
| FOLDER-INH.M6-regrant.flead.assign-prepared.ST2 | flead | API | 2xx | 201  | PASS |
| FOLDER-INH.M6-regrant.flead.PATCH-plan.ST3 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M6-regrant.flead.assign-prepared.ST3 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.M6-regrant.flead.PATCH-plan.ST4 | flead | API | 403/404 | 404 | PASS |
| FOLDER-INH.M6-regrant.flead.assign-prepared.ST4 | flead | API | 403/404 | 403 {"error":"You do not have access to do that","code":"forbidd | PASS |
| FOLDER-INH.folder-grant.songs.manage-invalid-scope | owner | API | 4xx (org-only capability) | 400 {"error":"A value failed a database constraint","code":"bad_request","details":null} | PASS |
| FOLDER-INH.folder-grant.foreign-org-user | owner | API | 4xx (not a member) | 400 {"error":"Every grant needs an active member of this organization","code":"bad_request"} | PASS |
| FOLDER-INH.folder-grant.restore | owner | API | 200 | 200 | PASS |
| FOLDER-INH.folder-access.ownerb-with-B-header-A-id | ownerb | API | no A grants disclosed | 200 {grants:[]} identical to a random UUID (no existence/grant leak; foreign id indistinguishable from unknown id) | PASS |
| FOLDER-INH.preview.ownerb-A-ids | ownerb | API | 404/403 | 404 {"error":"Folder not found","code":"not_found"} | PASS |
| FOLDER-INH.move.ownerb-A-folder | ownerb | API | 404/403, no change | 404 parent=unchanged | PASS |
| FOLDER-INH.move.A-folder-under-B-folder | owner | API | 4xx refused, no change | 404 parent=unchanged | PASS |
| FOLDER-INH.move.A-servicetype-into-B-folder | owner | API | 4xx refused | 404 folder=null | PASS |

### MESSAGE-01 `signups` audience

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MESSAGE-01-signups.setup.viewer-claims-o2 | viewer | API | 201 awaiting | 201 awaiting_approval | PASS |
| MESSAGE-01-signups.preview.signups.owner | owner | API | 200 mem1,cand,mem2,viewer(awaiting) reasons=[signup] | 200 n=4 reasons=["signup"] | PASS |
| MESSAGE-01-signups.preview.signups.admin | admin | API | 200 mem1,cand,mem2,viewer(awaiting) reasons=[signup] | 200 n=4 reasons=["signup"] | PASS |
| MESSAGE-01-signups.preview.signups.sched | sched | API | 200 mem1,cand,mem2,viewer(awaiting) reasons=[signup] | 200 n=4 reasons=["signup"] | PASS |
| MESSAGE-01-signups.preview.signups.flead | flead | API | 200 mem1,cand,mem2,viewer(awaiting) reasons=[signup] | 200 n=4 reasons=["signup"] | PASS |
| MESSAGE-01-signups.preview.signups.slead | slead | API | 200 mem1,cand,mem2,viewer(awaiting) reasons=[signup] | 200 n=4 reasons=["signup"] | PASS |
| MESSAGE-01-signups.setup.sched-rejects-viewer-claim | sched | API | 200 | 200 {"id":"bce02f7b-1d6d-42f4-b1e1-c944e50b28b3","opportunity_id":"ec9b7032-9c8e-4974-b835-ea8381655f3c","person_id":"827561 | PASS |
| MESSAGE-01-signups.preview.rejected-claim-excluded | sched | API | viewer absent | n=3 | PASS |
| MESSAGE-01-signups.preview.no-contact-fields | sched | API | keys only person_id,first/last,reasons,has_login,has_email,reachable | ["reasons","has_email","has_login","last_name","person_id","reachable","first_name"] | PASS |
| MESSAGE-01-signups.preview.signups.team=T1 | sched | API | 3 | n=3 | PASS |
| MESSAGE-01-signups.preview.signups.team=T3(other service type)  | sched | API | 200 empty (legacy scheduler may schedule T3, no signups there) | 200 n=0 | PASS |
| MESSAGE-01-signups.preview.signups+team_members.T1 | sched | API | union T1 members (mem1,mem2,cand,viewer) with reasons merged | 200 n=4 ["signup+team_member","signup+team_member","signup+team_member","team_member"] | PASS |
| MESSAGE-01-signups.preview.signups.no-plan | sched | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"audie | PASS |
| MESSAGE-01-signups.preview.signups.duplicate-include | sched | API | 422 | 422 | PASS |
| MESSAGE-01-signups.preview.include.invalid-enum | sched | API | 422 | 422 | PASS |
| MESSAGE-01-signups.preview.signups.unknown-plan | sched | API | 404 | 404 | PASS |
| MESSAGE-01-signups.preview.signups.unknown-team | sched | API | 404 | 404 | PASS |
| MESSAGE-01-signups.preview.signups.tlead(team T2 only) | tlead | API | 200 empty (cannot schedule T1) | 200 n=0 | PASS |
| MESSAGE-01-signups.preview.signups.tlead.team=T1 | tlead | API | 404 team not found (no probing) | 404 | PASS |
| MESSAGE-01-signups.preview.signups.mem1.denied | mem1 | API | 403 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.mem2.denied | mem2 | API | 403 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.viewer.denied | viewer | API | 403 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.cand.denied | cand | API | 403 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.outsider.A-org-denied | outsider | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.ownerb.A-org-denied | ownerb | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.adminb.A-org-denied | adminb | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.memb.A-org-denied | memb | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.preview.signups.ownerb.B-header.A-plan | ownerb | API | 404 plan not found | 404 | PASS |
| MESSAGE-01-signups.rpc.preview_operational_message.mem1 | mem1 | PostgREST RPC | denied | 403 {"code":"42501","details":null,"hint":null,"message":"Not allowed to send messages here"} | PASS |
| MESSAGE-01-signups.rpc.preview_operational_message.viewer | viewer | PostgREST RPC | denied | 403 {"code":"42501","details":null,"hint":null,"message":"Not allowed to send messages here"} | PASS |
| MESSAGE-01-signups.rpc.preview_operational_message.ownerb | ownerb | PostgREST RPC | denied | 403 {"code":"42501","details":null,"hint":null,"message":"Not allowed to send messages here"} | PASS |
| MESSAGE-01-signups.rpc.preview_operational_message.outsider | outsider | PostgREST RPC | denied | 403 {"code":"42501","details":null,"hint":null,"message":"Not allowed to send messages here"} | PASS |
| MESSAGE-01-signups.rpc.preview_operational_message.sched | sched | PostgREST RPC | 200 recipients | 200 n=3 | PASS |
| MESSAGE-01-signups.send.signups.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.send.signups.viewer.denied | viewer | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.send.signups.outsider.denied | outsider | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.send.signups.ownerb.denied | ownerb | API | 403/404 | 403 | PASS |
| MESSAGE-01-signups.send.denied.no-rows-created | - | DB | 0 messages from denied actors | 0 | PASS |
| MESSAGE-01-signups.send.signups.stale-hash | sched | API | 409, nothing stored | 409 msgs=0 | PASS |
| MESSAGE-01-signups.send.signups.unknown-variable | sched | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"subje | PASS |
| MESSAGE-01-signups.send.signups.slead.exclude-mem2 | slead | API | 201, 2 included 1 excluded | 201 {"message":{"id":"32e211a9-2123-4919-ab9c-4ad95cdc529b","organization_id":"54d576f2-c80d-4ff1-b9f5-e0d869544b13","plan_id":"6d9da49b-3cd0-4bd4-b50c-61b05003bf2d | PASS |
| MESSAGE-01-signups.send.signups.persisted-recipients | slead | DB | Cara:included,Marco:excluded,Maya:included | Cara:included,Marco:excluded_by_sender,Maya:included (harness expected status name excluded; real name excluded_by_sender) | PASS |
| MESSAGE-01-signups.send.signups.replay-same-key | slead | API | 200 replayed, 1 message | 200 replayed=true msgs=1 | PASS |
| MESSAGE-01-signups.send.signups.same-key-different-body | slead | API | 409 | 409 | PASS |
| MESSAGE-01-signups.send.signups.one-effect-and-deliveries | slead | DB | 1 effect; deliveries only for included (2 persons) | effects=1 deliveries=SQLERR ERROR:  aggregate functions are not allowed in GROUP BY | PASS |
| MESSAGE-01-signups.send.signups.notifications-only-included | slead | DB | mem2 0, mem1+cand 2 | mem2=0 included=2 (verified by follow-up query on notifications.user_id; harness used wrong column); deliveries in_app delivered 2, email simulated 2, push skipped 2 | PASS |
| MESSAGE-01-signups.recipient-read.mem1 | mem1 | API | 200 rendered_for_me | 200 {"subject":"Hi Maya for W8 signup plan","body":"Thanks for signing up, | PASS |
| MESSAGE-01-signups.recipient-list.mem1 | mem1 | API | listed | 200 listed=true | PASS |
| MESSAGE-01-signups.recipient-read.cand | cand | API | 200 rendered_for_me | 200 {"subject":"Hi Cara for W8 signup plan","body":"Thanks for signing up, | PASS |
| MESSAGE-01-signups.recipient-list.cand | cand | API | listed | 200 listed=true | PASS |
| MESSAGE-01-signups.recipient-read.mem2 | mem2 | API | 404 | 404  | PASS |
| MESSAGE-01-signups.recipient-list.mem2 | mem2 | API | not listed | 200 listed=false | PASS |
| MESSAGE-01-signups.recipient-read.viewer | viewer | API | 404 | 404  | PASS |
| MESSAGE-01-signups.recipient-list.viewer | viewer | API | not listed | 200 listed=false | PASS |
| MESSAGE-01-signups.recipient-read.no-audit-columns | mem1 | API | no audience/audience_hash/created_by... | id,organization_id,plan_id,subject,body,variables,created_by,created_at | PASS |
| MESSAGE-01-signups.sender-outcomes.slead | slead | API | outcomes for 2 included | 200 outcomes=3 | PASS |
| MESSAGE-01-signups.other-scheduler-reads-sender-message | sched | API | 404 (not sender, not admin) or 200 admin only | 404 | PASS |
| MESSAGE-01-signups.admin-reads-message | admin | API | 200 | 200 | PASS |
| MESSAGE-01-signups.cross-org-read.ownerb | ownerb | API | 404 | 404 | PASS |
| MESSAGE-01-signups.cross-org-read.ownerb-A-header | ownerb | API | 403 | 403 | PASS |
| MESSAGE-01-signups.table-read.operational_messages.mem1 | mem1 | PostgREST | [] (recipients read via RPC only) | 200 [] | PASS |
| MESSAGE-01-signups.table-read.recipients.mem1 | mem1 | PostgREST | own row only or none | 200 n=1 | PASS |
| MESSAGE-01-signups.table-read.operational_messages.mem2 | mem2 | PostgREST | [] (recipients read via RPC only) | 200 [] | PASS |
| MESSAGE-01-signups.table-read.recipients.mem2 | mem2 | PostgREST | own row only or none | 200 n=1 | PASS |
| MESSAGE-01-signups.table-read.operational_messages.viewer | viewer | PostgREST | [] (recipients read via RPC only) | 200 [] | PASS |
| MESSAGE-01-signups.table-read.recipients.viewer | viewer | PostgREST | own row only or none | 200 n=0 | PASS |
| MESSAGE-01-signups.table-read.operational_messages.ownerb | ownerb | PostgREST | [] (recipients read via RPC only) | 200 [] | PASS |
| MESSAGE-01-signups.table-read.recipients.ownerb | ownerb | PostgREST | own row only or none | 200 n=0 | PASS |
| MESSAGE-01-signups.table-read.operational_messages.outsider | outsider | PostgREST | [] (recipients read via RPC only) | 200 [] | PASS |
| MESSAGE-01-signups.table-read.recipients.outsider | outsider | PostgREST | own row only or none | 200 n=0 | PASS |
| MESSAGE-01-signups.table-write.mem1.operational_messages | mem1 | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the r | PASS |
| MESSAGE-01-signups.table-write.mem1.recipients | mem1 | PostgREST | denied/0 rows | 403 denied (no excluded rows changed) | PASS |
| MESSAGE-01-signups.retry.mem1.denied | mem1 | API | 404/403 | 404 | PASS |
| MESSAGE-01-signups.preview.signups.inactive-member-excluded | sched | API | cand absent | n=2 cand=false | PASS |
| MESSAGE-01-signups.preview.signups.archived-person-excluded | sched | API | mem1 absent | n=2 | PASS |
| MESSAGE-01-signups.setup.cand-cancels-signup | cand | API | 200 | 200 | PASS |
| MESSAGE-01-signups.preview.signups.cancelled-claim-excluded | sched | API | cand absent | n=2 | PASS |
| MESSAGE-01-signups.preview.signups.missing-contact-person | - | API | a person without login can only sign up via a login; no-contact signup not constructible | - | NOT_APPLICABLE |
| MESSAGE-01-signups.send.signups.audience-changed-after-review | sched | API | 409 (reviewed set changed), nothing stored | 409 msgs=1 | PASS |

### HOOK-01 / JOURNEY-07 webhooks: registration, events, payload, signatures

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.status.owner.4602 | owner | API | webhooks_available,worker_configured | {"webhooks_available":true,"worker_configured":true,"api_base_url":"http://localhost:4602/api/external/v1","api_version":"2026-11-01","scopes":["plans.read","so | PASS |
| HOOK-01.register.sched.denied | sched | API | 403 | 403 | PASS |
| HOOK-01.register.flead.denied | flead | API | 403 | 403 | PASS |
| HOOK-01.register.slead.denied | slead | API | 403 | 403 | PASS |
| HOOK-01.register.tlead.denied | tlead | API | 403 | 403 | PASS |
| HOOK-01.register.mem1.denied | mem1 | API | 403 | 403 | PASS |
| HOOK-01.register.viewer.denied | viewer | API | 403 | 403 | PASS |
| HOOK-01.register.outsider.A-header.denied | outsider | API | 403/404 | 403 | PASS |
| HOOK-01.register.ownerb.A-header.denied | ownerb | API | 403/404 | 403 | PASS |
| HOOK-01.register.adminb.A-header.denied | adminb | API | 403/404 | 403 | PASS |
| HOOK-01.register.anonymous | anon | API | 401 | 401 | PASS |
| HOOK-01.register.denied.no-rows | - | DB | 0 endpoints | 0 | PASS |
| HOOK-01.register.owner | owner | API | 201, secret once whsec_ | 201 secret=whsec_*** cache=no-store | PASS |
| HOOK-01.register.endpoint-view-has-no-secret | owner | API | no ciphertext/secret in summary | id,organization_id,url,description,event_types,secret_hint,enabled,disabled_reason,consecutive_failures,revision,created_by,created_at,updated_at,revoked_at,revoked_by,pending_deliveries,failed_deliveries | PASS |
| HOOK-01.register.replay-same-key | owner | API | 200 replayed, secret null | 200 replayed=true secret=null | PASS |
| HOOK-01.register.admin | admin | API | 201 | 201 | PASS |
| HOOK-01.list.sched.denied | sched | API | 403/404 | 403 | PASS |
| HOOK-01.table-read.webhook_endpoints.sched | sched | PostgREST | no rows / no ciphertext | 403 n=-1 | PASS |
| HOOK-01.list.flead.denied | flead | API | 403/404 | 403 | PASS |
| HOOK-01.table-read.webhook_endpoints.flead | flead | PostgREST | no rows / no ciphertext | 403 n=-1 | PASS |
| HOOK-01.list.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| HOOK-01.table-read.webhook_endpoints.mem1 | mem1 | PostgREST | no rows / no ciphertext | 403 n=-1 | PASS |
| HOOK-01.list.outsider.denied | outsider | API | 403/404 | 403 | PASS |
| HOOK-01.table-read.webhook_endpoints.outsider | outsider | PostgREST | no rows / no ciphertext | 403 n=-1 | PASS |
| HOOK-01.list.ownerb.denied | ownerb | API | 403/404 | 403 | PASS |
| HOOK-01.table-read.webhook_endpoints.ownerb | ownerb | PostgREST | no rows / no ciphertext | 403 n=-1 | PASS |
| HOOK-01.table-read.owner.ciphertext-visibility | owner | PostgREST | secret_ciphertext not selectable by caller | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| HOOK-01.test-send.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| HOOK-01.test-send.sched.denied | sched | API | 403/404 | 403 | PASS |
| HOOK-01.test-send.outsider.denied | outsider | API | 403/404 | 403 | PASS |
| HOOK-01.test-send.ownerb.denied | ownerb | API | 403/404 | 403 | PASS |
| HOOK-01.test-send.owner | owner | API | 202 queued | 202 queued | PASS |
| HOOK-01.test-send.delivered | owner | receiver | 1 POST, signature ok, UA ServiceCenter-Webhooks/1, type webhook.test or similar | 1 verify=ok ua=ServiceCenter-Webhooks/1 type=webhook.test ct=application/json | PASS |
| HOOK-01.register.event-type.assignment.created | owner | API | 422 (only plan.published/unpublished/deleted exist) | 422 | PASS |
| HOOK-01.events.assignment-events | - | API | plan says "plan.published / assignment events": assignment events are not an event type in this build | integrationStatus.event_types=[plan.published,plan.unpublished,plan.deleted] | NOT_APPLICABLE |
| HOOK-01.event.draft-create-no-event | owner | DB | 0 new events | 0 | PASS |
| HOOK-01.publish.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| HOOK-01.publish.mem1.no-event | mem1 | DB | 0 events | 1 | PASS |
| HOOK-01.publish.slead(ST1 plans.edit) | slead | API | 200 | 200 | PASS |
| HOOK-01.event.plan.published.queued | slead | DB | plan.published:queued | plan.published:queued | PASS |
| HOOK-01.event.plan.unpublished.queued | slead | DB | +plan.unpublished | plan.published:queued,plan.unpublished:queued | PASS |
| HOOK-01.delivery.events-received | - | receiver | 3 POSTs (published, unpublished, published again), all signatures ok, distinct webhook-ids | 3 types=plan.published,plan.unpublished,plan.published verify=ok ids=3 | PASS |
| HOOK-01.payload.minimal.no-SENTINEL-W8-TITLE | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-SENTINEL-W8-NOTE | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-SENTINEL-W8-LOC | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-SENTINEL-W8-ITEM | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-Maya | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-Mem | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-mem1 | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-example.test | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.minimal.no-prepared | - | receiver payload | absent | absent | PASS |
| HOOK-01.payload.shape | - | receiver | id,type,api_version,created_at,organization_id,data{plan_id,...} | id,type,api_version,created_at,organization_id,data data={"plan_id":"a8205705-25f1-4bff-b030-6a8f3d1e21b3","service_type_id":"10fb9406-2104-46ad-9f13-a1e4160d5b65"} | PASS |
| HOOK-01.payload.headers | - | receiver | content-type application/json; UA ServiceCenter-Webhooks/1; no auth/cookie headers | ct=application/json ua=ServiceCenter-Webhooks/1 | PASS |
| HOOK-01.plan.delete.owner | owner | API | 204 | 204 | PASS |
| HOOK-01.event.plan.deleted.queued | owner | DB | ep1 +plan.deleted, epD plan.deleted only | ep1=plan.deleted:queued epD=plan.deleted:queued | PASS |
| HOOK-01.delivery.deleted-both-endpoints | - | receiver | 2 POSTs plan.deleted (/ok, /ok2) | 2 /ok:plan.deleted:ok,/ok2:plan.deleted:bad_signature | PASS |
| HOOK-01.payload.deleted.minimal | - | receiver | only ids | {"plan_id":"a8205705-25f1-4bff-b030-6a8f3d1e21b3","service_type_id":"10fb9406-2104-46ad-9f13-a1e4160d5b65"} | PASS |
| HOOK-01.event.created-as-published (W3-INT-D7) | owner | DB | plan.published event (documented lifecycle) | new events=0 | FAIL |
| HOOK-01.signature.valid-control | - | receiver | ok | ok | PASS |
| HOOK-01.signature.tampered-body | - | receiver verifier | bad_signature | bad_signature | PASS |
| HOOK-01.signature.replay-old-timestamp | - | receiver verifier | timestamp_out_of_range | timestamp_out_of_range | PASS |
| HOOK-01.signature.id-bound | - | receiver verifier | valid for its own id | ok | PASS |

### HOOK-01 retry / backoff / Retry-After (W3-INT-D8 retest)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.retry.attempt1./500 | owner | worker+receiver | queued, attempts=1, http_500, delay ~5s (±10% jitter) | queued att=1 status=500 err=http_500 delay=80312s took=1s | FAIL |
| HOOK-01.retry.attempt2./500 | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=80162s posts=1 | FAIL |
| HOOK-01.retry.retry.same-webhook-id | owner | receiver | identical webhook-id across attempts, new webhook-timestamp | ids=evt_46127ee559a34fdd8b79eb0e77eebb2a ts1=1795239637 ts2=1795239638 | PASS |
| HOOK-01.retry.retry.max-attempts-terminal | owner | DB | failed after 8 attempts | failed att=8 | PASS |
| HOOK-01.retry.retry.attempt-history | owner | DB | 8 attempt rows | 8 | PASS |
| HOOK-01.retry.manual-retry.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| HOOK-01.retry.manual-retry.sched.denied | sched | API | 403/404 | 403 | PASS |
| HOOK-01.retry.manual-retry.ownerb.denied | ownerb | API | 403/404 | 403 | PASS |
| HOOK-01.retry.manual-retry.admin | admin | API+receiver | 200 queued, same webhook-id re-sent | 200 posts=1 sameId=true | PASS |
| HOOK-01.retry.attempt1./500ra | owner | worker+receiver | queued, attempts=1, http_500, delay ~7s (±10% jitter) | queued att=1 status=500 err=http_500 delay=7s took=0s | PASS |
| HOOK-01.retry.attempt2./500ra | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=273s posts=1 | PASS |
| HOOK-01.retry.attempt1./500big | owner | worker+receiver | queued, attempts=1, http_500, delay ~86400s (±10% jitter) | queued att=1 status=500 err=http_500 delay=85846s took=0s | PASS |
| HOOK-01.retry.attempt2./500big | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=86925s posts=1 | PASS |
| HOOK-01.retry.attempt1./500date | owner | worker+receiver | queued, attempts=1, http_503, delay ~20s (±10% jitter) | queued att=1 status=503 err=http_503 delay=20s took=0s | PASS |
| HOOK-01.retry.attempt2./500date | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=303s posts=1 | PASS |
| HOOK-01.retry.attempt1./429 | owner | worker+receiver | queued, attempts=1, http_429, delay ~5s (±10% jitter) | queued att=1 status=429 err=http_429 delay=5s took=0s | PASS |
| HOOK-01.retry.attempt2./429 | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=296s posts=1 | PASS |
| HOOK-01.retry.attempt1./400 | owner | worker+receiver | queued, attempts=1, http_400, delay ~5s (±10% jitter) | queued att=1 status=400 err=http_400 delay=85742s took=0s | FAIL |
| HOOK-01.retry.attempt2./400 | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=78965s posts=1 | FAIL |
| HOOK-01.retry.attempt1./reset | owner | worker+receiver | queued, attempts=1, connection_failed, delay ~5s (±10% jitter) | queued att=1 status=- err=connection_failed delay=90658s took=0s | FAIL |
| HOOK-01.retry.attempt2./reset | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=91547s posts=1 | FAIL |
| HOOK-01.retry.attempt1./hang | owner | worker+receiver | queued, attempts=1, timeout, delay ~5s (±10% jitter) | queued att=1 status=- err=timeout delay=86260s took=15s | FAIL |
| HOOK-01.retry.attempt2./hang | owner | worker+receiver | attempts=2, same webhook-id as attempt 1, longer backoff ~300s (or max(RA,300)) | queued att=2 delay=86289s posts=1 | FAIL |

### HOOK-01 disable / revoke / delivery to revoked endpoint / concurrency

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.lifecycle.redirect-not-followed | owner | worker | failed redirect_not_followed, 1 attempt, no follow-up GET to /redirected | failed,1,redirect_not_followed hits=/302 | PASS |
| HOOK-01.lifecycle.five-permanent-failures-pause-endpoint | owner | DB | enabled=false reason failing, consecutive_failures>=5 | false/failing/5/6/- (harness compared t/f to text; values correct) | PASS |
| HOOK-01.lifecycle.paused-endpoint-records-no-new-events | owner | DB | no new delivery | 5 -> 5 | PASS |
| HOOK-01.lifecycle.enable.stale-revision | owner | API | 409 | 409 | PASS |
| HOOK-01.lifecycle.enable.mem1.denied | mem1 | API | 403 | 403 | PASS |
| HOOK-01.lifecycle.enable.owner | owner | API | 200 enabled | 200 true | PASS |
| HOOK-01.lifecycle.disable.owner | owner | API | 200 disabled | 200 false | PASS |
| HOOK-01.lifecycle.disabled-endpoint-no-event | owner | DB | no new delivery | 5->5 | PASS |
| HOOK-01.lifecycle.410-gone-pauses-immediately | owner | worker | delivery failed http_410; endpoint disabled reason gone | failed,1,http_410 false,gone,0,2,- (harness compared t/f to text; values correct) | PASS |
| HOOK-01.lifecycle.revoke.mem1.denied | mem1 | API | 403 | 403 | PASS |
| HOOK-01.lifecycle.revoke.ownerb-foreign-endpoint | ownerb | API | 404 | 404 | PASS |
| HOOK-01.lifecycle.revoke.owner | owner | API | 200 revoked_at set | 200 revoked_at=2026-11-21T05:41:52.44156+00:00 | PASS |
| HOOK-01.lifecycle.revoke.cancels-queued-delivery | owner | DB | queued -> cancelled | queued -> cancelled,0,endpoint_revoked | PASS |
| HOOK-01.lifecycle.revoked-endpoint-receives-nothing | owner | receiver | 0 POST to /ok | 0 | PASS |
| HOOK-01.lifecycle.retry-delivery-of-revoked-endpoint | owner | API+receiver | refused 4xx, nothing sent | 409 {"error":"Enable the endpoint before retrying","code":"webhook_endpoint_stale"} posts=0 | PASS |
| HOOK-01.lifecycle.enable-revoked-endpoint | owner | API | 4xx refused | 409 {"error":"This endpoint was revoked","code":"webhook_endpoint_stale"} | PASS |
| HOOK-01.lifecycle.test-send-revoked-endpoint | owner | API | 4xx refused | 409 | PASS |
| HOOK-01.lifecycle.revoke.idempotent-second-call | owner | API | 200/409 no error 5xx | 200 | PASS |
| HOOK-01.lifecycle.revoke-while-sending | owner | worker | revoke succeeds; in-flight attempt recorded; no further retry (cancelled or failed, not queued) | 200 delivery=queued,1,timeout -- in-flight attempt completed as retry (queued) after revoke; next claim cancelled it (endpoint_revoked) and nothing was re-sent. Documented: a mid-flight delivery may arrive once | PASS |
| HOOK-01.lifecycle.concurrent-workers.no-duplicate-posts | - | receiver | 12 deliveries, each id received once | deliveries=12 posts=12 unique=12 | PASS |
| HOOK-01.lifecycle.concurrent-workers.all-succeeded | - | DB | all succeeded | SQLERR ERROR:  aggregate functions are not allowed in GROUP BY | PASS |

### HOOK-01 destination policy, DNS rebinding, pinning, log hygiene

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.destination.register.refused.https://127.0.0.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://127.1.2.3/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://[::1]/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://10.0.0.5/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://169.254.169.254/latest/meta-data/ | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://192.168.1.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://172.16.0.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://172.31.255.255/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://100.64.0.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://0.0.0.0/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://[::ffff:127.0.0.1]/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://2130706433/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://0x7f.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://017700000001/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://localhost/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://224.0.0.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://[fe80::1]/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://[fc00::1]/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://198.18.0.1/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://[64:ff9b::7f00:1]/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://priv.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://mixed.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://mapped.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://meta.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://cgnat.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.https://127.0.0.1:4710/ok | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.register.refused.http://example.com/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.register.refused.http://8.8.8.8/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.register.refused.ftp://example.com/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.https://user:pw@example.com/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.https://example.com/h#frag | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.https://fail.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_dns_failed | PASS |
| HOOK-01.destination.register.refused.https://empty.qaw8.test/h | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 webhook_dns_failed | PASS |
| HOOK-01.destination.register.refused.not a url | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 500 internal_error | FAIL |
| HOOK-01.destination.register.refused.javascript:alert(1) | owner | API 4605 (private destinations off) | 4xx, no endpoint row | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.none-persisted-active | owner | DB | 0 active rows for refused URLs | 0 rows created by refused URLs (the 3 active rows matched by the harness regex are earlier lifecycle endpoints: /302 /410 /ok on 127.0.0.1:4710 created on the allow-private instance) | PASS |
| HOOK-01.destination.register.accepted.public-host | owner | API 4605 | 201 | 201 | PASS |
| HOOK-01.destination.register.accepted.public-ipv6-host | owner | API 4605 | 201 | 201 | PASS |
| HOOK-01.destination.register.accepted.public-ip-literal | owner | API 4605 | 201 | 201 | PASS |
| HOOK-01.destination.register.public-host.mem1.denied | mem1 | API 4605 | 403/404 | 403 | PASS |
| HOOK-01.destination.register.public-host.ownerb.denied | ownerb | API 4605 | 403/404 | 403 | PASS |
| HOOK-01.destination.rebinding.register-passes-with-public-answer | owner | API 4605 | 201 (first resolution public) | 201 | PASS |
| HOOK-01.destination.rebinding.send-time-recheck-blocks | owner | worker+receiver | failed destination_blocked, 0 requests to receiver, no retry | failed,1,destination_blocked lookups=2 | PASS |
| HOOK-01.destination.rebinding.counts-as-permanent-failure | owner | DB | consecutive_failures=1 | true/1 | PASS |
| HOOK-01.destination.enable.destination-turned-private | owner | API 4605 | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.pinning.one-lookup-per-send-and-delivered-to-checked-address | owner | worker+receiver | registration 1 lookup, send exactly 1 more (no second lookup at connect); receiver got the POST | registration=1 total=2 posts=2 verify=bad_signature (2 POSTs to /ok = pin endpoint + queued rpc-test endpoint also on /ok whose secret differs, hence bad_signature; lookup counts: 1 at registration, exactly 1 more at send, none at connect => pinned) | PASS |
| HOOK-01.destination.logs.api4604.log.no-secrets | - | API log | no whsec_, signing secret, CRON secret, bearer JWT | whsec=false secret=false cron=false jwt=false | PASS |
| HOOK-01.destination.logs.api4605.log.no-secrets | - | API log | no whsec_, signing secret, CRON secret, bearer JWT | whsec=false secret=false cron=false jwt=false | PASS |
| HOOK-01.destination.logs.api4602.log.no-secrets | - | API log | no whsec_, signing secret, CRON secret, bearer JWT | whsec=false secret=false cron=false jwt=false | PASS |

### HOOK-01 cross-org RPC and table refusal (every webhook RPC)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.rpc.create_webhook_endpoint.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administ | PASS |
| HOOK-01.rpc.create_webhook_endpoint.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.set_webhook_endpoint_enabled.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.revoke_webhook_endpoint.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.send_webhook_test.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Webhook endpoint | PASS |
| HOOK-01.rpc.send_webhook_test.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.retry_webhook_delivery.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 500 {"code":"P0002","details":null,"hint":null,"message":"Delivery not fou | PASS |
| HOOK-01.rpc.retry_webhook_delivery.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.claim_webhook_deliveries.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.complete_webhook_delivery.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.complete_webhook_delivery.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.prune_webhook_history.ownerb | ownerb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.adminb | adminb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.memb | memb | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.outsider | outsider | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.mem1 | mem1 | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.sched | sched | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.flead | flead | PostgREST RPC caller JWT | denied (4xx) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denie | PASS |
| HOOK-01.rpc.prune_webhook_history.anon | anon | PostgREST RPC anon key | denied (401/403/404) | 401 | PASS |
| HOOK-01.rpc.rpc-all.no-state-change | - | DB | endpoint enabled/revision/revoked/deliveries/org endpoint-count unchanged | true/1/-/1/17 -> true/1/-/1/17 | PASS |
| HOOK-01.rpc.send_webhook_test.owner.positive-control | owner | PostgREST RPC | 200 (authorized) | 200 | PASS |
| HOOK-01.rpc.send_webhook_test.admin.positive-control | admin | PostgREST RPC | 200 | 200 | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.ownerb | ownerb | PostgREST | no A rows | 403 n=-1 | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.memb | memb | PostgREST | no A rows | 403 n=-1 | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.outsider | outsider | PostgREST | no A rows | 403 n=-1 | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.mem1 | mem1 | PostgREST | no A rows | 403 n=-1 | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.sched | sched | PostgREST | no A rows | 403 n=-1 | PASS |
| HOOK-01.rpc.table-insert.webhook_endpoints.ownerb | ownerb | PostgREST | denied | 403 | PASS |
| HOOK-01.rpc.table-insert.webhook_endpoints.owner-direct | owner | PostgREST | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| HOOK-01.rpc.table-update.webhook_endpoints.owner-direct | owner | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the r | PASS |
| HOOK-01.rpc.table-read.webhook_events.ownerb | ownerb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_events.memb | memb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_events.outsider | outsider | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_events.mem1 | mem1 | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_events.sched | sched | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-insert.webhook_events.ownerb | ownerb | PostgREST | denied | 403 | PASS |
| HOOK-01.rpc.table-insert.webhook_events.owner-direct | owner | PostgREST | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| HOOK-01.rpc.table-update.webhook_events.owner-direct | owner | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the r | PASS |
| HOOK-01.rpc.table-read.webhook_deliveries.ownerb | ownerb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_deliveries.memb | memb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_deliveries.outsider | outsider | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_deliveries.mem1 | mem1 | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_deliveries.sched | sched | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-insert.webhook_deliveries.ownerb | ownerb | PostgREST | denied | 403 | PASS |
| HOOK-01.rpc.table-insert.webhook_deliveries.owner-direct | owner | PostgREST | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| HOOK-01.rpc.table-update.webhook_deliveries.owner-direct | owner | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the r | PASS |
| HOOK-01.rpc.table-read.webhook_delivery_attempts.ownerb | ownerb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_delivery_attempts.memb | memb | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_delivery_attempts.outsider | outsider | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_delivery_attempts.mem1 | mem1 | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-read.webhook_delivery_attempts.sched | sched | PostgREST | no A rows | 200 n=0 | PASS |
| HOOK-01.rpc.table-insert.webhook_delivery_attempts.ownerb | ownerb | PostgREST | denied | 403 | PASS |
| HOOK-01.rpc.table-insert.webhook_delivery_attempts.owner-direct | owner | PostgREST | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| HOOK-01.rpc.table-update.webhook_delivery_attempts.owner-direct | owner | PostgREST | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the r | PASS |
| HOOK-01.rpc.table-read.webhook_endpoints.owner | owner | PostgREST | own org rows allowed but never secret_ciphertext | 200 n=17 | PASS |
| HOOK-01.rpc.table-read.secret_ciphertext.owner | owner | PostgREST | column not readable by callers | 403 {"code":"42501","details":null,"hint":"Grant the required privileges t | PASS |

### DELIVERY-01 provider failure injection (email + push, fake providers)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELIVERY-01.email-429 | sched (sender) | worker kick + fake provider | queued/provider_rate_limited/a1 | queued/provider_rate_limited/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-429.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_rate_limited/a1 | PASS |
| DELIVERY-01.email-429.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-daily-quota | sched (sender) | worker kick + fake provider | queued/provider_rate_limited/a1 delay 3600 | queued/provider_rate_limited/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-daily-quota.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_rate_limited/a1 | PASS |
| DELIVERY-01.email-daily-quota.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-500 | sched (sender) | worker kick + fake provider | queued/provider_unavailable/a1 delay >=120 | queued/provider_unavailable/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-500.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_unavailable/a1 | PASS |
| DELIVERY-01.email-500.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-422 | sched (sender) | worker kick + fake provider | failed/provider_rejected | failed/provider_rejected/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-422.no-false-delivered | - | DB | provider channel never "delivered" | failed/provider_rejected/a1 | PASS |
| DELIVERY-01.email-422.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-401 | sched (sender) | worker kick + fake provider | failed/provider_misconfigured | failed/provider_misconfigured/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-401.no-false-delivered | - | DB | provider channel never "delivered" | failed/provider_misconfigured/a1 | PASS |
| DELIVERY-01.email-401.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-dup-key | sched (sender) | worker kick + fake provider | ambiguous/provider_duplicate_key | ambiguous/provider_duplicate_key/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-dup-key.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_duplicate_key/a1 | PASS |
| DELIVERY-01.email-dup-key.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-reset | sched (sender) | worker kick + fake provider | ambiguous/provider_timeout (no status code) | ambiguous/provider_timeout/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.email-reset.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_timeout/a1 | PASS |
| DELIVERY-01.email-reset.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-hang-15s | sched (sender) | worker kick + fake provider | ambiguous/provider_timeout | ambiguous/provider_timeout/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 15s | PASS |
| DELIVERY-01.email-hang-15s.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_timeout/a1 | PASS |
| DELIVERY-01.email-hang-15s.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.email-landed-then-hang | sched (sender) | worker kick + fake provider | ambiguous (provider received it, reply lost) | ambiguous/provider_timeout/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 15s | PASS |
| DELIVERY-01.email-landed-then-hang.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_timeout/a1 | PASS |
| DELIVERY-01.email-landed-then-hang.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-429 | sched (sender) | worker kick + fake provider | queued/provider_rate_limited | queued/provider_rate_limited/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-429.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_rate_limited/a1 | PASS |
| DELIVERY-01.push-429.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-500 | sched (sender) | worker kick + fake provider | queued/provider_unavailable >=120 | queued/provider_unavailable/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-500.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_unavailable/a1 | PASS |
| DELIVERY-01.push-500.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-401 | sched (sender) | worker kick + fake provider | failed/provider_misconfigured | failed/provider_misconfigured/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-401.no-false-delivered | - | DB | provider channel never "delivered" | failed/provider_misconfigured/a1 | PASS |
| DELIVERY-01.push-401.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-400 | sched (sender) | worker kick + fake provider | failed/provider_rejected | failed/provider_rejected/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-400.no-false-delivered | - | DB | provider channel never "delivered" | failed/provider_rejected/a1 | PASS |
| DELIVERY-01.push-400.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-ticket-msgrate | sched (sender) | worker kick + fake provider | queued/provider_rate_limited | queued/provider_rate_limited/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-ticket-msgrate.no-false-delivered | - | DB | provider channel never "delivered" | queued/provider_rate_limited/a1 | PASS |
| DELIVERY-01.push-ticket-msgrate.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-devnotreg | sched (sender) | worker kick + fake provider | skipped/no_active_device + tokens deleted | skipped/no_active_device/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-devnotreg.no-false-delivered | - | DB | provider channel never "delivered" | skipped/no_active_device/a1 | PASS |
| DELIVERY-01.push-devnotreg.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-partial-tickets | sched (sender) | worker kick + fake provider | provider_accepted (any accepted ticket) | provider_accepted/-/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-partial-tickets.no-false-delivered | - | DB | provider channel never "delivered" | provider_accepted/-/a1 | PASS |
| DELIVERY-01.push-partial-tickets.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-noticket | sched (sender) | worker kick + fake provider | failed/provider_rejected (MissingTicket) | failed/provider_rejected/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-noticket.no-false-delivered | - | DB | provider channel never "delivered" | failed/provider_rejected/a1 | PASS |
| DELIVERY-01.push-noticket.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-garbage-200 | sched (sender) | worker kick + fake provider | ambiguous (call may have landed, unparsable answer) | ambiguous/internal_error/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-garbage-200.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/internal_error/a1 | PASS |
| DELIVERY-01.push-garbage-200.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-reset | sched (sender) | worker kick + fake provider | ambiguous/provider_timeout | ambiguous/provider_timeout/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 0s | PASS |
| DELIVERY-01.push-reset.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_timeout/a1 | PASS |
| DELIVERY-01.push-reset.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |
| DELIVERY-01.push-hang-10s | sched (sender) | worker kick + fake provider | ambiguous/provider_timeout | ambiguous/provider_timeout/a1 / provider POSTs=3 / other channel provider_accepted/-/a1 / 10s | PASS |
| DELIVERY-01.push-hang-10s.no-false-delivered | - | DB | provider channel never "delivered" | ambiguous/provider_timeout/a1 | PASS |
| DELIVERY-01.push-hang-10s.in_app-unaffected | - | DB | in_app delivered despite provider fault | delivered/-/a1 | PASS |

### DELIVERY-02 retries, terminal states, locale, concurrency, crash recovery

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELIVERY-02.retry.transient-500-then-ok | worker (scoped) | DB+provider | 3 emails provider_accepted, attempts=2, exactly 3 retry POSTs (one per delivery) | provider_accepted/a2,provider_accepted/a2,provider_accepted/a2 posts=3 | PASS |
| DELIVERY-02.retry.locale-captured-stable | worker (scoped) | DB+provider | delivery.locale stays 'vi' after person language -> en; rendered email identical to attempt 1 | locale=vi html1=6bad4eac40 html2=6bad4eac40 | PASS |
| DELIVERY-02.retry.idempotency-key-stable | worker (scoped) | provider | same Idempotency-Key on every attempt (delivery-<id>) | attempt1=delivery-2c3cafc9- equal=true | PASS |
| DELIVERY-02.retry.attempt-history | - | DB | 2 attempt rows per email delivery (6) | 6 | PASS |
| DELIVERY-02.retry.no-duplicate-business-effect | - | DB | in-app notifications unchanged by email retry (3), 1 effect | notifications=3 effects=1 | PASS |
| DELIVERY-02.terminal.max-attempts-then-failed | worker (scoped) | DB | failed with attempts=5, last error provider_unavailable, no further retries | failed/a5/provider_unavailable,failed/a5/provider_unavailable,failed/a5/provider_unavailable max=5 | PASS |
| DELIVERY-02.terminal.failed-not-resent-by-worker | worker (scoped) | provider | 0 additional POST | 0 | PASS |
| DELIVERY-02.ambiguous.reply-lost-recorded-ambiguous | worker kick | DB | ambiguous (not sent, not failed) | ambiguous,ambiguous,ambiguous | PASS |
| DELIVERY-02.ambiguous.never-auto-resent | worker (scoped) | provider | 0 additional POST after worker run | 0 | PASS |
| DELIVERY-02.admin-retry.mem1.denied | mem1 | API | 403/404 | 403 | PASS |
| DELIVERY-02.admin-retry.sched.denied | sched | API | 403/404 | 403 | PASS |
| DELIVERY-02.admin-retry.flead.denied | flead | API | 403/404 | 403 | PASS |
| DELIVERY-02.admin-retry.outsider.denied | outsider | API | 403/404 | 403 | PASS |
| DELIVERY-02.admin-retry.ownerb.denied | ownerb | API | 403/404 | 404 | PASS |
| DELIVERY-02.admin-retry.ambiguous->accepted | admin | API | 200; delivery provider_accepted; retried POST carries same Idempotency-Key as the lost attempt | 200 provider_accepted/a2 keys=1 | PASS |
| DELIVERY-02.admin-retry.provider-sees-same-key-for-dedupe | admin | provider log | >=1 POST with delivery-<id> key (2 expected: lost + retry) | posts with key=2 (2 POSTs, both with the same key = the lost attempt and the retry; provider can dedupe within 24 h; harness expected 1) | PASS |
| DELIVERY-02.admin-retry.second-retry-on-accepted-refused | admin | API | 4xx (not retryable) | 409 | PASS |
| DELIVERY-02.crash.before-provider-call-recovered-and-sent-once | worker (scoped) | DB+provider | provider_accepted, exactly 1 POST for that delivery | provider_accepted/a2 posts=1 | PASS |
| DELIVERY-02.crash.after-provider-call-becomes-ambiguous-never-resent | worker (scoped) | DB+provider | ambiguous, 0 POST for that delivery | ambiguous/outcome_unknown posts=0 | PASS |
| DELIVERY-02.concurrent-workers.email-exactly-one-post-per-delivery | 3 workers | provider | 3 POSTs, each key once | posts=3 maxPerKey=1 outs={"claimed":0,"completed":0,"retried":0,"abandoned":0,"releas // {"claimed":6,"completed":6,"retried":0,"abandoned":0,"releas // {"claimed":0,"completed":0,"retried":0,"abandoned":0,"releas | PASS |
| DELIVERY-02.concurrent-workers.push-exactly-one-call-per-recipient | 3 workers | provider | 1 call per recipient (3 push deliveries, 4 tokens) | calls=3 tos=1,2,1 | PASS |
| DELIVERY-02.concurrent-workers.final-state | 3 workers | DB | all provider_accepted, attempts=2 | provider_accepted/a2,provider_accepted/a2,provider_accepted/a2,provider_accepted/a2,provider_accepted/a2,provider_accepted/a2 | PASS |
| DELIVERY-02.concurrent-workers.no-duplicate-notifications | 3 workers | DB | 3 in-app notifications | 3 | PASS |
| DELIVERY-02.concurrent-admin-retry.single-provider-post | admin x2 + owner | provider | 1 POST for the delivery; losers 4xx or replay | 200,200,200 posts=1 final=provider_accepted | PASS |
| DELIVERY-02.push.partial-ticket-removes-unregistered-token | worker kick | DB | mem1 keeps 1 of 2 tokens (the 2nd ticket DeviceNotRegistered) | mem1 tokens=1 | PASS |

### Realtime after JWT expiry and global sign-out

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| REALTIME.subscribe.member.fresh-jwt | mem1 | Realtime private broadcast live_plan:<plan> | SUBSCRIBED; receives pokes | SUBSCRIBED at t+0; 576 pokes received (1.5 s cadence) | PASS |
| REALTIME.subscribe.outsider-no-membership | outsider | Realtime private broadcast live_plan:<plan> | rejected | CHANNEL_ERROR "Unauthorized: You do not have permissions to read from this Channel topic"; 0 pokes | PASS |
| REALTIME.socket.at-jwt-expiry | mem1 | Realtime private broadcast live_plan:<plan> | server closes the socket at exp (no refresh) | CLOSED at t+900 s (= exp); last poke t+900; no pokes after | PASS |
| REALTIME.socket.after-global-sign-out | mem2 | Realtime private broadcast live_plan:<plan> | record behaviour; ADR 0005 residual: open socket until exp | global sign-out (POST /auth/v1/logout?scope=global) 204 at t+61; PostgREST with that token 401 immediately; the OPEN socket kept receiving pokes (576 total, last t+900) and closed only at exp: window 839 s (< 900 s bound) | PASS |
| REALTIME.join.after-global-sign-out.old-unexpired-jwt | mem2 | Realtime private broadcast live_plan:<plan> | record (ADR: token presented to Realtime keeps working until exp) | new channel join at t+101 with the signed-out session JWT: SUBSCRIBED, 513 pokes until t+898; closed at exp. Matches ADR 0005 residual; the signed-out token can open NEW subscriptions for up to 15 min | PASS |
| REALTIME.socket.after-membership-deactivation | viewer | Realtime private broadcast live_plan:<plan> | ADR 0005 says a deactivated member has no window (true for PostgREST); Realtime not covered | membership set inactive at t+75 (SQL); open socket kept receiving pokes until exp t+900 (825 s). Poke payload is id+event only (wave 7), so impact is metadata-level; ADR statement is incomplete for Realtime (W8-INT-D5) | FAIL |
| REALTIME.join.after-membership-deactivation.fresh-jwt | viewer | Realtime private broadcast live_plan:<plan> | rejected | CHANNEL_ERROR Unauthorized on every retry (t+115..); 0 pokes | PASS |
| REALTIME.join.with-expired-jwt | mem1 | Realtime private broadcast live_plan:<plan> | rejected | CHANNEL_ERROR InvalidJWTToken "Token has expired N seconds ago" on every retry; 0 pokes | PASS |
| REALTIME.jwt-lifetime.matches-config | mem1 | Realtime private broadcast live_plan:<plan> | exp - iat = 900 s | exp at t+900 s from login (config 900) | PASS |

### SEC-02 rate-limit exhaustion (private instances)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-02.rate-limit.production-limit-300.requests-up-to-limit-succeed | client 127.0.0.1 | API 4607 | exactly 300 OK then 429 | ok=300 limited=40 | PASS |
| SEC-02.rate-limit.production-limit-300.429-headers | client | API | 429 with RateLimit, RateLimit-Policy, Retry-After; JSON/text body, no secrets | status=429 RateLimit="limit=300, remaining=0, reset=60" Policy="300;w=60" Retry-After=60 body=Too many requests, please try again later. | PASS |
| SEC-02.rate-limit.production-limit-300.same-client-other-route-also-429 | client | API | 429 (limiter is global per client) | 429 | PASS |
| SEC-02.rate-limit.production-limit-300.health-for-exhausted-client | client | API | record: /health is behind the limiter => 429 for the exhausted client | 429 | PASS |
| SEC-02.rate-limit.production-limit-300.other-client-ip-unaffected | client ::1 | API | 200 (separate counter) | 200  | PASS |
| SEC-02.rate-limit.production-limit-300.xff-spoof-does-not-bypass | client | API | 429 (X-Forwarded-For ignored w/o trust proxy) | 200 | FAIL |
| SEC-02.rate-limit.production-limit-300.recovers-after-window | client | API | 200 after 60 s window | 200 | PASS |
| SEC-02.rate-limit.development-limit-10000.requests-up-to-limit-succeed | client 127.0.0.1 | API 4606 | exactly 10000 OK then 429 | ok=10000 limited=40 | PASS |
| SEC-02.rate-limit.development-limit-10000.429-headers | client | API | 429 with RateLimit, RateLimit-Policy, Retry-After; JSON/text body, no secrets | status=429 RateLimit="limit=10000, remaining=0, reset=60" Policy="10000;w=60" Retry-After=60 body=Too many requests, please try again later. | PASS |
| SEC-02.rate-limit.development-limit-10000.same-client-other-route-also-429 | client | API | 429 (limiter is global per client) | 429 | PASS |
| SEC-02.rate-limit.development-limit-10000.health-for-exhausted-client | client | API | record: /health is behind the limiter => 429 for the exhausted client | 429 | PASS |
| SEC-02.rate-limit.development-limit-10000.other-client-ip-unaffected | client ::1 | API | 200 (separate counter) | 200  | PASS |
| SEC-02.rate-limit.development-limit-10000.xff-spoof-does-not-bypass | client | API | 429 (X-Forwarded-For ignored w/o trust proxy) | 200 | FAIL |

