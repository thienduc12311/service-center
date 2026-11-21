# QA-13 native iOS parity, wave 8 (W8-NATIVE)

- Package: QA-13 remainder. Commit `897e524` (main + wave 7 fixes), branch `feature/qa-wave8`, frozen.
- Simulator: iPhone 18 Pro (`4A8E05B9-25DD-4AFD-909C-7550BA7C6A70`), iOS 27.2, Expo Go (Metro-served, agent-owned `expo start --port 8082 --localhost` with `EXPO_PUBLIC_*` pointed at local Supabase and my private API).
- API under test: private instance on `:4614` (`RESEND_API_KEY= EXPO_ACCESS_TOKEN=`), stopped by PID to induce failures (chat send, attendance save). Shared `:4000`/`:5173` never stopped. (The first private instance on :4604 was terminated by a SIGTERM I did not send; another process then bound :4604. I moved to :4614.)
- Namespace: orgs `qa-w8-nat-a` (`977fcdd4-a66d-4f28-a736-1bcb26fa21d4`), `qa-w8-nat-b` (`a1a8746d-06c3-4f0a-8d23-2c895d6255b1`). Users `{owner,sched,mem,mem2,mem3,lead,ownb,memb,xorg}.qaw8.nat@example.test`; `xorg` is a member of both orgs. Org/users/memberships via service-role + `private.create_church`; all other fixtures through the API as the proper role; behavior driven through the app, state confirmed via API/DB. Passwords only in the scratchpad.
- Fixture shape (org A): service type Sunday, team Band (Vocals, Bass; roster mem, mem2, lead, xorg), plan "W8 Main plan" (2026-12-06, published; mem Vocals, mem2 Bass, xorg Vocals), "W8 Second plan" (12-13, opportunity), 33 paging plans `W8 Page 01..33`, 105 songs `W8 Song 001..105`, plan chat with mentions. Org B: one plan, team with xorg.
- Method note: typing through the helper is lossy; sign-in used chunked typing and every value was checked from the AX tree. Typed song author came out as "QNative Author" (recorded as actual).
- Expo Go limits: no signed links/widgets/push (QA-14). No Android emulator on this machine: all Android cases NOT_RUN.

## Coverage list built from earlier reports (before this wave)

- Wave 2 (device): smoke, self-approval hidden, claims queue, schedule conflicts, member blockout create/edit/delete, inactive member, church registration, plan screens regression.
- Wave 4: build exports and automated route/unit inventory only; no native workflow cases.
- Wave 6: login/signup/recovery AX, invalid invite and response tokens, signed-out plans gate, scheduler sign-in, plan-order add (SYNC-01 slice).
- Wave 7: accept/decline, plans paging as member, free-form items, notes, chat mention picker and send, notifications delete/undo/commit/open/settings, live viewer, language, MOB-031 peer denial, cross-org plan link, SYNC-01 plan/time/item/note/response plus stale edit.
- Not covered before and taken here: groups in the Results table below.

## Results

| Case ID | Actor | Route | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| MOB-004/005 denied actor | mem2 answers mem's assignment | API `POST assignments/:id/respond` | Refused, no state change | 403 "only your own assignments" for decline and confirm; assignment still unconfirmed, 0 response rows; non-team mem3 403; org-B member 404 | PASS | API/DB |
| MOB-004/005 denied (native view) | mem2 | `(tabs)/index` | Shows only own assignment | Only "Band - Bass" (own) with Accept/Decline; mem's Vocals card absent | PASS | [png](evidence/ios-w8-mem2-schedule.png) |
| MOB-005 decline with reason, replacement path | mem2 | home Decline sheet | declined + reason | `declined`, reason "Sick" stored, "Find a replacement" offered. The sheet's Decline button sits under the tab bar until the screen is scrolled | PASS (see W8-NAT-D2) | [png](evidence/ios-w8-decline-sheet.png) |
| MOB-012 plans paging as scheduler | sched | `(tabs)/plans` | Page 2 once, reaches end, no duplicates | 35 plans, `page=1` and `page=2` (per_page 25) requested once each, no page 3; scrolled to last row "W8 Page 33" | PASS | [png](evidence/ios-w8-sched-plans-end.png) |
| MOB-012 denied direct route | sched | `plan/<org B plan>` | Safe failure | "Plan not found" + retry | PASS | |
| MOB-019 denied non-participant | mem3 | `chat/<plan conv>` + API | No read, no post | Native "Conversation not available"; API GET/messages/POST/open all 404; 0 stray rows | PASS | [png](evidence/ios-w8-mem3-chat-denied.png) |
| MOB-019 failed send then retry one identity | mem | `chat/[id]` | one message row | API stopped; send showed "may or may not have been sent... will not post it twice", text kept; DB 0 rows. API restarted, Try again: exactly 1 row (`7cad90c1-...`) | PASS | [fail](evidence/ios-w8-chat-failed-send.png), [ok](evidence/ios-w8-chat-retry-ok.png) |
| W7-NAT-D1 retest, first open | mem | `notifications` | header matches unread rows | First run (initial Metro bundle): "All caught up" above 3 unread rows, bell label had no count | FAIL (initial, possibly stale bundle, see Defects) | [png](evidence/ios-w8-notif-first-open.png) |
| W7-NAT-D1 retest, clean bundle | mem2, mem | `notifications`, bell | header and bell match | After a clean Metro rebuild: cold feed, notifications created after sign-in: header "12 unread", bell "Notifications, 12 unread", never "All caught up"; mem: "5 unread" and bell "5 unread" | PASS | [png](evidence/ios-w8-notif-d1-retest.png) |
| W7-NAT-D2 retest, native time move | sched | `plan/times/[id]` -> review -> save | header shows new time | 9:00 -> 9:20; review listed affected person; `plans.service_date` 15:20Z; header and service row "9:20 AM" | PASS | DB |
| W7-NAT-D2 retest, API time edit | sched API, mem view | `plan/[id]` | header shows new time | PATCH to 9:40: DB `service_date` 15:40Z; native header "9:40 AM" after the 30 s query staleness window (still 9:20 inside it) | PASS | API/DB |
| MOB-006/007 blockouts, availability | mem | `(tabs)/profile` form | recurrence series, picker | Form reachable; date picker not driven (AX exposes only wheels); no save | NOT_RUN | |
| MOB-008 staffing needs | sched | plan Teams -> Needed positions | counter saved | "One more Bass" x2 saved `Needed` Bass=2 | PASS | DB |
| MOB-008 denied | mem | API | refused | PUT position-needs 403 | PASS | API |
| MOB-008 candidate/guest search, override | sched | `plan/schedule/[id]` | | not exercised | NOT_RUN | |
| MOB-009 open positions + race | mem2 vs mem | `opportunities/[id]` | refused with accurate state | mem claimed last place via API while mem2's confirm sheet was open; mem2 got "Someone else took the last place", state "Full / 0 left"; one assignment created (mem) | PASS | [png](evidence/ios-w8-opp-race-mem2.png) |
| MOB-009 denied | mem3 (not on team) | list + API | not eligible | native/API list empty, GET 404, claim 403 | PASS | API |
| MOB-009 stale list | mem2 | `opportunities/index` | new opportunity appears | List showed "No positions" until pull-to-refresh (cached 30 s) | PASS (observation) | |
| MOB-010 replacement request | mem2 | `replacements/new` -> list | request created once | Unconfirmed assignee gets "isn't available to you" (server rule: declined only); after decline, Ask for a replacement created one `open` request, list shows "0 people asked" | PASS | [png](evidence/ios-w8-replacement-ask.png) |
| MOB-010 denied | mem, mem3 | API | cannot cancel/see | cancel 404, list empty; sched offer to non-team mem3 409 | PASS | API |
| MOB-011 delegated response | mem3 (delegate) | `help/[id]` | answers for mem, recorded as delegate | Accept: assignment confirmed, `assignment_responses.actor_id` = mem3, assignee = mem | PASS | [png](evidence/ios-w8-help-delegate-view.png) |
| MOB-011 revocation during review | mem revokes, mem3 taps Accept | `help/[id]` | safe handoff, no write | "Nothing to help with here: permission stopped"; assignment unchanged | PASS | |
| MOB-011 denied | mem2 | API | no access | list empty, delegation schedule 404 | PASS | API |
| MOB-013 new plan | sched | `plan/new` | defaults, create | Defaults tomorrow-Sunday 10:00; created draft with one 90 min time, `service_date` 16:00Z (America/Chicago) | PASS | [png](evidence/ios-w8-newplan.png) |
| MOB-013 denied | mem | API | refused | POST/PATCH plans, songs, teams, service types: 403 | PASS | API |
| MOB-013 generate, apply template | | `plan/generate`, `apply-template` | | not exercised | NOT_RUN | |
| MOB-015 times + impact review | sched | `plan/times/[id]` | stable id, review | see D2 rows; same plan_time id, review text "moved (was ...)" | PASS | |
| MOB-015 reminder policies visible | sched | plan Teams -> Reminders | truthful labels | "In effect: 3 days before, by In-app, Push, Email"; "sent by the server, not this phone" | PASS | AX |
| MOB-015 reminder edit | | | | not exercised | NOT_RUN | |
| MOB-017 attendance mark and save | sched | `plan/attendance/[id]` | batch review, one batch | Present for mem, review sheet, Save: 1 batch row, record present | PASS | [png](evidence/ios-w8-attendance-saved.png) |
| MOB-017 offline not shown as saved | sched | same | unknown outcome, retry once | API stopped: "No answer... may or may not have saved... same batch is never saved twice"; after restart Try again: "Saved 1 change", 1 batch with 1 idempotency key | PASS | [png](evidence/ios-w8-attendance-offline.png) |
| MOB-017 denied | mem, mem3 | API | refused | GET attendance 403 | PASS | API |
| MOB-018 messages preview | sched | `messages/compose` | recipients preview, honest handoff | Band -> 3 recipients; text says it opens the phone's messaging app, not recorded here, closing is not delivery | PASS | [png](evidence/ios-w8-compose-preview.png) |
| MOB-018 device composer send | | | | simulator has no composer | NOT_RUN | |
| MOB-018 denied | mem | API preview | refused | 403 "Only schedulers and team leaders" | PASS | API |
| MOB-022 calendar subscription | mem3 | `calendar-subscription` | link shown once, then hidden, rotate | Create showed Open/Share once (value not recorded); reopening shows "active... shown only when created", Rotate; DB one hashed row | PASS | [png](evidence/ios-w8-calsub-mem3.png) |
| MOB-022 isolation | mem2 | API | own feed only | `active:false` while mem3 `active:true`, no URL returned on reread | PASS | API |
| MOB-026 files | | `files/add` | | system pickers not driven | NOT_RUN | |
| MOB-028 songs > 100 paging | sched | `(tabs)/songs` | all pages once | 105 songs: pages 1,2,3 (per_page 50) once each, last "W8 Song 105" reached | PASS | AX/log |
| MOB-028 denied | mem3 | API | refused | song create/patch 403 | PASS | API |
| MOB-029 chart + PDF share | sched | `song/[id]` | chart renders, PDF share | Chords over lyrics rendered; Share PDF opened the iOS share sheet (Save to Files, Print) | PASS | [png](evidence/ios-w8-chart-share-pdf.png) |
| MOB-029 denied | org B member, xorg in B | API | no leak | chart 404, song 404 | PASS | API |
| MOB-031 teams list/detail | mem3 | `teams`, `teams/[id]` | roster shows names | Roster lists 3 people all as "Unknown" with initial "U"; API gives `profile:null` for non-owner callers | FAIL (W8-NAT-D1) | [png](evidence/ios-w8-mem3-team-roster.png) |
| MOB-032 across organizations | xorg | `across-organizations` | opt-in only, own items, reauthorized target | Both switches off by default; combined on: next 30 days from A and B (own assignments only), persisted `user_schedule_settings.combined_schedule=t`; tapping the B plan switched church and opened it | PASS | [png](evidence/ios-w8-across-orgs-on.png) |
| MOB-032 denied (single-church member) | | | | not exercised | NOT_RUN | |
| SYNC-01 song native edit | sched | `song/edit/[id]` | DB reflects, revision bumped | author -> "QNative Author", revision 1 -> 2, one row | PASS | DB |
| SYNC-01 song concurrent API edit | sched native, sched API | `song/edit/[id]` | stale refused | API title edit (rev 3) while form open; native Save: "Someone else saved this first, so nothing was saved. Your changes are still here"; DB kept API title and rev 3 | PASS | [png](evidence/ios-w8-song-stale.png) |
| All Android cases | | | | no emulator | NOT_RUN | |
| PUSH-01, WIDGET-01/02, signed links | | | | Expo Go | NOT_APPLICABLE (QA-14) | |

## Defects

- W8-NAT-D1, P2, team roster shows "Unknown" for every teammate to a non-owner. Repro: sign in as a member (`mem3`, on no team), Settings -> Teams -> Band. Expected: names (or an explicit "hidden" label). Actual: three rows "Unknown". API `GET /teams/:id` returns `members[].profile: null` for scheduler and members except for the member's own row; owner sees names. May be an intended directory redaction, but the UI renders it as broken data. Suspected: `mobile/app/teams/[id].tsx:123` (fallback to `common:states.unknown`) with backend team detail profile redaction in `backend/src/routes/teams.ts`.
- W8-NAT-D2, P2, accessibility gaps and a hidden primary action. (a) On `replacements/new` and the attendance review sheet the AX tree exposes only Back/Cancel; the primary "Ask for a replacement" and "Save 1 change" buttons are not exposed (tapping their coordinates works). (b) On My schedule the Decline reason sheet is rendered under the tab bar; its Decline button is only reachable after manually scrolling. Suspected: the shared sheet/bottom-bar components in `mobile/src/components/AssignmentResponses.tsx` and the attendance/replacement screens.
- W8-NAT-D3, P2 (observation), "Plan chat" is offered to a non-participant (mem3 on a published plan) and leads to "Conversation not available". Suspected: `mobile/app/plan/[id].tsx` chat button visibility.
- W7-NAT-D1 retest: the first-open mismatch reproduced once on the first Metro bundle (mem), then did not reproduce after a clean Metro rebuild (mem2 and mem, header and bell counts match). The commit `2ff3d99` with the fix is in HEAD; the first run likely served a cached older transform (the app ran without Supabase env vars then crashed on re-bundle, showing the cache was stale). Treat D1 as FIXED, with that caveat.
- W7-NAT-D2 retest: FIXED from native and from API (see rows).
- No P0/P1 found. Not a defect: list/detail screens stay stale for up to 30 s (global `staleTime`) or until pull-to-refresh.

## Not run / blocked

MOB-006/007 date picker series and team-preferences; MOB-008 candidate/guest search and override; MOB-013 generate/apply-template; MOB-015 reminder edit; MOB-018 device composer send; MOB-026 files/photos pickers; MOB-032 single-church denied; MOB-030 media/scan; MOB-014/016/020/021/023 (done in wave 7); all Android; push, widgets, signed links (Expo Go). Web steps (browser owned by W8-WEB) and delivery worker (W8-INT) not touched.

## Fixtures and device state left

Orgs `qa-w8-nat-a/b` and users above left in the DB (delegation grant mem->mem3 active, xorg combined-schedule on, mem2's decline and open replacement request, mem confirmed on Second plan). Simulator booted, signed out (login shown), appearance Light, text size Large (unchanged). Metro :8082 and private API :4614 stopped; shared :4000 healthy. I used `pkill -f "expo start --port 8082"` once early to restart Metro (matches only that Metro; it does not match any API process). Evidence in `evidence/ios-w8-*.png`.
