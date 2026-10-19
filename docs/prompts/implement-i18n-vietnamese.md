# Implement English/Vietnamese internationalization

Copy the prompt below into a repository-enabled coding session. This file prepares implementation; it does not itself start the feature.

```text
Implement the proposed specification in docs/specs/i18n-vietnamese.md.

Goal: add extensible internationalization for web, mobile and application-owned
transactional messages, launch English and Vietnamese, and persist each church
Person's preferred language. Complete all three delivery phases unless I name a
specific phase. Report partial progress honestly if an external QA gate remains.

First read CLAUDE.md, applicable AGENTS.md, CONTEXT.md, the specification, and
docs/prompts/IMPLEMENTATION-RULES.md. Recheck current source and manifests rather
than relying on old baseline claims. Inspect git status, preserve existing work,
and use a dedicated codex/i18n-vietnamese branch when creating a new branch.
Do not commit, push, deploy, send real notifications, or reset databases.

Create docs/plans/i18n-vietnamese-progress.md with the three phases, a complete
web/mobile/system-message coverage inventory, acceptance criteria and QA gates.
Inspect the existing Person/Profile linking, selected column lists, RLS, typed
API client, session/cache lifecycle and notification outbox before changing them.
Use current official documentation to verify translation-library and native
locale integration choices. Do not build a custom translation/plural engine.

Implement the shared foundation in packages/shared/src/i18n, with en/vi JSON
catalogs grouped by feature, a central locale registry, semantic typed keys,
interpolation/plural validation, fallback, and pure locale/format helpers.
Export shared contracts through packages/shared/src/index.ts. Keep browser,
React and native integrations in their own adapters. Verify catalogs are included
in compiled shared output and web/native bundles. Backend translation must be
isolated per request/recipient, never process-wide mutable language state.

Before schema or authorization work, read the Supabase skill and relevant
references. Add nullable people.preferred_language with canonical en/vi values,
an additive text/check constraint migration, and no forced English backfill.
Update types, schemas, projections and mappers. Preserve preferences on identity
linking and invitation acceptance. Add an Organization-scoped self-service
read/update contract and typed client methods; extend existing people.manage
flows for manager edits. Enforce active membership, tenant scope and self-service
field restrictions in the database as well as the API. Never grant broad Person
update access just to save language. Cover no-linked-Person handling explicitly.

Add language controls to web Settings, mobile Profile and authorized Person
forms. Follow the exact precedence, null/Automatic, cache isolation, sign-out,
Organization switch, pending/save failure and offline behavior in the spec.
Resolve saved preference before device language; never silently persist detection.
Read selector options from the registry. Preserve an unsupported saved locale
when an older client must display fallback English.

Convert the full coverage inventory, including accessibility, validation,
error/empty/loading states, public/auth flows and print/export labels. Preserve
user-authored content and machine contracts. Localize formatting without changing
Organization timezone or scheduling semantics. Verify Vietnamese font coverage.
Translate per-recipient application-owned notification templates through the
existing delivery infrastructure and capture locale for stable retries. Preserve
legacy queued messages and existing user-authored template interpolation.

Add a contributor guide explaining new namespaces, keys, placeholders, plural
rules, language registration, database constraint migration, deployment order,
fallback and review. Adding a language must not require editing screen logic.

Test observable behavior: preference persistence across clients, null/fallback,
multi-Organization/account isolation, late responses, failed saves, no-login
identity linking, direct database authorization/field restrictions, invalid codes,
catalog completeness/interpolation/plurals, timezone-safe formatting and concurrent
per-recipient delivery/retries. Use provider fakes for notifications.
Run focused tests, catalog validation, npm run typecheck, npm test and npm run
build. Verify native iOS/Android export with a fresh temporary output directory.
Run database tests against disposable local infrastructure without destructive
resets. Record exact checks and distinguish mocks, builds and real database/device
QA. Do not claim unperformed Vietnamese-speaker or device review passed.

Review the final diff for unrelated changes. Update the progress file with each
acceptance criterion's evidence, pending gates and next action. Finish with the
delivered behavior, relevant files, checks/results and remaining limitations.
```
