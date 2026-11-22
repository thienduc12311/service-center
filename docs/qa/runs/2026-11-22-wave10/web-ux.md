# W10-WEB web retests, wave 9 fix round, new-feature web halves

Package W10-WEB (browser retests of the wave 9 fixes, web halves of features merged since wave 9, never-covered web cases). Commit `f79aa50` (branch `feature/qa-wave10`). API `:4200` (this worktree, simulated email/push, delivery worker not run). Web: `:5181`, a private Vite started from `frontend/` with `VITE_API_URL=http://localhost:4650`, in front of a private fault-injecting HTTP proxy on `:4650` (per-path forced 503/504, per-path/per-method delay, request log) forwarding to `:4200`. Offline cases used the browser's own offline switch (`set offline on`). Browser: Orca embedded browser (Chromium), two isolated profiles (owner/session 1, second actor/anonymous session 2), both deleted at the end. Sign-in to the web app was done through the real login form. The default window is a narrow portrait window (about 830 px wide), so desktop checks set the viewport to 1440x900 (1280x800, 1024x768 where noted) and phone checks used 390x844 mobile emulation; every `goto` resets the viewport, so it was re-applied each time. Both proxy and Vite were stopped by PID at the end; `:4200` and `:5180` were not touched.

Namespace: orgs `qa-w10-web-a`, `qa-w10-web-b`; users `<alias>.qaw10.web@example.test`; passwords and invite tokens only in the scratchpad `w10-web/creds.json`.

Fixture shape (org A): owner; members `member1`, `member2`, `lockedp` (logins), `invitee` (existing confirmed account, no org before the test; joined by invitation). Service types `W10 Sunday`, `W10 Midweek`; teams `W10 Band` (32 members, positions Vocals/Keys/Drums), `W10 Tech` (3 members, positions Sound + DelPos1..3); 69 people (Fillers 001-055, `Nguyễn Thị Ánh`, `Trần Văn Bình`, `Lê Hoàng Đức`, `Phạm Quốc Anh`, `Ivy Invitee`, `Stale Person`, `Fresh Person`, `Existing Login`, two CSV rows); 30 plans (`Easter Café Service`, `Ánh Sáng Night`, `W10 Plan NN`), songs including `Café Hymn`, `Ánh Sáng`, 4 `W10 DelSong*`, 14 templates (one `W10 Café Template`), 2 media items, 1 operational message, 2 team conversations. Org B: owner and person `BSECRET W10Person` (leak sentinel).

Totals: 83 PASS (including rows marked observation), 7 FAIL (all P2, 4 distinct defects: W10-WEB-D1, D2, D3 and the still-open W2-PLANS-D11 re-run), 0 BLOCKED, 8 NOT_RUN, 1 NOT_APPLICABLE. No P0 and no P1. Cross-tenant and permission spot checks passed (see section I).

## A. W9-WEB-D2 retest (failed first load / paused load)

Rule: error plus "Try again", no empty-state text; loaded rows stay on a later failure; Retry recovers. "First load 503" = proxy returns 503 for that page's list endpoint, full page reload, 8 s wait (3 attempts). "Later failure" = page loaded and cached, navigate away for more than the 30 s stale time, fail the endpoint, navigate back in the SPA.

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| D2.people.503 | owner | /people, `/people/page` 503 | alert + Try again, no "Nobody here yet" | alert "Service Center is having trouble right now. Please try again shortly." + "Try again"; no empty state ([shot](evidence/web/w10-d2-people-503.png)) | PASS |
| D2.people.retry | owner | same, heal proxy, click Try again | rows load | 25 rows, "65 people" | PASS |
| D2.people.rows-stay | owner | loaded, then refetch 503 | 25 rows stay | rows kept, alert shown above | PASS |
| D2.teams.503 / retry / rows-stay | owner | /teams | same | error + Try again, no "No teams yet"; retry shows both teams; later failure keeps both teams plus the alert | PASS |
| D2.songs.503 / retry / rows-stay | owner | /songs | same | error + Try again, no "No songs yet" (the pager "Page 1 of 1 / Previous / Next" still renders under the error, cosmetic); retry recovers (14 songs); rows kept on later failure | PASS |
| D2.myschedule.503, .504 | owner | /my-schedule | same | error + Try again for 503 and 504, no "not scheduled" text ([shot](evidence/web/w10-d2-myschedule-504.png)) | PASS |
| D2.myschedule.retry / rows-stay | member1 | /my-schedule with two requests | rows return / stay | retry shows both requests; later failure keeps both plus the alert | PASS |
| D2.chat.503 / retry / rows-stay | owner | /chat, `/conversations` 503 | same | error + Try again, no "No conversations yet"; retry shows 4 conversations; later failure keeps list plus alert | PASS |
| D2.templates.503 / retry / rows-stay | owner | /plans/templates | same | error + Try again; retry lists templates; later failure keeps rows plus alert | PASS |
| D2.messages.503 / retry | owner | /messages | same | error + Try again; retry shows the sent message | PASS |
| D2.messages.rows-stay | owner | later `/messages` 503 | rows stay | row stays, but no error is shown at all (3 failed requests, no notice). Observation: stale rows with no hint the refresh failed | PASS (observation) |
| D2.media.503 / retry | owner | /media | same | error + Try again; retry lists both items | PASS |
| D2.media.rows-stay | owner | later `/media` 503 | rows stay | rows stay, no error notice (same as messages) | PASS (observation) |
| D2.songbooks | owner | /songbooks | n/a | route redirects to /songs (documented deferred), so no Songbooks page to test | NOT_APPLICABLE |
| D2.plans | owner | /plans | verified wave 9 | not re-run | NOT_RUN |
| D2.people.offline-search | owner | /people, offline on, type `Filler05` | offline/paused indication, not "Nobody matches" | no "Nobody matches" any more, but the list stays the unfiltered 65 people with the search box reading `Filler05` and no offline notice or loading state; after going back online the 6 matches appear ([shot](evidence/web/w10-d2-people-offline-search.png)) | FAIL, W10-WEB-D2 |
| D2.offline-first-load.media/songs/templates/people/teams/chat/messages/plans | owner | SPA navigation to each page while the browser is offline (first load, no cache) | error or loading with Try again, no empty state | every page shows its false empty state ("No media yet", "No songs yet", "No templates yet", "Nobody here yet", "No teams yet", "No conversations yet", "No messages sent yet", "No plans yet"), no error, no Try again ([shot](evidence/web/w10-d2-offline-first-load.png)); data appears after going online | FAIL, W10-WEB-D2 |
| D2.joinrequests.503 | owner | /people "Join requests" panel, `/people/join-requests` 503 | error + Try again, no "No one is waiting to join" | panel shows the error and, beneath it, "No one is waiting to join." with a "0" count; no Try again, and the page-level Try again does not refetch it | FAIL, W10-WEB-D1 |

## B. W9-WEB-D3 double-submit delete (3-4 s delay injected on the DELETE; first confirm accepted, then a second attempt)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| D3.position | owner | Teams, Edit W10 Tech, role Delete (native confirm) | delete control disabled while pending, second ignored, one DELETE, no "not found" | all Delete buttons disabled while pending (`Element is disabled`), second click on the same and on another role rejected; 1 DELETE; role removed; no alert (W9 FAIL now fixed) | PASS |
| D3.plan | owner | plan Actions, Delete plan (native confirm) | menu item disabled while pending, one DELETE | "Delete plan" menu item `[disabled]` while pending; 1 DELETE; navigated to /plans; row gone; no error | PASS |
| D3.song | owner | song Actions, Delete song | same | menu item `[disabled]`; 1 DELETE; list shows 13 songs; no alert | PASS |
| D3.arrangement | owner | song detail, Delete this arrangement | same | button `[disabled]`; 1 DELETE; arrangement removed (DB: Default, DelArr2, DelArr3 left); no alert | PASS |
| D3.folder | owner | Settings > Folders, Delete | same (no confirm dialog exists) | clicked row's Delete and the other folder's Delete both disabled while pending; 1 DELETE; no alert. Note: no confirmation step for folders | PASS |
| D3.tag-group | owner | People > Tags, group delete (x) | same | both group buttons disabled while pending; 1 DELETE; no alert | PASS |

## C. ADR-0006 on web (draft plans quiet, publish confirmation, banner, copy)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| ADR6.draft-banner | owner | draft plan page | banner "Draft — people you schedule won't be notified until you publish." | shown ([shot](evidence/web/w10-adr6-draft-banner.png)); gone once published; Vietnamese text also present | PASS |
| ADR6.schedule-modal-copy | owner | Add people on a draft | notify checkbox replaced by "People will be notified when this plan is published." | shown, no checkbox; "Prepare privately" hint; "Can't be notified: no email or login" warning for people without an address | PASS |
| ADR6.draft-assign-quiet | owner | assign 4 people on a draft via the UI | no delivery effect, no notification, `notified_at` null | 4 `released` assignments; `delivery_effects` for the plan: 0; notification rows: none for the assignment ([shot](evidence/web/w10-adr6-draft-scheduled.png)) | PASS |
| ADR6.notify-ignored-on-draft | owner | `POST /plans/:id/notify` on a draft | nothing sent | 200 `notified:0 ... held_until_publish:true`, 0 effects | PASS |
| ADR6.publish-confirm | owner | Actions > Publish | dialog says who is emailed and who has no address, "Notify people" ticked | "Publishing will email 2 people. No email address on file for 2 people, so not emailed: Filler002 W10 and Nguyễn Thị Ánh." checkbox ticked ([shot](evidence/web/w10-adr6-publish-confirm.png)) | PASS |
| ADR6.quiet-copy | owner | untick Notify people | "Publishing quietly: nobody will be emailed or asked in the app." | shown ([shot](evidence/web/w10-adr6-publish-quiet.png)) | PASS |
| ADR6.cancel-keeps-draft | owner | Cancel | plan stays draft | status draft | PASS |
| ADR6.publish-notify | owner | publish with Notify ticked (plan 3, one login member) | request queued per person, outcome shown | `assignment_request` effect for the plan; page notice "Email: 1 simulated - not sent / Push: 1 not sent / In-app: 1 delivered / Email isn't configured..." ([shot](evidence/web/w10-adr6-published-outcome.png)) | PASS |
| ADR6.publish-quiet-api | owner | `PATCH status=published, notify=true` on plan 2 (API, one login member) | one effect | 1 `assignment_request` effect with 1 assignment | PASS |
| ADR6.notify-unticked-persists | owner | untick, Cancel, reopen the dialog | default ticked again | the dialog reopens unticked (state kept in the mounted component); publishing then sent nothing (plan 1 published quietly, `delivery_effects`=0, `notified_at` null) | FAIL, W10-WEB-D3 |
| ADR6.assignment-times-draft-copy | owner | assignment-times modal on a draft ("held until publish") | copy shown | not exercised (needs an assignment with chosen times); source `AssignmentTimesModal.tsx:121` has the string | NOT_RUN |
| ADR6.published-schedule-modal | owner | Add people on a published plan | notify checkbox present | not exercised past opening the modal (no draft banner/copy as expected; checkbox not located) | NOT_RUN |
| ADR6.settings-delivery-kinds | owner | Settings > Delivery > Show all recent | no-plan deliveries labelled by kind, never "Deleted plan" | "Message" (operational message) and "Team chat" (conversation message) labels; plan deliveries show the plan title; 0 occurrences of "Deleted plan" ([shot](evidence/web/w10-settings-delivery-kinds.png)) | PASS |
| ADR6.vi-publish-dialog | owner | Vietnamese publish dialog | strings present | banner verified in Vietnamese; publish dialog in Vietnamese not opened (test helper used English labels) | NOT_RUN |

## D. Invitation acceptance (SEC-002) and locked email (SEC-013)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| INV.send | owner | People, Send invite on a Person | invite link shown (no mail configured) | link shown with Copy; row becomes "Invite sent / Resend invite" | PASS |
| INV.anon-existing-account | anonymous | /accept-invite for an email that already has a confirmed account, submit a password | not linked; readable "sign in first" message | "An account with this email already exists. Sign in with it, then open this invitation link again to join." + Go to sign in; Person not linked ([shot](evidence/web/w10-invite-sec002-anon-existing.png)). The preview page itself still says "Choose a password for ... to finish" (does not reveal the account exists) | PASS |
| INV.wrong-session | owner (signed in as someone else) | same link, submit | refused, owner not signed out | same message; owner stays signed in on /people | PASS |
| INV.right-session | invitee (own session) | open the link after signing in, click Join | joins | "You're invited ... Join QA W10 Web A"; after Join: dashboard of the org; person linked (profile set), membership `member`/`active` | PASS |
| INV.new-account | anonymous | new email, valid password | account created unconfirmed, readable next step | "Almost there. We sent a confirmation link to ... Open it to confirm your email, then sign in."; person linked; auth user unconfirmed | PASS |
| INV.reused-token | anonymous | reopen a used link; API replay | readable refusal | page "This invitation has already been used."; API 410 `invitation_used` | PASS |
| INV.bad-token | anonymous | corrupted token | readable refusal | "This invitation link isn't valid. Ask whoever invited you to send a new one." | PASS |
| SEC013.ui-readonly | owner | /people/:id of a linked Person | email read-only with explanation | email input disabled; "This person already has a login ... read-only" | PASS |
| SEC013.stale-form-409 | owner | form opened before the person accepted, edit email + campus, Save | readable 409 message | page shows "This person's email is the one they accepted their invitation with, so it can't be changed here." ([shot](evidence/web/w10-sec013-stale-email-409.png)); nothing saved (email and campus unchanged) | PASS |
| SEC013.other-fields-save | owner | restore the email value, Save | other fields save | campus saved (`StaleCampus`) | PASS |
| SEC013.api | owner | PATCH email changed / cleared on linked Person; same email upper-case + campus | 409 `person_email_locked`; same email + other fields 200 | 409 for changed and null (also when combined with campus: whole request refused), 200 for the same email in other case with campus saved; Vietnamese message exists in `errors.json` | PASS |
| SEC013.member-patch | member1 | PATCH a Person | 403 | 403 | PASS |
| INV.invite-archived | owner | Send invite on an archived Person | refused readably | "Restore this person before inviting them" (the button is still offered on archived rows) | PASS (observation) |

## E. Large-list web UX

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| LL.plans-search | owner | /plans search box, `?q=` | server search, accent-insensitive, empty state | `cafe` finds `Easter Café Service`; `anh sang` finds `Ánh Sáng Night`; `zzzz` shows "No plans match ..."; request carries `q`; URL keeps `?q=` | PASS |
| LL.people-total | owner | /people | total count | "65 people" (67 after more rows); 25 shown with Load more | PASS |
| LL.people-team-filter | owner | Filter by team W10 Tech / W10 Band, `?team=` | count follows, deep link works, combines with search, clearable | Tech 3 people, Band 32; deep link restores the filter; search `nguyen thi anh` within Band finds `Nguyễn Thị Ánh`; `member2` finds `Qa member2`; Clear chip present ([shot](evidence/web/w10-people-team-filter-search.png)) | PASS |
| LL.schedule-people-team-scope | owner | Add people modal, team Band | "Team members 32 / Everyone 65" scope, 25 per page + Show more | shown, "Showing 25 of 32" | PASS |
| LL.schedule-people-server-search | owner | same, search `nguyen thi anh` | server search, accent-insensitive | request `people/page?q=nguyen+thi+anh&team_id=...`; one result `Nguyễn Thị Ánh` ([shot](evidence/web/w10-picker-accent-team-scope.png)) | PASS |
| LL.schedule-people-pinned | owner | tick a person, change the search twice, tick more | picks stay visible | ticked picks pinned at the top of the list across searches; button reads "Schedule 4" and created 4 assignments | PASS |
| LL.song-browser-search | owner | Add songs panel | search, accent-insensitive, Enter adds | `cafe`, `oceans`, `amazing` each added with Enter, "3 added", Undo toast, "In this plan" badge | PASS |
| LL.song-browser-insert-points | owner | desktop (1440 wide) panel beside the order | "Add here" at start / after each item | start and after Café Hymn used: order became Cornerstone, Café Hymn, How Great, Oceans, Amazing Grace, Holy Holy Holy, Blessed Be (DB `sort_order` confirmed) ([shot](evidence/web/w10-songbrowser-insert-desktop.png)) | PASS |
| LL.song-browser-insert-narrow | owner | same at about 830 px wide | insert points usable | panel is full-screen and the "Add here" buttons are covered; only "Adding at the end of the order" is possible ([shot](evidence/web/w10-songbrowser-insert.png)). Observation, see Observations | PASS (observation) |
| LL.combobox-leader | owner | Edit item, Leader = A person | searchable, accent-insensitive, saves | `nguyen thi` lists `Nguyễn Thị Ánh`; saved `leader_person_id` (DB) ([shot](evidence/web/w10-leader-combobox.png)) | PASS |
| LL.combobox-templates | owner | Apply template with 14 templates | grouped by service type, searchable above 12 | listbox grouped "W10 SUNDAY"; `cafe` finds `W10 Café Template` | PASS |
| LL.combobox-helpers | owner | Settings > Availability > Who can help | searchable | `member1` and upper-case `QA INVITEE` find the member (name + email) | PASS |
| LL.combobox-replacements | owner | replacement candidate (OpportunityPanel) | searchable | not exercised (needs an open replacement request) | NOT_RUN |
| LL.accent-people | owner | /people search `nguyen thi anh` | finds `Nguyễn Thị Ánh` | found (also in the team-filter case) | PASS |
| LL.ccli-create | owner | Songs > Add a song, CCLI# ` 7654321 ` | stored trimmed, shown | song created, DB `7654321`, detail "CCLI# 7654321" ([shot](evidence/web/w10-ccli-song-created.png)) | PASS |
| LL.ccli-boundary | owner | CCLI# 41 chars | refused | field has `maxLength=40` (typing cannot exceed it); a forced 41-char value gets "Invalid request body" from the server, nothing created | PASS |

## F. PEOPLE-04 web half

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE04.badges | owner | /people rows | login / "No login yet" / "Invite sent" / "Archived" badges | all four seen ("No login yet + Send invite", "Invite sent + Resend invite", "Archived") | PASS |
| PEOPLE04.archive-restore | owner | person page Archive, list, Show archived, Restore | hidden by default, visible with toggle, restore works | archived person disappears from the default list, appears with an "Archived" badge under Show archived; Restore clears it; no confirmation step | PASS |
| PEOPLE04.history | owner | person page Roster history | entries | "Added to the roster", "Archived", "Restored", "Tagged" entries with actor and time | PASS |
| PEOPLE04.tags | owner | person Tags field, Save tags | persisted | `w10tag` in DB, history entry | PASS |
| PEOPLE04.tag-groups | owner | People > Tags dialog | create/delete groups | groups listed; delete covered in B (create via API; assigning a tag to a group not exercised) | PASS |
| PEOPLE04.import-atomic | owner | Imports, People CSV with one invalid email row | invalid row blocks save, nothing written | Record 2 "error: Invalid email", "Save reviewed import" disabled, DB `Csv` rows = 0 after preview ([shot](evidence/web/w10-people-import-preview.png)) | PASS |
| PEOPLE04.import-commit | owner | mark Record 2 "Skip", refresh preview, save | 2 created, job committed | rows `Csv One`, `Csv Three` created, job "committed", skip recorded ([shot](evidence/web/w10-people-import-saved.png)) | PASS |
| PEOPLE04.history-retained | owner | archive a Person assigned on a plan | plan keeps them | archived `Filler002` still listed on the plan's Teams tab | PASS |
| PEOPLE04.import-automap | owner | CSV headers `first_name,last_name,email` | observation | no automatic mapping, every field starts at "Do not import" (header names with underscores are not matched) | PASS (observation) |

## G. I18N-01 web half

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| I18N.profile-select | owner | Settings > Profile, Language select | explicit `en` / `vi` saved per Person; Automatic clears it | `en` -> API `preferred_language:"en"`; `vi` -> `"vi"`; Automatic -> `null`; `<html lang>` follows | PASS |
| I18N.header-switch | owner | header language menu | device-level switch, not silently saved | switch to Tiếng Việt changed the UI and survived reload (`lang="vi"`); person preference stayed `null` | PASS |
| I18N.persistence-refresh | owner | reload after each choice | kept | `vi` kept after reload; Automatic returns to English after reload | PASS |
| I18N.automatic | owner | Automatic | follows the device, falls back to English | "Tự động (English)" label; UI English | PASS |
| I18N.raw-keys | owner | 22 pages in Vietnamese (/, plans list/detail x2, templates, generate, songs list/detail, people list/person, teams, chat, messages, media, my schedule, calendar, reports, imports, settings x3, notifications, help) | no raw keys | regex scan of `innerText` for `ns.key` / `ns:key` found nothing (only the filename `ppl1.csv`); also none in English | PASS |
| I18N.vi-spot | owner | Vietnamese plans list, draft banner | translated | translated ([shot](evidence/web/w10-i18n-vi-plans.png)) | PASS |
| I18N.unsupported-locale | owner | browser locale not en/vi | falls back to English | not exercised (cannot change the embedded browser's language) | NOT_RUN |

## H. UX-01 web (desktop 1440/1280, 1024, 390 narrow; light and dark)

FAIL row re-run exactly: `UX-01.1024.PLAN-order-tab.WEB` (wave 2, defects W2-PLANS-D11 / WEB-D6), plan Order tab at 1024x768.

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| UX01.1024.PLAN-order-tab.dark | owner | /plans/:id Order tab, 1024x768, dark | no overlap, readable title column | per-row notes/edit icons are drawn on top of the song title text ("Cornerstone" with the two icons over its letters); the arrow and delete controls sit in the same row ([shot](evidence/web/w10-ux01-1024-order-dark.png)) | FAIL, W2-PLANS-D11 (still open) |
| UX01.1024.PLAN-order-tab.light | owner | same, light | same | same overlap ([shot](evidence/web/w10-ux01-1024-order-light.png)) | FAIL, W2-PLANS-D11 (still open) |
| UX01.1280.PLAN-order-tab | owner | same at 1280x800, light | clean | title, badge, sub-line and all five row icons separated ([shot](evidence/web/w10-ux01-1280-order-light.png)) | PASS |
| UX01.1024.tablist | owner | plan page tab bar at 1024 | all tabs readable | "Attendance" is cut off at the right edge ("Attenc...") and "Share" is out of view with no visible scroll cue | FAIL, W2-PLANS-D11 (same layout cause) |
| UX01.390.dark | owner | 18 pages at 390x844 mobile emulation (dark) | no horizontal overflow, no controls past the edge | document width 390 on every page, no element beyond the viewport | PASS |
| UX01.390.light | owner | same, light | same | same, all 18 pages clean | PASS |
| UX01.1440.light | owner | same pages at 1440x900, light | same | clean on all 18 pages | PASS |
| UX01.390.plan-order | owner | plan Order tab at 390, dark | readable stacked rows | time, title, key badge and action row stack cleanly ([shot](evidence/web/w10-ux01-390-plan-order-dark.png)) | PASS |
| UX01.1024.other-pages | owner | other pages at 1024 | not checked | only the plan Order tab was re-run at 1024 | NOT_RUN |
| UX01.1440.dark | owner | 18 pages at 1440 in dark | clean | only light was swept at 1440; dark verified at 1024 and 390 | NOT_RUN |

## I. Tenant and permission spot checks

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC.cross-tenant-list | owner of B | org A `GET /people/page` with A's org id | denied | 403 | PASS |
| SEC.cross-tenant-write | owner of B | org A `PATCH /people/:id` | denied | 403 | PASS |
| SEC.sentinel-search | owner of A | People search `BSECRET` (UI and API) | nothing from org B | 0 results | PASS |
| SEC.object-substitution | owner of A | `GET /people/<org B person>` | 404 | 404 | PASS |
| SEC.plan-substitution | owner of B | org A plan id under org B | 404 | 404 | PASS |
| SEC.member-write | member1 | PATCH a Person | 403 | 403 | PASS |

## Defects

**W10-WEB-D1 (P2). The People "Join requests" panel shows an error and the empty state together, with no retry.** Repro: owner at /people with `GET /people/join-requests` returning 503/504. Expected: error with Try again, no "No one is waiting to join", count not "0". Actual: alert text, then "No one is waiting to join." and a "0" badge; the page-level Try again refetches only the people list and the panel's error stays. Source: `frontend/src/components/people/JoinRequestsSection.tsx:84-100` (`pending` falls back to `[]` and renders the empty branch when `requests.data` is undefined; `ErrorNotice` has no `onRetry`).

**W10-WEB-D2 (P2, carry-over of W9-WEB-D2). A paused (offline) first load still renders each list's empty state, and an offline search shows an unfiltered list, with no error.** Repro: signed in, go offline (`set offline on`), navigate in the app to /media, /songs, /plans/templates, /people, /teams, /chat, /messages, /plans. Expected: an offline/error notice with Try again, never "no results". Actual: "No media yet", "No songs yet", "No templates yet", "Nobody here yet", "No teams yet", "No conversations yet", "No messages sent yet", "No plans yet"; nothing changes until the connection returns. Offline typing in the People search leaves the old full list under a non-empty search box. The 503/504 half of W9-WEB-D2 is fixed (section A). Suspected: the pages key their empty state on `data` being empty/`isLoading` false; a query with `fetchStatus === 'paused'` (`isPaused`) and no data is neither loading nor failed, so `listFailed` (`frontend/src/components/ui.tsx:~474`) is false. Needs a paused branch in the shared list state or `networkMode: 'always'` handling.

**W10-WEB-D3 (P2). The publish dialog remembers "Notify people" unticked after Cancel.** Repro: plan with unnotified people, Actions > Publish, untick "Notify people", Cancel, reopen Publish: still unticked, then Publish sends nothing (people are not asked, `notified_at` stays null; later re-publish never re-asks since the plan is already published, they would need Send notifications). ADR-0006 says the box is ticked by default. Expected: reset to ticked on open. Source: `frontend/src/components/plan/PublishPlanModal.tsx:28` (`useState(true)` in a component that stays mounted, never reset when `open` changes).

**W2-PLANS-D11 / WEB-D6 (P2, still open, UX-01 FAIL row re-run).** Plan Order tab at 1024px: the row action icons overlap the song title and the tab bar clips "Attendance"/"Share". Reproduced in dark and light; fine at 1280. Suspected (from wave 2): `frontend/src/components/plan/OrderTab.tsx` row grid and `frontend/src/pages/PlanDetailPage.tsx` `lg:grid-cols-[17rem_...]` at 1024. Counts as one defect (3 FAIL rows above).

## Observations (not defects)

- Stale rows stay without any error notice after a failed background refetch on /messages and /media (rows stay, which is what the rule requires, but the user gets no hint).
- Song browser at about 830 px wide is a full-screen panel and the order's "Add here" insert points are covered, so only append is possible; insert points need a wider window (desktop is fine).
- The person page title shows only the first name (`PersonPage.tsx:216`), and it changes as the first-name field is edited.
- Send invite is offered on archived rows (refused with a readable message).
- Folder delete has no confirmation step (disabled while pending, one request).
- People CSV import does not auto-map headers named like the fields.
- The accept-invite page text does not reveal that an account exists until the password is submitted (good for enumeration); after the "Go to sign in" step the user returns to the invite page automatically once signed in.
- Test-tool note: `orca fill` bypasses `minlength`/`maxlength` validation, so short-password and long-CCLI "Invalid request body" results are tool artifacts, not defects.

## Not run / blocked

- Replacement candidate combobox (needs an open replacement request); assignment-times modal draft copy; published-plan schedule-modal notify checkbox; Vietnamese publish dialog; unsupported browser locale; 1024px sweep of pages other than the plan Order tab; 1440 dark sweep; tag-to-group assignment; D2 retest of /plans (verified in wave 9).
- No BLOCKED rows. The delivery worker was not run; deliveries created are simulated and stay queued/simulated.

## Fixtures left in place

Orgs `qa-w10-web-a` and `qa-w10-web-b` and users `{owner,ownerb,member1,member2,invitee,lockedp}.qaw10.web@example.test`, plus accounts created by invitation (`stale.qaw10.web@example.test` and `fresh.qaw10.web@example.test`, both unconfirmed). Org A data as in the header (about 69 people, 30 plans, 14 songs, 14 templates, 2 media, 1 message, 2 team chats, 2 plan chats). Deleted by the tests: position `W10 DelPos1`, plan `W10 DelPlan1`, song `W10 DelSong2`, arrangement `W10 DelArr1`, folder `W10 DelFolder1`, tag group `W10 DelGroup1`. Plans 1-3 are published (1 quietly), 2 and 3 have a simulated request effect. `Filler002` was archived and restored. Private proxy (`:4650`) and Vite (`:5181`) stopped by PID; browser profiles deleted. Evidence: `docs/qa/runs/2026-11-22-wave10/evidence/web/*.png` (test-user screens only, no tokens, keys or passwords).
