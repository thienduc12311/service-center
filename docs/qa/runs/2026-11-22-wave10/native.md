# QA wave 10 native iOS (W10-NATIVE)

- Package W10-NATIVE, commit `f79aa50` (branch `feature/qa-wave10`), no code changes.
- Device: iPhone 18 Pro simulator (`4A8E05B9-...`), iOS 27.2, Expo Go 57.0.9, my Metro on `:8082` (started with the process env `EXPO_PUBLIC_API_URL=http://localhost:4660`, `.env` untouched), a logging/fault-injecting proxy on `:4660` forwarding to the API under test `:4200`. Local Supabase.
- Driven with an XCUITest runner (host `host.exp.Exponent`, command-file driven: tree dump, tap by label/coordinate, type, swipe) rebuilt from the wave 9 design in my scratchpad; screens opened by `exp://localhost:8082/--/<route>`; screenshots via `simctl io`. No Simulator.app window exists. Runner uninstalled at the end.
- Namespace: orgs `qa-w10-nat-a` (`dec67817-10e5-40c0-8412-c6fe9d2cc4d1`), `qa-w10-nat-b` (owner only). Users `{owner,sched,mem,mem2,kid,out,ownb}.qaw10.nat@example.test`. Passwords only in the scratchpad.
- Fixtures (org A): service types "W10 Sunday", "W10 Midweek"; teams "W10 Band" (Vocals, Bass; 29 active members: mem, mem2, kid, Pg01-Pg25, Nomail Person; Archie archived) and "W10 Big team" (14 positions Pos01-Pos14, 5 members); 40 `PgNN Person` people (47 in the roster); plans "W10 Main plan" (published; Welcome/Closing headers, Song 01, Song 02), "W10 Second plan" (published; 15 scheduled), "W10 Draft plan" (published during the run), "W10 Draft two" (draft); 14 songs; 34 operational messages; a media item; a 20 s WAV on Song 02 and plan files.
- Limits of the environment: the software keyboard is not shown (hardware keyboard attached), so keyboard-lift behaviour could not be observed; the simulator has no camera; Expo Go (no WidgetKit); no Android.

## Results

### 1. W9-NAT-D2 retest: decline/withdraw sheet

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W9-NAT-D2 lower card | mem | My schedule, lower of two pending cards, Decline | Full-screen bottom sheet above the tab bar; Cancel/Decline reachable without scrolling | Sheet slides over the whole screen, backdrop dims list and tab bar; Cancel y776-824 and Decline y776-824, home-indicator padding visible (`ios-w10-d2-decline-sheet.png`) | PASS |
| W9-NAT-D2 decline persisted | mem | same | Decline with reason saved | Status declined; `assignment_responses` row `declined / "Away that week"`; card shows "Your decline stays recorded" plus "Find a replacement" | PASS |
| W9-NAT-D2 withdraw | mem | confirmed card, Withdraw... | Same sheet, "Keep" and "Withdraw" | Sheet title "Withdraw your confirmation for ...?", buttons Keep/Withdraw at y776; Keep closes with no change (`ios-w10-d2-withdraw-sheet.png`) | PASS |
| W9-NAT-D2 VoiceOver labels | mem | sheet AX tree | titled sheet, labelled text view, labelled buttons | Heading text, TextView "Reason (optional)", Buttons "Cancel"/"Decline"/"Keep"/"Withdraw"; `accessibilityViewIsModal` set in source (`AssignmentResponses.tsx:521`) | PASS (tree only, no real VoiceOver run) |
| W9-NAT-D2 keyboard aware | mem | sheet with text focused | sheet lifts above keyboard | Text view focused and typed into but the software keyboard is not drawn in this simulator, so no lift observed. Source uses `KeyboardAvoidingView` (`:513`) | NOT_RUN (environment) |
| W9-NAT-D2 not dismissible while sending | mem | sheet | backdrop/back ignored while sending | Send completes in under 2 s, could not catch the in-flight state. Source `dismiss()` guards on `busy` (`:509`) | NOT_RUN (source-confirmed only) |

### 2. W9-NAT-D3 retest

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W9-NAT-D3 owner hint | owner | `people` | "Search by name, email, phone or campus" | Placeholder exactly that (`ios-w10-d3-owner-people.png`) | PASS |
| W9-NAT-D3 member hint | mem | `people` | "Search by name or campus" | Placeholder exactly that (`ios-w10-d3-member-people.png`) | PASS |
| W9-WEB-D2 mobile People retry | owner | `people`, proxy answers `/people/page` 503 | error + retry; retry loads | "Service Center is having trouble right now..." with "Try again"; removing the fault and tapping it loaded the list (`ios-w10-d3-people-retry.png`) | PASS (button reads "Try again", not "Retry") |
| W9-WEB-D2 mobile Teams retry | owner | `teams`, `/teams` 503 | same | Same message and "Try again"; recovered to W10 Band / W10 Big team (`ios-w10-d3-teams-retry.png`) | PASS |

### 3. Never-covered MOB cases

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MOB-001 dark theme | owner | home, plan | readable in dark, Light/Dark/System radios, safe areas | Dark applied app-wide; text/chips/cards readable; header and tab area clear of status bar and home indicator (`ios-w10-mob001-dark-*.png`). Reset to System afterwards | PASS |
| MOB-001 keyboard / both themes on every screen | | | | Software keyboard not available; only home/plan/profile screens checked in dark | NOT_RUN (partial) |
| MOB-002 plan -> song -> back | owner | plan item -> `song/[id]` | song opens in plan context, Back returns to the plan | Song screen eyebrow "W10 MAIN PLAN", service key/arrangement; Back returns to the same plan | PASS |
| MOB-002 chart / arrangement picker / no override leak | | | | no chart or second arrangement in fixtures (songs have none) | NOT_RUN |
| MOB-024 rehearsal player | owner | `plan/rehearse/[id]` | track from song file plays | "1 track", Play moved 0:00 -> 0:03 (real audio), Pause, seek bar; back/forward 10 s, repeat, next/prev (`ios-w10-rehearse.png`) | PASS |
| MOB-025 offline pack | owner | rehearse -> Download | explicit pack, cold offline launch, local playback, isolation | "Download 4 files (950 KB)" -> "Ready offline", verify-by time shown; with the API proxy stopped and a cold app launch: error screen offers "Use offline downloads", pack listed, Open shows the order, Play ran 0:03 of 0:20 from the device. Signing out then signing in as mem: "Nothing is saved for offline use" (pack removed, not visible to another account) | PASS |
| MOB-026 document picker cancel | owner | `files/add` -> Choose a file | system picker opens; X returns to a usable form | Files sheet ("No Recents") opened; cancel returned with buttons re-enabled and nothing picked (`ios-w10-doc-picker.png`) | PASS |
| MOB-026 document picker pick | | | | No document available in the simulator's Files without extra provisioning | NOT_RUN |
| MOB-026 scan pages (From Photos) | owner | `files/add` -> Scan pages | one reviewed PDF uploaded | Added one Photos image as page 1, "Make PDF (1 page)" -> "Scan ... .pdf · 12 KB", Upload: attachment `application/pdf`, 12,765 bytes | PASS |
| MOB-026 scan "Take a photo" / "Add a page" | owner | scan stage | camera unavailable handled | Expo Go crashed (SIGABRT, `-[UIImagePickerController setSourceType:]` throws on a device with no camera, `ImagePickerModule.launchLegacyImagePicker`). No `isCameraAvailable` guard at `mobile/src/lib/scan-capture.ts:51-55`. Simulator-only trigger | PASS-with-observation (see Observations) |
| MOB-027 speed controls | owner | rehearse | 0.5-1.25x, tempo-only, no pitch/loop advertised | 0.5x selected while playing (position kept advancing); options 0.5/0.75/0.9/1/1.1/1.25; copy "changes the tempo only: pitch and key stay as recorded"; only track Repeat offered. Heard-tempo label not checked (song has no tempo) | PASS (label NOT_RUN) |
| MOB-030 media | owner | `media`, `media/[id]` | read-only metadata, add a file | Detail shows title, creator, 0:45, theme; text "Title, details, thumbnail and archiving are changed on the website"; "Add a file" available. List showed the empty state from an earlier visit until the cache expired (see Observations) | PASS |
| MOB-030 scan reviewed PDF upload | owner | see MOB-026 scan | iOS reviewed PDF upload | as above | PASS |
| MOB-033 widget | | small/medium/lock-screen | installed extension | Expo Go has no WidgetKit extension (`mobile/app.config.js:76-84` says so) | BLOCKED |
| Compose phone visibility | owner | `messages/compose` -> Preview -> Choose people to text | recipients with phones the caller can see | "None of these people have a phone number you can see" although Mia and Max (preview recipients) have phone numbers in `people` and the owner's person detail returns them | FAIL (W10-NAT-D1) |

### 4. Earlier FAIL rows re-run

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MOB-020 notifications header | owner | `notifications` | unread eyebrow matches rows on first open | A scheduler assigned the owner while the app was open; first open: "3 unread" and 3 unread rows; DB 3 unread/3 (`ios-w10-notifications.png`). Bell label earlier "Notifications, 2 unread" | PASS |
| MOB-020 notification-settings | owner | `notification-settings` | independent controls | Push unavailable in Expo Go with in-app fallback text; badge Unread count/Off selectable; mention-email switch off persisted (`mention_email=false`) (`ios-w10-notification-settings.png`) | PASS |
| MOB-020 OS-denied push recovery | | | | cannot be shown in Expo Go (push unsupported) | BLOCKED |
| MOB-031 archived member | owner, mem | `teams/[id]` | archived person absent, no "Unknown" row | Added and archived Archie to the Band: header stays "29 PEOPLE", no Unknown row; `GET /teams/:id` as owner, mem and out: 29 members, 0 null profile (W9-NAT-D1 fixed) | PASS |
| MOB-031 member roster fields | mem | `teams/[id]` | name, email for adults | Pg rows show name and email | PASS |
| MOB-031 route denial | mem | `people/[id]`, REST | non-owner cannot open profile | Deep link lands on the People list; `GET /people/:id` as mem 403 for others and self; mem search `example.test` returns 0 | PASS |

### 5. Mobile halves of new features

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ADR-0006 draft banner | owner | `plan/[id]` of a draft | banner, Publish action | "Draft - people you schedule won't be notified until you publish." and Publish tile; banner gone after publishing (`ios-w10-adr6-draft-plan.png`) | PASS |
| ADR-0006 schedule copy | owner | `plan/schedule/[id]` on draft | notify option replaced | "People will be notified when this plan is published." (`ios-w10-adr6-schedule-draft.png`) | PASS |
| ADR-0006 quiet draft | owner API | assign 3 people on the draft with `notify` | no delivery before publish | `assignments.notified_at` null, no effects before publish | PASS |
| ADR-0006 publish confirmation | owner | `plan/publish/[id]` | who is emailed, who has no address, notify default on | "Publishing will email 2 people." and "No email address on file, so not emailed: Nomail Person."; Notify people on (`ios-w10-adr6-publish-confirm.png`) | PASS |
| ADR-0006 publish result | owner | Publish | status published, one request per person | plan `published`; 1 effect, email `simulated` for Max and Pg01, Nomail `skipped`, Max in-app delivered | PASS |
| ADR-0006 publish as scheduler / quiet unchecked / no-op republish | | | | not run | NOT_RUN |
| Plans tab title search | owner | `plans` | debounced server search | Typing "Main": one `GET /plans?...&q=Main` (no per-keystroke requests) (`ios-w10-plans-search.png`) | PASS |
| Schedule people server-paged, team scoped | owner | `plan/schedule/[id]` | `people/page` with `team_id`, "on team" labels, Team members / Everyone | `GET /people/page?limit=50&team_id=...`; segments "Team members (5)" / "Everyone (47)"; rows "on team" | PASS |
| Chip wall -> searchable list | owner | schedule, Position | 14 options in a searchable list | "Position: Choose..." with "14 options"; sheet with "Search positions"; "Pos13" narrows to one | PASS |
| Song browser insert-after | owner | `plan/add-item` | add several, anchor "after" | Add songs 01 and 02 ("2 added"); from an item's menu "Add songs after this" -> "Adding after "W10 Song 01"". The insert landing position itself not asserted (anchor was last) | PASS (landing position NOT_RUN) |
| Move to... on order items | owner | plan Order | pick position, one reorder request | "Move W10 Song 02 to..." menu lists positions; picking 1 sent a single `PUT /plans/:id/items/order`; DB `sort_order` Song 02 = 0 (`ios-w10-move-to-sheet.png`) | PASS |
| Attendance SectionList + filter | owner | `plan/attendance/[id]` | grouped by team, name filter past 10 | 3-person plan: no filter, "W10 Band - 3 people"; 13-person plan: "Filter by name", "Pg07" leaves one row (`ios-w10-attendance-filter.png`) | PASS |
| Team roster grouped + search | owner, mem | `teams/[id]` | grouped by position, search | "No position - 29" group, "Search members", "Pg07" -> "No position - 1"; no position assigned in the fixture, so multi-position grouping not exercised | PASS (multi-group NOT_RUN) |
| Messages paging on `before` | owner | `messages` | 30 then cursor page | `GET /messages?box=sent&limit=30`, then `...&before=<ts~id>`; msg 34 down to 01 reached, no third request | PASS |
| Compose recipients searchable review | owner | `messages/compose` | collapsed summary, searchable review | Summary "Kit Kidlogin, Mia Member, Pg01 Person and 25 more", "Review 29 recipients" sheet with "Search by name"; "Pg2" -> Pg20-Pg25 with Include checkboxes (`ios-w10-compose-review.png`) | PASS |
| I18N-01 Vietnamese | owner | `profile`, ~15 screens | Vietnamese UI, no raw keys | Selecting "Tieng Viet" switched the UI (Giao dien, Lich cua toi, Phan cong nguoi); scan of the AX labels on 15 screens found no dotted keys, `{{`, undefined | PASS |
| I18N-01 persistence | owner | relaunch | language survives | Cold relaunch shows Vietnamese home | PASS |
| I18N-01 automatic | owner | `profile` | Automatic follows device (English), persists | "Tu dong (English)" selected, cold relaunch English | PASS |
| I18N-01 explicit "English" option | | | | not exercised separately | NOT_RUN |

## Defects

- W10-NAT-D1, P2, owner People list and compose "Choose people to text" miss phone numbers of people with a login. Repro: owner, a team member with a login (Mia) whose `people.phone` is set; `GET /people` and `/people/page` as owner return `phone: null` for her while `GET /people/:id` returns `+1 555 0101`; mobile compose -> Preview (Band) -> Choose people to text says "None of these people have a phone number you can see". Expected: the owner sees the same phone the detail shows. Suspected: `backend/src/model/people.ts:73` fills `phone` from `member.profile.phone` for linked rows (standalone rows at `:92` use `person.phone`); `person.phone` is ignored. Evidence `ios-w10-compose-phone-owner.png`. Carries over the wave 9 observation. Scheduler/member nulls remain intended.

No P0/P1.

## Observations (not counted as defects)

- Expo Go terminates (SIGABRT) when the scan stage's "Take a photo"/"Add a page" opens the camera on a device without one; `scan-capture.ts` calls `launchCameraAsync` with no camera-availability check. Physical iPhones have cameras, so likely simulator/iPad-only; a guard would be cheap (P3).
- Media list kept showing "No media yet" after a media item was created by API until the query went stale; the detail route worked.
- Team roster rows inside a position group are not in name order (Pg03, Pg23, Pg08...).
- The wave 9 expectation word is "Retry"; the shipped button is "Try again".
- Process note: once I ran `pkill -P 1 -f "xcodebuild test-without-building.*w10-nat"` while shutting down, scoped to my own runner command line; nothing else was touched. `:4200` stayed healthy throughout.

## Not run / blocked

- MOB-033 widgets: BLOCKED, needs a development/release build with the `expo-widgets` extension (`eas build --profile development --platform ios` or `expo prebuild` + Xcode run on the simulator), signed in, then add the small/medium/lock-screen widget.
- MOB-020 OS-denied push recovery: needs the same dev build (Expo Go has no push).
- Software-keyboard behaviours (decline sheet lift, compose); disable "Connect Hardware Keyboard" in Simulator.app, which does not run here.
- Document picker pick path, MOB-002 chart/arrangement leak, multi-position roster grouping, heard-tempo label, ADR-0006 scheduler/quiet-publish variants, explicit English language pick.
- All Android.

## Fixtures and simulator state left

- Orgs `qa-w10-nat-a/b` and users above stay. Org A holds the fixtures listed in the header plus: mem's declined Second plan assignment with reason, mem's confirmed Main plan assignment, owner assigned (Bass) to the Second plan, plan files (WAV x2, scan PDF), song file on Song 02, the published "W10 Draft plan" with simulated deliveries, owner's `mention_email=false`.
- Simulator: booted, Expo Go signed out (login screen), theme System, language Automatic, runner `qa.drv.uitests.xctrunner` uninstalled. Metro (:8082) and my proxy (:4660) stopped. `:4200` healthy. Another session's `qa.runner.RTests.xctrunner` was already installed and left alone. Evidence: `docs/qa/runs/2026-11-22-wave10/evidence/native/ios-w10-*.png`.
