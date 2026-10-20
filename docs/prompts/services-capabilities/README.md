# Services capabilities: implementation and remaining gates

Covers **F00–F17** in the [Services plan](../../plans/services-feature-gap-plan.md), [specification](../../specs/services-feature-specification.md) and [user stories](../../specs/services-user-stories.md). Read [execution rules](../IMPLEMENTATION-RULES.md) and one selected epic prompt. Each epic separates core passes from extensions; execute one pass per invocation.

```text
Work on F00 Pass A. Read docs/prompts/IMPLEMENTATION-RULES.md, docs/prompts/services-capabilities/README.md and docs/prompts/services-capabilities/F00.md. Inspect the current implementation and both relevant progress ledgers. Reuse shared work already completed through mobile tasks. Implement and verify the selected pass, preserve compatibility and existing changes, and report evidence, remaining gates and the exact next pass. Do not mark the whole epic complete after one pass.
```

## Current baseline

F00–F17 core/selected passes have implementation in this checkout. Start with [the current audit](../../plans/services-mobile-contract-audit.md) and [progress ledger](../../plans/services-capabilities-progress.md); choose an unresolved gate rather than rerunning completed migrations. Historical instructions below describe scope, not current missing work. Mobile follows [the shared contract rules](../MOBILE-CONTRACTS.md).

## Epic index

| Epic | Prompt | Core result / important dependencies |
|---|---|---|
| F00 | [Reliable delivery and atomic operations](F00.md) | Shared effect/outbox boundary and safe copying |
| F01 | [Scoped access, visibility and hierarchy](F01.md) | Capability/RLS foundation; folders and eligibility later |
| F02 | [Person-first scheduling and roster](F02.md) | Additive identity migration; no-login staffing and history |
| F03 | [Availability, preferences and delegation](F03.md) | Timezone-safe blockouts/preferences; household/aggregate separate |
| F04 | [Assigned times and conflict checks](F04.md) | Stable time identity and actual interval resolver |
| F05 | [Multi-plan Scheduling and Matrix](F05.md) | Bounded atomic staffing; F01/F04/F08; order reuse needs F10 |
| F06 | [Rotations and staffing proposals](F06.md) | Deterministic reviewed proposals; F03/F04/F05/F08 |
| F07 | [Signups, replacements and swaps](F07.md) | One transactional allocator; F01/F02/F04/F08 |
| F08 | [Release, reminders and history](F08.md) | Durable timed policy/dispatch; F00/F01/F02/F04 |
| F09 | [Notes, targeted messages and chat](F09.md) | Audience-safe collaboration; F01/F00; files via F13 |
| F10 | [Templates and bulk planning](F10.md) | Versioned templates/atomic generation; F00/F04/F08 |
| F11 | [Order editing, charts and timing](F11.md) | Effective-key correctness first; advanced timing separate |
| F12 | [Live and actual timing](F12.md) | Authoritative per-occurrence run; F01/F11 |
| F13 | [Files and audience enforcement](F13.md) | Upload/finalize/version lifecycle with matching Storage access |
| F14 | [Rehearsal, media and stage tools](F14.md) | Authorized manifest/player; F11/F13; optional stages separate |
| F15 | [Curation and structured imports](F15.md) | Archive/filter/import safety; optional merge and labeled keys |
| F16 | [Attendance, reports, feeds and sharing](F16.md) | Defined metrics/source access; public/custom stages separate |
| F17 | [Providers, licensing and external API](F17.md) | Select/verify one adapter before implementation estimates |

## Original dependency order (not a restart queue)

1. F00 delivery boundary and atomic operations; F11's ordinary editor/effective-key fix can run independently.
2. F01 scoped capability/private preparation foundation; F02 identity; F03 basic availability/preference contract; F04 stable assigned-time model; F08 versioned release and reminders. Permission state, identity and time selection precede new scheduling writers.
3. F10 templates/date generation, F05 multi-plan staffing, F06 deterministic proposals and F07 signup/replacement allocation. Reuse every existing assignment writer through shared services.
4. F13 file lifecycle, F09 notes/messages/chat, F14 rehearsal/media and F15 library curation/import. F15 basic filters/archive can begin earlier where independent.
5. F12 authoritative runs; F16 operational reporting/attendance/calendar. Attendance and basic reports can begin before Live; actual-time reports wait for real completed runs.
6. Explicitly selected hierarchy, household, rich communication, offline/stage, public/custom-report and F17 provider/platform extensions. A core release need not wait for unrelated optional work.

## One shared implementation across both packs

- MOB-005 may already implement substantial F01/F02/F04/F08 core contracts and F00 outbox work. Inspect its actual source/tests and [ledger](../../plans/mobile-first-10-progress.md); reuse it.
- MOB-006/007 share F03 availability/preferences. MOB-009/010 share F07 capacity and replacement policy. Services prompts add remaining web/shared behavior, not parallel APIs.
- The [remaining mobile pack](../mobile-remaining/README.md) consumes F03 delegation, F09 communication, F12 Live, F13 files, F14 media/cache and F16 attendance/report contracts.
- Save shared progress once in `docs/plans/services-capabilities-progress.md` when implementation begins; link mobile entries to that evidence. Resolve route naming differences in older candidate specs through one shared API, not aliases with different semantics.

Consult [official research](../../research/planning-center-services-feature-reference.md) when parity meaning affects a selected pass. Proposed Service Center choices—approval-based replacement defaults, deterministic fairness, outbox design, advanced timing and duplicate merge—remain labeled choices. Provider availability/rights and current platform facts must be verified at implementation time.
