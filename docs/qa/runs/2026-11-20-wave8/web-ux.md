# W8-WEB web UI coverage and wave 7 web fix retests

Package W8-WEB. Commit `897e524` (main plus wave 7 fixes), branch `feature/qa-wave8`. Browser: Orca embedded browser (Electron/Chromium), isolated profile `qa-wave8-web` (deleted at the end), driven with the `orca` CLI. Desktop = 1556x1144 (window default), narrow = `set device iPhone 12` (390x844; the emulation resets on every navigation, so it was re-applied after each `goto`). Locales English and Vietnamese. Appearance: dark (system default) for most runs, light spot-check on Teams. Web `:5173`, API `:4000`, local Supabase. Sessions were injected into localStorage after an API password login (service setup), then every feature was driven in the UI as that actor.

Namespace: orgs `qa-w8-web-a` (id `9d737ccc-eb6d-4876-b0a5-1327f0f5364f`), `qa-w8-web-b` (`6e131d02-38a5-4b68-8757-3a5b56d409a6`); users `<alias>.qaw8.web@example.test`, passwords only in the scratchpad `web/creds.json`.

Fixture shape (org A): owner; admin; sched (legacy scheduler); member1, member2; tmgr (member, scoped, `teams.manage` on service type "W8 Sunday"); tmgr2 (member, scoped, `teams.manage` on "W8 Midweek"). Service types W8 Sunday / W8 Midweek. Teams W8 Band (Vocals, Keys; Sunday), W8 Tech (Sound; Midweek), W8 Disposable (Drums; Sunday; deleted in the test). Plans W8 Plan 1/2/3 (published, one service time each), song "W8 Song One", plan chat. Org B: `ownerb` owns it, `owner` is admin in B (org switching); B has team "B Secret Team" and plan "B SECRET PLAN" as leak sentinels. 85+ seeded notifications for member2.

Note on the environment: the shared API on :4000 received a SIGTERM mid-run (coordinator notice, not sent by this agent). One plan time save in the browser failed with "Could not reach Service Center" at that moment; it was retried after the restart and passed. That failure is not recorded as a defect.

Totals: 96 executed rows: 91 PASS, 1 FAIL (P2), 0 BLOCKED, 2 NOT_RUN, 2 NOT_APPLICABLE. Plus 4 observations that are not defects.

## A. Retests of wave 7 web fixes

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| W7-WEB-D1.teams-enter | owner | /teams | desktop, en | Enter on More opens menu, focus on first item | focus on `Edit`, 4 items | PASS | observation |
| W7-WEB-D1.teams-arrows | owner | /teams | desktop | Down, End, Home, Up move and wrap | Availability, Delete team, Edit, Delete team | PASS | observation |
| W7-WEB-D1.teams-escape | owner | /teams | desktop | Escape closes, focus on trigger | menu gone, `aria-expanded=false`, focus on More | PASS | observation |
| W7-WEB-D1.plan-actions | owner | /plans/:id | desktop | same pattern for plan Actions | Enter focuses `Unpublish`, arrows wrap, Escape returns to Actions | PASS | observation |
| W7-WEB-D1.arrow-opens | owner | /plans/:id | 390 | ArrowDown on closed trigger opens and focuses first | focus `Unpublish`, 3 items, Escape returns focus, no horizontal scroll | PASS | [teams menu 390](evidence/web-menu-teams-more-390.png) |
| W7-WEB-D1.teams-390 | owner | /teams | 390 | Enter, End, Escape | `Edit`, then `Delete team`, then focus back on More | PASS | [shot](evidence/web-menu-teams-more-390.png) |
| W7-WEB-D1.mouse-vi | owner | /teams | desktop, vi, light | click opens, first item focus ring | items Sua / Lich ranh / Cai dat / Xoa ban, first focused | PASS | [shot](evidence/web-light-teams-menu-vi.png) |
| W7-WEB-D1.tab-closes | owner | /plans/:id | desktop | Tab from an item closes the menu | menu stayed open after Tab and after a programmatic focus move. `document.hasFocus()` is false in this automation window, so `focusout` never fires; cannot judge | NOT_RUN | observation |
| W7-ACC-D3.owner | owner | /teams | desktop | Delete team on all 3 teams | present on all 3 | PASS | observation |
| W7-ACC-D3.admin-sched | admin, sched (legacy) | /teams | desktop | `teams.manage` holders see Delete | both see Delete on all 3 teams | PASS | observation |
| W7-ACC-D3.tmgr | tmgr (scoped, Sunday) | /teams | desktop, 390 | More only on Sunday teams (Band, Disposable) | Band and Disposable have More with Delete; Tech has none | PASS | [dialog 390](evidence/web-team-delete-dialog-tmgr-390.png) |
| W7-ACC-D3.tmgr2 | tmgr2 (scoped, Midweek) | /teams | desktop | More only on Tech | Tech only | PASS | observation |
| W7-ACC-D3.member | member1 | /teams | desktop | no More anywhere | 0 More buttons | PASS | observation |
| W7-ACC-D3.api-denied | tmgr, tmgr2, member1 | API DELETE | n/a | out-of-scope delete denied and team kept | tmgr on Midweek team 404, tmgr2 on Sunday team 404, member1 403 "You need the Manage teams permission"; in-scope deletes 204 | PASS | observation |
| W7-ACC-D2.admin-readonly | admin | /settings?section=access, Sched W8 | desktop | access mode shown, not editable | text "Church-wide" plus "Only an owner can change scheduling reach."; no radios | PASS | [shot](evidence/web-acc-d2-admin-readonly.png) |
| W7-ACC-D2.owner-editable | owner | same | desktop | segmented control | radios "Church-wide / Only granted areas" | PASS | [shot](evidence/web-acc-d2-owner-editable.png) |
| W7-ACC-D2.api | admin, member1 | API PATCH /access/members | n/a | 403 with clear message | 403 "Only the organization owner can change how someone's access works", DB mode still `legacy` | PASS | observation |
| W7-ACC-D8.picker | owner | /settings?section=church | desktop | file input offers no SVG | `accept="image/png,image/jpeg,image/webp,image/gif"` | PASS | observation |
| W7-ACC-D8.forced-svg | owner | same | desktop | an SVG forced past the picker is refused, with a clear message | refused (no `logo_url` set) but the page says only "Something went wrong. Please try again." | FAIL, W8-WEB-D1 | observation |
| W7-WEB-D3.desktop | owner | /chat/:id | desktop | `a.__init__ then b.__init__` literal | text intact, no italic span; `_italic_` still italic; `snake_case_name` literal | PASS | [shot](evidence/web-chat-owner-desktop.png) |
| W7-WEB-D3.390 | owner | /chat/:id | 390 | `x.__init__.y and __dunder__` literal, `_it_` italic | literal, only `italic` and `it` styled, scrollWidth 390 | PASS | [shot](evidence/web-chat-mention-390.png) |
| W7-WEB-D4.add-99:99 | owner | /plans/:id add modal | desktop, en | `99:99` refused with message, no row | "Enter the length as minutes:seconds, e.g. 4:30."; no row | PASS | [shot](evidence/web-d4-length-rejected-desktop.png) |
| W7-WEB-D4.add-others | owner | same | desktop | `1:75`, `1:2:3:4` refused, `4:30` stored | both refused; `4:30` stored 270 s | PASS | observation |
| W7-WEB-D4.edit | owner | edit modal | desktop | `99:99` refused; `3:15` stored | refused (DB stayed 270); `3:15` stored 195 | PASS | [shot](evidence/web-d4-edit-modal-rejected.png) |
| W7-WEB-D4.vi | owner | add modal | desktop, vi | localized message | "Nhap thoi luong theo dang phut:giay, vi du 4:30." (with diacritics); no row | PASS | observation |
| W7-WEB-D5.review | owner | plan Times Edit | desktop | move 10:00 to 11:00 shows a review dialog | "Moved (was 10:00 AM-12:00 PM)", 3 requests that change, "2 people get an updated request" | PASS | [shot](evidence/web-d5-time-review-desktop.png) |
| W7-WEB-D5.persist | owner | DB | n/a | `plans.service_date` follows the time | `service_date` and `plan_times.starts_at` both 17:00Z | PASS | observation |
| W7-WEB-D5.lists | owner | /plans, / | desktop | Plans list and Dashboard show 11:00 AM | both show "W8 Plan 1 11:00 AM" (Plan 2 unchanged 10:00 AM) | PASS | [shot](evidence/web-d5-dashboard-time.png) |
| W7-MSG-D1.page2 | member2 | /notifications | desktop | Load more fetches page 2, no error, no dupes | 45 seeded rows all loaded, button gone, no alert | PASS | [shot](evidence/web-msg-d1-page2.png) |
| W7-MSG-D1.page3 | member2 | /notifications | 390 | pages 2 and 3, no loss | 78 rows in DB, 78 delete buttons after two Load more; 40 of 40 new rows unique | PASS | [shot](evidence/web-notif-page2-390.png) |

Retest verdicts: W7-WEB-D1 PASS (Tab-closes sub-check NOT_RUN for the reason above), W7-ACC-D3 / W7-WEB-D2 PASS, W7-ACC-D2 PASS, W7-ACC-D8 PASS for the picker (a forced SVG gives only a generic message, new W8-WEB-D1), W7-WEB-D3 PASS, W7-WEB-D4 PASS, W7-WEB-D5 PASS, W7-MSG-D1 PASS.

## B. Response flows (web)

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| RESP.myschedule-accept | member1 | /my-schedule | desktop | Accept confirms that row only | Plan 1 Vocals `confirmed`, others unchanged | PASS | observation |
| RESP.myschedule-decline | member1 | /my-schedule | desktop | Decline persists, buttons removed | Disposable `declined`; row shows no controls | PASS | observation |
| RESP.myschedule-withdraw | member1 | /my-schedule | desktop | Decline on a confirmed row (withdraw) persists | Plan 1 Vocals `declined` | PASS | observation |
| RESP.myschedule-accept-390 | member1 | /my-schedule | 390 | Accept on plan 3 | `confirmed`; scrollWidth 390 | PASS | [shot](evidence/web-myschedule-accept-390.png) |
| RESP.link-guest-preview | guest | /respond?token | desktop, en | preview shows plan, time, team, position, Decline/Confirm | shown | PASS | [shot](evidence/web-respond-guest-desktop.png) |
| RESP.link-stale-answer | guest | /respond | desktop | answering a link after the plan time changed is refused with a clear message | "This request has changed since it was sent. Open the latest request to answer."; assignment stayed `unconfirmed` | PASS | [shot](evidence/web-respond-stale-desktop.png) |
| RESP.link-stale-preview (W2-RESP-D4) | guest | /respond | desktop | a stale link is refused at preview, same message | same message on reload, no Confirm button | PASS | [shot](evidence/web-respond-stale-preview-desktop.png) |
| RESP.link-confirm-vi | guest | /respond | desktop, vi | localized, Confirm persists, link single-use | page in Vietnamese, `confirmed`; reload "Lien ket nay da duoc su dung." | PASS | [shot](evidence/web-respond-guest-vi-desktop.png) |
| RESP.link-decline-390 | guest | /respond | 390 | Decline persists | "Thank you, Your assignments are declined", DB `declined`, no overflow | PASS | [shot](evidence/web-respond-declined-390.png) |
| RESP.link-invalid | guest | /respond?token=garbage | 390 | clear message | "That assignment response link is not valid" | PASS | [shot](evidence/web-respond-390.png) |
| RESP.delegate-accept-withdraw | member2 (delegate) | /help/:id | desktop | Accept then Withdraw for member1 | `confirmed` then `declined`; button label switches Accept/Decline to Withdraw | PASS | [shot](evidence/web-help-delegate-confirmed.png) |
| RESP.delegate-denied | member1 (not the delegate) | /help/:id | desktop | clear refusal | "Nothing to help with here. This permission was stopped, expired, or was never yours." | PASS | [shot](evidence/web-help-denied-actor.png) |
| RESP.grouped-review | any | n/a | n/a | grouped/split review screen | the web has no grouped review UI (native-only, calls `assignments/responses/preview`); web answers one assignment at a time | NOT_APPLICABLE | n/a |

## C. Chat, notifications

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| CHAT.mention-pick-send | owner | /chat/:id | desktop | `@Mem` lists candidates, ArrowDown+Enter inserts, one mention row | `Hi @Member2 W8`, `conversation_message_mentions` 1 | PASS | observation |
| CHAT.mention-390 | owner | /chat/:id | 390 | picker inside viewport, Escape closes | listbox x 33..289 of 390, closed | PASS | [shot](evidence/web-chat-mention-390.png) |
| CHAT.send-enter | owner | /chat/:id | desktop | Enter sends | stored | PASS | observation |
| CHAT.failed-send-retry (RES-01 chat) | owner | /chat/:id | desktop, offline | failed bubble, Try again, exactly one stored message | "Not sent: Could not reach Service Center... Your text is kept"; after going online and Try again DB count 1, one bubble | PASS | [shot](evidence/web-chat-offline-failed-desktop.png) |
| CHAT.unread-list | member2 | /chat | desktop | unread badge, opening clears it | badge 4; opening sets `last_read_at` | PASS | [shot](evidence/web-chat-list-unread-member2.png) |
| CHAT.mute | member2 | /chat/:id | desktop | Mute persists, no notification for new message, live message still shown | `muted` t; notifications unchanged (4 to 4) after a new message, message shown | PASS | observation |
| CHAT.unmute | member2 | /chat/:id | desktop | Unmute resumes notifications | `muted` f; notification count 4 to 5 | PASS | observation |
| CHAT.org-switch-draft | owner | /chat/:id | desktop | after church switch, no A conversation and no draft | "Conversation not available", composer empty, no A text anywhere | PASS | [shot](evidence/web-orgswitch-chat-draft.png) |
| CHAT.non-member-denied | ownerb (org B only) | /chat/:A-id, /plans/:A-id | desktop, vi | no data, clear localized message | "Khong xem duoc cuoc tro chuyen" and "Khong tim thay noi dung nay..." | PASS | [shot](evidence/web-cross-org-plan-denied.png) |
| NOTIF.delete-undo | member2 | /notifications | desktop | row and bell drop at once; Undo restores; DB untouched | bell 36 to 35, toast Undo; Undo restored row and bell 36; DB row kept after 7 s | PASS | observation |
| NOTIF.delete-commits | member2 | /notifications | desktop | no Undo: delete commits | DB 52 to 51 | PASS | observation |
| NOTIF.leave-commits | member2 | /notifications | desktop | leaving the page inside the window commits | row gone in DB after in-app navigation | PASS | observation |
| NOTIF.clear-read-cancel | member2 | /notifications | desktop | confirm dialog; Cancel changes nothing | dialog "Unread notifications are kept"; DB 50 rows / 15 read unchanged | PASS | [shot](evidence/web-notif-clear-read-dialog.png) |
| NOTIF.clear-read-confirm | member2 | /notifications | desktop | deletes read only | DB 35 rows, 0 read; unread kept; bell "35 unread" | PASS | observation |
| NOTIF.mark-all-read | member2 | /notifications | desktop | all read | DB 35/35 read | PASS | observation |
| NOTIF.cross-user | owner | /notifications | desktop | owner sees none of member2's rows | owner list showed none of the "W8 seed" rows (not asserted for every row) | PASS | observation |

## D. Teams, items, org switching

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| TEAM-DEL.dialog | tmgr | /teams | desktop, 390 | confirm dialog states the cascade | "permanently deletes the team, its positions and its assignments from plans. The people on the team stay on your roster." No count of affected assignments | PASS | [desktop](evidence/web-team-delete-dialog-tmgr-desktop.png) |
| TEAM-DEL.cancel-escape | tmgr | /teams | desktop, 390 | Escape cancels, team kept, focus on More | kept; focus on More at desktop | PASS | observation |
| TEAM-DEL.confirm-cascade | tmgr | /teams | desktop | delete removes team, its positions and its assignments, not other assignments | team 0, assignments of that team 1 to 0, positions 0, plan 1 keeps its other 2 assignments; card removed | PASS | observation |
| TEAM-DEL.vi | owner | /teams | desktop, vi | localized | "Xoa ban W8 Band?" with full text, Huy / Xoa ban | PASS | [shot](evidence/web-vi-team-delete-dialog.png) |
| TEAM-DEL.denied-ui | member1, tmgr (Midweek team), tmgr2 (Sunday teams) | /teams | desktop | no control | no More | PASS | observation |
| FREEFORM.add | owner | plan | desktop | add with title, length, notes | rows stored (`item`, 120 s, notes) | PASS | observation |
| FREEFORM.edit | owner | edit modal | desktop | edit persists | "Val test edited", 195 s | PASS | observation |
| FREEFORM.reorder | owner | plan | desktop | Move up swaps in DB | order Welcome, Val test edited, W8 Song One | PASS | observation |
| FREEFORM.delete | owner | plan | desktop | native confirm; dismiss keeps, accept deletes | dismiss kept (1), accept removed (0) | PASS | observation |
| FREEFORM.denied | member1, tmgr | plan | desktop | no add/edit/move/remove, no Actions | 0 controls; API POST/PATCH 403 "You need the Edit plans permission" | PASS | observation |
| FREEFORM.allowed-roles | sched, admin | plan | desktop | have the controls | present | PASS | observation |
| ORG.switch-plans | owner (A owner, B admin) | /plans | desktop | after switching to B no A data | at 0.3 s and 2 s only "B SECRET PLAN"; org id key changed | PASS | observation |
| ORG.switch-pages | owner | /teams /chat /notifications | desktop | B pages show no A data | only "B Secret Team" / nothing | PASS | observation |
| ORG.cross-org-api | ownerb | API GET A plan | n/a | denied | 403 "You are not a member of that organization" | PASS | observation |

## E. Viewport, locale and theme spot checks

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| VP390.no-overflow | owner, member1, member2, guest | teams, plan, chat, notifications, my-schedule, respond | 390 | scrollWidth equals 390 | 390 on all | PASS | shots above |
| VI.main-screens | owner | /, teams, plans, plan, chat, notifications, settings access, my-schedule | desktop, vi | localized heading, no raw keys or `{{` | all headings Vietnamese, no key-like strings | PASS | observation |
| DARK-LIGHT.teams | owner | /teams | desktop, vi | light theme renders and menu readable | light background rgb(248,250,252), menu legible | PASS | [shot](evidence/web-light-teams-vi.png) |
| DARK.dialogs | owner | plan add modal offline | desktop, dark | readable | readable | PASS | [shot](evidence/web-res01-draft-offline-dialog.png) |

## F. RES-01 web half (browser offline emulation was available)

| Case ID | Actor | Route | Viewport / locale | Expected | Actual | Status | Evidence |
|---|---|---|---|---|---|---|---|
| RES-01.web.draft-kept-offline | owner | plan add modal | desktop, dark | draft survives a failed save | dialog stayed open with title "Offline draft item", length 2:00, notes "keep me" and a spinning Add; on reconnect the save completed, exactly one row (120 s, notes) | PASS | [shot](evidence/web-res01-draft-offline-dialog.png) |
| RES-01.web.draft-12s | owner | plan add modal | desktop | still a draft after 12 s offline | still open with the typed title; completed on reconnect, exactly one row | PASS | observation |
| RES-01.web.chat-retry | owner | chat | desktop | see CHAT.failed-send-retry | PASS, one message | PASS | [shot](evidence/web-chat-offline-failed-desktop.png) |
| RES-01.web.5xx-timeout | n/a | n/a | n/a | injected 4xx/5xx and timeouts | the tool only toggles offline; requests were held, not failed fast. No 5xx or timeout injection | NOT_RUN | n/a |

## G. Denied-actor summary

Every owned action has a denied-actor row above: team delete (member1, tmgr on the other service type, tmgr2), plan items and Actions (member1, tmgr), access mode (admin), help delegation (non-delegate), other-org chat and plan (ownerb), notifications (other user), response link (garbage and stale token). Controls are absent in the UI and direct API calls return 403/404 with plain messages, never raw error codes.

## Defects

**W8-WEB-D1 (P2, low). A logo upload that bypasses the file picker filter shows only "Something went wrong. Please try again."** Repro: owner, Settings, Churches, `Update logo`; attach an SVG through the file input (`orca upload`, bypassing the `accept` filter). Expected: a specific message, for example that only PNG, JPEG, WebP or GIF logos are allowed. Actual: storage refuses the SVG (the `logo_url` stays empty, so the W7-ACC-D8 hole is closed) but the page shows the generic error. A real user is unlikely to hit it because the picker hides SVG; drag-and-drop and renamed files can. Suspected: `frontend/src/pages/SettingsPage.tsx:511` (`explainStorageUploadError` has no case for the new bucket MIME refusal), plus a client-side extension/type check before upload at line 506.

No P0 or P1 found.

## Observations (not defects)

- **Declined answers cannot be reversed by the person.** On My schedule and on the help page a `declined` row has no buttons; a confirmed row offers only Decline/Withdraw. Probably intended (a scheduler re-requests), but there is no text explaining it. Product decision.
- **Offline emulation holds requests rather than failing them.** The add-item modal shows a spinner (no error) while offline and completes on reconnect, with no duplicate row. Chat, which has its own failed state, did show the failure.
- **Team delete dialog gives no count** of the assignments the cascade removes (the text says "its assignments from plans").
- A plan time save that fails while the API is down shows "Could not reach Service Center. Check your connection and try again." and keeps the dialog (observed during the API restart).

## Not run / blocked

- Tab-from-menu closes the menu (APG): `document.hasFocus()` is false in the automation window, so focus/blur handlers do not fire; the Escape, arrow, Home, End, Enter paths all ran.
- RES-01 5xx and timeout injection (only offline toggling is available). Provider failure and lost-reply cases need server-side faults.
- Grouped/split review for answers: not on the web (NOT_APPLICABLE).
- Real IME composition, screen reader, large text, reduced motion.
- Messages (operational messages/templates) UI, public `/p` and `/s` pages, calendar, Live UI: outside this package's list.

## Fixtures left in place

Orgs `qa-w8-web-a` and `qa-w8-web-b` with the users above. Org A: teams W8 Band and W8 Tech (W8 Disposable and two probe teams were deleted), plans W8 Plan 1/2/3, song "W8 Song One", plan items (Welcome, Val test edited, W8 Song One, Offline draft item), plan chat with messages, member2's 78 notifications (all read except 40 `W8 seed2` rows), a delegation member1 to member2 (`can_respond`, `can_view_schedule`), fixed respond tokens `w8-token-*` set directly in `assignment_notifications` (3-day expiry), member2 muted state restored to unmuted. Plan 1 time moved to 11:30 AM (via API during the stale-link test). The delivery worker and simulator were not touched. The browser profile `qa-wave8-web` and its tab were closed and deleted; no code, config or git state was changed (`git status` shows only the new `docs/qa/runs/2026-11-20-wave8/` files).

Evidence: `docs/qa/runs/2026-11-20-wave8/evidence/web-*.png` (33 screenshots; no tokens, keys or passwords are visible).
