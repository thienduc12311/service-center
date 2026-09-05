import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { formatDate } from '@service-center/shared';
import { api } from '../lib/api';
import { useBlockouts, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Loading, PageHeader } from '../components/ui';

export const SettingsPage = () => {
  const { user, refreshUser } = useAuth();
  const invalidate = useInvalidateOrg();
  const blockouts = useBlockouts({ scope: 'mine' });

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
    <div className="max-w-2xl space-y-8">
      <PageHeader title="Settings" subtitle="Your profile and availability." />

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
