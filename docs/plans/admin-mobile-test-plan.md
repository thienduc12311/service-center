# Admin web and mobile test plan

Date: 2026-11-13. Source baseline: `92ec2f1` on `feature/ui-design-refresh`.
Status: planning only; no tests executed, accounts created, data seeded, or testing agents launched by this document.

## 1. Goal and scope

Verify every currently exposed Service Center workflow on the admin web application and the iOS/Android mobile applications, using realistic data for every organization role and every meaningful permission variant. Verify the API, Postgres RLS, Storage, workers, and external handoffs behind those workflows. Prepare small, independent work packages for later testing agents.

“Admin web” means the web application tested as owner, admin, scheduler, scoped leader, and member; it does not mean every web user has administrator privileges. Team positions such as Bass are scheduling data, not authorization roles. The organization roles are exactly `owner`, `admin`, `scheduler`, and `member`; a scoped leader is one of those roles with explicit grants, not a fifth role.

Current implementation is the execution target. The source review included in-progress working-tree changes; this document is not a claim that those edits are contained in the baseline commit. Older specifications describe proposed extensions, so they are traceability sources rather than proof that a feature exists. At execution kickoff, freeze a commit, migration set, deployed build, and feature configuration; reconcile changes since this baseline before assigning work. Most F00–F17 and MOB-001–MOB-033 entries remain implemented with QA pending. Historical test results in progress ledgers are not results from this test campaign.

### Source map

| Source | Purpose |
|---|---|
| `frontend/src/router.tsx`, `frontend/src/pages/`, `frontend/src/components/` | Web routes, nested workflows, public surfaces, disabled routes |
| `mobile/app/`, `mobile/src/components/`, `mobile/app.config.js` | Native routes, features, permissions, link and widget configuration |
| `backend/src/routes/`, `backend/src/services/`, `backend/src/worker.ts` | Authorization, mutations, delivery, jobs, public/developer API |
| `packages/shared/src/schemas/`, `types/`, `lib/` | Validation contracts, effective access, timing, chart, reporting rules |
| `supabase/migrations/`, `supabase/tests/`, `supabase/seed.sql` | Latest persistence rules, existing database tests, baseline seed limitations |
| `docs/specs/services-feature-specification.md` | F00–F17 functional requirements |
| `docs/specs/mobile-feature-specification.md`, `docs/plans/mobile-feature-tasks.md` | MOB-001–MOB-033 scope and acceptance criteria |
| `docs/plans/services-capabilities-progress.md`, `mobile-first-10-progress.md`, `mobile-remaining-progress.md`, `i18n-vietnamese-progress.md` | Implemented slices, deferred scope, outstanding native/provider gates |
| `backend/src/routes/people-access.test.ts`, `mobile/src/lib/directory.ts`, `packages/shared/src/lib/access.ts` | Recent owner-only People rule and legacy scheduler roster exception |

## 2. Execution rules and coverage standard

1. All test data is synthetic and belongs to isolated local/QA organizations. Use captured email, fake provider adapters, or controlled test recipients. A real email/push/webhook test requires the corresponding test endpoint/device; absence is a blocker for that delivery check, never a pass.
2. Each scenario below expands into separate case records for its listed actions, allowed roles, denied roles, relevant clients, and meaningful failure modes. A row containing create/edit/delete is not complete after testing create alone.
3. For every mutation: inspect starting state, perform the action, assert the visible result and persisted state, reload, then verify the other client where applicable. Check side effects such as revisions, history, notifications, jobs, and storage objects. Failure must not leave partial writes or a false success message.
4. For every sensitive resource: test UI visibility, direct route/deep link, REST request, caller-authenticated database access, and Storage access where applicable. A hidden button is insufficient. Never use a service-role token to prove a user's permissions.
5. For every collection: empty, one, multiple, pagination boundary, search with no results, filters, stable ordering, reload, and permission filtering. Exercise actual screens; unit tests alone cannot close UI coverage.
6. For every form: required/optional fields, whitespace, length/range boundaries, invalid parent IDs, invalid enums, cancellation, duplicate tap, slow save, offline/timeout, stale revision, validation recovery, and preserved drafts. Determine numeric limits from current Zod schemas rather than guessing them.
7. For every destructive action: review/confirmation, cancel, authorized success, prohibited actor, referenced-resource behavior, history retention, and retry. Restrict cleanup to that agent's fixture manifest.
8. Distinguish `PASS`, `FAIL`, `BLOCKED`, `NOT_RUN`, and `NOT_APPLICABLE`. Unsupported or unimplemented work stays explicitly deferred; it does not become a completed feature.
9. Plan-only work ends with this document. Future agents will create seed scripts, load data, execute tests, and file results. They should report defects rather than silently change implementation during a testing assignment.

### Priority

| Priority | Coverage |
|---|---|
| P0 | Authentication/tenant isolation, private/prepared data, role enforcement, response scope, capacity/concurrency, atomic writes, lost data, secret leakage |
| P1 | All supported feature workflows, cross-client persistence, native delivery/playback/cache/link behavior, reports and exports |
| P2 | Cosmetic consistency, secondary layouts, nonblocking usability and performance tuning |

## 3. Role and permission model to test

### Permission oracle

Use these rules as the baseline, and record any source disagreement before testing the affected action. Do not replace a newer restriction with an older broad capability label.

| Action | Owner | Admin | Legacy scheduler | Scoped scheduler / member with grant | Ordinary member / delegate |
|---|---|---|---|---|---|
| Organization configuration and access grants | Allow | Allow within current ownership protections | Deny | Deny | Deny |
| Directory names/photos/campus | Allow | Allow | Allow | Allow | Allow for active organization membership |
| Other Person detail, contacts/private fields, tags, create/edit/archive/delete/invite, membership changes through People | Allow subject to field rules | Deny, including with `people.manage` | Deny | Deny, including with People grants | Deny; self profile uses separate `/me` contracts |
| Own profile/contact/language/avatar | Allow self | Allow self | Allow self | Allow self | Allow self; cannot edit another login |
| Plans/order/times/templates | Allow | Allow | Organization-wide operational access | Only `plans.edit` scope | View only when entitled; no editing |
| Scheduling/preparation/release | Allow | Allow | Organization-wide operational access | Only `scheduling.manage` scope | Own released responses only, or explicit delegation |
| Conflict override | Allow with required review/reason | Same | Same under legacy access | Only matching `scheduling.override_conflicts`, with required reason | Deny |
| Team roster add/remove | Allow | Allow | Deny based solely on implicit legacy access; allow with explicit matching grant | Only explicit matching `teams.manage` grant | Deny |
| Songs/media authoring | Allow | Allow | Legacy organization-level capabilities | Explicit organization-wide `songs.manage` / `media.manage` | Deny unless explicitly granted |
| Prepared assignment visibility | Authorized management | Authorized management | Authorized management | Only managed scope | Hidden from own schedule/feed/counts/files/notifications until released |
| Delegated response, availability, signup, plan view | Independent permissions | Independent permissions | Independent permissions | Independent permissions | Only granted person/action; one permission does not imply another |
| Other organization's data | Deny without active membership | Same | Same | Same | Same; tokens/public projections expose only their defined scope |

Explicit capabilities to cover independently: `plans.edit`, `scheduling.manage`, `scheduling.override_conflicts`, `teams.manage`, `people.view_private`, `people.manage`, `songs.manage`, and `media.manage`. Test each alone, missing, revoked mid-session, and combined with another grant. Operational scopes are organization/folder/service type/team as allowed by `CAPABILITY_SCOPES`; People/song/media capabilities only accept organization scope, and `plans.edit` cannot be granted at team scope. Reject invalid combinations.

### Account fixtures

Every alias below gets a fresh QA identity per agent namespace unless it explicitly has no login. Emails are `<alias>.<run>.<agent>@example.test`, delivered only to a test sink. Generate passwords at execution time and keep them out of reports/git. The current demo seed has only an owner, a scheduler, and members in one organization; it is insufficient for this plan. Do not use its real-looking owner email for provider testing.

| Alias | Role / access | Required personal data and initial state | Main tests |
|---|---|---|---|
| `owner` | Alpha owner | Linked Person, complete private record, avatar, English | Organization, all management, People positive control |
| `admin` | Alpha admin | Linked Person, Vietnamese, ordinary team membership | Admin operations; owner-only People denial |
| `legacy` | Alpha scheduler, `legacy` mode | No explicit roster grant initially; Production team | Legacy ceiling, roster exception, switch to scoped |
| `scoped` | Alpha scheduler, `scoped` mode | `plans.edit` + `scheduling.manage` for Sunday only, no override | In-scope edits, Midweek and override denials |
| `band-lead` | Alpha member with grants | `scheduling.manage` + `teams.manage` for Band only | Band staffing/roster; Production, plan edit, library denials |
| `folder-lead` | Alpha scoped scheduler | Folder-scoped `plans.edit`/`scheduling.manage` | Descendant access, move/revoke inheritance |
| `librarian` | Alpha member | Organization `songs.manage` only | Song/chart authoring; no plan/staffing/People privileges |
| `media-editor` | Alpha member | Organization `media.manage` only | File/media workflows; no song/plan/People privileges |
| `people-grant` | Alpha member | Organization `people.manage` + `people.view_private` only | Owner-only enforcement despite nominal grants |
| `pending` | Alpha member | Acoustic and Bass memberships; two released pending positions | Grouped/split responses, preview scope |
| `confirmed` | Alpha member | Electric position; confirmed assignment; Vietnamese name `Nguyễn Thị Ánh` | Withdrawal, rehearsal, language/diacritics |
| `declined` | Alpha member | Drums position; declined with private reason | Replacement request, history, privacy |
| `candidate-a` | Alpha member | Keys, Drums, Camera eligibility; fresh availability | Signup/replacement race participant A |
| `candidate-b` | Alpha member | Keys, Drums, Camera eligibility; fresh availability | Competing participant B |
| `delegate` | Alpha member | Explicit grant from `dependent`; no grant from `unrelated` | Household action boundaries and revocation |
| `dependent` | Alpha member | Separate login/Person; grants respond + availability only initially | Permission-by-permission delegation; later view/signup grants |
| `unrelated` | Alpha member | No team, assignments, or delegation; duplicate display name with candidate A | No-rights control, ID-based selection |
| `multi` | Alpha member + Beta member | Distinct Persons per org, English in Alpha and Vietnamese in Beta; combined schedule off | Org switching, opt-in aggregation, busy redaction |
| `inactive` | Inactive Alpha membership | Previously released assignment, cached screens, registered test device | Membership/session revocation |
| `archived` | Archived Alpha Person | Historical assignment and attendance | Archive/search/history; restoring eligibility |
| `guest` | Alpha Person without Profile/login | Synthetic email, Vietnamese, tag, pending prepared assignment | Person-first scheduling, token response, later account linking |
| `no-email` | Alpha Person without Profile/login | No email or phone | Scheduling remains possible; honest undeliverable result |
| `beta-owner` | Beta owner only | Same song/team/plan names as Alpha, different IDs and private sentinel | Cross-tenant object substitution |
| `newcomer` | Authenticated, no organization | No membership or linked roster record | Welcome/create/join flow |
| `anonymous` | No session | Separate clean browser/device state | Public pages, invitations, respond tokens, unauthorized API |

For ownership changes/removing the last owner, inspect supported contracts first; protect the primary fixture owner and perform such tests only in a disposable organization. Add a second owner in that disposable fixture if the operation is supported.

## 4. Test-data feeding plan

### Ownership, generation, and lifecycle

- A bootstrap agent will implement a repeatable, versioned fixture loader in a later task. This plan does not add SQL or seed code. Load in dependency order: auth identities/profiles → organizations/memberships → folders/service types → Persons → teams/positions/rosters → grants/policies → songs/arrangements → plans/times/order/needs → assignments → availability/delegation → collaboration/files/jobs/report inputs.
- Use namespace `qa-<run>-<agent>` in organization slugs and authored fixture names, with generated UUIDs recorded in a manifest. Logical keys below are names, not literal database IDs. Never infer a Person/Profile relationship from matching emails.
- Each work package receives its own Alpha/Beta organizations and accounts. Shared files are immutable source samples only. A single coordinator owns initial creation and final cleanup; test agents can reset only their own declared fixtures. Workers must be partitioned by fixture environment or run in isolated database instances where the worker cannot be scoped.
- Manifest fields: run ID, agent ID, seed version, commit, organization/Profile/Person/resource IDs by alias, base clock, timezone, expected starting counts, revisions, artifact checksums, enabled features, and cleanup ownership. Secret tokens/passwords belong in a separate ephemeral credential channel.
- Make initial loading idempotent. Re-running the loader must not create duplicate auth identities, Persons, assignments, messages, jobs, or storage objects. A reset must restore known starting states and remove run-owned caches/queues before the next scenario.
- Create role identities/grants first using authorized fixture setup. Then feed representative feature data through actual role UI/API actions to test authoring. Use privileged setup only for prerequisite/impossible-to-reach states, expiration, volume, and intentional fault injection; verify normal outcomes using the caller's token.
- Keep immutable baseline fixtures and separate mutable clones per scenario. Cross-client tests intentionally share one clone between web/mobile; capacity races intentionally share one clone between two contenders. Destructive and race suites never reuse a feature agent's baseline.

### Core feature datasets

| Dataset / keys | Data to feed | Starting expectations / purpose |
|---|---|---|
| D01 `ALPHA`, `BETA`, `EMPTY` | Alpha timezone `America/Chicago`, Beta `Asia/Ho_Chi_Minh`; third empty org for onboarding/empty states; duplicate names and distinct private sentinels | No cross-tenant data; empty screens do not depend on demo records |
| D02 `FOLDER-A`, `FOLDER-CHILD`, `FOLDER-B`; `SUNDAY`, `MIDWEEK`, `ARCHIVED-TYPE` | Nested and sibling folders, default landing folder; Band shared explicitly across service types; separate Production and Hospitality teams | Folder inheritance and team associations remain distinct; copy does not copy people/grants |
| D03 roster / eligibility | Complete and minimal Persons, duplicate names/emails, Unicode, tags/campuses, archived/inactive/no-login records; clear/not-clear/pending/missing/expired secure-team eligibility | Owner-only details, identity continuity, fail-closed secure staffing |
| D04 `P-RELEASED` | Published Sunday plan with 09:00 service, 11:00 service, preceding rehearsal, stable time IDs; 10 required positions; assignment ledger below | Known staffing, grouping, statuses, selected-time behavior |
| D05 `P-PREPARED`, `P-DRAFT`, `P-HISTORY`, `P-EMPTY` | Published plan with two prepared requests (`pending`, `guest`); draft with prepared requests only; historical completed plan; empty future plan | Publication and release independent; prepared excluded; previous/next and empty details |
| D06 `P-TIME`, `P-CONFLICT`, `P-DST`, `P-OVERNIGHT` | Same-person overlaps, adjacent intervals, selected/all-time attendance, rehearsals outside service date, overnight times, spring gap/fall overlap | Exact conflicts, stable time identity, date/time correctness |
| D07 `P-RACE-SIGNUP`, `P-RACE-REPLACE`, `P-SWAP` | One needed position with zero occupants/holds; eligible A/B; immediate/approval opportunities; separately declined original; separate optional swap assignments | Final slot can be allocated once; original decline and consent retained |
| D08 availability / delegation | One-off/all-day/recurring blockouts, end-count/end-date recurrence, current/stale review, frequency/monthly cap/preferred weeks/times; independent delegation permissions | Preview impact without silent declines; self/delegate and freshness warnings |
| D09 templates / proposals | Empty/full/section templates, multiple revisions, missing/archived arrangement reference, locked choice, exclusions, rotation exceptions and tied serving history | Safe previews, explicit warnings, deterministic proposals and atomic commits |
| D10 song library | At least 125 synthetic songs, duplicate titles, archived song, multiple arrangements/default, labeled keys, multiple meters/tempos/tags, no-chart song, long Vietnamese chart, plan-only key/sequence | Real pagination beyond 100; curation, merge, chart/export fidelity |
| D11 files / media | Small PDF, multipage PDF, image, playable audio/video, text doc, external link, unsupported/corrupt sample, zero-byte and over-limit sample; versions v1/v2; each supported parent/audience | Lifecycle, versions, restricted download/preview, media and rehearsal manifest |
| D12 collaboration | Organization/team/private notes, item discussions, team/plan conversations with multiple pages, muted/unread/reported entries; allowed/missing-contact message recipients | Audience redaction, idempotent retries, truthful delivery and unread counts |
| D13 delivery / jobs | Prepared/released requests, due/future/cancelled reminders, simulated/accepted/failed outcomes, retryable/permanent provider faults, duplicate queue execution, revoked test device | Delivery is separate from request visibility and answer state |
| D14 attendance / reports | Two service occurrences, multiple positions for one Person, confirmed-but-absent and pending-but-present, unknowns, corrected record and audit actor | Attendance not inferred from confirmation; exact deduplicated metrics |
| D15 publication / tokens / integrations | Active/rotated/revoked/expired respond, invite, feed, public link and API credentials; controlled webhook receiver and event history | Minimal disclosure, rotation, expiry, replay, scope and retry |
| D16 native local state | Partial/complete/expired offline packs, changed file version/rights, nearly full disk, stale widget snapshot, old-user drafts, old org push intent | Account isolation, explicit offline state, cleanup, native expiry and recovery |
| D17 volume / hostile inputs | 250 Persons, 125 songs, 60 plans, >1 page of messages/files/notifications; blank/long/Unicode/HTML-like strings; CSV quoted newline/BOM/duplicates/formula-like text | Pagination, validation, escaping and performance; no executable content |

### Exact baseline assignment ledger for D04

No holds, signups, replacement requests, or overlapping external commitments exist in this baseline. Each of the 10 positions needs one person. Camera and Usher have no assignment. Empty positions, declined rows, and active occupancy must be counted separately.

| Person alias | Position | Visibility | Answer | Time applicability |
|---|---|---|---|---|
| `owner` | Worship Leader | released | confirmed | All three times |
| `confirmed` | Electric | released | confirmed | All three times |
| `multi` | Greeter | released | confirmed | 09:00 only |
| `pending` | Acoustic | released | unconfirmed | Rehearsal + 09:00 |
| `pending` | Bass | released | unconfirmed | 11:00 only |
| `candidate-a` | Keys | released | unconfirmed | All three times |
| `candidate-b` | Sound | released | unconfirmed | All three times |
| `declined` | Drums | released | declined | All three times |

Expected assignment rows: **8**; confirmed **3**, unconfirmed **4**, declined **1**; nondeclined occupancy **7**; unfilled required positions **3** (Drums, Camera, Usher). Unique assigned Persons including the declined Person: **7**. `pending` sees one grouped plan with two distinct positions, and a 09:00 response must not answer the 11:00 Bass assignment. Validate team-specific totals from this ledger rather than copying whole-plan totals into each team.

### Role-driven data feeding scripts to implement later

These are UI/API feeding recipes, not scripts already written or executed. Each agent runs them on a fresh mutable clone; none changes D04's baseline unexpectedly.

| Acting identity | Feed through the application | Assert after reload / other client |
|---|---|---|
| owner | Create a no-login Person, set Vietnamese/tags, add to roster; create organization/type defaults and grant a scoped leader | New Person has no Profile until acceptance; scoped grant has exact target; private fields visible only to owner |
| admin | Edit organization branding, create plan, configure test integration; attempt Person creation/detail/edit | Authorized settings and plan persist; People actions denied with no data change |
| legacy | Prepare one assignment and edit one plan; attempt roster add, then repeat after owner grants explicit team management | Operational legacy actions persist; initial roster denial and later allowed in-scope addition recorded separately |
| scoped / folder-lead | Create/edit a plan inside granted type/folder, then attempt sibling type and move inherited scope | Only authorized plan changes persist; inherited access changes after reviewed move/revocation |
| band-lead | Update Band needs, add/remove one Band roster membership, prepare one existing eligible Person | Band counts and membership IDs correct; Production/plan edit/library denied; no unauthorized guest-person creation |
| librarian / media-editor | Librarian creates song/arrangement/key/chart; media editor uploads v1 then v2 with audience | Correct ownership/revisions/materials in web/mobile; roles cannot acquire each other's authoring rights |
| pending / confirmed / declined | Confirm one reviewed time scope; withdraw deliberately; decline and request replacement | Exact assignment/time status and history; no other scope answered; one eligible replacement request |
| candidate-a / candidate-b | Claim a fresh opening or consent to separate competing replacement offers | Review/approval state accurate; shared race clone allocates one place maximum |
| delegate / dependent | Grant response only, answer as delegate, attempt plan/file/signup; add each permission separately, then revoke | Only explicitly granted actions succeed; revocation blocks open review and dependent history identifies delegate |
| multi | Set different per-org language/preferences; opt in to combined schedule and busy sharing separately; copy one reviewed blockout | Each org retains own Person/preferences, action target and timezone; copy retry does not duplicate |
| newcomer / guest | Create/join only through supported onboarding; accept invitation into existing Person | Membership/identity continuity and no duplicate roster Person |
| people-grant / unrelated / inactive / anonymous / beta-owner | Send forbidden attempts against seeded Alpha records and alternate endpoints | No private return, unauthorized mutation or side effect; anonymous tokens limited to explicit projection |

### D14 exact metric oracle

Use a separate report-only plan clone so it cannot alter the staffing oracle. Give `pending` two positions applying to 09:00, and make owner/confirmed/pending/candidate-a applicable to both service times. Record only the following six attendance rows; leave candidate-a unmarked at both times.

| Person | 09:00 record | 11:00 record |
|---|---|---|
| owner | present | absent |
| confirmed | absent | present |
| pending | unknown | present |

Expected persisted attendance record totals: **present 3, absent 2, unknown 1**. Multiple positions must not duplicate pending's 09:00 record. Unmarked candidate-a may appear as unmarked/unknown on the sheet, but must not add a recorded-unknown row to the participation report. Correct pending's 09:00 record to present: totals become **present 4, absent 2, unknown 0**, still six records, with correction actor/reason/history.

For song usage, schedule one synthetic song twice in plan A and once in plan B: **3 occurrences, 2 distinct plans**. For actual timing, create an ended Live run with snapshot item lengths 60 + 120 seconds and elapsed time 200 seconds: **planned 180, actual 200, difference +20 seconds**. Add a separate ongoing run and verify it is excluded from completed-run metrics. Fix report filters to include only these named fixture plans/occurrences; UI, JSON, CSV, print and tracked export must agree.

### Clock and file controls

Use a frozen test clock `T0` where supported; for devices, generate dates relative to actual run time and record that clock in the manifest. Use the next Sunday at 09:00/11:00 in the organization's zone for ordinary future plans. Explicit DST fixtures: Chicago `2027-03-14 02:30` (nonexistent) and `2027-11-07 01:30` (ambiguous). Test the implemented rejection/resolution contract and preserve wall-clock intent on recurrence. Adjacent `[09:00,10:00)` and `[10:00,11:00)` commitments do not overlap. Include device zones differing from both org zones.

Generate file samples at execution time, record MIME/byte size/checksum and rights, and keep samples small except intentional limit tests. Inspect current schema/configuration for upload limits. Use actual supported offline policy: current shared recheck period is **24 hours**, default pack cap **500 MiB**; widget snapshots expire after **12 hours**. Older proposed 30-day cache language is not the current acceptance rule. Verify boundary values against the frozen build.

## 5. Admin web and shared feature scenarios

Notation: W = web, M = native mobile, A = API, D = authenticated DB/RLS, S = Storage, J = worker, P = public/external surface. Unless specified otherwise, these are P1 cases; every authorization, isolation, atomicity, concurrency, token, and data-loss check is P0. Case identifiers are stable prefixes for expanded records.

### A. Authentication, organization, access, and navigation — F01 / MOB-003

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| AUTH-01 | Every login role, newcomer, anonymous / D01 | Sign in/out, invalid credentials, supported registration/recovery flows, session refresh/expiry, rejected refresh; protected routes restore intended destination without private flashes; newcomer reaches welcome | W M A |
| AUTH-02 | owner, newcomer / EMPTY | Create org through supported onboarding; name/slug validation and duplicate slug; edit supported organization fields/logo/timezone; reload persists; forbidden roles cannot mutate | W A D S |
| AUTH-03 | multi, inactive, beta-owner / D01 | Switch Alpha/Beta during active queries/saves; missing/invalid `X-Organization-Id`, ambiguous org context, revoked membership; cache/search/navigation never shows another org's content | W M A D |
| AUTH-04 | Every role / D01–D03 | Dashboard totals, sidebar/tabs, breadcrumbs/global search, direct URL, hard refresh, unknown/removed route; controls reflect permissions and totals exclude prepared/inaccessible records | W M A |
| PROFILE-01 | Every active role, another user denied / D01 D03 | Own name/phone/avatar add/replace/remove, validation and crop/cancel/upload failure, appearance preference/reset; persisted profile and roster refresh across clients; caller cannot change another login or inject extra protected fields | W M A D S |
| ACL-01 | owner/admin, all restricted variants | Grant/revoke each capability at each allowed scope; inspect effective-access explanation; invalid scope rejected; roles cannot self-promote or issue admin grants | W A D |
| ACL-02 | legacy, scoped, band-lead, folder-lead | Legacy→scoped drops implicit rights; unrelated team/type denied; folder inheritance and nested move preview/acknowledgement, cycle rejection, stale revision, archive/reorder/default landing | W A D |
| ACL-03 | admin, people-grant, legacy, owner / D03 | Nonowners denied every People detail/mutation route even with People grants; list fields/search/network payloads redact other contacts/private fields; owner positive control; own `/me` edits still work | W M A D |
| ACL-04 | legacy, band-lead, admin / D02 | Legacy cannot add/remove roster from implicit grant; explicit matching `teams.manage` enables only target scope; invalid foreign membership/position rejected; revoke while editor is open | W M A D |
| ACL-05 | member, leader, anonymous / D05 D11 D15 | Prepared requests absent from schedule/calendar/feed/count/search/report/notifications/files/deep links and raw queries; release reveals only intended scope; public projection never leaks internal fields | W M A D S P |
| ACL-06 | all role variants / D01–D17 | Substitute foreign org/parent/Person/team/position/song/file IDs in reads and mutations; batch with one unauthorized ID fails per atomic contract; response discloses no foreign existence/private details | A D S |

### B. People, invitations, teams, and service types — F01 / F02

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| PEOPLE-01 | owner / D03 D17 | Create/edit minimal and complete no-login Person; contact/campus/private fields, language, dates and supported avatar; invalid/duplicate fields follow contract; detail/list stay consistent | W A D S |
| PEOPLE-02 | owner, guest, newcomer / D03 D15 | Schedule guest before login; invite/create account/join existing login; correct Person links explicitly; past assignments/answers/attendance/tags/language survive; duplicate email never silently merges identities | W M A D P |
| PEOPLE-03 | owner, anonymous / D15 | Invitation preview/send/resend/revoke; valid/expired/consumed/malformed token, wrong account; accepted membership role exact; invitation is separate from assignment notification | W M A D P |
| PEOPLE-04 | owner, all others / D03 D17 | Directory search/filter including archived/no-login/invite badges; tags/groups and bulk preview/commit; archive/restore/history; invalid row cannot partially mutate atomic batch; historical references retained | W M A D |
| PEOPLE-05 | owner/admin where supported / D03 | Identity reconciliation, duplicate/profile continuity review, membership role/status actions and protected ownership actions; unauthorized People routes remain denied even when older settings UI suggests access | W A D |
| TEAM-01 | owner/admin, band-lead, legacy / D02 | Team create/edit/delete, color/order, position CRUD/reorder, memberships with multiple positions, remove by membership ID; duplicate names/position references handled; roster exception enforced | W M A D |
| TEAM-02 | owner/admin, authorized leaders / D02 D03 | Defaults, response owner, prepared/released policy, tag-derived candidates, related-team visibility, secure-team rules; missing/expired/not-clear eligibility cannot staff secure team; unrelated teams stay hidden | W A D |
| TYPE-01 | owner/admin, scoped leader / D02 | Service-type wizard name/teams/default times; back/cancel/validation; edit/share teams, archive/restore/copy/delete; referenced type deletion safe; copy preserves selected structure without duplicating people/grants | W A D |

### C. Plans, times, templates, and running order — F04 / F10 / F11

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| PLAN-01 | planner variants, member / D04 D05 D17 | Browse service types/folders/upcoming/history, sort/filter/paginate, stable previous/next; draft/published display and access match current visibility contract; empty and deleted plan recover | W M A |
| PLAN-02 | owner/admin/scoped / D05 | Single plan create/edit/date/location/notes, publish/unpublish/delete; duplicate and copy selected children; copied confirmations/actual timings not reused; injected child failure rolls back | W M where exposed A D |
| TIME-01 | planners, pending / D06 | Create/edit/delete/reorder service/rehearsal/other times; stable IDs do not follow list positions; impact preview names assignments/reminders/feed effects; stale save rejected; selected IDs remain accurate | W M A D J |
| TIME-02 | scoped with/without override / D06 D08 | Detect service/rehearsal/overnight/selected-time overlaps; adjacent times allowed; blockout/preference/conflict differentiated; override requires matching capability and recorded reason; recheck at commit | W M A D |
| TIME-03 | planners / D01 D06 | Date-only vs instant, DST gap/ambiguity, device-zone change, all-day semantics, recurring wall time; local calendar day never drifts after reload/export/reschedule | W M A D P |
| TEMPLATE-01 | planners / D09 | Save full/section template, edit/version/name/archive, select earlier revision, preview/apply to empty/nonempty plan; child selection and missing arrangement warnings; repeat key has no duplicate writes | W M where exposed A D |
| TEMPLATE-02 | planners / D09 | Generate bounded dates with exclusions/duplicate dates and DST issues; review exact count and resolved times, stale preview and failure rollback; repeated commit returns original operation | W M A D |
| TEMPLATE-03 | planners / D06 D09 | Bulk reschedule whole plans vs order-only; preview conflicts/confirmed retention/notes/discussion impacts, explicit acknowledgement, stable times and job/feed changes; stale or invalid batch is atomic | W A D J |
| ORDER-01 | planners, librarian denied / D04 D10 D11 | Add/edit/remove header/free item/song/media where exposed; title/description/duration, leader by person/position, segments before/during/after; wrong song/arrangement/parent rejected | W M A D |
| ORDER-02 | two planners / D04 | Drag/reorder and keyboard/move controls; concurrent reorder/add/edit/remove, duplicate create tap and lost response; revision/idempotency preserve exactly one intended order without lost rows | W M A D |
| ORDER-03 | planners, member / D04 D10 | Nondefault arrangement/key/sequence and labeled key apply to plan only; chart navigation/preview/PDF uses effective context; another plan/library default unchanged | W M A |
| ORDER-04 | planners / D04 | Calculated item starts/total duration, zero/header durations, before/after segments and print/run sheet; correct notes/audiences; long text and page breaks remain legible | W M where exposed A |

### D. Scheduling, responses, capacity, and availability — F03–F08

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| STAFF-01 | owner/admin/scoped/band-lead / D04 | Needed counts plus/minus, candidate search/team/position/guest, show recent serving and conflicts; exact baseline totals; selected times; prepare/notify intention reviewed; no unauthorized team edit | W M A D |
| STAFF-02 | leaders / D03 D04 D06 D08 | Schedule with/without position, no-login/no-email, archive/inactive/secure eligibility; duplicate and concurrent scheduling rechecks conflicts/capacity; wrong relationships fail | W M A D |
| MATRIX-01 | authorized schedulers / D04 D09 D17 | Bounded multi-plan matrix, row/column totals, filters, missing access; saved-view create/load/update/delete and actor visibility; bulk prepare/copy/remove/time selection; preview warnings; atomic commit/revision/idempotency; stale cells recover without silent overwrite | W A D |
| PROPOSE-01 | schedulers / D08 D09 | Rotation CRUD/version/exception; propose, inspect reasons/fairness, lock/exclude/use-instead/recompute; deterministic same-input result; no candidates returns vacancy, not fabricated assignment | W A D |
| PROPOSE-02 | two schedulers / D09 | Commit reviewed proposal to prepared assignments; changed roster/conflict/rotation invalidates preview; duplicate commits harmless and partial failure rolls back; no member-visible leak | W A D |
| RESP-01 | pending / D04 | Grouped plan shows both positions/all applicable times; individual/grouped/split confirmation or decline with reason; review scope equals persisted scope; unrelated assignment unchanged | W M A D |
| RESP-02 | confirmed, declined / D04 | Deliberate withdrawal, private reason, history and response owner update; repeat response/reaccept after decline follows current state contract; removal invalidates old responses | W M A D J |
| RESP-03 | guest, anonymous / D05 D15 | Public response minimum disclosure; valid/expired/revoked/consumed/malformed token and web/native fallback; adding/changing assignment after preview yields stale rejection, never answers new scope | W M A D P |
| RESP-04 | two devices/sessions / D04 D15 | Authenticated vs token answer race; grouped response vs time edit/removal/release; one valid atomic transition, no mixed answers, deduplicated owner notification/history | W M A D J |
| AVAIL-01 | self/delegate/leader / D06 D08 | One-off/all-day availability create/edit/delete, date picker/timezone, overlap warnings and affected assignments; existing confirmed/pending answers unchanged | W M A D |
| AVAIL-02 | self/delegate / D08 | Recurrence preview/end count/end date/invalid rules; create on native, existing-series maintenance via authorized web handoff where required; edit/delete occurrences/series follows current contract and is bounded | W M A D |
| AVAIL-03 | self/leader / D08 | Team frequency/monthly max/preferred weeks/times, freshness affirmation/availability request, stale warning; private blockout reason redacted from generic conflicts | W M A D J |
| DELEGATE-01 | delegate, dependent, unrelated / D08 | Create/grant/revoke and picker; respond/availability/signup/plan view each independently allowed or denied; direct other-Person ID substitution fails; revoke during open review blocks commit | W M A D |
| OPPORT-01 | candidates/leader / D07 | Eligible list/detail, deadline, capacity, required times, immediate claim and approval state; cancel/reject/expire releases hold; private/ineligible team cannot enumerate or claim | W M A D J |
| OPPORT-02 | A/B/manual scheduler / D07 | Barrier-synchronized final-slot claim/claim, claim/manual fill, claim/replacement; one position maximum occupied/held; loser clear conflict, retry not duplicate | A D plus W M reconciliation |
| REPLACE-01 | declined, candidates, band-lead / D07 | Request after decline; offer/consent/approval in both orders, reject/cancel/expire, tracking sections; new recipient and correct times; original decline/history retained; no candidate self-approval | W M A D J |
| REPLACE-02 | A/B/leader / D07 | Competing accepts/approvals/manual fill, hold expiration; no overfill; stale version rejected and ambiguous result reread; replay never creates duplicate replacement | A D plus W M reconciliation |
| SWAP-01 | two eligible members/leader / D07 | If enabled: offer/consent/approval/cancel/expire; check both new conflicts and scopes, mutual required consent, atomic exchange and history; otherwise explicit gated status | W A D |

### E. Release, reminders, notifications, and delivery — F00 / F08

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| RELEASE-01 | schedulers, pending / D05 D13 | Preview and release exact assignment revisions, notify on/off, scheduled release, response-owner change; publishing alone does not send; delivery failure does not hide released request | W M where exposed A D J |
| RELEASE-02 | two schedulers/workers / D13 | Matrix/batch release race with edits/deletes; same key twice and lost reply; one release snapshot/effect per intended recipient; stale reviewed set not broadened | W A D J |
| REMIND-01 | leaders/self / D13 | Org/service/team policies, offsets/timezone/channel/preferences, due vs future jobs; confirmed/declined/unpublished/deleted/redated/time-scope changes recompute/cancel according to policy | W M A D J |
| DELIVERY-01 | owner/admin/leader / D13 | Transport mode and per-recipient attempts, simulated vs provider accepted vs delivered; missing email, partial failure, retryable/permanent fault; retry permitted failed subset and preserve locale/idempotency | W M A J |
| DELIVERY-02 | concurrent workers / D13 | Lease/claim/duplicate execution/crash before and after provider acceptance, retry/backoff/terminal state; no duplicated business event; ambiguous provider outcome reported honestly | A D J |
| NOTIFY-01 | member, response owner / D04 D12 D13 | In-app list/unread/read/all-read, pagination, exact plan/message/chat targets; deduplicated response and conversation notifications; revoked/deleted target becomes unavailable | W where exposed M A D |
| PUSH-01 | old/new user, multi / D13 D16 | Permission allow/deny/re-enable, register/rotate token, foreground/background/terminated tap, logout/relogin/org switch, shared-device lease; old identity stops receiving data; lock screen respects privacy | M A D J physical devices |

### F. Notes, operational messages, and conversations — F09

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| NOTE-01 | planner/authorized member / D12 | Note-category create/edit and supported archive/order actions; simple/categorized/team/private plan notes and item notes/discussion; add/edit/delete with revision, author/audience restrictions; restricted counts/snippets/attachments absent; wrong plan/item rejected | W M A D |
| MESSAGE-01 | leaders / D12 D13 | Message-template list/create/edit/archive and invalid variables; select permitted scheduled/pending/team/signup audience, preview actual recipients, missing contact exclusions, template variables/escaping, explicit send; duplicate send retry preserves identity; inspect per-recipient outcomes/history | W M A D J |
| MESSAGE-02 | member/leader / D12 | Device SMS/email handoff reviews permitted recipient contact; cancel composer/no installed handler/oversized audience; app never claims device message delivered after handoff | M physical devices |
| CHAT-01 | participants/nonparticipants / D12 | Team/plan chat list, paginated chronological thread, send/retry, unread/read/mute/mention/reply and implemented moderation/report actions; duplicate message ID once; unsupported action not advertised | W M A D J |
| CHAT-02 | revoked participant / D12 | Membership revoked during read/send/upload, stale composer after org switch, message target deleted; future reads/posts denied, draft isolated, unread/push identity correct | W M A D S J |

### G. Songs, charts, imports, files, rehearsal, and media — F13–F15

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| SONG-01 | librarian/member / D10 D17 | Browse/search/filter/sort/paginate past 100; active/archived/all, tags/author/key/BPM/meter/history where exposed; create/edit metadata/notes/tags/archive/restore/delete; reference protection on deletion; member reads only authorized library | W M A D |
| SONG-02 | librarian / D10 | Arrangement add/edit/duplicate/archive/restore/delete/default promotion, tempo/meter/length/capo/sequence; labeled key CRUD and inherited key; reference protection, concurrent revision conflict preserves draft | W M A D |
| SONG-03 | librarian / D10 | Bulk metadata preview/commit and duplicate-song merge; inspect moved references/history and collision resolution; stale/unauthorized/malformed batch atomic; plan overrides survive | W A D |
| CHART-01 | librarian/member/planner / D10 | Source editing, sections/sequence, dirty close/back, save/failure/stale rebase; chord alignment/transposition/capo/notation/format/fonts/columns; unsupported transformation explicit | W M A |
| CHART-02 | planner/member / D04 D10 | Same effective chart in library vs plan, reader shift, nondefault arrangement, plan-only sequence; web/native PDF text/layout/chords/copyright/Unicode/page breaks match meaning and share correct document | W M native PDF/share |
| IMPORT-01 | owner/librarian/denied roles / D03 D10 D17 | Structured People/song CSV dry run, header mapping, quoted/newline/BOM/duplicate/invalid rows, preview conflicts, commit idempotency and atomicity, review history; People import cannot bypass owner-only rights | W A D |
| IMPORT-02 | authorized user / D10 D17 | Exercise any currently exposed AI/text import path with test adapter: quota, unavailable provider, malformed result, user review/cancel and duplicate retry; removed OCR is not an expected feature | W A D |
| FILE-01 | media-editor/planner/member / D11 | Every supported parent: plan/item/song/arrangement/key/media/service-type default; file/photo/link/text upload intent→PUT→finalize, progress/cancel/retry, unfinished cleanup; unfinalized content not ready | W M A D S |
| FILE-02 | each audience/outsider / D05 D11 | Organization/team/position/restricted audiences and release visibility; download/stream/export rights; raw Storage URL/object policy, wrong parent/file ID, expired signed URL and renewed authorization | W M A D S |
| FILE-03 | authorized editor / D11 | v1→v2 replace, metadata/audience/link-URL edits, pinned-version link vs latest, archive/restore and text-document revision; concurrent finalize/version race; stale/removed membership refuses future renewal | W M A D S |
| MEDIA-01 | authorized reader/editor / D11 | Web bundle create/edit/archive and supported restore/delete, search bundle library, bundle files/usage, link/change/clear regular item media; invalid item kind or stale revision refused; read-only native bundle metadata remains read-only where designed | W M A D |
| REHEARSE-01 | confirmed/member/planner / D04 D10 D11 | Authorized manifest follows plan order/effective arrangement/key/sequence; excluded/unsupported files truthful; selected track, play/pause/seek/repeat/next/previous/mini-player, link expiry recovery | W M A S |
| REHEARSE-02 | native musician / D11 D16 | Background/lock-screen controls, audio interruption/headphones/Bluetooth/app background/termination, streamed/offline tracks, playback speed 0.5×–1.25× with pitch preservation and correct tempo hint | M physical iOS/Android |
| OFFLINE-01 | member, multi / D11 D16 | Opt-in pack download, range resume/restart, network loss, byte-size/integrity checks, insufficient space/cap, cancel/retry; no pack ready before durable complete files; cold-start offline playback | M A S physical devices |
| OFFLINE-02 | old/new user, revoked member / D16 | 24-hour recheck expiry, newer file/manifest, changed rights, org/account switch/signout; ready/stale/failed/expired states, selected/all deletion; private packs never cross identity | M A S |
| STAGE-01 | planner/member / D04 D11 | Web layout create/edit/duplicate/delete and plan association, positions/gear/labels, viewer permissions, persistence/print if exposed; separate plan cannot overwrite library layout unexpectedly | W A D |
| SCAN-01 | iOS editor / D11 | Camera/Photos allow/deny/cancel, multipage review/reorder/remove, PDF creation then ordinary upload/finalize; oversized/empty failure recoverable; no OCR promise | M physical iOS A S |

### H. Live, attendance, reports, calendars, publication, integrations — F12 / F16 / F17

| ID | Actors / data | Actions and expected results | Surfaces |
|---|---|---|---|
| LIVE-01 | controller/viewer/outsider / D04 | Pick occurrence/start, current/next/countdown/elapsed, advance/pause/resume/jump/end as supported; viewer cannot control, only permitted notes shown; server timestamps authoritative | W M A D |
| LIVE-02 | two controllers/viewers / D04 D16 | Lease expiry/takeover, simultaneous commands, same command retry, stale revision, poll/network loss/background/reconnect; one winning action and synchronized final state | W M A D physical devices |
| LIVE-03 | controller / D04 D14 | Second service occurrence independent, run snapshot vs later plan edits, actual-time history/correction actor and planned-vs-actual; end/leave stops active Live notifications | W M read-only history where designed A D J |
| ATTEND-01 | leader/unauthorized team / D14 | Select occurrence/team, individual/batch present/absent/unknown, correction audit and stale save; multiple positions count one Person per occurrence; confirmed-but-absent stays absent | W M A D |
| REPORT-01 | authorized roles / D14 | All five report kinds: staffing, participation, song_usage, run_times, schedule; staffing/response/serving/attendance/song/actual timing metrics, ranges/team/type/status/archive/rehearsal filters and role-redacted detail; compare exact fixture totals, denominators, recorded unknown vs unmarked | W M schedule report A D |
| REPORT-02 | report user / D14 D17 | Print/CSV/share/tracked export, queued/ready/failed/retry/download/expiry; pagination does not truncate full export; Unicode/quoting/formula-like cells, audiences, filename/timezone correctness | W M A D J S |
| CAL-01 | member/leader/multi / D04 D06 D08 | Calendar/agenda filters by team/type/service/rehearsal; blockout/birthday/anniversary layers and separate personal sharing opt-ins; status/timezone/date bounds correct; prepared/private data absent; filter/navigation persistence and empty days | W M A D |
| CAL-02 | member/leader/anonymous / D15 | Personal/team/service feeds as supported; create/read/rotate/revoke/copy/subscribe/share; confirmed and unconfirmed commitments retained per current product decision; removed/redated assignments update UIDs/events correctly | W M A D P |
| PUBLIC-01 | planner/anonymous / D05 D15 | Opt-in plan and set-list publication, selected fields, now vs service-day scheduling, upcoming/recent service-type link create/rotate/revoke, slug routes `/p/:slug`, `/s/:slug`; refresh/revoke/unpublish/expired links; minimal projection excludes private notes/contacts/prepared assignments and restricted materials | W A D P |
| ORGS-01 | multi/leader / D01 D08 D16 | Combined schedule and busy-sharing separately opt in/out; per-org timezone/error/revoked/stale state; target action reauthorizes after switch; other schedulers see busy only; reviewed blockout-copy retry idempotent | W M A D |
| API-01 | owner/admin/API client / D15 | Credential create once-only secret display, list/expire/revoke/rotate, scopes and organization ceiling; bearer validation/rate limits/pagination; forbidden write/read surfaces unavailable | W A D P |
| HOOK-01 | owner/admin/controlled receiver / D15 | Webhook register/validate/revoke, selected events and minimal payload, signature/timestamp/replay checks, retry/backoff/duplicate event ID/dead-letter, concurrent workers; no tokens/private fields in logs | W A D J P |
| GATED-01 | all / deferred list | Disabled songbook routes redirect to library; dormant API contracts tested separately. Unselected provider/platform/features absent or explicitly gated, never mocked as successful shipped workflows | W M A |

### Web route coverage map

These groups cover the router's public and authenticated pages. Every page also inherits AUTH-04, relevant permission cases, and the cross-cutting form/list/error/UX checks.

| Web routes | Primary cases / nested controls |
|---|---|
| `/login`, `/welcome`, `/accept-invite`, `/respond` | AUTH-01–03, PEOPLE-03, RESP-03; auth/onboarding/token forms |
| `/` | AUTH-04, RESP-01–02; dashboard counters, pending response actions and plan links |
| `/calendar`, `/my-schedule` | CAL-01–02, RESP-01–04, AVAIL-01, OPPORT-01, REPLACE-01 |
| `/plans` | PLAN-01–02; folder/type browser, filters, create/copy/import controls |
| `/plans/:planId` | PLAN/TIME/ORDER/STAFF/RELEASE/NOTE/FILE/REHEARSE/ATTEND/PUBLIC cases; every workspace tab/sidebar/modal/action |
| `/plans/:planId/live` | LIVE-01–03; controller, viewer, stage display, history |
| `/plans/matrix`, `/plans/proposals`, `/plans/releases` | MATRIX-01, PROPOSE-01–02, RELEASE-01–02 |
| `/plans/templates`, `/plans/generate`, `/plans/reschedule` | TEMPLATE-01–03; save/apply/generate/reschedule review and commit |
| `/service-types/new` | TYPE-01; every wizard step, back/cancel and atomic setup |
| `/songs`, `/songs/:songId` | SONG-01–03; metadata/arrangements/keys/tags/notes/schedule/bulk/merge panels |
| `/songs/:songId/arrangements/:arrangementId/chart` | CHART-01–02; source/preview/sequence/formatting/PDF workspace |
| `/imports` | IMPORT-01–02; dry-run mapping, saved job, history, commit |
| `/songbooks/*` | GATED-01; redirects. API list/detail/create/delete and song-reference validation get dormant-contract regression coverage |
| `/media`, `/media/:mediaId` | MEDIA-01, FILE-01–03; bundle editor/files/usage |
| `/teams` | TEAM-01–02, ACL-04, AVAIL-03; editor/positions/roster/policy/access/availability-request controls |
| `/people`, `/people/new`, `/people/:personId` | PEOPLE-01–05, ACL-03; list/bulk/tags/private record/invitation/history/sharing/avatar controls |
| `/messages`, `/messages/:messageId` | MESSAGE-01; recipient preview, template management, delivery history/retry |
| `/chat`, `/chat/:conversationId` | CHAT-01–02; thread actions, moderation and membership boundaries |
| `/reports` | REPORT-01–02, ATTEND-01; all five report kinds, filters, print/CSV/tracked exports |
| `/settings` | PROFILE-01, AUTH-02–03, ACL-01–04, PEOPLE-05, AVAIL-01–03, DELEGATE-01, ORGS-01, CAL-02, REMIND-01, DELIVERY-01, API-01, HOOK-01, FILE-01–03; profile/language/appearance/org/access/folders/delivery/integrations/reconciliation/availability/default-files settings |
| `/settings/blockouts/:seriesId`, `/help/:delegationId` | AVAIL-02, DELEGATE-01; series maintenance and granted-person workflow |
| `/p/:slug`, `/s/:slug`, wildcard | PUBLIC-01, AUTH-04; anonymous projection and safe unknown-route fallback |

API-only secondary controls must also be inventoried from `ServiceCenterApi` and mounted routers, even if a UI route is disabled. In particular: roster audit/tag catalog/groups/readiness/reconciliation, saved matrix views, message templates, note categories, scoped feeds/calendar sharing, notification counts/device leases, health status, file link/document metadata, and dormant songbook contracts. Map each supported method to the corresponding feature case; do not claim that route coverage alone covers every operation.

## 6. Mobile route and platform acceptance matrix

This matrix prevents native navigation and OS behavior being inferred from web tests. Shared case IDs above are rerun through the listed native screens, with authorized and denied actors. Route groups are relative to `mobile/app/`.

| Mobile task(s) | Native routes / entry points | Cases and additional device assertions |
|---|---|---|
| MOB-001 | `(tabs)/_layout`, shared components, every screen | AUTH-04 + UX suite; readable brand/status colors, both themes, safe areas, keyboard, native touch targets |
| MOB-002 | `plan/[id]` → `song/[id]`, `song/chart`, arrangement picker | ORDER-03, CHART-02; Back preserves plan context, no override leaks to another plan |
| MOB-003 | `(auth)/login`, `accept-invite`, `respond`, `open/plan/[id]`, `link-result`, `_layout`, `+not-found` | AUTH-01/03, PEOPLE-03, RESP-03, PUSH-01; cold/warm/background HTTPS/custom-scheme links, signed-in wrong org/account, offline and removed target |
| MOB-004–005 | `(tabs)/index`, `plan/[id]`, response sheets | RESP-01–04, ACL-05; grouped/split review, reasons, withdrawal, stale preview, unknown save outcome |
| MOB-006–007 | profile availability, BlockoutForm, `team-preferences` | AVAIL-01–03, TIME-03; native pickers, all-day, recurrence handoff, failed save retains draft |
| MOB-008 | `plan/[id]` Teams, `plan/schedule/[id]` | STAFF-01–02, ACL-04; need counters, candidate/guest search, explicit permitted override |
| MOB-009–010 | `opportunities/index`, `opportunities/[id]`, `replacements/index`, `replacements/new`, `replacements/[id]` | OPPORT-01–02, REPLACE-01–02; approval/consent tracking refresh and accurate capacity after competing action |
| MOB-011 | `help/index`, `help/[id]`, delegated response/availability/signup entry points | DELEGATE-01; independent capabilities, safe handoff and revocation during review |
| MOB-012 | `(tabs)/plans`, `plan/[id]` | PLAN-01; paged history and stable previous/next; inaccessible tabs and direct routes fail safely |
| MOB-013 | `plan/new`, `plan/generate`, `plan/apply-template/[id]` | PLAN-02, TEMPLATE-01–02; new-plan defaults, review count, partial/unknown failure; bulk reschedule stays web workflow |
| MOB-014 | `plan/add-item/[id]`, `plan/edit-item/[id]`, PlanOrder | ORDER-01–04; alternate move controls, dirty back/save, selected arrangement/key/sequence |
| MOB-015 | `plan/times/[id]`, PlanReminders | TIME-01–03, REMIND-01, DELIVERY-01; stable IDs, time-impact review and truthfully labeled delivery |
| MOB-016 | `plan/note/[id]`, `plan/item-notes/[id]`, PlanNotes | NOTE-01; audience selection/readability, stale edit and forbidden category |
| MOB-017 | `plan/attendance/[id]` | ATTEND-01; correct selected occurrence and team, batch review, offline not shown as saved |
| MOB-018 | `messages/index`, `messages/[id]`, `messages/compose` | MESSAGE-01–02; device composer cancel/missing handler never treated as delivery |
| MOB-019 | `chat/index`, `chat/[id]`, `(tabs)/inbox` | CHAT-01–02; thread pagination, keyboard, one retry identity, mute/unread and exact notification destination |
| MOB-020 | `notification-settings`, `notifications`, NotificationBell | NOTIFY-01, PUSH-01, REMIND-01; app badge setting/OS denied recovery, in-app fallback independent of push |
| MOB-021 | `(tabs)/profile`, `about` | Own profile/avatar/language, org switch, light/dark/system persistence, reset-to-system, app version/help and signout; cache controls with offline suite |
| MOB-022 | `(tabs)/calendar`, `calendar-subscription`, `schedule-report` | CAL-01–02, REPORT-02; iOS/Android subscription/share behavior and raw-token secret handling |
| MOB-023 | `plan/live/[id]` | LIVE-01–03; viewer/controller roles, background/reconnect/takeover, read-only history |
| MOB-024–025 | `plan/rehearse/[id]`, `offline-downloads`, OfflineLibrary | REHEARSE-01–02, OFFLINE-01–02; cold offline launch, background audio, local file and account isolation |
| MOB-026 | `files/add`, `files/[id]`, PlanFiles, SongFiles | FILE-01–03; file/photo picker permissions, upload cancellation, preview/share copy cleanup, URL renewal |
| MOB-027 | rehearsal speed controls | REHEARSE-02; 0.5×/1×/1.25× streamed/offline, heard-tempo label, no unsupported pitch/loop features advertised |
| MOB-028 | `(tabs)/songs`, `song/new`, `song/edit/[id]`, `song/arrangement`, `song/duplicate`, `song/keys`, `song/[id]` | SONG-01–02; >100 pagination, archive/filter, drafts scoped to identity, stale revision rebase |
| MOB-029 | `song/chart`, ChartPdfActions | CHART-01–02; real exported text PDF, large chart performance, preview/share in effective plan context |
| MOB-030 | `media/index`, `media/[id]`, `plan/media/[id]`, ScanPages in `files/add` | MEDIA-01, SCAN-01; native media metadata restrictions, iOS reviewed PDF upload; Android no scan promise |
| MOB-031 | `people/index`, `people/[id]`, `teams/index`, `teams/[id]` | ACL-03–04, PEOPLE-04, TEAM-01; nonowner route denial, permitted directory fields, roster ID correctness, self-edit on profile |
| MOB-032 | `across-organizations` | ORGS-01; distinct opt-ins and target reauthorization; no cross-org detail leakage |
| MOB-033 | iOS small/medium/lock-screen widget → `open/plan/[id]` plan/rehearse intent | WIDGET-01 below; installed extension and app-group behavior, not Expo Go |

### Native-only additional cases

| ID | Data / action | Expected result |
|---|---|---|
| WIDGET-01 | D16; small/medium/lock-screen, no assignments, next plan, prepared-only, app terminated, 12-hour expiry | Minimal authorized snapshot, correct state and language, prepared excluded, expiration visible without keeping JS alive |
| WIDGET-02 | Change account/org, sign out, revoke membership or next-plan rights, tap old snapshot | Snapshot cleared/refused as supported; validated ingress reauthorizes before showing plan or rehearsal; another identity's content never opens |
| NATIVE-01 | Every picker/composer/link flow; deny then grant camera/photos/notifications; app background during operation | Recoverable state, truthful result, no double submit or lost draft, safe temporary file cleanup |
| NATIVE-02 | Physical iOS and Android; airplane mode before launch/read/save, loss after server commit, reconnect | Clear stale/offline/unknown status, no unsupported offline mutation queue, safe reread/retry and identity isolation |

## 7. Cross-cutting UX, localization, security, and resilience

| ID | Required coverage | Acceptance |
|---|---|---|
| UX-01 | Web desktop and narrow layout; iPhone/Android phone and tablet layout; light/dark/system; portrait supported orientation | No hidden controls, clipped content, unreadable status, unsafe area overlap, or keyboard-blocked action |
| UX-02 | Web keyboard/focus/dialogs; VoiceOver/TalkBack; large text, contrast/status alternatives and reduced motion | Critical flows operable, errors announced, focus restored, icon buttons labeled, status not conveyed by color alone |
| I18N-01 | English/Vietnamese/automatic, unsupported locale fallback, per-Person per-org preference, late saves after switch | Correct precedence and persistence across web/native refresh; detected language never silently saved; raw translation keys absent |
| I18N-02 | 0/1/many, Vietnamese names/diacritics, long labels, timezone/date/number format, PDFs/print/CSV/calendar and concurrent recipient deliveries | Content not corrupted or shifted; captured delivery locale stable on retry; user-authored content preserved; Vietnamese-speaker review separately recorded |
| SEC-01 | D17 strings in songs/notes/chat/imports/public views/email/PDF; invalid files/links/MIME/size | Escaping and validation prevent executable content; error/logs contain no passwords, raw tokens, private bodies, or provider credentials |
| SEC-02 | Public tokens/feeds/API keys, raw Storage, forged foreign IDs, expired/revoked/inactive identities, rate limiting/CORS | Least disclosure, caller-level denial and no bypass through another route, export, cache or object URL |
| RES-01 | Inject 4xx/5xx/timeouts/offline/provider failure/storage error and lost success reply | Drafts survive; rollback/partial outcome follows documented contract; same-key retry or reread resolves ambiguous result |
| PERF-01 | D17 lists/search/matrix/order/report/chat and native long charts/downloads, cold start | Record p50/p95 and dataset/device/network; propose target budgets at kickoff; no unbounded request, duplicate page, main-thread freeze or silent truncation |
| SYNC-01 | Web create→native read/edit→web reload for plan/time/order/assignment/note/song/file/attendance/profile; both edit concurrently | Shared IDs/revisions/state agree; stale update refused, not silently lost; appropriate caches invalidate |

Run the complete happy path for every feature in English on web, iOS, and Android where supported. Repeat critical account/response/planning/playback/file flows in Vietnamese, both themes and large text. Record a role × action × surface matrix so sampling does not accidentally replace required permission checks. Platform-specific exclusions require an explicit reason.

## 8. Concurrency tests that require real separate sessions

Use barriers or explicit synchronization, not timing guesses. Reset the relevant clone for each permutation. Inspect final rows, revisions, history, outbox jobs, holds and UI reconciliation. Passing sequential requests is not evidence for a race.

| Race | Case IDs | Invariant |
|---|---|---|
| Token answer vs token/authenticated answer; assignment/time edit vs response | RESP-03–04 | One valid reviewed scope, no replay/new-scope answer or mixed batch |
| Final-slot signup vs signup/manual/replacement | OPPORT-02 | Occupancy + valid reservations never exceeds required capacity |
| Replacement acceptance/approval/expiry/manual fill | REPLACE-02 | One final replacement; original decline retained; consent/approval exact |
| Matrix/proposal/template/generation/reschedule commits | MATRIX-01, PROPOSE-02, TEMPLATE-01–03 | Stale previews rejected, all-or-nothing writes, same-key retry once |
| Release/release/edit and multiple workers | RELEASE-02, DELIVERY-02 | Exact snapshot and deduplicated effects; honest ambiguous provider outcome |
| Item create/reorder/edit | ORDER-02 | Stable unique order, one item per create attempt, no lost edits |
| Live lease/command/takeover | LIVE-02 | One authoritative controller transition, monotonic revision |
| File finalize/version, song merge/bulk/import, attendance batch | FILE-03, SONG-02–03, IMPORT-01, ATTEND-01 | Consistent version/reference/audit and no partial atomic write |
| Chat retry/concurrent send, webhook claims | CHAT-01, HOOK-01 | Stable logical IDs and retry behavior without duplicate records |

Existing `supabase/tests/*concurrent*.sh` and corresponding SQL tests are starting points; inspect their environment assumptions and reset behavior before execution. Model/mocked tests do not replace these real database sessions.

## 9. Future agent assignments and dependencies

Do not launch agents as part of this planning task. The following are ready-to-assign work packages. Each package produces independent case results and evidence, not just a prose “looks good.” Use at most six testing agents plus one coordinator at a time, and fewer when physical devices or isolated workers are the constraint.

| Package | Assignment | Case ownership | Data / prerequisites |
|---|---|---|---|
| QA-00 | Fixture/environment bootstrap and manifest | Seed loader, route/action inventory, smoke prerequisites, data validation | All D datasets; runs first; no feature pass claims |
| QA-01 | Auth, access, tenant isolation | AUTH-01–04, PROFILE-01, ACL-01–06, SEC-02 auth/tenant portion | D01–03, D05, D15 |
| QA-02 | People, teams, service types | PEOPLE-01–05, TEAM-01–02, TYPE-01 | D02–03, D15, D17; owner-only rule |
| QA-03 | Plans, times, templates, running order | PLAN-01–02, TIME-01–03, TEMPLATE-01–03, ORDER-01–04 | D04–06, D09–11 |
| QA-04 | Staffing matrix and proposals | STAFF-01–02, MATRIX-01, PROPOSE-01–02 | D03–04, D06, D08–09 |
| QA-05 | Volunteer responses and capacity | RESP-01–04, OPPORT-01–02, REPLACE-01–02, SWAP-01 | D04–07, D15; owns isolated race clones |
| QA-06 | Availability, delegation, combined orgs | AVAIL-01–03, DELEGATE-01, ORGS-01 | D01, D06, D08, D16 |
| QA-07 | Release, reminders, durable delivery | RELEASE-01–02, REMIND-01, DELIVERY-01–02 | D05, D13; isolated worker/mail sink |
| QA-08 | Notes, messages, chat | NOTE-01, MESSAGE-01–02, CHAT-01–02, NOTIFY-01 | D12–13; controlled handoffs |
| QA-09 | Song library, chart authoring, imports | SONG-01–03, CHART-01–02, IMPORT-01–02, GATED-01 songbooks | D03–04, D10, D17 |
| QA-10 | Files, media, stage, rehearsal contracts | FILE-01–03, MEDIA-01, STAGE-01, REHEARSE-01 | D04–05, D10–11 |
| QA-11 | Live control, attendance, metrics | LIVE-01–03, ATTEND-01, REPORT-01 | D04, D14, D16; isolated Live occurrences |
| QA-12 | Calendar, export, public projection, integrations | CAL-01–02, REPORT-02, PUBLIC-01, API-01, HOOK-01, remaining GATED-01 | D06, D14–15, D17; controlled webhook receiver |
| QA-13 | Native workflow parity and navigation | Entire mobile route matrix, SYNC-01; native reruns of QA-01–12 cases | Private native fixture pair; links configured; does not overwrite web-agent results |
| QA-14 | Physical-device and offline behavior | PUSH-01, REHEARSE-02, OFFLINE-01–02, SCAN-01, WIDGET-01–02, NATIVE-01–02 | D11, D13, D16; signed native builds and devices |
| QA-15 | Accessibility, localization, resilience/performance | UX-01–02, I18N-01–02, SEC-01, RES-01, PERF-01 | D17; actual language review; feature owners assist failure injection |
| QA-16 | Cross-feature acceptance and final report | Journey cases below, coverage reconciliation, defect retest/cleanup | Core packages available; every blocker retained in report |

Suggested waves:

1. Coordinator freezes scope; QA-00 validates isolated environments, manifests, seed/reset and controlled transports. Each agent's baseline is checked before handoff.
2. QA-01–06 run with independent datasets. A native build/link/device feasibility check starts before broad native execution so missing prerequisites are discovered early.
3. QA-07–12 run. Coordinator serializes anything that would share a global worker, provider quota or receiver state.
4. QA-13–15 run native/platform/UX matrices using fresh clones, with feature owners available to explain contracts. Device work can overlap earlier waves once its prerequisites are ready.
5. QA-16 reconciles inventory and results, reruns failed cross-client journeys after fixes, and produces the release recommendation. No claim of full coverage while a required native/provider test is blocked.

### Standard agent brief

```text
Task: Execute package QA-xx from docs/plans/admin-mobile-test-plan.md.
Frozen commit/build/migrations/configuration: <manifest reference>.
Own organizations/accounts/resource namespace: <run + agent>.
Owned case IDs and UI routes: <explicit list>.
Prerequisites and role-specific data: <dataset keys + credential channel>.
Expand every owned row by action, actor, surface and required negative/failure case.
Use caller credentials for permission checks; privileged setup is not permission evidence.
Do not change implementation or reset another agent's fixtures.
Report PASS/FAIL/BLOCKED/NOT_RUN/NOT_APPLICABLE for each expanded case.
Capture redacted evidence and persisted-state assertions; file reproducible defects.
Return result manifest, defect links, uncovered actions, blockers and cleanup state.
```

## 10. End-to-end acceptance journeys

| ID | Sequence | Required final evidence |
|---|---|---|
| JOURNEY-01 | Owner creates type/team/Person → planner creates plan/template/order → leader prepares assignments → release → mobile member answers → web sees staffing | Same resource IDs and exact reviewed response scope; no premature visibility; one logical notification and history chain |
| JOURNEY-02 | No-login guest scheduled → localized response link → later invitation/account join → native schedule/profile opens | Same Person/history/answer/language survives; invitation never substitutes for assignment |
| JOURNEY-03 | Member creates blockout → leader sees redacted conflict → authorized override → member declines → replacement candidate consents + leader approves | Audited override; original decline intact; one new assignment, exact times and no overfill |
| JOURNEY-04 | Librarian changes arrangement → planner chooses plan-only key/sequence → uploads authorized chart/audio → mobile rehearses/downloads → offline cold launch | Correct chart and playlist context, permissions/version/expiry and no cross-account pack |
| JOURNEY-05 | Web controller starts first occurrence → mobile viewer/controller takeover → network interruption/reconnect → attendance correction → report/export | One Live state, independent occurrence history, audited attendance and exact metrics |
| JOURNEY-06 | Multi-org user opts in → views combined schedule/feed/widget → changes org/signs out → old push/widget/deep link arrives | Reauthorization and cleanup; no previous identity/org data exposed |
| JOURNEY-07 | Private/prepared notes/files/assignments → publish public plan/set list and issue scoped feed/API credential → revoke | Minimal projection throughout; unauthorized fields unavailable in page/API/Storage/export; revoked access fails |

## 11. Environment and verification checklist for later execution

| Area | Requirement / checks to run later |
|---|---|
| Repository | Record commit, branch and working-tree changes; do not include unrelated local edits in test fixes. Use current `package.json` engine requirements; older guidance mentioning Node 20 is stale relative to the package manifest |
| Database | Disposable local/QA Supabase with full migration replay; check migration history against deployed build before fixtures; no reset of a linked/shared project |
| Baseline commands | `npm run typecheck`, `npm test`, `npm run build`, `npm run i18n:check`; these are planned checks, not executed results |
| Test meaning | Root scripts build shared first; backend/shared/mobile have tests, frontend currently has no test script. A green root test command does not prove web UI behavior |
| Database suites | Relevant `supabase/tests/*.sql` and concurrency shell scripts, owner People/roster/device token/i18n suites; inspect prerequisites, use disposable environment and per-script exit status |
| Native bundles | Export/build both iOS and Android from frozen source. Bundle success does not establish native behavior |
| Device QA | Record OS version/model/build/runtime. iOS physical phone + iPad layout; Android physical phone + tablet layout/emulator as available. Physical native checks remain required for push/audio/share/widgets/permissions |
| Links | Correct test domain, association files, iOS bundle ID/Android package/signing and installed build; verify cold/warm launch and browser fallback. Expo Go alone cannot validate universal links/widgets/background configuration |
| Workers/transports | Controlled email/push/webhook adapters, worker scheduling/leases and clocks, provider failure injection; distinguish simulated, accepted and actual delivery |
| Files/storage | Buckets/policies, test-owned sample artifacts, supported MIME/limits, temporary-file cleanup and disk-space scenarios |
| Observability | Capture browser console/API correlation IDs/server errors/worker state without secrets or private message bodies; preserve enough timing for concurrency reproduction |

## 12. Result format, release gates, and cleanup

Each expanded case must contain:

```text
Case ID: <e.g. ACL-03.admin.GET-person.API>
Package / feature IDs / route or action:
Priority:
Actor alias / org / capability snapshot:
Commit / build / OS / browser / migration / feature configuration:
Dataset version / resource logical keys / initial revisions / clock:
Preconditions and exact test data:
Steps:
Expected UI / response / persisted state / side effects:
Actual result:
Status: NOT_RUN | PASS | FAIL | BLOCKED | NOT_APPLICABLE
Evidence: <redacted screenshots/log assertions/query snapshots/artifact reference>
Defect ID or blocker / reason for N/A:
Reset and cleanup state:
```

Defects include minimal reproduction, expected vs actual, role and scope, affected clients, impact, evidence, and fixture manifest. Escalate cross-tenant disclosure, private/prepared data exposure, lost writes, response scope corruption and capacity overfill immediately to the coordinator. Preserve the failing clone until evidence is captured.

Execution completion requires:

- Every current web page, native route, nested modal/tab/action, API feature and F00–F17/MOB-001–MOB-033 slice is linked to owned cases or an explicit deferred item. QA-00 inventories controls and API methods at the frozen commit and adds newly discovered actions to this plan's matrix before testing closes.
- Every role and permission variant has positive and negative evidence; owner-only People and legacy roster restrictions have UI/API/RLS checks; Storage and public projections pass their audience checks.
- All P0 and supported P1 cases pass. Any remaining failure/blocker is explicit and prevents claiming complete testing; a release exception is a separate owner decision. Required physical-device/provider gates cannot be waived by a passing mocked test.
- All relevant static/unit/integration/concurrency checks pass, cross-client journeys pass, critical defects are retested on the candidate build, and coverage is reconciled across web/iOS/Android.
- Reports distinguish executed counts, failing counts, blocked/not-run counts, scoped platform exclusions, deferred features and historical results. No blended “all passed” summary.
- Cleanup follows manifest ownership: revoke test tokens/credentials/device registrations/webhooks, cancel jobs, delete run-owned objects/storage/uploads and auth identities in safe dependency order, remove local packs/widget snapshots/drafts. Keep only redacted reports and reproducible fixture definitions.

### Explicit deferred or gated scope

Inventory these items during kickoff; if the frozen implementation now supports one, add real cases and assign it. Otherwise verify no misleading enabled UI and report it as deferred, not failed or passed functionality.

| Item | Current planning treatment |
|---|---|
| Songbooks | Web routes intentionally redirect to Songs; existing API/shared contracts get backend regression coverage, not invented native songbook routes |
| F05 Order Matrix extension | Not started in ledger; staffing Matrix is in scope |
| F10 remaining series/title/artwork/default-copy extensions | Only implemented generation/template/reschedule slices in scope |
| F11 anchors/simultaneous groups/collapsible sections/per-time item extensions | Check frozen code; remaining unstarted slices deferred. Implemented media linking is covered separately |
| F12 dedicated run chat/public limited display/cross-plan actual-time reports/controlled rebase | Remaining ledger slices deferred; authenticated stage/Live display and per-run history are covered |
| F16 custom report designer | Unselected; built-in reports and tracked exports in scope |
| F17 licensed catalogs/CCLI product integrations/presentation handoffs | Unselected; scoped developer API and signed webhooks in scope |
| Native bulk reschedule | Web workflow; mobile supports implemented single/generate/template actions |
| Native audio pitch/key transform, A–B loop, metronome, CarPlay/Android Auto/Siri | Unselected; implemented speed controls are in scope |
| Android scanning/widget stage and removed OCR | Not assumed supported. iOS reviewed PDF scan and iOS widgets are in scope |

