# Translations (i18n)

Service Center ships English (`en`) and Vietnamese (`vi`). English is the
fallback and defines the key contract. Web, mobile and the server share the
catalogs and helpers in this directory; each client wraps them in its own
adapter (`frontend/src/i18n`, `mobile/src/i18n`), and the server uses
`translatorFor(locale, namespace)` through `backend/src/lib/i18n.ts`.

Engine: [i18next](https://www.i18next.com/) (plurals via `Intl.PluralRules`,
CLDR suffixes) with [react-i18next](https://react.i18next.com/) bindings in the
clients. We do not maintain our own translation or plural engine.

## Layout

```text
locales.ts            registry: code, native name, Intl format locale, direction
resolve-locale.ts     pure precedence (saved → device → English; signed out: token recipient → device choice → device → English)
format.ts             locale-aware dates, times, numbers (never changes timezone or stored values)
resources.ts          explicit JSON imports for every runtime + NAMESPACES
engine.ts             createI18n (clients), translatorFor (server, per recipient), translateMessage
types.ts              typed keys (CustomTypeOptions augmentation), TranslatableMessage
validate.ts           catalog validation used by `npm run i18n:check` and tests
errors.ts             API error code → localized message (presentError)
preference-controller.ts  save/cache/reconcile lifecycle shared by both clients
locales/<code>/<namespace>.json
```

Namespaces: `common`, `auth`, `errors`, `settings`, `people`, `plans`,
`scheduling`, `songs`, `teams`, `messages`, `media`, `reports`,
`notifications` (server-rendered email/push/feed text).

## Adding or changing text

1. Pick the feature namespace. Use stable **semantic** keys
   (`settings.language.label`, `plans.items.empty`) — never an English
   sentence as a key.
2. Add the English value to `locales/en/<namespace>.json`, then the same key
   to every other language.
3. Translate **whole sentences** with named placeholders:
   `"Remove {{name}} from {{team}}?"`. Never concatenate fragments
   (`t('remove') + name`), because word order differs between languages.
4. Placeholders are plain text. Do not put HTML in catalogs and never use the
   unescaped `{{- value}}` form; the validator rejects both. React/React Native
   escape text automatically; server templates escape per output format.
5. Plurals: pass `count`, and give each language the forms **its own** plural
   rules need. English needs `_one` and `_other`; Vietnamese only `_other`.
   An optional `_zero` is allowed in any language for natural "none" wording.
   ```json
   // en                                  // vi
   "people_one": "{{count}} person",       "people_other": "{{count}} người"
   "people_other": "{{count}} people"
   ```
6. In code: `const { t } = useTranslation('plans'); t('items.empty')`. Keys
   are type-checked against English. Format dates and numbers with
   `useFormatters()` (clients) or `recipientLanguage()` (server) — not
   `toLocaleDateString('en-US')`. Show errors with `<ErrorNotice>` /
   `useErrorText()`; throw `new LocalizedError({ key: 'errors:…' })` for
   client-side messages.
7. Run `npm run i18n:check`. It fails on missing namespaces or keys, extra
   keys, wrong plural forms, mismatched placeholders, markup or empty values.

At runtime a missing Vietnamese entry falls back to English, and a key missing
everywhere renders as an empty string (with a development warning) — never as
a raw key. Missing entries still fail release validation.

### What is not translated

User-authored content stays exactly as written: Person, church, team,
position and service type names, plan titles, song titles/lyrics/charts,
notes, chat and message text, file names, and the leader-written subject/body
of targeted messages (`message-templates.ts` keeps its own `{{variable}}`
contract, separate from i18next). Machine contracts stay stable: API error
codes, enum values, URLs, CSV/ICS formats, `<input type="date">` values.
Provider-owned text (Supabase Auth emails, OS permission dialogs, the
native date picker) is outside the app's catalogs.

## Adding a language

No screen or message service changes are needed — they only call `t()` and
read options from the registry. Never add `if (language === …)` branches.

1. **Registry** — add `{ code, nativeName, englishName, formatLocale,
   direction }` to `LOCALE_DEFINITIONS` in `locales.ts`. Right-to-left
   languages also need layout QA (both launch languages are LTR).
2. **Catalogs** — copy `locales/en/` to `locales/<code>/`, translate every
   value, and use the new language's plural forms (check
   `new Intl.PluralRules('<code>').resolvedOptions().pluralCategories`).
   Import the files in `resources.ts`.
3. **Validate** — `npm run i18n:check`, `npm test -w @service-center/shared`.
   Check fonts render the script on web (system font stacks in
   `frontend/src/index.css`), iOS/Android system fonts
   (`mobile/src/lib/theme.ts`), and PDF/print output
   (`frontend/src/lib/chart-export/fonts.ts`).
4. **Database** — in a **new** migration, replace both check constraints
   additively:
   ```sql
   alter table public.people drop constraint people_preferred_language_check,
     add constraint people_preferred_language_check
     check (preferred_language in ('en', 'vi', '<code>')) not valid;
   alter table public.people validate constraint people_preferred_language_check;
   -- same for deliveries_locale_check on public.deliveries,
   -- and the code list in set_my_language_preference()
   ```
   `supabase/tests/i18n-preferred-language.sql` asserts the database codes
   equal the registry; update its expected list.
5. **Deployment order** — migration first, then the server (so it accepts and
   renders the code), then clients that offer it. An older client that meets
   the new saved value shows English and keeps the saved value (it never
   overwrites it); its selector shows "Saved language (xx) is not available
   in this version".
6. **Review** — permission, fallback and UI checks; a fluent speaker reviews
   the catalogs and the glossary below before release.

## Vietnamese glossary

Church-facing terms. Keep them consistent; a Vietnamese-speaking reviewer
must confirm them before release (tracked in
`docs/plans/i18n-vietnamese-progress.md`).

| English (CONTEXT.md term) | Vietnamese | Notes |
| --- | --- | --- |
| Organization / church | Hội thánh | The tenant. |
| Plan | Chương trình | The record of one service: date, running order, people. |
| Service | Buổi nhóm | The occasion itself ("Buổi nhóm Chúa Nhật"). |
| Service Type | Loại buổi nhóm | e.g. "Sunday Morning". |
| Rehearsal | Buổi tập | Distinct from the service. |
| Plan Item | Mục (trong chương trình) | Running-order entry. |
| Person | Thành viên | Roster identity, with or without login. |
| Profile / login | Tài khoản | |
| Team | Ban | e.g. Ban nhạc, Ban âm thanh. |
| Position | Vị trí | |
| Assignment | Phân công | Being scheduled; carries the answer. |
| Schedule (verb) | Phân công / Xếp lịch | |
| Invitation | Lời mời tham gia | Joining the church only — never for serving. |
| Notify | Thông báo | Asking an assigned person to confirm/decline. |
| Confirm / Decline | Xác nhận / Từ chối | |
| Unconfirmed | Chưa xác nhận | |
| Blockout | Ngày bận | A declared unavailable window. |
| Availability | Lịch rảnh | |
| Respond link | Liên kết trả lời | |
| Schedule feed | Lịch đăng ký | Calendar subscription. |
| Song / Arrangement / Chord chart | Bài hát / Bản phối / Bảng hợp âm | |
| Song book | Sách bài hát | |
| Release (assignments) | Gửi phân công | |
| Leader | Trưởng ban | |
| Scheduler | Người phân công | |
| Admin / Owner | Quản trị viên / Chủ sở hữu | |

Use polite, natural second person ("bạn"), sentence case, and avoid
machine-literal phrasing.
