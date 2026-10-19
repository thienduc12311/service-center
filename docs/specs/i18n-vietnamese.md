# Internationalization and member language preferences

Status: proposed specification; implementation has not started.
Date: 2026-10-19.

## Outcome

Church members can use Service Center in English or Vietnamese and save their preferred language for their church. Web, mobile, and application-generated messages share translation resources. Adding another language requires a new catalog and registration, not conditional logic throughout the application.

This specification uses the repository's vocabulary: an Organization is the church, a Person is its roster identity (including people without a login), and a Profile is the sign-in account.

## Product decisions

- Initial languages: `en` (English) and `vi` (Tiếng Việt). English is the ultimate fallback.
- Save the preference on the organization's Person, not only in browser storage or on the global Profile. The same Profile can have different preferences in different churches.
- A missing preference means “Automatic”; it is distinct from explicitly choosing English. Do not backfill existing people to explicit English.
- Members edit their own preference. People managers can set a Person's preference, including before that Person has a login, using existing `people.manage` authorization.
- A church-wide default language is a future extension, not required for this release. The resolver must leave a clear place to add it.
- The full feature includes web and mobile UI plus application-owned transactional text. Ship in bounded phases, but do not label a partial screen conversion as full Vietnamese support.

## Current code anchors

- Shared contracts and exports: `packages/shared/src/index.ts`, `types/database.ts`, `types/domain.ts`, `schemas/people.ts`.
- Profile and church membership bootstrap: `backend/src/routes/me.ts`.
- Person reads, writes and explicit selected columns: `backend/src/routes/people.ts`, `backend/src/model/people.ts`.
- Web preferences and Person details: `frontend/src/pages/SettingsPage.tsx`, `PersonPage.tsx`.
- Mobile preferences: `mobile/app/(tabs)/profile.tsx`.
- Existing formatting: `packages/shared/src/lib/dates.ts` and formatting calls in both clients.
- Existing message interpolation: `packages/shared/src/lib/message-templates.ts`; preserve its separate contract for user-authored messages.
- Database migrations and authorization tests: `supabase/migrations/`, `supabase/tests/`.

Recheck these anchors before implementation. Existing application strings are distributed across screens, helpers and services; build a coverage inventory before claiming completion.

## Translation architecture

Proposed layout (namespace names may be refined during inventory):

```text
packages/shared/src/i18n/
  index.ts
  locales.ts                  # supported codes, native names, format locale, direction
  resolve-locale.ts           # pure language precedence and normalization
  format.ts                   # locale-aware date, number and duration presentation
  resources.ts                # explicit catalog imports for all runtimes
  types.ts                    # locale, namespace, key and interpolation contracts
  locales/
    en/
      common.json
      auth.json
      settings.json
      people.json
      plans.json
      scheduling.json
      songs.json
      messages.json
      errors.json
      notifications.json
    vi/
      ...same namespaces...
  README.md                   # translation and new-language contributor guide
frontend/src/i18n/             # React provider, browser detection/storage adapter
mobile/src/i18n/               # React provider, native detection/storage adapter
backend/src/lib/i18n.ts        # explicit per-recipient/request locale adapter
```

Use an established translation engine with React bindings (proposed: i18next and react-i18next); confirm current supported versions and integration requirements against official documentation when implementing. Share plain resources and pure helpers; keep React, browser storage and native APIs out of the shared/server runtime. Use explicit resource imports that work in compiled shared output and mobile bundling. Do not create a custom pluralization engine.

Requirements:

1. Stable semantic keys such as `settings.language.label` and `scheduling.assignment.confirm`; do not use English sentences as keys.
2. English defines the key contract. Type-check translation keys and required interpolation parameters where feasible; a catalog validation command must enforce namespace, leaf-key, plural-form and interpolation compatibility.
3. Translate whole sentences with named placeholders. Support locale-specific plural rules without requiring identical plural suffixes across languages. Avoid sentence fragments and concatenation.
4. Missing Vietnamese entries fall back to English at runtime; missing entries fail release validation. Missing English keys produce a safe user-facing fallback and development diagnostics, never raw keys in released UI.
5. Interpolation treats values as text. Escape correctly for each HTML, email, native or plain-text output; translations cannot inject executable markup.
6. Keep backend locale explicit per operation. Never mutate a process-wide language while serving concurrent users.
7. Register language code, native display name, formatting locale (`en-US` / `vi-VN` initially), and text direction centrally. Both initial languages use left-to-right layout. A future right-to-left language requires additional layout QA.

## Persistence and API

Add `people.preferred_language`, nullable `text`, default `null`. Persist canonical supported codes only. Use an additive migration with a database check constraint allowing `en`, `vi`, or null; avoid a PostgreSQL enum. A new supported language includes an additive constraint update, so database and application validation remain consistent. Test registry/constraint agreement in database validation.

No index is needed solely for displaying or updating this field by existing Person identity. Update shared row/domain types, explicit column lists, mappers, creation/update schemas and relevant projections. Omitted fields in PATCH preserve the existing choice; explicit null clears it. Person creation may accept a preference, and otherwise leaves it null. Preserve the field when a Person gains a Profile through invitation acceptance or linking.

Proposed self-service contract:

- `GET /api/v1/me/language-preference`, scoped by active Organization, returns `{ preferred_language: "vi" | "en" | null }`.
- `PATCH /api/v1/me/language-preference` accepts exactly `{ preferred_language: "vi" | "en" | null }` and returns the persisted value.
- Extend the existing authorized Person create/update contract for manager edits. Do not add a second preference store.
- Export named request/response types, validation and typed API client methods through the shared package.

Route names are proposals; use one consistent implemented contract. Both self-service routes must verify active Organization membership despite `/me` generally requiring only authentication. Resolve the existing Person through Organization and authenticated Profile; never accept an arbitrary self-service Person ID. If a legacy member lacks a linked Person, GET returns null and PATCH returns a stable `PERSON_LINK_REQUIRED` error. Do not create duplicate Person records; use existing identity repair/linking behavior separately.

Validate membership, ownership and the field restriction at the database boundary as well as in the API. A self-service language update must not grant the caller permission to edit names, medical data, contact data, identity links, or other Person fields. Prefer a narrowly scoped database operation if existing grants cannot express this safely. If a security-definer function is necessary, constrain its search path and grants, authenticate inside it, and validate active membership and ownership. Do not loosen general Person update policies.

People managers retain existing scope checks. Unrelated members, inactive members and people from another Organization cannot read or change someone else's preference through the new endpoint. Keep this field out of anonymous/public directory projections unless explicitly needed. Use existing private-detail permissions for manager reads.

## Resolution and lifecycle

Signed-in UI with an active church resolves:

1. Persisted explicit preference for that church's Person.
2. Supported browser/device language, checking the ordered language list.
3. English.

Signed-out and pre-Organization UI resolves an explicit anonymous device choice, then browser/device language, then English. That anonymous choice does not override a saved member preference or get silently persisted to the member. Normalize detected regional tags such as `vi-VN` to supported `vi`; skip unsupported tags. API writes accept canonical codes only and reject unsupported values.

Cache saved preferences by Profile ID and Organization ID for startup/offline display, then reconcile with the server. Clear account caches and reset to anonymous resolution on sign-out; keep an anonymous device preference separate. During Organization changes, suspend the previous context, load the new scoped value, and ignore late responses from the previous context. Never write an automatically detected language as an explicit preference.

Preference changes take effect without a full reload. Show pending state, prevent duplicate submission, and confirm only after persistence succeeds. On failure restore the previous language and show a translated retryable error. Offline users can view cached translations, but preference saving requires connectivity in this release. On another device, reconcile the saved preference on next bootstrap/refocus; real-time cross-device updates are not required. Concurrent saves use last successful write wins.

For system-generated messages, resolve the recipient Person's explicit preference, then English (there is no browser/device locale). Capture the resolved locale with each newly queued delivery so retries remain consistent. Legacy queued deliveries without locale continue in English. Reuse the existing outbox and delivery flow; never select every recipient's language from the sender's UI language. Token-based recipient pages may use the recipient preference only after the existing token authorization succeeds; otherwise use anonymous resolution. A local language toggle on such a page must not modify the Person record without authentication.

## User experience and coverage

- Web Settings and mobile Profile show “Language / Ngôn ngữ” with Automatic, English, and Tiếng Việt. Explain that the saved choice applies to the current church. Managers see the same field on Person creation/details forms.
- Translate navigation, screen titles, actions, placeholders, accessibility labels, validation, empty/loading/error states, dialogs, statuses, help text, public/auth flows and application-owned print/export labels. Inventory every currently shipped screen on both clients, including infrequently used admin screens.
- Keep machine error codes, enum values, URLs and API contracts stable. Map structured errors and validation codes to localized text. Unknown errors use a localized generic message; do not expose raw database/provider errors.
- Localize application-owned invitation, assignment, reminder and notification subject/body/action text per recipient, including push and email where supported by existing delivery paths. User-authored messages and templates remain unchanged.
- Use the selected formatting locale for displayed dates, times, numbers and relative durations. Continue using the existing Organization timezone and scheduling rules. Language must not change stored timestamps, recurrence semantics, week-start rules, machine CSV formats or date input values.
- Keep Person names, church names, team names, plan titles, song titles/lyrics, notes, chat content and uploaded files exactly as authored. Automatic content translation is out of scope.
- Set the web document language and direction; verify Vietnamese diacritics in web, native and exported/printed fonts. Layout must tolerate longer text and accessibility font scaling.

Vietnamese text should be natural church-facing language. Maintain a glossary that distinguishes Plan, Service, Rehearsal, Invitation and Assignment; have a Vietnamese-speaking reviewer check these terms and critical flows before release. Record review as pending if unavailable.

## Future-language workflow

1. Add the locale registry entry and format/direction metadata.
2. Add catalogs under `i18n/locales/<code>/` using the English namespace/key structure and the new language's plural rules.
3. Validate translation completeness, interpolation, formatting and font support.
4. Extend the database constraint in an additive migration before enabling writes from clients; deploy server support before clients expose the new option.
5. Run permission, fallback and UI checks; review translations with a fluent speaker.

The language selector reads the registry. Screens and message services must not acquire new `if language === ...` branches. Document compatibility behavior for an older client encountering a newly added locale: display English safely without overwriting the saved value. Translation-management SaaS, church-specific catalog overrides and live translation editing are future work.

## Delivery phases

1. Foundation: catalog registry, resolver, engine adapters, validation, shared types, persistence, narrow authorization, typed API, language controls and end-to-end saved preference. Include enough real UI to verify both clients.
2. UI coverage: complete web/mobile/auth/public inventories, errors, accessibility text, dates/numbers and application-owned output labels.
3. Delivery and release: per-recipient transactional translations, retry locale stability, catalog completeness, Vietnamese review and device/print QA.

All phases are required for full completion. Track screen/message inventory and evidence in `docs/plans/i18n-vietnamese-progress.md`, created when implementation begins.

## Acceptance criteria

1. Choosing Tiếng Việt persists on the correct Person, survives reload/sign-in, and appears on the other client after refresh. Explicit English overrides a Vietnamese device language.
2. Automatic is stored as null; Vietnamese devices resolve to Vietnamese, unsupported device languages fall back to English, and existing people are not silently assigned explicit preferences.
3. Different church preferences remain independent across switches; late responses and another account's cached data cannot select the wrong language.
4. A no-login Person retains the manager-set preference after invitation acceptance and receives system text in that language.
5. API and direct database tests deny cross-tenant/inactive/unrelated writes and attempts to change other Person fields through self-service. Invalid codes fail in both layers; omitted PATCH fields preserve the choice.
6. Save failure restores the previous selection; offline saving is explained without false success. Missing Person links produce a clear, recoverable message.
7. Every shipped UI/message inventory item is translated or explicitly classified as user content, a machine format, or an external provider limitation. Provider-owned auth emails/native OS dialogs are identified separately, not claimed as translated by the app.
8. Catalog checks detect missing keys, incompatible plural forms and mismatched interpolation. Runtime fallback never shows raw keys. Test at least Vietnamese diacritics, zero/one/many counts and interpolated names.
9. Dates near midnight and daylight-saving transitions retain their existing scheduling meaning in both languages. Formatting changes do not corrupt date-only values or machine exports.
10. Two simultaneous recipients with different preferences get different appropriate system text; retrying a queued delivery preserves its captured locale.
11. Web and iOS/Android bundles build; both languages render with correct fonts, accessible labels and no clipped critical controls. Vietnamese language review is explicitly recorded.
12. A test-only third catalog can be registered and selected without editing screens; the contributor guide covers the database/deployment step for making it persistable.
