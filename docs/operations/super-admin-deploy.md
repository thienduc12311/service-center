# Deploying the super-admin dashboard

The production rollout of PRs #97 (database and API), #98 (web and mobile screens) and #99 (the admin app),
with `admin.graceaogchurch.com` as the admin app's domain. Design: [docs/plans/super-admin-dashboard.md](../plans/super-admin-dashboard.md).

**Order matters.** Deploy the database first, then the API, then the web apps. The new API calls database
functions that only exist after the migrations; the old API keeps working on the new database. Deploying the API
first would break `GET /api/v1/me` for everyone until the migrations land.

Expect one visible change the moment the migrations run: **self-serve church creation turns off**. Until the new
web app is live, "Create church" in the old app fails with "New churches need an approved application". Do steps
2–4 together to keep that window short.

---

## 1. Before you start

- [ ] Merge the PRs in order: #97, then #98, then #99. Production deploys from `main`.
- [ ] Take a database backup: Supabase dashboard → **Database → Backups** (or `supabase db dump -f backup.sql`
      against the linked project).
- [ ] Have these ready:
  - access to the Vercel team;
  - the DNS provider for `graceaogchurch.com`;
  - the Supabase dashboard;
  - your authenticator app (1Password, Google Authenticator, Authy…).

## 2. Database (Supabase)

- [ ] Apply the migrations from the repository root:

  ```bash
  supabase link --project-ref <your-project-ref>   # if not linked already
  npm run db:push
  ```

  The two new migrations are `20261116000000_platform_admin_foundation` and `20261116000100_platform_admin_controls`.
  Both are additive. Existing churches start **active**; any church already over 200 MB gets its own quota, its
  usage rounded up to the next 50 MB, so nothing is blocked.

- [ ] Check them in the SQL editor:

  ```sql
  -- One controls row per church, all active.
  select (select count(*) from public.organizations) as churches,
         (select count(*) from public.organization_platform_controls where status = 'active') as active_controls;

  -- 200 MB default, self-serve creation off.
  select default_storage_quota_bytes, allow_self_serve_church_creation from public.platform_settings;

  -- Churches that got a quota above the default.
  select o.name, c.storage_quota_bytes / 1048576 as quota_mb
    from public.organization_platform_controls c join public.organizations o on o.id = c.organization_id
   where c.storage_quota_bytes is not null;
  ```

- [ ] Turn on two-factor: **Authentication → Multi-Factor → TOTP**: enroll and verify both enabled.

## 3. API (existing Vercel project)

- [ ] In **Settings → Environment Variables** (Production):
  - `CORS_ORIGINS`: add `https://admin.graceaogchurch.com` to the existing list, comma-separated.
  - `ADMIN_APP_URL=https://admin.graceaogchurch.com`: the link in "new application" emails.
  - Check that `RESEND_API_KEY`, `MAIL_FROM_ADDRESS` and `MAIL_FROM_NAME` are set. Application emails use them;
    without a key they are only logged.
- [ ] Redeploy the API. Environment changes only apply to new deployments.
- [ ] `https://<api-domain>/health` answers `{"status":"ok"}`.

## 4. Web app (existing Vercel project)

- [ ] Deploys from `main` on its own. Confirm the deployment of the merge commit finished.
- [ ] Sign up with a throwaway account. `/welcome` shows **"Register your church"**, not "Create church".

## 5. Admin app (new Vercel project)

- [ ] **Add New → Project**, same repository, with:

  | Setting | Value |
  |---|---|
  | Root Directory | `admin` |
  | Include source files outside the Root Directory | enabled |
  | Framework | Vite |
  | Build and install commands | leave empty; `admin/vercel.json` provides them |

- [ ] Environment variables (Production):

  ```bash
  VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
  VITE_SUPABASE_ANON_KEY=<anon key>           # Supabase → Settings → API
  VITE_API_URL=https://<api-domain>
  VITE_APP_URL=https://app.graceaogchurch.com # "Open in Service Center" links here
  ```

- [ ] Leave **Git → Production Branch** as `main`. Every push to `main` deploys the admin app.
      `admin/vercel.json`'s `ignoreCommand` skips the build when a push doesn't touch `admin/`,
      `packages/shared` or the root `package.json` / `package-lock.json`.
- [ ] Deploy, then open the `*.vercel.app` URL. The sign-in page loads.
  It can't call the API yet; the API only allows `admin.graceaogchurch.com`.

## 6. Domain

- [ ] In the admin project: **Settings → Domains → Add** `admin.graceaogchurch.com`.
- [ ] At the DNS provider, add the record Vercel shows. It is usually:

  | Type | Name | Value |
  |---|---|---|
  | CNAME | `admin` | `cname.vercel-dns.com` |

- [ ] Wait until Vercel shows the domain as valid with a certificate.
- [ ] Supabase **Authentication → URL Configuration**: nothing to add. The admin app signs in with a password and
      never uses an email redirect.

## 7. Make yourself a super admin

- [ ] Your account must exist in the main app (sign up there if needed).
- [ ] In the Supabase SQL editor:

  ```sql
  insert into private.platform_admins (user_id, note)
  select id, 'Platform owner'
    from auth.users
   where email = '<your email>';
  ```

- [ ] Sign in at `https://admin.graceaogchurch.com`, scan the QR code with your authenticator app and enter the code.
- [ ] Plan for a lost phone. Supabase has no backup codes. Either keep the authenticator in a synced password
      manager, or add a second super admin. If you lose it, remove the factor in SQL and set it up again:

  ```sql
  delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = '<your email>');
  ```

## 8. Smoke test in production

Use the throwaway account from step 4 as the applicant:

- [ ] Apply for a church as the throwaway account. You get the "New church application" email.
- [ ] In the admin app, **Applications**, open it, and approve it with a slug. The throwaway account gets the
      "is approved" email and lands in the new church.
- [ ] On that church's page, **Enter as owner** → **Open in Service Center** (sign in there as yourself). You see
      the admin banner inside the church. Then **Exit church**.
- [ ] **Disable** the church with a reason. The throwaway account sees the disabled notice. **Enable** it again.
- [ ] **Activity** lists everything you just did.
- [ ] Clean up: delete the throwaway account from its Settings → Account. That also deletes the church it owns
      alone.

## 9. Mobile

- [ ] Build and submit a new version with EAS (`eas build --profile production`, then submit). Store builds
      already installed keep working, with one difference: their "create church" is refused. In English it shows the
      server's message, "New churches need an approved application"; in Vietnamese, a generic "not allowed" message.
      People can apply from the web until they update.
- [ ] Optional: set `EXPO_PUBLIC_SUPPORT_EMAIL` if support should not be `support@graceaogchurch.com`.
- [ ] Check the new screens on a device before submitting. They were only unit-tested, never run on a simulator:
  - the no-church screen;
  - the disabled-church notice;
  - the admin banner;
  - the storage card.

## 10. Afterwards

- **Expired "enter as owner" windows.** The API refuses them right away, and every admin request clears them. Once
  the delivery worker cron runs in production (`/api/v1/internal/deliveries/run` with `CRON_SECRET`), it removes
  them too.
- **Rolling back.**
  - **Code:** Vercel **Instant Rollback** on the API, web and admin projects. The database changes are additive,
    and the previous code runs on them.
  - **Re-opening church creation:** either turn on **Settings → Let people create churches without approval** in
    the admin app, or run this SQL:

    ```sql
    update public.platform_settings set allow_self_serve_church_creation = true where id;
    ```
