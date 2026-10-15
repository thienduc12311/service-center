# Implementation prompts: first ten mobile tasks

Prepared 2026-10-15 from the current Service Center source and [mobile backlog](../../plans/mobile-feature-tasks.md). These prompts cover **MOB-001 through MOB-010**, in backlog order. They are instructions for future implementation; writing this pack does not implement or verify those features.

## Start here

Give the model repository access and paste this, replacing the task ID with the next task you want:

```text
Work on MOB-001 in this repository. Read docs/prompts/mobile-first-10/README.md, then its linked MOB-001 prompt. Follow the ordered steps and acceptance checks. Preserve existing work. Implement or verify the selected task as instructed; report the exact files changed, checks run, and remaining gates. For tasks with multiple passes, complete one pass per invocation and record the next pass in the progress file. Do not mark the whole task complete after only one pass.
```

Use one task, or one explicitly named pass, per invocation. Start with MOB-001 to finish available UI review, then MOB-002. MOB-003 and MOB-004 have useful independent work before the larger scheduling foundations. MOB-005 has five required passes; complete those before dependent work in MOB-007 through MOB-010. MOB-006's basic blockout editor can begin independently, but its full conflict review needs MOB-005's time model. MOB-009 must precede MOB-010 because both use the same capacity transaction.

| Task | Prompt | Expected result |
|---|---|---|
| MOB-001 | [Shared UI and device review](MOB-001.md) | Verify the theme already implemented; fix demonstrated inconsistencies |
| MOB-002 | [Plan chart context](MOB-002.md) | Correct arrangement, key and sequence, plus library arrangement picker |
| MOB-003 | [Session, tenant and link safety](MOB-003.md) | Isolated caches, safe transitions and validated public/private links |
| MOB-004 | [Complete personal schedule](MOB-004.md) | Grouped plan cards, every position/time and deliberate response actions |
| MOB-005 | [Scheduling foundations and request responses](MOB-005.md) | Person identity, scoped access, attendance times, release and atomic answers |
| MOB-006 | [Availability editor](MOB-006.md) | Timezone-safe blockouts, recurrence and affected assignments |
| MOB-007 | [Team preferences](MOB-007.md) | Persisted personal preferences and scheduling warnings |
| MOB-008 | [Plan staffing](MOB-008.md) | Authorized needs/candidate editing with conflict and release review |
| MOB-009 | [Volunteer signups](MOB-009.md) | Eligible openings, atomic capacity and approval status |
| MOB-010 | [Replacement requests](MOB-010.md) | Tracked offers with consent, approval and shared capacity enforcement |

## Rules for every invocation

1. Read `CLAUDE.md`, applicable `AGENTS.md` files if present, and `CONTEXT.md`. Check `git status --short` and the current branch. Preserve all pre-existing edits, including shared UI changes and untracked planning documents. Reuse the appropriate current feature branch; when a new branch is necessary, use the session's `codex/` convention. Keep commits, pushes and deployment outside this prompt unless separately requested. **Done:** you can identify existing changes versus the selected task's work.
2. Read only the selected task and its named specification sections. Source code is the authority for current implementation; backlog status is the authority for intended scope. Recheck the baseline observations before changing code. Reuse completed prerequisites instead of rebuilding them. **Done:** record the task/pass, affected modules and missing dependencies in a short implementation note.
3. Before database design or edits, read `.agents/skills/supabase-postgres-best-practices/SKILL.md` and its relevant RLS, schema and locking references. Implement shared prerequisites as bounded passes when the task requires them. Use additive migrations and a compatible transition for both website and mobile. **Done:** shared request/response contracts, authorization, stale-write behavior, migration compatibility and failure states are explicit before UI work.
4. Follow the selected steps. Put cross-boundary types, Zod validation and API methods in `packages/shared`, exported through its index. Validate external values from `unknown`; keep typed contracts instead of `any` or type-suppression escapes. Use existing backend service/route conventions and RLS as the primary row-access control. Validate every parent/child resource's organization. Privileged jobs, feeds, token endpoints and Storage access need explicit audience checks too. **Done:** the actual persistence and permission paths support the UI; screens are not simulated around absent APIs.
5. Use the existing shared design tokens and native primitives. Match website wording, status meanings and primary actions. Keep platform-native controls, safe areas, readable text and at least 44-point touch targets. The website is the visual reference; the earlier minimalism/serif theme must remain removed. **Done:** modified screens work in light/dark modes, with loading, empty, error, pending and denied states.
6. Run the relevant checks below and review the diff. Record unavailable device/database checks honestly. Continue independent authorized work when a check environment is unavailable; a pending gate stays pending. **Done:** every acceptance check has evidence or a specific remaining gate, rather than a blanket claim of completion.

Production database changes, resets of an existing developer database, external notifications and deployment are not required to implement these prompts. Use a disposable local database or rollback-isolated fixtures for integration tests. Never copy service-role secrets to a client. Keep public response tokens, push tokens and feed credentials out of logs, analytics, persistent caches and screenshots.

## Validation and progress

Inspect current package manifests and runtime configuration before using commands. The manifests currently require Node >=26.8.1 and npm >=11.19.0; the Node 20 mention in `CLAUDE.md` is stale. `@service-center/shared` is consumed from compiled output, so build it before dependent checks.

Typical checks from the repository root:

```bash
npm run build:shared
npm run typecheck
npm test
npm run build
```

Run focused behavioral tests during a pass, then the applicable workspace checks before handoff. The root build covers shared/backend/website, **not native export**. For modified native screens, also run from `mobile/`, using a fresh temporary output directory:

```bash
EXPO_OFFLINE=1 CI=1 ../node_modules/.bin/expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check
```

Choose a different output directory if that one already exists. Avoid `--platform all`: this repository does not currently install the web runtime for Expo. Export success proves bundling, not device interaction, push delivery or visual QA. There is currently no native test script: add a suitable behavioral harness only when needed and report what it actually runs. For SQL checks, inspect the installed Supabase CLI's `--help` and existing SQL test fixtures; verify a real supported local execution command instead of assuming a command from an older document works.

On the first implementation invocation, create `docs/plans/mobile-first-10-progress.md`. On subsequent invocations, update it. Include one row for each task/pass worked on: status (`not started`, `in progress`, `implemented; QA pending`, `complete`, or `blocked`), prerequisite evidence, changed files, exact checks/results, remaining gates and next action. A task is complete only when its full acceptance gate passes; preserve partial progress in the ledger.

End each invocation with: selected task/pass; behavior delivered; files changed; commands actually run and outcomes; unresolved checks; exact next task/pass. For MOB-005 name the next lettered pass. Keep the progress ledger concise enough for the next model to resume without loading the whole history.

## Reference map

- Product behavior and shared UI: [mobile specification](../../specs/mobile-feature-specification.md), selected task section only.
- Shared dependencies: [Services specification](../../specs/services-feature-specification.md), named Fxx sections only.
- Acceptance intent: [user stories](../../specs/services-user-stories.md), named US-xx sections only.
- Verified Planning Center behaviors and native/web boundaries: [mobile research](../../research/planning-center-services-mobile-reference.md), consult when a parity question affects the selected task. Service Center's explicit policy decisions take precedence over assumed reference behavior.
- Existing token/calendar decisions: `docs/adr/0001-tokenized-assignment-respond-links.md`, `0002-ics-attachment-and-subscription-feed.md`, `0003-publish-not-request-for-calendar-invites.md`; read when modifying responses, feeds or scheduling notifications.

MOB-011 onward is outside this prompt pack. Necessary shared infrastructure and small web compatibility changes for these ten tasks are included; a new Plans browser, full directory, household delegation, chat, player, offline packs and broad web redesign are separate tasks.
