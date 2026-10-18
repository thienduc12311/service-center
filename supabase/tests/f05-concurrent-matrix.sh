#!/usr/bin/env bash
# F05: two reviewed matrix batches race to place one Person on overlapping
# plans. Sorted Person locks serialize them; exactly one whole batch commits.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
person="$(uuidgen | tr 'A-Z' 'a-z')"
plan_x="$(uuidgen | tr 'A-Z' 'a-z')"
plan_y="$(uuidgen | tr 'A-Z' 'a-z')"
first="$(mktemp)"
second="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id in ('$plan_x', '$plan_y');
delete from public.people where id = '$person';
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.people (id, organization_id, first_name) values ('$person', '$org', 'F05 race');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan_x', '$org', '$service_type', 'F05 race X', now() + interval '600 days', 'draft', '$scheduler'),
  ('$plan_y', '$org', '$service_type', 'F05 race Y', now() + interval '600 days', 'draft', '$scheduler');
insert into public.plan_times (plan_id, kind, starts_at, ends_at) values
  ('$plan_x', 'service', now() + interval '600 days', now() + interval '600 days 1 hour'),
  ('$plan_y', 'service', now() + interval '600 days 30 minutes', now() + interval '600 days 90 minutes');
SQL

commit_on() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'preview:' || count(*) from public.check_assignment_conflicts('$org',
  jsonb_build_array(jsonb_build_object('person_id', '$person', 'plan_id', '$1', 'attendance_mode', 'all')));
select pg_sleep(0.5);
with input as (
  select
    jsonb_build_array(jsonb_build_object(
      'kind','assign','plan_id','$1','person_id','$person','team_id','$band',
      'position_id',null,'visibility','prepared','attendance_mode','all','time_ids','[]'::jsonb,'notify',false)) actions,
    jsonb_build_array(jsonb_build_object(
      'plan_id','$1','staffing_revision',(select staffing_revision from public.plans where id = '$1'))) revisions
)
select 'committed:' || (public.commit_staffing_matrix('$org',
  public.staffing_matrix_operation_id(actions, revisions), actions, revisions, 'f05-race-$2')->>'operation_id')
from input;
select pg_sleep(1);
commit;
SQL
}

set +e
commit_on "$plan_x" x >"$first" 2>&1 & pid_a=$!
commit_on "$plan_y" y >"$second" 2>&1 & pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e

previews="$(grep -h -c '^preview:0$' "$first" "$second" | awk '{s+=$1} END {print s+0}')"
committed="$(grep -h -c '^committed:' "$first" "$second" | awk '{s+=$1} END {print s+0}')"
refused="$(grep -h -c 'unavailable or already scheduled' "$first" "$second" | awk '{s+=$1} END {print s+0}')"
stored="$(psql_run -c "select count(*) from public.assignments where person_id = '$person'")"
if [[ "$previews" != "2" || "$committed" != "1" || "$refused" != "1" || "$stored" != "1" ]] \
   || [[ $((rc_a + rc_b)) -eq 0 ]]; then
  echo "FAIL: previews=$previews committed=$committed refused=$refused stored=$stored rc=$rc_a/$rc_b" >&2
  cat "$first" "$second" >&2
  exit 1
fi
echo "f05 concurrent matrix: both previews clean, one atomic batch stored, one refused"
