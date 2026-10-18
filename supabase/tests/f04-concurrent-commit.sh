#!/usr/bin/env bash
# F04: two real database sessions schedule the same Person onto two different
# plans whose times overlap. Each first runs the conflict check (both see no
# conflict: a stale preview), then commits. Exactly one commit succeeds; the
# other is refused with PT409 `scheduling_conflict` at commit time.
# Committed fixtures are removed afterwards.
#   bash supabase/tests/f04-concurrent-commit.sh
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
insert into public.people (id, organization_id, first_name) values ('$person', '$org', 'F04 race');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan_x', '$org', '$service_type', 'F04 race X', now() + interval '500 days', 'published', '$scheduler'),
  ('$plan_y', '$org', '$service_type', 'F04 race Y', now() + interval '500 days', 'published', '$scheduler');
insert into public.plan_times (plan_id, kind, starts_at, ends_at) values
  ('$plan_x', 'service', now() + interval '500 days', now() + interval '500 days 1 hour'),
  ('$plan_y', 'rehearsal', now() + interval '500 days 30 minutes', now() + interval '500 days 90 minutes');
SQL

commit_on() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'preview:' || count(*) from public.check_assignment_conflicts('$org',
  jsonb_build_array(jsonb_build_object('person_id', '$person', 'plan_id', '$1', 'attendance_mode', 'all')));
select pg_sleep(0.5);
select 'created:' || id from public.schedule_plan_assignments('$1',
  jsonb_build_array(jsonb_build_object('person_id', '$person', 'team_id', '$band')), false);
select pg_sleep(1);
commit;
SQL
}

set +e
commit_on "$plan_x" >"$first" 2>&1 &
pid_a=$!
commit_on "$plan_y" >"$second" 2>&1 &
pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e

previews="$(cat "$first" "$second" | grep -c '^preview:0$' || true)"
created="$(cat "$first" "$second" | grep -c '^created:' || true)"
refused="$(cat "$first" "$second" | grep -c 'unavailable or already scheduled' || true)"
stored="$(psql_run -c "select count(*) from public.assignments where person_id = '$person'")"

if [[ "$previews" != "2" || "$created" != "1" || "$refused" != "1" || "$stored" != "1" ]] \
   || [[ $((rc_a + rc_b)) -eq 0 ]]; then
  echo "FAIL: previews=$previews created=$created refused=$refused stored=$stored rc=$rc_a/$rc_b" >&2
  cat "$first" "$second" >&2
  exit 1
fi
echo "f04 concurrent commit: both previews clean, one commit stored, one refused (stored=$stored)"
