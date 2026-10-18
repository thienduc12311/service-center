#!/usr/bin/env bash
# F10: real contention on committed rows.
#  1. Two sessions generate with the same key at once: one batch, the same
#     plan ids for both, never two sets of plans.
#  2. Two sessions apply a template to one plan from the same preview with
#     different keys: one applies, the other is refused as stale.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
out_a="$(mktemp)"; out_b="$(mktemp)"; out_c="$(mktemp)"; out_d="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id = '$plan' or id in (
  select a.plan_id from public.plan_template_applications a
    join public.plan_templates t on t.id = a.template_id where t.name = 'F10 race');
delete from public.plan_generation_batches where template_id in (select id from public.plan_templates where name = 'F10 race');
delete from public.plan_templates where name = 'F10 race';
SQL
  rm -f "$out_a" "$out_b" "$out_c" "$out_d"
}
trap cleanup EXIT

revision="$(psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select public.save_plan_template('$org', null, null, 'plan', '$service_type', 'F10 race', null,
  '{"times":[{"kind":"service","name":"Service","day_offset":0,"local_start":"10:00","duration_minutes":60}],
    "items":[{"item_type":"item","title":"Race item"}]}'::jsonb, null, null) is not null;
commit;
select r.id from public.plan_template_revisions r join public.plan_templates t on t.id = r.template_id where t.name = 'F10 race';
SQL
)"
revision="$(echo "$revision" | tail -1)"

psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F10 race target', ('2028-01-09'::date + time '10:00') at time zone 'America/Toronto', 'draft', '$scheduler');
SQL

plans_json="$(psql_run <<SQL
select jsonb_agg(jsonb_build_object('local_date', d, 'title', 'Race ' || d,
  'service_date', (d + time '10:00') at time zone 'America/Toronto',
  'times', jsonb_build_array(jsonb_build_object(
    'starts_at', (d + time '10:00') at time zone 'America/Toronto',
    'ends_at', (d + time '11:00') at time zone 'America/Toronto'))) order by d)
from unnest(array['2028-02-06'::date, '2028-02-13'::date]) d;
SQL
)"

generate() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select pg_sleep(0.2);
select public.generate_plans_from_template('$org', '$revision', array['items','times'], '$plans_json'::jsonb,
  public.preview_plan_generation('$org', '$revision', array['items','times'], '$plans_json'::jsonb)->>'preview_hash',
  'f10-race-generate-key', '{}'::jsonb, null)->'plan_ids';
select pg_sleep(0.5);
commit;
SQL
}
generate > "$out_a" & generate > "$out_b" & wait

batches="$(psql_run -c "select count(*) from public.plan_generation_batches where idempotency_key = 'f10-race-generate-key'")"
created="$(psql_run -c "select count(*) from public.plan_template_applications a join public.plan_templates t on t.id = a.template_id where t.name = 'F10 race' and a.batch_id is not null")"
[ "$batches" = "1" ] || { echo "FAIL: $batches batches for one key"; exit 1; }
[ "$created" = "2" ] || { echo "FAIL: $created generated plans, expected 2"; exit 1; }
[ "$(cat "$out_a")" = "$(cat "$out_b")" ] || { echo "FAIL: sessions saw different plan ids"; cat "$out_a" "$out_b"; exit 1; }
echo "PASS: concurrent same-key generation → one batch, same ids"

preview="$(psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select (p->>'preview_hash') || ' ' || (p->>'destination_revision')
  from public.preview_plan_template_apply('$plan', '$revision', 'append', array['items'], '[]'::jsonb, null) p;
commit;
SQL
)"
hash="${preview%% *}"; rev="${preview##* }"

apply() {
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'applied:' || (public.apply_plan_template('$plan', '$revision', 'append', array['items'], '$hash',
  '[]'::jsonb, null, $rev, 'f10-race-apply-$1', null)->>'application_id');
select pg_sleep(0.5);
commit;
SQL
}
apply one > "$out_c" & apply two > "$out_d" & wait

applied="$(cat "$out_c" "$out_d" | grep -c '^applied:' || true)"
stale="$(cat "$out_c" "$out_d" | grep -c 'changed since you previewed' || true)"
items="$(psql_run -c "select count(*) from public.plan_items where plan_id = '$plan'")"
[ "$applied" = "1" ] && [ "$stale" = "1" ] && [ "$items" = "1" ] || {
  echo "FAIL: applied=$applied stale=$stale items=$items"; cat "$out_c" "$out_d"; exit 1; }
echo "PASS: concurrent applies from one preview → one applied, one stale"
