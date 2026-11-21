# QA wave 9 native iOS (W9-NATIVE): QA-13 remainder + QA-16 native retests

- Commit `9aaeada` (main), branch `feature/qa-wave9`, no code changes. API under test: shared `:4000` (simulated email/push), reached through my logging proxy on `:4650` (forwards every request unchanged; used to prove page sizes and search parameters).
- Device: iPhone 18 Pro simulator (`4A8E05B9-...`), iOS 27.2, Expo Go 57.0.9, agent-owned Metro on `:8082` (`EXPO_PUBLIC_API_URL=http://localhost:4650`, local Supabase).
- How it was driven: this machine has no `Simulator.app`, so `orca computer` had no window to drive. I built a small XCUITest runner (scratchpad only, `host.exp.Exponent` as target) that reads commands from a file: accessibility tree dump, tap by label/coordinate, type, swipe. Screenshots via `simctl io`. Screens were opened by deep link (`exp://localhost:8082/--/<route>`). The runner was uninstalled from the simulator at the end.
- Namespace: orgs `qa-w9-nat-a` (`4a8e5716-304c-4e44-acfc-5fefd3623100`), `qa-w9-nat-b` (`881b7dc1-b5bd-47af-bafa-ce7a97271e63`, owner only). Users `{owner,sched,mem,mem2,kid,out,ownb}.qaw9.nat@example.test`. Org and members through service-role + `private.create_church`; everything else through the API as the owner; behavior driven in the app per actor. Passwords only in the scratchpad.
- Fixture shape (org A): service type "W9 Sunday"; team "W9 Band" (Vocals, Bass) with roster mem, mem2, kid (login, Person marked child), Kay (child, no login, has email/phone), Gus (adult guest with email/phone), Archie (archived after being added); "W9 Main plan" (published, 2026-12-01, mem Vocals, kid Bass, mem2 Vocals, 2 header items), "W9 Second plan" (12-08, mem Vocals, mem2 Bass), template "W9 Template", 70 `PgNNN Person` people plus 7 literal-symbol/Thai people (85 active, 86 with Archie archived), contact details on mem/mem2.

## Results

### Retests of W8 defects

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-NAT-D1 adults | mem (non-owner) | `teams/[id]` | name, email, phone, DOB for adult teammates | Mia and Max show name, email, +1 phone, birthday; Gus shows name and email | PASS |
| W8-NAT-D1 children | mem | `teams/[id]` | child: name + avatar only | Kit (child login) and Kay show initials and name only, no email/phone/DOB | PASS |
| W8-NAT-D1 archived hidden, no "Unknown" | mem, owner | `teams/[id]` | archived person absent | Header "6 PEOPLE" includes the archived member, rendered as a row "Unknown" with initial "U". API `GET /teams/:id` returns that member with `profile: null` for owner, member and non-member alike | FAIL (W9-NAT-D1) |
| W8-NAT-D2a replacement button in AX tree | mem2... mem | `replacements/new` | "Ask for a replacement" exposed | "Ask for a replacement" is a Button in the tree next to Cancel; tapped: one open request created ("0 people asked"), 1 DB row | PASS |
| W8-NAT-D2a attendance Save in AX tree | sched | `plan/attendance/[id]` | "Save 1 change" exposed | "Review and save" and then "Save 1 change" are Buttons; save gave "Saved 1 change.", 1 attendance record | PASS |
| W8-NAT-D2b Decline sheet not under tab bar | mem | My schedule | sheet buttons visible without scrolling | First card: Cancel/Decline at y 589-637 (visible). Last card (second plan): sheet opens with Cancel/Decline at y 804-852, under the tab bar (tab bar 799+); reachable only after scrolling (screenshot). Buttons are in the AX tree | FAIL (W9-NAT-D2) |
| W8-NAT-D3 non-participant | out | `plan/[id]` | no Plan chat | Quick actions show only "Live" | PASS |
| W8-NAT-D3 child participant | kid | `plan/[id]` | no Plan chat | Only "Live"; position card shown | PASS |
| W8-NAT-D3 not offered before load | owner (leader) | `plan/[id]` | nothing until the plan loads | `GET /plans/:id` held 12 s by the proxy: screen showed only "Opening the plan"; "Plan chat" appeared with the loaded plan | PASS |
| W8-NAT-D3 adult participant | mem | `plan/[id]` -> chat | chat works | "Plan chat" shown; opened the conversation (title, composer); 1 plan conversation row | PASS |

### Mobile People list (`people/index`)

| Case ID | Actor | Expected | Actual | Status |
|---|---|---|---|---|
| PEOPLE-PAGE 25 per page | owner | 25 per request, load more to the end | Proxy log: `limit=25`, then three cursor requests (`limit=25&cursor=...`), 85 unique rows, no fifth request after the last page; "Load more" button is the footer, infinite scroll fetched the pages | PASS |
| PEOPLE-LONG-THAI | owner | long non-Latin name pages and searches | 80-character-plus Thai name is the last row; cursor requests for it succeeded; search `สมชาย` and `ใจดี` return it | PASS |
| PEOPLE-SEARCH server-side | owner | `q` sent to server | `q=Star*`, `Pct%`, `Under_`, `Back\`, `555+0104`, `mem2.qaw9` each a server request | PASS |
| PEOPLE-SEARCH literal symbols | owner | symbols match literally | `Star*` returns only `Star*Name` (not `StarXName`), `Pct%` only `Pct%Name`, `Under_` only `Under_Name`, `Back\` only `Back\Slash` | PASS |
| PEOPLE owner search by login email/phone | owner | matches what rows show | `mem2.qaw9` finds Max; `555 0104` finds Kay | PASS |
| PEOPLE member privacy | mem | rows show no contact; search cannot reach email/phone | Rows show name, avatar, badge only; searches `mem2.qaw9` and `example.test` give "Nobody matches that search."; `Max`, `Star*` work | PASS |
| PEOPLE role-appropriate placeholder | owner, mem | owner "name, email, phone or campus"; member "name or campus" | Both see "Search by name" (`mobileDirectory.searchPlaceholder`). The shared strings `list.searchPlaceholder` / `list.searchPlaceholderMember` are used by the website only | FAIL (W9-NAT-D3) |

### Wave 8 NOT_RUN rows

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MOB-006/007 blockout series, date pickers | mem | Settings blockout form | native pickers, weekly recurrence, review, save | Inline calendar pickers ARE exposed in the AX tree (`DatePicker.NextMonth`, day buttons). Picked Start Dec 12, End Dec 26, Weekly, count 4, reason; review listed 4 dates and "No existing commitments overlap"; Create series wrote 4 rows (each 14 days, as chosen) | PASS |
| MOB-007 team preferences | mem | `team-preferences` | save | "Every other week" -> "Preferences saved." | PASS |
| MOB-013 apply template | sched | `plan/apply-template/[id]` | review count, apply | Review "2 items added at position 1 of 1"; Apply: plan gained "Template header", "Template item" | PASS |
| MOB-013 generate | sched | `plan/generate` | date picker, series review, create | First date Dec 6 (picker), 3 plans, review per date, "Create 3 draft plans": drafts Dec 6, Dec 13, Jan 3 (I tapped Skip on two dates; skipped dates extended the series, so 3 plans were still created) | PASS |
| MOB-015 reminder edit | sched | plan Teams -> Reminders | edit persists, truthful label | 3 days -> 48 h, Push off, saved: "In effect: 2 days before, by In-app, Email", "Set here for this service type"; DB row 2880 min, `{in_app,email}` | PASS |
| MOB-018 device-composer handoff | owner | `messages/compose` | composer opens with text; closing is not delivery | iOS "New Message" composer opened with the text; closed with X; app said "Your messaging app has the text. Service Center can't tell whether you sent it." Actual SMS send not possible on a simulator | PASS (handoff); send BLOCKED |
| MOB-018 observation | sched | `messages/compose` | | Scheduler sees "None of these people have a phone number you can see" for the whole team; owner can text only Kay (the one recipient whose phone it can see) although Mia and Max have a phone on the roster | NOT_RUN (not judged, see Observations) |
| MOB-026 files, photo | sched | `files/add` | permission denial copy; pick and upload | "Don't Allow": "Service Center cannot open your photos..." with Open Settings. After granting, picked an image, "n1.png · 326 KB", Upload: 1 attachment + 1 version row | PASS |
| MOB-026 files, document picker/scan/cancel | | `files/add` | | not driven | NOT_RUN |
| MOB-032 single-church denied | mem | `across-organizations` | nothing to combine | "You belong to 1 church", "nothing to combine yet", both switches off, "Combined schedule is off" | PASS |
| Android (all cases) | | | | no emulator | NOT_RUN |

## Defects

- W9-NAT-D1, P2, archived team member shows as an "Unknown" row and is counted (W8-NAT-D1 not fully fixed). Repro: org with a team that includes a person, archive the person, open Settings -> Teams -> team as any member or the owner. Expected: archived person absent. Actual: "6 PEOPLE" includes a row named "Unknown" (initial "U"). Source: `backend/src/routes/teams.ts:60` (membership with no roster row is returned with `profile: null`; `team_roster_people` omits archived people), rendered by `mobile/app/teams/[id].tsx:123` (fallback `common:states.unknown`). Fix: drop members with null profile in the API or hide them in the client. Evidence `ios-w9-d1-roster-member-unknown.png`.
- W9-NAT-D2, P2, Decline sheet Cancel/Decline hidden under the tab bar on the lower card (W8-NAT-D2b not fixed). Repro: sign in as a member with 2+ pending assignments, My schedule, tap Decline on the lower card without scrolling. Expected: sheet fully visible or scrolled into view. Actual: Cancel/Decline at y 804-852 under the tab bar until the list is scrolled. Source: `mobile/src/components/AssignmentResponses.tsx` (inline reason sheet, around line 363) inside `mobile/app/(tabs)/index.tsx:137` list; no scroll-into-view when the sheet opens. Evidence `ios-w9-d2-decline-sheet-last-card.png`.
- W9-NAT-D3, P2, mobile People search placeholder is not role-appropriate. Expected owner "Search by name, email, phone or campus", member "Search by name or campus". Actual: "Search by name" for both. Source: `mobile/app/people/index.tsx:122` uses `mobileDirectory.searchPlaceholder` (`packages/shared/src/i18n/locales/en/people.json:186`); the web fix at `frontend/src/pages/PeoplePage.tsx:143` was not applied to mobile (commit `91e614d` touched only the paging line). Evidence `ios-w9-people-member-placeholder.png`.

No P0/P1.

## Observations (not defects)

- `messages/compose` as owner offers only recipients "you can see" a phone for; Mia/Max have person phones that team rosters show to members, yet are not offered (preview recipient phones come from a different source). Worth a product check, not verified in code.
- A recipient list for a team message includes child people (Kay, Kit); not checked against policy.
- `simctl privacy grant` terminates Expo Go; the app was relaunched.
- Wave 8 caveat repeated: I used `pkill -f` once on my own dead `xcodebuild test-without-building ... DrvUITests` command line only; no other process was touched.

## Not run / blocked

All Android (no emulator). MOB-018 actual SMS send (simulator has no carrier, send arrow disabled). MOB-026 document picker, "Scan pages", picker-cancel path, URL renewal. Push, widgets, signed links (Expo Go, QA-14).

## Fixtures left in place

Orgs `qa-w9-nat-a/b` and users above. Org A now also holds: mem's declined assignment on "W9 Second plan" with an open replacement request, mem2 Present on the Main plan, 2 applied template items on the Second plan, 3 generated draft "W9 Template" plans, mem's 4-row blockout series, mem's team preference, a service-type reminder policy (48 h, in-app+email), one uploaded image attachment on the Main plan, one plan conversation (no messages). Evidence: `evidence/native/ios-w9-*.png`.

## Simulator end state

Booted, Expo Go signed out (login screen), Light, text size Large. My Metro (PID 39554 and its npm wrapper 39370), the logging proxy (PID 70038) and the XCUITest runner are stopped and the runner app is uninstalled. `:4000` still healthy.
