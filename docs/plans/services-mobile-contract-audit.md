# Services and mobile contract audit — 2026-10-19

Baseline: `6402573`, clean working tree on `feature/mob-008-plan-staffing`; audit branch `codex/mobile-contract-audit`. Reviewed all 18 F prompts, the Services progress ledger, all 33 MOB prompts, the shared client/schema surface, web/native API adapters, feature route/UI/test entry points and the chat delivery path. This is a source/contract and automated-check audit, not a new browser/device/product acceptance run.

## Finding

**The repository cannot honestly be marked “everything complete.”** F00–F17 core or selected passes have code, but the ledger still contains real implementation omissions, optional stages and release QA/deployment gates. The mobile prompts were written before much of that work and would recreate existing contracts. All 33 now start from implemented methods, retain original acceptance requirements and point to one [mobile contract guide](../prompts/MOBILE-CONTRACTS.md).

Both `frontend/src/lib/api.ts` and `mobile/src/lib/api.ts` instantiate the same `ServiceCenterApi`. Shared request/response schemas and DTOs are the authority. This establishes one architecture; it does not prove every broad legacy method signature or response is fully validated. `createPlan`, `updatePlan`, `addPlanItem` and `createAssignments`, for example, still have broad client inputs: consumers must use the existing shared Zod schemas, and any future tightening must preserve both clients. Mobile does not use F17's separate external integration API.

## Every F task: implemented boundary and unresolved work

Paths below are repository-relative. Existing SQL tests are under `supabase/tests`; this audit reruns SQL fixtures separately from historical browser/concurrency evidence. See the [progress ledger](services-capabilities-progress.md) for original pass details and product decisions.

| Task | Source / contract evidence | Remaining work; mobile owner |
|---|---|---|
| F00 | `backend/src/services/delivery-dispatch.ts`, `backend/src/worker.ts`; shared delivery types/client; `delivery-outbox.sql`, `atomic-plan-copy.sql` | Production worker/provider delivery verification; Expo receipts are not polled. Reuse this outbox across all mobile actions. |
| F01 | `backend/src/routes/access.ts`, shared `myAccess` and access helpers; web `settings/AccessSettings.tsx`; `f01-scoped-access.sql` | Real-role rollout and device visibility/revocation QA. MOB-005/008/012/031 consume effective scope, not local role guesses. |
| F02 | `backend/src/routes/people.ts`, `roster.ts`; shared Person methods; web `PeoplePage.tsx`; `f02-person-identity.sql`, `f02-roster-extensions.sql` | Real-data identity reconciliation and guest email/provider gate. MOB-005/008/031 preserve Person IDs and no-login history. |
| F03 | `backend/src/routes/availability.ts`, `blockouts.ts`, `delegations.ts`, `me-availability.ts`; web settings consumers; `f03-preferences-delegation.sql`, `mob006-availability.sql` | DST/device/rollout QA; minors/no-login delegation needs policy. Existing adult delegation and self aggregation are available for MOB-011/032; preferences already used by MOB-007. |
| F04 | Shared `previewPlanTimes`, `checkAssignmentConflicts`; `backend/src/routes/plans.ts`; web `EditTimesModal.tsx`; `f04-assigned-times.sql` | Native time editor MOB-015, selected-time staffing QA MOB-008 and real calendar-client updates. Stable time IDs already exist. |
| F05 | `backend/src/routes/staffing-matrix.ts`, `frontend/src/pages/StaffingMatrixPage.tsx`; `f05-staffing-matrix.sql` | Order Matrix extension and production-like browser/accessibility QA. Full Matrix stays web-first; native staffing reuses the same underlying contracts. |
| F06 | `backend/src/routes/staffing-proposals.ts`, shared proposal/rotation methods; `StaffingProposalsPage.tsx`; `f06-rotations-proposals.sql` | Household together/apart rules, selected-time proposals, template/roster extensions, proposal retention and product fairness review remain explicit limits. Do not infer these from F03 grants existing. |
| F07 | `backend/src/routes/opportunities.ts`; shared opportunity/replacement/swap methods; web `OpportunityPanel.tsx`; `f07-signups-replacements.sql` | **Shared gap:** transition notification templates and durable scheduled expiry remain open; lazy expiry is not a scheduler. Native MOB-009/010 Pass B remains. Capacity/API Pass A is already delivered. |
| F08 | `backend/src/routes/releases.ts`; release batches/reminder policies/history; `ReleaseReviewPage.tsx`; `f08-release-reminders.sql`, `f08-matrix-release-batch.sql` | Worker/provider rollout and F07 transition effects. MOB-015/020 consume policies; reminder preferences are not a generic chat-event preference service. |
| F09 | `backend/src/routes/collaboration.ts`, `services/discussions.ts`, `delivery-dispatch.ts`; shared conversation methods; `ChatPage.tsx`; `f09-notes-messages-chat.sql` | This audit adds every-message notification jobs and shared event support. Native threads/exact conversation taps MOB-019/020 remain. Chat attachments, DMs, reactions, read receipts, realtime transport and youth messaging are not implemented. MOB-016/018 consume existing notes/messages. |
| F10 | `backend/src/routes/plan-templates.ts`; shared template/generation/reschedule methods; `PlanTemplatesPage.tsx`, `GeneratePlansPage.tsx`, `ReschedulePlansPage.tsx`; `f10-plan-templates.sql`, `f10-plan-reschedule.sql` | Series/title/artwork/default-copy extensions; template snapshots still omit later F11/F14 fields. MOB-013 integrates existing preview/commit; cannot promise omitted components are copied. |
| F11 | `backend/src/services/plan-items.ts`, shared chart-context/plan-order/run-sheet helpers; web order editor; `f11-order-editing.sql` | Leader names in notifications/reports, screen note columns, richer template snapshots and advanced timing modes remain gaps. Native editing MOB-014 and chart device QA MOB-002/029 remain. |
| F12 | `backend/src/routes/live-runs.ts`, shared `liveRunState`/`liveRunAction` and clock/view helpers; web `live/`; `f12-live-runs.sql` | Native viewer/controller MOB-023, deployed multi-device QA, dedicated run chat, public limited display and rebase. F16 has a `runTimesReport` contract; cross-plan reporting must be assessed there, not rebuilt from the older F12 note. No Live push subscription API exists. |
| F13 | `backend/src/routes/files.ts`; shared file lifecycle; web `files/`; `f13-files.sql` | Storage/production inventory and upload/download QA, native MOB-026. Key-specific materials are now supplied by F15; earlier “wait for keys” notes are historical. Chat/message attachments remain absent. |
| F14 | `backend/src/routes/rehearsal.ts`; shared manifest/offline/media methods and helpers; web `RehearseTab.tsx`, media/stage; `f14-rehearsal-media.sql` | Native player MOB-024/offline storage MOB-025, device audio/printed stage QA. Transforms/loops/metronome/pedals/car/voice are separate optional stages, not implied by manifest support. |
| F15 | `backend/src/routes/songs.ts`, `imports.ts`; shared arrangement-curation and imports contracts; web curation/import/merge UI; `f15-song-curation.sql`, `f15-structured-imports.sql`, `f15-arrangement-curation.sql` | A–C plus selected merge exist. Remaining browser/device, retention and production rollout checks; no automatic merge undo or provider/OCR import. MOB-028/029 consume existing labeled-key/history semantics. |
| F16 | `backend/src/routes/attendance.ts`, `reports.ts`, `publication.ts`, calendar routes; shared attendance/report/feed contracts; web `ReportsPage.tsx`, `AttendanceTab.tsx`; `f16-attendance-reports.sql` | Native attendance MOB-017/report sharing MOB-022, printed output/calendar-client/export-worker QA. Custom report definitions and Check-Ins adapters remain unselected; leader-name report gap belongs to F11/F16. |
| F17 | `backend/src/routes/integrations.ts`, `external-api.ts`, webhook dispatcher; web `IntegrationSettings.tsx`; `f17-developer-api.sql` | Selected Stage D exists; encryption key/worker/public HTTPS/egress and external-developer QA remain. Licensed catalog and named third-party handoff stages B/C are unselected. Admin configuration stays web-only. |

## Mobile readiness and consistent task instructions

- MOB-001–008 have native implementation; preserve the existing first-ten ledger and close its actual device gates. MOB-005 A–D are already complete. MOB-008 A/B is the current implemented baseline.
- MOB-009/010 shared Pass A comes from F07; build native Pass B next without a second allocator, state machine or route family.
- MOB-011–026 and MOB-028–032 integrate existing shared capabilities, with the task-specific limits above. A shared method's existence does not mean the native screen exists.
- MOB-027, optional MOB-030 scanning and MOB-033 widgets require bounded platform stages and real installed-build evidence.
- Each prompt now lists verified existing client methods, its F owners, native work, failure cases and handoff requirements. Shared rules cover shape/nullability/pagination/errors, account/org scope, capability checks, terminology/translations, revisions/idempotency and real device QA.

## Chat change in this branch

User decision: every new message, respecting mute. Additive migration `20261105000000_conversation_message_notifications.sql` extends the existing message transaction; it does not backfill old messages. Eligible linked adult non-sender participants get one feed job and one push job. The canonical conversation access predicate selects the audience; current mute excludes a recipient. Message-ID replay remains idempotent. The existing dispatcher rechecks membership, mute and message visibility.

Shared notification schema/type adds `conversation_message`. The dispatcher distinguishes ordinary messages, replies to this recipient, and mentions (mention takes precedence). English/Vietnamese feed labels are added. Backend `PushPayload` now aliases shared `PushNavigationPayload`, eliminating its duplicate declaration. The wire envelope remains unchanged; updated mobile builds understand the new event type. Older installed parsers may reject the new event on tap, so shipping the updated app is a release gate.

The mobile feed/listener can receive these alerts using its existing registration and payload parser. **Exact native thread navigation is still MOB-019/020 work**, because the app has no thread screen yet. The common guide requires both iOS/Android foreground/background/terminated delivery, mute-after-enqueue, permission denial, revoked access, duplicate tap and account-switch checks. No physical push arrival or deployment is claimed here.

## Validation in this audit

Final check results: Historical provider/browser/concurrency runs in the feature ledger are not represented as new runs. SQL checks use local Supabase, with the additive migration and each fixture rolled back; the development/production schema is not persistently changed by this audit.

- `npm run typecheck`: passed in shared, backend, web and mobile.
- `npm test`: **605 passed** (shared 335, backend 210, mobile 60). Includes ordinary-message/mention/reply classification, actual dispatcher-to-push-parser compatibility, lock-screen content minimization, mute-after-enqueue for feed/push, revoked membership and deleted/hidden content. Initial sandbox socket failures were resolved by allowing local test-server sockets; the suite then passed.
- All **32 SQL test files passed** in rollback transactions with both new migrations. Initial audit: 30/32; after F15 repair: 31/32; isolated F17 rerun: passed. Existing concurrency shell scripts were not rerun; this audit does not claim fresh contention evidence.
- `npm run build`: passed; existing Vite large-chunk warning remains.
- `npm run i18n:check`: passed for English/Vietnamese catalogs.
- `EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-contract-audit-native-20261019` (from `mobile/`): passed for both platforms. This is bundle compatibility, not physical push receipt.
- Documentation validation: all 33 IDs present, named client methods exist and relative task links resolve; `git diff --check` passed.

### Additional defects resolved during verification

**F15 real regression:** `20261104000100_i18n_structured_notices.sql` replaced F10's preview function from an older body and dropped F15 canonical song resolution. The existing F15 regression test failed at “old template canonical resolution”; the local function definition confirmed the missing resolver. Additive `20261105000100_restore_template_song_resolution.sql` restores the canonical-content call while keeping translated warning parameters. Existing F15 and structured-notice SQL tests both pass together. Historical template revisions remain immutable.

**F17 test isolation:** existing local credentials/endpoints made fixture-wide counts and the global worker observe unrelated records. The test now counts its own credential/event rows and temporarily pauses pre-existing endpoints/extends existing leases inside its rollback-only transaction. It restores all pre-existing state on rollback and retains role/tenant/secret-column denial checks. No application permission behavior was weakened.

## Exact next work

1. Deploy both additive migrations through the normal migration workflow, then the compatible API/worker and updated mobile build. No production changes were applied here.
2. Complete MOB-019/020 thread UI and authorized exact taps, then run the physical iOS/Android notification matrix with configured push credentials and worker. The shared every-message policy is implemented and tested; actual device receipt remains pending.
3. Continue first-ten native delivery with MOB-009 Pass B, then MOB-010 Pass B, and close earlier device gates. Track the F07 transition-delivery gap separately.
4. Use the F table to close remaining core omissions and release gates. Keep optional provider/platform/advanced stages explicitly selected or deferred; do not silently mark entire epics complete.
