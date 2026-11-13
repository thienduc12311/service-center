import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
import {
  proposalWarningText,
  ApiError,
  describeProposalPolicy,
  type StaffingProposal,
  type StaffingProposalCommitResult,
  type StaffingProposalEdits,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, usePlans, useStaffingProposals, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, Modal, Notice, PageHeader } from '../components/ui';
import { Icon } from '../components/icons';
import { useFormatters, useStructuredText } from '../i18n';
import { ProposalReview } from '../components/scheduling/ProposalReview';
import { RotationsPanel, rotationMembers } from '../components/scheduling/RotationEditor';

const DAY = 86_400_000;
const MAX_PLANS = 12;
const LOOKBACK_OPTIONS = [28, 56, 90, 180, 365];
const STALE_CODES = new Set(['proposal_stale', 'proposal_expired', 'scheduling_conflict']);

/** Translation keys for the ordering policy, in the order `describeProposalPolicy` returns its lines. */
const POLICY_KEYS = ['kept', 'locks', 'eligibility', 'rotation', 'freshness', 'fairnessOrder', 'fairnessDisclaimer'] as const;

/**
 * The recorded policy is shown verbatim. When it is exactly the current rule's
 * wording, the same lines are shown in the viewer's language instead.
 */
const usePolicyLines = (proposal: StaffingProposal | null): string[] => {
  const { t } = useTranslation('staffing');
  if (!proposal) return [];
  const current = describeProposalPolicy(proposal.lookback_days);
  const matches = current.length === POLICY_KEYS.length && current.length === proposal.policy.length
    && current.every((line, index) => line === proposal.policy[index]);
  return matches ? POLICY_KEYS.map((key) => t(`proposals.policy.${key}`, { days: proposal.lookback_days })) : proposal.policy;
};

const toggle = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

/**
 * F06: choose plans and teams → review a deterministic proposal (reasons,
 * open positions, warnings) → lock/exclude and recompute → commit as prepared.
 * Release stays a separate step in the staffing matrix or plan.
 */
export const StaffingProposalsPage = () => {
  const { t } = useTranslation(['staffing', 'common']);
  const { dateTime } = useFormatters();
  const structured = useStructuredText();
  const { organizationId, can, canAnywhere } = useAuth();
  const client = useQueryClient();
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 42 * DAY).toISOString().slice(0, 10));
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [lookback, setLookback] = useState(90);
  const [proposal, setProposal] = useState<StaffingProposal | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [commitKey, setCommitKey] = useState('');
  const [committed, setCommitted] = useState<StaffingProposalCommitResult | null>(null);
  const [rotationTeamId, setRotationTeamId] = useState('');

  const plans = usePlans({ from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59`).toISOString(), order: 'asc', per_page: 50 });
  const teams = useTeams();
  const drafts = useStaffingProposals();
  const schedulableTeams = useMemo(
    () => (teams.data ?? []).filter((team) => can('scheduling.manage', { serviceTypeId: team.service_type_id, teamId: team.id })),
    [teams.data, can],
  );
  const rotationTeam = schedulableTeams.find((team) => team.id === rotationTeamId);

  const show = (next: StaffingProposal) => { setProposal(next); setCommitted(next.commit_result); };
  const generate = useMutation({
    mutationFn: () => api.createStaffingProposal({ plan_ids: planIds, team_ids: teamIds, lookback_days: lookback }),
    onSuccess: async (next) => { show(next); await client.invalidateQueries({ queryKey: keys.staffingProposals(organizationId) }); },
  });
  const recompute = useMutation({
    mutationFn: (edits: StaffingProposalEdits) => api.recomputeStaffingProposal(proposal!.id, { expected_revision: proposal!.revision, edits }),
    onSuccess: show,
  });
  const refresh = useMutation({
    mutationFn: () => api.refreshStaffingProposal(proposal!.id),
    onSuccess: async (next) => { show(next); commitMutation.reset(); await client.invalidateQueries({ queryKey: keys.staffingProposals(organizationId) }); },
  });
  const commitMutation = useMutation({
    mutationFn: () => api.commitStaffingProposal(proposal!.id, { expected_revision: proposal!.revision, idempotency_key: commitKey }),
    onSuccess: async (result) => {
      setCommitted(result); setConfirming(false);
      setProposal((current) => current && { ...current, status: 'committed', commit_result: result });
      await client.invalidateQueries({ queryKey: keys.all(organizationId) });
    },
  });
  const commitError = commitMutation.error;
  const needsRefresh = commitError instanceof ApiError && STALE_CODES.has(commitError.code ?? '');
  const toCreate = proposal?.result.choices.filter((choice) => choice.source !== 'existing').length ?? 0;
  const policyLines = usePolicyLines(proposal);

  if (!canAnywhere('scheduling.manage')) {
    return <EmptyState icon="people" title={t('proposals.accessTitle')} description={t('proposals.accessDescription')} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('proposals.title')}
        subtitle={t('proposals.subtitle')}
        back={{ to: '/plans', label: t('common:nav.plans') }}
        actions={<Link to="/plans/matrix"><Button variant="secondary" icon="grid" tabIndex={-1}>{t('proposals.matrixLink')}</Button></Link>} />

      {!proposal && (
        <section className="card space-y-5 p-4 sm:p-5" aria-label={t('proposals.scope')}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="field">{t('proposals.from')}<input className="input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPlanIds([]); }} /></label>
            <label className="field">{t('proposals.to')}<input className="input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPlanIds([]); }} /></label>
            <label className="field">{t('proposals.lookback')}
              <select className="input" value={lookback} onChange={(e) => setLookback(Number(e.target.value))}>
                {LOOKBACK_OPTIONS.map((days) => <option key={days} value={days}>{t('common:duration.days', { count: days })}</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="label">{t('proposals.plansLegend', { selected: planIds.length, max: MAX_PLANS })}</legend>
            {plans.isLoading ? <Loading /> : !(plans.data?.data.length) ? <p className="surface-inset px-3 py-3 text-sm text-slate-500 dark:text-slate-400">{t('proposals.noPlans')}</p> : (
              <div className="scrollbar-thin grid max-h-80 gap-1.5 overflow-y-auto md:grid-cols-2">
                {plans.data.data.map((plan) => (
                  <label key={plan.id} className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm ring-1 ring-inset transition has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${planIds.includes(plan.id) ? 'bg-brand-50 ring-brand-200 dark:bg-brand-500/10 dark:ring-brand-500/30' : 'ring-app-border hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
                    <input type="checkbox" checked={planIds.includes(plan.id)}
                      disabled={!planIds.includes(plan.id) && planIds.length >= MAX_PLANS}
                      className="size-4 shrink-0 rounded border-slate-300 accent-brand-600"
                      onChange={() => setPlanIds((current) => toggle(current, plan.id))} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-slate-800 dark:text-slate-100">{plan.title}</span> <span className="block text-xs text-slate-500 dark:text-slate-400">{dateTime(plan.service_date)}</span></span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend className="label">{t('proposals.teamsLegend')}</legend>
            <div className="flex flex-wrap gap-2">
              {schedulableTeams.map((team) => (
                <label key={team.id} className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ring-inset transition ${teamIds.includes(team.id) ? 'bg-brand-50 text-brand-700 ring-brand-200 dark:bg-brand-500/15 dark:text-brand-200 dark:ring-brand-500/30' : 'text-slate-700 ring-app-border hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50'}`}>
                  <input type="checkbox" className="size-3.5 rounded border-slate-300 accent-brand-600" checked={teamIds.includes(team.id)} onChange={() => setTeamIds((current) => toggle(current, team.id))} />
                  {team.name}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorNotice error={generate.error ?? plans.error ?? teams.error} />
          <div className="flex justify-end border-t border-app-border pt-4"><Button icon="sparkle" disabled={!planIds.length || !teamIds.length} loading={generate.isPending} onClick={() => generate.mutate()}>{t('proposals.preview')}</Button></div>
          {(drafts.data ?? []).length > 0 && (
            <div>
              <p className="section-label mb-2">{t('proposals.recentDrafts')}</p>
              <ul className="row-list surface-inset text-sm">
                {drafts.data!.map((draft) => (
                  <li key={draft.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2">
                    <Icon name="document" className="size-4 shrink-0 text-slate-400" />
                    <button type="button" className="min-w-0 text-left font-medium text-brand-700 hover:underline dark:text-brand-200" onClick={() => show(draft)}>
                      {draft.plans.map((plan) => plan.title).join(t('common:format.listSeparator'))}
                    </button>{' '}
                    <span className="text-xs text-slate-500">{draft.expired ? t('proposals.draftCreatedExpired', { time: dateTime(draft.created_at) }) : dateTime(draft.created_at)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {proposal && (
        <>
          <section className="card space-y-4 p-4 sm:p-5" aria-label={t('proposals.summaryLabel')}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto w-full text-sm text-slate-700 sm:w-auto dark:text-slate-200">
                <Trans
                  t={t}
                  i18nKey="proposals.summary"
                  values={{
                    proposed: proposal.result.summary.proposed,
                    existing: proposal.result.summary.existing,
                    vacant: proposal.result.summary.vacant,
                    slots: proposal.result.summary.slots,
                  }}
                  components={[
                    <span key="proposed" className="font-semibold text-brand-700 dark:text-brand-200" />,
                    <span key="existing" className="font-semibold text-slate-900 dark:text-white" />,
                    <span key="vacant" className="font-semibold text-amber-700 dark:text-amber-300" />,
                  ]}
                />
              </p>
              <Button variant="secondary" onClick={() => { setProposal(null); setCommitted(null); commitMutation.reset(); }}>{t('proposals.changeScope')}</Button>
              {proposal.status === 'draft' && <Button variant="secondary" icon="sparkle" loading={refresh.isPending} onClick={() => refresh.mutate()}>{t('proposals.refreshFromCurrent')}</Button>}
              {proposal.status === 'draft' && (
                <Button icon="check" disabled={proposal.expired || toCreate === 0 || recompute.isPending}
                  onClick={() => { setCommitKey(crypto.randomUUID()); commitMutation.reset(); setConfirming(true); }}>
                  {t('proposals.commitPrepared', { count: toCreate })}
                </Button>
              )}
            </div>
            {proposal.expired && proposal.status === 'draft' && (
              <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/25"><Icon name="alert" className="mt-px size-4 shrink-0" />{t('proposals.expired')}</p>
            )}
            {proposal.status === 'superseded' && <p className="surface-inset px-3 py-2 text-sm text-slate-600 dark:text-slate-300">{t('proposals.superseded')}</p>}
            {committed && (
              <Notice tone="success">
                {t('proposals.committed', { count: committed.assignment_ids.length })}{' '}
                <Link className="font-medium underline" to="/plans/matrix">{t('proposals.reviewInMatrix')}</Link>
              </Notice>
            )}
            <ErrorNotice error={recompute.error ?? refresh.error} />
            <details className="surface-inset px-3 py-2.5 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">{t('proposals.howChosen', { rule: proposal.rule_version, seed: proposal.seed })}</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-300">{policyLines.map((line) => <li key={line}>{line}</li>)}</ul>
              {proposal.rotations.length > 0 && (
                <p className="mt-2 text-slate-600 dark:text-slate-300">
                  {t('proposals.rotationsUsed', {
                    list: proposal.rotations
                      .map((rotation) => t('proposals.rotationVersion', { name: rotation.name, revision: rotation.revision }))
                      .join(t('common:format.listSeparator')),
                  })}
                </p>
              )}
            </details>
            {proposal.result.warnings.length > 0 && (
              <details className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm ring-1 ring-inset ring-amber-600/20 dark:bg-amber-500/10 dark:ring-amber-500/25" open>
                <summary className="cursor-pointer font-medium text-amber-900 dark:text-amber-200">{t('proposals.warningCount', { count: proposal.result.warnings.length })}</summary>
                <ul className="mt-2 space-y-1 text-amber-800 dark:text-amber-200">{proposal.result.warnings.map((warning, index) => <li key={index}>{proposalWarningText(warning, structured)}</li>)}</ul>
              </details>
            )}
          </section>
          <ProposalReview proposal={proposal} busy={recompute.isPending} onEdit={(edits) => recompute.mutate(edits)} />
        </>
      )}

      <section className="space-y-3" aria-label={t('proposals.rotationsTitle')}>
        <div className="flex flex-wrap items-end gap-3 border-t border-app-border pt-6">
          <h2 className="mr-auto text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{t('proposals.rotationsTitle')}</h2>
          <label className="field w-full sm:w-56">{t('proposals.team')}
            <select className="input" value={rotationTeamId} onChange={(e) => setRotationTeamId(e.target.value)}>
              <option value="">{t('proposals.chooseTeam')}</option>
              {schedulableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        </div>
        {rotationTeam && <RotationsPanel team={rotationTeam} members={rotationMembers(rotationTeam, t('rotations.unnamedPerson'))} />}
      </section>

      <Modal open={confirming} title={t('proposals.confirmTitle')} onClose={() => { if (!commitMutation.isPending) setConfirming(false); }}>
        <div className="space-y-3 text-sm">
          <p>{t('proposals.confirmBody', { count: toCreate })}</p>
          <p>{t('proposals.confirmStale')}</p>
          <ErrorNotice error={commitError} />
          {needsRefresh && <Button variant="secondary" loading={refresh.isPending} onClick={() => { setConfirming(false); refresh.mutate(); }}>{t('proposals.refreshProposal')}</Button>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>{t('common:actions.back')}</Button>
            <Button loading={commitMutation.isPending} disabled={needsRefresh} onClick={() => commitMutation.mutate()}>{t('proposals.commit')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
