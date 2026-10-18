#!/usr/bin/env bash
# F08 gate: a matrix release and a Release review batch race over the same
# prepared requests on two plans. The review batch holds the plan's release
# lock first; the matrix commit must wait on that lock (taken before its plan
# row locks) instead of deadlocking, then refuse as matrix_changed. Exactly one
# batch releases the requests, with one consolidated effect.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
person="$(uuidgen | tr 'A-Z' 'a-z')"
plan_x="$(uuidgen | tr 'A-Z' 'a-z')"
plan_y="$(uuidgen | tr 'A-Z' 'a-z')"
# Every release path takes plan release locks in plan-id order; the review
# side holds the first one while the matrix commit starts.
first_plan="$(printf '%s\n%s\n' "$plan_x" "$plan_y" | sort | head -1)"
review_out="$(mktemp)"
matrix_out="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.release_batches where id in (
  select batch_id from public.release_batch_items where plan_id in ('$plan_x', '$plan_y'));
delete from public.plans where id in ('$plan_x', '$plan_y');
delete from public.people where id = '$person';
SQL
  rm -f "$review_out" "$matrix_out"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.people (id, organization_id, first_name, email)
  values ('$person', '$org', 'F08 matrix race', 'f08-matrix-race@example.test');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan_x', '$org', '$service_type', 'F08 race X', now() + interval '700 days', 'published', '$scheduler'),
  ('$plan_y', '$org', '$service_type', 'F08 race Y', now() + interval '707 days', 'published', '$scheduler');
insert into public.plan_times (plan_id, kind, starts_at, ends_at) values
  ('$plan_x', 'service', now() + interval '700 days', now() + interval '700 days 1 hour'),
  ('$plan_y', 'service', now() + interval '707 days', now() + interval '707 days 1 hour');
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select count(*) from public.schedule_plan_assignments('$plan_x', jsonb_build_array(jsonb_build_object(
  'person_id', '$person', 'team_id', '$band', 'visibility', 'prepared', 'attendance_mode', 'all')), false, 'f08-race-x');
select count(*) from public.schedule_plan_assignments('$plan_y', jsonb_build_array(jsonb_build_object(
  'person_id', '$person', 'team_id', '$band', 'visibility', 'prepared', 'attendance_mode', 'all')), false, 'f08-race-y');
commit;
SQL

review_release() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select pg_advisory_xact_lock(hashtextextended('release:$first_plan', 0));
select pg_sleep(1);
select 'review:' || (public.create_release_batch('$org',
  (select jsonb_agg(jsonb_build_object('assignment_id', id, 'request_revision', request_revision))
     from public.assignments where person_id = '$person'),
  true, null, 'f08-race-review-$person')).status;
commit;
SQL
}

matrix_release() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select pg_sleep(0.3);
with input as (
  select
    (select jsonb_agg(jsonb_build_object('kind', 'release', 'plan_id', plan_id, 'assignment_id', id,
       'expected_request_revision', request_revision, 'notify', true) order by plan_id desc)
       from public.assignments where person_id = '$person') actions,
    (select jsonb_agg(jsonb_build_object('plan_id', id, 'staffing_revision', staffing_revision) order by id)
       from public.plans where id in ('$plan_x', '$plan_y')) revisions
)
select 'matrix:' || jsonb_array_length(public.commit_staffing_matrix('$org',
  public.staffing_matrix_operation_id(actions, revisions), actions, revisions, 'f08-race-matrix-$person')->'delivery_effect_ids')
from input;
commit;
SQL
}

set +e
review_release >"$review_out" 2>&1 & pid_r=$!
matrix_release >"$matrix_out" 2>&1 & pid_m=$!
wait "$pid_r"; rc_r=$?
wait "$pid_m"; rc_m=$?
set -e

deadlocks="$(cat "$review_out" "$matrix_out" | grep -c 'deadlock' || true)"
review_ok="$(grep -c '^review:released$' "$review_out" || true)"
matrix_refused="$(grep -c 'changed since the preview' "$matrix_out" || true)"
released="$(psql_run -c "select count(*) from public.assignments where person_id = '$person' and visibility = 'released'")"
effects="$(psql_run -c "select count(*) from public.delivery_effects e join public.release_batches b on b.id = e.release_batch_id
  where b.idempotency_key in ('f08-race-review-$person') or b.id in (
    select batch_id from public.release_batch_items where plan_id in ('$plan_x', '$plan_y'))")"
if [[ "$deadlocks" != "0" || "$rc_r" != "0" || "$rc_m" == "0" || "$review_ok" != "1" \
      || "$matrix_refused" != "1" || "$released" != "2" || "$effects" != "1" ]]; then
  echo "FAIL: deadlocks=$deadlocks review=$review_ok/$rc_r matrix_refused=$matrix_refused/$rc_m released=$released effects=$effects" >&2
  cat "$review_out" "$matrix_out" >&2
  exit 1
fi
echo "f08 concurrent matrix release: no deadlock, review batch released once, matrix refused as stale"
