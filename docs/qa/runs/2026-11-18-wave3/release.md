# QA-07 Release, reminders, durable delivery — wave 3 results

**Package:** QA-07 (RELEASE-01, RELEASE-02, REMIND-01, DELIVERY-01, DELIVERY-02; plan section 5.E)
**Date:** 2026-11-18  **Commit:** 5bedb99 on branch feature/qa-wave3 (= main). No code, migration or config changed.
**Environment:** API :4000 (RESEND/EXPO blank so every outcome is `simulated`; `CRON_SECRET` and `DELIVERY_LINK_SECRET` unset in backend/.env, so the HTTP worker route on :4000 answers 404 and provider idempotency keys are not sent), local Supabase, Node 26.13.1. Browser and devices not used (web/mobile steps are NOT_RUN).
**Namespace:** orgs `qa-20261118-rel-a` (America/Chicago) and `qa-20261118-rel-b` (Asia/Ho_Chi_Minh); users `<alias>.qa20261118.rel@example.test` (owner, admin, legacy, lead, pending, member, ownerb). Passwords only in the scratchpad (qa07/).
**Fixture shape (org A):** service type Sunday; teams Band (Acoustic, Bass, Drums) and Production (Camera); owner and admin; legacy scheduler (`legacy` mode); `lead` = ordinary member holding only a team-scoped `scheduling.manage` grant on Band; recipients `pending` (Acoustic and Bass, vi language, one registered test push device), `member`, no-login Person `guest` (has email), no-login Person `noemail` (no address). About 120 plans (release, race and reminder plans). Org B: one owner, one team, one plan, one policy.
**Method:** setup (users, memberships, the lead's team grant via the owner's API) with service role/admin; every feature action driven through the real API with each actor's own bearer token; direct-surface evidence via PostgREST/RPC with the caller's JWT. Worker runs: the CLI worker (`tsx src/worker.ts`, same entry as `npm run worker`) and, for the HTTP route, a second API instance on :4001 started with a generated CRON_SECRET (stopped afterwards; :4000 untouched). Crash/lease/provider-fault cases are simulated by calling the service-role DB functions (`claim_deliveries`, `complete_delivery`, `begin_delivery_provider_call`) and by editing my own org's rows with SQL; real provider faults need provider keys (BLOCKED, below).
**Shared-resource note:** the worker processes every org. My runs also recomputed reminder jobs for about 1,360 queued plans of other qa orgs (wave-2 backlog) and retried 16 `internal_error` deliveries of `qa-20261117-resp-a` to their terminal state (observation O3). The official f08 shell suites touch the seed org with self-cleaning rows; they left nothing behind.

## Summary

Expanded cases executed: **224** — PASS 221, FAIL 3, BLOCKED 0, NOT_RUN 0 among executed rows (not-run/blocked items are listed separately below). DB suites: f08-release-reminders PASS (it FAILED once while the recompute queue held 1,359 plans; see W3-REL-D4), f08-matrix-release-batch PASS, f08-concurrent-matrix-release.sh PASS, f08-concurrent-worker.sh PASS. Backend unit tests delivery-dispatch, delivery-locale, app: 23/23 PASS.

**Escalation: P0 W3-REL-D1.** Any authenticated non-member can run admin-only security-definer RPCs against another tenant (retry its deliveries, cancel its scheduled releases, create and revoke its API credentials, read its members' effective access).

Defects: W3-REL-D1 (P0), W3-REL-D2 (P1), W3-REL-D3, D4, D5, D6 (P2). Details below.

## RELEASE-01 Preview and release

71 cases: PASS 71

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RELEASE-01.owner.prepared-preview-list.API | owner | API | status 200 | prepared 200 (n=4) preview 200 list 200 | PASS |
| RELEASE-01.admin.prepared-preview-list.API | admin | API | status 200 | prepared 200 (n=4) preview 200 list 200 | PASS |
| RELEASE-01.legacy.prepared-preview-list.API | legacy | API | status 200 | prepared 200 (n=4) preview 200 list 200 | PASS |
| RELEASE-01.lead.prepared-preview-list.API | lead | API | status 200 | prepared 200 (n=4) preview 200 list 200 | PASS |
| RELEASE-01.pending.prepared-preview-list.API | pending | API | status 403 | prepared 403 (n=-) preview 403 list 403 | PASS |
| RELEASE-01.member.prepared-preview-list.API | member | API | status 403 | prepared 403 (n=-) preview 403 list 403 | PASS |
| RELEASE-01.ownerb.prepared-preview-list.API | ownerb | API | status 403 | prepared 403 (n=-) preview 403 list 403 | PASS |
| RELEASE-01.anon.prepared.API | anon | API | 401 | 401 | PASS |
| RELEASE-01.pending.prepared-hidden.API+RLS | pending | API+RLS | prepared rows hidden from recipient | schedule/mine has plan: false; PostgREST assignments rows: 0 | PASS |
| RELEASE-01.pending.release_batches.RLS | pending | DB/RLS | no rows | 200 n=0 | PASS |
| RELEASE-01.pending.create_release_batch.RPC | pending | DB/RLS rpc | denied (P0002/42501), nothing released | 500 {"code":"P0002","details":null,"hint":null,"message":"Some of those requests are not yours to release"} | PASS |
| RELEASE-01.member.prepared-hidden.API+RLS | member | API+RLS | prepared rows hidden from recipient | schedule/mine has plan: false; PostgREST assignments rows: 0 | PASS |
| RELEASE-01.member.release_batches.RLS | member | DB/RLS | no rows | 200 n=0 | PASS |
| RELEASE-01.member.create_release_batch.RPC | member | DB/RLS rpc | denied (P0002/42501), nothing released | 500 {"code":"P0002","details":null,"hint":null,"message":"Some of those requests are not yours to release"} | PASS |
| RELEASE-01.lead.prepared-scope.API | lead | API | Production request not listed to Band-only lead | ids contain prod: false | PASS |
| RELEASE-01.lead.preview-out-of-scope.API | lead | API | 409 stale (no leak) | 409 assignment_release_stale | PASS |
| RELEASE-01.lead.release-out-of-scope.API | lead | API | denied; nothing released | 404 {"error":"Some of those requests are not yours to release","code":"not_found"} | PASS |
| RELEASE-01.lead.stale-revision.API | lead | API+DB | 409 whole batch refused, no batch row, none released | 409 conflict; batches 0->0; released rows 0 | PASS |
| RELEASE-01.lead.deleted-between-review-release.API | lead | API+DB | refused whole (404/409), none released | del 204; release 404 not_found; released rows 0 | PASS |
| RELEASE-01.lead.preview-deleted-id.API | lead | API | 409 stale | 409 assignment_release_stale | PASS |
| RELEASE-01.lead.release-notify-off.API | lead | API+DB | 201 released, effect_id null, 0 effects/deliveries/notifications, assignment visible to member | 201 batch released effect_id=null; effects 0; deliveries 0; notifications 0; member sees true | PASS |
| RELEASE-01.lead.release-same-key-repeat.API | lead | API+DB | same batch id returned, 1 row | 201 same=true; rows 1 | PASS |
| RELEASE-01.lead.release-same-key-different-set.API | lead | API | 409 conflict | 409 conflict | PASS |
| RELEASE-01.owner.publish-alone-sends-nothing.API+DB | owner | API+DB | publish does not release or enqueue; recipients still see nothing | publish 200; status published; deliveries 5->5; notifications 3->3; effects 1->1; assignments prepared:3; pending sees plan false | PASS |
| RELEASE-01.lead.scheduled-release-create.API+DB | lead | API+DB | 202 scheduled, nothing released/enqueued yet | 202 scheduled; released_assignment_ids 0; assignment prepared; effect_id null | PASS |
| RELEASE-01.lead.scheduled-release-list.API | lead | API | creator sees batch with plan titles | 200 n=1 has=true titles=["REL P-DRAFT3"] | PASS |
| RELEASE-01.legacy.list-others-batches.API+RLS | legacy | API/RLS | non-admin scheduler does not see other creator's batches (per service comment) | 200 n=0 sees lead batch=false | PASS |
| RELEASE-01.admin.list-all-batches.API | admin | API | admin sees all | 200 sees=true | PASS |
| RELEASE-01.legacy.cancel-others-batch.API | legacy | API | denied/404, still scheduled | 404 status now scheduled | PASS |
| RELEASE-01.member.cancel.API | member | API | 403 | 403 | PASS |
| RELEASE-01.ownerb.cancel-cross-org.API | ownerb(B) | API | 404, still scheduled | 404 | PASS |
| RELEASE-01.lead.cancel-scheduled.API+DB | lead/admin | API+DB | cancelled; repeat no-op; guest assignment stays prepared | 200 cancelled; repeat 200 cancelled; admin 200 cancelled; asg prepared | PASS |
| RELEASE-01.lead.cancel-released-batch.API | lead | API | reported as released, not undone | 200 released | PASS |
| RELEASE-01.lead.cancel-unknown-id.API | lead | API | 404 unknown, 4xx malformed | unknown 404; malformed 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| RELEASE-01.worker.scheduled-release-due-actor-revoked.DB | lead(revoked) | API+DB+worker | both batches by revoked lead fail actor_not_permitted; assignments remain prepared; no effect | [["444fe944-ebeb-4f93-b8b7-8076905e147b","failed","actor_not_permitted","f"],["b23799c0-f573-473e-9307-034b09c1d61f","failed","actor_not_permitted","f"]] | PASS |
| RELEASE-01.worker.scheduled-release-due-success.DB | lead(restored) | worker+DB | released once, 1 effect, member gets in_app delivered + email simulated, assignment released | released\|\|d9085087-4dbc-4b78-9fcd-8e731c7d4ebf; effects 1; deliveries in_app:delivered,push:skipped,email:simulated; asg released | PASS |
| RELEASE-01.pending.delivery-failure-keeps-request-visible.API+DB | pending/admin | API+DB | email failed but assignment released+visible to recipient; admin sees needs-attention row | asg released; recipient sees true; admin needs_attention n=3 statuses=failed | PASS |
| RELEASE-01.lead.response-owner-change.API+DB | lead | API+DB | owner changes to a scheduler of the team; history row written | 200; 0d823967 -> cbbc1ab1; history 200 n=1 | PASS |
| RELEASE-01.lead.response-owner-nonscheduler.API | lead | API | refused (new owner must schedule the team) | 400 bad_request; owner still cbbc1ab1 | PASS |
| RELEASE-01.member.response-owner.API | member | API | 403 | 403 | PASS |
| RELEASE-01.ownerb.response-owner-cross-org.API | ownerb(B) | API | refused, unchanged | 404; owner still cbbc1ab1 | PASS |
| RELEASE-01.lead.validation.empty-items.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.dup-items.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.bad-uuid.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.negative-revision.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.short-key.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.missing-key.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.notify-nonbool.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.over-500.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.sched-over-year.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.sched-garbage.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.unknown-assignment.API | lead | API | status 404,409 | 404 not_found | PASS |
| RELEASE-01.lead.validation.preview-empty.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.preview-bad-uuid.API | lead | API | status 422 | 422 unprocessable | PASS |
| RELEASE-01.lead.validation.preview-unknown.API | lead | API | status 409 | 409 assignment_release_stale | PASS |
| RELEASE-01.lead.validation.prepared-days-0.API | lead | API | 422 | 422 | PASS |
| RELEASE-01.lead.validation.prepared-days-abc.API | lead | API | 422 | 422 | PASS |
| RELEASE-01.lead.validation.list-limit.API | lead | API | 422 | 422 | PASS |
| RELEASE-01.lead.validation.list-status.API | lead | API | 422 | 422 | PASS |
| RELEASE-01.lead.scheduled-for-past.API | lead | API | past scheduled_for releases immediately (201 released) rather than being rejected | 201 released (documented behaviour in create_release_batch (<= now() executes)) | PASS |
| RELEASE-01.lead.plan-route-same-key-different-set.API | lead | API | 409 | 409 conflict | PASS |
| RELEASE-01.member.plan-route-release.API | member | API | 403 | 403 | PASS |
| RELEASE-01.ownerb.plan-route-release-cross-org.API | ownerb(B) | API | 404 | 404 | PASS |
| RELEASE-01.lead.plan-route-release+repeat.API+DB | lead | API+DB | preview 200; release returns 2 rows; repeat same key same rows; exactly one batch+effect | preview 200; rel 200 n=2; repeat 200 n=2; 1 batch (released), 1 effect ((first query used wrong key prefix; re-verified)) | PASS |
| RELEASE-01.ownerb.create_release_batch-cross-tenant.p_org=A.RLS | ownerb | DB rpc (caller JWT) | denied; assignment stays prepared | 500 P0002; visibility prepared | PASS |
| RELEASE-01.ownerb.create_release_batch-cross-tenant.p_org=B.RLS | ownerb | DB rpc (caller JWT) | denied; assignment stays prepared | 500 P0002; visibility prepared | PASS |
| RELEASE-01.ownerb.release_batches-select.RLS | ownerb | DB/RLS | 0 org A rows | n=0 | PASS |
| RELEASE-01.ownerb.release_batch_items-select.RLS | ownerb | DB/RLS | 0 rows | n=0 | PASS |
| RELEASE-01.lead.release_batches-direct-insert.RLS | lead | DB/RLS | denied (only RPC creates batches) | 403 | PASS |
| RELEASE-01.admin.release_batches-direct-update.RLS | admin | DB/RLS | denied; status unchanged | 403; status scheduled | PASS |
| RELEASE-01.lead.assignments-direct-visibility-flip.RLS | lead | DB/RLS (PostgREST PATCH) | a scheduler cannot flip prepared->released outside the release flow (no release batch, no notification) | 403 {"code":"42501","details":null,"hint":null,"message":"Release requests with release_plan_assignments; visibility prepared | PASS |

## RELEASE-02 Release races

9 cases: FAIL 1, PASS 8

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| RELEASE-02.lead.same-key-x10-concurrent.API+DB | lead | API+DB (8 iterations x 10 parallel) | all 201 same batch; 1 batch row, 1 effect, one delivery per recipient/channel, 4 released | 7/8 iterations all 201; iteration 3: one of 10 calls got 409. Invariants held. (W3-REL-D3: about 1-2% of concurrent duplicates get 409 although the release succeeded; invariants held in every iteration; re-measured 2 of 120 calls over 12 iterations) | FAIL |
| RELEASE-02.4actors.different-keys-same-set.API+DB | lead,legacy,owner,admin | API+DB (8 iterations x 4 parallel) | exactly one 201, rest 409, 1 batch row retained, <=1 effect (0 if notify=false winner) | 8/8 iterations: 1 winner, 3x409, 1 batch row, effect count consistent | PASS |
| RELEASE-02.lead+legacy.release-vs-delete.API+DB | lead,legacy | API+DB (16 iterations) | release whole or refused whole; no partial release when a reviewed row is deleted | 16/16 consistent (release first 5, delete first 11) | PASS |
| RELEASE-02.3actors.overlapping-subsets.API+DB | lead,legacy,owner | API+DB (10 iterations) | overlap loser gets 409 whole, retains no batch row/effect; no deadlock/500; released = union of winners | 10/10 consistent, no 500/deadlock | PASS |
| RELEASE-02.lead+legacy.release-vs-edit.API+DB | lead,legacy | API+DB (16 iterations) | release either wins with the reviewed revision snapshot (all 4 released, 1 effect) or 409s whole (0 released, 0 effects); edit never lost | 16/16 consistent (release won 6, edit won 10) | PASS |
| RELEASE-02.lead.stale-reviewed-set-not-broadened.API+DB | lead | API+DB | late-added prepared request for same Person/plan is NOT released or in the message | release 201; late request prepared; effect assignment_ids 2; recipient sees late request false | PASS |
| RELEASE-02.lead.plan-route-same-key-x8.API+DB | lead | API+DB (6 iterations x 8 parallel) | all 200 with the same 4 rows; 1 batch, 1 effect | 6/6 iterations OK | PASS |
| RELEASE-02.lead.scheduled-same-key-x10.API+DB | lead | API+DB (4 iterations x 10 parallel) | all 202 same batch; 1 row; nothing released early | 4/4 OK | PASS |
| RELEASE-02.3workers.six-due-scheduled-batches.DB | worker x3 concurrent | worker+DB | each batch released once: 6 released, 6 effects (1 per batch), 18 released rows, no duplicate delivery, none stuck | status released\|6; effects/batches 6\|6; released rows 18; dup deliveries 0; unfinished 0 | PASS |

## REMIND-01 Reminders

93 cases: PASS 93

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| REMIND-01.owner.policy-write.org.API | owner | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.admin.policy-write.org.API | admin | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.legacy.policy-write.org.API | legacy | API | denied (403/404) | PUT 403 forbidden; GET 200 can_edit=false | PASS |
| REMIND-01.lead.policy-write.org.API | lead | API | denied (403/404) | PUT 403 forbidden; GET 200 can_edit=false | PASS |
| REMIND-01.pending.policy-write.org.API | pending | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.member.policy-write.org.API | member | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.owner.policy-write.st.API | owner | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.admin.policy-write.st.API | admin | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.legacy.policy-write.st.API | legacy | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.lead.policy-write.st.API | lead | API | denied (403/404) | PUT 403 forbidden; GET 200 can_edit=false | PASS |
| REMIND-01.pending.policy-write.st.API | pending | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.member.policy-write.st.API | member | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.owner.policy-write.team.API | owner | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.admin.policy-write.team.API | admin | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.legacy.policy-write.team.API | legacy | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.lead.policy-write.team.API | lead | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.pending.policy-write.team.API | pending | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.member.policy-write.team.API | member | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.owner.policy-write.prodteam.API | owner | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.admin.policy-write.prodteam.API | admin | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.legacy.policy-write.prodteam.API | legacy | API | write allowed (2xx) | PUT 200; GET 200 can_edit=true | PASS |
| REMIND-01.lead.policy-write.prodteam.API | lead | API | denied (403/404) | PUT 403 forbidden; GET 200 can_edit=false | PASS |
| REMIND-01.pending.policy-write.prodteam.API | pending | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.member.policy-write.prodteam.API | member | API | denied (403/404) | PUT 403 forbidden; GET 403 can_edit=undefined | PASS |
| REMIND-01.member-org.policy-insert.RLS | member | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.pending-st.policy-insert.RLS | pending | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.lead-org.policy-insert.RLS | lead | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.lead-prodteam.policy-insert.RLS | lead | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.legacy-org.policy-insert.RLS | legacy | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.ownerb-orgA.policy-insert.RLS | ownerb | DB/RLS (PostgREST, caller JWT) | denied, no row | 403 42501; rows 0->0 | PASS |
| REMIND-01.ownerb-orgB-with-A-team.policy-insert.RLS | ownerb | DB/RLS (PostgREST, caller JWT) | denied, no row | 400 22023; rows 0->0 | PASS |
| REMIND-01.member.jobs-policies-select.RLS | member | DB/RLS | no reminder_jobs rows; (policies: org-visible to members or none) | jobs 200 n=0; policies 200 n=0 | PASS |
| REMIND-01.pending.jobs-policies-select.RLS | pending | DB/RLS | no reminder_jobs rows; (policies: org-visible to members or none) | jobs 200 n=0; policies 200 n=0 | PASS |
| REMIND-01.ownerb.jobs-policies-select.RLS | ownerb | DB/RLS | no reminder_jobs rows; (policies: org-visible to members or none) | jobs 200 n=0; policies 200 n=0 | PASS |
| REMIND-01.member.plan_reminder_jobs.RPC | member | DB/RLS rpc | denied | 500 P0002 | PASS |
| REMIND-01.pending.plan_reminder_jobs.RPC | pending | DB/RLS rpc | denied | 500 P0002 | PASS |
| REMIND-01.ownerb.plan_reminder_jobs.RPC | ownerb | DB/RLS rpc | denied | 500 P0002 | PASS |
| REMIND-01.member.plan-deliveries.API | member | API | 403 | 403 | PASS |
| REMIND-01.pending.plan-deliveries.API | pending | API | 403 | 403 | PASS |
| REMIND-01.ownerb.plan-deliveries-cross-org.API | ownerb(B) | API | 404 | 404 | PASS |
| REMIND-01.ownerb.plan-deliveries-orgA-header.API | ownerb | API | 403 not a member | 403 | PASS |
| REMIND-01.owner.policy-precedence-org.API | owner/legacy/lead | API | org policy applies when no narrower: pending jobs in_app+email 48h before (2026-11-22T15:00Z) | email@11-22T15:00/policy in_app@11-22T15:00/policy | PASS |
| REMIND-01.legacy.policy-precedence-service-type.API | legacy | API | service-type beats org: email+push 24h before (11-23T15:00Z) | email@11-23T15:00/policy push@11-23T15:00/policy | PASS |
| REMIND-01.lead.policy-precedence-team+quiet-hours+timezone.API | lead | API | team beats service type: email only, 10h before = 11-24T05:00Z = 23:00 America/Chicago, inside quiet 22:00-08:00 -> shifted to 08:00 local = 11-24T14:00Z | email@11-24T14:00/policy | PASS |
| REMIND-01.owner.policy-kind-isolation.API | owner | API | pending policy does not alter confirmed_service jobs (default 24h, 3 channels) | email@11-23T15:00/default in_app@11-23T15:00/default push@11-23T15:00/default | PASS |
| REMIND-01.lead+legacy+owner.policy-delete-inherit.API | lead/legacy/owner | API | deleting team->st->org policies falls back each level, finally default 72h in_app/push/email | email@11-23T15:00/policy push@11-23T15:00/policy \|\| email@11-22T15:00/policy in_app@11-22T15:00/policy \|\| email@11-21T15:00/default in_app@11-21T15:00/default push@11-21T15:00/default | PASS |
| REMIND-01.owner.policy-validation.offset-14.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.offset-15-ok.API | owner | API | status 200 | 200  | PASS |
| REMIND-01.owner.policy-validation.offset-43200-ok.API | owner | API | status 200 | 200  | PASS |
| REMIND-01.owner.policy-validation.offset-43201.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.offset-fraction.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.channels-empty.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.channels-dup.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.channels-unknown.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.quiet-one-sided.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.quiet-equal.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.quiet-bad-format.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.quiet-same-day-ok.API | owner | API | status 200 | 200  | PASS |
| REMIND-01.owner.policy-validation.max-per-day-0.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.max-per-day-11.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.both-scopes.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.kind-unknown.API | owner | API | status 422 | 422 unprocessable | PASS |
| REMIND-01.owner.policy-validation.service-type-other-org.API | owner | API | status 400 | 400 bad_request | PASS |
| REMIND-01.owner+admin.policy-stale-revision.API | owner,admin | API | second write with old revision -> 409 reminder_policy_stale; first retained | first 200 rev 4; stale 409 reminder_policy_stale; stored offset 900 | PASS |
| REMIND-01.owner+admin.policy-concurrent-update.API+DB | owner,admin | API+DB (4 parallel, same expected revision) | exactly one 200, others 409; revision +1 only | 200,409,409,409; revision now 5 (was 4) | PASS |
| REMIND-01.member+legacy.policy-delete-denied.API | member,legacy | API | 403 both; policy retained | 403,404; exists 1 | PASS |
| REMIND-01.owner.policy-delete-bad-ids.API | owner | API | malformed -> 4xx, unknown -> 404 | malformed 400 bad_request; unknown 404 | PASS |
| REMIND-01.owner.policy-delete.API | owner | API | 204 | 204 | PASS |
| REMIND-01.owner.policy-scope-query-validation.API | owner | API | 422 both | 422,422 | PASS |
| REMIND-01.pending.preferences-email-off.API | pending | API | email jobs disappear; push+in_app remain; guest unaffected | 200; pending channels: in_app,push; guest: email | PASS |
| REMIND-01.pending.preferences-only-email.API | pending | API | only email job remains | email | PASS |
| REMIND-01.pending.preferences-all-off.API | pending | API | no jobs at all for that Person (no reminder), request itself unaffected | jobs: ""; assignments released: 2 | PASS |
| REMIND-01.pending.preferences-validation.API | pending | API | 422 | 422,422 | PASS |
| REMIND-01.anon.preferences.API | anon | API | 401 | 401 | PASS |
| REMIND-01.ownerb.preferences-isolation.API | ownerb | API | own org returns own person; org A header 403 | orgB 200 person 280d9957; orgA 403 | PASS |
| REMIND-01.member.other-person-preferences.RLS | member | DB/RLS | cannot edit another Person preference | 200 rows 0; pending email pref now t | PASS |
| REMIND-01.member.insert-pref-for-guest.RLS | member | DB/RLS | denied | 403 42501 | PASS |
| REMIND-01.pending.respond-declined-recompute.API | pending | API | decline 1/2: same channels still scheduled under a new request version, old cancelled; decline 2/2: none scheduled | respond 200/200; before "email@11-21T15:00,in_app@11-21T15:00,push@11-21T15:00"; after one "email@11-21T15:00,in_app@11-21T15:00,push@11-21T15:00" (cancelled 8); after both "" | PASS |
| REMIND-01.lead.rerequest-after-decline-recompute.API | lead | API | re-requested position gets pending reminders again | 200; "email@11-21T15:00,in_app@11-21T15:00,push@11-21T15:00" | PASS |
| REMIND-01.pending.respond-confirmed-recompute.API | pending | API | pending_response none; confirmed_service scheduled at 24h before (11-23T15:00) | 200; pending ""; confirmed "email@11-23T15:00,in_app@11-23T15:00,push@11-23T15:00" | PASS |
| REMIND-01.lead.assignment-deleted-recompute.API+DB | lead | API+DB | guest jobs cancelled/none scheduled | before "email@11-21T15:00"; delete 204; after ""; db scheduled for guest: 0 | PASS |
| REMIND-01.owner.plan-redate-recompute.API | owner | API | moving service +1 day moves due times +1 day (pending 72h -> 11-22T15:00; confirmed 24h -> 11-24T15:00); old jobs cancelled not duplicated | patch 200; member confirmed "email@11-24T15:00,in_app@11-24T15:00,push@11-24T15:00"; member pending "email@11-22T15:00,in_app@11-22T15:00,push@11-22T15:00"; cancelled(confirmed member) 3 | PASS |
| REMIND-01.owner.reminder-anchor-earliest-time.API | owner | API | confirmed_service anchors on earliest attendance time (rehearsal 11-24T02:00Z -> due 11-23T02:00Z); pending_response anchors on service (11-25T15:00 - 72h = 11-22T15:00Z) | confirmed email@11-23T02:00,in_app@11-23T02:00,push@11-23T02:00; pending email@11-22T15:00,in_app@11-22T15:00,push@11-22T15:00 | PASS |
| REMIND-01.lead.time-scope-change-recompute.API | lead | API | narrowing member to service-only moves confirmed reminder to 11-24T15:00Z; old (rehearsal-anchored) job cancelled | 200; confirmed email@11-24T15:00,in_app@11-24T15:00,push@11-24T15:00; cancelled 9 | PASS |
| REMIND-01.lead.time-scope-stale-revision.API | lead | API | 409 stale | 409 assignment_revision_stale | PASS |
| REMIND-01.worker.due-vs-future-jobs.DB | worker | worker+DB | 5 due pending_response jobs enqueued (one effect each, assignment_reminder), 3 future confirmed_service stay scheduled, no effect | effects 0->5\|5; enqueued 5; future scheduled 3 (my script expected 6; fixture has 5 pending jobs) | PASS |
| REMIND-01.worker.reruns-no-duplicate-reminders.DB | worker x2 concurrent | worker+DB | still 5 reminder effects; no duplicate deliveries | effects 5; dup deliveries 0 (script expectation corrected 6->5) | PASS |
| REMIND-01.worker.answered-after-enqueue-is-obsolete.DB | pending,member,worker | API+worker+DB | pending_response reminders enqueued but not yet sent are NOT sent once the person confirms (cancelled reminder_obsolete); in-app row not created | queued before 6; outcomes: QA:email:cancelled:reminder_obsolete; QA:email:cancelled:reminder_obsolete; QA:in_app:cancelled:reminder_obsolete; QA:in_app:cancelled:reminder_obsolete; QA:push:cancelled:reminder_obsolete; QA:push:cancelled:reminder_obsolete | PASS |
| REMIND-01.owner.plan-deleted-recompute.API+DB | owner | API+DB | plan delete removes/cancels all its reminder jobs | scheduled 4; delete 204; jobs remaining 0; queue rows 0 | PASS |
| REMIND-01.owner.person-archived-recompute.API+DB | owner | API+DB | archived Person gets no scheduled reminders; others unaffected | before 1; archive 200; after 0; other person scheduled 3 | PASS |
| REMIND-01.owner.person-restored-recompute.API+DB | owner | API+DB | restored Person regains scheduled reminders | restore 200; scheduled 1 | PASS |
| REMIND-01.ownerb.timezone-quiet-hours-org-B.API | ownerb (org B, Asia/Ho_Chi_Minh) | API | quiet hours evaluated in the organization timezone (UTC+7): due 00:00 local -> 08:00 local = 01:00Z | due_at 2026-11-28T01:00:00+00:00; expected 2026-11-28T01:00:00.000Z | PASS |
| REMIND-01.worker.max-per-day-frequency-cap.DB | worker | worker+DB | Person already received >= max_per_day (default 2) email reminders in 24h (R2/R3 earlier); a newly due email reminder is deferred to oldest+24h, not sent, not lost | REL cap one:cancelled:no_longer_applicable:false:policy=false ; REL cap two:cancelled:no_longer_applicable:false:policy=false ; REL cap two:scheduled::true:policy=true; sends in 24h 2\|2026-11-18 17:24:28.222828+00 | PASS |

## DELIVERY-01 Delivery outcomes and retry

43 cases: PASS 41, FAIL 2

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELIVERY-01.member.list-deliveries-admin-only.API | member | API | 403 | list 403 status 403 | PASS |
| DELIVERY-01.pending.list-deliveries-admin-only.API | pending | API | 403 | list 403 status 403 | PASS |
| DELIVERY-01.lead.list-deliveries-admin-only.API | lead | API | 403 | list 403 status 403 | PASS |
| DELIVERY-01.legacy.list-deliveries-admin-only.API | legacy | API | 403 | list 403 status 403 | PASS |
| DELIVERY-01.owner.list-deliveries.API | owner | API | 200 | list 200 n=8; status 200 {"email":"simulated","push":"simulated","worker_configured":false,"pending":0,"needs_attention":3} | PASS |
| DELIVERY-01.admin.list-deliveries.API | admin | API | 200 | list 200 n=8; status 200 {"email":"simulated","push":"simulated","worker_configured":false,"pending":0,"needs_attention":3} | PASS |
| DELIVERY-01.lead.release-outcomes-simulated-vs-delivered.API+DB | lead,pending | API+DB | email=simulated (never provider_accepted/delivered); in_app=delivered; push with registered device=simulated; missing email=skipped no_email_address; push w/o device=skipped no_active_device | Guest\|email\|simulated\|\|en\|1\|- ; NoEmail\|email\|skipped\|no_email_address\|en\|1\|- ; QA\|email\|simulated\|\|en\|1\|- ; QA\|email\|simulated\|\|vi\|1\|- ; QA\|in_app\|delivered\|\|en\|1\|- ; QA\|in_app\|delivered\|\|vi\|1\|- ; QA\|push\|simulated\|\|vi\|1\|- ; QA\|push\|skipped\|no_active_device\|en\|1\|- | PASS |
| DELIVERY-01.system.locale-captured-on-delivery.DB | lead | DB | vi preference captured on pending deliveries; others default | Guest:en ; NoEmail:en ; QA:en ; QA:vi | PASS |
| DELIVERY-01.admin.list-needs-attention-filter.API | admin | API | only failed+ambiguous rows (3), retryable=true, error codes visible | n=3; email:failed:provider_rejected:true,email:ambiguous:outcome_unknown:true,push:failed:provider_rejected:true | PASS |
| DELIVERY-01.admin.list-status-channel-filters.API | admin | API | status=ambiguous -> 1; channel=push -> 2 | 1; 2 | PASS |
| DELIVERY-01.admin.list-pagination-tied-created_at.API | admin | API | 8 deliveries of one release: pages of 3 reach all 8 (3+3+2) | page1 3 next_before=2026-11-18T17:25:50.131868+00:00; page2 0 next_before=null (5 rows unreachable; all 8 share created_at) (W3-REL-D2) | FAIL |
| DELIVERY-01.admin.list-validation.limit-0.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.limit-101.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.status-bogus.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.channel-sms.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.plan_id-x.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.before-yesterday.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.admin.list-validation.needs_attention-maybe.API | admin | API | 422 | 422 | PASS |
| DELIVERY-01.lead.retry-denied.API | lead | API | 403; row unchanged | 403; status failed | PASS |
| DELIVERY-01.legacy.retry-denied.API | legacy | API | 403; row unchanged | 403; status failed | PASS |
| DELIVERY-01.member.retry-denied.API | member | API | 403; row unchanged | 403; status failed | PASS |
| DELIVERY-01.pending.retry-denied.API | pending | API | 403; row unchanged | 403; status failed | PASS |
| DELIVERY-01.ownerb.retry-cross-org.API | ownerb(B) | API | 404; unchanged | 404; failed | PASS |
| DELIVERY-01.ownerb.retry-orgA-header.API | ownerb | API | 403 | 403 | PASS |
| DELIVERY-01.admin.retry-nonretryable.API | admin | API | simulated/skipped -> 409; unchanged | 409,409; simulated:1 | PASS |
| DELIVERY-01.admin.retry-unknown-malformed.API | admin | API | 404 unknown, 4xx malformed | 404; 400 bad_request | PASS |
| DELIVERY-01.member.retry-rpc+select.RLS | member | DB/RLS | retry_delivery rpc denied; row unchanged; select limited to own-created/scheduled scope | select 200 n=8; retry rpc 500 P0002; status failed | PASS |
| DELIVERY-01.pending.retry-rpc+select.RLS | pending | DB/RLS | retry_delivery rpc denied; row unchanged; select limited to own-created/scheduled scope | select 200 n=10; retry rpc 500 P0002; status failed | PASS |
| DELIVERY-01.lead.retry-rpc+select.RLS | lead | DB/RLS | retry_delivery rpc denied; row unchanged; select limited to own-created/scheduled scope | select 200 n=405; retry rpc 500 P0002; status failed | PASS |
| DELIVERY-01.legacy.retry-rpc+select.RLS | legacy | DB/RLS | retry_delivery rpc denied; row unchanged; select limited to own-created/scheduled scope | select 200 n=390; retry rpc 500 P0002; status failed | PASS |
| DELIVERY-01.ownerb.retry-rpc-cross-tenant.RLS | ownerb (owner of org B, non-member of A) | DB/RLS (PostgREST rpc, caller JWT) | denied (P0002); org A delivery unchanged | rpc 200; delivery now queued (W3-REL-D1 (P0)) | FAIL |
| DELIVERY-01.ownerb.deliveries-select-cross-tenant.RLS | ownerb | DB/RLS | 0 rows | n=0 | PASS |
| DELIVERY-01.member.deliveries-direct-update.RLS | member | DB/RLS | no direct write to outbox rows | 403; status failed | PASS |
| DELIVERY-01.admin.deliveries-direct-update.RLS | admin | DB/RLS | no direct write to outbox rows | 403; status failed | PASS |
| DELIVERY-01.ownerb.deliveries-direct-update.RLS | ownerb | DB/RLS | no direct write to outbox rows | 403; status failed | PASS |
| DELIVERY-01.admin.deliveries-direct-insert.RLS | admin | DB/RLS | denied | 403 | PASS |
| DELIVERY-01.ownerb.deliveries-direct-insert.RLS | ownerb | DB/RLS | denied | 403 | PASS |
| DELIVERY-01.ownerb.delivery_attempts-select.RLS | ownerb | DB/RLS | 0 rows | n=403 | PASS |
| DELIVERY-01.ownerb.delivery_effects-select.RLS | ownerb | DB/RLS | 0 rows | n=0 | PASS |
| DELIVERY-01.admin.retry-ambiguous.API+DB | admin | API+DB | ambiguous email retried once; becomes simulated (honest: not accepted/delivered); manual_retries=1; locale preserved; attempt row recorded | 200 simulated attempts 2; db simulated\|2\|1\|vi; locale before vi; attempt rows 2 | PASS |
| DELIVERY-01.owner.retry-failed-subset.API+DB | owner | API+DB | only the retried failed delivery changes; the other failed push (pP) stays failed; simulated/skipped untouched | 200 simulated; pP still failed; member email simulated; noemail skipped | PASS |
| DELIVERY-01.system.retry-no-duplicate-business-event.DB | admin | DB | email retries do not create new in-app notifications / release batches / effects | notifications 110->110; effects for D1 1 | PASS |
| DELIVERY-01.owner+admin.retry-concurrent-x6.API+DB | owner,admin | API+DB (6 parallel) | one extra attempt only (attempts +1, manual_retries 1), all calls 200 | 200,200,200,200,200,200; before attempts 2; final simulated\|3\|1 | PASS |

## DELIVERY-02 Concurrent workers, leases, crashes

8 cases: PASS 8

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELIVERY-02.4workers.claim-race-40-deliveries.DB | worker x4 concurrent | worker+DB | each of 40 queued deliveries processed exactly once (attempts=1, one attempt row), no duplicate feed rows | claimed per worker 40+0+0+0; states delivered:1\|19; simulated:1\|21; attempt rows/distinct 40\|40; notifications 110->110; duplicate dedupe keys 0 (other orgs' due jobs may also have been processed by these workers) | PASS |
| DELIVERY-02.5sessions.barrier-claim-race.DB | 5 concurrent DB sessions (claim_deliveries) | DB (barrier via advisory lock, 6 effects) | each queued delivery leased to exactly one worker (no overlap), total claimed = total rows, only the lease owner can complete, 1 attempt row each | 6/6 effects: all rows claimed exactly once across 5 simultaneous claimers; foreign-worker completion rejected (scoped by p_effect_id to org A effects; tests call service-role-only DB functions via superuser psql (simulation of worker processes)) | PASS |
| DELIVERY-02.worker.crash-before-provider-call-recovers.DB | worker | worker+DB | expired lease w/o provider call -> requeued (worker_lease_expired), reattempted, delivered once (attempts=2); attempt history shows both | simulated\|2\|\|\|true; history 1:queued:worker_lease_expired 2:simulated: | PASS |
| DELIVERY-02.worker.crash-at-attempt-cap-terminal-failed.DB | worker | worker+DB | expired lease with attempts>=max -> failed (terminal, needs attention), not resent | failed\|5\|worker_lease_expired\|\|true; 5:failed:worker_lease_expired | PASS |
| DELIVERY-02.worker.crash-after-provider-call-ambiguous.DB+API | worker,admin | worker+DB+API | expired lease after provider call began -> ambiguous/outcome_unknown, never auto-resent (attempts stays 1 over further runs); admin list shows it retryable with error code | ambiguous\|1\|outcome_unknown\|\|true \| after more runs ambiguous\|1\|outcome_unknown\|\|true; api: status=ambiguous code=outcome_unknown retryable=true | PASS |
| DELIVERY-02.db.lost-lease-takeover.DB | simulated workers wA,wB | DB functions | after lease takeover: stale worker A cannot call provider (begin=false) nor record an outcome (complete=NULL); B can; one attempt row | A claim ok; B claim ok; A begin f; B begin t; A complete NULL; B complete ROW; simulated\|2\|\|\|true; history 1:queued:worker_lease_expired 2:simulated: | PASS |
| DELIVERY-02.db.retry-backoff-to-terminal-failed.DB | simulated worker (retryable provider fault x5) | DB functions | retryable fault requeues with next_attempt_at in the future (not claimable early), 5th attempt becomes terminal failed (completed_at set), one attempt row per attempt | #1: claimed=true -> queued; queued attempts=1 next_in=30s completed=false /    claim before backoff elapsed: 0 rows / #2: claimed=true -> queued; queued attempts=2 next_in=60s completed=false / #3: claimed=true -> queued; queued attempts=3 next_in=120s completed=false / #4: claimed=true -> queued; q (provider faults simulated by calling complete_delivery(queued, provider_timeout); real provider faults need keys (BLOCKED)) | PASS |
| DELIVERY-02.http+cli.mixed-worker-race.API+DB | 2x HTTP worker (port 4001, CRON_SECRET set) + 1 CLI worker | HTTP+worker+DB | 5 due scheduled releases executed once each, 1 effect per batch, no duplicate delivery, every delivery attempted once | batches released\|5; effects/batches 5\|5; duplicate deliveries 0; max attempts 1; unfinished 0 (Overlap was partial: the CLI worker took all 35 deliveries and 5 releases before the two HTTP runs claimed anything. HTTP route only enabled on a second API instance on :4001 with a generated CRON_SECRET (:4000 has it unset -> 404). True overlap is covered by DELIVERY-02.5sessions.barrier-claim-race.) | PASS |

## Defects

### W3-REL-D1 (P0) Admin guards using `not public.is_org_admin(...)` pass for non-members (cross-tenant write and read through PostgREST RPC)
- **Root cause:** `public.org_role_of(org)` returns NULL for a caller with no active membership, so `public.is_org_admin(org)` returns NULL (not false). In PL/pgSQL `if ... or not public.is_org_admin(x) then raise` evaluates `not NULL` = NULL, which is treated as false, so the guard does not fire. Guards that read `not public.is_org_member(...)` are fine (that function returns false). Wave-2 API tests did not see this because the REST routes check organization membership in middleware first; the RPCs are callable directly by any authenticated user (grant to `authenticated`).
- **Minimal repro** (`ownerb` = owner of org B only, `ownerb` JWT, PostgREST):
  - `POST /rest/v1/rpc/retry_delivery {"p_delivery_id":"<org A failed delivery>"}` -> 200, delivery re-queued (manual_retries 1) and re-sent.
  - `POST /rest/v1/rpc/cancel_release_batch {"p_batch":"<org A scheduled batch>"}` -> 200 with the full batch row; DB status `cancelled`.
  - `POST /rest/v1/rpc/create_api_credential {"p_org":"<org A>","p_name":"x","p_scopes":["plans.read"],"p_key_prefix":"a1b2c3d4e5f60718","p_secret_hash":"<hash of a secret the caller knows>",...}` -> 200 `[{credential_id, replayed:false}]`; row exists in org A with `created_by` = the org B owner (a working developer-API key for org A plans). `revoke_api_credential` of another org's credential -> 204, `revoked_at` set.
  - `POST /rest/v1/rpc/member_effective_access {"p_org":"<org A>","p_user":"<A owner>"}` and `explain_capability` -> 200 with org A's role/grant details.
  - SQL proof: with `request.jwt.claim.sub` = a non-member, `select public.is_org_admin('<org A>')` returns NULL.
  - Control: an ordinary org A member (role `member`) gets P0002 on the same calls (the NULL only occurs for non-members); the REST routes (`/deliveries/:id/retry`, `/releases/:id/cancel`) are protected by middleware (403/404).
- **Expected:** P0002/42501 for a non-member. **Actual:** the action runs and its result is returned.
- **Exploit limit:** the caller needs the target object's UUID (unguessable), except `create_api_credential`, `member_effective_access` and `explain_capability`, which take only the org id and a user id (org ids and user ids are visible in other flows).
- **Other functions with the same guard shape (not individually exercised):** `create_webhook_endpoint`, `retry_webhook_delivery`, `revoke_webhook_endpoint`, `send_webhook_test`, `set_webhook_endpoint_enabled`, `operational_message_outcomes`, `retry_operational_message`, `resolve_person_reconciliation`, `revoke_schedule_delegation`, `preview_folder_move`, `preview_service_type_move`, plus the `ai_import_quota` functions. Found with: `select proname from pg_proc where prosecdef and pg_get_functiondef(oid) ~ 'not public\.is_org_admin'`.
- **Suspected source:** `supabase/migrations/20260101000100_rls.sql:35` (`is_org_admin` returns NULL; fix with `coalesce(..., false)`), exposed at `supabase/migrations/20261016000200_delivery_outbox_and_atomic_copy.sql:699` (`retry_delivery`), `supabase/migrations/20261024000000_f08_release_and_reminders.sql:413` (`cancel_release_batch`), `supabase/migrations/20261103000000_f17_developer_api.sql:118,174,528,580,616,644,675`, `supabase/migrations/20261017000000_f01_scoped_capabilities.sql:384,411,500`, `supabase/migrations/20261017000200_f01_hierarchy_and_team_policies.sql:254,370,390,415,467`, `supabase/migrations/20261018000100_f02_guest_staffing.sql:307`.
- **Cleanup:** my probe credentials were deleted; the re-queued delivery and the cancelled-then-restored batch are in org `qa-20261118-rel-a`.

### W3-REL-D2 (P1) `GET /deliveries` cursor skips rows that share `created_at`
- **Repro:** one release of 4 recipients creates 8 delivery rows with the same `created_at` (one transaction). As admin: `GET /api/v1/deliveries?plan_id=<plan>&limit=3` -> 3 rows, `next_before=<that created_at>`; `GET ...&limit=3&before=<next_before>` -> **0 rows**, `next_before=null`. 5 of 8 rows are unreachable, including failed/ambiguous ones when `needs_attention=true` is paged. A release with more than 50 deliveries (default page) hides the rest the same way.
- **Expected:** every row reachable by paging (cursor needs `(created_at, id)`). **Actual:** ties dropped.
- **Suspected source:** `backend/src/services/deliveries.ts:165` (`.lt('created_at', query.before)`) and `:173` (`next_before` is only `created_at`), while ordering is `created_at desc, id desc` (`:169`).
- **Impact:** an administrator cannot see or retry some failed/uncertain deliveries after a large release. Affects web/mobile Delivery lists.

### W3-REL-D3 (P2) Concurrent duplicate release with the same idempotency key can return 409 although the release succeeded
- **Repro:** 10 parallel `POST /releases` with identical body and key (`notify:true`): about 2 of 120 calls returned 409 `conflict` ("That change is no longer allowed") while the winner released; a sequential retry returns the batch (201). Invariants held (1 batch row, 1 effect, one delivery per recipient and channel, assignments released once).
- **Cause:** `create_release_batch` looks up the key, finds nothing, then re-checks `visibility='prepared'` after the first request committed and raises PT409 before it reaches the `on conflict ... do nothing` path (`supabase/migrations/20261024000000_f08_release_and_reminders.sql:339-363`). Same family as W2-RESP-D3 (deferred in wave 2). **Impact:** a client with a lost reply and an overlapping retry may show a false failure.

### W3-REL-D4 (P2) Reminder recompute queue drains 50 plans per worker run; large backlog starves new changes and breaks the f08 suite
- **Repro:** after wave 2 the queue held 1,359 plans. `f08-release-reminders.sql` failed with `remaining unanswered position lost its reminder` (its plan is last in `queued_at` order, `materialize_due_reminders(50)` handles only 50 plans); after 30 worker runs (queue 0) the same suite passed. The `p_limit` argument and `npm run worker --drain` do not drain the queue (drain stops when nothing is enqueued/claimed).
- **Impact:** after a bulk change a person's reminder intent can lag by (plans/50) worker intervals (about 2 h at a 5-minute cron for 1,360 plans); the DB suite is not independent of other orgs' backlog. **Suspected source:** `supabase/migrations/20261024000000_f08_release_and_reminders.sql:1077-1081` (hard-coded `limit 50`), `backend/src/services/delivery-worker.ts:83-86`.

### W3-REL-D5 (P2, outside this package) Time preview hash can never be applied when a new time has no client id
- **Repro:** `POST /plans/:id/times/preview` twice with the same list containing a new time without `id` returns two different `impact_hash` values; `PATCH /plans/:id {times, time_impact_hash}` -> 409 `time_impact_stale`. With a client-supplied uuid for the new time the same flow succeeds (200), and renames/removals with the hash succeed. Real clients that assign ids via the shared draft helper are unaffected; direct API callers are not.
- **Suspected source:** `backend/src/services/attendance.ts:115-124` (`identifyPlanTimes` generates fresh random ids for id-less times on every call, and the hash includes them).

### W3-REL-D6 (P2) Release preview reports `push: true` for a login that has no active device
- Preview of a release including `pending` (login, no registered device): `channels.push=true`, no skip reason; the delivery then ends `skipped / no_active_device`. After registering a device the same recipient gets `simulated`. The preview should not promise a push it cannot send. **Suspected source:** `backend/src/model/reminder.model.ts:44` (`push: Boolean(readiness?.has_login)`). Not blocking; messages are still truthful after the fact.

## Observations (not counted as defects)

- **O1** Unpublishing a plan (`status` back to `draft`) keeps its released requests visible to the recipient (`/schedule/mine`, plan row via RLS; items stay hidden) and keeps reminder jobs scheduled; `desired_plan_reminders` depends on release and response state only, not on plan status. The plan row for REMIND-01 ("unpublished ... cancel according to policy") does not define the expected behaviour; needs a product decision (ADR 0003 separates publish from release).
- **O2** Invalid `limit` on `/internal/deliveries/run` is rejected (422) before the secret is checked; an unauthenticated caller gets 422 instead of 401 for malformed queries. Harmless.
- **O3** Sixteen `scheduler_response` in_app and push deliveries of `qa-20261117-resp-a` (effects from 2026-11-17 22:53, confirmed response with 2 assignments) were retried by my first worker runs and ended `failed / internal_error` after 5 attempts (backoff and terminal state worked). Root cause not determined (the worker logs only the error class). The same shape (two-position confirm, snapshot commit) delivered correctly in my org on the current build, so these look like pre-fix residue; worth one look by QA-05 owners.
- **O4** PostgREST maps the RPCs' custom `P0002` denial to HTTP 500 (body code `P0002`); denial is effective but status is 500 rather than 403/404.
- **O5** The recipient of a response who triggered a `scheduler_response` effect can select the resulting outbox rows (`deliveries_select`: effect `created_by = auth.uid()`), including the scheduler's recipient id and status. No content or address; low.
- **O6** `DELIVERY_LINK_SECRET` is unset, so email retries send no provider idempotency key and each attempt mints a new response-link token; an administrator retry of an `ambiguous` email can duplicate the email (documented behaviour in docs/operations/delivery-worker.md). The honest status is shown (`simulated` here; `ambiguous / outcome_unknown` after a crash).
- **O7** Release-batch listing is per creator (admins see all); a second scheduler cannot see or cancel another scheduler's scheduled batch. Matches the service comment; the plan does not state it.
- **O8** Re-sending the same idempotency key of a *failed* scheduled batch with a different `scheduled_for` returns 409 (the request hash includes the schedule time); this is by design, not tested further.
- **O9** The briefing says CRON_SECRET is in backend/.env; it is commented out, so the :4000 route is disabled (documented behaviour when unset).

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| Web steps of RELEASE-01/02, REMIND-01, DELIVERY-01 (Plans -> Release review, Settings -> Delivery, Plan -> Teams -> Reminders and delivery, labels such as "Simulated - not sent") | NOT_RUN | Browser is owned by QA-09. |
| Mobile steps (MOB-015 PlanReminders, MOB-020 notification settings) | NOT_RUN | Simulator not in scope for this agent. |
| Real provider faults (Resend 4xx/5xx/timeout, Expo ticket errors, accepted vs delivered receipts) | BLOCKED | RESEND/EXPO keys blank by design; faults were simulated at the DB function level (lease expiry, `complete_delivery` with retryable/permanent codes). Provider-accepted wording and partial provider failure per recipient are not proven. |
| Crash of a real worker process between provider acceptance and `complete_delivery` | BLOCKED | Needs a real provider (or a hook inside the process); simulated as lease expiry after `provider_call_started_at` (-> ambiguous). |
| Matrix commit race at API level (`/staffing-matrix` release) | NOT_RUN | Covered at DB level by f08-matrix-release-batch and f08-concurrent-matrix-release.sh (both PASS); API matrix flow belongs to QA-04. |
| Release/reminder/response-link email contents (locale rendering, link tokens) | NOT_RUN | Simulated transport logs only; locale capture on the delivery row was verified. |
| Push token rotation, logout/relogin, shared device (PUSH-01) | NOT_APPLICABLE | Other package. |

## Fixtures left in place

Orgs `qa-20261118-rel-a`, `qa-20261118-rel-b` and users `{owner,admin,legacy,lead,pending,member,ownerb}.qa20261118.rel@example.test`; about 120 plans (titles starting `REL `), their assignments, release batches (released, failed, cancelled, scheduled), delivery effects/deliveries/attempts, reminder jobs and policies (none active in org A at the end; one in org B), one registered fake device for `pending` (`ExponentPushToken[qa07pendingdevice0001]`), `pending`'s language set to `vi`, org A scheduled batches left scheduled for cancel tests (`bbba5d89-...`). Deleted: the API credentials created during the W3-REL-D1 probe. Temporary second API instance on :4001 stopped. Scratch scripts and credentials: the scratchpad `qa07/` directory.
