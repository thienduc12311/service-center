-- Teams get an optional description so an organization can explain what a team
-- is for ("Sunday morning worship band — vocals, rhythm and production").
--
-- No RLS change needed: the teams_select / teams_write policies
-- (20260101000100_rls.sql) already cover every column on the table.

alter table public.teams
  add column description text;
