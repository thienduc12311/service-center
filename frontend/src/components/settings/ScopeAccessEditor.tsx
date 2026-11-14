import { useMemo, useState } from 'react';
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
import { Avatar, Button, ErrorNotice, Spinner } from '../ui';
import { Icon } from '../icons';
import { MemberCombobox, type MemberOption } from './MemberCombobox';

export interface ScopeAccessEditorProps {
  scopeType: AccessScopeType;
  scopeId: string | null;
  /** What this scope is, e.g. "Worship Band". */
  scopeName: string;
  load: () => Promise<ScopeAccess>;
  save: (input: ReplaceScopeGrantsInput) => Promise<ScopeAccess>;
}

type ScopeGrant = ScopeAccess['grants'][number];

/** Everything one person holds at this scope. */
interface GrantHolder {
  userId: string;
  name: string | null;
  avatarUrl: string | null;
  capabilities: AccessCapability[];
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

  const grants: ScopeGrant[] = access.data?.grants ?? [];
  const current = grants.map((grant) => ({ user_id: grant.user_id, capability: grant.capability }));

  const options = useMemo<MemberOption[]>(
    () =>
      (people.data ?? [])
        .filter((person) => person.has_login && person.profile_id && !person.archived)
        .map((person) => ({
          id: person.profile_id ?? '',
          name: person.full_name,
          avatarUrl: person.avatar_url,
          detail: person.email,
        })),
    [people.data],
  );
  const avatarFor = useMemo(() => new Map(options.map((option) => [option.id, option.avatarUrl])), [options]);

  const holders = useMemo<GrantHolder[]>(() => {
    const byUser = new Map<string, GrantHolder>();
    for (const grant of grants) {
      const holder = byUser.get(grant.user_id) ?? {
        userId: grant.user_id,
        name: grant.full_name,
        avatarUrl: avatarFor.get(grant.user_id) ?? null,
        capabilities: [],
      };
      holder.capabilities.push(grant.capability);
      byUser.set(grant.user_id, holder);
    }
    return [...byUser.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [grants, avatarFor]);

  const alreadyHeld = current.some((grant) => grant.user_id === userId && grant.capability === capability);
  const fieldId = `${scopeType}-${scopeId ?? 'org'}`;

  return (
    <div className="space-y-4">
      {access.isLoading ? (
        <Spinner />
      ) : holders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-app-border px-4 py-3 text-sm text-slate-500">
          {t('scopeAccess.empty', { scope: scopeName })}
        </p>
      ) : (
        <ul className="divide-y divide-app-border rounded-xl border border-app-border">
          {holders.map((holder) => {
            const name = holder.name ?? t('scopeAccess.unknownMember');
            return (
              <li key={holder.userId} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 items-center gap-2.5 sm:w-48 sm:shrink-0">
                  <Avatar name={holder.name} url={holder.avatarUrl} size="sm" />
                  <span className="truncate text-sm font-medium">{name}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {holder.capabilities.map((held) => (
                    <span
                      key={held}
                      className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25"
                    >
                      {t(`capabilities.${held}`)}
                      <button
                        type="button"
                        className="rounded-full p-0.5 hover:bg-brand-100 disabled:opacity-50 dark:hover:bg-brand-500/25"
                        aria-label={t('scopeAccess.removeLabel', { permission: t(`capabilities.${held}`), name })}
                        disabled={replace.isPending}
                        onClick={() =>
                          replace.mutate({
                            grants: current.filter((g) => !(g.user_id === holder.userId && g.capability === held)),
                          })
                        }
                      >
                        <Icon name="close" className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-950/30">
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{t('scopeAccess.addTitle')}</p>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_auto] sm:items-end">
          <MemberCombobox
            label={t('access.member')}
            options={options}
            value={userId}
            onChange={setUserId}
          />
          <div>
            <label className="label" htmlFor={`grant-capability-${fieldId}`}>{t('access.permission')}</label>
            <select
              id={`grant-capability-${fieldId}`}
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
            icon="plus"
            disabled={!userId || alreadyHeld}
            loading={replace.isPending}
            onClick={() => replace.mutate({ grants: [...current, { user_id: userId, capability }] })}
          >
            {t('scopeAccess.grant')}
          </Button>
        </div>
        {alreadyHeld && <p className="mt-2 text-xs text-slate-500">{t('scopeAccess.alreadyHeld')}</p>}
      </div>

      <ErrorNotice error={access.error ?? replace.error} />
    </div>
  );
};
