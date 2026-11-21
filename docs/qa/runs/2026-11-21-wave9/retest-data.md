# W9-RETEST-DATA - retest of wave 8 truncation/paging defects and the team-roster decision at volume (wave 9, 2026-11-21)

- Package: W9-RETEST-DATA (QA-16 retest of QA-02 / QA-15 PERF-01 defects W8-PERF-D2, W8-PERF-D3, W8-NAT-D1 API/RLS half; deferred D4/D5 measured only). Plan sections 2, 3, 4 (D17), 12.
- Commit: frozen 9aaeada (main), branch feature/qa-wave9. API :4000 (code identical to 9aaeada; simulated email/push), local Supabase. No code, migration or config changed; delivery worker not run; no database-wide ANALYZE; browser not used.
- Method: every expected value is derived from SQL against the seeded database (psql as postgres, read-only for expectations), every actual value comes from the real API or PostgREST with the actor's own JWT (password grant). Permission evidence never uses the service role. Fixtures were bulk-seeded through SQL/service role (Auth admin API for the 8 real users).
- Namespace: orgs `qa-w9-data-a`, `qa-w9-data-b`; users `<alias>.qaw9.data@example.test` for owner, admin, leader (member role + org-scope scheduling.manage), member, child (person_type=child, linked login), inactive (suspended membership), bowner (owner of B), nomem (no organization); 1,100 bulk login users `bulkNNNN.qaw9.data@example.test` (no password).
- Fixture shape, org A: 2,286 people (1,106 login members incl. 5 named + 1 inactive, 1,050 standalone with a pending invitation each, 120 identical "Same Name", 10 special names incl. two 161-character Thai names and `*` `%` `_` `\\` `"` `,)(` names, 2 archived); 1,050 teams; 1,347 team memberships (Team 0001 holds 1,108 rows: 1,106 people plus two extra positions for one member); 120 team conversations (60 with messages, 30 sharing one identical last-message timestamp, 60 with none); 1,050 service-type folders, 1,050 service types, 1,050 songbooks (+3 created by the test), 250 songs; 4,401 access grants (1,100 service-type-scope, 1,101 organization-scope, ~2,200 team-scope across test teams); 1,320 plans (W1 40x29, W2 50x45, W3 520x1, W4 710 member-only) with 4,950 assignments, 2 plan times on W1/W2, 2,320 attendance records. Org B: 1 team, bowner, 1 song.
- Results: 275 PASS, 20 FAIL, 7 INFO (measure-only), 1 NOT_APPLICABLE, 0 BLOCKED. Status in tables is per row; the same case ID repeats per actor/variant. HTTP 422 is this API's validation status and counts as a 4xx.

## Verdict on the claimed fixes

- W8-PERF-D2 (people list, invitations, schedule/participation reports, CSV, attendance times): fixed. GET /people returned 2,283 of 2,283 for all 5 member actors with no duplicates; invitations flags 1,050 of 1,050; schedule reports match SQL exactly at 899, 1,494 and 2,000 (cap, truncated=true, CSV carries the Truncated line) and at the 500-plan cap (truncated=true); participation sums (assignments, present, absent, with and without rehearsals) match SQL with 2,320 attendance rows in one chunk.
- W8-PERF-D3 (conversations): fixed. No cursor/limit gives the legacy array of all rows (120 for owner/admin/leader, 20 for member, 0 for the child) in exact SQL order; limit 7/50/100 walks lose and repeat nothing across a 30-way timestamp tie and across the never-messaged tail; has_more/next_cursor honest; garbage cursors 400, bad limits 422.
- People paging: fixed for the owner scenario set (23 pages at 100, 92 at 25, exact SQL order, 161-character Thai names walk at limit 1, literal symbol search, owner search by login email/phone including a changed login email, non-owner searches name/campus only, tampered cursors 400 not 500).
- Unpaged lists: teams, service types, folders, songbooks (list and 250-song chunked check), access members and grants are fixed. Two paths are NOT: **team members** inside GET /teams and GET /teams/:id (W9-DATA-D1) and **scope access** endpoints (W9-DATA-D2).
- W8-NAT-D1 (API/RLS half): decision implemented correctly. All 1,344 (team, person) roster rows match the SQL expectation exactly for owner, admin, leader, member and child callers; adults show name, email, phone, date of birth; the child shows name and avatar only; archived people absent; other private People fields are not readable by non-owners (people table 403, directory view has no contact columns, person_medical_note null); non-member, inactive member, other-org owner and anon get no rows or are denied; the API route shows no "Unknown" past 1,000 roster rows.

## Results

### W8-PERF-D2 - GET /people full list, invitations, CSV/JSON reports

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-PERF-D2.people.list | owner | GET /people | 2283 rows, 0 dup | 200 2283 rows, dup=0, 1259ms 766KB | PASS |
| W8-PERF-D2.people.list | admin | GET /people | 2283 rows, 0 dup | 200 2283 rows, dup=0, 627ms 697KB | PASS |
| W8-PERF-D2.people.list | leader | GET /people | 2283 rows, 0 dup | 200 2283 rows, dup=0, 551ms 697KB | PASS |
| W8-PERF-D2.people.list | member | GET /people | 2283 rows, 0 dup | 200 2283 rows, dup=0, 586ms 697KB | PASS |
| W8-PERF-D2.people.list | child | GET /people | 2283 rows, 0 dup | 200 2283 rows, dup=0, 617ms 697KB | PASS |
| W8-PERF-D2.people.list.archived | owner | GET /people?include_archived=true | 2285 | 2285 | PASS |
| W8-PERF-D2.invitations.list | owner | GET /people invite_pending flags | 1050 (past 1,000 cap) | 1050 | PASS |
| W8-PERF-D2.invitations.list.member | member | GET /people invite_pending |  1050 (flag visible to members as before?) | 0 | NOT_APPLICABLE |
| W8-PERF-D2.report.schedule.R1 | owner | GET /reports/schedule 2026-12-01..2027-01-05 | DB: 1494 assignments/46 plans (plan cap 500, row cap 2000) -> 1494 rows, truncated=false, every row has times | 200 rows=1494 truncated=false summary={"plans":46,"assignments":1494,"people":45} noTimes=0 210ms | PASS |
| W8-PERF-D2.report.schedule.csv.R1 | owner | GET /reports/schedule?format=csv 2026-12-01..2027-01-05 | 1494 data rows, Truncated line=false | 200 rows=1494 truncatedLine=false | PASS |
| W8-PERF-D2.report.schedule.R1 | admin | GET /reports/schedule 2026-12-01..2027-01-05 | DB: 1494 assignments/46 plans (plan cap 500, row cap 2000) -> 1494 rows, truncated=false, every row has times | 200 rows=1494 truncated=false summary={"plans":46,"assignments":1494,"people":45} noTimes=0 198ms | PASS |
| W8-PERF-D2.report.schedule.R1 | leader | GET /reports/schedule 2026-12-01..2027-01-05 | DB: 1494 assignments/46 plans (plan cap 500, row cap 2000) -> 1494 rows, truncated=false, every row has times | 200 rows=1494 truncated=false summary={"plans":46,"assignments":1494,"people":45} noTimes=0 208ms | PASS |
| W8-PERF-D2.report.schedule.R2 | owner | GET /reports/schedule 2027-01-01..2027-01-31 | DB: 2511 assignments/59 plans (plan cap 500, row cap 2000) -> 2000 rows, truncated=true, every row has times | 200 rows=2000 truncated=true summary={"plans":59,"assignments":2511,"people":45} noTimes=0 411ms | PASS |
| W8-PERF-D2.report.schedule.csv.R2 | owner | GET /reports/schedule?format=csv 2027-01-01..2027-01-31 | 2000 data rows, Truncated line=true | 200 rows=2000 truncatedLine=true | PASS |
| W8-PERF-D2.report.schedule.R2 | admin | GET /reports/schedule 2027-01-01..2027-01-31 | DB: 2511 assignments/59 plans (plan cap 500, row cap 2000) -> 2000 rows, truncated=true, every row has times | 200 rows=2000 truncated=true summary={"plans":59,"assignments":2511,"people":45} noTimes=0 516ms | PASS |
| W8-PERF-D2.report.schedule.R2 | leader | GET /reports/schedule 2027-01-01..2027-01-31 | DB: 2511 assignments/59 plans (plan cap 500, row cap 2000) -> 2000 rows, truncated=true, every row has times | 200 rows=2000 truncated=true summary={"plans":59,"assignments":2511,"people":45} noTimes=0 448ms | PASS |
| W8-PERF-D2.report.schedule.R3 | owner | GET /reports/schedule 2027-02-28..2027-03-31 | DB: 830 assignments/520 plans (plan cap 500, row cap 2000) -> 810 rows, truncated=true, every row has times | 200 rows=810 truncated=true summary={"plans":500,"assignments":810,"people":2} noTimes=0 162ms | PASS |
| W8-PERF-D2.report.schedule.csv.R3 | owner | GET /reports/schedule?format=csv 2027-02-28..2027-03-31 | 810 data rows, Truncated line=true | 200 rows=810 truncatedLine=true | PASS |
| W8-PERF-D2.report.schedule.R3 | admin | GET /reports/schedule 2027-02-28..2027-03-31 | DB: 830 assignments/520 plans (plan cap 500, row cap 2000) -> 810 rows, truncated=true, every row has times | 200 rows=810 truncated=true summary={"plans":500,"assignments":810,"people":2} noTimes=0 170ms | PASS |
| W8-PERF-D2.report.schedule.R3 | leader | GET /reports/schedule 2027-02-28..2027-03-31 | DB: 830 assignments/520 plans (plan cap 500, row cap 2000) -> 810 rows, truncated=true, every row has times | 200 rows=810 truncated=true summary={"plans":500,"assignments":810,"people":2} noTimes=0 174ms | PASS |
| W8-PERF-D2.report.schedule.R4 | owner | GET /reports/schedule 2026-12-01..2026-12-31 | DB: 899 assignments/31 plans (plan cap 500, row cap 2000) -> 899 rows, truncated=false, every row has times | 200 rows=899 truncated=false summary={"plans":31,"assignments":899,"people":29} noTimes=0 114ms | PASS |
| W8-PERF-D2.report.schedule.csv.R4 | owner | GET /reports/schedule?format=csv 2026-12-01..2026-12-31 | 899 data rows, Truncated line=false | 200 rows=899 truncatedLine=false | PASS |
| W8-PERF-D2.report.schedule.R4 | admin | GET /reports/schedule 2026-12-01..2026-12-31 | DB: 899 assignments/31 plans (plan cap 500, row cap 2000) -> 899 rows, truncated=false, every row has times | 200 rows=899 truncated=false summary={"plans":31,"assignments":899,"people":29} noTimes=0 122ms | PASS |
| W8-PERF-D2.report.schedule.R4 | leader | GET /reports/schedule 2026-12-01..2026-12-31 | DB: 899 assignments/31 plans (plan cap 500, row cap 2000) -> 899 rows, truncated=false, every row has times | 200 rows=899 truncated=false summary={"plans":31,"assignments":899,"people":29} noTimes=0 129ms | PASS |
| W8-PERF-D2.report.participation.R1.rehearsals=false | owner | GET /reports/participation 2026-12-01..2027-01-05 | assignments=1494 present=693 absent=351 | assignments=1494 present=693 absent=351 rows=45 truncated=false 834ms | PASS |
| W8-PERF-D2.report.participation.R1.rehearsals=true | owner | GET /reports/participation 2026-12-01..2027-01-05 | assignments=1494 present=1386 absent=702 | assignments=1494 present=1386 absent=702 rows=45 truncated=false 798ms | PASS |
| W8-PERF-D2.report.participation.csv.R1 | owner | CSV | 200 text/csv | 200 4005B lines=67 | PASS |
| W8-PERF-D2.report.participation.R4.rehearsals=false | owner | GET /reports/participation 2026-12-01..2026-12-31 | assignments=899 present=596 absent=303 | assignments=899 present=596 absent=303 rows=29 truncated=false 483ms | PASS |
| W8-PERF-D2.report.participation.R4.rehearsals=true | owner | GET /reports/participation 2026-12-01..2026-12-31 | assignments=899 present=1192 absent=606 | assignments=899 present=1192 absent=606 rows=29 truncated=false 482ms | PASS |
| W8-PERF-D2.report.participation.csv.R4 | owner | CSV | 200 text/csv | 200 3023B lines=51 | PASS |
| W8-PERF-D2.report.staffing.R2 | owner | GET /reports/staffing (rows are per plan/position) | rows<=2000, truncated=true (59 plans) | 200 rows=59 truncated=false | PASS |
| W8-PERF-D2.report.denied | member | GET /reports/schedule | 403 | 403 | PASS |
| W8-PERF-D2.report.denied | child | GET /reports/schedule | 403 | 403 | PASS |
| W8-PERF-D2.report.nonmember | nomem | GET /reports/schedule | 403 | 403 | PASS |
| W8-PERF-D2.report.other-org | bowner | GET /reports/schedule X-Org=A | 403 | 403 | PASS |
| W8-PERF-D2.report.other-org-own | bowner | GET /reports/schedule org B | 0 rows, no A data | 200 rows=0 | PASS |
| W8-PERF-D2.report.range>366 | owner | from..to 2 years | 4xx | 422 | PASS |

### W8-PERF-D3 - GET /conversations legacy array vs paged

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-PERF-D3.legacy-array | owner | GET /conversations (no params) | array of 120, same order | array 120, uniq 120, order=true, 91ms | PASS |
| W8-PERF-D3.paged@7 | owner | GET /conversations?limit=7 walk | 120 rows, no dup/loss, same order | 120 rows 18 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@50 | owner | GET /conversations?limit=50 walk | 120 rows, no dup/loss, same order | 120 rows 3 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@100 | owner | GET /conversations?limit=100 walk | 120 rows, no dup/loss, same order | 120 rows 2 pages uniq 120 order=true | PASS |
| W8-PERF-D3.legacy-array | admin | GET /conversations (no params) | array of 120, same order | array 120, uniq 120, order=true, 83ms | PASS |
| W8-PERF-D3.paged@7 | admin | GET /conversations?limit=7 walk | 120 rows, no dup/loss, same order | 120 rows 18 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@50 | admin | GET /conversations?limit=50 walk | 120 rows, no dup/loss, same order | 120 rows 3 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@100 | admin | GET /conversations?limit=100 walk | 120 rows, no dup/loss, same order | 120 rows 2 pages uniq 120 order=true | PASS |
| W8-PERF-D3.legacy-array | leader | GET /conversations (no params) | array of 120, same order | array 120, uniq 120, order=true, 80ms | PASS |
| W8-PERF-D3.paged@7 | leader | GET /conversations?limit=7 walk | 120 rows, no dup/loss, same order | 120 rows 18 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@50 | leader | GET /conversations?limit=50 walk | 120 rows, no dup/loss, same order | 120 rows 3 pages uniq 120 order=true | PASS |
| W8-PERF-D3.paged@100 | leader | GET /conversations?limit=100 walk | 120 rows, no dup/loss, same order | 120 rows 2 pages uniq 120 order=true | PASS |
| W8-PERF-D3.legacy-array | member | GET /conversations (no params) | array of 20, same order | array 20, uniq 20, order=true, 58ms | PASS |
| W8-PERF-D3.paged@7 | member | GET /conversations?limit=7 walk | 20 rows, no dup/loss, same order | 20 rows 3 pages uniq 20 order=true | PASS |
| W8-PERF-D3.paged@50 | member | GET /conversations?limit=50 walk | 20 rows, no dup/loss, same order | 20 rows 1 pages uniq 20 order=true | PASS |
| W8-PERF-D3.paged@100 | member | GET /conversations?limit=100 walk | 20 rows, no dup/loss, same order | 20 rows 1 pages uniq 20 order=true | PASS |
| W8-PERF-D3.legacy-array | child | GET /conversations (no params) | array of 0, same order | array 0, uniq 0, order=true, 20ms | PASS |
| W8-PERF-D3.paged@7 | child | GET /conversations?limit=7 walk | 0 rows, no dup/loss, same order | 0 rows 1 pages uniq 0 order=true | PASS |
| W8-PERF-D3.paged@50 | child | GET /conversations?limit=50 walk | 0 rows, no dup/loss, same order | 0 rows 1 pages uniq 0 order=true | PASS |
| W8-PERF-D3.paged@100 | child | GET /conversations?limit=100 walk | 0 rows, no dup/loss, same order | 0 rows 1 pages uniq 0 order=true | PASS |
| W8-PERF-D3.has_more | leader | limit=50 page1 | has_more true, 50 items, next_cursor | 50 has_more=true cursor=true | PASS |
| W8-PERF-D3.has_more.last | member | limit=100 (member has 20) | has_more false, no cursor | 20 has_more=false cursor=null | PASS |
| W8-PERF-D3.paged.cursor-only | leader | ?cursor=… only | paged shape / 400, not legacy array | 400 {"error":"Invalid cursor","code":"bad_request"} | PASS |
| W8-PERF-D3.invalid.limit0 | leader | GET /conversations?limit=0 | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.invalid.limit101 | leader | GET /conversations?limit=101 | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.invalid.limit-1 | leader | GET /conversations?limit=-1 | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.invalid.limitabc | leader | GET /conversations?limit=abc | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.invalid.cursor-garbage | leader | GET /conversations?limit=5&cursor=!!! | 4xx not 5xx | 400 Invalid cursor | PASS |
| W8-PERF-D3.invalid.cursor-b64 | leader | GET /conversations?limit=5&cursor=aGk | 4xx not 5xx | 400 Invalid cursor | PASS |
| W8-PERF-D3.invalid.cursor-json | leader | GET /conversations?limit=5&cursor=eyJhIjoxfQ | 4xx not 5xx | 400 Invalid cursor | PASS |
| W8-PERF-D3.invalid.cursor-empty | leader | GET /conversations?cursor= | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.invalid.limit-empty | leader | GET /conversations?limit= | 4xx not 5xx | 422 Invalid query parameters | PASS |
| W8-PERF-D3.nonmember | nomem | GET /conversations | 403 | 403 | PASS |
| W8-PERF-D3.other-org-header | bowner | GET /conversations X-Org=A | 403 | 403 | PASS |
| W8-PERF-D3.other-org-own | bowner | GET /conversations (org B) | []  | [] | PASS |
| W8-PERF-D3.inactive | inactive | GET /conversations | 403 | 403 | PASS |
| W8-PERF-D3.other-org-paged | bowner | paged with A header | 403 | 403 | PASS |

### PEOPLE - GET /people/page (paging, cursor, limits, private fields, access)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE.page.walk@100 | owner | GET /people/page limit=100 walk | 2283 rows unique, order = sort_name,id | 2283 rows, 23 pages, uniq=2283, orderMatch=true | PASS |
| PEOPLE.page.walk@100 | admin | GET /people/page limit=100 walk | 2283 rows unique, order = sort_name,id | 2283 rows, 23 pages, uniq=2283, orderMatch=true | PASS |
| PEOPLE.page.walk@100 | leader | GET /people/page limit=100 walk | 2283 rows unique, order = sort_name,id | 2283 rows, 23 pages, uniq=2283, orderMatch=true | PASS |
| PEOPLE.page.walk@100 | member | GET /people/page limit=100 walk | 2283 rows unique, order = sort_name,id | 2283 rows, 23 pages, uniq=2283, orderMatch=true | PASS |
| PEOPLE.page.walk@100 | child | GET /people/page limit=100 walk | 2283 rows unique, order = sort_name,id | 2283 rows, 23 pages, uniq=2283, orderMatch=true | PASS |
| PEOPLE.page.walk@25 | owner | walk limit=25 | 2283 rows | 2283 rows 92 pages orderMatch=true | PASS |
| PEOPLE.page.default25 | owner | GET /people/page no limit | 25 items | 25 items, cursor yes | PASS |
| PEOPLE.page.archived | owner | walk include_archived | 2285 | 2285 | PASS |
| PEOPLE.page.limit=0 | owner | GET /people/page | 422 | 422 | PASS |
| PEOPLE.page.limit=101 | owner | GET /people/page | 422 | 422 | PASS |
| PEOPLE.page.limit=-1 | owner | GET /people/page | 422 | 422 | PASS |
| PEOPLE.page.limit=abc | owner | GET /people/page | 422 | 422 | PASS |
| PEOPLE.page.limit=1 | owner | GET /people/page | 200 | 200 n=1 | PASS |
| PEOPLE.page.limit=100 | owner | GET /people/page | 200 | 200 n=100 | PASS |
| PEOPLE.page.limit=25 | owner | GET /people/page | 200 | 200 n=25 | PASS |
| PEOPLE.page.limit=1.5 | owner | GET /people/page | 422 | 422 | PASS |
| PEOPLE.page.cursor.garbage | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.garbage-ascii | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.b64-nonjson | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.json-wrong-shape | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.json-tuple-bad-uuid | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.tuple-3 | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.tuple-num | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.truncated | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.tooLong | owner | GET /people/page?cursor=… | 4xx not 5xx | 422 Invalid query parameters | PASS |
| PEOPLE.page.cursor.empty | owner | GET /people/page?cursor=… | 4xx not 5xx | 422 Invalid query parameters | PASS |
| PEOPLE.page.cursor.sqlish | owner | GET /people/page?cursor=… | 4xx not 5xx | 200 n=2 | PASS |
| PEOPLE.page.cursor.postgrest-inject | owner | GET /people/page?cursor=… | 4xx not 5xx | 200 n=25 | PASS |
| PEOPLE.page.cursor.other-org-id | owner | GET /people/page?cursor=… | 4xx not 5xx | 200 n=25 | PASS |
| PEOPLE.page.cursor.null-byte | owner | GET /people/page?cursor=… | 4xx not 5xx | 400 Invalid cursor | PASS |
| PEOPLE.page.cursor.lone-surrogate | owner | GET /people/page?cursor=… | 4xx not 5xx | 200 n=25 | PASS |
| PEOPLE.page.cursor.postgrest-inject.verify | owner | well-formed cursor with filter metacharacters | treated as data: same rows as SQL keyset | match=true | PASS |
| PEOPLE.thai.search+paging@3 | owner | q=ก limit=3 walk | 2 rows (Thai names, 161 chars) | 2 rows 1 pages | PASS |
| PEOPLE.thai.search+paging@3 | member | q=ก limit=3 walk | 2 rows (Thai names, 161 chars) | 2 rows 1 pages | PASS |
| PEOPLE.thai.cursor.len | owner | limit=1 q=ก cursor chars | <= 1400 and walk completes | rows=2 maxCursor=699 | PASS |
| PEOPLE.page.nonowner.own-contact | member | own row contact | own email visible, others null | own email=member.qaw9.data@example.test | PASS |
| PEOPLE.invitations.paged | owner | page walk q=Inv | 1050 rows all pending | 1050 rows, 1050 pending | PASS |
| PEOPLE.private.nonowner-body-scan | admin | GET /people + /people/page bodies | no private fields; no email/phone except own | secretScan=clean othersWithEmail=0 | PASS |
| PEOPLE.private.nonowner-body-scan | leader | GET /people + /people/page bodies | no private fields; no email/phone except own | secretScan=clean othersWithEmail=0 | PASS |
| PEOPLE.private.nonowner-body-scan | member | GET /people + /people/page bodies | no private fields; no email/phone except own | secretScan=clean othersWithEmail=0 | PASS |
| PEOPLE.private.nonowner-body-scan | child | GET /people + /people/page bodies | no private fields; no email/phone except own | secretScan=clean othersWithEmail=0 | PASS |
| PEOPLE.private.owner-sees-contact | owner | GET /people/page | contact visible, address/medical not in list | address=false medical=false emailPresent=true | PASS |
| PEOPLE.private.detail-owner-only | member | GET /people/:id | 403 | 403 | PASS |
| PEOPLE.private.detail-owner-only | admin | GET /people/:id | 403 | 403 | PASS |
| PEOPLE.private.detail-owner-only | leader | GET /people/:id | 403 | 403 | PASS |
| PEOPLE.private.detail-owner | owner | GET /people/:id | 200 with private fields | 200 addr=true | PASS |
| PEOPLE.denied.nomem | nomem | GET /people (A) | 403 | 403 | PASS |
| PEOPLE.denied.nomem | nomem | GET /people/page (A) | 403 | 403 | PASS |
| PEOPLE.denied.inactive | inactive | GET /people (A) | 403 | 403 | PASS |
| PEOPLE.denied.inactive | inactive | GET /people/page (A) | 403 | 403 | PASS |
| PEOPLE.denied.bowner | bowner | GET /people (A) | 403 | 403 | PASS |
| PEOPLE.denied.bowner | bowner | GET /people/page (A) | 403 | 403 | PASS |
| PEOPLE.other-org.own | bowner | GET /people/page (B) | only B people, no A | 1 items  | PASS |
| PEOPLE.other-org.search-A-names | bowner | q=Bulk in org B | 0 | 0 | PASS |
| PEOPLE.other-org.owner-A-header-B | owner | A owner with org B header | 403 | 403 | PASS |
| PERF.people.page.latency | owner | GET /people/page?limit=100 x10 (2,283 people) | informational | p50=55 max=61ms | INFO |
| PERF.people.list.latency | member | GET /people x10 (2,283 people, 697KB) | informational | p50=587 max=611ms | INFO |

### PEOPLE - search (literal symbols, Thai, owner contact search, non-owner scope)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE.search.literal.star | owner | /people/page?q="*" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.star | member | /people/page?q="*" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.pct | owner | /people/page?q="%" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.pct | member | /people/page?q="%" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.under | owner | /people/page?q="_" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.under | member | /people/page?q="_" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.backslash | owner | /people/page?q="\\" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.backslash | member | /people/page?q="\\" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.dq | owner | /people/page?q="\"" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.dq | member | /people/page?q="\"" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.comma | owner | /people/page?q="," limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.comma | member | /people/page?q="," limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.paren | owner | /people/page?q=")" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.paren | member | /people/page?q=")" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.paren-open | owner | /people/page?q="(" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.paren-open | member | /people/page?q="(" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.literal.dot | owner | /people/page?q="." limit=100 | 2161 rows (SQL literal match) | 2161 rows 22 pages | PASS |
| PEOPLE.search.literal.dot | member | /people/page?q="." limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.plus | owner | /people/page?q="+" limit=100 | 2152 rows (SQL literal match) | 2152 rows 22 pages | PASS |
| PEOPLE.search.literal.plus | member | /people/page?q="+" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.bracket | owner | /people/page?q="[" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.bracket | member | /people/page?q="[" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.caret | owner | /people/page?q="^" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.caret | member | /people/page?q="^" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.dollar | owner | /people/page?q="$" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.dollar | member | /people/page?q="$" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.pipe | owner | /people/page?q="\|" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.pipe | member | /people/page?q="\|" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.q-mark | owner | /people/page?q="?" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.q-mark | member | /people/page?q="?" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.brace | owner | /people/page?q="{" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.brace | member | /people/page?q="{" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.amp-or | owner | /people/page?q="),id.gt.0,or(a.eq." limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.literal.amp-or | member | /people/page?q="),id.gt.0,or(a.eq." limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.star-not-everyone | owner | q=* | 1 row, not 100 | 1 rows | PASS |
| PEOPLE.search.pct-not-everyone | owner | q=% | 1 row | 1 | PASS |
| PEOPLE.search.owner.login-email | owner | /people/page?q="bulk0002.qaw9" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.login-email | member | /people/page?q="bulk0002.qaw9" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.owner.login-phone | owner | /people/page?q="+15550000002" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.login-phone | member | /people/page?q="+15550000002" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.owner.login-phone-partial | owner | /people/page?q="0000011" limit=100 | 2 rows (SQL literal match) | 2 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.login-phone-partial | member | /people/page?q="0000011" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.owner.people-row-email | owner | /people/page?q="inv12@" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.people-row-email | member | /people/page?q="inv12@" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.owner.people-row-phone | owner | /people/page?q="+16660000012" limit=100 | 1 rows (SQL literal match) | 1 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.people-row-phone | member | /people/page?q="+16660000012" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.owner.campus | owner | /people/page?q="East" limit=100 | 525 rows (SQL literal match) | 525 rows 6 pages | PASS |
| PEOPLE.search.nonowner-scope.campus | member | /people/page?q="East" limit=100 | 525 rows (SQL literal match) | 525 rows 6 pages | PASS |
| PEOPLE.search.nonowner-scope.login-email | admin | /people/page?q="bulk0002.qaw9" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.login-email | leader | /people/page?q="bulk0002.qaw9" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.nonowner-scope.login-email | child | /people/page?q="bulk0002.qaw9" limit=100 | 0 rows (SQL literal match) | 0 rows 1 pages | PASS |
| PEOPLE.search.nonowner-no-contact-oracle | member | q=<phone of another member> | 0 rows (phone not searchable) | 0 | PASS |
| PEOPLE.search.nonowner-no-email-oracle | member | q=<email of another member> | 0 rows | 0 | PASS |
| PEOPLE.search.q101 | owner | q len 101 | 4xx | 422 | PASS |
| PEOPLE.search.q-blank | owner | q=whitespace | 200 = unfiltered (25) | 200 n=25 | PASS |
| PEOPLE.search.owner.changed-login-email | owner | q=<new login email> (people.email stale) | 1 row, row shows same email | 1 rows email=changed.login3@example.test | PASS |
| PEOPLE.search.owner.stale-people-email | owner | q=<old email on people row only> | 0 rows (list shows login email) | 0 | PASS |
| PEOPLE.search.owner.login-phone-changed | owner | q=<phone> | 1 row | 1 | PASS |
| PEOPLE.search.nonowner.changed-email | member | q=<login email> | 0 rows | 0 | PASS |

### PAGED - lists past 1,000 (teams, team members, folders, service types, songbooks, access)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PAGED.teams | owner | GET /teams | 1050 teams, uniq, ordered (sort_order,id) | 200 1050 uniq=1050 ordered=true 169ms 0.94MB | PASS |
| PAGED.teams | admin | GET /teams | 1050 teams, uniq, ordered (sort_order,id) | 200 1050 uniq=1050 ordered=true 166ms 0.94MB | PASS |
| PAGED.teams | leader | GET /teams | 1050 teams, uniq, ordered (sort_order,id) | 200 1050 uniq=1050 ordered=true 171ms 0.94MB | PASS |
| PAGED.teams | member | GET /teams | 1050 teams, uniq, ordered (sort_order,id) | 200 1050 uniq=1050 ordered=true 170ms 0.94MB | PASS |
| PAGED.teams | child | GET /teams | 1050 teams, uniq, ordered (sort_order,id) | 200 1050 uniq=1050 ordered=true 168ms 0.94MB | PASS |
| PAGED.service-types | owner | GET /service-types | 1050 | 1050 uniq=1050 | PASS |
| PAGED.service-types | member | GET /service-types | 1050 | 1050 uniq=1050 | PASS |
| PAGED.service-types.archived | owner | include_archived=true | 1050 | 1050 | PASS |
| PAGED.folders | owner | GET /folders | 1050 folders; 1050 service types placed (folders+unfiled) | folders=1050 stInFolders=1050 unfiled=0 keys=id,organization_id,parent_id,name,sort_order,revision,archived_at,created_by,cre | PASS |
| PAGED.folders | member | GET /folders | 1050 folders; 1050 service types placed (folders+unfiled) | folders=1050 stInFolders=1050 unfiled=0 keys=id,organization_id,parent_id,name,sort_order,revision,archived_at,created_by,cre | PASS |
| PAGED.folders | leader | GET /folders | 1050 folders; 1050 service types placed (folders+unfiled) | folders=1050 stInFolders=1050 unfiled=0 keys=id,organization_id,parent_id,name,sort_order,revision,archived_at,created_by,cre | PASS |
| PAGED.songbooks | owner | GET /songbooks | 1052 uniq ordered | 1052 uniq=1052 ordered=true | PASS |
| PAGED.songbooks | member | GET /songbooks | 1052 uniq ordered | 1052 uniq=1052 ordered=true | PASS |
| PAGED.songbooks | leader | GET /songbooks | 1052 uniq ordered | 1052 uniq=1052 ordered=true | PASS |
| PAGED.songbooks.create.250songs(chunked .in) | owner | POST /songbooks 250 songs (3 chunks) | 201, 250 items | 201 items=250 | PASS |
| PAGED.songbooks.create.foreign-song-in-late-chunk | owner | POST /songbooks 199 own + 1 org-B song (2nd chunk) | 400 no row created | 400 Every selected song must belong to this organization booksNamed=0 | PASS |
| PAGED.songbooks.create.duplicate-songs | owner | POST /songbooks same 150 songs twice | 201 or 4xx, never 5xx | 409 That record already exists | PASS |
| PAGED.songbooks.create.member | member | POST /songbooks | 403 | 403 | PASS |
| PAGED.songbooks.create.cross-org-songs | bowner | POST /songbooks (org B) with A song ids | 400 | 400 | PASS |
| PAGED.songbooks.detail.250 | owner | GET /songbooks/:id | 250 items ordered | 200 250 | PASS |
| PAGED.access.members | owner | GET /access/members | 1105 members, 4401 grants | 200 members=1105 uniq=1105 grants=4401 636ms | PASS |
| PAGED.access.members | admin | GET /access/members | 1105/4401 | 1105/4401 | PASS |
| PAGED.access.members.denied | member | GET /access/members | 403 | 403 | PASS |
| PAGED.access.members.denied | leader | GET /access/members | 403 | 403 | PASS |
| PAGED.access.members.denied | child | GET /access/members | 403 | 403 | PASS |
| PAGED.access.members.cross-org | bowner | GET /access/members X-Org=A | 403 | 403 | PASS |
| PAGED.access.scope.service-type(1100 grants) | owner | GET /service-types/:id/access | 200, 1100 grants | 502 upstream_error | FAIL (W9-DATA-D2) |
| PAGED.access.scope.organization(1101 grants) | owner | GET /access/organization | 200, 1101 grants | 502 upstream_error | FAIL (W9-DATA-D2) |
| PAGED.access.scope.team(150 grantees) | owner | GET /teams/:id/access | 200, 150 grants | 200 150 | PASS |
| PAGED.access.scope.team(180 grantees) | owner | GET /teams/:id/access | 200, 180 grants | 200 180 | PASS |
| PAGED.access.scope.team(200 grantees) | owner | GET /teams/:id/access | 200, 200 grants | 200 200 | PASS |
| PAGED.access.scope.team(220 grantees) | owner | GET /teams/:id/access | 200, 220 grants | 502 upstream_error | FAIL (W9-DATA-D2) |
| PAGED.access.scope.team(300 grantees) | owner | GET /teams/:id/access | 200, 300 grants | 502 upstream_error | FAIL (W9-DATA-D2) |
| PAGED.access.scope.team(600 grantees) | owner | GET /teams/:id/access | 200, 600 grants | 502 upstream_error | FAIL (W9-DATA-D2) |
| PAGED.access.scope.PUT(300 grants) | admin | PUT /teams/:id/access 300 grants | 200 echo of 300 grants | 502 upstream_error; committed rows=300 | FAIL (W9-DATA-D2) |
| PAGED.access.scope.denied | member | GET /teams/:id/access | 403 | 403 | PASS |
| PAGED.access.scope.denied | leader | GET /teams/:id/access | 403 | 403 | PASS |
| PAGED.team-members.detail | owner | GET /teams/:id (Team 0001, 1,108 membership rows) | 1108 members | 200 members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.list | owner | GET /teams (Team 0001 members) | 1108 members | members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.detail | admin | GET /teams/:id (Team 0001, 1,108 membership rows) | 1108 members | 200 members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.list | admin | GET /teams (Team 0001 members) | 1108 members | members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.detail | leader | GET /teams/:id (Team 0001, 1,108 membership rows) | 1108 members | 200 members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.list | leader | GET /teams (Team 0001 members) | 1108 members | members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.detail | member | GET /teams/:id (Team 0001, 1,108 membership rows) | 1108 members | 200 members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.list | member | GET /teams (Team 0001 members) | 1108 members | members=1000 | FAIL (W9-DATA-D1) |
| PAGED.team-members.root-cause | owner | PostgREST embed vs flat, caller JWT | embed returns all rows if embeds are not capped | embed=1000 flat page=1000 total=0-999/1108 | INFO |

### W8-NAT-D1 - team_roster_people (RPC with caller JWT and API route)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-NAT-D1.rpc.all-rows+fields | owner | PostgREST RPC team_roster_people(A), caller JWT, paged | 1344 (team,person) rows == SQL expectation (adult name/email/phone/dob; child name only; archived hidden) | 1344 rows uniq=1344 exactMatch=true extraCols=false | PASS |
| W8-NAT-D1.rpc.all-rows+fields | admin | PostgREST RPC team_roster_people(A), caller JWT, paged | 1344 (team,person) rows == SQL expectation (adult name/email/phone/dob; child name only; archived hidden) | 1344 rows uniq=1344 exactMatch=true extraCols=false | PASS |
| W8-NAT-D1.rpc.all-rows+fields | leader | PostgREST RPC team_roster_people(A), caller JWT, paged | 1344 (team,person) rows == SQL expectation (adult name/email/phone/dob; child name only; archived hidden) | 1344 rows uniq=1344 exactMatch=true extraCols=false | PASS |
| W8-NAT-D1.rpc.all-rows+fields | member | PostgREST RPC team_roster_people(A), caller JWT, paged | 1344 (team,person) rows == SQL expectation (adult name/email/phone/dob; child name only; archived hidden) | 1344 rows uniq=1344 exactMatch=true extraCols=false | PASS |
| W8-NAT-D1.rpc.all-rows+fields | child | PostgREST RPC team_roster_people(A), caller JWT, paged | 1344 (team,person) rows == SQL expectation (adult name/email/phone/dob; child name only; archived hidden) | 1344 rows uniq=1344 exactMatch=true extraCols=false | PASS |
| W8-NAT-D1.rpc.cap-visible | member | RPC unpaged call | capped at 1000 by max_rows (informational) total=1344 | 1000 rows | PASS |
| W8-NAT-D1.private.people-table | member | PostgREST GET people (private cols) | denied / no private values | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr leak=false | PASS |
| W8-NAT-D1.private.people_directory-cols | member | PostgREST GET people_directory | no email/phone/address/birthdate/medical cols | 200 cols=id,organization_id,profile_id,first_name,last_name,avatar_url,campus,person_type,created_at,updated_at,archived_at,schedulable,sort_name | PASS |
| W8-NAT-D1.private.people-table | leader | PostgREST GET people (private cols) | denied / no private values | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr leak=false | PASS |
| W8-NAT-D1.private.people_directory-cols | leader | PostgREST GET people_directory | no email/phone/address/birthdate/medical cols | 200 cols=id,organization_id,profile_id,first_name,last_name,avatar_url,campus,person_type,created_at,updated_at,archived_at,schedulable,sort_name | PASS |
| W8-NAT-D1.private.people-table | admin | PostgREST GET people (private cols) | denied / no private values | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr leak=false | PASS |
| W8-NAT-D1.private.people_directory-cols | admin | PostgREST GET people_directory | no email/phone/address/birthdate/medical cols | 200 cols=id,organization_id,profile_id,first_name,last_name,avatar_url,campus,person_type,created_at,updated_at,archived_at,schedulable,sort_name | PASS |
| W8-NAT-D1.private.people-table | child | PostgREST GET people (private cols) | denied / no private values | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the curr leak=false | PASS |
| W8-NAT-D1.private.people_directory-cols | child | PostgREST GET people_directory | no email/phone/address/birthdate/medical cols | 200 cols=id,organization_id,profile_id,first_name,last_name,avatar_url,campus,person_type,created_at,updated_at,archived_at,schedulable,sort_name | PASS |
| W8-NAT-D1.private.profiles | member | PostgREST GET profiles of others | no contact exposed | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| W8-NAT-D1.private.medical-note-rpc | member | RPC person_medical_note(leader person) | null/denied | 200 null | PASS |
| W8-NAT-D1.child-name-avatar-only | member | RPC rows for child-linked person | 3 teams (0001-0003), name present, email/phone/dob null | 3 rows; first={"team_id":"1392ae83-6eff-46e5-ac37-bd87b48961ef","person_id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","first_name":"QA9","last_name":"Child","avatar_url":null,"email":null,"phone":null,"birthdate":null} | PASS |
| W8-NAT-D1.archived-hidden | member | RPC rows for archived people | 0 | 0 | PASS |
| W8-NAT-D1.adult-contact-visible | member | teammate's name/email/phone/dob | email+phone+dob present | {"team_id":"047de479-71b5-4a8b-8e24-afb10eca62c2","person_id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","first_name":"QA9","last_name":"Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"birthdate":"1985-03-04"} | PASS |
| W8-NAT-D1.denied.nomem | nomem | RPC team_roster_people(A) caller JWT | 0 rows or error (no A data) | 200 0 rows | PASS |
| W8-NAT-D1.denied.inactive | inactive | RPC team_roster_people(A) caller JWT | 0 rows or error (no A data) | 200 0 rows | PASS |
| W8-NAT-D1.denied.bowner | bowner | RPC team_roster_people(A) caller JWT | 0 rows or error (no A data) | 200 0 rows | PASS |
| W8-NAT-D1.denied.anon | anon | RPC team_roster_people(A) anon key only | 401/403 permission denied | 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func | PASS |
| W8-NAT-D1.other-org.own-org | bowner | RPC team_roster_people(B) | B own roster only (1 row) | 200 [{"team_id":"d93ffc40-326f-4ace-9d7e-f6ebd7bb6198","person_id":"dece6ca3-c3ee-4e81-b7d2-2c6db65be492","first_name":"QA9","last_name":"Bowner | PASS |
| W8-NAT-D1.other-org.A-owner-asks-B | owner | RPC team_roster_people(B) as A owner | 0 rows | 200 0 | PASS |
| W8-NAT-D1.unknown-org | member | RPC random org | 0 rows | 200 [] | PASS |
| W8-NAT-D1.null-org | member | RPC p_org=null | 0 rows/4xx | 200 [] | PASS |
| W8-NAT-D1.bad-uuid | member | RPC p_org=not-a-uuid | 4xx | 400 | PASS |
| W8-NAT-D1.api.GET-/teams.names | owner | GET /teams (Team 0001) | all returned members named except archived (1); no Unknown | members=1000 nullProfiles=1 | PASS |
| W8-NAT-D1.api.child-shape | owner | GET /teams Team 0002 child member | name only; email/phone/dob null | {"id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","full_name":"QA9 Child","avatar_url":null,"email":null,"phone":null,"date_of_birth":null,"role":"member"} | PASS |
| W8-NAT-D1.api.adult-shape | owner | GET /teams Team 0002 adult member | email/phone/dob visible | {"id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","full_name":"QA9 Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"date_of_birth":"1985-03-04","role":"member"} | PASS |
| W8-NAT-D1.api.GET-/teams.names | admin | GET /teams (Team 0001) | all returned members named except archived (1); no Unknown | members=1000 nullProfiles=1 | PASS |
| W8-NAT-D1.api.child-shape | admin | GET /teams Team 0002 child member | name only; email/phone/dob null | {"id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","full_name":"QA9 Child","avatar_url":null,"email":null,"phone":null,"date_of_birth":null,"role":"member"} | PASS |
| W8-NAT-D1.api.adult-shape | admin | GET /teams Team 0002 adult member | email/phone/dob visible | {"id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","full_name":"QA9 Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"date_of_birth":"1985-03-04","role":"member"} | PASS |
| W8-NAT-D1.api.GET-/teams.names | leader | GET /teams (Team 0001) | all returned members named except archived (1); no Unknown | members=1000 nullProfiles=1 | PASS |
| W8-NAT-D1.api.child-shape | leader | GET /teams Team 0002 child member | name only; email/phone/dob null | {"id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","full_name":"QA9 Child","avatar_url":null,"email":null,"phone":null,"date_of_birth":null,"role":"member"} | PASS |
| W8-NAT-D1.api.adult-shape | leader | GET /teams Team 0002 adult member | email/phone/dob visible | {"id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","full_name":"QA9 Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"date_of_birth":"1985-03-04","role":"member"} | PASS |
| W8-NAT-D1.api.GET-/teams.names | member | GET /teams (Team 0001) | all returned members named except archived (1); no Unknown | members=1000 nullProfiles=1 | PASS |
| W8-NAT-D1.api.child-shape | member | GET /teams Team 0002 child member | name only; email/phone/dob null | {"id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","full_name":"QA9 Child","avatar_url":null,"email":null,"phone":null,"date_of_birth":null,"role":"member"} | PASS |
| W8-NAT-D1.api.adult-shape | member | GET /teams Team 0002 adult member | email/phone/dob visible | {"id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","full_name":"QA9 Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"date_of_birth":"1985-03-04","role":"member"} | PASS |
| W8-NAT-D1.api.GET-/teams.names | child | GET /teams (Team 0001) | all returned members named except archived (1); no Unknown | members=1000 nullProfiles=1 | PASS |
| W8-NAT-D1.api.child-shape | child | GET /teams Team 0002 child member | name only; email/phone/dob null | {"id":"f12b44fc-8443-4f6b-ad0b-f434acbc4195","full_name":"QA9 Child","avatar_url":null,"email":null,"phone":null,"date_of_birth":null,"role":"member"} | PASS |
| W8-NAT-D1.api.adult-shape | child | GET /teams Team 0002 adult member | email/phone/dob visible | {"id":"75b1a0c9-a549-4ef2-b5b7-475b3be0b5bb","full_name":"QA9 Leader","avatar_url":null,"email":"leader.qaw9.data@example.test","phone":null,"date_of_birth":"1985-03-04","role":"member"} | PASS |
| W8-NAT-D1.api.GET-/teams/:id.small | member | GET /teams/:id Team 0002 (standalone people incl.) | all 102 named | members=102 unnamed=0 | PASS |
| W8-NAT-D1.api.GET-/teams/:id.small | leader | GET /teams/:id Team 0002 (standalone people incl.) | all 102 named | members=102 unnamed=0 | PASS |
| W8-NAT-D1.api.no-private-fields | member | GET /teams/:id body scan | no address/medical/etc | null | PASS |
| W8-NAT-D1.api.denied.nomem | nomem | GET /teams (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.denied-detail.nomem | nomem | GET /teams/:id (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.denied.bowner | bowner | GET /teams (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.denied-detail.bowner | bowner | GET /teams/:id (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.denied.inactive | inactive | GET /teams (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.denied-detail.inactive | inactive | GET /teams/:id (A) | 403 | 403 | PASS |
| W8-NAT-D1.api.cross-org-id | bowner | GET /teams/<A team id> with org B header | 404 | 404 | PASS |
| W8-NAT-D1.api.other-org-own | bowner | GET /teams (B) | 1 team, no A data | 1 teams  | PASS |
| W8-NAT-D1.api.no-Unknown-all-teams | member | GET /teams: members with null profile across all teams | only archived (1) unnamed | members=1239 unnamed=1 | PASS |
| W8-NAT-D1.api.no-Unknown-all-teams | owner | GET /teams: members with null profile across all teams | only archived (1) unnamed | members=1239 unnamed=1 | PASS |
| W8-NAT-D1.api.roster-rows-past-1000 | member | members of teams whose roster rows are beyond RPC row 1000 | all named except the 1 archived person | teams=60 members=1170 unnamed=1 | PASS |

### Deferred perf (informational): W8-PERF-D5 /schedule/mine, /calendar; W8-PERF-D4 songs

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-PERF-D5.schedule-mine.include_past | member | GET /schedule/mine?include_past=true (DB: 1,020 released assignments) | informational: size/p95; honest count | 200 entries=1000 1281KB p50=393 p95=486ms max=486 | FAIL (W9-DATA-D4) |
| W8-PERF-D5.schedule-mine.default | member | GET /schedule/mine (future only) | informational | entries=1000 1281KB p50=365 p95=488ms | INFO |
| W8-PERF-D5.schedule-mine.bounded | member | GET /schedule/mine March 2027 window | informational | entries=310 397KB 120ms | INFO |
| W8-PERF-D5.calendar.1month | owner | GET /calendar 2027-03-01..2027-03-31 | informational | 502 {"error":"A required service returned an unexpected response 0KB p50=108 p95=118ms | FAIL (W9-DATA-D3) |
| W8-PERF-D5.calendar.1year | owner | GET /calendar 2027-01-01..2027-12-31 | informational | 502 {"error":"A required service returned an unexpected response 0KB p50=258 p95=268ms | FAIL (W9-DATA-D3) |
| W8-PERF-D5.calendar.wide-300y | owner | GET /calendar 1900-01-01..2200-12-31 | informational | 502 {"error":"A required service returned an unexpected response 0KB p50=294 p95=306ms | FAIL (W9-DATA-D3) |
| W8-PERF-D5.calendar.wide-30y | owner | GET /calendar 2000-01-01..2030-12-31 | informational | 502 {"error":"A required service returned an unexpected response 0KB p50=311 p95=328ms | FAIL (W9-DATA-D3) |
| W8-PERF-D5.calendar.wide-300y.member | member | GET /calendar 300y | informational | 502  0KB p95=324ms | FAIL (W9-DATA-D3) |
| W8-PERF-D4.songs.list | owner | GET /songs?per_page=50 (250 songs) | informational (wave 8: 125 ms vs 2 ms w/o RLS) | 200 undefined 28KB p50=39 p95=44ms | INFO |
| W8-PERF-D4.songs.list | member | GET /songs?per_page=50 (250 songs) | informational (wave 8: 125 ms vs 2 ms w/o RLS) | 200 undefined 28KB p50=42 p95=49ms | INFO |

## Defects

| ID | Pri | Title |
|---|---|---|
| W9-DATA-D1 | P1 | A team with more than 1,000 memberships returns only 1,000 members, silently |
| W9-DATA-D2 | P1 | Scope access endpoints return 502 above about 200 grantees; PUT commits and then reports failure |
| W9-DATA-D3 | P2 | GET /calendar returns 502 above about 205 plans in the window (and has no row cap behind that) |
| W9-DATA-D4 | P2 | GET /schedule/mine silently returns 1,000 of 1,020 entries (1.28 MB) |

### W9-DATA-D1 (P1) - team members cut at 1,000 with a 200

- Repro: org with a team of 1,108 team_memberships rows (here Team 0001 in qa-w9-data-a). As owner, admin, leader or member: GET /api/v1/teams/<id> (or GET /api/v1/teams and take that team).
- Expected: 1,108 members (the wave 8 fix pages team_roster_people and the team list, claiming members are paged past 1,000).
- Actual: `members.length` = 1000 in both endpoints for all four actors, no flag. Cause: the memberships are an embedded resource in `TEAM_SELECT`, and PostgREST `max_rows` caps embedded rows too (verified with the caller's JWT: embed returns 1000, flat select `Content-Range 0-999/1108`). The rosterPeople paging fix never sees the dropped rows. Members past the cut cannot be viewed or removed from the UI.
- Source: backend/src/routes/teams.ts:30-34 (`memberships:team_memberships(...)`), consumed in shapeTeam / loadTeam.
- Severity note: same silent-truncation class as the accepted P1 W8-PERF-D2, but needs a single team above 1,000 people; downgrade to P2 if that is considered unrealistic.

### W9-DATA-D2 (P1) - scope access fails at about 210 grantees; successful PUT answered 502

- Repro: grant one capability to about 220 distinct people at one scope, then as owner/admin GET /api/v1/teams/<id>/access, GET /api/v1/service-types/<id>/access or GET /api/v1/access/organization. Boundary found: 200 grantees 200 OK, 220 grantees 502 `upstream_error`; 1,100 and 1,101 grants (service type, organization) 502. PUT /api/v1/teams/<id>/access with 250 or 300 grants: 502, but the rows were committed (250 and 300 rows in access_grants).
- Expected: 200 with the full grant list; PUT echoes the saved set.
- Actual: 502 "A required service returned an unexpected response". The writing path reports failure for a committed write, so a retry looks necessary.
- Cause (by threshold, source reading): `withNames` puts every grantee id in one `.in('id', ids)` URL (about 37 bytes per uuid, limit about 8 KB); the grant select itself (`loadScopeAccess`, `.order('created_at')`) is also unpaged and would cut at 1,000.
- Source: backend/src/services/access.ts:119-126 (withNames), 135-141 (loadScopeAccess), 148-161 (replaceScopeAccess). `inChunks` and `fetchAllPages` already exist in lib/paging.ts.
- Not affected: GET /access/members (1,105 members, 4,101 grants exact).

### W9-DATA-D3 (P2) - /calendar 502 on a busy window (deferred D5 variant)

- Repro: as owner or member, GET /api/v1/calendar?from=2027-04-01T00:00:00Z&to=<N days later>. 26 days (204 service times) 200; 30 days 502; 1-month, 1-year, 30-year and 300-year windows all 502 on this fixture.
- Expected: 200 (or a 4xx window limit); deferred D5 only expected a wide-window cost problem.
- Cause (by threshold): `myStatusForTimes` sends every plan id in one `.in('plan_id', ...)` URL; the main plan_times select is also unpaged (would cap at 1,000 events once the URL issue is fixed).
- Source: backend/src/routes/calendar.ts:56 and 75-93.

### W9-DATA-D4 (P2) - /schedule/mine silent cap (deferred D5 variant)

- Repro: member with 1,020 released assignments: GET /api/v1/schedule/mine?include_past=true (also the default future-only call, all 1,020 are in the future).
- Expected: 1,020 entries, or a paging/flag contract. Actual: 1000 entries, 1,281 KB, p50 about 370 ms, p95 about 490 ms, no truncation signal. A bounded window (310 entries) is 397 KB, 120 ms.
- Source: backend/src/routes/assignments.ts:430-456 (single unpaged select).

## Observations (not defects)

- A well-formed cursor carrying filter metacharacters (`"),id.gt.0,or(...`, quotes, lone surrogate, another org's uuid) is accepted and treated as data: the page equals the SQL keyset for the same tuple (verified row for row), no 5xx, no cross-org rows.
- Members (non-owners) do not see `invite_pending` flags (0 of 1,050); consistent with the directory projection.
- The inactive member's person still appears on team rosters (team_roster_people does not check membership status); only archived people are hidden. Decision text only mentions archived.
- Unchunked `.in()` with caller-sized id lists exist in other places (grep): services/roster.ts:214,225, services/availability.ts:71,239,278,299, services/messages.ts:104, routes/assignments.ts:238, routes/opportunities.ts:116. Not tested here; same 502 class as D2/D3 once the list passes about 200 ids.
- Performance at volume (informational): GET /people 2,283 rows 697 KB (owner 766 KB) p50 about 590 ms; GET /people/page?limit=100 p50 55 ms; teams list 1,050 teams 0.94 MB about 170 ms; schedule report 1,494 rows about 200 ms, 2,000 rows (cap) about 390 ms; participation about 460-790 ms; GET /songs?per_page=50 (250 songs) p50 about 40 ms (wave 8: 125 ms at 125 songs; not re-baselined against the RLS write policy split, still deferred).

## Not run / blocked

- supabase/tests/qa-wave8-paging.sql, qa-wave8-team-roster.sql, qa-wave8-people-contact-search.sql: not executed (behaviour verified through the API and PostgREST instead; running them is a repo-test activity, not required by this package).
- Web UI "Load more" and native roster rendering: out of scope (W9-WEB / native packages).
- Report export worker path (POST /reports/exports): not run, the delivery/export worker must not run; sync JSON and CSV were tested.
- Scoped (team- or service-type-scoped) schedulers for report scope with truncation: not built (bulk users have no password); owner, admin and leader (org-scope) only.
- Realtime and conversation message bodies/unread counts: not in package.

## Fixtures left in place

- Orgs qa-w9-data-a and qa-w9-data-b with everything described in the header, plus: 3 songbooks created by tests ("W9 chunk book 250"), team access grants on Team 0501-0508 (150/220/300/600/180/200/250/300), profile bulk0003 email/phone changed (changed.login3@example.test, +19998887777), 8 Auth users with a password stored only in the session scratchpad, queued delivery_effects from bulk assignment inserts (never delivered; worker not run). Nothing outside the qa-w9-data namespace was touched.
