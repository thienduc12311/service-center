-- W2-RESP-D4: the respond-link preview showed requests that the respond call
-- then refused as stale. One read-only function now applies the same tests as
-- private.apply_assignment_snapshot_response (superseded, consumed, expired,
-- and any assignment whose person, plan, release, request revision, status or
-- time set has moved on), so preview and respond agree on the Request Snapshot.
-- Returns 'current' | 'stale' | 'expired'. Does not lock; the answer call
-- re-checks under lock.
create or replace function public.assignment_snapshot_state(p_snapshot uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_snap public.assignment_request_snapshots;
begin
  select * into v_snap from public.assignment_request_snapshots where id = p_snapshot;
  if not found or v_snap.superseded_at is not null or v_snap.consumed_at is not null then
    return 'stale';
  end if;
  if v_snap.expires_at <= now() then return 'expired'; end if;
  if exists (
    select 1
      from public.assignment_request_snapshot_items i
      left join public.assignments a on a.id = i.assignment_id
     where i.snapshot_id = p_snapshot
       and (a.id is null
            or a.person_id <> v_snap.person_id or a.plan_id <> v_snap.plan_id
            or a.visibility <> 'released'
            or a.request_revision <> i.expected_request_revision
            or a.status <> i.expected_status
            or private.assignment_time_ids(a.id) <> i.plan_time_ids)
  ) then
    return 'stale';
  end if;
  return 'current';
end;
$$;
revoke execute on function public.assignment_snapshot_state(uuid) from public, anon, authenticated;
grant execute on function public.assignment_snapshot_state(uuid) to service_role;
