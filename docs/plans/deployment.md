# Feature plan: deploy the web app and API, with CI/CD

Put the frontend and backend into production on free tiers, behind
`service.graceaogchurch.com` and `api.graceaogchurch.com`, with GitHub Actions
gating every pull request and publishing the artefacts that get released.

## What this feature is

There is currently no deployment of any kind and no CI. This adds both, plus the
small number of code changes that production forces (see "Code changes production
requires"). It does **not** add observability tooling, RLS tests, or a mobile
release pipeline — see "Explicitly out of scope".

## What already exists (do not rebuild)

- `npm run build` at the root already sequences `shared` → `backend` → `frontend`
  correctly. CI and the Dockerfile reuse it rather than reimplementing the order.
- `npm run typecheck` and `npm run test` already fan out across workspaces with
  `--if-present` and build `shared` first.
- `GET /health` (`backend/src/app.ts`) already exists as a liveness endpoint.
- `supabase/migrations/` holds nine ordered migrations and `npm run db:reset`
  replays them plus `seed.sql`. `npm run db:push` applies them to a linked project.
- `backend/src/config.ts` validates every environment variable through Zod, so a
  misconfigured deploy fails at boot rather than at first request.
- The graceful-shutdown handlers in `backend/src/index.ts` already handle SIGTERM
  with a 10-second escape hatch, which is exactly what a container platform needs.
- `.dockerignore` exists. There is no Dockerfile yet.
- The calendar feed already sends `Cache-Control: private, max-age=3600`, which is
  correct — the feed is per-person and must not be edge-cached.

## Terminology (see `CONTEXT.md`)

This feature adds no domain vocabulary; `CONTEXT.md` is unchanged. Two existing
terms matter operationally: a **Respond Link** is clicked from an email, and a
**Schedule Feed** is polled by a calendar application on its own timetable. Both
are unauthenticated and both are the requests most exposed to a cold start.

## Decisions already made

- The API is a persistent container, not serverless — ADR 0004.
- Cloudflare Pages + Render + GHCR, with Cloudflare-proxied DNS — ADR 0005.
- `service.graceaogchurch.com` (app), `api.graceaogchurch.com` (API).
- Two Supabase projects: one production, one staging. The free plan allows two, and
  paused projects do not count toward the limit.
- CI validates migrations; a human applies them.
- CI never holds the production service-role key.
- Rollback is code-only, by SHA-tagged image.

## Further decisions (settled — build to these)

- **CI builds everything.** Render does not build from source and Cloudflare Pages
  does not build from source. Both receive artefacts produced by Actions, so what
  ships is what CI verified, and there is one build system rather than three.
- **A release is deliberate.** Merging to `main` builds and publishes an image but
  does not deploy. You apply migrations, then trigger the deploy. This makes the
  safe ordering the only ordering.
- **Warmth is scheduled, 06:00–23:00 church-local**, via an external uptime monitor
  (UptimeRobot or BetterStack free tier) hitting `/health`. Not an Actions cron:
  free scheduled workflows are delayed or dropped under load, which is the opposite
  of what a keep-alive needs, and an external monitor also alerts.
- **A separate scheduled job keeps both Supabase projects awake.** `/health` stays a
  pure liveness probe and does not touch Postgres — a host restarting the service
  because the database hiccuped is a worse failure than the one being prevented.
- **Emails send from a subdomain**, `mail.graceaogchurch.com`, verified with Resend.
- **PR previews are frontend-only** and point at staging.

## Email sending needs a subdomain, not the apex

`graceaogchurch.com` already has exactly one SPF record —
`v=spf1 include:_spf.mx.cloudflare.net ~all` — and Cloudflare Email Routing on MX
for inbound mail. A domain may only have one SPF record, so verifying the apex with
Resend would mean hand-editing the record the church's inbound mail depends on,
where a mistake silently breaks receiving email. Verifying
`mail.graceaogchurch.com` instead gives Resend its own SPF/DKIM/DMARC namespace and
touches nothing that exists. It also isolates transactional sending reputation from
the church's own mail.

`MAIL_FROM_ADDRESS=notifications@mail.graceaogchurch.com` with
`MAIL_FROM_NAME=Grace AOG Church` — the recipient is a volunteer being told they are
expected on Sunday, and should see their church's name in the inbox, not the name of
the software.

# Implementation

## Step 1 — Code changes production requires

Four changes, each with a reason production forces it. All are small; two have hard
deadlines.

### 1a. Decouple the iCalendar UID from the API hostname (do this first)

`backend/src/routes/calendar-feed.ts` builds its event UID as:

```js
uid: `plan-time-${time.id}@${new URL(config.API_URL).host}`,
```

Calendar clients key events off UID, so if `API_URL` ever changes, every event in every subscriber's
calendar becomes a *different* event: the old ones orphan themselves in place and
the new ones arrive as duplicates, with no remedy available to us. A UID's only job
is to be globally unique and stable for ever, and deriving it from a mutable config
value is the one thing it must not do.

Replace the host with a fixed literal. **This has a hard expiry: it is free today
and impossible after the first Schedule Feed subscription.**

### 1b. Trust Cloudflare's proxy (before the orange cloud goes on)

Behind a proxy, Express sees Cloudflare's IP on every request, so
`express-rate-limit` would bucket the entire internet into one counter and the
300/minute limit would throttle every user at once. Configure `trust proxy` for
Cloudflare in `backend/src/app.ts`. **Must land before `api.` is proxied.**

### 1c. Allow preview origins by suffix

`app.ts` matches CORS origins by exact string (`config.corsOrigins.includes(origin)`),
and Cloudflare Pages gives each preview deployment a new `<hash>.<project>.pages.dev`
hostname, which can never be pre-allowlisted. Add a `CORS_ORIGIN_SUFFIXES` env var
(comma-separated, defaulting to empty) checked alongside the exact list. An explicit
suffix list rather than a regex, so what is permitted stays readable in the
environment config.

Note the security weight here is low: `app.ts` already allows requests with no
`Origin` header at all, so CORS is not the boundary — JWT plus RLS is. CORS only
stops a browser on another origin from using a logged-in session.

### 1d. Correct the stale claims in `CLAUDE.md`

It states Node `20` (actual: `engines.node` is `>=26.8.1`) and that checks run via
`pnpm -r` (actual: npm workspaces, `npm run <script> --workspaces`). CI must encode
the real values, so the contributor guide cannot keep contradicting it.

## Step 2 — Dockerfile

Multi-stage, at the repo root, because the workspace build order has to happen
inside the image:

1. Base on a pinned `node:26-alpine` (or the closest published tag ≥ 26.8.1).
   Pinning the base image is why the Dockerfile exists at all — Render's buildpack
   support for Node 26 is unverified, and pinning makes the question moot.
2. Copy the root `package.json`, `package-lock.json`, and the `package.json` of
   `packages/shared` and `backend`; run `npm ci` at the root so workspace linking
   resolves.
3. Build `shared`, then `backend`.
4. Second stage: production dependencies plus `dist` only. `CMD ["node", "dist/index.js"]`.
5. `EXPOSE` nothing fixed — the app reads `PORT`, which Render injects.

Do not copy `frontend` or `mobile` into the image. Extend `.dockerignore` to exclude
them along with `node_modules` and `.git`.

## Step 3 — CI workflow (`.github/workflows/ci.yml`)

Runs on every pull request and on pushes to `main`. Jobs:

- **check** — `npm ci`, then `npm run typecheck`, `npm run test`, `npm run build`.
  `build` is included separately because `frontend`'s build runs `tsc -b` plus
  `vite build`, a different code path from its `typecheck`. Mobile's typecheck is
  included via the root fan-out; it costs seconds.
- **migrations** — install the Supabase CLI, `supabase start`, `supabase db reset`.
  This replays all nine migrations plus `seed.sql` from scratch against real
  Postgres, which proves the chain applies and re-runs every RLS policy.

Note honestly what this proves: that migrations **apply**, not that RLS is
**correct**. See "Explicitly out of scope".

Pin Node in the workflow to the same version as the Dockerfile base image.

## Step 4 — Publish workflow (`.github/workflows/publish.yml`)

On push to `main`, after **check** passes: build the Dockerfile and push to GHCR
tagged with both the commit SHA and `latest`. Authenticate with the built-in
`GITHUB_TOKEN` — no additional secret. The SHA tag is what makes rollback
"deploy this tag" rather than "hope Render kept the previous build".

This workflow does **not** deploy. That is Step 6.

## Step 5 — Frontend deploy workflow

On push to `main`: build, then publish `frontend/dist` with `wrangler pages deploy`.
On pull requests: the same, as a preview deployment, built against **staging**
Supabase values.

Two things to get right:

- **Ship no top-level `404.html`.** Cloudflare Pages does not support a
  `/* /index.html 200` catch-all in `_redirects`; instead, a project *without* a
  top-level `404.html` routes unmatched paths to `/`, which is what makes React
  Router deep links work. `frontend/public/` currently holds only `.well-known`, so
  this works today by absence. Adding a custom 404 page later would silently break
  every client-side route — worth a comment in `frontend/public/`.
- Vite bakes `VITE_*` in at **build** time, so preview builds need the staging
  values present as build-time secrets, not runtime config.

## Step 6 — Render service

Deploy the GHCR image (not a git-connected build). Configure:

- Custom domain `api.graceaogchurch.com`, so Render matches the `Host` header
  Cloudflare forwards.
- Health check path `/health`.
- Environment: `NODE_ENV=production`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
  `APP_URL=https://service.graceaogchurch.com`,
  `API_URL=https://api.graceaogchurch.com`,
  `CORS_ORIGINS=https://service.graceaogchurch.com`, `OCR_PROVIDER=gemini`,
  `GEMINI_API_KEY`, `AI_IMPORT_DAILY_LIMIT=10`, `RESEND_API_KEY`,
  `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`.
- Do **not** set `PORT`; Render injects it and `config.ts` reads it.

Releases are triggered by hand (deploy hook or `render deploys create`), after
migrations are applied.

## Step 7 — DNS and TLS

At Cloudflare:

- `service` → CNAME to the Pages project, proxied.
- `api` → CNAME to the Render service hostname, **proxied (orange)**. Only after
  step 1b has shipped.
- `mail` → the SPF/DKIM/DMARC records Resend issues. Do not touch the apex records:
  the apex serves the church's site from Vercel and carries the Cloudflare Email
  Routing SPF and MX.

## Step 8 — Keeping things awake

- External uptime monitor on `https://api.graceaogchurch.com/health`, 06:00–23:00
  church-local. This is load-bearing, not a nicety: without it a Respond Link
  clicked from an email can stall for about a minute.
- A scheduled job issuing a trivial query against **both** Supabase projects, at
  least a few times a week. Supabase pauses a free project after seven days of low
  activity, and un-pausing is a manual dashboard action. A paused staging project
  breaks CI; a paused production project breaks the app.

## Testing

- CI itself is the test for steps 3–5: open a pull request and confirm every gate
  runs and that a preview deploy appears and can reach staging.
- Verify a deep link (e.g. `/plans/<id>`) loads on the deployed SPA, not a 404 —
  this is the implicit Pages behaviour and deserves an explicit check.
- Verify `api.graceaogchurch.com/health` responds through the Cloudflare proxy.
- After 1b, verify the rate limiter sees distinct client IPs rather than
  Cloudflare's — a wrong `trust proxy` setting fails silently and looks fine.
- Send one real notification to a real inbox and confirm SPF/DKIM pass and the
  Respond Link resolves.
- Subscribe a calendar client to a Schedule Feed and confirm events appear, then
  redeploy and confirm they are **not** duplicated (this is what 1a protects).

## Explicitly out of scope

- **Error tracking.** Production errors will reach Render's log stream and nothing
  else. This is the weakest part of the plan and is knowingly accepted: it means the
  first production bug is found by a volunteer reporting it, not by us. Sentry (or
  similar) should be the next piece of work, not part of this one.
- **RLS policy tests.** CI proves migrations apply, not that policies are correct.
  Since RLS is the primary access-control mechanism, this is the largest untested
  surface in the project — it is out of scope here but should not stay out of scope.
- **Mobile releases.** `mobile` ships through Expo and app stores. CI typechecks it
  to stop it rotting; its production API URL belongs to whatever release process is
  set up for it, and guessing at that now would leave a half-configured client
  nobody tests.
- Down-migrations, horizontal scaling, a job queue, and a shared-store rate limiter
  (all ADR 0004 / 0005).

## Open questions deferred from design

- **When to stop accepting cold starts.** Overnight cold starts are acceptable with
  no real users. Revisit the moment an organization actually subscribes a Schedule
  Feed, since calendar clients refresh on their own timetable and cannot be told to
  retry later.
- **When to split the job queue out.** ADR 0004 keeps the API single-process. The
  trigger to revisit is either wanting a second instance or wanting imports to
  survive a container replacement.
- **Render's free-tier egress is 5 GB/month.** Small for a media-heavy app, ample for
  JSON and iCalendar. Worth watching once feeds are being polled, not worth
  designing around now.
