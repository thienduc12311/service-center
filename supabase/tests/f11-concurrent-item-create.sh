#!/usr/bin/env bash
# F11: two editors append at the same moment, and one editor's add is sent
# twice at once with the same key (a retry racing a lost response). The plan
# lock assigns distinct positions to the appends and lets the keyed pair make
# exactly one item.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
owner="11111111-1111-4111-8111-111111111111"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
key="f11-race-$(uuidgen | tr 'A-Z' 'a-z')"
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
values ('$plan', '$org', '$service_type', 'F11 add race', '2028-04-09 14:00+00', 'draft', '$scheduler');
insert into public.plan_items (plan_id, item_type, title, length_seconds, sort_order)
values ('$plan', 'item', 'Welcome', 60, 0);
SQL

# $1 caller, $2 title, $3 key (or null)
add() {
  psql_run 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$1';
select 'added:' || (r -> 'item' ->> 'id') || ':' || (r -> 'item' ->> 'sort_order')
  from public.add_plan_item('$plan', '{"item_type":"item","title":"$2"}', $3) r;
select pg_sleep(0.5);
commit;
SQL
}

# 1) Two editors, different items, no key: distinct, consecutive positions.
add "$scheduler" "Prayer" null > "$out_a" & add "$owner" "Offering" null > "$out_b" & wait
orders="$(cat "$out_a" "$out_b" | grep '^added:' | cut -d: -f3 | sort | tr '\n' ' ')"
[ "$orders" = "1 2 " ] || { echo "FAIL: concurrent appends got sort_orders '$orders'"; cat "$out_a" "$out_b"; exit 1; }
echo "PASS: two simultaneous appends → distinct sort_orders 1 and 2"

# 2) One editor, same key twice at once: one item, both answers name it.
add "$scheduler" "Reading" "'$key'" > "$out_a" & add "$scheduler" "Reading" "'$key'" > "$out_b" & wait
ids="$(cat "$out_a" "$out_b" | grep '^added:' | cut -d: -f2 | sort -u)"
answers="$(cat "$out_a" "$out_b" | grep -c '^added:' || true)"
rows="$(psql_run -c "select count(*) from public.plan_items where plan_id = '$plan' and title = 'Reading'")"
[ "$answers" = "2" ] && [ "$(echo "$ids" | wc -l | tr -d ' ')" = "1" ] && [ "$rows" = "1" ] || {
  echo "FAIL: answers=$answers ids='$ids' rows=$rows"; cat "$out_a" "$out_b"; exit 1; }
echo "PASS: two simultaneous same-key creates → one item, both answered with it"
