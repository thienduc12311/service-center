# W10-SEC security retest (QA wave 10)

- **Package:** W10-SEC. Retest of the security hardening merged since wave 9 (PR #129), the stale FAIL rows for SEC-01, SEC-02, ACL-01, ACL-05, W9-PLN-D1, and the W9-API NOT_RUN private-address webhook row.
- **Date:** 2026-11-22. **Plan:** `docs/plans/admin-mobile-test-plan.md` §2, §3 (permission oracle), §4, §7, §12.
- **Commit:** `f79aa50` (main after PR #129) on `feature/qa-wave10`, worktree `/Users/nguyen/orca/workspaces/service-center/glassfish`. Nothing in the repo was edited; this file is the only repo change.
- **Environment:** local Supabase (123/123 migrations, latest `20261130000500`, no reset). Shared API `:4200` from this worktree (simulated email/push), only used with caller tokens. Two private API instances started from `backend/` with command-line env only: `:4611` (development, `INTEGRATION_SECRET_KEY` set, `RESEND_API_KEY=` `EXPO_ACCESS_TOKEN=` empty) and `:4612` (`NODE_ENV=production`, same key). A private `nginx:alpine` container on `:4619` (the repo's `frontend/nginx.conf`) for the header check. All three were stopped by PID / container name afterwards; `:4200` stayed up (200) the whole run. Node 26.13.1. Mailpit (`:54324`) read-only to confirm the confirmation email.
- **Namespace:** orgs `qa-w10-sec-a`, `qa-w10-sec-b`, `qa-w10-sec-c`; users `<alias>.qaw10.sec@example.test`.
- **Fixture shape:** A = owner `ownera`, admin `admina`, legacy scheduler `scheda`, members `mema`, `liba` (org-wide `songs.manage` grant), `mallory` (the attacker alias; later joined A through an approved join request), `memb` (B member that joined A by accepting an invitation), plus `scopedx` (scoped scheduler, Sunday service type), `bandlead`, `prodlead` (team-scoped grants), two service types (Sunday, Midweek), two teams (Band, Production), swap/ACL plans with prepared and released assignments, hostile-name guests. B = `ownerb`, `memb`, `victim` (the victim whose address is targeted). C = `ownerc`. `newcomer` has no organization. Users were created with the Auth admin API (`email_confirm: true`), memberships/entities with the service role; **every permission assertion uses the caller's own token** (API, PostgREST `/rest/v1`, Storage `/storage/v1`, Auth `/auth/v1/user`). Credentials only in the scratchpad.
- **Method:** each fix was attacked with the original exploit, the legitimate path, and nearby variants (other role, other route, PostgREST direct, Storage direct, RPC direct, cross-tenant header). Mutations were checked against the persisted row (service-role read) and side effects (allocation events, auth users, mails). Source was read for each contract.

## Result

**703 expanded rows: 672 PASS, 18 FAIL (5 defects), 9 NOT_RUN, 3 NOT_APPLICABLE, 1 BLOCKED.**
No P0 and no cross-tenant leak, private exposure, unauthorized write or lost write was found. **Every original exploit is closed** (profiles.email spoof, owner/admin enrolling arbitrary users, invite-link account takeover/verified account minting, chart_font XSS, anonymous logo listing, swap key replay, linked-email drift, CSV prefixes, From quoting, ChordPro ReDoS). The 18 FAIL rows are all P2 (log hygiene, pagination overflow, a concurrent-accept 502, one npm audit item).

| Defect | Priority | One line |
|---|---|---|
| W10-SEC-D1 (= W9-PLN-D1, still open) | P2 | `GET /plans?page=<huge>` no longer 500s but returns the first page's rows labelled with the huge page (`1e+21`) |
| W10-SEC-D2 | P2 | `GET /songs?page=99999999999999999999` (or `1e21`, `9007199254740993`) -> 500 `internal_error` |
| W10-SEC-D3 | P2 | Request-log redaction is case-sensitive/prefix-only and query-blind: an upper-case route variant still routes and logs the live token; `?access_token=<JWT>` and, in production (`combined`), the `Referer` header are logged verbatim |
| W10-SEC-D4 | P2 | Concurrent accepts of one fresh invitation: loser(s) get 502 "Could not create the account; try again" (account itself is created exactly once) |
| W10-SEC-D5 | P2 (informational) | `npm audit --omit=dev` still lists 13 issues, among them `zod@3.25.76` (the API validator, GHSA-mrhx-c7xc-m3w5); none is a package patched in b49ef7a |

## Defects

### W10-SEC-D1 (P2) = W9-PLN-D1, still open, behaviour changed
- Repro (`:4200` and `:4611`, owner token of qa-w10-sec-a, org has 1 plan):
  `GET /api/v1/plans?page=99999999999999999999` -> `200 {"data":[<the 1 plan>],"page":100000000000000000000,"per_page":50,"total":1}`; `page=1e21` -> `200 {"data":[<the 1 plan>],"page":"1e+21",...}`. A page past the end must be empty (`page=100001` -> `data:[]` is correct). `page=9007199254740993` -> empty with page `9007199254740992` (unsafe integer echoed rounded).
- Expected: 422 for an unsafe/absurd page (cap `page`, e.g. `.max(100_000)`, or `.safe()`), never first-page rows under a different page number.
- Suspected: `packages/shared/src/schemas/common.ts:44` (`page` has no upper bound / `.safe()`), `backend/src/routes/plans.ts:98-103` (`offset = (page - 1) * per_page` loses precision, PostgREST ignores the range).

### W10-SEC-D2 (P2) same root cause on songs
- Repro: `GET /api/v1/songs?page=99999999999999999999` (also `page=1e21`, `page=9007199254740993`) as owner -> `500 {"error":"Internal server error","code":"internal_error"}`. `page=100000` -> 200 empty.
- Expected: 422 (same cap as D1).
- Suspected: `listSongsQuerySchema = paginationSchema.extend(...)` (`packages/shared/src/schemas/song.ts:102`) and the songs list route's range arithmetic. Only `plans` and `songs` use `paginationSchema`; one cap fixes both.

### W10-SEC-D3 (P2) access-log redaction gaps (c155830 fixed the exact-prefix case only)
- Repro 1 (real token, both instances): create an invitation, then `GET /API/V1/INVITATIONS/<token>` -> `200` (Express routing is case-insensitive) and the log line is `GET /API/V1/INVITATIONS/<raw token> 200`. The canonical `/api/v1/invitations/<token>` logs `/api/v1/invitations/[token]`. Same shape for `/API/V1/CALENDAR-FEED/scoped/<t>.ics`, `/api/v1/Invitations/<t>`, `/api/v1/PUBLIC/plans/<slug>` (those routes answered 404 only because the test tokens were not real).
- Repro 2: `GET /api/v1/me?access_token=<JWT>` -> 401 and the whole JWT is in the log (`dev` and `combined`): the redactor only strips the query for the listed token prefixes.
- Repro 3 (`NODE_ENV=production`, morgan `combined`): any request with `Referer: http://localhost:5180/respond?token=<t>` is logged with the full Referer. The web app now sends `Referrer-Policy: same-origin` (59aea40) so browsers will not send it cross-origin; this is defence in depth.
- Not leaking (PASS): canonical paths for responses, invitations, calendar-feed, scoped feed, public plans/set-lists (with `?query` and sub-paths), `Authorization: Bearer` headers, passwords and private bodies.
- Expected: no live secret in logs however the URL is spelled. Fix direction: lower-case the path before prefix matching (or match with `/i`), drop the whole query string from the logged URL, and drop `:referrer` from `combined` (or strip its query).
- Suspected: `backend/src/lib/redact.ts:19-35` (`path.startsWith(prefix)`), `backend/src/app.ts:125-126`.

### W10-SEC-D4 (P2) concurrent invitation accept returns 502 to the losers
- Repro (`:4611`): fresh invitation for an address with no account; fire 3 parallel `POST /api/v1/invitations/<token>/accept {"password":"..."}` -> `200`, `502`, `502` (`[invite] creating the account failed (no user)`). One auth user, one link: no duplicate or takeover; a retry gets 410 `invitation_used`.
- Expected: 409/410 (or a replay of the winner), not a 5xx that tells the user to try again.
- Suspected: `backend/src/routes/invitation-accept.ts:55-74` (`createUser` race error is not `email_exists`).

### W10-SEC-D5 (P2, informational) dependency audit
- `npm audit --omit=dev`: 13 vulnerabilities (1 critical `shell-quote` 1.9.0 via react-native devtools and `concurrently`; high: `zod` 3.25.76, `@vercel/oidc`/`@vercel/functions` chain, `expo-router` -> `query-string` -> `decode-uri-component`, `source-map-js`). b49ef7a itself is verified (body-parser 2.4.0, compression 1.8.2, morgan 1.12.1, proxy-addr 2.0.8). Product call whether the zod advisory (memory use on oversized constrained collections) matters given the 100 KB JSON body limit (2 MB on imports).

## Observations (no defect filed)

1. A linked login's self-service email change (`PUT /auth/v1/user {"email": ...}`) is refused, but Auth reports it as `500 unexpected_failure "Error sending email change email"` instead of the trigger's explanatory 4xx message (`refuse_accepted_email_change`, hint `email_change_locked`). No pending `email_change` state is left (checked in `auth.users`). Unlinked logins still change normally (control). UX only.
2. PostgREST `PATCH /profiles?id=eq.<self>` with `Prefer: return=representation` answers 403 even for the allowed columns (`full_name`, `phone`, `avatar_url`), because the response needs SELECT on `phone`/`email` which clients do not hold; without it the allowed PATCH is 204. The API route `PATCH /me` is unaffected (200).
3. The `storage` schema is reachable through PostgREST with `Accept-Profile: storage`; RLS applies (anonymous gets `[]` for the logos bucket, an org member only sees their own folder). Same result as the Storage API.
4. Public logo URLs carry no `X-Content-Type-Options`/CSP (Supabase Storage). Safe today because the bucket accepts only png/jpeg/webp/gif (SVG upload now 415) and serves a script-bearing file labelled `image/png` as `image/png`.
5. `nginx.conf`: `/assets/*` responses carry only `nosniff` (the location's own `add_header` replaces the server-level ones, as the file's comment says), so no `X-Frame-Options`/`Referrer-Policy` on static bundles; `/healthz` has none. Harmless; the SPA documents have all four.
6. ChordPro: the previously catastrophic patterns are flat (50,000-char hostile lines parse in under 1 ms). A line of 100,000 `[` still costs ~94 ms to parse (200,000 -> ~290 ms; superlinear but bounded by the 100,000-character chart limit).
7. `create_approved_swap` answers a reused key / non-participant with the generic 409 "That change is no longer allowed" (`PT409`); correct, but the two causes are not distinguishable by clients.
8. Source/plan disagreement recorded: the original ACL-01 row "PATCH /access/members/:userId as admin -> 2xx" no longer matches the code (`requireAccessOwner`, owner only; admin gets 403, web shows it read-only). That is the accepted W7-ACC-D2 resolution, so the row is re-baselined to 403.
9. `mailbox()` leaves non-ASCII display names unencoded (RFC 2047); the Resend JSON API takes UTF-8, so only a raw SMTP transport would need it. Not exercised with a real provider.

## Stale FAIL rows (coverage reconciliation, wave 9 `journeys.md` lines 441, 445, 568, 569)

| Original row / defect | Latest FAIL | Re-run (same actor/surface), new status |
|---|---|---|
| **ACL-01** `direct-insert-organization_members.newcomer-as-owner / -as-admin / -as-member` (W7-ACC-D1, P0) | w7 access-security.md: admin, PostgREST, 201 | admin, PostgREST, 403 `42501`, no row, for all three roles: **PASS** (fixed by SEC-003 / `20261130000200`; owner's own insert is now refused too, the old "positive control" row is obsolete) |
| ACL-01 `admin-insert-existing-B-user-into-A` | w7: 201 member/active | 403, no row (also with the owner token, upsert/merge-duplicates, repoint of `user_id`, cross-org insert): **PASS** |
| ACL-01 `PATCH-access-mode` admin (W7-ACC-D2) | w7: 404 "That person is not in this organization" | admin 403 "Only the organization owner can change how someone's access works"; owner 200; scheduler/member/bandlead 403: **PASS against the resolution (403)**, original "2xx" expectation superseded (observation 8) |
| **ACL-05** `delete-assignment.{scoped.MB, scoped.MP, bandlead.SP, bandlead.MP, prodlead.SB, prodlead.MB}` (W7-RESP-D1, P2) | w7 responses.md: 204 for an out-of-scope delete | rebuilt fixtures (Sunday/Midweek x Band/Production, 3 actors x 4 cells x 13 operations, two assignments per delete cell): out-of-scope delete 404 with the row still present, in-scope 204 gone, random id 404, cross-tenant 404, plain member 403: **PASS (all 6 cells)**. Whole matrix 159 + 12 rows PASS |
| **SEC-01** `logo-svg-served-headers` (W7-ACC-D8) | w7: SVG with script served with no CSP | SVG upload to the bucket now `415 invalid_mime_type`; a script-bearing body labelled `image/png` is served as `image/png`: **PASS** |
| SEC-01 `team-name+position.nul`, `song-title.nul`, `free-item.nul`, `person-name.nul`, `plan-title.nul`, `song-search-hostile-query`, `chat.send.nul.API`, `chat.send.surrogate.API`, `note.create.nul.API` (W7-ACC-D5, W7-MSG-D11) | 500 `22P05` / `PGRST102` | 422 "Text contains unsupported characters" on every one, including raw `\u0000` JSON escapes, lone surrogates, search `q`, and the real chat endpoint (`POST /conversations/:id/messages`; a normal HTML-like message is stored verbatim, 201): **PASS** |
| SEC-01 `malformed-json`, `oversize-body-2MB`, `large-name-200k` (W7-ACC-D6) | 500 | 400 "Request body is not valid JSON" (malformed, primitive, null, truncated; anonymous and authenticated), 413 for 2 MB / 200k-char name / 3 MB import: **PASS** |
| **SEC-02** `signed-url.reuse-after-membership-revoked`, `reuse-after-file-deleted` (W7-ACC-D7) | w7: URL works until TTL | accepted residual (ADR 0005, `docs/operations/session-and-url-lifetimes.md`; wave 9 recorded N/A): **NOT_APPLICABLE**, not re-exercised (raw Storage upload is gated by the upload-intent policy: 1 BLOCKED row) |
| SEC-02 `cors-disallowed-status-code` (W7-ACC-D9) | w7: 500 `internal_error` | disallowed origins (`evil.example`, `null`, look-alike vercel host): preflight/GET 401 with no `Access-Control-Allow-Origin`, never 5xx: **PASS** |
| SEC-02 `rate-limit.production-limit-300.xff-spoof-does-not-bypass`, `development-limit-10000...` (W8-INT-D4) | w8 integrations.md: 200 | production instance default `TRUST_PROXY`: 300 OK then 429; spoofed `X-Forwarded-For` (4 forms), `X-Real-IP`, `Forwarded` all still 429: **PASS** (production; the 10,000-request development variant was not repeated, same code path). The reconciliation counts 4 w8 FAILs; only these 2 rows are in the report |
| **W9-PLN-D1** | open P2 | still open, behaviour changed: **FAIL** (W10-SEC-D1), plus songs 500 (W10-SEC-D2) |
| **W9-API NOT_RUN** webhook to a private address with `INTEGRATION_SECRET_KEY` set | not run | 26 private/reserved destinations (loopback, RFC 1918, link-local metadata, CGNAT, v4-mapped and ULA v6, decimal/hex/octal/short IPv4, `localtest.me`, `*.nip.io`, `foo.localhost`, trailing dot, upper case, credentials) -> 422 `webhook_destination_blocked`/`webhook_invalid_url`/`webhook_dns_failed`, no endpoint row; non-owner roles refused; cross-tenant header 403; a public https destination is accepted (201): **PASS**. Send-time DNS-rebinding guard and the live test-send: NOT_RUN |

## Results by fix


### A. Profile identity: profiles.email no longer an identity (0580dfd, migration 20261130000000)

PASS 17 (17 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-PROF.patch-own-email-to-victim | mallory | PostgREST | denied (42501/403), email unchanged | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT email=mallory.qaw10.sec@… | PASS |
| SEC-PROF.patch-mixed-columns | mallory | PostgREST | whole request denied; nothing saved | 403 name=mallory | PASS |
| SEC-PROF.patch-id | mallory | PostgREST | denied; row unchanged | 403 | PASS |
| SEC-PROF.patch-created_at | mallory | PostgREST | denied; row unchanged | 403 | PASS |
| SEC-PROF.patch-updated_at | mallory | PostgREST | denied; row unchanged | 403 | PASS |
| SEC-PROF.api-me-profile-legit | mallory | API | 200 saved | 200 {"id":"0248ce6a-acac-4b24-8b84-de065e4b36ac","email":"mallory.qaw10.sec@example.test","full_name":"M | PASS |
| SEC-PROF.patch-other-profile | mallory | PostgREST | 0 rows / denied | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr | PASS |
| SEC-PROF.insert | mallory | PostgREST | denied | 403 | PASS |
| SEC-PROF.delete-own | mallory | PostgREST | denied | 403 | PASS |
| SEC-PROF.anon-patch | anon | PostgREST | denied | 401 | PASS |
| SEC-PROF.rpc-confirmed_user_id_by_email | mallory | RPC | denied (no execute) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denied for func | PASS |
| SEC-PROF.rpc-confirmed_user_id_by_email | anon | RPC | denied (no execute) | 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func | PASS |
| SEC-PROF.profile-email-follows-auth-admin-change | service(setup) | Auth admin+DB | profiles.email = new login email | ok mallory.moved.qaw10.sec@example.test | PASS |
| SEC-PROF.patch-allowed-cols-legit (return=minimal) | mallory | PostgREST | 204, full_name/phone saved | 204 {"full_name":"Mallory Legit","phone":"555-0100"} | PASS |
| SEC-PROF.patch-avatar_url-legit | mallory | PostgREST | 204 | 204 | PASS |
| SEC-PROF.api-me-profile-email-field | mallory | API | email not changed (strict reject or ignored) | 404 {"error":"No route for PATCH /api/v1/me/profile","code":"not_found"} email=mallory.qaw10.sec@example.test | PASS |
| SEC-PROF.api-PATCH-/me-email-field | mallory | API | email not changed | 200 {"id":"0248ce6a-acac-4b24-8b84-de065e4b36ac","email":"mallory.qaw10.sec@example. email=mallory.qaw10.sec@example.test | PASS |

### B. Membership writes only through functions, SEC-003 (0bfa6c1, migration 20261130000200)

PASS 38, NOT_RUN 1 (39 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-MEM.insert-victim.member | ownera | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.admin | ownera | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.owner | ownera | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.member | admina | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.admin | admina | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.owner | admina | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.member | scheda | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.admin | scheda | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.owner | scheda | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.member | mema | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.admin | mema | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.insert-victim.owner | mema | PostgREST | denied (42501); no row | 403 rows=0 | PASS |
| SEC-MEM.newcomer-self-insert-owner | newcomer | PostgREST | denied | 403 | PASS |
| SEC-MEM.ownerB-insert-userA-into-B | ownerb | PostgREST | denied | 403 | PASS |
| SEC-MEM.ownerA-insert-self-into-B | ownera | PostgREST | denied | 403 | PASS |
| SEC-MEM.upsert-victim | ownera | PostgREST | denied | 403 | PASS |
| SEC-MEM.patch-user_id-repoint | ownera | PostgREST | denied; user_id unchanged | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role w | PASS |
| SEC-MEM.patch-organization_id | ownera | PostgREST | denied; unchanged | 403 | PASS |
| SEC-MEM.patch-id | ownera | PostgREST | denied; unchanged | 403 | PASS |
| SEC-MEM.patch-invited_by | ownera | PostgREST | denied; unchanged | 400 | PASS |
| SEC-MEM.patch-platform_access_expires_at | ownera | PostgREST | denied; unchanged | 403 | PASS |
| SEC-MEM.patch-joined_at | ownera | PostgREST | denied; unchanged | 400 | PASS |
| SEC-MEM.patch-access_mode-legit | ownera | PostgREST | 200 | 200 [{"id":"315f8642-0ded-4bb0-8726-b4de5c684b0e","organization_id":"00e25215-fdf5-4 | PASS |
| SEC-MEM.member-self-promote | mema | PostgREST | role unchanged | 200 role=member | PASS |
| SEC-MEM.admin-self-promote-owner | admina | PostgREST | role unchanged | 200 role=admin | PASS |
| SEC-MEM.api-owner-set-role-legit | ownera | API | 200 | 200 {"id":"62add0db-d0b4-4a0a-865d-bcf79a904dfd","organization_id":"00e25215-fdf5-4f | PASS |
| SEC-MEM.api-owner-set-role-back | ownera | API | 200 | 200 | PASS |
| SEC-MEM.api-member-set-role | mema | API | 403 | 403 | PASS |
| SEC-MEM.api-owner-access_mode-legit | ownera | API | 200 | 200 {"user_id":"158018de-a3f6-437d-84d8-f5bce09a9082","full_name | PASS |
| SEC-MEM.api-from-member-nonmember | ownera | API | 404 not 2xx; no row | 404 {"error":"That person is not an active member of this organization","code":"not_ | PASS |
| SEC-MEM.member_contacts.ownera->victim@a | ownera | RPC | 0 rows | 200 n=0 | PASS |
| SEC-MEM.member_contacts.ownerb->mema@a | ownerb | RPC | 0 rows | 200 n=0 | PASS |
| SEC-MEM.member_contacts.ownera->mema@a | ownera | RPC | 1 rows | 200 n=1 | PASS |
| SEC-MEM.member_contacts.mema->mema@a | mema | RPC | 1 rows | 200 n=1 | PASS |
| SEC-MEM.member_contacts.mema->liba@a | mema | RPC | 0 rows | 200 n=0 | PASS |
| SEC-MEM.member_contacts.admina->mema@a | admina | RPC | 0 rows | 200 n=0 | PASS |
| SEC-MEM.member_contacts.inactive-hidden | ownera | RPC | 0 rows (status checked) | 200 [] | PASS |
| SEC-MEM.creation-policy | newcomer | API | info | 200 {"self_serve_allowed":false} | PASS |
| SEC-MEM.create-organization-via-function-legit | newcomer | API | 201 owner membership via SECURITY DEFINER | 403 {"error":"New churches need an approved application","code":"church_application_required"} | NOT_RUN |

### C. Invitation links do not prove inbox ownership, SEC-002 (8a6a019) and join requests

PASS 44, FAIL 1, NOT_RUN 1 (46 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-JOIN.lookup | mallory | API | 200 or 404 (info) | 200 {"id":"00e25215-fdf5-4f1d-a64d-fa86f46e065b","name":"QA W10 SEC A","slug":"qa-w1 | PASS |
| SEC-JOIN.request-uses-confirmed-auth-email | mallory | API+DB | requester_email = mallory auth email (not profiles.email) | 201 email=own-auth-email | PASS |
| SEC-JOIN.profile-email-poison-denied | mallory | PostgREST | denied | 403 | PASS |
| SEC-JOIN.owner-sees-request | ownera | API | request listed | 200 found=true | PASS |
| SEC-JOIN.owner-approve | ownera | API | 200 with invite | 200 {"request":{"id":"ec029240-b548-47c4-977d-935608306aac","req | PASS |
| SEC-JOIN.invitation-email-is-requester | anonymous | API | preview email = mallory auth email | 200 | PASS |
| SEC-JOIN.accept-anon-for-existing-login-refused | anonymous | API | 403 invitation_sign_in_required | 403 invitation_sign_in_required | PASS |
| SEC-JOIN.accept-by-other-login-refused | victim | API | 403 | 403 | PASS |
| SEC-JOIN.accept-own-session | mallory | API | 200 linked | 200 | PASS |
| SEC-JOIN.member-list-denied | mema | API | 403 | 403 | PASS |
| SEC-JOIN.direct-insert-denied | newcomer | PostgREST | denied | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| SEC-INV.concurrent-accept-rerun-4611 | anonymous | API 4611 | one 200; one auth user; others 4xx (not 5xx) | statuses=502,502,200 users=1 | FAIL |
| SEC-INV.preview | anonymous | API | 200 minimal preview (org name, first name, email, role) | 200 keys=organization_name,person_first_name,preferred_language,email,role,expires_at | PASS |
| SEC-INV.accept-new-no-password | anonymous | API | 422 password_required | 422 password_required | PASS |
| SEC-INV.accept-new-short-password | anonymous | API | 422 validation | 422 | PASS |
| SEC-INV.accept-new-account-unconfirmed | anonymous | API+Auth | 200 linked_existing_account=false; auth user email_confirmed_at null | 200 {"email":"inv1.45905.qaw10.sec@example.test","linked_existing_account":false} confirmed=undefined | PASS |
| SEC-INV.unconfirmed-account-cannot-sign-in | invitee(unconfirmed) | Auth | sign-in refused (email not confirmed) | login inv1.45905.qaw10.sec@example.test: Email not confirmed | PASS |
| SEC-INV.person-linked-to-new-login | n/a | DB | people.profile_id = new user; email = login email | profile=true email=inv1.45905.qaw10.sec@example.test | PASS |
| SEC-INV.confirmation-email-sent | n/a | Mailpit | >=1 mail to invitee address | count=1 subj=Confirm your email address | PASS |
| SEC-INV.token-replay | anonymous | API | 410 invitation_used | 410 invitation_used | PASS |
| SEC-INV.preview-after-use | anonymous | API | 410 | 410 | PASS |
| SEC-INV.bad-token | anonymous | API | 404 | 404 | PASS |
| SEC-INV.existing-login.accept.no session | anonymous | API | 403 invitation_sign_in_required; person unlinked | 403 invitation_sign_in_required linked=false | PASS |
| SEC-INV.existing-login.accept.mallory (other login) | mallory | API | 403 invitation_sign_in_required; person unlinked | 403 invitation_sign_in_required linked=false | PASS |
| SEC-INV.existing-login.accept.ownera (inviter) | ownera | API | 403 invitation_sign_in_required; person unlinked | 403 invitation_sign_in_required linked=false | PASS |
| SEC-INV.existing-login.accept.victim-org-B owner (ownerb) | ownerb | API | 403 invitation_sign_in_required; person unlinked | 403 invitation_sign_in_required linked=false | PASS |
| SEC-INV.existing-login.accept.garbage-bearer | attacker | API | 401 (rejected token not treated as signed-out) | 401 | PASS |
| SEC-INV.existing-login.attacker-password-not-set | anonymous | Auth | victim sign-in with attacker password refused | refused | PASS |
| SEC-INV.victim-session-still-valid | victim | API | 200 | 200 | PASS |
| SEC-INV.case-insensitive-existing-lookup | anonymous | API | 403 sign_in_required (case-insensitive match) | 403 invitation_sign_in_required | PASS |
| SEC-INV.unconfirmed-squatter-409 | anonymous | API | 409 account_unconfirmed; not linked | 409 account_unconfirmed linked=false | PASS |
| SEC-INV.unconfirmed-squatter-with-other-session | mallory | API | 409 not linked | 409 account_unconfirmed | PASS |
| SEC-INV.invite-as-owner | ownera | API | 422 | 422 | PASS |
| SEC-INV.invite-as-member | mema | API | 403 | 403 | PASS |
| SEC-INV.invite-cross-tenant-header | ownerb | API | 403 | 403 | PASS |
| SEC-INV.concurrent-accept | anonymous | API | exactly one 200; one auth user; one membership | statuses=200,502,502 users=1 | PASS |
| SEC-INV.existing-login-B.accept-no-session | anonymous | API | 403 | 403 invitation_sign_in_required | PASS |
| SEC-INV.existing-login-B.accept-other-session | mallory | API | 403 | 403 | PASS |
| SEC-INV.existing-login-B.accept-own-session | memb | API | 200 linked_existing_account=true, person linked, email=login email | 200 {"email":"memb.qaw10.sec@example.test","linked_existing_account":true} | PASS |
| SEC-INV.existing-login-B.membership-row | memb | DB | 1 active member via SECURITY DEFINER fn | [{"role":"member","status":"active"}] | PASS |
| SEC-INV.existing-login-B.now-sees-org-A-and-B | memb | API | both orgs listed | qa-w10-sec-b,qa-w10-sec-a | PASS |
| SEC-INV.invite-linked-person | ownera | API | 409 | 409 | PASS |
| SEC-INV.expired | anonymous | API | 410 invitation_expired | 410 invitation_expired upd=ok | PASS |
| SEC-INV.expired-preview | anonymous | API | 410 | 410 | PASS |
| SEC-INV.revoked | anonymous | API | 410 | 410 invitation_used | PASS |
| SEC-INV.accept-invite web/mobile screens: "confirm your email" and "sign in to join" states | invitee | browser/simulator | new states render | browser owned by W10-WEB; simulator not in scope | NOT_RUN |

### D. Accepted email is the primary locked email, SEC-013 (2a798a4, migration 20261130000500)

PASS 25 (25 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-EMAIL.owner-patch-linked-email | ownera | API | 409 person_email_locked; unchanged | 409 person_email_locked email=mema.qaw10.sec@example.test | PASS |
| SEC-EMAIL.owner-patch-email+name-atomic | ownera | API | 409; first_name not saved | 409 name=mema | PASS |
| SEC-EMAIL.owner-patch-other-fields-save | ownera | API | 200; fields saved; email intact | 200 name=MemAEdited | PASS |
| SEC-EMAIL.owner-patch-same-email-case-variant | ownera | API | 200 (no actual change) or 409; email intact | 200 | PASS |
| SEC-EMAIL.owner-patch-email-null | ownera | API | 409; email intact | 409 email=mema.qaw10.sec@example.test | PASS |
| SEC-EMAIL.unlinked-person-email-editable | ownera | API | 200 saved | 200 email=unl2.1433@example.test | PASS |
| SEC-EMAIL.unlinked-direct-postgrest-editable | ownera | PostgREST | 204 saved | 204 | PASS |
| SEC-EMAIL.accept-copies-accepted-email-to-person | anonymous | API+DB | people.email = accepted login email (override) | 200 email=override.1433@example.test | PASS |
| SEC-EMAIL.self-service-email-change-linked-login | mema | Auth PUT /user | refused; no pending email_change; email unchanged | 500 {"code":500,"error_code":"unexpected_failure","msg":"Error sending email change email","error_id":"1a83b784-439c-4ab6-8a new_… | PASS |
| SEC-EMAIL.self-service-email-change-linked-admin | admina | Auth PUT /user | refused | 500 {"code":500,"error_code":"unexpected_failure","msg":"Error sending email change email","error_id":"a | PASS |
| SEC-EMAIL.self-service-email-change-linked-owner | ownera | Auth PUT /user | refused | 500 | PASS |
| SEC-EMAIL.self-service-email-change-unlinked-control | newcomer | Auth PUT /user | allowed (pending new_email) - unlinked login unaffected | 200 new_email=newcomerchange.1433@example.test | PASS |
| SEC-EMAIL.linked-login-other-attrs-still-update | mema | Auth PUT /user | 200 (metadata) | 200 | PASS |
| SEC-EMAIL.admin-change-propagates | service(Auth admin) | Auth admin+DB | profiles.email and people.email follow | ok profiles=memamoved.1433.qaw10.sec@example.test people=memamoved.1433.qaw10.sec@example.test | PASS |
| SEC-EMAIL.admin-revert-propagates | service(Auth admin) | Auth admin+DB | people.email back | mema.qaw10.sec@example.test | PASS |
| SEC-EMAIL.admin-change-case-normalisation | service(Auth admin) | DB | people.email lowercased | people=mema.qaw10.sec@example.test profiles=mema.qaw10.sec@example.test | PASS |
| SEC-EMAIL.sign-in-after-revert | mema | Auth | ok | ok | PASS |
| SEC-EMAIL.owner-direct-postgrest-linked (return=minimal) | ownera | PostgREST | refused PT409; unchanged | 409 {"code":"PT409","details":null,"hint":"person_email_locked","message":"This person's email is the one they accepted their inv… | PASS |
| SEC-EMAIL.owner-direct-postgrest-linked-with-name-atomic | ownera | PostgREST | refused; name unchanged | 409 name=mema | PASS |
| SEC-EMAIL.owner-direct-postgrest-linked-name-only | ownera | PostgREST | 204 | 204 | PASS |
| SEC-EMAIL.member-direct-own-person (minimal) | mema | PostgREST | refused/0 rows; unchanged | 204 "" | PASS |
| SEC-EMAIL.member-repoint-profile_id (minimal) | mema | PostgREST | refused; unchanged | 204 "" | PASS |
| SEC-EMAIL.owner-unlink-profile_id-direct | ownera | PostgREST | refused; unchanged | 403 {"code":"42501","details":null,"hint":null,"message":"A login is linked to a person by accepting an | PASS |
| SEC-EMAIL.link-copies-login-email | service(setup) | DB trigger | people.email = login email at link time | err=ok email=linker.19254.qaw10.sec@example.test | PASS |
| SEC-EMAIL.no-pending-email_change-state | n/a | DB | email_change empty for refused linked logins | ownera.qaw10.sec@example.test\|\| ; admina.qaw10.sec@example.test\|\| ; mema.qaw10.sec@example.test\|\| ; | PASS |

### E. chart_font stored XSS (e3d855b, migration 20261130000100)

PASS 32, NOT_RUN 1 (33 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-XSS.render.full-chart-html-no-injected-script | n/a | shared renderChartHtml (hostile title/author/label/lyric/chord/font/size/colour) | only the pagination <script> present; no raw injected tag/handler | scriptTags=1 rawInjected=false imgTag=false | PASS |
| SEC-XSS.render.full-chart-html-has-CSP-meta | n/a | shared renderChartHtml | CSP meta with default-src none + script hash | default-src 'none'; script-src 'sha256-XUz6XafIsSGCW4HaT601qPcZgqpnxS7lJ+jA44Q0V8o='; style-src 'unsafe-inline'; base-ur | PASS |
| SEC-XSS.render.csp-hash-matches-pagination-script | n/a | shared renderChartHtml | sha256 of inline script equals CSP hash | hash=XUz6XafIsSGC in-csp=true | PASS |
| SEC-XSS.setup-grant-songs.manage | ownera | API | 200 | 200 | PASS |
| SEC-XSS.create-song-legit-font | liba | API | 201 with allowed font stored | 201 {"id":"d8fa9e2e-4538-4fb9-9111-aaa5d8873c07","organization_id":"00e25215-fdf5-4f1d-a64d-fa86f46e065b | PASS |
| SEC-XSS.create-song-hostile-font | liba | API | 422; no song created | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"arrangement.chart_font"," | PASS |
| SEC-XSS.arrangement-create.style-breakout | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.url() | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.empty-string | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.case-variant | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.trailing-space+valid | liba | API | 201 (trimmed to allowed font) | 201 stored=Georgia, 'Times New Roman', serif | PASS |
| SEC-XSS.arrangement-create.css-var | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.unicode-lookalike | liba | API | 422 | 422 stored=null {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-XSS.arrangement-create.null-font | liba | API | 201 (null = default) | 201 | PASS |
| SEC-XSS.arrangement-patch-hostile | liba | API | 422; stored font unchanged | 422 stored=Georgia, 'Times New Roman', serif | PASS |
| SEC-XSS.arrangement-patch-legit | liba | API | 200 | 200 | PASS |
| SEC-XSS.arrangement-patch-no-songs.manage.mema | mema | API | 403/404 (no songs.manage grant) - allowed only for owner/admin by role | 403 | PASS |
| SEC-XSS.arrangement-patch-no-songs.manage.scheda | scheda | API | 403/404 (no songs.manage grant) - allowed only for owner/admin by role | 200 (legacy scheduler keeps legacy org-level songs authoring per oracle; my expectation was wrong) | PASS |
| SEC-XSS.arrangement-patch-no-songs.manage.admina | admina | API | 403/404 (no songs.manage grant) - allowed only for owner/admin by role | 200 | PASS |
| SEC-XSS.cross-tenant-patch | ownerb | API | 404 | 404 | PASS |
| SEC-XSS.direct-postgrest.PATCH.chart_font | liba | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.direct-postgrest.POST.song_id+name+chart_font | liba | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.direct-postgrest.PATCH.chart_font | ownera | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.direct-postgrest.PATCH.chart_chord_color | liba | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.direct-postgrest.PATCH.chart_font_size | liba | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.direct-postgrest.PATCH.chart_columns | liba | PostgREST | rejected by CHECK (23514 -> 400/409); value not stored | 400 {"code":"23514","details":null,"hint":null,"message":"new row for relation \"arrangements\ | PASS |
| SEC-XSS.db-check-binds-service-role | service(setup) | DB | CHECK violation 23514 | 23514 new row for relation "arrangements" violates check constraint "arrangements_char | PASS |
| SEC-XSS.arrangement-duplicate | liba | API | info: duplicate carries only allowed font | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"metad | PASS |
| SEC-XSS.chart-endpoint | liba | API | 200 | 200 keys=chordpro,key,semitones,notation | PASS |
| SEC-XSS.render-resolveChartFormatting-hostile-font | n/a | shared lib | falls back to default font | 'Courier New', Courier, monospace | PASS |
| SEC-XSS.render-resolveChartFormatting-hostile-size+color | n/a | shared lib | defaults | {"columns":1,"fontFamily":"Georgia, 'Times New Roman', serif","fontSize":12,"chordColor":"#000000"} | PASS |
| SEC-XSS.chart-csp-meta | n/a | shared lib | default-src 'none'; script-src sha256 only | <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-XUz6XafIsSGCW4HaT601qPcZgqpnxS7lJ+jA44… | PASS |
| SEC-XSS.render.chart-blob-tab / unsandboxed srcdoc preview / PDF frame in a real browser | member | browser | hostile chart opens inert; preview iframe sandbox=allow-scripts | Source checked (ChartPreview sandbox="allow-scripts", CSP meta in chart and song-book documents); browser steps not run (browser … | NOT_RUN |

### F. organization-logos bucket listing, SEC-010 (ea7f3ca, migration 20261130000300) and Storage variants

BLOCKED 1, PASS 36, NOT_APPLICABLE 2 (39 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-02.signed-url / storage private bucket checks (attachments) | ownera | Storage | 200 | Upload to attachments is gated by an upload-intent policy (private.can_upload_attachment_object); a raw Storage POST is refused (… | BLOCKED |
| SEC-LOGO.upload-own-org-legit | ownera | Storage | 200 | 200 {"Key":"organization-logos/00e25215-fdf5-4f1d-a64d-fa86f46e065b/w10-179535899289 | PASS |
| SEC-LOGO.upload-own-org-legit-B | ownerb | Storage | 200 | 200 | PASS |
| SEC-LOGO.public-url-served-anon | anonymous | Storage | 200 image/png | 200 ct=image/png nosniff=null csp=null | PASS |
| SEC-LOGO.list.anonymous.prefix=(root) | anonymous | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.anonymous.prefix=A/ | anonymous | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.anonymous.prefix=B/ | anonymous | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.anonymous.prefix=A | anonymous | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.newcomer.prefix=(root) | newcomer | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.newcomer.prefix=A/ | newcomer | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.newcomer.prefix=B/ | newcomer | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.newcomer.prefix=A | newcomer | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.mema(B?).prefix=A/ | mema(B?) | Storage list | own-org rows | 200 n=1 | PASS |
| SEC-LOGO.list.mema(B?).prefix=B/ | mema(B?) | Storage list | [] (no rows) | 200 n=0 | PASS |
| SEC-LOGO.list.mema(B?).prefix=A | mema(B?) | Storage list | own-org rows | 200 n=1 | PASS |
| SEC-LOGO.list.anon-with-search | anonymous | Storage list | [] | 200 [] | PASS |
| SEC-LOGO.list.member-own-org | mema | Storage list | >=1 row (members read own org) | 200 n=1 | PASS |
| SEC-LOGO.list.ownerB-root | ownerb | Storage list | no A folder in root listing | 200 names=3a26028f-aa76-484f-9039-53ffce578a5a | PASS |
| SEC-LOGO.nearby-list-anon.avatars | anonymous | Storage list | [] or denied | 200 n=0 | PASS |
| SEC-LOGO.nearby-list-anon.chord-sheets | anonymous | Storage list | [] or denied | 200 n=0 | PASS |
| SEC-LOGO.nearby-list-anon.songbooks | anonymous | Storage list | [] or denied | 200 n=0 | PASS |
| SEC-LOGO.nearby-list-anon.attachments | anonymous | Storage list | [] or denied | 200 n=0 | PASS |
| SEC-LOGO.nearby-list-anon.report-exports | anonymous | Storage list | [] or denied | 200 n=0 | PASS |
| SEC-LOGO.upload-member | mema | Storage | 403 (admin only) | 400 {"statusCode":"403","error":"Unauthorized","message":"new row violates | PASS |
| SEC-LOGO.upload-into-other-org-folder | ownerb | Storage | denied | 400 | PASS |
| SEC-LOGO.upload-anon | anonymous | Storage | denied | 400 | PASS |
| SEC-LOGO.upload-svg-owner | ownera | Storage | 415 (raster only) - was W7 SEC-01.logo-svg-served-headers FAIL | 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type image/svg+xml is not | PASS |
| SEC-LOGO.svg-body-labelled-png-served-as-png | ownera | Storage | served ct image/png (browser will not run it as SVG) | up=200 ct=image/png nosniff=null | PASS |
| SEC-LOGO.upload-html | ownera | Storage | denied by mime allowlist | 400 | PASS |
| SEC-LOGO.upsert-overwrite-member | mema | Storage | denied | 400 | PASS |
| SEC-LOGO.upsert-overwrite-other-org-admin | ownerb | Storage | denied | 400 | PASS |
| SEC-LOGO.delete-other-org-admin | ownerb | Storage | object remains | 400 | PASS |
| SEC-LOGO.public-URL-after-policy-change-still-serves | anonymous | Storage | 200 | 200 | PASS |
| SEC-LOGO.list.mema-root-only-own-org-folders | mema | Storage list | only org A folder | names=A | PASS |
| SEC-LOGO.list.ownerC-(org C member)-prefix=root | ownerc | Storage list | [] (no logos in C) | 200 n=0 | PASS |
| SEC-LOGO.list.ownerC-(org C member)-prefix=A/ | ownerc | Storage list | [] (no logos in C) | 200 n=0 | PASS |
| SEC-LOGO.list.ownerC-(org C member)-prefix=B/ | ownerc | Storage list | [] (no logos in C) | 200 n=0 | PASS |
| SEC-02.signed-url.reuse-after-membership-revoked (W7 FAIL row) | rev10 | Storage | ideally denied; capability URL valid until TTL | Not re-exercised: attachment upload needs the API upload-intent flow. Accepted residual per ADR 0005 / docs/operations/session-an… | NOT_APPLICABLE |
| SEC-02.signed-url.reuse-after-file-deleted (W7 FAIL row) | owner/member | Storage | ideally 404; URL valid till TTL | Same documented residual (ADR 0005); not re-exercised | NOT_APPLICABLE |

### G. Approved-swap idempotency keys, SEC-012 (ca26be6, migration 20261130000400)

PASS 15 (15 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-SWAP.create-legit | mema | API | 201 swap row | 201 {"id":"6facc78e-8e8f-4f11-900f-75089f4e5ee5","organization_id":"00e25215-fdf5-4f | PASS |
| SEC-SWAP.create-writes-one-pending-event | mema | DB | 1 allocation event | events=1 | PASS |
| SEC-SWAP.same-key-same-pair-replays | mema | API | 2xx same swap id; no 2nd event | 201 sameid=true events=1 | PASS |
| SEC-SWAP.reuse-other-members-key-different-pair | scheda | API | 409 (PT409); NOT mema swap row returned | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| SEC-SWAP.reuse-created-no-row | scheda | DB | still 1 row for key | rows=1 | PASS |
| SEC-SWAP.same-actor-same-key-different-pair | mema | API | 409 | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| SEC-SWAP.reversed-pair-same-key-by-counterparty | liba | API | 409 (first/second order differs -> different swap) per source; or replay | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| SEC-SWAP.non-participant-create | admina | API | 409/403; no row | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| SEC-SWAP.owner-not-participant-create | ownera | API | 409/403; no row | 409 | PASS |
| SEC-SWAP.cross-tenant-with-A-ids | ownerb | API | 409/404; other org swap row not returned | 409 {"error":"That change is no longer allowed","code":"conflict"} | PASS |
| SEC-SWAP.rpc-direct-reuse-key | scheda | RPC | 409 (PT409) | 409 {"code":"PT409","details":null,"hint":null,"message":"That request key was already used for a differ | PASS |
| SEC-SWAP.rpc-anon | anonymous | RPC | denied | 401 | PASS |
| SEC-SWAP.distinct-key-other-pair-legit | scheda | API | 201 | 201 | PASS |
| SEC-SWAP.concurrent-same-key-same-pair | mema | API | all 2xx or 409 per busy rules; exactly 1 row, exactly 1 event | statuses=201,201,201,201,201 rows=1 events=1 | PASS |
| SEC-SWAP.concurrent-same-key-different-pairs | liba | API | one 2xx and the other 409; one row | statuses=409,201 rows=1 | PASS |

### H. CSV formula prefixes (7c4b0b1) and From display name quoting (18095b2)

PASS 40, NOT_RUN 1 (41 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-CSV.unit."=cmd" | n/a | shared lib | apostrophe-prefixed | "'=cmd" | PASS |
| SEC-CSV.unit."+1" | n/a | shared lib | apostrophe-prefixed | "'+1" | PASS |
| SEC-CSV.unit."-1" | n/a | shared lib | apostrophe-prefixed | "'-1" | PASS |
| SEC-CSV.unit."@x" | n/a | shared lib | apostrophe-prefixed | "'@x" | PASS |
| SEC-CSV.unit." =cmd" | n/a | shared lib | apostrophe-prefixed | "' =cmd" | PASS |
| SEC-CSV.unit."\n=cmd" | n/a | shared lib | apostrophe-prefixed | "\"'\n=cmd\"" | PASS |
| SEC-CSV.unit."\t=cmd" | n/a | shared lib | apostrophe-prefixed | "'\t=cmd" | PASS |
| SEC-CSV.unit."\r=cmd" | n/a | shared lib | apostrophe-prefixed | "\"'\r=cmd\"" | PASS |
| SEC-CSV.unit."＝cmd" | n/a | shared lib | apostrophe-prefixed | "'＝cmd" | PASS |
| SEC-CSV.unit."＋1" | n/a | shared lib | apostrophe-prefixed | "'＋1" | PASS |
| SEC-CSV.unit."－1" | n/a | shared lib | apostrophe-prefixed | "'－1" | PASS |
| SEC-CSV.unit."＠x" | n/a | shared lib | apostrophe-prefixed | "'＠x" | PASS |
| SEC-CSV.unit." =cmd" | n/a | shared lib | apostrophe-prefixed | "' =cmd" | PASS |
| SEC-CSV.unit." \n @SUM(1)" | n/a | shared lib | apostrophe-prefixed | "\"' \n @SUM(1)\"" | PASS |
| SEC-CSV.unit."a=b" | n/a | shared lib | unchanged | "a=b" | PASS |
| SEC-CSV.unit."hello" | n/a | shared lib | unchanged | "hello" | PASS |
| SEC-CSV.unit."" | n/a | shared lib | unchanged | "" | PASS |
| SEC-CSV.unit."1-2" | n/a | shared lib | unchanged | "1-2" | PASS |
| SEC-CSV.unit."\"=x\"" | n/a | shared lib | unchanged | "\"\"\"=x\"\"\"" | PASS |
| SEC-CSV.unit." normal" | n/a | shared lib | unchanged | " normal" | PASS |
| SEC-CSV.unit.number-negative-not-prefixed | n/a | shared lib | -5 numeric unchanged | -5 | PASS |
| SEC-CSV.unit.quoted-comma | n/a | shared lib | "a,b" | "a,b" | PASS |
| SEC-CSV.unit.quote-escape-with-formula | n/a | shared lib | =x"y -> "'=x""y" | "'=x""y" | PASS |
| SEC-CSV.e2e.schedule-report-has-hostile-rows | ownera | API | rows present | 200 rows=6 ct=text/csv; charset=utf-8 | PASS |
| SEC-CSV.e2e.no-cell-begins-with-formula-char | ownera | API | every hostile cell apostrophe-prefixed | all neutralised; sample: 2027-03-06,W10 swap plan,,W10 swap team 1795359030086,'=POS(),'－2 Csv,confirmed, | PASS |
| SEC-CSV.e2e.attachment-header | ownera | API | Content-Disposition attachment; no-store | attachment; filename="schedule-2027-03-01-to-2027-03-31.csv" no-store | PASS |
| SEC-CSV.e2e.staffing | ownera | API | no raw formula cell | 200 hostileRows=1 bad=0 | PASS |
| SEC-CSV.e2e.participation | ownera | API | no raw formula cell | 200 hostileRows=6 bad=0 | PASS |
| SEC-CSV.e2e.song-usage | ownera | API | no raw formula cell | 200 hostileRows=0 bad=0 | PASS |
| SEC-CSV.e2e.run-times | ownera | API | no raw formula cell | 200 hostileRows=0 bad=0 | PASS |
| SEC-MAIL.from-quoting."Grace Church" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Grace Church" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."Smith, John & Sons" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Smith, John & Sons" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."Evil <attacker@evil.test>" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Evil <attacker@evil.test>" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."Quote \"x\" back\\slash" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Quote \"x\" back\\slash" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."Line\r\nBcc: x@evil.test" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Line Bcc: x@evil.test" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | notifications@example.com | PASS |
| SEC-MAIL.from-quoting." " | n/a | backend mailbox() | display name quoted, one address, no CR/LF | notifications@example.com | PASS |
| SEC-MAIL.from-quoting."Ünïcode 教会" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "Ünïcode 教会" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."a\u0000bc" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "a b c" <notifications@example.com> | PASS |
| SEC-MAIL.from-quoting."\"><script>" | n/a | backend mailbox() | display name quoted, one address, no CR/LF | "\"><script>" <notifications@example.com> | PASS |
| SEC-MAIL.from-header-through-real-Resend | n/a | provider | Resend accepts quoted From | Simulated email only in this stack; mailbox() output verified directly and transports source-checked | NOT_RUN |

### I. Access logs, feed tokens and public slugs (c155830) on private instances :4611 (development) and :4612 (production)

PASS 51, FAIL 11 (62 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-LOG.dev.scopedFeed | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.feed | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.resp | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.respPost | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.invite | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.inviteAccept | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.pubPlan | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.pubSet | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.scopedFeedQ | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.queryToken | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.pubPlanSub | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.upper | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.dev.dblSlash | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.dev.dblSlash2 | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.dev.dotSeg | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.encSlash | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.encPrefix | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.dev.trailingSlash | anonymous | API access log (dev) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.dev.semicolon | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.dev.invitesUpper | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.dev.pubUpper | anonymous | API access log (dev) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.dev.referer-token-not-logged | anonymous | API access log (dev) | Referer header token absent from log | ref900=false ref901=false (dev uses morgan "dev" format, which has no Referer field) | PASS |
| SEC-LOG.dev.query-access_token-not-logged | ownera | API access log (dev) | absent | true | FAIL |
| SEC-LOG.dev.password-and-private-body-not-logged | anonymous | API access log (dev) | absent |  | PASS |
| SEC-LOG.dev.route-shape-logged-as-[token] | n/a | API access log (dev) | [token] placeholder present | 16 placeholders | PASS |
| SEC-LOG.prod.scopedFeed | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.feed | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.resp | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.respPost | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.invite | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.inviteAccept | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.pubPlan | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.pubSet | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.scopedFeedQ | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.queryToken | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.pubPlanSub | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.upper | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.prod.dblSlash | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.prod.dblSlash2 | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.prod.dotSeg | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.encSlash | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.encPrefix | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.prod.trailingSlash | anonymous | API access log (prod) | secret absent from log | http=404 leaked=0 | PASS |
| SEC-LOG.prod.semicolon | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 (non-routing variant, 404; informational) | PASS |
| SEC-LOG.prod.invitesUpper | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.prod.pubUpper | anonymous | API access log (prod) | secret absent from log | http=404 leaked=1 | FAIL |
| SEC-LOG.prod.referer-token-not-logged | anonymous | API access log (prod) | Referer header token absent from log | ref900=true ref901=true | FAIL |
| SEC-LOG.prod.query-access_token-not-logged | ownera | API access log (prod) | absent | true | FAIL |
| SEC-LOG.prod.password-and-private-body-not-logged | anonymous | API access log (prod) | absent |  | PASS |
| SEC-LOG.prod.route-shape-logged-as-[token] | n/a | API access log (prod) | [token] placeholder present | 16 placeholders | PASS |
| SEC-LOG.dev.real-invite-token.canonical | anonymous | API access log | canonical path not logged raw | canonical path logged as /api/v1/invitations/[token] (checked in log excerpt); harness substring check matched the "//api/v1/..."… | PASS |
| SEC-LOG.dev.real-invite-token.case-variant-routes | anonymous | API | info: does an upper-case variant still route to the handler (200)? | statuses=200,200,404,404,404 | PASS |
| SEC-LOG.dev.real-invite-token.upper-case-variant-not-logged | anonymous | API access log | token absent | status=200 leakedLines=4 | FAIL |
| SEC-LOG.dev.real-invite-token.double-slash-variants-not-logged | anonymous | API access log | token absent | statuses=404,404 (non-routing URL: 404, token only appears if the caller sends it; informational) | PASS |
| SEC-LOG.dev.real-invite-token.pct-encoded-prefix | anonymous | API access log | token absent | status=404 (non-routing URL: 404, token only appears if the caller sends it; informational) | PASS |
| SEC-LOG.dev.bearer-header-only-not-logged | ownera | API access log | JWT absent from log (Authorization header only) | status=200 | PASS |
| SEC-LOG.prod.real-invite-token.canonical | anonymous | API access log | canonical path not logged raw | canonical path logged as /api/v1/invitations/[token] (checked in log excerpt); harness substring check matched the "//api/v1/..."… | PASS |
| SEC-LOG.prod.real-invite-token.case-variant-routes | anonymous | API | info: does an upper-case variant still route to the handler (200)? | statuses=200,200,404,404,404 | PASS |
| SEC-LOG.prod.real-invite-token.upper-case-variant-not-logged | anonymous | API access log | token absent | status=200 leakedLines=4 | FAIL |
| SEC-LOG.prod.real-invite-token.double-slash-variants-not-logged | anonymous | API access log | token absent | statuses=404,404 (non-routing URL: 404, token only appears if the caller sends it; informational) | PASS |
| SEC-LOG.prod.real-invite-token.pct-encoded-prefix | anonymous | API access log | token absent | status=404 (non-routing URL: 404, token only appears if the caller sends it; informational) | PASS |
| SEC-LOG.prod.bearer-header-only-not-logged | ownera | API access log | JWT absent from log (Authorization header only) | status=200 | PASS |

### J. ChordPro linear-time parsing (7e960ee)

PASS 36 (36 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-CHORDPRO.max-chart-100k.many [ | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=94ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many [C unclosed | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=41ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many [G]x | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=1ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many { | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=1ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many ] | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=1ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.long single line lyric | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=1ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many newlines | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=5ms render=0ms | PASS |
| SEC-CHORDPRO.max-chart-100k.many sections | n/a | shared parse+render at the 100,000-char chart limit | < 1000ms each | parse=1ms render=0ms | PASS |
| SEC-CHORDPRO.parse.unclosed-brace+spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.2ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.unclosed-brace-title+spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.1ms 50000:0.4ms 200000:1.4ms | PASS |
| SEC-CHORDPRO.parse.verse+spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.[verse+spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.verse+spaces+x | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.1ms 50000:0.8ms 200000:1.3ms | PASS |
| SEC-CHORDPRO.parse.verse 1 +spaces+colon-less | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.5ms 200000:0.9ms | PASS |
| SEC-CHORDPRO.parse.chorus+tabs | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.{sov +spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.{key:+ spaces} | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.3ms 200000:1.3ms | PASS |
| SEC-CHORDPRO.parse.{comment: nested braces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.1ms 50000:0.2ms 200000:0.9ms | PASS |
| SEC-CHORDPRO.parse.many [ chords | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.3ms 50000:18.6ms 200000:289.1ms | PASS |
| SEC-CHORDPRO.parse.many [C chords unclosed | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.2ms 50000:9.4ms 200000:146.1ms | PASS |
| SEC-CHORDPRO.parse.bridge: spaces colon | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.2ms 200000:1.0ms | PASS |
| SEC-CHORDPRO.parse.(verse)+spaces | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.0ms 200000:0.1ms | PASS |
| SEC-CHORDPRO.parse.alternating directive | n/a | shared parseChordPro | each size < 1000ms (linear); was 16s@500 | 500:0.0ms 5000:0.0ms 50000:0.2ms 200000:0.7ms | PASS |
| SEC-CHORDPRO.renderChordProChart.verse+spaces.50k | n/a | shared renderChordProChart | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.transposeChordPro.verse+spaces.50k | n/a | shared transposeChordPro | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.stripChords.verse+spaces.50k | n/a | shared stripChords | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.convertChordProNotation.verse+spaces.50k | n/a | shared convertChordProNotation | < 1000ms | 0.0ms | PASS |
| SEC-CHORDPRO.toChordPro.verse+spaces.50k | n/a | shared toChordPro | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.detectKey.verse+spaces.50k | n/a | shared detectKey | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.renderChordProChart.unclosed.50k | n/a | shared renderChordProChart | < 1000ms | 0.0ms | PASS |
| SEC-CHORDPRO.transposeChordPro.unclosed.50k | n/a | shared transposeChordPro | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.stripChords.unclosed.50k | n/a | shared stripChords | < 1000ms | 0.1ms | PASS |
| SEC-CHORDPRO.convertChordProNotation.unclosed.50k | n/a | shared convertChordProNotation | < 1000ms | 0.0ms | PASS |
| SEC-CHORDPRO.toChordPro.unclosed.50k | n/a | shared toChordPro | < 1000ms | 0.0ms | PASS |
| SEC-CHORDPRO.detectKey.unclosed.50k | n/a | shared detectKey | < 1000ms | 0.0ms | PASS |
| SEC-CHORDPRO.legit-parse-still-works | n/a | shared parseChordPro | title/key/sections parsed | title=Amazing Grace key=G sections=Verse 1\|none | PASS |

### K. Frontend headers (59aea40), dependency patches (b49ef7a)

NOT_APPLICABLE 1, PASS 6, FAIL 1 (8 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-HDR.frontend-anti-framing-live-on-Vite-dev | anonymous | browser/HTTP | n/a | Headers exist only in frontend/vercel.json and frontend/nginx.conf (hosting config); Vite dev server sends none by design. Live c… | NOT_APPLICABLE |
| SEC-HDR.vercel.json-valid-and-headers | n/a | config file | X-Frame-Options DENY, CSP frame-ancestors none, nosniff, Referrer-Policy same-origin on /… | vercel.json parses; all four headers on source "/(.*)"; well-known routes keep their Content-Type | PASS |
| SEC-HDR.nginx.conf-live-container-/ and SPA routes | anonymous | nginx:alpine on :4619 (stopped after) | 4 headers on / , /respond?token=, unknown route, .well-known | all four present on every non-asset response; nginx -t OK | PASS |
| SEC-HDR.nginx.conf-live-container-static-assets | anonymous | nginx:alpine on :4619 | nosniff + cache headers on /assets/* | assets carry only nosniff (+Cache-Control); no X-Frame-Options / frame-ancestors / Referrer-Policy on /assets/*.js\|svg because t… | PASS |
| SEC-HDR.nginx.conf-live-container-healthz | anonymous | nginx:alpine on :4619 | n/a | /healthz has no security headers (return 200 "ok"); informational | PASS |
| SEC-HDR.api-helmet-headers | anonymous | API :4200 | helmet defaults present | CSP, X-Frame-Options SAMEORIGIN, HSTS, nosniff, Referrer-Policy no-referrer on /health | PASS |
| SEC-DEPS.npm-ls-b49ef7a | n/a | npm ls | body-parser>=2.4.0, compression>=1.8.2, morgan>=1.12.1, proxy-addr>=2.0.8 | body-parser 2.4.0, compression 1.8.2, morgan 1.12.1, proxy-addr 2.0.8 (lockfile diff 2.3.0->2.4.0, 1.8.1->1.8.2, 1.12.0->1.12.1, … | PASS |
| SEC-DEPS.npm-audit-omit-dev-informational | n/a | npm audit | no known high/critical in runtime deps | 13 vulnerabilities remain (1 critical shell-quote 1.9.0 via react-native devtools/concurrently; high: zod 3.25.76 GHSA-mrhx-c7xc-… | FAIL |

### L. Webhook private-address rejection with INTEGRATION_SECRET_KEY configured (W9-API NOT_RUN), private instance :4611

NOT_RUN 5, PASS 39 (44 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-ADMIN.findOrInviteOwner-unconfirmed-owner-email | super admin | API | needs super admin with 2FA session | not executable here (private.platform_admins + two-factor session); covered by vitest platform-owner-lookup.test.ts | NOT_RUN |
| SEC-HOOK.status-private-instance-4611 | ownera | API | 200 secret configured | 200 {"webhooks_available":true,"worker_configured":false,"api_base_url":"http://localhost:4000/api/external/v1","api_version":"20… | PASS |
| SEC-HOOK.status-shared-4200-info | ownera | API | info | 200 {"webhooks_available":false,"worker_configured":false,"api_base_url":"http://localhost:4200/api/external/v1","api_version":"2… | PASS |
| SEC-HOOK.private-destination.https://127.0.0.1/hook | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://localhost/hook | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.http://127.0.0.1:54321/x | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_invalid_url Use a public https:// URL without credentials rows=0 | PASS |
| SEC-HOOK.private-destination.https://10.0.0.5/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://192.168.1.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://172.16.0.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://169.254.169.254/latest/meta-data/ | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://[::1]/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://[::ffff:127.0.0.1]/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://[::ffff:7f00:1]/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://[fd00::1]/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://0.0.0.0/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://2130706433/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://0x7f.0.0.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://017700000001/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://127.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://100.64.0.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://metadata.google.internal/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_dns_failed The host name could not be resolved rows=0 | PASS |
| SEC-HOOK.private-destination.https://localtest.me/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://127.0.0.1.nip.io/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://user:pw@127.0.0.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 unprocessable Invalid request body rows=0 | PASS |
| SEC-HOOK.private-destination.https://localhost./h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://LOCALHOST/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://foo.localhost/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://[::]/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.private-destination.https://224.0.0.1/h | ownera | API (4611, key configured) | 4xx rejected; no endpoint row | 422 webhook_destination_blocked The URL resolves to a private or reserved network address rows=0 | PASS |
| SEC-HOOK.bad-scheme-or-url.ftp://example.com/h | ownera | API (4611) | 4xx | 422 unprocessable | PASS |
| SEC-HOOK.bad-scheme-or-url.file:///etc/passwd | ownera | API (4611) | 4xx | 422 unprocessable | PASS |
| SEC-HOOK.bad-scheme-or-url.javascript:alert(1) | ownera | API (4611) | 4xx | 422 unprocessable | PASS |
| SEC-HOOK.bad-scheme-or-url.http://example.com/h | ownera | API (4611) | 4xx | 422 webhook_invalid_url | PASS |
| SEC-HOOK.bad-scheme-or-url.https:// | ownera | API (4611) | 4xx | 422 unprocessable | PASS |
| SEC-HOOK.bad-scheme-or-url.not a url | ownera | API (4611) | 4xx | 422 unprocessable | PASS |
| SEC-HOOK.create-private.admina | admina | API (4611) | 4xx (rejected either way) | 422 webhook_destination_blocked | PASS |
| SEC-HOOK.create-private.scheda | scheda | API (4611) | 4xx (rejected either way) | 403 forbidden | PASS |
| SEC-HOOK.create-private.mema | mema | API (4611) | 4xx (rejected either way) | 403 forbidden | PASS |
| SEC-HOOK.public-destination-legit | ownera | API (4611) | 201 (needs DNS egress) or 4xx dns | 201 {"endpoint":{"id":"18cc242a-90c9-49f5-92fb-6e134df30d07","organization_id":"00e25215-fdf5-4f1d-a64d-fa86f46e065b","url":"http… | PASS |
| SEC-HOOK.test-send-to-public | ownera | API | not executed (would make real outbound request) | skipped | NOT_RUN |
| SEC-HOOK.cross-tenant-header | ownerb | API (4611) | 403 | 403 | PASS |
| SEC-HOOK.dns-rebinding-guard-at-send-time | ownera | API | request pinned to the checked address | Needs a controllable DNS name; destination-guard source reviewed only | NOT_RUN |
| SEC-HOOK.test-send-to-public-destination | ownera | API | delivery attempt recorded | Would make a real outbound request to example.com; not sent | NOT_RUN |
| SEC-ADMIN.findOrInviteOwner / platform-invite has-account check against unconfirmed squatter | super admin | API | unconfirmed account is not treated as the owner | Super-admin route needs a two-factor session; unit tests (platform-owner-lookup.test.ts) not re-run by this agent | NOT_RUN |

### M. W9-PLN-D1 (open P2) pagination overflow

FAIL 5, PASS 31 (36 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W9-PLN-D1.page=99999999999999999999.4200 | ownera | API 4200 | page beyond the end: empty page or 4xx | 200, page labelled 100000000000000000000 but data = first page rows (no longer 500) | FAIL |
| W9-PLN-D1.page=99999999999999999999.4611 | ownera | API 4611 | page beyond the end: empty page or 4xx | 200, page labelled 100000000000000000000 but data = first page rows (no longer 500) | FAIL |
| W9-PLN-D1.page=1e21.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200, page labelled "1e+21" and data = first page rows | FAIL |
| W9-PLN-D1.page=1e21.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200, page labelled "1e+21" and data = first page rows | FAIL |
| W9-PLN-D1.page=9007199254740993.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":9007199254740992,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=9007199254740993.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":9007199254740992,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=9007199254740991.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":9007199254740991,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=9007199254740991.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":9007199254740991,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=100000.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100000,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=100000.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100000,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=100001.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100001,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=100001.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100001,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=0.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=0.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=-1.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=-1.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=1.5.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=1.5.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=abc.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=abc.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"page","code | PASS |
| W9-PLN-D1.page=1&limit=99999999999999999999.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[{"id":"0581a113-fdb9-40de-896f-bf4f56da42af","organization_id":"00e25215-fdf5-4f1 | PASS |
| W9-PLN-D1.page=1&limit=99999999999999999999.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[{"id":"0581a113-fdb9-40de-896f-bf4f56da42af","organization_id":"00e25215-fdf5-4f1 | PASS |
| W9-PLN-D1.page=2147483648.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":2147483648,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=2147483648.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":2147483648,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=1e2.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=1e2.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":100,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=0x10.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":16,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=0x10.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[],"page":16,"per_page":50,"total":1} | PASS |
| W9-PLN-D1.page=%20%201.4200 | ownera | API 4200 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[{"id":"0581a113-fdb9-40de-896f-bf4f56da42af","organization_id":"00e25215-fdf5-4f1 | PASS |
| W9-PLN-D1.page=%20%201.4611 | ownera | API 4611 | never 5xx; invalid/oversized -> 4xx, or 200 with page echoed exactly | 200 {"data":[{"id":"0581a113-fdb9-40de-896f-bf4f56da42af","organization_id":"00e25215-fdf5-4f1 | PASS |
| W9-PLN-D1.nearby./songs | ownera | API 4200 | never 5xx | 500 {"error":"Internal server error","code":"internal_error"} | FAIL |
| W9-PLN-D1.nearby./people/page | ownera | API 4200 | never 5xx | 200 {"items":[{"id":"42e61d79-eea8-497b-812c-d01337768105","person_id":"42 | PASS |
| W9-PLN-D1.nearby./teams | ownera | API 4200 | never 5xx | 200 [{"id":"e9154efa-7619-4267-9644-f067d0ebeaa6","organization_id":"00e25 | PASS |
| W9-PLN-D1.nearby./notifications | ownera | API 4200 | never 5xx | 200 {"items":[],"unread":0,"next_cursor":null} | PASS |
| W9-PLN-D1.nearby./conversations | ownera | API 4200 | never 5xx | 200 [] | PASS |
| W9-PLN-D1.nearby./service-types | ownera | API 4200 | never 5xx | 200 [] | PASS |

### N. Stale FAIL rows re-run: ACL-01

PASS 17 (17 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-01.direct-insert-organization_members.newcomer-as-owner | admin | D (PostgREST) | denied, no row | 403 row=none {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-admin | admin | D (PostgREST) | denied, no row | 403 row=none {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-member | admin | D (PostgREST) | denied, no row | 403 row=none {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| ACL-01.admin-insert-existing-B-user-into-A | admin | D | denied, no row | 403 rows=0 | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-owner (was positive control) | owner | D (PostgREST) | denied since SEC-003 (joins only via SECURITY DEFINER functions) | 403 | PASS |
| ACL-01.PATCH-access-mode (admin) vs W7-ACC-D2 resolution | admin | API | 403 (not the misleading 404); original row said 2xx - superseded by owner-only decision (… | 403 {"error":"Only the organization owner can change how someone’s access works","co | PASS |
| ACL-01.PATCH-access-mode (owner) | owner | API | 200 | 200 | PASS |
| ACL-01.PATCH-access-mode (bandlead) | bandlead | API | 403 | 403 | PASS |
| ACL-01.PATCH-access-mode (mema) | mema | API | 403 | 403 | PASS |
| ACL-01.PATCH-access-mode (scheda) | scheda | API | 403 | 403 | PASS |
| ACL-01.direct-update.admin-promote-member-to-owner | admina | D (PostgREST) | denied/0 rows; unchanged | 200 role=member | PASS |
| ACL-01.direct-update.admin-deactivate-member-direct | admina | D (PostgREST) | denied/0 rows; unchanged | 200 status=active | PASS |
| ACL-01.direct-update.member-self-promote | mema | D (PostgREST) | denied/0 rows; unchanged | 200 role=member | PASS |
| ACL-01.direct-update.legacy-promote | scheda | D (PostgREST) | denied/0 rows; unchanged | 200 role=member | PASS |
| ACL-01.direct-update.admin-direct-access_mode | admina | D (PostgREST) | denied/0 rows; unchanged | 200 access_mode=undefined | PASS |
| ACL-01.direct-update.admin-access_mode.persisted | admin | DB | access_mode unchanged (owner-only) | access_mode=legacy | PASS |
| ACL-01.direct-delete.admin | admin | D (PostgREST) | denied; row persists | 200 [] | PASS |

### O. Stale FAIL rows re-run: ACL-05 (3 actors x 4 cells x 13 operations, fixtures rebuilt)

PASS 167 (167 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-05.read-prepared.scopedx.SB | scopedx | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=8 | PASS |
| ACL-05.patch-assignment.scopedx.SB | scopedx | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.scopedx.SB | scopedx | API | 200 | 200 | PASS |
| ACL-05.schedule.scopedx.SB | scopedx | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.scopedx.SB | scopedx | API | 200 | 200 | PASS |
| ACL-05.release.scopedx.SB | scopedx | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.scopedx.SB | scopedx | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.scopedx.SB | scopedx | RLS-PostgREST | row updated | 200 [{"id":"c15a343b-8bb4-4f40-b58d-ec2bb0c677ee","plan_id":"b6c notes=direct | PASS |
| ACL-05.direct-insert.scopedx.SB | scopedx | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.scopedx.SB | scopedx | RLS-PostgREST | row deleted | 200 [{"id":"33dcfd3b-88a9-44f7-a9cf-c05663900f9b","pla exists=false | PASS |
| ACL-05.rpc-schedule.scopedx.SB | scopedx | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.scopedx.SB | scopedx | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.scopedx.SB | scopedx | API | 204 gone | 204 exists=false | PASS |
| ACL-05.read-prepared.scopedx.SP | scopedx | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=15 | PASS |
| ACL-05.patch-assignment.scopedx.SP | scopedx | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.scopedx.SP | scopedx | API | 200 | 200 | PASS |
| ACL-05.schedule.scopedx.SP | scopedx | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.scopedx.SP | scopedx | API | 200 | 200 | PASS |
| ACL-05.release.scopedx.SP | scopedx | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.scopedx.SP | scopedx | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.scopedx.SP | scopedx | RLS-PostgREST | row updated | 200 [{"id":"4add6d7d-6738-478b-9882-6c3ab8fe19fc","plan_id":"b6c notes=direct | PASS |
| ACL-05.direct-insert.scopedx.SP | scopedx | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.scopedx.SP | scopedx | RLS-PostgREST | row deleted | 200 [{"id":"52297be6-eee3-4666-8298-7414ebbdd1bd","pla exists=false | PASS |
| ACL-05.rpc-schedule.scopedx.SP | scopedx | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.scopedx.SP | scopedx | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.scopedx.SP | scopedx | API | 204 gone | 204 exists=false | PASS |
| ACL-05.read-prepared.scopedx.MB | scopedx | RLS-PostgREST | 0 rows | 200 rows=0 | PASS |
| ACL-05.patch-assignment.scopedx.MB | scopedx | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.scopedx.MB | scopedx | API | 404 | 404 | PASS |
| ACL-05.schedule.scopedx.MB | scopedx | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.scopedx.MB | scopedx | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.scopedx.MB | scopedx | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.scopedx.MB | scopedx | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.scopedx.MB | scopedx | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.scopedx.MB | scopedx | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.scopedx.MB | scopedx | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.scopedx.MB | scopedx | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.scopedx.MB | scopedx | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.scopedx.MB | scopedx | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.read-prepared.scopedx.MP | scopedx | RLS-PostgREST | 0 rows | 200 rows=0 | PASS |
| ACL-05.patch-assignment.scopedx.MP | scopedx | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.scopedx.MP | scopedx | API | 404 | 404 | PASS |
| ACL-05.schedule.scopedx.MP | scopedx | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.scopedx.MP | scopedx | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.scopedx.MP | scopedx | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.scopedx.MP | scopedx | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.scopedx.MP | scopedx | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.scopedx.MP | scopedx | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.scopedx.MP | scopedx | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.scopedx.MP | scopedx | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.scopedx.MP | scopedx | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.scopedx.MP | scopedx | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.read-prepared.bandlead.SB | bandlead | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=15 | PASS |
| ACL-05.patch-assignment.bandlead.SB | bandlead | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.bandlead.SB | bandlead | API | 200 | 200 | PASS |
| ACL-05.schedule.bandlead.SB | bandlead | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.bandlead.SB | bandlead | API | 200 | 200 | PASS |
| ACL-05.release.bandlead.SB | bandlead | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.bandlead.SB | bandlead | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.bandlead.SB | bandlead | RLS-PostgREST | row updated | 200 [{"id":"cbf5a1c8-e83e-4472-895b-4791727ac28c","plan_id":"b6c notes=direct | PASS |
| ACL-05.direct-insert.bandlead.SB | bandlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.bandlead.SB | bandlead | RLS-PostgREST | row deleted | 200 [{"id":"3db2d7f1-8a13-48bd-98ab-4c597c189df9","pla exists=false | PASS |
| ACL-05.rpc-schedule.bandlead.SB | bandlead | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.bandlead.SB | bandlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.bandlead.SB | bandlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.patch-assignment.bandlead.SP | bandlead | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.bandlead.SP | bandlead | API | 404 | 404 | PASS |
| ACL-05.schedule.bandlead.SP | bandlead | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.bandlead.SP | bandlead | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.bandlead.SP | bandlead | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.bandlead.SP | bandlead | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.bandlead.SP | bandlead | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.bandlead.SP | bandlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.bandlead.SP | bandlead | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.bandlead.SP | bandlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.bandlead.SP | bandlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.bandlead.SP | bandlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.read-prepared.bandlead.MB | bandlead | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=16 | PASS |
| ACL-05.patch-assignment.bandlead.MB | bandlead | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.bandlead.MB | bandlead | API | 200 | 200 | PASS |
| ACL-05.schedule.bandlead.MB | bandlead | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.bandlead.MB | bandlead | API | 200 | 200 | PASS |
| ACL-05.release.bandlead.MB | bandlead | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.bandlead.MB | bandlead | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.bandlead.MB | bandlead | RLS-PostgREST | row updated | 200 [{"id":"580a0d94-0576-4454-bb69-b8ebfbbfb05e","plan_id":"eae notes=direct | PASS |
| ACL-05.direct-insert.bandlead.MB | bandlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.bandlead.MB | bandlead | RLS-PostgREST | row deleted | 200 [{"id":"5f411bbf-3090-48f3-9a7c-1eb1e6c7a2c0","pla exists=false | PASS |
| ACL-05.rpc-schedule.bandlead.MB | bandlead | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.bandlead.MB | bandlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.bandlead.MB | bandlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.patch-assignment.bandlead.MP | bandlead | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.bandlead.MP | bandlead | API | 404 | 404 | PASS |
| ACL-05.schedule.bandlead.MP | bandlead | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.bandlead.MP | bandlead | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.bandlead.MP | bandlead | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.bandlead.MP | bandlead | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.bandlead.MP | bandlead | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.bandlead.MP | bandlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.bandlead.MP | bandlead | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.bandlead.MP | bandlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.bandlead.MP | bandlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.bandlead.MP | bandlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.patch-assignment.prodlead.SB | prodlead | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.prodlead.SB | prodlead | API | 404 | 404 | PASS |
| ACL-05.schedule.prodlead.SB | prodlead | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.prodlead.SB | prodlead | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.prodlead.SB | prodlead | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.prodlead.SB | prodlead | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.prodlead.SB | prodlead | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.prodlead.SB | prodlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.prodlead.SB | prodlead | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.prodlead.SB | prodlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.prodlead.SB | prodlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.prodlead.SB | prodlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.read-prepared.prodlead.SP | prodlead | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=23 | PASS |
| ACL-05.patch-assignment.prodlead.SP | prodlead | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.prodlead.SP | prodlead | API | 200 | 200 | PASS |
| ACL-05.schedule.prodlead.SP | prodlead | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.prodlead.SP | prodlead | API | 200 | 200 | PASS |
| ACL-05.release.prodlead.SP | prodlead | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.prodlead.SP | prodlead | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.prodlead.SP | prodlead | RLS-PostgREST | row updated | 200 [{"id":"b1b9f067-7412-4bf1-81bf-f52e44c3d80b","plan_id":"b6c notes=direct | PASS |
| ACL-05.direct-insert.prodlead.SP | prodlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.prodlead.SP | prodlead | RLS-PostgREST | row deleted | 200 [{"id":"531765be-3d4f-44d2-b0a8-39b64a562b6f","pla exists=false | PASS |
| ACL-05.rpc-schedule.prodlead.SP | prodlead | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.prodlead.SP | prodlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.prodlead.SP | prodlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.patch-assignment.prodlead.MB | prodlead | API | 404 no change | 404 notes=null | PASS |
| ACL-05.patch-prepared.prodlead.MB | prodlead | API | 404 | 404 | PASS |
| ACL-05.schedule.prodlead.MB | prodlead | API | 4xx no new row | 403 rows 0->0 | PASS |
| ACL-05.assignment-times.prodlead.MB | prodlead | API | 4xx | 400 Some requests or times are not on this plan | PASS |
| ACL-05.release.prodlead.MB | prodlead | API | 4xx still prepared | 409 vis=prepared Prepared requests changed since the release review | PASS |
| ACL-05.response-owner.prodlead.MB | prodlead | API | 4xx no change | 404 owner=other | PASS |
| ACL-05.direct-patch.prodlead.MB | prodlead | RLS-PostgREST | 0 rows/denied no change | 200 [] notes=null | PASS |
| ACL-05.direct-insert.prodlead.MB | prodlead | RLS-PostgREST | denied (42501) no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.direct-delete.prodlead.MB | prodlead | RLS-PostgREST | no row deleted | 200 [] exists=true | PASS |
| ACL-05.rpc-schedule.prodlead.MB | prodlead | RPC | denied no row | 403 rows=0 {"code":"42501","details":null,"hint":null,"messag | PASS |
| ACL-05.delete-assignment.prodlead.MB | prodlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.delete-assignment.second-row.prodlead.MB | prodlead | API | 404 still exists | 404 exists=true | PASS |
| ACL-05.read-prepared.prodlead.MP | prodlead | RLS-PostgREST | prepared rows visible (>=8) | 200 rows=24 | PASS |
| ACL-05.patch-assignment.prodlead.MP | prodlead | API | 200 saved | 200 notes=w10 patch | PASS |
| ACL-05.patch-prepared.prodlead.MP | prodlead | API | 200 | 200 | PASS |
| ACL-05.schedule.prodlead.MP | prodlead | API | 201 +1 row | 201 rows 0->1 | PASS |
| ACL-05.assignment-times.prodlead.MP | prodlead | API | 200 | 200 | PASS |
| ACL-05.release.prodlead.MP | prodlead | API | 200 released | 200 vis=released | PASS |
| ACL-05.response-owner.prodlead.MP | prodlead | API | 200 | 200 owner=actor | PASS |
| ACL-05.direct-patch.prodlead.MP | prodlead | RLS-PostgREST | row updated | 200 [{"id":"b44f3007-fd19-4386-8b88-db8d4898c7c2","plan_id":"eae notes=direct | PASS |
| ACL-05.direct-insert.prodlead.MP | prodlead | RLS-PostgREST | insert ok or constraint | 201 rows=1 "" | PASS |
| ACL-05.direct-delete.prodlead.MP | prodlead | RLS-PostgREST | row deleted | 200 [{"id":"0230bc86-0bcf-4972-859a-299b13983485","pla exists=false | PASS |
| ACL-05.rpc-schedule.prodlead.MP | prodlead | RPC | ok | 200 rows=1 | PASS |
| ACL-05.delete-assignment.prodlead.MP | prodlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.second-row.prodlead.MP | prodlead | API | 204 gone | 204 exists=false | PASS |
| ACL-05.delete-assignment.random-uuid.owner | ownera | API | 404 | 404 | PASS |
| ACL-05.delete-assignment.cross-tenant.ownerb | ownerb | API | 404, row kept | 404 | PASS |
| ACL-05.delete-assignment.plain-member | mema | API | 403 | 403 | PASS |
| ACL-05.read-prepared.scopedx.SB.by-team (rerun, team-filtered) | scopedx | RLS-PostgREST | all 22 prepared rows visible | 200 rows=22 db=22 | PASS |
| ACL-05.read-prepared.scopedx.SP.by-team (rerun, team-filtered) | scopedx | RLS-PostgREST | all 22 prepared rows visible | 200 rows=22 db=22 | PASS |
| ACL-05.read-prepared.scopedx.MB.by-team (rerun, team-filtered) | scopedx | RLS-PostgREST | 0 rows | 200 rows=0 db=23 | PASS |
| ACL-05.read-prepared.scopedx.MP.by-team (rerun, team-filtered) | scopedx | RLS-PostgREST | 0 rows | 200 rows=0 db=23 | PASS |
| ACL-05.read-prepared.bandlead.SB.by-team (rerun, team-filtered) | bandlead | RLS-PostgREST | all 22 prepared rows visible | 200 rows=22 db=22 | PASS |
| ACL-05.read-prepared.bandlead.SP.by-team (rerun, team-filtered) | bandlead | RLS-PostgREST | 0 rows | 200 rows=0 db=22 | PASS |
| ACL-05.read-prepared.bandlead.MB.by-team (rerun, team-filtered) | bandlead | RLS-PostgREST | all 23 prepared rows visible | 200 rows=23 db=23 | PASS |
| ACL-05.read-prepared.bandlead.MP.by-team (rerun, team-filtered) | bandlead | RLS-PostgREST | 0 rows | 200 rows=0 db=23 | PASS |
| ACL-05.read-prepared.prodlead.SB.by-team (rerun, team-filtered) | prodlead | RLS-PostgREST | 0 rows | 200 rows=0 db=22 | PASS |
| ACL-05.read-prepared.prodlead.SP.by-team (rerun, team-filtered) | prodlead | RLS-PostgREST | all 22 prepared rows visible | 200 rows=22 db=22 | PASS |
| ACL-05.read-prepared.prodlead.MB.by-team (rerun, team-filtered) | prodlead | RLS-PostgREST | 0 rows | 200 rows=0 db=23 | PASS |
| ACL-05.read-prepared.prodlead.MP.by-team (rerun, team-filtered) | prodlead | RLS-PostgREST | all 23 prepared rows visible | 200 rows=23 db=23 | PASS |

### P. Stale FAIL rows re-run: SEC-01 (hostile strings, malformed/oversize bodies, chat/notes)

PASS 63 (63 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-01.team-name.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.team-position.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.song-title.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.song-author.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.person-name.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.person-email-ish.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.plan-title.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.folder-name.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.service-type-name.nul | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.song-title.lone-surrogate | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.team-name.escaped-nul-json | owner | API | 4xx validation, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.person-name.200k | owner | API | 4xx validation, never 500 | 413 {"error":"Request body is too large","code":"payload_too_large"} | PASS |
| SEC-01.team-name.200k | owner | API | 4xx validation, never 500 | 413 {"error":"Request body is too large","code":"payload_too_large"} | PASS |
| SEC-01.song-title.max+1 | owner | API | 4xx validation, never 500 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"title","code":" | PASS |
| SEC-01.free-item.nul | owner | API | 4xx not 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.song-search-hostile-query | owner | API | 200/400 not 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.song-search."%" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."_" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."\\" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."\"'" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."()," | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."*" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."a&b=c" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search."%00" | owner | API | not 5xx | 200 | PASS |
| SEC-01.song-search.raw-lone-surrogate-percent-encoded | owner | API | not 5xx | 200 | PASS |
| SEC-01.people-search-nul | owner | API | not 5xx | 422 | PASS |
| SEC-01.global-search-nul | owner | API | not 5xx | 422 | PASS |
| SEC-01.malformed-json.auth /songs | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.malformed-json.anon respond | anonymous | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.malformed-json.auth plans | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.primitive-string.auth /songs | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.primitive-string.anon respond | anonymous | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.primitive-string.auth plans | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.null.auth /songs | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.null.anon respond | anonymous | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.null.auth plans | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.truncated.auth /songs | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.truncated.anon respond | anonymous | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.truncated.auth plans | owner | API | 4xx, generic message (no parser text) | 400 Request body is not valid JSON (generic message, no parser text) | PASS |
| SEC-01.array.auth /songs | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.array.anon respond | anonymous | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.array.auth plans | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.bom.auth /songs | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.bom.anon respond | anonymous | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.bom.auth plans | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.deep-nesting.auth /songs | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.deep-nesting.anon respond | anonymous | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.deep-nesting.auth plans | owner | API | 4xx, generic message (no parser text) | 422 Invalid request body | PASS |
| SEC-01.oversize-body-2MB./songs | owner | API | 413/400 not 500 | 413 {"error":"Request body is too large","code":"payload_too_large"} | PASS |
| SEC-01.oversize-body-2MB./plans | owner | API | 413/400 not 500 | 413 {"error":"Request body is too large","code":"payload_too_large"} | PASS |
| SEC-01.oversize-body-3MB.imports | owner | API | 413 not 500 | 413 {"error":"Import request is too large","code":"import_too_large"} | PASS |
| SEC-01.note.create.nul | owner | API | 4xx not 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| SEC-01.chat.list | owner | API | info | 0 conversations | PASS |
| SEC-01.chat.send.nul./plans/0581a113-fdb9-40de-896f-bf4f56da42af/messages | owner | API | 4xx or 201, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.send.surrogate./plans/0581a113-fdb9-40de-896f-bf4f56da42af/messages | owner | API | 4xx or 201, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.send.nul./conversations | owner | API | 4xx or 201, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.send.surrogate./conversations | owner | API | 4xx or 201, never 500 | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.open-plan-conversation | owner | API | 200/201 | 200 {"id":"c32dc242-bc98-4058-9a65-65dad7bd48fa","kind":"plan"," | PASS |
| SEC-01.chat.send.nul.real-endpoint | owner | API | never 500 (4xx) | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.send.lone-surrogate-json.real-endpoint | owner | API | never 500 (4xx) | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.send.normal.real-endpoint | owner | API | 201 | 201 {"item":{"id":"a0694f53-1de6-4290-bf00-353ca5e474e7","organization_id" | PASS |
| SEC-01.chat.send.escaped-nul-raw.real-endpoint | owner | API | never 500 (4xx) | 422 {"error":"Text contains unsupported characters","code":"unprocessable" | PASS |
| SEC-01.chat.html-like-stored-verbatim | owner | API | returned as text (client escapes) | 200 | PASS |

### Q. Stale FAIL rows re-run: SEC-02 (CORS, rate limit, signed URLs)

PASS 15 (15 rows)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-02.cors-preflight.http://evil.example.4200 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.null.4200 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.https://evil.vercel.app.evil.com.4200 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.(x).4200 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-disallowed-status-code.4200 | anonymous | API | 4xx (not 5xx stack) | 401 | PASS |
| SEC-02.cors-allowed-origin-control.4200 | anonymous | API | ACAO for allowed origin | 401 acao=null (:4200 allows its own origin http://localhost:5180 via env; 5173 not configured there) | PASS |
| SEC-02.cors-preflight.http://evil.example.4611 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.null.4611 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.https://evil.vercel.app.evil.com.4611 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-preflight.(x).4611 | anonymous | API | no 5xx; no ACAO for disallowed origin | 401 acao=null {"error":"Missing bearer token","code":"unauthorized"} | PASS |
| SEC-02.cors-disallowed-status-code.4611 | anonymous | API | 4xx (not 5xx stack) | 401 | PASS |
| SEC-02.cors-allowed-origin-control.4611 | anonymous | API | ACAO for allowed origin | 204 acao=http://localhost:5173 | PASS |
| SEC-02.rate-limit.production-limit-300.requests-up-to-limit | client | API 4612 (production) | ~300 OK then 429 | ok=300 limited=40 (some earlier log-test requests consumed budget) | PASS |
| SEC-02.rate-limit.production-limit-300.xff-spoof-does-not-bypass | client | API 4612 | 429 (X-Forwarded-For ignored w/o trust proxy) | statuses=429,429,429,429 | PASS |
| SEC-02.rate-limit.other-spoof-headers-ignored | client | API 4612 | 429 | 429 | PASS |

## Not run / blocked / not applicable

| Item | Status | Reason |
|---|---|---|
| Chart blob tab, unsandboxed srcdoc preview, PDF frame opened in a real browser; web/mobile accept-invite "confirm your email" / "sign in to join" screens | NOT_RUN | Browser owned by W10-WEB; no simulator. Source checked instead: `ChartPreview` `sandbox="allow-scripts"`, CSP meta (default-src 'none', script by sha256) in chart and song-book documents; the hash in the CSP equals the sha256 of the real inline script |
| Frontend headers live on Vercel; Vite dev server | NOT_APPLICABLE | Headers exist only in `frontend/vercel.json` and `frontend/nginx.conf` (hosting config). Vercel not reachable; the nginx config was verified live in a private container |
| From header through real Resend | NOT_RUN | Simulated email only; `mailbox()` output verified directly for 10 inputs (comma, angle brackets, quote, backslash, CR/LF/NUL, empty, Unicode) |
| Webhook DNS-rebinding guard at send time; test-send to a public host | NOT_RUN | Needs a controllable DNS name / would make a real outbound request |
| Super-admin `findOrInviteOwner` and platform-invite has-account check with an unconfirmed squatter | NOT_RUN | Needs a two-factor super-admin session; vitest `platform-owner-lookup.test.ts` not re-run by this agent |
| Signed-URL reuse after revoke/delete (2 stale SEC-02 rows) | NOT_APPLICABLE | Documented residual (ADR 0005) |
| Raw Storage upload to `attachments` | BLOCKED | Needs the API upload-intent flow (`private.can_upload_attachment_object`); not reachable from a bare Storage POST |
| Development-limit (10,000) rate-limit run | not repeated | Production default run covers the same limiter and `trust proxy` code path |

## Fixtures left in place

- Orgs `qa-w10-sec-a`, `-b`, `-c` (and `qa-w10-sec-d-*` was not created: self-serve creation is off, `church_application_required`); users `ownera, admina, scheda, mema, liba, ownerb, memb, ownerc, newcomer, victim, mallory, scopedx, bandlead, prodlead` `.qaw10.sec@example.test` and invitation-created logins `inv1.*`, `race.*`, `race2.*`, `override.*`, `squat.*`, `linker.*` (some unconfirmed by design). Cleanup left to the coordinator (delete the orgs; the users).
- Org A: persons including the hostile-name guests (`=cmd|calc`, full-width formula names, `W10G*`), the swap team/plan, ACL-05 service types/teams/plans with remaining assignments, song + arrangements (`QA W10 XSS …`), one plan conversation message, a join request (approved), an organization-logos object per org A and B (`w10-*.png`, `evil2-*.png`), grants (`liba` songs.manage; scoped/team grants), memberships of `memb` and `mallory` in A.
- Org B/C: logo object in B.
- Access mode of `scopedx`, `bandlead`, `prodlead` = `scoped`; `mema` back to `legacy`.
- Private API instances `:4611`, `:4612` and the nginx container `w10-sec-nginx` were stopped; scratchpad logs `api4611.log`, `api4612.log`, `log-excerpt-*.txt` and harness scripts are in `/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-glassfish/b2798cb9-818c-4968-93be-9fd375629001/scratchpad/w10-sec` (no credentials in this report).
