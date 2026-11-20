-- W7-MSG-D6 / W3-MSG-D5: recipients must not read the sender-side audit row.
--
-- `operational_messages` mixes what a recipient may see (subject, body,
-- sender, time) with sender-side audit data (audience definition, audience and
-- request hashes, recipient/excluded counts, idempotency key, variables,
-- template link). RLS filters rows, never columns, so a recipient with the
-- row-level SELECT could read every column through PostgREST.
--
-- Design:
--   * the base table SELECT policy now admits only the sender (while still an
--     active member) and organization admins -- the recipient branch is gone;
--   * recipients read through `public.my_received_messages(org)`, a
--     SECURITY DEFINER set-returning function that returns only the
--     recipient-safe columns and only for rows where the caller is an
--     `included` recipient and an active member. It is set-returning so
--     PostgREST can still filter/order/limit it (`.rpc().eq().order()`), which
--     the API's keyset pagination relies on. It is keyed on auth.uid(), never
--     on a caller-supplied user id, and is not executable by anon.
-- `variables` (organization/plan/sender names captured for rendering) is
-- recipient-visible: the recipient's rendered text is built from it.
-- A function rather than a security-invoker view: an invoker view would run
-- the (now restricted) base policy, and a definer view is flagged by the
-- Supabase linter. `private.is_message_recipient` is kept for compatibility
-- but no longer used by a policy.

drop policy operational_messages_select on public.operational_messages;
create policy operational_messages_select on public.operational_messages
  for select to authenticated using (
    (created_by = (select auth.uid()) and (select private.is_active_member((select auth.uid()), organization_id)))
    or (select public.is_org_admin(organization_id)));

create or replace function public.my_received_messages(p_organization_id uuid)
returns table (
  id              uuid,
  organization_id uuid,
  plan_id         uuid,
  subject         text,
  body            text,
  variables       jsonb,
  created_by      uuid,
  created_at      timestamptz
)
language sql stable security definer set search_path = '' as $$
  select m.id, m.organization_id, m.plan_id, m.subject, m.body, m.variables, m.created_by, m.created_at
    from public.operational_message_recipients r
    join public.operational_messages m on m.id = r.message_id
   where r.profile_id = (select auth.uid())
     and r.status = 'included'
     and m.organization_id = p_organization_id
     and private.is_active_member((select auth.uid()), m.organization_id);
$$;
revoke execute on function public.my_received_messages(uuid) from public, anon;
grant execute on function public.my_received_messages(uuid) to authenticated, service_role;
comment on function public.my_received_messages(uuid) is
  'Recipient-safe columns of the operational messages the caller received in one organization (W7-MSG-D6).';
-- The existing operational_message_recipients_profile_idx serves the lookup.
