-- W8-RES-D4 / W8-RT-D1: PATCH /plans/:id with `times` plus other fields did two
-- independent writes (times RPC, then a plain update). A failure of the second
-- left the times saved and the fields lost, and a retry with expected_revision
-- got 409. This RPC does both in ONE transaction (any failure rolls back both).
--
-- Precedence when `service_date` and `times` are both sent: TIMES WIN. The
-- plan_times statement-level trigger (w7f_plan_date_follows_times) keeps
-- plans.service_date equal to the earliest 'service' time, so a service_date in
-- p_fields is ignored whenever p_times contains a service-kind time. A time list
-- with no service time (rehearsals only) leaves the date alone, so the sent
-- service_date applies.
--
-- p_fields may only carry: title, service_type_id, service_date, location,
-- status, notes (a key present with JSON null sets NULL where the column allows).
-- Security invoker: RLS still decides the plan update; the nested
-- apply_plan_time_changes keeps its own permission and revision checks.
create or replace function public.update_plan_with_times(
  p_plan_id              uuid,
  p_fields               jsonb,
  p_times                jsonb default null,
  p_expected_revision    bigint default null,
  p_impact_hash          text default null,
  p_orphan_resolutions   jsonb default '[]',
  p_notify               boolean default true,
  p_effect_key           text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fields       jsonb := coalesce(p_fields, '{}'::jsonb);
  v_result       jsonb := '{}'::jsonb;
  v_has_service  boolean;
  v_updated      uuid;
begin
  if p_times is not null then
    v_result := public.apply_plan_time_changes(
      p_plan_id, p_times, p_expected_revision, p_impact_hash,
      coalesce(p_orphan_resolutions, '[]'::jsonb), coalesce(p_notify, true), p_effect_key);
    v_has_service := exists (
      select 1 from jsonb_array_elements(p_times) t
       where coalesce(t->>'kind', 'service') = 'service');
    if v_has_service then
      v_fields := v_fields - 'service_date';
    end if;
  end if;

  if v_fields <> '{}'::jsonb then
    update public.plans p
       set title           = case when v_fields ? 'title' then v_fields->>'title' else p.title end,
           service_type_id = case when v_fields ? 'service_type_id' then (v_fields->>'service_type_id')::uuid else p.service_type_id end,
           service_date    = case when v_fields ? 'service_date' then (v_fields->>'service_date')::timestamptz else p.service_date end,
           location        = case when v_fields ? 'location' then v_fields->>'location' else p.location end,
           status          = case when v_fields ? 'status' then (v_fields->>'status')::public.plan_status else p.status end,
           notes           = case when v_fields ? 'notes' then v_fields->>'notes' else p.notes end
     where p.id = p_plan_id
     returning p.id into v_updated;
    if v_updated is null then
      raise exception 'Plan not found' using errcode = 'P0002';
    end if;
  end if;
  return v_result;
end;
$$;
revoke execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text) from public, anon;
grant execute on function public.update_plan_with_times(uuid, jsonb, jsonb, bigint, text, jsonb, boolean, text) to authenticated;
