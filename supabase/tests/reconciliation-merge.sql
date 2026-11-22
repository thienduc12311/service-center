-- W10-MAIL-D4: an explicit identity merge returns its own report, which
-- survives as the record of the decision; open reports still go with their
-- candidate. Needs migration 20261201000010.
--   docker exec -i supabase_db_service-center psql -U postgres -v ON_ERROR_STOP=1 < supabase/tests/reconciliation-merge.sql
-- Everything runs inside one transaction and is rolled back.
--
-- Cast (seed): 1111 owner, 3333 Sam member (linked Person) in org aaaa…01.
begin;

create temporary table fx (k text primary key, id uuid) on commit drop;
grant select on fx to authenticated;
insert into fx values
  ('org',    'aaaaaaaa-0000-4000-8000-000000000001'),
  ('dup',    gen_random_uuid()),
  ('stray',  gen_random_uuid()),
  ('rec',    gen_random_uuid()),
  ('rec2',   gen_random_uuid());
insert into fx values ('sam', (select id from public.people
  where organization_id = (select id from fx where k = 'org') and profile_id = '33333333-3333-4333-8333-333333333333'));

insert into public.people (id, organization_id, first_name, last_name, email) values
  ((select id from fx where k = 'dup'),   (select id from fx where k = 'org'), 'Sam', 'Duplicate', 'sam.dup.w10@example.com'),
  ((select id from fx where k = 'stray'), (select id from fx where k = 'org'), 'Stray', 'Guest', 'stray.w10@example.com');
insert into public.person_tags (organization_id, person_id, tag)
values ((select id from fx where k = 'org'), (select id from fx where k = 'dup'), 'w10-merge-tag');
insert into public.person_identity_reconciliations (id, organization_id, profile_id, person_id, candidate_person_id, reason) values
  ((select id from fx where k = 'rec'),  (select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333',
   (select id from fx where k = 'sam'), (select id from fx where k = 'dup'), 'invitation_conflict'),
  ((select id from fx where k = 'rec2'), (select id from fx where k = 'org'), '33333333-3333-4333-8333-333333333333',
   (select id from fx where k = 'sam'), (select id from fx where k = 'stray'), 'email_match');

-- The owner merges: the function answers with the closed report.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare
  v_row public.person_identity_reconciliations;
begin
  v_row := public.resolve_person_reconciliation((select id from fx where k = 'rec'), 'merge');
  if v_row.id is distinct from (select id from fx where k = 'rec') then
    raise exception 'merge returned no report: %', row_to_json(v_row);
  end if;
  if v_row.status <> 'merged' or v_row.resolved_at is null
     or v_row.resolved_by <> '11111111-1111-4111-8111-111111111111'
     or v_row.person_id <> (select id from fx where k = 'sam') or v_row.candidate_person_id is not null then
    raise exception 'merge report not recorded: %', row_to_json(v_row);
  end if;
  -- Still readable by an administrator afterwards, and a repeat replays it.
  if not exists (select 1 from public.person_identity_reconciliations
                  where id = (select id from fx where k = 'rec') and status = 'merged') then
    raise exception 'merged report not kept';
  end if;
  if (public.resolve_person_reconciliation((select id from fx where k = 'rec'), 'merge')).status <> 'merged' then
    raise exception 'repeat merge did not replay the report';
  end if;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.people where id = (select id from fx where k = 'dup')) then
    raise exception 'candidate not removed by the merge';
  end if;
  if not exists (select 1 from public.person_tags
                  where person_id = (select id from fx where k = 'sam') and tag = 'w10-merge-tag') then
    raise exception 'tag not moved to the kept Person';
  end if;
end $$;

-- Deleting a Person drops its OPEN reports (as before) ...
do $$
begin
  delete from public.people where id = (select id from fx where k = 'stray');
  if exists (select 1 from public.person_identity_reconciliations where id = (select id from fx where k = 'rec2')) then
    raise exception 'open report outlived its candidate';
  end if;
end $$;

-- ... and an open report cannot exist without a candidate.
do $$
begin
  update public.person_identity_reconciliations
     set status = 'open', resolved_at = null, resolved_by = null
   where id = (select id from fx where k = 'rec');
  raise exception 'open report without a candidate accepted';
exception when check_violation then null;
end $$;

rollback;
