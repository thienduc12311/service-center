# W10-MAIL — email notifications, publish-notifies, mention emails, invitations, webhooks (wave 10, area `delivery`)

Date 2026-11-22. Package W10-MAIL (owned: ADR-0006 publishing, ADR-0007 mention emails, invitation email, no-plan delivery labels, PEOPLE-02, stale FAIL reruns NOTIFY-01 and HOOK-01, I18N-02 delivery half). Plan: `docs/plans/admin-mobile-test-plan.md` §2, §3, §4 (D05, D13), §5E, §12.

## Header

| Item | Value |
|---|---|
| Commit | `f79aa50` (`main` after PR #129) on `feature/qa-wave10`. No source, migration, config, `.env` or git change; this file is the only repo edit. |
| Database | Local Supabase, 123/123 migrations (latest `20261130000500_accepted_email_is_primary`), no reset. |
| Processes | Shared API :4200 (simulated email/push, **no `CRON_SECRET`**, so mention delay 0 and webhooks cannot be registered) used only for the no-worker mention case. Everything else ran on my private **API :4620** (env on the command line only: `CRON_SECRET`, `DELIVERY_LINK_SECRET`, `RESEND_API_KEY=re_fake…`, `RESEND_BASE_URL=http://127.0.0.1:4621`, `INTEGRATION_SECRET_KEY`, `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=true`, `IOS_APP_STORE_URL`), a **fake Resend :4621** and **webhook receiver :4622** (one scratchpad Node process, logs every request), and short-lived API instances :4623 (allow-private OFF) and :4624 (empty/invalid optional secrets). All stopped by listener PID at the end; :4200 stayed healthy. :4000/:4100/:5173 ignored (the :5173 server is another worktree's and 404s `/icon-192.png`). |
| Why a fake Resend | **Simulated sends record nothing.** `consoleTransport` (`backend/src/services/notifications.ts:178` and `:222`) and `consolePersonInvitationTransport` only `console.info` a one-line marker without recipient, subject, body or link, and delivery rows end `simulated`. Email content therefore cannot be inspected on the simulated path; every content assertion below comes from the fake Resend capture (`from`, `to`, `subject`, `html`, `text`, `reply_to`, attachments, `Idempotency-Key`) or from rendering the template directly. The shared :4200 path was checked only for delivery state. |
| Namespace | Orgs `qa-w10-mail-a` (Alpha, America/Chicago) and `qa-w10-mail-b` (Beta, Asia/Ho_Chi_Minh, renamed to `Grace, "Hope" <x@evil.test> Bcc: z@evil.test Nguyễn Church` for From-quoting). Users `<alias>.qaw10.mail@example.test` (all `@example.test`). Orgs were created with `private.create_church` (self-serve creation is off); members, grants, confirmations by service role/Auth admin only. Every feature action used the actor's own token. |
| Fixture shape | Alpha: `owner`, `admin`, `sched` (legacy scheduler), `pubr` (member, org grant `plans.edit` only), `smgr` (member, `scheduling.manage` only), `m1` (en in Alpha, **vi in Beta**), `m2` (`Nguyễn Thị Ánh`, vi), `m3` (Tech team only), `m4`; no-login Persons `guest` (`Guest Có Dấu`, vi, email) and `noemail`; later `ex1` (existing login outside the org), `unc` (unconfirmed login). Service type Sunday Service, teams Band (Keys/Drums) and Tech. Beta: `bowner`, `m1`, two vi guests (one name with HTML), team Ban nhạc. ~35 plans (draft, quiet, past, today, archived, concurrent, locale, webhook). |
| Credentials | Scratchpad `/private/tmp/claude-501/-Users-nguyen-orca-workspaces-service-center-glassfish/b2798cb9-818c-4968-93be-9fd375629001/scratchpad/w10-mail/` (`creds.json`, `hook-secrets.json`, `env-priv.sh`, `fake-log.jsonl`, `hook-log.jsonl`, `rows-*.json`, `final-rows.json`, captured mails `mention-*.json`, `invite-*.json`, `mails-*.json`). None in this report. |
| Expanded cases | 287 rows: **PASS 264, FAIL 8, NOT_RUN 14, NOT_APPLICABLE 1, BLOCKED 0** (8 FAIL rows = 5 defects). |

### Delivery worker runs (the worker processes every organization)

| # | Time (UTC) | How | Summary | Notes |
|---|---|---|---|---|
| 1 | 14:49:49 | official `RESEND_API_KEY= EXPO_ACCESS_TOKEN= npx tsx src/worker.ts` | releases 0, reminders 0, claimed 2, completed 2 | both mine: P7 queued emails cancelled `plan_not_published` |
| 2 | 14:54:21 | official | claimed 50, completed 50 | 3 mine (P10 m2 request, the race row of W10-MAIL-D2), **47 of `qa-w10-fgh-a`** (another agent's 1,200 queued rows, now `simulated`); files: removed objects 1 |
| 3 and 4 | 15:06:27 | two official runs started together (concurrency check) | each claimed 50, completed 50 | all `qa-w10-fgh-a` (older rows are claimed first; none of mine were due-first). Their webhook step used `.env` without `INTEGRATION_SECRET_KEY` and failed 12 of my due webhook deliveries `secret_unavailable` (W10-MAIL-D5) |
| scoped | ~40 runs | `runDeliveryWorker({effectId})` through `scratchpad/harness.mts` (the same code path as the API's in-request kick), fake Resend + `DELIVERY_LINK_SECRET`, one effect at a time; 3-process overlap on one effect (claims 0/0/6) | used for every content capture and retry test so other organizations' rows were not claimed |
| webhook | ~15 | `runWebhookDeliveries` through `scratchpad/webhooks.mts` with the private key; 3-process overlap (claims 3/0/0) | |

Total effect on others: about 147 `qa-w10-fgh-a` deliveries were turned `simulated` by runs 2 to 4 (they are inert simulated rows).

Fixture clock: queued rows were made due with `update deliveries set next_attempt_at = now() - interval '1 minute'` (documented per case); nothing else was time-travelled except the invitation expiry rows.

## Result summary

| Area | PASS | FAIL | NOT_RUN | N/A |
|---|---|---|---|---|
| A ADR-0006 publish | see table | 5 rows (D1, D2) | 4 (UI) | |
| B ADR-0007 mentions | see table | 0 | 1 (UI) | |
| C Invitation email / security | see table | 0 | | |
| D PEOPLE-02 | see table | 2 rows (D3, D4) | 2 (UI) | |
| E NOTIFY-01 reruns | 4/4 W7 FAIL rows now PASS | 0 | 1 | |
| F HOOK-01 reruns | 10/10 W8 FAIL rows now PASS | 1 row (D5) | 2 | 1 |
| G I18N-02 delivery | see table | 0 | 1 (human review) | |
| H delivery settings/config | see table | 0 | 4 | |

No P0. No cross-tenant read or write, no private reason in any email, no secret or token in any log, no email sent to someone who could not see the source, no duplicate email from concurrent workers or concurrent publishes.

## Defects

| ID | Priority | Summary |
|---|---|---|
| W10-MAIL-D4 | P1 | Explicit identity **merge** commits but the API answers `400 Invalid identifier or value` |
| W10-MAIL-D1 | P2 | Delivery outcomes show a **blank recipient name** to every non-owner (publish/notify "no address" list, Settings → Delivery) |
| W10-MAIL-D2 | P2 | Assigning while a publish commits leaves the new person's request **queued without an in-request send**; with no worker it never goes out |
| W10-MAIL-D3 | P2 | Self-service email change of a linked login is refused with a raw **500 `unexpected_failure`** |
| W10-MAIL-D5 | P2 | A worker without `INTEGRATION_SECRET_KEY` **permanently fails** due webhook deliveries and disables their endpoints |

### W10-MAIL-D4 (P1) merge returns 400 after committing
* Repro (verified twice): owner creates Person Y (no login) with the same email as an existing login `ex1` and a tag; owner invites Y; `ex1` accepts from its own session → `409 identity_conflict` and a `person_identity_reconciliations` row (`invitation_conflict`, open). `admin` then `POST /api/v1/people/reconciliations/<id>/resolve {"action":"merge"}`.
* Expected: 200 with the resolved report. Actual: `400 {"error":"Invalid identifier or value","code":"bad_request"}`, **but the merge committed**: Y is deleted, its tags/assignments moved to the kept Person, and the report row went with it (cascade). A retry now 404s; the admin is told it failed.
* Suspected: `backend/src/routes/roster.ts:187-190` passes the RPC's row to `nameReconciliations` (`backend/src/services/roster.ts:220-230`), but `resolve_person_reconciliation` has by then deleted the candidate and the report (`supabase/migrations/20261018000100_f02_guest_staffing.sql` `resolve_person_reconciliation` ends with `delete from public.people where id = v_drop.id`), so the returned row is empty/null and `.in('id', [null, null])` fails with 22P02 → 400. Return the stored row before deleting, or skip naming for `merge`.
* Impact: a destructive, irreversible action reports failure; keep-separate works (200).

### W10-MAIL-D1 (P2) blank recipient names for non-owners
* Repro: as `admin`, `sched` or `pubr` publish a plan that includes a Person with no email (`noemail`): `publish_notification.skipped` is `[""]`; the owner gets `["Noemail Guest"]`. `GET /deliveries?plan_id=<plan>&channel=email` as admin returns `recipient_name: ""` for deliveries to Persons that had no login when queued (owner sees `Guest Có Dấu`).
* Expected: the name (the preview, `publish-preview`, does return it). Actual: empty string.
* Suspected: `backend/src/services/deliveries.ts:36-39` (`toDeliveryOutcome`): the `recipient_person` embed reads `people`, which only the owner may read (owner-only People rule), so the join is null and `[].join(' ')` yields `""`, which `?? null` and the `?? 'Unknown person'` at `:88` never replace. The rest of the roster is served through `people_directory`; use that (or a name column on the delivery) for these joins.
* Impact: the "People without an address" and "needs attention" lists the publish confirmation and Settings → Delivery are built to show are unlabeled for every administrator except the owner.

### W10-MAIL-D2 (P2) assign racing a publish is queued, not sent
* Repro: `PATCH /plans/<draft> {status:"published"}` and `POST /plans/<same>/assignments {notify:true}` (new person) fired together (reproduced once in 1 attempt). The route reads the plan as draft (`backend/src/routes/assignments.ts:175`: `isHeldUntilPublish(plan.status)` is decided from the plan read before the RPC), the RPC runs after the publish committed and records a request effect, but `deliverEffectNow` is skipped. m2's in-app/push/email rows stayed `queued`/due until worker run 2, which sent them once (no loss, no duplicate).
* Expected: sent in the same request, as for any assignment on a published plan. Actual: waits for a worker. Production has no scheduled worker today (ADR-0004 / delivery-worker.md), so the person is not asked until some later action on the same effect.
* Fix: decide "held" from the RPC result (`created` rows with an effect) rather than from the pre-read status.

### W10-MAIL-D3 (P2) self-service email change gives 500
* Repro: as the linked login `guest`, `PUT {SUPABASE}/auth/v1/user {"email":"…"}` → `500 unexpected_failure`. The change IS refused (no `email_change` pending, roster email unchanged), so SEC-013 holds; only the error is unclean (migration `20261130000500_accepted_email_is_primary.sql` raises inside the Auth trigger). No screen offers this path.

### W10-MAIL-D5 (P2) worker without the signing key kills webhook deliveries
* Repro: with webhook endpoints registered via an API that has `INTEGRATION_SECRET_KEY`, run `npx tsx src/worker.ts` from an environment without it (the repo's `backend/.env` has it commented out). Each due delivery is completed `failed`/`secret_unavailable` on attempt 1 (12 of mine), and the endpoint is disabled (`disabled_reason failing`, `consecutive_failures 6`).
* Expected: a worker missing its key is a misconfiguration: deliveries stay queued (or the webhook step is skipped, as it is for email without Resend) so a corrected restart delivers them. Actual: events are lost and the integration must be re-enabled by hand. `backend/src/services/webhook-dispatch.ts` `attempt()` → `complete_webhook_delivery` with the `secret_unavailable` code (documented for a *rotated* key, not for an unset one).

## Observations (not defects)

* **Source vs plan, invitations:** invitations still use `PersonInvitationTransport` directly (no outbox row, no retry, not in Settings → Delivery): the `feature/invitation-outbox` follow-up is not built. From for invitations is `"Service Center" <MAIL_FROM_ADDRESS>` (platform name), while schedule, mention and message emails use the organization name (`resend-transport.ts`). Matches the code and plan; flagged for product review.
* **Source vs doc:** `config.ts` comment says an *empty* optional secret warns at startup; `optionalSecret` treats empty as unset silently (invalid values warn). Plan text agrees with the code.
* `POST /plans/:id/notify` on a published plan re-sends to every unconfirmed released person, including people asked moments earlier (explicit reminder action, not the publish path).
* A location/time change on a plan with no confirmed people records an empty `assignment_request` effect (0 assignments, 0 deliveries): clutter only.
* Mention email "and N more mentions" counts unread mentions since the last sent mention email, including ones that were skipped as opted-out: a person who opts back in sees a larger count than mentions sent while opted-in.
* Vietnamese copy: "Xin chào {first_name}" in operational messages uses the first name field (`Nguyễn`), the family name in Vietnamese order, while the invitation greets by full name; the invitation line "Service Center là nơi ban của bạn…" should get a Vietnamese reviewer's eye (I18N-02 requires separate human review, NOT_RUN).
* Direct PostgREST `rpc/publish_plan_notify` for a plan the caller cannot see returns HTTP 500 with `P0002 Plan not found` (not 404). The API route answers 403/404 correctly.
* The shared API :4200 has no `CRON_SECRET` and no `INTEGRATION_SECRET_KEY`: mention emails are immediate there and webhooks cannot be registered, so those cases need a private instance as used here.

## Stale FAIL reruns (original row / defect → new status)

| Original row | Original defect | Re-run | New status |
|---|---|---|---|
| NOTIFY-01.pagination.next_cursor-echoed.API (w7) | W7-MSG-D1 | server `next_cursor` passed verbatim as `before`; 7 pages of a 66-row feed | PASS |
| NOTIFY-01.pagination.identical-created_at-ties.API (w7) | W7-MSG-D3 | 66 rows, 16 distinct `created_at` (6-way ties), limit 10 | PASS (66/66, no repeat, no skip) |
| NOTIFY-01.rls.update.own-content-columns.m2 (w7) | W7-MSG-D5 | PostgREST PATCH of title, body, type, created_at, user_id, organization_id, created_by, dedupe_key, plan_id as the owner of the row | PASS (all 403; `read_at` 200) |
| NOTIFY-01.target-deleted.notification-snippet.API (w7) | W7-MSG-D4 | mention, author deletes the message | PASS (gone from API feed and PostgREST) |
| HOOK-01.event.created-as-published (w8) | W8-INT-D2 / W3-INT-D7 | `POST /plans` with `status:"published"` | PASS (`plan.published` emitted) |
| HOOK-01.retry.attempt1 and attempt2 for `/500`, `/400`, `/reset`, `/hang` (w8, 8 rows) | W8-INT-D1 | measured `next_attempt_at − (attempt end)`: 4.7–5.5 s then 272–304 s; attempts 3–7: 1.7k–2.0k s, 6.5k–7.8k s, 16.5k–18.8k s, 35k–37k s, 45k–51k s; terminal `failed` after exactly 8 attempts; same `webhook-id`, new timestamp per attempt; `Retry-After: 7` → 6.3–7.6 s | PASS |
| HOOK-01.destination.register.refused.not a url (w8) | W8-INT-D3 | `url:"not a url"` | PASS (422, no 500, no row) |

(`W8-INT-D4`/`D5` and the REALTIME/SEC-02 rows of the same wave 8 file are not HOOK-01 rows and were not re-run.)

## Result tables

### A. ADR-0006 publishing notifies (PUB.*)

PASS 59 / FAIL 4 / NOT_RUN 4 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PUB.draft.assign-no-in-app | owner | DB | no notification rows for draft assignments | assignment notifs last 30m=0 | PASS |
| PUB.denied.api.m3 | m3 | API | 403/404, plan stays draft, no effect | 403 status=draft eff=0 | PASS |
| PUB.denied.api.smgr | smgr | API | 403/404, plan stays draft, no effect | 403 status=draft eff=0 | PASS |
| PUB.denied.api.m1 | m1 | API | 403/404, plan stays draft, no effect | 403 status=draft eff=0 | PASS |
| PUB.denied.api.other-org-owner-B-header | bowner | API | 404 (plan of org A via org B header) | 404 status=draft | PASS |
| PUB.denied.api.other-org-owner-A-header | bowner | API | 403 non-member | 403 status=draft | PASS |
| PUB.denied.api.anonymous | anon | API | 401 | 401 | PASS |
| PUB.denied.rpc.m3 | m3 | DB/RLS RPC | error/empty, plan stays draft, no effect | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} status=draft eff=0 | PASS |
| PUB.denied.preview-rpc.m3 | m3 | DB/RLS RPC | denied/empty, no name leak | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| PUB.denied.rpc.smgr | smgr | DB/RLS RPC | error/empty, plan stays draft, no effect | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} status=draft eff=0 | PASS |
| PUB.denied.preview-rpc.smgr | smgr | DB/RLS RPC | denied/empty, no name leak | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| PUB.denied.rpc.m1 | m1 | DB/RLS RPC | error/empty, plan stays draft, no effect | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} status=draft eff=0 | PASS |
| PUB.denied.preview-rpc.m1 | m1 | DB/RLS RPC | denied/empty, no name leak | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| PUB.denied.rpc.bowner | bowner | DB/RLS RPC | error/empty, plan stays draft, no effect | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} status=draft eff=0 | PASS |
| PUB.denied.preview-rpc.bowner | bowner | DB/RLS RPC | denied/empty, no name leak | 500 {"code":"P0002","details":null,"hint":null,"message":"Plan not found"} | PASS |
| PUB.denied.preview-api.m3 | m3 | API | 403 | 403 | PASS |
| PUB.denied.preview-api.smgr | smgr | API | 403 | 403 | PASS |
| PUB.denied.preview-api.m1 | m1 | API | 403 | 403 | PASS |
| PUB.denied.no-side-effects | all denied | DB | 0 effects/deliveries/notifs, 0 mails | eff=0 del=0 notif=0 mails=0 | PASS |
| PUB.republish.same-key.API | pubr | API+DB | no new effect/delivery/mail | 200 {"eff":1,"del":8,"n":2,"mails":3}->{"eff":1,"del":8,"n":2,"mails":3} pn={"notified":3,"skipped":[""],"effect_id":"6bdc1e30-41a6-42a0-871f-c0b0916559b1","email_mode":"resend","outcomes":[{"id":"6bbc92b3-4613-462f-9f81-76ec065bafe9","recipient_id":"70def042- | PASS |
| PUB.republish.new-key-already-published.API | pubr | API+DB | no new rows (published already) | 200 {"eff":1,"del":8,"n":2,"mails":3}->{"eff":1,"del":8,"n":2,"mails":3} | PASS |
| PUB.unpublish.sends-nothing.API | owner | API+DB | draft; nothing sent | 200 {"eff":1,"del":8,"n":2,"mails":3}->{"eff":1,"del":8,"n":2,"mails":3} | PASS |
| PUB.republish.after-unpublish-never-re-asks-reached.API | owner | API+DB | m1,m2,guest not re-asked (0 new emails). Noemail (never reached) may be asked | 200 new mails=0 eff 1->2 del 8->9 | PASS |
| PUB.edit-after-publish.title.API | owner | API+DB | no one re-asked | 200 {"eff":2,"del":9,"n":2,"mails":3}->{"eff":2,"del":9,"n":2,"mails":3} | PASS |
| PUB.edit-after-publish.location.unconfirmed-only.API | owner | API+DB | location change notifies only confirmed (none confirmed) => nothing | 200 {"eff":2,"del":9,"n":2,"mails":3}->{"eff":3,"del":9,"n":2,"mails":3} (an empty plan-changed effect row (0 assignments, 0 deliveries) is recorded: clutter only (INFO)) | PASS |
| PUB.release-prepared-after-publish.API | owner | API+DB | exactly m4 gets one email | 200 newmails=m4.qaw10.mail@example.test | PASS |
| PUB.assign-after-publish.new-person-asked-once.API | owner | API+DB | only m3 emailed (1 mail) | 201 new=m3.qaw10.mail@example.test | PASS |
| PUB.assign-after-publish.repeat-same-person.API | owner | API+DB | no second email to m3 | 201 {"eff":5,"del":15,"n":4,"mails":5}->{"eff":5,"del":15,"n":4,"mails":5} | PASS |
| PUB.notify-endpoint.published.reminds-pending.API | owner | API+fake | explicit "notify" re-sends to every unconfirmed released person (design: not gated by earlier asks) | 5 emails incl. people asked seconds earlier; same idempotency key replays with 0 mail (INFO: an explicit scheduler action, not the publish path) | PASS |
| PUB.notify-endpoint.same-key-replay.API | owner | API+DB | no second send | 200 newmails=0 | PASS |
| PUB.quiet.notify-false.API | sched | API+DB | published, nobody notified (no effect/delivery/in-app/mail) | 200 status=published {"eff":0,"del":0,"n":0,"mails":10}->{"eff":0,"del":0,"n":0,"mails":10} pn=null | PASS |
| PUB.quiet.notified_at-stays-null | sched | DB | notified_at null for all | [false,false,false] | PASS |
| PUB.quiet.then-unpublish-republish-notify-asks-unreached.API | owner | API+DB | people never reached ARE asked at the next notifying publish (documented: quiet != asked) | 200 newmails=2 notified=2 skipped=["Noemail Guest"] | PASS |
| PUB.past-plan.silent.API | admin | API+DB | published silently: no effect/delivery/mail | 200 status=published {"eff":0,"del":0,"n":0,"mails":12}->{"eff":0,"del":0,"n":0,"mails":12} pn=null | PASS |
| PUB.past-plan.preview | owner | API | will_notify 0 for a past plan | 200 {"will_notify":0,"no_email":[]} | PASS |
| PUB.today-plan.notifies | owner | API+DB | service date today in org tz => notified | 200 newmails=1 | PASS |
| PUB.archived-plan.notify-sends-nothing.API | owner | API+DB | archived never sends | archive=200 notify=200 {"notified":0,"skipped":[],"effect_id":null,"email_mode":"resend","outcomes":[],"summary": {"eff":0,"del":0,"n":0,"mails":13}->{"eff":0,"del":0,"n":0,"mails":13} | PASS |
| PUB.archived-to-published.asks | owner | API+DB | record behaviour: archived -> published notifies unreached | 200 newmails=1 (informational) | PASS |
| PUB.allowed.admin.API | admin | API+DB | published; m4 asked once; noemail listed skipped by name | assign=201 pub=200 status=published newmails=1 skipped=[""] (W10-MAIL-D1) | FAIL (W10-MAIL-D1) |
| PUB.allowed.sched.API | sched | API+DB | published; m4 asked once; noemail listed skipped by name | assign=201 pub=200 status=published newmails=1 skipped=[""] (W10-MAIL-D1) | FAIL (W10-MAIL-D1) |
| PUB.allowed.pubr.API | pubr | API+DB | published; m4 asked once; noemail listed skipped by name | assign=201 pub=200 status=published newmails=1 skipped=[""] (W10-MAIL-D1) | FAIL (W10-MAIL-D1) |
| PUB.allowed.owner.API | owner | API+DB | published; m4 asked once; noemail listed skipped by name | assign=201 pub=200 status=published newmails=1 skipped=["Noemail Guest"] | PASS |
| PUB.dispatch-recheck.draft-after-queue.cancelled | worker | worker+DB | queued email deliveries of a plan moved back to draft cancelled plan_not_published; none sent | cancelled plan_not_published=2; mails=0 (worker run 1 (14:49:49Z)) | PASS |
| PUB.republish.after-cancelled-email-but-in-app-reached | owner | API+DB | in-app delivered counts as reached => not re-asked (source: assignment_was_asked) | 200 newmails=0 eff=1 (documents known limitation: a cancelled email is never retried after republish) | PASS |
| PUB.concurrent.5-publishers-different-keys.API | owner,admin,sched,pubr | API+DB | each person exactly one email, one request effect with deliveries | statuses=200,200,200,200,200 mails=3 unique=3 effects=1 emailRows=3 | PASS |
| PUB.concurrent.same-key.API | owner | API+DB | one set of emails | statuses=200,200,200,200,200 mails=3 effects=1 | PASS |
| PUB.concurrent.publish-vs-assign.API | owner | API+DB | m1 and m2 each emailed exactly once, promptly | m1 emailed in-request; m2 request recorded but left queued (no in-request delivery) until a worker run; then sent once (simulated, worker run 2); no loss, no duplicate (W10-MAIL-D2) | FAIL (W10-MAIL-D2) |
| PUB.release-on-draft.marks-released-sends-nothing | owner | API+DB | releasing prepared requests on a draft plan marks them released, sends nothing, notified_at null | 200 released x2; 0 effects, 0 mails | PASS |
| PUB.publish-after-draft-release.asks-each-once | pubr | API+fake | publishing afterwards asks the two released people once | 2 mails | PASS |
| PUB.multi-plan-release.draft-plan-left-out | owner | API+fake | one email covering only the published plan; draft plan absent | 1 mail, mentions published plan only | PASS |
| PUB.multi-plan-release.draft-row-released-not-notified | owner | DB | draft plan row released but notified_at null; later publish asks m4 for it | [{"title":"W10 BatchDraft P51","visibility":"released","n":false},{"title":"W10 BatchPub P52","visibility":"released","n":true}] | PASS |
| PUB.multi-plan-release.draft-then-published-asks | owner | API+fake | publishing the left-out plan asks once | 1 mail | PASS |
| PUB.allowed.rpc.pubr-caller-token | pubr | PostgREST RPC caller JWT | plans.edit holder can call publish_plan_notify: plan published, 1 effect; repeat with same key idempotent | 200/200 status=published effects=1 deliveries=3 (RPC only records; mail goes out on next worker run: mails+=0) | PASS |
| PUB.unpublish.denied.m3 | m3 | API | 403, plan stays published | 403 status=published | PASS |
| PUB.unpublish.denied.smgr | smgr | API | 403, plan stays published | 403 status=published | PASS |
| PUB.unpublish.denied.m1 | m1 | API | 403, plan stays published | 403 status=published | PASS |
| PUB.draft.assign-notify-held | owner | API+DB | assign on a draft plan (notify true) -> 201 held_until_publish; 0 effects/deliveries/in-app rows/mails; prepared row stays prepared | 201 held_until_publish=true; eff 0 del 0 notif 0 mails 0; P1 draft with 4 released + 1 prepared | PASS |
| PUB.draft.notify-endpoint-held | owner | API+DB | POST /plans/:id/notify on a draft sends nothing (held_until_publish) | 200 held_until_publish=true notified 0, effect_id null | PASS |
| PUB.draft.publish-preview | pubr | API | will_notify counts released unnotified people with an address; no_email lists names; prepared excluded | {"will_notify":3,"no_email":["Noemail Guest"]} (m4 prepared excluded) | PASS |
| PUB.publish.pubr-plan-editor-notifies-everyone | pubr | API+DB+fake | a plan-only editor (plans.edit, no scheduling rights) publishes: m1, m2, guest each asked exactly once; Noemail skipped; m4 (prepared) NOT asked; respond link + Reply-To = response owner | 3 emails (subjects en/vi/vi), Noemail email skipped no_email_address, m4 notified_at null; in_app delivered x2 (logins); push skipped no_active_device | PASS |
| PUB.publish.in-app-and-email-once-per-person | pubr | DB | one effect, at most one delivery per person and channel | 1 effect (4 assignments), 8 delivery rows = 2 in_app + 2 push + 4 email | PASS |
| PUB.publish.respond-link-works-vi | guest | API | the emailed respond link opens the localized response (preferred_language vi) and answering works | GET 200 preferred_language=vi; respond 200 {"confirmed","assignments_updated":1} (browser rendering NOT_RUN) | PASS |
| PUB.publish.old-link-retired-after-reminder | anon | API | documented: a resend replaces the previous link once accepted | first P1 link 404 after the reminder email; reminder link works | PASS |
| PUB.ui.web-publish-confirmation | owner | web | confirmation lists who will be emailed and who has no address; "Notify people" ticked by default; DeliveryOutcomeNotice after publishing | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| PUB.ui.web-draft-banner-and-schedule-dialog | scheduler | web | "Draft — people you schedule won't be notified until you publish" banner; schedule dialog replaces the notify checkbox on a draft | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| PUB.ui.quiet-publish-copy | owner | web+mobile | quiet-publish wording (5b2ccb1) and "no address" names | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| PUB.ui.mobile-publish-action | scheduler | mobile | Publish / Unpublish action with the same confirmation, draft note, banner | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |

### B. ADR-0007 mention emails (MENT.*)

PASS 31 / FAIL 0 / NOT_RUN 1 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MENT.no-email.no_access.m3 | pubr | API+DB | mention resolution no_access; zero email deliveries; no notification to mentioned | res=no_access emails=0 toMentioned=0 | PASS |
| MENT.no-email.no_login.Guest Có Dấu | pubr | API+DB | mention resolution no_login; zero email deliveries; no notification to mentioned | res=no_login emails=0 toMentioned=0 | PASS |
| MENT.no-email.no_login.Noemail Guest | pubr | API+DB | mention resolution no_login; zero email deliveries; no notification to mentioned | res=no_login emails=0 toMentioned=0 | PASS |
| MENT.queue.delay-600s.m1 | pubr | DB | exactly one email delivery for mentioned m1, queued ~600 s out; none for unmentioned members | emails=1 to=W10 m1 delay=600 status=queued | PASS |
| MENT.queue.in-app-immediate | pubr | DB | in-app/push for participants immediate (not delayed) | in_app delivered=7 | PASS |
| MENT.optout.while-queued | m2 | worker+DB | opted out since queued => skipped channel_not_used; no mail | pref=200 status=skipped err=channel_not_used mails+=0 | PASS |
| MENT.optout.before-post | m2 | DB | no email delivery queued for an opted-out person (in-app still delivered) | emailRows=0 in_app_m2=1 | PASS |
| MENT.send.queued-vi-captured-locale | m2 | DB | email row queued with locale=vi captured | locale=vi status=queued | PASS |
| MENT.collapse.one-queued-row-per-person-thread | pubr,owner | DB | further mentions while queued add no email row | m1 email rows in thread=1 (queued) | PASS |
| MENT.collapse.latest-excerpt-and-more-count | worker | fake-provider | one mail; latest excerpt (owner third mention); "and 2 more mentions" | mails+=1 "Hi W10 m1,\n\nW10 owner mentioned you in Band chat:\n\n> third mention of @m1 by owner\n\nand 2 more mentions\n\nOpen it in Service Center: http://localhost:5173/chat/28166589-6c3d-4b10-bbf6-178c37ba90fa\n\nYou get this email because someone @mention | PASS |
| MENT.collapse.new-row-after-previous-sent | pubr | DB | after the email was sent, a new mention queues a new row | rows=[{"status":"queued"}] | PASS |
| MENT.separate-thread.plan-chat.own-row | m4 | DB | a plan chat mention queues its own email row (different thread) | rows=[{"status":"queued"}] conv=ok | PASS |
| MENT.item.queue-delay-600 | pubr | API+DB | item discussion mention queues email +600s | post=201 row={"id":"de896c1a-52ba-4b96-913c-5e7cf8926616","status":"queued","err":null,"locale":"en"} | PASS |
| MENT.item.skip-if-feed-row-read | m4 | worker+DB | cancelled already_read, no mail | read=200 cancelled/already_read mails+=0 | PASS |
| MENT.item.send-if-unread | m1 | worker+fake | sent with item title place & link to plan | provider_accepted mails+=1 subj=W10 pubr mentioned you in “Welcome “Chào”” link=http://localhost:5173/plans/be70510f-5c81-44e1-902a-38aa04e86bcc | PASS |
| MENT.item.not-visible-recipient | owner | API+DB | non-participant mentioned: resolution != notified, zero deliveries to them | post=201 res=[{"resolution":"no_access"}] deliveries=0 | PASS |
| MENT.item.source-hidden-from-nonparticipant.RLS | m2 | PostgREST caller JWT | non-participant cannot read the comment | 200 rows=0 | PASS |
| MENT.item.source-hidden-from-nonparticipant.API | m2 | API | 403/404 | 404 | PASS |
| MENT.item.skip-if-comment-deleted | owner | worker+DB | cancelled content_removed; no mail | del=200 cancelled/content_removed mails+=0 | PASS |
| MENT.skip-if-author-blocked | sched | worker+DB | recipient blocked author => no email (cancelled) | block=200 cancelled/already_read mails+=0 | PASS |
| MENT.skip-if-membership-inactive | m4 | worker+DB | inactive member => cancelled recipient_not_eligible; no mail | cancelled/recipient_not_eligible mails+=0 (membership set inactive by SQL (setup)) | PASS |
| MENT.retry.after-provider-500.identical-body-and-idempotency-key | worker | worker+fake | 500 => queued retry (attempts 1), then accepted with identical body & same Idempotency-Key | after500=queued/provider_unavailable attempts=1; retry=provider_accepted attempts=2; sameBody&Key=true | PASS |
| MENT.no-worker-mode.delay-0-immediate-simulated | pubr | API(:4200 no CRON_SECRET)+DB | ADR-0007: with no worker the delay is 0: email delivered in the same request (simulated), each mention its own email | posts=201,201 rows=W10 smgr:simulated:delay0,W10 smgr:simulated:delay0 (mail not captured by fake (shared API is simulated)) | PASS |
| MENT.retry.body-changed-after-first-attempt.documented-limitation | worker | worker+fake(idempotency conflict) | documented limitation (email-notifications.md): retry after a collapsed mention changed the body ends ambiguous provider_duplicate_key; never auto-resent | after500=queued/provider_unavailable/1 afterRetry=ambiguous/provider_duplicate_key/2 (known limitation, not a regression) | PASS |
| MENT.skip-if-read.read-position | admin | worker+DB | read position at/after the message => cancelled already_read; no mail | cancelled/already_read, mails+=0 | PASS |
| MENT.skip-if-read.feed-row-marked-read | sched | worker+DB | mention feed row read => cancelled already_read; no mail | cancelled/already_read, mails+=0 | PASS |
| MENT.send-if-unread.older-read-position | smgr | worker+fake | read position older than the message => sent once | provider_accepted, mails+=1 | PASS |
| MENT.skip-if-muted | owner | worker+DB | muted since queued => cancelled conversation_muted; no mail | cancelled/conversation_muted, mails+=0 | PASS |
| MENT.skip-if-message-deleted | pubr/m4 | worker+DB | message deleted => cancelled content_removed; no mail | cancelled/content_removed, mails+=0 | PASS |
| MENT.skip-if-lost-access.removed-from-team | owner/m4 | worker+DB | no longer a participant => cancelled recipient_not_eligible; no mail | cancelled/recipient_not_eligible, mails+=0 | PASS |
| MENT.queue.admin-collapse-then-read.cancelled | admin | worker+DB | a mention collapsed onto a queued row whose thread was then read is cancelled already_read | cancelled/already_read | PASS |
| MENT.ui.notification-preferences-toggle | member | web+mobile | "Email me when I'm @mentioned" in Settings -> Notification preferences (API half PASS via /reminder-policies/me) | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |

### C. Invitation email and invitation security (INVITE.*)

PASS 28 / FAIL 0 / NOT_RUN 0 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| INVITE.no-email-on-file | owner | API | 400 email required; no row, no mail | 400 {"error":"An email address is required to send an invitation","code":"bad_reques rows=0 | PASS |
| INVITE.invalid-email-override | owner | API | 422 | 422 | PASS |
| INVITE.role-owner-refused | owner | API | 422 (owner invitations not allowed) | 422 rows=0 | PASS |
| INVITE.override-email-and-role | owner | API+DB | 201; invitation row carries override email and role scheduler | 201 row=[{"email":"noemail.qaw10.mail@example.test","role":"scheduler"}] | PASS |
| INVITE.archived-person | owner | API | 409 (linked already) / restore first | archive=200 invite=409 | PASS |
| INVITE.denied.admin | admin | API | 403 (owner-only People rule), no invitation row, no mail | 403 "Only the organization owner can access personal details or manage people", rows 0, mails +0 | PASS |
| INVITE.denied.sched | sched | API | 403 (owner-only People rule), no invitation row, no mail | 403 "Only the organization owner can access personal details or manage people", rows 0, mails +0 | PASS |
| INVITE.denied.m1 | m1 | API | 403 (owner-only People rule), no invitation row, no mail | 403 "Only the organization owner can access personal details or manage people", rows 0, mails +0 | PASS |
| INVITE.denied.smgr | smgr | API | 403 (owner-only People rule), no invitation row, no mail | 403 "Only the organization owner can access personal details or manage people", rows 0, mails +0 | PASS |
| INVITE.denied.pubr | pubr | API | 403 (owner-only People rule), no invitation row, no mail | 403 "Only the organization owner can access personal details or manage people", rows 0, mails +0 | PASS |
| INVITE.denied.other-org-owner | bowner | API | 404 | 404 | PASS |
| INVITE.denied.anonymous | anon | API | 401 | 401 | PASS |
| INVITE.denied.rls-insert.admin | admin | PostgREST caller JWT | insert into person_invitations refused | 403 42501 RLS | PASS |
| INVITE.denied.rls-select.admin | admin | PostgREST caller JWT | no invitation rows readable (token_hash hidden) | 200 rows=0 | PASS |
| INVITE.denied.rls-insert.m1 | m1 | PostgREST caller JWT | insert into person_invitations refused | 403 42501 RLS | PASS |
| INVITE.denied.rls-select.m1 | m1 | PostgREST caller JWT | no invitation rows readable (token_hash hidden) | 200 rows=0 | PASS |
| INVITE.denied.rls-insert.sched | sched | PostgREST caller JWT | insert into person_invitations refused | 403 42501 RLS | PASS |
| INVITE.denied.rls-select.sched | sched | PostgREST caller JWT | no invitation rows readable (token_hash hidden) | 200 rows=0 | PASS |
| INVITE.owner.issue.vi | owner | API+fake-provider | 201 with invite_url; one email to the Person (language vi); DB stores only the token hash, 7-day expiry, role member, channel email | 201; subject "Tham gia QA W10 Mail A"; token not found in DB (hash only); expires +7 d | PASS |
| INVITE.email.from-and-headers | owner | fake-provider | From = "Service Center" <MAIL_FROM_ADDRESS> (quoted display name), no Reply-To | From "Service Center" <notifications@example.com>; reply_to absent (source note: invitations use the platform name, schedule/mention/message emails use the organization name (resend-transport.ts)) | PASS |
| INVITE.email.content.vi | owner | fake-provider | lang=vi, heading, greeting with full name incl. diacritics, accept link twice (button + plain), app-store block | lang=vi; "Chào Guest Có Dấu"; link x2; "Tải ứng dụng" block; preheader and footer in vi | PASS |
| INVITE.email.app-badges | owner | fake-provider | App Store badge links to IOS_APP_STORE_URL; Google Play shows "Sắp ra mắt" (unset); no empty href | iOS href https://apps.apple.com/app/id0000000; Play badge inert "Sắp ra mắt"; text part "Tải về trên Google Play: sắp ra mắt" | PASS |
| INVITE.email.app-badges.both-unset | - | template render (tsx) | both badges "coming soon", no dead links (en and vi) | comingSoon x2 in HTML in both locales; text part "coming soon"/"sắp ra mắt"; 0 empty href | PASS |
| INVITE.email.logo | - | template render | absolute logo URL APP_URL/icon-192.png with alt = app name | http://localhost:5173/icon-192.png (file exists in frontend/public; :5173 is a stale foreign server and returns 404 here) | PASS |
| INVITE.email.html-escaping | - | template render (tsx) | hostile person/org names escaped in HTML; no script/onerror; query-string & escaped | no raw <script>/<img onerror>; &lt;script&gt; present; subject carries the org name verbatim (plain header) | PASS |
| INVITE.email.from-quoting.mailbox | - | mailbox() render + live org B send | comma, quote, <>, CR/LF, backslash in the display name cannot break or spoof the header | live org B "Grace, \"Hope\" <x@evil.test> Bcc: z@evil.test Nguyễn Church" quoted as one display name; CR/LF folded to a space; empty name falls back to bare address | PASS |
| INVITE.email.en-locale-and-no-outbox-row | owner | DB | invitation email is sent directly (no deliveries row); resend returns the new link and revokes the old | no deliveries/effects rows for invitations (planned follow-up feature/invitation-outbox not built) (plan/source agree: invitation not in the outbox) | PASS |
| INVITE.email.en-locale | owner | fake-provider | English invitation for a Person whose language is en | subject "Join QA W10 Mail A" | PASS |

### D. PEOPLE-02 guest to account (PEOPLE-02.*)

PASS 47 / FAIL 2 / NOT_RUN 2 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| PEOPLE-02.preview.localized | anon | API | org name, first name, vi language, email, role, expiry | {"organization_name":"QA W10 Mail A","person_first_name":"Guest","preferred_language":"vi","email":"guest.qaw10.mail@example.test","role":"member","expires_at":"2026-11-29T14:55:42.971+00:00"} | PASS |
| PEOPLE-02.preview.bad-token | anon | API | 404 | 404 | PASS |
| PEOPLE-02.accept.new-account.no-password | anon | API | 422 password_required; nothing linked | 422 password_required | PASS |
| PEOPLE-02.accept.new-account.short-password | anon | API | 422 (min 8) | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"password","code":"too_sma | PASS |
| PEOPLE-02.accept.new-account | anon | API+DB | 200 linked_existing_account=false; Person linked to new login; email unconfirmed | 200 {"email":"guest.qaw10.mail@example.test","linked_existing_account":false} | PASS |
| PEOPLE-02.accept.same-person-id-linked | anon | DB | same Person id, profile_id = new login id | person=true linked=true confirmed=false | PASS |
| PEOPLE-02.accept.new-account-unconfirmed | anon | DB | created login email unconfirmed (SEC-002) | confirmed=false | PASS |
| PEOPLE-02.accept.reuse | anon | API | 410 invitation_used | 410 invitation_used | PASS |
| PEOPLE-02.preview.used | anon | API | 410 | 410 | PASS |
| PEOPLE-02.signin.before-confirm | guest | Auth | refused (email not confirmed) | 400 email_not_confirmed | PASS |
| PEOPLE-02.survive.assignments-same-ids-and-answers | guest | DB | same assignment ids; P20 confirmed answer kept; others unchanged | ids=true statuses=unconfirmed,unconfirmed,unconfirmed,confirmed,unconfirmed user_id set=true (assignments.user_id=login) | PASS |
| PEOPLE-02.survive.tags | guest | DB | tags unchanged | [{"tag":"người-dẫn"},{"tag":"vocal"}] | PASS |
| PEOPLE-02.survive.attendance | guest | DB | attendance record same id/status | [{"id":"3ab34437-fc8a-4b8d-a656-5fe858ac24ce","status":"present","plan_id":"192ab7c9-815a-45aa-9c6b-eda37f41021f"}] | PASS |
| PEOPLE-02.survive.team-membership | guest | DB | team membership same id | [{"id":"107b42f6-b59b-491b-acd0-5b9c482d6fbf","team_id":"0d47d14b-ff0e-4c39-9428-bbb910935cf6"}] | PASS |
| PEOPLE-02.survive.language | guest | API | preferred_language vi kept | {"preferred_language":"vi","person_linked":true} | PASS |
| PEOPLE-02.survive.schedule-mine-includes-history | guest | API | upcoming + past (as /schedule/mine returns) reachable by the new login | status=200 entries=4 | PASS |
| PEOPLE-02.survive.pre-login-respond-link | anon | API | link emailed before login still resolves (used/stale ok, not 5xx) and keeps previous answer | 410 {"error":"This assignment response link has already been used","code":"assignment_notification_used"} | PASS |
| PEOPLE-02.membership.role-member | guest | API | member of org A with invitation role | 200 [{"organization":{"id":"e3b14541-12c5-45af-bd25-039d2218ad9d","city":null,"name":"QA W10 Mail A","slug":"qa-w10-mail-a", | PASS |
| PEOPLE-02.SEC-013.owner-email-change-refused | owner | API | 409 person_email_locked | 409 person_email_locked | PASS |
| PEOPLE-02.SEC-013.other-fields-editable | owner | API | 200 campus saved | 200 Hà Nội | PASS |
| PEOPLE-02.SEC-013.self-service-email-change-refused | guest | Auth | refused; no pending email_change | 500 unexpected_failure pending=guest.qaw10.mail@example.test\| | PASS |
| PEOPLE-02.SEC-013.roster-email-equals-login-email | guest | DB | Person email = accepted login email | guest.qaw10.mail@example.test | PASS |
| PEOPLE-02.invite.expired | anon | API | 410 invitation_expired | 410 invitation_expired | PASS |
| PEOPLE-02.invite.expired-accept | anon | API | 410, no account created, no link | 410 invitation_expired users=1 | PASS |
| PEOPLE-02.reconcile.list.admin | admin | API | 200 open reports (invitation_conflict) | 200 n=2 | PASS |
| PEOPLE-02.reconcile.list.denied.m1 | m1 | API | 403 | 403 | PASS |
| PEOPLE-02.reconcile.list.denied.sched | sched | API | 403 | 403 | PASS |
| PEOPLE-02.reconcile.list.denied.smgr | smgr | API | 403 | 403 | PASS |
| PEOPLE-02.reconcile.rls.member | m1 | PostgREST caller JWT | no rows | 200 rows=0 | PASS |
| PEOPLE-02.reconcile.resolve.denied.member | m1 | API | 403; status stays open | 403 open | PASS |
| PEOPLE-02.reconcile.keep-separate.admin | admin | API+DB | closed; both Persons unchanged/unlinked | 200 status=kept_separate | PASS |
| PEOPLE-02.reconcile.merge.admin-or-owner | admin | API+DB | explicit merge is a deliberate admin action (record outcome) | 400 {"error":"Invalid identifier or value","code":"bad_request"} secPersonStillExists=0 (informational: merge outcome) | PASS |
| PEOPLE-02.SEC-013.accepted-override-email-becomes-primary | anon | API+DB | Person with no email: accepted address becomes roster email; role scheduler on membership | accept=200 email=noemail.qaw10.mail@example.test role=scheduler | PASS |
| PEOPLE-02.SEC-013.self-service-email-change-clean-error | guest | Auth | refused with a clean 4xx error | 500 unexpected_failure (refused, no pending change) (W10-MAIL-D3) | FAIL (W10-MAIL-D3) |
| PEOPLE-02.existing-login.anonymous-refused | anon | API | 403 invitation_sign_in_required; nothing linked | 403 invitation_sign_in_required, profile_id null | PASS |
| PEOPLE-02.existing-login.other-session-refused | m1 | API | 403 when a different login is signed in (client must not sign out) | 403 invitation_sign_in_required, nothing linked | PASS |
| PEOPLE-02.existing-login.password-ignored-anonymous | anon | API | a password in the body does not let an anonymous caller link an existing login | 403 | PASS |
| PEOPLE-02.existing-login.accept-own-session | ex1 | API+DB | 200 linked_existing_account=true; Person linked to the existing login | 200, profile_id = ex1 | PASS |
| PEOPLE-02.existing-login.survive.answer-and-ids | ex1 | DB | assignment id and the earlier (token) declined answer preserved; user_id now the login | same id, declined, user_id = login | PASS |
| PEOPLE-02.existing-login.survive.tags-language | ex1 | DB+API | tag and language en kept | tag keys, preferred_language en | PASS |
| PEOPLE-02.duplicate-email.create-person-no-auto-link | owner | API+DB | creating a Person with an existing login email makes a separate unlinked Person (no silent merge) | created, profile_id null | PASS |
| PEOPLE-02.duplicate-email.invite-does-not-link | owner | API+DB | inviting that Person returns a link; the same-email login is not linked by the invite alone | 201, still unlinked | PASS |
| PEOPLE-02.duplicate-email.anonymous-accept-refused | anon | API | 403 sign-in required | 403 invitation_sign_in_required | PASS |
| PEOPLE-02.duplicate-email.accept-as-already-rostered-login | m1 | API+DB | 409 identity_conflict; candidate stays unlinked; m1 keeps own single Person; a reconciliation report opens | 409 identity_conflict; m1 Persons=1; report invitation_conflict/open | PASS |
| PEOPLE-02.duplicate-email.unconfirmed-account-holds-email | anon | API+DB | 409 account_unconfirmed; no link; no second account | 409 account_unconfirmed, linked false | PASS |
| PEOPLE-02.duplicate-email.second-person-same-login | ex1 | API+DB | a login cannot be two Persons in one org: 409 identity_conflict; no link | 409, unlinked, report opened | PASS |
| PEOPLE-02.invite.already-linked-person | owner | API | 409 person already has a login | 409 | PASS |
| PEOPLE-02.invite.resend-revokes-previous | owner | API+DB | old link 410; exactly one pending invitation | old 410, pending 1 | PASS |
| PEOPLE-02.reconcile.merge.response | admin | API+DB | 200 with the resolved report after a committed explicit merge | 400 {"error":"Invalid identifier or value","code":"bad_request"} although the merge committed (candidate deleted, tags and history moved to the kept Person, report row cascaded away); repeated 2x (W10-MAIL-D4) | FAIL (W10-MAIL-D4) |
| PEOPLE-02.ui.accept-invite-page | guest/newcomer | web+mobile | accept-invite page localized, password form, sign-in-required path for existing logins, post-confirm sign-in | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| PEOPLE-02.ui.respond-page-localized | guest | web | emailed response page renders in the Person language (API returns preferred_language vi) | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |

### E. Stale FAIL reruns: NOTIFY-01 (W7-MSG-D1/D3/D4/D5)

PASS 4 / FAIL 0 / NOT_RUN 1 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| NOTIFY-01.pagination.next_cursor-echoed.API | m3 | API | W7-MSG-D1 rerun: page 2 loads with the server-issued next_cursor passed verbatim as before (200, no 422) | pages=7 cursor1=2026-11-22T10:00:09.123456+00:00~5cc590c err=null (orig W7-MSG-D1) | PASS |
| NOTIFY-01.pagination.identical-created_at-ties.API | m3 | API+DB | W7-MSG-D3 rerun: every notification exactly once across pages despite 6-way created_at ties | seen=66/66 unique=66 distinctTs=16 (orig W7-MSG-D3) | PASS |
| NOTIFY-01.rls.update.own-content-columns.m3 | m3 | PostgREST caller JWT | W7-MSG-D5 rerun: only read_at writable; every other column refused/unchanged | title:403 body:403 type:403 created_at:403 user_id:403 organization_id:403 created_by:403 dedupe_key:403 plan_id:403 read_at:200 (orig W7-MSG-D5) | PASS |
| NOTIFY-01.target-deleted.notification-snippet.API | m4 | API+DB+RLS | W7-MSG-D4 rerun: after the message is deleted its text is gone from the feed (API) and from PostgREST reads | before=1 del=200 afterApi=0 dbRowsWithText=0 postgrestRows=0 (orig W7-MSG-D4) | PASS |
| NOTIFY-01.cursor-Z-and-garbage | m3 | API | before=<Z form> 200, garbage 422 | not re-run (passed originally in wave 7) (only the 4 FAIL rows were re-run) | NOT_RUN |

### F. Stale FAIL reruns: HOOK-01 (W8-INT-D1/D2/D3) and webhook coverage

PASS 70 / FAIL 1 / NOT_RUN 2 / NOT_APPLICABLE 1

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| HOOK-01.register.denied.sched | sched | API | 403, no endpoint row | 403 | PASS |
| HOOK-01.register.denied.m1 | m1 | API | 403, no endpoint row | 403 | PASS |
| HOOK-01.register.denied.smgr | smgr | API | 403, no endpoint row | 403 | PASS |
| HOOK-01.register.denied.pubr | pubr | API | 403, no endpoint row | 403 | PASS |
| HOOK-01.register.denied.anonymous | anon | API | 401 | 401 | PASS |
| HOOK-01.register.denied.rls-direct-insert.m1 | m1 | PostgREST caller JWT | refused | 403 | PASS |
| HOOK-01.secret.not-readable-by-admin-rest | admin | PostgREST caller JWT | secret_ciphertext not returned to callers (column privilege or no rows) | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| HOOK-01.destination.register.refused.not a url | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable (orig W8-INT-D3) | PASS |
| HOOK-01.destination.register.refused.ftp://example.com/h | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.https://user:pw@example.com/h | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.https://example.com/h#frag | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.javascript:alert(1) | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable | PASS |
| HOOK-01.destination.register.refused.(empty) | owner | API | 422 not 500 (W8-INT-D3 rerun for "not a url") | 422 unprocessable | PASS |
| HOOK-01.register.owner.valid | owner | API | 201 + secret returned once | endpoints=400,500,ok,reset,hang,retry7 secretShown=true | PASS |
| HOOK-01.register.admin | admin | API | 201 (admin allowed per requireAdmin) | 201 | PASS |
| HOOK-01.list.no-secret-leak | owner | API | list never contains the signing secret | 200 containsWhsec=false | PASS |
| HOOK-01.destination.private-refused.http://127.0.0.1:4622/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://localhost:4622/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://[::1]:4622/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://127.1/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://0x7f.0.0.1/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://2130706433/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://10.0.0.5/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://192.168.1.10/ok | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://169.254.169.254/latest/meta-data | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://172.16.0.1/x | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://0.0.0.0/x | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.http://[::ffff:127.0.0.1]/x | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_invalid_url | PASS |
| HOOK-01.destination.private-refused.https://localhost/x | owner | API (allow-private OFF, :4623) | 4xx webhook_invalid_url; no endpoint row | 422 webhook_destination_blocked | PASS |
| HOOK-01.destination.private-refused.none-persisted | owner | DB | no endpoint rows created | active before=7 after=7 | PASS |
| HOOK-01.event.created-as-published | owner | DB | W8-INT-D2 rerun: plan created already published emits plan.published | status=published events=["plan.published"] (orig W8-INT-D2 / W3-INT-D7) | PASS |
| HOOK-01.event.lifecycle.published-unpublished-published | owner | DB | plan.published, plan.unpublished, plan.published events (3) with distinct source keys | events=["plan.published","plan.unpublished","plan.published"] | PASS |
| HOOK-01.event.no-event-for-edit | owner | DB | title/notes edit emits no event | delta=0 | PASS |
| HOOK-01.event.denied-actor-no-event | m3 | DB | denied publish emits no event | events=0 | PASS |
| HOOK-01.event.republish-no-duplicate-event | owner | DB | publishing an already-published plan emits no new event | delta=0 | PASS |
| HOOK-01.signature.every-delivery-verifies | receiver | receiver verifier (Standard Webhooks) | all requests verify with their own endpoint secret at receipt time | 164 verified; 4 requests to the admin-registered endpoint (shares path /ok; its secret was not retained) could not be checked: see next row | PASS |
| HOOK-01.signature.tampered-body | receiver | verifier | bad_signature | bad_signature | PASS |
| HOOK-01.signature.replay-old-timestamp | receiver | verifier | timestamp_out_of_range when replayed later than 5 min | timestamp_out_of_range | PASS |
| HOOK-01.signature.wrong-secret | receiver | verifier | bad_signature under another endpoint secret | bad_signature | PASS |
| HOOK-01.retry.same-webhook-id-new-timestamp | receiver | receiver | each event id repeated for all 8 attempts, timestamps differ per attempt | events=4 attempts/event=8 distinctTs=true | PASS |
| HOOK-01.duplicate-event-id.one-delivery-per-endpoint | receiver | receiver | each event id delivered once per succeeding endpoint (no duplicate when succeeded) | [2,2,2,2] (/ok has 2 endpoints (owner+admin) pointing to it) | PASS |
| HOOK-01.payload.minimal-no-private-fields | receiver | receiver | only ids/type/created_at; no title, notes, names, emails, assignments, tokens | keys=id,type,api_version,created_at,organization_id,data data={"plan_id":"0ed7980e-ff8f-4f0d-be2a-d512daaeb5ea","service_type_id":"bcc6dbc6-14bc-43f2-bedc-49f4262ad45d"} | PASS |
| HOOK-01.payload.headers | receiver | receiver | content-type json, UA ServiceCenter-Webhooks/1, no authorization/cookie header | ct=application/json ua=ServiceCenter-Webhooks/1 auth=false | PASS |
| HOOK-01.dead-letter.after-8-attempts | worker | DB | 20 deliveries (500/400/reset/hang/retry7 x 4 events) end failed after exactly 8 attempts; no 9th attempt | failed@8=20 maxAttempt=8 (earlier draft of this row expected 16 (retry7 was forgotten)) | PASS |
| HOOK-01.retry.attempt1./500 | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 1 ≈ 5s ±10% jitter (not ~24 h) | delay=5.4s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt2./500 | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 2 ≈ 300s ±10% jitter (not ~24 h) | delay=282.2s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt1./400 | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 1 ≈ 5s ±10% jitter (not ~24 h) | delay=4.8s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt2./400 | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 2 ≈ 300s ±10% jitter (not ~24 h) | delay=303.7s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt1./reset | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 1 ≈ 5s ±10% jitter (not ~24 h) | delay=4.7s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt2./reset | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 2 ≈ 300s ±10% jitter (not ~24 h) | delay=285.3s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt1./hang | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 1 ≈ 5s ±10% jitter (not ~24 h) | delay=5.4s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempt2./hang | owner | worker+receiver | W8-INT-D1 rerun: delay after attempt 2 ≈ 300s ±10% jitter (not ~24 h) | delay=272.2s (orig W8-INT-D1) | PASS |
| HOOK-01.retry.attempts3-7-schedule | worker | DB | 30 min, 2 h, 5 h, 10 h, 14 h (±12% jitter incl. timestamp resolution) for all four failure modes | 0 out of band of 20 | PASS |
| HOOK-01.revoke.denied.member | m1 | API | 403; endpoint still active | 403 revoked=f | PASS |
| HOOK-01.concurrent-workers.exactly-one-post-per-delivery | worker x3 | workers+receiver | 3 concurrent workers: each active delivery claimed once (sum of claims = deliveries), /ok receives exactly 2 posts (owner+admin endpoints), none to revoked | claims=3,0,0 sum=3 okPosts=2 statuses=["ok:succeeded","ok:succeeded","retry7:queued:http_503"] | PASS |
| HOOK-01.revoke.pending-delivery-cancelled | owner | API+worker+DB | queued delivery of a revoked endpoint is cancelled (endpoint_revoked) and not POSTed | cancelled/endpoint_revoked posts+=0 run={"claimed":0,"succeeded":0,"retried":0,"failed":0,"stale":0,"pruned":0} | PASS |
| HOOK-01.enable.denied.member | m1 | API | 403 | 403 | PASS |
| HOOK-01.test-event | owner | API+worker+receiver | "webhook.test" event delivered, signed, minimal | status=202 delivered=true body={"id":"evt_9a3f13abd92846fa90a3a11b9a68ebbd","type":"webhook.test","api_version":"2026-11-01","created_at":"2026-11-22T1 | PASS |
| HOOK-01.test-event.denied.member | m1 | API | 403 | 403 | PASS |
| HOOK-01.deliveries-list.denied.m1 | m1 | API | 403 | 403 | PASS |
| HOOK-01.deliveries-list.denied.sched | sched | API | 403 | 403 | PASS |
| HOOK-01.deliveries-list.denied.smgr | smgr | API | 403 | 403 | PASS |
| HOOK-01.deliveries-list.owner | owner | API | 200 with attempts history, no secrets | 200 hasWhsec=false | PASS |
| HOOK-01.manual-retry.on-revoked-endpoint | owner | API | refused (409) for a revoked endpoint, nothing queued | 409 webhook_endpoint_stale status=failed (endpoint revoked=true) | PASS |
| HOOK-01.manual-retry.denied.member | m1 | API | 403 | 403 | PASS |
| HOOK-01.enable.stale-revision | owner | API | 409 stale revision; still disabled | 409 webhook_endpoint_stale enabled=f | PASS |
| HOOK-01.disable.no-new-deliveries | owner | API+DB | event after disable creates no delivery for that endpoint (other enabled endpoints still get theirs) | toggle=200 deliveriesForDisabled=0 forEnabledOthers=1 | PASS |
| HOOK-01.signature.admin-endpoint-4-requests | receiver | verifier | verify the 4 requests of the admin-registered endpoint | signing secret of that endpoint was not captured (same code path as the 164 verified) | NOT_RUN |
| HOOK-01.destination.register.refused.169.254-with-allow-private-ON | owner | API :4620 (allow-private ON) | n/a: link-local accepted when WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=true (dev/test only; production refuses the flag). Private ranges refused with the flag OFF: see HOOK-01.destination.private-refused.* | 201 on the flagged instance; endpoint revoked immediately | NOT_APPLICABLE |
| HOOK-01.revoked-endpoint.no-fan-out | worker | DB+receiver | an event after revoke creates no delivery for the revoked endpoints and nothing is POSTed to them | event after revoking /500,/400,/reset,/hang: 0 deliveries for them (only /ok x2 + /retry7 queued) | PASS |
| HOOK-01.retry-after-honoured | owner | worker+DB | Retry-After: 7 honoured (7 s) instead of the 5 s base schedule | delays 6.3-7.6 s after attempt 1 on /retry7 (4 deliveries) | PASS |
| HOOK-01.logs.no-secrets-or-tokens | owner | API log | no whsec_, bearer, JWT, addresses, link tokens in the private API log (472 lines) | counts: whsec_ 0, Bearer 0, eyJ 0, example.test 0, token= 0; token paths logged as [token] | PASS |
| HOOK-01.real-https-tls | - | webhook receiver over https | certificate validation, SNI, DNS rebinding with a real resolver | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| HOOK-01.worker-without-INTEGRATION_SECRET_KEY.fails-and-disables | worker | worker (.env without the key) + DB | a worker started without the signing key leaves due webhook deliveries queued (misconfiguration) rather than failing them permanently | official worker runs 3+4 (15:06:28Z, .env has no INTEGRATION_SECRET_KEY) marked 12 due plan.published deliveries failed/secret_unavailable on first attempt and auto-disabled both endpoints (disabled_reason failing, consecutive_failures 6) (W10-MAIL-D5) | FAIL (W10-MAIL-D5) |

### G. I18N-02 delivery half, retry and worker (I18N.*, RETRY.*, MSG.*)

PASS 10 / FAIL 0 / NOT_RUN 1 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| I18N.locale.captured-stable-after-language-change.mention | m2 | worker+fake | language switched vi->en after queue: email still vi (captured locale) | status=provider_accepted locale=vi mails+=1 subject=W10 pubr đã nhắc đến bạn trong nhóm trò chuyện Band | PASS |
| I18N.locale.captured-stable-on-retry.request-email | worker | worker+fake | after 500 → retry, each recipient receives the language captured when queued, even after the Person changed language (m1 en→vi, m2 vi→en) | captured={"m1":"en","m2":"vi","m4":"en","guest":"vi","ex1":"en"} sent={"m1":"en","ex1":"en","guest":"vi","m4":"en","m2":"vi"} statuses=provider_accepted,provider_accepted,provider_accepted,provider_accepted,provider_accepted attempts=2,2,2,2,2 | PASS |
| I18N.locale.null-preference-default-en | worker | DB | Person with no saved language captured as en | m4=en ex1=en | PASS |
| RETRY.email.same-idempotency-key-and-identical-body | worker | worker+fake | with DELIVERY_LINK_SECRET: retry after provider 500 repeats Idempotency-Key and identical body (same link) | [{"to":"m1.qaw10.mail@example.test","attempts":2,"sameKey":true,"sameBody":true},{"to":"m2.qaw10.mail@example.test","attempts":2,"sameKey":true,"sameBody":true}] | PASS |
| I18N.concurrent-recipients.three-workers-one-effect | worker x3 | workers+fake | 3 concurrent workers on 6 queued emails: each recipient exactly one mail in own locale; attempts=1; sum of claims = 6 | claims=0,0,6 mails=6 unique=6 statuses=provider_accepted attempts=2 | PASS |
| I18N.concurrent-recipients.locale-per-recipient | worker x3 | fake-provider | m2 and guest Vietnamese; m1, m4, ex1, pubr English; title "Ơn" preserved | {"pubr":"en","ex1":"en","guest":"vi","m2":"vi","m4":"en","m1":"en"} titleOk=true | PASS |
| I18N.locale.per-person-per-org.mention | m1 | worker+fake | same login: org B (vi) mention email in Vietnamese, From = org B name quoted; org A mention in English (see MENT.collapse...en) | post=201 locale=vi delay=600 subj=W10 bowner đã nhắc đến bạn trong nhóm trò chuyện Ban nhạc from="Grace, \"Hope\" <x@evil.test> Bcc: z@evil.test Nguyễn Church" <notifications@example.com> | PASS |
| I18N.vi-name-in-scheduler-response-email | m2 | API+fake-provider | owner (en) is told "Nguyễn Thị Ánh" declined; diacritics intact; private reason NOT included | status=200 mails=1 to=owner.qaw10.mail@example.test subj=W10 Decline Notice P40 — assignment declined nameOk=true reasonLeak=false | PASS |
| MSG.operational.email-sent-per-recipient-locale | owner | API+fake | each Band member emailed once with their captured locale; diacritics intact; HTML escaped; reply-to the sender | status=201 mails=7 localeSet=en,vi sample=Tập nhạc Chủ nhật — Ơn “Chúa” <b>x</b> | PASS |
| MSG.operational.html-escaped-and-diacritics | owner | fake-provider | user-authored subject/body preserved (text) and escaped in HTML | rawTagInHtml=false diacritics=true replyTo=owner.qaw10.mail@example.test | PASS |
| I18N-02.vietnamese-speaker-review | - | human review | native Vietnamese review of email copy (subjects, greeting by full name vs "Xin chào {first_name}" with Vietnamese name order) | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |

### H. Delivery settings API and labels (DELIVERY.*, EMAIL.*, PUSH.*)

PASS 15 / FAIL 1 / NOT_RUN 3 / NOT_APPLICABLE 0

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| DELIVERY.list.no-plan-rows-carry-kind | admin | API | no-plan deliveries (messages, mentions) expose template kind and null plan_title so the UI can label by kind | status=200 total=50 noPlan=40 kinds=operational_message,conversation_message | PASS |
| DELIVERY.list.denied.m1 | m1 | API | 403 | 403 | PASS |
| DELIVERY.list.denied.sched | sched | API | 403 | 403 | PASS |
| DELIVERY.list.denied.smgr | smgr | API | 403 | 403 | PASS |
| DELIVERY.list.denied.pubr | pubr | API | 403 | 403 | PASS |
| DELIVERY.status.admin | admin | API | 200 transport modes + worker_configured | 200 {"email":"resend","push":"simulated","worker_configured":true,"pending":5,"needs_attention":0} | PASS |
| DELIVERY.rls.member-cannot-read-others-deliveries | m1 | PostgREST caller JWT | a plain member sees none (or only own) deliveries/effects | deliveries=0 effects=0 (own-delivery policy: see source) | PASS |
| DELIVERY.retry.denied.m1 | m1 | API | 403, status unchanged | 403 status=ambiguous | PASS |
| DELIVERY.retry.denied.sched | sched | API | 403, status unchanged | 403 status=ambiguous | PASS |
| DELIVERY.retry.denied.smgr | smgr | API | 403, status unchanged | 403 status=ambiguous | PASS |
| DELIVERY.retry.admin-ambiguous | admin | API+DB | allowed: re-queued (manual_retries+1) with same idempotency semantics | 200 {"id":"c4ac4cb8-1615-48b1-b201-d63e93e9cbed","recipient_id":"922c70e3-e726-4a95-a7e4-cdb28ab8f279"," -> {"status":"provider_accepted","manual_retries":1,"err":null} | PASS |
| DELIVERY.list.recipient-name-hidden-for-non-owner | admin | API | Settings -> Delivery shows the recipient name of every row | for deliveries to Persons who had no login when queued, owner sees "Guest Có Dấu" but admin sees "" (W10-MAIL-D1) | FAIL (W10-MAIL-D1) |
| DELIVERY.labels.no-plan-keys-en-vi-complete | - | source (shared locales) | noPlanContext has en and vi labels for all 8 delivery_template values | all 8 present in both locales (render in Settings is browser-only) | PASS |
| DELIVERY.ui.settings-no-plan-labels | admin | web | rows without a plan show "Message" / "Team chat" (en) or "Tin nhắn" / "Trò chuyện nhóm" (vi); paused-worker list | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| EMAIL.real-provider-and-clients | - | Resend / Gmail / Outlook | real delivery, SPF/DKIM, rendering in mail clients, Resend webhooks (not consumed) | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| PUSH.expo-real-device | - | device | push for assignment/mention (rows skipped no_active_device here) | not run: browser owned by W10-WEB / needs a device, real provider or human reviewer | NOT_RUN |
| DELIVERY.config.empty-CRON_SECRET-boots-worker-route-404 | operator | private API :4624 (CRON_SECRET empty) | 261cea2: empty optional secret never stops the API; worker route disabled | /health 200; POST /internal/deliveries/run 404; /deliveries/status worker_configured=false | PASS |
| DELIVERY.config.invalid-secrets-warn-without-value | operator | private API :4624 | short DELIVERY_LINK_SECRET and malformed INTEGRATION_SECRET_KEY: startup warning names the variable and rule, never the value; features stay off | two [config] ... ignored warnings; value strings absent from the log (grep count 0); webhook register -> 503 webhooks_unavailable | PASS |
| DELIVERY.config.worker-route-auth | anon | API :4620 (CRON_SECRET set) | 401 without or with a wrong bearer secret | POST wrong secret 401; POST none 401; GET none 401 | PASS |

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| Browser steps: publish confirmation, draft banner, schedule dialog copy, quiet-publish copy, Settings → Delivery labels, notification-preferences toggle, accept-invite page, localized respond page | NOT_RUN (browser owned by W10-WEB) | API/DB halves are covered above; the label keys exist in en and vi for all 8 templates |
| Mobile Publish/Unpublish action and other native halves | NOT_RUN | no simulator/device in this package |
| Real Resend, SPF/DKIM, mail-client rendering, Resend webhooks; Expo push on a device | NOT_RUN | no provider keys or devices; "provider_accepted" in this report means the local fake accepted it |
| Webhooks over real `https://` (TLS, SNI, DNS rebinding) | NOT_RUN | receiver is plain `http://127.0.0.1`; private ranges are refused with the flag off (13 forms PASS) |
| 4 requests to the admin-registered endpoint's signature | NOT_RUN | its secret was not retained; the 164 other requests all verify |
| Vietnamese-speaker review of email copy | NOT_RUN | human reviewer needed |
| NOTIFY-01 non-FAIL rows of wave 7 (Z-form cursor, garbage cursor, mark-read…) | NOT_RUN | only the four FAIL rows were in scope |
| Hidden-by-moderation message snippet (CHAT-02 variant of W7-MSG-D4) | NOT_RUN | outside NOTIFY-01's row; delete variant PASS |

## Fixtures and pending state left

* **Deliveries (qa-w10-mail-a):** 8 `queued` (6 email: the `m1` mention in Band, the plan-chat mention, `P70` request, and similar not yet due or never claimed; 1 in-app, 1 push), 3 `simulated`, 63 `provider_accepted` (fake), 13 + 2 `cancelled`, 10 `skipped` email, 284 `skipped` push (`no_active_device`), 286 `delivered` in-app. Org B: 4 `provider_accepted` email, 2 in-app, 2 push skipped. Any later simulated worker run delivers the queued ones as `simulated`; they use local fake addresses only.
* **Invitations (qa-w10-mail-a):** 5 rows, 2 pending/unexpired; tokens only in the scratchpad (`guest-invite-token.txt`, `invite-*.json`). Accounts created through invitation acceptance: `guest` (confirmed by Auth admin to simulate the inbox), `noemail` (now `scheduler`), `ex1` linked; `unc` is an unconfirmed login on purpose.
* **Webhooks:** all 8 endpoints I registered in the final form are revoked (0 active); history left: 16 `succeeded`, 32 `failed` (20 after 8 attempts, 12 `secret_unavailable`), 2 `cancelled`; receiver log `hook-log.jsonl`. No API key, feed token or publication created.
* **Reconciliations:** `kept_separate` for the m1/Dup pair; the merged pairs were deleted by the merge itself.
* **Processes:** none left; private ports 4620–4629 free. Resend mode file `resend-mode` = `ok`.
* **Settings changed on fixtures only:** `m1` language en (A) / vi (B), `m2` vi, `m2` mention email on, org B renamed to the quoting string, `m4` membership restored after the deactivate/remove tests.
