# i18n (English + Vietnamese) progress ledger

Tracks [docs/specs/i18n-vietnamese.md](../specs/i18n-vietnamese.md). Branch `codex/i18n-vietnamese` from `main` @ `f24e5c0` (clean tree at start). **Uncommitted**; nothing pushed, deployed or sent. Statuses: `not started`, `in progress`, `implemented; QA pending`, `complete`, `blocked`.

| Phase | Status | Next action |
|---|---|---|
| 1 Foundation — registry, resolver, engine adapters, validation, persistence, narrow authorization, typed API, language controls | implemented; QA pending | Apply migration to a shared environment; signed-in two-client check (web Settings ↔ mobile Profile) |
| 2 UI coverage — web/mobile/auth/public inventory, errors, a11y, dates/numbers, print/export labels | implemented; QA pending (Gaps §5–7 remain) | Gaps §5–7 (report row placeholders, default arrangement name, live clock formatter) |
| 3 Delivery and release — per-recipient text, retry stability, catalog gate, Vietnamese review, device/print QA | implemented; QA pending | Vietnamese-speaker review; device QA; real-provider email/push check |
| Epic | in progress — **not complete** | Gates below |

## Implementation notes

**Libraries** (checked against official docs on 2026-10-19; versions pinned ≥ 2 weeks old): `i18next@^26.4.2` (shared; CLDR plural suffixes via `Intl.PluralRules`, interpolation, `getFixedT`), `react-i18next@^17.0.15` (web + mobile, `useSuspense: false` since catalogs are bundled), `expo-localization@~57.0.2` (Expo SDK 57 bundled version; `getLocales()` ordered `languageTag`s; Android can change locale while running, so it is re-read on foreground), `intl-pluralrules@^2.0.1` on mobile only (Hermes' Intl docs do not list `Intl.PluralRules`; the polyfill installs only when missing). No custom translation or plural engine.

**Shared** (`packages/shared/src/i18n/`): `locales.ts` registry (code, native name, `Intl` locale `en-US`/`vi-VN`, direction), `resolve-locale.ts` (pure precedence), `format.ts` (calendar dates never shifted; instants in the given zone), `resources.ts` (explicit `with { type: 'json' }` imports — compiled into `dist/`, read natively by Node, bundled by Vite and Metro/Babel), `engine.ts` (`createI18n` for clients; `translatorFor(locale, ns)` for the server — one instance, never `changeLanguage`, per-call fixed translators), `types.ts` (typed keys via `CustomTypeOptions`), `validate.ts` + `scripts/check-catalogs.mjs`, `errors.ts` (`presentError`, `LocalizedError`), `preference-controller.ts` (lifecycle shared by both clients), `README.md` (contributor guide + glossary). 16 namespaces: common, home, auth, errors, settings, people, plans, templates, staffing, scheduling, songs, teams, messages, media, reports, notifications — **3,774 English / 3,623 Vietnamese strings** (Vietnamese has only `_other` plural forms).

**Persistence** (`supabase/migrations/20261104000000_i18n_preferred_language.sql`, additive): `people.preferred_language text null` + `people_preferred_language_check` (`en`,`vi`; added `NOT VALID` then validated); no backfill. Column-level select grant (rows still gated by `people_select`); not in `people_directory`. Self-service only through `public.my_language_preference(org)` / `public.set_my_language_preference(org, code)` — `security definer`, `search_path=''`, `auth.uid()` required, active membership required (else `P0002` → 404), finds the Person by organization + caller's login (never a client Person id), updates only that column, never creates a Person (returns `person_linked=false`). General `people_write` policy untouched. `deliveries.locale` + `deliveries_locale_check` + `BEFORE INSERT` trigger capturing the recipient Person's preference (else `en`) for every enqueue path; legacy rows stay null → English.

**API** (`backend/src/routes/me.ts`): `GET /api/v1/me/language-preference` → `{ preferred_language, person_linked }`; `PATCH` accepts exactly `{ preferred_language: 'en'|'vi'|null }` (strict Zod; regional tags/unknown codes/extra fields → 422); no linked Person → 409 `PERSON_LINK_REQUIRED`; church from `X-Organization-Id` or the caller's only church (else 400 `organization_required`). Manager edits ride the existing `people.manage` create/update (`preferred_language` added to `createPersonSchema`/`updatePersonSchema`, `PERSON_COLUMNS`). Typed client: `getLanguagePreference(scope?)`, `updateLanguagePreference(body, scope?)`; `RequestScope` pins a call to a church so a switch mid-request cannot redirect a write. Token previews (`/respond`, `/accept-invite`) add `preferred_language` after token verification; `person_first_name` is now `''` instead of the English word "there".

**Clients**: `frontend/src/i18n/` and `mobile/src/i18n/` (provider, `useLanguage`, `useRecipientLanguage`, `useFormatters`, `useErrorText`; web `LanguageSelect`, `AnonymousLanguageToggle`, `PersonLanguageField`; mobile `LanguageSelector`). Web sets `<html lang dir>`. Controls: web Settings, mobile Profile, web Person form (managers), language toggle/selector on signed-out and token pages.

**Notifications**: `backend/src/lib/i18n.ts` (`recipientLanguage`). Email templates (schedule, consolidated, reminder, service reminder, availability, operational footer, invitation, new scheduler-response template), in-app feed titles/bodies, push title/body, ICS calendar names — all rendered from the delivery's captured locale (`DeliveryJob.locale`). The invitation email uses the invited Person's saved language. User-authored message subject/body and `message-templates.ts` interpolation are unchanged.

## Resolution and lifecycle (as implemented)

- Member with an active church: saved → (reserved church default) → device languages in order (`vi-VN`→`vi`) → English. Signed out / before a church: verified token recipient (token pages only) → anonymous device choice → device → English. The anonymous choice is ignored for members and never written to a Person.
- Cache `service-center.language.accounts` keyed `profileId:organizationId`; shown at startup/offline, then reconciled (bootstrap, window focus / app foreground). Cleared on sign-out; device choice `service-center.language.device` kept separately.
- Every context change bumps an epoch; late load/save responses from an older context are dropped (`stale`).
- Save: new language shown while pending, duplicate submission returns `busy`, confirmed only after the server returns; failure restores the previous value with a translated retryable error; offline (`navigator.onLine` false, or a fetch `TypeError`) → "connect to save", no false success; `PERSON_LINK_REQUIRED` → recoverable message, selector disabled.
- Unsupported saved code from a newer client: English displayed, value preserved and shown as "Saved language (xx) is not available in this version"; manager form omits the field so the value is kept.
- Detected languages are never persisted.

## Coverage inventory

Every shipped screen was assigned and converted file by file (16 namespaces). "Kept" items are classified, not translated.

| Area / namespace | Web | Mobile | Kept (classification) |
|---|---|---|---|
| Shell & dashboard (`home`, `common`) | AppShell, GlobalSearch, DashboardPage, HelpPage, router loading, ui.tsx (ErrorNotice, Loading, Menu) | (tabs)/_layout, ui.tsx ErrorNotice | "SC" logo initials (brand) |
| Auth & public (`auth`) | LoginPage, AcceptInvitePage, RespondAssignmentPage, OnboardingPage, PublicPlanPage, PublicPlanView | (auth)/login, accept-invite, respond, link-result, +not-found, open/plan/[id], _layout titles | Demo login hint values (dev-only); Supabase Auth emails (provider-owned) |
| People (`people`) | PeoplePage, PersonPage (+ language field), people/*, PersonPolicyPanel, TagSelect | — | Names, emails, tags (user content) |
| Settings (`settings`) | SettingsPage (+ Language), settings/* (15) | (tabs)/profile (+ Language) | Scope/event identifiers, `sck_`/`evt_` ids, IANA zones, format placeholders (machine); provider names |
| Plans (`plans`) | PlansPage, PlanDetailPage, plan/{Header, Sidebar, OrderTab, AddItem, EditItem, EditTimes, TimeImpactReview, PrintOrder, ShareTab, RehearseTab}, print-document | plan/[id], plan/rehearse/[id] | Chordpro sequence placeholders; `ineligible_reason` (server text) |
| Templates (`templates`) | PlanTemplatesPage, GeneratePlansPage, ReschedulePlansPage, templates/*, ImportTemplateModal | — | Notices/problems worded from `code` + `params` (Gaps §4 closed); pre-migration notices and unknown codes fall back to the server's English |
| Staffing (`staffing`) | plan/{TeamsTab, SchedulePeople, AddGuest, AssignmentTimes, DeliveryOutcome, Opportunity, PlanDelivery}, StaffingMatrix, StaffingProposals, ReleaseReview, scheduling/* | — | Preference/matrix warnings and proposal reasons/vacancies/warnings worded from structured data (Gaps §1–3 closed); proposals stored before `reason_details` keep recorded English rotation/fairness lines |
| Scheduling (`scheduling`) | MySchedulePage, CalendarPage, BlockoutSeriesPage, CalendarExtensions | (tabs)/index, (tabs)/calendar, notifications, AssignmentResponses, BlockoutForm, NotificationBell, assignment-response-drafts | Native date picker / browser date inputs (OS-owned); stored feed rows shown as stored |
| Songs (`songs`) | SongsPage, SongDetailPage, ChartEditorPage, SongbooksPage, SongbookPage, ImportsPage, AddSongModal, KeySelect, ChartNotationSelect, ChordChart, chart-editor/*, song/*, chart-export/* | (tabs)/songs, (tabs)/songbooks, song/[id], songbooks/[id], ArrangementPicker | Song titles, lyrics, charts, keys, chordpro section tokens, font names, import field names (user content / notation / machine) |
| Teams (`teams`) | TeamsPage, TeamEditor, TeamPolicyModal, AvailabilityRequestsModal, ServiceTypeWizardPage, service-type/* | — | `COMMON_TEAM_TEMPLATES` names (become user content when created) |
| Messages (`messages`) | MessagesPage, ChatPage, collaboration/* | — | Message/chat/note bodies; `{{variable}}` tokens (user-template contract) |
| Media & live (`media`) | MediaPage, LivePage, files/*, media/*, live/*, rehearsal/*, stage/* | — | File/media/layout names; file-size units; `v{n}` |
| Reports & attendance (`reports`) | ReportsPage, report-print, AttendanceTab, attendance.tsx | — | CSV headers/values and filenames (machine format) |
| Print / export (shared) | Running order (`run-sheet.ts`), service song book (`service-song-book.ts`), chart byline + `lang` (`chart-html.ts`), report print | — | Typeface names; musical keys |
| System messages (`notifications`) | Email (all templates), in-app feed, push, ICS calendar name, invitation | Same server output | Team calendar feed name (shared feed, no single recipient → English); operational message subject/body (user-authored) |
| Errors (`errors`) | Mapped API codes, generic by status, network/offline, validation (Zod `code` now in 422 details) | Same | Unmapped 4xx server sentences shown as written in English UI; localized generic in Vietnamese |

### Gaps

Server-built English **detail sentences** (names, counts, dates inside the text). §1–4 were closed on 2026-10-19 by making the producers emit stable codes + parameters (additive; the English `detail`/`message`/`reason` fields stay for older clients and stored records) and wording them with the shared renderers in `packages/shared/src/i18n/structured-text.ts` (`staffing:structured.*`, `templates:notices.*`, `templates:problems.*`).

| # | Producer | Status | How |
|---|---|---|---|
| 1 | `scheduling_preference_warnings` SQL (`PreferenceWarning.detail`) — SchedulePeopleModal | **closed** | Migration `20261104000100_i18n_structured_notices.sql` re-creates the function (same arguments, body, grants) with a `params jsonb` column: `frequency {frequency}`, `monthly_max {served, max}`, `avoided_week {week}`, `availability_stale {reviewed_on}`, others `{}`. Backend validates `params` from `unknown` (`toPreferenceWarningParams`); web renders `preferenceWarningText`. |
| 2 | `backend/src/services/staffing-matrix.ts` preview `warnings: string[]` | **closed** | `StaffingMatrixPreviewItem.warning_details: StaffingMatrixWarning[]` (`preference` with the structured warning, `copy_resets_answers`, `team_unavailable`) alongside the unchanged English `warnings`; web renders `staffingMatrixItemWarnings`. |
| 3 | `packages/shared/src/lib/staffing-proposals.ts` reasons, vacancies, warnings | **closed** | `ProposalChoice.reason_details` (`kept_existing`, `locked`, `rotation_week`, `rotation_exception`, `all_have_preference_warnings`, `no_preference_warnings`, `served_count`, `chosen_over` + `ProposalTieBreak`); `ProposalVacancy.params` / `ProposalWarning.params` (`person_name`, `plan_title`, `date`, `rotation_name`, `exclusion`, `preference_codes`, `skipped`). Rule version unchanged (ordering is unchanged). Stored proposals without the new fields: kept/locked lines are still worded from the choice; rotation/fairness lines and old vacancies/warnings show their recorded English. |
| 4 | `packages/shared/src/lib/plan-templates.ts` problems; F10 SQL notices with values | **closed** | Failed resolutions and `GenerationDateProblem` carry `problem: TemplateTimeProblem` (`time_skipped`, `noon_skipped`, `date_collision`, `edit_not_in_series`, `no_dates`, `service_time_skipped`, `moved_time_skipped`); `template_time_unresolvable` / `reschedule_time_unresolvable` errors carry it in `details`. Same migration re-creates `private.plan_template_preview`, `private.plan_shift_preview`, `private.plan_order_move_preview` adding `params` to `older_revision {revision, latest}`, `date_taken {service_type, date}`, `confirmed_kept`/`conflicts`/`arrangement_missing`/`times_added`/`already_applied {count}`, `item_discussion_removed {count, scope: moved|destination|current}`. Web renders `templateNoticeText` / `generationProblemText`. A template preview made before the migration hashes differently, so applying it afterwards asks for one fresh preview. |
| 5 | Report rows: "No position" / "Unknown person" baked into data by `lib/reports.ts`; `report.model.ts` `scopeNote()` (translated client-side by kind as a stopgap) | open | Emit null/sentinel values and a scope-note code. |
| 6 | Backend default arrangement name 'Default Arrangement' for API callers that omit a name (web always sends one) | open | Leave English or take a locale from the caller. |
| 7 | Live run clock with seconds and "Sun 9:00" use `Intl` with the display locale directly (no `useFormatters` preset) | open (cosmetic) | Add `seconds`/weekday-time presets to `format.ts`. |

Mobile shows none of the §1–4 surfaces (staffing, proposals, templates and rescheduling are web-only today).

Shared English label maps (`ASSIGNMENT_STATUS_LABELS`, capability/delivery/reminder/webhook/report maps…) remain exported for compatibility but are no longer displayed by web or mobile.

## Acceptance criteria — evidence

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Tiếng Việt persists on the correct Person, survives reload/sign-in, other client after refresh; explicit English beats Vietnamese device | implemented; QA pending | DB: `supabase/tests/i18n-preferred-language.sql` (self save/read, last write wins); API: `me-language.test.ts`; controller: cache + reconcile + `saved` precedence tests; resolver test "saved over device". **Pending:** signed-in web↔mobile check against a database with the migration applied. |
| 2 | Automatic = null; Vietnamese device → vi; unsupported → en; no silent assignment | implemented | Resolver tests (`fr-FR,vi-VN`→vi, `fr,de`→en); DB asserts no non-null values after migration and nullable/no default; controller "never writes detected language". |
| 3 | Church preferences independent; late responses/other account cache can't select wrong language | implemented | Controller tests: per profile+church cache, late response after switch ignored, other account's cache unused, save landing after sign-out dropped; API test "keeps churches independent"; `RequestScope` pins org per call. |
| 4 | No-login Person keeps manager-set preference after invitation acceptance and gets system text in it | implemented; QA pending | DB test: manager sets `vi` on no-login Person → `accept_person_invitation` → new login reads `vi`; invitation email uses `person.preferred_language`; deliveries capture it. **Pending:** real email check. |
| 5 | Cross-tenant/inactive/unrelated writes and other-field changes denied in API and DB; invalid codes fail in both; omitted PATCH fields preserve | implemented | DB test (as `authenticated`/`anon`/`service_role`): foreign church `P0002`, inactive member `P0002`, unrelated member 0 rows, member direct update 0 rows (language and other fields), only `preferred_language` changed by self-service, anon cannot execute, invalid codes `22023`/`23514`; API test rejects regional tag, unsupported code, missing field, extra Person field, Person id (422). Manager PATCH uses `updatePersonSchema.partial` (omitted keeps value; `personLanguageInput` omits unsupported). |
| 6 | Save failure restores; offline explained; missing link recoverable | implemented; QA pending | Controller tests (failure restore, offline refuse, fetch TypeError → offline, `PERSON_LINK_REQUIRED`); web/mobile selectors render these states. **Pending:** device offline check. |
| 7 | Every shipped UI/message item translated or classified; provider-owned text identified | implemented with gaps | Inventory above; whole-app literal sweep (only classified items remain); Gaps §1–4 closed with structured codes + params (`structured-text.test.ts`, `availability.model.test.ts`, `i18n-structured-notices.sql`, F10 param assertions); §5–7 remain open and are listed. |
| 8 | Catalog checks detect missing keys / plural / interpolation; no raw keys; diacritics, 0/1/many, names | implemented | `npm run i18n:check` OK; `i18n.test.ts` validator cases (missing key/namespace, extra key, wrong plural forms, placeholder mismatch, unescaped/markup), runtime fallback renders '' never the key, `Ảnh của Nguyễn Thị Ánh`, 0/1/5 counts in both languages. |
| 9 | Midnight/DST keep scheduling meaning; date-only and exports unchanged | implemented | `i18n.test.ts`: `2026-11-01` never shifted, New York fall-back 1:30 AM twice, Ho Chi Minh 23:30 stays the 31st, Sunday first weekday; `delivery-locale.test.ts`: 08:30 CST after DST change in both languages. CSV/ICS/date inputs unchanged (inventory). |
| 10 | Two simultaneous recipients get different text; retry keeps captured locale | implemented | `delivery-locale.test.ts` (real dispatcher, fake DB + fake provider, out-of-order sends; retry after preference change still Vietnamese; legacy null → English); concurrent `translatorFor` test; DB test: trigger captures `vi`/`en`, retry update keeps locale, explicit locale kept, `fr` refused. |
| 11 | Web + iOS/Android bundles build; fonts/labels/no clipping; Vietnamese review recorded | builds pass; **QA pending** | `npm run build` OK (catalogs in web bundle); `expo export --platform ios --platform android` OK into fresh `/private/tmp/service-center-native-i18n-1792453747`, both Hermes bundles contain catalogs + PluralRules polyfill. Fonts: web/mobile system stacks and bundled Roboto (PDF) cover Vietnamese diacritics (glyph-map check by the songs pass). Browser check: `/respond` switched to Tiếng Việt without reload, `<html lang="vi">`, diacritics render. **Pending:** device QA (both themes, large text, clipping), print QA, **Vietnamese-speaker review not performed.** |
| 12 | Test-only third catalog registers and selects without screen edits; guide covers DB/deploy | implemented | `i18n.test.ts` "a test-only third language" (registry options, saved/detected resolution, rendering + English fallback); `packages/shared/src/i18n/README.md` (registry, catalogs, constraint migration, deployment order, older-client behaviour, review). |

## Checks run (2026-10-19, Node 26.9.0 / npm 11.19.1)

| Check | Result | Kind |
|---|---|---|
| `npm run i18n:check` | OK — 16 namespaces, en 3,774 / vi 3,623 | catalog validation |
| `npm run typecheck` | exit 0 (shared, backend, frontend, mobile) | static |
| `npm test` | exit 0 — shared 324, backend 197, mobile 42 tests | unit (mocks/fakes) |
| `npm run build` | exit 0 (Vite chunk-size advisory only) | build |
| `expo export --platform ios --platform android` (EXPO_OFFLINE=1 CI=1, fresh output dir) | exit 0; catalogs + polyfill present in both `.hbc` | native bundle (not device QA) |
| `supabase/tests/i18n-preferred-language.sql` | `i18n-preferred-language: ok` | **real local Postgres** (migration applied inside the test transaction, rolled back; local DB verified unchanged) |
| Existing DB suites with the migration applied in-transaction: delivery-outbox, f02-person-identity, f02-roster-extensions, f08-release-reminders, f09-notes-messages-chat, f03-preferences-delegation, mob005-snapshots-and-attendance, assignment-notifications-rls, f01-scoped-access | no errors | real local Postgres |
| Gaps §1–4 pass (2026-10-19): `npm run i18n:check` | OK — en 3,845 / vi 3,684 | catalog validation |
| Gaps §1–4 pass: `npm run typecheck`, `npm test`, `npm run build` | exit 0; tests shared 335, backend 198, mobile 42 | static / unit (fakes) / build |
| Gaps §1–4 pass: `i18n-structured-notices.sql`, `i18n-preferred-language.sql`, `f10-plan-templates.sql`, `f10-plan-reschedule.sql` (new param assertions), `f03-preferences-delegation.sql`, `f05-staffing-matrix.sql`, `f06-rotations-proposals.sql`, `mob006-availability.sql` — both i18n migrations applied inside each rolled-back transaction | all pass; F10 param assertion fails without the new migration (negative check); local DB verified unchanged | **real local Postgres** |
| Browser (`/respond`, signed-out toggle) | Vietnamese render, `lang=vi`, no i18n console errors; reset to Automatic | manual browser check (API not running) |

The new migrations (`20261104000000_i18n_preferred_language.sql`, `20261104000100_i18n_structured_notices.sql`) are **not** applied to the local development database (tests apply them inside rolled-back transactions). After applying migrations normally, run `supabase/tests/i18n-preferred-language.sql` and `supabase/tests/i18n-structured-notices.sql` with `docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < <file>`.

## Pending gates

1. **Vietnamese-speaker review** of all catalogs and the glossary (Plan/Service/Rehearsal/Invitation/Assignment) — not performed.
2. **Device QA** (iOS/Android dev builds): language switch without reload, Android foreground locale change, offline save message, accessibility font scaling/clipping, both themes, VoiceOver/TalkBack language of options.
3. **Signed-in end-to-end**: apply the migration, save on web Settings, refresh mobile Profile; switch churches; sign out/in.
4. **Real provider check** of Vietnamese email/push (provider fakes only so far).
5. **Print QA**: running order, song book, chart PDF, report print in Vietnamese.
6. **Gaps §5–7** (report row placeholders, default arrangement name, live clock presets). §1–4 closed.

## Deployment order

Migrations (`…000000` then `…000100`) → backend (accepts and renders `vi`, new routes, structured params) → web/mobile. Product decision to confirm: application-generated defaults (new plan's default time name, add-item fallback title, default arrangement names, stage gear presets) are now written in the creator's display language and become authored content.

## Next action

Vietnamese-speaker review (now including the `staffing:structured.*`, `templates:notices.*` and `templates:problems.*` sentences) and signed-in device QA on a build with both i18n migrations applied; then Gaps §5–7.
