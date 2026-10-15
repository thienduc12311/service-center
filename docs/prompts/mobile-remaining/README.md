# Implementation prompts: remaining mobile tasks

Covers **MOB-011–MOB-033** from the [mobile backlog](../../plans/mobile-feature-tasks.md). Read [execution rules](../IMPLEMENTATION-RULES.md), the selected prompt and its named [mobile specification](../../specs/mobile-feature-specification.md) section. The [first ten tasks](../mobile-first-10/README.md) remain separate and unchanged.

```text
Work on MOB-012 Pass A. Read docs/prompts/IMPLEMENTATION-RULES.md, docs/prompts/mobile-remaining/README.md and docs/prompts/mobile-remaining/MOB-012.md. Check current source and progress before changing anything. Complete that pass, implement missing named prerequisites as bounded shared work, run relevant checks, and record evidence and the next pass. Preserve existing UI fixes. Report partial gates honestly.
```

Choose a different task/pass by replacing the ID and letter. Start MOB-012's existing-API browser, MOB-021 settings or existing-filter portion of MOB-022 independently when their access/session prerequisites are satisfied. Advanced workflows wait for the named Services pass, not the entire corresponding epic.

| Task | Prompt | Shared prerequisite / boundary |
|---|---|---|
| MOB-011 | [Household delegation](MOB-011.md) | F03 delegation; F01/F02; separate rights per action |
| MOB-012 | [Plans browser/workspace](MOB-012.md) | Existing plan API; F01 visibility |
| MOB-013 | [Plan creation/templates](MOB-013.md) | Single-plan API first; F10 bulk/templates |
| MOB-014 | [Order editing](MOB-014.md) | Existing item API; F11 revisions/sequence |
| MOB-015 | [Time/reminder editing](MOB-015.md) | F04 stable times; F08 policies |
| MOB-016 | [Plan notes](MOB-016.md) | Existing notes first; F09 audience categories |
| MOB-017 | [Attendance](MOB-017.md) | F16 attendance; F04 assigned times |
| MOB-018 | [Targeted communication](MOB-018.md) | F09 preview/send; F00 outcomes; OS text composer |
| MOB-019 | [Conversations](MOB-019.md) | F09 chat/access/moderation; F13 attachments later |
| MOB-020 | [Notification preferences](MOB-020.md) | MOB-003 lifecycle; F08 channel preferences; F09/F12 targets |
| MOB-021 | [Appearance/help/settings](MOB-021.md) | Existing theme; F14 cache only when present |
| MOB-022 | [Calendar/subscriptions/report share](MOB-022.md) | Existing feed/filter API; F16 reports |
| MOB-023 | [Native Live](MOB-023.md) | F12 authoritative run; F09 run chat optional |
| MOB-024 | [Rehearsal player](MOB-024.md) | F13 authorized files; F14 manifest |
| MOB-025 | [Offline preparation](MOB-025.md) | MOB-024; F14 rights/version/cache metadata |
| MOB-026 | [File upload/preview/share](MOB-026.md) | F13 lifecycle and Storage policy |
| MOB-027 | [Advanced audio/car/Siri](MOB-027.md) | Stable MOB-024; separately gated platform spikes |
| MOB-028 | [Song library authoring](MOB-028.md) | Existing CRUD; F15 filters/archive/labeled keys |
| MOB-029 | [Chart editor/PDF](MOB-029.md) | Shared chart pipeline; F11/F15 key/sequence semantics |
| MOB-030 | [Media browsing/iOS scanning](MOB-030.md) | F14 media; MOB-026; optional native scan |
| MOB-031 | [Directory/profile/team editing](MOB-031.md) | F01 fields; F02 identity/tags/archive; F13 avatar lifecycle |
| MOB-032 | [Combined own-organizations schedule](MOB-032.md) | F03 aggregate/self access; MOB-003 isolation |
| MOB-033 | [Widgets](MOB-033.md) | Stable schedule/player APIs; platform extension feasibility |

## Dependency handling

Use [Services prompts](../services-capabilities/README.md) to implement missing shared foundations. Reuse shared work already delivered through MOB-005–MOB-010. Mobile adds client behavior; neither pack authorizes a second implementation of the same capability. F12 precedes MOB-023; F13 precedes general file access; F13→F14→MOB-024 precedes cache/advanced playback/widgets. Household delegation, public sharing and optional providers are independently selected scopes.

Reference boundaries come from the [mobile research](../../research/planning-center-services-mobile-reference.md). Full Matrix, recurring-series maintenance, custom report design and media-record authoring remain web workflows initially. Existing native songbooks stay available. New-person onboarding, OCR restoration and provider imports are not implied by unrelated mobile tasks.

Implementation updates go to `docs/plans/mobile-remaining-progress.md`; future creation of that ledger does not replace the first-ten ledger. Save required device evidence separately from build/export results.
