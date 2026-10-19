#!/usr/bin/env bash
# F16: real concurrent sessions recording attendance for one plan time.
#  1. Two leaders mark the same Person from the same revision (0) at once →
#     exactly one applies; the other is refused as stale (nothing applied).
#  2. The same batch is retried concurrently with one idempotency key → one
#     batch and one revision; the retry answers "replayed".
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
owner="11111111-1111-4111-8111-111111111111"
scheduler="22222222-2222-4222-8222-222222222222"
riley="44444444-4444-4444-8444-444444444444"
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

person="$(psql_run -c "select id from public.people where organization_id = '$org' and profile_id = '$riley'")"
psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F16 race', '2028-06-04 14:00+00', 'published', '$scheduler');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at)
values ('$time9', '$plan', 'service', '9am', '2028-06-04 14:00+00', '2028-06-04 15:00+00');
insert into public.assignments (plan_id, person_id, user_id, team_id, status, visibility, created_by)
values ('$plan', '$person', '$riley', '$band', 'confirmed', 'released', '$scheduler');
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
mark() { # status, revision
  echo "jsonb_build_array(jsonb_build_object('person_id', '$person', 'team_id', '$band', 'status', '$1', 'expected_revision', $2))"
}

# 1 — competing leaders from the same revision.
as_user "$scheduler" "select 'applied:' || (public.record_attendance('$time9', $(mark present 0), null, 'race-a')->>'applied');" > "$out_a" &
as_user "$owner" "select 'applied:' || (public.record_attendance('$time9', $(mark absent 0), null, 'race-b')->>'applied');" > "$out_b" &
wait
applied="$(cat "$out_a" "$out_b" | grep -c '^applied:1' || true)"
stale="$(cat "$out_a" "$out_b" | grep -c 'changed since you loaded it' || true)"
records="$(psql_run -c "select count(*) || ':' || max(revision) from public.attendance_records where plan_time_id = '$time9'")"
events="$(psql_run -c "select count(*) from public.attendance_events e join public.attendance_records r on r.id = e.record_id where r.plan_time_id = '$time9'")"
[ "$applied" = "1" ] && [ "$stale" = "1" ] && [ "$records" = "1:1" ] && [ "$events" = "1" ] \
  || fail "competing: applied=$applied stale=$stale records=$records events=$events"
echo "PASS: competing leaders at one revision → one applied, one stale, one record"

# 2 — the same key retried concurrently.
: > "$out_a"; : > "$out_b"
as_user "$scheduler" "select 'replayed:' || (public.record_attendance('$time9', $(mark unknown 1), null, 'retry-key')->>'replayed');" > "$out_a" &
as_user "$scheduler" "select 'replayed:' || (public.record_attendance('$time9', $(mark unknown 1), null, 'retry-key')->>'replayed');" > "$out_b" &
wait
first="$(cat "$out_a" "$out_b" | grep -c '^replayed:false' || true)"
second="$(cat "$out_a" "$out_b" | grep -c '^replayed:true' || true)"
revision="$(psql_run -c "select revision from public.attendance_records where plan_time_id = '$time9'")"
batches="$(psql_run -c "select count(*) from public.attendance_batches where plan_time_id = '$time9' and idempotency_key = 'retry-key'")"
[ "$first" = "1" ] && [ "$second" = "1" ] && [ "$revision" = "2" ] && [ "$batches" = "1" ] \
  || fail "retry: first=$first replayed=$second revision=$revision batches=$batches"
echo "PASS: concurrent retry with one key → one batch, one revision, one replay"
