-- Renewable push-registration leases bound stale device rows to a finite
-- delivery window. Online sign-out still deletes immediately; when a device
-- cannot reach the API, delivery stops no later than thirty days after its
-- last successful registration.

alter table public.device_push_tokens
  add column lease_expires_at timestamptz,
  add column revocation_secret_hash text;

-- Existing registrations receive no grace extension: a recently seen device
-- keeps the remainder of its thirty-day window, while an already stale row is
-- immediately excluded by the delivery query.
update public.device_push_tokens
set
  lease_expires_at = last_seen_at + interval '30 days',
  -- Existing clients never received this raw secret, so their random hash is
  -- intentionally unclaimable; authenticated delete and lease expiry remain.
  revocation_secret_hash = encode(extensions.gen_random_bytes(32), 'hex');

alter table public.device_push_tokens
  alter column lease_expires_at set default (now() + interval '30 days'),
  alter column lease_expires_at set not null,
  alter column revocation_secret_hash set default encode(extensions.gen_random_bytes(32), 'hex'),
  alter column revocation_secret_hash set not null,
  add constraint device_push_tokens_lease_after_seen
    check (lease_expires_at > last_seen_at),
  add constraint device_push_tokens_revocation_hash_format
    check (revocation_secret_hash ~ '^[0-9a-f]{64}$');

-- Equality by recipient followed by the lease range is the delivery path.
create index device_push_tokens_active_user_idx
  on public.device_push_tokens (user_id, lease_expires_at);

comment on column public.device_push_tokens.lease_expires_at is
  'Push delivery is allowed only before this renewable server timestamp.';
comment on column public.device_push_tokens.revocation_secret_hash is
  'SHA-256 of a per-registration secret returned once to the registering device.';
