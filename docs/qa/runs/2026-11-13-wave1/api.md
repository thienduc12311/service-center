# QA-01 API track — wave 1 (run qa-20261113, agent `api`)

Date 2026-11-13. Repo HEAD `70db888`, latest migration `20261110000000_member_avatars_and_team_rosters.sql`. Backend http://localhost:4000/api/v1 (running build, not rebuilt), Supabase local. Every case below was exercised with the caller's own bearer token (service role only used for fixture setup/state-the-API-cannot-produce, listed below). No source/git/DB-reset changes.

## ESCALATIONS (top)

**No P0 found: no cross-tenant data disclosure, no private-field leak, no unauthorized mutation of persisted data, no prepared-assignment leak.** Beta sentinel string never appeared in any Alpha-context response (searches, reads, mutation responses) and Beta persisted state was byte-identical before/after every cross-tenant mutation attempt.

Cross-tenant *reference acceptance* (integrity, no content disclosure observed) is the most serious class found — P1:

* **D1 (P1)** `POST /teams/:id/members` accepts a `position_id` belonging to a Beta team (another organization) and to a different team in the same org; rows persisted (verified in DB: `team_positions.team_id` / org differ from the membership team). Foreign position name is not readable through RLS embed, so no disclosure, but the FK is not tenant/team-scoped.
* **D2 (P1)** `POST /plans` with `service_type_id` of a Beta service type succeeds (201) and persists an Alpha plan whose service type belongs to Beta (`plans.organization_id != service_types.organization_id`). Beta cannot read or edit it (checked via Beta owner API and PostgREST), but the invariant is not enforced.

## Summary

Executed expanded cases: 932. PASS 915, FAIL 12, NOT_APPLICABLE 5, BLOCKED 0, NOT_RUN: see section below. Each FAIL maps to a defect D1–D6.

| Family | PASS | FAIL | N/A |
|---|---|---|---|
| ACL-01 | 233 | 0 | 0 |
| ACL-02 | 9 | 0 | 0 |
| ACL-03 | 157 | 0 | 0 |
| ACL-04 | 37 | 3 | 0 |
| ACL-05 | 46 | 0 | 5 |
| ACL-06 | 211 | 6 | 0 |
| AUTH-02 | 13 | 1 | 0 |
| AUTH-03 | 174 | 0 | 0 |
| PEOPLE-01 | 22 | 1 | 0 |
| TEAM-01 | 11 | 1 | 0 |
| TEAM-03 | 2 | 0 | 0 |

Note: several PASS rows are status-code assertions plus an independent persisted-state check by the owner token (`...persisted...` cases).

## Defects

### D1 (P1) Team membership accepts foreign/other-team position_id
- Cases: `ACL-04.owner.POST-foreign-position.API`, `ACL-04.owner.POST-position-of-other-team.API`, `ACL-04.invalid-refs.persisted.API`
- Repro / evidence: As Alpha owner: `POST /teams/<Alpha Production>/members` body `{"person_id":<Alpha person>,"position_id":<Beta Band "Lead" position id>}` with `X-Organization-Id: Alpha`.
Expected 400/404/422 and no row. Actual 201; DB: `team_memberships.position_id` points to a `team_positions` row of org Beta. Same with an Alpha position of a different team (Band) -> 201. Note `POST /plans/:id/assignments` with a Beta position correctly rejected (ACL-06.owner.POST-assignment-BetaPosition PASS). Route: backend/src/routes/teams.ts `teamsRouter.post("/:id/members")` does not verify position belongs to team; DB has no composite FK/trigger. Rows were removed by the test.
Impact: tenant/team integrity; cross-tenant id existence oracle (201 vs 4xx); possible downstream joins. Role: owner (any actor with roster edit on target team). Clients: all.

### D2 (P1) Plan can reference another organization's service type
- Cases: `ACL-06.owner.POST-plan-BetaServiceType@AlphaCtx.API`
- Repro / evidence: As Alpha owner: `POST /plans` `{"title":"x","service_type_id":<Beta service type id>,"service_date":"2026-12-20T10:00:00Z"}` X-Org Alpha. Expected 4xx. Actual 201, response `service_type: {}`; DB confirms cross-org reference. Beta owner cannot see the plan (API list / PostgREST) and Beta-owner PostgREST PATCH of the plan matched 0 rows, so RLS holds, but data integrity does not. Likely same pattern for `POST /teams` (service_type_id, rejected in ACL-06.owner.POST-team-BetaServiceType, PASS) – only plans affected in this probe. Test plan removed by test.

### D3 (P2) Arrangement sub-resources ignore the active organization header (multi-org context bleed)
- Cases: `ACL-06.multi.GET-arrangement-chart@AlphaCtx.API`
- Repro / evidence: As `multi` (member of Alpha and Beta): `GET /arrangements/<Beta arrangement>/chart` with `X-Organization-Id: <Alpha>` returns 200 with Beta chord chart (contains Beta sentinel). `arrangementsRouter` (`/chart`, `/materials`) passes only `req.db` + id and does not filter on `req.orgId`; RLS allows it because the caller is a Beta member. Not a disclosure to a non-member (single-org owner got 404), but violates AUTH-03 org-context separation for dual members. Other arrangement routes not individually probed.

### D4 (P2) Organization timezone is not validated
- Cases: `AUTH-02.owner.PATCH-organization-invalid-timezone.API`
- Repro / evidence: `PATCH /organizations/<Alpha>` `{"timezone":"Not/AZone"}` -> 200 and persisted (schema is `z.string()`; test restored to America/Toronto). Expected 400/422. Impact: invalid IANA zone can break date rendering/reminders in clients.

### D5 (P2) Malformed UUID path parameters produce HTTP 500 with raw Postgres error text
- Cases: `PEOPLE-01.owner.GET-malformed-id.API`, `ACL-06.owner.malformed-id-error-disclosure-{people,teams,plans,songs}-x.API`
- Repro / evidence: `GET /people/x`, `/teams/x`, `/plans/x`, `/songs/x`, `/assignments/x/response-owner-history` -> 500 `{"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"}`. Expected 400/404 without DB detail (CLAUDE.md rule 20; also reveals DB engine message). Reproduced as owner; unauthenticated callers are stopped earlier (401).

### D6 (P2) `POST /teams` with duplicate position names fails with 409 but leaves the team row created (partial write)
- Cases: `TEAM-01.owner.create-team-duplicate-positions-atomic.API`
- Repro / evidence: `POST /teams` `{"name":"QA Partial","positions":["Dup","Dup"]}` -> 409 "That record already exists", but `GET /teams` then lists "QA Partial" with zero positions. Expected all-or-nothing. (Same name retried returns 409 because the orphan team exists.) Test removed the team.

## Observations (not counted as defects; recorded as PASS with note)

* People owner-only gate is an application-layer 403 (`peopleRouter.use` owner check) for every other-Person detail/mutation route, not an RLS-style 404. It runs before the id lookup, so it is not an existence oracle. Test plan wording "RLS-hidden rows should be 404" is satisfied at the DB layer (see `DB-*` RLS cases: non-owners see only their own `people` row and `people_directory` has no contact columns; `medical_note` etc. not selectable by any API role, even owner via PostgREST).
* People capabilities (`people.manage`, `people.view_private`) can be granted at org scope by owner/admin (200, stored, listed in `GET /access/organization`) but are intentionally inert: `/access/me` for the grantee omits them and every People route stays denied (ACL-03.peoplegrant.*). Grant UI/API still accepts them; confirm product intent.
* Legacy scheduler holds implicit org-level `teams.manage` (listed `source: role:scheduler_legacy` in `/access/me`) so it can PATCH team definitions; only roster add/remove is carved out and is denied until an explicit matching `teams.manage` grant (ACL-04 PASS). Oracle says roster only; team-definition editing by legacy is consistent with "organization-wide operational access".
* `POST /people/guests` (rosterRouter, not behind owner gate) lets any holder of scheduling.manage create a no-login Person (legacy/admin/scoped/band-lead 201; member/people-grant 403). This is a by-design scheduler feature (route comment) but is a Person create path outside the owner-only People rule; confirm. Created guest Persons are fixtures.
* `GET /people/reconciliations` is admin-allowed by design (PEOPLE-05); returned `[]`.
* DELETE of foreign/unauthorized ids returns 204 (RLS matches 0 rows, idempotent); each was verified as a no-op by snapshot diff of Beta and Alpha state. Same response for random UUIDs.
* Duplicate Person email is allowed on create (201) — policy question for PEOPLE-01 ("duplicate fields follow contract"); duplicate team name -> 409; duplicate position name in one team -> 409.
* Search echoes the query string in its JSON (`"query":...`); test harness excluded that echo when scanning for markers.

## Manifest (no secrets)

Credentials (random per-run passwords) are kept only in the agent scratchpad `api/creds.json`, not in the repo or here. Emails `<alias>.qa20261113.api@example.test`.

| Alias | Auth user id | Alpha role / access | Alpha person id | Notes |
|---|---|---|---|---|
| owner | 449004ab-e1d0-46d3-abce-c0979827a25a | owner/legacy | e02b75a6-bc56-40b6-b9cd-ea74acccaef8 | Alpha owner (created org via POST /organizations) |
| admin | e5cca57c-f261-4e68-a895-cc1021493900 | admin/legacy | ed463cba-6a3b-4641-ba2a-91913398270d | Alpha admin |
| legacy | b4af32e3-0bcb-4857-a525-eda49b52df3d | scheduler/legacy | 1a6b8fde-d2de-4494-b873-6d376d30e021 | Alpha scheduler, legacy mode; Production team member; explicit teams.manage toggled during ACL-04 then revoked |
| scoped | 6ba909c0-90df-45a5-82e0-dda07c292214 | scheduler/scoped | fde3c4f9-9d67-4a48-a6ac-dc427feebd41 | Alpha scheduler, scoped; plans.edit+scheduling.manage on Sunday service type |
| bandlead | 76e941a9-bc4f-489f-9b82-340f157f06a6 | member/legacy | 21ee3fd0-d170-4a03-bf2d-3859c154de91 | Alpha member; scheduling.manage+teams.manage on Band team |
| peoplegrant | c19c4eca-b1e4-4928-886d-fcb38a27b8ab | member/legacy | 0d1ad26c-2089-48ec-845a-d2ba0198d46c | Alpha member; org people.manage+people.view_private (inert) |
| member | 7e8dbe30-7d48-44dd-93f3-14f0737a8141 | member/legacy | d108603b-c858-4169-8057-3e42d00f5f5d | Alpha member; has released+confirmed assignment on Sunday plan (ACL-05) |
| multi | 33ce1756-744f-4ce3-9a09-2793c9c7d882 | member/legacy | 58336af2-5f4c-4ea1-8c27-62b548a5d0f6 | Alpha member (re-added via psql, see setup) + Beta member (Person in Beta) |
| betaowner | a368c31e-f7d6-4dc8-a8dc-612ac6c137b2 | — (Beta owner) | — | Beta owner (created org via API) |
| newcomer | 15b1ef5b-06f2-4682-b6e8-dbafcc8c0bb0 | — | — | no org |
| inactive | df0ef58a-1337-432c-a0d9-ec8218df9958 | member/inactive | f85bdc01-268b-4d59-b433-20920dd336b3 | Alpha membership set inactive |

* Alpha org `qa-20261113-api-alpha` id `999d8172-44f1-42af-aaec-72dfbf431ee9`; Beta org `qa-20261113-api-beta` id `6c0edd3d-439b-4696-96dd-0688cc039241`.
* Alpha: service types Sunday `94928650-5978-4015-81fd-a5bff039cfd4`, Midweek `ed66ef22-6ee9-47a5-8c40-c19b2ef13688`; teams Band `1e4935e8-a73e-4b1e-9d10-2de6e381ea4d`, Production `826f93d2-850c-415f-b9f4-8d0b6fb71c4b`; plans Sunday `d24b6197-a3ae-487e-ae06-550c2f4900d2`, Midweek `40952e24-a49d-44ce-903e-9d3019b9bd4a`; song `1b582b9c-898e-47e1-bdf8-f66a9bcec30e`; folder `8177b98e-7247-4609-a17a-cb9218f4f0d2`; prepared→released assignment `bd92abe2-0c4e-46f5-bc59-2bddf5b95288`.
* Beta: service types Sunday `a54b3021-1b52-4e0b-b00a-a371764b7579`, Midweek `e2062616-1d81-4c71-bd14-6240e2dc552c`; teams Band `a4898a71-746f-41f7-9ba9-96bb67e20c02`, Production `21f74a20-a534-4b0c-88c9-c117d07da9d5`; plans Sunday `08769c69-a4bc-430a-8a80-12b4dfdb3fdd`, Midweek `be2200dd-1dbb-4844-963f-14adc16d0606`; song `a735664f-b1b7-4408-a5d1-e81aeac37f93`; arrangement `844be95b-c4e6-4df7-8cb5-1503736adc55`; sentinel Person `a30ebd6b-d0fc-41de-a4cc-93650d0919ea` (private fields hold sentinel `QA20261113-BETA-SENTINEL-7f3a9c`); Beta multi Person `9dece3d1-e5eb-4bc7-a422-e047343a86d5`; Beta assignments 511fc50d-82b2-4657-bc15-40872a71a095, 840926a3-4d9e-4744-ac61-fb612ed26f6b.
* Alpha Persons also created by tests and left in place: roster persons R1–R4 (`8b4f9e5b-6bee-4847-bdd4-2893c60d29ea, b55b7ac3-1eab-4c77-94aa-53c91ea1055e, 7163e7f9-0f7d-49a2-938b-fd110f5f343d, 83f9a37f-3b6e-45ed-b4f3-7dc3836f304f`), 6 guest Persons `Guest<alias> QaApi`; Alpha song "Shared Song Title"; header item "scoped header" on Sunday plan.

### Privileged setup (service role / psql), everything else went through the real API

* Auth users created via `POST /auth/v1/admin/users` (as instructed). Memberships were created through the real flow: owner `POST /people` -> `POST /people/:id/invitations` -> public `POST /invitations/:token/accept` (links the pre-created login).
* Orgs created via real `POST /organizations` (AUTH-02). Roles, access mode, grants, teams, service types, plans, songs, assignments all via API.
* **psql:** one `INSERT INTO organization_members` to re-add `multi` to Alpha after my own test (`DELETE /people/members/<multi>` in case ACL-06 `DELETE-BetaMember`, an earlier harness mistake) removed it. Read-only psql SELECTs used to confirm DB state for D1/D2.

## Results table

Legend: expected = acceptable status codes (or description); status per plan section 8. Actor is the alias token used (service role never used as evidence). Request abbreviates path; `<Beta…>` = Beta-org id substituted. Org header = Alpha unless stated.

| case id | actor | request | expected | actual | status | note |
|---|---|---|---|---|---|---|
| ACL-03.admin.GET-person-member.API | admin | GET /people/member-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.admin.GET-person-owner.API | admin | GET /people/owner-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.admin.GET-list-redaction.API | admin | GET /people?include_archived=true | 200 | 200 | PASS | rows=8; other rows with email/phone=0; foreign email strings=0; PRIV markers=False |
| ACL-03.admin.POST-create.API | admin | POST /people | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.PATCH-person.API | admin | PATCH /people/<person> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.PATCH-person-owner.API | admin | PATCH /people/e02b75a6-bc56-40b6-b9cd-ea74acccaef8 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.POST-archive.API | admin | POST /people/<person>/archive | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.POST-restore.API | admin | POST /people/<person>/restore | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.DELETE-person.API | admin | DELETE /people/f85bdc01-268b-4d59-b433-20920dd336b3 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.POST-invite.API | admin | POST /people/<person>/invitations | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.PUT-tags.API | admin | PUT /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.GET-tags.API | admin | GET /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.POST-from-member.API | admin | POST /people/from-member/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.PATCH-member-role.API | admin | PATCH /people/members/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.PATCH-member-self-promote.API | admin | PATCH /people/members/e5cca57c-f261-4e68-a895-cc1021493900 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.DELETE-member.API | admin | DELETE /people/members/df0ef58a-1337-432c-a0d9-ec8218df9958 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.POST-eligibility.API | admin | POST /people/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.GET-eligibility.API | admin | GET /people/members/<uid>/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.admin.persisted-state-unchanged.API | admin | owner re-snapshot of people/tags/members | unchanged | unchanged | PASS |  |
| ACL-03.admin.own-ME-edit.API | admin | PATCH /me (phone) | 200 | 200 | PASS | GET /me phone persisted=True |
| ACL-03.admin.own-ME-language.API | admin | PATCH /me/language-preference | 200 | 200 | PASS | {'preferred_language': 'vi', 'person_linked': True} |
| ACL-03.legacy.GET-person-member.API | legacy | GET /people/member-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.legacy.GET-person-owner.API | legacy | GET /people/owner-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.legacy.GET-list-redaction.API | legacy | GET /people?include_archived=true | 200 | 200 | PASS | rows=8; other rows with email/phone=0; foreign email strings=0; PRIV markers=False |
| ACL-03.legacy.POST-create.API | legacy | POST /people | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.PATCH-person.API | legacy | PATCH /people/<person> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.PATCH-person-owner.API | legacy | PATCH /people/e02b75a6-bc56-40b6-b9cd-ea74acccaef8 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.POST-archive.API | legacy | POST /people/<person>/archive | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.POST-restore.API | legacy | POST /people/<person>/restore | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.DELETE-person.API | legacy | DELETE /people/f85bdc01-268b-4d59-b433-20920dd336b3 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.POST-invite.API | legacy | POST /people/<person>/invitations | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.PUT-tags.API | legacy | PUT /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.GET-tags.API | legacy | GET /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.POST-from-member.API | legacy | POST /people/from-member/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.PATCH-member-role.API | legacy | PATCH /people/members/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.PATCH-member-self-promote.API | legacy | PATCH /people/members/b4af32e3-0bcb-4857-a525-eda49b52df3d | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.DELETE-member.API | legacy | DELETE /people/members/df0ef58a-1337-432c-a0d9-ec8218df9958 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.POST-eligibility.API | legacy | POST /people/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.GET-eligibility.API | legacy | GET /people/members/<uid>/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.legacy.persisted-state-unchanged.API | legacy | owner re-snapshot of people/tags/members | unchanged | unchanged | PASS |  |
| ACL-03.legacy.own-ME-edit.API | legacy | PATCH /me (phone) | 200 | 200 | PASS | GET /me phone persisted=True |
| ACL-03.legacy.own-ME-language.API | legacy | PATCH /me/language-preference | 200 | 200 | PASS | {'preferred_language': 'vi', 'person_linked': True} |
| ACL-03.peoplegrant.GET-person-member.API | peoplegrant | GET /people/member-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.peoplegrant.GET-person-owner.API | peoplegrant | GET /people/owner-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.peoplegrant.GET-list-redaction.API | peoplegrant | GET /people?include_archived=true | 200 | 200 | PASS | rows=8; other rows with email/phone=0; foreign email strings=0; PRIV markers=False |
| ACL-03.peoplegrant.POST-create.API | peoplegrant | POST /people | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.PATCH-person.API | peoplegrant | PATCH /people/<person> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.PATCH-person-owner.API | peoplegrant | PATCH /people/e02b75a6-bc56-40b6-b9cd-ea74acccaef8 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.POST-archive.API | peoplegrant | POST /people/<person>/archive | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.POST-restore.API | peoplegrant | POST /people/<person>/restore | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.DELETE-person.API | peoplegrant | DELETE /people/f85bdc01-268b-4d59-b433-20920dd336b3 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.POST-invite.API | peoplegrant | POST /people/<person>/invitations | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.PUT-tags.API | peoplegrant | PUT /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.GET-tags.API | peoplegrant | GET /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.POST-from-member.API | peoplegrant | POST /people/from-member/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.PATCH-member-role.API | peoplegrant | PATCH /people/members/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.PATCH-member-self-promote.API | peoplegrant | PATCH /people/members/c19c4eca-b1e4-4928-886d-fcb38a27b8ab | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.DELETE-member.API | peoplegrant | DELETE /people/members/df0ef58a-1337-432c-a0d9-ec8218df9958 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.POST-eligibility.API | peoplegrant | POST /people/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.GET-eligibility.API | peoplegrant | GET /people/members/<uid>/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.peoplegrant.persisted-state-unchanged.API | peoplegrant | owner re-snapshot of people/tags/members | unchanged | unchanged | PASS |  |
| ACL-03.peoplegrant.own-ME-edit.API | peoplegrant | PATCH /me (phone) | 200 | 200 | PASS | GET /me phone persisted=True |
| ACL-03.peoplegrant.own-ME-language.API | peoplegrant | PATCH /me/language-preference | 200 | 200 | PASS | {'preferred_language': 'vi', 'person_linked': True} |
| ACL-03.member.GET-person-owner.API | member | GET /people/owner-person | 403/404 | 403 | PASS | leak-check: False |
| ACL-03.member.GET-list-redaction.API | member | GET /people?include_archived=true | 200 | 200 | PASS | rows=8; other rows with email/phone=0; foreign email strings=0; PRIV markers=False |
| ACL-03.member.POST-create.API | member | POST /people | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.PATCH-person.API | member | PATCH /people/<person> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.PATCH-person-owner.API | member | PATCH /people/e02b75a6-bc56-40b6-b9cd-ea74acccaef8 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.POST-archive.API | member | POST /people/<person>/archive | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.POST-restore.API | member | POST /people/<person>/restore | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.DELETE-person.API | member | DELETE /people/f85bdc01-268b-4d59-b433-20920dd336b3 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.POST-invite.API | member | POST /people/<person>/invitations | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.PUT-tags.API | member | PUT /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.GET-tags.API | member | GET /people/<person>/tags | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.POST-from-member.API | member | POST /people/from-member/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.PATCH-member-role.API | member | PATCH /people/members/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.PATCH-member-self-promote.API | member | PATCH /people/members/<uid> | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.DELETE-member.API | member | DELETE /people/members/df0ef58a-1337-432c-a0d9-ec8218df9958 | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.POST-eligibility.API | member | POST /people/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.GET-eligibility.API | member | GET /people/members/<uid>/eligibility | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-03.member.persisted-state-unchanged.API | member | owner re-snapshot of people/tags/members | unchanged | unchanged | PASS |  |
| ACL-03.member.own-ME-edit.API | member | PATCH /me (phone) | 200 | 200 | PASS | GET /me phone persisted=True |
| ACL-03.member.own-ME-language.API | member | PATCH /me/language-preference | 200 | 200 | PASS | {'preferred_language': 'vi', 'person_linked': True} |
| ACL-03.legacy.roster.GET-reconciliations.API | legacy | GET /people/reconciliations | 400/403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-03.peoplegrant.roster.GET-reconciliations.API | peoplegrant | GET /people/reconciliations | 400/403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-03.member.roster.GET-reconciliations.API | member | GET /people/reconciliations | 400/403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-03.owner.GET-list.API | owner | GET /people | 200 | 200 | PASS | rows=8, rows with email=8 |
| ACL-03.owner.GET-person.API | owner | GET /people/<member-person> | 200 | 200 | PASS | medical_note present=True |
| ACL-03.owner.POST-create.API | owner | POST /people | 201 | 201 | PASS |  |
| ACL-03.owner.PATCH-person.API | owner | PATCH /people/<new> | 200 | 200 | PASS | persisted campus=QA-Campus |
| ACL-03.owner.PUT-tags.API | owner | PUT /people/<new>/tags | 200 | 200 | PASS | persisted=['qa-tag'] |
| ACL-03.owner.POST-archive.API | owner | POST /people/<new>/archive | 200 | 200 | PASS | archived_at set=True |
| ACL-03.owner.POST-restore.API | owner | POST /people/<new>/restore | 200 | 200 | PASS |  |
| ACL-03.owner.POST-invite.API | owner | POST /people/<new>/invitations | 201 | 201 | PASS |  |
| ACL-03.owner.DELETE-person.API | owner | DELETE /people/<new> | 204 | 204 | PASS | then GET=404 |
| ACL-03.admin.roster.GET-audit.API | admin | GET /people/audit | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.admin.roster.PUT-tag-catalog.API | admin | PUT /people/tag-catalog | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.admin.roster.POST-tag-group.API | admin | POST /people/tag-groups | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.admin.roster.POST-bulk-apply-tag.API | admin | POST /people/bulk/apply | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.legacy.roster.GET-audit.API | legacy | GET /people/audit | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.legacy.roster.PUT-tag-catalog.API | legacy | PUT /people/tag-catalog | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.legacy.roster.POST-tag-group.API | legacy | POST /people/tag-groups | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.legacy.roster.POST-bulk-apply-tag.API | legacy | POST /people/bulk/apply | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.peoplegrant.roster.GET-audit.API | peoplegrant | GET /people/audit | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.peoplegrant.roster.PUT-tag-catalog.API | peoplegrant | PUT /people/tag-catalog | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.peoplegrant.roster.POST-tag-group.API | peoplegrant | POST /people/tag-groups | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.peoplegrant.roster.POST-bulk-apply-tag.API | peoplegrant | POST /people/bulk/apply | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.member.roster.GET-audit.API | member | GET /people/audit | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.member.roster.PUT-tag-catalog.API | member | PUT /people/tag-catalog | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.member.roster.POST-tag-group.API | member | POST /people/tag-groups | 400/403/404 | 403 | PASS | {"error":"You need the “Manage people” permission to do that","code":"forbidden"} |
| ACL-03.member.roster.POST-bulk-apply-tag.API | member | POST /people/bulk/apply | 400/403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.roster.persisted-state.API | owner | GET tags/tag-catalog | no hack tags | ok | PASS | tags=[] |
| ACL-03.admin.search-redaction-ALPHA-PRIV.API | admin | GET /search?q=ALPHA-PRIV | 200 | 200 | PASS | leak=False; len=34 |
| ACL-03.admin.search-redaction-example.test.API | admin | GET /search?q=example.test | 200 | 200 | PASS | leak=False; len=36 |
| ACL-03.admin.search-redaction-QaApi.API | admin | GET /search?q=QaApi | 200 | 200 | PASS | leak=False; len=934 |
| ACL-03.admin.search-redaction-0100.API | admin | GET /search?q=0100 | 200 | 200 | PASS | leak=False; len=28 |
| ACL-03.legacy.search-redaction-ALPHA-PRIV.API | legacy | GET /search?q=ALPHA-PRIV | 200 | 200 | PASS | leak=False; len=34 |
| ACL-03.legacy.search-redaction-example.test.API | legacy | GET /search?q=example.test | 200 | 200 | PASS | leak=False; len=36 |
| ACL-03.legacy.search-redaction-QaApi.API | legacy | GET /search?q=QaApi | 200 | 200 | PASS | leak=False; len=934 |
| ACL-03.legacy.search-redaction-0100.API | legacy | GET /search?q=0100 | 200 | 200 | PASS | leak=False; len=28 |
| ACL-03.peoplegrant.search-redaction-ALPHA-PRIV.API | peoplegrant | GET /search?q=ALPHA-PRIV | 200 | 200 | PASS | leak=False; len=34 |
| ACL-03.peoplegrant.search-redaction-example.test.API | peoplegrant | GET /search?q=example.test | 200 | 200 | PASS | leak=False; len=36 |
| ACL-03.peoplegrant.search-redaction-QaApi.API | peoplegrant | GET /search?q=QaApi | 200 | 200 | PASS | leak=False; len=934 |
| ACL-03.peoplegrant.search-redaction-0100.API | peoplegrant | GET /search?q=0100 | 200 | 200 | PASS | leak=False; len=28 |
| ACL-03.member.search-redaction-ALPHA-PRIV.API | member | GET /search?q=ALPHA-PRIV | 200 | 200 | PASS | leak=False; len=34 |
| ACL-03.member.search-redaction-example.test.API | member | GET /search?q=example.test | 200 | 200 | PASS | leak=False; len=36 |
| ACL-03.member.search-redaction-QaApi.API | member | GET /search?q=QaApi | 200 | 200 | PASS | leak=False; len=934 |
| ACL-03.member.search-redaction-0100.API | member | GET /search?q=0100 | 200 | 200 | PASS | leak=False; len=28 |
| ACL-03.admin.DB-people-select.RLS | admin | PostgREST GET /rest/v1/people email/phone (own token) | only own row | only own | PASS | status=200 rows=1 foreign-contact rows=0; private cols status=403;  |
| ACL-03.admin.DB-people_directory-columns.RLS | admin | PostgREST GET /rest/v1/people_directory (own token) | no contact/private cols | none | PASS | rows=9 |
| ACL-03.admin.DB-people-update.RLS | admin | PostgREST PATCH /rest/v1/people (own token) | denied or 0 rows | 403 no row changed | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.admin.DB-people-insert.RLS | admin | PostgREST POST /rest/v1/people (own token) | 401/403 | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.admin.DB-people-delete.RLS | admin | PostgREST DELETE /rest/v1/people (own token) | denied or 0 rows | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.legacy.DB-people-select.RLS | legacy | PostgREST GET /rest/v1/people email/phone (own token) | only own row | only own | PASS | status=200 rows=1 foreign-contact rows=0; private cols status=403;  |
| ACL-03.legacy.DB-people_directory-columns.RLS | legacy | PostgREST GET /rest/v1/people_directory (own token) | no contact/private cols | none | PASS | rows=9 |
| ACL-03.legacy.DB-people-update.RLS | legacy | PostgREST PATCH /rest/v1/people (own token) | denied or 0 rows | 403 no row changed | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.legacy.DB-people-insert.RLS | legacy | PostgREST POST /rest/v1/people (own token) | 401/403 | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.legacy.DB-people-delete.RLS | legacy | PostgREST DELETE /rest/v1/people (own token) | denied or 0 rows | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.peoplegrant.DB-people-select.RLS | peoplegrant | PostgREST GET /rest/v1/people email/phone (own token) | only own row | only own | PASS | status=200 rows=1 foreign-contact rows=0; private cols status=403;  |
| ACL-03.peoplegrant.DB-people_directory-columns.RLS | peoplegrant | PostgREST GET /rest/v1/people_directory (own token) | no contact/private cols | none | PASS | rows=9 |
| ACL-03.peoplegrant.DB-people-update.RLS | peoplegrant | PostgREST PATCH /rest/v1/people (own token) | denied or 0 rows | 403 no row changed | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.peoplegrant.DB-people-insert.RLS | peoplegrant | PostgREST POST /rest/v1/people (own token) | 401/403 | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.peoplegrant.DB-people-delete.RLS | peoplegrant | PostgREST DELETE /rest/v1/people (own token) | denied or 0 rows | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.member.DB-people-select.RLS | member | PostgREST GET /rest/v1/people email/phone (own token) | only own row | only own | PASS | status=200 rows=1 foreign-contact rows=0; private cols status=403;  |
| ACL-03.member.DB-people_directory-columns.RLS | member | PostgREST GET /rest/v1/people_directory (own token) | no contact/private cols | none | PASS | rows=9 |
| ACL-03.member.DB-people-update.RLS | member | PostgREST PATCH /rest/v1/people (own token) | denied or 0 rows | 403 no row changed | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.member.DB-people-insert.RLS | member | PostgREST POST /rest/v1/people (own token) | 401/403 | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.member.DB-people-delete.RLS | member | PostgREST DELETE /rest/v1/people (own token) | denied or 0 rows | 403 | PASS | {"code":"42501","details":null,"hint":"Grant the required privileges to the curr |
| ACL-03.owner.DB-people-select.RLS | owner | PostgREST GET /rest/v1/people contacts (owner token) | 200 | 200 | PASS | rows=9 (all people incl contacts); private cols select -> 403 (column privilege, not selectable by any API role) |
| ACL-03.owner.DB-people_directory-columns.RLS | owner | PostgREST GET /rest/v1/people_directory (own token) | no contact/private cols | none | PASS | rows=9 |
| ACL-03.admin.roster.GET-reconciliations.API | admin | GET /people/reconciliations | 200 | 200 | PASS | admin allowed by design (requireAdmin; PEOPLE-05 identity reconciliation); returned []; not a People-detail leak |
| ACL-04.legacy-implicit.POST-member-Production.API | legacy (scheduler, legacy mode, no grant) | POST /teams/Production/members | 403/404 | 403 | PASS | {"error":"Only organization admins and team leaders can change who is on a team","code":"f |
| ACL-04.legacy-implicit.POST-member-Band.API | legacy | POST /teams/Band/members | 403/404 | 403 | PASS | {"error":"Only organization admins and team leaders can change who is on a team","code":"f |
| ACL-04.legacy-implicit.DELETE-member-Production.API | legacy | DELETE /teams/Production/members/<own membership> | 403/404 | 403 | PASS | {"error":"Only organization admins and team leaders can change who is on a team","code":"f |
| ACL-04.legacy-implicit.persisted-unchanged.API | legacy | owner GET both teams | unchanged | unchanged | PASS |  |
| ACL-04.legacy-implicit.PATCH-team-definition.API | legacy | PATCH /teams/Production (team definition; legacy role carries org-level teams.manage) | 200 | 200 | PASS | OBSERVATION: team definition edit allowed to legacy by design (access/me lists teams.manage role:scheduler_legacy); only roster add/remove i |
| ACL-04.admin.POST-member-Production.API | admin | POST /teams/Production/members | 201 | 201 | PASS | {"id":"dbea754f-4172-4109-b457-003717a820b8","team_id":"826f |
| ACL-04.admin.DELETE-member-Production.API | admin | DELETE membership | 204 | 204 | PASS |  |
| ACL-04.admin.persisted.API | admin | owner GET team | unchanged after add+remove | ok | PASS |  |
| ACL-04.owner.grant-legacy-teams.manage-Production.API | owner | PUT /teams/Production/access | 200 | 200 | PASS | {"scope_type":"team","scope_id":"826f93d2-850c-415f-b9f4-8d0 |
| ACL-04.legacy-explicit.POST-member-Production.API | legacy + teams.manage(Production) | POST /teams/Production/members | 201 | 201 | PASS | {"id":"78fe9432-c05f-46ab-b196-bde5505062b6","team_id":"826f |
| ACL-04.legacy-explicit.persisted-add.API | legacy | owner GET team | R2 present | present | PASS |  |
| ACL-04.legacy-explicit.POST-member-Band(not granted).API | legacy + teams.manage(Production only) | POST /teams/Band/members | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-04.legacy-explicit.Band-unchanged.API | legacy | owner GET Band | unchanged | unchanged | PASS |  |
| ACL-04.legacy-explicit.DELETE-member-Band(not granted).API | legacy | DELETE /teams/Band/members/<m> | 403/404 | 404 | PASS | {"error":"Team member not found","code":"not_found"} |
| ACL-04.legacy-explicit.Band-member-still-present.API | legacy | owner GET Band | present | present | PASS |  |
| ACL-04.legacy-explicit.DELETE-member-Production.API | legacy + teams.manage(Production) | DELETE /teams/Production/members/<m> | 204 | 204 | PASS |  |
| ACL-04.legacy-explicit.persisted-remove.API | legacy | owner GET team | R2 gone | gone | PASS |  |
| ACL-04.legacy-explicit.POST-foreign-person.API | legacy + teams.manage(Production) | POST members {person_id: Beta person} | 400/404 | 400 | PASS | {"error":"That Person is not in this organization","code":"bad_request"} |
| ACL-04.owner.POST-foreign-person.API | owner | POST members {person_id: Beta person} | 400/404 | 400 | PASS | {"error":"That Person is not in this organization","code":"bad_request"} |
| ACL-04.owner.POST-foreign-position.API | owner | POST members {position_id: Beta position} | 400/404/409/422 | 201 | FAIL | {"id":"935ca28f-314e-409c-8a36-a6625985c367","team_id":"826f93d2-850c-415f-b9f4-8d0b6fb71c |
| ACL-04.owner.POST-position-of-other-team.API | owner | POST Production members {position_id: Band position} | 400/404/409/422 | 201 | FAIL | {"id":"c592279a-9bec-4c60-87e3-4b3077414f73","team_id":"826f93d2-850c-415f-b9f4-8d0b6fb71c |
| ACL-04.invalid-refs.persisted.API | owner | owner GET Production | R4 absent | PRESENT (D1: rows created, then cleaned) | FAIL |  |
| ACL-04.legacy-explicit.re-add-before-revoke.API | legacy | POST Production members | 201 | 201 | PASS |  |
| ACL-04.owner.revoke-legacy-teams.manage.API | owner | PUT /teams/Production/access {grants:[]} | 200 | 200 | PASS |  |
| ACL-04.legacy.after-revoke.POST-member.API | legacy (grant revoked mid-session, same token) | POST Production members | 403/404 | 403 | PASS | {"error":"Only organization admins and team leaders can change who is on a team","code":"f |
| ACL-04.legacy.after-revoke.DELETE-member.API | legacy | DELETE Production membership | 403/404 | 403 | PASS | {"error":"Only organization admins and team leaders can change who is on a team","code":"f |
| ACL-04.legacy.after-revoke.persisted.API | legacy | owner GET Production | R2 still present, R3 absent | ok | PASS |  |
| ACL-04.bandlead.POST-member-Band.API | band-lead (teams.manage+scheduling.manage Band) | POST /teams/Band/members | 201 | 201 | PASS | {"id":"64b65621-d064-4c75-9ec4-c3941a127129","team_id":"1e49 |
| ACL-04.bandlead.DELETE-member-Band.API | band-lead | DELETE /teams/Band/members/<m> | 204 | 204 | PASS |  |
| ACL-04.bandlead.POST-member-Production.API | band-lead | POST /teams/Production/members | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-04.bandlead.DELETE-member-Production.API | band-lead | DELETE /teams/Production/members/<m> | 403/404 | 404 | PASS | {"error":"Team member not found","code":"not_found"} |
| ACL-04.bandlead.Production-persisted.API | band-lead | owner GET Production | R1 absent, R4 present | ok | PASS |  |
| ACL-04.bandlead.PATCH-team-Production.API | band-lead | PATCH /teams/Production | 403/404 | 404 | PASS | {"error":"Team not found","code":"not_found"} |
| ACL-04.bandlead.PATCH-team-Band.API | band-lead | PATCH /teams/Band (teams.manage on Band) | 200 | 200 | PASS | {"id":"1e4935e8-a73e-4b1e-9d10-2de6e381ea4d","organization_i |
| ACL-04.bandlead.PATCH-plan.API | band-lead (no plans.edit) | PATCH /plans/<Sunday> | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} |
| ACL-04.bandlead.POST-song.API | band-lead (no songs.manage) | POST /songs | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that","code":"forbidden"} |
| ACL-04.bandlead.POST-person.API | band-lead | POST /people | 403 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-04.bandlead.POST-team-orgwide.API | band-lead (team-scoped only) | POST /teams (org-wide create) | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-04.bandlead.persisted.API | band-lead | owner GET plan, teams | plan/title unchanged | ok | PASS |  |
| ACL-04.bandlead.no-new-team.API | band-lead | owner GET /teams | no "BL org team" | ok | PASS |  |
| ACL-01.owner.grant-plans.edit@organization.API | owner | PUT access/…/access grant plans.edit to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-plans.edit@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-plans.edit@folder.API | owner | PUT folders/…/access grant plans.edit to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-plans.edit@folder.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-plans.edit@service_type.API | owner | PUT service-types/…/access grant plans.edit to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-plans.edit@service_type.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.invalid-scope-grant-plans.edit@team.API | owner | PUT access grant plans.edit at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-plans.edit@team.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.grant-scheduling.manage@organization.API | owner | PUT access/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.manage@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.manage@folder.API | owner | PUT folders/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.manage@folder.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.manage@service_type.API | owner | PUT service-types/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.manage@service_type.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.manage@team.API | owner | PUT teams/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.manage@team.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.override_conflicts@organization.API | owner | PUT access/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.override_conflicts@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.override_conflicts@folder.API | owner | PUT folders/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.override_conflicts@folder.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.override_conflicts@service_type.API | owner | PUT service-types/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.override_conflicts@service_type.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-scheduling.override_conflicts@team.API | owner | PUT teams/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-scheduling.override_conflicts@team.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-teams.manage@organization.API | owner | PUT access/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-teams.manage@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-teams.manage@folder.API | owner | PUT folders/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-teams.manage@folder.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-teams.manage@service_type.API | owner | PUT service-types/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-teams.manage@service_type.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-teams.manage@team.API | owner | PUT teams/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-teams.manage@team.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.grant-people.view_private@organization.API | owner | PUT access/…/access grant people.view_private to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=False (OBSERVATION: People capability stored but intentionally not effective: own |
| ACL-01.owner.revoke-people.view_private@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.invalid-scope-grant-people.view_private@folder.API | owner | PUT access grant people.view_private at folder (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.view_private@folder.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-people.view_private@service_type.API | owner | PUT access grant people.view_private at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.view_private@service_type.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-people.view_private@team.API | owner | PUT access grant people.view_private at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.view_private@team.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.grant-people.manage@organization.API | owner | PUT access/…/access grant people.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=False (OBSERVATION: People capability stored but intentionally not effective: own |
| ACL-01.owner.revoke-people.manage@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.invalid-scope-grant-people.manage@folder.API | owner | PUT access grant people.manage at folder (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.manage@folder.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-people.manage@service_type.API | owner | PUT access grant people.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.manage@service_type.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-people.manage@team.API | owner | PUT access grant people.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-people.manage@team.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.grant-songs.manage@organization.API | owner | PUT access/…/access grant songs.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-songs.manage@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.invalid-scope-grant-songs.manage@folder.API | owner | PUT access grant songs.manage at folder (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-songs.manage@folder.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-songs.manage@service_type.API | owner | PUT access grant songs.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-songs.manage@service_type.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-songs.manage@team.API | owner | PUT access grant songs.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-songs.manage@team.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.grant-media.manage@organization.API | owner | PUT access/…/access grant media.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.owner.revoke-media.manage@organization.API | owner | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.owner.invalid-scope-grant-media.manage@folder.API | owner | PUT access grant media.manage at folder (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-media.manage@folder.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-media.manage@service_type.API | owner | PUT access grant media.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-media.manage@service_type.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.invalid-scope-grant-media.manage@team.API | owner | PUT access grant media.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.owner.invalid-scope-not-persisted-media.manage@team.API | owner | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.grant-plans.edit@organization.API | admin | PUT access/…/access grant plans.edit to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-plans.edit@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-plans.edit@service_type.API | admin | PUT service-types/…/access grant plans.edit to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-plans.edit@service_type.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.invalid-scope-grant-plans.edit@team.API | admin | PUT access grant plans.edit at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-plans.edit@team.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.grant-scheduling.manage@organization.API | admin | PUT access/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.manage@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-scheduling.manage@service_type.API | admin | PUT service-types/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.manage@service_type.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-scheduling.manage@team.API | admin | PUT teams/…/access grant scheduling.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.manage@team.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-scheduling.override_conflicts@organization.API | admin | PUT access/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.override_conflicts@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-scheduling.override_conflicts@service_type.API | admin | PUT service-types/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.override_conflicts@service_type.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-scheduling.override_conflicts@team.API | admin | PUT teams/…/access grant scheduling.override_conflicts to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-scheduling.override_conflicts@team.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-teams.manage@organization.API | admin | PUT access/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-teams.manage@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-teams.manage@service_type.API | admin | PUT service-types/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-teams.manage@service_type.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-teams.manage@team.API | admin | PUT teams/…/access grant teams.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-teams.manage@team.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.grant-people.view_private@organization.API | admin | PUT access/…/access grant people.view_private to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=False (OBSERVATION: People capability stored but intentionally not effective: own |
| ACL-01.admin.revoke-people.view_private@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.invalid-scope-grant-people.view_private@service_type.API | admin | PUT access grant people.view_private at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-people.view_private@service_type.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.invalid-scope-grant-people.view_private@team.API | admin | PUT access grant people.view_private at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-people.view_private@team.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.grant-people.manage@organization.API | admin | PUT access/…/access grant people.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=False (OBSERVATION: People capability stored but intentionally not effective: own |
| ACL-01.admin.revoke-people.manage@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.invalid-scope-grant-people.manage@service_type.API | admin | PUT access grant people.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-people.manage@service_type.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.invalid-scope-grant-people.manage@team.API | admin | PUT access grant people.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-people.manage@team.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.grant-songs.manage@organization.API | admin | PUT access/…/access grant songs.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-songs.manage@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.invalid-scope-grant-songs.manage@service_type.API | admin | PUT access grant songs.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-songs.manage@service_type.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.invalid-scope-grant-songs.manage@team.API | admin | PUT access grant songs.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-songs.manage@team.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.grant-media.manage@organization.API | admin | PUT access/…/access grant media.manage to member | 200 | 200 | PASS | stored in grants list=True; effective in member /access/me=True |
| ACL-01.admin.revoke-media.manage@organization.API | admin | PUT access {grants: baseline} | 200 | 200 | PASS | member still has grant=False |
| ACL-01.admin.invalid-scope-grant-media.manage@service_type.API | admin | PUT access grant media.manage at service_type (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-media.manage@service_type.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.admin.invalid-scope-grant-media.manage@team.API | admin | PUT access grant media.manage at team (invalid combo) | 400/409/422 | 400 | PASS | {"error":"A value failed a database constraint","code":"bad_request","details":null} |
| ACL-01.admin.invalid-scope-not-persisted-media.manage@team.API | admin | GET /access/members/<member> | no grant | none | PASS |  |
| ACL-01.owner.grant-to-non-member-of-org.API | owner | PUT /access/organization grant to Beta-only user | 400/404/409/422 | 400 | PASS | {"error":"Every grant needs an active member of this organization","code":"bad_request"} |
| ACL-01.owner.grant-to-inactive-member.API | owner | PUT /access/organization grant to inactive member | 400/404/409/422/200 | 400 | PASS | OBSERVATION: {"error":"Every grant needs an active member of this organization","code":"bad_r |
| ACL-01.legacy.self-grant-org.API | legacy | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.self-grant-service-type.API | legacy | PUT service-types/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.self-grant-team.API | legacy | PUT teams/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.set-access-mode.API | legacy | PATCH access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.self-promote-admin.API | legacy | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.legacy.self-promote-owner.API | legacy | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.legacy.promote-other.API | legacy | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.legacy.GET-members-access.API | legacy | GET access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.PATCH-org-settings.API | legacy | PATCH organizations/… | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-01.legacy.PUT-roster-visibility.API | legacy | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.legacy.explain-other.API | legacy | GET /access/explain for another user | 403 | 403 | PASS | {"error":"Only an administrator can review someone else’s access","code":"forbid |
| ACL-01.legacy.explain-self.API | legacy | GET /access/explain for self | 200 | 200 | PASS | {"allowed":true,"capability":"plans.edit","role":"scheduler","access_mode":"lega |
| ACL-01.scoped.self-grant-org.API | scoped | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.self-grant-service-type.API | scoped | PUT service-types/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.self-grant-team.API | scoped | PUT teams/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.set-access-mode.API | scoped | PATCH access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.self-promote-admin.API | scoped | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.scoped.self-promote-owner.API | scoped | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.scoped.promote-other.API | scoped | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.scoped.GET-members-access.API | scoped | GET access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.PATCH-org-settings.API | scoped | PATCH organizations/… | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-01.scoped.PUT-roster-visibility.API | scoped | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.scoped.explain-other.API | scoped | GET /access/explain for another user | 403 | 403 | PASS | {"error":"Only an administrator can review someone else’s access","code":"forbid |
| ACL-01.scoped.explain-self.API | scoped | GET /access/explain for self | 200 | 200 | PASS | {"allowed":false,"capability":"plans.edit","role":"scheduler","access_mode":"sco |
| ACL-01.bandlead.self-grant-org.API | bandlead | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.self-grant-service-type.API | bandlead | PUT service-types/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.self-grant-team.API | bandlead | PUT teams/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.set-access-mode.API | bandlead | PATCH access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.self-promote-admin.API | bandlead | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.bandlead.self-promote-owner.API | bandlead | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.bandlead.promote-other.API | bandlead | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.bandlead.GET-members-access.API | bandlead | GET access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.PATCH-org-settings.API | bandlead | PATCH organizations/… | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-01.bandlead.PUT-roster-visibility.API | bandlead | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.bandlead.explain-other.API | bandlead | GET /access/explain for another user | 403 | 403 | PASS | {"error":"Only an administrator can review someone else’s access","code":"forbid |
| ACL-01.bandlead.explain-self.API | bandlead | GET /access/explain for self | 200 | 200 | PASS | {"allowed":false,"capability":"plans.edit","role":"member","access_mode":"legacy |
| ACL-01.peoplegrant.self-grant-org.API | peoplegrant | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.self-grant-service-type.API | peoplegrant | PUT service-types/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.self-grant-team.API | peoplegrant | PUT teams/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.set-access-mode.API | peoplegrant | PATCH access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.self-promote-admin.API | peoplegrant | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.peoplegrant.self-promote-owner.API | peoplegrant | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.peoplegrant.promote-other.API | peoplegrant | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.peoplegrant.GET-members-access.API | peoplegrant | GET access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.PATCH-org-settings.API | peoplegrant | PATCH organizations/… | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-01.peoplegrant.PUT-roster-visibility.API | peoplegrant | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.peoplegrant.explain-other.API | peoplegrant | GET /access/explain for another user | 403 | 403 | PASS | {"error":"Only an administrator can review someone else’s access","code":"forbid |
| ACL-01.peoplegrant.explain-self.API | peoplegrant | GET /access/explain for self | 200 | 200 | PASS | {"allowed":false,"capability":"plans.edit","role":"member","access_mode":"legacy |
| ACL-01.member.self-grant-org.API | member | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.self-grant-service-type.API | member | PUT service-types/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.self-grant-team.API | member | PUT teams/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.set-access-mode.API | member | PATCH access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.self-promote-admin.API | member | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.member.self-promote-owner.API | member | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.member.promote-other.API | member | PATCH people/… | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.member.GET-members-access.API | member | GET access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.PATCH-org-settings.API | member | PATCH organizations/… | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-01.member.PUT-roster-visibility.API | member | PUT access/… | 403/404 | 403 | PASS | {"error":"Only organization admins can do that","code":"forbidden"} |
| ACL-01.member.explain-other.API | member | GET /access/explain for another user | 403 | 403 | PASS | {"error":"Only an administrator can review someone else’s access","code":"forbid |
| ACL-01.member.explain-self.API | member | GET /access/explain for self | 200 | 200 | PASS | {"allowed":false,"capability":"plans.edit","role":"member","access_mode":"legacy |
| ACL-01.admin.self-promote-owner.API | admin | PATCH /people/members/<self> role=owner | 400/403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or manage people","code" |
| ACL-01.non-admin.persisted-unchanged.API | legacy/scoped/bandlead/peoplegrant/member/admin | owner GET /access/members + /me | roles & org name unchanged | unchanged | PASS | roles ok=True; org name=QA API Alpha |
| ACL-01.admin.PUT-org-grants.API | admin | PUT /access/organization | 200 | 200 | PASS | {"scope_type":"organization","scope_id":null,"grants":[{"id" |
| ACL-01.admin.explain-other.API | admin | GET /access/explain other | 200 | 200 | PASS | {"allowed":true,"capability":"media.manage","role":"member","access_mode":"legacy","reasons":[{"source":"grant","scope_type":"organization", |
| ACL-01.scoped.PATCH-Sunday-plan.API | scoped (plans.edit @ Sunday service type) | PATCH /plans/<Sunday> | 200 | 200 | PASS | {"id":"d24b6197-a3ae-487e-ae06-550c2f4900d2","organization_i |
| ACL-01.scoped.Sunday-edit-persisted.API | scoped | owner GET plan | title changed | Sunday Plan (scoped edit) | PASS |  |
| ACL-01.scoped.PATCH-Midweek-plan.API | scoped | PATCH /plans/<Midweek> | 403/404 | 404 | PASS | {"error":"Plan not found","code":"not_found"} |
| ACL-01.scoped.Midweek-unchanged.API | scoped | owner GET plan | title unchanged | Midweek Plan | PASS |  |
| ACL-01.scoped.POST-item-Midweek.API | scoped | POST /plans/<Midweek>/items | 403/404/422 | 404 | PASS | {"error":"Plan not found","code":"not_found"} |
| ACL-01.scoped.POST-item-Sunday.API | scoped | POST /plans/<Sunday>/items | 201/200 | 201 | PASS | {"id":"7458df41-d8d6-4b9d-b02a-63c3c9e25c84","title":"scoped header","plan_id":"d24b6197-a |
| ACL-01.scoped.POST-plan-Midweek-type.API | scoped | POST /plans in Midweek service type | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-01.scoped.POST-service-type-orgwide.API | scoped | POST /service-types | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-01.scoped.POST-song.API | scoped (no songs.manage) | POST /songs | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that","code":"forbidden"} |
| ACL-01.scoped.POST-team.API | scoped (no teams.manage) | POST /teams | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that","code":"forbidden"} |
| ACL-01.scoped.POST-assignment-Midweek.API | scoped (scheduling.manage @ Sunday) | POST /plans/<Midweek>/assignments | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-01.scoped.POST-assignment-Sunday.API | scoped | POST /plans/<Sunday>/assignments (prepared) | 201/200 | 201 | PASS | {"created":[],"conflicts":[],"warnings":[]} |
| ACL-01.owner.revoke-scoped-grants.API | owner | PUT Sunday access {grants:[]} | 200 | 200 | PASS |  |
| ACL-01.scoped.PATCH-Sunday-after-revoke.API | scoped (same token, grants revoked) | PATCH /plans/<Sunday> | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} |
| ACL-01.scoped.after-revoke-persisted.API | scoped | owner GET plan | title unchanged since revoke | Sunday Plan (scoped edit) | PASS |  |
| ACL-01.scoped.PATCH-Sunday-after-regrant.API | scoped | PATCH /plans/<Sunday> after re-grant | 200 | 200 | PASS | {"id":"d24b6197-a3ae-487e-ae06-550c2f4900d2","organization_i |
| ACL-02.legacy.PATCH-plan-before.API | legacy | PATCH /plans/<Midweek> (legacy mode) | 200 | 200 | PASS | {"id":"40952e24-a49d-44ce-903e-9d3019b9bd4a","organization_i |
| ACL-02.owner.switch-legacy-to-scoped.API | owner | PATCH /access/members/<legacy> scoped | 200 | 200 | PASS | {"user_id":"b4af32e3-0bcb-4857-a525-eda49b52df3d","full_name |
| ACL-02.legacy-now-scoped.PATCH-plan.API | legacy (now scoped, no grants, same token) | PATCH /plans/<Midweek> | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} |
| ACL-02.legacy-now-scoped.persisted.API | legacy | owner GET plan | title unchanged | ok | PASS |  |
| ACL-02.legacy-now-scoped.POST-song.API | legacy (scoped) | POST /songs (songs.manage was implicit) | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that","code":"forbidden"} |
| ACL-02.legacy-now-scoped.PATCH-team.API | legacy (scoped) | PATCH /teams/Production | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that","code":"forbidden"} |
| ACL-02.owner.switch-back-to-legacy.API | owner | PATCH /access/members/<legacy> legacy | 200 | 200 | PASS | {"user_id":"b4af32e3-0bcb-4857-a525-eda49b52df3d","full_name |
| ACL-02.legacy.PATCH-plan-after-switchback.API | legacy | PATCH /plans/<Midweek> | 200 | 200 | PASS | {"id":"40952e24-a49d-44ce-903e-9d3019b9bd4a","organization_i |
| ACL-02.bandlead.POST-assignment-Production-team.API | band-lead (scheduling.manage Band only) | POST assignment with team=Production | 403/404 | 403 | PASS | {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-06.owner.GET-person@AlphaCtx.API | owner | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.GET-person-tags@AlphaCtx.API | owner | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea/tags (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.owner.GET-team@AlphaCtx.API | owner | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.GET-team-access@AlphaCtx.API | owner | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body={"scope_type":"team","scope_id":"a4898a71-746f-41f7-9ba9-96b |
| ACL-06.owner.GET-team-candidates@AlphaCtx.API | owner | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/candidates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.GET-team-policies@AlphaCtx.API | owner | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/policies (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.GET-team-eligibility@AlphaCtx.API | owner | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.GET-plan@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-plan-schedule@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-plan-notes@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/notes (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.GET-plan-conflict-overrides@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/conflict-overrides (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.owner.GET-plan-attendance@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/attendance (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-plan-runs@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/runs (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-plan-publication@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/publication (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-plan-deliveries@AlphaCtx.API | owner | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/deliveries (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.GET-song@AlphaCtx.API | owner | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.owner.GET-song-schedule@AlphaCtx.API | owner | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.owner.GET-song-duplicates@AlphaCtx.API | owner | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/duplicates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song unavailable","code":"not_found"} |
| ACL-06.owner.GET-arrangement-materials@AlphaCtx.API | owner | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/materials (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Arrangement unavailable","code":"not_found"} |
| ACL-06.owner.GET-arrangement-chart@AlphaCtx.API | owner | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/chart (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Arrangement not found","code":"not_found"} |
| ACL-06.owner.GET-service-type-teams@AlphaCtx.API | owner | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/teams (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.owner.GET-service-type-access@AlphaCtx.API | owner | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body={"scope_type":"service_type","scope_id":"a54b3021-1b52-4e0b- |
| ACL-06.owner.GET-assignment-response-owner-history@AlphaCtx.API | owner | GET /assignments/511fc50d-82b2-4657-bc15-40872a71a095/response-owner-history (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.owner.GET-member-eligibility@AlphaCtx.API | owner | GET /people/members/a368c31e-f7d6-4dc8-a8dc-612ac6c137b2/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.multi.GET-person@AlphaCtx.API | multi | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.GET-person-tags@AlphaCtx.API | multi | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea/tags (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.GET-team@AlphaCtx.API | multi | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.multi.GET-team-access@AlphaCtx.API | multi | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only organization admins can do that","code":"forb |
| ACL-06.multi.GET-team-candidates@AlphaCtx.API | multi | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/candidates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only schedulers and leaders can do that","code":"f |
| ACL-06.multi.GET-team-policies@AlphaCtx.API | multi | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/policies (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.multi.GET-team-eligibility@AlphaCtx.API | multi | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only schedulers and leaders can do that","code":"f |
| ACL-06.multi.GET-plan@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.multi.GET-plan-schedule@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.multi.GET-plan-notes@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/notes (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Not found","code":"not_found"} |
| ACL-06.multi.GET-plan-conflict-overrides@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/conflict-overrides (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Schedule people” permission to do th |
| ACL-06.multi.GET-plan-attendance@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/attendance (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Schedule people” permission to do th |
| ACL-06.multi.GET-plan-runs@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/runs (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.multi.GET-plan-publication@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/publication (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Edit plans” permission to do that"," |
| ACL-06.multi.GET-plan-deliveries@AlphaCtx.API | multi | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/deliveries (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only schedulers and leaders can do that","code":"f |
| ACL-06.multi.GET-song@AlphaCtx.API | multi | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.multi.GET-song-schedule@AlphaCtx.API | multi | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.multi.GET-song-duplicates@AlphaCtx.API | multi | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/duplicates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.multi.GET-arrangement-materials@AlphaCtx.API | multi | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/materials (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Arrangement unavailable","code":"not_found"} |
| ACL-06.multi.GET-arrangement-chart@AlphaCtx.API | multi | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/chart (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | FAIL | sentinel in body=True; body={"chordpro":"{title: x}\n[C]QA20261113-BETA-SENTINEL-7f3a9c  |
| ACL-06.multi.GET-service-type-teams@AlphaCtx.API | multi | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/teams (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.multi.GET-service-type-access@AlphaCtx.API | multi | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only organization admins can do that","code":"forb |
| ACL-06.multi.GET-assignment-response-owner-history@AlphaCtx.API | multi | GET /assignments/511fc50d-82b2-4657-bc15-40872a71a095/response-owner-history (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Schedule people” permission to do th |
| ACL-06.multi.GET-member-eligibility@AlphaCtx.API | multi | GET /people/members/a368c31e-f7d6-4dc8-a8dc-612ac6c137b2/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| ACL-06.scoped.GET-person@AlphaCtx.API | scoped | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| ACL-06.scoped.GET-person-tags@AlphaCtx.API | scoped | GET /people/a30ebd6b-d0fc-41de-a4cc-93650d0919ea/tags (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| ACL-06.scoped.GET-team@AlphaCtx.API | scoped | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.scoped.GET-team-access@AlphaCtx.API | scoped | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only organization admins can do that","code":"forb |
| ACL-06.scoped.GET-team-candidates@AlphaCtx.API | scoped | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/candidates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.scoped.GET-team-policies@AlphaCtx.API | scoped | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/policies (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.scoped.GET-team-eligibility@AlphaCtx.API | scoped | GET /teams/a4898a71-746f-41f7-9ba9-96bb67e20c02/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Team not found","code":"not_found"} |
| ACL-06.scoped.GET-plan@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-schedule@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-notes@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/notes (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-conflict-overrides@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/conflict-overrides (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.scoped.GET-plan-attendance@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/attendance (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-runs@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/runs (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-publication@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/publication (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-plan-deliveries@AlphaCtx.API | scoped | GET /plans/08769c69-a4bc-430a-8a80-12b4dfdb3fdd/deliveries (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Plan not found","code":"not_found"} |
| ACL-06.scoped.GET-song@AlphaCtx.API | scoped | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93 (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.scoped.GET-song-schedule@AlphaCtx.API | scoped | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/schedule (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Song not found","code":"not_found"} |
| ACL-06.scoped.GET-song-duplicates@AlphaCtx.API | scoped | GET /songs/a735664f-b1b7-4408-a5d1-e81aeac37f93/duplicates (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.scoped.GET-arrangement-materials@AlphaCtx.API | scoped | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/materials (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Arrangement unavailable","code":"not_found"} |
| ACL-06.scoped.GET-arrangement-chart@AlphaCtx.API | scoped | GET /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55/chart (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 404 | PASS | sentinel in body=False; body={"error":"Arrangement not found","code":"not_found"} |
| ACL-06.scoped.GET-service-type-teams@AlphaCtx.API | scoped | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/teams (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.scoped.GET-service-type-access@AlphaCtx.API | scoped | GET /service-types/a54b3021-1b52-4e0b-b00a-a371764b7579/access (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only organization admins can do that","code":"forb |
| ACL-06.scoped.GET-assignment-response-owner-history@AlphaCtx.API | scoped | GET /assignments/511fc50d-82b2-4657-bc15-40872a71a095/response-owner-history (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 200 | PASS | sentinel in body=False; 200 indistinguishable from random UUID; body=[] |
| ACL-06.scoped.GET-member-eligibility@AlphaCtx.API | scoped | GET /people/members/a368c31e-f7d6-4dc8-a8dc-612ac6c137b2/eligibility (Beta ID) X-Org=Alpha | 400/403/404/or 200 identical to random-UUID response | 403 | PASS | sentinel in body=False; body={"error":"Only the organization owner can access personal de |
| AUTH-03.owner.GET-people@BetaHeader.API | owner | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-teams@BetaHeader.API | owner | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-plans@BetaHeader.API | owner | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-songs@BetaHeader.API | owner | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-service-types@BetaHeader.API | owner | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-search@BetaHeader.API | owner | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-access@BetaHeader.API | owner | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-notifications@BetaHeader.API | owner | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-schedule@BetaHeader.API | owner | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-reports@BetaHeader.API | owner | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-calendar@BetaHeader.API | owner | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-people@BetaQueryParam.API | owner | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.owner.GET-people@AlphaHeader+BetaQuery.API | owner | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 200 | PASS | sentinel in body=False |
| AUTH-03.legacy.GET-people@BetaHeader.API | legacy | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-teams@BetaHeader.API | legacy | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-plans@BetaHeader.API | legacy | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-songs@BetaHeader.API | legacy | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-service-types@BetaHeader.API | legacy | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-search@BetaHeader.API | legacy | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-access@BetaHeader.API | legacy | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-notifications@BetaHeader.API | legacy | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-schedule@BetaHeader.API | legacy | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-reports@BetaHeader.API | legacy | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-calendar@BetaHeader.API | legacy | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-people@BetaQueryParam.API | legacy | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.legacy.GET-people@AlphaHeader+BetaQuery.API | legacy | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 200 | PASS | sentinel in body=False |
| AUTH-03.scoped.GET-people@BetaHeader.API | scoped | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-teams@BetaHeader.API | scoped | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-plans@BetaHeader.API | scoped | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-songs@BetaHeader.API | scoped | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-service-types@BetaHeader.API | scoped | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-search@BetaHeader.API | scoped | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-access@BetaHeader.API | scoped | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-notifications@BetaHeader.API | scoped | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-schedule@BetaHeader.API | scoped | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-reports@BetaHeader.API | scoped | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-calendar@BetaHeader.API | scoped | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-people@BetaQueryParam.API | scoped | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.scoped.GET-people@AlphaHeader+BetaQuery.API | scoped | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 200 | PASS | sentinel in body=False |
| AUTH-03.member.GET-people@BetaHeader.API | member | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-teams@BetaHeader.API | member | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-plans@BetaHeader.API | member | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-songs@BetaHeader.API | member | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-service-types@BetaHeader.API | member | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-search@BetaHeader.API | member | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-access@BetaHeader.API | member | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-notifications@BetaHeader.API | member | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-schedule@BetaHeader.API | member | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-reports@BetaHeader.API | member | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-calendar@BetaHeader.API | member | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-people@BetaQueryParam.API | member | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of that organization","code": |
| AUTH-03.member.GET-people@AlphaHeader+BetaQuery.API | member | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 200 | PASS | sentinel in body=False |
| AUTH-03.inactive.GET-people@BetaHeader.API | inactive | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-teams@BetaHeader.API | inactive | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-plans@BetaHeader.API | inactive | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-songs@BetaHeader.API | inactive | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-service-types@BetaHeader.API | inactive | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-search@BetaHeader.API | inactive | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-access@BetaHeader.API | inactive | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-notifications@BetaHeader.API | inactive | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-schedule@BetaHeader.API | inactive | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-reports@BetaHeader.API | inactive | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-calendar@BetaHeader.API | inactive | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-people@BetaQueryParam.API | inactive | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.inactive.GET-people@AlphaHeader+BetaQuery.API | inactive | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 403 | PASS | sentinel in body=False |
| AUTH-03.newcomer.GET-people@BetaHeader.API | newcomer | GET /people X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-teams@BetaHeader.API | newcomer | GET /teams X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-plans@BetaHeader.API | newcomer | GET /plans X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-songs@BetaHeader.API | newcomer | GET /songs X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-service-types@BetaHeader.API | newcomer | GET /service-types X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-search@BetaHeader.API | newcomer | GET /search?q=SENTINEL X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-access@BetaHeader.API | newcomer | GET /access/members X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-notifications@BetaHeader.API | newcomer | GET /notifications X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-schedule@BetaHeader.API | newcomer | GET /schedule/mine X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-reports@BetaHeader.API | newcomer | GET /reports/summary X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-calendar@BetaHeader.API | newcomer | GET /calendar X-Org=Beta (not a member) | 403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-people@BetaQueryParam.API | newcomer | GET /people?organization_id=<Beta> (no header) | 400/403/404 | 403 | PASS | sentinel in body=False; body={"error":"You are not a member of any organization yet","cod |
| AUTH-03.newcomer.GET-people@AlphaHeader+BetaQuery.API | newcomer | GET /people?organization_id=<Beta> with X-Org=Alpha (header wins) | 200/403/404 | 403 | PASS | sentinel in body=False |
| AUTH-03.multi.header-missing.API | multi | GET /people with X-Org missing | 400 | 400 | PASS | body={"error":"Multiple organizations available — send an X-Organization-Id header","; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-empty.API | multi | GET /people with X-Org empty | 400 | 400 | PASS | body={"error":"Multiple organizations available — send an X-Organization-Id header","; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-garbage.API | multi | GET /people with X-Org garbage | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"}; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-random-uuid.API | multi | GET /people with X-Org random-uuid | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"}; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-sql-ish.API | multi | GET /people with X-Org sql-ish | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"}; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-two-orgs-csv.API | multi | GET /people with X-Org two-orgs-csv | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"}; ambiguous multi-org requires explicit header |
| AUTH-03.multi.header-uppercase-alpha.API | multi | GET /people with X-Org uppercase-alpha | 200/403/400/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"}; ambiguous multi-org requires explicit header |
| AUTH-03.owner.header-missing.API | owner | GET /people with X-Org missing | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.owner.header-empty.API | owner | GET /people with X-Org empty | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.owner.header-garbage.API | owner | GET /people with X-Org garbage | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.owner.header-random-uuid.API | owner | GET /people with X-Org random-uuid | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.owner.header-sql-ish.API | owner | GET /people with X-Org sql-ish | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.owner.header-two-orgs-csv.API | owner | GET /people with X-Org two-orgs-csv | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.owner.header-uppercase-alpha.API | owner | GET /people with X-Org uppercase-alpha | 200/403/400/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.member.header-missing.API | member | GET /people with X-Org missing | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.member.header-empty.API | member | GET /people with X-Org empty | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.member.header-garbage.API | member | GET /people with X-Org garbage | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.member.header-random-uuid.API | member | GET /people with X-Org random-uuid | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.member.header-sql-ish.API | member | GET /people with X-Org sql-ish | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.member.header-two-orgs-csv.API | member | GET /people with X-Org two-orgs-csv | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.member.header-uppercase-alpha.API | member | GET /people with X-Org uppercase-alpha | 200/403/400/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.legacy.header-missing.API | legacy | GET /people with X-Org missing | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.legacy.header-empty.API | legacy | GET /people with X-Org empty | 200 | 200 | PASS | body=[{"id":"e5cca57c-f261-4e68-a895-cc1021493900","person_id":"ed463cba-6a3b-4641-ba |
| AUTH-03.legacy.header-garbage.API | legacy | GET /people with X-Org garbage | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.legacy.header-random-uuid.API | legacy | GET /people with X-Org random-uuid | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.legacy.header-sql-ish.API | legacy | GET /people with X-Org sql-ish | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.legacy.header-two-orgs-csv.API | legacy | GET /people with X-Org two-orgs-csv | 400/403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.legacy.header-uppercase-alpha.API | legacy | GET /people with X-Org uppercase-alpha | 200/403/400/404 | 403 | PASS | body={"error":"You are not a member of that organization","code":"forbidden"} |
| AUTH-03.multi.switch-Alpha.API | multi | GET /plans, /people X-Org=Alpha | 200 | 200 | PASS | plans=2 sentinel-in-people=False (expected only in Beta? contacts must be redacted) |
| AUTH-03.multi.switch-Beta.API | multi | GET /plans, /people X-Org=Beta | 200 | 200 | PASS | plans=2 sentinel-in-people=False (expected only in Beta? contacts must be redacted) |
| AUTH-03.multi.Alpha-plans-have-no-Beta-plan.API | multi | GET /plans X-Org=Alpha | no Beta plan id | ok | PASS |  |
| AUTH-03.multi.Beta-people-private-redacted.API | multi (Beta member) | GET /people X-Org=Beta | no sentinel private fields | ok | PASS | body has names only? |
| AUTH-03.multi.Beta-person-detail-denied.API | multi (Beta ordinary member) | GET /people/<Beta sentinel person> X-Org=Beta | 403/404 | 403 | PASS | sentinel in body=False |
| ACL-06.owner.PATCH-person@AlphaCtx.API | owner | PATCH /people/<BetaPerson> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.POST-archive-person@AlphaCtx.API | owner | POST /people/<BetaPerson>/archive X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.DELETE-person@AlphaCtx.API | owner | DELETE /people/<BetaPerson> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.PUT-person-tags@AlphaCtx.API | owner | PUT /people/<BetaPerson>/tags X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.POST-invite-person@AlphaCtx.API | owner | POST /people/<BetaPerson>/invitations X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.PATCH-team@AlphaCtx.API | owner | PATCH /teams/<BetaTeam> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.DELETE-team@AlphaCtx.API | owner | DELETE /teams/21f74a20-a534-4b0c-88c9-c117d07da9d5 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.POST-team-position@AlphaCtx.API | owner | POST /teams/<BetaTeam>/positions X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 403 | PASS |  body={"error":"You do not have access to do that","code":"forbidden"} |
| ACL-06.owner.PUT-team-access@AlphaCtx.API | owner | PUT /teams/<BetaTeam>/access X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.PUT-team-tag-rules@AlphaCtx.API | owner | PUT /teams/<BetaTeam>/tag-rules X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Team not found","code":"not_found"} |
| ACL-06.owner.PATCH-plan@AlphaCtx.API | owner | PATCH /plans/<BetaPlan> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.DELETE-plan@AlphaCtx.API | owner | DELETE /plans/be2200dd-1dbb-4844-963f-14adc16d0606 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.POST-plan-item@AlphaCtx.API | owner | POST /plans/<BetaPlan>/items X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.DELETE-plan-item@AlphaCtx.API | owner | DELETE /plans/<BetaPlan>/items/7b43725f-602b-469c-862c-cff968870887 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.POST-plan-positions@AlphaCtx.API | owner | POST /plans/<BetaPlan>/positions X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.PATCH-song@AlphaCtx.API | owner | PATCH /songs/<BetaSong> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Song not found","code":"not_found"} |
| ACL-06.owner.DELETE-song@AlphaCtx.API | owner | DELETE /songs/<BetaSong> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.POST-song-archive@AlphaCtx.API | owner | POST /songs/<BetaSong>/archive X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 422 | PASS |  body={"error":"Invalid request body","code":"unprocessable","details":[{"path":"expected_revisi |
| ACL-06.owner.PATCH-arrangement@AlphaCtx.API | owner | PATCH /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Arrangement not found","code":"not_found"} |
| ACL-06.owner.DELETE-arrangement@AlphaCtx.API | owner | DELETE /arrangements/844be95b-c4e6-4df7-8cb5-1503736adc55 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.PATCH-service-type@AlphaCtx.API | owner | PATCH /service-types/<BetaST> X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.DELETE-service-type@AlphaCtx.API | owner | DELETE /service-types/e2062616-1d81-4c71-bd14-6240e2dc552c X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.PUT-service-type-teams@AlphaCtx.API | owner | PUT /service-types/<BetaST>/teams X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 200 | PASS | 2xx but no state change (RLS no-op, idempotent) body=[] |
| ACL-06.owner.PUT-service-type-access@AlphaCtx.API | owner | PUT /service-types/<BetaST>/access X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Not found","code":"not_found"} |
| ACL-06.owner.PATCH-assignment@AlphaCtx.API | owner | PATCH /assignments/511fc50d-82b2-4657-bc15-40872a71a095 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Assignment not found","code":"not_found"} |
| ACL-06.owner.DELETE-assignment@AlphaCtx.API | owner | DELETE /assignments/511fc50d-82b2-4657-bc15-40872a71a095 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.POST-assignment-respond@AlphaCtx.API | owner | POST /assignments/511fc50d-82b2-4657-bc15-40872a71a095/respond X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Assignment not found","code":"not_found"} |
| ACL-06.owner.POST-release-beta-plan@AlphaCtx.API | owner | POST /plans/<BetaPlan>/release X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.POST-notify-beta-plan@AlphaCtx.API | owner | POST /plans/<BetaPlan>/notify X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.POST-assignment-BetaPerson@AlphaCtx.API | owner | POST /plans/d24b6197-a3ae-487e-ae06-550c2f4900d2/assignments X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Conflict scope must name People, plans and times of this organization","code":"b |
| ACL-06.owner.POST-assignment-BetaTeam@AlphaCtx.API | owner | POST /plans/d24b6197-a3ae-487e-ae06-550c2f4900d2/assignments X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Conflict scope must name People, plans and times of this organization","code":"b |
| ACL-06.owner.POST-assignment-BetaPosition@AlphaCtx.API | owner | POST /plans/d24b6197-a3ae-487e-ae06-550c2f4900d2/assignments X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Some People, teams, positions or times do not belong to this plan","code":"bad_r |
| ACL-06.owner.POST-assignment-BetaTime@AlphaCtx.API | owner | POST /plans/d24b6197-a3ae-487e-ae06-550c2f4900d2/assignments X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Conflict scope must name People, plans and times of this organization","code":"b |
| ACL-06.owner.POST-plan-BetaServiceType@AlphaCtx.API | owner | POST /plans X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 201 | FAIL | 2xx AND STATE CHANGED (Beta changed=False, Alpha changed=True) body={"id":"ba8cfbca-3be4-451e-a5e0-3f48e34a34f0","organization_id":"999d8172 |
| ACL-06.owner.POST-plan-copy-BetaPlan@AlphaCtx.API | owner | POST /plans X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan to copy from not found","code":"not_found"} |
| ACL-06.owner.POST-duplicate-BetaPlan@AlphaCtx.API | owner | POST /plans/<BetaPlan>/duplicate X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan not found","code":"not_found"} |
| ACL-06.owner.POST-import-from-BetaPlan@AlphaCtx.API | owner | POST /plans/d24b6197-a3ae-487e-ae06-550c2f4900d2/import X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"Plan to copy from not found","code":"not_found"} |
| ACL-06.owner.POST-team-BetaServiceType@AlphaCtx.API | owner | POST /teams X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Referenced record does not exist","code":"bad_request","details":"Key (service_t |
| ACL-06.owner.POST-team-member-BetaPerson@AlphaCtx.API | owner | POST /teams/1e4935e8-a73e-4b1e-9d10-2de6e381ea4d/members X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"That Person is not in this organization","code":"bad_request"} |
| ACL-06.owner.POST-team-member-BetaTeam@AlphaCtx.API | owner | POST /teams/<BetaTeam>/members X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"That Person does not belong to this organization","code":"bad_request"} |
| ACL-06.owner.PUT-org-grants-BetaUser@AlphaCtx.API | owner | PUT /access/organization X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 400 | PASS |  body={"error":"Every grant needs an active member of this organization","code":"bad_request"} |
| ACL-06.owner.PATCH-BetaOrg@AlphaCtx.API | owner | PATCH /organizations/6c0edd3d-439b-4696-96dd-0688cc039241 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 403 | PASS |  body={"error":"Only organization admins can change settings","code":"forbidden"} |
| ACL-06.owner.PATCH-BetaMemberRole@AlphaCtx.API | owner | PATCH /people/members/a368c31e-f7d6-4dc8-a8dc-612ac6c137b2 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 404 | PASS |  body={"error":"That person is not in this organization","code":"not_found"} |
| ACL-06.owner.DELETE-BetaMember@AlphaCtx.API | owner | DELETE /people/members/a368c31e-f7d6-4dc8-a8dc-612ac6c137b2 X-Org=Alpha | 400/403/404/409/422/2xx only if no state change | 204 | PASS | 2xx but no state change (RLS no-op, idempotent) body= |
| ACL-06.owner.PATCH-person@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-archive-person@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-person@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PUT-person-tags@BetaHeader.API | owner | PUT … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-invite-person@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-team@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-team@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-team-position@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PUT-team-access@BetaHeader.API | owner | PUT … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PUT-team-tag-rules@BetaHeader.API | owner | PUT … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-plan@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-plan@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-plan-item@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-plan-item@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-plan-positions@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-song@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-song@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-song-archive@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-arrangement@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-arrangement@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-service-type@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-service-type@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PUT-service-type-teams@BetaHeader.API | owner | PUT … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PUT-service-type-access@BetaHeader.API | owner | PUT … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.PATCH-assignment@BetaHeader.API | owner | PATCH … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.DELETE-assignment@BetaHeader.API | owner | DELETE … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-assignment-respond@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-release-beta-plan@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-notify-beta-plan@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.owner.POST-assignment-BetaPerson@BetaHeader.API | owner | POST … X-Org=Beta (not a member) | 403/404 | 403 | PASS | body={"error":"You are not a member of that organization","code": |
| ACL-06.multi.PATCH-person@AlphaCtx.API | multi (member in both orgs, ordinary) | PATCH … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.POST-archive-person@AlphaCtx.API | multi (member in both orgs, ordinary) | POST … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.DELETE-person@AlphaCtx.API | multi (member in both orgs, ordinary) | DELETE … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.PUT-person-tags@AlphaCtx.API | multi (member in both orgs, ordinary) | PUT … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.POST-invite-person@AlphaCtx.API | multi (member in both orgs, ordinary) | POST … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only the organization owner can access personal de |
| ACL-06.multi.PATCH-team@AlphaCtx.API | multi (member in both orgs, ordinary) | PATCH … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage teams” permission to do that" |
| ACL-06.multi.DELETE-team@AlphaCtx.API | multi (member in both orgs, ordinary) | DELETE … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage teams” permission to do that" |
| ACL-06.multi.POST-team-position@AlphaCtx.API | multi (member in both orgs, ordinary) | POST … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage teams” permission to do that" |
| ACL-06.multi.PUT-team-access@AlphaCtx.API | multi (member in both orgs, ordinary) | PUT … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"Only organization admins can do that","code":"forb |
| ACL-06.multi.PUT-team-tag-rules@AlphaCtx.API | multi (member in both orgs, ordinary) | PUT … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage teams” permission to do that" |
| ACL-06.multi.PATCH-plan@AlphaCtx.API | multi (member in both orgs, ordinary) | PATCH … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Edit plans” permission to do that"," |
| ACL-06.multi.DELETE-plan@AlphaCtx.API | multi (member in both orgs, ordinary) | DELETE … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Edit plans” permission to do that"," |
| ACL-06.multi.PATCH-song@AlphaCtx.API | multi (member in both orgs, ordinary) | PATCH … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.multi.DELETE-song@AlphaCtx.API | multi (member in both orgs, ordinary) | DELETE … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.multi.POST-song-archive@AlphaCtx.API | multi (member in both orgs, ordinary) | POST … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.multi.PATCH-arrangement@AlphaCtx.API | multi (member in both orgs, ordinary) | PATCH … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.multi.DELETE-arrangement@AlphaCtx.API | multi (member in both orgs, ordinary) | DELETE … (Beta id) X-Org=Alpha | 400/403/404/409/422 | 403 | PASS | body={"error":"You need the “Manage songs” permission to do that" |
| ACL-06.persisted.Beta-state-unchanged.API | owner/multi | betaowner re-snapshot (people,teams,plans,songs,service types, details) | unchanged | unchanged | PASS |  |
| ACL-06.persisted.Alpha-state-unchanged-no-Beta-content.API | owner | owner re-snapshot Alpha plans/teams/songs/service types | unchanged, no sentinel | unchanged | PASS |  |
| ACL-06.owner.search-SENTINEL@AlphaCtx.API | owner | GET /search?q=SENTINEL X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.owner.search-Sentinel@AlphaCtx.API | owner | GET /search?q=Sentinel X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.owner.search-Shared_Song@AlphaCtx.API | owner | GET /search?q=Shared Song X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=233 |
| ACL-06.owner.search-Band@AlphaCtx.API | owner | GET /search?q=Band X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=470 |
| ACL-06.owner.search-Sunday@AlphaCtx.API | owner | GET /search?q=Sunday X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=245 |
| ACL-06.owner.search-BetaPerson@AlphaCtx.API | owner | GET /search?q=BetaPerson X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.owner.search-example.test@AlphaCtx.API | owner | GET /search?q=example.test X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=1104 |
| ACL-06.owner.search-QA20261113@AlphaCtx.API | owner | GET /search?q=QA20261113 X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=1102 |
| ACL-06.owner.search-Lead@AlphaCtx.API | owner | GET /search?q=Lead X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=641 |
| ACL-06.legacy.search-SENTINEL@AlphaCtx.API | legacy | GET /search?q=SENTINEL X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.legacy.search-Sentinel@AlphaCtx.API | legacy | GET /search?q=Sentinel X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.legacy.search-Shared_Song@AlphaCtx.API | legacy | GET /search?q=Shared Song X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=233 |
| ACL-06.legacy.search-Band@AlphaCtx.API | legacy | GET /search?q=Band X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=436 |
| ACL-06.legacy.search-Sunday@AlphaCtx.API | legacy | GET /search?q=Sunday X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=245 |
| ACL-06.legacy.search-BetaPerson@AlphaCtx.API | legacy | GET /search?q=BetaPerson X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.legacy.search-example.test@AlphaCtx.API | legacy | GET /search?q=example.test X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=36 |
| ACL-06.legacy.search-QA20261113@AlphaCtx.API | legacy | GET /search?q=QA20261113 X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.legacy.search-Lead@AlphaCtx.API | legacy | GET /search?q=Lead X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=607 |
| ACL-06.member.search-SENTINEL@AlphaCtx.API | member | GET /search?q=SENTINEL X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.member.search-Sentinel@AlphaCtx.API | member | GET /search?q=Sentinel X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.member.search-Shared_Song@AlphaCtx.API | member | GET /search?q=Shared Song X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=233 |
| ACL-06.member.search-Band@AlphaCtx.API | member | GET /search?q=Band X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=436 |
| ACL-06.member.search-Sunday@AlphaCtx.API | member | GET /search?q=Sunday X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=245 |
| ACL-06.member.search-BetaPerson@AlphaCtx.API | member | GET /search?q=BetaPerson X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.member.search-example.test@AlphaCtx.API | member | GET /search?q=example.test X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=36 |
| ACL-06.member.search-QA20261113@AlphaCtx.API | member | GET /search?q=QA20261113 X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.member.search-Lead@AlphaCtx.API | member | GET /search?q=Lead X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=607 |
| ACL-06.scoped.search-SENTINEL@AlphaCtx.API | scoped | GET /search?q=SENTINEL X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.scoped.search-Sentinel@AlphaCtx.API | scoped | GET /search?q=Sentinel X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.scoped.search-Shared_Song@AlphaCtx.API | scoped | GET /search?q=Shared Song X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=233 |
| ACL-06.scoped.search-Band@AlphaCtx.API | scoped | GET /search?q=Band X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=436 |
| ACL-06.scoped.search-Sunday@AlphaCtx.API | scoped | GET /search?q=Sunday X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=245 |
| ACL-06.scoped.search-BetaPerson@AlphaCtx.API | scoped | GET /search?q=BetaPerson X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.scoped.search-example.test@AlphaCtx.API | scoped | GET /search?q=example.test X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=36 |
| ACL-06.scoped.search-QA20261113@AlphaCtx.API | scoped | GET /search?q=QA20261113 X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.scoped.search-Lead@AlphaCtx.API | scoped | GET /search?q=Lead X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=607 |
| ACL-06.multi.search-SENTINEL@AlphaCtx.API | multi | GET /search?q=SENTINEL X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.multi.search-Sentinel@AlphaCtx.API | multi | GET /search?q=Sentinel X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=32 |
| ACL-06.multi.search-Shared_Song@AlphaCtx.API | multi | GET /search?q=Shared Song X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=233 |
| ACL-06.multi.search-Band@AlphaCtx.API | multi | GET /search?q=Band X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=436 |
| ACL-06.multi.search-Sunday@AlphaCtx.API | multi | GET /search?q=Sunday X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=245 |
| ACL-06.multi.search-BetaPerson@AlphaCtx.API | multi | GET /search?q=BetaPerson X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.multi.search-example.test@AlphaCtx.API | multi | GET /search?q=example.test X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=36 |
| ACL-06.multi.search-QA20261113@AlphaCtx.API | multi | GET /search?q=QA20261113 X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=34 |
| ACL-06.multi.search-Lead@AlphaCtx.API | multi | GET /search?q=Lead X-Org=Alpha | 200 | 200 | PASS | sentinel=False; Beta ids in response=0; len=607 |
| ACL-06.multi.search-SENTINEL@BetaCtx.API | multi (Beta ordinary member) | GET /search?q=SENTINEL X-Org=Beta | 200 | 200 | PASS | Alpha ids in response=0; sentinel private phone/email=False |
| ACL-06.multi.search-Shared_Song@BetaCtx.API | multi (Beta ordinary member) | GET /search?q=Shared Song X-Org=Beta | 200 | 200 | PASS | Alpha ids in response=0; sentinel private phone/email=False |
| AUTH-03.multi.notifications-Beta-has-item.API | multi | GET /notifications X-Org=Beta | 200 | 200 | PASS | Beta notifications=1 |
| AUTH-03.multi.notifications-Alpha-excludes-Beta.API | multi | GET /notifications X-Org=Alpha | no Beta item | ok | PASS | alpha items=0 |
| AUTH-03.multi.notification-detail-Beta-id@AlphaCtx.API | multi | GET /notifications/<Beta notif> X-Org=Alpha | 403/404 | 404 | PASS | {"error":"Notification not found","code":"not_found"} |
| AUTH-03.multi.notification-detail-Beta-id@BetaCtx.API | multi | GET /notifications/<Beta notif> X-Org=Beta | 200 | 200 | PASS |  |
| AUTH-03.multi.mark-read-Beta-notif@AlphaCtx.API | multi | POST /notifications/read {ids:[Beta notif]} X-Org=Alpha | no-op or 4xx; Beta notif stays unread | 200 | PASS | Beta unread still contains it=True |
| AUTH-03.multi.schedule-mine-Alpha-excludes-Beta.API | multi | GET /schedule/mine X-Org=Alpha | no Beta assignment | ok | PASS | rows=0 |
| AUTH-03.multi.schedule-mine-Beta-includes-own.API | multi | GET /schedule/mine X-Org=Beta | 200 | 200 | PASS | rows=1 |
| ACL-06.owner.atomic-batch-one-foreign-person.API | owner | POST /plans/<Midweek>/assignments [Alpha member, Beta person] | 400/403/404/409/422 | 400 | PASS | assignments before=0 after=0; body={"error":"Conflict scope must name People, plans and times of this organization" |
| AUTH-03.anonymous.GET-people.API | anonymous | GET /people no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-teams.API | anonymous | GET /teams no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-plans.API | anonymous | GET /plans no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-songs.API | anonymous | GET /songs no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-service-types.API | anonymous | GET /service-types no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-search.API | anonymous | GET /search?q=Sunday no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-access.API | anonymous | GET /access/me no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-notifications.API | anonymous | GET /notifications no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-schedule.API | anonymous | GET /schedule/mine no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.POST-plans.API | anonymous | POST /plans no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.POST-people.API | anonymous | POST /people no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-me.API | anonymous | GET /me no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-organizations.API | anonymous | GET /organizations no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.PATCH-organizations.API | anonymous | PATCH /organizations/999d8172-44f1-42af-aaec-72dfbf431ee9 no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-reports.API | anonymous | GET /reports/summary no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-files.API | anonymous | GET /files no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.GET-songbooks.API | anonymous | GET /songbooks no token | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-03.anonymous.invalid-JWT.API | anonymous (garbage bearer) | GET /people | 401 | 401 | PASS | {"error":"Invalid or expired session","code":"unauthorized"} |
| AUTH-03.anonymous.anon-key-as-bearer.API | anonymous (anon API key as bearer) | GET /people | 401 | 401 | PASS | {"error":"Invalid or expired session","code":"unauthorized"} |
| AUTH-03.newcomer.GET-people@AlphaHeader.API | newcomer | GET /people X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-teams@AlphaHeader.API | newcomer | GET /teams X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-plans@AlphaHeader.API | newcomer | GET /plans X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-songs@AlphaHeader.API | newcomer | GET /songs X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-service-types@AlphaHeader.API | newcomer | GET /service-types X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-search@AlphaHeader.API | newcomer | GET /search?q=Sunday X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-access@AlphaHeader.API | newcomer | GET /access/me X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-notifications@AlphaHeader.API | newcomer | GET /notifications X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-schedule@AlphaHeader.API | newcomer | GET /schedule/mine X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.POST-plans@AlphaHeader.API | newcomer | POST /plans X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.POST-people@AlphaHeader.API | newcomer | POST /people X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.PATCH-organizations@AlphaHeader.API | newcomer | PATCH /organizations/999d8172-44f1-42af-aaec-72dfbf431ee9 X-Org=Alpha | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| AUTH-03.newcomer.GET-reports@AlphaHeader.API | newcomer | GET /reports/summary X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-files@AlphaHeader.API | newcomer | GET /files X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-songbooks@AlphaHeader.API | newcomer | GET /songbooks X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-people-noheader.API | newcomer | GET /people (no header) | 403 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-people@AlphaHeader.API | inactive | GET /people X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-teams@AlphaHeader.API | inactive | GET /teams X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-plans@AlphaHeader.API | inactive | GET /plans X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-songs@AlphaHeader.API | inactive | GET /songs X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-service-types@AlphaHeader.API | inactive | GET /service-types X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-search@AlphaHeader.API | inactive | GET /search?q=Sunday X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-access@AlphaHeader.API | inactive | GET /access/me X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-notifications@AlphaHeader.API | inactive | GET /notifications X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-schedule@AlphaHeader.API | inactive | GET /schedule/mine X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.POST-plans@AlphaHeader.API | inactive | POST /plans X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.POST-people@AlphaHeader.API | inactive | POST /people X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.PATCH-organizations@AlphaHeader.API | inactive | PATCH /organizations/999d8172-44f1-42af-aaec-72dfbf431ee9 X-Org=Alpha | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","code":"forbidden"} |
| AUTH-03.inactive.GET-reports@AlphaHeader.API | inactive | GET /reports/summary X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-files@AlphaHeader.API | inactive | GET /files X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-songbooks@AlphaHeader.API | inactive | GET /songbooks X-Org=Alpha | 403/404 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.inactive.GET-people-noheader.API | inactive | GET /people (no header) | 403 | 403 | PASS | {"error":"You are not a member of any organization yet","code":"forbidden"} |
| AUTH-03.newcomer.GET-organizations-empty.API | newcomer | GET /organizations | 200 | 200 | PASS | [] |
| AUTH-03.inactive.GET-organizations-excludes-Alpha.API | inactive | GET /organizations | 200 | 200 | PASS | [] |
| AUTH-03.inactive.GET-me-no-Alpha-membership.API | inactive | GET /me | 200 | 200 | PASS | Alpha in memberships=False |
| AUTH-02.newcomer.create-org-duplicate-slug.API | newcomer | POST /organizations duplicate slug | 409 | 409 | PASS | {"error":"That URL slug is already taken","code":"conflict"} |
| AUTH-02.newcomer.create-org-invalid-slug.API | newcomer | POST /organizations slug "Bad Slug!" | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"path":"slug" |
| AUTH-02.newcomer.create-org-empty-name.API | newcomer | POST /organizations empty name | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name" |
| AUTH-02.newcomer.create-org-short-slug.API | newcomer | POST /organizations 1-char slug | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"path":"slug" |
| AUTH-02.anonymous.create-org.API | anonymous | POST /organizations | 401 | 401 | PASS | {"error":"Missing bearer token","code":"unauthorized"} |
| AUTH-02.owner.PATCH-organization.API | owner | PATCH /organizations/<Alpha> city,timezone | 200 | 200 | PASS | persisted city=QA City tz=America/Vancouver |
| AUTH-02.admin.PATCH-organization.API | admin | PATCH /organizations/<Alpha> | 200 | 200 | PASS | {"id":"999d8172-44f1-42af-aaec-72dfbf431 |
| AUTH-02.owner.PATCH-organization-invalid-timezone.API | owner | PATCH timezone invalid | 400/422 | 200 | FAIL | OBSERVATION if 200: {"id":"999d8172-44f1-42af-aaec-72dfbf431ee9","name":"QA API  |
| AUTH-02.legacy.PATCH-organization.API | legacy | PATCH /organizations/<Alpha> | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","cod |
| AUTH-02.member.PATCH-organization.API | member | PATCH /organizations/<Alpha> | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","cod |
| AUTH-02.scoped.PATCH-organization.API | scoped | PATCH /organizations/<Alpha> | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","cod |
| AUTH-02.alpha-scheduler.PATCH-Beta-organization.API | legacy | PATCH /organizations/<Beta> | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","cod |
| AUTH-02.alpha-owner.PATCH-Beta-organization.API | owner (Alpha) | PATCH /organizations/<Beta> | 403/404 | 403 | PASS | {"error":"Only organization admins can change settings","cod |
| AUTH-02.persisted.Beta-org-unchanged.API | owner(Alpha)/legacy | betaowner GET /organizations | city None, name unchanged | city=None | PASS | name=QA API Beta |
| AUTH-03.owner.GET-organizations-only-own.API | owner | GET /organizations | only Alpha | ok | PASS |  |
| AUTH-03.multi.GET-organizations-both.API | multi | GET /organizations | Alpha+Beta only | ok | PASS |  |
| ACL-05.owner.create-prepared-assignment.API | owner | POST /plans/<Sunday>/assignments visibility=prepared | 201 | 201 | PASS | {"created":[{"id":"bd92abe2-0c4e-46f5-bc59-2bddf5b95288","plan_id":"d24b6197-a3ae-487e-ae06-550c2f49 |
| ACL-05.owner.prepared-row-visibility-field.API | owner | response of create | visibility=prepared | prepared | PASS |  |
| ACL-05.member.prepared.schedule/mine.API | member | schedule/mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.notifications.API | member | notifications | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.plan-detail.API | member | plan-detail | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.plan-schedule.API | member | plan-schedule | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.calendar-mine.API | member | calendar-mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.plans-mine.API | member | plans-mine | absent | present (HTTP 200) | NOT_APPLICABLE | GET /plans has no `mine` filter (listPlansQuerySchema); param ignored -> probe invalid. Covered by calendar-mine and schedule/mine |
| ACL-05.member.prepared.db-assignments-select.API | member | db-assignments-select | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.db-assignments-plan.API | member | db-assignments-plan | absent | absent (HTTP 200) | PASS |  |
| ACL-05.member.prepared.unread-count.API | member | GET /notifications/unread-count | 0 | {'unread': 0, 'account_unread': 0} | PASS |  |
| ACL-05.member.prepared.respond-denied.API | member | POST /assignments/<prepared>/respond | 403/404/409 | 404 | PASS | {"error":"Assignment not found","code":"not_found"} |
| ACL-05.member.prepared.respond-no-change.API | member | owner GET plan | still unconfirmed & prepared | unconfirmed/prepared | PASS |  |
| ACL-05.peoplegrant.prepared.schedule/mine.API | peoplegrant | schedule/mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.notifications.API | peoplegrant | notifications | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.plan-detail.API | peoplegrant | plan-detail | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.plan-schedule.API | peoplegrant | plan-schedule | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.calendar-mine.API | peoplegrant | calendar-mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.plans-mine.API | peoplegrant | plans-mine | absent | present (HTTP 200) | NOT_APPLICABLE | GET /plans has no `mine` filter (listPlansQuerySchema); param ignored -> probe invalid. Covered by calendar-mine and schedule/mine |
| ACL-05.peoplegrant.prepared.db-assignments-select.API | peoplegrant | db-assignments-select | absent | absent (HTTP 200) | PASS |  |
| ACL-05.peoplegrant.prepared.db-assignments-plan.API | peoplegrant | db-assignments-plan | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.schedule/mine.API | multi | schedule/mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.notifications.API | multi | notifications | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.plan-detail.API | multi | plan-detail | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.plan-schedule.API | multi | plan-schedule | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.calendar-mine.API | multi | calendar-mine | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.plans-mine.API | multi | plans-mine | absent | present (HTTP 200) | NOT_APPLICABLE | GET /plans has no `mine` filter (listPlansQuerySchema); param ignored -> probe invalid. Covered by calendar-mine and schedule/mine |
| ACL-05.multi.prepared.db-assignments-select.API | multi | db-assignments-select | absent | absent (HTTP 200) | PASS |  |
| ACL-05.multi.prepared.db-assignments-plan.API | multi | db-assignments-plan | absent | absent (HTTP 200) | PASS |  |
| ACL-05.owner.prepared.manager-sees-in-plan.API | owner | GET /plans/<Sunday> | present | present | PASS | HTTP 200 |
| ACL-05.legacy.prepared.manager-sees-in-plan.API | legacy | GET /plans/<Sunday> | present | present | PASS | HTTP 200 |
| ACL-05.admin.prepared.manager-sees-in-plan.API | admin | GET /plans/<Sunday> | present | present | PASS | HTTP 200 |
| ACL-05.bandlead.prepared.managed-scope-sees.API | band-lead (scheduling.manage Band) | GET /plans/<Sunday> | present | present | PASS | HTTP 200 |
| ACL-05.scoped.prepared.managed-scope-sees.API | scoped (scheduling.manage Sunday) | GET /plans/<Sunday> | present | present | PASS | HTTP 200 |
| ACL-05.owner.release-batch-with-foreign-assignment.API | owner | POST /plans/<Sunday>/release [own prepared, Beta assignment] | 400/404/409/422 | 409 | PASS | own assignment visibility after=prepared |
| ACL-05.member.release-denied.API | member | POST /plans/<Sunday>/release | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do that","code":"forbidde |
| ACL-05.bandlead.release-in-managed-scope.API | band-lead (scheduling.manage Band) | POST /plans/<Sunday>/release (Band assignment, notify=false) | 200 | 200 | PASS | released by band-lead (managed scope) - allowed |
| ACL-05.owner.release.API | owner | POST /plans/<Sunday>/release notify=true | 200 | 200 | PASS | {"released":[{"id":"0eca6046-ad9f-4806-9f7c-c610eea6d635","plan_id":"d24b6197-a3ae-487e-ae06-550c2f4 |
| ACL-05.owner.release-persisted.API | owner | GET plan | released | released | PASS |  |
| ACL-05.member.after-release.schedule/mine.API | member | schedule/mine | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.notifications.API | member | notifications | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.plan-detail.API | member | plan-detail | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.plan-schedule.API | member | plan-schedule | present | absent (HTTP 200) | NOT_APPLICABLE | GET /plans/:id/schedule is the running-order timing view; it does not list assignments, probe invalid. Plan-detail probe covers the assignme |
| ACL-05.member.after-release.calendar-mine.API | member | calendar-mine | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.plans-mine.API | member | plans-mine | present | present (HTTP 200) | NOT_APPLICABLE | GET /plans has no `mine` filter (listPlansQuerySchema); param ignored -> probe invalid. Covered by calendar-mine and schedule/mine |
| ACL-05.member.after-release.db-assignments-select.API | member | db-assignments-select | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.db-assignments-plan.API | member | db-assignments-plan | present | present (HTTP 200) | PASS |  |
| ACL-05.member.after-release.notification.API | member | GET /notifications after release | >=1 notification | 1 | PASS |  |
| ACL-05.member.after-release.unread-count.API | member | GET /notifications/unread-count | >=1 | {'unread': 1, 'account_unread': 1} | PASS |  |
| ACL-05.peoplegrant.after-release.schedule-excludes-others.API | peoplegrant | GET /schedule/mine | absent | absent | PASS |  |
| ACL-05.member.after-release.respond-own.API | member | POST /assignments/<released>/respond | 200 | 200 | PASS | {"id":"0eca6046-ad9f-4806-9f7c-c610eea6d635","plan_id":"d24b6197-a3ae- |
| ACL-01.member.no-grant.plans.edit.functional.API | member (no grants) | functional probe for plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that","code":"for |
| ACL-01.member.no-grant.scheduling.manage.functional.API | member (no grants) | functional probe for scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do that","code" |
| ACL-01.member.no-grant.teams.manage.functional.API | member (no grants) | functional probe for teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that","code":"f |
| ACL-01.member.no-grant.songs.manage.functional.API | member (no grants) | functional probe for songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that","code":"f |
| ACL-01.member.no-grant.people.manage.functional.API | member (no grants) | functional probe for people.manage | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or m |
| ACL-01.member.no-grant.people.view_private.functional.API | member (no grants) | functional probe for people.view_private | 403/404 | 403 | PASS | {"error":"Only the organization owner can access personal details or m |
| ACL-01.member.alone.plans.edit.functional.API | member + plans.edit only (org scope) | functional probe for plans.edit | 200/201 | 200 | PASS | {"id":"40952e24-a49d-44ce-903e-9d3019b9bd4a","organization_id":"999d81 |
| ACL-01.member.alone.plans.edit.not-implies.scheduling.manage.API | member + plans.edit only | probe scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do th |
| ACL-01.member.alone.plans.edit.not-implies.teams.manage.API | member + plans.edit only | probe teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that" |
| ACL-01.member.alone.plans.edit.not-implies.songs.manage.API | member + plans.edit only | probe songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that" |
| ACL-01.member.revoked.plans.edit.functional.API | member (grant revoked, same token) | functional probe for plans.edit | 403/404 | 403 | PASS |  |
| ACL-01.member.alone.scheduling.manage.functional.API | member + scheduling.manage only (org scope) | functional probe for scheduling.manage | 200/201 | 201 | PASS | {"created":[{"id":"844475b4-8ec4-4473-beb6-69480eaa2130","plan_id":"40 |
| ACL-01.member.alone.scheduling.manage.not-implies.plans.edit.API | member + scheduling.manage only | probe plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that"," |
| ACL-01.member.alone.scheduling.manage.not-implies.teams.manage.API | member + scheduling.manage only | probe teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that" |
| ACL-01.member.alone.scheduling.manage.not-implies.songs.manage.API | member + scheduling.manage only | probe songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that" |
| ACL-01.member.revoked.scheduling.manage.functional.API | member (grant revoked, same token) | functional probe for scheduling.manage | 403/404 | 403 | PASS |  |
| ACL-01.member.alone.teams.manage.functional.API | member + teams.manage only (org scope) | functional probe for teams.manage | 200/201 | 200 | PASS | {"id":"826f93d2-850c-415f-b9f4-8d0b6fb71c4b","organization_id":"999d81 |
| ACL-01.member.alone.teams.manage.not-implies.plans.edit.API | member + teams.manage only | probe plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that"," |
| ACL-01.member.alone.teams.manage.not-implies.scheduling.manage.API | member + teams.manage only | probe scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do th |
| ACL-01.member.alone.teams.manage.not-implies.songs.manage.API | member + teams.manage only | probe songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that" |
| ACL-01.member.revoked.teams.manage.functional.API | member (grant revoked, same token) | functional probe for teams.manage | 403/404 | 403 | PASS |  |
| ACL-01.member.alone.songs.manage.functional.API | member + songs.manage only (org scope) | functional probe for songs.manage | 200/201 | 201 | PASS | {"id":"90e960c9-4bf3-44da-891b-1d71621a6602","organization_id":"999d81 |
| ACL-01.member.alone.songs.manage.not-implies.plans.edit.API | member + songs.manage only | probe plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that"," |
| ACL-01.member.alone.songs.manage.not-implies.scheduling.manage.API | member + songs.manage only | probe scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do th |
| ACL-01.member.alone.songs.manage.not-implies.teams.manage.API | member + songs.manage only | probe teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that" |
| ACL-01.member.revoked.songs.manage.functional.API | member (grant revoked, same token) | functional probe for songs.manage | 403/404 | 403 | PASS |  |
| ACL-01.member.alone.people.manage.functional.API | member + people.manage only (org scope) | functional probe for people.manage | 403/404 | 403 | PASS | People remain owner-only despite grant: {"error":"Only the organization owner can access personal de |
| ACL-01.member.alone.people.manage.not-implies.plans.edit.API | member + people.manage only | probe plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that"," |
| ACL-01.member.alone.people.manage.not-implies.scheduling.manage.API | member + people.manage only | probe scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do th |
| ACL-01.member.alone.people.manage.not-implies.teams.manage.API | member + people.manage only | probe teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that" |
| ACL-01.member.alone.people.manage.not-implies.songs.manage.API | member + people.manage only | probe songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that" |
| ACL-01.member.revoked.people.manage.functional.API | member (grant revoked, same token) | functional probe for people.manage | 403/404 | 403 | PASS |  |
| ACL-01.member.alone.people.view_private.functional.API | member + people.view_private only (org scope) | functional probe for people.view_private | 403/404 | 403 | PASS | People remain owner-only despite grant: {"error":"Only the organization owner can access personal de |
| ACL-01.member.alone.people.view_private.not-implies.plans.edit.API | member + people.view_private only | probe plans.edit | 403/404 | 403 | PASS | {"error":"You need the “Edit plans” permission to do that"," |
| ACL-01.member.alone.people.view_private.not-implies.scheduling.manage.API | member + people.view_private only | probe scheduling.manage | 403/404 | 403 | PASS | {"error":"You need the “Schedule people” permission to do th |
| ACL-01.member.alone.people.view_private.not-implies.teams.manage.API | member + people.view_private only | probe teams.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission to do that" |
| ACL-01.member.alone.people.view_private.not-implies.songs.manage.API | member + people.view_private only | probe songs.manage | 403/404 | 403 | PASS | {"error":"You need the “Manage songs” permission to do that" |
| ACL-01.member.revoked.people.view_private.functional.API | member (grant revoked, same token) | functional probe for people.view_private | 403/404 | 403 | PASS |  |
| ACL-01.member.people-manage-no-person-created.API | member + people.manage | owner GET /people | no ShouldNotExist | ok | PASS |  |
| ACL-03.legacy.guests-create-scheduler-feature.API | legacy | POST /people/guests (roster router: allowed for scheduling.manage by design) | 201 | 201 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"id":"eed8a73d-67e8-4ed6-9290-6c17c39a2271","person_id":"eed8a73d-67e |
| ACL-03.admin.guests-create-scheduler-feature.API | admin | POST /people/guests (roster router: allowed for scheduling.manage by design) | 201 | 201 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"id":"ee88b679-2571-4b64-9a07-226148c25965","person_id":"ee88b679-257 |
| ACL-03.member.guests-create-scheduler-feature.API | member | POST /people/guests (roster router: allowed for scheduling.manage by design) | 403 | 403 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.peoplegrant.guests-create-scheduler-feature.API | peoplegrant | POST /people/guests (roster router: allowed for scheduling.manage by design) | 403 | 403 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"error":"You do not have access to do that","code":"forbidden"} |
| ACL-03.bandlead.guests-create-scheduler-feature.API | bandlead | POST /people/guests (roster router: allowed for scheduling.manage by design) | 201 | 201 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"id":"7015bdaa-4b6b-419d-9b7d-7b65f8969bfa","person_id":"7015bdaa-4b6 |
| ACL-03.scoped.guests-create-scheduler-feature.API | scoped | POST /people/guests (roster router: allowed for scheduling.manage by design) | 201 | 201 | PASS | OBSERVATION: scheduler guest creation creates a no-login Person; {"id":"8ec78fee-0c01-4814-b0d0-f50b9e631e60","person_id":"8ec78fee-0c0 |
| PEOPLE-01.owner.create-minimal.API | owner | POST /people {first_name only, padded} | 201 | 201 | PASS | first_name='Min' |
| PEOPLE-01.owner.create-complete.API | owner | POST /people complete | 201 | 201 | PASS | {"id":"e9103902-63f1-410a-91a5-4d4cadd240cb","organization_i |
| PEOPLE-01.owner.detail-consistent.API | owner | GET /people/<new> | email lowercased; fields persisted | ok | PASS |  |
| PEOPLE-01.owner.list-consistent.API | owner | GET /people list row vs detail | same email/phone/campus | ok | PASS |  |
| PEOPLE-01.owner.validation-empty-first-name.API | owner | POST /people empty-first-name | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-missing-first-name.API | owner | POST /people missing-first-name | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-bad-email.API | owner | POST /people bad-email | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-bad-gender.API | owner | POST /people bad-gender | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-bad-date.API | owner | POST /people bad-date | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-first-name-81.API | owner | POST /people first-name-81 | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-first-name-80.API | owner | POST /people first-name-80 | 201 | 201 | PASS | {"id":"30107549-1ccb-4a4e-a08c-d33e8a815d7f","organization_id":"999d81 |
| PEOPLE-01.owner.validation-bad-person-type.API | owner | POST /people bad-person-type | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-bad-language.API | owner | POST /people bad-language | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-bad-avatar-url.API | owner | POST /people bad-avatar-url | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.validation-unknown-field.API | owner | POST /people unknown-field | 201/400/422 | 201 | PASS | {"id":"5a204b91-e705-4831-936c-ad1cc25b7bca","organization_id":"999d81 ; organization_id=999d8172-44f1-42af-aaec-72dfbf431ee9 |
| PEOPLE-01.owner.validation-medical-note-2001.API | owner | POST /people medical-note-2001 | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","details":[{"pa |
| PEOPLE-01.owner.duplicate-email.API | owner | POST /people duplicate email of existing Person | 201/409 | 201 | PASS | OBSERVATION: duplicate email policy -> 201 |
| PEOPLE-01.owner.edit-clear-fields.API | owner | PATCH /people/<new> clear last_name & language | 200 | 200 | PASS | last_name=None lang=None campus=South |
| PEOPLE-01.owner.edit-empty-first-name.API | owner | PATCH first_name empty | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","deta |
| PEOPLE-01.owner.edit-organization_id-injection.API | owner | PATCH /people/<new> {organization_id: Beta} | 200/400/422 | 404 | PASS | person still Alpha=True; Beta people unchanged check below |
| PEOPLE-01.owner.delete-linked-or-staffed-person.API | owner | DELETE /people/<member Person with assignment history> | 409 | 409 | PASS | {"error":"This person has service history. Archive them instead.","code":"person |
| PEOPLE-01.owner.GET-unknown-id.API | owner | GET /people/<random uuid> | 404 | 404 | PASS | {"error":"Not found","code":"not_found"} |
| PEOPLE-01.owner.GET-malformed-id.API | owner | GET /people/not-a-uuid | 400/404/422 | 500 | FAIL | OBSERVATION: {"error":"invalid input syntax for type uuid: \"not-a-uuid\"","code":" |
| TEAM-01.owner.create-team-with-duplicate-positions.API | owner | POST /teams positions [P1,P2,P1] | 201/400/409/422 | 409 | PASS | OBSERVATION: {"error":"That record already exists","code":"conflict","details":null |
| TEAM-01.owner.duplicate-team-name.API | owner | POST /teams duplicate name | 201/409 | 409 | PASS | OBSERVATION: duplicate team names -> 409 |
| TEAM-01.owner.invalid-color.API | owner | POST /teams color=red | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","deta |
| TEAM-01.owner.empty-name.API | owner | POST /teams empty name | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","deta |
| TEAM-01.owner.name-121.API | owner | POST /teams name 121 chars | 400/422 | 422 | PASS | {"error":"Invalid request body","code":"unprocessable","deta |
| TEAM-01.admin.create-team.API | admin | POST /teams | 201 | 201 | PASS | {"id":"a307d484-788d-4b40-b35b-f101e389d |
| TEAM-01.member.create-team.API | member | POST /teams | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission t |
| TEAM-01.member.add-member.API | member | POST /teams/Band/members | 403/404 | 403 | PASS | {"error":"Only organization admins and team leader |
| TEAM-03.member.team-detail-member-contacts-redacted.API | member | GET /teams/Production (members list) | no other member contact | ok | PASS | HTTP 200 |
| TEAM-01.peoplegrant.create-team.API | peoplegrant | POST /teams | 403/404 | 403 | PASS | {"error":"You need the “Manage teams” permission t |
| TEAM-01.peoplegrant.add-member.API | peoplegrant | POST /teams/Band/members | 403/404 | 403 | PASS | {"error":"Only organization admins and team leader |
| TEAM-03.peoplegrant.team-detail-member-contacts-redacted.API | peoplegrant | GET /teams/Production (members list) | no other member contact | ok | PASS | HTTP 200 |
| TEAM-01.persisted.no-leftover-teams.API | owner | GET /teams | Band,Production only | Band,Production | PASS | initially failed due to partial write from duplicate-position create (see TEAM-01.owner.create-team-duplicate-positions-atomic.API); leftove |
| TEAM-01.owner.create-team-duplicate-positions-atomic.API | owner | POST /teams {name:"QA Partial", positions:["Dup","Dup"]} then GET /teams | 409/422 and no team persisted | 409; team persisted=True | FAIL | team row left without positions after failed request (partial write) |
| ACL-06.owner.malformed-id-error-disclosure-teams-x.API | owner | GET /teams/x | 400/404/422 | 500 | FAIL | {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} |
| ACL-06.owner.malformed-id-error-disclosure-plans-x.API | owner | GET /plans/x | 400/404/422 | 500 | FAIL | {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} |
| ACL-06.owner.malformed-id-error-disclosure-songs-x.API | owner | GET /songs/x | 400/404/422 | 500 | FAIL | {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} |
| ACL-06.owner.malformed-id-error-disclosure-people-x.API | owner | GET /people/x | 400/404/422 | 500 | FAIL | {"error":"invalid input syntax for type uuid: \"x\"","code":"22P02"} |

## NOT_RUN / BLOCKED / partial

* **ACL-02** folder-lead / folder inheritance, nested folder move preview/acknowledgement, cycle rejection, stale revision, archive/reorder/landing: NOT_RUN (out of requested subset; only legacy->scoped switch, unrelated team/type denial and revoke-mid-session executed). Folder-scope grants were exercised only for the grant/revoke matrix (ACL-01 owner).
* **ACL-01 admin @ folder scope**: NOT_RUN (owner only). `scheduling.override_conflicts` effect (reason-required override on a real conflict): only grant/revoke/explain verified, functional override NOT_RUN.
* **ACL-05**: schedule/mine, calendar (mine), notifications feed, unread count, plan detail, direct PostgREST `assignments` reads, respond-denied, atomic release with a foreign id, release by non-manager, band-lead release in managed scope verified. NOT_RUN: ICS calendar feed token, reports, files/storage, public respond-token projection, search of prepared items, push/email delivery (no test sink used), anonymous deep links.
* **UI/mobile surfaces** not in this track (API only). Storage access not exercised.
* **AUTH-01/PROFILE-01** beyond own `/me` phone and language edits: NOT_RUN. `inactive` registered device / cached screens: NOT_RUN.
* **Pagination/search no-result boundaries, stale `expected_revision` and concurrency**: NOT_RUN in this track.
* Songs/media authoring grants were tested for `songs.manage` and denial only (no media routes beyond `GET /media` probe, whose result is in ACL-01 cases).

## Cleanup state

Fixtures left in place (cleanup coordinated later): both orgs, 11 auth users, all Persons/teams/plans/songs/folder/assignments listed above. Grants at rest: org grants (peoplegrant people.*), Sunday service type (scoped plans.edit+scheduling.manage), Band team (bandlead scheduling.manage+teams.manage); Production/Midweek grants empty; legacy back to legacy mode. Org Alpha city "QA City", timezone America/Toronto. Beta org untouched apart from its own setup.
