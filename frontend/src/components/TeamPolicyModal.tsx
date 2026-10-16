import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AssignmentVisibility, TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Spinner } from './ui';
import { ScopeAccessEditor } from './settings/ScopeAccessEditor';

export interface TeamPolicyModalProps {
  team: TeamWithPositions;
  onClose: () => void;
}

const splitTags = (value: string): string[] =>
  value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);

/**
 * Leaders and team policies (F01): who leads the team (administrators), how
 * new requests start, secure-team eligibility, tag-derived candidates and
 * which other teams may see this roster when rosters are restricted.
 */
export const TeamPolicyModal = ({ team, onClose }: TeamPolicyModalProps) => {
  const { organizationId, access, can } = useAuth();
  const invalidate = useInvalidateOrg();
  const allTeams = useTeams();
  const canEdit = can('teams.manage', { serviceTypeId: team.service_type_id, teamId: team.id });

  const policies = useQuery({
    queryKey: [...keys.teams(organizationId), team.id, 'policies'],
    queryFn: () => api.teamPolicies(team.id),
  });

  const [visibility, setVisibility] = useState<AssignmentVisibility>(team.default_visibility);
  const [secure, setSecure] = useState(team.requires_eligibility);
  const [kind, setKind] = useState(team.eligibility_kind ?? 'background_check');
  const [tags, setTags] = useState('');
  const [viewers, setViewers] = useState<string[]>([]);

  useEffect(() => {
    if (!policies.data) return;
    setTags(policies.data.tag_rules.join(', '));
    setViewers(policies.data.related_team_ids);
  }, [policies.data]);

  const save = useMutation({
    mutationFn: async () => {
      await api.updateTeam(team.id, {
        default_visibility: visibility,
        requires_eligibility: secure,
        eligibility_kind: secure ? kind.trim() : null,
      });
      await api.replaceTeamTagRules(team.id, splitTags(tags));
      await api.replaceRelatedTeams(team.id, viewers);
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  return (
    <Modal open title={`${team.name} settings`} onClose={onClose}>
      <div className="space-y-6">
        {access?.can_administer_access && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">Leaders</h3>
            <p className="mb-2 text-xs text-slate-500">
              Team leaders can schedule and manage {team.name} only — not other teams, plan order or the song library.
            </p>
            <ScopeAccessEditor
              scopeType="team"
              scopeId={team.id}
              scopeName={team.name}
              load={() => api.teamAccess(team.id)}
              save={(input) => api.replaceTeamAccess(team.id, input)}
            />
          </section>
        )}

        {policies.isLoading ? (
          <Spinner />
        ) : (
          <fieldset disabled={!canEdit} className="space-y-4">
            <div>
              <label className="label" htmlFor="team-default-visibility">New requests</label>
              <select
                id="team-default-visibility"
                className="input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as AssignmentVisibility)}
              >
                <option value="released">Sent when scheduled</option>
                <option value="prepared">Prepared privately until released</option>
              </select>
            </div>

            <div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 rounded border-slate-300"
                  checked={secure}
                  onChange={(e) => setSecure(e.target.checked)}
                />
                <span>
                  Secure team
                  <span className="block text-xs text-slate-500">
                    People need a current eligibility record (for example a background check) before they can be added
                    or scheduled. Missing or expired records block them.
                  </span>
                </span>
              </label>
              {secure && (
                <input
                  aria-label="Required eligibility"
                  className="input mt-2"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                />
              )}
            </div>

            <div>
              <label className="label" htmlFor="team-tag-rules">Suggest people tagged</label>
              <input
                id="team-tag-rules"
                className="input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="camera, sound"
              />
              <p className="mt-1 text-xs text-slate-400">Comma separated. Changes future suggestions only.</p>
            </div>

            <div>
              <p className="label">Teams that can see this roster</p>
              <p className="mb-1 text-xs text-slate-400">Only matters when rosters are limited to teams (Settings → Access).</p>
              <div className="grid gap-1 sm:grid-cols-2">
                {(allTeams.data ?? [])
                  .filter((other) => other.id !== team.id)
                  .map((other) => (
                    <label key={other.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300"
                        checked={viewers.includes(other.id)}
                        onChange={(e) =>
                          setViewers((current) =>
                            e.target.checked ? [...current, other.id] : current.filter((id) => id !== other.id),
                          )
                        }
                      />
                      {other.name}
                    </label>
                  ))}
              </div>
            </div>
          </fieldset>
        )}

        <ErrorNotice error={policies.error ?? save.error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canEdit && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
