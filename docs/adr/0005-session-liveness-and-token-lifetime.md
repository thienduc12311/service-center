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

- Realtime: see "Realtime topic keys" below. A removed member's open socket stops receiving within
  seconds; the 900 s token lifetime no longer bounds it.
- A signed URL already issued works until it expires (see `docs/operations/session-and-url-lifetimes.md`).
- A deactivated member's token is checked against current membership by RLS on every request; that
  part never had a window.
- `jwt_expiry` is a Supabase Auth setting: `supabase/config.toml` applies after a local stack
  restart; hosted projects need the same value in the dashboard.

## Realtime topic keys (W8-INT-D5)

Measured on Realtime v2.167.0 (source and an empirical run): the `realtime.messages` SELECT policy is
evaluated when a channel joins and when the client sends a new `access_token`, never per
broadcast. A DB-originated `realtime.send` goes to every socket already joined to the topic. A
removed member's open socket kept receiving (a poke arrived 3 s after deactivation; the earlier QA
run saw 825 s). Nothing server-side can close a socket or force a re-check, so the policy alone cannot
revoke.

Decision: close the connection by making the topic name the credential.

- Topics are `<kind>:<id>:<key>` and `org:<org id>:<key>`. The key is a 244-bit per-organization secret in
  `private.org_realtime_keys` (row security on, no policy; read only by security definer functions).
- `public.realtime_topic_key(org)` returns it to an active member only. `GET /api/v1/realtime/key` calls
  it with the caller's token on every request, so membership and the session check are enforced
  there; a removed member gets 404.
- `private.can_receive_resource_poke` requires the key in the topic to be current, the caller to be an
  active member of the resource's organization, and the resource to be readable (conversation access,
  plan and run row security). A rejoin after removal is refused.
- Pokes are sent to the topic with the current key. Deactivation, suspension (church disabled), role
  change, deletion of an active membership and deletion of an `auth.sessions` row rotate the key in
  the same transaction (`private.rotate_org_realtime_key`, once per transaction). After commit nothing
  is sent to the old topics, so an open socket of a removed member goes silent.
- Before rotating, one id-free poke (`{"event":"rekey"}`, event `changed`) goes to the old control topic
  `org:<org id>:<old key>`. Remaining members' clients refetch the key and rejoin the new topics; the
  removed member's refetch fails, which the client treats as revoked and stops subscribing
  (`createRealtimeKeyStore`, web and mobile `useBroadcastRefresh`).

Rejected: a client-only "you were removed" event (trusts the client), per-message policy evaluation
(not supported by this version) and `jwt_expiry` alone.

Residual windows:

- A removed member's socket stays connected but receives nothing; it can still receive the one rekey
  poke, which carries no data. The key was learned while a member, so a member who copied it and the
  topic names could join until the rotation commits; after it, joins with the old key are refused.
- Rotation is organization-wide, so every other member refetches one small response per removal or
  sign-out. A device sign-out rotates the key of all the user's organizations.
- Revocations that are not membership or session changes (leaving a team, being unscheduled) do not
  rotate the key: the poke topic stays readable to the member for that resource until they rejoin,
  but pokes carry only an id and event, and the API checks access on every read.
- Hosted projects: the `auth.sessions` trigger needs the `postgres` role to hold TRIGGER on
  `auth.sessions`; confirm with `select has_table_privilege('postgres', 'auth.sessions', 'TRIGGER')`.
  If it cannot be created, the migration fails loudly and session deletion then relies on the 900 s
  token lifetime plus the API key check.
