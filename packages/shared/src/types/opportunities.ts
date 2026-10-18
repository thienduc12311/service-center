export type OpportunityPolicy = 'direct' | 'leader_approval';
export type OpportunityState = 'open' | 'closed';
export type OpportunityClaimStatus = 'awaiting_approval' | 'confirmed' | 'cancelled' | 'rejected' | 'expired' | 'superseded';
export type ReplacementRequestStatus = 'open' | 'filled' | 'cancelled' | 'expired';
export type ReplacementOfferStatus = 'pending' | 'accepted_awaiting_approval' | 'finalized' | 'declined' | 'rejected' | 'expired' | 'superseded';
export type ApprovedSwapStatus = 'pending' | 'finalized' | 'cancelled' | 'expired' | 'rejected';

export type SignupOpportunityRow = {
  id: string;
  organization_id: string;
  plan_id: string;
  team_id: string;
  position_id: string;
  applicable_time_ids: string[];
  capacity: number;
  approval_policy: OpportunityPolicy;
  closes_at: string;
  reservation_minutes: number;
  state: OpportunityState;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type OpportunityClaimRow = {
  id: string;
  opportunity_id: string;
  person_id: string;
  status: OpportunityClaimStatus;
  opportunity_version: number;
  idempotency_key: string;
  reservation_expires_at: string | null;
  assignment_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export type ReplacementRequestRow = {
  id: string;
  organization_id: string;
  original_assignment_id: string;
  requester_person_id: string;
  plan_id: string;
  team_id: string;
  position_id: string;
  applicable_time_ids: string[];
  status: ReplacementRequestStatus;
  expires_at: string;
  version: number;
  idempotency_key: string;
  filled_assignment_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReplacementOfferRow = {
  id: string;
  request_id: string;
  candidate_person_id: string;
  status: ReplacementOfferStatus;
  request_version: number;
  idempotency_key: string;
  consented_at: string | null;
  leader_approved_at: string | null;
  leader_approved_by: string | null;
  reservation_expires_at: string | null;
  assignment_id: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ApprovedSwapRow = {
  id: string;
  organization_id: string;
  first_assignment_id: string;
  second_assignment_id: string;
  first_person_id: string;
  second_person_id: string;
  first_revision: number;
  second_revision: number;
  first_consented_at: string | null;
  second_consented_at: string | null;
  leader_approved_at: string | null;
  leader_approved_by: string | null;
  status: ApprovedSwapStatus;
  expires_at: string;
  version: number;
  idempotency_key: string;
  first_new_assignment_id: string | null;
  second_new_assignment_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SignupOpportunity extends SignupOpportunityRow {
  plan_title: string;
  service_date: string;
  team_name: string;
  position_name: string;
  remaining_capacity: number;
  eligibility: 'eligible' | 'full' | 'closed' | 'unavailable';
  times: Array<{ id: string; name: string | null; kind: string; starts_at: string; ends_at: string }>;
  my_claim: OpportunityClaimRow | null;
}

export interface OpportunityClaimDetail extends OpportunityClaimRow {
  person_name: string;
  opportunity: Pick<SignupOpportunityRow, 'id' | 'plan_id' | 'team_id' | 'position_id' | 'approval_policy'>;
}

export interface ReplacementRequestDetail extends ReplacementRequestRow {
  offers: ReplacementOfferRow[];
}
