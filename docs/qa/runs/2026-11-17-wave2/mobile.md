# QA-13 (subset) Native mobile first pass - wave 2 (2026-11-17)

Subset of package QA-13 from `docs/plans/admin-mobile-test-plan.md`. Branch `feature/qa-wave2-fixes` (HEAD `54d7408`, which only makes views read-only; no mobile changes).
Environment: iOS Simulator "iPhone 18 Pro" (iOS, Expo Go SDK 57, Metro :8081), API :4000, local Supabase. Device zone differs from org zone (device shows 9:00 AM where the org zone America/Toronto shows 10:00 AM; order/times screens label the org zone). No code, migration or config was changed.
Namespace: orgs `qa-20261117-mobile-a` (main) and `qa-20261117-mobile-b` (bandm is its owner, for multi-org); users `{owner,lead,dual,bandm,voxm,inactive,admin2}.qa20261117.mobile@example.test`. Credentials stay in the session scratchpad. Fixtures left in place.
Fixture shape: owner; `lead` = member with scheduling.manage scoped to Band (later also plans.edit on service type Sunday, for case 4b); teams Band (lead, dual, bandm, inactive) and Vocals (dual, voxm) - lead does not manage Vocals; `inactive` has an inactive membership; plans QA Sunday Service (Nov 20), QA Hidden Vocals Plan (Nov 21, dual on a prepared Vocals request), QA Band Practice (Nov 21, same time), QA Signup Plan (Nov 22), QA Hidden Vocals Late (Nov 20, 13:00-15:00 Toronto, lead on a prepared Vocals request); open replacement request (bandm declined Drums, offer to lead); leader-approval Bass opening with claims from bandm and lead; blockouts with private reasons for bandm, dual, voxm.

## Run history

The first session ended early when the local API (:4000) and Metro (:8081) died; the coordinator restarted both and this file was updated after the resumed run (Metro logs read via preview_logs: only Expo Go deprecation warnings, no errors or red boxes; the `react-native-web` web-bundle error in the log is the web target, not iOS).

## Result summary (final)

| Case | Result |
|---|---|
| 1 Smoke | PASS: owner, lead, member (bandm) signed in through the UI; tabs, plan detail, sign-out and sign-in between actors; no crash or red box; Metro log clean |
| 2 Self-approval (W2-RESP-D2) | PASS: lead sees no Approve on own offer/claim; owner sees Approve on and approves both the lead's claim and the lead's offer; member (bandm) saw no Approve on the opportunity screen (his replacement screen was opened but not inspected closely) |
| 3 Claims queue (W2-RESP-D1) | PASS |
| 4 Conflicts (W2-STAFF-D1) | 4a PASS (schedule screen). 4b time-edit Review as lead: re-run after restart but the result screen was not captured, so NOT_VERIFIED (API-level redaction PASS). Template-apply: API preview checked (PASS, below), apply-template screen opened but conflict list not triggered (no blocking conflict in that fixture): NOT_RUN for conflicts on device |
| 5 Blockouts/availability (W2-AVAIL-D3) | Member create / edit / delete own blockout with reason: PASS on device. Leader in-scope view with reason hidden and out-of-scope 404: PASS at API only (`team-preferences` screen not opened as lead). Across organizations: PARTIAL (see below) |
| 6 Inactive member (W2-STAFF-D2) | PASS |
| 7 Church creation timezone | PASS: Settings > Register another church reachable for bandm; Time zone defaulted to the IANA device zone (America/Chicago); submitted; "Waiting for review" screen, no validation error |
| 8 Regression sweep | PARTIAL PASS: Schedule, Plans list, plan detail Order/Teams, schedule-people, plan times editor, opportunities, replacements, Messages (chat tab and Messages list, empty states), Songs (empty library), Settings, Register church, apply-template opened. NOT_RUN: notes, a song chart (the org has no songs), calendar |

Defects: none (0 P0, 0 P1, 0 P2).

## Resumed-run evidence

- Case 2 (owner): `opportunities/[id]` as owner showed "Waiting for your approval - Mob lead" with Reject and Approve; Approve moved the list to "No one is waiting for approval" (opportunity Full). `replacements/[id]` as owner showed Mob lead "Agreed - waiting for a leader" with Reject and Approve; Approve ended in "Replacement confirmed" with Mob lead Confirmed. Earlier lead-as-beneficiary screens showed Reject only.
- Case 2 (member): bandm's opportunity screen (his claim confirmed) showed only "Cancel my signup", no Approve/Reject queue. His replacement-request screen was opened but I did not inspect it closely, so member-never-sees-Approve is PASS on the opportunity screen only.
- Case 5 (member, on device): Settings > Blockout dates as bandm. Created "New block SECRET-NEW" (all day), edited it (reason suffixed " EDITED", saved), deleted it with the trash icon; the original "Dentist PRIVATE-BANDM" blockout remained. The member sees their own reasons, as designed.
- Case 5 (leader, API): `GET /blockouts?person_id=` as the Band leader for Mob dual (Band + Vocals member, in scope) returns the row with `reason: null` and no private text; for Mob bandm the same; for Mob voxm (Vocals only, out of scope) 404 `Person not found`; `/availability/preferences` likewise 200 (empty) in scope and 404 out of scope.
- Case 5 (across organizations): bandm belongs to two churches (Settings shows "Switch church 2": QA Mobile A / QA Mobile B). The "Across my churches" screen opened and its combined-schedule toggle rendered; I toggled it and restored it to off, so no combined list was exercised. API `GET /me/combined-schedule` answers 403 "Turn on the combined schedule first" while it is off, as designed.
- Case 4 template apply (API): a template with the `roster` component applied to QA Band Practice previews the roster add for Mob dual for the owner; for the Band leader (who cannot see Mob dual's person row) the same preview lists that person under `skipped: person_unavailable` instead of adding them. This is existing template behaviour, not changed by this branch, noted for the product owner.
- Case 6: schedule-people picker for Band lists Mob bandm, dual, lead, owner, voxm; "Mob inactive" (a Band member with an inactive membership) is absent.
- Case 7: form needs church name, leader, city, country; Time zone prefilled `America/Chicago`; Send for review succeeded and the screen changed to "Waiting for review" (Edit details / Withdraw request). A pending church application now exists for bandm; leave or withdraw as needed.

## Observations (not defects)

- A lead granted `plans.edit` mid-session kept the read-only plan times screen until the app was reloaded (access is cached per launch).
- Device zone differs from the org zone (device 9:00 AM vs org 10:00 AM Toronto); the times editor labels the org zone.
- iOS "Save Password?" prompt appears after sign-in (system, harmless).
- Opening a replacement the signed-in user may not see (bandm viewing someone else's request, owner opening dual's request id directly before it listed) shows a graceful "isn't available to you" state, no crash.

## Still open

Time-edit Review changes as a scoped lead (device), apply-template conflict list on device, `team-preferences` screen as lead on device, a notes screen, a song chart (needs a song in the fixture org), calendar tab, and an actual combined schedule for bandm (toggle on, then off).
