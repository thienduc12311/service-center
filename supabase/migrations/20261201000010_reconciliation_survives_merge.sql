-- W10-MAIL-D4: an explicit identity merge answers with its own report.
--
-- resolve_person_reconciliation (20261018000100) deleted the merged-away
-- Person before closing the report. candidate_person_id cascaded on delete,
-- so the report row went with the Person, the final
-- `update ... returning * into v_row` matched nothing, and the function
-- returned an all-null row: the API reported a committed merge as a 400 and
-- the record of the decision was lost.
--
-- Decided reports are now kept as the audit trail of who merged or kept two
-- records apart, and when:
--   * candidate_person_id becomes nullable with ON DELETE SET NULL, so a
--     decided report survives its candidate being removed (by a merge or a
--     later delete);
--   * an OPEN report still disappears with its candidate, as before: a
--     BEFORE DELETE trigger on people removes open reports naming the
--     deleted Person as candidate (person_id keeps its cascade), and a check
--     keeps every open report pointing at a candidate;
--   * the merge closes its report ('merged') before removing the candidate,
--     and returns that row.
-- RLS is unchanged: administrators read reports, nobody writes them directly.

alter table public.person_identity_reconciliations
  drop constraint person_identity_reconciliations_candidate_person_id_fkey;
alter table public.person_identity_reconciliations
  alter column candidate_person_id drop not null;
alter table public.person_identity_reconciliations
  add constraint person_identity_reconciliations_candidate_person_id_fkey
  foreign key (candidate_person_id) references public.people (id) on delete set null;
alter table public.person_identity_reconciliations
  add constraint person_identity_reconciliations_open_has_candidate
  check (status <> 'open' or candidate_person_id is not null);

comment on column public.person_identity_reconciliations.candidate_person_id is
  'The unlinked Person that may be the same human. Null once a decided report''s candidate was removed (for example merged away).';

-- Open reports about a removed Person are moot; decided ones stay as history.
create or replace function private.drop_open_reconciliations_for_person()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.person_identity_reconciliations
   where candidate_person_id = old.id and status = 'open';
  return old;
end;
$$;
revoke execute on function private.drop_open_reconciliations_for_person() from public, anon, authenticated;

create trigger people_drop_open_reconciliations
  before delete on public.people
  for each row execute function private.drop_open_reconciliations_for_person();

create or replace function public.resolve_person_reconciliation(p_id uuid, p_action text)
returns public.person_identity_reconciliations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.person_identity_reconciliations;
  v_keep  public.people;
  v_drop  public.people;
begin
  select * into v_row from public.person_identity_reconciliations where id = p_id for update;
  if not found or not public.is_org_admin(v_row.organization_id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'open' then
    return v_row;
  end if;
  if p_action not in ('keep_separate', 'merge') then
    raise exception 'Choose keep_separate or merge' using errcode = '22023';
  end if;

  if p_action = 'keep_separate' then
    update public.person_identity_reconciliations
       set status = 'kept_separate', resolved_by = (select auth.uid()), resolved_at = now()
     where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  select * into v_keep from public.people where id = v_row.person_id for update;
  select * into v_drop from public.people where id = v_row.candidate_person_id for update;
  if v_drop.profile_id is not null then
    raise exception 'Only a person without a login can be merged into another' using errcode = 'PT409';
  end if;
  if exists (
    select 1 from public.assignments a
      join public.assignments b on b.plan_id = a.plan_id and b.team_id = a.team_id
                               and b.position_id is not distinct from a.position_id
     where a.person_id = v_drop.id and b.person_id = v_keep.id) then
    raise exception 'Both records are on the same request; remove one first' using errcode = 'PT409';
  end if;

  -- Per-request records keyed by Person must not collide either.
  if exists (select 1 from public.assignment_request_snapshots a
               join public.assignment_request_snapshots b on b.effect_id = a.effect_id
              where a.person_id = v_drop.id and b.person_id = v_keep.id)
     or exists (select 1 from public.deliveries a
                  join public.deliveries b on b.effect_id = a.effect_id and b.channel = a.channel
                 where a.recipient_person_id = v_drop.id and b.recipient_person_id = v_keep.id)
     or exists (select 1 from public.assignment_notifications a
                  join public.assignment_notifications b on b.plan_id = a.plan_id
                 where a.person_id = v_drop.id and b.person_id = v_keep.id
                   and a.responded_at is null and b.responded_at is null) then
    raise exception 'Both records have requests in flight for the same plan; wait for them to be answered'
      using errcode = 'PT409';
  end if;

  update public.assignments set person_id = v_keep.id, user_id = v_keep.profile_id where person_id = v_drop.id;
  update public.assignment_responses set assignee_person_id = v_keep.id, assignee_id = v_keep.profile_id
   where assignee_person_id = v_drop.id;
  update public.assignment_time_response_history set assignee_person_id = v_keep.id
   where assignee_person_id = v_drop.id;
  delete from public.team_memberships tm
   where tm.person_id = v_drop.id
     and exists (select 1 from public.team_memberships k
                  where k.person_id = v_keep.id and k.team_id = tm.team_id
                    and k.position_id is not distinct from tm.position_id);
  update public.team_memberships set person_id = v_keep.id, user_id = v_keep.profile_id where person_id = v_drop.id;
  insert into public.person_tags (organization_id, person_id, tag, created_by)
  select organization_id, v_keep.id, tag, created_by from public.person_tags where person_id = v_drop.id
  on conflict do nothing;
  -- Outstanding respond links keep working for the requests they named.
  update public.assignment_notifications set person_id = v_keep.id, user_id = v_keep.profile_id
   where person_id = v_drop.id;
  update public.assignment_request_snapshots set person_id = v_keep.id where person_id = v_drop.id;
  update public.assignment_response_operations set person_id = v_keep.id where person_id = v_drop.id
     and not exists (select 1 from public.assignment_response_operations k
                      where k.person_id = v_keep.id and k.idempotency_key = assignment_response_operations.idempotency_key);
  update public.deliveries set recipient_person_id = v_keep.id where recipient_person_id = v_drop.id;
  update public.delivery_effects set responder_person_id = v_keep.id where responder_person_id = v_drop.id;
  update public.person_identity_reconciliations
     set status = 'kept_separate', resolved_by = (select auth.uid()), resolved_at = now()
   where id <> v_row.id and status = 'open'
     and (person_id = v_drop.id or candidate_person_id = v_drop.id);

  -- Close this report before the candidate goes, so it survives as the record
  -- of the merge (its candidate_person_id is then set to null).
  update public.person_identity_reconciliations
     set status = 'merged', resolved_by = (select auth.uid()), resolved_at = now()
   where id = v_row.id;
  delete from public.people where id = v_drop.id;

  select * into v_row from public.person_identity_reconciliations where id = v_row.id;
  return v_row;
end;
$$;
revoke execute on function public.resolve_person_reconciliation(uuid, text) from public, anon;
grant execute on function public.resolve_person_reconciliation(uuid, text) to authenticated;
