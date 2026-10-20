# Remaining mobile tasks — progress

Tracks [the MOB-011–MOB-033 prompt pack](../prompts/mobile-remaining/README.md). One row per task/pass; details below the table. A task is `complete` only when its full acceptance gate passes. Shared fixes are recorded once in the [Services ledger](services-capabilities-progress.md) and linked from here.

| Task / pass | Status | Branch | Remaining gates / next |
|---|---|---|---|
| MOB-011 Pass A — native household picker and delegated actions | implemented; QA pending | `feature/mob-011-household-delegation` (uncommitted) | Signed-in iOS/Android device matrix (below); guardian/minor policy (F03 decision); delegated signup gated on F07 consuming `can_signup` |

## MOB-011 Pass A — 2026-10-20

**Baseline.** `main` at `066e66c` (MOB-010 merged), clean; branch `feature/mob-011-household-delegation`. F03 Pass C (explicit delegation) is reused unchanged: no migration, route, schema or shared type was added. No shared gap was found, so the Services ledger is not changed.

**Dependency evidence (verified against source, not rebuilt).**
- F03 Pass C: `schedule_delegations` + events, `private.delegation_for` (grant, expiry, both memberships, archive re-checked per statement), `grant_schedule_delegation` (target-only consent; a new grant for the same helper revokes and audits the old one), `revoke_schedule_delegation` (target, delegate or admin; idempotent), `delegated_schedule` (released requests only; replaced by F04 to list attended times), `respond_as_delegate` (MOB-004 transitions, `PT409` on a stale expected status, delegate recorded as actor). `supabase/tests/f03-preferences-delegation.sql` still passes.
- Availability under a grant: `private.can_manage_blockout` admits availability delegates, so `/blockouts` (list/create/update/delete/affected/series create) and `/availability/preferences|review|affirm` accept `person_id`. Series maintenance stays with the Person (web limit kept).
- F07: `can_signup` is stored but consumed nowhere (`grep can_signup backend/src supabase/migrations`), so delegated signup is **not** offered natively; the web grant form does not offer it either.

**Contract trace (web → shared → backend → native).**

| Action | Web source | Shared method / types | Backend + permission | Native consumer |
|---|---|---|---|---|
| List grants (given + received, revoked excluded, `active` from expiry) | `ScheduleHelp`, `HelpPage` | `listDelegations(): DelegationSummary[]` | `GET /delegations` → RLS `schedule_delegations_select` | `useDelegations`, `/help`, `/help/[id]`, `/team-preferences?delegation=` |
| Grant | `ScheduleHelp` form | `grantDelegation(GrantDelegationRequest)`; `grantDelegationSchema` (≥1 right, expiry ≤2 y server-side) | `POST /delegations` → `grant_schedule_delegation` (caller must be the target) | `/help` "Ask someone to help" via `grantRequest` |
| Stop | `ScheduleHelp` Stop / Stop helping | `revokeDelegation(id)` | `POST /delegations/:id/revoke` | `/help` (given), `/help/[id]` (received), with confirmation |
| Read requests | `HelpPage` | `delegatedSchedule(id): DelegatedSchedule` (title, date, location, team, position, attended times — no items/notes/files) | `GET /delegations/:id/schedule` → 404 unless received + active, then `delegated_schedule` (`view_schedule`, implied by respond) | `/help/[id]` Requests |
| Answer | `HelpPage` Accept/Decline/Withdraw | `respondAsDelegate(id, assignmentId, DelegatedRespondInput)`; `delegatedRespondSchema` | `POST /delegations/:id/assignments/:aid/respond` → `respond_as_delegate` (`respond` right; 409 `assignment_response_stale`) | `/help/[id]`; withdrawal confirmed; decline reason optional |
| Freshness / affirm | `AvailabilityReview personId` | `availabilityReview`, `affirmAvailability({ person_id })` | `/availability/review|affirm` → availability right | `/help/[id]` Availability |
| Blockouts | `AvailabilitySettings personId` | `listBlockouts`, `createBlockout`, `updateBlockout`, `deleteBlockout`, `previewAffectedAssignments`, `previewBlockoutSeries`, `createBlockoutSeries` with `person_id` | `/blockouts*` → `can_manage_blockout` | `BlockoutForm personId` on `/help/[id]` |
| Preferences | `SchedulingPreferences personId` | `listSchedulingPreferences({ person_id })`, `saveSchedulingPreference({ person_id, … })`, `deleteSchedulingPreference` | `/availability/preferences` → availability right | `/team-preferences?delegation=` (the Person's teams only) |

Pagination: none of these endpoints paginate (`delegated_schedule` defaults to yesterday → +366 days). Idempotency: grant is not keyed (a repeat replaces the grant, audited; native shows "Allowing again replaces…"); answers are protected by `expected_status`; blockout create keeps MOB-006's idempotency key.

**Native delivered.**
- `mobile/app/help/index.tsx` — "Help with my schedule": the household picker (You, then only people whose **active** grant names you, with what you may do), grants you gave (rights, end date, expired tag, Stop with confirmation), and the grant form (searchable helpers: active, unarchived members with a login other than you; respond/see/availability switches with see implied by respond; optional end date ≤2 years; replacement notice).
- `mobile/app/help/[id].tsx` — acting for one Person: each section only for the right that allows it; requests with status tags and attended times, Accept / Decline (optional reason) / Withdraw (confirmed); "view-only" note; availability freshness + affirm; their one-off blockouts (create/edit/remove through `BlockoutForm`), repeating ones listed read-only ("Only {{name}} can change…"); link to their team preferences; Stop helping. There is deliberately **no link into the plan**, and the boundary is stated on screen. A 404/403 from any delegated read, a stale answer or an ended grant re-reads the grants; an ended grant replaces the screen with the website's "Nothing to help with here".
- `mobile/app/team-preferences.tsx` — `?delegation=` runs the MOB-007 form for the granting Person (their teams by `person_id`, saves carry `person_id`); a missing/ended/availability-less grant shows the not-found state.
- `mobile/src/components/BlockoutForm.tsx` — optional `personId` sent on preview/create/series/update.
- `mobile/src/lib/delegations.ts` (+ test) — rights wording, picker, helper eligibility, per-entry actions, respond body, grant request (same end-of-day expiry as the web), error classification. `useDelegations.ts` hooks. Profile → "Help with my schedule" entry.
- Cache scope: `delegations`, `delegatedSchedule(delegationId)`, `blockoutsFor(personId)`, `schedulingPreferences(personId)`, `availabilityReview(personId)` all sit under the user/org/generation root; screens mount under the session-generation Stack key, so drafts and late results drop on account/organization change, and every mutation checks `isCurrentGeneration` before touching state.
- Translations: new `settings:help.*` and `home:help.*` keys in en + vi; existing web keys reused for everything the website already words.

**Checks (Node v20.20.1 locally; manifests ask for ≥26.8.1).**
- `npm run typecheck`, `npm run build` — pass. `npm test` — shared 341, backend 210, mobile 99 (+13: `delegations.test.ts` 12, `preference-draft.test.ts` +1) — pass.
- `EXPO_OFFLINE=1 CI=1 expo export --platform ios --platform android` (fresh scratch output dir) — pass.
- SQL, rolled back: new `supabase/tests/mob011-delegation.sql` — respond grant leaves Riley's plan/item/note/time/assignment/file/blockout/preference visibility identical to no grant; respond cannot write availability; Sam's grant cannot answer Morgan's request (naming Sam or Morgan); stale expected status `PT409` with no change; loaded-then-expired and loaded-then-stopped answers refused (`P0002`) and the stopped listing gone; accept recorded with Riley as actor and audited; availability-only opens exactly Sam's blockouts/preferences, cannot list or answer; re-granting replaces the old grant (one active per pair, `revoked/replaced` event) and drops the old right; structural guard — only the six availability/delegation tables have RLS policies that consult a grant (verified to fail when the allowed list is narrowed). `f03-preferences-delegation.sql` still passes.
- Live API on :4000 against local Supabase with seeded demo accounts (scratch script using the compiled shared client and the native helpers): 15/15 — grant as the native form sends it, picker for Riley only, schedule fields contain no item/note/file keys, other member 404, stale answer 409, review, preferences read for Sam (other member refused), blockout written by Riley reads back for Sam and Riley (other member refused), after stop: schedule 404, write refused, picker drops Sam. Fixtures removed afterwards (blockout deleted, grant + events deleted). Sam's availability review may now read "changed" from the delegated blockout write.
- Note: the local database's migration history ends at `20261104000100`; `20261105000000`, `20261105000100` and `20261106000000` are not recorded as applied. This pass touches none of their objects.

**Original acceptance requirements.**
- Explicit consent — **passed** (grant only by the target: F03 SQL; native form only grants over your own schedule).
- Independent rights — **passed** (SQL: respond ≠ availability ≠ view; native shows each section only for its right).
- No private plan/file escalation — **passed** (SQL visibility equality + structural policy guard; schedule fields; no native plan link).
- Atomic scoped responses — **passed** (one server call per answer with expected status; cross-Person and stale refused).
- No cross-Person cache leakage — **passed in code/tests** (keys scoped by user/org/generation and Person/delegation); device confirmation pending.
- Shared/backend/RLS checks and native export — **passed**.
- Adult/minor policy — **pending decision** (F03): no-login targets fail closed; nothing native changes that.
- Delegated signup — **gated** until F07 consumes `can_signup`.
- Device gates — **pending**: signed-in iOS + Android, both themes and large text: grant/stop round trip with the website; Riley answers for Sam and the website shows the same status/actor; stop on the web while `/help/[id]` is open, then answer → not-found; expiry passing while open; organization switch and sign-out while on `/help/[id]` (no Sam data after); offline answer shows an error, never a saved state; Android date picker for the end date.

**iOS Simulator QA — 2026-10-20.** iPhone 17 Pro, iOS 26.5, Expo Go 57, light theme, against local API/Supabase with seeded accounts (branch `feature/mob-011-household-delegation`). **Passed:** Profile → Help with my schedule entry; Sam searched and picked Riley, see-requests switch locked on under answer-requests, inline end-date picker + Remove end date, Allow disabled until a helper is chosen; grant saved and listed ("Can answer requests, see requests, manage availability · until Mon, Nov 23"), stored as respond/view/availability, no signup, expiry 23:59:59 local; `/help` deep link; Riley's picker lists only Sam with those rights; Helping Sam shows requests with time rows and status tags and no plan link; Accept → Confirmed with only Withdraw left, server shows Riley as actor plus a `responded` audit event; Withdraw asks for confirmation; answer made from an out-of-date screen (changed on the server underneath) refused, with the stale message and the card refreshed to the real status; permission stopped by Sam while the screen was open → Accept refused, nothing changed, screen switched to "Nothing to help with here", and the picker dropped Sam. Seed data restored afterwards. **Not covered here:** delegated blockout/preference editing on device, dark theme, large text, organization switch/sign-out while on `/help/[id]`, offline answer, Android.

**Next pass:** MOB-011 remaining device QA (Android and the items not covered above). Next native task: MOB-032 (combined own-organizations schedule on F03 Pass D) or MOB-012 (plans browser), selected on native prerequisites.
