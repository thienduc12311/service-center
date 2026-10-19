#!/usr/bin/env bash
# F17: real concurrent sessions.
#  1. Two workers claim due webhook deliveries at once → every delivery is
#     leased exactly once (SKIP LOCKED), none twice.
#  2. Twenty concurrent requests with one API credential (limit 10/minute) →
#     the window counts exactly 20 and exactly 10 are allowed.
#  3. The same credential request key sent twice at once → one credential.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
owner="11111111-1111-4111-8111-111111111111"
new_id() { uuidgen | tr 'A-Z' 'a-z'; }
endpoint="$(new_id)"; cred="$(new_id)"
prefix="$(openssl rand -hex 8)"; secret_hash="$(openssl rand -hex 32)"
key="race-$(new_id)"
tmp="$(mktemp -d)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.webhook_events where id in (select event_id from public.webhook_deliveries where endpoint_id = '$endpoint');
delete from public.webhook_endpoints where id = '$endpoint';
delete from public.api_credentials where id = '$cred' or idempotency_key = '$key';
SQL
  rm -rf "$tmp"
}
trap cleanup EXIT
fail() { echo "FAIL: $1"; exit 1; }

psql_run >/dev/null <<SQL
insert into public.webhook_endpoints (id, organization_id, url, event_types, secret_ciphertext, secret_hint, created_by, idempotency_key)
values ('$endpoint', '$org', 'https://hooks.example.com/race', array['plan.published'], repeat('c', 40), 'abcd', '$owner', 'race-endpoint-$endpoint');
insert into public.webhook_events (id, organization_id, event_type, source_key, data)
select gen_random_uuid(), '$org', 'webhook.test', 'race:$endpoint:' || g, '{}'::jsonb from generate_series(1, 40) g;
insert into public.webhook_deliveries (organization_id, event_id, endpoint_id)
select '$org', e.id, '$endpoint' from public.webhook_events e where e.source_key like 'race:$endpoint:%';
insert into public.api_credentials (id, organization_id, name, key_prefix, secret_hash, scopes, rate_limit_per_minute, created_by, idempotency_key)
values ('$cred', '$org', 'race', '$prefix', '$secret_hash', array['plans.read'], 10, '$owner', 'race-cred-$cred');
SQL

# 1. Two workers, each claiming up to 30 of the 40 at the same moment (only this endpoint's rows are counted).
for w in a b; do
  psql_run -c "select delivery_id from public.claim_webhook_deliveries(30, 60) where endpoint_id = '$endpoint'" >"$tmp/$w" &
done
wait
total=$(cat "$tmp/a" "$tmp/b" | grep -c . || true)
unique=$(cat "$tmp/a" "$tmp/b" | sort -u | grep -c . || true)
[ "$unique" = "$total" ] || fail "a delivery was claimed twice ($total claims, $unique distinct)"
leased=$(psql_run -c "select count(*) from public.webhook_deliveries where endpoint_id = '$endpoint' and status = 'sending'")
[ "$leased" = "$total" ] || fail "leased $leased but claimed $total"
twice=$(psql_run -c "select count(*) from public.webhook_deliveries where endpoint_id = '$endpoint' and attempts > 1")
[ "$twice" = "0" ] || fail "$twice deliveries claimed more than once"

# 2. Twenty concurrent authentications against a 10/minute limit.
for i in $(seq 1 20); do
  docker exec -i "$container" psql -U postgres -q -At -c "set role service_role; select outcome from public.api_authenticate('$prefix', '$secret_hash')" >"$tmp/auth-$i" &
done
wait
ok=$(cat "$tmp"/auth-* | grep -c '^ok$' || true)
limited=$(cat "$tmp"/auth-* | grep -c '^rate_limited$' || true)
counted=$(psql_run -c "select sum(request_count) from public.api_credential_windows where credential_id = '$cred'")
# A minute boundary between requests splits the window; both windows still sum to 20.
[ "$counted" = "20" ] || fail "window counted $counted of 20"
[ "$((ok + limited))" = "20" ] || fail "outcomes $ok ok / $limited limited"
[ "$ok" -ge 10 ] && [ "$ok" -le 20 ] || fail "$ok allowed"
windows=$(psql_run -c "select count(*) from public.api_credential_windows where credential_id = '$cred'")
if [ "$windows" = "1" ]; then [ "$ok" = "10" ] || fail "single window allowed $ok, expected 10"; fi

# 3. One request key sent twice at once → one credential, one replay.
for i in 1 2; do
  docker exec -i "$container" psql -U postgres -q -At >"$tmp/create-$i" <<SQL &
begin;
select set_config('request.jwt.claims', '{"sub":"$owner","role":"authenticated"}', true);
set local role authenticated;
select replayed from public.create_api_credential('$org', 'race-key', array['plans.read'], '$(openssl rand -hex 8)', '$(openssl rand -hex 32)', null, 60, '$key');
commit;
SQL
done
wait
created=$(psql_run -c "select count(*) from public.api_credentials where idempotency_key = '$key'")
[ "$created" = "1" ] || fail "$created credentials for one request key"
replays=$(cat "$tmp/create-1" "$tmp/create-2" | grep -c '^t$' || true)
[ "$replays" = "1" ] || fail "expected one replay, saw $replays"

echo "f17-concurrent-webhooks: all checks passed (claimed $total once each; $ok/$limited allowed/limited; one credential per key)"
