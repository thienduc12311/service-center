#!/usr/bin/env bash
# F12: real concurrent sessions against one Live run.
#  1. Two editors create a run for the same service time at once (different
#     request ids) → exactly one run; the other is refused (run_exists).
#  2. The controller's two clients send competing commands from the same
#     revision (advance vs jump) → one applied, one refused as stale.
#  3. The same command is retried concurrently with one action id → one
#     transition; the retry answers "replayed".
#  4. Two editors take over from the same revision → one controller; the
#     other is refused as stale and holds nothing.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
owner="11111111-1111-4111-8111-111111111111"
scheduler="22222222-2222-4222-8222-222222222222"
new_id() { uuidgen | tr 'A-Z' 'a-z'; }
plan="$(new_id)"; time9="$(new_id)"
out_a="$(mktemp)"; out_b="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id = '$plan';
SQL
  rm -f "$out_a" "$out_b"
}
trap cleanup EXIT
fail() { echo "FAIL: $1"; cat "$out_a" "$out_b"; exit 1; }

psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F12 race', '2028-05-07 14:00+00', 'published', '$scheduler');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at)
values ('$time9', '$plan', 'service', '9am', '2028-05-07 13:00+00', '2028-05-07 14:00+00');
insert into public.plan_items (plan_id, item_type, title, length_seconds, sort_order) values
  ('$plan', 'item', 'One', 60, 0), ('$plan', 'item', 'Two', 60, 1), ('$plan', 'item', 'Three', 60, 2);
SQL

as_user() { # user, sql
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
$2
select pg_sleep(0.5);
commit;
SQL
}

# 1 — concurrent create for one service time.
as_user "$scheduler" "select 'created:' || (public.create_live_run('$plan', '$time9', 'item', 'race-a', 'tab-a')->'run'->>'id');" > "$out_a" &
as_user "$owner" "select 'created:' || (public.create_live_run('$plan', '$time9', 'item', 'race-b', 'owner-tab')->'run'->>'id');" > "$out_b" &
wait
created="$(cat "$out_a" "$out_b" | grep -c '^created:' || true)"
exists="$(cat "$out_a" "$out_b" | grep -c 'already has a run' || true)"
runs="$(psql_run -c "select count(*) from public.live_runs where plan_time_id = '$time9'")"
[ "$created" = "1" ] && [ "$exists" = "1" ] && [ "$runs" = "1" ] || fail "create: created=$created exists=$exists runs=$runs"
echo "PASS: concurrent create for one service time → one run, one refused"

run="$(psql_run -c "select id from public.live_runs where plan_time_id = '$time9'")"
holder="$(psql_run -c "select controller_user_id from public.live_runs where id = '$run'")"
client="$(psql_run -c "select controller_client_id from public.live_runs where id = '$run'")"
rev="$(psql_run -c "select revision from public.live_runs where id = '$run'")"
psql_run >/dev/null <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$holder';
select public.live_run_action('$run', 'start', $rev, '$client', 'start-1');
commit;
SQL
rev="$(psql_run -c "select revision from public.live_runs where id = '$run'")"

# 2 — competing commands from one revision.
as_user "$holder" "select 'applied:' || (public.live_run_action('$run', 'advance', $rev, '$client', 'adv-x')->'run'->>'revision');" > "$out_a" &
as_user "$holder" "select 'applied:' || (public.live_run_action('$run', 'jump', $rev, '$client', 'jump-y', 2)->'run'->>'revision');" > "$out_b" &
wait
applied="$(cat "$out_a" "$out_b" | grep -c '^applied:' || true)"
stale="$(cat "$out_a" "$out_b" | grep -c 'changed since you last saw it' || true)"
moves="$(psql_run -c "select count(*) from public.live_run_transitions where run_id = '$run' and action in ('advance','jump')")"
[ "$applied" = "1" ] && [ "$stale" = "1" ] && [ "$moves" = "1" ] || fail "commands: applied=$applied stale=$stale moves=$moves"
echo "PASS: competing commands from one revision → one applied, one refused as stale"

# 3 — the same command retried concurrently.
rev="$(psql_run -c "select revision from public.live_runs where id = '$run'")"
as_user "$holder" "select 'result:' || (public.live_run_action('$run', 'pause', $rev, '$client', 'pause-1')->>'replayed');" > "$out_a" &
as_user "$holder" "select 'result:' || (public.live_run_action('$run', 'pause', $rev, '$client', 'pause-1')->>'replayed');" > "$out_b" &
wait
fresh="$(cat "$out_a" "$out_b" | grep -c '^result:false' || true)"
replayed="$(cat "$out_a" "$out_b" | grep -c '^result:true' || true)"
pauses="$(psql_run -c "select count(*) from public.live_run_transitions where run_id = '$run' and action = 'pause'")"
[ "$fresh" = "1" ] && [ "$replayed" = "1" ] && [ "$pauses" = "1" ] || fail "retry: fresh=$fresh replayed=$replayed pauses=$pauses"
echo "PASS: concurrent retry of one action id → one transition, one replay"

# 4 — two editors take over from the same revision.
rev="$(psql_run -c "select revision from public.live_runs where id = '$run'")"
other="$owner"; [ "$holder" = "$owner" ] && other="$scheduler"
as_user "$owner" "select 'took:' || (public.live_run_action('$run', 'take_over', $rev, 'owner-2', 'over-owner')->'run'->>'controller_user_id');" > "$out_a" &
as_user "$scheduler" "select 'took:' || (public.live_run_action('$run', 'take_over', $rev, 'sched-2', 'over-sched')->'run'->>'controller_user_id');" > "$out_b" &
wait
took="$(cat "$out_a" "$out_b" | grep -c '^took:' || true)"
stale="$(cat "$out_a" "$out_b" | grep -c 'changed since you last saw it' || true)"
winner="$(cat "$out_a" "$out_b" | grep '^took:' | cut -d: -f2)"
controller="$(psql_run -c "select controller_user_id from public.live_runs where id = '$run'")"
[ "$took" = "1" ] && [ "$stale" = "1" ] && [ "$winner" = "$controller" ] || fail "takeover: took=$took stale=$stale winner=$winner controller=$controller"
echo "PASS: simultaneous takeovers → one controller, the other refused"
