# Wave 1 - track WEB (browser pane, React/Vite)

Commit/branch: feature/app-store-review-demo (no source or git changes made). Browser: Browser pane (Chromium), desktop 1024x768, mobile preset 375x812. Date 2026-11-13. No secrets recorded; credentials live only in the agent scratchpad.

## Fixture manifest (namespace qa-20261113, agent web)

| Item | ID |
|---|---|
| Org `qa-20261113-web` (slug `bad-slug`, from the slug sanitiser) | b48c11ff-decc-4e97-8ebf-87e68f773b8c |
| Org owner login `newcomer.qa20261113.web@example.test` (created the org via /welcome) | 7507ef64-19e7-444f-be04-0556fe5029c5 |
| Unused login `owner.qa20261113.web@example.test` (auth only, no membership) | 8139620e-758e-4ef3-8c99-238d9cfe60fd |
| Admin login `admin.qa20261113.web@example.test`, person "Ada AdminQA" | person 2bf0fed1-52f1-43da-934a-5727ffec69c6, user 4d09f35f-90f4-4d1f-a61b-db2721e5135a |
| Member login `member.qa20261113.web@example.test`, person "Mia MemberQA" | person 1080daa6-ca91-4f97-ad11-7cf5a2c2ef84 |
| Service type "Middle School" (wizard; I mis-clicked an example chip, name was meant to be Sunday Service) | 5cf1edda-8a10-4cb7-a275-c199fce7ce92 |
| Teams Band, Vocals (wizard, with default positions) | Band 8259070f-0063-493d-a1ff-4d2607ae33df |
| Plan Sun 2026-11-15 (Draft) | 76b2092e-819b-4a7b-b692-383fca7a35b2 |
| Songs: "QA Setup Song" (API setup), "QA UI Song One" (UI, arrangement "QA Arr Main") | fac8345e-9c41-4141-b4ec-c82273e8468d, 8ae32460-fc45-4af8-ae58-6ab50fe4163e |

Deviations / setup notes
- The org was created by the `newcomer` account (the Create church click was submitted before I could sign out), so `newcomer` is the org owner and the `owner` auth user is unused. All "owner" results below are for `newcomer`.
- admin/member: I first pre-created auth users, then deleted them and used the real People -> invite -> /accept-invite flow (works end to end locally: invite link is shown in-UI since email delivery is not configured). Admin invite: UI. Member: person + invite created with owner token via API (setup), accepted through the real /accept-invite page.
- Setup via API with owner token: "QA Setup Song", 3 initial order items (header, item, song), member person.
- Cleanup NOT done (wave-level cleanup owner decides); auth users and org remain.

## Results

| Case | Actor | Route/action | Expected | Actual | Status |
|---|---|---|---|---|---|
| AUTH-01.protected-redirect | anon | /plans signed out | redirect to /login | /login | PASS |
| AUTH-01.invalid-creds | anon | wrong password | clear error | "That email and password don't match..." | PASS |
| AUTH-01.login | newcomer, owner path, member | valid creds | session, land correctly | OK; no-org user -> /welcome (AUTH-01 newcomer) | PASS |
| AUTH-01.logout | newcomer | user menu > Sign out | back to /login | /login | PASS |
| AUTH-01.restore-dest | member | signed-out deep link /plans/:id then login | return to destination | /plans/:id restored | PASS |
| AUTH-01.signup/recovery/session-expiry/refresh-rejected | - | - | - | not exercised | NOT_RUN |
| AUTH-02.create-org | newcomer | /welcome create church | org + owner membership | created, lands on dashboard | PASS |
| AUTH-02.slug-validation | owner | UI slug "Bad Slug!!" | normalise or reject | normalised to bad-slug; API: dup slug 409, invalid slug 422, empty name 422 | PASS (see D-2) |
| AUTH-02.edit-org | owner | Settings > Edit details, city | persists | city "QA City" persisted (verified via API, UI reloaded) | PASS |
| AUTH-02.member-cannot-edit-org | member/API | PATCH /organizations/:id | 403 | 403 | PASS |
| PROFILE-01.name | owner | Settings > Full name | persists after hard reload | "Olive OwnerQA" persisted; greeting "Hi Olive" | PASS |
| PROFILE-01.avatar/phone/appearance reset | - | - | - | not exercised | NOT_RUN |
| TYPE-01.wizard | owner | /service-types/new 3 steps (name, time, 2 teams) | type + plan + teams/positions | created type, plan on 2026-11-15, Band+Vocals with positions | PASS |
| TYPE-01.back/cancel/validation | - | - | - | not exercised | NOT_RUN |
| PLAN.edit-times | owner | Edit times (label, end 11:30), reload | persists | "QA Main 10:00-11:30" persisted | PASS |
| ORDER.add | owner | Add item > Item "QA UI Added Item" | appears, persists | OK after reload | PASS |
| ORDER.reorder | owner | Move up | order persists | OK after reload | PASS |
| ORDER.delete | owner | Remove "QA Welcome" | confirm; cancel keeps; confirm deletes | native confirm; cancel kept item, confirm removed it, persisted | PASS (see D-5) |
| SONG.create+arrangement | owner | /songs Add a song with arrangement + ChordPro | persists after reload | song, arrangement name and chart persisted (API-verified) | PASS |
| ROUTE sweep (owner) | owner | 28 routes incl. unknown | render, no 4xx/5xx, no console error | All render. Zero failed fetches and zero console.error during sweep. /songbooks and /songbooks/x/y -> /songs (GATED-01). Unknown route -> /. | PASS |
| ROUTE.plan-tabs | owner | Order, Teams, Rehearse, Files, Stage, Attendance, Share | render with useful empty states | all OK | PASS |
| ROUTE.reports x5 | owner | Staffing, Participation, Multi-plan, Song usage, Actual run times; Run report | each runs | all run; counts 0 (default filters/Draft only) | PASS |
| ROUTE.not-covered | owner | /plans/:id/live interactions, /media/:id (no media exists), /chat/:id, /messages/:id, /settings/blockouts/:id, /help/:id, /people/:id (owner positive) page contents only partly | - | live page renders; others NOT_RUN (no fixture) | NOT_RUN |
| ACL-03.admin.UI | admin | /people/:id, /people/new | denied | redirected to /people | PASS |
| ACL-03.admin.API | admin | GET/PATCH/POST/DELETE person, invite, archive, PATCH member | 403 | all 403 "Only the organization owner..." | PASS |
| ACL-03.admin.list-redaction | admin | GET /people | other contacts redacted | only own email visible | PASS |
| ACL-03.member.UI | member | /people/new | denied | redirected to /people | PASS |
| ACL-03.member.API | member | person GET/POST/PATCH/DELETE/invite | 403 | all 403 | PASS |
| ACL.member.plan-edit | member | plan page controls; PATCH/POST/DELETE plan | no edit controls; 403 | no Add item/Actions/Edit/Templates; API 403 "Edit plans" | PASS |
| ACL.member.admin-routes | member | /reports /plans/generate /templates /reschedule /imports /service-types/new /plans/releases /plans/proposals | refused | friendly refusal on all | PASS |
| ACL.member.matrix | member | /plans/matrix | refuse | shell renders, API 403, shows red error + "No permitted plans" | PASS (see D-3) |
| ACL.member.settings | member | /settings | no Access/Delivery/API sections | only Profile/Appearance/Church/Reminders/Calendar/Availability; API /access, /deliveries, /integrations 403 | PASS |
| ACL.admin.settings | admin | /settings, API | admin sees Access, Delivery, API; may use | allowed (expected) | PASS |
| PUBLIC-01 | anon | /p/bad, /s/bad | safe not found | "This set list is not available" for both | PASS (see D-4) |
| RESP-03/PEOPLE-03 | anon | /respond malformed / no token; /accept-invite bogus | safe message | safe messages, no stack | PASS |
| PEOPLE-03.invite-accept | admin, member | invite link -> /accept-invite -> set password | account created, signed in, lands on dashboard | works for both | PASS (see D-1) |
| UX-01.narrow | owner | /, /plans/:id, /songs at 375px | no horizontal page overflow | no page overflow; tabs and songs table scroll inside their cards | PASS |
| UX-01.dark | owner | same pages, dark scheme | readable | readable (one transitional screenshot looked light; computed styles dark) | PASS |
| UX-01.1024 | owner | /plans/:id at 1024px | no overlap | order-row action icons overlap/crowd title | FAIL (D-6) |
| AUTH-03/04 multi-org, revoked membership | - | - | - | not exercised (single org) | NOT_RUN |

## Console / network errors seen
- Console on /welcome: `Pattern attribute value [a-z0-9-]{2,40} is not a valid regular expression ... /v: Invalid character class` (D-2).
- Console: one `Uncaught Error: useAuth must be used inside <AuthProvider>` stack at LanguageProvider during the session (likely Vite HMR/other agents' edits; seen once, not reproduced after reload). Observation only.
- One 500 and two 410s appeared in the tab console around the invite flow. The 410s are the invitation lookup re-fetched after the token was consumed (API returns invitation_used). The 500 could not be attributed or reproduced from API probes. Flag for backend log review around 21:05-21:20 UTC.
- 403s on /plans/matrix, /plans/proposals as member (API denies, expected).
- Owner route sweep: no failed requests, no console.error.

## Defects
- D-1 (P2) Invite page copy broken: "Mia, you've been invited to join with the Member role. Choose a password for to finish." The organization name and the email/account word are missing (empty interpolation). Repro: People > invite > open /accept-invite?token=... > read intro.
- D-2 (P2) /welcome slug input has `pattern="[a-z0-9-]{2,40}"`, invalid under the `v` regex flag (hyphen unescaped); console error and browser-side pattern validation is silently disabled. Server validation still catches bad slugs (422). Fix: `[a-z0-9\-]{2,40}`.
- D-3 (P2) /plans/matrix is not route-gated for members, unlike its sibling pages: renders full filter UI and an error banner "You need the Schedule people permission" plus "No permitted plans"; /plans/proposals also fires a 403 request before showing its gate. Data is protected (API 403).
- D-4 (P2) /p/:slug (plan kind) shows "This set list is not available / may not be shared yet" - wording is for set lists even on the plan route.
- D-5 (P2) Order-item removal uses a native `window.confirm`; hostile to automation and not styled; cancel path works. Informational/UX.
- D-6 (P2) At 1024px wide, plan Order tab: the Title column collapses to a few characters (header title wraps over 3 lines) and the per-row action icons overlap the item title text (QA Welcome row). Not seen at 375px. Evidence: screenshot taken during run (not saved).
- D-7 (P2, a11y) Several controls have no accessible name: team checkboxes in the service type wizard (name "on"), plan header icon buttons, user-menu toggle; modal dialogs leave the page behind them in the accessibility tree (no inert/aria-modal).
- Observations (not defects, verify against product intent): owner's person shows as "Unnamed" in People/Settings until a name is set (profile name has no default from email); ordinary member can GET a Draft plan and its items via API/UI (view-only; oracle says "view only when entitled" - confirm Draft visibility is intended); service-type wizard example chips are close together and easy to mis-click; Settings nav labels the org section "Churches" (terminology).
- No P0/P1 defects found. No cross-tenant, private-data or role-enforcement failures observed.

## NOT_RUN / limits
Sign-up and password recovery, session expiry/refresh rejection, multi-org switching and revoked membership (only one org), avatar upload, wizard back/cancel, plan release/staffing/live-run flows, media bundle detail, chat conversation, messages detail, blockout series and help pages, People detail page content as owner (route confirmed accessible), reports export queue/CSV, admin UI mutations (admin was exercised via UI gating plus API only), 60-90 minute budget prioritised breadth and role checks. Browser viewport reset to desktop and storage cleared; org/users left in place.
