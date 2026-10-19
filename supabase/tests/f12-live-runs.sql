-- F12: Live runs — independent runs per service time, pinned snapshots,
-- serialized/idempotent commands, controller lease and takeover, header
-- handling, append-only history, audited corrections and caller-role access.
-- Run against the seeded local database. Everything rolls back.
begin;

create temporary table f12_fx (k text primary key, id uuid) on commit drop;
grant select on f12_fx to authenticated, service_role;
insert into f12_fx values
  ('org', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('st', 'bbbbbbbb-0000-4000-8000-000000000001'),
  ('plan', gen_random_uuid()), ('t9', gen_random_uuid()), ('t11', gen_random_uuid()), ('reh', gen_random_uuid()),
  ('h1', gen_random_uuid()), ('i1', gen_random_uuid()), ('h2', gen_random_uuid()), ('i2', gen_random_uuid()), ('i3', gen_random_uuid()),
  ('other_org', gen_random_uuid()), ('other_plan', gen_random_uuid()), ('other_time', gen_random_uuid());
create or replace function pg_temp.fx(p text) returns uuid language sql stable as $$ select id from f12_fx where k = p $$;
create temporary table f12_run (k text primary key, id uuid, rev bigint) on commit drop;
grant all on f12_run to authenticated, service_role;
create or replace function pg_temp.run(p text) returns uuid language sql stable as $$ select id from f12_run where k = p $$;

insert into public.plans (id, organization_id, service_type_id, title, service_date, status, created_by) values
  (pg_temp.fx('plan'), pg_temp.fx('org'), pg_temp.fx('st'), 'F12 Live', '2027-05-02 14:00+00', 'published', '22222222-2222-4222-8222-222222222222');
insert into public.plan_times (id, plan_id, kind, name, starts_at, ends_at, sort_order) values
  (pg_temp.fx('t9'), pg_temp.fx('plan'), 'service', '9am', '2027-05-02 13:00+00', '2027-05-02 14:00+00', 0),
  (pg_temp.fx('t11'), pg_temp.fx('plan'), 'service', '11am', '2027-05-02 15:00+00', '2027-05-02 16:00+00', 1),
  (pg_temp.fx('reh'), pg_temp.fx('plan'), 'rehearsal', 'Run-through', '2027-05-02 11:00+00', '2027-05-02 12:00+00', 2);
insert into public.plan_items (id, plan_id, item_type, title, length_seconds, sort_order) values
  (pg_temp.fx('h1'), pg_temp.fx('plan'), 'header', 'Worship', 0, 0),
  (pg_temp.fx('i1'), pg_temp.fx('plan'), 'item', 'Welcome', 120, 1),
  (pg_temp.fx('h2'), pg_temp.fx('plan'), 'header', 'Word', 0, 2),
  (pg_temp.fx('i2'), pg_temp.fx('plan'), 'item', 'Sermon', 1800, 3),
  (pg_temp.fx('i3'), pg_temp.fx('plan'), 'item', 'Benediction', 60, 4);

-- Another organization's plan (cross-organization isolation).
insert into public.organizations (id, name, slug) values (pg_temp.fx('other_org'), 'F12 Other', 'f12-other-' || substr(md5(random()::text), 1, 6));
insert into public.plans (id, organization_id, title, service_date, status) values
  (pg_temp.fx('other_plan'), pg_temp.fx('other_org'), 'Elsewhere', '2027-05-02 14:00+00', 'published');
insert into public.plan_times (id, plan_id, kind, starts_at, ends_at) values
  (pg_temp.fx('other_time'), pg_temp.fx('other_plan'), 'service', '2027-05-02 13:00+00', '2027-05-02 14:00+00');

set local role authenticated;

-- ---------------------------------------------------- member cannot run ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  begin
    perform public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t9'), 'item', 'k-member', 'member-tab');
    raise exception 'FAIL: member created a run';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.live_runs (organization_id, plan_id, time_starts_at, time_ends_at, snapshot, snapshot_revision, idempotency_key)
    values (pg_temp.fx('org'), pg_temp.fx('plan'), now(), now(), '[]', 0, 'direct');
    raise exception 'FAIL: direct insert allowed';
  exception when insufficient_privilege then null; end;
end $$;

-- ------------------------------------------------------ editor creates ---
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare r jsonb; r2 jsonb;
begin
  -- Rehearsals and other plans' times are not service occurrences of this plan.
  begin
    perform public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('reh'), 'item', 'k-reh', 'tab-a');
    raise exception 'FAIL: rehearsal accepted as a service time';
  exception when no_data_found then null; end;
  begin
    perform public.create_live_run(pg_temp.fx('other_plan'), pg_temp.fx('other_time'), 'item', 'k-other', 'tab-a');
    raise exception 'FAIL: other organization plan reachable';
  exception when no_data_found then null; end;

  r := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t9'), 'item', 'k-9', 'tab-a');
  if (r->>'replayed')::boolean then raise exception 'FAIL: first create marked replayed'; end if;
  insert into f12_run values ('r9', (r->'run'->>'id')::uuid, (r->'run'->>'revision')::bigint);
  if jsonb_array_length(r->'run'->'snapshot') <> 5 or r->'run'->>'status' <> 'ready' then
    raise exception 'FAIL: snapshot/status %', r->'run';
  end if;
  if r->'run'->>'controller_user_id' <> '22222222-2222-4222-8222-222222222222' then
    raise exception 'FAIL: creator does not hold control';
  end if;

  -- Same key replays the same run; a second run for the same time is refused.
  r2 := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t9'), 'item', 'k-9', 'tab-a');
  if not (r2->>'replayed')::boolean or r2->'run'->>'id' <> r->'run'->>'id' then
    raise exception 'FAIL: replay created another run';
  end if;
  begin
    perform public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t9'), 'item', 'k-9b', 'tab-a');
    raise exception 'FAIL: second run for one service time';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%already has a run%' then raise; end if;
  end;
  begin
    perform public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t11'), 'item', 'k-9', 'tab-a');
    raise exception 'FAIL: key reused for another time';
  exception when sqlstate 'PT409' then null; end;

  -- The 11am occurrence is its own run.
  r := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t11'), 'service_end', 'k-11', 'tab-a');
  insert into f12_run values ('r11', (r->'run'->>'id')::uuid, (r->'run'->>'revision')::bigint);
end $$;

-- ------------------------------------------- pinned snapshot / refresh ---
do $$
declare r jsonb; v_rev bigint;
begin
  -- A plan edit after creation does not change the run.
  update public.plan_items set length_seconds = 999, title = 'Sermon (edited)' where id = pg_temp.fx('i2');
  if (select snapshot -> 3 ->> 'title' from public.live_runs where id = pg_temp.run('r9')) <> 'Sermon' then
    raise exception 'FAIL: snapshot followed a plan edit';
  end if;
  -- Refresh before start pins the new revision (explicit, recorded).
  select revision into v_rev from public.live_runs where id = pg_temp.run('r9');
  r := public.live_run_action(pg_temp.run('r9'), 'refresh_snapshot', v_rev, 'tab-a', 'a-refresh');
  if r->'run'->'snapshot'->3->>'title' <> 'Sermon (edited)'
     or (r->'run'->>'snapshot_revision')::bigint <> (select content_revision from public.plans where id = pg_temp.fx('plan')) then
    raise exception 'FAIL: refresh did not pin the current order';
  end if;
  -- Put the plan back; the run keeps the refreshed snapshot.
  update public.plan_items set length_seconds = 1800, title = 'Sermon' where id = pg_temp.fx('i2');
end $$;

-- ------------------------------------------- start / headers / revision ---
do $$
declare r jsonb; v_rev bigint;
begin
  select revision into v_rev from public.live_runs where id = pg_temp.run('r9');
  -- Stale revision refused; nothing applied.
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'start', v_rev - 1, 'tab-a', 'a-stale');
    raise exception 'FAIL: stale start applied';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%changed since%' then raise; end if;
  end;
  if exists (select 1 from public.live_run_transitions where client_action_id = 'a-stale') then
    raise exception 'FAIL: stale command left a transition';
  end if;
  -- Advance before start is refused.
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'advance', v_rev, 'tab-a', 'a-early');
    raise exception 'FAIL: advanced a run that had not started';
  exception when sqlstate 'PT409' then null; end;

  -- Start skips the leading header.
  r := public.live_run_action(pg_temp.run('r9'), 'start', v_rev, 'tab-a', 'a-start');
  if (r->'run'->>'current_index')::int <> 1 or r->'run'->>'status' <> 'live' then
    raise exception 'FAIL: start did not land on the first runnable item: %', r->'run'->>'current_index';
  end if;
  -- Replay: same action id → same state, no second transition.
  r := public.live_run_action(pg_temp.run('r9'), 'start', v_rev, 'tab-a', 'a-start');
  if not (r->>'replayed')::boolean then raise exception 'FAIL: replay not detected'; end if;
  if (select count(*) from public.live_run_transitions where run_id = pg_temp.run('r9') and action = 'start') <> 1 then
    raise exception 'FAIL: replay duplicated the transition';
  end if;
  -- Same id for a different command is refused.
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'pause', (r->'run'->>'revision')::bigint, 'tab-a', 'a-start');
    raise exception 'FAIL: action id reused';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%different command%' then raise; end if;
  end;

  -- Advance skips the "Word" header onto the sermon.
  r := public.live_run_action(pg_temp.run('r9'), 'advance', (r->'run'->>'revision')::bigint, 'tab-a', 'a-adv1');
  if (r->'run'->>'current_index')::int <> 3 then raise exception 'FAIL: advance did not skip header'; end if;
  if (select item_id from public.live_run_transitions where client_action_id = 'a-adv1') <> pg_temp.fx('i2') then
    raise exception 'FAIL: transition item id';
  end if;
  -- Pause / resume; advancing while paused keeps the run paused.
  r := public.live_run_action(pg_temp.run('r9'), 'pause', (r->'run'->>'revision')::bigint, 'tab-a', 'a-pause');
  if r->'run'->>'status' <> 'paused' then raise exception 'FAIL: pause'; end if;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'pause', (r->'run'->>'revision')::bigint, 'tab-a', 'a-pause2');
    raise exception 'FAIL: paused twice';
  exception when sqlstate 'PT409' then null; end;
  r := public.live_run_action(pg_temp.run('r9'), 'resume', (r->'run'->>'revision')::bigint, 'tab-a', 'a-resume');
  if r->'run'->>'status' <> 'live' or r->'run'->>'paused_at' is not null then raise exception 'FAIL: resume'; end if;

  -- Jump onto a header lands on the item under it; jumping to the current item is refused.
  r := public.live_run_action(pg_temp.run('r9'), 'jump', (r->'run'->>'revision')::bigint, 'tab-a', 'a-jump0', 0);
  if (r->'run'->>'current_index')::int <> 1 then raise exception 'FAIL: jump to header'; end if;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'jump', (r->'run'->>'revision')::bigint, 'tab-a', 'a-jump-same', 1);
    raise exception 'FAIL: jump to current item';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'jump', (r->'run'->>'revision')::bigint, 'tab-a', 'a-jump-out', 9);
    raise exception 'FAIL: jump outside the order';
  exception when invalid_parameter_value then null; end;
  r := public.live_run_action(pg_temp.run('r9'), 'jump', (r->'run'->>'revision')::bigint, 'tab-a', 'a-jump4', 4);
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'advance', (r->'run'->>'revision')::bigint, 'tab-a', 'a-past-end');
    raise exception 'FAIL: advanced past the last item';
  exception when invalid_parameter_value then null; end;
  update f12_run set rev = (r->'run'->>'revision')::bigint where k = 'r9';
end $$;

-- The 11am run was untouched by all of this.
do $$ begin
  if (select status from public.live_runs where id = pg_temp.run('r11')) <> 'ready'
     or (select count(*) from public.live_run_transitions where run_id = pg_temp.run('r11')) <> 1 then
    raise exception 'FAIL: another occurrence changed';
  end if;
  if (select length_seconds from public.plan_items where id = pg_temp.fx('i2')) <> 1800 then
    raise exception 'FAIL: planned length changed';
  end if;
end $$;

-- --------------------------------------------- controller lease / takeover ---
-- The owner (another editor) cannot control without taking it.
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$
declare r jsonb; v_rev bigint := (select rev from f12_run where k = 'r9');
begin
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'jump', v_rev, 'owner-tab', 'o-jump', 1);
    raise exception 'FAIL: non-controller applied a command';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%not controlling%' then raise; end if;
  end;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'take_control', v_rev, 'owner-tab', 'o-take');
    raise exception 'FAIL: took a held lease without take_over';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%is controlling%' then raise; end if;
  end;
  r := public.live_run_action(pg_temp.run('r9'), 'take_over', v_rev, 'owner-tab', 'o-over', null, 'Jordan''s laptop died');
  if r->'run'->>'controller_user_id' <> '11111111-1111-4111-8111-111111111111' then raise exception 'FAIL: take over'; end if;
  if (select details->>'previous_controller_user_id' from public.live_run_transitions where client_action_id = 'o-over')
     <> '22222222-2222-4222-8222-222222222222' then
    raise exception 'FAIL: takeover did not record the previous controller';
  end if;
  update f12_run set rev = (r->'run'->>'revision')::bigint where k = 'r9';
end $$;

-- The previous controller's next command is refused, not silently applied.
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ begin
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'renew', null, 'tab-a', null);
    raise exception 'FAIL: lost controller renewed';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'end', (select rev from f12_run where k = 'r9'), 'tab-a', 'a-end-lost');
    raise exception 'FAIL: lost controller ended the run';
  exception when sqlstate 'PT409' then
    if sqlerrm not like '%not controlling%' then raise; end if;
  end;
end $$;

-- An expired lease can be claimed with take_control.
reset role;
update public.live_runs set controller_lease_expires_at = now() - interval '1 second' where id = pg_temp.run('r9');
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$
declare r jsonb;
begin
  r := public.live_run_action(pg_temp.run('r9'), 'take_control', (select rev from f12_run where k = 'r9'), 'tab-a', 'a-retake');
  if (select details->>'previous_lease_valid' from public.live_run_transitions where client_action_id = 'a-retake') <> 'false' then
    raise exception 'FAIL: expired lease not recorded as expired';
  end if;
  r := public.live_run_action(pg_temp.run('r9'), 'renew', null, 'tab-a', null);
  -- The same user in another tab is a different client.
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'pause', (r->'run'->>'revision')::bigint, 'tab-b', 'b-pause');
    raise exception 'FAIL: second tab controlled without taking control';
  exception when sqlstate 'PT409' then null; end;
  r := public.live_run_action(pg_temp.run('r9'), 'end', (r->'run'->>'revision')::bigint, 'tab-a', 'a-end');
  if r->'run'->>'status' <> 'ended' or r->'run'->>'controller_user_id' is not null then raise exception 'FAIL: end'; end if;
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'take_control', (r->'run'->>'revision')::bigint, 'tab-a', 'a-after-end');
    raise exception 'FAIL: controlled an ended run';
  exception when sqlstate 'PT409' then null; end;
  update f12_run set rev = (r->'run'->>'revision')::bigint where k = 'r9';
end $$;

-- ------------------------------------------------------------ corrections ---
do $$
declare r jsonb; v_t bigint; v_start timestamptz;
begin
  select id, occurred_at into v_t, v_start from public.live_run_transitions where client_action_id = 'a-start';
  begin
    perform public.correct_live_run_time(pg_temp.run('r9'), v_t, v_start - interval '1 minute', '', (select rev from f12_run where k = 'r9'));
    raise exception 'FAIL: correction without a reason';
  exception when invalid_parameter_value then null; end;
  -- Must stay before the next timing transition (all at now() in this transaction).
  begin
    perform public.correct_live_run_time(pg_temp.run('r9'), v_t, v_start + interval '1 minute', 'late', (select rev from f12_run where k = 'r9'));
    raise exception 'FAIL: correction reordered transitions';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.correct_live_run_time(pg_temp.run('r9'), (select id from public.live_run_transitions where client_action_id = 'o-over'),
      v_start, 'not timing', (select rev from f12_run where k = 'r9'));
    raise exception 'FAIL: corrected a control transition';
  exception when no_data_found then null; end;
  r := public.correct_live_run_time(pg_temp.run('r9'), v_t, v_start - interval '2 minutes', 'Started before pressing Start',
    (select rev from f12_run where k = 'r9'));
  if (select occurred_at from public.live_run_transitions where id = v_t) <> v_start then
    raise exception 'FAIL: correction rewrote the transition';
  end if;
  if not exists (select 1 from public.live_run_corrections where transition_id = v_t and previous_at = v_start
                  and corrected_at = v_start - interval '2 minutes' and actor_user_id = '22222222-2222-4222-8222-222222222222') then
    raise exception 'FAIL: correction not recorded with previous value and actor';
  end if;
  -- Stale revision refused.
  begin
    perform public.correct_live_run_time(pg_temp.run('r9'), v_t, v_start - interval '3 minutes', 'again', (select rev from f12_run where k = 'r9'));
    raise exception 'FAIL: stale correction applied';
  exception when sqlstate 'PT409' then null; end;
  -- A correction of a live run is refused.
  begin
    perform public.correct_live_run_time(pg_temp.run('r11'), v_t, v_start, 'nope', 1);
    raise exception 'FAIL: corrected a run that has not ended';
  exception when sqlstate 'PT409' then null; end;
end $$;

-- ------------------------------------------------- discard and restart ---
do $$
declare r jsonb; v_rev bigint := (select revision from public.live_runs where id = pg_temp.run('r9'));
begin
  begin
    perform public.live_run_action(pg_temp.run('r9'), 'discard', v_rev, 'tab-a', 'a-discard-noreason');
    raise exception 'FAIL: discard without a reason';
  exception when invalid_parameter_value then null; end;
  r := public.live_run_action(pg_temp.run('r9'), 'discard', v_rev, 'tab-a', 'a-discard', null, 'Test run before the service');
  r := public.create_live_run(pg_temp.fx('plan'), pg_temp.fx('t9'), 'item', 'k-9-again', 'tab-a');
  if r->'run'->>'id' = pg_temp.run('r9')::text then raise exception 'FAIL: restart reused the run'; end if;
  if (select count(*) from public.live_run_transitions where run_id = pg_temp.run('r9')) < 10 then
    raise exception 'FAIL: discarded run lost its history';
  end if;
end $$;

-- ---------------------------------------------------- caller-role reads ---
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
do $$ begin
  if (select count(*) from public.live_runs where plan_id = pg_temp.fx('plan')) <> 3 then
    raise exception 'FAIL: member cannot read the runs';
  end if;
  if not exists (select 1 from public.live_run_transitions where run_id = pg_temp.run('r9')) then
    raise exception 'FAIL: member cannot read history';
  end if;
end $$;
do $$ begin
  begin
    update public.live_runs set status = 'ended' where id = pg_temp.run('r11');
    raise exception 'FAIL: member updated a run';
  exception when insufficient_privilege then null; end;
  begin
    perform public.live_run_action(pg_temp.run('r11'), 'take_over', 2, 'sam-tab', 's-over');
    raise exception 'FAIL: member took control';
  exception when insufficient_privilege then null; end;
  begin
    update public.live_run_transitions set reason = 'x' where run_id = pg_temp.run('r9');
    raise exception 'FAIL: member rewrote history';
  exception when insufficient_privilege then null; end;
end $$;

-- A removed member reads nothing and cannot act (revocation applies on the next request).
reset role;
update public.organization_members set status = 'inactive'
 where organization_id = pg_temp.fx('org') and user_id = '44444444-4444-4444-8444-444444444444';
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists (select 1 from public.live_runs where plan_id = pg_temp.fx('plan'))
     or exists (select 1 from public.live_run_transitions where run_id = pg_temp.run('r9')) then
    raise exception 'FAIL: removed member still reads Live';
  end if;
  begin
    perform public.live_run_action(pg_temp.run('r11'), 'take_over', 2, 'riley-tab', 'r-over');
    raise exception 'FAIL: removed member reached the run';
  exception when no_data_found then null; end;
end $$;

-- History is append-only even for the table owner.
reset role;
do $$ begin
  begin
    update public.live_run_transitions set reason = 'rewritten' where run_id = pg_temp.run('r9');
    raise exception 'FAIL: owner rewrote history';
  exception when sqlstate 'PT409' then null; end;
end $$;

select 'f12-live-runs: all checks passed' as result;
rollback;
