# Service Center implementation prompts

Prepared 2026-10-15. These documents turn the existing assessments, specifications and user stories into implementation instructions for a model with repository access. They do not change feature status or authorize production deployment.

| Pack | Coverage | Start |
|---|---|---|
| First ten mobile tasks | MOB-001–MOB-010 | [Existing launcher](mobile-first-10/README.md) |
| Remaining mobile tasks | MOB-011–MOB-033 | [Mobile launcher](mobile-remaining/README.md) |
| Missing Services capabilities | F00–F17, including separately labeled extensions | [Services launcher](services-capabilities/README.md) |
| English/Vietnamese internationalization | Shared catalogs, web/mobile UI, Person language preference and system messages | [Implementation prompt](implement-i18n-vietnamese.md) · [Specification](../specs/i18n-vietnamese.md) |

Read [the execution rules](IMPLEMENTATION-RULES.md) for either new pack. Use one task and one named pass per invocation. Shared capabilities belong to the Services implementation; mobile prompts consume them and add native interaction. When a mobile prompt requires an absent foundation, implement the named Services pass first and record the dependency instead of inventing a client-only substitute.

Current progress is independent of these instructions. The [existing mobile ledger](../plans/mobile-first-10-progress.md) records MOB-001 as implemented with QA pending. Recheck the current source and relevant ledger at every invocation; earlier assessments are evidence of a baseline, not proof that nothing has since changed.

Copy one launcher from the chosen pack, replacing its task/pass as needed. Keep optional/provider/platform extensions separate from core completion, and follow the specific acceptance gates before marking anything complete.
