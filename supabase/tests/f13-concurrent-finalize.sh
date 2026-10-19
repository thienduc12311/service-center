#!/usr/bin/env bash
# F13: real concurrent sessions against one file.
#  1. The same upload intent is requested twice at once (one idempotency key)
#     → exactly one pending version; the loser is refused and a retry replays.
#  2. The same version is finalized twice at once → one finalize, one replay,
#     version number 1.
#  3. Two replacements requested against the same version finalize at once
#     → one becomes version 2, the other fails as superseded and its bytes are
#     queued for removal.
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
scheduler="22222222-2222-4222-8222-222222222222"
new_id() { uuidgen | tr 'A-Z' 'a-z'; }
song="$(new_id)"
out_a="$(mktemp)"; out_b="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }
cleanup() {
  psql_run >/dev/null <<SQL || true
begin;
-- The objects below are synthetic rows (no bytes), so they are removed directly.
set local storage.allow_delete_query = 'true';
create temporary table f13_paths on commit drop as
  select v.storage_path from public.attachment_versions v join public.attachments a on a.id = v.attachment_id
   where a.song_id = '$song' and v.storage_path is not null;
delete from public.songs where id = '$song';
delete from storage.objects where bucket_id = 'attachments' and name in (select storage_path from f13_paths);
delete from public.attachment_object_removals where object_path in (select storage_path from f13_paths);
commit;
SQL
  rm -f "$out_a" "$out_b"
}
trap cleanup EXIT
fail() { echo "FAIL: $1"; cat "$out_a" "$out_b"; exit 1; }

psql_run >/dev/null <<SQL
insert into public.songs (id, organization_id, title) values ('$song', '$org', 'F13 race');
SQL

as_user() { # sql
  docker exec -i "$container" psql -U postgres -q -At 2>&1 <<SQL || true
begin;
set local role authenticated;
set local request.jwt.claim.sub = '$scheduler';
$1
select pg_sleep(0.5);
commit;
SQL
}
intent_sql() { # key, size, file|null, revision|null
  echo "select 'intent:' || (public.create_file_upload_intent('song', '$song', $3, $4, 'Chart.pdf', 'application/pdf', $2, null, 'chart', 'organization', '{}', '{}', '$1')->'version'->>'id');"
}
put() { # path, size (stands in for the Storage upload of the bytes)
  psql_run >/dev/null <<SQL
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('attachments', '$1', '$scheduler', '$scheduler', jsonb_build_object('size', $2, 'mimetype', 'application/pdf'));
SQL
}

# 1 — concurrent intents with one key.
as_user "$(intent_sql race-key-1 100 null null)" > "$out_a" &
as_user "$(intent_sql race-key-1 100 null null)" > "$out_b" &
wait
made="$(cat "$out_a" "$out_b" | grep -c '^intent:' || true)"
versions="$(psql_run -c "select count(*) from public.attachment_versions where idempotency_key = 'race-key-1'")"
files="$(psql_run -c "select count(*) from public.attachments where song_id = '$song'")"
[ "$versions" = "1" ] && [ "$files" = "1" ] && [ "$made" -ge 1 ] || fail "intent: made=$made versions=$versions files=$files"
retry="$(as_user "select (public.create_file_upload_intent('song', '$song', null, null, 'Chart.pdf', 'application/pdf', 100, null, 'chart', 'organization', '{}', '{}', 'race-key-1')->>'replayed');" | grep -E '^(t|f)' | head -1)"
[ "$retry" = "true" ] || [ "$retry" = "t" ] || fail "retry did not replay ($retry)"
echo "PASS: concurrent intents with one key → one pending version; retry replays"

version="$(psql_run -c "select id from public.attachment_versions where idempotency_key = 'race-key-1'")"
file="$(psql_run -c "select attachment_id from public.attachment_versions where id = '$version'")"
put "$(psql_run -c "select storage_path from public.attachment_versions where id = '$version'")" 100

# 2 — concurrent finalize of one version.
as_user "select 'final:' || (public.finalize_file_version('$version')->>'replayed');" > "$out_a" &
as_user "select 'final:' || (public.finalize_file_version('$version')->>'replayed');" > "$out_b" &
wait
fresh="$(cat "$out_a" "$out_b" | grep -c '^final:false' || true)"
replay="$(cat "$out_a" "$out_b" | grep -c '^final:true' || true)"
number="$(psql_run -c "select version_number from public.attachment_versions where id = '$version'")"
[ "$fresh" = "1" ] && [ "$replay" = "1" ] && [ "$number" = "1" ] || fail "finalize: fresh=$fresh replay=$replay number=$number"
echo "PASS: concurrent finalize → one finalize, one replay, version 1"

# 3 — two replacements against v1 finalize at once.
rev="$(psql_run -c "select revision from public.attachments where id = '$file'")"
a="$(as_user "$(intent_sql race-a 200 "'$file'" "$rev")" | sed -n 's/^intent://p')"
b="$(as_user "$(intent_sql race-b 300 "'$file'" "$rev")" | sed -n 's/^intent://p')"
[ -n "$a" ] && [ -n "$b" ] || fail "replacement intents ($a / $b)"
put "$(psql_run -c "select storage_path from public.attachment_versions where id = '$a'")" 200
put "$(psql_run -c "select storage_path from public.attachment_versions where id = '$b'")" 300
as_user "select 'outcome:' || (public.finalize_file_version('$a')->>'outcome');" > "$out_a" &
as_user "select 'outcome:' || (public.finalize_file_version('$b')->>'outcome');" > "$out_b" &
wait
ready="$(cat "$out_a" "$out_b" | grep -c '^outcome:ready' || true)"
failed="$(cat "$out_a" "$out_b" | grep -c '^outcome:failed' || true)"
current="$(psql_run -c "select v.version_number from public.attachments f join public.attachment_versions v on v.id = f.current_version_id where f.id = '$file'")"
superseded="$(psql_run -c "select count(*) from public.attachment_versions where id in ('$a','$b') and failure_reason = 'superseded'")"
queued="$(psql_run -c "select count(*) from public.attachment_object_removals r join public.attachment_versions v on v.storage_path = r.object_path where v.id in ('$a','$b') and v.status = 'failed'")"
[ "$ready" = "1" ] && [ "$failed" = "1" ] && [ "$current" = "2" ] && [ "$superseded" = "1" ] && [ "$queued" = "1" ] \
  || fail "replace: ready=$ready failed=$failed current=v$current superseded=$superseded queued=$queued"
echo "PASS: concurrent replacements → one becomes v2, the other superseded and queued for removal"
