-- Organization branding and tenant-scoped song books.

alter table public.organizations add column logo_url text;

create table public.songbooks (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  title                 text not null check (length(trim(title)) between 1 and 200),
  description           text check (description is null or length(description) <= 2000),
  source_type           text not null default 'manual' check (source_type in ('manual', 'document')),
  source_storage_path   text,
  source_filename       text,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint songbooks_source_valid check (
    (source_type = 'manual' and source_storage_path is null)
    or (source_type = 'document' and source_storage_path is not null)
  )
);
create index songbooks_organization_created_idx
  on public.songbooks (organization_id, created_at desc);
create index songbooks_created_by_idx on public.songbooks (created_by);

create table public.songbook_items (
  id              uuid primary key default gen_random_uuid(),
  songbook_id     uuid not null references public.songbooks (id) on delete cascade,
  song_id         uuid not null references public.songs (id) on delete cascade,
  arrangement_id  uuid references public.arrangements (id) on delete set null,
  sort_order      integer not null default 0 check (sort_order >= 0),
  created_at      timestamptz not null default now(),
  unique (songbook_id, song_id)
);
create index songbook_items_songbook_order_idx on public.songbook_items (songbook_id, sort_order);
create index songbook_items_song_id_idx on public.songbook_items (song_id);
create index songbook_items_arrangement_id_idx on public.songbook_items (arrangement_id);

create trigger set_updated_at before update on public.songbooks
  for each row execute function public.set_updated_at();

create or replace function public.org_of_songbook(book uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select organization_id from public.songbooks where id = book;
$$;

alter table public.songbooks enable row level security;
alter table public.songbook_items enable row level security;

create policy songbooks_select on public.songbooks
  for select using (public.is_org_member(organization_id));
create policy songbooks_write on public.songbooks
  for all using (public.can_manage_org(organization_id))
  with check (public.can_manage_org(organization_id));
create policy songbook_items_select on public.songbook_items
  for select using (public.is_org_member(public.org_of_songbook(songbook_id)));
create policy songbook_items_write on public.songbook_items
  for all using (public.can_manage_org(public.org_of_songbook(songbook_id)))
  with check (public.can_manage_org(public.org_of_songbook(songbook_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('organization-logos', 'organization-logos', true, 5242880,
   array['image/png','image/jpeg','image/webp','image/svg+xml']),
  ('songbooks', 'songbooks', false, 52428800,
   array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain'])
on conflict (id) do nothing;

create policy "public reads organization logos" on storage.objects
  for select using (bucket_id = 'organization-logos');
create policy "org admins write organization logos" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'organization-logos'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
create policy "org admins update organization logos" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'organization-logos'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );
create policy "org admins delete organization logos" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'organization-logos'
    and public.is_org_admin(((storage.foldername(name))[1])::uuid)
  );

create policy "org members read songbooks" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'songbooks'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );
create policy "org managers write songbooks" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'songbooks'
    and public.can_manage_org(((storage.foldername(name))[1])::uuid)
  );
create policy "org managers delete songbooks" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'songbooks'
    and public.can_manage_org(((storage.foldername(name))[1])::uuid)
  );
