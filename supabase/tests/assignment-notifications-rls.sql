-- Run with: npx supabase db query --local --file supabase/tests/assignment-notifications-rls.sql
begin;

insert into public.calendar_feed_tokens (organization_id, user_id, token_hash)
values (
  'aaaaaaaa-0000-4000-8000-000000000001',
  '44444444-4444-4444-8444-444444444444',
  'assignment-notifications-rls-test-token'
);

set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

do $$
begin
  if exists (
    select 1 from public.calendar_feed_tokens
    where user_id = '44444444-4444-4444-8444-444444444444'
  ) then
    raise exception 'RLS exposed another member calendar feed token';
  end if;
end $$;

rollback;
