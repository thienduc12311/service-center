# W9-WEB web retests and UX/RES web remainder

Package W9-WEB (QA-16 web retests + QA-15 web remainder). Commit `9aaeada` (API served from a sibling worktree, identical code), branch `feature/qa-wave9`. Web `:5173` (Vite from this worktree). Browser: Orca embedded browser (Chromium), isolated profile `qa-wave9-web` (deleted at the end), driven with the `orca` CLI; desktop viewport (default window), English, dark (system default). Sessions were injected into localStorage after an API password login (the app's own sign-in form was only exercised through the 401 redirect). Fault injection: a private Vite instance on `:5180` with `VITE_API_URL=http://localhost:4641` and a fault proxy on `:4641` in front of `:4000` (modes: forced 503/504 per path, forced 401, per-path delay). Both stopped by PID at the end.

Namespace: orgs `qa-w9-web-a`, `qa-w9-web-b`; users `<alias>.qaw9.web@example.test`; passwords only in the scratchpad `web/creds.json`.

Fixture shape (org A): `owner`; members `adultp` (adult, assigned and released on the plan), `kidlogin` (member whose person is a child, assigned and released), `outsider` (member, not on the plan), `mate1`, `mate2` (adult teammates with phone and date of birth), `searchme` (login only: person email and phone empty, profile phone set). 84 people in total: 70 `Filler###`, a 174-character Thai name, `Zed*Star` / `ZedXStar`, `Pct%Match_` / `PctXMatchY` decoys, child without login (`Little Kidnoteam`), archived `Archie Archived` (still a member of the team). Service type `W9 Sunday`, team `W9 Band` (Vocals, Keys; 6 memberships), plan `W9 Plan` (published), service type `W9 Bulk` with 120 plans each with a plan conversation (121 conversations once `W9 Plan` chat was opened). Org B: `ownerb`, person `BSECRET Person` (leak sentinel).

Totals: 51 rows executed: 45 PASS (including 4 marked observation or note), 5 FAIL rows covering 3 defects (all P2, one of them the known double-submit follow-up), 0 BLOCKED, 0 NOT_RUN, 1 NOT_APPLICABLE (service type delete has no UI). No P0 or P1.

## A. W8-WEB-D1 logo

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| W8-WEB-D1.svg-forced | owner | /settings?section=church, `orca upload` of an SVG into the file input (bypasses `accept`) | specific, actionable error | alert "That file type isn't supported for a church logo. Use a PNG, JPEG, WebP or GIF image."; no `logo_url` set ([shot](evidence/web/web-logo-svg-error.png)) | PASS |
| W8-WEB-D1.picker | owner | same | picker offers raster only | `accept="image/png,image/jpeg,image/webp,image/gif"` | PASS |
| W8-WEB-D1.svg-renamed-png | owner | same | n/a (observation) | SVG bytes in a file named `.png` pass the client check and Storage accepts it as `image/png` (stored `logo-*.png`); served as an image it cannot run script. Not a defect; logo reset to null afterwards | PASS (observation) |

## B. People page (server paging and search)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE.page-size | owner | /people | 25 rows first | 25 rows, "Load more people" shown | PASS |
| PEOPLE.load-more | owner | /people | each click adds up to 25, no duplicates, ends | 25, 50, 75, 83; 83 unique names; button gone; archived hidden by default | PASS |
| PEOPLE.no-total | owner | /people | no total count | no count anywhere on the page | PASS |
| PEOPLE.search-name | owner | search `Filler01` | server-side match | 10 rows (Filler010 to 019) | PASS |
| PEOPLE.search-thai | owner | search `สมชาย`; also the Thai name sits past page 1 and was reached by Load more | long non-Latin name found, Load more works | 1 row (the 174-char name); full-list Load more reached it | PASS ([shot](evidence/web/web-people-owner-thai-search.png)) |
| PEOPLE.search-symbol-star | owner | `Zed*` | literal | only `Zed*Star`, not the `ZedXStar` decoy | PASS |
| PEOPLE.search-symbol-pct-underscore | owner | `Pct%`, `Match_` | literal | only `Pct%Match_`, no decoy | PASS |
| PEOPLE.search-login-email | owner | `adultp.qaw9` | login email matches | `Alice Adultp` | PASS |
| PEOPLE.search-login-email-no-person-email | owner | `searchme.qaw9` | matches row with empty person email | `Sam Searchme` with login email and phone shown | PASS |
| PEOPLE.search-phone | owner | `+1 555 0199` | matches | `Sam Searchme` | PASS |
| PEOPLE.zero-result | owner | `zzzznomatch` | empty state | "Nobody matches that search." | PASS |
| PEOPLE.cross-org | owner | `BSECRET` | no org B data | 0 rows | PASS |
| PEOPLE.placeholder-owner | owner | /people | role-appropriate | "Search by name, email, phone or campus" | PASS |
| PEOPLE.placeholder-member | mate1 (member) | /people | no email/phone in promise | "Search by name or campus" | PASS |
| PEOPLE.member-privacy | mate1 | /people rows, search `searchme.qaw9`, `adultp.qaw9`, `alice.public`, `+1 555 0102` | no other person's email/phone shown or matchable | rows show names only (own email only on own row); all four searches 0 rows | PASS |
| PEOPLE.member-search-name | mate1 | `Maya`, `Little` | found | found | PASS |
| PEOPLE.member-archived-toggle | mate1 | Show archived, search `Archie` | observation | a member can list archived people by name (no contact fields). Not covered by the wave 8 notes; see Observations | PASS (observation) |

## C. Team roster UI (mate1, non-owner)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| TEAM.adult-fields | mate1 | /teams, W9 Band | teammates show name, email, phone, date of birth | Alice, Maya, Milo each show `email · phone · date of birth` ([shot](evidence/web/web-team-roster-member.png)) | PASS |
| TEAM.child-name-avatar-only | mate1 | same | children name + avatar only | `Kiddo Childlogin` (login) and `Little Kidnoteam` show name and initials avatar only | PASS |
| TEAM.archived-hidden | mate1, owner | same | archived person hidden | the archived person's membership shows as a row named `Unknown` with a position, and is counted in "6 people" (5 visible people) | FAIL, W9-WEB-D1 |
| TEAM.no-unknown | mate1 | same | no "Unknown" | one "Unknown" row (the archived person), none for active people | FAIL, W9-WEB-D1 (same cause) |

## D. Plan chat offering (plan page and live page)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT.before-load.plan | owner | /plans/:id, plan GET delayed 9 s via proxy | no chat button before the plan loads | page "Loading…", no "Plan chat" at 3 s; button after load | PASS |
| CHAT.before-load.live | owner | /plans/:id/live, same delay | same | same | PASS |
| CHAT.non-participant.plan | outsider | /plans/:id | not offered | no "Plan chat" | PASS |
| CHAT.non-participant.live | outsider | /live | not offered | none | PASS |
| CHAT.non-participant.api | outsider | POST /conversations/open | denied | 404 "Conversation not found" | PASS |
| CHAT.child.plan | kidlogin | /plans/:id (released, unconfirmed assignment) | not offered | none | PASS |
| CHAT.child.live | kidlogin | /live | not offered | none | PASS |
| CHAT.child.api | kidlogin | POST /conversations/open | denied | 404 | PASS |
| CHAT.adult.plan | adultp | /plans/:id | offered and opens | "Plan chat" shown; click goes to `/chat/<id>` with the thread and composer ([shot](evidence/web/web-plan-chat-adult-opened.png)) | PASS |
| CHAT.adult.live | adultp | /live | offered and opens | same destination | PASS |
| CHAT.leader | owner | plan and live | offered | offered on both | PASS |

## E. Conversations list paging

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT.list-paging | owner | /chat with 121 conversations | all reachable | 50, then 100, then 121 after two "Load more" clicks; DB 121 | PASS |

## F. Errors, resilience (via fault proxy on a private Vite)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RES.401-redirect | owner | /people, every API call 401 | clean redirect to sign-in | `/login`, session cleared, no error toast ([shot](evidence/web/web-401-redirect-login.png)) | PASS |
| RES.expired-token | owner | /plans with tampered expired access token and bad refresh token | clean redirect | `/login`, session cleared | PASS |
| RES.503-plans | owner | /plans, `/plans` 503 | retryable error, no sign-out | alert "Service Center is having trouble right now. Please try again shortly."; session kept; 3 attempts (1 + 2 retries); recovered on the next navigation after the proxy healed ([shot](evidence/web/web-503-plans.png)) | PASS |
| RES.504-plans | owner | /plans, 504 | same | same message; no sign-out ([shot](evidence/web/web-504-plans.png)) | PASS |
| RES.503-all-api | owner | /people, every `/api/v1/*` 503, then 504 | shell stays, no sign-out | stays on /people with the message; session kept; reload after healing shows 25 rows ([shot](evidence/web/web-503-all-api.png)) | PASS |
| RES.error-empty-state | owner | /people and /plans during 503/504 | error without a contradicting empty state, with a retry control | the error notice is shown together with "Nobody here yet" / "No plans yet", and there is no Retry button | FAIL, W9-WEB-D2 |
| RES.offline-people-search | owner | /people, `set offline on`, type `Filler05`, 12 s | offline message or loading | no alert and no skeleton; the page says "Nobody matches that search." ([shot](evidence/web/web-offline-people-search.png)); after `offline off` the request completes and 10 rows appear | FAIL, W9-WEB-D2 (same cause) |

## G. Double-submit delete (current UI behaviour; delay of 3 to 4 s injected on the DELETE)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DBL.team | owner | Teams, Delete team dialog, confirm clicked twice 300 ms apart | one request, no error | confirm disables while pending; one DELETE; no alert | PASS |
| DBL.team-sync | owner | same, two clicks in the same tick | no error | no alert, team gone | PASS |
| DBL.plan | owner | plan Actions, Delete plan, re-opened and chosen again while pending | no visible error | two DELETEs reached the API (the menu stays available); the second is a 404 that is not shown because the first success navigates to /plans | PASS (note) |
| DBL.song | owner | song Actions, Delete song twice | same | same as plan: two DELETEs, no visible error | PASS (note) |
| DBL.position | owner | team editor, position Delete (native confirm) clicked twice | no error | Delete does not disable; two DELETEs; the editor shows "Position not found" | FAIL, W9-WEB-D3 (known follow-up) |
| DBL.service-type | owner | Service types | n/a | no delete control in the UI (archive only) | NOT_APPLICABLE |

## H. Web menu Tab-close (NOT_RUN in wave 8)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MENU.tab-closes | owner | /teams, More menu, ArrowDown to `Edit`, Tab | menu closes, focus moves on | menu removed, `aria-expanded` gone, focus on the next control ([shot](evidence/web/web-menu-tab-close.png)) | PASS |
| MENU.shift-tab-closes | owner | same, Shift+Tab from `Edit` | closes, focus on trigger | closed, focus on `More` | PASS |

How it became runnable: `document.hasFocus()` is false until the page receives a real `orca click`; after that, `orca keypress` produced real focusout events. Until then the menu stays open (the wave 8 symptom), so the note is a test-tool caveat, not an app issue.

## Defects

**W9-WEB-D1 (P2). An archived person stays on a team roster as an "Unknown" row and inflates the people count.** Repro: owner archives a person who is on a team (`POST /people/:id/archive`, which keeps the team membership; verified, membership count stays 1). Open /teams as any member. Expected: the archived person is hidden, as the wave 8 review fix intended ("archived people hidden"). Actual: `team_roster_people` correctly omits them, but the team still returns their membership with `profile: null`, so the UI shows a row named "Unknown" with the position and counts it ("6 people" for 5 visible people). No private data shown. Source: `backend/src/routes/teams.ts:53-61` (`shapeTeam` maps memberships whose roster person is missing to `profile: null` instead of dropping them); rendered at `frontend/src/pages/TeamsPage.tsx:214` and counted at `:163`. Fix direction: drop memberships with no roster person for non-owner callers (or drop archived ones for all), and count the filtered list.

**W9-WEB-D2 (P2). A failed or paused list request renders the empty state next to the error, with no retry button.** Repro: with the API returning 503/504 (or the browser offline), open /people or /plans. Expected: an error with a retry control, no "no results" text. Actual: People shows the error notice plus "Nobody here yet" (or, while offline and searching, only "Nobody matches that search." with no error at all because the paused query has no data and is not loading); Plans shows "No plans yet. Start with a Service Type…" under the error. The user must navigate away or reload. Source: `frontend/src/pages/PeoplePage.tsx:148-251` (the `EmptyState` branch runs whenever `people.data` is empty, including on error or paused fetch), `frontend/src/pages/PlansPage.tsx:182-204`. Fix direction: branch on `people.isError` / `fetchStatus === 'paused'` before the empty state and offer `refetch`.

**W9-WEB-D3 (P2, known follow-up). Position delete double-submit surfaces "Position not found".** Repro: team editor, Delete on a position (native confirm accepted), click Delete twice while the request is slow. Expected: one request, no error. Actual: the button is not disabled during the request, two DELETEs are sent and the second 404 is shown. Source: `frontend/src/components/TeamEditor.tsx:73-91` (`removePosition` has no pending guard). The plan and song deletes send two requests too but show nothing because the first success navigates away. Matches the wave 8 "other delete methods surface a 404 on double-submit" follow-up; recorded, not new.

## Observations (not defects)

- A non-owner can tick "Show archived" on /people and list archived people by name (no email/phone). Decide whether archived people should be visible to non-owners at all.
- The 503 path retries twice (3 requests) and shows no "Retry" control; the next navigation refetches (see D2).
- An SVG renamed to `.png` is stored as `image/png` (harmless as an image).

## Not run / blocked

- Real IME, screen reader, large text: out of scope. Plan chat for a child who is also a plan leader: not built as a fixture (the leader path is covered by the shared `canOpenPlanChat` unit logic and the owner row above).
- Duplicate-submit on service type delete, arrangements, folders, tag groups, matrix views: no web delete control for service types; the others were not driven.
- Drag-and-drop logo upload: a browser file drop was not emulated, only the file input.

## Fixtures left in place

Orgs `qa-w9-web-a` and `qa-w9-web-b` with users `*.qaw9.web@example.test` (7 in A, `ownerb` in B); org A: 84 people (one archived and on the team), team `W9 Band` and the empty team shells `W9 Del Team`/`W9 Del Team2` deleted, `W9 Del Team3` (position PosB left), plan `W9 Plan` with two released assignments and its chat, 120 `W9 Bulk` plans with conversations, service types `W9 Sunday` / `W9 Bulk`. Deleted by the tests: `W9 Del Plan(2)`, `W9 Del Song`, `W9 Del Team`, `W9 Del Team2`, position PosA. No delivery worker was run; no queued deliveries were created by me beyond the normal assignment release (simulated, undelivered). Browser profile `qa-wave9-web` deleted; proxy (`:4641`) and private Vite (`:5180`) stopped by PID. Evidence: `docs/qa/runs/2026-11-21-wave9/evidence/web/*.png` (11 screenshots; test-user emails only, no tokens, keys or passwords).
