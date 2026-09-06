# Service Center

Service Center is a multi-tenant worship-service planning application. Organizations can build reusable service plans, arrange songs and chord charts, schedule teams, track responses and conflicts, manage blockouts, and import chord sheets. The repository contains a React web app, an Express API, an Expo mobile app, shared TypeScript contracts, and a Supabase/Postgres schema with row-level security.

## Architecture

- `frontend` — React 19, Vite, TanStack Query, and Tailwind CSS web client.
- `backend` — Express 5 API. Authenticated requests use the caller's Supabase token so Postgres RLS remains the primary tenant boundary.
- `mobile` — Expo/React Native client using the same API and shared contracts.
- `packages/shared` — Zod schemas, database/domain types, API client, and ChordPro helpers.
- `supabase` — local Supabase configuration, ordered migrations, RLS policies, and seed data.

## Requirements

- Node.js 26.8.1 or newer
- npm 11.19.0 or newer
- Supabase CLI and Docker Desktop for the local database
- Docker with Compose for the containerized web/API option

## Run locally

Install dependencies and start Supabase:

```bash
npm install
npm run db:start
```

Copy the example environment files and replace the placeholder keys with the local values printed by `supabase start`:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Run the web app and API together:

```bash
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:4000`, and Supabase Studio is available at `http://localhost:54323`.

To run the mobile app instead, keep Supabase and the API running and use:

```bash
npm run dev:mobile
```

## Run with Docker Compose

Start local Supabase first. In `backend/.env`, use `http://host.docker.internal:54321` for `SUPABASE_URL` so the API container can reach the host service. Then export the public frontend build values and start the containers:

```bash
export VITE_SUPABASE_URL=http://127.0.0.1:54321
export VITE_SUPABASE_ANON_KEY=your-local-anon-key
docker compose up --build
```

Open `http://localhost:8080`. The browser reaches Supabase on the host and the API at `http://localhost:4000`.

The frontend image is a static Nginx build; `VITE_*` values are embedded at image build time. Rebuild the image after changing them. Keep service-role credentials only in `backend/.env`; never expose them as frontend build arguments.

Individual images can also be built from the repository root:

```bash
docker build -f backend/Dockerfile -t service-center-backend .
docker build -f frontend/Dockerfile \
  --build-arg VITE_SUPABASE_URL=http://127.0.0.1:54321 \
  --build-arg VITE_SUPABASE_ANON_KEY=your-local-anon-key \
  --build-arg VITE_API_URL=http://localhost:4000 \
  -t service-center-frontend .
```

## Database workflow

```bash
npm run db:reset          # apply migrations and seed local data
npm run db:diff -- name   # generate a migration from local schema changes
npm run db:push           # apply pending migrations to a linked project
npm run db:stop
```

Schema changes belong in new files under `supabase/migrations`. Every table is evaluated for RLS, tenant filtering, constraints, and indexes; do not rely on API checks as a replacement for database authorization.

## Quality checks

```bash
npm run build
npm run typecheck
npm test
```

For focused backend work:

```bash
npm test -w @service-center/backend
npm run test:watch -w @service-center/backend
```

## Environment variables

Backend variables are documented in `backend/.env.example`. Required secrets are `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; the latter must never be committed or sent to a client.

Frontend variables are documented in `frontend/.env.example`. Every frontend value is public because Vite includes it in the browser bundle.

## Email delivery

Transactional email (assignment notifications, organization invitations) goes out through
[Resend](https://resend.com). Delivery is behind a pluggable transport in
`backend/src/services/notifications.ts`, so email is **optional in development**: if
`RESEND_API_KEY` is unset the app falls back to a console transport that logs what it
would have sent. Nothing breaks, and no external account is needed to run locally.

Set these in `backend/.env` when you do want real email:

| Variable | Example | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_...` | Unset = log to console instead of sending |
| `MAIL_FROM_ADDRESS` | `notifications@example.org` | Must be on a domain verified with Resend |
| `MAIL_FROM_NAME` | `Service Center` | Display name; the organization name is used when one is in scope |

### Verifying a sending domain (SPF and DKIM)

**Status: not yet done — no sending domain is configured for this project.** Until these
steps are completed, leave `RESEND_API_KEY` unset and email will be logged rather than
sent. Resend will not deliver mail from an unverified domain, and mail sent from one that
skips these records is rejected or filed as spam by Gmail and Outlook.

You need a domain you control and access to its DNS records.

1. **Pick a subdomain to send from.** Use something like `mail.example.org` or
   `notifications.example.org` rather than your root domain. Sending from a subdomain means
   a future deliverability problem cannot damage the reputation of your main domain's
   email.

2. **Add the domain in Resend.** Dashboard → **Domains** → **Add Domain**, enter the
   subdomain, and pick the region closest to your users. Resend then shows you three DNS
   records to create.

3. **Add the DKIM record.** A `TXT` record, typically at name `resend._domainkey`, holding
   a long public key. This is what lets receiving servers verify the message was really
   sent by you and was not altered in transit. Copy the value exactly — a truncated key
   fails silently.

4. **Add the SPF record.** A `TXT` record at the subdomain itself, with a value like
   `v=spf1 include:amazonses.com ~all`. This declares which servers may send mail using
   your domain.

   If a `TXT` record already exists for that exact name, **merge the `include:` into it
   rather than adding a second record.** A domain with two SPF records fails SPF entirely —
   this is the single most common mistake here.

5. **Add the MX record for bounces**, as shown in the Resend dashboard (usually
   `feedback-smtp.<region>.amazonses.com` at priority 10). This is how bounces and
   complaints get reported back, which is what keeps your sending reputation healthy.

6. **Wait for verification.** Click **Verify** in Resend. DNS propagation usually takes
   minutes but can take up to 48 hours. Do not change the records while it is pending.

7. **Set the environment variables.** Put the API key in `RESEND_API_KEY` and set
   `MAIL_FROM_ADDRESS` to an address on the now-verified subdomain. The API key is a
   secret: keep it out of git, and never expose it to the frontend.

8. **Send a test**, then check the message in Gmail via **Show original**. You want
   `SPF: PASS` and `DKIM: PASS`.

**Recommended once mail is flowing:** add a DMARC record — a `TXT` record at `_dmarc.<your
domain>` with `v=DMARC1; p=none; rua=mailto:you@example.org`. `p=none` changes nothing
about delivery; it just asks receiving servers to report who is sending as your domain, so
you can see problems before tightening the policy later.

## Engineering guidance

Read `SKILL.md` and `CLAUDE.md` before contributing. Cross-package contracts belong in `packages/shared`, database access should remain RLS-scoped by default, and new features should be developed on focused `feature/*` branches.
