-- W8-INT-D2: a plan created directly as 'published' never emitted
-- plan.published (the trigger only fired on UPDATE OF status). Emit it on INSERT
-- too. Later status updates keep the old/new comparison, so no duplicates.
create or replace function private.plan_webhook_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type text;
  v_row  public.plans%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'published' then return null; end if;
    -- The organization itself is being deleted: nobody to tell.
    if not exists (select 1 from public.organizations where id = old.organization_id) then return null; end if;
    v_type := 'plan.deleted';
    v_row := old;
  elsif tg_op = 'INSERT' then
    if new.status <> 'published' then return null; end if;
    v_type := 'plan.published';
    v_row := new;
  elsif new.status = 'published' and old.status is distinct from 'published' then
    v_type := 'plan.published';
    v_row := new;
  elsif old.status = 'published' and new.status <> 'published' then
    v_type := 'plan.unpublished';
    v_row := new;
  else
    return null;
  end if;
  perform private.emit_webhook_event(
    v_row.organization_id,
    v_type,
    v_type || ':' || v_row.id || ':' || txid_current(),
    jsonb_build_object('plan_id', v_row.id, 'service_type_id', v_row.service_type_id));
  return null;
end;
$$;

drop trigger if exists plans_webhook_insert on public.plans;
create trigger plans_webhook_insert
  after insert on public.plans
  for each row when (new.status = 'published') execute function private.plan_webhook_events();
