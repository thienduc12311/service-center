-- W8 People search (owner): the People list shows a has-login member's
-- contact from their login profile (member_contacts), but owner search matched
-- only the `people` row's own email/phone. The member trigger copies the email
-- once and never the phone, so searching for the phone (or a changed email)
-- shown on screen found nobody.
--
-- people_owner_search is the owner's People-list source when searching: the
-- roster columns the list reads, sort_name for the keyset, and the contact the
-- owner can see, preferring the login profile like team_roster_people does:
--   contact_email = coalesce(profile.email, person.email)
--   contact_phone = coalesce(profile.phone, person.phone)
--
-- Privacy: the view runs as its owner (it reads profiles' contact columns,
-- which API roles cannot select), so it returns rows ONLY to an active owner
-- of the row's organization (private.is_people_owner, the same rule as
-- people_owner_privacy and member_contacts). Every column is one the owner
-- can already read via `people` or member_contacts; nothing else of `people`
-- (address, notes, medical note, ...) is exposed. security_barrier keeps
-- caller filters (ilike on contact) from being evaluated before the owner
-- check. Read-only: writes are revoked.

create or replace view public.people_owner_search
with (security_barrier = true) as
  select p.id, p.organization_id, p.profile_id, p.first_name, p.last_name,
         p.avatar_url, p.email, p.phone, p.campus, p.archived_at, p.sort_name,
         coalesce(pr.email, p.email) as contact_email,
         coalesce(pr.phone, p.phone) as contact_phone
    from public.people p
    left join public.profiles pr on pr.id = p.profile_id
   where private.is_people_owner(p.organization_id);

revoke all on public.people_owner_search from public, anon, authenticated, service_role;
grant select on public.people_owner_search to authenticated;

comment on view public.people_owner_search is
  'W8: owner-only People-list search source; contact_email/contact_phone prefer the login profile, as the list displays. Returns nothing to non-owners.';
