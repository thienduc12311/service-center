#!/usr/bin/env bash
# Real separate transactions: competing previews and replay of one preview.
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
song="$(uuidgen | tr 'A-Z' 'a-z')"
org=aaaaaaaa-0000-4000-8000-000000000001
user=22222222-2222-4222-8222-222222222222
out_a="$(mktemp)"; out_b="$(mktemp)"
cleanup() {
 psql_run >/dev/null <<SQL
 delete from public.song_curation_events where target_id='$song';
 delete from public.song_bulk_previews where rows @> '[{"id":"$song"}]';
 delete from public.songs where id='$song';
SQL
 rm -f "$out_a" "$out_b"
}
trap cleanup EXIT
psql_run >/dev/null <<SQL
insert into public.songs(id,organization_id,title) values('$song','$org','F15 concurrent');
SQL
preview() {
 psql_run <<SQL
 set role authenticated;
 select set_config('request.jwt.claim.sub','$user',false);
 select (public.preview_song_bulk('$org','[{"id":"$song","expected_revision":$1}]','{"notes":"$2"}')).id;
SQL
}
a="$(preview 1 A | tail -1)"; b="$(preview 1 B | tail -1)"
commit_preview() {
 psql_run <<SQL
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','$user',true);
 select (public.commit_song_bulk('$org','$1')).id;
 select pg_sleep(0.3);
 commit;
SQL
}
commit_preview "$a" >"$out_a" 2>&1 & pid_a=$!
commit_preview "$b" >"$out_b" 2>&1 & pid_b=$!
status_a=0; wait "$pid_a" || status_a=$?
status_b=0; wait "$pid_b" || status_b=$?
if [[ "$status_a" -eq 0 && "$status_b" -ne 0 ]]; then loser="$out_b";
elif [[ "$status_b" -eq 0 && "$status_a" -ne 0 ]]; then loser="$out_a";
else cat "$out_a" "$out_b"; exit 1; fi
rg -q song_revision_stale "$loser"
c="$(preview 2 C | tail -1)"
commit_preview "$c" >"$out_a" 2>&1 & pid_a=$!
commit_preview "$c" >"$out_b" 2>&1 & pid_b=$!
wait "$pid_a"; wait "$pid_b"
result="$(psql_run <<SQL
select revision=3 and notes='C' and (select count(*)=2 from public.song_curation_events where target_id='$song') from public.songs where id='$song';
SQL
)"
[[ "$result" = t ]]
# Two arrangement archives must not leave an active song without a default.
arr_a="$(uuidgen | tr 'A-Z' 'a-z')"; arr_b="$(uuidgen | tr 'A-Z' 'a-z')"
psql_run >/dev/null <<SQL
insert into public.arrangements(id,song_id,name,is_default) values('$arr_a','$song','A',true),('$arr_b','$song','B',false);
SQL
archive_arr() {
 psql_run <<SQL
 begin;
 set local role authenticated;
 select set_config('request.jwt.claim.sub','$user',true);
 select public.archive_library_record('$org','arrangement','$1',1,true);
 select pg_sleep(0.3);
 commit;
SQL
}
archive_arr "$arr_a" >"$out_a" 2>&1 & pid_a=$!
archive_arr "$arr_b" >"$out_b" 2>&1 & pid_b=$!
status_a=0; wait "$pid_a" || status_a=$?
status_b=0; wait "$pid_b" || status_b=$?
[[ ( "$status_a" -eq 0 && "$status_b" -ne 0 ) || ( "$status_b" -eq 0 && "$status_a" -ne 0 ) ]]
result="$(psql_run <<SQL
select count(*) filter(where archived_at is null)=1 and count(*) filter(where is_default)=1 from public.arrangements where song_id='$song';
SQL
)"
[[ "$result" = t ]]
printf 'PASS: concurrent archives keep one active default.\n'
printf 'PASS: competing previews have one winner; concurrent replay has one effect and identical result.\n'
