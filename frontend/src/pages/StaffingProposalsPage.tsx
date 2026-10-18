import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  formatDateTime,
  type StaffingProposal,
  type StaffingProposalCommitResult,
  type StaffingProposalEdits,
} from '@service-center/shared';
import { api } from '../lib/api';
import { keys, usePlans, useStaffingProposals, useTeams } from '../hooks/queries';
import { useAuth } from '../providers/AuthProvider';
import { Button, EmptyState, ErrorNotice, Loading, Modal, PageHeader } from '../components/ui';
import { ProposalReview } from '../components/scheduling/ProposalReview';
import { RotationsPanel, rotationMembers } from '../components/scheduling/RotationEditor';

const DAY = 86_400_000;
const MAX_PLANS = 12;
const LOOKBACK_OPTIONS = [28, 56, 90, 180, 365];
const STALE_CODES = new Set(['proposal_stale', 'proposal_expired', 'scheduling_conflict']);

const toggle = (list: readonly string[], id: string): string[] => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

/**
 * F06: choose plans and teams → review a deterministic proposal (reasons,
 * open positions, warnings) → lock/exclude and recompute → commit as prepared.
 * Release stays a separate step in the staffing matrix or plan.
 */
export const StaffingProposalsPage = () => {
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

  if (!canAnywhere('scheduling.manage')) {
    return <EmptyState title="Scheduling access needed" description="Only people who can schedule a team can build staffing proposals." />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Staffing proposals"
        subtitle="Suggest several weeks of staffing, see why each person was chosen, adjust, then commit as prepared requests. Nothing is sent until you release."
        actions={<Link to="/plans/matrix"><Button variant="secondary">Staffing matrix</Button></Link>} />

      {!proposal && (
        <section className="card space-y-4 p-4" aria-label="Proposal scope">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">From<input className="input mt-1" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPlanIds([]); }} /></label>
            <label className="text-sm">To<input className="input mt-1" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPlanIds([]); }} /></label>
            <label className="text-sm">Fairness lookback
              <select className="input mt-1" value={lookback} onChange={(e) => setLookback(Number(e.target.value))}>
                {LOOKBACK_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Plans ({planIds.length}/{MAX_PLANS})</legend>
            {plans.isLoading ? <Loading /> : !(plans.data?.data.length) ? <p className="text-sm text-slate-500">No plans in this range.</p> : (
              <div className="grid gap-1 md:grid-cols-2">
                {plans.data.data.map((plan) => (
                  <label key={plan.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={planIds.includes(plan.id)}
                      disabled={!planIds.includes(plan.id) && planIds.length >= MAX_PLANS}
                      onChange={() => setPlanIds((current) => toggle(current, plan.id))} />
                    {plan.title} <span className="text-xs text-slate-500">{formatDateTime(plan.service_date)}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Teams you schedule</legend>
            <div className="flex flex-wrap gap-3">
              {schedulableTeams.map((team) => (
                <label key={team.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={teamIds.includes(team.id)} onChange={() => setTeamIds((current) => toggle(current, team.id))} />
                  {team.name}
                </label>
              ))}
            </div>
          </fieldset>
          <ErrorNotice error={generate.error ?? plans.error ?? teams.error} />
          <Button disabled={!planIds.length || !teamIds.length} loading={generate.isPending} onClick={() => generate.mutate()}>Preview proposal</Button>
          {(drafts.data ?? []).length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Your recent drafts</p>
              <ul className="space-y-1 text-sm">
                {drafts.data!.map((draft) => (
                  <li key={draft.id}>
                    <button type="button" className="underline" onClick={() => show(draft)}>
                      {draft.plans.map((plan) => plan.title).join(', ')}
                    </button>{' '}
                    <span className="text-xs text-slate-500">{formatDateTime(draft.created_at)}{draft.expired ? ' · expired' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {proposal && (
        <>
          <section className="card space-y-3 p-4" aria-label="Proposal summary">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-sm">
                <span className="font-medium">{proposal.result.summary.proposed}</span> suggested ·{' '}
                <span className="font-medium">{proposal.result.summary.existing}</span> kept ·{' '}
                <span className="font-medium">{proposal.result.summary.vacant}</span> open of {proposal.result.summary.slots} needed
              </p>
              <Button variant="secondary" onClick={() => { setProposal(null); setCommitted(null); commitMutation.reset(); }}>Change scope</Button>
              {proposal.status === 'draft' && <Button variant="secondary" loading={refresh.isPending} onClick={() => refresh.mutate()}>Refresh from current staffing</Button>}
              {proposal.status === 'draft' && (
                <Button disabled={proposal.expired || toCreate === 0 || recompute.isPending}
                  onClick={() => { setCommitKey(crypto.randomUUID()); commitMutation.reset(); setConfirming(true); }}>
                  Commit {toCreate} as prepared
                </Button>
              )}
            </div>
            {proposal.expired && proposal.status === 'draft' && (
              <p role="alert" className="text-sm text-amber-800">This proposal expired. Refresh it to recompute from current staffing before committing.</p>
            )}
            {proposal.status === 'superseded' && <p className="text-sm text-slate-600">This draft was replaced by a refreshed proposal.</p>}
            {committed && (
              <div role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
                Committed {committed.assignment_ids.length} prepared request{committed.assignment_ids.length === 1 ? '' : 's'}. Nobody has been notified.{' '}
                <Link className="underline" to="/plans/matrix">Review and release in the staffing matrix</Link>.
              </div>
            )}
            <ErrorNotice error={recompute.error ?? refresh.error} />
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">How choices are made (rule {proposal.rule_version}, seed {proposal.seed})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600">{proposal.policy.map((line) => <li key={line}>{line}</li>)}</ul>
              {proposal.rotations.length > 0 && (
                <p className="mt-2 text-slate-600">Rotations used: {proposal.rotations.map((rotation) => `${rotation.name} (v${rotation.revision})`).join(', ')}</p>
              )}
            </details>
            {proposal.result.warnings.length > 0 && (
              <details className="text-sm" open>
                <summary className="cursor-pointer font-medium text-amber-800">{proposal.result.warnings.length} warning{proposal.result.warnings.length === 1 ? '' : 's'}</summary>
                <ul className="mt-2 space-y-1 text-amber-800">{proposal.result.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>
              </details>
            )}
          </section>
          <ProposalReview proposal={proposal} busy={recompute.isPending} onEdit={(edits) => recompute.mutate(edits)} />
        </>
      )}

      <section className="space-y-3" aria-label="Team rotations">
        <div className="flex flex-wrap items-end gap-3">
          <h2 className="mr-auto text-lg font-semibold">Team rotations</h2>
          <label className="text-sm">Team
            <select className="input mt-1" value={rotationTeamId} onChange={(e) => setRotationTeamId(e.target.value)}>
              <option value="">Choose a team</option>
              {schedulableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        </div>
        {rotationTeam && <RotationsPanel team={rotationTeam} members={rotationMembers(rotationTeam)} />}
      </section>

      <Modal open={confirming} title="Commit as prepared requests" onClose={() => { if (!commitMutation.isPending) setConfirming(false); }}>
        <div className="space-y-3 text-sm">
          <p>
            This creates {toCreate} prepared request{toCreate === 1 ? '' : 's'} in one step. Existing and confirmed requests are untouched, and nobody is notified.
            If staffing, a rotation, team membership or anyone’s availability changed since this proposal was computed, nothing is created.
          </p>
          <ErrorNotice error={commitError} />
          {needsRefresh && <Button variant="secondary" loading={refresh.isPending} onClick={() => { setConfirming(false); refresh.mutate(); }}>Refresh proposal</Button>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>Back</Button>
            <Button loading={commitMutation.isPending} disabled={needsRefresh} onClick={() => commitMutation.mutate()}>Commit</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
