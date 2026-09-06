import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatDate, isAdmin, STORAGE_BUCKETS } from '@service-center/shared';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useBlockouts, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';

export const SettingsPage = () => {
  const { user, organizationId, role, refreshUser, switchOrganization } = useAuth();
  const invalidate = useInvalidateOrg();
  const blockouts = useBlockouts({ scope: 'mine' });
  const organization = user?.memberships.find((membership) => membership.organization.id === organizationId)?.organization;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    setFullName(user?.profile.full_name ?? '');
    setPhone(user?.profile.phone ?? '');
  }, [user]);

  const saveProfile = useMutation({
    mutationFn: () => api.updateMe({ full_name: fullName, phone: phone || null }),
    onSuccess: () => refreshUser(),
  });

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [blockoutValidationError, setBlockoutValidationError] = useState<Error | null>(null);

  const blockoutRange = () => {
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);

    if (!from || !to || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error('Choose a start and end date.');
    }
    if (end < start) throw new Error('The end date must be on or after the start date.');

    return { starts_at: start.toISOString(), ends_at: end.toISOString() };
  };

  const addBlockout = useMutation({
    mutationFn: () => api.createBlockout({ ...blockoutRange(), reason: reason.trim() || null }),
    onSuccess: async () => {
      await invalidate();
      setFrom('');
      setTo('');
      setReason('');
      setBlockoutValidationError(null);
    },
  });

  const submitBlockout = () => {
    try {
      blockoutRange();
      setBlockoutValidationError(null);
      addBlockout.mutate();
    } catch (error) {
      setBlockoutValidationError(error instanceof Error ? error : new Error('Invalid blockout dates.'));
    }
  };

  const removeBlockout = useMutation({
    mutationFn: (id: string) => api.deleteBlockout(id),
    onSuccess: invalidate,
  });

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader title="Settings" subtitle="Your profile, organizations, appearance and availability." />

      <section className="card p-5">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form
          className="space-y-4"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            saveProfile.mutate();
          }}
        >
          <div>
            <label className="label" htmlFor="profile-name">Full name</label>
            <input id="profile-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="profile-phone">Phone</label>
            <input id="profile-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <p className="text-sm text-slate-500">Signed in as {user?.profile.email}</p>

          <ErrorNotice error={saveProfile.error} />
          <div className="flex items-center gap-3">
            <Button type="submit" loading={saveProfile.isPending}>
              Save profile
            </Button>
            {saveProfile.isSuccess && <span className="text-sm text-emerald-600">Saved.</span>}
          </div>
        </form>
      </section>

      <OrganizationSettings
        organization={organization}
        canEdit={isAdmin(role)}
        onChanged={refreshUser}
        onCreated={async (id) => {
          await refreshUser();
          switchOrganization(id);
        }}
      />

      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Blockout dates</h2>
        <p className="mb-4 text-sm text-slate-500">
          Dates you can’t serve. Schedulers are warned before they schedule you on them.
        </p>

        <form
          className="mb-4 flex flex-wrap items-end gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            submitBlockout();
          }}
        >
          <div>
            <label className="label" htmlFor="blockout-from">From</label>
            <input
              id="blockout-from"
              type="date"
              className="input"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (!to) setTo(e.target.value);
              }}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="blockout-to">To</label>
            <input
              id="blockout-to"
              type="date"
              className="input"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              required
            />
          </div>
          <div className="flex-1">
            <label className="label" htmlFor="blockout-reason">Reason</label>
            <input
              id="blockout-reason"
              className="input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Vacation"
              maxLength={200}
            />
          </div>
          <Button type="submit" loading={addBlockout.isPending}>
            Add
          </Button>
        </form>

        <ErrorNotice error={blockoutValidationError ?? addBlockout.error ?? removeBlockout.error} />

        {blockouts.isLoading ? (
          <Loading />
        ) : blockouts.data?.length ? (
          <ul className="divide-y divide-slate-100">
            {blockouts.data.map((blockout) => (
              <li key={blockout.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {formatDate(blockout.starts_at)} – {formatDate(blockout.ends_at)}
                  </p>
                  {blockout.reason && <p className="text-xs text-slate-500">{blockout.reason}</p>}
                </div>
                <Button
                  variant="ghost"
                  className="text-rose-600"
                  onClick={() => removeBlockout.mutate(blockout.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">No blockout dates.</p>
        )}
      </section>
    </div>
  );
};

const slugify = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40);

const OrganizationSettings = ({
  organization,
  canEdit,
  onChanged,
  onCreated,
}: {
  organization: { id: string; name: string; logo_url: string | null } | undefined;
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onCreated: (id: string) => Promise<void>;
}) => {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const created = await api.createOrganization({
        name,
        slug: `${slugify(name).slice(0, 35)}-${Date.now().toString(36).slice(-4)}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setName('');
      setCreating(false);
      await onCreated(created.id);
    } catch (reason) {
      setError(reason);
    }
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !organization) return;
    setUploading(true);
    setError(null);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      const path = `${organization.id}/logo-${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKETS.organizationLogos)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from(STORAGE_BUCKETS.organizationLogos).getPublicUrl(path);
      await api.updateOrganization(organization.id, { logo_url: data.publicUrl });
      await onChanged();
    } catch (reason) {
      setError(reason);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  return (
    <section className="card overflow-hidden p-5">
      <div className="flex flex-wrap items-center gap-4">
        {organization?.logo_url ? (
          <img src={organization.logo_url} alt={`${organization.name} logo`} className="size-16 rounded-2xl object-cover ring-1 ring-slate-200 dark:ring-slate-700" />
        ) : (
          <div className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-700 text-xl font-bold text-white">SC</div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-900 dark:text-white">{organization?.name ?? 'Organization'}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create and switch between every community you administer.</p>
        </div>
        {canEdit && organization && (
          <label className="cursor-pointer rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            {uploading ? 'Uploading…' : 'Update logo'}
            <input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} disabled={uploading} />
          </label>
        )}
        <Button variant="secondary" onClick={() => setCreating((value) => !value)}>
          {creating ? 'Cancel' : 'New organization'}
        </Button>
      </div>

      {creating && (
        <form onSubmit={create} className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="label" htmlFor="new-org-name">Organization name</label>
            <input id="new-org-name" className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Grace Community" required />
          </div>
          <Button type="submit">Create organization</Button>
        </form>
      )}
      <ErrorNotice error={error} />
    </section>
  );
};
