-- Join a church by its slug (migration 20261117000000).
-- Run against the seeded local database; everything is rolled back:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/church-join-requests.sql
begin;

-- Fixtures: two people in no church, one who sends too many requests, and a
-- disabled church. Seeded Riverside: owner 1111…, scheduler 2222…, member 3333….
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c1c1c1c1-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'joiner.one@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Jo Joiner"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1c1c1c1-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'joiner.two@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Kim Second Joiner"}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1c1c1c1-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
   'joiner.three@example.com', '', now(), '', '', '', '', '{}'::jsonb, '{"full_name":"Lee"}'::jsonb, now(), now());

insert into public.organizations (id, name, slug, timezone)
values ('dddddddd-0000-4000-8000-000000000001', 'Closed Church', 'closed-church', 'America/Toronto');
update public.organization_platform_controls
   set status = 'disabled', disabled_reason = 'Test', disabled_at = now()
 where organization_id = 'dddddddd-0000-4000-8000-000000000001';

-- An unlinked roster person with the second joiner's email (any case): approval links to it.
insert into public.people (id, organization_id, first_name, last_name, email)
values ('eeeeeeee-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Kim', 'Roster', 'Joiner.Two@example.com');

-- The seeded scheduler becomes an admin: admins can't see or decide requests either.
update public.organization_members set role = 'admin'
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '22222222-2222-4222-8222-222222222222';

create temporary table join_test (key text primary key, id uuid) on commit drop;
grant select, insert, update on join_test to authenticated;

-- ------------------------------------------------------ requester, under RLS --
set local role authenticated;
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000001';
do $$
declare
  v_id         uuid;
  v_hint       text;
  v_unknown    text;
  v_disabled   text;
  v_name       text;
  n            int;
begin
  -- Lookup: an active church by slug, normalized; nothing for unknown or disabled.
  select name into v_name from public.find_church_by_slug('  Riverside ');
  if v_name is null then raise exception 'Lookup did not find Riverside'; end if;
  if (select count(*) from public.find_church_by_slug('no-such-church')) <> 0 then
    raise exception 'Lookup found an unknown church';
  end if;
  if (select count(*) from public.find_church_by_slug('closed-church')) <> 0 then
    raise exception 'Lookup found a disabled church';
  end if;

  -- Unknown and disabled are refused with the same message and hint.
  begin
    perform public.request_to_join_church('no-such-church', null);
    raise exception 'Asked to join an unknown church';
  exception when no_data_found then
    get stacked diagnostics v_unknown = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from 'church_not_found' then raise exception 'Unknown church hint %', v_hint; end if;
  end;
  begin
    perform public.request_to_join_church('closed-church', null);
    raise exception 'Asked to join a disabled church';
  exception when no_data_found then
    get stacked diagnostics v_disabled = message_text, v_hint = pg_exception_hint;
    if v_hint is distinct from 'church_not_found' then raise exception 'Disabled church hint %', v_hint; end if;
  end;
  if v_unknown is distinct from v_disabled then
    raise exception 'Unknown (%) and disabled (%) churches answer differently', v_unknown, v_disabled;
  end if;

  v_id := public.request_to_join_church('RIVERSIDE', '  I sing tenor.  ');
  insert into join_test values ('first', v_id);
  if (select message from public.church_join_requests where id = v_id) <> 'I sing tenor.' then
    raise exception 'The message was not trimmed';
  end if;
  if (select requester_email from public.church_join_requests where id = v_id) <> 'joiner.one@example.com' then
    raise exception 'The requester email was not recorded';
  end if;

  -- A second pending request for the same church is refused.
  begin
    perform public.request_to_join_church('riverside', null);
    raise exception 'A second pending request was accepted';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'join_request_pending' then raise exception 'Duplicate hint %', v_hint; end if;
  end;

  -- The requester sees their own request with the church name.
  if (select organization_name from public.my_church_join_requests() where id = v_id) is distinct from v_name then
    raise exception 'my_church_join_requests did not name the church';
  end if;
  if (select count(*) from public.my_church_join_requests(v_id)) <> 1 then
    raise exception 'my_church_join_requests(id) did not return the request';
  end if;

  -- No direct inserts, no reading who decided, no approving or deciding their own.
  begin
    insert into public.church_join_requests (organization_id, requester_id, requester_email)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000001', 'x@example.com');
    raise exception 'The requester inserted a request directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform decided_by from public.church_join_requests;
    raise exception 'The requester can read who decided';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.church_join_requests set status = 'approved' where id = v_id;
    raise exception 'The requester approved their own request';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.approve_church_join_request(v_id);
    raise exception 'The requester approved through the function';
  exception when no_data_found then null;
  end;
  begin
    perform public.decline_church_join_request(v_id, null);
    raise exception 'The requester declined through the function';
  exception when no_data_found then null;
  end;
end;
$$;

-- A member of any status can't ask to join their own church.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  v_hint text;
begin
  begin
    perform public.request_to_join_church('riverside', null);
    raise exception 'A member asked to join their own church';
  exception when sqlstate 'PT409' then
    get stacked diagnostics v_hint = pg_exception_hint;
    if v_hint is distinct from 'already_church_member' then raise exception 'Member hint %', v_hint; end if;
  end;
end;
$$;
reset role;
update public.organization_members set status = 'inactive'
 where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001' and user_id = '55555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
do $$
begin
  begin
    perform public.request_to_join_church('riverside', null);
    raise exception 'An inactive member asked to join';
  exception when sqlstate 'PT409' then null;
  end;
end;
$$;

-- ------------------------------------------------ non-owners see nothing ------
-- A plain member and an admin of the church.
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$
declare
  v_id uuid := (select id from join_test where key = 'first');
begin
  if (select count(*) from public.church_join_requests) <> 0 then
    raise exception 'A member can see join requests';
  end if;
  begin
    perform public.approve_church_join_request(v_id);
    raise exception 'A member approved a join request';
  exception when no_data_found then null;
  end;
  begin
    perform public.decline_church_join_request(v_id, 'no');
    raise exception 'A member declined a join request';
  exception when no_data_found then null;
  end;
end;
$$;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare
  v_id uuid := (select id from join_test where key = 'first');
  n int;
begin
  if (select count(*) from public.church_join_requests) <> 0 then
    raise exception 'An admin (not an owner) can see join requests';
  end if;
  begin
    perform public.approve_church_join_request(v_id);
    raise exception 'An admin approved a join request';
  exception when no_data_found then null;
  end;
  update public.church_join_requests set status = 'withdrawn' where id = v_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'An admin withdrew someone else''s request'; end if;
end;
$$;

-- ----------------------------------------------------- the owner declines -----
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_id  uuid := (select id from join_test where key = 'first');
  v_row public.church_join_requests;
begin
  if (select count(*) from public.church_join_requests where id = v_id and status = 'pending'
         and requester_name = 'Jo Joiner' and requester_email = 'joiner.one@example.com') <> 1 then
    raise exception 'The owner can''t see the pending request';
  end if;
  v_row := public.decline_church_join_request(v_id, '  We are not taking new members.  ');
  if v_row.status <> 'declined' or v_row.decline_reason <> 'We are not taking new members.'
     or v_row.decided_at is null or v_row.decided_by <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'Decline did not record the decision: %', row_to_json(v_row);
  end if;
  -- Declining again changes nothing; approving a declined request is refused.
  v_row := public.decline_church_join_request(v_id, 'other');
  if v_row.decline_reason <> 'We are not taking new members.' then raise exception 'A second decline changed the reason'; end if;
  begin
    perform public.approve_church_join_request(v_id);
    raise exception 'A declined request was approved';
  exception when sqlstate 'PT409' then null;
  end;
end;
$$;

-- ------------------------------------- requester: see decline, ask, withdraw --
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000001';
do $$
declare
  v_first uuid := (select id from join_test where key = 'first');
  v_id    uuid;
  n       int;
begin
  if (select decline_reason from public.my_church_join_requests(v_first)) <> 'We are not taking new members.' then
    raise exception 'The requester can''t see the decline reason';
  end if;
  -- Asking again after a decline is allowed.
  v_id := public.request_to_join_church('riverside', null);
  update public.church_join_requests set status = 'withdrawn' where id = v_id;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'The requester could not withdraw a pending request'; end if;
  update public.church_join_requests set status = 'withdrawn' where id = v_id;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A withdrawn request was withdrawn again'; end if;
  -- A decided request can't be withdrawn or reopened.
  update public.church_join_requests set status = 'withdrawn' where id = v_first;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'A declined request was withdrawn'; end if;
  begin
    update public.church_join_requests set status = 'pending' where id = v_id;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'A withdrawn request was reopened'; end if;
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- ------------------------------------------------------ the owner approves ----
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000002';
do $$
begin
  insert into join_test values ('second', public.request_to_join_church('riverside', 'Hello'));
end;
$$;
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000003';
do $$
begin
  insert into join_test values ('third', public.request_to_join_church('riverside', null));
end;
$$;

set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_second  uuid := (select id from join_test where key = 'second');
  v_third   uuid := (select id from join_test where key = 'third');
  r         record;
  v_inv     uuid;
  v_other   uuid;
  v_row     public.church_join_requests;
begin
  -- Links to the unlinked roster person with the same email.
  select * into r from public.approve_church_join_request(v_second);
  if r.out_person_id <> 'eeeeeeee-0000-4000-8000-000000000001' or not r.out_newly_approved
     or r.out_email <> 'joiner.two@example.com' or r.out_invitation_id is not null then
    raise exception 'Approval did not link the same-email person: %', row_to_json(r);
  end if;
  if (select status from public.church_join_requests where id = v_second) <> 'approved' then
    raise exception 'The request is not approved';
  end if;
  -- No membership is created by approving.
  if exists (select 1 from public.organization_members
              where organization_id = 'aaaaaaaa-0000-4000-8000-000000000001'
                and user_id = 'c1c1c1c1-0000-4000-8000-000000000002') then
    raise exception 'Approval created a membership';
  end if;

  -- Approving again is a no-op that returns the same person.
  select * into r from public.approve_church_join_request(v_second);
  if r.out_newly_approved or r.out_person_id <> 'eeeeeeee-0000-4000-8000-000000000001' then
    raise exception 'A second approval changed something: %', row_to_json(r);
  end if;
  begin
    perform public.decline_church_join_request(v_second, null);
    raise exception 'An approved request was declined';
  exception when sqlstate 'PT409' then null;
  end;

  -- The API's invitation (here inserted as the owner, under RLS) is recorded once.
  insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at, created_by)
  values ('aaaaaaaa-0000-4000-8000-000000000001', r.out_person_id, r.out_email, 'member',
          'test-join-token-hash-1', now() + interval '7 days', '11111111-1111-4111-8111-111111111111')
  returning id into v_inv;
  v_row := public.record_church_join_request_invitation(v_second, v_inv);
  if v_row.invitation_id <> v_inv then raise exception 'The invitation was not recorded'; end if;

  -- Without a same-email person, a new one is created from the profile.
  select * into r from public.approve_church_join_request(v_third);
  if r.out_person_id = 'eeeeeeee-0000-4000-8000-000000000001' or r.out_first_name <> 'Lee'
     or r.out_last_name is not null then
    raise exception 'Approval did not create a person named from the profile: %', row_to_json(r);
  end if;
  if (select email from public.people where id = r.out_person_id) <> 'joiner.three@example.com' then
    raise exception 'The new person has no email';
  end if;
  -- Another request's invitation can't be recorded here.
  begin
    perform public.record_church_join_request_invitation(v_third, v_inv);
    raise exception 'An invitation for another person was recorded';
  exception when invalid_parameter_value then null;
  end;
  insert into public.person_invitations (organization_id, person_id, email, role, token_hash, expires_at, created_by)
  values ('aaaaaaaa-0000-4000-8000-000000000001', r.out_person_id, r.out_email, 'member',
          'test-join-token-hash-2', now() + interval '7 days', '11111111-1111-4111-8111-111111111111')
  returning id into v_other;
  perform public.record_church_join_request_invitation(v_third, v_other);
  -- A retry never replaces the recorded invitation.
  v_row := public.record_church_join_request_invitation(v_second, v_inv);
  if v_row.invitation_id <> v_inv then raise exception 'A retry replaced the invitation'; end if;
  select * into r from public.approve_church_join_request(v_second);
  if r.out_invitation_id <> v_inv then raise exception 'A later approval lost the invitation'; end if;
end;
$$;

-- The approved requester sees the decision.
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000002';
do $$
begin
  if (select status from public.my_church_join_requests((select id from join_test where key = 'second'))) <> 'approved' then
    raise exception 'The requester can''t see the approval';
  end if;
end;
$$;

-- ------------------------------------------------------------- rate limit ----
reset role;
insert into public.church_join_requests (organization_id, requester_id, status, requester_email)
select 'aaaaaaaa-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000003', 'withdrawn', 'joiner.three@example.com'
  from generate_series(1, 9);
set local role authenticated;
set local request.jwt.claim.sub = 'c1c1c1c1-0000-4000-8000-000000000003';
do $$
begin
  begin
    perform public.request_to_join_church('riverside', null);
    raise exception 'The rate limit did not apply';
  exception when sqlstate 'PT429' then null;
  end;
end;
$$;

-- --------------------------------------------------------- anonymous ---------
reset role;
set local role anon;
do $$
begin
  begin
    perform public.find_church_by_slug('riverside');
    raise exception 'An anonymous caller looked up a church';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.church_join_requests;
    raise exception 'An anonymous caller read join requests';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
select 'church-join-requests: ok' as result;
rollback;
