-- Faster order editing — clear the whole order in one atomic step.
--
-- * `clear_plan_items` removes every item of a plan in one short transaction
--   under the same plan lock and permission check as edit/reorder/remove
--   (`private.lock_plan_for_order_edit`: `can_edit_plan`, else "Plan not
--   found"). Security invoker, so the `plan_items_write` policy still decides
--   the delete itself.
-- * Same cascade as removing items one by one, because it is the same DELETE
--   on `plan_items`: item notes, item comments (and their mentions), item
--   notifications, item-owned files and file links to the items go with them;
--   the files a link pointed at and linked media bundles stay; item-create
--   idempotency records keep their key with a null item. The content revision
--   is bumped by the existing trigger.
-- * Refused (PT409 `live_run_active`) while a run of the plan is live or
--   paused. A run plays its own snapshot, but clearing the order under a
--   running service is almost certainly a mistake. Single-item remove is
--   unchanged and still allowed during a run.
-- * `p_expected_revision` follows the other order endpoints (PT409
--   `plan_changed` when stale). Clearing an already empty order is a no-op
--   success whatever revision was sent, so a retry after a lost response is
--   answered the same way instead of as a conflict.

/** True while a run of the plan is live or paused. Answers only for plans the caller can edit. */
create or replace function private.plan_has_active_live_run(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_edit_plan(p_plan_id) and exists (
    select 1 from public.live_runs r
     where r.plan_id = p_plan_id and r.status in ('live', 'paused')
  );
$$;
revoke execute on function private.plan_has_active_live_run(uuid) from public, anon;
grant execute on function private.plan_has_active_live_run(uuid) to authenticated, service_role;

/**
 * Removes every item in the order. Returns how many were removed and the
 * plan's content revision afterwards.
 */
create or replace function public.clear_plan_items(
  p_plan_id uuid,
  p_expected_revision bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revision bigint;
  v_removed int;
begin
  -- Permission and plan lock; the revision is compared below, after the
  -- empty-order replay case.
  v_revision := private.lock_plan_for_order_edit(p_plan_id, null);

  if private.plan_has_active_live_run(p_plan_id) then
    raise exception 'This plan is running live. End the live run before clearing the order.'
      using errcode = 'PT409', hint = 'live_run_active';
  end if;

  if not exists (select 1 from public.plan_items where plan_id = p_plan_id) then
    return jsonb_build_object('removed', 0, 'content_revision', v_revision);
  end if;

  if p_expected_revision is not null and p_expected_revision <> v_revision then
    raise exception 'This plan changed since you opened it. Review the order and try again.'
      using errcode = 'PT409', hint = 'plan_changed';
  end if;

  delete from public.plan_items where plan_id = p_plan_id;
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'removed', v_removed,
    'content_revision', (select content_revision from public.plans where id = p_plan_id));
end;
$$;
revoke execute on function public.clear_plan_items(uuid, bigint) from public, anon;
grant execute on function public.clear_plan_items(uuid, bigint) to authenticated, service_role;
