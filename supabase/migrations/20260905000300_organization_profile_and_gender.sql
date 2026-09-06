-- Organization profile fields (address, denomination, self-reported size)
-- and constraining people.gender to the two values this app models.

alter table public.organizations
  add column address_line1  text,
  add column address_line2  text,
  add column city           text,
  add column state_province text,
  add column postal_code    text,
  add column country        text,
  add column denomination   text,
  add column member_count   int check (member_count is null or member_count >= 0);

-- No RLS change needed: organizations' existing org_select/org_update
-- policies (20260101000100_rls.sql) already cover every column on the table.

alter table public.people
  add constraint people_gender_valid check (gender is null or gender in ('male', 'female'));
