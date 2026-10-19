#!/usr/bin/env bash
# Separate sessions: one durable job replays once; stale competing imports rollback.
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
org=aaaaaaaa-0000-4000-8000-000000000001
actor=22222222-2222-4222-8222-222222222222
suffix="$(uuidgen | tr 'A-Z' 'a-z')"
base="$(uuidgen | tr 'A-Z' 'a-z')"
out_a="$(mktemp)"; out_b="$(mktemp)"
cleanup() {
 psql_run >/dev/null <<SQL
begin;
create temporary table f15b_results on commit drop as select r.result_id as id from public.structured_import_rows r
 join public.structured_import_jobs j on j.id=r.job_id where j.idempotency_key like '$suffix%';
delete from public.structured_import_jobs where idempotency_key like '$suffix%';
delete from public.songs where id in (select id from f15b_results) or id='$base';
commit;
SQL
 rm -f "$out_a" "$out_b"
}
trap cleanup EXIT
save_job() {
 psql_run <<SQL
 set role authenticated;
 select set_config('request.jwt.claim.sub','$actor',false);
 select (public.save_structured_import('$org',jsonb_build_object('kind','songs','filename','race.csv','content_type','text/csv','content','race'),
 encode(extensions.digest('race','sha256'),'hex'),repeat('b',64),'$2','$suffix-$1')).id;
SQL
}
commit_job() {
 psql_run <<SQL
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','$actor',true);
 select (public.commit_structured_import('$org','$1',1)).id;
 select pg_sleep(0.3);
 commit;
SQL
}
j="$(save_job replay '[{"row":2,"action":"create","data":{"title":"F15B concurrent '$suffix'"}}]' | tail -1)"
commit_job "$j" >"$out_a" 2>&1 & pid_a=$!
commit_job "$j" >"$out_b" 2>&1 & pid_b=$!
wait "$pid_a"; wait "$pid_b"
commit_job "$j" >/dev/null # restart/lost-response retry in a fresh process
result="$(psql_run <<SQL
select count(*)=1 and (select count(*)=1 from public.arrangements where song_id in(select result_id from public.structured_import_rows where job_id='$j'))
 from public.songs where title='F15B concurrent $suffix';
SQL
)"
[[ "$result" = t ]]
psql_run >/dev/null <<SQL
insert into public.songs(id,organization_id,title) values('$base','$org','F15B competing $suffix');
SQL
version="$(psql_run <<SQL
select private.import_version(to_jsonb(s)) from public.songs s where id='$base';
SQL
)"
a="$(save_job a '[{"row":2,"action":"update","target_id":"'$base'","expected_version":"'$version'","data":{"notes":"A"}}]' | tail -1)"
b="$(save_job b '[{"row":2,"action":"update","target_id":"'$base'","expected_version":"'$version'","data":{"notes":"B"}}]' | tail -1)"
commit_job "$a" >"$out_a" 2>&1 & pid_a=$!
commit_job "$b" >"$out_b" 2>&1 & pid_b=$!
status_a=0; wait "$pid_a" || status_a=$?
status_b=0; wait "$pid_b" || status_b=$?
if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then loser="$out_b";
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then loser="$out_a";
else cat "$out_a" "$out_b"; exit 1; fi
rg -q 'Import record .* changed' "$loser"
result="$(psql_run <<SQL
select count(*) filter(where status='committed')=1 and count(*) filter(where status='reviewed')=1 from public.structured_import_jobs where id in('$a','$b');
SQL
)"
[[ "$result" = t ]]
printf 'PASS: concurrent and restarted import replay creates once; competing target reviews have one winner.\n'
