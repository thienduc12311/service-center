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

## Engineering guidance

Read `SKILL.md` and `CLAUDE.md` before contributing. Cross-package contracts belong in `packages/shared`, database access should remain RLS-scoped by default, and new features should be developed on focused `feature/*` branches.
