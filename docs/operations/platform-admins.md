# Platform admins (super admins)

Super admins run the platform: they approve church applications, set storage quotas, disable churches and can
enter any church as a temporary owner. Design: [docs/plans/super-admin-dashboard.md](../plans/super-admin-dashboard.md).

There is no UI to add or remove one, on purpose. Do it in SQL, in the Supabase SQL editor (production) or
`psql` (local), as `postgres`.

## Add a super admin

The person signs up in the app first, so they have an account.

```sql
insert into private.platform_admins (user_id, note)
select id, 'Added by <your name> on <date>'
  from auth.users
 where email = 'person@example.com';
```

Check it worked:

```sql
select a.user_id, u.email, a.note, a.created_at
  from private.platform_admins a
  join auth.users u on u.id = a.user_id;
```

## Two-factor login is required

Every admin API route except `GET /api/v1/admin/session` needs a session that completed two-factor login
(Supabase TOTP, `aal2`). The admin app walks a new super admin through enrolling an authenticator app.

TOTP must be enabled on the Supabase project: **Authentication → Multi-Factor → TOTP: enabled**. Locally it is
on in `supabase/config.toml` (`[auth.mfa.totp]`) from the next `npm run db:start`.

## Remove a super admin

```sql
delete from private.platform_admins
 where user_id = (select id from auth.users where email = 'person@example.com');
```

Any "enter as owner" access they still hold ends at its expiry (8 hours at most), or remove it now:

```sql
delete from public.organization_members
 where user_id = (select id from auth.users where email = 'person@example.com')
   and platform_access_expires_at is not null;
```

## What gets recorded

`public.platform_audit_log` keeps every super-admin action: approvals, rejections, application edits, church
creation, disable/enable, quota and settings changes, entering and leaving a church, and every change made
through the API while inside a church. It is append-only for the API and visible on the dashboard's Activity
page.
