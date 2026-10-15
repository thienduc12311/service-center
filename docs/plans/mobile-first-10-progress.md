# Mobile first-ten progress ledger

Tracks [the MOB-001–MOB-010 prompt pack](../prompts/mobile-first-10/README.md). One row per task/pass; details below the table. A task is `complete` only when its full acceptance gate passes.

| Task / pass | Status | Branch | Next action |
|---|---|---|---|
| MOB-001 shared UI and device review | implemented; QA pending | `codex/mob-001-ui-review` (uncommitted) | Signed-in native device matrix (below), then mark complete |
| MOB-002 plan chart context | not started | — | **Next task** |
| MOB-003 – MOB-010 | not started | — | Per README order |

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
