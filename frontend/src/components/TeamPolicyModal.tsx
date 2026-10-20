import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { AssignmentVisibility, TeamWithPositions } from '@service-center/shared';
import { api } from '../lib/api';
import { keys, useTeams, useInvalidateOrg } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, ErrorNotice, Modal, Spinner } from './ui';
import { ScopeAccessEditor } from './settings/ScopeAccessEditor';
import { ReminderPolicyEditor } from './settings/ReminderPolicyEditor';

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
  const { t } = useTranslation(['teams', 'common']);
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
    <Modal open title={t('teamPolicy.title', { team: team.name })} onClose={onClose}>
      <div className="space-y-6">
        {access?.can_administer_access && (
          <section>
            <h3 className="mb-1 text-sm font-semibold">{t('teamPolicy.leaders.title')}</h3>
            <p className="mb-2 text-xs text-slate-500">
              {t('teamPolicy.leaders.description', { team: team.name })}
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
              <label className="label" htmlFor="team-default-visibility">{t('teamPolicy.newRequests')}</label>
              <select
                id="team-default-visibility"
                className="input"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as AssignmentVisibility)}
              >
                <option value="released">{t('teamPolicy.visibility.released')}</option>
                <option value="prepared">{t('teamPolicy.visibility.prepared')}</option>
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
                  {t('teamPolicy.secure.label')}
                  <span className="block text-xs text-slate-500">
                    {t('teamPolicy.secure.description')}
                  </span>
                </span>
              </label>
              {secure && (
                <input
                  aria-label={t('teamPolicy.secure.requiredEligibility')}
                  className="input mt-2"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                />
              )}
            </div>

            <div>
              <label className="label" htmlFor="team-tag-rules">{t('teamPolicy.tagRules.label')}</label>
              <input
                id="team-tag-rules"
                className="input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t('teamPolicy.tagRules.placeholder')}
              />
              <p className="mt-1 text-xs text-slate-400">{t('teamPolicy.tagRules.hint')}</p>
            </div>

            <div>
              <p className="label">{t('teamPolicy.viewers.label')}</p>
              <p className="mb-1 text-xs text-slate-400">{t('teamPolicy.viewers.hint')}</p>
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

        <section aria-labelledby="team-reminders-heading" className="space-y-2">
          <h3 id="team-reminders-heading" className="text-sm font-medium">{t('teamPolicy.reminders.title')}</h3>
          <p className="text-sm text-slate-500">{t('teamPolicy.reminders.description')}</p>
          <ReminderPolicyEditor teamId={team.id} scopeLabel={t('teamPolicy.reminders.scope')} />
        </section>

        <ErrorNotice error={policies.error ?? save.error} />

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
          {canEdit && (
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common:actions.save')}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
