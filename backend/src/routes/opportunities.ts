import { Router } from 'express';
import {
  actOnApprovedSwapSchema,
  actOnReplacementOfferSchema,
  cancelReplacementRequestSchema,
  cancelSignupClaimSchema,
  claimSignupOpportunitySchema,
  createApprovedSwapSchema,
  createReplacementRequestSchema,
  createSignupOpportunitySchema,
  decideSignupClaimSchema,
  issueReplacementOfferSchema,
  updateSignupOpportunitySchema,
  type ActOnApprovedSwapInput,
  type ActOnReplacementOfferInput,
  type CancelReplacementRequestInput,
  type CancelSignupClaimInput,
  type ClaimSignupOpportunityInput,
  type CreateApprovedSwapInput,
  type CreateReplacementRequestInput,
  type CreateSignupOpportunityInput,
  type DecideSignupClaimInput,
  type IssueReplacementOfferInput,
  type ReplacementRequestDetail,
  type SignupOpportunity,
  type UpdateSignupOpportunityInput,
} from '@service-center/shared';
import { param } from '../lib/params.js';
import { raw, unwrap, unwrapOne } from '../lib/supabase.js';
import { validateBody } from '../lib/validate.js';
import { requireCapability } from '../middleware/organization.js';
import { HttpError } from '../lib/errors.js';

export const planOpportunitiesRouter: Router = Router({ mergeParams: true });
export const opportunitiesRouter: Router = Router();
export const opportunityClaimsRouter: Router = Router();
export const replacementRequestsRouter: Router = Router();
export const replacementOffersRouter: Router = Router();
export const approvedSwapsRouter: Router = Router();

const listOpportunities = async (db: import('../lib/supabase.js').Db, organizationId: string, planId: string | null): Promise<SignupOpportunity[]> => {
  const value = await unwrap(db.rpc('list_signup_opportunities', { p_organization: organizationId, p_plan: planId }));
  if (!Array.isArray(value)) throw new HttpError(500, 'Invalid opportunity result', 'invalid_opportunity_result');
  return value as SignupOpportunity[];
};

opportunitiesRouter.get('/', async (req, res) => {
  const planId = typeof req.query.plan_id === 'string' ? req.query.plan_id : null;
  res.json(await listOpportunities(req.db, req.orgId, planId));
});

opportunitiesRouter.get('/:id', async (req, res) => {
  const rows = await listOpportunities(req.db, req.orgId, null);
  const row = rows.find((item) => item.id === param(req, 'id'));
  if (!row) throw HttpError.notFound('Opening not found');
  res.json(row);
});

planOpportunitiesRouter.get('/', async (req, res) => {
  res.json(await listOpportunities(req.db, req.orgId, param(req, 'planId')));
});

planOpportunitiesRouter.post('/', requireCapability('scheduling.manage'), validateBody(createSignupOpportunitySchema), async (req, res) => {
  const planId = param(req, 'planId');
  const body = req.body as CreateSignupOpportunityInput;
  const plan = await unwrap(req.db.from('plans').select('id').eq('id', planId).eq('organization_id', req.orgId).maybeSingle());
  if (!plan) throw HttpError.notFound('Plan not found');
  const created = await unwrapOne(req.db.from('signup_opportunities').insert({
    ...body, plan_id: planId, organization_id: req.orgId, created_by: req.auth.userId,
  }).select('*').single());
  res.status(201).json(created);
});

opportunitiesRouter.patch('/:id', requireCapability('scheduling.manage'), validateBody(updateSignupOpportunitySchema), async (req, res) => {
  const { expected_version, ...changes } = req.body as UpdateSignupOpportunityInput;
  const updated = await unwrap(req.db.from('signup_opportunities').update(changes).eq('id', param(req, 'id')).eq('organization_id', req.orgId).eq('version', expected_version).select('*').maybeSingle());
  if (!updated) throw HttpError.conflict('This opening changed; refresh and try again');
  res.json(updated);
});

opportunitiesRouter.post('/:id/claim', validateBody(claimSignupOpportunitySchema), async (req, res) => {
  const body = req.body as ClaimSignupOpportunityInput;
  res.status(201).json(await unwrap(req.db.rpc('claim_signup_opportunity', {
    p_opportunity: param(req, 'id'), p_expected_version: body.expected_version, p_idempotency_key: body.idempotency_key,
  })));
});

opportunityClaimsRouter.post('/:id/decision', requireCapability('scheduling.manage'), validateBody(decideSignupClaimSchema), async (req, res) => {
  const body = req.body as DecideSignupClaimInput;
  res.json(await unwrap(req.db.rpc('decide_signup_claim', { p_claim: param(req, 'id'), p_expected_version: body.expected_version, p_action: body.action })));
});

opportunityClaimsRouter.get('/', requireCapability('scheduling.manage'), async (req, res) => {
  const planId = typeof req.query.plan_id === 'string' ? req.query.plan_id : null;
  let query = raw(req.db).from('opportunity_claims').select('*, opportunity:signup_opportunities!inner(id,plan_id,team_id,position_id,approval_policy), person:people!inner(first_name,last_name)');
  if (planId) query = query.eq('opportunity.plan_id', planId);
  const rows = (await unwrap(query.order('created_at', { ascending: false }).limit(200))) ?? [];
  res.json(rows.map((row: Record<string, unknown>) => {
    const person = row.person as { first_name: string; last_name: string | null };
    const { person: _person, ...rest } = row;
    return { ...rest, person_name: [person.first_name, person.last_name].filter(Boolean).join(' ') };
  }));
});

opportunityClaimsRouter.post('/:id/cancel', validateBody(cancelSignupClaimSchema), async (req, res) => {
  const body = req.body as CancelSignupClaimInput;
  res.json(await unwrap(req.db.rpc('cancel_signup_claim', { p_claim: param(req, 'id'), p_expected_version: body.expected_version })));
});

replacementRequestsRouter.get('/', async (req, res) => {
  await unwrap(req.db.rpc('expire_f07_allocations', { p_organization: req.orgId, p_limit: 200 }));
  const rows = await unwrap(raw(req.db).from('replacement_requests').select('*, offers:replacement_offers(*)').eq('organization_id', req.orgId).order('created_at', { ascending: false }).limit(200));
  res.json((rows ?? []) as ReplacementRequestDetail[]);
});

replacementRequestsRouter.post('/', validateBody(createReplacementRequestSchema), async (req, res) => {
  const body = req.body as CreateReplacementRequestInput;
  res.status(201).json(await unwrap(req.db.rpc('create_replacement_request', {
    p_assignment: body.assignment_id, p_expected_revision: body.expected_revision,
    p_idempotency_key: body.idempotency_key, p_expires_at: body.expires_at,
  }))); 
});

replacementRequestsRouter.post('/:id/cancel', validateBody(cancelReplacementRequestSchema), async (req, res) => {
  const body = req.body as CancelReplacementRequestInput;
  res.json(await unwrap(req.db.rpc('cancel_replacement_request', {
    p_request: param(req, 'id'), p_expected_version: body.expected_version,
  })));
});

replacementRequestsRouter.post('/:id/offers', requireCapability('scheduling.manage'), validateBody(issueReplacementOfferSchema), async (req, res) => {
  const body = req.body as IssueReplacementOfferInput;
  res.status(201).json(await unwrap(req.db.rpc('issue_replacement_offer', {
    p_request: param(req, 'id'), p_candidate: body.candidate_person_id,
    p_expected_version: body.expected_version, p_idempotency_key: body.idempotency_key,
  })));
});

replacementOffersRouter.post('/:id/action', validateBody(actOnReplacementOfferSchema), async (req, res) => {
  const body = req.body as ActOnReplacementOfferInput;
  res.json(await unwrap(req.db.rpc('act_on_replacement_offer', { p_offer: param(req, 'id'), p_expected_version: body.expected_version, p_action: body.action })));
});

approvedSwapsRouter.get('/', async (req, res) => {
  await unwrap(req.db.rpc('expire_f07_allocations', { p_organization: req.orgId, p_limit: 200 }));
  res.json((await unwrap(req.db.from('approved_swaps').select('*').eq('organization_id', req.orgId).order('created_at', { ascending: false }).limit(200))) ?? []);
});

approvedSwapsRouter.post('/', validateBody(createApprovedSwapSchema), async (req, res) => {
  const body = req.body as CreateApprovedSwapInput;
  res.status(201).json(await unwrap(req.db.rpc('create_approved_swap', {
    p_first: body.first_assignment_id, p_second: body.second_assignment_id,
    p_first_revision: body.first_revision, p_second_revision: body.second_revision,
    p_expires_at: body.expires_at, p_idempotency_key: body.idempotency_key,
  })));
});

approvedSwapsRouter.post('/:id/action', validateBody(actOnApprovedSwapSchema), async (req, res) => {
  const body = req.body as ActOnApprovedSwapInput;
  res.json(await unwrap(req.db.rpc('act_on_approved_swap', { p_swap: param(req, 'id'), p_expected_version: body.expected_version, p_action: body.action })));
});
