import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { formatDate, type DelegationSummary, type GrantDelegationRequest } from '@service-center/shared';
import { api } from '../../lib/api';
import { useDelegations, useInvalidateOrg, usePeople } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../ui';

const rightsLabel = (delegation: DelegationSummary): string =>
  [
    delegation.can_respond && 'answer requests',
    (delegation.can_view_schedule || delegation.can_respond) && 'see requests',
    delegation.can_manage_availability && 'manage availability',
  ].filter(Boolean).join(', ');

/**
 * F03 Pass C: explicitly let another member help with your schedule. Only
 * you can grant help over your own schedule; being in the same household or
 * holding a role grants nothing. Each right is separate, and seeing requests
 * never includes plan details, notes or files.
 */
export const ScheduleHelp = () => {
  const { user } = useAuth();
  const invalidate = useInvalidateOrg();
  const delegations = useDelegations();
  const people = usePeople();
  const myPersonId = people.data?.find((person) => person.profile_id === user?.profile.id)?.person_id ?? null;
  const helpers = (people.data ?? []).filter((person) =>
    person.person_id && person.has_login && person.status === 'active' && !person.archived && person.person_id !== myPersonId);

  const [delegateId, setDelegateId] = useState('');
  const [canRespond, setCanRespond] = useState(true);
  const [canView, setCanView] = useState(false);
  const [canAvailability, setCanAvailability] = useState(true);
  const [expires, setExpires] = useState('');

  const grant = useMutation({
    mutationFn: () => {
      const body: GrantDelegationRequest = {
        delegate_person_id: delegateId,
        can_respond: canRespond,
        can_view_schedule: canView,
        can_manage_availability: canAvailability,
        expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      };
      return api.grantDelegation(body);
    },
    onSuccess: async () => { await invalidate(); setDelegateId(''); setExpires(''); },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeDelegation(id), onSuccess: invalidate });

  const given = (delegations.data ?? []).filter((d) => d.direction === 'given');
  const received = (delegations.data ?? []).filter((d) => d.direction === 'received' && d.active);

  return (
    <section className="card p-5">
      <h2 className="mb-1 font-semibold">Help with my schedule</h2>
      <p className="mb-4 text-sm text-slate-500">
        Let someone you trust answer requests or update your availability for you. They see only what you allow — never plan notes or files — and you can stop it at any time.
      </p>

      {delegations.isLoading ? <Loading /> : (
        <>
          {given.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {given.map((delegation) => (
                <li key={delegation.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{delegation.delegate_name}</p>
                    <p className="text-xs text-slate-500">
                      Can {rightsLabel(delegation)}
                      {delegation.expires_at ? ` · until ${formatDate(delegation.expires_at)}` : ''}
                      {!delegation.active ? ' · expired' : ''}
                    </p>
                  </div>
                  <Button variant="ghost" className="text-rose-600" loading={revoke.isPending && revoke.variables === delegation.id}
                    onClick={() => revoke.mutate(delegation.id)}>Stop</Button>
                </li>
              ))}
            </ul>
          )}

          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); grant.mutate(); }}>
            <label className="label">
              Who can help
              <select className="input mt-1" value={delegateId} onChange={(e) => setDelegateId(e.target.value)} required>
                <option value="">Choose someone with a login</option>
                {helpers.map((person) => <option key={person.person_id} value={person.person_id!}>{person.full_name ?? 'Unnamed'}</option>)}
              </select>
            </label>
            <fieldset className="space-y-1 text-sm">
              <legend className="label">They can</legend>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canRespond} onChange={(e) => setCanRespond(e.target.checked)} />Accept or decline my requests</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canView || canRespond} disabled={canRespond} onChange={(e) => setCanView(e.target.checked)} />See my requests (dates, times and roles)</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canAvailability} onChange={(e) => setCanAvailability(e.target.checked)} />Manage my blockout dates and preferences</label>
            </fieldset>
            <label className="label">
              Until <span className="font-normal text-slate-400">(optional)</span>
              <input className="input mt-1" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <Button type="submit" loading={grant.isPending} disabled={!delegateId || !(canRespond || canView || canAvailability)}>Allow</Button>
          </form>

          {received.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">People I help</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {received.map((delegation) => (
                  <li key={delegation.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{delegation.target_name}</p>
                      <p className="text-xs text-slate-500">You can {rightsLabel(delegation)}</p>
                    </div>
                    <Link className="button button-secondary" to={`/help/${delegation.id}`}>Open</Link>
                    <Button variant="ghost" loading={revoke.isPending && revoke.variables === delegation.id}
                      onClick={() => revoke.mutate(delegation.id)}>Stop helping</Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <ErrorNotice error={delegations.error ?? grant.error ?? revoke.error} />
    </section>
  );
};
