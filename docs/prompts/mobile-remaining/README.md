# Mobile tasks on the existing website contracts

Revised 2026-10-19 after reviewing F00–F17. Read [mobile contract rules](../MOBILE-CONTRACTS.md), [execution rules](../IMPLEMENTATION-RULES.md), [the audit](../../plans/services-mobile-contract-audit.md), then the selected prompt and its existing progress entry. This pack integrates native features with the website's implemented APIs and shapes.

```text
Work on the next unfinished pass of MOB-019. Read docs/prompts/MOBILE-CONTRACTS.md, docs/prompts/IMPLEMENTATION-RULES.md and its task prompt. Verify and reuse the implemented Services contracts and existing native work. Implement the native gap, test both clients against the same shapes, and record exact evidence and remaining device/deployment gates. Do not recreate completed shared prerequisites.
```

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


## Resume from current progress

MOB-001–008 have existing native implementation with remaining verification gates. MOB-005 A–D are complete in the ledger; F11 supplied MOB-002 sequence support; F07 supplied MOB-009/010 Pass A. The next first-ten implementation is **MOB-009 Pass B**, then MOB-010 Pass B, while available device QA for earlier tasks can proceed independently.

MOB-011–033 consume the existing F03/F09/F10/F11/F12/F13/F14/F15/F16 APIs. Select a native task based on its actual native prerequisites, rather than restarting its F epic. Chat notification completion spans MOB-019 and MOB-020; every new message is required to notify unmuted eligible members. Full Matrix, custom report design and integration administration remain web workflows initially. Optional platform/provider work needs its specific feasibility stage.

Update `docs/plans/mobile-remaining-progress.md` only for implementation/verification actually performed. Create the remaining-mobile ledger when work starts; this prompt rewrite does not claim those native features are implemented. Preserve historical pass labels and evidence. Shared fixes are recorded once in the Services ledger and linked from mobile.

The task's original acceptance requirements remain binding alongside the common contract/device gates. Specs describe intended scope; current source defines the available API. Record differences explicitly.
