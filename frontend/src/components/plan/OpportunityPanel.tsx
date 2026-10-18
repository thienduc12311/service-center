import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApprovedSwapRow, AssignmentDetail, OpportunityClaimDetail, ReplacementRequestDetail, SignupOpportunity } from '@service-center/shared';
import { api } from '../../lib/api';
import { keys, useInvalidateOrg, usePeople } from '../../hooks/queries';
import { useAuth } from '../../providers/AuthProvider';
import { Button, ErrorNotice } from '../ui';

export interface SignupSetupOption {
  teamId: string;
  teamName: string;
  positionId: string;
  positionName: string;
  needed: number;
  canManage: boolean;
}

interface OpportunityPanelProps {
  planId: string;
  options: SignupSetupOption[];
  assignments: AssignmentDetail[];
  currentPersonId: string | null;
}

const newKey = (): string => crypto.randomUUID();
const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

export const OpportunityPanel = ({ planId, options, assignments, currentPersonId }: OpportunityPanelProps) => {
  const { organizationId, user } = useAuth();
  const invalidate = useInvalidateOrg();
  const canManage = options.some((option) => option.canManage);
  const people = usePeople();
  const actorPersonId = currentPersonId
    ?? people.data?.find((person) => person.profile_id === user?.profile.id)?.person_id
    ?? null;
  const openings = useQuery({ queryKey: [...keys.plan(organizationId, planId), 'opportunities'], queryFn: () => api.listSignupOpportunities({ plan_id: planId }) });
  const claims = useQuery({ queryKey: [...keys.plan(organizationId, planId), 'opportunity-claims'], queryFn: () => api.listSignupClaims({ plan_id: planId }), enabled: canManage });
  const replacements = useQuery({ queryKey: [...keys.all(organizationId), 'replacement-requests'], queryFn: () => api.listReplacementRequests() });
  const swaps = useQuery({ queryKey: [...keys.all(organizationId), 'approved-swaps'], queryFn: () => api.listApprovedSwaps() });
  const [setupPosition, setSetupPosition] = useState('');
  const [capacity, setCapacity] = useState(1);
  const [approval, setApproval] = useState<'direct' | 'leader_approval'>('leader_approval');
  const [candidateByRequest, setCandidateByRequest] = useState<Record<string, string>>({});
  const [swapFirst, setSwapFirst] = useState('');
  const [swapSecond, setSwapSecond] = useState('');

  const refresh = (): void => { invalidate(); };
  const create = useMutation({ mutationFn: () => {
    const option = options.find((item) => item.positionId === setupPosition);
    if (!option) throw new Error('Choose a position');
    return api.createSignupOpportunity(planId, { team_id: option.teamId, position_id: option.positionId, applicable_time_ids: [], capacity, approval_policy: approval, closes_at: inDays(7), reservation_minutes: 1_440 });
  }, onSuccess: refresh });
  const claim = useMutation({ mutationFn: (opening: SignupOpportunity) => api.claimSignupOpportunity(opening.id, { expected_version: opening.version, idempotency_key: newKey() }), onSuccess: refresh });
  const cancelClaim = useMutation({ mutationFn: (opening: SignupOpportunity) => {
    if (!opening.my_claim) throw new Error('Claim not found');
    return api.cancelSignupClaim(opening.my_claim.id, { expected_version: opening.my_claim.version });
  }, onSuccess: refresh });
  const closeOpening = useMutation({ mutationFn: (opening: SignupOpportunity) => api.updateSignupOpportunity(opening.id, {
    state: 'closed', expected_version: opening.version,
  }), onSuccess: refresh });
  const decideClaim = useMutation({ mutationFn: ({ item, action }: { item: OpportunityClaimDetail; action: 'approve'|'reject' }) => api.decideSignupClaim(item.id, { expected_version: item.version, action }), onSuccess: refresh });
  const issueOffer = useMutation({ mutationFn: (request: ReplacementRequestDetail) => {
    const person = candidateByRequest[request.id];
    if (!person) throw new Error('Choose a candidate');
    return api.issueReplacementOffer(request.id, { candidate_person_id: person, expected_version: request.version, idempotency_key: newKey() });
  }, onSuccess: refresh });
  const requestReplacement = useMutation({ mutationFn: (assignment: AssignmentDetail) => api.createReplacementRequest({
    assignment_id: assignment.id, expected_revision: assignment.request_revision, idempotency_key: newKey(), expires_at: inDays(7),
  }), onSuccess: refresh });
  const cancelReplacement = useMutation({ mutationFn: (request: ReplacementRequestDetail) => api.cancelReplacementRequest(request.id, {
    expected_version: request.version,
  }), onSuccess: refresh });
  const actOffer = useMutation({ mutationFn: ({ id, version, action }: { id: string; version: number; action: 'accept'|'decline'|'approve'|'reject' }) => api.actOnReplacementOffer(id, { expected_version: version, action }), onSuccess: refresh });
  const createSwap = useMutation({ mutationFn: () => {
    const first = assignments.find((item) => item.id === swapFirst);
    const second = assignments.find((item) => item.id === swapSecond);
    if (!first || !second) throw new Error('Choose two commitments');
    return api.createApprovedSwap({ first_assignment_id: first.id, second_assignment_id: second.id, first_revision: first.request_revision, second_revision: second.request_revision, expires_at: inDays(2), idempotency_key: newKey() });
  }, onSuccess: refresh });
  const actSwap = useMutation({ mutationFn: ({ swap, action }: { swap: ApprovedSwapRow; action: 'consent'|'approve'|'cancel'|'reject' }) => api.actOnApprovedSwap(swap.id, { expected_version: swap.version, action }), onSuccess: refresh });

  const error = create.error ?? claim.error ?? cancelClaim.error ?? closeOpening.error ?? decideClaim.error ?? requestReplacement.error ?? cancelReplacement.error ?? issueOffer.error ?? actOffer.error ?? createSwap.error ?? actSwap.error;
  const activeRequests = (replacements.data ?? []).filter((request) => request.plan_id === planId);
  const activeSwaps = (swaps.data ?? []).filter((swap) => assignments.some((item) => item.id === swap.first_assignment_id || item.id === swap.second_assignment_id));
  const confirmed = useMemo(() => assignments.filter((item) => item.status === 'confirmed'), [assignments]);

  return <section className="mb-5 space-y-4 rounded-lg border border-slate-200 bg-white p-4">
    <div>
      <h3 className="font-semibold">Open positions and replacements</h3>
      <p className="text-sm text-slate-500">Claims reserve real capacity. “Awaiting approval” is not a confirmed assignment.</p>
    </div>
    {error && <ErrorNotice error={error} />}
    {canManage && <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
      <label className="text-xs text-slate-600">Position<select className="input mt-1 block" value={setupPosition} onChange={(event) => setSetupPosition(event.target.value)}><option value="">Choose…</option>{options.filter((item) => item.canManage && item.needed > 0).map((item) => <option key={item.positionId} value={item.positionId}>{item.teamName} · {item.positionName}</option>)}</select></label>
      <label className="text-xs text-slate-600">Capacity<input className="input mt-1 w-20" type="number" min={1} max={200} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></label>
      <label className="text-xs text-slate-600">Claim policy<select className="input mt-1 block" value={approval} onChange={(event) => setApproval(event.target.value as typeof approval)}><option value="leader_approval">Leader approval</option><option value="direct">Direct confirmation</option></select></label>
      <Button loading={create.isPending} disabled={!setupPosition} onClick={() => create.mutate()}>Open position</Button>
    </div>}
    {openings.isLoading ? <p className="text-sm text-slate-500">Loading openings…</p> : openings.error ? <ErrorNotice error={openings.error} /> : (openings.data ?? []).length === 0 ? <p className="text-sm text-slate-500">No positions are open for signup.</p> : <ul className="grid gap-2 md:grid-cols-2">{(openings.data ?? []).map((opening) => <li key={opening.id} className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex justify-between gap-2"><strong>{opening.team_name} · {opening.position_name}</strong><span>{opening.remaining_capacity} left</span></div>
      <p className="mt-1 text-xs text-slate-500">{opening.approval_policy === 'direct' ? 'Confirmed immediately' : 'Leader approval required'} · closes {new Date(opening.closes_at).toLocaleString()}</p>
      <p className="mt-1 text-xs">{opening.my_claim ? opening.my_claim.status.replaceAll('_',' ') : opening.eligibility}</p>
      <div className="mt-2 flex gap-2">{!opening.my_claim && opening.eligibility === 'eligible' && <Button className="!py-1 text-xs" loading={claim.isPending} onClick={() => claim.mutate(opening)}>Claim</Button>}{opening.my_claim && ['awaiting_approval','confirmed'].includes(opening.my_claim.status) && <Button variant="secondary" className="!py-1 text-xs" onClick={() => cancelClaim.mutate(opening)}>Cancel</Button>}{options.some((option) => option.teamId === opening.team_id && option.canManage) && opening.state === 'open' && <Button variant="ghost" className="!py-1 text-xs" onClick={() => closeOpening.mutate(opening)}>Close opening</Button>}</div>
    </li>)}</ul>}
    {canManage && (claims.data ?? []).some((item) => item.status === 'awaiting_approval') && <div><h4 className="text-sm font-semibold">Awaiting signup approval</h4><ul className="mt-2 space-y-2">{(claims.data ?? []).filter((item) => item.status === 'awaiting_approval').map((item) => <li key={item.id} className="flex items-center justify-between rounded border border-slate-200 p-2 text-sm"><span>{item.person_name}</span><span className="flex gap-2"><Button className="!py-1 text-xs" onClick={() => decideClaim.mutate({ item, action:'approve' })}>Approve</Button><Button variant="ghost" className="!py-1 text-xs" onClick={() => decideClaim.mutate({ item, action:'reject' })}>Reject</Button></span></li>)}</ul></div>}
    {assignments.some((item) => item.person_id === actorPersonId && item.status === 'declined' && !activeRequests.some((request) => request.original_assignment_id === item.id && request.status === 'open')) && <div><h4 className="text-sm font-semibold">Need someone to replace you?</h4><div className="mt-2 flex flex-wrap gap-2">{assignments.filter((item) => item.person_id === actorPersonId && item.status === 'declined' && !activeRequests.some((request) => request.original_assignment_id === item.id && request.status === 'open')).map((item) => <Button key={item.id} variant="secondary" className="text-xs" onClick={() => requestReplacement.mutate(item)}>Request help · {item.position?.name ?? item.team?.name ?? 'Team'}</Button>)}</div><p className="mt-1 text-xs text-slate-500">Your decline stays recorded. A replacement gets their own assignment and must consent.</p></div>}
    {activeRequests.length > 0 && <div><h4 className="text-sm font-semibold">Replacement requests</h4><ul className="mt-2 space-y-3">{activeRequests.map((request) => <li key={request.id} className="rounded border border-slate-200 p-3 text-sm"><div className="flex justify-between gap-2"><span>Request {request.status}</span><span className="flex items-center gap-2">{request.offers.length} offer(s){request.status === 'open' && (request.requester_person_id === actorPersonId || canManage) && <Button variant="ghost" className="!py-1 text-xs" onClick={() => cancelReplacement.mutate(request)}>Cancel request</Button>}</span></div>{canManage && request.status === 'open' && <div className="mt-2 flex gap-2"><select className="input" value={candidateByRequest[request.id] ?? ''} onChange={(event) => setCandidateByRequest((current) => ({...current,[request.id]:event.target.value}))}><option value="">Choose candidate…</option>{(people.data ?? []).filter((person) => person.person_id).map((person) => <option key={person.id} value={person.person_id!}>{person.full_name ?? 'Unnamed person'}</option>)}</select><Button className="!py-1 text-xs" onClick={() => issueOffer.mutate(request)}>Send offer</Button></div>}<ul className="mt-2 space-y-1">{request.offers.map((offer) => <li key={offer.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 p-2"><span>{offer.status.replaceAll('_',' ')}</span><span className="flex gap-1">{actorPersonId === offer.candidate_person_id && offer.status === 'pending' && <><Button className="!py-1 text-xs" onClick={() => actOffer.mutate({id:offer.id,version:offer.version,action:'accept'})}>Accept offer</Button><Button variant="ghost" className="!py-1 text-xs" onClick={() => actOffer.mutate({id:offer.id,version:offer.version,action:'decline'})}>Decline</Button></>}{canManage && ['pending','accepted_awaiting_approval'].includes(offer.status) && <><Button className="!py-1 text-xs" onClick={() => actOffer.mutate({id:offer.id,version:offer.version,action:'approve'})}>Approve</Button><Button variant="ghost" className="!py-1 text-xs" onClick={() => actOffer.mutate({id:offer.id,version:offer.version,action:'reject'})}>Reject</Button></>}</span></li>)}</ul></li>)}</ul></div>}
    {confirmed.length >= 2 && <div><h4 className="text-sm font-semibold">Approved swap</h4><div className="mt-2 flex flex-wrap gap-2"><select className="input" value={swapFirst} onChange={(event) => setSwapFirst(event.target.value)}><option value="">First commitment…</option>{confirmed.map((item) => <option key={item.id} value={item.id}>{item.person?.full_name} · {item.position?.name ?? item.team?.name ?? 'Team'}</option>)}</select><select className="input" value={swapSecond} onChange={(event) => setSwapSecond(event.target.value)}><option value="">Second commitment…</option>{confirmed.map((item) => <option key={item.id} value={item.id}>{item.person?.full_name} · {item.position?.name ?? item.team?.name ?? 'Team'}</option>)}</select><Button variant="secondary" disabled={!swapFirst || !swapSecond || swapFirst === swapSecond} onClick={() => createSwap.mutate()}>Propose swap</Button></div>{activeSwaps.map((swap) => <div key={swap.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 p-2 text-sm"><span>{swap.status} · consent {swap.first_consented_at ? '✓':'○'} / {swap.second_consented_at ? '✓':'○'} · leader {swap.leader_approved_at ? '✓':'○'}</span><span className="flex gap-1">{actorPersonId && [swap.first_person_id,swap.second_person_id].includes(actorPersonId) && <Button className="!py-1 text-xs" onClick={() => actSwap.mutate({swap,action:'consent'})}>Consent</Button>}{canManage && <Button className="!py-1 text-xs" onClick={() => actSwap.mutate({swap,action:'approve'})}>Approve</Button>}<Button variant="ghost" className="!py-1 text-xs" onClick={() => actSwap.mutate({swap,action:'cancel'})}>Cancel</Button></span></div>)}</div>}
  </section>;
};
