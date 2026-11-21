-- QA wave 8 follow-up to 20261127000400_w8_realtime_revocation.sql.
--
-- Deleting an organization cascades to organization_members, whose AFTER DELETE trigger
-- rotates the org's Realtime key. By then the organization row (and, through its cascade, the
-- org_realtime_keys row) is gone, so the "no key yet" branch inserted a key for a missing
-- organization and the foreign key aborted the whole organization delete.
--
-- A key is only (re)created for an organization that still exists. Rotation of an existing key
-- is unchanged.

create or replace function private.rotate_org_realtime_key(p_org uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old text;
  v_rotated timestamptz;
begin
  select k.key, k.rotated_at into v_old, v_rotated
    from private.org_realtime_keys k where k.organization_id = p_org for update;
  if not found then
    insert into private.org_realtime_keys (organization_id)
    select p_org
     where exists (select 1 from public.organizations o where o.id = p_org)
    on conflict do nothing;
    return;
  end if;
  -- One rotation per transaction is enough: nobody sees the new key before commit.
  if v_rotated = now() then
    return;
  end if;
  -- Tell sockets on the old control topic to refetch the key. Clients listen for 'changed' on
  -- every topic; the payload carries no data.
  perform realtime.send(jsonb_build_object('event', 'rekey'), 'changed', 'org:' || p_org || ':' || v_old, true);
  update private.org_realtime_keys
     set key = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         rotated_at = now()
   where organization_id = p_org;
end;
$$;
revoke all on function private.rotate_org_realtime_key(uuid) from public, anon, authenticated;
