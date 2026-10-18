#!/usr/bin/env bash
# F10 Pass C: two schedulers move the same plan from the same review with
# different request keys. Sorted plan locks serialize them; the second sees a
# changed plan and is refused instead of moving it twice.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
out_a="$(mktemp)"; out_b="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id = '$plan';
delete from public.plan_reschedule_operations where idempotency_key like 'f10-race-move-%';
SQL
  rm -f "$out_a" "$out_b"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F10 race move', ('2028-03-05'::date + time '10:00') at time zone 'America/Toronto', 'draft', '$scheduler');
insert into public.plan_times (plan_id, kind, name, starts_at, ends_at)
values ('$plan', 'service', 'Service', ('2028-03-05'::date + time '10:00') at time zone 'America/Toronto',
        ('2028-03-05'::date + time '11:00') at time zone 'America/Toronto');
SQL

# 2028-03-12 is the spring-forward Sunday: 10:00 local is still 10:00 local.
moves="$(psql_run <<SQL
select jsonb_build_array(jsonb_build_object('plan_id', '$plan', 'new_local_date', '2028-03-12',
  'service_date', ('2028-03-12'::date + time '10:00') at time zone 'America/Toronto',
  'times', (select jsonb_agg(jsonb_build_object('id', id,
     'starts_at', ('2028-03-12'::date + time '10:00') at time zone 'America/Toronto',
     'ends_at', ('2028-03-12'::date + time '11:00') at time zone 'America/Toronto'))
     from public.plan_times where plan_id = '$plan')));
SQL
)"
hash="$(psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select public.preview_plan_reschedule('$org', 'shift', '$moves'::jsonb, null, false, false)->>'preview_hash';
commit;
SQL
)"

move() {
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'moved:' || (public.reschedule_plans('$org', 'shift', '$hash', 'f10-race-move-$1', '$moves'::jsonb, null, false, false, null)->>'operation_id');
select pg_sleep(0.5);
commit;
SQL
}
move one > "$out_a" & move two > "$out_b" & wait

moved="$(cat "$out_a" "$out_b" | grep -c '^moved:' || true)"
stale="$(cat "$out_a" "$out_b" | grep -c '^ERROR: .*changed since you reviewed' || true)"
local_time="$(psql_run -c "select to_char(service_date at time zone 'America/Toronto', 'YYYY-MM-DD HH24:MI') from public.plans where id = '$plan'")"
[ "$moved" = "1" ] && [ "$stale" = "1" ] && [ "$local_time" = "2028-03-12 10:00" ] || {
  echo "FAIL: moved=$moved stale=$stale local=$local_time"; cat "$out_a" "$out_b"; exit 1; }
echo "PASS: concurrent moves from one review → one moved (10:00 local across DST), one refused as stale"
