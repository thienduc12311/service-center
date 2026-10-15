# Service Center: missing-feature user stories

Date: 2026-10-15 · Status: proposed backlog · Baseline: `7f682d34a3643b635192bc20f53820885805d819`

Companion documents: [assessment and delivery plan](../plans/services-feature-gap-plan.md), [feature specification](services-feature-specification.md), [official reference](../research/planning-center-services-feature-reference.md).

Story IDs are stable within their F00–F17 epics. Priorities and sequencing inherit from the delivery plan. **Core** is the first useful slice of the epic; **extension** is a later slice; **optional** requires a separate product/provider decision. Every new workflow also inherits the specification's tenancy, permissions, validation, accessibility, audit, timezone, stale-write and failure-state requirements. Acceptance criteria below describe proposed Service Center behavior; they do not assert the same implementation or defaults in Planning Center.

## F00 — Reliable delivery and workflow foundations

### US-00.1 — Understand and recover delivery outcomes · Core

As an organization administrator, I want to see whether each notification was simulated, accepted by a provider, delivered where known, or failed, so I can tell who still needs to be contacted.

- Given email is unconfigured, when a scheduler notifies a plan, then the result is labeled simulated; it does not claim an email reached the recipient.
- Given three recipients and one provider failure, when the operation completes, then each recipient has their own outcome, the failed recipient is retryable, and only successfully accepted attempts receive acceptance timestamps.
- Given an authorized retry, when the same operation is submitted twice, then the existing idempotent result is returned or reconciled without blindly creating another send. Ambiguous provider timeouts are visible.

### US-00.2 — Preserve actions and apply copies completely · Core

As a scheduler, I want assignment effects and copied plan content to survive partial failures, so I can recover without duplicating or losing work.

- Given a multi-row copy containing items and selected needs, when any required write fails, then the copy rolls back and the destination remains unchanged.
- Given a committed assignment with an enqueued notification, when a worker crashes before delivery, then another bounded worker run can claim the expired lease and continue safely.
- Given either a public response link or signed-in response, when the person declines, then the correct response owner receives one durable scheduler update through the same business rules.

## F01 — Scoped leadership, hierarchy, and access

### US-01.1 — Lead one ministry without organization-wide edit access · Core

As an administrator, I want to give a Band leader access to Band's scheduling and plans, so the leader can serve their ministry with appropriate authority.

- Given access only to Band and its service type, when the leader opens the app, then the allowed actions are visible and effective permissions can be inspected.
- Given a guessed Hosts record ID, when the leader attempts an unauthorized REST or direct Supabase mutation, then it is denied without exposing restricted content.
- Given access is revoked, when the next request or download-link renewal occurs, then the previous grant no longer authorizes it. Owner/admin continuity remains intact during migration.

### US-01.2 — Organize service types and reusable team settings · Extension

As a ministry administrator, I want folders, reusable teams, and clear defaults, so multiple campuses or ministries can share setup without copying permissions accidentally.

- Given nested folders, when a folder is moved, then cycles are rejected and inherited access is recalculated before the move commits.
- Given a team used in two service types, when its membership changes, then both use the shared roster while retaining their own plan-specific assignments and time defaults.
- Given a service type is copied, then selected defaults/templates are copied and people/grants are excluded unless a separately authorized operation explicitly includes them.

### US-01.3 — Apply team eligibility and visibility policy · Optional extension

As a leader, I want tag-derived membership, related-team visibility, and secure-team eligibility checks, so candidates and materials follow our team's actual requirements.

- Given a tag rule, when a person's applicable tags change, then future candidate eligibility updates without rewriting historical assignments.
- Given a secure-team position, when eligibility is absent or expired, then automatic scheduling and signup reject the candidate; an ordinary scheduling override cannot bypass required eligibility.
- Given related-team file access, then only explicitly granted audiences can retrieve content; becoming a related team does not grant organization administration rights.

## F02 — Person-first scheduling and roster lifecycle

### US-02.1 — Schedule a guest who has not logged in · Core

As a scheduler, I want to schedule a roster Person before they create an account, so onboarding does not delay staffing.

- Given a Person without a Profile, when I select them for a team/position and release the request, then an assignment exists for that Person and a configured email can contain a limited tokenized response link.
- Given no email, then the assignment remains valid and the scheduler sees an explicit cannot-deliver warning; no placeholder login is created.
- Given a one-off guest or temporary position, then I can schedule that plan without adding the guest permanently to the team or changing its normal position list. A foreign-organization Person is rejected.

### US-02.2 — Keep history when a Person gains a login · Core

As a volunteer, I want my existing requests and responses to follow me when I accept an organization Invitation, so I do not lose my schedule.

- Given an already-scheduled no-login Person, when their organization Invitation is accepted, then the linked account sees the same assignment IDs/history rather than duplicated requests.
- Given a still-valid response token issued before account linking, then it remains valid for its original request scope and cannot answer unrelated new requests.
- Given an ambiguous existing Person/profile match, then linking stops for explicit resolution; matching email alone does not silently merge identities. Existing profile-only members are reconciled in migration.

### US-02.3 — Maintain a searchable, reversible roster · Extension

As a scheduler, I want skill tags, bulk team changes, and archive/restore, so I can maintain a useful roster without losing history.

- Given selected people, when I preview a bulk tag/team change, then I see the actual affected people and per-row problems before committing.
- Given an archived Person, then normal candidate pickers exclude them, historical plans retain them, and restoring makes them available again without recreating history.
- Given global search, then results across people, teams/positions, plans, songs and media obey the same permissions as opening each record; restricted results are not discoverable by snippets or counts.

## F03 — Availability and scheduling preferences

### US-03.1 — Edit repeating availability without timezone drift · Core

As a volunteer, I want to repeat a blockout and change one or future occurrences, so I do not enter the same unavailable dates every month.

- Given a weekly/monthly rule and end condition, when I preview it, then the upcoming local dates/times are shown in the selected organization timezone.
- Given a series crossing daylight-saving changes, then all-day dates remain all-day and timed occurrences preserve the specified local wall time; invalid/ambiguous times require an explicit resolution.
- Given an occurrence exception, when I edit one, future, or all occurrences, then only that scope changes. An affected existing assignment is shown and is not silently declined.

### US-03.2 — Communicate preferences and availability freshness · Core

As a volunteer, I want to state how often and when I prefer to serve and confirm that my availability is up to date, so leaders can schedule realistically.

- Given a frequency/team-time preference, then candidate lists and proposals display a warning distinct from a global blockout.
- Given a leader's blockout request, when I add dates or affirm no blockouts, then the leader sees my last-reviewed time even when no dates were added.
- Given a preference-only warning, then an authorized scheduler may override with a reason; automated selection follows the configured policy and explains its choice.

### US-03.3 — Help a household member with permission · Extension

As an authorized household delegate, I want to manage a family member's schedule, so we can coordinate availability and responses.

- Given explicit delegation, then I can perform only the approved actions for the approved person; household membership alone does not grant access to another adult's schedule.
- Given a household blockout, then I preview the selected people and can change myself only or the authorized group.
- Given delegation is removed, then future actions fail; past changes retain the actor's identity. Together/apart preferences remain warnings rather than inferred consent to answer requests.

### US-03.4 — See my schedules across organizations · Optional

As a volunteer serving in more than one organization, I want an opted-in combined view and useful widgets, so I can spot conflicts and upcoming requests.

- Given membership in two organizations, then I may combine my own accessible schedules without sharing one organization's plan details with the other's schedulers.
- Given another-organization overlap, then a scheduler sees only a generic unavailable/conflict signal where authorized.
- Given a schedule/rehearsal widget, then it shows the current account/organization context and does not reveal inaccessible prepared requests or retain another user's data after sign-out.

## F04 — Assigned attendance times and conflicts

### US-04.1 — Assign only the times a person must attend · Core

As a scheduler, I want to assign selected service/rehearsal times, so volunteers receive accurate commitments.

- Given 09:00 and 11:00 services plus a Friday rehearsal, when I choose 09:00 and rehearsal for a Person, then the request, personal schedule, ICS/feed and applicable reminders show those times only.
- Given all-times mode, when a new applicable time is added, then its effect is previewed and material changes notify affected people; selected-times mode does not silently acquire the new time.
- Given an attendance-time reference from another plan, then saving is rejected. A split-time answer affects only the request scope displayed to the person.

### US-04.2 — Warn about actual overlaps, including rehearsals · Core

As a scheduler, I want precise conflict warnings, so I can trust both warnings and available candidates.

- Given service intervals 09:00–10:00 and 11:00–12:00, then a 10:15–10:45 assignment is not a conflict merely because it lies between them.
- Given an overlapping rehearsal or another position on the same plan, then the relevant collision is detected; adjacent end/start times do not overlap.
- Given a candidate becomes unavailable between preview and commit, then commit rechecks and rejects or requires an authorized audited override. The response does not leak another organization's details or private blockout reasons.

## F05 — Multi-plan Scheduling and Matrix

### US-05.1 — Staff several plans in one place · Core

As a scheduler, I want people/positions against upcoming plans in one view, so I can balance the month without opening every plan.

- Given a selected date/service-type range, then up to 12 plans and a paginated roster display needs, answers, prepared/released state, availability and recent serving context.
- Given selected cells, when I preview a bulk assignment/removal/release, then changes and conflicts are clear and no notifications are sent during preview.
- Given a stale plan revision at commit, then no silent overwrite occurs; the user can refresh/review changes. Keyboard controls perform the same actions as dragging and saved views retain only the user's authorized filters.

### US-05.2 — Compare and reuse service orders across plans · Extension

As a worship planner, I want to compare songs/items across plans and copy a selected section, so related services can share an order without sharing staffing.

- Given two permitted plans, then their item order, keys, notes and durations can be compared alongside staffing where authorized.
- Given a selected section copied to another plan, then a preview states append/replace and excluded content, and only the chosen order content changes.
- Given a repeated commit or failure, then idempotent/atomic copy behavior prevents accidental duplicate or partial sections. Copying an order does not copy responses, notifications or Live actuals.

## F06 — Rotations and auto-scheduling

### US-06.1 — Generate explainable staffing suggestions · Core

As a scheduler, I want a reviewed staffing proposal based on eligibility and recent serving, so I can fill several plans fairly.

- Given needs and a candidate roster, then blocked/ineligible people are excluded, preferences and frequency are considered, and every proposed choice shows a reason.
- Given a manual/confirmed locked assignment, then the engine preserves it; if no eligible candidate remains, then the proposal leaves the position open and explains why.
- Given identical inputs/rule version/tie-breaker, then the proposal is reproducible. Preview never assigns or sends; commit rechecks current eligibility and creates prepared requests.

### US-06.2 — Reuse a team rotation safely · Core

As a team leader, I want a saved rotation with exceptions, so a predictable serving pattern can be reused without ignoring availability.

- Given rotation weeks and eligible positions, then I can preview the mapping to actual plan dates and override an exceptional week.
- Given a rotation member is blocked, then the proposal leaves an explained vacancy or recommends an eligible substitute according to the selected rule; it does not silently override the blockout.
- Given I adjust/lock a candidate, then regenerating preserves that choice. Undo of an unapplied proposal has no persisted staffing effect; reversing a committed result is a new audited operation that respects subsequent changes.

## F07 — Volunteer signups and replacements

### US-07.1 — Claim an eligible open position · Core

As a team member, I want to see and claim eligible openings with their times, so I can volunteer where needed.

- Given an open position and eligible membership/skills, then I can see the actual attendance times, capacity, deadline and conflict warning before claiming.
- Given two people simultaneously claim the final opening, then only one reservation succeeds; the other receives an updated availability result.
- Given approval mode, then the claim awaits leader approval and does not appear as confirmed. Expired, revoked or ineligible opportunities cannot be claimed by a guessed URL.

### US-07.2 — Recover a declined assignment · Core

As a team leader, I want an open-needs queue and replacement offers, so a decline leads to a clear recovery action.

- Given a declined/withdrawn assignment, then the person's original answer/history is retained and any resulting need appears once in the queue.
- Given a replacement offer, then the candidate's eligibility and conflicts are rechecked; acceptance creates a new assignment rather than copying the previous person's confirmation.
- Given one replacement fills a one-person need, then competing outstanding offers close/expire and cannot overfill it. A volunteer can request help without authority to assign an arbitrary replacement.

### US-07.3 — Swap commitments with explicit approval · Optional extension

As a volunteer, I want to propose a swap, so two people can exchange commitments with leader oversight.

- Given two commitments, then both people and the leader can review positions, times and conflicts before approval.
- Given either side becomes invalid or declines, then the original assignments remain unchanged and the swap fails visibly.
- Given an approved swap, then both linked replacements commit together, retain prior history, and produce updated responses/materials rather than transferring an answer to a different person.

## F08 — Request preparation, release, and reminders

### US-08.1 — Prepare requests before volunteers see them · Core

As a scheduler, I want to prepare a roster and release it deliberately, so people do not respond to unfinished plans.

- Given prepared assignments, then only authorized schedulers can discover them; personal schedules, public links, feeds, notifications and member-facing counts exclude them.
- Given a release preview, then I see recipients, assignments, applicable times and skipped delivery channels before release-now or a scheduled send.
- Given a release across several plans, then one message per person per batch contains clearly separated plan-specific actions; responding to one does not silently answer the others.
- Given release succeeds but email fails, then released requests remain visible, delivery is marked failed, and retry is available. Publishing a plan alone does not send requests.

### US-08.2 — Remind the right people at the right time · Core

As a team leader, I want configurable automatic reminders, so unanswered requests and upcoming commitments do not depend on manual nudges.

- Given enabled policies, then jobs are computed from each recipient's applicable times, grouped appropriately and respect quiet hours/frequency caps.
- Given a person responds, declines, is removed, or the plan is archived before execution, then the worker revalidates and suppresses obsolete reminders. Time changes reschedule pending work.
- Given two worker invocations or a restart, then the job ledger prevents duplicate intent and supports safe retries/terminal failure. A missing worker or configured transport is visible to the administrator.

### US-08.3 — Use response links safely as requests evolve · Core

As a volunteer, I want a response link to describe exactly what I am answering, so I do not unknowingly accept additional responsibilities.

- Given a link issued for a request version, then the preview and response action use the same person/plan/assignment-time scope.
- Given expired, revoked, superseded or already-consumed links, then a limited actionable error is shown without exposing private plan or person data.
- Given a concurrent repeated response, then at most one valid transition consumes the request; new assignments added after issuance are not silently answered. Web and signed-in clients follow the same grouping policy.

## F09 — Collaboration, notes, and targeted communication

### US-09.1 — Share notes and item discussion with the right audience · Core

As a planner, I want categorized notes and comments on items, so cues and questions stay attached to the work they describe.

- Given a note category/audience, then only eligible viewers see it in the plan, note columns, exports, notifications and mobile views.
- Given an item thread with a mention, then authorized recipients receive a link to that thread and private context is not included in an unauthorized preview.
- Given a participant loses access or an item is removed, then subsequent reads/writes follow policy, with an explicit unavailable state and preserved audit/retention behavior.

### US-09.2 — Send a targeted message with a reusable template · Core

As a leader, I want to message a team or selected scheduled/pending people, so operational updates reach a reviewed audience.

- Given a selected audience, then preview resolves actual recipients, duplicates, excluded/no-address people, and allowed template variables.
- Given a shared/personal template, then variables are allowlisted/escaped, authoring permissions are enforced, and the recipient snapshot/message history is retained.
- Given partial delivery failure, then the leader sees per-recipient outcomes and can retry only affected recipients. Replies to the human Reply-To are not represented as an in-app reply unless inbound email exists.

### US-09.3 — Hold a scoped team or plan conversation · Extension

As a volunteer, I want a persistent team/plan conversation with unread state, so questions and changes do not get lost in notification alerts.

- Given valid membership, then I can read/post in permitted conversations, reply and mark messages read; nonmembers cannot open a guessed conversation ID.
- Given a reported message, then authorized moderators can act and an audit remains; membership loss re-evaluates future conversation access.
- Given rich attachments/reactions/read receipts or direct messages are enabled later, then file permissions and the configured youth/guardian messaging policy apply before those channels become available. SMS shortcuts/provider sends are optional separate channel work.

## F10 — Saved templates and bulk plan preparation

### US-10.1 — Save and apply a real plan template · Core

As a planner, I want named templates containing order, notes, times and staffing needs, so new plans do not depend on copying a real service.

- Given selected source content, then saving creates an independent template revision that can be edited without changing any scheduled plan.
- Given a destination with existing content, then apply preview states append/replace, chosen components and conflicts; confirmed answers/delivery timestamps/actual timing are never copied.
- Given a template with needs and optional people, then needs are preserved and people become prepared/unconfirmed requests. Failure or repeated commit cannot leave partial or unintended duplicated content.

### US-10.2 — Prepare several upcoming service dates · Core

As a scheduler, I want to generate a date series from a template, so I can plan the next month efficiently.

- Given recurrence, timezone, date range and template revision, then I can review/edit/skip the proposed dates and see an explicit count limit before creation.
- Given a daylight-saving boundary, then local service/rehearsal times stay as previewed rather than shifting by a fixed UTC-week offset.
- Given a batch interruption, then an atomic or explicitly resumable/idempotent result identifies created plans and errors; retry does not duplicate dates silently or release requests.

### US-10.3 — Reuse sections and reschedule deliberately · Extension

As a planner, I want reusable sections and controlled bulk rescheduling, so last-minute changes preserve the right roster and responses.

- Given an item/section template, then I can apply only that selected content and retain its provenance independently of the original plan.
- Given shifting whole plans versus moving order content only, then preview shows which people, times, notes, feeds and pending jobs change for each mode.
- Given an optional reset-responses choice, then it must be selected explicitly; no answer resets merely because a series/title/artwork or ordinary order content changes.

## F11 — Item editing, responsibility, and running order

### US-11.1 — Edit an existing order item · Core

As a planner, I want to edit an item's description, duration, arrangement and key, so I can correct the service order without deleting and re-adding rows.

- Given an existing item, then its current fields open in an accessible editor and a successful save preserves its ID/order.
- Given a key/sequence override for one plan, then the library arrangement and other plans remain unchanged.
- Given another editor changes the plan, then a stale save returns a reviewable conflict. Invalid arrangement/song relationships and negative durations are rejected.

### US-11.2 — Read charts in the actual service key · Core

As a musician, I want the plan's displayed key, rehearsal chart, mobile chart and exported songbook to agree, so I prepare the version we will play.

- Given a plan key override different from the arrangement key, then every plan-based chart render/export uses the shared effective-key logic.
- Given numbers/numerals/lyrics notation, then key-independent output and labels stay consistent while source chart text remains unchanged.
- Given no valid source key or missing chart, then the UI shows an explicit unavailable/unsupported state rather than displaying a transposed label above untransposed chords.

### US-11.3 — See timings and item responsibility · Core, advanced timing later

As a service director, I want planned start/end times and named responsibilities, so everyone knows the timing and their cues.

- Given a selected service occurrence, then ordered durations yield item start/end and planned finish; headers consume no time, and before/after items are excluded from service duration under the selected mode.
- Given a leader assigned by position, then the named responsible person follows that plan's staffing and appears in permitted messages/reports; an unfilled position is shown clearly.
- Given optional anchor/simultaneous timing, then preview exposes gaps/overlaps and uses the specification's documented rule; it never silently shortens an item. Note columns and media references follow F09/F14 access rules.

## F12 — Live execution and actual timing

### US-12.1 — Control one synchronized service run · Core

As a service director, I want to control current/next items and countdowns for a service occurrence, so the production team stays aligned.

- Given a selected plan time, then starting a run pins a plan snapshot and records authoritative timestamps separate from planned lengths and other runs.
- Given controller advance/pause/resume/jump/end, then viewers converge on the same state and project timers from server time; zero-length headers are handled without misleading countdowns.
- Given two controllers or stale commands, then only the authorized current controller's valid revision applies; explicit takeover is recorded. A disconnected controller sees that commands were not applied.

### US-12.2 — Recover a run and inspect actuals · Core

As a director, I want reconnectable state and actual timing history, so connectivity problems do not erase the service record.

- Given a viewer reconnects, then it loads authoritative state and elapsed time instead of restarting its local countdown.
- Given a mistaken timestamp, then an authorized correction retains previous value/actor/reason and recomputes reports; planned durations remain unchanged.
- Given a second service occurrence, then its run/history is independent. Optional stage/public displays and run chat receive only allowed state, and plan edits require the selected snapshot/rebase policy.

## F13 — Files and file access

### US-13.1 — Attach and retrieve preparation materials · Core

As a planner, I want files/links on plans, items, songs and arrangements, so the team has one reliable source for preparation.

- Given an authorized upload, then type/size/parent ownership is checked, a bounded upload intent is created, and finalized content appears in web/mobile lists and previews/downloads.
- Given an interrupted upload or finalize failure, then incomplete/orphan content is not presented as a completed file and can be retried or cleaned up safely.
- Given a reused attachment, then linking/unlinking a plan reference is distinct from deleting the stored source; key/service-type defaults and text-document authoring can extend the same lifecycle.

### US-13.2 — Restrict materials by position and version · Core

As a leader, I want position/audience-specific materials and explicit versions, so people receive the right chart or track.

- Given a restricted file, then unauthorized API, raw Storage access and download-link issuance fail; hiding the UI link alone does not satisfy acceptance.
- Given a replacement file, then the previous version remains identifiable for plans that pinned it and the current rehearsal manifest states which version it uses.
- Given stream-only/provider-limited content, then unsupported download controls are not offered as a guaranteed protection; authorized delivery and provider rights are explicit. Link renewal obeys current access after membership revocation.

## F14 — Rehearsal, media, and stage preparation

### US-14.1 — Rehearse a plan as an ordered playlist · Core

As a musician, I want an ordered player beside the correct charts, so I can rehearse the whole set on web/mobile.

- Given permitted audio on a plan's songs/media, then the playlist follows plan order and exposes play/pause/seek/repeat/next with effective key/tempo/chart context.
- Given a streaming link rather than playable local audio, then the external-player behavior is clear; the app does not imply it imported or licensed the media.
- Given missing/unauthorized content or playback failure, then the track explains the problem and other available items remain usable. No playlist includes prepared or inaccessible content.

### US-14.2 — Reuse a media bundle or stage layout · Extension

As a production planner, I want reusable media bundles and stage-layout templates, so service preparation includes video/cues and physical placement.

- Given a media bundle, then its metadata/files/thumbnail/tags and scheduled history can be managed and linked to an order item independently of songs/songbooks.
- Given a stage background, then I can place scheduled people and gear, label/rotate/size them, save a plan snapshot and export a PDF.
- Given staffing changes after saving a layout, then mismatches are flagged and a refresh is explicit; an archive removes media from new pickers without breaking historical references.

### US-14.3 — Prepare offline or use advanced stage tools · Optional

As a musician, I want an explicit offline preparation pack and optional stage reader tools, so I can prepare for unreliable connectivity.

- Given allowed downloadable materials, then an explicit download records versions/size and shows ready/stale/missing status; deleting a pack frees its local storage.
- Given offline viewing, then only previously downloaded content is available and stale access/version information is visible; reconnected clients recheck rights and content changes.
- Given advanced audio transforms, loops/metronome, annotations, pedal/page turns or shared stage sessions, then each has a separate supported-platform/media feasibility gate. No immediate offline revocation or commercial Music Stand entitlement is promised.

## F15 — Song library curation and imports

### US-15.1 — Find and archive songs without losing plans · Core

As a worship planner, I want musical/usage filters and reversible archive, so the active library stays useful while history remains intact.

- Given tags/author/key/BPM/date filters, then results use the selected filters consistently across pages and a saved filter can be restored.
- Given an archived song or arrangement, then it leaves ordinary new-plan pickers, remains readable on historical plans, and can be restored.
- Given selected metadata edits, then preview identifies affected records and errors before atomic/bounded commit. Existing chart rendering and song schedule history continue to work.

### US-15.2 — Import structured data with explicit mapping · Core

As an administrator, I want to preview a people/song metadata import, so I can move data without creating hidden duplicates or invalid references.

- Given an uploaded supported file, then column mapping, validation errors and possible existing matches are displayed before persistence.
- Given committed mapped rows, then provenance and an idempotency key are stored and repeated commit returns the prior result; skipped/failed rows are identified.
- Given an uploaded songbook PDF/DOCX, then it remains a document unless an explicitly selected supported parser exists. OCR/AI import is excluded from this story and is not restored by accepting a document.

### US-15.3 — Reuse arrangement versions and labeled keys · Extension

As a worship planner, I want to duplicate an arrangement and maintain labeled keys/files, so different vocal/capo versions do not overwrite each other.

- Given duplication, then selected details/files are copied or referenced according to the preview with new arrangement identity/provenance; the original remains unchanged.
- Given alternate labeled keys, then selecting a plan key resolves the matching files and chart behavior without requiring a duplicate song.
- Given a plan-specific sequence, then it overrides only that item unless a separate explicit library update is chosen. Duplicate-song merge is optional Service Center scope and requires a preview preserving all plan/songbook/file references.

## F16 — Attendance, reports, calendar, and public distribution

### US-16.1 — Record attendance separately from confirmation · Core

As a team leader, I want to mark attendance at a particular service/rehearsal time, so actual participation can be understood.

- Given scheduled people at one plan time, then I can mark present/absent/unknown for my permitted teams, individually or in a reviewed batch.
- Given a confirmed but absent volunteer, then confirmation remains their original answer and the attendance record reflects absence with author/time.
- Given corrected attendance or an archived Person, then history remains auditable and counts deduplicate that person at the occurrence. A leader cannot alter another team's attendance without permission.

### US-16.2 — Print and export trustworthy operational reports · Core

As a ministry leader, I want staffing, participation, song-use and running-order reports, so I can follow up and plan using consistent information.

- Given selected dates/service types/teams/statuses, then web/print/CSV use the same authorized filtered data and identify timezone, generation time and metric definitions.
- Given a person with two positions or a repeated song, then the report distinguishes assignment/occurrence counts from distinct people/plans. Planned participation is not labeled attendance.
- Given Live timing is included, then only applicable run data supplies actual durations and private notes remain excluded. Large exports are bounded/queued and expire; a custom report designer is a later extension.

### US-16.3 — Complete calendar views and scoped feeds · Extension

As a scheduler or volunteer, I want optional availability and personal-date layers with appropriate subscriptions, so I can understand the relevant schedule.

- Given authorized layer selections, then blockouts and opted-in birthdays/anniversaries appear without exposing restricted profile details/reasons.
- Given a personal or scoped team/service-type feed, then it includes only permitted released commitments/applicable times, with bounded dates and stable event IDs.
- Given token rotation or access revocation, then future fetches using revoked authorization fail and link renewal checks current access; the UI explains that external calendar polling controls refresh timing.

### US-16.4 — Share a sanitized plan or set list · Optional extension

As a planner, I want to deliberately publish selected plan details, so a congregation can see a set list without accessing staff material.

- Given a public preview, then only explicitly allowlisted fields appear; staffing names, contacts, attachments, private notes and chat are excluded by default.
- Given publish-now/on-service-day or stable upcoming/recent links, then only eligible published projections resolve; prepared/draft internal content does not leak.
- Given revocation or a newly restricted field, then future public responses omit it. Publishing to Church Center/another product is a separately configured F17 connection.

## F17 — Licensed resources and ecosystem connections

### US-17.1 — Connect one licensed content provider · Optional

As a worship administrator, I want to connect an approved song/file provider and review imports, so the library can use resources our organization is entitled to access.

- Given verified provider access/scopes and rights, then search/import preview shows source IDs, licensed content and existing matches before commit.
- Given import success or partial failure, then provenance/idempotency is retained and retry does not create duplicate resources; credentials never reach clients/logs.
- Given revocation, rate limit or expired access, then the adapter fails visibly and offers reconnect/retry according to provider rules. CCLI metadata alone is not treated as proof of a license.

### US-17.2 — Track file licenses and report defined usage · Optional

As an administrator, I want auditable license activity and an export/reporting connection, so reporting matches actual documented activity.

- Given purchased file-license counts, then applicable access/use can be recorded and exceeding the configured allowance raises a visible warning.
- Given a reporting period, then preview states which copy/use activities and identifiers are being reported; scheduled songs are not automatically equated with reportable use.
- Given provider reporting is enabled later, then its current eligibility/contract is verified first, submitted batches have stable IDs/outcomes, and retry does not double-report silently.

### US-17.3 — Hand off to a chosen external product or integration · Optional

As an administrator, I want one deliberate People/Calendar/Check-Ins/Publishing/presentation connection, so relevant data can be reused without cloning that product.

- Given a named use case and verified adapter, then preview describes source/target ownership, mappings and direction of synchronization.
- Given repeated source events, then idempotent mapping/reconciliation prevents duplicate attendance, media or published records; failures appear in an actionable log.
- Given disconnection, then new sync stops and the UI states what historical data is retained. No connection implies room booking, label printing, sermon distribution or other unrelated full-product scope.

### US-17.4 — Use a scoped developer API and reliable events · Optional proposal

As an integration developer, I want revocable scoped credentials and signed events, so an approved integration can use Service Center safely.

- Given an organization-issued credential, then the public versioned API enforces its scope, tenant, pagination and rate limits separately from a human session.
- Given an event delivery, then it includes an event ID/signature and supports bounded retries/replay protection; consumers can deduplicate it.
- Given credential revocation or webhook failure, then access stops and delivery history is visible to authorized administrators. Endpoint/webhook parity with Planning Center is not claimed by this research.

## Backlog traceability and release checklist

Every epic above maps to a specification section and delivery-plan row. Existing core features are intentionally not rewritten as new stories. Extension stories are separate refinable work; accepting a core slice does not imply accepting all extensions or provider costs.

For any story moved into implementation, record: owner, selected core/extension scope, design/API contract, dependencies, a user-visible success path, unauthorized path, meaningful failure/edge case, migration/compatibility needs, and client coverage. For concurrent scheduling/signup/worker/Live actions include race tests; for permission/file changes include direct RLS/Storage tests. Use the specification's measurable quality targets only after agreeing on reference data/network and measuring the baseline.
