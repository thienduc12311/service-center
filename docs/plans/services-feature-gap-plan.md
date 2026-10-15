# Service Center: Services feature gaps and delivery plan

Assessed: **2026-10-15** · Code baseline: `7f682d34a3643b635192bc20f53820885805d819` · Status: proposed product backlog

Mobile-specific follow-up: [native feature comparison and tasks](mobile-feature-tasks.md), [mobile implementation/UI specification](../specs/mobile-feature-specification.md), and [mobile-only source research](../research/planning-center-services-mobile-reference.md). These distinguish native functionality from web-only and optional capabilities.

Implementation instructions: [missing Services capabilities prompts, F00–F17](../prompts/services-capabilities/README.md), with separate core/extension passes, shared execution rules and mobile dependency links. See the [prompt index](../prompts/README.md) for both mobile ranges and usage examples. These instructions do not change implementation status.

## Recommendation

Service Center already implements the core single-plan workflow. The highest-value next increment is reliable, person-first scheduling: scoped leadership, scheduling before login, accurate assigned-time conflicts, prepared/released requests, and automated reminders. Build reusable planning and multi-plan staffing on that foundation; then complete preparation materials, collaboration, service execution, and reporting.

This package contains:

- [Official feature reference](../research/planning-center-services-feature-reference.md): 52 documented capability groups and 79 official sources.
- This document: source-code evidence, feature-by-feature comparison, priorities, dependencies, and delivery slices.
- [Product and technical specification](../specs/services-feature-specification.md): required behavior, candidate contracts/data responsibilities, migration approach, and release gates for F00–F17.
- [User stories and acceptance criteria](../specs/services-user-stories.md): backlog entries linked to the same epic IDs.

The comparison starts from the user's [Services documentation](https://help.planningcenter.com/en/138429-services.html). That category rendered as an empty index to the text parser, so research followed accessible official leaf articles and official-site searches. The reference covers the major documented feature families, including mobile and optional extensions; it is **not a verified exhaustive inventory of every setting or entitlement**. No authenticated Planning Center account or live Service Center deployment was tested.

## How to read the comparison

**Present** means a meaningful implementation path is visible in current source, not that production configuration or every edge case has been verified. **Partial** means useful supporting behavior exists but the documented workflow is incomplete. **Missing** means no application workflow/model/API was found in the reviewed surfaces. **Optional** identifies add-ons, ecosystem dependencies, or product choices that should not block core delivery.

Official citations `PCxx` link to the research source register. Code citations `Exx` link to the evidence register below. The comparison used current routes/services, shared schemas/types/client, web pages, mobile routes, and the ordered migration history. Readmes and old plans were context, not implementation proof. A database table or notification enum alone was not counted as a delivered feature.

### Existing capabilities to retain

Organizations and role-based membership; roster creation and organization invitations; service-type setup/recurrence; teams/multiple positions; plan CRUD/duplicate/copy; multiple service/rehearsal/other times; ordered songs/headers/free-form items and durations; plan staffing needs; manual scheduling with basic conflict checks; confirm/decline; one-off blockouts; personal schedule/calendar/feed; optional Resend email, tokenized responses and ICS; in-app notifications and optional Expo push; song metadata/arrangements/ChordPro transposition/notation/PDF export; song scheduling history; and manual/document songbooks. [E01](#e01), [E02](#e02), [E03](#e03), [E04](#e04), [E05](#e05), [E06](#e06), [E07](#e07), [E08](#e08), [E09](#e09), [E10](#e10), [E11](#e11), [E12](#e12)

Two important corrections to older expectations:

1. [`assignment-notifications.md`](assignment-notifications.md) describes an earlier state. The current code contains Resend transport, token response routes, feeds, ICS, notifications, and push integration. Do not create another backlog to rebuild those capabilities. Actual delivery still depends on configuration; console transport can count as a successful send in current application logic. [E07](#e07), [E08](#e08)
2. Chord-sheet OCR/AI import was explicitly removed by a later migration. Uploaded songbook documents are stored as documents, not parsed into a song library. Restoring OCR would be a new product decision. [E12](#e12), [E13](#e13)

## Feature comparison

### Organization, people, teams, and availability

| Reference capability | Current Service Center evidence/state | Remaining scope | Epic | Official evidence |
|---|---|---|---|---|
| Organizations, service types, recurrence and setup | **Present foundation:** organization settings, setup wizard, recurrence and next-plan suggestion. [E01](#e01), [E02](#e02) | Folder hierarchy, copy/archive service types, reusable defaults and landing context | F01/F10 | [PC02–05](../research/planning-center-services-feature-reference.md#pc02) |
| Service-type settings | **Partial:** description/recurrence and linked teams; initial times live on the first plan. [E02](#e02) | Default time rules, note categories, files, visibility, request/reminder policies | F01/F08/F09/F10/F13 | [PC05](../research/planning-center-services-feature-reference.md#pc05) |
| Scoped People/Plans/Songs/Media permissions | **Partial:** four organization-wide roles and RLS. [E14](#e14) | Team/service-type capability grants, inherited folder access, effective-access UI, sensitive field/file rules | F01 | [PC06–07](../research/planning-center-services-feature-reference.md#pc06) |
| Add people, optional welcome/onboarding | **Present foundation:** Person independent of Profile, invite acceptance. [E06](#e06) | Roster archive/restore and bulk import/team actions | F02/F15 | [PC08](../research/planning-center-services-feature-reference.md#pc08), [PC12–13](../research/planning-center-services-feature-reference.md#pc12) |
| Schedule guests and temporary positions before login | **Partial:** roster supports no-login people, but scheduler filters them out and assignment/team membership references Profile. [E05](#e05), [E06](#e06) | Person-based assignment, guest creation from scheduler, plan-only temporary positions, account-link continuity | F02 | [PC08–09](../research/planning-center-services-feature-reference.md#pc09); pre-login support is a documented-workflow inference |
| Teams, leaders and positions | **Present foundation:** team/position/member CRUD, several positions per person. [E06](#e06) | Scoped leaders/response owner, copy team, reusable defaults, membership across several service types | F01/F02 | [PC10–11](../research/planning-center-services-feature-reference.md#pc10) |
| Split/rehearsal/tag/secure teams and related visibility | **Missing variants:** one optional service-type FK on a team. [E06](#e06), [E15](#e15) | Time subsets, rehearsal/file tools, tag membership; optional eligibility-backed secure teams and related-team access | F01/F04/F13/F14 | [PC11](../research/planning-center-services-feature-reference.md#pc11) |
| People tags, bulk edits and universal search | **Missing:** roster/name filtering and entity-specific song search exist. [E06](#e06), [E10](#e10), [E16](#e16) | Skills/tags/groups, bulk previews/history, permission-scoped global search | F02/F15 | [PC13](../research/planning-center-services-feature-reference.md#pc13), [PC72–73](../research/planning-center-services-feature-reference.md#pc72) |
| Reversible people archive | **Partial:** member inactivity and Person deletion exist. [E06](#e06) | Archive/restore roster identity, retain historical staffing, separate permanent delete | F02 | [PC12](../research/planning-center-services-feature-reference.md#pc12) |
| One-off blockouts | **Present foundation:** create/list/delete; scheduler can enter for others. [E09](#e09) | Edit UI/API, all-day semantics and affected-assignment warning | F03 | [PC16](../research/planning-center-services-feature-reference.md#pc16) |
| Recurring availability | **Missing:** blockouts contain only start/end/reason. [E09](#e09), [E15](#e15) | Weekly/monthly patterns, exceptions, one/future/all changes, timezone rules | F03 | [PC16](../research/planning-center-services-feature-reference.md#pc16) |
| Scheduling preferences and household assistance | **Missing.** [E15](#e15), [E16](#e16) | Frequency/time preferences, explicit household delegation, together/apart preferences | F03 | [PC17–18](../research/planning-center-services-feature-reference.md#pc17) |
| Blockout requests and freshness | **Missing:** no availability collection workflow. [E09](#e09), [E16](#e16) | Request availability, affirm no blockouts, last-reviewed status | F03/F08 | [PC74](../research/planning-center-services-feature-reference.md#pc74) |
| Linked accounts, aggregate schedules, mobile widgets | **Partial:** org switching exists; queries use active org. [E01](#e01), [E17](#e17) | Opt-in combined schedule, redacted cross-org warnings, request/rehearsal widgets | F03, optional extension | [PC69–70](../research/planning-center-services-feature-reference.md#pc69) |

### Scheduling and communication

| Reference capability | Current Service Center evidence/state | Remaining scope | Epic | Official evidence |
|---|---|---|---|---|
| Manual staffing and needed positions | **Present foundation:** assignments, counts and editable needs on one plan. [E03](#e03), [E05](#e05), [E18](#e18) | Candidate history/preference context, holistic vacancy view; reuse existing need counts | F05/F07 | [PC19–20](../research/planning-center-services-feature-reference.md#pc19) |
| Assigned service/rehearsal/other times | **Partial:** multiple plan times exist; assignments apply to the whole plan. [E03](#e03), [E05](#e05), [E15](#e15) | Attendance selection/defaults by team/position/person; split-time answers and feeds | F04 | [PC14](../research/planning-center-services-feature-reference.md#pc14) |
| Conflict checking | **Partial:** blockout/double-book warnings and override exist; service-only envelope, same-plan results removed. [E05](#e05), [E14](#e14) | Rehearsal/per-assignment intervals, preference severity, recheck concurrent writes, audited overrides | F04 | [PC15](../research/planning-center-services-feature-reference.md#pc15) |
| Multi-plan roster/matrix | **Missing:** one-plan editor and previous/next navigation. [E04](#e04), [E16](#e16) | Bounded staffing matrix, bulk actions, saved views; order matrix separate but connected | F05 | [PC21–23](../research/planning-center-services-feature-reference.md#pc21) |
| Rotations and auto-scheduling | **Missing:** no rule/proposal/rotation workflow. [E15](#e15), [E16](#e16) | Fairness/availability-aware proposals, unmet needs, manual review/commit, locks | F06 | [PC24](../research/planning-center-services-feature-reference.md#pc24), [PC35](../research/planning-center-services-feature-reference.md#pc35) |
| Team signup sheets | **Missing:** account signup exists, volunteer opportunity signup does not. [E05](#e05), [E16](#e16) | Eligible positions, open capacity/deadline, race-safe claim, optional approval | F07 | [PC25–26](../research/planning-center-services-feature-reference.md#pc25) |
| Accept/decline requests | **Present foundation:** per-assignment authenticated response and grouped person-plan public response. [E05](#e05), [E07](#e07) | Consistent batch/split-time response semantics, decline reason UX, request-version safety | F02/F04/F08 | [PC26–27](../research/planning-center-services-feature-reference.md#pc26) |
| Replacement and decline recovery | **Partial:** decline alert and local needed count exist; no replacement lifecycle. [E05](#e05), [E07](#e07), [E18](#e18) | Open-needs queue, replacement offers/approval, optional linked swaps | F07 | [PC11](../research/planning-center-services-feature-reference.md#pc11), [PC26](../research/planning-center-services-feature-reference.md#pc26) |
| Prepared requests and scheduled release | **Partial:** notify flag and manual resend; web manual scheduling always sets notify true. Draft is not private under current read policies. [E05](#e05), [E14](#e14) | Explicit prepared visibility, audience preview, grouped multi-plan release, scheduled sends | F01/F08 | [PC27](../research/planning-center-services-feature-reference.md#pc27), [PC22](../research/planning-center-services-feature-reference.md#pc22) |
| Automatic reminders | **Partial:** manual notify emits `assignment_reminder`; no durable due-job/cron workflow found. [E05](#e05), [E08](#e08), [E16](#e16) | Team/time policies, durable jobs, cancellation/revalidation/retries, delivery history/preferences | F00/F08 | [PC28](../research/planning-center-services-feature-reference.md#pc28) |
| Notifications and delivery | **Present foundation:** feed/read count, Expo device tokens, optional transport adapters; no per-recipient provider outcome ledger. [E07](#e07), [E08](#e08) | Honest simulated/accepted/delivered/failed statuses; reliable worker/outbox and retries | F00/F08 | [PC27–30](../research/planning-center-services-feature-reference.md#pc27) |
| Targeted email and configurable templates | **Partial:** fixed account/schedule email templates and human Reply-To exist. [E08](#e08) | Compose for teams/scheduled/pending, audience preview, shared/personal templates, history | F09 | [PC29](../research/planning-center-services-feature-reference.md#pc29), [PC75](../research/planning-center-services-feature-reference.md#pc75) |
| Team/plan/direct chat and rich mobile messages | **Missing:** notification bell is not a conversation. [E08](#e08), [E16](#e16), [E17](#e17) | Threads, chat, mentions/unread, scoped membership, moderation; rich/DM youth policy later | F09 | [PC29–31](../research/planning-center-services-feature-reference.md#pc29) |
| SMS/carrier notifications | **Missing/optional.** [E08](#e08) | Device compose shortcut or verified provider integration; distinguish from reliable app push | F09/F17 | [PC29–30](../research/planning-center-services-feature-reference.md#pc29) |

### Plan authoring and service execution

| Reference capability | Current Service Center evidence/state | Remaining scope | Epic | Official evidence |
|---|---|---|---|---|
| Order builder and item editing | **Partial:** add/delete/up/down items, descriptions, arrangement/key, duration; PATCH exists but Order UI exposes no edit action. [E03](#e03), [E04](#e04) | In-place edit, keyboard/drag alternatives, linked media, quick add | F11 | [PC32–33](../research/planning-center-services-feature-reference.md#pc32), [PC60](../research/planning-center-services-feature-reference.md#pc60) |
| Advanced timing and service-specific items | **Partial:** durations/total length exist, not per-item start/end or applicability. [E03](#e03), [E04](#e04), [E15](#e15) | Computed timing, before/after placement, per-service applicability; proposed anchors/simultaneous mode later | F11 | [PC33](../research/planning-center-services-feature-reference.md#pc33) |
| Item responsibilities and categorized notes | **Partial:** one plan notes string and item description. [E03](#e03), [E15](#e15) | Direct/position leaders, formatted/category notes, audience-specific columns/notifications | F09/F11 | [PC34](../research/planning-center-services-feature-reference.md#pc34), [PC38](../research/planning-center-services-feature-reference.md#pc38) |
| Saved templates and reusable sections | **Partial:** “Import template” is sequential append from another live plan; duplicate copies items/assignments, not position needs. [E03](#e03), [E04](#e04) | Independent template library/revisions, selected-content apply preview, needs/time rules, atomicity | F10 | [PC35–37](../research/planning-center-services-feature-reference.md#pc35) |
| Bulk creation/rescheduling and plan series | **Partial:** single duplicate and next-occurrence creation. [E03](#e03), [E04](#e04) | Date-series preview, template generation, shift whole plans vs orders only, series/art, reset policy | F10 | [PC38](../research/planning-center-services-feature-reference.md#pc38), [PC76–77](../research/planning-center-services-feature-reference.md#pc76) |
| Live service control and countdown | **Missing:** no run/controller/actual timing model or UI found. [E15](#e15), [E16](#e16) | Current/next/countdown, controller transfer, synced viewer, reconnect, run chat | F12 | [PC39–40](../research/planning-center-services-feature-reference.md#pc39) |
| Actual timing history | **Missing:** programmed duration is not recorded execution. [E03](#e03), [E15](#e15) | Per-service actual timestamps, audited corrections, planned-vs-actual reports | F12/F16 | [PC41](../research/planning-center-services-feature-reference.md#pc41) |
| Public plans/set lists/permalinks | **Missing:** public routes only cover invites, response tokens, personal feed. [E01](#e01) | Sanitized opt-in projection, scheduling/revocation, upcoming/recent permalink, explicit sharing | F16 | [PC67](../research/planning-center-services-feature-reference.md#pc67) |

### Songs, files, rehearsal, reports, and integrations

| Reference capability | Current Service Center evidence/state | Remaining scope | Epic | Official evidence |
|---|---|---|---|---|
| Songs, arrangements, metadata, schedule history | **Present foundation:** metadata/tag fields, arrangement CRUD, most recent use and per-song history. [E10](#e10) | Bulk curation, broader filters; preserve existing history | F15 | [PC42–44](../research/planning-center-services-feature-reference.md#pc42) |
| Multiple labeled keys and plan-specific sequences | **Partial:** one key/capo/sequence per arrangement and key override per plan item. [E10](#e10), [E15](#e15) | Key records/files, arrangement duplication, per-plan sequence without changing library | F11/F15 | [PC44–46](../research/planning-center-services-feature-reference.md#pc44) |
| Chart editor, transposition and printable charts | **Present foundation:** ChordPro edit, notation conversion, key transposition, formatting, PDF. [E11](#e11) | Ensure plan rehearsal uses effective key consistently; audio transform is separate | F11/F14 | [PC49–50](../research/planning-center-services-feature-reference.md#pc49) |
| Song search/filter/archive | **Partial:** API title/theme and recent sorting; metadata fields exist. Delete exists, archive does not. [E10](#e10), [E15](#e15) | Musical/usage filters, saved filters, archive/restore, bulk edits | F15 | [PC47–48](../research/planning-center-services-feature-reference.md#pc47) |
| Song/arrangement/key/plan/item/service-type files | **Partial:** attachment table/bucket exists; no file workflow in router/client/UI; separate songbook uploads work. [E12](#e12), [E15](#e15), [E16](#e16) | Upload/link/list/preview/download/lifecycle, correct parent/key linkage, reusable text docs | F13 | [PC51](../research/planning-center-services-feature-reference.md#pc51), [PC78](../research/planning-center-services-feature-reference.md#pc78) |
| Position-specific file visibility and download controls | **Missing workflow:** attachment bucket reads are organization-wide. [E13](#e13), [E14](#e14) | Audience/position tags, authorized URLs and Storage policy, stream/download distinctions | F01/F13 | [PC52–53](../research/planning-center-services-feature-reference.md#pc52) |
| Rehearsal playlist/audio controls | **Partial:** Rehearse displays charts only; mobile song screens display charts. [E04](#e04), [E17](#e17) | Ordered player, seek/repeat, linked video/files; later loops/metronome/audio transforms/cache | F14 | [PC54–55](../research/planning-center-services-feature-reference.md#pc54) |
| Songbooks | **Present foundation:** manual collections, stored documents, chart and service songbook print/export. [E04](#e04), [E11](#e11), [E12](#e12) | Combined permitted uploaded PDFs/advanced preparation pack; do not rebuild existing chart book export | F13/F14 | [PC54](../research/planning-center-services-feature-reference.md#pc54) |
| Reusable media library | **Missing:** songs/songbooks are not general media bundles. [E15](#e15), [E16](#e16) | Media metadata, tags/files/thumbnail/history, order linking, archive | F14 | [PC56](../research/planning-center-services-feature-reference.md#pc56) |
| Stage layouts | **Missing.** [E15](#e15), [E16](#e16) | Reusable background, people/gear placement, plan snapshots/PDF | F14, later extension | [PC79](../research/planning-center-services-feature-reference.md#pc79) |
| Music Stand-style stage reader | **Missing/optional add-on parity:** ordinary charts are present. [E11](#e11), [E17](#e17) | PDF annotation, hands-free/shared page navigation and offline library | F14, optional | [PC54](../research/planning-center-services-feature-reference.md#pc54) |
| Volunteer attendance | **Missing:** assignment answers are not attendance. [E15](#e15) | Per-person/per-plan-time presence, team-leader entry/corrections; optional Check-Ins input | F16/F17 | [PC57–58](../research/planning-center-services-feature-reference.md#pc57) |
| Calendar and personal subscription | **Present foundation:** plan-time calendar, filters/mine, personal token feed/rotation, ICS. [E09](#e09) | Optional blockout/birthday/anniversary layers, scoped shared feeds and time-specific attendance | F04/F16 | [PC59](../research/planning-center-services-feature-reference.md#pc59), [PC61](../research/planning-center-services-feature-reference.md#pc61) |
| Plan/people/song/service reports | **Partial:** dashboard counts, song history and printable charts/songbooks. [E04](#e04), [E10](#e10), [E11](#e11), [E16](#e16) | Running-order/roster/matrix print, staffing/frequency/usage/attendance/actual timing, CSV; custom designer later | F16 | [PC62–64](../research/planning-center-services-feature-reference.md#pc62) |
| Licensed catalogs and file usage | **Partial metadata only:** CCLI number/copyright/administration. [E10](#e10), [E15](#e15) | SongSelect/MultiTracks/PraiseCharts adapter, license counts/activity, verified manual/automatic reporting | F17, optional | [PC42–43](../research/planning-center-services-feature-reference.md#pc42), [PC65–66](../research/planning-center-services-feature-reference.md#pc65) |
| Other Planning Center products/presentation providers | **Missing/optional:** no connected product adapter found. [E01](#e01), [E16](#e16) | Specific People/Calendar/Check-Ins/Publishing/media handoffs after requirements/provider spike | F17 | [PC38](../research/planning-center-services-feature-reference.md#pc38), [PC58](../research/planning-center-services-feature-reference.md#pc58), [PC68](../research/planning-center-services-feature-reference.md#pc68) |
| Public developer API/webhooks | **Internal API present:** authenticated REST client is first-party. [E01](#e01), [E16](#e16) | Scoped revocable external credentials, versioned contracts, signed/retryable webhooks if needed | F17, proposal; endpoint parity unverified | [PC71](../research/planning-center-services-feature-reference.md#pc71) |
| Mobile scheduler parity | **Partial:** volunteer agenda, response, charts, songbooks, profile, calendar and notification views; plan screen is primarily read/respond. [E17](#e17) | Authorized add/edit/schedule, signups/replacements, messages, rehearsal/Live; web-first advanced bulk tools | Cross-cutting F02–F16 | [PC09](../research/planning-center-services-feature-reference.md#pc09), [PC26](../research/planning-center-services-feature-reference.md#pc26), [PC55](../research/planning-center-services-feature-reference.md#pc55) |

**Not reference-product claims:** duplicate-song merge/detection, custom anchor/simultaneous timing rules, provider-independent outbox architecture, approval-mode signups, and the exact default reminder cadence are proposed Service Center design choices. The public API source was not parseable, so no endpoint/webhook parity claim is made. Advanced folder/media/public-sharing features are included for completeness but are not all MVP requirements.

## Prioritized backlog

Priorities: **P0** prerequisite correctness; **P1** weekly operational need; **P2** broader workflow completeness; **P3** optional/add-on or integration-dependent. Sizes are relative engineering complexity, including clients, persistence and meaningful tests: S/M/L/XL. They are not delivery dates.

| Epic | Priority / size | Smallest useful result | Dependencies |
|---|---|---|---|
| F00 Delivery and workflow readiness | P0 / M | Honest delivery modes/outcomes; durable effects and atomic copying | Existing transports and assignment flows |
| F01 Scoped leadership and hierarchy | P1 core, P2 extensions / L | Team/service-type authority and prepared visibility | Role/RLS audit; F00 events |
| F02 Person-first scheduling and roster lifecycle | P1 / XL | Schedule and notify a Person before login; preserve identity/history | F01 core; additive identity migration |
| F03 Availability and preferences | P1 core, P2 household/widgets / L | Edit/repeat availability and capture frequency preferences | F02 identity; F01 scoped readers |
| F04 Assigned times and conflicts | P1 / L | Correct intervals in scheduling, responses and calendars | F02 identity; F03 basic preference contract |
| F05 Multi-plan Scheduling/Matrix | P1 / L | Staff up to 12 plans in one view with previewed bulk actions | F01/F04; F10 for order reuse |
| F06 Rotations and auto-scheduling | P2 / XL | Explainable reviewed staffing proposals | F03/F04/F05; F10 template rules |
| F07 Signups and replacements | P2 / L | Race-safe eligible signup and vacancy recovery | F01/F02/F04/F08 release contract |
| F08 Reminders and release | P1 / L | Prepared requests, scheduled release, configurable reminders/history | F00/F01/F02/F04; durable worker deployment |
| F09 Collaboration and messages | P2 / L | Scoped notes/comments and targeted messages | F01/F08; F13 for message uploads |
| F10 Templates and bulk plans | P1 / L | Saved templates with needs, safe apply/generation | F00 atomic copy; F01; F04 time semantics |
| F11 Item editing and timing | P1 core, P2 advanced / M–L | Edit current items, effective-key charts, timed running order | Existing item API; F01; F09 categories later |
| F12 Live execution | P2 / XL | Authoritative per-service run and synced countdown | F01/F11; transport/reconnect spike |
| F13 Files and audiences | P1 core / L | Authorized plan/song/arrangement upload and retrieval | F01; Storage-policy migration |
| F14 Rehearsal, media and stage | P2 basic, P3 advanced / XL | Working plan playlist with charts/permitted files | F11/F13; F08 jobs for transforms later |
| F15 Library curation/import | P2 / M–L | Archive/restore, broader filters, bulk metadata/CSV previews | F01/F02; F13 for file-aware arrangement copies |
| F16 Attendance/reports/calendar/public sharing | P2 core, P3 custom/public / L | Printable order/roster, staffing/usage reports, actual attendance | F01/F04/F11; F12 for actual timing |
| F17 Ecosystem/licensing/developer access | P3 / XL, spike first | One explicitly chosen connection with auditable sync | F01/F08/F13; provider access/rights |

Core and extension slices within an epic are intentionally separable. For example, scoped team leadership does not require shipping nested folders, and a playlist does not require building Music Stand.

## Dependency-based implementation plan

### Milestone 0 — Establish trustworthy foundations

Deliver F00; the scoped-access/prepared-visibility contract from F01; and the quick-win F11 item editor/effective-key rendering fix. Extract assignment effects and plan-copy rules into services used by all writers. Baseline migrations, public response semantics, and current permission behavior before identity changes. Decide a durable worker execution mechanism compatible with the actual chosen deployment.

**Gate:** no false “delivered” status; one failed copied row leaves no partial plan; editing an item's key produces matching chart/print output; scoped visibility is verified via API and direct RLS access. Preserve existing single-plan use throughout.

### Milestone 1 — Finish the scheduling contract

Deliver F02 additive person identity; F03 blockout editing/repeats/basic preferences; F04 time attendance/conflicts; F08 prepared release and reminders. Complete web/mobile response and calendar semantics together, including outstanding token compatibility.

**Gate:** a no-login guest can be scheduled and respond; Friday rehearsal clashes are detected; split services avoid false conflicts; response before a reminder job runs suppresses that reminder; upgrading to a login retains history and pending links. Pilot one organization with configured transport; simulation remains clearly labeled elsewhere.

### Milestone 2 — Plan and staff several weeks

Deliver F10 saved templates/date-series creation; F05 staffing matrix and bounded bulk operations; F06 deterministic proposals; F07 signups/replacements. Expand F01 team defaults/shared service-type associations where these workflows require them. Order Matrix reuse follows the shared copy contract.

**Gate:** create four upcoming plans with correct local times/needs; propose fair staffing without blocked people; preserve manual choices; review/release once; two simultaneous claims cannot overfill one opening; failed or stale bulk work has a clear recoverable result.

### Milestone 3 — Prepare the team

Deliver F13 file lifecycle/audiences, F09 notes/comments/targeted messages, F14 basic rehearsal player/media, F15 archive/filter/import improvements. Add item responsibilities and selected note columns from F11. Deliver volunteer mobile flows with their web counterparts.

**Gate:** a scheduled musician receives the right chart, key and audio; another position cannot retrieve restricted files; historical songs remain readable after archive; every target message has a preview and delivery outcome. No file visibility promise ships before matching Storage policy changes.

### Milestone 4 — Run, record, and evaluate

Deliver F12 Live control, F16 attendance/operational reports/print/calendar layers. Add audited timing corrections and planned-vs-actual analysis after basic run persistence is stable.

**Gate:** two clients follow one service run; controller conflict/reconnect is safe; attendance is separate from confirmation; reports reconcile to source records and use the same filters/timezone as printed/exported output.

### Milestone 5 — Adopt selected extensions

Choose from nested hierarchy, household delegation/aggregate accounts/widgets, rich chat, stage layouts, offline/stage-reader tooling, custom report design, public sharing and F17 connections. Run provider/media feasibility spikes before estimates. Ship one connection end-to-end before adding a broad integration catalog.

**Gate:** each optional slice has an owner, usage requirement, access/rights contract, measurable adoption hypothesis, and operational failure/revocation path. No assumption of access to another product's paid features or commercial APIs.

## Suggested first implementation tickets

1. **F00 / US-00.1–00.2:** replace aggregate delivery success bookkeeping with per-recipient outcomes and a durable, retryable effect boundary.
2. **F11 / US-11.1–11.2:** expose existing item update API in Order, and resolve plan charts using effective arrangement/key consistently. This is a small visible improvement while foundations progress.
3. **F01 / US-01.1:** define/test team/service-type grants and prepared-request visibility before new scheduling writers appear.
4. **F02 / US-02.1–02.2:** design additive Person assignment migration, including legacy profile-only roster members and outstanding response tokens.
5. **F04 / US-04.1–04.2:** introduce selected attendance times and one shared conflict/calendar resolver.

Ticket order reflects integration constraints; it does not authorize migrations or product implementation in this documentation-only request.

## Validation and completion measures

This task changes documentation only. Validate internal links, source-path anchors, epic/story traceability, and consistency against current source; application tests are not needed to validate prose. Implementation PRs must run the checks in `CLAUDE.md` appropriate to their changes, including build/typechecks, meaningful integration tests, database/RLS/Storage tests, and web/mobile smoke paths. The [specification](../specs/services-feature-specification.md#5-migration-validation-and-release-criteria) defines concurrency/failure/timezone gates.

Proposed product measures: time to staff four plans; unresolved required positions before service; response rate/latency; reminders suppressed after response; delivery failures recovered; preparation-material access failures; report reconciliation; Live synchronization/reconnect success. Establish current measurements before setting improvement percentages. No current benchmark was measured during this review.

Open scope decisions for implementation kickoff: available team/capacity, target ministry size, single/multiple campuses, actual deployed email/push/worker configuration, household authority policy, media rights/providers, and optional integration priority. The recommendations above proceed with a web-led scheduler and fully supported volunteer mobile workflow.

## Code evidence register

Links are relative to this document and pinned conceptually to the baseline SHA above; line anchors identify representative positive evidence. Negative findings also used the route/client/model inventory in E16. The app was inspected statically; no credentials, live data, or production delivery were inspected.

| ID | Evidence and exact implementation boundary |
|---|---|
| <a id="e01"></a>E01 | [API mounts](../../backend/src/app.ts#L89), [web routes](../../frontend/src/router.tsx#L62), [organization scope middleware](../../backend/src/middleware/organization.ts#L14), [auth/session provider](../../frontend/src/providers/AuthProvider.tsx) establish public/authenticated surfaces and active-organization selection. |
| <a id="e02"></a>E02 | [Service-type routes](../../backend/src/routes/service-types.ts#L15), [setup service](../../backend/src/services/service-type-setup.ts#L67), [recurrence/needs migration](../../supabase/migrations/20260913000000_service_type_recurrence_and_position_needs.sql#L23), [next-plan creation](../../frontend/src/pages/PlanDetailPage.tsx#L108). |
| <a id="e03"></a>E03 | [Plan routes](../../backend/src/routes/plans.ts#L69) create/edit/duplicate/items/needs; [copyPlanContents](../../backend/src/services/plans.ts#L142) copies items and optional assignments, not staffing needs; [plan summary/detail](../../backend/src/services/plans.ts#L83) supplies counts and programmed durations. |
| <a id="e04"></a>E04 | [Plan workspace](../../frontend/src/pages/PlanDetailPage.tsx#L62), [Order UI](../../frontend/src/components/plan/OrderTab.tsx#L75), [ImportTemplateModal](../../frontend/src/components/plan/ImportTemplateModal.tsx#L35), [RehearseTab](../../frontend/src/components/plan/RehearseTab.tsx#L33): single-plan actions, append-copy loop, chart-only rehearsal, raw chart versus displayed effective key. |
| <a id="e05"></a>E05 | [Assignment creation/window](../../backend/src/routes/assignments.ts#L47), [manual notify](../../backend/src/routes/assignments.ts#L165), [response](../../backend/src/routes/assignments.ts#L357), [schedule modal](../../frontend/src/components/plan/SchedulePeopleModal.tsx#L32): service-only time envelope, same-plan exclusion, notify=true, no-login filtering. |
| <a id="e06"></a>E06 | [People routes](../../backend/src/routes/people.ts#L66), [Person model](../../backend/src/model/people.ts), [team routes/members](../../backend/src/routes/teams.ts#L171), [identity types](../../packages/shared/src/types/database.ts#L88). Person/Profile separation exists; assignments/team memberships still use Profile identity. |
| <a id="e07"></a>E07 | [Public response route](../../backend/src/routes/assignment-respond.ts#L43), [notification grouping/bookkeeping](../../backend/src/routes/assignments.ts#L217), [ICS generator](../../backend/src/lib/ics.ts), [token/feed migration](../../supabase/migrations/20260906000000_assignment_notifications.sql) establish built notification functionality and outstanding-link semantics. |
| <a id="e08"></a>E08 | [Transport interface/aggregate result](../../backend/src/services/notifications.ts#L17), [Resend adapter](../../backend/src/services/email/resend-transport.ts#L14), [startup wiring](../../backend/src/index.ts#L6), [config flags](../../backend/src/config.ts#L25), [notification feed/push](../../backend/src/services/notification-center.ts#L22), [serverless entry](../../backend/api/index.js), [deployment config](../../backend/vercel.json). Provider acceptance/log simulation is not delivery confirmation. |
| <a id="e09"></a>E09 | [Blockouts](../../backend/src/routes/blockouts.ts#L20), [calendar](../../backend/src/routes/calendar.ts#L29), [personal feed](../../backend/src/routes/calendar-feed.ts#L34), [feed management](../../backend/src/routes/me.ts#L53). Times are selected by plan, not assignment-specific attendance. |
| <a id="e10"></a>E10 | [Song API](../../backend/src/routes/songs.ts#L33), [chart/history service](../../backend/src/services/songs.ts#L149), [song schedule UI](../../frontend/src/components/song/SongSchedulePanel.tsx#L22), [metadata schema](../../packages/shared/src/schemas/song.ts). |
| <a id="e11"></a>E11 | [Arrangement chart UI/export](../../frontend/src/components/song/ArrangementPanel.tsx#L45), [chart editor](../../frontend/src/pages/ChartEditorPage.tsx), [ChordPro renderer](../../packages/shared/src/lib/chordpro.ts), [PDF export](../../frontend/src/lib/chart-export/pdf.ts), [service songbook](../../packages/shared/src/lib/service-song-book.ts). |
| <a id="e12"></a>E12 | [Songbook API](../../backend/src/routes/songbooks.ts#L31), [document upload UI](../../frontend/src/pages/SongbooksPage.tsx#L24), [mobile upload](../../mobile/app/(tabs)/songbooks.tsx), [songbook page/print](../../frontend/src/pages/SongbookPage.tsx#L6). Document attachment is distinct from song parsing. |
| <a id="e13"></a>E13 | [Removed OCR/quota migration and current attachment bucket policies](../../supabase/migrations/20260913000200_drop_chord_sheet_imports.sql#L19). Later migration supersedes original chord-sheet feature/policies. |
| <a id="e14"></a>E14 | [Role gates](../../backend/src/middleware/organization.ts#L70), [RLS](../../supabase/migrations/20260101000100_rls.sql#L118), [conflict function](../../supabase/migrations/20260101000100_rls.sql#L225): org-wide plan reads/writes by coarse role; service-time-only conflict join. |
| <a id="e15"></a>E15 | [Core schema](../../supabase/migrations/20260101000000_init.sql#L63), [current DB types](../../packages/shared/src/types/database.ts), [plan input schemas](../../packages/shared/src/schemas/plan.ts), [shared domain](../../packages/shared/src/types/domain.ts): absence/presence of identity, time-scope, attendance, run, file and workflow records. Ordered later migrations were also reviewed. |
| <a id="e16"></a>E16 | Cross-surface inventory: [mounted API](../../backend/src/app.ts), [shared client methods](../../packages/shared/src/lib/api-client.ts#L154), [web router](../../frontend/src/router.tsx), [query hooks](../../frontend/src/hooks/queries.ts), [current DB types](../../packages/shared/src/types/database.ts), backend services and all current migration filenames. No application job scheduler, Matrix, signup/replacement, chat, Live, attendance, reporting or external connector workflow found. |
| <a id="e17"></a>E17 | [Mobile plan read/respond](../../mobile/app/plan/[id].tsx#L43), [navigation/auth gate](../../mobile/app/_layout.tsx#L39), [notification provider](../../mobile/src/providers/NotificationsProvider.tsx#L33), [song viewer](../../mobile/app/song/[id].tsx), [calendar](../../mobile/app/(tabs)/calendar.tsx), [schedule](../../mobile/app/(tabs)/index.tsx). |
| <a id="e18"></a>E18 | [Needed-position service](../../backend/src/services/plans.ts#L234), [team/position view model](../../frontend/src/components/plan/types.ts#L50), [Teams tab](../../frontend/src/components/plan/TeamsTab.tsx): per-plan needs and local staffing UI already exist. |

Repository guidance applied: `CONTEXT.md` terminology, `CLAUDE.md` architecture/engineering rules, [research skill](../../.agents/skills/research/SKILL.md), and [Supabase skill](../../.agents/skills/supabase-postgres-best-practices/SKILL.md) for proposed persistence/RLS responsibilities. No source code, migration, canonical glossary, or prior ADR was changed by this planning package.
