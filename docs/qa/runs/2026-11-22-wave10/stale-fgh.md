# W10-FGH — stale FAIL re-runs, wave 9 API leftovers, scoped reports, large-list SQL, CCLI (wave 10, 2026-11-22)

- Package: **W10-FGH** (plan §5F-§5H case IDs and PERF-01 whose latest recorded status was FAIL; wave 9 NOT_RUN API items; scoped-scheduler report scope at volume; large-list SQL commit d2a5b19/de3ae9a; CCLI on creation 806c5e3). Area file: `stale-fgh`.
- Commit: `f79aa50` (main after PR #129) on `feature/qa-wave10`, frozen. No code, migration, config or .env change.
- Environment: local Supabase `service-center` (shared, **no reset**); API **:4200** from this worktree (simulated email/push). Node 26.13.1. Reruns scripted in Node (fetch) with each actor's own access token against the API and PostgREST; service role / Auth admin only for setup (users, memberships, grants, bulk fixture rows) and for DB-side reads that assert persisted state. Private proxy :4641 + private API :4640 were used only for the Storage-timeout case and were stopped by PID.
- Namespace: orgs `qa-w10-fgh-a` (America/Chicago, main), `qa-w10-fgh-b` (Beta, cross-tenant), `qa-w10-fgh-c` (unused); users `<alias>.qaw10.fgh@example.test` for owner, admin, legacy (legacy scheduler), scoped (Sunday service-type scheduler: plans.edit + scheduling.manage), teamsched (Band team-scoped scheduling.manage), librarian (org songs.manage), media (org media.manage), member, member2, betaowner, betalib (member of B), cowner, cmember. `librarian` is also a member of org B (stale-composer header rows). Secrets only in the scratchpad.
- Fixture shape (org A): 2 service types (Sunday, Midweek), 2 teams (Band: Keys/Drums; Production), 209 people (200 `Vol###` volume people on both teams), 129 plans, 2,418 assignments (12 report-volume plans x 200 + 10 cross-scope Band rows on a Midweek plan), 156 songs, 214 media bundles, 102 conversations, 2 Live runs, 6 files. Org B has one song/media/layout probes only.
- Result statuses: PASS / FAIL / BLOCKED / NOT_RUN / NOT_APPLICABLE. "orig row" = the row (or neighbouring PASS row) from the earlier wave being re-run; "neighbour" = regression row added by this package. Web-only and mobile rows were **not run** (browser owned by W10-WEB; no simulator in scope). Export files, webhooks and emails need the delivery worker (owned by W10-MAIL) and are NOT_RUN.

## Totals

Expanded rows: **339** — PASS 300, FAIL 19, BLOCKED 0, NOT_RUN 20, NOT_APPLICABLE 0. No P0.

## Per-ID roll-up (new latest status)

| Case ID | Previous latest | New latest | Rows P/F/B/NR/NA | Why |
|---|---|---|---|---|
| NOTE-01 | FAIL | **PASS** | 16/0/0/0/0 | Both W3/W7 FAIL rows (item-path edit/delete 404, tie paging) now pass; fixed by W7-MSG-D10 / W7-MSG-D3. Web/mobile halves not run. |
| CHAT-01 | FAIL | **PASS** | 12/0/0/0/0 | Tie paging and hidden-message notification snippet (DB + API) now pass; W7-MSG-D3 / W7-MSG-D4 fixed. Web/mobile halves not run. |
| CHAT-02 | FAIL | **PASS** | 13/0/0/0/0 | All B-header stale-composer rows return 404 with no rows changed; revoked participant no longer sees old snippet; W7-MSG-D2 / W7-MSG-D4 fixed. |
| SONG-01 | FAIL | **FAIL** | 12/2/0/3/0 | W3-SONG-D1 (cross-org 204) fixed; W3-SONG-D2 (empty PATCH -> 404) and W3-SONG-D6 (misleading referenced-delete text) still reproduce: W10-FGH-D1, D2. UI rows NOT_RUN. |
| SONG-02 | FAIL | **FAIL** | 2/1/0/1/0 | Original API FAIL (cross-org arrangement delete 204) now 403; the same misleading referenced-delete text reproduces for arrangements (W10-FGH-D2). UI validation row NOT_RUN. |
| CHART-01 | FAIL | **FAIL** | 6/4/0/5/0 | The three W3-SONG-D13 API rows still reproduce (W10-FGH-D3); UI rows (D7/D9-D12) NOT_RUN: browser owned by W10-WEB. |
| FILE-01 | FAIL | **FAIL** | 11/1/0/1/0 | Signed PUT after abandon still accepted and leaves an orphan object (W3-FILE-D1 -> W10-FGH-D5). All other upload rows pass. |
| FILE-03 | FAIL | **FAIL** | 12/2/0/0/0 | Same-key/different-payload on links and documents still replays the first file with 201 (W3-FILE-D2 -> W10-FGH-D6); NUL body fixed (W3-FILE-D3). |
| MEDIA-01 | FAIL | **PASS** | 12/0/0/0/0 | NUL/lone-surrogate title now 422 (W3-FILE-D3 fixed); bundle lifecycle, item linking and cross-org rows pass. |
| STAGE-01 | FAIL | **PASS** | 12/0/0/1/0 | NUL template/layout name now 422 (W3-FILE-D3 fixed); template and plan layout rows pass. Web print/UI NOT_RUN. |
| LIVE-01 | FAIL | **PASS** | 16/0/0/1/0 | set_policy after end now 409 with no history appended (W3-LIVE-D1 fixed). |
| LIVE-02 | FAIL | **PASS** | 26/0/0/1/0 | renew after end 409 clean; vacant-lease commands by non-holders 409 (W3-LIVE-D1/D2 fixed); races 10/10, 10/10, 8/8. Web/device rows NOT_RUN. |
| REPORT-01 | FAIL | **PASS** | 23/0/0/0/0 | Participation summary now carries present/absent/unknown (3/2/1, then 4/2/0 after correction); W3-LIVE-D3 / W7-JRN-D1 fixed. |
| REPORT-02 | FAIL | **FAIL** | 10/4/0/3/0 | Truncation signalling and summary-vs-rows now pass (W3-INT-D2 fixed). CSV without UTF-8 BOM still FAIL (W10-FGH-D9, plan/source disagreement, product decision). Export-file rows NOT_RUN (worker owned by W10-MAIL). |
| CAL-02 | FAIL | **FAIL** | 16/3/0/2/0 | Own feed token_hash is still client-writable and a revoked token can still be revived through PostgREST (W3-INT-D1 -> W10-FGH-D7); personal feed still has no revoke without rotate (W3-INT-D9 -> W10-FGH-D8). |
| GATED-01 | FAIL | **FAIL** | 3/1/0/2/0 | Deleting a song used by a songbook still returns 204 and cascades the songbook item (W3-SONG-D14 -> W10-FGH-D4). Web redirect rows NOT_RUN. |
| PERF-01 | FAIL | **PASS** | 11/0/0/0/0 | Conversation list returns all 102 (no 100 cap); schedule report JSON/CSV return 2,000 rows with truncated=true and exact summary (W8-PERF-D2b / D3 fixed). Latencies are on a shared, loaded DB. Web/native PERF rows NOT_RUN. |
| large-list-sql+ccli (extra) | NOT_RUN / n.a. | PASS | 46/0/0/0/0 | Song usage in SQL, media total/truncated, accent-insensitive search, CCLI validation/persistence/permission. |
| scoped-report-scope (extra) | NOT_RUN / n.a. | PASS | 28/0/0/0/0 | Scoped (team / service-type) schedulers: report rows, CSV and totals limited to scope and equal to DB at 2,410 assignments. |
| wave9-api-notrun (extra) | NOT_RUN / n.a. | FAIL (see rows) | 13/1/0/0/0 | Songbook double-delete clean; plan-position double-delete returns 204/204 (W10-FGH-D10); real 60 s Storage timeout PASS. |

Case IDs in the roll-up count FAIL if any re-run row failed; the "Why" column says whether the original rows or only neighbours failed.

## Defects

All still-reproducing items are carry-overs of earlier defects (original ID shown); none is a cross-tenant leak, private/prepared exposure, unauthorized write, lost write or overfill. **No P0.**

| ID | Pri | Orig | Repro | Expected vs actual | Suspected |
|---|---|---|---|---|---|
| W10-FGH-D1 | P2 | W3-SONG-D2 | librarian: `PATCH /songs/:id` body `{}` | 200 no-op or 422 explicit / **404 not_found** (empty update returns no row) | backend/src/routes/songs.ts:154-168 (empty `changes` -> no row -> 404) |
| W10-FGH-D2 | P2 | W3-SONG-D6 | librarian: `DELETE /songs/:id` and `DELETE /arrangements/:id` while a plan item uses them | 409/400 explaining it is in use / **400 "Referenced record does not exist"** (protection works, wording wrong; web banner shows it) | backend/src/lib/errors.ts:204 (23503 mapping), routes/songs.ts:170,218 |
| W10-FGH-D3 | P2 | W3-SONG-D13 | librarian: `GET /arrangements/:id/chart?semitones=-2` on a G chart; `?to=H` / `?to=Xyz`; chart containing `[G#m7b9#11/Q]` with `to=A` | Flat key spells flats (Bb/D), unknown key 4xx, unknown chord text kept / semitones-only emits **A#/D**, invalid `to` returns **200** unchanged, `/Q` bass **dropped** (`[A#m7b9#11]`) | packages/shared/src/lib/chordpro.ts:70-110; backend/src/services/songs.ts loadArrangementChart |
| W10-FGH-D4 | P2 (dormant API) | W3-SONG-D14 | librarian: create songbook with song S, `DELETE /songs/S` | refused like plan references / **204**, songbook item silently removed | songbook_items.song_id FK ON DELETE CASCADE (migration 20260905000100); routes/songs.ts:170 |
| W10-FGH-D5 | P2 | W3-FILE-D1 | media-editor: upload intent -> `POST /files/:id/abandon` -> signed PUT with the intent token | PUT rejected, no object / abandon 200, **PUT 200, object stored** (attachment row gone: orphan Storage object, 3 left in my org prefix) | abandon_file_version (20261030000000_f13_files.sql:911) does not invalidate the signed upload; backend/src/services/files.ts:301 |
| W10-FGH-D6 | P2 | W3-FILE-D2 | media-editor: `POST /files/links` (and `/files/documents`) twice with the same idempotency_key but a different url/body | 409 idempotency_key_reused / **201 replay of the first file** (second payload dropped) | save_file_content replay branch (20261031000100_f14_rehearsal_media_stage.sql:669, f13_files.sql:1008-1016) does not compare payload |
| W10-FGH-D7 | P2 | W3-INT-D1 | member (own JWT): PostgREST `PATCH calendar_feed_tokens?id=eq.<own>` {token_hash:...}; revoke current via PATCH then `PATCH old revoked_at=null` | server-generated hash, revoked token stays dead / **hash overwritten (200), revoked URL serves again (200)**; own-row only (cross-user PATCH 0 rows, select 0 rows) | policies calendar_feed_tokens_update/insert + column grants (20260906000000_assignment_notifications.sql:58-62); routes/me.ts:119-129 writes via the caller JWT |
| W10-FGH-D8 | P2 | W3-INT-D9 | member: `DELETE/PUT/PATCH /me/calendar-feed` | a way to revoke without issuing a replacement / **404** (only POST = rotate) | backend/src/routes/me.ts:112-129 |
| W10-FGH-D9 | P2 (product decision) | W3-INT-D3 | owner: `GET /reports/{staffing,participation,schedule,song-usage}?format=csv` | UTF-8 BOM (wave 3 expectation) / no BOM; **note: plan §5H REPORT-02 text does not list BOM (only §5G IMPORT-01 does)** — plan/source disagreement, needs a product call before this counts as a defect | packages/shared/src/lib/reports.ts reportToCsv; backend/src/routes/reports.ts:25-29; report-exports.ts upload |
| W10-FGH-D10 | P2 | new (wave 9 NOT_RUN) | Two sessions `DELETE /plans/:id/positions/:pid` at once (15 iterations) | one 204 + one 404 / **both 204** (never 500, row gone). Sequential second delete is 404. Concurrent vs assignment create: delete wins, assignment gets 400, nothing orphaned | public.delete_plan_position reads the row without FOR UPDATE and never checks the delete count (migration 20261018000100_f02_guest_staffing.sql:126); routes/plans.ts:367 |

Observation, not a new defect: an asynchronous report export builds the same capped report (REPORT_ROW_LIMIT 2,000, `row_count = report.rows.length`, CSV carries the "Truncated" line), so the W3 expectation "export of 2,400 rows contains all 2,400" is unmet by design; the file itself could not be verified without the worker.

## Not run / blocked

- CHART-01.ui.chord-spacing — not run: browser owned by W10-WEB
- CHART-01.ui.comment-directive — not run: browser owned by W10-WEB
- CHART-01.ui.capo — not run: browser owned by W10-WEB
- CHART-01.ui.dirty-unload — not run: browser owned by W10-WEB
- CHART-01.ui.save.stale — not run: browser owned by W10-WEB
- SONG-01.ui.edit.stale — not run: browser owned by W10-WEB
- SONG-01.ui.edit.validation — not run: browser owned by W10-WEB
- SONG-01.ui.delete.referenced — not run: browser owned by W10-WEB
- SONG-02.ui.arrangement.validation — not run: browser owned by W10-WEB
- GATED-01 web songbook routes redirect to /songs — not run: browser owned by W10-WEB; no native in scope
- GATED-01 mobile no songbook route — not run: browser owned by W10-WEB; no native in scope
- STAGE-01.web.print/ui — not run: browser owned by W10-WEB
- FILE-01.native.upload — not run: native out of package scope
- LIVE-02.poll-network-loss.web+mobile — not run: browser owned by W10-WEB; physical devices unavailable
- LIVE-01.surface.web/mobile — not run: browser owned by W10-WEB; mobile out of scope
- REPORT-02.oa.export.full-not-truncated — export queued; processing needs the delivery worker (owned by W10-MAIL). Source: backend/src/services/report-exports.ts builds with the same buildReport capped at REPORT_ROW_LIMIT=2000 and sets row_count=report.rows.length, so the file is expected to hold 2000 rows + Truncated notice
- REPORT-02.oa.export.file-bom — export file needs worker (owned by W10-MAIL); source: same reportToCsv, no BOM added
- REPORT-02.web-mobile.print-share-ui — not run: browser owned by W10-WEB; mobile out of scope
- CAL-02.web.feed-ui — not run: browser owned by W10-WEB; native out of scope
- CAL-02.mobile.subscribe/share — not run: browser owned by W10-WEB; native out of scope
- Wave 9 NOT_RUN "private-address webhook rejection with INTEGRATION_SECRET_KEY" is out of this package (webhook/worker path, W10-MAIL).
- Two report exports (`schedule`, org A; one requested by owner, one by scoped) stay **queued** because the worker was not run by this package; their content scope (scoped export) and 2,000-row cap are therefore unverified.
- Physical-device and Android rows (LIVE-02, CAL-02 subscribe/share, FILE-01 native) not in scope.

## Fixtures left in place

- Orgs `qa-w10-fgh-{a,b,c}`; 13 users `*.qaw10.fgh@example.test`; grants (librarian songs.manage, media media.manage, scoped plans.edit+scheduling.manage on Sunday, teamsched scheduling.manage on Band).
- Org A data: 209 people, 129 plans (12 volume plans renamed with formula-prefix titles FGHF0-7), 2,418 assignments, 156 songs, 214 media bundles, 102 conversations (+ messages/comments/reports), Live runs: 2 (one ended, one live/vacant after races), files: 6 (links, documents, PDFs), songbooks: none left.
- **Storage objects**: 3 objects in bucket `attachments` under prefix `e85459fd-a234-438f-b33a-d7aaf4f0c51d/` (one is the orphan from W10-FGH-D5; two from unfinalized/timeout intents).
- **Report exports**: 2 rows `queued` (ids 170b0073-abe8-405c-b824-8d7de4c8a22a, 4fef19ef-f7ee-4978-a420-ac4f20b919eb); no files.
- **Live occurrences**: 2 runs on plan `0adbc77b-91d1-4547-b24d-6878b6823ef7`.
- Calendar feed tokens (member live token; revoked history), scoped feeds revoked. A temporary `attendance_records` oracle on plan "FGH D14 plan": present 3, absent 2, unknown 1.
- Private API :4640 and proxy :4641 stopped (by PID); `proxy.mode` and logs only in the scratchpad.

## Result rows

Columns: row ID | orig row (earlier wave) | orig defect | actor | surface | expected | actual | status.

### NOTE-01 (P 16 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| NOTE-01.comment.create | W7 PASS neighbour | - | member | API | 201 | 201 | PASS |
| NOTE-01.comment.edit.wrong-item-in-path.API+DB | NOTE-01.comment.edit.wrong-item-in-path.API (w3) / .API+DB (w7) | W3-MSG-D1 / W7-MSG-D10 | member | API+DB | 404 and comment unchanged | 404 body=author comment | PASS |
| NOTE-01.comment.delete.wrong-item-in-path.API+DB | NOTE-01.comment.delete.wrong-item-in-path (w3,w7) | W3-MSG-D1 / W7-MSG-D10 | member | API+DB | 404 and not deleted | 404 deleted=f | PASS |
| NOTE-01.comment.edit.author | neighbour | - | member | API | 200 | 200 | PASS |
| NOTE-01.comment.edit.non-author | neighbour | - | owner | API | 403/404, unchanged | 403 body=edited right | PASS |
| NOTE-01.comment.create.nonparticipant-member | neighbour | - | member2 (no assignment) | API | record outcome | 404 | PASS |
| NOTE-01.comment.pagination.identical-created_at-ties.limit2.API | NOTE-01.comment.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | owner | API+DB | all 5 tied comments each exactly once | seen=5/5 dup=0 pages=3 | PASS |
| NOTE-01.comment.pagination.identical-created_at-ties.limit3.API | NOTE-01.comment.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | owner | API+DB | all 5 tied comments each exactly once | seen=5/5 dup=0 pages=2 | PASS |
| NOTE-01.comment.pagination.identical-created_at-ties.limit1.API | NOTE-01.comment.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | owner | API+DB | all 5 tied comments each exactly once | seen=5/5 dup=0 pages=5 | PASS |
| NOTE-01.note.create | neighbour | - | owner | API | 201 | 201 | PASS |
| NOTE-01.note.create.replay-same-key | neighbour | - | owner | API | 200 same id | 200 same=true | PASS |
| NOTE-01.note.create.same-key-other-body | neighbour | - | owner | API | 409 | 409 | PASS |
| NOTE-01.note.edit.stale-revision | neighbour | - | owner | API | 409 | 409 | PASS |
| NOTE-01.note.private.hidden-from-member | neighbour | - | member | API | private note absent | absent | PASS |
| NOTE-01.note.create.member-denied | neighbour | - | member | API | 403 | 403 | PASS |
| NOTE-01.note.delete | neighbour | - | owner | API | 204 | 204 | PASS |

### CHAT-01 (P 12 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| CHAT-01.pagination.identical-created_at-ties.limit2.API | CHAT-01.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | member | API+DB | all 6 tied messages exactly once | seen=6/6 dup=0 pages=3 | PASS |
| CHAT-01.pagination.identical-created_at-ties.limit4.API | CHAT-01.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | member | API+DB | all 6 tied messages exactly once | seen=6/6 dup=0 pages=2 | PASS |
| CHAT-01.pagination.identical-created_at-ties.limit1.API | CHAT-01.pagination.identical-created_at-ties.API (w3,w7) | W3-MSG-D2 / W7-MSG-D3 | member | API+DB | all 6 tied messages exactly once | seen=6/6 dup=0 pages=6 | PASS |
| CHAT-01.send | neighbour | - | member | API | 201 | 201 | PASS |
| CHAT-01.send.duplicate-id-once | neighbour | - | member | API+DB | 200 replay, 1 row | 200 rows=1 | PASS |
| CHAT-01.send.nonparticipant | neighbour | - | member2 | API | 404 | 404 | PASS |
| CHAT-01.moderation.report+hide | neighbour | - | owner | API | 201 then 200 | 201/200 | PASS |
| CHAT-01.moderation.hidden-message.notification-snippet.DB | CHAT-01.moderation.hidden-message.notification-snippet.DB (w7) | W7-MSG-D4 | owner (setup read) | DB (service sql) | 0 notification rows carry hidden text | before=4 after=0 | PASS |
| CHAT-01.moderation.hidden-message.notification-snippet.API | CHAT-01.moderation.hidden-message.notification-snippet.API (w7) | W7-MSG-D4 | owner+member | API | hidden text not in feed | owner=false member=false | PASS |
| CHAT-01.moderation.hidden-message.thread-redacted | neighbour | - | member | API | hidden body not returned | redacted | PASS |
| CHAT-01.read | neighbour | - | member | API | 200 | 200 | PASS |
| CHAT-01.mute | neighbour | - | member | API | 200 muted | 200 {"muted":true} | PASS |

### CHAT-02 (P 13 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| CHAT-02.post.active-org-header.control | neighbour | - | librarian | API | 201 | 201 | PASS |
| CHAT-02.stale-composer.post-B-header.API | CHAT-02.stale-composer.post-B-header.API | W3-MSG-D4 / W7-MSG-D2 | librarian | API+DB | 404, no row | 404 rows=0 | PASS |
| CHAT-02.stale-composer.edit-B-header.API | CHAT-02.stale-composer.edit-B-header.API | W7-MSG-D2 | librarian | API+DB | 404 unchanged | 404 body=lib message in A | PASS |
| CHAT-02.stale-composer.read-B-header.API | CHAT-02.stale-composer.read-B-header.API | W7-MSG-D2 | librarian | API | 404 | 404 | PASS |
| CHAT-02.stale-composer.mute-B-header.API | CHAT-02.stale-composer.mute-B-header.API | W7-MSG-D2 | librarian | API+DB | 404, no state change | 404 muted rows before=0 after=0 | PASS |
| CHAT-02.stale-composer.report-B-header.API.v2 | CHAT-02.stale-composer.report-B-header.API.v2 | W7-MSG-D2 | librarian | API | 404 | 404 | PASS |
| CHAT-02.stale-composer.report-B-header.rows.DB | CHAT-02.stale-composer.report-B-header.rows.DB | W7-MSG-D2 | librarian | DB | no report row | rows=0 | PASS |
| CHAT-02.stale-composer.delete-B-header.API | CHAT-02.stale-composer.delete-B-header.API | W7-MSG-D2 | librarian | API | 404 not deleted | 404 | PASS |
| CHAT-02.stale-composer.persisted.DB | CHAT-02.stale-composer.persisted.DB | W7-MSG-D2 | librarian | DB | target msg intact | deleted=f | PASS |
| CHAT-02.stale-composer.read-thread-B-header | neighbour | - | librarian | API | 404 | 404 | PASS |
| CHAT-02.revoked.stale-notification-snippet.API | CHAT-02.revoked.stale-notification-snippet.API (w3 roster-removal / w7) | W3-MSG-D9 / W7-MSG-D4 | librarian | API | old snippet unavailable after access lost | hadBefore=true stillListed=false | PASS |
| CHAT-02.revoked.read-after-roster-removal | neighbour | - | librarian | API | 404 | 404 | PASS |
| CHAT-02.revoked.post-after-roster-removal | neighbour | - | librarian | API | 404 and no row | 404 | PASS |

### SONG-01 (P 12 / F 2 / B 0 / NR 3 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| SONG-01.create.with-ccli | neighbour (806c5e3) | - | librarian | API+DB | 201, ccli persisted as text | 201 ccli=0022025 | PASS |
| SONG-01.xorg.delete.betalibrarian | SONG-01.xorg.delete.betalibrarian (w3) | W3-SONG-D1 | betalib (org B) | API | 403/404 not 204 | 403 exists=1 | PASS |
| SONG-01.xorg.delete.betaowner | SONG-01.xorg.delete.betaowner (w3) | W3-SONG-D1 | betaowner (org B) | API | 403/404 not 204 | 404 | PASS |
| SONG-01.xorg.delete.betaowner.A-header | neighbour | - | betaowner, org A header | API | 403 | 403 | PASS |
| SONG-01.delete.nonexistent | SONG-01 (W3-SONG-D1 nonexistent) | W3-SONG-D1 | librarian | API | 404 | 404 | PASS |
| SONG-01.patch.empty | SONG-01.patch.empty (w3) | W3-SONG-D2 | librarian | API | 200 noop or 422 explicit (not 404) | 404 | FAIL |
| SONG-01.setup.plan-item | setup | - | owner | API | 201 | 201 {"id":"42b1870a-4003-493a-986d-b507ab2e5386","title":"FGH Probe Song","plan_id": | PASS |
| SONG-01.api.delete.referenced-message | SONG-01.api.delete.referenced-message (w3); SONG-01.ui.delete.referenced wording is the same API message | W3-SONG-D6 | librarian | API | 409/400 with explanation naming the plan use (not "Referenced record does not exist") | 400 {"error":"Referenced record does not exist","code":"bad_request"} | FAIL |
| SONG-01.patch.title.blank.api-details | SONG-01.ui.edit.validation (API half) | W3-SONG-D8 | librarian | API | 422 with field path title | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"title","code":"too_small","message":"String must contain at least 1 character(s)"}]} | PASS |
| SONG-01.patch.stale.409+no-write | neighbour | - | librarian | API+DB | 200 then 409 song_revision_stale, notes=n1 | 200/409 notes=n1 | PASS |
| SONG-01.patch.rebase-resave.after-409 | SONG-01.ui.edit.stale (API half: reload latest revision, re-save succeeds) | W3-SONG-D7 | librarian | API | 200 with latest revision | 200 | PASS |
| SONG-01.patch.member | neighbour | - | member | API | 403 | 403 | PASS |
| SONG-01.read.member | neighbour | - | member | API | 200 | 200 | PASS |
| SONG-01.xorg.idsub.betaowner | neighbour | - | betaowner | API | 404 | 404 | PASS |
| SONG-01.ui.edit.stale | SONG-01.ui.edit.stale (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| SONG-01.ui.edit.validation | SONG-01.ui.edit.validation (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| SONG-01.ui.delete.referenced | SONG-01.ui.delete.referenced (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |

### SONG-02 (P 2 / F 1 / B 0 / NR 1 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| SONG-02.arr.delete.xorg | SONG-02.arr.delete.xorg (w3) | W3-SONG-D1 | betalib (org B) | API | 403/404 not 204 | 403 exists=1 | PASS |
| SONG-02.api.arr-delete.referenced-message | neighbour (D6 arrangement) | W3-SONG-D6 | librarian | API | 409/400 explanation | 400 {"error":"Referenced record does not exist","code":"bad_request"} | FAIL |
| SONG-02.arr.validation.bpm400.api-details | SONG-02.ui.arrangement.validation (API half; UI NOT_RUN) | W3-SONG-D8 | librarian | API | 422 with field path bpm | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"bpm","code":"too_big","message":"Number must be less than or equal to 300"}]} | PASS |
| SONG-02.ui.arrangement.validation | SONG-02.ui.arrangement.validation (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |

### CHART-01 (P 6 / F 4 / B 0 / NR 5 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| CHART-01.api.semitones-2 | CHART-01.api.semitones-2 (w3) | W3-SONG-D13 | librarian | API | G->F; flat key spells flats (Bb/D not A#/D) | 200 key=F [F]Amazing [A#/D]grace how [C7]sweet the [Dm]sound | FAIL |
| CHART-01.api.to-invalid.H | CHART-01.api.to-invalid (w3) | W3-SONG-D13 | librarian | API | 4xx explicit | 200 {"chordpro":"{title: Chart Probe}\n{start_of_verse: Verse 1}\n[G]Amazing [C/E]grace how [D7]sweet th | FAIL |
| CHART-01.api.to-invalid.Xyz | CHART-01.api.to-invalid (w3) | W3-SONG-D13 | librarian | API | 4xx explicit | 200 | FAIL |
| CHART-01.api.unknown-bass-dropped | CHART-01.api.unknown-bass-dropped (w3) | W3-SONG-D13 | librarian | API | unknown chord text preserved (/Q kept) | 200 "{title: x}\n[A#m7b9#11]odd [A/C#]x" | FAIL |
| CHART-01.api.numerals.slash-bass | CHART-01 D13 numerals C/E | W3-SONG-D13 | librarian | API | bass shown as note/numeral ok (record) | 200 [I]Amazing [IV/6]grace how [V7]sweet the [vi]sound | PASS |
| CHART-01.api.transpose.to-A | neighbour | - | librarian | API | 200 key A, {key:} rewritten | 200 key=A [A]Amazing [D/F#]grace how [E7]sweet the [F#m]sound | PASS |
| CHART-01.read.member | neighbour | - | member | API | 200 | 200 | PASS |
| CHART-01.xorg.chart.betaowner | neighbour | - | betaowner | API | 404 | 404 | PASS |
| CHART-01.api.semitones-out-of-range | neighbour | - | librarian | API | 422 | 422 | PASS |
| CHART-01.api.comment-directive-in-payload | CHART-01.ui.comment-directive (API half: payload keeps {comment}) | W3-SONG-D12 | librarian | API | payload includes comment text; capo surfaced | true capo=undefined | PASS |
| CHART-01.ui.chord-spacing | CHART-01.ui.chord-spacing (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| CHART-01.ui.comment-directive | CHART-01.ui.comment-directive (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| CHART-01.ui.capo | CHART-01.ui.capo (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| CHART-01.ui.dirty-unload | CHART-01.ui.dirty-unload (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |
| CHART-01.ui.save.stale | CHART-01.ui.save.stale (w3) | W3-SONG-D7/9/10/11/12/6/8 | librarian | Web UI | see wave 3 | not run: browser owned by W10-WEB | NOT_RUN |

### FILE-01 (P 11 / F 1 / B 0 / NR 1 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| FILE-01.up.plan.intent | neighbour | - | media-editor | API | 201 pending, upload target | 201 pending upload=true | PASS |
| FILE-01.up.plan.PUT+finalize | neighbour | - | media-editor | Storage+API+DB | PUT 200, finalize ready | 200 200 outcome=ready ready | PASS |
| FILE-01.abandon.PUT-after-abandon | FILE-01.abandon.PUT-after-abandon (w3) | W3-FILE-D1 | media-editor | Storage signed PUT | abandon 200; PUT on abandoned intent rejected (no object stored) | abandon=200 PUT=200 {"Key":"attachments/e85459fd-a234-438f-b33a-d7aaf4f0c51d/5224bc47-cb2b-44cb-84e1-68e73a4a3757/a3339624-a2c8-40c8-87ef-5a objectStored=1 version=gone | FAIL |
| FILE-01.finalize-after-abandon | neighbour | - | media-editor | API | 404/409 not ready | 404 | PASS |
| FILE-01.unfinalized-not-downloadable | neighbour | - | member | API | 404/409 not ready | 404 | PASS |
| FILE-01.val.unsupported-mime | neighbour | - | media-editor | API | 422 | 422 | PASS |
| FILE-01.val.zero-byte | neighbour | - | media-editor | API | 422 | 422 | PASS |
| FILE-01.val.over-limit | neighbour | - | media-editor | API | 422 | 422 | PASS |
| FILE-01.up.member-denied | neighbour | - | member | API | 403/404 | 403 | PASS |
| FILE-01.up.xorg | neighbour | - | betaowner (B header) | API | 404 | 403 | PASS |
| FILE-01.up.xorg.B-header-A-plan | neighbour | - | betaowner | API | 404 | 404 | PASS |
| FILE-01.PUT.forged-token | neighbour | - | anon | Storage | 4xx | 400 | PASS |
| FILE-01.native.upload | FILE-01 M surface | - | member | Mobile | - | not run: native out of package scope | NOT_RUN |

### FILE-03 (P 12 / F 2 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| FILE-03.link.create | neighbour | - | media-editor | API | 201 | 201 | PASS |
| FILE-03.link.create.replay-same | neighbour | - | media-editor | API | 200/201 same id | 201 same=true | PASS |
| FILE-03.link.create.key-reuse-different | FILE-03.link.create.key-reuse-different (w3) | W3-FILE-D2 | media-editor | API | 409 idempotency_key_reused | 201 {"id":"304687ba-3e3d-c9f0-2ba4-1bacd6324f03","owner":{"kind":"plan","id":"fb5261b1-5a6f-4364-88db-50 | FAIL |
| FILE-03.doc.create | neighbour | - | media-editor | API | 201 | 201 | PASS |
| FILE-03.doc.create.key-reuse-different | FILE-03 (D2 documents) | W3-FILE-D2 | media-editor | API | 409 | 201 | FAIL |
| FILE-03.doc.create.replay-same | neighbour | - | media-editor | API | replay same id | 201 true | PASS |
| FILE-03.doc.save.unicode+NUL | FILE-03.doc.save.unicode+NUL (w3) | W3-FILE-D3 | media-editor | API | 422 clean (not 500) | 422 {"error":"Text contains unsupported characters","code":"unprocessable"} | PASS |
| FILE-03.doc.save.unicode-ok | neighbour | - | media-editor | API | 200 | 200 | PASS |
| FILE-03.doc.save.stale | neighbour | - | media-editor | API | 409 | 409 | PASS |
| FILE-03.link.url-edit | neighbour | - | media-editor | API | 200 | 200 | PASS |
| FILE-03.link.url-js-scheme | neighbour | - | media-editor | API | 422 | 422 | PASS |
| FILE-03.link.member-denied | neighbour | - | member | API | 403/404 | 403 | PASS |
| FILE-03.archive | neighbour | - | media-editor | API | 200 | 200 | PASS |
| FILE-03.replace.v1-v2 | neighbour | - | media-editor | API+Storage | v2 ready current | 200 ready | PASS |

### MEDIA-01 (P 12 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| MEDIA-01.val.create.title-NUL | MEDIA-01.val.create.title-NUL (w3) | W3-FILE-D3 | media-editor | API | 422 | 422 | PASS |
| MEDIA-01.val.create.title-lone-surrogate | neighbour | W3-FILE-D3 | media-editor | API | 422 | 422 | PASS |
| MEDIA-01.create | neighbour | - | media-editor | API | 201 | 201 | PASS |
| MEDIA-01.edit | neighbour | - | media-editor | API | 200 | 200 | PASS |
| MEDIA-01.edit.stale | neighbour | - | media-editor | API | 409 | 409 | PASS |
| MEDIA-01.create.member-denied | neighbour | - | member | API | 403 | 403 | PASS |
| MEDIA-01.create.librarian-denied | neighbour | - | librarian | API | 403 | 403 | PASS |
| MEDIA-01.item.link | neighbour | - | owner | API | 200 | 200 {"item":{"id":"d7e47f88-678e-48f6-895c-782c71af1394","title":"FGH I1","plan_id": | PASS |
| MEDIA-01.item.clear | neighbour | - | owner | API | 200 | 200 | PASS |
| MEDIA-01.item.link.invalid-item-kind | MEDIA-01 invalid item kind refused | - | owner | API | 4xx | 400 | PASS |
| MEDIA-01.archive | neighbour | - | media-editor | API | 200 | 200 | PASS |
| MEDIA-01.xorg.read | neighbour | - | betaowner | API | 404 | 404 | PASS |

### STAGE-01 (P 12 / F 0 / B 0 / NR 1 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| STAGE-01.val.tpl.name-NUL | STAGE-01.val.tpl.name-NUL (w3) | W3-FILE-D3 | media-editor | API | 422 | 422 | PASS |
| STAGE-01.tpl.create | neighbour | - | media-editor | API | 201 | 201 | PASS |
| STAGE-01.tpl.edit | neighbour | - | media-editor | API | 200 | 200 | PASS |
| STAGE-01.tpl.edit.stale | neighbour | - | media-editor | API | 409 | 409 | PASS |
| STAGE-01.tpl.create.member-denied | neighbour | - | member | API | 403 | 403 | PASS |
| STAGE-01.plan.layout.create-from-template | neighbour | - | owner | API | 201 | 201 {"layout":{"id":"103288b6-4ee5-4242-b6c6-045b9315ef0f","orga | PASS |
| STAGE-01.plan.layout.name-NUL | neighbour | W3-FILE-D3 | owner | API | 422 | 422 | PASS |
| STAGE-01.plan.layout.edit | neighbour | - | owner | API | 200 | 200 (retried with correct revision; first attempt was a harness bug) | PASS |
| STAGE-01.tpl.library-unchanged-by-plan-edit | neighbour | - | owner | API | template name still FGH Stage 2 | FGH Stage 2 | PASS |
| STAGE-01.plan.layout.read.member | neighbour | - | member | API | 200 | 200 | PASS |
| STAGE-01.plan.layout.xorg | neighbour | - | betaowner | API | 404 | 404 | PASS |
| STAGE-01.web.print/ui | STAGE-01 web layout UI (w3 PASS rows) | - | planner | Web | - | not run: browser owned by W10-WEB | NOT_RUN |
| STAGE-01.plan.layout.edit.stale | neighbour | - | owner | API | 409 | 409 | PASS |

### LIVE-01 (P 16 / F 0 / B 0 / NR 1 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| LIVE-01.create.owner | neighbour | - | owner | API | 201 ready, owner holds lease | 201 ready ctrl=t | PASS |
| LIVE-01.create.member | neighbour | - | member | API | 403, no run row | 403 rows=0 | PASS |
| LIVE-01.create.teamsched | neighbour | - | teamsched | API | 403, no run row | 403 rows=0 | PASS |
| LIVE-01.create.betaowner.orgB-header | neighbour | - | betaowner | API | 404 | 404 | PASS |
| LIVE-01.action.start.owner | neighbour | - | owner | API | 200 live | 200 live | PASS |
| LIVE-01.action.pause.member-viewer | neighbour | - | member | API | 403, rev unchanged | 403 | PASS |
| LIVE-01.state.viewer | neighbour | - | member | API | 200 can_control false | 200 false | PASS |
| LIVE-01.action.advance | neighbour | - | owner | API | 200 | 200 | PASS |
| LIVE-01.action.pause+resume | neighbour | - | owner | API | 200 | 200 | PASS |
| LIVE-01.action.end.owner | neighbour | - | owner | API | 200 ended | 200 ended | PASS |
| LIVE-01.action.set_policy.after-end | LIVE-01.action.set_policy.after-end (w3) | W3-LIVE-D1 | owner | API+DB | 409 run over; no history appended, revision unchanged | 409 {"error":"This run is over","code":"run_state_invalid"} transitions 6->6 rev 6->6 | PASS |
| LIVE-01.action.pause.after-end | neighbour | - | owner | API | 409, nothing appended | 409 t=6->6 | PASS |
| LIVE-01.action.resume.after-end | neighbour | - | owner | API | 409, nothing appended | 409 t=6->6 | PASS |
| LIVE-01.action.advance.after-end | neighbour | - | owner | API | 409, nothing appended | 409 t=6->6 | PASS |
| LIVE-01.action.refresh_snapshot.after-end | neighbour | - | owner | API | 409, nothing appended | 409 t=6->6 | PASS |
| LIVE-01.action.take_control.after-end | neighbour | - | owner | API | 409, nothing appended | 409 t=6->6 | PASS |
| LIVE-01.surface.web/mobile | LIVE-01 W/M rows (w3 NOT_RUN) | - | - | Web/Mobile | - | not run: browser owned by W10-WEB; mobile out of scope | NOT_RUN |

### LIVE-02 (P 26 / F 0 / B 0 / NR 1 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| LIVE-02.renew.after-end | LIVE-02.renew.after-end (w3) | W3-LIVE-D2 | owner | API | 409 run_control_lost; no raw DB row in body | 409 {"error":"You are not controlling this run. Nothing was applied.","code":"run_control_lost"} | PASS |
| LIVE-02.renew.after-end.admin | LIVE-02.renew.after-end (w3, admin) | W3-LIVE-D2 | admin | API | 409 run_control_lost clean | 409 {"error":"You are not controlling this run. Nothing was applied.","code":"run_control_lost"} | PASS |
| LIVE-02.release_control | neighbour | - | owner | API | 200 vacant | 200 ctrl=none | PASS |
| LIVE-02.vacant-controller.command-by-non-holder | LIVE-02.vacant-controller.command-by-non-holder (w3) | W3-LIVE-D1 | admin (never held lease) | API+DB | 409 run_control_lost, nothing applied | 409 status=live t=3->3 | PASS |
| LIVE-02.vacant-lease.command-without-control.legacy.pause | LIVE-02.vacant-lease.command-without-control (w3) | W3-LIVE-D1 | legacy | API+DB | 409 run_control_lost, nothing applied | 409 t=3->3 status=live | PASS |
| LIVE-02.vacant-lease.command-without-control.legacy.resume | LIVE-02.vacant-lease.command-without-control (w3) | W3-LIVE-D1 | legacy | API+DB | 409 run_control_lost, nothing applied | 409 t=3->3 status=live | PASS |
| LIVE-02.vacant-lease.command-without-control.legacy.advance | LIVE-02.vacant-lease.command-without-control (w3) | W3-LIVE-D1 | legacy | API+DB | 409 run_control_lost, nothing applied | 409 t=3->3 status=live | PASS |
| LIVE-02.vacant-lease.command-without-control.scoped.set_policy | LIVE-02.vacant-lease.command-without-control (w3) | W3-LIVE-D1 | scoped | API+DB | 409 run_control_lost, nothing applied | 409 t=3->3 status=live | PASS |
| LIVE-02.vacant-lease.command-without-control.legacy.jump | LIVE-02.vacant-lease.command-without-control (w3) | W3-LIVE-D1 | legacy | API+DB | 409 run_control_lost, nothing applied | 409 t=3->3 status=live | PASS |
| LIVE-02.vacant.command.viewer | neighbour | - | member | API | 403 | 403 | PASS |
| LIVE-02.vacant.take_control | neighbour | - | legacy | API | 200, legacy now controller | 200 legacy.qaw10.fgh@example.test | PASS |
| LIVE-02.holder.command-after-take_control | neighbour | - | legacy | API | 200 | 200 | PASS |
| LIVE-02.take_control.while-held | neighbour | - | admin | API | 409 run_control_held | 409 run_control_held | PASS |
| LIVE-02.take_over | neighbour | - | admin | API | 200 admin controller | 200 | PASS |
| LIVE-02.old-controller.command-after-takeover | neighbour | - | legacy (displaced) | API | 409 run_control_lost | 409 run_control_lost | PASS |
| LIVE-02.retry.same-action-id | neighbour | - | admin | API | 200 then replayed 200, one transition | 200/200 replayed=true | PASS |
| LIVE-02.stale-revision | neighbour | - | admin | API | 409 stale | 409 run_revision_stale | PASS |
| LIVE-02.lease-expired.holder-command | neighbour | - | admin (expired) | API | 409 run_control_lost | 409 | PASS |
| LIVE-02.lease-expired.renew | neighbour | - | admin | API | 409 | 409 | PASS |
| LIVE-02.lease-expired.take_control-by-other | neighbour | - | legacy | API | 200 | 200 | PASS |
| LIVE-02.race.simultaneous-commands-same-revision | neighbour (w3 race) | - | legacy x2 parallel x10 | API barrier race | each: one 200 + one 409; rev+1 | clean 10/10  (re-run: first attempt targeted the current index for some iterations = harness bug -> 400) | PASS |
| LIVE-02.race.holder-vs-nonholders | neighbour | - | legacy/admin/scoped/owner parallel x10 | API barrier race | at most one winner; rest 409; no 500 | clean 10/10  (re-run: first attempt targeted the current index for some iterations = harness bug -> 400) | PASS |
| LIVE-02.race.simultaneous-take_over | neighbour | - | 4 users parallel x8 | API barrier race | exactly one winner each time | clean 8/8 | PASS |
| LIVE-02.integrity.after-races | neighbour | - | - | DB | transition revisions contiguous+unique | t transitions=35 run.revision=35 | PASS |
| LIVE-02.reconnect.state-reload-authoritative | neighbour | - | member | API | no-store, server_now | no-store true | PASS |
| LIVE-02.xorg.state | neighbour | - | betaowner | API | 404 | 404 | PASS |
| LIVE-02.poll-network-loss.web+mobile | LIVE-02 W/M rows (w3 NOT_RUN) | - | viewer/controller | Web/Mobile | - | not run: browser owned by W10-WEB; physical devices unavailable | NOT_RUN |

### REPORT-01 (P 23 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| REPORT-01.setup.attendance-9 | setup | - | owner | API | 200 | 200 "(already recorded in first pass)" | PASS |
| REPORT-01.setup.attendance-11 | setup | - | owner | API | 200 | 200 | PASS |
| REPORT-01.oracle.persisted-totals-pre-correction | REPORT-01.oracle.persisted-totals-pre-correction (w3) | - | - | DB | present 3, absent 2, unknown 1; 6 records | absent/2 ; present/3 ; unknown/1 records=6 | PASS |
| REPORT-01.participation.summary-has-unknown-total | REPORT-01.participation.summary-has-unknown-total (w3, w7 W7-JRN-D1) | W3-LIVE-D3 / W7-JRN-D1 | owner | API | summary carries present 3 absent 2 unknown 1 (sum = 6 records) | {"present":3,"absent":2,"unknown":1,"assignments":5,"people":4} | PASS |
| REPORT-01.participation.member2-two-positions-one-record-per-time | neighbour | - | owner | API | member2 present 1 unknown 1 absent 0 (two positions not double counted) | {"a":2,"p":1,"u":1,"ab":0} | PASS |
| REPORT-01.participation.unmarked-not-unknown | neighbour | - | owner | API | librarian 0/0/0 (unmarked != recorded unknown) | {"person_id":"b125a83d-990c-4eee-99db-e08bff546053","person_name":"librarian.qaw10.fgh@example.test","archived":false,"teams":["FGH Band"],"assignments":1,"person_plans":1,"confirmed":0,"pending":1,"d | PASS |
| REPORT-01.participation.after-correction | neighbour (w3 oracle) | - | owner | API+DB | present 4 absent 2 unknown 0; still 6 records | 200 {"p":4,"a":2,"u":0} records=6 | PASS |
| REPORT-01.attendance.correction-history-actor-reason | neighbour | - | owner | API | history has 2 entries incl reason | 200 [{"id":9,"record_id":"4766c676-bb3d-4b15-80b1-7ac3faa8312b","organization_id":"e85459fd-a234-438f-b33a-d7aaf4f0c51d","batch_id":"48eb68bd-54c3-4196-8f35-557e6fd | PASS |
| REPORT-01.participation.definitions-list-unknown | neighbour | - | owner | API | definitions include Unknown | Assignments,Person-plans,People,Confirmed,Pending,Declined,Present,Absent,Unknown | PASS |
| REPORT-01.kind.staffing.owner | neighbour | - | owner | API | 200 | 200 | PASS |
| REPORT-01.kind.participation.owner | neighbour | - | owner | API | 200 | 200 | PASS |
| REPORT-01.kind.song-usage.owner | neighbour | - | owner | API | 200 | 200 | PASS |
| REPORT-01.kind.run-times.owner | neighbour | - | owner | API | 200 | 200 | PASS |
| REPORT-01.kind.schedule.owner | neighbour | - | owner | API | 200 | 200 | PASS |
| REPORT-01.staffing.totals-vs-DB | neighbour | - | owner | API+DB | pending+confirmed+declined = DB nondeclined+declined assignments for plan (5) | {"plans":1,"needed":0,"confirmed":0,"pending":5,"declined":0,"vacancies":0,"follow_ups":[{"plan_id":"23299793-4fba-44d8-8ef2-771e41b8550a","plan_title":"FGH D14 | PASS |
| REPORT-01.access.member | neighbour | - | member | API | 403 | 403 | PASS |
| REPORT-01.access.member2 | neighbour | - | member2 | API | 403 | 403 | PASS |
| REPORT-01.access.librarian | neighbour | - | librarian | API | 403 | 403 | PASS |
| REPORT-01.access.media | neighbour | - | media | API | 403 | 403 | PASS |
| REPORT-01.access.anonymous | neighbour | - | anonymous | API | 401 | 401 | PASS |
| REPORT-01.xorg.own-org-no-A-data | neighbour | - | betaowner | API | 200 empty | 200 rows=0 | PASS |
| REPORT-01.song-usage.oracle-3-occurrences-2-plans | neighbour (w3 oracle) | - | owner | API | 3 occurrences, 2 plans | {"song_id":"bd797bca-aee0-4590-bcc9-11d54f6ed16c","title":"FGH Report Song","author":null,"occurrences":3,"plans":2,"keys":[],"first_used":"2026-12-12T15:00:00+00:00","last_used":"2026-12-14T15:00:00+ | PASS |
| REPORT-01.run-times.completed-only | neighbour (w3 oracle) | - | owner | API+DB | ended run included, ongoing/ready run excluded: runs = count of ended runs in range | runs=1 planned=210 actual=0 DB ended runs in range=1 snapshotPlanned=0 | PASS |

### REPORT-02 (P 10 / F 4 / B 0 / NR 3 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| REPORT-02.oa.schedule.2400-rows-truncation-signalled | REPORT-02.oa.schedule.2400-rows-truncation-signalled (w3, w8 W8-PERF-D2) | W3-INT-D2 / W8-PERF-D2 | owner | API | 2400 matching: truncated=true, exactly 2000 rows | rows=2000 truncated=true summary.assignments=2400 DB=2400 | PASS |
| REPORT-02.oa.schedule.summary-vs-rows | REPORT-02.oa.schedule.summary-vs-rows (w3) | W3-INT-D2 | owner | API | summary counts equal DB truth (2400) and truncation declared | summary={"plans":12,"assignments":2400,"people":200} rows=2000 truncated=true | PASS |
| REPORT-02.oa.schedule.2400-rows-csv-notice | REPORT-02.oa.schedule.2400-rows-csv-notice (w3) | W3-INT-D2 | owner | API csv | CSV states "Truncated: first 2000 rows" | 200 notice=true lines=2017 | PASS |
| REPORT-02.oa.staffing.csv-bom | REPORT-02.oa.staffing.csv-bom (w3) | W3-INT-D3 | owner | API csv | UTF-8 BOM present (w3 expectation; NOTE plan §5H REPORT-02 text does not list BOM, only IMPORT-01 does) | startsWithBOM=false content-type=text/csv; charset=utf-8 first="Report,Staff" | FAIL |
| REPORT-02.oa.participation.csv-bom | REPORT-02.oa.participation.csv-bom (w3) | W3-INT-D3 | owner | API csv | UTF-8 BOM present (w3 expectation; NOTE plan §5H REPORT-02 text does not list BOM, only IMPORT-01 does) | startsWithBOM=false content-type=text/csv; charset=utf-8 first="Report,Parti" | FAIL |
| REPORT-02.oa.schedule.csv-bom | REPORT-02.oa.schedule.csv-bom (w3) | W3-INT-D3 | owner | API csv | UTF-8 BOM present (w3 expectation; NOTE plan §5H REPORT-02 text does not list BOM, only IMPORT-01 does) | startsWithBOM=false content-type=text/csv; charset=utf-8 first="Report,Multi" | FAIL |
| REPORT-02.oa.song-usage.csv-bom | REPORT-02.oa.song-usage.csv-bom (w3) | W3-INT-D3 | owner | API csv | UTF-8 BOM present (w3 expectation; NOTE plan §5H REPORT-02 text does not list BOM, only IMPORT-01 does) | startsWithBOM=false content-type=text/csv; charset=utf-8 first="Report,Song " | FAIL |
| REPORT-02.csv.unicode-preserved | neighbour | - | owner | API csv | Vietnamese + quote chars intact | true quoted=true | PASS |
| REPORT-02.csv.formula-prefix-matrix | neighbour (7c4b0b1 more prefixes) | - | owner | API csv | every plan title that starts with = + - @ TAB CR / has a neutralising apostrophe in the CSV cell | staffing CSV title cells: =1+1 -> '=1+1; +1 -> '+1; -1 -> '-1; @SUM(A1) -> '@SUM(A1); =cmd/... -> '=cmd/...; leading TAB/CR are trimmed by plan-title validation before export (cell starts with 1); /cmd not prefixed (not an OWASP formula trigger). Schedule CSV  | PASS |
| REPORT-02.export.request+idempotent | neighbour | - | owner | API | 202 queued; same key same job | 202 queued same=true | PASS |
| REPORT-02.export.member-denied | neighbour | - | member | API | 403 | 403 | PASS |
| REPORT-02.export.download-before-ready | neighbour | - | owner | API | 409 not ready (worker not run by this package) | 409 | PASS |
| REPORT-02.export.xorg-download | neighbour | - | betaowner | API | 404 | 404 | PASS |
| REPORT-02.oa.export.full-not-truncated | REPORT-02.oa.export.full-not-truncated (w3) | W3-INT-D2 | owner | API/export+worker | async export of 2400 requests contains all 2400 rows | export queued; processing needs the delivery worker (owned by W10-MAIL). Source: backend/src/services/report-exports.ts builds with the same buildReport capped at REPORT_ROW_LIMIT=2000 and sets row_count=report.rows.length, so the file is expected to hold 2000 | NOT_RUN |
| REPORT-02.oa.export.file-bom | REPORT-02.oa.export.file-bom (w3) | W3-INT-D3 | owner | file | UTF-8 BOM | export file needs worker (owned by W10-MAIL); source: same reportToCsv, no BOM added | NOT_RUN |
| REPORT-02.web-mobile.print-share-ui | REPORT-02 W/M rows | - | user | Web/Mobile | - | not run: browser owned by W10-WEB; mobile out of scope | NOT_RUN |
| REPORT-02.csv.formula.schedule-report | neighbour | - | owner | API csv | neutralised in schedule CSV too | "2026-12-12,'=1+1 FGHF0,FGH Sunday,FGH Band,No position,\"Vol001 Nguyễn \"\"Q\"\"1\",un" | PASS |

### CAL-02 (P 16 / F 3 / B 0 / NR 2 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| CAL-02.personal.create | neighbour | - | member | API | 201 url with token, no-store | 201 cc=no-store active=true | PASS |
| CAL-02.personal.fetch.ics | neighbour | - | anonymous (bearer url) | P | 200 text/calendar with released unconfirmed assignment retained | 200 text/calendar; charset=utf-8 VEVENT=3 tentative/status= | PASS |
| CAL-02.personal.prepared-assignment-absent | neighbour | - | member2 feed | P | no event for the prepared FGH Main plan request (D14 plan events are released and expected) | events main=0 d14=2 total=2 preparedRows=1 | PASS |
| CAL-02.mem.rls.update-own-token-hash | CAL-02.mem.rls.update-own-token-hash (w3) | W3-INT-D1 | member | DB PostgREST caller JWT | PATCH of token_hash denied (server-generated) | 200 hashChanged=true | FAIL |
| CAL-02.personal.rotate.old-url-dead | neighbour | - | member | API+P | old 404 after rotate | 404 | PASS |
| CAL-02.mem.rls.unrevoke-own-token | CAL-02.mem.rls.unrevoke-own-token (w3) | W3-INT-D1 | member | DB PostgREST caller JWT (revoke current via PATCH, then PATCH old revoked_at=null) | a revoked token cannot be revived by the client | oldUrl before=404; client self-revoke=200; unrevoke=200; old URL now serves 200 | FAIL |
| CAL-02.xuser.rls.update-other-token | neighbour | - | member2 | DB PostgREST | 0 rows changed | 200 [] | PASS |
| CAL-02.xuser.rls.select-other-token | neighbour | - | member2 | DB PostgREST | no rows | 200 n=0 | PASS |
| CAL-02.mem.rls.select-own-token-hash | neighbour | - | member | DB PostgREST | record whether hash is readable by owner | 200 n=3 | PASS |
| CAL-02.personal-feed.revoke-without-rotate | CAL-02.personal-feed.revoke-without-rotate (w3) | W3-INT-D9 | member | API | a way to revoke the personal feed without issuing a replacement | DELETE/PUT/PATCH /me/calendar-feed -> DELETE:404 PUT:404 PATCH:404; only POST (=rotate) exists; active=true | FAIL |
| CAL-02.scoped.create | neighbour | - | owner | API | 201 token url | 201 feed,url,webcal_url | PASS |
| CAL-02.scoped.fetch | neighbour | - | anonymous (bearer url) | P | 200 ics | 200 | PASS |
| CAL-02.scoped.rotate.old-dead | neighbour | - | owner | API+P | old url 404 | 201 old=404 | PASS |
| CAL-02.scoped.revoke | neighbour | - | owner | API+P | rotate: old url 404; revoke rotated feed 204; its url 404 | rotate=201 old=404 newId==oldId:false del=204 fetch=404 | PASS |
| CAL-02.personal.inactive-member-feed-404 | neighbour | - | anonymous (bearer url of deactivated member) | P | 404 | 404 | PASS |
| CAL-02.garbage-token | neighbour | - | anonymous | P | 404 | 404 | PASS |
| CAL-02.personal.redate.uid-stable+sequence-up | neighbour (w3 redate rows) | - | member feed | P | same UID, SEQUENCE increases, new DTSTART | patch=200 uid same=true seq SEQUENCE:0,SEQUENCE:0,SEQUENCE:0->SEQUENCE:1,SEQUENCE:0,SEQUENCE:0 dtstartChanged=true | PASS |
| CAL-02.web.feed-ui | CAL-02 W/M rows (w3 NOT_RUN) | - | member | Web/Mobile | - | not run: browser owned by W10-WEB; native out of scope | NOT_RUN |
| CAL-02.mobile.subscribe/share | CAL-02 W/M rows (w3 NOT_RUN) | - | member | Web/Mobile | - | not run: browser owned by W10-WEB; native out of scope | NOT_RUN |
| CAL-02.scoped.create.non-team-member-denied | neighbour | - | media-editor (not on Band) | API | 403/404 | 403 | PASS |
| CAL-02.scoped.create.own-team-member | neighbour | - | member (on Band) | API | record: members may subscribe to their own team feed | 201 | PASS |

### GATED-01 (P 3 / F 1 / B 0 / NR 2 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| GATED-01.api.songbook.create | neighbour (dormant API) | - | librarian | API | 201 | 201 | PASS |
| GATED-01.api.songbook-song-delete | GATED-01.api.songbook-song-delete (w3) | W3-SONG-D14 | librarian | API+DB | delete of a song used by a songbook refused (409/400), songbook item retained | 204 songbook_items=0 song=0 | FAIL |
| GATED-01.api.songbook.create.member | neighbour | - | member | API | 403 | 403 | PASS |
| GATED-01.api.songbook.list.member | neighbour | - | member | API | 200 | 200 | PASS |
| GATED-01 web songbook routes redirect to /songs | w3 PASS rows | - | any | Web/Mobile | redirect/absent | not run: browser owned by W10-WEB; no native in scope | NOT_RUN |
| GATED-01 mobile no songbook route | w3 PASS rows | - | any | Web/Mobile | redirect/absent | not run: browser owned by W10-WEB; no native in scope | NOT_RUN |

### PERF-01 (P 11 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| PERF-01.chat.list(110+) | PERF-01.chat.list(110).orgB (w8 W8-PERF-D3) | p50 55.0 ms / p95 61.9 ms / cold 81.0 ms / 29.0 KB | owner | GET /conversations | all 102 conversations returned (no silent 100 cap) | returned 102 unique 102 DB=102 | PASS |
| PERF-01.chat.list.paged-walk | neighbour (w9 retest-data) | - | owner | GET /conversations?limit=30&cursor | walk covers all conversations once | pages=4 unique=102 DB=102 | PASS |
| PERF-01.report.schedule.json | PERF-01.report.schedule.json (w8 W8-PERF-D2b) | p50 183.3 ms / p95 196.3 ms / cold 196.3 ms / 658.7 KB | owner | GET /reports/schedule (2410 matching assignments) | summary = DB truth (2410); rows capped at 2000 with truncated=true (not silently 1000) | rows=2000 truncated=true summary=2410 | PASS |
| PERF-01.report.schedule.csv | PERF-01.report.schedule.csv (w8 W8-PERF-D2b) | p50 187.3 ms / p95 250.3 ms / cold 195.3 ms / 199.0 KB | owner | GET /reports/schedule?format=csv | CSV same cap + Truncated notice | dataRows=2000 notice=true | PASS |
| PERF-01.report.participation.json | neighbour | p50 173.0 ms / p95 192.1 ms / cold 184.4 ms / 61.3 KB | owner | GET /reports/participation | 200 people=200 assignments=2410 | people=200 assignments=2410 | PASS |
| PERF-01.songs.p3(past100) | neighbour | p50 45.5 ms / p95 51.4 ms / cold 39.1 ms / 31.9 KB | member | GET /songs?per_page=50&page=3 | total=155, page 3 rows=50 | rows=50 total=155 | PASS |
| PERF-01.songs.search.accent | neighbour (d2a5b19) | p50 39.8 ms / p95 42.4 ms / cold 40.7 ms / 1.2 KB | member | GET /songs?q=Nguyen | 200 | rows=1 | PASS |
| PERF-01.plans.list | neighbour | p50 29.2 ms / p95 34.9 ms / cold 31.9 ms / 260.8 KB | owner | GET /plans?per_page=50 | total=129 | total=129 rows=50 | PASS |
| PERF-01.people.list | neighbour | p50 52.4 ms / p95 86.7 ms / cold 46.6 ms / 61.9 KB | owner | GET /people?per_page=50 | 200 paged | 200 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88 | PASS |
| PERF-01.notifications.unread-count | neighbour | p50 9.4 ms / p95 11.4 ms / cold 11.2 ms / 0.0 KB | member | GET /notifications/unread-count | 200 | 200 | PASS |
| PERF-01.media.list.truncated | neighbour (de3ae9a) | p50 15.5 ms / p95 17.5 ms / cold 16.9 ms / 73.5 KB | owner | GET /media?q=FGHLL | 200 total=212 truncated | 212 true | PASS |

### Extra: large-list-sql+ccli (P 46 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| LL-SONG.usage.sql.12w-distinct | neighbour (d2a5b19) | - | member | API | chua usage_count=3 (3 distinct plans; two items in Sun2 count once; future excluded), ton=1, pct=0, never=0 | chua=3 ton=1 pct=0 never=0 | PASS |
| LL-SONG.usage.sql.service-type-scoped | neighbour | - | member | API | Sunday scope: chua=2, ton=0 | chua=2 ton=0 | PASS |
| LL-SONG.sort.most_used | neighbour | - | member | API | order chua(3), ton(1), then title | FGHLL Chúa Là Tình Yêu:3 ; FGHLL Ơn Trời:1 ; FGHLL 100% Grace:0 | PASS |
| LL-SONG.sort.last_used | neighbour | - | member | API | chua (future plan) first, ton next; never-scheduled last | FGHLL Chúa Là Tình Yêu:2026-12-06 ; FGHLL Ơn Trời:2026-11-08 ; FGHLL 100% Grace:2026-07-05 | PASS |
| LL-SONG.paging.total-and-no-dupes | neighbour | - | member | API | total=130, 3 pages of 50 cover 130 unique ids | total=130 unique=130 | PASS |
| LL-SONG.in_plan | neighbour | - | member | API | in_plan true only for chua | chua=true ton=false | PASS |
| LL-SONG.not_scheduled_since | neighbour | - | member | API | excludes chua (scheduled in window), includes never/ton/pct | chua=false never=true pct=true | PASS |
| LL-SONG.search.accent-insensitive.title-unaccented | neighbour (d2a5b19) | - | member | API | "chua la tinh yeu" finds Chúa Là Tình Yêu | 1 | PASS |
| LL-SONG.search.accented-query | neighbour | - | member | API | "Chúa" finds it | 1 | PASS |
| LL-SONG.search.author-accent | neighbour | - | member | API | "nguyen thi" finds author Nguyễn Thị Bích | 1 | PASS |
| LL-SONG.search.d-bar-fold | neighbour | - | member | API | đ folds to d ("dang van an" finds Đặng Văn An) | 1 | PASS |
| LL-SONG.search.ccli | neighbour | - | member | API | CCLI 7002 finds Ơn Trời only | 1 true | PASS |
| LL-SONG.search.horn-fold | neighbour | - | member | API | "on troi" finds Ơn Trời | 1 | PASS |
| LL-SONG.search.multiword-AND+percent-literal | neighbour | - | member | API | all words must match; % literal | 1 | PASS |
| LL-SONG.search.percent-not-wildcard | neighbour | - | member | API | "%" matches only the song with a literal % (among FGHLL), not everything | 1 | PASS |
| LL-SONG.search.underscore-literal | neighbour | - | member | API | "a_b" literal | 1 | PASS |
| LL-SONG.search.backslash-literal | neighbour | - | member | API | literal backslash | 1 | PASS |
| LL-SONG.search.no-results | neighbour | - | member | API | empty | 0 | PASS |
| LL-SONG.search.sql-metachar | neighbour | - | member | API | empty, 200 | 0 | PASS |
| LL-SONG.search.over-100-chars | neighbour | - | member | API | 422 | 422 | PASS |
| LL-SONG.search.xorg | neighbour | - | betaowner | API | 0 results | 0 | PASS |
| CCLI.create.trim+leading-zero-text | 806c5e3 | - | librarian | API+DB | 201; stored "0022025" as text | 201 stored=[0022025] | PASS |
| CCLI.create.omitted-null | 806c5e3 | - | librarian | API+DB | 201; null | 201 NULL | PASS |
| CCLI.create.whitespace-only | 806c5e3 | - | librarian | API+DB | record: 201 w/ empty-or-null, never whitespace stored | 201 stored=[] | PASS |
| CCLI.create.boundary-40 | 806c5e3 | - | librarian | API | 201 | 201 | PASS |
| CCLI.create.boundary-41 | 806c5e3 | - | librarian | API | 422 field ccli_number, no row | 422 [{"path":"ccli_number","code":"too_big","message":"String must contain at most 40 character(s)"}] rows=0 | PASS |
| CCLI.create.number-type | 806c5e3 | - | librarian | API | 422 (text only) | 422 | PASS |
| CCLI.create.html-like | 806c5e3 | - | librarian | API | record: stored as inert text (escaping is a client concern) or rejected | 201 <script>alert(1)</script> | PASS |
| CCLI.create.NUL-byte | 806c5e3 | - | librarian | API | 422 (not 500) | 422 | PASS |
| CCLI.create.member-denied | 806c5e3 | - | member | API | 403, no row | 403 rows=0 | PASS |
| CCLI.create.media-editor-denied | 806c5e3 | - | media-editor | API | 403 | 403 | PASS |
| CCLI.create.owner | 806c5e3 | - | owner | API | 201 | 201 | PASS |
| CCLI.same-number-other-org-no-collision | 806c5e3 | - | betaowner | API | 201 in B; A search unaffected | 201 A hits=4 | PASS |
| CCLI.create.duplicate-number | 806c5e3 | - | librarian | API | record behaviour (dupes allowed or 409) | 201 | PASS |
| CCLI.update.clear-null | 806c5e3 | - | librarian | API+DB | 200 null | 200 t | PASS |
| LL-MEDIA.list.total+truncated | neighbour (d2a5b19/de3ae9a) | - | member | API | 213 active matching (2+210+... archived excluded): total=212, 200 returned, truncated=true | total=212 len=200 truncated=true | PASS |
| LL-MEDIA.list.include-archived-before-cap | neighbour | - | member | API | total=213 incl archived | total=213 len=200 | PASS |
| LL-MEDIA.search.accent-insensitive | neighbour | - | member | API | finds Phim Giáng Sinh | FGHLL Phim Giáng Sinh | PASS |
| LL-MEDIA.search.case+accent | neighbour | - | member | API | finds Phúc Âm | 1 | PASS |
| LL-MEDIA.search.accented-query | neighbour | - | member | API | finds | 1 | PASS |
| LL-MEDIA.search.percent-literal | neighbour | - | member | API | 0 (no title has %) | 0 | PASS |
| LL-MEDIA.search.narrow-total | neighbour | - | member | API | total=1 truncated=false | 1 false | PASS |
| LL-MEDIA.usage.exact | neighbour | - | member | API | usage_count=3 items | {"id":"72b5b785-267c-4010-818d-511c7b36e2e1","title":"FGHLL Phim Giáng Sinh","creator":null,"duration_seconds":null,"themes":[],"tags":[],"notes":null,"thumbnail_file_id":null,"archive_on":null,"archi | PASS |
| LL-MEDIA.list.anonymous | neighbour | - | anonymous | API | 401 | 401 | PASS |
| LL-MEDIA.list.xorg | neighbour | - | betaowner | API | total=0 | 0 | PASS |
| LL-MEDIA.detail.xorg-id | neighbour | - | betaowner | API | 404 | 404 | PASS |

### Extra: scoped-report-scope (P 28 / F 0 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| REPORT-SCOPE.schedule.owner.json | NOT_RUN wave 9: scoped scheduler report scope at volume | - | owner | API vs DB | summary.assignments=2410; rows=2000; truncated=true; no out-of-scope rows | status=200 summary=2410 rows=2000 truncated=true leak=false scope_note=null | PASS |
| REPORT-SCOPE.schedule.owner.csv | NOT_RUN wave 9 | - | owner | API csv vs DB | 2000 data rows + Truncated notice; no out-of-scope rows | csvRows=2000 truncatedNotice=true leak=false | PASS |
| REPORT-SCOPE.staffing.owner | NOT_RUN wave 9 | - | owner | API vs DB | staffing plans/rows consistent with scope (plans with in-scope requests=12); pending total = 2410 | rows=13 pending=2410 plans=12 | PASS |
| REPORT-SCOPE.participation.owner | NOT_RUN wave 9 | - | owner | API vs DB | participation assignments = 2410; team breakdown only in-scope teams | assignments=2410 teams=FGH Band:1210 FGH Production:1200 | PASS |
| REPORT-SCOPE.schedule.admin.json | NOT_RUN wave 9: scoped scheduler report scope at volume | - | admin | API vs DB | summary.assignments=2410; rows=2000; truncated=true; no out-of-scope rows | status=200 summary=2410 rows=2000 truncated=true leak=false scope_note=null | PASS |
| REPORT-SCOPE.schedule.admin.csv | NOT_RUN wave 9 | - | admin | API csv vs DB | 2000 data rows + Truncated notice; no out-of-scope rows | csvRows=2000 truncatedNotice=true leak=false | PASS |
| REPORT-SCOPE.staffing.admin | NOT_RUN wave 9 | - | admin | API vs DB | staffing plans/rows consistent with scope (plans with in-scope requests=12); pending total = 2410 | rows=13 pending=2410 plans=12 | PASS |
| REPORT-SCOPE.participation.admin | NOT_RUN wave 9 | - | admin | API vs DB | participation assignments = 2410; team breakdown only in-scope teams | assignments=2410 teams=FGH Band:1210 FGH Production:1200 | PASS |
| REPORT-SCOPE.schedule.legacy.json | NOT_RUN wave 9: scoped scheduler report scope at volume | - | legacy | API vs DB | summary.assignments=2410; rows=2000; truncated=true; no out-of-scope rows | status=200 summary=2410 rows=2000 truncated=true leak=false scope_note=null | PASS |
| REPORT-SCOPE.schedule.legacy.csv | NOT_RUN wave 9 | - | legacy | API csv vs DB | 2000 data rows + Truncated notice; no out-of-scope rows | csvRows=2000 truncatedNotice=true leak=false | PASS |
| REPORT-SCOPE.staffing.legacy | NOT_RUN wave 9 | - | legacy | API vs DB | staffing plans/rows consistent with scope (plans with in-scope requests=12); pending total = 2410 | rows=13 pending=2410 plans=12 | PASS |
| REPORT-SCOPE.participation.legacy | NOT_RUN wave 9 | - | legacy | API vs DB | participation assignments = 2410; team breakdown only in-scope teams | assignments=2410 teams=FGH Band:1210 FGH Production:1200 | PASS |
| REPORT-SCOPE.schedule.scoped.json | NOT_RUN wave 9: scoped scheduler report scope at volume | - | scoped | API vs DB | summary.assignments=1200; rows=1200; truncated=false; no out-of-scope rows | status=200 summary=1200 rows=1200 truncated=false leak=false scope_note=Only the teams and service types you schedule are included. | PASS |
| REPORT-SCOPE.schedule.scoped.csv | NOT_RUN wave 9 | - | scoped | API csv vs DB | 1200 data rows; no out-of-scope rows | csvRows=1200 truncatedNotice=false leak=false | PASS |
| REPORT-SCOPE.staffing.scoped | NOT_RUN wave 9 | - | scoped | API vs DB | staffing plans/rows consistent with scope (plans with in-scope requests=6); pending total = 1200 | rows=6 pending=1200 plans=6 | PASS |
| REPORT-SCOPE.participation.scoped | NOT_RUN wave 9 | - | scoped | API vs DB | participation assignments = 1200; team breakdown only in-scope teams | assignments=1200 teams=FGH Band:1200 | PASS |
| REPORT-SCOPE.schedule.teamsched.json | NOT_RUN wave 9: scoped scheduler report scope at volume | - | teamsched | API vs DB | summary.assignments=1210; rows=1210; truncated=false; no out-of-scope rows | status=200 summary=1210 rows=1210 truncated=false leak=false scope_note=Only the teams and service types you schedule are included. | PASS |
| REPORT-SCOPE.schedule.teamsched.csv | NOT_RUN wave 9 | - | teamsched | API csv vs DB | 1210 data rows; no out-of-scope rows | csvRows=1210 truncatedNotice=false leak=false | PASS |
| REPORT-SCOPE.staffing.teamsched | NOT_RUN wave 9 | - | teamsched | API vs DB | staffing plans/rows consistent with scope (plans with in-scope requests=7); pending total = 1210 | rows=7 pending=1210 plans=7 | PASS |
| REPORT-SCOPE.participation.teamsched | NOT_RUN wave 9 | - | teamsched | API vs DB | participation assignments = 1210; team breakdown only in-scope teams | assignments=1210 teams=FGH Band:1210 | PASS |
| REPORT-SCOPE.scope_note.scoped | NOT_RUN wave 9 | - | scoped | API | scope note present for scoped scheduler | Only the teams and service types you schedule are included. | PASS |
| REPORT-SCOPE.scope_note.owner | neighbour | - | owner | API | no scope note | null | PASS |
| REPORT-SCOPE.access.scoped.song-usage | neighbour | - | scoped | API | 200 | 200 | PASS |
| REPORT-SCOPE.access.teamsched.song-usage | neighbour | - | teamsched | API | 403 | 403 | PASS |
| REPORT-SCOPE.access.teamsched.run-times | neighbour | - | teamsched | API | 403 | 403 | PASS |
| REPORT-SCOPE.access.scoped.run-times | neighbour | - | scoped | API | 200 | 200 | PASS |
| REPORT-SCOPE.access.member.schedule | neighbour | - | member | API | 403 | 403 | PASS |
| REPORT-SCOPE.export.scoped.request | neighbour | - | scoped | API | 202 queued (content scope applied by worker: NOT_RUN, worker owned by W10-MAIL) | 202 queued | PASS |

### Extra: wave9-api-notrun (P 13 / F 1 / B 0 / NR 0 / NA 0)

| Row ID | Orig row | Orig defect | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|---|
| DOUBLE-DELETE.plan-position.concurrent | wave 9 NOT_RUN: plan-position double-delete | - | two separate sessions (rotating owner/admin/legacy/scoped) | API barrier race x15 | one 204 and one clean 404, no 500, row gone | clean 0/15 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] / 204,204 gone=true ["",""] | FAIL |
| DOUBLE-DELETE.plan-position.sequential | neighbour | - | owner | API | 204 then 404 | 204/404 | PASS |
| DOUBLE-DELETE.plan-position.member-denied | neighbour | - | member | API | 403, row kept | 403 kept=1 | PASS |
| DOUBLE-DELETE.plan-position.xorg | neighbour | - | betaowner | API | 404 | 404 | PASS |
| DOUBLE-DELETE.songbook.concurrent | wave 9 NOT_RUN: songbook double-delete | - | two separate sessions (owner + librarian) | API barrier race x15 | one 204 and one clean 404, no 500, book + items gone | clean 15/15  | PASS |
| DOUBLE-DELETE.songbook.sequential | neighbour | - | librarian | API | 204 then 404 | 204/404 | PASS |
| DOUBLE-DELETE.songbook.member-denied | neighbour | - | member | API | 403, kept | 403 kept=1 | PASS |
| DOUBLE-DELETE.songbook.xorg | neighbour | - | betaowner | API | 404, kept | 404 kept=1 | PASS |
| RES-STORAGE.private-api.pass-through-control | wave 9 NOT_RUN control | - | media-editor | API :4640 via proxy (pass) | 201 with upload target | 201 upload=true | PASS |
| RES-STORAGE.real-60s-timeout.upload-intent | wave 9 NOT_RUN: real 60 s Storage timeout | - | media-editor | private API :4640 (default SUPABASE_STORAGE_TIMEOUT_MS=60000) behind private proxy :4641 that never answers /storage/v1 | request ends after ~60 s with a clean 503/504 (no hang, no 500, no raw error) | 503 {"error":"File storage is unavailable. Try again shortly.","code":"storage_unavailable"} after 60.0 s | PASS |
| RES-STORAGE.real-60s-timeout.api-stays-responsive | wave 9 NOT_RUN | - | member | same instance while a Storage call hangs | /health and DB-backed reads unaffected | health 200 in 4 ms; GET /songs 200 in 56 ms | PASS |
| RES-STORAGE.real-60s-timeout.state-after | wave 9 NOT_RUN | - | media-editor | DB | pending version left (retryable/abandonable), no ready file, no orphan Storage object | versions=1 status=pending storageObjects=0 | PASS |
| RES-STORAGE.real-60s-timeout.same-key-retry-after-heal | wave 9 NOT_RUN | - | media-editor | API :4640 (proxy healed) | 200/201 with a usable upload target, one file | 200 upload=true replayed=true versions=1 | PASS |
| DOUBLE-DELETE.plan-position.vs-assign-race | neighbour (race on the same RPC) | - | owner DELETE vs admin POST assignment into the position | API barrier race x40 | no assignment silently stripped of its position; clean error | 40/40: DELETE 204, assignment POST 400 (FK, "Referenced record does not exist"), position gone, no assignment row created, no orphan | PASS |
