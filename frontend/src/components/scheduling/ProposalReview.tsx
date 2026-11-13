import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  proposalChoiceReasons,
  proposalVacancyText,
  PREFERENCE_WARNING_LABELS,
  PROPOSAL_FRESHNESS_CODES,
  type PreferenceWarningCode,
  type ProposalChoice,
  type ProposalExclusionCode,
  type ProposalVacancy,
  type StaffingProposal,
  type StaffingProposalEdits,
} from '@service-center/shared';
import { Badge, Button, DateTile } from '../ui';
import { Icon } from '../icons';
import { useFormatters, useStructuredText } from '../../i18n';

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

const SOURCE_TONE: Record<ProposalChoice['source'], string> = {
  existing: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
  locked: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/15 dark:text-brand-200',
  rotation: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/15 dark:text-sky-300',
  fairness: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const sameSlot = (a: { plan_id: string; position_id: string; person_id: string }, b: typeof a): boolean =>
  a.plan_id === b.plan_id && a.position_id === b.position_id && a.person_id === b.person_id;

type StaffingT = TFunction<['staffing', 'common']>;

const exclusionSummary = (counts: Partial<Record<ProposalExclusionCode, number>>, t: StaffingT): string =>
  (Object.entries(counts) as Array<[ProposalExclusionCode, number]>)
    .map(([code, count]) => t(`staffing:proposalReview.exclusionCount.${code}`, { count }))
    .join(' · ');

/** Membership check only: the shared map's keys are the known preference codes. */
const isPreferenceCode = (code: string): code is PreferenceWarningCode => Object.hasOwn(PREFERENCE_WARNING_LABELS, code);

const preferenceCodeText = (code: string, t: StaffingT): string =>
  isPreferenceCode(code) ? t(`staffing:preferenceWarning.${code}`) : code;

export const ProposalReview = ({ proposal, busy, onEdit }: ProposalReviewProps) => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime, calendarDate } = useFormatters();
  const structured = useStructuredText();
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

  const positionName = (id: string) => proposal.names.positions[id] ?? t('proposalReview.fallbackPosition');
  const teamName = (id: string) => proposal.names.teams[id] ?? t('common:fallback.team');
  const personName = (id: string) => proposal.result.choices.find((choice) => choice.person_id === id)?.person_name
    ?? proposal.result.choices.flatMap((choice) => choice.alternatives).find((item) => item.person_id === id)?.person_name ?? t('proposalReview.fallbackPerson');

  return (
    <div className="space-y-5">
      {proposal.plans.map((plan) => {
        const planGroups = groups.filter((group) => group.planId === plan.id);
        const excluded = proposal.edits.exclusions.filter((item) => item.plan_id === plan.id);
        return (
          <section key={plan.id} className="card p-4 sm:p-5" aria-labelledby={`proposal-plan-${plan.id}`}>
            <div className="mb-4 flex items-center gap-3">
              <DateTile value={plan.service_date} />
              <div className="min-w-0">
                <h3 id={`proposal-plan-${plan.id}`} className="font-semibold text-slate-900 dark:text-white">{plan.title}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('proposalReview.planWhen', { time: dateTime(plan.service_date), date: calendarDate(plan.local_date, 'medium') })}</p>
              </div>
            </div>
            {!planGroups.length && <p className="surface-inset px-3 py-3 text-sm text-slate-500 dark:text-slate-400">{t('proposalReview.noNeeds')}</p>}
            <ul className="space-y-3">
              {planGroups.map((group) => (
                <li key={group.key} className="overflow-hidden rounded-xl border border-app-border">
                  <p className="border-b border-app-border bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">{t('common:format.teamPosition', { team: teamName(group.teamId), position: positionName(group.positionId) })}</p>
                  <ul className="row-list">
                    {group.choices.map((choice) => {
                      const locked = choice.source === 'locked';
                      return (
                        <li key={choice.slot_key} className="flex flex-wrap items-start gap-3 px-3 py-3 text-sm">
                          <div className="min-w-0 flex-1 basis-56">
                            <span className="font-medium text-slate-900 dark:text-white">{choice.person_name}</span>{' '}
                            <Badge tone={SOURCE_TONE[choice.source]}>{t(`proposalReview.source.${choice.source}`)}</Badge>{' '}
                            {choice.assignment_visibility === 'prepared' && <Badge tone="bg-slate-100 text-slate-600 ring-slate-500/20">{t('proposalReview.prepared')}</Badge>}
                            <ul className="mt-1 text-xs text-slate-600 dark:text-slate-400">{proposalChoiceReasons(choice, structured).map((reason) => <li key={reason}>{reason}</li>)}</ul>
                            {choice.preference_codes.some((code) => !PROPOSAL_FRESHNESS_CODES.has(code)) && (
                              <p className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300">
                                <Icon name="alert" className="mt-px size-3.5 shrink-0" />
                                {t('proposalReview.preferenceWarnings', {
                                  list: choice.preference_codes
                                    .filter((code) => !PROPOSAL_FRESHNESS_CODES.has(code))
                                    .map((code) => preferenceCodeText(code, t))
                                    .join(t('common:format.listSeparator')),
                                })}
                              </p>
                            )}
                            {choice.preference_codes.some((code) => PROPOSAL_FRESHNESS_CODES.has(code)) && (
                              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {choice.preference_codes.includes('availability_unknown')
                                  ? t('proposalReview.availabilityNeverReviewed')
                                  : t('proposalReview.availabilityNotRecent')}
                              </p>
                            )}
                          </div>
                          {editable && choice.source !== 'existing' && (
                            <div className="flex flex-wrap items-center gap-2">
                              {locked
                                ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => unlock(choice)}>{t('proposalReview.unlock')}</Button>
                                : <Button variant="secondary" size="sm" icon="check" disabled={busy} onClick={() => lock(choice)}>{t('proposalReview.lock')}</Button>}
                              <Button variant="secondary" size="sm" icon="close" disabled={busy} onClick={() => exclude(choice)}>{t('proposalReview.exclude')}</Button>
                              {choice.alternatives.length > 0 && (
                                <label className="text-xs">
                                  <span className="sr-only">{t('proposalReview.useSomeoneElse', { position: positionName(choice.position_id) })}</span>
                                  <select className="input h-8 py-1 text-[13px]" value="" disabled={busy}
                                    onChange={(event) => { if (event.target.value) useInstead(choice, event.target.value); }}>
                                    <option value="">{t('proposalReview.useInstead')}</option>
                                    {choice.alternatives.map((item) => (
                                      <option key={item.person_id} value={item.person_id}>
                                        {t(item.metrics?.has_preference_warning ? 'proposalReview.alternativeWithWarning' : 'proposalReview.alternative', {
                                          name: item.person_name,
                                          count: item.metrics?.assigned_count ?? 0,
                                        })}
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
                      <li key={vacancy.slot_key} className="bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" role="status">
                        <span className="font-semibold">{t('proposalReview.openPosition')}</span> {proposalVacancyText(vacancy, structured)}
                        {Object.keys(vacancy.exclusion_counts).length > 0 && (
                          <span className="block text-xs">{exclusionSummary(vacancy.exclusion_counts, t)}</span>
                        )}
                        {editable && vacancy.code === 'locked_choice_invalid' && (
                          <Button variant="secondary" size="sm" className="mt-2" disabled={busy} onClick={() => unlockStale(vacancy)}>{t('proposalReview.unlock')}</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                {t('proposalReview.excludedByYou')}{' '}
                {excluded.map((item) => (
                  <button key={`${item.position_id}:${item.person_id}`} type="button" disabled={!editable || busy}
                    className="mr-2 font-medium text-brand-700 underline disabled:text-slate-500 disabled:no-underline dark:text-brand-200" onClick={() => restore(item.plan_id, item.position_id, item.person_id)}>
                    {t('proposalReview.restoreExcluded', { name: personName(item.person_id), position: positionName(item.position_id) })}
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
