import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { type DelegationSummary, type GrantDelegationRequest } from '@service-center/shared';
import { api } from '../../lib/api';
import { useDelegations, useInvalidateOrg, usePeople } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Loading } from '../ui';
import { useFormatters } from '../../i18n';

/** The rights a delegation carries, each as a translated phrase. */
const rightsOf = (t: TFunction<'settings'>, delegation: DelegationSummary): string[] =>
  [
    delegation.can_respond ? t('help.rights.respond') : null,
    delegation.can_view_schedule || delegation.can_respond ? t('help.rights.view') : null,
    delegation.can_manage_availability ? t('help.rights.availability') : null,
  ].filter((right): right is string => right !== null);

/**
 * F03 Pass C: explicitly let another member help with your schedule. Only
 * you can grant help over your own schedule; being in the same household or
 * holding a role grants nothing. Each right is separate, and seeing requests
 * never includes plan details, notes or files.
 */
export const ScheduleHelp = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { t: tSettings } = useTranslation('settings');
  const { date, list } = useFormatters();
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
      <h2 className="mb-1 font-semibold">{t('help.title')}</h2>
      <p className="mb-4 text-sm text-slate-500">{t('help.description')}</p>

      {delegations.isLoading ? <Loading /> : (
        <>
          {given.length > 0 && (
            <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {given.map((delegation) => (
                <li key={delegation.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{delegation.delegate_name}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        t('help.theyCan', { rights: list(rightsOf(tSettings, delegation)) }),
                        delegation.expires_at ? t('help.until', { date: date(delegation.expires_at) }) : null,
                        !delegation.active ? t('help.expired') : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Button variant="ghost" className="text-rose-600" loading={revoke.isPending && revoke.variables === delegation.id}
                    onClick={() => revoke.mutate(delegation.id)}>{t('help.stop')}</Button>
                </li>
              ))}
            </ul>
          )}

          <form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); grant.mutate(); }}>
            <label className="label">
              {t('help.who')}
              <select className="input mt-1" value={delegateId} onChange={(e) => setDelegateId(e.target.value)} required>
                <option value="">{t('help.chooseSomeone')}</option>
                {helpers.map((person) => <option key={person.person_id} value={person.person_id!}>{person.full_name ?? t('common:fallback.unnamed')}</option>)}
              </select>
            </label>
            <fieldset className="space-y-1 text-sm">
              <legend className="label">{t('help.theyCanLegend')}</legend>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canRespond} onChange={(e) => setCanRespond(e.target.checked)} />{t('help.allowRespond')}</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canView || canRespond} disabled={canRespond} onChange={(e) => setCanView(e.target.checked)} />{t('help.allowView')}</label>
              <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={canAvailability} onChange={(e) => setCanAvailability(e.target.checked)} />{t('help.allowAvailability')}</label>
            </fieldset>
            <label className="label">
              {t('help.untilLabel')} <span className="font-normal text-slate-400">{t('help.optional')}</span>
              <input className="input mt-1" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </label>
            <Button type="submit" loading={grant.isPending} disabled={!delegateId || !(canRespond || canView || canAvailability)}>{t('help.allow')}</Button>
          </form>

          {received.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold">{t('help.peopleIHelp')}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {received.map((delegation) => (
                  <li key={delegation.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{delegation.target_name}</p>
                      <p className="text-xs text-slate-500">{t('help.youCan', { rights: list(rightsOf(tSettings, delegation)) })}</p>
                    </div>
                    <Link className="button button-secondary" to={`/help/${delegation.id}`}>{t('common:actions.open')}</Link>
                    <Button variant="ghost" loading={revoke.isPending && revoke.variables === delegation.id}
                      onClick={() => revoke.mutate(delegation.id)}>{t('help.stopHelping')}</Button>

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
