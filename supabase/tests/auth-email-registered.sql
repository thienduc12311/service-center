-- W10-SEC-D4: auth_email_registered answers whether any login (confirmed or
-- not) holds an address, for the service role only. Needs migration
-- 20261201000020.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/auth-email-registered.sql
-- Everything runs inside one transaction and is rolled back.
begin;

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
  'unconfirmed.w10sec@example.test', '', null, '', '', '', '', '{}'::jsonb, '{}'::jsonb, now(), now());

set local role service_role;
do $$
begin
  if not public.auth_email_registered('  Unconfirmed.W10Sec@Example.test ') then
    raise exception 'unconfirmed signup not reported';
  end if;
  if public.auth_email_registered('nobody.w10sec@example.test') then
    raise exception 'unknown address reported';
  end if;
  -- Never a linking answer: the confirmed lookup still ignores it.
  if public.confirmed_user_id_by_email('unconfirmed.w10sec@example.test') is not null then
    raise exception 'unconfirmed signup returned by the confirmed lookup';
  end if;
end $$;

-- Clients cannot call it.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
begin
  perform public.auth_email_registered('unconfirmed.w10sec@example.test');
  raise exception 'authenticated may probe addresses';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$
begin
  perform public.auth_email_registered('unconfirmed.w10sec@example.test');
  raise exception 'anon may probe addresses';
exception when insufficient_privilege then null;
end $$;

rollback;
