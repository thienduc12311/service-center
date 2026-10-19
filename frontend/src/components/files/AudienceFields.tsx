import {
  FILE_AUDIENCE_LABELS,
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
  const teams = useTeams();
  const audiences = fileAudiencesFor(ownerKind);

  return (
    <fieldset className="space-y-3">
      <legend className="label">Who can open it</legend>
      <select
        className="input"
        value={value.audience}
        onChange={(event) => onChange({ ...value, audience: event.target.value as FileAudience })}
      >
        {audiences.map((audience) => (
          <option key={audience} value={audience}>
            {FILE_AUDIENCE_LABELS[audience]}
          </option>
        ))}
      </select>
      <p className="text-xs text-slate-500">
        Leaders of this {ownerKind === 'song' || ownerKind === 'arrangement' ? 'song library' : 'plan'} can always open
        it. {value.audience === 'scheduled' ? 'Only people whose request has been sent count — prepared requests do not.' : ''}
      </p>

      {value.audience === 'teams' && (
        <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg p-2 ring-1 ring-slate-200">
          {teams.isLoading && <p className="text-sm text-slate-500">Loading teams…</p>}
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
          {teams.isLoading && <p className="text-sm text-slate-500">Loading positions…</p>}
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
