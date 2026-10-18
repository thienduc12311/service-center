#!/usr/bin/env bash
# F11: two editors read the same plan revision and save competing changes —
# one reorders, the other edits an item. The plan lock serializes them; the
# second is refused as stale instead of silently overwriting the first.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
i1="$(uuidgen | tr 'A-Z' 'a-z')"; i2="$(uuidgen | tr 'A-Z' 'a-z')"
out_a="$(mktemp)"; out_b="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id = '$plan';
SQL
  rm -f "$out_a" "$out_b"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by)
values ('$plan', '$org', '$service_type', 'F11 race', '2028-04-02 14:00+00', 'draft', '$scheduler');
insert into public.plan_items (id, plan_id, item_type, title, length_seconds, sort_order) values
  ('$i1', '$plan', 'item', 'First', 60, 0), ('$i2', '$plan', 'item', 'Second', 60, 1);
SQL
revision="$(psql_run -c "select content_revision from public.plans where id = '$plan'")"

reorder() {
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'saved:' || (public.reorder_plan_items('$plan', array['$i2','$i1']::uuid[], $revision)->>'content_revision');
select pg_sleep(0.5);
commit;
SQL
}
edit() {
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select 'saved:' || (public.update_plan_item('$plan', '$i1', '{"length_seconds": 90}', $revision)->>'content_revision');
select pg_sleep(0.5);
commit;
SQL
}
reorder > "$out_a" & edit > "$out_b" & wait

saved="$(cat "$out_a" "$out_b" | grep -c '^saved:' || true)"
stale="$(cat "$out_a" "$out_b" | grep -c '^ERROR: .*changed since you opened it' || true)"
[ "$saved" = "1" ] && [ "$stale" = "1" ] || {
  echo "FAIL: saved=$saved stale=$stale"; cat "$out_a" "$out_b"; exit 1; }
echo "PASS: competing reorder and edit from one revision → one saved, one refused as stale"
