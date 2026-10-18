#!/usr/bin/env bash
# F06: two reviewed proposals computed from the same staffing revision race to
# commit different people into the same one-person need. Sorted plan locks
# serialize them; the second sees the bumped revision and refuses as stale.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
band="cccccccc-0000-4000-8000-000000000001"
eg="dddddddd-0000-4000-8000-000000000003"
service_type="bbbbbbbb-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
person_a="$(uuidgen | tr 'A-Z' 'a-z')"
person_b="$(uuidgen | tr 'A-Z' 'a-z')"
plan="$(uuidgen | tr 'A-Z' 'a-z')"
first="$(mktemp)"
second="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
delete from public.staffing_proposals where '$plan' = any(plan_ids);
delete from public.plans where id = '$plan';
delete from public.people where id in ('$person_a', '$person_b');
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT

psql_run >/dev/null <<SQL
insert into public.people (id, organization_id, first_name) values ('$person_a', '$org', 'F06 race A'), ('$person_b', '$org', 'F06 race B');
insert into public.team_memberships (team_id, person_id, position_id) values ('$band', '$person_a', '$eg'), ('$band', '$person_b', '$eg');
insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  ('$plan', '$org', '$service_type', 'F06 race', now() + interval '650 days', 'draft', '$scheduler');
insert into public.plan_times (plan_id, kind, starts_at, ends_at) values
  ('$plan', 'service', now() + interval '650 days', now() + interval '650 days 1 hour');
insert into public.plan_position_needs (plan_id, position_id, needed) values ('$plan', '$eg', 1);
SQL

# Both drafts are captured at the same staffing revision before either commits.
draft() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
insert into public.staffing_proposals (organization_id, author_id, rule_version, seed, lookback_days, plan_ids, team_ids,
  base_revisions, snapshot, result)
values ('$org', '$scheduler', 'f06.fairness.v1', 'race-$2', 90, array['$plan']::uuid[], array['$band']::uuid[],
  jsonb_build_array(jsonb_build_object('plan_id', '$plan', 'staffing_revision', (select staffing_revision from public.plans where id = '$plan'))),
  '{}', jsonb_build_object('choices', jsonb_build_array(jsonb_build_object(
    'plan_id', '$plan', 'team_id', '$band', 'position_id', '$eg', 'person_id', '$1', 'source', 'fairness'))))
returning id;
commit;
SQL
}
proposal_a="$(draft "$person_a" a | head -1)"
proposal_b="$(draft "$person_b" b | head -1)"

commit_one() {
  psql_run <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
select pg_sleep(0.3);
select 'committed:' || jsonb_array_length(public.commit_staffing_proposal('$1', 0, 'f06-race-$2')->'assignment_ids');
select pg_sleep(1);
commit;
SQL
}

set +e
commit_one "$proposal_a" a >"$first" 2>&1 & pid_a=$!
commit_one "$proposal_b" b >"$second" 2>&1 & pid_b=$!
wait "$pid_a"; rc_a=$?
wait "$pid_b"; rc_b=$?
set -e

committed="$(grep -h -c '^committed:1$' "$first" "$second" | awk '{s+=$1} END {print s+0}')"
refused="$(grep -h -c 'Staffing changed since this proposal was computed' "$first" "$second" | awk '{s+=$1} END {print s+0}')"
stored="$(psql_run -c "select count(*) from public.assignments where plan_id = '$plan'")"
prepared="$(psql_run -c "select count(*) from public.assignments where plan_id = '$plan' and visibility = 'prepared'")"
if [[ "$committed" != "1" || "$refused" != "1" || "$stored" != "1" || "$prepared" != "1" ]] || [[ $((rc_a + rc_b)) -eq 0 ]]; then
  echo "FAIL: committed=$committed refused=$refused stored=$stored prepared=$prepared rc=$rc_a/$rc_b" >&2
  cat "$first" "$second" >&2
  exit 1
fi
echo "f06 concurrent commit: one prepared request stored, the competing proposal refused as stale"
