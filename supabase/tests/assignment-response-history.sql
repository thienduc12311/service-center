-- Run against a seeded local database, e.g.:
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/assignment-response-history.sql
-- Everything runs inside one transaction and is rolled back.
begin;

-- One of Sam's (member) assignments, reset to a fresh request so the test
-- never depends on which seeded rows happen to be confirmed.
create temporary table fixture on commit drop as
select a.id as assignment_id
from public.assignments a
where a.user_id = '33333333-3333-4333-8333-333333333333'
limit 1;

update public.assignments set status = 'unconfirmed', responded_at = null
where id = (select assignment_id from fixture);
delete from public.assignment_responses where assignment_id = (select assignment_id from fixture);

grant select on fixture to authenticated, service_role;

-- ------------------------------------------------ the assignee answers -----
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';

-- Stale: Sam thinks it is confirmed, but it is still unconfirmed.
do $$
begin
  if exists (select 1 from public.respond_to_own_assignment(
      (select assignment_id from fixture), 'declined', 'confirmed', null)) then
    raise exception 'a stale expected status still changed the answer';
  end if;
end $$;

select 1 from public.respond_to_own_assignment((select assignment_id from fixture), 'confirmed', 'unconfirmed');

-- Deliberate withdrawal from the confirmation, with a reason.
select 1 from public.respond_to_own_assignment(
  (select assignment_id from fixture), 'declined', 'confirmed', 'Travelling that weekend');

do $$
begin
  if (select count(*) from public.assignment_responses
      where assignment_id = (select assignment_id from fixture)) <> 2 then
    raise exception 'expected two history rows (confirm, withdraw)';
  end if;
  if not exists (
    select 1 from public.assignment_responses
    where assignment_id = (select assignment_id from fixture)
      and previous_status = 'unconfirmed' and status = 'confirmed' and response_note is null
  ) then
    raise exception 'confirmation was not recorded';
  end if;
  if not exists (
    select 1 from public.assignment_responses
    where assignment_id = (select assignment_id from fixture)
      and previous_status = 'confirmed' and status = 'declined'
      and response_note = 'Travelling that weekend'
      and actor_id = '33333333-3333-4333-8333-333333333333'
  ) then
    raise exception 'withdrawal was not recorded with its reason and actor';
  end if;
  -- The reason setting does not outlive the call that set it.
  if nullif(current_setting('app.assignment_response_note', true), '') is not null then
    raise exception 'response note leaked into the rest of the transaction';
  end if;
end $$;

-- What the assignee may not do, through the function or the table.
do $$
begin
  begin
    perform public.respond_to_own_assignment((select assignment_id from fixture), 'confirmed', 'declined');
    raise exception 'assignee re-accepted a declined assignment through the function';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    update public.assignments set status = 'confirmed'
    where id = (select assignment_id from fixture);
    raise exception 'assignee re-accepted a declined assignment directly';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    update public.assignments set status = 'unconfirmed'
    where id = (select assignment_id from fixture);
    raise exception 'assignee reset a declined assignment to unconfirmed';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    update public.assignments set team_id = 'cccccccc-0000-4000-8000-000000000002'
    where id = (select assignment_id from fixture);
    raise exception 'assignee moved their own assignment to another team';
  exception when sqlstate '42501' then null;
  end;

  begin
    update public.assignments set notes = 'self-authored scheduler note'
    where id = (select assignment_id from fixture);
    raise exception 'assignee overwrote the scheduler note';
  exception when sqlstate '42501' then null;
  end;

  begin
    perform public.respond_to_own_assignment((select assignment_id from fixture), 'declined', 'declined', repeat('x', 501));
    raise exception 'an over-long reason was accepted';
  exception when sqlstate '22001' then null;
  end;

  begin
    insert into public.assignment_responses
      (organization_id, assignment_id, assignee_id, previous_status, status)
    values ('aaaaaaaa-0000-4000-8000-000000000001', (select assignment_id from fixture),
            '33333333-3333-4333-8333-333333333333', 'declined', 'confirmed');
    raise exception 'assignee forged a history row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- --------------------------------------- another member sees nothing -------
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

do $$
begin
  if exists (select 1 from public.assignment_responses
             where assignment_id = (select assignment_id from fixture)) then
    raise exception 'another member could read Sam''s decline reason';
  end if;
  -- Nor can they answer Sam's assignment through the function.
  if exists (select 1 from public.respond_to_own_assignment(
      (select assignment_id from fixture), 'declined', 'declined', null)) then
    raise exception 'another member answered Sam''s assignment';
  end if;
end $$;

-- ------------------------------------------- the scheduler re-requests -----
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

do $$
begin
  if (select count(*) from public.assignment_responses
      where assignment_id = (select assignment_id from fixture)) <> 2 then
    raise exception 'scheduler could not read response history';
  end if;
end $$;

update public.assignments set status = 'unconfirmed', responded_at = null
where id = (select assignment_id from fixture);

do $$
begin
  if not exists (
    select 1 from public.assignment_responses
    where assignment_id = (select assignment_id from fixture)
      and previous_status = 'declined' and status = 'unconfirmed'
      and actor_id = '22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'scheduler re-request was not recorded';
  end if;
end $$;

-- --------------------------- the respond-link path has no user either -------
reset role;
update public.assignments set status = 'declined'
where id = (select assignment_id from fixture);

set local role service_role;
set local request.jwt.claim.sub = '';
do $$
begin
  begin
    update public.assignments set status = 'confirmed'
    where id = (select assignment_id from fixture);
    raise exception 'service-role respond path re-accepted a declined assignment';
  exception when sqlstate 'PT409' then null;
  end;
end $$;

rollback;
