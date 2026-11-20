# W7-WEB web UI regression, retests and SYNC-01 web half

Package W7-WEB. Commit `473fb69` (main, branch `feature/qa-wave7`). Browser: Orca embedded browser (Electron/Chromium) with a dedicated isolated profile `qa-wave7-web`, driven through the `orca` CLI. Web app `http://localhost:5173`, API `:4000`, local Supabase. Viewports: desktop (1280x900; 989 px content width in some pages) and narrow 390x844 mobile emulation. Locales: English and Vietnamese. Namespace: orgs `qa-20261120-web-a`, `qa-20261120-web-b`, `qa-20261120-sync-a`; users `<alias>.qa20261120.web@example.test` (owner, admin, scheduler, member, member2, ownerb) and `<alias>.qa20261120.sync@example.test`. Passwords are only in the scratchpad (not in this report or screenshots). Fixtures were created through the service-role and admin API; every feature under test was driven through the UI unless a row says "API".

Totals: 70 executed cases, 64 PASS, 6 FAIL, 0 BLOCKED, 0 NOT_RUN rows; other untested items are listed at the end. The 6 FAIL cases group into 5 defects (all P2).

## A. Retests

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| W6-UX-D1.enter | anonymous, /login | desktop, en | Enter on language trigger opens menu and focus enters first item | focus on `menuitemradio` English | PASS | observation only |
| W6-UX-D1.arrows | anonymous | desktop, en | ArrowDown/ArrowUp move focus (wrap) | Down: Vietnamese, Down: English, Up: Vietnamese | PASS | observation only |
| W6-UX-D1.escape | anonymous | desktop, en | Escape closes, focus returns to trigger | menu removed, focus on trigger | PASS | observation only |
| W6-UX-D1.select | anonymous | desktop | Enter on item selects, `lang=vi`, focus back on trigger | `lang=vi`, trigger focused, menu closed | PASS | observation only |
| W6-UX-D2.enter | scheduler/owner | desktop, en | Enter on Account menu opens and focuses first item | focus on `Settings` menuitem, `aria-expanded=true` | PASS | observation only |
| W6-UX-D2.arrows | same | desktop | Down/Up/Home/End move among items | Down: Sign out, Down: Settings (wrap), Up, End, Home all correct | PASS | observation only |
| W6-UX-D2.escape | same | desktop | Escape closes, focus on trigger | closed, trigger focused | PASS | observation only |
| W4-I18N-D1.songs | owner | desktop, vi | "0/1/3 bai hat" with no English fallback | "0 bài hát", "1 bài hát", "3 bài hát" | PASS | [songs=3](evidence/web-vi-plural-songs-3.png) |
| W4-I18N-D1.plans | owner | desktop, vi | plan list counts localized | "0 bài hát 0 đã xác nhận" | PASS | observation only |
| W4-I18N-D1.bell | member2 | desktop, vi | bell label for many/0/1 | "14 chưa đọc", "Thông báo", "1 chưa đọc" | PASS | [0](evidence/web-vi-plural-bell-0.png), [1](evidence/web-vi-plural-bell-1.png) |
| W5-UX-D1.focus | owner | 390 px, en | New plan dialog focus enters title, Tab stays inside, Escape returns focus, body scroll restored | `#plan-title` focused, focus trapped after 12 Tabs, Escape focused New plan, overflow cleared | PASS | observation only |
| W5-UX-D2.name | owner | 390 px, en | initials-only account trigger has accessible name | `Account menu` (visible text "OW") | PASS | observation only |

Retest verdicts: W6-UX-D1 PASS, W6-UX-D2 PASS, W4-I18N-D1 PASS in the browser (the plural forms render localized for 0, 1 and many), W5-UX-D1 and W5-UX-D2 PASS. A Tab from the open account menu closes it and moves focus on (acceptable per APG).

## B. New feature UI

### Chat: mentions, Enter, formatting, hostile text, non-blocking send (plan chat of `QA Web Plan 1`)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| CHAT-MENTION.open-filter | owner | desktop, en | typing `@` opens listbox of participants, typing filters | 4 candidates, filtered to Member Web and Member2 Web | PASS | observation only |
| CHAT-MENTION.pick-send | owner | desktop | ArrowDown + Enter inserts `@Member2 Web`; send stores one mention | text `Hi @Member2 Web `, DB mention count 1, mentioned user got a `conversation_mention` notification | PASS | [pill](evidence/web-chat-hostile-desktop.png) |
| CHAT-MENTION.escape | owner | 390 px | picker stays inside viewport, Esc closes it, text kept | listbox x 33-289 of 390, Esc closed, `@` kept | PASS | [390](evidence/web-chat-mention-390.png) |
| CHAT-SEND.enter | owner | desktop | Enter sends | message posted, composer cleared | PASS | observation only |
| CHAT-SEND.shift-enter | owner | desktop | Shift+Enter inserts newline, no send | value `line1\nline2`, no new DB row; Enter then sent it as one message | PASS | observation only |
| CHAT-SEND.ime | owner | desktop | Enter with `isComposing`/keyCode 229 does not send | synthetic keydown not prevented, nothing sent (synthetic events, no real IME) | PASS | observation only |
| CHAT-FORMAT.styles | owner | desktop | bold/italic/strike/code render | rendered as styled spans | PASS | [shot](evidence/web-chat-hostile-desktop.png) |
| CHAT-FORMAT.hostile-markup | owner | desktop and 390 | `<script>`, `<img onerror>`, `<b>` shown as text, nothing executes | `window.__xss` stayed undefined, 0 script/img elements | PASS | [390](evidence/web-chat-hostile-390.png) |
| CHAT-FORMAT.links | owner | desktop | `javascript:`/`data:` text not linked; http(s) link has `noopener noreferrer`, `_blank` | only the https link is an anchor, rel and target correct | PASS | observation only |
| CHAT-FORMAT.long-word | owner | desktop and 390 | 300-char word and `x/` run wrap, no horizontal scroll | scrollWidth equals viewport on chat, notifications, teams, plan at 390 | PASS | [shot](evidence/web-chat-hostile-desktop.png) |
| CHAT-FORMAT.rtl | owner | desktop | Arabic/Hebrew text intact | text preserved in order, `unicode-bidi: isolate`; alignment not asserted | PASS | observation only |
| CHAT-FORMAT.dunder | owner | desktop | `a.__init__ ... b.__init__` shown literally | rendered `a.init then b.init`, "init" italic (underscores consumed) | FAIL, W7-WEB-D3 | observation only |
| CHAT-NONBLOCK.pending | owner | desktop | message appears immediately, composer re-enabled while send is slow | bubble with "Sending" at t+0.8 s with fetch delayed 4 s, composer empty and enabled, DB row only after delay | PASS | [shot](evidence/web-chat-sending-pending.png) |
| CHAT-NONBLOCK.fail-retry | owner | desktop | failure state, retry, exactly one message | "Not sent: Could not reach..." plus Try again; after retry DB count 1, one bubble | PASS | [shot](evidence/web-chat-send-failed.png) |
| CHAT-VI.labels | owner | desktop, vi | no raw keys | composer, mention button, send localized; no key-like strings | PASS | observation only |

### Notifications (as member, member2)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| NOTIF.delete-undo-window | member | desktop, en | row and bell count drop at once, toast with Undo, DB not yet changed | bell 12 to 11, toast "Notification deleted Undo", DB still 12 | PASS | [toast](evidence/web-notif-undo-toast.png) |
| NOTIF.undo | member | desktop | Undo restores row and count and nothing is deleted | rows 11 and bell 11 restored, DB stayed 11 after 7 s | PASS | observation only |
| NOTIF.delete-persists | member | desktop | without Undo the delete commits after about 5 s and survives reload | DB 12 to 11, reload shows no row, bell 11 | PASS | observation only |
| NOTIF.leave-page-commits | member | desktop | navigating away inside the 5 s window commits | DB 11 to 10 | PASS | observation only |
| NOTIF.mark-one-read | member | desktop | clicking an unread row marks it read and opens it | opened the chat, bell 11 to 10, DB 1 read | PASS | observation only |
| NOTIF.mark-all-read | member | desktop | Mark all read clears unread | DB unread 0, bell "Notifications" | PASS | [shot](evidence/web-notif-mark-all-read.png) |
| NOTIF.cross-user-delete.API | member2 | API | cannot delete another user's notification | DELETE returned 204 but the row still exists (scoped, idempotent) | PASS | observation only |

### Owner team deletion (Teams page)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| TEAM-DEL.open-keyboard | owner | desktop, en | menu item opens confirm dialog, focus on Cancel | Tab to `Delete team` then Enter: dialog with consequences text, focus on Cancel | PASS | [dialog](evidence/web-team-delete-dialog.png) |
| TEAM-DEL.escape | owner | desktop | Escape cancels, team kept, focus back to More | dialog closed, team row kept, focus on More | PASS | observation only |
| TEAM-DEL.cancel | owner | desktop | Cancel keeps team | team still in DB | PASS | observation only |
| TEAM-DEL.confirm | owner | desktop | Delete team removes it | DB row gone, card removed | PASS | [shot](evidence/web-team-deleted.png) |
| TEAM-DEL.vi | owner | desktop, vi | dialog localized | "Xóa ban Band QA?" with full description, buttons Hủy/Xóa ban | PASS | [shot](evidence/web-vi-team-delete-dialog.png) |
| TEAM-DEL.member-ui | member | desktop | no More menu or delete | no menu button | PASS | observation only |
| TEAM-DEL.admin-ui | admin | desktop | no Delete item | menu: Edit, Availability, Settings | PASS | observation only |
| TEAM-DEL.scheduler-ui | scheduler | desktop | no Delete item | menu: Edit, Availability, Settings | PASS | observation only |
| TEAM-DEL.member.API | member | API | denied | 403, team kept | PASS | observation only |
| TEAM-DEL.scheduler.API | scheduler (legacy) | API | denied if the feature is owner-only | 204, team deleted | FAIL, W7-WEB-D2 | observation only |
| TEAM-DEL.admin.API | admin | API | denied if the feature is owner-only | 204, team deleted | FAIL, W7-WEB-D2 | observation only |

### Free-form plan items (owner, plan `QA Web Plan 1`)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| FREEFORM.add | owner | desktop, en | add free-form with title, length, notes | rows stored with `item_type=item`, length 150 s | PASS | observation only |
| FREEFORM.edit | owner | desktop | edit title/length/notes persists | "Second item edited", 300 s, "edited notes" | PASS | observation only |
| FREEFORM.reorder | owner | desktop | Move up swaps order, end buttons disabled | sort_order updated in DB | PASS | observation only |
| FREEFORM.delete | owner | desktop | confirm; dismiss keeps, accept deletes | native confirm; dismiss kept, accept removed | PASS | observation only |
| FREEFORM.validate-title | owner | desktop | whitespace-only title refused | "Give the item a title." | PASS | observation only |
| FREEFORM.validate-range | owner | desktop | 700:00 refused | "The length must be between 0 and 10 hours." | PASS | observation only |
| FREEFORM.validate-format | owner | desktop | `abc` refused | "Enter the length as minutes:seconds, e.g. 4:30." | PASS | observation only |
| FREEFORM.validate-seconds | owner | desktop | `99:99` refused | accepted and stored as 6039 s | FAIL, W7-WEB-D4 | observation only |
| FREEFORM.hostile-title | owner | desktop | `<b>x</b>` in title shown as text | shown literally | PASS | observation only |
| FREEFORM.dialog-keyboard | owner | 390 px | focus enters dialog, stays inside, Escape returns to opener | Close focused, focus trapped, Escape focused Add item | PASS | observation only |
| FREEFORM.member-denied | member | desktop | no Add/Edit/Move/Remove controls | 0 controls | PASS | observation only |
| FREEFORM.vi | owner | desktop, vi | localized labels and errors | all localized | PASS | observation only |

### Live broadcast refresh (two tabs, same owner session)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| LIVE.start-propagates | owner | desktop | Start in tab 2 appears in tab 1 with no reload (fallback poll is 60 s) | tab 1 changed to running ("Next: Second item edited") within 1 s | PASS | observation only |
| LIVE.advance-propagates | owner | desktop | Next in tab 2 updates tab 1 | tab 1 showed the second item within 1.5 s, "updated 1 second ago" | PASS | [tab 1](evidence/web-live-broadcast-tab1.png) |
| CHAT.broadcast | owner | desktop | message sent in tab 1 appears in tab 2 | present in tab 2 at t+1 s | PASS | observation only |

### Shared menu keyboard

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| MENU.more-keyboard | owner | desktop | `role=menu` More button: Enter focuses first item, arrows move, Escape closes | focus stays on trigger, ArrowDown and Escape do nothing, menu stays open (Tab and the "Close menu" backdrop button work) | FAIL, W7-WEB-D1 | observation only |

## Defects

**W7-WEB-D1 (P2). The shared `Menu` component keeps focus on its trigger and ignores arrows and Escape.** Repro: owner, `/teams`, focus the "More" button of a team, press Enter. The `role="menu"` popup opens, focus stays on the trigger, ArrowDown does nothing and Escape does not close it. The same menu pattern was fixed for the language and account menus in `9df64ec` (`usePopupMenu`) but the generic `Menu` (used for team More, plan Actions and others) did not get it. Expected per the W3C menu button pattern: focus enters the first item, arrows move, Escape closes and focuses the trigger. Suspected: `frontend/src/components/ui.tsx:755-815`. Also saw, once, the More button of the same team stop opening its menu after a Cancel-with-Escape dialog sequence and a later click; it recovered after reload and was not reproduced.

**W7-WEB-D2 (P2, needs product decision). Team deletion is owner-only in the UI but the API and RLS allow anyone with `teams.manage`.** Repro: as the legacy scheduler or admin, `DELETE /api/v1/teams/<id>` returned 204 and the team was gone (member got 403). The UI hides Delete for them. The RLS comment says "Deleting a team is a service-type or organization decision". Expected for the owner-only feature: 403/404, or an explicit decision that the UI restriction is cosmetic. Impact: legacy scheduler can delete teams though the permission oracle denies them roster changes. Suspected: `backend/src/routes/teams.ts:161` (`requireCapability('teams.manage')`) and `supabase/migrations/20261017000000_f01_scoped_capabilities.sql:582`.

**W7-WEB-D3 (P2). Underscore emphasis swallows underscores in dunder-style words.** Repro: send `call a.__init__ then b.__init__ done` in chat. Expected literal text; actual `a.init then b.init` with `init` italic. Same effect corrupted the hostile-string sample (`window.__xss`). Suspected: `packages/shared/src/lib/message-format.ts:105-112` (`_` can open after punctuation and each `_` of `__` pairs separately).

**W7-WEB-D4 (P2). Plan item length accepts seconds of 60 or more.** Repro: Add item, Free-form item, title "Val test", length `99:99`. Expected "Enter the length as minutes:seconds"; actual item stored with 6039 s (100:39). Also `1:75` and `1:2:3:4` parse. Suspected: `packages/shared/src/lib/dates.ts:92-99` (`parseDuration` folds parts without range checks).

**W7-WEB-D5 (P2). Moving the service time leaves the plan's own time stale on the Plans list and Dashboard.** Repro: native moved the plan's service time to 11:31 AM; after a web reload the plan detail Times row shows 11:31 AM, while the Plans list row and the Dashboard card show 11:30 AM (they read `plans.service_date`, unchanged at 17:30Z). Confirms native finding W7-NAT-D2 on web: the plan detail header shows only the date ("Sunday, November 29, 2026"), so the date itself is not wrong here, but the time shown differs between surfaces. Expected one consistent time. Suspected: time edit does not update `plans.service_date`, or the list should read the first service time.

## Group C. SYNC-01 web half (create and reload)

| Case ID | Actor | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|
| SYNC-01.web-create.team | sync scheduler | desktop, en | create team with position in UI | "QA Sync Band" with "Vocals" | PASS | [handoff](sync-handoff.md) |
| SYNC-01.web-create.service-type | sync scheduler | desktop | create service type via wizard | "QA Sync Sunday" (wizard also created an empty draft plan) | PASS | [handoff](sync-handoff.md) |
| SYNC-01.web-create.plan | sync scheduler | desktop | plan with time, two order items, note, released assignment | all created in the UI; plan revision 3, staffing 2; assignment released, `request_revision` 0 | PASS | [shot](evidence/web-sync-plan-created.png) |
| SYNC-01.web-reload.time | sync scheduler | desktop, en | moved service time shows after reload | Times row "Sun, Nov 29 · 11:31 AM–1:00 PM" (DB 17:31Z, content_revision 7) | PASS | [shot](evidence/web-sync-reload-plan.png) |
| SYNC-01.web-reload.header | sync scheduler | desktop | renamed header shows | "QA W7 sync header (iOS)" | PASS | [shot](evidence/web-sync-reload-plan.png) |
| SYNC-01.web-reload.note | sync scheduler | desktop | edited note shows | "QA W7 web-created plan note [iOS edit]" (note revision 2) | PASS | [shot](evidence/web-sync-reload-plan.png) |
| SYNC-01.web-reload.assignment | sync scheduler | desktop | accepted assignment shows confirmed | QA Sync Band: Confirmed 1, Declined 0, Awaiting 0; Member Sync, Vocals (DB confirmed, staffing_revision 4) | PASS | [shot](evidence/web-sync-reload-plan.png) |
| SYNC-01.web-reload.stale-edit | sync scheduler | desktop | refused stale native edit is not overwritten | free-form title shown is "QA W7 sync free-form iOSstale", which native saved after explicitly reloading the API's "(API concurrent)" title; the API value was not silently lost before that reload; 2 items, one plan | PASS | [shot](evidence/web-sync-reload-plan.png) |
| SYNC-01.web-reload.list-time | sync scheduler | desktop | plan list and dashboard time match moved time | plan detail shows 11:31 AM but the Plans list and Dashboard still show "11:30 AM" (plans.service_date unchanged) | FAIL, W7-WEB-D5 | observation only |

The member's roster membership was added through the owner API because a legacy scheduler cannot edit rosters. IDs, revisions and the "Web-created" table are in `sync-handoff.md`.

## Not run / blocked

- Real IME composition (a Vietnamese keyboard); only synthetic `isComposing`/229 events were exercised.
- Live: plan-level run discovery (`live_plan` topic) with the service-time picker open; lease takeover between users; Live as a denied role.
- Screen reader, large text, reduced motion, light theme for these screens, RTL visual alignment.
- Cascade effect of owner team deletion on a team that has plan assignments (dialog text verified, data effect not).
- Notification deletion by an inactive member; chat as a denied non-participant.

## Fixtures left in place

Orgs `qa-20261120-web-a`, `qa-20261120-web-b`, `qa-20261120-sync-a` with users listed above (the sync org and its plans are for the native agent), team "Band QA", plan "QA Web Plan 1" (published, one service time, a Live run ended), three songs, chat messages and notifications. Teams "Disposable Team QA" and "API Probe Team" were deleted during the tests.

## Cleanup

Account sessions were signed out, the QA tabs closed and both QA browser profiles deleted at the end of the run.
