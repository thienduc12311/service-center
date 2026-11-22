-- Copy a service type with what the copy form chose: name, description,
-- frequency, folder and exactly which teams also serve the copy.
--
-- copy_service_type() (20261017000200) copies the source's settings as they
-- are and all or none of its teams. It is left in place, unchanged, for
-- existing callers. Neither function copies people, access grants, plans,
-- plan templates or default files.
--
-- Access is the caller's own (security invoker):
--   * the insert into service_types needs organization-wide plans.edit
--     (policy service_types_insert);
--   * the team rows need plans.edit on the new service type
--     (policy service_type_teams_write), which the same grant covers;
--   * putting the copy in a folder other than the source's places it under
--     that folder's grants, so it is administrator-only, like moving a
--     service type between folders (private.guard_service_type_folder).
create or replace function public.copy_service_type_as(
  p_service_type  uuid,
  p_name          text,
  p_description   text,
  p_recurrence    public.plan_recurrence,
  p_folder        uuid,
  p_team_ids      uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source public.service_types;
  v_teams  uuid[] := coalesce(p_team_ids, '{}');
  v_id     uuid;
begin
  select * into v_source from public.service_types where id = p_service_type;
  if not found then
    raise exception 'Service type not found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Name the copy' using errcode = '22023';
  end if;

  if p_folder is distinct from v_source.folder_id then
    if not public.is_org_admin(v_source.organization_id) then
      raise exception 'Only an administrator can put the copy in another folder' using errcode = '42501';
    end if;
    if p_folder is not null and not exists (
      select 1 from public.service_type_folders f
       where f.id = p_folder and f.organization_id = v_source.organization_id and f.archived_at is null
    ) then
      raise exception 'Choose a folder in this organization' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1 from unnest(v_teams) chosen(id)
     where not exists (
       select 1 from public.teams t where t.id = chosen.id and t.organization_id = v_source.organization_id
     )
  ) then
    raise exception 'A chosen team is not in this organization' using errcode = '22023';
  end if;

  insert into public.service_types (organization_id, name, description, recurrence, sort_order, folder_id)
  values (v_source.organization_id, btrim(p_name), nullif(btrim(p_description), ''),
          coalesce(p_recurrence, v_source.recurrence), v_source.sort_order, p_folder)
  returning id into v_id;

  insert into public.service_type_teams (service_type_id, team_id, organization_id)
  select distinct v_id, chosen.id, v_source.organization_id
    from unnest(v_teams) chosen(id)
  on conflict do nothing;

  return v_id;
end;
$$;

revoke execute on function public.copy_service_type_as(uuid, text, text, public.plan_recurrence, uuid, uuid[]) from public, anon;
grant execute on function public.copy_service_type_as(uuid, text, text, public.plan_recurrence, uuid, uuid[]) to authenticated;

comment on function public.copy_service_type_as(uuid, text, text, public.plan_recurrence, uuid, uuid[]) is
  'Copy a service type with a chosen name, description, frequency, folder (another folder is admin-only) and serving teams. Never copies people, grants, plans, templates or files.';
