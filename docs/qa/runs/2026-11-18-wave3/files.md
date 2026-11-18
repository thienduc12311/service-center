# QA-10 Files, media, stage, rehearsal contracts — wave 3

- Package: QA-10, cases FILE-01, FILE-02, FILE-03, MEDIA-01, STAGE-01, REHEARSE-01 (plan §5.G)
- Commit: 5bedb99 (branch feature/qa-wave3 = main), no code, migration or config changes
- Date: 2026-11-18. Env: API http://localhost:4000, web :5173 (not used), local Supabase (Postgres, Auth, Storage). Node 26.13.1
- Namespace: orgs `qa-20261118-file-a` (ALPHA, America/Chicago) and `qa-20261118-file-b` (BETA, Asia/Ho_Chi_Minh); users `<alias>.qa20261118.file@example.test`
- Method: real API with each actor's own token; DB/RLS evidence through PostgREST with the caller JWT; Storage evidence directly against `/storage/v1` with the caller JWT or signed URLs; service role / SQL used only for setup (users, memberships, grants) and for fixture manipulation (marked upload_expires_at in the past, flipped membership status), plus read-only persisted-state assertions. Passwords and sample files stay in the scratchpad.
- Frozen contracts read: backend/src/routes/{files,rehearsal}.ts, services/{files,media,rehearsal,stage-layouts}.ts, migrations 20261030000000_f13_files.sql and 20261031000100_f14_rehearsal_media_stage.sql (file functions, Storage policies, media/stage tables), shared schemas files.ts/media.ts, lib/rehearsal.ts.

## Fixture shape (ALPHA)

| Alias | Access |
|---|---|
| owner-a / admin-a | owner / admin |
| legacy-a | scheduler, legacy mode (all capabilities) |
| scoped-a | scheduler, scoped: plans.edit + scheduling.manage on service type "FILE Sunday" only |
| librarian-a | member + organization songs.manage |
| media-a | member + organization media.manage (the plan's `media-editor`) |
| member-a | ordinary member (also prepared on P-PREPARED, released later in FILE-02) |
| pending-a | released pending Keys/Band on P-RELEASED (declined during FILE-02, left declined) |
| confirmed-a | released confirmed Drums/Band on P-RELEASED |
| prepared-a | prepared (hidden) Camera/Production on P-RELEASED |
| team-a | Band roster member (Keys), not scheduled; got and lost scheduling.manage (stage leader read test) |
| inactive-a | inactive membership |
| outsider | member of BETA only; beta-owner | BETA owner |

Data: service types Sunday and Midweek; teams Band (Keys, Drums) and Production (Camera); songs One (arrangements Main, Alt) and Two; plans P-RELEASED (D04 shape: rehearsal + 09:00 + 11:00, header, song, 2 items; 3 assignments), P-PREPARED (D05: prepared member-a), a Midweek-type plan (plan with no Sunday scope), extra plans; media bundles; files of every kind in every parent (D11: small/multipage PDF, PNG, WAV tone, text, link, document, zero-byte, 26214400 B, 26214401 B, corrupt bytes, unsupported zip). BETA mirrors: plan, song, media, team, file for cross-tenant substitution.

## Summary

Expanded case records: 1794. PASS 1776 / FAIL 5 / BLOCKED 0 / NOT_RUN 12 / NOT_APPLICABLE 1.

| Group | Records | PASS | FAIL | NOT_RUN | N/A |
|---|---|---|---|---|---|
| FILE-01 | 256 | 252 | 1 | 3 | 0 |
| FILE-02 | 911 | 909 | 0 | 2 | 0 |
| FILE-03 | 159 | 155 | 2 | 2 | 0 |
| MEDIA-01 | 167 | 164 | 1 | 2 | 0 |
| STAGE-01 | 134 | 131 | 1 | 1 | 1 |
| REHEARSE-01 | 167 | 165 | 0 | 2 | 0 |

Case IDs are `<group>.<variant>.<actor>.<surface>`. Because the matrix is large, PASS records that differ only by actor are folded into one family row below (actors listed, count in the last column); every FAIL, NOT_RUN and NOT_APPLICABLE record is its own row. The unfolded list is in `files-cases.tsv` next to this file.

## FILE-01 — PASS 252 / FAIL 1 / BLOCKED 0 / NOT_RUN 3 / NOT_APPLICABLE 0

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| FILE-01.up.plan.*.API | scoped-a, media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 4 |
| FILE-01.up.plan.*.DB+Storage | scoped-a, media-a, owner-a, admin-a | DB row + storage object | plan\|upload\|543\|ready\|1\|true ; 543\|application/pdf | plan\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 4 |
| FILE-01.up.plan.*.owner-column | scoped-a, media-a, owner-a, admin-a | DB | plan_id=parent | t | PASS | 4 |
| FILE-01.up.plan_item.*.API | legacy-a, media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 4 |
| FILE-01.up.plan_item.*.DB+Storage | legacy-a, media-a, owner-a, admin-a | DB row + storage object | plan_item\|upload\|543\|ready\|1\|true ; 543\|application/pdf | plan_item\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 4 |
| FILE-01.up.plan_item.*.owner-column | legacy-a, media-a, owner-a, admin-a | DB | plan_item_id=parent | t | PASS | 4 |
| FILE-01.up.song.*.API | librarian-a, media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 4 |
| FILE-01.up.song.*.DB+Storage | librarian-a, media-a, owner-a, admin-a | DB row + storage object | song\|upload\|543\|ready\|1\|true ; 543\|application/pdf | song\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 4 |
| FILE-01.up.song.*.owner-column | librarian-a, media-a, owner-a, admin-a | DB | song_id=parent | t | PASS | 4 |
| FILE-01.up.arrangement.*.API | librarian-a, media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 4 |
| FILE-01.up.arrangement.*.DB+Storage | librarian-a, media-a, owner-a, admin-a | DB row + storage object | arrangement\|upload\|543\|ready\|1\|true ; 543\|application/pdf | arrangement\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 4 |
| FILE-01.up.arrangement.*.owner-column | librarian-a, media-a, owner-a, admin-a | DB | arrangement_id=parent | t | PASS | 4 |
| FILE-01.up.service_type.*.API | scoped-a, media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 4 |
| FILE-01.up.service_type.*.DB+Storage | scoped-a, media-a, owner-a, admin-a | DB row + storage object | service_type\|upload\|543\|ready\|1\|true ; 543\|application/pdf | service_type\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 4 |
| FILE-01.up.service_type.*.owner-column | scoped-a, media-a, owner-a, admin-a | DB | service_type_id=parent | t | PASS | 4 |
| FILE-01.up.media.*.API | media-a, owner-a, admin-a | API intent->PUT->finalize | 201/200/ready | 201/200/ready | PASS | 3 |
| FILE-01.up.media.*.DB+Storage | media-a, owner-a, admin-a | DB row + storage object | media\|upload\|543\|ready\|1\|true ; 543\|application/pdf | media\|upload\|543\|ready\|1\|true ; 543\|application/pdf | PASS | 3 |
| FILE-01.up.media.*.owner-column | media-a, owner-a, admin-a | DB | media_id=parent | t | PASS | 3 |
| FILE-01.link.plan.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.plan.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.link.plan_item.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.plan_item.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.link.song.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.song.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.link.arrangement.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.arrangement.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.link.service_type.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.service_type.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.link.media.*.API | media-a | API POST /files/links | 201 | 201 | PASS | 1 |
| FILE-01.doc.media.*.API | media-a | API POST /files/documents | 201 | 201 | PASS | 1 |
| FILE-01.deny.plan.*.intent | member-a, pending-a, confirmed-a, prepared-a, team-a, ...(+2) | API intent | 403\|404 | 403 forbidden | PASS | 7 |
| FILE-01.deny.plan.*.link | member-a, pending-a, confirmed-a, prepared-a, team-a, ...(+1) | API link | 403\|404 | 403 forbidden | PASS | 6 |
| FILE-01.deny.plan_item.*.intent | member-a, librarian-a | API intent | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.plan_item.*.link | member-a, librarian-a | API link | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.song.*.intent | member-a, scoped-a, pending-a, confirmed-a | API intent | 403\|404 | 403 forbidden | PASS | 4 |
| FILE-01.deny.song.*.link | member-a, scoped-a, pending-a, confirmed-a | API link | 403\|404 | 403 forbidden | PASS | 4 |
| FILE-01.deny.arrangement.*.intent | member-a, scoped-a | API intent | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.arrangement.*.link | member-a, scoped-a | API link | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.service_type.*.intent | member-a, librarian-a | API intent | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.service_type.*.link | member-a, librarian-a | API link | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-01.deny.media.*.intent | member-a, librarian-a, scoped-a, pending-a | API intent | 403\|404 | 403 forbidden | PASS | 4 |
| FILE-01.deny.media.*.link | member-a, librarian-a, scoped-a, pending-a | API link | 403\|404 | 403 forbidden | PASS | 4 |
| FILE-01.deny.no-partial-write | member roles | DB | 0 rows titled x | 0 | PASS | 1 |
| FILE-01.deny.plan.*(Midweek).intent | scoped-a | API intent out-of-scope | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-01.deny.service_type.*(Midweek).intent | scoped-a | API intent out-of-scope | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-01.deny.plan.*.intent(A header) | inactive-a, outsider, beta-owner | API intent X-Org=A | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-01.deny.plan.*.intent(B header, A parent) | inactive-a, outsider, beta-owner | API intent cross-tenant parent | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-01.wrongparent.B-plan.*(A header) | owner-a | API B plan id under A | 404 | 404 not_found | PASS | 1 |
| FILE-01.wrongparent.B-media.* | owner-a | API B media under A | 404 | 404 not_found | PASS | 1 |
| FILE-01.wrongparent.random.* | owner-a | API random uuid | 404 | 404 not_found | PASS | 1 |
| FILE-01.wrongparent.badid.* | owner-a | API non-uuid | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.wrongparent.kind-mismatch.* | owner-a | API song id as plan | 404 | 404 not_found | PASS | 1 |
| FILE-01.wrongparent.item-of-other-plan.control | owner-a | API plan_item p2 (valid) | 201 | 201 | PASS | 1 |
| FILE-01.val.size-0 | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.size-neg | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.size-over(26214401) | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.size-max(26214400) | owner-a | API intent validation | 201 | 201 | PASS | 1 |
| FILE-01.val.size-float | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.size-string | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.mime-zip | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.mime-html | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.mime-empty | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.filename-empty | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.filename-whitespace | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.filename-201 | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.filename-200 | owner-a | API intent validation | 201 | 201 | PASS | 1 |
| FILE-01.val.filename-traversal | owner-a | API intent validation | 201\|400 | 201 | PASS | 1 |
| FILE-01.val.title-201 | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.title-200 | owner-a | API intent validation | 201 | 201 | PASS | 1 |
| FILE-01.val.idem-missing | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.idem-short | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.no-owner-no-file | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.file-without-revision | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.audience-teams-empty | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.audience-positions-empty | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.audience-bad | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.category-bad | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.team-from-other-org | owner-a | API intent validation | 400\|404\|422 | 404 not_found | PASS | 1 |
| FILE-01.val.position-from-other-org | owner-a | API intent validation | 400\|404\|422 | 404 not_found | PASS | 1 |
| FILE-01.val.team-valid | owner-a | API intent validation | 201 | 201 | PASS | 1 |
| FILE-01.val.team_ids-51 | owner-a | API intent validation | 400\|422 (API validation convention is 422) | 422 unprocessable | PASS | 1 |
| FILE-01.val.file_id-other-org | owner-a | API intent validation | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.intent | media-a | API intent | 201 | 201 | PASS | 1 |
| FILE-01.unfin.*.GET-file(before upload) | member-a | API GET /files/:id | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.writer.GET-file | media-a | API | 200 with pending_versions, current_version null | 200 cur=null pend=1 | PASS | 1 |
| FILE-01.unfin.finalize-without-PUT | media-a | API finalize | 200 outcome not_uploaded | 200 not_uploaded | PASS | 1 |
| FILE-01.unfin.writer.download-before-finalize | media-a | API download | 404\|409 | 404 not_found | PASS | 1 |
| FILE-01.unfin.member.download | member-a | API download | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.member.list-excludes | member-a | API list | unfinalized absent | ["small.pdf","F01 plan scoped-a","F01 plan media-a","F01 plan owner-a","F01 plan admin-a","F01 link plan","F01 doc plan"] | PASS | 1 |
| FILE-01.unfin.member.plan-files-excludes | member-a | API plan files | absent | 200 | PASS | 1 |
| FILE-01.unfin.PUT | media-a | Storage signed PUT | 200 | 200 | PASS | 1 |
| FILE-01.unfin.member.storage-GET-pending | member-a | Storage GET pending object | 400\|403\|404 | 400 | PASS | 1 |
| FILE-01.unfin.writer.storage-GET-pending | media-a | Storage GET pending (writer) | 200\|400\|403\|404 | 200 | PASS | 1 |
| FILE-01.unfin.writer.storage-GET-pending.info | media-a | Storage | info (pending object readable by writer?) | 200 | PASS | 1 |
| FILE-01.unfin.member.RLS-version | member-a | PostgREST attachment_versions | [] | [] | PASS | 1 |
| FILE-01.unfin.finalize.* | member-a | API finalize | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.finalize.other-writer(owner) | owner-a | API finalize by non-creator | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.finalize.wrong-file-id | media-a | API finalize version under other file | 404 | 404 not_found | PASS | 1 |
| FILE-01.unfin.finalize | media-a | API finalize | ready | 200 ready | PASS | 1 |
| FILE-01.unfin.finalize-replay | media-a | API finalize again | 200 ready replayed | 200 ready true | PASS | 1 |
| FILE-01.unfin.member.GET-after-finalize | member-a | API | 200 | 200 | PASS | 1 |
| FILE-01.idem.replay | media-a | API | 201 then 200 replayed same version | 201/200 true | PASS | 1 |
| FILE-01.idem.reuse-different-body | media-a | API | 409 | 409 idempotency_key_reused | PASS | 1 |
| FILE-01.idem.reuse-other-parent | media-a | API | 409 | 409 idempotency_key_reused | PASS | 1 |
| FILE-01.idem.single-row | media-a | DB | 1 attachment | 1 | PASS | 1 |
| FILE-01.abandon.* | member-a | API abandon | 404 | 404 not_found | PASS | 1 |
| FILE-01.abandon.wrong-version | media-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-01.abandon | media-a | API abandon | 200 file_removed true | 200 {"file_removed":true} | PASS | 1 |
| FILE-01.abandon.row-gone | media-a | DB | 0 | 0 | PASS | 1 |
| FILE-01.abandon.PUT-after-abandon | media-a | Storage signed PUT on abandoned intent | rejected | 200 {"Key":"attachments/2434e578-7e8e-4b07-bc16-0ebb36cc334f/9639bb26-a40c-481a-bcc8 | FAIL W3-FILE-D1 | 1 |
| FILE-01.abandon.finalize-after | media-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-01.abandon.after-ready | media-a | API abandon on ready version | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-01.fail.size_mismatch | media-a | API finalize declared!=actual | outcome failed reason size_mismatch | 200 failed size_mismatch | PASS | 1 |
| FILE-01.fail.size_mismatch.persisted | media-a | DB version + removal queue | failed\|size_mismatch + queued | failed\|size_mismatch / failed | PASS | 1 |
| FILE-01.fail.size_mismatch.member-GET | member-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-01.fail.size_mismatch.writer-download | media-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-01.fail.type_mismatch | media-a | API finalize declared image/png, PUT content-type application/pdf | failed type_mismatch | 200 failed type_mismatch | PASS | 1 |
| FILE-01.fail.bucket-mime-reject | media-a | Storage signed PUT text/html | rejected 4xx | 400 {"statusCode":"415","error":"invalid_mime_type","message":"mime type text/html is not supp | PASS | 1 |
| FILE-01.fail.bucket-mime-reject.finalize | media-a | API finalize after rejected PUT | not_uploaded | not_uploaded | PASS | 1 |
| FILE-01.limit.bucket-rejects-25MiB+1 | media-a | Storage signed PUT 26214401 bytes | rejected (413) | 400 {"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum | PASS | 1 |
| FILE-01.limit.exact.intent | media-a | API intent | 201 | 201 | PASS | 1 |
| FILE-01.limit.exact.PUT | media-a | Storage PUT 26214400 bytes | 200 | 200 {"Key":"attachments/2434e578-7e8e-4b07-bc16-0ebb36cc334f/229ba52b-8731-43c9-b047 | PASS | 1 |
| FILE-01.limit.exact.finalize | media-a | API finalize | ready | ready null | PASS | 1 |
| FILE-01.limit.exact.download-bytes | member-a | signed URL bytes | 26214400 bytes identical | 200 26214400 | PASS | 1 |
| FILE-01.corrupt.pdf-bytes | media-a | API upload random bytes as application/pdf | accepted (server validates type/size only, not content) - record behaviour | ready | PASS | 1 |
| FILE-01.storage.direct-POST.*(not creator) | member-a | Storage POST caller JWT | 400\|403 | 400 | PASS | 1 |
| FILE-01.storage.direct-POST.*(anon key) | anonymous | Storage POST anon | 400\|401\|403 | 400 | PASS | 1 |
| FILE-01.storage.direct-POST.owner(not creator) | owner-a | Storage POST caller JWT non-creator | 400\|403 | 400 | PASS | 1 |
| FILE-01.storage.direct-POST.arbitrary-path | media-a | Storage POST path with no intent | 400\|403 | 400 | PASS | 1 |
| FILE-01.storage.direct-POST.other-org-prefix | media-a | Storage POST other-org prefix | 400\|403 | 400 | PASS | 1 |
| FILE-01.storage.direct-POST.creator-own-intent | media-a | Storage POST caller JWT, own pending intent | 200 | 200 | PASS | 1 |
| FILE-01.storage.direct-POST.creator-second-write | media-a | Storage POST again (overwrite w/o upsert) | 400\|409\|403 | 400 | PASS | 1 |
| FILE-01.storage.upsert-overwrite-pending | media-a | Storage POST x-upsert on own pending object | info: overwrite of pending object | 400 {"statusCode":"403","error":"Unauthorized","message":"new ro | PASS | 1 |
| FILE-01.storage.finalize-after-upsert | media-a | API finalize | ready or failed size_mismatch (consistent) | ready null | PASS | 1 |
| FILE-01.storage.overwrite-after-ready.creator-JWT | media-a | Storage POST x-upsert over ready object | 400\|403\|409 | 400 | PASS | 1 |
| FILE-01.storage.overwrite-after-ready.reuse-signed-token | media-a | Storage signed PUT reuse after finalize | rejected (object exists, no upsert) | 400 {"statusCode":"409","error":"Duplicate","message":"The resource already exists", | PASS | 1 |
| FILE-01.storage.overwrite-after-ready.signed-token+upsert | media-a | Storage signed PUT x-upsert:true after finalize | rejected (ready object must be immutable) | 400 {"statusCode":"409","error":"Duplicate","message":"The resource already exists", | PASS | 1 |
| FILE-01.storage.ready-object-size-unchanged | media-a | DB storage.objects | 543 | 543 | PASS | 1 |
| FILE-01.expiry.direct-POST-after-expiry | media-a | Storage POST caller JWT after expiry | 400\|403 | 400 | PASS | 1 |
| FILE-01.expiry.finalize | media-a | API finalize after expiry | expired | expired expired | PASS | 1 |
| FILE-01.expiry.persisted | media-a | DB | expired | expired | PASS | 1 |
| FILE-01.expiry.file-after | media-a | API GET after expiry | info | 200 1 | PASS | 1 |
| FILE-01.expiry.signed-PUT-after-DB-expiry | media-a | Storage signed PUT after DB expiry (token still valid) | info (token JWT governs; DB expiry only enforced at finalize/policy) | 200 | PASS | 1 |
| FILE-01.expiry.finalize-after-late-PUT | media-a | API finalize | expired (bytes ignored) | expired | PASS | 1 |
| FILE-01.revoked.finalize-inactive-member | legacy-a | API finalize after membership inactive | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-01.revoked.finalize-after-restore | legacy-a | API finalize after restore | ready | ready | PASS | 1 |
| FILE-01.revoked.finalize-after-songs.manage-revoked | librarian-a | API finalize after capability revoked | 403\|404 | 404 not_found | PASS | 1 |
| FILE-01.cap.20-pending-intents | owner-a | API intent #21 | 422/400-ish refusal after 20 pending (pending before: 6) | created=14 last=400 {"error":"Finish or cancel your other uploads first","code":"bad_request"} | PASS | 1 |
| FILE-01.rpc.service-only.expire_file_uploads.* | owner-a, anonymous | PostgREST rpc expire_file_uploads | denied (service_role only) | 403 | PASS | 2 |
| FILE-01.rpc.service-only.claim_file_object_removals.* | owner-a, anonymous | PostgREST rpc claim_file_object_removals | denied (service_role only) | 403 | PASS | 2 |
| FILE-01.rpc.direct-intent.* | member-a | PostgREST rpc create_file_upload_intent | denied | 403 {"code":"42501","details":null,"hint":null,"message":"You ca | PASS | 1 |
| FILE-01.rpc.direct-intent.cross-org-parent | media-a | rpc with B plan id (bypassing API org check) | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"That p | PASS | 1 |
| FILE-01.rpc.direct-intent.cross-org-team-target | media-a | rpc with B team id as audience target | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Team n | PASS | 1 |
| FILE-01.rpc.direct-finalize.* | member-a | rpc finalize on ready version of other | denied | 500 {"code":"P0002","details":null,"hint":null,"message":"Upload | PASS | 1 |
| FILE-01.rpc.can_add_file.* | member-a, media-a | rpc | false | false | PASS | 2 |
| FILE-01.rpc.can_add_file.cross-org | media-a | rpc B plan | false | false | PASS | 1 |
| FILE-01.type.note.txt | media-a | API upload text/plain | ready | ready | PASS | 1 |
| FILE-01.type.note.txt.roundtrip-bytes | member-a | download bytes identical | identical | true | PASS | 1 |
| FILE-01.type.img.png | media-a | API upload image/png | ready | ready | PASS | 1 |
| FILE-01.type.img.png.roundtrip-bytes | member-a | download bytes identical | identical | true | PASS | 1 |
| FILE-01.type.tone.wav | media-a | API upload audio/wav | ready | ready | PASS | 1 |
| FILE-01.type.tone.wav.roundtrip-bytes | member-a | download bytes identical | identical | true | PASS | 1 |
| FILE-01.type.multi.pdf | media-a | API upload application/pdf | ready | ready | PASS | 1 |
| FILE-01.type.multi.pdf.roundtrip-bytes | member-a | download bytes identical | identical | true | PASS | 1 |
| FILE-01.zero-byte.actual-PUT | media-a | Storage PUT 0 bytes declared 543 then finalize | not ready (failed size_mismatch or not_uploaded) | PUT 200 -> failed size_mismatch | PASS | 1 |
| FILE-01.zero-byte.declared | media-a | API size 0 | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-01.ui.web-progress-cancel-retry | owner/media-editor | Web UI | progress, cancel, retry, drag-drop upload | Web UI owned by QA-09 (browser not available to this package) | NOT_RUN | 1 |
| FILE-01.ui.native-picker-camera | media-editor | Mobile/Desktop UI | file picker upload, progress, retry | Native client (QA-13/14, physical device/simulator not in scope) | NOT_RUN | 1 |
| FILE-01.cleanup.sweeper | service | Worker/DB | expire_file_uploads + removal queue sweep of unfinalized/failed uploads | Delivery/maintenance worker is off-limits for this package; queue rows (attachment_object_removals) were verified to be enqueued at failure/expiry/delete time, and another run swept them during the session (observed, not driven by this agent) | NOT_RUN | 1 |

## FILE-02 — PASS 909 / FAIL 0 / BLOCKED 0 / NOT_RUN 2 / NOT_APPLICABLE 0

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| FILE-02.p1-org.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-org.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-org.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-org.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-org.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+6) | GET signed url | 200 bytes==543 | 200 543 | PASS | 11 |
| FILE-02.p1-sched.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-sched.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-sched.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-sched.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-sched.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+2) | GET signed url | 200 bytes==543 | 200 543 | PASS | 7 |
| FILE-02.p1-teamBand.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-teamBand.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-teamBand.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-teamBand.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-teamBand.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+3) | GET signed url | 200 bytes==543 | 200 543 | PASS | 8 |
| FILE-02.p1-teamProd.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-teamProd.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-teamProd.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-teamProd.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-teamProd.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a | GET signed url | 200 bytes==543 | 200 543 | PASS | 5 |
| FILE-02.p1-posKeys.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-posKeys.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-posKeys.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-posKeys.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-posKeys.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+2) | GET signed url | 200 bytes==543 | 200 543 | PASS | 7 |
| FILE-02.p1-leaders.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p1-leaders.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p1-leaders.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p1-leaders.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p1-leaders.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a | GET signed url | 200 bytes==543 | 200 543 | PASS | 5 |
| FILE-02.song-org.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.song-org.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.song-org.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.song-org.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.song-org.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+6) | GET signed url | 200 bytes==543 | 200 543 | PASS | 11 |
| FILE-02.song-leaders.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.song-leaders.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.song-leaders.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.song-leaders.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.song-leaders.*.signed-URL-bytes | owner-a, admin-a, legacy-a, librarian-a, media-a | GET signed url | 200 bytes==543 | 200 543 | PASS | 5 |
| FILE-02.media-org.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.media-org.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.media-org.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.media-org.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.media-org.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+6) | GET signed url | 200 bytes==543 | 200 543 | PASS | 11 |
| FILE-02.svc-org.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.svc-org.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.svc-org.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.svc-org.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.svc-org.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+6) | GET signed url | 200 bytes==543 | 200 543 | PASS | 11 |
| FILE-02.item-sched.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.item-sched.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.item-sched.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.item-sched.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.item-sched.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+2) | GET signed url | 200 bytes==543 | 200 543 | PASS | 7 |
| FILE-02.p2-sched.*.API-detail | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API GET /files/:id | 200 | 200 | PASS | 15 |
| FILE-02.p2-sched.*.API-download | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | API POST /files/:id/download | 200 | 200 | PASS | 15 |
| FILE-02.p2-sched.*.Storage-GET | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | Storage /object/authenticated caller JWT | 200 | 200 %PDF-1.4 1 0 obj << /Type /Catalog /Page | PASS | 15 |
| FILE-02.p2-sched.*.RLS-row | owner-a, admin-a, legacy-a, scoped-a, librarian-a, ...(+10) | PostgREST attachments caller JWT | 1 row | 1 | PASS | 15 |
| FILE-02.p2-sched.*.signed-URL-bytes | owner-a, admin-a, legacy-a, scoped-a, media-a | GET signed url | 200 bytes==543 | 200 543 | PASS | 5 |
| FILE-02.list.p1.* | member-a, pending-a, confirmed-a, team-a, prepared-a, ...(+3) | API GET /files?owner=plan | F02 p1-org | F02 p1-org | PASS | 8 |
| FILE-02.planfiles.* | member-a, pending-a, confirmed-a, team-a, prepared-a, ...(+2) | API GET /plans/:id/files | info list | F02 p1-org,F02 song-org | PASS | 7 |
| FILE-02.list.p1.*(B header) | beta-owner | API list A plan under B | 404 | 404 not_found | PASS | 1 |
| FILE-02.release.p2-sched.*(prepared).before | member-a | API detail prepared assignee | 404 | 404 not_found | PASS | 1 |
| FILE-02.release.p2-sched.*(prepared).download-before | member-a | API download | 404 | 404 not_found | PASS | 1 |
| FILE-02.release.fixture | owner-a | API plan | member-a prepared assignment present | 62632b7d-ba4d-430b-b024-2bbcc6d3e5fb | PASS | 1 |
| FILE-02.release.*.schedule-before | member-a | API /schedule/mine | p2 not listed | absent | PASS | 1 |
| FILE-02.release.owner.release | owner-a | API release | 200 | 200 | PASS | 1 |
| FILE-02.release.p2-sched.*.after-release | member-a | API detail after release | 200 | 200 | PASS | 1 |
| FILE-02.release.p2-sched.*.download-after | member-a | API download | 200 | 200 | PASS | 1 |
| FILE-02.release.p1-teamProd.*(prepared) | prepared-a | API detail | 404 | 404 not_found | PASS | 1 |
| FILE-02.declined.before | pending-a | API | 200 | 200 | PASS | 1 |
| FILE-02.declined.respond | pending-a | API respond decline | 200 | 200 | PASS | 1 |
| FILE-02.declined.after.scheduled-file | pending-a | API detail after decline | 404 | 404 not_found | PASS | 1 |
| FILE-02.declined.after.position-file | pending-a | API detail after decline | 404 | 404 not_found | PASS | 1 |
| FILE-02.declined.after.org-file | pending-a | API detail (org audience) | 200 | 200 | PASS | 1 |
| FILE-02.declined.restore | pending-a | API respond back | info | 422 | PASS | 1 |
| FILE-02.audio.upload | media-a | API upload wav | ready | ready | PASS | 1 |
| FILE-02.rights.download-default.attachment.member | member-a | API attachment (rights=download) | 200 | 200 | PASS | 1 |
| FILE-02.rights.set.* | member-a, media-a | API set stream_only | 403\|404 | 403 forbidden | PASS | 2 |
| FILE-02.rights.set.librarian | librarian-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-02.rights.set.stale | media-a | API stale revision | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-02.rights.set.bad-enum | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-02.rights.persisted | media-a | DB | stream_only\|3 | stream_only\|3 | PASS | 1 |
| FILE-02.rights.stream_only.attachment.member | member-a | API attachment stream_only | 403 | 403 file_stream_only | PASS | 1 |
| FILE-02.rights.stream_only.inline.member | member-a | API inline stream_only | 200 | 200 | PASS | 1 |
| FILE-02.rights.stream_only.attachment.writer(*) | media-a, owner-a, scoped-a | API attachment (writer) | 200 | 200 | PASS | 3 |
| FILE-02.rights.disposition-bad | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-02.rights.stream_only.raw-bytes.info | member-a | signed URL GET | info: stream_only is advisory (bytes retrievable inline; documented as not DRM) | 200 | PASS | 1 |
| FILE-02.rights.stream_only.storage-direct-download | member-a | Storage GET authed (bypasses API rights) | info: raw Storage read returns bytes regardless of playback_rights (documented not DRM) | 200 | PASS | 1 |
| FILE-02.link.download.member | member-a | API link download | kind external url | 200 external | PASS | 1 |
| FILE-02.doc.download.member | member-a | API doc via download | 400 | 400 bad_request | PASS | 1 |
| FILE-02.doc.get.member | member-a | API GET document | 200 | 200 | PASS | 1 |
| FILE-02.doc.get.*(B header) | beta-owner | API | 404 | 404 not_found | PASS | 1 |
| FILE-02.doc.get.* | anonymous | API | 401 | 401 unauthorized | PASS | 1 |
| FILE-02.wrongid.version-of-other-file(leaders) | member-a | API download version id of another file | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.random-version | member-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.bad-version-uuid | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-02.wrongid.bad-file-uuid | member-a | API GET | 400 | 400 bad_request | PASS | 1 |
| FILE-02.wrongid.random-file | member-a | API GET | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.B-file-under-A | member-a | API GET B file under A org | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.A-file-under-B-header | beta-owner | API GET A file with B org header | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.A-owner.B-file | owner-a | API GET | 404 | 404 not_found | PASS | 1 |
| FILE-02.wrongid.A-owner.B-header | owner-a | API with org B header (not member) | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-02.storage.cross-tenant-object.* | owner-a | Storage GET B object with A owner JWT | 400\|403\|404 | 400 | PASS | 1 |
| FILE-02.storage.cross-tenant-object.*(B member) | outsider | Storage GET B object (org-audience file) as B member | 200 | 200 | PASS | 1 |
| FILE-02.expiry.signed-URL.valid-before | member-a | Storage signed GET (2s TTL) | 200 | 200 | PASS | 1 |
| FILE-02.expiry.signed-URL.expired | member-a | Storage signed GET after TTL | 400/401 expired | 400 {"statusCode":"400","error":"InvalidJWT","message":"\"exp\" claim time | PASS | 1 |
| FILE-02.storage.sign-denied.leaders-file.* | pending-a | Storage /object/sign caller JWT | denied | 400 {"statusCode":"404","error":"not_found","message":"Object no | PASS | 1 |
| FILE-02.expiry.api-download-ttl | member-a | API download TTL claim | <=300s | 300s expires_at=2026-11-18T17:25:04.268Z | PASS | 1 |
| FILE-02.renew.*.issue | team-a, member-a | API download | 200 | 200 | PASS | 2 |
| FILE-02.renew.audience-change.owner | owner-a | API PATCH audience->leaders | 200 | 200 | PASS | 1 |
| FILE-02.renew.*.new-url-refused | team-a | API download after audience tightened | 404 | 404 not_found | PASS | 1 |
| FILE-02.renew.*.old-url-until-expiry | team-a | issued signed URL after revocation | 200 until TTL (documented) | 200 | PASS | 1 |
| FILE-02.renew.*.storage-direct-refused | team-a | Storage authed GET after audience tightened | denied | 400 | PASS | 1 |
| FILE-02.renew.*.inactive.api | member-a | API download after membership inactive | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-02.renew.*.inactive.storage | member-a | Storage GET after inactive | denied | 400 | PASS | 1 |
| FILE-02.renew.*.inactive.RLS | member-a | PostgREST | 0 rows | 0 | PASS | 1 |
| FILE-02.renew.*.inactive.old-url | member-a | issued URL after removal | 200 until TTL (documented) | 200 | PASS | 1 |
| FILE-02.renew.*.restored | member-a | API download after restore | 200 | 200 | PASS | 1 |
| FILE-02.rls.direct-update.* | owner-a, media-a | PostgREST PATCH attachments | denied (no table write grant) | 403 | PASS | 2 |
| FILE-02.rls.direct-delete.* | owner-a, media-a | PostgREST DELETE attachments | denied | 403 | PASS | 2 |
| FILE-02.rls.direct-insert.* | owner-a, media-a | PostgREST POST attachments | denied | 403 | PASS | 2 |
| FILE-02.rls.direct-update-version.* | owner-a, media-a | PostgREST PATCH attachment_versions | denied | 403 | PASS | 2 |
| FILE-02.rls.removal-queue-hidden.* | owner-a, media-a | PostgREST GET attachment_object_removals | denied | 403 | PASS | 2 |
| FILE-02.rpc.writable_file_ids.* | member-a, media-a | rpc writable_file_ids | [] (no writable) | [] | PASS | 2 |
| FILE-02.storage.list.* | member-a, outsider, beta-owner | Storage list prefix A org | folders only | 200 n=66 | PASS | 3 |
| FILE-02.storage.public-url | anonymous | Storage /object/public | denied (bucket private) | 400 | PASS | 1 |
| FILE-02.storage.anon-key-authenticated | anonymous | Storage authenticated route with anon key | denied | 400 | PASS | 1 |
| FILE-02.storage.bucket-private | member-a | Storage bucket config | public=false, 25MiB limit, mime allowlist | DB: public=f, file_size_limit=26214400, 25 allowed mime types (Storage API does not expose bucket config to non-service roles) | PASS | 1 |
| FILE-02.copy.duplicate-plan-files | owner-a | API duplicate plan then list files | info: plan-owned files copied or not (behaviour record) | dup 201 own-files=0 total entries=29 | PASS | 1 |
| FILE-02.ui.web-preview-download-export | member/outsider | Web UI | preview/download/export UI honours audience | Web UI owned by QA-09 (browser not available to this package) | NOT_RUN | 1 |
| FILE-02.ui.native | member | Mobile UI | file list/preview/share honours audience | Native client (QA-13/14, physical device/simulator not in scope) | NOT_RUN | 1 |

## FILE-03 — PASS 155 / FAIL 2 / BLOCKED 0 / NOT_RUN 2 / NOT_APPLICABLE 0

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| FILE-03.link.pin-current.* | scoped-a | API link_file_to_plan pin | 201 | 201 | PASS | 1 |
| FILE-03.link.follow.* | scoped-a | API link follow | 201 | 201 | PASS | 1 |
| FILE-03.replace.v1-to-v2 | media-a | API intent(file_id)->PUT->finalize | ready, version 2 current | 201 ready v2 | PASS | 1 |
| FILE-03.replace.persisted | media-a | DB versions + current | 1:ready,2:ready ; true\|854\|v2.pdf | 1:ready,2:ready ; true\|854\|v2.pdf | PASS | 1 |
| FILE-03.replace.both-objects-retained | media-a | Storage objects | 2 | 2 | PASS | 1 |
| FILE-03.read.member.detail-versions | member-a | API detail | current v2; versions list includes pinned v1 or only ready | cur=2 versions=2,1 | PASS | 1 |
| FILE-03.read.member.download-v1-pinned | member-a | API download v1 (pinned by plan link) | 200 | 200 | PASS | 1 |
| FILE-03.read.member.download-current-is-v2 | member-a | API download default | v2 (854 bytes) | 200 v2 | PASS | 1 |
| FILE-03.read.member.bytes-v2 | member-a | signed URL bytes | v2 bytes | 854 | PASS | 1 |
| FILE-03.read.member.bytes-v1-pinned | member-a | signed URL bytes | v1 bytes | 543 | PASS | 1 |
| FILE-03.pin.plan-files-shows-v1 | scoped-a | API plan files | pinned v1, newer_version_available | v1 newer=true | PASS | 1 |
| FILE-03.pin.plan-files-member-sees-v1 | member-a | API plan files | pinned v1 | v1 | PASS | 1 |
| FILE-03.follow.plan-files-shows-v2 | scoped-a | API plan files follow link | v2 current | v2 | PASS | 1 |
| FILE-03.pin.set-follow | scoped-a | API set_file_link_pin follow | 200 | 200 | PASS | 1 |
| FILE-03.pin.v1-unreadable-after-follow.member | member-a | API download v1 after unpin | 404 | 404 not_found | PASS | 1 |
| FILE-03.pin.v1-storage-denied.member | member-a | Storage GET v1 after unpin | denied | 400 | PASS | 1 |
| FILE-03.pin.v1-writer-can-read | media-a | API download v1 (writer) | 200 | 200 | PASS | 1 |
| FILE-03.pin.set-version-v1 | scoped-a | API pin explicit v1 | 200 | 200 | PASS | 1 |
| FILE-03.pin.v1-readable-again | member-a | API | 200 | 200 | PASS | 1 |
| FILE-03.pin.version-mode-without-id | scoped-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| FILE-03.pin.random-version | scoped-a | API | 400\|404\|409\|422 | 404 not_found | PASS | 1 |
| FILE-03.pin.version-of-another-file | scoped-a | API pin other file version | 400\|404\|409\|422 | 404 not_found | PASS | 1 |
| FILE-03.pin.deny.* | member-a, librarian-a, pending-a | API set pin | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-03.unlink.deny.* | member-a, librarian-a, pending-a | API unlink | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-03.link.deny.* | member-a, librarian-a, pending-a | API link | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-03.link.*.out-of-scope-plan(Midweek) | scoped-a | API link on Midweek plan | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-03.link.cross-org-file | owner-a | API link B file to A plan | 404 | 404 not_found | PASS | 1 |
| FILE-03.link.cross-org-item | owner-a | API link with B item id | 400\|404\|409\|422 | 404 not_found | PASS | 1 |
| FILE-03.link.item-of-other-plan | owner-a | API link with item of plan2 | 400\|404\|409\|422 | 404 not_found | PASS | 1 |
| FILE-03.link.duplicate | owner-a | API duplicate link same file+item | info (idempotent 201/200 or conflict) | 201  | PASS | 1 |
| FILE-03.race.both-intents-created | media-a+owner-a | API two intents same expected_revision | both 201 (intent does not bump revision; conflict decided at finalize) | 201/201 | PASS | 1 |
| FILE-03.race.concurrent-finalize | media-a+owner-a | API concurrent finalize v2 vs v2 | exactly one ready, other failed superseded | failed:superseded / ready: | PASS | 1 |
| FILE-03.race.persisted | DB | DB versions | 2 ready versions (v1,v2), max 2, no duplicate numbers | 2\|2\|2 | PASS | 1 |
| FILE-03.race.loser-object-queued | DB | removal queue | 1 queued | 1 | PASS | 1 |
| FILE-03.race.same-version-4x-finalize | media-a | API 4 concurrent finalize same version | all 200 ready, exactly one non-replayed | 200readytrue,200readyfalse,200readytrue,200readytrue | PASS | 1 |
| FILE-03.race.same-version.single-ready | DB | DB | 1 ready version | 1 | PASS | 1 |
| FILE-03.replace.stale-revision | media-a | API intent stale revision | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.replace.deny.* | member-a | API replace | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-03.replace.deny.librarian(plan-owned file) | librarian-a | API replace | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-03.replace.link-kind-refused | media-a | API upload over link file | 400\|422\|409 | 400 bad_request | PASS | 1 |
| FILE-03.replace.cross-org-file | owner-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.meta.edit.* | media-a | API PATCH title/category/audience | 200 rev+1 | 200 rev=4 teams chart | PASS | 1 |
| FILE-03.meta.edit.persisted | media-a | DB | F03 renamed\|chart\|teams\|4\|1 | F03 renamed\|chart\|teams\|4\|1 | PASS | 1 |
| FILE-03.meta.edit.stale | media-a | API PATCH stale | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.meta.edit.empty-title | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.meta.edit.title-201 | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.meta.edit.team-from-other-org | media-a | API | 400\|404\|409\|422 | 404 not_found | PASS | 1 |
| FILE-03.meta.edit.positions | media-a | API audience positions | 200 | 200 | PASS | 1 |
| FILE-03.meta.edit.targets-replaced | media-a | DB targets | 0 team \| 1 position | 0\|1 | PASS | 1 |
| FILE-03.meta.edit.deny.* | member-a, scoped-a, pending-a, beta-owner, anonymous | API PATCH | 403\|404 | 404 not_found | PASS | 5 |
| FILE-03.meta.move.plan->item | media-a | API move within same plan | 200 owner plan_item | 200 plan_item | PASS | 1 |
| FILE-03.meta.move.to-other-plan | media-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| FILE-03.meta.move.plan->song | media-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| FILE-03.meta.move.to-B-item | media-a | API | 400\|404\|422 | 404 not_found | PASS | 1 |
| FILE-03.meta.move.to-item-of-other-plan | media-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| FILE-03.meta.move.song->arrangement | librarian-a | API | 200 | 200 arrangement | PASS | 1 |
| FILE-03.link.create | media-a | API | 201 | 201 | PASS | 1 |
| FILE-03.link.edit-url | media-a | API PUT /link | 200 url b rev+1 | 200 https://example.test/b rev 2 | PASS | 1 |
| FILE-03.link.edit-url.persisted | media-a | DB | https://example.test/b\|F03 link2\|2 | https://example.test/b\|F03 link2\|2 | PASS | 1 |
| FILE-03.link.edit-url.stale | media-a | API stale | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.link.edit-url.reject-javascript | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-javascript | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-ftp | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-ftp | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-creds | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-creds | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-no-scheme | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-no-scheme | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-data | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-data | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-too-long | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-too-long | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-empty | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-empty | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.reject-file | media-a | API URL validation | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.create.reject-file | media-a | API URL validation (create) | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.link.edit-url.http-with-port | media-a | API | 200 | 200 | PASS | 1 |
| FILE-03.link.edit-url.deny.* | member-a, librarian-a, pending-a | API | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-03.link.edit-url.on-upload-file | media-a | API PUT /link on upload kind | 400\|422\|409 | 400 bad_request | PASS | 1 |
| FILE-03.link.create.idempotent | media-a | API same key twice | same file id | 201/201 true | PASS | 1 |
| FILE-03.link.create.key-reuse-different | media-a | API | 409 | 201 | FAIL W3-FILE-D2 | 1 |
| FILE-03.doc.create | media-a | API | 201 | 201 | PASS | 1 |
| FILE-03.doc.read.member | member-a | API GET document | v1 body | v1 body | PASS | 1 |
| FILE-03.doc.save-v2 | media-a | API PUT document | 200 v2, rev+1 | 200 rev=2 ver=2 | PASS | 1 |
| FILE-03.doc.versions.persisted | media-a | DB | 1:ready:7,2:ready:7 | 1:ready:7,2:ready:7 | PASS | 1 |
| FILE-03.doc.read.member.current | member-a | API | v2 body | v2 body | PASS | 1 |
| FILE-03.doc.read.member.old-version-unpinned | member-a | API GET old version | 404 | 404 not_found | PASS | 1 |
| FILE-03.doc.read.writer.old-version | media-a | API | v1 body | v1 body | PASS | 1 |
| FILE-03.doc.read.random-version | media-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.doc.read.bad-version-uuid | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.doc.read.version-of-another-doc | media-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.doc.save.stale | media-a | API stale revision | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.doc.save.100000-chars | media-a | API boundary | 200 | 200 | PASS | 1 |
| FILE-03.doc.save.100001-chars | media-a | API over limit | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.doc.save.empty-body | media-a | API empty body | info | 200 | PASS | 1 |
| FILE-03.doc.save.empty-title | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.doc.save.unicode+NUL | media-a | API body with NUL | info (400 expected for NUL; Postgres cannot store \u0000) | 500 22P05 | FAIL W3-FILE-D3 | 1 |
| FILE-03.doc.unicode-roundtrip | media-a | API | identical | Nguyễn Thị Ánh – 🎵 | PASS | 1 |
| FILE-03.race.doc-save | media-a+owner-a | API concurrent doc saves same revision | one 200 one 409 | 200/409 | PASS | 1 |
| FILE-03.race.doc-save.persisted | DB | DB | no duplicate version numbers; current = winner | 6\|6 race A | PASS | 1 |
| FILE-03.doc.save.deny.* | member-a, librarian-a, pending-a | API | 403\|404 | 403 forbidden | PASS | 3 |
| FILE-03.doc.get-on-upload-file | media-a | API GET document on upload | 400 | 400 bad_request | PASS | 1 |
| FILE-03.doc.save-on-upload-file | media-a | API PUT document on upload | 400\|422\|409 | 400 bad_request | PASS | 1 |
| FILE-03.archive.deny.member | member-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-03.archive.stale | media-a | API | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.archive.ok | media-a | API | 200 archived_at set | 200 2026-11-18T17:22:27.266175+00:00 | PASS | 1 |
| FILE-03.archive.member-detail | member-a | API (archived) | 404 | 404 not_found | PASS | 1 |
| FILE-03.archive.member-download | member-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.archive.member-storage | member-a | Storage | denied | 400 | PASS | 1 |
| FILE-03.archive.writer-detail | media-a | API writer sees archived | 200 | 200 | PASS | 1 |
| FILE-03.archive.writer-download | media-a | API | 200 | 200 | PASS | 1 |
| FILE-03.archive.member-list-excludes | member-a | API list | absent | true | PASS | 1 |
| FILE-03.archive.replace-while-archived | media-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| FILE-03.archive.restore | media-a | API | archived_at null | 200 null | PASS | 1 |
| FILE-03.archive.restore.member-detail | member-a | API | 200 | 200 | PASS | 1 |
| FILE-03.archive.pinned.link | scoped-a | API | 201 | 201 | PASS | 1 |
| FILE-03.archive.pinned.archive | librarian-a | API | 200 | 200 | PASS | 1 |
| FILE-03.archive.pinned.member-download-default | member-a | API download default version of archived+pinned file | 200 (pinned) or 404 (documented) | 200 | PASS | 1 |
| FILE-03.archive.pinned.plan-files-member | member-a | API plan files | entry present via pin | true | PASS | 1 |
| FILE-03.archive.link-new-to-archived | scoped-a | API link archived file | 400\|404\|422 | 400 bad_request | PASS | 1 |
| FILE-03.delete.deny.member | member-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| FILE-03.delete.stale | media-a | API | 409 | 409 file_revision_stale | PASS | 1 |
| FILE-03.delete.no-body | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| FILE-03.delete.ok | media-a | API | 204 | 204 | PASS | 1 |
| FILE-03.delete.persisted | media-a | DB rows + removal queue | 0\|0\|1 | 0\|0\|1 | PASS | 1 |
| FILE-03.delete.retry-after-delete | media-a | API retry | 404 | 404 not_found | PASS | 1 |
| FILE-03.delete.linked-library-file | librarian-a | API delete file linked to a plan | info | 409 | PASS | 1 |
| FILE-03.delete.linked.links-cleaned | DB | DB | 0 links left | 1 | PASS | 1 |
| FILE-03.unlink.ok | scoped-a | API | 204 | 204 | PASS | 1 |
| FILE-03.unlink.retry | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.unlink.source-file-untouched | DB | DB | 1 | 1 | PASS | 1 |
| FILE-03.unlink.random-id | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| FILE-03.unlink.cross-org | beta-owner | API B header | 404 | 404 not_found | PASS | 1 |
| FILE-03.svcdefault.newplan | scoped-a | API create plan | 201 | 201 | PASS | 1 |
| FILE-03.svcdefault.autolinked-pinned | scoped-a | API plan files | default file linked & pinned v1 | true pinned=true | PASS | 1 |
| FILE-03.svcdefault.plan-keeps-v1-after-replace | scoped-a | API plan files after v2 | entry still pinned v1, newer_version_available | v1 newer=true | PASS | 1 |
| FILE-03.rpc.direct-delete.* | member-a | rpc delete_file | denied | 403 | PASS | 1 |
| FILE-03.rpc.direct-archive.* | member-a | rpc set_file_archived | denied | 403 | PASS | 1 |
| FILE-03.rpc.direct-update.* | beta-owner | rpc update_file on A file | denied | 500 | PASS | 1 |
| FILE-03.rpc.direct-link.cross-org | beta-owner | rpc link A song file to B plan | denied | 500 | PASS | 1 |
| FILE-03.storage.direct-delete.* | media-a, owner-a | Storage DELETE caller JWT | denied (no delete policy) & object intact | 400 exists=1 | PASS | 2 |
| FILE-03.storage.direct-move.* | media-a | Storage move | denied, object intact | 400 1 | PASS | 1 |
| FILE-03.ui.web-versions-* | editor | Web UI | version history, link edit, text-document editor | Web UI owned by QA-09 (browser not available to this package) | NOT_RUN | 1 |
| FILE-03.ui.native | editor | Mobile UI | version/link/doc screens | Native client (QA-13/14, physical device/simulator not in scope) | NOT_RUN | 1 |

## MEDIA-01 — PASS 164 / FAIL 1 / BLOCKED 0 / NOT_RUN 2 / NOT_APPLICABLE 0

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| MEDIA-01.create.* | media-a | API POST /media | 201 revision 1 | 201 rev=1 | PASS | 1 |
| MEDIA-01.create.persisted | media-a | DB | MEDIA Bundle A\|90\|{Advent,Hope}\|{intro,video}\|<media-a> | MEDIA Bundle A\|90\|{Advent,Hope}\|{intro,video}\|c47a9744-7f94-4908-9f9a-25650883718e | PASS | 1 |
| MEDIA-01.create.allow.* | owner-a, admin-a, legacy-a | API POST /media | 201 | 201 | PASS | 3 |
| MEDIA-01.create.deny.* | member-a, librarian-a, scoped-a, pending-a, confirmed-a, ...(+3) | API POST /media | 403 | 403 forbidden | PASS | 8 |
| MEDIA-01.create.deny.*(A header) | outsider | API | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.create.allow.*(own org) | beta-owner | API | 201 | 201 | PASS | 1 |
| MEDIA-01.create.deny.no-rows | DB | DB | 0 | 0 | PASS | 1 |
| MEDIA-01.rls.insert.* | member-a, media-a | PostgREST POST media | denied | 403 | PASS | 2 |
| MEDIA-01.rls.insert.*.cross-tenant | media-a | PostgREST POST media org B | denied | 403 | PASS | 1 |
| MEDIA-01.rls.update.* | member-a | PostgREST PATCH media | 0 rows/denied | 200 [] | PASS | 1 |
| MEDIA-01.rls.delete.* | member-a | PostgREST DELETE media | 0 rows/denied | 200 [] | PASS | 1 |
| MEDIA-01.rls.select.cross-tenant | beta-owner | PostgREST GET media A | [] | [] | PASS | 1 |
| MEDIA-01.rls.select.* | anonymous | PostgREST | denied/[] | 401 | PASS | 1 |
| MEDIA-01.rls.select.inactive-member | inactive-a | PostgREST | [] | [] | PASS | 1 |
| MEDIA-01.read.detail.* | member-a, librarian-a, pending-a, owner-a, scoped-a, ...(+1) | API GET /media/:id | 200 can_edit false (true for managers) | 200 can_edit=false | PASS | 6 |
| MEDIA-01.read.list.* | member-a, librarian-a, pending-a, owner-a, scoped-a | API GET /media | 200 includes bundle, can_create per cap | 200 n=6 create=false | PASS | 5 |
| MEDIA-01.read.detail.deny.* | inactive-a, outsider, beta-owner | API | 403\|404 | 403 forbidden | PASS | 3 |
| MEDIA-01.read.bad-uuid | member-a | API | 400 | 400 bad_request | PASS | 1 |
| MEDIA-01.read.random | member-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.val.create.title-empty | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.title-whitespace | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.title-201 | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.title-200 | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.title-missing | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.duration-neg | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.duration-86400 | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.duration-86401 | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.duration-float | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.tags-20 | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.tags-21 | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.tag-61-chars | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.tag-empty | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.notes-5000 | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.notes-5001 | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.creator-201 | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.archive_on-bad-format | media-a | API POST /media validation | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.val.create.archive_on-impossible | media-a | API POST /media validation | 400\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.val.create.archive_on-valid-future | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.dup-tags-dedupe | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.tags-deduped | media-a | API tags de-duplicated by DB | [a,b] | ["a","b"] | PASS | 1 |
| MEDIA-01.val.create.title-trimmed | media-a | API | padded | padded | PASS | 1 |
| MEDIA-01.val.create.unicode-title | media-a | API POST /media validation | 201 | 201 | PASS | 1 |
| MEDIA-01.val.create.title-NUL | media-a | API POST /media validation | 400\|422 | 500 22P05 | FAIL W3-FILE-D3 | 1 |
| MEDIA-01.val.create.unknown-field | media-a | API POST /media validation | 201\|400\|422 | 201 | PASS | 1 |
| MEDIA-01.val.create.org-id-injection | media-a | API body organization_id of B ignored | row in A org | 2434e578-7e8e-4b07-bc16-0ebb36cc334f | PASS | 1 |
| MEDIA-01.update.* | media-a, anonymous | API PATCH | 200 rev 2 | 200 rev=2 MEDIA Bundle A v2 | PASS | 2 |
| MEDIA-01.update.persisted | media-a | DB | MEDIA Bundle A v2\|{x}\|2\|<media-a> | MEDIA Bundle A v2\|{x}\|2\|c47a9744-7f94-4908-9f9a-25650883718e | PASS | 1 |
| MEDIA-01.update.stale | media-a | API stale revision | 409 | 409 media_revision_stale | PASS | 1 |
| MEDIA-01.update.stale.no-write | media-a | DB | MEDIA Bundle A v2 | MEDIA Bundle A v2 | PASS | 1 |
| MEDIA-01.update.missing-revision | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.update.empty-title | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.update.clear-optional | media-a | API null clears | 200 | 200 | PASS | 1 |
| MEDIA-01.update.deny.* | member-a, librarian-a, scoped-a, pending-a | API PATCH | 403\|404 | 403 forbidden | PASS | 4 |
| MEDIA-01.update.deny.*(own org header) | beta-owner | API cross-tenant | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.update.cross-org-id.* | media-a | API PATCH B media id | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.race.concurrent-update | media-a+owner-a | API same expected_revision x2 | one 200 one 409 | 409/200 | PASS | 1 |
| MEDIA-01.race.persisted | DB | DB | winner title, rev+1 | race B\|4 | PASS | 1 |
| MEDIA-01.thumb.non-image | media-a | API thumbnail non-image file | 400\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.thumb.other-bundle-file | media-a | API | 400\|404\|409\|422\|500 | 400 bad_request | PASS | 1 |
| MEDIA-01.thumb.cross-org-file | media-a | API | 400\|404\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.thumb.random-id | media-a | API | 400\|404\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.thumb.own-image | media-a | API | 200 | 200 | PASS | 1 |
| MEDIA-01.thumb.clear | media-a | API | 200 | 200 | PASS | 1 |
| MEDIA-01.files.listed.member | member-a | API detail files | 2 files (img+pdf; third upload went to another bundle), can_add_files false | n=2 add=false | PASS | 1 |
| MEDIA-01.files.can_add.* | media-a | API | true | true | PASS | 1 |
| MEDIA-01.search.q | member-a | API ?q=Bundle | >=1 matching | 1 | PASS | 1 |
| MEDIA-01.search.no-results | member-a | API | [] | 0 | PASS | 1 |
| MEDIA-01.search.percent-wildcard-escaped | member-a | API ?q=% | only titles containing literal % | 100% match_me | PASS | 1 |
| MEDIA-01.search.underscore-escaped | member-a | API ?q=_ | only titles containing literal _ | 100% match_me | PASS | 1 |
| MEDIA-01.search.injection-literal | member-a | API | 200 | 200 | PASS | 1 |
| MEDIA-01.search.q-101 | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.search.bad-include_archived | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.search.case-insensitive | member-a | API | (superseded by .retest: race renamed the bundle) | n/a | PASS | 1 |
| MEDIA-01.search.cross-tenant | beta-owner | API B search for A titles | no A bundle | false | PASS | 1 |
| MEDIA-01.search.case-insensitive.retest | member-a | API ?q=fIlE bUnDlE | >=1 | 1 | PASS | 1 |
| MEDIA-01.archive.deny.member | member-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.archive.stale | media-a | API | 409 | 409 media_revision_stale | PASS | 1 |
| MEDIA-01.archive.ok | media-a | API | 200 is_archived true | 200 true 2026-11-18T17:24:16.788+00:00 | PASS | 1 |
| MEDIA-01.archive.persisted | media-a | DB | true\|true\|2 | true\|true\|2 | PASS | 1 |
| MEDIA-01.archive.hidden-from-picker | member-a | API list default | excluded | false | PASS | 1 |
| MEDIA-01.archive.included-in-library | member-a | API include_archived=true | included | true | PASS | 1 |
| MEDIA-01.archive.detail-still-readable | member-a | API detail of archived bundle | 200 | 200 | PASS | 1 |
| MEDIA-01.link.archived-bundle-refused | scoped-a | API | 400\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.archive.restore | media-a | API | is_archived false | 200 false | PASS | 1 |
| MEDIA-01.archive_on.past-is-archived | media-a | API create archive_on 2020 | is_archived true | true | PASS | 1 |
| MEDIA-01.archive_on.link-refused | scoped-a | API | 400\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.archive_on.restore-clears-date | media-a | API restore | is_archived false, archive_on null | 200 false null | PASS | 1 |
| MEDIA-01.link.set.* | scoped-a | API PUT item media | 200 item.media_id=m1 | 200 true | PASS | 1 |
| MEDIA-01.link.set.persisted | scoped-a | DB | 02df7a98-8da9-4887-bb92-7880272ba247 | 02df7a98-8da9-4887-bb92-7880272ba247 | PASS | 1 |
| MEDIA-01.link.usage-listed | member-a | API detail usage | usage lists the plan item | [{"plan_id":"1826f2a0-32e5-4f0b-88fc-7871ca1ccecd","plan_title":"FILE P-RELEASED","service_date":"2026-11-22T15:00:00+00 | PASS | 1 |
| MEDIA-01.link.change | scoped-a | API change bundle | 200 | 200 | PASS | 1 |
| MEDIA-01.link.change.old-usage-cleared | member-a | API | m1 no longer used | [] | PASS | 1 |
| MEDIA-01.delete.in-use-refused | media-a | API | 409 | 409 media_in_use | PASS | 1 |
| MEDIA-01.delete.in-use.no-write | DB | DB | 1 | 1 | PASS | 1 |
| MEDIA-01.link.stale-plan-revision | scoped-a | API expected_revision stale | 409 | 409 plan_revision_stale | PASS | 1 |
| MEDIA-01.link.current-plan-revision | scoped-a | API | 200 | 200 | PASS | 1 |
| MEDIA-01.link.clear | scoped-a | API media_id null | 200 media_id null | 200 null | PASS | 1 |
| MEDIA-01.link.deny.* | member-a, librarian-a, pending-a, confirmed-a, team-a | API PUT item media | 403\|404 | 404 not_found | PASS | 5 |
| MEDIA-01.link.deny.*.out-of-scope-plan | scoped-a | API Midweek-type plan (p4/other plan item) | 403\|404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.media-manager-without-plan-edit | media-a | API PUT item media as media.manage only | 403\|404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.* | anonymous | API | 401 | 401 unauthorized | PASS | 1 |
| MEDIA-01.link.deny.no-write | DB | DB | null | null | PASS | 1 |
| MEDIA-01.link.header-item-refused | scoped-a | API header | 400\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.link.song-item-refused | scoped-a | API song item | 400\|409\|422 | 400 bad_request | PASS | 1 |
| MEDIA-01.link.cross-org-bundle | scoped-a | API B bundle | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.random-bundle | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.random-item | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.item-of-other-plan | scoped-a | API item belongs to plan2 | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.bad-item-uuid | scoped-a | API | 400 | 400 bad_request | PASS | 1 |
| MEDIA-01.link.missing-media_id | scoped-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.link.random-plan | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.cross-tenant-plan.* | beta-owner | API B header, A plan | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.link.setup-for-typechange | scoped-a | API | 200 | 200 | PASS | 1 |
| MEDIA-01.link.item-type-change-drops-media | scoped-a | API PATCH item_type header | media_id cleared (trigger) | 200 media=null | PASS | 1 |
| MEDIA-01.delete.deny.member | member-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.delete.stale | media-a | API | 409 | 409 media_revision_stale | PASS | 1 |
| MEDIA-01.delete.no-body | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| MEDIA-01.delete.ok | media-a | API | 204 | 204 | PASS | 1 |
| MEDIA-01.delete.cascade-files+queue | media-a | DB media/files/versions rows and removal queue | 0\|0\|0\|1 | 0\|0\|0\|1 | PASS | 1 |
| MEDIA-01.delete.retry | media-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.delete.cross-tenant | beta-owner | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.delete.cross-org-id | media-a | API | 404 | 404 not_found | PASS | 1 |
| MEDIA-01.delete.* | anonymous | API | 401 | 401 unauthorized | PASS | 1 |
| MEDIA-01.archived-while-linked.plan-detail-retains-link | member-a | API plan detail | item still references bundle | true media={"id":"b0b87f94-9f47-4b01-a402-0394354ef846","title":"MEDIA archived-while-linked","creator":null,"d | PASS | 1 |
| MEDIA-01.archived-while-linked.relink-same | scoped-a | API re-PUT same archived bundle | info | 200 | PASS | 1 |
| MEDIA-01.update.allow.* | admin-a, legacy-a | API | 200 | 200 | PASS | 2 |
| MEDIA-01.revoke.*.create-after-revoke | media-a | API after media.manage revoked | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.revoke.*.read-still-ok | media-a | API read as member | 200 | 200 | PASS | 1 |
| MEDIA-01.revoke.*.upload-denied | media-a | API intent after revoke | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.revoke.*.regrant | media-a | API | 201 | 201 | PASS | 1 |
| MEDIA-01.combined.songs+media.librarian.create | librarian-a | API | 201 | 201 | PASS | 1 |
| MEDIA-01.combined.librarian.song-create | librarian-a | API songs.manage retained | 201 | 201 | PASS | 1 |
| MEDIA-01.media-editor.no-songs.manage | media-a | API POST /songs | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.media-editor.no-plan-edit | media-a | API PATCH plan | 403\|404 | 403 forbidden | PASS | 1 |
| MEDIA-01.media-editor.no-people-private | media-a | API GET /people (owner-only) | 200\|403 | 200 | PASS | 1 |
| MEDIA-01.ui.web-library | media-editor/member | Web UI | bundle library, picker, usage UI | Web UI owned by QA-09 (browser not available to this package) | NOT_RUN | 1 |
| MEDIA-01.ui.native-readonly | member | Mobile UI | native bundle metadata remains read-only | Native client (QA-13/14, physical device/simulator not in scope) | NOT_RUN | 1 |

## STAGE-01 — PASS 131 / FAIL 1 / BLOCKED 0 / NOT_RUN 1 / NOT_APPLICABLE 1

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| STAGE-01.tpl.create.* | media-a | API POST template | 201 rev1 | 201 rev=1 | PASS | 1 |
| STAGE-01.tpl.create.allow.* | owner-a, admin-a, legacy-a, scoped-a | API | 201 | 201 | PASS | 4 |
| STAGE-01.tpl.create.deny.* | member-a, librarian-a, pending-a, confirmed-a, team-a, ...(+2) | API | 403 | 403 forbidden | PASS | 7 |
| STAGE-01.tpl.create.deny.inactive | inactive-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| STAGE-01.tpl.deny.no-rows | DB | DB | 0 | 0 | PASS | 1 |
| STAGE-01.tpl.list.* | member-a, pending-a, librarian-a, owner-a, anonymous | API GET templates | 200 includes tpl A, can_manage per cap | 200 n=5 manage=false | PASS | 5 |
| STAGE-01.tpl.list.cross-tenant | beta-owner | API | no A templates | false | PASS | 1 |
| STAGE-01.val.tpl.name-empty | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.name-121 | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.name-120 | media-a | API validation | 201 | 201 | PASS | 1 |
| STAGE-01.val.tpl.bg-bad | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.person-in-template | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.obj-201 | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.obj-200 | media-a | API validation | 201 | 201 | PASS | 1 |
| STAGE-01.val.tpl.dup-ids | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.x-out-of-range | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.w-zero | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.rotation-361 | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.color-bad | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.label-81 | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.kind-bad | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.gear-with-person_id | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.id-empty | media-a | API validation | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.val.tpl.unicode-name | media-a | API validation | 201 | 201 | PASS | 1 |
| STAGE-01.val.tpl.name-NUL | media-a | API validation | 400\|422 | 500 22P05 | FAIL W3-FILE-D3 | 1 |
| STAGE-01.tpl.update | media-a | API PATCH | 200 rev2 2 objects | 200 rev=2 n=2 | PASS | 1 |
| STAGE-01.tpl.update.stale | media-a | API | 409 | 409 layout_revision_stale | PASS | 1 |
| STAGE-01.tpl.update.missing-revision | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.tpl.update.person-object | media-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.tpl.archive | media-a | API archived true | 200 archived_at set | 200 2026-11-18T17:25:14.837+00:00 | PASS | 1 |
| STAGE-01.tpl.restore | media-a | API archived false | archived_at null | 200 null | PASS | 1 |
| STAGE-01.tpl.update.deny.* | member-a, librarian-a, pending-a | API | 403\|404 | 403 forbidden | PASS | 3 |
| STAGE-01.tpl.delete.deny.* | member-a, librarian-a, pending-a | API | 403\|404 | 403 forbidden | PASS | 3 |
| STAGE-01.tpl.update.random-id | media-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.tpl.update.cross-tenant | beta-owner | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.tpl.rls.update.* | member-a | PostgREST PATCH | denied/0 rows | 200 [] | PASS | 1 |
| STAGE-01.tpl.rls.insert.* | member-a | PostgREST POST | denied | 403 | PASS | 1 |
| STAGE-01.tpl.rls.select.cross-tenant | beta-owner | PostgREST | [] | [] | PASS | 1 |
| STAGE-01.race.tpl-update | media-a+owner-a | API concurrent same revision | one 200 one 409 | 409/200 | PASS | 1 |
| STAGE-01.layout.create-from-template.* | scoped-a | API POST layout template_id | 201 objects copied (2), template_id set | 201 n=2 tpl=true | PASS | 1 |
| STAGE-01.layout.create.allow.* | owner-a, admin-a, legacy-a | API | 201 | 201 | PASS | 3 |
| STAGE-01.layout.create.deny.* | member-a, librarian-a, pending-a, confirmed-a, team-a, ...(+1) | API | 403\|404 | 403 forbidden | PASS | 6 |
| STAGE-01.layout.create.deny.*.out-of-scope-plan | scoped-a | API Midweek plan | 403\|404 | 403 forbidden | PASS | 1 |
| STAGE-01.layout.create.cross-org-plan | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.create.* | beta-owner, anonymous | API B header A plan | 404 | 404 not_found | PASS | 2 |
| STAGE-01.layout.create.random-template | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.create.cross-org-template | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.create.random-plan | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.deny.no-rows | DB | DB | 0 | 0 | PASS | 1 |
| STAGE-01.layout.people.create | scoped-a | API layout with Person objects | 201 + roster in view | 201 roster=2 issues=[{"kind":"not_scheduled","person_id":"e78f6355-741d-43bd-836c-f3ceac3b827d","object_id":"pa","name": | PASS | 1 |
| STAGE-01.layout.people.random-person | scoped-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| STAGE-01.layout.people.cross-org-person | scoped-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| STAGE-01.layout.people.person-without-id | scoped-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.layout.roster.editor-sees-prepared | scoped-a | API GET layouts roster | info: editor/leader roster includes prepared Camera person (managers may see prepared) | roster n=2 | PASS | 1 |
| STAGE-01.layout.read.viewer.* | member-a, pending-a, confirmed-a, prepared-a, team-a, ...(+2) | API GET layouts | 200 with zero layouts and empty roster (no prepared/staffing leak) can_edit false | 200 layouts=0 roster=0 edit=false | PASS | 7 |
| STAGE-01.layout.read.editor.* | owner-a, admin-a, legacy-a, scoped-a | API | 200 layouts>=2, can_edit | 200 n=5 edit=true | PASS | 4 |
| STAGE-01.layout.read.*.out-of-scope-plan | scoped-a | API | 200 empty or 404; no layouts | 200 0 | PASS | 1 |
| STAGE-01.layout.read.* | beta-owner, anonymous | API | 404 | 404 not_found | PASS | 2 |
| STAGE-01.layout.rls.select.* | member-a, pending-a, media-a | PostgREST GET plan_stage_layouts | [] | [] | PASS | 3 |
| STAGE-01.layout.rls.insert.* | member-a | PostgREST POST | denied | 403 | PASS | 1 |
| STAGE-01.layout.rls.insert.*.midweek | scoped-a | PostgREST POST on out-of-scope plan | denied | 403 | PASS | 1 |
| STAGE-01.layout.rls.select.cross-tenant | beta-owner | PostgREST | [] | [] | PASS | 1 |
| STAGE-01.layout.read.leader(scheduling.manage-only) | team-a | API GET layouts as leader | 200 layouts visible, can_edit false | 200 n=5 edit=false | PASS | 1 |
| STAGE-01.layout.create.deny.leader-without-plans.edit | team-a | API | 403 | 403 forbidden | PASS | 1 |
| STAGE-01.layout.update.deny.leader | team-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| STAGE-01.layout.delete.deny.leader | team-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| STAGE-01.layout.read.leader-revoked | team-a | API after grant revoked | zero layouts | 200 0 | PASS | 1 |
| STAGE-01.layout.update | scoped-a | API PATCH | 200 rev2 | 200 rev=2 bg=thrust | PASS | 1 |
| STAGE-01.layout.update.stale | scoped-a | API | 409 | 409 layout_revision_stale | PASS | 1 |
| STAGE-01.layout.update.refreshed | scoped-a | API refreshed flag | refreshed_at set | 2026-11-18T17:25:15.742+00:00 | PASS | 1 |
| STAGE-01.layout.update.wrong-plan-id | scoped-a | API layout id under another plan | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.update.random-id | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.update.add-person | scoped-a | API | 200 | 200 | PASS | 1 |
| STAGE-01.layout.update.unknown-person | scoped-a | API | 400\|422 | 400 bad_request | PASS | 1 |
| STAGE-01.layout.update.deny.* | member-a, pending-a, media-a, librarian-a | API | 403\|404 | 404 not_found | PASS | 4 |
| STAGE-01.layout.delete.deny.* | member-a, pending-a, media-a, librarian-a | API | 403\|404 | 404 not_found | PASS | 4 |
| STAGE-01.layout.update.*.out-of-scope | scoped-a | API | 403\|404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.deny.no-write | DB | DB | STAGE layout 1b | STAGE layout 1b | PASS | 1 |
| STAGE-01.tpl.delete.layout-unaffected | media-a | DB layout survives, template_id nulled | 1\|null | 1\|null | PASS | 1 |
| STAGE-01.tpl.delete.already-deleted-id | media-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.isolation.other-plan | scoped-a | API p2 layouts | none from p1 | 0 | PASS | 1 |
| STAGE-01.layout.limit-10 | owner-a | API 11th layout | 10 created then refusal | created=10 last=400 {"error":"A plan can have at most 10 stage layouts","code":"bad_request"} | PASS | 1 |
| STAGE-01.race.limit-10-concurrent | owner-a | API 4 concurrent creates with 9 existing | exactly 10 rows total | 201,400,400,400 total=10 | PASS | 1 |
| STAGE-01.tpl.delete | media-a | API DELETE template | 204 | 204 | PASS recorded from first s01 run | 1 |
| STAGE-01.layout.delete.stale | scoped-a | API | 409 | 409 layout_revision_stale | PASS | 1 |
| STAGE-01.layout.delete.no-body | scoped-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| STAGE-01.layout.delete.ok | scoped-a | API | 204 | 204 | PASS | 1 |
| STAGE-01.layout.delete.retry | scoped-a | API | 404 | 404 not_found | PASS | 1 |
| STAGE-01.layout.duplicate-plan-copies-layouts | owner-a | API duplicate plan then GET layouts | info: layouts copied? (copy_plan_children) | dup 201 layouts=0 | PASS | 1 |
| STAGE-01.ui.web-editor-print | planner/member | Web UI | layout editor, drag, print | Web UI owned by QA-09 (browser not available to this package) | NOT_RUN | 1 |
| STAGE-01.layout.duplicate-api | planner | API | duplicate layout action | No duplicate-layout endpoint exists in source (routes/rehearsal.ts); a layout is created fresh or from a template. Plan duplication copies no layouts (recorded in STAGE-01.layout.duplicate-plan-copies-layouts). | NOT_APPLICABLE | 1 |

## REHEARSE-01 — PASS 165 / FAIL 0 / BLOCKED 0 / NOT_RUN 2 / NOT_APPLICABLE 0

| Case ID (family) | Actor(s) | Surface | Expected | Actual | Status | # |
|---|---|---|---|---|---|---|
| REHEARSE-01.manifest.owner | owner-a | API GET manifest | 200 | 200 | PASS | 1 |
| REHEARSE-01.manifest.cache-control | owner-a | API header | no-store | (see below) | PASS | 1 |
| REHEARSE-01.manifest.cache-control.header | owner-a | API response header | Cache-Control: no-store | no-store | PASS | 1 |
| REHEARSE-01.manifest.order-matches-plan | owner-a | API manifest vs plan | identical item order | same | PASS | 1 |
| REHEARSE-01.manifest.positions-sequential | owner-a | API | position 0..n-1 | 0,1,2,3 | PASS | 1 |
| REHEARSE-01.order.reorder-setup | scoped-a | API reorder | 200 | 200 | PASS | 1 |
| REHEARSE-01.manifest.follows-reorder | owner-a | API manifest after reorder | new order | new order | PASS | 1 |
| REHEARSE-01.song.effective-arrangement | owner-a | API manifest song item | arrangement Main, tempo 80 | Main 80 | PASS | 1 |
| REHEARSE-01.song.plan-key-override | owner-a | API manifest chart | key A from plan, chords transposed [A]Hello [D]world | A fromPlan=true "{title: One}\n[A]Hello [D]world" | PASS | 1 |
| REHEARSE-01.song.plan-sequence-override | owner-a | API manifest chart | sequence [C,V1] from plan | C,V1 fromPlan=true | PASS | 1 |
| REHEARSE-01.song.switch-arrangement-setup | scoped-a | API PATCH item arrangement | 200 | 200 | PASS | 1 |
| REHEARSE-01.song.nondefault-arrangement | owner-a | API manifest | arrangement Alt tempo 100 key D (arr files switch) | Alt 100 D | PASS | 1 |
| REHEARSE-01.song.arrangement-files-follow | owner-a | API materials of Alt arrangement | arr1 audio not included (arr-audio belongs to Main) | false | PASS | 1 |
| REHEARSE-01.manifest.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+7) | API GET manifest | 200 | 200 | PASS | 12 |
| REHEARSE-01.materials.item-audio-leaders.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.materials.item-audio-org.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.materials.item-audio-streamonly.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.materials.item-sched-pdf.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.materials.extaudio.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.materials.doc.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest materials | present | present | PASS | 11 |
| REHEARSE-01.media-bundle.leaders-file.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest media materials | leaders file present | present | PASS | 11 |
| REHEARSE-01.media-bundle.org-file.* | owner-a, admin-a, legacy-a, scoped-a, media-a, ...(+6) | API manifest media materials | org file present | present | PASS | 11 |
| REHEARSE-01.track.selected-audio-upload | owner-a | API track_file_id | an audio upload (playback audio), not link/doc | REH item-audio-leaders audio | PASS | 1 |
| REHEARSE-01.rights.stream_only.manifest-flags | owner-a | API material rights | stream true download false offline false | {"stream":true,"download":false,"offline":false} | PASS | 1 |
| REHEARSE-01.link.external-audio | owner-a | API material | playback external, no version, url present | external https://example.test/a.mp3 | PASS | 1 |
| REHEARSE-01.doc.material | owner-a | API material | playback document, not offline | ["document",{"stream":false,"download":false,"offline":false}] | PASS | 1 |
| REHEARSE-01.manifest.no-urls | owner-a | API manifest body | no signed URLs/tokens in manifest | false | PASS | 1 |
| REHEARSE-01.excluded.unfinalized-upload | owner-a | API manifest | pending upload absent | false | PASS | 1 |
| REHEARSE-01.excluded.archived-file | owner-a | API manifest | archived file absent (even for writers) | false | PASS | 1 |
| REHEARSE-01.pin.link | scoped-a | API link pin | 201 | 201 | PASS | 1 |
| REHEARSE-01.pin.manifest-uses-pinned-version | member-a | API manifest | pinned v1 (audio/wav), newer_version_available | v1 audio/wav pinned=true newer=true | PASS | 1 |
| REHEARSE-01.manifest.deny.* | inactive-a, outsider, beta-owner | API | 403\|404 | 403 forbidden | PASS | 3 |
| REHEARSE-01.manifest.cross-org-plan | owner-a | API B plan id under A | 404 | 404 not_found | PASS | 1 |
| REHEARSE-01.manifest.random-plan | owner-a | API | 404 | 404 not_found | PASS | 1 |
| REHEARSE-01.manifest.bad-uuid | owner-a | API | 400 | 400 bad_request | PASS | 1 |
| REHEARSE-01.manifest.empty-plan | member-a | API empty plan | 200 items [] materials [] | 200 0 8 | PASS | 1 |
| REHEARSE-01.manifest.draft-plan.member | member-a | API draft plan manifest | 200 per source (plans_select = is_org_member: drafts readable by every active member; flagged as observation O1) | 200 | PASS | 1 |
| REHEARSE-01.manifest.draft-plan.assigned-member | pending-a | API | info | 200 | PASS | 1 |
| REHEARSE-01.plan-materials.plan-level-file | member-a | API manifest plan_materials | plan-level audio present | true | PASS | 1 |
| REHEARSE-01.pack.* | member-a, anonymous, prepared-a, confirmed-a | API offline-pack default | 200 with entries, recheck_by ~24h, max 500MiB | 200 n=51 excl=17 max=524288000 | PASS | 4 |
| REHEARSE-01.pack.recheck-24h | member-a | API | 86400s | 86400 | PASS | 1 |
| REHEARSE-01.pack.total-bytes-sum | member-a | API | total_bytes = sum(entries) | 26270399 | PASS | 1 |
| REHEARSE-01.pack.excluded-reasons | member-a | API | info: stream_only/link/document listed as excluded | document,external_link,stream_only | PASS | 1 |
| REHEARSE-01.pack.stream_only-excluded | member-a | API | stream-only file in excluded, not entries | false/true | PASS | 1 |
| REHEARSE-01.pack.link-doc-excluded | member-a | API | external link and document excluded | false | PASS | 1 |
| REHEARSE-01.pack.leaders-file-absent.member | member-a | API | leaders-only file not in pack or excluded list | false | PASS | 1 |
| REHEARSE-01.pack.entry-url-bytes | member-a | GET entry url | 200, bytes == size_bytes | 200 4844/4844 | PASS | 1 |
| REHEARSE-01.pack.cap-5000 | member-a | API max_bytes 5000 | total <= cap; remaining excluded with reason | total=4914 entries=2 reasons=pack_limit,document,external_link,stream_only | PASS | 1 |
| REHEARSE-01.pack.cap-1 | member-a | API max_bytes 1 | 0 entries | 0 | PASS | 1 |
| REHEARSE-01.pack.cap-0 | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| REHEARSE-01.pack.cap-2GiB-ok | member-a | API | 200 | 200 | PASS | 1 |
| REHEARSE-01.pack.cap-over-2GiB | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| REHEARSE-01.pack.cap-float | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| REHEARSE-01.pack.cap-string | member-a | API | 400\|422 | 422 unprocessable | PASS | 1 |
| REHEARSE-01.pack.deny.* | inactive-a, outsider, beta-owner | API | 403\|404 | 403 forbidden | PASS | 3 |
| REHEARSE-01.rights-change.setup | owner-a | API tighten | 200 | 200 | PASS | 1 |
| REHEARSE-01.rights-change.new-pack-excludes | member-a | API new pack after audience tightened | file gone from entries and excluded | false | PASS | 1 |
| REHEARSE-01.rights-change.manifest-hides | member-a | API manifest | file absent | false | PASS | 1 |
| REHEARSE-01.rights-change.old-pack-url | member-a | GET old pack URL after tightening | info: valid until TTL (documented; <=300s) | 200 | PASS | 1 |
| REHEARSE-01.pack.url-ttl | member-a | API url_expires_at | <=300s | 298s | PASS | 1 |
| REHEARSE-01.url-recovery.fresh-url-on-rerequest | member-a | API download twice | 200 each, new tokens | 200/200 differ=false | PASS | 1 |
| REHEARSE-01.url-recovery.expired-then-renewed | member-a | Storage expired URL then API renewal | expired 4xx then renewed 200 | 400 -> 200 | PASS | 1 |
| REHEARSE-01.media.archived-bundle-in-manifest | member-a | API manifest with archived bundle linked | info: bundle still linked; files still listed (plan history retained) | media=true materials=12 | PASS | 1 |
| REHEARSE-01.revoked.*.manifest | member-a | API after inactive | 403\|404 | 403 forbidden | PASS | 1 |
| REHEARSE-01.revoked.*.pack | member-a | API | 403\|404 | 403 forbidden | PASS | 1 |
| REHEARSE-01.revoked.*.restored | member-a | API | 200 | 200 | PASS | 1 |
| REHEARSE-01.manifest.truncated-at-300 | member-a | API manifest with 302 items | 300 items, truncated=true | 200 n=300 truncated=true | PASS | 1 |
| REHEARSE-01.player.controls | confirmed/member | Web/Mobile player | select track, play/pause/seek/repeat/next/previous/mini-player | Client-side behaviour; Web UI owned by QA-09 (browser not available to this package); native Native client (QA-13/14, physical device/simulator not in scope). API contract for ordered tracks/playlist inputs is covered. | NOT_RUN | 1 |
| REHEARSE-01.player.link-expiry-ui | member | Web/Mobile player | player recovers from expired link | Client recovery not driven; API renewal of expired URL covered (REHEARSE-01.url-recovery.*) | NOT_RUN | 1 |

## Defects

No P0 and no P1. Cross-tenant, prepared/private data, role enforcement, Storage audience, version race and revision-conflict checks all held (see "What held" below).

### W3-FILE-D1 (P2) Signed upload URL stays valid after the upload is abandoned

- Repro: `POST /files/upload-intents` (any writer) -> `POST /files/:id/abandon {version_id}` (200, `file_removed: true`, file row gone) -> `PUT <upload.signed_url>` with bytes.
- Expected: refused, the intent is dead. Actual: 200 `{"Key": ...}`; the object is written under a path with no version row. `abandon_file_version` only flips the version row; the signed token (valid 2 h) is not tied to version state. Case `FILE-01.abandon.PUT-after-abandon`.
- Impact: bytes the product has already given up on are stored. The abandon trigger had already queued that path for removal, and the object was swept by a later maintenance run (no orphan left at the end of the run), so the leak is only permanent if the sweeper has already run between abandon and the late PUT. Counts toward org storage quota while it exists. A holder of the URL (not just the creator) can write.
- Suspected source: `backend/src/services/files.ts:264` (`createSignedUploadUrl`), `supabase/migrations/20261030000000_f13_files.sql:911` (`abandon_file_version` does not revoke or tombstone the path).
- Same behaviour (accepted, then cleaned by finalize -> `expired`) for a PUT after DB expiry within the token lifetime; finalize correctly ignores those bytes.

### W3-FILE-D2 (P2) Reusing an idempotency key on links/documents silently returns the first file (false success)

- Repro: `POST /files/links {owner: plan P, title "A", url U1, idempotency_key K}` then the same key with `url U2`, or with `owner: song S`. Same for `POST /files/documents` with a different body/title.
- Expected: 409 `idempotency_key_reused`, as `POST /files/upload-intents` does. Actual: 201 with the original file (original URL/body/owner); the second payload is dropped without any signal. Replay also answers 201 rather than 200. Cases `FILE-03.link.create.key-reuse-different`; verified for owner change and document body in a debug run (not recorded as separate rows).
- Suspected source: `supabase/migrations/20261031000100_f14_rehearsal_media_stage.sql:727-745` (`save_file_content`): the comment says replay is "matched by owner, title and URL" but the lookup keys only on `created_by` + `idempotency_key` (and the derived link id); no comparison of the new payload. Same code in `20261030000000_f13_files.sql:1011`. Route status: `backend/src/routes/files.ts` (`res.status(201)` for every create).

### W3-FILE-D3 (P2) NUL character in text fields -> 500 with raw Postgres error

- Repro: any of `POST /files/documents` body `"a\u0000b"`; `POST /files/links` title `"dbg\u0000nul"`; `POST /files/upload-intents` filename `"a\u0000b.pdf"`; `POST /media` title `"a\u0000b"`; `POST /stage-templates` name `"a\u0000b"` (the first three were checked in a debug run, last two are recorded rows).
- Expected: 400/422 validation error. Actual: 500 `{"error":"unsupported Unicode escape sequence","code":"22P05"}`: engine text and SQLSTATE exposed, generic server error. Cases `FILE-03.doc.save.unicode+NUL`, `MEDIA-01.val.create.title-NUL`, `STAGE-01.val.tpl.name-NUL`.
- Suspected source: shared schemas accept `\u0000` (`packages/shared/src/schemas/files.ts` title/body/filename, `media.ts` title/notes/tags, stage `layoutName`/labels); `backend/src/lib/errors.ts` `fromPostgrestError` has no mapping for `22P05` (it maps `22P02`/`22007`/`22008` near line 139). Likely the same for every text field in the product (cross-cutting, wave 2 fixed only UUID/date cases).

## What held (all PASS, with persisted-state and storage-object assertions)

- Upload lifecycle for all six parents (plan, plan_item, song, arrangement, service_type, media) plus links and text documents: intent -> signed PUT -> finalize, row/owner column/object size and MIME asserted; natural writers (scoped-a, legacy-a, librarian-a, media-a, admin/owner) allowed, ordinary member/pending/confirmed/prepared/team/librarian-on-plan/scoped-a-on-Midweek, inactive, outsider, other-org, anonymous denied with no partial rows. Wrong/cross-tenant/random/kind-mismatched parent ids 404; malformed 400/422.
- Failure modes: size_mismatch, type_mismatch, not_uploaded, expired, superseded; bucket rejects text/html (415) and 26214401 B (413); exactly 26214400 B uploads and downloads byte-identical; zero-byte and unsupported types refused; 20-pending-intent cap; idempotent intent replay (200) and key reuse (409); finalize by non-creator/member/wrong file id 404; double finalize replay-safe (4 concurrent: one non-replayed); abandon removes the new file; abandon after ready 409; membership or capability revoked between intent and finalize refuses finalize.
- Storage direct (caller JWT): only the creator can POST the exact pending path, arbitrary/other-org paths refused, no overwrite of a ready object (JWT, signed token, upsert), no caller DELETE/move, anonymous/public routes denied, bucket private, 25 MiB, 25-type allowlist.
- Audience matrix (organization/scheduled/teams/positions/leaders over plan, plan item, song, media, service type; 12 files x 14 actors x API detail, API download, Storage GET, PostgREST row, signed-URL bytes): 0 mismatches versus the source oracle. Prepared assignees see nothing scheduled-only until release (verified before/after release); a declined assignee loses scheduled and position audiences; PostgREST direct writes to attachments/versions and the removal queue are refused for owner and media-editor; service-only maintenance RPCs refused to owner/anonymous; direct RPC calls cross-org/member are refused.
- Signed URLs: API URL TTL <= 300 s; Storage-signed 2 s URL expires; renewal after audience tightened or membership inactive is refused while the already-issued URL works until TTL (documented behaviour); stream_only: attachment 403 `file_stream_only` for readers, inline allowed, writers unaffected (raw bytes remain retrievable, documented as not DRM).
- Versions: v1->v2 replace keeps both objects; readers get v2; pinned link keeps v1 readable, unpin hides v1 from readers and Storage, writers keep it; follow link tracks v2; concurrent v2 finalize: exactly one ready, loser `failed/superseded` and queued for removal; document save race: one 200 one 409; text-doc version history, stale 409, 100000/100001 boundary, Unicode roundtrip; archive/restore/delete incl. pinned-archived file, delete cascade enqueues object removal; service-type default files auto-link pinned to the plan and stay on v1 after replacement.
- Media: media.manage (and owner/admin/legacy) create/edit/archive/delete; member, librarian, scoped, inactive, outsider, anonymous denied (API and PostgREST); stale revision 409 `media_revision_stale`, concurrent update 409 on the loser; field limits, tag dedupe/trim, org-id injection ignored, thumbnail must be an image of the same bundle; list/search (case, %/_ escaping, injection literal, cross-tenant); archive and `archive_on` hide from pickers, restore clears the date; plan item link/change/clear by plan editor only (media-editor without plans.edit denied), header/song items, archived bundle, other-org bundle, other-plan item refused; delete of an in-use bundle 409 `media_in_use`; capability revoke/regrant mid-session honoured.
- Stage: templates (plans.edit-anywhere or media.manage) and plan layouts (plan editors write; leaders read; members see nothing and an empty roster); template copy independent of later template delete; person objects validated against roster and org; 10-layout cap holds under 4 concurrent creates; stale revision and concurrent update conflicts; cross-plan layout id 404; RLS direct reads/writes refused.
- Rehearsal: manifest follows plan order and reorder; effective arrangement, plan key override (chord transposition), sequence override, tempo and non-default arrangement correct; per-caller audience filtering of item/arrangement/media/plan files; pending/archived files excluded; pinned versions honoured with `newer_version_available`; no URLs in the manifest; `Cache-Control: no-store`; offline pack default cap 500 MiB, recheck 24 h, 2 GiB ceiling, stream-only/link/document excluded, per-entry URL TTL <= 300 s, new pack and manifest drop a file whose audience was tightened, expired URL recoverable by re-requesting; 300-item truncation flagged.

## Observations (not counted as defects)

- O1: `plans_select` is `is_org_member` only, so every active member can read draft plans, and therefore their manifest, plan-level files and org-audience file lists. The plan oracle says "view only when entitled"; this belongs to QA-03/QA-09 triage. Record: `REHEARSE-01.manifest.draft-plan.member` (passed against source, not against the oracle's wording).
- O2: `media.manage` is a universal file writer in `private.file_writer` (first branch): the media-editor can add, replace, archive, delete files and set audiences on plan, song, arrangement and service-type files too, not only media bundles. Plan oracle says "File/media workflows"; the media-editor still cannot create songs, edit plans, or change plan-item media links. Confirm this width is intended.
- O3: server accepts any bytes under a declared type (random bytes uploaded as application/pdf finish `ready`); content is not inspected. By design (type/size only).
- O4: only library files (song, arrangement, service type owners) can be linked or pinned on a plan (`link_file_to_plan`: "Only song, arrangement and service type files can be reused on a plan"); plan-owned files cannot be pinned or linked elsewhere. Plan row FILE-03 "pinned-version link vs latest" is covered with library files.
- O5: plan duplication does not copy plan-owned files or stage layouts (recorded, not asserted).
- O6: validation failures answer 422 (`unprocessable`) while bad path params answer 400; the plan's "400" wording was treated as 400|422.
- O7: shared environment: a maintenance run (not driven by this package) swept 35 failed/expired objects of this namespace during the session; fixture rows I forced into `expired`/`pending` were only changed through `upload_expires_at`.

## Not run / blocked

- NOT_RUN (12): all Web UI steps (browser owned by QA-09): upload progress/cancel/retry, preview/download/export UI, version/link/document editors, bundle library and picker, stage editor and print; all native/physical-device steps (picker/camera, native lists and read-only bundle metadata, player background/lock-screen controls); player controls and client-side expired-link recovery (REHEARSE-01 first/second halves are API-contract only; REHEARSE-02, OFFLINE-xx, SCAN-01 belong to other packages); the upload sweeper/removal worker (`expire_file_uploads`, `claim_file_object_removals`, worker forbidden; DB side enqueue verified).
- NOT_APPLICABLE (1): duplicate-layout API does not exist (see above).
- BLOCKED: none.

## Fixtures left in place

- Orgs `qa-20261118-file-a` and `qa-20261118-file-b`; users `{owner-a, admin-a, legacy-a, scoped-a, librarian-a, media-a, member-a, pending-a, confirmed-a, prepared-a, team-a, inactive-a, outsider, beta-owner}.qa20261118.file@example.test`; their Persons, teams, service types, songs/arrangements, ~25 plans (including the 302-item "REH big" plan and ten-layout plans), media bundles, stage templates/layouts, ~250 attachments (some versions in `failed`/`expired`, archived or pending) and their Storage objects, in orgs A and B only.
- Final state worth knowing: pending-a's assignment on P-RELEASED is `declined`; member-a's P-PREPARED assignment was released; `scoped-a` keeps plans.edit + scheduling.manage on "FILE Sunday"; org grants: librarian-a songs.manage, media-a media.manage. All memberships restored to `active`.
- Credentials, sample files and raw JSONL results are in the scratchpad `qa10/` directory only (not committed). `files-cases.tsv` holds the unfolded records.
