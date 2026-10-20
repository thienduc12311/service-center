import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  capabilitiesForScope,
  type AccessCapability,
  type AccessScopeType,
  type ReplaceScopeGrantsInput,
  type ScopeAccess,
} from '@service-center/shared';
import { keys, usePeople, useInvalidateOrg } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice, Spinner } from '../ui';

export interface ScopeAccessEditorProps {
  scopeType: AccessScopeType;
  scopeId: string | null;
  /** What this scope is, e.g. "Worship Band". */
  scopeName: string;
  load: () => Promise<ScopeAccess>;
  save: (input: ReplaceScopeGrantsInput) => Promise<ScopeAccess>;
}

/**
 * Administrator editor for the grants at one scope. Saves the whole set at
 * once (PUT …/access), so what is shown is exactly what is stored.
 */
export const ScopeAccessEditor = ({ scopeType, scopeId, scopeName, load, save }: ScopeAccessEditorProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const { organizationId } = useAuth();
  const invalidate = useInvalidateOrg();
  const people = usePeople();
  const capabilities = capabilitiesForScope(scopeType);
  const [userId, setUserId] = useState('');
  const [capability, setCapability] = useState<AccessCapability>(capabilities[0] ?? 'scheduling.manage');

  const access = useQuery({
    queryKey: keys.scopeAccess(organizationId, scopeType, scopeId),
    queryFn: load,
    enabled: Boolean(organizationId),
  });

  const replace = useMutation({
    mutationFn: save,
    onSuccess: async () => {
      setUserId('');
      await invalidate();
    },
  });

  const grants = access.data?.grants ?? [];
  const current = grants.map((grant) => ({ user_id: grant.user_id, capability: grant.capability }));
  const members = (people.data ?? []).filter((person) => person.has_login && person.profile_id);

  return (
    <div className="space-y-3">
      {access.isLoading ? (
        <Spinner />
      ) : grants.length === 0 ? (
        <p className="text-sm text-slate-500">{t('scopeAccess.empty', { scope: scopeName })}</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {grants.map((grant) => (
            <li key={grant.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{grant.full_name ?? t('scopeAccess.unknownMember')}</span>
                <span className="text-slate-500"> · {t(`capabilities.${grant.capability}`)}</span>
              </span>
              <Button
                variant="ghost"
                className="!px-2 text-xs"
                aria-label={t('scopeAccess.removeLabel', {
                  permission: t(`capabilities.${grant.capability}`),
                  name: grant.full_name ?? t('scopeAccess.unknownMember'),
                })}
                loading={replace.isPending}
                onClick={() =>
                  replace.mutate({
                    grants: current.filter((g) => !(g.user_id === grant.user_id && g.capability === grant.capability)),
                  })
                }
              >
                {t('common:actions.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor={`grant-member-${scopeType}-${scopeId ?? 'org'}`}>{t('access.member')}</label>
          <select
            id={`grant-member-${scopeType}-${scopeId ?? 'org'}`}
            className="input"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
            <option value="">{t('access.chooseMember')}</option>
            {members.map((person) => (
              <option key={person.id} value={person.profile_id ?? ''}>
                {person.full_name ?? t('common:fallback.unnamed')}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label className="label" htmlFor={`grant-capability-${scopeType}-${scopeId ?? 'org'}`}>{t('access.permission')}</label>
          <select
            id={`grant-capability-${scopeType}-${scopeId ?? 'org'}`}
            className="input"
            value={capability}
            onChange={(e) => setCapability(e.target.value as AccessCapability)}
          >
            {capabilities.map((value) => (
              <option key={value} value={value}>
                {t(`capabilities.${value}`)}
              </option>
            ))}
          </select>
        </div>
        <Button
          disabled={!userId}
          loading={replace.isPending}
          onClick={() => replace.mutate({ grants: [...current, { user_id: userId, capability }] })}
        >
          {t('scopeAccess.grant')}

        </Button>
      </div>

      <ErrorNotice error={access.error ?? replace.error} />
    </div>
  );
};
