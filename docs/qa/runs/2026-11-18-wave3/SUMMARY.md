# QA wave 3 — summary (2026-11-18)

Plan: `docs/plans/admin-mobile-test-plan.md`. Commit `5bedb99` on `main` (branch `feature/qa-wave3`).
Environment: local Supabase (76/76 migrations applied, **not** reset — wave 1–2 fixtures still present), backend :4000 (simulated email/push), web :5173, Node 26.13.1. Supabase CLI 3.2.0 rejects `[inbucket]` in `supabase/config.toml`, so SQL ran through `docker exec supabase_db_service-center psql`.

Six Sonnet agents ran in parallel via the `/qa-wave` skill (`.claude/skills/qa-wave/SKILL.md`), each in its own namespace (`qa-20261118-{rel,msg,song,file,live,int}-*`). Only QA-09 used the browser; QA-07 owned the delivery worker (QA-12 also ran it on a private :4591 instance for webhooks).

| Package | Report | Expanded cases | PASS | FAIL | Other |
|---|---|---|---|---|---|
| QA-07 release/reminders/delivery | [release.md](release.md) | 224 | 221 | 3 | web/mobile NOT_RUN; real-provider faults BLOCKED (no keys) |
| QA-08 notes/messages/chat/notifications | [messaging.md](messaging.md) | 830 | 790 | 18 | 1 BLOCKED, 16 NOT_RUN, 5 N/A |
| QA-09 songs/charts/imports | [songs.md](songs.md) | 507 | 482 | 18 | 6 NOT_RUN, 1 N/A |
| QA-10 files/media/stage/rehearsal | [files.md](files.md) ([cases](files-cases.tsv)) | 1794 | 1776 | 5 | 12 NOT_RUN, 1 N/A |
| QA-11 live/attendance/reports | [live-reports.md](live-reports.md) | 412 | 393 | 5 | 13 NOT_RUN, 1 N/A |
| QA-12 calendar/export/public/API/webhooks | [integrations.md](integrations.md) | 975 | 941 | 21 | 9 NOT_RUN, 4 N/A |

## P0 status

**One P0 — W3-REL-D1, confirmed by the coordinator.** `public.is_org_admin(org)` is `select org_role_of(org) in ('owner','admin')`; for a non-member `org_role_of` is NULL, so the function returns NULL, and `if not public.is_org_admin(x) then raise …` never fires. Any authenticated user of another organization can call these security-definer RPCs against org A with their own JWT (PostgREST `/rpc/…`; REST routes are protected by middleware):

`create_api_credential`, `revoke_api_credential`, `create_webhook_endpoint`, `revoke_webhook_endpoint`, `set_webhook_endpoint_enabled`, `send_webhook_test`, `retry_webhook_delivery`, `retry_delivery`, `replace_scope_grants`, `member_effective_access`, `explain_capability`, `move_service_type`, `move_service_type_folder`, `preview_folder_move`, `preview_service_type_move`, `resolve_person_reconciliation`, `private.guard_service_type_folder` (live `pg_proc` scan), plus `cancel_release_batch` (`not (created_by = uid or is_org_admin(...))` → `not (false or NULL)` = NULL).

Exercised by QA-07: cross-org credential created and used, delivery re-queued, scheduled release cancelled, grants read. `is_org_admin` is the only boolean helper built on `org_role_of`. Fix: make it NULL-safe (`coalesce(…, false)`) in a new migration, add a SQL test calling each RPC as an outsider, and audit other `not <fn>(` guards whose helper can return NULL.

No cross-tenant leak, prepared-assignment leak or private-field exposure in notes, chat, files, Storage, feeds, public pages, exports, API or webhook payloads. ~150 Live races, concurrent releases/workers, file version races and bulk/merge/import races held their invariants.

## PM triage

Every P1 below was checked against source by the coordinator.

### Fix now — P0/P1

| ID | Summary | Decision |
|---|---|---|
| W3-REL-D1 (P0) | NULL `is_org_admin` lets outsiders call 18 admin RPCs | NULL-safe helper + outsider SQL test for each RPC |
| W3-LIVE-D1 | Same NULL pattern: `v_holds` is NULL when no controller, so `if not v_holds` passes — any plan editor can pause/resume/end/set_policy a vacant run (`20261029000000_f12_live_runs.sql:446`) | `coalesce(…, false)`; reject set_policy on ended runs |
| W3-MSG-D3 | Notification `next_cursor` is `+00:00` but `before: z.string().datetime()` rejects offsets → mobile can't page notifications (`packages/shared/src/schemas/notification.ts:21`) | Accept offsets (`datetime({ offset: true })`) |
| W3-REL-D2 (+ W3-MSG-D2 P2) | Keyset paging on `created_at` only skips tied rows: deliveries page 2 empty (5/8 unreachable); comments/chat/notifications drop ties | Composite `(created_at, id)` cursor |
| W3-INT-D2 | `REPORT_ROW_LIMIT` 2000 > PostgREST `max_rows` 1000 → reports/exports silently cut at 1000 with `truncated=false` | Page loaders in 1000-row chunks (or `range`) and compute truncation honestly |
| W3-INT-D8 | Postgres `least(NULL, 86400)` = 86400, so retries without Retry-After wait ~24 h (`20261103000000_f17_developer_api.sql:875`) | `case when p_retry_after_seconds is null …` |
| W3-INT-D10 | `redactTokenPath` redacts `scoped` instead of the token in `/calendar-feed/scoped/<token>.ics`; public slugs logged | Add scoped-feed and public-slug prefixes to `backend/src/lib/redact.ts` |

### Fix now — P2 (one hygiene pass)

- Raw Postgres detail leaks: constraint error returns failing row incl. idempotency key (W3-LIVE-D2); NUL byte → 500 `22P05` (W3-FILE-D3); webhook URL "not a url" → 500 (W3-INT-D6).
- PostgREST self-writes that should be blocked: own notification title/body (W3-MSG-D10), own feed `token_hash`/un-revoke (W3-INT-D1).
- Org context: conversation post/edit/delete/read/mute/report ignore `X-Organization-Id` (W3-MSG-D4, downgraded from P1 — RLS still requires membership of the conversation's org).
- Wrong-path writes: item comment edit/delete through another item path mutates then 404s (W3-MSG-D1).
- Idempotency: reused key with a different payload on `/files/links` and `/files/documents` returns the original 201 (W3-FILE-D2); same-key concurrent release false 409 ~1–2% (W3-REL-D3).
- Archived message template still sendable (W3-MSG-D7); `GET /messages` has no cursor (W3-MSG-D8); recipients read sender audience row (W3-MSG-D5); unauthorized template edit returns 409 `template_stale` (W3-MSG-D6); notifications keep snippet after team removal (W3-MSG-D9).
- Song/chart: stale-revision retry loops on 409 (W3-SONG-D7), no unload guard in chart editor (D11), invalid transpose `to` returns 200 untransposed (D13), chord collision (D9), capo not shown (D10), `{comment}` dropped (D12), misleading delete/validation messages (D6, D8), DELETE nonexistent → 204 (D1), empty PATCH → 404 (D2), song without default arrangement (D3).
- Reports: participation summary lacks `unknown` total (W3-LIVE-D3); CSV preamble lists irrelevant filters (W3-LIVE-D4); CSV has no UTF-8 BOM (W3-INT-D3).
- Delivery: reminder recompute queue drains only 50 plans per run (W3-REL-D4); release preview claims push for a login with no device (W3-REL-D6).
- Uploads: signed URL accepts bytes after `/abandon` (W3-FILE-D1, sweeper cleans up).
- External API `GET /plans/{non-uuid}` → 400 vs documented 404 (W3-INT-D5); plan created as `published` emits no `plan.published` (W3-INT-D7); personal feed can't be revoked without replacement (W3-INT-D9).

### Product decisions needed

- Any active member can read **draft** plans (`plans_select` = `is_org_member`) — plan oracle says "view only when entitled" (QA-10 observation).
- `media.manage` writes files on every parent kind (plan/song/arrangement/service type), not only media bundles (QA-10).
- Librarian cannot merge songs referenced by plans (W3-SONG-D4); merged alias shows as plain "Archived" (D5); deleting a song removes dormant songbook items (D14).
- Re-publishing revives the old public URL (W3-INT-D4).
- Reminders stay scheduled when a plan returns to draft (QA-07 O-list).
- Time preview hash unusable when a new time has no client id (W3-REL-D5, plans area).

## Environment findings

- `CRON_SECRET` and `INTEGRATION_SECRET_KEY` are unset in `backend/.env`, so the HTTP worker route is 404 and webhooks are 503 on :4000. Agents used temporary instances (:4001, :4591, :4592), all stopped.
- Supabase CLI 3.2.0 cannot read `supabase/config.toml` (`inbucket` → `local_smtp`); `supabase status`/`db reset`/`migration up` fail until the config is updated.
- Worker runs drained ~1,360 queued reminder recomputes and moved 16 `qa-20261117-resp-a` deliveries to terminal states.

## Not covered (next wave)

QA-13 native parity (beyond the wave-2 subset), QA-14 physical-device/offline, QA-15 accessibility/i18n/perf, QA-16 journeys. Within wave 3: all web UI steps except QA-09's, print/PDF export downloads, real email/push provider faults, email HTML escaping (no mail sink), `signups` message audience, upload sweeper, f12/f16 SQL suites (seed-org fixtures), DNS-rebinding webhook test.

## Fixtures left in place

Orgs `qa-20261118-{rel,msg,song,file,live,int}-{a,b}` and their `*.qa20261118.<pkg>@example.test` users. One Live run left live (live-a); pending-a's assignment declined (file-a). All QA-12 feed tokens, publications, API keys and webhooks revoked; 5 orphan export files noted in integrations.md. Credentials only in agent scratchpads.
