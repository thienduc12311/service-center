#!/usr/bin/env bash
# W7-RESP-D4 (= W2-RESP-D3): an identical answer racing the one that commits
# first is a success, not a stale conflict, and writes no second history row.
#   1. respond_as_self: two sessions confirm the same assignment; the first
#      holds its transaction open so the second's compare-and-set misses.
#   2. respond_to_assignment_snapshots: two sessions commit the same snapshot
#      with the same idempotency key; the second returns the stored result.
# Uses a throw-away plan on the riverside seed and removes it on exit.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
sam="33333333-3333-4333-8333-333333333333"
scheduler="22222222-2222-4222-8222-222222222222"
plan_id="57000000-0000-4000-8000-000000000001"
self_assignment="57000000-0000-4000-8000-000000000002"
snapshot_assignment="57000000-0000-4000-8000-000000000003"
snapshot_plan="57000000-0000-4000-8000-000000000004"
key="w7-concurrent-snapshot-key"
claims="{\"sub\":\"$sam\",\"role\":\"authenticated\"}"
first="$(mktemp)"
second="$(mktemp)"

psql_root() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -Atq "$@"; }

cleanup() {
  psql_root >/dev/null <<SQL
delete from public.assignment_response_operations where idempotency_key = '$key';
delete from public.plans where id in ('$plan_id', '$snapshot_plan');
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT
cleanup

psql_root >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan_id', '$org', 'bbbbbbbb-0000-4000-8000-000000000001', 'W7 concurrent self', now() + interval '91 days', 'published', '$scheduler'),
  ('$snapshot_plan', '$org', 'bbbbbbbb-0000-4000-8000-000000000001', 'W7 concurrent snapshot', now() + interval '92 days', 'published', '$scheduler');
insert into public.assignments (id, plan_id, person_id, user_id, team_id, position_id, status,
  visibility, released_at, released_by, response_owner_id, created_by)
select x.id, x.plan_id, p.id, p.profile_id, 'cccccccc-0000-4000-8000-000000000001',
       'dddddddd-0000-4000-8000-000000000003', 'unconfirmed', 'released', now(), '$scheduler', '$scheduler', '$scheduler'
  from public.people p,
       (values ('$self_assignment'::uuid, '$plan_id'::uuid), ('$snapshot_assignment'::uuid, '$snapshot_plan'::uuid)) x(id, plan_id)
 where p.organization_id = '$org' and p.profile_id = '$sam';
SQL

# ---------------------------------------------------- 1. respond_as_self ---
respond_sql() {
  cat <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '$claims';
select r.transition from public.respond_as_self('$org', '$self_assignment', 'confirmed', 'unconfirmed') r;
select pg_sleep($1);
commit;
SQL
}
respond_sql 1.5 | psql_root >"$first" &
pid_one=$!
sleep 0.5
respond_sql 0 | psql_root >"$second" &
pid_two=$!
wait "$pid_one"
wait "$pid_two" || true

outcomes="$(grep -v '^$' "$first" | head -1),$(grep -v '^$' "$second" | head -1)"
if [[ "$outcomes" != "answer,unchanged" ]]; then
  echo "respond_as_self race: expected answer,unchanged; got $outcomes" >&2
  exit 1
fi
state="$(psql_root -c "select concat_ws(',', a.status, (select count(*) from public.assignment_responses r where r.assignment_id = a.id),
  (select count(*) from public.delivery_effects e where e.plan_id = a.plan_id and e.template = 'scheduler_response'))
  from public.assignments a where a.id = '$self_assignment'")"
if [[ "$state" != "confirmed,1,1" ]]; then
  echo "respond_as_self race committed unexpected state (status,history,effects): $state" >&2
  exit 1
fi

# ------------------------------------ 2. snapshot commit, same idempotency key ---
snapshot_id="$(psql_root -c "select private.create_assignment_request_snapshot(null,
  (select person_id from public.assignments where id = '$snapshot_assignment'),
  '$snapshot_plan', array['$snapshot_assignment'::uuid], '$scheduler')")"
commit_sql() {
  cat <<SQL
begin;
set local role authenticated;
set local request.jwt.claims = '$claims';
select public.respond_to_assignment_snapshots('$org', jsonb_build_array(jsonb_build_object(
  'snapshot_id', '$snapshot_id', 'version', 1,
  'answers', jsonb_build_array(jsonb_build_object(
    'assignment_id', '$snapshot_assignment', 'plan_time_id', null, 'status', 'confirmed', 'reason', null)))),
  '$key')::text;
select pg_sleep($1);
commit;
SQL
}
commit_sql 1.5 | psql_root >"$first" &
pid_one=$!
sleep 0.5
commit_sql 0 | psql_root >"$second" &
pid_two=$!
wait "$pid_one"
wait "$pid_two" || true

result_one="$(grep -v '^$' "$first" | head -1)"
result_two="$(grep -v '^$' "$second" | head -1)"
if [[ -z "$result_one" || "$result_one" != "$result_two" ]]; then
  echo "snapshot race: expected the same stored result twice; got '$result_one' and '$result_two'" >&2
  exit 1
fi
state="$(psql_root -c "select concat_ws(',', a.status, (select count(*) from public.assignment_responses r where r.assignment_id = a.id),
  (select count(*) from public.assignment_response_operations o where o.idempotency_key = '$key'))
  from public.assignments a where a.id = '$snapshot_assignment'")"
if [[ "$state" != "confirmed,1,1" ]]; then
  echo "snapshot race committed unexpected state (status,history,operations): $state" >&2
  exit 1
fi

echo "W7-RESP-D4 concurrent retry test passed: both identical retries succeed with one history row each."
