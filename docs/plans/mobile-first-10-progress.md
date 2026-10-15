# Mobile first-ten progress ledger

Tracks [the MOB-001–MOB-010 prompt pack](../prompts/mobile-first-10/README.md). One row per task/pass; details below the table. A task is `complete` only when its full acceptance gate passes.

| Task / pass | Status | Branch | Next action |
|---|---|---|---|
| MOB-001 shared UI and device review | implemented; QA pending | `codex/mob-001-ui-review` (committed `7270b56`) | Signed-in native device matrix (below), then mark complete |
| MOB-002 Pass A — chart context + arrangement picker | implemented; QA pending | `codex/mob-002-plan-chart-context` (uncommitted, branched from `7270b56`) | Signed-in device check of plan → chart and picker (below) |
| MOB-002 Pass B — persisted per-item sequence | not started | — | **Next pass** (task stays partial until done) |
| MOB-003 – MOB-010 | not started | — | Per README order |

## MOB-002 Pass A — 2026-10-15

**Baseline confirmed:** plan rows pushed `/song/<songId>` only; the song screen always took the default (or first) arrangement and ignored `key_override`. No per-item sequence column exists (`plan_items` has `arrangement_id`, `key_override` only) — that is Pass B. `plan_items.arrangement_id` is `on delete set null` and has no DB check that the arrangement belongs to the item's song, so the client resolver verifies the relationship. MOB-003 cache conventions not yet present; queries stay keyed `[kind, organizationId, id]`.

**Delivered**

- `packages/shared/src/lib/chart-context.ts` (exported): `resolveChartContext` → `ready` {source `plan|library`, arrangement, planArrangement, isTemporaryView, sourceKey, displayKey, keyFromPlan, sequence} or `unavailable` {`not_a_song | song_mismatch | arrangement_missing`}. Precedence: item's arrangement (looked up among the song's own arrangements — an unknown/deleted/other-song id is unavailable, never the default); song default (`is_default` → first, same as web `resolveArrangement`) only when the item chose none or in the library. Display key = item override → arrangement key → song default key. `renderChartContext` computes the target key once (display key + reader shift) and passes it to `renderChordProChart`, so chords and label are one result; missing/unreadable key → `key_unknown` instead of mislabelled chords; empty chart → `no_chart`. Numbers/numerals read off the written key; lyrics need no key.
- `mobile/app/plan/[id].tsx`: song rows push `/song/[id]?planId&itemId`. Ordinals now skip headers; length column `minWidth` (MOB-001 observations).
- `mobile/app/song/[id].tsx`: params validated as UUIDs (partial/forged plan context → "link isn't valid", not silent library fallback); re-fetches plan (RLS) and song; item resolved by id; loading until both settle; explicit item-missing / mismatch / arrangement-missing / no-chart / key-unavailable / no-arrangements states. View state lives in a child keyed by org:song:plan:item, so transpose, notation and picked arrangement reset on any context change. Plan context labels "Service key", shows plan title; viewing another arrangement shows a "nothing is saved" notice with a return button. Arrangement change resets shift.
- `mobile/src/components/ArrangementPicker.tsx`: wrapping radio chips, 44pt targets, marks "In this plan"/"Default", shown when the song has >1 arrangement.

**Checks (Node 26.9.0 / npm 11.19.1)**

- `vitest run src/lib/chart-context.test.ts` — 13 pass: non-default arrangement + override (B in A over default A in C), C→D chords+label, shift applied once (+2 → E, −1 → Db), numbers, missing/deleted arrangement, song mismatch, non-song item, two plans + library independent, temporary view, missing chart, unknown key.
- `npm run typecheck` — pass (shared, backend, frontend, mobile).
- `npm test` — pass: shared 90, backend 52.
- `npm run build` — pass (existing Vite chunk-size advisory).
- `expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob002` — pass (bundling only).

**Remaining gates (Pass A)**

- Signed-in device check not run (same blocker as MOB-001: no tap automation to sign in). Verify on iOS + Android, light/dark: plan → song opens the item's arrangement and service key; picker scrolling/large text; temporary-view notice; chart horizontal scroll; switching organization while on a chart shows loading, not prior org content.
- No native test harness exists; resolver/render behaviour is covered in shared tests only.
- Website `RehearseTab` / web song links do not yet pass item context — outside the native scope of this pass; revisit if web parity is required.

**Pass B next:** read `.agents/skills/supabase-postgres-best-practices/SKILL.md`; add nullable `plan_items.sequence_override text[]` (null inherits) via new migration; validate against arrangement section rules in `schemas/plan.ts`; include in `PlanItemRow`, plan detail select and item update; wire `resolveChartContext` (`sequence` = override ?? arrangement); test two items on one song with different sequences/keys and null inheritance; also make `serviceSongBookDocumentFromPlan` use it.

## MOB-001 — 2026-10-15

**Type:** verification plus targeted defect fixes (not verification-only). The theme from commit `3ba8374` was preserved; no redesign, no navigation or feature removal, no DB change.

### Token trace (step 1)

| Role | Shared source (`packages/shared/src/lib/design-tokens.ts`) | Web consumer | Native consumer |
|---|---|---|---|
| Primary / pressed | `color.brand`, `brandPressed`, `brand[50–700]` | `applyDesignTokens()` → `--app-brand-*` → Tailwind `brand-*` (`index.css` `@theme`) | `theme.color.brand` in `Button`, tab/header tint `brandText` |
| Canvas / surface / borders | `canvas`, `surface`, `field`, `border`, `borderStrong` | `--app-{light,dark}-*` → `:root` / `.dark` → `.card`, `.input`, `bg-app-*` | `Screen`, `Card`, `Field`, tab bar, stack header |
| Text | `ink`, `inkMuted`, `inkFaint`, `brandText` | `--app-ink*`, plus legacy `.dark .text-slate-*` remaps | all `theme.type` styles |
| Assignment status | `accent.{green,red,yellow}` + **new `ASSIGNMENT_STATUS_ACCENTS`** | `--app-status-<status>-{bg,fg}` → `.status-*` → `assignmentTone` | `statusAccent()` → `Tag` |
| Radii | `radius.{small,control,input,card}` | `--app-radius-*` on `.button`, `.input`, `.card` | `theme.radius.{xs,sm,md,lg}` |
| Build-time colors | n/a (JS config can't import TS tokens) | n/a | `app.config.js`: `#f8fafc`/`#020617` splash, `#4f46e5` notification — values match tokens; keep in sync manually |

Hardcoded remaining (web, not conflicts with tokens): `frontend/src/components/ui.tsx` `ErrorNotice`/`MenuItem` rose and secondary/ghost slate utilities, `frontend/src/lib/format.ts` badge ring colours and `assignmentDot`. They use the same Tailwind slate/rose/emerald/amber family; candidates for later token adoption. No hardcoded hex/rgba in `mobile/app` or `mobile/src` except `theme.ts`.

Typography/decoration/motion (step 2): system sans (`System`/`sans-serif`) and mono only for charts/keys; no serif or `@expo-google-fonts` import (`expo-font` is only an Expo transitive dependency, never imported); `Reveal` renders immediately; no ruled backgrounds.

### Defects fixed

1. **Native buttons/rows rendered unstyled on device (release-blocking).** NativeWind's `Pressable` interop drops function-form `style={({ pressed }) => …}`, so every `Button`, `IconButton`, notification bell and list row lost its fill/layout (simulator screenshot: primary *Sign in* was plain left-aligned text). `PressableScale` (`mobile/src/components/motion.tsx`) now tracks pressed state itself; all seven function-style callsites (plan order rows, notifications rows, calendar events, schedule cards, songbook pick rows and drop zone, `ListRow`) use it. Verified fixed on simulator.
2. **Status roles defined twice.** Added shared `ASSIGNMENT_STATUS_ACCENTS`; web `.status-*` and native `statusAccent()` both read it. Native no longer redefines `AssignmentStatus` locally. Web computed colours checked in light/dark — all six bg/fg pairs equal the shared tokens.
3. **Calendar status wording** showed raw `unconfirmed` (web and native). Both now use `ASSIGNMENT_STATUS_LABELS` (“Awaiting reply”). Native event time/location now separated with ` · `.
4. **Large text:** segmented-control labels broke mid-word (“accou/nt”) → capped at 1.5× and centred; login “SC” logo glyph clipped in its 48pt box → fixed size, hidden from screen readers (heading names the app); unread badge fixed 16pt height → `minHeight` with 1.4× cap.
5. **Keyboard:** Settings (profile/blockout/new organization) and Song books create form scroll views now use `automaticallyAdjustKeyboardInsets` (iOS) so lower fields aren't covered.
6. **Touch target / a11y:** login mode-switch link has a 44pt target; notification rows announce “Unread:”; plan song rows' bold link style (previously a no-op `fontFamily`) restored.
7. **Tablet:** login column capped at 520pt instead of stretching edge to edge on iPad.

### Observations not fixed (reproducible, out of MOB-001 scope or need a decision)

- Seeded demo credentials text shows on both web (`LoginPage.tsx:128`) and native login in all builds — gate on dev builds before release (MOB-003 or release checklist).
- Web public respond page says **Confirm** (`RespondAssignmentPage.tsx:35`) while My Schedule says **Accept** — MOB-003/MOB-005 response work.
- Schedule/plan rehearsal accents use the amber that also marks “Awaiting reply”; web calendar does the same, and status always carries a text label, so left for parity.
- Schedule response buttons share one `isPending` across all cards (all spin together) — MOB-004.
- Plan order ordinals count headers; fixed 46pt length column may wrap at large text — MOB-002.
- At accessibility-XXXL the `Field` placeholder sits low in the input (fixed body `lineHeight` on `TextInput`) — legible, revisit with device QA.
- Native appearance is light/dark only (no system-follow) — MOB-021.

### Visual matrix

Tested (iOS Simulator, Expo Go 57.0.9, Metro dev bundle; screenshots in `/private/tmp/mob001-shots/`, not committed):

| Device | Theme | Text size | Screen | Result |
|---|---|---|---|---|
| iPhone 17e | light | default | Sign in | Rendered; Expo dev-menu sheet obscured lower half |
| iPhone 17e | dark | default | Sign in | **Defect 1 found**, then verified fixed |
| iPhone 17e | dark | accessibility XXXL | Sign in | **Defect 4 found**, segment fix verified |
| iPhone 17e | light | accessibility XXXL | Sign in | Logo, segments verified fixed |
| iPad mini (A17 Pro) | dark | default | Sign in | **Defect 7 found**, column cap verified (dev-menu sheet over lower half) |
| Web 1280×800 (preview) | light + dark | default | Dashboard; computed `.status-*` | Token values match |

Untested — **remaining gates**: any signed-in native screen (schedule, calendar, songs, song chart, song books, plan, notifications, settings, invitation) — no tap automation was available in this environment (agent device access off; no idb/AppleScript), so sign-in could not be completed; keyboard-visible forms; Android (no emulator/adb installed); physical iOS/Android devices; screen-reader pass; long names and error/empty states on device; web screens other than dashboard after this change.

### Checks run (Node 26.9.0 / npm 11.19.1 via nvm; default shell Node 20.20.1 is below the declared engine)

- `npm run typecheck` — pass (shared, backend, frontend, mobile).
- `npm test` — pass: shared 77, backend 52.
- `npm run build` — pass (existing Vite >500 kB chunk advisory).
- `expo export --platform ios --platform android --output-dir /private/tmp/service-center-mobile-check-mob001-final` — pass. Bundling only, not device verification.

### Files changed

`packages/shared/src/lib/design-tokens.ts`, `frontend/src/lib/design-tokens.ts`, `frontend/src/index.css`, `frontend/src/pages/CalendarPage.tsx`, `mobile/src/components/{motion,ui,NotificationBell}.tsx`, `mobile/src/lib/theme.ts`, `mobile/app/(auth)/login.tsx`, `mobile/app/(tabs)/{index,calendar,profile,songbooks}.tsx`, `mobile/app/notifications.tsx`, `mobile/app/plan/[id].tsx`, this ledger.

### To close MOB-001

Run the signed-in matrix on a small phone, large phone/tablet, light/dark, accessibility text, keyboard-visible forms, on iOS **and** Android, ideally a dev build (no Expo dev-menu overlay). Confirm Button/ListRow pressed feedback and fills on every screen. Save approved screenshots without private roster data.
