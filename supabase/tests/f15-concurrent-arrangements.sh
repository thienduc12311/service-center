#!/usr/bin/env bash
# Separate database sessions: idempotent duplication and competing merges.
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At; }
new_id() { uuidgen | tr 'A-Z' 'a-z'; }
org=aaaaaaaa-0000-4000-8000-000000000001
actor=22222222-2222-4222-8222-222222222222
song="$(new_id)"; winner_a="$(new_id)"; winner_b="$(new_id)"; arr="$(new_id)"
key="$(new_id)"; merge_a="$(new_id)"; merge_b="$(new_id)"
out_a="$(mktemp)"; out_b="$(mktemp)"
cleanup() {
 psql_run >/dev/null <<SQL
 begin;
 select set_config('service_center.merging','yes',true);
 delete from public.library_operations where idempotency_key in ('$key','$merge_a','$merge_b');
 update public.songs set merged_into_song_id=null,merged_default_arrangement_id=null where id in ('$song','$winner_a','$winner_b');
 delete from public.songs where id in ('$song','$winner_a','$winner_b');
 commit;
SQL
 rm -f "$out_a" "$out_b"
}
trap cleanup EXIT
psql_run >/dev/null <<SQL
insert into public.songs(id,organization_id,title) values ('$song','$org','F15 C race'),('$winner_a','$org','F15 C race A'),('$winner_b','$org','F15 C race B');
insert into public.arrangements(id,song_id,name,is_default) values ('$arr','$song','Source',true),(gen_random_uuid(),'$winner_a','Default A',true),(gen_random_uuid(),'$winner_b','Default B',true);
SQL
selection='{"name":"Concurrent copy","expected_revision":1,"metadata":true,"sections":true,"chart":true,"key_ids":[],"file_ids":[]}'
fingerprint="$(psql_run <<SQL
 set role authenticated;
 select set_config('request.jwt.claim.sub','$actor',false);
 select public.preview_arrangement_duplicate('$org','$arr','$selection')->>'fingerprint';
SQL
)"; fingerprint="${fingerprint##*$'\n'}"
duplicate() {
 psql_run <<SQL
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','$actor',true);
 select public.duplicate_arrangement('$org','$arr','$selection','$fingerprint','$key');
 select pg_sleep(0.3);
 commit;
SQL
}
duplicate >"$out_a" 2>&1 & pid_a=$!
duplicate >"$out_b" 2>&1 & pid_b=$!
wait "$pid_a"; wait "$pid_b"
result="$(psql_run <<SQL
select count(*)=2 and (select count(*)=1 from public.library_operations where idempotency_key='$key') from public.arrangements where song_id='$song';
SQL
)"; [[ "$result" = t ]]
preview_merge() {
 psql_run <<SQL
 set role authenticated;
 select set_config('request.jwt.claim.sub','$actor',false);
 select public.preview_song_merge('$org','$1','$song')->>'fingerprint';
SQL
}
fa="$(preview_merge "$winner_a" | tail -1)"; fb="$(preview_merge "$winner_b" | tail -1)"
merge() {
 psql_run <<SQL
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','$actor',true);
 select public.commit_song_merge('$org','$1','$song','$2','$3');
 select pg_sleep(0.3);
 commit;
SQL
}
merge "$winner_a" "$fa" "$merge_a" >"$out_a" 2>&1 & pid_a=$!
merge "$winner_b" "$fb" "$merge_b" >"$out_b" 2>&1 & pid_b=$!
status_a=0; wait "$pid_a" || status_a=$?
status_b=0; wait "$pid_b" || status_b=$?
if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then loser="$out_b"; winning="$winner_a"; committed_key="$merge_a"; committed_hash="$fa";
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then loser="$out_a"; winning="$winner_b"; committed_key="$merge_b"; committed_hash="$fb";
else cat "$out_a" "$out_b"; exit 1; fi
rg -q library_changed "$loser"
# A new process retries the committed operation after the losing song is archived.
merge "$winning" "$committed_hash" "$committed_key" >/dev/null
result="$(psql_run <<SQL
select merged_into_song_id='$winning' and archived_at is not null
 and (select count(*)=1 from public.library_operations where idempotency_key in ('$merge_a','$merge_b'))
 and (select count(*)=3 from public.arrangements where song_id='$winning') from public.songs where id='$song';
SQL
)"; [[ "$result" = t ]]
echo 'PASS: concurrent duplicate replay, competing merge stale rejection, fresh-process replay, no lost arrangements'
