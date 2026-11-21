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
  rotate the organization key; see "Per-resource topic keys" below, which closes that gap for
  conversations.
- Hosted projects: the `auth.sessions` trigger needs the `postgres` role to hold TRIGGER on
  `auth.sessions`; confirm with `select has_table_privilege('postgres', 'auth.sessions', 'TRIGGER')`.
  If it cannot be created, the migration fails loudly and session deletion then relies on the 900 s
  token lifetime plus the API key check.

## Per-resource topic keys (W8-INT-D5 follow-up)

The organization key does not change when someone loses access to a single team or plan, so that
person's open socket kept receiving pokes for that conversation and they could rejoin with the key they
already knew. Rotating the organization key on every roster or assignment change would make every connected
client refetch on every scheduling action, so the loss is scoped to the resource.

What grants access to each topic kind (checked against `private.can_access_conversation` and the row
security of `plans` and `live_runs`):

- `conversation`: an active, adult, unarchived person who is on the team or may schedule or manage it
  (team conversation), or is a plan leader or has a released, not-declined assignment (plan conversation).
  Per-resource, and what changes.
- `live_plan`, `live_run`: any active member of the organization (`is_org_member`). A removed assignee can
  still read the plan and its run through the API, so there is nothing per-resource to revoke; these
  topics keep the organization key only. This is a product rule, not an oversight: tightening it would
  mean restricting plan reads themselves.

Decision: a conversation topic is `conversation:<id>:<organization key>:<conversation key>`.

- `private.conversation_realtime_keys` (one row per conversation, 244-bit key, row security on, no policy,
  cascade-deleted with the conversation) is created the first time a member is issued the topic. No row
  means nobody holds a topic, so there is nothing to poke or rotate.
- `public.realtime_resource_topics(org, resource, ids)` returns the topics the caller may use right now
  (active membership plus `can_access_conversation` per id; plans and runs of the organization for the
  live kinds). `POST /api/v1/realtime/topics` calls it with the caller's token on every request; a resource
  without access is absent from the answer, never an error. The existing key endpoint and the
  organization key rotation are unchanged. Clients ask the API for topics instead of building them, and
  ask again when the organization key changes or a `rekey` poke arrives
  (`createResourceSubscription` in `packages/shared`, used by web and mobile `useBroadcastRefresh`).
- The join policy requires both keys to be current, an active member and conversation access.
- The conversation key rotates in the same transaction as the loss, after one id-free `rekey` poke on the
  old topic. Triggers: team membership deleted; assignment deleted, declined, un-released, or moved to
  another person or plan (only when the old row granted access); person archived, unlinked from the
  account or marked a child (conversations they were on); plan or team moved to another service type;
  team-scoped scheduling or management grant removed. Organization-wide, service-type and folder grants,
  service-type folder moves and leaving the legacy scheduler mode rotate the organization key instead:
  they are rare and could reach many conversations.
- Write amplification: rotation touches only a conversation that has a key row (somebody opened it) and
  happens at most once per conversation per transaction, and only when access is lost (inserts, releases
  and confirmations do nothing). Bulk scheduling therefore adds no writes; bulk removal costs one poke and
  one update per affected conversation.

Rejected: rotating the organization key on every roster change (cost on every client), one table
polymorphic over all kinds (no per-resource rights exist for the live kinds), and keeping client-built
topics (the client could not learn a new key without a lookup that checks access).

Residual windows:

- A person who loses access can still receive the one id-free `rekey` poke on the old topic (their socket
  is still joined to it) and then nothing; they cannot rejoin. A person who had already copied the topic
  could join it until the commit; afterwards joins are refused.
- Access is lost through the triggers listed above. A loss not covered by a trigger is limited to the
  API and RLS checks on every read, with pokes continuing until the next rotation or the organization
  key changes. Role and access-mode changes of an organization member rotate the organization key, which
  covers capabilities that come from the role; no uncovered path is known, but a future way of granting
  conversation access needs its own trigger (the SQL suite `qa-wave8-realtime-resource-revocation.sql`
  lists the covered ones).
- A conversation key is created lazily on first issue, and a poke sent between the key's creation and the
  client's join is missed; clients refetch their data after every join, so they converge.
- Clients from before this change use three-part conversation topics the policy now refuses and rely on
  the 60 s fallback refresh until updated.
