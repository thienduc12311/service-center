# Mobile tasks on the existing website contracts

Revised 2026-10-19 after reviewing F00–F17. Read [mobile contract rules](../MOBILE-CONTRACTS.md), [execution rules](../IMPLEMENTATION-RULES.md), [the audit](../../plans/services-mobile-contract-audit.md), then the selected prompt and its existing progress entry. This pack integrates native features with the website's implemented APIs and shapes.

```text
Work on the next unfinished pass of MOB-009. Read docs/prompts/MOBILE-CONTRACTS.md, docs/prompts/IMPLEMENTATION-RULES.md and its task prompt. Verify and reuse the implemented Services contracts and existing native work. Implement the native gap, test both clients against the same shapes, and record exact evidence and remaining device/deployment gates. Do not recreate completed shared prerequisites.
```

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


## Resume from current progress

MOB-001–008 have existing native implementation with remaining verification gates. MOB-005 A–D are complete in the ledger; F11 supplied MOB-002 sequence support; F07 supplied MOB-009/010 Pass A. The next first-ten implementation is **MOB-009 Pass B**, then MOB-010 Pass B, while available device QA for earlier tasks can proceed independently.

MOB-011–033 consume the existing F03/F09/F10/F11/F12/F13/F14/F15/F16 APIs. Select a native task based on its actual native prerequisites, rather than restarting its F epic. Chat notification completion spans MOB-019 and MOB-020; every new message is required to notify unmuted eligible members. Full Matrix, custom report design and integration administration remain web workflows initially. Optional platform/provider work needs its specific feasibility stage.

Update `docs/plans/mobile-first-10-progress.md` only for implementation/verification actually performed. Create the remaining-mobile ledger when work starts; this prompt rewrite does not claim those native features are implemented. Preserve historical pass labels and evidence. Shared fixes are recorded once in the Services ledger and linked from mobile.

The task's original acceptance requirements remain binding alongside the common contract/device gates. Specs describe intended scope; current source defines the available API. Record differences explicitly.
