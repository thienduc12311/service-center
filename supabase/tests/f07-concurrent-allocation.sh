#!/usr/bin/env bash
# F07: two real database sessions race for the last slot. The first case is
# claim/claim; the second is signup/manual scheduling. Exactly one transaction
# commits in each case and cleanup removes all committed fixtures.
#   bash supabase/tests/f07-concurrent-allocation.sh
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
position="dddddddd-0000-4000-8000-000000000003"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
sam_profile="33333333-3333-4333-8333-333333333333"
riley_profile="44444444-4444-4444-8444-444444444444"
morgan_profile="55555555-5555-4555-8555-555555555555"
sam="$(docker exec -i "$container" psql -U postgres -q -At -c "select id from public.people where profile_id='$sam_profile'")"
riley="$(docker exec -i "$container" psql -U postgres -q -At -c "select id from public.people where profile_id='$riley_profile'")"
morgan="$(docker exec -i "$container" psql -U postgres -q -At -c "select id from public.people where profile_id='$morgan_profile'")"
claim_plan="$(uuidgen | tr 'A-Z' 'a-z')"
claim_opportunity="$(uuidgen | tr 'A-Z' 'a-z')"
offer_plan="$(uuidgen | tr 'A-Z' 'a-z')"
offer_original="$(uuidgen | tr 'A-Z' 'a-z')"
offer_request="$(uuidgen | tr 'A-Z' 'a-z')"
offer_riley="$(uuidgen | tr 'A-Z' 'a-z')"
offer_morgan="$(uuidgen | tr 'A-Z' 'a-z')"
mixed_plan="$(uuidgen | tr 'A-Z' 'a-z')"
mixed_opportunity="$(uuidgen | tr 'A-Z' 'a-z')"
mixed_original="$(uuidgen | tr 'A-Z' 'a-z')"
mixed_request="$(uuidgen | tr 'A-Z' 'a-z')"
mixed_offer="$(uuidgen | tr 'A-Z' 'a-z')"
out_a="$(mktemp)"; out_b="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }

cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.plans where id in ('$claim_plan','$offer_plan','$mixed_plan');
delete from public.team_memberships where team_id='$band' and person_id in ('$riley','$morgan') and position_id='$position';
SQL
  rm -f "$out_a" "$out_b"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.team_memberships(team_id,user_id,person_id,position_id)
values
  ('$band','$riley_profile','$riley','$position'),
  ('$band','$morgan_profile','$morgan','$position')
on conflict do nothing;
insert into public.plans(id,organization_id,service_type_id,title,service_date,status,created_by) values
  ('$claim_plan','$org','$service_type','F07 claim race',now()+interval '500 days','published','$scheduler'),
  ('$offer_plan','$org','$service_type','F07 offer race',now()+interval '501 days','published','$scheduler'),
  ('$mixed_plan','$org','$service_type','F07 mixed race',now()+interval '502 days','published','$scheduler');
insert into public.plan_position_needs(plan_id,position_id,needed) values
  ('$claim_plan','$position',1),('$offer_plan','$position',1),('$mixed_plan','$position',1);
insert into public.signup_opportunities(id,organization_id,plan_id,team_id,position_id,capacity,approval_policy,closes_at,created_by) values
  ('$claim_opportunity','$org','$claim_plan','$band','$position',1,'direct',now()+interval '30 days','$scheduler'),
  ('$mixed_opportunity','$org','$mixed_plan','$band','$position',1,'direct',now()+interval '30 days','$scheduler');
insert into public.assignments(id,plan_id,person_id,user_id,team_id,position_id,status,created_by,visibility,released_at,attendance_mode) values
  ('$offer_original','$offer_plan','$sam','$sam_profile','$band','$position','declined','$scheduler','released',now(),'all'),
  ('$mixed_original','$mixed_plan','$sam','$sam_profile','$band','$position','declined','$scheduler','released',now(),'all');
insert into public.replacement_requests(id,organization_id,original_assignment_id,requester_person_id,plan_id,team_id,position_id,expires_at,idempotency_key,created_by) values
  ('$offer_request','$org','$offer_original','$sam','$offer_plan','$band','$position',now()+interval '7 days','f07-race-offer-request','$sam_profile'),
  ('$mixed_request','$org','$mixed_original','$sam','$mixed_plan','$band','$position',now()+interval '7 days','f07-race-mixed-request','$sam_profile');
insert into public.replacement_offers(id,request_id,candidate_person_id,request_version,idempotency_key,created_by) values
  ('$offer_riley','$offer_request','$riley',1,'f07-race-offer-riley','$scheduler'),
  ('$offer_morgan','$offer_request','$morgan',1,'f07-race-offer-morgan','$scheduler'),
  ('$mixed_offer','$mixed_request','$riley',1,'f07-race-mixed-offer','$scheduler');
SQL

claim() {
  local profile="$1" key="$2"
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub='$profile';
select 'claimed:' || id from public.claim_signup_opportunity('$claim_opportunity',1,'$key');
select pg_sleep(0.5);
commit;
SQL
}

set +e
claim "$sam_profile" 'f07-race-sam' >"$out_a" 2>&1 & pid_a=$!
claim "$riley_profile" 'f07-race-riley' >"$out_b" 2>&1 & pid_b=$!
wait "$pid_a"; rc_a=$?; wait "$pid_b"; rc_b=$?
set -e

claimed="$(grep -h -c '^claimed:' "$out_a" "$out_b" | awk '{s+=$1} END {print s+0}' || true)"
full="$(grep -h -c 'This opening is full' "$out_a" "$out_b" | awk '{s+=$1} END {print s+0}' || true)"
stored="$(psql_run -c "select count(*) from public.assignments where plan_id='$claim_plan' and status<>'declined'")"
if [[ "$claimed" != 1 || "$full" != 1 || "$stored" != 1 || $((rc_a + rc_b)) -eq 0 ]]; then
  echo "FAIL claim/claim: claimed=$claimed full=$full stored=$stored rc=$rc_a/$rc_b" >&2
  cat "$out_a" "$out_b" >&2
  exit 1
fi

accept_offer() {
  local profile="$1" offer="$2"
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub='$profile';
select 'accepted:' || id from public.act_on_replacement_offer('$offer',1,'accept');
select pg_sleep(0.5);
commit;
SQL
}

set +e
accept_offer "$riley_profile" "$offer_riley" >"$out_a" 2>&1 & pid_a=$!
accept_offer "$morgan_profile" "$offer_morgan" >"$out_b" 2>&1 & pid_b=$!
wait "$pid_a"; rc_a=$?; wait "$pid_b"; rc_b=$?
set -e

accepted="$(psql_run -c "select count(*) from public.replacement_offers where request_id='$offer_request' and status='accepted_awaiting_approval'")"
refused="$(grep -h -E -c 'vacancy is already filled|no longer has capacity' "$out_a" "$out_b" | awk '{s+=$1} END {print s+0}' || true)"
committed=$(( (rc_a == 0 ? 1 : 0) + (rc_b == 0 ? 1 : 0) ))
if [[ "$accepted" != 1 || "$refused" != 1 || "$committed" != 1 ]]; then
  echo "FAIL offer/offer: accepted=$accepted refused=$refused committed=$committed rc=$rc_a/$rc_b" >&2
  cat "$out_a" "$out_b" >&2
  exit 1
fi

signup() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub='$sam_profile';
select 'signup:' || id from public.claim_signup_opportunity('$mixed_opportunity',1,'f07-race-mixed-signup');
select pg_sleep(0.5);
commit;
SQL
}
manual() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub='$scheduler';
select 'manual:' || id from public.schedule_plan_assignments('$mixed_plan',jsonb_build_array(jsonb_build_object('person_id','$morgan','team_id','$band','position_id','$position')),false);
select pg_sleep(0.5);
commit;
SQL
}

set +e
signup >"$out_a" 2>&1 & pid_a=$!
accept_offer "$riley_profile" "$mixed_offer" >"$out_b" 2>&1 & pid_b=$!
out_c="$(mktemp)"
manual >"$out_c" 2>&1 & pid_c=$!
wait "$pid_a"; rc_a=$?; wait "$pid_b"; rc_b=$?; wait "$pid_c"; rc_c=$?
set -e

committed=$(( (rc_a == 0 ? 1 : 0) + (rc_b == 0 ? 1 : 0) + (rc_c == 0 ? 1 : 0) ))
refused="$(grep -h -E -c 'This opening is full|vacancy is already filled|no longer has capacity' "$out_a" "$out_b" "$out_c" | awk '{s+=$1} END {print s+0}' || true)"
occupied="$(psql_run -c "select (select count(*) from public.assignments where plan_id='$mixed_plan' and status<>'declined') + (select count(*) from public.replacement_offers where request_id='$mixed_request' and status='accepted_awaiting_approval')")"
if [[ "$committed" != 1 || "$refused" != 2 || "$occupied" != 1 ]]; then
  echo "FAIL signup/replacement/manual: committed=$committed refused=$refused occupied=$occupied rc=$rc_a/$rc_b/$rc_c" >&2
  cat "$out_a" "$out_b" "$out_c" >&2
  exit 1
fi
rm -f "$out_c"

echo "f07 concurrent allocation: claim/claim, offer/offer and signup/replacement/manual each stored one winner"
