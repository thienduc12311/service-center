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
with 401 or no rows; see `docs/adr/0005-session-liveness-and-token-lifetime.md`. Realtime topic names
carry a per-organization key that rotates when a member is deactivated, removed or demoted, or when any
of their sessions is deleted. A removed member's open socket goes silent as soon as that transaction
commits (seconds, not the 900 s token lifetime) and cannot rejoin; it may still hold the connection.

Losing access to one resource ends Realtime access to just that resource. A team or plan
conversation topic also carries a per-conversation key, issued by `POST /api/v1/realtime/topics` only to
someone who can use the conversation at that moment, and rotated in the same transaction as the loss
(removed from the team, assignment deleted, declined or un-released, person archived or unlinked,
team-scoped scheduling or management grant removed, plan or team moved to another service type). The
person's open socket on that conversation goes silent and cannot rejoin; their other conversations and
the rest of the team are unaffected. `live_plan` and `live_run` topics are readable by every member of
the organization (row security on plans and runs), so there is no per-person access to lose there: they
change only with the organization key. Removing an organization-wide, service-type or folder grant, moving
a service type between folders, or leaving the legacy scheduler mode rotates the organization key instead
(rare, administrative; every client refetches once).

## Deploy notes

- Run migrations `20261127000400_w8_realtime_revocation.sql`, `20261127000600_w8_realtime_org_delete.sql`
  and `20261127000700_w8_realtime_resource_revocation.sql`, then check end to end:
  `SUPABASE_ANON_KEY=<anon key> node supabase/tests/qa-wave8-realtime-revocation.e2e.mjs` and
  `SUPABASE_ANON_KEY=<anon key> node supabase/tests/qa-wave8-realtime-resource-revocation.e2e.mjs`
  (the second creates and removes its own fixtures; set `E2E_API_URL` to go through the API route).
  Deploy the API before the clients: clients now fetch conversation topics from `POST /api/v1/realtime/topics`.
  Older web and mobile builds subscribe to three-part conversation topics, which the join policy refuses,
  so they get no conversation pokes until updated (they fall back to the 60 s refresh).
  Hosted: the `postgres` role needs TRIGGER on `auth.sessions` (see ADR 0005); web and mobile clients
  from before this change subscribe to unkeyed topics and receive no pokes until updated (they fall
  back to the 60 s refresh).

- Run the migration `20261126000200_w7f_session_liveness.sql`; it sets `pgrst.db_pre_request` on
  the `authenticator` role and reloads PostgREST config. Confirm with
  `select rolconfig from pg_roles where rolname = 'authenticator'`.
- Hosted: set JWT expiry to 900 s in the dashboard; restart the local stack for `config.toml`.
