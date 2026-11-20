# Signed-out tokens are refused by a session check and a 15-minute JWT

Status: accepted (QA wave 7 follow-up, W7-JRN-D3 and W7-ACC-D7).

## Problem

A Supabase access token is a stateless JWT. After a global sign-out the Express API refused it
(`requireAuth` asks Auth), but PostgREST, Storage and Realtime kept honouring it until `exp`
(3600 s). Row security scoped it to the user's own organizations, so this is a stolen-token
window, not a cross-user leak.

## Options

| Option | Result |
|---|---|
| RLS helpers (`is_org_member`, `org_role_of`, `has_capability`...) check the session | Rejected. About 120 policies and 100 functions read `auth.uid()` directly (own-row policies, `my_assignment_*`, RPCs); patching the base helpers leaves most reads open and adds a lookup per row. |
| Check once per PostgREST request in a `db-pre-request` hook | Adopted. Covers every table, view and RPC. |
| One restrictive policy on `storage.objects` with an initplan | Adopted. Covers Storage reads, uploads and signed-URL issuance. |
| Lower `jwt_expiry` to 900 s | Adopted as the bound for what the checks cannot reach (Realtime, an already open socket). |
| Override `auth.uid()` | Rejected. It belongs to the platform's `auth` schema and is replaced on upgrade. |

## What the check is

`private.session_live()` is true when the JWT has no `session_id` claim (service role, anon, SQL
tests) or when `auth.sessions` still has that id and it has not passed `not_after`. It is a
primary-key lookup. `public.api_pre_request()` calls it and raises `PT401` (HTTP 401), set with
`alter role authenticator set pgrst.db_pre_request` and a PostgREST config reload. It lives in
`public` because anon requests run it too and anon has no `USAGE` on `private`.

## Measurements (local, `EXPLAIN ANALYZE`)

- `api_pre_request()`: about 8 microseconds per call with a session, about 5 without
  (20,000 calls in 159 ms and 111 ms). Once per request.
- `select count(*) from storage.objects` plans the check as `InitPlan` (one evaluation per
  statement, first call about 0.12 ms); the filter shows `$0 AND (...)` and does not repeat per row.
- 10,000-row scan with `where (select private.session_live())`: 1.39 ms against 1.30 ms for the
  bare function in a one-time filter. No per-row cost.

## Residual windows

- Realtime has no hook: an open socket or a token presented to it keeps working until the access
  token expires (at most 900 s); a signed-out session cannot refresh.
- A signed URL already issued works until it expires (see `docs/operations/session-and-url-lifetimes.md`).
- A deactivated member's token is checked against current membership by RLS on every request; that
  part never had a window.
- `jwt_expiry` is a Supabase Auth setting: `supabase/config.toml` applies after a local stack
  restart; hosted projects need the same value in the dashboard.
