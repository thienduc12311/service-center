# Feature plan: email when you're asked, when a plan is published, and when you're @mentioned

**Branch**: `feature/email-notifications` (follow-ups: `feature/delivery-worker-cron`, `feature/invitation-outbox`)

## What this feature is

People should get an email when:

1. **they are scheduled onto a plan**: the existing assignment request, now sent when the plan
   is published (ADR-0006);
2. **a plan they are on is published**: the same request, for everyone released and not yet
   notified (ADR-0006);
3. **someone @mentions them** in a team/plan chat or a plan item discussion (ADR-0007).

Production has `RESEND_API_KEY` and a verified `MAIL_FROM_ADDRESS`. Read `CONTEXT.md` (Publish,
Mention Email, Notifying vs Invitation) and ADRs 0001–0007 before writing code.

## Where things stand (review, 2026-11-21)

| Area | State | Where |
|---|---|---|
| Assignment request email | Works, but only for `released` + `notify`; sent even on draft plans | `private.enqueue_assignment_requests` (`20261020000100_f04_assigned_times.sql:1061`), `requestEmail` in `backend/src/services/delivery-dispatch.ts` |
| Plan publish | Fires the `plan.published` webhook only; no email | `private.plan_webhook_events` (`20261127000001_w8_plan_published_on_insert.sql`) |
| Chat mentions | In-app + push only; the dispatcher skips email as `channel_not_used` | `post_conversation_message` (`20261115000000_account_deletion_and_user_blocks.sql`), `deliverFeedOrPush` |
| Item comment mentions | In-app + push only | `post_item_comment` (same migration) |
| Staffing matrix | `notify` defaults to `false` | `StaffingMatrixPage.tsx:46`, `schemas/staffing-matrix.ts:34,49` |
| Copy plan / from template | Plans start as `draft`; nobody notified | `routes/plans.ts:217,230` |
| Scheduled worker | None in production: retries, scheduled releases and reminders never run | `backend/vercel.json` has no `crons`; ADR-0004 |
| `CRON_SECRET=` (empty) | **Crashes the API at boot** (`z.string().min(16).optional()` rejects `""`) | `backend/src/config.ts:62` |
| Church invitations | Sent directly, not via the outbox: no retry, no delivery row | `services/person-invitations.ts:103` |
| Draft visibility | Draft plans are readable by people on them; status only affects public sharing and webhooks | plans RLS |
| Mobile | Can schedule (`notify: true`) but has no Publish action | `mobile/app/plan/[id].tsx:181` |

## Decisions (settled — build to these)

Publish (ADR-0006): draft plans send no assignment email of any kind, checked at dispatch;
archived never. The server ignores `notify` on a draft. Publishing asks everyone released with
`notified_at is null`, plan-wide regardless of the publisher's team scope, replies to each
response owner. Re-publishing never re-asks. Past plans (service date in org time zone) send
nothing. Publish confirmation shows who will be emailed / has no address, "Notify people" ticked
by default. Prepared stays prepared; releasing on a draft sends nothing until publish; a
multi-plan release omits draft plans. No data migration for existing drafts; a draft banner for
schedulers instead. Staffing matrix `notify` defaults to `true`.

Mentions (ADR-0007): mentions only, chat and item discussions, one template. 10-minute delay,
cancelled if seen/muted/no longer eligible; collapsed per person per thread while queued. Author,
place, 280-char excerpt, sign-in link; no email for `no_login`. Opt-out
`person_reminder_preferences.mention_email` (default true); UI section renamed "Notification
preferences". Without a configured worker the delay is 0, not the email.

Operations: an optional secret can never stop the API from starting — `CRON_SECRET`,
`DELIVERY_LINK_SECRET` and `INTEGRATION_SECRET_KEY` that are empty or invalid count as unset,
with a startup warning that never contains the value. The scheduled worker (Supabase `pg_cron` +
`pg_net`, every minute) is **deferred** to `feature/delivery-worker-cron`: until then production
runs without `CRON_SECRET`, so mention emails go out immediately (ADR-0007) and reminders,
scheduled releases and retries stay paused. Settings lists what is paused. All new strings in
English and Vietnamese.

---

# Implementation

Three commits on one branch, each deployable on its own. Read
`.agents/skills/supabase-postgres-best-practices/` before any migration (CLAUDE.md rule 11);
regenerate `packages/shared/src/types/database.ts` after each schema change (rule 17).

## Commit 1 — Optional secrets never stop the API; Settings warning

### Config (`backend/src/config.ts`, `backend/src/lib/optional-secret.ts`) — done

- `optionalSecret(rule, warn)`: empty → unset; a value that breaks its rule → unset plus
  `[config] <NAME> ignored: must be <requirement>. Features that need it stay off.` Applied to
  `CRON_SECRET` (≥ 16 chars), `DELIVERY_LINK_SECRET` (≥ 32 chars) and `INTEGRATION_SECRET_KEY`
  (base64 of 32 bytes), which each already had a defined "unset" behavior. Previously an empty
  value in any of them (e.g. `CRON_SECRET=` from `.env.example`) threw at import and took down
  the whole API. Required settings (`SUPABASE_*`) still fail fast.
- Unit tests in `lib/optional-secret.test.ts`.

### Settings (`frontend/src/components/settings/DeliverySettings.tsx`, mobile equivalent)

When `worker_configured` is false, list what is paused: reminders, scheduled releases, retries of
failed sends; and say mention emails go out immediately instead of after 10 minutes.
Administrators only, as today. en + vi strings.

## Commit 2 — Draft plans are quiet; publishing notifies

### Migration `20261129000010_publish_notifies.sql`

- `private.enqueue_assignment_requests`: when the plan is not `published`, return `null` and
  queue nothing. Check every caller (`grep -n enqueue_assignment_requests supabase/migrations`
  for the latest definitions: scheduling, attendance changes, time changes, templates, the
  staffing matrix) handles a null effect as "nothing sent", and that `deliverEffectNow(null)`
  stays a no-op (it is today).
- `private.enqueue_release_batch_requests`: only plans with status `published` get a section and
  a snapshot; rows on draft plans are released silently.
- Reminder materialization (`private.desired_plan_reminders` / `recompute_plan_reminders`): no
  jobs for non-published plans; a status change recomputes the plan's reminders (trigger on
  `update of status`).
- New `public.publish_plan_notify(p_plan uuid, p_notify boolean, p_effect_key text)` returning
  `(plan public.plans, effect_id uuid)`: checks `can_edit_plan`, sets `status = 'published'`,
  and when `p_notify` and the service date (org time zone) is today or later, enqueues an
  `assignment_request` effect for every assignment on the plan with `visibility = 'released'`,
  `status <> 'declined'`, `notified_at is null`, skipping the per-team
  `can_schedule_on_plan` filter (plan-level act, ADR-0006). Idempotent on `p_effect_key`.
- `public.publish_plan_notify_preview(p_plan uuid)`: counts who would be emailed and who has no
  address, via `person_delivery_readiness`.

### Dispatcher (`backend/src/services/delivery-dispatch.ts`)

- `DispatchPlan` gains `status`; `loadPlan(s)` selects it.
- For `assignment_request`, `assignment_reminder`, `service_reminder` and a time-change
  re-notify: cancel with a new `DeliveryErrorCode` `plan_not_published` when the plan is not
  published. Add the code to the shared delivery types and the outcome labels (en + vi).
- Unit tests next to `delivery-dispatch.test.ts`: draft → cancelled; published → sent; archived
  → cancelled.

### API

- `PATCH /plans/:id` with `status: 'published'` goes through `publish_plan_notify` (keep the route; add
  optional `notify` (default `true`) and `idempotency_key` to the Zod schema in
  `packages/shared/src/schemas/plan.ts`). Deliver the effect with `deliverEffectNow` and return
  the `AssignmentNotificationSendResult` alongside the plan, like notify does today.
- `GET /plans/:id/publish-preview` → `{ will_notify, no_email: string[] }`.
- `POST /plans/:id/assignments` and `POST /plans/:id/notify` on a draft plan: no error, nothing
  sent; the response carries `held_until_publish: true` so clients can say so.
- Route tests: assign on draft sends nothing; publish notifies exactly the unnotified released
  people; re-publish sends nothing; a past plan sends nothing; a plan editor without scheduling
  rights on a team still notifies that team.

### Web

- `PlanDetailPage.tsx` / `PlanWorkspaceHeader.tsx`: Publish opens a confirmation ("Publishing will
  email N people", no-address list, "Notify people" ticked); show `DeliveryOutcomeNotice`
  afterwards.
- `SchedulePeopleModal.tsx` (and assignment-times modal): on a draft plan, replace the notify
  checkbox with "People will be notified when this plan is published".
- Draft banner on the plan page for schedulers: "Draft — people you schedule won't be notified
  until you publish".
- `StaffingMatrixPage.tsx:46` and `schemas/staffing-matrix.ts:34,49`: `notify` defaults to `true`.

### Mobile

- `mobile/app/plan/[id].tsx`: Publish / Unpublish action for plan editors with the same
  confirmation; draft note in the schedule sheet; draft banner.

## Commit 3 — Mention emails

### Migration `20261129000100_mention_emails.sql`

- `alter table public.person_reminder_preferences add column mention_email boolean not null default true;`
- New `delivery_template` value is not needed: mention emails are `email` deliveries on the
  existing `conversation_message` / `item_comment` effects.
- `post_conversation_message` and `post_item_comment` gain `p_mention_email_delay_seconds int
  default 600`. For each mention with resolution `notified`, whose person has an email address
  (profile or person), and `coalesce(mention_email, true)`: insert an `email` delivery with
  `next_attempt_at = now() + delay`, **unless** a queued `email` delivery already exists for the
  same person and the same conversation / plan item (collapse; that delivery picks up the newer
  mention at send time).
- Index to support the collapse lookup on `deliveries (recipient_person_id, channel, status)`
  where `status = 'queued'` if the query plan needs it (check `EXPLAIN`).

### Backend

- `backend/src/services/messages.ts` / discussions: pass
  `p_mention_email_delay_seconds: config.CRON_SECRET ? 600 : 0` (the same test `deliveryTransportStatus` uses for `worker_configured`).
- `notifications.ts`: `MentionEmailNotification` (`to`, `locale`, `personName`, `organizationName`,
  `authorName`, `place`, `excerpt`, `moreCount`, `threadUrl`) and `isMentionEmail`.
- `delivery-dispatch.ts`: in `dispatchConversationMessage` / `dispatchItemComment`, handle
  `channel === 'email'` before `deliverFeedOrPush`: recheck eligibility (already done), then
  cancel `already_read` if seen (chat: `last_read_at >= message.created_at` or the mention's feed
  row `read_at` set; item: feed row `read_at` set), cancel `conversation_muted` if muted.
  Collapse: count mentions of this person in this thread since the last sent mention email,
  use the latest as the excerpt and the rest as `moreCount`. Idempotency key
  `delivery-${job.id}`.
- `email/templates/mention.ts` (+ test), en + vi, and a branch in `resend-transport.ts`
  (`from` = organization name, no reply-to).
- New `DeliveryErrorCode` `already_read`; shared labels en + vi.
- Tests: mention → email queued at +600 s; worker unconfigured → +0; read before due →
  cancelled; second mention while queued → no second row, `moreCount` 1; `no_login` → no email;
  opt-out → no email; muted → cancelled.

### Web + mobile

- Settings → "Notification preferences": add "Email me when I'm @mentioned".

## Follow-up branch — `feature/delivery-worker-cron`

Deferred so a migration can't block a deploy: `pg_cron`/`pg_net` must be enabled on the project
and the Vault secrets created by hand, and a failing `db push` would hold up everything else.

- Migration `…_delivery_worker_cron.sql`: `create extension if not exists pg_cron` / `pg_net`;
  `private.run_delivery_worker()` (security definer, `search_path = ''`, revoked from `public,
  anon, authenticated`) reads `delivery_worker_url` and `delivery_worker_secret` from
  `vault.decrypted_secrets` and **returns without doing anything if either is missing**;
  otherwise `net.http_post` with `Authorization: Bearer <secret>`. Schedule
  `cron.schedule('delivery-worker', '* * * * *', …)` idempotently.
- README **Email delivery**: set `CRON_SECRET` on the backend, `vault.create_secret` the URL
  (`<api>/api/v1/internal/deliveries/run`) and the secret, then check `cron.job_run_details` /
  `net._http_response`. With no `CRON_SECRET` on the API the call is a harmless 404.
- Once it runs, mention emails switch to the 10-minute delay automatically, since the delay follows `config.CRON_SECRET`.

## Follow-up branch — `feature/invitation-outbox`

Move `issuePersonInvitation`'s email into the outbox (a `person_invitation` effect + `email`
delivery), so it is retried, appears in Deliveries, and gets an outcome. Keep `inviteUrl` in the
response for manual sharing.

## Rollout

1. Deploy commit 1. No environment change needed; check the logs for `[config] … ignored`
   warnings.
2. Deploy commit 2 with release notes: "Draft plans no longer email people. Publish a plan to
   notify everyone on it." Schedulers see the draft banner on existing drafts.
3. Deploy commit 3. Mention emails go out immediately until the worker cron lands.
4. Later, `feature/delivery-worker-cron`: set `CRON_SECRET`, create the Vault secrets, confirm
   runs and that Settings no longer warns.

## As built (2026-11-21)

Implemented on `feature/email-notifications`. Differences from the plan above:

- **Function names.** `public.publish_plan` already exists (F16 public sharing), so the RPCs are
  `publish_plan_notify` / `publish_plan_notify_preview`.
- **Preview address check.** The preview repeats `person_delivery_readiness`'s address test inline,
  because a plan-only editor holds neither `scheduling.manage` nor `people.view_private`. Only
  names leave the function.
- **Post functions dropped and recreated.** `post_conversation_message` / `post_item_comment` gained
  `p_mention_email_delay_seconds`, so the old signatures were dropped to avoid two PostgREST
  overloads.
- **Collapse counts unread mentions only.** `mention_email_batch` returns the person's mentions in the
  thread since their last sent mention email that are still unread, so reading the first mention
  doesn't cancel a later collapsed one.
- **Opt-out while queued** skips the email as `channel_not_used`.
- **SQL fixture.** `supabase/tests/delivery-outbox.sql` now publishes its fixture plan, since it
  scheduled on a draft. `supabase/tests/f09-notes-messages-chat.sql` expects the extra email
  delivery for mentions.

Known limitations:

- "Already asked" is `notified_at` (set only by an accepted email) **or** a request delivery that
  reached the person (`provider_accepted`, `simulated` or in-app `delivered`) —
  `private.assignment_was_asked`. So people without an email address, and simulated sends, are not
  asked again on unpublish → publish (found in QA).
- The web schedule dialog has no notify checkbox on a published plan; it always notifies (unchanged
  from before this branch).
- A retry of a mention email after a newer mention changed its body can end `ambiguous
  provider_duplicate_key` (Resend's idempotency key). A mention landing while an earlier email is
  mid-send can be counted twice.
- `packages/shared/src/types/database.ts` was edited by hand, not regenerated.
