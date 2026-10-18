#!/usr/bin/env bash
# F02: two invitations for two different no-login Persons, accepted by the
# same new login at the same moment, in two real database sessions. Exactly
# one links; the other stops as an identity conflict with a report, and its
# invitation stays pending. Committed fixtures are removed afterwards.
#   bash supabase/tests/f02-concurrent-link.sh
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
org="aaaaaaaa-0000-4000-8000-000000000001"
user_id="60000000-0000-4000-8000-000000000001"
person_a="60000000-0000-4000-8000-0000000000a1"
person_b="60000000-0000-4000-8000-0000000000b1"
first="$(mktemp)"
second="$(mktemp)"

psql_run() { docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 -q -At "$@"; }

cleanup() {
  psql_run >/dev/null <<SQL
delete from public.person_invitations where token_hash in ('f02-race-a', 'f02-race-b');
delete from public.organization_members where user_id = '$user_id';
delete from public.people where id in ('$person_a', '$person_b') or profile_id = '$user_id';
delete from auth.users where id = '$user_id';
SQL
  rm -f "$first" "$second"
}
trap cleanup EXIT
cleanup

psql_run >/dev/null <<SQL
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '$user_id', 'authenticated', 'authenticated',
  'race.f02@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Race Tester"}'::jsonb, now(), now());
insert into public.people (id, organization_id, first_name) values
  ('$person_a', '$org', 'Race A'), ('$person_b', '$org', 'Race B');
insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at) values
  ('$org', '$person_a', 'race.f02@example.com', 'member', 'f02-race-a', now() + interval '1 day'),
  ('$org', '$person_b', 'race.f02@example.com', 'member', 'f02-race-b', now() + interval '1 day');
SQL

# Each session holds its transaction open briefly after accepting, so the
# other one has to wait on the link lock rather than run after it.
accept() {
  psql_run <<SQL
begin;
select out_status from public.accept_person_invitation('$1', '$user_id');
select pg_sleep(1);
commit;
SQL
}

accept f02-race-a >"$first" &
pid_a=$!
accept f02-race-b >"$second" &
pid_b=$!
wait "$pid_a" "$pid_b"

outcomes="$(cat "$first" "$second" | grep -E '^(linked|identity_conflict|person_linked|invalid)$' | sort | tr '\n' ' ')"
if [ "$outcomes" != "identity_conflict linked " ]; then
  echo "FAIL: expected one linked and one identity_conflict, got: $outcomes" >&2
  exit 1
fi

state="$(psql_run <<SQL
select (select count(*) from public.people where organization_id = '$org' and profile_id = '$user_id')
    || ' ' || (select count(*) from public.person_invitations where token_hash in ('f02-race-a', 'f02-race-b') and accepted_at is null)
    || ' ' || (select count(*) from public.person_identity_reconciliations
                where profile_id = '$user_id' and reason = 'invitation_conflict' and status = 'open');
SQL
)"
if [ "$state" != "1 1 1" ]; then
  echo "FAIL: expected one linked Person, one pending invitation, one report; got: $state" >&2
  exit 1
fi

echo "f02-concurrent-link: ok ($outcomes)"
