# Service Center Mobile: product, implementation, and UI specification

Date: **2026-10-15** · Status: proposed implementation scope; shared UI foundation implemented in the working tree

Companions: [mobile task backlog/comparison](../plans/mobile-feature-tasks.md), [official mobile feature reference](../research/planning-center-services-mobile-reference.md), [shared Services feature specification](services-feature-specification.md). MOB IDs identify implementation tasks; F IDs identify prerequisites already defined in the shared specification. This document does not approve all optional platform integrations or claim missing backend APIs already exist.

## 1. Product direction

Mobile must let a volunteer respond, manage availability, prepare materials, communicate and follow a service without returning to a desktop. Authorized leaders must also edit plans, staff positions, communicate and record attendance. Use the website's language and product identity with native navigation, controls and touch layouts.

The user's request removes the separate minimalism/editorial direction. Do not reapply that skill's warm monochrome restrictions, serif hierarchy, monochrome primary buttons, decorative ruled headers, forced macro-whitespace or mandatory stagger animations. The shared Service Center product system below replaces that visual direction. Do not remove installed repository skills or change global agent instructions; this is a product UI change.

## 2. Navigation and shared interaction rules

Current native tabs remain functional while adding role-aware destinations. Recommended target: **My Schedule**, **Plans**, **Songs**, **More**; More contains Calendar, Songbooks, People/Teams when permitted, Notifications, Settings and Help. Retain current tabs until More/Plans ship together, so existing songbooks/calendar/settings do not disappear. The current UI change only standardizes visible labels; it does not pretend the Plans/More routes exist.

- A plan workspace uses **Order / Teams / Rehearse**, matching web. Times, Notes, Files and later Live are accessible from labeled plan actions. Use native stack/sheet editors, safe areas and keyboard avoidance; do not shrink the desktop multi-column interface onto a phone.
- Schedule responses use the existing canonical status labels and Person/Assignment/Invitation vocabulary. A request is never presented as an organization Invitation.
- Client role checks expose appropriate controls; server authorization/RLS remains decisive. Granting an adult permission to answer a household request does not grant plan/file viewing automatically.
- Queries include organization and resource identity. Switch/sign-out cancels/clears private cache and pending navigation intents. A push or URL resolves an organization only after membership is checked; expired/missing/revoked targets have useful error states.
- Every edit has loading/saving/saved/error/dirty states. Preserve local drafts through retry; confirm before discarding unsaved work. Disable duplicate submissions, use durable idempotency for new multi-row operations, and require an expected revision for stale-sensitive writes.
- Offline reading uses an explicitly downloaded authorized pack. Responses, staffing, chat, attendance and administration initially require a connection. Do not show queued local mutations as committed server state. Offer an explicit retry with current validation.
- Date editors show organization timezone and retain calendar-day versus instant intent. The existing date-text/device-timezone blockout behavior is not the target. Handle DST gaps/ambiguities explicitly. Conflict checks and rendered attendance use the shared F04 resolver.

## 3. Shared visual system — MOB-001

### Single source and adapters

`packages/shared/src/lib/design-tokens.ts` exports `serviceCenterDesignTokens` and named palette/accent/scheme types. The website's `applyDesignTokens()` installs those colors/radii as CSS variables before React renders; web component CSS consumes them. Native `theme.ts` consumes the same object and adds platform typography/layout. New components use those roles rather than selecting a second independent palette. Native launch/splash/notification colors mirror the same brand/canvas values in Expo build configuration; changes require checking those build-time settings too.

| Role | Light | Dark / behavior |
|---|---|---|
| Canvas | Slate 50 `#f8fafc` | Slate 950 `#020617` |
| Surface | White `#ffffff` | Slate 900 `#0f172a` |
| Borders | Slate 200; stronger Slate 300 | Slate 800; stronger Slate 700 |
| Main/supporting text | Slate 900 / Slate 600 | Slate 100 / Slate 300 |
| Primary action | Indigo 600 `#4f46e5`, white label | Same brand fill; lighter indigo for text links/selected navigation |
| Confirmed / declined / unconfirmed | Emerald / rose / amber semantic pairs | High-contrast dark surface pairs from the same shared tokens |
| Corners | Control 8; input 12; card 16 | Same geometry; circular avatar and compact badge exceptions |
| Typography | System sans, semibold page/card headings, regular body | Native Dynamic Type/platform scaling; mono only where chord alignment needs it |

Native page headings approximately 26/32, card titles 20/28, body 15/22, metadata 13/18, labels/badges 12–13. The website keeps its established 24px page-heading and 14px control hierarchy; consistency means common roles/weight/identity, not identical physical pixels. Use compact 16px native card/screen insets with 8/12/16/24 spacing steps, subtle card elevation and immediate press feedback. Standard controls have at least 44-point native targets; text must wrap/scale without clipping. Status is also conveyed by text/icon, not color alone. Font loading must not block startup for unused decorative fonts.

### Acceptance and visual QA

Compare sign-in, schedule cards, a plan, calendar, song chart, songbook, notifications and settings on web and native in both schemes. Include a small phone, a large phone/tablet, large system text, long plan/person names, multiline error and empty/loading states. Verify key chart monospacing, selected navigation, destructive buttons, keyboard focus/touch feedback and screen-reader labels. Remove surprise entrance delays; respect reduced-motion preferences for future motion. The current implementation's build/export success is not a substitute for device screenshot review. Save approved reference screenshots during device QA without private roster/contact data.

## 4. Correctness and volunteer scheduling

### MOB-002 — Chart context and arrangement selection

**Story:** As a musician, I want a plan link to open the actual selected arrangement/key, so I rehearse the same version shown on the website.

Pass plan/item context into the song route; load the authorized plan and resolve that item rather than trusting arbitrary query parameters. Initialize arrangement, key and item-specific sequence from that record. Direct library navigation starts at its default arrangement but offers an arrangement picker. Temporary transposition/notation affects the viewing session only. Do not change the library or another plan. Reset local view state when the context changes; indicate missing/deleted arrangement/chart explicitly. **Acceptance:** a non-default arrangement with a plan key override renders matching chords/labels on native/web/export; a forged/inaccessible item reference reveals nothing.

### MOB-003 — Safe cache, links and session transitions

**Story:** As a person in several organizations, I want every screen and notification to respect the selected organization and session.

Namespace songbook detail and all new queries by organization; clear/cancel private query caches and downloaded manifests on sign-out/account change according to retention policy. Revoke/unregister device association while authentication is still valid; handle failure explicitly without leaving old-user delivery as an assumed harmless condition. Add native `/respond` and matching universal/app link configuration; validate token/scope using the existing public response API. Retain a web fallback. Accept-invite stays distinct. Exact push intents include target type/id/organization but no secret link tokens or private message body on lock screens unless opted in. **Acceptance:** organization A content never flashes under B; old push/response links produce safe expired/no-access states; consumed responses are not replayed.

### MOB-004, MOB-005 — Complete schedule and response behavior

**Story:** As a volunteer, I want all my positions/times in one plan card and clear grouped or individual answers.

Group entries by Person/plan; show all positions, applicable service/rehearsal times, pending/confirmed/declined state, notes and response owner contact when allowed. Add status filtering, reason entry, deliberate withdrawal from confirmed positions, split scope controls and reviewable bulk pending responses. Do not rely on `.find()` for a multi-assignment person's plan state. An existing per-assignment endpoint can support an initial individual action; all-or-nothing grouped answers need a shared atomic response service/version contract. Show partial outcomes if the initial version deliberately uses independent operations. Reaccepting a declined position requires reassignment unless an explicitly adopted policy says otherwise.

Prepared/released state, per-time responses and stable request versions depend on F01/F02/F04/F08. Prepared requests must be excluded by the backend from member queries/counts/calendar/feed/push, not simply hidden in native UI. **Acceptance:** previewed scope equals committed scope, unrelated positions do not change, a stale bulk action cannot answer newly added assignments, and the response owner gets a consistent update.

### MOB-006, MOB-007 — Availability and preferences

**Story:** As a volunteer, I want date/time availability and team preferences that leaders can trust.

Replace raw date-text entry with native date/time inputs, all-day toggle, timezone display and validation. Add one-off edit/delete, recurrence creation/preview/end condition, affected assignments, and clear error/saving states. Existing create/delete APIs are reused; update/series contracts come from F03. Initial native parity creates recurring series but sends existing-series editing/deleting to an authorized web route because that is the documented reference limit. Offering native series maintenance later is a Service Center extension. Never auto-decline existing requests merely because a blockout overlaps.

Per-team forms capture frequency/monthly maximum/preferred weeks and selected service times; show global blockouts separately. General/household preferences can begin with web handoff. Changes are self/delegate scoped; backend validates ranges and meaningful recurrence. **Acceptance:** local dates stay correct across DST/device-zone changes, saving a series does not materialize infinite rows, no-login identity follows F02, and private reasons are not exposed through generic conflicts.

### MOB-008, MOB-009, MOB-010, MOB-011 — Staffing, opportunities, replacements and households

**Leader story:** As a team leader, I want to fill a required position with an informed candidate selection.

The Teams tab shows needed/confirmed/pending/declined counts per position and accurate open capacity. Plus/minus edits use the existing needs contract. Candidate picker searches roster/team/position, shows recent serving/conflicts, supports an existing-person guest, and lets the leader preview applicable times/request release. Recheck conflicts at commit; require an explicit permitted override/reason. Existing Profile-only scheduling remains until F02 migration; do not claim no-login scheduling before it is available. Temporary position creation and native new-person onboarding are extensions, not required initial mobile parity.

**Volunteer story:** As an eligible member, I want to claim an opening or request a replacement without an ambiguous commitment.

Signups require F07 capacity/reservation/deadline/approval contracts. Replacement flow retains the original decline/history and creates a new recipient's assignment. Planning Center documents a coordinated replacement that can be automatically confirmed; Service Center's default proposal remains leader-approved offers/new responses from the overall spec. If adopting an auto-confirm policy, require explicit team configuration and the volunteer's acknowledgement of prior coordination; do not silently substitute that policy.

Household picker acts only under explicit F03 delegation, independently checking response, plan-view, availability and signup rights. Another adult's grant is required. **Acceptance:** competing final-slot claims/replacement acceptances cannot overfill; revoked delegates cannot act; direct requests to another team/person are denied; no offline action is falsely shown as committed.

## 5. Mobile planning and leader workflows

### MOB-012, MOB-013, MOB-014, MOB-015, MOB-016 — Plans, order, times, notes and templates

**Story:** As an authorized planner, I want to prepare and update a service from my phone.

Plans browser groups by service type, uses bounded pagination, supports previous/next including history, and displays draft/published status under shared visibility rules. Add native form/sheet creation for a single dated plan first; multiple dates/template apply use F10 preview/commit contracts when available. Reference mobile copying is web-only; an existing Service Center duplicate endpoint may be offered later as an explicit extension.

Order tab exposes add/edit/remove/reorder using current item endpoints, with headers/items/songs and later existing media. Include duration, arrangement/key, description, plan-only sequence, leader by person/position, note categories, before/during/after and service applicability when their shared fields exist. Provide move-up/down actions as alternatives to dragging. Reject incompatible song/arrangement pairs and stale plan revisions. The shared backend must add revision/atomic copy semantics where absent; native cannot implement them through optimistic UI alone.

Time editor supports service/rehearsal/other type, name, date, start/end, and displays organization timezone. Current plan PATCH accepts a complete time set and updates by list position: before reorder/delete propagation is exposed, add stable per-time IDs and optimistic revision checks to the shared contract. Preview affected assignments/feeds/reminders; F04/F08 add selected attendance and policy propagation. Save ordinary simple notes using existing plan notes; add team/category notes only through F09's audience model. **Acceptance:** edits preserve identity and draft state on failure, unsupported fields are not faked, copying never reuses confirmations/actual timing, and web/native reloads show identical persisted results.

### MOB-017 — Attendance

**Story:** As a team leader, I want to record who was present at a specific plan time.

Use F16 records for present/absent/unknown, actor/time and corrections. Screen selects plan time and permitted team, loads scheduled people and permits individual/reviewed batch marking. A confirmed assignment remains a scheduling answer, not attendance. **Acceptance:** counts deduplicate person/occurrence, corrections are audited, another team's unauthorized update fails, and a network failure does not display a saved attendance state.

### MOB-018, MOB-019, MOB-020 — Messages, chat and push

**Story:** As a leader or volunteer, I want a clear conversation and notification destination for each operational update.

Targeted email chooses permitted teams/scheduled/pending/signup audiences, resolves an actual recipient preview, uses shared templates/escaping and records per-recipient outcomes. Native group texting opens the device composer with a reviewed audience/plan link; the app cannot assert the message was sent after handoff/cancel. Phone/contact fields obey directory permissions. Do not use carrier gateways as a substitute for durable notification delivery.

Conversations reuse shared F09 membership/audience rules, pagination, stable message IDs, unread/mute/mention/reply/report and retry status. Add attachments via F13. DMs, read receipts, GIFs, youth communication, edits/deletes and moderation require explicit policy; the official age-boundary wording is inconsistent, so do not infer a safety-critical policy from that ambiguity. Group/team limits must be configured and tested.

Push preferences include event types/channel selection, optional badge counts, conversation mute and OS settings recovery. Exact taps resolve authorized targets in the correct organization; removed plans/conversations become unavailable without leaking content. Live push only while opted into the active run. **Acceptance:** duplicate send retries preserve message identity; revoked membership blocks read/post; OS denial still leaves in-app feed functional; sign-out severs the old device association.

### MOB-021, MOB-022 — Settings, calendar and report share

**Story:** As a volunteer, I want predictable appearance, help and calendar access on my device.

Add persisted light/dark/system appearance with an explicit reset-to-system action; initial UI implementation shares colors but does not yet add this preference persistence/system selector. Keep organization/account actions clearly separated. Show app version, help/about and permission/settings links, and explicit per-account cache cleanup when caching ships.

Calendar retains native agenda, adds team/service/rehearsal filters using current API, and explains the active organization/timezone. Subscription uses current token feed APIs with platform-specific subscribe/copy controls, one-time raw-token presentation and rotation explanation. Reference calendar includes confirmed plans; Service Center already deliberately includes confirmed and unconfirmed commitments in its feed—preserve the ADR/product decision unless separately changed. Plan report opens/shares a permitted generated report through F16; do not imply a native custom report designer. **Acceptance:** selected filters survive navigation appropriately, URLs/tokens never enter logs, external apps control poll refresh, and reports exclude private/prepared fields.

## 6. Rehearsal, songs, files, Live and platform extensions

### MOB-023 — Native Live

**Story:** As a director or team member, I want a synchronized current/next item view for the actual service occurrence.

Consume F12 authoritative state/run snapshot/revision/controller lease. Support viewer, authorized advance/pause/jump/end and explicit takeover, reconnect and stale command handling. Countdown is derived locally from server timestamps; never write every display tick. Show notes only when permitted, optional run chat through F09, and current/last-synced connection state. **Acceptance:** two viewers agree after reconnect, only one valid controller action wins, a second service instance keeps its own actual history, and background push stops when the run is left.

### MOB-024, MOB-025, MOB-026, MOB-027 — Player, cache and advanced playback

**Story:** As a musician, I want the plan's authorized audio and charts together, with reliable playback and explicit offline preparation.

F13/F14 supply an ordered manifest: plan/item/arrangement/effective key/sequence, permitted file versions, stream/download rights and expiry. Implement a native audio adapter with current-track state, seek/repeat/previous/next, mini-player and appropriate lock-screen/background audio session. Video uses a clear foreground player; unsupported provider links remain external links. Active organization/track visibility and skipped-track preferences must be explicit.

Downloads are opt-in; record owner/account, manifest/file version, byte size, content integrity and expiry. Use temporary files then atomic finalize; interrupted downloads are resumable/retryable or restart clearly. Show ready/downloading/failed/stale/expired states and selected/all cache removal. Proposed Service Center expiry: 30 days after the plan date for rehearsal audio, configurable only through an explicit policy. It is cached audio, not an export license, and offline revocation cannot erase already-downloaded bytes immediately. Do not implement an offline write queue as an unstated dependency.

Loops/metronome, audio transforms and CarPlay/Android Auto/Siri are independently gated after basic playback. Verify supported native modules, runtime/build requirements, provider rights and current platform entitlements before estimates; do not assume Expo Go validates them. **Acceptance:** no unauthorized file gets cached, users/accounts never share private packs, playback state survives supported interruptions, audio pauses/resumes according to documented platform policy, and optional features have physical-device tests.

### MOB-026, MOB-030 — Attachments, media and iOS scan

**Story:** As a planner, I want to attach/read the right materials from my device without losing access rules.

Use F13 upload-intent/finalize/download/version contracts for plan/item/song/arrangement/key and permitted media files. Pick device files/photos/links, show progress/retry, validate parent/type/size and authorize both API and Storage. Preview PDF/image/audio/link appropriately; OS sharing is a deliberate user action with a minimum authorized payload. Short-lived URL expiry renews under current rights. Reading an existing media record is distinct from authoring one; the official mobile product does not support media-record create/edit.

iOS multipage PDF scanning is optional; Android scanning needs a separate product/platform decision. Text recognition/OCR is **not included by implication**: this repository deliberately removed its prior OCR pipeline. Any reintroduction requires a new scoped decision, supported local/provider processing and user-reviewed extracted text. **Acceptance:** permission denial and file-size failure are recoverable, incomplete upload is not marked ready, restricted raw Storage/download access fails, and a canceled share does not create a delivery record.

### MOB-028, MOB-029 — Song and chart authoring

**Story:** As a worship planner, I want to find/edit a song and arrangement on mobile and prepare the same chart I see on web.

Paginate the library rather than stopping at 100; use supported title/theme/sort filters first, with author/key/BPM/history filters only when F15 supports them. Expose song/arrangement CRUD, tags/tempo/meter/capo/default/sequence and archive restore as their shared APIs permit. Separate arrangements from labeled keys; the current one-key-per-arrangement model needs shared F15 before multiple key records appear.

Native chart editor provides text input, section/sequence controls, dirty-state save, formatting and a shared-renderer preview. Keep UI fonts separate from chart formatting fonts. PDF generation/share uses the canonical document representation and preserves chord alignment, key, notation, copyright and sequence. Custom/provider imports require F17 integration/rights. **Acceptance:** native-generated preview/PDF matches the same chart input on web, plan-only overrides do not overwrite library defaults, unsupported key transformations are explicit, and failed save never silently discards the draft.

### MOB-031, MOB-032, MOB-033 — Directory, multiple organizations and widgets

**Story:** As a leader, I want permitted contact/team details; as a volunteer, I want my own schedules and shortcuts without leaking another account's information.

People browser/contact/detail uses current roster/person/team APIs, with F01 field/capability rules and F02 tags/archive/no-login model extensions. Own profile photo/contact edits require permission-aware image picking/upload; team/position/tag mutations remain scoped. Native new-person onboarding is optional/unverified reference parity; do not fabricate a working create-person flow until explicitly implemented.

Combined schedules are an opted-in F03 service: aggregate only the current person's accessible memberships, and reauthorize every underlying action; redact cross-organization commitment detail to other schedulers. Widgets require a native extension feasibility spike, minimal persisted snapshot, prepared exclusion, logged-out clearing, and verified destination intents. Widget data must not depend on keeping the JS app alive. **Acceptance:** unauthorized directory fields/search snippets are absent, revocation stops future reads, an old user's widget/cache cannot open a new user's data, and OS-specific actions are tested on supported devices.

## 7. Shared backend contracts and delivery gates

Reuse typed `ServiceCenterApi`, Zod schemas and domain objects in `packages/shared`. Do not write parallel native Supabase business mutations that bypass shared assignment/notification/conflict logic. Person-first identity (F02), scoped permissions/prepared visibility (F01), recurrence/preferences/delegation (F03), assignment attendance (F04), opportunities/replacements (F07), durable release/reminders/delivery (F00/F08), conversations (F09), saved templates (F10), Live (F12), files/manifest (F13/F14) and attendance/reports (F16) are prerequisite backend work, not native view components. Detailed persistence/RLS requirements remain in the shared spec and require the repository's Supabase guidance before migration design.

Existing APIs may need small contract improvements: typed plan/item inputs rather than broad records, paginated People/Teams where scale requires it, stable per-time IDs, expected revisions, atomic grouped responses, capability metadata and structured per-recipient outcomes. Add these as explicit shared tasks in each PR; never rely on a UI-only checkbox for privacy or a sequence of HTTP calls for atomicity.

Implementation gates:

1. Reconcile task scope and official native/web-only/optional boundary; record selected F prerequisites. Existing-API client slices can ship independently without fake placeholders for future features.
2. Test a user-visible success, denied action and meaningful failure for each workflow. Concurrency tests are necessary for response versions, signup capacity, replacement acceptance, schedule conflicts, background jobs and Live. RLS/Storage tests accompany access changes.
3. Typecheck shared/backend/web/mobile; build shared/API/web; export native iOS and Android bundles for changed routes/dependencies. Run existing relevant suites. These do not establish real push/background audio/link/widget behavior.
4. Device QA covers iOS/Android, phone/tablet, both schemes, large text/screen reader, keyboard forms, online/offline, foreground/background, permission denial, sign-out/org switch, expired link/download and interrupted save. Do not claim native screenshot or OS behavior validation from a website screenshot.
5. For MOB-001 approve a visual reference matrix; for audio/push/widgets use physical-device smoke tests; for link changes verify domain-association files and configured native build identity. Stage optional providers/platform features behind explicit flags.
6. Release per organization, observe delivery failures, response errors, cross-context cache incidents, upload/playback failures, job lateness and Live reconnects with private content/tokens excluded from logs. Define rollback/disable paths without deleting historical assignments/materials.

Current scope delivered: documentation/research/task/spec package and the shared visual foundation. Feature task statuses remain planned until their behavior and acceptance gates are implemented and verified.
