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

rollback;
