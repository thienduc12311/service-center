# QA-13 native iOS parity, wave 7

- Package: QA-13 (continuation). Commit `473fb69` (main), branch `feature/qa-wave7`.
- Simulator: iPhone 18 Pro (`4A8E05B9-25DD-4AFD-909C-7550BA7C6A70`), iOS 27.2, Expo Go 57.0.9, owned Metro `expo start --port 8082 --localhost`, local API :4000 and Supabase.
- Namespace: orgs `qa-20261120-nat-a` (`b437482c-0b8b-431a-aa96-075542c43a23`) and `qa-20261120-nat-b`; users `{sched,mem,mem2,ownb}.qa20261120.nat@example.test`. Org and members created with service-role/SQL (`private.create_church`, member insert); everything else (plans, assignments, release, notifications via chat) via API setup; all asserted behavior driven through the app. Passwords in the scratchpad only. Sync cases used the W7-WEB org `qa-20261120-sync-a` (see `sync-handoff.md`).
- Method: Orca emulator helper (AX tree, tap, type, gesture) plus `xcrun simctl openurl`/`screenshot`. Typing is occasionally lossy through the helper (dropped characters); every typed value was verified from the AX tree.
- Expo Go limits: no signed links/widgets/push.

## Results

| Case ID | Actor | Route | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| W6-NATIVE-D1 / UX-02.ios.login.input-names | anonymous | `(auth)/login` | Email and Password inputs expose localized names in AX | TextField nodes carry AXLabel "Email" and "Password" (fix 9df64ec is an ancestor of HEAD) | PASS | [ax](evidence/ios-login-accessibility.json), [png](evidence/ios-login.png) |
| MOB-004 accept | member | `(tabs)/index` card Accept | Assignment confirmed through respond_as_self | Card moved to Confirmed; DB `assignments.status=confirmed`, one `assignment_responses` row (previous unconfirmed) | PASS | DB |
| MOB-005 decline with reason | member | `plan/[id]` Decline sheet | Declined, reason stored | "Out of town" stored in `response_note`, status declined, replacement prompt shown | PASS | DB |
| MOB-004/005 denied actor (other member answers) | mem2 | n/a | Refused | not exercised | NOT_RUN | |
| MOB-012 plans paging | member | `(tabs)/plans` | Page 2 loads once, stable order | 33 plans, 25/page; scrolling loaded page 2, items 01..30 sequential, no duplicates | PASS | AX |
| MOB-012 paging as scheduler | scheduler | `(tabs)/plans` | same | not exercised | NOT_RUN | |
| MOB-014 add free-form item | scheduler | `plan/add-item/[id]` | Row persists with length and notes | Row created (title garbled by the typing helper, length 180, note kept) | PASS | DB |
| MOB-014 edit item | scheduler | `plan/edit-item/[id]` | Title change saved | Title saved | PASS | DB |
| MOB-014 remove item | scheduler | PlanOrder Remove | Confirmed removal | Item deleted after confirm | PASS | DB |
| MOB-014 denied (no edit capability) | member | `plan/[id]` | No edit controls; API refuses | No Add/Edit/Remove in AX; API POST items returned 403 | PASS | API |
| MOB-016 plan note | scheduler | `plan/note/[id]` | Audience "scheduled" note saved | Saved, revision 1; scheduled member reads it via API | PASS | DB/API |
| MOB-016 denied reader | mem2 (not scheduled) | API `GET notes` | No note returned | empty list, `can_edit:false` | PASS | API |
| MOB-019 chat mention picker | member | `chat/[id]` | "@Nat S" lists the scheduler | Suggestion row appears; picking inserts "@Nat Scheduler" | PASS | AX |
| MOB-019 send, formatting, no duplicate | member | `chat/[id]` | Message shows immediately, markers rendered, one row | Rendered "bold"/"italic" immediately, DB body keeps `**bold**`, one message row, mention row resolution `notified` | PASS | [png](evidence/ios-chat-sent.png) |
| MOB-019 failed send then retry keeps one identity | member | `chat/[id]` | one row | needs an induced API failure; API restart not permitted | NOT_RUN | |
| MOB-019 denied non-participant | | | | not exercised | NOT_RUN | |
| MOB-020 swipe to delete | member | `notifications` | Swipe reveals Delete, row hides, toast | Delete revealed, row removed, "Notification deleted / Undo" toast | PASS | [png](evidence/ios-notif-swiped.png), [toast](evidence/ios-notif-undo-toast.png) |
| MOB-020 undo | member | `notifications` | Row returns, DB keeps it | Row restored, DB count unchanged | PASS | DB |
| MOB-020 commit after toast | member | `notifications` | Row deleted server-side after toast | DB 3 to 2 about 9 s later | PASS | DB |
| MOB-020 open notification | member | `notifications` | Opens exact chat | Opened the plan's conversation, row marked read | PASS | |
| MOB-020 unread eyebrow on first open | member | `notifications` | Count matches listed unread rows | Eyebrow "All caught up" shown above four unread rows for about a minute until the 60 s poll | FAIL (W7-NAT-D1) | AX |
| MOB-020 notification-settings | member | `notification-settings` | Mute and email reminder toggles persist | Chat mute -> `conversation_member_states.muted=t`; Email off -> `person_reminder_preferences.email=false`; push says unavailable in Expo Go | PASS | [png](evidence/ios-notification-settings.png), DB |
| MOB-023 Live refresh | member | `plan/live/[id]` | Viewer sees run appear and advance without manual refresh | "No run yet" became "Open - Ready", then "Live" with countdown within about 8 s of API actions; read-only, no controls | PASS | [png](evidence/ios-live-member.png) |
| MOB-021 language switch | member | `(tabs)/profile` | Vietnamese applies app-wide, persists, switch back | Tiếng Việt: settings, plans, notifications localized; `people.preferred_language=vi`; English restored (`en`) | PASS | [png](evidence/ios-profile-vi.png), DB |
| MOB-031 denied | member | `people/[id]` (peer and org-B person ids) | Denied | Both deep links land on the People directory; no detail shown; peer email hidden; API 403 | PASS | [png](evidence/ios-member-people-peer.png) |
| MOB-031 allowed | scheduler (owner) | `people/[id]` | Detail visible | Name, email, roster, teams, tags shown | PASS | AX |
| MOB-003 deep link other org's plan | member | `exp://.../plan/<org-B plan>` | Safe failure | "Plan not found" with retry; no title or data | PASS | [png](evidence/ios-member-crossorg-plan.png), [ax](evidence/ios-member-crossorg-plan.json) |
| SYNC-01 read web resources | sync scheduler | `plan/[id]` | Plan, time, items, note, assignment all render | All five render with correct values (America/Chicago) | PASS | [png](evidence/ios-sync-plan-render.png) |
| SYNC-01 edit time | sync scheduler | `plan/times/[id]` | time changed, same id, revision bumped | 17:30Z to 17:31Z, same id; content_revision 3 to 4 | PASS | DB |
| SYNC-01 rename item | sync scheduler | `plan/edit-item/[id]` | renamed once | header renamed; revision 5 | PASS | DB |
| SYNC-01 edit note | sync scheduler | `plan/note/[id]` | note revision 2 | note body updated, revision 2, one row | PASS | DB |
| SYNC-01 member responds | sync member | `(tabs)/index` | confirmed, single response | confirmed; staffing_revision 3 to 4; one assignment and one response row | PASS | DB, [png](evidence/ios-sync-member-after.png) |
| SYNC-01 concurrent stale edit | sync scheduler | `plan/edit-item/[id]` | Stale save refused, no silent overwrite | Native showed "Someone else changed this plan..." and kept DB title; explicit "Load the latest plan and keep my edits" then saved (revision 7) | PASS | [png](evidence/ios-sync-stale.png) |
| PUSH-01 push arrival | | | | physical device only | NOT_APPLICABLE | QA-14 |

## Defects

- W7-NAT-D1, P2, notifications screen header stale. Repro: member has unread notifications created while the app is open (sign in, have a scheduler post mentions, then open `exp://127.0.0.1:8082/--/notifications` within a minute). Expected: eyebrow reads "N unread" matching the rows. Actual: "All caught up" above four "Unread:" rows until the 60 s poll refreshes the count. Suspected: `mobile/app/notifications.tsx:128` uses the provider `unread` (polled, `mobile/src/providers/NotificationsProvider.tsx:62,95`) while the list comes from its own query; the screen does not refetch the count on mount.
- W7-NAT-D2, P2 (shared with web; unconfirmed on web), plan header date not updated when the service time changes. Repro: Edit times, move the only service time 11:30 to 11:31 and save. Expected: plan header and Plans list show the new time. Actual: header "Sun, Nov 29 - 11:30 AM" (plans.service_date, list ordering) while the service row and Order show 11:31 AM. Suspected: `backend/src/routes/plans.ts` (PATCH with `times` does not touch `service_date`).
- No P0/P1 found in the executed scope.

## Not run / blocked

- Denied-actor variants for MOB-004/005, MOB-019 non-participant, scheduler plans paging, failed-send retry (needs induced API failure; not allowed), push/widgets/universal links (QA-14), MOB-013/015/017 and other matrix rows beyond those listed, dark mode and large text re-check, Android.

## Cleanup

All app sessions signed out (login screen shown). Simulator appearance light and text size large, unchanged. Metro on 8082 stopped (port free). Orca emulator helper detached; simulator left booted. Fixtures (qa-20261120-nat-a/b) left in the DB for the coordinator. The app account found on the device at start (a prior-wave fixture user) was signed out in the process. Sync edits appended to `sync-handoff.md`.
