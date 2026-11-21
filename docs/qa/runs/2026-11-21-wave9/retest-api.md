# W9-RETEST-API — wave 8 API/resilience defect retest (QA-16, QA-15 RES-01 remainder)

- **Package:** W9-RETEST-API. **Commit:** 9aaeada (main) on branch `feature/qa-wave9`; private instances ran from this worktree (code identical to the shared :4000, which was untouched and healthy at the end).
- **Env:** local Supabase (Postgres/PostgREST/Auth/Storage), simulated email/push. Private API instances `:4611` (dev), `:4613` (`NODE_ENV=production`, own `INTEGRATION_SECRET_KEY`), `:4614` (production, default `TRUST_PROXY`), `:4615` (production, `TRUST_PROXY=1`), `:4616` (`TRUST_PROXY=bogus`, start-up check). Fault proxy `:4612` in front of Supabase (per-route status/body/reset/hang/delay rules). All stopped by their own PID at the end. No code, config or migration changed; delivery worker never run.
- **Namespace:** orgs `qa-w9-api-a` (bc8727b3-…), `qa-w9-api-b` (562add4d-…); users `ownera`, `schedulera`, `membera`, `extra1`, `extra2` (org A: owner/scheduler/member/member/member), `ownerb` (org B owner), all `<alias>.qaw9.api@example.test`. Password only in the scratchpad.
- **Method:** setup by service role (users, orgs, memberships, notification row); every behaviour driven through the real API or PostgREST with the actor's own JWT; DB reads for persisted state; SQL function tests inside a rolled-back transaction.

## Summary

| Status | Count |
|---|---|
| PASS | 82 result rows (each row aggregates several injected cases) |
| FAIL | 1 (new variant, W9-API-D1) |
| BLOCKED | 0 |
| NOT_RUN | 3 |
| NOT_APPLICABLE | 0 |

All original wave 8 defects in scope: **PASS** (W8-RES-D1..D7, W8-RT-D1, D2, W8-INT-D1..D4, W8-PERF-D1, review-round items).

## Results

### W8-RES-D1 unmapped upstream errors / expired JWT (dev :4611 and production :4613 identical)

Fault injected on `GET /rest/v1/plans?`, `rpc/update_plan_with_times`, `rpc/create_plan`, `rpc/my_org_context`. Leak check: body must not contain engine/host/network/schema text.

| Case | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| D1.up500 (XX000) | owner A | GET /plans, PATCH /plans/:id, POST /plans, org-context | 500 generic, no detail | 500 `internal_error` "Internal server error"; no leak; dev+prod | PASS |
| D1.up400 PGRST100, up404 PGRST202, 23502, 22001 | owner A | same 4 routes | generic 500, no detail | 500 generic; log carries code + redacted message only | PASS |
| D1.502 Kong HTML | owner A | same | 502 generic | 502 `upstream_error` | PASS |
| D1.503 PGRST000 (host/port in message) | owner A | same | 503 generic | 503 `upstream_unavailable`; no host | PASS |
| D1.reset (TCP reset) | owner A | same | 503 | 503 `upstream_unavailable` (reads take ~7 s: postgrest-js retry backoff, see Observations) | PASS |
| D1.504 plain-text "upstream request timeout" | owner A | GET /plans | 504 | 504 `upstream_timeout` | PASS |
| D1.jwt PGRST301 "JWT expired" at PostgREST | owner A | GET, PATCH, POST, org-context | 401 so clients refresh | 401 `unauthorized` "Invalid or expired session" on all 4 | PASS |
| D1.writes leave no row | owner A | PATCH/POST under every fault | 0 rows persisted | `plans` with `nf-%`/`x-%` titles = 0 | PASS |
| D1.logs | — | api4611/4613 logs | no row values | 0 occurrences of injected `leak*` values; `Key (a)=([redacted])`; class-22 quoted value redacted | PASS |

### W8-RES-D2 Auth outage

| Case | Expected | Actual | Status |
|---|---|---|---|
| GoTrue `GET /auth/v1/user` 500 / 502 HTML / 503 / reset | 503, no sign-out | 503 `auth_unavailable` | PASS |
| Auth 408 and 429 | 503 | 503 `auth_unavailable` | PASS |
| Auth hang | 503 within bound | 503 after 15.0 s | PASS |
| Auth 401 (bad_jwt), 403 (session_not_found), 400 | 401 sign-out (a verdict) | 401 `unauthorized` | PASS |
| Next request after fault cleared | 200 | 200 | PASS |

### W8-RES-D3 note create idempotency (owner/scheduler/member/ownerB; API + DB)

| Case | Expected | Actual | Status |
|---|---|---|---|
| owner POST note with `idempotency_key`, repeat | 201 then 200 same note id, 1 row | 201, 200 same id | PASS |
| same key, different body | 409 `idempotency_key_reused` | 409 | PASS |
| other author (scheduler), same key | unrelated create | 201 new note | PASS |
| unkeyed x2 | two notes (legacy contract) | 2 rows | PASS |
| key shorter than 8 | 422 | 422 | PASS |
| member / ownerB (A plan, org A header) | denied | 403 / 403 | PASS |

### W8-RES-D4 + W8-RT-D1 plans PATCH (`update_plan_with_times`)

| Case | Expected | Actual | Status |
|---|---|---|---|
| `{title, times}` with rpc 500 | error, neither title nor times changed, one upstream write | 500; title and times unchanged; only `POST rpc/update_plan_with_times` seen (no separate `PATCH /plans`) | PASS |
| same with TCP reset | same | 503, unchanged | PASS |
| retry with same `expected_revision` after each fault | 200, both applied | 200 (no false 409) | PASS |
| RT-D1 `service_date` + `times` (service time) | date follows earliest service time | plan date = 2027-05-02 15:00 (the service time), times saved | PASS |
| `service_date` + rehearsal-only times | `service_date` applies | date = requested | PASS |
| `service_date` alone | applies, times untouched | applies | PASS |
| only-sent-columns: `{title}` after concurrent location/notes edit | location, notes preserved | preserved | PASS |
| `{location:null}`, `{notes:null,status:'published'}` | only those columns change | exact | PASS |
| `{}`, `{title:""}`, stale `expected_revision:0` | 200 no-op, 422, 409 `plan_revision_stale` | as expected | PASS |
| member / ownerB (A header, B header) | 403 / 403 / 404 | 403 / 403 / 404 | PASS |

### W8-RES-D5 POST /plans same key, different body

| Case | Expected | Actual | Status |
|---|---|---|---|
| same key + same body | 201 replay, same id | same id | PASS |
| different title / date / location | 409 `idempotency_key_reused` | 409 for all three | PASS |
| org B same key | independent | new plan | PASS |
| `POST /plans/:id/duplicate` same key, different `service_date` | 409 | **201 replaying the first plan silently** | FAIL (W9-API-D1) |

### W8-RES-D6 upstream timeout

| Case | Expected | Actual | Status |
|---|---|---|---|
| PostgREST read hang | 504 ~15 s, one upstream attempt | 504 `upstream_timeout` after 15.0 s; 1 upstream request | PASS |
| write delayed 17 s (commits after the abort) | 504, then same-key retry converges | 504 at 15.0 s; row persisted once; retry 201, still 1 row | PASS |
| read delayed 10 s | succeeds | 200 after 10.0 s | PASS |
| read 5xx sample | 504 only for timeouts | 57014 injected → 504 | PASS |

### W8-RES-D7 upload-intent replay with signing failure

| Case | Expected | Actual | Status |
|---|---|---|---|
| first intent, Storage sign 500 | 503 `storage_unavailable` | 503 | PASS |
| replay (x2) while sign still 500, bytes absent | 503, not `200 upload:null` | 503 both times | PASS |
| replay after Storage recovers | 200 `replayed:true`, usable upload target | target returned; PUT of a PDF 200 | PASS |
| replay, bytes already stored, sign 500 | 200 (client finalizes) | 200 | PASS |
| replay with all Storage down (reset) | 503 | 503 `upstream_unavailable` | PASS |
| member / ownerB | denied | 403 / 404 | PASS |

### W8-RT-D2 silent 204 deletes

| Route | Cases (actor) | Expected | Actual | Status |
|---|---|---|---|---|
| DELETE /notifications/:id | random id, scheduler on member's row, ownerB (B header), ownerB/member wrong header, bad id, own then repeat, no auth | 404 (403 for non-member, 400 bad id, 401), row kept | 404, 404, 404, 403/403, 400, 204 then 404, 401; row kept until owner deleted it | PASS |
| DELETE /me/devices/:token | random token, other user, own then repeat | 404, 404 (row kept), 204, 404 | as expected | PASS |
| DELETE /me/blocks/:userId | never blocked, random uuid, bad id, own then repeat, other user | 404 "not blocked", 422, 204, 404 | as expected | PASS |
| DELETE /people/members/:userId | random, ownerB, scheduler, member, self, own then repeat | 404, 404, 403, 403, 400, 204 then 404; row removed once | as expected | PASS |

### W8-INT-D1 webhook retry backoff (SQL, `complete_webhook_delivery`, rolled-back transaction)

| Case | Expected | Actual | Status |
|---|---|---|---|
| attempts 1–8 x retry-after NULL, 0, -5, 3, 7, 400, 10000, 86400, 90000 (72 combos x 300 samples) | delay = max(hint capped 86400, schedule 5 s/5 m/30 m/2 h/5 h/10 h/14 h/20 h) +/-10 % | 72/72 inside the band; NULL hint: 4.5–5.5 s, 270–330 s, 1620–1980 s, … 64 876–79 137 s (not ~24 h) | PASS |
| EXECUTE on function | service_role only | ACL `postgres`, `service_role` | PASS |

### W8-INT-D2 plan created as published

| Case | Expected | Actual | Status |
|---|---|---|---|
| owner POST /plans `status:published` (2 endpoints subscribed) | 1 `plan.published` event, 2 queued deliveries | 1 event / 2 deliveries, status `queued`, attempts 0 | PASS |
| scheduler POST published | event | 1 / 2 | PASS |
| draft create; archived create; duplicate (draft) | no event | 0 / 0 | PASS |
| draft → published PATCH; published → published PATCH | one event; no duplicate | 1 / 2, unchanged after 2nd | PASS |
| published create replayed with same key | no duplicate event | 1 / 2 | PASS |
| org B events | none | 0 | PASS |

### W8-INT-D3 webhook URL validation (22 bad URLs, 4 non-strings, missing field)

| Case | Expected | Actual | Status |
|---|---|---|---|
| `"not a url"`, `notaurl`, empty, spaces, `http://`, `://x`, `//x`, `http://[::1`, space in host | 422 | 422 "Enter a full URL" (no 500) | PASS |
| `javascript:`, `ftp:`, `file:`, `data:`, credentials, `#fragment`, >2048 chars, NUL | 422 | 422 | PASS |
| non-string / missing `url` | 422 | 422 | PASS |
| localhost / 127.0.0.1 / 169.254.169.254 / `[::1]` | rejected | 503 `webhooks_unavailable` on a private instance without key; with key see below | PASS (see note) |
| unresolvable host with key set | 422 | 422 `webhook_dns_failed` | PASS |
| scheduler, member, ownerB (A header) create endpoint | 403 | 403 / 403 / 403 | PASS |

Note: the private-destination rows were only exercised on the :4613 instance before `INTEGRATION_SECRET_KEY` was set (503 from the key check precedes the destination guard), so private-address rejection itself is NOT_RUN here (covered by wave 8 / unit tests).

### W8-INT-D4 trust proxy / X-Forwarded-For

| Case | Expected | Actual | Status |
|---|---|---|---|
| production, default `TRUST_PROXY`: 340 direct requests | 300 x 200, then 429 with RateLimit headers | 300/40 | PASS |
| then a new `X-Forwarded-For` (single value, list, `::1`) | still 429 (client cannot pick its key) | 429 x3 | PASS |
| `TRUST_PROXY=1` (configured one-hop proxy) | XFF honored by design | XFF value gets its own bucket (200); direct stays 429 | PASS (by design) |
| `TRUST_PROXY=bogus` | refuse to start | start-up error naming the allowed forms | PASS |

### W8-PERF-D1 song length CHECKs (PostgREST insert with the owner's JWT vs the shared Zod `createSongSchema`)

121 inputs. Result: **121/121 DB and Zod agree (0 mismatches)**.

| Group | Expected | Actual | Status |
|---|---|---|---|
| title 200 / 201 ASCII; 100 / 101 emoji (200 / 202 UTF-16 units); 200 / 201 CJK; padded with spaces; empty; whitespace-only; 199+emoji | JS length semantics | agree | PASS |
| all JS-whitespace vs non-whitespace code points (tab…U+3000, U+FEFF, U+0085, U+180E, ZWSP, ZWNJ, U+2060) as leading/trailing title chars and tag padding | same trim as JS | agree | PASS |
| author 200/201, ccli 40/41, copyright 300/301, administration 300/301, meter 20/21, style 40/41, speed 40/41, notes 4000/4001 (+ emoji notes) | agree | agree | PASS |
| `default_key` 8 / 9, 4 / 5 emoji, space-padded | agree | agree | PASS |
| themes and song_types: 20 / 21 entries, tag 40 / 41, 20 / 21 emoji, empty, whitespace, padded, duplicates | agree | agree | PASS |
| NULL element, nested array, 2-D array (not expressible in JSON/Zod) | rejected by DB | 400 `23514` | PASS |
| UPDATE of existing song to 250-char title / 21 themes / 9-char key | 23514 | 400 `23514`; title unchanged | PASS |
| member direct insert; ownerB insert into org A; member / ownerB update | denied | 403 RLS; update returns `[]` (0 rows) | PASS |
| `GET /songs?per_page=200` with 85 songs incl. 200-char and 100-emoji titles | 200 | 200, 83 rows | PASS |
| API `POST /songs` 201 chars / 101 emoji | 422 | 422 | PASS |
| all songs constraints validated (`convalidated`) | true | all 12 true | PASS |

### Review-round items

| Case | Expected | Actual | Status |
|---|---|---|---|
| 23505 / 23503 / 23514 injected with row values in `details` | generic 409 / 400 / 400, no values | 409 "That record already exists", 400 "Referenced record does not exist", 400 "A value failed a database constraint"; no leak in body or logs | PASS |
| real DB: duplicate team / service-type name; FK on random service_type_id (plan, team) | same mapping | 409 / 409 / 400 / 400, no key text | PASS |
| 57014 | 504 | 504 `upstream_timeout`, logged without detail | PASS |
| `claim_plan_copy_key` EXECUTE | postgres + authenticated only | ACL `{postgres, authenticated}`; PUBLIC, anon, service_role: no; anon call: "permission denied for schema private"; service_role call: "permission denied for function"; PostgREST rpc: 404 (default) / 406 (`Content-Profile: private`, schema not exposed); no 5-arg overload left | PASS |
| `update_plan_with_times` EXECUTE | authenticated (and service_role) | `{postgres, authenticated, service_role}`, not PUBLIC/anon | PASS |

### Informational: other deletes on double-submit (current behaviour)

All return 204 then **404** on the second DELETE (server contract since wave 7; the known client follow-up is surfacing it as an error): teams `Team not found`, team positions `Position not found`, service types, plans `Plan not found`, songs `Song not found`, arrangements, folders `Folder not found`, tag groups (`/people/tag-groups/:id`) `Tag group not found`, matrix views `View not found`. Plan positions and songbooks not exercised (songbook create body not guessed). Not a defect.

## Defects

### W9-API-D1 (P2) `POST /plans/:id/duplicate` replays an idempotency key without comparing the request

- Repro (owner A): `POST /api/v1/plans/<src>/duplicate {"service_date":"2027-09-01T15:00:00Z","idempotency_key":"k-0000001"}` → 201 plan P. Repeat with `"service_date":"2027-09-08T15:00:00Z"` and the same key → **201 returning P** (service date 2027-09-01); no second plan.
- Expected: 409 `idempotency_key_reused`, as `POST /plans` now answers.
- Evidence: `plan_copy_operations` row for the key has `request_hash` NULL (create rows have it).
- Suspected source: `supabase/migrations/20261127000004_w8_plan_create_idempotency_hash.sql` (`claim_plan_copy_key` compares the hash only when both sides supply one; `duplicate_plan` passes none, ~lines 41–45). The `import` kind (copy contents into a plan) was not tested but uses the same function.
- Impact: a client that reuses a key believes its different copy was made. Same class as W8-RES-D5, previously listed as "not covered".

## Observations (not defects)

- postgrest-js still retries failed GETs (503/reset) with 1 + 2 + 4 s backoff, so a faulted read answers 503 after ~7 s; timeouts are not retried (one 15 s attempt). Writes are not retried.
- Default `TRUST_PROXY=false`: behind a single real reverse proxy all clients share the proxy's address and one 300/min bucket (and `/health` is counted). Deployments must set `TRUST_PROXY` (documented in `backend/.env.example`).
- After revoking the two fixture webhook endpoints, the 8 queued deliveries became `failed` (7) / `cancelled` (1) without the worker running.
- A real expired JWT is rejected by Auth (`getUser` 401); the PostgREST-side expiry was injected through the proxy (401 PGRST301 → 401).

## Not run / blocked

- Private/loopback webhook destination rejection with a configured key (see D3 note), real Storage timeout (60 s) and the post-commit-read-failure variants of lost replies (covered by same-key replay checks instead of proxy post-commit drops), plan positions and songbook double-delete, 57014 from a real slow query (injected only).

## Fixtures left in place

- Orgs `qa-w9-api-a`, `qa-w9-api-b`; users `ownera`, `schedulera`, `membera`, `extra1`, `extra2`, `ownerb` (`*.qaw9.api@example.test`); `extra1` was removed from org A by the member-delete test.
- Org A: 22 plans (incl. `OnlyTitle`, `w9 pub-*`, `w9 slow write`, `D5-A`), ~85 songs (length-boundary titles), 4 notes, 1 team (`W9 Team Dup`, `W9 DD team`), service type `W9 ST`, 2 folders `W9 F`, one pending/uploaded PDF intent on plan `OnlyTitle`, 2 revoked webhook endpoints with their (failed/cancelled) deliveries and 4 `webhook_events`, `plan_copy_operations` keys `w9-*`.
- Scratchpad (session-local): `/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-test-tube/81f65e74-bdd6-4594-9f0a-588d83eb9278/scratchpad/api` (scripts t1–t15, logs, credentials). Private instances and the fault proxy are stopped.
