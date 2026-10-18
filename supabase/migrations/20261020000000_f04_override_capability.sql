-- F04 — a separate capability for scheduling a Person despite a real
-- conflict (blockout or overlapping commitment). Owners, admins and legacy
-- schedulers hold every capability already (F01); scoped schedulers need an
-- explicit grant. Added in its own migration because a new enum value cannot
-- be used in the transaction that creates it.

alter type public.access_capability add value if not exists 'scheduling.override_conflicts';
