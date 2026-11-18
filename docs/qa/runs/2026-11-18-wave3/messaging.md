# QA-08 — Notes, messages, chat (wave 3)

- Package: QA-08 (NOTE-01, MESSAGE-01, MESSAGE-02, CHAT-01, CHAT-02, NOTIFY-01); plan sections 5.E and 5.F; datasets D12, D13
- Commit: 5bedb99 on branch feature/qa-wave3 (= main); no code, migration or config changed
- Date: 2026-11-18
- Environment: API http://localhost:4000 (email/push simulated, `RESEND_API_KEY` empty), local Supabase (PostgREST with caller JWTs for RLS evidence), Node 26.13.1. Browser, native apps and the delivery worker were not used. `deliverEffectNow` runs inside the API on send/post/retry (that is the API's own inline dispatch, not the QA-07 worker).
- Namespace: orgs `qa-20261118-msg-a` (Alpha, id 375b0601-872c-4881-9302-75a6a95a8c8f) and `qa-20261118-msg-b` (Beta, id 80298f23-8231-4342-b400-e3284698fedd); users `<alias>.qa20261118.msg@example.test`
- Fixture creation: users via Supabase admin API, orgs/memberships/roles via SQL (the create-organization endpoint requires an approved church application), grants/teams/plans/assignments via the real API with the owner token. All permission evidence uses each actor's own token.
- Source-vs-plan disagreements recorded: (1) plan says "supported archive/order actions" for categories; the API has archive and sort_order edit only, no hard delete and no reorder endpoint. (2) Plan lists attachments/uploads for notes and chat; neither exists in the frozen schema (NOT_APPLICABLE). (3) `GET /messages` has no cursor parameter (plan: "pagination ordering"). (4) Conversation message history returns each page in ascending order (oldest to newest within a page, newest page first); the plan's "chronological thread" is met.

## Fixture shape (org Alpha)

| Alias | Role / access | Notes |
|---|---|---|
| owner, admin | owner, admin | |
| legacy | scheduler, legacy mode | org-wide operational access |
| scoped | scheduler, scoped | `plans.edit` + `scheduling.manage` on service type Sunday only |
| lead | member | `scheduling.manage` + `teams.manage` on team Band only; also on Band roster |
| b1, b2 | member | Band roster; released assignments on plan 1 (b2 confirmed, b1 pending) |
| b3 | member | Band roster; **prepared** (unreleased) assignment on plan 1 |
| outsider | member | no team, no assignment |
| revoked | member | Band roster; status flipped inactive/active, removed/re-added to roster during tests |
| child | member | person_type child, on Band roster |
| nolog, guest | people without login | nolog has no email/phone; guest has email only |
| ownerb, memb | Beta owner / member | b1 is also a Beta member (org-switch tests) |

Plans: plan 1 "MSG Sunday 1" (Sunday, 2 items), plan 2 "MSG Midweek" (1 item). Teams: Band, Production. Service types: Sunday, Midweek.

## Result summary

| Status | Count |
|---|---|
| PASS | 790 |
| FAIL | 18 |
| BLOCKED | 1 |
| NOT_RUN | 16 |
| NOT_APPLICABLE | 5 |
| Total expanded cases | 830 |

Failures map to ten defects (below); no P0.

## NOTE-01 results (285 cases: 277 PASS, 4 NOT_RUN, 1 NOT_APPLICABLE, 3 FAIL)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| NOTE-01.cat.create.owner.org-wide.API | owner | API | 201 | 201 {"id":"779c74d9-2b40-4530-8f43-3fe1586538ef","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.owner.service-type.API | owner | API | 201 | 201 {"id":"50d02bb7-23b8-4023-a449-a27d13a0143d","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.owner.midweek.API | owner | API | 201 | 201 {"id":"e9e7f9e3-79af-4529-abd2-466e63dd2c04","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.admin.API | admin | API | 201 (org-wide plans.edit) | 201 {"id":"72058511-edf4-415a-a0a7-a9677f9e7ea4","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.legacy.API | legacy | API | 201 (org-wide plans.edit) | 201 {"id":"1382f625-f450-46e0-8aca-fd26f9e11de9","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.scoped.in-scope.API | scoped | API | 201 (plans.edit on Sunday) | 201 {"id":"802fb4e6-6267-4cdb-b929-b3d6f69f02db","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.scoped.out-of-scope.API | scoped | API | denied 403/404, no row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.scoped.org-wide.API | scoped | API | denied (scope only Sunday) | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.lead.API | lead | API | 403, no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.b1.API | b1 | API | 403, no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.outsider.API | outsider | API | 403, no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.child.API | child | API | 403, no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.create.other-org-owner-with-A-header.API | ownerb | API | 403 (not a member of A) | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTE-01.cat.create.owner-A-with-B-header.API | owner | API | 403 (no membership in B) | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTE-01.cat.create.duplicate-name-case.API | owner | API | 409 not 500 | 409 {"error":"That record already exists","code":"conflict","details":null} | PASS |
| NOTE-01.cat.create.blank-name.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_small","message":"String mu | PASS |
| NOTE-01.cat.create.name-61.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_big","message":"String must | PASS |
| NOTE-01.cat.create.name-60.API | owner | API | 201 | 201 {"id":"c2409ece-6d03-4eea-9e1a-4f38e6a28d74","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.create.invalid-audience.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"default_audience","code":"invalid_enum_value" | PASS |
| NOTE-01.cat.create.sort-1001.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"sort_order","code":"too_big","message":"Numbe | PASS |
| NOTE-01.cat.create.sort-neg.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"sort_order","code":"too_small","message":"Num | PASS |
| NOTE-01.cat.create.unknown-service-type.API | owner | API | 4xx not 500 | 400 {"error":"Referenced record does not exist","code":"bad_request","details":"Key is not present in table \"service_types\ | PASS |
| NOTE-01.cat.create.other-org-service-type.API | owner | API | 4xx, no row (cross-tenant FK) | 400 {"error":"Referenced record does not exist","code":"bad_request","details":"Key is not present in table \"service_types\ | PASS |
| NOTE-01.cat.edit.owner.API | owner | API | 200 renamed | 200 {"id":"779c74d9-2b40-4530-8f43-3fe1586538ef","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.edit.member.API | b1 | API | 403 | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.cat.edit.scoped.out-of-scope.API | scoped | API | 404/403, row unchanged | 404 {"error":"Category not found","code":"not_found"} | PASS |
| NOTE-01.cat.edit.scoped.in-scope.API | scoped | API | 200 | 200 {"id":"50d02bb7-23b8-4023-a449-a27d13a0143d","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","service_type_id": | PASS |
| NOTE-01.cat.edit.other-org-with-B-header.API | ownerb | API | 404 (org-scoped) | 404 {"error":"Category not found","code":"not_found"} | PASS |
| NOTE-01.cat.edit.blank.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"name","code":"too_small","message":"String mu | PASS |
| NOTE-01.cat.edit.bad-uuid.API | owner | API | 400 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| NOTE-01.cat.edit.unknown.API | owner | API | 404 | 404 {"error":"Category not found","code":"not_found"} | PASS |
| NOTE-01.cat.edit.empty-patch.API | owner | API | 200 no-op or 400, not 500 | 404 {"error":"Category not found","code":"not_found"} | PASS |
| NOTE-01.cat.list.member.API | b1 | API | 200 includes active & archived list | 200 [{"id":"c2409ece-6d03-4eea-9e1a-4f38e6a28d74","organizat | PASS |
| NOTE-01.cat.list.other-org.API | ownerb | API | 200, none of A categories | 200 [] | PASS |
| NOTE-01.cat.list.member.RLS | b1 | RLS | member reads own org categories | 200 n=7 | PASS |
| NOTE-01.cat.list.other-org.RLS | memb | RLS | [] | 200 n=0 | PASS |
| NOTE-01.cat.insert.member.RLS | b1 | RLS | 403 42501 | 403 42501 | PASS |
| NOTE-01.cat.update.member.RLS | b1 | RLS | no rows updated | 200 n=0 | PASS |
| NOTE-01.cat.delete.member.RLS | b1 | RLS | denied (no delete grant) | 200 [] | PASS |
| NOTE-01.cat.delete.owner.RLS | owner | RLS | no hard delete (archive only) | 200 [] | PASS |
| NOTE-01.cat.archive.owner.API | owner | API | archived_at set | 200 {"id":"e9e7f9e3-79af-4529-abd2-466e63dd2c04","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.cat.archive.twice.API | owner | API | idempotent 200 | 200 {"id":"e9e7f9e3-79af-4529-abd2-466e63dd2c04","organization_id":"375b0601-872 | PASS |
| NOTE-01.cat.unarchive.owner.API | owner | API | archived_at null | 200 {"id":"e9e7f9e3-79af-4529-abd2-466e63dd2c04","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.org.owner.API | owner | API | 201 rev1 | 201 {"id":"481f351e-a3a1-489e-8120-9b5b4bd5ecbc","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.scheduled.categorized.owner.API | owner | API | 201 | 201 {"id":"89b6d5c4-fbb5-486d-8aea-79bc0ce10411","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.teams.owner.API | owner | API | 201 team_ids | 201 {"id":"27dfed0c-38f2-4d29-b7f7-0b1f10c48ff1","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.leaders.owner.API | owner | API | 201 | 201 {"id":"11e7ea36-9170-4e2c-9e7f-26e09ae0837f","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.item.teams.owner.API | owner | API | 201 | 201 {"id":"e7a5b637-a00b-4066-81b4-ee2efab84bcb","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.item.leaders.owner.API | owner | API | 201 | 201 {"id":"07e9994f-ed58-488e-8349-54eea129525d","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.item.org.owner.API | owner | API | 201 | 201 {"id":"11520747-73ef-49e4-a877-72664113907f","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.item.scheduled.owner.API | owner | API | 201 | 201 {"id":"78204c71-44f2-4a06-969d-2385d159d871","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.scoped.in-scope-plan.API | scoped | API | 201 (plans.edit Sunday) | 201 {"id":"4e9abb57-6752-4b54-b8fd-e59a09bc9b09","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.legacy.API | legacy | API | 201 | 201 {"id":"131e327f-55cf-47f0-9283-a5afd1378b84","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.admin.API | admin | API | 201 | 201 {"id":"88914ea4-0261-44f1-8ff2-2aa476cfc362","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.lead.API | lead | API | 403 no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.create.b1.API | b1 | API | 403 no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.create.outsider.API | outsider | API | 403 no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.create.b3.API | b3 | API | 403 no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.create.child.API | child | API | 403 no row | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.create.scoped.out-of-scope-plan.API | scoped | API | 404 no row | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| NOTE-01.note.create.other-org-plan-with-B-header.API | ownerb | API | 404 (plan hidden) | 404 {"error":"Not found","code":"not_found"} | PASS |
| NOTE-01.note.create.other-org-user-A-header.API | ownerb | API | 403 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTE-01.note.create.item-of-other-plan.API | owner | API | 4xx, no row (wrong item rejected) | 400 {"error":"Referenced record does not exist","code":"bad_request","details":"Key is not present in table \"plan_items\"." | PASS |
| NOTE-01.note.create.unknown-item.API | owner | API | 4xx not 500 | 400 {"error":"Referenced record does not exist","code":"bad_request","details":"Key is not present in table \"plan_items\"." | PASS |
| NOTE-01.note.create.category-other-service-type.API | owner | API | 4xx, no row | 400 {"error":"This note category belongs to another service type","code":"bad_request"} | PASS |
| NOTE-01.note.create.archived-category.API | owner | API | 4xx (archived), 4xx not 500 | 400 {"error":"This note category is archived","code":"bad_request"} | PASS |
| NOTE-01.cat.archived-hidden-from-note-editor.API | owner | API | archived cat not in plan notes categories | ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","By admin","By legacy","Scoped Sunday cat","Announcements v2"] | PASS |
| NOTE-01.note.create.teams-empty.API | owner | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"team_ids","code":"custom","message":"Choose a | PASS |
| NOTE-01.note.create.unknown-team.API | owner | API | 4xx, no row | 404 {"error":"Team not found","code":"not_found"} | PASS |
| NOTE-01.note.create.other-org-team.API | owner | API | 4xx, no row | 404 {"error":"Team not found","code":"not_found"} | PASS |
| NOTE-01.note.create.blank-body.API | owner | API | 422/400 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_small","message":"Write the | PASS |
| NOTE-01.note.create.body-8001.API | owner | API | 422/400 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"b | PASS |
| NOTE-01.note.create.body-8000.API | owner | API | 201 | 201 {"id":"ef14e14f-2773-4856-bf11-1c9f93357c3f","organizati | PASS |
| NOTE-01.note.create.invalid-audience.API | owner | API | 422/400 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"audience","code":"invalid_enum_value","messag | PASS |
| NOTE-01.note.create.bad-plan-uuid.API | owner | API | 400 | 400 {"error":"Invalid route parameter: planId","code":"bad_request"} | PASS |
| NOTE-01.note.create.unknown-plan.API | owner | API | 404 | 404 {"error":"Not found","code":"not_found"} | PASS |
| NOTE-01.note.create.html-body-stored-verbatim.API | owner | API | 201 stored as text (client escapes) | 201 {"id":"d41d73d8-7a3f-411f-8cdf-43f2a66f50ea","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.create.team_ids-ignored-for-nonteam-audience.API | owner | API | 201 team_ids [] | 201 {"id":"589f181b-fc80-4153-91dc-2225064db887","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.read-matrix.owner.API | owner | API | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got org,sched,team,lead,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched,itemlead | PASS |
| NOTE-01.note.read-matrix.owner.RLS | owner | RLS caller JWT | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got itemteam,itemorg,itemsched,itemlead,org,sched,team,lead,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.owner.RLS | owner | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.owner.API | owner | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.admin.API | admin | API | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got org,sched,team,lead,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched,itemlead | PASS |
| NOTE-01.note.read-matrix.admin.RLS | admin | RLS caller JWT | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got itemteam,itemorg,itemsched,itemlead,org,sched,team,lead,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.admin.RLS | admin | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.admin.API | admin | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.legacy.API | legacy | API | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got org,sched,team,lead,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched,itemlead | PASS |
| NOTE-01.note.read-matrix.legacy.RLS | legacy | RLS caller JWT | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got itemteam,itemorg,itemsched,itemlead,org,sched,team,lead,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.legacy.RLS | legacy | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.legacy.API | legacy | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.scoped.API | scoped | API | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got org,sched,team,lead,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched,itemlead | PASS |
| NOTE-01.note.read-matrix.scoped.RLS | scoped | RLS caller JWT | sees org,sched,team,lead,itemteam,itemlead,itemorg,itemsched | got itemteam,itemorg,itemsched,itemlead,org,sched,team,lead,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.scoped.RLS | scoped | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.scoped.API | scoped | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.lead.API | lead | API | sees org,team,itemteam,itemorg | got org,team,by-scoped,by-legacy,by-admin,itemteam,itemorg | PASS |
| NOTE-01.note.read-matrix.lead.RLS | lead | RLS caller JWT | sees org,team,itemteam,itemorg | got itemteam,itemorg,org,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.lead.RLS | lead | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.lead.API | lead | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.b1.API | b1 | API | sees org,sched,team,itemteam,itemorg,itemsched | got org,sched,team,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched | PASS |
| NOTE-01.note.read-matrix.b1.RLS | b1 | RLS caller JWT | sees org,sched,team,itemteam,itemorg,itemsched | got itemteam,itemorg,itemsched,org,sched,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.b1.RLS | b1 | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.b1.API | b1 | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.b2.API | b2 | API | sees org,sched,team,itemteam,itemorg,itemsched | got org,sched,team,by-scoped,by-legacy,by-admin,itemteam,itemorg,itemsched | PASS |
| NOTE-01.note.read-matrix.b2.RLS | b2 | RLS caller JWT | sees org,sched,team,itemteam,itemorg,itemsched | got itemteam,itemorg,itemsched,org,sched,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.b2.RLS | b2 | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.b2.API | b2 | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.b3.API | b3 | API | sees org,team,itemteam,itemorg | got org,team,by-scoped,by-legacy,by-admin,itemteam,itemorg | PASS |
| NOTE-01.note.read-matrix.b3.RLS | b3 | RLS caller JWT | sees org,team,itemteam,itemorg | got itemteam,itemorg,org,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.b3.RLS | b3 | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.b3.API | b3 | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.outsider.API | outsider | API | sees org,itemorg | got org,by-scoped,by-legacy,by-admin,itemorg | PASS |
| NOTE-01.note.read-matrix.outsider.RLS | outsider | RLS caller JWT | sees org,itemorg | got itemorg,org,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.outsider.RLS | outsider | RLS | plan_note_teams only for readable notes |  | PASS |
| NOTE-01.note.no-leak-in-plan-detail.outsider.API | outsider | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.revoked.API | revoked | API | sees org,team,itemteam,itemorg | got org,team,by-scoped,by-legacy,by-admin,itemteam,itemorg | PASS |
| NOTE-01.note.read-matrix.revoked.RLS | revoked | RLS caller JWT | sees org,team,itemteam,itemorg | got itemteam,itemorg,org,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.revoked.RLS | revoked | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.revoked.API | revoked | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.read-matrix.child.API | child | API | sees org,team,itemteam,itemorg | got org,team,by-scoped,by-legacy,by-admin,itemteam,itemorg | PASS |
| NOTE-01.note.read-matrix.child.RLS | child | RLS caller JWT | sees org,team,itemteam,itemorg | got itemteam,itemorg,org,team,by-scoped,by-legacy,by-admin | PASS |
| NOTE-01.note.teams-link-matrix.child.RLS | child | RLS | plan_note_teams only for readable notes | team,itemteam | PASS |
| NOTE-01.note.no-leak-in-plan-detail.child.API | child | API | restricted note bodies absent from GET /plans/:id | status 200 leaks=none | PASS |
| NOTE-01.note.no-leak-in-plan-list.b1.API | b1 | API | no note bodies in list | 200 clean | PASS |
| NOTE-01.note.no-leak-in-plan-list.outsider.API | outsider | API | no note bodies in list | 200 clean | PASS |
| NOTE-01.note.no-leak-in-plan-list.lead.API | lead | API | no note bodies in list | 200 clean | PASS |
| NOTE-01.note.can_edit-flag.owner.API | owner | API | can_edit=true | can_edit=true | PASS |
| NOTE-01.note.can_edit-flag.admin.API | admin | API | can_edit=true | can_edit=true | PASS |
| NOTE-01.note.can_edit-flag.legacy.API | legacy | API | can_edit=true | can_edit=true | PASS |
| NOTE-01.note.can_edit-flag.scoped.API | scoped | API | can_edit=true | can_edit=true | PASS |
| NOTE-01.note.can_edit-flag.lead.API | lead | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.b1.API | b1 | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.b2.API | b2 | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.b3.API | b3 | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.outsider.API | outsider | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.revoked.API | revoked | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.can_edit-flag.child.API | child | API | can_edit=false | can_edit=false | PASS |
| NOTE-01.note.read.other-org-with-B-header.API | ownerb | API | 404 | 404 {"error":"Not found","code":"not_found"} | PASS |
| NOTE-01.note.read.other-org-A-header.API | ownerb | API | 403 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTE-01.note.read.other-org.RLS | ownerb | RLS | [] | 200 n=0 | PASS |
| NOTE-01.note.read.A-owner-B-rows.RLS | owner | RLS | [] | 200 n=0 | PASS |
| NOTE-01.note.insert.member.RLS | b1 | RLS | 403 | 403 42501 | PASS |
| NOTE-01.note.update.member.RLS | b1 | RLS | 0 rows | 200 n=0 | PASS |
| NOTE-01.note.delete.member.RLS | b1 | RLS | 0 rows | 200 n=0 | PASS |
| NOTE-01.note.delete.teamlead-no-plans.edit.RLS | lead | RLS | 0 rows | 200 n=0 | PASS |
| NOTE-01.note.insert.item-of-other-plan.RLS | owner | RLS | FK rejects | 409 23503 | PASS |
| NOTE-01.note.insert.wrong-org.RLS | owner | RLS | FK rejects | 403 42501 | PASS |
| NOTE-01.note.insert.is_legacy.RLS | owner | RLS | RLS rejects is_legacy insert | 403 42501 | PASS |
| NOTE-01.note.insert.scoped.out-of-scope.RLS | scoped | RLS | 403 | 403 42501 | PASS |
| NOTE-01.note.edit.owner.rev1.API | owner | API | 200 rev2 | 200 {"id":"481f351e-a3a1-489e-8120-9b5b4bd5ecbc","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.edit.stale-revision.API | owner | API | 409 note_stale; unchanged | 409 {"error":"This note changed since you opened it","code":"note_stale"} | PASS |
| NOTE-01.note.edit.missing-revision.API | owner | API | 422 | 422 {"error":"Send the revision you edited","code":"unprocessable","details":[{"path":"expected_revision","message":"Require | PASS |
| NOTE-01.note.edit.future-revision.API | owner | API | 409 | 409 {"error":"This note changed since you opened it","code":"note_stale"} | PASS |
| NOTE-01.note.edit.scoped.other-authors-note.API | scoped | API | 200 (plan editor) | 200 {"id":"481f351e-a3a1-489e-8120-9b5b4bd5ecbc","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.edit.member.API | b1 | API | 403 | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.edit.wrong-plan-in-path.API | owner | API | 404 note not on that plan | 404 {"error":"Note not found","code":"not_found"} | PASS |
| NOTE-01.note.edit.audience-change.scheduled-to-org.API | owner | API | 200 audience org, category cleared | 200 {"id":"89b6d5c4-fbb5-486d-8aea-79bc0ce10411","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","plan_id":"314 | PASS |
| NOTE-01.note.edit.audience-widen-visible.outsider.API | outsider | API | visible after widening | true | PASS |
| NOTE-01.note.edit.audience-narrow.API | owner | API | 200 | 200 {"id":"89b6d5c4-fbb5-486d-8aea-79bc0ce10411","organization_id":"375b0601-872 | PASS |
| NOTE-01.note.edit.audience-narrow-hides.outsider.API | outsider | API | no longer visible | false | PASS |
| NOTE-01.note.edit.add-team.API | owner | API | 200 two teams | 200 {"id":"27dfed0c-38f2-4d29-b7f7-0b1f10c48ff1","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","plan_id":"314 | PASS |
| NOTE-01.note.edit.replace-team.API | owner | API | 200 only Production | 200 {"id":"27dfed0c-38f2-4d29-b7f7-0b1f10c48ff1","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","plan_id":"314 | PASS |
| NOTE-01.note.edit.replace-team-hides-from-band.b1.API | b1 | API | b1 (Band, scheduled via Band) still sees? scheduled-on-plan with team: Production no -> hidden unless on team Production | false | PASS |
| NOTE-01.note.edit.move-to-other-item-same-plan.API | owner | API | 200 | 200 {"id":"11520747-73ef-49e4-a877-72664113907f","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.note.edit.move-to-item-of-other-plan.API | owner | API | 4xx, item unchanged | 400 {"error":"Referenced record does not exist","code":"bad_request","details":"Key is not present i | PASS |
| NOTE-01.note.edit.body-8001.API | owner | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"b | PASS |
| NOTE-01.note.legacy-mirror.plans.notes-creates-org-note.API | owner | API+DB | legacy org note created | 200 t | PASS |
| NOTE-01.note.legacy-edit-mirrors-to-plan.notes.API | owner | API+DB | plans.notes updated | 200 LEGACY-NOTES-qa08 v2 | PASS |
| NOTE-01.note.legacy-narrow-audience-detaches-legacy.API | owner | API+DB | is_legacy cleared; plans.notes no longer shows restricted text | 200 plans.notes=NULL is_legacy=f | PASS |
| NOTE-01.note.legacy-narrowed-not-exposed-via-plan.notes.b1.API | b1 | API | no leaders-only text in plan detail | false | PASS |
| NOTE-01.note.delete.owner.API | owner | API | 204, row gone | 204 null | PASS |
| NOTE-01.note.delete.already-deleted.API | owner | API | 404 | 404 {"error":"Note not found","code":"not_found"} | PASS |
| NOTE-01.note.delete.stale-revision.API | owner | API | 409 note_stale | 409 {"error":"This note changed since you opened it","code":"note_stale"} | PASS |
| NOTE-01.note.delete.missing-revision.API | owner | API | 400/422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"expected_revision","code":"invalid_type", | PASS |
| NOTE-01.note.delete.member.API | b1 | API | 403 | 403 {"error":"You need the “Edit plans” permission to do that","code":"forbidden"} | PASS |
| NOTE-01.note.delete.scoped.wrong-plan.API | scoped | API | 404/403 | 404 {"error":"Note not found","code":"not_found"} | PASS |
| NOTE-01.note.delete.other-org.API | ownerb | API | 404 | 404 {"error":"Note not found","code":"not_found"} | PASS |
| NOTE-01.note.delete.item-note.API | owner | API | 204 | 204 null | PASS |
| NOTE-01.note.delete.xss-note.API | owner | API | 204 | 204 null | PASS |
| NOTE-01.note.edit.concurrent-same-revision.API | owner | API | exactly one 200, rest 409 | 200,409,409 | PASS |
| NOTE-01.note.web-ui | owner | W | Web notes editor/audience picker UI | browser not owned by this package (QA-09) | NOT_RUN |
| NOTE-01.note.mobile-ui | owner | M | Mobile note screens (MOB-016) | native app not run in this package | NOT_RUN |
| NOTE-01.note.attachments-absent-for-restricted | b1 | API/DB | restricted attachments absent | no attachment column/table on plan_notes in frozen schema; files route not note-linked | NOT_APPLICABLE |
| NOTE-01.comment.post.owner.API | owner | API | 201 stored | 201 {"item":{"id":"75ce2831-b6c7-489f-89f3-02e9c8da16b7","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.owner.API | owner | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.owner.RLS | owner | RLS | sees rows | 200 n=1 | PASS |
| NOTE-01.comment.post.admin.API | admin | API | 201 stored | 201 {"item":{"id":"378375fb-6ca7-4832-9ddc-93fb62414b79","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.admin.API | admin | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.admin.RLS | admin | RLS | sees rows | 200 n=2 | PASS |
| NOTE-01.comment.post.legacy.API | legacy | API | 201 stored | 201 {"item":{"id":"8ca0ee26-55b7-485d-86c4-e854fa817fd5","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.legacy.API | legacy | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.legacy.RLS | legacy | RLS | sees rows | 200 n=3 | PASS |
| NOTE-01.comment.post.scoped.API | scoped | API | 201 stored | 201 {"item":{"id":"d3c9642a-3a7e-4e9b-8fad-505dd1b6e22a","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.scoped.API | scoped | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.scoped.RLS | scoped | RLS | sees rows | 200 n=4 | PASS |
| NOTE-01.comment.post.b1.API | b1 | API | 201 stored | 201 {"item":{"id":"0414f0e9-66ef-4d10-8535-0b7cf88cee73","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.b1.API | b1 | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.b1.RLS | b1 | RLS | sees rows | 200 n=5 | PASS |
| NOTE-01.comment.post.b2.API | b2 | API | 201 stored | 201 {"item":{"id":"255c7791-ed20-4bd0-ae4c-cebd94e09d64","organization_id":"375b0601-872c-4881-9302- | PASS |
| NOTE-01.comment.read.b2.API | b2 | API | 200 list | 200 | PASS |
| NOTE-01.comment.read.b2.RLS | b2 | RLS | sees rows | 200 n=6 | PASS |
| NOTE-01.comment.post.lead.API | lead | API | 404, no row | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.read.lead.API | lead | API | 404 | 404 | PASS |
| NOTE-01.comment.read.lead.RLS | lead | RLS | [] (no rows) | 200 n=0 | PASS |
| NOTE-01.comment.post.b3.API | b3 | API | 404, no row | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.read.b3.API | b3 | API | 404 | 404 | PASS |
| NOTE-01.comment.read.b3.RLS | b3 | RLS | [] (no rows) | 200 n=0 | PASS |
| NOTE-01.comment.post.outsider.API | outsider | API | 404, no row | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.read.outsider.API | outsider | API | 404 | 404 | PASS |
| NOTE-01.comment.read.outsider.RLS | outsider | RLS | [] (no rows) | 200 n=0 | PASS |
| NOTE-01.comment.post.revoked.API | revoked | API | 404, no row | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.read.revoked.API | revoked | API | 404 | 404 | PASS |
| NOTE-01.comment.read.revoked.RLS | revoked | RLS | [] (no rows) | 200 n=0 | PASS |
| NOTE-01.comment.post.child.API | child | API | 404, no row | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.read.child.API | child | API | 404 | 404 | PASS |
| NOTE-01.comment.read.child.RLS | child | RLS | [] (no rows) | 200 n=0 | PASS |
| NOTE-01.comment.post.other-org-B-header.API | ownerb | API | 404 | 404 {"error":"Item not found","code":"not_found"} | PASS |
| NOTE-01.comment.post.other-org-A-header.API | ownerb | API | 403 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTE-01.comment.read.other-org.RLS | ownerb | RLS | [] | n=0 | PASS |
| NOTE-01.comment.post.item-on-unscheduled-plan.b1.API | b1 | API | 404 (not on plan2) | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.post.unknown-item.API | owner | API | 404 | 404 {"error":"Item not found","code":"not_found"} | PASS |
| NOTE-01.comment.post.bad-uuid-item.API | owner | API | 400 | 400 {"error":"Invalid route parameter: itemId","code":"bad_request"} | PASS |
| NOTE-01.comment.post.blank.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_small","message":"Write som | PASS |
| NOTE-01.comment.post.4001.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable"," | PASS |
| NOTE-01.comment.post.4000.API | b1 | API | 201 | 201 {"item":{"id":"18c8ec4f-dc15-4e69-8f3b-a7f8c676b2c2","or | PASS |
| NOTE-01.comment.post.bad-id.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"id","code":"invalid_string","message":"Invali | PASS |
| NOTE-01.comment.post.missing-id.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"id","code":"invalid_type","message":"Required | PASS |
| NOTE-01.comment.post.21-mentions.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable"," | PASS |
| NOTE-01.comment.post.markup-unicode.API | b1 | API | 201 verbatim | 201 {"item":{"id":"c1a85d4a-fa2e-4e75-bfa3-f5473e4c8aa5","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","plan_ | PASS |
| NOTE-01.comment.post.duplicate-id-replay.API | b1 | API+DB | 201 then 200 replayed, one row | 201/200 rows=1 | PASS |
| NOTE-01.comment.post.duplicate-id-different-body.API | b1 | API | replay returns original body (not silently overwritten) or 409 | 200 body=idem body | PASS |
| NOTE-01.comment.post.duplicate-id-other-author.API | b2 | API | 409 comment_id_conflict, original unchanged | 409 {"error":"This comment id is already used","code":"comment_id_conflict"} | PASS |
| NOTE-01.comment.post.duplicate-id-other-item.API | b1 | API | 409 | 409 {"error":"This comment id is already used","code":"comment_id_conflict"} | PASS |
| NOTE-01.comment.post.duplicate-id-nonparticipant-probe.API | outsider | API | 404 not 409 (no id-existence oracle) | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.post.concurrent-same-id.API | b2 | API+DB | one row; statuses 201 once + 200s | 200,200,200,201 rows=1 | PASS |
| NOTE-01.comment.mention.resolutions.DB | owner | API+DB | b2 notified, outsider no_access, nolog no_login, b3 no_access, self skipped | [["b2","notified"],["b3","no_access"],["outsider","no_access"],["nolog","no_login"]] | PASS |
| NOTE-01.comment.mention.notification-created.b2.API | b2 | API | b2 has comment_mention notification with plan_item_id | n=1 Olive Owner mentioned you on “Welcome”\|Mention test | PASS |
| NOTE-01.comment.mention.no-notification-for-no_access.outsider.API | outsider | API | no item-comment notification | n=0 | PASS |
| NOTE-01.comment.mention.no-notification-for-prepared-only.b3.API | b3 | API | none (prepared assignee has no thread access) | n=0 | PASS |
| NOTE-01.comment.no-notification-for-non-thread-member.lead.API | lead | API | none | n=0 | PASS |
| NOTE-01.comment.mention.outbox-deliveries.DB | owner | DB | in_app+push rows for notified b2 only | in_app:delivered,in_app:delivered,in_app:delivered,in_app:delivered,in_app:delivered,push:skipped | PASS |
| NOTE-01.comment.reply-notification.prior-author.b1.API | b1 | API | comment_reply for earlier author | n=3 | PASS |
| NOTE-01.comment.mention.other-org-person.API | owner | API+DB | 201, mention row not created (cross-org) | 201 mentions=0 | PASS |
| NOTE-01.comment.mention-candidates.b1.API | b1 | API | thread members only, no b3/outsider/nolog, no contact fields | ["Adam Admin","Ben Two","Lena Legacy","Olive Owner","Sam Scoped"] keys=person_id,name | PASS |
| NOTE-01.comment.mention-candidates.outsider.API | outsider | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| NOTE-01.comment.mention-candidates.no-target.API | b1 | API | 400/422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"","code":"custom","message":"Choose a pla | PASS |
| NOTE-01.comment.mention-candidates.both-targets.API | b1 | API | 400/422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"","code":"custom","message":"Choose a pla | PASS |
| NOTE-01.comment.edit.author.API | b1 | API+DB | 200 edited_at set, audit row | 200 {"id":"0414f0e9-66ef-4d10-8535-0b7cf88cee73","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.comment.edit.same-body-noop.API | b1 | API+DB | 200, no extra audit row | 200 {"id":"0414f0e9-66ef-4d10-8535-0b7cf88cee73","organizati | PASS |
| NOTE-01.comment.edit.non-author.b2.API | b2 | API | 403, unchanged | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.comment.edit.non-author.owner.API | owner | API | 403, unchanged | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.comment.edit.non-author.scoped.API | scoped | API | 403, unchanged | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.comment.edit.nonparticipant.outsider.API | outsider | API | 404, unchanged | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.edit.nonparticipant.lead.API | lead | API | 404, unchanged | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.edit.nonparticipant.b3.API | b3 | API | 404, unchanged | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.edit.blank.API | b1 | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_small","message":"Write som | PASS |
| NOTE-01.comment.edit.wrong-item-in-path.API | b1 | API+DB | 404 AND comment unchanged | 404 body before='edited by author' after='wrong item path' | FAIL (W3-MSG-D1) |
| NOTE-01.comment.edit.direct-table.RLS | b1 | RLS | denied (no update grant) | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| NOTE-01.comment.insert.direct-table.RLS | b1 | RLS | denied | 403 | PASS |
| NOTE-01.comment.delete.direct-table.RLS | owner | RLS | denied | 403 | PASS |
| NOTE-01.comment.audit-events.read.owner.RLS | owner | RLS | admin/owner can read audit | 200 n=3 | PASS |
| NOTE-01.comment.audit-events.read.member.RLS | b1 | RLS | [] (previous_body hidden) | 200 n=0 | PASS |
| NOTE-01.comment.audit-events.read.legacy-scheduler.RLS | legacy | RLS | [] (admin only) | n=0 | PASS |
| NOTE-01.comment.delete.non-author-participant.b1.API | b1 | API | 403 unchanged | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| NOTE-01.comment.delete.nonparticipant.API | outsider | API | 404 | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.delete.author.API | b2 | API+DB | 200 body blank, deleted_at, audit keeps previous_body | 200 {"id":"255c7791-ed20-4bd0-ae4c-cebd94e09d64","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| NOTE-01.comment.delete.twice.API | b2 | API | 200 idempotent | 200 {"id":"255c7791-ed20-4bd0-ae4c-cebd94e09d64","organizati | PASS |
| NOTE-01.comment.edit.deleted.API | b2 | API | 409 comment_deleted | 409 {"error":"This comment was deleted","code":"comment_deleted"} | PASS |
| NOTE-01.comment.read.deleted-shows-tombstone-no-body.API | b1 | API | tombstone, body empty | {"id":"255c7791-ed20-4bd0-ae4c-cebd94e09d64","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","plan_id":"3146084f-639b-4b25-bd36-202aa3504150" | PASS |
| NOTE-01.comment.delete.plan-editor-moderates.legacy.API | legacy | API+DB | 200; audit reason | 200 {"id":"0414f0e9-66ef-4d10-8535-0b7cf88cee73","organization_id":"375b0601-872 | PASS |
| NOTE-01.comment.delete.scoped.out-of-scope-plan.API | scoped | API | 404 | 404 {"error":"This discussion is only open to people on this plan","code":"not_found"} | PASS |
| NOTE-01.comment.delete.unknown.API | b1 | API | 404 | 404 {"error":"Comment not found","code":"not_found"} | PASS |
| NOTE-01.comment.can_moderate-flag.legacy.API | legacy | API | true | true | PASS |
| NOTE-01.comment.can_moderate-flag.b1.API | b1 | API | false | false | PASS |
| NOTE-01.comment.pagination.complete-no-dupes.API | b1 | API | all rows exactly once newest-first | pages=3 seen=7 uniq=7 total=7 | PASS |
| NOTE-01.comment.pagination.order-desc.API | b1 | API | chronological ascending within page (newest page first) | 2026-11-18T17:17:46.223567+00:00 2026-11-18T17:17:46.240233+00:00 2026-11-18T17:17:46.256423+00:00 | PASS |
| NOTE-01.comment.pagination.limit-0.API | b1 | API | 400 | 422 | PASS |
| NOTE-01.comment.pagination.limit-101.API | b1 | API | 400 | 422 | PASS |
| NOTE-01.comment.pagination.limit-1.API | b1 | API | 200 | 200 | PASS |
| NOTE-01.comment.pagination.limit-100.API | b1 | API | 200 | 200 | PASS |
| NOTE-01.comment.pagination.bad-cursor.API | b1 | API | 400/422 | 422 | PASS |
| NOTE-01.comment.pagination.cursor-before-all.API | b1 | API | 200 empty | 200 n=0 | PASS |
| NOTE-01.comment.pagination.identical-created_at-ties.API | b1 | API+DB | every comment appears once when created_at ties | seen=14 total=17 (limit=2 keyset on created_at only) | FAIL (W3-MSG-D2) |
| NOTE-01.comment.web-ui | b1 | W | Web item discussion drawer | browser not owned by this package | NOT_RUN |
| NOTE-01.comment.mobile-ui | b1 | M | Mobile item-notes screen (MOB-016) | native not run | NOT_RUN |
| NOTE-01.comment.delete.wrong-item-in-path.API | b1 | API+DB | 404 AND comment unchanged | 404 deleted_at set=t | FAIL (W3-MSG-D1) |

## MESSAGE-01 results (227 cases: 219 PASS, 4 FAIL, 1 BLOCKED, 3 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MESSAGE-01.setup.b2-confirms | b2 | API | 200 | 200 {"id":"5e275052-62a0-4a5e-912a-0193b84e0c8c","plan_id":"3146084f-639b-4b25-b | PASS |
| MESSAGE-01.preview.owner.API | owner | API | 200 recipients | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.admin.API | admin | API | 200 recipients | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.legacy.API | legacy | API | 200 recipients | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.scoped.band-on-sunday-plan.API | scoped | API | scoped Sunday scheduler may target Band teams on Sunday plan (or 404 if Band not under Sunday) | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.lead.API | lead | API | 200 recipients | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.b1.API | b1 | API | 403 | 403  | PASS |
| MESSAGE-01.preview.b3.API | b3 | API | 403 | 403  | PASS |
| MESSAGE-01.preview.outsider.API | outsider | API | 403 | 403  | PASS |
| MESSAGE-01.preview.child.API | child | API | 403 | 403  | PASS |
| MESSAGE-01.preview.pending-set.owner.API | owner | API | b1,guest,nolog (b2 confirmed; b3 prepared excluded) | b1,guest,nolog | PASS |
| MESSAGE-01.preview.reachability-flags.owner.API | owner | API | nolog unreachable, guest email-only reachable, b1 login+email | nolog={"reasons":["scheduled_pending"],"has_email":false,"has_login":false,"last_name":"Nolog","person_id":"86840221-62c7-49dc-9b39-03f2fb72fe16","reachable":false,"first_name":"Nora"} guest=true/false | PASS |
| MESSAGE-01.preview.no-contact-values-exposed.owner.API | owner | API | only booleans, no email/phone values | reasons,has_email,has_login,last_name,person_id,reachable,first_name | PASS |
| MESSAGE-01.preview.confirmed-set.owner.API | owner | API | b2 only | b2 | PASS |
| MESSAGE-01.preview.pending+confirmed.owner.API | owner | API | b1,b2,guest,nolog | b1,b2,guest,nolog | PASS |
| MESSAGE-01.preview.team-members.owner.API | owner | API | Band roster incl. prepared-only b3 (team membership not assignment) | b1,b2,b3,child,lead,revoked | PASS |
| MESSAGE-01.preview.no-team-filter-scheduled.owner.API | owner | API | all teams on plan: b1,guest,nolog | b1,guest,nolog | PASS |
| MESSAGE-01.preview.scheduled-without-plan.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.team_members-without-team.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.empty-include.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.invalid-include.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.duplicate-include.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.unknown-plan.API | owner | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.unknown-team.API | owner | API | 404 | 404 {"error":"Team not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.51-teams.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.malformed-body.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.preview.other-org-plan-with-B-header.API | ownerb | API | 404 plan not found | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.other-org-A-header.API | ownerb | API | 403 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| MESSAGE-01.preview.other-org-team.API | owner | API | 404 | 404 {"error":"Team not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.lead.own-team.API | lead | API | 200 b1,guest,nolog | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.lead.other-team-Production.API | lead | API | 404 (no scope on Production) | 404 {"error":"Team not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.lead.plan-all-teams.API | lead | API | only teams lead can schedule (Band) -> same set | 200 b1,guest,nolog | PASS |
| MESSAGE-01.preview.lead.band-on-midweek-plan.API | lead | API | 200 (team grant applies on any plan) empty set | 200  | PASS |
| MESSAGE-01.preview.scoped.midweek-plan.API | scoped | API | 404 (no scope) | 404 {"error":"Team not found","code":"not_found"} | PASS |
| MESSAGE-01.preview.member.RPC | b1 | RLS/RPC | 403 42501 | 403 42501 | PASS |
| MESSAGE-01.preview.other-org.RPC | ownerb | RLS/RPC | denied | 403 42501 | PASS |
| MESSAGE-01.private-resolver-not-exposed.RPC | owner | RLS/RPC | private schema functions not callable | 404 | PASS |
| MESSAGE-01.send.owner.pending.API | owner | API+DB | 201; recipient_count=2 (b1,guest), excluded 1 (nolog) | 201 rc=2 ex=1 | PASS |
| MESSAGE-01.send.recipient-statuses.DB | owner | DB | b1,guest included; nolog excluded_no_address; b2/b3 absent | ["guest:included","nolog:excluded_no_address","b1:included"] | PASS |
| MESSAGE-01.send.outbox-channels.DB | owner | DB | b1: in_app+push+email; guest: email only; nolog none; b3/b2 none | Bea:email:simulated Bea:in_app:delivered Bea:push:skipped Gus <i>G</i>:email:simulated | PASS |
| MESSAGE-01.send.delivery-truthful-states.DB | owner | DB | simulated mode: email -> simulated (never delivered/provider_accepted); push skipped w/o device; in_app delivered | observed per-channel: in_app delivered, push skipped, email simulated | PASS |
| MESSAGE-01.send.in-app-notification.b1.API | b1 | API | one operational_message notification linked to message | n=1 Hi Bea\|Rehearsal for MSG Sunday 1 from Olive Owner at QA MSG A | PASS |
| MESSAGE-01.send.notification-variable-render.b1.API | b1 | API | first_name rendered, no raw {{ }} | Hi Bea | PASS |
| MESSAGE-01.send.no-notification.b2.API | b2 | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.send.no-notification.b3.API | b3 | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.send.no-notification.outsider.API | outsider | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.send.no-notification.lead.API | lead | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.send.no-notification.owner.API | owner | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.send.no-notification.legacy.API | legacy | API | 0 (not a recipient) | 0 | PASS |
| MESSAGE-01.read.recipient.b1.API | b1 | API | 200 rendered_for_me, no outcomes, can_retry false | 200 rfm={"subject":"Hi Bea","body":"Rehearsal for MSG Sunday 1 from Olive Owner at QA MSG A"} outcomes=absent | PASS |
| MESSAGE-01.read.recipient-sees-sender-side-metadata.API | b1 | API | recipient should not see audience/recipient counts/excluded_count/audience_hash of sender-side set | id,organization_id,plan_id,audience,audience_hash,request_hash,subject,body,variables,template_id,template_revision,recipient_count,excluded_count,idempotency_key,created_by,created_at excluded_count=1 recipient_count=2 | FAIL (W3-MSG-D5) |
| MESSAGE-01.list.received.b1.API | b1 | API | contains m1 | 200 n=1 | PASS |
| MESSAGE-01.list.sent.b1.API | b1 | API | [] (b1 sent nothing) | 200 n=0 | PASS |
| MESSAGE-01.read.non-recipient.b2.API | b2 | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.list.received.non-recipient.b2.API | b2 | API | no m1 | n=0 | PASS |
| MESSAGE-01.read.non-recipient.outsider.API | outsider | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.list.received.non-recipient.outsider.API | outsider | API | no m1 | n=0 | PASS |
| MESSAGE-01.read.non-recipient.lead.API | lead | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.list.received.non-recipient.lead.API | lead | API | no m1 | n=0 | PASS |
| MESSAGE-01.read.non-recipient.b3.API | b3 | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.list.received.non-recipient.b3.API | b3 | API | no m1 | n=0 | PASS |
| MESSAGE-01.read.other-sender-legacy.API | legacy | API | 404 (not creator, not admin) | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.list.sent.other-sender-sees-only-own.API | legacy | API | no m1 | n=0 | PASS |
| MESSAGE-01.read.admin.outcomes.API | admin | API | 200 with outcomes | 200 outcomes=3 | PASS |
| MESSAGE-01.read.outcomes-no-contact-values.admin.API | admin | API | no emails/phones in outcomes | checked | PASS |
| MESSAGE-01.list.sent.admin-sees-all.API | admin | API | includes m1 | n=1 | PASS |
| MESSAGE-01.read.sender.outcomes-per-recipient.API | owner | API | outcomes per recipient × channel with statuses | [["Gus <i>G</i>",null,1],["Nora",null,0],["Bea",null,3]] | PASS |
| MESSAGE-01.read.other-org-B-header.API | ownerb | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.read.recipient.RLS | b1 | RLS | sees only messages sent to b1 | n=1 | PASS |
| MESSAGE-01.read.non-recipient.RLS | b2 | RLS | [] | n=0 | PASS |
| MESSAGE-01.read.recipients-table.recipient.RLS | b1 | RLS | only own recipient row (no co-recipient list) | n=1 | PASS |
| MESSAGE-01.read.recipients-table.other-sender.RLS | legacy | RLS | [] | n=0 | PASS |
| MESSAGE-01.read.recipients-table.admin.RLS | admin | RLS | all 3 | n=3 | PASS |
| MESSAGE-01.read.other-org.RLS | ownerb | RLS | [] | n=0 | PASS |
| MESSAGE-01.insert.direct-table.RLS | owner | RLS | denied (no insert grant) | 403 | PASS |
| MESSAGE-01.update.recipients.direct-table.RLS | owner | RLS | denied | 403 | PASS |
| MESSAGE-01.send.duplicate-key-replay.API | owner | API+DB | 201 then 200 replayed, same message id, 1 row, 1 effect | 201/200 same=true rows=1 effects=1 deliveries=4 | PASS |
| MESSAGE-01.send.duplicate-key-single-notification.b1.API | b1 | API | exactly one notification for that message | 1 | PASS |
| MESSAGE-01.send.same-key-different-body.API | owner | API | 409 idempotency_key_reused | 409 {"error":"This idempotency key was used for a different message","code":"idempotency_key_reused" | PASS |
| MESSAGE-01.send.same-key-different-exclusions.API | owner | API | 409 | 409 {"error":"This idempotency key was used for a different message","code":"idempotency_key_reused" | PASS |
| MESSAGE-01.send.same-key-different-sender.API | admin | API+DB | 201 separate message (key scoped per sender) | 201 distinct=true | PASS |
| MESSAGE-01.send.concurrent-same-key.API | owner | API+DB | 1 message, 1 effect; statuses 201 once + 200s | 200,200,200,200,201 rows=1 effects=1 | PASS |
| MESSAGE-01.send.key-too-short.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"i | PASS |
| MESSAGE-01.send.key-201.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"i | PASS |
| MESSAGE-01.send.key-missing.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"i | PASS |
| MESSAGE-01.send.stale-hash.API | owner | API+DB | 409 audience_changed, no row | 409 audience_changed | PASS |
| MESSAGE-01.send.hash-wrong-length.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"a | PASS |
| MESSAGE-01.send.audience-changed-after-preview.API | owner | API | 409 audience_changed (outsider newly scheduled) | 409 409 {"error":"The audience changed since the preview; review the recipients agai | PASS |
| MESSAGE-01.preview.reflects-new-assignment.API | owner | API | outsider now in set | b1,guest,nolog,outsider | PASS |
| MESSAGE-01.send.exclude-recipient.API | owner | API+DB | recipient_count 1 (guest), excluded 2; b1 gets nothing | 201 rc=1 ex=2 b1status=excluded_by_sender b1deliveries=0 | PASS |
| MESSAGE-01.send.exclude-everyone-reachable.API | owner | API+DB | 400/422 no_recipients; no message row persisted | 400 400 {"error":"Nobody in this audience can be reached","code":"bad_request"} orphanRows=0 | PASS |
| MESSAGE-01.send.exclude-unknown-person.API | owner | API | 201 ignoring unknown id (or 4xx), no 500 | 201 | PASS |
| MESSAGE-01.send.exclude-501.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.send.unknown-variable-subject.API | owner | API | 400/422 naming variable | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"subject","code":"custom","message":"Unkno | PASS |
| MESSAGE-01.send.unknown-variable-body-spaced.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"custom" | PASS |
| MESSAGE-01.send.all-variables-spacing.API | owner | API | 201 | 201 {"message":{"id":"629d90b0-f730-41ee-a0da-1b2949b103cd","organization_id":"3 | PASS |
| MESSAGE-01.send.blank-subject.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"s | PASS |
| MESSAGE-01.send.subject-201.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"s | PASS |
| MESSAGE-01.send.body-8001.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"b | PASS |
| MESSAGE-01.send.body-8000.API | owner | API | 201 | 201 {"message":{"id":"92cb845e-54dc-4c7a-b739-213f51185003","organization_id":"3 | PASS |
| MESSAGE-01.send.markup-stored-verbatim-as-text.API | owner | API+DB | stored raw text; rendering escapes at email/UI layer | 201 stored subject=<b>{{first_name}}</b> & "q" | PASS |
| MESSAGE-01.send.email-html-escaping.provider-output | owner | J/mail sink | email HTML escapes subject/body/variables | no mail sink; simulated transport stores no rendered HTML (RESEND_API_KEY empty). Escaping contract only read in source (message-templates.ts doc comment) | BLOCKED |
| MESSAGE-01.send.admin.API | admin | API | 201 | 201 {"message":{"id":"24a26e7f-cf69-4e82-970d-ec6ee62554f7","organization_id":"3 | PASS |
| MESSAGE-01.send.legacy.API | legacy | API | 201 | 201 {"message":{"id":"f0ad8d7e-af10-471f-9369-f47cc359b12a","organization_id":"3 | PASS |
| MESSAGE-01.send.lead.API | lead | API | 201 | 201 {"message":{"id":"477d7ce8-c5c9-4332-902b-e34b0d0b22c4","organization_id":"3 | PASS |
| MESSAGE-01.send.b1.API | b1 | API | 403, no row | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.send.outsider.API | outsider | API | 403, no row | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.send.child.API | child | API | 403, no row | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.send.b3.API | b3 | API | 403, no row | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.send.lead.other-team.API | lead | API | 404 no row | 404 {"error":"Team not found","code":"not_found"} | PASS |
| MESSAGE-01.send.other-org-A-header.API | ownerb | API | 403 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| MESSAGE-01.send.other-org-plan-B-header.API | ownerb | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| MESSAGE-01.send.member.RPC | b1 | RLS/RPC | 403 42501 | 403 42501 | PASS |
| MESSAGE-01.send.unknown-template.API | owner | API | 404 | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.tpl.list.owner.API | owner | API | 200 | 200 | PASS |
| MESSAGE-01.tpl.list.admin.API | admin | API | 200 | 200 | PASS |
| MESSAGE-01.tpl.list.legacy.API | legacy | API | 200 | 200 | PASS |
| MESSAGE-01.tpl.list.scoped.API | scoped | API | 200 | 200 | PASS |
| MESSAGE-01.tpl.list.lead.API | lead | API | 200 | 200 | PASS |
| MESSAGE-01.tpl.list.b1.API | b1 | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.list.outsider.API | outsider | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.list.child.API | child | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.list.b3.API | b3 | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.create-shared.owner.API | owner | API+DB | 201 | 201 {"id":"eea7686b-676d-4e24-b883-fe5db4af1a85","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-shared.admin.API | admin | API+DB | 201 | 201 {"id":"7ad87d12-ac3e-4dde-abba-4cddbe57298b","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-shared.legacy.API | legacy | API+DB | 201 | 201 {"id":"6cf634b9-3bf7-4f43-8893-882bc30a9d44","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-shared.scoped.API | scoped | API+DB | 403 no row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| MESSAGE-01.tpl.create-shared.lead.API | lead | API+DB | 403 no row | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| MESSAGE-01.tpl.create-personal.owner.API | owner | API | 201 owner_id=self | 201 {"id":"4f5bf881-73ad-45b1-b589-9f726e9b9000","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-personal.lead.API | lead | API | 201 owner_id=self | 201 {"id":"d885e744-9f12-468f-8890-ac50eb3db93f","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-personal.scoped.API | scoped | API | 201 owner_id=self | 201 {"id":"a6db18c3-6332-4222-971a-07678f97767b","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-personal.legacy.API | legacy | API | 201 owner_id=self | 201 {"id":"6952485a-4af2-4044-8b07-f7229fc07ed8","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create-personal.admin.API | admin | API | 201 owner_id=self | 201 {"id":"43368652-616c-42f1-9c2a-e47b893e8efa","organization_id":"375b0601-872c-4881-930 | PASS |
| MESSAGE-01.tpl.create.b1.API | b1 | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.tpl.create.outsider.API | outsider | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.tpl.create.child.API | child | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbid | PASS |
| MESSAGE-01.tpl.create.other-org-A-header.API | ownerb | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.list.lead-sees-shared-and-own-only.API | lead | API | shared + own personal, not others personal | Personal lead\|Shared by admin\|Shared by legacy\|Shared by owner | PASS |
| MESSAGE-01.tpl.list.owner-no-others-personal.API | owner | API | own personal not lead/admin personal | Personal owner\|Shared by admin\|Shared by legacy\|Shared by owner | PASS |
| MESSAGE-01.tpl.list.scoped-can_manage_shared-false.API | scoped | API | can_manage_shared=false (scope not org-wide) | false | PASS |
| MESSAGE-01.tpl.list.lead.RLS | lead | RLS | shared+own only | Shared by owner\|Shared by admin\|Shared by legacy\|Personal lead | PASS |
| MESSAGE-01.tpl.list.member.RLS | b1 | RLS | [] | n=0 | PASS |
| MESSAGE-01.tpl.list.other-org.RLS | ownerb | RLS | [] | n=0 | PASS |
| MESSAGE-01.tpl.insert.member.RLS | b1 | RLS | 403 | 403 | PASS |
| MESSAGE-01.tpl.insert-shared.lead.RLS | lead | RLS | 403 | 403 | PASS |
| MESSAGE-01.tpl.insert-as-other-owner.lead.RLS | lead | RLS | 403 | 403 | PASS |
| MESSAGE-01.tpl.delete.direct.RLS | lead | RLS | denied | 200 | PASS |
| MESSAGE-01.tpl.create.invalid-variable-subject.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"subject","code":"cust | PASS |
| MESSAGE-01.tpl.create.invalid-variable-body.API | owner | API | 400/422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"custom" | PASS |
| MESSAGE-01.tpl.create.all-allowed-variables.API | owner | API | 201 | 201 {"id":"e3886efd-e387-48bf-9869-1dfe1357b84c","organizati | PASS |
| MESSAGE-01.tpl.create.unterminated-variable.API | owner | API | 201 (literal text) | 201 {"id":"82598c9e-3fa1-4339-a653-e1d37430a153","organizati | PASS |
| MESSAGE-01.tpl.create.blank-name.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.tpl.create.name-81.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.tpl.create.name-80.API | owner | API | 201 | 201 | PASS |
| MESSAGE-01.tpl.create.subject-201.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.tpl.create.empty-body.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.tpl.create.missing-fields.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.tpl.create.duplicate-name-case.API | owner | API | 409 not 500 | 409 {"error":"That record already exists","code":"conflict","details":null} | PASS |
| MESSAGE-01.tpl.create.same-name-different-scope.API | owner | API | 201 (shared vs personal separate namespace) | 201 | PASS |
| MESSAGE-01.tpl.edit.owner.rev1.API | owner | API+DB | 200 revision 2 | 200 {"id":"eea7686b-676d-4e24-b883-fe5db4af1a85","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| MESSAGE-01.tpl.edit.stale.API | owner | API | 409 template_stale unchanged | 409 {"error":"This template changed since you opened it","code":"template_stale"} | PASS |
| MESSAGE-01.tpl.edit.invalid-variable.API | owner | API | 400/422 unchanged | 422 | PASS |
| MESSAGE-01.tpl.edit.no-revision-last-write-wins.API | owner | API | 200 (revision optional) | 200 rev=3 | PASS |
| MESSAGE-01.tpl.edit-shared.lead-no-revision.API | lead | API | 403/404 unchanged | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.tpl.edit-shared.lead-with-current-revision.API | lead | API | 403/404 (permission), NOT 409 "changed since you opened" | 409 {"error":"This template changed since you opened it","code":"template_stale"} | FAIL (W3-MSG-D6) |
| MESSAGE-01.tpl.edit.other-users-personal.owner.API | owner | API | 404 invisible | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.tpl.edit.other-users-personal.admin.API | admin | API | 404 (admin has no override) | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.tpl.edit.own-personal.lead.API | lead | API | 200 | 200 {"id":"d885e744-9f12-468f-8890-ac50eb3db93f","organization_id":"375b0601-872 | PASS |
| MESSAGE-01.tpl.edit.other-org.API | ownerb | API | 404 or 403 | 404 | PASS |
| MESSAGE-01.tpl.edit.bad-uuid.API | owner | API | 400 | 400 | PASS |
| MESSAGE-01.tpl.edit.unknown.API | owner | API | 404 | 404 | PASS |
| MESSAGE-01.tpl.edit.shared-flag-change.API | owner | API+DB | shared flag ignored on edit? owner_id unchanged | 409 owner_id=NULL | PASS |
| MESSAGE-01.tpl.use-in-send.records-revision.API | owner | API+DB | message.template_id/template_revision recorded | 201 rev=1 | PASS |
| MESSAGE-01.tpl.use-in-send.other-users-personal.API | owner | API | 404 Template not found, no row | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.tpl.use-in-send.shared.lead.API | lead | API | 201 | 201 {"message":{"id":"74faaf7c-a801-4f4a-9324-202170402ce3","organization_id":"3 | PASS |
| MESSAGE-01.tpl.edit-after-send-does-not-mutate-message.DB | owner | DB | sent message keeps its own subject/body | Snap {{first_name}} | PASS |
| MESSAGE-01.tpl.archive-shared.lead.API | lead | API | 404/403, not archived | 404 archived=f | PASS |
| MESSAGE-01.tpl.archive.member.API | b1 | API | 403 | 403 | PASS |
| MESSAGE-01.tpl.archive-other-personal.owner.API | owner | API | 404 | 404 archived=f | PASS |
| MESSAGE-01.tpl.archive-own-personal.lead.API | lead | API+DB | 204 | 204 | PASS |
| MESSAGE-01.tpl.archive-twice.API | lead | API | 204 or 404 idempotent | 204 | PASS |
| MESSAGE-01.tpl.archive-shared.owner.API | owner | API+DB | 204 archived (row kept) | 204 rowkept=1 | PASS |
| MESSAGE-01.tpl.list.excludes-archived.API | owner | API | not listed | false | PASS |
| MESSAGE-01.tpl.edit-archived.API | owner | API | 404 | 404 | PASS |
| MESSAGE-01.tpl.create.reuse-name-after-archive.API | owner | API | 201 | 201 | PASS |
| MESSAGE-01.tpl.use-archived-template-in-send.API | owner | API | 4xx (archived template should not be selectable) or documented 201 | 201 {"message":{"id":"d745c5b7-0de6-4f00-8c73-cd33e77f1d04","organization_id":"3 | FAIL (W3-MSG-D7) |
| MESSAGE-01.history.limit-2-newest-first.API | owner | API | 2 rows, created_at desc | n=2 2026-11-18T17:20:54.417137+00:00 2026-11-18T17:20:53.98803+00:00 | PASS |
| MESSAGE-01.history.limit-0.API | owner | API | 400 | 422 | PASS |
| MESSAGE-01.history.limit-101.API | owner | API | 400 | 422 | PASS |
| MESSAGE-01.history.limit-100.API | owner | API | 200 | 200 | PASS |
| MESSAGE-01.history.limit-1.API | owner | API | 200 | 200 | PASS |
| MESSAGE-01.history.limit-x.API | owner | API | 400 | 422 | PASS |
| MESSAGE-01.history.invalid-box.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.history.plan-filter.API | owner | API | only that plan | n=15 | PASS |
| MESSAGE-01.history.plan-filter-empty.API | owner | API | [] | n=0 | PASS |
| MESSAGE-01.history.no-cursor-parameter.API | owner | API | a cursor/offset param exists to reach messages beyond limit | before param ignored: n=15 (total 15); schema only has plan_id/box/limit | FAIL (W3-MSG-D8) |
| MESSAGE-01.history.detail-bad-uuid.API | owner | API | 400 | 400 | PASS |
| MESSAGE-01.history.detail-unknown.API | owner | API | 404 | 404 | PASS |
| MESSAGE-01.retry.nothing-after-reprocess.setup | owner | API | (setup) failed rows requeued by empty body retry | requeued 2 | PASS |
| MESSAGE-01.retry.subset-guest-only.API | owner | API+DB | requeued 1; b1 email stays failed | 200 {"requeued":1} b1=failed guest=simulated b1retries=1 | PASS |
| MESSAGE-01.retry.preserves-effect-and-message-identity.DB | owner | DB | same effect, no new message/notification | effects=1 msgs=1 | PASS |
| MESSAGE-01.retry.no-duplicate-in-app-notification.API | b1 | API | still one notification for m1 | 1 | PASS |
| MESSAGE-01.retry.person-not-in-message.API | owner | API | 200 requeued 0 | 200 {"requeued":0} | PASS |
| MESSAGE-01.retry.empty-person-ids.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.retry.bad-person-id.API | owner | API | 400/422 | 422 | PASS |
| MESSAGE-01.retry.recipient.b1.API | b1 | API+DB | 404/403, nothing requeued | 404 guest=failed | PASS |
| MESSAGE-01.retry.other-sender.legacy.API | legacy | API+DB | 404 | 404 | PASS |
| MESSAGE-01.retry.non-recipient.API | outsider | API | 404 | 404 | PASS |
| MESSAGE-01.retry.other-org.API | ownerb | API | 404 | 404 | PASS |
| MESSAGE-01.retry.recipient.RPC | b1 | RLS/RPC | P0002 denied | 500 P0002 | PASS |
| MESSAGE-01.retry.admin.API | admin | API | 200 requeued>=1 | 200 {"requeued":2} | PASS |
| MESSAGE-01.retry.nothing-failed.API | owner | API | 200 requeued 0 | 200 {"requeued":0} | PASS |
| MESSAGE-01.retry.unknown.API | owner | API | 404 | 404 | PASS |
| MESSAGE-01.send.lead.team_members.API | lead | API+DB | 201; recipients Band roster | 201 rc=6 | PASS |
| MESSAGE-01.read.recipient-before-revocation.revoked.API | revoked | API | 200 | 200 | PASS |
| MESSAGE-01.read.recipient-after-revocation.revoked.API | revoked | API | 403 (not a member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| MESSAGE-01.list.received.after-revocation.revoked.API | revoked | API | 403 | 403 | PASS |
| MESSAGE-01.read.after-revocation.revoked.RLS | revoked | RLS | [] (is_message_recipient requires active) | 200 n=0 | PASS |
| MESSAGE-01.send.queued-delivery-skipped-for-revoked-recipient.DB | revoked | DB (service-role inspection fn) | recipient_current=false so worker will not send | f | PASS |
| MESSAGE-01.notify.after-revocation.revoked.API | revoked | API | 403 | 403 | PASS |
| MESSAGE-01.preview.lead-after-grant-revoked.API | lead | API | 403 | 403 | PASS |
| MESSAGE-01.retry.lead-after-grant-revoked.API | lead | API | 404/403 | 404 | PASS |
| MESSAGE-01.read.own-sent-after-grant-revoked.lead.API | lead | API | 200 history still visible (creator, active member) with outcomes? observation | 200 outcomes=present | PASS |
| MESSAGE-01.tpl.list.lead-after-grant-revoked.API | lead | API | 403 | 403 | PASS |
| MESSAGE-01.web-ui.compose-preview-history | owner | W | /messages UI preview/template mgmt/history/retry | browser not owned by this package (QA-09) | NOT_RUN |
| MESSAGE-01.mobile-ui.compose | owner | M | MOB-018 compose/detail screens | native not run in this package | NOT_RUN |
| MESSAGE-01.signups-audience | owner | API | include signups -> claims awaiting_approval/confirmed | no signup opportunity fixture created in this package (owned by QA-05 opportunities); resolver read in source only | NOT_RUN |

## MESSAGE-02 results (3 cases: 2 NOT_RUN, 1 NOT_APPLICABLE)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MESSAGE-02.device-sms-email-handoff | member | M physical device | device composer handoff, cancel, no handler, oversize audience | requires iOS/Android composer on physical device | NOT_RUN |
| MESSAGE-02.app-never-claims-device-delivery | member | M physical device | no delivered claim after handoff | native only | NOT_RUN |
| MESSAGE-02.api-no-device-send-endpoint | member | API | no server endpoint claims device SMS delivery | grep: server only records in-app/push/email effects; no SMS channel (delivery_channel enum in_app,push,email) | NOT_APPLICABLE |

## CHAT-01 results (184 cases: 180 PASS, 2 NOT_RUN, 1 NOT_APPLICABLE, 1 FAIL)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT-01.open.team.owner.API | owner | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.admin.API | admin | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.legacy.API | legacy | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.scoped.API | scoped | API | observe (Band not attached to Sunday scope) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.team.lead.API | lead | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.b1.API | b1 | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.b2.API | b2 | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.b3.API | b3 | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.revoked.API | revoked | API | 200 summary | 200 {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a | PASS |
| CHAT-01.open.team.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.team.child.API | child | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.owner.API | owner | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.admin.API | admin | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.legacy.API | legacy | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.scoped.API | scoped | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.lead.API | lead | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.b1.API | b1 | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.b2.API | b2 | API | 200 summary | 200 {"id":"c00417c6-2f2b-4d18-b50e-dbab2d6e3323","kind":"plan","team_id":null,"plan_id":"3 | PASS |
| CHAT-01.open.plan.b3.API | b3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.revoked.API | revoked | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.child.API | child | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.single-conversation-per-target.DB | owner | DB | one team conv + one plan conv | 1/1 | PASS |
| CHAT-01.open.denied-leaves-no-orphan-rows.DB | outsider | DB | no conversation created by denied opens beyond the first legit one | 2 | PASS |
| CHAT-01.open.concurrent-first-open.API | owner | API+DB | all 200, same id, one row | 200,200,200,200,200 rows=1 ids=1 | PASS |
| CHAT-01.open.other-org-team.B-header.API | ownerb | API | 404 no conversation created | 404 rows=1 | PASS |
| CHAT-01.open.other-org-A-header.API | ownerb | API | 403 | 403 | PASS |
| CHAT-01.open.unknown-target.API | owner | API | 404 | 404 | PASS |
| CHAT-01.open.invalid-kind.API | owner | API | 400/422 | 422 | PASS |
| CHAT-01.open.bad-uuid.API | owner | API | 400/422 | 422 | PASS |
| CHAT-01.open.team-without-members.owner.API | owner | API | 200 (owner can manage) | 200 | PASS |
| CHAT-01.open.team-other.lead.API | lead | API | 404 (no scope on Production) | 404 | PASS |
| CHAT-01.list.b1.API | b1 | API | conversations: team,plan | team,plan | PASS |
| CHAT-01.list.b1.RLS | b1 | RLS | rows match access | n=2 | PASS |
| CHAT-01.list.b3.API | b3 | API | conversations: team | team | PASS |
| CHAT-01.list.b3.RLS | b3 | RLS | rows match access | n=1 | PASS |
| CHAT-01.list.lead.API | lead | API | conversations: team | team | PASS |
| CHAT-01.list.lead.RLS | lead | RLS | rows match access | n=1 | PASS |
| CHAT-01.list.outsider.API | outsider | API | conversations: none | none | PASS |
| CHAT-01.list.outsider.RLS | outsider | RLS | rows match access | n=0 | PASS |
| CHAT-01.list.child.API | child | API | conversations: none | none | PASS |
| CHAT-01.list.child.RLS | child | RLS | rows match access | n=0 | PASS |
| CHAT-01.list.owner.API | owner | API | conversations: team,plan,plan2,prod | team,plan,plan2,prod | PASS |
| CHAT-01.list.owner.RLS | owner | RLS | rows match access | n=4 | PASS |
| CHAT-01.list.other-org.API | ownerb | API | [] | n=0 | PASS |
| CHAT-01.list.other-org.RLS | ownerb | RLS | [] | n=0 | PASS |
| CHAT-01.insert.direct-table.RLS | owner | RLS | denied | 403 | PASS |
| CHAT-01.post.team.b1.API | b1 | API+DB | 201 stored | 201 {"item":{"id":"fd4a063f-d997-4371-8155-15ce7b72f06b","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.b1.API | b1 | API | 200 | 200 | PASS |
| CHAT-01.read.team.b1.RLS | b1 | RLS | rows | n=1 | PASS |
| CHAT-01.post.team.b2.API | b2 | API+DB | 201 stored | 201 {"item":{"id":"d7a03013-1e16-4b7c-8c09-10fd5664e34e","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.b2.API | b2 | API | 200 | 200 | PASS |
| CHAT-01.read.team.b2.RLS | b2 | RLS | rows | n=2 | PASS |
| CHAT-01.post.team.b3.API | b3 | API+DB | 201 stored | 201 {"item":{"id":"9a7be93d-eef2-4b90-85cd-ce9514d7e8db","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.b3.API | b3 | API | 200 | 200 | PASS |
| CHAT-01.read.team.b3.RLS | b3 | RLS | rows | n=3 | PASS |
| CHAT-01.post.team.lead.API | lead | API+DB | 201 stored | 201 {"item":{"id":"e369dd46-f0c1-4cab-8207-ad5fcc9301b2","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.lead.API | lead | API | 200 | 200 | PASS |
| CHAT-01.read.team.lead.RLS | lead | RLS | rows | n=4 | PASS |
| CHAT-01.post.team.revoked.API | revoked | API+DB | 201 stored | 201 {"item":{"id":"a2bd8e43-c290-467d-9289-130c81a0d881","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.revoked.API | revoked | API | 200 | 200 | PASS |
| CHAT-01.read.team.revoked.RLS | revoked | RLS | rows | n=5 | PASS |
| CHAT-01.post.team.owner.API | owner | API+DB | 201 stored | 201 {"item":{"id":"dc05855e-cf3b-4197-a971-ddcf9795a4d9","organization_id":"375b0601-872c- | PASS |
| CHAT-01.read.team.owner.API | owner | API | 200 | 200 | PASS |
| CHAT-01.read.team.owner.RLS | owner | RLS | rows | n=6 | PASS |
| CHAT-01.post.team.outsider.API | outsider | API+DB | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.read.team.outsider.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.read.team.outsider.RLS | outsider | RLS | [] | n=0 | PASS |
| CHAT-01.post.team.child.API | child | API+DB | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.read.team.child.API | child | API | 404 | 404 | PASS |
| CHAT-01.read.team.child.RLS | child | RLS | [] | n=0 | PASS |
| CHAT-01.post.plan.b1.API | b1 | API+DB | 201 | 201 {"item":{"id":"99b60455-6266-4f56-9bf3-48e6041397e7","organization_id":"375b0601-872c- | PASS |
| CHAT-01.post.plan.b2.API | b2 | API+DB | 201 | 201 {"item":{"id":"ac044dba-5e2a-4169-883c-80fe9a00b696","organization_id":"375b0601-872c- | PASS |
| CHAT-01.post.plan.b3.API | b3 | API+DB | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.post.plan.lead.API | lead | API+DB | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.post.plan.outsider.API | outsider | API+DB | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.post.plan.owner.API | owner | API+DB | 201 | 201 {"item":{"id":"836127bb-3371-4da8-b732-9c43f9b96ba2","organization_id":"375b0601-872c- | PASS |
| CHAT-01.post.plan.scoped.API | scoped | API+DB | 201 | 201 {"item":{"id":"8519fa0a-fd9f-402b-9f31-4cf3d8e22839","organization_id":"375b0601-872c- | PASS |
| CHAT-01.post.other-org-B-header.API | ownerb | API | 404 | 404 | PASS |
| CHAT-01.post.other-org-A-header.API | ownerb | API | 403 | 403 | PASS |
| CHAT-01.post.other-org.RPC | ownerb | RLS/RPC | P0002/denied | 500 P0002 | PASS |
| CHAT-01.post.nonparticipant.RPC | outsider | RLS/RPC | denied | 500 P0002 | PASS |
| CHAT-01.post.direct-table.RLS | b1 | RLS | denied (no insert grant) | 403 | PASS |
| CHAT-01.edit.direct-table.RLS | b1 | RLS | denied | 403 | PASS |
| CHAT-01.delete.direct-table.RLS | b1 | RLS | denied | 403 | PASS |
| CHAT-01.post.blank.API | b1 | API | 400/422 | 422 | PASS |
| CHAT-01.post.4001.API | b1 | API | 400/422 | 422 | PASS |
| CHAT-01.post.4000.API | b1 | API | 201 | 201 | PASS |
| CHAT-01.post.bad-id.API | b1 | API | 400/422 | 422 | PASS |
| CHAT-01.post.21-mentions.API | b1 | API | 400/422 | 422 | PASS |
| CHAT-01.post.unknown-conversation.API | b1 | API | 404 | 404 | PASS |
| CHAT-01.post.bad-conversation-uuid.API | b1 | API | 400 | 400 | PASS |
| CHAT-01.post.markup-unicode.API | b1 | API | 201 verbatim | 201 {"item":{"id":"b9498c09-4459-4ad0-8666-5fc9def2cd25","organization_id":"375b0601-872c-4881-9302- | PASS |
| CHAT-01.post.duplicate-id-replay.API | b1 | API+DB | 201 then 200 replayed; 1 message; 1 effect | 201/200 rows=1 effects=1 | PASS |
| CHAT-01.post.duplicate-id-single-notification.b2.API | b2 | API | one notification for message | 1 | PASS |
| CHAT-01.post.duplicate-id-different-body.API | b1 | API | replay original body or 409 | 200 idem | PASS |
| CHAT-01.post.duplicate-id-other-author.API | b2 | API | 409 message_id_conflict unchanged | 409 | PASS |
| CHAT-01.post.duplicate-id-other-conversation.API | b1 | API | 409 | 409 | PASS |
| CHAT-01.post.duplicate-id-nonparticipant-probe.API | outsider | API | 404 (no id oracle) | 404 | PASS |
| CHAT-01.post.concurrent-same-id.API | b2 | API+DB | 1 row, 1 effect, one 201 | 200,200,200,200,201 rows=1 eff=1 | PASS |
| CHAT-01.mention.resolutions.DB | b1 | DB | b2 notified; b3 muted; outsider no_access; nolog no_login | ["b2:notified","b3:muted","outsider:no_access","nolog:no_login"] | PASS |
| CHAT-01.notify.recipients.participants-not-author-not-muted.API | b1 | API | b2,lead,revoked,owner? (owner/admin/legacy access team conv): b2,lead,revoked; NOT b1(author), b3(muted), outsider, child | b1:0 b2:1 b3:0 lead:1 revoked:1 owner:1 outsider:0 child:0 admin:1 legacy:1 | PASS |
| CHAT-01.notify.owner-admin-legacy-with-access-notified-too.API | owner | API | info: owner/admin/legacy (via scheduling scope) are participants -> notified | owner:1 admin:1 legacy:1 | PASS |
| CHAT-01.notify.single-per-user-per-message.API | b2 | API | mentioned user gets 1 notification (not mention+message duplicates) | 1 | PASS |
| CHAT-01.notify.snippet-and-target.b2.API | b2 | API | notification carries conversation_id (exact target), no full-body leak beyond snippet | {"type":"conversation_mention","title":"Bea One mentioned you in Band chat","body":"Notify check @b2","conversation_id":true} | PASS |
| CHAT-01.unread.increments-for-others.b2.API | b2 | API | +2 | 1->3 | PASS |
| CHAT-01.unread.own-messages-not-unread.b1.API | b1 | API | 0 for author (post marks read) | 0 | PASS |
| CHAT-01.read.mark-read.b2.API | b2 | API | 200, unread 0 | 200 unread=0 | PASS |
| CHAT-01.read.older-read_at-never-moves-backwards.API | b2 | API+DB | last_read_at unchanged | 200 2026-11-18 17:22:56.418+00=>2026-11-18 17:22:56.418+00 | PASS |
| CHAT-01.read.future-read_at-clamped-to-now.API | b2 | API+DB | clamped | 200 <=now t | PASS |
| CHAT-01.read.future-read-does-not-hide-new-messages.API | b2 | API | new message after clamp still unread (1) | 1 | PASS |
| CHAT-01.read.bad-timestamp.API | b2 | API | 400/422 | 422 | PASS |
| CHAT-01.read.nonparticipant.API | outsider | API+DB | 404, no state row | 404 rows=0 | PASS |
| CHAT-01.mute.on.b2.API | b2 | API | 200 muted | {"muted":true} | PASS |
| CHAT-01.mute.no-notification-while-muted.b2.API | b2 | API | 0 new notifications | 0 | PASS |
| CHAT-01.mute.unread-still-counted-but-flag-set.b2.API | b2 | API | muted=true in list, unread increments | {"id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad","kind":"team","team_id":"9f54c778-6d88-4a9f-8011-831a69c8a3aa","plan_id":null,"title":"Band","service_date":null,"l | PASS |
| CHAT-01.mute.invalid-body.API | b2 | API | 400/422 | 422 | PASS |
| CHAT-01.mute.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.mute.off.b2.API | b2 | API | 200 unmuted | {"muted":false} | PASS |
| CHAT-01.member-state.own-only.RLS | b2 | RLS | only own rows | n=2 all-own=true | PASS |
| CHAT-01.mute.unknown-conversation.API | b2 | API | 404 | 404 | PASS |
| CHAT-01.reply.valid.API | b2 | API | 201 reply_to_id set | 201 {"item":{"id":"0281d180-a645-4c03-b6bc-ca49c82e6d8a","organization_id":"375b0601-872c-4881-9302- | PASS |
| CHAT-01.reply.notifies-original-author-once.b1.API | b1 | API | exactly 1 (message notification dedup with reply) | 1 | PASS |
| CHAT-01.reply.to-message-in-other-conversation.API | b2 | API | 404 no row | 404 | PASS |
| CHAT-01.reply.unknown-target.API | b2 | API | 404 | 404 | PASS |
| CHAT-01.edit.author.API | b1 | API+DB | 200 edited_at, audit row | 200 1 | PASS |
| CHAT-01.edit.non-author.b2.API | b2 | API | 403 unchanged | 403 | PASS |
| CHAT-01.edit.non-author.owner.API | owner | API | 403 unchanged | 403 | PASS |
| CHAT-01.edit.non-author.lead.API | lead | API | 403 unchanged | 403 | PASS |
| CHAT-01.edit.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.edit.wrong-conversation-path.API | b1 | API+DB | 404 unchanged | 404 body=edited | PASS |
| CHAT-01.edit.blank.API | b1 | API | 400/422 | 422 | PASS |
| CHAT-01.delete.non-author-non-moderator.b2.API | b2 | API | 403 unchanged | 403 | PASS |
| CHAT-01.delete.team-manager-moderates.lead.API | lead | API+DB | 200 tombstone (teams.manage on Band) | 200 deleted=t | PASS |
| CHAT-01.edit.deleted.API | b1 | API | 409 | 409 | PASS |
| CHAT-01.restore.deleted-not-supported-by-author.API | b1 | API | 404 (author cannot restore)  | 404 | PASS |
| CHAT-01.restore.deleted-message.moderator.API | lead | API+DB | 200 no-op for deleted (restore only hidden); body stays empty | 200 body= | PASS |
| CHAT-01.delete.twice.API | b1 | API | 200 idempotent | 200 | PASS |
| CHAT-01.delete.author.API | b2 | API | 200 tombstone | 200 | PASS |
| CHAT-01.read.deleted-tombstone-no-body.API | b1 | API | no body in payload | {"id":"e4d93b83-a56a-4f0d-9fdf-5987e650c27f","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","conversation_id":"d6a6d3b5-6454-475b-a1d8-21dca | PASS |
| CHAT-01.report.own-message.API | b1 | API | 400 (cannot report own) | 400 | PASS |
| CHAT-01.report.create.b2.API | b2 | API+DB | 201 open report | 201 {"id":"44dfd93e-83e5-47b2-beec-08fd1e83205e","organization_id":"375b0601-872c-4881-9302-75a6a95a | PASS |
| CHAT-01.report.duplicate-same-reporter.API | b2 | API+DB | 201 returns existing; 1 row | 201 rows=1 | PASS |
| CHAT-01.report.invalid-reason.API | b2 | API | 400/422 | 422 | PASS |
| CHAT-01.report.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.report.details-1001.API | b3 | API | 400/422 | 422 | PASS |
| CHAT-01.report.reporter-sees-own-only.RLS | b2 | RLS | only own report | n=1 | PASS |
| CHAT-01.report.author-cannot-see-reports-on-own-message.RLS | b1 | RLS | [] (reporter anonymity) | n=0 | PASS |
| CHAT-01.detail.non-moderator-no-reports.b1.API | b1 | API | reports [] and can_moderate false | 200 reports=0 can_moderate=false open_reports=0 | PASS |
| CHAT-01.detail.moderator-sees-open-reports.lead.API | lead | API | 2 open reports with reporter names | reports=2 open=2 | PASS |
| CHAT-01.report.resolve.non-moderator.API | b2 | API | 404, still open | 404 | PASS |
| CHAT-01.report.resolve.wrong-conversation-path.API | lead | API | 404, still open | 404 | PASS |
| CHAT-01.report.resolve.invalid-action.API | lead | API | 400/422 | 422 | PASS |
| CHAT-01.report.resolve.hide.lead.API | lead | API+DB | 200 actioned; message hidden (body blanked); all open reports on message actioned | 200 status=actioned hidden=t open=0 | PASS |
| CHAT-01.read.hidden-message-shows-no-body.b1.API | b1 | API | no body | {"id":"76c32dce-7f6d-47fd-a31a-506b6c64f2b1","organization_id":"375b0601-872c-4881-9302-75a6a95a8c8f","conversation_id":"d6a6d3b5-6454-475b-a1d8-21dcad0d68ad"," | PASS |
| CHAT-01.restore.hidden.non-moderator.API | b1 | API | 404/403 not restored | 404 | PASS |
| CHAT-01.restore.hidden.moderator.API | lead | API+DB | 200 body restored from audit | 200 body=reportable offensive | PASS |
| CHAT-01.report.resolve.dismiss.lead.API | lead | API+DB | 200 dismissed; message intact | 200 dismissed body=dismiss me | PASS |
| CHAT-01.report.resolve.already-resolved.API | lead | API | 200 returns existing (no re-hide) | 200 dismissed hidden=f | PASS |
| CHAT-01.report.resolve.unknown.API | owner | API | 404 | 404 | PASS |
| CHAT-01.unsupported-actions-not-advertised.API | b1 | API | no edit-others/pin/react endpoints; summary exposes only implemented flags | id,kind,team_id,plan_id,title,service_date,last_message_at,unread_count,muted,can_moderate,open_reports | PASS |
| CHAT-01.pagination.complete-no-dupes.API | owner | API | all once | pages=3 seen=7 uniq=7 total=7 | PASS |
| CHAT-01.pagination.chronological-within-page.API | owner | API | ascending oldest->newest; first page newest | 2026-11-18T17:22:59.06296+00:00 2026-11-18T17:22:59.097419+00:00 2026-11-18T17:22:59.1317+00:00 | PASS |
| CHAT-01.pagination.limit-0.API | owner | API | 400 | 422 | PASS |
| CHAT-01.pagination.limit-101.API | owner | API | 400 | 422 | PASS |
| CHAT-01.pagination.limit-1.API | owner | API | 200 | 200 | PASS |
| CHAT-01.pagination.limit-100.API | owner | API | 200 | 200 | PASS |
| CHAT-01.pagination.single-page-no-cursor.API | owner | API | next_before null | null | PASS |
| CHAT-01.search.q.API | owner | API | matches | 200 n=7 | PASS |
| CHAT-01.search.q-1-char.API | owner | API | 400/422 | 422 | PASS |
| CHAT-01.search.no-results.API | owner | API | 200 [] | 200 n=0 | PASS |
| CHAT-01.search.hidden-message-not-searchable.API | b1 | API | after hide the body is blank -> not findable (restored now: findable) | n=1 | PASS |
| CHAT-01.search.sql-metacharacters.API | owner | API | 200/400 not 500 | 200 | PASS |
| CHAT-01.search.tsquery-metacharacters.API | owner | API | 200 (plain) not 500 | 200 | PASS |
| CHAT-01.search.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.detail.participant.API | b1 | API | 200 conversation+messages+reports | 200 msgs=5 | PASS |
| CHAT-01.detail.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.detail.other-org-B-header.API | ownerb | API | 404 | 404 | PASS |
| CHAT-01.mention-candidates.b1.API | b1 | API | participants only (no outsider/child), no self | Adam Admin\|Ben Two\|Bo Three\|Lee Lead\|Lena Legacy\|Olive Owner\|Rev Oked | PASS |
| CHAT-01.mention-candidates.nonparticipant.API | outsider | API | 404 | 404 | PASS |
| CHAT-01.web-ui | b1 | W | Web chat list/thread/composer | browser not owned (QA-09) | NOT_RUN |
| CHAT-01.mobile-ui | b1 | M | MOB-019 chat screens/keyboard/pagination | native not run | NOT_RUN |
| CHAT-01.upload-attachments | b1 | API | chat attachments | no attachment/upload path in conversation schema or routes at frozen commit; not advertised | NOT_APPLICABLE |
| CHAT-01.pagination.identical-created_at-ties.API | b1 | API+DB | every message exactly once when created_at ties | seen=6 total=10 (keyset on created_at only) | FAIL (W3-MSG-D2) |

## CHAT-02 results (66 cases: 54 PASS, 2 NOT_APPLICABLE, 7 FAIL, 3 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT-02.baseline.read.revoked-before.API | revoked | API | 200 | 200 | PASS |
| CHAT-02.inactive-membership.read.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.detail.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.list.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.post.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.open.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.mark-read.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.mute.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.notifications.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.mentions.API | revoked | API | 403 (not an active member) | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.inactive-membership.read-messages.RLS | revoked | RLS | [] | 200 n=0 | PASS |
| CHAT-02.inactive-membership.read-conversations.RLS | revoked | RLS | [] | n=0 | PASS |
| CHAT-02.inactive-membership.notifications-table.RLS | revoked | RLS | [] (is_org_member required) | n=0 | PASS |
| CHAT-02.inactive-membership.post.RPC | revoked | RLS/RPC | denied | 500 P0002 | PASS |
| CHAT-02.inactive-membership.unread-count.API | revoked | API | 403 (org-scoped); account_unread via RLS excludes org A | 403 | PASS |
| CHAT-02.account-unread-excludes-orgs-without-access.b1.API | b1 | API | account_unread counts A (b1 still member): >= org B unread | {"unread":0,"account_unread":24} | PASS |
| CHAT-02.inactive-membership.unread-badge-identity.DB | revoked | DB | unread rows exist in DB but are RLS-hidden so badge (account_unread) excludes them | db unread rows=12 | PASS |
| CHAT-02.inactive-membership.no-partial-write.DB | revoked | DB | message count unchanged | 22->22 | PASS |
| CHAT-02.inactive-membership.dispatch-gate-function.DB | revoked | DB (service-role fn used by worker) | false -> worker skips queued push/in-app | f | PASS |
| CHAT-02.inactive-membership.other-participants-unaffected.b1.API | b1 | API | 200 | 200 | PASS |
| CHAT-02.inactive-membership.no-notification-created-for-revoked.DB | revoked | DB | 0 | 0 | PASS |
| CHAT-02.inactive-membership.no-outbox-rows-for-revoked.DB | revoked | DB | 0 delivery rows (in_app/push) | 0 | PASS |
| CHAT-02.reinstated.history-visible-again.API | revoked | API | 200; observe whether messages posted during revocation visible | 200 sees-during-revocation=true | PASS |
| CHAT-02.suspended-membership | revoked | API | suspended member denied | membership suspension is only settable when a church is disabled (guard_member_suspension); covered by platform-admin package | NOT_APPLICABLE |
| CHAT-02.roster-removal.baseline-notification.revoked.API | revoked | API | has notification for conversation | n=1 | PASS |
| CHAT-02.roster-removal.remove-member.setup.API | owner | API | 204 | 204 | PASS |
| CHAT-02.roster-removal.read.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.detail.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.post.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.mark-read.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.mute.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.search.API | revoked | API | 404 (no access) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.edit-own-old-message.API | revoked | API | 404 (no access) | 404 {"error":"Not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.delete-own-old-message.API | revoked | API | 404 (no access) | 404 {"error":"Not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.report.API | revoked | API | 404 (no access) | 404 {"error":"Not found","code":"not_found"} | PASS |
| CHAT-02.roster-removal.list-omits-conversation.API | revoked | API | not listed | false | PASS |
| CHAT-02.roster-removal.read.RLS | revoked | RLS | [] | n=0 | PASS |
| CHAT-02.roster-removal.no-deliveries-after-removal.DB | revoked | DB | 0 rows | 0 | PASS |
| CHAT-02.roster-removal.stale-notification-snippet-retained.API | revoked | API | after losing access, old notification (with message snippet) is unavailable/redacted | still listed n=1; body="before removal secret-ish text" | FAIL (W3-MSG-D9) |
| CHAT-02.roster-removal.notification-target-opens-unavailable.API | revoked | API | conversation open 404 (unavailable) | 404 | PASS |
| CHAT-02.roster-removal.readd-member.setup.API | owner | API | 201 | 201 | PASS |
| CHAT-02.roster-removal.readd-restores-access.API | revoked | API | 200 | 200 | PASS |
| CHAT-02.archived-person.read.API | revoked | API | 404/403 | 404 | PASS |
| CHAT-02.archived-person.post.API | revoked | API | 404/403 | 404 | PASS |
| CHAT-02.stale-composer.post-with-other-org-header.API | b1 | API+DB | 404/409 (conversation not in active org B), no row | 201 rows=1 | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.read-with-other-org-header.API | b1 | API | 404 | 404 | PASS |
| CHAT-02.stale-composer.detail-with-other-org-header.API | b1 | API | 404 | 404 | PASS |
| CHAT-02.stale-composer.edit-with-other-org-header.API | b1 | API+DB | 404, unchanged | 200 body=edited via B header | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.mark-read-with-other-org-header.API | b1 | API | 404 | 200 | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.mute-with-other-org-header.API | b1 | API+DB | 404, no state change | 200 muted=t | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.delete-with-other-org-header.API | b1 | API+DB | 404, not deleted | 200 deleted=t | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.report-with-other-org-header.API | b1 | API+DB | 404, no report row | 201 reports=1 | FAIL (W3-MSG-D4) |
| CHAT-02.stale-composer.same-draft-with-correct-org-succeeds.API | b1 | API | 201 (draft re-sent to correct org) | 201 | PASS |
| CHAT-02.target-deleted.baseline-notification.b1.API | b1 | API | notification exists for plan3 conv | n=1 | PASS |
| CHAT-02.target-deleted.delete-plan.setup.API | owner | API | 204 | 204 | PASS |
| CHAT-02.target-deleted.read-conversation.API | b1 | API | 404 | 404 | PASS |
| CHAT-02.target-deleted.post.API | b1 | API | 404 no row | 404 rows=0 | PASS |
| CHAT-02.target-deleted.notifications-removed-or-unavailable.API | b1 | API | no dangling notification pointing at deleted conversation | n=0 | PASS |
| CHAT-02.target-deleted.list-omits.API | b1 | API | not listed | false | PASS |
| CHAT-02.target-deleted.delete-team.setup.API | owner | API | 204 | 204 | PASS |
| CHAT-02.target-deleted.team-conversation-read.API | b2 | API | 404 | 404 | PASS |
| CHAT-02.race.revoke-during-concurrent-posts.API | revoked | API+DB | posts after revocation commit denied; none stored after | 201:1 denied:11 other:0 stored-after-revoke-commit=0 | PASS |
| CHAT-02.draft-isolation.per-conversation-per-org | b1 | W/M | client draft not shared across orgs/users | client-side storage; requires browser (QA-09) / native | NOT_RUN |
| CHAT-02.upload-during-revocation | revoked | API | upload while revoked | chat has no attachments (see CHAT-01.upload-attachments) | NOT_APPLICABLE |
| CHAT-02.web-mobile-ui | revoked | W/M/S | Web/mobile revoked-view UX, session invalidation on device | browser/native not run in this package | NOT_RUN |
| CHAT-02.queued-delivery-skipped-after-revocation.worker | revoked | J worker | queued push/in-app for revoked skipped at dispatch | requires running delivery worker (QA-07 owns); gate function verified at DB level only | NOT_RUN |

## NOTIFY-01 results (65 cases: 60 PASS, 3 FAIL, 2 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| NOTIFY-01.list.baseline.b1.API | b1 | API+DB | 200; all own org-A notifications; newest first | 200 n=31 db=31 unread=31/31 | PASS |
| NOTIFY-01.list.order-desc.API | b1 | API | created_at desc | 2026-11-18T17:24:29.264764+00:00 2026-11-18T17:24:17.79159+00:00 | PASS |
| NOTIFY-01.list.only-own-and-active-org.API | b1 | API | no B-org item and no foreign user items in org A feed | B-org items=0 | PASS |
| NOTIFY-01.list.default-limit-30.API | b1 | API | <=30 | 30 | PASS |
| NOTIFY-01.list.limit-0.API | b1 | API | 400 | 422 | PASS |
| NOTIFY-01.list.limit-101.API | b1 | API | 400 | 422 | PASS |
| NOTIFY-01.list.limit-100.API | b1 | API | 200 | 200 | PASS |
| NOTIFY-01.list.limit-1.API | b1 | API | 200 | 200 | PASS |
| NOTIFY-01.list.limit-abc.API | b1 | API | 400 | 422 | PASS |
| NOTIFY-01.list.bad-cursor.API | b1 | API | 400/422 | 422 | PASS |
| NOTIFY-01.list.cursor-before-all.API | b1 | API | 200 empty, next_cursor null | 200 n=0 next=null | PASS |
| NOTIFY-01.list.unread-only.API | b1 | API | only unread | n=31 allUnread=true | PASS |
| NOTIFY-01.list.unread-only-invalid.API | b1 | API | 400/422 | 422 | PASS |
| NOTIFY-01.pagination.next_cursor-echoed-as-before.API | b1 | API | page 2 loads with the server-issued next_cursor verbatim (mobile/notifications.tsx does this) | next_cursor=2026-11-18T17:24:17.79159+00:00 -> 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"b | FAIL (W3-MSG-D3) |
| NOTIFY-01.list.empty.outsider.API | outsider | API | 200 empty/few | n=0 unread=0 | PASS |
| NOTIFY-01.pagination.complete-no-dupes.API | b1 | API | every notification exactly once | pages=7 seen=31 uniq=31 total=31 | PASS |
| NOTIFY-01.pagination.exact-boundary-next_cursor.API | b1 | API | info: next_cursor returned when items==limit even if none remain | items=31 next=set | PASS |
| NOTIFY-01.pagination.identical-created_at-ties.API | b2 | API+DB | every notification exactly once when created_at ties | seen=32 total=35 (keyset on created_at only) | FAIL (W3-MSG-D2) |
| NOTIFY-01.unread-count.org-A.b1.API | b1 | API | unread = DB org A; account_unread = A + B | {"unread":31,"account_unread":32} db A=31 B=1 | PASS |
| NOTIFY-01.unread-count.org-B.b1.API | b1 | API | unread=1 (B only); account_unread unchanged | {"unread":1,"account_unread":32} | PASS |
| NOTIFY-01.list.org-B-isolated.b1.API | b1 | API | only B-org notice | B-org notice | PASS |
| NOTIFY-01.list.other-org-user.API | ownerb | API | none of A | n=0 | PASS |
| NOTIFY-01.list.other-org-A-header.API | ownerb | API | 403 | 403 | PASS |
| NOTIFY-01.list.no-token.API | anonymous | API | 401 | 401 | PASS |
| NOTIFY-01.get.own.API | b1 | API | 200 | 200 | PASS |
| NOTIFY-01.get.other-users.API | b1 | API | 404 | 404 | PASS |
| NOTIFY-01.get.own-wrong-org-header.API | b1 | API | 404 | 404 | PASS |
| NOTIFY-01.get.bad-uuid.API | b1 | API | 400 | 400 | PASS |
| NOTIFY-01.get.unknown.API | b1 | API | 404 | 404 | PASS |
| NOTIFY-01.read.single.b1.API | b1 | API+DB | unread -1 | 200 {"unread":30,"account_unread":31} db=30 | PASS |
| NOTIFY-01.read.idempotent.b1.API | b1 | API | unchanged | 200 db=30 | PASS |
| NOTIFY-01.read.foreign-ids.API | b1 | API+DB | b2 unaffected | 200 b2 30->30 | PASS |
| NOTIFY-01.read.wrong-org-header-scope.API | b1 | API+DB | org-A notification not marked via org B | 200 still unread=t | PASS |
| NOTIFY-01.read.empty-ids.API | b1 | API | 400/422 | 422 | PASS |
| NOTIFY-01.read.201-ids.API | b1 | API | 400/422 | 422 | PASS |
| NOTIFY-01.read.bad-id.API | b1 | API | 400/422 | 422 | PASS |
| NOTIFY-01.read.unknown-id.API | b1 | API | 200 no change | 200 | PASS |
| NOTIFY-01.read.all.b1.API | b1 | API+DB | unread 0 in org A, org B unread untouched | 200 {"unread":0,"account_unread":1} A=0 B=1 | PASS |
| NOTIFY-01.read.all.twice.API | b1 | API | 200 unread 0 | 200 | PASS |
| NOTIFY-01.read.all.other-org-user-no-effect-on-A.API | ownerb | API+DB | A unread unchanged | 200 b2=30 | PASS |
| NOTIFY-01.unread-count.after-read-all.b1.API | b1 | API | unread 0 | {"unread":0,"account_unread":1} | PASS |
| NOTIFY-01.delete.other-users.API | b1 | API+DB | 204 (no disclosure) but row remains | 204 remains=1 | PASS |
| NOTIFY-01.delete.own.API | b1 | API+DB | 204 row gone | 204 remains=0 | PASS |
| NOTIFY-01.delete.twice.API | b1 | API | 204 idempotent | 204 | PASS |
| NOTIFY-01.delete.bad-uuid.API | b1 | API | 400 | 400 | PASS |
| NOTIFY-01.rls.select-own-only.b1 | b1 | RLS | only own rows | n=31 foreign=0 | PASS |
| NOTIFY-01.rls.update-foreign.b1 | b1 | RLS | 0 rows | 200 n=0 | PASS |
| NOTIFY-01.rls.insert.b1 | b1 | RLS | denied (no insert policy) | 403 | PASS |
| NOTIFY-01.rls.insert-for-other-user.b1 | b1 | RLS | denied | 403 | PASS |
| NOTIFY-01.rls.update-own-content-columns.b1 | b1 | RLS | only read_at should be writable by a reader (API/comment: "Marking as read is the only update") | 200 rows=1 title=FORGED TITLE | FAIL (W3-MSG-D10) |
| NOTIFY-01.rls.reassign-to-other-user.b1 | b1 | RLS | denied by WITH CHECK | 403 42501 | PASS |
| NOTIFY-01.rls.delete-foreign.b1 | b1 | RLS | 0 rows | 200 n=0 | PASS |
| NOTIFY-01.rls.anon-select | anonymous | RLS | [] or 401 | 200 n=0 | PASS |
| NOTIFY-01.rls.anon-update | anonymous | RLS | 0 rows / denied | 200 [] | PASS |
| NOTIFY-01.target.conversation-opens.b2.API | b2 | API | 200 for notification target | 200 | PASS |
| NOTIFY-01.target.message-opens.b1.API | b1 | API | 200 rendered_for_me | 200 | PASS |
| NOTIFY-01.target.item-thread-opens.b2.API | b2 | API | 200 | 200 | PASS |
| NOTIFY-01.target.plan-embed-shape.API | b1 | API | plan {id,title,service_date} only | {"id":"3146084f-639b-4b25-bd36-202aa3504150","title":"MSG Sunday 1","service_date":"2026-11-23T17:13:58.969+00:00"} | PASS |
| NOTIFY-01.prepared-assignment-no-notification.b3.DB | b3 | DB | 0 (prepared) | 0 | PASS |
| NOTIFY-01.target-deleted.item.baseline.b2.API | b2 | API | mention notification exists | 1 | PASS |
| NOTIFY-01.target-deleted.item.unavailable.b2.API | b2 | API | notification removed or target 404; no dangling openable link | delete=204 notif=0 target=404 | PASS |
| NOTIFY-01.target.message-after-plan-delete.keeps-readable.API | b1 | API | message remains readable (plan_id set null) | 200 n=15 | PASS |
| NOTIFY-01.read-vs-conversation-unread.independence | b2 | API | marking notifications read does not change conversation unread_count (separate counters) - documented behavior check | 0 | PASS |
| NOTIFY-01.web-bell | b1 | W | Web notification bell/list/deeplink | browser not owned (QA-09) | NOT_RUN |
| NOTIFY-01.mobile-notifications | b1 | M | MOB-020 notifications/NotificationBell/badge | native not run | NOT_RUN |

## Defects

No P0 (no cross-tenant disclosure, no prepared-assignment leak, no unauthorized persisted write by a non-participant). Variable names below: `$T` = caller access token, `ORG` = `X-Organization-Id`.

### W3-MSG-D3 (P1) Notification feed pagination breaks on page 2

- Repro: `GET /api/v1/notifications?limit=2` returns `next_cursor` such as `2026-11-18T17:24:17.79159+00:00`. Passing it back verbatim: `GET /api/v1/notifications?limit=2&before=2026-11-18T17:24:17.79159%2B00%3A00` returns `422 {"path":"before","message":"Invalid datetime"}`.
- Expected: the server-issued cursor is accepted. Actual: 422. `mobile/app/notifications.tsx:44-46` passes `next_cursor` straight into `before` (PAGE_SIZE 30), so the mobile feed cannot load more than the first 30 notifications.
- Suspected source: `packages/shared/src/schemas/notification.ts:21` (`z.string().datetime()` rejects the `+00:00` offset that PostgREST emits; the discussion schemas use `isoDateTime`, which allows offsets) and `backend/src/routes/notifications.ts:73`.
- Case: NOTIFY-01.pagination.next_cursor-echoed-as-before.API.

### W3-MSG-D4 (P1) Conversation writes ignore the active organization header (stale composer after org switch)

- Repro (b1 is a member of orgs A and B; conversation C belongs to A): `POST /conversations/{C}/messages` with `X-Organization-Id: B`, body `{"id":"<uuid>","body":"x","reply_to_id":null,"mention_person_ids":[]}` returns 201 and the row is stored in org A. Same for `PATCH /conversations/{C}/messages/{m}` (body changed), `DELETE .../messages/{m}` (deleted), `POST .../read`, `PUT .../mute` (state changed), `POST .../messages/{m}/report` (report row created). Reads (`GET .../messages`, `GET /conversations/{C}`) correctly return 404 under the wrong org header.
- Expected: 404 (conversation not in the active organization), nothing written (CHAT-02 stale composer after org switch). Actual: 2xx and persisted. Isolation of data holds (the caller keeps active membership and access in A), but a stale composer or tab keeps writing into the previous church.
- Suspected source: `backend/src/services/discussions.ts` `postConversationMessage` (line 269), `editConversationMessage` (287), `deleteConversationMessage` (295), `markConversationRead` (311), `muteConversation` (318), report/restore/resolve: none call `conversationSummary` (which filters by `caller.orgId`) before the RPC; `loadMessage` reads through RLS without an org filter.
- Cases: CHAT-02.stale-composer.{post,edit,mark-read,mute,delete,report}-with-other-org-header.API.

### W3-MSG-D1 (P2) Item-comment edit/delete via the wrong item path mutates the comment and then returns 404

- Repro: b1 posts a comment on item1. `PATCH /plan-items/{item2}/comments/{commentId}` `{"body":"changed"}` (item2 is another item of the same plan) returns 404, but `plan_item_comments.body` is now `changed` (and an audit row exists). `DELETE /plan-items/{item2}/comments/{commentId}` returns 404 and the comment is deleted (`deleted_at` set).
- Expected: 404 and no change. Actual: write persisted, false-failure response.
- Suspected source: `backend/src/services/discussions.ts:138-150` (`editItemComment`, `deleteItemComment` call the RPC with only the comment id; the item match is checked only by `loadComment` afterwards). The conversation equivalents load the message in the conversation first and are correct.
- Cases: NOTE-01.comment.edit.wrong-item-in-path.API, NOTE-01.comment.delete.wrong-item-in-path.API.

### W3-MSG-D2 (P2) Keyset pagination on `created_at` alone drops rows that share a timestamp

- Repro: 5 comments/messages/notifications with identical `created_at` in one thread, then page with `limit=2` using the returned cursor (`before=<created_at of last row>`, `lt`): item comments saw 14 of 17, conversation messages 6 of 10, notifications 32 of 35 (after normalizing the D3 cursor format). Rows tied across a page boundary are never returned.
- Expected: every row exactly once. Actual: rows skipped. Practically reachable when several notifications are inserted by one statement/transaction (shared `now()`); API-posted comments/messages are one per transaction so the window is small.
- Suspected source: `backend/src/services/discussions.ts:102` and `:213` (`lt('created_at', before)` with ordering `created_at, id`), `backend/src/routes/notifications.ts:66` and `:73`. Needs a composite cursor (`created_at`, `id`).
- Cases: NOTE-01.comment.pagination.identical-created_at-ties.API, CHAT-01.pagination.identical-created_at-ties.API, NOTIFY-01.pagination.identical-created_at-ties.API.

### W3-MSG-D9 (P2) Notifications keep message snippets after the recipient loses access to the target

- Repro: revoked (org member, Band roster) receives a `conversation_message` notification whose body quotes the message text. Remove the person from the Band roster (`DELETE /teams/{band}/members/{membershipId}`). `GET /notifications` still lists the notification with the full snippet (`before removal secret-ish text`); the conversation itself now returns 404. (Org-level revocation is correct: the notifications table is RLS-hidden once membership is inactive.)
- Expected: notification for a target the user can no longer open becomes unavailable or redacted (NOTIFY-01 "revoked/deleted target becomes unavailable"). Actual: only the link fails; the text remains readable.
- Suspected source: `supabase/migrations/20260907000000_notifications.sql:65` (`notifications_select` checks only `user_id` and org membership, not target access); `backend/src/routes/notifications.ts` feed query.
- Case: CHAT-02.roster-removal.stale-notification-snippet-retained.API.

### W3-MSG-D5 (P2) Message recipients receive the sender-side audit row

- Repro: b1 (a recipient) `GET /messages/{id}` returns `message` containing `audience` (plan and team ids), `audience_hash`, `request_hash`, `recipient_count`, `excluded_count`, `idempotency_key`, `template_id`, `variables`. Also `GET /rest/v1/operational_messages?select=*` as b1 returns the same row.
- Expected: recipients see subject/body (rendered for them) and sender name only; counts of people excluded (no address, removed by sender) are sender-side information. Actual: excluded and recipient counts and the audience definition are exposed. No contact data or co-recipient identities are exposed (`operational_message_recipients` is own-row only).
- Suspected source: `backend/src/services/messages.ts:47-52,86` (`select('*')`), policy `operational_messages_select` in `supabase/migrations/20261026000100_f09_targeted_messages.sql` (recipient branch).
- Case: MESSAGE-01.read.recipient-sees-sender-side-metadata.API.

### W3-MSG-D6 (P2) Template edit by a user without write rights answers 409 "changed since you opened it"

- Repro: lead (no org-wide `scheduling.manage`) `PUT /message-templates/{sharedTemplateId}` with `expected_revision` equal to the current revision returns `409 template_stale`. Without `expected_revision` it correctly returns 404/403. The template is unchanged either way.
- Expected: permission error (403/404), not a stale-revision message that sends the editor into a refresh loop. Actual: misleading 409.
- Suspected source: `backend/src/services/messages.ts:175-195` (`updateTemplate` infers staleness from "row exists but update matched nothing").
- Case: MESSAGE-01.tpl.edit-shared.lead-with-current-revision.API.

### W3-MSG-D7 (P2) Archived message templates can still be selected when sending

- Repro: archive a template (`DELETE /message-templates/{id}` 204), then `POST /messages` with `template_id` of that template and a valid audience/hash: 201.
- Expected: 4xx (archived template not selectable) or documented behaviour; the list endpoint already hides archived templates. Actual: 201 and the message records the archived template id/revision.
- Suspected source: `supabase/migrations/20261026000100_f09_targeted_messages.sql:360-362` (`select * into v_template ... where t.id = ... and (owner_id is null or owner_id = v_actor)`, no `archived_at is null`).
- Case: MESSAGE-01.tpl.use-archived-template-in-send.API.

### W3-MSG-D8 (P2) Message history has no cursor; messages beyond `limit` (max 100) are unreachable

- Repro: `GET /messages?box=sent&limit=100` is the maximum; `before=...` is ignored (schema has only `plan_id`, `box`, `limit`).
- Expected: stable ordering with a way to page (plan row "pagination ordering"; order itself is correct: `created_at desc`). Actual: older sent/received messages cannot be listed past the 100 newest.
- Suspected source: `packages/shared/src/schemas/collaboration.ts:108-113`, `backend/src/services/messages.ts:82-105`.
- Case: MESSAGE-01.history.no-cursor-parameter.API.

### W3-MSG-D10 (P2) A reader can rewrite the content of their own notifications through PostgREST

- Repro: b1 `PATCH /rest/v1/notifications?id=eq.{own}` `{"title":"FORGED TITLE","body":"forged body"}` returns 200 with the row changed. The route comment says marking read is the only update a reader makes. Insert, re-assigning `user_id`, and updates to other users' rows are correctly denied.
- Expected: only `read_at` writable (column grant or trigger). Actual: all columns writable (`title`, `body`, `plan_id`, `conversation_id`, `operational_message_id`, `type`). Self-only impact; a client could forge its own deep-link targets (the target open is still access-checked). Table grants also give `anon`/`authenticated` TRUNCATE/TRIGGER/REFERENCES (default Supabase privileges; not reachable through PostgREST).
- Suspected source: `supabase/migrations/20260907000000_notifications.sql:71-73` (update policy without column restriction) plus default table grants.
- Case: NOTIFY-01.rls.update-own-content-columns.b1.

### Positive controls worth keeping (no defect)

Audience redaction for private/team/scheduled/leaders notes matched the oracle for 11 actors on both the API and the caller-JWT table read (including prepared assignee b3 excluded from `scheduled` notes, team-lead without `plans.edit` read-only, restricted bodies absent from `GET /plans/:id` and plan lists); idempotent send/post replays are exactly-once for notes-adjacent comments, messages and chat (sequential and 4-5 way concurrent) with one effect and one notification; a probe with a duplicate id by a non-participant answers 404, not 409; revoked membership mid-thread returns 403/404 immediately on every read and write path and creates no notifications or deliveries for the revoked person; a revoke racing 12 concurrent posts left zero rows after the revocation commit; deleting the target plan/item/team removes the conversation and its notifications.

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| Web UI for notes, item discussion, messages, chat, notification bell (all W steps) | NOT_RUN | Browser is owned by QA-09 for this wave |
| Mobile screens MOB-016, MOB-018, MOB-019, MOB-020 | NOT_RUN | Native apps not run in this package |
| MESSAGE-02 device SMS/email handoff, cancel, no handler, oversized audience, no delivery claim | NOT_RUN | Requires physical iOS/Android composer. API side: no SMS channel exists (`delivery_channel` = in_app, push, email), so the server cannot claim device delivery (NOT_APPLICABLE row) |
| Email HTML escaping of subject/body/variables | BLOCKED | No mail sink; simulated transport stores no rendered HTML. Contract is documented in `packages/shared/src/lib/message-templates.ts` only |
| Queued push/in-app skipped for a recipient revoked after the post but before dispatch | NOT_RUN | Needs worker control (QA-07). DB gate `user_can_access_conversation` / `operational_message_recipient_current` verified to return false after revocation |
| `signups` message audience | NOT_RUN | No signup-opportunity fixture in this namespace (QA-05 owns opportunities); resolver read in source only |
| Draft isolation across org switch, composer draft persistence | NOT_RUN | Client-side state |
| Suspended-membership read/post | NOT_APPLICABLE | `guard_member_suspension` only allows suspension when a church is disabled (platform-admin package) |
| Real push delivery, provider-accepted vs delivered states | NOT_RUN | Simulated provider only; observed states: in_app delivered, push skipped (no device), email simulated |

## Fixtures left in place

- Orgs `qa-20261118-msg-a`, `qa-20261118-msg-b`; users `{owner,admin,legacy,scoped,lead,b1,b2,b3,outsider,revoked,child,ownerb,memb}.qa20261118.msg@example.test`; people Nora Nolog and Gus Guest (first name currently `Gus <i>G</i>` to test variable escaping).
- Alpha data: note categories, plan notes, item comments, operational messages (about 20, including replay/idempotency probes), message templates, conversations and messages, notifications, delivery effects/deliveries. Beta data: one service type, one team (created for cross-tenant probes), one seeded notification for b1.
- Outbox rows for these messages are already in terminal simulated/delivered/skipped states except deliveries the retry tests requeued and processed inline; QA-07 worker runs will find nothing pending from this package.
- Credentials: scratchpad `qa08/state.json` only (not reproduced here). Scripts and logs: the same directory.
