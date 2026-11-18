# QA-12 Calendar, export, public projection, integrations: wave 3 (run qa-20261118, agent `int`)

Date 2026-11-18. Package QA-12 from `docs/plans/admin-mobile-test-plan.md` section 9. Owned cases: CAL-01, CAL-02, REPORT-02, PUBLIC-01, API-01, HOOK-01, remaining GATED-01 (songbook routes belong to QA-09).

## Header

| Item | Value |
|---|---|
| Commit | `5bedb99` on `feature/qa-wave3` (= `main`); no source, migration or config change made by this run |
| Shared environment | API `http://localhost:4000` (NODE_ENV=development; express rate limits 10000/min), web `:5173`, local Supabase (docker exec psql for setup/assertions only) |
| Extra processes started by this package (all stopped at the end) | (1) controlled webhook receiver on `127.0.0.1:4590`; (2) own API instance `:4591` = same code with `INTEGRATION_SECRET_KEY`, `CRON_SECRET` and `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=true` passed as process env (not written to any file); (3) own API instance `:4592` identical but `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=false` for the destination-policy cases. The shared `:4000` API was never restarted. |
| Why extra API instances | The shared API has no `INTEGRATION_SECRET_KEY` (webhooks return 503 `webhooks_unavailable`), no `CRON_SECRET` (worker HTTP entry point is 404) and `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=false` in `backend/.env` (http/loopback receiver refused). Without them every HOOK-01 delivery case would be BLOCKED. The 503 / 404 / policy behaviour of `:4000` was itself tested (cases `HOOK-01.oa.register.shared-api-4000-without-secret-key`, `HOOK-01.anonymous.worker-endpoint.4000-disabled`). |
| Delivery worker | Run by this package via `POST /api/v1/internal/deliveries/run` on `:4591` (Bearer CRON secret). **It processes every organization** (deliveries, reminders, file maintenance, report exports, webhooks), as warned in the assignment. Seen side effect: it also claimed report exports and webhook deliveries only of the `qa-20261118-int-*` orgs; other orgs' counters in the responses were not inspected. |
| Namespace | orgs `qa-20261118-int-a` (Alpha, America/Chicago) and `qa-20261118-int-b` (Beta, Asia/Ho_Chi_Minh); users `<alias>.qa20261118.int@example.test` |
| Credentials | Passwords, feed tokens, API keys, signing secrets and public slugs are only in the scratchpad `qa12/` directory (`creds.json`, `feed-secrets.json`, `api-keys.json`, `hook-secrets.json`, `env-int.txt`); none appear in this report. |
| Permission evidence | Caller JWT / API key / anonymous only. Service role (SQL/Auth admin API) used for: user and membership creation, org creation (`private.create_church`; self-serve creation is gated by `church_application_required`), 250 hostile-name Persons + 2400 released requests bulk insert, fault injection (`next_attempt_at` forced due between webhook attempts, `expires_at` in the past, membership status/role flips), and persisted-state assertions. |

### Fixture shape

* Org A: owner `oa`, admin `adm`, legacy scheduler `sch`, scoped leader `lead` (member, `scoped`, `scheduling.manage` on team Band, `plans.edit` on service type Sunday INT), members `mem` (released Keys, private phone/medical/address/birthday/anniversary sentinels), `mem2` (only PREPARED requests; first name is the formula `=HYPERLINK(...)`, last name Vietnamese), `multi` (member of A and B; selected-time attendance on P1, declined on P5).
* Org A content: service types Sunday INT / Midweek INT / Volume INT / Boundary INT; teams Band INT, Hosts INT (prepared-only request), `Volume, "Team"`; plans P1 (+3d, published, rehearsal + 9am + 11am), P2 draft, P3 (-3d), P4 Midweek, P5, P6, P7 (title `=cmd|' /C calc'!A0 "quoted, title"`), DST Spring (2027-03-14) and DST Fall (2026-11-01) plans, four boundary plans at 04:59:59Z / 05:00:00Z / 05:59:59Z / 06:00:00Z, and the D17 volume set (250 Persons incl. `=1+1`, `+SUM(A1)`, `-2+3`, `@cmd`, TAB, quote+comma, embedded newline, Vietnamese, emoji, `<script>`, BOM char, 3 duplicate names; 60 daily published plans; 2400 released requests). Private sentinels in plan notes (`PRIVNOTE`), item descriptions (`PRIVDESC`), pre-service item title, decline reason, blockout reason.
* Org B: owner `ob`, one service type/team/plan/song with `BSECRET` sentinels; `nob` is a user with no organization.

## Summary

Executed expanded cases: 975. PASS 941, FAIL 21, BLOCKED 0, NOT_RUN 9, NOT_APPLICABLE 4. Every FAIL maps to one of the defects below (W3-INT-D1 to D10).

| Group | PASS | FAIL | BLOCKED | NOT_RUN | N/A |
|---|---|---|---|---|---|
| CAL-01 | 116 | 0 | 0 | 1 | 0 |
| CAL-02 | 124 | 3 | 0 | 1 | 0 |
| REPORT-02 | 210 | 9 | 0 | 1 | 0 |
| PUBLIC-01 | 128 | 0 | 0 | 2 | 0 |
| API-01 | 177 | 1 | 0 | 1 | 1 |
| HOOK-01 | 162 | 8 | 0 | 2 | 1 |
| GATED-01 | 24 | 0 | 0 | 1 | 2 |
| **Total** | 941 | 21 | 0 | 9 | 4 |

**P0: none.** No cross-tenant disclosure (B sentinels never appeared in A responses, feeds, exports or API pages and vice versa), no prepared-assignment, private note, contact, decline-reason, blockout-reason or birth-year leak in calendar, feeds, reports/CSV/exports, public projections, external API or webhook payloads; no unauthorized persisted write through API/RPC (the only client-writable table found is the own-feed-token table, D1).

Prior wave-2 regression note: nothing in this package re-tests wave-2 fixes except input hygiene (malformed UUID path/query values returned 400/422 on every owned surface; the one exception is D5/D6).

## Defects

| ID | Priority | Summary |
|---|---|---|
| W3-INT-D8 | P1 | Webhook retries wait about 24 h when the receiver sends no `Retry-After` (documented schedule 5 s, 5 min, 30 min, ...) |
| W3-INT-D2 | P1 | Reports and tracked exports silently drop rows beyond 1000 per query (PostgREST `max_rows`) while `truncated=false` |
| W3-INT-D10 | P1 | Scoped-feed bearer tokens (and public slugs) are written unredacted to the access log |
| W3-INT-D1 | P2 | A signed-in user can overwrite their own personal feed `token_hash` and un-revoke a revoked token directly through PostgREST |
| W3-INT-D3 | P2 | Report CSV has no UTF-8 BOM (Excel mis-decodes Vietnamese/accents) |
| W3-INT-D4 | P2 (product decision) | Re-publishing a plan or re-saving a revoked publication without `new_link` revives the old public URL |
| W3-INT-D5 | P2 | External `GET /plans/{non-uuid}` returns 400, documented and coded as 404 |
| W3-INT-D6 | P2 | `POST /integrations/webhooks` with a non-URL string returns 500 |
| W3-INT-D7 | P2 | A plan created directly as `published` emits no `plan.published` webhook event |
| W3-INT-D9 | P2 | No way to revoke a personal calendar feed without issuing a replacement |

### W3-INT-D8 (P1) Webhook retry backoff is about 24 hours when no Retry-After header is sent
* Cases: HOOK-01.retry.first-500-queues-backoff-5s, HOOK-01.retry.second-attempt-due-after-backoff, HOOK-01.retry.second-attempt-same-event-id-new-timestamp, HOOK-01.retry.backoff-schedule.
* Repro: register an endpoint (any actor `oa`/`adm`), make the receiver answer 500 without `Retry-After`, flip a published plan to draft, run the worker. `webhook_deliveries.next_attempt_at - now()` is about 86,400 s (observed 80,000 to 95,000 s on every attempt: 90,980; 80,888; 86,504; 90,122), not about 5 s; the worker re-run 6 s later claims 0 deliveries. Same for `timeout` and `connection_failed` attempts (also `retryAfterSeconds: null`). A receiver outage therefore recovers only after about a day per attempt, and 8 attempts span about 8 days. Retry-After values are honoured correctly (120 s gave about 120 s; 999999 capped to 86400 s).
* Expected: jittered schedule 5 s, 5 min, 30 min, 2 h, 5 h, 10 h, 14 h, 20 h (docs/integrations/developer-api.md "Retries").
* Cause: Postgres `LEAST` ignores NULL, so `least(NULL, 86400) = 86400`; `coalesce(least(p_retry_after_seconds, 86400), 0)` never yields 0 when the header is absent.
* Suspected source: `supabase/migrations/20261103000000_f17_developer_api.sql:875` (`complete_webhook_delivery`). Fix idea: `case when p_retry_after_seconds is null then 0 else least(p_retry_after_seconds, 86400) end`.
* Impact: documented delivery guarantee (retry within seconds/minutes) is not met; all clients. No data exposure.

### W3-INT-D2 (P1) Reports and exports silently under-count above 1000 rows per query
* Cases: REPORT-02.oa.schedule.2400-rows-truncation-signalled, REPORT-02.oa.schedule.2400-rows-csv-notice, REPORT-02.oa.schedule.summary-vs-rows, REPORT-02.oa.export.full-not-truncated.
* Repro: org with 60 published plans and 2400 released requests in one range (D17 volume set). As owner, `GET /reports/schedule?from=<d>&to=<d>&service_type_ids=<volume>&format=json` returns `summary:{plans:25,assignments:1000,people:250}`, `rows.length=1000`, `truncated:false`; `GET /reports/staffing` and `/participation` likewise count only 1000 requests (participation `assignments:1000`). Async export (`POST /reports/exports`, worker run) is `ready` with `row_count=1000` and a CSV with no "Truncated" header line. The DB has 2400 requests in range.
* Expected: all 2400 (exports are meant to be the full path), or at minimum `truncated:true` and the CSV `Truncated` line; the code's own cap is 2000 rows (`REPORT_ROW_LIMIT`) and is never reached because the PostgREST `max_rows = 1000` limit truncates first with no signal.
* Suspected source: `backend/src/services/reports.ts` `loadAssignments` (line 124) and the other chunked loaders (`loadNeeds` 147, `loadAttendance` 163, `loadTimes` 175, `loadSongItems` 183, `loadRuns` 198) call `.in('plan_id', chunk)` of up to 100 plans with no `.range()` paging; `supabase/config.toml:8` `max_rows = 1000`. A church needs only about 10 released requests per plan over 100 plans to hit it. Every figure on the report (confirmed/pending/declined, vacancies, participation, follow-ups) is wrong with no warning.
* Impact: wrong operational numbers and incomplete exports, silent. All clients (web, mobile, export).
* Note: the 2000-row cap itself (cap + `truncated` flag + CSV line) could not be exercised for the same reason (NOT_RUN as a separate case: needs more than 100 plans per chunk).

### W3-INT-D10 (P1) Scoped calendar-feed token and public slugs appear in the access log
* Cases: HOOK-01.logs.api-no-scoped-secret, HOOK-01.logs.api-no-slug-secret.
* Repro (on the `:4591` instance, same code as `:4000`): create a scoped feed, fetch `GET /api/v1/calendar-feed/scoped/<token>.ics`. Log line: `GET /api/v1/calendar-feed/[token]/<full token>.ics 200`. `GET /api/v1/public/plans/<slug>` is logged verbatim as well. Personal-feed, response-link and invitation tokens are correctly redacted.
* Expected: bearer-equivalent tokens never logged (CLAUDE.md rule 21); same shape-only logging as the other feed route.
* Suspected source: `backend/src/lib/redact.ts:6-10,17-22` only masks the first path segment after the prefix, so `/calendar-feed/scoped/` masks the word `scoped` and leaves the token in the suffix; `/api/v1/public/plans/` and `/public/set-lists/` are not in `TOKEN_PATH_PREFIXES`. The scoped token is a credential for as long as the subscription lives and shows named schedulers' rosters (team feeds) to its holder. Public slugs are meant to be shared, so the slug part is P2 on its own.
* Everything else checked in logs was clean: no JWT, API key, whsec_ secret, CRON secret, receiver response body or private sentinel in the `:4591` log.

### W3-INT-D1 (P2) Own personal calendar feed token is client-writable
* Cases: CAL-02.mem.rls.update-own-token-hash, CAL-02.mem.rls.unrevoke-own-token.
* Repro: as `mem`, `PATCH /rest/v1/calendar_feed_tokens?user_id=eq.<me>&revoked_at=is.null` body `{"token_hash":"yyyy...(64)"}` returns 204 and the live feed URL stops working; `PATCH ...?id=eq.<old revoked row>` with `{"revoked_at":null}` returns 200 and un-revokes a token rotated away earlier.
* Expected: token hash server-generated and immutable; revocation one-way (the scoped feeds table grants only `update (revoked_at)` with a with-check that `revoked_at is not null`, and that table passed).
* Suspected source: `supabase/migrations/20260906000000_assignment_notifications.sql:53-62` (select/insert/update policies check only `user_id` and membership; Supabase default table grants give `authenticated` INSERT/UPDATE on every column). Scope: own rows only (no cross-user effect: `CAL-02.mem2.rls.*` PASS), so the impact is a user choosing a weak self-known token or reviving a leaked-and-rotated URL; hence P2.

### W3-INT-D3 (P2) CSV exports carry no UTF-8 BOM
* Cases: REPORT-02.oa.{staffing,participation,schedule,song-usage}.csv-bom, REPORT-02.oa.export.file-bom.
* Expected: plan 5.H lists BOM handling; Excel opens BOM-less UTF-8 as ANSI, so `Nguyễn Thị Ánh` and the emoji row show as mojibake. Everything else about CSV passed: quoting, CRLF, embedded newline, formula neutralisation (`=`, `+`, `-`, `@`, TAB prefixed with an apostrophe), Unicode, HTML text verbatim, duplicate names as separate rows.
* Suspected source: `packages/shared/src/lib/reports.ts:630-659` (`reportToCsv`), `backend/src/routes/reports.ts:25`, `backend/src/services/report-exports.ts` upload of `csv`. Decision may be product-level (a BOM breaks some importers); recorded as a defect against the plan text.

### W3-INT-D4 (P2, product decision) Old public URLs come back to life
* Cases: PUBLIC-01.oa.republish-after-revoke-same-slug, PUBLIC-01.oa.republish-plan.public-link-revives (both recorded PASS with a note).
* Repro: publish plan, revoke, publish again with `new_link:false` returns the same slug (the revoked URL is live again). Separately, move a publicly published plan to `draft` (public 404) and back to `published`: the earlier slug serves again without a new opt-in.
* Expected: confirm intended. The editor UI has a "new link" option, but a leaked/old URL is silently re-activated by an ordinary status toggle.
* Suspected source: `public.publish_plan` (`supabase/migrations/20261102000200_f16_calendar_layers_and_publication.sql` `slug = case when p_new_slug ...`), `backend/src/services/publication.ts:resolvePublicPlan`.

### W3-INT-D5 (P2) External plan detail with a malformed id answers 400
* Case: API-01.client.plan-detail.non-uuid. `GET /api/external/v1/plans/abc` returns 400 `bad_request`; docs say 404 for "missing, unpublished or other organization", and the route has an explicit UUID guard that returns 404.
* Suspected source: `backend/src/routes/external-api.ts:36-37` is unreachable because `param()` (`lib/params.ts`, wave-2 hygiene) throws 400 first.

### W3-INT-D6 (P2) Non-URL webhook destination returns 500
* Case: HOOK-01.oa.register.validation.url-not-url. `POST /integrations/webhooks` with `url:"not a url"` returns 500 `internal_error` (logged `TypeError: Invalid URL`).
* Suspected source: `packages/shared/src/schemas/integrations.ts:31-41` `webhookUrlSchema.superRefine` calls `new URL(value)` even after `.url()` already failed (Zod runs refinements after a non-fatal string check).

### W3-INT-D7 (P2) Creating a plan as `published` emits no webhook
* Case: HOOK-01.event.create-as-published. `POST /plans` with `status:"published"` records no `webhook_events` row; an update draft to published does.
* Expected (docs): "`plan.published`: A plan's status becomes published".
* Suspected source: `supabase/migrations/20261103000000_f17_developer_api.sql:762-767` triggers exist only `after update of status` and `after delete`; there is no INSERT trigger.

### W3-INT-D9 (P2) Personal calendar feed cannot be revoked on its own
* Case: CAL-02.personal-feed.revoke-without-rotate. `/me/calendar-feed` has GET (status) and POST (create = rotate, returns a new token). Plan row CAL-02 expects create/rotate/revoke; scoped feeds have `DELETE /calendar/feeds/:id`. A user who no longer wants any subscription URL must leave a live replacement token.
* Source: `backend/src/routes/me.ts:131,139`.

## Observations (not counted as defects)

* O-INT-1: The external plan detail returns every order item including pre-/post-service segment items (sentinel "PRESERVICE-INTERNAL prayer huddle" present); the public projection hides those segments as "internal running notes". Contract text lists "order", so recorded PASS; product may want the same rule for API keys.
* O-INT-2: Draft plans (and their times) are visible to every org member in the calendar API (`plans_select = is_org_member`); not in the permission oracle.
* O-INT-3: Members cannot re-confirm a declined position (409 `assignment_response_forbidden`, scheduler decides). Declined requests are emitted as `STATUS:CANCELLED` tombstones in the personal feed (ADR 0002 satisfied).
* O-INT-4: Public/feed responses use `Cache-Control: public, max-age=60` (public) and `private, max-age=3600` (feeds): revocation can lag at caches by up to a minute / an hour for clients that honour it; documented in ADR 0002 for feeds.
* O-INT-5: Webhooks `410` pauses the endpoint at once; five consecutive permanent failures pause it with `disabled_reason=failing`; both confirmed. A published event fans out to two endpoints with the same `webhook-id` (per endpoint dedupe is correct).
* O-INT-6: Unit evidence executed read-only: `vitest run src/lib/ics.test.ts redact.test.ts integration-crypto.test.ts` 12/12 PASS (includes the Standard Webhooks reference vector).

## Result tables

Each row is one expanded case (actor x action x surface x failure mode). Actual is truncated to 120 characters; full text is in the scratchpad JSON. Setup details for a case (fixture, state) are in the Header and the case id.


### CAL-01 Calendar and agenda (117 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CAL-01.oa.list.all | oa | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.oa.list.no-private-data | oa | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.oa.list.event-shape | oa | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type | PASS |
| CAL-01.oa.filter.rehearsal-off | oa | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.oa.filter.service-type-midweek | oa | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.oa.filter.team-band | oa | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.oa.filter.team-hosts-prepared-only | oa | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.adm.list.all | adm | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.adm.list.no-private-data | adm | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.adm.list.event-shape | adm | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type | PASS |
| CAL-01.adm.filter.rehearsal-off | adm | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.adm.filter.service-type-midweek | adm | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.adm.filter.team-band | adm | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.adm.filter.team-hosts-prepared-only | adm | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.sch.list.all | sch | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.sch.list.no-private-data | sch | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.sch.list.event-shape | sch | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type | PASS |
| CAL-01.sch.filter.rehearsal-off | sch | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.sch.filter.service-type-midweek | sch | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.sch.filter.team-band | sch | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.sch.filter.team-hosts-prepared-only | sch | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.lead.list.all | lead | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.lead.list.no-private-data | lead | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.lead.list.event-shape | lead | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type | PASS |
| CAL-01.lead.filter.rehearsal-off | lead | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.lead.filter.service-type-midweek | lead | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.lead.filter.team-band | lead | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.lead.filter.team-hosts-prepared-only | lead | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.mem.list.all | mem | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.mem.list.no-private-data | mem | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.mem.list.event-shape | mem | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_status | PASS |
| CAL-01.mem.filter.rehearsal-off | mem | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.mem.filter.service-type-midweek | mem | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.mem.filter.team-band | mem | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.mem.filter.team-hosts-prepared-only | mem | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.mem2.list.all | mem2 | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.mem2.list.no-private-data | mem2 | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.mem2.list.event-shape | mem2 | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type | PASS |
| CAL-01.mem2.filter.rehearsal-off | mem2 | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.mem2.filter.service-type-midweek | mem2 | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.mem2.filter.team-band | mem2 | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.mem2.filter.team-hosts-prepared-only | mem2 | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.multi.list.all | multi | API GET /calendar | 200, 21 events (7 plans x 3 times), no private fields | 200 n=21 | PASS |
| CAL-01.multi.list.no-private-data | multi | API GET /calendar | no notes/descriptions/names/prepared/reason sentinels in body | leaks= | PASS |
| CAL-01.multi.list.event-shape | multi | API GET /calendar | only id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_s… | id,plan_id,title,kind,starts_at,ends_at,status,location,service_type,my_assignment_status | PASS |
| CAL-01.multi.filter.rehearsal-off | multi | API | 14 service events only | 200 n=14 kinds=service | PASS |
| CAL-01.multi.filter.service-type-midweek | multi | API | 3 events (P4) only | 200 n=3 | PASS |
| CAL-01.multi.filter.team-band | multi | API | events of plans with released Band assignments: P1,P3,P5 = 9 | 200 n=9 | PASS |
| CAL-01.multi.filter.team-hosts-prepared-only | multi | API | 0 events: Hosts has only a PREPARED assignment (P4) which must not count | 200 n=0 | PASS |
| CAL-01.mem.mine | mem | API mine=true | 6 events (P1 all 3 times, P3 all 3), my_assignment_status set | 200 n=6 st=confirmed,unconfirmed | PASS |
| CAL-01.mem2.mine.prepared-hidden | mem2 | API mine=true | 0 events: only prepared assignments (P1 Drums, P4 Hosts) | 200 n=0 | PASS |
| CAL-01.multi.mine.selected-time | multi | API mine=true | P1: only the selected 11am service time (not rehearsal/9am); P5 declined shown w/ status … | 200 n=4 g · 11am:unconfirmed\|ehearsal:declined\|er · 9am:declined\|r · 11am:declined | PASS |
| CAL-01.multi.mine.declined-visible | multi | API mine=true | observation: declined P5 times returned as my_assignment_status=declined (3 events) | P5 events=3 | PASS |
| CAL-01.oa.mine.none | oa | API mine=true | 0 events (owner has no assignments) | 200 n=0 | PASS |
| CAL-01.mem.bounds.from=to=exact-start | mem | API | 1 event (inclusive bounds) | 200 n=1 | PASS |
| CAL-01.mem.bounds.1ms-after | mem | API | 0 events | 200 n=0 | PASS |
| CAL-01.mem.bounds.inverted | mem | API | 200 empty (or 400) | 200 n=0 | PASS |
| CAL-01.mem.bounds.offset-form | mem | API | 1 event with +00:00 offset form | 200 n=1 | PASS |
| CAL-01.mem.bounds.invalid-from | mem | API | 400 (not 500) | 400 {"error":"Invalid date or time","code":"bad_request"} | PASS |
| CAL-01.mem.bounds.calendar-invalid-date | mem | API | 400 | 400 {"error":"Invalid date or time","code":"bad_request"} | PASS |
| CAL-01.mem.bounds.missing-from | mem | API | 400 | 422 | PASS |
| CAL-01.mem.filter.bad-uuid | mem | API | 400 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"service_type_id","cod | PASS |
| CAL-01.mem.filter.bad-boolean | mem | API | 400 | 422 | PASS |
| CAL-01.mem.bounds.100-years | mem | API | 200 (no cap) – record: unbounded range allowed | 200 n=21 | PASS |
| CAL-01.mem.filter.unknown-service-type | mem | API | 200 empty | 200 n=0 | PASS |
| CAL-01.mem.filter.unknown-team | mem | API | 200 empty | 200 n=0 | PASS |
| CAL-01.mem.empty-range | mem | API | 200 [] | 200 [] | PASS |
| CAL-01.mem.timestamps-iso-offset | mem | API | starts_at parseable instants equal DB | 2026-11-13T23:00:00+00:00 | PASS |
| CAL-01.mem.draft-plan-visible | mem | API | OBSERVE: ordinary member sees draft plan P2 times (plans_select = is_org_member) | draft events=3 | PASS |
| CAL-01.anonymous.list | anonymous | API | 401 | 401 | PASS |
| CAL-01.other-org-owner.list-A | ob(B owner) | API X-Organization-Id=A | 403/404, no events | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| CAL-01.no-org-user.list-A | nob(no org) | API | 403/404 | 403 | PASS |
| CAL-01.multi.list-B | multi | API X-Organization-Id=B | 200 [] (B has no plans, no A leakage) | 200 [] | PASS |
| CAL-01.multi.no-org-header | multi | API no header, 2 orgs | 400/403 org required | 400 {"error":"Multiple organizations available — send an X-Organization-Id header","code":"bad_request", | PASS |
| CAL-01.multi.bad-org-header | multi | API | 400 | 400 | PASS |
| CAL-01.ob.substitute-A-service-type | ob | API | 200 [] (no A data) | 200 [] | PASS |
| CAL-01.mem2.rls.plan_times | mem2 | DB PostgREST caller JWT | member can read plan times of own org (3) | 200 n=3 | PASS |
| CAL-01.ob.rls.plan_times-other-org | ob | DB PostgREST caller JWT | [] | 200 [] | PASS |
| CAL-01.mem2.rls.assignments-prepared-own | mem2 | DB PostgREST | OBSERVE what mem2 sees on assignments for P1 | 200 released,released | PASS |
| CAL-01.owner.layers.default-no-optin | oa | API /calendar/layers | blockout present; NO birthday/anniversary before opt-in | 200 ["blockouts"] | PASS |
| CAL-01.owner.layers.blockout-no-reason | oa | API | blockout payload has no reason | leaks= | PASS |
| CAL-01.lead.layers.blockouts | lead | API | scheduling.manage on Band team => sees blockout | 200 n=1 | PASS |
| CAL-01.mem.layers.team-member-no-blockouts | mem | API | on-team non-leader: blockouts hidden, personal_dates allowed (none shared yet) | 200 n=0 | PASS |
| CAL-01.sch.layers.blockouts | sch | API | legacy scheduler has scheduling.manage org-wide => sees | 200 n=1 | PASS |
| CAL-01.adm.layers.blockouts | adm | API | admin => sees | 200 n=1 | PASS |
| CAL-01.mem2.layers.blockouts-other-team-member | mem2 | API | mem2 is on Band: no blockouts | 200 n=0 | PASS |
| CAL-01.multi.layers.not-on-team | multi | API | not on Hosts team and no schedule rights => 200 [] (access null) | 200 n=0 | PASS |
| CAL-01.mem2.sharing.set-other-person | mem2 | API PUT calendar-sharing for mem | 404 (cannot set another person's opt-in) | 404 | PASS |
| CAL-01.adm.sharing.set-other-person | adm | API | 404/403 (people.manage is owner-only) | 404 | PASS |
| CAL-01.sch.sharing.set-other-person | sch | API | 404/403 | 404 | PASS |
| CAL-01.mem.sharing.self-birthday-only | mem | API | 200 birthday only | 200 {"person_id":"fd0ad0ca-bb0a-48ba-9cb3-c781ff9bb68e","organization_id":"c7b4ffc7-3746-4144-987e-a80ca77e135d","share… | PASS |
| CAL-01.lead.layers.birthday-optin-only | lead | API | birthday visible (Nov 20 next occurrence), anniversary absent (separate opt-in) | 200 ["birthdays:2026-11-20"] | PASS |
| CAL-01.lead.layers.birthday-no-year-or-private | lead | API | no birth year beyond occurrence date, no phone/med/address | leaks= years=2026 | PASS |
| CAL-01.mem.layers.birthday-team-member | mem | API | on-team member sees shared birthday | 200 n=1 | PASS |
| CAL-01.mem2.layers.birthday-team-member | mem2 | API | on-team member sees birthday only | 200 ["birthdays"] | PASS |
| CAL-01.lead.layers.anniversary-optin-only | lead | API | anniversary only after toggling | 200 ["anniversaries"] | PASS |
| CAL-01.lead.layers.optout-removes | lead | API | opt-out removes both | 200 n=0 | PASS |
| CAL-01.oa.sharing.owner-sets-other | oa | API | 200 (owner has people.manage) | 200 | PASS |
| CAL-01.mem.sharing.invalid-body | mem | API | 400 | 422 | PASS |
| CAL-01.ob.sharing.cross-org-person | ob | API B-context, A person id | 404 | 404 | PASS |
| CAL-01.lead.layers.invalid-layer | lead | API | 400 | 422 | PASS |
| CAL-01.lead.layers.no-layer | lead | API | 400 | 422 | PASS |
| CAL-01.lead.layers.range>400d | lead | API | 400 (RPC bound 400 days) not 500 | 400 {"error":"Choose a range of at most 400 days","code":"bad_request"} | PASS |
| CAL-01.lead.layers.invalid-date | lead | API | 400 | 422 | PASS |
| CAL-01.lead.layers.bad-team-uuid | lead | API | 400 | 422 | PASS |
| CAL-01.lead.layers.unknown-team | lead | API | 404 | 404 | PASS |
| CAL-01.ob.layers.A-team-from-B-context | ob | API | 404 (team not in B) | 404 | PASS |
| CAL-01.anonymous.layers | anonymous | API | 401 | 401 | PASS |
| CAL-01.ob.layers.rpc-cross-org | ob | DB RPC caller JWT | [] (not a member of A) | 200 [] | PASS |
| CAL-01.mem.layers.rpc-blockouts | mem | DB RPC caller JWT | [] (member on team: no blockout layer) | 200 n=0 | PASS |
| CAL-01.lead.layers.rpc-blockouts | lead | DB RPC caller JWT | 1 blockout, no reason column | 200 n=1 cols=layer,source_id,person_id,person_name,on_date,starts_at,ends_at,all_day | PASS |
| CAL-01.mem.dst-spring-local-day | mem | API /calendar local day Mar 14 2027 (23h day) | 2 events: overnight rehearsal 07:30Z + service 14:00Z; instants unchanged | 200 Overnight@2027-03-14T07:30,9am@2027-03-14T14:00,9am@2027-03-14T15:00 | PASS |
| CAL-01.mem.dst-spring-service-only | mem | API | 1 DST service event | 1 | PASS |
| CAL-01.mem.dst-fall-local-day-and-boundaries | mem | API local day Nov 1 2026 (25h day) incl. boun… | FALL rehearsal+service, B-B (05:00:00Z) and B-C (05:59:59Z next day) included; B-A (04:59… | B-B start · 9am@2026-11-01T05:00:00,INT DST Fall · Overnight@2026-11-01T05:30:00,INT DST Fall · 9am@2026-11-01T15:00:00… | PASS |
| CAL-01.mem.dst-fall-mine | mem | API mine=true | mem released on FALL: 2 events with my_assignment_status | unconfirmed,unconfirmed | PASS |
| CAL-01.mem.exact-boundary-instant | mem | API from=to=04:59:59Z | exactly the B-A plan time | B-A before · 9am | PASS |
| CAL-01.web-mobile.navigation-filter-persistence | user | browser/mobile calendar UI | month/week/agenda navigation, filters persist, empty days, layer toggles | browser/native owned by QA-09/QA-13 | NOT_RUN |

### CAL-02 Calendar feeds (personal and scoped ICS) (128 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CAL-02.mem.personal.status-before | mem | API GET /me/calendar-feed | 200 active=false, url null | 200 {"url":null,"webcal_url":null,"active":false} | PASS |
| CAL-02.mem.personal.create | mem | API POST /me/calendar-feed | 201 url+webcal+token once, no-store | 201 cc=no-store webcal=true | PASS |
| CAL-02.mem.personal.status-after-no-secret | mem | API GET /me/calendar-feed | active=true, token/url not re-disclosed | 200 {"url":null,"webcal_url":null,"active":true} | PASS |
| CAL-02.mem.personal.token-entropy | mem | API | token >= 43 base64url chars | len=43 | PASS |
| CAL-02.mem2.personal.status-before | mem2 | API GET /me/calendar-feed | 200 active=false, url null | 200 {"url":null,"webcal_url":null,"active":false} | PASS |
| CAL-02.mem2.personal.create | mem2 | API POST /me/calendar-feed | 201 url+webcal+token once, no-store | 201 cc=no-store webcal=true | PASS |
| CAL-02.mem2.personal.status-after-no-secret | mem2 | API GET /me/calendar-feed | active=true, token/url not re-disclosed | 200 {"url":null,"webcal_url":null,"active":true} | PASS |
| CAL-02.mem2.personal.token-entropy | mem2 | API | token >= 43 base64url chars | len=43 | PASS |
| CAL-02.multi.personal.status-before | multi | API GET /me/calendar-feed | 200 active=false, url null | 200 {"url":null,"webcal_url":null,"active":false} | PASS |
| CAL-02.multi.personal.create | multi | API POST /me/calendar-feed | 201 url+webcal+token once, no-store | 201 cc=no-store webcal=true | PASS |
| CAL-02.multi.personal.status-after-no-secret | multi | API GET /me/calendar-feed | active=true, token/url not re-disclosed | 200 {"url":null,"webcal_url":null,"active":true} | PASS |
| CAL-02.multi.personal.token-entropy | multi | API | token >= 43 base64url chars | len=43 | PASS |
| CAL-02.oa.personal.status-before | oa | API GET /me/calendar-feed | 200 active=false, url null | 200 {"url":null,"webcal_url":null,"active":false} | PASS |
| CAL-02.oa.personal.create | oa | API POST /me/calendar-feed | 201 url+webcal+token once, no-store | 201 cc=no-store webcal=true | PASS |
| CAL-02.oa.personal.status-after-no-secret | oa | API GET /me/calendar-feed | active=true, token/url not re-disclosed | 200 {"url":null,"webcal_url":null,"active":true} | PASS |
| CAL-02.oa.personal.token-entropy | oa | API | token >= 43 base64url chars | len=43 | PASS |
| CAL-02.mem.personal.token-stored-hashed | mem | DB (setup read) | only hash stored: raw token not present in table | rows=1 rawfound=0 | PASS |
| CAL-02.mem.rls.feed-tokens-own-only | mem | DB PostgREST caller JWT | only own rows | 200 n=1 users=1 | PASS |
| CAL-02.ob.rls.feed-tokens-other-org | ob | DB PostgREST | [] | 200 [] | PASS |
| CAL-02.mem2.rls.feed-tokens-other-user | mem2 | DB PostgREST | [] (cannot see mem's token rows) | 200 [] | PASS |
| CAL-02.mem2.rls.insert-token-for-other-user | mem2 | DB PostgREST | denied (401/403) | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level | PASS |
| CAL-02.mem.feed.http | mem | public ICS GET | 200 text/calendar; charset=utf-8, private cache | 200 text/calendar; charset=utf-8 private, max-age=3600 | PASS |
| CAL-02.mem.feed.method-publish-no-organizer | mem | ICS | METHOD:PUBLISH, no ORGANIZER/ATTENDEE/METHOD:REQUEST (ADR 0003) | METHOD:PUBLISH org=false | PASS |
| CAL-02.mem.feed.crlf-endings | mem | ICS | all lines CRLF | bareLF=false | PASS |
| CAL-02.mem.feed.event-count | mem | ICS | 10 events: P1 x3, P3 x3, SPRING x2, FALL x2 (released only; prepared/other absent) | n=10 ? INT DST Fall · Overnight \| ? INT DST Fall · 9am \| INT Sunday Recent · Rehearsal \| INT Sunday Recent · 9am \| … | PASS |
| CAL-02.mem.feed.unconfirmed-marker | mem | ICS | unconfirmed P1 events prefixed "? "; confirmed P3 not | p1=??? p3=III | PASS |
| CAL-02.mem.feed.no-private-fields | mem | ICS | no notes/description/names/phone/reason/prepared | leaks= desc=false | PASS |
| CAL-02.mem.feed.uids-unique-stable | mem | ICS | unique UIDs of form plan-time-<id>@host | 10/10 | PASS |
| CAL-02.mem.feed.dst-spring-instant | mem | ICS | DTSTART 20270314T140000Z (09:00 CDT, after gap), DTEND +1h | 20270314T140000Z-20270314T150000Z | PASS |
| CAL-02.mem.feed.dst-fall-instant | mem | ICS | DTSTART 20261101T150000Z (09:00 CST after overlap) | 20261101T150000Z-20261101T160000Z | PASS |
| CAL-02.mem.feed.dst-overnight-instants | mem | ICS | rehearsals across the gap/overlap keep stored instants | 20270314T073000Z/20270314T093000Z 20261101T053000Z/20261101T083000Z | PASS |
| CAL-02.mem.feed.calname | mem | ICS | X-WR-CALNAME present | X-WR-CALNAME:Service Center schedule | PASS |
| CAL-02.mem.feed.last-used-recorded | mem | DB (setup read) | last_used_at set after fetch | t | PASS |
| CAL-02.mem2.feed.prepared-hidden | mem2 | ICS | 0 events (only prepared requests exist) | 200 n=0 leaks= | PASS |
| CAL-02.multi.feed.selected-time-only | multi | ICS | only P1 11am live (selected attendance) | ? INT Sunday Upcoming · 11am | PASS |
| CAL-02.multi.feed.declined-tombstone | multi | ICS | declined P5 times emitted as STATUS:CANCELLED tombstones (ADR 0002 feed updates) | cancelled=INT Sunday Later · Rehearsal\|INT Sunday Later · 9am\|INT Sunday Later · 11am | PASS |
| CAL-02.oa.feed.no-assignments-empty | oa | ICS | valid empty calendar | 200 n=0  | PASS |
| CAL-02.anonymous.feed.random-token | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.anonymous.feed.empty-ish | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"No route for GET /api/v1/calendar-feed/.ics","code | PASS |
| CAL-02.anonymous.feed.sql-ish | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.anonymous.feed.very-long | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.anonymous.feed.traversal | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.anonymous.feed.no-ext | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"No route for GET /api/v1/calendar-feed/M6uAMWmDj33 | PASS |
| CAL-02.anonymous.feed.mem-token-scoped-path | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.anonymous.feed.hash-as-token | anonymous | public ICS GET | 404 (not 200/500), no leak | 404 {"error":"Calendar feed not found","code":"not_found"} | PASS |
| CAL-02.mem.personal.rotate-old-dead | mem | API+ICS | old token 404 immediately | 201 old=404 | PASS |
| CAL-02.mem.personal.rotate-new-works-same-uids | mem | ICS | new token 200 with identical UIDs | 200 same=true | PASS |
| CAL-02.mem.personal.one-live-token | mem | DB | exactly 1 live token after rotate | 1 | PASS |
| CAL-02.mem.personal.concurrent-rotate | mem | API x5 parallel | no 500; exactly 1 live token; each response status 201/409 | 201,409,409,409,409 live=1 | PASS |
| CAL-02.ob.personal.create-for-A | ob | API X-Organization-Id=A | 400/403 (not a member) | 400 | PASS |
| CAL-02.anonymous.personal.create | anonymous | API | 401 | 401 | PASS |
| CAL-02.multi.personal.create-no-org | multi | API no org header (2 orgs) | 400 | 400 | PASS |
| CAL-02.multi.personal.org-B-feed-isolated | multi | ICS org B | no A events, no BSECRET | 200 n=0  | PASS |
| CAL-02.oa.redate.patch-plan-time | oa | API PATCH plan | 200 | 200 {"id":"f8836234-bce1-45f1-9d01-7093d1b82c95","organization_id":"c7b4ffc7-3746-4144-987e-a80ca77e135d","service_type… | PASS |
| CAL-02.mem.redate.uid-stable-sequence-bumped-time-updated | mem | ICS | same UID, DTSTART +1h, SEQUENCE greater | seq 3->4 start 20261121T160000Z->20261121T170000Z | PASS |
| CAL-02.oa.remove-assignment | oa | API DELETE assignment | 204/200 | 204 | PASS |
| CAL-02.mem.remove-assignment.cancelled-in-feed | mem | ICS | removed times remain as STATUS:CANCELLED with same UID and higher SEQUENCE (so subscribed… | before=3 after=CANCELLED:3/2,CANCELLED:3/2,CANCELLED:3/2 | PASS |
| CAL-02.mem.decline.api | mem | API respond | 200 | 200 | PASS |
| CAL-02.mem.decline.feed-behaviour | mem | ICS | declined request: events withdrawn (CANCELLED with bumped SEQUENCE) or omitted — ADR 0002… | before=3 after=3 CANCELLED,CANCELLED,CANCELLED | PASS |
| CAL-02.mem.decline.feed-no-reason | mem | ICS | decline reason not in feed | leaks= | PASS |
| CAL-02.mem.redecision.after-decline | mem | API respond | 409 (member cannot undo decline; scheduler decides) — product rule | 409 assignment_response_forbidden | PASS |
| CAL-02.mem.reinstated.feed-restored | mem | ICS | after scheduler/fixture reinstatement events are live again ("? " prefix), same UIDs, SEQ… | n=3 -?4,-?6,-?4 | PASS |
| CAL-02.mem.deactivated.feed-404 | mem | ICS | 404 after membership deactivated | 404 | PASS |
| CAL-02.mem.reactivated.feed-200 | mem | ICS | feed resumes after reactivation (same token) | 200 | PASS |
| CAL-02.mem.rls.update-own-token-hash | mem | DB PostgREST caller JWT PATCH calendar_feed_t… | token_hash is server-generated; client PATCH of token_hash denied (cf. scoped feeds: only… | 204 hashChanged=true | FAIL (W3-INT-D1) |
| CAL-02.mem.rls.unrevoke-own-token | mem | DB PostgREST PATCH revoked_at=null | a revoked token cannot be revived by the client | revoke-live 200; unrevoke-old 200 revived=true | FAIL (W3-INT-D1) |
| CAL-02.mem.scoped.st.create | mem | API POST /calendar/feeds | 201 url+webcal once, no-store, summary without token_hash | 201 cc=no-store keys=id,organization_id,user_id,scope_type,service_type_id,team_id,include_rehearsals,layers,label,crea… | PASS |
| CAL-02.mem.scoped.list-no-secret | mem | API GET /calendar/feeds | list has scope_name, no token/url/token_hash | 200 id,organization_id,user_id,scope_type,service_type_id,team_id,include_rehearsals,layers,label,created_at,last_used_… | PASS |
| CAL-02.mem.scoped.st.http | mem | public ICS | 200 text/calendar private cache | 200 text/calendar; charset=utf-8 private, max-age=3600 | PASS |
| CAL-02.mem.scoped.st.published-only | mem | ICS | published Sunday plans only (no Draft, no Midweek, no other org): P1,P3,P5,P6,P7,SPRING,F… | n=19 draft=false midweek=false B=false | PASS |
| CAL-02.mem.scoped.st.no-private | mem | ICS | no notes/descriptions/names/assignments | leaks= desc=false | PASS |
| CAL-02.mem.scoped.st.calname-escaped | mem | ICS | label escaped (, ; ") and folded <=75 octets per line | X-WR-CALNAME:My Sunday\, "feed"\; ünï 🎵 maxLine=75 | PASS |
| CAL-02.mem.scoped.st.uid-distinct-from-personal | mem | ICS | UID contains -st-<id> | plan-time-513cfe2c-3bb8-476b-b2f6-9784cb5a37ba-st-f17ef26e-5a36-45d3-9036-7ea64e9028b4@localhost:4000 | PASS |
| CAL-02.mem.scoped.st.no-rehearsals | mem | ICS | no rehearsal events | n=12 reh=0 | PASS |
| CAL-02.mem.scoped.st.layers-rejected | mem | API | 422 (layers only on team feeds) | 422 | PASS |
| CAL-02.mem.scoped.team.create-on-team | mem | API | 201 (member of Band) | 201 | PASS |
| CAL-02.lead.scoped.team.create | lead | API | 201 (scheduling.manage on Band) | 201 | PASS |
| CAL-02.sch.scoped.team.create | sch | API | 201 (legacy scheduler) | 201 | PASS |
| CAL-02.multi.scoped.team.create-not-on-team | multi | API | 403 (not on Hosts, no schedule rights) | 403 {"error":"You cannot subscribe to that calendar","code":"forbidden"} | PASS |
| CAL-02.lead.scoped.team.create-other-team | lead | API | 403 (grant is Band only) | 403 | PASS |
| CAL-02.nob.scoped.team.create | nob | API | 403/400 | 403 | PASS |
| CAL-02.ob.scoped.team.create-A-team-A-ctx | ob | API | 403/404 not a member | 403 | PASS |
| CAL-02.ob.scoped.team.substitute-A-team-in-B-ctx | ob | API B ctx + A team id | 403 (RLS insert check / FK) not created | 403 {"error":"You cannot subscribe to that calendar","code":"forbidden"} | PASS |
| CAL-02.ob.scoped.st.substitute-A-st-in-B-ctx | ob | API | not created | 403 | PASS |
| CAL-02.mem.scoped.st.unknown-id | mem | API | 403/400, not 500 | 403 | PASS |
| CAL-02.anonymous.scoped.create | anonymous | API | 401 | 401 | PASS |
| CAL-02.mem.scoped.both-scopes | mem | API | 422 | 422 | PASS |
| CAL-02.mem.scoped.missing-scope | mem | API | 422 | 422 | PASS |
| CAL-02.mem.scoped.label-81 | mem | API | 422 | 422 | PASS |
| CAL-02.mem.scoped.bad-layer | mem | API | 422 | 422 | PASS |
| CAL-02.lead.scoped.team.names-for-schedulers | lead | ICS | event descriptions list scheduled names (released, not declined) with position; no prepar… | events=8 names=true mem2=false declined=false | PASS |
| CAL-02.lead.scoped.team.no-private | lead | ICS | no phone/med/addr/notes/reason | leaks= | PASS |
| CAL-02.lead.scoped.team.blockout-layer | lead | ICS | Unavailable layer (all-day, TRANSPARENT) w/o reason | n=1 transp=true reason=false | PASS |
| CAL-02.mem.scoped.team.counts-only | mem | ICS | on-team non-scheduler: "N scheduled" only, no names; blockouts layer absent | names=false unavail=0 sample=1 scheduled | PASS |
| CAL-02.mem.scoped.team.birthday-optin | mem | ICS | Birthday: only for opted-in, all-day (VALUE=DATE), no birth year, no Anniversary | bd=Birthday: QA INT mem 20261120 ann=0 | PASS |
| CAL-02.mem.scoped.team.birthday-optout | mem | ICS | opt-out removes Birthday immediately (feed regenerated per fetch) | bd=0 | PASS |
| CAL-02.mem.scoped.rotate | mem | API | 201 new url once; id changes; scope kept | 201 sameScope=true newId=true | PASS |
| CAL-02.mem.scoped.rotate-old-dead | mem | ICS | old URL 404 | 404 | PASS |
| CAL-02.mem.scoped.rotate-new-live-same-uids | mem | ICS | 200 and UIDs unchanged across rotation | 200 same=true | PASS |
| CAL-02.mem.scoped.rotate-already-revoked | mem | API | 404 | 404 | PASS |
| CAL-02.mem2.scoped.rotate-other-users-feed | mem2 | API | 404 | 404 | PASS |
| CAL-02.mem2.scoped.revoke-other-users-feed | mem2 | API | 404; feed still live | 404 live=t | PASS |
| CAL-02.oa.scoped.revoke-other-users-feed | oa | API (owner) | 404 (feeds are strictly personal) | 404 | PASS |
| CAL-02.ob.scoped.revoke-cross-org | ob | API | 404 | 404 | PASS |
| CAL-02.mem2.rls.scoped-feeds-own-only | mem2 | DB PostgREST | no rows of mem | 200 n=0 | PASS |
| CAL-02.mem.rls.scoped-feeds-hash-not-writable | mem | DB PostgREST | denied (column grant revoked_at only) | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr | PASS |
| CAL-02.mem.rls.scoped-feeds-unrevoke-denied | mem | DB PostgREST | revoked_at can only be set non-null | 403 | PASS |
| CAL-02.mem.scoped.revoke | mem | API | 204 | 204 | PASS |
| CAL-02.mem.scoped.revoke-twice | mem | API | 404 | 404 | PASS |
| CAL-02.mem.scoped.revoke-bad-uuid | mem | API | 400 | 400 | PASS |
| CAL-02.mem.scoped.revoke-unknown | mem | API | 404 | 404 | PASS |
| CAL-02.mem.scoped.revoked-feed-404 | mem | ICS | revoked st feed URL 404 | 404 | PASS |
| CAL-02.lead.scoped.team.grant-revoked-feed-404 | lead | ICS | 404 after scheduling.manage grant removed (access re-checked per fetch) | before=200 grant=200 after=404 | PASS |
| CAL-02.lead.scoped.list-after-grant-loss | lead | API | feed still listed (revocable) even though dead | 200 n=1 | PASS |
| CAL-02.lead.scoped.team.grant-restored-feed-200 | lead | ICS | 200 after restore | 200 | PASS |
| CAL-02.mem2.scoped.team.removed-from-team-404 | mem2 | ICS | 404 after roster removal | before=200 del=204 after=404 | PASS |
| CAL-02.lead.scoped.team.deactivated-404 | lead | ICS | 404 when membership inactive | 404 | PASS |
| CAL-02.mem.scoped.create-while-inactive | mem | API | 403/400/404 (inactive members cannot act) | 403 | PASS |
| CAL-02.anonymous.scoped.random | anonymous | public ICS | 404 | 404 | PASS |
| CAL-02.anonymous.scoped.personal-token-on-scoped-path | anonymous | public ICS | 404 | 404 | PASS |
| CAL-02.anonymous.scoped.empty | anonymous | public ICS | 404 | 404 | PASS |
| CAL-02.anonymous.scoped.long | anonymous | public ICS | 404 | 404 | PASS |
| CAL-02.anonymous.scoped-token-on-personal-path | anonymous | public ICS | 404 (token namespaces separate) | 404 | PASS |
| CAL-02.mem2.scoped.cap-20-live | mem2 | API | 21st live feed => 409 | created=19 total=20 last=409 | PASS |
| CAL-02.oa.hostile-plan.create | oa | API | plan with CRLF in title/location accepted (or rejected 4xx) | 201 | PASS |
| CAL-02.anonymous.hostile-plan.ics-injection | mem feed | ICS | CR/LF in title/location escaped: no extra VEVENT/ATTENDEE/SUMMARY lines | events=13 attendee=false extraSummary=0 | PASS |
| CAL-02.web-mobile.subscribe-copy-share | user | browser/mobile settings + calendar-subscripti… | copy/share/webcal subscribe, raw token handling on native | browser/native owned by QA-09/QA-13 | NOT_RUN |
| CAL-02.personal-feed.revoke-without-rotate | mem | API/source | plan lists "revoke"; personal feed exposes only create(=rotate) and status; no DELETE /me… | route inventory: GET/POST only (routes/me.ts:131,139) | FAIL |

### REPORT-02 Reports, CSV and tracked exports (220 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| REPORT-02.web-mobile.print-share-ui | user | browser/mobile reports page, schedule-report … | print layout, share sheet, export queue UI, download expiry banner | browser/native owned by QA-09/QA-13 | NOT_RUN |
| REPORT-02.oa.staffing.json | oa | API GET /reports/staffing?format=json | 200 | 200 | PASS |
| REPORT-02.oa.staffing.csv | oa | API GET /reports/staffing?format=csv | 200 | 200 | PASS |
| REPORT-02.adm.staffing.json | adm | API GET /reports/staffing?format=json | 200 | 200 | PASS |
| REPORT-02.adm.staffing.csv | adm | API GET /reports/staffing?format=csv | 200 | 200 | PASS |
| REPORT-02.sch.staffing.json | sch | API GET /reports/staffing?format=json | 200 | 200 | PASS |
| REPORT-02.sch.staffing.csv | sch | API GET /reports/staffing?format=csv | 200 | 200 | PASS |
| REPORT-02.lead.staffing.json | lead | API GET /reports/staffing?format=json | 200 | 200 | PASS |
| REPORT-02.lead.staffing.csv | lead | API GET /reports/staffing?format=csv | 200 | 200 | PASS |
| REPORT-02.mem.staffing.json | mem | API GET /reports/staffing?format=json | 403 | 403 | PASS |
| REPORT-02.mem.staffing.csv | mem | API GET /reports/staffing?format=csv | 403 | 403 | PASS |
| REPORT-02.mem2.staffing.json | mem2 | API GET /reports/staffing?format=json | 403 | 403 | PASS |
| REPORT-02.mem2.staffing.csv | mem2 | API GET /reports/staffing?format=csv | 403 | 403 | PASS |
| REPORT-02.multi.staffing.json | multi | API GET /reports/staffing?format=json | 403 | 403 | PASS |
| REPORT-02.multi.staffing.csv | multi | API GET /reports/staffing?format=csv | 403 | 403 | PASS |
| REPORT-02.anonymous.staffing | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.staffing.other-org | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.ob.staffing.own-org-no-A-data | ob | API B ctx, A service type id | 200 empty rows, no A data | 200 leaks= | PASS |
| REPORT-02.oa.participation.json | oa | API GET /reports/participation?format=json | 200 | 200 | PASS |
| REPORT-02.oa.participation.csv | oa | API GET /reports/participation?format=csv | 200 | 200 | PASS |
| REPORT-02.adm.participation.json | adm | API GET /reports/participation?format=json | 200 | 200 | PASS |
| REPORT-02.adm.participation.csv | adm | API GET /reports/participation?format=csv | 200 | 200 | PASS |
| REPORT-02.sch.participation.json | sch | API GET /reports/participation?format=json | 200 | 200 | PASS |
| REPORT-02.sch.participation.csv | sch | API GET /reports/participation?format=csv | 200 | 200 | PASS |
| REPORT-02.lead.participation.json | lead | API GET /reports/participation?format=json | 200 | 200 | PASS |
| REPORT-02.lead.participation.csv | lead | API GET /reports/participation?format=csv | 200 | 200 | PASS |
| REPORT-02.mem.participation.json | mem | API GET /reports/participation?format=json | 403 | 403 | PASS |
| REPORT-02.mem.participation.csv | mem | API GET /reports/participation?format=csv | 403 | 403 | PASS |
| REPORT-02.mem2.participation.json | mem2 | API GET /reports/participation?format=json | 403 | 403 | PASS |
| REPORT-02.mem2.participation.csv | mem2 | API GET /reports/participation?format=csv | 403 | 403 | PASS |
| REPORT-02.multi.participation.json | multi | API GET /reports/participation?format=json | 403 | 403 | PASS |
| REPORT-02.multi.participation.csv | multi | API GET /reports/participation?format=csv | 403 | 403 | PASS |
| REPORT-02.anonymous.participation | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.participation.other-org | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.ob.participation.own-org-no-A-data | ob | API B ctx, A service type id | 200 empty rows, no A data | 200 leaks= | PASS |
| REPORT-02.oa.schedule.json | oa | API GET /reports/schedule?format=json | 200 | 200 | PASS |
| REPORT-02.oa.schedule.csv | oa | API GET /reports/schedule?format=csv | 200 | 200 | PASS |
| REPORT-02.adm.schedule.json | adm | API GET /reports/schedule?format=json | 200 | 200 | PASS |
| REPORT-02.adm.schedule.csv | adm | API GET /reports/schedule?format=csv | 200 | 200 | PASS |
| REPORT-02.sch.schedule.json | sch | API GET /reports/schedule?format=json | 200 | 200 | PASS |
| REPORT-02.sch.schedule.csv | sch | API GET /reports/schedule?format=csv | 200 | 200 | PASS |
| REPORT-02.lead.schedule.json | lead | API GET /reports/schedule?format=json | 200 | 200 | PASS |
| REPORT-02.lead.schedule.csv | lead | API GET /reports/schedule?format=csv | 200 | 200 | PASS |
| REPORT-02.mem.schedule.json | mem | API GET /reports/schedule?format=json | 403 | 403 | PASS |
| REPORT-02.mem.schedule.csv | mem | API GET /reports/schedule?format=csv | 403 | 403 | PASS |
| REPORT-02.mem2.schedule.json | mem2 | API GET /reports/schedule?format=json | 403 | 403 | PASS |
| REPORT-02.mem2.schedule.csv | mem2 | API GET /reports/schedule?format=csv | 403 | 403 | PASS |
| REPORT-02.multi.schedule.json | multi | API GET /reports/schedule?format=json | 403 | 403 | PASS |
| REPORT-02.multi.schedule.csv | multi | API GET /reports/schedule?format=csv | 403 | 403 | PASS |
| REPORT-02.anonymous.schedule | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.schedule.other-org | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.ob.schedule.own-org-no-A-data | ob | API B ctx, A service type id | 200 empty rows, no A data | 200 leaks= | PASS |
| REPORT-02.oa.song-usage.json | oa | API GET /reports/song-usage?format=json | 200 | 200 | PASS |
| REPORT-02.oa.song-usage.csv | oa | API GET /reports/song-usage?format=csv | 200 | 200 | PASS |
| REPORT-02.adm.song-usage.json | adm | API GET /reports/song-usage?format=json | 200 | 200 | PASS |
| REPORT-02.adm.song-usage.csv | adm | API GET /reports/song-usage?format=csv | 200 | 200 | PASS |
| REPORT-02.sch.song-usage.json | sch | API GET /reports/song-usage?format=json | 200 | 200 | PASS |
| REPORT-02.sch.song-usage.csv | sch | API GET /reports/song-usage?format=csv | 200 | 200 | PASS |
| REPORT-02.lead.song-usage.json | lead | API GET /reports/song-usage?format=json | 200 | 200 | PASS |
| REPORT-02.lead.song-usage.csv | lead | API GET /reports/song-usage?format=csv | 200 | 200 | PASS |
| REPORT-02.mem.song-usage.json | mem | API GET /reports/song-usage?format=json | 403 | 403 | PASS |
| REPORT-02.mem.song-usage.csv | mem | API GET /reports/song-usage?format=csv | 403 | 403 | PASS |
| REPORT-02.mem2.song-usage.json | mem2 | API GET /reports/song-usage?format=json | 403 | 403 | PASS |
| REPORT-02.mem2.song-usage.csv | mem2 | API GET /reports/song-usage?format=csv | 403 | 403 | PASS |
| REPORT-02.multi.song-usage.json | multi | API GET /reports/song-usage?format=json | 403 | 403 | PASS |
| REPORT-02.multi.song-usage.csv | multi | API GET /reports/song-usage?format=csv | 403 | 403 | PASS |
| REPORT-02.anonymous.song-usage | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.song-usage.other-org | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.ob.song-usage.own-org-no-A-data | ob | API B ctx, A service type id | 200 empty rows, no A data | 200 leaks= | PASS |
| REPORT-02.oa.run-times.json | oa | API GET /reports/run-times?format=json | 200 | 200 | PASS |
| REPORT-02.oa.run-times.csv | oa | API GET /reports/run-times?format=csv | 200 | 200 | PASS |
| REPORT-02.adm.run-times.json | adm | API GET /reports/run-times?format=json | 200 | 200 | PASS |
| REPORT-02.adm.run-times.csv | adm | API GET /reports/run-times?format=csv | 200 | 200 | PASS |
| REPORT-02.sch.run-times.json | sch | API GET /reports/run-times?format=json | 200 | 200 | PASS |
| REPORT-02.sch.run-times.csv | sch | API GET /reports/run-times?format=csv | 200 | 200 | PASS |
| REPORT-02.lead.run-times.json | lead | API GET /reports/run-times?format=json | 200 | 200 | PASS |
| REPORT-02.lead.run-times.csv | lead | API GET /reports/run-times?format=csv | 200 | 200 | PASS |
| REPORT-02.mem.run-times.json | mem | API GET /reports/run-times?format=json | 403 | 403 | PASS |
| REPORT-02.mem.run-times.csv | mem | API GET /reports/run-times?format=csv | 403 | 403 | PASS |
| REPORT-02.mem2.run-times.json | mem2 | API GET /reports/run-times?format=json | 403 | 403 | PASS |
| REPORT-02.mem2.run-times.csv | mem2 | API GET /reports/run-times?format=csv | 403 | 403 | PASS |
| REPORT-02.multi.run-times.json | multi | API GET /reports/run-times?format=json | 403 | 403 | PASS |
| REPORT-02.multi.run-times.csv | multi | API GET /reports/run-times?format=csv | 403 | 403 | PASS |
| REPORT-02.anonymous.run-times | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.run-times.other-org | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.ob.run-times.own-org-no-A-data | ob | API B ctx, A service type id | 200 empty rows, no A data | 200 leaks= | PASS |
| REPORT-02.oa.staffing.no-private-data | oa | API json+csv | no phone/med/address/notes/decline-reason; no prepared-only person (mem2 first_name senti… | json= csv= | PASS |
| REPORT-02.oa.participation.no-private-data | oa | API json+csv | no phone/med/address/notes/decline-reason; no prepared-only person (mem2 first_name senti… | json= csv= | PASS |
| REPORT-02.oa.schedule.no-private-data | oa | API json+csv | no phone/med/address/notes/decline-reason; no prepared-only person (mem2 first_name senti… | json= csv= | PASS |
| REPORT-02.oa.schedule.released-only | oa | API | schedule rows = released requests only (3 rows in st1 -10..+40d: mem P1, multi P1(11am), … | n=3 people=QA INT multi,QA INT mem | PASS |
| REPORT-02.oa.schedule.row-fields | oa | API | row has only expected keys (no contact fields) | plan_id,plan_title,service_date,service_type,team_name,position_name,person_id,person_name,response,times | PASS |
| REPORT-02.lead.schedule.scoped-to-band | lead | API | only Band team rows; scope_note present | teams=Band INT note=Only the teams and service types you schedule are included. | PASS |
| REPORT-02.lead.schedule.no-hosts-no-prepared | lead | API all service types | no Hosts (prepared-only) rows / no mem2 prepared | Band INT | PASS |
| REPORT-02.lead.song-usage.scoped-service-types | lead | API | only st1 (plans.edit scope) plans; Midweek (st2) excluded | rows=2 note=Only plans of service types you edit are included. | PASS |
| REPORT-02.oa.participation.dedup-person-plans | oa | API | mem: assignments counted once per plan (released P1,SPRING,FALL…) | {"person_id":"fd0ad0ca-bb0a-48ba-9cb3-c781ff9bb68e","person_name":"QA INT mem","archived":false,"teams":["Band INT"],"a… | PASS |
| REPORT-02.oa.schedule.validation.from-after-to | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.367-days | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.missing-from | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.bad-date | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.bad-status | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.bad-uuid | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.bad-format | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.validation.bad-bool | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.schedule.366-day-max-ok | oa | API | 366 inclusive days accepted | 200 | PASS |
| REPORT-02.oa.schedule.367-days-rejected | oa | API | rejected | 422 | PASS |
| REPORT-02.oa.schedule.unknown-service-type-empty | oa | API | 200 empty | 200 rows=0 | PASS |
| REPORT-02.oa.schedule.empty-range | oa | API | 200 empty rows; CSV valid header only | 200 | PASS |
| REPORT-02.oa.schedule.empty-csv | oa | API csv | header columns row present, no data rows | rows=15 last=Date\|Plan\|Service type\|Team\|Position\|Person\|Response\|Times | PASS |
| REPORT-02.oa.staffing.csv-matches-json | oa | API csv vs json | CSV data row count == JSON row count; all rows same width | csv=3 json=3 | PASS |
| REPORT-02.oa.staffing.csv-headers | oa | API csv | Content-Type text/csv utf-8, attachment filename kind-from-to.csv, no-store | text/csv; charset=utf-8 \| attachment; filename="staffing-2026-11-08-to-2026-12-28.csv" \| no-store | PASS |
| REPORT-02.oa.staffing.csv-crlf-terminated | oa | API csv | CRLF row terminators; final CRLF | true bareLF=false | PASS |
| REPORT-02.oa.staffing.csv-bom | oa | API csv | UTF-8 BOM present so Excel decodes Vietnamese/accents (plan 5.H "BOM") | startsWithBOM=false first=Report,Staff | FAIL (W3-INT-D3) |
| REPORT-02.oa.participation.csv-matches-json | oa | API csv vs json | CSV data row count == JSON row count; all rows same width | csv=2 json=2 | PASS |
| REPORT-02.oa.participation.csv-headers | oa | API csv | Content-Type text/csv utf-8, attachment filename kind-from-to.csv, no-store | text/csv; charset=utf-8 \| attachment; filename="participation-2026-11-08-to-2026-12-28.csv" \| no-store | PASS |
| REPORT-02.oa.participation.csv-crlf-terminated | oa | API csv | CRLF row terminators; final CRLF | true bareLF=false | PASS |
| REPORT-02.oa.participation.csv-bom | oa | API csv | UTF-8 BOM present so Excel decodes Vietnamese/accents (plan 5.H "BOM") | startsWithBOM=false first=Report,Parti | FAIL (W3-INT-D3) |
| REPORT-02.oa.schedule.csv-matches-json | oa | API csv vs json | CSV data row count == JSON row count; all rows same width | csv=3 json=3 | PASS |
| REPORT-02.oa.schedule.csv-headers | oa | API csv | Content-Type text/csv utf-8, attachment filename kind-from-to.csv, no-store | text/csv; charset=utf-8 \| attachment; filename="schedule-2026-11-08-to-2026-12-28.csv" \| no-store | PASS |
| REPORT-02.oa.schedule.csv-crlf-terminated | oa | API csv | CRLF row terminators; final CRLF | true bareLF=false | PASS |
| REPORT-02.oa.schedule.csv-bom | oa | API csv | UTF-8 BOM present so Excel decodes Vietnamese/accents (plan 5.H "BOM") | startsWithBOM=false first=Report,Multi | FAIL (W3-INT-D3) |
| REPORT-02.oa.song-usage.csv-matches-json | oa | API csv vs json | CSV data row count == JSON row count; all rows same width | csv=2 json=2 | PASS |
| REPORT-02.oa.song-usage.csv-headers | oa | API csv | Content-Type text/csv utf-8, attachment filename kind-from-to.csv, no-store | text/csv; charset=utf-8 \| attachment; filename="song-usage-2026-11-08-to-2026-12-28.csv" \| no-store | PASS |
| REPORT-02.oa.song-usage.csv-crlf-terminated | oa | API csv | CRLF row terminators; final CRLF | true bareLF=false | PASS |
| REPORT-02.oa.song-usage.csv-bom | oa | API csv | UTF-8 BOM present so Excel decodes Vietnamese/accents (plan 5.H "BOM") | startsWithBOM=false first=Report,Song  | FAIL (W3-INT-D3) |
| REPORT-02.oa.participation.formula-cells-neutralised | oa | API csv | cells beginning = + - @ TAB prefixed with apostrophe | '-2+3 Person2 \| '	TAB Person4 \| '@cmd Person3 \| '=HYPERLINK("http://e.test","c") Person14 \| '+SUM(A1) Person1 \| '=… | PASS |
| REPORT-02.oa.participation.formula-hyperlink-with-quotes | oa | API csv | =HYPERLINK("..") neutralised and quote-escaped round trip | '=HYPERLINK("http://e.test","c") Person14 | PASS |
| REPORT-02.oa.participation.quote-comma-roundtrip | oa | API csv | Quote "q", comma survives CSV round trip | Quote "q", comma Person5 | PASS |
| REPORT-02.oa.participation.embedded-newline | oa | API csv | newline inside quoted cell preserved, row count unaffected | "Line\nBreak Person6" | PASS |
| REPORT-02.oa.participation.unicode | oa | API csv | Vietnamese + emoji intact (UTF-8) | 🎵 Émile Person8,Nguyễn Thị Ánh Person7 | PASS |
| REPORT-02.oa.participation.html-text-not-escaped-in-csv | oa | API csv | HTML-like text is data in CSV (no executable context) — kept verbatim | <script>alert(1)</script> Person9 | PASS |
| REPORT-02.oa.participation.duplicate-names-distinct-rows | oa | API csv | 3 "Dup Name" persons are 3 rows | 3 | PASS |
| REPORT-02.oa.participation.row-count-250 | oa | API csv | 250 people with assignments? (60x40 rotation => all 250 appear) | rows=250 | PASS |
| REPORT-02.oa.participation.json-vs-csv-volume | oa | API | json rows == csv rows (250), truncated=false | 250 vs 250 trunc=false | PASS |
| REPORT-02.oa.schedule.2400-rows-truncation-signalled | oa | API json | 2400 matching requests: truncated=true and exactly 2000 rows (documented cap) | truncated=false rows=1000 summary.assignments=1000 | FAIL (W3-INT-D2) |
| REPORT-02.oa.schedule.2400-rows-csv-notice | oa | API csv | CSV states Truncated: first 2000 rows | undefined dataRows=1000 | FAIL (W3-INT-D2) |
| REPORT-02.oa.schedule.summary-vs-rows | oa | API | summary counts match returned rows or declare truncation (summary should not claim totals… | summary={"plans":25,"assignments":1000,"people":250} rows=1000 | FAIL (W3-INT-D2: ) |
| REPORT-02.oa.boundary.dst-fall-day-bounds | oa | API | Nov 1 (25h CDT->CST day) includes plans at 05:00:00Z and 05:59:59Z-next-day, excludes 04:… | occ=2 plans=2 tz=America/Chicago | PASS |
| REPORT-02.oa.boundary.prev-day-gets-04:59:59Z | oa | API | Oct 31 includes only 04:59:59Z plan (1) | occ=1 | PASS |
| REPORT-02.oa.boundary.next-day-gets-06:00:00Z | oa | API | Nov 2 includes only 06:00:00Z plan (1) | occ=1 | PASS |
| REPORT-02.oa.boundary.three-day-range-all-four | oa | API | all 4 | occ=4 | PASS |
| REPORT-02.oa.csv.header-block-timezone | oa | API csv | header shows Timezone America/Chicago, Dates range, Generated UTC | Report=Song usage \| Generated at (UTC)=2026-11-18T17:24:34.906Z \| Timezone=America/Chicago \| Dates=2026-11-01 to 202… | PASS |
| REPORT-02.oa.export.request | oa | API POST /reports/exports | 202 queued | 202 queued | PASS |
| REPORT-02.adm.export.request | adm | API POST /reports/exports | 202 queued | 202 queued | PASS |
| REPORT-02.sch.export.request | sch | API POST /reports/exports | 202 queued | 202 queued | PASS |
| REPORT-02.lead.export.request | lead | API POST /reports/exports | 202 queued | 202 queued | PASS |
| REPORT-02.mem.export.request | mem | API POST /reports/exports | 403 | 403 You do not have access to do that | PASS |
| REPORT-02.mem2.export.request | mem2 | API POST /reports/exports | 403 | 403 You do not have access to do that | PASS |
| REPORT-02.multi.export.request | multi | API POST /reports/exports | 403 | 403 You do not have access to do that | PASS |
| REPORT-02.anonymous.export.request | anonymous | API | 401 | 401 | PASS |
| REPORT-02.ob.export.request-A | ob | API X-Org=A | 403/404 | 403 | PASS |
| REPORT-02.oa.export.song_usage | oa | API | 202 | 202 | PASS |
| REPORT-02.oa.export.validation.bad-kind | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.export.validation.short-key | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.export.validation.no-filters | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.export.validation.range-too-long | oa | API | 422 | 422 | PASS |
| REPORT-02.oa.export.idempotent-replay | oa | API | same key + same body => same job id, no second row | true rows=1 | PASS |
| REPORT-02.oa.export.idempotency-key-reuse-different-body | oa | API | 409 | 409 idempotency_key_reused | PASS |
| REPORT-02.oa.export.concurrent-same-key | oa | API x5 parallel | one job; all 202 same id | 202,202,202,202,202 ids=1 rows=1 | PASS |
| REPORT-02.oa.export.list-own | oa | API | own exports only, no storage_path/paths | 200 n=4 keys=id,organization_id,requested_by,kind,filters,status,attempts,next_attempt_at,error_code,row_count,size_byt… | PASS |
| REPORT-02.adm.export.list-excludes-others | adm | API | admin does not see owner's exports | n=1 | PASS |
| REPORT-02.mem.export.list | mem | API | 200 [] (no exports) — or 403 | 200 [] | PASS |
| REPORT-02.ob.export.list-own-org | ob | API | [] | [] | PASS |
| REPORT-02.worker.run | worker(4591) | HTTP /internal/deliveries/run | 200 and report_exports.claimed>=3 (processes every org – QA-07 shares worker) | 200 {"claimed":7,"ready":7,"failed":0,"retried":0,"expired":0} | PASS |
| REPORT-02.oa.export.ready | oa | API list | schedule export ready with row_count, size_bytes, expires_at ~24h | ready rows=1000 size=96139 exp=2026-11-19T17:26:00.476+00:00 | PASS |
| REPORT-02.oa.export.full-not-truncated | oa | API/export | async export of 2400 requests should contain all 2400 rows (plan §5.H "pagination does no… | row_count=1000 (DB truth 2400) | FAIL (W3-INT-D2) |
| REPORT-02.oa.export.download-url | oa | API download | signed URL w/ filename schedule-<from>-to-<to>.csv, no-store | 200 schedule-2027-01-16-to-2027-03-18.csv cc=no-store | PASS |
| REPORT-02.oa.export.file-fetch | oa | signed URL GET | 200 text/csv, attachment filename, matches row_count rows | 200 text/csv attachment; filename=schedule-2027-01-16-to-2027-03-18.csv; filename*=UTF-8''schedule-2027-01-16-to-2027-0… | PASS |
| REPORT-02.oa.export.file-rows | oa | file | data rows == row_count | 1000 vs 1000 | PASS |
| REPORT-02.oa.export.file-no-private | oa | file | no private sentinels; formula cells neutralised | leaks= rawFormula=0 | PASS |
| REPORT-02.oa.export.file-bom | oa | file | UTF-8 BOM | false | FAIL (W3-INT-D3) |
| REPORT-02.adm.export.download-others-export | adm | API | 404 | 404 | PASS |
| REPORT-02.adm.export.retry-others-export | adm | API | 404 | 404 | PASS |
| REPORT-02.sch.export.download-others-export | sch | API | 404 | 404 | PASS |
| REPORT-02.sch.export.retry-others-export | sch | API | 404 | 404 | PASS |
| REPORT-02.lead.export.download-others-export | lead | API | 404 | 404 | PASS |
| REPORT-02.lead.export.retry-others-export | lead | API | 404 | 404 | PASS |
| REPORT-02.mem.export.download-others-export | mem | API | 404 | 404 | PASS |
| REPORT-02.mem.export.retry-others-export | mem | API | 404 | 404 | PASS |
| REPORT-02.mem2.export.download-others-export | mem2 | API | 404 | 404 | PASS |
| REPORT-02.mem2.export.retry-others-export | mem2 | API | 404 | 404 | PASS |
| REPORT-02.ob.export.download-cross-org | ob | API | 404 | 404 | PASS |
| REPORT-02.ob.export.download-A-ctx | ob | API | 403/404 | 403 | PASS |
| REPORT-02.anonymous.export.download | anonymous | API | 401 | 401 | PASS |
| REPORT-02.oa.export.download-bad-uuid | oa | API | 400 | 400 | PASS |
| REPORT-02.oa.export.download-unknown | oa | API | 404 | 404 | PASS |
| REPORT-02.oa.storage.direct-own | oa | Storage caller JWT | 200 for requester | 200 | PASS |
| REPORT-02.adm.storage.direct-others | adm | Storage caller JWT | denied (400/401/403/404) | 400 | PASS |
| REPORT-02.sch.storage.direct-others | sch | Storage caller JWT | denied (400/401/403/404) | 400 | PASS |
| REPORT-02.lead.storage.direct-others | lead | Storage caller JWT | denied (400/401/403/404) | 400 | PASS |
| REPORT-02.mem.storage.direct-others | mem | Storage caller JWT | denied (400/401/403/404) | 400 | PASS |
| REPORT-02.ob.storage.direct-others | ob | Storage caller JWT | denied (400/401/403/404) | 400 | PASS |
| REPORT-02.anonymous.storage.direct | anonymous | Storage anon key | denied | 400 | PASS |
| REPORT-02.anonymous.storage.public-path | anonymous | Storage /object/public | denied (bucket private) | 400 | PASS |
| REPORT-02.mem.storage.list-prefix | mem | Storage list caller JWT | no objects | 200 n=0 | PASS |
| REPORT-02.oa.export.participation-hostile-names | oa | file | formula/quote/newline/unicode cells intact & neutralised | n=250 formula=true quote=true nl=true uni=true | PASS |
| REPORT-02.lead.export.access-revoked-before-worker | lead | worker | job fails access_revoked; no file; no retry loop | failed access_revoked path=none | PASS |
| REPORT-02.lead.export.retry-without-access | lead | API retry | 403 (can_run_report false) — not requeued | 403 status=failed | PASS |
| REPORT-02.lead.export.retry-after-restore | lead | API retry | 202 queued, attempts reset | 202 queued | PASS |
| REPORT-02.lead.export.ready-after-retry | lead | worker | ready; scoped to Band only | ready | PASS |
| REPORT-02.lead.export.file-scoped | lead | file | only Band rows; Scope note line; no Hosts/prepared | scopeNote=true hosts=false hyper=false | PASS |
| REPORT-02.oa.export.retry-ready-noop | oa | API retry on ready export | 202 returns unchanged row (no requeue) | 202 ready | PASS |
| REPORT-02.oa.export.rpc-invalid-filters-accepted-then-fail | oa | DB RPC caller JWT | RPC accepts unvalidated filters; worker marks failed invalid_filters (no loop) | 200 | PASS |
| REPORT-02.worker.invalid-filters-final | worker | DB | status failed error_code invalid_filters, attempts 1 | failed:invalid_filters:1 | PASS |
| REPORT-02.mem.export.rpc-direct-denied | mem | DB RPC caller JWT | 403 42501 | 403 42501 | PASS |
| REPORT-02.ob.export.rpc-cross-org-denied | ob | DB RPC | denied | 403 | PASS |
| REPORT-02.mem2.rls.report_exports-select | mem2 | DB PostgREST | [] (not requester) | 200 n=0 | PASS |
| REPORT-02.adm.rls.report_exports-select | adm | DB PostgREST | only own rows (admin has 1+ own exports) | 200 n=1 foreign=0 | PASS |
| REPORT-02.oa.rls.report_exports-client-write | oa | DB PostgREST PATCH own export | client cannot write export rows (status/storage_path) | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr now=ready | PASS |
| REPORT-02.oa.rls.report_exports-direct-insert | oa | DB PostgREST POST | client cannot insert export rows directly (must use RPC) | 403 | PASS |
| REPORT-02.worker.concurrent-two-workers | worker x2 | HTTP | each queued job claimed once: all ready with attempts=1; claimed totals sum to 4 | ready:1,ready:1,ready:1,ready:1 claimed=0+4 | PASS |
| REPORT-02.worker.one-file-per-ready-job | worker | DB storage.objects (setup read) | objects == ready jobs | 12 objects vs 12 ready jobs after removing 5 orphan files left by the tester deleting report_exports rows via SQL (test… | PASS |
| REPORT-02.oa.export.download-after-expiry-before-sweep | oa | API | 409 not ready (expired by timestamp) | 409 conflict | PASS |
| REPORT-02.worker.expiry-sweep | worker | DB | status expired, storage_path null, object deleted | expired:null obj=0 | PASS |
| REPORT-02.oa.export.previously-issued-url-after-delete | oa | signed URL | issued URL no longer serves the deleted file | 400 | PASS |
| REPORT-02.oa.export.download-expired | oa | API | 409 | 409 | PASS |
| REPORT-02.oa.export.retry-expired | oa | API retry | 202 queued | 202 queued | PASS |
| REPORT-02.oa.export.regenerated | oa | worker | ready again with new expiry | ready | PASS |
| REPORT-02.adm.export.request-while-inactive | adm | API | 403/404 (inactive membership) | 403 | PASS |
| REPORT-02.adm.export.download-after-demotion | adm | API | 200 before; after demotion to member the signed URL minted must be refused (storage RLS r… | before=200 after=404 | PASS |
| REPORT-02.oa.export.signed-url-expires-after-ttl | oa | signed URL GET after 300s TTL | URL stops working after TTL (300s) | age=834s status=400 {"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim timestamp chec | PASS |

### PUBLIC-01 Public plan and set-list projection (130 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PUBLIC-01.web.set-list-ui-and-route | user | browser /s/:slug | render | browser owned by QA-09 | NOT_RUN |
| PUBLIC-01.oa.publication.get | oa | API GET /plans/:id/publication | 200 unpublished | 200 unpublished | PASS |
| PUBLIC-01.adm.publication.get | adm | API GET /plans/:id/publication | 200 unpublished | 200 unpublished | PASS |
| PUBLIC-01.sch.publication.get | sch | API GET /plans/:id/publication | 200 unpublished | 200 unpublished | PASS |
| PUBLIC-01.lead.publication.get | lead | API GET /plans/:id/publication | 200 unpublished | 200 unpublished | PASS |
| PUBLIC-01.mem.publication.get | mem | API GET /plans/:id/publication | 403 | 403 You need the “Edit plans” permission to do that | PASS |
| PUBLIC-01.mem2.publication.get | mem2 | API GET /plans/:id/publication | 403 | 403 You need the “Edit plans” permission to do that | PASS |
| PUBLIC-01.multi.publication.get | multi | API GET /plans/:id/publication | 403 | 403 You need the “Edit plans” permission to do that | PASS |
| PUBLIC-01.anonymous.publication.get | anonymous | API | 401 | 401 | PASS |
| PUBLIC-01.ob.publication.get-A | ob | API | 403/404 | 403 | PASS |
| PUBLIC-01.ob.publication.get-A-plan-in-B-ctx | ob | API B ctx, A plan id | 404 | 404 | PASS |
| PUBLIC-01.lead.publication.get-midweek-out-of-scope | lead | API | 403/404 (plans.edit scoped to Sunday INT only) | 403 | PASS |
| PUBLIC-01.mem.publish.denied | mem | API PUT | 403 | 403 | PASS |
| PUBLIC-01.mem2.publish.denied | mem2 | API PUT | 403 | 403 | PASS |
| PUBLIC-01.multi.publish.denied | multi | API PUT | 403 | 403 | PASS |
| PUBLIC-01.lead.publish.out-of-scope | lead | API PUT midweek plan | 403/404, nothing created | 403 rows=0 | PASS |
| PUBLIC-01.ob.publish.cross-org | ob | API B ctx A plan | 404 | 404 rows=0 | PASS |
| PUBLIC-01.anonymous.publish | anonymous | API | 401 | 401 | PASS |
| PUBLIC-01.oa.publish.validation.empty-fields | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.unknown-field-notes | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.unknown-field-people | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.bad-mode | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.negative-rev | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.11-fields | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.publish.validation.none-persisted | oa | DB | no publication rows created by rejected requests | 0 | PASS |
| PUBLIC-01.oa.publish.draft-plan | oa | API PUT draft plan | publication stored but state ineligible; anonymous 404 (drafts never public) | 200 state=ineligible reason=The plan is not published (drafts and archived plans are never public). | PASS |
| PUBLIC-01.anonymous.draft-plan.public-404 | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.oa.publish.title-only | oa | API | 200 state live, public_path /p/<slug>, slug >= 22 chars url-safe | 200 live slug.len=22 true | PASS |
| PUBLIC-01.anonymous.public.title-only | anonymous | public HTTP /api/v1/public/plans/:slug | 200 JSON exactly {organization,timezone,title}; no ids | 200 keys=organization,timezone,title | PASS |
| PUBLIC-01.anonymous.public.headers | anonymous | public HTTP | public cache max-age=60, JSON, nosniff, no cookies | public, max-age=60 application/json; charset=utf-8 nosniff=nosniff cookie=null | PASS |
| PUBLIC-01.oa.field.title-only | oa | API+public | only that field family appears | 200 keys=title | PASS |
| PUBLIC-01.anonymous.field.title-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.date-only | oa | API+public | only that field family appears | 200 keys=date | PASS |
| PUBLIC-01.anonymous.field.date-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.times-only | oa | API+public | only that field family appears | 200 keys=times | PASS |
| PUBLIC-01.anonymous.field.times-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.location-only | oa | API+public | only that field family appears | 200 keys=location | PASS |
| PUBLIC-01.anonymous.field.location-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.service_type-only | oa | API+public | only that field family appears | 200 keys=service_type | PASS |
| PUBLIC-01.anonymous.field.service_type-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.order-only | oa | API+public | only that field family appears | 200 keys=items | PASS |
| PUBLIC-01.anonymous.field.order-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.item_lengths-only | oa | API+public | only that field family appears | 200 keys= | PASS |
| PUBLIC-01.anonymous.field.item_lengths-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.songs-only | oa | API+public | only that field family appears | 200 keys=songs | PASS |
| PUBLIC-01.anonymous.field.songs-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.song_authors-only | oa | API+public | only that field family appears | 200 keys= | PASS |
| PUBLIC-01.anonymous.field.song_authors-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.oa.field.song_keys-only | oa | API+public | only that field family appears | 200 keys= | PASS |
| PUBLIC-01.anonymous.field.song_keys-only.no-private | anonymous | public HTTP | no private sentinels | leaks= | PASS |
| PUBLIC-01.anonymous.public.all-fields | anonymous | public HTTP | all selected fields; no private data; pre-service items excluded | 200 keys=organization,timezone,title,date,service_type,location,times,items,songs | PASS |
| PUBLIC-01.anonymous.public.all-fields.no-private | anonymous | public HTTP | no notes/descriptions/names/teams/positions/pre-service items | leaks= | PASS |
| PUBLIC-01.anonymous.public.all-fields.no-ids | anonymous | public HTTP | no UUIDs of plan/org/person/song exposed | uuids=0 | PASS |
| PUBLIC-01.anonymous.public.times-service-only | anonymous | public HTTP | rehearsal absent: 2 service times (9am, 11am) | ["9am","11am"] | PASS |
| PUBLIC-01.anonymous.public.items-service-segment-only | anonymous | public HTTP | 4 items (header, song, item, song2); pre-service huddle hidden | Welcome,INT Song One,Announcements,INT Song Two | PASS |
| PUBLIC-01.anonymous.public.song-keys-authors | anonymous | public HTTP | song One has author+key G | {"title":"INT Song One","author":"Author One","key":"G"} | PASS |
| PUBLIC-01.anonymous.public.date-local | anonymous | public HTTP | date is org-local civil date (America/Chicago) | 2026-11-21 vs db 2026-11-21 | PASS |
| PUBLIC-01.anonymous.public.order-without-songs-masks-titles | anonymous | public HTTP | song rows titled "Song" with no song title leaked | Welcome,Song,Announcements,Song | PASS |
| PUBLIC-01.oa.publish.stale-revision | oa | API | 409 publication_changed | 409 publication_revision_stale | PASS |
| PUBLIC-01.oa.publish.concurrent-same-revision | oa | API x3 parallel | exactly one 200, others 409 | 409,409,200 | PASS |
| PUBLIC-01.oa.publish.rotate-link | oa | API new_link=true | new slug; old slug 404; new slug 200 | rot=true old=404 new=200 | PASS |
| PUBLIC-01.oa.revoke | oa | API DELETE | 200 state revoked, public_path null, public 404 | 200 revoked path=null pub=404 | PASS |
| PUBLIC-01.oa.revoke-twice | oa | API DELETE again | idempotent 200 or clear 4xx (no 500) | 200 | PASS |
| PUBLIC-01.oa.revoke-stale-revision | oa | API | 409 | 409 | PASS |
| PUBLIC-01.mem.revoke.denied | mem | API | 403 | 403 | PASS |
| PUBLIC-01.multi.revoke.denied | multi | API | 403 | 403 | PASS |
| PUBLIC-01.oa.republish-after-revoke-same-slug | oa | API | OBSERVE: republish without new_link reuses revoked slug (old URL becomes live again) | same=true old=200 | PASS |
| PUBLIC-01.oa.service-day.scheduled-before-day | oa | API+public | state scheduled with visible_from at local start of service day; anonymous 404 before then | scheduled from=2026-11-21T06:00:00.000Z pub=404 | PASS |
| PUBLIC-01.oa.service-day.visible-from-local-midnight | oa | API | visible_from equals org-local midnight of service day | 2026-11-21T06:00:00.000Z vs 2026-11-21 06:00:00+00 | PASS |
| PUBLIC-01.oa.service-day.past-plan-live | oa | API+public | past service day => live at once | live pub=200 | PASS |
| PUBLIC-01.oa.unpublish-plan-draft.public-404 | oa | API PATCH status draft + public | public 404 once plan returns to draft | 404 state=ineligible | PASS |
| PUBLIC-01.oa.republish-plan.public-link-revives | oa | API+public | OBSERVE: re-publishing the plan makes the old public URL live again without a fresh opt-in | 200 | PASS |
| PUBLIC-01.oa.archive-plan.public-404 | oa | API+public | 404 when archived | 404 | PASS |
| PUBLIC-01.oa.edit-title.propagates | oa | API+public | public reflects edited title within cache (server fresh) | INT Sunday Recent EDITED | PASS |
| PUBLIC-01.anonymous.hostile-title.json-only | anonymous | public HTTP | HTML-like title returned as JSON string data (application/json, nosniff); no HTML renderi… | application/json; charset=utf-8 <img src=x onerror=alert(1)> "q" & <b> | PASS |
| PUBLIC-01.oa.delete-plan.public-404 | oa | API+public | 404 after plan deleted; publication row cascaded | 404 rows=0 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.random | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.empty-ish | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.sql-ish | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.long | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.uuid-plan-id | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.traversal | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.unknown-slug.personal-feed-token | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.no-slug | anonymous | public HTTP | 404 | 404 | PASS |
| PUBLIC-01.anonymous.public.list-not-exposed | anonymous | public HTTP | no enumeration endpoint (404) | 404 | PASS |
| PUBLIC-01.anonymous.public.post-not-allowed | anonymous | public HTTP POST | 404/405 | 404 | PASS |
| PUBLIC-01.anonymous.rls.plan_publications | anonymous | DB PostgREST anon key | no rows / denied (slugs are secrets) | 401 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr | PASS |
| PUBLIC-01.anonymous.rls.public_set_list_links | anonymous | DB PostgREST anon key | no rows / denied | 401 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr | PASS |
| PUBLIC-01.mem.rls.plan_publications | mem | DB PostgREST caller JWT | [] (slugs only for plan editors) | 200 n=0 | PASS |
| PUBLIC-01.mem.rls.public_set_list_links | mem | DB PostgREST | [] | 200 n=0 | PASS |
| PUBLIC-01.mem2.rls.plan_publications | mem2 | DB PostgREST caller JWT | [] (slugs only for plan editors) | 200 n=0 | PASS |
| PUBLIC-01.mem2.rls.public_set_list_links | mem2 | DB PostgREST | [] | 200 n=0 | PASS |
| PUBLIC-01.multi.rls.plan_publications | multi | DB PostgREST caller JWT | [] (slugs only for plan editors) | 200 n=0 | PASS |
| PUBLIC-01.multi.rls.public_set_list_links | multi | DB PostgREST | [] | 200 n=0 | PASS |
| PUBLIC-01.ob.rls.plan_publications | ob | DB PostgREST caller JWT | [] (slugs only for plan editors) | 200 n=0 | PASS |
| PUBLIC-01.ob.rls.public_set_list_links | ob | DB PostgREST | [] | 200 n=0 | PASS |
| PUBLIC-01.lead.rls.plan_publications-scope | lead | DB PostgREST | only plans in st1 scope (P3 yes) | n=3 plans=3 | PASS |
| PUBLIC-01.oa.rls.client-write-publication-denied | oa | DB PostgREST PATCH | denied (writes via RPC only) | 403 | PASS |
| PUBLIC-01.oa.rls.client-insert-publication-denied | oa | DB PostgREST POST | denied | 403 | PASS |
| PUBLIC-01.oa.rpc.publish-private-field-denied | oa | DB RPC caller JWT | rejected by check constraint (fields allowlist) not stored | 400 {"code":"23514","details":"Failing row contains (3f8b3544-6f8e-4f4d-979d-fd1de3ae057c, c7b4ffc7-3746 | PASS |
| PUBLIC-01.mem.rpc.publish-denied | mem | DB RPC | 42501/P0002 | 403 42501 | PASS |
| PUBLIC-01.ob.rpc.publish-cross-org-denied | ob | DB RPC | denied; no row | 500 rows=0 | PASS |
| PUBLIC-01.oa.links.get | oa | API | 200 | 200 | PASS |
| PUBLIC-01.adm.links.get | adm | API | 200 | 200 | PASS |
| PUBLIC-01.sch.links.get | sch | API | 200 | 200 | PASS |
| PUBLIC-01.lead.links.get | lead | API | 200 | 200 | PASS |
| PUBLIC-01.mem.links.create-denied | mem | API | 403 | 403 | PASS |
| PUBLIC-01.mem2.links.create-denied | mem2 | API | 403 | 403 | PASS |
| PUBLIC-01.multi.links.create-denied | multi | API | 403 | 403 | PASS |
| PUBLIC-01.lead.links.out-of-scope | lead | API | 403/404 | 404 | PASS |
| PUBLIC-01.ob.links.cross-org | ob | API B ctx A st | 404 | 404 | PASS |
| PUBLIC-01.anonymous.links.create | anonymous | API | 401 | 401 | PASS |
| PUBLIC-01.oa.links.bad-kind | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.links.bad-action | oa | API | 422 | 422 | PASS |
| PUBLIC-01.oa.links.bad-uuid | oa | API | 400 | 400 | PASS |
| PUBLIC-01.oa.links.create-idempotent | oa | API | create twice returns same live link | 200 200 same=true | PASS |
| PUBLIC-01.anonymous.setlist.upcoming-skips-scheduled | anonymous | public HTTP /set-lists/:slug | P1 is service_day-scheduled (not yet visible) so upcoming falls through to P5 (INT Sunday… | 200 INT Sunday Later | PASS |
| PUBLIC-01.anonymous.setlist.upcoming-nearest | anonymous | public HTTP | nearest upcoming live plan P1 | INT Sunday Upcoming | PASS |
| PUBLIC-01.anonymous.setlist.recent | anonymous | public HTTP | most recent started plan P3 | 200 <img src=x | PASS |
| PUBLIC-01.anonymous.setlist.uses-plan-field-selection | anonymous | public HTTP | set-list projection uses that plan's own selected fields (P1: title,date only) | organization,timezone,title,date | PASS |
| PUBLIC-01.anonymous.setlist.no-private | anonymous | public HTTP | no private | leaks= | PASS |
| PUBLIC-01.anonymous.setlist.revoked-plans-skipped | anonymous | public HTTP | after revoking P1 and P5 publications upcoming link => 404 (no candidate) | 404 | PASS |
| PUBLIC-01.oa.links.rotate | oa | API+public | new slug; old 404; new 200 | 200 rot=true old=404 new=200 | PASS |
| PUBLIC-01.oa.links.revoke | oa | API+public | revoked slug 404; list shows no live upcoming | 200 pub=404 | PASS |
| PUBLIC-01.oa.links.list-live-only | oa | API | only live links (recent) | recent | PASS |
| PUBLIC-01.oa.links.revoke-when-none | oa | API | no 500 | 200 | PASS |
| PUBLIC-01.anonymous.namespaces-separate-link-on-plan-path | anonymous | public HTTP | set-list slug on /plans path => 404 | 404 | PASS |
| PUBLIC-01.anonymous.namespaces-separate-plan-on-setlist-path | anonymous | public HTTP | plan slug on /set-lists path => 404 | 404 | PASS |
| PUBLIC-01.anonymous.web.p-route-serves-spa-shell | anonymous | web http://localhost:5173/p/:slug (curl) | 200 SPA shell (client renders); no plan data inlined in HTML | 200 leaks=false | PASS |
| PUBLIC-01.browser.p-route-render | anonymous | browser /p/:slug /s/:slug | rendering, 404 page, refresh, revoke UX | browser owned by QA-09 | NOT_RUN |

### API-01 Developer API credentials and external API (180 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PUBLIC.oa.integrations.status | oa | API GET /integrations/status | 200 scopes plans.read/songs.read; webhooks_available false on :4000 (INTEGRATION_SECRET_K… | 200 {"webhooks_available":false,"worker_configured":false,"api_base_url":"http://localhost:4000/api/external/v1","api_v… | PASS |
| API-01.oa.integrations.status.webhooks-available-on-shared-api | oa | API | OBSERVE shared API (4000) lacks INTEGRATION_SECRET_KEY/CRON_SECRET: webhooks unavailable;… | webhooks_available=false worker_configured=false | PASS |
| API-01.oa.credentials.list | oa | API | 200 | 200 | PASS |
| API-01.adm.credentials.list | adm | API | 200 | 200 | PASS |
| API-01.sch.GET.credentials.denied | sch | API | 403 (owner/admin only) | 403 | PASS |
| API-01.sch.POST.credentials.denied | sch | API | 403 (owner/admin only) | 403 | PASS |
| API-01.sch.GET.webhooks.denied | sch | API | 403 (owner/admin only) | 403 | PASS |
| API-01.sch.GET.status.denied | sch | API | 403 (owner/admin only) | 403 | PASS |
| API-01.lead.GET.credentials.denied | lead | API | 403 (owner/admin only) | 403 | PASS |
| API-01.lead.POST.credentials.denied | lead | API | 403 (owner/admin only) | 403 | PASS |
| API-01.lead.GET.webhooks.denied | lead | API | 403 (owner/admin only) | 403 | PASS |
| API-01.lead.GET.status.denied | lead | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem.GET.credentials.denied | mem | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem.POST.credentials.denied | mem | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem.GET.webhooks.denied | mem | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem.GET.status.denied | mem | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem2.GET.credentials.denied | mem2 | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem2.POST.credentials.denied | mem2 | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem2.GET.webhooks.denied | mem2 | API | 403 (owner/admin only) | 403 | PASS |
| API-01.mem2.GET.status.denied | mem2 | API | 403 (owner/admin only) | 403 | PASS |
| API-01.multi.GET.credentials.denied | multi | API | 403 (owner/admin only) | 403 | PASS |
| API-01.multi.POST.credentials.denied | multi | API | 403 (owner/admin only) | 403 | PASS |
| API-01.multi.GET.webhooks.denied | multi | API | 403 (owner/admin only) | 403 | PASS |
| API-01.multi.GET.status.denied | multi | API | 403 (owner/admin only) | 403 | PASS |
| API-01.anonymous.credentials.list | anonymous | API | 401 | 401 | PASS |
| API-01.ob.credentials.list-A | ob | API X-Org=A | 403/404 | 403 | PASS |
| API-01.adm.credentials.create | adm | API POST | 201, secret once (sck_<16hex>_<43>), no-store, state active | 201 fmt=true cc=no-store state=active | PASS |
| API-01.adm.credentials.create-response-no-hash | adm | API | response has no secret_hash; secret not in credential object | id,organization_id,name,key_prefix,scopes,rate_limit_per_minute,expires_at,created_by,created_at,last_used_at,revoked_a… | PASS |
| API-01.adm.credentials.idempotent-replay | adm | API | replay returns 200, secret null, same credential | 201/200 secret2=null same=true | PASS |
| API-01.adm.credentials.idempotency-key-reuse-different | adm | API | 409 | 409 idempotency_key_reused | PASS |
| API-01.oa.credentials.validation.no-scopes | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.unknown-scope | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.write-scope | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.3-scopes | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.rate-0 | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.rate-601 | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.rate-float | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.name-empty | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.name-81 | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.key-short | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.expiry-bad | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.expiry-no-offset | oa | API | 422 | 422 | PASS |
| API-01.oa.credentials.validation.expiry-in-past | oa | API | 400/422 (expiry must be future) | 400 {"error":"Expiry must be in the future","code":"bad_request"} | PASS |
| API-01.oa.credentials.hostile-name | oa | API | 201 stored as text; list returns JSON string | 201 | PASS |
| API-01.client.auth.none | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.empty-bearer | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.basic | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.bad-prefix | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.short | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.wrong-secret | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"Invalid API key","code":"invalid_api_key"} | PASS |
| API-01.client.auth.uppercase-prefix | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.jwt | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.auth.key-in-query | API client | external GET /organization | 401 invalid_api_key | 401 {"error":"An API key is required","code":"invalid_api_key"} | PASS |
| API-01.client.organization | API client (both) | external | 200 {id,name,timezone} only | 200 keys=id,name,timezone id=true | PASS |
| API-01.client.headers | API client | external | Service-Center-Api-Version 2026-11-01, Cache-Control no-store, RateLimit-* present | 2026-11-01 no-store 600/599/60 | PASS |
| API-01.client.401-has-version-headers | API client | external | 401 also carries version + no-store | 2026-11-01 no-store | PASS |
| API-01.client.scope.plans.organization | API client (plans) | external | 200 | 200  | PASS |
| API-01.client.scope.plans.service-types | API client (plans) | external | 200 | 200  | PASS |
| API-01.client.scope.plans.plans | API client (plans) | external | 200 | 200  | PASS |
| API-01.client.scope.plans.songs | API client (plans) | external | 403 insufficient_scope | 403 insufficient_scope | PASS |
| API-01.client.scope.songs.organization | API client (songs) | external | 200 | 200  | PASS |
| API-01.client.scope.songs.service-types | API client (songs) | external | 403 insufficient_scope | 403 insufficient_scope | PASS |
| API-01.client.scope.songs.plans | API client (songs) | external | 403 insufficient_scope | 403 insufficient_scope | PASS |
| API-01.client.scope.songs.songs | API client (songs) | external | 200 | 200  | PASS |
| API-01.client.scope.both.organization | API client (both) | external | 200 | 200  | PASS |
| API-01.client.scope.both.service-types | API client (both) | external | 200 | 200  | PASS |
| API-01.client.scope.both.plans | API client (both) | external | 200 | 200  | PASS |
| API-01.client.scope.both.songs | API client (both) | external | 200 | 200  | PASS |
| API-01.client.plans.keys-minimal | API client | external /plans | keys id,service_type_id,title,service_date,location,updated_at only | id,service_type_id,title,service_date,location,updated_at | PASS |
| API-01.client.plans.published-only-no-draft | API client | external | draft P2 absent; other-org BSECRET absent; no notes | draft=false B=false leaks= | PASS |
| API-01.client.plan-detail | API client | external /plans/:id | 200; times+items; no notes/descriptions/people/assignments | 200 keys=id,service_type_id,title,service_date,location,updated_at,times,items leaks= | PASS |
| API-01.client.plan-detail.item-keys | API client | external | items keys id,type,title,position,length_seconds,song_id | id,type,title,position,length_seconds,song_id | PASS |
| API-01.client.plan-detail.preservice-items | API client | external | OBSERVE: pre/post-service items (internal running notes, hidden from public projection) a… | pre-present=true | PASS |
| API-01.client.plan-detail.draft | API client | external | 404 (cannot tell cases apart) | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| API-01.client.plan-detail.other-org | API client | external | 404 (cannot tell cases apart) | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| API-01.client.plan-detail.non-uuid | API client | external | 404 (cannot tell cases apart) | 400 bad_request (doc + external-api.ts say 404 for non-UUID) | FAIL (W3-INT-D5) |
| API-01.client.plan-detail.unknown | API client | external | 404 (cannot tell cases apart) | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| API-01.clientB.plan-detail.own | API client B | external | 200 own BSECRET plan | 200 | PASS |
| API-01.clientB.plan-detail.A-plan | API client B | external | 404 | 404 | PASS |
| API-01.clientB.plans.list-isolated | API client B | external | only B plans | n=1 A=false | PASS |
| API-01.clientB.plans.A-service-type-filter | API client B | external | empty | 0 | PASS |
| API-01.clientB.songs.isolated | API client B | external | only B songs | BSECRET Song | PASS |
| API-01.client.plans.pagination.limit-1 | API client | external | all published plans exactly once, DB order (service_date,id) | got=72 db=72 pages=72 dup=0 orderOK=true | PASS |
| API-01.client.plans.pagination.limit-7 | API client | external | all published plans exactly once, DB order (service_date,id) | got=72 db=72 pages=11 dup=0 orderOK=true | PASS |
| API-01.client.plans.pagination.limit-100 | API client | external | all published plans exactly once, DB order (service_date,id) | got=72 db=72 pages=1 dup=0 orderOK=true | PASS |
| API-01.client.plans.cursor-stable-on-insert | API client | external | row inserted before the cursor does not shift/duplicate page 2 | overlap=0 newInPage2=false | PASS |
| API-01.client.plans.garbage-cursor | API client | external | 422 invalid_cursor/unprocessable | 422 invalid_cursor | PASS |
| API-01.client.plans.base64-not-json | API client | external | 422 invalid_cursor/unprocessable | 422 invalid_cursor | PASS |
| API-01.client.plans.json-wrong-shape | API client | external | 422 invalid_cursor/unprocessable | 422 invalid_cursor | PASS |
| API-01.client.plans.cursor-too-long | API client | external | 422 invalid_cursor/unprocessable | 422 unprocessable | PASS |
| API-01.client.plans.cursor-with-foreign-id | API client | external | still org-scoped (no B data) | 200 B=false | PASS |
| API-01.client.plans.validation.limit-0 | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.limit-101 | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.limit-abc | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.no-from | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.from-no-offset | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.date-only | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.to-before-from | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.to-equals-from | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.367-days | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.validation.bad-service-type | API client | external | 422 | 422 unprocessable | PASS |
| API-01.client.plans.366-days-ok | API client | external | 366 days accepted | 200 | PASS |
| API-01.client.plans.half-open-range | API client | external | [from,to): includes 05:00:00Z & 05:59:59Z plans, excludes 06:00:00Z (to) and 04:59:59Z | B-B start,INT DST Fall,B-C end | PASS |
| API-01.client.plans.service-type-filter | API client | external | only Midweek plan | INT Midweek Upcoming | PASS |
| API-01.client.plans.service_date-iso-z | API client | external | service_date ISO UTC instants | 2026-11-01T04:59:59.000Z | PASS |
| API-01.client.plan.unpublished-hidden | API client | external | plan back to draft: detail 404, list empty | 404 0 | PASS |
| API-01.client.service-types.pagination | API client | external | paged by id; keys id,name,description,updated_at | 2 next=true keys=id,name,description,updated_at | PASS |
| API-01.client.service-types.all-pages-match-db | API client | external | all non-archived service types of org A, once | got=4 db=4 | PASS |
| API-01.client.songs.keys-minimal | API client | external | keys id,title,author,ccli_number,default_key,themes,updated_at | id,title,author,ccli_number,default_key,themes,updated_at | PASS |
| API-01.client.songs.q-case-insensitive | API client | external | 1 match | 1 | PASS |
| API-01.client.songs.q-wildcard-literal.%25 | API client | external | wildcards literal: no match | 200 n=0 | PASS |
| API-01.client.songs.q-wildcard-literal._ | API client | external | wildcards literal: no match | 200 n=0 | PASS |
| API-01.client.songs.q-wildcard-literal.%5C | API client | external | wildcards literal: no match | 200 n=0 | PASS |
| API-01.client.songs.q-wildcard-literal.%25song%25 | API client | external | wildcards literal: no match | 200 n=0 | PASS |
| API-01.client.songs.q-wildcard-literal.x%25 | API client | external | wildcards literal: no match | 200 n=0 | PASS |
| API-01.client.songs.validation.q= | API client | external | 422 | 422 | PASS |
| API-01.client.songs.validation.q-101 | API client | external | 422 | 422 | PASS |
| API-01.client.songs.archived-excluded | API client | external | archived song disappears | before=1 archive=200 after=0 | PASS |
| API-01.client.write-surface.POST./plans | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.POST./songs | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.POST./organization | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.POST./plans/:id | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PUT./plans | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PUT./songs | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PUT./organization | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PUT./plans/:id | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PATCH./plans | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PATCH./songs | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PATCH./organization | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.PATCH./plans/:id | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.DELETE./plans | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.DELETE./songs | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.DELETE./organization | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.write-surface.DELETE./plans/:id | API client | external | 404/405 (read-only API) | 404 | PASS |
| API-01.client.excluded-surface.people | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.excluded-surface.assignments | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.excluded-surface.files | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.excluded-surface.notes | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.excluded-surface.conversations | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.excluded-surface.plans | API client | external | 404 (not offered) | 404 | PASS |
| API-01.client.key-on-first-party.v1-plans | API client | first-party API | 401 (keys not accepted) | 401 | PASS |
| API-01.client.key-on-first-party.v1-me | API client | first-party API | 401 (keys not accepted) | 401 | PASS |
| API-01.client.key-on-first-party.v1-integrations-credentials | API client | first-party API | 401 (keys not accepted) | 401 | PASS |
| API-01.client.key-on-first-party.v1-calendar | API client | first-party API | 401 (keys not accepted) | 401 | PASS |
| API-01.oa.credentials.revoke | oa | API+external | 200 state revoked; next request 401 api_key_inactive | before=200 revoke=200 revoked after=401 api_key_inactive | PASS |
| API-01.oa.credentials.revoke-idempotent | oa | API | 200 keeps first revoked_at | 200 same=true | PASS |
| API-01.sch.credentials.revoke-denied | sch | API | 403 | 403 | PASS |
| API-01.mem.credentials.revoke-denied | mem | API | 403 | 403 | PASS |
| API-01.lead.credentials.revoke-denied | lead | API | 403 | 403 | PASS |
| API-01.ob.credentials.revoke-cross-org | ob | API B ctx, A cred id | 404; credential still active | 404 t | PASS |
| API-01.oa.credentials.revoke-bad-uuid | oa | API | 400 | 400 | PASS |
| API-01.oa.credentials.revoke-unknown | oa | API | 404 | 404 | PASS |
| API-01.oa.credentials.list-shape | oa | API | no secret/hash/key material; includes key_prefix, state, created_by_name | keys=id,organization_id,name,key_prefix,scopes,rate_limit_per_minute,expires_at,created_by,created_at,last_used_at,revo… | PASS |
| API-01.oa.rls.api_credentials-direct-select-no-hash | oa | DB PostgREST caller JWT | secret_hash column not readable (grant)  | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| API-01.oa.rls.api_credentials-select-secret_hash | oa | DB PostgREST | denied (42501) | 403 | PASS |
| API-01.mem.rls.api_credentials-select | mem | DB PostgREST | []/denied | 200 n=0 | PASS |
| API-01.mem2.rls.api_credentials-select | mem2 | DB PostgREST | []/denied | 200 n=0 | PASS |
| API-01.sch.rls.api_credentials-select | sch | DB PostgREST | []/denied | 200 n=0 | PASS |
| API-01.lead.rls.api_credentials-select | lead | DB PostgREST | []/denied | 200 n=0 | PASS |
| API-01.ob.rls.api_credentials-select | ob | DB PostgREST | []/denied | ob is owner of org B and sees only B own credential(s) (n=1): expectation corrected; no A rows | PASS |
| API-01.oa.rls.api_credentials-direct-insert | oa | DB PostgREST POST | denied (RPC only) | 403 | PASS |
| API-01.oa.rls.api_credentials-direct-update | oa | DB PostgREST PATCH | denied (scopes/limit immutable) | 403 | PASS |
| API-01.anonymous.rls.api_credentials | anonymous | DB PostgREST anon | denied/[] | 401 | PASS |
| API-01.oa.rpc.api_authenticate-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 403 | PASS |
| API-01.oa.rpc.api_plans-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 404 | PASS |
| API-01.oa.rpc.api_songs-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 404 | PASS |
| API-01.oa.rpc.api_plan-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 404 | PASS |
| API-01.oa.rpc.api_organization-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 403 | PASS |
| API-01.oa.rpc.api_service_types-not-callable | oa | DB RPC caller JWT | service-role only (403/404) | 404 | PASS |
| API-01.adm.issuer-demoted.key-stops | API client (issuer demo… | external | 401 api_key_inactive after issuer loses admin; list shows issuer_inactive; resumes when r… | before=200 demoted=401 api_key_inactive states=issuer_inactive restored=200 | PASS |
| API-01.adm.issuer-deactivated.key-stops | API client | external | 401 when issuer membership inactive | 401 | PASS |
| API-01.client.expiry | API client | external | 200 before expiry; 401 api_key_inactive after; list state expired | 200 401 api_key_inactive state=expired | PASS |
| API-01.client.rate-limit-3 | API client limit=3 | external | requests 1-3 => 200 (remaining 2,1,0); 4-5 => 429 rate_limited with Retry-After | [[200,"2",null,null],[200,"1",null,null],[200,"0",null,null],[429,"0","55","rate_limited"],[429,"0","55","rate_limited"… | PASS |
| API-01.client.wrong-secret-does-not-consume-quota | attacker | external | 5 wrong-secret calls with real prefix; real key still gets its 2 requests | wrong=401,401,401 real=200,200,429 | PASS |
| API-01.client.rate-limit-per-key | API client | external | another key unaffected by exhausted key | 200 | PASS |
| API-01.client.rate-limit-concurrent | API client limit=10 | external 20 parallel | exactly 10 succeed, 10 limited (DB-counted, no overshoot) | ok=10 limited=10 | PASS |
| API-01.oa.credentials.cap-25-active | oa | API | 26th active credential rejected (22023) | created=16 last=400 An organization can hold at most 25 active credentials | PASS |
| API-01.oa.credentials.cap-exact | oa | DB | exactly 25 active | 25 | PASS |
| API-01.web.settings-integrations-ui | owner/admin | browser /settings Integrations | once-only secret reveal, copy, revoke confirm dialogs | browser owned by QA-09 | NOT_RUN |
| API-01.rate-limit.production-values | API client | express rate limiters (global 300/min, public… | production-only limits (NODE_ENV=development => 10000) | dev server limits are 10000/min | NOT_APPLICABLE |

### HOOK-01 Webhooks (173 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.web.settings-webhooks-ui | owner/admin | browser /settings Integrations | register form, delivery history, retry button | browser owned by QA-09 | NOT_RUN |
| HOOK-01.signing-secret-rotation | owner/admin | API | no in-place signing-secret rotation endpoint exists (register new + revoke old) | n/a | NOT_APPLICABLE |
| HOOK-01.dns-rebinding | worker | controllable resolver | host re-resolved before every send with pinned address | needs controllable DNS resolver | NOT_RUN |
| HOOK-01.oa.register.shared-api-4000-without-secret-key | oa | API :4000 POST /integrations/webhooks | 503 webhooks_unavailable (no INTEGRATION_SECRET_KEY) and nothing stored | 503 webhooks_unavailable status.webhooks_available=false stored=0 | PASS |
| HOOK-01.anonymous.worker-endpoint.4000-disabled | anonymous | HTTP :4000 /internal/deliveries/run | 404 (CRON_SECRET unset => entry point disabled) | 404 | PASS |
| HOOK-01.oa.status.test-api-4591 | oa | API :4591 | webhooks_available true, worker_configured true, event_types 3 | {"webhooks_available":true,"worker_configured":true,"api_base_url":"http://localhost:4000/api/external/v1","api_version… | PASS |
| HOOK-01.anonymous.worker-endpoint.no-header | anonymous | HTTP :4591 /internal/deliveries/run | 401 | 401 | PASS |
| HOOK-01.anonymous.worker-endpoint.wrong-secret | anonymous | HTTP :4591 /internal/deliveries/run | 401 | 401 | PASS |
| HOOK-01.anonymous.worker-endpoint.basic | anonymous | HTTP :4591 /internal/deliveries/run | 401 | 401 | PASS |
| HOOK-01.worker-endpoint.delete-method | worker | HTTP | 404 for non GET/POST | 404 | PASS |
| HOOK-01.sch.GET.webhooks.denied | sch | API :4591 | 403 | 403 | PASS |
| HOOK-01.sch.POST.webhooks.denied | sch | API :4591 | 403 | 403 | PASS |
| HOOK-01.lead.GET.webhooks.denied | lead | API :4591 | 403 | 403 | PASS |
| HOOK-01.lead.POST.webhooks.denied | lead | API :4591 | 403 | 403 | PASS |
| HOOK-01.mem.GET.webhooks.denied | mem | API :4591 | 403 | 403 | PASS |
| HOOK-01.mem.POST.webhooks.denied | mem | API :4591 | 403 | 403 | PASS |
| HOOK-01.mem2.GET.webhooks.denied | mem2 | API :4591 | 403 | 403 | PASS |
| HOOK-01.mem2.POST.webhooks.denied | mem2 | API :4591 | 403 | 403 | PASS |
| HOOK-01.multi.GET.webhooks.denied | multi | API :4591 | 403 | 403 | PASS |
| HOOK-01.multi.POST.webhooks.denied | multi | API :4591 | 403 | 403 | PASS |
| HOOK-01.anonymous.webhooks.list | anonymous | API | 401 | 401 | PASS |
| HOOK-01.ob.webhooks.list-A | ob | API X-Org=A | 403/404 | 403 | PASS |
| HOOK-01.oa.register.validation.no-events | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.webhook.test-not-subscribable | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.unknown-event | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.url-credentials | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.url-fragment | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.url-not-url | oa | API | 422 (never 500) | 500 internal_error | FAIL (W3-INT-D6) |
| HOOK-01.oa.register.validation.url-ftp | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.url-too-long | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.desc-201 | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.key-short | oa | API | 422 (never 500) | 422 unprocessable | PASS |
| HOOK-01.oa.register.validation.none-stored | oa | DB | 0 endpoints stored by invalid requests | 0 | PASS |
| HOOK-01.adm.register.create | adm | API | 201; signing_secret whsec_<base64 32B> once; no-store; endpoint without ciphertext | 201 fmt=true cc=no-store keys=id,organization_id,url,description,event_types,secret_hint,enabled,disabled_reason,consec… | PASS |
| HOOK-01.oa.register.idempotent-replay | oa | API | replay 200 + secret null + same endpoint; different body 409 | 201/200/409 secret=null same=true | PASS |
| HOOK-01.oa.list.no-secret-material | oa | API | list has secret_hint only; no ciphertext, no whsec_ value | 4 leaks=false | PASS |
| HOOK-01.oa.rls.webhook_endpoints-ciphertext-not-readable | oa | DB PostgREST caller JWT | denied (column not granted) | 403 | PASS |
| HOOK-01.oa.rls.webhook_endpoints-star | oa | DB PostgREST select=* | denied or no secret column | 403 | PASS |
| HOOK-01.mem.rls.webhook_endpoints-select | mem | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.mem.rls.webhook_deliveries-select | mem | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.mem.rls.webhook_events-select | mem | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.mem2.rls.webhook_endpoints-select | mem2 | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.mem2.rls.webhook_deliveries-select | mem2 | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.mem2.rls.webhook_events-select | mem2 | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.sch.rls.webhook_endpoints-select | sch | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.sch.rls.webhook_deliveries-select | sch | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.sch.rls.webhook_events-select | sch | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.lead.rls.webhook_endpoints-select | lead | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.lead.rls.webhook_deliveries-select | lead | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.lead.rls.webhook_events-select | lead | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.ob.rls.webhook_endpoints-select | ob | DB PostgREST | []/denied | ob owns org B and sees only its own B endpoint (n=1); expectation corrected; no A rows \| 200 n=1 | PASS |
| HOOK-01.ob.rls.webhook_deliveries-select | ob | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.ob.rls.webhook_events-select | ob | DB PostgREST | []/denied | 200 n=0 | PASS |
| HOOK-01.oa.rls.webhook_endpoints-direct-insert | oa | DB PostgREST | denied (RPC only; client cannot choose the secret) | 403 | PASS |
| HOOK-01.oa.rls.webhook_endpoints-direct-update | oa | DB PostgREST PATCH url | denied: URL changes must pass the destination guard (RPC/API only) | 403 urlNow=http://127.0.0.1:4590/hook | PASS |
| HOOK-01.oa.rls.webhook_deliveries-client-write | oa | DB PostgREST | denied | 403 | PASS |
| HOOK-01.ob.register.own-org | ob | API B ctx | 201 | 201 | PASS |
| HOOK-01.ob.test.A-endpoint-from-B | ob | API B ctx, A endpoint id | 404; A endpoint unchanged | 404 | PASS |
| HOOK-01.sch.test.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.ob.revoke.A-endpoint-from-B | ob | API B ctx, A endpoint id | 404; A endpoint unchanged | 404 | PASS |
| HOOK-01.sch.revoke.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.ob.enabled.A-endpoint-from-B | ob | API B ctx, A endpoint id | 404; A endpoint unchanged | 404 | PASS |
| HOOK-01.sch.enabled.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.ob.deliveries.A-endpoint-from-B | ob | API B ctx, A endpoint id | 404; A endpoint unchanged | 404 | PASS |
| HOOK-01.sch.deliveries.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.ob.cross-org.A-endpoint-intact | ob | DB | A endpoint still enabled/unrevoked | true:true | PASS |
| HOOK-01.oa.test.send | oa | API | 202 queued delivery for webhook.test | 202 queued webhook.test | PASS |
| HOOK-01.worker.test-delivered-signed | worker | receiver 4590 | 1 POST, signature valid (independent Standard Webhooks verify), UA ServiceCenter-Webhooks… | n=1 sigOk=true ua=ServiceCenter-Webhooks/1 ct=application/json auth=false skew=1s | PASS |
| HOOK-01.worker.test-payload-shape | worker | receiver | payload keys id,type,api_version,created_at,organization_id,data; id evt_<32hex> == webho… | {"id":"evt_ed549e33b18e4d30bf333f8f8a43976f","type":"webhook.test","api_version":"2026-11-01","created_at":"2026-11-18T… | PASS |
| HOOK-01.worker.test-headers | worker | receiver | only webhook-id/timestamp/signature + standard headers | webhook-id,webhook-signature,webhook-timestamp | PASS |
| HOOK-01.worker.test-delivery-succeeded | worker | DB/API history | status succeeded attempts 1; history 200 | [{"id":"c074a2b3-bfd0-44b9-9e45-0eea8bd43641","status":"succeeded","attempts":1,"code":"200","err":""}] | PASS |
| HOOK-01.oa.deliveries.history-api | oa | API | history entries with attempt, status_code, duration, outcome; response body never exposed | [{"attempt":1,"started_at":"2026-11-18T17:33:12.663+00:00","duration_ms":4,"status_code":200,"outcome":"succeeded","err… | PASS |
| HOOK-01.db.response-body-not-stored | worker | DB | response body not stored anywhere (search attempts/deliveries) | 0 | PASS |
| HOOK-01.oa.retry.succeeded-delivery | oa | API | 409 (only failed/cancelled can be retried) | 409 | PASS |
| HOOK-01.receiver.signature-matches-doc-algorithm | receiver | independent HMAC | base64(HMAC-SHA256(b64decode(secret), id.ts.body)) equals header | true | PASS |
| HOOK-01.receiver.tampered-body-rejected | attacker | verify(captured headers + modified body) | signature mismatch | true | PASS |
| HOOK-01.receiver.other-endpoint-secret-rejected | attacker | verify with other endpoint secret | signature mismatch (per-endpoint secrets) | true | PASS |
| HOOK-01.receiver.replay-window | receiver | timestamp check | captured delivery replayed >5min later is outside tolerance (skew > 300s) — receiver duty… | skew at send=1s; replayed skew=401s>300 | PASS |
| HOOK-01.worker.timestamp-fresh-per-attempt | worker | receiver | see retry section: each attempt re-signs with a new timestamp | see below | PASS |
| HOOK-01.event.draft-create-emits-nothing | oa | DB webhook_events | creating a draft plan records no event | 2 (after P4 flips: expect 2 events so far) | PASS |
| HOOK-01.event.draft-delete-emits-nothing | oa | DB | deleting a draft plan records no event | 0 | PASS |
| HOOK-01.event.create-as-published | oa | DB webhook_events | plan created directly with status=published records plan.published (doc: "A plan's status… | events after create=0 (expected 5th event) | FAIL (W3-INT-D7) |
| HOOK-01.event.types-recorded | oa | DB | unpublished, published (P4 flips), published+deleted (draftNew), deleted (create-as-publi… | plan.unpublished,plan.published,plan.published,plan.deleted,plan.deleted | PASS |
| HOOK-01.event.subscription-filter | worker | DB deliveries | ep1 (3 types) receives all events; ep2 (plan.published only) receives published ones only | ep1=5 ep2=2 | PASS |
| HOOK-01.event.all-delivered-signed | worker | receiver | all requests valid signature, one request per delivery (a published event reaches both en… | n=7 allSig=true dups=2 maxSkew=0 | PASS |
| HOOK-01.event.payload-thin-ids-only | worker | receiver | data keys only plan_id & service_type_id; no title/notes/dates/people | plan_id,service_type_id leaks= | PASS |
| HOOK-01.event.type-field-matches | worker | receiver | body.type in the 3 event types; ids unique per delivery | plan.unpublished,plan.deleted,plan.published | PASS |
| HOOK-01.event.same-event-two-endpoints-same-id | worker | receiver | same event delivered to two endpoints carries the same webhook-id (evt_<event>) but diffe… | 2,2 | PASS |
| HOOK-01.event.deleted-plan-payload | worker | receiver | deleted plan event refers to ids only (plan no longer exists) | 2 | PASS |
| HOOK-01.retry.first-500-queues-backoff-5s | worker | DB+receiver | attempt 1 got 500 => queued, attempts=1, next_attempt in ~5s (4.5–5.5s jitter, rounded) | {"id":"4bbb15eb-da46-4e22-a97a-0b7f670b4dc9","status":"queued","attempts":1,"max":8,"code":"500","err":"http_500","ev":… | FAIL (W3-INT-D8) |
| HOOK-01.retry.not-due-not-reclaimed | worker | HTTP | immediate re-run claims 0 webhook deliveries (backoff respected) | {"claimed":0,"succeeded":0,"retried":0,"failed":0,"stale":0,"pruned":0} | PASS |
| HOOK-01.retry.second-attempt-due-after-backoff | worker | DB+HTTP | ~6s after attempt 1 (backoff 5s) attempt 2 is claimed and sent | claimed=0 attempts=1 next=90116s | FAIL (W3-INT-D8) |
| HOOK-01.retry.second-attempt-same-event-id-new-timestamp | worker | receiver | attempt 2 reuses webhook-id (dup) with fresh timestamp and valid signature; next in ~300s | {"id":"4bbb15eb-da46-4e22-a97a-0b7f670b4dc9","status":"queued","attempts":2,"max":8,"code":"500","err":"http_500","ev":… | FAIL (W3-INT-D8) |
| HOOK-01.retry.backoff-schedule | worker | DB | after attempts 2..7 next_attempt deltas ~ 300,1800,7200,18000,36000,50400 s (±10%); attem… | 84465,88126,89295,80293,83122,81262,0 | FAIL (W3-INT-D8; ) |
| HOOK-01.retry.dead-letter-after-8 | worker | DB | after the 8th failed attempt status=failed, attempts=8, completed_at set, no further clai… | {"id":"4bbb15eb-da46-4e22-a97a-0b7f670b4dc9","status":"failed","attempts":8,"max":8,"code":"500","err":"http_500","ev":… | PASS |
| HOOK-01.retry.eight-requests-one-id | worker | receiver | exactly 8 requests, same webhook-id, 7 flagged duplicate | 8 unique=1 | PASS |
| HOOK-01.retry.failed-not-reclaimed | worker | HTTP | failed delivery not claimed again | {"claimed":0,"succeeded":0,"retried":0,"failed":0,"stale":0,"pruned":0} | PASS |
| HOOK-01.retry.endpoint-failure-counter | worker | DB | consecutive_failures incremented once for the dead-lettered delivery | true\|\|1\|2 | PASS |
| HOOK-01.retry.history-api | oa | API | 8 history entries each with status_code 500, outcome retry/failed; retryable true | 8 retry,retry,retry,retry,retry,retry,retry,retry retryable=true | PASS |
| HOOK-01.sch.retry.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.mem.retry.denied | mem | API | 403 | 403 | PASS |
| HOOK-01.ob.retry.cross-org | ob | API | 404 | 404 | PASS |
| HOOK-01.oa.retry.failed-delivery | oa | API | 200 queued; max_attempts = attempts+3 | 200 queued 11 | PASS |
| HOOK-01.retry.manual-retry-succeeds-same-event-id | worker | receiver | retry re-uses the same event id; succeeded | {"id":"4bbb15eb-da46-4e22-a97a-0b7f670b4dc9","status":"succeeded","attempts":9,"max":11,"code":"200","err":"","ev":"729… | PASS |
| HOOK-01.oa.retry.bad-uuid | oa | API | 400 | 400 | PASS |
| HOOK-01.oa.retry.unknown | oa | API | 404 | 404 | PASS |
| HOOK-01.retry.retry-after-honoured | worker | DB | 429 + Retry-After:120 => next attempt ≥ ~108s (not the 5s default) | {"id":"82cd5443-51ff-4cd2-bad2-a23661654cc3","status":"queued","attempts":1,"max":8,"code":"429","err":"http_429","ev":… | PASS |
| HOOK-01.retry.retry-after-capped-24h | worker | DB | Retry-After 999999 capped at 86400s; attempt-2 backoff 300 → delay ≈ 86400±10% | 86552 | PASS |
| HOOK-01.retry.recovers-on-2xx | worker | DB | later 200 => succeeded | succeeded | PASS |
| HOOK-01.status.204-is-success | worker | DB | any 2xx => succeeded | succeeded | PASS |
| HOOK-01.status.202-is-success | worker | DB | any 2xx => succeeded | succeeded | PASS |
| HOOK-01.status.404-is-retried | worker | DB | 4xx retried (queued, http_404) | {"id":"91b503ae-df5b-4519-aa19-fb38e371d5aa","status":"queued","attempts":1,"max":8,"code":"404","err":"http_404","ev":… | PASS |
| HOOK-01.redirect.not-followed-fails-permanently | worker | DB+receiver | 302 => failed on first attempt (redirect_not_followed); redirect target never requested | {"id":"c8d5d6b3-f22a-4998-af40-049e9615be61","status":"failed","attempts":1,"max":8,"code":"302","err":"redirect_not_fo… | PASS |
| HOOK-01.status.410-pauses-endpoint | worker | DB | 410 => delivery failed, endpoint disabled reason gone | {"id":"f1d26c3e-ac5d-4d90-bcff-bcc54a0064c6","status":"failed","attempts":1,"max":8,"code":"410","err":"http_410","ev":… | PASS |
| HOOK-01.paused-endpoint.no-new-deliveries | oa | DB | paused ep1 gets no new delivery for new events (ep2 not subscribed to unpublished) | ep1 deliveries added=15 | PASS |
| HOOK-01.oa.enable.stale-revision | oa | API | 409 | 409 | PASS |
| HOOK-01.sch.enable.denied | sch | API | 403 | 403 | PASS |
| HOOK-01.mem.enable.denied | mem | API | 403 | 403 | PASS |
| HOOK-01.oa.enable.resume | oa | API | 200 enabled, consecutive_failures reset | 200 true cf=0 | PASS |
| HOOK-01.pause.five-consecutive-permanent-failures | worker | DB | after 5 permanent failures in a row endpoint disabled reason failing; later deliveries ca… | false\|failing\|5\|10 last=[{"id":"175507f3-019c-4e40-84b0-5a0f2f211737","status":"failed","attempts":1,"max":8,"code":… | PASS |
| HOOK-01.timeout.15s-retried | worker | DB | receiver stalls 16.5s => request aborted at ~15s, queued with error timeout | {"id":"0d46c214-5a80-4de5-9ae4-18e53673559d","status":"queued","attempts":1,"max":8,"code":"","err":"timeout","ev":"b4d… | PASS |
| HOOK-01.concurrent.three-workers-no-duplicate-sends | worker x3 | receiver | 12 status flips => each ep1 delivery requested exactly once (and ep2 for published), clai… | new deliveries ep1=12 requests=12 maxPerId=1 claimed=1+11+0 pending=0 | PASS |
| HOOK-01.concurrent.no-id-sent-more-than-once-per-endpoint | worker x3 | receiver | each webhook-id appears once per subscribed endpoint (published events go to both endpoin… | [] | PASS |
| HOOK-01.oa.revoke | oa | API | 200 revoked_at set, enabled false; waiting deliveries cancelled endpoint_revoked | 200 revoked queuedBefore=2 now=0 cancelled=2 | PASS |
| HOOK-01.revoked.no-further-requests | worker | receiver | no request for ep1 after revoke | 0 | PASS |
| HOOK-01.revoked.no-new-events-when-unsubscribed | oa | DB | plan.unpublished no longer recorded (no active subscriber of that type) | 0 | PASS |
| HOOK-01.revoked.test-refused | oa | API | 409 (enable endpoint first) | 409 | PASS |
| HOOK-01.revoked.enable-refused | oa | API | 409 | 409 | PASS |
| HOOK-01.oa.revoke-idempotent | oa | API | 200 repeat revoke ok | 200 | PASS |
| HOOK-01.oa.disable.cancels-queued | oa | API | disable => queued deliveries cancelled endpoint_disabled | queuedBefore=2 after=0 cancelled=2 200 | PASS |
| HOOK-01.oa.disabled.test-refused | oa | API | 409 (enable first) | 409 | PASS |
| HOOK-01.logs.api-no-signing-secrets | API :4591 | log file | no whsec_ material in API log | hits=0 | PASS |
| HOOK-01.logs.api-no-cron-secret | API :4591 | log file | CRON secret not logged | false | PASS |
| HOOK-01.logs.api-no-response-body | API :4591 | log file | receiver response body sentinel not in API log | false | PASS |
| HOOK-01.logs.api-no-private-fields | API :4591 | log file | plan notes / person sentinels not in API log |  | PASS |
| HOOK-01.oa.destination-policy.localhost-https | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.loopback-v4 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.loopback-v4-other | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.loopback-v6 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.metadata-169.254 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.rfc1918-10 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.rfc1918-192.168 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.rfc1918-172.16 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.rfc1918-172.31 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.cgnat-100.64 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.any-0.0.0.0 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.multicast | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.reserved-240 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.v4mapped-v6 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.linklocal-v6 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.ula-v6 | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.decimal-ip | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.hex-ip | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.short-ip | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.octal-ip | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_destination_blocked | 422 webhook_destination_blocked | PASS |
| HOOK-01.oa.destination-policy.http-scheme | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_invalid_url | 422 webhook_invalid_url | PASS |
| HOOK-01.oa.destination-policy.http-loopback | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_invalid_url | 422 webhook_invalid_url | PASS |
| HOOK-01.oa.destination-policy.dns-nxdomain | oa | API :4592 (WEBHOOK_ALLOW_PRIVATE_DESTINATIONS… | 422 webhook_dns_failed | 422 webhook_dns_failed | PASS |
| HOOK-01.oa.destination-policy.credentials | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.fragment | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.javascript | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.file | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.ftp | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.gopher | oa | API :4592 | 422 | 422 unprocessable | PASS |
| HOOK-01.oa.destination-policy.none-stored | oa | DB | rejected URLs stored nothing | 0->0 | PASS |
| HOOK-01.ob.destination-policy.public-https-allowed | ob | API :4592 | 201 for public https host (positive control; revoked at once; nothing is sent to it) | 201  | PASS |
| HOOK-01.worker.destination-rechecked-at-send | worker(:4592) | DB+receiver | endpoint stored while private allowed (http://127.0.0.1); worker with policy=false refuse… | failed\|invalid_url\|1 receiverHits=0 claimed=1 | PASS |
| HOOK-01.logs.api-no-personal-secret | API :4591 | log file (morgan dev) | personal token not present in access log (redacted path) | present=false | PASS |
| HOOK-01.logs.api-no-scoped-secret | API :4591 | log file (morgan dev) | scoped token not present in access log (redacted path) | present=true | FAIL (W3-INT-D10) |
| HOOK-01.logs.api-no-slug-secret | API :4591 | log file (morgan dev) | slug token not present in access log (redacted path) | present=true | FAIL (W3-INT-D10) |
| HOOK-01.logs.api-no-key-secret | API :4591 | log file (morgan dev) | key token not present in access log (redacted path) | present=false | PASS |
| HOOK-01.logs.api-no-bearer-jwt | API :4591 | log file | no Supabase JWT in log | false | PASS |
| HOOK-01.logs.api-no-fake-response-token | API :4591 | log file | response/invitation tokens redacted | false | PASS |

### GATED-01 Gated / deferred (excluding songbooks) (27 cases)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| GATED-01.oa.api-absent.report-designer | oa | API GET /api/v1/reports/designer | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.report-custom-create | oa | API POST /api/v1/reports/custom | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.report-custom-list | oa | API GET /api/v1/reports/custom | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.report-templates | oa | API GET /api/v1/reports/templates | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.integrations-ccli | oa | API GET /api/v1/integrations/ccli | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.integrations-catalogs | oa | API GET /api/v1/integrations/catalogs | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.integrations-presentations | oa | API GET /api/v1/integrations/presentations | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.integrations-oauth | oa | API GET /api/v1/integrations/oauth | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.public-live-display | oa | API GET /api/v1/public/live/x | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.public-stage | oa | API GET /api/v1/public/stage/x | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.run-chat | oa | API GET /api/v1/runs/00000000-0000-4000-8000-… | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 404 | PASS |
| GATED-01.oa.api-absent.plans-matrix-order | oa | API GET /api/v1/plans/order-matrix | 404 (unselected/deferred feature has no live endpoint; never mocked success) | 400 | PASS |
| GATED-01.client.external-absent.oauth-authorize | API client | external /oauth/authorize | 404 | 404 | PASS |
| GATED-01.client.external-absent.oauth-token | API client | external /oauth/token | 404 | 404 | PASS |
| GATED-01.client.external-absent.ccli-licence | API client | external /ccli/licences | 404 | 404 | PASS |
| GATED-01.client.external-absent.presentations | API client | external /presentations | 404 | 404 | PASS |
| GATED-01.client.external-absent.catalogs | API client | external /catalogs | 404 | 404 | PASS |
| GATED-01.client.external-absent.webhooks-mgmt | API client | external /webhooks | 404 | 404 | PASS |
| GATED-01.oa.integrations.status-only-implemented-scopes-events | oa | API | scopes {plans.read,songs.read}; events {plan.published,plan.unpublished,plan.deleted}; no… | ["plans.read","songs.read"] ["plan.published","plan.unpublished","plan.deleted"] | PASS |
| GATED-01.oa.webhook-unselected-event-types-rejected | oa | API | 422 for assignment/person events (not in version 2026-11-01) | 422 | PASS |
| GATED-01.oa.api-scope-people-rejected | oa | API | 422 (no people/assignments/files scopes exist) | 422 | PASS |
| GATED-01.static.ccli-integration-ui-absent | source | frontend/src + mobile (grep) | no UI entry points for the deferred integration | web=[] mobile=[] | PASS |
| GATED-01.static.report-designer-ui-absent | source | frontend/src + mobile (grep) | no UI entry points for the deferred integration | web=[] mobile=[] | PASS |
| GATED-01.static.presentation-handoff-ui-absent | source | frontend/src + mobile (grep) | no UI entry points for the deferred integration | web=[] mobile=[] | PASS |
| GATED-01.static.songbooks-route-redirect-note | source | frontend/src/router.tsx | songbook redirect exists (functional redirect case is QA-09) | 108:          { path: '/songbooks/*', element: <Navigate to="/songs" replace /> }, | NOT_APPLICABLE |
| GATED-01.mobile.android-ios-gated-features | mobile | native | native-only deferred items (audio pitch, Android scanning/widgets, CarPlay) are QA-13/14 | not in this package | NOT_APPLICABLE |
| GATED-01.web.settings-integrations-copy | web | browser /settings | Settings does not label deferred integrations as available | browser owned by QA-09 | NOT_RUN |

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| Web and mobile UI for calendar navigation/filter persistence, subscribe/copy/share (CAL-01/02), print/share/export queue UI (REPORT-02), `/p/:slug` and `/s/:slug` rendering and refresh/revoke UX (PUBLIC-01), Settings integrations secret-reveal/revoke dialogs (API-01), Settings webhook register/history/retry UI (HOOK-01), Settings/web gating copy for deferred integrations (GATED-01) | NOT_RUN | Browser is owned by QA-09 and native by QA-13/14. `/p/:slug` was only fetched with curl (SPA shell 200; plan data is not inlined). |
| Report 2000-row cap and 500-plan cap behaviour (`truncated:true`, CSV `Truncated` line) | NOT_RUN | Unreachable: the PostgREST 1000-row limit truncates first (D2). Needs more than 100 plans per chunk. |
| DNS-rebinding style re-resolution between registration and send | NOT_RUN | Needs a controllable resolver. Send-time refusal was shown instead: an endpoint stored while private destinations were allowed was refused by a worker running with the policy off (0 requests reached the receiver). |
| Express rate limiters (global 300/min, public 120/min, feed 60/min) | NOT_APPLICABLE | Production-only values; the dev server allows 10000/min. The per-key database limiter (API-01) was tested in full (limit 3 and 10, 20 parallel calls = exactly 10 accepted, wrong secret does not consume quota). |
| In-place webhook signing-secret rotation | NOT_APPLICABLE | Not offered; register new + revoke old is the supported flow (both tested). |
| Songbook routes (GATED-01) | NOT_APPLICABLE | QA-09. |
| Native deferred items (audio pitch, Android scanning/widgets, CarPlay) | NOT_APPLICABLE | QA-13/14. |
| `HOOK-01.dns-rebinding`, public-destination positive control | see above / environment | Positive control (`https://example.com`) result is in the table (needs outbound DNS). |

## Deviations and tester notes

* An early `PATCH` probe against the signed-in user's own `calendar_feed_tokens` row (case CAL-02.mem.rls.update-own-token-hash) changed that fixture token's hash and invalidated the live feed URL; the case file was re-run from a clean token state (`delete from calendar_feed_tokens` / `calendar_scoped_feeds` for the `int` orgs before the rerun, run-owned rows only).
* While exercising exports the tester deleted run-owned `report_exports` rows by SQL, which left 5 orphan CSV objects in the `report-exports` bucket; they were removed through the Storage API (service role), after which objects equalled ready jobs. This is a tester artefact, not an application defect.
* Several first-draft expectations were wrong and corrected after reading source (decline irreversibility 409, declined requests tombstoned in feeds, `ob` owning org B's own rows, `QA INT` org name being part of every public projection by design, organization name `organization` field included in projections). Only application behaviour disagreements are listed as defects.
* The webhook retry chain (attempts 2..8, dead letter, manual retry) was driven by forcing `next_attempt_at = now()` through SQL between attempts because of D8; delays recorded before forcing are in the case table.
* PostgREST/validation conventions: schema errors answer 422 `unprocessable` (plan text says 400); both accepted as validation.

## Fixtures left in place

Orgs `qa-20261118-int-a` and `qa-20261118-int-b` with users `{oa,adm,sch,lead,mem,mem2,multi,ob,nob}.qa20261118.int@example.test`, their plans/teams/songs/people (including 250 volume Persons, 60 volume plans, 2400 released requests and 13 expired/ready report-export rows/objects), webhook delivery history, and credential/feed/publication rows. State at exit: every personal and scoped calendar feed token, plan publication, set-list link, API credential and webhook endpoint created by this run is revoked (SQL, run-owned); P4 is `published`. The receiver (`:4590`) and the two extra API instances (`:4591`, `:4592`) are stopped; the shared `:4000` API and `:5173` web were not touched. Cleanup of orgs/users is left to the wave coordinator.
