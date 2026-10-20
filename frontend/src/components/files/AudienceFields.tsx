import { useTranslation } from 'react-i18next';
import {
  fileAudiencesFor,
  type FileAudience,
  type FileOwnerKind,
} from '@service-center/shared';
import { useTeams } from '../../hooks/queries';

/** The audience part of a file form; teams/positions only when that audience is chosen. */
export interface FileAudienceValue {
  audience: FileAudience;
  teamIds: string[];
  positionIds: string[];
}

export interface AudienceFieldsProps {
  ownerKind: FileOwnerKind;
  value: FileAudienceValue;
  onChange: (value: FileAudienceValue) => void;
  /** Plan-only positions of this plan may be chosen too. */
  planId?: string | null;
}

const toggle = (list: string[], id: string): string[] =>
  list.includes(id) ? list.filter((value) => value !== id) : [...list, id];

export const AudienceFields = ({ ownerKind, value, onChange, planId = null }: AudienceFieldsProps) => {
  const { t } = useTranslation('media');
  const teams = useTeams();
  const audiences = fileAudiencesFor(ownerKind);

  return (
    <fieldset className="space-y-3">
      <legend className="label">{t('audience.legend')}</legend>
      <select
        className="input"
        value={value.audience}
        onChange={(event) => onChange({ ...value, audience: event.target.value as FileAudience })}
      >
        {audiences.map((audience) => (
          <option key={audience} value={audience}>
            {t(`files.audiences.${audience}`)}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">
        {ownerKind === 'song' || ownerKind === 'arrangement' ? t('audience.songLeaders') : t('audience.planLeaders')}
        {value.audience === 'scheduled' ? ` ${t('audience.scheduledHint')}` : ''}
      </p>

      {value.audience === 'teams' && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg p-2 ring-1 ring-slate-200">
          {teams.isLoading && <p className="text-sm text-slate-500">{t('audience.loadingTeams')}</p>}
          {(teams.data ?? []).map((team) => (
            <label key={team.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.teamIds.includes(team.id)}
                onChange={() => onChange({ ...value, teamIds: toggle(value.teamIds, team.id) })}
              />
              {team.name}
            </label>
          ))}
        </div>
      )}

      {value.audience === 'positions' && (
        <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg p-2 ring-1 ring-slate-200">
          {teams.isLoading && <p className="text-sm text-slate-500">{t('audience.loadingPositions')}</p>}
          {(teams.data ?? []).map((team) => {
            const positions = team.positions.filter((position) => position.plan_id === null || position.plan_id === planId);
            if (!positions.length) return null;
            return (
              <div key={team.id}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{team.name}</p>
                {positions.map((position) => (
                  <label key={position.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value.positionIds.includes(position.id)}
                      onChange={() => onChange({ ...value, positionIds: toggle(value.positionIds, position.id) })}
                    />
                    {position.name}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
};
