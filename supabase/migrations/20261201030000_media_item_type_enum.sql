-- Media as its own order item type (Planning Center's "media" item).
--
-- ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, so
-- the new value is added on its own; 20261201030100 uses it.
alter type public.plan_item_type add value if not exists 'media';
