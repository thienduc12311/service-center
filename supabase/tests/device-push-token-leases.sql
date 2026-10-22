-- Run against a reset local database with a supported Supabase SQL command.
begin;

insert into public.device_push_tokens (
  user_id,
  token,
  platform,
  last_seen_at,
  lease_expires_at,
  revocation_secret_hash
)
values
  (
    '33333333-3333-4333-8333-333333333333',
    'ExponentPushToken[lease-active-test]',
    'ios',
    now(),
    now() + interval '30 days',
    repeat('a', 64)
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'ExponentPushToken[lease-expired-test]',
    'ios',
    now() - interval '31 days',
    now() - interval '1 day',
    repeat('b', 64)
  );

do $$
begin
  if exists (
    select 1
    from public.device_push_tokens
    where token = 'ExponentPushToken[lease-expired-test]'
      and lease_expires_at > now()
  ) then
    raise exception 'expired device lease remained eligible for delivery';
  end if;

  if not exists (
    select 1
    from public.device_push_tokens
    where token = 'ExponentPushToken[lease-active-test]'
      and lease_expires_at > now()
  ) then
    raise exception 'active device lease was excluded from delivery';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

delete from public.device_push_tokens
where token = 'ExponentPushToken[lease-active-test]';

reset role;

do $$
begin
  if exists (
    select 1 from public.device_push_tokens
    where token = 'ExponentPushToken[lease-active-test]'
  ) then
    raise exception 'authenticated device revocation did not exclude the token';
  end if;
end $$;

-- MOB-020: the badge choice defaults to on (older builds send nothing) and
-- another account can neither read nor change it.
insert into public.device_push_tokens (user_id, token, platform)
values ('33333333-3333-4333-8333-333333333333', 'ExponentPushToken[badge-default-test]', 'ios');

do $$
begin
  if not (select show_badge from public.device_push_tokens where token = 'ExponentPushToken[badge-default-test]') then
    raise exception 'a registration without a badge choice did not default to showing the badge';
  end if;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

do $$
declare
  v_changed int;
begin
  if exists (select 1 from public.device_push_tokens where token = 'ExponentPushToken[badge-default-test]') then
    raise exception 'another account could read a device badge choice';
  end if;
  update public.device_push_tokens set show_badge = false where token = 'ExponentPushToken[badge-default-test]';
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then
    raise exception 'another account changed a device badge choice';
  end if;
end $$;

reset role;

rollback;
