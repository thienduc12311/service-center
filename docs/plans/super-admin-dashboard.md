# Super-admin dashboard

A platform-level admin role for the people who run Service Center itself, with its own web app at
`admin.graceaogchurch.com`. Agreed in a design review on 2026-11-15; this file is the reference for the four
PRs that build it.

## What it does and why

The app is still small and we want control over who runs a church on it. Super admins:

- see every church: status, owner, members, storage used, last activity;
- approve or reject applications for new churches (self-serve church creation is switched off, not deleted);
- create a church directly and name its owner by email;
- set each church's media storage quota (200 MB by default);
- disable and re-enable a church;
- enter any church as a temporary owner to help.

## Decisions

### Who is a super admin

- A row in `private.platform_admins`, added by SQL only (see `docs/operations/platform-admins.md`).
- Same Supabase auth project and account as the main app.
- Every super-admin action requires a session that completed two-factor login (Supabase TOTP, `aal2`).
  `GET /api/v1/admin/session` works at `aal1` so the admin app can walk you through enrolling.

### Architecture

- New `admin/` web app (Vite + React + TanStack Query + Tailwind), its own Vercel project, no sign-up,
  no-index. Non-admins are signed out with "not authorized".
- Same Express backend: `/api/v1/admin/*` behind `requireAuth` → `requirePlatformAdmin` (MFA required).
  The admin service reads and writes with the service-role client, only after that guard.
- Shared request/response types and Zod schemas live in `packages/shared` like everything else.

### Data model (migrations `20261116000000`, `20261116000100`)

| Object | Purpose | Who can read / write |
|---|---|---|
| `private.platform_admins` | who is a super admin | nobody through the API |
| `platform_settings` (one row) | default quota (200 MB), `allow_self_serve_church_creation` (false) | service role |
| `organization_platform_controls` | each church's `status` (`active`/`disabled`), disable reason, quota override | members read their church; service role writes |
| `church_applications` | `pending` → `approved` / `rejected` / `withdrawn` | applicant reads and edits own pending one; service role reviews |
| `platform_audit_log` | every super-admin action, append-only | service role |
| `member_status` `suspended` | members of a disabled church | set only by enable/disable |
| `organization_members.platform_access_expires_at` | a super admin's temporary owner membership | service role |

Status and quota are deliberately **not** columns on `organizations`: owners and admins can update every
column of that row.

### Church applications

- Signed-in users apply from `/welcome` and from the "Apply for a new church" buttons that replace
  "New organization" in web Settings and mobile Profile (PR 2).
- Fields: church name, address, city, state/province, postal code, country, leader name, contact phone,
  website, rough member count, timezone, note.
- One open (`pending`) application per user, enforced by a partial unique index. The applicant can edit or
  withdraw it while pending and apply again after a rejection. Applications are kept.
- A super admin may edit the details, then approves with a URL slug: the church is created and the applicant
  becomes its owner. Rejecting needs a reason, shown to the applicant.
- New applications email the super admins; decisions email the applicant (Resend, sent directly because the
  delivery outbox is per-church).
- Invitations to existing churches are unaffected.

### Self-serve creation is off, not deleted

`create_organization` refuses with `church_application_required` unless
`platform_settings.allow_self_serve_church_creation` is on. Approval and direct creation use
`private.create_church`, which only service-role functions call. Calling the database directly can't
create a church either.

### Enter as owner

The backend adds a real `owner` membership for the super admin, marked by `platform_access_expires_at`
(8 hours). Every existing RLS policy then works unchanged. The row:

- never creates a roster person, and is hidden from other members' membership queries (restrictive policy);
- is excluded from member counts, account-deletion ownership checks and suspension;
- is removed on exit, and expired rows are refused by the API and purged by the delivery worker run and
  every admin request.

Entering, exiting and every non-GET API request made with that membership go to `platform_audit_log`.
If the super admin is already a real member of the church nothing is added.

### Disabling a church

`set_organization_platform_status` (service role) flips the controls row and, in the same transaction,
moves every `active` membership to `suspended` (and back on enable; `inactive` members stay inactive).
Every RLS check requires `status = 'active'`, so members are blocked everywhere: API, mobile, storage,
direct database calls. On top of that:

- a trigger turns any membership activated while the church is disabled (for example, an accepted invite)
  into `suspended`, and only the enable/disable function may set or clear `suspended`;
- church API keys stop working (their issuer is no longer an active admin);
- deliveries skip disabled churches, including roster people without a login;
- `GET /api/v1/me` returns `disabled_organizations` so the app can show the disabled screen. The reason is
  shown to owners only.

A reason is required. Disabling never deletes data; deleting a church is not part of v1.

### Media quota

- Counted: every Storage object whose path starts with the church id in any bucket, plus
  `avatars/orgs/<church>/…`. Not counted: `report-exports` (temporary) and `avatars/users/…` (personal).
- Quota = the church's override, or the platform default (200 MB).
- Attachments are checked exactly when the upload is requested (`attachment_versions` insert trigger:
  used + declared size ≤ quota). Direct uploads (logo, songbooks, church-uploaded avatars) are allowed while
  the church is under quota, so one last file can overshoot by at most its own size limit (5–50 MB).
- Refusals are `413 storage_quota_exceeded`. `GET /api/v1/organization-storage` gives the app the used and
  quota numbers for the 80% warning (PR 2).
- Existing churches already over 200 MB get an override of their usage rounded up to the next 50 MB.

### Dashboard (PR 3)

Totals (churches by status, pending applications, accounts, storage), church list (status, owner, accounts,
invites, roster people, storage used/limit, created, last activity), church detail (members, storage by
bucket, quota, disable/enable, enter as owner), applications queue, activity log, settings. No charts in v1.

## Delivery

On `feature/super-admin-dashboard`, as stacked PRs:

1. **Database and backend**: migrations, `/api/v1/admin/*`, applicant API, quota and disabled handling in
   the existing API, tests, CLAUDE.md command fixes.
2. **Main web app and mobile**: application form, disabled screen, quota bar and upload-blocked messages,
   platform-access banner.
3. **`admin/` web app.**
4. **Deploy**: Vercel project, `admin.graceaogchurch.com`, `CORS_ORIGINS`.

There is no staging Supabase project, so every migration is exercised with `npm run db:reset` and the
backend tests before production.
