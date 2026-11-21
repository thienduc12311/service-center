# SYNC-01 handoff, web to native (wave 7)

Created in the web UI at 2026-11-20 by the W7-WEB agent, as `scheduler.qa20261120.sync@example.test` (role `scheduler`, legacy access) in org `qa-20261120-sync-a`. Credentials: `scratchpad/shared/sync-creds.env` (not in git). Local DB revisions were read with psql after the web writes.

Org id: `596383eb-d9ad-4bfa-a154-a324470d13e3` (timezone America/Chicago). Users: owner, scheduler, member (`*.qa20261120.sync@example.test`).

Fixture note: the team and the first plan below were set up in the UI. The member's team roster membership was added through the owner API (a legacy scheduler cannot edit rosters by the permission oracle). The service-type wizard also created an extra draft plan "QA Sync Sunday" (id `0e461a03-5c6d-48bf-9810-eccc759ff285`, 2026-11-22 10:00 CST, empty); ignore it.

## Web-created

| Resource | ID | Value created on web | Revision at handoff |
|---|---|---|---|
| Team | `feff7fb8-ceda-4bca-848b-89afe87001a6` | "QA Sync Band" | n/a (no revision column) |
| Team position | `e7b3cc86-adfb-4a28-9df6-1c1c55aee8d8` | "Vocals" | n/a |
| Service type | `48a8f3f5-5a15-4e02-848e-91fb11113769` | "QA Sync Sunday" | n/a |
| Plan | `70a871e8-7319-4191-a242-52bae99e0d9a` | "QA W7 sync plan", 2026-11-29 11:30 America/Chicago (17:30Z), draft, service type QA Sync Sunday | content_revision 3, staffing_revision 2 |
| Order item 1 (header) | `dee105a5-0a43-4246-ba82-caaa96e543b6` | header "QA W7 sync header", sort_order 0 | part of plan content_revision |
| Order item 2 (free-form) | `7e7c26df-9a5f-474a-91ae-ff297ab43ad2` | item "QA W7 sync free-form", 180 s, notes "web-created free-form", sort_order 1 | part of plan content_revision |
| Plan note | `257f9cbc-cd36-4940-8be4-be7d7106ec3b` | "QA W7 web-created plan note", audience organization | revision 1 |
| Assignment | `9bf7c94a-3a1d-4fb6-a680-229620e833d8` | Member Sync (person `040cd0fd-2b77-4d5b-8718-07a3d5cb3b30`), Vocals, status unconfirmed, released | request_revision 0 |

Evidence: `evidence/web-sync-plan-created.png`.

## Native-edited

(To be appended by the W7-NATIVE agent: what was read/edited on iOS, resulting IDs and revisions.)

### Native-edited (W7-NATIVE, iOS 27.2 simulator, Expo Go 57.0.9, 2026-11-20 ~22:24-22:28 UTC)

Native read of every web-created resource rendered correctly as the sync scheduler (plan title/status, 11:30 AM America/Chicago, header, free-form with notes and 3:00, note, assignment Member Sync / Vocals / Unconfirmed; evidence `evidence/ios-sync-plan-render.png`).

| Edit on iOS | Resource ID | Before | After | Revision after | Time (UTC) |
|---|---|---|---|---|---|
| Service time moved (Edit times, review, "send updated requests" unchecked) | plan_time `b9f09855-4829-4738-b481-16476490665c` | 17:30Z-19:00Z | 17:31Z-19:00Z (same id) | plan content_revision 3 -> 4, staffing_revision 2 -> 3 | ~22:24 |
| Header renamed | item `dee105a5-0a43-4246-ba82-caaa96e543b6` | QA W7 sync header | QA W7 sync header (iOS) | content_revision 4 -> 5 | ~22:25 |
| Note edited | note `257f9cbc-cd36-4940-8be4-be7d7106ec3b` | QA W7 web-created plan note, rev 1 | ... [iOS edit], rev 2 | note revision 2 | 22:26:24 |
| Stale edit test (see below) | item `7e7c26df-9a5f-474a-91ae-ff297ab43ad2` | web-created free-form | API title "QA W7 sync free-form (API concurrent)" (content_revision 6); native stale save refused; after explicit "Load the latest plan and keep my edits" native saved "QA W7 sync free-form iOSstale" | content_revision 7 | ~22:27 |
| Member accepted assignment (sync member, native) | assignment `9bf7c94a-3a1d-4fb6-a680-229620e833d8` | unconfirmed | confirmed, 1 assignment row, 1 assignment_responses row | staffing_revision 3 -> 4, request_revision 0 | 22:27:59 |

Final plan row `70a871e8-...`: content_revision 7, staffing_revision 4. Exactly one plan titled "QA W7 sync plan", 2 items, 1 plan_time, 1 note, 1 assignment. Stale concurrent edit: the scheduler token PATCHed the free-form item through the API after native loaded its edit form; native Save then showed "Someone else changed this plan after you opened this item. Your edits are still here." and the DB kept the API title (not silently overwritten). Observation: the plan header still reads "Sun, Nov 29 - 11:30 AM" (plans.service_date unchanged) while the service time reads 11:31 AM.
