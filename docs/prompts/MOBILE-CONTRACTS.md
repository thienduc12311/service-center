# Mobile integration after the Services implementation

Baseline reviewed 2026-10-19 at `6402573`. Applies to **every MOB-001–MOB-033 invocation**. Read this file before the selected task, then consult [the current audit](../plans/services-mobile-contract-audit.md) and the relevant progress entries. The website is the behavior and terminology reference. F00–F17 have implemented core/selected passes; that does not mean all optional stages, production operations or device QA are complete.

## One contract for web and native

1. Trace the selected action from its website screen/hook through `packages/shared/src/lib/api-client.ts` to the backend route/service and relevant SQL. Both clients instantiate `ServiceCenterApi`. Use its existing `/api/v1` methods, authentication and organization context. F17 `/api/external/v1` is a restricted third-party API, not the mobile API.
2. Import wire inputs, outputs, enums, Zod schemas and business helpers from `@service-center/shared`. Preserve field names, null versus empty meaning, optionality, IDs, pagination/cursors and errors. Native-only presentation models may be local, with explicit mappings; they must not redefine or change the wire contract. Some legacy client signatures are broad (`Record<string, unknown>`); validate with the existing shared schema, not a second native schema.
3. Reuse Person identity, effective capabilities, request snapshots, time/conflict resolution, capacity allocation, chart context, reminder policy and file/offline rights. Keep organization/account/generation in cache scope; include Person, resource and filters where applicable. Drop late results and drafts after identity changes. Follow the existing native session lifecycle.
4. Match website labels through shared translations, semantic statuses, design tokens and main actions. Preserve platform-native controls, safe areas, keyboard behavior and accessible touch targets. Prepared/released visibility, assignment answers, plan publication, actual attendance and delivery outcomes are separate states.
5. Use server preview/revision/idempotency contracts unchanged. Keep a stable operation/message key for transport retries; stale reviews need a fresh preview. Re-fetch uncertain results. Native loops of HTTP calls cannot replace an atomic server operation. Use F00's worker/outbox for effects, never a phone timer or second sender.
6. Treat prerequisite passes already implemented in the ledger as **verify/reuse**, not instructions to recreate them. If a concrete gap is found, document the absent method/field/behavior and owning F task, extend that shared contract compatibly once, and verify both clients. An absent optional provider/platform feature stays gated. Preserve historical pass names and completed evidence.

## Contract acceptance for each task

Record the web source, shared method + input/output type/schema, backend permission path, native consumer and applicable behavioral test for every selected action. Cover success, loading/empty, denied/not-found, stale, offline/error/retry and account/organization switching. Check that both clients read the same saved state, versions and semantic labels. New backend shapes must have named shared exports and matching validation.

Build/typecheck proves compatibility, not complete API/RLS behavior. Run focused shared/backend/native behavioral tests; real SQL/concurrency checks for changed transactions or access; web build; native export when native source changes. Record physical-device interaction and external provider/deployment gates separately. The native workspace **has** a Vitest test script. Do not relabel existing pending gates as complete based on this instruction rewrite.

## Chat notifications — required behavior

The user selected **every new message**, respecting mute, on 2026-10-19. The shared policy is:

- A new team/plan message queues one in-app and one push delivery per eligible non-sender participant, regardless of mentions/replies. Existing conversation access determines the audience, including active membership, adult policy and released plan visibility. No-login Persons cannot receive device push.
- The message and effects commit atomically. Reusing a message ID returns the existing result. A mention/reply does not create a second notification for the same channel. Edits do not resend the message.
- Mute suppresses notification jobs at enqueue. Before dispatch, recheck current access, Person eligibility, mute and deleted/hidden content. Muting does not delete chat history or imply read state. Already delivered OS notifications cannot be recalled.
- Use `conversation_message`, `conversation_mention` and `conversation_reply` from shared notification types. Use the shared `PushNavigationPayload`; retain the current minimal push envelope. Ship an updated mobile build for the new event type; older installed parsers may reject it on tap. Private content stays in the authenticated feed, not the lock screen.
- The existing mobile listener accepts the shared payload and refreshes the feed/badge. Current taps resolve to a plan or notification feed; there is **no native conversation route yet**. MOB-019/020 must add exact thread navigation by fetching the authorized notification's `conversation_id`, fetching that conversation after the org switch, and rechecking account/generation. Do not add arbitrary unvalidated routes to push data or mark exact-thread navigation complete before the screen exists.
- F08 preferences govern reminders; they are not a general all-event chat preference API. Chat mute is the existing chat setting. Generic per-event controls and Live run subscriptions need a separately defined shared contract before UI claims to save them.

### Release evidence required for mobile receipt

Use a signed iOS/Android development or release build with the configured EAS project and valid platform push credentials. Verify current official Expo instructions when doing that platform work. Check registration/renewal and sign-out revocation, real Expo transport (`PUSH_ENABLED`), and the scheduled F00 worker using [the operations guide](../operations/delivery-worker.md). Apply the additive chat migration before running the new dispatcher. No production settings are changed by this prompt pack.

Record separately for **both platforms**:

| Scenario | Required result |
|---|---|
| Ordinary message, mention, reply, mention + reply | Eligible recipient receives one alert per message; sender receives none |
| Foreground, background, app terminated | Alert arrives; permitted feed refreshes; tap is consumed once after authentication |
| Muted before send / muted after enqueue | No new delivery / queued delivery cancelled before provider call |
| Membership removed, child/no-login, hidden/deleted content | No unauthorized delivery; stale tap fails safely |
| OS denied permission | In-app history/feed remains usable; device-settings recovery is explicit |
| Sign-out, account change, organization change | No old-account registration/cache navigation; correct org reauthorized |
| Expired token / provider failure / lost acknowledgement | Invalid token retired, truthful retry/failure, no duplicate message |

Expo ticket acceptance proves provider acceptance only. This backend does not poll push receipts; physical-device observation is a separate gate. Simulator/export success cannot close it. Record build/device, event, worker outcome, observed arrival and tap destination without tokens or message contents.
