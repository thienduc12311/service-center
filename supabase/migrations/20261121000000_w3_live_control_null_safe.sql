-- W3-LIVE-D1: a vacant controller made the lease predicate NULL, allowing
-- commands through IF NOT v_holds. Always fail closed, and explicitly reject
-- policy/release commands on terminal runs. Keep replay, row locking, grants,
-- and the editor-only discard/correction paths unchanged.
begin;

create or replace function public.live_run_action(
  p_run_id uuid,
  p_action text,
  p_expected_revision bigint,
  p_client_id text,
  p_action_id text,
  p_target_index int default null,
  p_reason text default null,
  p_countdown_policy text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.live_runs;
  v_prior public.live_run_transitions;
  v_me uuid := (select auth.uid());
  v_name text;
  v_count int;
  v_to int;
  v_from int;
  v_now timestamptz := now();
  v_holds boolean;
  v_details jsonb := '{}'::jsonb;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into v_run from public.live_runs where id = p_run_id for update;
  if not found or not public.is_org_member(v_run.organization_id) then
    raise exception 'Run not found' using errcode = 'P0002';
  end if;
  perform private.live_require_editor(v_run.plan_id, v_run.organization_id);

  if p_action not in ('start', 'advance', 'jump', 'pause', 'resume', 'end', 'take_control', 'take_over',
                      'release_control', 'renew', 'set_policy', 'refresh_snapshot', 'discard') then
    raise exception 'Unknown Live action' using errcode = '22023';
  end if;
  if p_client_id is null or char_length(p_client_id) not between 1 and 100 then
    raise exception 'Send the controlling client id' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters' using errcode = '22023';
  end if;

  -- A repeated command (same action id) answers with the current state and
  -- changes nothing; the id cannot be reused for a different command.
  if p_action_id is not null then
    select * into v_prior from public.live_run_transitions where run_id = p_run_id and client_action_id = p_action_id;
    if found then
      if v_prior.action <> p_action or v_prior.actor_user_id is distinct from v_me then
        raise exception 'That action id was already used for a different command'
          using errcode = 'PT409', hint = 'idempotency_key_reused';
      end if;
      return jsonb_build_object('run', to_jsonb(v_run), 'replayed', true);
    end if;
  elsif p_action <> 'renew' then
    raise exception 'Send an action id' using errcode = '22023';
  end if;

  v_holds := coalesce(v_run.controller_user_id = v_me
             and v_run.controller_client_id = p_client_id
             and v_run.controller_lease_expires_at > v_now, false);

  if p_action = 'renew' then
    if not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;
    update public.live_runs set controller_lease_expires_at = v_now + interval '90 seconds'
     where id = p_run_id returning * into v_run;
    return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
  end if;

  if p_expected_revision is null or p_expected_revision <> v_run.revision then
    raise exception 'The run changed since you last saw it. Nothing was applied.'
      using errcode = 'PT409', hint = 'run_changed';
  end if;

  v_name := private.live_actor_name(v_run.organization_id);
  v_count := jsonb_array_length(v_run.snapshot);
  v_from := v_run.current_index;

  if p_action in ('take_control', 'take_over') then
    if v_run.status in ('ended', 'discarded') then
      raise exception 'This run is over' using errcode = 'PT409', hint = 'run_state';
    end if;
    if p_action = 'take_control' and v_run.controller_user_id is not null
       and v_run.controller_lease_expires_at > v_now and not v_holds then
      raise exception '% is controlling this run. Take over deliberately to replace them.', coalesce(v_run.controller_name, 'Someone')
        using errcode = 'PT409', hint = 'run_control_held';
    end if;
    v_details := jsonb_build_object(
      'previous_controller_user_id', v_run.controller_user_id,
      'previous_controller_name', v_run.controller_name,
      'previous_lease_valid', coalesce(v_run.controller_lease_expires_at > v_now, false));
    update public.live_runs set
      controller_user_id = v_me, controller_client_id = p_client_id, controller_name = v_name,
      controller_lease_expires_at = v_now + interval '90 seconds'
     where id = p_run_id returning * into v_run;
  elsif p_action = 'discard' then
    if v_run.status = 'discarded' then
      raise exception 'This run was already discarded' using errcode = 'PT409', hint = 'run_state';
    end if;
    if v_reason is null then
      raise exception 'Say why the run is being discarded' using errcode = '22023';
    end if;
    -- An active run is discarded only by its controller; a ready or ended one by any plan editor.
    if v_run.status in ('live', 'paused') and not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;
    update public.live_runs set
      status = 'discarded', current_index = null, paused_at = null, discarded_reason = v_reason,
      controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
     where id = p_run_id returning * into v_run;
  else
    if p_action in ('set_policy', 'release_control') and v_run.status in ('ended', 'discarded') then
      raise exception 'This run is over' using errcode = 'PT409', hint = 'run_state';
    end if;
    if not v_holds then
      raise exception 'You are not controlling this run. Nothing was applied.'
        using errcode = 'PT409', hint = 'run_control_lost';
    end if;

    case p_action
      when 'release_control' then
        update public.live_runs set
          controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
         where id = p_run_id returning * into v_run;

      when 'set_policy' then
        if p_countdown_policy is null or p_countdown_policy not in ('item', 'planned_end', 'service_end') then
          raise exception 'Unknown countdown policy' using errcode = '22023';
        end if;
        v_details := jsonb_build_object('previous', v_run.countdown_policy, 'policy', p_countdown_policy);
        update public.live_runs set countdown_policy = p_countdown_policy
         where id = p_run_id returning * into v_run;

      when 'refresh_snapshot' then
        if v_run.status <> 'ready' then
          raise exception 'A started run keeps the order it started with' using errcode = 'PT409', hint = 'run_state';
        end if;
        v_details := jsonb_build_object(
          'previous_snapshot_revision', v_run.snapshot_revision,
          'snapshot_revision', (select content_revision from public.plans where id = v_run.plan_id));
        update public.live_runs set
          snapshot = private.live_snapshot(v_run.plan_id),
          snapshot_revision = (select content_revision from public.plans where id = v_run.plan_id),
          snapshot_at = v_now
         where id = p_run_id returning * into v_run;

      when 'start' then
        if v_run.status <> 'ready' then
          raise exception 'This run has already started' using errcode = 'PT409', hint = 'run_state';
        end if;
        v_to := private.live_next_runnable(v_run.snapshot, 0);
        if v_to is null then
          raise exception 'This order has nothing to run (only headers or no items)' using errcode = '22023';
        end if;
        update public.live_runs set
          status = 'live', current_index = v_to, current_started_at = v_now, current_paused_ms = 0, started_at = v_now
         where id = p_run_id returning * into v_run;

      when 'advance', 'jump' then
        if v_run.status not in ('live', 'paused') then
          raise exception 'Start the run first' using errcode = 'PT409', hint = 'run_state';
        end if;
        if p_action = 'advance' then
          v_to := private.live_next_runnable(v_run.snapshot, v_run.current_index + 1);
          if v_to is null then
            raise exception 'This is the last item. End the run instead.' using errcode = '22023';
          end if;
        else
          if p_target_index is null or p_target_index < 0 or p_target_index >= v_count then
            raise exception 'Choose an item in this run''s order' using errcode = '22023';
          end if;
          -- Jumping to a header lands on the first item under it.
          v_to := private.live_next_runnable(v_run.snapshot, p_target_index);
          if v_to is null then
            raise exception 'There is nothing to run after that header' using errcode = '22023';
          end if;
          if v_to = v_run.current_index then
            raise exception 'That item is already current' using errcode = '22023';
          end if;
        end if;
        -- A paused run stays paused on the new item (its clock starts at zero).
        update public.live_runs set
          current_index = v_to, current_started_at = v_now, current_paused_ms = 0,
          paused_at = case when v_run.status = 'paused' then v_now end
         where id = p_run_id returning * into v_run;

      when 'pause' then
        if v_run.status <> 'live' then
          raise exception 'Only a running service can be paused' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set status = 'paused', paused_at = v_now
         where id = p_run_id returning * into v_run;

      when 'resume' then
        if v_run.status <> 'paused' then
          raise exception 'The run is not paused' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set
          status = 'live',
          current_paused_ms = current_paused_ms + greatest(0, (extract(epoch from (v_now - paused_at)) * 1000)::bigint),
          paused_at = null
         where id = p_run_id returning * into v_run;

      when 'end' then
        if v_run.status not in ('live', 'paused') then
          raise exception 'Only a started run can be ended' using errcode = 'PT409', hint = 'run_state';
        end if;
        update public.live_runs set
          status = 'ended', ended_at = v_now, current_index = null, paused_at = null,
          controller_user_id = null, controller_client_id = null, controller_name = null, controller_lease_expires_at = null
         where id = p_run_id returning * into v_run;
    end case;
  end if;

  update public.live_runs set revision = revision + 1, updated_at = v_now
   where id = p_run_id returning * into v_run;

  insert into public.live_run_transitions (
    run_id, organization_id, revision, action, from_index, to_index, item_id, status_after,
    occurred_at, actor_user_id, actor_name, client_action_id, reason, details
  ) values (
    v_run.id, v_run.organization_id, v_run.revision, p_action, v_from, v_run.current_index,
    case when v_run.current_index is not null and v_run.current_index is distinct from v_from
         then (v_run.snapshot -> v_run.current_index ->> 'id')::uuid end,
    v_run.status, v_now, v_me, v_name, p_action_id, v_reason, v_details
  );

  return jsonb_build_object('run', to_jsonb(v_run), 'replayed', false);
end;
$$;
revoke execute on function public.live_run_action(uuid, text, bigint, text, text, int, text, text) from public, anon;
grant execute on function public.live_run_action(uuid, text, bigint, text, text, int, text, text) to authenticated, service_role;

commit;
