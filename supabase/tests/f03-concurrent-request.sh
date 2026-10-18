#!/usr/bin/env bash
# F03: the same availability request (one idempotency key) submitted twice at
# the same moment from two real database sessions. Exactly one request, one
# outbox effect and one set of deliveries exist; both callers get the same id.
# Committed fixtures are removed afterwards.
#   bash supabase/tests/f03-concurrent-request.sh
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
key="f03-race-$(date +%s%N)"
first="$(mktemp)"
second="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }

cleanup() {
  psql_run >/dev/null <<SQL
delete from public.availability_requests where idempotency_key = '$key';
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT

sam="$(psql_run -c "select id from public.people where organization_id = '$org' and profile_id = '33333333-3333-4333-8333-333333333333'")"

request() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select request_id from public.create_availability_request('$org', '$band', array['$sam']::uuid[],
  'Race', current_date, current_date + 30, null, '$key');
select pg_sleep(1);
commit;
SQL
}

request >"$first" &
pid_a=$!
request >"$second" &
pid_b=$!
wait "$pid_a" "$pid_b"

ids="$(cat "$first" "$second" | grep -E '^[0-9a-f-]{36}$' | sort -u | wc -l | tr -d ' ')"
counts="$(psql_run <<SQL
select (select count(*) from public.availability_requests where idempotency_key = '$key') || ' '
    || (select count(*) from public.delivery_effects e join public.availability_requests r on r.id = e.availability_request_id
         where r.idempotency_key = '$key') || ' '
    || (select count(*) from public.deliveries d join public.delivery_effects e on e.id = d.effect_id
         join public.availability_requests r on r.id = e.availability_request_id where r.idempotency_key = '$key');
SQL
)"

if [[ "$ids" != "1" || "$counts" != "1 1 3" ]]; then
  echo "FAIL: distinct ids=$ids requests/effects/deliveries=$counts" >&2
  exit 1
fi
echo "f03 concurrent request: one logical request (ids=$ids, counts=$counts)"
