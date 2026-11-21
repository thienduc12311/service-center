-- Review follow-ups for PR #120 (QA wave 7 follow-ups).
--
-- 1. Plan date backfill. 20261126000100 keeps plans.service_date on the earliest
--    service time from now on, but only when plan_times is written. Plans that
--    already drifted (W7-NAT-D2) stayed wrong, and copy_plan_children's
--    matching branch compares `starts_at - service_date` between source and
--    target, so a stale source dropped 'selected' attendance times.
--
-- 2. Notification excerpts. 20261126000001 nulls excerpts when a message is
--    deleted or hidden, but only on rows that already exist. The delivery
--    worker checks the message, awaits several lookups, then inserts, so a
--    delete, hide or edit in that window left a fresh excerpt behind. Edits were
--    never covered at all. Rule now enforced in the database: a conversation
--    notification's excerpt must be a prefix of the message's current,
--    visible text, otherwise it is null.
--      * BEFORE INSERT on notifications checks it, holding a FOR SHARE lock
--        on the message so a concurrent edit/delete/hide waits for the insert
--        to commit and then redacts it (or the insert sees the change).
--      * The conversation_messages trigger now also fires on body edits and
--        nulls excerpts that no longer match.
--
-- 3. Copy without People visibility. plan_active_people required edit or
--    schedule rights on the SOURCE plan, but create/duplicate/import gate on
--    the target and save_plan_template on the template's service type, so a
--    caller scoped to another service type still lost leaders and roster. It
--    is now SECURITY INVOKER: the candidate ids are read under the caller's
--    own RLS (whatever they can read on the source, they can copy), and only
--    the archived check runs as definer, gated on active org membership. It
--    reveals only whether a person id the caller already sees referenced on
--    the plan is still active.
--
-- 4. Template roster calls plan_active_people once, not once per assignment.

-- 1 --------------------------------------------------------------------------
update public.plans p
   set service_date = e.first_service
  from (
    select pt.plan_id, min(pt.starts_at) as first_service
      from public.plan_times pt
     where pt.kind = 'service'
     group by pt.plan_id
  ) e
 where p.id = e.plan_id
   and p.service_date is distinct from e.first_service;

-- 2 --------------------------------------------------------------------------
-- True when `p_excerpt` (built by backend excerpt(): whitespace collapsed,
-- trimmed, cut short with a trailing '…') is still a prefix of `p_body`.
create or replace function private.excerpt_matches(p_excerpt text, p_body text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_body is not null
     and starts_with(
           btrim(regexp_replace(p_body, '\s+', ' ', 'g')),
           regexp_replace(p_excerpt, '…$', ''));
$$;
revoke execute on function private.excerpt_matches(text, text) from public, anon, authenticated;

create or replace function private.redact_message_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_removed boolean;
begin
  v_removed := tg_op = 'DELETE'
    or (new.deleted_at is not null and old.deleted_at is null)
    or (new.hidden_at is not null and old.hidden_at is null);
  if not v_removed and new.body is not distinct from old.body then
    return new;
  end if;
  update public.notifications n set body = null
   where n.conversation_id = old.conversation_id
     and n.body is not null
     and (v_removed or not private.excerpt_matches(n.body, new.body))
     and exists (
       select 1 from public.delivery_effects e
        where e.conversation_message_id = old.id
          and n.dedupe_key like e.id::text || ':%');
  return coalesce(new, old);
end;
$$;
revoke execute on function private.redact_message_notifications() from public, anon, authenticated;

drop trigger conversation_messages_redact_notifications on public.conversation_messages;
create trigger conversation_messages_redact_notifications
  after update of deleted_at, hidden_at, body on public.conversation_messages
  for each row execute function private.redact_message_notifications();

create or replace function private.guard_notification_excerpt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_effect_key text := split_part(new.dedupe_key, ':', 1);
  v_message public.conversation_messages;
begin
  if v_effect_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.body := null;
    return new;
  end if;
  select m.* into v_message
    from public.delivery_effects e
    join public.conversation_messages m on m.id = e.conversation_message_id
   where e.id = v_effect_key::uuid
     for share of m;
  if not found
     or v_message.deleted_at is not null
     or v_message.hidden_at is not null
     or not private.excerpt_matches(new.body, v_message.body) then
    new.body := null;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_notification_excerpt() from public, anon, authenticated;

create trigger notifications_guard_conversation_excerpt
  before insert on public.notifications
  for each row
  when (new.conversation_id is not null and new.body is not null)
  execute function private.guard_notification_excerpt();

-- Backfill: excerpts of messages edited since they were sent.
update public.notifications n set body = null
 where n.body is not null and n.conversation_id is not null
   and exists (
     select 1 from public.delivery_effects e
       join public.conversation_messages m on m.id = e.conversation_message_id
      where n.dedupe_key like e.id::text || ':%'
        and not private.excerpt_matches(n.body, m.body));

-- 3 --------------------------------------------------------------------------
create or replace function private.active_people_in_org(p_org uuid, p_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_org is null or (select auth.uid()) is null or not exists (
    select 1 from public.organization_members m
     where m.organization_id = p_org and m.user_id = (select auth.uid()) and m.status = 'active'
  ) then
    return '{}';
  end if;
  return coalesce((
    select array_agg(p.id)
      from public.people p
     where p.organization_id = p_org and p.archived_at is null
       and p.id = any (p_ids)
  ), '{}');
end;
$$;
revoke execute on function private.active_people_in_org(uuid, uuid[]) from public, anon;
grant execute on function private.active_people_in_org(uuid, uuid[]) to authenticated;

-- Same signature, so copy_plan_children and plan_template_content_from_plan
-- keep calling it unchanged. Invoker: reads below go through the caller's RLS.
create or replace function private.plan_active_people(p_plan uuid)
returns uuid[]
language sql
stable
security invoker
set search_path = ''
as $$
  select private.active_people_in_org(
    (select pl.organization_id from public.plans pl where pl.id = p_plan),
    array(
      select i.leader_person_id from public.plan_items i
       where i.plan_id = p_plan and i.leader_person_id is not null
      union
      select a.person_id from public.assignments a where a.plan_id = p_plan));
$$;
revoke execute on function private.plan_active_people(uuid) from public, anon;
grant execute on function private.plan_active_people(uuid) to authenticated;

-- 4 --------------------------------------------------------------------------
create or replace function private.plan_template_content_from_plan(p_plan uuid, p_components text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan   public.plans;
  v_tz     text;
  v_anchor date;
  v_out    jsonb := jsonb_build_object('version', 1);
  v_active uuid[];
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'Plan not found' using errcode = 'P0002';
  end if;
  select timezone into v_tz from public.organizations where id = v_plan.organization_id;
  v_anchor := (v_plan.service_date at time zone v_tz)::date;

  if 'notes' = any(p_components) then
    v_out := v_out || jsonb_build_object('notes', nullif(btrim(v_plan.notes), ''));
  end if;
  if 'times' = any(p_components) then
    if exists (
      select 1 from public.plan_times t
       where t.plan_id = p_plan and abs((t.starts_at at time zone v_tz)::date - v_anchor) > 14
    ) then
      perform private.f10_bad('A time on this plan is more than 14 days from its service date');
    end if;
    v_out := v_out || jsonb_build_object('times', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', t.kind,
               'name', t.name,
               'day_offset', (t.starts_at at time zone v_tz)::date - v_anchor,
               'local_start', to_char(t.starts_at at time zone v_tz, 'HH24:MI'),
               'duration_minutes', least(1440, greatest(1, round(extract(epoch from t.ends_at - t.starts_at) / 60)::int))
             ) order by t.sort_order, t.starts_at, t.id)
        from public.plan_times t where t.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'items' = any(p_components) then
    v_out := v_out || jsonb_build_object('items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_type', i.item_type, 'title', i.title, 'song_id', i.song_id,
               'arrangement_id', i.arrangement_id, 'key_override', i.key_override,
               'length_seconds', i.length_seconds, 'description', i.description
             ) order by i.sort_order, i.created_at, i.id)
        from public.plan_items i where i.plan_id = p_plan
    ), '[]'::jsonb));
  end if;
  if 'needs' = any(p_components) then
    v_out := v_out || jsonb_build_object('needs', coalesce((
      select jsonb_agg(jsonb_build_object('position_id', n.position_id, 'needed', n.needed) order by n.position_id)
        from public.plan_position_needs n
        join public.team_positions tp on tp.id = n.position_id and tp.plan_id is null
       where n.plan_id = p_plan and n.needed > 0
    ), '[]'::jsonb));
  end if;
  if 'roster' = any(p_components) then
    v_active := private.plan_active_people(p_plan);
    v_out := v_out || jsonb_build_object('roster', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'team_id', r.team_id, 'position_id', r.position_id)
                       order by r.team_id, r.position_id, r.person_id)
        from (
          select distinct a.person_id, a.team_id, a.position_id
            from public.assignments a
            left join public.team_positions tp on tp.id = a.position_id
           where a.plan_id = p_plan and a.status <> 'declined'
             and a.person_id = any(v_active)
             and (a.position_id is null or tp.plan_id is null)
        ) r
    ), '[]'::jsonb));
  end if;
  return v_out;
end;
$$;
