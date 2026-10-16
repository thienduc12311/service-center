import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  ACCESS_CAPABILITIES,
  ACCESS_CAPABILITY_LABELS,
  ACCESS_DENIAL_LABELS,
  describeAccessSource,
  type AccessCapability,
  type AccessMode,
  type CapabilityExplanation,
  type OrganizationRow,
} from '@service-center/shared';
import { api } from '../../lib/api';
import { useAccessMembers, useServiceTypes, useTeams, useInvalidateOrg } from '../../hooks/queries';
import { Badge, Button, ErrorNotice, Spinner } from '../ui';
import { ScopeAccessEditor } from './ScopeAccessEditor';
import { FolderSettings } from './FolderSettings';

const MODE_LABELS: Record<AccessMode, string> = {
  legacy: 'Organization-wide',
  scoped: 'Only granted areas',
};

/** Reviews one member's access to one thing, with the database's reasons. */
const ExplainAccess = () => {
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
        <select aria-label="Member" className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Choose a member</option>
          {(members.data ?? []).map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.full_name ?? 'Unnamed'}
            </option>
          ))}
        </select>
        <select
          aria-label="Permission"
          className="input"
          value={capability}
          onChange={(e) => setCapability(e.target.value as AccessCapability)}
        >
          {ACCESS_CAPABILITIES.map((value) => (
            <option key={value} value={value}>
              {ACCESS_CAPABILITY_LABELS[value]}
            </option>
          ))}
        </select>
        <select aria-label="Service type" className="input" value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
          <option value="">Any service type</option>
          {(serviceTypes.data ?? []).map((type) => (
            <option key={type.id} value={type.id}>
              {type.name}
            </option>
          ))}
        </select>
        <select aria-label="Team" className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Any team</option>
          {(teams.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <Button variant="secondary" disabled={!userId} loading={explain.isPending} onClick={() => explain.mutate()}>
        Check access
      </Button>
      <ErrorNotice error={explain.error} />
      {result && (
        <div role="status" className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="font-medium">{result.allowed ? 'Allowed' : 'Not allowed'}</p>
          {result.allowed ? (
            <ul className="mt-1 list-disc pl-5 text-slate-600">
              {result.reasons.map((reason, index) => (
                <li key={`${reason.source}-${reason.scope_id ?? index}`}>
                  {describeAccessSource(reason.source)} ({reason.scope_type.replace('_', ' ')})
                </li>
              ))}
            </ul>
          ) : (
            result.denial && <p className="mt-1 text-slate-600">{ACCESS_DENIAL_LABELS[result.denial]}</p>
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
        <h2 className="font-semibold">Access</h2>
        <p className="text-sm text-slate-500">
          Give leaders exactly the areas they run. Team leaders are set on the Teams page; library and directory
          permissions are organization-wide.
        </p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Members</h3>
        <ErrorNotice error={members.error ?? setMode.error} />
        {members.isLoading ? (
          <Spinner />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {(members.data ?? []).map((member) => (
              <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">{member.full_name ?? 'Unnamed'}</p>
                  <p className="text-xs text-slate-500">
                    {member.grants.length === 0
                      ? 'No extra grants'
                      : member.grants.map((grant) => ACCESS_CAPABILITY_LABELS[grant.capability]).join(', ')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{member.role}</Badge>
                  {member.role === 'scheduler' && (
                    <select
                      aria-label={`Scheduler access for ${member.full_name ?? 'member'}`}
                      className="input w-48"
                      value={member.access_mode}
                      onChange={(e) => setMode.mutate({ userId: member.user_id, mode: e.target.value as AccessMode })}
                    >
                      {(Object.keys(MODE_LABELS) as AccessMode[]).map((mode) => (
                        <option key={mode} value={mode}>
                          {MODE_LABELS[mode]}
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
        <h3 className="mb-2 text-sm font-semibold">Organization-wide permissions</h3>
        <ScopeAccessEditor
          scopeType="organization"
          scopeId={null}
          scopeName="the whole organization"
          load={() => api.organizationAccess()}
          save={(input) => api.replaceOrganizationAccess(input)}
        />
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Why can (or can’t) someone do something?</h3>
        <ExplainAccess />
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Team rosters</h3>
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
            Members see only their own teams’ rosters
            <span className="block text-xs text-slate-500">
              Plus teams a team’s leaders open up to them. Leaders and schedulers still see every roster.
            </span>
          </span>
        </label>
        <ErrorNotice error={setRoster.error} />
      </div>

      <FolderSettings />
    </section>
  );
};
