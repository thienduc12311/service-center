import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ACCESS_CAPABILITIES,
  type AccessCapability,
  type AccessMode,
  type CapabilityExplanation,
  type EffectiveAccessEntry,
  type OrganizationRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useAccessMembers, useServiceTypes, useTeams, useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';
import { useFormatters } from '../../i18n';
import { ScopeAccessEditor } from './ScopeAccessEditor';
import { FolderSettings } from './FolderSettings';

const ACCESS_MODES: readonly AccessMode[] = ['legacy', 'scoped'];

/** Catalog key describing where an effective permission comes from. */
const ACCESS_SOURCE_KEYS = {
  'role:owner': 'access.source.owner',
  'role:admin': 'access.source.admin',
  'role:scheduler_legacy': 'access.source.schedulerLegacy',
  'grant:folder': 'access.source.folderGrant',
  grant: 'access.source.grant',
} as const satisfies Record<EffectiveAccessEntry['source'], string>;

/** Reviews one member's access to one thing, with the database's reasons. */
const ExplainAccess = () => {
  const { t } = useTranslation(['settings', 'common']);
  const members = useAccessMembers();
  const serviceTypes = useServiceTypes();
  const teams = useTeams();
  const [userId, setUserId] = useState('');
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

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select aria-label={t('access.member')} className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t('access.chooseMember')}</option>
          {(members.data ?? []).map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.full_name ?? t('common:fallback.unnamed')}
            </option>
          ))}
        </select>
        <select
          aria-label={t('access.permission')}
          className="input"
          value={capability}
          onChange={(e) => setCapability(e.target.value as AccessCapability)}
        >
          {ACCESS_CAPABILITIES.map((value) => (
            <option key={value} value={value}>
              {t(`capabilities.${value}`)}
            </option>
          ))}
        </select>
        <select aria-label={t('access.serviceType')} className="input" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
          <option value="">{t('access.anyServiceType')}</option>
          {(serviceTypes.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <select aria-label={t('access.team')} className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">{t('access.anyTeam')}</option>
          {(teams.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <Button variant="secondary" disabled={!userId} loading={explain.isPending} onClick={() => explain.mutate()}>
        {t('access.checkAccess')}
      </Button>
      <ErrorNotice error={explain.error} />
      {result && (
        <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">{result.allowed ? t('access.allowed') : t('access.notAllowed')}</p>
          {result.allowed ? (
            <ul className="mt-1 list-disc pl-5 text-slate-600">
              {result.reasons.map((reason, index) => (
                <li key={`${reason.source}-${reason.scope_id ?? index}`}>
                  {t('access.reason', { source: t(ACCESS_SOURCE_KEYS[reason.source]), scope: t(`scopeType.${reason.scope_type}`) })}
                </li>
              ))}
            </ul>
          ) : (
            result.denial && <p className="mt-1 text-slate-600">{t(`access.denial.${result.denial}`)}</p>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * F01 administration: who may do what, at which scope. Owners and admins
 * always have everything; schedulers keep organization-wide access until
 * they are switched to "Only granted areas".
 */
export const AccessSettings = ({ organization }: { organization: OrganizationRow | null }) => {
  const { t } = useTranslation(['settings', 'common']);
  const { list } = useFormatters();
  const invalidate = useInvalidateOrg();
  const members = useAccessMembers();

  const setMode = useMutation({
    mutationFn: ({ userId, mode }: { userId: string; mode: AccessMode }) =>
      api.updateMemberAccess(userId, { access_mode: mode }),
    onSuccess: invalidate,
  });
  const setRoster = useMutation({
    mutationFn: (restricted: boolean) =>
      api.setRosterVisibility({ assignment_visibility: restricted ? 'teams' : 'organization' }),
    onSuccess: invalidate,
  });
  const [rosterRestricted, setRosterRestricted] = useState(organization?.assignment_visibility === 'teams');

  return (
    <section className="card space-y-6 p-5">
      <div>
        <h2 className="font-semibold">{t('access.title')}</h2>
        <p className="text-sm text-slate-500">{t('access.description')}</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('access.members')}</h3>
        <ErrorNotice error={members.error ?? setMode.error} />
        {members.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(members.data ?? []).map((member) => (
              <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{member.full_name ?? t('common:fallback.unnamed')}</p>
                  <p className="text-xs text-slate-500">
                    {member.grants.length === 0
                      ? t('access.noExtraGrants')
                      : list(member.grants.map((grant) => t(`capabilities.${grant.capability}`)))}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{t(`common:roles.${member.role}`)}</Badge>
                  {member.role === 'scheduler' && (
                    <select
                      aria-label={t('access.schedulerAccessFor', { name: member.full_name ?? t('common:fallback.unnamed') })}
                      className="input w-48"
                      value={member.access_mode}
                      onChange={(e) => setMode.mutate({ userId: member.user_id, mode: e.target.value as AccessMode })}
                    >
                      {ACCESS_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {t(`access.mode.${mode}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('access.organizationWide')}</h3>
        <ScopeAccessEditor
          scopeType="organization"
          scopeId={null}
          scopeName={t('access.wholeOrganization')}
          load={() => api.organizationAccess()}
          save={(input) => api.replaceOrganizationAccess(input)}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t('access.explainTitle')}</h3>
        <ExplainAccess />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">{t('access.rosters.title')}</h3>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-slate-300"
            checked={rosterRestricted}
            onChange={(e) => {
              setRosterRestricted(e.target.checked);
              setRoster.mutate(e.target.checked);
            }}
          />
          <span>
            {t('access.rosters.restrict')}
            <span className="block text-xs text-slate-500">{t('access.rosters.restrictHint')}</span>

          </span>
        </label>
        <ErrorNotice error={setRoster.error} />
      </div>

      <FolderSettings />
    </section>
  );
};
