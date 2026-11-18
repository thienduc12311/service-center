-- P0 (QA wave 3, W3-REL-D1): `public.is_org_admin(org)` was defined as
-- `select public.org_role_of(org) in ('owner', 'admin')`. When the caller is
-- not an active member of `org`, `org_role_of(org)` returns NULL, so
-- `is_org_admin(org)` returned NULL rather than false.
--
-- In RLS policies a NULL predicate denies the row, but in PL/pgSQL
-- security-definer RPCs that guard with `if not public.is_org_admin(...) then
-- raise ...` (or `if not (... or public.is_org_admin(...)) then raise ...`),
-- `not NULL` evaluates to NULL and the guard does not fire. Any authenticated
-- user outside the organization could invoke those RPCs directly through
-- PostgREST `/rpc/...`.
--
-- Coalescing to false makes `is_org_admin` total over all inputs (including
-- non-members and NULL org IDs). `is_org_admin` was the only boolean helper
-- built on `org_role_of`; all other boolean helpers use `exists (...)` or
-- `coalesce(..., false)`.

create or replace function public.is_org_admin(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.org_role_of(org) in ('owner', 'admin'), false);
$$;
