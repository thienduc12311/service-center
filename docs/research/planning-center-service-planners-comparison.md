# Planning Center Services for service planners vs Service Center

- **Research date:** 2026-11-22. All official pages were accessed on that date (see the [source register](#source-register)).
- **Starting point:** [Introduction for service planners](https://help.planningcenter.com/en/138434-introduction-for-service-planners.html) ([PC80](#pc80)). Each feature it mentions was checked against the official help article that owns it.
- **Scope:** the service planner's job as that article describes it: organize the account, build the order of service (songs, team members), manage files and notes, communicate with teams, notifications, and help. Wider Services features that already appear in the [Services feature reference](planning-center-services-feature-reference.md) (PC01–PC79) and the [mobile reference](planning-center-services-mobile-reference.md) are only cross-linked here, not researched again.
- **Code baseline:** `f79aa50e6ad2da8be01841dab61eb63058a8fae2` (HEAD of `thienduc12311/feature-planning-center-feature`, which equals `main` after PR #129). Every status below was checked again against this source. None was copied from [the 2026-10-15 gap plan](../plans/services-feature-gap-plan.md), and most of that plan's "Missing" rows have shipped since.
- **Caveats:**
  - Only public help pages were read. They describe how Planning Center is meant to work, not verified behavior, because no authenticated Planning Center account was available.
  - Service Center was not run. A status means a code path is visible in source: database plus API plus a client. It does not mean production behavior was verified.
  - Code citations come from code searches and were spot-checked by hand. Line numbers refer to the baseline commit.
  - All article content is paraphrased.

Status legend:
- **Present:** a working end-to-end path is visible.
- **Partial:** useful support exists, but the documented workflow is incomplete. The row says what is missing.
- **Missing:** no workflow, model or API was found. A table or enum on its own does not count.
- **N/A:** a Planning Center-wide or add-on feature that should not block Services work.

Epic IDs (F00–F17) are the ones in the [gap plan](../plans/services-feature-gap-plan.md) and the [progress ledger](../plans/services-capabilities-progress.md).

---

## Summary

- **Most of the core planner loop now matches Planning Center.** Since October these have all shipped, each with a web path and most with mobile:
  - a service-type setup wizard;
  - creating several plans at once from a template;
  - ordered items, songs, arrangements and labeled keys;
  - service, rehearsal and other plan times;
  - manual scheduling, including no-login guests and plan-only positions;
  - prepared requests that are released later, and accept/decline;
  - reminder policies;
  - targeted messages, team and plan chat;
  - a LIVE-style run controller with all three countdown modes;
  - files limited to chosen positions;
  - a media library;
  - public plan pages.
- **Service Center goes beyond Planning Center in a few places:**
  - Plans start as quiet drafts, and publishing is what notifies people (ADR-0006).
  - Scheduling over a conflict needs a reason, and the override is recorded.
  - A blockout never declines anyone silently.
  - Copy and release are atomic and idempotent.
  - ChordPro charts with transposition are built in.
  - Staffing proposals take fairness into account.
- **Biggest gap 1, building the order of service quickly.** These Planning Center authoring tools are missing:
  - drag-and-drop reordering on web (only up/down buttons);
  - a quick-add line where a length can be typed with the title;
  - keyboard shortcuts;
  - clearing the whole order;
  - limiting an item to particular service times;
  - long formatted item details;
  - song notes carried over from the song's last use;
  - media as an item type of its own.
- **Biggest gap 2, templates and copying.**
  - Templates can be saved from a plan and applied, but not created from scratch or have items, needs or people added in the UI, and they cannot be copied.
  - "Copy plan" has an API but no screen.
  - Copying and archiving a service type are API-only.
  - Generating plans only repeats every 1–4 weeks, up to 12 plans.
- **Biggest gap 3, what people are sent.**
  - The scheduling email has no custom message, no list of items the person leads, and no time-by-time detail.
  - Plan notes are not included in reminders and cannot be sent as an email.
  - Message audiences cannot select declined people, a service time, or "prepared only".
  - Messages cannot carry attachments.
  - The mobile text shortcut does not include a plan link.
- **Biggest gap 4, nothing runs on a schedule in production.** There is no cron (`backend/vercel.json`, no `pg_cron` in migrations). Reminders, scheduled releases and delivery retries are implemented but do not run in production until the deferred `feature/delivery-worker-cron` ships.
- **Biggest gap 5, times are not tied to teams.** Planning Center assigns teams and positions to each time, and that assignment drives schedules, reminders and conflicts. Service Center records which times apply on each assignment. It cannot link a team to a time, cannot "apply to future matching times", and sets reminders per team policy rather than per time.
- **Not applicable:** the toolbar's cross-product notifications, To do, Ask AI, Church Center, Planning Center University and community, and support requests from organization administrators. All belong to the wider Planning Center platform. Service Center has its own equivalents for the first two where they matter: a notification feed and push.

---

## Side-by-side comparison

Rows follow the order of the sections in the starting article. "PC" IDs link to the [source register](#source-register). Code citations are `path:line` from the repo root.

### 1. Getting in and organizing the account

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Log in, reset password | Sign in with email or phone and a password. Codes are used for setup and resets. Two-step verification is optional. A breached password must be reset. Sessions end after 14 days of inactivity. | Supabase email and password with confirmed email and an 8-character minimum. Forgot/reset pages on web, sign-in/up/reset on mobile. 15-minute access token with rotating refresh. TOTP is enabled only for the super-admin app; church members cannot turn on 2FA. No phone login. | Partial | [PC85](#pc85); `frontend/src/pages/LoginPage.tsx:75`, `frontend/src/pages/ForgotPasswordPage.tsx:29`, `frontend/src/pages/ResetPasswordPage.tsx:63`, `supabase/config.toml:34-35,43-48,57`, `admin/src/providers/AdminAuthProvider.tsx:8`, `mobile/app/(auth)/login.tsx:82` |
| Getting started (admin) | Administrators create a service type and plan, then templates, songs and media, the order, people, scheduling and permissions. | `/welcome` lets a user join a church or apply to create one. There are join requests and a church switcher. Once inside, there is no guided setup checklist. | Partial | [PC86](#pc86); `frontend/src/router.tsx:55,82`, `frontend/src/pages/OnboardingPage.tsx:86,95`, `backend/src/routes/church-join-requests.ts:56`, `mobile/app/(tabs)/profile.tsx:503` |
| One service type per ministry | Service types hold plans, teams and templates. Make one per age or ministry service so teams and access line up. Repeat times of the same service go inside one plan. | Service types with team links and folder membership. Capabilities can be scoped to a service type (F01). | Present | [PC80](#pc80), [PC04](#pc04); `backend/src/routes/service-types.ts:66`, `supabase/migrations/20261017000000_f01_scoped_capabilities.sql` |
| New service type wizard | Web wizard steps: name, recurrence, first date and times, suggested teams. Finish opens the first plan. | Web wizard with name/frequency, times and teams steps. One `POST /service-types/setup` creates the type, a first draft plan with its times, and reuses or creates the teams. Not available on mobile. | Present | [PC81](#pc81), [PC04](#pc04); `frontend/src/pages/ServiceTypeWizardPage.tsx:78,103-108`, `frontend/src/components/service-type/NameStep.tsx:34`, `backend/src/services/service-type-setup.ts:69`, `packages/shared/src/schemas/service-type.ts:27` |
| Folders | Admin-only folders group service types and can be reordered. | Folders table with RLS. Admin API to create, rename and move. The web Settings screen creates and deletes folders and puts service types in them. No UI for rename or move, none on mobile. | Partial | [PC04](#pc04); `supabase/migrations/20261017000200_f01_hierarchy_and_team_policies.sql:35`, `backend/src/routes/folders.ts:58,76,112`, `frontend/src/components/settings/FolderSettings.tsx:45,132` |
| Copy or archive a service type | Copy settings, the Teams tab layout and optionally templates to another folder. People, permissions and leaders are not copied. | `POST /service-types/:id/copy` and `/archive` exist, with ApiClient methods. No web or mobile screen calls them. Copying does not include templates. | Partial | [PC04](#pc04); `backend/src/routes/service-types.ts:144,160`, `packages/shared/src/lib/api-client.ts:1365,1367` |
| Service-type settings | Frequency (including "None"), folder, default service times, files shown on every plan, plan and item note categories, item row colors, limited file visibility, LIVE control list, public view and auto-publish. | Shipped: an `occasionally` frequency; service-type default files; per-file audiences down to positions; public pages and a set-list link per service type (set per plan, not as a service-type default). Note categories have an API but no admin screen and no separate item-note categories. Missing: default times, item row colors, LIVE permission list. | Partial | [PC05](#pc05); `packages/shared/src/schemas/service-type.ts:5`, `frontend/src/components/settings/ServiceTypeFilesSettings.tsx:35`, `supabase/migrations/20261030000000_f13_files.sql:68,642`, `backend/src/routes/collaboration.ts:132,135`, `backend/src/routes/publication.ts:41,57` |

### 2. Add the order to a plan

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Create one plan or several | Create one plan or a quantity that follows the frequency. Pick a template per date and choose which recent plan to copy times from. Mobile can create plans. | Create a single plan, or a "next" plan that copies times. Generate up to 12 plans from one template every 1–4 weeks (no monthly), with skip, move and rename per date. Times come from the template, not from a chosen plan. Mobile can create and generate. | Partial | [PC76](#pc76); `frontend/src/pages/PlansPage.tsx:86-97`, `frontend/src/pages/GeneratePlansPage.tsx:69-75`, `backend/src/routes/plan-templates.ts:90`, `supabase/migrations/20261027000000_f10_plan_templates.sql:1252`, `mobile/app/plan/new.tsx:100`, `mobile/app/plan/generate.tsx:177` |
| Copy a plan | Web only. Copy items, notes and/or teams to a chosen service type, quantity, start date and time source. | `POST /plans/:id/duplicate` (date, title, copy assignments) has no caller in web or mobile. "Import from another plan" into an existing plan works, with order, needs and teams toggles. | Partial | [PC76](#pc76); `backend/src/routes/plans.ts:257,270`, `packages/shared/src/lib/api-client.ts:953`, `packages/shared/src/schemas/plan.ts:77` |
| Plan templates | Templates are built in service-type settings from items, headers, songs and media, notes, needed positions and people. Leader positions resolve to whoever is scheduled. Templates can be edited, copied and deleted. A plan can be saved as a template, and templates can be imported into plans with chosen parts and several targets. Imports are not linked to the template afterwards. | Versioned templates. "Save as template" from a plan. Apply with chosen parts and append or replace, with a preview. Generate plans from a template. Editor can reorder, set needs, remove people and archive. The API accepts content for a from-scratch template, but the UI cannot create one or add items, needs or people. No template leader positions, no copy. | Partial | [PC82](#pc82), [PC36](#pc36), [PC37](#pc37); `supabase/migrations/20261027000000_f10_plan_templates.sql:47,534,1068`, `backend/src/routes/plan-templates.ts:64,112`, `packages/shared/src/schemas/plan-templates.ts:72-84`, `frontend/src/components/templates/SaveTemplateModal.tsx:53`, `frontend/src/components/templates/ApplyTemplateModal.tsx:88`, `frontend/src/pages/PlanTemplatesPage.tsx:179,214`, `mobile/app/plan/apply-template/[id].tsx:146` |
| Order item types | Regular items, headers, songs from the library, and media from the media library. | `plan_item_type` is song, header or item. Media can be linked onto a regular item (`media_id`) but is not a type of its own. | Partial | [PC32](#pc32); `supabase/migrations/20260101000000_init.sql:16`, `supabase/migrations/20261031000100_f14_rehearsal_media_stage.sql:261-262`, `frontend/src/components/plan/AddItemModal.tsx:20`, `frontend/src/components/media/LinkMediaModal.tsx` |
| Adding and arranging items | Add from a menu or by dragging. Quick-add field. Shortcuts h/i/m/s/x. Type "Title 0:00" to set a length. Drag to reorder on web and mobile. Admins can clear the whole order (web). | "Add other" and "Add songs" buttons, insert before or after an item. Web reorders with up/down buttons. Mobile has "Move to…" (one request). Length is a separate field. No quick-add, shortcuts, drag-and-drop or clear order. | Partial | [PC32](#pc32); `frontend/src/components/plan/OrderTab.tsx:146-150,345-348`, `backend/src/routes/plans.ts:379`, `mobile/app/plan/[id].tsx:256-262` |
| Item details | Name, length, before/during/after all or only some service times, description, long formatted detail, notes per category, files, linked song or media, and an item or song leader who can be a position or a person. Song notes are copied from the song's last plan in the same service type. | Pre-service, service and post-service segment. Plain description (up to 4000 characters). Leader can be a person or a position. Categorized item notes and comments. Item files. Edit on mobile. Missing: limiting an item to particular service times, formatted detail, song-note carryover. Leaders are not shown in emails or reports (progress ledger F11). | Partial | [PC33](#pc33); `supabase/migrations/20261028000000_f11_order_editing.sql:23`, `frontend/src/components/plan/EditItemModal.tsx:294-313`, `backend/src/routes/collaboration.ts:103,146`, `mobile/app/plan/edit-item/[id].tsx:156-198` |

#### Songs (within "Add order to plan")

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Songs page (web) | Expand a song to see its arrangements. Column chooser. Expanded or condensed view. Search and filter by tags, themes, title, keys and lyrics. | Filters for key, theme, type, style, speed, author, BPM and dates. Title or recent sort (the API also has last used and most used). `q` matches title, author and CCLI only, so there is no lyric search. Arrangement rows expand only in the plan's song picker. No column chooser or condensed view. | Partial | [PC42](#pc42); `frontend/src/pages/SongsPage.tsx:39-54,180-186`, `packages/shared/src/schemas/song.ts:102-104` |
| Songs on mobile | Choose a sort. Song, then arrangements, then an arrangement's keys, tags, schedule and files. | Title or recent sort, filter sheet, arrangement actions, key management. No schedule history on mobile and fewer sorts. | Partial | [PC42](#pc42), [PC80](#pc80); `mobile/app/(tabs)/songs.tsx:138-141`, `mobile/app/song/keys.tsx:163-171` |
| Add a song | Add from the Songs page or a plan. Search SongSelect/CCLI or MultiTracks, or create an original. Top songs (web). Mobile steps through arrangement, key and tags. | Add Song form with a CCLI number field, on web and mobile. CSV import for songs and people. No creating a song from inside a plan. No SongSelect or MultiTracks lookup (F17 Stage B was not selected). | Partial | [PC43](#pc43); `frontend/src/components/AddSongModal.tsx:47,84-89`, `backend/src/routes/songs.ts:140`, `backend/src/routes/imports.ts:16,30`, `mobile/app/song/new.tsx:92` |
| Arrangements | Name, default key, capo keys, tags, files, notes, length, BPM, meter, sequence and schedule history. Duplicate on web. | Name, key, capo, length, BPM, meter. Sequence editor. ChordPro chart. Schedule history. Duplicate and archive. No tags or notes on arrangements. | Partial | [PC44](#pc44); `supabase/migrations/20260101000000_init.sql:137-151`, `frontend/src/components/song/ArrangementModal.tsx:93-157`, `backend/src/routes/songs.ts:78,95,128` |
| Keys | Key records per arrangement with start and end key, description, alternate (capo) keys and key-only files. Choose a key, or add one, from the plan item. | `arrangement_keys` with label, key, capo and vocal label. Files can be tied to a key. A plan item can pick an arrangement, a free key or a labeled key. No separate start and end key. A new key cannot be created from the plan. | Partial | [PC45](#pc45); `supabase/migrations/20261101000200_f15_arrangement_curation.sql:2-20`, `frontend/src/components/song/ArrangementCurationPanel.tsx:58`, `frontend/src/components/plan/EditItemModal.tsx:207-252`, `mobile/app/song/keys.tsx:249` |
| Song files and charts | Upload to an arrangement or key (up to 4 GB). Streaming links to YouTube, Vimeo, Spotify or Apple Music. Web links. Provider imports. Chord charts belong on songs. | Upload, link or text document on a song, arrangement or key, capped at 25 MiB. Links accept any http(s) URL, with no streaming player. ChordPro editor with transposition, notation and PDF. No provider imports. | Partial | [PC51](#pc51); `packages/shared/src/lib/files.ts:47`, `supabase/migrations/20261030000000_f13_files.sql:68-70`, `packages/shared/src/lib/chordpro.ts:99,167`, `backend/src/routes/songs.ts:227`, `mobile/app/song/chart.tsx:324` |

#### Team members (within "Add order to plan")

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Schedule people onto the plan | Add someone to a position directly (including guests and temporary roles) or fill needed positions. Templates, matrix, auto-schedule and signups also exist. | The schedule-people dialog handles team scope, guests and plan-only positions, then one atomic `schedule_plan_assignments`. Mobile schedules, but guests and plan-only positions are web-only. Matrix, proposals and rotations, signups, replacements and availability requests are all present (F05–F07, F03). | Present | [PC19](#pc19); `backend/src/routes/assignments.ts:116`, `frontend/src/components/plan/SchedulePeopleModal.tsx:151,161,368`, `backend/src/routes/roster.ts:151`, `mobile/app/plan/schedule/[id].tsx:190`, `backend/src/routes/staffing-matrix.ts:35`, `backend/src/routes/opportunities.ts:71` |
| Needed positions and candidates | Set a headcount per position. Team members appear as candidates, each with a "last scheduled" marker and a conflict badge. | Needs per position with a stepper and staffed-of-needed badge, on web and mobile. The picker is not filtered by position membership and shows no "last scheduled" (that appears only in the matrix and proposals). | Partial | [PC19](#pc19); `backend/src/routes/plans.ts:332`, `frontend/src/components/plan/TeamsTab.tsx:377,426`, `frontend/src/components/plan/SchedulePeopleModal.tsx:433-436`, `backend/src/services/staffing-matrix.ts:220` |
| Times assigned to teams | Each time (service, rehearsal or other) has assigned teams and positions, which drive schedules, reminders and conflicts. Edits can apply to future matching times and existing assignments. Accurate end times are needed. | Three time kinds with start and end. Preview-then-commit time edits re-ask affected people. Times are chosen per assignment, on web and mobile. There is no link from team or position to a time, no "apply to future matching times", and no reminder per time. | Partial | [PC14](#pc14), [PC81](#pc81); `supabase/migrations/20260101000000_init.sql:15,177`, `backend/src/routes/plans.ts:150`, `frontend/src/components/plan/SchedulePeopleModal.tsx:166`, `mobile/app/plan/times/[id].tsx:174` |
| Conflict warnings | Badges for overlapping times, blockouts, preferences and earlier declines. None of them blocks scheduling. Saving a blockout declines unconfirmed requests. | Overlap and blockout conflicts (prepared requests included) and preference warnings, shown in the picker and as plan badges. Overriding needs a reason and a capability and is audited. Earlier declines are not flagged. A blockout deliberately never auto-declines; each affected commitment gets its own explicit decline. | Present (differs) | [PC15](#pc15); `backend/src/routes/assignments.ts:153-166,528`, `supabase/migrations/20261119000100_w2_hidden_prepared_conflicts.sql:14`, `frontend/src/components/settings/AffectedCommitments.tsx:24-27`, `mobile/app/plan/schedule/[id].tsx:473` |
| Prepared requests, then sending | People can be "penciled in" (a team default), hidden from the person until sent. Send to one person, a team, the plan, or several plans from the matrix. The email lists times, items the person leads, optional custom text, Accept/Decline and a plan link. | `prepared` or `released` visibility (with a team default) is hidden by RLS. Release a team from the plan, or release batches (immediate or scheduled) across plans. Draft plans stay quiet, and publishing asks everyone released who has not been asked (ADR-0006). The email has the plan, date, roles, a respond link and an ICS file, and combines several plans. No custom text, no led items, no time-by-time detail, a single respond link. | Partial | [PC27](#pc27); `supabase/migrations/20261017000100_f01_visibility_and_response_owner.sql:34,56,96`, `backend/src/routes/assignments.ts:217`, `backend/src/routes/releases.ts:66`, `supabase/migrations/20261129000010_publish_notifies.sql:277`, `backend/src/services/email/templates/schedule.ts:54-66`, `mobile/app/plan/[id].tsx:182` |
| Responses | Accept or decline per request, from the email or the app. | In-app response with a decline reason. Per-time answers on mobile only. Email-link answers are status-only by design. Web has no decline reason and no per-time answer. | Partial | [PC27](#pc27); `backend/src/routes/assignments.ts:367,377,413`, `backend/src/routes/assignment-respond.ts:24`, `frontend/src/pages/RespondAssignmentPage.tsx:94` |

### 3. Manage files and notes

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Plan, item and service-type files | One-off plan files, item files, service-type files on every plan, text documents (item and service-type level), streaming and web links. Deleted files can be recovered for 30 days. 4 GB limit. | File owners can be a plan, item, song, arrangement, service type or media. Kinds are upload, link and document. A trigger links service-type defaults to new plans. Web and mobile screens. Delete is permanent and refused while plans still link the file; archiving stands in for recovery. 25 MiB limit. | Present (smaller limits) | [PC78](#pc78), [PC05](#pc05); `supabase/migrations/20261030000000_f13_files.sql:1194,1337-1355`, `backend/src/routes/files.ts:77`, `frontend/src/components/files/PlanFilesTab.tsx:26,140`, `mobile/app/files/add.tsx:32` |
| Limited file visibility | Service-type switch so members see only files tagged for their position. | Per-file audience (organization, scheduled, teams, positions or leaders), enforced in SQL. | Present (per file, not a switch) | [PC05](#pc05); `supabase/migrations/20261030000000_f13_files.sql:68,413,642`, `frontend/src/components/files/AudienceFields.tsx:67` |
| Media library | Media items hold several files, a type, length, creator, themes, tags, notes, thumbnail and an auto-archive date, and can be scheduled into plans. Mobile can view and add files only. | Media with creator, duration, themes, tags, notes, thumbnail, `archive_on` and archive. Linked onto items. Mobile browses and adds files. No media type field. | Present | [PC56](#pc56); `backend/src/routes/rehearsal.ts:78,111-131`, `frontend/src/pages/MediaPage.tsx:152,272,390`, `mobile/app/media/[id].tsx:145` |
| Plan notes | Notes for this plan only, each with a category and assigned teams. Shown in members' reminder emails. Can be sent as an email (web). Can be saved from a team email. Mobile can add them. "Show notes for other teams" toggle. | Categories per service type (with a default audience), team targets, SQL read check. Web panel and mobile screen. Not included in reminders, no "send as email", no "save from email", no "other teams" toggle. | Partial | [PC83](#pc83); `supabase/migrations/20261026000000_f09_notes_and_item_comments.sql:93-224`, `backend/src/routes/collaboration.ts:99-118`, `frontend/src/components/collaboration/PlanNotesPanel.tsx:31,66`, `backend/src/services/email/templates/service-reminder.ts:6-26`, `mobile/app/plan/note/[id].tsx` |

### 4. Communicate plan information

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Email scheduled people | From the plan, choose teams, a split-team time and "prepared only". Mobile filters by Pending, Confirmed or Declined, team, time and person. Scheduling templates. Up to 5 attachments. Email a whole team or a filtered People list. | Targeted messages with audiences of team members, confirmed, pending and sign-ups. A preview hash and exclusions. Personal or shared templates with allowlisted placeholders. Web and mobile composers. No declined audience, no time or prepared-only filter, no attachments, no filtered people-list email. | Partial | [PC29](#pc29); `packages/shared/src/schemas/collaboration.ts:87-148`, `backend/src/routes/collaboration.ts:177-211`, `frontend/src/components/collaboration/MessageComposerModal.tsx:53`, `mobile/app/plan/[id].tsx:450` |
| Text from the phone | Mobile only: opens a group text in the phone's messaging app with a link to the plan. | Mobile composer hands off to the `sms:` composer with rendered text. No plan link, no web version, no server-side SMS. | Partial | [PC29](#pc29), [PC80](#pc80); `packages/shared/src/lib/message-compose.ts:169,191` |
| Chat | Chat with a plan's scheduled people, one team or several teams. Leaders archive plan chats after the service. | One conversation per team or plan, @mentions (with delayed email, ADR-0007), web and mobile. No chats across several teams (ruled out on purpose), no archiving after the service (only age-based purge). | Partial | [PC29](#pc29); `supabase/migrations/20261026000200_f09_conversations.sql:4-5,38-56,143`, `backend/src/routes/collaboration.ts:224-266`, `mobile/app/chat/[id].tsx:65` |
| Services LIVE on the day | A controller takes control and steps Prev/Next. Now shows the current item with notes, Next previews the upcoming one. Three countdown modes. Same-day chat. Stage and booth layouts. Recorded vs projected times. LIVE permissions. Web and mobile. | Live runs: take control, take over, release, start, advance or jump, pause, end. Countdown modes item, planned end and service end. Recorded times can be corrected. Stage display. Web and mobile. Missing: item notes on Now/Next, chat inside LIVE (it links to the plan chat), choice of layouts, a configurable controller list (needs plan edit rights). | Partial | [PC39](#pc39); `supabase/migrations/20261029000000_f12_live_runs.sql:45,71,386`, `backend/src/routes/live-runs.ts:32-53`, `frontend/src/components/live/LiveRunPanel.tsx:19`, `mobile/app/plan/live/[id].tsx:53` |
| Scheduled reminders (delivery) | Reminders per team on each time (PC14, PC28). | Reminder policies per team or service type (offset, channels, quiet hours, cap), jobs recalculated by triggers. **No production schedule runs the worker**, so reminders, scheduled releases and retries do not fire in production. | Partial (ops gap) | [PC14](#pc14); `supabase/migrations/20261024000000_f08_release_and_reminders.sql:630,1064`, `backend/src/services/delivery-worker.ts:87-89`, `backend/vercel.json` (no `crons`), `docs/plans/email-notifications.md:3` |

### 5. Notifications, help and support

| Planner feature | Planning Center (docs) | Service Center today (code) | Status | Sources |
|---|---|---|---|---|
| Notification bell | Toolbar bell shows notices from every Planning Center product. Open the product, mark read, add to To do, show or hide read ones. | In-app feed with unread count, mark read, clear read and delete, plus Expo push and mention emails, on web and mobile. No "mark unread", no To do. There are no other products to combine. | Present (cross-product: N/A) | [PC84](#pc84), [PC80](#pc80); `backend/src/routes/notifications.ts:57,83,102,124,141`, `frontend/src/components/NotificationBell.tsx`, `mobile/app/notifications.tsx:64` |
| To do and Ask AI | To do tasks from Home. Ask AI answers from help articles. | None. | N/A | [PC84](#pc84) |
| Help sidebar | Search the docs, suggested articles for the current page, PCU, community, changelog, email or phone support. | `/support` page with a mailto link and six FAQ entries. `HelpPage` and mobile `help/` are about acting on someone's behalf (delegation), not documentation. No contextual help. | Partial | [PC84](#pc84), [PC80](#pc80); `frontend/src/router.tsx:78`, `frontend/src/pages/LegalPages.tsx:156-170`, `mobile/src/components/church/DisabledChurchNotice.tsx:34` |
| Org-admin requests to support | Only organization admins can ask support for data fixes, access to others' items, account restore or delete, and Giving access. | Platform super-admin app: orgs, disable, enter org, applications, users, block, delete. Self-service account deletion. No request workflow and no restore. | N/A (operator process) | [PC80](#pc80); `backend/src/routes/admin.ts:108-232`, `backend/src/services/account.ts:46` |

---

## Notable differences

Where Service Center does something Planning Center doesn't, or does it differently:

1. **Publishing is the notify point (ADR-0006).** Planning Center sends a request when someone is released. Service Center plans start as drafts that send nothing. Publishing previews who will be emailed, then asks everyone released and not yet asked, and re-publishing never asks again (`supabase/migrations/20261129000010_publish_notifies.sql:1-20`, `backend/src/model/plan-publish.model.ts:28`). Planners coming from Planning Center need this explained in the UI, because "I scheduled them but nobody was emailed" is the expected first surprise.
2. **Conflicts can be overridden, but only with a reason.** Planning Center never blocks and just shows badges. Service Center returns a 409 unless a capable scheduler gives a reason, and stores it (`backend/src/routes/assignments.ts:153-166`). That is stricter, but auditable.
3. **Blockouts never decline anyone silently.** Planning Center auto-declines unconfirmed requests when a blockout is saved. Service Center lists the affected commitments and asks the person to decline each one explicitly (`frontend/src/components/settings/AffectedCommitments.tsx:24-27`).
4. **Times are chosen per assignment, not per team.** This lets Service Center ask someone for one of several services without split teams. But it lacks Planning Center's "assign the team to the time once, and it applies everywhere and to future plans" shortcut.
5. **Notes and files use explicit audiences.** Files go to organization, scheduled, teams, positions or leaders, and notes to teams through categories with default audiences. This is finer than Planning Center's service-type "limited visibility" switch, but has no single switch.
6. **Atomic, idempotent writes.** Copy, import, release, schedule and item create all use idempotency keys and revision checks (F00/F11). Planning Center's docs make no such promise, and a retried request in Service Center cannot create duplicate plans.
7. **Charts are built in.** ChordPro with transposition and notation conversion is first-party (`packages/shared/src/lib/chordpro.ts`). Planning Center relies on its Lyrics & Chords editor plus provider PDFs.
8. **Staffing proposals take fairness into account** (F06), with rotations and reviewed commits. Planning Center auto-schedule uses availability and last-scheduled date.
9. **Smaller limits on purpose:** 25 MiB per file instead of 4 GB, and templates capped at 12 generated plans per run.

---

## Suggested plan

The order rests on four principles:
1. Make what already exists actually run in production.
2. Fix the screens a planner touches every week (emails, order editor, templates).
3. Tackle the structural time–team change.
4. Then polish.

Sizes are relative engineering effort including tests: S is about 1–3 days, M about 1–2 weeks, L 3 weeks or more.

### Now

| # | What to build | Why it matters to a planner | Size | Depends on | Areas | Epic |
|---|---|---|---|---|---|---|
| N1 | **Production worker schedule.** Ship `feature/delivery-worker-cron` (Supabase `pg_cron` + `pg_net`, or Vercel Cron) calling `/internal/deliveries/run`, and set `CRON_SECRET`. Settings already warns when the worker isn't configured. | Reminder policies, scheduled releases and retries look configured in the UI but never fire in production. Planners trust reminders to chase pending people. | S | none | DB (cron migration) / backend config / ops | F00, F08 (deployment gate) |
| N2 | **Better scheduling email.** Custom message on release, publish and notify. Lines for items the person leads (the F11 leader gap). Each assigned time in the body. Separate Accept and Decline links using the existing tokens (ADR-0001). | This email is the planner's main voice to volunteers. Planning Center includes all of these, and without them planners send a second email by hand. | M | N1 (for scheduled releases) | DB (message on release batch) / backend templates / shared schemas / web + mobile release and publish dialogs | F08, F11 |
| N3 | **Order editor speed pack.** Drag-and-drop on web using the existing reorder endpoint, with buttons kept for accessibility. Quick-add line that parses "Title 3:00". Keyboard shortcuts. "Clear order" as one atomic endpoint with confirmation, editors only. | Building the order is the planner's core weekly task. Up/down buttons and modal-only adding make a 20-item order slow. | M | none | shared (title/length parser) / backend (clear endpoint + revision check) / frontend | F11 |
| N4 | **Template authoring and copy-plan UI.** Create a template from scratch (the API already accepts `content`). Add items, headers, songs, needs and people in the editor. Template leader positions. Copy a template, including to another service type. A "Copy plan" dialog over `duplicatePlan` with items, notes and teams, target service type and quantity. | Planning Center tells planners to export a plan as a template and reuse it. Today a template must start from a live plan and can only be trimmed, and copying a plan is not reachable. | M–L | none (F10 core exists) | shared (template schemas) / backend (duplicate options) / frontend; mobile later | F10 |
| N5 | **Plan notes that reach people.** Include team-targeted plan notes in reminder emails. "Send note as email" to its teams. A "show notes for other teams" toggle. | Planning Center's guidance is that notes are how sermon or cue details reach only the teams that need them, and they mostly arrive through reminders. | S–M | N1 (reminders must run) | backend (reminder template + notes query) / frontend / mobile toggle | F09 |

**Why this order:** N1 is small and unblocks value already built, so it goes first. N2 and N5 change what volunteers actually receive. N3 and N4 save the planner the most time each week. None of them needs a schema redesign.

### Next

| # | What to build | Why it matters to a planner | Size | Depends on | Areas | Epic |
|---|---|---|---|---|---|---|
| X1 | **Teams and positions linked to times.** A time lists its teams and positions, and that becomes the default attendance for new assignments. "Apply to future matching times" (same name, kind and clock time). Reminder offsets per time. | Planning Center's whole conflict, schedule and reminder model hangs off this. Without it, planners re-pick times on every assignment, and rehearsal reminders can't target just the band. | L | N1; F04 attendance resolver | DB (time-team/position link table + RLS, resolver change) / backend / shared / web / mobile times editor | F04, F08 |
| X2 | **Richer items.** Media as a real item type (or a "Media" add path that creates a linked item). Limit an item to certain service times. Long formatted detail (sanitized). Song notes copied from the song's last use in the service type. | Matches how Planning Center planners lay out a multi-service Sunday and reuse song cues. | M | X1 helps with per-time items | DB (enum/columns) / backend / shared / web / mobile edit-item | F11 Pass C, F14 |
| X3 | **Song library parity.** Lyric search (index on chart text). Expandable arrangement rows. Condensed view and column chooser. Mobile schedule history and extra sorts. Create a song from inside a plan. Add a labeled key from the plan item. | Planners pick songs by lyric and theme while building the order, and they lose context switching to the library. | M | none | DB (search index) / backend / shared / web / mobile | F15 |
| X4 | **Service-type admin screens.** Copy and archive buttons (API exists). Folder rename and move UI. Note-category admin with separate item-note categories. LIVE controller list. Optionally item row colors and default service times. | Settings planners or admins expect next to the service type. Most of the backend already exists. | M | none | frontend mostly; small DB for LIVE controllers and colors | F01, F09, F12 |
| X5 | **Message audiences and attachments.** Declined, by time and prepared-only audiences. Attachments via F13 files with an audience check. Plan link in the mobile text handoff. Email a filtered People list. | Day-of changes need "everyone at the 9am who confirmed". Planning Center offers these filters. | M | F13 (exists) | shared schemas / backend audience SQL / web + mobile composer | F09, F13 |
| X6 | **Candidate context in the picker.** Filter by membership of the needed position. "Last scheduled" next to each name (the matrix already computes it). Warn when the person already declined at that time. | Makes the plan-level picker as informed as Planning Center's candidate list, without opening the matrix. | S–M | none | backend (reuse matrix query) / frontend / mobile | F04, F05 |

### Later

| # | What to build | Why it matters | Size | Depends on | Areas | Epic |
|---|---|---|---|---|---|---|
| L1 | **LIVE polish.** Show item notes on Now/Next. A chat panel scoped to the run. Booth and condensed layouts. Keyboard shortcuts for the controller. | Matters on the day, but the current run controller already works. | M | X4 (controller list) | backend / web / mobile | F12 Pass C |
| L2 | **Optional TOTP 2FA for church users**, reusing the admin app's MFA flow. | Planning Center recommends 2FA, and planners and admins hold contact data. | S–M | none | frontend / mobile auth | security (no F-epic) |
| L3 | **Chats spanning several teams, and archiving plan chats after the service.** | Coordinating worship and production together. | M | product decision (group-chat policy, youth rules) | DB / backend / web / mobile | F09 |
| L4 | **Licensed song catalog import (SongSelect/CCLI).** | Faster song entry. | L | a provider agreement | backend / shared / web | F17 Stage B |
| L5 | **In-app help:** contextual "?" links to Service Center docs or FAQ per page. | Planning Center leans on this to help new planners. | S | docs content | frontend / mobile | none |

**Not planned (N/A):**
- Cross-product notification bell, To do, Ask AI, Church Center, PCU and community. These are platform features outside Services.
- The 4 GB upload limit and the 30-day delete recovery. Archive already covers recovery. Raise the limit only if storage costs allow.

---

## Pages, claims and limits

- **No page failed to load.** The starting article rendered fully, including its link list. Its relative links were resolved against `https://help.planningcenter.com/en/`, and each resolved page loaded. The Services category page that rendered only a heading in October ([PC01](planning-center-services-feature-reference.md#pc01)) was not needed this time.
- **Gaps in the articles themselves:**
  - [PC82](#pc82) (plan templates) does not describe exporting a plan as a template or copying templates across service types. Those claims come from [PC36](#pc36) and [PC37](#pc37) instead.
  - [PC81](#pc81) mentions folders without steps.
  - [PC45](#pc45) does not mention named key labels such as "Female key". The October reference's "descriptive labels" wording corresponds to its free-text description field.
- **Intro claims attributed to the intro only:** "send a text to everyone scheduled from the mobile app" and "create one service type per age-group service" come from [PC80](#pc80) and [PC29](#pc29). [PC04](#pc04) adds that repeated times of the same service belong in one plan, not in separate service types.
- **Not verified:**
  - How the toolbar features behave across products ([PC84](#pc84)), since there was no account.
  - Whether the Service Center production deployment has a worker configured some other way. The repo shows none, and `docs/plans/email-notifications.md` says it is deferred.

---

## Source register

All pages are official Planning Center help articles, accessed **2026-11-22**. PC01–PC79 keep the IDs from the [Services feature reference](planning-center-services-feature-reference.md#source-register) (first accessed 2026-10-15; the ones cited here were read again on 2026-11-22). PC80–PC86 are new.

| ID | Official source |
|---|---|
| <a id="pc04"></a>PC04 | [Create a new service type](https://help.planningcenter.com/en/142847-create-a-new-service-type.html) |
| <a id="pc05"></a>PC05 | [Manage service type settings](https://help.planningcenter.com/en/142848-manage-service-type-settings.html) |
| <a id="pc14"></a>PC14 | [Add and assign times](https://help.planningcenter.com/en/139401-add-and-assign-times.html) |
| <a id="pc15"></a>PC15 | [Scheduling conflicts and blockouts](https://help.planningcenter.com/en/142878-scheduling-conflicts-and-blockouts.html) |
| <a id="pc19"></a>PC19 | [Schedule your teams](https://help.planningcenter.com/en/142868-schedule-your-teams.html) |
| <a id="pc27"></a>PC27 | [Send scheduling emails](https://help.planningcenter.com/en/142892-send-scheduling-emails.html) |
| <a id="pc29"></a>PC29 | [Communicate with your teams](https://help.planningcenter.com/en/142889-communicate-with-your-teams.html) |
| <a id="pc32"></a>PC32 | [Set up the service order](https://help.planningcenter.com/en/139467-set-up-the-service-order.html) |
| <a id="pc33"></a>PC33 | [Edit item details](https://help.planningcenter.com/en/139464-edit-item-details.html) |
| <a id="pc36"></a>PC36 | [Export a template or plan](https://help.planningcenter.com/en/139471-export-a-template-or-plan.html) |
| <a id="pc37"></a>PC37 | [Import a template or plan](https://help.planningcenter.com/en/139470-import-a-template-or-plan.html) |
| <a id="pc39"></a>PC39 | [What is Services LIVE?](https://help.planningcenter.com/en/139479-what-is-services-live-.html) |
| <a id="pc42"></a>PC42 | [Songs page overview](https://help.planningcenter.com/en/139427-songs-page-overview.html) |
| <a id="pc43"></a>PC43 | [Add a song to the library](https://help.planningcenter.com/en/139428-add-a-song-to-the-library.html) |
| <a id="pc44"></a>PC44 | [Add or edit an arrangement](https://help.planningcenter.com/en/139430-add-or-edit-an-arrangement.html) |
| <a id="pc45"></a>PC45 | [Add or edit a key](https://help.planningcenter.com/en/139429-add-or-edit-a-key.html) |
| <a id="pc51"></a>PC51 | [Add files to a song](https://help.planningcenter.com/en/139434-add-files-to-a-song.html) |
| <a id="pc56"></a>PC56 | [Create media](https://help.planningcenter.com/en/139423-create-media.html) |
| <a id="pc76"></a>PC76 | [Create or copy a plan](https://help.planningcenter.com/en/139399-create-or-copy-a-plan.html) |
| <a id="pc78"></a>PC78 | [Add files to a plan](https://help.planningcenter.com/en/139463-add-files-to-a-plan.html) |
| <a id="pc80"></a>PC80 | [Introduction for service planners](https://help.planningcenter.com/en/138434-introduction-for-service-planners.html) (starting point) |
| <a id="pc81"></a>PC81 | [Create a service](https://help.planningcenter.com/en/139398-create-a-service.html) |
| <a id="pc82"></a>PC82 | [Set up plan templates](https://help.planningcenter.com/en/139469-set-up-plan-templates.html) |
| <a id="pc83"></a>PC83 | [Use plan notes for team information](https://help.planningcenter.com/en/139462-use-plan-notes-for-team-information.html) |
| <a id="pc84"></a>PC84 | [Toolbar overview](https://help.planningcenter.com/en/136864-toolbar-overview.html) |
| <a id="pc85"></a>PC85 | [Log in to Planning Center](https://help.planningcenter.com/en/140717-log-in-to-planning-center.html) |
| <a id="pc86"></a>PC86 | [Introduction for administrators](https://help.planningcenter.com/en/138432-introduction-for-administrators.html) |
