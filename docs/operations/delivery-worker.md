# Running the delivery worker (F00 + F08)

The worker is the only thing that turns *due* work into sent messages. Since F08 one bounded run does, in order:

1. **Scheduled releases** — `run_due_release_batches` releases batches whose time has come, if every reviewed request is still exactly as reviewed and the person who scheduled it may still release them. Otherwise the batch is marked `failed` (`scope_changed` / `actor_not_permitted`) and nothing is released.
2. **Reminders** — `materialize_due_reminders` first recomputes plans queued by changes (answers, removals, archives, time/policy/preference/membership changes), then turns due reminder jobs into outbox deliveries, applying quiet hours and the per-person daily cap.
3. **Deliveries** — `claim_deliveries` leases due outbox rows (SKIP LOCKED), sends them, and records the outcome with retry/backoff, terminal `failed`, and `ambiguous` when a provider call may or may not have landed.

Several runs may overlap safely: every step locks with `FOR UPDATE SKIP LOCKED`, reminder effects are unique per job, and a release batch executes once (`supabase/tests/f08-concurrent-worker.sh`). A run that dies mid-way leaves leases that the next run recovers.

Without a schedule, nothing scheduled happens on time: scheduled releases wait, reminders are not sent, and retries wait until the next action on the same effect. Settings → Delivery warns administrators when `CRON_SECRET` is not configured.

## Entry points

| Hosting | Command / route | Notes |
|---|---|---|
| Serverless (current: Vercel API project, `backend/vercel.json`) | `GET` or `POST /api/v1/internal/deliveries/run?limit=50` with `Authorization: Bearer $CRON_SECRET` | 404 when `CRON_SECRET` is unset; 401 with a wrong secret. One run stays inside the 60 s function budget (claims once, ~45 s time budget). |
| Container / VM | `node backend/dist/worker.js` (one run) or `--drain` (repeat up to 20 runs while work remains) | `npm run worker -w @service-center/backend` in development. Needs the same env as the API. |

## Choosing a cadence

Reminders and scheduled releases are only as punctual as the schedule. Every 5 minutes is a reasonable default; every minute is fine (an idle run is a few cheap queries).

**Vercel** (checked 2026-10-18 against [Usage & Pricing for Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) and [Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)):

- Hobby: at most once per day, fired anywhere within the scheduled hour. Too coarse for reminders or scheduled releases — use a Pro plan or an external scheduler that calls the route.
- Pro: down to once per minute. Vercel sends `CRON_SECRET` as `Authorization: Bearer …` automatically.

The production schedule is **not configured in this repository** (a deployment decision). On Pro it would be a `crons` entry in `backend/vercel.json`:

```json
{ "crons": [{ "path": "/api/v1/internal/deliveries/run", "schedule": "*/5 * * * *" }] }
```

**Container cron** (any platform scheduler, Kubernetes CronJob, systemd timer):

```bash
node backend/dist/worker.js --drain
```

## Environment

| Variable | Purpose |
|---|---|
| `CRON_SECRET` (≥16 chars) | Enables and protects the HTTP worker route. |
| `DELIVERY_LINK_SECRET` (≥32 chars, optional) | Makes each delivery's response-link token deterministic, so a retried email has an identical body and Resend's idempotency key (`delivery-<id>`, kept by Resend for 24 h) drops a duplicate. Unset: a fresh token per attempt and no idempotency key. Keep it stable; rotating it only affects links minted afterwards. |
| `RESEND_API_KEY`, `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | Real providers. Without them outcomes are `simulated`, never reported as sent. |

## What is and is not guaranteed

- **Exactly one logical job/effect** per reminder intent (semantic key: kind, Person, plan, request version, policy@revision, occurrence, channel) and per release batch, even with concurrent runs.
- **Revalidated before sending:** membership/Person archive, release state, response state, request version, occurrence still in the future, effective policy and the Person's channel preferences (`reminder_job_is_current`). A reminder made obsolete after enqueue is recorded as `cancelled` / `reminder_obsolete`.
- **External delivery is at-least-once.** Resend deduplicates retries of one delivery within 24 h when `DELIVERY_LINK_SECRET` is set; a provider timeout is recorded as `ambiguous`, never as sent. An administrator retry after `ambiguous` may produce a second email outside that window. Push tickets are not polled for receipts; Resend webhooks are not consumed — "Accepted by provider" never means the person read it.
- **Link continuity:** a resend keeps the last provider-accepted link working until its replacement is accepted. Both links answer only their own exact request snapshot, and either one consumes the request.
- **Physical limits:** an email or push already delivered cannot be recalled when a request is withdrawn; its link then answers `stale`/`used` without showing plan details.

## Operating it

- Settings → Delivery (administrators): transport modes, pending and needs-attention counts, failed/uncertain list with Retry.
- Plans → Release review: scheduled releases and their outcome (including why one was not released).
- Plan → Teams → Reminders and delivery: per-Person/channel history and scheduled reminders.
- Logs never contain addresses, message bodies or link tokens (token paths are logged as `[token]`).
