import { useMemo } from 'react';
import {
  formatDateTime,
  PROPOSAL_FRESHNESS_CODES,
  proposalExclusionLabel,
  type ProposalChoice,
  type ProposalExclusionCode,
  type ProposalVacancy,
  type StaffingProposal,
  type StaffingProposalEdits,
} from '@service-center/shared';
import { Badge, Button } from '../ui';

export interface ProposalReviewProps {
  proposal: StaffingProposal;
  busy: boolean;
  /** Sends the whole new edit set; the server recomputes on the same snapshot. */
  onEdit: (edits: StaffingProposalEdits) => void;
}

interface PositionGroup {
  key: string;
  planId: string;
  teamId: string;
  positionId: string;
  choices: ProposalChoice[];
  vacancies: ProposalVacancy[];
}

const SOURCE_LABEL: Record<ProposalChoice['source'], string> = {
  existing: 'Kept',
  locked: 'Locked',
  rotation: 'Rotation',
  fairness: 'Suggested',
};
const SOURCE_TONE: Record<ProposalChoice['source'], string> = {
  existing: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  locked: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  rotation: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  fairness: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
};

const sameSlot = (a: { plan_id: string; position_id: string; person_id: string }, b: typeof a): boolean =>
  a.plan_id === b.plan_id && a.position_id === b.position_id && a.person_id === b.person_id;

const exclusionSummary = (counts: Partial<Record<ProposalExclusionCode, number>>): string =>
  Object.entries(counts).map(([code, count]) => `${count} ${proposalExclusionLabel(code as ProposalExclusionCode)}`).join(' · ');

export const ProposalReview = ({ proposal, busy, onEdit }: ProposalReviewProps) => {
  const editable = proposal.status === 'draft' && !proposal.expired;
  const groups = useMemo(() => {
    const map = new Map<string, PositionGroup>();
    const add = (planId: string, teamId: string, positionId: string): PositionGroup => {
      const key = `${planId}:${positionId}`;
      const existing = map.get(key);
      if (existing) return existing;
      const group: PositionGroup = { key, planId, teamId, positionId, choices: [], vacancies: [] };
      map.set(key, group);
      return group;
    };
    for (const choice of proposal.result.choices) add(choice.plan_id, choice.team_id, choice.position_id).choices.push(choice);
    for (const vacancy of proposal.result.vacancies) add(vacancy.plan_id, vacancy.team_id, vacancy.position_id).vacancies.push(vacancy);
    return [...map.values()];
  }, [proposal.result]);

  const lock = (choice: ProposalChoice) => onEdit({
    locks: [...proposal.edits.locks, { plan_id: choice.plan_id, position_id: choice.position_id, person_id: choice.person_id }],
    exclusions: proposal.edits.exclusions.filter((item) => !sameSlot(item, choice)),
  });
  const unlock = (choice: ProposalChoice) => onEdit({
    locks: proposal.edits.locks.filter((item) => !sameSlot(item, choice)), exclusions: proposal.edits.exclusions,
  });
  const exclude = (choice: ProposalChoice) => onEdit({
    locks: proposal.edits.locks.filter((item) => !sameSlot(item, choice)),
    exclusions: [...proposal.edits.exclusions, { plan_id: choice.plan_id, position_id: choice.position_id, person_id: choice.person_id }],
  });
  const useInstead = (choice: ProposalChoice, personId: string) => onEdit({
    locks: [...proposal.edits.locks.filter((item) => !sameSlot(item, choice)),
      { plan_id: choice.plan_id, position_id: choice.position_id, person_id: personId }],
    exclusions: [...proposal.edits.exclusions.filter((item) => !(item.plan_id === choice.plan_id && item.position_id === choice.position_id && item.person_id === personId)),
      ...(choice.source === 'existing' ? [] : [{ plan_id: choice.plan_id, position_id: choice.position_id, person_id: choice.person_id }])],
  });
  const restore = (planId: string, positionId: string, personId: string) => onEdit({
    locks: proposal.edits.locks,
    exclusions: proposal.edits.exclusions.filter((item) => !sameSlot(item, { plan_id: planId, position_id: positionId, person_id: personId })),
  });
  const unlockStale = (vacancy: ProposalVacancy) => onEdit({
    locks: proposal.edits.locks.filter((item) => !(item.plan_id === vacancy.plan_id && item.position_id === vacancy.position_id
      && proposal.result.warnings.some((warning) => warning.code === 'locked_choice_invalid' && warning.person_id === item.person_id && warning.plan_id === item.plan_id))),
    exclusions: proposal.edits.exclusions,
  });

  const positionName = (id: string) => proposal.names.positions[id] ?? 'Position';
  const teamName = (id: string) => proposal.names.teams[id] ?? 'Team';
  const personName = (id: string) => proposal.result.choices.find((choice) => choice.person_id === id)?.person_name
    ?? proposal.result.choices.flatMap((choice) => choice.alternatives).find((item) => item.person_id === id)?.person_name ?? 'Person';

  return (
    <div className="space-y-5">
      {proposal.plans.map((plan) => {
        const planGroups = groups.filter((group) => group.planId === plan.id);
        const excluded = proposal.edits.exclusions.filter((item) => item.plan_id === plan.id);
        return (
          <section key={plan.id} className="card p-4" aria-labelledby={`proposal-plan-${plan.id}`}>
            <h3 id={`proposal-plan-${plan.id}`} className="font-semibold">{plan.title}</h3>
            <p className="mb-3 text-xs text-slate-500">{formatDateTime(plan.service_date)} · local date {plan.local_date}</p>
            {!planGroups.length && <p className="text-sm text-slate-500">No needed positions for the selected teams on this plan.</p>}
            <ul className="space-y-3">
              {planGroups.map((group) => (
                <li key={group.key} className="rounded-lg border border-slate-200 p-3">
                  <p className="mb-2 text-sm font-medium">{teamName(group.teamId)} · {positionName(group.positionId)}</p>
                  <ul className="space-y-2">
                    {group.choices.map((choice) => {
                      const locked = choice.source === 'locked';
                      return (
                        <li key={choice.slot_key} className="flex flex-wrap items-start gap-2 text-sm">
                          <div className="min-w-56 flex-1">
                            <span className="font-medium">{choice.person_name}</span>{' '}
                            <Badge tone={SOURCE_TONE[choice.source]}>{SOURCE_LABEL[choice.source]}</Badge>{' '}
                            {choice.assignment_visibility === 'prepared' && <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">prepared</Badge>}
                            <ul className="mt-1 text-xs text-slate-600">{choice.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                            {choice.preference_codes.some((code) => !PROPOSAL_FRESHNESS_CODES.has(code)) && (
                              <p className="mt-1 text-xs text-amber-700">
                                Preference warnings: {choice.preference_codes.filter((code) => !PROPOSAL_FRESHNESS_CODES.has(code)).join(', ')}
                              </p>
                            )}
                            {choice.preference_codes.some((code) => PROPOSAL_FRESHNESS_CODES.has(code)) && (
                              <p className="mt-1 text-xs text-slate-500">
                                Availability {choice.preference_codes.includes('availability_unknown') ? 'never reviewed' : 'not reviewed recently'}.
                              </p>
                            )}
                          </div>
                          {editable && choice.source !== 'existing' && (
                            <div className="flex flex-wrap items-center gap-2">
                              {locked
                                ? <Button variant="secondary" disabled={busy} onClick={() => unlock(choice)}>Unlock</Button>
                                : <Button variant="secondary" disabled={busy} onClick={() => lock(choice)}>Lock</Button>}
                              <Button variant="secondary" disabled={busy} onClick={() => exclude(choice)}>Exclude</Button>
                              {choice.alternatives.length > 0 && (
                                <label className="text-xs">
                                  <span className="sr-only">Use someone else for {positionName(choice.position_id)}</span>
                                  <select className="input" value="" disabled={busy}
                                    onChange={(event) => { if (event.target.value) useInstead(choice, event.target.value); }}>
                                    <option value="">Use instead…</option>
                                    {choice.alternatives.map((item) => (
                                      <option key={item.person_id} value={item.person_id}>
                                        {item.person_name} ({item.metrics?.assigned_count ?? 0} recent{item.metrics?.has_preference_warning ? ', preference warning' : ''})
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                    {group.vacancies.map((vacancy) => (
                      <li key={vacancy.slot_key} className="rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">
                        <span className="font-medium">Open position.</span> {vacancy.reason}
                        {Object.keys(vacancy.exclusion_counts).length > 0 && (
                          <span className="block text-xs">{exclusionSummary(vacancy.exclusion_counts)}</span>
                        )}
                        {editable && vacancy.code === 'locked_choice_invalid' && (
                          <Button variant="secondary" className="mt-2" disabled={busy} onClick={() => unlockStale(vacancy)}>Unlock</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p className="mt-3 text-xs text-slate-600">
                Excluded by you:{' '}
                {excluded.map((item) => (
                  <button key={`${item.position_id}:${item.person_id}`} type="button" disabled={!editable || busy}
                    className="mr-2 underline disabled:no-underline" onClick={() => restore(item.plan_id, item.position_id, item.person_id)}>
                    {personName(item.person_id)} ({positionName(item.position_id)}) — restore
                  </button>
                ))}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
};
