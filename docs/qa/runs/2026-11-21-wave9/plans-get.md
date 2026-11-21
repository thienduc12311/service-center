# W9-PLANS-GET: Plans read paths regression (wave 9 fix round)

- Package: W9-PLANS-GET (cases PLN-L*, PLN-D*, PLN-S/C/M*, PLN-P*, WEB-*)
- Commit: ba8d56d (branch feature/qa-wave9-fixes), worktree test-tube; migrations 114/114 applied
- Env: local Supabase; API from this worktree at http://localhost:4100 (fixed code); web via own Vite on :5182 (API through my transparent CORS proxy :4681, because :4100 does not allow origin :5182) and :5183 (API through fault-injection proxy :4680). Orca embedded browser, isolated profile (deleted). :4000/:5173 untouched.
- Namespace: orgs qa-w9-plans-a (Alpha, id 4ca9e15b-d64d-471f-88f1-11607e8bc608) and qa-w9-plans-b (Beta, id 67f60e23-60f3-4bf5-9cf8-61efa8f8c57a); users `<alias>.qaw9.plans@example.test`; passwords only in the scratchpad.
- Date: 2026-11-21. Method: setup by service role/admin only (users, memberships, church creation, response_owner, prepared flag, 170 bulk decline rows, child person_type, deactivation); all reads through the real API / PostgREST / UI with each actor's own token. Decline reasons were created through the real snapshot flow (`/assignments/responses/preview` + `/commit`).

## Fixture shape

- Alpha users: owner, admin, legacy (scheduler role, legacy mode), scoped (scheduler, scoped: plans.edit + scheduling.manage on "PLN Sunday"), bandlead (member; scheduling.manage + teams.manage on team Band), prodlead (member; scheduling.manage on Production only = team-scoped leader of another team), asg (assignee), mate (teammate, Band Bass + Production Camera), cand (roster Keys; prepared, unreleased request), rowner (non-scheduler response owner of asg's Acoustic request, set by SQL), viewer (no team), kid (person_type child, linked login), inactive (released assignment, membership deactivated), outsider (authenticated, no org), ownerb (Beta owner), Beta plan PLN-BETA-SECRET.
- Alpha plans: 59 on first list (+1 Dec 27 added later = 60 in the DB at end): Main Dec 6 (published, 3 times, 2 items, 7 assignments of which 1 prepared; A1 asg Acoustic declined 11:00 "SECRET-ACOUSTIC-asg-31x" (response owner rowner), A2 asg Sound declined 9:00 (prod team), A3 mate Camera declined 11:00; one plan-only position + position needs), Draft Dec 13, Archived Nov 1, Big Dec 20 (170 guest assignees, each with a declined per-time row + note `BIGNOTE-*` inserted by SQL), Declined Dec 27 (asg fully declined, reason "SECRET-FULLDECLINE-asg-31x"), 55 bulk plans (mixed status, 2 service types, repeated dates).

## Totals

{'PASS': 379, 'FAIL': 1, 'NOT_APPLICABLE': 5} over 385 rows. FAIL = 1 (W9-PLN-D1). No P0.

## Privacy fix verdict (W9-JRN-D1)

Holds. Decline reason: exactly the assignee, response owner and schedulers (owner, admin, legacy, scoped, team-scoped leader of that team only) see `response_note`; viewer, teammate, candidate, kid, and the leader of the other team get `null` (key present) and the text appears nowhere in the body (also not in list, schedule, /schedule/mine). Per-time `status` is visible to every roster reader. PostgREST: `select=response_note`, `select=*`, filter/order/embed probes are 403 for every actor; status columns 200; RPC returns notes only to the allowed audience; Beta owner/outsider/deactivated member get nothing. 170-assignment plan with 170 notes: owner/admin/bandlead/scoped receive all 170, others 0 (chunked lookups correct).

## Results

### 1. GET /plans (list) (80 rows: FAIL 1, NOT_APPLICABLE 5, PASS 74)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PLN-L01.owner | owner | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.admin | admin | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.legacy | legacy | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.scoped | scoped | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.bandlead | bandlead | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.prodlead | prodlead | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.asg | asg | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.mate | mate | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.cand | cand | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.rowner | rowner | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.viewer | viewer | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L01.kid | kid | GET /plans per_page=200 | 200, total=DB total (59), no dup ids, rows=min(200,total) | 200 total=59 rows=59 | PASS |
| PLN-L02.inactive | inactive | GET /plans | 403/404 (deactivated) | 403 You are not a member of any organization yet | PASS |
| PLN-L03.outsider | outsider (no org) | GET /plans X-Org=A | 403/404, no rows | 403 You are not a member of any organization yet | PASS |
| PLN-L03b.outsider | outsider (no org) | GET /plans no org header | 403/404 or empty, no rows | 403 You are not a member of any organization yet | PASS |
| PLN-L04.ownerB-hdrA | other-org owner | GET /plans X-Org=A | 403/404, no Alpha rows | 403 You are not a member of that organization | PASS |
| PLN-L05.ownerB | other-org owner | GET /plans X-Org=B | only Beta plans (1: PLN-BETA-SECRET), no Alpha | 200 n=1 total=1 | PASS |
| PLN-L06.ownerB-noheader | other-org owner | GET /plans no org header (inferred) | Beta only | 200 total=1 | PASS |
| PLN-L07.owner-noheader | owner | GET /plans no org header (single org) | inferred Alpha: total=DB | 200 total=59 | PASS |
| PLN-L08.anon | anonymous | GET /plans | 401 | 401 | PASS |
| PLN-L09.foreign-org-id | owner | GET /plans X-Org=random uuid | 403/404 | 403 You are not a member of that organization | PASS |
| PLN-L10.malformed-org-id | owner | GET /plans X-Org=not-a-uuid | 4xx not 500 | 400 Invalid X-Organization-Id header | PASS |
| PLN-L11.owner-hdrB | Alpha owner | GET /plans X-Org=Beta | 403/404 | 403 | PASS |
| PLN-L12.invalid.page=0 | owner | GET /plans?page=0 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.page=-1 | owner | GET /plans?page=-1 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.page=abc | owner | GET /plans?page=abc | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.per_page=0 | owner | GET /plans?per_page=0 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.per_page=201 | owner | GET /plans?per_page=201 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.per_page=-5 | owner | GET /plans?per_page=-5 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.per_page=1.5 | owner | GET /plans?per_page=1.5 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.status=bogus | owner | GET /plans?status=bogus | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.status=PUBLISHED | owner | GET /plans?status=PUBLISHED | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.service_type_id=abc | owner | GET /plans?service_type_id=abc | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.from=notadate | owner | GET /plans?from=notadate | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.to=2026-13-45 | owner | GET /plans?to=2026-13-45 | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.order=sideways | owner | GET /plans?order=sideways | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L12.invalid.page=99999999999999999999 | owner | GET /plans?page=99999999999999999999 | 422 validation error, never 500 | page=1e20 default per_page: 200 returning page-1 rows; per_page=5: 500 (W9-PLN-D1) | FAIL |
| PLN-L12.invalid.per_page= | owner | GET /plans?per_page= | 422 validation error, never 500 | 422 Invalid query parameters | PASS |
| PLN-L13.dup-status | owner | GET /plans?status=draft&status=published | 4xx or deterministic 200, not 500 | 422 total=undefined | PASS |
| PLN-L13b.array-status | owner | GET /plans?status[]=draft | 4xx not 500 | 200 | PASS |
| PLN-L14.status.draft | owner | GET /plans?status=draft | total=19, all rows status=draft | 200 total=19 db=19 | PASS |
| PLN-L14.status.published | owner | GET /plans?status=published | total=34, all rows status=published | 200 total=34 db=34 | PASS |
| PLN-L14.status.archived | owner | GET /plans?status=archived | total=6, all rows status=archived | 200 total=6 db=6 | PASS |
| PLN-L15.service_type.st1 | owner | GET /plans?service_type_id | total=40 | 200 total=40 db=40 | PASS |
| PLN-L15.service_type.st2 | owner | GET /plans?service_type_id | total=19 | 200 total=19 db=19 | PASS |
| PLN-L16.unknown-st | owner | GET /plans?service_type_id=unknown uuid | 200 empty total 0 | 200 total=0 | PASS |
| PLN-L17.foreign-st | owner | GET /plans?service_type_id=<Beta type> | 200 empty (no cross-tenant) | 200 total=0 | PASS |
| PLN-L18.range.2027-01-01..2027-01-31 | owner | GET /plans?from&to | total=27 | 200 total=27 db=27 | PASS |
| PLN-L18.range.2026-12-01..2026-12-31 | owner | GET /plans?from&to | total=3 | 200 total=3 db=3 | PASS |
| PLN-L18.range.2027-02-10T00:00:00Z..2027-02-10T23:59:59Z | owner | GET /plans?from&to | total=0 | 200 total=0 db=0 | PASS |
| PLN-L18b.from-only | owner | GET /plans?from | total=28 | 200 28 | PASS |
| PLN-L18c.to-only | owner | GET /plans?to | total=2 | 200 2 | PASS |
| PLN-L19.from>to | owner | GET /plans?from>to | 200 empty or 422, not 500 | 200 total=0 | PASS |
| PLN-L20.combined | owner | combined filters | total=18 | 200 18 db=18 | PASS |
| PLN-L21.unsupported.search | owner | GET /plans?search | feature not in listPlansQuerySchema (no search/folder/cursor/limit); param ignored (200), not 500 | 200 total=59 (search/folder/cursor not in listPlansQuerySchema) | NOT_APPLICABLE |
| PLN-L21.unsupported.q | owner | GET /plans?q | feature not in listPlansQuerySchema (no search/folder/cursor/limit); param ignored (200), not 500 | 200 total=59 (search/folder/cursor not in listPlansQuerySchema) | NOT_APPLICABLE |
| PLN-L21.unsupported.folder_id | owner | GET /plans?folder_id | feature not in listPlansQuerySchema (no search/folder/cursor/limit); param ignored (200), not 500 | 200 total=59 (search/folder/cursor not in listPlansQuerySchema) | NOT_APPLICABLE |
| PLN-L21.unsupported.cursor | owner | GET /plans?cursor | feature not in listPlansQuerySchema (no search/folder/cursor/limit); param ignored (200), not 500 | 200 total=59 (search/folder/cursor not in listPlansQuerySchema) | NOT_APPLICABLE |
| PLN-L21.unsupported.limit | owner | GET /plans?limit | feature not in listPlansQuerySchema (no search/folder/cursor/limit); param ignored (200), not 500 | 200 total=59 (search/folder/cursor not in listPlansQuerySchema) | NOT_APPLICABLE |
| PLN-L22.walk.asc | asg (member) | GET /plans page walk per_page=7 order=asc | all 59 ids once, same order as DB (date,id) | rows=59 unique=59 total=59 orderMatch=true | PASS |
| PLN-L22.walk.desc | asg (member) | GET /plans page walk per_page=7 order=desc | all 59 ids once, same order as DB (date,id) | rows=59 unique=59 total=59 orderMatch=true | PASS |
| PLN-L23.last-page | owner | last page per_page=10 | rows=9 | 9 | PASS |
| PLN-L24.beyond-last | owner | page past end | 200, empty, exact total | 200 rows=0 total=59 | PASS |
| PLN-L25.per_page=1 | owner | per_page=1 | 1 row total exact | 1 59 | PASS |
| PLN-L26.beyond-filtered | owner | page 100000 with status filter | 200 empty, filtered total | 200 total=19 | PASS |
| PLN-L27.empty-org-filter | ownerB | Beta archived (none) | 200 empty total 0 | 200 0 | PASS |
| PLN-L28.counts.owner | owner | plan summary counts | prepared=1 (cand Keys), items=2, assignments released 6 | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":1} db=[{"visibility":"prepared","n":1},{"visibility":"released","n":6}] | PASS |
| PLN-L28.counts.bandlead | bandlead | plan summary counts | prepared=1 (own team) | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":1} | PASS |
| PLN-L28.counts.prodlead | prodlead | plan summary counts | prepared=0 (not their team) | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":0} | PASS |
| PLN-L28.counts.asg | asg | plan summary counts | prepared=0; members never see prepared rows | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":0} | PASS |
| PLN-L28.counts.viewer | viewer | plan summary counts | prepared=0; members never see prepared rows | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":0} | PASS |
| PLN-L28.counts.cand | cand | plan summary counts | prepared=0; members never see prepared rows | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":0} | PASS |
| PLN-L28.counts.kid | kid | plan summary counts | prepared=0; members never see prepared rows | {"items":2,"songs":0,"confirmed":1,"unconfirmed":5,"declined":0,"prepared":0} | PASS |
| PLN-L29.noleak.viewer | viewer | GET /plans body | no SECRET- decline reason text | 200 len=60493 | PASS |
| PLN-L29.noleak.asg | asg | GET /plans body | no SECRET- decline reason text | 200 len=60493 | PASS |
| PLN-L29.noleak.kid | kid | GET /plans body | no SECRET- decline reason text | 200 len=60493 | PASS |
| PLN-L29.noleak.cand | cand | GET /plans body | no SECRET- decline reason text | 200 len=60493 | PASS |
| PLN-L29.noleak.mate | mate | GET /plans body | no SECRET- decline reason text | 200 len=60493 | PASS |
| PLN-L30.shape | owner | plan summary row vs DB | id/title/status/date/type/location equal; times=3; service_type object | {"times":3,"st":"PLN Sunday"} | PASS |
| PLN-L31.noleak-fulldecline | viewer | GET /plans body | no FULLDECLINE text |  | PASS |

### 2. GET /plans/:id (detail, privacy) (129 rows: PASS 129)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PLN-D01.status.owner | owner | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.owner | owner | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.owner | owner | time_responses[].response_note | notes only for 3 allowed assignment(s) with the exact text; null elsewhere | notes on 3/3 assignments; textOk=true | PASS |
| PLN-D04.body-scan.owner | owner | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.owner | owner | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.owner | owner | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=true | PASS |
| PLN-D07.adult-flag.owner | owner | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.admin | admin | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.admin | admin | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.admin | admin | time_responses[].response_note | notes only for 3 allowed assignment(s) with the exact text; null elsewhere | notes on 3/3 assignments; textOk=true | PASS |
| PLN-D04.body-scan.admin | admin | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.admin | admin | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.admin | admin | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=true | PASS |
| PLN-D07.adult-flag.admin | admin | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.legacy | legacy | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.legacy | legacy | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.legacy | legacy | time_responses[].response_note | notes only for 3 allowed assignment(s) with the exact text; null elsewhere | notes on 3/3 assignments; textOk=true | PASS |
| PLN-D04.body-scan.legacy | legacy | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.legacy | legacy | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.legacy | legacy | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=true | PASS |
| PLN-D07.adult-flag.legacy | legacy | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.scoped | scoped | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.scoped | scoped | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.scoped | scoped | time_responses[].response_note | notes only for 3 allowed assignment(s) with the exact text; null elsewhere | notes on 3/3 assignments; textOk=true | PASS |
| PLN-D04.body-scan.scoped | scoped | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.scoped | scoped | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.scoped | scoped | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=true | PASS |
| PLN-D07.adult-flag.scoped | scoped | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.bandlead | bandlead | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.bandlead | bandlead | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.bandlead | bandlead | time_responses[].response_note | notes only for 1 allowed assignment(s) with the exact text; null elsewhere | notes on 1/1 assignments; textOk=true | PASS |
| PLN-D04.body-scan.bandlead | bandlead | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.bandlead | bandlead | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.bandlead | bandlead | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=true | PASS |
| PLN-D07.adult-flag.bandlead | bandlead | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.prodlead | prodlead | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.prodlead | prodlead | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.prodlead | prodlead | time_responses[].response_note | notes only for 2 allowed assignment(s) with the exact text; null elsewhere | notes on 2/2 assignments; textOk=true | PASS |
| PLN-D04.body-scan.prodlead | prodlead | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.prodlead | prodlead | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.prodlead | prodlead | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.prodlead | prodlead | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.asg | asg | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.asg | asg | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.asg | asg | time_responses[].response_note | notes only for 2 allowed assignment(s) with the exact text; null elsewhere | notes on 2/2 assignments; textOk=true | PASS |
| PLN-D04.body-scan.asg | asg | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.asg | asg | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.asg | asg | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.asg | asg | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.mate | mate | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.mate | mate | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.mate | mate | time_responses[].response_note | notes only for 1 allowed assignment(s) with the exact text; null elsewhere | notes on 1/1 assignments; textOk=true | PASS |
| PLN-D04.body-scan.mate | mate | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.mate | mate | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.mate | mate | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.mate | mate | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.rowner | rowner | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.rowner | rowner | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.rowner | rowner | time_responses[].response_note | notes only for 1 allowed assignment(s) with the exact text; null elsewhere | notes on 1/1 assignments; textOk=true | PASS |
| PLN-D04.body-scan.rowner | rowner | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.rowner | rowner | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.rowner | rowner | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.rowner | rowner | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.cand | cand | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.cand | cand | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.cand | cand | time_responses[].response_note | notes only for 0 allowed assignment(s) with the exact text; null elsewhere | notes on 0/0 assignments; textOk=true | PASS |
| PLN-D04.body-scan.cand | cand | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.cand | cand | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.cand | cand | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.cand | cand | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.viewer | viewer | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.viewer | viewer | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.viewer | viewer | time_responses[].response_note | notes only for 0 allowed assignment(s) with the exact text; null elsewhere | notes on 0/0 assignments; textOk=true | PASS |
| PLN-D04.body-scan.viewer | viewer | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.viewer | viewer | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.viewer | viewer | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.viewer | viewer | viewer_is_adult_person | true | true | PASS |
| PLN-D01.status.kid | kid | GET /plans/:id | 200 | 200  | PASS |
| PLN-D02.time-status.kid | kid | time_responses[].status | per-time status (all 5 DB rows) visible to every roster reader | rows=12 db=9 | PASS |
| PLN-D03.note-audience.kid | kid | time_responses[].response_note | notes only for 0 allowed assignment(s) with the exact text; null elsewhere | notes on 0/0 assignments; textOk=true | PASS |
| PLN-D04.body-scan.kid | kid | GET /plans/:id raw body | no decline text anywhere outside allowed assignment | clean | PASS |
| PLN-D05.note-key-present.kid | kid | time_responses[] shape | response_note key present (null) on every time response | 0 missing | PASS |
| PLN-D06.prepared.kid | kid | prepared Keys request | visible only to owner/admin/legacy/scoped/bandlead | visible=false | PASS |
| PLN-D07.adult-flag.kid | kid | viewer_is_adult_person | false (child person) | false | PASS |
| PLN-D10.shape.keys | owner | GET /plans/:id keys | all documented keys present | missing= | PASS |
| PLN-D11.shape.db | owner | items/times/assignments vs DB | items=2, times=3, assignments=7 | items=2 times=3 assignments=7 | PASS |
| PLN-D12.total_length | owner | total_length_seconds | 1800 | 1800 | PASS |
| PLN-D13.assignment.fields | owner | assignment row (Acoustic) | team, position, person.full_name, response_owner, attendance, time_responses=3 | {"t":"PLN Band","p":"Acoustic","pe":"Asa Assignee","ro":"Rhea Respowner","tr":3,"att":3,"attt":0} | PASS |
| PLN-D15.people-named | owner | assignment.person | all 6 released+1 prepared named | 7/7 | PASS |
| PLN-D16.A1.statuses | owner | Acoustic per-time statuses vs DB | 3 times: declined 11:00, confirmed 9:00 & rehearsal | ["confirmed","confirmed","declined"] | PASS |
| PLN-D17.contacts | viewer vs owner | assignment.person email/phone | viewer must not see other people's contact unless people.view_private; compare | owner:[{"e":"asg.qaw9.plans@example.test","p":null},{"e":"mate.qaw9.plans@example.test","p":null},{"e":"inactive.qaw9.plans@ex viewer:[{"e":null,"p":null},{"e":null,"p":null},{"e":null,"p":null},{"e":null,"p":null},{"e":null,"p":null},{"e":null,"p":null} | PASS |
| PLN-D20.unknown | owner | GET /plans/<unknown uuid> | 404 | 404 Plan not found | PASS |
| PLN-D21.malformed | owner | GET /plans/not-a-uuid | 404 (or 400/422), not 500 | 400 Invalid route parameter: id | PASS |
| PLN-D21b.sqli | owner | GET /plans/1' or '1'='1 | 4xx not 500 | 400 Invalid route parameter: id | PASS |
| PLN-D22.other-org-id | Alpha owner | GET /plans/<Beta plan id> X-Org=A | 404 not 403 | 404 Plan not found | PASS |
| PLN-D22b.other-org-hdr | Alpha owner | GET /plans/<Beta id> X-Org=B | 403 (not a member of org), no data | 403 You are not a member of that organization | PASS |
| PLN-D23.alpha-id-as-betaOwner | Beta owner | GET /plans/<Alpha id> X-Org=B | 404 | 404 Plan not found | PASS |
| PLN-D23b.alpha-id-hdrA-as-betaOwner | Beta owner | GET /plans/<Alpha id> X-Org=A | 403 | 403 | PASS |
| PLN-D23c.alpha-id-noheader-betaOwner | Beta owner | GET /plans/<Alpha id> no header (infers Beta) | 404 | 404 | PASS |
| PLN-D24.inactive | inactive | GET /plans/:id | 403/404 | 403 | PASS |
| PLN-D25.outsider | outsider | GET /plans/:id | 403/404 | 403 | PASS |
| PLN-D26.anon | anonymous | GET /plans/:id | 401 | 401 | PASS |
| PLN-D27.noheader | owner | GET /plans/:id no org header | 200 (inferred) | 200 | PASS |
| PLN-D30.big.owner | owner | GET /plans/:id 170 assignees (chunked people lookup) | 200, 170 assignments, 170 named persons, unique ids | 200 asg=170 named=170 63ms | PASS |
| PLN-D30.big.viewer | viewer | GET /plans/:id 170 assignees (chunked people lookup) | 200, 170 assignments, 170 named persons, unique ids | 200 asg=170 named=170 79ms | PASS |
| PLN-D30.big.asg | asg | GET /plans/:id 170 assignees (chunked people lookup) | 200, 170 assignments, 170 named persons, unique ids | 200 asg=170 named=170 79ms | PASS |
| PLN-D31.big.ids-vs-db | owner | assignment ids vs DB | same 170 ids | compared | PASS |
| PLN-D40.draft.owner | owner | GET /plans/:id draft plan | detail visibility matches list visibility (is_org_member contract) | detail=200 inList=true | PASS |
| PLN-D40.draft.viewer | viewer | GET /plans/:id draft plan | detail visibility matches list visibility (is_org_member contract) | detail=200 inList=true | PASS |
| PLN-D40.archived.owner | owner | GET /plans/:id archived plan | detail visibility matches list visibility (is_org_member contract) | detail=200 inList=true | PASS |
| PLN-D40.archived.viewer | viewer | GET /plans/:id archived plan | detail visibility matches list visibility (is_org_member contract) | detail=200 inList=true | PASS |
| PLN-D50.fulldecline.owner | owner | GET /plans/:id fully declined assignment | note visible (scheduler/response owner) | 200 | PASS |
| PLN-D50.fulldecline.bandlead | bandlead | GET /plans/:id fully declined assignment | note visible (scheduler/response owner) | 200 | PASS |
| PLN-D50.fulldecline.rowner | rowner | GET /plans/:id fully declined assignment | rowner is NOT the response owner of this assignment (creator bandlead is) -> no note text | 200, note text absent (test-design correction: my expectation was wrong) | PASS |
| PLN-D50.fulldecline.asg | asg | GET /plans/:id fully declined assignment | note visible to assignee | 200 | PASS |
| PLN-D51.fulldecline.viewer | viewer | GET /plans/:id fully declined (status declined visible to roster) | assignment.status=declined visible but no note text | 200 status=declined | PASS |
| PLN-D51.fulldecline.mate | mate | GET /plans/:id fully declined (status declined visible to roster) | assignment.status=declined visible but no note text | 200 status=declined | PASS |
| PLN-D51.fulldecline.cand | cand | GET /plans/:id fully declined (status declined visible to roster) | assignment.status=declined visible but no note text | 200 status=declined | PASS |
| PLN-D51.fulldecline.kid | kid | GET /plans/:id fully declined (status declined visible to roster) | assignment.status=declined visible but no note text | 200 status=declined | PASS |
| PLN-D51.fulldecline.prodlead | prodlead | GET /plans/:id fully declined (status declined visible to roster) | assignment.status=declined visible but no note text | 200 status=declined | PASS |
| PLN-D32.big-notes.owner | owner | GET /plans/:id 170 assignments each with a decline note (chunked RPC) | all 170 notes returned, correct per assignment | 200 notes=170 textOk=true | PASS |
| PLN-D32.big-notes.admin | admin | GET /plans/:id 170 assignments each with a decline note (chunked RPC) | all 170 notes returned, correct per assignment | 200 notes=170 textOk=true | PASS |
| PLN-D32.big-notes.bandlead | bandlead | GET /plans/:id 170 assignments each with a decline note (chunked RPC) | all 170 notes returned, correct per assignment | 200 notes=170 textOk=true | PASS |
| PLN-D32.big-notes.scoped | scoped | GET /plans/:id 170 assignments each with a decline note (chunked RPC) | all 170 notes returned, correct per assignment | 200 notes=170 textOk=true | PASS |
| PLN-D33.big-notes-hidden.viewer | viewer | GET /plans/:id 170 assignments with notes | 0 notes; 170 statuses visible | 200 bodyHasNote=false | PASS |
| PLN-D33.big-notes-hidden.asg | asg | GET /plans/:id 170 assignments with notes | 0 notes; 170 statuses visible | 200 bodyHasNote=false | PASS |
| PLN-D33.big-notes-hidden.prodlead | prodlead | GET /plans/:id 170 assignments with notes | 0 notes; 170 statuses visible | 200 bodyHasNote=false | PASS |
| PLN-D33.big-notes-hidden.kid | kid | GET /plans/:id 170 assignments with notes | 0 notes; 170 statuses visible | 200 bodyHasNote=false | PASS |
| PLN-D33.big-notes-hidden.cand | cand | GET /plans/:id 170 assignments with notes | 0 notes; 170 statuses visible | 200 bodyHasNote=false | PASS |

### 3. /plans/:id/schedule, conflict-overrides, /schedule/mine (73 rows: PASS 73)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PLN-D14.plan_positions | viewer | plan_positions / position_needs vs DB | plan_positions=1, position_needs=3 | pp=1 needs=3 | PASS |
| PLN-S01.schedule.owner | owner | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.admin | admin | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.legacy | legacy | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.scoped | scoped | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.bandlead | bandlead | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.prodlead | prodlead | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.asg | asg | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.mate | mate | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.cand | cand | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.rowner | rowner | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.viewer | viewer | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S01.schedule.kid | kid | GET /plans/:id/schedule | 200, selected+service_times(2), no decline text | 200 st=2 | PASS |
| PLN-S02.time_id | owner | schedule?time_id=11:00 | 200 selected 11:00 | 200 | PASS |
| PLN-S03.unknown-time | owner | schedule?time_id=unknown | 404 | 404 | PASS |
| PLN-S04.bad-time | owner | schedule?time_id=abc | 422 | 422 | PASS |
| PLN-S05.unknown-plan | owner | schedule unknown plan | 404 | 404 | PASS |
| PLN-S06.other-org-plan | owner | schedule Beta plan with X-Org=A | 404 | 404 | PASS |
| PLN-S07.anon | anonymous | schedule | 401 | 401 | PASS |
| PLN-S08.inactive | inactive | schedule | 403/404 | 403 | PASS |
| PLN-S09.betaowner | Beta owner | schedule Alpha plan X-Org=B | 404 | 404 | PASS |
| PLN-C01.overrides.owner | owner | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.admin | admin | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.legacy | legacy | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.scoped | scoped | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.bandlead | bandlead | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.prodlead | prodlead | GET /plans/:id/conflict-overrides | 200 array (scheduling.manage at some scope) | 200 | PASS |
| PLN-C01.overrides.asg | asg | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C01.overrides.mate | mate | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C01.overrides.cand | cand | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C01.overrides.rowner | rowner | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C01.overrides.viewer | viewer | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C01.overrides.kid | kid | GET /plans/:id/conflict-overrides | 403 | 403 | PASS |
| PLN-C02.other-org-plan | owner | overrides Beta plan X-Org=A | 200 [] (no rows) or 404 | 200 [] | PASS |
| PLN-C03.anon | anonymous | overrides | 401 | 401 | PASS |
| PLN-C04.inactive | inactive | overrides | 403 | 403 | PASS |
| PLN-M01.mine.owner | owner | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.admin | admin | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.legacy | legacy | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.scoped | scoped | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.bandlead | bandlead | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.prodlead | prodlead | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.asg | asg | GET /schedule/mine include_past | 200, 2 released entries (prepared hidden), own rows only | 200 n=2 db=2 | PASS |
| PLN-M01.mine.mate | mate | GET /schedule/mine include_past | 200, 2 released entries (prepared hidden), own rows only | 200 n=2 db=2 | PASS |
| PLN-M01.mine.cand | cand | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.rowner | rowner | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.viewer | viewer | GET /schedule/mine include_past | 200, 0 released entries (prepared hidden), own rows only | 200 n=0 db=0 | PASS |
| PLN-M01.mine.kid | kid | GET /schedule/mine include_past | 200, 1 released entries (prepared hidden), own rows only | 200 n=1 db=1 | PASS |
| PLN-M02.self-note.time_responses | asg | /schedule/mine time_responses[].response_note (self) | own decline reason visible: SECRET-ACOUSTIC-asg-31x | ["SECRET-ACOUSTIC-asg-31x"] | PASS |
| PLN-M03.self-note.top-level | asg | /schedule/mine entry.response_note | info: mixed per-time answers keep aggregate unconfirmed, so top-level note null (reason shown via time_responses; see M03b for declined) | assignment.status=unconfirmed response_note=null | PASS |
| PLN-M04.self-note.sound | asg | /schedule/mine Sound entry (declined 9:00) | own reason visible | status=unconfirmed ["SECRET-SOUND-asg-31x"] top=null | PASS |
| PLN-M05.mate-no-other-notes | mate | /schedule/mine body | only own SECRET-CAMERA; none of asg's | n=2 | PASS |
| PLN-M06.respowner-not-in-mine | rowner | /schedule/mine (response owner, not assignee) | 0 entries, no notes | n=0 | PASS |
| PLN-M07.prepared-hidden | cand | /schedule/mine with prepared Keys | empty | n=0 | PASS |
| PLN-M08.leader-no-notes | bandlead | /schedule/mine | no notes of others | n=0 | PASS |
| PLN-M09.default-future-only | asg | /schedule/mine default (from now) | 200 (plans Dec 2026 are future today 2026-11-21) | n=2 | PASS |
| PLN-M10.filter.status=confirmed | asg | /schedule/mine?status=confirmed | 200 array, consistent | n=0 | PASS |
| PLN-M10.filter.status=unconfirmed | asg | /schedule/mine?status=unconfirmed | 200 array, consistent | n=2 | PASS |
| PLN-M10.filter.from/to | asg | /schedule/mine?from/to | 200 array, consistent | n=2 | PASS |
| PLN-M10.filter.to-before | asg | /schedule/mine?to-before | 200 array, consistent | n=0 | PASS |
| PLN-M11.invalid.status=bogus | asg | /schedule/mine?status=bogus | 422 not 500 | 422 Invalid query parameters | PASS |
| PLN-M11.invalid.from=abc | asg | /schedule/mine?from=abc | 4xx not 500 (400 invalid date) | 400 Invalid date or time | PASS |
| PLN-M11.invalid.include_past=maybe | asg | /schedule/mine?include_past=maybe | 422 not 500 | 422 Invalid query parameters | PASS |
| PLN-M12.anon | anonymous | /schedule/mine | 401 | 401 | PASS |
| PLN-M13.inactive | inactive | /schedule/mine | 403 | 403 | PASS |
| PLN-M14.outsider | outsider | /schedule/mine | 403 | 403 | PASS |
| PLN-M15.betaowner-hdrA | Beta owner | /schedule/mine X-Org=A | 403 | 403 | PASS |
| PLN-M16.betaowner | Beta owner | /schedule/mine X-Org=B | 200 [] no Alpha | 200 n=0 | PASS |
| PLN-M03b.self-note.declined-top-level | asg | /schedule/mine entry for fully declined assignment | status declined; response_note=reason; time_responses notes = reason | status=declined top=SECRET-FULLDECLINE-asg-31x tr=note,note | PASS |
| PLN-M17.fulldecline-not-in-others-mine.viewer | viewer | /schedule/mine body | no FULLDECLINE text | 200 | PASS |
| PLN-M17.fulldecline-not-in-others-mine.mate | mate | /schedule/mine body | no FULLDECLINE text | 200 | PASS |
| PLN-M17.fulldecline-not-in-others-mine.bandlead | bandlead | /schedule/mine body | no FULLDECLINE text | 200 | PASS |
| PLN-M17.fulldecline-not-in-others-mine.owner | owner | /schedule/mine body | no FULLDECLINE text | 200 | PASS |

### 4. PostgREST direct (caller JWT) and RPC (96 rows: PASS 96)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PLN-P01.select-note.owner | owner | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.owner | owner | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.owner | owner | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.owner | owner | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.owner | owner | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.owner | owner | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.owner | owner | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 4 allowed assignment(s) | 200 assignments=4/4 rows=5 | PASS |
| PLN-P01.select-note.admin | admin | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.admin | admin | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.admin | admin | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.admin | admin | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.admin | admin | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.admin | admin | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.admin | admin | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 4 allowed assignment(s) | 200 assignments=4/4 rows=5 | PASS |
| PLN-P01.select-note.legacy | legacy | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.legacy | legacy | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.legacy | legacy | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.legacy | legacy | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.legacy | legacy | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.legacy | legacy | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.legacy | legacy | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 4 allowed assignment(s) | 200 assignments=4/4 rows=5 | PASS |
| PLN-P01.select-note.scoped | scoped | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.scoped | scoped | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.scoped | scoped | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.scoped | scoped | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.scoped | scoped | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.scoped | scoped | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.scoped | scoped | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 4 allowed assignment(s) | 200 assignments=4/4 rows=5 | PASS |
| PLN-P01.select-note.bandlead | bandlead | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.bandlead | bandlead | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.bandlead | bandlead | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.bandlead | bandlead | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.bandlead | bandlead | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.bandlead | bandlead | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.bandlead | bandlead | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 2 allowed assignment(s) | 200 assignments=2/2 rows=3 | PASS |
| PLN-P01.select-note.prodlead | prodlead | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.prodlead | prodlead | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.prodlead | prodlead | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.prodlead | prodlead | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.prodlead | prodlead | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.prodlead | prodlead | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.prodlead | prodlead | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 2 allowed assignment(s) | 200 assignments=2/2 rows=2 | PASS |
| PLN-P01.select-note.asg | asg | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.asg | asg | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.asg | asg | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.asg | asg | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.asg | asg | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.asg | asg | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.asg | asg | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 3 allowed assignment(s) | 200 assignments=3/3 rows=4 | PASS |
| PLN-P01.select-note.mate | mate | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.mate | mate | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.mate | mate | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.mate | mate | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.mate | mate | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.mate | mate | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.mate | mate | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 1 allowed assignment(s) | 200 assignments=1/1 rows=1 | PASS |
| PLN-P01.select-note.rowner | rowner | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.rowner | rowner | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.rowner | rowner | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.rowner | rowner | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.rowner | rowner | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.rowner | rowner | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.rowner | rowner | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 1 allowed assignment(s) | 200 assignments=1/1 rows=1 | PASS |
| PLN-P01.select-note.cand | cand | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.cand | cand | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.cand | cand | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.cand | cand | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.cand | cand | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.cand | cand | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.cand | cand | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 0 allowed assignment(s) | 200 assignments=0/0 rows=0 | PASS |
| PLN-P01.select-note.viewer | viewer | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.viewer | viewer | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.viewer | viewer | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.viewer | viewer | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.viewer | viewer | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.viewer | viewer | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.viewer | viewer | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 0 allowed assignment(s) | 200 assignments=0/0 rows=0 | PASS |
| PLN-P01.select-note.kid | kid | PostgREST assignment_time_responses?select=response_note | 403 permission denied (column privilege revoked) | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P02.select-star.kid | kid | PostgREST ?select=* | refused 403, no rows/no note | 403 permission denied for table assignment_time_responses | PASS |
| PLN-P03.select-status.kid | kid | PostgREST ?select=status,plan_time_id,assignment_id | 200 all 9 roster rows | 200 n=9 db=9 | PASS |
| PLN-P04.filter-probe.kid | kid | PostgREST filter on response_note (oracle probe) | 403, no boolean oracle | 403 | PASS |
| PLN-P05.order-probe.kid | kid | PostgREST order=response_note | 403 | 403 | PASS |
| PLN-P06.embed-probe.kid | kid | PostgREST embed via assignments | 403, no note | 403 | PASS |
| PLN-P07.rpc.kid | kid | RPC assignment_time_response_notes([A1,A2,A3,A5]) | notes only for 0 allowed assignment(s) | 200 assignments=0/0 rows=0 | PASS |
| PLN-P10.betaowner.status | ownerB | PostgREST status rows of Alpha | 0 rows (RLS) | 200 n=0 | PASS |
| PLN-P11.betaowner.rpc | ownerB | RPC notes with Alpha ids | [] | 200 n=0 | PASS |
| PLN-P12.outsider.rpc | outsider | RPC notes | [] or denied | 200 n=0 | PASS |
| PLN-P13.inactive.rpc | inactive (deactivated) | RPC notes with Alpha ids | [] or denied | 200 n=0 | PASS |
| PLN-P14.inactive.status | inactive | PostgREST status rows (own Person rows only per W9-JRN-O1) | no rows of other people | 200 n=0 | PASS |
| PLN-P15.anon.status | anon key only | PostgREST status | 401/403 or [] | 200 [] | PASS |
| PLN-P16.anon.note | anon key only | PostgREST response_note | 401/403 | 401 | PASS |
| PLN-P17.anon.rpc | anon key only | RPC | denied or [] | 401 {"code":"42501","details":null,"hint":null,"message":"permis | PASS |
| PLN-P18.write.update | asg | PostgREST PATCH response_note (own) | denied (403/404/empty), DB unchanged | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr | PASS |
| PLN-P19.write.insert | viewer | PostgREST INSERT | denied | 403 | PASS |
| PLN-P20.history.viewer | viewer | assignment_time_response_history | 0 rows or denied | 200 n=0 | PASS |
| PLN-P21.history.asg | asg | history (own) | own rows only | 200 n=8 | PASS |

### 5. Web Plans pages (7 rows: PASS 7)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| WEB-01 | owner | Web /plans list (Vite :5182 -> API fixed code) | list renders 59 plans, filters, counts | "59 plans", rows with counts (e.g. 1 confirmed 5 pending, 170 pending, 1 declined) | PASS |
| WEB-02 | owner | Web /plans/:id (Main Dec 6) | detail renders: times, items, Teams roster (all teams incl. prepared Cand), no error | rendered; "Show all teams" lists Production + Band rosters; no decline text in DOM | PASS |
| WEB-03 | viewer (member) | Web /plans list | renders 59 plans | rendered, 59 plans | PASS |
| WEB-04 | viewer (member) | Web /plans/:id Main + Big (170 assignees) | detail renders, no SECRET text, no error banner | both render; no SECRET; no error | PASS |
| WEB-05 | owner | Web /plans with injected 503 on GET /plans (proxy :4680, Vite :5183) | error notice + "Try again", no "No plans yet" empty state | "Service Center is having trouble right now..." + Try again; no empty state | PASS |
| WEB-06 | owner | Web "Try again" while still 503 | stays on error, no empty state | still error, no empty state | PASS |
| WEB-07 | owner | Web "Try again" after fault cleared | list recovers (59 plans), error gone | recovered, 59 plans, no error | PASS |

## Defects

### W9-PLN-D1 (P2) `GET /plans` accepts an unsafe `page` value: wrong page or HTTP 500
- Repro: `GET /api/v1/plans?page=99999999999999999999&per_page=5` as any member returns 500 "Internal server error"; `?page=1e21&per_page=5` returns 200 with `page:"1e+21"` and the FIRST page of rows (should be an empty page past the end, or 422); `?page=99999999999999999999` (default per_page) returns 200 with first-page rows.
- Expected: 422 (like `page=abc`) or an empty page past the end with exact total. Actual: 500, or page-1 rows labelled with a nonsense page.
- Cause: `page` is `z.coerce.number().int().min(1)` with no `.max()`/`.safe()`; offset `(page-1)*per_page` exceeds 2^53 and is sent to PostgREST in exponent notation. Source: packages/shared/src/schemas/common.ts:44, backend/src/routes/plans.ts:94-103 (range). Likely shared by every list using `paginationSchema`.
- Impact: unauthenticated-data none; availability/log noise only. Backend log not inspected.

## Observations (not defects)

- Draft and archived plans are visible to every active member in list and detail (`plans_select` = `is_org_member`); detail visibility equals list visibility. Matches current RLS; product should confirm if drafts are meant to be member-visible. Prepared (unreleased) requests are hidden from members and from a leader of another team, and not counted in summary `counts.prepared` for them.
- Validation errors are HTTP 422 for the list schema (my first expectation of 400 was corrected); `/schedule/mine?from=abc` is 400.
- `/schedule/mine` top-level `response_note` is null when per-time answers are mixed (aggregate stays unconfirmed); the own reasons are in `time_responses[].response_note`. For a fully declined assignment both carry the note (PLN-M03b).
- List has no search, folder, cursor or limit parameters; they are silently ignored (200). Recorded NOT_APPLICABLE, not a defect.
- Test-design corrections made during the run (not product issues): first PLN-D14 expectation (plan-only positions) and PLN-D50 rowner on Dec 27 (response owner there is the creator).

## Not run / blocked

- Folder filter, search, cursor: not in the API (NOT_APPLICABLE).
- Web: member-role fault injection, plan detail 503 state, and loaded-rows-stay-on-later-failure were not exercised (NOT_RUN); only owner list fault path. Mobile not in scope.
- Mid-session revocation of scheduler grants and the legacy `POST /assignments/:id/respond` path not covered.
- Backend logs not inspected for the 500 in D1.

## Fixtures left in place

Orgs qa-w9-plans-a / qa-w9-plans-b, 15 users `*.qaw9.plans@example.test`, 170 guest people (Guest000..169 Bulk) + roster, all plans above, decline rows. Stopped and deleted: Vite 5182/5183, proxies 4680/4681 (by PID on my ports), browser profile qaw9-plans, tab closed. Scratch scripts/results in the session scratchpad `plans/` (credentials there).
