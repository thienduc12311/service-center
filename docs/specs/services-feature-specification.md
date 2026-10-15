# Service Center: missing Services capabilities — product and technical specification

Date: 2026-10-15 · Status: proposed, ready for backlog refinement · Baseline: `7f682d34a3643b635192bc20f53820885805d819`

Read with the [feature assessment and delivery plan](../plans/services-feature-gap-plan.md), [user stories](services-user-stories.md), and [official feature research](../research/planning-center-services-feature-reference.md). F00–F17 are stable epic IDs shared by all three documents.

## 1. Purpose and boundaries

Complete the weekly service workflow: organize a ministry, plan several upcoming services, staff each required position, collect responses, distribute preparation materials, run the service, and learn from its results.

Planning Center Services supplies the reference capabilities; the behavior below is a **proposed Service Center design**, not a claim about Planning Center's internal implementation. Existing functionality must be extended rather than rebuilt. Product names and UI text need not copy the reference product. Priorities are recommendations inferred from dependency and weekly operational value; there is no user-approved delivery date or team capacity yet.

Keep the vocabulary in `CONTEXT.md`: a Person can exist without a Profile; an Invitation joins the organization; an Assignment requests service participation. Use **position** for team work and **permission** for authorization. A service type is a recurring category, not a saved plan template. Proposed new concepts below do not amend the canonical glossary until implementation decisions are accepted.

### Delivery surfaces

- Web: full administrator and scheduler workflows, bulk planning, reporting, Live control.
- Mobile: first-class volunteer responses, availability, signups, replacements, messages, files, rehearsal, and Live viewing. Add simple plan/assignment editing for authorized leaders; keep Matrix, bulk imports, and report configuration on web initially.
- API: all supported actions use named shared input/output types and Zod schemas in `packages/shared`; web and mobile use `ServiceCenterApi`.
- External clients: existing personal `.ics` feeds remain supported. A public developer API is a separate F17 milestone, not implied by the internal REST API.

## 2. Shared invariants and contracts

1. Every resource belongs to one organization, directly or through a validated parent. Related people, teams, positions, times, files, songs, and arrangements must belong to compatible parents. Enforce these relationships in persistence, not only in UI filters.
2. Organization role remains the coarse ceiling. New scoped grants refine access without letting a team leader administer the entire organization. RLS and Storage policies enforce the same permissions as the API. Test direct database access as well as REST access.
3. Add an explicit assignment visibility state, conceptually `prepared` or `released`, **separate from** answer state (`unconfirmed`, `confirmed`, `declined`) and delivery state. A prepared request is visible to authorized schedulers only, including through calendar, feed, notifications, reports, and file access. Existing draft plans currently have no private visibility guarantee; migration must explicitly preserve or intentionally change access.
4. Publishing a plan, releasing assignments, and sending notifications are separate operations. Support a deliberate combined release-and-notify action. Existing released assignments remain visible if delivery fails. Existing plan publication must not silently acquire new email behavior.
5. Required staffing counts positions, not email messages or service-time rows. Display confirmed, pending, declined, and still unfilled separately. A person with multiple assignments remains one notification recipient per plan where appropriate.
6. All proposed multi-row operations that must succeed together use a short database transaction/RPC. Enqueue durable side effects in that transaction; contact email/push/media providers after commit. Browser loops and `Promise.all` over independent writes do not provide atomicity.
7. Mutations that could overwrite another scheduler's work take an expected revision and return `409` on stale input. Creation/release/import/job processing accepts or generates a durable idempotency key. Error responses identify affected rows without disclosing unauthorized resources.
8. Store instants in UTC and recurring wall-clock intent with the organization's IANA timezone. Show that timezone in editors. Reject or explicitly resolve ambiguous/nonexistent daylight-saving times. Half-open intervals `[start, end)` allow adjacent commitments without overlap.
9. A new blockout warns about existing commitments; it does not silently decline them. Re-date, delete, archive, unpublish, or time-scope changes must explicitly cancel/recompute affected jobs and update applicable feeds.
10. Use the existing tokenized response and calendar patterns. Tokens remain hashed, expiring/revocable as applicable, rate-limited, and scoped to minimum disclosure. A response must address the request/version shown to the recipient, rather than silently answering newly added assignments.

### API conventions for new operations

Routes below are candidate contracts relative to `/api/v1`. Final naming can follow existing route conventions. List endpoints use bounded date ranges, pagination, and deterministic ordering. Bulk previews return `operation_id`, `base_revision`, proposed changes, conflicts, and warnings; commits send that revision and an idempotency key. Scheduled work returns `queued`, `provider_accepted`, `delivered` where known, `failed`, or `simulated`; an attempted send is never represented as confirmed delivery. Raw tokens are returned only at creation.

## 3. Feature specifications

### F00 — Delivery and workflow readiness (foundation)

**Problem:** existing email, push, copying, and respond flows provide a base, but are insufficient foundations for unattended automation. This is a source-code finding, not a new reference-product feature.

**Requirements:** expose transport mode to administrators; distinguish simulation from provider acceptance; record per-recipient attempts/errors; retry safe failures; ensure public-link and signed-in responses produce consistent scheduler updates. Consolidate assignment side effects behind a service before adding additional writers. Atomic copy/apply operations must include selected staffing needs, times, and notes and must not leave partial plans on failure. Preserve the established person-plan response grouping until F02/F04 explicitly migrate it.

**Contracts/areas:** extend `services/notifications.ts`, `notification-center.ts`, `routes/assignments.ts`, `assignment-respond.ts`, `services/plans.ts`; introduce durable delivery records/outbox and a bounded worker entry point. Keep Resend/Expo adapters. Deployment must support both the documented container and serverless environments; an in-process timer is not a durable scheduler. Do not install or choose an external provider in this documentation task.

**Release gate:** simulated delivery is labeled, individual failures remain retryable, duplicate job execution is harmless, public and authenticated declines notify the correct scheduler once, and a failed copy rolls back.

### F01 — Scoped leadership, hierarchy, and visibility

**Outcome:** a ministry leader can manage their own teams and plans without organization-wide editing rights.

**MVP:** grant capabilities at service-type and team scope; view a person's effective access; protect sensitive person details; enforce prepared-request visibility. Introduce an explicit response owner for an assignment, defaulting to its scheduler, so delegated leaders receive replies. Existing owner/admin access remains; existing scheduler behavior is preserved during rollout unless an administrator opts into scope restrictions.

Separate operational capabilities for people/directory data, plans/scheduling, songs, and media. An organization-wide library capability is explicit rather than inferred from leading one team. Scope selection may restrict an existing scheduler; a grant never gives an ordinary team leader authority to issue administrator grants.

**Extension:** nested organizational folders, ordering/default landing folder, folder-level grants, archived/copied service types, directory privacy, and bulk permission changes. Folder placement must not become a hidden second tenant boundary. Detect cycles on moves and re-evaluate inherited access. Reuse one team across selected service types through explicit associations; copying a service type must not accidentally copy people or grants. Team settings cover leaders, default request visibility/response owner, and relevant file access. Add tag-derived membership, related-team visibility, and optional secure-team eligibility only after their policies have been defined; a secure team requires an explicit current eligibility record/provider result and fails closed when that result is missing or expired. Do not build an entire background-check product.

**Contracts:** `GET/PUT /service-types/:id/access`, `GET/PUT /teams/:id/access`, later `/folders`; effective capability information accompanies session/context responses. Centralize authorization used by routes, queries, RLS, Storage, and background workers.

**Exit:** a leader with access only to Band cannot edit Hosts, even by calling REST or Supabase directly; a member cannot enumerate prepared requests or restricted files. Permission revocation takes effect on subsequent server access and signed-link renewal.

### F02 — Schedule a Person before login

**Outcome:** roster participation does not require account onboarding to be complete.

**MVP:** every assignment and team membership can identify an organization Person. A linked Profile provides authentication but does not define roster identity. Create a guest Person from the scheduler; schedule once without permanently adding them to a team. Missing email is visible as an actionable delivery warning. An administrator may notify a no-login Person through the existing tokenized web response flow. Creating an organization Invitation remains optional and separate.

**Migration:** backfill a Person for each existing organization-member/profile combination that needs one; reuse existing linked rows; report ambiguous duplicates. Preserve assignment IDs, answers, `created_by`, historical timestamps, calendar/feed identity, and pending response links. Add canonical person references, dual-read/write during transition, then remove assumptions about non-null `user_id` only in a later reviewed migration. Do not create placeholder auth accounts. Link account acceptance to the same Person; never merge solely on a matching email.

**Contracts:** assignment inputs evolve to `person_id` with a compatibility path for existing clients. Provide a versioned request-preview/response contract and linked-account resolution. Include a plan-only temporary position with a label and team owner; it must not alter a team's normal positions.

**Exit:** a person scheduled without a login can respond on web and retains their assignment history after accepting an organization invitation. Inactive or foreign-organization people cannot be scheduled accidentally.

**Roster extension:** skill tags/tag groups, bulk team/tag changes with previews, archive/restore that preserves historical staffing, and an audit of recent changes. Existing member inactivity and Person deletion are not substitutes for a reversible roster archive. A permission-scoped global search can find people, teams/positions, plans, songs, and media; search results must not expose content inaccessible through its normal endpoint.

### F03 — Availability, preferences, and household assistance

**MVP:** edit one-off blockouts; create all-day or timed weekly/monthly recurring series with an end condition; edit/delete one occurrence, future occurrences, or the series. Capture serving frequency, preferred/avoided dates or weeks, and team-specific availability. A global blockout is distinct from a team preference. Request availability from a team before scheduling.

**Rules:** preview the next occurrences before saving; preserve local dates across daylight-saving changes; avoid unbounded materialization. Show existing assignments affected by a new blockout and offer an explicit decline action. Preferences are warnings by default; hard blockouts and permissions constrain automated selection. Show why a candidate is unsuitable without revealing a private reason to unauthorized people.

**Extension:** approved household delegates can manage linked household members' availability and responses; together/apart scheduling preferences. Household relationship does not grant access by itself. Cross-organization copying of availability requires explicit selection and authorization in each organization; do not expose another organization's plan names.

**Later mobile convenience:** an explicitly opted-in combined view of the current user's organizations, generic cross-organization conflict warnings, and upcoming-request/rehearsal widgets. Existing organization switching is preserved; it is not already an aggregate schedule. An actor's membership and delegate rights are checked separately in every organization.

**Contracts:** extend `/blockouts` with update and series operations; add `/people/:id/scheduling-preferences` and availability-request records/jobs. Existing one-off blockouts remain valid.

### F04 — Assignment-specific times and accurate conflicts

**Outcome:** schedule a person for 09:00 service and rehearsal without implying attendance at an 11:00 service.

**MVP:** select applicable service, rehearsal, and other times per assignment; support default all-times and split-time teams/positions. Save an explicit attendance mode (`all applicable times` versus `selected times`) so adding a time has defined behavior. Compare the union of actual intervals rather than the earliest-to-latest envelope. A same-plan assignment at a different position can still conflict; do not discard all same-plan collisions indiscriminately.

**Rules:** include rehearsals; distinguish blockout, overlapping commitment, and preference warning. Recheck at commit to catch races. Explicit overrides require an authorized scheduler, reason, and audit entry; automated proposals never silently override. Material changes identify affected people and invalidate stale previews. Feed/ICS/response preview contains only that person's applicable times. Preserve existing event UID behavior and review whether per-person selected-time changes require a recipient-specific sequence. Include services without explicit times through a documented fallback with a visible warning.

**Contracts:** `/plans/:id/assignment-times`, expanded `/scheduling/conflicts` accepting assignment/candidate scope and excluded assignment IDs; conflict results include kind, intervals, severity, permitted override, and redacted explanation. Extend calendar and notification generation through one attendance-resolution service.

**Exit:** 09:00–10:00 and 11:00–12:00 do not conflict with a 10:15–10:45 assignment; an overlapping Friday rehearsal does conflict. Adjacent intervals do not conflict. Newly introduced overlaps are revalidated under concurrent commits.

### F05 — Multi-plan Scheduling and order Matrix

**MVP Scheduling:** show people/positions against a bounded set of plans, with needs, prepared/released status, answers, availability, recent service history, and conflicts. Assign, remove, copy, and release requests across selected cells. Save named personal filters. Keyboard access must cover every drag action.

**Order Matrix extension:** compare multiple plans' item orders, songs, keys, durations, and notes; copy a selected item or section across plans. This is distinct from the staffing view. Do not replace the existing single-plan page.

**Contracts:** `GET /scheduling/matrix?from=&to=&service_type_id=`, `POST /scheduling/bulk/preview`, `POST /scheduling/bulk/commit`; later `/plans/matrix`. Bound initial views to 12 plans and a paginated roster. Bulk commits are atomic within the declared operation; show explicit errors rather than silently skipping cells. Reuse F04 conflict rules and F10 copy/apply semantics.

### F06 — Rotations and explainable auto-scheduling

**MVP:** define reusable team rotations and propose staffing for selected plans using required position counts, eligible team positions, applicable times, availability, service frequency, previous assignments, and locked manual choices. A deterministic rules-based engine is sufficient; no model dependency is required.

**Workflow:** choose plans/teams → preview proposals, unmet needs, warnings, and reason per choice → adjust/lock → commit as prepared assignments → explicitly release through F08. Never overwrite confirmed/manual locked assignments or notify on preview. When impossible, leave a vacancy and explain the binding constraint. Recheck every candidate at commit. Preview expiry or stale revisions require recomputation.

**Contracts:** `/rotations`, `POST /scheduling/proposals`, `POST /scheduling/proposals/:id/commit`; persist input revision, rule version, seed/tie-breaker, and author. Minimum fairness: lower assigned count within a configurable lookback wins, then least recently served, then a stable tie-break. Display the actual policy. Household preferences are used only after F03 delegation exists.

### F07 — Signups and replacement workflow

**Signups:** a leader opens specific plan/position/time vacancies to eligible people, sets capacity/deadline, and chooses direct confirmation or approval. Members see only opportunities they may fill. A claim reserves capacity atomically and rechecks conflicts. Do not confuse team signup with account creation. Notify the leader and member of the result.

**Replacement:** a person can request help after declining or withdrawing; a leader sees open needs across plans, selects eligible replacements, or sends offers. Keep the original answer/history; a replacement gets a new assignment and must answer. Only one accepted replacement may fill a one-person vacancy. Expire superseded offers and clearly close the request. Support approved swaps as a later extension using two linked replacement operations, not a hidden reassignment of answers.

**Contracts:** `/plans/:id/opportunities`, `/opportunities/:id/claim`, `/replacement-requests`, `/replacement-requests/:id/offers`. Capacity counts confirmed plus active reservations; declined, expired, and superseded offers do not fill it. Any wider public sharing requires a separate explicit publication setting and limited disclosure.

### F08 — Scheduled reminders, request preparation, and delivery history

**MVP:** prepare requests without notifying or revealing them, preview a grouped release, schedule initial sends, configure response reminders and upcoming-service reminders by service type/team, and see per-person/channel delivery outcomes. Default proposed policy: one pending-response reminder 72 hours before the first applicable service time; one confirmed-service reminder 24 hours before the first applicable attendance time. Administrators may disable or edit both. These are Service Center defaults, not asserted reference-product defaults.

For a multi-plan release, consolidate the chosen plans into one message per person per release batch, with clearly labeled plan-specific response actions. Each action retains its exact request-version scope; batching does not turn one plan's answer into an answer to every plan in the message. Basic person-plan notification grouping continues for single-plan sends.

**Job rules:** durable jobs survive restarts/serverless invocations. Stable deduplication key includes recipient, plan/request version, policy, occurrence, and channel. Before sending, recheck active membership/person eligibility, visibility, response state, time/version, expiry, and preferences. Reschedule on material time changes; cancel on decline/removal/archive. Retry with backoff and a terminal failed state. Enforce quiet hours, grouped messages, and a frequency cap. Resends have a deliberate fresh request token and do not invalidate the only usable link until a replacement is durably issued.

**Contracts:** `/reminder-policies`, `/plans/:id/release/preview`, `/plans/:id/release`, `/deliveries`, `/deliveries/:id/retry`; a signed/authenticated bounded worker route or job runner is required. Keep transport-specific credentials server-side. SMS and external push channels are separate optional integrations after account/provider availability is checked.

**Exit:** two workers cannot create duplicate jobs; a volunteer who responds between enqueue and execution receives no obsolete response reminder. External delivery is at-least-once unless the provider supports deduplication; expose ambiguous timeout outcomes instead of promising universal exactly-once email delivery.

### F09 — Notes, comments, team chat, and targeted messages

**MVP:** categorized plan/item notes with audience rules; item comment threads with mentions; target a message to a team, all scheduled people, or unanswered requests; persist the audience snapshot and delivery result. A volunteer can reply in an authorized thread. Separate operational messages from account invitations and scheduling responses. Add configurable templates using an allowlisted set of variables and escaped rendering.

**Extension:** persistent team/group chat, push mentions, unread tracking, moderation, and searchable history. Rich replies/reactions/images/read receipts and optional direct messages follow basic chat; require explicit youth/guardian communication rules before enabling broader direct messaging. Live chat is scoped to its service run (F12); do not duplicate it as an unrelated transport. Private notes never appear in general exports, notifications, or response-link previews. Sender previews the resolved audience; excluded/missing-address people are visible. Changes in team membership affect future reads, not silent historical recipient edits.

**Contracts:** `/plans/:id/notes`, `/plan-items/:id/comments`, `/messages/preview`, `/messages`, later `/conversations` and `/conversations/:id/messages`. Replies to arbitrary email are not automatically ingested until an inbound-email integration is explicitly added. Existing scheduler Reply-To continues to reach the human scheduler.

### F10 — Saved templates, reusable items, and bulk planning

**MVP:** create named service-type plan templates containing chosen times, notes, ordered items, and staffing needs; optional roster patterns are copied as prepared/unconfirmed requests. Preview applying a template with explicit append/replace choices and conflict warnings. Maintain reusable item snippets/sections, separate from real scheduled plans. Editing a template never changes already-created plans.

**Bulk:** generate a bounded date series, edit each proposed date/time, apply a chosen template, then create atomically or as an explicitly tracked resumable batch. Respect local time and holiday exceptions; do not shift weeks as fixed milliseconds across daylight-saving transitions. Preserve the existing one-plan duplicate/import path while moving its internals into the same validated copy service. Copy needs explicitly; reset answers, notification timestamps, and actual run timing.

**Contracts:** `/plan-templates`, `/item-templates`, `/plans/generate/preview`, `/plans/generate`, `/plans/:id/apply-template`. Template revisions and provenance are recorded on generated plans. A repeated commit with the same key returns the same result; a user intentionally applying twice sees a duplicate warning.

**Extension:** plan series/title/artwork, copying service-type defaults, and bulk rescheduling. A reschedule preview distinguishes shifting an entire plan and its assigned times from moving only order content while retaining the destination roster. It lists affected responses/jobs/feeds and offers an explicit reset-response option; no answer is reset implicitly.

### F11 — Complete item editing and scheduled order timing

**MVP:** edit an existing plan item's title, type, length, description, arrangement, service key, and item-specific song sequence; keep library arrangement defaults unchanged. Show computed start/end times for each selected service instance plus total planned finish. Headers do not consume time. Provide print preview of the running order with selected notes/audiences.

**Extension:** pre/post-service sections, fixed-start anchors, simultaneous items, collapsible sections, media references and item detail categories. Define timing behavior before adding each mode. A proposed first rule: simultaneous items share a start and consume the maximum duration; an anchor that contradicts accumulated time displays a gap/overlap warning instead of silently shortening items. Live F12 records actual durations separately.

**Correctness:** every plan rehearsal/print/mobile chart resolves the effective arrangement/key through the shared renderer. The current Rehearse tab displays the plan key but passes only raw chart text; verify and repair this mismatch before rehearsal parity is declared. Reorder/edit uses an expected plan revision.

**Responsibility:** assign an item leader directly or through a team position; resolve position-based responsibility from that plan's current assignment and display it in order, applicable notifications, and reports. Configurable note columns expose only authorized categories. Link a reusable media bundle through F14 without treating it as a song; quick-add and keyboard shortcuts follow core editing.

**Contracts:** extend existing item PATCH and order endpoints, adding typed timing/sequence fields and a computed schedule response rather than storing redundant computed timestamps. Expose accessible edit controls in the web Order tab; mobile may begin with simple field edits.

### F12 — Live service control and actual timing

**MVP:** create a separate run for each actual service time, with a controller, current item, countdown, next item, planned/actual finish, and item transition history. Viewers follow from web/mobile. Advance, pause, resume, jump, and end are explicit actions. Controller transfer is deliberate; concurrent/stale controls return a conflict. Reconnecting clients load authoritative state and calculate timers from server timestamps.

**Rules:** a new run never overwrites another service instance or the plan's planned durations. Zero-length headers advance without starting a countdown. Edits to a plan during a run require a version warning; MVP pins a run snapshot, with explicit refresh before starting or a controlled rebase action later. Persist transitions, not one write per countdown second. A disconnected viewer sees last-updated time; a disconnected controller cannot claim its changes were applied.

**Extension:** authorized run chat, full-screen stage display, public limited display link if explicitly published, and planned-versus-actual reports. Public views exclude people, private notes, files, and chat by default.

Countdown policy may later choose full item duration, the planned item end, or the service end; the selected policy is visible, and an overrun is shown explicitly. Basic actual-time correction must record who changed what and why rather than replacing transition history invisibly.

**Contracts:** `/plans/:id/runs`, `/runs/:id/state`, `/runs/:id/actions`, optional authenticated realtime subscription. Choose Supabase Realtime or another compatible transport at implementation; existing polling of notifications does not provide Live synchronization.

### F13 — Attachments and file audiences

**MVP:** attach uploaded files or external URLs to a plan, item, song, or arrangement, with optional key-specific association, category, audience, and version. Existing `attachments` metadata/bucket is a starting point, not a complete file feature. Preserve separate uploaded songbook documents. List/preview/download in web and mobile; validate type/size, parent ownership, and relationship correctness.

**Lifecycle:** authorize upload intent → issue bounded upload access → upload → finalize metadata → make available. Failed/orphan uploads are visible and cleaned up safely. Replacing a file creates a version; old plans may pin the version they rehearsed. Use short-lived authorized download links. Audience rules apply at Storage access and signed URL issuance, not only by hiding a link. Existing organization-wide bucket reads must be narrowed before promising team-only files.

**Contracts:** `/files/upload-intents`, `/files/:id/finalize`, `/files/:id/download`, parent file lists, version/archive operations. For MVP require exactly one primary owner; use explicit additional link records for reuse. Content and policy must agree when moving or copying files. Do not fetch arbitrary external URLs on the API server without a deliberate fetch policy.

Extend file ownership to plan items and service-type defaults through the same permission model. A simple text-document editor can create a versioned attachment; allowlisted formatting and escaped rendering are required. File/position tags determine eligible audiences; adding a service type's default file links it predictably to future plans without silently changing pinned historical versions.

### F14 — Audio rehearsal and stage preparation

**MVP:** build an ordered playlist from a plan's permitted audio/links; play/pause/seek, repeat, navigate tracks and show effective key/tempo/chart. Support browser/native playback controls where supported and clearly identify external playback links. Playback may not imply a right to download or transform provider content.

**Extension:** local audio speed/key processing after a media feasibility spike, offline preparation packs, PDF page navigation/annotations, hands-free page turns and shared stage sessions. Treat this as staged optional Music Stand-style scope, not required for initial Services workflow parity. Offline downloads require explicit action, a manifest/version, device storage management, and rights/access recheck on reconnection; revocation cannot erase bytes from an offline device immediately.

**Contracts:** `/plans/:id/rehearsal-manifest` resolves permitted file versions, item order, keys, charts, and cache metadata. Reuse F13 and shared chord rendering. Implement a minimal accessible player before background transcoding or advanced audio transforms.

**Media-library extension:** reusable bundles with duration, creator, thumbnail, tags/themes, notes, multiple permitted files, usage history, and optional archive date; attach bundles to order items. This is distinct from uploaded songbook documents. **Stage-layout extension:** place people and gear on a reusable background/template, save plan-specific layouts and export PDF. Preserve a layout snapshot if assignments later change, flag unmatched/departed people, and let a leader explicitly refresh. Music Stand-style PDF annotations and page-turn controls remain a separate optional stage rather than requirements for a basic stage diagram.

### F15 — Song library curation and data import

**MVP:** filter by existing tags/metadata, key, BPM, and scheduled date range; archive/restore songs and arrangements; detect duplicates and merge deliberately while preserving plan references and song history. Bulk edit metadata/tags with a preview. Existing title/theme search, arrangements, charts, PDF exports, and per-song schedule history remain.

**Imports:** validated CSV/structured import for people and song metadata with mapping, preview, row errors, duplicate resolution, and idempotent commit. Importing a document into Songbooks currently stores a document; it does not parse songs. OCR/AI chord-sheet imports were explicitly removed in the latest migrations: do not reintroduce them as implied scope. Licensed catalog search/import belongs to F17 and depends on provider access.

**Contracts:** `/songs/bulk/preview`, `/songs/bulk`, `/songs/:id/archive`, `/songs/merge/preview`, `/songs/merge`, `/imports`; validate source formats at the boundary. Archive removes records from normal pickers but keeps historical plan rendering; merge remaps references transactionally and records provenance.

**Arrangement extension:** duplicate an arrangement's selected details/files with provenance and new IDs; support labeled keys under an arrangement so alternate/capo/vocal keys can select their own files without duplicating the whole arrangement. Plan-specific sequence/key overrides belong on the plan item (F11). Duplicate-song detection/merge is a proposed Service Center convenience, not a verified Planning Center parity feature; defer it until archive/import needs justify it.

### F16 — Operational reports, calendar completion, and print/export

**MVP:** staffing vacancies and response follow-up across a date range; per-person/team service frequency and response history; song usage with explicit service-type/date filters; printable plan order, roster, and multi-plan schedule. Export CSV with filters, timezone, generation time, and metric definitions. Existing songbook/chart PDF output is reused but is not a report builder.

**Metric rules:** distinguish assignments from distinct people and distinct service occasions. A person in two positions on one plan is one person-plan participation but two assignment records. Confirmed schedules are planned participation, not proven attendance. Canceled/archived/draft inclusion must be selectable and labeled; repeated songs count either occurrences or distinct plans, never ambiguously. Actual timing reports consume completed F12 runs only.

**Calendar extension:** organization/service-type/team subscription feeds with bounded ranges and visibility rules, plus blockout views for permitted schedulers. Preserve personal feed token rotation and stable event identifiers. External calendar clients control polling, so do not promise instant synchronization.

**Attendance:** leaders record present/absent/unknown for scheduled people at a specific plan time, individually or by team, with author/time and corrections. Do not derive attendance from confirmation. Counts deduplicate a person at that occurrence; history survives roster archive. Check-Ins input is an optional F17 adapter. **Calendar detail:** birthdays/anniversaries are opt-in, permission-aware calendar layers, alongside blockouts. Existing profile metadata does not imply those events already appear.

**Public distribution extension:** a manager explicitly chooses sanitized public plan fields, publishes now/on the service day, shares a set list, and can revoke public access. Stable nearest-upcoming/most-recent links expose only published sanitized projections. Files, private notes, contact details, staffing names, and chat are excluded by default. Church Center/Publishing publication is a distinct optional adapter.

**Contracts:** `/reports/staffing`, `/reports/participation`, `/reports/song-usage`, `/reports/run-times`, `/plans/:id/print`, `/calendar-feeds`; report/export authorization matches source data and excludes private notes. Large exports are queued through F08 infrastructure and expire.

**Custom reports, later:** save an administrator-authored selection of permitted columns, filters, grouping and layout for plan/matrix/people reports; preview with the actual viewer's access. Template customization must not permit arbitrary database queries, unrestricted script execution, or bypass source-data permissions. Share report definitions separately from generated result files.

### F17 — Licensed resources, ecosystem connections, and developer access

**Optional stages:** (a) SongSelect/CCLI-compatible search/import and auditable usage export; (b) approved media/storage/lyrics-presentation connections; (c) public versioned API and webhooks; (d) specific People/Calendar/Check-Ins product handoffs only if the organization needs them. Each adapter needs a named owner and a documented use case. A metadata field such as `ccli_number` is not an integration or licensing entitlement.

**MVP contract per adapter:** configure connection/scopes → verify access → preview import/export → explicit commit → store provenance and provider IDs → synchronize with idempotency/rate limits → show failures/reconnect → revoke. Store credentials server-side with minimal scope. Report scheduled use versus actual copyright-reporting activity explicitly; provider-specific reporting semantics require a separate verified contract before automation.

**Developer API:** issue revocable scoped credentials, publish versioned schemas/pagination, use signed webhooks with event IDs/retries/replay protection, and enforce the same tenant/capability boundaries as first-party clients. No public unauthenticated access to the current internal API is implied.

**Gate:** availability, commercial/API permission, rights, and current provider documentation must be confirmed for each adapter before committing engineering estimates. Full Planning Center People, Giving, Check-Ins, Registrations, and Church Center clones are outside this plan.

## 4. Proposed persistence responsibilities

These are candidate aggregates to guide implementation slices, not executable DDL or an approved final schema. Apply the repository's Supabase skill when writing migrations; use additive/backfill/validate/switch steps and preserve historical migrations.

| Area | Candidate records or extensions | Required invariant/access |
|---|---|---|
| F01 | scoped grants; optional folders; audit entries; response owner | Grant scope exists in same organization; no cyclic hierarchy; admin-only grant administration; scoped read/write checks at DB and Storage |
| F02 | person references on assignments, team memberships, request records; profile-person links; tags and archive/audit state | Stable organization Person; explicit link uniqueness; preserve old IDs and tokens; foreign people/profile links rejected |
| F03 | availability series, occurrence exceptions, preferences, delegation grants | Bounded recurrence evaluation; exception unique by series/occurrence; owner/delegate/scoped leader rights; private reasons separated where necessary |
| F04 | attendance mode and assignment-time links; conflict overrides | Time and assignment refer to same plan; unique link; transactionally recheck shared person/time contention |
| F05/F06 | saved views, rotation rules, proposal snapshots | Per-owner saved views; immutable proposal inputs/revision; no commit from stale eligibility |
| F07 | opportunities, claims/reservations, replacement requests/offers | Positive bounded capacity; claim/accept locks prevent overfill; eligible person and scoped leader access |
| F08/F00 | reminder policies; request batches/versions; outbox jobs; delivery attempts | Unique semantic job key; indexed due/status scans; leased job claim; retry accounting; worker-only sensitive fields |
| F09 | note categories/audiences; comments; conversations; message recipients/read state | Parent-compatible tenancy; audience checked at reads and notification creation; moderation/audit retention |
| F10/F11 | template revisions/components; item snapshots/sequence/timing extensions; plan revision | Apply atomic; historical plans independent; no inherited response/delivery/run state |
| F12 | run snapshots, controller lease, run transitions | Run tied to one plan time; serialized revisioned commands; viewers read allowed state only |
| F13/F14 | file links/versions/audiences; media bundles; rehearsal manifests/cache metadata; stage-layout snapshots | Valid primary owner; version immutability; matching Storage policies; no implicit public bucket |
| F15/F16 | import jobs/rows/provenance; arrangement keys; archive/merge history; attendance; export jobs; public projections | Preview cannot mutate; explicit merge; attendance distinct from answers; exports bounded/expiring and access checked; public fields allowlisted |
| F17 | external connections, mappings, webhook outbox/delivery records | Provider/tenant key uniqueness; encrypted secrets; service-only credential access; revocation |

Index tenant/parent foreign keys and actual filter/join/ordering paths; use partial indexes for pending/due work where justified. Prefer constraints/composite foreign keys to inconsistent duplicated organization/parent identifiers. RLS `USING` and `WITH CHECK` must cover reads, inserts, updates, deletes, and moves. Service-role jobs revalidate the initiating actor's scope or an explicitly configured system policy. Keep remote calls outside transactions. Use short atomic claims/leases (for example `SKIP LOCKED`) for concurrent workers and explicit serialization/locks for slot capacity and person scheduling races. Measure bounded query plans before tuning; do not preemptively partition ordinary ministry data.

## 5. Migration, validation, and release criteria

1. Capture existing assignment/token/feed semantics and seed fixtures for linked and unlinked people, multiple organizations, all roles, multiple positions, multiple times, and daylight-saving boundaries. Preserve the decisions in ADR-0001/0002/0003 unless a specific follow-up ADR deliberately supersedes them.
2. Add new records/fields/policies; backfill and report mismatches; update named shared types/schemas/client methods; deploy compatible reads/writes; switch feature flags only after reconciliation. Do not perform destructive cleanup as part of the initial slice.
3. For every epic test a successful user workflow, a rejected unauthorized action, failure/retry behavior, and one meaningful edge case from its stories. Scheduling, signup capacity, jobs, and Live require concurrent-operation tests. RLS/Storage changes require cross-tenant and scoped-role database tests.
4. Target integration tests at persisted outcomes rather than mirroring helper implementations. Web/mobile smoke paths cover schedule → release → respond → applicable calendar event → preparation materials. Use provider stubs plus an explicit configured-delivery smoke test before claiming production email/push works.
5. Set proposed quality targets for refinement: 12-plan/200-person scheduling view usable within 2 seconds at p95 on agreed reference data/network; API mutations within 1 second excluding provider work; Live state reaches connected viewers within 2 seconds at p95; due reminders claimed within 5 minutes of due time. These are acceptance targets, not measured current performance or guaranteed estimates.
6. All interactive actions support keyboard navigation/focus and clear screen-reader labels; mobile controls have suitable touch targets. Counts/timers never depend on color alone. Loading, partial failure, empty, expired, stale revision, and offline states must be designed.
7. Roll out per organization with operational metrics: overdue jobs, provider failures, duplicate suppression, response conversion, unresolved staffing needs, failed template/import jobs, Live reconnects, and file authorization failures. Logs exclude tokens, credentials, and unnecessary personal/message data.
8. Definition of done: applicable story acceptance criteria pass; current build/typechecks/tests pass for code delivered; migration/backfill and rollback/disable procedures reviewed; docs/API contract updated; no false delivery labels; web/mobile coverage matches the stated slice. This documentation change itself does not execute deployments or validate a live database.

## 6. Assumptions to confirm at implementation kickoff

Proposed defaults allow forward planning without blocking this document: start with web scheduling and volunteer mobile parity; preserve current access during additive migrations; pilot prepared requests explicitly; keep reminders configurable/off by default until delivery is configured; use a deterministic scheduling engine; defer licensed providers and Music Stand-style advanced stage tooling. Confirm actual team capacity, church size, multicampus need, household delegation policy, message retention, commercial integrations, supported deployment, and target service timezone before committing dates or final schemas. These decisions refine scope; they do not justify rebuilding existing features.
