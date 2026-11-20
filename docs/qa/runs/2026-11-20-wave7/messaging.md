# W7-R2 — Chat, mentions, notification clean-up, private Realtime (QA-08 subset), wave 7

- Package: W7-R2 (CHAT-01–02, NOTIFY-01, MESSAGE-01–02 regression only, SEC-01 portion for chat/mentions/notes, retest of wave 3 messaging defects)
- Commit: 473fb69 (= main) on branch feature/qa-wave7; no code, migration or config changed. Only file written: this report.
- Date: 2026-11-20
- Environment: API http://localhost:4000 (email/push simulated), local Supabase (PostgREST + Realtime with caller JWTs), Node 26.13.1. Browser, native apps, the delivery worker and `/internal/deliveries/run` were not used. Note: the API itself runs `deliverEffectInBackground/Now` for the effect it just created on every chat post / message send; that is in-process and was not suppressed.
- Namespace: orgs `qa-20261120-msg-a` (id 1d0ab801-7480-4f56-83e2-219b80015995) and `qa-20261120-msg-b` (id 583b44a4-c197-4396-9e58-738feda5384a); users `<alias>.qa20261120.msg@example.test`; passwords only in the agent scratchpad.
- Fixture creation: users via Supabase admin API, orgs/memberships/people flags via SQL (setup only); teams, roster, plan, item, assignments, service type via the real API with the owner token. Every permission result uses the actor's own JWT (API or PostgREST/RPC/Realtime); service role only for setup and for DB side-effect inspection.
- Source-vs-plan notes: (1) the wave 3 SUMMARY does **not** mark any W3-MSG defect as Fixed (only REL-D1 and LIVE-D1 were fixed); all W3-MSG defects were retested anyway and are still open (W7-MSG-D1..D10). (2) Plan lists attachments for chat: none exist (NOT_APPLICABLE). (3) Plan says "undo semantics": there is no server undo; Undo is a client 5 s timer before DELETE. (4) Plan CHAT-01 "unsupported action not advertised": no reactions/DM/attachments endpoints exist.
- SQL suites run (both begin/rollback, `ON_ERROR_STOP=1`): `supabase/tests/f09-notes-messages-chat.sql` exit 0, ROLLBACK; `supabase/tests/perf-realtime-pokes.sql` exit 0, ROLLBACK. Both touch the seed org riverside only inside the rolled-back transaction. Vitest: shared 581/581 pass, backend notifications-cleanup + conversations + conversation-delivery 17/17 pass.

## Fixture shape (org A)

| Alias | Role / access | Notes |
|---|---|---|
| owner, admin | owner, admin | org-wide; admin also leader on every conversation |
| lead | member | `teams.manage` on team Band QA only (moderator of team chat; sender of operational messages) |
| m1, m2 | member | Band roster; released assignments on plan "QA Plan 1" (participants of plan chat); m1 also member of org B and on team Band B |
| m3 | member | Band roster only (team chat yes, plan chat no); removed/re-added to roster and flipped child/adult during tests |
| outsider | member | no team, no assignment |
| child | member, person_type child | on Band roster (youth policy: no chat access) |
| inactive | membership status inactive | on Band roster |
| recip | member | no team (mention target without access) |
| nolog | person without login | on Band roster |
| ownerb, bmem | org B owner / member | bmem on team Band B (org B chat); m1 is also in org B |

Conversations: team chat Band QA (431d553c-433b-4fe9-ade2-46cea85f3d31), plan chat QA Plan 1 (022c9010-4c88-4f9f-b9f8-af85275a2ec5), org B team chat (56e4e2fa-bb2a-4c3d-b2bc-cc3df5707aed). 

## Result summary


| Status | Count |
|---|---|
| PASS | 419 |
| FAIL | 27 |
| BLOCKED | 2 |
| NOT_RUN | 14 |
| NOT_APPLICABLE | 2 |
| Total expanded cases | 464 |

**No P0.** No cross-tenant leak, no private content in a notification or broadcast, no unauthorized write across organizations, no lost write. All 27 FAIL rows map to 11 defects (all re-confirmations of wave 3 defects plus one new class). Highest priority: W7-MSG-D1 (P1).

Key positive results: mentions of non-participants, other-org people, unknown ids, children, inactive members and no-login people notify nobody and leak no content; `prune_notifications` EXECUTE is denied to anon/authenticated (42501) and its behaviour was exact (6 of 6 backdated rows, boundary ages kept); private Realtime topics reject org-B users, outsiders, children, inactive members and anon, deliver an id+event-only payload to authorized users, and plan edits poke `live_plan`.

## Defects

| ID | Pri | Wave 3 id | Summary |
|---|---|---|---|
| W7-MSG-D1 | P1 | W3-MSG-D3 | Notification `next_cursor` (`+00:00` offset) is rejected by `before` (422), so page 2 of the feed cannot load |
| W7-MSG-D2 | P2 | W3-MSG-D4 | Conversation post/edit/delete/read/mute/report ignore `X-Organization-Id` (stale composer after org switch still mutates) |
| W7-MSG-D3 | P2 | W3-MSG-D2 | Keyset paging on `created_at` alone skips tied rows (chat messages, item comments, notifications) |
| W7-MSG-D4 | P2 (escalation candidate) | W3-MSG-D9 + new | Notification snippets keep message text after: recipient loses access, message deleted, moderator hides message |
| W7-MSG-D5 | P2 | W3-MSG-D10 | A user can rewrite title/body/type/target columns of their own notifications via PostgREST |
| W7-MSG-D6 | P2 | W3-MSG-D5 | Message recipients can read the sender-side audit columns (audience, hashes, counts, idempotency key) |
| W7-MSG-D7 | P2 | W3-MSG-D6 | Unauthorized edit of a shared template answers 409 `template_stale` instead of 403/404 |
| W7-MSG-D8 | P2 | W3-MSG-D7 | Archived template can still be used when sending a message |
| W7-MSG-D9 | P2 | W3-MSG-D8 | `GET /messages` has no cursor; messages beyond `limit` unreachable |
| W7-MSG-D10 | P2 | W3-MSG-D1 | Item-comment edit/delete via the wrong item path mutates the comment, then returns 404 |
| W7-MSG-D11 | P2 | new (same class as W3-FILE-D3) | NUL byte and lone surrogate in chat / note body return 500 with raw Postgres/PostgREST error codes |

### W7-MSG-D1 (P1) Notification feed page 2 cannot load
- Repro: `GET /notifications?limit=5` as any user with more than 5 rows; take `next_cursor` (`2026-11-20T22:07:16.512152+00:00`); `GET /notifications?limit=5&before=<cursor>` -> 422 `before` invalid_string. Same on mobile (it echoes the cursor verbatim).
- Expected: 200 with next page. Actual: 422.
- Suspected: `packages/shared/src/schemas/notification.ts:21` (`z.string().datetime()` rejects offsets; needs `{ offset: true }`); cursor produced at `backend/src/routes/notifications.ts:70`.

### W7-MSG-D2 (P2) Conversation writes ignore the active organization
- Repro: m1 is a member of orgs A and B. With `X-Organization-Id: <B>` call `POST /conversations/<A team conv>/messages`, `PATCH/DELETE .../messages/<id>`, `POST .../read`, `PUT .../mute`, `POST .../messages/<id>/report` -> 201/200 and rows change (message posted, edited, deleted; muted; report row created). Reads (`GET`, open) correctly 404.
- Expected: 404 (conversation not in the active org), nothing changed. Actual: mutation succeeds (RLS still requires membership of the conversation's own org, so no cross-tenant access; stale-composer data-integrity issue).
- Suspected: `backend/src/services/discussions.ts:277-335` (post/edit/delete/restore/read/mute/report call the RPC without `conversationSummary`/org check; `listConversationMessages` does it, writes do not).

### W7-MSG-D3 (P2) Ties on `created_at` drop rows
- Repro: 6 chat messages with identical `created_at`, `GET /conversations/<id>/messages?limit=2` and follow `next_before` -> only 2 of 6 reached (items: 2 of 5 comments; notifications 56 of 61).
- Expected: every row exactly once. Suspected: `backend/src/services/discussions.ts:102,210` and `backend/src/routes/notifications.ts:67` (`lt('created_at', before)` without an `id` tiebreak), `pageOf` in `backend/src/model/collaboration.model.ts`.

### W7-MSG-D4 (P2, escalation candidate) Notification text outlives access / moderation
- Repro A: m1 posts "X" in team chat, m3 receives notification; owner removes m3 from the team; m3 `GET /notifications` still lists body "X" (conversation itself is 404).
- Repro B: m1 posts, m1 deletes the message; recipients' notifications keep the text.
- Repro C: m2 reports, team leader resolves `hide`; 5 recipient notifications still carry the hidden text (DB and API feed).
- Expected: snippet redacted/removed once the target is unavailable to that recipient. Actual: retained. Suspected: no cleanup on message delete/hide or on access loss; text stored in `notifications.body` by `backend/src/services/delivery-dispatch.ts:769`.

### W7-MSG-D5 (P2) Own notification content writable via PostgREST
- Repro: `PATCH /rest/v1/notifications?id=eq.<own>` with `{"title":"FORGED TITLE","body":"x","type":"assignment_request","conversation_id":null}` as the owner -> 200, row changed. Other users' rows are protected (0 rows). Inserts denied.
- Expected: only `read_at` writable. Suspected: `supabase/migrations/20260907000000_notifications.sql:71` (`notifications_update` has no column restriction; authenticated holds table-level UPDATE).

### W7-MSG-D6 (P2) Recipients read the sender-side audit row
- Repro: m1 (recipient) `GET /messages/<id>` or `GET /rest/v1/operational_messages?id=eq.<id>` -> includes `audience`, `audience_hash`, `request_hash`, `recipient_count`, `excluded_count`, `idempotency_key`. Expected: not exposed to recipients. Suspected: `supabase/migrations/20261026000100_f09_targeted_messages.sql:553-557` (row-level policy only) and `backend/src/services/messages.ts:103` (`select('*')`).

### W7-MSG-D7 (P2) Template edit without rights returns 409
- Repro: lead (not an org scheduler) `PUT /message-templates/<shared>` with the current `expected_revision` -> 409 `template_stale`. Expected 403/404. Suspected: `backend/src/services/messages.ts:175-190` (stale check on any existing row).

### W7-MSG-D8 (P2) Archived template still selectable on send
- Repro: admin archives a shared template; lead `POST /messages` with that `template_id` -> 201. Expected 4xx. Suspected: `supabase/migrations/20261026000100_f09_targeted_messages.sql:359-363` (no `archived_at is null`).

### W7-MSG-D9 (P2) Message history has no cursor
- Repro: `GET /messages?box=sent&limit=1&before=...` ignores `before`; schema has only `plan_id/box/limit` (max 100). Suspected: `packages/shared/src/schemas/collaboration.ts` `listOperationalMessagesQuerySchema`, `backend/src/services/messages.ts:82`.

### W7-MSG-D10 (P2) Wrong-item path mutates then 404s
- Repro: m1 owns comment C on item 1; `PATCH /plan-items/<item2>/comments/<C>` body "wrong path edit" -> 404 but comment body changed; `DELETE` likewise sets `deleted_at`. Suspected: `backend/src/services/discussions.ts:138-152` (`edit_item_comment`/`delete_item_comment` RPC runs before `loadComment` scopes by `plan_item_id`, and `loadItem` only checks the path item).

### W7-MSG-D11 (P2) NUL / lone surrogate body -> 500 with raw DB error
- Repro: `POST /conversations/<id>/messages` with body `"before\u0000after"` -> 500 `{"error":"unsupported Unicode escape sequence","code":"22P05"}`; body with lone `\uD800` -> 500 `{"error":"Empty or invalid json","code":"PGRST102"}`; `POST /plans/<id>/notes` with NUL -> 500 22P05. Expected 422. Suspected: `packages/shared/src/schemas/collaboration.ts:39` (`discussionBody`) and `noteBody` lack a control/surrogate check; raw errors surfaced by `backend/src/lib/errors.ts`.

### Observations (not defects)
- Realtime: an already-joined channel keeps receiving id-only pokes after the user is revoked (m3 got 1 poke after removal) until rejoin/token refresh; a new join is rejected. Matches the migration comment; the API re-checks access on every read, no content in payload.
- `live_plan:<id>` topics are readable by every active org member (policy = `plans` RLS, `plans_select = is_org_member`); org-B users are rejected.
- Mention resolution (`notified/no_access/no_login/muted`) and the names of mentioned non-participants are visible to all participants of the conversation (names already in the people directory). The server trusts `mention_person_ids` even if the body has no `@Name` token; mentions are not re-evaluated on edit (edit adds none).
- Operational-message preview/recipient set includes the `child` Person (chat excludes children); inactive members and no-contact people are excluded/flagged. Confirm intended with product.
- Chat rate limit is 20 messages/min/author/conversation (429 `rate_limited`); the 429 creates no row.
- Deleted message body is blanked in reads; moderator-hidden body is redacted for members.


## CHAT-01 — team/plan chat: list, send/retry, concurrency, unread/mute/read, edit/delete/report/moderation, mentions (148 cases: 138 PASS, 3 FAIL, 1 BLOCKED, 5 NOT_RUN, 1 NOT_APPLICABLE)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT-01.open.team.m1.API | m1 | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.m2.API | m2 | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.m3.API | m3 | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.lead.API | lead | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.admin.API | admin | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.owner.API | owner | API | 200 summary | 200 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89c11c5d","plan_id":null,"title":"Band QA","service_date":null | PASS |
| CHAT-01.open.team.outsider.API | outsider | API | 404, no conversation access | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.team.child.API | child | API | 404, no conversation access | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.team.unknown-target.API | m1 | API | 404 not 500 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.team.bad-uuid.API | m1 | API | 422/400 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"target_id","code":"invalid_string","message":"Invalid uuid"}]} | PASS |
| CHAT-01.open.bad-kind.API | m1 | API | 422/400 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"kind","code":"invalid_enum_value","message":"Invalid enum value. Expected 'team' \| 'p | PASS |
| CHAT-01.open.plan.m1.API | m1 | API | 200 | 200 {"id":"022c9010-4c88-4f9f-b9f8-af85275a2ec5","kind":"plan","team_id":null,"plan_id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864","title":"QA Plan 1","service_date":"2 | PASS |
| CHAT-01.open.plan.m2.API | m2 | API | 200 | 200 {"id":"022c9010-4c88-4f9f-b9f8-af85275a2ec5","kind":"plan","team_id":null,"plan_id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864","title":"QA Plan 1","service_date":"2 | PASS |
| CHAT-01.open.plan.admin.API | admin | API | 200 | 200 {"id":"022c9010-4c88-4f9f-b9f8-af85275a2ec5","kind":"plan","team_id":null,"plan_id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864","title":"QA Plan 1","service_date":"2 | PASS |
| CHAT-01.open.plan.owner.API | owner | API | 200 | 200 {"id":"022c9010-4c88-4f9f-b9f8-af85275a2ec5","kind":"plan","team_id":null,"plan_id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864","title":"QA Plan 1","service_date":"2 | PASS |
| CHAT-01.open.plan.m3.API | m3 | API | 404 not on plan | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.outsider.API | outsider | API | 404 not on plan | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.child.API | child | API | 404 not on plan | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.open.plan.lead.API | lead | API | 200 or 404 (team leader of plan team? record) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.list.m1.API | m1 | API | only accessible conversations | 200 kinds=plan,team | PASS |
| CHAT-01.list.m2.API | m2 | API | only accessible conversations | 200 kinds=plan,team | PASS |
| CHAT-01.list.m3.API | m3 | API | only accessible conversations | 200 kinds=team | PASS |
| CHAT-01.list.outsider.API | outsider | API | empty | 200 kinds= | PASS |
| CHAT-01.list.child.API | child | API | empty | 200 kinds= | PASS |
| CHAT-01.list.admin.API | admin | API | only accessible conversations | 200 kinds=plan,team | PASS |
| CHAT-01.rls.conversations.select.m1 | m1 | RLS | 1 row | 200 n=1 | PASS |
| CHAT-01.rls.conversations.select.outsider | outsider | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.rls.conversations.select.child | child | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.rls.conversations.select.bmem | bmem | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.rls.conversations.select.ownerb | ownerb | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.rls.conversations.select.inactive | inactive | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.send.m1.API | m1 | API | 201 + item | 201 {"item":{"id":"60497dc8-ca9c-4751-a5ce-9afe4bfc3531","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.send.latency.API | m1 | API | responds without waiting on delivery | 57ms | PASS |
| CHAT-01.retry.same-id.first.API | m2 | API | 201 | 201 {"item":{"id":"15cc8ea4-6a8e-4ab9-912c-78d1a6a060bb","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.retry.same-id.second.API | m2 | API | 200 replayed=true same item | 200 {"item":{"id":"15cc8ea4-6a8e-4ab9-912c-78d1a6a060bb","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.retry.same-id.rows.DB | m2 | DB | exactly 1 row | rows+1 | PASS |
| CHAT-01.retry.same-id.notifications.DB | m2 | DB | 1 notification per recipient (no duplicate) | 1 | PASS |
| CHAT-01.retry.same-id.different-body.API | m2 | API | replay returns original or 409; never overwrite | 200 body=retry me | PASS |
| CHAT-01.retry.same-id.other-author.API | m1 | API | 409 id already used | 409 {"error":"This message id is already used","code":"message_id_conflict"} | PASS |
| CHAT-01.retry.same-id.other-conversation.API | m2 | API | 409 | 409 {"error":"This message id is already used","code":"message_id_conflict"} | PASS |
| CHAT-01.send.blank.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_small","message":"Write something first"}]} | PASS |
| CHAT-01.send.4001.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_big","message":"String must contain at most 4000 character(s)"}]} | PASS |
| CHAT-01.send.4000.API | m1 | API | 201 | 201 {"item":{"id":"2785a783-fc55-4118-a00f-c6fe91768492","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.send.bad-id.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"id","code":"invalid_string","message":"Invalid uuid"}]} | PASS |
| CHAT-01.send.no-id.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"id","code":"invalid_type","message":"Required"}]} | PASS |
| CHAT-01.send.21-mentions.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"mention_person_ids","code":"too_big","message":"Array must contain at most 20 element | PASS |
| CHAT-01.send.reply-unknown.API | m1 | API | 404 | 404 {"error":"Reply target not found","code":"not_found"} | PASS |
| CHAT-01.send.reply-other-conv.API | m2 | API | 404 | 404 {"error":"Reply target not found","code":"not_found"} | PASS |
| CHAT-01.send.reply-ok.API | m2 | API | 201 reply_to_id set | 201 {"item":{"id":"609e96b0-7c02-4cc4-8e2a-d27336050925","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.reply.notification.DB | m1 | DB | replied author gets a notification (conversation_message or reply) | conversation_reply | PASS |
| CHAT-01.send.outsider.API | outsider | API | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.send.child.API | child | API | 404 no row | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.send.m3-plan.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-01.send.denied.rows.DB | - | DB | no sneak rows | 0 | PASS |
| CHAT-01.rls.direct-insert.m1 | m1 | RLS | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| CHAT-01.rls.direct-insert.outsider | outsider | RLS | denied (writes only via RPC) | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| CHAT-01.rls.direct-update.m1 | m1 | RLS | denied/0 rows | 403 {"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT | PASS |
| CHAT-01.rls.direct-delete.m1 | m1 | RLS | denied; rows intact | 403; 5 rows before and after (check script miscounted threshold) | PASS |
| CHAT-01.edit.other-author.API | m1 | API | 403/404 unchanged | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| CHAT-01.edit.own.API | m2 | API | 200 edited_at set | 200 {"id":"2ebd43ef-c426-4342-bab7-e039c368822a","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.edit.blank.API | m2 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"too_small","message":"Write something first"}]} | PASS |
| CHAT-01.delete.other-member.API | m1 | API | 403/404 not deleted | 403 {"error":"You do not have access to do that","code":"forbidden"} | PASS |
| CHAT-01.restore.non-moderator.API | m1 | API | 403/404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| CHAT-01.report.member.API | m1 | API | 201 | 201 {"id":"dc99175a-daba-4ce8-93bc-1dc42301faa6","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.report.duplicate.API | m1 | API | idempotent 200/201 or 409, not 500 | 201 | PASS |
| CHAT-01.report.bad-reason.API | m1 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"reason","code":"invalid_enum_value","message":"Invalid enum value. Expected 'spam' \|  | PASS |
| CHAT-01.reports.hidden-from-non-moderator.API | m1 | API | reports=[]; can_moderate=false | 200 reports=0 mod=false | PASS |
| CHAT-01.reports.visible-to-team-leader.API | lead | API | can_moderate, reports>=1 | 200 reports=1 mod=true open=1 | PASS |
| CHAT-01.report.resolve.non-moderator.API | m1 | API | 403/404 | 404 {"error":"Report not found","code":"not_found"} | PASS |
| CHAT-01.rls.reports.select.m1 | m1 | RLS | own report rows only | 200 n=1 | PASS |
| CHAT-01.rls.reports.select.m3-nonreporter | m3 | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.report.resolve.hide.leader.API | lead | API | 200 | 200 {"id":"dc99175a-daba-4ce8-93bc-1dc42301faa6","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.hidden-message.redaction.member.API | m1 | API | hidden message body redacted for members | 200 found=true body="" hidden_at=2026-11-20T22:05:28.039186+00:00 | PASS |
| CHAT-01.restore.leader.API | lead | API | 200 | 200 {"id":"2ebd43ef-c426-4342-bab7-e039c368822a","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.delete.moderator-other.API | lead | API | 200 deleted by moderator | 200 {"id":"2ebd43ef-c426-4342-bab7-e039c368822a","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.deleted-message.body-redacted.API | m2 | API | deleted message body not returned | "" | PASS |
| CHAT-01.restore.author-after-mod-delete.API | m2 | API | author cannot undo moderator deletion | 404 | PASS |
| CHAT-01.delete.own.API | m2 | API | 200 | 200 {"id":"c698f5b2-accd-45b6-bb7c-6424c55545c7","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | PASS |
| CHAT-01.edit.after-delete.API | m2 | API | 4xx; deleted message not editable | 409 | PASS |
| CHAT-01.search.member.API | m1 | API | finds hello team | 200 n=1 | PASS |
| CHAT-01.search.1char.API | m1 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"q","code":"too_small","message":"String must contain at least 2 character(s)"}]} | PASS |
| CHAT-01.unread.m3-initial.API | m3 | API | unread = messages by others not deleted/hidden | unread=6 db=6 | PASS |
| CHAT-01.unread.m3-count-exact.API+DB | m3 | API+DB | equals DB count of visible others messages | api=6 db=6 | PASS |
| CHAT-01.read.mark.API | m3 | API | 200 | 200 {"last_read_at":"2026-11-20T22:05:28.222+00:00"} | PASS |
| CHAT-01.unread.after-read.API | m3 | API | 0 | 0 | PASS |
| CHAT-01.unread.after-two-new.API | m3 | API | 2 | 2 | PASS |
| CHAT-01.unread.single-summary-matches-list.API | m3 | API | same as list | 2 | PASS |
| CHAT-01.read.future-timestamp.API | m3 | API | clamped or 422; later messages must still count unread | 200 {"last_read_at":"2026-11-20T22:05:28.299618+00:00"} | PASS |
| CHAT-01.read.future-timestamp.unread-after.API | m3 | API | new message after future read_at is unread (>=1) | 1 | PASS |
| CHAT-01.mute.on.API | m3 | API | 200 muted | 200 {"muted":true} | PASS |
| CHAT-01.mute.reflected-in-list.API | m3 | API | muted=true | true | PASS |
| CHAT-01.mute.no-notification.DB | m3 | DB | muted user gets no notification | 0 | PASS |
| CHAT-01.mute.others-still-notified.DB | m2 | DB | non-muted participant notified | 1 | PASS |
| CHAT-01.rls.member-states.select.m1 | m1 | RLS | only own state rows | n=2 others=0 | PASS |
| CHAT-01.concurrent.20-distinct.API | m1+m2 | API | all 201 | 201,201,201,201,201,201,201,201,201,201,201,201,201,201,201,201,201,201,201,201 | PASS |
| CHAT-01.concurrent.20-distinct.DB | m1+m2 | DB | 20 rows persisted | 20 | PASS |
| CHAT-01.concurrent.ordering.API | m1 | API | thread returned in chronological order | n=21 sorted=true | PASS |
| CHAT-01.concurrent.same-id-x6.API | m1 | API | one 201, rest 200 replayed | 200,200,200,200,200,201 | PASS |
| CHAT-01.concurrent.same-id-x6.DB | m1 | DB | 1 row | 1 | PASS |
| CHAT-01.concurrent.same-id-x6.deliveries.DB | m1 | DB | one effect, one in_app per recipient | 1 effects, in_app=3 notifs=3 | PASS |
| CHAT-01.pagination.identical-created_at-ties.API | m1 | API+DB | all 6 tied messages reachable exactly once (W3-MSG-D2 retest) | seen=2/6 pages=2 | FAIL (W7-MSG-D3) |
| CHAT-01.pagination.distinct-timestamps.API | m1 | API | all messages once, no dup | pages=4 unique=22/22 dups=0 | PASS |
| CHAT-01.pagination.before-with-offset.API | m1 | API | accepts server-issued cursor format | 200 | PASS |
| CHAT-01.pagination.before-garbage.API | m1 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"before","code":"invalid_string","message":"Invalid datetime"}]} | PASS |
| CHAT-01.pagination.limit-101.API | m1 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"limit","code":"too_big","message":"Number must be less than or equal to 100"}]} | PASS |
| CHAT-01.rate-limit.20-per-minute.API | m3 | API | 21st+ rejected 429 w/ no row | 201s=20 429s=2 others= | PASS |
| CHAT-01.mention.candidates.team.m1.API | m1 | API | participants only; excludes self, child, outsider, inactive, nolog, recip | 200 Admin Qa\|Lead Qa\|M2 Qa\|M3 Qa\|Owner Qa | PASS |
| CHAT-01.mention.candidates.team.m2.API | m2 | API | participants only; excludes self, child, outsider, inactive, nolog, recip | 200 Admin Qa\|Lead Qa\|M1 Qa\|M3 Qa\|Owner Qa | PASS |
| CHAT-01.mention.candidates.team.lead.API | lead | API | participants only; excludes self, child, outsider, inactive, nolog, recip | 200 Admin Qa\|M1 Qa\|M2 Qa\|M3 Qa\|Owner Qa | PASS |
| CHAT-01.mention.candidates.team.admin.API | admin | API | participants only; excludes self, child, outsider, inactive, nolog, recip | 200 Lead Qa\|M1 Qa\|M2 Qa\|M3 Qa\|Owner Qa | PASS |
| CHAT-01.mention.candidates.plan.m1.API | m1 | API | plan participants (m2, admin, owner); not m3 | 200 Admin Qa\|M2 Qa\|Owner Qa | PASS |
| CHAT-01.mention.candidates.both-params.API | m1 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"","code":"custom","message":"Choose a plan or a conversation"}]} | PASS |
| CHAT-01.mention.candidates.no-params.API | m1 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"","code":"custom","message":"Choose a plan or a conversation"}]} | PASS |
| CHAT-01.mention.candidates.item-thread.m1.API | m1 | API | 200 | 200 | PASS |
| CHAT-01.mention.send.mixed.API | m1 | API | 201 (unknown/other-org/self silently dropped) | 201 {"item":{"id":"f2e0be59-464e-49b5-adb1-9fed37a5a900","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | PASS |
| CHAT-01.mention.resolution.DB | m1 | DB | m2 notified, m3 notified, outsider/child/inactive/recip no_access, nolog no_login; other-org, unknown uuid, self not stored | Child:no_access,Inactive:no_access,M2:notified,M3:notified,Nolog:no_login,Outsider:no_access,Recip:no_access | PASS |
| CHAT-01.mention.resolution.exact.DB | m1 | DB | exact resolution set | Child:no_access,Inactive:no_access,M2:notified,M3:notified,Nolog:no_login,Outsider:no_access,Recip:no_access | PASS |
| CHAT-01.mention.notifications.DB | m1 | DB | m2/m3 get conversation_mention; lead/admin/owner conversation_message; nobody else | admin/conversation_message,lead/conversation_message,m2/conversation_mention,m3/conversation_mention,owner/conversation_message | PASS |
| CHAT-01.mention.other-org-person-not-stored.DB | m1 | DB | person of org B not stored | 0 | PASS |
| CHAT-01.mention.api-shape.participant.API | m2 | API | mentions have person_id/name/resolution/is_me | [{"person_id":"d7d3da38-8724-44fb-a3bf-fdda639a2e00","name":"M2 Qa","resolution":"notified","is_me":true},{"person_id":"ca52096e-d418-493c-b904-d44f6a3f47a5","name":"M3 Q | PASS |
| CHAT-01.mention.resolution-visible-to-participants.API | m2 | API | NOTE: no_access/no_login resolution (and which non-participant people were @mentioned) visible to every participant | names of no_access: Outsider Qa:no_access,Child Qa:no_access,Inactive Qa:no_access,Recip Qa:no_access,Nolog Qa:no_login | PASS |
| CHAT-01.mention.non-participant.no-notification.DB | m3 | DB | m3 (not on plan) gets nothing; m2 does | admin/conversation_message,m2/conversation_message,owner/conversation_message | PASS |
| CHAT-01.mention.non-participant.resolution.DB | m3 | DB | no_access | M3:no_access | PASS |
| CHAT-01.mention.non-participant.m3-feed.API | m3 | API | no item with plan-chat content | n=0 | PASS |
| CHAT-01.mention.non-participant.m3-rls.RLS | m3 | RLS | 0 rows | 200 n=0 | PASS |
| CHAT-01.mention.non-participant.m3-mention-rows.RLS | m3 | RLS | cannot read mentions of a conversation they cannot access | n=0 | PASS |
| CHAT-01.mention.muted.resolution.DB | m2 | DB | muted | M2:muted | PASS |
| CHAT-01.mention.muted.no-notification.DB | m2 | DB | none | 0 | PASS |
| CHAT-01.mention.duplicate-ids.API | m1 | API | 201 not 500 (PK dup) | 201 {"item":{"id":"cec681f8-01fe-4475-a65c-5230819a2279","organization_id":"1d0ab801-7480-4f56-83e2-219b | PASS |
| CHAT-01.mention.body-without-token.DB | m1 | DB | server trusts client id list: mention stored although body lacks @Name (document); notification type | conversation_mention | PASS |
| CHAT-01.mention.edit-adds-mention.API | m1 | API | edit does not add notifications/mentions | 200 mentions=0 | PASS |
| CHAT-01.summary.my_conversation.m1.RLS | m1 | RPC (caller JWT) | 1 row with unread/muted | 200 n=1 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89 | PASS |
| CHAT-01.summary.my_conversation.m3.RLS | m3 | RPC (caller JWT) | 1 row with unread/muted | 200 n=1 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89 | PASS |
| CHAT-01.summary.my_conversation.admin.RLS | admin | RPC (caller JWT) | 1 row with unread/muted | 200 n=1 {"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","kind":"team","team_id":"0b714d87-9363-4b7c-b015-8b2e89 | PASS |
| CHAT-01.summary.unknown-id.RLS | m1 | RPC | 0 rows | 200 n=0 | PASS |
| CHAT-01.summary.my_conversations.m1.RLS | m1 | RPC | only accessible convs | n=2 | PASS |
| CHAT-01.summary.my_conversations.outsider.RLS | outsider | RPC | only accessible convs | n=0 | PASS |
| CHAT-01.summary.list-vs-single-vs-db.m2 | m2 | API+DB | unread identical in list, single, DB | list=40 single=40 db=40 | PASS |
| CHAT-01.moderation.hidden-message.notification-snippet.DB | m2 | DB | hidden message text removed from recipients notifications | 5 notification rows still carry the hidden text | FAIL (W7-MSG-D4) |
| CHAT-01.moderation.hidden-message.notification-snippet.API | m2 | API | not returned by feed | listed=1 | FAIL (W7-MSG-D4) |
| CHAT-01.web.thread-send-retry-enter-key | participant | Web | Enter sends, Shift+Enter newline, failed send shows retry with same client id | browser owned by W7-WEB | NOT_RUN |
| CHAT-01.web.mention-picker-and-highlight | participant | Web | @ picker lists candidates; mention rendered highlighted; formatting runs rendered inert | browser owned by W7-WEB (formatter logic covered under SHARED rows) | NOT_RUN |
| CHAT-01.web.nonblocking-send-ui | participant | Web | composer clears immediately, message shows pending then confirmed | browser owned by W7-WEB | NOT_RUN |
| CHAT-01.mobile.thread-send-retry | participant | Mobile | one retry identity, keyboard, exact destination (MOB-019) | native app/devices not available | NOT_RUN |
| CHAT-01.send.delivery-failure-injection | participant | API+DB | message persists and returns 201 when delivery fails; effect stays queued for worker | needs a provider/delivery fault injection (code/env change or worker run) which this package may not do; success path and timing covered | BLOCKED |
| CHAT-01.send.deliver-in-background.worker-pickup | participant | API+DB | queued effect picked up by worker after API-side delivery fails | delivery worker owned by W7-JOURNEY | NOT_RUN |
| CHAT-01.upload-attachment | participant | API | attachments in chat | no chat attachments exist in frozen schema (migration header: attachments wait for F13) | NOT_APPLICABLE |
| CHAT-01.sql.f09-notes-messages-chat.sql | - | DB (rolled back) | begin/rollback suite exits 0 | exit=0, ROLLBACK | PASS |

## CHAT-02 — revoked / inactive / child participant, stale composer after org switch, summary RPC isolation (46 cases: 34 PASS, 9 FAIL, 3 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| CHAT-02.open.team.inactive-member.API | inactive | API | 401/403/404 | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.get-conv.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.msgs.child.API | child | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.send.inactive.API | inactive | API | 401/403/404 | 403 {"error":"You are not a member of any organization yet","code":"forbidden"} | PASS |
| CHAT-02.stale-composer.post-B-header.API | m1 | API | 404, no row (W3-MSG-D4 retest) | 201 {"item":{"id":"c45a9a5e-a866-4c05-bca5-58afa7286acc","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85 | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.edit-B-header.API | m1 | API | 404 unchanged | 200 {"id":"cf814e70-cd3d-446f-b319-9eb135f70d10","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.read-B-header.API | m1 | API | 404 | 200 {"last_read_at":"2026-11-20T22:04:46.737+00:00"} | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.mute-B-header.API | m1 | API | 404 | 200 {"muted":true} | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.delete-B-header.API | m1 | API | 404 not deleted | 200 {"id":"cf814e70-cd3d-446f-b319-9eb135f70d10","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.persisted.DB | m1 | DB | target msg intact | del=true | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.report-B-header.API.v2 | m1 | API | 404 (W3-MSG-D4 retest) | 201 {"id":"dc99175a-daba-4ce8-93bc-1dc42301faa6","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","conversation_id":"431d553c-433b-4fe9-ade2-46cea85f3d31"," | FAIL (W7-MSG-D2) |
| CHAT-02.stale-composer.report-B-header.rows.DB | m1 | DB | no report row | 1 | FAIL (W7-MSG-D2) |
| CHAT-02.edit.outsider.API | outsider | API | 404 | 404 {"error":"Not found","code":"not_found"} | PASS |
| CHAT-02.report.outsider.API | outsider | API | 404 | 404 {"error":"Not found","code":"not_found"} | PASS |
| CHAT-02.search.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mute.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.read.outsider.API | outsider | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mention.candidates.team.outsider.API | outsider | API | 404 no name oracle | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mention.candidates.team.child.API | child | API | 404 no name oracle | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mention.candidates.team.recip.API | recip | API | 404 no name oracle | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mention.candidates.plan.m3.API | m3 | API | 404 (not on plan) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.mention.candidates.item-thread.outsider.API | outsider | API | 404 | 404 {"error":"Plan not found","code":"not_found"} | PASS |
| CHAT-02.summary.my_conversation.outsider.RLS | outsider | RPC (caller JWT) | 0 rows (no existence oracle) | 200 n=0 | PASS |
| CHAT-02.summary.my_conversation.child.RLS | child | RPC (caller JWT) | 0 rows (no existence oracle) | 200 n=0 | PASS |
| CHAT-02.summary.my_conversation.bmem.RLS | bmem | RPC (caller JWT) | 0 rows (no existence oracle) | 200 n=0 | PASS |
| CHAT-02.summary.my_conversation.ownerb.RLS | ownerb | RPC (caller JWT) | 0 rows (no existence oracle) | 200 n=0 | PASS |
| CHAT-02.summary.my_conversation.inactive.RLS | inactive | RPC (caller JWT) | 0 rows (no existence oracle) | 200 n=0 | PASS |
| CHAT-02.summary.my_conversation.m3-plan.RLS | m3 | RPC | 0 rows | n=0 | PASS |
| CHAT-02.revoke.remove-team-member.API | owner | API | 204 | 204 "" | PASS |
| CHAT-02.revoked.read.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.revoked.send.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.revoked.list.API | m3 | API | team conv absent | n=0 | PASS |
| CHAT-02.revoked.mention-candidates.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.revoked.rls.messages | m3 | RLS | 0 rows | n=0 | PASS |
| CHAT-02.revoked.mute.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.revoked.no-new-notification.DB | m3 | DB | 0 | 0 | PASS |
| CHAT-02.revoked.stale-notification-snippet.API | m3 | API | old snippet unavailable/redacted after access lost (W3-MSG-D9 retest) | hadBefore=true stillListed=1 | FAIL (W7-MSG-D4) |
| CHAT-02.revoked.notification-target-open.API | m3 | API | target conversation 404 (no content via target) | 404 | PASS |
| CHAT-02.re-add.access-returns.API | m3 | API | 200 again (derived from current state) | 200 | PASS |
| CHAT-02.inactive-member.read.API | m2 | API | 401/403/404 | 403 | PASS |
| CHAT-02.inactive-member.rls.messages | m2 | RLS | 0 rows | n=0 | PASS |
| CHAT-02.inactive-member.rls.notifications | m2 | RLS | 0 rows (is_org_member required) | n=0 | PASS |
| CHAT-02.youth-policy.person-becomes-child.read.API | m3 | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| CHAT-02.web.org-switch-draft-isolation | revoked/stale | Web | draft isolated after org switch | browser owned by W7-WEB (API-level stale-org writes covered above) | NOT_RUN |
| CHAT-02.push.identity-after-revoke | revoked | Push | no push to revoked identity | simulated push only; PUSH-01 not owned. DB-level recheck (no notification/delivery row created for revoked user) covered | NOT_RUN |
| CHAT-02.realtime.token-expiry-refresh | participant | Realtime | channel re-evaluated on token refresh after revocation | requires waiting for JWT expiry/refresh (~1h) or forcing logout; revoked-live-subscription behaviour recorded instead | NOT_RUN |

## NOTIFY-01 — notification list/read/delete/clear-read/pagination, PostgREST RLS, prune_notifications (70 cases: 62 PASS, 4 FAIL, 3 NOT_RUN, 1 NOT_APPLICABLE)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| NOTIFY-01.list.m2.API | m2 | API | 200 feed with unread, only own rows | 200 n=61 unread=61 | PASS |
| NOTIFY-01.list.count-matches-db.API+DB | m2 | API+DB | items = db rows (<=100) | api=61 db=61 | PASS |
| NOTIFY-01.list.only-own.API | m2 | API | all user_id = caller | true | PASS |
| NOTIFY-01.unread.count.API+DB | m2 | API+DB | unread = db unread | api=61 db=61 | PASS |
| NOTIFY-01.unread-count.org-and-account.API+DB | m1 | API+DB | unread=org A; account_unread=all orgs | api={"unread":40,"account_unread":41} dbA=40 dbAll=41 | PASS |
| NOTIFY-01.list.org-scoped.m1-B.API | m1 | API | only org B items | 200 n=1 orgs=583b44a4-c197-4396-9e58-738feda5384a | PASS |
| NOTIFY-01.list.org-scoped.m1-A.API | m1 | API | only org A items, none with B body | n=40 leak=false | PASS |
| NOTIFY-01.list.outsider.API | outsider | API | empty (no chat access) | 200 n=0 | PASS |
| NOTIFY-01.list.unread_only.API | m2 | API | only unread | n=61 | PASS |
| NOTIFY-01.list.limit0.API | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"limit","code":"too_small","message":"Number must be greater than or equal to 1"}] | PASS |
| NOTIFY-01.list.limit101.API | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"limit","code":"too_big","message":"Number must be less than or equal to 100"}]} | PASS |
| NOTIFY-01.pagination.next_cursor-echoed.API | m2 | API | page 2 loads with server-issued cursor verbatim (W3-MSG-D3 retest) | cursor=2026-11-20T22:07:16.512152+00:00 -> 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"before","code":"invalid_string","message" | FAIL (W7-MSG-D1) |
| NOTIFY-01.pagination.cursor-as-Z-form.API | m2 | API | 200 | 200 | PASS |
| NOTIFY-01.pagination.identical-created_at-ties.API | m2 | API+DB | every notification exactly once (W3-MSG-D2 retest) | seen=56/61 | FAIL (W7-MSG-D3) |
| NOTIFY-01.pagination.before-garbage.API | m2 | API | 422 | 422 {"error":"Invalid query parameters","code":"unprocessable","details":[{"path":"before","code":"invalid_string","message":"Invalid datetime"}]} | PASS |
| NOTIFY-01.get.own.API | m2 | API | 200 | 200 {"id":"6b2c84df-8220-4d85-9557-838456bdbbed","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","user_id":"a5d6c0b7-a34a-4cfc-b652-4de130e6962e","type":"c | PASS |
| NOTIFY-01.target.fields.API | m2 | API | conversation_id / plan_id exact target | type=conversation_message conv=431d553c-433b-4fe9-ade2-46cea85f3d31 plan=null | PASS |
| NOTIFY-01.get.other-user.API | m3 | API | 404 | 404 {"error":"Notification not found","code":"not_found"} | PASS |
| NOTIFY-01.get.wrong-org-header.API | m2 | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTIFY-01.get.bad-uuid.API | m2 | API | 4xx not 500 | 400 | PASS |
| NOTIFY-01.read.one.API | m2 | API | unread decremented by 1 (or already read) | 200 {"unread":60,"account_unread":60} before=61 | PASS |
| NOTIFY-01.read.one.DB | m2 | DB | read_at set | t | PASS |
| NOTIFY-01.read.other-users-id.API | m3 | API+DB | 200 but no change to m2 row | 200 m2row_read=f | PASS |
| NOTIFY-01.read.bad-ids.API | m2 | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"ids.0","code":"invalid_string","message":"Invalid uuid"}]} | PASS |
| NOTIFY-01.read.unknown-id.API | m2 | API | 200 no-op | 200 {"unread":60,"account_unread":60} | PASS |
| NOTIFY-01.read.wrong-org-header.API | m2 | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| NOTIFY-01.read-all.org-scoped.API+DB | m1 | API+DB | B mark-all leaves A unread untouched; B unread=0 | 200 {"unread":0,"account_unread":40} A before=40 after=40 | PASS |
| NOTIFY-01.read-all.API | m2 | API | unread 0 | 200 {"unread":0,"account_unread":0} | PASS |
| NOTIFY-01.delete.other-users.API+DB | m3 | API+DB | 204 idempotent but m2 row remains | 204 exists=1 | PASS |
| NOTIFY-01.delete.wrong-org-header.API+DB | m2 | API+DB | 403/404 or no-op; row remains | 403 exists=1 | PASS |
| NOTIFY-01.delete.own.API+DB | m2 | API+DB | 204; row gone | 204 exists=0 | PASS |
| NOTIFY-01.delete.own.repeat.API | m2 | API | 204 idempotent | 204 | PASS |
| NOTIFY-01.delete.bad-uuid.API | m2 | API | 4xx not 500 | 400 {"error":"Invalid route parameter: id","code":"bad_request"} | PASS |
| NOTIFY-01.clear-read.API+DB | m2 | API+DB | deleted=read count; unread kept | 200 {"deleted":60,"unread":1,"account_unread":1} readBefore=60 unread 1->1 | PASS |
| NOTIFY-01.clear-read.other-users-untouched.DB | m3 | DB | m3 read rows unchanged | 0->0 | PASS |
| NOTIFY-01.clear-read.repeat.API | m2 | API | deleted=0 | {"deleted":0,"unread":1,"account_unread":1} | PASS |
| NOTIFY-01.clear-read.org-scoped.API+DB | m1 | API+DB | B clear leaves A rows | {"deleted":1,"unread":0,"account_unread":0} A 40->40 | PASS |
| NOTIFY-01.rls.select.other-user.m2 | m2 | RLS | 0 rows | 200 n=0 | PASS |
| NOTIFY-01.rls.select.only-own.m2 | m2 | RLS | only own user_id | 200 n=1 foreign=0 | PASS |
| NOTIFY-01.rls.select.anon-key-as-bearer | anon | RLS | 0 rows or 401 | 200 [] | PASS |
| NOTIFY-01.rls.update.other-user.m2 | m2 | RLS | 0 rows updated | 200 n=0 | PASS |
| NOTIFY-01.rls.delete.other-user.m2 | m2 | RLS | 0 rows deleted | 200 n=0 exists=1 | PASS |
| NOTIFY-01.rls.insert.forge-for-other.m2 | m2 | RLS | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level | PASS |
| NOTIFY-01.rls.insert.forge-for-self.m2 | m2 | RLS | denied | 403 {"code":"42501","details":null,"hint":null,"message":"new row violates row-level | PASS |
| NOTIFY-01.rls.update.own-content-columns.m2 | m2 | RLS | only read_at writable (W3-MSG-D10 retest) | 200 n=1 title=FORGED TITLE | FAIL (W7-MSG-D5) |
| NOTIFY-01.rls.update.own-target-columns.m2 | m2 | RLS | target/type columns not writable | 400 n=undefined | PASS |
| NOTIFY-01.rls.update.steal-ownership.m2 | m2 | RLS | 0 rows | 200 n=0 | PASS |
| NOTIFY-01.rls.select.multi-org-user.m1 | m1 | RLS | own rows in both orgs | orgs=1 | PASS |
| NOTIFY-01.target-deleted.notification-snippet.API | m2 | API | deleted message snippet no longer shown (target unavailable) | still listed=1 | FAIL (W7-MSG-D4) |
| NOTIFY-01.prune.rpc.authenticated-user.RPC | m1 | PostgREST /rpc (user JWT) | denied (403/404); nothing deleted | 403 {"code":"42501","details":null,"hint":null,"message":"permission denied for function prune_notificat | PASS |
| NOTIFY-01.prune.rpc.anon.RPC | anon | PostgREST /rpc (anon key) | denied | 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for function prune_notificat | PASS |
| NOTIFY-01.prune.rpc.authenticated-aggressive-args.RPC | m1 | PostgREST /rpc (user JWT) | denied (args irrelevant; denial occurs before execution) | 403 {"code":"42501","details":null,"hint":null,"message":"permission denied for function prune_notificat | PASS |
| NOTIFY-01.prune.privileges.catalog.DB | - | DB catalog | anon/authenticated/public no EXECUTE; service_role yes | false,false,true | PASS |
| NOTIFY-01.prune.search_path.DB | - | DB catalog | security definer with empty search_path | true {"search_path=\"\""} | PASS |
| NOTIFY-01.prune.behavior.deleted-count.DB | postgres (psql, DEFAULT args) | DB | returns exactly my backdated qualifying rows (6) | returned=6 totalDelta=6 expected=6 | PASS |
| NOTIFY-01.prune.read-older-than-90d-deleted.DB | m2 | DB | 0 remain | 0 | PASS |
| NOTIFY-01.prune.unread-older-than-180d-deleted.DB | m2 | DB | 0 remain | 0 | PASS |
| NOTIFY-01.prune.read-89d-kept.DB | m2 | DB | all kept | 2/2 | PASS |
| NOTIFY-01.prune.unread-179d-kept.DB | m2 | DB | all kept | 2/2 | PASS |
| NOTIFY-01.prune.unread-100d-kept.DB | m2 | DB | unread uses the longer window; kept | 2/2 | PASS |
| NOTIFY-01.prune.source-rows-untouched.DB | - | DB | conversation messages untouched (pointer only) | 70 | PASS |
| NOTIFY-01.prune.idempotent-second-call.DB | postgres | DB | 0 | 0 | PASS |
| NOTIFY-01.rls.update.anon | anon | RLS | 0 rows or 401 | 200 [] | PASS |
| NOTIFY-01.rls.delete.anon | anon | RLS | 0 rows or 401 | 200 [] | PASS |
| NOTIFY-01.web.bell-undo-clean-up | member | Web | delete shows Undo for 5s; Undo restores; leaving screen commits; clear-read button | browser owned by W7-WEB | NOT_RUN |
| NOTIFY-01.mobile.notifications-screen | member | Mobile | cursor paging, clear-read, undo (MOB-020) | native app not available | NOT_RUN |
| NOTIFY-01.undo.server-side | member | API | server-side undo/restore of deleted notification | no server undo exists: undo is a client-held 5s timer before DELETE (packages/shared/src/lib/notification-cleanup.ts); shared unit tests (581) pass | NOT_APPLICABLE |
| NOTIFY-01.undo.client-timer-logic.UNIT | - | vitest (shared) | createUndoableNotificationDelete unit tests | packages/shared vitest: 58 files / 581 tests passed (includes notification-cleanup, mentions, message-format) | PASS |
| NOTIFY-01.unit.backend.notifications-cleanup+conversations+conversation-delivery | - | vitest (backend) | 3 files pass | 17 tests passed | PASS |
| NOTIFY-01.prune.worker-scheduling | system | Worker | runNotificationRetentionSafely invoked by scheduled worker run | worker run owned by W7-JOURNEY; function behaviour verified directly | NOT_RUN |

## MESSAGE-01 — operational messages and templates (regression subset) (52 cases: 44 PASS, 5 FAIL, 1 BLOCKED, 2 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MESSAGE-01.preview.lead.API | lead | API | 200 with audience_hash + recipients | 200 {"recipients":[{"reasons":["team_member"],"has_email":true,"has_login":true,"last_name":"Qa","person_id":"1119af9d-0d84-4517-9732-0261f0be019d","reachable":true | PASS |
| MESSAGE-01.preview.admin.API | admin | API | 200 with audience_hash + recipients | 200 {"recipients":[{"reasons":["team_member"],"has_email":true,"has_login":true,"last_name":"Qa","person_id":"1119af9d-0d84-4517-9732-0261f0be019d","reachable":true | PASS |
| MESSAGE-01.preview.owner.API | owner | API | 200 with audience_hash + recipients | 200 {"recipients":[{"reasons":["team_member"],"has_email":true,"has_login":true,"last_name":"Qa","person_id":"1119af9d-0d84-4517-9732-0261f0be019d","reachable":true | PASS |
| MESSAGE-01.preview.m1.API | m1 | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbidden"} | PASS |
| MESSAGE-01.preview.outsider.API | outsider | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbidden"} | PASS |
| MESSAGE-01.preview.child.API | child | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbidden"} | PASS |
| MESSAGE-01.send.lead.API | lead | API | 201 | 201 {"message":{"id":"24a86a5c-f0a5-4fa6-a2cb-032a5f8ba2ce","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","plan_id":null,"audience":{"include":["team_mem | PASS |
| MESSAGE-01.send.replay-same-key.API | lead | API | 200 replayed, same message id | 200 {"message":{"id":"24a86a5c-f0a5-4fa6-a2cb-032a5f8ba2ce","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","plan_id":null,"audience":{"include":["team_mem | PASS |
| MESSAGE-01.send.replay.rows.DB | lead | DB | 1 message row for key | 1 | PASS |
| MESSAGE-01.send.same-key-different-payload.API | lead | API | 409 or original replay (never new message) | 409 replayed=undefined subj=undefined | PASS |
| MESSAGE-01.send.recipients.DB | lead | DB | m3 excluded(sender-removed), nolog excluded missing contact, others included | Child:included,Lead:included,M1:included,M2:included,M3:excluded_by_sender,Nolog:excluded_no_address | PASS |
| MESSAGE-01.send.recipients.exact.DB | lead | DB | M3 excluded; Nolog excluded; Child/Lead/M1/M2 included | Child:included,Lead:included,M1:included,M2:included,M3:excluded_by_sender,Nolog:excluded_no_address | PASS |
| MESSAGE-01.send.in-app-and-email.deliveries.DB | lead | DB | channel/status per recipient | email:simulated,in_app:delivered,push:skipped | PASS |
| MESSAGE-01.send.member.API | m1 | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbidden"} | PASS |
| MESSAGE-01.send.stale-hash.API | lead | API | 409/422 (reviewed audience changed) | 409 {"error":"The audience changed since the preview; review the recipients again","code":"audience_chan | PASS |
| MESSAGE-01.send.unknown-variable.API | lead | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"body","code":"custom","message":"Unknown variable in message: evil_var"}]} | PASS |
| MESSAGE-01.send.concurrent-same-key.API | lead | API | one 201, others 200 replayed, one row | 200,200,200,200,201 rows=1 | PASS |
| MESSAGE-01.read.recipient-sender-metadata.API | m1 | API | recipient should not see audience/counts/audience_hash (W3-MSG-D5 retest) | 200 keys=audience,audience_hash,request_hash,recipient_count,excluded_count,idempotency_key outcomes=false | FAIL (W7-MSG-D6) |
| MESSAGE-01.read.recipient-rendered-for-me.API | m1 | API | rendered_for_me has own first_name; no outcomes of others | rendered={"subject":"QA subject M1","body":"QA body <b>x</b> M1"} outcomes=undefined | PASS |
| MESSAGE-01.read.html-body-inert.API | m1 | API | body returned as text | QA body <b>x</b> M1 | PASS |
| MESSAGE-01.read.non-recipient.API | outsider | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| MESSAGE-01.read.excluded-recipient.API | m3 | API | 404 (excluded by sender: not a recipient) | 404 | PASS |
| MESSAGE-01.read.sender-outcomes.API | lead | API | outcomes present | 200 outcomes=6 retry=false | PASS |
| MESSAGE-01.read.admin-outcomes.API | admin | API | admin sees outcomes | 200 outcomes=6 | PASS |
| MESSAGE-01.list.received.m1.API | m1 | API | contains mid | 200 n=2 | PASS |
| MESSAGE-01.list.received.m3-excluded.API | m3 | API | does not contain mid | n=0 | PASS |
| MESSAGE-01.list.sent.m1.API | m1 | API | empty | n=0 | PASS |
| MESSAGE-01.list.sent.admin.API | admin | API | admin sees others sent | n=2 | PASS |
| MESSAGE-01.list.cursor.API | lead | API | cursor param exists (W3-MSG-D8 retest) | 200 n=1 (unknown param ignored => same page) | FAIL (W7-MSG-D9) |
| MESSAGE-01.rls.recipient-reads-sender-row | m1 | RLS | audience/hash/idempotency_key columns not readable by recipient (W3-MSG-D5 retest) | 200 keys=audience,audience_hash,excluded_count,idempotency_key | FAIL (W7-MSG-D6) |
| MESSAGE-01.rls.recipient-reads-other-recipients | m1 | RLS | only own recipient row | n=1 | PASS |
| MESSAGE-01.rls.non-recipient.reads-recipients | outsider | RLS | 0 rows | n=0 | PASS |
| MESSAGE-01.retry.sender.API | lead | API | 200 requeued (>=0) | 200 {"requeued":0} | PASS |
| MESSAGE-01.retry.recipient.API | m1 | API | 403/404 | 404 | PASS |
| MESSAGE-01.retry.outsider.API | outsider | API | 404 | 404 | PASS |
| MESSAGE-01.tpl.create-personal.lead.API | lead | API | 201 | 201 {"id":"738c17e7-a6fe-4507-bc02-8022949bff08","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","owner_id":"9e440d32-4a54-4275-8a49-410c956aff9d","name":" | PASS |
| MESSAGE-01.tpl.create-shared.lead.API | lead | API | 403 (shared needs org scheduler) or 201 | 403 | PASS |
| MESSAGE-01.tpl.create-shared.admin.API | admin | API | 201 | 201 {"id":"a711cec9-af5f-480f-ba1d-e6daadc8fc01","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","owner_id":null,"name":"QA shared admin","subject":"S","bo | PASS |
| MESSAGE-01.tpl.list.lead.API | lead | API | own + shared | n=2 | PASS |
| MESSAGE-01.tpl.list.admin-no-personal-of-lead.API | admin | API | does not see lead personal template | false | PASS |
| MESSAGE-01.tpl.list.member.API | m1 | API | 403 | 403 {"error":"Only schedulers and team leaders can send messages","code":"forbidden"} | PASS |
| MESSAGE-01.tpl.edit-shared.lead-with-revision.API | lead | API | 403/404 (permission), not 409 (W3-MSG-D6 retest) | 409 template_stale | FAIL (W7-MSG-D7) |
| MESSAGE-01.tpl.edit-shared.admin.API | admin | API | 200 | 200 {"id":"a711cec9-af5f-480f-ba1d-e6daadc8fc01","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","owner_id":null,"name":"renamed","subject":"S","body":"B", | PASS |
| MESSAGE-01.tpl.edit.stale-revision.API | admin | API | 409 template_stale | 409 {"error":"This template changed since you opened it","code":"template_stale"} | PASS |
| MESSAGE-01.tpl.create.unknown-variable.API | admin | API | 422 | 422 {"error":"Invalid request body","code":"unprocessable","details":[{"path":"subject","code":"custom","message":"Unknown variable in subject: nope"}]} | PASS |
| MESSAGE-01.tpl.archive.admin.API | admin | API | 204 | 204 "" | PASS |
| MESSAGE-01.tpl.send-with-archived.API | lead | API | 4xx (W3-MSG-D7 retest) | 201 | FAIL (W7-MSG-D8) |
| MESSAGE-01.tpl.send-with-unknown.API | lead | API | 4xx not 500 | 404 | PASS |
| MESSAGE-01.tpl.archive.unknown.API | lead | API | 404 | 404 {"error":"Template not found","code":"not_found"} | PASS |
| MESSAGE-01.web.templates-preview-send-ui | leaders | Web | template list/edit/archive, preview recipients, send, history | browser owned by W7-WEB | NOT_RUN |
| MESSAGE-01.signups-audience | leader | API | audience include=signups | no sign-up fixtures created in this package (regression subset: team_members only) | NOT_RUN |
| MESSAGE-01.real-provider-delivery | leader | Provider | real email/SMS delivery | simulated email only (RESEND_API_KEY empty) | BLOCKED |

## MESSAGE-02 — device handoff (1 cases: 1 NOT_RUN)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| MESSAGE-02.device-sms-email-handoff | member/leader | Mobile (device) | composer handoff, cancel, missing handler, never claims delivered | physical devices required | NOT_RUN |

## SEC-01 portion — D17 hostile strings in chat, item comments and notes; mention parsing (72 cases: 69 PASS, 3 FAIL)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-01.chat.send.html.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.html.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.html.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.4ms | PASS |
| SEC-01.chat.send.script.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.script.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.script.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.mdjs.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.mdjs.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.mdjs.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.datauri.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.datauri.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.datauri.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=3 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.rtl.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.rtl.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.rtl.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.zwsp.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.zwsp.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.zwsp.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.homoglyph.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.homoglyph.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.homoglyph.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.sql.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.sql.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.sql.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.longtext.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 len=4000 | PASS |
| SEC-01.chat.read.longtext.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.longtext.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.2ms | PASS |
| SEC-01.chat.send.emoji.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.emoji.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.emoji.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.ctrl.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.ctrl.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.ctrl.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.nul.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 500 {"error":"unsupported Unicode escape sequence","code":"22P05"} | FAIL (W7-MSG-D11) |
| SEC-01.chat.formatter.nul.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.surrogate.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 500 {"error":"Empty or invalid json","code":"PGRST102"} | FAIL (W7-MSG-D11) |
| SEC-01.chat.formatter.surrogate.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.0ms | PASS |
| SEC-01.chat.send.fmt.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.fmt.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.fmt.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=8 badLinks=0 0.2ms | PASS |
| SEC-01.chat.send.newlines.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.newlines.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.newlines.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=1 badLinks=0 0.1ms | PASS |
| SEC-01.chat.send.json.API | m1 | API | 201 and stored/returned verbatim as inert text (or clean 4xx; never 500) | 201 stored-verbatim=true | PASS |
| SEC-01.chat.read.json.API | m2 | API | reader receives same body; content-type JSON | true | PASS |
| SEC-01.chat.formatter.json.SHARED | - | shared lib | links only http(s); no html interpretation; fast (<200ms) | runs=5 badLinks=0 0.0ms | PASS |
| SEC-01.chat.formatter.link.jslink.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | [] | PASS |
| SEC-01.chat.formatter.link.mixed.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | ["https://a.b/"] | PASS |
| SEC-01.chat.formatter.link.uppercase.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | [] | PASS |
| SEC-01.chat.formatter.link.paren.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | ["https://a.b/c","https://x.y/z"] | PASS |
| SEC-01.chat.formatter.link.evil.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | ["https://evil.test/\"onmouseover=\"alert(1)"] | PASS |
| SEC-01.chat.formatter.link.user.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | ["https://user:pw@example.com/"] | PASS |
| SEC-01.chat.formatter.link.ftp.SHARED | - | shared lib | only http(s) hrefs, rendered as attribute value (React escapes) | [] | PASS |
| SEC-01.chat.mention-lookalike.formatter.SHARED | - | shared lib | only the exact @Name token highlighted (1) | mentions=1 | PASS |
| SEC-01.chat.mention-prefix.resolve.SHARED | - | shared lib | Anna resolved to b, Ann to a | ["b","a"] | PASS |
| SEC-01.chat.mention-email.resolve.SHARED | - | shared lib | email not mention | [] | PASS |
| SEC-01.chat.mention-regex-special-chars.SHARED | - | shared lib | names with regex metachars safe, fast | 1.3ms | PASS |
| SEC-01.chat.notification-excerpt.html.DB | m2 | DB | excerpt stored as text, bounded length | <img src=x onerror=alert(1)> maxlen=140 | PASS |
| SEC-01.itemcomment.html.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.itemcomment.mdjs.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.itemcomment.rtl.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.itemcomment.zwsp.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.itemcomment.longtext.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.itemcomment.sql.API | m1 | API | 201 verbatim | 201 true | PASS |
| SEC-01.note.create.html.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"356217df-e796-4035-a84d-e6107960ab65","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.mdjs.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"6b630e43-32d1-47ba-ad38-d2b6b9cbfc0c","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.rtl.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"20b54224-045c-472b-b9d8-7c04d00a50ff","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.zwsp.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"bd3cd247-99c9-4ea2-95fd-29a4d22cb329","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.longtext.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"e1dff429-835a-4aec-9228-a5000dd33eb5","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.sql.API | owner | API | 201 verbatim or clean 4xx, never 500 | 201 {"id":"9f03cfd1-a27e-4604-b9b7-a9caebe3a7bb","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995 | PASS |
| SEC-01.note.create.nul.API | owner | API | 201 verbatim or clean 4xx, never 500 | 500 {"error":"unsupported Unicode escape sequence","code":"22P05"} | FAIL (W7-MSG-D11) |
| SEC-01.itemcomment.mention-unknown-otherorg-outsider.API | m1 | API | 201; unknown/other-org ignored; outsider no_access | 201 [{"person_id":"c13188ea-2b46-48b7-a00e-f6d266901726","name":"Outsider Qa","resolution":"no_access","is_me":false}] | PASS |

## SEC — cross-tenant checks (org B actors against org A resources) (26 cases: 26 PASS)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC.open.team.orgB-owner-with-B-header.API | ownerb | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.open.team.orgB-owner-with-A-header.API | ownerb | API | 403/404 not member | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| SEC.open.team.orgB-member-with-A-header.API | bmem | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| SEC.open.team.m1-with-B-header.API | m1 | API | 404 (team belongs to A) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.list.m1-with-B-header.API | m1 | API | 200 none of A convs | 200 n=0 | PASS |
| SEC.get-conv.orgB-owner-B-header.API | ownerb | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.msgs.m1-B-header.API | m1 | API | 404 (conv not in active org) | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.send.orgB.API | ownerb | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.send.orgB-member-A-header.API | bmem | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| SEC.mention.candidates.orgB.API | ownerb | API | 404 | 404 {"error":"Conversation not found","code":"not_found"} | PASS |
| SEC.mention.orgB-user-notifs.API | ownerb | API | no A content | 200 n=0 | PASS |
| SEC.mention.other-org-person-ids.API | m1 | API | 201, ids silently ignored, no row | 201 mentions=0 | PASS |
| SEC.notif.list.orgB-user-A-header.API | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| SEC.notif.clear-read.orgB-user-A-header.API | ownerb | API | 403/404 | 403 {"error":"You are not a member of that organization","code":"forbidden"} | PASS |
| SEC.message.preview.foreign-team.orgB-owner.API | ownerb | API | 403/404/4xx; no org A recipients | 404 {"error":"Team not found","code":"not_found"} | PASS |
| SEC.message.send.foreign-team.API | lead | API | 4xx, no row | 404 {"error":"Team not found","code":"not_found"} | PASS |
| SEC.message.send.orgB-owner-with-A-team.API | ownerb | API | 4xx, no row | 404 {"error":"Team not found","code":"not_found"} | PASS |
| SEC.message.read.orgB.API | ownerb | API | 404 | 404 {"error":"Message not found","code":"not_found"} | PASS |
| SEC.tpl.edit.cross-org.API | ownerb | API | 404 | 404 {"error":"Template not found","code":"not_found"} | PASS |
| SEC.summary.my_conversation.wrong-org-id.RLS | m1 | RPC | 0 rows | 200 n=0 | PASS |
| SEC.summary.my_conversation.A-conv-with-B-org.RLS | ownerb | RPC | 0 rows | 200 n=0 | PASS |
| SEC.summary.my_conversation.anon.RPC | anon | RPC | denied (execute revoked) | 401 | PASS |
| SEC.summary.my_conversation.service_role.RPC | service | RPC | denied/empty (execute revoked from service_role) | 403 | PASS |
| SEC.summary.my_conversations.wrong-org.RLS | m1 | RPC | only org-B conversations (team B) | n=1 kinds=56e4e2fa-bb2a-4c3d-b2bc-cc3df5707aed | PASS |
| SEC.summary.my_conversations.orgB-owner-A-id.RLS | ownerb | RPC | empty | n=0 | PASS |
| SEC.chat.rls.anon.select-messages | anon | RLS | 0 rows or 401 | 401 | PASS |

## RT — private Realtime broadcast topics (conversation / live_plan / live_run) (44 cases: 44 PASS)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| SEC-RT.conversation.authorized.m1.subscribe | m1 | Realtime | SUBSCRIBED | SUBSCRIBED | PASS |
| SEC-RT.conversation.authorized.m1.receives-poke | m1 | Realtime | receives >=1 "changed" poke after a chat send | n=1 | PASS |
| SEC-RT.conversation.authorized.m2.subscribe | m2 | Realtime | SUBSCRIBED | SUBSCRIBED | PASS |
| SEC-RT.conversation.authorized.m2.receives-poke | m2 | Realtime | receives >=1 "changed" poke after a chat send | n=1 | PASS |
| SEC-RT.conversation.authorized.owner.subscribe | owner | Realtime | SUBSCRIBED | SUBSCRIBED | PASS |
| SEC-RT.conversation.authorized.owner.receives-poke | owner | Realtime | receives >=1 "changed" poke after a chat send | n=1 | PASS |
| SEC-RT.conversation.authorized.m3.subscribe | m3 | Realtime | SUBSCRIBED (re-added team member) | SUBSCRIBED | PASS |
| SEC-RT.conversation.authorized.m3.receives-poke | m3 | Realtime | receives >=1 "changed" poke after a chat send | n=1 | PASS |
| SEC-RT.conversation.denied.outsider | outsider | Realtime | not SUBSCRIBED (CHANNEL_ERROR) and zero events | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.denied.child | child | Realtime | not SUBSCRIBED (CHANNEL_ERROR) and zero events | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.denied.inactive | inactive | Realtime | not SUBSCRIBED (CHANNEL_ERROR) and zero events | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.denied.ownerb | ownerb | Realtime | not SUBSCRIBED (CHANNEL_ERROR) and zero events | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.denied.bmem | bmem | Realtime | not SUBSCRIBED (CHANNEL_ERROR) and zero events | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.denied.anon-key-no-user | anon | Realtime | rejected, zero events | status=CHANNEL_ERROR events=0 Unauthorized: You do not have permissions to read from this Channel topic: conversation:431d553c-433b-4fe9-ade2-46cea85f3d31 | PASS |
| SEC-RT.conversation.denied.outsider-public-channel | outsider | Realtime | public channel on same topic name receives nothing | status=SUBSCRIBED events=0 | PASS |
| SEC-RT.conversation.authorized.m1-public-channel | m1 | Realtime | public (non-private) channel receives nothing: broadcasts are private-only | status=SUBSCRIBED events=0 | PASS |
| SEC-RT.payload.no-private-content | m1 | Realtime | payload only {event,id}; no body/author/name | {"type":"broadcast","event":"changed","payload":{"id":"431d553c-433b-4fe9-ade2-46cea85f3d31","event":"changed"},"meta":{"id":"e7280ed8-079b-41ce-86a5-c9ef0138a08a"}} | PASS |
| SEC-RT.payload.id-is-conversation-id | m1 | Realtime | payload id = conversation id (not message id) | true | PASS |
| SEC-RT.payload.db-messages-bodyless | - | DB | realtime.messages rows hold no chat text | 0 | PASS |
| SEC-RT.conversation.edit-poke | m1 | Realtime | edit pokes | +1 | PASS |
| SEC-RT.conversation.revoked-live-subscription.m3 | m3 | Realtime | live channel stops (policy re-evaluated) — or receives only an id-only poke (documented: checked on join/token refresh) | pokes after revoke=1 | PASS |
| SEC-RT.conversation.revoked-rejoin.m3 | m3 | Realtime | new join rejected | status=CHANNEL_ERROR events=0 | PASS |
| SEC-RT.conversation.plan.authorized.m1 | m1 | Realtime | SUBSCRIBED + poke | SUBSCRIBED n=1 | PASS |
| SEC-RT.conversation.plan.denied.m3-not-on-plan | m3 | Realtime | rejected, zero | CHANNEL_ERROR n=0 | PASS |
| SEC-RT.conversation.plan.denied.ownerb | ownerb | Realtime | rejected, zero | CHANNEL_ERROR n=0 | PASS |
| SEC-RT.topic.malformed.upper.outsider | outsider | Realtime | not SUBSCRIBED | conversation:431D553C-433B-4FE9-ADE2-46CEA85F3D31 -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.wildcard.outsider | outsider | Realtime | not SUBSCRIBED | conversation:* -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.noid.outsider | outsider | Realtime | not SUBSCRIBED | conversation: -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.other.outsider | outsider | Realtime | not SUBSCRIBED | realtime:anything -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.trailing.outsider | outsider | Realtime | not SUBSCRIBED | conversation:431d553c-433b-4fe9-ade2-46cea85f3d31x -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.list.outsider | outsider | Realtime | not SUBSCRIBED | conversation:431d553c-433b-4fe9-ade2-46cea85f3d31,conversati -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.unknown.outsider | outsider | Realtime | not SUBSCRIBED | conversation:ab5ec41e-a7e6-4cf2-b1bd-ea2ce5a16b46 -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.sql.outsider | outsider | Realtime | not SUBSCRIBED | conversation:431d553c-433b-4fe9-ade2-46cea85f3d31' or 1=1 -- -> CHANNEL_ERROR | PASS |
| SEC-RT.topic.malformed.upper.m1 | m1 | Realtime | not SUBSCRIBED (strict lowercase regex) | CHANNEL_ERROR | PASS |
| SEC-RT.live_plan.authorized.m1.poke-on-plan-edit | m1 | Realtime | SUBSCRIBED; receives poke after plan edit | SUBSCRIBED n=1 edit=201 | PASS |
| SEC-RT.live_plan.org-member-outsider | outsider | Realtime | org member can read plans (plans_select=is_org_member) so may subscribe — record | SUBSCRIBED n=1 | PASS |
| SEC-RT.live_plan.denied.ownerb | ownerb | Realtime | rejected, zero | CHANNEL_ERROR n=0 | PASS |
| SEC-RT.live_plan.denied.bmem | bmem | Realtime | rejected, zero | CHANNEL_ERROR n=0 | PASS |
| SEC-RT.live_plan.payload | m1 | Realtime | id/event only; no plan title/item title | {"type":"broadcast","event":"changed","payload":{"id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864","event":"changed"},"meta":{"id":"08cce30e-26ca-4bbf-baec-8812855aad07"}} | PASS |
| SEC-RT.live_run.unknown-id.ownerb | ownerb | Realtime | not SUBSCRIBED | CHANNEL_ERROR | PASS |
| SEC-RT.conversation.orgB.authorized.bmem | bmem | Realtime | SUBSCRIBED | SUBSCRIBED | PASS |
| SEC-RT.conversation.orgB.denied.orgA-outsider | outsider | Realtime | not SUBSCRIBED | CHANNEL_ERROR | PASS |
| SEC-RT.conversation.orgB.m1-member-of-B-team | m1 | Realtime | SUBSCRIBED (m1 is on team B) | SUBSCRIBED | PASS |
| SEC-RT.sql.perf-realtime-pokes.sql | - | DB (rolled back) | begin/rollback suite exits 0 | exit=0, ROLLBACK | PASS |

## Retest of NOTE-01-adjacent wave 3 defects (item comments) (5 cases: 2 PASS, 3 FAIL)

| Case ID | Actor | Surface | Expected | Actual | Status |
|---|---|---|---|---|---|
| NOTE-01.comment.post.m1.API | m1 | API | 201 | 201 {"item":{"id":"53e57716-5c4a-422b-b2ae-65ba3d858935","organization_id":"1d0ab801-7480-4f56-83e2-219b80015995","plan_id":"c95a0f2b-248f-45e6-bc38-1dc4f8434864"," | PASS |
| NOTE-01.comment.edit.wrong-item-in-path.API+DB | m1 | API+DB | 404 AND comment unchanged (W3-MSG-D1 retest) | 404 body=wrong path edit | FAIL (W7-MSG-D10) |
| NOTE-01.comment.delete.wrong-item-in-path.API+DB | m1 | API+DB | 404 AND not deleted (W3-MSG-D1 retest) | 404 deleted=t | FAIL (W7-MSG-D10) |
| NOTE-01.comment.list.non-plan-member.API | outsider | API | 404 (only people on plan) | 404 | PASS |
| NOTE-01.comment.pagination.identical-created_at-ties.API | m1 | API | all 5 tied comments reachable (W3-MSG-D2 retest) | seen=2/5 | FAIL (W7-MSG-D3) |

## Not run / blocked

| Item | Status | Reason |
|---|---|---|
| All web UI steps (Enter-to-send, mention picker, message formatting rendering, bell undo, clean-up buttons, templates UI) | NOT_RUN | browser owned by W7-WEB; formatter logic exercised at shared-library level (SEC-01 SHARED rows, vitest) |
| Mobile (MOB-019/020, MESSAGE-02 device handoff) | NOT_RUN | no native app/devices |
| Delivery-failure injection for non-blocking send | BLOCKED | needs a delivery/provider fault (code/env change or worker involvement). Success path and "API returns before delivery completes" covered; worker pickup of a failed effect belongs to W7-JOURNEY |
| Worker-driven retention schedule | NOT_RUN | worker owned by W7-JOURNEY; `prune_notifications` verified directly |
| Real provider delivery | BLOCKED | `RESEND_API_KEY` empty, push simulated |
| Realtime token-expiry re-evaluation | NOT_RUN | needs JWT expiry/refresh window |
| `signups` message audience | NOT_RUN | no sign-up fixtures built |
| Chat attachments | NOT_APPLICABLE | do not exist in frozen schema |
| Server-side notification undo | NOT_APPLICABLE | client-only timer (unit tested) |

## prune_notifications evidence

- Catalog: `has_function_privilege` anon=false, authenticated=false, service_role=true; `SECURITY DEFINER`, empty `search_path`.
- PostgREST `/rpc/prune_notifications`: user JWT (empty body and with aggressive args) and anon key -> 401 `42501 permission denied for function prune_notifications`; nothing deleted.
- Behaviour: before the call, global qualifying rows (read older than 90 d or unread older than 180 d) = 0 pre-existing + 6 backdated fixture rows (m2, org A: 3 read at 91 d, 3 unread at 181 d); boundary fixtures kept (2 read at 89 d, 2 unread at 179 d, 2 unread at 100 d). Called `select public.prune_notifications()` with DEFAULT arguments only: returned 6, table total dropped by exactly 6, the 6 intended rows gone, 6 boundary rows kept, second call returned 0, conversation messages untouched. Boundary fixtures then reset to recent timestamps.

## Fixtures left in place

Orgs `qa-20261120-msg-a` and `qa-20261120-msg-b`, users `{owner,admin,lead,m1,m2,m3,outsider,child,inactive,recip,ownerb,bmem}.qa20261120.msg@example.test`, a no-login person "Nolog Qa", service type Sunday QA, teams Band QA / Band B, plan QA Plan 1 (published, 3 items), team and plan conversations with ~100 messages and hundreds of notifications (some with `created_at` reset to 2026-01-01/02-02/03-03 for tie tests), one open and one resolved report (hide) on a message, message-template and operational-message rows (several), m1 also in org B. inactive member status left inactive. Credentials only in the agent scratchpad (`.../scratchpad/msg/creds.json`, mode 600). No Realtime channels left open (client process exited).
