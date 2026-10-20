# Execution rules for implementation prompts

These rules apply to the [first-ten mobile](mobile-first-10/README.md), [remaining-mobile](mobile-remaining/README.md) and [Services](services-capabilities/README.md) packs. Every mobile invocation also reads [the mobile contract rules](MOBILE-CONTRACTS.md). Execute the selected prompt; reading these documents alone does not start all tasks.

## Ordered workflow

1. **Establish current state.** Read `CLAUDE.md`, applicable `AGENTS.md` and `CONTEXT.md`; inspect branch, working tree and the relevant progress ledger. Preserve existing edits and committed MOB-001 fixes. Use an appropriate feature branch, with `codex/` naming where the session requires a new branch. Commits, pushes and deployment require a separate request. **Done:** record the selected task/pass, pre-existing changes and affected modules.
2. **Load the selected scope.** Read the task's named specification and story sections, then its code entry points. Follow only relevant reference links. Recheck baseline claims against source. Reuse completed prerequisites and stable contracts; a dependency identifier is not proof it is implemented. **Done:** list satisfied dependencies with file/test evidence and identify the next missing bounded pass.
3. **Define the boundary.** Write a short implementation note covering shared input/output schemas, authorization, state transitions, revision/idempotency behavior, errors, migration compatibility and UI states. Suggested new route names in specs are proposals; use one consistent implemented contract. **Done:** the selected pass has a measurable result, without implying that later extensions already work.
4. **Reuse and verify shared behavior first.** F00–F17 core/selected implementations already exist; only extend shared behavior for a demonstrated gap recorded against its owner. Before schema/RLS/Storage/SQL/locking work, read `.agents/skills/supabase-postgres-best-practices/SKILL.md` and relevant references. Use additive migration/backfill/validate/switch steps; preserve historical migrations and identifiers. Export boundary types, Zod schemas and API methods through `packages/shared/src/index.ts`. Validate external data from `unknown`; retain strict types rather than `any` or suppression escapes. **Done:** server persistence and permission paths support the actual promised behavior before client integration.
5. **Connect the selected client.** Reuse existing web/native components and shared design tokens. Match website terminology, status meanings and primary actions while keeping platform-native controls, safe areas and touch targets. Preserve the removed minimalism theme and the MOB-001 Pressable/NativeWind fixes. Gate actions by effective capabilities and recheck on the server. **Done:** loading, empty, denied, pending, stale, failure/retry and success states reflect real persisted results.
6. **Verify and hand off.** Run appropriate checks, inspect the final diff and update the ledger with exact evidence. If an environment or external decision is unavailable, finish independent work and record the precise pending gate. **Done:** every acceptance criterion is passed, explicitly pending, or linked to a concrete unsatisfied dependency; a partially implemented pass is never reported as full completion.

## Shared invariants

- Person is organization roster identity; Profile authenticates. Reuse existing Person rows and explicit links. Invitations join the organization; assignments request participation. Preserve no-login/history/token compatibility.
- Validate all organization/parent/team/position/time/song/arrangement/file relationships. RLS and Storage enforce access; API checks improve errors. Privileged jobs, exports, signed links and public endpoints independently enforce the allowed audience. Recheck revocation at subsequent access or URL renewal.
- Prepared/released visibility, assignment answer, plan publication and delivery status are separate. Prepared content stays absent from member queries, counts, feeds, search, files and notifications. Counts and previews can leak too.
- Use expected revisions for competing edits and durable idempotency keys for creates/batches/releases/jobs. Atomic multi-row operations use short database transactions. External effects run after commit through one shared outbox. Use real database contention tests for concurrency promises.
- Keep UTC instants and IANA organization-timezone intent distinct. Recurrences are bounded; DST ambiguity is explicit. Conflicts compare actual half-open attendance intervals, including rehearsals. Preferences are warnings unless a documented policy says otherwise.
- Private tokens, credentials, file URLs and contact/message content stay out of logs and analytics. An authenticated route is not permission to share all fields. Offline cache revocation and already delivered OS notifications have physical limits that must be described honestly.
- Production DB application, destructive local resets, real external sends, signing changes and deployment are outside a prompt's default implementation pass. Use disposable local services, provider fakes and rollback-isolated fixtures. Complete reviewable code/config before seeking any genuinely required external approval.

## Validation

Inspect current manifests, runtime config and tool help. Manifests currently require Node >=26.8.1/npm >=11.19.0; older Node 20 prose in `CLAUDE.md` is stale. Shared consumers use compiled output.

```bash
npm run build:shared
npm run typecheck
npm test
npm run build
```

Run focused behavioral tests during a pass and applicable workspace checks at handoff. Native changes also require iOS/Android export; from `mobile/`, choose a fresh temporary output directory:

```bash
EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-native-validation
```

Root build covers shared/backend/web, not native. Expo export proves bundling, not device UX, background audio, push, universal links, scanning or widgets. Verify those on supported devices/development builds and record permission denial, interruption, sign-out, organization switch, both themes and accessible text. The native workspace has a Vitest test script; run applicable behavioral tests and report their actual results. Avoid tests that merely repeat styles or implementation constants.

Database tests cover caller-role direct access as well as API behavior; Storage changes cover raw object access and signed URL issuance. Check installed CLI `--help` before selecting a local SQL test command. Never infer a database check passed from a mocked HTTP test. External SDK/platform facts must be verified against current primary documentation when that implementation pass begins.

## Progress and completion

Use `docs/plans/mobile-remaining-progress.md` for MOB-011–MOB-033 and `docs/plans/services-capabilities-progress.md` for F00–F17; create a file only when implementation starts. Preserve `docs/plans/mobile-first-10-progress.md` and append there only when actually working on those tasks.

Each row records task/pass, status, dependency evidence, changed files, exact checks/results, remaining gates and next pass. Statuses: `not started`, `in progress`, `implemented; QA pending`, `complete`, `blocked`. Mark optional stages separately. A core pass may finish while an extension stays unselected; full-epic scope must remain explicit.

When completing shared work reached from a mobile prompt, update the Services ledger once and point the mobile ledger to it. Do not create duplicate migrations, API families, workers, permission engines, chat transports or cache systems. End the invocation with delivered behavior, files, actual checks, remaining gates and the exact next pass. Name missing product/provider decisions only when they materially block that pass, with bounded options and completed independent work.
