import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PlanTemplateNeed, PlanTemplateRosterEntry, RosterPerson, TeamWithPositions } from '@service-center/shared';
import { Button } from '../ui';
import { SearchCombobox } from '../SearchCombobox';
import { replacementCandidates, type ReplacementCandidateLabels } from '../plan/replacementCandidates';

/** A team's usual positions: plan-only positions never go into a template. */
const usualPositions = (team: TeamWithPositions | undefined) => (team?.positions ?? []).filter((position) => position.plan_id === null);

interface TeamSelectProps {
  id: string;
  teams: readonly TeamWithPositions[];
  value: string;
  onChange: (teamId: string) => void;
}

const TeamSelect = ({ id, teams, value, onChange }: TeamSelectProps) => {
  const { t } = useTranslation('templates');
  return (
    <div>
      <label className="label" htmlFor={id}>{t('staffing.team')}</label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t('staffing.chooseTeam')}</option>
        {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select>
    </div>
  );
};

export interface TemplateNeedFormProps {
  teams: readonly TeamWithPositions[];
  /** Needs already in the draft; their positions cannot be added twice. */
  needs: readonly PlanTemplateNeed[];
  onAdd: (need: PlanTemplateNeed) => void;
}

/** Adds one needed position (team → position → how many) to the draft. */
export const TemplateNeedForm = ({ teams, needs, onAdd }: TemplateNeedFormProps) => {
  const { t } = useTranslation('templates');
  const [teamId, setTeamId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [needed, setNeeded] = useState(1);
  const team = teams.find((candidate) => candidate.id === teamId);
  const listed = new Set(needs.map((need) => need.position_id));
  const valid = Boolean(positionId) && !listed.has(positionId) && Number.isInteger(needed) && needed >= 1 && needed <= 99;

  return (
    // Team and position share a row (like the roster form), so "Choose a position" is never cut off.
    <div className="surface-inset space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TeamSelect id="template-need-team" teams={teams} value={teamId} onChange={(next) => { setTeamId(next); setPositionId(''); }} />
        <div>
          <label className="label" htmlFor="template-need-position">{t('staffing.position')}</label>
          <select id="template-need-position" className="input" value={positionId} disabled={!team} onChange={(event) => setPositionId(event.target.value)}>
            <option value="">{t('staffing.choosePosition')}</option>
            {usualPositions(team).map((position) => (
              <option key={position.id} value={position.id} disabled={listed.has(position.id)}>
                {listed.has(position.id) ? t('staffing.alreadyListed', { position: position.name }) : position.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-28">
          <label className="label" htmlFor="template-need-count">{t('staffing.count')}</label>
          <input id="template-need-count" type="number" min={1} max={99} className="input" value={needed} onChange={(event) => setNeeded(Number(event.target.value))} />
        </div>
        <Button
          type="button"
          variant="secondary"
          icon="plus"
          disabled={!valid}
          onClick={() => {
            onAdd({ position_id: positionId, needed });
            setPositionId('');
            setNeeded(1);
          }}
        >
          {t('staffing.addNeed')}
        </Button>
      </div>
    </div>
  );
};

export interface TemplateRosterFormProps {
  teams: readonly TeamWithPositions[];
  /** Active roster the person picker offers (archived people are left out). */
  people: readonly RosterPerson[];
  roster: readonly PlanTemplateRosterEntry[];
  onAdd: (entry: PlanTemplateRosterEntry) => void;
}

/**
 * Adds one roster entry (team, optional position, person). The person
 * picker is the plan's: everyone on the roster, the team's members first.
 */
export const TemplateRosterForm = ({ teams, people, roster, onAdd }: TemplateRosterFormProps) => {
  const { t } = useTranslation(['templates', 'common']);
  const [teamId, setTeamId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [personId, setPersonId] = useState('');
  const team = teams.find((candidate) => candidate.id === teamId);
  const labels = useMemo<ReplacementCandidateLabels>(() => ({ unnamed: t('common:fallback.unnamed'), onThisPlan: t('staffing.inTemplate') }), [t]);
  const choices = useMemo(
    () => replacementCandidates({ request: { team_id: teamId, position_id: positionId }, roster: people, teams, assignments: [], labels }),
    [teamId, positionId, people, teams, labels],
  );
  const duplicate = roster.some(
    (entry) => entry.person_id === personId && entry.team_id === teamId && entry.position_id === (positionId || null),
  );

  return (
    <div className="surface-inset space-y-3 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TeamSelect id="template-roster-team" teams={teams} value={teamId} onChange={(next) => { setTeamId(next); setPositionId(''); }} />
        <div>
          <label className="label" htmlFor="template-roster-position">{t('staffing.position')}</label>
          <select id="template-roster-position" className="input" value={positionId} disabled={!team} onChange={(event) => setPositionId(event.target.value)}>
            <option value="">{t('names.anyPosition')}</option>
            {usualPositions(team).map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <SearchCombobox
            label={t('staffing.person')}
            value={personId}
            onChange={setPersonId}
            options={choices.options}
            suggested={choices.suggested}
            suggestedLabel={team ? t('staffing.teamMembers', { team: team.name }) : undefined}
            restLabel={t('staffing.everyone')}
            placeholder={t('staffing.searchPerson')}
            disabled={!team}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          icon="plus"
          disabled={!team || !personId || duplicate}
          onClick={() => {
            onAdd({ person_id: personId, team_id: teamId, position_id: positionId || null });
            setPersonId('');
          }}
        >
          {t('staffing.addPerson')}
        </Button>
      </div>
      {duplicate && <p className="text-xs text-amber-700 dark:text-amber-300">{t('staffing.duplicateEntry')}</p>}
    </div>
  );
};
