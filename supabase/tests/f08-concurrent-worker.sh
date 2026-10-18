#!/usr/bin/env bash
# F08: two worker sessions race over the same due reminder jobs and the same
# due scheduled release. SKIP LOCKED plus unique effect keys must give exactly
# one effect per job and one release per batch.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
release_plan="$(uuidgen | tr 'A-Z' 'a-z')"
people=()
for i in 1 2 3 4 5 6; do people+=("$(uuidgen | tr 'A-Z' 'a-z')"); done
first="$(mktemp)"
second="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.release_batches where organization_id = '$org' and idempotency_key = 'f08-race-release';
delete from public.plans where id in ('$plan', '$release_plan');
delete from public.people where id in ($(printf "'%s'," "${people[@]}" | sed 's/,$//'));
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT

values=""
for i in "${!people[@]}"; do
  values+="('${people[$i]}', '$org', 'F08 race $i', 'f08-race-$i@example.test'),"
done
psql_run >/dev/null <<SQL
insert into public.people (id, organization_id, first_name, email) values ${values%,};
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan', '$org', '$service_type', 'F08 race reminders', now() + interval '700 days', 'published', '$scheduler'),
  ('$release_plan', '$org', '$service_type', 'F08 race release', now() + interval '701 days', 'published', '$scheduler');
insert into public.plan_times (plan_id, kind, starts_at, ends_at) values
  ('$plan', 'service', now() + interval '700 days', now() + interval '700 days 1 hour'),
  ('$release_plan', 'service', now() + interval '701 days', now() + interval '701 days 1 hour');
SQL

psql_run >/dev/null <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select count(*) from public.schedule_plan_assignments('$plan',
  (select jsonb_agg(jsonb_build_object('person_id', p, 'team_id', '$band', 'position_id', 'dddddddd-0000-4000-8000-000000000003',
                                       'visibility', 'released', 'attendance_mode', 'all'))
     from unnest(array[$(printf "'%s'::uuid," "${people[@]}" | sed 's/,$//')]) p), false, 'f08-race-schedule');
select count(*) from public.schedule_plan_assignments('$release_plan',
  (select jsonb_agg(jsonb_build_object('person_id', p, 'team_id', '$band', 'position_id', 'dddddddd-0000-4000-8000-000000000004',
                                       'visibility', 'prepared', 'attendance_mode', 'all'))
     from unnest(array[$(printf "'%s'::uuid," "${people[@]}" | sed 's/,$//')]) p), false, 'f08-race-prepare');
select (public.create_release_batch('$org',
  (select jsonb_agg(jsonb_build_object('assignment_id', a.id, 'request_revision', a.request_revision))
     from public.assignments a where a.plan_id = '$release_plan'),
  true, now() + interval '1 hour', 'f08-race-release')).id;
commit;
SQL

# Compute the plan's jobs, then move them and the batch onto the fake clock.
psql_run >/dev/null <<SQL
select count(*) from public.plan_reminder_jobs('$plan');
update public.reminder_jobs set due_at = now() - interval '1 minute' where plan_id = '$plan' and status = 'scheduled';
update public.release_batches set scheduled_for = now() - interval '1 second'
 where organization_id = '$org' and idempotency_key = 'f08-race-release';
SQL
due="$(psql_run -c "select count(*) from public.reminder_jobs where plan_id = '$plan' and status = 'scheduled'")"
[[ "$due" -eq 6 ]] || { echo "expected 6 due jobs (no-login: email only), got $due"; exit 1; }

worker() {
  psql_run <<SQL
begin;
select 'jobs', count(*) from public.materialize_due_reminders(200) where outcome = 'enqueued';
select 'batches', count(*) from public.run_due_release_batches(10) where status = 'released';
select pg_sleep(1.5);
commit;
SQL
}
worker >"$first" &
pid=$!
worker >"$second"
wait "$pid"

effects="$(psql_run -c "select count(*) from public.delivery_effects e join public.reminder_jobs j on j.id = e.reminder_job_id where j.plan_id = '$plan'")"
duplicates="$(psql_run -c "select count(*) from (select reminder_job_id from public.delivery_effects where reminder_job_id is not null group by 1 having count(*) > 1) d")"
enqueued="$(psql_run -c "select count(*) from public.reminder_jobs where plan_id = '$plan' and status = 'enqueued'")"
releases="$(psql_run -c "select count(*) from public.delivery_effects where release_batch_id = (select id from public.release_batches where organization_id = '$org' and idempotency_key = 'f08-race-release')")"
released="$(psql_run -c "select count(*) from public.assignments where plan_id = '$release_plan' and visibility = 'released'")"
jobs_a="$(grep '^jobs' "$first" | cut -d'|' -f2)"; jobs_b="$(grep '^jobs' "$second" | cut -d'|' -f2)"
batch_a="$(grep '^batches' "$first" | cut -d'|' -f2)"; batch_b="$(grep '^batches' "$second" | cut -d'|' -f2)"

echo "worker A: $jobs_a jobs, $batch_a batches; worker B: $jobs_b jobs, $batch_b batches"
[[ "$effects" -eq 6 && "$enqueued" -eq 6 && "$duplicates" -eq 0 ]] || { echo "reminder race: effects=$effects enqueued=$enqueued duplicates=$duplicates"; exit 1; }
[[ $((jobs_a + jobs_b)) -eq 6 ]] || { echo "workers claimed $((jobs_a + jobs_b)) jobs"; exit 1; }
[[ "$releases" -eq 1 && "$released" -eq 6 && $((batch_a + batch_b)) -eq 1 ]] || { echo "release race: effects=$releases released=$released runs=$((batch_a + batch_b))"; exit 1; }
echo "PASS f08-concurrent-worker"
