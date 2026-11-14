import { useState, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ACCESS_CAPABILITIES,
  capabilitiesForScope,
  type AccessCapability,
  type AccessMember,
  type AccessMode,
  type CapabilityExplanation,
  type EffectiveAccessEntry,
} from '@service-center/shared';
import { api } from '../../lib/api';
import {
  changeMemberGrant,
  scopeKey,
  scopeOfGrant,
  type GrantChangeKind,
  type MemberGrantChange,
} from '../../lib/access-grants';
import { useAccessMembers, useInvalidateOrg, useServiceTypes, useTeams } from '../../hooks/queries';
import { Avatar, Badge, Button, ErrorNotice, Modal, Notice, Segmented, type TabItem } from '../ui';
import { Icon } from '../icons';
import { ROLE_TONES } from './access-roles';
import { groupGrants, useScopeCatalog, type ScopeCatalog, type ScopeChoice } from './access-scopes';

/** Catalog key describing where an effective permission comes from. */
const ACCESS_SOURCE_KEYS = {
  'role:owner': 'access.source.owner',
  'role:admin': 'access.source.admin',
  'role:scheduler_legacy': 'access.source.schedulerLegacy',
  'grant:folder': 'access.source.folderGrant',
  grant: 'access.source.grant',
} as const satisfies Record<EffectiveAccessEntry['source'], string>;

interface SchedulerModeProps {
  member: AccessMember;
}

/** Church-wide vs only-granted-areas for a scheduler. */
const SchedulerMode = ({ member }: SchedulerModeProps) => {
  const { t } = useTranslation('settings');
  const invalidate = useInvalidateOrg();
  const setMode = useMutation({
    mutationFn: (mode: AccessMode) => api.updateMemberAccess(member.user_id, { access_mode: mode }),
    onSuccess: invalidate,
  });
  const items: TabItem<AccessMode>[] = [
    { value: 'legacy', label: t('access.mode.legacy') },
    { value: 'scoped', label: t('access.mode.scoped') },
  ];

  return (
    <div className="space-y-2">
      <Segmented
        label={t('access.schedulerAccessFor', { name: member.full_name ?? '' })}
        items={items}
        value={member.access_mode}
        onChange={(mode) => setMode.mutate(mode)}
      />
      <p className="text-xs text-slate-500">{t(`memberAccess.modeHint.${member.access_mode}`)}</p>
      <ErrorNotice error={setMode.error} />
    </div>
  );
};

interface AddPermissionProps {
  member: AccessMember;
  catalog: ScopeCatalog;
  onAdd: (change: MemberGrantChange) => void;
  pending: boolean;
}

/** Pick a place, then a permission that can be granted there. */
const AddPermission = ({ member, catalog, onAdd, pending }: AddPermissionProps) => {
  const { t } = useTranslation('settings');
  const [where, setWhere] = useState(catalog.organization.key);
  const scope = catalog.byKey.get(where) ?? catalog.organization;
  const capabilities = capabilitiesForScope(scope.scopeType);
  const [capability, setCapability] = useState<AccessCapability>(capabilities[0] ?? 'scheduling.manage');
  const chosen = capabilities.includes(capability) ? capability : (capabilities[0] ?? 'scheduling.manage');
  const alreadyHeld = member.grants.some(
    (grant) => scopeKey(scopeOfGrant(grant)) === scope.key && grant.capability === chosen,
  );

  const groups: Array<{ label: string; choices: ScopeChoice[] }> = [
    { label: t('memberAccess.groups.folders'), choices: catalog.folders },
    { label: t('memberAccess.groups.serviceTypes'), choices: catalog.serviceTypes },
    { label: t('memberAccess.groups.teams'), choices: catalog.teams },
  ];

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="member-access-where">{t('memberAccess.where')}</label>
          <select id="member-access-where" className="input" value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value={catalog.organization.key}>{catalog.organization.name}</option>
            {groups
              .filter((group) => group.choices.length > 0)
              .map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.choices.map((choice) => (
                    <option key={choice.key} value={choice.key}>
                      {choice.name}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="member-access-capability">{t('access.permission')}</label>
          <select
            id="member-access-capability"
            className="input"
            value={chosen}
            onChange={(e) => setCapability(e.target.value as AccessCapability)}
          >
            {capabilities.map((value) => (
              <option key={value} value={value}>
                {t(`capabilities.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{alreadyHeld ? t('scopeAccess.alreadyHeld') : null}</p>
        <Button
          icon="plus"
          disabled={alreadyHeld}
          loading={pending}
          onClick={() =>
            onAdd({ userId: member.user_id, capability: chosen, scopeType: scope.scopeType, scopeId: scope.scopeId })
          }
        >
          {t('scopeAccess.grant')}
        </Button>
      </div>
    </div>
  );
};

interface AccessCheckProps {
  userId: string;
}

/** "Can they…?" — the database's own answer, with its reasons. */
const AccessCheck = ({ userId }: AccessCheckProps) => {
  const { t } = useTranslation('settings');
  const serviceTypes = useServiceTypes();
  const teams = useTeams();
  const [capability, setCapability] = useState<AccessCapability>('scheduling.manage');
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [teamId, setTeamId] = useState('');

  const explain = useMutation({
    mutationFn: (): Promise<CapabilityExplanation> =>
      api.explainAccess({
        user_id: userId,
        capability,
        ...(serviceTypeId ? { service_type_id: serviceTypeId } : {}),
        ...(teamId ? { team_id: teamId } : {}),
      }),
  });
  const result = explain.data;
  // A new question clears the previous answer.
  const reset = () => explain.reset();

  return (
    <div className="space-y-2">
      <div>
        <label className="label" htmlFor="member-access-check">{t('memberAccess.checkWhat')}</label>
        <select
          id="member-access-check"
          className="input"
          value={capability}
          onChange={(e) => {
            setCapability(e.target.value as AccessCapability);
            reset();
          }}
        >
          {ACCESS_CAPABILITIES.map((value) => (
            <option key={value} value={value}>
              {t(`capabilities.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          aria-label={t('access.serviceType')}
          className="input"
          value={serviceTypeId}
          onChange={(e) => {
            setServiceTypeId(e.target.value);
            reset();
          }}
        >
          <option value="">{t('access.anyServiceType')}</option>
          {(serviceTypes.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('access.team')}
          className="input"
          value={teamId}
          onChange={(e) => {
            setTeamId(e.target.value);
            reset();
          }}
        >
          <option value="">{t('access.anyTeam')}</option>
          {(teams.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <Button variant="secondary" loading={explain.isPending} onClick={() => explain.mutate()}>
        {t('access.checkAccess')}
      </Button>
      <ErrorNotice error={explain.error} />
      {result && (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm ring-1 ring-inset ${
            result.allowed
              ? 'bg-emerald-50 ring-emerald-600/20 dark:bg-emerald-500/10'
              : 'bg-rose-50 ring-rose-600/20 dark:bg-rose-500/10'
          }`}
        >
          <p className="flex items-center gap-1.5 font-medium">
            <Icon name={result.allowed ? 'check' : 'close'} className="size-4" />
            {result.allowed ? t('access.allowed') : t('access.notAllowed')}
          </p>
          {result.allowed ? (
            <ul className="mt-1 list-disc pl-5 text-slate-600 dark:text-slate-300">
              {result.reasons.map((reason, index) => (
                <li key={`${reason.source}-${reason.scope_id ?? index}`}>
                  {t('access.reason', { source: t(ACCESS_SOURCE_KEYS[reason.source]), scope: t(`scopeType.${reason.scope_type}`) })}
                </li>
              ))}
            </ul>
          ) : (
            result.denial && <p className="mt-1 text-slate-600 dark:text-slate-300">{t(`access.denial.${result.denial}`)}</p>
          )}
        </div>
      )}
    </div>
  );
};

interface PanelSectionProps {
  title: string;
  children: ReactNode;
}

const PanelSection = ({ title, children }: PanelSectionProps) => (
  <section className="space-y-3">
    <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
    {children}
  </section>
);

export interface MemberAccessPanelProps {
  /** The member to show; null closes the panel. */
  userId: string | null;
  onClose: () => void;
}

/**
 * Everything one member can do, in one place: their role, scheduler mode,
 * every grant at every scope, and a live "can they…?" check.
 */
export const MemberAccessPanel = ({ userId, onClose }: MemberAccessPanelProps) => {
  const { t } = useTranslation(['settings', 'common']);
  const members = useAccessMembers();
  const catalog = useScopeCatalog();
  const invalidate = useInvalidateOrg();
  const member = members.data?.find((entry) => entry.user_id === userId) ?? null;

  const change = useMutation({
    mutationFn: ({ kind, grant }: { kind: GrantChangeKind; grant: MemberGrantChange }) => changeMemberGrant(kind, grant),
    onSuccess: invalidate,
  });

  if (!member) return null;
  const name = member.full_name ?? t('common:fallback.unnamed');
  const groups = groupGrants(member, catalog, t('memberAccess.unknownPlace'));
  const fullAccess = member.role === 'owner' || member.role === 'admin';

  return (
    <Modal open title={name} onClose={onClose} size="side">
      <div className="space-y-7">
        <div className="flex items-center gap-3">
          <Avatar name={member.full_name} url={member.avatar_url} size="lg" />
          <div className="min-w-0">
            <Badge tone={ROLE_TONES[member.role]}>{t(`common:roles.${member.role}`)}</Badge>
            <p className="mt-1 text-sm text-slate-500">{t(`memberAccess.roleHint.${member.role}`)}</p>
          </div>
        </div>

        {fullAccess && <Notice>{t('memberAccess.fullAccess')}</Notice>}
        {member.role === 'scheduler' && (
          <PanelSection title={t('memberAccess.schedulingScope')}>
            <SchedulerMode member={member} />
          </PanelSection>
        )}

        <PanelSection title={t('memberAccess.permissions')}>
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-app-border px-4 py-3 text-sm text-slate-500">
              {t('memberAccess.noPermissions')}
            </p>
          ) : (
            <ul className="divide-y divide-app-border rounded-xl border border-app-border">
              {groups.map((group) => (
                <li key={group.key} className="space-y-1.5 px-3 py-2.5">
                  <p className="text-xs text-slate-500">
                    {group.scopeType === 'organization'
                      ? group.name
                      : t('memberAccess.scopeLabel', { type: t(`memberAccess.scopeTypes.${group.scopeType}`), name: group.name })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.capabilities.map((held) => (
                      <span
                        key={held}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/25"
                      >
                        {t(`capabilities.${held}`)}
                        <button
                          type="button"
                          className="rounded-full p-0.5 hover:bg-brand-100 disabled:opacity-50 dark:hover:bg-brand-500/25"
                          aria-label={t('scopeAccess.removeLabel', { permission: t(`capabilities.${held}`), name })}
                          disabled={change.isPending}
                          onClick={() =>
                            change.mutate({
                              kind: 'remove',
                              grant: { userId: member.user_id, capability: held, scopeType: group.scopeType, scopeId: group.scopeId },
                            })
                          }
                        >
                          <Icon name="close" className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ErrorNotice error={change.error} />
        </PanelSection>

        <PanelSection title={t('memberAccess.addPermission')}>
          <AddPermission
            key={member.user_id}
            member={member}
            catalog={catalog}
            pending={change.isPending}
            onAdd={(grant) => change.mutate({ kind: 'add', grant })}
          />
        </PanelSection>

        <PanelSection title={t('memberAccess.check', { name })}>
          <AccessCheck key={member.user_id} userId={member.user_id} />
        </PanelSection>
      </div>
    </Modal>
  );
};
