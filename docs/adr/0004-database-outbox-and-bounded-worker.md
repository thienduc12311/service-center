# Notifications go through a database outbox and a bounded, leased worker

An action that should reach people — scheduling, a reminder, an answer a scheduler must hear
about — records one `delivery_effects` row in the same transaction as the change, expanded
there into one `deliveries` row per recipient per channel (in-app, push, email). Providers are
contacted only after commit, by a worker that claims due rows with `FOR UPDATE SKIP LOCKED` and
a lease. The API kicks the worker for its own effect straight away, so people still see outcomes
in the response; anything left over (a crash, an outage, a retry) waits for the next worker run.

The worker is a bounded function with three entry points that share one implementation: the
in-request kick, `GET|POST /api/v1/internal/deliveries/run` with `Authorization: Bearer
$CRON_SECRET` (the shape Vercel Cron calls), and `node backend/dist/worker.js` for container
cron. We deliberately did not add an in-process timer: Vercel functions stop when the response
ends, so a timer there would look durable and not be.

A lease that expires before the provider call is re-queued; one that expires after the call
began becomes `ambiguous` and is never re-sent automatically. Neither Resend (a respond link is
minted per attempt, so the payload differs and its idempotency keys cannot be used) nor Expo
lets us ask whether that call landed. `simulated` and `provider_accepted` are separate outcomes,
and no outcome claims a person saw a message.

Wiring a production schedule (a `crons` entry, or the platform's scheduler for the container)
is a deployment decision, not part of this change.
