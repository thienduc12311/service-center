-- Invalidate client reads without putting any chat or live state on the wire.
-- Realtime checks these policies on join/token refresh. The API independently
-- checks access on every read, including reads prompted by a cached channel.
create function private.can_receive_resource_poke(p_topic text)
returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic is null or p_topic !~ '^(conversation|live_run|live_plan):[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_id := split_part(p_topic, ':', 2)::uuid;

  case split_part(p_topic, ':', 1)
    when 'conversation' then
      return private.can_access_conversation(auth.uid(), v_id);
    when 'live_run' then
      -- Same RLS-backed run and plan read as live_run_state.
      return exists (
        select 1 from public.live_runs r
        join public.plans p on p.id = r.plan_id
        where r.id = v_id
      );
    when 'live_plan' then
      return exists (select 1 from public.plans p where p.id = v_id);
  end case;
end;
$$;
revoke all on function private.can_receive_resource_poke(text) from public, anon;
grant execute on function private.can_receive_resource_poke(text) to authenticated;

create policy resource_pokes_receive on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and (select private.can_receive_resource_poke(realtime.topic()))
  );

create function private.send_resource_poke(p_resource text, p_id uuid)
returns void
language sql
set search_path = ''
as $$
  select realtime.send(
    jsonb_build_object('id', p_id, 'event', 'changed'),
    'changed',
    p_resource || ':' || p_id,
    true
  );
$$;
revoke all on function private.send_resource_poke(text, uuid) from public, anon, authenticated;

create function private.broadcast_conversation_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.send_resource_poke('conversation', coalesce(new.conversation_id, old.conversation_id));
  return null;
end;
$$;
revoke all on function private.broadcast_conversation_change() from public, anon, authenticated;

create trigger conversation_messages_broadcast
  after insert or update or delete on public.conversation_messages
  for each row execute function private.broadcast_conversation_change();

create function private.broadcast_live_run_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' then
    perform private.send_resource_poke('live_run', coalesce(new.id, old.id));
    perform private.send_resource_poke('live_plan', coalesce(new.plan_id, old.plan_id));
  else
    -- Commands increment the revision, and lease renewals change the expiry.
    -- A removed service time can detach a run without changing its revision.
    if new.revision is distinct from old.revision
       or new.controller_lease_expires_at is distinct from old.controller_lease_expires_at
       or new.plan_time_id is distinct from old.plan_time_id then
      perform private.send_resource_poke('live_run', new.id);
    end if;
    if new.status is distinct from old.status or new.plan_time_id is distinct from old.plan_time_id then
      perform private.send_resource_poke('live_plan', new.plan_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.broadcast_live_run_change() from public, anon, authenticated;

create trigger live_runs_broadcast
  after insert or update or delete on public.live_runs
  for each row execute function private.broadcast_live_run_change();

create function private.broadcast_live_plan_revision()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.send_resource_poke('live_plan', new.id);
  -- The run-state API compares the current plan revision with its snapshot.
  -- Plan-time edits also bump the revision, so they use the same signal.
  perform private.send_resource_poke('live_run', r.id)
    from public.live_runs r
   where r.plan_id = new.id and r.status in ('ready', 'live', 'paused');
  return null;
end;
$$;
revoke all on function private.broadcast_live_plan_revision() from public, anon, authenticated;

create trigger live_plan_revision_broadcast
  after update of content_revision on public.plans
  for each row when (old.content_revision is distinct from new.content_revision)
  execute function private.broadcast_live_plan_revision();
