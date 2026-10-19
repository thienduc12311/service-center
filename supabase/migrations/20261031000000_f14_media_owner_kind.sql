-- F14: media bundles own files through the F13 file model.
--
-- A new enum value cannot be used in the transaction that adds it, so it is
-- added on its own before 20261031000100_f14_rehearsal_media_stage.sql uses it.
alter type public.file_owner_kind add value if not exists 'media';
