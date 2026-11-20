# Session and signed-URL lifetimes

| Item | Lifetime | Where |
|---|---|---|
| Access token (JWT) | 900 s | `supabase/config.toml` `jwt_expiry`; hosted: Authentication > Sessions |
| File and offline-pack download URL | 60 s | `FILE_DOWNLOAD_TTL_SECONDS` (`packages/shared/src/lib/files.ts`) |
| Report export download URL | 60 s | `REPORT_EXPORT_URL_TTL_SECONDS` (`.../reports.ts`) |
| Song book preview URL | 120 s | `SONGBOOK_DOCUMENT_URL_TTL_SECONDS` (`.../reports.ts`) |
| Upload intent | 7200 s | `FILE_UPLOAD_TTL_SECONDS` |

## Signed URLs

Storage signed URLs carry their own signature and cannot be revoked. Every URL is issued with the
caller's token, so Storage row security checks membership and audience at that moment: a removed
member or a deleted file gets no new URL. A URL issued just before the change keeps working for
at most its lifetime above (anonymous, no session) and copied bytes cannot be recalled. Clients
open or fetch immediately and renew about 20 s before expiry (web and mobile players, offline
pack download, report and song book pages re-request on each use), so the short lifetime costs
one extra request per minute of continuous playback.

## Signed-out sessions

PostgREST and Storage refuse a token whose session was ended (global sign-out, revoked session)
with 401 or no rows; see `docs/adr/0005-session-liveness-and-token-lifetime.md`. Realtime keeps an
open socket until the token expires (at most 900 s).

## Deploy notes

- Run the migration `20261126000200_w7f_session_liveness.sql`; it sets `pgrst.db_pre_request` on
  the `authenticator` role and reloads PostgREST config. Confirm with
  `select rolconfig from pg_roles where rolname = 'authenticator'`.
- Hosted: set JWT expiry to 900 s in the dashboard; restart the local stack for `config.toml`.
