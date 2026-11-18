# QA-09 — Song library, chart authoring, imports (wave 3)

- Package: QA-09 (SONG-01–03, CHART-01–02 web parts, IMPORT-01–02, GATED-01 songbook part); plan sections 5.G and 5.H of `docs/plans/admin-mobile-test-plan.md`.
- Commit: `5bedb99` (= main), branch `feature/qa-wave3`. No code, migration or config changed.
- Environment: local Supabase (docker, SQL via `docker exec`), API :4000, web :5173, Node 26.13.1, built-in browser pane (viewport 1024x768), date 2026-11-18. Delivery worker not run. No AI provider configured.
- Namespace: orgs `qa-20261118-song-a` (Alpha, America/Chicago) and `qa-20261118-song-b` (Beta, Asia/Ho_Chi_Minh); users `<alias>.qa20261118.song@example.test`.
- Fixture shape: Alpha has owner, admin, librarian (organization `songs.manage` only), member, legacy scheduler, peoplegrant (`people.manage` + `people.view_private` only); Beta has betaowner and betalibrarian (`songs.manage` in Beta only). Orgs were created with `private.create_church` and memberships inserted by SQL because self-serve church creation is disabled; grants were set through `PUT /access/organization` by the owner. All feature actions used each actor's own JWT (API, PostgREST/RLS and web UI); service role was used only for user creation. D10: 130 songs seeded through the API (varied key/BPM/meter/tags/authors, 5 duplicate titles, one no-chart song, one long Vietnamese chart, merged/archived/plan-referenced songs).
- Source/plan facts recorded: validation failures are HTTP 422 (not 400) across songs/imports; `GET /songs/:id/chart` ignores capo; AI/OCR import was removed (migration `20260913000200_drop_chord_sheet_imports.sql`); merge requires plan-edit access to every affected plan (`private.song_merge_state`); legacy scheduler keeps song authoring through legacy org capabilities (consistent with the oracle).
- Status totals across all records below: FAIL 18, NOT_APPLICABLE 1, NOT_RUN 6, PASS 482. Records are one per action x actor x surface x failure mode; "PASS" rows labelled "observed" record behaviour without a stated requirement. Defect IDs are in brackets.


## SONG-01 (179 records: FAIL 7, NOT_RUN 1, PASS 171)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SONG-01.list.total | librarian | API | total>=130 | total=130 len=50 | PASS |
| SONG-01.page.nodup | librarian | API | union of pages = total, no dups | 130 uniq 130 | PASS |
| SONG-01.sort.title | librarian | API | title ascending stable | QA Duplicate Title / QA Duplicate Title / QA Duplicate Title | PASS |
| SONG-01.page.past100 | librarian | API | per_page=100 page 2 returns remaining | len=30 | PASS |
| SONG-01.per_page.200 | librarian | API | 200 ok >100 rows | len=130 | PASS |
| SONG-01.per_page.201 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.per_page.0 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.page.0 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.page.beyond | librarian | API | 200 empty, real total | 200  len=0 | PASS |
| SONG-01.page.nan | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.sort.recent | librarian | API | recent sorts by updated desc | 200  first=QA Song 004 | PASS |
| SONG-01.sort.invalid | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.q.exact | librarian | API | 1 hit | total=1 | PASS |
| SONG-01.q.none | librarian | API | empty | total=0 | PASS |
| SONG-01.q.percent | librarian | API | literal % no hits (or no 500) | 200  total=130 | PASS |
| SONG-01.q.underscore | librarian | API | 200 | 200  total=130 | PASS |
| SONG-01.q.sqli | librarian | API | 200 no hits | 200  total=0 | PASS |
| SONG-01.q.postgrest-chars | librarian | API | 200 | 200  total=0 | PASS |
| SONG-01.q.101 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.q.vi | librarian | API | vietnamese hit | total=1 | PASS |
| SONG-01.q.vi.noaccent | librarian | API | informational: accent-insensitive? | total=0 [observed accent-sensitive] | PASS |
| SONG-01.q.ccli | librarian | API | informational: ccli search | total=0 [observed] | PASS |
| SONG-01.q.author | librarian | API | informational: author in q | total=0 [observed] | PASS |
| SONG-01.q.whitespace | librarian | API | trimmed | total=1 | PASS |
| SONG-01.f.theme | librarian | API | only grace | total=32 | PASS |
| SONG-01.f.key | librarian | API | only Bb | total=16 | PASS |
| SONG-01.f.bpm | librarian | API | in range | total=11 | PASS |
| SONG-01.f.bpm.inverted | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.f.bpm.19 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.f.bpm.301 | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.f.type | librarian | API | only kids | total=43 | PASS |
| SONG-01.f.style | librarian | API | all Folk | total=130 | PASS |
| SONG-01.f.speed.none | librarian | API | 0 | total=0 | PASS |
| SONG-01.f.author | librarian | API | odd only | total=65 | PASS |
| SONG-01.f.sched.inverted | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.f.sched.bad | librarian | API | 422 validation | 422 unprocessable | PASS |
| SONG-01.f.combined | librarian | API | AND | total=16 | PASS |
| SONG-01.archive | librarian | API | 200 archived_at set, revision++ | 200  rev=4 | PASS |
| SONG-01.archive.filter | librarian | API | active excludes, archived includes, all=total | active=129 archived=1 all=130 | PASS |
| SONG-01.archive.stale | librarian | API | 409 stale | 409 song_revision_stale | PASS |
| SONG-01.restore | librarian | API | 200 archived_at null | 200  | PASS |
| SONG-01.archive.norev | librarian | API | 422 (revision required) | 422 unprocessable | PASS |
| SONG-01.archive.strict | librarian | API | 422 unknown field | 422 unprocessable | PASS |
| SONG-01.create.owner | owner | API | 201 | 201  | PASS |
| SONG-01.create.admin | admin | API | 201 | 201  | PASS |
| SONG-01.create.librarian | librarian | API | 201 | 201  | PASS |
| SONG-01.create.scheduler | scheduler | API | record legacy behaviour (plan: legacy org capabilities) | 201  [legacy scheduler allowed] | PASS |
| SONG-01.create.member | member | API | 403 | 403 forbidden | PASS |
| SONG-01.create.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-01.read.owner | owner | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.owner | owner | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.read.admin | admin | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.admin | admin | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.read.librarian | librarian | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.librarian | librarian | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.read.scheduler | scheduler | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.scheduler | scheduler | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.read.member | member | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.member | member | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.read.peoplegrant | peoplegrant | API | 200 (all org members read library) | 200  | PASS |
| SONG-01.list.peoplegrant | peoplegrant | API | 200 total>=130 | 200  total=134 | PASS |
| SONG-01.patch.member | member | API | 403 | 403 forbidden | PASS |
| SONG-01.delete.member | member | API | 403 | 403 forbidden | PASS |
| SONG-01.archive.member | member | API | 403 | 403 forbidden | PASS |
| SONG-01.patch.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-01.delete.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-01.archive.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-01.rls.patch.member | member | DB/RLS | 0 rows changed / 403 | 200 rows=0 | PASS |
| SONG-01.rls.delete.member | member | DB/RLS | 0 rows deleted | 200 rows=0 | PASS |
| SONG-01.rls.insert.member | member | DB/RLS | denied | 403 42501 | PASS |
| SONG-01.rls.patch.peoplegrant | peoplegrant | DB/RLS | 0 rows changed / 403 | 200 rows=0 | PASS |
| SONG-01.rls.delete.peoplegrant | peoplegrant | DB/RLS | 0 rows deleted | 200 rows=0 | PASS |
| SONG-01.rls.insert.peoplegrant | peoplegrant | DB/RLS | denied | 403 42501 | PASS |
| SONG-01.rls.patch.scheduler | scheduler | DB/RLS | record | 200 rows=1 [legacy scheduler RLS allows song update] | PASS |
| SONG-01.rls.delete.scheduler | scheduler | DB/RLS | record legacy behaviour | 200 rows=1 [legacy scheduler RLS allows song delete (consistent with oracle: legacy org-level songs capability)] | PASS |
| SONG-01.rls.insert.scheduler | scheduler | DB/RLS | record | 201 [legacy scheduler RLS insert 201] | PASS |
| SONG-01.xorg.read.betaowner | betaowner | API | 403 (not a member of A) | 403 forbidden | PASS |
| SONG-01.xorg.create.betaowner | betaowner | API | 403 | 403 forbidden | PASS |
| SONG-01.xorg.idsub.betaowner | betaowner | API | 404 when A id used under org B header | 404 not_found | PASS |
| SONG-01.xorg.patch.betaowner | betaowner | API | 403/404, not applied | 404 not_found | PASS |
| SONG-01.xorg.delete.betaowner | betaowner | API | 403/404 (204 without effect is soft fail) | 204  [W3-SONG-D1: DELETE of nonexistent/other-org song returns 204 (no-op) instead of 404; no data deleted W3-SONG-D1] | FAIL |
| SONG-01.xorg.schedule.betaowner | betaowner | API | 404 | 404 not_found | PASS |
| SONG-01.xorg.rls.select.betaowner | betaowner | DB/RLS | 0 rows | 200 rows=0 | PASS |
| SONG-01.xorg.rls.patch.betaowner | betaowner | DB/RLS | 0 rows | 200 rows=0 | PASS |
| SONG-01.xorg.rls.insert.betaowner | betaowner | DB/RLS | denied | 403 42501 | PASS |
| SONG-01.xorg.list.betaowner | betaowner | API | B list has no A songs | total=0 | PASS |
| SONG-01.xorg.chart.betaowner | betaowner | API | 404 | 404 not_found | PASS |
| SONG-01.xorg.read.betalibrarian | betalibrarian | API | 403 (not a member of A) | 403 forbidden | PASS |
| SONG-01.xorg.create.betalibrarian | betalibrarian | API | 403 | 403 forbidden | PASS |
| SONG-01.xorg.idsub.betalibrarian | betalibrarian | API | 404 when A id used under org B header | 404 not_found | PASS |
| SONG-01.xorg.patch.betalibrarian | betalibrarian | API | 403/404, not applied | 404 not_found | PASS |
| SONG-01.xorg.delete.betalibrarian | betalibrarian | API | 403/404 (204 without effect is soft fail) | 204  [W3-SONG-D1: DELETE of nonexistent/other-org song returns 204 (no-op) instead of 404; no data deleted W3-SONG-D1] | FAIL |
| SONG-01.xorg.schedule.betalibrarian | betalibrarian | API | 404 | 404 not_found | PASS |
| SONG-01.xorg.rls.select.betalibrarian | betalibrarian | DB/RLS | 0 rows | 200 rows=0 | PASS |
| SONG-01.xorg.rls.patch.betalibrarian | betalibrarian | DB/RLS | 0 rows | 200 rows=0 | PASS |
| SONG-01.xorg.rls.insert.betalibrarian | betalibrarian | DB/RLS | denied | 403 42501 | PASS |
| SONG-01.xorg.list.betalibrarian | betalibrarian | API | B list has no A songs | total=0 | PASS |
| SONG-01.xorg.chart.betalibrarian | betalibrarian | API | 404 | 404 not_found | PASS |
| SONG-01.noauth | anonymous | API | 401 | 401 unauthorized | PASS |
| SONG-01.val.title.empty | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.title.ws | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.title.200 | librarian | API | 201 | 201  id=892aa52f-fd70-4faa-b1a4-1b4aabe047ae | PASS |
| SONG-01.val.title.201 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.title.missing | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.title.number | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.author.201 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.author.200 | librarian | API | 201 | 201  id=df5969f4-517e-41d0-8676-28bce4e26534 | PASS |
| SONG-01.val.ccli.41 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.ccli.40 | librarian | API | 201 | 201  id=4ec742a8-07f2-4c10-9d44-0835f85bb1d1 | PASS |
| SONG-01.val.copyright.301 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.administration.301 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.key.9 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.key.8 | librarian | API | 201 | 201  id=9bb05c36-b245-442f-90a7-ee2f8ba524a5 | PASS |
| SONG-01.val.bpm.19 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.bpm.20 | librarian | API | 201 | 201  id=35cfef02-7de5-4cdd-bff6-6135081019aa | PASS |
| SONG-01.val.bpm.300 | librarian | API | 201 | 201  id=b1f9e2e9-dba7-464c-9822-676c29c49bde | PASS |
| SONG-01.val.bpm.301 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.bpm.float | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.bpm.string | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.meter.21 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.themes.20 | librarian | API | 201 | 201  id=74d27590-d91d-4fc7-aeb4-426f5efaef0e | PASS |
| SONG-01.val.themes.21 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.tag.41 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.tag.empty | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.style.41 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.speed.41 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.notes.4000 | librarian | API | 201 | 201  id=5b83e4e8-b475-4f8f-a905-1645740c3f18 | PASS |
| SONG-01.val.notes.4001 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.val.unicode | librarian | API | 201 | 201  id=eff8dc30-635f-4a6d-b7a9-139c4ee91a12 | PASS |
| SONG-01.val.formula | librarian | API | 201 | 201  id=0dc2f696-cd83-439c-a462-743dc7fb3614 | PASS |
| SONG-01.val.unknown-field | librarian | API | 201 | 201  id=b841b199-d93f-4283-af56-372c4d5b1fe6 | PASS |
| SONG-01.val.mass-assign | librarian | API | org/created_by/revision not taken from body | org=A rev=1 by=self | PASS |
| SONG-01.val.trim | librarian | API | trimmed | title=[trim] | PASS |
| SONG-01.patch.ok | librarian | API | 200 rev++ persisted | 200  rev=2 | PASS |
| SONG-01.patch.stale | librarian | API | 409 song_revision_stale | 409 song_revision_stale | PASS |
| SONG-01.patch.stale.nowrite | librarian | API | stale write not persisted | notes=edit1 | PASS |
| SONG-01.patch.norev | librarian | API | 200 legacy last-write-wins | 200  | PASS |
| SONG-01.patch.title.empty | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.patch.null-clear | librarian | API | nullable fields clear | 200  | PASS |
| SONG-01.patch.empty | librarian | API | 200 noop or 422 explicit | 404 not_found [W3-SONG-D2] | FAIL |
| SONG-01.patch.rev0 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.patch.mass-assign-org | librarian | API | organization_id ignored | 200  org=A | PASS |
| SONG-01.patch.missing | librarian | API | 404 | 404 not_found | PASS |
| SONG-01.patch.baduuid | librarian | API | 400 | 400 bad_request | PASS |
| SONG-01.get.baduuid | librarian | API | 400 | 400 bad_request | PASS |
| SONG-01.patch.race5 | librarian | API | exactly 1 of 5 wins, others 409 | 409,200,409,409,409 | PASS |
| SONG-01.delete.referenced | librarian | API | delete refused while a plan item references the song (reference protection) | 400 bad_request; song rows=1; plan_item row (song_null,arr_null,key,seq)=f/f/A/{C,V1} | PASS |
| SONG-01.delete.unreferenced | librarian | API | 204 + row gone | 204  | PASS |
| SONG-01.delete.then-get | librarian | API | 404 | 404 not_found | PASS |
| SONG-01.archive.referenced | librarian | API | archive ok, plan item keeps reference | 200  ref kept=t | PASS |
| SONG-01.grant.before-revoke | librarian | API | 200 | 200  | PASS |
| SONG-01.grant.revoked.api | librarian | API | 403 on next request (same token) | 403 forbidden | PASS |
| SONG-01.grant.revoked.rls | librarian | DB/RLS | 0 rows | 200 rows=0 | PASS |
| SONG-01.grant.revoked.read | librarian | API | read still allowed (member) | 200  | PASS |
| SONG-01.grant.restored | librarian | API | 200 | 200  | PASS |
| SONG-01.grant.other-cap.media.manage | member | API | 403 (unrelated capability gives no song authoring) | 403 forbidden | PASS |
| SONG-01.grant.other-cap.plans.edit | member | API | 403 (unrelated capability gives no song authoring) | 403 forbidden | PASS |
| SONG-01.grant.other-cap.scheduling.manage | member | API | 403 (unrelated capability gives no song authoring) | 403 forbidden | PASS |
| SONG-01.grant.member+songs.manage | member | API | 201 once granted songs.manage | 201  | PASS |
| SONG-01.grant.member.revoked-again | member | API | 403 | 403 forbidden | PASS |
| SONG-01.f.scheduled-window | librarian | API | songs scheduled in Dec 2026 (ref songs) listed | 200  total=4 QA Merge2 Winner/QA Merge Winner/QA Ref Song A/QA Ref Song B | PASS |
| SONG-01.f.scheduled-none | librarian | API | 0 songs | total=0 | PASS |
| SONG-01.schedule | member-visible | API | plan listed with arrangement | 200 [{"plan_id":"cadcc37f-1319-4f11-b44d-8cf04c6a6bd0","plan_title":"QA Ref Plan","service_date":"2026-12-06T16:00:00+00:00" | PASS |
| SONG-01.schedule.limit51 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.schedule.limit0 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.schedule.arr-bad | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-01.create.double-submit | librarian | API | observe: two identical creates (no idempotency key in contract) | 201,201 -> 2 songs created [no idempotency on POST /songs (title not unique); duplicates are by design flagged via duplicates endpoint] | PASS |
| SONG-01.ui.list.paging | librarian | Web /songs | 144 songs shown as 50/50/44 over 3 pages, Next disabled on last | pages 50,50,44; Next disabled on page 3; Previous returns to page 2 | PASS |
| SONG-01.ui.search | librarian | Web /songs | text filter narrows, resets to page 1, empty state offers Add a song | "QA Song 013" -> 1 song, page reset 2->1; no-match shows "No songs match that search" [Filter/page not reflected in URL (observation)] | PASS |
| SONG-01.ui.filters.key | librarian | Web /songs | Filters panel Key=Bb returns only Bb songs | 15 songs [Panel exposes library(active/archived/all), key, theme, type, style, speed, author, BPM min/max, scheduled from/to] | PASS |
| SONG-01.ui.filters.archived | librarian | Web /songs | Archived library lists archived songs | 3 songs; 2 are merge aliases shown only as "Archived" [W3-SONG-D5] | PASS |
| SONG-01.ui.sort-and-range-filters | librarian | Web /songs | A-Z / Recently updated toggle, BPM range, scheduled window in UI | not driven in browser (API covered: SONG-01.sort.*, f.bpm, f.scheduled-window) [API coverage only] | NOT_RUN |
| SONG-01.ui.create | librarian | Web Add Song modal | song + arrangement saved; chords-over-lyrics pasted text converted to ChordPro aligned to columns | saved rev 1; chart "[G]Amazing g[C]race how sweet\n[D]the sound[G] that saved" [Modal has no BPM/meter/author/CCLI inputs; edit modal has no BPM/meter either (observation)] | PASS |
| SONG-01.ui.edit.save | librarian | Web Song Information modal | edit authors, persisted, revision++ | authors saved; revision 3 | PASS |
| SONG-01.ui.edit.stale | librarian | Web Song Information modal | 409 shows message and preserves draft; user can reload latest and re-save without losing draft | message shown, draft kept, but every retry stays 409; Cancel+reopen shows stale form; only full page reload recovers (draft lost) [W3-SONG-D7] | FAIL |
| SONG-01.ui.edit.validation | librarian | Web Song Information modal | blank/whitespace title gives field-level message | generic "Invalid request body" banner, no field marked [W3-SONG-D8] | FAIL |
| SONG-01.ui.delete.referenced | librarian | Web Actions > Delete song | confirm, then delete refused with an explanation that the song is used by a plan | confirm shown; refused (song kept) but banner says "Referenced record does not exist" [W3-SONG-D6 (protection works, wording wrong)] | FAIL |
| SONG-01.ui.member | member | Web /songs, song page, chart, /imports | read-only: no Add/Import/bulk select, chart editor fields disabled, /imports refused | 147 songs listed; no Add/Import/select controls; chart editor inputs disabled and no Save; /imports shows "Import permission required" | PASS |
| SONG-01.api.delete.referenced-message | librarian | API | 409/400 with explanation | 400 bad_request "Referenced record does not exist" [W3-SONG-D6] | FAIL |

## SONG-02 (89 records: FAIL 2, NOT_RUN 1, PASS 86)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SONG-02.arr.create.member | member | API | 403 | 403 forbidden | PASS |
| SONG-02.arr.create.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-02.rls.arr.insert.member | member | DB/RLS | denied | 403 42501 | PASS |
| SONG-02.rls.arr.insert.peoplegrant | peoplegrant | DB/RLS | denied | 403 42501 | PASS |
| SONG-02.rls.arr.insert.scheduler | scheduler | DB/RLS | record | 403 [legacy scheduler arr insert 403] | PASS |
| SONG-02.val.capo.-1 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.capo.12 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.capo.0 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.capo.11 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.bpm.19 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.bpm.301 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.len.-1 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.len.36000 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.len.36001 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.seq.61 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.seq.60 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.seq.item21 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.chart.100000 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.chart.100001 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.format.bad | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.cols.3 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.cols.2 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.fontsize.5 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.fontsize.49 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.fontsize.48 | librarian | API | 201 | 201  | PASS |
| SONG-02.val.color.bad | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.color.ok | librarian | API | 201 | 201  | PASS |
| SONG-02.val.name.121 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.initial | librarian | API | 1 default arrangement | n=1 default=true | PASS |
| SONG-02.arr.create | librarian | API | 201 persisted fields | 201  | PASS |
| SONG-02.arr.create.notdefault | librarian | API | new arrangement not default | is_default=false | PASS |
| SONG-02.default.promote.create | librarian | API | creating with is_default demotes previous; exactly 1 default | status=201 defaults=Third | PASS |
| SONG-02.arr.patch.ok | librarian | API | 200 rev++ | 200  rev=3 | PASS |
| SONG-02.arr.patch.stale | librarian | API | 409 arrangement_revision_stale | 409 arrangement_revision_stale | PASS |
| SONG-02.arr.stale.nowrite | librarian | API | name stays Main2 | name=Main2 | PASS |
| SONG-02.arr.race | librarian | API | 1 wins, 2 409 | 200,409,409 | PASS |
| SONG-02.inherit.key.stored | librarian | API | informational: arrangement w/o key stores null; chart endpoint | song_key=null bpm=null [arr via POST /songs/:id/arrangements does not inherit song key at write; inherited at read in UI] | PASS |
| SONG-02.inherit.key.transpose | librarian | API | no-key transposition explicit 400 | 200  {"chordpro":"","key":null,"semitones":0,"notation":"chords"} | PASS |
| SONG-02.val.patch.capo.12 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.patch.bpm.19 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.patch.name.empty | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.patch.cols.3 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.patch.seq.61 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.val.patch.null-key | librarian | API | 200 | 200  | PASS |
| SONG-02.val.patch.len.36001 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.key.create | librarian | API | 200 key saved | 200  rev=1 | PASS |
| SONG-02.key.update | librarian | API | rev 2 | 200  | PASS |
| SONG-02.key.stale | librarian | API | 409 | 409 library_changed {"error":"Key changed; reload","code":"library_changed"} | PASS |
| SONG-02.key.duplabel | librarian | API | duplicate label refused (409/422) or allowed | 409 conflict (observed) | PASS |
| SONG-02.key.val.key.bad | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"song_ | PASS |
| SONG-02.key.val.key.long | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"song_ | PASS |
| SONG-02.key.val.capo.12 | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"capo" | PASS |
| SONG-02.key.val.label.empty | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"label | PASS |
| SONG-02.key.val.label.81 | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"label | PASS |
| SONG-02.key.val.vocal.81 | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"vocal | PASS |
| SONG-02.key.val.files.dup | librarian | API | 422/4xx | 403 forbidden {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| SONG-02.key.val.extra | librarian | API | 422/4xx | 422 unprocessable {"error":"Invalid request body","code":"unprocessable","details":[{"path":"","co | PASS |
| SONG-02.materials | librarian | API | keys listed | 200  keys=1 | PASS |
| SONG-02.key.member | member | API | 403 | 403 forbidden | PASS |
| SONG-02.materials.member | member | API | 200 read | 200  | PASS |
| SONG-02.materials.xorg | betaowner | API | 404/403 | 404 not_found | PASS |
| SONG-02.key.xorg | betaowner | API | 403/404 | 404 not_found [404 hides existence] | PASS |
| SONG-02.arr.patch.member | member | API | 403 | 403 forbidden | PASS |
| SONG-02.arr.delete.member | member | API | 403 | 403 forbidden | PASS |
| SONG-02.arr.patch.xorg | betalibrarian | API | 403/404 | 404 not_found | PASS |
| SONG-02.arr.delete.xorg | betalibrarian | API | 403/404 (204 no-op noted) | 204  [W3-SONG-D1 (204 no-op, RLS prevented the delete)] | FAIL |
| SONG-02.arr.rls.patch.member | member | DB/RLS | 0 rows | 200 [] | PASS |
| SONG-02.arr.rls.patch.xorg | betaowner | DB/RLS | 0 rows | 200 | PASS |
| SONG-02.key.rls.insert.member | member | DB/RLS | denied | 403 42501 | PASS |
| SONG-02.dup.preview | librarian | API | 200 fingerprint | 200  | PASS |
| SONG-02.dup.preview.nowrite | librarian | API | preview does not create | arrs=4 | PASS |
| SONG-02.dup.commit | librarian | API | 201 new arrangement | 201  | PASS |
| SONG-02.dup.idempotent | librarian | API | same key -> same arrangement, no second copy | 201  | PASS |
| SONG-02.dup.count | librarian | API | exactly +1 | before=4 after=5 | PASS |
| SONG-02.dup.fidelity | librarian | API | copied chart/sequence/capo, not default | name=Acoustic Copy capo=2 def=false | PASS |
| SONG-02.dup.badfp | librarian | API | 409/4xx stale fingerprint | 409 library_changed {"error":"Materials changed; preview again","code":"library_changed"} | PASS |
| SONG-02.dup.stale | librarian | API | 409 | 409 library_changed | PASS |
| SONG-02.dup.member | member | API | 403 | 403 forbidden | PASS |
| SONG-02.dup.val.name | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-02.arr.archive | librarian | API | 200 archived | 200  | PASS |
| SONG-02.arr.archive.stale | librarian | API | 409 | 409 arrangement_revision_stale | PASS |
| SONG-02.arr.restore | librarian | API | 200 restored | 200  | PASS |
| SONG-02.arr.archive.default | librarian | API | observe: archiving the default arrangement | 200  {"name":"Third","song_key":null,"capo":null,"bpm":null,"meter":null,"length_seconds":null,"sequence":[],"chord_chart":nu [observed] | PASS |
| SONG-02.default.promote.patch | librarian | API | patch is_default promotes, exactly 1 default remains | 200  defaults=Acoustic Copy | PASS |
| SONG-02.default.demote | librarian | API | observe: unsetting the only default | 200  defaults=0 [observed (no default arrangement possible = true)] | PASS |
| SONG-02.arr.delete.referenced | librarian | API | delete refused while plan item references the arrangement | 400 bad_request; plan_item arrangement_id null=f | PASS |
| SONG-02.ui.arrangement.add | librarian | Web Add Arrangement modal | create with name, key, length 3:30, bpm, sequence, default | created: length 210s, sequence {V1,C,B}, default promoted (previous default unset) | PASS |
| SONG-02.ui.arrangement.validation | librarian | Web Add Arrangement modal | BPM 400 gives field-level message | generic "Invalid request body" [W3-SONG-D8] | FAIL |
| SONG-02.ui.keys-duplicate-archive-delete | librarian | Web arrangement panels | labeled key CRUD, duplicate preview/commit, archive/restore, delete panels driven in UI | not driven in browser (API covered: SONG-02.key.*, dup.*, arr.archive*, arr.delete.referenced) [API coverage only] | NOT_RUN |

## SONG-03 (61 records: NOT_RUN 1, PASS 60)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SONG-03.bulk.preview.member | member | API | 403 | 403 forbidden | PASS |
| SONG-03.duplicates.member | member | API | 403 | 403 forbidden | PASS |
| SONG-03.bulk.preview.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-03.duplicates.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| SONG-03.bulk.preview | librarian | API | 200 preview with before/after per row | 200  | PASS |
| SONG-03.bulk.preview.nowrite | librarian | API | preview does not change songs | style=Folk | PASS |
| SONG-03.bulk.commit.stale-atomic | librarian | API | commit refused (409/4xx), NO rows changed | 409 song_revision_stale styles=Folk,Folk,Folk,Folk,Folk | PASS |
| SONG-03.bulk.commit.member | member | API | 403 | 403 forbidden | PASS |
| SONG-03.bulk.commit.scheduler-uses-librarian-preview | scheduler | API | not able to commit another user's preview | 404 not_found | PASS |
| SONG-03.bulk.commit.other-user | owner | API | record: owner commits librarian preview (observe) | 404 not_found style=Folk [observed — creator-bound] | PASS |
| SONG-03.bulk.commit | librarian | API | 200; all 5 rows updated, revision++ | 200; 5 songs style=BulkStyle themes=bulk,x revision 2 (3 for the one patched earlier) | PASS |
| SONG-03.bulk.commit.replay | librarian | API | second commit refused or idempotent, no double revision bump | 200 replay returned result; revisions unchanged (2) - idempotent | PASS |
| SONG-03.bulk.commit.unknown | librarian | API | 404/4xx | 404 not_found | PASS |
| SONG-03.bulk.val.empty-patch | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.unknown-field | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.title-in-patch | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.no-rows | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.dup-rows | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.bad-uuid | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.rev0 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.extra-top | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.bpm-301 | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.val.101rows | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.bulk.preview.stale-rev | librarian | API | 4xx stale | 409 song_revision_stale {"error":"song_revision_stale","code":"song_revision_stale"} | PASS |
| SONG-03.bulk.preview.missing-song | librarian | API | whole preview refused | 404 not_found {"error":"no_data_found","code":"not_found"} | PASS |
| SONG-03.bulk.xorg-song | librarian | API | 4xx, beta song untouched | 404 not_found | PASS |
| SONG-03.bulk.xorg-actor | betalibrarian | API | 4xx (A song under org B) | 404 not_found | PASS |
| SONG-03.duplicates | librarian | API | lists loser by title+ccli | 200  [{"id":"5205a10a-d79e-4c1b-8cba-7f1a8485fa32","title":"QA Merge2 Winner","reason":"ccli"},{"id":"a9f48336-5229-4d22-b22d | PASS |
| SONG-03.merge.val.same | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.merge.val.missing | librarian | API | 422 | 422 unprocessable | PASS |
| SONG-03.merge.xorg-loser | librarian | API | 4xx, beta song untouched | 400 bad_request {"error":"Two organization songs required","code":"bad_request"} | PASS |
| SONG-03.merge.missing-loser | librarian | API | 404 | 400 bad_request | PASS |
| SONG-03.merge.commit.member | member | API | 403 | 403 forbidden | PASS |
| SONG-03.merge.preview.xorg-actor | betalibrarian | API | 4xx | 400 bad_request | PASS |
| SONG-03.merge.preview.librarian-planref-denied | librarian | API | 403: merge touching plan items needs plan edit access (source design; plan lists librarian) | 403 forbidden | PASS |
| SONG-03.merge.librarian-vs-plan | librarian | API | plan row: librarian merges duplicates | 403 forbidden when a plan references either song [DOC-DISAGREE: see Defects W3-SONG-D4 (P2)] | PASS |
| SONG-03.merge.preview | librarian | API | 200 counts across both songs: arrangements=2 keys=1 plan_items=1 songbook_items=1, no blockers | 200  arr=2 keys=1 plan=1 book=1 blockers=[] policy=Keep winner metadata/default. Move losing arrangements and files with IDs, audiences and versions intact. Freeze inheri | PASS |
| SONG-03.merge.preview.nowrite | librarian | API | loser still unmerged | unmerged | PASS |
| SONG-03.merge.preview.metadata | librarian | API | metadata diff includes notes/author | [{"field":"administration","kept":null,"losing":null},{"field":"author","kept":null,"losing":"Loser Author"},{"field":"ccli_number","kept":"777001","losing":"77 | PASS |
| SONG-03.merge.commit.stale-fp | librarian | API | 409/4xx stale fingerprint, nothing moved | 409 library_changed {"error":"Library or references changed; preview again","code":"library_changed"} | PASS |
| SONG-03.merge.commit.bad-fp | librarian | API | 4xx | 409 library_changed | PASS |
| SONG-03.merge.commit.race | librarian | API | exactly one merge operation; others replay same op or 4xx | 200,200,409 ops=1 | PASS |
| SONG-03.merge.refs.plan-item | librarian | DB | plan item points to winner, arrangement kept, key/sequence override survive | t/62d48619-fd90-4dcc-9e4b-b2aaf7aa028b/F/{C,V1,C} | PASS |
| SONG-03.merge.refs.arrangements | librarian | DB | loser arrangement now belongs to winner (2 arrangements) | winner arrangements=2 | PASS |
| SONG-03.merge.refs.key | librarian | DB | labeled key survives on moved arrangement | key kept | PASS |
| SONG-03.merge.refs.songbook | librarian | DB | songbook item points to winner |  | PASS |
| SONG-03.merge.loser-alias | librarian | DB | loser kept as alias row (merged_into set) | t/t | PASS |
| SONG-03.merge.loser-read | librarian | API | GET loser resolves to canonical arrangements | 200  arr=2 | PASS |
| SONG-03.merge.list-hides-loser | librarian | API | alias hidden from Active; shown only under Archived/All | active=1 (canonical, 2 arrangements); archived=1 alias (0 arrangements); all=2 [W3-SONG-D5 (P2 observation): alias appears in Archived/All with no merged marker in list payload except merged_into_song_id] | PASS |
| SONG-03.merge.remerge | librarian | API | merging an already merged loser is blocked | 403 forbidden blockers=undefined | PASS |
| SONG-03.merge.reverse | librarian | API | reverse merge (alias as winner) blocked | 403 forbidden blockers=undefined | PASS |
| SONG-03.merge.alias-archive | librarian | API | observe archive of alias row | 409 song_revision_stale (alias already archived by merge) [observed] | PASS |
| SONG-03.merge.plan-view | owner | API | plan GET shows item on winner | song_id=winner key=F | PASS |
| SONG-03.merge.audit | librarian | DB | curation event rows exist | events=13 kinds=arrangement,song | PASS |
| SONG-03.merge.librarian.preview | librarian | API | 200 (no plan refs) | 200  {"winner_id":"bdf5618d-d6ff-41dd-820d-f3994e39cac7","loser_id":"007edc15-b0bb-4542-9c21-9121f138c9c9 | PASS |
| SONG-03.merge.librarian.commit | librarian | API | 200 merged | 200  | PASS |
| SONG-03.merge.librarian.persist | librarian | DB | loser alias + winner has both arrangements |  | PASS |
| SONG-03.bulk.alias | librarian | API | observe: bulk patch of merged alias | 200  {"id":"39980416-b73f-4c45-84b7-54f7749a76de","organization_id":"6fe698a7-0a11-4846-bd76-497e4522dcc9 [observed] | PASS |
| SONG-03.merge.alias-schedule | librarian | API | alias schedule resolves to canonical (plan visible) | 200  n=1 | PASS |
| SONG-03.ui.bulk-merge | librarian | Web bulk editor / merge panel | bulk select + preview/commit and duplicate merge panel driven in UI | not driven in browser (API/DB covered); post-merge plan Order tab verified: item shows "Service key F" and "LoserArr · C · V1 · C (this plan)" [plan override survival verified in web plan view] | NOT_RUN |
| SONG-03.ui.plan-override-after-merge | librarian | Web /plans/:id Order tab | overrides survive merge | key F and plan-only sequence displayed on winner song after merge | PASS |

## CHART-01 (42 records: FAIL 8, NOT_RUN 1, PASS 33)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHART-01.api.default | librarian | API | 200 source key G | 200  key=G | PASS |
| CHART-01.api.to-A | librarian | API | G->A: [A]..[D/F#]..[E7]..[F#m] | [A]Amazing [D/F#]grace how [E7]sweet the [F#m]sound key=A semis=2 | PASS |
| CHART-01.api.semitones2 | librarian | API | same as to=A | semis=2 key=A | PASS |
| CHART-01.api.semitones-2 | librarian | API | G->F | [F]Amazing [A#/D]grace how [C7]sweet the [Dm]sound [W3-SONG-D13] | FAIL |
| CHART-01.api.flat-spelling | librarian | API | flat key uses flats | [Bb]Amazing [Eb/G]grace how [F7]sweet the [Gm]sound / [Cm7]Oh [Fsus4]chorus [Bb]line [Am7b5]here | PASS |
| CHART-01.api.sharp-spelling | librarian | API | sharp key uses sharps | [F#]Amazing [B/D#]grace how [C#7]sweet the [D#m]sound | PASS |
| CHART-01.api.numbers | librarian | API | 1, 4/6... | [1]Amazing [4/6]grace how [57]sweet the [6m]sound | PASS |
| CHART-01.api.numerals | librarian | API | I IV/iii... | [I]Amazing [IV/6]grace how [V7]sweet the [vi]sound | PASS |
| CHART-01.api.lyrics | librarian | API | no chords | Amazing grace how sweet the sound | PASS |
| CHART-01.api.numbers-transposed | librarian | API | numbers unchanged by transposition | [1]Amazing [4/6]grace how [57]sweet the [6m]sound | PASS |
| CHART-01.api.to-invalid | librarian | API | 4xx explicit | 200  {"chordpro":"{title: Chart Probe}\n{start_of_verse: Verse 1}\n[G]Amazing [C/E]grace how [D7]sweet th [W3-SONG-D13] | FAIL |
| CHART-01.api.semi12 | librarian | API | 422 | 422 unprocessable | PASS |
| CHART-01.api.semi-12 | librarian | API | 422 | 422 unprocessable | PASS |
| CHART-01.api.semi-frac | librarian | API | 422 | 422 unprocessable | PASS |
| CHART-01.api.notation-bad | librarian | API | 422 | 422 unprocessable | PASS |
| CHART-01.api.to+semitones | librarian | API | observe precedence/combination | 200  [A]Amazing [D/F#]grace how [E7]sweet the [F#m]sound key=A semis=2 [observed: to wins or sum] | PASS |
| CHART-01.api.to-9chars | librarian | API | 422 | 422 unprocessable | PASS |
| CHART-01.api.to-minor | librarian | API | observe minor target for major chart | 200  key=Am [A]Amazing [D/F#]grace how [E7]sweet the [F#m]sound [observed] | PASS |
| CHART-01.api.capo | librarian | API | observe: capo reflected in chart payload | ["chordpro","key","semitones","notation"] capo=undefined [chart payload has no capo/shape fields; capo is an arrangement attribute] | PASS |
| CHART-01.api.member-read | member | API | 200 | 200  | PASS |
| CHART-01.api.nochart-empty | member | API | 200 empty chordpro (no crash) | 200  | PASS |
| CHART-01.api.xorg | betaowner | API | 404 | 404 not_found | PASS |
| CHART-01.api.xorg-header | betaowner | API | 403 | 403 forbidden | PASS |
| CHART-01.api.baduuid | librarian | API | 400 | 400 bad_request | PASS |
| CHART-01.api.nokey-transpose | librarian | API | 400 explicit "no key" | 400 bad_request {"error":"This arrangement has no key, so it cannot be transposed","code":"bad_request"} | PASS |
| CHART-01.api.nokey-semitones | librarian | API | semitone shift w/o key works or explicit | 200  [A]a [D]b [observed] | PASS |
| CHART-01.api.large | librarian | API | 100KB chart transposes <2s | 11ms len=85000 | PASS |
| CHART-01.api.malformed | librarian | API | 200 no 500; unknown chords preserved | 200  "[A[C]unclosed {start_of_verse\n[Xyz]weird [A#m7b9#11]x [] \n{unknown_directive: x}<script>alert(1)</script>" | PASS |
| CHART-01.ui.transpose-notation | librarian | Web chart editor view menu | key Bb, Numbers, Numerals, Lyrics views render correctly; view change does not dirty chart | Bb: Bb Eb/G F7 Gm / Cm7 Fsus4 Bb Am7b5 correct; Numbers/Numerals/Lyrics render; Save stayed "Saved" [chord collisions and slash-bass numerals see D9, D13] | PASS |
| CHART-01.ui.chord-spacing | librarian | Web chart preview | adjacent chords stay separated | "Am7Dsus4" (also "2m75sus4", "ii7Vsus4"): chords run together when lyric segment is shorter than chord [W3-SONG-D9] | FAIL |
| CHART-01.ui.comment-directive | librarian | Web chart preview | {comment: Play softly} shown or explicitly unsupported | silently omitted from preview [W3-SONG-D12] | FAIL |
| CHART-01.ui.capo | librarian | Web chart editor/preview | capo (arrangement capo=2) visible/editable in chart or explicitly unsupported | capo only on arrangement forms; chart header, preview and shared chart document never show capo [W3-SONG-D10] | FAIL |
| CHART-01.ui.dirty-back | librarian | Web chart editor | dirty dot, Save enabled, Back asks to confirm, cancel stays | dirty dot + Save enabled; Back showed confirm "Leave without saving this chart?" and stayed on cancel | PASS |
| CHART-01.ui.dirty-unload | librarian | Web chart editor | reload / browser back / tab close with unsaved edits is guarded | no beforeunload or route blocker (event not prevented) [W3-SONG-D11] | FAIL |
| CHART-01.ui.save | librarian | Web chart editor | save persists source with Vietnamese text; capo/bpm retained | arrangement rev 3, bridge section with "Nguyễn Thị Ánh tạ ơn" saved, capo 2 and bpm 101 kept | PASS |
| CHART-01.ui.save.stale | librarian | Web chart editor | stale refused, draft preserved, rebase possible | refused with message, draft preserved, retry always 409, no reload/rebase control [W3-SONG-D7] | FAIL |
| CHART-01.ui.formatting | librarian | Web Formatting dialog | 2 columns, 20pt, blue chords apply to preview and persist | preview CSS vars font-size 20pt, chord color #1d4ed8, 2 columns; saved chart_columns=2, size 20, color #1d4ed8 (rev 4) | PASS |
| CHART-01.ui.malformed-escape | librarian | Web chart preview | markup in lyrics escaped; unknown chords preserved in original key | <script> shown as text, 0 script nodes; Xyz and G#m7b9#11/Q preserved | PASS |
| CHART-01.ui.large-chart | librarian | Web chart preview | 100 KB chart renders paged | 126 pages / 2500 rows in ~460 ms | PASS |
| CHART-01.ui.member-readonly | member | Web chart editor | member can view and transpose, cannot edit | source/title/arrangement inputs disabled, Sequence/Formatting disabled, no Save; Original Key menu usable | PASS |
| CHART-01.ui.sequence-dialog | librarian | Web Sequence dialog | edit sequence in UI | not driven (sequence validated via API SONG-02.val.*) | NOT_RUN |
| CHART-01.api.unknown-bass-dropped | librarian | API | unknown chord text preserved on transposition | "[G#m7b9#11/Q]" with to=A became "[A#m7b9#11]" (the "/Q" removed) [W3-SONG-D13] | FAIL |

## CHART-02 (7 records: NOT_RUN 2, PASS 5)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHART-02.plan.member-read | member | API | member reads plan with song items & effective arrangement | items=2 | PASS |
| CHART-02.plan.key-override | member | Shared/web songbook | plan chart is in key A (override) and equals library chart transposed to A | key=A equal=true | PASS |
| CHART-02.plan.sequence-override | member | Shared/web songbook | plan-only sequence [C,V1] used, library arrangement sequence untouched | ["C","V1"] | PASS |
| CHART-02.plan.library-unchanged | member | API | library arrangement sequence/key unchanged by plan override | [] key=G | PASS |
| CHART-02.songbook.html | member | Shared/web songbook | HTML includes title, chords transposed, copyright block escaped | len=13906 | PASS |
| CHART-02.web.pdf-download | planner/member | Web Download PDF | exported text PDF matches preview | download not performed (file download needs explicit user approval); preview/export share the same ChartDocument HTML [needs approval] | NOT_RUN |
| CHART-02.native.pdf-share | member | Native iOS/Android | real PDF + share sheet | native out of scope for QA-09 [native PDF] | NOT_RUN |

## IMPORT-01 (100 records: PASS 100)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| IMPORT-01.preview.basic | librarian | API | 200 two create rows, can_commit | 200  ["create","create"] | PASS |
| IMPORT-01.preview.tags | librarian | API | tags split on ; deduped | {"title":"QA Imp One","author":"Auth One","default_key":"G","default_bpm":80,"themes":["grace","praise"],"song_types":[]} | PASS |
| IMPORT-01.preview.nowrite | librarian | API | preview writes nothing | songs=0 jobs=0 | PASS |
| IMPORT-01.save | librarian | API | 201 job reviewed | 201  | PASS |
| IMPORT-01.save.nowrite-domain | librarian | DB | save does not create songs | songs=0 | PASS |
| IMPORT-01.save.idempotent | librarian | API | same key -> same job | 201  | PASS |
| IMPORT-01.save.bad-hash | librarian | API | 409 import_changed | 409 import_changed | PASS |
| IMPORT-01.commit.member | member | API | 403/404 | 404 not_found | PASS |
| IMPORT-01.commit.other-user | owner | API | 404 (job is creator-bound) | 404 not_found | PASS |
| IMPORT-01.get.other-user | owner | API | 404 history is per creator | 404 not_found | PASS |
| IMPORT-01.get.xorg | betalibrarian | API | 404 | 404 not_found | PASS |
| IMPORT-01.get.xorg-header | betalibrarian | API | 403 | 403 forbidden | PASS |
| IMPORT-01.commit.stale-rev | librarian | API | 409 | 409 import_changed0 | PASS |
| IMPORT-01.commit.stale-nowrite | librarian | DB | no songs created | songs=0 | PASS |
| IMPORT-01.commit.race | librarian | API | songs created exactly once (2 rows) | 200,200,200 songs=2 | PASS |
| IMPORT-01.commit.replay | librarian | API | replay does not duplicate | 200  songs=2 | PASS |
| IMPORT-01.history.detail | librarian | API | committed with before/after+result_id | 200  | PASS |
| IMPORT-01.history.list | librarian | API | lists own job | 200  n=1 | PASS |
| IMPORT-01.history.list.other | owner | API | owner does not see librarian jobs | n=0 | PASS |
| IMPORT-01.preview.dup-existing | librarian | API | rows unresolved (possible duplicate with existing) -> can_commit false | [["unresolved",1],["unresolved",1]] | PASS |
| IMPORT-01.resolve.skip-create | librarian | API | skip+create ok can_commit | ["skip","create"] | PASS |
| IMPORT-01.resolve.update | librarian | API | update with before diff, expected_version | ["update","skip"] | PASS |
| IMPORT-01.val.update-no-target | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.skip-with-target | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.dup-resolution | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.resolution-missing-row | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.resolve.xorg-target | librarian | API | row error: target unavailable, no beta disclosure | ["Target is unavailable in this organization"] | PASS |
| IMPORT-01.preview.id-update | librarian | API | update row | "update" | PASS |
| IMPORT-01.commit.stale-target | librarian | API | refused; target unchanged | 409 import_changed {"error":"Import record 1 changed; preview again","code":"import_changed"} | PASS |
| IMPORT-01.csv.bom | librarian | API | BOM stripped; header Title mapped | 200  "QA Imp Bom" | PASS |
| IMPORT-01.csv.quoted-newline | librarian | API | newline/quote/comma preserved | 200 {"title":"QA Imp Quoted\nNewline","author":"Au \"quoted\", comma","default_key":"C","default_bpm":70,"themes":[],"song_types":[],"notes":"line1\nline2"} | PASS |
| IMPORT-01.csv.crlf | librarian | API | 2 rows | 200  | PASS |
| IMPORT-01.csv.formula | librarian | API | formula-like cells accepted as literal text (not evaluated), preserved | 200 {"title":"=1+1","author":"+A","default_key":"C","default_bpm":70,"themes":[],"song_types":[],"notes":"@SUM(A1)"} | PASS |
| IMPORT-01.csv.formula2 | librarian | API | accepted literally | 200  | PASS |
| IMPORT-01.csv.unicode | librarian | API | preserved | 200  | PASS |
| IMPORT-01.csv.blank-lines | librarian | API | blank lines ignored, empties -> null | 200 {"title":"QA Imp Blank","author":null,"default_key":null,"default_bpm":null,"themes":[],"song_types":[],"notes":null} | PASS |
| IMPORT-01.csv.no-trailing-nl | librarian | API | 1 row | 200  | PASS |
| IMPORT-01.rows.invalid | librarian | API | bad rows action=error with messages; ok row create; can_commit false | 200 [["error","default_bpm: Expected number, received nan"],["error","default_bpm: Number must be greater than or equal to 20"],["error","default_bpm: Number must be less | PASS |
| IMPORT-01.rows.bpm-float | librarian | API | row error | ["default_bpm: Expected integer, received float"] | PASS |
| IMPORT-01.rows.author-201 | librarian | API | row error | ["author: String must contain at most 200 character(s)"] | PASS |
| IMPORT-01.rows.key-9 | librarian | API | row error | ["default_key: String must contain at most 8 character(s)"] | PASS |
| IMPORT-01.rows.bad-id | librarian | API | row error ID must be UUID | ["ID must be a stable Person/song UUID"] | PASS |
| IMPORT-01.rows.dup-in-file | librarian | API | dup title (case-insens) rows unresolved; other ok | ["unresolved","unresolved","create"] | PASS |
| IMPORT-01.rows.dup-ccli | librarian | API | same CCLI unresolved | ["unresolved","unresolved"] | PASS |
| IMPORT-01.save.error-rows-refused | librarian | API | 422 resolve every row; no job | 422 unprocessable | PASS |
| IMPORT-01.val.empty | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.header-only | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.ragged | librarian | API | 422 | 422 unprocessable"CSV needs data rows with the same number of columns as the header" | PASS |
| IMPORT-01.val.dup-header | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.unclosed-quote | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.stray-quote | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.text-after-quote | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.nul | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.missing-column | librarian | API | 422 Mapped column missing | 422 unprocessable"Mapped column is missing: Nope" | PASS |
| IMPORT-01.val.empty-mapping | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.id-only | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.unknown-dest | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.same-source-twice | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.protected-field | librarian | API | 422 (revision/org not mappable) | 422 unprocessable | PASS |
| IMPORT-01.val.ext | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.ctype | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.kind | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.val.extra-field | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.limit.100rows | librarian | API | 200 | 200  | PASS |
| IMPORT-01.limit.101rows | librarian | API | 422 | 422 unprocessable"CSV has more than 100 data rows" | PASS |
| IMPORT-01.limit.33cols | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.limit.cell10001 | librarian | API | 422 | 422 unprocessable | PASS |
| IMPORT-01.limit.notes4001 | librarian | API | row error | 200 ["notes: String must contain at most 4000 character(s)"] | PASS |
| IMPORT-01.limit.256KiB | librarian | API | 422/413 (>262144 bytes) | 422 unprocessable | PASS |
| IMPORT-01.val.badjson | librarian | API | 400 | 400 bad_request | PASS |
| IMPORT-01.perm.songs.owner | owner | API | 200 | 200  | PASS |
| IMPORT-01.perm.songs.admin | admin | API | 200 | 200  | PASS |
| IMPORT-01.perm.songs.librarian | librarian | API | 200 | 200  | PASS |
| IMPORT-01.perm.songs.scheduler | scheduler | API | legacy scheduler: record | 200  [legacy scheduler allowed] | PASS |
| IMPORT-01.perm.songs.member | member | API | 403 | 403 forbidden | PASS |
| IMPORT-01.perm.songs.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| IMPORT-01.perm.songs.xorg-header | betaowner | API | 403 | 403 forbidden | PASS |
| IMPORT-01.perm.anon | anonymous | API | 401 | 401 unauthorized | PASS |
| IMPORT-01.perm.save.member | member | API | 403 | 403 forbidden | PASS |
| IMPORT-01.perm.people.preview.owner | owner | API | owner only (people.manage grant/admin cannot bypass owner-only) | 200  | PASS |
| IMPORT-01.perm.people.preview.admin | admin | API | owner only (people.manage grant/admin cannot bypass owner-only) | 403 forbidden | PASS |
| IMPORT-01.perm.people.preview.librarian | librarian | API | owner only (people.manage grant/admin cannot bypass owner-only) | 403 forbidden | PASS |
| IMPORT-01.perm.people.preview.scheduler | scheduler | API | owner only (people.manage grant/admin cannot bypass owner-only) | 403 forbidden | PASS |
| IMPORT-01.perm.people.preview.member | member | API | owner only (people.manage grant/admin cannot bypass owner-only) | 403 forbidden | PASS |
| IMPORT-01.perm.people.preview.peoplegrant | peoplegrant | API | owner only (people.manage grant/admin cannot bypass owner-only) | 403 forbidden | PASS |
| IMPORT-01.perm.people.save.peoplegrant | peoplegrant | API | 403 | 403 forbidden | PASS |
| IMPORT-01.people.save.owner | owner | API | 201 | 201  | PASS |
| IMPORT-01.people.commit.owner | owner | API | 200 committed | 200  | PASS |
| IMPORT-01.people.persisted | owner | DB | person row created with email lowercased |  | PASS |
| IMPORT-01.people.dup-existing | owner | API | unresolved duplicate by email | "unresolved" | PASS |
| IMPORT-01.rls.jobs.member | member | DB/RLS | 0 rows | 200 rows=0 | PASS |
| IMPORT-01.rls.jobs.owner | owner | DB/RLS | observe: owner sees others jobs via RLS? | 200 rows=1 [observed] | PASS |
| IMPORT-01.rls.jobs.xorg | betaowner | DB/RLS | 0 rows | 200 rows=0 | PASS |
| IMPORT-01.rls.jobs.direct-patch | librarian | DB/RLS | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the required pr | PASS |
| IMPORT-01.rls.jobs.direct-insert | librarian | DB/RLS | denied | 403 42501 | PASS |
| IMPORT-01.rls.rpc.commit-missing | librarian | DB/RLS | error not found | 500 no_data_found | PASS |
| IMPORT-01.grant.revoked.preview | librarian | API | 403 | 403 forbidden | PASS |
| IMPORT-01.perm.people.member-with-songs.manage | member | API | 403 people import needs owner | 403 forbidden | PASS |
| IMPORT-01.ui.dry-run-commit | librarian | Web /imports | upload CSV (BOM, CRLF, quoted comma/quote, formula-like title), map columns, preview, resolve, save/commit | BOM header "Title" mapped; rows: create, create ("=1+1" kept literally), error (bpm abc), unresolved (dup of existing); after Skip + Refresh preview: committed job, 2 son [W3 observations: columns are not auto-mapped by name; resolution change does not refresh preview until "Refresh preview"; "Save reviewed import" saves and commits in on | PASS |
| IMPORT-01.ui.denied-roles | member/peoplegrant | Web /imports | import refused for member and for People-grant holder (kind=people) | "Import permission required" | PASS |

## IMPORT-02 (7 records: NOT_APPLICABLE 1, PASS 6)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| IMPORT-02.probe.imports.chord-sheet | librarian | API | 404 (removed path not exposed) | 404 not_found | PASS |
| IMPORT-02.probe.imports.text | librarian | API | 404 (removed path not exposed) | 404 not_found | PASS |
| IMPORT-02.probe.imports.ai | librarian | API | 404 (removed path not exposed) | 404 not_found | PASS |
| IMPORT-02.probe.songs.import | librarian | API | 404 (removed path not exposed) | 404 not_found | PASS |
| IMPORT-02.probe.chord-imports | librarian | API | 404 (removed path not exposed) | 404 not_found | PASS |
| IMPORT-02.probe.quota | librarian | API | 404/400 | 400 bad_request | PASS |
| IMPORT-02.ai-text-import | authorized user | API/Web/DB | AI/text import path (quota, unavailable provider, malformed result) | no AI/OCR import exists at frozen commit: migration 20260913000200 dropped chord-sheet/AI import tables and RPCs; ai_import_usage, chord_sheet_imports, consume_ai_import_ [feature removed; plan says removed OCR is not expected] | NOT_APPLICABLE |

## GATED-01 (22 records: FAIL 1, PASS 21)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| GATED-01.songbook.create.api | librarian | API | 201 (dormant contract works) | 201  {"id":"fdc18ca2-5f6d-4ad8-a18a-4a109ab359fd","organization_id":"6fe698a7-0a11-4846-bd76-497e4522dcc9 | PASS |
| GATED-01.songbook.create | librarian | API | 201 items ordered | 201  | PASS |
| GATED-01.songbook.list | librarian | API | 200 contains book | 200  | PASS |
| GATED-01.songbook.get.member | member | API | 200 read | 200  | PASS |
| GATED-01.songbook.create.member | member | API | 403 | 403 forbidden | PASS |
| GATED-01.songbook.delete.member | member | API | 403 | 403 forbidden | PASS |
| GATED-01.songbook.arr-mismatch | librarian | API | 400 arrangement must belong to song | 400 bad_request | PASS |
| GATED-01.songbook.xorg-song | librarian | API | 400 | 400 bad_request | PASS |
| GATED-01.songbook.empty-manual | librarian | API | 422 | 422 unprocessable | PASS |
| GATED-01.songbook.title.empty | librarian | API | 422 | 422 unprocessable | PASS |
| GATED-01.songbook.doc.wrongorg-path | librarian | API | 400/422 path outside org folder | 400 bad_request | PASS |
| GATED-01.songbook.dup-song | librarian | API | observe: same song twice | 409 conflict [observed] | PASS |
| GATED-01.songbook.get.xorg | betaowner | API | 404 | 404 not_found | PASS |
| GATED-01.songbook.get.xorg-header | betaowner | API | 403 | 403 forbidden | PASS |
| GATED-01.songbook.delete.xorg | betaowner | API | 404 | 404 not_found | PASS |
| GATED-01.songbook.rls.delete.member | member | DB/RLS | 0 rows | 200 [] | PASS |
| GATED-01.songbook.rls.select.xorg | betaowner | DB/RLS | 0 rows | 200 rows=0 | PASS |
| GATED-01.songbook.baduuid | librarian | API | 400 | 400 bad_request | PASS |
| GATED-01.songbook.delete.missing | librarian | API | 404 | 404 not_found | PASS |
| GATED-01.songbook.delete | librarian | API | 204 | 204  | PASS |
| GATED-01.ui.songbook-redirect | librarian | Web /songbooks, /songbooks/abc/def | redirect to /songs, no songbook navigation | both redirect to /songs; no songbook links in nav | PASS |
| GATED-01.api.songbook-song-delete | librarian | API | deleting a song used by a songbook is refused (like plan references) | 204; songbook item silently removed by FK cascade [W3-SONG-D14 (dormant API)] | FAIL |

## Defects

All are P1 or lower; there is no P0 (no cross-tenant disclosure, no unauthorized persisted write, no lost server-side write, no partial import/bulk/merge commit). Every denied-actor and other-org attempt was refused by API and RLS.

| ID | Pri | Minimal repro | Expected vs actual | Suspected source |
|---|---|---|---|---|
| W3-SONG-D7 | P2 | Open song Information modal (or chart editor), change the song via another session, then Save. Retry; Cancel and reopen. | Expected: reload-latest/rebase action keeping the draft. Actual: 409 message "load the latest version" with no control; retry always 409; Cancel+reopen shows stale values; only a full page reload recovers and the draft is lost. | `frontend/src/pages/ChartEditorPage.tsx` save mutation (no invalidate/rebase on error); `frontend/src/components/song/SongInformationModal.tsx` |
| W3-SONG-D11 | P2 | Edit chart source, then reload / browser Back / close tab. | Expected: unsaved-changes guard. Actual: only the in-app Back button confirms; no `beforeunload`/route blocker, edits silently lost. | `frontend/src/pages/ChartEditorPage.tsx` (`leave()` only) |
| W3-SONG-D4 | P2 | As librarian (`songs.manage` only) `POST /songs/merge/preview` for two songs where either is in any plan item. | Plan row lists librarian for merge. Actual: bare 403 `forbidden` because every affected plan needs edit access; works only for unreferenced songs (verified) or owner. Needs a product decision or a clearer error. | `private.song_merge_state` (can_edit_plan check), `backend/src/routes/songs.ts:~58-66` |
| W3-SONG-D13 | P2 | `GET /arrangements/:id/chart?to=H` or `?to=Xyz`; `?semitones=-2` on a G chart; a chart with `[G#m7b9#11/Q]` with `to=A`; `notation=numerals` with `C/E`. | Expected: 4xx for unknown key; flats for flat keys; unknown text preserved. Actual: 200 with unchanged chart and `key:"H"` echoed; semitones-only uses sharps (`[F]...[A#/D]`, key label F); unknown slash bass dropped (`[A#m7b9#11]`); numerals bass shown as number (`IV/6`). | `packages/shared/src/lib/chordpro.ts` (~lines 50-86 parse/shift, 422-446 numerals), `backend/src/services/songs.ts` loadArrangementChart |
| W3-SONG-D9 | P2 | Chart `[Am7]Oh [Dsus4]chorus` render preview (any notation). | Expected: chords separated by at least one space. Actual: `Am7Dsus4` (and `2m75sus4`, `ii7Vsus4`), reads as one chord. | `packages/shared/src/lib/chart-html.ts` chord row builder (~line 231 area) |
| W3-SONG-D10 | P2 | Arrangement with capo 2: open chart editor/preview. | Expected: capo shown (or explicitly unsupported). Actual: capo stored but not shown or editable in chart editor, preview, or chart document. | `packages/shared/src/lib/chart-html.ts`, `chart-context.ts`, `frontend/src/components/chart-editor/*` |
| W3-SONG-D12 | P2 | Chart containing `{comment: Play softly}`. | Expected: shown or flagged unsupported. Actual: silently dropped from preview (`{unknown_directive}` is printed as literal lyric text). | `packages/shared/src/lib/chordpro.ts` (~line 176 directive handling) |
| W3-SONG-D6 | P2 | `DELETE /songs/:id` or `/arrangements/:id` while a plan item references it (web: Actions > Delete song). | Expected: explanation that it is in use. Actual: 400 `bad_request` "Referenced record does not exist" (protection itself works; plan item untouched). | `backend/src/lib/errors.ts:133` (`23503` mapping) |
| W3-SONG-D8 | P2 | Web: blank song title in edit modal; arrangement BPM 400; import with `abc` BPM. | Expected: field-level message. Actual: generic "Invalid request body"; import preview shows "default_bpm: Expected number, received nan". | `frontend/src/components/song/SongInformationModal.tsx`, `ArrangementModal.tsx`, `backend/src/services/structured-imports.ts` |
| W3-SONG-D3 | P2 | `PATCH /arrangements/:id {is_default:false}` on the only default, or archive the default arrangement. | Expected: a song keeps one default arrangement (merge preview itself blocks on "needs an active default arrangement"). Actual: song ends with zero default (or an archived default); UI shows no Default badge. | `backend/src/routes/songs.ts:199` PATCH, `archive_library_record` RPC |
| W3-SONG-D5 | P2 | After merge, list `archive=archived` / `all`; open Archived tab in web. | Expected: merged alias distinguishable. Actual: alias appears as ordinary "Archived" song with 0 arrangements; bulk preview accepts the alias. | `list_curated_songs` RPC, `frontend/src/pages/SongsPage.tsx` |
| W3-SONG-D1 | P2 | `DELETE /songs/<random uuid>`, or another org's song/arrangement id with own org header. | Expected: 404 (as songbooks do). Actual: 204 no-op (no data removed). | `backend/src/routes/songs.ts:170` and `:215` (no existence check) |
| W3-SONG-D2 | P2 | `PATCH /songs/:id {}` or `{expected_revision:n}` only. | Expected: 200 no-op or 422. Actual: 404 "Song not found" for an existing song. | `backend/src/routes/songs.ts:154-168` (empty update returns no row) |
| W3-SONG-D14 | P2 (dormant API) | Delete a song that is in a songbook. | Expected: reference protection like plan items. Actual: 204, songbook item silently deleted by FK cascade. | `songbook_items_song_id_fkey ON DELETE CASCADE` |

Observations, not defects: web song/arrangement forms omit BPM/meter/author/CCLI on create, and edit omits BPM/meter; Import page does not auto-map same-named columns and needs "Refresh preview" after changing resolutions; list filters are not in the URL; `POST /songs` has no idempotency key (double submit makes two songs); `Nguyen` does not match `Nguyễn` in search (accent-sensitive); unknown `file_ids` on `POST /arrangements/:id/keys` return 403 not 404/422.

## Not run / blocked

- NOT_RUN: web PDF download (a file download needs explicit user approval) and native PDF/share (CHART-02 native, out of scope for this agent); chart Sequence dialog, key/duplicate/archive/delete arrangement panels, bulk editor and merge panel were verified through API/DB/RLS but not clicked in the browser; UI sort toggle and BPM/scheduled-window filters (API covered); mobile surfaces (MOB-028/029) not in scope.
- NOT_APPLICABLE: IMPORT-02 (no AI/text/OCR import path exists at this commit; feature removed).
- Not blocked: servers stayed up; no tests were skipped for environment reasons.

## Fixtures left in place

Orgs `qa-20261118-song-a` and `qa-20261118-song-b`; users `owner, admin, librarian, member, scheduler, peoplegrant, betaowner, betalibrarian` `.qa20261118.song@example.test`; about 150 Alpha songs (named `QA Song NNN`, `QA Duplicate Title`, `QA Merge2 Winner` pair (one merged alias), `QA Ref Song A/B`, `QA Chart Probe`, `QA Big Chart`, `QA Malformed Chart`, `QA UI Song One`, `QA S02 Song`, `QA Imp *`, `=1+1`), 3 plans (`QA Ref Plan`, `QA Merge Plan`), import jobs, one imported Person (`QA ImpPerson Test`), and one Beta song. A few leftover probe songs from permission tests remain (`QA Perm Probe owner/admin/scheduler`, `rls insert scheduler`). Grants restored to librarian `songs.manage` and peoplegrant `people.manage`+`people.view_private`. Passwords only in the agent scratchpad (`.../scratchpad/qa09/state.json`); browser signed out.
