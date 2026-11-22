# W10 retest — wave 10 fix round (2026-11-22)

## Header

| Item | Value |
|---|---|
| Commit | `cca59db` on `feature/qa-wave10-fixes` (four fix branches merged). No source, migration, config, `.env` or git change; this file and `evidence/retest/` are the only repo edits. |
| Environment | Live API :4200 (simulated email/push, no `CRON_SECRET`, no `INTEGRATION_SECRET_KEY`), Vite web :5180, local Supabase (133 migrations, no reset). Private API instances :4760 (with a private `INTEGRATION_SECRET_KEY`, only to register a webhook), :4761 dev and :4762 `NODE_ENV=production` (log capture); all stopped by PID. |
| Namespace | Orgs `qa-w10r-a` (main), `qa-w10r-b` (cross-org 404 check only), `qa-w10r-c` (throwaway, deleted through account deletion). Users `<alias>.qaw10r@example.test` (owner, admin, sched, pubr, smgr, m1-m4, bowner, gone). Credentials only in the scratchpad `w10-retest/`. |
| Worker run | ONE global pass at **15:55:05 UTC** (`RESEND_API_KEY= EXPO_ACCESS_TOKEN= INTEGRATION_SECRET_KEY= npx tsx src/worker.ts`): claimed 50 / completed 50 (other orgs' rows), `[webhooks] skipped: INTEGRATION_SECRET_KEY is not configured; due webhook deliveries stay queued`. |
| Browser | Orca embedded browser, isolated profile `w10r-retest`; shots in `evidence/retest/`. |

## Results

| Defect ID | Check | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| W10-MAIL-D4 | explicit merge of a duplicate Person (invitation_conflict report) | admin | API+DB | 200, merge committed, audit kept | 200; candidate Person gone, tag moved to kept Person; report row kept with `status=merged`, `candidate_person_id=null`; a retry of the merge also answers 200 (idempotent) | PASS |
| W10-MAIL-D4 | keep_separate | admin | API+DB | still 200 | 200, both Persons kept, report `kept_separate` | PASS |
| W10-MAIL-D1 | publish `skipped` list for a no-email Person | admin | API | name shown | `["Noemail Guest"]` (also `POST /notify` as scheduler) | PASS |
| W10-MAIL-D1 | `GET /deliveries?plan_id=` recipient_name | admin | API | name shown | `Noemail Guest`, `R m4` (same as owner) | PASS |
| W10-MAIL-D2 | assignment racing a publish, 20 races (8 barrier + 12 with 0-30 ms offsets) | owner | API+DB | new person's request sent in the same request, nothing queued | 20/20: assignment 201, publish 200, deliveries `in_app delivered / email simulated / push skipped`, 0 `queued` rows in the org. Caveat: cannot prove any run hit the narrow window; none left a queued row | PASS |
| W10-MAIL-D5 | worker without `INTEGRATION_SECRET_KEY` | worker | worker+DB | due webhook deliveries stay queued, endpoint enabled | 2 deliveries still `queued`, attempts 0, no error code; endpoint `enabled=t`, `consecutive_failures=0`, no disabled_reason; log line says step skipped | PASS |
| W10-NAT-D1 | person with login and `people.phone` | owner | API | list and page phone == detail phone | `GET /people`, `/people/page`, `/people/:id` all `+1 555 0101`; guest same | PASS |
| W10-NAT-D1 | admin, sched, pubr, smgr, member | non-owners | API | still null | list/page `null`, detail 403 | PASS |
| W10-SEC-D4 | 4 rounds x 6 concurrent accepts of one fresh invitation | anon | API+DB | one 200, losers 409/410, no 5xx | every round `200` + five `409 invitation_accept_in_progress`; one auth user and one link per round | PASS |
| W10-SEC-D1 | `/plans?page=` 1e21, 1e20, 9007199254740993, 9007199254740991, 100001, 0, -1, abc | owner | API | 4xx | all 422; 1, 1000, 100000 → 200 with the right page label | PASS |
| W10-SEC-D2 | `/songs?page=` same values | owner | API | 4xx, no 500 | same as above, no 500 | PASS |
| W10-SEC-D2 | other lists (`/people/page`, songbooks, teams, deliveries, service-types, templates, reconciliations) | owner | API | never 500 | 200 for any `page` value (cursor/unpaged routes ignore it); no 5xx | PASS |
| W10-SEC-D3 | upper-case / `%69`-encoded invitation route, upper-case assignment-responses, `?access_token=`, `?token=`, Referer; dev and `NODE_ENV=production` | anon/owner | private API stdout | no token, query or Referer path in logs | logged `/api/v1/invitations/[token]`, `.../assignment-responses/[token]/x`, `?[redacted]`; production combined log Referer cut to `http://localhost:5180`; 0 hits for the secrets in both logs | PASS |
| W10-FGH-D1 | empty PATCH song and arrangement | owner | API | 200 unchanged | 200 both, revision unchanged; stale `expected_revision` 409; member 403; missing id 404; real patch 200 | PASS |
| W10-FGH-D2 / W10-CD-D6 | delete in-use arrangement and song | owner | API | 409 | `409 arrangement_in_use` / `409 song_in_use`, text truthful; rows intact; unused song 204 | PASS |
| W10-FGH-D4 | delete a song listed in a song book | owner | API+DB | 409, nothing deleted | `409 song_in_use` (names song books), song and `songbook_items` row intact; after the book is deleted the song deletes 204 | PASS |
| W10-FGH-D4 | organization delete with song+songbook (throwaway org) | gone (sole owner) | API `DELETE /me` | works | song delete 409 first; `DELETE /me` 200 deleting org; org, song, songbook all gone | PASS |
| W10-FGH-D5 | signed PUT after abandon; after forced expiry | owner | Storage+DB | refused, no object | Storage `403 This upload is no longer expected` for both; `storage.objects` 0 | PASS |
| W10-FGH-D5 | happy path intent → PUT → finalize | owner | API+Storage | works | PUT 200, finalize 200, version `ready` | PASS |
| W10-FGH-D6 | same key, different link url / title / document body; key of a doc used for a link | owner | API | 409 | `409 idempotency_key_reused` for each | PASS |
| W10-FGH-D6 | same key and payload (link, document) | owner | API | replay | same id returned both | PASS |
| W10-FGH-D7 | PostgREST PATCH own `token_hash`, `revoked_at`, un-revoke, INSERT, DELETE, SELECT `token_hash` | member | PostgREST | refused | all 403 (`42501`); hash unchanged; revoked token not revived; `id,revoked_at` still selectable | PASS |
| W10-FGH-D7 | API rotate | member | API | works | `POST /me/calendar-feed` 201, old URL 404, new URL 200 | PASS |
| W10-FGH-D8 | `DELETE /me/calendar-feed` | member | API+ICS | 204; old URL 404; POST rotates fresh | 204 (repeat 204), URL 404, 0 live rows, `GET` → `{url:null,active:false}`; `POST` 201 with a new URL serving `text/calendar` ICS; other user's feed untouched; anon 401 | PASS |
| W10-FGH-D9 | report CSV BOM (`song-usage`, `schedule`, `staffing`, `participation`) | owner | API | starts `EF BB BF` | all four start `efbbbf`; Vietnamese title intact | PASS |
| W10-FGH-D9 | formula neutralising | owner | API | kept | `"'=HYPERLINK(""x"")Ánh sáng"` | PASS |
| W10-FGH-D9 | tracked export file (worker) BOM | worker | - | BOM | same `reportToCsv`; not run (would need another global worker pass) | NOT_RUN |
| W10-CD-D1 | time edit double-booking, no reason | scoped (plans.edit+scheduling.manage) | API+DB | 409 scheduling_conflict naming people, nothing saved | `409 scheduling_conflict` "These times would double-book R m1…", details list conflicts; times unchanged | PASS |
| W10-CD-D1 | reason without override capability | same | API | 403 | 403 forbidden, nothing saved | PASS |
| W10-CD-D1 | reason + `scheduling.override_conflicts` | override holder | API+DB | saved + audited | 200, times saved, 1 row in `assignment_conflict_overrides` | PASS |
| W10-CD-D1 | non-conflicting edit; title-only edit on a plan with a standing overlap | scoped | API | 200 | 200 / 200 | PASS |
| W10-CD-D1 | bulk reschedule into overlap: no reason / reason w/o cap / reason+cap / non-conflicting | scoped, override holder | API+DB | 409 / 403 / 200+audit / 200 | 409 `scheduling_conflict` (date unchanged) / 403 / 200 (+1 audit row) / 200 | PASS |
| W10-CD-D1 | web time edit and web reschedule show the refusal | owner | Web | readable, no raw code | time edit: conflict list repeated in a readable "Scheduling conflicts" panel, plan unchanged; reschedule: "This person is unavailable or already scheduled at that time.", nothing moved ([shot](evidence/retest/web-cd-d1-time-edit-409.png), [shot](evidence/retest/web-cd-d1-reschedule-409.png)). Preview text now says "would create overlaps" (no "not refused") | PASS (see W10R-D1) |
| W10-CD-D2 | date-only / zone-less `service_date` and `times` on create, PATCH, duplicate | owner | API | 422 | all 422 "Include a time and a UTC offset…"; `Z`, `-05:00`, `+05:30`, `-0500` accepted and normalised; list `from/to` date filters still 200 | PASS |
| W10-CD-D3 | header 999 s, pre 300 / service 600 / post 120 | owner | API | total equals schedule | `total_length_seconds` 1020 = 300+600+120 | PASS |
| W10-CD-D4 | template with archived song: preview | owner | API | listed as skipped | `items.skipped:[{title,"song_archived"}]`, 2 to add | PASS |
| W10-CD-D4 | apply the same preview | owner | API | skips same items, no 400 | 200, 2 items created (live song + free item) | PASS |
| W10-CD-D8 | candidates of a team with no service type | service-type-scoped scheduler | API | 200 | 200 (1 candidate after adding a member); team of another type 404; plain member 403 | PASS |
| W10-CD-D9 | proposal with lock + exclusion on the same slot | owner | API | 422 | 422 "A person cannot be both locked and excluded…"; lock-only and exclusion-only 201 | PASS |
| W10-FGH-D3 | G −2 semitones | owner | API | flat spelling | `[F] [Bb/D] [Gm7] [C/E]` | PASS |
| W10-FGH-D3 | invalid `to=` (H, Xyz, bb, empty) | owner | API | 422 | all 422; `Bb`, `F`, `C#m`, `Gb` 200 | PASS |
| W10-FGH-D3 | slash bass / unknown text | owner | API | bass transposed, text kept | `[G#m7b9#11/Q]` +2 → `[A#m7b9#11/Q]`; `C/E` +2 → `D/F#`; `/Q` kept | PASS |
| W10-WEB-D1 | Join requests list 503 | owner | Web | error + Try again, no empty state | alert + Try again, no "No one is waiting", no "0"; Try again after recovery shows the empty state ([shot](evidence/retest/web-d1-joinrequests-503.png)) | PASS |
| W10-WEB-D2 | offline first load Songs, Media, Templates, Plans, Chat, Messages; offline People search | owner | Web | offline notice, not empty | each shows "You're offline. This list will load when you reconnect." + Try again; going online auto-loaded People (search result) and Songs ([shots](evidence/retest/)) | PASS |
| W10-WEB-D2 | Teams offline | owner | Web | notice not empty state | showed cached teams (page had been loaded earlier in the session), no empty state; first-load notice for Teams not exercised | PASS (partial) |
| W10-WEB-D3 | publish dialog: untick Notify, Cancel, reopen | owner | Web | re-ticked | first open ticked; unticked; after Cancel and reopen ticked ([shot](evidence/retest/web-d3-publish-reopen.png)) | PASS |
| W2-PLANS-D11 | Order tab at 1024 dark + light | owner | Web | no overlap, tabs reachable | row actions sit under the wrapped title, no overlap; "Attendance" fades at the edge as a scroll cue, clicking Share/Attendance scrolls them in and selects them | PASS |
| W2-PLANS-D11 | 390 and 1440, light + dark | owner | Web | OK | OK (1440 four-column rows, 390 stacked) | PASS |
| Regression | `GET /plans/:id` owner/admin/member/scheduler; cross-org | various | API | 200 / 404 | 200 for all org members, 404 for the other org | PASS |
| Regression | publish flow, People list/detail, song CRUD, file intent→PUT→finalize, calendar feed ICS | various | API | works | see rows above, all working | PASS |

## New defects

- **W10R-D1 (P3, UX).** The web time-edit dialog and the reschedule screen offer no way to give a conflict override reason, so an owner or any holder of `scheduling.override_conflicts` can never complete an overriding change from the web (the API supports `conflict_override_reason` on `PATCH /plans/:id` and reschedule). Repro: owner, plan with a person also scheduled elsewhere, edit the time to overlap → "Save times" refused; no reason field. Also the time-edit refusal repeats the "Scheduling conflicts" panel with the text "Keeping a request for all times would overlap the above…", which reads as an orphan-resolution hint, not as a refusal; the reschedule alert does not name the person. Source: `frontend/src/components/plan/` time-edit review dialog and the reschedule page (no `conflict_override_reason` in the web client).

No P0/P1 found.

## Notes

- W10-MAIL-D2: ~20 races is the best black-box attempt; the fix is also covered by reading the commit (decision from the RPC's recorded effect).
- Merge retry answers 200 with the stored report (previously 404); harmless.

## Fixtures left

- Orgs `qa-w10r-a`, `qa-w10r-b`; users above (`gone` deleted); ~45 plans `R D*`, songs, two song archives, template `R D4 tpl`, team `R Shared Team`, service type `R Other Type`, access grants.
- Webhook endpoint `3e2799cd-61c5-49b3-81fe-592e1063631d` (enabled) with 2 queued deliveries; signing key `intkey.txt` in the scratchpad; its private API is stopped.
- `qa-w10r-a` people tags, 2 reconciliation reports (merged, kept_separate), 1 pending-link throwaway accounts `acc0..3.qaw10r`.
- Browser profile `w10r-retest` and one open tab on :5180 signed in as owner.
- Worker run at 15:55:05 UTC completed 50 other orgs' deliveries (global).
