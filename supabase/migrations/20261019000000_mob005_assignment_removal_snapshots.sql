-- MOB-005 follow-up: a sent request can be removed again.
--
-- 20261017000300 made `assignment_request_snapshot_items.assignment_id`
-- `on delete restrict`, so once a request had been sent (a snapshot existed)
-- its assignment could no longer be deleted. F01 documents removal as the way
-- a scheduler withdraws a released request, so that must keep working.
--
-- Snapshot semantics when an assignment is removed:
--   * Live snapshot (not consumed, not superseded) that included it: the item
--     is dropped and the snapshot's `version` is bumped. Its id is unchanged,
--     so the effect's deliveries and any outstanding respond link keep
--     pointing at it and still answer the remaining requests; a reviewed copy
--     held by a signed-in client carries the old version and is refused with
--     PT409 ("refresh and review it again"). If no item remains the snapshot
--     is superseded, so its link answers `stale` instead of an empty request.
--   * Consumed or already superseded snapshot: the header row (who, which
--     plan, when it was answered/replaced) stays as the audit record. Its item
--     for the removed assignment goes, exactly like the assignment's response
--     history and per-time responses, which already cascade.

alter table public.assignment_request_snapshot_items
  drop constraint assignment_request_snapshot_items_assignment_id_fkey,
  add constraint assignment_request_snapshot_items_assignment_id_fkey
    foreign key (assignment_id) references public.assignments (id) on delete cascade;

-- Runs per removed row and deletes the item itself (rather than leaving it to
-- the end-of-statement cascade) so a multi-row delete sees an accurate count
-- of what is left in each snapshot.
create or replace function private.withdraw_assignment_from_snapshots()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_snapshot uuid;
begin
  for v_snapshot in
    select s.id
      from public.assignment_request_snapshots s
      join public.assignment_request_snapshot_items i on i.snapshot_id = s.id
     where i.assignment_id = old.id
       and s.consumed_at is null and s.superseded_at is null
     order by s.id
       for update of s
  loop
    delete from public.assignment_request_snapshot_items
     where snapshot_id = v_snapshot and assignment_id = old.id;
    update public.assignment_request_snapshots s
       set version = s.version + 1,
           superseded_at = case
             when exists (select 1 from public.assignment_request_snapshot_items i
                           where i.snapshot_id = s.id) then null
             else now() end
     where s.id = v_snapshot;
  end loop;
  return old;
end;
$$;
revoke execute on function private.withdraw_assignment_from_snapshots() from public, anon, authenticated;

drop trigger if exists assignments_withdraw_from_snapshots on public.assignments;
create trigger assignments_withdraw_from_snapshots
  before delete on public.assignments
  for each row execute function private.withdraw_assignment_from_snapshots();

comment on column public.assignment_request_snapshots.version is
  'Bumped when a live snapshot loses a request because its assignment was removed; reviewed copies with an older version are refused.';
