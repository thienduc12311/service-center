# Feature plan: notify assigned people, and get their services into their calendars

**Branch**: `feature/assignment-notifications`

## What this feature is

When a scheduler assigns someone to a service, that person should be told by email,
should be able to confirm or decline in one tap from that email, should see the service
on the in-app calendar, and should be able to get it into Google / Apple / Outlook
Calendar.

## What already exists (do not rebuild)

Read these before writing anything — most of the domain model is already here.

| Capability | Where | State |
|---|---|---|
| Assignment lifecycle (`unconfirmed`/`confirmed`/`declined`, `notified_at`, `responded_at`) | `supabase/migrations/20260101000000_init.sql:205` | Done |
| Confirm/decline endpoint | `backend/src/routes/assignments.ts:202` | Done, session-only |
| Notify-on-assign and re-notify | `backend/src/routes/assignments.ts:126` (`notifyAssignments`) | Done, but sends nothing |
| In-app calendar feeding web + mobile, incl. `my_assignment_status` | `backend/src/routes/calendar.ts` | Done |
| Pluggable notification transport | `backend/src/services/notifications.ts` | Interface only — the sole implementation is `console.info` |
| Tokenized accept-link pattern to copy | `backend/src/services/invitations.ts`, `backend/src/routes/invitation-accept.ts` | Done, copy this shape |

**No email has ever been sent by this system.** No email provider is installed in any
`package.json`. Nothing anywhere generates iCalendar data. There is no cron, no queue, and
no `pg_cron`.

## Terminology (see `CONTEXT.md`)

- An **Invitation** is an offer to *join the organization*. It is not this feature.
- An **Assignment** is the record that a person is expected at a service. Asking them
  about it is **notifying**, never "inviting".
- Existing code violates this in user-facing strings — `assignments.ts:210` says "You can
  only respond to your own invitations", and `assignments.ts:126` says "Re-sends
  invitations". Fix those strings as part of this work.

## Decisions already made

Recorded as ADRs; read them, do not relitigate:

- `docs/adr/0001-tokenized-assignment-respond-links.md` — respond without logging in
- `docs/adr/0002-ics-attachment-and-subscription-feed.md` — attachment + feed, no OAuth
- `docs/adr/0003-publish-not-request-for-calendar-invites.md` — `METHOD:PUBLISH`

Plus: **Resend** is the email provider, chosen behind the existing transport interface.

## Further decisions (settled — build to these)

These were confirmed alongside the ADRs. They are decisions, not open questions.

1. **A decline emails the scheduler** who created the assignment
   (`assignments.created_by`). It does not build a "holes in the schedule" replacement view
   — that is a separate feature.
2. **Material changes re-notify only `confirmed` people.** A change to times or location
   re-sends; ordinary plan edits do not. People who never answered are not re-notified by
   this path.
3. **The feed carries confirmed and unconfirmed assignments, plus rehearsals.** Declined
   assignments disappear from it. Unconfirmed events are marked in the title.
4. **Reminders are out of scope.** They need scheduling infrastructure this repo does not
   have. Separate piece of work, with its own ADR.
5. **One email per person per plan**, covering all their positions, with one `.ics` and one
   respond link that answers all of them together. This is why the respond token is scoped
   to a person-plan pair rather than a single assignment — see ADR-0001.
6. **`From` is a verified sending domain; `Reply-To` is the scheduler**, so a volunteer
   replying "sorry, I'm away that week" reaches a human.

## Email sending is a placeholder for now

No sending domain has been set up yet, and this feature does **not** wait for one. Build it
so that email is optional:

- `RESEND_API_KEY` is an **optional** config value. When it is absent, the existing console
  transport stays installed and the app logs what it would have sent. This is already how
  `notifications.ts` is designed — `setNotificationTransport` exists for exactly this.
- Everything else in this plan — tokens, respond route, `.ics` generation, the feed — is
  fully testable and fully shippable without ever sending a real message.
- The step-by-step for verifying a domain (SPF, DKIM, MX, DMARC) is written up in
  `README.md` under **Email delivery**. Whoever owns the domain follows it later; setting
  two environment variables is the only thing that then changes.

Do not gate any other step on this.

---

# Implementation

Work top to bottom; each step compiles on its own.

## Step 1 — Migration

New file: `supabase/migrations/20260906000000_assignment_notifications.sql`.
Read `.agents/skills/supabase-postgres-best-practices/` first (CLAUDE.md rule 11).

### `assignment_notifications`

One row per email sent to one person about one plan. This is what the respond token
addresses (decision 5).

```sql
create table public.assignment_notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  plan_id          uuid not null references public.plans (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  email            text not null,
  token_hash       text not null unique,
  expires_at       timestamptz not null,
  sent_at          timestamptz,
  responded_at     timestamptz,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint assignment_notifications_expiry_valid check (expires_at > created_at)
);

-- "Resend" is unambiguous: at most one live token per person per plan.
create unique index assignment_notifications_one_live
  on public.assignment_notifications (plan_id, user_id)
  where responded_at is null;

create index assignment_notifications_plan_idx on public.assignment_notifications (plan_id);
create index assignment_notifications_user_idx on public.assignment_notifications (user_id);
```

`expires_at` should be the service date plus one day, not a fixed TTL — a link that dies
before the service it is asking about is a bug.

### `calendar_feed_tokens`

Per person, per organization, so it can be revoked and rotated without touching anything
else.

```sql
create table public.calendar_feed_tokens (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  token_hash       text not null unique,
  created_at       timestamptz not null default now(),
  last_used_at     timestamptz,
  revoked_at       timestamptz
);
create unique index calendar_feed_tokens_one_live
  on public.calendar_feed_tokens (organization_id, user_id)
  where revoked_at is null;
```

### `plan_times.ics_sequence`

iCalendar requires `SEQUENCE` to increment when an event changes, or subscribed clients
ignore the update (ADR-0002).

```sql
alter table public.plan_times add column ics_sequence int not null default 0;
```

Add a trigger that increments it when `starts_at` or `ends_at` changes. `plan_times` has
no `updated_at`, so there is no existing timestamp to derive this from.

### RLS (CLAUDE.md rule 13)

- `assignment_notifications`: enable RLS. Managers of the org may `select`. **No
  anonymous policy** — the public respond route uses `adminDb` and token possession, the
  same way `invitation-accept.ts` does.
- `calendar_feed_tokens`: enable RLS. A user may `select`/`insert`/`update` only rows
  where `user_id = auth.uid()` and they are an active member. Never expose `token_hash`
  through the API; return the raw token exactly once, at creation.
- Follow the `is_org_member(org)` / `is_org_admin(org)` helpers in
  `supabase/migrations/20260101000100_rls.sql`.

Then regenerate database types (CLAUDE.md rule 17) into
`packages/shared/src/types/database.ts`.

## Step 2 — iCalendar generation

New file: `backend/src/lib/ics.ts`. No dependency needed, but the format has real traps —
get these wrong and Outlook silently drops the event:

- Lines end `CRLF`, and must be folded at 75 octets (continuation lines start with a space).
- `,` `;` `\` and newlines must be escaped in text values.
- Emit all timestamps as UTC (`20260906T140000Z`). This avoids shipping a `VTIMEZONE`
  block entirely. The org's `timezone` column is for display, not for the file.
- `UID` must be stable across re-sends for the same event, or an update creates a
  duplicate instead of replacing. Use `plan-time-<plan_time_id>@<host>`.
- `METHOD:PUBLISH`, and **no `ORGANIZER` or `ATTENDEE` properties** — those are what make
  Gmail render its own RSVP buttons (ADR-0003).
- `SEQUENCE` from `plan_times.ics_sequence`.
- For a cancelled/declined event in the feed, omit it; for a withdrawn attachment, emit
  `STATUS:CANCELLED` with the same `UID` and a bumped `SEQUENCE`.

Give this module its own unit tests — it is pure and easy to test, and every bug in it is
invisible until a real calendar client rejects the file.

Define named types (CLAUDE.md rule 4), e.g. `IcsEvent`, `IcsCalendarOptions`.

## Step 3 — Email transport

`npm i resend -w @service-center/backend`.

- Add to `backend/src/config.ts`: `RESEND_API_KEY` (optional — absent means fall back to
  the console transport, which keeps local dev and tests dependency-free),
  `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`. Update `backend/.env.example`.
- New file `backend/src/services/email/resend-transport.ts` implementing the existing
  `NotificationTransport` and `PersonInvitationTransport` interfaces. **Do not change the
  interfaces' call sites** — `setNotificationTransport` already exists for exactly this.
- Wire it in at startup only when `RESEND_API_KEY` is present.
- Templates: keep them as typed functions returning `{ subject, html, text }`. Always send
  a text part. Put them in `backend/src/services/email/templates/`.
- `From: "<Organization Name> <MAIL_FROM_ADDRESS>"`, `Reply-To:` the scheduler's email.
- Rule 21: never log recipient addresses or token values.

## Step 4 — Rework notification to be per-person-per-plan

`backend/src/routes/assignments.ts`, function `notifyAssignments` (line 146).

Currently it maps one assignment to one email. Change it to group the assignment rows by
`user_id`, then per person: create an `assignment_notifications` row with a fresh token,
build one `.ics` from the plan's `plan_times`, and send one email listing every team and
position they hold on that plan.

Two existing defects to fix while you are in here:

1. **`responded_at` is never set.** The column exists (`init.sql:214`) and the respond
   endpoint at line 202 does not write it. Set it.
2. **People without a login are silently skipped.** The query selects the email from
   `profiles` via `assignments_user_id_fkey`, so anyone who has not accepted an
   organization invitation has no `profiles.email` and is dropped with no error and no
   warning. `people.email` exists and is likely populated. Decide deliberately: either
   fall back to `people.email`, or return the skipped people in the response so the
   scheduler can see who was not reached. **Do not leave it silent** (CLAUDE.md rule 20).

## Step 5 — Public respond route

New file: `backend/src/routes/assignment-respond.ts`, mounted in `backend/src/app.ts`
alongside the existing public route:

```ts
app.use('/api/v1/assignment-responses', assignmentRespondRouter);
```

Mirror `invitation-accept.ts` closely — it is the reference implementation for this shape.

- `GET /:token` → a preview: plan title, service date and time, location, the person's
  first name, their teams and positions, current status. Uses `adminDb`; token possession
  is the entire authorisation.
- `POST /:token/respond` → body validated by a new Zod schema in
  `packages/shared/src/schemas/assignment.ts`; sets the status on **every** assignment for
  that person on that plan, sets `responded_at` on both the assignments and the
  notification row.
- Reject expired, already-responded, and unknown tokens with the same distinct error codes
  the invitation route uses (`410` + a code, `404` for unknown).
- Return the *minimum* — this is an unauthenticated endpoint (ADR-0001). No other people's
  names, no full plan contents.
- **Apply a tighter rate limit to this router than the global one.** It is an
  unauthenticated write path and the global limit is 300/min.
- On decline, email the scheduler (decision 1).

Add a frontend route for it, e.g. `frontend/src/routes/respond.tsx`, reachable without a
session — check how `router.tsx` exempts `/accept-invite` and follow that.

## Step 6 — Subscription feed

New file: `backend/src/routes/calendar-feed.ts`, mounted public:

```ts
app.use('/api/v1/calendar-feed', calendarFeedRouter);
```

- `GET /:token.ics` → `text/calendar; charset=utf-8`, the person's assignments in that
  org where status is `confirmed` or `unconfirmed`, including rehearsal `plan_times`
  (decision 3). Prefix unconfirmed event titles with `?`.
- Bound the range — roughly 3 months back to 12 months forward. An unbounded feed grows
  without limit and calendar clients re-fetch the whole thing every poll.
- Update `last_used_at`. Reject revoked tokens with `404`, never `403`.
- Rate limit this router too, and set `Cache-Control: private, max-age=3600`.
- Token management endpoints on the authenticated side (`me` router is the natural home):
  `GET` current feed URL, `POST` to rotate. Return the raw token only at creation.
- Surface the URL in the frontend as both `https://` and `webcal://` — `webcal://` is what
  makes Apple Calendar subscribe on one click.

## Step 7 — Re-notify on material change

In `backend/src/services/plans.ts`, where `plan_times` are updated: if `starts_at`,
`ends_at`, or the plan's `location` changed, re-send to everyone `confirmed` on that plan
with a fresh `.ics` carrying the same `UID` and the bumped `SEQUENCE` (decision 2).

Guard against a scheduler dragging a time around repeatedly and firing a burst of emails.
Simplest workable guard: skip if that person was notified about this plan in the last few
minutes.

## Step 8 — Client

- `packages/shared`: add the new input/response types and Zod schemas, and add the new
  methods to `ServiceCenterApi` in `lib/api-client.ts`. Everything crossing the boundary
  goes here, not in `backend` or `frontend` (CLAUDE.md rule 4).
- `frontend`: the public respond page; a "Calendar sync" section in settings showing the
  feed URL with copy button and a rotate action; show `notified_at` / response state on the
  plan's assignment list so a scheduler can see who has not answered.
- `mobile`: the same respond deep link if it is cheap; otherwise the web page is a fine
  fallback and the mobile agenda already shows `my_assignment_status`.

## Testing

`npm run typecheck && npm run test` must pass at the end.

- `backend/src/lib/ics.test.ts` — folding, escaping, UTC formatting, `SEQUENCE`, stable `UID`.
  Assert against fixture strings; do not snapshot.
- Respond-token tests mirroring `backend/src/services/invitations.test.ts`: happy path,
  expired, already used, unknown, and that responding sets **all** the person's assignments
  on that plan.
- Feed tests: revoked token returns 404, declined assignments are absent, another person's
  assignments never appear.
- An RLS test that a member cannot read another member's `calendar_feed_tokens` row.

## Explicitly out of scope

- Reminders and any scheduled/cron work (decision 4)
- OAuth calendar write access (ADR-0002)
- Inbound iTIP / RSVP parsing (ADR-0003)
- A "holes in the schedule" replacement-finding view (decision 1)
- SMS, despite `people.phone` and `phone_carrier` existing

## Open questions deferred from design

- Should declining offer to create a `blockout` for those dates?
- What is the recovery path if someone leaks their feed URL — is rotation self-service
  only, or can an admin force it?
