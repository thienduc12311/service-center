#!/usr/bin/env bash
# F09: real concurrent sessions.
#  1. Two sessions send the same targeted message (same idempotency key)
#     → exactly one message, one effect, one delivery per recipient channel.
#  2. Two sessions post the same item comment id, and the same chat message id
#     → one comment / one message, one effect each.
#  3. An assignment is released while a send with the previewed audience
#     version is in flight → either the send is refused (audience_changed) or
#     it commits with exactly the reviewed recipients; never a silent
#     recipient the sender did not review.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
production="cccccccc-0000-4000-8000-000000000002"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
sam_user="33333333-3333-4333-8333-333333333333"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
item="$(uuidgen | tr 'A-Z' 'a-z')"
comment="$(uuidgen | tr 'A-Z' 'a-z')"
chat_message="$(uuidgen | tr 'A-Z' 'a-z')"
key="f09-race-$(uuidgen | tr 'A-Z' 'a-z')"
race_key="f09-race-audience-$(uuidgen | tr 'A-Z' 'a-z')"
out1="$(mktemp)"; out2="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.operational_messages where organization_id = '$org' and idempotency_key in ('$key', '$race_key');
delete from public.conversations where plan_id = '$plan';
delete from public.plans where id = '$plan';
SQL
  rm -f "$out1" "$out2"
}
trap cleanup EXIT

sam="$(psql_run -c "select id from public.people where profile_id = '$sam_user'")"
riley="$(psql_run -c "select id from public.people where profile_id = '44444444-4444-4444-8444-444444444444'")"

psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F09 race', now() + interval '800 days', 'published', '$scheduler');
insert into public.plan_items (id, plan_id, item_type, title, sort_order) values ('$item', '$plan', 'item', 'Race item', 0);
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode)
values ('$plan', '$sam', '$sam_user', '$band', 'dddddddd-0000-4000-8000-000000000003', 'confirmed', '$scheduler', 'released', now(), 'all');
SQL

as_user() { # user, sql
  printf "begin;\nset local role authenticated;\nset local request.jwt.claim.sub = '%s';\n%s\ncommit;\n" "$1" "$2"
}

audience="jsonb_build_object('plan_id', '$plan', 'include', jsonb_build_array('scheduled_confirmed', 'scheduled_pending'), 'team_ids', '[]'::jsonb)"
hash="$(as_user "$scheduler" "select public.preview_operational_message('$org', $audience)->>'audience_hash';" | psql_run)"

# ---------------------------------------------------------------- 1 -------
send_sql="select message_id || ':' || replayed from public.send_operational_message('$org', $audience, 'Race', 'Hi {{first_name}}', null, null, '$hash', '$key');"
as_user "$scheduler" "$send_sql" | psql_run >"$out1" &
as_user "$scheduler" "$send_sql" | psql_run >"$out2" &
wait
[ "$(cut -d: -f1 "$out1")" = "$(cut -d: -f1 "$out2")" ] || { echo "FAIL: concurrent sends returned different messages"; exit 1; }
[ "$(sort <(cut -d: -f2 "$out1") <(cut -d: -f2 "$out2") | tr '\n' ' ')" = "false true " ] || { echo "FAIL: expected one new send and one replay"; exit 1; }
counts="$(psql_run -c "select count(distinct m.id) || '/' || count(distinct e.id) || '/' || count(d.id)
  from public.operational_messages m join public.delivery_effects e on e.operational_message_id = m.id
  join public.deliveries d on d.effect_id = e.id where m.idempotency_key = '$key'")"
[ "$counts" = "1/1/3" ] || { echo "FAIL: duplicate send produced $counts (messages/effects/deliveries)"; exit 1; }
echo "ok 1 concurrent identical send → one message, one effect, 3 deliveries"

# ---------------------------------------------------------------- 2 -------
post_sql="select replayed from public.post_item_comment('$comment', '$item', 'Same comment', null);"
as_user "$sam_user" "$post_sql" | psql_run >"$out1" &
as_user "$sam_user" "$post_sql" | psql_run >"$out2" &
wait
[ "$(psql_run -c "select count(*) || '/' || (select count(*) from public.delivery_effects where comment_id = '$comment') from public.plan_item_comments where id = '$comment'")" = "1/1" ] \
  || { echo "FAIL: duplicate comment"; exit 1; }
echo "ok 2a concurrent same comment id → one comment, one effect"

conversation="$(as_user "$sam_user" "select id from public.open_conversation('plan', '$plan');" | psql_run)"
chat_sql="select replayed from public.post_conversation_message('$chat_message', '$conversation', 'Same chat', null, null);"
as_user "$sam_user" "$chat_sql" | psql_run >"$out1" &
as_user "$sam_user" "$chat_sql" | psql_run >"$out2" &
wait
[ "$(psql_run -c "select count(*) from public.conversation_messages where id = '$chat_message'")" = "1" ] \
  || { echo "FAIL: duplicate chat message"; exit 1; }
echo "ok 2b concurrent same chat message id → one message"

# ---------------------------------------------------------------- 3 -------
hash="$(as_user "$scheduler" "select public.preview_operational_message('$org', $audience)->>'audience_hash';" | psql_run)"
# Session A releases Riley onto the plan and holds the transaction open.
psql_run >/dev/null <<SQL &
begin;
insert into public.assignments (plan_id, person_id, user_id, team_id, position_id, status, created_by, visibility, released_at, attendance_mode)
values ('$plan', '$riley', '44444444-4444-4444-8444-444444444444', '$production', 'dddddddd-0000-4000-8000-000000000008', 'unconfirmed', '$scheduler', 'released', now(), 'all');
select pg_sleep(1.5);
commit;
SQL
sleep 0.3
set +e
as_user "$scheduler" "select message_id from public.send_operational_message('$org', $audience, 'Race 2', 'Body', null, null, '$hash', '$race_key');" \
  | psql_run >"$out1" 2>"$out2"
status=$?
set -e
wait
if [ $status -eq 0 ]; then
  recipients="$(psql_run -c "select string_agg(person_id::text, ',' order by person_id) from public.operational_message_recipients r
    join public.operational_messages m on m.id = r.message_id where m.idempotency_key = '$race_key'")"
  [ "$recipients" = "$sam" ] || { echo "FAIL: committed send has unreviewed recipients: $recipients"; exit 1; }
  echo "ok 3 send raced an uncommitted release → committed with exactly the reviewed recipient"
else
  grep -q "audience changed" "$out2" || { echo "FAIL: unexpected send error: $(cat "$out2")"; exit 1; }
  echo "ok 3 send raced a release → refused as audience_changed"
fi
# After the release commits, the old version is stale.
set +e
as_user "$scheduler" "select message_id from public.send_operational_message('$org', $audience, 'Race 3', 'Body', null, null, '$hash', '$race_key-after');" \
  | psql_run >/dev/null 2>"$out2"
status=$?
set -e
psql_run -c "delete from public.operational_messages where idempotency_key = '$race_key-after'" >/dev/null
[ $status -ne 0 ] && grep -q "audience changed" "$out2" || { echo "FAIL: stale audience version was accepted after the change"; exit 1; }
echo "ok 3b after the change commits, the previewed version is refused"

echo "f09 concurrency checks passed"
