-- W7-ACC-D8: the public `organization-logos` bucket accepted SVG. Storage
-- serves objects from the Supabase origin without a Content-Security-Policy
-- or `X-Content-Type-Options: nosniff`, so an SVG carrying a script ran when
-- its public URL was opened directly. Logos are raster images only; the
-- `avatars` bucket already uses the same allow-list (plus gif here).
--
-- No SVG logo existed in the local database when this was written; an SVG
-- uploaded before this migration keeps being served until it is replaced.

update storage.buckets
   set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
 where id = 'organization-logos';
