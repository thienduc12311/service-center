# Mobile feature comparison and implementation tasks

Date: **2026-10-15** · Baseline: `7f682d34a3643b635192bc20f53820885805d819` plus the UI changes in this working tree · Branch: `codex/mobile-parity-and-ui`

Read with the [mobile specification](../specs/mobile-feature-specification.md) and [mobile research reference](../research/planning-center-services-mobile-reference.md). This supplements the [overall Services plan](services-feature-gap-plan.md); it does not replace its backend dependencies. Tasks here are a repository backlog, not new Codex chats or published issue-tracker tickets.

Step-by-step implementation prompts for **MOB-001 through MOB-010** are in the [first ten mobile tasks prompt pack](../prompts/mobile-first-10/README.md). Use one task or bounded pass per model invocation; MOB-001 starts with verification of the existing theme work.

The [remaining mobile prompt pack](../prompts/mobile-remaining/README.md) covers **MOB-011 through MOB-033**. Shared backend/web prerequisites are covered by the separate [missing Services capabilities prompt pack](../prompts/services-capabilities/README.md); both packs reuse the same implementation and progress evidence.

## Findings and immediate result

The current native app supports authentication, organization invitations/switching, personal assignment cards with individual responses, a month-bounded agenda, song search, default-arrangement chart reading/transposition/notation, manual/document songbooks, profile edits, one-off date-range blockouts, notifications and optional Expo push. It does not yet expose the website's plan/team/people editing workflows. Some missing mobile experiences can use existing APIs; others need shared backend capabilities that are missing on both clients.

The requested UI change **is implemented in this working tree**: the mobile-specific warm/serif/monochrome theme and decorative ruled backgrounds were replaced; custom editorial fonts were removed; mandatory staggered entry motion was removed. Website and mobile now consume one shared color/radius definition, use indigo primary actions, slate surfaces, system sans-serif UI text, and matching semantic assignment colors in light/dark modes. Website styling is the reference; Planning Center branding is not being copied. Device visual QA remains separate from compilation/export verification.

## Evidence and scope

The supplied [Services Mobile category](https://help.planningcenter.com/en/143018-services-mobile.html) parses as a shell. Research follows official native procedures in leaf articles: **32 capability groups, 39 official sources**. Mxx links below resolve to their source register. The review is static source comparison plus the checks recorded below; there was no authenticated Planning Center device test.

**Present** = a working source path exists, not proof of production configuration. **Partial** = useful components exist but the workflow is incomplete. **Missing** = no current native workflow was found. **Extension** = a Service Center choice beyond verified native reference behavior. **Existing API** = route/client support exists but still needs permission/error/concurrency validation; it is not a guarantee that backend changes will never be needed.

### Current implementation evidence

| ID | Source / boundary |
|---|---|
| <a id="mc01"></a>MC01 | [Mobile navigation](../../mobile/app/_layout.tsx), [tabs](../../mobile/app/(tabs)/_layout.tsx), [AuthProvider](../../mobile/src/providers/AuthProvider.tsx), [native link configuration](../../mobile/app.config.js): no Plans/People/Teams authoring screens; accept-invite exists; public assignment response has no native route. |
| <a id="mc02"></a>MC02 | [Schedule cards](../../mobile/app/(tabs)/index.tsx), [plan viewer](../../mobile/app/plan/[id].tsx), [assignment API](../../backend/src/routes/assignments.ts), [web public respond](../../frontend/src/pages/RespondAssignmentPage.tsx): individual responses exist; plan viewer uses the first matching personal assignment; only pending answers have controls. |
| <a id="mc03"></a>MC03 | [Calendar agenda](../../mobile/app/(tabs)/calendar.tsx), [blockout form](../../mobile/src/components/BlockoutForm.tsx), [profile settings](../../mobile/app/(tabs)/profile.tsx), [blockout API](../../backend/src/routes/blockouts.ts): blockouts are date-text inputs converted in device timezone; create/delete only. Calendar UI has all/mine but lacks service-type/team filters and feed setup. |
| <a id="mc04"></a>MC04 | [Song list](../../mobile/app/(tabs)/songs.tsx), [song screen](../../mobile/app/song/[id].tsx), [native chart renderer](../../mobile/src/components/ChordChart.tsx): list is capped at 100 and default arrangement is chosen; plan-to-song navigation passes only song ID, losing selected arrangement/key context. No native song/chart editor. |
| <a id="mc05"></a>MC05 | [Songbooks list/create](../../mobile/app/(tabs)/songbooks.tsx), [songbook detail](../../mobile/app/songbooks/[id].tsx): manual/document collections and external document opening exist. Detail query key contains book ID without organization ID. Songbook upload is not general plan/song attachment support. |
| <a id="mc06"></a>MC06 | [Notifications screen](../../mobile/app/notifications.tsx), [notification provider](../../mobile/src/providers/NotificationsProvider.tsx), [push registration](../../mobile/src/lib/push.ts): feed/unread/read/push exist; tapped pushes navigate to notification list, not an exact plan/thread. No per-type preferences/widget/player/Live infrastructure. |
| <a id="mc07"></a>MC07 | [Shared client](../../packages/shared/src/lib/api-client.ts), [API mounts](../../backend/src/app.ts), [plans](../../backend/src/routes/plans.ts), [teams](../../backend/src/routes/teams.ts), [people](../../backend/src/routes/people.ts), [songs](../../backend/src/routes/songs.ts): server-side CRUD, staffing needs, conflicts, times, simple notes and chart contracts already support several client-only slices. |
| <a id="mc08"></a>MC08 | [Current types](../../packages/shared/src/types/database.ts), [domain](../../packages/shared/src/types/domain.ts), [initial schema](../../supabase/migrations/20260101000000_init.sql), later migrations: prepared-request visibility, assignment attendance subsets, preference/delegation/signups/replacements/chat/runs/attendance are not complete shared workflows. `attachments` table alone is not file lifecycle. |
| <a id="mc09"></a>MC09 | [Shared design tokens](../../packages/shared/src/lib/design-tokens.ts), [native theme](../../mobile/src/lib/theme.ts), [native primitives](../../mobile/src/components/ui.tsx), [web token adapter](../../frontend/src/lib/design-tokens.ts), [web CSS](../../frontend/src/index.css), [web primitives](../../frontend/src/components/ui.tsx). These are the newly unified UI foundation. |

## Mobile-specific gap matrix

| Reference groups | Current mobile state | Native work / shared prerequisite | Tasks |
|---|---|---|---|
| MF01 access/help | **Partial:** login/invitation and organization context present; no in-app help/about. [MC01](#mc01) | Help/about, error recovery, deep links | MOB-003, MOB-021 |
| MF02–03 personal schedule and responses | **Partial:** individual pending cards; no grouped/split/bulk response, reason form or confirmed withdrawal. [MC02](#mc02) | Group by person-plan, complete actions; scoped-time/prepared backend | MOB-004, MOB-005 |
| MF04 replacements | **Missing.** [MC08](#mc08) | Replacement policy/offers and native flow; use deliberate Service Center approval semantics | MOB-010 |
| MF05 signup sheets | **Missing.** [MC08](#mc08) | Eligible opportunity/capacity API and native claim | MOB-009 |
| MF06 household | **Missing.** [MC08](#mc08) | Explicit delegation plus household picker/answers/blockouts/signups | MOB-011 |
| MF07 availability | **Partial:** simple create/delete, date-only device-timezone conversion. [MC03](#mc03) | Native date/time editor, all-day semantics, edit/recurrence, affected requests | MOB-006 |
| MF08 team preferences | **Missing.** [MC08](#mc08) | Preference API and team settings form; general/household preferences remain web handoff initially | MOB-007 |
| MF09–10 plan workspace/history | **Partial:** plan read/respond via schedule/calendar, without service-type plan browser/previous-next/context menus/reports. [MC01](#mc01), [MC02](#mc02) | Plans navigation, details/tabs, history and report share | MOB-012, MOB-022 |
| MF11 plan creation/template apply | **Missing native:** server creates plans; real saved templates also missing. [MC07](#mc07), [MC08](#mc08) | Native plan creation first; multi-date/templates after shared F10 | MOB-013 |
| MF12–13 order/item editing | **Missing native:** read-only items, existing item mutation APIs. [MC02](#mc02), [MC07](#mc07) | Add/edit/reorder, selected arrangement/key, leaders/categories/applicability later | MOB-014 |
| MF14 times/reminders | **Partial:** times rendered only; reminder/attendance subsets missing backend. [MC02](#mc02), [MC08](#mc08) | Time CRUD first; team/time reminder policies and propagation after shared F04/F08 | MOB-015 |
| MF15 plan notes | **Partial:** single notes string rendered. [MC02](#mc02), [MC07](#mc07) | Edit simple notes now; category/team audience after shared F09 | MOB-016 |
| MF16 needed positions | **Missing native:** shared needs API and web UI present. [MC07](#mc07) | Plus/minus counts, capacity/answer display and candidate entry | MOB-008 |
| MF17 scheduling people/guests | **Missing native:** shared create/conflict APIs exist for linked Profiles. [MC07](#mc07) | Candidate picker, conflict/override, release preview; no-login identity needs F02 | MOB-008 |
| MF18 attendance | **Missing shared/native:** confirmations are not attendance. [MC08](#mc08) | Per-plan-time attendance contract and native marking | MOB-017 |
| MF19 email/device text | **Partial:** automatic fixed schedule emails, no mobile composer. [MC06](#mc06), [MC07](#mc07) | Recipient preview/composer/template/history; explicit OS text compose | MOB-018 |
| MF20–21 chat | **Missing shared/native:** bell is a notification feed. [MC06](#mc06), [MC08](#mc08) | Conversation API, member/youth policy, thread UI, mentions/mute/report | MOB-019 |
| MF22 push settings | **Partial:** opt-in registration and unread badge. [MC06](#mc06) | Per-type/channel preferences, correct links, revocation-safe device cleanup | MOB-003, MOB-020 |
| MF23 LIVE | **Missing shared/native.** [MC08](#mc08) | Authoritative service run, viewer/controller/chat/push | MOB-023 |
| MF24 rehearsal player | **Missing:** charts exist, no audio/video player. [MC04](#mc04) | File manifest/player/background controls, later loops/metronome | MOB-024 |
| MF25 offline audio/cache | **Missing:** no durable preparation cache. [MC04](#mc04), [MC06](#mc06) | Explicit download/expiry/storage controls; no offline schedule writes implied | MOB-025 |
| MF26 vehicle playback/Siri | **Missing / optional platform extension.** [MC06](#mc06) | Native media session plus CarPlay/Android Auto feasibility/entitlements | MOB-027 |
| MF27 songs/arrangements | **Partial:** browse/title search/default arrangement read; server CRUD exists. [MC04](#mc04), [MC07](#mc07) | Pagination, arrangement choice, metadata/key/sequence authoring, provider gates | MOB-002, MOB-028 |
| MF28 charts/sequences | **Partial:** transposition/notation read only. [MC04](#mc04) | Native chart editor/PDF/share; item sequence overrides need shared extension | MOB-002, MOB-029 |
| MF29 files/media/scanning | **Partial:** songbook uploads/document opening only. [MC05](#mc05), [MC08](#mc08) | General upload/link/read/share, media browser; iOS scan later; OCR separately decided | MOB-026, MOB-030 |
| MF30 people/profile | **Partial:** own name/phone, org logo/settings; no directory/team/tag editor or profile photo. [MC01](#mc01), [MC03](#mc03) | Scoped directory/detail/team management, own avatar/contact fields | MOB-031 |
| MF31 linked org/calendar subscriptions | **Partial:** organization switching/agenda; feed API exists, native setup absent. [MC03](#mc03), [MC07](#mc07) | Safe cache scope, native subscribe/copy link; aggregate schedule/delegation later | MOB-003, MOB-022, MOB-032 |
| MF32 widgets/theme/settings | **Partial:** light/dark controls; visual theme now shared. [MC03](#mc03), [MC06](#mc06), [MC09](#mc09) | System-following/persisted appearance, cache/about/help, widgets | MOB-001, MOB-021, MOB-033 |

The reference IDs MF01–MF32 and their exact Mxx citations are in the [research inventory](../research/planning-center-services-mobile-reference.md#documented-mobile-capabilities). Its web-only boundaries apply: copying plans, temporary-position authoring, recurring-series edits/deletes, general/household preferences, whole-order clear, adjustable historical date-range lists, songbook generation, media-record authoring and Music Stand features are not all native parity requirements. Existing Service Center native songbooks are retained as a product extension. Native auto-scheduling and new-person creation were not verified in the sources.

## Implementable tasks

Each ID maps to a specification workflow. **P0** correctness/privacy foundation; **P1** core weekly use; **P2** workflow completion; **P3** optional/platform/provider work. Sizes S/M/L/XL are relative complexity, not estimates or dates. All tasks except MOB-001 are **planned, not implemented by this change**. Split each into a dedicated implementation PR; do not couple simple native editors to every later extension of their backend epic.

| ID | Priority / size | Task and implementation surface | Dependency / backend relationship | Acceptance gate |
|---|---|---|---|---|
| MOB-001 | P1 / M | Replace independent minimalism theme with shared web/native tokens, native primitives/nav, no custom serif/forced entry animation | Implemented here; [MC09](#mc09); device QA outstanding | Same brand/status/radius roles in both schemes; readable sans UI; compile/build/export; device visual matrix |
| MOB-002 | P0 / M | Preserve selected plan item arrangement/key/sequence through native chart navigation; arrangement picker | Existing plan/song/chart APIs, F11 | A non-default arrangement in another key opens the correct chart; no cross-plan override leakage |
| MOB-003 | P0 / M | Tenant/session-aware query keys, sign-out cleanup, route/push intent validation and invitation/response deep links | Existing auth/client; shared response-version review F00/F02/F08 | Org A data never flashes in B; response link works without login; no privileged token in logs; stale push safe |
| MOB-004 | P1 / M | Group schedule by plan, show all positions/times, status filters and decline reason/withdrawal UX | Existing per-assignment APIs; grouped atomic contract below | Two positions both visible; partial failure honest; confirmed withdrawal deliberate; retry preserves scope |
| MOB-005 | P1 / L | Native prepared/released and split-time/batch request responses | F01/F02/F04/F08 shared contracts | Prepared excluded everywhere; each answer affects only displayed scope; stale request rejected |
| MOB-006 | P1 / L | Native date/time blockout editor with all-day/edit/recurrence and conflict review | Current create/delete; shared F03 update/series needed | Organization-timezone dates; no DST drift; existing assignments shown; recurrence web handoff clear |
| MOB-007 | P2 / M | Per-team serving-frequency and split-time preferences | Shared F03 | Own permitted preferences only; global blockout vs team warning distinguished; invalid maxima rejected |
| MOB-008 | P1 / L | Team/position needs and candidate scheduling on plan | Existing team/people/needs/assignment/conflict APIs; scoped access F01, Person migration F02 | Review conflicts/notification intent; accurate counts; deny unauthorized action; no silent override |
| MOB-009 | P2 / L | Eligible opening list and signup/approval state | Shared F07 opportunities/capacity + F04 | Simultaneous final-slot claim succeeds once; eligibility and times checked at commit |
| MOB-010 | P2 / L | Decline/replacement request, eligible offers and tracking | Shared F07 | Original answer retained; leader approval or explicit policy; competing offers cannot overfill |
| MOB-011 | P2 / L | Household picker and delegated schedule/blockout/signup actions | Shared F03 delegation and F07 | Another adult requires explicit grant; permission to respond does not imply plan/file access |
| MOB-012 | P1 / M | Permission-aware Plans tab/browser, service-type selection, previous/next history, full plan workspace | Existing list/detail APIs; F01 visibility | Role-gated routes; paginated upcoming/history; same Order/Teams/Rehearse naming as web |
| MOB-013 | P1 / M–L | Create one/many plans and apply saved templates | Single create API now; batch/template needs shared F10 | Date/template preview; no copied confirmations; atomic/idempotent bulk behavior |
| MOB-014 | P1 / L | Native add/edit/reorder order items and choose arrangement/key | Existing item CRUD/order; F11 leaders/sequence/time extensions | Stable IDs, accessible move controls, compatible arrangement, stale-write protection |
| MOB-015 | P1 / M–L | Native service/rehearsal/other time editor and team reminder setup | Times via plan PATCH now; shared F04/F08 for attendance/reminders | Validate ends/start/timezone; impact preview; preserve time IDs; jobs/feeds updated |
| MOB-016 | P1 / S–M | Simple plan-note editor, later categorized/team notes and item leaders | Existing notes string now; shared F09/F11 later | Draft survives error; role/audience enforced; no private note in export/push |
| MOB-017 | P2 / L | Native volunteer attendance by plan time/team | Shared F16 attendance | Present/absent/unknown separate from assignment answer; leader scope and correction audit |
| MOB-018 | P2 / M–L | Team/scheduled-recipient email composer/template preview and OS text handoff | Shared F09 audience/message contracts; OS composer native | Deduplicate/preview audience; explicit Send; canceled OS composer not recorded as sent |
| MOB-019 | P2 / XL | Team/plan conversations, mentions/replies, unread/mute/report; rich/DM later | Shared F09 membership/moderation/youth policy, F13 files | Paginated authorized history; membership rechecked; mentions don't leak; failed send retry identified |
| MOB-020 | P1 / M–L | Per-type push preferences, badge setting, exact target navigation | Existing push/feed; shared preference persistence | Denied OS permission fallback; correct organization/target; sign-out stops old-user delivery |
| MOB-021 | P2 / S–M | Appearance system mode/persistence, account/help/about/cache settings | Current theme selector; F14 cache later | Light/dark/system documented; restart retains selection; help accessible; cache clear bounded |
| MOB-022 | P2 / M | Calendar team/service filters, subscribe/copy flow, plan report share | Existing calendar/feed APIs; shared F16 report generation | Correct platform action; raw URL not logged; rotated feed invalid; print excludes private fields |
| MOB-023 | P2 / XL | Native Live viewer/controller/session chat | Shared F12 authoritative run and F09 chat | One controller/revision; reconnect loads state; split service instances independent |
| MOB-024 | P1 / L | Plan rehearsal manifest/player, mini player/background audio, lyrics/docs/video | Shared F13 file lifecycle + F14 manifest; native audio/video adapter | Correct order/key/files; transport/lock-screen state; unsupported link visible; no unauthorized media |
| MOB-025 | P2 / L | Selective offline rehearsal cache, expiry/download manager | MOB-024; shared file rights/version manifest | Downloaded vs streamed labeled; interrupted download recoverable; user/tenant isolation; storage removal |
| MOB-026 | P1 / L | Native plan/item/song/arrangement/key attachments, preview/upload/link/share | Shared F13 API/Storage audience enforcement | Interrupted upload honest; both REST/Storage restricted; external URL validation; no unexpected external share |
| MOB-027 | P3 / XL | Loops/metronome/audio processing, car integrations/Siri feasibility | Stable MOB-024; verified native modules/platform approval/rights | Real-device foreground/background behavior documented; optional scopes independently gated |
| MOB-028 | P1 / M–L | Song list pagination/filter/history and native song/arrangement/key metadata CRUD | Existing list/song/arrangement APIs; F15 labeled keys/archive later | Browse beyond 100; default preserved; no authorization bypass; provider import opt-in F17 |
| MOB-029 | P2 / L | Native Lyrics & Chords editor, sequence controls and PDF preview/share | Existing arrangement/chart API; F11 item override/F15 keys | Dirty-state save/retry; shared rendering; chords/lyrics/numbers/numerals match web |
| MOB-030 | P3 / M–L | Read existing media library/attach files and optional iOS scan | Shared F14 media; MOB-026; device permissions | No unsupported media-record editor promised; scan explicit; OCR restoration requires separate decision |
| MOB-031 | P2 / L | People directory/contact/detail, own avatar, team membership/tags editors | Existing roster/person/team APIs; scoped fields F01/tags F02 | Minimize sensitive fields, scoped updates, photo permission denial handled; permanent delete not a default action |
| MOB-032 | P3 / L | Opted-in aggregate organizations schedule/availability | Shared F03; MOB-003 isolation | Only current person's authorized data; other-org conflict redacted; per-org actions reauthorized |
| MOB-033 | P3 / XL | Native request/rehearsal/scheduler widgets | Stable schedule/player contracts; iOS/Android extension spike | Prepared hidden; signed-out stale widget cleared; small-widget actions open verified intent |

## Suggested execution order

1. **Foundation:** MOB-001 device review, MOB-002/003 data/navigation correctness. These are small enough to precede large new systems. Existing basic schedule/chart flows remain available.
2. **Existing-API native parity:** MOB-004, MOB-008 (current supported identity), MOB-012, single-plan part of MOB-013, MOB-014, simple-time MOB-015, simple-note MOB-016, MOB-022 existing filters/feed, MOB-028 existing CRUD. Add named shared contracts/stale-write handling where current routes do not yet provide them; do not silently promise atomic bulk behavior over browser-style loops.
3. **Scheduling completion:** shared F01/F02/F03/F04/F08, then MOB-005/006/007/009/010/011/020. Native UI must not simulate missing persistence or rely on a hidden prepared label.
4. **Preparation/communication:** shared F09/F13/F14, then MOB-018/019/024/025/026/029. Order upload → manifest → playback → caching; do not start offline packs before access/version rules.
5. **Execution and selected extensions:** shared F12/F16, then MOB-017/023; complete settings/directory/report slices. Choose MOB-027/030/032/033 individually after platform/provider feasibility and demand. Matrix, stage-layout authoring and custom-report authoring stay web-first.

## Validation record for this change

- Shared/backend/frontend/mobile typechecks passed using installed Node 26.9.0, matching the repository's declared Node 26 minimum.
- Shared + backend + website production build passed. Vite reports an existing large-bundle advisory; this task does not claim a bundle-size optimization.
- Existing tests: 77 shared tests, 44 backend unit/service tests and 8 API smoke tests passed. The first sandboxed API run could not bind a temporary socket; those 8 passed when rerun with local socket access. No tests were rewritten to mask that limitation.
- Expo iOS and Android exports passed; output is in a temporary directory, not committed. This verifies bundling, not a native device session or OS-level push/background/widget behavior.
- Website shared-token values checked through computed styles on its sign-in page and actual shared components in a temporary light/dark verification page (removed after checking). Native phone/tablet/dark-mode/large-text screenshot QA and physical iOS/Android checks remain release gates; no completed device review is claimed.
- Task/spec/source links and ID traceability are checked before handoff. No missing mobile feature beyond the requested visual foundation was implemented, and no database migration was applied.
