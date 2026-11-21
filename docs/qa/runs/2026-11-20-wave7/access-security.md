# W7-R3 access, tenant isolation and security regression (QA-01 / QA-02 / QA-15 security subset)

| Field | Value |
|---|---|
| Package | W7-R3 (AUTH-04 API, ACL-01–06, TEAM-01–02 deletion/roster, ORDER-01 free-form items, SEC-01, SEC-02) |
| Commit | `473fb69` (= main), branch `feature/qa-wave7`; no code/config/migration changes made |
| Env | API :4000 (simulated email/push), local Supabase (anon/JWT only for permission evidence; service role/GoTrue admin only for fixture setup), Node 26.13.1. Browser, mobile and delivery worker not used |
| Namespace | orgs `qa-20261120-acc-a` (A) and `qa-20261120-acc-b` (B); users `<alias>.qa20261120.acc@example.test`; credentials only in the session scratchpad |
| Fixture shape | A: owner, admin, legacy scheduler, scoped scheduler (Sunday plans.edit + scheduling.manage), band-lead member (Band-team scheduling.manage + teams.manage), people-grant member (org people.manage + people.view_private), ordinary member, librarian (org songs.manage), teamsgrant (org teams.manage), stgrant (teams.manage @ Sunday type), inactive, removed(inactive), multi (A and B), rev1-rev11 (mid-session revocation subjects); services Sunday/Midweek, teams Band/Production, 2 plans + a prepared/released plan, songs, guest Person, files. B: betaowner, multi, service type, team+position, plan, item, song, guest, prepared assignment, 2 files. `newcomer` (no org), anonymous |
| Source files read | middleware/organization.ts, auth.ts, services/organization-context.ts, migration 20261122000100_perf_org_context.sql, routes/teams.ts, plans.ts items, files.ts, RLS migrations 20260101000100, 20261017000000, 20261109000000, storage policies |
| DB test | `supabase/tests/perf-org-context.sql` (wrapped begin/rollback): ran with ON_ERROR_STOP, no error, ended `ROLLBACK`, exit 0, no rows persisted |

## P0 (read first)

**W7-ACC-D1 (P0): an organization admin can add any authenticated user to their organization as `owner` (or admin/member) by inserting into `organization_members` through PostgREST with the admin's own JWT.** Details under Defects. The newly inserted owner immediately had `can_administer_access=true`, `/access/members` 200 and private Person detail 200. The same insert is also possible for a user from another tenant (no consent/invite). Owner-only update/delete RLS exists, insert does not. Escalated to coordinator.

## Summary

Counts are expanded case records (one per actor x action x surface). About 40 of the PASS records are informational (observed behaviour recorded, no oracle disagreement).

| Status | Count |
|---|---|
| PASS | 1077 |
| FAIL | 22 (rolling up to the 10 defects below) |
| BLOCKED | 0 |
| NOT_RUN | 9 groups (listed below; each covers several cases) |
| NOT_APPLICABLE | 2 |

Mid-session revocation: no auth/session/context caching exists in the source (`grep` of backend for ttl/cache found only `Cache-Control` headers) and none was observed. Deactivate membership, revoke grant, role demotion, legacy->scoped, membership delete, auth user delete, global sign-out, ban and API-key revoke/expiry/issuer-demotion were all denied on the very next request (<1 s, same token). Delay recorded: 0 requests of lag in every case. Residual: Storage signed URLs (300 s) and a signed-out/deleted user's access JWT at direct PostgREST/Storage (until `jwt_expiry=3600`) are not revoked (observations O1/O2, D7).

Retests of wave 1 defects: API-D1 (position from other team/org) PASS, API-D2 (plan with other org's service type) PASS, API-D3 (arrangement chart/materials ignore org header) PASS (404 in wrong org context), API-D4 (invalid IANA timezone) PASS (422), API-D5 (malformed UUID path -> 500) PASS (400), API-D6 (duplicate positions partial write) PASS (422, no team row). `my_org_context` capabilities equal `my_effective_access` for owner, admin, legacy, scoped, band-lead, people-grant, member, librarian (8/8; entries compared by capability/scope/source).

## Source / plan disagreements

1. Team deletion. Commit 2eec3c3 and the UI text say "owner team deletion" (web Teams page shows Delete only when `role === 'owner'`). The API (`DELETE /teams/:id`, backend/src/routes/teams.ts:161 gated only by `requireCapability('teams.manage')`) and RLS (`teams_delete`, 20261017000000_f01_scoped_capabilities.sql:582 `has_capability(org,'teams.manage',service_type_id)`) let admin, legacy scheduler (effective org-wide teams.manage), any org-wide teams.manage grantee and a service-type teams.manage grantee (for teams in that type) delete a team. Observed (team with 2 positions, 1 member, 1 assignment): owner/admin/legacy/teamsgrant 204 and rows gone; stgrant deletes only a team in its own service type; scoped/member/people-grant/librarian 403. Cascade: positions, memberships, ALL assignments of that team on every plan (including released/confirmed ones; FK `assignments_team_id_fkey ON DELETE CASCADE`), plan position needs, signup opportunities, replacement requests (open request cascaded cleanly, no FK error), rotations, tag rules, file audiences. Plan items' `leader_position_id` become NULL. No history/audit row remains. The confirm dialog does state that assignments are deleted. => W7-ACC-D3.
2. Oracle says admin may manage "access grants"; PATCH `/access/members/:userId` (access_mode) is `requireAdmin` in the route but RLS on `organization_members` updates is owner-only, so an admin gets a misleading 404. => W7-ACC-D2.
3. People grants (`people.manage`, `people.view_private`) are stored but yield zero effective-access entries (inert), consistent with the oracle.
4. Foreign/unknown service-type ids on `GET /service-types/:id/teams` and `/:id/access` return `200 []` / empty grants (identical to a non-existent id, so no existence disclosure), not 404.


## Defects

| ID | Pri | Title |
|---|---|---|
| W7-ACC-D1 | P0 | Admin can insert organization_members rows with any role (incl. owner) via PostgREST |
| W7-ACC-D3 | P1 | Team deletion not owner-only in API/RLS; DELETE is a silent 204 no-op when RLS/org filters match nothing |
| W7-ACC-D2 | P2 | Admin PATCH /access/members/:id returns misleading 404 (RLS owner-only vs requireAdmin gate) |
| W7-ACC-D4 | P2 | `DELETE /teams/:id` (and position/foreign deletes) return 204 for non-existent, cross-org and RLS-denied ids |
| W7-ACC-D5 | P2 | NUL character in any string field -> 500 with raw Postgres error (`22P05`) |
| W7-ACC-D6 | P2 | Malformed JSON and oversize bodies -> 500 `internal_error` (parser message echoed) |
| W7-ACC-D7 | P2 | Storage signed download URL valid for its full 300 s after membership revoked or file deleted |
| W7-ACC-D8 | P2 | Org-logo bucket accepts SVG with script and serves it without CSP/nosniff |
| W7-ACC-D9 | P2 | Disallowed CORS origin preflight returns 500 `internal_error` |
| W7-ACC-D10 | P2 | `X-Organization-Id` with upper-case UUID is rejected 403 "not a member" |

### W7-ACC-D1 (P0) admin to owner escalation via organization_members insert
- Repro (admin JWT = `admin` alias, org A; any existing auth user id as target, even a user with no org or a user of org B):
  `POST {SUPABASE_URL}/rest/v1/organization_members` with the admin's access token, apikey=anon, body `{"organization_id":"<A>","user_id":"<target>","role":"owner","status":"active"}` -> **201**, row persisted (`owner/active`). Repeated with role `admin` and `member`: 201. Same with `betaowner` (an org B owner) as target: 201.
- Impact chain: the inserted account (controlled by the admin) is a full owner: `/access/me` `can_administer_access=true`, `/access/members` 200, `GET /people/:id` private detail 200. Owner-only RLS (`members_owner_update/delete`) then lets that owner demote/remove the real owner. Also adds arbitrary users to a tenant without invitation or consent.
- Expected: oracle says admins cannot change membership through People nor self-promote; membership changes owner-only (update/delete already restrictive, insert not). Negative controls: legacy, band-lead, member, people-grant and newcomer inserts all 403; admin UPDATE (promote self/other/demote owner/deactivate) and DELETE are blocked (no change); admin insert into org B 403; owner insert 201 (control).
- Suspected: `supabase/migrations/20260101000100_rls.sql:110` (`members_insert ... with check (is_org_admin(organization_id))`) was never restricted; `supabase/migrations/20261109000000_owner_people_permissions.sql:107-111` adds restrictive owner-only policies for UPDATE and DELETE only.
- Evidence rows: ACL-01.direct-insert-organization_members.* (t13). Fixture rows created by the test were removed again.

### W7-ACC-D3 (P1) team deletion scope disagrees with "owner" intent
See disagreement 1. Repro: as `legacy` (scheduler) `DELETE /api/v1/teams/<team with assignment>` -> 204; team, positions, memberships and the plan assignment are gone. Expected per commit/UI: owner only (or an explicit decision to allow admin/grantees). Needs a product decision; if owner-only is intended, add owner restriction in the route and an RLS restrictive policy on `teams` delete. Suspected: backend/src/routes/teams.ts:161, `20261017000000_f01_scoped_capabilities.sql:582`.

### W7-ACC-D2 (P2)
Repro: `PATCH /access/members/<scoped user id> {"access_mode":"scoped"}` as admin -> 404 `That person is not in this organization`; as owner 200. Expected 403 (like `PATCH /people/members/:id` as admin, which returns 403 "Only the organization owner...") or admin permitted. Suspected: backend/src/services/access.ts:92-102 + routes/access.ts:46 (`requireAdmin`), RLS `members_owner_update`.

### W7-ACC-D4 (P2)
Repro: `DELETE /teams/<orgB team>` in A context, `DELETE /teams/<random uuid>`, and `DELETE /teams/<Production team>` as band-lead (has teams.manage only at Band-team scope) -> 204 each, nothing deleted (verified in DB). Same for `DELETE /teams/:id/positions/<foreign position>` (204, B position persisted); `DELETE /assignments/<orgB id>` and `DELETE /plans/:id/items/<orgB item>` left the B rows intact (status code not recorded as 404 vs 204). Expected 404 (membership delete returns 404 correctly: `/teams/:id/members/:membershipId`). The UI could show a false "deleted". Suspected: backend/src/routes/teams.ts:161 (no `.select('id')` / row-count check). Wave 1 observation "foreign-ID deletes return 204 no-op" still holds.

### W7-ACC-D5 (P2)
Repro: `POST /teams {"name":"a\u0000b"}` (also song title, free-form item title/description, guest name, plan title, `GET /songs?q=x%00y`) -> 500 `{"error":"unsupported Unicode escape sequence","code":"22P05"}`. Expected 400/422 from Zod and no DB error text. Suspected: no NUL rejection in `packages/shared/src/schemas/common.ts` string helpers (`nonEmpty`) and the generic 500 path in backend/src/middleware/error-handler.ts:35.

### W7-ACC-D6 (P2)
Repro: `POST /api/v1/teams` with body `{"name":` -> 500 `{"error":"Unexpected end of JSON input","code":"internal_error"}`; 200 KB or 2 MB JSON -> 500 `request entity too large` (default 100 kb limit). Expected 400 / 413. Only `/imports` maps `entity.parse.failed` / `entity.too.large` (backend/src/app.ts importBodyError). Suspected: app.ts `express.json()` with no error mapper; error-handler.ts:35.

### W7-ACC-D7 (P2)
Repro: member requests `POST /files/:id/download` -> signed URL (ttl 300 s). Owner deactivates the member (or deletes the file, 204). Immediately `GET <url>` -> 200 with the bytes, anonymous (no session). New download requests are denied (403/404) and direct Storage with the member's JWT is denied. Expected "no bypass through object URL" (plan SEC-02). Bounded by 300 s; consider shorter TTL or revoking on delete (object remains in `storage.objects` until the removal queue runs). Suspected: backend/src/services/files.ts (createSignedUrl, `FILE_DOWNLOAD_TTL_SECONDS` = 300).

### W7-ACC-D8 (P2)
Repro: admin uploads `<svg ...><script>alert(1)</script></svg>` to `organization-logos/<org>/x.svg` (bucket allows `image/svg+xml`, public read); `GET /storage/v1/object/public/...` -> 200 `image/svg+xml`, no `Content-Security-Policy`, no `X-Content-Type-Options`. Script runs if the URL is opened directly (Supabase origin). Suspected: `supabase/migrations/20260905000100_branding_and_songbooks.sql:63` allowed types; no server-side SVG sanitising.

### W7-ACC-D9 (P2)
Repro: `OPTIONS /api/v1/plans` with `Origin: http://evil.example` -> 500 `{"error":"Origin http://evil.example is not allowed","code":"internal_error"}`. No `Access-Control-Allow-Origin` is sent (browser blocks it, so no bypass) but the status is 500. Allowed origins (5173, 5174, 8081, exp://) get 204 with ACAO and credentials; `localhost:5173.evil.example`, `https://localhost:5173`, `null`, trailing-slash and a `.vercel.app` origin (previews off) got no ACAO. Suspected: backend/src/app.ts:99-111 (`callback(new Error(...))`).

### W7-ACC-D10 (P2)
Repro: `X-Organization-Id: <A id in UPPER case>` as any member -> 403 `You are not a member of that organization` (valid UUID, different case). Suspected: backend/src/middleware/organization.ts:78 strict string compare (`m.organizationId === requested`); lowercase the requested id after `isUuid`. Check whether mobile sends upper-case UUIDs.

## Observations (no oracle violation, recorded for the coordinator)

- O1: a signed-out user or one deleted from Auth keeps a working access JWT at direct PostgREST/Storage until `jwt_expiry` (3600 s); the API denies at once because `requireAuth` calls `auth.getUser` every request (PERF-005 intent held). A deleted-membership user sees `[]` at PostgREST.
- O2: file upload does no content sniffing: HTML bytes uploaded as `application/pdf` finalize `ready`; served as `application/pdf` with no `nosniff`. Bytes larger than the declared size fail finalize with `size_mismatch` (object row stays, a removal is queued). Wrong `Content-Type` on the signed upload (text/html) is rejected by the bucket allowlist.
- O3: `anon` has table-level SELECT on 75 `public` tables; every one returned 0 rows with the anon key (RLS holds) and anon writes (5 tables) were denied. Defence is RLS only.
- O4: hostile strings (script, img onerror, SQL, template, CSV-formula, RTL override, ZWJ, emoji, NFC/NFD Vietnamese, newline, CRLF header injection, path traversal) are stored verbatim (trimmed) and returned as JSON with `application/json`; storage object paths use a slug of the filename with no slashes. Not exercised: rendering in web/email/PDF (owned elsewhere).
- O5: the global limiter is `10000/60s` outside production (300 in production, config.ts/app.ts); the per-API-key limiter behaves (limit 3: 200,200,200,429,429, Retry-After/RateLimit headers).
- O6: `requireCapability` gates pass anywhere-holders (band-lead passes `teams.manage` for any team) and RLS then decides, so denied cases surface as 204/404 rather than 403 (see D4).

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| All web (W) steps of AUTH-04 (dashboard totals, sidebar, breadcrumbs, search UI, deep links, hard refresh), TEAM-01 Teams page delete modal, ORDER-01 AddItemModal/EditItemModal | NOT_RUN | Browser owned by W7-WEB |
| Mobile (M) steps of every owned case | NOT_RUN | Out of package (native) |
| Global rate-limit exhaustion and GoTrue sign-in throttling | NOT_RUN | Limiter shared with other agents at 10 000/min; only per-key limiter and header inspection run. Nothing to wait out |
| Real access-token expiry (3600 s) and refresh-token rotation timing | NOT_RUN | Too long; tampered/forged/alg=none/foreign-sub JWTs all 401 |
| ACL-02 folder-lead, folder inheritance, nested move preview, cycle rejection, archive/default landing | NOT_RUN | Out of owned focus areas (service-type scope and legacy->scoped done) |
| ACL-05 parity for counts, search and reports of prepared assignments | NOT_RUN | Schedule, calendar, ICS feed, notifications, assignment id and PostgREST covered; reports/counts/search not examined |
| TEAM-02 secure-team eligibility and policy defaults | NOT_RUN | Only tag-rules/related-teams/team-access permissions covered |
| SEC-01 CSV imports, notes/chat/email/PDF rendering, public-view rendering, 250-person/125-song volume | NOT_RUN | Other packages / D17 volume dataset not loaded |
| SEC-02 webhook endpoints and delivery worker | NOT_RUN | Delivery worker not mine |
| Mid-session edit of an open roster/editor ("revoke while editor open") | NOT_APPLICABLE | Browser state; API outcome after revoke is covered |
| `suspended` membership status | NOT_APPLICABLE | Only settable by platform-admin disable flow (trigger refuses otherwise) |

## Fixtures left in place

Orgs `qa-20261120-acc-a`, `qa-20261120-acc-b` and 27 auth users `*.qa20261120.acc@example.test`; org A: service types, teams (Band, Production), plans (incl. one published with a released assignment), songs (some `acl song`, hostile-string songs/teams/people/plans/items from SEC-01 loop remain), files (a-org, a-leaders, hostile-name, link), org grants (peoplegrant, librarian, teamsgrant, overridegrant), service-type grant (scoped, stgrant), team grant (bandlead); membership states: inactive, removed (inactive), rev1/rev10 inactive, rev6 demoted, rev7 scoped, rev8 deleted. Org B: service type, team, plan, item, song, two files, prepared assignment (set via SQL). Org A `timezone`/`name` unchanged. No other qa-* org or riverside rows touched. Credentials and the test scripts (`t1`-`t17`) are in the session scratchpad `access/` directory.

## Result tables

Case IDs are `<case>.<variant>`; consecutive identical results across roles are merged into one row.

### AUTH-04 / AUTH-02 (org context, header, session, capabilities)

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| AUTH-04.hdr-valid | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 200 | 200 | PASS |
| AUTH-04.hdr-missing-1org | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 200 (inferred) | 200 | PASS |
| AUTH-04.hdr-foreign-org | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 403 | 403 {"error":"You are not a member of that organization","code": | PASS |
| AUTH-04.hdr-random-uuid | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 403 | 403 | PASS |
| AUTH-04.hdr-malformed | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 400 | 400 | PASS |
| AUTH-04.hdr-sqli | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 400 | 400 | PASS |
| AUTH-04.hdr-whitespace | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 200 (trimmed) | 200 | PASS |
| AUTH-04.query-foreign-org | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 403 | 403 | PASS |
| AUTH-04.hdr-uppercase-uuid | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 200 or 403, not 500 | 403 | PASS |
| AUTH-04.inactive-nohdr | inactive, removed | API | 403 | 403 {"error":"You are not a member of any organization yet","code":"forbid | PASS |
| AUTH-04.inactive-hdr | inactive, removed | API | 403 | 403 | PASS |
| AUTH-04.inactive-plans | inactive, removed | API | 403 | 403 | PASS |
| AUTH-04.inactive-/me | inactive, removed | API | 200 (no org needed) | 200 | PASS |
| AUTH-04.newcomer-nohdr | newcomer | API | 403 | 403 {"error":"You are not a member of any organization yet","code":"forbid | PASS |
| AUTH-04.newcomer-hdr | newcomer | API | 403 | 403 | PASS |
| AUTH-04.newcomer-/me | newcomer | API | 200 | 200 | PASS |
| AUTH-04.newcomer-/organizations | newcomer | API | 200 empty | 200 [] | PASS |
| AUTH-04.multi-nohdr | multi | API | 400 + organization_ids | 400 {"error":"Multiple organizations available — send an X-Organization-Id header","code":"bad_request","details":{"organiza | PASS |
| AUTH-04.multi-hdr | multi | API | 200 | 200 | PASS |
| AUTH-04.anon | anonymous | API | 401 | 401 | PASS |
| AUTH-04.anon-/me | anonymous | API | 401 | 401 | PASS |
| AUTH-04.garbage-token | anonymous | API | 401 | 401 | PASS |
| AUTH-04.malformed-jwt | anonymous | API | 401 | 401 | PASS |
| AUTH-04.basic-auth | anonymous | API | 401 | 401 | PASS |
| AUTH-04.empty-bearer | anonymous | API | 401 | 401 | PASS |
| AUTH-04.anon-key-as-bearer | anonymous | API | 401 | 401 | PASS |
| AUTH-04.tampered-sig | anonymous | API | 401 | 401 | PASS |
| AUTH-04.caps-api-vs-my_effective_access | 8 actors (admin, bandlead, legacy, librarian, ...) | API+D | equal (8 entries) | rpc 200 api 200 n=8 | PASS |
| AUTH-04.caps-ctxrpc-vs-my_effective_access | 8 actors (admin, bandlead, legacy, librarian, ...) | D | equal | ctx 200 n=8 | PASS |
| AUTH-04.ctxrpc-implicit-single | 8 actors (admin, bandlead, legacy, librarian, ...) | D | access populated for sole membership | n=8 | PASS |
| AUTH-04.ctxrpc-multi-no-select | multi | D | all access arrays empty | [0,0] | PASS |
| AUTH-04.ctxrpc-multi-selectB | multi | D | only B populated? | [["670a",0],["3326",0]] | PASS |
| AUTH-04.ctxrpc-nonmember-select | inactive, newcomer | D | no memberships | {"memberships":[],"disabled_organizations":[]} | PASS |
| AUTH-02.API-D4-retest.invalid-timezone | owner | API | 4xx | 422 tz=America/Chicago | PASS |
| AUTH-02.PATCH-organization-denied | bandlead, legacy, librarian, member | API | 403 | 403 name=QA acc A | PASS |

### ACL-01 grants, role changes, escalation

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-01.POST-plan-in-Sunday | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-01.GET-access-members | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-01.PUT-access-organization(same body) | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-01.PATCH-access-mode | 7 actors (bandlead, legacy, librarian, member, ...) | API | allow (2xx) | 200  | PASS |
| ACL-01.PATCH-access-mode | admin | API | allow (2xx) | 404 {"error":"That person is not in this organization","code":"not_found"} | FAIL |
| ACL-01.explain-other-user-denied | librarian, member | API | 403 | 403 | PASS |
| ACL-01.self-promote-to-owner | admin, legacy, member | API | denied; role unchanged | 403 role=admin | PASS |
| ACL-01.member-direct-insert-grant-PostgREST | member | D | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-01.admin-direct-insert-people-grant-PostgREST | admin | D | denied or inert (people grants inert) | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level | PASS |
| ACL-01.member-direct-role-update-PostgREST | member | D | denied; role unchanged | 200 role=member | PASS |
| ACL-01.legacy-direct-role-update-PostgREST | legacy | D | denied; role unchanged | 200 role=scheduler | PASS |
| ACL-01.admin-direct-promote-self-PostgREST | admin | D | denied; role unchanged | 200 role=admin | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-owner | admin | D | denied (owner-only membership changes) | 201 [{"id":"97933435-36f3-4151-aae8-cd9981b7dc8f","organization_ rows=1 | FAIL |
| ACL-01.newcomer-self-join-PostgREST | newcomer | D | denied | 409 rows=1 | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-admin | admin | D (PostgREST) | denied, no row | 201 row=admin/active | FAIL |
| ACL-01.direct-insert-organization_members.newcomer-as-member | admin | D (PostgREST) | denied, no row | 201 row=member/active | FAIL |
| ACL-01.direct-insert-organization_members.newcomer-as-member | bandlead, legacy, member, peoplegrant | D (PostgREST) | denied, no row | 403 row=none | PASS |
| ACL-01.direct-insert-organization_members.self-as-owner | newcomer | D (PostgREST) | denied, no row | 403 row=none | PASS |
| ACL-01.direct-insert-organization_members.self-as-member | newcomer | D (PostgREST) | denied, no row | 403 row=none | PASS |
| ACL-01.direct-insert-organization_members.newcomer-as-owner (positive control) | owner | D (PostgREST) | allowed (owner) | 201 row=owner/active | PASS |
| ACL-01.escalation-impact | newcomer | API | (impact) new owner has full access | access/me 200 admin=true; access/members 200 | PASS |
| ACL-01.admin-insert-existing-B-user-into-A | admin | D | denied | 201 row=member/active | FAIL |
| ACL-01.direct-update-organization_members.promote-member-to-admin | admin | D | denied; unchanged | 200 role=member status=active | PASS |
| ACL-01.direct-update-organization_members.promote-self-to-owner | admin | D | denied; unchanged | 200 role=admin status=active | PASS |
| ACL-01.direct-update-organization_members.demote-owner | admin | D | denied; unchanged | 200 role=owner status=active | PASS |
| ACL-01.direct-update-organization_members.deactivate-member | admin | D | denied; unchanged | 200 role=member status=active | PASS |
| ACL-01.direct-delete-organization_members.member | admin | D | denied; row persists | 200 rows=member/active | PASS |
| ACL-01.direct-update-organization | admin, bandlead, legacy, librarian, member, peoplegrant | D | denied; unchanged | 200 name=QA acc A | PASS |
| ACL-01.legacy-direct-insert-grant | legacy | D | denied | 403 | PASS |
| ACL-01.admin-direct-insert-grant | admin | D | allowed (admin may issue non-admin grants) | 403 | PASS |

### ACL-02 legacy/scoped/service-type scope

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-02.POST-plan-in-Midweek | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-02.POST-teams-orgwide | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-02.POST-teams-in-Sunday-type | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-02.PATCH-plan-Sunday-title | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-02.PATCH-plan-Midweek-title | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-02.POST-service-type | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-02.scoped-Midweek-items-PostgREST | scoped | D | no rows changed | 200 [] | PASS |
| ACL-02.legacy-to-scoped.drops-implicit | rev7 | API | 201 then 403 | 201 -> 200 -> 403; entries=0 | PASS |

### ACL-03 owner-only People (RLS/API)

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-03.POST-people | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-03.GET-people-private-detail | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-03.PATCH-person | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-03.direct-insert-people | 7 actors (admin, bandlead, legacy, librarian, ...) | D | denied; no row | 403 rows=0 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| ACL-03.direct-update-person | 7 actors (admin, bandlead, legacy, librarian, ...) | D | denied; unchanged | 403 {"code":"42501","details":null,"hint":"G now=QA Guest | PASS |
| ACL-03.direct-read-person-private-fields | 7 actors (admin, bandlead, legacy, librarian, ...) | D | non-owner sees no private contact fields (null/absent) | 200 [] | PASS |
| ACL-03.direct-delete-person | 7 actors (admin, bandlead, legacy, librarian, ...) | D | denied; row persists | 403 rows=1 | PASS |
| ACL-03.direct-insert-person_invitation | 7 actors (admin, bandlead, legacy, librarian, ...) | D | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-03.direct-insert-tag-table | 7 actors (admin, bandlead, legacy, librarian, ...) | D | denied or table absent | 404 | PASS |

### ACL-04 team roster / positions

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-04.POST-song | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-04.POST-roster-Band | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-04.POST-roster-Production | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-04.PATCH-team-Band | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-04.PATCH-team-Production | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 200  | PASS |
| ACL-04.POST-position-Band | 8 actors (admin, bandlead, legacy, librarian, ...) | API | allow (2xx) | 201  | PASS |
| ACL-04.bandlead.remove-membership-other-team | bandlead | API | 403/404, row persists | 404 remaining=1 | PASS |

### ACL-05 prepared assignment visibility

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-05.prepared-hidden-in-ICS-feed | member | P | feed 200 w/o prepared plan | 200 hasPlan=false events=0 | PASS |
| ACL-05.prepared-hidden-in-schedule-mine | member | API | no prepared assignment | 200 false | PASS |
| ACL-05.prepared-plan-detail-member | member | API | assignment/team roster excludes prepared | 200 contains-aid=false contains-personId=false | PASS |
| ACL-05.prepared-list-assignments | member | API | not exposed | 404 false | PASS |
| ACL-05.prepared-PostgREST-own-assignment | member | D | [] (hidden until release) | 200 [] | PASS |
| ACL-05.prepared-PostgREST-plan-assignments | member | D | [] | 200 [] | PASS |
| ACL-05.prepared-calendar | member | API | assignment not leaked | 200 false | PASS |
| ACL-05.prepared-notifications | member | API | none about prep | 200 false | PASS |
| ACL-05.prepared-GET-assignment-by-id | member | API | 404 | 404 | PASS |
| ACL-05.prepared-respond-before-release | member | API | 404/403; status unchanged | 404 status=unconfirmed | PASS |
| ACL-05.prepared-PostgREST-other-roles | inactive, librarian, member, peoplegrant | D | [] | 200 [] | PASS |
| ACL-05.prepared-visible-to-band-lead (managed scope) | bandlead | D | visible (scheduling.manage on Band) | 200 [{"id":"a87d4c37-ac40-4cff-9423-d51bc7d0e37d","visibility":" | PASS |
| ACL-05.prepared-visible-to-scoped (Sunday plan) | scoped | D | visible | 200 [{"id":"a87d4c37-ac40-4cff-9423-d51bc7d0e37d"}] | PASS |
| ACL-05.released-visible-in-ICS-feed | member | P | prepared plan now in feed | 200 hasPlan=true | PASS |
| ACL-05.released-PostgREST-visible | member | D | 1 row | [{"id":"a87d4c37-ac40-4cff-9423-d51bc7d0e37d","visibility":" | PASS |

### ACL-06 forged foreign IDs

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ACL-06.multi-orgA-ctx-orgB-plan | multi | API | 404 | 404 | PASS |
| ACL-06.multi-orgB-ctx-orgA-plan | multi | API | 404 | 404 | PASS |
| ACL-06.ctxrpc-betaowner-p_org-A | betaowner | D | no org A data | ["33264c74-1a77-428e-9231-8fc18599011f"] | PASS |
| ACL-06.effective_access-foreign-org | betaowner | D | empty | [] | PASS |
| ACL-06.owner.PATCH-team-orgB | owner | API | 404 | HTTP 404 | PASS |
| ACL-06.owner.GET-team-orgB | owner | API | 404 | HTTP 404 | PASS |
| ACL-06.owner.POST-position-orgB-team | owner | API | 4xx and no row | HTTP 403 rows=0 | PASS |
| ACL-06.owner.POST-member-orgB-team | owner | API | 4xx and no row | HTTP 400 | PASS |
| ACL-06.owner.POST-member-orgB-person | owner | API | 400 not in org | HTTP 400 | PASS |
| ACL-06.owner.POST-member-orgB-position | owner | API | 4xx | HTTP 400 {"error":"Referenced record does not exist","code":"bad_request","deta | PASS |
| ACL-06.owner.POST-team-orgB-service-type | owner | API | 4xx and no row | HTTP 400 rows=0 | PASS |
| ACL-06.owner.PATCH-position-via-wrong-team | owner | API | 404 | 404 | PASS |
| ACL-06.owner.DELETE-orgB-position | owner | API | 404 (or 204 no-op) and B position persists | 204 persists=1 | PASS |
| ACL-06.DELETE-orgB-team-PostgREST | owner | D | 0 rows; B persists | HTTP 200 [] | PASS |
| ACL-06.GET-orgA-team-PostgREST | betaowner | D | [] | [] | PASS |
| ACL-06.reorder-with-foreign-item-id | owner | API | 4xx; order unchanged | 400 {"error":"Send every item in the plan exactly once, in the new order","code":"ba | PASS |
| ACL-06.create-song-item-foreign-song | owner | API+persist | 4xx and no row | 400 {"error":"That song is not in this organization's library","code":"bad forgedrows=0 | PASS |
| ACL-06.create-item-foreign-leader-person | owner | API+persist | 4xx and no row | 400 {"error":"That person is not on this organization's roster","code":"ba forgedrows=0 | PASS |
| ACL-06.create-item-foreign-leader-position | owner | API+persist | 4xx and no row | 400 {"error":"That position is not available on this plan","code":"bad_req forgedrows=0 | PASS |
| ACL-06.PATCH-item-under-wrong-plan | owner | API | 404; unchanged | 404 title=ff base v2 | PASS |
| ACL-06.PATCH-orgB-item | owner | API | 404; unchanged | 404 title=B-item | PASS |
| ACL-06.DELETE-orgB-item | owner | API | 404 (or no-op) and B item persists | 404 persists=1 | PASS |
| ACL-06.POST-item-orgB-plan | owner | API | 404/403; no row | 404 rows=0 | PASS |
| ACL-06.reorder-orgB-plan | owner | API | 4xx | 404 | PASS |
| ACL-06.PATCH-item-to-foreign-song | owner | API | 4xx; unchanged | 400 type=item | PASS |
| ACL-06.owner-direct-PostgREST-insert-orgB-plan | owner | D | denied | 400 {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'org | PASS |
| ACL-06.owner-direct-PostgREST-insert-orgB-plan-orgB-org | owner | D | denied | 400 {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'org | PASS |
| ACL-06.upload-intent-on-plan-without-rights | bandlead, inactive, librarian, member, newcomer, peoplegrant | API | 4xx | 403 | PASS |
| ACL-06.download-after-file-deleted | member | API | 404 | 404 | PASS |
| ACL-06.api-key.revoke-foreign-org-credential | betaowner | API | 4xx; key still works | 404 200 | PASS |
| ACL-06.api-key.foreign-service-type-filter | apikey | API | empty / 4xx; no QB sentinel | 200 {"data":[],"next_cursor":null} | PASS |
| ACL-06.read-orgB-plan | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-plan-schedule | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-plan-assignments | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-plan-publication | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-plan-files | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-song | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-person | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-team | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-team-policies | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-file | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-assignment | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.read-orgB-plan-notes | 8 actors (admin, bandlead, legacy, librarian, ...) | API | 404/403, no B data | 404 | PASS |
| ACL-06.list-excludes-orgB-plans | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-songs | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-people | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-teams | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-service-types | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-search | member, owner, scoped | API | no B rows | 200 | PASS |
| ACL-06.list-excludes-orgB-files | member, owner, scoped | API | no B rows | 404 | PASS |
| ACL-06.PostgREST-read-orgB-plans | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-songs | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-people | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-teams | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-plan_items | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-assignments | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-attachments | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-read-orgB-service_types | legacy, member, owner | D | [] | 200 [] | PASS |
| ACL-06.PostgREST-write-orgB-plans | owner | D | 0 rows; unchanged | 200 [] now=QB plan SENTINEL-B | PASS |
| ACL-06.PostgREST-write-orgB-songs | owner | D | 0 rows; unchanged | 200 [] now=QB Song SENTINEL-B | PASS |
| ACL-06.PostgREST-write-orgB-teams | owner | D | 0 rows; unchanged | 200 [] now=QB Band | PASS |
| ACL-06.PostgREST-write-orgB-people | owner | D | 0 rows; unchanged | 403 {"code":"42501","details":null now=QB Guest | PASS |
| ACL-06.PostgREST-write-orgB-plan_items | owner | D | 0 rows; unchanged | 200 [] now=B-item | PASS |
| ACL-06.assign-foreign-team | owner | API+D | 4xx, no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-06.assign-foreign-person | owner | API+D | 4xx, no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-06.assign-foreign-position-own-team | owner | API+D | 4xx, no row | 400 {"error":"Some People, teams, positions or times do not belo | PASS |
| ACL-06.assign-position-of-other-team | owner | API+D | 4xx, no row | 400 {"error":"Some People, teams, positions or times do not belo | PASS |
| ACL-06.assign-foreign-time | owner | API+D | 4xx, no row | 400 {"error":"Conflict scope must name People, plans and times o | PASS |
| ACL-06.assign-onto-orgB-plan | owner | API+D | 4xx/404 | 404 | PASS |
| ACL-06.release-orgB-assignment-via-A-ctx | owner | API+D | 4xx; unchanged | 404 vis=released | PASS |
| ACL-06.release-orgB-assignment-in-A-plan | owner | API+D | 4xx; B assignment not released | 409 vis=released | PASS |
| ACL-06.PATCH-orgB-assignment | owner | API+D | 404; unchanged | 404 | PASS |
| ACL-06.DELETE-orgB-assignment | owner | API+D | 404/no-op; persists | 204 persists=1 | PASS |
| ACL-06.create-plan-foreign-service-type | owner | API+D | 4xx (API-D2 retest) | 400 | PASS |
| ACL-06.patch-plan-foreign-service-type | owner | API+D | 4xx; unchanged | 400 st=c42d80ef-a9f5-431d-a41c-3f14848e05c6 | PASS |
| ACL-06.create-plan-copy-from-orgB-plan | owner | API+D | 4xx; no copy of B items | 404 rows=0 | PASS |
| ACL-06.duplicate-orgB-plan | owner | API | 404 | 404 | PASS |
| ACL-06.link-orgB-file-to-A-plan | owner | API+D | 4xx | 404 | PASS |
| ACL-06.download-orgB-file | owner | API | 404 | 404 | PASS |
| ACL-06.patch-orgB-file | owner | API | 404 | 404 | PASS |
| ACL-06.PUT-access-orgB-service-type | owner | API+D | 4xx; no grant row | 404 grants=0 | PASS |
| ACL-06.PUT-access-orgB-team | owner | API+D | 4xx | 404 | PASS |
| ACL-06.grant-to-nonmember-user-id | owner | API+D | 4xx, no grant for non-member | 400 rows=0 | PASS |
| ACL-06.access-mode-nonmember | owner | API | 404 | 404 | PASS |
| ACL-06.patch-nonmember-role | owner | API | 404; no row | 404 rows=0 | PASS |
| ACL-06.explain-nonmember | owner | API | denied reason not_a_member; no B detail | 200 {"allowed":false,"capability":"plans.edit","role":null,"access_mode":null,"reasons":[],"denial":"not | PASS |
| ACL-06.admin-A-insert-member-into-orgB | admin | D | denied | 403 rows=0 | PASS |
| ACL-06.admin-grant-to-nonmember-direct | admin | D | denied (grantee not a member) | 403 {"code":"42501","details":null,"hint":null,"message":"new ro | PASS |
| ACL-06.release-orgB-prepared-assignment-in-A-plan | owner | API+D | 4xx; remains prepared | 409 {"error":"Prepared requests changed since the release review vis=prepared | PASS |
| ACL-06.release-orgB-prepared-assignment-via-B-plan-id-in-A-ctx | owner | API+D | 404; remains prepared | 404 vis=prepared | PASS |
| ACL-06.patch-orgB-assignment-visibility | owner | API+D | 404; prepared | 404 vis=prepared | PASS |
| ACL-06.release-preview-orgB-assignment | owner | API | 4xx or empty; no B detail | 409 {"error":"Prepared requests changed. Refresh the release review.","code":"assignment_release_stale"} | PASS |
| ACL-06.PostgREST-patch-orgB-assignment | owner | D | 0 rows; prepared | 200 vis=prepared | PASS |
| ACL-06.RPC.replace_scope_grants-orgB | owner | D (RPC) | denied/empty; no B data; no write | 403 {"code":"42501","details":null,"hint":null,"message":"Only an administrator can change acc | PASS |
| ACL-06.RPC.team_candidates-orgB-team | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Team not found"} | PASS |
| ACL-06.RPC.team_eligibility_status-orgB-team | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Team not found"} | PASS |
| ACL-06.RPC.create_plan_position-orgB-plan | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| ACL-06.RPC.create_plan_position-orgB-plan-A-team | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| ACL-06.RPC.create_plan_position-A-plan-orgB-team | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| ACL-06.RPC.delete_plan_position-orgB-position | owner | D (RPC) | denied/empty; no B data; no write | 500 {"code":"P0002","details":null,"hint":null,"message":"Position not found"} | PASS |
| ACL-06.API-D3-retest.arrangement-chart-orgB-id-in-orgA-ctx | multi | API | 404 (header honored) | 404 {"error":"Arrangement not found","code":"not_found"} | PASS |
| ACL-06.arrangement-chart-orgB-id | owner | API | 404 | 404 | PASS |
| ACL-06.API-D3-retest.arrangement-materials-orgB-id-in-orgA-ctx | multi | API | 404 (header honored) | 404 {"error":"Arrangement unavailable","code":"not_found"} | PASS |
| ACL-06.arrangement-materials-orgB-id | owner | API | 404 | 404 | PASS |
| ACL-06.PATCH-organization-orgB-by-A-owner | owner | API | 403 | 403 name=QA acc B | PASS |
| ACL-06.related-teams-foreign-team-id | owner | API+D | 4xx; no row | 400 rows=0 | PASS |
| ACL-06.tag-rules-orgB-team | owner | API+D | 404; no row | 404 rows=0 | PASS |

### TEAM-01 / TEAM-02

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| TEAM-01.owner.DELETE-team-with-replacement-request | owner | API+D | 204 and team gone (cascade) OR clean 409; not 500 | HTTP 204 gone=true reqs_before=1 "" | PASS |
| TEAM-01.owner.DELETE-team-orgB-id-in-orgA-ctx | owner | API | 404 (task) ; B team persists | HTTP 204 persists=true | FAIL |
| TEAM-01.owner.DELETE-team-orgB-id-in-orgA-ctx(no-leak) | owner | API | team persists, no existence leak | HTTP 204 persists=true | PASS |
| TEAM-01.owner.DELETE-team-nonexistent | owner | API | 404 | HTTP 204 | FAIL |
| TEAM-01.owner.DELETE-team-malformed-id | owner | API | 400 not 500 | HTTP 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| TEAM-01.owner.POST-member-position-from-other-team | owner | API | 4xx (API-D1 retest) | HTTP 400 | PASS |
| TEAM-01.owner.POST-team-dup-positions | owner | API | 400 | HTTP 422 | PASS |
| TEAM-01.owner.member-multiple-positions | owner | API | both 201 | 201,201 | PASS |
| TEAM-01.owner.member-duplicate | owner | API | 409 | 409 | PASS |
| TEAM-01.owner.remove-by-membership-id | owner | API | 204 and only that row removed | 204 remaining=1 | PASS |
| TEAM-01.owner.remove-membership-twice | owner | API | 404 | 404 | PASS |
| TEAM-01.owner.position-reorder | owner | API | 200 sort_order=5 | 200 5 | PASS |
| TEAM-01.owner.position-rename-duplicate | owner | API | 409 not 500 | 409 | PASS |
| TEAM-01.DELETE-team-PostgREST | bandlead, legacy, librarian, member, peoplegrant, scoped | D | 0 rows deleted, team persists | HTTP 200 body=[] persists=true | PASS |
| TEAM-02.PUT-tag-rules.Band | 7 actors (admin, bandlead, legacy, librarian, ...) | API+D | allowed, row written | 200 rows=1 | PASS |
| TEAM-02.PUT-related-teams.Band | 7 actors (admin, bandlead, legacy, librarian, ...) | API+D | allowed | 200 rows=1 | PASS |
| TEAM-02.PUT-tag-rules.Production | bandlead | API+D | denied, no row | 403 rows=0 | PASS |
| TEAM-02.PUT-related-teams.Production | bandlead | API+D | denied | 403 rows=0 | PASS |
| TEAM-02.GET-team-access(requireAdmin) | admin, bandlead, legacy, member, owner | API | 200 | 200 | PASS |
| TEAM-01.DELETE-team | 9 actors (admin, legacy, librarian, member, ...) | API+D | (oracle) owner/admin/teams.manage@org or @type; legacy per RLS; scoped/leader/member denie | 204, team + positions + memberships + assignment rows cascaded away | PASS |
| TEAM-01.DELETE-team | bandlead | API+D | (oracle) owner/admin/teams.manage@org or @type; legacy per RLS; scoped/leader/member denie | 204 but nothing deleted (RLS no-op) [finding W7-ACC-D3/D4] | FAIL |

### ORDER-01 free-form items

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ORDER-01.create-free-item.Sunday | 8 actors (admin, bandlead, legacy, librarian, ...) | API+persist | 201, item row, revision+1 | 201 rev 0->1  | PASS |
| ORDER-01.edit-free-item.Sunday | admin, legacy, owner, scoped | API+persist | 200, row updated | 200 ff edited owner/120/ | PASS |
| ORDER-01.delete-free-item.Sunday | admin, legacy, owner, scoped | API+persist | 204 row gone | 204 rows=0 | PASS |
| ORDER-01.create-free-item.Midweek | 8 actors (admin, bandlead, legacy, librarian, ...) | API+persist | 201, item row, revision+1 | 201 rev 0->1  | PASS |
| ORDER-01.edit-free-item.Midweek | admin, legacy, owner | API+persist | 200, row updated | 200 ff edited owner/120/ | PASS |
| ORDER-01.delete-free-item.Midweek | admin, legacy, owner | API+persist | 204 row gone | 204 rows=0 | PASS |
| ORDER-01.denied-edit/delete/reorder | bandlead, librarian, member, peoplegrant | API+persist | all 4xx; unchanged | 403/403/403 title=ff base | PASS |
| ORDER-01.denied-edit/delete | bandlead, librarian, member, peoplegrant | D (PostgREST) | 0 rows changed | 200 [] / 200 [] title=ff base | PASS |
| ORDER-01.denied-insert | bandlead, librarian, member, peoplegrant | D (PostgREST) | denied | 400 {"code":"PGRST204","details":null,"hint":null,"message":"Cou | PASS |
| ORDER-01.edit-with-current-revision | owner | API | 200, revision bumped | 200 14->15 | PASS |
| ORDER-01.edit-stale-revision | owner | API | 409 plan_revision_stale | 409 plan_revision_stale | PASS |
| ORDER-01.stale-edit-no-write | owner | D | title unchanged | ff base v2 | PASS |
| ORDER-01.delete-stale-revision | owner | API | 409, row persists | 409 persists=1 | PASS |
| ORDER-01.reorder-stale-revision | owner | API | 409 | 409 plan_revision_stale | PASS |
| ORDER-01.reorder-valid | owner | API+persist | 200 order reversed, revision bump | 200 match=true rev 15->17 | PASS |
| ORDER-01.reorder-partial-list | owner | API | 4xx (incomplete list) or documented | 400 {"error":"Send every item in the plan exactly once, in the new order","code":"ba | PASS |
| ORDER-01.reorder-duplicate-ids | owner | API | 4xx | 400 | PASS |
| ORDER-01.create-item-both-leaders | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-item-with-arrangement | owner | API+persist | 4xx and no row | 400 {"error":"Only a song item can have an arrangement or sequence","code" forgedrows=0 | PASS |
| ORDER-01.create-free-item-no-title | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-blank-title | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-title-201chars | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-negative-length | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-length-over | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-bad-segment | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-description-4001 | owner | API+persist | 4xx and no row | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa forgedrows=0 | PASS |
| ORDER-01.create-free-item-title-200chars | owner | API | 201 | 201  | PASS |
| ORDER-01.create-free-item-length-36000 | owner | API | 201 | 201  | PASS |
| ORDER-01.create-free-item-description-4000 | owner | API | 201 | 201  | PASS |
| ORDER-01.create-free-item-leader-person | owner | API | 201 | 201  | PASS |
| ORDER-01.create-free-item-leader-position | owner | API | 201 | 201  | PASS |
| ORDER-01.create-free-item-segments | owner | API | 201 | 201  | PASS |
| ORDER-01.create-header | owner | API | 201 | 201  | PASS |
| ORDER-01.create-idempotent-replay | owner | API+persist | 201 then 200 same id; reuse w/ other body 409 | 201/200/409 same=true rows=1 | PASS |
| ORDER-01.edit-type-item-to-header | owner | API | 200 | 200 | PASS |
| ORDER-01.owner-direct-PostgREST-insert | owner | D | (info) allowed or denied | 400 {"code":"PGRST204","details":null,"hint":null,"message":"Could not find the 'org | PASS |

### PEOPLE-05 (membership actions, admin)

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE-05.admin.PATCH-member-status | admin | API+D | oracle: admin denied membership changes; route requireAdmin | 403 {"error":"Only the organization owner can access personal details or m status=active | PASS |
| PEOPLE-05.admin.DELETE-member | admin | API+D | denied; row persists | 403 rows=1 | PASS |

### SEC-01 hostile strings / uploads

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-01.upload-intent-mime-html | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-mime-svg | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-mime-exe | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-mime-js | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-mime-empty | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-size-zero | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-size-negative | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-size-over-25MB | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-size-float | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-size-string | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-filename-empty | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-filename-201 | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intent-owner-orgB-plan | owner | API | 4xx | 404 {"error":"That parent was not found","code":"not_found"} | PASS |
| SEC-01.upload-intent-owner-orgB-song | owner | API | 4xx | 404 {"error":"That parent was not found","code":"not_found"} | PASS |
| SEC-01.upload-intent-team-audience-orgB-team | owner | API | 4xx | 404 {"error":"Team not found","code":"not_found"} | PASS |
| SEC-01.upload-intent-position-audience-orgB-pos | owner | API | 4xx | 404 {"error":"Position not found","code":"not_found"} | PASS |
| SEC-01.upload-intent-file_id-orgB-file | owner | API | 4xx | 404 {"error":"File not found","code":"not_found"} | PASS |
| SEC-01.upload-intent-missing-owner | owner | API | 4xx | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"pa | PASS |
| SEC-01.upload-intents-no-rows-created | owner | D | attachment row count unchanged | 3 -> 3 | PASS |
| SEC-01.upload-hostile-filename-title | owner | API | 201, filename stored verbatim or rejected; storage path not derived from filename | 201 path=670a0f16-c206-4c61-b509-e5357e0f7ae5/57f85e44-0952-4d02-8dc0-d4f67c80d12f/837a3e5e-405c-4457-b172-b00776fd40d4/img-src-x-onerror-alert-1-..-. | PASS |
| SEC-01.upload-hostile-filename-persisted | owner | D | verbatim | <img src=x onerror=alert(1)>../../etc/passwd"';--.pdf | PASS |
| SEC-01.upload-signed-url-wrong-content-type | owner | S | 4xx (bucket mime allowlist) | 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type text/html i | PASS |
| SEC-01.upload-bytes-larger-than-declared | owner | API+S | finalize fails / not ready | put 200; finalize 200 failed size_mismatch | PASS |
| SEC-01.upload-mismatch-object-cleanup | owner | S+D | mismatched object removed/queued | objects=1 status=failed removals=1 | PASS |
| SEC-01.upload-html-bytes-as-pdf | owner | S+API | (info) magic-byte sniffing? finalize outcome | put 200; finalize 200 ready null | PASS |
| SEC-01.download-inline-content-type | owner | S | served as application/pdf; nosniff/CSP? | 200 ct=application/pdf cto=null csp= | PASS |
| SEC-01.file-link-javascript | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-data | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-file | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-ftp | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-creds | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-vbscript | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-too-long | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-empty | owner | API | 400 | 422 (validation 422) | PASS |
| SEC-01.file-link-hostile-title-and-query | owner | API+D | stored verbatim | 201 <b>x</b>"><script> | PASS |
| SEC-01.logo-svg-with-script-upload | admin | S | (info) SVG allowed by bucket | 200 | PASS |
| SEC-01.logo-svg-served-headers | anonymous | S | CSP sandbox / attachment so script cannot run | 200 ct=image/svg+xml csp=null cto=null | FAIL |
| SEC-01.team-name+position.script | owner | API+D | 201 verbatim (trimmed) | 201 name=T <script>alert(1)</script> | PASS |
| SEC-01.team-roundtrip-json.script | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.script | owner | API+D | verbatim | 201 <script>alert(1)</script> | PASS |
| SEC-01.free-item-title+description.script | owner | API+D | verbatim | 201 <script>alert(1)</script>/D <script>alert(1)</scri | PASS |
| SEC-01.guest-name.script | owner | API+D | verbatim | 201 <script>alert(1)</script> | PASS |
| SEC-01.plan-title+notes.script | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.img | owner | API+D | 201 verbatim (trimmed) | 201 name=T "><img src=x onerror=alert(1)> | PASS |
| SEC-01.team-roundtrip-json.img | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.img | owner | API+D | verbatim | 201 "><img src=x onerror=alert(1)> | PASS |
| SEC-01.free-item-title+description.img | owner | API+D | verbatim | 201 "><img src=x onerror=alert(1)>/D "><img src=x oner | PASS |
| SEC-01.guest-name.img | owner | API+D | verbatim | 201 "><img src=x onerror=alert(1)> | PASS |
| SEC-01.plan-title+notes.img | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.sqli | owner | API+D | 201 verbatim (trimmed) | 201 name=T x'); drop table teams;-- | PASS |
| SEC-01.team-roundtrip-json.sqli | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.sqli | owner | API+D | verbatim | 201 x'); drop table teams;-- | PASS |
| SEC-01.free-item-title+description.sqli | owner | API+D | verbatim | 201 x'); drop table teams;--/D x'); drop table teams;- | PASS |
| SEC-01.guest-name.sqli | owner | API+D | verbatim | 201 x'); drop table teams;-- | PASS |
| SEC-01.plan-title+notes.sqli | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.tmpl | owner | API+D | 201 verbatim (trimmed) | 201 name=T ${7*7}{{7*7}}%s%n | PASS |
| SEC-01.team-roundtrip-json.tmpl | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.tmpl | owner | API+D | verbatim | 201 ${7*7}{{7*7}}%s%n | PASS |
| SEC-01.free-item-title+description.tmpl | owner | API+D | verbatim | 201 ${7*7}{{7*7}}%s%n/D ${7*7}{{7*7}}%s%n | PASS |
| SEC-01.guest-name.tmpl | owner | API+D | verbatim | 201 ${7*7}{{7*7}}%s%n | PASS |
| SEC-01.plan-title+notes.tmpl | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.formula | owner | API+D | 201 verbatim (trimmed) | 201 name=T =cmd/' /C calc'!A0 | PASS |
| SEC-01.team-roundtrip-json.formula | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.formula | owner | API+D | verbatim | 201 =cmd/' /C calc'!A0 | PASS |
| SEC-01.free-item-title+description.formula | owner | API+D | verbatim | 201 =cmd/' /C calc'!A0/D =cmd/' /C calc'!A0 | PASS |
| SEC-01.guest-name.formula | owner | API+D | verbatim | 201 =cmd/' /C calc'!A0 | PASS |
| SEC-01.plan-title+notes.formula | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.at_formula | owner | API+D | 201 verbatim (trimmed) | 201 name=T @SUM(1+1) | PASS |
| SEC-01.team-roundtrip-json.at_formula | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.at_formula | owner | API+D | verbatim | 201 @SUM(1+1) | PASS |
| SEC-01.free-item-title+description.at_formula | owner | API+D | verbatim | 201 @SUM(1+1)/D @SUM(1+1) | PASS |
| SEC-01.guest-name.at_formula | owner | API+D | verbatim | 201 @SUM(1+1) | PASS |
| SEC-01.plan-title+notes.at_formula | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.nul | owner | API | 4xx validation (NUL not storable) not 500 | 500 {"error":"unsupported Unicode escape sequence","code":"22P05"} | FAIL |
| SEC-01.song-title.nul | owner | API | 4xx not 500 | 500 | FAIL |
| SEC-01.free-item.nul | owner | API | 4xx not 500 | 500 | FAIL |
| SEC-01.person-name.nul | owner | API | 4xx not 500 | 500 | FAIL |
| SEC-01.plan-title.nul | owner | API | 4xx not 500 | 500 | FAIL |
| SEC-01.team-name+position.rtl | owner | API+D | 201 verbatim (trimmed) | 201 name=T abc‮def | PASS |
| SEC-01.team-roundtrip-json.rtl | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.rtl | owner | API+D | verbatim | 201 abc‮def | PASS |
| SEC-01.free-item-title+description.rtl | owner | API+D | verbatim | 201 abc‮def/D abc‮def | PASS |
| SEC-01.guest-name.rtl | owner | API+D | verbatim | 201 abc‮def | PASS |
| SEC-01.plan-title+notes.rtl | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.zwj | owner | API+D | 201 verbatim (trimmed) | 201 name=T a‍b | PASS |
| SEC-01.team-roundtrip-json.zwj | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.zwj | owner | API+D | verbatim | 201 a‍b | PASS |
| SEC-01.free-item-title+description.zwj | owner | API+D | verbatim | 201 a‍b/D a‍b | PASS |
| SEC-01.guest-name.zwj | owner | API+D | verbatim | 201 a‍b | PASS |
| SEC-01.plan-title+notes.zwj | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.emoji | owner | API+D | 201 verbatim (trimmed) | 201 name=T 🎺🎹 Band | PASS |
| SEC-01.team-roundtrip-json.emoji | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.emoji | owner | API+D | verbatim | 201 🎺🎹 Band | PASS |
| SEC-01.free-item-title+description.emoji | owner | API+D | verbatim | 201 🎺🎹 Band/D 🎺🎹 Band | PASS |
| SEC-01.guest-name.emoji | owner | API+D | verbatim | 201 🎺🎹 Band | PASS |
| SEC-01.plan-title+notes.emoji | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.vi_nfc | owner | API+D | 201 verbatim (trimmed) | 201 name=T Nguyễn Thị Ánh | PASS |
| SEC-01.team-roundtrip-json.vi_nfc | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.vi_nfc | owner | API+D | verbatim | 201 Nguyễn Thị Ánh | PASS |
| SEC-01.free-item-title+description.vi_nfc | owner | API+D | verbatim | 201 Nguyễn Thị Ánh/D Nguyễn Thị Ánh | PASS |
| SEC-01.guest-name.vi_nfc | owner | API+D | verbatim | 201 Nguyễn Thị Ánh | PASS |
| SEC-01.plan-title+notes.vi_nfc | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.vi_nfd | owner | API+D | 201 verbatim (trimmed) | 201 name=T Nguyễn Thị Ánh | PASS |
| SEC-01.team-roundtrip-json.vi_nfd | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.vi_nfd | owner | API+D | verbatim | 201 Nguyễn Thị Ánh | PASS |
| SEC-01.free-item-title+description.vi_nfd | owner | API+D | verbatim | 201 Nguyễn Thị Ánh/D Nguyễn Thị Ánh | PASS |
| SEC-01.guest-name.vi_nfd | owner | API+D | verbatim | 201 Nguyễn Thị Ánh | PASS |
| SEC-01.plan-title+notes.vi_nfd | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.nl | owner | API+D | 201 verbatim (trimmed) | 201 name=T line1 line2 | PASS |
| SEC-01.team-roundtrip-json.nl | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.nl | owner | API+D | verbatim | 201 line1 line2 | PASS |
| SEC-01.free-item-title+description.nl | owner | API+D | verbatim | 201 line1 line2/D line1 line2 | PASS |
| SEC-01.guest-name.nl | owner | API+D | verbatim | 201 line1 line2 | PASS |
| SEC-01.plan-title+notes.nl | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.unicode_big | owner | API+D | 201 verbatim (trimmed) | 201 name=T 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 | PASS |
| SEC-01.team-roundtrip-json.unicode_big | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.unicode_big | owner | API+D | verbatim | 201 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 | PASS |
| SEC-01.free-item-title+description.unicode_big | owner | API+D | verbatim | 201 𝔘𝔫𝔦𝔠𝔬𝔡𝔢/D 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 | PASS |
| SEC-01.guest-name.unicode_big | owner | API+D | verbatim | 201 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 | PASS |
| SEC-01.plan-title+notes.unicode_big | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.ws | owner | API+D | 201 verbatim (trimmed) | 201 name=T   padded | PASS |
| SEC-01.team-roundtrip-json.ws | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.ws | owner | API+D | verbatim | 201 padded | PASS |
| SEC-01.free-item-title+description.ws | owner | API+D | verbatim | 201 padded/D   padded | PASS |
| SEC-01.guest-name.ws | owner | API+D | verbatim | 201 padded | PASS |
| SEC-01.plan-title+notes.ws | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.json | owner | API+D | 201 verbatim (trimmed) | 201 name=T {"a":1} | PASS |
| SEC-01.team-roundtrip-json.json | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.json | owner | API+D | verbatim | 201 {"a":1} | PASS |
| SEC-01.free-item-title+description.json | owner | API+D | verbatim | 201 {"a":1}/D {"a":1} | PASS |
| SEC-01.guest-name.json | owner | API+D | verbatim | 201 {"a":1} | PASS |
| SEC-01.plan-title+notes.json | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.path | owner | API+D | 201 verbatim (trimmed) | 201 name=T ../../etc/passwd | PASS |
| SEC-01.team-roundtrip-json.path | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.path | owner | API+D | verbatim | 201 ../../etc/passwd | PASS |
| SEC-01.free-item-title+description.path | owner | API+D | verbatim | 201 ../../etc/passwd/D ../../etc/passwd | PASS |
| SEC-01.guest-name.path | owner | API+D | verbatim | 201 ../../etc/passwd | PASS |
| SEC-01.plan-title+notes.path | owner | API | 201 | 201 | PASS |
| SEC-01.team-name+position.crlf | owner | API+D | 201 verbatim (trimmed) | 201 name=T x
 Set-Cookie: a=b | PASS |
| SEC-01.team-roundtrip-json.crlf | owner | API | GET returns verbatim, JSON content-type | 200 ct=application/json; charset=utf-8 | PASS |
| SEC-01.song-title.crlf | owner | API+D | verbatim | 201 x
 Set-Cookie: a=b | PASS |
| SEC-01.free-item-title+description.crlf | owner | API+D | verbatim | 201 x
 Set-Cookie: a=b/D x
 Set-Cookie: a=b | PASS |
| SEC-01.guest-name.crlf | owner | API+D | verbatim | 201 x
 Set-Cookie: a=b | PASS |
| SEC-01.plan-title+notes.crlf | owner | API | 201 | 201 | PASS |
| SEC-01.song-search-hostile-query | owner | API | 200/400 not 500 | 200 q="' or '1'='1" | PASS |
| SEC-01.people-search-hostile-query | owner | API | 200/400 not 500 | 200 | PASS |
| SEC-01.global-search-hostile-query | owner | API | 200/400 not 500 | 200 | PASS |
| SEC-01.song-search-hostile-query | owner | API | 200/400 not 500 | 500 q="x\u0000y" | FAIL |
| SEC-01.path-param-hostile | owner | API | 400/404 not 500 | 400 ' | PASS |
| SEC-01.malformed-json | owner | API | 400 not 500 | 500 | FAIL |
| SEC-01.oversize-body-2MB | owner | API | 413/400 not 500 | 500 | FAIL |
| SEC-01.large-name-200k | owner | API | 400/422 (max 120) | 500 | FAIL |
| SEC-01.wrong-content-type | owner | API | 4xx no create | 422 rows=0 | PASS |

### SEC-02 tenant, tokens, storage, CORS, revocation

| Case ID | Actor(s) | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-02.forged-sub-jwt | anonymous | API | 401 | 401 | PASS |
| SEC-02.alg-none-jwt | anonymous | API | 401 | 401 | PASS |
| SEC-02.ctxrpc-anon | anonymous | D | 401/403/404 denied | 401 | PASS |
| SEC-02.revoke-deactivate.before | rev1 | API | 200 | 200 | PASS |
| SEC-02.revoke-deactivate.next-request | rev1 | API | 403 immediately (same token) | 403 then 403 | PASS |
| SEC-02.revoke-deactivate.PostgREST | rev1 | D | [] rows | 200 [] | PASS |
| SEC-02.revoke-grant.before | rev2 | API | 201 | 201 | PASS |
| SEC-02.revoke-grant.next-request | rev2 | API | 403 immediately | 403 | PASS |
| SEC-02.revoke-grant.access-me | rev2 | API | entries empty | [] | PASS |
| SEC-02.revoke-delete-auth-user | rev3 | API | 401 next request | admin-delete 200; 401 | PASS |
| SEC-02.revoke-delete-auth-user.PostgREST-with-old-JWT | rev3 | D | (info) JWT still valid until exp at PostgREST layer | 200 [] | PASS |
| SEC-02.signout.before | rev4 | API | 200 | 200 | PASS |
| SEC-02.signout.next-request-same-access-token | rev4 | API | 401 immediately | logout 204; 401 | PASS |
| SEC-02.signout.refresh-token-rejected | rev4 | Auth | 4xx | 400 | PASS |
| SEC-02.signout.PostgREST-with-old-access-token | rev4 | D | (info) direct PostgREST accepts JWT until expiry? | 200 [{"id":"75b1365f-bcdc-4e52-8a3a-bd419e8beea1"},{"id":"9df46a | PASS |
| SEC-02.banned-user-next-request | rev5 | API | 401 account blocked | ban 200; 401 unauthorized | PASS |
| SEC-02.banned-user-signin | rev5 | Auth | 4xx | 400 | PASS |
| SEC-02.role-demote.next-request | rev6 | API | 200 then 403 | 200 -> patch 200 -> 403 | PASS |
| SEC-02.membership-deleted.next-request | rev8 | API | 403 | del 204; 403 | PASS |
| SEC-02.membership-deleted.row-gone | rev8 | D | 0 rows | 0 | PASS |
| SEC-02.storage.B-owner-reads-own-object | betaowner | S | 200 | 200 | PASS |
| SEC-02.storage.A-owner-reads-own-object | owner | S | 200 | 200 | PASS |
| SEC-02.storage.A-member-reads-org-audience-object | member | S | 200 | 200 | PASS |
| SEC-02.storage.A-member-denied-leaders-object | member | S | 4xx | 400 | PASS |
| SEC-02.storage.A-legacy-leaders-object | legacy | S | (info) leader audience | 200 | PASS |
| SEC-02.storage.read-orgB-org-audience-object | 10 actors (admin, bandlead, inactive, legacy, ...) | S | 4xx (denied) | 400 {"statusCode":"404","error":"not_found","message": | PASS |
| SEC-02.storage.read-orgB-leaders-audience-object | 10 actors (admin, bandlead, inactive, legacy, ...) | S | 4xx (denied) | 400 {"statusCode":"404","error":"not_found","message": | PASS |
| SEC-02.storage.read-orgB-object-anon-key | anonymous | S | 4xx | 400 | PASS |
| SEC-02.storage.public-url-private-bucket | anonymous | S | 4xx | 400 | PASS |
| SEC-02.storage.object-endpoint-orgB | owner | S | 4xx | 400 | PASS |
| SEC-02.storage.object-info-orgB | owner | S | 4xx | 400 | PASS |
| SEC-02.storage.path-traversal | owner | S | 4xx | 400 | PASS |
| SEC-02.storage.list-orgB-prefix | member, multi, owner | S | [] (no objects visible) | 200 [] | PASS |
| SEC-02.storage.list-root | owner | S | only own org prefixes | 200 [{"name":"670a0f16-c206-4c61-b509-e5357e0f7ae5","version":null,"id":null,"updated_at":null,"created_ | PASS |
| SEC-02.storage.sign-orgB-object | owner | S | 4xx | 400 {"statusCode":"404","error":"not_found","message":"Object no | PASS |
| SEC-02.storage.delete-orgB-object | owner | S+D | denied; object persists | 400 {"statusCode":"403","error":"Unauthorized","messag persists=1 | PASS |
| SEC-02.storage.delete-own-finalized-object-direct | owner | S+D | denied (writes only via API) ; object persists | 400 {"statusCode":"403","error":"Unauthorized","messag persists=1 | PASS |
| SEC-02.storage.upload-without-intent | member, owner | S+D | denied | 400 {"statusCode":"403","error":"Unauthorized","message":"new ro | PASS |
| SEC-02.storage.overwrite-without-intent | member, owner | S+D | denied | 400 | PASS |
| SEC-02.storage.orgB-object-bytes-unchanged | betaowner | S | still original size | 45 | PASS |
| SEC-02.storage.write-orgB-prefix-songbooks | member, owner | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.storage.list-orgB-prefix-songbooks | owner | S | no objects | 200 [] | PASS |
| SEC-02.storage.write-orgB-prefix-chord-sheets | member, owner | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.storage.list-orgB-prefix-chord-sheets | owner | S | no objects | 200 [] | PASS |
| SEC-02.storage.write-orgB-prefix-report-exports | member, owner | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.storage.list-orgB-prefix-report-exports | owner | S | no objects | 200 [] | PASS |
| SEC-02.storage.write-orgB-prefix-avatars | member, owner | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.storage.list-orgB-prefix-avatars | owner | S | no objects | 200 [] | PASS |
| SEC-02.storage.write-orgB-prefix-organization-logos | member, owner | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.storage.list-orgB-prefix-organization-logos | owner | S | no objects | 200 [] | PASS |
| SEC-02.storage.logo-upload-own-org-member | member | S | denied | 400 | PASS |
| SEC-02.storage.logo-upload-own-org-legacy | legacy | S | denied | 400 | PASS |
| SEC-02.storage.songbooks-write-own-org-songs.manage | librarian | S | allowed (songs.manage) | 200 | PASS |
| SEC-02.storage.songbooks-write-own-org-member | member | S | denied | 400 | PASS |
| SEC-02.signed-url.issue | rev10 | API | 200 url | 200 | PASS |
| SEC-02.signed-url.fetch-before-revoke | rev10 | S | 200 | 200 | PASS |
| SEC-02.signed-url.fetch-without-session | anonymous | S | (info) capability URL works without any session | 200 | PASS |
| SEC-02.signed-url.ttl | owner | S | <= 300s (FILE_DOWNLOAD_TTL_SECONDS) | ttl=300s; expires_at=2026-11-20T22:14:31.483Z | PASS |
| SEC-02.signed-url.new-issue-after-revoke | rev10 | API | 403 | 403 | PASS |
| SEC-02.signed-url.reuse-after-membership-revoked | rev10 | S | ideally denied; capability URL valid until TTL(300s) | 200 at +14ms | FAIL |
| SEC-02.storage.direct-jwt-after-membership-revoked | rev10 | S | 4xx | 400 | PASS |
| SEC-02.signed-url.reuse-after-file-deleted | owner/member | S | ideally 404; URL valid till TTL | rev=2 delete 204; objects=1; url 200 | FAIL |
| SEC-02.logo-write-other-org-prefix | admin | S | denied | 400 {"statusCode":"403","error":"Unauthorized","messag | PASS |
| SEC-02.feed.create-token | member | API | 201 url | 201 | PASS |
| SEC-02.feed.no-foreign-org-content | member | P | no SENTINEL-B | false | PASS |
| SEC-02.feed.headers | member | P | Cache-Control private/no-store | cc=private, max-age=3600 ct=text/calendar; charset=utf-8 | PASS |
| SEC-02.feed.invalid-token-garbage | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.invalid-token-empty-ish | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.invalid-token-sql | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.invalid-token-long | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.invalid-token-scoped-garbage | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.invalid-token-hash-of-token | anonymous | P | 404 (no 500, no leak) | 404 | PASS |
| SEC-02.feed.rotate-old-token-revoked | member | P | old 404 new 200 | 404/200 | PASS |
| SEC-02.feed.get-status-no-secret | member | API | no url/token | {"url":null,"webcal_url":null,"active":true} | PASS |
| SEC-02.feed.inactive-member-feed | member | P | 404 immediately | 404 | PASS |
| SEC-02.response-token-invalid-garbage | anonymous | P | 4xx (404/410/400), no 500 | 404/404 | PASS |
| SEC-02.response-token-invalid-long | anonymous | P | 4xx (404/410/400), no 500 | 404/404 | PASS |
| SEC-02.response-token-invalid-sql | anonymous | P | 4xx (404/410/400), no 500 | 404/404 | PASS |
| SEC-02.response-token-invalid-uuid | anonymous | P | 4xx (404/410/400), no 500 | 404/404 | PASS |
| SEC-02.invitation-token-invalid-garbage | anonymous | P | 4xx no 500 | 404/404 | PASS |
| SEC-02.invitation-token-invalid-long | anonymous | P | 4xx no 500 | 404/404 | PASS |
| SEC-02.invitation-token-invalid-uuid | anonymous | P | 4xx no 500 | 404/404 | PASS |
| SEC-02.public.unknown-slug | anonymous | P | 404 no 500 | 404/404 | PASS |
| SEC-02.public.publish-denied-roles | bandlead, librarian, member, peoplegrant | API | 403 | 403 | PASS |
| SEC-02.public.publish-scoped-other-type | scoped | API | denied | 403 | PASS |
| SEC-02.public.plan-projection-fields | anonymous | P | only allowlisted fields (title,date); no ids/org/people/notes | 200 {"organization":"QA acc A","timezone":"America/Chicago","title":"QA prepared plan","date":"2027-08-01"} | PASS |
| SEC-02.public.revoked-slug-404 | anonymous | P | 404 after revoke | revoke 200 {"publication":{"id":"5c833dac-64ae-4b14-ba76-c41c576f4daf",; 404 | PASS |
| SEC-02.api-key.create | 7 actors (admin, bandlead, legacy, librarian, ...) | API | owner/admin only | 201 | PASS |
| SEC-02.api-key.org | apikey | API | 200 | 200 | PASS |
| SEC-02.api-key.plans-scope | apikey | API | 200 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"f | PASS |
| SEC-02.api-key.songs-without-scope | apikey | API | 403 | 403 | PASS |
| SEC-02.api-key.foreign-org-plan-id | apikey | API | 404 | 404 | PASS |
| SEC-02.api-key.own-plan-draft | apikey | API | published-only projection (draft = 404) | 404 | PASS |
| SEC-02.api-key.limit-abuse | apikey | API | 400 or capped, no 500 | 422 | PASS |
| SEC-02.api-key.malformed-id | apikey | API | 400/404 no 500 | 400 | PASS |
| SEC-02.api-key.session-jwt-rejected | owner | API | 401 | 401 | PASS |
| SEC-02.api-key.no-header | anonymous | API | 401 | 401 | PASS |
| SEC-02.api-key.unknown-key | anonymous | API | 401 | 401 | PASS |
| SEC-02.api-key.tampered-secret | anonymous | API | 401 | 401 | PASS |
| SEC-02.api-key.on-first-party-route | apikey | API | 401 | 401 | PASS |
| SEC-02.api-key.no-store | apikey | API | Cache-Control no-store | no-store | PASS |
| SEC-02.api-key.list-no-secret | owner | API | no secret/hash in list | false hash=false | PASS |
| SEC-02.api-key.list-denied | legacy, member | API | 403 | 403 | PASS |
| SEC-02.api-key.revoke-denied | legacy, member | API | 403 and key still works | 403 200 | PASS |
| SEC-02.api-key.expiry | apikey | API | 200 then 401 api_key_inactive | 200 -> 401 {"error":"This API key is revoked, expired or no longer vali | PASS |
| SEC-02.api-key.create-past-expiry | owner | API | 400/422 | 400 | PASS |
| SEC-02.api-key.revoke-next-request | apikey | API | 401 | revoke 200; 401 {"error":"This API key is revoked, expired or no longer vali | PASS |
| SEC-02.api-key.issuer-demoted | apikey | API | 200 then 401 inactive | 201: 200 -> 401 | PASS |
| SEC-02.api-key.per-key-rate-limit(3/min) | apikey | API | 200,200,200,429,429 | 200,200,200,429,429 | PASS |
| SEC-02.api-key.service-types-own-org-only | apikey | API | no QB Sunday | 200 false | PASS |
| SEC-02.cors-preflight-disallowed-origin | anonymous | API | no ACAO header (browser blocks); status not 2xx-with-ACAO | http://evil.example -> 500 acao=null {"error":"Origin http://evil.example is not allowe | PASS |
| SEC-02.cors-preflight-allowed-origin | anonymous | API | ACAO = origin, credentials true | 204 acao=http://localhost:5173 acac=true | PASS |
| SEC-02.cors-disallowed-status-code | anonymous | API | 4xx (not 5xx stack) | 500 {"error":"Origin http://evil.example is not allowed","code":"internal_error"} | FAIL |
| SEC-02.cors-simple-GET-evil-origin-with-token | owner | API | no ACAO header | 500 acao=null | PASS |
| SEC-02.cors-GET-allowed-origin | owner | API | ACAO set; vary: Origin | 200 acao=http://localhost:5173 vary=Origin, Accept-Encoding | PASS |
| SEC-02.cors-public-endpoint-evil-origin | anonymous | API | no ACAO for evil origin | /api/v1/public/plans/x 500 acao=null | PASS |
| SEC-02.security-headers | anonymous | API | helmet headers present | xcto=nosniff xfo=SAMEORIGIN hsts=true powered=null | PASS |
| SEC-02.route-oddities | anonymous | API | 401/404/405, no 500 | GET /api/v1/nope -> 404 | PASS |
| SEC-02.worker-endpoint-bad-secret | anonymous | API | 401/403/404 (not run) | 404 | PASS |
| SEC-02.RPC.anon-team_candidates | anonymous | D | 401/403/404 | 404 | PASS |
| SEC-02.RPC.anon-my_effective_access | anonymous | D | 401/403/404 | 404 | PASS |
| SEC-02.RPC.anon-replace_scope_grants | anonymous | D | 401/403/404 | 404 | PASS |
| SEC-02.RPC.anon-create_plan_position | anonymous | D | 401/403/404 | 404 | PASS |
| SEC-02.RPC.anon-executable-public-functions | anonymous | D | (info) list of public functions anon can execute | similarity_op,word_similarity,word_similarity_op,word_similarity_commutator_op,similarity_dist,word_similarity_dist_op,word_similarity_dist_commutator | PASS |
| SEC-02.D.anon-selectable-tables | anonymous | D | (info) tables anon can select (RLS must deny) | team_memberships,service_types,team_positions,organization_members,teams,plans,songs,arrangements,plan_items,plan_times,assignments,songbooks,songbook | PASS |
| SEC-02.D.anon-key-row-read-all-anon-selectable-tables | anonymous | D (PostgREST) | 0 rows from each of 75 tables | leaking tables: none; 5xx: none | PASS |
| SEC-02.D.anon-key-write-attempts | anonymous | D | all denied | 0 accepted | PASS |
| SEC-02.D.anon-table-privileges | anonymous | D | (info) table-level SELECT granted to anon on 75 tables, RLS-only protection | 75 tables | PASS |
| SEC-02.rate-limit-config | anonymous | API | (info) global limiter headers | ratelimit=limit=10000, remaining=9902, reset=44 policy=10000;w=60 | PASS |