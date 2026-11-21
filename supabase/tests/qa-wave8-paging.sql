-- QA wave 8 paging regression suite.
--   W8-PERF-D3 (P1)  public.my_conversations stopped at 100 rows; the keyset
--                    variant my_conversations_page must reach every
--                    conversation exactly once, in the same order, including
--                    ties on last_message_at and created_at.
-- Run with the migration loaded, against a seeded local database. Rolls back.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/qa-wave8-paging.sql
-- (apply supabase/migrations/20261127000100_w8_conversations_keyset.sql first, e.g. inside the same transaction)
begin;

-- 130 plans, each with a conversation. All rows share one transaction
-- timestamp, so created_at ties; every third conversation gets messages that
-- also share one timestamp (a last_message_at tie), the rest have none.
create temporary table w8_plan_ids (n int primary key, plan_id uuid not null, conversation_id uuid not null) on commit drop;
insert into w8_plan_ids select g, gen_random_uuid(), gen_random_uuid() from generate_series(1, 130) g;

insert into public.plans (id, organization_id, title, service_date, status)
select plan_id, 'aaaaaaaa-0000-4000-8000-000000000001', 'W8 paging plan ' || n, now() + (n || ' days')::interval, 'draft'
  from w8_plan_ids;
insert into public.conversations (id, organization_id, kind, plan_id, created_by)
select conversation_id, 'aaaaaaaa-0000-4000-8000-000000000001', 'plan', plan_id, '11111111-1111-4111-8111-111111111111'
  from w8_plan_ids;
insert into public.conversation_messages (id, organization_id, conversation_id, author_id, body, created_at)
select gen_random_uuid(), 'aaaaaaaa-0000-4000-8000-000000000001', conversation_id, '11111111-1111-4111-8111-111111111111',
       'w8 hello', case when n % 6 = 0 then now() - interval '1 hour' else now() - interval '2 hours' end
  from w8_plan_ids where n % 3 = 0;
grant select on w8_plan_ids to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- The legacy function is capped at 100 (the defect).
do $$ declare v int; begin
  select count(*) into v from public.my_conversations('aaaaaaaa-0000-4000-8000-000000000001');
  if v <> 100 then raise exception 'legacy my_conversations expected 100 rows, got %', v; end if;
end $$;

-- Walk the paged variant with page size 37 and compare against the full set.
do $$
declare
  v_org uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_total int;
  v_seen uuid[] := '{}';
  v_page record;
  v_n int;
  v_after_last timestamptz;
  v_after_created timestamptz;
  v_after_id uuid;
  v_prev_last timestamptz;
  v_prev_created timestamptz;
  v_prev_id uuid;
  v_has_prev boolean := false;
  v_pages int := 0;
begin
  select count(*) into v_total from public.conversations where organization_id = v_org
     and private.can_access_conversation('11111111-1111-4111-8111-111111111111', id);
  if v_total < 130 then raise exception 'fixture: expected at least 130 reachable conversations, got %', v_total; end if;

  loop
    v_n := 0;
    for v_page in
      select * from public.my_conversations_page(v_org, 37, v_after_last, v_after_created, v_after_id)
    loop
      v_n := v_n + 1;
      if v_page.id = any (v_seen) then raise exception 'duplicate conversation % across pages', v_page.id; end if;
      v_seen := v_seen || v_page.id;
      if v_has_prev and not (
        (coalesce(v_page.last_message_at, '-infinity'), v_page.created_at, v_page.id)
        < (coalesce(v_prev_last, '-infinity'), v_prev_created, v_prev_id)) then
        raise exception 'order is not strictly descending at %', v_page.id;
      end if;
      v_has_prev := true;
      v_prev_last := v_page.last_message_at; v_prev_created := v_page.created_at; v_prev_id := v_page.id;
      v_after_last := coalesce(v_page.last_message_at, '-infinity'); v_after_created := v_page.created_at; v_after_id := v_page.id;
    end loop;
    v_pages := v_pages + 1;
    exit when v_n < 37;
    if v_pages > 20 then raise exception 'paging did not terminate'; end if;
  end loop;

  if cardinality(v_seen) <> v_total then
    raise exception 'paging lost conversations: saw % of %', cardinality(v_seen), v_total;
  end if;
end $$;

-- A caller outside the organization sees nothing, and anon cannot call it.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$ declare v int; begin
  select count(*) into v from public.my_conversations_page('aaaaaaaa-0000-4000-8000-000000000001', 50);
  if v <> 0 then raise exception 'outsider saw % conversations', v; end if;
end $$;

reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.my_conversations_page('aaaaaaaa-0000-4000-8000-000000000001', 5);
    raise exception 'anon could call my_conversations_page';
  exception when insufficient_privilege then null;
  end;
end $$;

-- People list paging: sort_name is the generated, granted, indexed keyset column
-- (needs supabase/migrations/20261127000200_w8_people_sort_name.sql loaded first).
reset role;
do $$
declare v int;
begin
  if not has_column_privilege('authenticated', 'public.people', 'sort_name', 'select') then
    raise exception 'authenticated cannot select people.sort_name';
  end if;
  if has_table_privilege('authenticated', 'public.people_directory', 'insert')
     or has_table_privilege('authenticated', 'public.people_directory', 'update')
     or has_table_privilege('authenticated', 'public.people_directory', 'delete') then
    raise exception 'people_directory became writable';
  end if;
  select count(*) into v from public.people
   where sort_name is distinct from lower(btrim(first_name || ' ' || coalesce(last_name, '')));
  if v <> 0 then raise exception 'sort_name drifted on % rows', v; end if;
  -- the directory view is RLS-filtered by auth.uid(); as postgres it may see 0 rows but must expose the column
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'people_directory' and column_name = 'sort_name') then
    raise exception 'people_directory lacks sort_name';
  end if;
end $$;

rollback;
