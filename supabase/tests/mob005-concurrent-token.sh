#!/usr/bin/env bash
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
plan_id="50000000-0000-4000-8000-000000000001"
assignment_id="50000000-0000-4000-8000-000000000002"
link_id="50000000-0000-4000-8000-000000000003"
token="mob005-concurrent-token"
first="$(mktemp)"
second="$(mktemp)"

cleanup() {
  docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
drop trigger if exists mob005_test_delay on public.assignment_notifications;
drop function if exists private.mob005_test_delay();
delete from public.assignment_notifications where plan_id = '$plan_id';
delete from public.assignment_request_snapshots where plan_id = '$plan_id';
delete from public.plans where id = '$plan_id';
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT

docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 >/dev/null <<SQL
drop trigger if exists mob005_test_delay on public.assignment_notifications;
drop function if exists private.mob005_test_delay();
delete from public.assignment_notifications where plan_id = '$plan_id';
delete from public.assignment_request_snapshots where plan_id = '$plan_id';
delete from public.plans where id = '$plan_id';

insert into public.plans (
  id, organization_id, service_type_id, title, service_date, status, created_by
) values (
  '$plan_id', 'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001', 'MOB-005 concurrent response',
  now() + interval '90 days', 'published', '22222222-2222-4222-8222-222222222222'
);

insert into public.assignments (
  id, plan_id, person_id, user_id, team_id, position_id, status,
  visibility, released_at, released_by, response_owner_id, created_by
)
select '$assignment_id', '$plan_id', p.id, p.profile_id,
       'cccccccc-0000-4000-8000-000000000001',
       'dddddddd-0000-4000-8000-000000000003', 'unconfirmed',
       'released', now(), '22222222-2222-4222-8222-222222222222',
       '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222'
  from public.people p
 where p.organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
   and p.profile_id = '33333333-3333-4333-8333-333333333333';

with snapshot as (
  select private.create_assignment_request_snapshot(
    null,
    (select person_id from public.assignments where id = '$assignment_id'),
    '$plan_id', array['$assignment_id'::uuid],
    '22222222-2222-4222-8222-222222222222'
  ) id
)
insert into public.assignment_notifications (
  id, organization_id, plan_id, person_id, user_id, snapshot_id,
  email, token_hash, expires_at, created_by
)
select '$link_id', 'aaaaaaaa-0000-4000-8000-000000000001', '$plan_id',
       a.person_id, a.user_id, snapshot.id, 'sam@example.com', '$token',
       now() + interval '1 day', '22222222-2222-4222-8222-222222222222'
  from public.assignments a cross join snapshot
 where a.id = '$assignment_id';

create function private.mob005_test_delay()
returns trigger language plpgsql set search_path = '' as \$\$
begin
  if new.id = '$link_id'::uuid and new.responded_at is not null then
    perform pg_sleep(0.75);
  end if;
  return new;
end;
\$\$;
create trigger mob005_test_delay before update on public.assignment_notifications
for each row execute function private.mob005_test_delay();
SQL

docker exec "$container" psql -U postgres -Atqc \
  "select outcome from public.respond_via_assignment_link('$token', 'confirmed')" >"$first" &
pid_one=$!
docker exec "$container" psql -U postgres -Atqc \
  "select outcome from public.respond_via_assignment_link('$token', 'confirmed')" >"$second" &
pid_two=$!
wait "$pid_one"
wait "$pid_two"

outcomes="$(printf '%s\n%s\n' "$(tr -d '[:space:]' <"$first")" "$(tr -d '[:space:]' <"$second")" | sort | paste -sd, -)"
if [[ "$outcomes" != "ok,used" ]]; then
  echo "expected one ok and one used response; got $outcomes" >&2
  exit 1
fi

state="$(docker exec "$container" psql -U postgres -Atqc \
  "select concat_ws(',', a.status, n.responded_at is not null, count(r.id))
     from public.assignments a
     join public.assignment_notifications n on n.plan_id = a.plan_id
     left join public.assignment_responses r on r.assignment_id = a.id
    where a.id = '$assignment_id'
    group by a.status, n.responded_at")"
if [[ "$state" != "confirmed,t,1" ]]; then
  echo "concurrent response committed unexpected state: $state" >&2
  exit 1
fi

echo "MOB-005 concurrent token test passed: one winner, one replay rejection, one history row."
