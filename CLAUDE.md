# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It also defines the engineering rules that must be followed when making changes to this project.

These instructions apply to all new features, bug fixes, refactors, backend changes, and database schema changes unless explicitly overridden by the user.

---

## Commands

This is an npm workspace (Node `20`). Packages: `backend`, `frontend`, `mobile`, `packages/shared`.

`@service-center/shared` is consumed as compiled JS by both `backend` and `frontend` (not built on the fly by their dev servers), so build it first — the root scripts below do this automatically.

```bash
# Install
npm install

# Local Supabase (Postgres + Auth + Storage + Studio on :54323)
npm run db:start          # supabase start
npm run db:reset          # re-applies migrations + supabase/seed.sql
npm run db:diff -- <name> # generate a migration from schema changes made in Studio
npm run db:stop

# Dev servers (each builds shared first)
npm run dev               # backend (:4000) + frontend (:5173) concurrently
npm run dev:backend
npm run dev:web
npm run dev:mobile        # expo, from mobile/app

# Whole-workspace checks (run per-package via `pnpm -r`)
npm run typecheck
npm run test

# Single package / single test
npm test -w @service-center/backend
npm run test:watch -w @service-center/backend
npm exec -w @service-center/backend vitest run src/routes/plans.test.ts
npm test -w @service-center/shared

npm run build             # shared -> backend -> frontend, in that order
```

Backend env comes from `backend/.env` (copy `backend/.env.example`; `SUPABASE_*` keys come from `npm run db:start` output). Frontend env comes from `frontend/.env` (copy `frontend/.env.example`).

---

## Architecture

**Domain.** An `organization` runs recurring services. Each service is a `plan` with an ordered list of `plan_items` (songs, headers, free-form items) and `assignments` of people to `team` positions. See the schema comment at the top of `supabase/migrations/20260101000000_init.sql` for the canonical description.

**Monorepo layout.**

```
packages/shared   Zod schemas, DB row types, domain types, the typed ApiClient, chordpro parsing — used by both backend and frontend/mobile
backend           Express API (Node)
frontend           React 19 + Vite + TanStack Query + Tailwind 4
mobile             Expo app (mirrors frontend against the same shared package and API)
supabase           Postgres schema (migrations), RLS policies, seed data
```

`packages/shared/src/index.ts` is the single export surface: DB row types, domain types (composed/joined shapes returned by the API, in `types/domain.ts`), Zod input schemas, `ServiceCenterApi` (the fetch client), and chordpro helpers. Backend and frontend both import only from `@service-center/shared` for anything crossing that boundary — don't redefine a row or input shape locally.

**Backend request pipeline** (`backend/src/app.ts`): every request goes through `helmet` → `cors` → `express.json` → rate limiting, then route-specific middleware:
- `requireAuth` (`middleware/auth.ts`) validates the Supabase JWT via `adminDb.auth.getUser()` and attaches `req.auth` and `req.db` (a Supabase client bound to the caller's access token, so **Postgres RLS — not application code — enforces row-level access**).
- `withOrganization` (`middleware/organization.ts`) resolves the active org from the `X-Organization-Id` header (or infers it when the caller belongs to exactly one), confirms active membership, and attaches `req.orgId` / `req.orgRole`. `requireManager` / `requireAdmin` gate mutations by role (`owner > admin > scheduler > member`).
- `/api/v1/me` and `/api/v1/organizations` only need `requireAuth` (a user isn't in an org yet at that point); every other router is mounted behind both.

**Two Supabase clients** (`backend/src/lib/supabase.ts`): `userDb(token)` — the default, RLS-scoped — vs `adminDb` — service-role, bypasses RLS, reserved for work a user genuinely can't do themselves (invites, notifications, background OCR); every such call must check org membership itself first. `unwrap()` turns a PostgREST response into data-or-throw; `fromPostgrestError` maps Postgres error codes to `HttpError`s (e.g. an RLS-denied row surfaces as 404, never 403, so org membership isn't leaked).

**Frontend data flow**: `lib/api.ts` builds one `ServiceCenterApi` instance (from `@service-center/shared`) that pulls the access token from the Supabase session and the active org id from `localStorage` on every call. `hooks/queries.ts` wraps it in TanStack Query; every query key is namespaced by org id (`keys.all(org)`) so switching organizations can't surface another tenant's cached data. `router.tsx` gates all authenticated routes on session presence and redirects a signed-in user with no organization to `/welcome`.

**Validation**: Zod schemas in `packages/shared/src/schemas/` are the single source of truth for input shapes and are shared between the backend route handlers (via `lib/validate.ts`) and anything the frontend needs to validate client-side. Add new input validation there, not inline in a route.

**Database**: schema, enums, and RLS policies live in `supabase/migrations/`, applied in order. Row Level Security is the primary access-control mechanism (see `20260101000100_rls.sql`) — the API's own authorization (`requireManager`/`requireAdmin`) is a UX layer on top of it, not a replacement.

**Supabase skill**: `.agents/skills/supabase-postgres-best-practices/` is the authoritative project-specific reference for schema/RLS/migration work — read it before designing a schema change (see rule 11 below).

---

## 1. Git Workflow

### New features must use a dedicated branch

Every new feature must be implemented on its own Git branch.

Branch naming convention:

```text
feature/<feature-name>
```

Examples:

```text
feature/user-notifications
feature/team-invitations
feature/payment-history
feature/admin-dashboard
```

Do not implement a new feature directly on `main`, `master`, `develop`, or another unrelated branch.

Before starting implementation:

1. Understand the requested feature.
2. Write a short description of what the feature does.
3. Identify the main areas of the application that will change.
4. Create or switch to the appropriate feature branch.

The feature description should explain:

- what the feature does;
- why it is needed;
- which backend/frontend/database areas are affected;
- any important assumptions or constraints.

Keep branches focused on one feature or one closely related piece of work.

Do not mix unrelated cleanup or refactoring into a feature branch unless necessary for the feature.

---

## 2. Feature Implementation

Before modifying code, inspect the existing architecture and follow existing project conventions.

Prefer extending existing patterns over introducing a new architectural pattern without a clear reason.

For each feature:

1. Understand the existing implementation.
2. Identify affected modules.
3. Define required types/models.
4. Implement the smallest coherent solution.
5. Add or update tests when applicable.
6. Run validation checks.
7. Review the final diff for unrelated changes.

Do not leave incomplete placeholder implementations unless explicitly requested.

Do not silently change existing behavior outside the requested scope.

---

# Backend Engineering Rules

## 3. TypeScript: Never Use `any`

Backend code must be strongly typed.

Do not use:

```ts
any
```

This includes:

```ts
const value: any
function foo(input: any)
Promise<any>
any[]
Record<string, any>
```

Instead, define an explicit interface, type, generic, or appropriate `unknown` boundary.

Prefer:

```ts
interface User {
  id: string;
  email: string;
}
```

or:

```ts
type UserStatus = 'active' | 'inactive';
```

When the structure is genuinely unknown at an external boundary, use:

```ts
unknown
```

and validate/narrow it before using it.

Do not bypass TypeScript with:

```ts
as any
// @ts-ignore
// @ts-nocheck
```

unless there is an exceptional reason explicitly documented and approved.

---

## 4. Models: Define an Explicit TypeScript Interface/Type for Every Type, in Every Package

Every distinct type used across the codebase must have an explicit, named TypeScript interface, type, or enum — in `backend`, `frontend`, `mobile`, and `packages/shared` alike. This is not a backend-only rule: a frontend component's props, a mobile screen's params, an API response shape, and a shared domain object must all be named and defined just as deliberately as a backend model. The goal is that anyone reading the code knows exactly what shape of data they're working with, without having to infer it from usage.

Do not rely on inferred, inline, or anonymous shapes for anything that crosses a function boundary, a component boundary, or a request boundary, for example:

```ts
function updatePlan(data: { id: string; name: string; items: unknown[] })
```

Prefer a named type:

```ts
interface UpdatePlanInput {
  id: string;
  name: string;
  items: PlanItem[];
}

function updatePlan(input: UpdatePlanInput)
```

**Where types live:**

- Types shared across `backend` and `frontend`/`mobile` (DB row types, domain types, API input/output shapes) belong in `packages/shared` and are exported from `packages/shared/src/index.ts` — see the Architecture section above. Do not redefine a shared shape locally in `backend` or `frontend`/`mobile`.
- Backend-only domain interfaces/types (not shared with the client) should live in the backend's model directory:

  ```text
  backend/
    src/
      model/
        user.model.ts
        organization.model.ts
        notification.model.ts
  ```

  Follow the repository's existing structure if one already exists (`model/` or `models/`).

- Frontend-only types (component prop types, hook return types, view-model/UI-state types not shared with mobile or backend) should live alongside the component/hook they describe, or in a `frontend/src/types/` directory for types used across multiple components. Do not inline large prop or state shapes directly in a component when they are reused or non-trivial.
- Mobile-only types (screen params, navigation types, mobile-specific view models) should live alongside the screen/component they describe, or in a `mobile/app/types/` directory for types used across multiple screens.

A model/type file may contain:

- domain interfaces;
- domain types;
- enums or union types;
- API/domain mapping types where appropriate;
- component prop types, hook return types, or screen param types (frontend/mobile).

Example:

```ts
export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
}
```

Avoid defining large, reusable, or cross-boundary shapes inline inside controllers, routes, services, components, hooks, or screens. Name them and put them in the appropriate location above so it's always clear what type is in play and where it's defined.

---

## 5. Map External and Database Types to Domain Models

Do not pass raw database objects or untrusted external objects throughout backend business logic.

Use explicit mapping functions.

For example:

```ts
interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
}

export function mapUserRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    createdAt: new Date(row.created_at),
  };
}
```

Prefer a clear separation between:

```text
Database/API representation
        ↓
      Mapper
        ↓
  Domain representation
```

Do not allow database naming conventions such as `snake_case` to leak throughout domain/business logic when the application uses a different convention.

Mapping provides a controlled boundary and makes schema changes safer.

---

## 6. Database Types Are Not Automatically Domain Types

Generated Supabase/database types represent the database schema.

They should not automatically become application domain models.

For example, avoid spreading raw generated row types throughout services:

```ts
Database['public']['Tables']['users']['Row']
```

Prefer mapping them into an application model:

```ts
User
```

This keeps the business layer independent from the persistence layer.

Generated database types may be used inside repositories/data-access modules and mapper implementations.

---

## 7. Layer Responsibilities

Keep responsibilities separated where the project architecture allows it.

Typical flow:

```text
Controller / Route
       ↓
Service / Use Case
       ↓
Repository / Data Access
       ↓
Database
```

Recommended responsibilities:

### Controller / Route

Responsible for:

- receiving the request;
- authentication/authorization integration;
- validating request input;
- calling the appropriate service;
- returning the response.

Avoid putting significant business logic directly in controllers.

### Service

Responsible for:

- business rules;
- orchestration;
- application behavior;
- domain-level decisions.

### Repository / Data Access

Responsible for:

- Supabase/database queries;
- persistence operations;
- mapping database errors when appropriate.

### Mapper

Responsible for converting between:

- database rows;
- API payloads;
- external service responses;
- internal domain models.

---

# Input and Output Types

## 8. Explicit Request Types

Define typed input objects for significant operations.

Example:

```ts
export interface CreateUserInput {
  email: string;
  firstName?: string;
  lastName?: string;
}
```

Prefer:

```ts
async function createUser(input: CreateUserInput): Promise<User>
```

instead of:

```ts
async function createUser(data: object)
```

or:

```ts
async function createUser(data: any)
```

---

## 9. Explicit Service Return Types

Important backend service boundaries should have explicit return types.

Example:

```ts
async function getUser(id: string): Promise<User | null> {
  // ...
}
```

This makes contracts easier to understand and prevents accidental type changes.

---

## 10. Validate Data at Boundaries

Types alone do not validate runtime data.

Validate data coming from:

- HTTP requests;
- webhooks;
- environment variables;
- external APIs;
- queues;
- untrusted JSON;
- user input.

Use the validation library already adopted by the project.

Examples may include:

```text
Zod
Valibot
Yup
Joi
```

Do not add another validation library if the project already has one without a strong reason.

Follow the existing validation convention.

---

# Supabase & Database Rules

## 11. Follow the Supabase Skill

Before designing, creating, or modifying a database schema, first read and follow the project's Supabase skill/instructions.

This applies to:

- new tables;
- new columns;
- enum changes;
- indexes;
- foreign keys;
- database functions;
- triggers;
- views;
- RLS policies;
- storage policies;
- schema redesigns;
- destructive database operations.

The Supabase skill is the authoritative project-specific instruction for database work.

Do not design a new schema without checking it first.

If the Supabase skill conflicts with a generic recommendation in this document, follow the Supabase skill.

---

## 12. Schema Changes Must Use Migrations

Do not rely on undocumented manual database changes.

Database changes should be represented through Supabase migrations following the repository's existing workflow.

A migration should be:

- reproducible;
- reviewable;
- deterministic;
- safe to apply in the intended environment.

Avoid editing an old migration that has already been applied to shared environments.

Create a new migration instead.

---

## 13. Consider RLS for Every Schema Change

Whenever creating or modifying a table, explicitly consider Row Level Security.

Determine:

- who may `SELECT`;
- who may `INSERT`;
- who may `UPDATE`;
- who may `DELETE`;
- whether service-role-only operations are required;
- whether organization/user ownership must be enforced.

Never assume that application-side authorization alone is sufficient when the Supabase architecture relies on RLS.

Do not accidentally expose tables through permissive policies.

---

## 14. Database Constraints

Prefer enforcing important invariants at the database layer where appropriate.

Consider:

- `NOT NULL`;
- foreign keys;
- unique constraints;
- check constraints;
- indexes;
- sensible defaults.

For example, if a value must be unique for correctness, do not rely only on application code to enforce uniqueness.

---

## 15. Indexing

Consider indexing columns used frequently for:

- filtering;
- joins;
- foreign-key lookups;
- sorting;
- RLS policy conditions.

Do not add indexes blindly.

Consider query patterns and expected data size.

---

## 16. Avoid Destructive Schema Changes Without Approval

Do not perform destructive operations without explicitly understanding the impact.

Examples include:

```sql
DROP TABLE
DROP COLUMN
TRUNCATE
```

or incompatible type changes.

When a breaking migration is necessary, prefer a safe migration sequence where possible:

```text
Add
→ Backfill
→ Migrate application usage
→ Verify
→ Remove old structure
```

---

## 17. Regenerate Supabase Types

If this project uses generated Supabase TypeScript types, regenerate or update them after schema changes.

Do not leave generated database types inconsistent with the actual schema.

After regeneration, update affected mappings and application models as needed.

---

# Code Quality

## 18. Prefer Clear Code Over Clever Code

Optimize primarily for:

- readability;
- maintainability;
- type safety;
- testability;
- predictable behavior.

Avoid unnecessary abstractions.

Do not create a generic abstraction for logic that only has one simple use case unless it clearly improves maintainability.

---

## 19. Avoid Duplicate Business Logic

If the same business rule appears in several places, move it to an appropriate shared service, domain utility, or model function.

However, do not aggressively deduplicate code when doing so would create a confusing abstraction.

---

## 20. Error Handling

Do not silently swallow errors.

Avoid:

```ts
try {
  // ...
} catch {
  // nothing
}
```

Errors should be:

- handled;
- converted into an expected application error;
- logged appropriately;
- or rethrown.

Do not expose sensitive database or infrastructure details directly to API clients.

---

## 21. Logging

Use the project's existing logging system.

Avoid unnecessary:

```ts
console.log()
```

in production backend code.

Never log:

- passwords;
- authentication tokens or session tokens;
- Supabase service-role keys or other secrets;
- full request/response bodies containing personal data.
