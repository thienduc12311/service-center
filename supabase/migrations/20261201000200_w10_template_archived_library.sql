-- W10-CD-D4: template preview and apply agree on archived library content.
--
-- private.plan_template_preview is the single source for apply-preview,
-- apply (which re-runs it and compares the hash) and series generation.
-- Before this, an item whose song was archived passed the preview cleanly and
-- the commit then hit plan_items_active_song ("Restore the song before
-- scheduling it", 400). Now:
--   * an item whose song is archived is listed in items.skipped with reason
--     'song_archived' and is not added (same shape as 'song_missing');
--   * an item pinned to an archived arrangement keeps the song default (an
--     archived arrangement is never the default) and the preview warns with
--     code 'arrangement_archived' {count}, like 'arrangement_missing'.
-- Body otherwise identical to 20261104000100_i18n_structured_notices.sql;
-- create or replace keeps the existing grants.

create or replace function private.plan_template_preview(
  p_org          uuid,
  p_service_type uuid,
  p_plan         uuid,
  p_anchor       date,
  p_revision_id  uuid,
  p_mode         text,
  p_components   text[],
  p_times        jsonb,
  p_insert_at    int
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_rev       public.plan_template_revisions;
  v_tpl       public.plan_templates;
  v_tz        text;
  v_content   jsonb;
  v_plan      public.plans;
  v_out       jsonb;
  v_blocking  jsonb := '[]'::jsonb;
  v_warnings  jsonb := '[]'::jsonb;
  v_el        jsonb;
  v_given     jsonb;
  v_i         bigint;
  v_add       jsonb;
  v_skipped   jsonb;
  v_kept      jsonb;
  v_existing  int;
  v_count     int;
  v_missing   int;
  v_arr_archived int;
  v_title     text;
  v_arr       uuid;
  v_team      uuid;
  v_pos       uuid;
  v_notes     text;
  v_template_notes text;
  v_assigned  int := 0;
  v_expected  timestamp;
  v_start     timestamptz;
  v_end       timestamptz;
begin
  if p_mode is null or p_mode not in ('append', 'replace') then
    perform private.f10_bad('Choose append or replace');
  end if;
  if p_components is null or cardinality(p_components) = 0
     or not (p_components <@ array['times', 'notes', 'items', 'needs', 'roster']) then
    perform private.f10_bad('Choose at least one part of the template');
  end if;
  if not private.capability_for(v_uid, p_org, 'plans.edit', p_service_type, null) then
    raise exception 'Only a plan editor can apply templates here' using errcode = '42501';
  end if;

  select * into v_rev from public.plan_template_revisions where id = p_revision_id;
  if not found then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  select * into v_tpl from public.plan_templates where id = v_rev.template_id;
  if not found or v_tpl.organization_id <> p_org then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;
  if v_tpl.archived_at is not null then
    perform private.f10_bad('Restore this template before applying it');
  end if;
  if v_tpl.kind = 'section' and p_components <> array['items'] then
    perform private.f10_bad('A section template applies order items only');
  end if;
  if v_tpl.service_type_id is not null and v_tpl.service_type_id is distinct from p_service_type then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'other_service_type', 'message', 'This template belongs to a different service type.'));
  end if;
  if v_rev.revision <> v_tpl.current_revision then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'older_revision', 'params', jsonb_build_object('revision', v_rev.revision, 'latest', v_tpl.current_revision), 'message', format('Revision %s is not the latest (%s).', v_rev.revision, v_tpl.current_revision)));
  end if;

  v_content := v_rev.content;
  select timezone into v_tz from public.organizations where id = p_org;
  if p_plan is not null then
    select * into v_plan from public.plans where id = p_plan;
    select count(*) into v_assigned from public.assignments where plan_id = p_plan;
  end if;

  v_out := jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_tpl.id, 'name', v_tpl.name, 'kind', v_tpl.kind,
      'revision', v_rev.revision, 'revision_id', v_rev.id, 'latest_revision', v_tpl.current_revision),
    'plan_id', p_plan,
    'destination_revision', v_plan.content_revision,
    'anchor_date', p_anchor,
    'timezone', v_tz,
    'mode', p_mode,
    'components', to_jsonb(p_components)
  );

  -- ------------------------------------------------------------ items
  if 'items' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_missing := 0; v_arr_archived := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'items') loop
      v_title := v_el ->> 'title';
      if (v_el ->> 'song_id') is not null and not exists (
        select 1 from public.songs s where s.id = (v_el ->> 'song_id')::uuid and s.organization_id = p_org
      ) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('title', v_title, 'reason', 'song_missing'));
        continue;
      end if;
      -- W10-CD-D4: an archived song cannot be scheduled (plan_items_active_song),
      -- so the preview reports it skipped and the commit skips it the same way.
      if (v_el ->> 'song_id') is not null and exists (
        select 1 from public.songs s where s.id = (v_el ->> 'song_id')::uuid and s.archived_at is not null
      ) then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('title', v_title, 'reason', 'song_archived'));
        continue;
      end if;
      v_arr := (v_el ->> 'arrangement_id')::uuid;
      if v_arr is not null and not exists (select 1 from public.arrangements a where a.id = v_arr) then
        v_arr := null;
        v_missing := v_missing + 1;
      elsif v_arr is not null and exists (
        select 1 from public.arrangements a where a.id = v_arr and a.archived_at is not null
      ) then
        -- An archived arrangement is never the default, so the song default stands in.
        v_arr := null;
        v_arr_archived := v_arr_archived + 1;
      end if;
      v_add := v_add || jsonb_build_array(v_el || jsonb_build_object('arrangement_id', v_arr));
    end loop;
    if v_missing > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'arrangement_missing', 'params', jsonb_build_object('count', v_missing),
        'message', format('%s item(s) use an arrangement that no longer exists; they keep the song default.', v_missing)));
    end if;
    if v_arr_archived > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'arrangement_archived', 'params', jsonb_build_object('count', v_arr_archived),
        'message', format('%s item(s) use an archived arrangement; they keep the song default.', v_arr_archived)));
    end if;
    select count(*) into v_existing from public.plan_items where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 then
      select count(distinct x.plan_item_id) into v_count from (
        select c.plan_item_id from public.plan_item_comments c where c.plan_id = p_plan
        union all
        select n.plan_item_id from public.plan_notes n where n.plan_id = p_plan and n.plan_item_id is not null
      ) x;
      if v_count > 0 then
        v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'item_discussion_removed', 'params', jsonb_build_object('count', v_count, 'scope', 'current'),
          'message', format('%s current item(s) have notes or comments that are removed with them.', v_count)));
      end if;
    end if;
    if p_insert_at is not null and (p_mode = 'replace' or p_insert_at < 0 or p_insert_at > v_existing) then
      perform private.f10_bad('Choose a place inside the current order');
    end if;
    v_out := v_out || jsonb_build_object('items', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end,
      'existing_count', v_existing,
      'insert_at', case when p_mode = 'replace' then 0 else coalesce(p_insert_at, v_existing) end));
  end if;

  -- ------------------------------------------------------------ times
  if 'times' = any(p_components) then
    v_given := coalesce(p_times, '[]'::jsonb);
    if jsonb_typeof(v_given) <> 'array' or jsonb_array_length(v_given) <> jsonb_array_length(v_content -> 'times') then
      perform private.f10_bad('Preview the template times again');
    end if;
    v_add := '[]'::jsonb;
    for v_el, v_i in select value, ordinality from jsonb_array_elements(v_content -> 'times') with ordinality loop
      begin
        v_start := (v_given -> (v_i::int - 1) ->> 'starts_at')::timestamptz;
        v_end := (v_given -> (v_i::int - 1) ->> 'ends_at')::timestamptz;
      exception when others then
        perform private.f10_bad('Preview the template times again');
      end;
      -- The resolved instant must show the template's wall-clock time on the
      -- intended local date; either side of a DST fold is accepted, a
      -- skipped (spring-forward) time never matches.
      v_expected := (p_anchor + (v_el ->> 'day_offset')::int) + (v_el ->> 'local_start')::time;
      if v_start is null or v_end is null or (v_start at time zone v_tz) <> v_expected
         or v_end - v_start <> make_interval(mins => (v_el ->> 'duration_minutes')::int) then
        perform private.f10_bad('Preview the template times again');
      end if;
      v_add := v_add || jsonb_build_array(jsonb_build_object(
        'kind', v_el ->> 'kind', 'name', v_el -> 'name', 'starts_at', v_start, 'ends_at', v_end,
        'local_date', (p_anchor + (v_el ->> 'day_offset')::int), 'local_start', v_el ->> 'local_start'));
    end loop;
    select count(*) into v_existing from public.plan_times where plan_id = p_plan;
    if p_mode = 'replace' and v_existing > 0 and v_assigned > 0 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'times_in_use',
        'message', 'People are scheduled on this plan. Change its times in the plan''s time editor so they are asked again, or append.'));
    elsif p_mode = 'append' and v_existing > 0 and jsonb_array_length(v_add) > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'times_added', 'params', jsonb_build_object('count', v_existing),
        'message', format('The plan keeps its %s time(s); the template''s are added.', v_existing)));
    end if;
    v_out := v_out || jsonb_build_object('times', jsonb_build_object(
      'add', v_add, 'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ------------------------------------------------------------ notes
  if 'notes' = any(p_components) then
    v_template_notes := v_content ->> 'notes';
    v_notes := nullif(btrim(v_plan.notes), '');
    v_out := v_out || jsonb_build_object('notes', case
      when v_template_notes is null then jsonb_build_object('action', 'none', 'value', v_notes)
      when p_mode = 'replace' or v_notes is null then jsonb_build_object('action', 'set', 'value', v_template_notes)
      else jsonb_build_object('action', 'append', 'value', v_notes || E'\n\n' || v_template_notes)
    end);
    if (v_out #>> '{notes,action}') = 'append' and char_length(v_out #>> '{notes,value}') > 8000 then
      v_blocking := v_blocking || jsonb_build_array(jsonb_build_object('code', 'notes_too_long',
        'message', 'The combined notes would be longer than 8000 characters. Replace them instead.'));
    end if;
  end if;

  -- ------------------------------------------------------------ needs
  if 'needs' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_kept := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_content -> 'needs') loop
      v_pos := (v_el ->> 'position_id')::uuid;
      select tp.team_id into v_team
        from public.team_positions tp join public.teams t on t.id = tp.team_id
       where tp.id = v_pos and tp.plan_id is null and t.organization_id = p_org;
      if v_team is null then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'reason', 'position_missing'));
        continue;
      end if;
      select n.needed into v_count from public.plan_position_needs n where n.plan_id = p_plan and n.position_id = v_pos;
      if p_mode = 'append' and found then
        v_kept := v_kept || jsonb_build_array(jsonb_build_object(
          'position_id', v_pos, 'needed', v_count, 'template_needed', (v_el ->> 'needed')::int));
      else
        v_add := v_add || jsonb_build_array(jsonb_build_object('position_id', v_pos, 'needed', (v_el ->> 'needed')::int));
      end if;
    end loop;
    select count(*) into v_existing from public.plan_position_needs where plan_id = p_plan;
    v_out := v_out || jsonb_build_object('needs', jsonb_build_object(
      'add', v_add, 'kept', v_kept, 'skipped', v_skipped,
      'remove_count', case when p_mode = 'replace' then v_existing else 0 end));
  end if;

  -- ----------------------------------------------------------- roster
  if 'roster' = any(p_components) then
    v_add := '[]'::jsonb; v_skipped := '[]'::jsonb; v_existing := 0;
    for v_el in select value from jsonb_array_elements(v_content -> 'roster') loop
      v_team := (v_el ->> 'team_id')::uuid;
      v_pos := (v_el ->> 'position_id')::uuid;
      if not exists (
        select 1 from public.people p
         where p.id = (v_el ->> 'person_id')::uuid and p.organization_id = p_org and p.archived_at is null
      ) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'person_unavailable'));
      elsif not exists (select 1 from public.teams t where t.id = v_team and t.organization_id = p_org)
         or (v_pos is not null and not exists (
           select 1 from public.team_positions tp where tp.id = v_pos and tp.team_id = v_team and tp.plan_id is null)) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'position_missing'));
      elsif not private.capability_for(v_uid, p_org, 'scheduling.manage', p_service_type, v_team) then
        v_skipped := v_skipped || jsonb_build_array(v_el || jsonb_build_object('reason', 'not_permitted'));
      elsif exists (
        select 1 from public.assignments a
         where a.plan_id = p_plan and a.person_id = (v_el ->> 'person_id')::uuid
           and a.team_id = v_team and a.position_id is not distinct from v_pos
      ) then
        v_existing := v_existing + 1;
      else
        v_add := v_add || jsonb_build_array(v_el);
      end if;
    end loop;
    if p_mode = 'replace' then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'roster_appended',
        'message', 'Scheduled people are never removed by a template; roster entries are added as prepared requests.'));
    end if;
    v_out := v_out || jsonb_build_object('roster', jsonb_build_object(
      'add', v_add, 'skipped', v_skipped, 'existing_count', v_existing));
  end if;

  if p_plan is not null then
    select count(*) into v_count from public.plan_template_applications a
     where a.plan_id = p_plan and a.template_id = v_tpl.id;
    if v_count > 0 then
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object('code', 'already_applied', 'params', jsonb_build_object('count', v_count),
        'message', format('This template was already applied to this plan %s time(s). Applying again adds its content again.', v_count)));
    end if;
  end if;

  return v_out || jsonb_build_object('blocking', v_blocking, 'warnings', v_warnings);
end;
$$;
